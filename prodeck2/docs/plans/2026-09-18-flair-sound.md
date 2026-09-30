# Flair: Sound Effects (M10.2) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The same flair step that decides how the highlight text looks also drops sound effects on the rough cut — on the highlight lines, on the real cuts, and at the start and end of a beat.

**Design (approved with 9 review changes, 2026-09-18):**
1. **No roles, no keyword guessing.** The app shows Claude the sounds this machine actually has, by name and length, and Claude answers with their numbers.
2. **The library is the sounds the user's own CapCut has already used**: every draft on the machine is read for `type: "sound"` materials (name, `effect_id`, duration, cached path). Read when the user asks Claude to plan, cached by the draft folder's modification time — never on every preview.
3. **A sound is cut to 1.5 s** and fades out over 0.2 s when it was cut, so a 6 s notification does not play over the talking.
4. **Only real cuts are offered**: a join that skips at least 2 s of the source, or one between two beats. A filler trimmed out of a sentence gets no whoosh.
5. **A cut cue is anchored to the source** (`videoId` + the source time the next piece starts at), not to the cut's number, which moves whenever the rules change.
6. **A highlight group may have a sound on every line** — three pops as the lines land is the look the user's own 0815 uses. The 1.5 s spacing rule applies between different places, not inside one group.
7. **One Claude call, not two**: the flair reply gains `cues` beside `groups`, so the looks and the sounds are planned together.
8. **A sound whose cached file is gone is still written**, by `effect_id` alone, and CapCut may fetch it.
9. Numbers: จัดเต็ม is about one sound per 4 s (กลาง one per 8 s, น้อย none), and cues play at volume 0.6 under the talking.

**Still unverified:** whether CapCut fetches a sound from `effect_id` when the cached mp3 is gone. `scratchpad/hl/sound-spike.ts` is written and waiting for a free screen; two cached mp3s are already moved aside in `scratchpad/hl/moved-music/`. The answer only decides whether a built-in list of ids can ship for machines with an empty library — everything else works either way.

---

### Task 1: The machine's sound library

**Files:** create `packages/core/src/flair/sounds.ts` (+ test), `apps/desktop/src/main/sound-library.ts` (+ test).

```ts
// core: pure, so it can be tested against real draft JSON
export interface SoundEffect {
  effectId: string
  /** as CapCut names it */
  name: string
  durationUs: number
  /** the file in CapCut's music cache, or null when it is gone */
  path: string | null
}
/** The sound effects a draft's materials use, deduplicated by effect id. */
export function soundsInDraft(info: unknown, exists: (path: string) => boolean): SoundEffect[]
```

`soundsInDraft` reads `materials.audios[]`, keeps entries with `type: "sound"` and a non-empty `effect_id`, and drops anything without a name or a positive duration.

```ts
// main: every draft on the machine, cached by folder mtime
export function createSoundLibrary(deps: { root: () => Promise<string | null> }): {
  list(): Promise<SoundEffect[]>
}
```

The library reads each project's `draft_info.json`, merges by effect id (the first name and duration win, a real path beats a missing one), sorts by name, and re-reads a draft only when its `draft_info.json` mtime changed.

- [x] Tests (core): sounds are read with their id, name, length and path; `type: "music"` and entries without an effect id are left out; a missing file gives `path: null`; the same sound twice gives one entry.
- [x] Tests (main): two drafts merge into one list; a second call does not read the files again; a changed draft is read again; a missing drafts root gives an empty list.
- [x] Implement; green; mutation-check.

### Task 2: Cues, anchors and the rules

**Files:** `packages/core/src/flair/plan.ts` (+ test).

```ts
export type CueAnchor =
  | { kind: "highlight"; groupId: string; line: number }
  | { kind: "cut"; videoId: string; sourceUs: number }
  | { kind: "beat"; beatId: string; edge: "start" | "end" }
export interface SoundCue {
  anchor: CueAnchor
  effectId: string
  /** set by hand on the timeline screen: planning again leaves it alone */
  edited: boolean
}
/** A cue with the time it plays at and the sound it will use. */
export interface PlacedCue {
  cue: SoundCue
  atUs: number
  sound: SoundEffect
}
export function enforceCues(cues: PlacedCue[], level: FlairLevel, durationUs: number): { kept: PlacedCue[]; dropped: number }
```

`enforceCues`, in order:
- level `light`: nothing is kept.
- cues the user edited are laid down first, in time order; Claude's are then considered in time order against what is already there.
- a cue is dropped when another kept cue is within `MIN_GAP` 1.5 s **and** the two are not lines of the same highlight group, or when a kept cue with the same effect id is within `SAME_GAP` 3 s.
- the count is capped at `ceil(durationUs / 8 s)` at `medium` and `ceil(durationUs / 4 s)` at `heavy`, counting the user's cues first.
- what comes back is in time order; everything left out is counted.

- [x] Tests: the quiet level keeps nothing; two cues 1 s apart keep the first; two lines of one group stay together; the same sound twice in 3 s loses the second; the cap follows the level and the length; a cue the user set survives a cap that a Claude cue does not; the result is in time order and the dropped count adds up.
- [x] Implement; green; mutation-check.

### Task 3: Claude plans the cues in the same call

**Files:** `packages/core/src/flair/direct.ts` (+ test).

```ts
/** A place a sound can go, as Claude is shown it. */
export interface CueSlot {
  anchor: CueAnchor
  atUs: number
  /** what is there: a highlight line, a cut and how much it skips, or a beat edge */
  what: string
}
// the reply gains, beside `groups`:
cues: z.array(z.object({ at: z.number().int(), sound: z.number().int() }))
```

