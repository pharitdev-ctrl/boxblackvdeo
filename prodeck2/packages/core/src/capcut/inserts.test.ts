import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { addInsertTrack, coverScale, type TimelineInsert } from "./inserts.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import type { DraftInfo } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/** The fixture draft (30 fps, 1080×1920 after the cut) with a 9.5 s rough cut. */
async function roughCut(): Promise<DraftInfo> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  return buildRoughCut(draft.info, [{ binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 9_500_000 }], binVideos(draft.meta))
}

type Entry = { id: string; [key: string]: unknown }
const list = (info: DraftInfo, key: string) => (info.materials[key] ?? []) as Entry[]
const overlays = (info: DraftInfo) => info.tracks.filter((track) => track.type === "video" && track.flag === 2)

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
const clip: TimelineInsert = { ...photo, atUs: 6_000_000, durationUs: 3_000_000, binId: "bin-2", path: "/clips/broll.mp4", name: "broll.mp4", kind: "video", width: 1080, height: 1920, durationOfFileUs: 8_000_000 }

test("a cutaway becomes a material and a segment on one overlay track", async () => {
  const { info: out, kept, dropped } = addInsertTrack(await roughCut(), [photo])
  expect([kept, dropped]).toEqual([1, 0])
  expect(out.tracks.map((track) => [track.type, track.flag])).toEqual([
    ["video", 0],
    ["video", 2],
  ])

  const [segment] = overlays(out)[0]!.segments
  expect(segment).toMatchObject({
    source_timerange: { start: 0, duration: 2_000_000 },
    target_timerange: { start: 2_000_000, duration: 2_000_000 },
    volume: 0,
    render_index: 9,
    track_render_index: 1,
    visible: true,
  })

  const material = list(out, "videos").find((entry) => entry.id === segment!.material_id)!
  expect(material).toMatchObject({
    type: "photo",
    path: "/pics/nail.jpg",
    material_name: "nail.jpg",
    local_material_id: "bin-1",
    width: 3024,
    height: 4032,
    has_audio: false,
    duration: 5_000_000,
  })
  expect(segment!.extra_material_refs).toHaveLength(6)
})

test("a picture of another shape is drawn big enough to cover the frame", async () => {
  const info = await roughCut()
  expect(info.canvas_config).toMatchObject({ width: 1080, height: 1920 })
  // a 3:4 photo fits a 9:16 frame as 1080×1440, so covering its height needs a third again
  expect(coverScale(photo, info.canvas_config)).toBeCloseTo(1920 / 4032 / (1080 / 3024), 6)
  expect(coverScale(photo, info.canvas_config)).toBeCloseTo(4 / 3, 6)
  // a picture the same shape as the frame is left alone
  expect(coverScale(clip, info.canvas_config)).toBe(1)
  expect(coverScale({ width: 0, height: 0 }, info.canvas_config)).toBe(1)

  const out = addInsertTrack(info, [photo, clip]).info
  const [first, second] = overlays(out)[0]!.segments
  expect((first!.clip as { scale: { x: number } }).scale.x).toBeCloseTo(coverScale(photo, info.canvas_config), 6)
  expect((second!.clip as { scale: { x: number } }).scale.x).toBe(1)
})

test("cutaways that do not overlap go on one track in time order, on frames, and never past the end", async () => {
  const info = await roughCut()
  const out = addInsertTrack(info, [clip, photo, { ...photo, binId: "late", atUs: 9_400_000, durationUs: 2_000_000 }]).info
  expect(overlays(out)).toHaveLength(1)
  const times = overlays(out)[0]!.segments.map((segment) => [segment.target_timerange.start, segment.target_timerange.duration])
  expect(times).toEqual([
    [2_000_000, 2_000_000],
    [6_000_000, 3_000_000],
    // the timeline ends at 9.5 s, and the edges land on 30 fps frames
    [9_400_000, 100_000],
  ])
  for (const [start, duration] of times) expect(Number.isInteger((start! * 30) / 1_000_000)).toBe(true)

  // one with no whole frame left is left out
  const none = addInsertTrack(info, [{ ...photo, atUs: 9_490_000 }])
  expect(overlays(none.info)).toEqual([])
  expect([none.kept, none.dropped]).toEqual([0, 1])
})

