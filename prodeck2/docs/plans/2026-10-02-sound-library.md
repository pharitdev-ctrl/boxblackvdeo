# Sound Library Implementation Plan (0.9.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude picks a sound from a library before composing one: sounds Claude composed before, CapCut's 28 free built-ins, audio files the user imported, and (with CapCut Pro) CapCut library sounds other projects use. A picked sound tied to a graphic is laid at each of the graphic's beats. Release 0.9.0.

**Architecture:**
- **Data.** A stored `ComposedSound` may carry `picked` (what was picked) instead of composed code. Everything that places, switches, removes and undoes a composed sound keeps working on it.
- **Library.** Main builds the library from four sources each time the sounds work asks. Past composed one-shots live in an index in userData, which the file cleanup respects.
- **Planning.** The sound plan sees the numbered library and answers `pick` per sound. Picked sounds skip composing and rendering.
- **Beats.** The graphic contract asks for a `<!-- beats: … -->` line; core parses it from the fragment. A picked sound tied to a graphic is repeated at each beat; with no beats it is composed as before.
- **Writing.** CapCut-id sounds go through `addSoundTrack`, files through `addComposedSoundTrack`, each with a volume from the loudness Claude chose.

**Tech Stack:** TypeScript on Node 26, Electron 44, React, zod 4, vitest. No git: "commit" means `npm test` green and `npm run typecheck` clean from the repo root.

**Spec:** `docs/specs/2026-10-02-sound-library-design.md` (Thai, approved 2026-10-02).

---

## How to run this plan

**Waves.** Within a wave no two implementers own the same file.
- **Wave 1:** Task 1 (core picked data and library lines), Task 2 (core graphic beats), Task 3 (core writers take a volume).
- **Wave 2:** Task 4 (core sound plan picks), after Task 1. Task 5 (main library and index), after Task 1.
- **Wave 3:** Task 6 (main sounds work: plan, pick, compose, redo, edit), after Tasks 2, 4, 5.
- **Wave 4:** Task 7 (main placement and write), after Tasks 3 and 6.
- **Wave 5:** Task 8 (renderer).
- **Task 9** is the controller's.

**Briefs** go in `docs/plans/2026-09-30-freeform-motion-notes/prompts/` with the prefix `r090-`. Common rules: `r070-common.md` ("Rules of this repo", "Working conditions", "Report format"). Prompt text in this plan is copied verbatim. Reviews read frozen snapshots.

## Files

| File | Responsibility | Task |
|---|---|---|
| `packages/core/src/sound/library.ts` (new) | `LibrarySound`, `SOURCES`, `libraryLine`, `gainFor` | 1 |
| `packages/core/src/sound/spec.ts` | `PickedSound`, `ComposedSound.picked?`, `SoundPrevious.picked?`, `isComposed` | 1 |
| `packages/core/src/graphics/motion/write.ts`, `graphics/motion/beats.ts` (new) | contract line, `beatsOf` | 2 |
| `packages/core/src/capcut/sounds.ts`, `capcut/composed-sounds.ts` | per-sound `volume` | 3 |
| `packages/core/src/sound/plan.ts` | library in the request, `pick` in the reply, prompt rules | 4 |
| `apps/desktop/src/main/sound-library.ts`, `sound-index.ts` (new), `graphics-files.ts`, `sound-render.ts` | the four sources, the index, cleanup keeps indexed files | 5 |
| `apps/desktop/src/main/sound-work.ts`, `flair.ts` (sound redo/edit only) | picks in the plan, tied picks after the graphic, redo/edit may pick | 6 |
| `apps/desktop/src/main/composed-cues.ts`, `timeline.ts`, `highlights.ts` (sound views), `shared/api.ts` | placing picked sounds, repeats, writing, views | 7 |
| `apps/desktop/src/renderer/src/edit/ComposedList.tsx`, `WriteButton.tsx`, `i18n.ts` | source labels, repeat count, sheet counts | 8 |

## Names shared across tasks

