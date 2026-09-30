import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { addHighlightTracks, type HighlightLook, type TimelineHighlightGroup } from "./highlights.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import { addSubtitleTrack } from "./subtitles.ts"
import type { DraftInfo, Segment } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/** The fixture draft (30 fps) after a 9.5 s rough cut. */
async function roughCut(): Promise<DraftInfo> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  return buildRoughCut(draft.info, [{ binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 9_500_000 }], binVideos(draft.meta))
}

type Entry = { id: string; [key: string]: unknown }
const list = (info: DraftInfo, key: string) => (info.materials[key] ?? []) as Entry[]
const textTracks = (info: DraftInfo) => info.tracks.filter((track) => track.type === "text")
const times = (segments: Segment[]) => segments.map((segment) => [segment.target_timerange.start, segment.target_timerange.duration])

const FONT = "/Users/someone/Movies/CapCut/boxblack/fonts/Kanit-ExtraBold.ttf"
/** Yellow text, a red accent, white as the second colour, on a yellow bar: black strokes and black bar text follow from that. */
const look: HighlightLook = {
  fontPath: FONT,
  strokeWidth: 0.08,
  barRoundness: 20,
  palette: { text: [1, 0.878, 0], accent: [0.85, 0.1, 0.3], alt: [1, 1, 1], bar: [1, 0.878, 0] },
  animation: { resourceId: "7664531520492686613", name: "รวมแบบป๊อปอัป", path: "/cache/effect/7664531520492686613/27f95588e49939b1aef6d5e55555a36e" },
}

const hook: TimelineHighlightGroup = {
  endUs: 2_000_000,
  lines: [
    { startUs: 0, text: "ถ้าคุณ", y: 0.6, scale: 2.5 },
    { startUs: 400_000, text: "กำลังมองหา", y: 0.3, scale: 2.1 },
    { startUs: 1_100_000, text: "ร้านทำเล็บ", y: 0, scale: 2.2 },
  ],
}
const price: TimelineHighlightGroup = { endUs: 6_000_000, lines: [{ startUs: 4_500_000, text: "299 บาท", y: 0.6, scale: 1.8 }] }

test("each line of a group gets its own text track, so the lines show together and leave together", async () => {
  const out = addHighlightTracks(await roughCut(), [hook, price], look)
  expect(out.tracks.map((track) => track.type)).toEqual(["video", "text", "text", "text"])
  const [first, second, third] = textTracks(out)
  expect(times(first!.segments)).toEqual([
    [0, 2_000_000],
    [4_500_000, 1_500_000],
  ])
  expect(times(second!.segments)).toEqual([[400_000, 1_600_000]])
  expect(times(third!.segments)).toEqual([[1_100_000, 900_000]])
  for (const track of [first, second, third]) {
    expect(track).toMatchObject({ type: "text", flag: 0, attribute: 0, name: "", is_default_name: true })
  }
})

