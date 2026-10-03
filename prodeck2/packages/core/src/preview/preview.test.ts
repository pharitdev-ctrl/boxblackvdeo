import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import type { HighlightLook } from "../capcut/highlights.ts"
import { binVideos, loadDraft } from "../capcut/read.ts"
import { pipelinePieces, TIMELINE_VERSION, type AgentTimeline } from "../timeline/types.ts"
import { writeTimeline } from "../timeline/write.ts"
import { layersAt, momentsOf, readPreviewDraft, SUBTITLE_PX_PER_SIZE, TEXT_PX_PER_SIZE, valueAt, type PreviewLayer } from "./layers.ts"

const CLIP = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"
const s = (seconds: number) => Math.round(seconds * 1_000_000)
const look: HighlightLook = {
  fontPath: "/fonts/Mali-Bold.ttf",
  strokeWidth: 0.08,
  barRoundness: 50,
  palette: { text: [1, 0.878, 0], accent: [0.85, 0.1, 0.3], alt: [1, 1, 1], bar: [1, 0.878, 0] },
  animation: null,
}

/** The fixture draft with a 6 s rough cut of two pieces, a caption, a highlight line with an accent and one on a bar, a push in on the first piece, and a graphic. */
async function written() {
  const loaded = await loadDraft(join(await makeDraftRoot(), "0917"))
  const timeline: AgentTimeline = {
    version: TIMELINE_VERSION,
    direction: "",
    canvas: { width: 1080, height: 1920 },
    durationUs: s(6),
    cuts: pipelinePieces("cut", [
      { binId: CLIP, sourceStartUs: s(10), sourceDurationUs: s(4) },
      { binId: CLIP, sourceStartUs: s(2), sourceDurationUs: s(2) },
    ]),
    subtitles: true,
    captions: pipelinePieces("caption", [{ startUs: 0, endUs: s(1), text: "สวัสดีครับ" }]),
    highlights: {
      look,
      groups: pipelinePieces("highlight", [
        { endUs: s(3), exit: null, lines: [{ startUs: s(1), text: "ราคา 5 บาท", x: 0, y: 0.6, scale: 2, tone: "base", accent: { from: 5, to: 6 } }] },
        { endUs: s(5), exit: null, lines: [{ startUs: s(4), text: "อร่อย", x: 0, y: -0.2, scale: 1.5, tone: "base", accent: null, bar: { width: 0.5, height: 0.08 } }] },
      ]),
    },
    moves: pipelinePieces("move", [{ cut: 0, startUs: 0, poses: [{ s: 0, scale: 1, x: 0, y: 0, rot: 0, ease: "line" as const }, { s: 2, scale: 1.2, x: 0, y: 0, rot: 0, ease: "line" as const }] }]),
    zooms: [],
    inserts: [],
    graphics: pipelinePieces("graphic", [{ atUs: s(2), durationUs: s(1.5), binId: "g1", path: "/g/price.mov", name: "price.mov", width: 400, height: 300, durationOfFileUs: s(1.5), place: { scale: 0.5, x: 0.1, y: 0.5 } }]),
    composed: [],
    sounds: [],
    binItems: [],
  }
  return writeTimeline(loaded.info, binVideos(loaded.meta), timeline as never, { subtitleGroupId: "g", prune: null }).info
}

const kinds = (layers: PreviewLayer[]) => layers.map((layer) => layer.kind)

