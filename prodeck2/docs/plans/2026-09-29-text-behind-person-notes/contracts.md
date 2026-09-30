# Text behind the person — plan contracts (shared by every plan part)

Every plan part MUST use exactly these names, files, types and signatures. If a part needs something not listed, it
defines it inside its own task and says so in its report; it never renames anything below.

Repo root: `/Users/ford/Desktop/Thalent Ai/excp/prodeck2` (no git; "commit" = `npm test` green + `npm run typecheck`
clean, both from the repo root). Spec (Thai, approved): `docs/specs/2026-09-29-text-behind-person-design.md`.
Release version: **0.5.0** (`apps/desktop/package.json`).

## Terms
- **behind group** — a highlight group whose effective flag is on: `look.behindPerson === true` (stored) &&
  `flair.behindPerson === true` && the level shows the group. `flair.text` does NOT matter.
- **route** — `"ours"` when `settings.capcut.pro` is false, `"capcut"` when it is true. Read once per preview/write.
- **eligible** (ours only) — a helper exists and the group's source video passes `blockOf(probe, draftFps) === null`.
  A behind group that is not eligible is placed and drawn like a normal group and counted `front` (spec §6.2, §12).
- **range** — the part of one behind group's visible window that lies on one main piece (spec §6.1, §9.2).

## Timing constants (packages/core/src/cutout/frames.ts)
```ts
/** the person segment's source.start: every timeline frame asks for the middle of the gap before its frame (spec §7.2) */
export const PERSON_SOURCE_START_US = 16_667
/** bumped whenever the frame rule, the mask filter or the encode changes; part of every cutout hash */
export const CUTOUT_PIPELINE_VERSION = 1
```

## Core — new/changed exports

### packages/core/src/capcut/rough-cut.ts (refactor, behaviour unchanged)
```ts
/** A main piece as buildRoughCut writes it, in frames and in CapCut's µs. */
export interface PieceFrames {
  cut: number               // index into cuts / info.tracks[0].segments
  binId: string
  sourceStartUs: number     // frameToUs(startFrame) as written
  sourceDurationUs: number
  targetStartUs: number
  targetDurationUs: number
  targetStartFrame: number  // cursor frame
  frames: number
}
/** The frame math buildRoughCut uses, without a draft; throws the same errors buildRoughCut throws. */
export function cutFrames(cuts: Cut[], bin: BinVideo[], fps: number): PieceFrames[]
/** The played time of a source moment on these pieces (what timeline.ts calls `at`). */
export function atOn(pieces: PieceFrames[]): (cut: number, sourceUs: number) => number
```
`buildRoughCut` calls `cutFrames` and keeps its exact output (all existing rough-cut tests stay green unchanged).

