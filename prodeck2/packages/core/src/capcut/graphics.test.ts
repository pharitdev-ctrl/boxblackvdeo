import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { addGraphicTrack, type TimelineGraphic } from "./graphics.ts"
import { addHighlightTracks, type HighlightLook } from "./highlights.ts"
import { addInsertTrack, type TimelineInsert } from "./inserts.ts"
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
/** Each overlay track's segments, by when and how long they play. */
const timesOf = (info: DraftInfo) => overlays(info).map((track) => track.segments.map((segment) => segment.target_timerange))

const graphic = (over: Partial<TimelineGraphic> = {}): TimelineGraphic => ({
  atUs: 1_000_000,
  durationUs: 3_000_000,
  binId: "BIN-1",
  path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov",
  name: "ab12.mov",
  width: 1004,
  height: 522,
  durationOfFileUs: 3_000_000,
  place: { scale: 0.93, x: 0, y: -0.25 },
  ...over,
})

test("one overlay video track above the picture, silent, drawn where the render box says", async () => {
  const info = await roughCut()
  const { info: out, kept, dropped } = addGraphicTrack(info, [graphic()])
  expect([kept, dropped]).toEqual([1, 0])
  const track = out.tracks.at(-1)!
  expect(track).toMatchObject({ type: "video", flag: 2 })

  const segment = track.segments[0]!
  expect(segment.target_timerange).toEqual({ start: 1_000_000, duration: 3_000_000 })
  expect(segment.source_timerange).toEqual({ start: 0, duration: 3_000_000 })
  expect(segment).toMatchObject({ volume: 0, render_index: 1000 + (out.tracks.length - 1), track_render_index: out.tracks.length - 1 })
  expect(segment.clip).toMatchObject({ scale: { x: 0.93, y: 0.93 }, transform: { x: 0, y: -0.25 } })

  const material = list(out, "videos").find((m) => m.id === segment.material_id)!
  expect(material).toMatchObject({ local_material_id: "BIN-1", has_audio: false, path: graphic().path, type: "video" })
  expect(info.tracks.length).toBe(out.tracks.length - 1) // pure
})

test("edges land on frames; one with no whole frame left is left out and counted; none means no track", async () => {
  const written = addGraphicTrack(await roughCut(), [graphic({ atUs: 1_000_010 }), graphic({ atUs: 9_490_000 })])
  expect([written.kept, written.dropped]).toEqual([1, 1])
  const segments = overlays(written.info)[0]!.segments
  expect(segments).toHaveLength(1)
  // 1_000_010 µs rounds to frame 30 at 30 fps, which lands back on the whole second
  expect(segments[0]!.target_timerange).toEqual({ start: 1_000_000, duration: 3_000_000 })

  const info = await roughCut()
  const none = addGraphicTrack(info, [])
  expect(none.info.tracks.length).toBe(info.tracks.length)
  expect([none.kept, none.dropped]).toEqual([0, 0])
})

test("graphics given out of order come out in time order", async () => {
  const early = graphic({ atUs: 1_000_000, durationUs: 1_000_000 })
  const late = graphic({ atUs: 5_000_000, durationUs: 1_000_000 })
  const out = addGraphicTrack(await roughCut(), [late, early]).info
  const starts = overlays(out)[0]!.segments.map((segment) => segment.target_timerange.start)
  expect(starts).toEqual([1_000_000, 5_000_000])
})

test("two graphics touching on the rough cut stay on one track once a cut between them lands on frames", async () => {
  // the first piece ends 10 ms past a frame and the second starts 17 ms past one: each edge goes to its
  // nearest frame, so what plays after the cut comes a frame sooner than what plays before it
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  const cuts = [
    { binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 5_010_000 },
    { binId: CLIP_A, sourceStartUs: 10_017_000, sourceDurationUs: 9_983_000 },
  ]
  const info = buildRoughCut(draft.info, cuts, binVideos(draft.meta))
  // where a moment of a piece plays once the pieces sit on their frames, as the write places graphics
  const video = info.tracks[0]!.segments
  const played = (cut: number, sourceUs: number) => video[cut]!.target_timerange.start - video[cut]!.source_timerange!.start + sourceUs
  // A plays 0.5–5.5 s of the unrounded cut; B starts right where A ends, 0.49 s into the second piece
  const a = graphic({ atUs: played(0, 500_000), durationUs: 5_000_000, durationOfFileUs: 5_000_000 })
  const b = graphic({ atUs: played(1, 10_507_000), durationUs: 3_000_000 })
  const written = addGraphicTrack(info, [a, b])
  // B lands on frame 164, a frame before A's end at 165: A gives up that frame of its way out, and no second track opens
  expect(timesOf(written.info)).toEqual([
    [
      { start: 500_000, duration: 4_966_666 },
      { start: 5_466_666, duration: 3_000_000 },
    ],
  ])
  expect([written.kept, written.dropped]).toEqual([2, 0])
})

test("graphics that overlap by more than that frame both play whole, the later on a track above", async () => {
  // A ends on frame 120; B starts on frame 118, two frames before
  const written = addGraphicTrack(await roughCut(), [graphic(), graphic({ atUs: 3_933_334, binId: "BIN-2" })])
  expect(timesOf(written.info)).toEqual([[{ start: 1_000_000, duration: 3_000_000 }], [{ start: 3_933_333, duration: 3_000_000 }]])
  expect([written.kept, written.dropped]).toEqual([2, 0])
})