```ts
// packages/core/src/sound/library.ts (Task 1)
export const SOURCES = ["composed", "capcut", "file", "project"] as const
export type SoundSource = (typeof SOURCES)[number]
/** One sound Claude may pick. `key` is stable across runs: the effect id for CapCut sounds, the file path for files. */
export interface LibrarySound {
  source: SoundSource
  key: string
  /** what Claude reads: a composed sound's role, a built-in's Thai `use`, else the name CapCut or the file gives it */
  label: string
  durationUs: number
  /** a file to write, or null for a CapCut sound fetched by its id */
  path: string | null
  effectId: string | null
  /** the loudness a composed sound was levelled to; null when unknown */
  loudness: SoundLoudness | null
}
export const LIBRARY_MAX_US = 6_000_000
/** One line of the numbered list Claude is shown. */
export function libraryLine(sound: LibrarySound, index: number): string
/** The CapCut volume that brings a picked sound to the loudness Claude asked for. */
export function gainFor(sound: Pick<LibrarySound, "loudness">, wanted: SoundLoudness): number

// packages/core/src/sound/spec.ts (Task 1)
export interface PickedSound { source: SoundSource; key: string; label: string; durationUs: number; path: string | null; effectId: string | null; loudness: SoundLoudness | null }
// ComposedSound gains: picked?: PickedSound   (code stays null on a picked sound)
// Today `code !== null` means "written". From Task 1 on, every such check uses
export const soundReady = (sound: Pick<ComposedSound, "code" | "picked">): boolean => sound.code !== null || sound.picked !== undefined
// and anything that renders or lints code skips picked sounds.
// SoundPrevious gains: picked?: PickedSound   (code may then be "")

// packages/core/src/graphics/motion/beats.ts (Task 2)
export const BEATS_MAX = 8
export function beatsOf(html: string, seconds: number): number[] | null

// packages/core/src/sound/plan.ts (Task 4)
// SoundClip gains: library: LibrarySound[]
// PlannedSound gains: pick: number | null   (index from 0 into clip.library)
export const SOUND_PLAN_PROMPT_VERSION = "sound-plan-2026-10-02-library"

// apps/desktop/src/main/sound-library.ts (Task 5)
// SoundLibrary gains: pickable(pro: boolean): Promise<LibrarySound[]>
// apps/desktop/src/main/sound-index.ts (Task 5)
export interface SoundIndex { add(entry: LibrarySound): Promise<void>; list(): Promise<LibrarySound[]>; files(): Promise<Set<string>> }
```

---

### Task 1: Core: picked sounds and library lines

**Files:** Create `packages/core/src/sound/library.ts`, `library.test.ts`. Modify `packages/core/src/sound/spec.ts`, `spec.test.ts`. Export `./sound/library` in `packages/core/package.json`.

- [ ] **Step 1: `library.ts` types** as in "Names shared across tasks".
- [ ] **Step 2: `libraryLine(sound, i)`** gives `${i + 1}. [${SOURCE_NAME[sound.source]}] ${sound.label} (${(sound.durationUs / 1e6).toFixed(1)} s)`, where `SOURCE_NAME` is `{ composed: "composed before", capcut: "CapCut free", file: "user's file", project: "CapCut library" }`. The label is made one line and cut to 120 characters. Test each source and a long label.
- [ ] **Step 3: `gainFor(sound, wanted)`.**
  - With a known `loudness`: `10 ** ((LOUDNESS_LUFS[wanted] - LOUDNESS_LUFS[sound.loudness]) / 20)`, held to 0.1..2.
  - Unknown: `{ soft: 0.5, normal: 0.7, strong: 1 }[wanted]`.
  - Test both, and the clamp.
- [ ] **Step 4: `PickedSound` in `spec.ts`.** `ComposedSound.picked?: PickedSound`; `SoundPrevious.picked?: PickedSound`. `isComposed` accepts a sound with `code: null` and a valid `picked` (each field typed; `source` one of `SOURCES`; `durationUs` finite > 0). `isSoundPrevious` accepts `picked` the same way. Test passing and failing shapes, including an old composed sound without `picked`.
- [ ] **Step 5: `soundReady`** in `spec.ts`, tested. Do not change its callers here (Tasks 6 and 7 do, in main).
- [ ] **Step 6.** `npm test`, `npm run typecheck`.

### Task 2: Core: the graphic's beats

**Files:** Create `packages/core/src/graphics/motion/beats.ts`, `beats.test.ts`. Modify `packages/core/src/graphics/motion/write.ts` (`MOTION_CONTRACT` only) and its test. Export `./graphics/motion/beats`.

