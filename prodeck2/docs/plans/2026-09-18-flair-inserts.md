# Flair: Inserted Media (M10.4) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The flair step can also cut away to a picture: a photo or short clip the user already imported into this CapCut project plays over the rough cut while they talk about it.

**Design (approved 2026-09-18):**
- **The files come from the project's own media bin** (`draft_meta_info.json → draft_materials[type 0]`), minus the footage the outline uses. Nothing to pick, nothing to import: what is in the project is what can be inserted.
- **Claude sees the pictures**, not the file names: each candidate is described once by Claude through the same route the vision step uses (one frame per file, via ffmpeg), and the description is cached by the file's path and modification time. `IMG_4899.JPG` says nothing; "เล็บสีชมพูลายดอกไม้" does.
- A cutaway covers the whole frame — a photo for 2 s, a clip for as long as it has up to 3 s — with no sound of its own. The highlight text and the subtitles stay on top of it, the way the user's own 0815 does it.
- Rules: `light` has none; about one per 15 s at `medium` and one per 8 s at `heavy`; two inserts start at least 3 s apart; a file is used once; an insert must fit inside the timeline.
- Inserts go where the sounds can go — a highlight line, a beat's start, a jump — because those are the moments a cutaway belongs to.
- The same Claude call answers `inserts` beside `groups`, `cues` and `zooms`.

---

### Task 1: The project's spare media

**Files:** create `packages/core/src/flair/media.ts` (+ test), `apps/desktop/src/main/insert-media.ts` (+ test).

```ts
export interface BinMedia {
  /** the bin item's id, which the timeline material points at */
  binId: string
  path: string
  name: string
  kind: "photo" | "video"
  width: number
  height: number
  /** a photo has no length of its own; CapCut writes a nominal one */
  durationUs: number
}
/** The photos and clips in a draft's bin, minus the footage the outline uses. */
export function spareMedia(meta: unknown, usedPaths: string[], exists: (path: string) => boolean): BinMedia[]
```

The app side reads the draft's `draft_meta_info.json`, calls `spareMedia` with the outline's video paths, and caches the answer by the file's modification time.

- [x] Tests (core): photos and videos are read with their id, size and length; the outline's own footage is left out; a file that is gone is left out; music and unknown types are left out; the same file twice gives one entry.
- [x] Tests (main): the bin of a real fixture draft; a second call does not read the file again.
- [x] Implement; green; mutation-check.

### Task 2: Claude describes each picture

**Files:** create `packages/core/src/flair/look-at.ts` (+ test).

```ts
export const MEDIA_PROMPT_VERSION = "media-2026-09-18"
export const MEDIA_PROMPT: SystemPrompt
export const MediaReplySchema = z.object({ pictures: z.array(z.object({ picture: z.number().int(), what: z.string() })) })
export function describeMedia(args: {
  transport: LlmTransport
  model: string
  frames: { binId: string; path: string }[]
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<Record<string, string>>
```

One call with every picture, each numbered, asking for one short Thai line per picture saying what is in it. A number that is not on the list is dropped; a picture Claude says nothing about simply has no description and is still offered by its file name.

- [x] Tests: the reply becomes a description per bin id; an unknown number is dropped; the pictures are sent as images in order with their numbers; no pictures means no call.
- [x] Implement; green; mutation-check.

### Task 3: Insert cues and their rules

**Files:** `packages/core/src/flair/plan.ts` (+ test).

```ts
export interface InsertCue {
  /** where it cuts away, as a sound cue is anchored */
  anchor: CueAnchor
  binId: string
  edited: boolean
}
export interface PlacedInsert {
  cue: InsertCue
  atUs: number
  media: BinMedia
  /** how long the cutaway plays */
  durationUs: number
}
export function enforceInserts(inserts: PlacedInsert[], level: FlairLevel, durationUs: number): { kept: PlacedInsert[]; dropped: number }
```

`enforceInserts`: `light` keeps none; the user's own first; two inserts start at least `MIN_APART_US` 3 s apart; one file is used once; an insert whose end is past the timeline is cut to fit and dropped when nothing is left; the count is capped at `ceil(durationUs / 15 s)` at `medium` and `ceil(durationUs / 8 s)` at `heavy`; the result is in time order.

- [x] Tests: the quiet level keeps nothing; two inserts too close keep the first; the same file twice keeps the first; an insert at the very end is cut to what is left; the cap follows the level; the user's own wins; the result is in time order and the dropped count adds up.
- [x] Implement; green; mutation-check.

### Task 4: Writing the cutaways

**Files:** create `packages/core/src/capcut/inserts.ts` (+ test).

