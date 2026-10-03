import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { graphicBinItem, soundBinItem } from "../capcut/bin.ts"
import { binVideos, loadDraft } from "../capcut/read.ts"
import { describeTimeline } from "./describe.ts"
import { pipelinePieces, TIMELINE_VERSION, type AgentTimeline } from "./types.ts"
import { writeTimeline } from "./write.ts"

const CLIP = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"
const GRAPHICS = "/Users/x/Movies/CapCut/BOXBLACK/graphics"
const SOUNDS = "/Users/x/Movies/CapCut/BOXBLACK/sounds"

function timeline(extra: Partial<AgentTimeline> = {}): AgentTimeline {
  return {
    version: TIMELINE_VERSION,
    direction: "สนุก จังหวะเร็ว",
    canvas: { width: 1080, height: 1920 },
    durationUs: 6_000_000,
    cuts: pipelinePieces("cut", [
      { binId: CLIP, sourceStartUs: 10_000_000, sourceDurationUs: 4_000_000 },
      { binId: CLIP, sourceStartUs: 2_000_000, sourceDurationUs: 2_000_000 },
    ]),
    subtitles: false,
    captions: [],
    highlights: null,
    moves: [],
    zooms: [],
    inserts: [],
    graphics: [],
    composed: [],
    sounds: [],
    binItems: [],
    ...extra,
  }
}

async function draft() {
  const loaded = await loadDraft(join(await makeDraftRoot(), "0917"))
  return { info: loaded.info, meta: loaded.meta, bin: binVideos(loaded.meta) }
}

test("pieces carry ids from their kind and place, and a timeline survives JSON unchanged", () => {
  const pieces = pipelinePieces("caption", [{ startUs: 0, endUs: 1, text: "ก" }, { startUs: 1, endUs: 2, text: "ข" }], (item) => item.text)
  expect(pieces.map((piece) => [piece.id, piece.by, piece.locked, piece.note])).toEqual([
    ["caption-1", "pipeline", false, "ก"],
    ["caption-2", "pipeline", false, "ข"],
  ])
  const full = timeline({ captions: pieces, subtitles: true })
  expect(JSON.parse(JSON.stringify(full))).toEqual(full)
})

test("a timeline of cuts alone writes the rough cut and nothing else, and no writer runs", async () => {
  const { info, bin } = await draft()
  const written = writeTimeline(info, bin, timeline(), { subtitleGroupId: "g", prune: null })
  expect(written.info.tracks.map((track) => track.type)).toEqual(["video"])
  expect(written.info.tracks[0]!.segments).toHaveLength(2)
  expect(written.laid).toEqual({})
})

test("each kind goes on its own tracks in writing order, its writer counts it, and the bin keeps what the timeline plays", async () => {
  const { info, meta, bin } = await draft()
  const graphic = { atUs: 1_000_000, durationUs: 1_500_000, binId: "g1", path: `${GRAPHICS}/a.mov`, name: "a.mov", width: 400, height: 300, durationOfFileUs: 1_500_000, place: { scale: 0.5, x: 0, y: 0.5 } }
  const composed = { atUs: 2_000_000, durationUs: 500_000, path: `${SOUNDS}/b.wav`, binId: "s1" }
  const t = timeline({
    subtitles: true,
    captions: pipelinePieces("caption", [{ startUs: 0, endUs: 1_000_000, text: "สวัสดี" }]),
    graphics: pipelinePieces("graphic", [graphic]),
    composed: pipelinePieces("composed", [composed]),
    binItems: [
      graphicBinItem({ id: "g1", path: graphic.path, width: 400, height: 300, durationUs: 1_500_000, nowMs: 0 }),
      soundBinItem({ id: "s1", path: composed.path, durationUs: 500_000, nowMs: 0 }),
    ],
  })
  const written = writeTimeline(info, bin, t, { subtitleGroupId: "boxblack_1", prune: { graphicsDir: GRAPHICS, soundsDir: SOUNDS } })
  expect(written.info.tracks.map((track) => track.type)).toEqual(["video", "text", "video", "audio"])
  expect(written.laid).toEqual({ graphics: { kept: 1, dropped: 0 }, composed: { kept: 1, dropped: 0 } })
  const paths = written.bin(meta).draft_materials.flatMap((group) => group.value.map((item) => item.file_Path))
  expect(paths).toEqual(expect.arrayContaining([graphic.path, composed.path]))
})

test("subtitles on with no line left add no track: the subtitle writer leaves an empty one out", async () => {
  const { info, bin } = await draft()
  const written = writeTimeline(info, bin, timeline({ subtitles: true }), { subtitleGroupId: "g", prune: null })
  expect(written.info.tracks.map((track) => track.type)).toEqual(["video"])
})

test("Claude reads the direction, then every piece in time order with its id, who made it and whether it is locked", () => {
  const t = timeline({
    subtitles: true,
    captions: pipelinePieces("caption", [{ startUs: 4_200_000, endUs: 5_000_000, text: "ราคา 5 บาท" }]),
    graphics: [{ ...pipelinePieces("graphic", [{ atUs: 4_300_000, durationUs: 1_200_000, binId: "g", path: "/p", name: "a.mov", width: 1, height: 1, durationOfFileUs: 1, place: { scale: 1, x: 0, y: 0 } }])[0]!, note: "ป้ายราคา", by: "user", locked: true }],
    sounds: pipelinePieces("sound", [{ atUs: 0, effectId: "e", name: "ติ๊ง", path: null, durationUs: 300_000 }]),
  })
  expect(describeTimeline(t).split("\n")).toEqual([
    "Direction: สนุก จังหวะเร็ว",
    "Length: 0:06.0 · frame 1080x1920 · subtitles on",
    "Pieces:",
    `- cut-1 0:00.0–0:04.0 cut of 8efd5c3a from 0:10.0 (pipeline)`,
    "- sound-1 0:00.0–0:00.3 sound “ติ๊ง” (pipeline)",
    `- cut-2 0:04.0–0:06.0 cut of 8efd5c3a from 0:02.0 (pipeline)`,
    "- caption-1 0:04.2–0:05.0 subtitle “ราคา 5 บาท” (pipeline)",
    "- graphic-1 0:04.3–0:05.5 graphic “ป้ายราคา” (user, locked)",
  ])
})

test("a hundred pieces read in a few kilobytes", () => {
  const captions = pipelinePieces("caption", Array.from({ length: 100 }, (_, i) => ({ startUs: i * 100_000, endUs: (i + 1) * 100_000, text: "ข้อความทดสอบบรรทัดหนึ่ง" })))
  expect(describeTimeline(timeline({ subtitles: true, captions })).length).toBeLessThan(8_000)
})
