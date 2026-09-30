# Text Behind the Person Implementation Plan

> **Status: parked on 2026-09-30 by the user.** No code has been written. Resume only when the user asks.
> This file is the raw merge of five plan parts. The cross-part fixes were never applied: before running any task, work
> through `2026-09-29-text-behind-person-notes/merge-notes.md` (14 items), then do the self-review and a consistency
> review. The notes folder's README says what else is there.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude picks some highlight groups to sit behind the speaker. BOXBLACK then cuts the person out, using its own bundled Vision helper, or CapCut's background removal when "มี CapCut Pro" is on. It writes the person layer between the behind text and everything else, frame for frame in step with the picture. Release 0.5.0.

**Architecture:**
- **Pure core (`packages/core`):** timing and layout functions. They cover the rough cut's frames, the ranges each behind group covers, which source frame CapCut shows, the zoom on the person layer, the track order, and the person and matting writers.
- **Swift helper `boxblack-segment`:** probes a source's frame times, and renders a person as raw `yuva444p10le` frames with the mask filter the user chose ("ช่อง 4"). The bundled ffmpeg encodes those frames to ProRes 4444.
- **Main process:**
  - probes sources;
  - queues cut jobs, as the graphics renderer does;
  - shows each group's state in the preview, with a head-cover warning;
  - waits for the jobs before a write, then writes both highlight passes, the person or matting track, and every track in the §9.1 order.
- **Renderer:** a switch, a per-group toggle, statuses, and rows on the write page and in Settings.

**Tech Stack:**
- TypeScript on Node 26 (native TS), vitest, Electron, React.
- Swift 5 with AVFoundation, Vision and Accelerate, targeting macOS 12, arm64.
- The bundled ffmpeg 8.1.2 (`prores_ks`).

**Spec:** `docs/specs/2026-09-29-text-behind-person-design.md` (Thai; the user approved it on 2026-09-29).

---

## How to run this plan

- **No git.** Here, "Commit" means `npm test` is green and `npm run typecheck` is clean, both run from the repo root. The controller takes a snapshot (`sh $S/m25/snap.sh before-050-taskN`) before each task.
- **Controller only:** the mutation checks (`python3 $S/mutate.py …`), the DMG and the live test on draft 0917. Never run mutations while vitest or a reviewer is running.
- **Drafts and user data:**
  - Only draft `0917` may be written. Back it up first and restore it afterwards.
  - The user's other drafts and `~/Library/Application Support/BOXBLACK` are read-only.
  - Nothing is ever deleted outright: it goes to `~/.Trash`.
  - The product never quits CapCut; ask the user to close it.
- **Fixtures:** synthetic pictures or numbers only. Never a picture of the user.
- **Order:** the tasks are numbered in dependency order and each one ends green. Tasks 12–15 add required fields. Each of them updates the fixtures the compiler flags (renderer `fake-api.ts`, `PostScreen.test.tsx`, `WriteScreen.test.tsx`, main test literals) with minimal values, so later tasks start green.

## Files

| Area | Create | Modify |
|---|---|---|
| core timing | `packages/core/src/cutout/{index,ranges,frames,keyframes,occlusion}.ts` (+ tests) | `packages/core/src/capcut/rough-cut.ts`, `packages/core/package.json` (exports) |
| core writers | `packages/core/src/capcut/{layers,person}.ts` (+ tests) | `capcut/{bin,write,inserts,graphics,overlays,index,zoom}.ts` |
| core flags and prompt | — | `flair/{plan,catalogue}.ts`, `highlights/pick.ts`, `media/tool-check.ts` |
| helper | `apps/desktop/native/segment/*.swift`, `native/segment/{reference,fixtures}/…`, `scripts/build-segment.sh` | `scripts/release-check.ts` |
| main | `main/{cutout-probe,cutout-render,behind-person,segment-helper,zoom-cues}.ts` (+ tests), `main/native-segment.test.ts`, `main/bundled-segment.test.ts` | `main/{timeline,highlights,highlight-state,graphics-cues,graphics-files,flair,settings,settings-api,highlight-api,timeline-api,tools,index}.ts`, `main/timeline-fixture.ts` |
| shared and renderer | — | `shared/api.ts`, `renderer/src/edit/{GraphicsTab,HighlightTab,LookPopover,ClipRoom}.tsx`, `renderer/src/screens/{WriteScreen,SettingsScreen}.tsx`, the tools card, `i18n.ts`, `renderer/test/fake-api.ts` |
| docs | — | `apps/desktop/package.json` (0.5.0), the three specs |

## Names shared across tasks (read before any task)

- **Timeline and highlight deps added in Task 11, used from Task 13 on:**
  - `cutouts` (the renderer)
  - `probes` (`SourceProbes`, from `main/cutout-probe.ts`)
  - `cutoutsReady` (`() => Promise<boolean>`; await it before any `cutouts.hashOf`)
  - `cutoutsDir`
- **Added by Task 13:** `segmentHelper` (`() => string | null`) and `HighlightDeps.send`.
- **`cutout/occlusion.ts`:**
  - Task 10 creates it with `SampleMask` only.
  - Task 14 adds `LineBox`, `coveredShare` and `COVERED_LIMIT` to the same file, keeping `SampleMask`.
- **Helper path:** Task 8's `segmentHelperIn(join(resourcesDir, "bin"))`. Task 11 uses the same path for the renderer and reads the version once.
- **Encode colour tags:** `-color_primaries/-color_trc/-colorspace/-color_range` go BEFORE `-i -`. As output options, the bundled ffmpeg drops primaries and transfer. Always tag `tv`, because the helper outputs video range.
- **i18n:** Task 15 adds `flair.behindPerson` and `DROPPED_NAMES.cutouts`. Task 17 keeps one copy.
- **The renderer never imports `@boxblack/core/cutout`,** because it pulls in `node:crypto`.

---

### Task 1: The rough cut's frames without a draft (`cutFrames`, `atOn`)

**Files:**
- Modify: `packages/core/src/capcut/rough-cut.ts` (the whole file, :1-81: the frame math of `buildRoughCut` moves into `cutFrames`)
- Test: `packages/core/src/capcut/rough-cut.test.ts` (imports :1 and :6; new tests appended after :218)

Why: the preview, the cutout jobs and their hashes must time everything on the very frames the write lays, and the preview has no draft to build. `cutFrames` is the frame math `buildRoughCut` already does, pulled out so both use one copy of it. `buildRoughCut`'s output must not change by a byte: its 18 tests stay as they are, and Step 1 and Step 5 compare a fingerprint of its output before and after.

- [ ] **Step 1: Fingerprint what `buildRoughCut` writes today.**

  From the repo root, run this and write down the hash it prints. It builds a rough cut of the fixture draft with a cut CapCut rounds (766_700 µs), a cut off the frame grid, and one that runs to the end of a file that ends between frames. The ids are random, so each is named by where it first appears.

```sh
cd "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
node --input-type=module <<'EOF'
import { createHash } from "node:crypto"
import { join } from "node:path"
import { makeDraftRoot } from "./packages/core/test/fixture-root.ts"
import { binVideos, loadDraft } from "./packages/core/src/capcut/read.ts"
import { buildRoughCut } from "./packages/core/src/capcut/rough-cut.ts"

const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
const [clip] = binVideos(draft.meta)
const odd = { ...clip, id: "odd", durationUs: 10_020_000 }
const out = buildRoughCut(
  draft.info,
  [
    { binId: clip.id, sourceStartUs: 766_700, sourceDurationUs: 1_833_300 },
    { binId: clip.id, sourceStartUs: 10_017_000, sourceDurationUs: 4_983_000 },
    { binId: "odd", sourceStartUs: 9_000_000, sourceDurationUs: 1_020_000 },
  ],
  [clip, odd],
)
// ids are random, so each is named by where it first appears; the temp folder the fixture went to is left out too
const names = new Map()
const text = JSON.stringify(out)
  .replaceAll(draft.root, "ROOT")
  .replace(/[0-9A-Fa-f]{8}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{12}/g, (id) => {
    if (!names.has(id)) names.set(id, `ID${names.size}`)
    return names.get(id)
  })
console.log(createHash("sha256").update(text).digest("hex"))
EOF
```

  Expected: one 64-character hex hash. (On the code of 2026-09-29 it is `2a6d8cba86d3ea0f205ff10e09d82bdf825932e4abc7034b4a2fd82d00c1051d`.)

- [ ] **Step 2: Write the failing tests.**

  In `rough-cut.test.ts`, the first import line:

```ts
import { test } from "vitest"
```

  becomes:

```ts
import { expect, test } from "vitest"
```

  and the rough-cut import:

```ts
import { buildRoughCut, outputCanvas } from "./rough-cut.ts"
```

  becomes:

```ts
import { atOn, buildRoughCut, cutFrames, outputCanvas } from "./rough-cut.ts"
import { frameToUs } from "./time.ts"
```

  Then append to the end of the file:

```ts
/** The message a call throws, or null when it does not throw. */
function thrown(call: () => unknown): string | null {
  try {
    call()
    return null
  } catch (error) {
    return (error as Error).message
  }
}

test("cutFrames gives each cut its frames and µs, on the timeline and in its file, without a draft", async () => {
  const { bin } = await fixture()
  expect(cutFrames(cuts, bin, 30)).toEqual([
    { cut: 0, binId: CLIP_A, sourceStartUs: 10_000_000, sourceDurationUs: 4_000_000, targetStartUs: 0, targetDurationUs: 4_000_000, targetStartFrame: 0, frames: 120 },
    { cut: 1, binId: CLIP_B.id, sourceStartUs: 1_000_000, sourceDurationUs: 2_500_000, targetStartUs: 4_000_000, targetDurationUs: 2_500_000, targetStartFrame: 120, frames: 75 },
    { cut: 2, binId: CLIP_A, sourceStartUs: 2_000_000, sourceDurationUs: 3_000_000, targetStartUs: 6_500_000, targetDurationUs: 3_000_000, targetStartFrame: 195, frames: 90 },
  ])
})

test("cutFrames snaps to frames the way CapCut does", () => {
  // frames 23..78 @30fps — the exact pair CapCut 9.2 wrote for the same span in a real draft
  expect(cutFrames([{ binId: CLIP_B.id, sourceStartUs: 766_700, sourceDurationUs: 1_833_300 }], [CLIP_B], 30)).toEqual([
    { cut: 0, binId: CLIP_B.id, sourceStartUs: 766_666, sourceDurationUs: 1_833_334, targetStartUs: 0, targetDurationUs: 1_833_333, targetStartFrame: 0, frames: 55 },
  ])
})

test("cutFrames keeps a cut that runs to the end of a file ending between two frames inside the file", () => {
  const odd: BinVideo = { ...CLIP_B, id: "odd", durationUs: 10_020_000 } // 300.6 frames
  expect(cutFrames([{ binId: "odd", sourceStartUs: 9_000_000, sourceDurationUs: 1_020_000 }], [odd], 30)).toEqual([
    { cut: 0, binId: "odd", sourceStartUs: 9_000_000, sourceDurationUs: 1_000_000, targetStartUs: 0, targetDurationUs: 1_000_000, targetStartFrame: 0, frames: 30 },
  ])
})

test("buildRoughCut writes each piece on the frames cutFrames gives it", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  const pieces = cutFrames(cuts, bin, info.fps)
  expect(mainSegments(out).map((segment) => [segment.source_timerange, segment.target_timerange])).toEqual(
    pieces.map((piece) => [
      { start: piece.sourceStartUs, duration: piece.sourceDurationUs },
      { start: piece.targetStartUs, duration: piece.targetDurationUs },
    ]),
  )
  const last = pieces.at(-1)!
  expect(out.duration).toBe(frameToUs(last.targetStartFrame + last.frames, info.fps))
})

test("cutFrames refuses what buildRoughCut refuses, in the same words", async () => {
  const { info, bin } = await fixture()
  const refused: Cut[][] = [
    [],
    [{ binId: "missing", sourceStartUs: 0, sourceDurationUs: 1_000_000 }],
    [{ binId: CLIP_B.id, sourceStartUs: 9_000_000, sourceDurationUs: 2_000_000 }],
    [{ binId: CLIP_B.id, sourceStartUs: 0, sourceDurationUs: 10_000 }],
    // the first cut is fine: the second one's fault is the one reported
    [cuts[0]!, { binId: CLIP_B.id, sourceStartUs: 0, sourceDurationUs: 10_000 }],
  ]
  for (const list of refused) {
    const written = thrown(() => buildRoughCut(info, list, bin))
    expect(written).not.toBeNull()
    expect(thrown(() => cutFrames(list, bin, info.fps))).toBe(written)
  }
})

test("atOn plays a moment of a cut's source where the pieces as written put it, as the write's own reading does", async () => {
  const { info, bin } = await fixture()
  const at = atOn(cutFrames(cuts, bin, info.fps))
  // the second piece starts 4 s into the timeline and 1 s into its file
  expect(at(1, 1_500_000)).toBe(4_500_000)
  const video = mainSegments(buildRoughCut(info, cuts, bin))
  for (const [cut, sourceUs] of [
    [0, 10_000_000],
    [0, 12_345_678],
    [1, 1_000_000],
    [2, 4_999_999],
  ] as const) {
    expect(at(cut, sourceUs)).toBe(video[cut]!.target_timerange.start - video[cut]!.source_timerange!.start + sourceUs)
  }
})

test("atOn counts from where a piece starts in its file once rounded to a frame, not from where the cut asked", () => {
  // 766_700 µs rounds to frame 23, written as 766_666: the moment the cut asked for plays 34 µs into the timeline
  const at = atOn(cutFrames([{ binId: CLIP_B.id, sourceStartUs: 766_700, sourceDurationUs: 1_833_300 }], [CLIP_B], 30))
  expect(at(0, 766_700)).toBe(34)
})

test("atOn refuses a piece that is not there", () => {
  const at = atOn(cutFrames([{ binId: CLIP_B.id, sourceStartUs: 0, sourceDurationUs: 1_000_000 }], [CLIP_B], 30))
  expect(() => at(1, 0)).toThrow(/no piece 1/)
})
```

- [ ] **Step 3: Run the tests and see them fail.**

  Run: `npx vitest run packages/core/src/capcut/rough-cut.test.ts`

  Expected: the 8 new tests FAIL. Seven fail with `TypeError: cutFrames is not a function`; the one that compares errors fails on its assertion, because the message it catches is that TypeError. The 18 tests that were there PASS.

- [ ] **Step 4: Implement.**

  Replace the whole of `packages/core/src/capcut/rough-cut.ts` with the code below. `emptyArrays` and `outputCanvas` are unchanged. The checks and error messages of the old loop move into `cutFrames` word for word, and so does the frame math. `buildRoughCut` keeps only what writes the draft, in the same order as before.

```ts
import { newId, segmentExtras, videoMaterial, videoSegment, videoTrack } from "./templates.ts"
import { frameToUs, usToFrame } from "./time.ts"
import type { BinVideo, Cut, DraftInfo, Segment } from "./types.ts"

function emptyArrays(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Array.isArray(value) ? [] : value]))
}

/** A main piece as buildRoughCut writes it, in frames and in CapCut's µs. */
export interface PieceFrames {
  /** its place in the cuts, which is its segment's place on the main track (`info.tracks[0].segments`) */
  cut: number
  /** the bin item the piece plays */
  binId: string
  /** where the piece starts in its file, as written: `frameToUs` of its first source frame */
  sourceStartUs: number
  sourceDurationUs: number
  /** where the piece starts on the timeline */
  targetStartUs: number
  targetDurationUs: number
  /** the timeline frame the piece starts on */
  targetStartFrame: number
  /** how many frames the piece plays */
  frames: number
}

/**
 * The frames buildRoughCut lays each cut on, without a draft, so what is timed before the write (the preview, the
 * person cutouts) lands on the very frames the write gives it. Throws what buildRoughCut throws, for the same cut.
 *
 * All arithmetic is done in whole frames and converted back at the edges, which
 * reproduces CapCut's own rounding (source 766666+1833334, target 0+1833333 for
 * frames 23..78 @30fps) and keeps target ranges gap-free.
 */
export function cutFrames(cuts: Cut[], bin: BinVideo[], fps: number): PieceFrames[] {
  if (cuts.length === 0) throw new Error("no cuts to write")
  const clips = new Map(bin.map((clip) => [clip.id, clip]))

  const pieces: PieceFrames[] = []
  let cursor = 0
  for (const [index, cut] of cuts.entries()) {
    const clip = clips.get(cut.binId)
    if (!clip) throw new Error(`cut points at "${cut.binId}", which is not a video in the media bin`)
    const endUs = cut.sourceStartUs + cut.sourceDurationUs
    if (endUs > clip.durationUs) {
      throw new Error(`cut on ${clip.name} ends at ${endUs} µs, past the end of the file (${clip.durationUs} µs)`)
    }
    const startFrame = usToFrame(cut.sourceStartUs, fps)
    // rounding up to the nearest frame may step past a file that does not end on a frame
    const endFrame = Math.min(usToFrame(endUs, fps), Math.floor((clip.durationUs * fps) / 1_000_000))
    const frames = endFrame - startFrame
    if (frames < 1) throw new Error(`cut on ${clip.name} at ${cut.sourceStartUs} µs is shorter than one frame`)

    const sourceStartUs = frameToUs(startFrame, fps)
    const targetStartUs = frameToUs(cursor, fps)
    pieces.push({
      cut: index,
      binId: cut.binId,
      sourceStartUs,
      sourceDurationUs: frameToUs(endFrame, fps) - sourceStartUs,
      targetStartUs,
      targetDurationUs: frameToUs(cursor + frames, fps) - targetStartUs,
      targetStartFrame: cursor,
      frames,
    })
    cursor += frames
  }
  return pieces
}

/**
 * Where a moment of a cut's source plays on the timeline once the pieces sit on their frames: as far into its
 * piece as it is from where the piece, as written, starts in its file. What the write calls `at`.
 */
export function atOn(pieces: PieceFrames[]): (cut: number, sourceUs: number) => number {
  return (cut, sourceUs) => {
    const piece = pieces[cut]
    if (!piece) throw new Error(`there is no piece ${cut} on the timeline`)
    return piece.targetStartUs - piece.sourceStartUs + sourceUs
  }
}

/**
 * Replaces the whole timeline with the cuts laid end to end on one video track, each piece on the frames
 * cutFrames gives it. Pure: returns a new DraftInfo and leaves every field it does not own as it was.
 */
export function buildRoughCut(info: DraftInfo, cuts: Cut[], bin: BinVideo[]): DraftInfo {
  const fps = info.fps
  const pieces = cutFrames(cuts, bin, fps)
  const clips = new Map(bin.map((clip) => [clip.id, clip]))

  const out = structuredClone(info)
  const materials = emptyArrays(out.materials)
  const add = (key: string, entry: unknown) => {
    const list = materials[key]
    if (Array.isArray(list)) list.push(entry)
    else materials[key] = [entry]
  }

  const segments: Segment[] = []
  for (const piece of pieces) {
    // one material per segment, never shared: CapCut re-saves a shared one as duplicate entries with one id
    const materialId = newId()
    add("videos", videoMaterial(materialId, clips.get(piece.binId)!))

    const extras = segmentExtras()
    for (const [key, entry] of extras) add(key, entry)

    segments.push(
      videoSegment({
        id: newId(),
        materialId,
        extraRefs: extras.map(([, entry]) => entry.id),
        source: { start: piece.sourceStartUs, duration: piece.sourceDurationUs },
        target: { start: piece.targetStartUs, duration: piece.targetDurationUs },
      }),
    )
  }
  const last = pieces.at(-1)!

  out.materials = materials
  out.keyframes = emptyArrays(out.keyframes)
  out.tracks = [videoTrack(newId(), segments)]
  out.duration = frameToUs(last.targetStartFrame + last.frames, fps)
  if (Array.isArray(out.relationships)) out.relationships = []
  if ("group_container" in out) out.group_container = null

  out.canvas_config = { ...out.canvas_config, ...outputCanvas(out, clips.get(cuts[0]!.binId)!) }
  return out
}

/** The size the rough cut plays at: an "original" ratio canvas follows the first clip. */
export function outputCanvas(info: DraftInfo, first: BinVideo): { width: number; height: number } {
  return info.canvas_config.ratio === "original"
    ? { width: first.width, height: first.height }
    : { width: info.canvas_config.width, height: info.canvas_config.height }
}
```

- [ ] **Step 5: Run the tests and see them pass, then check the fingerprint.**

  Run: `npx vitest run packages/core/src/capcut`

  Expected: PASS, with 26 tests in `rough-cut.test.ts`.

  Run the script from Step 1 again. Expected: the same hash as in Step 1. If it differs, the refactor changed what CapCut gets: compare the two outputs before going on.

- [ ] **Step 6: Commit.** Run `npm test` and `npm run typecheck` from the repo root. Both must be clean.
  - No caller changes in this task. `apps/desktop/src/main/timeline.ts` still reads its own `at` off the written segments (:449); `atOn` answers the same (a test above checks it), and main starts using `cutFrames`/`atOn` in later tasks.

---

### Task 2: Where each behind group's person goes (`cutoutRanges`)

**Files:**
- Create: `packages/core/src/cutout/ranges.ts`
- Test: `packages/core/src/cutout/ranges.test.ts`

Why: a range is the part of one behind group's visible window that lies on one main piece (spec §6.1, §9.2). Every person file, its job and its hash come from ranges, in the preview and in the write, so there must be exactly one function that makes them. It rounds a group's edges the way `addHighlightTracks` rounds the group's first line (`packages/core/src/capcut/highlights.ts:158-166`): start `usToFrame(startUs)`, end `min(usToFrame(endUs), usToFrame(timeline duration))`. The pieces are Task 1's `cutFrames` output.

`packages/core/src/cutout/` is a new folder. Its `index.ts` comes in Task 6.

- [ ] **Step 1: Write the failing test.**

  Create `packages/core/src/cutout/ranges.test.ts`:

```ts
import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { addHighlightTracks, type HighlightLook } from "../capcut/highlights.ts"
import { binVideos, loadDraft } from "../capcut/read.ts"
import { buildRoughCut, cutFrames } from "../capcut/rough-cut.ts"
import type { BinVideo } from "../capcut/types.ts"
import { cutoutRanges } from "./ranges.ts"

const CLIP: BinVideo = { id: "clip", path: "/footage/talk.mov", name: "talk.mov", durationUs: 60_000_000, width: 1080, height: 1920 }

/** 0–4 s of the timeline plays 10–14 s of the file; 4–6.5 s plays 1–3.5 s of it. */
const pieces = cutFrames(
  [
    { binId: "clip", sourceStartUs: 10_000_000, sourceDurationUs: 4_000_000 },
    { binId: "clip", sourceStartUs: 1_000_000, sourceDurationUs: 2_500_000 },
  ],
  [CLIP],
  30,
)
const DURATION_US = 6_500_000

const group = (groupId: string, startUs: number, endUs: number) => ({ groupId, startUs, endUs })

test("a group inside one piece is one range, on the piece's frames and at the same place in its file", () => {
  expect(cutoutRanges([group("g", 1_000_000, 2_000_000)], pieces, 30, DURATION_US)).toEqual([
    { groupId: "g", cut: 0, targetStartFrame: 30, frames: 30, targetStartUs: 1_000_000, targetDurationUs: 1_000_000, sourceStartUs: 11_000_000 },
  ])
  // frame 31 starts at 1_033_333 µs, floored as CapCut stores it: the range's µs come from its frames
  expect(cutoutRanges([group("g", 1_033_333, 1_100_000)], pieces, 30, DURATION_US)).toEqual([
    { groupId: "g", cut: 0, targetStartFrame: 31, frames: 2, targetStartUs: 1_033_333, targetDurationUs: 66_667, sourceStartUs: 11_033_333 },
  ])
})

test("a group across a cut is a range on each piece, the second starting where its piece starts in its file", () => {
  expect(cutoutRanges([group("g", 3_500_000, 5_000_000)], pieces, 30, DURATION_US)).toEqual([
    { groupId: "g", cut: 0, targetStartFrame: 105, frames: 15, targetStartUs: 3_500_000, targetDurationUs: 500_000, sourceStartUs: 13_500_000 },
    { groupId: "g", cut: 1, targetStartFrame: 120, frames: 30, targetStartUs: 4_000_000, targetDurationUs: 1_000_000, sourceStartUs: 1_000_000 },
  ])
})

test("a piece a group only grazes, by less than a frame, gets no range", () => {
  // the group ends 10 ms into the second piece: its end rounds to frame 120, where that piece starts
  expect(cutoutRanges([group("g", 3_000_000, 4_010_000)], pieces, 30, DURATION_US).map((range) => [range.cut, range.frames])).toEqual([[0, 30]])
  // it starts 10 ms before the cut: its start rounds to frame 120, and the first piece has nothing of it
  expect(cutoutRanges([group("g", 3_990_000, 5_000_000)], pieces, 30, DURATION_US).map((range) => [range.cut, range.frames])).toEqual([[1, 30]])
  // a group with no whole frame at all has no range
  expect(cutoutRanges([group("g", 2_000_000, 2_010_000)], pieces, 30, DURATION_US)).toEqual([])
})

test("a group that runs past the end of the timeline stops at its end, and one that starts after it has no range", () => {
  expect(cutoutRanges([group("g", 6_000_000, 9_000_000)], pieces, 30, DURATION_US)).toEqual([
    { groupId: "g", cut: 1, targetStartFrame: 180, frames: 15, targetStartUs: 6_000_000, targetDurationUs: 500_000, sourceStartUs: 3_000_000 },
  ])
  expect(cutoutRanges([group("g", 7_000_000, 8_000_000)], pieces, 30, DURATION_US)).toEqual([])
})

test("the ranges come in the order they play, whatever order the groups came in", () => {
  const ranges = cutoutRanges([group("late", 5_000_000, 6_000_000), group("across", 3_500_000, 4_500_000), group("early", 0, 1_000_000)], pieces, 30, DURATION_US)
  expect(ranges.map((range) => [range.groupId, range.cut, range.targetStartFrame])).toEqual([
    ["early", 0, 0],
    ["across", 0, 105],
    ["across", 1, 120],
    ["late", 1, 150],
  ])
})

const LOOK: HighlightLook = {
  fontPath: "/fonts/x.ttf",
  strokeWidth: 0.08,
  barRoundness: 20,
  palette: { text: [1, 1, 1], accent: [1, 0, 0], alt: [0, 0, 1], bar: [1, 1, 0] },
  animation: null,
}

test("a group's ranges cover exactly the frames addHighlightTracks gives the group's first line", async () => {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  const bin = binVideos(draft.meta)
  // the first piece ends 10 ms past a frame and the second starts 17 ms past one, so neither cut sits on the µs asked
  const cuts = [
    { binId: bin[0]!.id, sourceStartUs: 0, sourceDurationUs: 4_010_000 },
    { binId: bin[0]!.id, sourceStartUs: 10_017_000, sourceDurationUs: 5_000_000 },
  ]
  const info = buildRoughCut(draft.info, cuts, bin)
  const groups = [
    // across the cut at frame 120, neither edge on a frame
    group("across", 1_987_654, 4_523_456),
    // past the end of the timeline (9 s)
    group("past-end", 8_123_456, 9_876_543),
    // no whole frame: the text writer leaves it out, and so do the ranges
    group("no-frame", 5_000_000, 5_010_000),
  ]
  const drawn = addHighlightTracks(info, groups.map((entry) => ({ endUs: entry.endUs, lines: [{ startUs: entry.startUs, text: "ข้อความ", y: 0.72, scale: 1 }] })), LOOK)
  const lineZero = drawn.tracks.filter((track) => track.type === "text")[0]!.segments.map((segment) => segment.target_timerange)

  const ranges = cutoutRanges(groups, cutFrames(cuts, bin, info.fps), info.fps, info.duration)
  const spans = groups.flatMap(({ groupId }) => {
    const own = ranges.filter((range) => range.groupId === groupId)
    if (own.length === 0) return []
    const last = own.at(-1)!
    return [{ start: own[0]!.targetStartUs, duration: last.targetStartUs + last.targetDurationUs - own[0]!.targetStartUs }]
  })
  expect(spans).toEqual(lineZero)
  expect(ranges.filter((range) => range.groupId === "across").map((range) => range.cut)).toEqual([0, 1])
})
```

- [ ] **Step 2: Run the test and see it fail.**

  Run: `npx vitest run packages/core/src/cutout/ranges.test.ts`

  Expected: FAIL with `Error: Cannot find module './ranges.ts'`.

- [ ] **Step 3: Implement.**

  Create `packages/core/src/cutout/ranges.ts`:

```ts
import type { PieceFrames } from "../capcut/rough-cut.ts"
import { frameToUs, usToFrame } from "../capcut/time.ts"

/** The part of one behind group's visible window that lies on one main piece, on whole frames of the draft. */
export interface CutoutRange {
  groupId: string
  /** the main piece it lies on: its place in the cuts and on the main track */
  cut: number
  /** the timeline frame it starts on */
  targetStartFrame: number
  /** how many frames it lasts; at least one */
  frames: number
  /** frameToUs(targetStartFrame) */
  targetStartUs: number
  /** frameToUs(targetStartFrame + frames) − targetStartUs */
  targetDurationUs: number
  /** where the piece's file is at the range's first frame: the piece's own source start plus how far into the piece the range starts */
  sourceStartUs: number
}

/**
 * Behind groups' visible windows split per main piece, on frames exactly as addHighlightTracks draws line 0:
 * start = usToFrame(group.startUs), end = min(usToFrame(group.endUs), usToFrame(durationUs)). Overlaps shorter
 * than one frame are left out (the caller counts them as dropped.cutouts). Sorted by targetStartFrame.
 *
 * Every person file, its job and its hash come from these ranges, in the preview and in the write alike, so both
 * ask for the same files. The pieces are the ones cutFrames gives (buildRoughCut's own frames), and a group comes
 * in µs of the timeline those pieces make, as the write times its text.
 */
export function cutoutRanges(groups: { groupId: string; startUs: number; endUs: number }[], pieces: PieceFrames[], fps: number, durationUs: number): CutoutRange[] {
  const lastFrame = usToFrame(durationUs, fps)
  const ranges: CutoutRange[] = []
  for (const group of groups) {
    const startFrame = usToFrame(group.startUs, fps)
    const endFrame = Math.min(usToFrame(group.endUs, fps), lastFrame)
    for (const piece of pieces) {
      const from = Math.max(startFrame, piece.targetStartFrame)
      const to = Math.min(endFrame, piece.targetStartFrame + piece.frames)
      // a piece the window misses, or only grazes by less than a frame, has nothing to cut out
      if (to - from < 1) continue
      const targetStartUs = frameToUs(from, fps)
      ranges.push({
        groupId: group.groupId,
        cut: piece.cut,
        targetStartFrame: from,
        frames: to - from,
        targetStartUs,
        targetDurationUs: frameToUs(to, fps) - targetStartUs,
        sourceStartUs: piece.sourceStartUs + (targetStartUs - piece.targetStartUs),
      })
    }
  }
  return ranges.sort((a, b) => a.targetStartFrame - b.targetStartFrame)
}
```

- [ ] **Step 4: Run the test and see it pass.**

  Run: `npx vitest run packages/core/src/cutout/ranges.test.ts`

  Expected: PASS (6 tests).

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 3: Which source frame each person frame holds (`evenFrames`, `shownSourceFrame`, `personFrames`)

**Files:**
- Create: `packages/core/src/cutout/frames.ts`
- Test: `packages/core/src/cutout/frames.test.ts`

Why (spec §7.2 step 1; measured 2026-09-29 with a barcode file and two exports of 0917):
- CapCut asks a video segment, on every timeline frame n, for the source moment `source.start + (frameToUs(n) − target.start)`.
- In a file whose frames are all one step apart (our ProRes files), it shows the first frame at or after that moment, within about 1 µs. In a file with uneven steps (iPhone sources: 20 ticks at 1/600, with a few 21-tick steps), it shows the latest frame at or before it, within about 1 µs.
- So a person file is built one frame per timeline frame. File frame j + 1 is the source frame the main piece shows on the range's frame j, and frame 0 is a spare copy of frame 1. The file is exactly even (pts 20·n at 1/600), and its segment starts `PERSON_SOURCE_START_US` (16,667 µs) into it, so every timeline frame asks for the middle of the gap before the frame it should get.
- This matched all 230 frames measured on the main layer and all the frames of the person layer built from it.

The tests use numbers only: the 0917 source's timing is written as a formula, and no picture of the user goes into the repo. Tasks 1 and 2 must be in place: the tests build their pieces with `cutFrames` and their ranges with `cutoutRanges`.

- [ ] **Step 1: Write the failing test.**

  Create `packages/core/src/cutout/frames.test.ts`:

```ts
import { expect, test } from "vitest"
import { cutFrames } from "../capcut/rough-cut.ts"
import { frameToUs } from "../capcut/time.ts"
import type { BinVideo } from "../capcut/types.ts"
import { evenFrames, personFrames, PERSON_SOURCE_START_US, shownSourceFrame, type SourceTiming } from "./frames.ts"
import { cutoutRanges } from "./ranges.ts"

/**
 * The 0917 source (IMG_9646.MOV) as AVFoundation reads it: 933 frames at 1/600, 20 ticks apart but for four steps
 * of 21 ticks. Numbers only: no picture of the user goes into the repo.
 */
const IMG_9646: SourceTiming = {
  timescale: 600,
  pts: Array.from({ length: 933 }, (_, i) => 20 * i + Number(i >= 104) + Number(i >= 313) + Number(i >= 523) + Number(i >= 732)),
}
const SOURCE: BinVideo = { id: "img-9646", path: "/footage/IMG_9646.MOV", name: "IMG_9646.MOV", durationUs: 31_106_000, width: 1080, height: 1920 }

/** A constant-rate file of `frames` frames at 30 fps, as BOXBLACK's own ProRes files are. */
const even = (frames: number): SourceTiming => ({ timescale: 600, pts: Array.from({ length: frames }, (_, n) => 20 * n) })

test("a file whose frames are all one step apart is even; the 0917 source, with four longer steps, is not", () => {
  expect(evenFrames(even(300))).toBe(true)
  expect(evenFrames(IMG_9646)).toBe(false)
  // even for 30 frames, then one step a tick longer
  expect(evenFrames({ timescale: 600, pts: [...even(30).pts, 30 * 20 + 1] })).toBe(false)
  // no step, or one, is one step throughout
  expect(evenFrames({ timescale: 600, pts: [] })).toBe(true)
  expect(evenFrames({ timescale: 600, pts: [0] })).toBe(true)
  expect(evenFrames({ timescale: 600, pts: [0, 21] })).toBe(true)
})

/**
 * The main pieces as the 0.4.2 test write laid them on 0917. Pieces 2 and 4 were measured nowhere, so they are
 * made up here with the lengths that put pieces 3 and 5 where they were.
 */
const pieces = cutFrames(
  [
    { binId: SOURCE.id, sourceStartUs: 1_800_000, sourceDurationUs: 5_433_333 },
    { binId: SOURCE.id, sourceStartUs: 7_300_000, sourceDurationUs: 3_333_333 },
    { binId: SOURCE.id, sourceStartUs: 12_000_000, sourceDurationUs: 2_733_333 },
    { binId: SOURCE.id, sourceStartUs: 15_900_000, sourceDurationUs: 4_000_000 },
    { binId: SOURCE.id, sourceStartUs: 20_500_000, sourceDurationUs: 2_866_667 },
    { binId: SOURCE.id, sourceStartUs: 26_633_333, sourceDurationUs: 2_000_000 },
  ],
  [SOURCE],
  30,
)

/** What CapCut showed on the main layer of exports 0917-5 and 0917-behind2, frame by frame: the first and last of each run. */
const MEASURED = [
  { name: "r0", cut: 0, timeline: [6, 46], source: [60, 100] },
  { name: "g1a", cut: 0, timeline: [94, 162], source: [147, 215] },
  { name: "g1b", cut: 1, timeline: [163, 174], source: [218, 229] },
  { name: "g3a", cut: 3, timeline: [373, 436], source: [504, 567] },
  { name: "g5a", cut: 5, timeline: [555, 598], source: [802, 845] },
] as const

test("the pieces the frames were measured on start where the 0.4.2 test write laid them", () => {
  expect([0, 1, 3, 5].map((cut) => [pieces[cut]!.targetStartUs, pieces[cut]!.sourceStartUs])).toEqual([
    [0, 1_800_000],
    [5_433_333, 7_300_000],
    [11_500_000, 15_900_000],
    [18_366_666, 26_633_333],
  ])
})

test("an uneven source shows the latest frame at or before the moment asked: all 230 frames CapCut showed on 0917", () => {
  for (const run of MEASURED) {
    const piece = pieces[run.cut]!
    for (let n = run.timeline[0]; n <= run.timeline[1]; n++) {
      const askedUs = piece.sourceStartUs + (frameToUs(n, 30) - piece.targetStartUs)
      expect(shownSourceFrame(IMG_9646, askedUs), `${run.name} at timeline frame ${n}`).toBe(run.source[0] + (n - run.timeline[0]))
    }
  }
  expect(MEASURED.reduce((sum, run) => sum + run.timeline[1] - run.timeline[0] + 1, 0)).toBe(230)
})

test("a person file holds a spare copy of its first frame, then the frame the main piece shows on each frame of its range", () => {
  // the groups over those runs, timed in µs of the timeline as the write times its text
  const groups = [
    { groupId: "r0", startUs: frameToUs(6, 30), endUs: frameToUs(47, 30) },
    { groupId: "g1", startUs: frameToUs(94, 30), endUs: frameToUs(175, 30) },
    { groupId: "g3", startUs: frameToUs(373, 30), endUs: frameToUs(437, 30) },
    { groupId: "g5", startUs: frameToUs(555, 30), endUs: frameToUs(599, 30) },
  ]
  const last = pieces.at(-1)!
  const ranges = cutoutRanges(groups, pieces, 30, frameToUs(last.targetStartFrame + last.frames, 30))
  // g1 crosses the cut between pieces 0 and 1: two ranges, as the proof had them
  expect(ranges.map((range) => [range.cut, range.targetStartFrame, range.frames])).toEqual(
    MEASURED.map((run) => [run.cut, run.timeline[0], run.timeline[1] - run.timeline[0] + 1]),
  )
  for (const [i, range] of ranges.entries()) {
    const run = MEASURED[i]!
    const frames = personFrames(range, pieces[range.cut]!, IMG_9646, 30)
    const main = Array.from({ length: range.frames }, (_, j) => run.source[0] + j)
    expect(frames, run.name).toEqual([main[0], ...main])
    expect(frames).toHaveLength(range.frames + 1)
  }
})

test("an even file shows the first frame at or after the moment asked: CapCut's calibration export", () => {
  const barcode = even(300)
  // what a segment starting on timeline frame `targetStartUs` and `sourceStartUs` into the file shows on frame n
  const shown = (targetStartUs: number, sourceStartUs: number, n: number) => shownSourceFrame(barcode, sourceStartUs + frameToUs(n, 30) - targetStartUs)
  for (let k = 0; k < 90; k++) {
    // the segment starts on timeline frame 30 (1 s)
    expect(shown(1_000_000, 0, 30 + k)).toBe(k)
    for (const sourceStartUs of [5_000, 10_000, 16_667, 25_000, 30_000]) expect(shown(1_000_000, sourceStartUs, 30 + k)).toBe(k + 1)
    // and on timeline frame 31, whose start is not a whole number of µs: without the 1 µs of slack frame 2 would show as 3
    expect(shown(1_033_333, 0, 31 + k)).toBe(k)
    expect(shown(1_033_333, 16_667, 31 + k)).toBe(k + 1)
  }
})

test("a person file laid PERSON_SOURCE_START_US into itself shows its frame j + 1 on its range's frame j, wherever the range starts", () => {
  for (const targetStartFrame of [0, 6, 31, 163, 555, 1_000]) {
    const frames = 45
    const file = even(frames + 1)
    const targetStartUs = frameToUs(targetStartFrame, 30)
    for (let j = 0; j < frames; j++) {
      expect(shownSourceFrame(file, PERSON_SOURCE_START_US + frameToUs(targetStartFrame + j, 30) - targetStartUs)).toBe(j + 1)
    }
  }
})

test("a frame a microsecond to the far side of the moment asked still counts: CapCut's choice has that much slack", () => {
  // frame 3 of both files is at exactly 100_000 µs (60 ticks)
  expect(shownSourceFrame(IMG_9646, 99_999)).toBe(3)
  expect(shownSourceFrame(even(10), 100_001)).toBe(3)
})

test("a moment before the first frame or past the last gets the first or the last frame", () => {
  expect(shownSourceFrame(IMG_9646, -50_000)).toBe(0)
  expect(shownSourceFrame(IMG_9646, 99_000_000)).toBe(932)
  expect(shownSourceFrame(even(10), -50_000)).toBe(0)
  expect(shownSourceFrame(even(10), 99_000_000)).toBe(9)
  expect(() => shownSourceFrame({ timescale: 600, pts: [] }, 0)).toThrow(/no frames/)
})

test("personFrames refuses a piece other than the range's", () => {
  const [range] = cutoutRanges([{ groupId: "g", startUs: 200_000, endUs: 1_566_666 }], pieces, 30, 20_000_000)
  expect(() => personFrames(range!, pieces[1]!, IMG_9646, 30)).toThrow(/piece 0 was given piece 1/)
})
```

- [ ] **Step 2: Run the test and see it fail.**

  Run: `npx vitest run packages/core/src/cutout/frames.test.ts`

  Expected: FAIL with `Error: Cannot find module './frames.ts'`.

- [ ] **Step 3: Implement.**

  Create `packages/core/src/cutout/frames.ts`. Both searches are binary searches over `pts`, which is in presentation order and so ascending. `personFrames` works out the file's kind once rather than once per frame.

```ts
import type { PieceFrames } from "../capcut/rough-cut.ts"
import { frameToUs } from "../capcut/time.ts"
import type { CutoutRange } from "./ranges.ts"

/**
 * The person segment's source.start: every timeline frame asks for the middle of the gap before its frame (spec §7.2).
 * A person file is exactly even (pts 20·n at 1/600), where CapCut shows the first frame at or after the moment asked,
 * so asking 16.7 ms in on the range's first timeline frame lands between file frames 0 and 1 and gets frame 1, and
 * every later timeline frame j gets file frame j + 1 the same way, 16.7 ms from either edge, where no rounding of
 * CapCut's can move it (0917, 2026-09-29: 230 of 230 frames matched the main layer).
 */
export const PERSON_SOURCE_START_US = 16_667
/** bumped whenever the frame rule, the mask filter or the encode changes; part of every cutout hash */
export const CUTOUT_PIPELINE_VERSION = 1

export interface SourceTiming {
  /** the video track's timescale (ticks per second); CapCut and AVFoundation agree on it */
  timescale: number
  /** every frame's presentation time in ticks, in presentation order */
  pts: number[]
}

/** true when every step between consecutive pts is the same (CapCut then rounds up; otherwise down) */
export function evenFrames(timing: SourceTiming): boolean {
  const { pts } = timing
  for (let i = 2; i < pts.length; i++) {
    if (pts[i]! - pts[i - 1]! !== pts[1]! - pts[0]!) return false
  }
  return true
}

/** shownSourceFrame with the file's kind worked out once, for a caller that asks about many moments of one file */
function shownFrame(timing: SourceTiming, even: boolean, askedUs: number): number {
  const { pts, timescale } = timing
  if (pts.length === 0) throw new Error("the source has no frames")
  const usOf = (index: number) => (pts[index]! * 1_000_000) / timescale
  let low = 0
  let high = pts.length - 1
  if (even) {
    // the first frame at or after the moment asked, within a microsecond; the last frame when none is
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (usOf(middle) >= askedUs - 1) high = middle
      else low = middle + 1
    }
    return low
  }
  // the latest frame at or before the moment asked, within a microsecond; the first frame when none is
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (usOf(middle) <= askedUs + 1) low = middle
    else high = middle - 1
  }
  return low
}

/**
 * The source frame (index into pts) CapCut shows when a piece asks for `askedUs` (spec §7.2 step 1, proven
 * 2026-09-29): uneven files → the latest frame with ptsUs ≤ askedUs + 1; even files → the first frame with
 * ptsUs ≥ askedUs − 1. ptsUs = pts × 1e6 / timescale (not rounded). Clamped to [0, pts.length − 1].
 */
export function shownSourceFrame(timing: SourceTiming, askedUs: number): number {
  return shownFrame(timing, evenFrames(timing), askedUs)
}

/**
 * The source frames a person file holds, in file order: frame 0 a spare copy of frame 1, then for every timeline
 * frame n of the range the frame the main piece shows there, asked at piece.sourceStartUs + (frameToUs(n) −
 * piece.targetStartUs). Length = range.frames + 1.
 *
 * The list is the whole of the file's timing: its pictures and the masks Vision sees are both made from it, so they
 * match by construction, and a source that repeats or skips a frame (one not at 30 fps) repeats or skips it here too.
 */
export function personFrames(range: CutoutRange, piece: PieceFrames, timing: SourceTiming, fps: number): number[] {
  if (range.cut !== piece.cut) throw new Error(`range on piece ${range.cut} was given piece ${piece.cut}`)
  const even = evenFrames(timing)
  const shown: number[] = []
  for (let n = range.targetStartFrame; n < range.targetStartFrame + range.frames; n++) {
    shown.push(shownFrame(timing, even, piece.sourceStartUs + (frameToUs(n, fps) - piece.targetStartUs)))
  }
  if (shown.length === 0) throw new Error("a range with no frame has no person file")
  return [shown[0]!, ...shown]
}
```

- [ ] **Step 4: Run the test and see it pass.**

  Run: `npx vitest run packages/core/src/cutout`

  Expected: PASS (9 tests in `frames.test.ts`).

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 4: The main piece's zoom on the person (`valueAt`, `personKeyframes`, `copiedKeyframes`)

**Files:**
- Create: `packages/core/src/cutout/keyframes.ts`
- Test: `packages/core/src/cutout/keyframes.test.ts`

Why (spec §9.3):
- The person layer must zoom exactly as the main piece under it does, or the two pictures part while the piece zooms.
- A video segment's keyframe `time_offset` is a time in its source file (`packages/core/src/capcut/zoom.ts:62-71`).
  - Our route: the person segment plays our own file, whose range starts `PERSON_SOURCE_START_US` in. The main piece's keys are moved by `offsetUs = range.sourceStartUs − PERSON_SOURCE_START_US`. Keys at the range's two edges carry the zoom's value there, and only the keys strictly inside the range are kept.
  - The CapCut route: the copy plays the piece's own file at the piece's own times, so the keys are copied as they are.
- Both routes put new ids on every list and every key.

The tests read real keys: they run `addZooms` on the fixture draft, so the key shape is the zoom writer's own. `PERSON_SOURCE_START_US` comes from Task 3.

- [ ] **Step 1: Write the failing test.**

  Create `packages/core/src/cutout/keyframes.test.ts`:

```ts
import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { binVideos, loadDraft } from "../capcut/read.ts"
import { buildRoughCut } from "../capcut/rough-cut.ts"
import type { Keyframes } from "../capcut/types.ts"
import { addZooms, type TimelineZoom } from "../capcut/zoom.ts"
import { PERSON_SOURCE_START_US } from "./frames.ts"
import { copiedKeyframes, personKeyframes, valueAt } from "./keyframes.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/**
 * The zoom keys the app writes, straight from addZooms on the fixture draft (30 fps): piece 0 plays 0–4 s of its file
 * with a punch landing 1 s in, piece 1 plays 10–15 s with a drift. Keys are timed in each piece's file.
 */
async function zoomKeys(driftUs = 5_000_000): Promise<{ punch: Keyframes[]; drift: Keyframes[] }> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  const info = buildRoughCut(
    draft.info,
    [
      { binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 4_000_000 },
      { binId: CLIP_A, sourceStartUs: 10_000_000, sourceDurationUs: 5_000_000 },
    ],
    binVideos(draft.meta),
  )
  const zooms: TimelineZoom[] = [
    { cut: 0, kind: "punch", atUs: 1_000_000, durationUs: 4_000_000, faceY: 0.4 },
    { cut: 1, kind: "drift", atUs: 0, durationUs: driftUs, faceY: -0.2 },
  ]
  const [punched, drifting] = addZooms(info, zooms).info.tracks[0]!.segments
  return { punch: punched!.common_keyframes!, drift: drifting!.common_keyframes! }
}

/** Each list's keys as [time, value], by property. */
const keysOf = (lists: Keyframes[]) => Object.fromEntries(lists.map((list) => [list.property_type, list.keyframe_list.map((key) => [key.time_offset, key.values[0]!])]))
/** The lists without their ids, to compare what they say. */
const withoutIds = (lists: Keyframes[]) => lists.map(({ id: _id, ...list }) => ({ ...list, keyframe_list: list.keyframe_list.map(({ id: _key, ...key }) => key) }))
/** Where a moment of the main piece's file lands in a person file whose range starts `sourceStartUs` into it. */
const offsetFor = (sourceStartUs: number) => sourceStartUs - PERSON_SOURCE_START_US

test("valueAt holds the first key's value before it and the last's after it, and runs straight between", async () => {
  const { punch } = await zoomKeys()
  const scale = punch.find((list) => list.property_type === "KFTypeScaleX")!.keyframe_list
  // keys: 0 → 1, 1 s → 1, 1.35 s → 1.15
  expect(valueAt(scale, -5)).toBe(1)
  expect(valueAt(scale, 500_000)).toBe(1)
  expect(valueAt(scale, 1_000_000)).toBe(1)
  expect(valueAt(scale, 1_175_000)).toBeCloseTo(1.075, 12)
  expect(valueAt(scale, 1_350_000)).toBe(1.15)
  expect(valueAt(scale, 9_000_000)).toBe(1.15)
  // keys out of order read the same
  expect(valueAt([...scale].reverse(), 1_175_000)).toBeCloseTo(1.075, 12)
  expect(() => valueAt([], 0)).toThrow(/no keys/)
})

test("a range that starts after a punch has landed holds the punch's value, with keys only at its edges", async () => {
  const { punch } = await zoomKeys()
  // 2–3 s of piece 0's file: the punch landed at 1.35 s
  const range = { sourceStartUs: 2_000_000, durationUs: 1_000_000 }
  const person = personKeyframes(punch, range, offsetFor(range.sourceStartUs))
  expect(keysOf(person)).toEqual({
    KFTypeScaleX: [
      [16_667, 1.15],
      [1_016_667, 1.15],
    ],
    KFTypePositionX: [
      [16_667, 0],
      [1_016_667, 0],
    ],
    KFTypePositionY: [
      [16_667, 0.4 * (1 - 1.15)],
      [1_016_667, 0.4 * (1 - 1.15)],
    ],
  })
  // the CapCut route's copy plays the piece's own file: every key as it is
  expect(withoutIds(copiedKeyframes(punch))).toEqual(withoutIds(punch))
})

test("a range inside a drift starts where the drift has got to and ends where it gets to by then", async () => {
  const { drift } = await zoomKeys()
  // 11–13 s of piece 1's file: the drift runs from 1 at 10 s to 1.08 at 15 s
  const range = { sourceStartUs: 11_000_000, durationUs: 2_000_000 }
  const scale = keysOf(personKeyframes(drift, range, offsetFor(range.sourceStartUs))).KFTypeScaleX!
  expect(scale.map(([time]) => time)).toEqual([16_667, 2_016_667])
  expect(scale[0]![1]).toBeCloseTo(1 + 0.08 * 0.2, 12)
  expect(scale[1]![1]).toBeCloseTo(1 + 0.08 * 0.6, 12)
  expect(withoutIds(copiedKeyframes(drift))).toEqual(withoutIds(drift))
})

test("a range that ends while a punch is still rising keeps the key inside it and ends partway up", async () => {
  const { punch } = await zoomKeys()
  // 0.5–1.2 s of piece 0's file: the punch starts rising at 1 s and would land at 1.35 s
  const range = { sourceStartUs: 500_000, durationUs: 700_000 }
  const keys = keysOf(personKeyframes(punch, range, offsetFor(range.sourceStartUs)))
  expect(keys.KFTypeScaleX!.map(([time]) => time)).toEqual([16_667, 516_667, 716_667])
  expect(keys.KFTypeScaleX!.slice(0, 2).map(([, value]) => value)).toEqual([1, 1])
  expect(keys.KFTypeScaleX![2]![1]).toBeCloseTo(1 + 0.15 * (200_000 / 350_000), 12)
  expect(keys.KFTypePositionY![2]![1]).toBeCloseTo(0.4 * (1 - 1.15) * (200_000 / 350_000), 12)
  expect(withoutIds(copiedKeyframes(punch))).toEqual(withoutIds(punch))
})

test("a range at the end of a piece under a drift whose last key sits past the piece's end stops at the range's end", async () => {
  // the app times a zoom on the cut's own length, not its frames, so its last key can sit a few ms past the piece's
  // end (about 7 ms on 0917): here 15.007 s against a piece that ends at 15 s
  const { drift } = await zoomKeys(5_007_000)
  const range = { sourceStartUs: 14_000_000, durationUs: 1_000_000 }
  const scale = keysOf(personKeyframes(drift, range, offsetFor(range.sourceStartUs))).KFTypeScaleX!
  // no key past the person segment's end, and the value there is the drift's by then, not its last key's
  expect(scale.map(([time]) => time)).toEqual([16_667, 1_016_667])
  expect(scale[0]![1]).toBeCloseTo(1 + (0.08 * 4_000_000) / 5_007_000, 12)
  expect(scale[1]![1]).toBeCloseTo(1 + (0.08 * 5_000_000) / 5_007_000, 12)
  // the copy keeps the key past the end: it plays the same file at the same times as the piece does
  const copied = copiedKeyframes(drift)
  expect(keysOf(copied).KFTypeScaleX!.map(([time]) => time)).toEqual([10_000_000, 15_007_000])
  expect(withoutIds(copied)).toEqual(withoutIds(drift))
})

test("both routes give every list and every key a new id, in the zoom writer's own key shape, and leave the piece's keys alone", async () => {
  const { punch } = await zoomKeys()
  const before = structuredClone(punch)
  const mainIds = new Set(punch.flatMap((list) => [list.id, ...list.keyframe_list.map((key) => key.id)]))
  for (const lists of [personKeyframes(punch, { sourceStartUs: 500_000, durationUs: 700_000 }, offsetFor(500_000)), copiedKeyframes(punch)]) {
    const ids = lists.flatMap((list) => [list.id, ...list.keyframe_list.map((key) => key.id)])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(mainIds.has(id)).toBe(false)
      expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/)
    }
    expect(lists.map((list) => list.property_type)).toEqual(["KFTypeScaleX", "KFTypePositionX", "KFTypePositionY"])
    for (const list of lists) {
      expect(list.material_id).toBe("")
      for (const key of list.keyframe_list) expect(Object.keys(key)).toEqual(Object.keys(punch[0]!.keyframe_list[0]!))
    }
  }
  expect(punch).toEqual(before)
})

test("a piece with no zoom gives no keys on either route", () => {
  expect(personKeyframes([], { sourceStartUs: 2_000_000, durationUs: 1_000_000 }, offsetFor(2_000_000))).toEqual([])
  expect(copiedKeyframes([])).toEqual([])
})
```

- [ ] **Step 2: Run the test and see it fail.**

  Run: `npx vitest run packages/core/src/cutout/keyframes.test.ts`

  Expected: FAIL with `Error: Cannot find module './keyframes.ts'`.

- [ ] **Step 3: Implement.**

  Create `packages/core/src/cutout/keyframes.ts`:

```ts
import { newId } from "../capcut/templates.ts"
import type { KeyframePoint, Keyframes } from "../capcut/types.ts"

const inTimeOrder = (keys: KeyframePoint[]) => [...keys].sort((a, b) => a.time_offset - b.time_offset)

/**
 * a key list's value at t: the first key's before it, the last key's after it, straight lines between. CapCut holds
 * a property at its first and last keys' values outside them, and the zoom writes every key as a "Line" curve.
 */
export function valueAt(keys: KeyframePoint[], t: number): number {
  const sorted = inTimeOrder(keys)
  const first = sorted[0]
  if (!first) throw new Error("a key list with no keys has no value")
  if (t <= first.time_offset) return first.values[0]!
  const next = sorted.findIndex((key) => key.time_offset > t)
  if (next < 0) return sorted.at(-1)!.values[0]!
  const a = sorted[next - 1]!
  const b = sorted[next]!
  return a.values[0]! + ((b.values[0]! - a.values[0]!) * (t - a.time_offset)) / (b.time_offset - a.time_offset)
}

/**
 * The main piece's zoom on our person file (spec §9.3): per list a key at the range's source start and end with
 * valueAt there, plus every key strictly inside, all shifted by −offsetUs (offsetUs = range.sourceStartUs −
 * PERSON_SOURCE_START_US); new ids on every list and key; [] when the piece has none.
 *
 * A key's time is where the segment's source file is (zoom.ts): the main piece's file is the source, the person's is
 * our own file, which starts its range's first frame PERSON_SOURCE_START_US in. The keys at the edges carry the zoom
 * as it is there, so a range that starts after a punch has landed holds its value throughout and one that starts
 * inside a drift starts from where the drift has got to; keys outside the range would only fall outside the file.
 * Proven on 0917 (2026-09-29) on ranges starting inside a punch and inside a drift: no double picture.
 */
export function personKeyframes(main: Keyframes[], range: { sourceStartUs: number; durationUs: number }, offsetUs: number): Keyframes[] {
  const from = range.sourceStartUs
  const to = range.sourceStartUs + range.durationUs
  return main
    .filter((list) => list.keyframe_list.length > 0)
    .map((list) => {
      const keys = inTimeOrder(list.keyframe_list)
      // a key of the list's own shape (the zoom writer's), with the value the main piece has at that moment
      const edge = (t: number): KeyframePoint => ({ ...structuredClone(keys[0]!), id: newId(), time_offset: t - offsetUs, values: [valueAt(keys, t)] })
      const inside = keys
        .filter((key) => key.time_offset > from && key.time_offset < to)
        .map((key) => ({ ...structuredClone(key), id: newId(), time_offset: key.time_offset - offsetUs }))
      return { ...list, id: newId(), keyframe_list: [edge(from), ...inside, edge(to)] }
    })
}

/**
 * The CapCut route's copy: the same keys (same file, same source time), new ids on every list and key. A copy of a
 * piece plays the piece's own file at the piece's own source times, so the keys fit it as they are. The ids are new
 * because every id in a draft names one thing: CapCut re-saved a material two segments shared as two entries with
 * one id (M0 spike, 2026-09-17), and the copy that zoomed on 0917 had new ids at both levels.
 */
export function copiedKeyframes(main: Keyframes[]): Keyframes[] {
  return main.map((list) => ({ ...list, id: newId(), keyframe_list: list.keyframe_list.map((key) => ({ ...structuredClone(key), id: newId() })) }))
}
```

- [ ] **Step 4: Run the test and see it pass.**

  Run: `npx vitest run packages/core/src/cutout`

  Expected: PASS (7 tests in `keyframes.test.ts`).

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 5: Layer order by `tracks[]` (`arrangeTracks`, `addedTracks`)

**Files:**
- Create: `packages/core/src/capcut/layers.ts`
- Test: `packages/core/src/capcut/layers.test.ts`
- Modify (comments only): `packages/core/src/capcut/inserts.ts:30-31`, `packages/core/src/capcut/graphics.ts:21-22`, `packages/core/src/capcut/overlays.ts:18-26` and `:62`
- Modify (tests that argue layer order by `render_index`): `packages/core/src/capcut/graphics.test.ts:111-120` and `:186-221`, `packages/core/src/capcut/inserts.test.ts:128-133`, `packages/core/src/capcut/highlights.test.ts:284-289`
- Not in this task: `apps/desktop/src/main/timeline.test.ts` (~:722-723 and ~:1172-1186) also argues by `render_index`. Task 15 rewrites those tests when the write starts calling `arrangeTracks`; leave them alone here.

Why:
- CapCut draws its layers in the order of `tracks[]`, the first at the bottom. It does not use the segments' `render_index`. On 0917 (2026-09-29), a copy track at the end of the list covered the subtitles although its `render_index` (13600) was below theirs (14000), and CapCut kept the order on re-save.
- Each writer appends its own tracks. The write will put them in the spec §9.1 order once, at the end (Task 15). This task gives it the two tools for that.
- It also stops the comments and tests from claiming that `render_index` orders anything. The values the writers write stay as they are; only what the comments and tests say about them changes.

- [ ] **Step 1: Write the failing test, and make the old tests check `tracks[]` instead of `render_index`.**

  Create `packages/core/src/capcut/layers.test.ts`:

```ts
import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { addHighlightTracks, type HighlightLook } from "./highlights.ts"
import { addInsertTrack, type TimelineInsert } from "./inserts.ts"
import { addedTracks, arrangeTracks } from "./layers.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import { addSoundTrack } from "./sounds.ts"
import { addSubtitleTrack } from "./subtitles.ts"
import type { DraftInfo } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

const look: HighlightLook = {
  fontPath: "/fonts/x.ttf",
  strokeWidth: 0.08,
  barRoundness: 20,
  palette: { text: [1, 1, 1], accent: [1, 0, 0], alt: [0, 0, 1], bar: [1, 1, 0] },
  animation: null,
}
const photo: TimelineInsert = {
  atUs: 2_000_000,
  durationUs: 2_000_000,
  binId: "bin-1",
  path: "/pics/nail.jpg",
  name: "nail.jpg",
  kind: "photo",
  width: 3024,
  height: 4032,
  durationOfFileUs: 5_000_000,
  fit: "cover",
}

/** A write's tracks the way its writers append them: the rough cut, the subtitles, a cutaway, a line of text on a bar, a sound. */
async function written() {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  const rough = buildRoughCut(draft.info, [{ binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 9_500_000 }], binVideos(draft.meta))
  const subtitled = addSubtitleTrack(rough, [{ startUs: 0, endUs: 1_000_000, text: "สวัสดีครับ" }], "boxblack_1")
  const cutaway = addInsertTrack(subtitled, [photo]).info
  const text = addHighlightTracks(cutaway, [{ endUs: 3_000_000, lines: [{ startUs: 1_000_000, text: "ลดเหลือ", y: 0.5, scale: 2, bar: { width: 0.4, height: 0.1 } }] }], look)
  const sound = addSoundTrack(text, [{ atUs: 1_000_000, effectId: "7", name: "ป๊อป", path: null, durationUs: 500_000 }]).info
  const typeOf = (id: string) => sound.tracks.find((track) => track.id === id)!.type
  return {
    info: sound,
    main: rough.tracks.map((track) => track.id),
    subtitles: addedTracks(rough, subtitled),
    cutaways: addedTracks(subtitled, cutaway),
    bars: addedTracks(cutaway, text).filter((id) => typeOf(id) === "sticker"),
    lines: addedTracks(cutaway, text).filter((id) => typeOf(id) === "text"),
    sounds: addedTracks(text, sound),
  }
}

/** Each segment's render index, by segment id. */
const renderIndexes = (info: DraftInfo) => Object.fromEntries(info.tracks.flatMap((track) => track.segments.map((segment) => [segment.id, segment.render_index])))

test("addedTracks names the tracks a writer appended, in the order it appended them", async () => {
  const { info, main, subtitles, cutaways, bars, lines, sounds } = await written()
  expect([main, subtitles, cutaways, bars, lines, sounds].map((ids) => ids.length)).toEqual([1, 1, 1, 1, 1, 1])
  // the writers appended in that order, the text writer its bar before its text
  expect(info.tracks.map((track) => track.id)).toEqual([...main, ...subtitles, ...cutaways, ...bars, ...lines, ...sounds])
  expect(addedTracks(info, info)).toEqual([])
})

test("arrangeTracks puts the tracks in the order given and numbers every segment by its track's place", async () => {
  const { info, main, subtitles, cutaways, bars, lines, sounds } = await written()
  // the subtitles were appended second; they go over the text, and an empty layer is no layer
  const layers = [main, [], cutaways, bars, lines, subtitles, sounds]
  const out = arrangeTracks(info, layers)
  expect(out.tracks.map((track) => track.id)).toEqual(layers.flat())
  out.tracks.forEach((track, position) => {
    for (const segment of track.segments) expect(segment.track_render_index).toBe(position)
  })
  // the render index each writer gave a segment stays: CapCut does not layer by it
  expect(renderIndexes(out)).toEqual(renderIndexes(info))
  // nothing but the order and the track numbers changes
  const plain = (draft: DraftInfo) =>
    Object.fromEntries(draft.tracks.map((track) => [track.id, { ...track, segments: track.segments.map(({ track_render_index: _place, ...segment }) => segment) }]))
  expect(plain(out)).toEqual(plain(info))
  expect(out.materials).toEqual(info.materials)
})

test("arrangeTracks refuses a track left out, one listed twice, and one the draft does not have", async () => {
  const { info, main, subtitles, cutaways, bars, lines, sounds } = await written()
  expect(() => arrangeTracks(info, [main, cutaways, bars, lines, subtitles])).toThrow(/audio track .* is not listed/)
  expect(() => arrangeTracks(info, [main, cutaways, bars, lines, subtitles, sounds, main])).toThrow(/listed twice/)
  expect(() => arrangeTracks(info, [main, cutaways, bars, lines, subtitles, sounds, ["NOT-A-TRACK"]])).toThrow(/NOT-A-TRACK is not in the draft/)
})

test("arrangeTracks leaves the draft it is given as it was", async () => {
  const { info, main, subtitles, cutaways, bars, lines, sounds } = await written()
  const before = structuredClone(info)
  const out = arrangeTracks(info, [main, cutaways, bars, lines, subtitles, sounds])
  expect(info).toEqual(before)
  // and shares nothing with it
  out.tracks[0]!.segments[0]!.volume = 0.5
  expect(info.tracks[0]!.segments[0]!.volume).toBe(1)
})
```

  In `packages/core/src/capcut/graphics.test.ts`, replace:

```ts
test("graphics that overlap go on tracks of their own, each lane's track drawn above the one below", async () => {
  const { info: out } = addGraphicTrack(await roughCut(), [graphic({ atUs: 2_000_000, binId: "BIN-2" }), graphic()])
  expect(timesOf(out)).toEqual([[{ start: 1_000_000, duration: 3_000_000 }], [{ start: 2_000_000, duration: 3_000_000 }]])
  expect(overlays(out).map((track) => [track.segments[0]!.render_index, track.segments[0]!.track_render_index])).toEqual([
    [1001, 1],
    [1002, 2],
  ])
```

  with:

```ts
test("graphics that overlap go on tracks of their own, the later one's track after the earlier one's, which CapCut draws on top", async () => {
  const { info: out } = addGraphicTrack(await roughCut(), [graphic({ atUs: 2_000_000, binId: "BIN-2" }), graphic()])
  expect(timesOf(out)).toEqual([[{ start: 1_000_000, duration: 3_000_000 }], [{ start: 2_000_000, duration: 3_000_000 }]])
  // CapCut layers by the order of tracks[]; each segment's track_render_index is its track's place there
  expect(overlays(out).map((track) => [out.tracks.indexOf(track), track.segments[0]!.track_render_index])).toEqual([
    [1, 1],
    [2, 2],
  ])
```

  (The two `binOf` lines after it stay.) In the same file, the last test's title:

```ts
test("render index sits above the cutaway track and below the highlight text", async () => {
```

  becomes:

```ts
test("each writer appends its tracks after those already there: the graphics after the cutaways, the text after both", async () => {
```

  and its end:

```ts
  const withHighlight = addHighlightTracks(out, [{ endUs: 1_000_000, lines: [{ startUs: 0, text: "hi", y: 0, scale: 1 }] }], look)
  const textSegment = withHighlight.tracks.find((track) => track.type === "text")!.segments[0]!

  const cutawaySegment = overlays(withCutaway)[0]!.segments[0]!
  const graphicSegment = out.tracks.at(-1)!.segments[0]!
  const graphicTrackIndex = out.tracks.length - 1

  expect(cutawaySegment.render_index).toBe(9) // 8 + track 1
  expect(graphicSegment.render_index).toBe(1000 + graphicTrackIndex)
  // a real ordering check against what addHighlightTracks actually computes, not against itself
  expect(graphicSegment.render_index).toBeGreaterThan(cutawaySegment.render_index as number)
  expect(graphicSegment.render_index as number).toBeLessThan(textSegment.render_index as number)
})
```

  becomes:

```ts
  const withHighlight = addHighlightTracks(out, [{ endUs: 1_000_000, lines: [{ startUs: 0, text: "hi", y: 0, scale: 1 }] }], look)

  // CapCut draws a track later in tracks[] over an earlier one, whatever the render indexes say (0917, 2026-09-29)
  expect(withHighlight.tracks.map((track) => [track.type, track.flag])).toEqual([
    ["video", 0],
    ["video", 2],
    ["video", 2],
    ["text", 0],
  ])
  const [, cutawayTrack, graphicTrack] = withHighlight.tracks
  expect(graphicTrack!.segments[0]!.material_id).toBe(out.tracks.at(-1)!.segments[0]!.material_id)
  expect(cutawayTrack!.segments[0]!.material_id).toBe(overlays(withCutaway)[0]!.segments[0]!.material_id)
  withHighlight.tracks.forEach((track, place) => expect(track.segments[0]!.track_render_index).toBe(place))
})
```

  In `packages/core/src/capcut/inserts.test.ts`, replace:

```ts
  // each lane's track draws above the one below it, both still under the text written later
  expect(tracks.map((track) => [track.segments[0]!.render_index, track.segments[0]!.track_render_index])).toEqual([
    [9, 1],
    [10, 2],
  ])
  expect(out.tracks.slice(1)).toEqual(tracks)
```

  with:

```ts
  // the later lane's track comes after the earlier one's in tracks[], which is what CapCut draws on top
  expect(tracks.map((track) => [out.tracks.indexOf(track), track.segments[0]!.track_render_index])).toEqual([
    [1, 1],
    [2, 2],
  ])
  expect(out.tracks.slice(1)).toEqual(tracks)
```

  In `packages/core/src/capcut/highlights.test.ts` ("a bar is a rounded rect on a sticker track under the text…"), replace:

```ts
  // the bar sits where its line does, for as long as its line does, and behind every text track
  const [bar] = stickers[0]!.segments
  const [text] = out.tracks.filter((track) => track.type === "text")[0]!.segments
  expect(bar!.clip).toMatchObject({ transform: { x: 0, y: 0.5 }, scale: { x: 1, y: 1 } })
  expect(bar!.target_timerange).toEqual(text!.target_timerange)
  expect(bar!.render_index).toBeLessThan(text!.render_index as number)
```

  with:

```ts
  // the bar sits where its line does, for as long as its line does, and behind every text track: its track
  // comes before theirs in tracks[] (checked above), which is what CapCut layers by
  const [bar] = stickers[0]!.segments
  const [text] = out.tracks.filter((track) => track.type === "text")[0]!.segments
  expect(bar!.clip).toMatchObject({ transform: { x: 0, y: 0.5 }, scale: { x: 1, y: 1 } })
  expect(bar!.target_timerange).toEqual(text!.target_timerange)
```

  That test already checks the order: its first expectation is `["video", "sticker", "sticker", "text", "text"]`.

- [ ] **Step 2: Run the tests and see the new one fail.**

  Run: `npx vitest run packages/core/src/capcut`

  Expected: `layers.test.ts` FAILS with `Error: Cannot find module './layers.ts'`. The rewritten tests in `graphics.test.ts`, `inserts.test.ts` and `highlights.test.ts` already PASS: they check the `tracks[]` order, which the writers already produce.

- [ ] **Step 3: Implement.**

  Create `packages/core/src/capcut/layers.ts`:

```ts
import type { DraftInfo } from "./types.ts"

/**
 * Puts the tracks in the order given, bottom to top: `layers` is a list of track-id lists; every track in info must be
 * listed exactly once (else throws). Every segment's track_render_index becomes its track's position. Pure.
 *
 * CapCut draws its layers in the order of `tracks[]`, the first at the bottom, whatever the segments' render_index
 * says: on 0917 (2026-09-29) a track written last covered the subtitles although its render index was below theirs,
 * and CapCut kept the order when it re-saved the draft. Each writer appends its own tracks, so the write puts them in
 * place once, at the end; a layer is one writer's tracks, in the order that writer appended them. The render index
 * each writer gave a segment is left as it is: it orders nothing. A track left out would vanish from the draft and
 * one listed twice would play twice, so either is refused rather than written.
 */
export function arrangeTracks(info: DraftInfo, layers: string[][]): DraftInfo {
  const have = new Set(info.tracks.map((track) => track.id))
  if (have.size !== info.tracks.length) throw new Error("two tracks of the draft have the same id")
  const order = layers.flat()
  const listed = new Set<string>()
  for (const id of order) {
    if (!have.has(id)) throw new Error(`track ${id} is not in the draft`)
    if (listed.has(id)) throw new Error(`track ${id} is listed twice`)
    listed.add(id)
  }
  const left = info.tracks.find((track) => !listed.has(track.id))
  if (left) throw new Error(`the ${left.type} track ${left.id} is not listed`)

  const out = structuredClone(info)
  const byId = new Map(out.tracks.map((track) => [track.id, track]))
  out.tracks = order.map((id, position) => {
    const track = byId.get(id)!
    return { ...track, segments: track.segments.map((segment) => ({ ...segment, track_render_index: position })) }
  })
  return out
}

/** The ids of the tracks `after` has and `before` did not, in order (to learn what a writer appended). */
export function addedTracks(before: DraftInfo, after: DraftInfo): string[] {
  const had = new Set(before.tracks.map((track) => track.id))
  return after.tracks.filter((track) => !had.has(track.id)).map((track) => track.id)
}
```

  In `packages/core/src/capcut/inserts.ts`, replace:

```ts
/** Just above the rough cut, and under the graphics (1000 + track) and the text. */
const RENDER_INDEX_BASE = 8
```

  with:

```ts
/**
 * The render index the cutaways have always been written with (8 + track). CapCut draws its layers in the order of
 * `tracks[]`, not by this number (0917, 2026-09-29), so it orders nothing: the write puts the cutaways' tracks over
 * the picture and under the graphics and the text with arrangeTracks.
 */
const RENDER_INDEX_BASE = 8
```

  In `packages/core/src/capcut/graphics.ts`, replace:

```ts
/** Above the cutaways (8 + track) and below the highlight text (14000 + track) and its bars (13000 + track). */
const RENDER_INDEX_BASE = 1000
```

  with:

```ts
/**
 * The render index the graphics have always been written with (1000 + track). CapCut draws its layers in the order
 * of `tracks[]`, not by this number (0917, 2026-09-29), so it orders nothing: the write puts the graphics' tracks
 * over the cutaways and under the text with arrangeTracks.
 */
const RENDER_INDEX_BASE = 1000
```

  In `packages/core/src/capcut/overlays.ts`, replace the doc of `addOverlayTracks`:

```ts
/**
 * Lays pictures over the rough cut on overlay video tracks above the tracks `info` has, and answers
 * the draft info after. Pure. Each piece is silent and plays from the start of its file. Pieces
 * that overlap go on tracks of their own, newest on top (laneOf): lane n becomes the n-th new track,
 * and each lane's track draws above the one below it, from `renderBase` on. The pieces come in
 * start order, each at least one frame long: a lane's segments go on its track in the order given,
 * and a piece with no frame would be a segment of no length. The cutaways and the graphics are both
 * laid this way; each writer says which pieces play, where, and from which base.
 */
```

  with:

```ts
/**
 * Lays pictures over the rough cut on overlay video tracks after the tracks `info` has, and answers
 * the draft info after. Pure. Each piece is silent and plays from the start of its file. Pieces
 * that overlap go on tracks of their own, newest on top (laneOf): lane n becomes the n-th new track,
 * and CapCut draws a track later in `tracks[]` over an earlier one, so each lane draws over the lane
 * below it. `renderBase` only sets the render index written on each segment (renderBase + its
 * track's place), which CapCut keeps but does not layer by. The pieces come in start order, each at
 * least one frame long: a lane's segments go on its track in the order given, and a piece with no
 * frame would be a segment of no length. The cutaways and the graphics are both laid this way; each
 * writer says which pieces play, where, and from which base.
 */
```

  and, in the same file, replace:

```ts
      // a higher track draws over a lower one: each lane's track above the last, all under the text
      render_index: renderBase + trackIndex,
```

  with:

```ts
      // kept by CapCut but not layered by: the order of tracks[] is what puts one track over another (0917, 2026-09-29)
      render_index: renderBase + trackIndex,
```

- [ ] **Step 4: Run the tests and see them pass.**

  Run: `npx vitest run packages/core/src/capcut`

  Expected: PASS, with 4 tests in `layers.test.ts`.

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 6: The person and matting writers, the rendered-files predicate, and backups without masks

**Files:**
- Modify: `packages/core/src/capcut/bin.ts` (`RENDERED_GRAPHICS_FOLDER`/`isRenderedGraphic` :36-45, `pruneBinItems` :70-94)
- Test: `packages/core/src/capcut/bin.test.ts` (import :4, the `isRenderedGraphic` test :113-117, `GRAPHICS_DIR` :119, the `pruneBinItems` tests :140-171)
- Modify: `packages/core/src/capcut/projects.ts` (import :3, `inspectProject` :74-76); test `packages/core/src/capcut/projects.test.ts` (:129-145)
- Modify: `packages/core/src/flair/media.ts` (import :1, `spareMedia` :51-52); test `packages/core/src/flair/media.test.ts` (:62-72)
- Modify: `apps/desktop/src/main/timeline.ts:584` (the one caller of `pruneBinItems` outside core)
- Modify: `packages/core/src/capcut/write.ts` (import :4, `backupDraft` :127-131); test `packages/core/src/capcut/write.test.ts` (imports :1 and :3, a new test before :263)
- Create: `packages/core/src/capcut/person.ts`; test `packages/core/src/capcut/person.test.ts`
- Create: `packages/core/src/cutout/index.ts`
- Modify: `packages/core/src/capcut/index.ts` (:4 and :11)
- Modify: `packages/core/package.json` (`exports`, after `"./capcut/bin"` at :11)

This task has three test-first cycles (6a–6c) and the exports (6d). Tasks 1, 3 and 4 must be in place: `person.ts` uses `PERSON_SOURCE_START_US` (`cutout/frames.ts`) and `copiedKeyframes` (`cutout/keyframes.ts`), and its tests use `personKeyframes`.

What `grep -rn -E "pruneBinItems|isRenderedGraphic|RENDERED_GRAPHICS_FOLDER" --exclude-dir=node_modules --exclude-dir=out --exclude-dir=release packages apps` finds, and what this task does with each:

| Where | What | Here |
|---|---|---|
| `apps/desktop/src/main/timeline.ts:61`, `:584` | imports and calls `pruneBinItems(meta, pruneIn, playing)` | passes `[pruneIn]`; Task 15 adds the cutouts folder |
| `packages/core/src/capcut/index.ts:11` | re-exports `pruneBinItems` | same name, now the list signature |
| `packages/core/src/capcut/projects.ts:3`, `:76` | `isRenderedGraphic` keeps rendered files out of the footage list | switches to `isRenderedFile` |
| `packages/core/src/flair/media.ts:1`, `:52` | `isRenderedGraphic` keeps rendered files out of the cutaway media | switches to `isRenderedFile` |
| `packages/core/src/capcut/bin.test.ts` | the predicate and prune tests | updated below |

`docs/plans/2026-09-24-graphics-overlay.md:2702` quotes the old call too. It is a record of that plan, not code, and stays as it is.

#### 6a. The rendered-files predicate and pruning a list of folders

Why (spec §7.4): the person cutouts live in `~/Movies/CapCut/BOXBLACK/cutouts/`, beside the graphics. They are BOXBLACK's own files, just as the graphics are:
- they must never be offered as footage or as a cutaway;
- the write must be able to prune their bin entries.

`isRenderedGraphic` stays as another name for the new predicate, so nothing that calls it breaks. Its two core callers move to the new name anyway.

- [ ] **Step 1: Write the failing tests.**

  In `packages/core/src/capcut/bin.test.ts`, the import:

```ts
import { addBinItems, binIdOf, graphicBinItem, isRenderedGraphic, pruneBinItems, RENDERED_GRAPHICS_FOLDER } from "./bin.ts"
```

  becomes:

```ts
import { addBinItems, binIdOf, graphicBinItem, isRenderedFile, isRenderedGraphic, pruneBinItems, RENDERED_FOLDERS } from "./bin.ts"
```

  Replace the `isRenderedGraphic` test (it would now be wrong: the old name is true for cutouts too):

```ts
test("isRenderedGraphic is true only for a path under BOXBLACK's own graphics folder", () => {
  expect(isRenderedGraphic(`/Users/x${RENDERED_GRAPHICS_FOLDER}ab12.mov`)).toBe(true)
  expect(isRenderedGraphic("/Users/x/Movies/CapCut/broll.mov")).toBe(false)
  expect(isRenderedGraphic("/Users/x/clips/broll.mov")).toBe(false)
})
```

  with:

```ts
test("isRenderedFile is true only for a path under one of BOXBLACK's own folders: its graphics and its person cutouts", () => {
  expect(RENDERED_FOLDERS).toEqual(["/Movies/CapCut/BOXBLACK/graphics/", "/Movies/CapCut/BOXBLACK/cutouts/"])
  expect(isRenderedFile("/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov")).toBe(true)
  expect(isRenderedFile("/Users/x/Movies/CapCut/BOXBLACK/cutouts/0123456789abcdef.mov")).toBe(true)
  // a folder that only starts with the same name is another folder
  expect(isRenderedFile("/Users/x/Movies/CapCut/BOXBLACK/cutouts-old/x.mov")).toBe(false)
  expect(isRenderedFile("/Users/x/Movies/CapCut/broll.mov")).toBe(false)
  expect(isRenderedFile("/Users/x/clips/broll.mov")).toBe(false)
  // the old name is the same predicate, so its callers leave the cutouts out too
  expect(isRenderedGraphic).toBe(isRenderedFile)
})
```

  Below it:

```ts
const GRAPHICS_DIR = "/Users/x/Movies/CapCut/BOXBLACK/graphics"
```

  becomes:

```ts
const GRAPHICS_DIR = "/Users/x/Movies/CapCut/BOXBLACK/graphics"
const CUTOUTS_DIR = "/Users/x/Movies/CapCut/BOXBLACK/cutouts"
```

  The last three tests of the file (`withGraphics` above them stays):

```ts
test("pruneBinItems drops an unkept graphic, keeps everything else", () => {
  const original = withGraphics()
  const out = pruneBinItems(original, GRAPHICS_DIR, new Set(["KEEP"]))
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
  expect(out.draft_materials[1]).toEqual(original.draft_materials[1])
  // pure: the object passed in is untouched
  expect(original.draft_materials[0]!.value).toHaveLength(4)
})

test("pruneBinItems treats an empty, root, single-folder or trailing-slash dir safely", () => {
  const original = withGraphics()
  // an empty or root dir would otherwise match — and prune — every imported file
  expect(pruneBinItems(original, "", new Set())).toEqual(original)
  expect(pruneBinItems(original, "/", new Set())).toEqual(original)
  // a single-folder dir such as /Users holds the user's own footage too: never a graphics folder
  const top = `/${GRAPHICS_DIR.split("/")[1]}`
  expect(pruneBinItems(original, top, new Set())).toEqual(original)
  // a wider folder that passes the guard still only loses rendered graphics, never the user's own media
  const home = GRAPHICS_DIR.split("/").slice(0, 3).join("/")
  const wide = pruneBinItems(original, home, new Set(["KEEP"]))
  expect(wide.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
  // a trailing slash on an otherwise normal dir makes no difference
  const withSlash = pruneBinItems(original, `${GRAPHICS_DIR}/`, new Set(["KEEP"]))
  const withoutSlash = pruneBinItems(original, GRAPHICS_DIR, new Set(["KEEP"]))
  expect(withSlash).toEqual(withoutSlash)
})

test("addBinItems after pruneBinItems with a reused id does not duplicate", () => {
  const pruned = pruneBinItems(withGraphics(), GRAPHICS_DIR, new Set(["KEEP"]))
  const reused = graphicBinItem({ id: "KEEP", path: `${GRAPHICS_DIR}/keep.mov`, width: 2, height: 2, durationUs: 1, nowMs: 0 })
  const out = addBinItems(pruned, [reused])
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
})
```

  become:

```ts
test("pruneBinItems drops an unkept graphic, keeps everything else", () => {
  const original = withGraphics()
  const out = pruneBinItems(original, [GRAPHICS_DIR], new Set(["KEEP"]))
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
  expect(out.draft_materials[1]).toEqual(original.draft_materials[1])
  // pure: the object passed in is untouched
  expect(original.draft_materials[0]!.value).toHaveLength(4)
})

test("pruneBinItems treats an empty, root, single-folder or trailing-slash dir safely", () => {
  const original = withGraphics()
  // an empty or root dir would otherwise match — and prune — every imported file
  expect(pruneBinItems(original, [""], new Set())).toEqual(original)
  expect(pruneBinItems(original, ["/"], new Set())).toEqual(original)
  // a single-folder dir such as /Users holds the user's own footage too: never a graphics folder
  const top = `/${GRAPHICS_DIR.split("/")[1]}`
  expect(pruneBinItems(original, [top], new Set())).toEqual(original)
  // a wider folder that passes the guard still only loses rendered graphics, never the user's own media
  const home = GRAPHICS_DIR.split("/").slice(0, 3).join("/")
  const wide = pruneBinItems(original, [home], new Set(["KEEP"]))
  expect(wide.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
  // a trailing slash on an otherwise normal dir makes no difference
  const withSlash = pruneBinItems(original, [`${GRAPHICS_DIR}/`], new Set(["KEEP"]))
  const withoutSlash = pruneBinItems(original, [GRAPHICS_DIR], new Set(["KEEP"]))
  expect(withSlash).toEqual(withoutSlash)
  // an unsafe folder beside a real one is passed over, and the real one is still pruned
  expect(pruneBinItems(original, ["/", GRAPHICS_DIR], new Set(["KEEP"]))).toEqual(withoutSlash)
  // no folder at all prunes nothing
  expect(pruneBinItems(original, [], new Set())).toEqual(original)
})

test("pruneBinItems drops the unkept files of every folder it is given, graphics and person cutouts alike, and only of those", () => {
  const withBoth = () => ({
    ...meta(),
    draft_materials: [
      {
        type: 0,
        value: [
          { id: "GONE", file_Path: `${GRAPHICS_DIR}/gone.mov`, metetype: "video", duration: 1, width: 1, height: 1 },
          { id: "KEEP", file_Path: `${GRAPHICS_DIR}/keep.mov`, metetype: "video", duration: 1, width: 1, height: 1 },
          { id: "CUT-GONE", file_Path: `${CUTOUTS_DIR}/aaaaaaaaaaaaaaaa.mov`, metetype: "video", duration: 1, width: 1, height: 1 },
          { id: "CUT-KEEP", file_Path: `${CUTOUTS_DIR}/bbbbbbbbbbbbbbbb.mov`, metetype: "video", duration: 1, width: 1, height: 1 },
          { id: "USER", file_Path: "/Users/x/own-media/clip.mov", metetype: "video", duration: 1, width: 1, height: 1 },
        ],
      },
    ],
  })
  const keep = new Set(["KEEP", "CUT-KEEP"])
  const ids = (dirs: string[]) => pruneBinItems(withBoth(), dirs, keep).draft_materials[0]!.value.map((entry) => entry.id)
  expect(ids([GRAPHICS_DIR, CUTOUTS_DIR])).toEqual(["KEEP", "CUT-KEEP", "USER"])
  // a folder not named is left alone, whatever lives in it
  expect(ids([GRAPHICS_DIR])).toEqual(["KEEP", "CUT-GONE", "CUT-KEEP", "USER"])
  expect(ids([CUTOUTS_DIR])).toEqual(["GONE", "KEEP", "CUT-KEEP", "USER"])
})

test("addBinItems after pruneBinItems with a reused id does not duplicate", () => {
  const pruned = pruneBinItems(withGraphics(), [GRAPHICS_DIR], new Set(["KEEP"]))
  const reused = graphicBinItem({ id: "KEEP", path: `${GRAPHICS_DIR}/keep.mov`, width: 2, height: 2, durationUs: 1, nowMs: 0 })
  const out = addBinItems(pruned, [reused])
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
})
```

  In `packages/core/src/capcut/projects.test.ts`, the test at :129 leaves out a cutout too. Replace:

```ts
test("inspectProject leaves out BOXBLACK's own rendered graphics, but not the user's other files under Movies/CapCut", async () => {
  const root = await makeDraftRoot()
  await editJson<DraftMeta>(join(root, "0917", "draft_meta_info.json"), (meta) => {
    const imported = meta.draft_materials.find((group) => group.type === 0)!
    const realVideo = imported.value.find((entry) => entry.metetype === "video")!
    imported.value.push(
      { ...realVideo, id: "GRAPHIC", file_Path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", extra_info: "ab12.mov" },
```

  with:

```ts
test("inspectProject leaves out BOXBLACK's own rendered graphics and person cutouts, but not the user's other files under Movies/CapCut", async () => {
  const root = await makeDraftRoot()
  await editJson<DraftMeta>(join(root, "0917", "draft_meta_info.json"), (meta) => {
    const imported = meta.draft_materials.find((group) => group.type === 0)!
    const realVideo = imported.value.find((entry) => entry.metetype === "video")!
    imported.value.push(
      { ...realVideo, id: "GRAPHIC", file_Path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", extra_info: "ab12.mov" },
      { ...realVideo, id: "CUTOUT", file_Path: "/Users/x/Movies/CapCut/BOXBLACK/cutouts/0123456789abcdef.mov", extra_info: "0123456789abcdef.mov" },
```

  and, in the same test, replace:

```ts
  assert.ok(!ids.includes("GRAPHIC"))
  assert.ok(ids.includes("USER-ELSEWHERE"))
```

  with:

```ts
  assert.ok(!ids.includes("GRAPHIC"))
  assert.ok(!ids.includes("CUTOUT"))
  assert.ok(ids.includes("USER-ELSEWHERE"))
```

  In `packages/core/src/flair/media.test.ts`, replace:

```ts
  it("leaves out BOXBLACK's own rendered graphics, but not the user's other files under Movies/CapCut", () => {
    const found = spareMedia(
      meta([
        item("a", "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", "video"),
        item("b", "/Users/x/Movies/CapCut/broll.mov", "video"),
      ]),
```

  with:

```ts
  it("leaves out BOXBLACK's own rendered graphics and person cutouts, but not the user's other files under Movies/CapCut", () => {
    const found = spareMedia(
      meta([
        item("a", "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", "video"),
        item("c", "/Users/x/Movies/CapCut/BOXBLACK/cutouts/0123456789abcdef.mov", "video"),
        item("b", "/Users/x/Movies/CapCut/broll.mov", "video"),
      ]),
```

  (Its expectation stays `["b"]`.)

- [ ] **Step 2: Run the tests and see them fail.**

  Run: `npx vitest run packages/core/src/capcut/bin.test.ts packages/core/src/capcut/projects.test.ts packages/core/src/flair/media.test.ts`

  Expected: 7 FAIL:
  - the `isRenderedFile` test, because `RENDERED_FOLDERS` is `undefined`;
  - the four `pruneBinItems` tests, with `TypeError: dir.replace is not a function`;
  - the projects and media tests, because the cutout is still listed.

- [ ] **Step 3: Implement.**

  In `packages/core/src/capcut/bin.ts`, replace:

```ts
/**
 * The app always writes rendered graphics under `~/Movies/CapCut/BOXBLACK/graphics`, and nothing
 * else lives there. A path tail, so it matches whatever the user's home directory is.
 */
export const RENDERED_GRAPHICS_FOLDER = "/Movies/CapCut/BOXBLACK/graphics/"

/** True when `path` is one of BOXBLACK's own rendered graphics, not the user's footage. */
export function isRenderedGraphic(path: string): boolean {
  return path.includes(RENDERED_GRAPHICS_FOLDER)
}
```

  with:

```ts
/**
 * The app always writes rendered graphics under `~/Movies/CapCut/BOXBLACK/graphics`, and nothing
 * else lives there. A path tail, so it matches whatever the user's home directory is.
 */
export const RENDERED_GRAPHICS_FOLDER = "/Movies/CapCut/BOXBLACK/graphics/"

/**
 * Every folder the app renders files into, as path tails: the graphics, and the person cutouts that put text
 * behind the speaker (`~/Movies/CapCut/BOXBLACK/cutouts`). Nothing else lives in either.
 */
export const RENDERED_FOLDERS = [RENDERED_GRAPHICS_FOLDER, "/Movies/CapCut/BOXBLACK/cutouts/"]

/** a file BOXBLACK rendered (a graphic or a person cutout): not the user's footage, prunable, cleanable */
export function isRenderedFile(path: string): boolean {
  return RENDERED_FOLDERS.some((folder) => path.includes(folder))
}

/** isRenderedFile under the name it had while graphics were the only files the app rendered. */
export const isRenderedGraphic = isRenderedFile
```

  and replace `pruneBinItems` with its doc:

```ts
/**
 * Drops the imported-files entries for BOXBLACK's own rendered graphics that the new timeline no
 * longer plays: only BOXBLACK's rendered graphics live under `dir`, and a write replaces the whole
 * timeline, so a graphic that timeline doesn't use is no longer used by this draft. The user's own
 * media, anything outside `dir`, and every other group, are left alone. Pure.
 *
 * `keep`: the ids of the entries the new timeline plays. Ids rather than paths, because that also
 * drops a stale duplicate entry for the same file — left behind by a write that was interrupted,
 * or by someone editing the draft by hand.
 *
 * `dir` is normalised (trailing slashes stripped) before matching. If what is left is not an
 * absolute path of at least two segments (`""` or `"/"`, say), `meta` comes back unchanged: an
 * empty or root-level `dir` would otherwise match — and prune — every imported file.
 */
export function pruneBinItems(meta: DraftMeta, dir: string, keep: Set<string>): DraftMeta {
  const trimmed = dir.replace(/\/+$/, "")
  if (!trimmed.startsWith("/") || trimmed.split("/").filter(Boolean).length < 2) return meta
  const prefix = `${trimmed}/`
  const groups = meta.draft_materials.map((group) => {
    if (group.type !== 0) return group
    // only BOXBLACK's own rendered graphics are ever dropped, whatever folder the caller names
    return { ...group, value: group.value.filter((item) => !(item.file_Path.startsWith(prefix) && isRenderedGraphic(item.file_Path)) || keep.has(item.id)) }
  })
  return { ...meta, draft_materials: groups }
}
```

  with:

```ts
/**
 * Drops the imported-files entries for BOXBLACK's own rendered files (graphics and person cutouts)
 * that the new timeline no longer plays: only BOXBLACK's rendered files live under `dirs`, and a
 * write replaces the whole timeline, so a file that timeline doesn't use is no longer used by this
 * draft. The user's own media, anything outside `dirs`, and every other group, are left alone. Pure.
 *
 * `keep`: the ids of the entries the new timeline plays. Ids rather than paths, because that also
 * drops a stale duplicate entry for the same file — left behind by a write that was interrupted,
 * or by someone editing the draft by hand.
 *
 * Each of `dirs` is normalised (trailing slashes stripped) before matching. One that is not then an
 * absolute path of at least two segments (`""` or `"/"`, say) is passed over, since an empty or
 * root-level folder would match — and prune — every imported file; with none left, `meta` comes
 * back unchanged.
 */
export function pruneBinItems(meta: DraftMeta, dirs: string[], keep: Set<string>): DraftMeta {
  const prefixes = dirs
    .map((dir) => dir.replace(/\/+$/, ""))
    .filter((dir) => dir.startsWith("/") && dir.split("/").filter(Boolean).length >= 2)
    .map((dir) => `${dir}/`)
  if (prefixes.length === 0) return meta
  const pruned = (path: string) => isRenderedFile(path) && prefixes.some((prefix) => path.startsWith(prefix))
  const groups = meta.draft_materials.map((group) => {
    if (group.type !== 0) return group
    // only BOXBLACK's own rendered files are ever dropped, whatever folders the caller names
    return { ...group, value: group.value.filter((item) => !pruned(item.file_Path) || keep.has(item.id)) }
  })
  return { ...meta, draft_materials: groups }
}
```

  In `packages/core/src/capcut/projects.ts`, the import:

```ts
import { isRenderedGraphic } from "./bin.ts"
```

  becomes:

```ts
import { isRenderedFile } from "./bin.ts"
```

  and in `inspectProject`:

```ts
    // BOXBLACK's own rendered graphics are imported bin entries too, but they are not footage:
    // the prepare screen would otherwise offer to transcribe and describe them like the user's own clips
    videos: binVideos(draft.meta)
      .filter((video) => !isRenderedGraphic(video.path))
```

  becomes:

```ts
    // BOXBLACK's own rendered graphics and person cutouts are imported bin entries too, but they are not footage:
    // the prepare screen would otherwise offer to transcribe and describe them like the user's own clips
    videos: binVideos(draft.meta)
      .filter((video) => !isRenderedFile(video.path))
```

  In `packages/core/src/flair/media.ts`, the import:

```ts
import { isRenderedGraphic } from "../capcut/bin.ts"
```

  becomes:

```ts
import { isRenderedFile } from "../capcut/bin.ts"
```

  and in `spareMedia`:

```ts
      // BOXBLACK's own rendered graphics are imported bin entries too, but they are not footage to cut away to
      if (isRenderedGraphic(path)) continue
```

  becomes:

```ts
      // BOXBLACK's own rendered graphics and person cutouts are imported bin entries too, but they are not footage to cut away to
      if (isRenderedFile(path)) continue
```

  In `apps/desktop/src/main/timeline.ts` (:584), the write keeps pruning the graphics folder alone:

```ts
      bin: (meta) => (pruneIn ? addBinItems(pruneBinItems(meta, pruneIn, playing), binItems) : addBinItems(meta, binItems)),
```

  becomes:

```ts
      bin: (meta) => (pruneIn ? addBinItems(pruneBinItems(meta, [pruneIn], playing), binItems) : addBinItems(meta, binItems)),
```

  Task 15 adds the cutouts folder to that list and the person files' bin ids to `playing`.

- [ ] **Step 4: Run the tests and see them pass.**

  Run: `npx vitest run packages/core/src/capcut/bin.test.ts packages/core/src/capcut/projects.test.ts packages/core/src/flair/media.test.ts apps/desktop/src/main/timeline.test.ts`

  Expected: PASS. The write's own bin tests in `timeline.test.ts` do not change: one folder in a list prunes what that folder alone pruned.

#### 6b. Backups leave CapCut's masks out

Why (spec §8):
- CapCut's background removal keeps its masks in the draft's own `matting/` folder, about 3.4 MB per second of source (932 masks and 106 MB for 0917's 31 s clip).
- CapCut computes whatever is missing there again when it opens the draft.
- Copying the folder would grow every backup by hundreds of MB for nothing, so `backupDraft` leaves out that one top-level folder. A folder named `matting` deeper in the draft is still copied.

- [ ] **Step 5: Write the failing test.**

  In `packages/core/src/capcut/write.test.ts`:
  - `import { test, vi } from "vitest"` becomes `import { expect, test, vi } from "vitest"`.
  - `import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"` becomes `import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"`. The file's `vi.mock` of `node:fs/promises` spreads the real module, so `mkdir` is the real one.
  - Add this test right before `test("restoreDraft brings back the draft exactly as it was before the write", …)`:

```ts
test("backupDraft leaves out the masks CapCut keeps in the draft's matting folder, and copies everything else", async () => {
  const { draft } = await setup()
  // where CapCut's background removal keeps a file's masks: <draft>/matting/<md5 of the file's path>/2/mask/<µs>
  const masks = join(draft.folder, "matting", "d380e38686606d5cf03d6dac80c58c8e", "2", "mask")
  await mkdir(masks, { recursive: true })
  await writeFile(join(masks, "1800000"), Buffer.alloc(114_688))
  // a folder of the same name deeper in the draft is not CapCut's masks
  await mkdir(join(draft.folder, "Resources", "matting"), { recursive: true })
  await writeFile(join(draft.folder, "Resources", "matting", "keep.json"), "{}")
  const before = await listing(draft.folder)

  const backups = await mkdtemp(join(tmpdir(), "boxblack-backups-"))
  const dir = await backupDraft(draft, backups)
  const copied = await listing(join(dir, "draft"))
  expect(copied).toEqual(before.filter((path) => path !== "matting" && !path.startsWith("matting/")))
  expect(copied).toContain(join("Resources", "matting", "keep.json"))
  // the draft's own masks stay where they are
  expect(await listing(draft.folder)).toEqual(before)
})
```

- [ ] **Step 6: Run the test and see it fail.**

  Run: `npx vitest run packages/core/src/capcut/write.test.ts`

  Expected: the new test FAILS: the copy's listing has the `matting/…` entries (19 entries where 14 are expected).

- [ ] **Step 7: Implement.**

  In `packages/core/src/capcut/write.ts`, the path import:

```ts
import { join } from "node:path"
```

  becomes:

```ts
import { join, resolve } from "node:path"
```

  and replace:

```ts
/** Copies the whole draft folder plus its root_meta_info.json entry into a new dir under backupRoot. */
export async function backupDraft(draft: Draft, backupRoot: string, now = new Date()): Promise<string> {
  const dir = join(backupRoot, `${folderName(draft.name)}-${stamp(now)}`)
  await mkdir(dir, { recursive: true })
  await cp(draft.folder, join(dir, "draft"), { recursive: true, preserveTimestamps: true })
```

  with:

```ts
/**
 * Copies the whole draft folder plus its root_meta_info.json entry into a new dir under backupRoot — all but the
 * draft's own `matting/` folder. CapCut's background removal keeps its masks there, about 3.4 MB per second of
 * source, and CapCut computes whatever is missing from it again when it opens the draft (spec 2026-09-29 §8), so
 * copying it would only grow every backup by hundreds of MB. A folder of that name deeper in the draft is copied.
 */
export async function backupDraft(draft: Draft, backupRoot: string, now = new Date()): Promise<string> {
  const dir = join(backupRoot, `${folderName(draft.name)}-${stamp(now)}`)
  await mkdir(dir, { recursive: true })
  const masks = resolve(draft.folder, "matting")
  await cp(draft.folder, join(dir, "draft"), { recursive: true, preserveTimestamps: true, filter: (source) => resolve(source) !== masks })
```

  The rest of `backupDraft` stays. `restoreDraft` needs nothing: it puts back what the backup holds, and CapCut computes the masks again.

- [ ] **Step 8: Run the test and see it pass.**

  Run: `npx vitest run packages/core/src/capcut/write.test.ts`

  Expected: PASS (20 tests).

#### 6c. The person track and the matting copies

Why (spec §8, §9.2):
- **Our route** lays each range's person file (`<cutoutsDir>/<hash>.mov`) on one overlay track (`flag: 2`). Each segment:
  - is silent (`has_audio` false, volume 0);
  - starts its file at `PERSON_SOURCE_START_US` (Task 3), so file frame j + 1 shows on the range's frame j;
  - is drawn with the main piece's `clip` and zoomed with `personKeyframes` (Task 4).
- **The CapCut route** lays silent copies of the main pieces over the same ranges. Each copy's video material is a clone of its piece's, with CapCut's background removal switched on, written the way CapCut wrote it when the user switched removal on by hand (0917, 2026-09-29):
  - `matting.flag` 3;
  - `matting.path` = `<draft folder>/matting/<md5 of the material path, lower-case hex of its UTF-8 bytes>`;
  - a new upper-case UUID in `custom_matting_id`.

  CapCut computes the masks when it opens the draft.
- Both writers give every segment a fresh material and fresh segment extras, as every segment CapCut writes has.
- Both put their segments on one track, and refuse two that overlap. Ranges never overlap, because a group ends before the next one starts, so an overlap would be a mistake upstream.

- [ ] **Step 9: Write the failing test.**

  Create `packages/core/src/capcut/person.test.ts`. The md5 values are fixed: `d380e38686606d5cf03d6dac80c58c8e` is the md5 of `/fixture/media/IMG_9646.MOV`, and `df64ee82fd9e7c15d61f5ebeae39c3fb` is the md5 of the UTF-8 bytes of `/Users/x/Movies/คลิปของฉัน/ตัด 1.MOV`. Hashing the Thai path's Latin-1 bytes would give `76bef3ac…` instead.

```ts
import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { PERSON_SOURCE_START_US } from "../cutout/frames.ts"
import { personKeyframes } from "../cutout/keyframes.ts"
import { addMattingTrack, addPersonTrack, type TimelineMattingCopy, type TimelinePerson } from "./person.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import type { DraftInfo, Keyframes, Segment } from "./types.ts"
import { addZooms } from "./zoom.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"
const EXTRA_KEYS = ["speeds", "placeholder_infos", "canvases", "sound_channel_mappings", "material_colors", "vocal_separations"]
const UPPER_UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/

/**
 * The fixture draft (30 fps) cut into two pieces, as the write has it when the person goes on: piece 0 plays 0–4 s of
 * IMG_9646.MOV with a punch, piece 1 plays 10–15 s of it with a drift, scaled and moved by the user.
 */
async function written(): Promise<{ info: DraftInfo; folder: string }> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  const rough = buildRoughCut(
    draft.info,
    [
      { binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 4_000_000 },
      { binId: CLIP_A, sourceStartUs: 10_000_000, sourceDurationUs: 5_000_000 },
    ],
    binVideos(draft.meta),
  )
  const info = addZooms(rough, [
    { cut: 0, kind: "punch", atUs: 1_000_000, durationUs: 4_000_000, faceY: 0.4 },
    { cut: 1, kind: "drift", atUs: 0, durationUs: 5_000_000, faceY: -0.2 },
  ]).info
  const piece = info.tracks[0]!.segments[1]!
  piece.clip = { ...(piece.clip as object), scale: { x: 1.2, y: 1.2 }, transform: { x: 0.1, y: -0.05 } }
  return { info, folder: draft.folder }
}

type Entry = { id: string; [key: string]: unknown }
const list = (info: DraftInfo, key: string) => (info.materials[key] ?? []) as Entry[]
const materialOf = (info: DraftInfo, segment: Segment) => list(info, "videos").find((material) => material.id === segment.material_id)!
const withoutIds = (lists: Keyframes[]) => lists.map(({ id: _id, ...rest }) => ({ ...rest, keyframe_list: rest.keyframe_list.map(({ id: _key, ...key }) => key) }))
const allIds = (info: DraftInfo) => [
  ...info.tracks.flatMap((track) => [track.id, ...track.segments.map((segment) => segment.id)]),
  ...Object.values(info.materials).flatMap((entries) => (Array.isArray(entries) ? entries.map((entry) => (entry as Entry).id) : [])),
]

/** A person over part of a main piece, the way the write makes one from a range and its rendered file. */
function personOn(info: DraftInfo, cut: number, range: { targetStartUs: number; targetDurationUs: number; sourceStartUs: number }, hash: string): TimelinePerson {
  const piece = info.tracks[0]!.segments[cut]!
  return {
    targetStartUs: range.targetStartUs,
    targetDurationUs: range.targetDurationUs,
    path: `/Users/x/Movies/CapCut/BOXBLACK/cutouts/${hash}.mov`,
    binId: `bin-${hash}`,
    width: 1080,
    height: 1920,
    fileDurationUs: range.targetDurationUs + 33_333,
    clip: piece.clip,
    keyframes: personKeyframes(piece.common_keyframes ?? [], { sourceStartUs: range.sourceStartUs, durationUs: range.targetDurationUs }, range.sourceStartUs - PERSON_SOURCE_START_US),
  }
}

/** 0.2–1.566666 s on piece 0 (41 frames), and 5–6 s on piece 1 (11–12 s of its file). */
const people = (info: DraftInfo) => [
  personOn(info, 0, { targetStartUs: 200_000, targetDurationUs: 1_366_666, sourceStartUs: 200_000 }, "aaaaaaaaaaaaaaaa"),
  personOn(info, 1, { targetStartUs: 5_000_000, targetDurationUs: 1_000_000, sourceStartUs: 11_000_000 }, "bbbbbbbbbbbbbbbb"),
]

test("the person files go on one overlay track of their own, each over its range, played from PERSON_SOURCE_START_US", async () => {
  const { info } = await written()
  const { info: out, trackId } = addPersonTrack(info, people(info))
  expect(out.tracks).toHaveLength(info.tracks.length + 1)
  const track = out.tracks.at(-1)!
  expect(track).toMatchObject({ id: trackId, type: "video", flag: 2, attribute: 0 })
  expect(track.segments.map((segment) => [segment.target_timerange, segment.source_timerange])).toEqual([
    [{ start: 200_000, duration: 1_366_666 }, { start: PERSON_SOURCE_START_US, duration: 1_366_666 }],
    [{ start: 5_000_000, duration: 1_000_000 }, { start: PERSON_SOURCE_START_US, duration: 1_000_000 }],
  ])
  for (const segment of track.segments) expect(segment).toMatchObject({ volume: 0, speed: 1, visible: true, track_render_index: out.tracks.length - 1 })
})

test("a person's material is its own file, silent, with the file's own length and the bin item's id", async () => {
  const { info } = await written()
  const out = addPersonTrack(info, people(info)).info
  const segment = out.tracks.at(-1)!.segments[0]!
  expect(materialOf(out, segment)).toMatchObject({
    type: "video",
    path: "/Users/x/Movies/CapCut/BOXBLACK/cutouts/aaaaaaaaaaaaaaaa.mov",
    material_name: "aaaaaaaaaaaaaaaa.mov",
    local_material_id: "bin-aaaaaaaaaaaaaaaa",
    duration: 1_399_999,
    width: 1080,
    height: 1920,
    has_audio: false,
  })
})

test("every person has a material and segment extras of its own, all new and all found in the draft", async () => {
  const { info } = await written()
  const out = addPersonTrack(info, people(info)).info
  const segments = out.tracks.at(-1)!.segments
  const before = new Set(allIds(info))
  const ids = allIds(out)
  expect(new Set(ids).size).toBe(ids.length)
  for (const segment of segments) {
    expect(before.has(segment.material_id)).toBe(false)
    expect(segment.extra_material_refs).toHaveLength(EXTRA_KEYS.length)
    EXTRA_KEYS.forEach((key, i) => {
      const ref = segment.extra_material_refs[i]!
      expect(before.has(ref)).toBe(false)
      expect(list(out, key).some((entry) => entry.id === ref)).toBe(true)
    })
  }
  expect(list(out, "videos")).toHaveLength(list(info, "videos").length + 2)
})

test("a person is drawn with its main piece's clip and zoomed with the keys it is given, copies of both", async () => {
  const { info } = await written()
  const given = people(info)
  const out = addPersonTrack(info, given).info
  const [first, second] = out.tracks.at(-1)!.segments
  expect(second!.clip).toEqual(info.tracks[0]!.segments[1]!.clip)
  expect(second!.clip).not.toBe(given[1]!.clip)
  expect(first!.common_keyframes).toEqual(given[0]!.keyframes)
  expect(first!.common_keyframes).not.toBe(given[0]!.keyframes)
  // piece 0's punch has landed by 1.35 s of its file, which the range reaches: its key at the end holds 1.15
  expect(first!.common_keyframes!.find((entry) => entry.property_type === "KFTypeScaleX")!.keyframe_list.map((key) => [key.time_offset, key.values[0]])).toEqual([
    [16_667, 1],
    [816_667, 1],
    [1_166_667, 1.15],
    [1_383_333, 1.15],
  ])
})

test("people given out of order go on the track in the order they play; two that overlap are refused", async () => {
  const { info } = await written()
  const [a, b] = people(info)
  expect(addPersonTrack(info, [b!, a!]).info.tracks.at(-1)!.segments.map((segment) => segment.target_timerange.start)).toEqual([200_000, 5_000_000])
  expect(() => addPersonTrack(info, [a!, { ...a!, targetStartUs: 1_000_000 }])).toThrow(/overlap/)
})

test("no people, no track: the draft comes back as it was, and the one given is never changed", async () => {
  const { info } = await written()
  const before = structuredClone(info)
  expect(addPersonTrack(info, [])).toEqual({ info: before, trackId: null })
  addPersonTrack(info, people(info))
  expect(info).toEqual(before)
})

/** Copies of the pieces over the same two ranges, for CapCut to cut the person out of. */
const copies = (folder: string): TimelineMattingCopy[] => [
  { cut: 0, targetStartUs: 200_000, targetDurationUs: 1_366_666, sourceStartUs: 200_000, draftFolder: folder },
  { cut: 1, targetStartUs: 5_000_000, targetDurationUs: 1_000_000, sourceStartUs: 11_000_000, draftFolder: folder },
]

test("the copies go on one overlay track of their own, each over its range and at the piece's own place in the file", async () => {
  const { info, folder } = await written()
  const { info: out, trackId } = addMattingTrack(info, copies(folder))
  expect(out.tracks).toHaveLength(info.tracks.length + 1)
  const track = out.tracks.at(-1)!
  expect(track).toMatchObject({ id: trackId, type: "video", flag: 2 })
  expect(track.segments.map((segment) => [segment.target_timerange, segment.source_timerange])).toEqual([
    [{ start: 200_000, duration: 1_366_666 }, { start: 200_000, duration: 1_366_666 }],
    [{ start: 5_000_000, duration: 1_000_000 }, { start: 11_000_000, duration: 1_000_000 }],
  ])
  for (const segment of track.segments) expect(segment).toMatchObject({ volume: 0, speed: 1, track_render_index: out.tracks.length - 1 })
})

test("a copy's material is its piece's own, silent, with CapCut's background removal on and a mask folder named by its file", async () => {
  const { info, folder } = await written()
  const out = addMattingTrack(info, copies(folder)).info
  const [first, second] = out.tracks.at(-1)!.segments
  const own = materialOf(info, info.tracks[0]!.segments[0]!)
  const copy = materialOf(out, first!)
  // md5 of "/fixture/media/IMG_9646.MOV" in lower-case hex
  const matting = { ...(own.matting as object), flag: 3, path: `${folder}/matting/d380e38686606d5cf03d6dac80c58c8e`, custom_matting_id: expect.stringMatching(UPPER_UUID) }
  expect(copy).toEqual({ ...own, id: copy.id, unique_id: expect.stringMatching(/^[0-9a-f]{32}$/), has_audio: false, matting })
  expect(copy.id).not.toBe(own.id)
  expect(copy.unique_id).not.toBe(own.unique_id)
  // both copies read the one mask folder of their file, each under an id of its own
  const other = materialOf(out, second!)
  expect((other.matting as { path: string }).path).toBe(matting.path)
  expect((other.matting as { custom_matting_id: string }).custom_matting_id).not.toBe((copy.matting as { custom_matting_id: string }).custom_matting_id)
  // the piece's own material is left as it was
  expect(materialOf(out, out.tracks[0]!.segments[0]!)).toEqual(own)
})

test("the mask folder is named by the md5 of the material path's UTF-8 bytes", async () => {
  const { info, folder } = await written()
  const own = materialOf(info, info.tracks[0]!.segments[0]!)
  own.path = "/Users/x/Movies/คลิปของฉัน/ตัด 1.MOV"
  const out = addMattingTrack(info, copies(folder).slice(0, 1)).info
  expect(materialOf(out, out.tracks.at(-1)!.segments[0]!).matting).toMatchObject({ path: `${folder}/matting/df64ee82fd9e7c15d61f5ebeae39c3fb` })
})

test("every copy has segment extras of its own, and its piece's clip and zoom keys under new ids", async () => {
  const { info, folder } = await written()
  const out = addMattingTrack(info, copies(folder)).info
  const before = new Set(allIds(info))
  const ids = allIds(out)
  expect(new Set(ids).size).toBe(ids.length)
  out.tracks.at(-1)!.segments.forEach((segment, cut) => {
    const piece = info.tracks[0]!.segments[cut]!
    EXTRA_KEYS.forEach((key, i) => {
      const ref = segment.extra_material_refs[i]!
      expect(before.has(ref)).toBe(false)
      expect(list(out, key).some((entry) => entry.id === ref)).toBe(true)
    })
    expect(segment.clip).toEqual(piece.clip)
    // the same file at the same source time as the piece: the same keys, each under a new id
    expect(withoutIds(segment.common_keyframes!)).toEqual(withoutIds(piece.common_keyframes!))
    const keyIds = segment.common_keyframes!.flatMap((entry) => [entry.id, ...entry.keyframe_list.map((key) => key.id)])
    const pieceIds = new Set(piece.common_keyframes!.flatMap((entry) => [entry.id, ...entry.keyframe_list.map((key) => key.id)]))
    for (const id of keyIds) expect(pieceIds.has(id)).toBe(false)
  })
})

test("no copies, no track; a copy of a piece that is not there is refused", async () => {
  const { info, folder } = await written()
  const before = structuredClone(info)
  expect(addMattingTrack(info, [])).toEqual({ info: before, trackId: null })
  expect(() => addMattingTrack(info, [{ ...copies(folder)[0]!, cut: 5 }])).toThrow(/no main piece 5/)
  addMattingTrack(info, copies(folder))
  expect(info).toEqual(before)
})
```

- [ ] **Step 10: Run the test and see it fail.**

  Run: `npx vitest run packages/core/src/capcut/person.test.ts`

  Expected: FAIL with `Error: Cannot find module './person.ts'`.

- [ ] **Step 11: Implement.**

  Create `packages/core/src/capcut/person.ts`:

```ts
import { createHash, randomUUID } from "node:crypto"
import { basename, join } from "node:path"
import { PERSON_SOURCE_START_US } from "../cutout/frames.ts"
import { copiedKeyframes } from "../cutout/keyframes.ts"
import { newId, segmentExtras, videoMaterial, videoSegment } from "./templates.ts"
import type { DraftInfo, Keyframes, Segment, Track } from "./types.ts"

/** One of our person files, laid over the part of a main piece its range covers. */
export interface TimelinePerson {
  targetStartUs: number
  targetDurationUs: number
  /** <cutoutsDir>/<hash>.mov */
  path: string
  /** the bin item, which the material points at with `local_material_id` */
  binId: string
  width: number
  height: number
  /** the person file's own length: its range's frames and the spare one */
  fileDurationUs: number
  /** the main piece's clip, copied */
  clip: unknown
  /** personKeyframes(...) */
  keyframes: Keyframes[]
}

/** A silent copy of a main piece over the part of it a range covers, for CapCut's background removal to cut out. */
export interface TimelineMattingCopy {
  /** main piece index in info.tracks[0] */
  cut: number
  targetStartUs: number
  targetDurationUs: number
  sourceStartUs: number
  draftFolder: string
}

/**
 * The render index the proof wrote on its person and copy segments (0917, 2026-09-29). CapCut layers by the order
 * of tracks[], not by this: the write puts the track over the behind text and under the rest with arrangeTracks.
 */
const RENDER_INDEX = 1

/**
 * The items in the order they play, refusing two that overlap: they all go on one track, and a track plays one
 * segment at a time. The ranges they come from never overlap (one group ends before the next starts), so an
 * overlap is a mistake upstream, better stopped here than written.
 */
function oneTrack<T extends { targetStartUs: number; targetDurationUs: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.targetStartUs - b.targetStartUs)
  sorted.forEach((item, i) => {
    const before = sorted[i - 1]
    if (before && before.targetStartUs + before.targetDurationUs > item.targetStartUs) {
      throw new Error(`two person layers overlap at ${item.targetStartUs} µs: one track cannot play both`)
    }
  })
  return sorted
}

/** The draft's materials with these video materials and segment extras added after the ones already there. */
function withMaterials(info: DraftInfo, videos: unknown[], extras: [key: string, entry: unknown][]): Record<string, unknown> {
  const existing = (key: string) => (Array.isArray(info.materials[key]) ? (info.materials[key] as unknown[]) : [])
  const merged: Record<string, unknown> = { ...info.materials, videos: [...existing("videos"), ...videos] }
  const byKey = new Map<string, unknown[]>()
  for (const [key, entry] of extras) byKey.set(key, [...(byKey.get(key) ?? []), entry])
  for (const [key, entries] of byKey) merged[key] = [...existing(key), ...entries]
  return merged
}

/** An overlay video track, `flag: 2` as CapCut writes one for a picture laid over the main one. */
const overlayTrack = (segments: Segment[]): Track => ({ id: newId(), type: "video", flag: 2, attribute: 0, name: "", is_default_name: true, segments })

/**
 * One overlay track (flag 2) of our person files; source.start = PERSON_SOURCE_START_US, volume 0, has_audio false.
 * Pure. File frame j + 1 is what the main piece shows on the range's frame j (personFrames), and starting the file
 * PERSON_SOURCE_START_US in makes CapCut show exactly that frame there. Each person is drawn with the main piece's
 * clip and zoomed with its keys, or the two pictures part while the piece zooms (0917, 2026-09-29). Every person
 * gets a material and segment extras of its own, as every segment CapCut writes has.
 */
export function addPersonTrack(info: DraftInfo, people: TimelinePerson[]): { info: DraftInfo; trackId: string | null } {
  const out = structuredClone(info)
  if (people.length === 0) return { info: out, trackId: null }
  const trackIndex = out.tracks.length
  const videos: unknown[] = []
  const extras: [key: string, entry: unknown][] = []

  const segments = oneTrack(people).map((person) => {
    const materialId = newId()
    const material = videoMaterial(materialId, { id: person.binId, path: person.path, name: basename(person.path), durationUs: person.fileDurationUs, width: person.width, height: person.height })
    // the picture only: the main piece under it already plays the sound
    videos.push({ ...material, has_audio: false })
    const own = segmentExtras()
    extras.push(...own)
    const segment = videoSegment({
      id: newId(),
      materialId,
      extraRefs: own.map(([, entry]) => entry.id),
      source: { start: PERSON_SOURCE_START_US, duration: person.targetDurationUs },
      target: { start: person.targetStartUs, duration: person.targetDurationUs },
    })
    return {
      ...segment,
      volume: 0,
      clip: structuredClone(person.clip),
      common_keyframes: structuredClone(person.keyframes),
      render_index: RENDER_INDEX,
      track_render_index: trackIndex,
    }
  })

  out.materials = withMaterials(out, videos, extras)
  const track = overlayTrack(segments)
  out.tracks = [...out.tracks, track]
  return { info: out, trackId: track.id }
}

/**
 * One overlay track of silent copies of main pieces with CapCut's background removal (spec §8): each copy gets a
 * fresh video material cloned from its piece's (new id, new unique_id, has_audio false,
 * matting = { ...cloned.matting, flag: 3, path: `${draftFolder}/matting/${md5hex(utf8(material.path))}`, custom_matting_id: UUID upper-case })
 * and fresh segmentExtras; volume 0; clip and copiedKeyframes of the piece.
 *
 * Pure. CapCut computes the masks itself when it opens the draft, into that folder, which belongs to the file and
 * is shared by every piece of it. The fields are the ones CapCut writes when the user switches removal on by hand;
 * with a random placeholder in place of the path it computed nothing (0917, 2026-09-29). The copy plays the piece's
 * own file at the piece's own source time, so the piece's zoom keys fit it as they are. Exporting it needs CapCut
 * Pro. CapCut sets has_audio back to true when it re-saves; volume 0 is what keeps the copy silent.
 */
export function addMattingTrack(info: DraftInfo, copies: TimelineMattingCopy[]): { info: DraftInfo; trackId: string | null } {
  const out = structuredClone(info)
  if (copies.length === 0) return { info: out, trackId: null }
  const main = out.tracks[0]
  if (main?.type !== "video") throw new Error("the draft has no main video track to copy")
  const materials = (Array.isArray(out.materials.videos) ? out.materials.videos : []) as { id: string; path?: unknown; matting?: unknown }[]
  const trackIndex = out.tracks.length
  const videos: unknown[] = []
  const extras: [key: string, entry: unknown][] = []

  const segments = oneTrack(copies).map((copy) => {
    const piece = main.segments[copy.cut]
    if (!piece) throw new Error(`there is no main piece ${copy.cut} to copy`)
    const material = materials.find((entry) => entry.id === piece.material_id)
    if (!material) throw new Error(`main piece ${copy.cut} has no video material`)
    const path = typeof material.path === "string" ? material.path : ""
    const materialId = newId()
    videos.push({
      ...structuredClone(material),
      id: materialId,
      unique_id: randomUUID().replaceAll("-", ""),
      has_audio: false,
      matting: {
        ...(structuredClone(material.matting) as Record<string, unknown> | undefined),
        flag: 3,
        path: join(copy.draftFolder, "matting", createHash("md5").update(path, "utf8").digest("hex")),
        custom_matting_id: newId(),
      },
    })
    const own = segmentExtras()
    extras.push(...own)
    const segment = videoSegment({
      id: newId(),
      materialId,
      extraRefs: own.map(([, entry]) => entry.id),
      source: { start: copy.sourceStartUs, duration: copy.targetDurationUs },
      target: { start: copy.targetStartUs, duration: copy.targetDurationUs },
    })
    return {
      ...segment,
      volume: 0,
      clip: structuredClone(piece.clip),
      common_keyframes: copiedKeyframes(piece.common_keyframes ?? []),
      render_index: RENDER_INDEX,
      track_render_index: trackIndex,
    }
  })

  out.materials = withMaterials(out, videos, extras)
  const track = overlayTrack(segments)
  out.tracks = [...out.tracks, track]
  return { info: out, trackId: track.id }
}
```

- [ ] **Step 12: Run the test and see it pass.**

  Run: `npx vitest run packages/core/src/capcut/person.test.ts`

  Expected: PASS (11 tests).

#### 6d. Exports

- [ ] **Step 13: Export what the later tasks use.**

  Create `packages/core/src/cutout/index.ts`. Task 14 adds `export * from "./occlusion.ts"` to it.

```ts
export * from "./frames.ts"
export * from "./keyframes.ts"
export * from "./ranges.ts"
```

  In `packages/core/src/capcut/index.ts`, replace:

```ts
export { buildRoughCut, outputCanvas } from "./rough-cut.ts"
```

  with:

```ts
export { atOn, buildRoughCut, cutFrames, outputCanvas, type PieceFrames } from "./rough-cut.ts"
```

  and replace:

```ts
export { addBinItems, binIdOf, graphicBinItem, pruneBinItems } from "./bin.ts"
```

  with:

```ts
export { addBinItems, binIdOf, graphicBinItem, isRenderedFile, isRenderedGraphic, pruneBinItems, RENDERED_FOLDERS } from "./bin.ts"
export { addedTracks, arrangeTracks } from "./layers.ts"
export { addMattingTrack, addPersonTrack, type TimelineMattingCopy, type TimelinePerson } from "./person.ts"
```

  In `packages/core/package.json`, main imports core by subpath, and a subpath missing from `exports` cannot be imported at all. Replace:

```json
    "./capcut/bin": "./src/capcut/bin.ts",
```

  with:

```json
    "./capcut/bin": "./src/capcut/bin.ts",
    "./capcut/layers": "./src/capcut/layers.ts",
    "./capcut/person": "./src/capcut/person.ts",
    "./cutout": "./src/cutout/index.ts",
```

  Run: `npm run typecheck`

  Expected: clean.

- [ ] **Step 14: Commit.** Run `npm test` and `npm run typecheck` from the repo root. Both must be clean.


---

### Task 7: The person cutter `boxblack-segment`: Swift helper, build script, parity fixture, tests

**Files:**
- Create: `apps/desktop/native/segment/main.swift` (the command line, options, one-line failures)
- Create: `apps/desktop/native/segment/Source.swift` (AVFoundation: `probe`, decoding, 420v frames into pictures at the output size)
- Create: `apps/desktop/native/segment/Filters.swift` (bicubic and linear resize, guided filter, 1-2-3-2-1 smoother)
- Create: `apps/desktop/native/segment/Masks.swift` (Vision masks; `--raw-masks` PNG masks)
- Create: `apps/desktop/native/segment/Render.swift` (`render`: yuva444p10le out, progress, coverage; `sample`)
- Create: `apps/desktop/native/segment/reference/final-masks.py` (the reference for the user's chosen filter)
- Create (written once by the reference, then kept): `apps/desktop/native/segment/fixtures/parity/frames/0.png … 6.png`, `masks/0.png … 6.png`, `expected/0.png … 6.png`
- Create: `apps/desktop/scripts/build-segment.sh`
- Create (built, like `ffmpeg` and `whisper-cli`): `apps/desktop/resources/bin/boxblack-segment`
- Test: `apps/desktop/src/main/native-segment.test.ts`

Read before starting:
- The CLI is the contract's (`probe`, `render`, `sample`, `--version`). It supersedes spec §7.1's `masks --frames` form: the helper decodes the source itself, as §7.2 step 5 recommends, because the app's ffmpeg has no rawvideo muxer.
- The helper matches the contract on these points too:
  - `probe` gives `transfer` and `primaries` in ffprobe's words: `bt709`, `arib-std-b67`, `smpte2084`, `bt2020` and so on. A value ffprobe has no word for is passed on as AVFoundation names it.
  - `rotation` is how far the picture turns clockwise to be shown: 0, 90, 180 or 270. ffprobe's `-90` is 90 here.
  - `probe`'s times are track times, with the edit list applied, as ffprobe and the decoded frames have them. Stored samples carry media times, and on a file with B-frames the two differ: x264 files start at 1024/15360. Without the mapping, `probe` and `render` would disagree by that offset.
  - `render` asks for a list that never goes back: one forward pass through the file. `personFrames` lists are never decreasing, and repeats are fine. A list that goes back is refused with a one-line failure.
  - `render`'s samples are always video range (the decoder is asked for 420v), whatever the source's range. The encode must say `-color_range tv`.
  - `render` writes the frames as stored. The app never cuts a source that turns (§6.2).
  - `sample` turns each frame upright first. The Pro route has no source check, so a turned source can reach it, and the mask must match the frame as shown.
  - `--raw-masks <dir>` reads `<dir>/<i>.png` for list position `i`, counted from 0. Each is 8-bit grey, any size.
  - `--radius` defaults to `round(12 × min(W, H) / 1080)`, never below 1.
  - A usage mistake exits 2. Any other failure exits 1. Either way stderr gets one line.
- Checked in a scratch copy of the repo on 2026-09-29 (Xcode 27, Swift 6.4, macOS 27, the app's ffmpeg 8.1.2):
  - The build had no warnings: 180 KB after `strip -x`, arm64 only, `minos 12.0`, system libraries only.
  - The eight tests below passed in about 5 s, build included.
  - The parity check came out at most 2 levels off inside the border and 1 level on it. It fails when the radius, eps, box or temporal weights change.
  - `probe` of 0917's `IMG_9646.MOV` gave exactly the 933 pts of facts.md, in 58 ms.
  - The frames `render` picked were bit-exact with ffmpeg's decode of the same frames, on an edit-listed file too.
  - With Vision, a 1080×1920 frame takes about 55 ms (about 1.7 s per second of video). Peak memory stays near 560 MB whatever the frame count; that is Vision's model.

- [ ] **Step 1: Write the reference, and make the parity fixture with it.**

  `apps/desktop/native/segment/reference/final-masks.py`:

```python
"""
THE REFERENCE FOR THE USER'S CHOSEN MASK FILTER ("panel 4" of flicker-compare2, spec 2026-09-29 §1.1 and §7.1).
boxblack-segment does the same maths in Swift; native-segment.test.ts checks its alpha against what this writes.

This is final-masks.py from the 2026-09-29 spike, with its maths unchanged:
  - the guide is the frame's brightness as 0..1;
  - the mask is resized to the frame's size with ffmpeg's bicubic and read as 0..1;
  - He's guided filter: box radius r (scipy uniform_filter, reflect), eps 1e-3 (not squared), clipped to 0..1;
  - weights 1-2-3-2-1 over +-2 frames, the frame index clamped at the ends, rounded to 8 bits.
What is adapted:
  - the size: 180x320 frames (not 1080x1920) and the helper's default radius at that size, round(12 x 180 / 1080) = 2;
  - the guide: the helper reads the decoder's video-range luma (16..235) where the spike read full-range JPEG
    frames, so both map to 0..1 as full range: (Y - 16) / 219;
  - file names: 0-based, no padding, as the helper's --raw-masks reads them;
  - the inputs: drawn here, a synthetic stand-in figure and stand-in masks. Never a frame of a real person.

  python3 apps/desktop/native/segment/reference/final-masks.py apps/desktop/native/segment/fixtures/parity

writes <fixture>/frames/<i>.png (the 8-bit luma the test video carries, 180x320), <fixture>/masks/<i>.png
(stand-ins for Vision's masks, 252x336: Vision's 1512x2016 over six, so the resize shrinks by the same 1.4 and 1.05)
and <fixture>/expected/<i>.png (the filter's answer, 180x320), for i = 0..6. Run it once; the files are committed.
Needs numpy, scipy and ffmpeg 8.1.2 with a rawvideo muxer (Homebrew's, /opt/homebrew/bin/ffmpeg; the app's own
ffmpeg cannot write raw frames).
"""
import os, subprocess, sys
import numpy as np
from scipy import ndimage

FF = "/opt/homebrew/bin/ffmpeg"
W, H = 180, 320
MW, MH = 252, 336
N = 7
R = 2
work = sys.argv[1]
for sub in ("frames", "masks", "expected"):
    os.makedirs(f"{work}/{sub}", exist_ok=True)


def write_png(path, pixels):
    h, w = pixels.shape
    subprocess.run([FF, "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-i", "-", "-y", path], input=pixels.astype(np.uint8).tobytes(), check=True)


def figure(x, y, i, grow=0.0, soft=1.0):
    """How much of the stand-in figure covers frame point (x, y) of frame i, 0..1: a head and a body that walk
    right 3 px a frame, `grow` px bigger all round, with an edge `soft` px wide."""
    cx = 84 + 3 * i
    head = (1 - np.hypot((x - cx) / (26 + grow), (y - 96) / (32 + grow))) * (26 + grow)
    body = (1 - np.hypot((x - cx) / (58 + grow), (y - 290) / (120 + grow))) * (58 + grow)
    return np.clip(np.maximum(head, body) / soft + 0.5, 0, 1)


# the frames: a textured, graded background and a shaded figure, in video range
ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
for i in range(N):
    background = 40 + 50 * ys / H + 8 * np.sin(xs / 7) * np.cos(ys / 11)
    person = 170 + 20 * np.sin(ys / 15 + i)
    cover = figure(xs, ys, i)
    write_png(f"{work}/frames/{i}.png", np.clip(np.round(background * (1 - cover) + person * cover), 16, 235))

# the stand-in masks: like Vision's, a little too big, soft, and wobbling from frame to frame, with a stray blob in
# frame 3 (Vision took part of a chair once); drawn at the mask's own size over the whole frame
mv, mu = np.mgrid[0:MH, 0:MW].astype(np.float64)
fx, fy = (mu + 0.5) * W / MW - 0.5, (mv + 0.5) * H / MH - 0.5
for i in range(N):
    mask = figure(fx, fy, i, grow=3 + (1.5 if i % 2 else -1.5), soft=4)
    if i == 3:
        mask = np.maximum(mask, np.clip(1 - np.hypot(fx - 160, fy - 40) / 9, 0, 1))
    write_png(f"{work}/masks/{i}.png", np.round(mask * 255))


# final-masks.py from here on
def gray(path):
    out = subprocess.run([FF, "-v", "error", "-i", path, "-vf", f"scale={W}:{H}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.uint8).reshape(H, W).astype(np.float32) / 255


def guided(guide, src, r=R, eps=1e-3):
    box = lambda x: ndimage.uniform_filter(x, size=2 * r + 1, mode="reflect")
    mean_i, mean_p = box(guide), box(src)
    a = (box(guide * src) - mean_i * mean_p) / (box(guide * guide) - mean_i * mean_i + eps)
    b = mean_p - a * mean_i
    return np.clip(box(a) * guide + box(b), 0, 1)


def luma(path):
    return np.clip((gray(path) * 255 - 16) / 219, 0, 1).astype(np.float32)


snapped = [guided(luma(f"{work}/frames/{k}.png"), gray(f"{work}/masks/{k}.png")) for k in range(N)]
weights = np.array([1, 2, 3, 2, 1], dtype=np.float32)
for i in range(N):
    mask = sum(w * snapped[min(max(i + d, 0), N - 1)] for w, d in zip(weights, range(-2, 3))) / weights.sum()
    write_png(f"{work}/expected/{i}.png", (np.clip(mask, 0, 1) * 255).round())
print(f"{work}: {N} frames, masks and expected masks")
```

  Run it once, from the repo root: `python3 apps/desktop/native/segment/reference/final-masks.py apps/desktop/native/segment/fixtures/parity`. It needs numpy, scipy and Homebrew's ffmpeg: the app's ffmpeg cannot write raw frames.

  Expected: `apps/desktop/native/segment/fixtures/parity: 7 frames, masks and expected masks`, and 21 PNG files of about 130 KB in all.
  - Open `frames/3.png` to check it: a grey stand-in figure on a textured background, not a person.
  - The files stay in the repo, and the tests read them as they are.
  - Run the script again only when the filter changes on purpose. Then also bump `CUTOUT_PIPELINE_VERSION`.

- [ ] **Step 2: Write the failing test.**

  `apps/desktop/src/main/native-segment.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, deflateSync, inflateSync } from "node:zlib"

/**
 * boxblack-segment built from its source (native/segment) by its own build script, run on a small synthetic clip
 * that the app's ffmpeg makes here. The parity fixture (native/segment/fixtures/parity) was made once by
 * native/segment/reference/final-masks.py, the user's chosen filter in numpy; the helper's alpha must match it.
 * Needs Xcode or the Command Line Tools (xcrun swiftc) and resources/bin/ffmpeg: skipped without either.
 */
const DESKTOP = join(import.meta.dirname, "../..")
const SCRIPT = join(DESKTOP, "scripts/build-segment.sh")
const FIXTURE = join(DESKTOP, "native/segment/fixtures/parity")
const ffmpeg = join(DESKTOP, "resources/bin/ffmpeg")
const VERSION = /^VERSION=(\S+)$/m.exec(readFileSync(SCRIPT, "utf8"))?.[1]

function hasSwift(): boolean {
  try {
    execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ready = hasSwift() && existsSync(ffmpeg)

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** An 8-bit grey PNG as the reference script (through ffmpeg) writes them: any of the five row filters, not interlaced. */
function readGrayPng(path: string): Uint8Array {
  const file = readFileSync(path)
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${path} is not a PNG`)
  let width = 0
  let height = 0
  const compressed: Buffer[] = []
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at)
    const type = file.toString("latin1", at + 4, at + 8)
    const body = file.subarray(at + 8, at + 8 + length)
    if (type === "IHDR") {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[9] !== 0 || body[12] !== 0) throw new Error(`${path} is not an 8-bit grey PNG`)
    } else if (type === "IDAT") compressed.push(body)
    at += 12 + length
  }
  const rows = inflateSync(Buffer.concat(compressed))
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const filter = rows[y * (width + 1)]!
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? data[y * width + x - 1]! : 0
      const up = y > 0 ? data[(y - 1) * width + x]! : 0
      const corner = x > 0 && y > 0 ? data[(y - 1) * width + x - 1]! : 0
      const guess = left + up - corner
      const paeth =
        Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - corner) ? left : Math.abs(guess - up) <= Math.abs(guess - corner) ? up : corner
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter]!
      data[y * width + x] = (rows[y * (width + 1) + 1 + x]! + predictor) & 0xff
    }
  }
  return data
}

/** An 8-bit grey PNG, for masks made in a test. */
function writeGrayPng(path: string, width: number, height: number, level: (x: number, y: number) => number): void {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length, 0)
    head.write(type, 4, "latin1")
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
    return Buffer.concat([head, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  const rows = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = level(x, y)
  writeFileSync(path, Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]))
}

// the clip: the fixture's 180×320 luma, seven frames at timescale 600, one 21-tick step (as 0917's source has)
const W = 180
const H = 320
const PTS = [0, 20, 40, 60, 81, 101, 121]
// a colour that is not grey, so black (U = V = 512) cannot pass for the picture
const U = 600
const V = 440

/** A yuva444p10le frame's four planes. */
function planesOf(out: Buffer, frame: number, width: number, height: number) {
  const size = width * height
  const plane = (k: number) => Array.from({ length: size }, (_, p) => out.readUInt16LE((frame * 4 * size + k * size + p) * 2))
  return { y: plane(0), u: plane(1), v: plane(2), a: plane(3) }
}

describe.skipIf(!ready)("boxblack-segment built from native/segment (needs xcrun swiftc and resources/bin/ffmpeg)", () => {
  let dir: string
  let helper: string
  let source: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "boxblack-segment-"))
    execFileSync("sh", [SCRIPT, join(dir, "bin")], { stdio: "pipe" })
    helper = join(dir, "bin", "boxblack-segment")
    // ProRes 422 HQ from raw 10-bit frames: the app's ffmpeg has no lavfi device, and this keeps the luma exact
    // enough that the parity check measures the filter, not the codec
    const frames = Buffer.alloc(PTS.length * W * H * 4)
    PTS.forEach((_, i) => {
      const luma = readGrayPng(join(FIXTURE, "frames", `${i}.png`))
      const at = i * W * H * 4
      for (let p = 0; p < W * H; p++) frames.writeUInt16LE(luma[p]! * 4, at + p * 2)
      for (let p = 0; p < (W / 2) * H; p++) {
        frames.writeUInt16LE(U, at + W * H * 2 + p * 2)
        frames.writeUInt16LE(V, at + W * H * 3 + p * 2)
      }
    })
    source = join(dir, "source.mov")
    // the colour tags go on the input: as output options after a filter, ffmpeg 8.1.2 leaves primaries and transfer unset
    execFileSync(ffmpeg, [
      "-v", "error", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
      "-f", "rawvideo", "-pix_fmt", "yuv422p10le", "-s", `${W}x${H}`, "-framerate", "30", "-i", "-",
      "-vf", "settb=1/600,setpts='20*N+gte(N,4)'", "-fps_mode", "passthrough", "-enc_time_base:v", "1/600", "-video_track_timescale", "600",
      "-c:v", "prores_ks", "-profile:v", "3", source,
    ], { input: frames })
  }, 300_000)

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function times(pts: number[]): string {
    const file = join(dir, `pts-${pts.join("-")}.json`)
    writeFileSync(file, JSON.stringify({ pts }))
    return file
  }

  function masks(name: string, count: number, width: number, height: number, level: (x: number, y: number) => number): string {
    const folder = join(dir, name)
    mkdirSync(folder, { recursive: true })
    for (let i = 0; i < count; i++) writeGrayPng(join(folder, `${i}.png`), width, height, level)
    return folder
  }

  function run(args: string[]) {
    const result = spawnSync(helper, args, { maxBuffer: 1 << 30 })
    return { status: result.status, out: result.stdout, lines: result.stderr.toString().trim().split("\n") }
  }

  test("says its version, the one the build script pins", () => {
    expect(execFileSync(helper, ["--version"], { encoding: "utf8" })).toBe(`boxblack-segment ${VERSION}\n`)
  })

  test("probe: the track's timescale and every frame's own time, the 21-tick step included, with the size, the turn and the colour tags", () => {
    expect(JSON.parse(execFileSync(helper, ["probe", source], { encoding: "utf8" }))).toEqual({
      timescale: 600,
      pts: PTS,
      width: W,
      height: H,
      rotation: 0,
      transfer: "bt709",
      primaries: "bt709",
    })
  })

  test("render: one yuva444p10le frame per time asked, in order; a time asked twice is the same frame twice", () => {
    // whole masks, so every sample of every frame is the picture
    const { status, out, lines } = run(["render", source, "--pts", times([0, 20, 20, 40]), "--width", `${W}`, "--height", `${H}`, "--raw-masks", masks("whole", 4, 1, 1, () => 255)])
    expect(status).toBe(0)
    expect(out.length).toBe(W * H * 4 * 2 * 4)
    const frame = (k: number) => out.subarray(k * W * H * 8, (k + 1) * W * H * 8)
    expect(frame(2).equals(frame(1))).toBe(true)
    expect(frame(1).equals(frame(0))).toBe(false)
    const first = planesOf(out, 0, W, H)
    expect(first.a.every((alpha) => alpha === 1023)).toBe(true)
    // the source's own samples, 8 bits × 4: ProRes gives the luma back within a level, the flat colour exactly
    const luma = readGrayPng(join(FIXTURE, "frames", "0.png"))
    expect(Math.max(...first.y.map((y, p) => Math.abs(y - luma[p]! * 4)))).toBeLessThanOrEqual(4)
    expect(new Set(first.u)).toEqual(new Set([U]))
    expect(new Set(first.v)).toEqual(new Set([V]))
    expect(lines.slice(-2)).toEqual(["progress 4 4", "coverage 1.000000"])
  })

  test("render: black (Y 64, U 512, V 512) wherever the mask is 0 and the picture wherever it is whole, at a smaller size too", () => {
    const { status, out, lines } = run(["render", source, "--pts", times([40, 60, 81]), "--width", "90", "--height", "160", "--raw-masks", masks("half", 3, 90, 160, (x) => (x < 45 ? 255 : 0))])
    expect(status).toBe(0)
    expect(out.length).toBe(90 * 160 * 4 * 2 * 3)
    for (let frame = 0; frame < 3; frame++) {
      const { y, u, v, a } = planesOf(out, frame, 90, 160)
      for (let row = 0; row < 160; row++) {
        // well clear of the mask's edge, beyond the filter's reach
        for (let x = 60; x < 90; x++) expect([a[row * 90 + x], y[row * 90 + x], u[row * 90 + x], v[row * 90 + x]]).toEqual([0, 64, 512, 512])
        for (let x = 0; x < 30; x++) expect([a[row * 90 + x], u[row * 90 + x], v[row * 90 + x]]).toEqual([1023, U, V])
      }
    }
    // half the frame is person, give or take the soft edge
    expect(Number(/^coverage (\S+)$/.exec(lines.at(-1)!)?.[1])).toBeCloseTo(0.5, 2)
  })

  test("render: the filtered alpha is the user's chosen filter (reference/final-masks.py) within 8 levels, at the default radius", () => {
    // no --radius: the default at 180×320 is round(12 × 180 / 1080) = 2, the reference's
    const { status, out } = run(["render", source, "--pts", times(PTS), "--width", `${W}`, "--height", `${H}`, "--raw-masks", join(FIXTURE, "masks")])
    expect(status).toBe(0)
    // numpy reflects at the frame's edge where the helper repeats the edge sample: they may differ within 4 radii of it
    const BORDER = 8
    let inside = 0
    let edge = 0
    PTS.forEach((_, frame) => {
      const expected = readGrayPng(join(FIXTURE, "expected", `${frame}.png`))
      const { a } = planesOf(out, frame, W, H)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const off = Math.abs(Math.round((a[y * W + x]! * 255) / 1023) - expected[y * W + x]!)
          if (x >= BORDER && x < W - BORDER && y >= BORDER && y < H - BORDER) inside = Math.max(inside, off)
          else edge = Math.max(edge, off)
        }
      }
    })
    expect(inside).toBeLessThanOrEqual(8)
    expect(edge).toBeLessThanOrEqual(32)
  })

  test("render and sample with Vision: they run, render says its coverage, and every frame and mask has its size", () => {
    const rendered = run(["render", source, "--pts", times(PTS), "--width", `${W}`, "--height", `${H}`])
    expect(rendered.status).toBe(0)
    expect(rendered.out.length).toBe(W * H * 4 * 2 * PTS.length)
    expect(rendered.lines.at(-2)).toBe(`progress ${PTS.length} ${PTS.length}`)
    const coverage = Number(/^coverage (\S+)$/.exec(rendered.lines.at(-1)!)?.[1])
    expect(coverage).toBeGreaterThanOrEqual(0)
    expect(coverage).toBeLessThanOrEqual(1)

    // one line per time asked, in the order asked, a repeat included; the long side is --size, the shape the frame's
    const sampled = run(["sample", source, "--pts", times([81, 0, 81]), "--size", "64"])
    expect(sampled.status).toBe(0)
    const lines = sampled.out.toString().trim().split("\n").map((line) => JSON.parse(line) as { pts: number; width: number; height: number; mask: string })
    expect(lines.map((line) => [line.pts, line.width, line.height, Buffer.from(line.mask, "base64").length])).toEqual([
      [81, 36, 64, 36 * 64],
      [0, 36, 64, 36 * 64],
      [81, 36, 64, 36 * 64],
    ])
  }, 120_000)

  test("sample: a clip stored lying down gives its mask as shown, upright", () => {
    // what a phone does with a portrait video: the pixels stored on their side and a turn in the display matrix
    const turned = join(dir, "turned.mov")
    execFileSync(ffmpeg, ["-v", "error", "-display_rotation", "-90", "-i", source, "-c", "copy", "-video_track_timescale", "600", turned])
    expect(JSON.parse(execFileSync(helper, ["probe", turned], { encoding: "utf8" }))).toMatchObject({ rotation: 90, width: W, height: H })
    const sampled = run(["sample", turned, "--pts", times([0]), "--size", "64"])
    expect(JSON.parse(sampled.out.toString())).toMatchObject({ pts: 0, width: 64, height: 36 })
  }, 60_000)

  test("a failure is one line on stderr and a non-zero exit", () => {
    const missing = run(["render", source, "--pts", times([0, 30]), "--width", `${W}`, "--height", `${H}`, "--raw-masks", join(FIXTURE, "masks")])
    expect(missing.status).toBe(1)
    expect(missing.lines).toEqual(["the video has no frame at 30 (the next one is at 40)"])
    const backwards = run(["render", source, "--pts", times([20, 0]), "--width", `${W}`, "--height", `${H}`])
    expect(backwards.status).toBe(1)
    expect(backwards.lines).toEqual(["the times asked for go back at position 1 (20 then 0)"])
    const nothing = run(["probe", join(dir, "nothing.mov")])
    expect(nothing.status).toBe(1)
    expect(nothing.lines).toEqual([`no file at ${join(dir, "nothing.mov")}`])
    const unknown = run(["render", source, "--speed", "2"])
    expect(unknown.status).toBe(2)
    expect(unknown.lines).toHaveLength(1)
    expect(unknown.lines[0]).toMatch(/^unknown option --speed; usage: boxblack-segment /)
  })
})
```

- [ ] **Step 3: Run it and see it fail.**

  Run: `npx vitest run apps/desktop/src/main/native-segment.test.ts`

  Expected: FAIL. The file cannot load, with `ENOENT: no such file or directory, open '…/apps/desktop/scripts/build-segment.sh'`.

- [ ] **Step 4: Write the build script.**

  `apps/desktop/scripts/build-segment.sh`, then `chmod +x apps/desktop/scripts/build-segment.sh`, as the other build scripts are:

```sh
#!/bin/sh
# Builds boxblack-segment, the person cutter that ships inside BOXBLACK (Resources/bin), from
# apps/desktop/native/segment: Apple Vision finds the person, a guided filter and a 1-2-3-2-1 average over
# ±2 frames smooth the edge the way the user chose, and the frames go to the app's ffmpeg as raw
# yuva444p10le (docs/specs/2026-09-29-text-behind-person-design.md §7). Our own code on macOS's own
# frameworks: nothing to download, no licence to ship beside it.
#
# Needs Xcode or the Command Line Tools on the build machine. The customer's Mac needs nothing: the
# helper links only system libraries and starts on macOS 12, the oldest the app supports and the first
# with VNGeneratePersonSegmentationRequest.
#
# usage: apps/desktop/scripts/build-segment.sh <out dir>
set -eu

VERSION=1.0.0
MACOS_MIN=12.0

SRC=$(cd "$(dirname "$0")/../native/segment" && pwd)
mkdir -p "$1"
OUT=$(cd "$1" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# the version is pinned here only: the helper prints it for --version, and the release check compares it
printf 'let helperVersion = "%s"\n' "$VERSION" > "$WORK/Version.swift"
# without -target swiftc builds for the build machine's own macOS, and the helper would not start on older ones
xcrun swiftc -O -wmo -swift-version 5 -target "arm64-apple-macos$MACOS_MIN" \
  "$SRC"/*.swift "$WORK/Version.swift" -o "$WORK/boxblack-segment"
strip -x "$WORK/boxblack-segment"
# Apple Silicon runs no unsigned code: sign ad hoc again after strip (electron-builder re-signs the packaged copy)
codesign --force --sign - "$WORK/boxblack-segment"
# moved in only once built, so a failed build leaves the previous helper in place
mv "$WORK/boxblack-segment" "$OUT/boxblack-segment"
"$OUT/boxblack-segment" --version | grep -qx "boxblack-segment $VERSION" && echo "boxblack-segment $VERSION built"
```

  - The script is the only place the version lives. It writes `Version.swift` (`let helperVersion = "1.0.0"`) into a temporary folder and compiles it with the sources.
  - So `swiftc apps/desktop/native/segment/*.swift` on its own stops at a missing `helperVersion`. Always build with the script.
  - The other build scripts have no npm script, so this one gets none either.

- [ ] **Step 5: Write the helper.**

  `apps/desktop/native/segment/main.swift`:

```swift
// boxblack-segment: BOXBLACK's person cutter, for text behind the person without CapCut Pro
// (docs/specs/2026-09-29-text-behind-person-design.md §7).
//
// It reads the user's footage with AVFoundation, so it sees each frame's own presentation time: that is how the
// app matches CapCut frame for frame (§7.2). It finds the person with Apple Vision, smooths the mask the way the
// user chose ("panel 4": a guided filter on the frame's luma, then 1-2-3-2-1 over ±2 frames) and writes raw
// yuva444p10le frames for the app's ffmpeg to encode. The ffmpeg that ships with the app has no rawvideo muxer,
// so it cannot hand decoded frames to another process; the helper decodes the source itself instead.
//
//   boxblack-segment --version
//   boxblack-segment probe <video>
//   boxblack-segment render <video> --pts <file.json> --width W --height H [--radius R] [--raw-masks <dir>]
//   boxblack-segment sample <video> --pts <file.json> --size S
//
// On any failure it writes one line to stderr and exits non-zero; the app shows that line as the job's error.
// Build it with apps/desktop/scripts/build-segment.sh, which also writes the version file this code reads.
import Foundation

let usage = "usage: boxblack-segment --version | probe <video> | render <video> --pts <file.json> --width W --height H [--radius R] [--raw-masks <dir>] | sample <video> --pts <file.json> --size S"

/// Something went wrong, in one line the app can show.
struct Failure: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// A command line the helper does not understand: said together with the usage, exit 2.
struct UsageFailure: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// One line on stderr, written at once: the app reads progress, coverage and failures line by line.
func say(_ line: String) {
  fputs(line.replacingOccurrences(of: "\n", with: " ") + "\n", stderr)
}

/// The `--name value` pairs after the video.
struct Options {
  private var values: [String: String] = [:]

  init(_ arguments: ArraySlice<String>, allowed: Set<String>) throws {
    var rest = arguments
    while let name = rest.popFirst() {
      guard allowed.contains(name) else { throw UsageFailure("unknown option \(name)") }
      guard let value = rest.popFirst() else { throw UsageFailure("\(name) needs a value") }
      values[name] = value
    }
  }

  func value(_ name: String) -> String? { values[name] }

  func text(_ name: String) throws -> String {
    guard let value = values[name] else { throw UsageFailure("\(name) is missing") }
    return value
  }

  func number(_ name: String, in range: ClosedRange<Int>) throws -> Int? {
    guard let value = values[name] else { return nil }
    guard let number = Int(value), range.contains(number) else {
      throw UsageFailure("\(name) must be a whole number from \(range.lowerBound) to \(range.upperBound)")
    }
    return number
  }

  func required(_ name: String, in range: ClosedRange<Int>) throws -> Int {
    guard let number = try number(name, in: range) else { throw UsageFailure("\(name) is missing") }
    return number
  }
}

/// The frames asked for, `{ "pts": [ticks...] }`, counted in the video track's timescale (what `probe` printed).
func readTimes(_ path: String) throws -> [Int64] {
  guard let data = FileManager.default.contents(atPath: path) else { throw Failure("cannot read \(path)") }
  guard let object = try? JSONSerialization.jsonObject(with: data), let root = object as? [String: Any], let list = root["pts"] as? [Any], !list.isEmpty else {
    throw Failure("\(path) is not {\"pts\": [ticks...]} with at least one time")
  }
  return try list.map { value in
    // JSON true and false arrive as numbers too; a time is a whole number of ticks
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), let ticks = Int64(exactly: number.doubleValue) else {
      throw Failure("\(path) holds a time that is not a whole number of ticks: \(value)")
    }
    return ticks
  }
}

func run(_ arguments: [String]) throws {
  guard let command = arguments.first else { throw UsageFailure("no command") }
  if command == "--version" {
    guard arguments.count == 1 else { throw UsageFailure("--version takes nothing else") }
    print("boxblack-segment \(helperVersion)")
    return
  }
  guard ["probe", "render", "sample"].contains(command) else { throw UsageFailure("unknown command \(command)") }
  guard arguments.count >= 2 else { throw UsageFailure("\(command) needs a video") }
  let video = arguments[1]
  let rest = arguments.dropFirst(2)
  switch command {
  case "probe":
    _ = try Options(rest, allowed: [])
    try probe(VideoSource(path: video))
  case "render":
    let options = try Options(rest, allowed: ["--pts", "--width", "--height", "--radius", "--raw-masks"])
    let width = try options.required("--width", in: 2...16384)
    let height = try options.required("--height", in: 2...16384)
    // the user's masks were made with r 12 at 1080 wide: the same reach at any size, and never 0, which would
    // switch the filter off
    let radius = try options.number("--radius", in: 1...512) ?? max(1, Int((12 * Double(min(width, height)) / 1080).rounded()))
    let rawMasks = options.value("--raw-masks").map { URL(fileURLWithPath: $0, isDirectory: true) }
    let pts = try readTimes(options.text("--pts"))
    try render(VideoSource(path: video), pts: pts, width: width, height: height, radius: radius, rawMasks: rawMasks)
  default:
    let options = try Options(rest, allowed: ["--pts", "--size"])
    let size = try options.required("--size", in: 8...4096)
    let pts = try readTimes(options.text("--pts"))
    try sample(VideoSource(path: video), pts: pts, size: size)
  }
}

// ffmpeg going away while frames are still coming must end in an error line, not a silent death by SIGPIPE
signal(SIGPIPE, SIG_IGN)
do {
  try run(Array(CommandLine.arguments.dropFirst()))
  exit(0)
} catch let failure as UsageFailure {
  say("\(failure.message); \(usage)")
  exit(2)
} catch let failure as Failure {
  say(failure.message)
  exit(1)
} catch {
  say(error.localizedDescription)
  exit(1)
}
```

  `apps/desktop/native/segment/Source.swift`:

```swift
// The source video: its frame times (probe) and its decoded frames, both read with AVFoundation.
import AVFoundation
import Accelerate
import CoreMedia
import CoreVideo
import Foundation

/// AVFoundation's transfer functions in ffprobe's words: the app's source check (spec §6.2) is written in them.
private let transferNames: [String: String] = [
  kCVImageBufferTransferFunction_ITU_R_709_2 as String: "bt709",
  kCVImageBufferTransferFunction_ITU_R_2100_HLG as String: "arib-std-b67",
  kCVImageBufferTransferFunction_SMPTE_ST_2084_PQ as String: "smpte2084",
  kCVImageBufferTransferFunction_ITU_R_2020 as String: "bt2020-10",
  kCVImageBufferTransferFunction_SMPTE_240M_1995 as String: "smpte240m",
  kCVImageBufferTransferFunction_SMPTE_ST_428_1 as String: "smpte428",
  kCVImageBufferTransferFunction_sRGB as String: "iec61966-2-1",
  kCVImageBufferTransferFunction_Linear as String: "linear",
]

/// AVFoundation's colour primaries in ffprobe's words.
private let primaryNames: [String: String] = [
  kCVImageBufferColorPrimaries_ITU_R_709_2 as String: "bt709",
  kCVImageBufferColorPrimaries_ITU_R_2020 as String: "bt2020",
  kCVImageBufferColorPrimaries_EBU_3213 as String: "bt470bg",
  kCVImageBufferColorPrimaries_SMPTE_C as String: "smpte170m",
  kCVImageBufferColorPrimaries_DCI_P3 as String: "smpte431",
  kCVImageBufferColorPrimaries_P3_D65 as String: "smpte432",
]

/// The first video track of a file. Every time the helper takes or gives is in this track's own ticks, the
/// timescale CapCut uses too.
final class VideoSource {
  let path: String
  let track: AVAssetTrack
  let timescale: CMTimeScale
  private let asset: AVURLAsset

  init(path: String) throws {
    guard FileManager.default.fileExists(atPath: path) else { throw Failure("no file at \(path)") }
    self.path = path
    // precise timing: frame times are the whole point of reading the file here
    asset = AVURLAsset(url: URL(fileURLWithPath: path), options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = asset.tracks(withMediaType: .video).first else { throw Failure("no video track in \(path)") }
    self.track = track
    timescale = track.naturalTimeScale
    guard timescale > 0 else { throw Failure("the video track of \(path) has no timescale") }
  }

  /// How far the picture turns clockwise to be shown: 0, 90, 180 or 270. A phone's portrait video is often stored
  /// lying down, with the turn in its display matrix.
  var rotation: Int {
    let transform = track.preferredTransform
    let degrees = Int((atan2(Double(transform.b), Double(transform.a)) * 180 / Double.pi).rounded())
    return (degrees % 360 + 360) % 360
  }

  /// A time as a whole number of the track's ticks.
  func ticks(_ time: CMTime) -> Int64 {
    CMTimeConvertScale(time, timescale: timescale, method: .roundHalfAwayFromZero).value
  }

  /// Every frame's presentation time on the track's timeline, sorted. The samples are read as they are stored (no
  /// decoding) and come in decode order, which B-frames make differ from presentation order.
  func presentationTimes() throws -> [Int64] {
    let reader = try openReader()
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    output.alwaysCopiesSampleData = false
    try start(reader, with: output)
    var stored: [CMTime] = []
    while let sample = output.copyNextSampleBuffer() {
      let count = CMSampleBufferGetNumSamples(sample)
      if count == 1 {
        stored.append(CMSampleBufferGetPresentationTimeStamp(sample))
      } else if count > 1 {
        var timings = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
        var filled: CMItemCount = 0
        guard CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: count, arrayToFill: &timings, entriesNeededOut: &filled) == noErr else { continue }
        stored += timings.prefix(filled).map(\.presentationTimeStamp)
      }
    }
    if reader.status == .failed { throw Failure("cannot read \(path): \(reader.error?.localizedDescription ?? "unknown error")") }
    // Stored samples carry media times, decoded frames (render, sample) track times: a file with B-frames often starts
    // its edit list at a later media time (x264's .mp4 and .mov at 1024/15360), and without this the two would
    // disagree by that much. ffprobe shows the same track times.
    let edits = track.segments.filter { !$0.isEmpty }.map(\.timeMapping)
    let shown = { (time: CMTime) -> Int64? in
      // no edit list: the media timeline is the track's
      if edits.isEmpty { return self.ticks(time) }
      // a sample no edit shows is not a frame of the video
      guard let edit = edits.first(where: { CMTimeRangeContainsTime($0.source, time: time) }) else { return nil }
      return self.ticks(CMTimeMapTimeFromRangeToRange(time, fromRange: edit.source, toRange: edit.target))
    }
    return stored.filter(\.isValid).compactMap(shown).sorted()
  }

  /// The transfer function and primaries the track is tagged with, in ffprobe's words; nil when it has none. A value
  /// ffprobe has no word for is given as AVFoundation names it.
  func colour() -> (transfer: String?, primaries: String?) {
    guard let first = track.formatDescriptions.first else { return (nil, nil) }
    let format = first as! CMFormatDescription
    let tag = { (key: CFString) in CMFormatDescriptionGetExtension(format, extensionKey: key) as? String }
    let transfer = tag(kCMFormatDescriptionExtension_TransferFunction).map { transferNames[$0] ?? $0 }
    let primaries = tag(kCMFormatDescriptionExtension_ColorPrimaries).map { primaryNames[$0] ?? $0 }
    return (transfer, primaries)
  }

  /// Decodes the frames shown from `first` to `last` (ticks) and hands each to `body` with its time, in presentation
  /// order, as the decoder's own 4:2:0 YUV: no colour conversion anywhere. `body` returns false to stop early.
  func frames(from first: Int64, through last: Int64, _ body: (Int64, CVPixelBuffer) throws -> Bool) throws {
    let reader = try openReader()
    // a quarter second either side: the reader decodes from the key frame before the start anyway, and a frame on
    // the very edge must not be lost to how the range is rounded
    let margin = Int64(timescale) / 4
    reader.timeRange = CMTimeRange(start: CMTime(value: max(0, first - margin), timescale: timescale), end: CMTime(value: last + margin, timescale: timescale))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    output.alwaysCopiesSampleData = false
    try start(reader, with: output)
    defer { reader.cancelReading() }
    while let sample = output.copyNextSampleBuffer() {
      guard let frame = CMSampleBufferGetImageBuffer(sample) else { continue }
      let time = ticks(CMSampleBufferGetPresentationTimeStamp(sample))
      // Vision and CoreVideo hand out autoreleased objects: without a pool per frame a long run keeps them all
      let more = try autoreleasepool { try body(time, frame) }
      if !more { return }
    }
    if reader.status == .failed { throw Failure("cannot decode \(path): \(reader.error?.localizedDescription ?? "unknown error")") }
  }

  private func openReader() throws -> AVAssetReader {
    do {
      return try AVAssetReader(asset: asset)
    } catch {
      throw Failure("cannot read \(path): \(error.localizedDescription)")
    }
  }

  private func start(_ reader: AVAssetReader, with output: AVAssetReaderTrackOutput) throws {
    guard reader.canAdd(output) else { throw Failure("cannot read the video track of \(path)") }
    reader.add(output)
    guard reader.startReading() else { throw Failure("cannot read \(path): \(reader.error?.localizedDescription ?? "unknown error")") }
  }
}

/// `probe`: the track's timescale, every frame's time, the size, the rotation and the colour tags, as one JSON object.
func probe(_ source: VideoSource) throws {
  let pts = try source.presentationTimes()
  guard !pts.isEmpty else { throw Failure("no frames in \(source.path)") }
  let size = source.track.naturalSize
  let colour = source.colour()
  let object: [String: Any] = [
    "timescale": Int(source.timescale),
    "pts": pts.map { NSNumber(value: $0) },
    "width": Int(abs(size.width).rounded()),
    "height": Int(abs(size.height).rounded()),
    "rotation": source.rotation,
    "transfer": colour.transfer ?? NSNull(),
    "primaries": colour.primaries ?? NSNull(),
  ]
  let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  print(String(decoding: data, as: UTF8.self))
}

/// One decoded frame at the output size, ready to be written: luma for the file and for the guide, chroma brought
/// up to 4:4:4.
struct Picture {
  /// 10-bit video-range luma, 8-bit × 4
  let y: [UInt16]
  let u: [UInt16]
  let v: [UInt16]
  /// the brightness the mask's edge snaps to: luma mapped to 0...1 as the user's JPEG frames had it (full range)
  let guide: [Float]
}

/// Turns 420v frames into Pictures at the output size. The resizes are worked out once for the source's size.
final class PictureReader {
  let width: Int
  let height: Int
  private var layout: (lumaWidth: Int, lumaHeight: Int, chromaWidth: Int, chromaHeight: Int)?
  private var luma: Resize?
  private var chroma: Resize?

  init(width: Int, height: Int) {
    self.width = width
    self.height = height
  }

  func read(_ frame: CVPixelBuffer) throws -> Picture {
    guard CVPixelBufferGetPixelFormatType(frame) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, CVPixelBufferGetPlaneCount(frame) == 2 else {
      throw Failure("the decoder gave frames in an unexpected format")
    }
    CVPixelBufferLockBaseAddress(frame, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(frame, .readOnly) }
    let lumaWidth = CVPixelBufferGetWidthOfPlane(frame, 0), lumaHeight = CVPixelBufferGetHeightOfPlane(frame, 0)
    let chromaWidth = CVPixelBufferGetWidthOfPlane(frame, 1), chromaHeight = CVPixelBufferGetHeightOfPlane(frame, 1)
    guard let lumaBase = CVPixelBufferGetBaseAddressOfPlane(frame, 0), let chromaBase = CVPixelBufferGetBaseAddressOfPlane(frame, 1) else {
      throw Failure("the decoder gave a frame without pixels")
    }
    if layout == nil || layout! != (lumaWidth, lumaHeight, chromaWidth, chromaHeight) {
      layout = (lumaWidth, lumaHeight, chromaWidth, chromaHeight)
      luma = lumaWidth == width && lumaHeight == height ? nil : Resize(from: (lumaWidth, lumaHeight), to: (width, height), kernel: .cubic)
      // 4:2:0 chroma sits beside the even luma columns and between each pair of luma rows (MPEG-2, H.264 and HEVC's
      // default), and is brought up with straight lines, as players draw it
      chroma = Resize(from: (chromaWidth, chromaHeight), to: (width, height), kernel: .linear, lumaSize: (lumaWidth, lumaHeight), siting: (0, 0.5))
    }

    var y = [Float](repeating: 0, count: lumaWidth * lumaHeight)
    let lumaRow = CVPixelBufferGetBytesPerRowOfPlane(frame, 0)
    let lumaBytes = lumaBase.assumingMemoryBound(to: UInt8.self)
    y.withUnsafeMutableBufferPointer { out in
      for row in 0..<lumaHeight {
        vDSP_vfltu8(lumaBytes + row * lumaRow, 1, out.baseAddress! + row * lumaWidth, 1, vDSP_Length(lumaWidth))
      }
    }
    var cb = [Float](repeating: 0, count: chromaWidth * chromaHeight)
    var cr = [Float](repeating: 0, count: chromaWidth * chromaHeight)
    let chromaRow = CVPixelBufferGetBytesPerRowOfPlane(frame, 1)
    let chromaBytes = chromaBase.assumingMemoryBound(to: UInt8.self)
    cb.withUnsafeMutableBufferPointer { blue in
      cr.withUnsafeMutableBufferPointer { red in
        // Cb and Cr alternate within each row
        for row in 0..<chromaHeight {
          vDSP_vfltu8(chromaBytes + row * chromaRow, 2, blue.baseAddress! + row * chromaWidth, 1, vDSP_Length(chromaWidth))
          vDSP_vfltu8(chromaBytes + row * chromaRow + 1, 2, red.baseAddress! + row * chromaWidth, 1, vDSP_Length(chromaWidth))
        }
      }
    }

    let sized = luma?.apply(y) ?? y
    let guide = vDSP.clip(vDSP.multiply(1 / 219, vDSP.add(-16, sized)), to: 0...1)
    return Picture(y: tenBits(sized), u: tenBits(chroma!.apply(cb)), v: tenBits(chroma!.apply(cr)), guide: guide)
  }
}

/// 8-bit samples as 10-bit ones (× 4), rounded; resizing may overshoot a little, so they are kept within 8 bits first.
func tenBits(_ samples: [Float]) -> [UInt16] {
  let scaled = vDSP.multiply(4, vDSP.clip(samples, to: 0...255))
  var out = [UInt16](repeating: 0, count: samples.count)
  vDSP.convertElements(of: scaled, to: &out, rounding: .towardNearestInteger)
  return out
}
```

  `apps/desktop/native/segment/Filters.swift`:

```swift
// The picture maths: resizing, the guided filter and the average over time, as the user's chosen masks were made
// (reference/final-masks.py is the same maths in numpy; native-segment.test.ts compares the two).
import Accelerate
import Foundation

/// A plane of samples, row by row.
struct Plane {
  let width: Int
  let height: Int
  let data: [Float]
}

enum Kernel {
  /// ffmpeg's default bicubic (Keys, a = -0.6, which is Mitchell-Netravali B 0, C 0.6): what final-masks.py resized with
  case cubic
  /// straight lines between samples
  case linear

  var reach: Double { self == .cubic ? 2 : 1 }

  func weight(_ at: Double) -> Double {
    let x = abs(at)
    switch self {
    case .cubic:
      if x < 1 { return (1.4 * x - 2.4) * x * x + 1 }
      if x < 2 { return ((-0.6 * x + 3) * x - 4.8) * x + 2.4 }
      return 0
    case .linear:
      return x < 1 ? 1 - x : 0
    }
  }
}

/// Which source samples one axis of a resize reads for each output sample, and how much of each. Samples past the
/// edge repeat the edge one, as ffmpeg's scaler does.
struct Taps {
  let count: Int
  let perSample: Int
  let index: [Int]
  let weight: [Float]

  /// Output sample `i` is centred on source position `offset + i × step` (in source samples). Shrinking widens the
  /// kernel by the step, so every source sample counts.
  init(sources: Int, count: Int, kernel: Kernel, step: Double, offset: Double) {
    let widen = max(1, step)
    let reach = kernel.reach * widen
    let perSample = Int((2 * reach).rounded(.up)) + 1
    var index = [Int](repeating: 0, count: count * perSample)
    var weight = [Float](repeating: 0, count: count * perSample)
    var raw = [Double](repeating: 0, count: perSample)
    for i in 0..<count {
      let centre = offset + Double(i) * step
      let first = Int((centre - reach).rounded(.up))
      var sum = 0.0
      for t in 0..<perSample {
        raw[t] = kernel.weight((Double(first + t) - centre) / widen)
        sum += raw[t]
        index[i * perSample + t] = min(max(first + t, 0), sources - 1)
      }
      for t in 0..<perSample { weight[i * perSample + t] = Float(raw[t] / sum) }
    }
    self.count = count
    self.perSample = perSample
    self.index = index
    self.weight = weight
  }
}

/// A separable resize from one size to another, its taps worked out once.
struct Resize {
  let from: (width: Int, height: Int)
  let to: (width: Int, height: Int)
  private let across: Taps
  private let down: Taps

  /// A resize of the whole picture, sample centres on sample centres.
  init(from: (Int, Int), to: (Int, Int), kernel: Kernel) {
    self.from = (from.0, from.1)
    self.to = (to.0, to.1)
    let stepX = Double(from.0) / Double(to.0), stepY = Double(from.1) / Double(to.1)
    across = Taps(sources: from.0, count: to.0, kernel: kernel, step: stepX, offset: 0.5 * stepX - 0.5)
    down = Taps(sources: from.1, count: to.1, kernel: kernel, step: stepY, offset: 0.5 * stepY - 0.5)
  }

  /// A resize of subsampled chroma to the output size: `lumaSize` is the frame the chroma belongs to, and `siting`
  /// where chroma sample 0 sits on the luma grid (0 beside luma sample 0, 0.5 between samples 0 and 1).
  init(from: (Int, Int), to: (Int, Int), kernel: Kernel, lumaSize: (Int, Int), siting: (Double, Double)) {
    self.from = (from.0, from.1)
    self.to = (to.0, to.1)
    // an output sample's centre on the luma grid, then on the chroma grid, which has half as many samples
    let lumaX = Double(lumaSize.0) / Double(to.0), lumaY = Double(lumaSize.1) / Double(to.1)
    across = Taps(sources: from.0, count: to.0, kernel: kernel, step: lumaX / 2, offset: (0.5 * lumaX - 0.5 - siting.0) / 2)
    down = Taps(sources: from.1, count: to.1, kernel: kernel, step: lumaY / 2, offset: (0.5 * lumaY - 0.5 - siting.1) / 2)
  }

  func apply(_ samples: [Float]) -> [Float] {
    precondition(samples.count == from.width * from.height, "resize of the wrong size")
    // across each row first, then down: the second pass is whole rows scaled and added, which vDSP does fast
    var wide = [Float](repeating: 0, count: to.width * from.height)
    samples.withUnsafeBufferPointer { source in
      wide.withUnsafeMutableBufferPointer { out in
        across.index.withUnsafeBufferPointer { index in
          across.weight.withUnsafeBufferPointer { weight in
            let taps = across.perSample
            for row in 0..<from.height {
              let line = source.baseAddress! + row * from.width
              let target = out.baseAddress! + row * to.width
              for x in 0..<to.width {
                var sum: Float = 0
                for t in 0..<taps { sum += weight[x * taps + t] * line[index[x * taps + t]] }
                target[x] = sum
              }
            }
          }
        }
      }
    }
    var out = [Float](repeating: 0, count: to.width * to.height)
    wide.withUnsafeBufferPointer { source in
      out.withUnsafeMutableBufferPointer { target in
        let taps = down.perSample
        for y in 0..<to.height {
          let row = target.baseAddress! + y * to.width
          for t in 0..<taps {
            var weight = down.weight[y * taps + t]
            if weight == 0 { continue }
            vDSP_vsma(source.baseAddress! + down.index[y * taps + t] * to.width, 1, &weight, row, 1, row, 1, vDSP_Length(to.width))
          }
        }
      }
    }
    return out
  }
}

/// He's guided filter, as final-masks.py runs it: box radius r, eps 1e-3 (not squared), the frame's brightness as
/// the guide, the result clipped to 0...1. The box is 2r + 1 wide and repeats the edge (numpy reflects it; the
/// two differ only within 2r of the frame's edge).
struct GuidedFilter {
  let width: Int
  let height: Int
  let radius: Int
  private let eps: Float = 1e-3
  private let kernel: [Float]

  init(width: Int, height: Int, radius: Int) {
    self.width = width
    self.height = height
    self.radius = radius
    kernel = [Float](repeating: 1 / Float(2 * radius + 1), count: 2 * radius + 1)
  }

  private func box(_ samples: [Float]) -> [Float] {
    var input = samples
    var out = [Float](repeating: 0, count: samples.count)
    let error = input.withUnsafeMutableBufferPointer { source in
      out.withUnsafeMutableBufferPointer { target in
        var from = vImage_Buffer(data: source.baseAddress, height: vImagePixelCount(height), width: vImagePixelCount(width), rowBytes: width * MemoryLayout<Float>.stride)
        var to = vImage_Buffer(data: target.baseAddress, height: vImagePixelCount(height), width: vImagePixelCount(width), rowBytes: width * MemoryLayout<Float>.stride)
        return vImageSepConvolve_PlanarF(&from, &to, nil, 0, 0, kernel, UInt32(kernel.count), kernel, UInt32(kernel.count), 0, 0, vImage_Flags(kvImageEdgeExtend))
      }
    }
    precondition(error == kvImageNoError, "vImageSepConvolve_PlanarF failed: \(error)")
    return out
  }

  func callAsFunction(guide i: [Float], mask p: [Float]) -> [Float] {
    let meanI = box(i), meanP = box(p)
    let corrIP = box(vDSP.multiply(i, p)), corrII = box(vDSP.multiply(i, i))
    let covIP = vDSP.subtract(corrIP, vDSP.multiply(meanI, meanP))
    let varI = vDSP.subtract(corrII, vDSP.multiply(meanI, meanI))
    let a = vDSP.divide(covIP, vDSP.add(eps, varI))
    let b = vDSP.subtract(meanP, vDSP.multiply(a, meanI))
    return vDSP.clip(vDSP.add(vDSP.multiply(box(a), i), box(b)), to: 0...1)
  }
}

/// Weights 1-2-3-2-1 over ±2 frames of the file, the frame index clamped at the ends (final-masks.py), done as the
/// frames stream: frame i goes out once frame i + 2 is known, and a mask is kept only while a later frame needs it.
struct TemporalSmoother {
  let count: Int
  private var snapped: [Int: [Float]] = [:]
  private var next = 0

  init(count: Int) { self.count = count }

  /// Takes frame `index`'s filtered mask (frames come in order) and returns the frames now ready, with their masks.
  mutating func add(_ mask: [Float], at index: Int) -> [(index: Int, mask: [Float])] {
    precondition(index == (snapped.keys.max() ?? -1) + 1, "masks out of order")
    snapped[index] = mask
    var ready: [(index: Int, mask: [Float])] = []
    while next < count, min(next + 2, count - 1) <= index {
      var sum = [Float](repeating: 0, count: mask.count)
      for (weight, offset) in zip([1, 2, 3, 2, 1] as [Float], -2...2) {
        sum = vDSP.add(multiplication: (snapped[min(max(next + offset, 0), count - 1)]!, weight / 9), sum)
      }
      ready.append((next, sum))
      // frame next + 1 reaches back to next - 1 at most
      snapped[next - 2] = nil
      next += 1
    }
    return ready
  }
}
```

  `apps/desktop/native/segment/Masks.swift`:

```swift
// Where the raw masks come from: Apple Vision, or, in tests, PNG files standing in for it.
import Accelerate
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Vision

/// A raw person mask for one frame, 0...1 at its own size (the caller resizes it to the frame).
protocol MaskSource {
  func mask(at index: Int, of frame: CVPixelBuffer) throws -> Plane
}

/// Vision's person segmentation at its best quality, the one the user's masks came from (spec §1.1). Its mask has
/// a size of its own (1512×2016 on macOS 27, whatever the frame) and covers the whole frame.
final class VisionMasks: MaskSource {
  private let request: VNGeneratePersonSegmentationRequest

  init() {
    request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = .accurate
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
  }

  func mask(at index: Int, of frame: CVPixelBuffer) throws -> Plane {
    // one handler per frame, as the spike ran it: a sequence handler gave the same masks and no steadier edge
    let handler = VNImageRequestHandler(cvPixelBuffer: frame, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      throw Failure("Vision could not look at frame \(index): \(error.localizedDescription)")
    }
    // no observation means Vision saw nobody: an empty mask
    guard let found = request.results?.first?.pixelBuffer else { return Plane(width: 1, height: 1, data: [0]) }
    CVPixelBufferLockBaseAddress(found, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(found, .readOnly) }
    guard CVPixelBufferGetPixelFormatType(found) == kCVPixelFormatType_OneComponent8, let base = CVPixelBufferGetBaseAddress(found) else {
      throw Failure("Vision gave a mask in an unexpected format")
    }
    let width = CVPixelBufferGetWidth(found), height = CVPixelBufferGetHeight(found), stride = CVPixelBufferGetBytesPerRow(found)
    return Plane(width: width, height: height, data: unitSamples(base.assumingMemoryBound(to: UInt8.self), width: width, height: height, stride: stride))
  }
}

/// Test masks in place of Vision: `<dir>/<index>.png`, one per frame asked for (0 for the first), 8-bit grey, any
/// size. They let a test check the resize, the guided filter and the average over time to the level.
final class RawMasks: MaskSource {
  let dir: URL

  init(dir: URL) { self.dir = dir }

  func mask(at index: Int, of frame: CVPixelBuffer) throws -> Plane {
    let url = dir.appendingPathComponent("\(index).png")
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
      throw Failure("cannot read the mask \(url.path)")
    }
    let width = image.width, height = image.height
    // the grey values as stored: drawing the picture would put them through colour management
    guard image.bitsPerComponent == 8, image.bitsPerPixel == 8, let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else {
      throw Failure("the mask \(url.path) is not an 8-bit grey PNG")
    }
    return Plane(width: width, height: height, data: unitSamples(bytes, width: width, height: height, stride: image.bytesPerRow))
  }
}

/// 8-bit samples as 0...1 floats, row by row.
func unitSamples(_ bytes: UnsafePointer<UInt8>, width: Int, height: Int, stride: Int) -> [Float] {
  var out = [Float](repeating: 0, count: width * height)
  out.withUnsafeMutableBufferPointer { target in
    for row in 0..<height {
      vDSP_vfltu8(bytes + row * stride, 1, target.baseAddress! + row * width, 1, vDSP_Length(width))
    }
  }
  return vDSP.divide(out, 255)
}
```

  `apps/desktop/native/segment/Render.swift`:

```swift
// The two jobs: render (the person file's frames, for ffmpeg) and sample (small masks for the head-cover warning).
import Accelerate
import CoreVideo
import Foundation

/// `render`: one yuva444p10le frame on stdout for every time in `pts`, in order, repeats included: planes Y, U, V
/// and A, W×H 16-bit little-endian samples each. "progress <done> <total>" goes to stderr after every frame and
/// "coverage <0..1>" (the mean alpha) at the end. Frames are as stored: the app never cuts a source that turns (§6.2).
func render(_ source: VideoSource, pts: [Int64], width: Int, height: Int, radius: Int, rawMasks: URL?) throws {
  // one pass forward through the file: the list follows the timeline, which never goes back (a repeat is fine)
  for i in pts.indices.dropFirst() where pts[i] < pts[i - 1] {
    throw Failure("the times asked for go back at position \(i) (\(pts[i - 1]) then \(pts[i]))")
  }
  let pictures = PictureReader(width: width, height: height)
  let masks: MaskSource = rawMasks.map { RawMasks(dir: $0) } ?? VisionMasks()
  let filter = GuidedFilter(width: width, height: height, radius: radius)
  let fit = MaskFit(width: width, height: height)
  let writer = FrameWriter(width: width, height: height, total: pts.count)
  var smoother = TemporalSmoother(count: pts.count)
  // frames whose alpha waits for the two after them
  var waiting: [Int: Picture] = [:]
  var next = 0
  var last: (time: Int64, snapped: [Float])?

  try source.frames(from: pts.first!, through: pts.last!) { time, frame in
    if time < pts[next] { return true }
    guard time == pts[next] else { throw Failure("the video has no frame at \(pts[next]) (the next one is at \(time))") }
    let picture = try pictures.read(frame)
    while next < pts.count, pts[next] == time {
      let snapped: [Float]
      if rawMasks == nil, let last, last.time == time {
        // the same frame again: Vision and the filter would give the same mask
        snapped = last.snapped
      } else {
        snapped = filter(guide: picture.guide, mask: fit(try masks.mask(at: next, of: frame)))
      }
      last = (time, snapped)
      waiting[next] = picture
      for (index, mask) in smoother.add(snapped, at: next) {
        try writer.write(waiting.removeValue(forKey: index)!, alpha: mask)
      }
      next += 1
    }
    return next < pts.count
  }
  guard next == pts.count else { throw Failure("the video has no frame at \(pts[next])") }
  say(String(format: "coverage %.6f", writer.coverage))
}

/// Brings raw masks to the frame's size, bicubic as final-masks.py did, each input size worked out once.
final class MaskFit {
  let width: Int
  let height: Int
  private var resizes: [String: Resize] = [:]

  init(width: Int, height: Int) {
    self.width = width
    self.height = height
  }

  func callAsFunction(_ mask: Plane) -> [Float] {
    if mask.width == width, mask.height == height { return mask.data }
    let key = "\(mask.width)x\(mask.height)"
    let resize = resizes[key] ?? Resize(from: (mask.width, mask.height), to: (width, height), kernel: .cubic)
    resizes[key] = resize
    // bicubic overshoots a hard edge a little; the user's resized masks were stored as 0...255
    return vDSP.clip(resize.apply(mask.data), to: 0...1)
  }
}

/// Writes frames as yuva444p10le and keeps count of how much of them is person.
final class FrameWriter {
  let width: Int
  let height: Int
  let total: Int
  private(set) var written = 0
  private var alphaSum = 0.0
  private var frame: [UInt16]
  private var levels: [UInt8]
  /// an 8-bit mask level as 10-bit alpha: mask × 1023/255, so 255 is all person and 0 none
  private let alphaOf: [UInt16] = (0...255).map { UInt16((Double($0) * 1023 / 255).rounded()) }

  init(width: Int, height: Int, total: Int) {
    self.width = width
    self.height = height
    self.total = total
    frame = [UInt16](repeating: 0, count: width * height * 4)
    levels = [UInt8](repeating: 0, count: width * height)
  }

  /// the mean alpha of every frame written, 0...1
  var coverage: Double { written == 0 ? 0 : alphaSum / (Double(written) * Double(width * height) * 1023) }

  func write(_ picture: Picture, alpha mask: [Float]) throws {
    let count = width * height
    // the mask as the user's 8-bit PNGs held it
    vDSP.convertElements(of: vDSP.multiply(255, vDSP.clip(mask, to: 0...1)), to: &levels, rounding: .towardNearestInteger)
    let alphaOf = self.alphaOf
    var sum = 0
    frame.withUnsafeMutableBufferPointer { out in
      let y = out.baseAddress!, u = y + count, v = u + count, a = v + count
      levels.withUnsafeBufferPointer { level in
        picture.y.withUnsafeBufferPointer { py in
          picture.u.withUnsafeBufferPointer { pu in
            picture.v.withUnsafeBufferPointer { pv in
              for p in 0..<count {
                let alpha = alphaOf[Int(level[p])]
                a[p] = alpha
                sum += Int(alpha)
                if alpha == 0 {
                  // no person here: black, which keeps the file small (spec §7.2 step 5); the rest is never premultiplied
                  y[p] = 64
                  u[p] = 512
                  v[p] = 512
                } else {
                  y[p] = py[p]
                  u[p] = pu[p]
                  v[p] = pv[p]
                }
              }
            }
          }
        }
      }
    }
    try frame.withUnsafeBytes { try writeOut($0) }
    alphaSum += Double(sum)
    written += 1
    say("progress \(written) \(total)")
  }
}

/// All of it to stdout, however the pipe splits it; a pipe that closed (ffmpeg gone) is a failure.
func writeOut(_ bytes: UnsafeRawBufferPointer) throws {
  var offset = 0
  while offset < bytes.count {
    let written = Darwin.write(STDOUT_FILENO, bytes.baseAddress! + offset, bytes.count - offset)
    if written < 0 {
      if errno == EINTR { continue }
      throw Failure("could not hand the frames on: \(String(cString: strerror(errno)))")
    }
    offset += written
  }
}

/// `sample`: Vision's raw mask of each time in `pts`, resized so its long side is `size`, as one JSON line per time
/// in the order asked (repeats included): {"pts": t, "width": w, "height": h, "mask": "<base64 of w×h bytes>"}.
/// The mask is the frame as shown, turned upright by the track's rotation: the app lays it over the canvas.
func sample(_ source: VideoSource, pts: [Int64], size: Int) throws {
  let vision = VisionMasks()
  let turn = source.rotation
  var lines: [Int64: String] = [:]
  // times close together share one pass through the file; a far one starts its own rather than decoding the gap
  for group in nearby(Array(Set(pts)).sorted(), within: Int64(source.timescale) * 2) {
    var left = Set(group)
    try source.frames(from: group.first!, through: group.last!) { time, frame in
      guard left.remove(time) != nil else { return time < group.last! }
      let shown = try upright(frame, turn: turn)
      let (width, height) = fitted(CVPixelBufferGetWidth(shown), CVPixelBufferGetHeight(shown), longSide: size)
      let mask = try vision.mask(at: pts.firstIndex(of: time)!, of: shown)
      let resized = Resize(from: (mask.width, mask.height), to: (width, height), kernel: .cubic).apply(mask.data)
      var bytes = [UInt8](repeating: 0, count: width * height)
      vDSP.convertElements(of: vDSP.multiply(255, vDSP.clip(resized, to: 0...1)), to: &bytes, rounding: .towardNearestInteger)
      lines[time] = "{\"pts\":\(time),\"width\":\(width),\"height\":\(height),\"mask\":\"\(Data(bytes).base64EncodedString())\"}"
      return !left.isEmpty
    }
    if let missing = left.min() { throw Failure("the video has no frame at \(missing)") }
  }
  for time in pts { print(lines[time]!) }
}

/// Sorted times cut into runs whose neighbours are at most `gap` apart.
func nearby(_ times: [Int64], within gap: Int64) -> [[Int64]] {
  var runs: [[Int64]] = []
  for time in times {
    if let last = runs.last?.last, time - last <= gap { runs[runs.count - 1].append(time) } else { runs.append([time]) }
  }
  return runs
}

/// The size with this long side and the frame's shape: Vision's mask covers the whole frame, whatever its own shape.
func fitted(_ width: Int, _ height: Int, longSide: Int) -> (Int, Int) {
  if width >= height { return (longSide, max(1, Int((Double(longSide) * Double(height) / Double(width)).rounded()))) }
  return (max(1, Int((Double(longSide) * Double(width) / Double(height)).rounded())), longSide)
}

/// The frame turned clockwise by `turn` degrees (0, 90, 180 or 270), so Vision sees the person standing up.
func upright(_ frame: CVPixelBuffer, turn: Int) throws -> CVPixelBuffer {
  guard turn != 0 else { return frame }
  let constant = UInt8(turn == 90 ? kRotate90DegreesClockwise : turn == 180 ? kRotate180DegreesClockwise : kRotate270DegreesClockwise)
  let width = CVPixelBufferGetWidth(frame), height = CVPixelBufferGetHeight(frame)
  var made: CVPixelBuffer?
  let size = turn == 180 ? (width, height) : (height, width)
  guard CVPixelBufferCreate(nil, size.0, size.1, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, nil, &made) == kCVReturnSuccess, let turned = made else {
    throw Failure("cannot turn a frame upright")
  }
  CVPixelBufferLockBaseAddress(frame, .readOnly)
  CVPixelBufferLockBaseAddress(turned, [])
  defer {
    CVPixelBufferUnlockBaseAddress(turned, [])
    CVPixelBufferUnlockBaseAddress(frame, .readOnly)
  }
  for plane in 0..<2 {
    var from = vImage_Buffer(data: CVPixelBufferGetBaseAddressOfPlane(frame, plane), height: vImagePixelCount(CVPixelBufferGetHeightOfPlane(frame, plane)), width: vImagePixelCount(CVPixelBufferGetWidthOfPlane(frame, plane)), rowBytes: CVPixelBufferGetBytesPerRowOfPlane(frame, plane))
    var to = vImage_Buffer(data: CVPixelBufferGetBaseAddressOfPlane(turned, plane), height: vImagePixelCount(CVPixelBufferGetHeightOfPlane(turned, plane)), width: vImagePixelCount(CVPixelBufferGetWidthOfPlane(turned, plane)), rowBytes: CVPixelBufferGetBytesPerRowOfPlane(turned, plane))
    // the chroma plane's Cb and Cr travel together as one 16-bit sample
    let error = plane == 0 ? vImageRotate90_Planar8(&from, &to, constant, 0, vImage_Flags(kvImageNoFlags)) : vImageRotate90_Planar16U(&from, &to, constant, 0, vImage_Flags(kvImageNoFlags))
    guard error == kvImageNoError else { throw Failure("cannot turn a frame upright (vImage \(error))") }
  }
  return turned
}
```

- [ ] **Step 6: Run the test and see it pass.**

  Run: `npx vitest run apps/desktop/src/main/native-segment.test.ts`

  Expected: PASS, 8 tests.
  - The build step prints strip's warning that the signature becomes invalid. That is expected: the script signs the helper again right after.
  - On a Mac without Xcode or the Command Line Tools, the whole `describe` is skipped. Its name says what it needs.

- [ ] **Step 7: Build the helper into the app's resources.** Task 8's release check and shipped-binary test need it, and so does Part C's pipeline in development.

  Run: `apps/desktop/scripts/build-segment.sh apps/desktop/resources/bin`

  Expected: the last line is `boxblack-segment 1.0.0 built`, and `apps/desktop/resources/bin/boxblack-segment` exists, about 180 KB.

- [ ] **Step 8: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 8: Bundling: release check, shipped-binary test, resolver, `ToolReport.segment`, the Settings row

**Files:**
- Modify: `packages/core/src/media/tool-check.ts` (`segmentVersion` after `whisperSupportsDtw` :31-33; `ToolReport` :35-42; `inspectTools` :58-91)
- Modify: `packages/core/src/media/index.ts:4` (export `segmentVersion`)
- Create: `apps/desktop/src/main/segment-helper.ts` (`SEGMENT_HELPER`, `BUNDLED_SEGMENT`, `segmentHelperIn`)
- Modify: `apps/desktop/src/main/tools.ts` (`ToolPaths` :4-9; `createToolbox` :25-44)
- Modify: `apps/desktop/src/main/index.ts` (imports :53-54; the tool lookup :117-135; `resourcesDir` moves up from :232-233)
- Modify: `apps/desktop/scripts/release-check.ts` (doc :1-9; imports :15; input :38-39; rule after :64; `inspectShippedSegment` after :161; `runReleaseCheck` :255 and :270)
- Modify: `apps/desktop/src/renderer/src/components/ToolsCard.tsx` (:28-29; a row after whisper-cli's, :79)
- Modify: `apps/desktop/src/renderer/src/i18n.ts` (after `tools.claudeOptional`, :584)
- Modify: `apps/desktop/src/renderer/test/fake-api.ts:81-86`
- Modify: `apps/desktop/electron-builder.cjs:24` (the comment only)
- Create: `apps/desktop/src/main/segment-helper.test.ts`, `apps/desktop/src/main/bundled-segment.test.ts`
- Test: `packages/core/src/media/tool-check.test.ts`, `apps/desktop/src/main/tools.test.ts`, `apps/desktop/scripts/release-check.test.ts`, `apps/desktop/src/renderer/src/screens/SettingsScreen.test.tsx`
- Fixtures that build a `ToolReport` (the compiler lists them once `segment` is required): `apps/desktop/src/main/analysis.test.ts` :156-161 and :333, `apps/desktop/src/main/settings-api.test.ts` :49 and :76, `SettingsScreen.test.tsx` :672, :683-688 and :698, `fake-api.ts` :81

What this task adds beyond the contract:
- `ToolReport.segment: { path: string; version: string | null } | null`.
- `segmentVersion(output: string): string | null`, from `@boxblack/core/media`.
- `inspectTools`'s paths gain `segment?: string | null`.
- `ToolPaths.segment: string | null`. It holds the helper's path only once a look at the tools has seen it run.
- In `apps/desktop/src/main/segment-helper.ts`: `SEGMENT_HELPER`, `BUNDLED_SEGMENT = "1.0.0"` and `segmentHelperIn(binDir: string): string | null`.
- In `release-check.ts`: `inspectShippedSegment(path: string, run?: Run): Promise<string | null>`, and `releaseProblems` input gains `segment: string | null`.
- The i18n key `tools.segmentMissing`.

Part C wires the pipeline. It can use the following, or keep its own `shippedProgram`, which checks the same file:
- `helper: () => tools.segment`;
- `helperVersion: () => BUNDLED_SEGMENT`, or the report's `segment.version`.

- [ ] **Step 1: Write the failing tests.**

  `packages/core/src/media/tool-check.test.ts`:
  - Import `segmentVersion` too: `import { inspectTools, missingFfmpegParts, parseToolVersion, segmentVersion, whisperSupportsDtw } from "./tool-check.ts"`.
  - The expectation at :78 gains `segment: null`: `expect(report).toEqual({ ffmpeg: null, ffprobe: null, whisper: { path: "/nope/whisper-cli", usable: false }, claude: null, segment: null })`.
  - Add after that test:

```ts
test("reads the person cutter's version from its own line, and nothing else", () => {
  expect(segmentVersion("boxblack-segment 1.0.0\n")).toBe("1.0.0")
  expect(segmentVersion("")).toBeNull()
  expect(segmentVersion("ffmpeg version 8.1.2")).toBeNull()
})

test("the person cutter is judged by its --version: a version when it runs, none when it does not", async () => {
  const helper = "/Applications/BOXBLACK.app/Contents/Resources/bin/boxblack-segment"
  const only = { ffmpeg: null, ffprobe: null, whisper: null, claude: null, segment: helper }
  const calls: string[][] = []
  const runs = await inspectTools(only, async (command, args) => {
    calls.push([command, ...args])
    return "boxblack-segment 1.0.0\n"
  })
  expect(runs.segment).toEqual({ path: helper, version: "1.0.0" })
  expect(calls).toEqual([[helper, "--version"]])
  // killed as it starts (macOS refused it) it prints nothing; one that cannot be started at all throws
  expect((await inspectTools(only, async () => "\n")).segment).toEqual({ path: helper, version: null })
  const refused = async () => {
    throw new Error(`spawn ${helper} EACCES`)
  }
  expect((await inspectTools(only, refused)).segment).toEqual({ path: helper, version: null })
  // not looked for, not reported
  expect((await inspectTools({ ffmpeg: null, ffprobe: null, whisper: null, claude: null }, refused)).segment).toBeNull()
})
```

  `apps/desktop/src/main/segment-helper.test.ts`:

```ts
import { afterEach, expect, test } from "vitest"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SEGMENT_HELPER, segmentHelperIn } from "./segment-helper.ts"

/** The folders a test made, removed after each test. */
const made: string[] = []
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function binFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "segment-bin-"))
  made.push(dir)
  return dir
}

test("the person cutter is the file in the app's own bin folder, once it is there and may run", () => {
  const dir = binFolder()
  expect(segmentHelperIn(dir)).toBeNull()
  const helper = join(dir, SEGMENT_HELPER)
  writeFileSync(helper, "#!/bin/sh\n")
  chmodSync(helper, 0o644)
  expect(segmentHelperIn(dir)).toBeNull()
  chmodSync(helper, 0o755)
  expect(segmentHelperIn(dir)).toBe(helper)
})

test("a folder by that name is no helper", () => {
  const dir = binFolder()
  mkdirSync(join(dir, SEGMENT_HELPER))
  expect(segmentHelperIn(dir)).toBeNull()
})
```

  `apps/desktop/src/main/tools.test.ts`:
  - Every fake report gains `segment: null`: the one at :12, `inspect` at :32, both at :47 and :57, and the one at :72.
  - Both `expect(held).toEqual(…)` (at :16 and :21-26) gain `segment: null`. The fake `find` finds no `boxblack-segment`, so the helper stays null.
  - Add at the end:

```ts
const HELPER = "/Applications/BOXBLACK.app/Contents/Resources/bin/boxblack-segment"

test("the person cutter counts once it has been seen to run, and not while macOS refuses it", async () => {
  let runs = true
  const toolbox = createToolbox({
    find: (name) => (name === "boxblack-segment" ? HELPER : null),
    inspect: async (paths) =>
      ({ ffmpeg: null, ffprobe: null, whisper: null, claude: null, segment: paths.segment ? { path: paths.segment, version: runs ? "1.0.0" : null } : null }) satisfies ToolReport,
  })
  // not before the first look has run it
  expect(toolbox.paths.segment).toBeNull()
  expect((await toolbox.report()).segment).toEqual({ path: HELPER, version: "1.0.0" })
  expect(toolbox.paths.segment).toBe(HELPER)
  // there, but killed as it starts: no cutter
  runs = false
  await toolbox.rescan()
  expect((await toolbox.report()).segment).toEqual({ path: HELPER, version: null })
  expect(toolbox.paths.segment).toBeNull()
})

test("an older look at the tools that ends after a newer one does not undo what the newer one found", async () => {
  const answers: ((version: string | null) => void)[] = []
  const toolbox = createToolbox({
    find: (name) => (name === "boxblack-segment" ? HELPER : null),
    inspect: (paths) =>
      new Promise<ToolReport>((resolve) => answers.push((version) => resolve({ ffmpeg: null, ffprobe: null, whisper: null, claude: null, segment: { path: paths.segment!, version } }))),
  })
  const newer = toolbox.rescan()
  answers[1]!("1.0.0")
  await newer
  expect(toolbox.paths.segment).toBe(HELPER)
  // the look taken at start ends last, having found the helper not running
  answers[0]!(null)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(toolbox.paths.segment).toBe(HELPER)
})
```

  `apps/desktop/src/main/bundled-segment.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { inspectTools } from "@boxblack/core/media"
import { BUNDLED_SEGMENT, SEGMENT_HELPER } from "./segment-helper.ts"

/**
 * The person cutter the app ships (Resources/bin), built by scripts/build-segment.sh. What it does is checked by
 * native-segment.test.ts on a fresh build of the source; what can be checked of the shipped file is that it is
 * that build, that it runs, and that it starts on every Mac the app supports.
 */
const helper = join(import.meta.dirname, "../../resources/bin", SEGMENT_HELPER)

describe.skipIf(!existsSync(helper))("the boxblack-segment that ships with the app", () => {
  test("runs, and is the version the release check wants", async () => {
    const report = await inspectTools({ ffmpeg: null, ffprobe: null, whisper: null, claude: null, segment: helper })
    expect(report.segment).toEqual({ path: helper, version: BUNDLED_SEGMENT })
  })

  test("needs nothing from Homebrew, starts on the oldest macOS the app supports, and is built for Apple Silicon alone", () => {
    const linked = execFileSync("otool", ["-L", helper], { encoding: "utf8" }).split("\n").slice(1).map((line) => line.trim()).filter(Boolean)
    for (const library of linked) expect(library).toMatch(/^\/(usr\/lib|System\/Library)\//)
    const load = execFileSync("otool", ["-l", helper], { encoding: "utf8" })
    expect(/minos (\S+)/.exec(load)?.[1]).toBe("12.0")
    // a thin 64-bit Mach-O (magic 0xfeedfacf) for CPU_TYPE_ARM64 (0x0100000c), not a universal file
    const header = readFileSync(helper).subarray(0, 8)
    expect([header.readUInt32LE(0), header.readUInt32LE(4)]).toEqual([0xfeedfacf, 0x0100000c])
  })
})
```

  `apps/desktop/scripts/release-check.test.ts`:
  - Import `import { BUNDLED_SEGMENT } from "../src/main/segment-helper.ts"`, and add `inspectShippedSegment` to the `./release-check.ts` import.
  - `ready` gains `segment: BUNDLED_SEGMENT,` after `whisper`.
  - `fakeFfmpeg` becomes the following. It answers the helper's `--version` too:

```ts
/** The shipped tools' answers: ffmpeg's listings, and what boxblack-segment --version prints. */
function fakeFfmpeg(listings: { version?: string; filters?: string; encoders?: string; muxers?: string; protocols?: string; segment?: string }) {
  const calls: string[][] = []
  const run = async (command: string, args: string[]) => {
    calls.push([command, ...args])
    const flag = args.find((arg) => arg !== "-hide_banner")
    if (flag === "-version") return listings.version ?? `ffmpeg version ${BUNDLED_FFMPEG} Copyright (c) 2000-2026 the FFmpeg developers\n`
    if (flag === "-filters") return listings.filters ?? FILTERS
    if (flag === "-encoders") return listings.encoders ?? ENCODERS
    if (flag === "-muxers") return listings.muxers ?? MUXERS
    if (flag === "-protocols") return listings.protocols ?? PROTOCOLS
    if (flag === "--version") return listings.segment ?? `boxblack-segment ${BUNDLED_SEGMENT}\n`
    throw new Error(`unexpected ${args.join(" ")}`)
  }
  return { run, calls }
}
```

  - Add before "the whisper build script builds the pinned version" (:177):

```ts
test("no build leaves without the person cutter the app was tested with, local test builds included", () => {
  const missing = "resources/bin/boxblack-segment is missing or does not run; run apps/desktop/scripts/build-segment.sh apps/desktop/resources/bin"
  expect(releaseProblems({ ...ready, segment: null })).toEqual([missing])
  expect(releaseProblems({ ...ready, local: true, licenseServer: "", keyKind: "development", segment: null })).toEqual([missing])
  expect(releaseProblems({ ...ready, segment: "0.9.0" })).toEqual([
    `resources/bin/boxblack-segment is 0.9.0, not ${BUNDLED_SEGMENT}; rebuild it with apps/desktop/scripts/build-segment.sh apps/desktop/resources/bin`,
  ])
})

test("the shipped person cutter is judged by its own --version, as the app judges it at startup", async () => {
  const calls: string[][] = []
  const answers = async (command: string, args: string[]) => {
    calls.push([command, ...args])
    return `boxblack-segment ${BUNDLED_SEGMENT}\n`
  }
  expect(await inspectShippedSegment("/app/resources/bin/boxblack-segment", answers)).toBe(BUNDLED_SEGMENT)
  expect(calls).toEqual([["/app/resources/bin/boxblack-segment", "--version"]])
  // not there, or killed as it starts (macOS refused it)
  const absent = async () => {
    throw Object.assign(new Error("spawn /app/resources/bin/boxblack-segment ENOENT"), { code: "ENOENT" })
  }
  expect(await inspectShippedSegment("/app/resources/bin/boxblack-segment", absent)).toBeNull()
  expect(await inspectShippedSegment("/app/resources/bin/boxblack-segment", async () => "\n")).toBeNull()
})

test("the person cutter's build script builds the pinned version", () => {
  const script = readFileSync(join(import.meta.dirname, "build-segment.sh"), "utf8")
  expect(/^VERSION=(\S+)$/m.exec(script)?.[1]).toBe(BUNDLED_SEGMENT)
})
```

  - In "runReleaseCheck downloads the published pack only once nothing else is wrong…", add after `expect(skipped.urls).toEqual([])`:

```ts
  // nor without the person cutter
  const noHelper = servePack(body)
  const noHelperResult = await runReleaseCheck({ local: false, env: {}, run: fakeFfmpeg({ segment: "" }).run, fetchPack: noHelper.fetchPack, graphicsPack })
  expect(noHelperResult.problems).toEqual(["resources/bin/boxblack-segment is missing or does not run; run apps/desktop/scripts/build-segment.sh apps/desktop/resources/bin"])
  expect(noHelper.urls).toEqual([])
```

  - The exact success message at :334 becomes:

```ts
  expect(cleanResult.message).toBe(
    `release check passed (no licensing, ffmpeg: ${BUNDLED_FFMPEG}, whisper: ${PINNED_WHISPER_VERSION}, boxblack-segment: ${BUNDLED_SEGMENT}, graphics pack: ${graphicsPack.version})`,
  )
```

  `apps/desktop/src/renderer/src/screens/SettingsScreen.test.tsx`:
  - The three whole `tools` objects at :672, :683-688 and :698 gain `segment: null`.
  - Add before "after installing something, the tools can be looked for again" (:697):

```tsx
test("the person cutter that comes with the app says so, and what it is for", async () => {
  renderWith([settingsView()])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow(t("tools.segment"))).getByText(t("tools.bundled", { version: "1.0.0" }))).toBeTruthy()
  expect(within(toolRow(t("tools.segment"))).getByText(t("tools.segmentHint"))).toBeTruthy()
})

test("a person cutter that is not there says so, with no Homebrew command, and is not a tool to install", async () => {
  renderWith([settingsView({ tools: { ...settingsView().tools, segment: null } })])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow(t("tools.segment"))).getByText(t("tools.segmentMissing"))).toBeTruthy()
  expect(within(toolRow(t("tools.segment"))).queryByText(/brew install/)).toBeNull()
  expect(within(toolsSection()).queryByText(t("tools.homebrewHint"))).toBeNull()
})

test("a person cutter that macOS will not run counts as not there", async () => {
  const refused = { path: "/Applications/BOXBLACK.app/Contents/Resources/bin/boxblack-segment", version: null }
  renderWith([settingsView({ tools: { ...settingsView().tools, segment: refused } })])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow(t("tools.segment"))).getByText(t("tools.segmentMissing"))).toBeTruthy()
})
```

- [ ] **Step 2: Run them and see them fail.**

  Run: `npx vitest run packages/core/src/media apps/desktop/src/main/tools.test.ts apps/desktop/src/main/segment-helper.test.ts apps/desktop/src/main/bundled-segment.test.ts apps/desktop/scripts/release-check.test.ts apps/desktop/src/renderer/src/screens/SettingsScreen.test.tsx`

  Expected: FAIL.
  - `tool-check.test.ts` has no export `segmentVersion`.
  - `segment-helper.test.ts`, `bundled-segment.test.ts` and `release-check.test.ts` cannot find `segment-helper.ts`.
  - The new toolbox tests fail: `paths.segment` is undefined.
  - The new Settings tests fail: `tools.segment` is not a message key yet, so `t` throws.

- [ ] **Step 3: Implement core.**

  In `packages/core/src/media/tool-check.ts`, add after `whisperSupportsDtw`:

```ts
/** The version in what `boxblack-segment --version` prints ("boxblack-segment 1.0.0"); null for anything else. */
export function segmentVersion(output: string): string | null {
  return /^boxblack-segment (\S+)$/m.exec(output)?.[1] ?? null
}
```

  `ToolReport` gains a last field:

```ts
  /**
   * the person cutter, which comes only with the app (spec 2026-09-29 §7.1); `version` is null when it does not run
   * (macOS refused it, or it is damaged), which the app treats as having no cutter
   */
  segment: { path: string; version: string | null } | null
```

  In `inspectTools`:
  - The paths parameter becomes `paths: { ffmpeg: string | null; ffprobe: string | null; whisper: string | null; claude: string | null; segment?: string | null },`. It is optional, so the existing callers need no change (the release check's ffmpeg check, the bundled ffmpeg and whisper tests).
  - `const [ffmpeg, whisper, claude] = await Promise.all([` becomes `const [ffmpeg, whisper, claude, segment] = await Promise.all([`.
  - After the `paths.claude` entry, add:

```ts
    paths.segment
      ? attempt(async () => ({ path: paths.segment!, version: segmentVersion(await run(paths.segment!, ["--version"])) }), { path: paths.segment, version: null })
      : null,
```

  - The return becomes `return { ffmpeg, ffprobe: paths.ffprobe ? { path: paths.ffprobe } : null, whisper, claude, segment }`.

  In `packages/core/src/media/index.ts`, the tool-check line becomes:

```ts
export { inspectTools, missingFfmpegParts, parseToolVersion, segmentVersion, whisperSupportsDtw, type ToolReport } from "./tool-check.ts"
```

- [ ] **Step 4: Implement main: the resolver, the toolbox and `index.ts`.**

  Create `apps/desktop/src/main/segment-helper.ts`:

```ts
import { accessSync, constants, statSync } from "node:fs"
import { join } from "node:path"

/** The person cutter's file name: native/segment, built into resources/bin by scripts/build-segment.sh. */
export const SEGMENT_HELPER = "boxblack-segment"

/** The person cutter the app ships and was tested with; scripts/build-segment.sh's VERSION must say the same (a test checks). */
export const BUNDLED_SEGMENT = "1.0.0"

/**
 * The person cutter in the app's own bin folder, or null. Only the app's copy counts, in development too, where
 * that folder is apps/desktop/resources/bin (process.resourcesPath has no bin then): nothing on PATH or from
 * Homebrew stands in for it (spec 2026-09-29 §7.1).
 */
export function segmentHelperIn(binDir: string): string | null {
  const path = join(binDir, SEGMENT_HELPER)
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}
```

  In `apps/desktop/src/main/tools.ts`:
  - Add `import { SEGMENT_HELPER } from "./segment-helper.ts"` after the `ToolReport` import.
  - `ToolPaths` gains:

```ts
  /**
   * the person cutter, set once it has been seen to run: null while it is not there, or while macOS will not run it
   * (Open Anyway not covering it), and the groups behind the person are then drawn in front (spec 2026-09-29 §7.1, §12)
   */
  segment: string | null
```

  - Replace everything from `const paths: ToolPaths = …` through the end of `scan()`:

```ts
  const paths: ToolPaths = { ffmpeg: null, ffprobe: null, whisper: null, claude: null, segment: null }
  let report: Promise<ToolReport>
  // the latest look at the tools: an older one that ends after it must not undo what it found
  let looks = 0

  function scan(): Promise<ToolReport> {
    const look = ++looks
    Object.assign(paths, { ffmpeg: deps.find("ffmpeg"), ffprobe: deps.find("ffprobe"), whisper: deps.find("whisper-cli"), claude: deps.find("claude") })
    const segment = deps.find(SEGMENT_HELPER)
    const within = (dirs: string[] | undefined, path: string) => (dirs ?? []).includes(dirname(path))
    report = deps.inspect({ ...paths, segment }).then((found) => {
      // a helper that is there but does not run is no helper (see ToolPaths.segment)
      if (look === looks) paths.segment = found.segment?.version ? found.segment.path : null
      return {
        ...found,
        ffmpeg: found.ffmpeg ? { ...found.ffmpeg, bundled: within(deps.bundledDirs, found.ffmpeg.path) } : null,
        whisper: found.whisper
          ? {
              ...found.whisper,
              bundled: within(deps.bundledDirs, found.whisper.path),
              // the one inside the app is the tested build too
              pinned: within(deps.bundledDirs, found.whisper.path) || within(deps.pinnedDirs, found.whisper.path),
            }
          : null,
      }
    })
    return report
  }
```

  In `apps/desktop/src/main/index.ts`:
  - Add `import { SEGMENT_HELPER, segmentHelperIn } from "./segment-helper.ts"` after the `styleInForce` import.
  - Move `resourcesDir` and its comment up, from beside `backupRoot` (:232-233), to right after `await migrateDataDir(…)`. Its value does not change. The toolbox needs it now, and `resourcesDir`'s later users (emoji, fonts, the kit, highlight assets) still find it in scope:

```ts
  await migrateDataDir({ from: join(dirname(userData), "prodeck2"), to: userData })
  // the app's shipped resources: next to the app when packaged, apps/desktop/resources in development
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(import.meta.dirname, "../../resources")
```

  - The toolbox's comment and `find` become:

```ts
  // ffmpeg ships in Resources/bin; customers install whisper-cli and Claude Code themselves, and a rescan picks them up.
  // The person cutter comes only from the app's own bin, found through resourcesDir so development finds it too
  const toolbox = createToolbox({
    find: (name) => (name === SEGMENT_HELPER ? segmentHelperIn(join(resourcesDir, "bin")) : tool(name)),
```

  - `bundledDirs` stays `join(process.resourcesPath, "bin")` for ffmpeg and whisper-cli. Development keeps finding those in Homebrew, as before. Only the helper is looked for in `join(resourcesDir, "bin")`, which works in development too.

- [ ] **Step 5: Implement the release check.**

  In `apps/desktop/scripts/release-check.ts`:
  - The file's doc says "…ship without the ffmpeg or the person cutter it was tested with, or ship without a built and published graphics pack, or without the emoji pictures its graphics draw."
  - Add `import { BUNDLED_SEGMENT, SEGMENT_HELPER } from "../src/main/segment-helper.ts"` after the `LICENSING` import.
  - `releaseProblems`' input gains, after `whisper`:

```ts
  /** what inspectShippedSegment found in resources/bin/boxblack-segment: its version, or null when it is not there or does not run */
  segment: string | null
```

  - Add after the ffmpeg rules, before `if (!input.local && input.licensing) {`:

```ts
  // every build, test builds too: the person cutter comes only with the app, so without it no text goes behind a person
  if (!input.segment) problems.push("resources/bin/boxblack-segment is missing or does not run; run apps/desktop/scripts/build-segment.sh apps/desktop/resources/bin")
  else if (input.segment !== BUNDLED_SEGMENT) {
    problems.push(`resources/bin/boxblack-segment is ${input.segment}, not ${BUNDLED_SEGMENT}; rebuild it with apps/desktop/scripts/build-segment.sh apps/desktop/resources/bin`)
  }
```

  - Add after `inspectShippedFfmpeg`:

```ts
/** The shipped person cutter's version, as the app's own startup check reads it; null when it is not there or does not run. */
export async function inspectShippedSegment(path: string, run: Run = runTool): Promise<string | null> {
  return (await inspectTools({ ffmpeg: null, ffprobe: null, whisper: null, claude: null, segment: path }, run)).segment?.version ?? null
}
```

  - In `runReleaseCheck`, the `releaseProblems` call gains, after `whisper: shippedWhisper(),`:

```ts
    segment: await inspectShippedSegment(join(import.meta.dirname, "../resources/bin", SEGMENT_HELPER), run),
```

  - The success return becomes:

```ts
  return {
    problems,
    message: `release check passed (${licensing}, ffmpeg: ${BUNDLED_FFMPEG}, whisper: ${PINNED_WHISPER_VERSION}, boxblack-segment: ${BUNDLED_SEGMENT}, graphics pack: ${graphicsPack.version})`,
  }
```

- [ ] **Step 6: Implement the Settings row.**

  In `apps/desktop/src/renderer/src/i18n.ts`, after `"tools.claudeOptional"`:

```ts
  "tools.segment": "ตัวตัดคน (boxblack-segment)",
  "tools.segmentHint": "มากับแอป ใช้เมื่อมีข้อความอยู่หลังคนและไม่ได้เปิด “มี CapCut Pro”",
  "tools.segmentMissing": "ไม่พบหรือใช้ไม่ได้ — ข้อความที่ตั้งไว้หลังคนจะอยู่หน้าคนแทน · ติดตั้ง BOXBLACK ใหม่เพื่อแก้",
```

  In `apps/desktop/src/renderer/src/components/ToolsCard.tsx`:
  - The destructuring and `anyMissing` become:

```tsx
  const { ffmpeg, whisper, claude, segment } = view.tools
  // the person cutter comes only with the app: nothing to install from Homebrew, so it is not counted here
  const anyMissing = !ffmpeg || !whisper
```

  - Add this row between whisper-cli's row and Claude Code's:

```tsx
        <ToolRow
          name={t("tools.segment")}
          note={t("tools.segmentHint")}
          status={
            // one that is there but does not run (macOS refused it) is as good as none
            segment?.version ? <Check text={t("tools.bundled", { version: segment.version })} /> : <span className="warn-text">{t("tools.segmentMissing")}</span>
          }
        />
```

  In `apps/desktop/src/renderer/test/fake-api.ts`, `settingsView().tools` gains, after `claude`:

```ts
    segment: { path: "/Applications/BOXBLACK.app/Contents/Resources/bin/boxblack-segment", version: "1.0.0" },
```

  The other `ToolReport` fixtures gain `segment: null`:
  - `analysis.test.ts`: the `report` at :156-161, and the object returned at :333.
  - `settings-api.test.ts`: the `tools` const at :49 and the expected `tools` at :76.
  - The three in `SettingsScreen.test.tsx` from Step 1.

  In `apps/desktop/electron-builder.cjs`, the comment above `extraResources` names the helper:

```js
  // ffmpeg and ffprobe, built by scripts/build-ffmpeg.sh, with their LGPL notice, and boxblack-segment, the person
  // cutter, built by scripts/build-segment.sh (electron-builder signs it with the rest of the app);
```

  No other packaging change is needed. `resources/bin` already ships outside the asar, and electron-builder signs it with the app.

- [ ] **Step 7: Run the tests and see them pass.**

  Run: `npx vitest run packages/core/src/media apps/desktop/src/main apps/desktop/scripts/release-check.test.ts apps/desktop/src/renderer/src/screens/SettingsScreen.test.tsx`

  Expected: PASS. `bundled-segment.test.ts` runs its two tests because Task 7 Step 7 built the helper.

  Then run the release check the way `dist:local` does: `node apps/desktop/scripts/release-check.ts --local`

  Expected: `release check passed (…, ffmpeg: 8.1.2, whisper: 1.9.2, boxblack-segment: 1.0.0, graphics pack: 2026-09-24)`.
  - To see the refusal, move `apps/desktop/resources/bin/boxblack-segment` aside and run the check again.
  - It refuses with `resources/bin/boxblack-segment is missing or does not run; run apps/desktop/scripts/build-segment.sh apps/desktop/resources/bin`.
  - Put the helper back afterwards.

- [ ] **Step 8: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.


---

### Task 9: Source probes — `main/cutout-probe.ts`

**Files:**
- Create: `apps/desktop/src/main/cutout-probe.ts`
- Test: `apps/desktop/src/main/cutout-probe.test.ts` (new)

**What it is:**
- `createSourceProbes` asks the helper (`boxblack-segment probe <video>`, the contract CLI) for a source's timing, size, turn and colours. It caches the answer by path + size + mtimeMs, because the app asks on every look at a preview.
- A failed or garbled answer is cached as `null` ("unreadable"). The probe also runs inside a preview, and a probe that times out must not hold up every preview after it.
- A missing helper or a missing file is not cached, since either may be there on the next ask.
- `blockOf(probe, draftFps)` is spec §6.2. "no-helper" is the caller's to decide, before it probes.
- `shippedProgram` asks a program in Resources/bin for its version once, when the app starts. Task 11 uses it for the helper and for the app's ffmpeg. Both versions are part of every cutout hash. A program that is missing, or that macOS will not run, gives no version, and then counts as not there.

- [ ] **Step 1: Write the failing tests.** Create `apps/desktop/src/main/cutout-probe.test.ts`:

```ts
import { appendFile, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { blockOf, createSourceProbes, segmentVersionOf, shippedProgram, type RunProcess, type SourceProbe } from "./cutout-probe.ts"

const temps: string[] = []
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** 0917's IMG_9646.MOV as AVFoundation reads it (facts, 2026-09-29): 933 frames at 600 a second, four of them 21 ticks long. */
const PTS_0917 = Array.from({ length: 933 }, (_, i) => 20 * i + Number(i >= 104) + Number(i >= 313) + Number(i >= 523) + Number(i >= 732))
const SDR: SourceProbe = { timescale: 600, pts: PTS_0917, width: 1080, height: 1920, rotation: 0, transfer: "ITU_R_709_2", primaries: "ITU_R_709_2" }

test("0917's source passes: SDR, not turned, frames of uneven length, a 30 fps draft", () => {
  expect(blockOf(SDR, 30)).toBeNull()
  // ffprobe's names for the same colours
  expect(blockOf({ ...SDR, transfer: "bt709", primaries: "bt709" }, 30)).toBeNull()
  expect(blockOf({ ...SDR, transfer: null, primaries: null }, 30)).toBeNull()
})

test("a source the helper could not read, one the player turns, HDR, or a draft not at 30 fps is not cut out", () => {
  expect(blockOf(null, 30)).toBe("unreadable")
  for (const rotation of [90, -90, 180, 270]) expect(blockOf({ ...SDR, rotation }, 30), String(rotation)).toBe("rotated")
  // a whole turn is none
  expect(blockOf({ ...SDR, rotation: 360 }, 30)).toBeNull()
  // HLG and PQ by ffprobe's names and AVFoundation's, in either case; BT.2020 colours by either name
  for (const transfer of ["arib-std-b67", "smpte2084", "ITU_R_2100_HLG", "SMPTE_ST_2084_PQ", "itu_r_2100_hlg"]) expect(blockOf({ ...SDR, transfer }, 30), transfer).toBe("hdr")
  for (const primaries of ["bt2020", "ITU_R_2020"]) expect(blockOf({ ...SDR, primaries }, 30), primaries).toBe("hdr")
  for (const fps of [25, 29.97, 60]) expect(blockOf(SDR, fps), String(fps)).toBe("draft-fps")
  // the source's own reasons first, in the order the spec lists them
  expect(blockOf({ ...SDR, rotation: 90, transfer: "arib-std-b67" }, 25)).toBe("rotated")
  expect(blockOf({ ...SDR, transfer: "arib-std-b67" }, 25)).toBe("hdr")
})

/** A source file on disk, and a stand-in for the helper's `probe` that answers `answer` and notes each ask. */
async function setup(answer: () => Promise<string> = async () => JSON.stringify(SDR)) {
  const dir = await mkdtemp(join(tmpdir(), "cprobe-"))
  temps.push(dir)
  const video = join(dir, "IMG_9646.MOV")
  await writeFile(video, "not really a video")
  const asked: { command: string; args: string[]; signal?: AbortSignal }[] = []
  const run: RunProcess = async (command, args, options) => {
    asked.push({ command, args, signal: options?.signal })
    return { stdout: await answer(), stderr: "" }
  }
  let helper: string | null = "/app/boxblack-segment"
  const probes = createSourceProbes({ helper: () => helper, run })
  return { dir, video, asked, probes, setHelper: (path: string | null) => (helper = path) }
}

test("a source is probed once while it stays the same file; a change of its time or size probes it again", async () => {
  const { video, asked, probes } = await setup()
  expect(await probes.probe(video)).toEqual(SDR)
  expect(await probes.probe(video)).toEqual(SDR)
  expect(asked).toHaveLength(1)
  expect(asked[0]).toMatchObject({ command: "/app/boxblack-segment", args: ["probe", video] })
  expect(asked[0]!.signal).toBeInstanceOf(AbortSignal)
  const later = new Date(Date.now() + 60_000)
  await utimes(video, later, later)
  await probes.probe(video)
  expect(asked).toHaveLength(2)
  await appendFile(video, " and more")
  await utimes(video, later, later)
  await probes.probe(video)
  expect(asked).toHaveLength(3)
  await probes.probe(video)
  expect(asked).toHaveLength(3)
})

test("two asks at once share one probe", async () => {
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  const { video, asked, probes } = await setup(async () => {
    await gate
    return JSON.stringify(SDR)
  })
  const both = Promise.all([probes.probe(video), probes.probe(video)])
  await new Promise((resolve) => setTimeout(resolve, 20))
  open()
  expect(await both).toEqual([SDR, SDR])
  expect(asked).toHaveLength(1)
})

test("an answer that is not a probe reads as unreadable, and is remembered until the file changes", async () => {
  const answers = [
    "not json",
    "null",
    JSON.stringify({ ...SDR, pts: [] }),
    // out of presentation order
    JSON.stringify({ ...SDR, pts: [0, 40, 20] }),
    JSON.stringify({ ...SDR, pts: [0, 20.5] }),
    JSON.stringify({ ...SDR, timescale: 0 }),
    JSON.stringify({ ...SDR, width: "1080" }),
    JSON.stringify({ ...SDR, rotation: null }),
    JSON.stringify({ ...SDR, transfer: 1 }),
  ]
  for (const answer of answers) {
    const { video, asked, probes } = await setup(async () => answer)
    expect(await probes.probe(video), answer).toBeNull()
    expect(blockOf(await probes.probe(video), 30)).toBe("unreadable")
    expect(asked, answer).toHaveLength(1)
  }
  // colours it does not name are none
  const { video, probes } = await setup(async () => JSON.stringify({ ...SDR, transfer: undefined, primaries: undefined }))
  expect(await probes.probe(video)).toEqual({ ...SDR, transfer: null, primaries: null })
})

test("a probe that fails reads as unreadable and is not run again for the same file", async () => {
  const { video, asked, probes } = await setup(async () => {
    throw new Error("boxblack-segment exited with code 1: cannot read the video track")
  })
  expect(await probes.probe(video)).toBeNull()
  expect(await probes.probe(video)).toBeNull()
  expect(asked).toHaveLength(1)
})

test("no helper, or no file, reads as unreadable without asking, and is not remembered", async () => {
  const { dir, video, asked, probes, setHelper } = await setup()
  setHelper(null)
  expect(await probes.probe(video)).toBeNull()
  expect(await probes.probe(join(dir, "gone.MOV"))).toBeNull()
  expect(asked).toHaveLength(0)
  setHelper("/app/boxblack-segment")
  expect(await probes.probe(video)).toEqual(SDR)
  expect(asked).toHaveLength(1)
})

test("a shipped program says its version once; one that is missing or does not run gives none, and no path", async () => {
  const asked: { command: string; args: string[]; signal?: AbortSignal }[] = []
  const answering: RunProcess = async (command, args, options) => {
    asked.push({ command, args, signal: options?.signal })
    return { stdout: "boxblack-segment 3\n", stderr: "" }
  }
  const helper = shippedProgram("/app/bin/boxblack-segment", ["--version"], segmentVersionOf, answering)
  // not asked yet: nothing to hash with, so nothing to cut with
  expect(helper.path()).toBeNull()
  expect(await helper.ready()).toBe(true)
  expect(helper.path()).toBe("/app/bin/boxblack-segment")
  expect(helper.version()).toBe("3")
  expect(await helper.ready()).toBe(true)
  expect(asked).toEqual([{ command: "/app/bin/boxblack-segment", args: ["--version"], signal: expect.any(AbortSignal) }])

  const missing = shippedProgram("/app/bin/boxblack-segment", ["--version"], segmentVersionOf, async () => {
    throw Object.assign(new Error("spawn /app/bin/boxblack-segment ENOENT"), { code: "ENOENT" })
  })
  expect(await missing.ready()).toBe(false)
  expect(missing.path()).toBeNull()
  expect(missing.version()).toBe("")
  // an answer that is not the helper's is no version either
  const stranger = shippedProgram("/app/bin/boxblack-segment", ["--version"], segmentVersionOf, async () => ({ stdout: "something else 1.0\n", stderr: "" }))
  expect(await stranger.ready()).toBe(false)
})

test("the helper's version is the word after its name", () => {
  expect(segmentVersionOf("boxblack-segment 1.0.2\n")).toBe("1.0.2")
  expect(segmentVersionOf("boxblack-segment\n")).toBeNull()
  expect(segmentVersionOf("")).toBeNull()
})
```

- [ ] **Step 2: Run them and see them fail.**

  Run: `npx vitest run apps/desktop/src/main/cutout-probe.test.ts`

  Expected: FAIL, `Cannot find module './cutout-probe.ts'`.

- [ ] **Step 3: Implement.** Create `apps/desktop/src/main/cutout-probe.ts`:

```ts
import { stat } from "node:fs/promises"
import { runProcess } from "@boxblack/core/media"

/** What the helper's `probe` reads of a source video (AVFoundation): every frame's time, the picture's size and turn, and its colours. */
export interface SourceProbe {
  /** the video track's timescale (ticks per second); CapCut and AVFoundation agree on it */
  timescale: number
  /** every frame's presentation time in ticks, in presentation order */
  pts: number[]
  width: number
  height: number
  /** how far the player turns the picture, in degrees */
  rotation: number
  /** the transfer curve and the colour primaries, as the file names them; null when it names none */
  transfer: string | null
  primaries: string | null
}

/**
 * Why the app's own route cannot cut the person out of a group's source (spec §6.2, §12): the group
 * is then placed and drawn like any other. "no-helper" is the caller's to decide, before any probe.
 */
export type CutoutBlock = "no-helper" | "unreadable" | "rotated" | "hdr" | "draft-fps"

/** runProcess, which the tests stand in for. */
export type RunProcess = (command: string, args: string[], options?: { signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string }>

/**
 * HDR's transfer curves, HLG and PQ, as ffprobe names them and as AVFoundation does (the helper reads
 * the latter). Compared without regard to case.
 */
const HDR_TRANSFERS = new Set(["arib-std-b67", "smpte2084", "itu_r_2100_hlg", "smpte_st_2084_pq"])
/** BT.2020's colours, by either name: a picture made for HDR, whatever its curve. */
const HDR_PRIMARIES = new Set(["bt2020", "itu_r_2020"])

/** How long one probe may take: it reads the frames' times, not their pictures. */
const PROBE_TIMEOUT_MS = 60_000
/** How long a shipped program may take to say its version. */
const VERSION_TIMEOUT_MS = 10_000

/**
 * Why the app's own route cannot cut a person out of this source for a draft at `draftFps`, or null
 * when it can (spec §6.2): a source the helper could not read, one the player turns, one in HDR (an
 * HLG or PQ curve, or BT.2020 colours), or a draft that is not 30 fps, the only rate the frame rule
 * was proven at. The source's own frame rate does not matter: the person file follows the frames the
 * main piece shows, repeats and skips included.
 */
export function blockOf(probe: SourceProbe | null, draftFps: number): CutoutBlock | null {
  if (probe === null) return "unreadable"
  if (probe.rotation % 360 !== 0) return "rotated"
  if (HDR_TRANSFERS.has(probe.transfer?.toLowerCase() ?? "") || HDR_PRIMARIES.has(probe.primaries?.toLowerCase() ?? "")) return "hdr"
  if (draftFps !== 30) return "draft-fps"
  return null
}

/** The helper's probe answer, checked: null for anything that is not one, so a source it cannot read reads as unreadable. */
function parseProbe(stdout: string): SourceProbe | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null) return null
  const { timescale, pts, width, height, rotation, transfer = null, primaries = null } = raw as Record<string, unknown>
  const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
  if (!positive(timescale) || !positive(width) || !positive(height)) return null
  if (typeof rotation !== "number" || !Number.isFinite(rotation)) return null
  // in presentation order, each frame after the one before: anything else is no timing the frame rule can use
  if (!Array.isArray(pts) || pts.length === 0 || !pts.every((tick, i) => Number.isSafeInteger(tick) && (i === 0 || tick > pts[i - 1]))) return null
  if ((transfer !== null && typeof transfer !== "string") || (primaries !== null && typeof primaries !== "string")) return null
  return { timescale, pts: pts as number[], width, height, rotation, transfer, primaries }
}

/**
 * The sources as the helper's `probe` reads them, each read once for as long as the file stays the
 * same (its path, size and change time): the app asks on every look at a preview. A source the helper
 * could not read is remembered as such as well, so a preview does not wait on it again; a file that
 * cannot be found, or a machine without the helper, reads as unreadable and is not remembered, since
 * either may be there on the next ask.
 */
export function createSourceProbes(deps: { helper: () => string | null; run?: RunProcess }) {
  const run = deps.run ?? runProcess
  /** each path's last probe, with the file it was of: a file changed since is probed again */
  const known = new Map<string, { size: number; mtimeMs: number; probe: Promise<SourceProbe | null> }>()
  return {
    async probe(path: string): Promise<SourceProbe | null> {
      const helper = deps.helper()
      if (!helper) return null
      let file: { size: number; mtimeMs: number }
      try {
        file = await stat(path)
      } catch {
        return null
      }
      const was = known.get(path)
      if (was && was.size === file.size && was.mtimeMs === file.mtimeMs) return was.probe
      // kept before it settles, so a second ask while it runs joins it rather than running another
      const probe = run(helper, ["probe", path], { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then(
        ({ stdout }) => parseProbe(stdout),
        () => null,
      )
      known.set(path, { size: file.size, mtimeMs: file.mtimeMs, probe })
      return probe
    },
  }
}

export type SourceProbes = ReturnType<typeof createSourceProbes>

/** The version `boxblack-segment --version` gives ("boxblack-segment <VERSION>"), or null for anything else. */
export const segmentVersionOf = (stdout: string): string | null => /^boxblack-segment (\S+)$/m.exec(stdout.trim())?.[1] ?? null

/**
 * A program the app ships in Resources/bin, asked its version once, when the app starts: the helper's
 * and the app's ffmpeg's versions are part of every cutout's hash. A program that is missing, or that
 * does not run (macOS may not let a helper it has not seen run), gives none, and is not used until the
 * app starts again.
 */
export function shippedProgram(path: string, args: string[], versionOf: (stdout: string) => string | null, run: RunProcess = runProcess) {
  let version: string | null = null
  const asked = run(path, args, { signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) }).then(
    ({ stdout }) => {
      version = versionOf(stdout)
    },
    () => {},
  )
  return {
    /** Settles once the program has been asked: true when it gave its version. */
    async ready(): Promise<boolean> {
      await asked
      return version !== null
    },
    /** Where it is, once it has given its version; null before then, or when it gave none. */
    path: (): string | null => (version === null ? null : path),
    /** The version it gave; "" before then, or when it gave none. */
    version: (): string => version ?? "",
  }
}

export type ShippedProgram = ReturnType<typeof shippedProgram>
```

- [ ] **Step 4: Run them and see them pass.**

  Run: `npx vitest run apps/desktop/src/main/cutout-probe.test.ts`

  Expected: PASS (9 tests).

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 10: The cutout renderer — `main/cutout-render.ts`

**Files:**
- Check (Step 0): `packages/core/package.json` and `packages/core/src/cutout/index.ts`
- Maybe create (Step 0): `packages/core/src/cutout/occlusion.ts`, holding only `SampleMask` until Task 14
- Modify: `apps/desktop/src/shared/api.ts` (`AppEvent`, after the `"graphics"` members, ~:461-465)
- Create: `apps/desktop/src/main/cutout-render.ts`
- Test: `apps/desktop/src/main/cutout-render.test.ts` (new)

**How it is built:**
- It mirrors `graphics-render.ts` wherever that fits:
  - a hash of 16 hex characters names every file, and the `HASH` guard keeps anything else away from a path;
  - a job counts as made when its `.json` reads and its `.mov` is there, and the `.json` is written last, through `writeFileAtomic`;
  - failures are kept in memory until `retry`;
  - `cancel()` moves the generation on, so nothing asked for before a cancel starts;
  - asks are sorted in arrival order on a `sorting` chain;
  - an event the app cannot take never stops the queue;
  - an ask that queues nothing says nothing.
- The queue is not the graphics' promise chain: a chain can neither drop a job nor move one forward. Spec §7.3 needs both. `ensure(folder, jobs)` replaces a project's wanted set, and a job no one wants any more is dropped before it starts. `wait` puts its jobs first.
- The pump picks work in this order, one run at a time across every project:
  1. samples;
  2. jobs a write waits for, oldest write first;
  3. the project that asked last;
  4. the rest.

  Within each project, jobs run in the order it asked for them, which is clip time.
- A run spawns the helper and the app's ffmpeg with one AbortSignal. A cancel or the time limit kills both at once. So does either program failing on its own, and that program is then the one blamed.
- Events go to every project that wants the job: `started`, then `progress` whenever the whole percent moves on, then `done` or `failed`.

**Beyond the contract** (the contract's names are all kept; these are additions):
- `CutoutRenderDeps.spawn?: SpawnProgram`. The tests use it to stand in for `child_process.spawn`, which is the default.
- `sample(job, folder?)` takes an optional folder. When a sample is taken or fails, that project gets a `"cutout"` event (`done` or `failed`) whose `hash` is the sample's own key. This lets a preview that did not wait for the sample look again.
  - The `sample` signature has no folder of its own for events to go to.
  - On the CapCut route no cutout runs, so no other event would come.
- A sample frame that fails is left out of the answer. It is remembered, so a preview that asks again does not loop, until any `retry(hash)`.
- Other exports: `cutoutTimeoutMs`, `CutoutChild`, `SpawnProgram`, `CutoutRenderer`.

- [ ] **Step 0: Make sure core has what the renderer imports.**
  - `packages/core/package.json` must list `"./cutout": "./src/cutout/index.ts"`. Task 6 adds it; if it is not there, add it after `"./capcut/bin"`.
  - `CUTOUT_PIPELINE_VERSION` comes from Task 3's `frames.ts`.
  - `SampleMask` belongs in `packages/core/src/cutout/occlusion.ts`, which Task 14 writes. If that file does not exist yet, create it with only this type:

```ts
/** A person mask the helper sampled, small (spec §10): 8-bit, row-major, 255 where the person is. */
export interface SampleMask {
  width: number
  height: number
  data: Uint8Array
}
```

  Then add `export * from "./occlusion.ts"` to `packages/core/src/cutout/index.ts`, next to the other `export *` lines. Task 14 adds the rest of `occlusion.ts` to this same file.

- [ ] **Step 1: Write the failing tests.** Create `apps/desktop/src/main/cutout-render.test.ts`:

```ts
import { createHash } from "node:crypto"
import { EventEmitter, once } from "node:events"
import { existsSync } from "node:fs"
import { appendFile, chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { afterEach, expect, test, vi } from "vitest"
import { CUTOUT_PIPELINE_VERSION } from "@boxblack/core/cutout"
import type { AppEvent } from "../shared/api.ts"
import { createCutoutRenderer, cutoutTimeoutMs, type CutoutChild, type CutoutJob, type CutoutRenderDeps } from "./cutout-render.ts"

const temps: string[] = []
async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const HELPER = "/app/bin/boxblack-segment"
const FFMPEG = "/app/bin/ffmpeg"
const FOLDER = "/drafts/0917"
const STOPPED = "the person cutouts were stopped before they were made; the draft was not changed"

/** A program the tests stand in for: given its arguments, its streams and the signal that kills it, it runs, then exits with a code. */
type Program = (args: string[], io: { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; signal: AbortSignal }) => Promise<number>

/**
 * child_process.spawn for the tests: runs the program named by `command` in this process. Like a real
 * one it exits once, with its code, or with none as soon as the signal it was started with aborts (a
 * killed program's own promise is left to itself), and says "close" once its output has been read.
 */
function fakeSpawn(programs: Record<string, Program>) {
  const started: { command: string; args: string[]; signal: AbortSignal }[] = []
  const spawn = (command: string, args: string[], signal: AbortSignal): CutoutChild => {
    const io = { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }
    // a program killed mid-write, or one whose reader went, has nowhere to say so
    for (const stream of Object.values(io)) stream.on("error", () => {})
    const child = Object.assign(new EventEmitter(), io) as unknown as CutoutChild
    started.push({ command, args, signal })
    const program = programs[command]
    if (!program) {
      setImmediate(() => child.emit("error", Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" })))
      return child
    }
    let ended = false
    const exit = async (code: number | null) => {
      if (ended) return
      ended = true
      io.stdout.end()
      io.stderr.end()
      await Promise.all([io.stdout, io.stderr].map((stream) => (stream.readableEnded ? null : once(stream, "end").catch(() => {}))))
      child.emit("close", code)
    }
    if (signal.aborted) void exit(null)
    else signal.addEventListener("abort", () => void exit(null), { once: true })
    void program(args, { ...io, signal }).then(
      (code) => exit(code),
      () => exit(1),
    )
    return child
  }
  return { spawn, started }
}

interface Run {
  args: string[]
  pts: number[]
  signal: AbortSignal
  release?: () => void
}

/**
 * A renderer whose helper and ffmpeg are stand-ins, on a real source file and real folders. The helper's
 * `render` notes its run, holds the first `hold` runs until the test releases them or they are killed,
 * then writes one "frame" per listed pts, says its progress frame by frame, and the coverage it is given
 * (none for null); its `sample` answers a 2×1 mask per pts. `fail` makes either say that (with <video>
 * standing for the source's path) and exit 1. The stand-in ffmpeg writes what it reads to the file it is
 * given, or fails at once with `ffmpegFails`.
 */
async function setup(over: { coverage?: number | null; fail?: string; ffmpegFails?: string; hold?: number; timeoutMs?: number; helperVersion?: () => string; send?: (event: AppEvent) => void } = {}) {
  const dir = await temp("cutout-")
  const video = join(dir, "IMG_9646.MOV")
  await writeFile(video, "not really a video")
  const found = await stat(video)
  const source = { path: video, size: found.size, mtimeMs: found.mtimeMs }
  const events: AppEvent[] = []
  const runs: Run[] = []
  const sampled: { args: string[]; pts: number[] }[] = []
  const encodes: { args: string[]; signal: AbortSignal }[] = []
  const fake = fakeSpawn({
    [HELPER]: async (args, io) => {
      const pts = (JSON.parse(await readFile(args[args.indexOf("--pts") + 1]!, "utf8")) as { pts: number[] }).pts
      const failing = over.fail?.replace("<video>", args[1]!)
      if (args[0] === "sample") {
        sampled.push({ args, pts })
        if (failing) {
          io.stderr.write(`${failing}\n`)
          return 1
        }
        for (const at of pts) io.stdout.write(`${JSON.stringify({ pts: at, width: 2, height: 1, mask: Buffer.from([at % 256, 255]).toString("base64") })}\n`)
        return 0
      }
      const run: Run = { args, pts, signal: io.signal }
      runs.push(run)
      if (runs.length <= (over.hold ?? 0)) {
        await new Promise<void>((resolve) => {
          run.release = resolve
          io.signal.addEventListener("abort", () => resolve(), { once: true })
        })
      }
      if (io.signal.aborted) return 1
      if (failing) {
        io.stderr.write(`progress 1 ${pts.length}\n${failing}\n`)
        return 1
      }
      pts.forEach((at, i) => {
        io.stdout.write(`frame ${at};`)
        io.stderr.write(`progress ${i + 1} ${pts.length}\n`)
      })
      if (over.coverage !== null) io.stderr.write(`coverage ${over.coverage ?? 0.4}\n`)
      return 0
    },
    [FFMPEG]: async (args, io) => {
      encodes.push({ args, signal: io.signal })
      if (over.ffmpegFails) {
        io.stderr.write(`${over.ffmpegFails}\n`)
        return 1
      }
      let frames = ""
      for await (const chunk of io.stdin) frames += String(chunk)
      // killed, it writes nothing more
      if (io.signal.aborted) return 1
      await writeFile(args.at(-1)!, frames)
      return 0
    },
  })
  const deps: CutoutRenderDeps = {
    cutoutsDir: join(dir, "cutouts"),
    workDir: join(dir, "work"),
    helper: () => HELPER,
    ffmpeg: () => FFMPEG,
    helperVersion: over.helperVersion ?? (() => "1"),
    ffmpegVersion: () => "8.1.2",
    ...(over.timeoutMs === undefined ? {} : { timeoutMsFor: () => over.timeoutMs! }),
    spawn: fake.spawn,
    send: over.send ?? ((event) => events.push(event)),
  }
  const renderer = createCutoutRenderer(deps)
  /** A job on this source: its frames, spare first, at a size small enough to write out. */
  const job = (change: Partial<CutoutJob> = {}): CutoutJob => ({ source, timescale: 600, pts: [20, 20, 40, 60], width: 4, height: 2, ...change })
  return { dir, video, source, deps, events, runs, sampled, encodes, started: fake.started, renderer, job, cutouts: deps.cutoutsDir, work: deps.workDir }
}

const sha16 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)

test("a job's frames go from the helper into ffmpeg, into a file named by the job's hash, with the meta the writer needs written last", async () => {
  const { renderer, job, runs, encodes, source, cutouts, work } = await setup()
  const hash = renderer.hashOf(job())
  expect(hash).toMatch(/^[0-9a-f]{16}$/)
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [hash], failed: [], noPerson: [] })
  // the helper is given the frames in file order, spare first, through a list in the work folder
  expect(runs).toHaveLength(1)
  expect(runs[0]!.args).toEqual(["render", source.path, "--pts", join(work, hash, "pts.json"), "--width", "4", "--height", "2"])
  expect(runs[0]!.pts).toEqual([20, 20, 40, 60])
  // ffmpeg encodes as proven, into a file that is renamed into place when it is whole
  expect(encodes[0]!.args).toEqual([
    "-hide_banner", "-nostats", "-v", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "yuva444p10le", "-s", "4x2", "-framerate", "30", "-i", "-",
    "-vf", "settb=1/600,setpts=20*N", "-fps_mode", "passthrough", "-enc_time_base:v", "1/600", "-video_track_timescale", "600",
    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "8", "-qscale:v", "12", "-vendor", "apl0",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    join(cutouts, `.${hash}.partial.mov`),
  ])
  expect(await readFile(join(cutouts, `${hash}.mov`), "utf8")).toBe("frame 20;frame 20;frame 40;frame 60;")
  // four frames of 1/30 s, the spare one included
  expect(JSON.parse(await readFile(join(cutouts, `${hash}.json`), "utf8"))).toEqual({ width: 4, height: 2, durationUs: 133_333, frames: 4, coverage: 0.4 })
  expect(await renderer.rendered(job())).toEqual({ hash, path: join(cutouts, `${hash}.mov`), width: 4, height: 2, durationUs: 133_333, frames: 4 })
  expect(await renderer.statusOf(hash)).toEqual({ state: "ready" })
  // nothing is left of the run
  expect((await readdir(cutouts)).sort()).toEqual([`${hash}.json`, `${hash}.mov`])
  expect(await readdir(work)).toEqual([])
  // asked again, twice over, it is answered from its files
  await expect(renderer.wait(FOLDER, [job(), job()])).resolves.toEqual({ ready: [hash], failed: [], noPerson: [] })
  expect(runs).toHaveLength(1)
  expect(await renderer.rendered(job({ width: 6 }))).toBeNull()
})

test("everything the file is made from is part of its hash: the source file, its frames and their order, the size, the frame rule, the helper and ffmpeg", async () => {
  const { renderer, job, deps } = await setup()
  const base = job()
  const hashes = [
    base,
    job({ source: { ...base.source, path: "/Users/me/Movies/IMG_9647.MOV" } }),
    job({ source: { ...base.source, size: base.source.size + 1 } }),
    job({ source: { ...base.source, mtimeMs: base.source.mtimeMs + 1 } }),
    job({ timescale: 30_000 }),
    job({ pts: [20, 20, 40, 61] }),
    job({ pts: [20, 40, 20, 60] }),
    job({ pts: [20, 20, 40] }),
    job({ width: 6 }),
    job({ height: 4 }),
  ].map(renderer.hashOf)
  expect(new Set(hashes).size).toBe(hashes.length)
  expect(createCutoutRenderer({ ...deps, helperVersion: () => "2" }).hashOf(base)).not.toBe(hashes[0])
  expect(createCutoutRenderer({ ...deps, ffmpegVersion: () => "8.2" }).hashOf(base)).not.toBe(hashes[0])
  expect(hashes[0]).toBe(sha16([base.source.path, base.source.size, base.source.mtimeMs, 600, [20, 20, 40, 60], 4, 2, CUTOUT_PIPELINE_VERSION, "1", "8.1.2"]))
})

test("a job made before is answered from its files with nothing run, even with no helper; one found empty of people too", async () => {
  const { deps, job, cutouts, started } = await setup()
  const none = createCutoutRenderer({ ...deps, helper: () => null })
  const [made, empty] = [job(), job({ pts: [20, 40] })]
  await mkdir(cutouts, { recursive: true })
  await writeFile(join(cutouts, `${none.hashOf(made)}.mov`), "person")
  await writeFile(join(cutouts, `${none.hashOf(made)}.json`), JSON.stringify({ width: 4, height: 2, durationUs: 133_333, frames: 4, coverage: 0.3 }))
  await writeFile(join(cutouts, `${none.hashOf(empty)}.json`), JSON.stringify({ coverage: 0.001, noPerson: true }))
  await expect(none.wait(FOLDER, [made, empty])).resolves.toEqual({ ready: [none.hashOf(made)], failed: [], noPerson: [none.hashOf(empty)] })
  none.ensure(FOLDER, [made, empty])
  await vi.waitFor(() => expect(none.idle()).toBe(true))
  expect(started).toEqual([])
  expect(await none.statusOf(none.hashOf(empty))).toEqual({ state: "no-person" })
  expect(await none.rendered(empty)).toBeNull()
  expect(await none.rendered(made)).toEqual({ hash: none.hashOf(made), path: join(cutouts, `${none.hashOf(made)}.mov`), width: 4, height: 2, durationUs: 133_333, frames: 4 })
})

test("a job is made only when its meta reads and, unless it found no one, its file is there: anything less is cut again", async () => {
  const meta = JSON.stringify({ width: 4, height: 2, durationUs: 133_333, frames: 4, coverage: 0.4 })
  for (const [json, mov] of [["", true], ['{"width": 4, "hei', true], ["null", true], [meta, false]] as const) {
    const { renderer, job, runs, cutouts } = await setup()
    const hash = renderer.hashOf(job())
    await mkdir(cutouts, { recursive: true })
    await writeFile(join(cutouts, `${hash}.json`), json)
    if (mov) await writeFile(join(cutouts, `${hash}.mov`), "left over")
    expect(await renderer.statusOf(hash), json).toEqual({ state: "waiting" })
    await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [hash], failed: [], noPerson: [] })
    expect(runs).toHaveLength(1)
    expect(await readFile(join(cutouts, `${hash}.mov`), "utf8")).toBe("frame 20;frame 20;frame 40;frame 60;")
  }
})

test("a job with too little person in it keeps no file: its meta says so, and it is not cut again", async () => {
  const { renderer, job, runs, cutouts, events } = await setup({ coverage: 0.019 })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [], failed: [], noPerson: [hash] })
  expect(await readdir(cutouts)).toEqual([`${hash}.json`])
  expect(JSON.parse(await readFile(join(cutouts, `${hash}.json`), "utf8"))).toEqual({ coverage: 0.019, noPerson: true })
  expect(await renderer.statusOf(hash)).toEqual({ state: "no-person" })
  expect(await renderer.rendered(job())).toBeNull()
  expect(events.at(-1)).toEqual({ type: "cutout", folder: FOLDER, hash, state: "done" })
  await renderer.wait(FOLDER, [job()])
  expect(runs).toHaveLength(1)
  // 2% of the picture is a person
  const enough = await setup({ coverage: 0.02 })
  await expect(enough.renderer.wait(FOLDER, [enough.job()])).resolves.toEqual({ ready: [enough.renderer.hashOf(enough.job())], failed: [], noPerson: [] })
})

test("a failed job is remembered, with the helper's last line, until retried, and reported; its source is named by its file", async () => {
  const { renderer, job, runs, events, cutouts, work } = await setup({ fail: "cannot decode frame 12 of <video>" })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [], failed: [hash], noPerson: [] })
  expect(await renderer.statusOf(hash)).toEqual({ state: "failed", error: "cannot decode frame 12 of IMG_9646.MOV" })
  expect(events).toContainEqual({ type: "cutout", folder: FOLDER, hash, state: "failed", error: "cannot decode frame 12 of IMG_9646.MOV" })
  // nothing is left of it
  expect(await readdir(cutouts)).toEqual([])
  expect(await readdir(work)).toEqual([])
  // asked again, it is not cut again, and nothing is said: the app asks on every look at a preview
  events.length = 0
  renderer.ensure(FOLDER, [job()])
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [], failed: [hash], noPerson: [] })
  expect(runs).toHaveLength(1)
  expect(events).toEqual([])
  renderer.retry(hash)
  expect(await renderer.statusOf(hash)).toEqual({ state: "waiting" })
  await renderer.wait(FOLDER, [job()])
  expect(runs).toHaveLength(2)
})

test("ffmpeg failing fails the job with ffmpeg's own last line, and stops the helper", async () => {
  const { renderer, job, runs } = await setup({ ffmpegFails: "Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height", hold: 1 })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [], failed: [hash], noPerson: [] })
  expect(await renderer.statusOf(hash)).toEqual({ state: "failed", error: "ffmpeg could not encode the person file: Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height" })
  expect(runs[0]!.signal.aborted).toBe(true)
})

test("a helper that does not say how much of the picture the person covers fails the job", async () => {
  const { renderer, job } = await setup({ coverage: null })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [], failed: [hash], noPerson: [] })
  expect((await renderer.statusOf(hash)).error).toBe("the person cutter did not say how much of the picture the person covers")
})

test("no helper, no ffmpeg, a program that does not start, or a source changed since it was read fails the job, saying why", async () => {
  const { deps, job, video, runs } = await setup()
  const cases = [
    [{ helper: () => null }, "the app's person cutter is missing"],
    [{ ffmpeg: () => null }, "the app's ffmpeg is missing"],
    [{ helper: () => "/app/bin/gone" }, "spawn /app/bin/gone ENOENT"],
  ] as const
  for (const [change, message] of cases) {
    const short = createCutoutRenderer({ ...deps, ...change })
    const hash = short.hashOf(job())
    await expect(short.wait(FOLDER, [job()]), message).resolves.toEqual({ ready: [], failed: [hash], noPerson: [] })
    expect(await short.statusOf(hash)).toEqual({ state: "failed", error: message })
  }
  const changed = createCutoutRenderer(deps)
  await appendFile(video, " and more")
  const hash = changed.hashOf(job())
  await expect(changed.wait(FOLDER, [job()])).resolves.toEqual({ ready: [], failed: [hash], noPerson: [] })
  expect(await changed.statusOf(hash)).toEqual({ state: "failed", error: "IMG_9646.MOV changed or went away after it was read" })
  expect(runs).toHaveLength(0)
})

test("a cut tells the projects that want it as it starts, as its frames are done, a whole percent at a time, and as it ends", async () => {
  const { renderer, job, events } = await setup()
  const hash = renderer.hashOf(job())
  await renderer.wait(FOLDER, [job()])
  expect(events).toEqual([
    { type: "cutout", folder: FOLDER, hash, state: "started" },
    { type: "cutout", folder: FOLDER, hash, state: "progress", done: 1, total: 4 },
    { type: "cutout", folder: FOLDER, hash, state: "progress", done: 2, total: 4 },
    { type: "cutout", folder: FOLDER, hash, state: "progress", done: 3, total: 4 },
    { type: "cutout", folder: FOLDER, hash, state: "progress", done: 4, total: 4 },
    { type: "cutout", folder: FOLDER, hash, state: "done" },
  ])
  events.length = 0
  const long = job({ pts: Array.from({ length: 300 }, (_, i) => 20 * i) })
  await renderer.wait(FOLDER, [long])
  const progress = events.filter((event) => event.type === "cutout" && event.state === "progress")
  expect(progress).toHaveLength(101)
  expect(progress.at(-1)).toEqual({ type: "cutout", folder: FOLDER, hash: renderer.hashOf(long), state: "progress", done: 300, total: 300 })
})

test("one job is cut at a time, whatever the project; the same frames asked for by two projects are cut once, and both hear of it", async () => {
  const { renderer, job, runs, events } = await setup({ hold: 2 })
  const [a, b] = [job(), job({ pts: [20, 40] })]
  renderer.ensure("/drafts/0917", [a])
  renderer.ensure("/drafts/0918", [b, a])
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(await renderer.statusOf(renderer.hashOf(a))).toEqual({ state: "cutting", done: 0, total: 4 })
  expect(await renderer.statusOf(renderer.hashOf(b))).toEqual({ state: "waiting" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(runs).toHaveLength(1)
  runs[0]!.release!()
  await vi.waitFor(() => expect(runs).toHaveLength(2))
  expect(runs[1]!.pts).toEqual([20, 40])
  runs[1]!.release!()
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  expect(runs).toHaveLength(2)
  expect(events.filter((event) => event.type === "cutout" && event.state === "done")).toEqual([
    { type: "cutout", folder: "/drafts/0917", hash: renderer.hashOf(a), state: "done" },
    { type: "cutout", folder: "/drafts/0918", hash: renderer.hashOf(a), state: "done" },
    { type: "cutout", folder: "/drafts/0918", hash: renderer.hashOf(b), state: "done" },
  ])
})

test("a project's ask replaces what it asked before: a job it no longer wants, and no one else does, is dropped unstarted; the one under way is finished", async () => {
  const { renderer, job, runs } = await setup({ hold: 1 })
  const [a, b, c] = [job(), job({ pts: [20, 40] }), job({ pts: [40, 60] })]
  renderer.ensure(FOLDER, [a, b, c])
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  renderer.ensure(FOLDER, [c])
  // asks take effect in the order they came: by the time this one is sorted, so is the one before
  await renderer.wait(FOLDER, [])
  runs[0]!.release!()
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  expect(runs.map((run) => run.pts)).toEqual([a.pts, c.pts])
  expect(await renderer.statusOf(renderer.hashOf(a))).toEqual({ state: "ready" })
  expect(await renderer.statusOf(renderer.hashOf(b))).toEqual({ state: "waiting" })
  // an ask for nothing drops everything the project had not started
  const other = await setup({ hold: 1 })
  other.renderer.ensure(FOLDER, [other.job(), other.job({ pts: [20, 40] })])
  await vi.waitFor(() => expect(other.runs).toHaveLength(1))
  other.renderer.ensure(FOLDER, [])
  await other.renderer.wait(FOLDER, [])
  other.runs[0]!.release!()
  await vi.waitFor(() => expect(other.renderer.idle()).toBe(true))
  expect(other.runs).toHaveLength(1)
})

test("the jobs a write waits for are cut first, then the project that asked last, then the rest, each in the order asked", async () => {
  const { renderer, job, runs } = await setup({ hold: 1 })
  const [a, b, c, d] = [job(), job({ pts: [20, 40] }), job({ pts: [40, 60] }), job({ pts: [60, 80] })]
  renderer.ensure("/drafts/0917", [a, b])
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  renderer.ensure("/drafts/0918", [c])
  const waited = renderer.wait("/drafts/0919", [d])
  await renderer.wait("/drafts/0919", [])
  runs[0]!.release!()
  await expect(waited).resolves.toEqual({ ready: [renderer.hashOf(d)], failed: [], noPerson: [] })
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  // a was under way; then the write's d, the latest project's c, and b last
  expect(runs.map((run) => run.pts)).toEqual([a.pts, d.pts, c.pts, b.pts])
})

test("a wait for a job already under way joins it, and settles with it", async () => {
  const { renderer, job, runs, events } = await setup({ hold: 1 })
  renderer.ensure("/drafts/0917", [job()])
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  const waited = renderer.wait("/drafts/0918", [job()])
  await renderer.wait("/drafts/0918", [])
  runs[0]!.release!()
  await expect(waited).resolves.toEqual({ ready: [renderer.hashOf(job())], failed: [], noPerson: [] })
  expect(runs).toHaveLength(1)
  expect(events).toContainEqual({ type: "cutout", folder: "/drafts/0918", hash: renderer.hashOf(job()), state: "done" })
})

test("a job that runs past its time is stopped, both programs with it, and counts as failed, unlike a cancel", async () => {
  const { renderer, job, runs, encodes, events } = await setup({ hold: 1, timeoutMs: 50 })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [], failed: [hash], noPerson: [] })
  expect(runs[0]!.signal.aborted).toBe(true)
  expect(encodes[0]!.signal.aborted).toBe(true)
  expect(await renderer.statusOf(hash)).toEqual({ state: "failed", error: "the person cutout timed out after 0 s" })
  expect(events).toContainEqual(expect.objectContaining({ type: "cutout", state: "failed", hash }))
})

test("a job's time grows with its length and its picture: 30 s, and 6 s for every second at 1080×1920", () => {
  const of = (frames: number, width: number, height: number): CutoutJob => ({ source: { path: "/v.MOV", size: 1, mtimeMs: 1 }, timescale: 600, pts: Array.from({ length: frames }, (_, i) => 20 * i), width, height })
  expect(cutoutTimeoutMs(of(300, 1080, 1920))).toBe(90_000)
  expect(cutoutTimeoutMs(of(300, 540, 960))).toBe(45_000)
  expect(cutoutTimeoutMs(of(1, 1080, 1920))).toBe(30_200)
})

test("cancel() stops the cut under way and drops everything queued: a write waiting is told, nothing counts as failed, and what is asked for later is cut", async () => {
  const { renderer, job, source, runs, encodes, events, cutouts, work } = await setup({ hold: 1 })
  const [a, b] = [job(), job({ pts: [20, 40] })]
  const waited = renderer.wait(FOLDER, [a, b])
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  const sampled = renderer.sample({ source, pts: [0] })
  await renderer.wait(FOLDER, [])
  renderer.cancel()
  await expect(waited).rejects.toThrow(STOPPED)
  await expect(sampled).rejects.toThrow(STOPPED)
  expect(runs[0]!.signal.aborted).toBe(true)
  expect(encodes[0]!.signal.aborted).toBe(true)
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  expect(runs).toHaveLength(1)
  for (const one of [a, b]) expect(await renderer.statusOf(renderer.hashOf(one))).toEqual({ state: "waiting" })
  expect(events.some((event) => event.type === "cutout" && event.state === "failed")).toBe(false)
  // nothing is left of the stopped run
  expect(await readdir(cutouts)).toEqual([])
  expect(await readdir(work)).toEqual([])
  // the quit was called off: what is asked for now is cut
  await expect(renderer.wait(FOLDER, [a, b])).resolves.toEqual({ ready: [renderer.hashOf(a), renderer.hashOf(b)], failed: [], noPerson: [] })
})

test("what was asked for just before a cancel is dropped: an ensure starts nothing, and a wait is told", async () => {
  const { renderer, job, runs } = await setup()
  renderer.ensure(FOLDER, [job()])
  const waited = renderer.wait(FOLDER, [job({ pts: [20, 40] })])
  renderer.cancel()
  await expect(waited).rejects.toThrow(STOPPED)
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  expect(runs).toHaveLength(0)
})

test("idle() says whether anything asked for is being sorted, queued or cut", async () => {
  const { renderer, job, runs } = await setup({ hold: 1 })
  expect(renderer.idle()).toBe(true)
  renderer.ensure(FOLDER, [job(), job({ pts: [20, 40] })])
  expect(renderer.idle()).toBe(false)
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(renderer.idle()).toBe(false)
  runs[0]!.release!()
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  expect(runs).toHaveLength(2)
  // a look at jobs already made is over once they are sorted
  renderer.ensure(FOLDER, [job()])
  expect(renderer.idle()).toBe(false)
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
})

test("at start, what a run left when the app last stopped goes: the work folder and half-encoded files, and nothing else", async () => {
  const { deps, renderer: first } = await setup()
  await first.wait(FOLDER, [])
  const stale = "0123456789abcdef"
  await mkdir(join(deps.workDir, stale), { recursive: true })
  await writeFile(join(deps.workDir, stale, "pts.json"), "{}")
  await mkdir(deps.cutoutsDir, { recursive: true })
  for (const name of [`.${stale}.partial.mov`, `${stale}.mov`, `${stale}.json`, "notes.mov", ".DS_Store"]) await writeFile(join(deps.cutoutsDir, name), "x")
  const renderer = createCutoutRenderer(deps)
  await renderer.wait(FOLDER, [])
  expect(existsSync(deps.workDir)).toBe(false)
  expect((await readdir(deps.cutoutsDir)).sort()).toEqual([".DS_Store", `${stale}.json`, `${stale}.mov`, "notes.mov"])
})

test("a head-cover sample runs the helper for the frames not kept yet, keeps their masks with the source's, and answers them decoded", async () => {
  const { renderer, source, sampled, events, cutouts, work } = await setup()
  const key = sha16([source.path, source.size, source.mtimeMs])
  const first = await renderer.sample({ source, pts: [0, 20, 40, 20] }, FOLDER)
  expect([...first.keys()].sort((x, y) => x - y)).toEqual([0, 20, 40])
  expect(first.get(20)).toEqual({ width: 2, height: 1, data: new Uint8Array([20, 255]) })
  expect(sampled).toHaveLength(1)
  expect(sampled[0]!.args).toEqual(["sample", source.path, "--pts", join(work, `sample-${key}`, "pts.json"), "--size", "256"])
  expect(sampled[0]!.pts).toEqual([0, 20, 40])
  expect(events).toEqual([{ type: "cutout", folder: FOLDER, hash: key, state: "done" }])
  // one file per source, named by the file they were taken from, saying which
  const kept = JSON.parse(await readFile(join(cutouts, "samples", `${key}.json`), "utf8"))
  expect(kept).toMatchObject({ source, helper: "1", size: 256 })
  expect(Object.keys(kept.masks).sort()).toEqual(["0", "20", "40"])
  // asked again, they are answered from the file, and nothing is said; asked for one more, only that one is taken
  expect((await renderer.sample({ source, pts: [40, 0] }, FOLDER)).get(40)).toEqual({ width: 2, height: 1, data: new Uint8Array([40, 255]) })
  expect(sampled).toHaveLength(1)
  expect(events).toHaveLength(1)
  const more = await renderer.sample({ source, pts: [20, 60] })
  expect([...more.keys()].sort((x, y) => x - y)).toEqual([20, 60])
  expect(sampled[1]!.pts).toEqual([60])
  expect(Object.keys(JSON.parse(await readFile(join(cutouts, "samples", `${key}.json`), "utf8")).masks).sort()).toEqual(["0", "20", "40", "60"])
  expect(await readdir(work)).toEqual([])
})

test("masks another helper took are taken again", async () => {
  let version = "1"
  const { renderer, source, sampled } = await setup({ helperVersion: () => version })
  await renderer.sample({ source, pts: [0] })
  await renderer.sample({ source, pts: [0] })
  version = "2"
  await renderer.sample({ source, pts: [0] })
  expect(sampled).toHaveLength(2)
})

test("samples go before any cut waiting its turn", async () => {
  const { renderer, job, source, runs, started } = await setup({ hold: 1 })
  renderer.ensure(FOLDER, [job(), job({ pts: [20, 40] })])
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  const sampled = renderer.sample({ source, pts: [0] })
  await renderer.wait(FOLDER, [])
  runs[0]!.release!()
  await sampled
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  expect(started.filter((one) => one.command === HELPER).map((one) => one.args[0])).toEqual(["render", "sample", "render"])
})

test("a sample that fails is left out of the answer, told once to the project that asked, and not taken again until a retry", async () => {
  const { renderer, job, source, sampled, events } = await setup({ fail: "the video track of <video> cannot be decoded" })
  const key = sha16([source.path, source.size, source.mtimeMs])
  expect((await renderer.sample({ source, pts: [0, 20] }, FOLDER)).size).toBe(0)
  expect(events).toEqual([{ type: "cutout", folder: FOLDER, hash: key, state: "failed", error: "the video track of IMG_9646.MOV cannot be decoded" }])
  expect((await renderer.sample({ source, pts: [0, 20] }, FOLDER)).size).toBe(0)
  expect(sampled).toHaveLength(1)
  expect(events).toHaveLength(1)
  renderer.retry(renderer.hashOf(job()))
  await renderer.sample({ source, pts: [0] })
  expect(sampled).toHaveLength(2)
})

test("anything but a hash given for one gets a neutral answer, and never reaches a path", async () => {
  const { renderer, job } = await setup()
  await renderer.wait(FOLDER, [job()])
  const hash = renderer.hashOf(job())
  expect(await renderer.statusOf(`../cutouts/${hash}`)).toEqual({ state: "waiting" })
  renderer.retry(`../cutouts/${hash}`)
  expect(await renderer.statusOf(hash)).toEqual({ state: "ready" })
})

test("an event the app cannot take stops nothing", async () => {
  const { renderer, job } = await setup({
    send: () => {
      throw new Error("the window is gone")
    },
  })
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [renderer.hashOf(job())], failed: [], noPerson: [] })
})

/** A stand-in program on disk: `body` runs under /bin/sh once it has noted its arguments, one a line, in `<path>.args`. */
async function script(dir: string, name: string, body: string): Promise<{ path: string; args: () => Promise<string[]> }> {
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n: > "${path}.args"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${path}.args"; done\n${body}\n`)
  await chmod(path, 0o755)
  return { path, args: async () => (await readFile(`${path}.args`, "utf8")).trimEnd().split("\n") }
}

test("by default the helper and ffmpeg run as programs, the helper's output piped into ffmpeg", async () => {
  const { deps, job, source } = await setup()
  const tools = await temp("cutout-tools-")
  const helper = await script(tools, "boxblack-segment", `printf 'frames of the person'\nprintf 'progress 1 1\\ncoverage 0.25\\n' >&2`)
  const ffmpeg = await script(tools, "ffmpeg", `for a in "$@"; do out="$a"; done\ncat > "$out"`)
  const events: AppEvent[] = []
  const renderer = createCutoutRenderer({ ...deps, spawn: undefined, helper: () => helper.path, ffmpeg: () => ffmpeg.path, send: (event) => events.push(event) })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait(FOLDER, [job()])).resolves.toEqual({ ready: [hash], failed: [], noPerson: [] })
  expect(await readFile(join(deps.cutoutsDir, `${hash}.mov`), "utf8")).toBe("frames of the person")
  expect(JSON.parse(await readFile(join(deps.cutoutsDir, `${hash}.json`), "utf8"))).toMatchObject({ coverage: 0.25 })
  expect((await helper.args()).slice(0, 2)).toEqual(["render", source.path])
  expect((await ffmpeg.args()).at(-1)).toBe(join(deps.cutoutsDir, `.${hash}.partial.mov`))
  expect(events).toContainEqual({ type: "cutout", folder: FOLDER, hash, state: "progress", done: 1, total: 1 })
})

test("by default a cancel kills both programs at once", async () => {
  const { deps, job } = await setup()
  const tools = await temp("cutout-tools-")
  const helper = await script(tools, "boxblack-segment", `echo $$ > "${tools}/helper.pid"\nwhile :; do /bin/sleep 0.05; done`)
  const ffmpeg = await script(tools, "ffmpeg", `echo $$ > "${tools}/ffmpeg.pid"\ncat > /dev/null`)
  const renderer = createCutoutRenderer({ ...deps, spawn: undefined, helper: () => helper.path, ffmpeg: () => ffmpeg.path })
  const waited = renderer.wait(FOLDER, [job()])
  await vi.waitFor(() => expect(existsSync(join(tools, "helper.pid")) && existsSync(join(tools, "ffmpeg.pid"))).toBe(true), { timeout: 5_000 })
  const pids = await Promise.all(["helper", "ffmpeg"].map(async (name) => Number((await readFile(join(tools, `${name}.pid`), "utf8")).trim())))
  renderer.cancel()
  await expect(waited).rejects.toThrow(STOPPED)
  await vi.waitFor(
    () => {
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
    },
    { timeout: 5_000 },
  )
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
})
```

- [ ] **Step 2: Run them and see them fail.**

  Run: `npx vitest run apps/desktop/src/main/cutout-render.test.ts`

  Expected: FAIL, `Cannot find module './cutout-render.ts'`.

- [ ] **Step 3: Implement.**

  In `apps/desktop/src/shared/api.ts`, `AppEvent` gains the contract's member right after the four `"graphics"` members:

```ts
  | { type: "graphics"; folder: string; state: "failed"; hash: string; error: string }
  /**
   * pushed while people are cut out in the background, for the project in `folder`: as a cutout starts,
   * as its frames are done (`done` of `total`, told as the whole percent moves on), and as it ends, made
   * or found empty (`done`) or not (`failed`, with why); a head-cover sample's end too, under its own key
   */
  | { type: "cutout"; folder: string; hash: string; state: "started" | "progress" | "done" | "failed"; done?: number; total?: number; error?: string }
```

  Create `apps/desktop/src/main/cutout-render.ts`:

```ts
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import type { EventEmitter } from "node:events"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { Readable, Writable } from "node:stream"
import { StringDecoder } from "node:string_decoder"
import { writeFileAtomic } from "@boxblack/core/atomic-write"
import { CUTOUT_PIPELINE_VERSION, type SampleMask } from "@boxblack/core/cutout"
import type { AppEvent } from "../shared/api.ts"

/** One person file to make: which frames of which source, in the order the file holds them, at what size. */
export interface CutoutJob {
  /** the source video as it was read: a file changed since is another job */
  source: { path: string; size: number; mtimeMs: number }
  /** the source's video timescale (ticks per second) */
  timescale: number
  /** the source pts (ticks) of each file frame, spare first: personFrames mapped through probe.pts */
  pts: number[]
  width: number
  height: number
}

/** What the writer needs about a made person file. */
export interface RenderedPerson {
  hash: string
  path: string
  width: number
  height: number
  durationUs: number
  frames: number
}

/** Where one job stands: queued (or not asked for since a cancel), being cut, made, failed until retried, or found empty of people. */
export type CutoutState = "waiting" | "cutting" | "ready" | "failed" | "no-person"

/** A started program as a run uses it: child_process's, which the tests stand in for. */
export interface CutoutChild extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable
}

/** Starts a program with its three streams piped, never through a shell; aborting `signal` kills it. */
export type SpawnProgram = (command: string, args: string[], signal: AbortSignal) => CutoutChild

export interface CutoutRenderDeps {
  /** where the person files land: ~/Movies/CapCut/BOXBLACK/cutouts, which CapCut's sandbox can read */
  cutoutsDir: string
  /** scratch for each run's frame list: tmpdir()/boxblack-cutout */
  workDir: string
  /** the app's boxblack-segment; null when it is missing or does not run */
  helper: () => string | null
  /** the app's own ffmpeg, which encodes what the helper cuts out; null when it is missing */
  ffmpeg: () => string | null
  /** the versions the two programs gave: part of every hash, so a new helper or ffmpeg makes new files */
  helperVersion: () => string
  ffmpegVersion: () => string
  /** how long one job may run before it counts as failed; cutoutTimeoutMs by default */
  timeoutMsFor?: (job: CutoutJob) => number
  /** starts the helper and ffmpeg; child_process.spawn by default */
  spawn?: SpawnProgram
  send: (event: AppEvent) => void
}

/** A made job's meta (`<hash>.json`, written last): the person file's size, length and frames, or that there was no one to cut out. */
type CutoutMeta = { width: number; height: number; durationUs: number; frames: number; coverage: number; noPerson?: false } | { coverage: number; noPerson: true }

/** One sampled mask as it is kept: its size, and its bytes in base64. */
interface StoredMask {
  width: number
  height: number
  mask: string
}

/** A source's head-cover masks (`samples/<key>.json`): the file they were taken from, by which helper at what size, each by its pts. */
interface SampleFile {
  source: CutoutJob["source"]
  helper: string
  size: number
  masks: Record<string, StoredMask>
}

type Settled = { ready: string[]; failed: string[]; noPerson: string[] }

/** A write waiting for its jobs: the ones not settled yet, and how the rest ended. */
interface Waiting {
  folder: string
  pending: Map<string, CutoutJob>
  settled: Settled
  resolve: (settled: Settled) => void
  reject: (error: Error) => void
}

/** A head-cover sample asked for: the source it is of (keyed by that file), which frames, and the project told when it is taken. */
interface SampleAsk {
  key: string
  source: CutoutJob["source"]
  pts: number[]
  folder: string | undefined
  resolve: (masks: Map<number, SampleMask>) => void
  reject: (error: Error) => void
}

/** Below this share of the picture, over the whole run, the helper found no one (spec §7.2 step 3): a first guess, to be set again once real runs are seen. */
const NO_PERSON_BELOW = 0.02
/** the long side of the masks the head-cover warning measures on (spec §10) */
const SAMPLE_SIZE = 256
/** what `hashOf` makes; anything else handed in as a hash never reaches a path */
const HASH = /^[0-9a-f]{16}$/
/** a person file a run was encoding when the app last stopped */
const PARTIAL = /^\.[0-9a-f]{16}\.partial\.mov$/
const STOPPED = "the person cutouts were stopped before they were made; the draft was not changed"

/**
 * How long one job may run (spec §7.3): 30 s, and 6 s for every second of the file at 1080×1920, more
 * or less with the picture's size. A first guess, to be set again once whole runs are timed (§13 step 7).
 */
export function cutoutTimeoutMs(job: CutoutJob): number {
  return Math.ceil(30_000 + 6_000 * (job.pts.length / 30) * ((job.width * job.height) / (1080 * 1920)))
}

/** How long a head-cover sample may run: the helper starts Vision and decodes a few frames. */
const sampleTimeoutMs = (frames: number) => 30_000 + 2_000 * frames

/** child_process.spawn with the three streams piped; the signal kills at once, since a run holds nothing that needs a clean stop. */
const spawnPiped: SpawnProgram = (command, args, signal) => spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], signal, killSignal: "SIGKILL" })

/**
 * ffmpeg's part: the helper's raw 10-bit YUV with alpha, one picture per listed pts, encoded as ProRes
 * 4444 at exactly 30 fps (pts 20·n in timescale 600, which CapCut reads as a file of even frames), tagged
 * BT.709 TV range, as proven with the app's ffmpeg 8.1.2 on 2026-09-29 (without -enc_time_base:v the
 * times are rounded to 1/30 s). ffmpeg says nothing but errors, so its last line says what failed.
 */
function encodeArgs(job: CutoutJob, out: string): string[] {
  return [
    "-hide_banner", "-nostats", "-v", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "yuva444p10le", "-s", `${job.width}x${job.height}`, "-framerate", "30", "-i", "-",
    "-vf", "settb=1/600,setpts=20*N", "-fps_mode", "passthrough", "-enc_time_base:v", "1/600", "-video_track_timescale", "600",
    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "8", "-qscale:v", "12", "-vendor", "apl0",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    out,
  ]
}

/** Why a job failed, as the app shows it: the source is named by its file name, since its path runs through the user's home folder. */
function reasonOf(error: unknown, source: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(source, basename(source))
}

/** How a program ended: its exit code (null when it was killed or could not start) and the last line it said on stderr that was not a report. */
interface Exit {
  code: number | null
  reason: string
}

/** Waits for a program to end, reading its stderr line by line; `report` takes the lines that are reports, not reasons. */
function exited(child: CutoutChild, report: (line: string) => boolean = () => false): Promise<Exit> {
  return new Promise((resolve) => {
    let reason = ""
    let rest = ""
    const text = new StringDecoder("utf8")
    const read = (chunk: string) => {
      const lines = (rest + chunk).split("\n")
      rest = lines.pop() ?? ""
      for (const line of lines.map((one) => one.trim())) if (line && !report(line)) reason = line
    }
    child.stderr.on("data", (chunk: Buffer) => read(text.write(chunk)))
    let ended = false
    const end = (code: number | null, error?: Error) => {
      if (ended) return
      ended = true
      read(`${text.end()}\n`)
      resolve({ code, reason: reason || error?.message || "" })
    }
    // a program that could not start, or was killed through its signal, says so here; "close" may never come
    child.on("error", (error: Error) => end(null, error))
    child.on("close", (code: number | null) => end(code))
  })
}

/**
 * The helper's frames piped into ffmpeg, both started with one signal: `stop` (a cancel or the time
 * limit) kills both, and so does either one failing on its own, which is then the one to blame. Resolves
 * with the share of the picture the person covered, as the helper said last.
 */
async function cutAndEncode(
  start: SpawnProgram,
  helper: { path: string; args: string[] },
  ffmpeg: { path: string; args: string[] },
  stop: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<number> {
  stop.throwIfAborted()
  const halt = new AbortController()
  const signal = AbortSignal.any([stop, halt.signal])
  let coverage = null as number | null
  let first = null as "helper" | "ffmpeg" | null
  const cutter = start(helper.path, helper.args, signal)
  let encoder: CutoutChild
  try {
    encoder = start(ffmpeg.path, ffmpeg.args, signal)
  } catch (error) {
    halt.abort()
    throw error
  }
  // the helper reads nothing, and ffmpeg writes its file, not its stdout
  cutter.stdin.on("error", () => {}).end()
  encoder.stdout.resume()
  // ffmpeg can end before it has read every frame: the pipe then breaks, which its exit tells
  encoder.stdin.on("error", () => {})
  cutter.stdout.pipe(encoder.stdin)
  const report = (line: string): boolean => {
    const moved = /^progress (\d+) (\d+)$/.exec(line)
    if (moved) progress(Number(moved[1]), Number(moved[2]))
    const covered = /^coverage (\S+)$/.exec(line)
    if (covered) coverage = Number(covered[1])
    return moved !== null || covered !== null
  }
  const watch = (who: "helper" | "ffmpeg") => (end: Exit) => {
    if (end.code !== 0) {
      // the first to fail on its own is the one to blame; the other is stopped with it
      if (first === null && !signal.aborted) first = who
      halt.abort()
    }
    return end
  }
  const [cut, encoded] = await Promise.all([exited(cutter, report).then(watch("helper")), exited(encoder).then(watch("ffmpeg"))])
  stop.throwIfAborted()
  const ffmpegFailed = () => new Error(`ffmpeg could not encode the person file: ${encoded.reason || `it stopped with code ${encoded.code}`}`)
  if (first === "ffmpeg") throw ffmpegFailed()
  if (cut.code !== 0) throw new Error(cut.reason || `the person cutter stopped with code ${cut.code}`)
  if (encoded.code !== 0) throw ffmpegFailed()
  if (coverage === null || !(coverage >= 0 && coverage <= 1)) throw new Error("the person cutter did not say how much of the picture the person covers")
  return coverage
}

const isSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

/**
 * Cuts the person out of source videos in the background, one job at a time across every project, and
 * keeps each file by the hash of its job, so the same frames are never cut twice and any change is a new
 * file. The order (spec §7.3): head-cover samples, then the jobs a write waits for, then the project
 * that asked last, then the rest, each in the order asked (clip time). A project's ask replaces its last
 * one: a job no one asks for any more is dropped before it starts; one under way is finished, and its
 * file kept for when it is asked for again. A failure is kept until the user retries; a job found empty
 * of people is kept on disk. Nothing made is deleted here (a CapCut draft may point at the file).
 */
export function createCutoutRenderer(deps: CutoutRenderDeps) {
  const start = deps.spawn ?? spawnPiped
  const failures = new Map<string, string>()
  /** the head-cover samples that failed, by source key and pts: asked for again, they are answered without them until a retry */
  const sampleFailures = new Map<string, string>()
  /** what each project asked for last (`ensure`): its jobs not settled yet, by hash in the order asked; the project that asked last is last */
  const wanted = new Map<string, Map<string, CutoutJob>>()
  /** the writes waiting, in the order they came */
  const waits = new Set<Waiting>()
  /** the head-cover samples asked for and not taken yet, in the order they came */
  const samples: SampleAsk[] = []
  /** the one job being cut, which `cancel()` stops, how far it has got, and the projects to tell */
  let current: { hash: string; controller: AbortController; done: number; total: number; folders: Set<string> } | null = null
  /** the one sample being taken, which `cancel()` stops */
  let sampling: AbortController | null = null
  /** moved on by `cancel()`: a job asked for before then does not start */
  let generation = 0
  /** the asks being sorted */
  let asking = 0
  /** whether the queue is being worked through */
  let pumping = false
  /** each ask's sorting, in the order the asks came; the first waits for what the app's last run left behind to go */
  let sorting: Promise<unknown> = sweep()

  const files = (hash: string) => ({
    mov: join(deps.cutoutsDir, `${hash}.mov`),
    json: join(deps.cutoutsDir, `${hash}.json`),
    partial: join(deps.cutoutsDir, `.${hash}.partial.mov`),
  })
  const samplesFile = (key: string) => join(deps.cutoutsDir, "samples", `${key}.json`)

  /**
   * What a run was making when the app last quit or crashed: its frame lists and its half-encoded
   * files. They are this renderer's own, and runs happen only in this process, so they go.
   */
  async function sweep(): Promise<void> {
    await rm(deps.workDir, { recursive: true, force: true }).catch(() => {})
    const names = await readdir(deps.cutoutsDir).catch(() => [] as string[])
    for (const name of names) if (PARTIAL.test(name)) await rm(join(deps.cutoutsDir, name), { force: true }).catch(() => {})
  }

  /** An event the app cannot take is its loss: never a job's failure, nor a stop to the queue. */
  function tell(folders: Iterable<string>, event: Omit<Extract<AppEvent, { type: "cutout" }>, "type" | "folder">): void {
    for (const folder of folders) {
      try {
        deps.send({ type: "cutout", folder, ...event })
      } catch {
        // nothing to be done about it here
      }
    }
  }

  function hashOf(job: CutoutJob): string {
    // everything the file is made from: which file (its path, size and change time), which of its frames in
    // what order, at what size, by which frame rule, helper and ffmpeg. Two ranges that ask for the same
    // frames share one file; anything that changes what it shows makes another
    const inputs = [job.source.path, job.source.size, job.source.mtimeMs, job.timescale, job.pts, job.width, job.height, CUTOUT_PIPELINE_VERSION, deps.helperVersion(), deps.ffmpegVersion()]
    return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16)
  }

  /** A source's samples are kept by the file they were taken from. */
  const sampleKeyOf = (source: CutoutJob["source"]) => createHash("sha256").update(JSON.stringify([source.path, source.size, source.mtimeMs])).digest("hex").slice(0, 16)

  /** A made job's meta: its .json reads and, unless it says there was no one, its .mov is there. Null for anything less, which is cut again. */
  async function made(hash: string): Promise<CutoutMeta | null> {
    try {
      const meta = JSON.parse(await readFile(files(hash).json, "utf8")) as CutoutMeta
      if (meta.noPerson === true) return meta
      await stat(files(hash).mov)
      return meta
    } catch {
      return null
    }
  }

  /** The jobs asked for, the same frames once: those settled already (made, empty, failed), and the rest by hash, in the order asked. */
  async function sortJobs(jobs: CutoutJob[]): Promise<{ settled: Settled; todo: Map<string, CutoutJob> }> {
    const settled: Settled = { ready: [], failed: [], noPerson: [] }
    const todo = new Map<string, CutoutJob>()
    for (const [hash, job] of new Map(jobs.map((job) => [hashOf(job), job]))) {
      const meta = await made(hash)
      if (meta) (meta.noPerson ? settled.noPerson : settled.ready).push(hash)
      else if (failures.has(hash)) settled.failed.push(hash)
      else todo.set(hash, job)
    }
    return { settled, todo }
  }

  /** Sorts an ask once every ask before it is sorted, so asks take effect in the order they came. */
  function sortAsk<T>(sort: () => Promise<T>): Promise<T> {
    asking++
    const sorted = sorting.then(sort)
    sorting = sorted.catch(() => {})
    return sorted.finally(() => asking--)
  }

  /** The projects that want a job now, to be told how it goes. */
  function foldersOf(hash: string): Set<string> {
    const folders = new Set<string>()
    for (const [folder, jobs] of wanted) if (jobs.has(hash)) folders.add(folder)
    for (const waiting of waits) if (waiting.pending.has(hash)) folders.add(waiting.folder)
    return folders
  }

  /** A job has come to an end, made, empty or failed: no project waits for it any more, and every write waiting on it hears how. */
  function settle(hash: string, outcome: keyof Settled): void {
    for (const [folder, jobs] of wanted) if (jobs.delete(hash) && jobs.size === 0) wanted.delete(folder)
    for (const waiting of waits) {
      if (!waiting.pending.delete(hash)) continue
      waiting.settled[outcome].push(hash)
      if (waiting.pending.size > 0) continue
      waits.delete(waiting)
      waiting.resolve(waiting.settled)
    }
  }

  /** The job to cut next: what a write waits for, oldest write first, then the project that asked last, then the others. */
  function nextJob(): [string, CutoutJob] | null {
    for (const waiting of waits) {
      const first = waiting.pending.entries().next()
      if (!first.done) return first.value
    }
    for (const jobs of [...wanted.values()].reverse()) {
      const first = jobs.entries().next()
      if (!first.done) return first.value
    }
    return null
  }

  /** Works through what is asked for, one run at a time, samples first; a call while it does so does nothing more. */
  function kick(): void {
    if (pumping) return
    pumping = true
    void (async () => {
      try {
        for (;;) {
          const ask = samples.shift()
          if (ask) {
            await takeSamples(ask)
            continue
          }
          const next = nextJob()
          if (!next) break
          await cutJob(...next)
        }
      } finally {
        pumping = false
      }
    })().catch(() => {})
  }

  /** Makes one person file, or finds there is no one to make it of; throws why it could not. */
  async function cut(job: CutoutJob, hash: string, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<"ready" | "noPerson"> {
    const helper = deps.helper()
    if (!helper) throw new Error("the app's person cutter is missing")
    const ffmpeg = deps.ffmpeg()
    if (!ffmpeg) throw new Error("the app's ffmpeg is missing")
    if (job.pts.length === 0) throw new Error("a person file needs at least one frame")
    // the frames were counted on the file as it was read: one changed since would be cut wrong, under the old one's name
    const found = await stat(job.source.path).catch(() => null)
    if (!found || found.size !== job.source.size || found.mtimeMs !== job.source.mtimeMs) throw new Error(`${job.source.path} changed or went away after it was read`)
    const out = files(hash)
    const work = join(deps.workDir, hash)
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true })
    await mkdir(deps.cutoutsDir, { recursive: true })
    try {
      const list = join(work, "pts.json")
      await writeFile(list, JSON.stringify({ pts: job.pts }))
      const coverage = await cutAndEncode(
        start,
        { path: helper, args: ["render", job.source.path, "--pts", list, "--width", String(job.width), "--height", String(job.height)] },
        { path: ffmpeg, args: encodeArgs(job, out.partial) },
        signal,
        progress,
      )
      if (coverage < NO_PERSON_BELOW) {
        // no one to put over the text: no file is kept, and the .json says so, so the job is not cut again
        await rm(out.partial, { force: true })
        await writeFileAtomic(out.json, JSON.stringify({ coverage, noPerson: true } satisfies CutoutMeta))
        return "noPerson"
      }
      await rename(out.partial, out.mov)
      const meta: CutoutMeta = { width: job.width, height: job.height, durationUs: Math.floor((job.pts.length * 1_000_000) / 30), frames: job.pts.length, coverage }
      // written last and whole: once it reads, the file is made
      await writeFileAtomic(out.json, JSON.stringify(meta))
      return "ready"
    } finally {
      // a run that did not finish leaves no half-encoded file; its frame list goes either way
      await rm(out.partial, { force: true })
      await rm(work, { recursive: true, force: true })
    }
  }

  /** Cuts one job, unless it was made or failed meanwhile, and settles it; one stopped by `cancel()` is left unsettled, and not failed. */
  async function cutJob(hash: string, job: CutoutJob): Promise<void> {
    const asked = generation
    if (failures.has(hash)) return settle(hash, "failed")
    const meta = await made(hash)
    // made meanwhile, by an ask for the same frames that came first
    if (meta) return settle(hash, meta.noPerson ? "noPerson" : "ready")
    // cancelled while it was looked for, or dropped by the one project that wanted it: not cut, and not a failure
    const folders = foldersOf(hash)
    if (asked !== generation || folders.size === 0) return
    const controller = new AbortController()
    const run = { hash, controller, done: 0, total: job.pts.length, folders }
    current = run
    // the look at the preview this brings about reads it as cutting
    tell(run.folders, { hash, state: "started" })
    const limitMs = (deps.timeoutMsFor ?? cutoutTimeoutMs)(job)
    const timeout = AbortSignal.timeout(limitMs)
    let percent = -1
    try {
      const outcome = await cut(job, hash, AbortSignal.any([controller.signal, timeout]), (done, total) => {
        run.done = done
        run.total = total
        // told as the whole percent moves on: the helper reports every frame
        const now = Math.floor((done * 100) / Math.max(total, 1))
        if (now === percent) return
        percent = now
        tell(run.folders, { hash, state: "progress", done, total })
      })
      settle(hash, outcome)
      tell(run.folders, { hash, state: "done" })
    } catch (error) {
      // stopped by cancel(): nothing wrong with the job, so it is cut again when next asked
      if (controller.signal.aborted) return
      const message = timeout.aborted ? `the person cutout timed out after ${Math.round(limitMs / 1000)} s` : reasonOf(error, job.source.path)
      failures.set(hash, message)
      settle(hash, "failed")
      tell(run.folders, { hash, state: "failed", error: message })
    } finally {
      current = null
    }
  }

  /** A source's samples file, or null when there is none that reads. */
  async function readSamples(key: string): Promise<SampleFile | null> {
    try {
      return JSON.parse(await readFile(samplesFile(key), "utf8")) as SampleFile
    } catch {
      return null
    }
  }

  const decoded = (stored: StoredMask): SampleMask => ({ width: stored.width, height: stored.height, data: new Uint8Array(Buffer.from(stored.mask, "base64")) })

  /** Whether a samples file was taken by the helper the app has now, at the size asked for: another helper's masks may differ. */
  const byThisHelper = (kept: SampleFile | null): kept is SampleFile => kept !== null && kept.helper === deps.helperVersion() && kept.size === SAMPLE_SIZE

  /** The masks a samples file holds for these frames. */
  function masksOf(kept: SampleFile | null, pts: number[]): Map<number, SampleMask> {
    const found = new Map<number, SampleMask>()
    if (!byThisHelper(kept)) return found
    for (const at of pts) {
      const stored = kept.masks?.[String(at)]
      if (stored && typeof stored.mask === "string" && isSize(stored.width) && isSize(stored.height)) found.set(at, decoded(stored))
    }
    return found
  }

  /** Runs one program to its end, with what it wrote to stdout; aborting `signal` kills it. */
  async function runOne(command: string, args: string[], signal: AbortSignal): Promise<Exit & { stdout: string }> {
    signal.throwIfAborted()
    const child = start(command, args, signal)
    child.stdin.on("error", () => {}).end()
    let stdout = ""
    const text = new StringDecoder("utf8")
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += text.write(chunk)
    })
    const end = await exited(child)
    signal.throwIfAborted()
    return { ...end, stdout: stdout + text.end() }
  }

  /** The helper's masks of these frames of a source, each checked: `width` × `height` bytes, in base64. */
  async function sampleFrames(source: CutoutJob["source"], key: string, pts: number[], signal: AbortSignal): Promise<Map<number, StoredMask>> {
    const helper = deps.helper()
    if (!helper) throw new Error("the app's person cutter is missing")
    const work = join(deps.workDir, `sample-${key}`)
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true })
    try {
      const list = join(work, "pts.json")
      await writeFile(list, JSON.stringify({ pts }))
      const end = await runOne(helper, ["sample", source.path, "--pts", list, "--size", String(SAMPLE_SIZE)], signal)
      if (end.code !== 0) throw new Error(end.reason || `the person cutter stopped with code ${end.code}`)
      const taken = new Map<number, StoredMask>()
      for (const line of end.stdout.split("\n")) {
        if (!line.trim()) continue
        let one: { pts?: unknown; width?: unknown; height?: unknown; mask?: unknown }
        try {
          one = JSON.parse(line) as typeof one
        } catch {
          throw new Error("the person cutter's samples could not be read")
        }
        const { pts: at, width, height, mask } = one
        if (typeof at !== "number" || !pts.includes(at) || !isSize(width) || !isSize(height) || typeof mask !== "string" || Buffer.from(mask, "base64").length !== width * height) {
          throw new Error("the person cutter's samples could not be read")
        }
        taken.set(at, { width, height, mask })
      }
      if (taken.size !== pts.length) throw new Error(`the person cutter sampled ${taken.size} of ${pts.length} frames`)
      return taken
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  /** Takes the masks one ask still lacks, keeps them with the source's others, and answers it with every mask it asked for that there is. */
  async function takeSamples(ask: SampleAsk): Promise<void> {
    const controller = new AbortController()
    sampling = controller
    try {
      // read again: an ask before this one may have taken some of them
      const kept = await readSamples(ask.key)
      const found = masksOf(kept, ask.pts)
      const missing = ask.pts.filter((at) => !found.has(at) && !sampleFailures.has(`${ask.key} ${at}`))
      if (missing.length > 0) {
        try {
          const taken = await sampleFrames(ask.source, ask.key, missing, AbortSignal.any([controller.signal, AbortSignal.timeout(sampleTimeoutMs(missing.length))]))
          const masks = { ...(byThisHelper(kept) ? kept.masks : {}), ...Object.fromEntries([...taken].map(([at, mask]) => [String(at), mask])) }
          await writeFileAtomic(samplesFile(ask.key), JSON.stringify({ source: ask.source, helper: deps.helperVersion(), size: SAMPLE_SIZE, masks } satisfies SampleFile))
          for (const [at, mask] of taken) found.set(at, decoded(mask))
          if (ask.folder !== undefined) tell([ask.folder], { hash: ask.key, state: "done" })
        } catch (error) {
          if (controller.signal.aborted) throw new Error(STOPPED)
          // not tried again until a retry: the app asks on every look at a preview, and each failure is told
          const message = reasonOf(error, ask.source.path)
          for (const at of missing) sampleFailures.set(`${ask.key} ${at}`, message)
          if (ask.folder !== undefined) tell([ask.folder], { hash: ask.key, state: "failed", error: message })
        }
      }
      ask.resolve(found)
    } catch (error) {
      ask.reject(error instanceof Error ? error : new Error(String(error)))
    } finally {
      sampling = null
    }
  }

  return {
    hashOf,
    /**
     * Replaces what `folder` asks to have cut with `jobs` and returns at once: jobs not made yet are cut
     * in the background, reporting each as it starts, moves on and ends, to every project that wants it;
     * jobs this project asked for before and no one asks for now are dropped unstarted. Jobs made, found
     * empty or failed are not queued, and an ask that queues nothing says nothing: the app asks on every
     * look at a preview.
     */
    ensure(folder: string, jobs: CutoutJob[]): void {
      const asked = generation
      sortAsk(async () => {
        const { todo } = await sortJobs(jobs)
        if (asked !== generation) return
        wanted.delete(folder)
        if (todo.size > 0) wanted.set(folder, todo)
        if (current && todo.has(current.hash)) current.folders.add(folder)
        kick()
      }).catch(() => {})
    },
    /**
     * Cuts these jobs before anything but samples, and settles when every one is made, found empty or
     * failed; throws when `cancel()` stopped them first (the app is quitting), since a draft written then
     * would leave out people that were only stopped.
     */
    wait(folder: string, jobs: CutoutJob[]): Promise<Settled> {
      const asked = generation
      return sortAsk(async () => {
        const { settled, todo } = await sortJobs(jobs)
        if (asked !== generation) throw new Error(STOPPED)
        if (todo.size === 0) return { done: Promise.resolve(settled) }
        const done = new Promise<Settled>((resolve, reject) => waits.add({ folder, pending: todo, settled, resolve, reject }))
        if (current && todo.has(current.hash)) current.folders.add(folder)
        kick()
        return { done }
      }).then(({ done }) => done)
    },
    /** Made, found empty, failed (with why), being cut now (with how far), or waiting: queued, or not asked for since a cancel. */
    async statusOf(hash: string): Promise<{ state: CutoutState; done?: number; total?: number; error?: string }> {
      if (!HASH.test(hash)) return { state: "waiting" }
      const meta = await made(hash)
      if (meta) return { state: meta.noPerson ? "no-person" : "ready" }
      const failure = failures.get(hash)
      if (failure !== undefined) return { state: "failed", error: failure }
      if (current?.hash === hash) return { state: "cutting", done: current.done, total: current.total }
      return { state: "waiting" }
    },
    /** The person file for a job, or null when it is not made, or there was no one to cut out. */
    async rendered(job: CutoutJob): Promise<RenderedPerson | null> {
      const hash = hashOf(job)
      const meta = await made(hash)
      if (!meta || meta.noPerson) return null
      return { hash, path: files(hash).mov, width: meta.width, height: meta.height, durationUs: meta.durationUs, frames: meta.frames }
    },
    /** Forgets a job's failure, so it is cut again when next asked; a head-cover sample that failed is tried again too. */
    retry(hash: string): void {
      if (!HASH.test(hash)) return
      failures.delete(hash)
      sampleFailures.clear()
    },
    /** Nothing asked for is being sorted, queued, cut or sampled: no file is in the making, or about to be. */
    idle: (): boolean => asking === 0 && !pumping && waits.size === 0 && samples.length === 0 && [...wanted.values()].every((jobs) => jobs.size === 0),
    /**
     * Stops the run under way and drops everything queued (the app is quitting): a write waiting is told
     * so, and nothing counts as failed. If the quit is called off, what is asked for after this is cut as
     * usual, once the stopped run has ended.
     */
    cancel(): void {
      generation++
      current?.controller.abort()
      sampling?.abort()
      wanted.clear()
      for (const waiting of waits) waiting.reject(new Error(STOPPED))
      waits.clear()
      for (const ask of samples.splice(0)) ask.reject(new Error(STOPPED))
    },
    /**
     * The masks of these source frames at 256 px on the long side, for the head-cover warning (spec §10):
     * kept by source in <cutoutsDir>/samples, so they are taken once; those not kept yet are taken ahead of
     * any cutout. A frame the helper could not sample is left out of the answer. `folder`, when given, is
     * told when a sample was taken or failed (under the sample's own key), so its page can look again.
     */
    sample(job: { source: CutoutJob["source"]; pts: number[] }, folder?: string): Promise<Map<number, SampleMask>> {
      const asked = generation
      return sortAsk(async () => {
        const key = sampleKeyOf(job.source)
        const pts = [...new Set(job.pts)]
        const found = masksOf(await readSamples(key), pts)
        // what is kept, or failed before, is answered at once: the app asks on every look at a preview
        if (pts.every((at) => found.has(at) || sampleFailures.has(`${key} ${at}`))) return { done: Promise.resolve(found) }
        if (asked !== generation) throw new Error(STOPPED)
        const done = new Promise<Map<number, SampleMask>>((resolve, reject) => samples.push({ key, source: job.source, pts, folder, resolve, reject }))
        kick()
        return { done }
      }).then(({ done }) => done)
    },
  }
}

export type CutoutRenderer = ReturnType<typeof createCutoutRenderer>
```

- [ ] **Step 4: Run them and see them pass.**

  Run: `npx vitest run apps/desktop/src/main/cutout-render.test.ts`

  Expected: PASS (28 tests).
  - Two of them run real `/bin/sh` stand-ins through the default `child_process.spawn`: one checks the pipe, the other the kill on cancel.
  - The rest use the in-process fake spawn.

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 11: Files, cleanup and wiring

**Files:**
- Modify: `apps/desktop/src/main/graphics-files.ts` (the name patterns at the top, `graphicFilesInfo`'s doc, `cleanGraphicFiles` to the end of the file)
- Modify: `apps/desktop/src/main/settings-api.ts` (the deps and `getSettings`)
- Modify: `apps/desktop/src/shared/api.ts` (`SettingsView` ~:342, the `cleanGraphicFiles` doc ~:146)
- Modify: `apps/desktop/src/renderer/test/fake-api.ts` (`settingsView()` ~:78)
- Modify: `apps/desktop/src/main/timeline.ts` (`TimelineDeps` ~:88-95, imports)
- Modify: `apps/desktop/src/main/highlights.ts` (`HighlightDeps` ~:64-69, imports)
- Modify: `apps/desktop/src/main/index.ts` (imports, the cutout block after `graphicsReady` ~:260, `graphicFiles`, the three services, `before-quit`)
- Test: `apps/desktop/src/main/graphics-files.test.ts`, `apps/desktop/src/main/settings-api.test.ts`

**What changes:**
- `cutoutsDir` is `~/Movies/CapCut/BOXBLACK/cutouts`.
- `cleanGraphicFiles` keeps its name and its result type. It gains `cutoutsDir?`, which it cleans by the same rules as the graphics:
  - "In use" still means that some draft names the file: every draft, the recycle bin, and the backups. The drafts are read once, for both folders.
  - A job's files are its `<hash>.mov` and `<hash>.json`, or the `.json` alone of a job that found no one. They go meta first.
  - Files younger than 10 minutes are left.
  - `busy` is asked again before each file.
- The `samples/` files go when the source they were taken from is gone: nothing is at its path, or what is there has another size or change time. They are not counted in `trashed`, because they are no file the user sees.
- `SettingsView.cutoutFiles` reuses `graphicFilesInfo`. It counts `<hash>.mov` files only.
- `index.ts`:
  - resolves both programs from `join(resourcesDir, "bin")`, in development too;
  - asks each for its version once, with `shippedProgram`;
  - creates the renderer and the probes;
  - hands them to the preview and write services;
  - adds `!cutoutRenderer.idle()` to the clean's `busy`;
  - cancels the renderer on quit.
- The two services only declare the new deps here. Part D uses them.

**Dep keys added** (the only names Parts D and E need from this task):

| Where | Key | Type |
|---|---|---|
| `TimelineDeps`, `HighlightDeps` | `cutouts?` | `CutoutRenderer` |
| `TimelineDeps`, `HighlightDeps` | `probes?` | `SourceProbes` |
| `TimelineDeps`, `HighlightDeps` | `cutoutsReady?` | `() => Promise<boolean>` |
| `TimelineDeps` | `cutoutsDir?` | `string` |
| `createSettingsApi` deps | `cutoutFiles?` | `{ info() }` |
| `cleanGraphicFiles` deps | `cutoutsDir?` | `string` |

- `cutoutsReady()` is true when the helper answered its version. It settles only after both versions are read, so await it before any `cutouts.hashOf`.

- [ ] **Step 1: Write the failing tests.**

  At the end of `apps/desktop/src/main/graphics-files.test.ts`, add the following (the file's imports already cover it):

```ts
/* the person cutouts, cleaned with the graphics */

/** A cutouts folder beside the graphics one, holding each job's .mov (unless `mov` is false: a job that found no one) and .json, made long ago. */
async function cutouts(graphicsDir: string, jobs: { hash: string; mov?: boolean }[]) {
  const dir = join(graphicsDir, "..", "cutouts")
  await mkdir(dir, { recursive: true })
  for (const { hash, mov = true } of jobs) {
    if (mov) await writeFile(join(dir, `${hash}.mov`), "x".repeat(700))
    await writeFile(join(dir, `${hash}.json`), mov ? "{}" : JSON.stringify({ coverage: 0, noPerson: true }))
    for (const name of mov ? [`${hash}.mov`, `${hash}.json`] : [`${hash}.json`]) await utimes(join(dir, name), LONG_AGO, LONG_AGO)
  }
  return dir
}

const PERSON = "77777777777777aa"
const EMPTY = "88888888888888bb"
const WORN = "99999999999999cc"

test("counts the person files and their size: their metas, the file being encoded and the samples are not counted", async () => {
  const { dir } = await setup([])
  const people = await cutouts(dir, [{ hash: PERSON }, { hash: WORN }, { hash: EMPTY, mov: false }])
  await writeFile(join(people, `.${PERSON}.partial.mov`), "x".repeat(300))
  await mkdir(join(people, "samples"))
  await writeFile(join(people, "samples", `${PERSON}.json`), "{}")
  expect(await graphicFilesInfo(people)).toEqual({ count: 2, bytes: 1400 })
})

test("a person file no draft uses goes to the Trash, its meta first; so does the meta alone of a job that found no one; one a draft uses stays", async () => {
  const { dir, drafts, trashed, clean } = await setup([GONE])
  const people = await cutouts(dir, [{ hash: PERSON }, { hash: EMPTY, mov: false }, { hash: WORN }])
  // not the renderer's to trash: a file being encoded, and anything else
  await writeFile(join(people, `.${PERSON}.partial.mov`), "half")
  await writeFile(join(people, "notes.json"), "{}")
  await draft(drafts, "0917", using(join(people, `${WORN}.mov`)))
  expect(await clean({ cutoutsDir: people })).toEqual({ trashed: 3, blockedBy: null, kept: null })
  expect([...trashed].sort()).toEqual([
    join(dir, `${GONE}.json`), join(dir, `${GONE}.mov`), join(dir, `${GONE}.png`),
    join(people, `${PERSON}.json`), join(people, `${PERSON}.mov`),
    join(people, `${EMPTY}.json`),
  ].sort())
  expect(trashed.indexOf(join(people, `${PERSON}.json`))).toBeLessThan(trashed.indexOf(join(people, `${PERSON}.mov`)))
})

test("a person file made in the last ten minutes stays, its meta's age telling for a job that kept no file; a clean that finds the app busy stops", async () => {
  const { dir, drafts, trashed, clean } = await setup([GONE])
  const people = await cutouts(dir, [{ hash: PERSON }, { hash: EMPTY, mov: false }])
  const recent = new Date(NOW - 9 * 60_000)
  await utimes(join(people, `${PERSON}.mov`), recent, recent)
  await utimes(join(people, `${EMPTY}.json`), recent, recent)
  await draft(drafts, "0917", using())
  // the graphic goes; the two recent jobs stay
  expect(await clean({ cutoutsDir: people })).toEqual({ trashed: 1, blockedBy: null, kept: "recent" })
  expect(trashed.filter((path) => path.startsWith(people))).toEqual([])
  trashed.length = 0
  expect(await clean({ cutoutsDir: people, now: () => NOW + 60_000 })).toEqual({ trashed: 3, blockedBy: null, kept: null })
  // a cutout that starts while the graphics go stops the clean before the person files
  const again = await setup([GONE])
  const more = await cutouts(again.dir, [{ hash: PERSON }])
  await draft(again.drafts, "0917", using())
  let movs = 0
  const counting = async (path: string) => {
    if (path.endsWith(".mov")) movs++
    again.trashed.push(path)
  }
  expect(await again.clean({ cutoutsDir: more, trash: counting, busy: () => movs > 0 })).toEqual({ trashed: 1, blockedBy: null, kept: "stopped" })
  expect(again.trashed.filter((path) => path.startsWith(more))).toEqual([])
})

test("with no graphics folder yet, the person files are still cleaned", async () => {
  const { dir, drafts, clean } = await setup([])
  const people = await cutouts(dir, [{ hash: PERSON }])
  await draft(drafts, "0917", using())
  expect(await clean({ dir: join(drafts, "no-graphics-yet"), cutoutsDir: people })).toEqual({ trashed: 1, blockedBy: null, kept: null })
})

test("the head-cover samples of a source that is gone or changed go to the Trash, uncounted; those of a source still there, recent ones and unreadable ones stay", async () => {
  const { dir, drafts, trashed, clean } = await setup([])
  const people = await cutouts(dir, [])
  const videos = join(dir, "..", "videos")
  await mkdir(videos)
  const there = join(videos, "IMG_9646.MOV")
  await writeFile(there, "video")
  const found = await stat(there)
  const samples = join(people, "samples")
  await mkdir(samples)
  const kept = async (name: string, content: string, when = LONG_AGO) => {
    await writeFile(join(samples, name), content)
    await utimes(join(samples, name), when, when)
  }
  const of = (source: unknown) => JSON.stringify({ source, helper: "1", size: 256, masks: {} })
  await kept("aaaaaaaaaaaaaaaa.json", of({ path: there, size: found.size, mtimeMs: found.mtimeMs }))
  await kept("bbbbbbbbbbbbbbbb.json", of({ path: join(videos, "deleted.MOV"), size: 5, mtimeMs: 1 }))
  await kept("cccccccccccccccc.json", of({ path: there, size: found.size + 1, mtimeMs: found.mtimeMs }))
  await kept("dddddddddddddddd.json", of({ path: join(videos, "deleted.MOV"), size: 5, mtimeMs: 1 }), new Date(NOW - 60_000))
  await kept("eeeeeeeeeeeeeeee.json", "not json")
  await kept("notes.json", of({ path: join(videos, "deleted.MOV"), size: 5, mtimeMs: 1 }))
  await draft(drafts, "0917", using())
  expect(await clean({ cutoutsDir: people })).toEqual({ trashed: 0, blockedBy: null, kept: null })
  expect([...trashed].sort()).toEqual([join(samples, "bbbbbbbbbbbbbbbb.json"), join(samples, "cccccccccccccccc.json")])
})
```

  In `apps/desktop/src/main/settings-api.test.ts`:
  - `setup`'s `extra` parameter gains `cutoutFiles`, after `graphicFiles`:

```ts
  graphicFiles?: { info(): Promise<{ count: number; bytes: number }>; clean(): Promise<GraphicCleanResult> }
  cutoutFiles?: { info(): Promise<{ count: number; bytes: number }> }
  graphicsProblem?: () => GraphicsProblem | null
```

  - `setup` passes it on, after the `graphicFiles` line:

```ts
    ...(extra.graphicFiles ? { graphicFiles: extra.graphicFiles } : {}),
    ...(extra.cutoutFiles ? { cutoutFiles: extra.cutoutFiles } : {}),
```

  - The whole-object expectation in "getSettings gathers choices, …" gains `cutoutFiles: { count: 0, bytes: 0 },` right after `graphicFiles: { count: 0, bytes: 0 },`.
  - Add at the end of the file:

```ts
test("getSettings counts the person files beside the graphics, from their own fake", async () => {
  const graphicFiles = { info: async () => ({ count: 4, bytes: 12_000 }), clean: async () => ({ trashed: 0, blockedBy: null, kept: null }) }
  const { api } = await setup({ graphicFiles, cutoutFiles: { info: async () => ({ count: 2, bytes: 21_000_000 }) } })
  const view = await api.getSettings()
  expect(view.graphicFiles).toEqual({ count: 4, bytes: 12_000 })
  expect(view.cutoutFiles).toEqual({ count: 2, bytes: 21_000_000 })
})
```

- [ ] **Step 2: Run them and see them fail.**

  Run: `npx vitest run apps/desktop/src/main/graphics-files.test.ts apps/desktop/src/main/settings-api.test.ts`

  Expected: 6 tests FAIL:
  - the four new cleanup tests after the counting one: `cutoutsDir` is not read yet;
  - "getSettings gathers choices, …" and "getSettings counts the person files…": `cutoutFiles` is not in the view.

  "counts the person files and their size…" already passes, because `graphicFilesInfo` counts `<hash>.mov` only. It pins that rule.

- [ ] **Step 3: Implement.**

  **`graphics-files.ts`.** Replace the two name patterns at the top (`GRAPHIC_FILE`, `GRAPHIC_NAMED` and their docs) with:

```ts
/** The name the renderers give every file they make: its hash. Nothing else in their folders is ours to trash. */
const GRAPHIC_FILE = /^[0-9a-f]{16}\.mov$/
/** A person cutout's files: its .mov and its .json, or the .json alone of a job that found no one. The file being encoded (.<hash>.partial.mov) is not one. */
const CUTOUT_FILE = /^([0-9a-f]{16})\.(mov|json)$/
/** A source's head-cover masks, named by the file they were taken from (cutouts/samples/). */
const SAMPLES_FILE = /^[0-9a-f]{16}\.json$/
/** The same name anywhere in a draft's JSON, a graphic's or a person file's: a path, a material's name, a nested draft's own materials. */
const GRAPHIC_NAMED = /[0-9a-f]{16}\.mov/gi
```

  `graphicFilesInfo` keeps its body. Its doc becomes:

```ts
/** How much a folder of rendered files holds, the graphics or the person cutouts: the rendered .mov files only, the files a clean could take away. */
```

  Replace everything from the doc comment above `export async function cleanGraphicFiles` to the end of the file with:

```ts
/**
 * Whether the source a samples file was taken from is gone: nothing is at its path, or what is there
 * has another size or change time. A file that does not read says nothing, and stays.
 */
async function sourceGone(samples: string): Promise<boolean> {
  let source: { path: string; size: number; mtimeMs: number }
  try {
    source = (JSON.parse(await readFile(samples, "utf8")) as { source: typeof source }).source
    if (typeof source.path !== "string") return false
  } catch {
    return false
  }
  try {
    const found = await stat(source.path)
    return found.size !== source.size || found.mtimeMs !== source.mtimeMs
  } catch {
    return true
  }
}

/**
 * Moves to the Trash the rendered files no draft refers to any more, the graphics with their poster
 * and meta and the person cutouts with their meta (or the meta alone of a job that found no one): the
 * drafts under CapCut's root (those in its recycle bin too, which it can restore) and the ones
 * BOXBLACK backed up before writing to them (which it can put back). A draft that cannot be read
 * counts as referring to everything: nothing is trashed then, since a file it points at would
 * otherwise be lost, and `blockedBy` says which. Nothing goes while a render, a cutout or a write is
 * under way, since what they are making or about to write is in no draft yet, and a file made in the
 * last few minutes is left for the same reason; `kept` says when unused files were left. The
 * head-cover samples of a source that is gone go too, uncounted: they are no file the user sees.
 */
export async function cleanGraphicFiles(deps: {
  dir: string
  /** where the person cutouts are (~/Movies/CapCut/BOXBLACK/cutouts), cleaned by the same rules; none when not given */
  cutoutsDir?: string
  draftsRoot: string | null
  /** BOXBLACK's draft backups (<userData>/backups); not there until it first writes a draft */
  backupRoot: string
  trash: (path: string) => Promise<void>
  /** true while graphics render, people are cut out or a draft is written, or once a write started after the clean did; asked before anything goes */
  busy: () => boolean
  /** the clock a file's age is told by; Date.now by default */
  now?: () => number
}): Promise<GraphicCleanResult> {
  if (!deps.draftsRoot) return { trashed: 0, blockedBy: { kind: "no-drafts-root" }, kept: null }
  if (deps.busy()) return { trashed: 0, blockedBy: { kind: "busy" }, kept: null }
  const referenced = new Set<string>()
  const roots: { where: "capcut" | "backup"; root: string }[] = [{ where: "capcut", root: deps.draftsRoot }]
  if (await exists(deps.backupRoot)) roots.push({ where: "backup", root: deps.backupRoot })
  for (const { where, root } of roots) {
    const unreadable = await collect(root, DRAFT_DEPTH, referenced)
    if (unreadable) return { trashed: 0, blockedBy: { kind: "unreadable", where, name: nameOf(where, root, unreadable) }, kept: null }
  }
  /** trashed, or not there any more */
  const gone = (path: string) => deps.trash(path).then(() => true, async () => !(await exists(path)))
  const now = (deps.now ?? Date.now)()
  let trashed = 0
  let recent = false
  // asked again before each file: a write that started meanwhile may be about to use this one, and the
  // drafts were read before it wrote. A file that went before it started is one it finds not made, and makes again
  const stopped = (): GraphicCleanResult | null =>
    deps.busy() ? (trashed === 0 ? { trashed, blockedBy: { kind: "busy" }, kept: null } : { trashed, blockedBy: null, kept: "stopped" }) : null

  // no folder yet is nothing to clean in it
  for (const name of await readdir(deps.dir).catch(() => [] as string[])) {
    if (!GRAPHIC_FILE.test(name) || referenced.has(name)) continue
    const hash = name.slice(0, -4)
    // with no meta yet a render may still be making it; one that is not settled either way stays
    if (!(await settled(join(deps.dir, name), now))) {
      recent = true
      continue
    }
    const busy = stopped()
    if (busy) return busy
    // the meta first: while it is there the file reads as ready, so the file stays as long as it does. A file
    // whose render failed before its meta was written has none to go
    if (!(await gone(join(deps.dir, `${hash}.json`)))) continue
    if (!(await gone(join(deps.dir, name)))) continue
    await gone(join(deps.dir, `${hash}.png`))
    trashed++
  }

  if (deps.cutoutsDir) {
    const dir = deps.cutoutsDir
    const names = new Set(await readdir(dir).catch(() => [] as string[]))
    // each job once, by its hash: its .mov and .json, or the .json alone of a job that found no one
    for (const hash of new Set([...names].flatMap((name) => CUTOUT_FILE.exec(name)?.[1] ?? []))) {
      if (referenced.has(`${hash}.mov`)) continue
      const mov = names.has(`${hash}.mov`)
      // a job's age is its file's, or its meta's when it kept none
      if (!(await settled(join(dir, mov ? `${hash}.mov` : `${hash}.json`), now))) {
        recent = true
        continue
      }
      const busy = stopped()
      if (busy) return busy
      // the meta first, as for a graphic: while it is there the job reads as made
      if (names.has(`${hash}.json`) && !(await gone(join(dir, `${hash}.json`)))) continue
      if (mov && !(await gone(join(dir, `${hash}.mov`)))) continue
      trashed++
    }
    const samples = join(dir, "samples")
    for (const name of await readdir(samples).catch(() => [] as string[])) {
      const path = join(samples, name)
      if (!SAMPLES_FILE.test(name) || !(await sourceGone(path)) || !(await settled(path, now))) continue
      const busy = stopped()
      if (busy) return busy
      await gone(path)
    }
  }
  return { trashed, blockedBy: null, kept: recent ? "recent" : null }
}
```

  (A missing graphics folder no longer ends the clean early, since the cutouts may still need cleaning. The graphics part is otherwise unchanged: the per-file `busy` check moved into `stopped()`.)

  **`shared/api.ts`.**
  - In `SettingsView`, after `graphicFiles`:

```ts
  /** the rendered .mov files kept under ~/Movies/CapCut/BOXBLACK/graphics, once that cache is counted */
  graphicFiles: { count: number; bytes: number }
  /** the person files (.mov) kept under ~/Movies/CapCut/BOXBLACK/cutouts; `cleanGraphicFiles` takes the unused ones away with the graphics */
  cutoutFiles: { count: number; bytes: number }
```

  - `DesktopApi.cleanGraphicFiles`'s doc becomes:

```ts
  /** Trashes rendered graphics and person cutouts no CapCut draft refers to any more; `blockedBy` says why nothing was trashed, `kept` why unused ones were left. */
```

  **`settings-api.ts`.**
  - The deps gain `cutoutFiles`, after `graphicFiles`, whose doc now mentions the person cutouts:

```ts
  /** the rendered graphics kept on disk: how many and how large, and trashing the ones no draft refers to (the person cutouts' too) */
  graphicFiles?: { info(): Promise<{ count: number; bytes: number }>; clean(): Promise<GraphicCleanResult> }
  /** the person cutouts kept on disk: how many and how large; `graphicFiles.clean` takes away the unused ones */
  cutoutFiles?: { info(): Promise<{ count: number; bytes: number }> }
```

  - `getSettings` reads the count with the others. The destructuring gains `cutoutFiles` at its end, and the `Promise.all` list gains one entry at its end:

```ts
      const [current, elevenlabs, anthropic, info, readiness, cutPresets, tools, unfetchableSounds, graphicsPack, graphicFiles, cutoutFiles] = await Promise.all([
        // …the ten entries as they are…
        deps.graphicFiles ? deps.graphicFiles.info() : { count: 0, bytes: 0 },
        deps.cutoutFiles ? deps.cutoutFiles.info() : { count: 0, bytes: 0 },
      ])
```

  - The returned view gains `cutoutFiles,` right after `graphicFiles,`.

  **`renderer/test/fake-api.ts`.** `settingsView()` gains `cutoutFiles: { count: 0, bytes: 0 },` right after `graphicFiles: { count: 0, bytes: 0 },`. The Settings row that shows it is Part E's.

  **`timeline.ts`.**
  - Next to the `graphics-render.ts` import:

```ts
import type { GraphicsRenderer, RenderJob } from "./graphics-render.ts"
import type { SourceProbes } from "./cutout-probe.ts"
import type { CutoutRenderer } from "./cutout-render.ts"
```

  - `TimelineDeps` gains four fields, after `graphicsDir`:

```ts
  /** where the renderer keeps the rendered graphics (~/Movies/CapCut/BOXBLACK/graphics); the bin entries for the ones a write no longer plays are taken out */
  graphicsDir?: string
  /** the person cutter, which the write waits for, samples included, before it reads the draft (spec §7.5) */
  cutouts?: CutoutRenderer
  /** each source video's frame times, size, turn and colours, as the helper reads them (spec §6.2) */
  probes?: SourceProbes
  /**
   * whether people can be cut out on this machine: the app's helper is there and runs. It settles once
   * the helper and the app's ffmpeg have given their versions, which every cutout's hash names, so it is
   * awaited before any `cutouts.hashOf`
   */
  cutoutsReady?: () => Promise<boolean>
  /** where the person files are kept (~/Movies/CapCut/BOXBLACK/cutouts): the write lays them down, and takes the bin entries it no longer plays out */
  cutoutsDir?: string
```

  **`highlights.ts`.**
  - The same two type imports go next to its `graphics-render.ts` import.
  - `HighlightDeps` gains three fields, after `graphicsReady`:

```ts
  /** whether the renderer pack is installed */
  graphicsReady?: () => Promise<boolean>
  /** the person cutter: what is made, what is not, and the head-cover samples (spec §7, §10) */
  cutouts?: CutoutRenderer
  /** each source video's frame times, size, turn and colours, as the helper reads them (spec §6.2) */
  probes?: SourceProbes
  /** whether people can be cut out on this machine; settles once both versions every cutout hash names are known, so it is awaited before any `cutouts.hashOf` */
  cutoutsReady?: () => Promise<boolean>
```

  **`index.ts`.**
  - `parseToolVersion` joins the `@boxblack/core/media` import:

```ts
import { findExecutable, inspectTools, measureLoudness, parseToolVersion, ProcessError, runProcess, type Loudness } from "@boxblack/core/media"
```

  - After the `graphics-files.ts` import:

```ts
import { createSourceProbes, segmentVersionOf, shippedProgram } from "./cutout-probe.ts"
import { createCutoutRenderer } from "./cutout-render.ts"
```

  - Replace the block from `const graphicFiles = {` through its closing `}` (right after `graphicsReady`) with the block below. It sits after `resourcesDir`, `tmpdir` and `send`, which it uses.
    - If Task 8 already resolves the helper somewhere in `index.ts`, keep this block's own `shippedProgram`. The hash needs the version the helper gives, read once. Only merge the two paths if Task 8's is the same file.

```ts
  // the person cutter and the ffmpeg that encodes its files, both from the app's own Resources/bin, in development too
  // (process.resourcesPath has no bin then); each is asked its version once, and every cutout's hash names both
  const cutoutHelper = shippedProgram(join(resourcesDir, "bin", "boxblack-segment"), ["--version"], segmentVersionOf)
  const cutoutFfmpeg = shippedProgram(join(resourcesDir, "bin", "ffmpeg"), ["-hide_banner", "-version"], (stdout) => parseToolVersion(stdout.trim().split("\n")[0] ?? ""))
  // people can be cut out once the helper has answered; both versions are known by then, so no cutout is hashed without them
  const cutoutsReady = async (): Promise<boolean> => {
    const [helper] = await Promise.all([cutoutHelper.ready(), cutoutFfmpeg.ready()])
    return helper
  }
  // every person file lands here, under ~/Movies, where CapCut's sandbox can read it
  const cutoutsDir = join(homedir(), "Movies", "CapCut", "BOXBLACK", "cutouts")
  const sourceProbes = createSourceProbes({ helper: cutoutHelper.path })
  const cutoutRenderer = createCutoutRenderer({
    cutoutsDir,
    workDir: join(tmpdir(), "boxblack-cutout"),
    helper: cutoutHelper.path,
    ffmpeg: cutoutFfmpeg.path,
    helperVersion: cutoutHelper.version,
    ffmpegVersion: cutoutFfmpeg.version,
    send,
  })
  const graphicFiles = {
    info: () => graphicFilesInfo(graphicsDir),
    clean: () => {
      // what a render or a cutout is making, or a write is about to lay down, is in no draft yet. A write that starts
      // after the clean did counts even once it is over: the drafts it wrote to may have been read before it wrote them
      const writes = timeline.writesStarted()
      return cleanGraphicFiles({
        dir: graphicsDir,
        cutoutsDir,
        draftsRoot: findDraftsRoot(homedir()),
        backupRoot,
        trash: (path) => shell.trashItem(path),
        busy: () => !graphicsRenderer.idle() || !cutoutRenderer.idle() || timeline.anyWriting() || timeline.writesStarted() !== writes,
      })
    },
  }
  const cutoutFiles = { info: () => graphicFilesInfo(cutoutsDir) }
```

  - In `createTimelineService({…})`, after `graphicsDir,`:

```ts
    graphicsDir,
    cutouts: cutoutRenderer,
    probes: sourceProbes,
    cutoutsReady,
    cutoutsDir,
    send,
```

  - In `createHighlightService({…})`, after `graphicsReady,`:

```ts
    graphicsReady,
    cutouts: cutoutRenderer,
    probes: sourceProbes,
    cutoutsReady,
    styleOf,
```

  - In `createSettingsApi({…})`, after `graphicFiles,`: `cutoutFiles,`.
  - In `app.on("before-quit", …)`, after `graphicsRenderer.cancel()`: `cutoutRenderer.cancel()`. A cut under way must not outlive the app, and a write waiting on it is told so. What it left in `tmpdir()/boxblack-cutout` and the half-encoded file are swept at the next start (Task 10).

- [ ] **Step 4: Run them and see them pass.**

  Run: `npx vitest run apps/desktop/src/main/graphics-files.test.ts apps/desktop/src/main/settings-api.test.ts`

  Expected: PASS (39 tests).

  `index.ts` has no test of its own. `npm run typecheck` checks its wiring, and the live test (Task 19) runs it.

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.


---

### Task 12: The flags — each group's own, the switch for all, and a look patch that keeps what it does not name

The flags are stored and carried everywhere, but nothing reads them yet: Task 13 is the first reader.

**Files:**
- Modify: `packages/core/src/flair/plan.ts` (`GroupLook` :18-27, `enforce` doc :50-60 and body :61-76)
- Modify: `packages/core/src/flair/catalogue.ts` (`FlairOptions` :8-22, `DEFAULT_FLAIR_OPTIONS` :23-24)
- Modify: `apps/desktop/src/main/settings.ts` (`read()` flair block :123-131)
- Modify: `apps/desktop/src/main/highlight-api.ts` (`checkedOptions` :75-86, `setFlairLook` :253-265)
- Modify: `apps/desktop/src/main/timeline-api.ts` (`checkedHighlights` :32-61)
- Modify: `apps/desktop/src/shared/api.ts` (`FlairLookPatch` :652-664)
- Modify: `apps/desktop/src/main/flair.ts` (`setLook` :696-726)
- Modify (mechanical): every `FlairOptions` literal in the tests, and `apps/desktop/src/renderer/test/fake-api.ts:64`
- Test: `packages/core/src/flair/plan.test.ts`, `catalogue.test.ts`; `apps/desktop/src/main/settings.test.ts`, `settings-api.test.ts`, `highlight-api.test.ts`, `timeline-api.test.ts`, `flair.test.ts`, `highlight-state.test.ts`

- [ ] **Step 1: Write the failing tests.**

  `packages/core/src/flair/plan.test.ts`, inside `describe("enforce")`:

```ts
  it("keeps whether the text goes behind the person, on Claude's look and on one set by hand; a look without the flag gets none", () => {
    const looks = enforce(
      [look({ behindPerson: true }), look({ behindPerson: true, edited: true }), look({ behindPerson: false }), look({})],
      [group("ลดครึ่งราคา"), group("วันนี้เท่านั้น"), group("ซื้อเลย"), group("ส่งฟรี")],
    )
    expect(looks.map((entry) => entry.behindPerson)).toEqual([true, true, false, undefined])
    // absent stays absent, not a false the rules made up: a look stored before 0.5.0 reads as it did
    expect(looks[3]).not.toHaveProperty("behindPerson")
  })
```

  `packages/core/src/flair/catalogue.test.ts`: the defaults test becomes

```ts
  it("turns every work on at the middle level but the graphics, which wait for the renderer pack, and puts the text Claude chooses behind the person; the old switch stays on and is read by nothing", () => {
    expect(DEFAULT_FLAIR_OPTIONS).toEqual({ enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false, behindPerson: true })
  })
```

  `apps/desktop/src/main/settings.test.ts`, next to the graphics-switch test:

```ts
test("the text behind the person is on unless the user turned it off: a file from before 0.5.0 reads it as on, and off stays off", async () => {
  const file = join(await dir(), "settings.json")
  await writeFile(file, JSON.stringify({ flair: { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: true } }))
  expect((await new SettingsStore(file).read()).flair.behindPerson).toBe(true)
  await new SettingsStore(file).update({ flair: { behindPerson: false } })
  expect((await new SettingsStore(file).read()).flair).toEqual({ enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: true, behindPerson: false })
  // another change to the flair keeps it off
  await new SettingsStore(file).update({ flair: { level: "light" } })
  expect((await new SettingsStore(file).read()).flair.behindPerson).toBe(false)
  // anything but true or false reads as the default
  await writeFile(file, JSON.stringify({ flair: { behindPerson: "off" } }))
  expect((await new SettingsStore(file).read()).flair.behindPerson).toBe(true)
})
```

  `apps/desktop/src/main/highlight-api.test.ts`, two tests at the end:

```ts
test("the look menu's switch for the text behind the person goes to the flair service on its own, true or false only", async () => {
  const { calls, api } = recorder()
  await api.setFlairLook("/p", "g1", { behindPerson: true })
  await api.setFlairLook("/p", "g1", { behindPerson: false, extra: 1 } as never)
  expect(calls).toEqual([
    ["setLook", "/p", "g1", { behindPerson: true }],
    // only the fields a look patch carries
    ["setLook", "/p", "g1", { behindPerson: false }],
  ])
  for (const behindPerson of ["yes", 1, null]) {
    await expect(api.setFlairLook("/p", "g1", { behindPerson } as never), String(behindPerson)).rejects.toThrow(/unknown highlight text request/)
  }
  expect(calls).toHaveLength(2)
})

test("the switch for the text behind the person is part of what a preview or a plan run is asked with, true or false only", async () => {
  const { calls, api } = recorder()
  const flair = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false, behindPerson: false }
  await api.previewHighlights("/p", DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair })
  expect(calls).toEqual([["preview", "/p", DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair }]])
  const without = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false }
  for (const bad of [without, { ...flair, behindPerson: "yes" }]) {
    const view = { position: "auto", subtitlesOn: false, highlightsOn: true, flair: bad }
    await expect(api.previewHighlights("/p", DEFAULT_CUT_RULES, view as never)).rejects.toThrow(/highlight text request/)
    await expect(api.planPost("/p", { rules: DEFAULT_CUT_RULES, view, subtitles: null } as never)).rejects.toThrow(/highlight text request/)
  }
  expect(calls).toHaveLength(1)
})
```

  `apps/desktop/src/main/timeline-api.test.ts`, at the end:

```ts
test("the switch for the text behind the person is part of what a write is asked with, true or false only", async () => {
  const written: unknown[] = []
  const api = createTimelineApi({ timeline: { write: async (...args: unknown[]) => void written.push(args) } as unknown as TimelineService })
  const flair = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false, behindPerson: true }
  await api.writeTimeline("/p", DEFAULT_CUT_RULES, 0, null, { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: 1, flair })
  expect(written).toEqual([["/p", DEFAULT_CUT_RULES, 0, null, { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: 1, flair }]])
  const without = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false }
  for (const bad of [without, { ...flair, behindPerson: "yes" }]) {
    const highlights = { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: 1, flair: bad }
    await expect(api.writeTimeline("/p", DEFAULT_CUT_RULES, 0, null, highlights as never)).rejects.toThrow(/highlight text/)
  }
  expect(written).toHaveLength(1)
})
```

  `apps/desktop/src/main/flair.test.ts`, after "a patch changes only what it names…":

```ts
test("the text behind the person is switched by hand on its own: the rest of the look stays as stored, even with the looks off, and the look becomes the user's", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const [first] = (await highlights.preview(folder, DEFAULT_CUT_RULES, OFF)).groups
  const before = (await outlines.get(folder))!.flair!.looks[first!.id]!
  // Claude's look: the bar, with 500 coloured
  expect(before).toMatchObject({ pattern: "bar", edited: false })
  // with the looks off the look menu shows the plain stack, and sends the switch alone
  await flair.setLook(folder, first!.id, { behindPerson: true })
  expect((await outlines.get(folder))!.flair!.looks[first!.id]).toEqual({ ...before, behindPerson: true, edited: true })
  await flair.setLook(folder, first!.id, { behindPerson: false })
  expect((await outlines.get(folder))!.flair!.looks[first!.id]).toEqual({ ...before, behindPerson: false, edited: true })
  // turned back on, the looks show what they were
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups[0]!.look).toMatchObject({ pattern: "bar", accent: before.accent })
  await expect(flair.setLook(folder, first!.id, { behindPerson: "yes" as never })).rejects.toThrow(/on or off/)
})
```

  `apps/desktop/src/main/highlight-state.test.ts`, after the coloured-word tests:

```ts
test("a look keeps its text behind the person through a regroup, a line taken out and a line's words changed, and the look in force keeps it while the looks are on", () => {
  const behind: GroupLook = { ...DEFAULT_LOOK, accent: { line: 1, from: 0, to: 1 }, behindPerson: true }
  const was = group("was", [["v1", 0, 4], ["v1", 4, 8]])
  const now = group("now", [["v1", 0, 4], ["v1", 4, 8]])
  const regrouped = regroupFlair({ highlights: { groups: [now] }, flair: { looks: { was: behind } } } as unknown as StoredOutline, [was], () => true)
  expect(regrouped.flair!.looks.now).toMatchObject({ behindPerson: true })
  const stored = { highlights: { groups: [was] }, flair: { looks: { was: behind } } } as unknown as StoredOutline
  expect(withoutLine(stored, "was", 0).flair!.looks.was).toMatchObject({ behindPerson: true, accent: { line: 0 } })
  expect(withLineText(stored, "was", 1, "was").flair!.looks.was).toMatchObject({ behindPerson: true })
  const flair = { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false, behindPerson: true } as const
  const shown = [{ id: "was", lines: [{ lineIndex: 0, text: "was" }, { lineIndex: 1, text: "was" }] }]
  expect(looksInForce(stored, shown, flair, null).was).toMatchObject({ behindPerson: true })
})
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run: `npx vitest run packages/core/src/flair apps/desktop/src/main/settings.test.ts apps/desktop/src/main/highlight-api.test.ts apps/desktop/src/main/timeline-api.test.ts apps/desktop/src/main/flair.test.ts apps/desktop/src/main/highlight-state.test.ts`

  Expected: FAIL — `enforce` drops `behindPerson` from Claude's looks (plan.test.ts and the `looksInForce` line), the defaults and the settings file have no `behindPerson`, both IPC checks let a flair without it through and `setFlairLook` drops it, and `setLook` never stores it. The regroup/withoutLine/withLineText lines already pass: they pin what the spread keeps.

- [ ] **Step 3: Implement the core flags.**

  In `packages/core/src/flair/plan.ts`, `GroupLook` gains a last field:

```ts
  /** set by hand on the post-production page: planning again leaves it as it is */
  edited: boolean
  /**
   * the group's text goes behind the person (spec 0.5.0 §4): Claude's choice, or the user's once set by hand, which
   * makes the look edited like any other change to it. Absent reads as false. It takes effect only while the switch
   * (`FlairOptions.behindPerson`) is on and the level shows the group, whatever the text looks' switch says: it is
   * read from the stored look, never from the look in force
   */
  behindPerson?: boolean
}
```

  `enforce`'s doc gains a last sentence: "Whether the text goes behind the person is carried as it is: no rule here has anything to say about it." Its last two lines become:

```ts
    const exit = usableExit(look.exit, pro)
    if (look.edited) return { ...look, pattern, tone, accent, exit }
    return { pattern, tone, accent, exit, edited: false, ...(look.behindPerson !== undefined ? { behindPerson: look.behindPerson } : {}) }
```

  In `packages/core/src/flair/catalogue.ts`:

```ts
  /** motion graphics rendered over the picture; off until the user turns it on, since it needs the renderer pack */
  graphic: boolean
  /**
   * the text Claude chose to put behind the person goes behind them (spec 0.5.0 §4); on unless the user turns it off.
   * Off, no group goes behind, shown or written, but every group keeps its own flag for when it is on again
   */
  behindPerson: boolean
}
/** Every work on at the middle level, the text behind the person too, but the graphics, which need the renderer pack (spec §2). */
export const DEFAULT_FLAIR_OPTIONS: FlairOptions = { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false, behindPerson: true }
```

- [ ] **Step 4: Implement the settings, the IPC checks and the look patch.**

  `apps/desktop/src/main/settings.ts`, `read()`, after the `graphic` line:

```ts
        graphic: flag(raw.flair?.graphic, DEFAULT_SETTINGS.flair.graphic),
        // a file written before 0.5.0 has no such switch, and reads as the default: on
        behindPerson: flag(raw.flair?.behindPerson, DEFAULT_SETTINGS.flair.behindPerson),
```

  `update()` needs nothing: it spreads the flair patch over what `read()` gave.

  `apps/desktop/src/main/highlight-api.ts`, `checkedOptions`:

```ts
    const looks = options.flair
    const flags = [looks?.enabled, looks?.text, looks?.sound, looks?.zoom, looks?.insert, looks?.graphic, looks?.behindPerson]
    if (typeof looks !== "object" || looks === null || flags.some((flag) => typeof flag !== "boolean") || !FLAIR_LEVELS.includes(looks.level)) throw refuse()
    return {
      position: options.position,
      subtitlesOn: options.subtitlesOn,
      highlightsOn: options.highlightsOn,
      flair: { enabled: looks.enabled, level: looks.level, text: looks.text, sound: looks.sound, zoom: looks.zoom, insert: looks.insert, graphic: looks.graphic, behindPerson: looks.behindPerson },
    }
```

  and `setFlairLook`:

```ts
    async setFlairLook(folder, groupId, patch) {
      if (typeof groupId !== "string" || typeof patch !== "object" || patch === null) throw refuse()
      const accent = patch.accent
      if (accent !== undefined && accent !== null && (!Number.isInteger(accent.line) || !isText(accent.word) || (accent.lineIndex !== undefined && !Number.isInteger(accent.lineIndex)))) throw refuse()
      if (patch.exit !== undefined && patch.exit !== null && !isText(patch.exit)) throw refuse()
      if (patch.tone !== undefined && !TONES.includes(patch.tone)) throw refuse()
      // the look menu's switch for the text behind the person: on or off, and nothing else
      if (patch.behindPerson !== undefined && typeof patch.behindPerson !== "boolean") throw refuse()
      return flair.setLook(folder, groupId, {
        ...(patch.pattern !== undefined ? { pattern: patch.pattern } : {}),
        ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
        ...(accent !== undefined ? { accent: accent === null ? null : { line: accent.line, word: accent.word, ...(accent.lineIndex !== undefined ? { lineIndex: accent.lineIndex } : {}) } } : {}),
        ...(patch.exit !== undefined ? { exit: patch.exit } : {}),
        ...(patch.behindPerson !== undefined ? { behindPerson: patch.behindPerson } : {}),
      })
    },
```

  `apps/desktop/src/main/timeline-api.ts`, `checkedHighlights`: the flag list and the rebuilt flair each gain the switch:

```ts
    [highlights.flair.enabled, highlights.flair.text, highlights.flair.sound, highlights.flair.zoom, highlights.flair.insert, highlights.flair.graphic, highlights.flair.behindPerson].every((flag) => typeof flag === "boolean") &&
```

```ts
      graphic: highlights.flair.graphic,
      behindPerson: highlights.flair.behindPerson,
    },
```

  `apps/desktop/src/shared/api.ts`, `FlairLookPatch` gains:

```ts
  /** an exit animation id, or null for none */
  exit?: string | null
  /**
   * the group's text behind the person, on or off by hand. The look menu sends it on its own, never with the pattern,
   * tone or exit it shows, so switching it while the text looks are off keeps the look that is stored
   */
  behindPerson?: boolean
}
```

  `apps/desktop/src/main/flair.ts`, `setLook` (doc, checks, and the look it builds):

```ts
    /**
     * One group's look, set by hand on the post-production page; Claude leaves it alone after that. The patch changes
     * only what it names, and every other field of the stored look stays: the look menu's switch for the text behind
     * the person, sent on its own while the text looks are off (the menu then shows the plain stack), keeps the
     * pattern, tone, coloured word and exit that are stored.
     */
    async setLook(folder: string, groupId: string, patch: FlairLookPatch): Promise<void> {
      if (patch.pattern !== undefined && !TEXT_PATTERNS.includes(patch.pattern as TextPattern)) throw new Error(`unknown pattern ${String(patch.pattern)}`)
      if (patch.exit !== undefined && patch.exit !== null && !exitById(patch.exit)) throw new Error(`unknown exit animation ${patch.exit}`)
      if (patch.behindPerson !== undefined && typeof patch.behindPerson !== "boolean") throw new Error("the text behind the person is either on or off")
      await outline(folder)
      await amend(folder, (stored) => {
        const group = stored.highlights?.groups.find((candidate) => candidate.id === groupId)
        if (!group) throw new Error(`unknown highlight group ${groupId}`)

        const looks = stored.flair?.looks ?? {}
        const look = looks[groupId] ?? DEFAULT_LOOK
        let accent = look.accent
        if (patch.accent === null) accent = null
        else if (patch.accent !== undefined) {
          // the accent is kept by the stored line it is on, whichever place that line shows at
          const index = patch.accent.lineIndex ?? patch.accent.line
          const line = group.lines[index]?.text
          const found = line === undefined ? null : findWord(line, patch.accent.word)
          if (!found) throw new Error(`"${patch.accent.word}" is not in line ${patch.accent.line + 1} of this group`)
          accent = { line: index, ...found }
        }
        const next: GroupLook = {
          // what the patch does not name stays as stored, whatever this code knows of
          ...look,
          pattern: patch.pattern ?? look.pattern,
          tone: patch.tone ?? look.tone,
          accent,
          exit: patch.exit !== undefined ? patch.exit : look.exit,
          ...(patch.behindPerson !== undefined ? { behindPerson: patch.behindPerson } : {}),
          edited: true,
        }
        return { ...stored, flair: { ...(stored.flair ?? {}), looks: { ...looks, [groupId]: next } } }
      })
    },
```

- [ ] **Step 5: Give every `FlairOptions` the tests build the new field.**

  `FlairOptions.behindPerson` is required, so the compiler finds every literal that lacks it. Run `npm run typecheck`; each error "Property 'behindPerson' is missing …" points at an object with the seven old fields.
  - In the main tests add `behindPerson: false` right after its `graphic`. The files are `timeline.test.ts`, `highlights.test.ts`, `flair.test.ts`, `flair-plan.test.ts`, `post-plan.test.ts`, `post-flow.test.ts`, `highlight-state.test.ts`, `graphics-cues.test.ts`, `sound-cues.test.ts`, `zoom-cues.test.ts`, `insert-media.test.ts`, `highlight-api.test.ts` and `timeline-api.test.ts`. None of these tests stores a behind flag, so the value changes nothing they test.
  - A spread one such as `{ ...FLAIR, graphic: true }` gets its field from what it spreads and needs nothing.
  - Two literals stand for what the settings hold, and get `true`: `FLAIR_ON` in `renderer/src/screens/PostScreen.test.tsx` (:794) and `settingsView()`'s `flair` in `renderer/test/fake-api.ts` (:64).

  Then update the expectations the compiler cannot see, which are compared at run time:
  - The whole flair objects read back from settings get `behindPerson: true`: `settings.test.ts` (~:31, :67, :152, :238) and `settings-api.test.ts` (~:70, :128). The `catalogue.test.ts` default is already done in Step 1.
  - The expected calls beside a request that now carries `behindPerson: false` carry it too: `highlight-api.test.ts` ~:56 and `timeline-api.test.ts` ~:36.
  - In `timeline-api.test.ts`, the requests the test expects to be refused (~:101-113): give every flair there that has all its other fields `behindPerson: false`, so each is still refused for its own reason.

- [ ] **Step 6: Run the tests and see them pass.**

  Run: `npx vitest run packages/core apps/desktop/src/main apps/desktop/src/renderer`

  Expected: PASS.

- [ ] **Step 7: Commit.** Run `npm test` and `npm run typecheck` from the repo root; both must be clean.

---

### Task 13: The preview — which groups go behind, where they sit, and how their cutting stands

One function in main decides which groups go behind the person and what is known of them before any cutting: `planBehind` in the new `main/behind-person.ts`, which the timeline service offers as `behind()`. It uses Part A's frame math on the draft's bin, the stored flags and the switch, the route, the helper, and each source's probe.
- The preview, the graphics' text bands (in the preview, in the graphic jobs the write waits for, and in the graphics prompt) and the write all place that function's `top` groups at the top.
- Placement never depends on how a job went (spec §5.3).
- The preview starts the jobs (`ensure`), shows each group's `CutoutView`, and counts them.

Two temporary things keep main green:
- The write already places these groups at the top, but still draws them with the rest, in front. Task 15 lays the person and draws them behind it.
- `covered` stays 0 until Task 14.

The person file's size (`workSize`) is the source's own size with the aspect kept, brought down so the short side is at most 1080 (spec §7.2 step 4), not the canvas's. CapCut fits a material to the canvas by its aspect, as it fits the main piece, so only a file of the source's aspect lands on the picture it was cut from. A canvas-sized file would be fitted differently whenever the footage is letterboxed.

**Files:**
- Modify (only what Part A did not add): `packages/core/package.json` (`exports`), `packages/core/src/capcut/index.ts` (rough-cut line)
- Create: `apps/desktop/src/main/behind-person.ts`, `apps/desktop/src/main/behind-person.test.ts`
- Modify: `apps/desktop/src/shared/api.ts` (`API_METHODS` :24-99, `DesktopApi` :244-245, new `CutoutView`, `HighlightGroupView` :536-554, `HighlightPreview` :666-729)
- Modify: `apps/desktop/src/main/highlight-state.ts` (`placementOf` :143-155)
- Modify: `apps/desktop/src/main/graphics-cues.ts` (`textBands` :80-134)
- Modify: `apps/desktop/src/main/timeline.ts` (imports, `TimelineDeps` :66-98, `compiled` :606-611, new `behind`, the write's placement :471-496)
- Modify: `apps/desktop/src/main/highlights.ts` (imports, `HighlightDeps` :52-71, `view` :155-243, `graphicsOn` :254-279, `graphicView` :290-325, `graphicJobs` :328-334, `preview` :489-496, `jobFor` :505-510, `pick` :526/594, new `behindStanding` and `retryCutout`)
- Modify: `apps/desktop/src/main/flair.ts` (`FlairDeps.timeline` :37, `planGraphics` :382-395)
- Modify: `apps/desktop/src/main/highlight-api.ts` (the `HighlightApi` pick list, `retryCutout`)
- Modify: `apps/desktop/src/main/index.ts` (the `createTimelineService` and `createHighlightService` calls)
- Modify: `apps/desktop/src/main/timeline-fixture.ts` (the cutout fakes, `setup` options)
- Modify: `apps/desktop/src/renderer/test/fake-api.ts`, `apps/desktop/src/renderer/src/screens/PostScreen.test.tsx` (~:340)
- Test: `behind-person.test.ts`, `highlight-state.test.ts`, `graphics-cues.test.ts`, `highlights.test.ts`, `flair-plan.test.ts`, `highlight-api.test.ts`

- [ ] **Step 1: Make the new core modules reachable from main.**

  Main imports these:
  - `@boxblack/core/cutout`, `@boxblack/core/capcut/layers`, `@boxblack/core/capcut/person` and `@boxblack/core/capcut/time`;
  - `cutFrames`, `atOn` and the `PieceFrames` type from `@boxblack/core/capcut`.

  Add whichever of these Part A's tasks did not. In `packages/core/package.json` `exports`, next to `"./capcut/bin"`:

```json
    "./capcut/layers": "./src/capcut/layers.ts",
    "./capcut/person": "./src/capcut/person.ts",
    "./capcut/time": "./src/capcut/time.ts",
    "./cutout": "./src/cutout/index.ts",
```

  In `packages/core/src/capcut/index.ts` the rough-cut line becomes:

```ts
export { atOn, buildRoughCut, cutFrames, outputCanvas, type PieceFrames } from "./rough-cut.ts"
```

- [ ] **Step 2: Give the test harness the person cutouts' fakes.**

  In `apps/desktop/src/main/timeline-fixture.ts`, add to the imports:

```ts
import { createHash } from "node:crypto"
import type { DraftMeta } from "@boxblack/core/capcut"
import type { SampleMask, SourceTiming } from "@boxblack/core/cutout"
import type { SourceProbe } from "./cutout-probe.ts"
import type { CutoutJob, CutoutRenderer, CutoutState } from "./cutout-render.ts"
```

  (`DraftInfo` is imported already: make it `import type { DraftInfo, DraftMeta } from "@boxblack/core/capcut"`.) Then add, above `setup`:

```ts
/** The 0917 source's frame times, numbers only (no picture): 933 frames 20 ticks apart at 1/600 s, four of them 21 (facts.md). */
export const IMG_9646_TIMING: SourceTiming = {
  timescale: 600,
  pts: Array.from({ length: 933 }, (_, i) => 20 * i + Number(i >= 104) + Number(i >= 313) + Number(i >= 523) + Number(i >= 732)),
}

/** What the helper reads of that source: 1080×1920, SDR BT.709, upright. */
export const IMG_9646_PROBE: SourceProbe = { ...IMG_9646_TIMING, width: 1080, height: 1920, rotation: 0, transfer: "bt709", primaries: "bt709" }

/** Where the tests' helper is: any path does, the fakes never run it. */
export const SEGMENT_HELPER = "/Applications/BOXBLACK.app/Contents/Resources/bin/boxblack-segment"

/** A sampled frame's mask, 9 × 16 like a portrait frame: nobody in it, or the person everywhere. */
export const EMPTY_MASK: SampleMask = { width: 9, height: 16, data: new Uint8Array(9 * 16) }
export const FULL_MASK: SampleMask = { width: 9, height: 16, data: new Uint8Array(9 * 16).fill(255) }

/** How a job the tests' renderer is waited for ends; a stopped one is in none of the lists, as the real renderer leaves it. */
export type CutoutOutcome = "made" | "failed" | "no-person" | "stopped"

/**
 * A person-cutout renderer for the tests. Like the real one it knows a job by what it asks for (16 hex of its JSON),
 * and a job waited for ends as `outcome` says. The tests set the rest: how a job stands (`states`, waiting unless
 * a wait or the test set it), the person's mask at every sampled frame (`mask`), and a helper that fails to
 * sample (`sampleFails`). It keeps what it was asked: `ensured`, `waited`, `retried` and `sampled`.
 */
export function fakeCutouts(dir: string, outcome: (job: CutoutJob) => CutoutOutcome = () => "made") {
  const hashOf = (job: CutoutJob) => createHash("sha256").update(JSON.stringify(job)).digest("hex").slice(0, 16)
  const fake = {
    hashOf,
    states: new Map<string, { state: CutoutState; done?: number; total?: number; error?: string }>(),
    ensured: [] as [string, CutoutJob[]][],
    waited: [] as [string, CutoutJob[]][],
    retried: [] as string[],
    sampled: [] as { source: CutoutJob["source"]; pts: number[] }[],
    mask: EMPTY_MASK,
    sampleFails: false,
  }
  const renderer: Pick<CutoutRenderer, "hashOf" | "ensure" | "wait" | "statusOf" | "rendered" | "retry" | "sample"> = {
    hashOf,
    ensure: (folder, jobs) => void fake.ensured.push([folder, jobs]),
    async wait(folder, jobs) {
      fake.waited.push([folder, jobs])
      const ready: string[] = []
      const failed: string[] = []
      const noPerson: string[] = []
      for (const [hash, job] of new Map(jobs.map((job) => [hashOf(job), job]))) {
        const result = fake.states.get(hash)?.state === "ready" ? "made" : outcome(job)
        if (result === "made") fake.states.set(hash, { state: "ready" }), ready.push(hash)
        else if (result === "failed") fake.states.set(hash, { state: "failed", error: "boxblack-segment exited 1" }), failed.push(hash)
        else if (result === "no-person") fake.states.set(hash, { state: "no-person" }), noPerson.push(hash)
      }
      return { ready, failed, noPerson }
    },
    statusOf: async (hash) => fake.states.get(hash) ?? { state: "waiting" },
    async rendered(job) {
      const hash = hashOf(job)
      if (fake.states.get(hash)?.state !== "ready") return null
      return { hash, path: join(dir, `${hash}.mov`), width: job.width, height: job.height, durationUs: Math.floor((job.pts.length * 1_000_000) / 30), frames: job.pts.length }
    },
    retry(hash) {
      fake.retried.push(hash)
      if (fake.states.get(hash)?.state === "failed") fake.states.delete(hash)
    },
    async sample(job) {
      fake.sampled.push(job)
      if (fake.sampleFails) throw new Error("boxblack-segment exited 1")
      return new Map(job.pts.map((pts) => [pts, fake.mask]))
    },
  }
  // the same object, so a test that sets `mask` or `sampleFails` changes what the renderer answers
  return Object.assign(fake, { renderer })
}

export type FakeCutouts = ReturnType<typeof fakeCutouts>

/** Points the fixture draft's one video at `path`: a cutout reads its source's size and time, and the fixture's own path is no file. */
export async function binVideoAt(folder: string, path: string): Promise<void> {
  const file = join(folder, "draft_meta_info.json")
  const meta = JSON.parse(await readFile(file, "utf8")) as DraftMeta
  for (const item of meta.draft_materials.flatMap((group) => group.value)) if (item.id === CLIP_ID) item.file_Path = path
  await writeFile(file, JSON.stringify(meta))
}
```

  `setup`'s options gain:

```ts
    /**
     * the person cutouts, with fakes: the renderer (`outcome` says how each job waited for ends), the helper (there
     * unless null) and its reads of a source (the 0917 source's frames unless `probe` says otherwise). The draft's
     * video is pointed at a file that exists, since a cutout reads its source's size and time
     */
    cutouts?: { outcome?: (job: CutoutJob) => CutoutOutcome; helper?: string | null; probe?: (path: string) => SourceProbe | null }
```

  In `setup`'s body, after `await outlines.put(stored)`:

```ts
  if (options.cutouts) await binVideoAt(folder, media)
  const cutoutsDir = join(dir, "Movies", "CapCut", "BOXBLACK", "cutouts")
  const cutouts = options.cutouts ? fakeCutouts(cutoutsDir, options.cutouts.outcome) : undefined
  const probe = options.cutouts?.probe ?? (() => IMG_9646_PROBE)
  const helper = options.cutouts?.helper === undefined ? SEGMENT_HELPER : options.cutouts.helper
```

  `deps` gains, after `media: options.media,`:

```ts
    ...(cutouts ? { cutouts: cutouts.renderer, sourceProbes: { probe: async (path: string) => probe(path) }, segmentHelper: () => helper, cutoutsDir } : {}),
```

  and `setup` returns `{ service: createTimelineService(deps), folder, root, capcut, deps, outlines, dir, cutouts }`.

- [ ] **Step 3: Write the failing tests.**

  Create `apps/desktop/src/main/behind-person.test.ts`:

```ts
import { expect, test } from "vitest"
import type { PieceFrames } from "@boxblack/core/capcut"
import type { CutoutRange } from "@boxblack/core/cutout"
import { sliversOf, standingOf, workSize, type BehindGroup, type CutOnFrames } from "./behind-person.ts"
import type { CutoutJob } from "./cutout-render.ts"

test("a person file is the source's size with its aspect kept, the short side brought down to 1080 and kept even", () => {
  expect(workSize(1080, 1920)).toEqual({ width: 1080, height: 1920 })
  expect(workSize(720, 1280)).toEqual({ width: 720, height: 1280 })
  expect(workSize(2160, 3840)).toEqual({ width: 1080, height: 1920 })
  expect(workSize(3840, 2160)).toEqual({ width: 1920, height: 1080 })
  expect(workSize(3024, 4032)).toEqual({ width: 1080, height: 1440 })
  // 1917.75 tall at 1080 wide: kept even
  expect(workSize(1440, 2557)).toEqual({ width: 1080, height: 1918 })
})

const piece = (cut: number, startFrame: number, frames: number): PieceFrames => {
  const at = (frame: number) => Math.floor((frame * 1_000_000) / 30)
  return { cut, binId: "v", sourceStartUs: 0, sourceDurationUs: at(frames), targetStartUs: at(startFrame), targetDurationUs: at(startFrame + frames) - at(startFrame), targetStartFrame: startFrame, frames }
}
/** Two pieces, frames 0–83 and 83–171, as the fixture's rough cut lays them. */
const CUT: CutOnFrames = { fps: 30, pieces: [piece(0, 0, 83), piece(1, 83, 88)], durationUs: 5_700_000, files: new Map() }
const range = (cut: number): CutoutRange => ({ groupId: "g", cut, targetStartFrame: 0, frames: 1, targetStartUs: 0, targetDurationUs: 0, sourceStartUs: 0 })

test("a window that reaches into a piece for less than a frame leaves a sliver there, which no person piece covers", () => {
  // 10 ms into the second piece: the frames end where the first one does
  expect(sliversOf({ startUs: 1_000_000, endUs: 2_776_666 }, CUT, [range(0)])).toBe(1)
  // well into it: a range there too
  expect(sliversOf({ startUs: 1_000_000, endUs: 2_900_000 }, CUT, [range(0), range(1)])).toBe(0)
  // starting 10 ms before the first piece ends: the frames start on the second
  expect(sliversOf({ startUs: 2_756_666, endUs: 3_500_000 }, CUT, [range(1)])).toBe(1)
  // past the end of the timeline is nothing
  expect(sliversOf({ startUs: 5_000_000, endUs: 9_000_000 }, CUT, [range(1)])).toBe(0)
})

const job = (frames: number): CutoutJob => ({ source: { path: "/footage/v.mov", size: 1, mtimeMs: 1 }, timescale: 600, pts: Array.from({ length: frames + 1 }, (_, i) => 20 * i), width: 1080, height: 1920 })
const behind = (jobs: CutoutJob[], block: BehindGroup["block"] = null): BehindGroup => ({
  groupId: "g",
  timed: { groupId: "g", beatId: "b", startUs: 0, endUs: 1_000_000, lines: [] },
  ranges: [],
  slivers: 0,
  block,
  jobs,
  samples: [],
})

test("a behind group stands as all its pieces together: one failed or empty is the whole group's, and it is cutting while any piece is", () => {
  const two = behind([job(9), job(29)])
  expect(standingOf(two, "capcut", [])).toEqual({ view: { state: "capcut" }, bucket: "laid" })
  expect(standingOf(behind([], "hdr"), "ours", [])).toEqual({ view: { state: "blocked", reason: "hdr" }, bucket: "front" })
  expect(standingOf(two, "ours", [{ state: "ready" }, { state: "ready" }])).toEqual({ view: { state: "ready" }, bucket: "laid" })
  expect(standingOf(two, "ours", [{ state: "ready" }, { state: "waiting" }])).toEqual({ view: { state: "waiting" }, bucket: "pending" })
  // weighed by frames: the first piece (10 frames) made, the second (30) half cut
  expect(standingOf(two, "ours", [{ state: "ready" }, { state: "cutting", done: 15, total: 30 }])).toEqual({ view: { state: "cutting", progress: 25 / 40 }, bucket: "pending" })
  expect(standingOf(two, "ours", [{ state: "ready" }, { state: "no-person" }])).toEqual({ view: { state: "no-person" }, bucket: "front" })
  // a failure outranks the rest: it is the one a retry may mend
  expect(standingOf(two, "ours", [{ state: "no-person" }, { state: "failed", error: "timed out" }])).toEqual({ view: { state: "failed", reason: "timed out" }, bucket: "front" })
})
```

  In `highlight-state.test.ts`:
  - The six `placementOf` calls (~:133-151) gain a fifth argument `false`.
  - Import `TOP_PLACEMENT`, and add:

```ts
test("a group whose text goes behind the person sits at the top, whatever position is pinned and whatever the picture keeps clear", () => {
  const clips = [clipWith("v1", [[0, 5_000_000, [0.1, 0.3]]])]
  for (const position of ["auto", "top", "middle", "bottom"] as const) expect(placementOf(placed("v1", 0, 1_000_000), clips, position, true, true)).toEqual(TOP_PLACEMENT)
  expect(TOP_PLACEMENT).toEqual({ kind: "fixed", position: "top" })
})
```

  In `graphics-cues.test.ts`, both `textBands({...})` calls (~:75, ~:88) gain `top: new Set()`, and add:

```ts
test("a group whose text goes behind the person keeps its band at the top, wherever the rest would go", () => {
  const groups = [placed("g1", { from: 0, to: 2 })]
  const band = (top: ReadonlySet<string>) =>
    textBands({ placed: groups, timed: groups.map((group) => timed(group.groupId)), clips: CLIPS, canvas: PORTRAIT, font: "kanit", looks: {}, position: "auto", subtitlesOn: true, top }).map((entry) => entry.band)
  // placed automatically it goes under the face, just above the subtitles' room; behind the person, at the top as if pinned there
  expect(band(new Set())).toEqual([{ fromY: 0.62, toY: 0.76 }])
  expect(band(new Set(["g1"]))).toEqual([{ fromY: 0.14, toY: 0.28 }])
})
```

  In `highlights.test.ts`, first change the harness:
  - Imports:
    - `import type { DraftInfo, PieceFrames, Segment } from "@boxblack/core/capcut"` (replacing the `Segment` import);
    - `import { cutoutRanges, personFrames } from "@boxblack/core/cutout"`;
    - `import { DEFAULT_LOOK } from "@boxblack/core/flair/plan"`;
    - `import { TOP_PLACEMENT } from "./highlight-state.ts"`;
    - `IMG_9646_PROBE` and `IMG_9646_TIMING` added to the `./timeline-fixture.ts` import.
  - `withHighlights` hands the fake renderer to the service it creates, as the app hands both services one: `cutouts: base.cutouts?.renderer,` after `newId`.
  - The first test's whole-preview expectation (~:104-129) gains `behindPerson: { laid: 0, front: 0, pending: 0, covered: 0 }, cutoutRoute: "capcut"`: the harness has CapCut Pro.

  Then add, after "the write puts the groups where the preview said":

```ts
/** The text behind the person on: the view the tests of it preview with. */
const BEHIND = { ...VIEW, flair: { ...VIEW.flair, behindPerson: true } }

/** Puts a stored group's text behind the person, as Claude or the look menu would. */
async function behindOn(outlines: Awaited<ReturnType<typeof setup>>["outlines"], folder: string, groupId: string): Promise<void> {
  await outlines.update(folder, (stored) => {
    const looks = stored!.flair?.looks ?? {}
    return { ...stored!, flair: { ...(stored!.flair ?? {}), looks: { ...looks, [groupId]: { ...(looks[groupId] ?? DEFAULT_LOOK), behindPerson: true } } } }
  })
}

/** A written draft's main pieces, as the frame math names them. */
const piecesOf = (info: DraftInfo): PieceFrames[] =>
  info.tracks[0]!.segments.map((segment, cut) => ({
    cut,
    binId: CLIP_ID,
    sourceStartUs: segment.source_timerange!.start,
    sourceDurationUs: segment.source_timerange!.duration,
    targetStartUs: segment.target_timerange.start,
    targetDurationUs: segment.target_timerange.duration,
    targetStartFrame: Math.round((segment.target_timerange.start * 30) / 1_000_000),
    frames: Math.round((segment.target_timerange.duration * 30) / 1_000_000),
  }))

/** The segment a written draft shows a text in. */
const segmentOf = (info: DraftInfo, text: string): Segment => {
  const material = (info.materials.texts as { id: string; content: string }[]).find((entry) => JSON.parse(entry.content).text === text)!
  return info.tracks.flatMap((track) => track.segments).find((segment) => segment.material_id === material.id)!
}

/** Adds the user's text on "ใน" (word 4), which ends the first piece and stays up into the second, and answers its id. */
async function acrossTheCut(highlights: Awaited<ReturnType<typeof withHighlights>>["highlights"], folder: string): Promise<string> {
  await highlights.addFromWords(folder, CLIP_ID, [4], 12, "beat-1")
  return (await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).groups.find((group) => group.lines[0]!.text === "ใน")!.id
}

test("a group whose text goes behind the person sits at the top, not dodging the face, and the other groups are placed as before", async () => {
  const { highlights, folder, outlines } = await withHighlights({ scenes: [scene(0, 31, { fromY: 0.05, toY: 0.4 })] })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)
  expect(before.groups.map((group) => group.placement)).not.toContain("fixed")
  await behindOn(outlines, folder, "id1")
  const after = await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)
  // the fixture has CapCut Pro: CapCut cuts the person out, so nothing known before any cutting keeps the group from the top
  expect(after.cutoutRoute).toBe("capcut")
  expect(after.groups.map((group) => [group.id, group.placement, group.behindPerson, group.cutout?.state])).toEqual([
    ["id1", "fixed", true, "capcut"],
    ["id2", before.groups[1]!.placement, false, undefined],
  ])
  expect(after.behindPerson).toEqual({ laid: 1, front: 0, pending: 0, covered: 0 })
})

test("with the switch off no group goes behind the person, but each still says its own flag; the text looks' switch plays no part", async () => {
  const { highlights, folder, outlines } = await withHighlights({ scenes: [scene(0, 31, { fromY: 0.05, toY: 0.4 })] })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(outlines, folder, "id1")
  const off = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  expect(off.groups.map((group) => [group.behindPerson, group.placement === "fixed", group.cutout])).toEqual([
    [true, false, undefined],
    [false, false, undefined],
  ])
  expect(off.behindPerson).toEqual({ laid: 0, front: 0, pending: 0, covered: 0 })
  // the looks off: the plain stack shows, and the stored flag still counts
  const plain = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...BEHIND, flair: { ...BEHIND.flair, text: false } })
  expect([plain.groups[0]!.look.pattern, plain.groups[0]!.cutout?.state]).toEqual(["stack", "capcut"])
})

test("on the app's own route the preview starts the group's cutting and shows how it stands; the group stays where it was placed whatever the cutting found", async () => {
  const { highlights, folder, outlines, cutouts } = await withHighlights({ pro: false, cutouts: {} })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(outlines, folder, "id1")
  const shown = async () => {
    const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)
    return { cutout: preview.groups[0]!.cutout, counts: preview.behindPerson, placement: preview.groups[0]!.placement, route: preview.cutoutRoute }
  }
  expect(await shown()).toMatchObject({ cutout: { state: "waiting" }, counts: { laid: 0, front: 0, pending: 1, covered: 0 }, placement: "fixed", route: "ours" })
  // the preview asked for the group's one piece, and only that, in the source's aspect
  const [asked, jobs] = cutouts!.ensured.at(-1)!
  expect(asked).toBe(folder)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]).toMatchObject({ timescale: 600, width: 1080, height: 1920 })
  const hash = cutouts!.hashOf(jobs[0]!)
  cutouts!.states.set(hash, { state: "cutting", done: 30, total: 40 })
  expect(await shown()).toMatchObject({ cutout: { state: "cutting", progress: 0.75 }, counts: { pending: 1 } })
  cutouts!.states.set(hash, { state: "ready" })
  expect(await shown()).toMatchObject({ cutout: { state: "ready" }, counts: { laid: 1, pending: 0 } })
  cutouts!.states.set(hash, { state: "failed", error: "boxblack-segment exited 1" })
  expect(await shown()).toMatchObject({ cutout: { state: "failed", reason: "boxblack-segment exited 1" }, counts: { front: 1 }, placement: "fixed" })
  cutouts!.states.set(hash, { state: "no-person" })
  expect(await shown()).toMatchObject({ cutout: { state: "no-person" }, counts: { front: 1 }, placement: "fixed" })
})

test("on the app's own route a group whose source it cannot cut, or with no helper on the machine, is placed as usual, drawn in front, and says why", async () => {
  const cases = [
    [{ probe: () => ({ ...IMG_9646_PROBE, transfer: "arib-std-b67" }) }, "hdr"],
    [{ probe: () => ({ ...IMG_9646_PROBE, rotation: 90 }) }, "rotated"],
    [{ probe: () => null }, "unreadable"],
    [{ helper: null }, "no-helper"],
  ] as const
  for (const [cutouts, reason] of cases) {
    const context = await withHighlights({ pro: false, cutouts, scenes: [scene(0, 31, { fromY: 0.05, toY: 0.4 })] })
    await context.highlights.pick(context.folder, DEFAULT_CUT_RULES, VIEW)
    const before = (await context.highlights.preview(context.folder, DEFAULT_CUT_RULES, BEHIND)).groups[0]!.placement
    await behindOn(context.outlines, context.folder, "id1")
    const preview = await context.highlights.preview(context.folder, DEFAULT_CUT_RULES, BEHIND)
    expect([preview.groups[0]!.placement, preview.groups[0]!.cutout, preview.behindPerson], reason).toEqual([before, { state: "blocked", reason }, { laid: 0, front: 1, pending: 0, covered: 0 }])
    // nothing is cut for it
    expect(context.cutouts!.ensured.at(-1)![1]).toEqual([])
  }
})

test("a group across a cut is cut piece by piece but stands as one: one piece failed puts the whole group in front", async () => {
  const { highlights, folder, outlines, cutouts } = await withHighlights({ pro: false, cutouts: {} })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const id = await acrossTheCut(highlights, folder)
  await behindOn(outlines, folder, id)
  const cutout = async () => (await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)).groups.find((group) => group.id === id)!.cutout
  await cutout()
  const jobs = cutouts!.ensured.at(-1)![1]
  expect(jobs).toHaveLength(2)
  cutouts!.states.set(cutouts!.hashOf(jobs[0]!), { state: "ready" })
  expect(await cutout()).toMatchObject({ state: "waiting" })
  cutouts!.states.set(cutouts!.hashOf(jobs[1]!), { state: "failed", error: "timed out" })
  expect(await cutout()).toMatchObject({ state: "failed", reason: "timed out" })
})

test("the cutting the preview asks for is the frames the write lays the group on: pieces cut off the frame grid, and a group across a cut", async () => {
  const { highlights, folder, outlines, service, cutouts } = await withHighlights({ pro: false, cutouts: {}, highlightAssets: assets })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const id = await acrossTheCut(highlights, folder)
  await behindOn(outlines, folder, id)
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)
  const [, asked] = cutouts!.ensured.at(-1)!
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: preview.groups.length, flair: BEHIND.flair })

  // the group as the write laid it: its text on its frames, over the main pieces as written (both pieces start between two frames of the cut)
  const info = await readInfo(folder)
  const line = segmentOf(info, "ใน")
  const pieces = piecesOf(info)
  const ranges = cutoutRanges([{ groupId: id, startUs: line.target_timerange.start, endUs: line.target_timerange.start + line.target_timerange.duration }], pieces, 30, info.duration)
  expect(ranges.map((range) => range.cut)).toEqual([0, 1])
  // each piece of it asks for the source frames its main piece shows, one per timeline frame, the spare first
  expect(asked.map((job) => job.pts)).toEqual(ranges.map((range) => personFrames(range, pieces[range.cut]!, IMG_9646_TIMING, 30).map((index) => IMG_9646_TIMING.pts[index]!)))
  // of the file the draft plays, made at its size
  expect(asked.map((job) => [job.source.path, job.timescale, job.width, job.height])).toEqual(ranges.map(() => [expect.stringContaining("IMG_9646.MOV"), 600, 1080, 1920]))
})

test("a retry forgets the failed cutting of every piece of the group, as the page previews it, and the next preview cuts them again", async () => {
  const { highlights, folder, outlines, cutouts } = await withHighlights({ pro: false, cutouts: {} })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const id = await acrossTheCut(highlights, folder)
  await behindOn(outlines, folder, id)
  await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)
  const jobs = cutouts!.ensured.at(-1)![1]
  for (const job of jobs) cutouts!.states.set(cutouts!.hashOf(job), { state: "failed", error: "timed out" })
  // the page previews under the settings, where the text behind the person is on by default
  await highlights.retryCutout(folder, id)
  expect(cutouts!.retried).toEqual(jobs.map(cutouts!.hashOf))
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)).groups.find((group) => group.id === id)!.cutout).toMatchObject({ state: "waiting" })
  // a group whose text is not behind the person has nothing to retry
  await highlights.retryCutout(folder, "id2")
  expect(cutouts!.retried).toHaveLength(jobs.length)
})

test("the write puts a group whose text goes behind the person at the top, where the preview placed it", async () => {
  const { highlights, folder, outlines, service } = await withHighlights({ scenes: [scene(0, 31, { fromY: 0.05, toY: 0.4 })], highlightAssets: assets })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(outlines, folder, "id1")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)).groups[0]!.placement).toBe("fixed")
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 2, flair: BEHIND.flair })
  const info = await readInfo(folder)
  // Claude's style is headline: Chonburi
  const top = layoutGroup(["ขึ้นไป", "อวกาศ!"], "chonburi", { width: 1080, height: 1920 }, TOP_PLACEMENT).lines
  const yOf = (text: string) => (segmentOf(info, text).clip as { transform: { y: number } }).transform.y
  expect(yOf("ขึ้นไป")).toBeCloseTo(top[0]!.y, 6)
  expect(yOf("อวกาศ!")).toBeCloseTo(top[1]!.y, 6)
})
```

  In `flair-plan.test.ts`, after "the text band Claude is told of is laid out with the look the text has":

```ts
test("the text band Claude is told of for a group behind the person is at the top, where the preview and the write put it", async () => {
  const faceHigh: Scene = { startUs: 0, endUs: s(31), description: "ชายหนุ่มพูดกับกล้อง", kind: "talking-head", issues: [], keepClear: { fromY: 0.05, toY: 0.4 } }
  const { flair, folder, claude, highlights } = await withPoints({}, { scenes: [faceHigh] })
  await highlights.addFromWords(folder, CLIP_ID, [3], 12, "beat-1")
  const [group] = (await highlights.preview(folder, DEFAULT_CUT_RULES, request().view)).groups
  claude.replies.set(GRAPHICS_PROMPT.system, { graphics: [] })
  const band = async (asked: PostRequest) => {
    await flair.planGraphics(folder, asked)
    return /\[1\] [^\n]*มีข้อความเด่น \[([\d.]+), ([\d.]+)\]/.exec(textOf(claude.requests.at(-1)!.content))!.slice(1).map(Number)
  }
  const behind = request({ graphic: true, behindPerson: true })
  const pinnedTop = await band({ ...behind, view: { ...behind.view, position: "top" } })
  const dodging = await band(behind)
  expect(dodging).not.toEqual(pinnedTop)
  await flair.setLook(folder, group!.id, { behindPerson: true })
  expect(await band(behind)).toEqual(pinnedTop)
  // with the switch off it dodges the face again
  expect(await band(request({ graphic: true }))).toEqual(dodging)
})
```

  In `highlight-api.test.ts`:
  - The recorder's `highlights` gains `retryCutout: record("retryCutout"),`.
  - Add:

```ts
test("a retry of a behind group's cutouts goes to the highlight service, for a project and a group named by text", async () => {
  const { calls, api } = recorder()
  await api.retryCutout("/p", "g1")
  expect(calls).toEqual([["retryCutout", "/p", "g1"]])
  for (const [folder, groupId] of [["", "g1"], ["/p", ""], ["/p", 7], [3, "g1"], ["/p", "x".repeat(201)]]) {
    await expect(api.retryCutout(folder as never, groupId as never), JSON.stringify([folder, groupId])).rejects.toThrow(/unknown highlight text request/)
  }
  expect(calls).toHaveLength(1)
})
```

- [ ] **Step 4: Run the tests and see them fail.**

  Run: `npx vitest run apps/desktop/src/main/behind-person.test.ts apps/desktop/src/main/highlight-state.test.ts apps/desktop/src/main/graphics-cues.test.ts apps/desktop/src/main/highlights.test.ts apps/desktop/src/main/flair-plan.test.ts apps/desktop/src/main/highlight-api.test.ts`

  Expected: FAIL.
  - `behind-person.ts` does not exist, and `TOP_PLACEMENT` is not exported.
  - `placementOf` and `textBands` ignore the flag.
  - The preview has no `behindPerson`, `cutoutRoute` or `cutout`, and `retryCutout` does not exist.
  - The graphics band ignores the flag.

- [ ] **Step 5: Add the shared types.**

  In `apps/desktop/src/shared/api.ts`:
  - `API_METHODS` gains `"retryCutout",` right after `"retryGraphic",`.
  - `DesktopApi` gains, after `retryGraphic`:

```ts
  /**
   * Forgets the failed person cutouts of a behind group, every piece of it, so the next preview cuts them again (like
   * retryGraphic). The group is one the page shows under the rules and options in settings.
   */
  retryCutout(folder: string, groupId: string): Promise<void>
```

  - Above `HighlightGroupView`:

```ts
/** How the person is cut out for one group whose text goes behind them (spec 0.5.0 §9.4, §11). */
export interface CutoutView {
  /**
   * The app's own route (without CapCut Pro), all the group's pieces together — one piece failed or with no one in it
   * is the whole group's, which is then drawn in front: waiting (queued), cutting, ready, failed (a retry may mend it),
   * no-person. blocked: the app cannot cut it here (why in `reason`), so it is placed and drawn as any group. capcut:
   * CapCut removes the background itself when the project opens (with CapCut Pro)
   */
  state: "waiting" | "cutting" | "ready" | "failed" | "no-person" | "blocked" | "capcut"
  /** 0..1 while cutting */
  progress?: number
  /** blocked: why, a CutoutBlock of main/cutout-probe.ts ("no-helper", "unreadable", "rotated", "hdr", "draft-fps"); failed: the error line */
  reason?: string
  /** the head covers more than 35% of a line of it (spec §10); absent until measured */
  covered?: boolean
  /** false when the cover cannot be measured (no helper, or a source it cannot read upright); absent until measured */
  coverChecked?: boolean
}
```

  - `HighlightGroupView` gains, after `heldExit`:

```ts
  /** the group's own flag for its text behind the person (its stored look's), whatever the switches: the look menu shows it */
  behindPerson: boolean
  /** how its text goes behind the person: only on a group whose does (its flag, the switch on, and the level showing it) */
  cutout?: CutoutView
```

  - `HighlightPreview` gains, after `proLeftOut`:

```ts
  /**
   * the groups whose text goes behind the person, counted (spec §9.4): laid (behind it), front (drawn in front of it:
   * the app cannot cut it, or its cutting failed or found no one), pending (still being cut; the write waits for it),
   * covered (laid or pending, with the head-cover warning). All zero with the switch off
   */
  behindPerson: { laid: number; front: number; pending: number; covered: number }
  /** who cuts the person out: the app ("ours"), or CapCut itself ("capcut") once the user says they have CapCut Pro */
  cutoutRoute: "ours" | "capcut"
```

- [ ] **Step 6: Create `apps/desktop/src/main/behind-person.ts`.**

```ts
import { stat } from "node:fs/promises"
import { atOn, cutFrames, type BinVideo, type PieceFrames } from "@boxblack/core/capcut"
import { frameToUs } from "@boxblack/core/capcut/time"
import type { CutPlan } from "@boxblack/core/cut"
import { cutoutRanges, personFrames, shownSourceFrame, type CutoutRange, type SourceTiming } from "@boxblack/core/cutout"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import { timeHighlights, type PlacedGroup, type TimedGroup } from "@boxblack/core/highlights"
import type { CutoutView, StoredOutline } from "../shared/api.ts"
import { blockOf, type CutoutBlock, type SourceProbe } from "./cutout-probe.ts"
import type { CutoutJob, CutoutRenderer } from "./cutout-render.ts"

// Text behind the person (spec 0.5.0): which highlight groups go behind the person, cut on the frames the write lays
// them on, and what is known of each before any cutting. The preview, the graphics, the graphics plan and the write
// all read it from here, so they agree on it.

/** Who cuts the person out: the app's own helper, or CapCut itself once the user says they have CapCut Pro (spec §8). */
export type CutoutRoute = "ours" | "capcut"

/** A person file's short side is brought down to this: Vision's mask holds no more detail than that (spec §7.2 step 4). */
const MAX_SHORT_SIDE = 1080

/**
 * The size a person file is made at: the source's own, its aspect kept, the short side brought down to 1080 when it is
 * longer (spec §7.2 step 4). The aspect is what matters: CapCut fits a material to the canvas by its aspect, as it fits
 * the main piece, so a file of the source's aspect lands on the picture it was cut from, which one of the canvas's
 * size would not whenever the footage is letterboxed. A size brought down is kept even.
 */
export function workSize(width: number, height: number): { width: number; height: number } {
  if (Math.min(width, height) <= MAX_SHORT_SIDE) return { width, height }
  const even = (value: number) => 2 * Math.round(value / 2)
  return width <= height
    ? { width: MAX_SHORT_SIDE, height: even((height * MAX_SHORT_SIDE) / width) }
    : { width: even((width * MAX_SHORT_SIDE) / height), height: MAX_SHORT_SIDE }
}

/** The cut on the frames the write lays it on: its main pieces, its length, and the file each piece plays, by bin id. */
export interface CutOnFrames {
  fps: number
  pieces: PieceFrames[]
  durationUs: number
  files: Map<string, BinVideo>
}

/** The cut as buildRoughCut will lay it on this bin (cutFrames), without the draft; null for a cut the write refuses anyway. */
export function cutOnFrames(plan: CutPlan, bin: BinVideo[], fps: number): CutOnFrames | null {
  if (plan.cuts.length === 0) return null
  let pieces: PieceFrames[]
  try {
    pieces = cutFrames(plan.cuts, bin, fps)
  } catch {
    // a file gone from the bin, or a piece past its file's end: the write refuses this cut, so nothing goes behind on it
    return null
  }
  const last = pieces.at(-1)!
  return { fps, pieces, durationUs: last.targetStartUs + last.targetDurationUs, files: new Map(bin.map((video) => [video.id, video])) }
}

/** One frame the head-cover warning samples (spec §10 step 1): a timeline frame, where it is on its main piece, and the source frame shown there. */
export interface SamplePoint {
  frame: number
  cut: number
  /** µs into the main piece, as it plays */
  atUs: number
  source: CutoutJob["source"]
  /** the source frame's time in its track's ticks */
  pts: number
}

/** One group whose text goes behind the person, as everything before any cutting knows it. */
export interface BehindGroup {
  groupId: string
  /** the group timed as the write times it, on the frames the pieces are laid on */
  timed: TimedGroup
  /** its window split per main piece, in time order (cutoutRanges) */
  ranges: CutoutRange[]
  /** how many main pieces its window reaches into for less than a frame, where no person piece is laid (sliversOf) */
  slivers: number
  /** the app's route: why it cannot cut the group (it is then placed and drawn as any group, and counted in front); null when it can, and always on CapCut's */
  block: CutoutBlock | null
  /** the app's route, when it can cut the group: one job per range, in range order */
  jobs: CutoutJob[]
  /** the frames the head-cover warning samples; none when the helper cannot read them upright */
  samples: SamplePoint[]
}

export interface BehindPlan {
  route: CutoutRoute
  /** every group whose text goes behind the person, in time order */
  groups: BehindGroup[]
  /** the ids of the groups placed at the top (spec §5.3): all of them on CapCut's route, on the app's those it can cut */
  top: ReadonlySet<string>
  /** the cut on frames the groups were measured on; null when none are */
  cut: CutOnFrames | null
}

export interface BehindDeps {
  /** where the boxblack-segment helper is, or null when the machine has none that runs */
  segmentHelper?: () => string | null
  /** the helper's reading of a source's frames and picture, read once per file as it is */
  sourceProbes?: { probe(path: string): Promise<SourceProbe | null> }
}

/** What the helper reads of one source file: its identity, which the hash names, and its frames; nulls when it cannot be read. */
interface SourceFacts {
  source: CutoutJob["source"] | null
  probe: SourceProbe | null
}

async function readFacts(file: BinVideo | undefined, probes: BehindDeps["sourceProbes"]): Promise<SourceFacts> {
  if (!file || !probes) return { source: null, probe: null }
  // the file as it is now: replaced or changed, it is another source, and another hash
  const source = await stat(file.path).then(
    ({ size, mtimeMs }) => ({ path: file.path, size, mtimeMs }),
    () => null,
  )
  if (!source) return { source: null, probe: null }
  return { source, probe: await probes.probe(file.path).catch(() => null) }
}

/** A source whose frames the helper can sample upright: read, and not rotated (a rotated file's mask would not lie on the canvas as its picture does). */
const sampleable = (facts: SourceFacts): boolean => facts.source !== null && facts.probe !== null && facts.probe.rotation % 360 === 0

/**
 * How many main pieces a group's window reaches into for less than a frame (spec §9.4 `dropped.cutouts`): the pieces
 * its µs window overlaps, less those it has a range on, since the ranges are on whole frames. Within the timeline only.
 */
export function sliversOf(window: { startUs: number; endUs: number }, cut: CutOnFrames, ranges: CutoutRange[]): number {
  const endUs = Math.min(window.endUs, cut.durationUs)
  const touched = cut.pieces.filter((piece) => piece.targetStartUs < endUs && window.startUs < piece.targetStartUs + piece.targetDurationUs).length
  return Math.max(0, touched - ranges.length)
}

/**
 * The job that cuts one range out (spec §7.2): one file frame per timeline frame of the range, each the source frame
 * the main piece shows there, the spare first (personFrames), at the source's size brought down (workSize). Only for
 * a range whose source the helper read and the app's route supports.
 */
function jobOf(range: CutoutRange, piece: PieceFrames, facts: SourceFacts, fps: number): CutoutJob {
  const probe = facts.probe!
  const timing: SourceTiming = { timescale: probe.timescale, pts: probe.pts }
  return {
    source: facts.source!,
    timescale: probe.timescale,
    pts: personFrames(range, piece, timing, fps).map((index) => probe.pts[index]!),
    ...workSize(probe.width, probe.height),
  }
}

/**
 * The frames the head-cover warning samples (spec §10 step 1): the first, the middle and the last timeline frame the
 * group is on screen, each with the main piece it is on and the source frame that piece shows there, by the rule
 * CapCut picks frames by (shownSourceFrame). `facts` are the ranges' sources, in range order.
 */
function sampleFrames(ranges: CutoutRange[], cut: CutOnFrames, facts: SourceFacts[]): SamplePoint[] {
  if (ranges.length === 0) return []
  const first = ranges[0]!.targetStartFrame
  const lastRange = ranges.at(-1)!
  const last = lastRange.targetStartFrame + lastRange.frames - 1
  return [...new Set([first, first + Math.floor((last - first) / 2), last])].flatMap((frame) => {
    const i = ranges.findIndex((range) => range.targetStartFrame <= frame && frame < range.targetStartFrame + range.frames)
    if (i < 0) return []
    const range = ranges[i]!
    const piece = cut.pieces[range.cut]!
    const probe = facts[i]!.probe!
    const atUs = frameToUs(frame, cut.fps) - piece.targetStartUs
    const shown = shownSourceFrame({ timescale: probe.timescale, pts: probe.pts }, piece.sourceStartUs + atUs)
    return [{ frame, cut: range.cut, atUs, source: facts[i]!.source!, pts: probe.pts[shown]! }]
  })
}

/**
 * The groups among `placed` (the groups the level shows) whose text goes behind the person, as the write lays them.
 * A group's flag is in force when its stored look says so and the switch is on; the text looks' switch plays no part
 * (spec §4). The route is CapCut's with CapCut Pro, else the app's. Each group is measured on the frames the write
 * lays the cut on (cutFrames, cutoutRanges). On the app's route it can be cut only when the helper is here and every
 * range's source passes blockOf; when it cannot, it is placed and drawn as any group (spec §5.3, §6.2). Nothing here
 * depends on how a job went: placement and the counts that follow from it are known before any cutting.
 */
export async function planBehind(
  input: { stored: StoredOutline; plan: CutPlan; bin: BinVideo[]; fps: number; placed: PlacedGroup[]; flair: FlairOptions; pro: boolean },
  deps: BehindDeps,
): Promise<BehindPlan> {
  const route: CutoutRoute = input.pro ? "capcut" : "ours"
  const none: BehindPlan = { route, groups: [], top: new Set(), cut: null }
  const looks = input.stored.flair?.looks ?? {}
  const wanted = new Set(input.flair.behindPerson ? input.placed.filter((group) => looks[group.groupId]?.behindPerson === true).map((group) => group.groupId) : [])
  if (wanted.size === 0) return none
  const cut = cutOnFrames(input.plan, input.bin, input.fps)
  if (!cut) return none
  // every group shown is timed, as the write times them, since a group ends where the next one starts
  const timed = timeHighlights(input.placed, atOn(cut.pieces), cut.durationUs).filter((group) => wanted.has(group.groupId))
  const ranges = cutoutRanges(timed.map(({ groupId, startUs, endUs }) => ({ groupId, startUs, endUs })), cut.pieces, cut.fps, cut.durationUs)
  const helper = deps.segmentHelper?.() ?? null
  // each file is read once, however many ranges play it
  const read = new Map<string, Promise<SourceFacts>>()
  const factsOf = (binId: string): Promise<SourceFacts> => {
    const known = read.get(binId)
    if (known) return known
    const facts = readFacts(cut.files.get(binId), deps.sourceProbes)
    read.set(binId, facts)
    return facts
  }
  const groups: BehindGroup[] = []
  for (const group of timed) {
    const own = ranges.filter((range) => range.groupId === group.groupId)
    // without the helper nothing is read: the app's route cannot cut, and neither route can sample
    const facts = helper === null ? [] : await Promise.all(own.map((range) => factsOf(cut.pieces[range.cut]!.binId)))
    let block: CutoutBlock | null = null
    if (route === "ours") {
      if (helper === null) block = "no-helper"
      else {
        for (const fact of facts) {
          block = fact.source === null ? "unreadable" : blockOf(fact.probe, cut.fps)
          if (block !== null) break
        }
      }
    }
    const jobs = route === "ours" && block === null ? own.map((range, i) => jobOf(range, cut.pieces[range.cut]!, facts[i]!, cut.fps)) : []
    // the head-cover samples: on the app's route for a group it can cut; on CapCut's whenever the helper reads the sources upright
    const samples = helper !== null && block === null && facts.every(sampleable) ? sampleFrames(own, cut, facts) : []
    groups.push({ groupId: group.groupId, timed: group, ranges: own, slivers: sliversOf(group, cut, own), block, jobs, samples })
  }
  return { route, groups, top: new Set(groups.filter((group) => group.block === null).map((group) => group.groupId)), cut }
}

/** How one job stands, as the renderer answers it. */
export type CutoutStatus = Awaited<ReturnType<CutoutRenderer["statusOf"]>>

/** Where one behind group stands, as the preview shows it and counts it. */
export interface BehindStanding {
  view: CutoutView
  /** laid: it goes behind (made, or CapCut cuts it); front: drawn in front; pending: its cutting is not over, and the write waits for it */
  bucket: "laid" | "front" | "pending"
}

/**
 * How a behind group stands (spec §9.2, §9.4): CapCut's route cuts nothing here, so it is laid; on the app's route, a
 * group it cannot cut is blocked and in front, and one it can stands as all its pieces together: one failed (the one a
 * retry may mend, so it outranks the rest) or empty puts the whole group in front, and it is made only when every piece
 * is. While any piece is cutting, the progress is the group's frames cut so far, each piece weighed by its frames.
 * `statuses` are its jobs', in job order.
 */
export function standingOf(group: BehindGroup, route: CutoutRoute, statuses: CutoutStatus[]): BehindStanding {
  if (route === "capcut") return { view: { state: "capcut" }, bucket: "laid" }
  if (group.block !== null) return { view: { state: "blocked", reason: group.block }, bucket: "front" }
  const failed = statuses.find((status) => status.state === "failed")
  if (failed) return { view: { state: "failed", ...(failed.error ? { reason: failed.error } : {}) }, bucket: "front" }
  if (statuses.some((status) => status.state === "no-person")) return { view: { state: "no-person" }, bucket: "front" }
  if (statuses.every((status) => status.state === "ready")) return { view: { state: "ready" }, bucket: "laid" }
  if (!statuses.some((status) => status.state === "cutting")) return { view: { state: "waiting" }, bucket: "pending" }
  const weights = group.jobs.map((job) => job.pts.length)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const cut = statuses.reduce((sum, status, i) => {
    const share = status.state === "ready" ? 1 : status.state === "cutting" && status.total ? (status.done ?? 0) / status.total : 0
    return sum + weights[i]! * share
  }, 0)
  return { view: { state: "cutting", progress: total > 0 ? cut / total : 0 }, bucket: "pending" }
}
```

- [ ] **Step 7: Put a behind group at the top wherever `placementOf` runs.**

  In `apps/desktop/src/main/highlight-state.ts`, replace `placementOf` and its doc:

```ts
/** Where a group whose text goes behind the person sits: the top, whatever the setting, not dodging the face (spec 0.5.0 §5.3). */
export const TOP_PLACEMENT: HighlightPlacement = { kind: "fixed", position: "top" }

/**
 * Where a group goes: the top when its text goes behind the person (`onTop`: in the behind plan's `top`), else the
 * position the user pinned, or the band every scene it plays over wants kept clear. A video with no pictures analysed
 * has no band, so the text falls back to the top.
 */
export function placementOf(group: PlacedGroup, clips: CutClip[], position: HighlightPosition, keepSubtitleRoom: boolean, onTop: boolean): HighlightPlacement {
  if (onTop) return TOP_PLACEMENT
  if (position !== "auto") return { kind: "fixed", position }
  const scenes = clips.find((clip) => clip.id === group.videoId)?.insight?.scenes ?? []
  const from = group.lines[0]!.sourceUs
  const to = group.end.sourceUs
  const bands = scenes.flatMap((scene) => (scene.keepClear && scene.startUs <= to && scene.endUs >= from ? [scene.keepClear] : []))
  const keepClear = bands.length === 0 ? null : { fromY: Math.min(...bands.map((band) => band.fromY)), toY: Math.max(...bands.map((band) => band.toY)) }
  return { kind: "auto", keepClear, keepSubtitleRoom }
}
```

  In `apps/desktop/src/main/graphics-cues.ts`, `textBands`:
  - The first sentence of the doc becomes "Where each group on the rough cut draws its text, laid out as the preview and the write lay it out (`placementOf`, at the top for a group whose text goes behind the person, and `layoutGroup`, the shown lines trimmed as both draw them)."
  - The input gains:

```ts
  subtitlesOn: boolean
  /** the groups placed at the top because their text goes behind the person (the behind plan's `top`) */
  top: ReadonlySet<string>
}): GroupBand[] {
```

  and its placement line becomes:

```ts
    const placement = placementOf(placed, input.clips, input.position, input.subtitlesOn, input.top.has(group.groupId))
```

- [ ] **Step 8: Give the timeline service the behind plan.**

  In `apps/desktop/src/main/timeline.ts`, the imports gain:
  - `type BinVideo` in the `@boxblack/core/capcut` list;
  - `import { planBehind, type BehindPlan } from "./behind-person.ts"`;
  - `import type { SourceProbe } from "./cutout-probe.ts"`;
  - `import type { CutoutRenderer } from "./cutout-render.ts"`.

  In `TimelineDeps`, `graphicJobs` takes the Pro setting, and the person cutouts' deps are declared once each. Task 11 wired `cutouts`, `sourceProbes` and `cutoutsDir`; keep a single declaration of each, with these types:

```ts
  /**
   * the graphics in force with their render jobs: the highlight service's, handed in because that service already
   * depends on this one; `pro` is the CapCut Pro setting the write read, which decides the groups at the top
   */
  graphicJobs?: (folder: string, rules: CutRules, options: HighlightViewOptions, pro?: boolean) => Promise<{ kept: PlacedGraphic[]; jobs: RenderJob[] }>
```

```ts
  /** the person cutouts: what the write waits for, the files it lays, and the head-cover samples (spec 0.5.0 §7, §10) */
  cutouts?: Pick<CutoutRenderer, "hashOf" | "wait" | "rendered" | "sample">
  /** the helper's reading of a source's frames and picture (cutout-probe.ts), read once per file as it is */
  sourceProbes?: { probe(path: string): Promise<SourceProbe | null> }
  /** where the boxblack-segment helper is, or null when this machine has none that runs: the app's route then cuts nothing */
  segmentHelper?: () => string | null
  /** where the person files are made (~/Movies/CapCut/BOXBLACK/cutouts): the bin entries for the ones a write no longer plays are taken out */
  cutoutsDir?: string
```

  Inside `createTimelineService`, right after `const now = …`:

```ts
  /**
   * The groups behind the person on a cut (planBehind), read with this service's helper. Without the renderer nothing
   * can be cut or sampled either, so it counts as no helper.
   */
  const behindOf = (cut: { stored: StoredOutline; plan: CutPlan; bin: BinVideo[]; fps: number }, placed: PlacedGroup[], flair: FlairOptions, pro: boolean): Promise<BehindPlan> =>
    planBehind({ ...cut, placed, flair, pro }, { segmentHelper: deps.cutouts ? deps.segmentHelper : undefined, sourceProbes: deps.sourceProbes })
```

  `compiled` answers the bin too:

```ts
    /** The confirmed outline cut under these rules, with its videos, frame size and frame rate, and the draft's media bin the write lays it from, for the highlight text service. */
    async compiled(folder: string, rules: CutRules) {
      const { stored, plan, clips } = await compile(folder, rules)
      const draft = await loadDraft(folder)
      return { stored, plan, clips, canvas: canvasOf(plan, draft), fps: draft.info.fps, bin: binVideos(draft.meta) }
    },

    /**
     * The groups among `placed` whose text goes behind the person, as the write lays them (planBehind): `cut` is the
     * confirmed outline's cut with the draft's bin and frame rate, as compiled() answers them, and `pro` the CapCut Pro
     * setting the caller read, which picks the route. The preview, the graphics, the graphics plan and the write all
     * ask here, so they place the same groups at the top.
     */
    behind: behindOf,
```

  The write places behind groups at the top. In `writeNow`, right after `const settings = await deps.settings.read()`:

```ts
    // the groups whose text goes behind the person sit at the top, as the preview placed them (spec §5.3)
    const behind = highlights ? await behindOf({ stored, plan: cutPlan, bin: binVideos(draft.meta), fps: draft.info.fps }, placed, highlights.flair, settings.capcut.pro) : null
```

  and inside the `laidOut` map:

```ts
          const placement = placementOf(byId.get(group.groupId)!, clips, highlights.position, subtitles !== null, behind?.top.has(group.groupId) ?? false)
```

  This is temporary: for now these groups are still drawn with the rest, in front. Task 15 rewrites `writeNow` to lay the person and draw them behind it.

- [ ] **Step 9: Show the behind groups in the preview.**

  In `apps/desktop/src/main/highlights.ts`, the imports gain:
  - `import type { BinVideo } from "@boxblack/core/capcut"`;
  - `CutoutView` in the `../shared/api.ts` import;
  - `import { standingOf, type BehindPlan, type CutoutStatus } from "./behind-person.ts"`;
  - `import type { CutoutRenderer } from "./cutout-render.ts"`.

  `HighlightDeps`:

```ts
  outlines: OutlineStore
  timeline: Pick<TimelineService, "compiled" | "behind">
```

  and, after `styleOf`. If Task 11 already declared `cutouts` here, keep one declaration, of this type:

```ts
  /** the person cutouts: what the preview starts, how each stands, a retry, and the head-cover samples (spec 0.5.0 §7, §10) */
  cutouts?: Pick<CutoutRenderer, "hashOf" | "ensure" | "statusOf" | "retry" | "sample">
```

  Add, above `view`:

```ts
  /**
   * How each group behind the person stands, and the counts (spec §9.4). On the app's route the preview is what starts
   * the cutting: the jobs of the groups it can cut replace the project's wanted set (ensure), so a job no longer wanted
   * is not started, and each group's jobs are asked how they stand. CapCut's route cuts nothing here.
   */
  async function behindStanding(behind: BehindPlan, folder: string): Promise<{ views: Map<string, CutoutView>; counts: HighlightPreview["behindPerson"] }> {
    const renderer = deps.cutouts
    renderer?.ensure(folder, behind.route === "ours" ? behind.groups.flatMap((group) => group.jobs) : [])
    const views = new Map<string, CutoutView>()
    const counts = { laid: 0, front: 0, pending: 0, covered: 0 }
    for (const group of behind.groups) {
      const statuses: CutoutStatus[] = renderer ? await Promise.all(group.jobs.map((job) => renderer.statusOf(renderer.hashOf(job)))) : group.jobs.map(() => ({ state: "waiting" as const }))
      const { view, bucket } = standingOf(group, behind.route, statuses)
      views.set(group.groupId, view)
      counts[bucket]++
    }
    return { views, counts }
  }
```

  `view` takes the bin after `fps`, works the behind plan out once, and uses it for the dodge, the graphics and the group views. In full:

```ts
  async function view(
    stored: StoredOutline,
    plan: CutPlan,
    clips: CutClip[],
    canvas: Canvas | null,
    fps: number,
    /** the draft's media bin, on which the frames the write lays the cut on are counted */
    bin: BinVideo[],
    options: HighlightViewOptions,
    /** the user has CapCut Pro: without it the exits and sounds that need it are held, and only the free ones offered; with it CapCut cuts the person out */
    pro: boolean,
    sounds: SoundEffect[],
    pictures: BinMedia[],
    said: Record<string, string>,
    folder: string,
  ): Promise<HighlightPreview> {
    const highlights = stored.highlights
    // what these options show, worked out once for the text and every kind of item, over the points placed on
    // this rough cut, where an item whose own moment the cut took out plays instead
    const points = placedPoints(stored, plan, clips)
    const show = showRulesOver(points, options)
    const placed = placeStored(stored, plan, clips, show)
    const timed = timeHighlights(placed, timelineOf(plan), plan.durationUs)
    const sources = new Map((highlights?.groups ?? []).map((group) => [group.id, group.source]))
    const pointIds = new Map((highlights?.groups ?? []).map((group) => [group.id, group.pointId]))
    const byId = new Map(placed.map((group) => [group.groupId, group]))
    // the custom style draws in bold-white's font, so its palette is beside the point here
    const font = styleFor(styleInForce(highlights), DEFAULT_HIGHLIGHT_OPTIONS.custom).font
    const frame = canvas ?? { width: 1080, height: 1920 }
    const looks = looksInForce(stored, shownLines(timed), options.flair, canvas, pro)
    // the exits the groups shown keep stored but that are not written without Pro
    const held = heldExits(stored, timed.map((group) => group.groupId), options.flair, pro)
    // the groups whose text goes behind the person, worked out once: where they sit, what the graphics keep clear of,
    // and how their cutting stands
    const behind = await deps.timeline.behind({ stored, plan, bin, fps }, placed, options.flair, pro)
    const dodgeOf = (group: TimedGroup) =>
      layoutGroup(
        group.lines.map((line) => line.text.trim()),
        font,
        frame,
        placementOf(byId.get(group.groupId)!, clips, options.position, options.subtitlesOn, behind.top.has(group.groupId)),
        looks[group.groupId]?.pattern,
      ).dodge
    const standing = await behindStanding(behind, folder)
    // the sounds, worked out once: what they hold back for want of Pro is counted below with the exits
    const sounded = soundView(stored, plan, timed, clips, sounds, options.flair, currentGroups(stored, clips), show, points, pro)
    const preview: Omit<HighlightPreview, "emphasis"> = {
      style: styleInForce(highlights),
      styleByAi: highlights?.styleByAi ?? null,
      groups: timed.map((group) => ({
        id: group.groupId,
        beatId: group.beatId,
        source: sources.get(group.groupId)!,
        ...(pointIds.get(group.groupId) !== undefined ? { pointId: pointIds.get(group.groupId)! } : {}),
        startUs: group.startUs,
        endUs: group.endUs,
        placement: dodgeOf(group),
        look: looks[group.groupId]!,
        ...(held[group.groupId] ? { heldExit: held[group.groupId]! } : {}),
        // the stored flag, whatever the switches, so the look menu shows what the group keeps
        behindPerson: stored.flair?.looks[group.groupId]?.behindPerson === true,
        ...(standing.views.has(group.groupId) ? { cutout: standing.views.get(group.groupId)! } : {}),
        lines: group.lines.map((line) => ({ index: line.lineIndex, text: line.text, startUs: line.startUs, partial: line.partial })),
        ...(byId.get(group.groupId)!.scene ? { scene: true as const } : {}),
      })),
      // while the text is on: stored groups bound to no point, or to a point that plays at a level that shows it,
      // which do not play themselves, since every word is cut or they were made on an earlier transcript
      hidden: show.text ? (highlights?.groups ?? []).filter((group) => show.passes(group.pointId)).length - timed.length : 0,
      outlineChanged: highlights?.beatsKey != null && highlights.beatsKey !== beatsKey(stored.outline.beats),
      needsPictures: options.position === "auto" && missingPictures(clips),
      landscape: isLandscape(canvas),
      ...sounded,
      ...zoomView(stored, plan, timed, clips, options.flair, show.passes),
      ...insertView(stored, plan, timed, clips, pictures, said, options.flair, show.passes, points),
      ...(await graphicView(stored, plan, clips, canvas, fps, options, show, points, folder, behind.top)),
      maxChars: maxHighlightChars(frame),
      exits: exitsFor(pro).map(({ id, name }) => ({ id, name })),
      // the sounds held back are the stored ones that would play here but for Pro
      proLeftOut: { exits: Object.keys(held).length, sounds: sounded.unusedSounds.pro },
      behindPerson: standing.counts,
      cutoutRoute: behind.route,
    }
    return {
      ...preview,
      // what plays on each point, as the lists above show it: a switched-off graphic plays nothing
      emphasis: emphasisView({
        stored,
        plan,
        clips,
        level: options.flair.level,
        items: {
          text: preview.groups.map((group) => group.pointId),
          zoom: preview.zooms.map((zoom) => zoom.pointId),
          insert: preview.inserts.map((insert) => insert.pointId),
          graphic: preview.graphics.filter((graphic) => !graphic.off).map((graphic) => graphic.pointId),
          sound: preview.cues.map((cue) => cue.pointId),
        },
      }),
    }
  }
```

  Change `graphicsOn`:
  - Add a parameter to the signature: `…, points: PlacedPoint[], top: ReadonlySet<string>)`.
  - Add a sentence to its doc: "A group whose text goes behind the person (`top`) is at the top, where the write puts it."
  - Its `textBands` call gains `top`:

```ts
    const bands = textBands({ placed, timed, clips, canvas, font, looks, position: options.position, subtitlesOn: options.subtitlesOn, top })
```

  `graphicView` takes `top: ReadonlySet<string>` after `folder` and hands it on: `graphicsOn(stored, plan, clips, canvas, options, show, points, top)`.

  `graphicJobs`:

```ts
  /**
   * The graphics in force under these rules and options, with their render jobs; the plan starts them, the write waits
   * for them. `pro` is the CapCut Pro setting the caller read, which decides the groups at the top and so where the
   * graphics keep clear of the text; read from settings when not given.
   */
  async function graphicJobs(folder: string, rules: CutRules, options: HighlightViewOptions, pro?: boolean): Promise<{ kept: PlacedGraphic[]; jobs: RenderJob[] }> {
    const { stored, plan, clips, canvas, fps, bin } = await deps.timeline.compiled(folder, rules)
    if (!canvas) return { kept: [], jobs: [] }
    const points = placedPoints(stored, plan, clips)
    const show = showRulesOver(points, options)
    const { top } = await deps.timeline.behind({ stored, plan, bin, fps }, placeStored(stored, plan, clips, show), options.flair, pro ?? (await deps.footage.settings.read()).capcut.pro)
    const { kept } = graphicsOn(stored, plan, clips, canvas, options, show, points, top)
    return { kept, jobs: await jobsOf(stored, kept, canvas, fps) }
  }
```

  The rest of the service:
  - `preview` destructures `bin` too (`const { plan, clips, canvas, fps, bin } = compiled`) and calls `view(stored, plan, clips, canvas, fps, bin, options, pro, …)`.
  - `pick` does the same (`const { stored, plan, clips, canvas, fps, bin } = await deps.timeline.compiled(folder, rules)`, and `view(next, plan, clips, canvas, fps, bin, options, pro, …)`).
  - `jobFor` passes the setting it read: `graphicJobs(folder, settings.cut, { … }, settings.capcut.pro)`.
  - Add, after `jobFor`:

```ts
    /**
     * Forgets the failed cutouts of a behind group, every piece of it, so the next preview cuts them again (like
     * retryGraphic): the page previews under the rules and options in settings, so under those the group's jobs are the
     * ones that failed. A group whose text is not behind the person there has none.
     */
    async retryCutout(folder: string, groupId: string): Promise<void> {
      const renderer = deps.cutouts
      if (!renderer) return
      const settings = await deps.footage.settings.read()
      const { stored, plan, clips, fps, bin } = await deps.timeline.compiled(folder, settings.cut)
      const options = { highlightsOn: settings.highlights.enabled, flair: settings.flair }
      const placed = placeStored(stored, plan, clips, showRulesOver(placedPoints(stored, plan, clips), options))
      const behind = await deps.timeline.behind({ stored, plan, bin, fps }, placed, settings.flair, settings.capcut.pro)
      for (const job of behind.groups.find((group) => group.groupId === groupId)?.jobs ?? []) renderer.retry(renderer.hashOf(job))
    },
```

- [ ] **Step 10: Show Claude the behind group's band at the top in the graphics plan.**

  In `apps/desktop/src/main/flair.ts`, `FlairDeps`:

```ts
  /** the cut, and which groups sit at the top because their text goes behind the person */
  timeline: Pick<TimelineService, "compiled" | "behind">
```

  In `planGraphics`, destructure `fps` and `bin` from `compiled`, and lay the bands out with the top groups:

```ts
      const { stored, plan, clips, canvas, fps, bin } = await deps.timeline.compiled(folder, rules)
```

```ts
      const font = styleFor(styleInForce(stored.highlights), DEFAULT_HIGHLIGHT_OPTIONS.custom).font
      // a group whose text goes behind the person sits at the top, as the preview and the write place it (spec §5.3)
      const { top } = await deps.timeline.behind({ stored, plan, bin, fps }, groups, view.flair, await deps.pro())
      const bands = textBands({ placed: groups, timed, clips, canvas, font, looks, position: view.position, subtitlesOn: view.subtitlesOn, top })
```

- [ ] **Step 11: The retry over IPC, and the wiring.**

  In `apps/desktop/src/main/highlight-api.ts`:
  - The `HighlightApi` pick list gains `| "retryCutout"`.
  - Add, after `retryGraphic`:

```ts
    async retryCutout(folder, groupId) {
      if (!folderOk(folder) || !idOk(groupId)) throw refuse()
      return highlights.retryCutout(folder, groupId)
    },
```

  In `apps/desktop/src/main/index.ts`:
  - `createTimelineService({…})`:
    - `graphicJobs` hands the setting on: `graphicJobs: (folder, rules, options, pro) => highlights.graphicJobs(folder, rules, options, pro),`
    - Add `segmentHelper`, with the same resolver Task 11 hands `createCutoutRenderer` as its `helper`.
    - Check that Task 11's `cutouts`, `sourceProbes` and `cutoutsDir` are there.
  - `createHighlightService({…})` has `cutouts: <Task 11's renderer>`; add it if Task 11 did not.

  Use the names Task 11 gave the renderer, the probes, the folder and the helper resolver.

- [ ] **Step 12: The renderer's fixtures.**

  In `apps/desktop/src/renderer/test/fake-api.ts`:
  - `highlightPreview()` gains `behindPerson: { laid: 0, front: 0, pending: 0, covered: 0 },` and `cutoutRoute: "ours",`. The fake settings have no CapCut Pro.
  - Each group of `highlightGroups()` gains `behindPerson: false,`.
  - The API gains `retryCutout: async () => {},` after `retryGraphic`.

  In `apps/desktop/src/renderer/src/screens/PostScreen.test.tsx`, the group built by `view()` (~:340) gains `behindPerson: false,`.

- [ ] **Step 13: Run the tests and see them pass.**

  Run: `npx vitest run apps/desktop/src/main apps/desktop/src/renderer`

  Expected: PASS.

- [ ] **Step 14: Commit.** Run `npm test` and `npm run typecheck`; both must be clean.

---

### Task 14: The head-cover warning

The warning is computed by one pure function, `coverOf`. The preview (here) and the write (Task 15) both call it, on the same inputs:
- the group's lines laid out at the top;
- the masks at its first, middle and last frame, sampled through `deps.cutouts.sample`, which caches on disk;
- the picture's place at each of those frames: the main piece's clip moved by its zoom (`zoomedPlace`, new in `zoom.ts`), from the `TimelineZoom`s the write hands `addZooms`.

The preview never waits for the samples. It asks once for each source and set of frames, keeps what comes back, and sends a `cutout` event so the page reads the preview again. It shows the warning once the masks are in.

**Files:**
- Modify: `packages/core/src/capcut/zoom.ts` (new `zoomedPlace`, beside `framesOf`)
- Modify: `apps/desktop/src/main/zoom-cues.ts` (`zoomsFor`, moved from timeline.ts)
- Modify: `apps/desktop/src/main/timeline.ts` (drop its own `zoomsFor` :306-325, import it)
- Modify: `apps/desktop/src/main/behind-person.ts` (`coverOf`, `sampleRequests`, `sourceKey`)
- Modify: `apps/desktop/src/main/highlights.ts` (`HighlightDeps.send`, the samples kept, `behindStanding`, `view`, `retryCutout`)
- Modify: `apps/desktop/src/main/index.ts` (`send` into `createHighlightService`)
- Test: `packages/core/src/capcut/zoom.test.ts`, `apps/desktop/src/main/behind-person.test.ts`, `apps/desktop/src/main/highlights.test.ts`

- [ ] **Step 1: Write the failing tests.**

  `packages/core/src/capcut/zoom.test.ts`:
  - Import `zoomedPlace` next to `addZooms`, and `import { valueAt } from "../cutout/keyframes.ts"`.
  - Add:

```ts
test("where the picture is at a moment of its zoom is where CapCut plays the keyframes addZooms writes", async () => {
  const info = addZooms(await roughCut(), [punch, drift]).info
  const moments: [TimelineZoom, number[]][] = [
    [punch, [0, 500_000, 1_000_000, 1_175_000, 1_350_000, 3_000_000, 4_000_000]],
    [drift, [0, 2_500_000, 5_000_000]],
  ]
  for (const [zoom, times] of moments) {
    const segment = info.tracks[0]!.segments[zoom.cut]!
    for (const atUs of times) {
      // the keyframes are timed in the piece's source file
      const at = segment.source_timerange!.start + atUs
      const place = zoomedPlace(segment.clip, zoom, atUs)
      expect(place.scale, `${zoom.kind} scale at ${atUs}`).toBeCloseTo(valueAt(of(segment, "KFTypeScaleX").keyframe_list, at), 9)
      expect(place.x, `${zoom.kind} x at ${atUs}`).toBeCloseTo(valueAt(of(segment, "KFTypePositionX").keyframe_list, at), 9)
      expect(place.y, `${zoom.kind} y at ${atUs}`).toBeCloseTo(valueAt(of(segment, "KFTypePositionY").keyframe_list, at), 9)
    }
  }
})

test("a zoom moves a clip already moved: flat before it starts, a straight line up, held after its last key; no zoom is the clip as it is", () => {
  const clip = { scale: { x: 0.8, y: 0.8 }, transform: { x: 0.1, y: -0.2 } }
  expect(zoomedPlace(clip, null, 1_000_000)).toEqual({ scale: 0.8, x: 0.1, y: -0.2 })
  expect(zoomedPlace(null, null, 0)).toEqual({ scale: 1, x: 0, y: 0 })
  expect(zoomedPlace(clip, punch, 500_000)).toEqual({ scale: 0.8, x: 0.1, y: -0.2 })
  // halfway up the punch, 1 → 1.15 over 350 ms from 1 s; the face at +0.4 held still
  const half = zoomedPlace(clip, punch, 1_175_000)
  expect(half.scale).toBeCloseTo(0.8 * 1.075, 9)
  expect(half.y).toBeCloseTo(-0.2 + 0.4 * (1 - 1.075), 9)
  expect(zoomedPlace(clip, punch, 3_999_999).scale).toBeCloseTo(0.8 * 1.15, 9)
  // past the drift's last key CapCut holds it
  expect(zoomedPlace(clip, drift, 7_000_000).scale).toBeCloseTo(0.8 * 1.08, 9)
})
```

  `apps/desktop/src/main/behind-person.test.ts`:
  - Imports:
    - `import type { TimelineZoom } from "@boxblack/core/capcut/zoom"` and `import { zoomedPlace } from "@boxblack/core/capcut/zoom"`;
    - `import { COVERED_LIMIT, type LineBox, type SampleMask } from "@boxblack/core/cutout"`;
    - `import { layoutGroup, LINE_WIDTH_RATIO, textUnits } from "@boxblack/core/highlights"`;
    - `import { TOP_PLACEMENT } from "./highlight-state.ts"`;
    - `coverOf` and `sampleRequests` added to the `./behind-person.ts` import.
  - Add:

```ts
const PORTRAIT = { width: 1080, height: 1920 }
const SOURCE = { path: "/footage/IMG_9646.MOV", size: 1, mtimeMs: 1 }
const MASK: SampleMask = { width: 9, height: 16, data: new Uint8Array(9 * 16) }

/** A behind group on the first piece, its lines each from their time, sampled at `frames` of one source. */
function sampled(lines: [text: string, startUs: number][], frames: number[]): BehindGroup {
  return {
    groupId: "g",
    timed: { groupId: "g", beatId: "b", startUs: lines[0]![1], endUs: 3_000_000, lines: lines.map(([text, startUs], lineIndex) => ({ lineIndex, text, startUs, partial: false })) },
    ranges: [],
    slivers: 0,
    block: null,
    jobs: [],
    samples: frames.map((frame) => ({ frame, cut: 0, atUs: Math.floor((frame * 1_000_000) / 30), source: SOURCE, pts: 20 * frame })),
  }
}

test("the head-cover warning measures each line where the layout draws it at the top, against the picture as zoomed, at the frames it is on screen", () => {
  const group = sampled([["ลด", 0], ["ครึ่งราคา", 1_000_000]], [0, 35, 70])
  const zoom: TimelineZoom = { cut: 0, kind: "punch", atUs: 1_000_000, durationUs: 3_000_000, faceY: 0.4 }
  const asked: { box: LineBox; place: { scale: number; x: number; y: number } }[] = []
  const share = (_mask: SampleMask, box: LineBox, place: { scale: number; x: number; y: number }) => {
    asked.push({ box, place })
    return 0
  }
  expect(coverOf({ group, pattern: "stair", font: "kanit", canvas: PORTRAIT, fps: 30, zooms: [zoom], clipOf: () => null, maskAt: () => MASK, share })).toBe(false)
  const laid = layoutGroup(["ลด", "ครึ่งราคา"], "kanit", PORTRAIT, TOP_PLACEMENT, "stair").lines
  const box = (i: number, text: string): LineBox => ({
    centreX: laid[i]!.x,
    centreY: laid[i]!.y,
    width: textUnits(text, "kanit") * LINE_WIDTH_RATIO * laid[i]!.scale,
    height: (LINE_WIDTH_RATIO * laid[i]!.scale * PORTRAIT.width) / PORTRAIT.height,
  })
  // the first line at all three frames; the second, on screen from 1 s (frame 30), at the last two
  expect(asked.map((entry) => entry.box)).toEqual([box(0, "ลด"), box(0, "ลด"), box(0, "ลด"), box(1, "ครึ่งราคา"), box(1, "ครึ่งราคา")])
  // the picture before the punch, as it rises, and after it lands
  expect(asked.map((entry) => entry.place)).toEqual([0, 1_166_666, 2_333_333, 1_166_666, 2_333_333].map((atUs) => zoomedPlace(null, zoom, atUs)))
})

test("a line covered by more than 35% at any sampled frame counts the group, 35% does not; a frame whose mask is not in leaves it unmeasured", () => {
  const group = sampled([["ลด", 0]], [0, 45, 89])
  const cover = (share: number, maskAt: () => SampleMask | undefined = () => MASK) =>
    coverOf({ group, pattern: undefined, font: "kanit", canvas: PORTRAIT, fps: 30, zooms: [], clipOf: () => null, maskAt, share: () => share })
  expect(COVERED_LIMIT).toBe(0.35)
  expect(cover(0.35)).toBe(false)
  expect(cover(0.36)).toBe(true)
  expect(cover(0.9, () => undefined)).toBeNull()
})

test("the frames to sample are asked for by source, each source once, each frame once", () => {
  const other = { ...SOURCE, path: "/footage/other.MOV" }
  const a = sampled([["ลด", 0]], [0, 45])
  const b = { ...sampled([["ราคา", 0]], [45, 89]), groupId: "h" }
  b.samples[1] = { ...b.samples[1]!, source: other }
  expect([...sampleRequests([a, b]).values()]).toEqual([
    { source: SOURCE, pts: [0, 900] },
    { source: other, pts: [1780] },
  ])
})
```

  In `apps/desktop/src/main/highlights.test.ts`:
  - `withHighlights` keeps the events the service sends, and returns them:
    - `const events: AppEvent[] = []` above the service;
    - `send: (event) => events.push(event),` in `createHighlightService({…})`;
    - `events` added to its answer;
    - `AppEvent` imported from `../shared/api.ts`.
  - Import `EMPTY_MASK` and `FULL_MASK` from the fixture.
  - Add, after the retry test:

```ts
/** Lets what the renderer answered land: the preview keeps it for the next look. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

test("the head-cover warning shows once the person's masks at the group's sampled frames are in, and counts the group; the preview never waits for them", async () => {
  const { highlights, folder, outlines, cutouts, events } = await withHighlights({ pro: false, cutouts: {} })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(outlines, folder, "id1")
  cutouts!.mask = FULL_MASK
  const first = await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)
  expect(first.groups[0]!.cutout).toEqual({ state: "waiting" })
  expect(first.behindPerson.covered).toBe(0)
  // it asked for the group's first, middle and last frames on screen, all of one source
  expect(cutouts!.sampled.map((request) => request.pts.length)).toEqual([3])
  await settle()
  // and told the page, which reads the preview again
  expect(events).toContainEqual({ type: "cutout", folder, hash: "", state: "done" })
  const second = await highlights.preview(folder, DEFAULT_CUT_RULES, BEHIND)
  expect(second.groups[0]!.cutout).toEqual({ state: "waiting", covered: true, coverChecked: true })
  expect(second.behindPerson).toEqual({ laid: 0, front: 0, pending: 1, covered: 1 })
  // asked once: the second look used what came back
  expect(cutouts!.sampled).toHaveLength(1)
})

test("a group the head covers little has no warning, and one whose frames could not be sampled says it was not checked, until a retry asks again", async () => {
  const clear = await withHighlights({ pro: false, cutouts: {} })
  await clear.highlights.pick(clear.folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(clear.outlines, clear.folder, "id1")
  await clear.highlights.preview(clear.folder, DEFAULT_CUT_RULES, BEHIND)
  await settle()
  expect((await clear.highlights.preview(clear.folder, DEFAULT_CUT_RULES, BEHIND)).groups[0]!.cutout).toEqual({ state: "waiting", covered: false, coverChecked: true })

  const broken = await withHighlights({ pro: false, cutouts: {} })
  broken.cutouts!.sampleFails = true
  await broken.highlights.pick(broken.folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(broken.outlines, broken.folder, "id1")
  await broken.highlights.preview(broken.folder, DEFAULT_CUT_RULES, BEHIND)
  await settle()
  expect((await broken.highlights.preview(broken.folder, DEFAULT_CUT_RULES, BEHIND)).groups[0]!.cutout).toEqual({ state: "waiting", coverChecked: false })
  // a sample that failed is not asked again on every look
  expect(broken.cutouts!.sampled).toHaveLength(1)
  broken.cutouts!.sampleFails = false
  await broken.highlights.retryCutout(broken.folder, "id1")
  await broken.highlights.preview(broken.folder, DEFAULT_CUT_RULES, BEHIND)
  expect(broken.cutouts!.sampled).toHaveLength(2)
})

test("on CapCut's route the cover is measured when the helper is here, and said to be unchecked when it is not", async () => {
  const unchecked = await withHighlights()
  await unchecked.highlights.pick(unchecked.folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(unchecked.outlines, unchecked.folder, "id1")
  expect((await unchecked.highlights.preview(unchecked.folder, DEFAULT_CUT_RULES, BEHIND)).groups[0]!.cutout).toEqual({ state: "capcut", coverChecked: false })

  const measured = await withHighlights({ cutouts: {} })
  measured.cutouts!.mask = FULL_MASK
  await measured.highlights.pick(measured.folder, DEFAULT_CUT_RULES, VIEW)
  await behindOn(measured.outlines, measured.folder, "id1")
  await measured.highlights.preview(measured.folder, DEFAULT_CUT_RULES, BEHIND)
  await settle()
  const preview = await measured.highlights.preview(measured.folder, DEFAULT_CUT_RULES, BEHIND)
  expect(preview.groups[0]!.cutout).toEqual({ state: "capcut", covered: true, coverChecked: true })
  expect(preview.behindPerson).toEqual({ laid: 1, front: 0, pending: 0, covered: 1 })
  // nothing is cut on the app's side
  expect(measured.cutouts!.ensured.at(-1)![1]).toEqual([])
})
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run: `npx vitest run packages/core/src/capcut/zoom.test.ts apps/desktop/src/main/behind-person.test.ts apps/desktop/src/main/highlights.test.ts`

  Expected: FAIL. `zoomedPlace`, `coverOf` and `sampleRequests` do not exist, and the preview measures nothing and sends nothing.

- [ ] **Step 3: Implement `zoomedPlace`.**

  In `packages/core/src/capcut/zoom.ts`, below `sourceTime`:

```ts
/** A zoom's own scale `atUs` into its piece: the first key's before it, the last key's after it (CapCut holds them), a straight line between ("Line"). */
function scaleAt(zoom: TimelineZoom, atUs: number): number {
  const frames = framesOf(zoom)
  const first = frames[0]!
  const last = frames.at(-1)!
  if (atUs <= first.at) return first.scale
  if (atUs >= last.at) return last.scale
  const after = frames.findIndex((frame) => frame.at > atUs)
  const from = frames[after - 1]!
  const to = frames[after]!
  return from.scale + ((to.scale - from.scale) * (atUs - from.at)) / (to.at - from.at)
}

/**
 * Where a piece's picture is `atUs` into it (µs as it plays), as CapCut plays the keyframes addZooms writes for `zoom`:
 * the clip's scale times the zoom's, x where the clip has it, y moved so the face stays put. Without a zoom (or with
 * one of no length, which addZooms leaves out) the clip as it is. The head-cover warning (spec 0.5.0 §10) measures the
 * person's mask with it. At speed 1 the keyframes' source times and the moment asked for share the piece's source
 * start, so the moment into the piece is all that is needed.
 */
export function zoomedPlace(clip: unknown, zoom: TimelineZoom | null, atUs: number): { scale: number; x: number; y: number } {
  const own = clip as { scale?: { x?: number }; transform?: { x?: number; y?: number } } | null | undefined
  const base = own?.scale?.x ?? 1
  const x = own?.transform?.x ?? 0
  const y = own?.transform?.y ?? 0
  if (!zoom || zoom.durationUs <= 0) return { scale: base, x, y }
  const z = scaleAt(zoom, atUs)
  // `|| 0` as addZooms writes it: no negative zero
  return { scale: base * z, x, y: y + zoom.faceY * (1 - z) || 0 }
}
```

- [ ] **Step 4: Move `zoomsFor` where the preview can reach it.**

  In `apps/desktop/src/main/zoom-cues.ts`:
  - Add to the imports:
    - `import type { TimelineZoom } from "@boxblack/core/capcut/zoom"`;
    - `timeHighlights` and `type PlacedGroup` in the `@boxblack/core/highlights` import (with `type TimedGroup`);
    - `import type { StoredOutline } from "../shared/api.ts"`;
    - `import { timelineOf } from "./highlight-state.ts"`.
  - Move `zoomsFor` out of `timeline.ts` (~:306-325) unchanged, only exported:

```ts
/**
 * The zooms that play, ready for the keyframe writer, and how many stored zooms lost their piece: the write lays them
 * (addZooms), and the head-cover warning measures the picture as they move it.
 */
export function zoomsFor(stored: StoredOutline, plan: CutPlan, placed: PlacedGroup[], clips: CutClip[], flair: FlairOptions, passes: PointFilter): { zooms: TimelineZoom[]; lost: number } {
  if (!flair.zoom) return { zooms: [], lost: 0 }
  const at = timelineOf(plan)
  const timed = timeHighlights(placed, at, plan.durationUs)
  const slots = zoomSlotsFor({ plan, groups: timed, beatNames: new Map(stored.outline.beats.map((beat) => [beat.id, beat.name])), at })
  const { kept, lost } = zoomsInForce({ zooms: stored.flair?.zooms ?? [], slots, flair, durationUs: plan.durationUs, passes })
  const byAnchor = new Map(slots.map((slot) => [pieceKey(slot.anchor), slot]))
  const zooms = kept.map((zoom) => {
    const slot = byAnchor.get(pieceKey(zoom.cue.anchor))!
    return {
      cut: slot.cut,
      kind: zoom.cue.kind,
      atUs: punchAtUs(slot, timed),
      durationUs: zoom.durationUs,
      faceY: faceYOf(clips, zoom.cue.anchor, zoom.durationUs),
    }
  })
  return { zooms, lost }
}
```

  In `timeline.ts`:
  - Delete the local `zoomsFor`.
  - Import it: `import { faceYOf, pieceKey, punchAtUs, zoomSlotsFor, zoomsFor, zoomsInForce } from "./zoom-cues.ts"`. Drop any of the old names that are then unused.

- [ ] **Step 5: Implement `coverOf` and the sample helpers.**

  In `apps/desktop/src/main/behind-person.ts`, extend the imports:
  - `import { frameToUs, usToFrame } from "@boxblack/core/capcut/time"`;
  - `import { zoomedPlace, type TimelineZoom } from "@boxblack/core/capcut/zoom"`;
  - `coveredShare`, `COVERED_LIMIT`, `type LineBox` and `type SampleMask` in the `@boxblack/core/cutout` import;
  - `type TextPattern` in the `@boxblack/core/flair/catalogue` import;
  - `layoutGroup`, `LINE_WIDTH_RATIO` and `textUnits` in the `@boxblack/core/highlights` import;
  - `import type { HighlightFontId } from "@boxblack/core/highlights/styles"`;
  - `import { TOP_PLACEMENT } from "./highlight-state.ts"`.

  Then add:

```ts
/** A source file as a hash names it: its path, size and time. */
export const sourceKey = (source: CutoutJob["source"]): string => JSON.stringify([source.path, source.size, source.mtimeMs])

/** The frames to sample for these groups, by source (sourceKey): each source once, with each of its frames once. */
export function sampleRequests(groups: BehindGroup[]): Map<string, { source: CutoutJob["source"]; pts: number[] }> {
  const requests = new Map<string, { source: CutoutJob["source"]; pts: number[] }>()
  for (const point of groups.flatMap((group) => group.samples)) {
    const key = sourceKey(point.source)
    const request = requests.get(key) ?? { source: point.source, pts: [] }
    if (!request.pts.includes(point.pts)) request.pts.push(point.pts)
    requests.set(key, request)
  }
  return requests
}

/**
 * Whether the person covers a behind group's text too much to read (spec §10). Each line's box is where the layout
 * draws it at the top (TOP_PLACEMENT, the group's pattern): its middle, its scale and the stair's step aside, as wide
 * as its text (textUnits × LINE_WIDTH_RATIO × scale) and as tall as a line of the font at that scale. It is measured
 * against the person's mask at each sampled frame by which the line is on screen, the mask put where the picture is
 * then: the main piece's clip, moved by its zoom (zoomedPlace). A line covered by more than COVERED_LIMIT at any of
 * them counts the group. Null while a sampled frame's mask is not in (`maskAt` answers none).
 */
export function coverOf(input: {
  group: BehindGroup
  /** the group's pattern in force (looksInForce); the plain stack when none */
  pattern: TextPattern | undefined
  font: HighlightFontId
  canvas: { width: number; height: number }
  fps: number
  /** the zooms the write lays (zoomsFor), each on its piece */
  zooms: TimelineZoom[]
  /** a main piece's clip: the written segment's; none for the preview, where every piece plays at the clip the rough cut gives it */
  clipOf: (cut: number) => unknown
  maskAt: (point: SamplePoint) => SampleMask | undefined
  /** the share of a box the mask covers; coveredShare, or a stand-in for the tests of the geometry */
  share?: typeof coveredShare
}): boolean | null {
  const share = input.share ?? coveredShare
  const texts = input.group.timed.lines.map((line) => line.text.trim())
  const { lines } = layoutGroup(texts, input.font, input.canvas, TOP_PLACEMENT, input.pattern)
  let covered = false
  for (const [i, laid] of lines.entries()) {
    const box: LineBox = {
      centreX: laid.x,
      centreY: laid.y,
      width: textUnits(texts[i]!, input.font) * LINE_WIDTH_RATIO * laid.scale,
      height: (LINE_WIDTH_RATIO * laid.scale * input.canvas.width) / input.canvas.height,
    }
    // a line is only measured at the frames it is on screen by
    const from = usToFrame(input.group.timed.lines[i]!.startUs, input.fps)
    for (const point of input.group.samples) {
      if (point.frame < from) continue
      const mask = input.maskAt(point)
      if (!mask) return null
      // the first zoom on the piece, as addZooms keeps it
      const zoom = input.zooms.find((candidate) => candidate.cut === point.cut && candidate.durationUs > 0) ?? null
      if (share(mask, box, zoomedPlace(input.clipOf(point.cut), zoom, point.atUs), input.canvas) > COVERED_LIMIT) covered = true
    }
  }
  return covered
}
```

- [ ] **Step 6: Measure in the preview.**

  In `apps/desktop/src/main/highlights.ts`:
  - Extend the imports:
    - `import type { SampleMask } from "@boxblack/core/cutout"`;
    - `AppEvent` in the `../shared/api.ts` import;
    - `coverOf`, `sampleRequests`, `sourceKey`, `type BehindGroup` and `type SamplePoint` in the `./behind-person.ts` import;
    - `zoomsFor` in the `./zoom-cues.ts` import.
  - `HighlightDeps` gains:

```ts
  /** tells the page a head-cover sample the preview asked for is in, so it reads the preview again */
  send?: (event: AppEvent) => void
```

  Above `createHighlightService`:

```ts
/** How many head-cover samples the preview keeps in memory; the renderer keeps them all on disk. */
const SAMPLES_KEPT = 500
```

  Inside the service, above `behindStanding`:

```ts
  /** The head-cover samples asked for, by source and frames: the masks once in, or how the asking stands. */
  const samples = new Map<string, Map<number, SampleMask> | "pending" | "failed">()
  const remember = (key: string, value: Map<number, SampleMask> | "pending" | "failed") => {
    samples.delete(key)
    samples.set(key, value)
    // the oldest go first: the page asks about what it shows now
    while (samples.size > SAMPLES_KEPT) samples.delete(samples.keys().next().value!)
  }
  /** Each request of a group's samples, named as `samples` keeps them. */
  const sampleKeys = (group: BehindGroup) => [...sampleRequests([group])].map(([key, request]) => ({ key: JSON.stringify([key, request.pts]), request }))

  /**
   * The masks at a group's sampled frames, or how asking for them stands. The preview never waits for Vision: what is
   * not asked for yet is asked for now (samples come before any cutting in the renderer's queue), and when it comes
   * back the page is told, so it reads the preview again. A sample that failed is not asked again on every look:
   * only a retry of the group asks again.
   */
  function masksOf(folder: string, group: BehindGroup): ((point: SamplePoint) => SampleMask | undefined) | "pending" | "failed" {
    const renderer = deps.cutouts!
    const got = new Map<string, Map<number, SampleMask>>()
    let pending = false
    for (const { key, request } of sampleKeys(group)) {
      let known = samples.get(key)
      if (known === undefined) {
        known = "pending"
        remember(key, known)
        // the page reads the preview again on any cutout event; an empty hash names no file, since a sample is none
        const told = () => deps.send?.({ type: "cutout", folder, hash: "", state: "done" })
        void renderer.sample(request).then(
          (masks) => (remember(key, masks), told()),
          () => (remember(key, "failed"), told()),
        )
      }
      if (known === "failed") return "failed"
      if (known === "pending") pending = true
      else got.set(sourceKey(request.source), known)
    }
    if (pending) return "pending"
    return (point) => got.get(sourceKey(point.source))?.get(point.pts)
  }
```

  `behindStanding` gains the warning. Replace it:

```ts
  /**
   * How each group behind the person stands, the head-cover warning of each that goes or may yet go behind it
   * (`cover`), and the counts (spec §9.4). On the app's route the preview is what starts the cutting: the jobs of the
   * groups it can cut replace the project's wanted set (ensure), so a job no longer wanted is not started, and each
   * group's jobs are asked how they stand. CapCut's route cuts nothing here.
   */
  async function behindStanding(
    behind: BehindPlan,
    folder: string,
    cover: (group: BehindGroup) => Pick<CutoutView, "covered" | "coverChecked">,
  ): Promise<{ views: Map<string, CutoutView>; counts: HighlightPreview["behindPerson"] }> {
    const renderer = deps.cutouts
    renderer?.ensure(folder, behind.route === "ours" ? behind.groups.flatMap((group) => group.jobs) : [])
    const views = new Map<string, CutoutView>()
    const counts = { laid: 0, front: 0, pending: 0, covered: 0 }
    for (const group of behind.groups) {
      const statuses: CutoutStatus[] = renderer ? await Promise.all(group.jobs.map((job) => renderer.statusOf(renderer.hashOf(job)))) : group.jobs.map(() => ({ state: "waiting" as const }))
      const { view, bucket } = standingOf(group, behind.route, statuses)
      // text drawn in front of the person is covered by nothing
      const measured = bucket === "front" ? {} : cover(group)
      views.set(group.groupId, { ...view, ...measured })
      counts[bucket]++
      if (measured.covered) counts.covered++
    }
    return { views, counts }
  }
```

  In `view`, the `standing` line becomes:

```ts
    // the head-cover warning (spec §10), measured on the zooms the write lays once the masks at the group's sampled
    // frames are in; the preview never waits for them
    const zooms = behind.groups.some((group) => group.samples.length > 0) ? zoomsFor(stored, plan, placed, clips, options.flair, show.passes).zooms : []
    const cover = (group: BehindGroup): Pick<CutoutView, "covered" | "coverChecked"> => {
      if (!canvas || !behind.cut) return {}
      if (group.samples.length === 0 || !deps.cutouts) return { coverChecked: false }
      const masks = masksOf(folder, group)
      if (masks === "pending") return {}
      if (masks === "failed") return { coverChecked: false }
      // every main piece of the rough cut plays at the clip it is built with: the picture is moved by its zoom alone
      const covered = coverOf({ group, pattern: looks[group.groupId]?.pattern, font, canvas, fps: behind.cut.fps, zooms, clipOf: () => null, maskAt: masks })
      return covered === null ? {} : { covered, coverChecked: true }
    }
    const standing = await behindStanding(behind, folder, cover)
```

  `retryCutout` also forgets the group's failed samples. Its last line becomes:

```ts
      const group = behind.groups.find((candidate) => candidate.groupId === groupId)
      for (const job of group?.jobs ?? []) renderer.retry(renderer.hashOf(job))
      // a head-cover sample that failed is asked again by the next preview too
      for (const { key } of group ? sampleKeys(group) : []) if (samples.get(key) === "failed") samples.delete(key)
```

  In `apps/desktop/src/main/index.ts`, `createHighlightService({…})` gains `send,`.

- [ ] **Step 7: Run the tests and see them pass.**

  Run: `npx vitest run packages/core/src/capcut apps/desktop/src/main`

  Expected: PASS. Some Task 13 tests look at `cutout.state` or use `toMatchObject`; that is so that the warning's fields added here leave them as they were.

- [ ] **Step 8: Commit.** Run `npm test` and `npm run typecheck`; both must be clean.

---

### Task 15: The write — the person behind its text, in the order CapCut layers the tracks

`writeNow` is rewritten in full.
- It reads the settings once at the start.
- It waits for the graphics, then (on the app's route) the cutout jobs of the behind groups at this level, and on both routes the head-cover samples, all before the draft is read.
- It lays the highlight text in two passes: first the groups whose person is laid, then the rest.
- It writes the person (the app's files) or CapCut's matting copies after the zooms.
- At the end it puts every track in the order of spec §9.1 with `arrangeTracks`.
- The result gains `behindPerson` and `dropped.cutouts`.
- The bin gets an entry for each person file, and the write prunes both rendered folders.

**Files:**
- Modify: `apps/desktop/src/shared/api.ts` (`WriteResult` :812-843)
- Modify: `apps/desktop/src/main/timeline.ts` (imports, `tally` :109-126, new `waitForBehind`, `writeNow` :395-601)
- Modify: `apps/desktop/src/renderer/src/screens/WriteScreen.tsx` (:35 `DROPPED_NAMES`), `apps/desktop/src/renderer/src/i18n.ts`, `apps/desktop/src/renderer/test/fake-api.ts` (write result ~:348-364), `apps/desktop/src/renderer/src/screens/WriteScreen.test.tsx` (~:612)
- Test: `apps/desktop/src/main/timeline.test.ts`, `apps/desktop/src/main/highlights.test.ts` (~:323-357)

- [ ] **Step 1: Write the failing tests.**

  In `apps/desktop/src/main/timeline.test.ts`, first the imports:
  - `import type { DraftInfo, DraftMeta, Segment } from "@boxblack/core/capcut"` (replacing the `DraftMeta` import);
  - `import { PERSON_SOURCE_START_US, valueAt } from "@boxblack/core/cutout"`;
  - `import { DEFAULT_LOOK } from "@boxblack/core/flair/plan"`;
  - `import { BUILT_IN_SOUNDS } from "@boxblack/core/flair/sound-catalogue"`;
  - `import { layoutGroup } from "@boxblack/core/highlights"`;
  - `HIGHLIGHT_STYLES` in the `@boxblack/core/highlights/styles` import;
  - `import type { SubtitleRequest } from "../shared/api.ts"` (beside `AppEvent`);
  - `import type { CutoutJob } from "./cutout-render.ts"`;
  - `import { TOP_PLACEMENT } from "./highlight-state.ts"` (beside `beatsKey`);
  - `FULL_MASK` and `type CutoutOutcome` in the `./timeline-fixture.ts` import.

  Then these existing tests change. The layer order is the order of `tracks[]`, not `render_index`.
  - In "the write waits for the graphics in force…" (~:718-723), replace the lines from `const info` to the second `render_index` check with:

```ts
  const info = await readInfo(folder)
  const [cutaways, graphics] = overlays(info)
  // CapCut layers by the order of tracks[]: the graphics right over the cutaways, and nothing written over them here
  expect(info.tracks.indexOf(graphics!)).toBe(info.tracks.indexOf(cutaways!) + 1)
  expect(info.tracks.at(-1)).toBe(graphics)
  const [segment] = graphics!.segments
  // every segment's track_render_index is its track's place
  info.tracks.forEach((track, i) => track.segments.forEach((entry) => expect(entry.track_render_index).toBe(i)))
```

  - In "cutaways that overlap…" (~:1166-1173) and "graphics that overlap…" (~:1181-1186):
    - `const tracks = overlays(info)` reads its `info` first. In the graphics test that is `const info = await readInfo(folder)`, then `const tracks = overlays(info)`.
    - The `render_index` lines become:

```ts
  // the later one on the track right above the earlier, as CapCut layers tracks[]
  expect(info.tracks.indexOf(tracks[1]!)).toBe(info.tracks.indexOf(tracks[0]!) + 1)
  expect([lower!.track_render_index, upper!.track_render_index]).toEqual([info.tracks.indexOf(tracks[0]!), info.tracks.indexOf(tracks[1]!)])
```

  - The tally test counts the cutouts too:

```ts
test("the result counts what each writer placed and left out from that writer's own answer, and nothing for a writer that did not run", () => {
  // each writer was sent more than it placed, and no two answer alike
  const laid = { sounds: { kept: 1, dropped: 2 }, zooms: { kept: 3, dropped: 4 }, inserts: { kept: 5, dropped: 6 }, graphics: { kept: 7, dropped: 8 }, cutouts: { kept: 9, dropped: 10 } }
  expect(tally(laid)).toEqual({ soundCount: 1, zoomCount: 3, insertCount: 5, graphicCount: 7, dropped: { sounds: 2, zooms: 4, inserts: 6, graphics: 8, cutouts: 10 } })
  expect(tally({ inserts: { kept: 2, dropped: 1 } })).toEqual({ soundCount: 0, zoomCount: 0, insertCount: 2, graphicCount: 0, dropped: { sounds: 0, zooms: 0, inserts: 1, graphics: 0, cutouts: 0 } })
})
```

  - In "the graphics are asked for with the subtitles the write lays down…" (~:1042, :1044), the write now hands the Pro setting it read (the harness has Pro), so both `toHaveBeenLastCalledWith(…)` calls gain a last argument `true`.

  Then add at the end of the file:

```ts
/* text behind the person */

const ASSETS = { fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`, animationPath: async (id: string) => `/effect/${id}/hash` }

/**
 * The fixture with the person cutouts' fakes and highlight text the user made:
 * - ขึ้นไป (words 0–1), on the first piece;
 * - ใน (word 4), which stays up into the second piece until the countdown's text starts;
 * - the second countdown (words 8–10), on the second piece.
 * `behind` names the groups whose text goes behind the person (g1 unless said). The text looks and the switch are
 * on, and the harness has CapCut Pro unless `pro` says not.
 */
async function withBehind(options: { pro?: boolean; outcome?: (job: CutoutJob) => CutoutOutcome; behind?: string[]; extra?: Parameters<typeof setup>[0] } = {}) {
  const context = await setup({ highlightAssets: ASSETS, pro: options.pro, cutouts: { outcome: options.outcome }, ...options.extra })
  await withGroups(context, transcript, [countdown], [
    { id: "g1", lines: [{ from: 0, to: 2, text: "ขึ้นไป" }] },
    { id: "g3", lines: [{ from: 4, to: 5, text: "ใน" }] },
    { id: "g2", lines: [{ from: 8, to: 11, text: "สามสองหนึ่ง" }] },
  ])
  const behind = options.behind ?? ["g1"]
  await context.outlines.update(context.folder, (stored) => ({
    ...stored!,
    flair: { ...(stored!.flair ?? { looks: {} }), looks: Object.fromEntries(behind.map((id) => [id, { ...DEFAULT_LOOK, behindPerson: true }])) },
  }))
  const flair: FlairOptions = { enabled: true, level: "medium", text: true, sound: false, zoom: false, insert: false, graphic: false, behindPerson: true }
  const write = async (changes: Partial<FlairOptions> = {}, subtitles: SubtitleRequest | null = null) =>
    context.service.write(context.folder, DEFAULT_CUT_RULES, segments(await readInfo(context.folder)), subtitles, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 3, flair: { ...flair, ...changes } })
  return { ...context, cutouts: context.cutouts!, cutoutsDir: context.deps.cutoutsDir!, flair, write }
}

/** Each track of a written draft by what it holds, bottom to top: CapCut layers them in this order (spec §9.1). */
function layersOf(info: DraftInfo, dirs: { cutouts: string; graphics?: string }): string[] {
  const videos = info.materials.videos as { id: string; path: string; matting?: { flag?: number } }[]
  const texts = info.materials.texts as { id: string; content: string }[]
  return info.tracks.map((track, i) => {
    if (i === 0) return "main"
    const [first] = track.segments
    if (track.type === "audio") return "sound"
    if (track.type === "sticker") return "bars"
    if (track.type === "text") return track.flag === 1 ? "subtitles" : `text ${JSON.parse(texts.find((text) => text.id === first!.material_id)!.content).text}`
    const material = videos.find((video) => video.id === first!.material_id)!
    if (material.path.startsWith(dirs.cutouts)) return "person"
    if (material.matting?.flag === 3) return "person (CapCut)"
    if (dirs.graphics && material.path.startsWith(dirs.graphics)) return "graphic"
    return "cutaway"
  })
}

/** The segment a written draft shows a text in. */
const textSegment = (info: DraftInfo, text: string): Segment => {
  const material = (info.materials.texts as { id: string; content: string }[]).find((entry) => JSON.parse(entry.content).text === text)!
  return info.tracks.flatMap((track) => track.segments).find((segment) => segment.material_id === material.id)!
}
const keysOf = (segment: Segment, property: string) => (segment.common_keyframes ?? []).find((entry) => entry.property_type === property)!.keyframe_list
/** The video overlay tracks of a written draft. */
const people = (info: DraftInfo) => info.tracks.filter((track) => track.type === "video" && track.flag === 2)

test("the layers are written in the order CapCut draws them: the person over its own text and under everything else, subtitles and sounds on top", async () => {
  const library = { list: async () => [BUILT_IN_SOUNDS[0]!] }
  const context = await withGraphics([graphicAt(s(17.16))], { inserts: true, sounds: library, highlightAssets: ASSETS, pro: false, cutouts: {} })
  const { service, folder, outlines, graphicsDir } = context
  await withGroups(context, transcript, [countdown], [
    { id: "g1", lines: [{ from: 0, to: 2, text: "ขึ้นไป" }] },
    { id: "g2", lines: [{ from: 8, to: 11, text: "สามสองหนึ่ง" }] },
  ])
  await outlines.update(folder, (stored) => ({
    ...stored!,
    flair: { ...stored!.flair!, looks: { g1: { ...DEFAULT_LOOK, behindPerson: true } }, cues: [{ anchor: { kind: "highlight", groupId: "g2", line: 0 }, effectId: BUILT_IN_SOUNDS[0]!.effectId, edited: true }] },
  }))
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "line", true)
  const write = async (behindPerson: boolean) =>
    service.write(folder, DEFAULT_CUT_RULES, segments(await readInfo(folder)), { length: "line", texts: lines.map((line) => line.text) }, { position: "auto", hideSubtitles: true, highlightsOn: true, groupCount: 2, flair: { ...GRAPHICS, insert: true, sound: true, behindPerson } })
  const dirs = { cutouts: context.deps.cutoutsDir!, graphics: graphicsDir }

  expect(await write(true)).toMatchObject({ insertCount: 1, graphicCount: 1, soundCount: 1, behindPerson: { laid: 1, front: 0, covered: 0 } })
  const behind = await readInfo(folder)
  expect(layersOf(behind, dirs)).toEqual(["main", "text ขึ้นไป", "person", "cutaway", "graphic", "text สามสองหนึ่ง", "subtitles", "sound"])
  behind.tracks.forEach((track, i) => track.segments.forEach((segment) => expect(segment.track_render_index, `track ${i}`).toBe(i)))

  // without a person there are no layers under it, and the two groups share their lane again
  await write(false)
  expect(layersOf(await readInfo(folder), dirs)).toEqual(["main", "cutaway", "graphic", "text ขึ้นไป", "subtitles", "sound"])
})

test("each piece of the person lies on its range of the main picture: asked at the middle of each frame's gap, with the picture's clip, and its zoom frame by frame", async () => {
  const context = await withBehind({ pro: false })
  const plan = await context.service.preview(context.folder, DEFAULT_CUT_RULES)
  // a punch on the first piece, which lands on ขึ้นไป as it comes on
  await context.outlines.update(context.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, zooms: [{ anchor: { videoId: CLIP_ID, sourceUs: plan.cuts[0]!.sourceStartUs, beatId: "beat-1" }, kind: "punch", edited: true }] } }))
  expect(await context.write({ zoom: true })).toMatchObject({ zoomCount: 1, behindPerson: { laid: 1, front: 0, covered: 0 }, dropped: { cutouts: 0 } })
  const info = await readInfo(context.folder)
  const [person] = people(info)
  const [segment] = person!.segments
  const main = info.tracks[0]!.segments[0]!
  const line = textSegment(info, "ขึ้นไป")
  // on the frames the text's first line shows, on the first piece
  expect(segment!.target_timerange).toEqual(line.target_timerange)
  // every timeline frame asks the file for the middle of the gap before its frame
  expect(segment!.source_timerange).toEqual({ start: PERSON_SOURCE_START_US, duration: line.target_timerange.duration })
  expect(segment!.volume).toBe(0)
  expect(segment!.clip).toEqual(main.clip)
  // the person grows with the picture: at every frame of the range its scale and place are the main piece's
  for (let frame = 0; frame * (1_000_000 / 30) < line.target_timerange.duration; frame++) {
    const t = line.target_timerange.start + Math.floor((frame * 1_000_000) / 30)
    for (const property of ["KFTypeScaleX", "KFTypePositionX", "KFTypePositionY"]) {
      const mainAt = valueAt(keysOf(main, property), main.source_timerange!.start + (t - main.target_timerange.start))
      const personAt = valueAt(keysOf(segment!, property), PERSON_SOURCE_START_US + (t - segment!.target_timerange.start))
      expect(personAt, `${property} at frame ${frame}`).toBeCloseTo(mainAt, 9)
    }
  }
})

test("with CapCut Pro the person is CapCut's own: silent copies of the main pieces with its background removal, on the frames of the group", async () => {
  const context = await withBehind({ behind: ["g3"] })
  expect((await context.write()).behindPerson).toEqual({ laid: 1, front: 0, covered: 0 })
  const info = await readInfo(context.folder)
  expect(layersOf(info, { cutouts: context.cutoutsDir })).toEqual(["main", "text ใน", "person (CapCut)", "text ขึ้นไป"])
  const [copies] = people(info)
  const videos = info.materials.videos as { id: string; path: string; matting: { flag: number; path: string } }[]
  const line = textSegment(info, "ใน")
  const pieces = info.tracks[0]!.segments
  // one copy on each piece the text is on, from its first frame to its last
  expect(copies!.segments.map((segment) => segment.target_timerange.start)).toEqual([line.target_timerange.start, pieces[1]!.target_timerange.start])
  expect(copies!.segments.reduce((sum, segment) => sum + segment.target_timerange.duration, 0)).toBe(line.target_timerange.duration)
  for (const segment of copies!.segments) {
    const piece = pieces.find((main) => main.target_timerange.start <= segment.target_timerange.start && segment.target_timerange.start < main.target_timerange.start + main.target_timerange.duration)!
    // the main piece's own source there, from its own file, silent, with CapCut's background removal
    expect(segment.source_timerange!.start).toBe(piece.source_timerange!.start + segment.target_timerange.start - piece.target_timerange.start)
    expect(segment.volume).toBe(0)
    const material = videos.find((video) => video.id === segment.material_id)!
    expect(material.path).toBe(videos.find((video) => video.id === piece.material_id)!.path)
    expect(material.matting.flag).toBe(3)
    expect(material.matting.path.startsWith(`${context.folder}/matting/`)).toBe(true)
  }
  // nothing is cut on the app's side
  expect(context.cutouts.waited).toEqual([])
})

test("a behind group whose cutting failed is drawn in front at the top, where it was placed, and counted in front", async () => {
  const faceHigh = { startUs: 0, endUs: s(31), description: "", kind: "talking-head" as const, issues: [], keepClear: { fromY: 0.05, toY: 0.4 } }
  const context = await withBehind({ pro: false, outcome: () => "failed", extra: { scenes: [faceHigh] } })
  expect((await context.write()).behindPerson).toEqual({ laid: 0, front: 1, covered: 0 })
  const info = await readInfo(context.folder)
  // no person, and ขึ้นไป drawn with the rest
  expect(layersOf(info, { cutouts: context.cutoutsDir })).toEqual(["main", "text ขึ้นไป"])
  // at the top, as when it goes behind: placement never waits on how a cutting went
  const top = layoutGroup(["ขึ้นไป"], HIGHLIGHT_STYLES["bold-white"].font, { width: 1080, height: 1920 }, TOP_PLACEMENT).lines[0]!.y
  expect((textSegment(info, "ขึ้นไป").clip as { transform: { y: number } }).transform.y).toBeCloseTo(top, 6)
})

test("a group across a cut goes behind whole or not at all: one piece failed, and neither piece of the person is written", async () => {
  // ใน's first piece (its source frames before 20 s) made, its second failed
  const context = await withBehind({ pro: false, behind: ["g3"], outcome: (job) => (job.pts[0]! < 12_000 ? "made" : "failed") })
  expect((await context.write()).behindPerson).toEqual({ laid: 0, front: 1, covered: 0 })
  expect(context.cutouts.waited[0]![1]).toHaveLength(2)
  expect(people(await readInfo(context.folder))).toEqual([])
  // the piece that was made is not in the bin either
  expect((await imported(context.folder)).some((item) => item.file_Path.startsWith(context.cutoutsDir))).toBe(false)
})

test("the write counts the groups behind the person: laid, drawn in front, and covered by the head, after waiting for the samples", async () => {
  // ขึ้นไป (its source frames before 18.4 s) made; ใน failed
  const context = await withBehind({ pro: false, behind: ["g1", "g3"], outcome: (job) => (job.pts[0]! < 11_000 ? "made" : "failed") })
  context.cutouts.mask = FULL_MASK
  const result = await context.write()
  expect(result.behindPerson).toEqual({ laid: 1, front: 1, covered: 1 })
  // no group here reaches into a piece for less than a frame
  expect(result.dropped).toMatchObject({ cutouts: 0 })
  // the samples were asked for before the draft was read, one request for the one source
  expect(context.cutouts.sampled).toHaveLength(1)
})

test("the CapCut Pro setting is read once, before the write waits: turned on while it waits, it is the next write's", async () => {
  const context = await withBehind({ pro: false })
  await context.outlines.update(context.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, looks: { g1: { ...stored!.flair!.looks.g1!, exit: "spin-out" } } } }))
  const wait = context.cutouts.renderer.wait
  context.cutouts.renderer.wait = async (folder, jobs) => {
    await context.deps.settings.update({ capcut: { pro: true } })
    return wait(folder, jobs)
  }
  const first = await context.write()
  // the app's route, as the setting was when the write began: its person file, and the exit held for want of Pro
  expect(first.behindPerson).toEqual({ laid: 1, front: 0, covered: 0 })
  expect(first.proLeftOut.exits).toBe(1)
  expect(layersOf(await readInfo(context.folder), { cutouts: context.cutoutsDir })).toContain("person")
  // the next write goes CapCut's way
  const next = await context.write()
  expect(next.proLeftOut.exits).toBe(0)
  expect(layersOf(await readInfo(context.folder), { cutouts: context.cutoutsDir })).toContain("person (CapCut)")
})

test("person cutouts stopped before they were made (the app is quitting) leave the draft as it was, and no backup", async () => {
  const context = await withBehind({ pro: false, outcome: () => "stopped" })
  const files = () => Promise.all(["draft_info.json", "draft_meta_info.json"].map((file) => readFile(join(context.folder, file), "utf8")))
  const before = await files()
  await expect(context.write()).rejects.toThrow("the person cutouts were stopped before they were made; the draft was not changed")
  expect(await files()).toEqual(before)
  await expect(readdir(context.deps.backupRoot)).rejects.toThrow()
})

test("the write waits for exactly the jobs the preview asked for: pieces cut off the frame grid, and a group across a cut", async () => {
  const context = await withBehind({ pro: false, behind: ["g1", "g3"] })
  const highlights = createHighlightService({ outlines: context.outlines, timeline: context.service, footage: context.deps, cutouts: context.cutouts.renderer })
  await highlights.preview(context.folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair: context.flair })
  const asked = context.cutouts.ensured.at(-1)![1]
  // ขึ้นไป on one piece, ใน on two
  expect(asked).toHaveLength(3)
  await context.write()
  expect(context.cutouts.waited.at(-1)![1].map(context.cutouts.hashOf)).toEqual(asked.map(context.cutouts.hashOf))
})

test("each person file is in the media bin, and taken out again by a write that no longer plays it; the user's own media stay", async () => {
  const context = await withBehind({ pro: false })
  const before = await imported(context.folder)
  await context.write()
  const info = await readInfo(context.folder)
  const [person] = people(info)
  const material = (info.materials.videos as { id: string; path: string; local_material_id: string }[]).find((video) => video.id === person!.segments[0]!.material_id)!
  expect(material.path.startsWith(context.cutoutsDir)).toBe(true)
  const entry = (await imported(context.folder)).find((item) => item.file_Path === material.path)!
  // CapCut's own bin ids are lower-case UUIDs
  expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(material.local_material_id).toBe(entry.id)
  await context.write({ behindPerson: false })
  expect(await imported(context.folder)).toEqual(before)
})
```

  In `apps/desktop/src/main/highlights.test.ts`, the layer test at ~:323-357 now has the subtitles on top.
  - Its name becomes "writing adds the groups under the subtitles, in the style's font, stacked where the user put them".
  - Its track expectation and the slice change:

```ts
  expect(info.tracks.map((track) => [track.type, track.flag])).toEqual([
    ["video", 0],
    ["text", 0],
    ["text", 0],
    ["text", 0],
    // the subtitles over the highlight text: CapCut layers by the order of tracks[] (spec 0.5.0 §9.1)
    ["text", 1],
  ])
```

```ts
  const [line1, line2, line3] = info.tracks.slice(1, 4)
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run: `npx vitest run apps/desktop/src/main/timeline.test.ts apps/desktop/src/main/highlights.test.ts`

  Expected: FAIL.
  - The write lays no person and no matting copies, waits for no cutout, and appends tracks in writer order (subtitles second).
  - The result has no `behindPerson` or `dropped.cutouts`, and `graphicJobs` is called with three arguments.

- [ ] **Step 3: The result's new counts.**

  In `apps/desktop/src/shared/api.ts`, `WriteResult`:
  - `dropped` becomes:

```ts
  dropped: { sounds: number; zooms: number; inserts: number; graphics: number; cutouts: number }
```

  - Its doc gains: "The cutouts' are pieces of the person left out where a group reaches into a main piece for less than a frame; the group still goes behind on its other pieces."
  - Add, after `proLeftOut`:

```ts
  /**
   * the groups whose text went behind the person (spec §9.4): laid behind it, drawn in front of it (the app could not
   * cut it, or one of its pieces failed or had no one in it), and laid with the head-cover warning. Zeros without a
   * highlight request, or with the switch off
   */
  behindPerson: { laid: number; front: number; covered: number }
```

  In `apps/desktop/src/main/timeline.ts`, `tally` counts the cutouts. Its doc gains "the person cutouts' pieces too", and its `dropped` becomes:

```ts
    dropped: { sounds: of("sounds").dropped, zooms: of("zooms").dropped, inserts: of("inserts").dropped, graphics: of("graphics").dropped, cutouts: of("cutouts").dropped },
```

- [ ] **Step 4: The wait, before the draft is read.**

  The imports of `timeline.ts` gain:
  - `import { addedTracks, arrangeTracks } from "@boxblack/core/capcut/layers"`;
  - `import { addMattingTrack, addPersonTrack, type TimelineMattingCopy, type TimelinePerson } from "@boxblack/core/capcut/person"`;
  - `import { PERSON_SOURCE_START_US, personKeyframes, type SampleMask } from "@boxblack/core/cutout"`;
  - `coverOf` and `sourceKey` (beside `planBehind`), and `sampleRequests`, in the `./behind-person.ts` import;
  - `type RenderedPerson` in the `./cutout-render.ts` import.

  Add inside `createTimelineService`, above `writeNow`:

```ts
  /**
   * What a write lays behind the person, waited for before the draft is read (spec §7.5). On the app's route that is
   * every job of the behind groups the request shows, until each is made, has failed or found no one. On either route
   * it is the frames the head-cover warning samples. The draft is read here as compiled() reads it, for its bin and
   * frame rate, so the jobs are the ones the preview asked for. A job that ends none of those ways was stopped (the
   * app is quitting): the write stops too, leaving the draft as it was. Answers the masks sampled, by source
   * (sourceKey) and frame.
   */
  async function waitForBehind(folder: string, stored: StoredOutline, plan: CutPlan, clips: CutClip[], highlights: HighlightRequest, pro: boolean): Promise<Map<string, Map<number, SampleMask>>> {
    const masks = new Map<string, Map<number, SampleMask>>()
    const renderer = deps.cutouts
    if (!highlights.flair.behindPerson || !renderer) return masks
    const draft = await loadDraft(folder)
    const placed = placeStored(stored, plan, clips, showRulesOver(placedPoints(stored, plan, clips), highlights))
    const behind = await behindOf({ stored, plan, bin: binVideos(draft.meta), fps: draft.info.fps }, placed, highlights.flair, pro)
    const jobs = behind.route === "ours" ? behind.groups.flatMap((group) => group.jobs) : []
    if (jobs.length > 0) {
      const { ready, failed, noPerson } = await renderer.wait(folder, jobs)
      const settled = new Set([...ready, ...failed, ...noPerson])
      if (jobs.some((job) => !settled.has(renderer.hashOf(job)))) throw new Error("the person cutouts were stopped before they were made; the draft was not changed")
    }
    for (const [key, request] of sampleRequests(behind.groups)) {
      // a frame that cannot be sampled leaves its group's cover unmeasured, not the write undone
      const got = await renderer.sample(request).catch(() => null)
      if (got) masks.set(key, got)
    }
    return masks
  }
```

- [ ] **Step 5: Rewrite `writeNow`.**

  Replace the whole function (its doc stays: "The write itself; `write` below lets only one run on a draft at a time."):

```ts
  /** The write itself; `write` below lets only one run on a draft at a time. */
  async function writeNow(
    folder: string,
    rules: CutRules,
    expectedSegments: number,
    subtitles: SubtitleRequest | null,
    highlights: HighlightRequest | null,
  ): Promise<WriteResult> {
    await assertCapCutClosed(deps.isCapCutRunning)
    const { stored, plan: cutPlan, clips } = await compile(folder, rules)
    if (cutPlan.cuts.length === 0) throw new Error("the rough cut is empty: every beat was cut away")
    // read once, before anything is waited for. The CapCut Pro setting in force now picks who cuts the person out, and
    // so what is waited for; it holds back the exits and sounds that need Pro, and every count is made under it. A
    // change while this write waits is the next write's (spec §7.5)
    const settings = await deps.settings.read()
    const pro = settings.capcut.pro

    // the graphics are waited for before the draft is read: rendering can take minutes, time enough
    // for CapCut to open, change and close the project, and the write must start from what it left
    const waitedFor: { graphic: PlacedGraphic; job: RenderJob }[] = []
    if (highlights?.flair.graphic && deps.graphicJobs) {
      const { kept, jobs } = await deps.graphicJobs(folder, rules, { position: highlights.position, subtitlesOn: subtitles !== null, highlightsOn: highlights.highlightsOn, flair: highlights.flair }, pro)
      if (kept.length > 0) {
        const notInstalled = "the graphics renderer is not installed: install it in settings, or turn graphics off"
        const renderer = deps.graphics
        if (!renderer) throw new Error(notInstalled)
        // a render found the machine unfit (the pack damaged, the app's ffmpeg or a font missing, or the emoji pictures a
        // graphic draws with): the pack may well be installed
        const unfit = (held: RenderJob[]) => {
          // the emoji pictures' problem only when a graphic held back draws an emoji: plain cards held back are not theirs
          const problem = renderer.environmentProblem(held)
          return problem === null ? null : new Error(`graphics cannot be made on this machine: ${problem.text}; the draft was not changed`)
        }
        // the pack is only needed for what is not made yet
        if (!(await deps.graphicsReady?.())) {
          for (const job of jobs) if (!(await renderer.rendered(job))) throw unfit([job]) ?? new Error(notInstalled)
        }
        const { ready, failed } = await renderer.wait(jobs, folder)
        // a job neither made nor failed was stopped (the app is quitting, or the renderer pack is being replaced), or
        // the machine was found unfit while it waited: that is not a graphic to leave out
        const settled = new Set([...ready, ...failed])
        const unsettled = jobs.filter((job) => !settled.has(renderer.hashOf(job)))
        if (unsettled.length > 0) throw unfit(unsettled) ?? new Error("the graphics were stopped before they were made; the draft was not changed")
        for (const [i, graphic] of kept.entries()) waitedFor.push({ graphic, job: jobs[i]! })
      }
    }
    // then, for the same reason, the person cutouts of the groups behind the person and the frames the head-cover warning samples
    const masks = highlights ? await waitForBehind(folder, stored, cutPlan, clips, highlights, pro) : new Map<string, Map<number, SampleMask>>()
    // CapCut may have been opened meanwhile: a write it would refuse must not take a backup first
    await assertCapCutClosed(deps.isCapCutRunning)

    const draft = await loadDraft(folder)
    const current = segmentCount(draft.info)
    if (current !== expectedSegments) {
      throw new Error(`the timeline changed after it was checked (it now has ${current} segments, not ${expectedSegments}); check it again before writing`)
    }
    // build first: a cut the writer rejects must not leave a backup behind for nothing
    const time = now()
    let info = buildRoughCut(draft.info, cutPlan.cuts, binVideos(draft.meta))
    // the segment each cut became; its frame-rounded times are where the words really play
    const video = info.tracks[0]!.segments
    const at = (cut: number, sourceUs: number) => video[cut]!.target_timerange.start - video[cut]!.source_timerange!.start + sourceUs
    const played = onFrames(cutPlan, at)
    // the emphasis points placed on this rough cut (without a highlight request nothing below reads them)
    const points = highlights ? placedPoints(stored, cutPlan, clips) : []
    // what the request shows: the text only while it is on, and each item only when the level lets its point through
    const show = highlights ? showRulesOver(points, highlights) : SHOW_ALL
    // the points the level lets through, whether or not a work put anything on them: counted by the very
    // filter the items pass, so the count and what is written cannot disagree
    const emphasisCount = points.filter((where) => show.passes(where.point.id)).length
    const placed = highlights ? placeStored(stored, cutPlan, clips, show) : []

    // each writer's answer: the draft after it, and what it placed and left out, which the result counts (tally)
    const laid: Partial<Record<LaidKind, { kept: number; dropped: number }>> = {}
    const lay = (kind: LaidKind, result: Written) => {
      const { info: after, ...counts } = result
      info = after
      laid[kind] = counts
    }
    // the tracks of each kind, bottom to top; arrangeTracks writes them in the order of spec §9.1 at the end
    const layers = {
      main: [info.tracks[0]!.id],
      behindBars: [] as string[],
      behindText: [] as string[],
      person: [] as string[],
      cutaways: [] as string[],
      graphics: [] as string[],
      bars: [] as string[],
      text: [] as string[],
      subtitles: [] as string[],
      sounds: [] as string[],
    }
    /** The ids of the tracks a writer adds, in the order it adds them. */
    const added = (write: () => void): string[] => {
      const before = info
      write()
      return addedTracks(before, info)
    }
    /** Highlight tracks as the writer added them: its bars' sticker tracks, and its text's. */
    const barsAndText = (ids: string[]) => {
      const bar = (id: string) => info.tracks.find((track) => track.id === id)?.type === "sticker"
      return { bars: ids.filter(bar), text: ids.filter((id) => !bar(id)) }
    }
    // the media bin's entries for the rendered files the write plays: the graphics' and the person's
    const binItems: BinItem[] = []
    const idOfPath = new Map<string, string>()
    /**
     * A rendered file's bin id. A file already in the bin (written before) keeps its entry, and two pieces made of the
     * same file share one. The item is always handed over (addBinItems skips an id that is there), in case the entry
     * is gone by the time the bin is written.
     */
    const binEntry = (file: { path: string; width: number; height: number; durationUs: number }): string => {
      const binId = idOfPath.get(file.path) ?? binIdOf(draft.meta, file.path) ?? newBinId()
      idOfPath.set(file.path, binId)
      binItems.push(graphicBinItem({ id: binId, path: file.path, width: file.width, height: file.height, durationUs: file.durationUs, nowMs: time.getTime() }))
      return binId
    }

    if (subtitles) {
      // with the text off no group is placed, so none hides a word
      const hidden = highlights?.hideSubtitles ? hiddenFor(stored, cutPlan, clips, draft, show) : new Map<number, Set<number>>()
      const captions = captionsFor(cutPlan, clips, draft, subtitles.length, hidden)
      if (captions.length !== subtitles.texts.length) {
        throw new Error(`the subtitles changed since they were shown (${captions.length} lines now, not ${subtitles.texts.length}); look at them again before writing`)
      }
      const timed = captions.map((caption, i) => ({ startUs: at(caption.cut, caption.startUs), endUs: at(caption.cut, caption.endUs), text: subtitles.texts[i]! }))
      layers.subtitles = added(() => (info = addSubtitleTrack(info, timed, `boxblack_${time.getTime()}`)))
    }

    // the groups behind the person on the draft as it is now: with the bin as it was during the wait, the jobs waited for
    const behind = highlights ? await behindOf({ stored, plan: cutPlan, bin: binVideos(draft.meta), fps: draft.info.fps }, placed, highlights.flair, pro) : null
    // the zooms, worked out before the text: the head-cover warning measures the picture as they move it
    const zoomed = highlights ? zoomsFor(stored, cutPlan, placed, clips, highlights.flair, show.passes) : { zooms: [], lost: 0 }
    // the behind groups whose person is laid, each with its pieces' made files on the app's route (range order);
    // their text goes under the person, the rest over it
    const under = new Map<string, (RenderedPerson | null)[]>()
    const behindCounts = { laid: 0, front: 0, covered: 0 }
    // the groups' exits left out for want of CapCut Pro, counted over the groups written
    let exitsHeld = 0
    if (highlights) {
      const groups = timeHighlights(placed, at, info.duration)
      if (groups.length !== highlights.groupCount) {
        throw new Error(`the highlight text changed since it was shown (${groups.length} groups now, not ${highlights.groupCount}); look at it again before writing`)
      }
      const canvas = canvasOf(cutPlan, draft)
      if (groups.length > 0 && canvas) {
        if (!deps.highlightAssets) throw new Error("highlight text is not ready: its fonts are missing")
        // the custom style's colours are the user's own, kept in settings
        const style = styleFor(styleInForce(stored.highlights), settings.highlights.custom)
        const byId = new Map(placed.map((group) => [group.groupId, group]))
        // an exit that needs CapCut Pro the user does not have is written as none; it stays stored
        const looks = looksInForce(
          stored,
          groups.map((group) => ({ id: group.groupId, lines: group.lines.map((line) => ({ lineIndex: line.lineIndex, text: line.text.trim() })) })),
          highlights.flair,
          canvas,
          pro,
        )
        exitsHeld = Object.keys(heldExits(stored, groups.map((group) => group.groupId), highlights.flair, pro)).length
        // all or nothing (spec §9.2): on the app's route a group goes under the person only when every piece of it was
        // made; on CapCut's, CapCut cuts every one
        for (const group of behind?.groups ?? []) {
          if (behind!.route === "capcut") under.set(group.groupId, group.ranges.map(() => null))
          else if (group.block === null && deps.cutouts) {
            const renderer = deps.cutouts
            const made = await Promise.all(group.jobs.map((job) => renderer.rendered(job)))
            if (made.every((file) => file !== null)) under.set(group.groupId, made)
          }
        }
        const laidOut = (group: (typeof groups)[number]) => {
          // a group behind the person sits at the top whether or not its person was made: placement never waits on a cutting (spec §5.3)
          const placement = placementOf(byId.get(group.groupId)!, clips, highlights.position, subtitles !== null, behind?.top.has(group.groupId) ?? false)
          const look = looks[group.groupId] ?? DEFAULT_LOOK
          const { lines } = layoutGroup(group.lines.map((line) => line.text.trim()), style.font, canvas, placement, look.pattern)
          const exit = look.exit === null ? null : (exitById(look.exit) ?? null)
          return {
            endUs: group.endUs,
            exit: exit && { resourceId: exit.resourceId, name: exit.name },
            lines: group.lines.map((line, i) => ({
              startUs: line.startUs,
              text: line.text,
              ...lines[i]!,
              tone: look.tone,
              accent: look.accent?.line === i ? { from: look.accent.from, to: look.accent.to } : null,
            })),
          }
        }
        const textLook = {
          fontPath: await deps.highlightAssets.fontPath(style.font),
          strokeWidth: style.strokeWidth,
          barRoundness: style.barRoundness,
          palette: style.palette,
          animation: { ...style.animation, path: await deps.highlightAssets.animationPath(style.animation.resourceId) },
        }
        // the groups behind the person first, on lanes of their own under the person, then every other group over it;
        // each lays its lines on lanes by line number, as before (spec §9.1)
        const behindGroups = groups.filter((group) => under.has(group.groupId))
        const otherGroups = groups.filter((group) => !under.has(group.groupId))
        if (behindGroups.length > 0) {
          const ids = barsAndText(added(() => (info = addHighlightTracks(info, behindGroups.map(laidOut), textLook))))
          layers.behindBars = ids.bars
          layers.behindText = ids.text
        }
        if (otherGroups.length > 0) {
          const ids = barsAndText(added(() => (info = addHighlightTracks(info, otherGroups.map(laidOut), textLook))))
          layers.bars = ids.bars
          layers.text = ids.text
        }
        // the counts (spec §9.4): laid behind, drawn in front, and covered by the head more than a line may be
        for (const group of behind?.groups ?? []) {
          if (!under.has(group.groupId)) {
            behindCounts.front++
            continue
          }
          behindCounts.laid++
          const covered = coverOf({
            group,
            pattern: looks[group.groupId]?.pattern,
            font: style.font,
            canvas,
            fps: info.fps,
            zooms: zoomed.zooms,
            clipOf: (cut) => info.tracks[0]!.segments[cut]?.clip,
            maskAt: (point) => masks.get(sourceKey(point.source))?.get(point.pts),
          })
          if (covered === true) behindCounts.covered++
        }
      }
    }

    // the picture moves before anything is laid on top of it
    if (zoomed.zooms.length > 0) lay("zooms", addZooms(info, zoomed.zooms))

    // the person over the behind groups' text (spec §9.2, §9.3): a piece on each range of each group laid under it,
    // on its main piece's frames, with that piece's clip and zoom; written after the zooms, whose keyframes it follows
    const personBinIds: string[] = []
    if (behind && under.size > 0) {
      const laidGroups = behind.groups.filter((group) => under.has(group.groupId))
      const pieces = laidGroups.flatMap((group) => group.ranges.map((range, i) => ({ range, file: under.get(group.groupId)![i] ?? null })))
      if (behind.route === "ours") {
        const people: TimelinePerson[] = pieces.map(({ range, file }) => {
          const made = file!
          const main = info.tracks[0]!.segments[range.cut]!
          const binId = binEntry(made)
          personBinIds.push(binId)
          return {
            targetStartUs: range.targetStartUs,
            targetDurationUs: range.targetDurationUs,
            path: made.path,
            binId,
            width: made.width,
            height: made.height,
            fileDurationUs: made.durationUs,
            clip: structuredClone(main.clip),
            // the main piece's keys on the file's own clock, where its frame 1 is the range's first frame
            keyframes: personKeyframes(main.common_keyframes ?? [], { sourceStartUs: range.sourceStartUs, durationUs: range.targetDurationUs }, range.sourceStartUs - PERSON_SOURCE_START_US),
          }
        })
        const { info: after, trackId } = addPersonTrack(info, people)
        info = after
        if (trackId) layers.person = [trackId]
      } else {
        const copies: TimelineMattingCopy[] = pieces.map(({ range }) => ({
          cut: range.cut,
          targetStartUs: range.targetStartUs,
          targetDurationUs: range.targetDurationUs,
          sourceStartUs: range.sourceStartUs,
          draftFolder: draft.folder,
        }))
        const { info: after, trackId } = addMattingTrack(info, copies)
        info = after
        if (trackId) layers.person = [trackId]
      }
      // the pieces laid, and those left out where a group reaches into a piece for less than a frame
      laid.cutouts = { kept: pieces.length, dropped: laidGroups.reduce((sum, group) => sum + group.slivers, 0) }
    }

    // the cutaways over the person and under the other text, timed like the text, on the frames the picture really starts on
    const inserts = highlights ? await insertCutaways(stored, cutPlan, placed, clips, folder, highlights.flair, show.passes, points, played) : []
    if (inserts.length > 0) layers.cutaways = added(() => lay("inserts", addInsertTrack(info, inserts)))

    // the graphics over the cutaways and under the other text, timed like the cutaways
    const graphics: TimelineGraphic[] = []
    let graphicsSkipped = 0
    for (const { graphic, job } of waitedFor) {
      const file = await deps.graphics!.rendered(job)
      // its render failed, or it was made and its file is gone since
      if (!file) {
        graphicsSkipped++
        continue
      }
      const binId = binEntry(file)
      graphics.push({
        atUs: played(graphic.atUs),
        durationUs: graphic.durationUs,
        binId,
        path: file.path,
        name: basename(file.path),
        width: file.width,
        height: file.height,
        durationOfFileUs: file.durationUs,
        place: file.place,
      })
    }
    if (graphics.length > 0) layers.graphics = added(() => lay("graphics", addGraphicTrack(info, graphics)))

    // the sound effects, over everything
    const sounds = highlights ? await soundCues(stored, cutPlan, placed, clips, highlights.flair, show.passes, points, played, pro) : { cues: [], pro: 0 }
    if (sounds.cues.length > 0) layers.sounds = added(() => lay("sounds", addSoundTrack(info, sounds.cues)))

    // bottom to top as CapCut draws them, which follows tracks[], not render_index (spec §9.1):
    //   the main picture; the behind groups' bars and text; the person; the cutaways; the graphics;
    //   the other groups' bars and text; the subtitles; the sounds.
    // Every track is named once, so a writer's track left out fails here, not in CapCut
    info = arrangeTracks(info, [layers.main, layers.behindBars, layers.behindText, layers.person, layers.cutaways, layers.graphics, layers.bars, layers.text, layers.subtitles, layers.sounds])

    // the bin is brought in line on every write, graphics and cutouts on or off, so rendered files this timeline no
    // longer plays leave the user's media panel. Only files in BOXBLACK's own graphics and cutouts folders are ever
    // taken out, and the write replaces the whole timeline — unless the project holds other timelines, which share
    // this bin and may still play older ones
    const renderedDirs = [deps.graphicsDir, deps.cutoutsDir].filter((dir): dir is string => dir !== undefined)
    const pruneIn = renderedDirs.length > 0 && (await liveTimelines(draft)) <= 1 ? renderedDirs : null
    const playing = new Set([...graphics.map((graphic) => graphic.binId), ...personBinIds])
    const dir = await backupDraft(draft, deps.backupRoot, time)
    await writeDraft(draft, info, {
      isCapCutRunning: deps.isCapCutRunning,
      bin: (meta) => (pruneIn ? addBinItems(pruneBinItems(meta, pruneIn, playing), binItems) : addBinItems(meta, binItems)),
    })

    const { backup } = await describe(basename(dir))
    const textSegments = (flag: number) => info.tracks.filter((track) => track.type === "text" && track.flag === flag).reduce((sum, track) => sum + track.segments.length, 0)
    return {
      backup,
      durationUs: info.duration,
      segmentCount: segmentCount(info),
      captionCount: textSegments(1),
      highlightCount: textSegments(0),
      ...tally(laid),
      zoomsLost: zoomed.lost,
      graphicsSkipped,
      emphasisCount,
      proLeftOut: { exits: exitsHeld, sounds: sounds.pro },
      behindPerson: behindCounts,
    }
  }
```

  The two locals Task 13 added in the old body (`behind`, and the `placementOf` change) are part of this function now.

- [ ] **Step 6: The renderer compiles against the new result.**

  The write page names each kind of `dropped`, as the switches name them. This adds the switch's name, which Part E's UI reuses.
  - In `apps/desktop/src/renderer/src/i18n.ts`, next to `"flair.graphic"`:

```ts
  "flair.behindPerson": "ตัวหนังสืออยู่หลังคน",
```

  - In `apps/desktop/src/renderer/src/screens/WriteScreen.tsx:35`:

```ts
const DROPPED_NAMES: Record<keyof WriteResult["dropped"], MessageKey> = { sounds: "flair.sound", zooms: "flair.zoom", inserts: "flair.insert", graphics: "flair.graphic", cutouts: "flair.behindPerson" }
```

  - In `apps/desktop/src/renderer/test/fake-api.ts`, the `writeTimeline` result's `dropped` gains `cutouts: 0`, and it gains `behindPerson: { laid: 0, front: 0, covered: 0 },`.
  - In `apps/desktop/src/renderer/src/screens/WriteScreen.test.tsx` (~:612), the literal `dropped` gains `cutouts: 0`.

- [ ] **Step 7: Run the tests and see them pass.**

  Run: `npx vitest run apps/desktop/src/main apps/desktop/src/renderer`

  Expected: PASS.

- [ ] **Step 8: Commit.** Run `npm test` and `npm run typecheck`; both must be clean.


---

### Task 16: Claude chooses the groups that go behind the person (spec §5.1)

**Files:**
- Modify: `packages/core/src/highlights/pick.ts` (version :15, `SYSTEM` :23-61, `HighlightReplySchema` :66-86, a new `HighlightPicture`, `acceptHighlights`'s `asked` :271-278, `describe` :305-329, `pickHighlights` :332-361)
- Modify: `packages/core/src/highlights/index.ts:3` (export `type HighlightPicture`)
- Modify: `apps/desktop/src/main/highlights.ts` (imports :3 and :11-31; a new `pointPictures` after `highlightPoints` :93-129; the `pickHighlights` call in `pick()` ~:530-542)
- Test: `packages/core/src/highlights/pick.test.ts`, `apps/desktop/src/main/highlights.test.ts`
- Typed reply fixtures: `apps/desktop/src/main/flair.test.ts:23-29`, `apps/desktop/src/main/post-flow.test.ts:241`

**Relies on Task 12:** `GroupLook.behindPerson?: boolean` (absent = in front), `enforce` keeping it on edited and non-edited looks, and `FlairOptions.behindPerson`.

**What the picture facts are.** The contract's `pictures` value is `{ face, keepClear, scene }` per point id. There is no face detector in the app, so the facts come from what the vision step already stored for each clip (`VideoInsight.scenes`: `kind` and `keepClear`), the way the graphics call gets them (`graphics-cues.ts` `graphicPoints`):
- `scene` is the kind of the scene playing at the point's first kept moment (`sceneAt(clips, videoId, sourceUs)`), or null when no scene is known there.
- `face` is `scene === "talking-head"`: the vision prompt defines that kind as "คนพูดกับกล้อง", the only picture text can go behind.
- `keepClear` is every band the picture keeps clear while the point plays on the rough cut (`keepClearsIn(plan, clips, span)`, the same bands graphics dodge), each band once. In a talking head that band is the face. It is null when the point's video has no pictures analysed, so the request can say "no data" rather than "no face".
- `acceptHighlights` does **not** take `pictures`: the spec puts the rule in the prompt, not in code, and the user may switch any group on by hand. Only `pickHighlights` (and `describe`) take it.

- [ ] **Step 1: Give every typed reply the new field.**

  The schema's default makes `behindPerson` a required field of the parsed type (`HighlightReply`), as `tone` is. Every reply literal typed as `HighlightReply` gains `behindPerson: false` ("in front"). `acceptHighlights` stores nothing for false (Step 4), so no look these tests compare changes.
  - `packages/core/src/highlights/pick.test.ts`, the `group()` helper (:83-92): add `behindPerson: false,` right before `...look`.
  - `apps/desktop/src/main/highlights.test.ts:26`: `const PLAIN = { pattern: "stack" as const, tone: "base" as const, accentLine: 0, accentWord: "", exit: "", behindPerson: false }`
  - `apps/desktop/src/main/post-flow.test.ts:241`: the same `PLAIN` with `behindPerson: false`.
  - `apps/desktop/src/main/flair.test.ts:26-27`: add `behindPerson: false` at the end of both groups of `HIGHLIGHTS`.

- [ ] **Step 2: Write the failing tests.**

  In `pick.test.ts`:
  - Add `type HighlightPicture` to the import from `./pick.ts`.
  - The pinned version (:285) becomes `expect(HIGHLIGHT_PROMPT_VERSION).toBe("highlights-2026-09-30-behind")`.
  - Add these tests:

```ts
test("the reply schema reads a group that says nothing of the person as in front, and takes only true or false", () => {
  const answer = { point: 1, lines: [{ quote: "a", text: "a" }], pattern: "stack", accentLine: 0, accentWord: "", exit: "" }
  expect(HighlightReplySchema.parse({ style: "headline", groups: [answer] }).groups[0]!.behindPerson).toBe(false)
  expect(HighlightReplySchema.parse({ style: "headline", groups: [{ ...answer, behindPerson: true }] }).groups[0]!.behindPerson).toBe(true)
  expect(HighlightReplySchema.safeParse({ style: "headline", groups: [{ ...answer, behindPerson: "yes" }] }).success).toBe(false)
})

test("a group Claude puts behind the person carries it on its look; one it leaves in front, or says nothing of, does not", () => {
  const { looks, dropped } = accept([
    group(1, [["ถ้าคุณ"]], { behindPerson: true }),
    group(2, [["299 บาท"]], { behindPerson: false }),
    // a transport that skipped the schema's defaults hands over no flag at all
    group(3, [["ทักมา"]], { behindPerson: undefined as never }),
  ])
  expect(looks.h1).toMatchObject({ ...PLAIN, behindPerson: true })
  // absent is in front (spec §4): the rest of the look is as before
  for (const id of ["h2", "h3"]) {
    expect(looks[id]!.behindPerson ?? false, id).toBe(false)
    expect(looks[id], id).toMatchObject(PLAIN)
  }
  // the flag is no part of what is turned down
  expect(dropped).toBe(0)
})

test("Claude is shown what the picture shows at each point: the scene's kind, whether a face is seen, and the bands it keeps clear", async () => {
  const { transport, requests } = fakeTransport({ style: "bold-white", groups: [] })
  const pictures: Record<string, HighlightPicture> = {
    p1: { face: true, keepClear: [{ fromY: 0.12, toY: 0.48 }], scene: "talking-head" },
    // a point that plays over two scenes keeps both bands clear
    p2: { face: true, keepClear: [{ fromY: 0.12, toY: 0.48 }, { fromY: 0.2, toY: 0.55 }], scene: "talking-head" },
    p3: { face: false, keepClear: [], scene: "b-roll" },
    // p4's video has no pictures analysed
    p4: { face: false, keepClear: null, scene: null },
  }
  const args = { transport, model: "m", brief: BRIEF, durationUs: 72_000_000, points, wordsOf, maxChars: 12 }
  await pickHighlights({ ...args, newId: ids(), pictures })
  const text = textOf(requests[0]!.content)
  // on a line of its own under each point, as the graphics call has its scene
  expect(text).toContain("· เหตุผล: เปิดด้วยคำถาม\n    ฉากตรงนั้น: talking-head · เห็นหน้าคน · keepClear [0.12, 0.48]")
  expect(text).toContain("· เหตุผล: ราคา\n    ฉากตรงนั้น: talking-head · เห็นหน้าคน · keepClear [0.12, 0.48] [0.2, 0.55]")
  expect(text).toContain("· เหตุผล: ชวนทัก\n    ฉากตรงนั้น: b-roll · ไม่เห็นหน้าคน · keepClear ไม่มี")
  expect(text).toContain("· เหตุผล: หน้าร้านสวย\n    ฉากตรงนั้น: ไม่มีข้อมูลภาพ")

  // a point the caller has no picture for says so too
  await pickHighlights({ ...args, newId: ids(), pictures: { p1: pictures.p1! } })
  expect(textOf(requests[1]!.content)).toContain("· เหตุผล: ราคา\n    ฉากตรงนั้น: ไม่มีข้อมูลภาพ")
  // a caller with no pictures at all says nothing of them
  await pickHighlights({ ...args, newId: ids() })
  expect(textOf(requests[2]!.content)).not.toContain("ฉากตรงนั้น")
})

test("the prompt tells Claude which groups go behind the person: key moments, short big text over a person talking to the camera, never a scene without one or a cutaway, sparingly, and no number on it", () => {
  const system = HIGHLIGHT_PROMPT.system
  expect(system).toContain("ฉากที่เล่นตรงนั้น (ชนิดฉาก เห็นหน้าคนไหม และ keepClear")
  expect(system).toContain("behindPerson")
  expect(system).toContain("เลือกเฉพาะจังหวะสำคัญ ข้อความสั้น ตัวใหญ่ บนฉากคนพูดหน้ากล้องที่เห็นคนชัด")
  expect(system).toContain("ไม่เลือกบนฉากที่ไม่มีคน หรือช่วงสื่อแทรก")
  expect(system).toContain("ใช้น้อย เพื่อให้เป็นจุดเด่น")
  // no cap: M25 ruled out quotas per kind, so the section names no number (spec §2)
  const section = system.slice(system.indexOf("อยู่หลังคน:"), system.indexOf("เลือกสไตล์หนึ่งแบบ"))
  expect(section.length).toBeGreaterThan(0)
  expect(section).not.toMatch(/[0-9๐-๙]/)
})
```

  In `apps/desktop/src/main/highlights.test.ts`, below the `scene()` helper (~:437-444):

```ts
test("Claude is shown what the picture shows at each point: the kind of scene where it starts, a face, and every band kept clear while it plays", async () => {
  // a talking head until 22 s, then a shot of the rocket, which keeps its sky clear
  const rocket: Scene = { ...scene(22, 31, { fromY: 0.6, toY: 0.9 }), kind: "b-roll", description: "จรวดขึ้นจากฐาน" }
  const one = await withHighlights({ scenes: [scene(0, 22, { fromY: 0.05, toY: 0.4 }), rocket] })
  await one.highlights.pick(one.folder, DEFAULT_CUT_RULES, VIEW)
  const request = textOf(one.claude.requests[0]!.content)
  // "ขึ้นไปในอวกาศ" (17.16–18.75 s) plays inside the talking head
  expect(request).toContain("· เหตุผล: เปิดคลิป\n    ฉากตรงนั้น: talking-head · เห็นหน้าคน · keepClear [0.05, 0.4]")
  // the second countdown starts at 22.62 s, in the rocket shot
  expect(request).toContain("· เหตุผล: นับถอยหลัง\n    ฉากตรงนั้น: b-roll · ไม่เห็นหน้าคน · keepClear [0.6, 0.9]")

  // the countdown (22.62–25.25 s) starts in one talking head and plays on into another: both faces
  const two = await withHighlights({ scenes: [scene(0, 23, { fromY: 0.05, toY: 0.4 }), scene(23, 31, { fromY: 0.55, toY: 0.9 })] })
  await two.highlights.pick(two.folder, DEFAULT_CUT_RULES, VIEW)
  expect(textOf(two.claude.requests[0]!.content)).toContain("· เหตุผล: นับถอยหลัง\n    ฉากตรงนั้น: talking-head · เห็นหน้าคน · keepClear [0.05, 0.4] [0.55, 0.9]")
})

test("a clip with no pictures analysed tells Claude so at each point, rather than that no face is seen", async () => {
  const { highlights, folder, claude } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const request = textOf(claude.requests[0]!.content)
  expect(request).toContain("· เหตุผล: เปิดคลิป\n    ฉากตรงนั้น: ไม่มีข้อมูลภาพ")
  expect(request).not.toContain("ไม่เห็นหน้าคน")
})

test("a group Claude puts behind the person is stored with the flag on its look, even while text behind the person is switched off", async () => {
  const { highlights, folder, claude, outlines } = await withHighlights()
  claude.reply = { style: "headline", groups: [{ ...REPLY.groups[0]!, behindPerson: true }, REPLY.groups[1]!] }
  // asked and kept with the switch off, so turning it on needs no new call (spec §5.1)
  await highlights.pick(folder, DEFAULT_CUT_RULES, { ...VIEW, flair: { ...VIEW.flair, behindPerson: false } })
  const looks = (await outlines.get(folder))!.flair!.looks
  expect(looks.id1!.behindPerson).toBe(true)
  expect(looks.id2!.behindPerson ?? false).toBe(false)
})
```

- [ ] **Step 3: Run them and see them fail.**

  Run: `npx vitest run packages/core/src/highlights/pick.test.ts apps/desktop/src/main/highlights.test.ts`

  Expected: FAIL.
  - The version pin fails.
  - The schema test fails: zod drops the unknown key, so `behindPerson` is `undefined`.
  - The flag test fails: `looks.h1.behindPerson` is `undefined`.
  - The picture tests fail: there is no "ฉากตรงนั้น" line.
  - The prompt test fails.
  - The stored-flag test in main fails.
  - Every existing test still passes.

- [ ] **Step 4: Implement.**

  In `pick.ts`, the version:

```ts
// 0.5.0: each group may go behind the person, chosen from what the picture shows at its point
export const HIGHLIGHT_PROMPT_VERSION = "highlights-2026-09-30-behind"
```

  In `SYSTEM`, the second paragraph ("ข้อมูลที่ได้: …") becomes:

```
ข้อมูลที่ได้: brief ของวิดีโอ สไตล์ตัวอักษร รูปแบบและแอนิเมชันที่ใช้ได้ และจุดเน้นของคลิปเรียงตามเวลา แต่ละจุดมีเลข ชนิด (คำพูดหรือภาพ) ความสำคัญ (สำคัญ รอง เสริม) ประเภท ชื่อช่วง เวลาบนวิดีโอ เหตุผลที่เน้น และฉากที่เล่นตรงนั้น (ชนิดฉาก เห็นหน้าคนไหม และ keepClear = แถบของภาพที่มีหน้าคนหรือของที่โชว์ [บน, ล่าง] เป็นสัดส่วนความสูงจากขอบบน)
```

  Between the tone block (ending "…จะได้สีที่ต่างจากชุดนั้นเอง") and the last paragraph ("เลือกสไตล์หนึ่งแบบ…"), add a paragraph. Nothing else in the prompt changes:

```
อยู่หลังคน: behindPerson เป็น true ให้ตัวหนังสือของชุดนั้นขึ้นบนสุดของจอและอยู่หลังตัวคน หัวของคนบังขอบล่างของตัวหนังสือบางส่วน ชุดอื่นเป็น false
- เลือกเฉพาะจังหวะสำคัญ ข้อความสั้น ตัวใหญ่ บนฉากคนพูดหน้ากล้องที่เห็นคนชัด (ฉากตรงนั้นเป็น talking-head และเห็นหน้าคน)
- ไม่เลือกบนฉากที่ไม่มีคน หรือช่วงสื่อแทรก
- ใช้น้อย เพื่อให้เป็นจุดเด่น
```

  In `HighlightReplySchema`, after `exit`:

```ts
      /** an exit animation id, "" for none */
      exit: z.string(),
      /** the group's text goes behind the person (spec §5.1); a reply that says nothing puts it in front */
      behindPerson: z.boolean().default(false),
```

  Below the `HighlightPoint` type:

```ts
/**
 * What the picture shows while a point plays, as the analysis of the footage described it, for Claude to choose the
 * text that goes behind the person (spec §5.1): whether a person talks to the camera there, the bands of the frame
 * the picture keeps clear (a talking head's face among them) as shares of the height from the top, and the scene's
 * kind. `keepClear` and `scene` are null when the point's video has no pictures analysed.
 */
export interface HighlightPicture {
  face: boolean
  keepClear: { fromY: number; toY: number }[] | null
  scene: string | null
}
```

  In `acceptHighlights`, the `asked` look:

```ts
    const asked: GroupLook = {
      pattern: answer.pattern,
      // a transport that skipped the schema's defaults hands over no tone at all
      tone: answer.tone ?? "base",
      accent: found && { line, from: found.from, to: found.to },
      exit: answer.exit.trim() || null,
      edited: false,
      // behind the person only when Claude said so: a look without the flag is in front (spec §4), so the looks of
      // groups Claude leaves in front are stored as before 0.5.0. A transport that skipped the defaults hands over none
      ...((answer.behindPerson ?? false) ? { behindPerson: true } : {}),
    }
```

  - Add to `acceptHighlights`' doc: "…its look — behind the person when Claude said so — is keyed by its new id…".
  - Below `pointLine`, add:

```ts
/** What the picture shows at a point, as the request says it (the prompt's "ฉากที่เล่นตรงนั้น"): the scene's kind, whether a face is seen, and the bands it keeps clear. */
function pictureLine(picture: HighlightPicture | undefined): string {
  // a video with no pictures analysed says nothing either way, which is not the same as a picture with no face
  if (!picture || picture.keepClear === null) return "ฉากตรงนั้น: ไม่มีข้อมูลภาพ"
  const clear = picture.keepClear.length > 0 ? `keepClear ${picture.keepClear.map((band) => `[${band.fromY}, ${band.toY}]`).join(" ")}` : "keepClear ไม่มี"
  return `ฉากตรงนั้น: ${picture.scene ?? "ไม่รู้ชนิดฉาก"} · ${picture.face ? "เห็นหน้าคน" : "ไม่เห็นหน้าคน"} · ${clear}`
}
```

  `describe` takes the pictures. Only its signature and its last list entry change:

```ts
function describe(args: { brief: Brief; durationUs: number; maxChars: number; landscape: boolean; pro: boolean; points: HighlightPoint[]; pictures?: Record<string, HighlightPicture> }): string {
  // …unchanged down to "จุดเน้น"…
    "จุดเน้น",
    // each point with, under it, what the picture shows there when the caller knows the pictures
    ...args.points.map((point, i) => (args.pictures ? `${pointLine(point, i)}\n    ${pictureLine(args.pictures[point.pointId])}` : pointLine(point, i))),
  ].join("\n")
}
```

  `pickHighlights` takes the pictures:
  - Add the argument after `pro`. `describe({ ...args, landscape, pro })` already spreads it.
  - Its doc becomes "Asks Claude for highlight text on the emphasis points, with a style and each group's look (whether it goes behind the person among it), and keeps what fits."

```ts
  /** what the picture shows at each point, by point id, for the text that goes behind the person; without it the request says nothing of the pictures */
  pictures?: Record<string, HighlightPicture>
```

  In `packages/core/src/highlights/index.ts:3`, add `type HighlightPicture` to the export list from `./pick.ts`.

  In `apps/desktop/src/main/highlights.ts`:
  - Add `type HighlightPicture` to the import from `@boxblack/core/highlights`.
  - Add `sceneAt` to the import from `./highlight-state.ts`.
  - `keepClearsIn` and `PlacedPoint` are imported already.
  - Below `highlightPoints`, add:

```ts
/**
 * What the picture shows while each placed point plays, by point id, for Claude to choose the text that goes behind
 * the person (spec §5.1). It comes from the pictures the analysis already described, as the graphics call is shown
 * them (graphics-cues.ts): the kind of scene playing at the point's first kept moment (sceneAt); a face when that
 * is a person talking to the camera, the only picture text can go behind; and every band the picture keeps clear
 * while the point plays, across its cuts (keepClearsIn, what graphics dodge), each once. A point on a video with no
 * pictures analysed has no facts (keepClear null), which the request says rather than "no face".
 */
function pointPictures(placed: PlacedPoint[], plan: CutPlan, clips: CutClip[]): Record<string, HighlightPicture> {
  const analysed = new Set(clips.flatMap((clip) => (clip.insight ? [clip.id] : [])))
  return Object.fromEntries(
    placed.map((point): [string, HighlightPicture] => {
      if (!analysed.has(point.videoId)) return [point.point.id, { face: false, keepClear: null, scene: null }]
      const scene = sceneAt(clips, point.videoId, point.sourceUs)
      // a point with no length still has the picture of its first moment
      const bands = keepClearsIn(plan, clips, { startUs: point.atUs, endUs: Math.max(point.endUs, point.atUs + 1) })
      // a band two scenes share is said once
      const keepClear = [...new Map(bands.map((band) => [`${band.fromY}:${band.toY}`, band])).values()]
      // the analysis's "a person talking to the camera" (vision/describe.ts SCENE_KINDS)
      return [point.point.id, { face: scene?.kind === "talking-head", keepClear, scene: scene?.kind ?? null }]
    }),
  )
}
```

  - In `pick()`, add one argument to the `pickHighlights({…})` call, after `points: offered,`.
  - Task 13 may have reshaped `pick()`. Put the argument into the `pickHighlights` call wherever it sits now.

```ts
        // what the picture shows at each point, for the text Claude puts behind the person (spec §5.1)
        pictures: pointPictures(placedPoints(stored, plan, clips), plan, clips),
```

- [ ] **Step 5: Run them and see them pass.**

  Run: `npx vitest run packages/core/src/highlights apps/desktop/src/main/highlights.test.ts apps/desktop/src/main/flair.test.ts apps/desktop/src/main/post-flow.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 17: Renderer — the switch, the look menu, the group list, the write page and Settings (spec §9.4, §11)

**Files:**
- Modify: `apps/desktop/src/renderer/src/edit/GraphicsTab.tsx` (switches :33-46, `HighlightTab` :60-70)
- Modify: `apps/desktop/src/renderer/src/edit/HighlightTab.tsx` (whole file below)
- Modify: `apps/desktop/src/renderer/src/edit/LookPopover.tsx` (whole file below)
- Modify: `apps/desktop/src/renderer/src/room/ClipRoom.tsx` (the graphics events effect :430-455)
- Modify: `apps/desktop/src/renderer/src/screens/WriteScreen.tsx` (imports, `DROPPED_NAMES` :35, summary :140-160, checks :188-195, result :228-246)
- Modify: `apps/desktop/src/renderer/src/screens/SettingsScreen.tsx` (`GraphicFilesRow` :201-236)
- Modify: `apps/desktop/src/renderer/src/i18n.ts`
- Modify: `apps/desktop/src/renderer/src/styles/edit.css` (after `.highlight-lines input` ~:339-347)
- Modify: `apps/desktop/src/renderer/test/fake-api.ts`
- Modify: `apps/desktop/src/shared/api.ts` (`API_METHODS` :39, `DesktopApi` :147), `apps/desktop/src/main/settings-api.ts`, `apps/desktop/src/main/index.ts` (the free-space API, below)
- Test: `apps/desktop/src/renderer/src/screens/PostScreen.test.tsx`, `WriteScreen.test.tsx`, `SettingsScreen.test.tsx`, `apps/desktop/src/main/settings-api.test.ts`

**Relies on:**
- Task 12: `FlairOptions.behindPerson`, `FlairLookPatch.behindPerson`, `setLook` keeping every field a patch leaves out.
- Task 13: `HighlightGroupView.behindPerson` and `cutout?: CutoutView`, `CutoutView`, `HighlightPreview.behindPerson` and `cutoutRoute`.
- Task 15: `WriteResult.behindPerson` and `dropped.cutouts`.
- Part D: `DesktopApi.retryCutout(folder, groupId)`.
- Task 10: the `"cutout"` `AppEvent`.
- Task 11: `SettingsView.cutoutFiles`.
- Task 8: `tools.segment` and `tools.segmentHint` with the tools row.

**New main API, stated exactly:** no free-space call exists, so this task adds one.
- `DesktopApi.moviesFreeBytes(): Promise<number | null>` returns the bytes free on the disk that holds `~/Movies`, or null when that cannot be read.
- Its channel is `"moviesFreeBytes"` in `API_METHODS`.
- Its handler is in `createSettingsApi`: a new optional dep `moviesFreeBytes?: () => Promise<number | null>` and a new export `freeBytesAt(path: string): Promise<number | null>`.
- It is wired in `main/index.ts`. The fake answers 500 GB.

- [ ] **Step 1: Bring the fixtures to their 0.5.0 shape.**

  Tasks 12–15 added required fields to shared types that these fixtures implement. They may already have added some values to keep the typecheck green. Keep exactly one copy of each, with the values below: an object literal refuses a key twice.

  In `apps/desktop/src/renderer/test/fake-api.ts`:
  - `settingsView()`: `flair: { enabled: false, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false, behindPerson: true },` (the app's default). Add `cutoutFiles: { count: 0, bytes: 0 },` after `graphicFiles`.
  - `highlightGroups()`: both groups gain `behindPerson: false,` after `look`.
  - `highlightPreview()`, after `proLeftOut`:

```ts
  // no group behind the person, on our own route (CapCut Pro off)
  behindPerson: { laid: 0, front: 0, pending: 0, covered: 0 },
  cutoutRoute: "ours",
```

  - `writeTimeline`'s result: `dropped: { sounds: 0, zooms: 0, inserts: 0, graphics: 0, cutouts: 0 },` and `behindPerson: { laid: 0, front: 0, covered: 0 },`.
  - In `base`, add `moviesFreeBytes: async () => 500_000_000_000,` after `cleanGraphicFiles`, and `retryCutout: async () => {},` after `retryGraphic`.

  In `PostScreen.test.tsx`:
  - `FLAIR_ON` (:794) ends as `{ enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false, behindPerson: false }`. The comment above it is `// text behind the person off, as in the tests before 0.5.0; its own tests turn it on`. With it off, the existing look-menu tests (including "with the looks off a group offers none") keep testing what they tested.
  - The `HighlightGroupView` literal in "lines removed one after another…" (~:340-350) gains `behindPerson: false,`.

  In `WriteScreen.test.tsx:612`, the dropped counts become `dropped: { sounds: 1, zooms: 0, inserts: 0, graphics: 1, cutouts: 0 },`.

- [ ] **Step 2: Write the failing tests.**

  **`PostScreen.test.tsx`:**
  - Add `CutoutView` to the type import from `../../../shared/api.ts`.
  - Put this section after "with the looks off a group offers none", before `/* graphics */`.

```ts
/* text behind the person */

const HIGHLIGHTS_ON = { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }
/** FLAIR_ON with text behind the person on (and `flair` over it), and flairPreview with `extra`. */
const withBehind = (extra: Partial<HighlightPreview> = {}, flair: Partial<FlairOptions> = {}) => ({
  getSettings: async () => settingsView({ highlights: HIGHLIGHTS_ON, flair: { ...FLAIR_ON, behindPerson: true, ...flair } }),
  previewHighlights: async () => flairPreview(extra),
})
/** The fake's first group, behind the person, its person as `cutout` says. */
const behindGroup = (cutout: CutoutView): HighlightGroupView => ({ ...highlightGroups()[0]!, behindPerson: true, cutout })
/** The row of the fake's first group, which the first beat shows. */
const firstGroup = () => screen.getByText(t("highlights.group", { start: "0:00.1", end: "0:02.1" })).closest("li")!
/** Opens the look menu of the first group on screen. */
async function openLook() {
  await userEvent.click((await screen.findAllByRole("button", { name: new RegExp(t("edit.look")) }))[0]!)
  return screen.getByRole("group", { name: t("edit.look") })
}

test("the graphics tab switches text behind the person, says who cuts the person out, and saves the choice", async () => {
  for (const [route, hint, other] of [
    ["ours", "flair.behindPersonHint", "flair.behindPersonHintPro"],
    ["capcut", "flair.behindPersonHintPro", "flair.behindPersonHint"],
  ] as const) {
    const { api } = renderScreen(withBehind({ cutoutRoute: route }))
    await ready()
    await openTab("graphics")
    const toggle = (await within(panel()).findByRole("switch", { name: new RegExp(`^${t("flair.behindPerson")}`) })) as HTMLInputElement
    const words = toggle.closest("label")!.textContent
    expect(words, route).toContain(t(hint))
    expect(words, route).not.toContain(t(other))
    expect(toggle.checked).toBe(true)
    await userEvent.click(toggle)
    expect(api.calls, route).toContainEqual(["updateSettings", { flair: { ...FLAIR_ON, behindPerson: false } }])
    cleanup()
  }
})

test("while text behind the person is on, a group's look menu switches it for that group alone, sending nothing else of the look", async () => {
  const [g1, g2] = highlightGroups()
  const { api } = renderScreen(withBehind({ groups: [{ ...g1!, look: { ...g1!.look, pattern: "stair", tone: "accent" } }, g2!] }))
  await ready()
  await openTab("graphics")
  const look = await openLook()
  const behind = within(look).getByRole("switch", { name: t("flair.look.behindPerson") }) as HTMLInputElement
  expect(behind.checked).toBe(false)
  await userEvent.click(behind)
  // not the pattern, tone or exit on screen: setLook keeps every field the patch leaves out (spec §11)
  expect(calls(api, "setFlairLook")).toEqual([["setFlairLook", FOLDER, "g1", { behindPerson: true }]])
})

test("with the text looks off, the look menu still opens for text behind the person and holds only its switch; the looks on again show the pattern, tone and exit as stored", async () => {
  const [g1, g2] = highlightGroups()
  // with the looks off main shows the plain look; the switch shows the stored flag
  let shown = flairPreview({ groups: [{ ...g1!, behindPerson: true }, g2!] })
  const { api } = renderScreen({ ...withBehind({}, { text: false }), previewHighlights: async () => shown })
  await ready()
  await openTab("graphics")
  const look = await openLook()
  expect(within(look).queryByRole("radiogroup", { name: t("flair.pattern") })).toBeNull()
  expect(within(look).queryByRole("radiogroup", { name: t("flair.tone") })).toBeNull()
  expect(within(look).queryByRole("combobox", { name: t("flair.accent") })).toBeNull()
  expect(within(look).queryByRole("combobox", { name: t("flair.exit") })).toBeNull()
  const behind = within(look).getByRole("switch", { name: t("flair.look.behindPerson") }) as HTMLInputElement
  expect(behind.checked).toBe(true)
  await userEvent.click(behind)
  expect(calls(api, "setFlairLook")).toEqual([["setFlairLook", FOLDER, "g1", { behindPerson: false }]])

  // the looks on again: main shows the look it kept, which the switch never touched
  shown = flairPreview({ groups: [{ ...g1!, look: { pattern: "stair", tone: "accent", accent: null, exit: "spin-out", edited: true } }, g2!] })
  await userEvent.click(within(panel()).getByRole("switch", { name: new RegExp(`^${t("flair.text")}`) }))
  await waitFor(() => expect(placing()).toBe(false))
  const again = await openLook()
  await waitFor(() => expect((within(again).getByRole("radio", { name: "บันไดสลับซ้ายขวา" }) as HTMLInputElement).checked).toBe(true))
  expect((within(again).getByRole("radio", { name: t("flair.tone.accent") }) as HTMLInputElement).checked).toBe(true)
  expect((within(again).getByRole("combobox", { name: t("flair.exit") }) as HTMLSelectElement).value).toBe("spin-out")
  expect(calls(api, "setFlairLook")).toHaveLength(1)
})

test("with text behind the person off, the look menu has no switch for it, and with the looks off too a group offers no look menu", async () => {
  renderScreen(withBehind({}, { behindPerson: false }))
  await ready()
  await openTab("graphics")
  const look = await openLook()
  expect(within(look).queryByRole("switch", { name: t("flair.look.behindPerson") })).toBeNull()
  cleanup()

  renderScreen(withBehind({}, { behindPerson: false, text: false }))
  await ready()
  await openTab("graphics")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  expect(screen.queryByRole("button", { name: new RegExp(t("edit.look")) })).toBeNull()
})

test("a group behind the person carries a badge and says how its person stands, whatever the state", async () => {
  const cases: [CutoutView, string][] = [
    [{ state: "waiting", coverChecked: true }, t("highlights.cutout.waiting")],
    [{ state: "cutting", progress: 0.42, coverChecked: true }, t("highlights.cutout.cutting", { percent: 42 })],
    [{ state: "ready", coverChecked: true }, t("highlights.cutout.ready")],
    [{ state: "failed", reason: "ffmpeg exited with code 1", coverChecked: true }, t("highlights.cutout.failed")],
    [{ state: "no-person", coverChecked: true }, t("highlights.cutout.noPerson")],
    [{ state: "blocked", reason: "no-helper", coverChecked: false }, t("highlights.cutout.blocked.no-helper")],
    [{ state: "blocked", reason: "unreadable", coverChecked: true }, t("highlights.cutout.blocked.unreadable")],
    [{ state: "blocked", reason: "rotated", coverChecked: true }, t("highlights.cutout.blocked.rotated")],
    [{ state: "blocked", reason: "hdr", coverChecked: true }, t("highlights.cutout.blocked.hdr")],
    [{ state: "blocked", reason: "draft-fps", coverChecked: true }, t("highlights.cutout.blocked.draft-fps")],
    // nothing said of the head check either way
    [{ state: "capcut" }, t("highlights.cutout.capcut")],
  ]
  for (const [cutout, words] of cases) {
    const [, g2] = highlightGroups()
    renderScreen(withBehind({ groups: [behindGroup(cutout), g2!] }))
    await ready()
    await openTab("graphics")
    await screen.findByText(words)
    const row = within(firstGroup())
    expect(row.getByText(t("highlights.behindBadge"))).toBeTruthy()
    // only a failed cut can be tried again, and it says what went wrong
    expect(row.queryByRole("button", { name: t("highlights.cutout.retry") }) !== null, cutout.state).toBe(cutout.state === "failed")
    if (cutout.state === "failed") expect(row.getByText(cutout.reason!)).toBeTruthy()
    // the head check that could not run for want of the helper is said; one that ran, or of which nothing is said, is not
    expect(row.queryByText(t("highlights.cutout.coverUnchecked")) !== null, cutout.state).toBe(cutout.coverChecked === false)
    cleanup()
  }
})

test("a group that is not behind the person has no badge and no status", async () => {
  renderScreen(withBehind())
  await ready()
  await openTab("graphics")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  expect(within(firstGroup()).queryByText(t("highlights.behindBadge"))).toBeNull()
  expect(document.querySelector(".cutout-status")).toBeNull()
})

test("a failed cut is tried again from its row, and the groups are placed again", async () => {
  const [, g2] = highlightGroups()
  const { api } = renderScreen(withBehind({ groups: [behindGroup({ state: "failed", reason: "boom", coverChecked: true }), g2!] }))
  await ready()
  await openTab("graphics")
  await screen.findByText(t("highlights.cutout.failed"))
  await waitFor(() => expect(placing()).toBe(false))
  const before = calls(api, "previewHighlights").length
  await userEvent.click(within(firstGroup()).getByRole("button", { name: t("highlights.cutout.retry") }))
  expect(api.calls).toContainEqual(["retryCutout", FOLDER, "g1"])
  await waitFor(() => expect(calls(api, "previewHighlights").length).toBeGreaterThan(before))
})

test("a group whose head covers its text a lot says so; one that is not covered says nothing of it", async () => {
  const [, g2] = highlightGroups()
  renderScreen(withBehind({ groups: [behindGroup({ state: "ready", covered: true, coverChecked: true }), g2!] }))
  await ready()
  await openTab("graphics")
  expect(await screen.findByText(t("highlights.cutout.covered"))).toBeTruthy()
  cleanup()

  renderScreen(withBehind({ groups: [behindGroup({ state: "ready", covered: false, coverChecked: true }), g2!] }))
  await ready()
  await openTab("graphics")
  await screen.findByText(t("highlights.cutout.ready"))
  expect(screen.queryByText(t("highlights.cutout.covered"))).toBeNull()
})
```

  - Next to the graphics event tests (after "graphics events for another project read nothing", ~:2786), add:

```ts
const cutting = (hash: string, done: number): AppEvent => ({ type: "cutout", folder: FOLDER, hash, state: "progress", done, total: 90 })

test("a burst of cutout events reads the preview once at once and once after it, never more often", async () => {
  const { api, previews } = await graphicsEvents()
  act(() => api.emit(cutting("c1", 1)))
  expect(previews()).toBe(1)
  act(() => {
    vi.advanceTimersByTime(20)
    api.emit(cutting("c1", 2))
  })
  act(() => {
    vi.advanceTimersByTime(20)
    api.emit({ type: "cutout", folder: FOLDER, hash: "c1", state: "done" })
  })
  expect(previews()).toBe(1)
  // the last of the burst is always read, or a row would stay on "กำลังตัดคน"
  act(() => vi.advanceTimersByTime(459))
  expect(previews()).toBe(1)
  act(() => vi.advanceTimersByTime(1))
  expect(previews()).toBe(2)
  act(() => vi.advanceTimersByTime(2_000))
  expect(previews()).toBe(2)
})

test("cutout events for another project read nothing", async () => {
  const { api, previews } = await graphicsEvents()
  act(() => {
    api.emit({ type: "cutout", folder: "/drafts/0815", hash: "c1", state: "done" })
    api.emit({ type: "cutout", folder: "/drafts/0815", hash: "c2", state: "progress", done: 1, total: 9 })
  })
  act(() => vi.advanceTimersByTime(1_000))
  expect(previews()).toBe(0)
})

test("a person cut out in the background shows as soon as it is made, without holding the room up", async () => {
  const [, g2] = highlightGroups()
  const previews = heldPreviews(() => flairPreview({ groups: [behindGroup({ state: "cutting", progress: 0.5, coverChecked: true }), g2!] }))
  const { api } = renderScreen({ ...withBehind(), previewHighlights: previews.previewHighlights })
  await ready()
  await openTab("graphics")
  await screen.findByText(t("highlights.cutout.cutting", { percent: 50 }))
  await waitFor(() => expect(placing()).toBe(false))
  previews.holding = true
  act(() => api.emit({ type: "cutout", folder: FOLDER, hash: "c1", state: "done" }))
  expect(previews.held).toHaveLength(1)
  expect(placing()).toBe(false)
  await act(async () => previews.held[0]!.resolve(flairPreview({ groups: [behindGroup({ state: "ready", coverChecked: true }), g2!] })))
  expect(screen.getByText(t("highlights.cutout.ready"))).toBeTruthy()
  expect(placing()).toBe(false)
})
```

  **`WriteScreen.test.tsx`:**
  - Add `CutoutView` and `HighlightGroupView` to the type import from `../../../shared/api.ts`.
  - Put this section after "the summary says nothing of CapCut Pro when nothing is left out for it".

```ts
/* text behind the person */

/** The fake's two groups, both behind the person, their people as said. */
const behindGroups = (first: CutoutView, second: CutoutView): HighlightGroupView[] => {
  const [g1, g2] = highlightGroups()
  return [
    { ...g1!, behindPerson: true, cutout: first },
    { ...g2!, behindPerson: true, cutout: second },
  ]
}
const withPreview = (preview: () => ReturnType<typeof highlightPreview>, extra: Partial<RendererApi> = {}): Partial<RendererApi> => ({
  getSettings: async () => textAndSubtitles(),
  previewHighlights: async () => preview(),
  ...extra,
})

test("the summary counts the groups behind the person, those still being cut, those drawn in front and those the head covers, each only when there are some", async () => {
  renderWrite(withPreview(() => highlightPreview({ groups: highlightGroups(), behindPerson: { laid: 2, front: 1, pending: 1, covered: 1 } })))
  await ready()
  const summary = card("write.summaryTitle")
  expect(await summary.findByText(t("write.behindLaid", { count: 2 }))).toBeTruthy()
  for (const line of [t("write.behindPending", { count: 1 }), t("write.behindFront", { count: 1 }), t("write.behindCovered", { count: 1 })]) {
    expect(summary.getByText(line)).toBeTruthy()
  }
  cleanup()

  // nothing waits, nothing is drawn in front, no head covers: the groups behind the person alone
  renderWrite(withPreview(() => highlightPreview({ groups: highlightGroups(), behindPerson: { laid: 2, front: 0, pending: 0, covered: 0 } })))
  await ready()
  const settled = card("write.summaryTitle")
  expect(await settled.findByText(t("write.behindLaid", { count: 2 }))).toBeTruthy()
  for (const line of [t("write.behindPending", { count: 0 }), t("write.behindFront", { count: 0 }), t("write.behindCovered", { count: 0 })]) {
    expect(settled.queryByText(line)).toBeNull()
  }
  cleanup()

  // no group behind the person: no line of it at all
  renderWrite(withPreview(() => highlightPreview({ groups: highlightGroups() })))
  await ready()
  const none = card("write.summaryTitle")
  await none.findByText(t("write.text", { groups: 2, lines: 3 }))
  expect(none.queryByText(t("write.behindLaid", { count: 0 }))).toBeNull()
})

test("people still being cut out on our own route are counted with a bar; they hold nothing, and a failed one is a warning", async () => {
  const [g1, g2] = highlightGroups()
  const groups: HighlightGroupView[] = [
    { ...g1!, behindPerson: true, cutout: { state: "ready", coverChecked: true } },
    { ...g1!, id: "g3", behindPerson: true, cutout: { state: "cutting", progress: 0.5, coverChecked: true } },
    { ...g1!, id: "g4", behindPerson: true, cutout: { state: "failed", reason: "boom", coverChecked: true } },
    { ...g1!, id: "g5", behindPerson: true, cutout: { state: "no-person", coverChecked: true } },
    { ...g2!, behindPerson: true, cutout: { state: "waiting", coverChecked: true } },
    // drawn in front before anything is cut: no job of the queue
    { ...g2!, id: "g6", behindPerson: true, cutout: { state: "blocked", reason: "hdr", coverChecked: true } },
  ]
  renderWrite(withPreview(() => highlightPreview({ groups, cutoutRoute: "ours" })))
  await ready()
  const checks = card("write.checksTitle")
  // made, failed and with nobody in it are finished: three of five; the one being cut counts for its half
  const going = t("write.cutoutRenders", { done: 3, total: 5 })
  expect(await checks.findByText(going)).toBeTruthy()
  const row = checkRow(going)
  expect(pillOf(row)).toBe(t("write.check.going"))
  expect(within(row).getByRole("progressbar", { name: going }).getAttribute("aria-valuenow")).toBe("70")
  expect(within(row).getByText(t("write.cutoutGoing"))).toBeTruthy()
  expect(pillOf(checkRow(t("write.cutoutFailed", { count: 1 })))).toBe(t("write.check.warn"))
  // main waits for the people when it writes, so the button does not
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  cleanup()

  // every person made or found empty: the row passes, with no note
  renderWrite(withPreview(() => highlightPreview({ groups: behindGroups({ state: "ready", coverChecked: true }, { state: "no-person", coverChecked: true }), cutoutRoute: "ours" })))
  await ready()
  const done = t("write.cutoutRenders", { done: 2, total: 2 })
  await card("write.checksTitle").findByText(done)
  expect(pillOf(checkRow(done))).toBe(t("write.check.ok"))
  expect(card("write.checksTitle").queryByText(t("write.cutoutGoing"))).toBeNull()
  cleanup()

  // CapCut cuts the people on the Pro route: no row of ours
  renderWrite(withPreview(() => highlightPreview({ groups: behindGroups({ state: "capcut", coverChecked: true }, { state: "capcut", coverChecked: true }), cutoutRoute: "capcut" })))
  await ready()
  await card("write.summaryTitle").findByText(t("write.text", { groups: 2, lines: 3 }))
  expect(card("write.checksTitle").queryByText(/ตัดคน/)).toBeNull()
})

test("the room the people still to cut need is said on our own route, and is a warning when ~/Movies has less than twice that free", async () => {
  // g1 shows 2 s and g2 1.4 s, both of intro.mov at 1080×1920: (10.5 + 15) MB a second × 3.4 s
  const waiting = () => highlightPreview({ groups: behindGroups({ state: "waiting", coverChecked: true }, { state: "cutting", progress: 0.5, coverChecked: true }), cutoutRoute: "ours" })
  const need = t("write.cutoutSpace", { size: "87 MB" })
  const { api } = renderWrite(withPreview(waiting, { moviesFreeBytes: async () => 100_000_000 }))
  await ready()
  expect(await card("write.checksTitle").findByText(need)).toBeTruthy()
  await waitFor(() => expect(pillOf(checkRow(need))).toBe(t("write.check.warn")))
  expect(within(checkRow(need)).getByText(t("write.cutoutSpaceLow", { free: "100 MB" }))).toBeTruthy()
  expect(calls(api, "moviesFreeBytes").length).toBeGreaterThan(0)
  cleanup()

  // plenty of room (the fake's 500 GB): the row passes and says no more
  renderWrite(withPreview(waiting))
  await ready()
  await card("write.checksTitle").findByText(need)
  await waitFor(() => expect(pillOf(checkRow(need))).toBe(t("write.check.ok")))
  expect(card("write.checksTitle").queryByText(/พื้นที่ว่างเหลือ/)).toBeNull()
  cleanup()

  // a smaller video makes smaller files: 720×1280 is 4/9 of 1080×1920
  const small = detail({ videos: [{ ...detail().videos[0]!, width: 720, height: 1280 }, detail().videos[1]!] })
  renderWrite(withPreview(waiting, { inspectProject: async () => small }), { project: small })
  await ready()
  expect(await card("write.checksTitle").findByText(t("write.cutoutSpace", { size: "39 MB" }))).toBeTruthy()
  cleanup()

  // nothing left to cut: no row
  renderWrite(withPreview(() => highlightPreview({ groups: behindGroups({ state: "ready", coverChecked: true }, { state: "ready", coverChecked: true }), cutoutRoute: "ours" })))
  await ready()
  await card("write.checksTitle").findByText(t("write.cutoutRenders", { done: 2, total: 2 }))
  expect(card("write.checksTitle").queryByText(/ใช้พื้นที่ราว/)).toBeNull()
})

test("the result counts what went behind the person, what was drawn in front and what the head covers, and the person pieces too short for a frame; nothing of it when none", async () => {
  const base = fakeApi()
  let next = { pieces: 5, behind: { laid: 2, front: 1, covered: 1 }, cutouts: 1 }
  renderWrite({
    writeTimeline: async (...args) => {
      const written = await base.writeTimeline(...args)
      return { ...written, segmentCount: next.pieces, behindPerson: next.behind, dropped: { ...written.dropped, cutouts: next.cutouts } }
    },
  })
  await ready()
  await writeNow()
  const result = card("write.resultTitle")
  expect(await result.findByText(t("write.behindLaid", { count: 2 }))).toBeTruthy()
  for (const line of [t("write.behindFront", { count: 1 }), t("write.behindCovered", { count: 1 }), t("write.resultDropped", { what: t("flair.behindPerson"), count: 1 })]) {
    expect(result.getByText(line)).toBeTruthy()
  }
  // the write waited for every person first: nothing is still being cut
  expect(result.queryByText(/กำลังตัดคน/)).toBeNull()

  next = { pieces: 7, behind: { laid: 0, front: 0, covered: 0 }, cutouts: 0 }
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
  await userEvent.click(againButton())
  expect(await result.findByText(wrote(7))).toBeTruthy()
  expect(result.queryByText(t("write.behindLaid", { count: 0 }))).toBeNull()
  expect(result.queryByText(t("write.resultDropped", { what: t("flair.behindPerson"), count: 0 }))).toBeNull()
})
```

  **`SettingsScreen.test.tsx`**, after "once cleaning empties the folder, the row and its result stay so the user sees what happened":

```ts
test("the cut-out people are sized beside the rendered graphics, and the one clean takes both", async () => {
  const api = renderWith(
    [settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 }, cutoutFiles: { count: 2, bytes: 120_000_000 } })],
    { cleanGraphicFiles: async () => ({ trashed: 5, blockedBy: null, kept: null }) },
  )
  expect(await screen.findByText(t("settings.graphicFiles", { count: 3, size: formatBytes(40_000_000) }))).toBeTruthy()
  expect(screen.getByText(t("settings.renderedCutouts", { count: 2, size: formatBytes(120_000_000) }))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(api.calls).toContainEqual(["cleanGraphicFiles"])
  expect(await screen.findByText(t("settings.graphicFilesCleaned", { count: 5 }))).toBeTruthy()
})

test("with cut-out people and no graphics the row still shows, and offers the clean", async () => {
  renderWith([settingsView({ graphicFiles: { count: 0, bytes: 0 }, cutoutFiles: { count: 2, bytes: 120_000_000 } })])
  expect(await screen.findByText(t("settings.renderedCutouts", { count: 2, size: formatBytes(120_000_000) }))).toBeTruthy()
  expect(screen.getByRole("button", { name: t("settings.graphicFilesClean") })).toBeTruthy()
})

test("with no cut-out people the row says nothing of them", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 }, cutoutFiles: { count: 0, bytes: 0 } })])
  await screen.findByText(t("settings.graphicFilesHint"))
  expect(screen.queryByText(t("settings.renderedCutouts", { count: 0, size: formatBytes(0) }))).toBeNull()
})
```

  **`apps/desktop/src/main/settings-api.test.ts`:**
  - `setup`'s `extra` gains `moviesFreeBytes?: () => Promise<number | null>`, passed through like the others: `...(extra.moviesFreeBytes ? { moviesFreeBytes: extra.moviesFreeBytes } : {}),`.
  - Import `freeBytesAt` from `./settings-api.ts`.
  - Add:

```ts
test("the room free on the disk ~/Movies is on is read from the file system, and is null when it cannot be", async () => {
  expect(await freeBytesAt(tmpdir())).toBeGreaterThan(0)
  expect(await freeBytesAt(join(tmpdir(), "boxblack-no-such-folder", "inside"))).toBeNull()
  const { api } = await setup({ moviesFreeBytes: async () => 123_000_000 })
  expect(await api.moviesFreeBytes()).toBe(123_000_000)
  // a build that knows no such folder answers null, which the write page takes as "not known"
  const { api: bare } = await setup()
  expect(await bare.moviesFreeBytes()).toBeNull()
})
```

- [ ] **Step 3: Run them and see them fail.**

  Run: `npx vitest run apps/desktop/src/renderer apps/desktop/src/main/settings-api.test.ts`

  Expected: FAIL.
  - There is no switch, badge, status, retry or the new write rows.
  - The cutout events read nothing.
  - `moviesFreeBytes` does not exist in main.
  - The earlier renderer tests still pass.

- [ ] **Step 4: Implement.**

  **The free-space API.**
  - In `shared/api.ts`, add `"moviesFreeBytes",` to `API_METHODS` right after `"cleanGraphicFiles",`, and add this to `DesktopApi` after `cleanGraphicFiles()`:

```ts
  /** the bytes free on the disk ~/Movies is on, where the people for text behind them are cut out; null when it cannot be read */
  moviesFreeBytes(): Promise<number | null>
```

  - In `main/settings-api.ts`:
    - Add `import { statfs } from "node:fs/promises"`.
    - Add `| "moviesFreeBytes"` to the `SettingsApi` Pick, after `"cleanGraphicFiles"`.
    - Add the dep and the function:

```ts
/**
 * The bytes free for the user on the disk that holds `path` (statfs: the blocks free to a non-root user × the block
 * size), or null when it cannot be read, a missing folder say. The write page warns when the people still to be cut
 * out may not fit (spec §11).
 */
export async function freeBytesAt(path: string): Promise<number | null> {
  try {
    const disk = await statfs(path)
    return disk.bavail * disk.bsize
  } catch {
    return null
  }
}
```

```ts
  /** the bytes free on the disk ~/Movies is on, where the people for text behind them are cut out; null when unknown */
  moviesFreeBytes?: () => Promise<number | null>
```

```ts
    async moviesFreeBytes() {
      return deps.moviesFreeBytes ? deps.moviesFreeBytes() : null
    },
```

  - In `main/index.ts`:
    - Import `freeBytesAt` with `createSettingsApi`.
    - In the `createSettingsApi({…})` call, add `moviesFreeBytes: () => freeBytesAt(join(homedir(), "Movies")),` after `graphicFiles,`.
    - The method needs no license (it is not in `LICENSED_METHODS`).

  **`i18n.ts`.** If an earlier task added one of these keys already (Task 15 may have added `flair.behindPerson` for `DROPPED_NAMES`), keep one copy.

  - After `"flair.graphicHint": …,`:

```ts
  "flair.behindPerson": "ตัวหนังสืออยู่หลังคน",
  "flair.behindPersonHint": "Claude เลือกข้อความเด่นบางชุดไปไว้หลังตัวคน · ไฟล์ตัวคนใช้พื้นที่ราว 10 MB ต่อวินาที",
  "flair.behindPersonHintPro": "Claude เลือกข้อความเด่นบางชุดไปไว้หลังตัวคน · CapCut จะตัดคนให้ตอนเปิดโปรเจค",
```

  - After `"flair.edited": "คุณตั้งเอง",`:

```ts
  "flair.look.behindPerson": "อยู่หลังคน",
```

  - After `"highlights.addLabel": "ทำ \"{text}\" เป็นข้อความเด่น",`:

```ts
  "highlights.behindBadge": "หลังคน",
  "highlights.cutout.waiting": "รอตัดคน",
  "highlights.cutout.cutting": "กำลังตัดคน {percent}%",
  "highlights.cutout.ready": "ตัดคนแล้ว",
  "highlights.cutout.failed": "ตัดคนไม่สำเร็จ ชุดนี้วาดไว้หน้าคน",
  "highlights.cutout.noPerson": "ไม่เจอคนในช่วงนี้ ชุดนี้วาดไว้หน้าคน",
  "highlights.cutout.capcut": "CapCut จะตัดคนให้ตอนเปิดโปรเจค (ต้องมี CapCut Pro ตอน export)",
  "highlights.cutout.retry": "ลองใหม่",
  "highlights.cutout.blocked.no-helper": "ไม่มีตัวตัดคนบนเครื่องนี้ ชุดนี้วาดไว้หน้าคน",
  "highlights.cutout.blocked.unreadable": "อ่านไฟล์ต้นฉบับไม่ได้ ชุดนี้วาดไว้หน้าคน",
  "highlights.cutout.blocked.rotated": "ต้นฉบับเป็นวิดีโอที่หมุนภาพ ยังตัดคนไม่ได้ ชุดนี้วาดไว้หน้าคน",
  "highlights.cutout.blocked.hdr": "ต้นฉบับเป็น HDR ยังตัดคนไม่ได้ ชุดนี้วาดไว้หน้าคน",
  "highlights.cutout.blocked.draft-fps": "โปรเจคนี้ไม่ใช่ 30 fps ยังตัดคนไม่ได้ ชุดนี้วาดไว้หน้าคน",
  "highlights.cutout.covered": "หัวบังข้อความมาก อาจอ่านไม่ออก",
  "highlights.cutout.coverUnchecked": "ตรวจหัวบังไม่ได้ (ไม่มีตัวตัด)",
```

  - After `"write.proLeftOut": …,`:

```ts
  "write.behindLaid": "ข้อความอยู่หลังคน {count} ชุด",
  "write.behindPending": "กำลังตัดคน {count} ชุด",
  "write.behindFront": "วาดไว้หน้าคน {count} ชุด",
  "write.behindCovered": "หัวบังข้อความมาก {count} ชุด",
```

  - After `"write.check.graphicsFailed": "กราฟิก {count} ชิ้นเรนเดอร์ไม่สำเร็จ จะถูกข้าม",`:

```ts
  "write.cutoutRenders": "ตัดคนเสร็จ {done} จาก {total} ชุด",
  "write.cutoutGoing": "เขียนได้เลย ตอนเขียนจะรอให้ตัดคนที่เหลือเสร็จก่อน ชุดที่ไม่สำเร็จจะวาดไว้หน้าคน",
  "write.cutoutFailed": "ตัดคน {count} ชุดไม่สำเร็จ จะวาดไว้หน้าคน · ลองใหม่ได้ในแท็บกราฟิกและเทคนิค",
  "write.cutoutSpace": "ตัดคนที่เหลือใช้พื้นที่ราว {size}",
  "write.cutoutSpaceLow": "พื้นที่ว่างเหลือ {free} ไม่ถึงสองเท่าของที่ต้องใช้ ควรเคลียร์พื้นที่ในเครื่องก่อน",
```

  - After `"settings.graphicFiles": "ไฟล์กราฟิกที่เรนเดอร์ไว้ {count} ไฟล์ ({size})",`:

```ts
  "settings.renderedCutouts": "ไฟล์ตัวคนที่ตัดไว้ {count} ไฟล์ ({size})",
```

  - The row and the clean now cover both folders, and the queue of people counts as busy (spec §7.4). These three existing values change:

```ts
  "settings.graphicFilesHint": "ไฟล์อยู่ใต้ ~/Movies/CapCut/BOXBLACK (graphics และ cutouts) แอปไม่ลบเอง เพราะโปรเจกต์ CapCut อาจยังใช้อยู่",
  "settings.graphicFilesStopped": "หยุดกลางทางเพราะเริ่มเรนเดอร์ ตัดคน หรือเขียนลง CapCut — ย้ายไปแล้ว {count} ไฟล์ ลองใหม่เมื่อเสร็จ",
  "settings.graphicFilesBlockedBusy": "ยังไม่ได้ย้ายไฟล์ไหน: กำลังเรนเดอร์กราฟิก ตัดคน หรือเขียนลง CapCut อยู่ ลองใหม่เมื่อเสร็จ",
```

  - `tools.segment` and `tools.segmentHint` are Task 8's, with the tools row. Do not add them again. The wording Task 8 is expected to have:
    - `"tools.segment": "ตัวตัดคน (boxblack-segment)"`
    - `"tools.segmentHint": "มากับแอป ใช้ตัดคนเพื่อให้ข้อความเด่นอยู่หลังคน · ถ้าใช้ไม่ได้ ข้อความจะอยู่หน้าคนแทน"`

  **`edit/LookPopover.tsx`** in full:

```tsx
import { patternsFor } from "@boxblack/core/flair/catalogue"
import { TONES, type Tone } from "@boxblack/core/flair/plan"
import type { FlairLookPatch, HighlightGroupView, HighlightPreview, TextPattern } from "../../../shared/api.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Field } from "../ui/Field.tsx"
import { Group } from "../ui/Group.tsx"
import { Popover } from "../ui/Popover.tsx"
import { Segmented } from "../ui/Segmented.tsx"
import { Select } from "../ui/Select.tsx"
import { Switch } from "../ui/Switch.tsx"

/** The words of a line the accent can fall on; CapCut colours whole words, not letters. */
const wordsOf = (text: string): string[] => [...new Set(text.split(/\s+/).filter((word) => word.length > 0))]

export interface LookPopoverProps {
  open: boolean
  onClose: () => void
  group: HighlightGroupView
  /** the text looks are on: the group's layout, colour, coloured word and exit are offered */
  looks: boolean
  /** text behind the person is on (the graphics tab's switch): the group's own switch for it is offered */
  behindPerson: boolean
  /** wide output: the patterns that only work on portrait are not offered */
  landscape: boolean
  busy: boolean
  /** the exit animations the user may have (the preview's list) */
  exits: HighlightPreview["exits"]
  onLook: (groupId: string, patch: FlairLookPatch) => void
}

/** How one group of highlight text looks — its layout, its colour, its coloured word, how it leaves — and whether it goes behind the person. */
export function LookPopover({ open, onClose, group, looks, behindPerson, landscape, busy, exits, onLook }: LookPopoverProps) {
  const accent = group.look.accent
  // an exit held for want of CapCut Pro is kept when the rest of the look changes, so turning Pro on brings it back
  const exit = group.heldExit?.id ?? group.look.exit
  // a change keeps the rest of the look as it shows now, so what is saved is what the user saw
  const change = (patch: FlairLookPatch) => onLook(group.id, { pattern: group.look.pattern, tone: group.look.tone, exit, ...patch })
  const accentValue = accent ? `${accent.line}:${[...(group.lines[accent.line]?.text ?? "")].slice(accent.from, accent.to).join("")}` : ""

  return (
    <Popover open={open} label={t("edit.look")} onClose={onClose}>
      <h3 className="popover-title">{t("edit.look")}</h3>
      {looks && (
        <>
          <Group label={t("flair.pattern")}>
            <Segmented
              label={t("flair.pattern")}
              value={group.look.pattern}
              options={patternsFor(landscape).map((entry) => ({ value: entry.id, label: entry.name }))}
              disabled={busy}
              onChange={(pattern) => change({ pattern: pattern as TextPattern })}
            />
          </Group>
          <Group label={t("flair.tone")}>
            <Segmented
              label={t("flair.tone")}
              value={group.look.tone}
              options={TONES.map((tone) => ({ value: tone, label: t(`flair.tone.${tone}` as MessageKey) }))}
              disabled={busy}
              onChange={(tone) => change({ tone: tone as Tone })}
            />
          </Group>
          <Field label={t("flair.accent")}>
            <Select
              label={t("flair.accent")}
              value={accentValue}
              disabled={busy}
              onChange={(value) => {
                const [line, ...rest] = value.split(":")
                // the line's place on screen, and in the stored group, which differ once a line above it is cut
                change({ accent: value ? { line: Number(line), lineIndex: group.lines[Number(line)]!.index, word: rest.join(":") } : null })
              }}
            >
              <option value="">{t("flair.accent.none")}</option>
              {group.lines.flatMap((line, index) =>
                wordsOf(line.text).map((word) => (
                  <option key={`${index}:${word}`} value={`${index}:${word}`}>
                    {word}
                  </option>
                )),
              )}
            </Select>
          </Field>
          {/* without CapCut Pro no exit is offered, since every one needs it: the line says why. A held exit keeps
              the select on, so the user can still drop it */}
          <Field label={t("flair.exit")} hint={exits.length === 0 ? t("flair.exit.allPro") : undefined}>
            <Select label={t("flair.exit")} value={exit ?? ""} disabled={busy || (exits.length === 0 && !group.heldExit)} onChange={(value) => change({ exit: value || null })}>
              <option value="">{t("flair.exit.none")}</option>
              {group.heldExit && <option value={group.heldExit.id}>{t("flair.exit.heldPro", { name: group.heldExit.name })}</option>}
              {exits.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      {/* a change of its own: nothing else of the look goes with it, so a look the switched-off text looks hide (the
          plain one shows meanwhile) is not written over, and turning the looks on brings it back as it was (spec §11).
          It shows the stored flag, which the look in force leaves out while the looks are off */}
      {behindPerson && (
        <Switch label={t("flair.look.behindPerson")} checked={group.behindPerson} disabled={busy} onChange={(on) => onLook(group.id, { behindPerson: on })} />
      )}
      {group.look.edited && <span className="hint">{t("flair.edited")}</span>}
    </Popover>
  )
}
```

  **`edit/HighlightTab.tsx`** in full (`LineInput` is unchanged):

```tsx
import { useId, useState } from "react"
import type { CutoutView, EmphasisPointView, FlairLookPatch, HighlightGroupView, HighlightLineView, HighlightPreview } from "../../../shared/api.ts"
import { formatTimestamp } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Empty } from "../ui/Empty.tsx"
import { FromPoint } from "./FlairTab.tsx"
import { LookPopover } from "./LookPopover.tsx"

/** One line, saved when the user leaves it or presses Enter; a cleared line is removed. */
function LineInput({ group, line, number, busy, onEdit }: { group: HighlightGroupView; line: HighlightLineView; number: number; busy: boolean; onEdit: HighlightTabProps["onEdit"] }) {
  // …unchanged…
}

/** Why a group behind the person is drawn in front before anything is cut (spec §6.2, §12), in words. */
const BLOCK_WORDS = {
  "no-helper": "highlights.cutout.blocked.no-helper",
  unreadable: "highlights.cutout.blocked.unreadable",
  rotated: "highlights.cutout.blocked.rotated",
  hdr: "highlights.cutout.blocked.hdr",
  "draft-fps": "highlights.cutout.blocked.draft-fps",
} as const satisfies Record<string, MessageKey>

/** How a group's cut-out person stands, in words. */
function cutoutText(cutout: CutoutView): string {
  switch (cutout.state) {
    case "waiting":
      return t("highlights.cutout.waiting")
    case "cutting":
      return t("highlights.cutout.cutting", { percent: Math.round((cutout.progress ?? 0) * 100) })
    case "ready":
      return t("highlights.cutout.ready")
    case "failed":
      return t("highlights.cutout.failed")
    case "no-person":
      return t("highlights.cutout.noPerson")
    case "blocked":
      // a reason the screen has no words for reads as a source that cannot be read
      return t(cutout.reason !== undefined && Object.hasOwn(BLOCK_WORDS, cutout.reason) ? BLOCK_WORDS[cutout.reason as keyof typeof BLOCK_WORDS] : "highlights.cutout.blocked.unreadable")
    case "capcut":
      return t("highlights.cutout.capcut")
  }
}

/**
 * How a group behind the person stands (spec §11): its person waiting, being cut or made, or why the group is drawn
 * in front of the person; a failed cut, with what went wrong, can be tried again. Then whether the head covers the
 * text a lot, or that it could not be checked with no helper to measure it.
 */
function CutoutStatus({ groupId, cutout, busy, onRetry }: { groupId: string; cutout: CutoutView; busy: boolean; onRetry: (groupId: string) => void }) {
  // every group's retry reads the same, so each is described by its own status
  const textId = useId()
  const front = cutout.state === "failed" || cutout.state === "no-person" || cutout.state === "blocked"
  return (
    <p className="cutout-status">
      <span id={textId} className={front ? "warn-text" : undefined}>
        {cutoutText(cutout)}
      </span>
      {cutout.state === "failed" && cutout.reason && <span className="hint">{cutout.reason}</span>}
      {cutout.state === "failed" && (
        <Button size="xs" disabled={busy} aria-describedby={textId} onClick={() => onRetry(groupId)}>
          {t("highlights.cutout.retry")}
        </Button>
      )}
      {cutout.covered && <span className="warn-text">{t("highlights.cutout.covered")}</span>}
      {cutout.coverChecked === false && <span className="hint">{t("highlights.cutout.coverUnchecked")}</span>}
    </p>
  )
}

export interface HighlightTabProps {
  groups: HighlightGroupView[]
  /** every point on the cut, to say which one a group was made for */
  points: EmphasisPointView[]
  busy: boolean
  /** `text` null removes the line */
  onEdit: (groupId: string, index: number, text: string | null) => void
  onRemove: (groupId: string) => void
  /** the text looks are on: each group offers its own */
  looks: boolean
  /** text behind the person is on (the graphics tab's switch): each group offers its own switch for it, looks or not */
  behindPerson: boolean
  landscape: boolean
  /** the exit animations the user may have (the preview's list) */
  exits: HighlightPreview["exits"]
  onLook: (groupId: string, patch: FlairLookPatch) => void
  /** tries the cut-out people of a group whose cut failed again */
  onRetryCutout: (groupId: string) => void
}

/** The highlight text of one beat, or of the whole clip: each group with its lines, editable and removable. */
export function HighlightTab({ groups, points, busy, onEdit, onRemove, looks, behindPerson, landscape, exits, onLook, onRetryCutout }: HighlightTabProps) {
  const [looking, setLooking] = useState<string | null>(null)
  if (groups.length === 0) return <Empty title={t("edit.textEmpty")} hint={t("edit.textEmptyHint")} />

  return (
    <ol className="highlight-groups">
      {groups.map((group) => {
        return (
          <li key={group.id} className="highlight-group">
            <div className="highlight-head">
              <b className="mono">{t("highlights.group", { start: formatTimestamp(group.startUs), end: formatTimestamp(group.endUs) })}</b>
              <span className="tag">{t(group.source === "ai" ? "highlights.source.ai" : "highlights.source.user")}</span>
              {group.cutout && <span className="tag">{t("highlights.behindBadge")}</span>}
              <FromPoint points={points} pointId={group.pointId} />
              {group.placement !== "fixed" && <span className="hint">{t(`highlights.dodge.${group.placement}` as MessageKey)}</span>}
              <span className="grow" />
              {/* the menu holds the looks and the group's own switch for text behind the person: it opens while either is on */}
              {(looks || behindPerson) && (
                <span className="look-anchor">
                  <Button size="sm" aria-expanded={looking === group.id} onClick={() => setLooking(looking === group.id ? null : group.id)}>
                    {`⚙︎ ${t("edit.look")}`}
                  </Button>
                  <LookPopover
                    open={looking === group.id}
                    onClose={() => setLooking(null)}
                    group={group}
                    looks={looks}
                    behindPerson={behindPerson}
                    landscape={landscape}
                    busy={busy}
                    exits={exits}
                    onLook={onLook}
                  />
                </span>
              )}
              <Button size="sm" disabled={busy} onClick={() => onRemove(group.id)}>
                {t("highlights.removeGroup")}
              </Button>
            </div>
            {group.cutout && <CutoutStatus groupId={group.id} cutout={group.cutout} busy={busy} onRetry={onRetryCutout} />}
            <ol className="highlight-lines">
              {/* …the lines, unchanged… */}
            </ol>
          </li>
        )
      })}
    </ol>
  )
}
```

  **`edit/GraphicsTab.tsx`:**
  - Right after the `flair.text` switch:

```tsx
        {/* Claude's choice group by group (spec §5.1); the hint says who cuts the person out, which the preview's route tells */}
        <Switch
          label={t("flair.behindPerson")}
          hint={t(preview.cutoutRoute === "capcut" ? "flair.behindPersonHintPro" : "flair.behindPersonHint")}
          checked={flair.behindPerson}
          disabled={writing}
          onChange={(behindPerson) => room.changeFlair({ ...flair, behindPerson })}
        />
```

  - The `HighlightTab` gains two props, next to `looks` and `onLook`:

```tsx
            behindPerson={flair.behindPerson}
            onRetryCutout={(groupId) => edit(() => api.retryCutout(folder, groupId))}
```

  **`room/ClipRoom.tsx`**, in the effect that reads graphics made in the background:
  - The comment above the effect becomes: "each graphic rendered, and each person cut out for text behind them, in the background shows as soon as it is made. A burst of them is read at once and then at most every GRAPHICS_REFRESH_MS, always once more after the last, or a row would stay on "rendering" or "กำลังตัดคน"; neither renderer sends anything when a preview queues nothing, so this cannot loop".
  - The listener's test becomes:

```ts
      // the renderer pack is in: graphics that waited for it are read again, which starts their renders
      const packInstalled = event.type === "graphics-pack" && event.state === "done"
      // a graphic rendered, or a person cut out for text behind them (spec §7.3), in this project
      const made = (event.type === "graphics" || event.type === "cutout") && event.folder === folder
      if ((!packInstalled && !made) || due !== undefined) return
```

  **`screens/WriteScreen.tsx`:**

```tsx
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react"
import type { CutoutView, FlairLevel, HighlightGroupView, ProjectDetail, StoredOutline, WriteResult } from "../../../shared/api.ts"
import { formatBytes, formatDuration } from "../format.ts"
```

```tsx
/** What the writers left out, by kind, named as the switches name them. */
const DROPPED_NAMES: Record<keyof WriteResult["dropped"], MessageKey> = { sounds: "flair.sound", zooms: "flair.zoom", inserts: "flair.insert", graphics: "flair.graphic", cutouts: "flair.behindPerson" }

/** A person our own helper still has to cut out, and one it is done with: made, failed, or with nobody in it. */
const CUTTING: ReadonlySet<CutoutView["state"]> = new Set(["waiting", "cutting"])
const CUT: ReadonlySet<CutoutView["state"]> = new Set(["ready", "failed", "no-person"])

/**
 * About how much room a second of cut-out person takes while it is made at 1080×1920: its file (about 10.5 MB) and
 * the work files beside it (about 15 MB). First figures (spec §11), to be set again from a real job (§13 item 7).
 */
const CUTOUT_BYTES_A_SECOND = (10.5 + 15) * 1_000_000
/** The frame the figure above is for. */
const FULL_HD_PORTRAIT = 1080 * 1920

/** The pixels of a person file of this video: the source's size, no more than 1080 on its short side (spec §7.2 item 4). */
function cutoutPixels(width: number, height: number): number {
  const shrink = Math.min(1, 1080 / Math.min(width, height))
  return width * shrink * height * shrink
}

/**
 * About how many bytes the people not cut out yet will take on the disk ~/Movies is on: every behind group whose
 * person is waiting or being cut, for as long as it shows, at the size of the video its beat plays.
 */
function cutoutBytesNeeded(groups: HighlightGroupView[], stored: StoredOutline, project: ProjectDetail): number {
  return groups.reduce((sum, group) => {
    if (!group.cutout || !CUTTING.has(group.cutout.state)) return sum
    const videoId = stored.outline.beats.find((beat) => beat.id === group.beatId)?.videoId
    const video = project.videos.find((candidate) => candidate.id === videoId)
    // a video of no known size counts as the frame the figure is for
    const share = video && video.width > 0 && video.height > 0 ? cutoutPixels(video.width, video.height) / FULL_HD_PORTRAIT : 1
    return sum + ((group.endUs - group.startUs) / 1_000_000) * CUTOUT_BYTES_A_SECOND * share
  }, 0)
}
```

  In `WriteScreen`, after `const off = …`:

```tsx
  // text behind the person: what the summary counts, the people our own helper cuts out, and the room they still need (spec §11)
  const behind = preview?.behindPerson ?? { laid: 0, front: 0, pending: 0, covered: 0 }
  const ours = preview?.cutoutRoute === "ours"
  const cutouts = ours ? (preview?.groups ?? []).flatMap((group) => (group.cutout && (CUTTING.has(group.cutout.state) || CUT.has(group.cutout.state)) ? [group.cutout] : [])) : []
  const cutDone = cutouts.filter((cutout) => CUT.has(cutout.state)).length
  const cutFailed = cutouts.filter((cutout) => cutout.state === "failed").length
  // the one being cut counts for as far as it has got
  const cutShare = cutouts.length === 0 ? 0 : (cutDone + cutouts.reduce((sum, cutout) => sum + (cutout.state === "cutting" ? (cutout.progress ?? 0) : 0), 0)) / cutouts.length
  const spaceNeeded = ours && preview ? cutoutBytesNeeded(preview.groups, stored, project) : 0
  // the free room is asked for again whenever the room needed changes by a megabyte
  const neededMb = Math.ceil(spaceNeeded / 1_000_000)
  const [freeBytes, setFreeBytes] = useState<number | null>(null)
  useEffect(() => {
    if (neededMb === 0) return
    let live = true
    api.moviesFreeBytes().then(
      (free) => live && setFreeBytes(free),
      () => live && setFreeBytes(null),
    )
    return () => {
      live = false
    }
  }, [api, neededMb])
  // less than twice what is needed is worth a look; nothing is said until main has said how much is free
  const spaceLow = freeBytes !== null && freeBytes < 2 * spaceNeeded
```

  The summary gets these lines right after the `write.text` `<li>`:

```tsx
            {/* how many groups go behind the person, wait for their person, are drawn in front, and have their text covered a lot */}
            {highlightsOn && behind.laid + behind.pending + behind.front > 0 && (
              <>
                <li>{t("write.behindLaid", { count: behind.laid })}</li>
                {behind.pending > 0 && <li>{t("write.behindPending", { count: behind.pending })}</li>}
                {behind.front > 0 && <li className="warn-text">{t("write.behindFront", { count: behind.front })}</li>}
                {behind.covered > 0 && <li className="warn-text">{t("write.behindCovered", { count: behind.covered })}</li>}
              </>
            )}
```

  The checks get these rows right after the `graphicsFailed` row:

```tsx
            {/* people still being cut out hold nothing here: main waits for them before it touches the draft */}
            {cutouts.length > 0 && (
              <Check state={cutDone === cutouts.length ? "ok" : "going"} text={t("write.cutoutRenders", { done: cutDone, total: cutouts.length })}>
                <Progress value={cutShare} label={t("write.cutoutRenders", { done: cutDone, total: cutouts.length })} />
                {cutDone < cutouts.length && <span className="check-note">{t("write.cutoutGoing")}</span>}
              </Check>
            )}
            {cutFailed > 0 && <Check state="warn" text={t("write.cutoutFailed", { count: cutFailed })} />}
            {spaceNeeded > 0 && (
              <Check state={spaceLow ? "warn" : "ok"} text={t("write.cutoutSpace", { size: formatBytes(spaceNeeded) })}>
                {spaceLow && <span className="check-note">{t("write.cutoutSpaceLow", { free: formatBytes(freeBytes!) })}</span>}
              </Check>
            )}
```

  The result card gets these rows right after `write.resultText`. The loop over `DROPPED_NAMES` already names the person pieces that were too short:

```tsx
                  {/* the same as the summary but for the waiting: the write waited for every person first */}
                  {result.behindPerson.laid + result.behindPerson.front > 0 && <li>{t("write.behindLaid", { count: result.behindPerson.laid })}</li>}
                  {result.behindPerson.front > 0 && <li className="warn-text">{t("write.behindFront", { count: result.behindPerson.front })}</li>}
                  {result.behindPerson.covered > 0 && <li className="warn-text">{t("write.behindCovered", { count: result.behindPerson.covered })}</li>}
```

  **`screens/SettingsScreen.tsx`**, `GraphicFilesRow` in full:

```tsx
/**
 * The rendered graphics, and the people cut out for text behind them, that no draft uses any more: offered right
 * after the renderer pack row. One clean takes both folders (spec §7.4); each is sized on its own line.
 */
function GraphicFilesRow({ api, view, run }: { api: RendererApi; view: SettingsView; run: Run }) {
  const [cleaned, setCleaned] = useState<GraphicCleanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const files = view.graphicFiles.count + view.cutoutFiles.count

  // a clean that trashed everything must not make the row, and its result, vanish with the counts
  if (files === 0 && cleaned === null) return null

  const clean = async () => {
    // a fresh attempt must not leave an earlier result on screen next to whatever this one says
    setCleaned(null)
    setBusy(true)
    try {
      await run(async () => setCleaned(await api.cleanGraphicFiles()))
    } finally {
      setBusy(false)
    }
  }

  return (
    <RowCard>
      <span className="row-label">
        {t("settings.graphicFiles", { count: view.graphicFiles.count, size: formatBytes(view.graphicFiles.bytes) })}
        {/* the people are far larger a second than the graphics, so they are sized apart */}
        {view.cutoutFiles.count > 0 && <span>{t("settings.renderedCutouts", { count: view.cutoutFiles.count, size: formatBytes(view.cutoutFiles.bytes) })}</span>}
        <span className="hint">{t("settings.graphicFilesHint")}</span>
        {/* always mounted, as ui/Toast.tsx does, so the result is announced as it changes rather than appearing already-read */}
        <span role="status" className={cleaned?.blockedBy ? "error-text" : "hint"}>
          {cleaned && cleanResult(cleaned)}
        </span>
      </span>
      {files > 0 && (
        <Button size="sm" disabled={busy} onClick={() => void clean()}>
          {t("settings.graphicFilesClean")}
        </Button>
      )}
    </RowCard>
  )
}
```

  **`styles/edit.css`**, after the `.highlight-lines input` rule:

```css
/* where a group behind the person stands: its person being cut, made, or why the group is drawn in front */
.cutout-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin: 0;
  font-size: 12px;
  color: var(--sub);
}
```

- [ ] **Step 5: Run them and see them pass.**

  Run: `npx vitest run apps/desktop/src/renderer apps/desktop/src/main/settings-api.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 18: Docs, version 0.5.0 and the full check

**Files:**
- Modify: `apps/desktop/package.json` (`"version": "0.4.3"`)
- Modify: `docs/specs/2026-09-17-capcut-timeline-manager-design.md` (a new milestone after the M25 block, before `## 7. Open items`, and one open item)
- Modify: `docs/specs/2026-09-27-post-production-design.md` §14 (a new `### 0.5.0` at the end)
- Modify: `docs/specs/2026-09-29-text-behind-person-design.md:3` (status)

Fill `<วันที่ออก>` with the day of the release (`date +%F`). Fill `<F>`, `<P>` and `<S>` from Step 5. The mutation and live-test lines stay for the controller (Task 19): write no mutation claim here.

- [ ] **Step 1: Set `"version": "0.5.0"` in `apps/desktop/package.json`.**

- [ ] **Step 2: Add the milestone to the main spec.**

  It is a milestone of its own, since M26 (colour) was cancelled. Put it after the 0.4.3 line of the M25 block, before the blank lines above `## 7. Open items`. The file names are the ones the plan's tasks touched; check them against the plan's file map and change any that a task named otherwise.

```markdown
- **M27 ตัวหนังสืออยู่หลังคน: 2026-09-29 – <วันที่ออก> (0.5.0)** · ผู้ใช้เลือกทำบทที่ 7 ของคู่มือ "Let Claude Edit Your Videos" (แยกชั้นคนออกจากฉาก) เป็นฟีเจอร์จริงก่อนข้ออื่น หลังพิสูจน์บน 0917 (2026-09-29 ผู้ใช้: "เหลือนิดหน่อยแต่แค่นี้ก็โอเคแล้ว") ·
  เลือก: Claude เลือกชุดที่อยู่หลังคน ผู้ใช้เปิดปิดทีละชุดได้ · ชุดหลังคนขึ้นบนสุด ให้หัวบังขอบล่างของตัวหนังสือบางส่วน บังมากแอปเตือน · ค่าหลักใช้ตัวตัดคนของเรา เปิด "มี CapCut Pro" แล้วใช้ตัวลบพื้นหลังของ CapCut · เฟรมของตัวคนตรงกับภาพข้างใต้ทุกเฟรมโดยไม่เริ่มก่อน ("เฟรมต้องตรงกันไม่เริ่มก่อน") · ไม่มีเพดานจำนวน prompt บอกให้ใช้น้อย ·
  สเปก `docs/specs/2026-09-29-text-behind-person-design.md` (ผลพิสูจน์ §13) · แผน `docs/plans/2026-09-29-text-behind-person.md` (19 งาน)
  - **ที่สร้าง:** ป้าย `behindPerson` ต่อชุดในลุค Claude เลือกจากข้อมูลภาพของแต่ละจุด (ชนิดฉาก เห็นหน้าคนไหม keepClear · prompt `highlights-2026-09-30-behind`) · สวิตช์รวม "ตัวหนังสืออยู่หลังคน" ในแท็บกราฟิกและเทคนิค (ค่าเริ่มต้นเปิด ปิดแล้วป้ายยังเก็บอยู่) · ตัวตัดคน `boxblack-segment` (Swift: Vision `.accurate` → guided filter → เฉลี่ยตามเวลา ±2 เฟรม) มากับแอปใน `Resources/bin` · คิวตัดคนของตัวเอง ทำไฟล์ ProRes 4444 ใต้ `~/Movies/CapCut/BOXBLACK/cutouts/<hash>.mov` เฉพาะช่วงที่ชุดขึ้น เฟรมต่อเฟรมจากเฟรมที่ชั้นหลักแสดง ชิ้นตัวคน `source.start` 16,667 µs · ทาง CapCut เขียนสำเนาชิ้นหลักแบบเงียบที่เปิดตัวลบพื้นหลัง (`matting.flag` 3) · ซูมของชิ้นหลักตามลงชั้นตัวคน · คำเตือนหัวบัง (บรรทัดไหนบังเกิน 35%) · ป้าย "หลังคน" สถานะการตัด และปุ่มลองใหม่ในรายการชุด · สวิตช์ "อยู่หลังคน" ในเมนูลุค ส่งแค่ค่านี้ และเปิดได้แม้ปิดท่าข้อความ · หน้าเขียนมีสรุป เช็ก "ตัดคนเสร็จ n จาก m ชุด" กับ "ตัดคนที่เหลือใช้พื้นที่ราว X" (เตือนเมื่อที่ว่างใน ~/Movies ไม่ถึงสองเท่า) และผลลัพธ์ · ตั้งค่ามีแถวเครื่องมือตัวตัดคน และแถวไฟล์บอกขนาดกราฟิกกับตัวคนแยกกัน ปุ่มล้างทำทั้งสองโฟลเดอร์ · สำรองดราฟต์ไม่คัดลอก `matting/`
  - **ลำดับชั้นทุกการเขียน (ตาม `tracks[]`):** วิดีโอหลัก · แถบและตัวหนังสือของชุดหลังคน · ตัวคนหรือสำเนา · สื่อแทรก · กราฟิก · แถบและตัวหนังสือของชุดปกติ · ซับ · เสียง · `track_render_index` = ตำแหน่งของ track → ตั้งแต่ 0.5.0 ข้อความเด่นกับซับอยู่หน้าสื่อแทรกและกราฟิกเสมอ ก่อนหน้านี้สื่อแทรกกับกราฟิกที่ต่อท้ายอาจบังได้
  - **ถอยกลับ:** ไม่มีตัวตัด หรือต้นฉบับไม่รองรับ (หมุน · HDR · ดราฟต์ไม่ใช่ 30 fps · อ่านไม่ได้) = วางตามปกติ วาดหน้าคน · ตัดไม่สำเร็จหรือไม่เจอคน = บนสุด วาดหน้าคน ลองใหม่ได้ · บางช่วงของชุดใช้ไม่ได้ = วาดหน้าทั้งชุด · ทุกกรณีนับ "วาดไว้หน้าคน"
  - **ทดสอบจริงบน 0917:** (Task 19 เติม)
  - **ทดสอบ:** <F> ไฟล์ ผ่าน <P> ข้าม <S> · typecheck ผ่าน · mutation (Task 19 เติม)
```

  Add under `## 7. Open items`:

```markdown
- ตัวตัดคน (M27): Open Anyway ของ macOS ครอบ `boxblack-segment` ไหม · hardened runtime และ notarize เมื่อมี Developer ID · mask ของ Vision บน macOS 12–26 · ตั้ง timeout กับตัวเลขพื้นที่ใหม่หลังวัดงานจริง (สเปก M27 §15)
```

- [ ] **Step 3: Add the release entry to the M25 spec.** Append to `docs/specs/2026-09-27-post-production-design.md`:

```markdown
### 0.5.0 (<วันที่ออก>): ตัวหนังสืออยู่หลังคน

- **ที่มา:** บทที่ 7 ของคู่มือ "Let Claude Edit Your Videos" (แยกชั้นคนออกจากฉาก) พิสูจน์บน 0917 วันที่ 2026-09-29 · สเปก `docs/specs/2026-09-29-text-behind-person-design.md` · แผน `docs/plans/2026-09-29-text-behind-person.md`
- **ผู้ใช้เลือก (2026-09-29):** Claude เลือกชุดที่อยู่หลังคน ผู้ใช้เปิดปิดทีละชุด · ชุดหลังคนขึ้นบนสุด หัวบังขอบล่างของตัวหนังสือบางส่วน บังมากแอปเตือน · ตัวตัดคนของเราเป็นค่าหลัก เปิด "มี CapCut Pro" ใช้ตัวลบพื้นหลังของ CapCut · เฟรมตัวคนตรงกับภาพข้างใต้ทุกเฟรมโดยไม่เริ่มก่อน · ไม่มีเพดานจำนวน (ตามกฎ M25 ไม่มีโควตาต่อชนิด)
- **งาน 2a (ข้อความเด่น):** คำตอบต่อชุดมี `behindPerson` (ไม่ตอบ = อยู่หน้า) · ข้อความที่ส่งให้ Claude มีบรรทัด "ฉากตรงนั้น" ใต้ทุกจุด (ชนิดฉาก เห็นหน้าคนไหม และ keepClear จากภาพที่วิเคราะห์ไว้ แบบที่งานกราฟิกได้) · แนวทาง: เลือกเฉพาะจังหวะสำคัญ ข้อความสั้น ตัวใหญ่ บนฉากคนพูดหน้ากล้อง · ไม่เลือกบนฉากที่ไม่มีคนหรือช่วงสื่อแทรก · ใช้น้อย · prompt `highlights-2026-09-30-behind` · ปิดสวิตช์รวมก็ยังถามและเก็บไว้
- **หน้าโพสต์โปรดักชัน:** สวิตช์ "ตัวหนังสืออยู่หลังคน" ในแท็บกราฟิกและเทคนิค (ค่าเริ่มต้นเปิด) คำอธิบายบอกว่าใครตัดคน · รายการชุดมีป้าย "หลังคน" สถานะ (รอตัดคน · กำลังตัดคน x% · ตัดคนแล้ว · ไม่สำเร็จ พร้อมปุ่มลองใหม่ · ไม่เจอคน · เหตุผลที่ตัดไม่ได้ · CapCut จะตัดให้) และคำเตือนหัวบัง · เมนูลุคมีสวิตช์ "อยู่หลังคน" ที่ส่งแค่ค่านี้ เปิดได้แม้ปิดท่าข้อความ (ตอนนั้นมีแค่สวิตช์นี้) · อ่านตัวอย่างใหม่ตามเหตุการณ์ตัดคน ไม่ถี่กว่าทุก 500 ms
- **หน้าเขียน:** สรุป "ข้อความอยู่หลังคน N ชุด" · "กำลังตัดคน P ชุด" · "วาดไว้หน้าคน M ชุด" · "หัวบังข้อความมาก K ชุด" · เช็ก (ทางเรา) "ตัดคนเสร็จ n จาก m ชุด" ไม่บล็อกการเขียน ไม่สำเร็จเป็นคำเตือน และ "ตัดคนที่เหลือใช้พื้นที่ราว X" เตือนเมื่อที่ว่างใน ~/Movies ไม่ถึงสองเท่า (อ่านจาก `moviesFreeBytes` ใหม่) · ผลลัพธ์บอกตัวเลขชุดเดียวกัน (ไม่มี "กำลังตัด") และชิ้นตัวคนที่ข้ามเพราะสั้นกว่าหนึ่งเฟรม
- **การเขียน:** ลำดับชั้นใหม่ทุกครั้ง (หลัก · แถบและตัวหนังสือของชุดหลังคน · ตัวคนหรือสำเนา · สื่อแทรก · กราฟิก · แถบและตัวหนังสือของชุดปกติ · ซับ · เสียง) ข้อความเด่นและซับจึงอยู่หน้าสื่อแทรกและกราฟิกเสมอ · รอการตัดและคำเตือนหัวบังให้จบก่อนแตะดราฟต์ · ทั้งหมดหรือไม่มีเลยต่อชุด
- **ที่คงไว้:** ระดับความจัดทำงานเหมือนเดิม ชุดที่ระดับซ่อนไม่ถูกตัด ไม่ถูกเขียน ไม่ถูกนับ · ปิดสวิตช์รวม = ทุกชุดอยู่หน้าเหมือน 0.4.3 แต่ป้ายยังเก็บอยู่ · ไฟล์ตัวคนไม่ลบเอง ล้างได้จากตั้งค่า
- **โค้ด:**
  - core: `capcut/rough-cut.ts` (`cutFrames`, `atOn`) · `cutout/` (`ranges.ts`, `frames.ts`, `keyframes.ts`, `occlusion.ts`, `index.ts`) · `capcut/layers.ts` · `capcut/person.ts` · `capcut/bin.ts` (`isRenderedFile`) · `capcut/write.ts` (`backupDraft`) · `flair/plan.ts` · `flair/catalogue.ts` · `highlights/pick.ts` (`HighlightPicture`) · `media/tool-check.ts`
  - helper: `apps/desktop/native/segment/` · `scripts/build-segment.sh` · `scripts/release-check.ts`
  - main: `cutout-probe.ts` · `cutout-render.ts` · `graphics-files.ts` · `highlights.ts` · `highlight-state.ts` · `graphics-cues.ts` · `timeline.ts` · `flair.ts` · `settings.ts` · `settings-api.ts` (`moviesFreeBytes`) · `highlight-api.ts` · `timeline-api.ts` · `tools.ts` · `index.ts`
  - shared: `api.ts`
  - renderer: `edit/GraphicsTab.tsx` · `edit/HighlightTab.tsx` · `edit/LookPopover.tsx` · `room/ClipRoom.tsx` · `screens/WriteScreen.tsx` · `screens/SettingsScreen.tsx` · `components/ToolsCard.tsx` · `i18n.ts` · `styles/edit.css` · `test/fake-api.ts`
- ทดสอบ: <F> ไฟล์ ผ่าน <P> ข้าม <S> · typecheck ผ่าน · mutation และทดสอบจริงบน 0917 (Task 19 เติม)
- `apps/desktop/package.json` 0.5.0
```

- [ ] **Step 4: Mark the feature spec as built.** Line 3 of `docs/specs/2026-09-29-text-behind-person-design.md` becomes:

```markdown
- สถานะ: **ทำแล้วใน 0.5.0 (<วันที่ออก>)** · ออกแบบ 2026-09-29 ผู้ใช้เลือกแนวทางและตรวจสเปกแล้ว · แผน `docs/plans/2026-09-29-text-behind-person.md` · ผลทดสอบจริงอยู่ท้าย §13
```

- [ ] **Step 5: Run the full check.**

  Run: `npm test 2>&1 | tail -6` and `npm run typecheck`.

  Expected:
  - Both are clean.
  - Take the "Test Files" count, the "Tests … passed | … skipped" counts, and put them in place of `<F>`, `<P>` and `<S>` in both entries.

- [ ] **Step 6: Commit.** `npm test` and `npm run typecheck`, both fully green.

---

### Task 19 (controller): Mutation checks, the DMG, and the live test on 0917

**Ground rules:**
- `SP=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad`.
- Every Bash call starts a fresh shell, so each block below starts by sourcing `$SP/r050/env.sh` (Step 0).
- Never run a mutation while another vitest run or a reviewer is at work.
- The live test writes draft 0917 only, after a backup, and restores it at the end.
- Ask the user in Thai.

- [ ] **Step 0: The shared names.**

```sh
mkdir -p /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/live /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/mut050
cat > /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh <<'EOF'
SP=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad
REPO="/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
LIVE=$SP/r050/live
UI="node $SP/m25/live/ui.mjs"
DRAFT="$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"
FOLDER_0917="/Users/ford/Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"
CUTOUTS="$HOME/Movies/CapCut/BOXBLACK/cutouts"
BIN="$REPO/apps/desktop/resources/bin"
EOF
```

- [ ] **Step 1: Mutation lists, written out in full.**
  - Each list is `[name, old, new]` triples, which `mutate.py` swaps one at a time.
  - `old` must occur exactly once.
  - The lists for my own code (Tasks 16–17) match that code. The rest follow the contract's signatures, which Parts A–D must write exactly.
  - Entries named `ADAPT …` stand for logic whose text is not in the contract. Before the run, rewrite each one against the file as built, keeping the intent the name gives.
  - Any other `old` that the pre-check reports as not found exactly once gets the same treatment (give it more context, or split it in two).

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cd $SP/mut050
cat > table.txt <<'EOF'
packages/core/src/cutout/frames.ts|frames.json|packages/core/src/cutout/frames.test.ts packages/core/src/cutout/keyframes.test.ts packages/core/src/capcut/person.test.ts
packages/core/src/cutout/ranges.ts|ranges.json|packages/core/src/cutout/ranges.test.ts
packages/core/src/cutout/keyframes.ts|keyframes.json|packages/core/src/cutout/keyframes.test.ts
packages/core/src/capcut/layers.ts|layers.json|packages/core/src/capcut/layers.test.ts
packages/core/src/capcut/person.ts|person.json|packages/core/src/capcut/person.test.ts
apps/desktop/src/main/cutout-render.ts|cutout-render.json|apps/desktop/src/main/cutout-render.test.ts
apps/desktop/src/main/timeline.ts|timeline.json|apps/desktop/src/main/timeline.test.ts apps/desktop/src/main/highlights.test.ts
apps/desktop/src/main/highlights.ts|highlights.json|apps/desktop/src/main/highlights.test.ts
packages/core/src/highlights/pick.ts|pick.json|packages/core/src/highlights/pick.test.ts
apps/desktop/src/renderer/src/edit/LookPopover.tsx|LookPopover.json|apps/desktop/src/renderer/src/screens/PostScreen.test.tsx
apps/desktop/src/renderer/src/edit/HighlightTab.tsx|HighlightTab.json|apps/desktop/src/renderer/src/screens/PostScreen.test.tsx
apps/desktop/src/renderer/src/screens/WriteScreen.tsx|WriteScreen.json|apps/desktop/src/renderer/src/screens/WriteScreen.test.tsx
apps/desktop/src/renderer/src/room/ClipRoom.tsx|ClipRoom.json|apps/desktop/src/renderer/src/screens/PostScreen.test.tsx
EOF

cat > frames.json <<'EOF'
[
  ["uneven-without-the-microsecond", "askedUs + 1", "askedUs"],
  ["even-without-the-microsecond", "askedUs - 1", "askedUs"],
  ["every-file-uneven", "export function evenFrames(timing: SourceTiming): boolean {", "export function evenFrames(timing: SourceTiming): boolean {\n  return false"],
  ["one-frame-late", "export function personFrames(range: CutoutRange, piece: PieceFrames, timing: SourceTiming, fps: number): number[] {", "export function personFrames(range: CutoutRange, piece: PieceFrames, timing: SourceTiming, fps: number): number[] {\n  range = { ...range, targetStartFrame: range.targetStartFrame + 1, targetStartUs: range.targetStartUs + 33_333 }"],
  ["no-spare-frame", "[frames[0]!, ...frames]", "frames"],
  ["source-start-moved", "PERSON_SOURCE_START_US = 16_667", "PERSON_SOURCE_START_US = 16_666"]
]
EOF

cat > ranges.json <<'EOF'
[
  ["past-the-timeline-end", "usToFrame(durationUs, fps)", "Number.MAX_SAFE_INTEGER"],
  ["start-on-the-frame-below", "usToFrame(group.startUs, fps)", "Math.floor((group.startUs * fps) / 1_000_000)"],
  ["source-from-the-piece-start", "piece.sourceStartUs + (targetStartUs - piece.targetStartUs)", "piece.sourceStartUs"],
  ["first-piece-only", "export function cutoutRanges(groups: { groupId: string; startUs: number; endUs: number }[], pieces: PieceFrames[], fps: number, durationUs: number): CutoutRange[] {", "export function cutoutRanges(groups: { groupId: string; startUs: number; endUs: number }[], pieces: PieceFrames[], fps: number, durationUs: number): CutoutRange[] {\n  pieces = pieces.slice(0, 1)"],
  ["unsorted", ".sort((a, b) => a.targetStartFrame - b.targetStartFrame)", ""]
]
EOF

cat > keyframes.json <<'EOF'
[
  ["value-is-the-first-key", "export function valueAt(keys: KeyframePoint[], t: number): number {", "export function valueAt(keys: KeyframePoint[], t: number): number {\n  return keys[0]!.values[0]!"],
  ["value-is-the-last-key", "export function valueAt(keys: KeyframePoint[], t: number): number {", "export function valueAt(keys: KeyframePoint[], t: number): number {\n  return keys.at(-1)!.values[0]!"],
  ["keys-not-shifted", "export function personKeyframes(main: Keyframes[], range: { sourceStartUs: number; durationUs: number }, offsetUs: number): Keyframes[] {", "export function personKeyframes(main: Keyframes[], range: { sourceStartUs: number; durationUs: number }, offsetUs: number): Keyframes[] {\n  offsetUs = 0"],
  ["no-key-at-the-range-end", "export function personKeyframes(main: Keyframes[], range: { sourceStartUs: number; durationUs: number }, offsetUs: number): Keyframes[] {", "export function personKeyframes(main: Keyframes[], range: { sourceStartUs: number; durationUs: number }, offsetUs: number): Keyframes[] {\n  range = { ...range, durationUs: 0 }"],
  ["copy-keeps-the-ids", "export function copiedKeyframes(main: Keyframes[]): Keyframes[] {", "export function copiedKeyframes(main: Keyframes[]): Keyframes[] {\n  return main"]
]
EOF

cat > layers.json <<'EOF'
[
  ["order-not-applied", "export function arrangeTracks(info: DraftInfo, layers: string[][]): DraftInfo {", "export function arrangeTracks(info: DraftInfo, layers: string[][]): DraftInfo {\n  return structuredClone(info)"],
  ["order-upside-down", "export function arrangeTracks(info: DraftInfo, layers: string[][]): DraftInfo {", "export function arrangeTracks(info: DraftInfo, layers: string[][]): DraftInfo {\n  layers = [...layers].reverse()"],
  ["render-index-one-off", "track_render_index: index", "track_render_index: index + 1"],
  ["added-in-reverse", "export function addedTracks(before: DraftInfo, after: DraftInfo): string[] {", "export function addedTracks(before: DraftInfo, after: DraftInfo): string[] {\n  after = { ...after, tracks: [...after.tracks].reverse() }"],
  ["added-includes-the-old", "export function addedTracks(before: DraftInfo, after: DraftInfo): string[] {", "export function addedTracks(before: DraftInfo, after: DraftInfo): string[] {\n  before = { ...before, tracks: [] }"]
]
EOF

cat > person.json <<'EOF'
[
  ["source-start-zero", "start: PERSON_SOURCE_START_US", "start: 0"],
  ["matting-flag-2", "flag: 3", "flag: 2"],
  ["person-without-zoom", "export function addPersonTrack(info: DraftInfo, people: TimelinePerson[]): { info: DraftInfo; trackId: string | null } {", "export function addPersonTrack(info: DraftInfo, people: TimelinePerson[]): { info: DraftInfo; trackId: string | null } {\n  people = people.map((person) => ({ ...person, keyframes: [] }))"],
  ["matting-path-elsewhere", "export function addMattingTrack(info: DraftInfo, copies: TimelineMattingCopy[]): { info: DraftInfo; trackId: string | null } {", "export function addMattingTrack(info: DraftInfo, copies: TimelineMattingCopy[]): { info: DraftInfo; trackId: string | null } {\n  copies = copies.map((copy) => ({ ...copy, draftFolder: \"/elsewhere\" }))"],
  ["matting-id-lower-case", ".toUpperCase()", ""],
  ["copies-heard", "volume: 0", "volume: 1"]
]
EOF

cat > cutout-render.json <<'EOF'
[
  ["a-person-at-1-percent", "0.02", "0.002"],
  ["nobody-up-to-20-percent", "0.02", "0.2"],
  ["empty-ensure-keeps-the-wanted-set", "ensure(folder: string, jobs: CutoutJob[]): void {", "ensure(folder: string, jobs: CutoutJob[]): void {\n      if (jobs.length === 0) return"],
  ["wait-waits-for-nothing", "wait(folder: string, jobs: CutoutJob[]): Promise<{ ready: string[]; failed: string[]; noPerson: string[] }> {", "wait(folder: string, jobs: CutoutJob[]): Promise<{ ready: string[]; failed: string[]; noPerson: string[] }> {\n      jobs = []"],
  ["ADAPT waited-jobs-not-first", "ADAPT: the line in wait() that raises its jobs to the front of the queue", "ADAPT: the same line leaving them where they were"]
]
EOF

cat > timeline.json <<'EOF'
[
  ["order-not-applied", "arrangeTracks(", "((info: unknown, _layers: unknown) => info)("],
  ["no-person-track", "addPersonTrack(", "((info: unknown) => ({ info, trackId: null }))("],
  ["no-matting-track", "addMattingTrack(", "((info: unknown) => ({ info, trackId: null }))("],
  ["ADAPT person-above-the-cutaways", "ADAPT: the list of layers handed to arrangeTracks", "ADAPT: the same list with the person layer after the cutaways"],
  ["ADAPT subtitles-under-the-normal-text", "ADAPT: the list of layers handed to arrangeTracks", "ADAPT: the same list with the subtitles before the normal text"],
  ["ADAPT part-of-a-group-laid", "ADAPT: the all-or-nothing test that every range of a group can be laid", "ADAPT: the same test passing when any one range can"]
]
EOF

cat > highlights.json <<'EOF'
[
  ["face-for-any-scene", "face: scene?.kind === \"talking-head\"", "face: scene !== null"],
  ["unanalysed-as-no-band", "{ face: false, keepClear: null, scene: null }", "{ face: false, keepClear: [], scene: null }"],
  ["bands-of-the-first-moment", "{ startUs: point.atUs, endUs: Math.max(point.endUs, point.atUs + 1) }", "{ startUs: point.atUs, endUs: point.atUs + 1 }"],
  ["pictures-not-sent", "pictures: pointPictures(placedPoints(stored, plan, clips), plan, clips),", ""],
  ["ADAPT behind-group-not-on-top", "ADAPT: where the effective flag gives a behind group the top placement in view()", "ADAPT: the flag read as false there"],
  ["ADAPT waiting-counted-as-laid", "ADAPT: where a behind group whose person is waiting or being cut is counted pending", "ADAPT: count it laid instead"]
]
EOF

cat > pick.json <<'EOF'
[
  ["behind-flag-dropped", "...((answer.behindPerson ?? false) ? { behindPerson: true } : {}),", ""],
  ["behind-flag-always", "(answer.behindPerson ?? false) ? { behindPerson: true } : {}", "{ behindPerson: true }"],
  ["schema-default-behind", "behindPerson: z.boolean().default(false)", "behindPerson: z.boolean().default(true)"],
  ["face-always-seen", "picture.face ? \"เห็นหน้าคน\" : \"ไม่เห็นหน้าคน\"", "\"เห็นหน้าคน\""],
  ["only-the-first-band", "picture.keepClear.map((band) =>", "picture.keepClear.slice(0, 1).map((band) =>"],
  ["pictures-never-said", "(args.pictures ? ", "(false ? "]
]
EOF

cat > LookPopover.json <<'EOF'
[
  ["behind-sends-the-whole-look", "onChange={(on) => onLook(group.id, { behindPerson: on })}", "onChange={(on) => change({ behindPerson: on })}"],
  ["behind-sends-the-opposite", "onLook(group.id, { behindPerson: on })", "onLook(group.id, { behindPerson: !on })"],
  ["switch-without-its-setting", "{behindPerson && (", "{true && ("],
  ["looks-while-the-looks-are-off", "{looks && (", "{true && ("],
  ["switch-reads-the-look-in-force", "checked={group.behindPerson}", "checked={group.look.behindPerson ?? false}"]
]
EOF

cat > HighlightTab.json <<'EOF'
[
  ["menu-only-with-the-looks", "{(looks || behindPerson) && (", "{looks && ("],
  ["badge-on-every-group", "{group.cutout && <span className=\"tag\">{t(\"highlights.behindBadge\")}</span>}", "<span className=\"tag\">{t(\"highlights.behindBadge\")}</span>"],
  ["percent-as-a-fraction", "Math.round((cutout.progress ?? 0) * 100)", "(cutout.progress ?? 0)"],
  ["unchecked-when-unknown", "cutout.coverChecked === false", "!cutout.coverChecked"],
  ["retry-does-nothing", "onClick={() => onRetry(groupId)}", "onClick={() => {}}"]
]
EOF

cat > WriteScreen.json <<'EOF'
[
  ["space-whatever-the-video", "cutoutPixels(video.width, video.height) / FULL_HD_PORTRAIT", "1"],
  ["space-warns-only-below-the-need", "freeBytes < 2 * spaceNeeded", "freeBytes < spaceNeeded"],
  ["the-one-being-cut-left-out", "new Set([\"waiting\", \"cutting\"])", "new Set([\"waiting\"])"],
  ["a-failed-cut-unfinished", "new Set([\"ready\", \"failed\", \"no-person\"])", "new Set([\"ready\", \"no-person\"])"],
  ["waiting-said-when-none", "{behind.pending > 0 && <li>", "{behind.pending >= 0 && <li>"]
]
EOF

cat > ClipRoom.json <<'EOF'
[
  ["cutout-events-ignored", "(event.type === \"graphics\" || event.type === \"cutout\") && event.folder === folder", "event.type === \"graphics\" && event.folder === folder"],
  ["cutout-events-of-any-project", "(event.type === \"graphics\" || event.type === \"cutout\") && event.folder === folder", "(event.type === \"graphics\" && event.folder === folder) || event.type === \"cutout\""]
]
EOF
```

  - Adjust `table.txt` to the test files the tasks really created. Task 15's write tests may live outside `timeline.test.ts`, for example.
  - Then pre-check every list:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cd "$REPO" && while IFS='|' read -r src list tests; do
  python3 -c 'import json, sys
code = open(sys.argv[1]).read()
for name, old, new in json.load(open(sys.argv[2])):
    if code.count(old) != 1: print(f"{sys.argv[2]}: {name}: found {code.count(old)} times")' "$src" "$SP/mut050/$list"
done < $SP/mut050/table.txt
```

  Expected: no line, once every ADAPT entry and every miss is rewritten against the real code.

- [ ] **Step 2: Run the mutations.** One file at a time, nothing else running. This takes a while, so run it in the background.

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cd "$REPO" && while IFS='|' read -r src list tests; do
  python3 $SP/mutate.py "$src" "$SP/mut050/$list" $tests > "$SP/mut050/${list%.json}.log" 2>&1
  echo "$list: $(tail -1 "$SP/mut050/${list%.json}.log")"
done < $SP/mut050/table.txt | tee $SP/mut050/summary.txt
find packages apps -name "*.orig" -newer $SP/mut050/table.txt
```

  Expected:
  - Every `survived: []`.
  - `find` prints nothing: `mutate.py` put every file back.

  Then:
  - Give each survivor a test that catches it, and run its list again. Or argue it is equivalent, as 0.4.2 did for its two.
  - Run `npm test` once more on the restored tree.
  - Write the result into both Task 18 entries: "mutation N ตัวใน M ไฟล์ จับได้ … (`mut050/`)".

- [ ] **Step 3: Build and check the DMG.**

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cd "$REPO/apps/desktop" && npm run dist > $SP/r050/dist-050.log 2>&1; tail -5 $SP/r050/dist-050.log
APP=release/mac-arm64/BOXBLACK.app
ls -l release/boxblack-0.5.0-arm64.dmg
plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist"          # 0.5.0
ls -l "$APP/Contents/Resources/bin/boxblack-segment" && "$APP/Contents/Resources/bin/boxblack-segment" --version
codesign -dv "$APP/Contents/Resources/bin/boxblack-segment" 2>&1 | head -3            # signed like ffmpeg beside it (record it)
shasum -a 256 "$APP/Contents/Resources/app.asar" | tee $SP/r050/asar-050.txt
# the app inside the DMG is that one
MNT=$(hdiutil attach -nobrowse -readonly release/boxblack-0.5.0-arm64.dmg | tail -1 | cut -f3)
plutil -extract CFBundleShortVersionString raw -o - "$MNT/BOXBLACK.app/Contents/Info.plist"
test -x "$MNT/BOXBLACK.app/Contents/Resources/bin/boxblack-segment" && echo "helper in the DMG"
shasum -a 256 "$MNT/BOXBLACK.app/Contents/Resources/app.asar"
hdiutil detach "$MNT"
```

  Expected:
  - `release-check` passed, so the build ran.
  - The version is 0.5.0 twice.
  - `boxblack-segment <VERSION>` is the one pinned in `scripts/build-segment.sh`.
  - The helper is in the DMG, and both app.asar hashes are the same.
  - Keep the hash for the release note and memory.

- [ ] **Step 4: Prepare the live test.**
  - The test runs the app `npm run dist` just built into `apps/desktop/out`, on the test profile, driven over CDP, as `live-test-cdp.md` says.
  - In development the helper is found at `apps/desktop/resources/bin/boxblack-segment` (`resourcesDir`, main/index.ts:233).
  - CapCut must be closed.

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cd "$REPO" && node $SP/m25/draft-backup.mts backup release-050
# the new backupDraft leaves the draft's matting/ out (CapCut recomputes it): keep a copy so the restore is whole
if [ -d "$DRAFT/matting" ]; then ditto "$DRAFT/matting" $SP/m25/backups/release-050-matting; fi
# what the cut-out folder held before, so only the test's own files go to the Trash
( [ -d "$CUTOUTS" ] && cd "$CUTOUTS" && find . -type f | sort ) > $LIVE/cutouts-before.txt || true
# the test profile's outlines and settings, to put back afterwards
ditto $SP/m25/profile/outlines $LIVE/profile-outlines-before && cp $SP/m25/profile/settings.json $LIVE/profile-settings-before.json
```

  Write the two helper scripts. `groups.js` lists the groups as the post page previews them:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cat > $LIVE/groups.js <<'EOF'
// 0917's groups as the post page previews them: which are behind the person, how their person stands, which cross a cut
const folder = "/Users/ford/Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"
const s = await window.boxblack.getSettings()
const plan = await window.boxblack.previewCut(folder, s.cut)
const view = { position: s.highlights.position, subtitlesOn: s.subtitles.enabled, highlightsOn: s.highlights.enabled, flair: s.flair }
const p = await window.boxblack.previewHighlights(folder, s.cut, view)
let at = 0
const joins = plan.cuts.map((cut) => (at += cut.sourceDurationUs))
JSON.stringify({ route: p.cutoutRoute, counts: p.behindPerson, groups: p.groups.map((g) => ({ id: g.id, from: (g.startUs / 1e6).toFixed(2), to: (g.endUs / 1e6).toFixed(2), text: g.lines.map((l) => l.text).join(" / "), placement: g.placement, stored: g.behindPerson, cutout: g.cutout ?? null, crossesCut: joins.some((j) => g.startUs < j && j < g.endUs) })) }, null, 1)
EOF
cat > $LIVE/wait-plan.js <<'EOF'
// until the plan run on 0917 is over
const folder = "/Users/ford/Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"
for (let i = 0; i < 900; i++) {
  const run = await window.boxblack.postPlanState(folder)
  if (!run?.running) break
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
JSON.stringify(await window.boxblack.postPlanState(folder))
EOF
```

  `check-050.mts` checks the written draft and only reads it:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cat > $LIVE/check-050.mts <<'EOF'
/**
 * The 0.5.0 live checks on draft 0917, read only (its folder is fixed here, like draft-backup.mts): the tracks bottom
 * to top in spec §9.1's order, every segment's track_render_index, the person pieces (our route) or the matting
 * copies (the CapCut route) and their files, where each highlight line sits, and no exit animation without Pro.
 *   node check-050.mts ours|capcut|front [--dump <file.json>]
 * front: a write with every group drawn in front (no helper), so no person or matting track at all.
 * --dump writes what frames3.py needs about each person piece.
 */
import { createHash } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
import { PERSON_SOURCE_START_US } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/cutout/frames.ts"

const FOLDER = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917")
const CUTOUTS = join(homedir(), "Movies/CapCut/BOXBLACK/cutouts") + "/"
const GRAPHICS = join(homedir(), "Movies/CapCut/BOXBLACK/graphics") + "/"
const [route, flag, dumpTo] = process.argv.slice(2)
if (!["ours", "capcut", "front"].includes(route ?? "") || (flag !== undefined && (flag !== "--dump" || !dumpTo))) {
  throw new Error("usage: node check-050.mts ours|capcut|front [--dump <file.json>]")
}

type Range = { start: number; duration: number }
type Keys = { property_type: string; keyframe_list: { time_offset: number; values: number[] }[] }
type Segment = { id: string; material_id: string; source_timerange: Range | null; target_timerange: Range; volume?: number; clip?: { transform?: { y?: number } }; track_render_index?: number; common_keyframes?: Keys[] }
type Track = { id: string; type: string; flag?: number; segments: Segment[] }
type Video = { id: string; path: string; has_audio?: boolean; matting?: { flag?: number; path?: string }; custom_matting_id?: string }

const draft = await loadDraft(FOLDER)
const tracks = draft.info.tracks as unknown as Track[]
const materials = draft.info.materials as Record<string, unknown[]>
const videos = new Map(((materials.videos ?? []) as Video[]).map((video) => [video.id, video]))
const problems: string[] = []
const s = (us: number) => (us / 1e6).toFixed(3)

/** What a track is, from what it holds. */
function kindOf(track: Track, index: number): string {
  if (track.type === "audio") return "audio"
  if (track.type === "sticker") return "bars"
  if (track.type === "text") return track.flag === 1 ? "subtitles" : "text"
  if (track.type !== "video") return track.type
  if (index === 0) return "main"
  const held = track.segments.map((segment) => videos.get(segment.material_id))
  if (held.some((video) => video?.path.startsWith(CUTOUTS))) return "person"
  if (held.some((video) => video?.matting?.flag === 3)) return "matting"
  if (held.some((video) => video?.path.startsWith(GRAPHICS))) return "graphics"
  return "cutaway"
}
const kinds = tracks.map(kindOf)
const layer = kinds.findIndex((kind) => kind === "person" || kind === "matting")
/** spec §9.1, bottom to top: the bars and text under the person layer are the behind groups' */
function rank(kind: string, index: number): number {
  const behind = layer >= 0 && index < layer
  if (kind === "bars") return behind ? 1 : 6
  if (kind === "text") return behind ? 2 : 7
  return ({ main: 0, person: 3, matting: 3, cutaway: 4, graphics: 5, subtitles: 8, audio: 9 } as Record<string, number>)[kind] ?? -1
}
console.log(`tracks bottom to top: ${kinds.map((kind, index) => (layer >= 0 && index < layer && (kind === "bars" || kind === "text") ? `behind ${kind}` : kind)).join(" · ")}`)
kinds.forEach((kind, index) => {
  if (rank(kind, index) < 0) problems.push(`track ${index} is ${kind}, which spec §9.1 does not place`)
  if (index > 0 && rank(kind, index) < rank(kinds[index - 1]!, index - 1)) problems.push(`track ${index} (${kind}) is above track ${index - 1} (${kinds[index - 1]}), against spec §9.1`)
  for (const segment of tracks[index]!.segments) if (segment.track_render_index !== index) problems.push(`segment ${segment.id} on track ${index} has track_render_index ${segment.track_render_index}`)
})
// where each line sits: a behind group's at the top, the others where their placement put them
tracks.forEach((track, index) => {
  if (kinds[index] !== "text") return
  console.log(`${layer >= 0 && index < layer ? "behind" : "normal"} text track ${index}: ${track.segments.map((segment) => `${s(segment.target_timerange.start)} s y ${segment.clip?.transform?.y?.toFixed(3)}`).join(" · ")}`)
})

const main = tracks[0]!.segments
/** The main piece playing at a moment of the timeline. */
const pieceAt = (at: number) => main.find((piece) => piece.target_timerange.start <= at && at < piece.target_timerange.start + piece.target_timerange.duration)
const people = layer >= 0 ? tracks[layer]!.segments : []

if (route === "ours") {
  if (kinds[layer] !== "person") problems.push("no person track")
  for (const segment of people) {
    const video = videos.get(segment.material_id)
    const piece = pieceAt(segment.target_timerange.start)
    const at = `person at ${s(segment.target_timerange.start)} s`
    if (!video) {
      problems.push(`${at}: no material`)
      continue
    }
    if (segment.source_timerange?.start !== PERSON_SOURCE_START_US) problems.push(`${at}: source.start ${segment.source_timerange?.start}, not ${PERSON_SOURCE_START_US}`)
    if (segment.source_timerange?.duration !== segment.target_timerange.duration) problems.push(`${at}: its source lasts other than its target`)
    if (segment.volume !== 0) problems.push(`${at}: volume ${segment.volume}`)
    if (video.has_audio !== false) problems.push(`${at}: has_audio ${video.has_audio}`)
    if (!existsSync(video.path) || !existsSync(video.path.replace(/\.mov$/, ".json"))) problems.push(`${at}: ${video.path} or its .json is missing`)
    if (!piece) problems.push(`${at}: no main piece under it`)
    else {
      if (JSON.stringify(segment.clip) !== JSON.stringify(piece.clip)) problems.push(`${at}: its clip differs from its main piece's`)
      if ((piece.common_keyframes?.length ?? 0) > 0 && (segment.common_keyframes?.length ?? 0) === 0) problems.push(`${at}: its main piece zooms and it does not`)
    }
    console.log(`${at} · ${s(segment.target_timerange.duration)} s · ${video.path.slice(CUTOUTS.length)} · key lists ${segment.common_keyframes?.length ?? 0}`)
  }
}
if (route === "capcut") {
  if (kinds[layer] !== "matting") problems.push("no matting track")
  if ([...videos.values()].some((video) => video.path.startsWith(CUTOUTS))) problems.push("a person file in a CapCut-route write")
  for (const segment of people) {
    const video = videos.get(segment.material_id)
    const piece = pieceAt(segment.target_timerange.start)
    const at = `copy at ${s(segment.target_timerange.start)} s`
    if (!video) {
      problems.push(`${at}: no material`)
      continue
    }
    const md5 = createHash("md5").update(video.path, "utf8").digest("hex")
    if (video.matting?.flag !== 3) problems.push(`${at}: matting.flag ${video.matting?.flag}`)
    if (video.matting?.path !== `${FOLDER}/matting/${md5}`) problems.push(`${at}: matting.path ${video.matting?.path}`)
    if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(video.custom_matting_id ?? "")) problems.push(`${at}: custom_matting_id ${video.custom_matting_id}`)
    if (segment.volume !== 0) problems.push(`${at}: volume ${segment.volume}`)
    if (!piece || piece.material_id === segment.material_id) problems.push(`${at}: no main piece under it, or it shares that piece's material`)
    else if (segment.source_timerange?.start !== piece.source_timerange!.start + (segment.target_timerange.start - piece.target_timerange.start)) problems.push(`${at}: not its piece's own source moment`)
    console.log(`${at} · ${s(segment.target_timerange.duration)} s · matting …${video.matting?.path?.slice(FOLDER.length)}`)
  }
}
if (route === "front" && layer >= 0) problems.push(`a ${kinds[layer]} track in a write with every group in front`)
if (route !== "capcut") {
  // without CapCut Pro every exit needs it (0.4.3): none is written
  const animations = (materials.material_animations ?? []) as { animations?: { type?: string }[] }[]
  const exits = animations.flatMap((material) => material.animations ?? []).filter((entry) => entry.type === "out").length
  if (exits > 0) problems.push(`${exits} exit animations in a write without Pro`)
}
if (dumpTo) {
  const keys = (segment: Segment, name: string) => segment.common_keyframes?.find((list) => list.property_type === name)?.keyframe_list.map((key) => [key.time_offset, key.values[0]]) ?? []
  const dumped = people.map((segment) => {
    const piece = pieceAt(segment.target_timerange.start)!
    return {
      file: videos.get(segment.material_id)!.path,
      source: videos.get(piece.material_id)!.path,
      targetStartUs: segment.target_timerange.start,
      targetDurationUs: segment.target_timerange.duration,
      personSourceStartUs: segment.source_timerange!.start,
      // the source moment the main piece plays where the person piece starts
      mainSourceUs: piece.source_timerange!.start + (segment.target_timerange.start - piece.target_timerange.start),
      scale: keys(segment, "KFTypeScaleX"),
      positionY: keys(segment, "KFTypePositionY"),
    }
  })
  writeFileSync(dumpTo, JSON.stringify({ fps: draft.info.fps, people: dumped }, null, 1))
  console.log(`dumped ${dumped.length} person pieces to ${dumpTo}`)
}
console.log(problems.length === 0 ? "ALL CHECKS PASS" : `CHECKS FAIL\n- ${problems.join("\n- ")}`)
if (problems.length > 0) process.exitCode = 1
EOF
```

  `frames3.py` measures frame matching on the export. It is `$SP/behind/frames2.py` with these changes (`cp $SP/behind/frames2.py $LIVE/frames3.py`, then edit):
  1. **Usage.** `python3 frames3.py <export.mov> <written.json>`.
     - The ranges are `json.load(open(argv[2]))["people"]`, as `check-050.mts --dump` wrote them.
     - `FILES`, `SRC`, `jobs2.json`, `written2-ids.json` and `keys_of` go.
     - Each range's own `file` and `source` paths take their place.
     - The Homebrew ffmpeg stays: the bundled one has no rawvideo muxer.
  2. **The frames of a range.** `first = round(targetStartUs × 30 / 1e6)` and `n = round(targetDurationUs × 30 / 1e6)`. The export frames are `first … first + n − 1`.
  3. **The expected main frame at export frame f.** `t = floor(f × 1e6 / 30)` and `u = mainSourceUs + (t − targetStartUs)`. The expected frame is the latest i with `pts_us[i] ≤ u + 1`, using `$SP/behind/pts.json` (0917 is uneven; spec §7.2).
  4. **The person file.**
     - Decode it once as RGBA. It must have `n + 1` frames; say so and stop if not.
     - Its frame for f is `f − first + 1`: frame 0 is the spare.
     - The candidate person frames of f are those of f − 2 … f + 2. Each stands for the expected source frame of its own export frame. This replaces frames2's `seq`/`fidx`.
  5. **The zoom at f.** Read it from the dumped keys at `t_file = personSourceStartUs + (t − targetStartUs)`: `scale = value_at(scale)` and `pos_y = value_at(positionY)`. A piece with no keys is 1 and 0.
  6. **Output.** As frames2 gives: per range, the person − main and main − expected histograms, weak margins and mean error, into `frames3-<i>.csv`.
     - It passes when both histograms are `{0: n}` in every range.
     - It prints `ALL FRAMES MATCH` or the ranges that slip.

- [ ] **Step 5: (a) CapCut Pro off: Claude's groups, one across a cut, written behind the person.**
  - Start the app in the background (the Bash tool's `run_in_background`): `cd "$REPO" && npx electron $SP/m25/app --remote-debugging-port=9333 > $LIVE/app-a.log 2>&1` (after sourcing env.sh).
  - Then:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
$UI wait "โปรเจค" 60000
$UI eval "(await window.boxblack.getSettings()).appVersion"          # 0.5.0
$UI eval "(await window.boxblack.getSettings()).capcut"              # { pro: false }
$UI click "ตั้งค่า" && $UI text | grep -n "boxblack-segment"          # the tools row shows the helper
$UI click "โปรเจค" && $UI click "0917" && $UI click "โพสต์โปรดักชัน" && $UI click "กราฟิกและเทคนิค"
$UI list "ตัวหนังสืออยู่หลังคน"                                         # the switch: on (click it if not)
$UI click "ตัดเสร็จแล้ว วางแผน post-production"
$UI eval $LIVE/wait-plan.js
$UI eval $LIVE/groups.js > $LIVE/groups-planned.json
```

  - Read `groups-planned.json`. It needs at least one behind group (`stored: true`), and one behind group with `crossesCut: true`.
  - If Claude chose none that crosses a cut, turn one on by hand in its look menu. Then time that one job from the toggle to its made person (spec §13 item 7):

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
$UI click "ทั้งคลิป"
$UI list "รูปลักษณ์"                     # one per group in time order: n is the crossing group's place
$UI click "รูปลักษณ์" <n> && $UI click "อยู่หลังคน" && date +%s > $LIVE/cut-start.txt && $UI key Escape
$UI wait "!รอตัดคน" 900000 && $UI wait "!กำลังตัดคน" 900000 && date +%s > $LIVE/cut-end.txt
ls -l "$CUTOUTS" > $LIVE/cutouts-after-a.txt
$UI eval $LIVE/groups.js > $LIVE/groups-a.json
```

  - Check `groups-a.json`:
    - Every behind group is `ready` (or `no-person`/`failed`, with the reason noted).
    - The counts match: `laid` = the ready ones, and `pending` 0.
    - Behind groups carry the top placement.
  - Work out, and keep in `$LIVE/timing.txt`:
    - seconds of work per second of video (cut-end − cut-start over the group's length);
    - MB per second of the new `.mov` files.
  - Then write:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
$UI click "ไปเขียนลง CapCut ›" && $UI wait "ตัดคนเสร็จ" 60000 && $UI shot $LIVE/write-a-before.png
$UI click "เขียนลง CapCut" && $UI wait "เขียนแล้ว" 900000
$UI text > $LIVE/write-a.txt && $UI shot $LIVE/write-a-result.png
node $LIVE/check-050.mts ours --dump $LIVE/written-a.json | tee $LIVE/check-a.txt
pkill -f "m25/app --remote-debugging-port=9333"
```

  Expected:
  - `ALL CHECKS PASS`:
    - the tracks in spec §9.1's order (main · behind bars and text · person · cutaways · graphics · normal bars and text · subtitles · audio);
    - every person piece at `source.start` 16667 with its file;
    - no exit animation.
  - The result card counts "ข้อความอยู่หลังคน N ชุด" as the preview did.

  Ask the user, in Thai, to:
  - open 0917 in CapCut and export it to `~/Desktop/ตัด/1/0917-050.mov` (1080p, 30 fps);
  - check that the text is behind the person with no flicker at the person's edge, including across the cut;
  - check that the zooms show no double image;
  - check that the subtitles and the normal highlight text are on top of everything, the cutaways and graphics too;
  - then close CapCut.

  Then measure:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
python3 $LIVE/frames3.py "$HOME/Desktop/ตัด/1/0917-050.mov" $LIVE/written-a.json | tee $LIVE/frames-a.txt
```

  Expected: `ALL FRAMES MATCH`, with the person layer and the main layer on the expected source frame in every frame of every range. If it slips, stop and tell the user before (b).

- [ ] **Step 6: (b) The fallback: no helper, then a helper that cannot cut.**
  - Per spec §5.3 and §12:
    - With no helper, a behind group is **placed as usual** (not at the top), drawn in front, and counted `front`.
    - A cut that **fails** keeps the group **at the top**, drawn in front, counted `front`, with "ลองใหม่".
  - Both are checked.
  - After each `pkill`, start the app again in the background as in Step 5.

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
mv "$BIN/boxblack-segment" "$BIN/boxblack-segment.off"
# (start the app again)
$UI wait "โปรเจค" 60000 && $UI click "0917" && $UI click "กราฟิกและเทคนิค" && $UI click "ทั้งคลิป"
$UI wait "ไม่มีตัวตัดคนบนเครื่องนี้" 60000 && $UI wait "ตรวจหัวบังไม่ได้"
$UI eval $LIVE/groups.js > $LIVE/groups-b.json     # every behind group: blocked "no-helper", its usual placement; counts all front
$UI click "ไปเขียนลง CapCut ›" && $UI click "เขียนลง CapCut" && $UI wait "เขียนแล้ว" 900000 && $UI text > $LIVE/write-b.txt
node $LIVE/check-050.mts front | tee $LIVE/check-b.txt
pkill -f "m25/app --remote-debugging-port=9333"
mv "$BIN/boxblack-segment.off" "$BIN/boxblack-segment" && "$BIN/boxblack-segment" --version
```

  Expected:
  - `write-b.txt` says "วาดไว้หน้าคน N ชุด", N being all the behind groups.
  - `ALL CHECKS PASS` for `front`: no person track, every line on the normal text tracks.
  - The Settings tools row said the helper is missing.

  Then a helper that probes and samples but whose every render fails:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
mv "$BIN/boxblack-segment" "$BIN/boxblack-segment.real"
cat > "$BIN/boxblack-segment" <<'EOF'
#!/bin/sh
# the 0.5.0 live test: --version, probe and sample as the real helper; every render fails (spec §12 "ตัดล้มเหลว")
if [ "$1" = "render" ]; then echo "forced failure for the 0.5.0 live test" >&2; exit 1; fi
exec "$(dirname "$0")/boxblack-segment.real" "$@"
EOF
chmod +x "$BIN/boxblack-segment"
# (start the app again)
$UI wait "โปรเจค" 60000 && $UI click "0917" && $UI click "กราฟิกและเทคนิค" && $UI click "ทั้งคลิป"
# turn on a group whose person was never made (look menu, as in Step 5)
$UI wait "ตัดคนไม่สำเร็จ" 300000 && $UI wait "forced failure for the 0.5.0 live test"
$UI eval $LIVE/groups.js > $LIVE/groups-b2.json    # that group: failed, top placement, counted front
# the real helper back under the running app, then try again from the row
rm "$BIN/boxblack-segment" && mv "$BIN/boxblack-segment.real" "$BIN/boxblack-segment" && "$BIN/boxblack-segment" --version
$UI click "ลองใหม่" && $UI wait "!ตัดคนไม่สำเร็จ" 900000
$UI eval $LIVE/groups.js > $LIVE/groups-b3.json    # that group: ready, laid
pkill -f "m25/app --remote-debugging-port=9333"
ls -l "$BIN"                                        # boxblack-segment alone, no .off or .real left
```

- [ ] **Step 7: (c) CapCut Pro on.** Start the app again, then:

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
$UI wait "โปรเจค" 60000
$UI eval "await window.boxblack.updateSettings({ capcut: { pro: true } })"
$UI click "0917" && $UI click "กราฟิกและเทคนิค" && $UI wait "CapCut จะตัดคนให้ตอนเปิดโปรเจค" 60000
$UI eval $LIVE/groups.js > $LIVE/groups-c.json     # route "capcut"; every behind group "capcut", counted laid
$UI click "ไปเขียนลง CapCut ›" && $UI click "เขียนลง CapCut" && $UI wait "เขียนแล้ว" 900000 && $UI text > $LIVE/write-c.txt
node $LIVE/check-050.mts capcut | tee $LIVE/check-c.txt
$UI eval "await window.boxblack.updateSettings({ capcut: { pro: false } })"
pkill -f "m25/app --remote-debugging-port=9333"
```

  Expected: `ALL CHECKS PASS` for `capcut`:
  - the matting copies sit where the person layer would;
  - `matting.flag` 3, the path `<draft>/matting/<md5>`, an upper-case id, volume 0;
  - no person file.

  Ask the user, in Thai, to:
  - open 0917 in CapCut and look in the editor (no export: no Pro);
  - check that the text is behind the person;
  - note how long CapCut took to work the masks out on first open (spec §13 item 5);
  - then close CapCut.

- [ ] **Step 8: (d) Put 0917 back, clean up, write it down.**

```sh
. /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/env.sh
cd "$REPO" && node $SP/m25/draft-backup.mts restore release-050 && node $SP/m25/draft-backup.mts check release-050
# folder: identical · root_meta entry: identical
if [ -d $SP/m25/backups/release-050-matting ]; then ditto $SP/m25/backups/release-050-matting "$DRAFT/matting" && diff -rq $SP/m25/backups/release-050-matting "$DRAFT/matting" && echo "matting: identical"; fi
# the people this test cut go to the Trash; anything that was there before stays
if [ ! -s $LIVE/cutouts-before.txt ]; then
  [ -d "$CUTOUTS" ] && mv "$CUTOUTS" "$HOME/.Trash/cutouts-050-live-$(date +%Y%m%d%H%M%S)"
else
  ( cd "$CUTOUTS" && find . -type f | sort ) | comm -13 $LIVE/cutouts-before.txt - | while read -r f; do mv "$CUTOUTS/$f" "$HOME/.Trash/cutouts-050-$(basename "$f")"; done
fi
# the test profile as it was
mv $SP/m25/profile/outlines "$HOME/.Trash/profile-outlines-050-$(date +%Y%m%d%H%M%S)" && ditto $LIVE/profile-outlines-before $SP/m25/profile/outlines && cp $LIVE/profile-settings-before.json $SP/m25/profile/settings.json
ls -l "$BIN/boxblack-segment" && "$BIN/boxblack-segment" --version
```

  Expected:
  - Both lines say identical, and the matting copy too when there was one.
  - The helper in `resources/bin` is the real one.
  - The user's exports stay where the user put them.

  Write it down:
  - **Docs.** In both Task 18 entries, fill "ทดสอบจริงบน 0917" with:
    - the groups (behind, crossing the cut);
    - `check-050` results;
    - the frame match per range (`frames-a.txt`);
    - what the user saw;
    - the fallbacks (b) and the retry;
    - the Pro route (c) with CapCut's mask time;
    - "คืน 0917 ตรงเดิม".
  - Also fill:
    - the mutation line;
    - the DMG and its app.asar sha256;
    - spec §13 items 6 and 7, with the measured job time and MB/s. Say whether the timeout and space figures of §7.3 and §11 need changing, and ask the user before changing them.
  - **Memory:**
    - `prodeck2-design-decisions.md`:
      - 0.5.0 shipped (M27, text behind the person);
      - Claude's flag, from the per-point picture facts, prompt `highlights-2026-09-30-behind`;
      - the switch on by default;
      - our helper `boxblack-segment` by default, CapCut matting copies with Pro;
      - person files under `~/Movies/CapCut/BOXBLACK/cutouts`, `source.start` 16,667;
      - the §9.1 order on every write;
      - no number cap;
      - the DMG hash.
    - `capcut-draft-format-facts.md`: what the live test confirmed. CapCut keeps the new track order on re-save, and an app-written person layer matches the main layer frame by frame (or what it did not).
    - `live-test-cdp.md`:
      - the 0.5.0 scripts (`r050/live/check-050.mts`, `groups.js`, `wait-plan.js`, `frames3.py`);
      - the helper rename and stub for the fallback;
      - that the development build finds the helper in `apps/desktop/resources/bin`;
      - the scratchpad is temporary.
    - Update the index lines in `MEMORY.md` to match.
  - **Report to the user in Thai:**
    - where the DMG is;
    - the checks;
    - anything that slipped.
    - After they install it, verify that `/Applications/BOXBLACK.app` reports 0.5.0 and that its app.asar hash is the one recorded.


---