test("lines are plain text in the look's font and colours, placed and sized by the layout", async () => {
  const out = addHighlightTracks(await roughCut(), [hook], look)
  const texts = list(out, "texts")
  const animations = list(out, "material_animations")
  const segments = textTracks(out).flatMap((track, index) => track.segments.map((segment) => ({ segment, trackIndex: out.tracks.indexOf(track), index })))
  expect(segments).toHaveLength(3)

  segments.forEach(({ segment, trackIndex, index }) => {
    const line = hook.lines[index]!
    expect(segment.source_timerange).toBeNull()
    expect(segment).toMatchObject({
      clip: { scale: { x: line.scale, y: line.scale }, transform: { x: 0, y: line.y } },
      render_index: 14000 + trackIndex,
      track_render_index: trackIndex,
      visible: true,
    })
    const material = texts.find((text) => text.id === segment.material_id)!
    expect(material).toMatchObject({
      type: "text",
      add_type: 0,
      group_id: "",
      text_color: "#ffe000",
      border_color: "#000000",
      border_width: 0.08,
      font_path: FONT,
      font_size: 15,
    })
    const content = JSON.parse(material.content as string)
    expect(content).toEqual({
      text: line.text,
      styles: [
        {
          fill: { content: { solid: { color: [1, 0.878, 0] }, render_type: "solid" } },
          range: [0, line.text.length],
          strokes: [{ width: 0.08, mode: 0, content: { solid: { color: [0, 0, 0] }, render_type: "solid" } }],
          size: 15,
          font: { path: FONT, id: "" },
          useLetterColor: true,
        },
      ],
    })

    expect(segment.extra_material_refs).toHaveLength(1)
    const animation = animations.find((entry) => entry.id === segment.extra_material_refs[0])!
    expect(animation).toMatchObject({ type: "sticker_animation", multi_language_current: "none" })
    expect(animation.animations).toEqual([
      {
        id: "7664531520492686613",
        type: "in",
        start: 0,
        // half the time on screen when that is under 0.5 s: the last line is up for 0.9 s
        duration: index === 2 ? 450_000 : 500_000,
        path: look.animation!.path,
        platform: "all",
        resource_id: "7664531520492686613",
        third_resource_id: "0",
        source_platform: 1,
        name: "รวมแบบป๊อปอัป",
        category_id: "ruchang",
        category_name: "เข้า",
        panel: "",
        material_type: "sticker",
        anim_adjust_params: null,
        request_id: "",
      },
    ])
  })
  const ids = [...out.tracks.map((t) => t.id), ...segments.map((s) => s.segment.id), ...texts.map((t) => t.id), ...animations.map((a) => a.id)]
  expect(new Set(ids).size).toBe(ids.length)
})

test("a line on screen for less than a second gets a shorter animation; without one the segment keeps an empty animation entry", async () => {
  const short: TimelineHighlightGroup = { endUs: 3_600_000, lines: [{ startUs: 3_000_000, text: "สั้น", y: 0, scale: 1 }] }
  const out = addHighlightTracks(await roughCut(), [short], look)
  expect((list(out, "material_animations")[0]!.animations as { duration: number }[])[0]!.duration).toBe(300_000)

  const plain = addHighlightTracks(await roughCut(), [short], { ...look, animation: null })
  expect(list(plain, "material_animations")[0]!.animations).toEqual([])
})

test("edges land on frames, stay inside the timeline, and lines shorter than a frame are left out", async () => {
  const info = await roughCut()
  expect(info.duration).toBe(9_500_000)
  const out = addHighlightTracks(
    info,
    [
      { endUs: 2_490_000, lines: [{ startUs: 1_010_000, text: "หนึ่ง", y: 0, scale: 1 }, { startUs: 2_480_000, text: "สั้นไป", y: 0, scale: 1 }, { startUs: 2_495_000, text: "ไม่มีเวลา", y: 0, scale: 1 }] },
      { endUs: 11_000_000, lines: [{ startUs: 9_000_000, text: "ท้าย", y: 0, scale: 1 }, { startUs: 9_600_000, text: "เลยไป", y: 0, scale: 1 }] },
    ],
    look,
  )
  const [first, second] = textTracks(out)
  // 30 fps: 1.01 s is frame 30, 2.49 s frame 75; 2.48 s is frame 74, one frame before the end
  expect(times(first!.segments)).toEqual([
    [1_000_000, 1_500_000],
    [9_000_000, 500_000],
  ])
  expect(times(second!.segments)).toEqual([[2_466_666, 33_334]])
  expect(textTracks(out)).toHaveLength(2)
})

test("blank lines are left out, and with nothing to show the draft is left as it was", async () => {
  const info = await roughCut()
  expect(addHighlightTracks(info, [], look)).toEqual(info)
  expect(addHighlightTracks(info, [{ endUs: 2_000_000, lines: [{ startUs: 0, text: "  ", y: 0, scale: 1 }] }], look)).toEqual(info)
  const out = addHighlightTracks(info, [{ endUs: 2_000_000, lines: [{ startUs: 0, text: " ", y: 0, scale: 1 }, { startUs: 500_000, text: " ท้าย ", y: 0, scale: 1 }] }], look)
  const [track] = textTracks(out)
  expect(times(track!.segments)).toEqual([[500_000, 1_500_000]])
  expect(JSON.parse(list(out, "texts")[0]!.content as string).text).toBe("ท้าย")
})