- [ ] **Step 1: the contract line.** Add to `MOTION_CONTRACT`, at the end of its section on timing (read the contract and put it where timing is described), verbatim:
  ```text
  Put one HTML comment anywhere in the fragment that lists the moments a sound should hit, in seconds from the graphic's start, in time order, at most eight: `<!-- beats: 0.4 1.1 1.8 -->`. A beat is a moment something appears, lands, pops, counts or changes; small continuous motion is not a beat. Leave the comment out when nothing in the graphic is a clear hit.
  ```
  Do not change `MOTION_VERSION` (it is in the render hash; changing it would stale every graphic).
- [ ] **Step 2: `beatsOf(html, seconds)`.** Finds the first `<!--\s*beats:\s*([^>]*?)\s*-->`; splits on white space and commas; keeps finite numbers with `0 <= b < seconds`; sorts; drops duplicates closer than 0.05 s; keeps the first `BEATS_MAX`; rounds to the millisecond. No comment, or nothing left: `null`. Tests: a normal line, unsorted, out of range, junk tokens, no comment, more than eight.
- [ ] **Step 3.** Check the graphic lint (`graphics/motion/lint.ts`) accepts an HTML comment; add a test that a fragment with the beats line lints clean.
- [ ] **Step 4.** `npm test`, `npm run typecheck`.

### Task 3: Core: writers take a volume

**Files:** Modify `packages/core/src/capcut/sounds.ts`, `capcut/composed-sounds.ts` and their tests.

- [ ] **Step 1.** `TimelineSoundCue.volume?: number` and `TimelineComposedSound.volume?: number`. The segment's `volume` and `last_nonzero_volume` use it, else today's constant. Test: absent gives today's JSON exactly; 0.5 gives 0.5 on both fields.
- [ ] **Step 2.** `TimelineComposedSound.durationUs` today is the file's length; add `playUs?: number`, the length to play (cut short, as `addSoundTrack` does past `MAX_CUE_US`, with its fade). Absent: the whole file, as now. Test.
- [ ] **Step 3.** `npm test`, `npm run typecheck`.

### Task 4: Core: the sound plan picks

**Files:** Modify `packages/core/src/sound/plan.ts`, `plan.test.ts`.

- [ ] **Step 1: the request.** `SoundClip.library: LibrarySound[]`. `describeSoundClip` adds, after the cutaways, `Sound library:` and one `libraryLine` each, or `Sound library: none` when empty. Test the exact text.
- [ ] **Step 2: the reply.** `SoundPlanSchema` sounds gain `pick: z.number().int().default(0)`. `acceptSoundPlan` sets `pick` to `answer.pick - 1` when it names a library sound, else `null` (0, out of range, or negative: composed). Nothing is dropped for a bad pick. Tests.
- [ ] **Step 3: the prompt.** In `SOUND_PLAN_PROMPT`:
  - In the "You are given" sentence, after "the cutaways,", add "the sound library,".
  - In the answer list, after the `loudness` line, add verbatim:
    ```text
      - pick: the number of a library sound that fits this moment as it is, or 0 to have it composed.
    ```
  - Add a paragraph after "How to choose:" bullets, verbatim:
    ```text
    The sound library:
    - It lists sounds that already exist: sounds composed for earlier clips, CapCut's free sounds, the user's own files and, when the user has CapCut Pro, CapCut library sounds. Each line says where it comes from, what it is and how long it lasts.
    - Pick a library sound whenever one truly fits the moment; picking is much faster than composing. Have a sound composed only when nothing in the library fits.
    - Judge by what the line says the sound is. Do not pick a file whose name does not say what it sounds like.
    - One library sound may be picked for many moments.
    - A picked sound that scores a graphic is repeated by the app on each of the graphic's hits, so pick a short single hit for it.
    - Still write role, seconds and loudness for a picked sound: role says what it does there.
    ```
  - `SOUND_PLAN_PROMPT_VERSION = "sound-plan-2026-10-02-library"`.
- [ ] **Step 4.** `npm test`, `npm run typecheck`.

### Task 5: Main: the library and its index

**Files:** Create `apps/desktop/src/main/sound-index.ts`, `sound-index.test.ts`. Modify `sound-library.ts`, `graphics-files.ts`, `sound-render.ts`, `index.ts` (wiring) and their tests.