### packages/core/src/cutout/ (new folder; `index.ts` re-exports everything below)
```ts
// ranges.ts
export interface CutoutRange {
  groupId: string
  cut: number                 // main piece index
  targetStartFrame: number
  frames: number              // ≥ 1
  targetStartUs: number       // frameToUs(targetStartFrame)
  targetDurationUs: number    // frameToUs(targetStartFrame + frames) − targetStartUs
  sourceStartUs: number       // S: piece.sourceStartUs + (targetStartUs − piece.targetStartUs)
}
/**
 * Behind groups' visible windows split per main piece, on frames exactly as addHighlightTracks draws line 0:
 * start = usToFrame(group.startUs), end = min(usToFrame(group.endUs), usToFrame(durationUs)). Overlaps shorter
 * than one frame are left out (the caller counts them as dropped.cutouts). Sorted by targetStartFrame.
 */
export function cutoutRanges(groups: { groupId: string; startUs: number; endUs: number }[], pieces: PieceFrames[], fps: number, durationUs: number): CutoutRange[]

// frames.ts
export interface SourceTiming {
  /** the video track's timescale (ticks per second); CapCut and AVFoundation agree on it */
  timescale: number
  /** every frame's presentation time in ticks, in presentation order */
  pts: number[]
}
/** true when every step between consecutive pts is the same (CapCut then rounds up; otherwise down) */
export function evenFrames(timing: SourceTiming): boolean
/**
 * The source frame (index into pts) CapCut shows when a piece asks for `askedUs` (spec §7.2 step 1, proven
 * 2026-09-29): uneven files → the latest frame with ptsUs ≤ askedUs + 1; even files → the first frame with
 * ptsUs ≥ askedUs − 1. ptsUs = pts × 1e6 / timescale (not rounded). Clamped to [0, pts.length − 1].
 */
export function shownSourceFrame(timing: SourceTiming, askedUs: number): number
/**
 * The source frames a person file holds, in file order: frame 0 a spare copy of frame 1, then for every timeline
 * frame n of the range the frame the main piece shows there, asked at piece.sourceStartUs + (frameToUs(n) −
 * piece.targetStartUs). Length = range.frames + 1.
 */
export function personFrames(range: CutoutRange, piece: PieceFrames, timing: SourceTiming, fps: number): number[]

// keyframes.ts  (uses Keyframes/KeyframePoint from capcut/types.ts)
/** a key list's value at t: the first key's before it, the last key's after it, straight lines between */
export function valueAt(keys: KeyframePoint[], t: number): number
/**
 * The main piece's zoom on our person file (spec §9.3): per list a key at the range's source start and end with
 * valueAt there, plus every key strictly inside, all shifted by −offsetUs (offsetUs = range.sourceStartUs −
 * PERSON_SOURCE_START_US); new ids on every list and key; [] when the piece has none.
 */
export function personKeyframes(main: Keyframes[], range: { sourceStartUs: number; durationUs: number }, offsetUs: number): Keyframes[]
/** The CapCut route's copy: the same keys (same file, same source time), new ids on every list and key. */
export function copiedKeyframes(main: Keyframes[]): Keyframes[]

// occlusion.ts
export interface SampleMask { width: number; height: number; data: Uint8Array }   // 8-bit, row-major, 255 = person
export interface LineBox { centreX: number; centreY: number; width: number; height: number } // CapCut transform units (x,y in −1..1, +1 = right/top), width/height as shares of canvas width/height
/**
 * Share (0..1) of the line's box the person covers (mask ≥ 128), with the mask mapped onto the canvas through the
 * main piece's clip (scale, transform) and the zoom value at that moment (scale about the centre, then positionY).
 */
export function coveredShare(mask: SampleMask, box: LineBox, place: { scale: number; x: number; y: number }, canvas: { width: number; height: number }): number
/** spec §10: a line covered by more than this counts the group as covered */
export const COVERED_LIMIT = 0.35
```

### packages/core/src/capcut/layers.ts (new)
```ts
/**
 * Puts the tracks in the order given, bottom to top: `layers` is a list of track-id lists; every track in info must be
 * listed exactly once (else throws). Every segment's track_render_index becomes its track's position. Pure.
 */
export function arrangeTracks(info: DraftInfo, layers: string[][]): DraftInfo
/** The ids of the tracks `after` has and `before` did not, in order (to learn what a writer appended). */
export function addedTracks(before: DraftInfo, after: DraftInfo): string[]
```

### packages/core/src/capcut/person.ts (new)
```ts
export interface TimelinePerson {
  targetStartUs: number
  targetDurationUs: number
  path: string          // <cutoutsDir>/<hash>.mov
  binId: string
  width: number
  height: number
  fileDurationUs: number
  clip: unknown         // the main piece's clip, copied
  keyframes: Keyframes[] // personKeyframes(...)
}
/** One overlay track (flag 2) of our person files; source.start = PERSON_SOURCE_START_US, volume 0, has_audio false. */
export function addPersonTrack(info: DraftInfo, people: TimelinePerson[]): { info: DraftInfo; trackId: string | null }

export interface TimelineMattingCopy {
  cut: number             // main piece index in info.tracks[0]
  targetStartUs: number
  targetDurationUs: number
  sourceStartUs: number
  draftFolder: string
}
/**
 * One overlay track of silent copies of main pieces with CapCut's background removal (spec §8): each copy gets a
 * fresh video material cloned from its piece's (new id, new unique_id, has_audio false,
 * matting = { ...cloned.matting, flag: 3, path: `${draftFolder}/matting/${md5hex(utf8(material.path))}`, custom_matting_id: UUID upper-case })
 * and fresh segmentExtras; volume 0; clip and copiedKeyframes of the piece.
 */
export function addMattingTrack(info: DraftInfo, copies: TimelineMattingCopy[]): { info: DraftInfo; trackId: string | null }
```

### packages/core/src/capcut/bin.ts (changed)
```ts
export const RENDERED_FOLDERS = ["/Movies/CapCut/BOXBLACK/graphics/", "/Movies/CapCut/BOXBLACK/cutouts/"]
/** a file BOXBLACK rendered (a graphic or a person cutout): not the user's footage, prunable, cleanable */
export function isRenderedFile(path: string): boolean
```
`isRenderedGraphic` stays exported as an alias of `isRenderedFile` (existing callers keep working);
`pruneBinItems(meta, dirs: string[], keep: Set<string>)` takes a list of folders (callers updated).