test("groups given out of order are placed by time", async () => {
  const out = addHighlightTracks(await roughCut(), [price, hook], look)
  expect(times(textTracks(out)[0]!.segments)).toEqual([
    [0, 2_000_000],
    [4_500_000, 1_500_000],
  ])
})

test("highlight tracks go on top of subtitles; existing tracks, materials and the input are not changed", async () => {
  const withCaptions = addSubtitleTrack(await roughCut(), [{ startUs: 0, endUs: 1_000_000, text: "ซับ" }], "g")
  const before = structuredClone(withCaptions)
  const out = addHighlightTracks(withCaptions, [hook], look)
  expect(withCaptions).toEqual(before)
  expect(out.tracks.slice(0, 2)).toEqual(withCaptions.tracks)
  expect(out.tracks.slice(2).map((track) => track.flag)).toEqual([0, 0, 0])
  expect(list(out, "texts").slice(0, 1)).toEqual(list(withCaptions, "texts"))
  expect(list(out, "material_animations").slice(0, 1)).toEqual(list(withCaptions, "material_animations"))
  for (const key of Object.keys(withCaptions.materials).filter((key) => key !== "texts" && key !== "material_animations")) {
    expect(out.materials[key], key).toEqual(withCaptions.materials[key])
  }
  expect(out.duration).toBe(withCaptions.duration)
})

test("the style range counts code points, as CapCut does, and covers the whole line", async () => {
  // "ลด 🔥" is four characters to CapCut and five UTF-16 units to JavaScript (spike, 2026-09-18)
  const out = addHighlightTracks(await roughCut(), [{ endUs: 1_000_000, lines: [{ startUs: 0, text: "ลด 🔥", y: 0, scale: 1 }] }], look)
  expect(JSON.parse(list(out, "texts")[0]!.content as string).styles[0].range).toEqual([0, 4])

  // a Thai mark takes an index of its own, so "กิ๊ก 50" is seven
  const marks = addHighlightTracks(await roughCut(), [{ endUs: 1_000_000, lines: [{ startUs: 0, text: "กิ๊ก 50", y: 0, scale: 1 }] }], look)
  expect(JSON.parse(list(marks, "texts")[0]!.content as string).styles[0].range).toEqual([0, 7])
})

test("a line never starts before the line above it in the previous group has gone", async () => {
  const out = addHighlightTracks(
    await roughCut(),
    [
      { endUs: 2_000_000, lines: [{ startUs: 0, text: "ก่อน", y: 0, scale: 1 }] },
      { endUs: 3_000_000, lines: [{ startUs: 1_500_000, text: "ทับ", y: 0, scale: 1 }] },
    ],
    look,
  )
  expect(times(textTracks(out)[0]!.segments)).toEqual([
    [0, 2_000_000],
    [2_000_000, 1_000_000],
  ])
})


const accented: TimelineHighlightGroup = {
  endUs: 2_000_000,
  lines: [{ startUs: 0, text: "กิ๊ก 50 บาท", y: 0.5, scale: 2, accent: { from: 5, to: 7 } }],
}

test("an accented word is its own style, and the styles tile the line", async () => {
  const out = addHighlightTracks(await roughCut(), [accented], look)
  const styles = JSON.parse(list(out, "texts")[0]!.content as string).styles as { range: [number, number]; fill: { content: { solid: { color: number[] } } } }[]
  expect(styles.map((style) => style.range)).toEqual([
    [0, 5],
    [5, 7],
    [7, 11],
  ])
  expect(styles.map((style) => style.fill.content.solid.color)).toEqual([look.palette.text, look.palette.accent, look.palette.text])
  // every style still carries the font, the size and the stroke
  for (const style of styles) expect(style).toMatchObject({ size: 15, font: { path: FONT, id: "" }, strokes: [{ width: 0.08 }] })
})

test("a line that is all accent is written as one accented style", async () => {
  const all = { endUs: 2_000_000, lines: [{ startUs: 0, text: "ลดครึ่งราคา", y: 0, scale: 1, accent: { from: 0, to: 11 } }] }
  const out = addHighlightTracks(await roughCut(), [all], look)
  const material = list(out, "texts")[0]!
  const styles = JSON.parse(material.content as string).styles as { range: number[]; fill: { content: { solid: { color: number[] } } } }[]
  expect(styles).toHaveLength(1)
  expect(styles[0]!.fill.content.solid.color).toEqual(look.palette.accent)
  expect(material.text_color).toBe("#d91a4d")
})

