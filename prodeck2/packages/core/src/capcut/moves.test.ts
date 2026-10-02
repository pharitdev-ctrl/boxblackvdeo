import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import type { Pose } from "../flair/moves.ts"
import { addMoves, zoomsBesideMoves, type TimelineMove } from "./moves.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import type { DraftInfo, Segment } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/** The fixture draft (30 fps) cut into two pieces of 4 s and 5 s; the second plays its file from 10 s. */
async function roughCut(): Promise<DraftInfo> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  return buildRoughCut(
    draft.info,
    [
      { binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 4_000_000 },
      { binId: CLIP_A, sourceStartUs: 10_000_000, sourceDurationUs: 5_000_000 },
    ],
    binVideos(draft.meta),
  )
}

const of = (segment: Segment, property: string) => (segment.common_keyframes ?? []).find((entry) => entry.property_type === property)!
const timesOf = (segment: Segment, property = "KFTypeScaleX") => of(segment, property).keyframe_list.map((entry) => entry.time_offset)
const valuesOf = (segment: Segment, property = "KFTypeScaleX") => of(segment, property).keyframe_list.map((entry) => entry.values[0])

const pose = (s: number, scale: number, more: Partial<Pose> = {}): Pose => ({ s, scale, x: 0, y: 0, rot: 0, ease: "line", ...more })

/** A straight push from as is to 1.2 over half a second. */
const push: Pose[] = [pose(0, 1), pose(0.5, 1.2)]

test("a move from the piece's start is written as its poses, timed in the source file", async () => {
  const { info: out, kept, dropped } = addMoves(await roughCut(), [{ cut: 1, startUs: 0, poses: push }])
  expect([kept, dropped]).toEqual([1, 0])
  const segment = out.tracks[0]!.segments[1]!
  // piece 1 plays its file from 10 s
  expect(timesOf(segment)).toEqual([10_000_000, 10_500_000])
  expect(valuesOf(segment)).toEqual([1, 1.2])
  // every point is straight, and every property keyframes on the same moments
  for (const property of ["KFTypeScaleX", "KFTypePositionX", "KFTypePositionY", "KFTypeRotation"]) {
    expect(timesOf(segment, property)).toEqual([10_000_000, 10_500_000])
    expect(of(segment, property).keyframe_list.every((entry) => entry.curveType === "Line")).toBe(true)
  }
  // the other piece is left alone
  expect(out.tracks[0]!.segments[0]!.common_keyframes).toEqual([])
})

test("a piece played faster runs through its keyframes faster", async () => {
  const info = await roughCut()
  info.tracks[0]!.segments[1]!.speed = 2
  const out = addMoves(info, [{ cut: 1, startUs: 1_000_000, poses: push }]).info
  // the identity at the start, the held pose where the move begins, then the move's end
  expect(timesOf(out.tracks[0]!.segments[1]!)).toEqual([10_000_000, 12_000_000, 13_000_000])
})

test("a move that starts later in its piece rests at the identity until then", async () => {
  const out = addMoves(await roughCut(), [{ cut: 0, startUs: 1_000_000, poses: push }]).info
  const segment = out.tracks[0]!.segments[0]!
  // the move's own first pose is where it begins, so the held pose stands in for it
  expect(timesOf(segment)).toEqual([0, 1_000_000, 1_500_000])
  expect(valuesOf(segment)).toEqual([1, 1, 1.2])
})

test("two moves on one piece are merged into one list, the later starting from where the first left off", async () => {
  const first: TimelineMove = { cut: 0, startUs: 0, poses: push }
  const second: TimelineMove = { cut: 0, startUs: 2_000_000, poses: [pose(0, 1), pose(0.4, 1.1, { x: 0.05 })] }
  // given out of order: they are written in start order
  const { info: out, kept, dropped } = addMoves(await roughCut(), [second, first])
  expect([kept, dropped]).toEqual([2, 0])
  const segment = out.tracks[0]!.segments[0]!
  expect(timesOf(segment)).toEqual([0, 500_000, 2_000_000, 2_400_000])
  // the seam: the second move starts from 1.2, held since the first ended, not from its own 1
  expect(valuesOf(segment)).toEqual([1, 1.2, 1.2, 1.1])
  expect(valuesOf(segment, "KFTypePositionX")).toEqual([0, 0, 0, 0.05])
})