- [ ] **Step 1: the index** (`sound-index.ts`), a JSON file `<userData>/sound-index.json` of `LibrarySound` entries with `source: "composed"`.
  - `add` keeps one entry per `label` (exact text) and per `path`; a later add of the same label replaces the file only if the old file is gone.
  - `list` returns entries whose file exists.
  - `files` returns the basenames of every entry's file.
  - Writes are atomic (temp then rename), like the other userData stores. Tests with a temp folder.
- [ ] **Step 2: filling it.**
  - `sound-render.ts`: when an untied composed sound's WAV is levelled and in place, `index.add({ source: "composed", key: path, label: role, durationUs, path, effectId: null, loudness })`. Tied sounds are not added.
  - On first start after update (no index file yet), seed it from every stored outline's `flair.composed` entries that are untied, written, and whose WAV (the render hash file) exists. Find how the render names a WAV from a sound and reuse it.
  - Tests.
- [ ] **Step 3: cleanup keeps them.** `cleanGraphicFiles` takes `keep?: () => Promise<Set<string>>` and treats those sound basenames as referenced. Wire `index.files`. Test.
- [ ] **Step 4: `pickable(pro)`** in `sound-library.ts` gives, in this order:
  1. the index's entries;
  2. the built-ins (`source: "capcut"`, `label` = `use`, `path` from the cache when known, `effectId`), minus unfetchable ones;
  3. user files: every draft's `materials.audios` entry with a local `path` that exists, no effect id, not inside BOXBLACK's sounds folder, and not a video's extracted audio (read how CapCut marks extracted audio in the drafts, and say what you found); `label` = file name; `source: "file"`;
  4. with `pro`, every other draft sound with an effect id that is not a built-in, minus unfetchable (`source: "project"`).

  Then it drops entries longer than `LIBRARY_MAX_US`, and drops a later entry with the same `key` or the same `label` and source. `loudness` is the index's for composed sounds, else null. Tests per source, the Pro gate, the filters, and the order.
- [ ] **Step 5.** `npm test`, `npm run typecheck`.

### Task 6: Main: the sounds work picks

**Files:** Modify `apps/desktop/src/main/sound-work.ts`, `flair.ts` (the sound redo and edit only) and their tests.