test("each moment shows the main video at its source time under the text, the graphic and the bars, in render order", async () => {
  const info = await written()
  const draft = readPreviewDraft(info)
  expect(draft.canvas).toEqual({ width: info.canvas_config.width, height: info.canvas_config.height })

  const opening = layersAt(draft, s(0.5))
  expect(kinds(opening)).toEqual(["video", "text"])
  const main = opening[0] as Extract<PreviewLayer, { kind: "video" }>
  expect(main.overlay).toBe(false)
  expect(main.sourceUs).toBe(s(10.5))
  const caption = opening[1] as Extract<PreviewLayer, { kind: "text" }>
  expect(caption.subtitle).toBe(true)
  expect(caption.lines.map((line) => line.map((run) => run.text).join(""))).toEqual(["สวัสดีครับ"])

  // the second piece plays from 2 s in its file
  expect((layersAt(draft, s(4.5))[0] as Extract<PreviewLayer, { kind: "video" }>).sourceUs).toBe(s(2.5))

  // the graphic is above the main video and below the text, where its place says
  const middle = layersAt(draft, s(2.5))
  expect(kinds(middle)).toEqual(["video", "video", "text"])
  const graphic = middle[1] as Extract<PreviewLayer, { kind: "video" }>
  expect(graphic).toMatchObject({ file: "/g/price.mov", overlay: true, sourceUs: s(0.5), native: { width: 400, height: 300 } })
  expect(graphic.look).toMatchObject({ scale: 0.5, x: 0.1, y: 0.5 })

  // the line on a bar has its bar under it
  expect(kinds(layersAt(draft, s(4.5)))).toEqual(["video", "shape", "text"])
  expect(layersAt(draft, s(6.5))).toEqual([])
})

test("text is split into runs by colour, in the app's font, sized as CapCut draws it; the push in follows its keyframes", async () => {
  const info = await written()
  const draft = readPreviewDraft(info)
  const price = layersAt(draft, s(1.5)).find((layer) => layer.kind === "text" && !layer.subtitle) as Extract<PreviewLayer, { kind: "text" }>
  expect(price.font).toBe("Mali-Bold")
  expect(price.lines[0]!.map((run) => run.text)).toEqual(["ราคา ", "5", " บาท"])
  expect(price.lines[0]![1]!.color).toEqual(look.palette.accent)
  expect(price.lines[0]![0]!.stroke).not.toBeNull()
  expect(price.sizePx).toBeCloseTo(15 * TEXT_PX_PER_SIZE * (draft.canvas.width / 1080))
  expect(price.look).toMatchObject({ y: 0.6, scale: 2 })
  const caption = layersAt(draft, s(0.5))[1] as Extract<PreviewLayer, { kind: "text" }>
  // the subtitle template's size 11, at the subtitles' own rate
  expect(caption.sizePx).toBeCloseTo(11 * SUBTITLE_PX_PER_SIZE * (draft.canvas.width / 1080))
  expect(caption.font).not.toBe("Mali-Bold")

  // linear between keyframes: halfway through the push, halfway to 1.2
  const scaleAt = (t: number) => (layersAt(draft, s(t))[0] as Extract<PreviewLayer, { kind: "video" }>).look.scale
  expect(scaleAt(0)).toBeCloseTo(1, 2)
  expect(scaleAt(1)).toBeCloseTo(1.1, 2)
  expect(scaleAt(3)).toBeCloseTo(1.2, 2)
  expect(valueAt([{ property: "KFTypeScaleX", points: [{ atUs: 0, value: 1 }, { atUs: 10, value: 2 }] }], "KFTypeScaleX", 5)).toBe(1.5)
})

test("a file not on this machine is left out and listed; the main video's sound is kept for the mix", async () => {
  const info = await written()
  const draft = readPreviewDraft(info, (path) => (path.endsWith("price.mov") ? null : path))
  expect(kinds(layersAt(draft, s(2.5)))).toEqual(["video", "text"])
  expect(draft.skipped.some((line) => line.includes("price.mov"))).toBe(true)
  expect(draft.sounds.map((sound) => [sound.startUs, sound.durationUs, sound.sourceUs])).toEqual([
    [0, s(4), s(10)],
    [s(4), s(2), s(2)],
  ])
})

test("a look's moments: one every half second from a quarter in, spread wider past the most, inside the clip", () => {
  expect(momentsOf({ startUs: 0, endUs: s(2) }, s(10))).toEqual([s(0.25), s(0.75), s(1.25), s(1.75)])
  const long = momentsOf({ startUs: 0, endUs: s(60) }, s(60), 40)
  expect(long).toHaveLength(40)
  expect(long[1]! - long[0]!).toBe(s(1.5))
  expect(momentsOf({ startUs: s(9), endUs: s(20) }, s(10))).toEqual([s(9.25), s(9.75)])
  expect(momentsOf({ startUs: s(5), endUs: s(5) }, s(10))).toEqual([])
})