test("graphics that overlap go on tracks of their own, each lane's track drawn above the one below", async () => {
  const { info: out } = addGraphicTrack(await roughCut(), [graphic({ atUs: 2_000_000, binId: "BIN-2" }), graphic()])
  expect(timesOf(out)).toEqual([[{ start: 1_000_000, duration: 3_000_000 }], [{ start: 2_000_000, duration: 3_000_000 }]])
  expect(overlays(out).map((track) => [track.segments[0]!.render_index, track.segments[0]!.track_render_index])).toEqual([
    [1001, 1],
    [1002, 2],
  ])
  const binOf = (index: number) => list(out, "videos").find((m) => m.id === overlays(out)[index]!.segments[0]!.material_id)!.local_material_id
  expect([binOf(0), binOf(1)]).toEqual(["BIN-1", "BIN-2"])
})

test("a graphic that comes on while another plays goes above it, even when a lower track is free by then", async () => {
  // A has ended when C starts, B has not: C goes above B, not back down beside A
  const a = graphic({ atUs: 1_000_000, durationUs: 1_000_000 })
  const b = graphic({ atUs: 1_500_000, durationUs: 3_500_000, durationOfFileUs: 3_500_000, binId: "BIN-2" })
  const c = graphic({ atUs: 3_000_000, durationUs: 1_000_000, binId: "BIN-3" })
  const out = addGraphicTrack(await roughCut(), [c, b, a]).info
  expect(timesOf(out).map((track) => track.map((range) => range.start))).toEqual([[1_000_000], [1_500_000], [3_000_000]])
})

test("a graphic left with no whole frame once it gives up the frame the next one starts on is left out, and one left out cuts nothing short", async () => {
  // one frame long, and the next starts on that very frame: nothing of the first is left
  const same = addGraphicTrack(await roughCut(), [graphic({ atUs: 1_000_000, durationUs: 33_334 }), graphic({ atUs: 1_000_001, binId: "BIN-2" })])
  expect(timesOf(same.info)).toEqual([[{ start: 1_000_000, duration: 3_000_000 }]])
  expect([same.kept, same.dropped]).toEqual([1, 1])
  // a file with no frame in it plays nothing, so the one before it keeps its last frame, which that one would have started on
  const empty = addGraphicTrack(await roughCut(), [graphic({ atUs: 1_000_000 }), graphic({ atUs: 3_966_667, durationOfFileUs: 0 })])
  expect(timesOf(empty.info)).toEqual([[{ start: 1_000_000, duration: 3_000_000 }]])
  expect([empty.kept, empty.dropped]).toEqual([1, 1])
})

test("a graphic longer than its file never plays past the file's last whole frame", async () => {
  // 60 frames of file at 30fps = 2 s, not the 150 frames (5 s) durationUs asks for
  const out = addGraphicTrack(await roughCut(), [graphic({ durationUs: 5_000_000, durationOfFileUs: 2_000_000 })]).info
  const segment = overlays(out)[0]!.segments[0]!
  expect(segment.target_timerange).toEqual({ start: 1_000_000, duration: 2_000_000 })
  expect(segment.source_timerange).toEqual({ start: 0, duration: 2_000_000 })
})

test("a file that ends between two frames plays only up to its last whole frame", async () => {
  // 2.01 s of file is 60.3 frames at 30fps: the 61st frame is not all there
  const out = addGraphicTrack(await roughCut(), [graphic({ durationUs: 5_000_000, durationOfFileUs: 2_010_000 })]).info
  const segment = overlays(out)[0]!.segments[0]!
  expect(segment.target_timerange).toEqual({ start: 1_000_000, duration: 2_000_000 })
  expect(segment.source_timerange).toEqual({ start: 0, duration: 2_000_000 })
})

test("the material gives the rendered file's own length, not how long the graphic plays", async () => {
  const out = addGraphicTrack(await roughCut(), [graphic({ durationUs: 5_000_000, durationOfFileUs: 2_000_000 })]).info
  const segment = overlays(out)[0]!.segments[0]!
  expect(list(out, "videos").find((m) => m.id === segment.material_id)).toMatchObject({ duration: 2_000_000 })
})

test("a graphic that would start before the rough cut does is left out", async () => {
  const early = graphic({ atUs: -500_000 })
  const later = graphic({ atUs: 5_000_000, binId: "BIN-2" })
  const written = addGraphicTrack(await roughCut(), [early, later])
  expect(timesOf(written.info)).toEqual([[{ start: 5_000_000, duration: 3_000_000 }]])
  expect([written.kept, written.dropped]).toEqual([1, 1])

  const info = await roughCut()
  expect(addGraphicTrack(info, [early]).info.tracks.length).toBe(info.tracks.length)
})

test("each segment's extra material refs land in materials, one per helper key", async () => {
  const out = addGraphicTrack(await roughCut(), [graphic()]).info
  const segment = overlays(out)[0]!.segments[0]!
  const keys = ["speeds", "placeholder_infos", "canvases", "sound_channel_mappings", "material_colors", "vocal_separations"]
  expect(segment.extra_material_refs).toHaveLength(keys.length)
  keys.forEach((key, i) => {
    const ref = segment.extra_material_refs[i]!
    expect(list(out, key).some((entry) => entry.id === ref)).toBe(true)
  })
})

test("render index sits above the cutaway track and below the highlight text", async () => {
  const insert: TimelineInsert = {
    atUs: 0,
    durationUs: 1_000_000,
    binId: "bin-1",
    path: "/pics/x.jpg",
    name: "x.jpg",
    kind: "photo",
    width: 100,
    height: 100,
    durationOfFileUs: 0,
    fit: "cover",
  }
  const withCutaway = addInsertTrack(await roughCut(), [insert]).info
  const out = addGraphicTrack(withCutaway, [graphic()]).info

  const look: HighlightLook = {
    fontPath: "/fonts/x.ttf",
    strokeWidth: 0.08,
    barRoundness: 20,
    palette: { text: [1, 1, 1], accent: [1, 0, 0], alt: [0, 0, 1], bar: [1, 1, 0] },
    animation: null,
  }
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