test("a move that begins with a cut jumps a millisecond after its start", async () => {
  const first: TimelineMove = { cut: 0, startUs: 0, poses: push }
  const second: TimelineMove = { cut: 0, startUs: 2_000_000, poses: [pose(0, 1.1, { ease: "cut" }), pose(0.5, 1)] }
  const segment = addMoves(await roughCut(), [first, second]).info.tracks[0]!.segments[0]!
  expect(timesOf(segment)).toEqual([0, 500_000, 2_000_000, 2_001_000, 2_500_000])
  expect(valuesOf(segment)).toEqual([1, 1.2, 1.2, 1.1, 1])
})

test("a cut inside a move holds the pose before until a millisecond after it", async () => {
  const segment = addMoves(await roughCut(), [{ cut: 0, startUs: 0, poses: [pose(0, 1), pose(1, 1.2, { ease: "cut" })] }]).info.tracks[0]!.segments[0]!
  expect(timesOf(segment)).toEqual([0, 1_000, 1_000_000])
  expect(valuesOf(segment)).toEqual([1, 1.2, 1.2])
})

test("a move that starts before the one before it has finished is left out and counted", async () => {
  const first: TimelineMove = { cut: 0, startUs: 0, poses: push }
  const early: TimelineMove = { cut: 0, startUs: 300_000, poses: push }
  const { info: out, kept, dropped } = addMoves(await roughCut(), [first, early])
  expect([kept, dropped]).toEqual([1, 1])
  expect(timesOf(out.tracks[0]!.segments[0]!)).toEqual([0, 500_000])
})

test("the moves go on top of the piece's own size, place and turn", async () => {
  const info = await roughCut()
  const segment = info.tracks[0]!.segments[0]!
  segment.clip = { ...(segment.clip as object), scale: { x: 0.5, y: 0.5 }, transform: { x: 0.2, y: -0.3 }, rotation: 10 }
  const poses = [pose(0, 1), pose(1, 1.2, { x: 0.1, y: -0.05, rot: 3 })]
  const moved = addMoves(info, [{ cut: 0, startUs: 0, poses }]).info.tracks[0]!.segments[0]!
  expect(valuesOf(moved, "KFTypeScaleX")).toEqual([0.5, 0.5 * 1.2])
  expect(valuesOf(moved, "KFTypePositionX")).toEqual([0.2, 0.2 + 0.1])
  expect(valuesOf(moved, "KFTypePositionY")).toEqual([-0.3, -0.3 - 0.05])
  expect(valuesOf(moved, "KFTypeRotation")).toEqual([10, 13])
})

test("a turn is written on a rotation track, and no value is a negative zero", async () => {
  const poses = [pose(0, 1, { x: -0, rot: -0 }), pose(1, 1.1, { rot: -4 })]
  const segment = addMoves(await roughCut(), [{ cut: 0, startUs: 0, poses }]).info.tracks[0]!.segments[0]!
  expect(valuesOf(segment, "KFTypeRotation")).toEqual([0, -4])
  expect(Object.is(valuesOf(segment, "KFTypeRotation")[0], -0)).toBe(false)
  expect(Object.is(valuesOf(segment, "KFTypePositionX")[0], -0)).toBe(false)
})

test("an eased move is written as straight steps", async () => {
  const segment = addMoves(await roughCut(), [{ cut: 0, startUs: 0, poses: [pose(0, 1), pose(0.8, 1.2, { ease: "inOut" })] }]).info.tracks[0]!.segments[0]!
  // the start, seven steps between, and the end
  expect(timesOf(segment)).toEqual([0, 100_000, 200_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000])
})

test("a move on a piece that is not there, or with no poses, is left out and counted", async () => {
  const info = await roughCut()
  const { info: out, kept, dropped } = addMoves(info, [
    { cut: 9, startUs: 0, poses: push },
    { cut: 0, startUs: 0, poses: [] },
  ])
  expect([kept, dropped]).toEqual([0, 2])
  expect(out.tracks[0]!.segments.map((segment) => segment.common_keyframes)).toEqual([[], []])
  expect(addMoves({ ...info, tracks: [] }, [{ cut: 0, startUs: 0, poses: push }])).toMatchObject({ kept: 0, dropped: 1 })
  expect(addMoves(info, [])).toMatchObject({ kept: 0, dropped: 0 })
})

test("a legacy zoom on a piece that has a move is left out and counted; the rest stay", () => {
  const zooms = [
    { cut: 0, kind: "punch" },
    { cut: 1, kind: "drift" },
    { cut: 2, kind: "punch" },
  ]
  expect(zoomsBesideMoves(zooms, [{ cut: 1 }, { cut: 1 }, { cut: 5 }])).toEqual({
    zooms: [
      { cut: 0, kind: "punch" },
      { cut: 2, kind: "punch" },
    ],
    dropped: 1,
  })
  expect(zoomsBesideMoves(zooms, [])).toEqual({ zooms, dropped: 0 })
})