### packages/core/src/capcut/write.ts (changed)
`backupDraft` leaves out the draft's top-level `matting/` folder (CapCut recomputes it, spec §8).

### packages/core/src/flair
- `plan.ts`: `GroupLook.behindPerson?: boolean` (absent = false); `enforce` keeps it (edited and non-edited).
- `catalogue.ts`: `FlairOptions.behindPerson: boolean`; `DEFAULT_FLAIR_OPTIONS.behindPerson = true`.

### packages/core/src/highlights/pick.ts
- Reply group gains `behindPerson: z.boolean().default(false)`; read with `?? false`.
- `pickHighlights`/`acceptHighlights` take optional `pictures?: Record<string /*pointId*/, { face: boolean; keepClear: { fromY: number; toY: number }[] | null; scene: string | null }>`; `describe` prints them per point (spec §5.1).
- `HIGHLIGHT_PROMPT_VERSION` → `"highlights-2026-09-30-behind"`.

## Helper — apps/desktop/native/segment (Swift, `boxblack-segment`)
```
boxblack-segment --version                      → "boxblack-segment <VERSION>"
boxblack-segment probe <video>                  → one JSON object on stdout:
    { "timescale": n, "pts": [ticks...], "width": w, "height": h, "rotation": deg, "transfer": s|null, "primaries": s|null }
boxblack-segment render <video> --pts <file.json> --width W --height H [--radius R] [--raw-masks <dir>]
    <file.json> = { "pts": [ticks...] } (the frames to output, in order; repeats allowed)
    → stdout: raw yuva444p10le frames W×H, one per listed pts; stderr: "progress <done> <total>" lines, last "coverage <0..1>"
boxblack-segment sample <video> --pts <file.json> --size S
    → stdout: one JSON line per listed pts {"pts": t, "width": w, "height": h, "mask": "<base64 8-bit>"}
exit ≠ 0 with a one-line reason on stderr on any failure
```
Build: `apps/desktop/scripts/build-segment.sh <out>` (`xcrun swiftc -O -target arm64-apple-macos12.0`, `strip -x`,
`--version` smoke test) → `apps/desktop/resources/bin/boxblack-segment`; `VERSION=` pinned in the script.

## Main — new modules and their public surface
```ts
// apps/desktop/src/main/cutout-probe.ts
export interface SourceProbe { timescale: number; pts: number[]; width: number; height: number; rotation: number; transfer: string | null; primaries: string | null }
export type CutoutBlock = "no-helper" | "unreadable" | "rotated" | "hdr" | "draft-fps"
export function blockOf(probe: SourceProbe | null, draftFps: number): CutoutBlock | null   // null probe → "unreadable"
export function createSourceProbes(deps: { helper: () => string | null; run?: RunProcess }): { probe(path: string): Promise<SourceProbe | null> }  // cached by path+size+mtimeMs

// apps/desktop/src/main/cutout-render.ts
export interface CutoutJob {
  source: { path: string; size: number; mtimeMs: number }
  timescale: number
  /** the source pts (ticks) of each file frame, spare first: personFrames mapped through probe.pts */
  pts: number[]
  width: number
  height: number
}
export interface RenderedPerson { hash: string; path: string; width: number; height: number; durationUs: number; frames: number }
export type CutoutState = "waiting" | "cutting" | "ready" | "failed" | "no-person"
export interface CutoutRenderDeps { cutoutsDir: string; workDir: string; helper: () => string | null; ffmpeg: () => string | null; helperVersion: () => string; ffmpegVersion: () => string; timeoutMsFor?: (job: CutoutJob) => number; send: (event: AppEvent) => void }
export function createCutoutRenderer(deps: CutoutRenderDeps): {
  hashOf(job: CutoutJob): string                 // 16 hex, sha256 of source identity, pts list, size, CUTOUT_PIPELINE_VERSION, helper & ffmpeg versions
  ensure(folder: string, jobs: CutoutJob[]): void   // replaces the folder's wanted set; starts what is not made
  wait(folder: string, jobs: CutoutJob[]): Promise<{ ready: string[]; failed: string[]; noPerson: string[] }>  // raises these jobs to the front
  statusOf(hash: string): Promise<{ state: CutoutState; done?: number; total?: number; error?: string }>
  rendered(job: CutoutJob): Promise<RenderedPerson | null>
  retry(hash: string): void
  idle(): boolean
  cancel(): void
  sample(job: { source: CutoutJob["source"]; pts: number[] }): Promise<Map<number, SampleMask>>  // cached in <cutoutsDir>/samples/
}
export type CutoutRenderer = ReturnType<typeof createCutoutRenderer>

// AppEvent (shared/api.ts)
| { type: "cutout"; folder: string; hash: string; state: "started" | "progress" | "done" | "failed"; done?: number; total?: number; error?: string }
```
Files: `<cutoutsDir>/<hash>.mov` + `<hash>.json` (`{ width, height, durationUs, frames, coverage }`, written last);
`.<hash>.partial.mov` while encoding; `cutoutsDir = ~/Movies/CapCut/BOXBLACK/cutouts`.