test("the writer says how many cutaways it placed and how many it left out", async () => {
  const info = await roughCut()
  // before the rough cut starts, and with no whole frame left: out; the last frame of the cut alone: in
  const early = { ...photo, binId: "early", atUs: -500_000 }
  const gone = { ...photo, binId: "gone", atUs: 9_490_000 }
  const lastFrame = { ...photo, binId: "last", atUs: 9_466_667 }
  const written = addInsertTrack(info, [early, photo, gone, lastFrame])
  expect([written.kept, written.dropped]).toEqual([2, 2])
  expect(overlays(written.info).flatMap((track) => track.segments.map((segment) => segment.target_timerange))).toEqual([
    { start: 2_000_000, duration: 2_000_000 },
    { start: 9_466_666, duration: 33_334 },
  ])
  expect(addInsertTrack(info, [])).toMatchObject({ kept: 0, dropped: 0 })
})

test("cutaways that overlap go on tracks of their own, the later one above", async () => {
  // the clip comes on while the photo is still up
  const early = { ...photo, atUs: 2_000_000, durationUs: 2_000_000 }
  const late = { ...clip, atUs: 3_000_000, durationUs: 2_000_000 }
  const { info: out, kept, dropped } = addInsertTrack(await roughCut(), [late, early])
  expect([kept, dropped]).toEqual([2, 0])
  const tracks = overlays(out)
  expect(tracks.map((track) => track.segments.map((segment) => segment.target_timerange))).toEqual([
    [{ start: 2_000_000, duration: 2_000_000 }],
    [{ start: 3_000_000, duration: 2_000_000 }],
  ])
  // each lane's track draws above the one below it, both still under the text written later
  expect(tracks.map((track) => [track.segments[0]!.render_index, track.segments[0]!.track_render_index])).toEqual([
    [9, 1],
    [10, 2],
  ])
  expect(out.tracks.slice(1)).toEqual(tracks)
})

test("a cutaway that starts on the last frame of the one before plays whole on a track of its own, not over it on one track", async () => {
  // the first ends on frame 120 (4 s); the second starts on frame 119, as two touching pieces can once each lands on its frame
  const first = { ...photo, atUs: 2_000_000, durationUs: 2_000_000 }
  const second = { ...photo, binId: "bin-3", atUs: 3_966_667, durationUs: 2_000_000 }
  const tracks = overlays(addInsertTrack(await roughCut(), [first, second]).info)
  expect(tracks.map((track) => track.segments.map((segment) => segment.target_timerange))).toEqual([
    [{ start: 2_000_000, duration: 2_000_000 }],
    [{ start: 3_966_666, duration: 2_000_000 }],
  ])
})

test("a clip that ends between two frames never plays past its own last frame", async () => {
  // 2.52 s of B-roll at 5.01 s: 75.6 frames of file, so 75 whole ones, not the 76 that rounding its end would give
  const short: TimelineInsert = { ...clip, atUs: 5_010_000, durationUs: 2_520_000, durationOfFileUs: 2_520_000 }
  const [segment] = overlays(addInsertTrack(await roughCut(), [short]).info)[0]!.segments
  expect(segment!.source_timerange!.start + segment!.source_timerange!.duration).toBeLessThanOrEqual(2_520_000)
  expect(segment!.target_timerange.duration).toBe(segment!.source_timerange!.duration)
  expect(segment!.target_timerange).toEqual({ start: 5_000_000, duration: 2_500_000 })
  // a photo has no end of its own
  const still = overlays(addInsertTrack(await roughCut(), [{ ...photo, atUs: 5_010_000, durationUs: 2_520_000, durationOfFileUs: 0 }]).info)[0]!.segments[0]!
  expect(still.target_timerange).toEqual({ start: 5_000_000, duration: 2_533_333 })
})