test("an accent at the start or the end of a line leaves no empty style behind", async () => {
  const start = { endUs: 2_000_000, lines: [{ startUs: 0, text: "50 บาท", y: 0, scale: 1, accent: { from: 0, to: 2 } }] }
  const end = { endUs: 2_000_000, lines: [{ startUs: 0, text: "ลดเหลือ 50", y: 0, scale: 1, accent: { from: 8, to: 10 } }] }
  const ranges = async (group: TimelineHighlightGroup) =>
    (JSON.parse(list(addHighlightTracks(await roughCut(), [group], look), "texts")[0]!.content as string).styles as { range: number[] }[]).map((style) => style.range)
  expect(await ranges(start)).toEqual([
    [0, 2],
    [2, 6],
  ])
  expect(await ranges(end)).toEqual([
    [0, 8],
    [8, 10],
  ])
})

const barred: TimelineHighlightGroup = {
  endUs: 2_000_000,
  lines: [
    { startUs: 0, text: "ลดเหลือ", y: 0.5, scale: 2, x: 0, bar: { width: 0.4, height: 0.1 } },
    { startUs: 500_000, text: "990 บาท", y: 0.2, scale: 2, bar: { width: 0.5, height: 0.1 }, accent: { from: 0, to: 3 } },
  ],
}

test("a bar is a rounded rect on a sticker track under the text, sized in canvas pixels", async () => {
  const info = await roughCut()
  const out = addHighlightTracks(info, [barred], look)
  expect(out.tracks.map((track) => track.type)).toEqual(["video", "sticker", "sticker", "text", "text"])
  const stickers = out.tracks.filter((track) => track.type === "sticker")
  const shapes = list(out, "shapes")
  expect(shapes).toHaveLength(2)

  // CapCut draws a shape 1.5 times the size it is given, so the size written is the wanted size over 1.5
  const width = info.canvas_config.width / 1.5
  const first = shapes.find((shape) => shape.id === stickers[0]!.segments[0]!.material_id)!
  expect(first).toMatchObject({ type: "shape", shape_type: 4, name: "rect_item", roundness: [20, 20, 20, 20], shape_size: [0.4 * width, 0.1 * width] })
  expect(first.custom_points).toEqual([-0.2 * width, 0.05 * width, 0.2 * width, 0.05 * width, 0.2 * width, -0.05 * width, -0.2 * width, -0.05 * width])
  expect((first.fill_render_style as { color: { solid: { color: string; alpha: number } } }).color.solid).toEqual({ color: "#ffe000", alpha: 1 })

  // the bar sits where its line does, for as long as its line does, and behind every text track
  const [bar] = stickers[0]!.segments
  const [text] = out.tracks.filter((track) => track.type === "text")[0]!.segments
  expect(bar!.clip).toMatchObject({ transform: { x: 0, y: 0.5 }, scale: { x: 1, y: 1 } })
  expect(bar!.target_timerange).toEqual(text!.target_timerange)
  expect(bar!.render_index).toBeLessThan(text!.render_index as number)
  expect(bar!.extra_material_refs).toEqual([])
})

test("text on a bar reads in the bar's colours and drops its stroke", async () => {
  const out = addHighlightTracks(await roughCut(), [barred], look)
  const material = list(out, "texts").find((text) => (JSON.parse(text.content as string) as { text: string }).text === "990 บาท")!
  // the line starts with its accented word, so that is the colour CapCut's panel shows
  expect(material).toMatchObject({ text_color: "#d91a4d", border_color: "", border_width: 0 })
  const styles = JSON.parse(material.content as string).styles as { fill: { content: { solid: { color: number[] } } }; strokes?: unknown }[]
  // the bar is yellow, so its text is black and the accent stays red, which reads on yellow
  expect(styles.map((style) => style.fill.content.solid.color)).toEqual([look.palette.accent, [0, 0, 0]])
  for (const style of styles) expect(style.strokes).toBeUndefined()
})