test("an eased move after a seam eases from the held pose, without a snap to its own first pose", async () => {
  const first: TimelineMove = { cut: 0, startUs: 0, poses: push }
  const second: TimelineMove = { cut: 0, startUs: 2_000_000, poses: [pose(0, 1), pose(0.4, 1.1, { ease: "inOut" })] }
  const values = valuesOf(addMoves(await roughCut(), [first, second]).info.tracks[0]!.segments[0]!)
  expect(values.slice(0, 3)).toEqual([1, 1.2, 1.2])
  // the first eased step lies between the held 1.2 and the target 1.1
  expect(values[3]).toBeLessThan(1.2)
  expect(values[3]).toBeGreaterThan(1.1)
  expect(values.at(-1)).toBe(1.1)
})

test("a move that opens with a cut and cuts again keeps both jumps", async () => {
  const first: TimelineMove = { cut: 0, startUs: 0, poses: push }
  const second: TimelineMove = { cut: 0, startUs: 2_000_000, poses: [pose(0, 1.1, { ease: "cut" }), pose(0.5, 1.3, { ease: "cut" })] }
  const segment = addMoves(await roughCut(), [first, second]).info.tracks[0]!.segments[0]!
  expect(timesOf(segment)).toEqual([0, 500_000, 2_000_000, 2_001_000, 2_002_000, 2_500_000])
  expect(valuesOf(segment)).toEqual([1, 1.2, 1.2, 1.1, 1.3, 1.3])
})

test("a first pose after the move's start: alone it holds until then; after a seam the held pose holds until then", async () => {
  const late = [pose(0.5, 1.1), pose(1, 1.2)]
  const alone = addMoves(await roughCut(), [{ cut: 0, startUs: 0, poses: late }]).info.tracks[0]!.segments[0]!
  expect(timesOf(alone)).toEqual([500_000, 1_000_000])
  expect(valuesOf(alone)).toEqual([1.1, 1.2])

  const seamed = addMoves(await roughCut(), [{ cut: 0, startUs: 1_000_000, poses: late }]).info.tracks[0]!.segments[0]!
  expect(timesOf(seamed)).toEqual([0, 1_000_000, 1_500_000, 2_000_000])
  expect(valuesOf(seamed)).toEqual([1, 1, 1, 1.2])
})

test("two moves on one piece that start together: the second is left out and counted", async () => {
  const one: TimelineMove = { cut: 0, startUs: 1_000_000, poses: [pose(0, 1)] }
  const two: TimelineMove = { cut: 0, startUs: 1_000_000, poses: push }
  expect(addMoves(await roughCut(), [one, two])).toMatchObject({ kept: 1, dropped: 1 })
  const atZero: TimelineMove = { cut: 0, startUs: 0, poses: [pose(0, 1)] }
  expect(addMoves(await roughCut(), [atZero, { ...two, startUs: 0 }])).toMatchObject({ kept: 1, dropped: 1 })
})

test("every track's times rise strictly through a mix of moves", async () => {
  const moves: TimelineMove[] = [
    { cut: 0, startUs: 200_000, poses: [pose(0, 1), pose(0.3, 1.2, { ease: "out", rot: 2 }), pose(0.3005, 1.1, { ease: "cut" })] },
    { cut: 0, startUs: 500_000, poses: [pose(0, 1.15, { ease: "cut" }), pose(0, 1.2, { ease: "cut" }), pose(0.6, 1, { ease: "inOut", x: 0.05 })] },
    { cut: 0, startUs: 1_100_000, poses: [pose(0, 1), pose(0.4, 1.1, { ease: "in" })] },
  ]
  const segment = addMoves(await roughCut(), moves).info.tracks[0]!.segments[0]!
  for (const entry of segment.common_keyframes!) {
    const times = entry.keyframe_list.map((point) => point.time_offset)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!)
  }
})

test("a move with no poses takes no piece from a legacy zoom", () => {
  const zooms = [{ cut: 0 }, { cut: 1 }]
  expect(zoomsBesideMoves(zooms, [{ cut: 0, poses: [] }, { cut: 1, poses: push }])).toEqual({ zooms: [{ cut: 0 }], dropped: 1 })
})