## Shared types (apps/desktop/src/shared/api.ts)
```ts
export interface CutoutView {
  state: "waiting" | "cutting" | "ready" | "failed" | "no-person" | "blocked" | "capcut"
  progress?: number            // 0..1 while cutting
  reason?: CutoutBlock | string // blocked: the CutoutBlock; failed: the error line
  covered?: boolean            // the head-cover warning (spec §10)
  coverChecked?: boolean       // false when there is no helper to measure with
}
// HighlightGroupView gains:
behindPerson: boolean          // the stored flag (look.behindPerson ?? false), whatever the switches
cutout?: CutoutView            // only for a behind group (effective flag on)
// HighlightPreview gains:
behindPerson: { laid: number; front: number; pending: number; covered: number }
cutoutRoute: "ours" | "capcut"
// WriteResult gains:
behindPerson: { laid: number; front: number; covered: number }
dropped: { sounds; zooms; inserts; graphics; cutouts: number }
// FlairLookPatch gains: behindPerson?: boolean
```

## Track order written (spec §9.1), bottom → top
main · behind bars · behind text · person (ours) or matting copies (capcut) · cutaways · graphics · normal bars ·
normal text · subtitles · audio. Written by `arrangeTracks` at the end of `writeNow`, every write.

## i18n keys (renderer/src/i18n.ts), Thai
`flair.behindPerson`, `flair.behindPersonHint`, `flair.behindPersonHintPro`, `flair.look.behindPerson`,
`highlights.behindBadge`, `highlights.cutout.waiting|cutting|ready|failed|noPerson|capcut|retry`,
`highlights.cutout.blocked.no-helper|unreadable|rotated|hdr|draft-fps`, `highlights.cutout.covered`,
`highlights.cutout.coverUnchecked`, `write.behindLaid`, `write.behindPending`, `write.behindFront`,
`write.behindCovered`, `write.cutoutRenders`, `write.cutoutSpace`, `tools.segment`, `tools.segmentHint`,
`settings.renderedCutouts`.

## Task map (numbers are final; each part writes only its own tasks)
- Part A (core): 1 cutFrames+atOn · 2 cutoutRanges · 3 frames (evenFrames/shownSourceFrame/personFrames) · 4 keyframes ·
  5 arrangeTracks+addedTracks (+ comments/tests that argue by render_index) · 6 person.ts writers + bin predicate + backupDraft matting skip
- Part B (helper): 7 Swift helper + fixtures + build script + tests · 8 bundling: release-check, resolver, ToolReport, Settings tools row
- Part C (main pipeline): 9 cutout-probe · 10 cutout-render (jobs, queue, events, samples) · 11 files & cleanup (both folders) + index.ts wiring
- Part D (integration): 12 flags (GroupLook/FlairOptions/sanitisers/IPC/setLook) · 13 preview (effective flag, top placement at all
  placementOf callers, CutoutView, counts, ensure) · 14 occlusion (sample scheduling, geometry, covered counts) · 15 write (settings read
  first, waits, two highlight passes, person/matting tracks, arrangeTracks, counts, bin)
- Part E (Claude, UI, release): 16 pick prompt · 17 renderer UI (+ fake-api) · 18 docs + version 0.5.0 + full check ·
  19 controller: mutation lists, DMG, live test on 0917 (backup/restore), memory

## IPC and Settings additions (shared/api.ts, preload, main)
```ts
// DesktopApi (+ the channel list in shared/api.ts, preload, main/highlight-api.ts, fake-api):
retryCutout(folder: string, groupId: string): Promise<void>   // forgets the failures of every job of that group, then the preview is asked again (like retryGraphic)
// SettingsView gains:
cutoutFiles: { count: number; bytes: number }   // <cutoutsDir>/<hash>.mov files, beside the existing graphicFiles
```
`cleanGraphicFiles()` keeps its name and result type and now cleans both folders (graphics and cutouts, incl. the
cutouts' `samples/` cache entries whose source no longer exists); the Settings row shows both sizes
(`settings.renderedCutouts`). Part C owns main; Part E owns the renderer row; Part D owns `retryCutout` in main.
