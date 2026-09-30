import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import { addZooms, type TimelineZoom } from "./zoom.ts"
import type { DraftInfo, Segment } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/** The fixture draft (30 fps) cut into two pieces of 4 s and 5 s. */
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
const clipOf = (segment: Segment) => segment.clip as { scale: { x: number; y: number }; transform: { x: number; y: number } }

const punch: TimelineZoom = { cut: 0, kind: "punch", atUs: 1_000_000, durationUs: 4_000_000, faceY: 0.4 }
const drift: TimelineZoom = { cut: 1, kind: "drift", atUs: 0, durationUs: 5_000_000, faceY: -0.2 }

test("a punch rises from 1 to 1.15 where it lands, and holds the face still", async () => {
  const out = addZooms(await roughCut(), [punch]).info
  const [segment] = out.tracks[0]!.segments

  const scale = of(segment!, "KFTypeScaleX")
  expect(scale.keyframe_list.map((entry) => [entry.time_offset, entry.values[0]])).toEqual([
    [0, 1],
    [1_000_000, 1],
    [1_350_000, 1.15],
  ])
  expect(scale.keyframe_list.every((entry) => entry.curveType === "Line")).toBe(true)

  // the face at +0.4 stays put: 0.4 × 1.15 + (−0.06) = 0.4
  const y = of(segment!, "KFTypePositionY")
  expect(y.keyframe_list.map((entry) => entry.values[0])).toEqual([0, 0, 0.4 * (1 - 1.15)])
  expect(of(segment!, "KFTypePositionX").keyframe_list.map((entry) => entry.values[0])).toEqual([0, 0, 0])
})

test("a punch on the first frame of its piece has no flat start", async () => {
  const out = addZooms(await roughCut(), [{ ...punch, atUs: 0 }]).info
  const scale = of(out.tracks[0]!.segments[0]!, "KFTypeScaleX")
  expect(scale.keyframe_list.map((entry) => [entry.time_offset, entry.values[0]])).toEqual([
    [0, 1],
    [350_000, 1.15],
  ])
})

test("a punch too late in its piece lands before the piece ends", async () => {
  const out = addZooms(await roughCut(), [{ ...punch, atUs: 3_900_000 }]).info
  const scale = of(out.tracks[0]!.segments[0]!, "KFTypeScaleX")
  expect(scale.keyframe_list.map((entry) => entry.time_offset)).toEqual([0, 3_650_000, 4_000_000])
})

test("a drift runs from the start of its piece to the end", async () => {
  const out = addZooms(await roughCut(), [drift]).info
  const segment = out.tracks[0]!.segments[1]!
  // piece 1 plays its file from 10 s, and CapCut times keyframes in the file
  expect(of(segment, "KFTypeScaleX").keyframe_list.map((entry) => [entry.time_offset, entry.values[0]])).toEqual([
    [10_000_000, 1],
    [15_000_000, 1.08],
  ])
  expect(of(segment, "KFTypePositionY").keyframe_list.map((entry) => entry.values[0])).toEqual([0, -0.2 * (1 - 1.08)])
  // the piece that was not asked for is left alone
  expect(out.tracks[0]!.segments[0]!.common_keyframes).toEqual([])
})

test("keyframes are timed in the piece's source file, where CapCut reads them", async () => {
  // piece 1 plays its file from 10 s: a punch 1 s into the piece lands 11 s into the file
  const out = addZooms(await roughCut(), [{ ...punch, cut: 1, durationUs: 5_000_000 }]).info
  const scale = of(out.tracks[0]!.segments[1]!, "KFTypeScaleX")
  expect(scale.keyframe_list.map((entry) => entry.time_offset)).toEqual([10_000_000, 11_000_000, 11_350_000])
  // every property keyframes on the same moments
  for (const property of ["KFTypePositionX", "KFTypePositionY"]) {
    expect(of(out.tracks[0]!.segments[1]!, property).keyframe_list.map((entry) => entry.time_offset)).toEqual([10_000_000, 11_000_000, 11_350_000])
  }
})