```ts
export interface TimelineInsert {
  atUs: number
  durationUs: number
  binId: string
  path: string
  kind: "photo" | "video"
  width: number
  height: number
}
export function addInsertTrack(info: DraftInfo, inserts: TimelineInsert[]): DraftInfo
```

One overlay video track (`flag: 2`), each insert a `type: "photo"` or `"video"` material with its path, size and `local_material_id` pointing at the bin item, and a segment with the six extra materials a video segment needs, `volume: 0`, and a clip scaled to cover the frame: `max(cw/mw, ch/mh) ÷ min(cw/mw, ch/mh)`, since CapCut fits a picture to the frame at scale 1. The times land on frames.

- [x] Tests: an insert becomes a material and a segment at its time on one overlay track; a photo that does not match the frame's shape is scaled to cover it; a picture the same shape as the frame stays at 1; the clip is silent; the times land on frames; no inserts, no track.
- [x] Implement; green; mutation-check.

### Task 5: Claude picks the cutaways

**Files:** `packages/core/src/flair/direct.ts` (+ test).

The reply gains `inserts: z.array(z.object({ at: z.number().int(), picture: z.number().int() }))`. The prompt lists the pictures by number — the description when there is one, else the file name — and reuses the places it already lists for the sounds. `acceptFlair` drops and counts an unknown place or picture, a second insert on one place, and one picture used twice.

- [x] Tests: a reply becomes inserts on the right anchors; unknown numbers are dropped and counted; one place and one picture are each used once; with no pictures the prompt says so and nothing is accepted.
- [x] Implement; green; mutation-check.

### Task 6: Main process and screen

**Files:** `apps/desktop/src/main/insert-media.ts`, `flair.ts`, `highlights.ts`, `timeline.ts`, `shared/api.ts`, `highlight-api.ts`, `settings.ts`; renderer `InsertCues.tsx` (create), `FlairSection.tsx`, `TimelineScreen.tsx`, `i18n.ts`, `test/fake-api.ts` (+ tests).

- `insertsInForce(stored, slots, media, flair, durationUs)` — stored inserts whose place and file are still there, through `enforceInserts`.
- The describing runs inside `flair.plan`, once per file, cached in a `MediaCache` under the app's data folder; without ffmpeg or Claude the media is still offered by name.
- The preview gains `inserts: InsertView[]` and `media`; `flair.setInsert(folder, anchor, binId | null)`; settings gain `flair.insert`; `WriteResult` gains `insertCount`.
- The screen gains a fourth switch, "สื่อแทรก", and a list of the places with a select of the project's spare pictures.

- [x] Tests: a stored insert whose file is gone is dropped; the write lays down what the preview showed; insert off writes no track; the screen lists the pictures and saves a choice.
- [x] Implement; green; mutation-check.

### Task 7: Verify

- [x] typecheck, full tests.
- [x] Live on 0917: two of the user's own photos put in the test draft's bin (backed up), planned through Claude Code, written, and the bin restored.
- [x] `dist:local`; spec entry + memory.

## Outcome (2026-09-18)

Done; 940 tests pass, typecheck clean, `dist:local` rebuilt. Differences from the plan:

- **The bin is filtered by bin id, not by path.** The outline names its videos by the bin item they came from, so that is what "the footage the outline already plays" means.
- **`extractFrames` no longer seeks when the time is 0.** ffmpeg given `-ss 0` on a still picture lands past its single frame and writes nothing, so describing a photo produced no file. Seeking to 0 was a no-op for video anyway.
- **The cache of what a picture shows is keyed by file, and everything else by bin item**, so the preview maps one to the other. A picture Claude says nothing about is asked about again next time; one it answered about is not.
- The `insertsInForce` caller now passes the length the file would play and `enforceInserts` only shortens it, instead of both working it out.

Checked for real on 0917:
- Two of the user's own photos went into the test draft's bin. Claude looked at them through the same route the vision step uses and came back with "เล็บยาวสีชมพูสลับฟ้า ลายกากบาท วางบนเครื่องอบเล็บ" and "เล็บยาวสีใส ลายดาวและจุดสีเล็กๆ" — right about both.
- On a clip about astronauts it then inserted **neither**, which is what the prompt asks for: a picture that has nothing to do with what is being said stays out.
- Setting one by hand wrote what it should: a `flag: 2` overlay track with a `type: "photo"` material pointing at the bin item, 2 s at 8.1 s, `volume: 0`, and `scale` 1.333 — the cover factor for a 3:4 photo in a 9:16 frame.
- A cutaway set half a second before the end was dropped by the rules, as designed.
- The draft was then written again without the cutaway and **the bin was restored**, so 0917 holds the text, sounds and zooms and its bin is exactly as it was.

Not done: looking at any of it in CapCut — its window stayed on another Space all session and the computer-use tools went away.