test("an accent the plan should have rejected is kept inside the line or ignored", async () => {
  const ranges = async (accent: { from: number; to: number }) => {
    const group = { endUs: 2_000_000, lines: [{ startUs: 0, text: "50 บาท", y: 0, scale: 1, accent }] }
    const out = addHighlightTracks(await roughCut(), [group], look)
    return (JSON.parse(list(out, "texts")[0]!.content as string).styles as { range: number[] }[]).map((style) => style.range)
  }
  // "50 บาท" is six characters: an end past that is cut back to it
  expect(await ranges({ from: 3, to: 99 })).toEqual([
    [0, 3],
    [3, 6],
  ])
  // an empty or backwards accent leaves the line in one colour
  expect(await ranges({ from: 3, to: 3 })).toEqual([[0, 6]])
  expect(await ranges({ from: 4, to: 2 })).toEqual([[0, 6]])
})

test("staggered lines and their bars sit off centre together", async () => {
  const stair: TimelineHighlightGroup = {
    endUs: 2_000_000,
    lines: [
      { startUs: 0, text: "ลดเหลือ", y: 0.5, scale: 2, x: -0.2, bar: { width: 0.4, height: 0.1 } },
      { startUs: 500_000, text: "990 บาท", y: 0.2, scale: 2, x: 0.2 },
    ],
  }
  const out = addHighlightTracks(await roughCut(), [stair], look)
  const texts = out.tracks.filter((track) => track.type === "text")
  expect(texts.map((track) => (track.segments[0]!.clip as { transform: { x: number } }).transform.x)).toEqual([-0.2, 0.2])
  const [bar] = out.tracks.filter((track) => track.type === "sticker")[0]!.segments
  expect((bar!.clip as { transform: { x: number } }).transform.x).toBe(-0.2)
})

test("the text tracks are numbered above the bar tracks they sit on", async () => {
  const info = await roughCut()
  const out = addHighlightTracks(info, [barred], look)
  const texts = out.tracks.filter((track) => track.type === "text")
  // one video track, then two bar tracks, so the text tracks are the fourth and fifth
  expect(texts.map((track) => track.segments[0]!.track_render_index)).toEqual([3, 4])
  expect(texts.map((track) => track.segments[0]!.render_index)).toEqual([14003, 14004])
})

test("a group with no bars adds no sticker track and leaves the shapes alone", async () => {
  const info = await roughCut()
  const out = addHighlightTracks(info, [hook], look)
  expect(out.tracks.some((track) => track.type === "sticker")).toBe(false)
  expect(out.materials.shapes).toEqual(info.materials.shapes)
})

test("an exit animation plays at the end of every line of its group", async () => {
  const exit = { resourceId: "7660000000000000000", name: "จางออก" }
  const out = addHighlightTracks(await roughCut(), [{ ...hook, exit }], look)
  const animations = list(out, "material_animations")
  expect(animations).toHaveLength(3)
  const last = animations[2]!.animations as { type: string; start: number; duration: number; path: string; category_id: string }[]
  // the third line is up for 0.9 s: in 0.45 s, out 0.3 s ending with the line
  expect(last.map((entry) => entry.type)).toEqual(["in", "out"])
  // CapCut plays an out animation at the end of the segment by itself, from start 0, as it writes them
  expect(last[1]).toMatchObject({ start: 0, duration: 300_000, path: "", category_id: "chuchang", resource_id: exit.resourceId, name: "จางออก" })

  // a line up for less than 0.6 s gives the exit half its time
  const short = addHighlightTracks(await roughCut(), [{ endUs: 3_400_000, lines: [{ startUs: 3_000_000, text: "สั้น", y: 0, scale: 1 }], exit }], look)
  const brief = (list(short, "material_animations")[0]!.animations as { type: string; start: number; duration: number }[])[1]!
  expect(brief).toMatchObject({ type: "out", start: 0, duration: 200_000 })

  // without an exit the group keeps only its entrance
  expect((list(addHighlightTracks(await roughCut(), [hook], look), "material_animations")[0]!.animations as { type: string }[]).map((entry) => entry.type)).toEqual(["in"])
})

/* colours worked out from the palette */