test("no cutaways, no track, and what was there already is left alone", async () => {
  const info = await roughCut()
  const out = addInsertTrack(info, []).info
  expect(out.tracks).toEqual(info.tracks)
  expect(list(out, "videos")).toHaveLength(list(info, "videos").length)
})

test("cutaways added later do not disturb the ones already there", async () => {
  const info = await roughCut()
  const first = addInsertTrack(info, [photo]).info
  const second = addInsertTrack(first, [clip]).info
  expect(overlays(second)).toHaveLength(2)
  expect(list(second, "videos").map((entry) => entry.local_material_id)).toEqual([CLIP_A, "bin-1", "bin-2"])

  // the rough cut's own pieces keep the extra materials they came with
  for (const key of ["speeds", "canvases", "sound_channel_mappings", "vocal_separations", "material_colors", "placeholder_infos"]) {
    expect(list(second, key).length, key).toBe(list(info, key).length + 2)
  }
  const [piece] = second.tracks[0]!.segments
  for (const ref of piece!.extra_material_refs) {
    expect(Object.values(second.materials).some((entries) => Array.isArray(entries) && entries.some((entry) => (entry as Entry)?.id === ref))).toBe(true)
  }
})

test("a cover with a subject is blown up and moved so the subject fills the frame", async () => {
  const out = addInsertTrack(await roughCut(), [{ ...photo, subject: { x0: 0.1, y0: 0.4, x1: 0.7, y1: 1 } }]).info
  const [segment] = overlays(out)[0]!.segments
  const clip = segment!.clip as { scale: { x: number }; transform: { x: number; y: number } }
  expect(clip.scale.x).toBeCloseTo(20 / 9, 4)
  expect(clip.transform.x).toBeCloseTo(0.4444, 4)
  expect(clip.transform.y).toBeCloseTo(0.6667, 4)
})

test("a card is smaller than the frame and sits where the video leaves room", async () => {
  const out = addInsertTrack(await roughCut(), [{ ...photo, fit: "card", keepClear: { fromY: 0.12, toY: 0.48 } }]).info
  const [segment] = overlays(out)[0]!.segments
  const clip = segment!.clip as { scale: { x: number }; transform: { x: number; y: number } }
  // 62 % of the frame's width, low down where the face is not
  expect(clip.scale.x).toBeCloseTo(0.62, 5)
  expect(clip.transform).toEqual({ x: 0, y: -0.48 })
})

test("a cutaway with poses moves over its own framing from its first frame; one without has no keyframes", async () => {
  const poses = [
    { s: 0, scale: 1, x: 0, y: 0, rot: 0, ease: "line" as const },
    { s: 1, scale: 1.1, x: 0.05, y: -0.02, rot: 2, ease: "line" as const },
  ]
  const card: TimelineInsert = { ...clip, fit: "card", keepClear: { fromY: 0, toY: 0.5 }, poses }
  const out = addInsertTrack(await roughCut(), [photo, card]).info
  const [still] = overlays(out)[0]!.segments
  expect(still!.common_keyframes).toEqual([])

  const moved = overlays(out)[0]!.segments[1]!
  const framing = moved.clip as { scale: { x: number }; transform: { x: number; y: number } }
  const of = (property: string) => moved.common_keyframes!.find((entry) => entry.property_type === property)!.keyframe_list
  expect(moved.common_keyframes!.map((entry) => entry.property_type)).toEqual(["KFTypeScaleX", "KFTypePositionX", "KFTypePositionY", "KFTypeRotation"])
  // timed from the segment's start in its file, which is the file's start
  expect(of("KFTypeScaleX").map((entry) => entry.time_offset)).toEqual([0, 1_000_000])
  expect(of("KFTypeScaleX").map((entry) => entry.values[0])).toEqual([framing.scale.x, framing.scale.x * 1.1])
  expect(of("KFTypePositionX").map((entry) => entry.values[0])).toEqual([framing.transform.x || 0, framing.transform.x + 0.05])
  expect(of("KFTypePositionY").map((entry) => entry.values[0])).toEqual([framing.transform.y, framing.transform.y - 0.02])
  expect(of("KFTypeRotation").map((entry) => entry.values[0])).toEqual([0, 2])
})