The prompt lists the sounds by number with their lengths, and the slots by number with their times and what they are. `acceptFlair` turns `{at, sound}` into a `SoundCue`, dropping and counting anything whose numbers are not on the lists or whose slot already has a cue. The prompt version becomes `flair-2026-09-18-sound`.

- [x] Tests: a reply becomes cues on the right anchors; an unknown slot or sound number is dropped and counted; two cues on one slot keep the first; no sounds on the machine means no cue list in the prompt and no cues accepted; the slots and sounds are numbered in the prompt from 1.
- [x] Implement; green; mutation-check.

### Task 4: Writing the sounds into CapCut

**Files:** create `packages/core/src/capcut/sounds.ts` (+ test).

```ts
export interface TimelineSoundCue {
  atUs: number
  effectId: string
  name: string
  /** the cached file, or null to let CapCut find it by id */
  path: string | null
  durationUs: number
}
export function addSoundTrack(info: DraftInfo, cues: TimelineSoundCue[]): DraftInfo
```

Copied from what CapCut 9.4 writes itself (0815): a `type: "sound"` material with `effect_id`, `category_id` and the cached `path`, and a segment carrying five extra materials — speed, placeholder_info, beats, sound_channel_mapping, vocal_separation — plus an `audio_fade`. A cue plays at most `MAX_CUE_US` 1.5 s, never past the end of the timeline, at volume 0.6, and a cue that had to be cut short fades out over 0.2 s. No cues, no track.

- [x] Tests: a cue becomes a material and a segment at its time with the right length; a long sound is cut to 1.5 s and fades out; a short one is left alone with no fade; a cue with no file writes `path: ""` and keeps its effect id; a cue past the end is left out; the track is one audio track and the ids are unique.
- [x] Implement; green; mutation-check.

### Task 5: Main process

**Files:** create `apps/desktop/src/main/sound-cues.ts` (+ test); `flair.ts`, `highlight-state.ts`, `timeline.ts`, `shared/api.ts`, `index.ts`, `highlight-api.ts` (+ tests).

- `slotsFor(plan, timed groups, beats)` — every highlight line, every cut that skips ≥ 2 s or changes beat, and each beat's start and end, with the time each one plays at.
- `cuesInForce(stored, slots, library, flair, durationUs)` — resolves stored anchors to slots, drops cues whose anchor is gone or whose sound the machine no longer has, and runs `enforceCues`.
- `flair.plan` sends the slots and the library with the groups and stores what comes back; `flair.setCue(folder, anchor, effectId | null)` sets one by hand.
- The write asks for the same cues and calls `addSoundTrack`; `WriteResult` gains `soundCount`.
- Settings: `flair` gains `text: boolean` and `sound: boolean`, both true by default, so the level and the per-kind switches are separate.

- [x] Tests: slots cover the three kinds and skip short cuts; a stored cue whose anchor is gone is dropped; a cue for a sound the machine lost is dropped; the write lays down what the preview showed; turning sound off writes no audio track.
- [x] Implement; green; mutation-check.

### Task 6: Timeline screen

**Files:** `renderer/src/components/FlairSection.tsx`, `SoundCues.tsx` (create), `screens/TimelineScreen.tsx`, `i18n.ts`, `styles.css`, `test/fake-api.ts` (+ tests).

- The flair section gains two switches, "ข้อความ" and "เสียงประกอบ", under the level.
- A list of the cues in time order: the time, what the cue sits on, the sound's name, a select to change it and a button to remove it. A cue the user set says so.
- When the machine has no sounds, the section says why instead of showing an empty list.

- [x] Tests; implement; green; mutation-check.

### Task 7: Verify

- [x] typecheck, full tests.
- [ ] `scratchpad/hl/sound-spike.ts` on 0917 (needs the screen): does CapCut fill the path back in, and does it fetch a sound whose cached file was moved away? The draft was written and the two mp3s moved aside, but CapCut's window sat on another Space all session, so the project was never opened. **The moved files are back in the cache**; the spike script and the draft cues are ready to run again.
- [x] Live: plan on 0917 through Claude Code with the looks and the sounds together, and write. Listening in CapCut is the user's to do — the draft is left holding the write.
- [x] `dist:local`; spec entry + memory.

## Outcome (2026-09-18)

Done; 850 tests pass, typecheck clean, `dist:local` rebuilt. Differences from the plan:

- **Only the last beat offers a closing place.** Every other beat's end is the next beat's start, which says more about the moment and takes the slot anyway. The closing place sits half a second before the last frame, or a sound there would have nowhere to play.
- **A join between beats is not offered as a cut**, for the same reason: the beat's own start is that moment. Cut places are the jumps of at least 2 s *inside* a beat.
- **The per-kind switches are `text` and `sound` in the settings**, beside the level, as M10.1's outcome said they would be once there were two kinds.
- The library also lists sounds a test draft used, because it reads every draft on the machine — on this Mac that briefly included a made-up id from the sound spike.

Checked for real on 0917 (the draft is left holding the write):
- The library found 7 real sounds from the user's own drafts (Popping, Click, Kirarin glitter, Wow, Incoming call, ฟิ้ว, ฟาด), with their ids and cached files.
- One Claude Code call planned the looks and the sounds together (28.5 s, nothing dropped): a pop on each of the hook's two lines — the same sound twice inside one group, which the rules allow on purpose — and a ฟาด on the next group's first line. 14 places were offered, 3 cues kept at กลาง on a 22 s clip, which is the one-per-8-s cap.
- The write put them on their own audio track at volume 0.6, with their cached files, beside the text tracks and the bars.

Not done: whether CapCut fetches a sound from `effect_id` alone when the cached mp3 is gone. Everything is in place to answer it the next time the screen is free.