const fills = (out: DraftInfo, text: string) => {
  const material = list(out, "texts").find((entry) => (JSON.parse(entry.content as string) as { text: string }).text === text)!
  const styles = JSON.parse(material.content as string).styles as { fill: { content: { solid: { color: number[] } } }; strokes?: { content: { solid: { color: number[] } } }[] }[]
  return { material, ranges: styles.map((style) => ({ fill: style.fill.content.solid.color, stroke: style.strokes?.[0]?.content.solid.color })) }
}

test("dark text gets a white stroke, and an accented word gets a stroke of its own", async () => {
  const dark: HighlightLook = { ...look, palette: { text: [0.07, 0.07, 0.07], accent: [1, 0.878, 0], alt: [0.2, 0.4, 0.9], bar: [1, 1, 1] } }
  const group = { endUs: 2_000_000, lines: [{ startUs: 0, text: "ลด 50 บาท", y: 0, scale: 1, accent: { from: 3, to: 5 } }] }
  const { material, ranges } = fills(addHighlightTracks(await roughCut(), [group], dark), "ลด 50 บาท")
  // black letters need a white stroke; the yellow "50" needs a black one
  expect(ranges).toEqual([
    { fill: [0.07, 0.07, 0.07], stroke: [1, 1, 1] },
    { fill: [1, 0.878, 0], stroke: [0, 0, 0] },
    { fill: [0.07, 0.07, 0.07], stroke: [1, 1, 1] },
  ])
  expect(material).toMatchObject({ text_color: "#121212", border_color: "#ffffff", border_width: 0.08 })

  // a line that opens with its accented word shows that word's colour and stroke in CapCut's panel
  const opening = { endUs: 2_000_000, lines: [{ startUs: 0, text: "ลด 50 บาท", y: 0, scale: 1, accent: { from: 0, to: 2 } }] }
  expect(fills(addHighlightTracks(await roughCut(), [opening], dark), "ลด 50 บาท").material).toMatchObject({ text_color: "#ffe000", border_color: "#000000" })
})

test("a group's tone picks which palette colour its lines read in, and the accent takes another", async () => {
  const line = (tone: "base" | "accent" | "alt") => ({ endUs: 2_000_000, lines: [{ startUs: 0, text: "ลด 50 บาท", y: 0, scale: 1, tone, accent: { from: 3, to: 5 } }] })
  const base = fills(addHighlightTracks(await roughCut(), [line("base")], look), "ลด 50 บาท").ranges.map((range) => range.fill)
  const accent = fills(addHighlightTracks(await roughCut(), [line("accent")], look), "ลด 50 บาท").ranges.map((range) => range.fill)
  const alt = fills(addHighlightTracks(await roughCut(), [line("alt")], look), "ลด 50 บาท").ranges.map((range) => range.fill)
  expect(base).toEqual([look.palette.text, look.palette.accent, look.palette.text])
  expect(accent).toEqual([look.palette.accent, look.palette.alt, look.palette.accent])
  expect(alt).toEqual([look.palette.alt, look.palette.accent, look.palette.alt])
})

test("on a dark bar the text is white and the accent is the first palette colour that reads on it", async () => {
  const dark: HighlightLook = { ...look, palette: { text: [1, 1, 1], accent: [0.95, 0.76, 0.31], alt: [0.5, 0.72, 0.75], bar: [0.07, 0.07, 0.07] } }
  const group = { endUs: 2_000_000, lines: [{ startUs: 0, text: "ลด 50 บาท", y: 0, scale: 1, tone: "alt" as const, bar: { width: 0.4, height: 0.1 }, accent: { from: 3, to: 5 } }] }
  const out = addHighlightTracks(await roughCut(), [group], dark)
  const { ranges } = fills(out, "ลด 50 บาท")
  // the tone is beside the point on a bar: the bar's own colour decides
  expect(ranges).toEqual([
    { fill: [1, 1, 1], stroke: undefined },
    { fill: [0.95, 0.76, 0.31], stroke: undefined },
    { fill: [1, 1, 1], stroke: undefined },
  ])
  expect((list(out, "shapes")[0]!.fill_render_style as { color: { solid: { color: string } } }).color.solid.color).toBe("#121212")
})
