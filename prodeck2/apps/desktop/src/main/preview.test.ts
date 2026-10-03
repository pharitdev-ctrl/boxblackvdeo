import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../../../packages/core/test/fixture-root.ts"
import type { DrawTile } from "@boxblack/core/preview"
import { pipelinePieces, TIMELINE_VERSION, type AgentTimeline } from "@boxblack/core/timeline"
import type { FrameAsk } from "./preview-frames.ts"
import { createPreview } from "./preview.ts"

const CLIP = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"
const s = (seconds: number) => Math.round(seconds * 1_000_000)

const timeline = (text: string): AgentTimeline => ({
  version: TIMELINE_VERSION,
  direction: "",
  canvas: { width: 1080, height: 1920 },
  durationUs: s(6),
  cuts: pipelinePieces("cut", [{ binId: CLIP, sourceStartUs: s(10), sourceDurationUs: s(6) }]),
  subtitles: false,
  captions: [],
  highlights: {
    look: { fontPath: "/fonts/Mali-Bold.ttf", strokeWidth: 0.08, barRoundness: 50, palette: { text: [1, 1, 1], accent: [1, 0, 0], alt: [1, 1, 1], bar: [1, 1, 0] }, animation: null },
    groups: pipelinePieces("highlight", [{ endUs: s(3), exit: null, lines: [{ startUs: s(1), text, x: 0, y: 0.6, scale: 2, tone: "base", accent: null }] }]),
  },
  moves: [],
  zooms: [],
  inserts: [],
  graphics: [],
  composed: [],
  sounds: [],
  binItems: [],
})

function setup() {
  const asks: FrameAsk[][] = []
  const draws: { tiles: DrawTile[]; fonts: string[]; tile: { width: number; height: number } }[] = []
  const preview = createPreview({
    frames: { frames: async (list) => (asks.push(list), list.map((_, i) => `data:image/jpeg;base64,${i}`)) },
    page: { draw: async (tiles, options, fonts) => (draws.push({ tiles, fonts, tile: options.tile }), Buffer.from(`sheet ${draws.length}`)) },
    exists: (path) => path !== "/missing.ttf",
  })
  return { preview, asks, draws }
}

test("a look writes the timeline in memory, pulls the frame of every moment, and draws them eight to a sheet with their times", async () => {
  const folder = join(await makeDraftRoot(), "0917")
  const { preview, asks, draws } = setup()
  const look = await preview.look(folder, timeline("ราคา 5 บาท"), null)
  // 6 s, one moment every half second
  expect(look.moments).toHaveLength(12)
  expect(look.sheets.map(String)).toEqual(["sheet 1", "sheet 2"])
  expect(draws.map((d) => d.tiles.length)).toEqual([8, 4])
  expect(draws[0]!.tiles[0]!.label).toBe("0.25s")
  // every moment shows the main video at its time in the file
  expect(asks[0]!).toHaveLength(12)
  expect(asks[0]![0]).toMatchObject({ sourceUs: s(10.25), alpha: false, width: 432 })
  // the text the timeline carries, from the writer, in its font
  const atText = draws[0]!.tiles[2]!.layers
  expect(atText.map((layer) => layer.kind)).toEqual(["video", "text"])
  expect(atText[0]).toMatchObject({ src: "data:image/jpeg;base64,2" })
  expect(draws[0]!.fonts).toEqual(["/fonts/Mali-Bold.ttf"])
  expect(draws[0]!.tile.width).toBe(288)
})

test("a look of a span shows only its moments; a changed timeline shows the change", async () => {
  const folder = join(await makeDraftRoot(), "0917")
  const { preview, draws } = setup()
  const look = await preview.look(folder, timeline("ราคา 5 บาท"), { startUs: s(1), endUs: s(2) })
  expect(look.moments).toEqual([s(1.25), s(1.75)])
  await preview.look(folder, timeline("ราคา 9 บาท"), { startUs: s(1), endUs: s(2) })
  const textOf = (n: number) => draws[n]!.tiles[0]!.layers.flatMap((layer) => (layer.kind === "text" ? layer.lines.flat().map((run) => run.text) : [])).join("")
  expect([textOf(0), textOf(1)]).toEqual(["ราคา 5 บาท", "ราคา 9 บาท"])
})