- [ ] **Step 1: the plan.** The sounds work passes `library: await sounds.pickable(pro)` in the `SoundClip` (`pro` from the "มี CapCut Pro" setting, as the write reads it). A planned sound with `pick !== null` is stored with `picked` (copied from the library entry), `code: null`, `version: SOUND_VERSION`, and is not composed or rendered. It does not take a slot of the shared call limit.
- [ ] **Step 2: tied picks.** A picked sound tied to a graphic waits for that graphic's writing to end, as tied composed sounds do (0.7.3):
  - written, with `beatsOf(fragment, graphic seconds)` not null: keep the pick, store nothing else (the beats are read again from the fragment wherever needed, so a graphic redone later moves its sound's hits with it);
  - written with no beats: drop the pick and compose it as a tied composed sound, as today;
  - failed or gone: unwritten, counted as today.
- [ ] **Step 3: redo and edit may pick.** For a sound's redo and edit, first ask Claude one short call with the library, the sound's role, its moment's words and, for an edit, the instruction and what it is now (picked label, or "composed"). Schema `{ pick: number }` (0 = compose). Prompt for this call, verbatim:
  ```text
  You choose one sound effect for a moment of a short video. You are given what the sound must do, the words said there, for a change the user's instruction and the sound it replaces, and a numbered library of existing sounds. Answer pick: the number of a library sound that does what is asked as it is, or 0 when none does and a new one should be composed. Judge by what each line says the sound is; never pick a file whose name does not say what it sounds like. For a change, do not pick the sound being replaced.
  ```
  - A pick stores `picked` with `previous` set (0.5.1 rules: `previous` keeps what was there, picked or composed; `instruction` set on an edit).
  - 0 composes as today.
  - A tied sound picked on redo follows Step 2.
  - Undo restores `previous` whichever kind it is.
- [ ] **Step 4: "written".** Every check in `sound-work.ts` and `flair.ts` that reads `code !== null` as "written" uses `soundReady`; renders, lints and code-hash staleness skip picked sounds. List each place changed in the report.
- [ ] **Step 5: tests.** The plan with picks and composes; no composing call for a picked sound; a tied pick with beats kept, without beats composed; redo and edit picking and composing; undo across kinds; the call limit unaffected by picks.
- [ ] **Step 6.** `npm test`, `npm run typecheck`.

### Task 7: Main: placing and writing picked sounds

**Files:** Modify `apps/desktop/src/main/composed-cues.ts`, `timeline.ts`, `highlights.ts` (the sound views), `shared/api.ts`, `renderer/test/fake-api.ts`, and their tests.

- [ ] **Step 1: placing.** `composedInForce` places a picked sound like a composed one, with:
  - **its length:** the smaller of its `picked.durationUs`, its room (as today) and `seconds`;
  - **written** by `soundReady` (every `code !== null` check in `composed-cues.ts`, `timeline.ts` and `highlights.ts` changes to it; list them);
  - **not stale** for a changed wording (staleness is about composed code);
  - **tied with beats:** one placed hit per beat at `graphic.atUs + beat`, each as long as the smaller of its length and the time to the next beat (the last: its length), and inside the graphic's room plus `MOTION_RUN_ON_US`. `PlacedComposed` gains `hits?: { atUs: number; durationUs: number }[]`.
  - Tests.
- [ ] **Step 2: views.** `ComposedSoundView` gains `source: SoundSource | "new"` and `hits: number` (1 unless repeated). Fill them in `highlights.ts`. `fake-api.ts` follows.
- [ ] **Step 3: writing.** In `timeline.ts`:
  - a picked sound with an `effectId` and no `path` goes through `addSoundTrack` as a `TimelineSoundCue` (one per hit), `volume: gainFor(picked, loudness)`;
  - one with a `path` goes through `addComposedSoundTrack` (imported into the bin as composed WAVs are), one per hit, `playUs` its placed length, the same volume;
  - a CapCut sound that needs Pro without the Pro setting is left out and counted as today's Pro sounds are (it should not happen: the library hides them);
  - `WriteResult` counts picked sounds apart: `picked: number`.
  - Tests on the draft fixture: both kinds land at the right times, lengths and volumes; repeats for a tied pick.
- [ ] **Step 4.** `npm test`, `npm run typecheck`.

### Task 8: Renderer: where a sound came from

**Files:** Modify `apps/desktop/src/renderer/src/edit/ComposedList.tsx`, `edit/WriteButton.tsx`, `i18n.ts` and their tests.

- [ ] **Step 1: texts** in `i18n.ts`:

  | Key | Text |
  |---|---|
  | `sounds.source.capcut` | จากคลัง CapCut |
  | `sounds.source.project` | จากคลัง CapCut |
  | `sounds.source.composed` | เคยแต่งไว้ |
  | `sounds.source.file` | ไฟล์ของคุณ |
  | `sounds.source.new` | แต่งใหม่ |
  | `sounds.hits` | วาง {count} ครั้งตามจังหวะกราฟิก |
  | `write.soundsPicked` | หยิบจากคลัง {count} เสียง |

- [ ] **Step 2: rows.** Each sound row shows its source line, and `sounds.hits` when `hits > 1`. The buttons stay as they are.
- [ ] **Step 3: the write sheet.** The composed sounds line counts new ones; a `write.soundsPicked` line counts picked ones, hidden at 0.
- [ ] **Step 4: tests.** Source lines per kind, the hits line, the sheet lines.
- [ ] **Step 5.** `npm test`, `npm run typecheck`.

### Task 9 (controller): checks, version, live test, docs

- [ ] **Step 1.** The gate, and a mutation check on `library.ts`, `beatsOf`, `acceptSoundPlan` picks, `pickable`, the index, tied-pick placement and the write's volume.
- [ ] **Step 2.** Version `0.9.0`, `npm run dist`.
- [ ] **Step 3: live test** on the draft the user allows (ask), with CapCut closed and a backup:
  - "ทำทั้งหมด" at heavy; time it against 0.8.x (208 s on "1001 (1)"); count picked and composed sounds and their sources;
  - check a tied pick lands on its graphic's beats;
  - redo one picked sound, edit one ("แหลมขึ้น"), undo;
  - write, the user listens in CapCut and exports (no Pro), then restore and check identical.
- [ ] **Step 4.** Docs and memory.