test("a piece played faster goes through its file faster, and so do its keyframes", async () => {
  const info = await roughCut()
  info.tracks[0]!.segments[1]!.speed = 2
  const out = addZooms(info, [{ ...punch, cut: 1, durationUs: 5_000_000 }]).info
  expect(of(out.tracks[0]!.segments[1]!, "KFTypeScaleX").keyframe_list.map((entry) => entry.time_offset)).toEqual([10_000_000, 12_000_000, 12_700_000])
})

test("the clip and its first keyframe say the same thing, the way CapCut writes them", async () => {
  const out = addZooms(await roughCut(), [punch, drift]).info
  for (const segment of out.tracks[0]!.segments) {
    const first = of(segment, "KFTypeScaleX").keyframe_list[0]!
    expect(clipOf(segment).scale).toEqual({ x: first.values[0], y: first.values[0] })
    expect(clipOf(segment).transform).toEqual({ x: 0, y: of(segment, "KFTypePositionY").keyframe_list[0]!.values[0] })
  }
})

test("a piece that is already scaled and placed zooms from where it is", async () => {
  const info = await roughCut()
  const segment = info.tracks[0]!.segments[0]!
  segment.clip = { ...(segment.clip as object), scale: { x: 0.5, y: 0.5 }, transform: { x: 0.2, y: -0.3 } }

  const out = addZooms(info, [{ ...punch, atUs: 0 }]).info
  const zoomed = out.tracks[0]!.segments[0]!
  expect(of(zoomed, "KFTypeScaleX").keyframe_list.map((entry) => entry.values[0])).toEqual([0.5, 0.5 * 1.15])
  expect(of(zoomed, "KFTypePositionX").keyframe_list.map((entry) => entry.values[0])).toEqual([0.2, 0.2])
  expect(of(zoomed, "KFTypePositionY").keyframe_list.map((entry) => entry.values[0])).toEqual([-0.3, -0.3 + 0.4 * (1 - 1.15)])
  expect(clipOf(zoomed)).toMatchObject({ scale: { x: 0.5, y: 0.5 }, transform: { x: 0.2, y: -0.3 } })
})

test("a zoom without a picture to follow moves around the middle of the frame", async () => {
  const out = addZooms(await roughCut(), [{ ...punch, faceY: 0 }]).info
  expect(of(out.tracks[0]!.segments[0]!, "KFTypePositionY").keyframe_list.map((entry) => entry.values[0])).toEqual([0, 0, 0])
})

test("a zoom on a piece that is not there, or with no length, changes nothing", async () => {
  const info = await roughCut()
  const out = addZooms(info, [{ ...punch, cut: 9 }, { ...drift, durationUs: 0 }]).info
  expect(out.tracks[0]!.segments.map((segment) => segment.common_keyframes)).toEqual([[], []])
  expect(addZooms(info, []).info.tracks).toEqual(info.tracks)
})

test("the writer says how many pieces it zoomed and how many zooms it left out", async () => {
  const info = await roughCut()
  // a zoom on a piece that is not there is left out; the other two each zoom a piece of their own
  expect(addZooms(info, [punch, drift, { ...punch, cut: 9 }])).toMatchObject({ kept: 2, dropped: 1 })
  // a zoom with no length is left out on its own count: its piece (1) has no other zoom, so only the
  // length check can drop it
  expect(addZooms(info, [punch, { ...drift, durationUs: 0 }])).toMatchObject({ kept: 1, dropped: 1 })
  expect(addZooms(info, [])).toMatchObject({ kept: 0, dropped: 0 })
  // a draft with no video track has no piece to zoom
  expect(addZooms({ ...info, tracks: [] }, [punch])).toMatchObject({ kept: 0, dropped: 1 })
})

test("a second zoom on a piece already zoomed is left out, not written over the first", async () => {
  const { info: out, kept, dropped } = addZooms(await roughCut(), [punch, { ...punch, kind: "drift" }])
  expect([kept, dropped]).toEqual([1, 1])
  // the punch's three keyframes, not a drift's two
  expect(of(out.tracks[0]!.segments[0]!, "KFTypeScaleX").keyframe_list).toHaveLength(3)
})
