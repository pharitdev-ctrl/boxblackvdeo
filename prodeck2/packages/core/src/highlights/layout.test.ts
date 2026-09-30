import { readFile } from "node:fs/promises"
import { expect, test } from "vitest"
import { FONT_METRICS } from "./font-metrics.ts"
import { layoutGroup, LINE_WIDTH_RATIO, SUBTITLE_ROOM_FROM_Y, textUnits, type HighlightPlacement } from "./layout.ts"
import { HIGHLIGHT_FONTS, HIGHLIGHT_POSITIONS, HIGHLIGHT_STYLES, maxHighlightChars } from "./styles.ts"
import { METRIC_CHARS, readFontMetrics } from "./ttf.ts"

const PORTRAIT = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }

test("the generated metrics match the fonts shipped with the app", async () => {
  for (const [id, file] of Object.entries(HIGHLIGHT_FONTS)) {
    const data = await readFile(new URL(`../../../../apps/desktop/resources/fonts/${file}`, import.meta.url))
    expect(FONT_METRICS[id as keyof typeof HIGHLIGHT_FONTS], id).toEqual(readFontMetrics(data, METRIC_CHARS))
  }
})

test("every style uses a shipped font and an animation CapCut played from its id", () => {
  const played = ["7664531520492686613", "7664533258335440148", "7643711191419833618"]
  for (const style of Object.values(HIGHLIGHT_STYLES)) {
    expect(Object.keys(HIGHLIGHT_FONTS)).toContain(style.font)
    expect(played).toContain(style.animation.resourceId)
    expect(style.strokeWidth).toBeGreaterThan(0)
  }
})

test("lines are shorter on portrait and square output than on landscape", () => {
  expect(maxHighlightChars(PORTRAIT)).toBe(12)
  expect(maxHighlightChars({ width: 1080, height: 1080 })).toBe(12)
  expect(maxHighlightChars(LANDSCAPE)).toBe(18)
})

test("text is measured in lines of the font's own height, as CapCut sizes it", () => {
  // 10 consonants of Kanit ExtraBold are 6.872 em wide; its typo line is 1.495 em
  expect(textUnits("กขคงจฉชซฌญ", "kanit")).toBeCloseTo(6.872 / 1.495, 6)
  // marks above and below take no room
  expect(textUnits("กี่", "kanit")).toBeCloseTo(textUnits("ก", "kanit"), 6)
  // a character the font lacks counts as an average Thai consonant
  const consonants = Array.from({ length: 46 }, (_, i) => String.fromCodePoint(0x0e01 + i)).filter((c) => FONT_METRICS.mali.advances[c] !== undefined)
  expect(consonants).toHaveLength(46)
  const average = consonants.reduce((sum, c) => sum + FONT_METRICS.mali.advances[c]!, 0) / consonants.length / FONT_METRICS.mali.lineHeight
  expect(textUnits("😀", "mali")).toBeCloseTo(average, 9)
})

const widthOf = (text: string, scale: number, canvas = PORTRAIT) => textUnits(text, "kanit") * LINE_WIDTH_RATIO * scale * canvas.width
const heightOf = (scale: number, canvas = PORTRAIT) => LINE_WIDTH_RATIO * scale * canvas.width

const fixed = (position: "top" | "middle" | "bottom"): HighlightPlacement => ({ kind: "fixed", position })
const auto = (band: [number, number] | null, keepSubtitleRoom = false): HighlightPlacement => ({
  kind: "auto",
  keepClear: band && { fromY: band[0], toY: band[1] },
  keepSubtitleRoom,
})

test("a long line fills most of the width; a short one is as tall as allowed", () => {
  const { lines: [long, short] } = layoutGroup(["ร้านทำเล็บจตุจักร", "ถ้าคุณ"], "kanit", PORTRAIT, fixed("top"))
  expect(widthOf("ร้านทำเล็บจตุจักร", long!.scale)).toBeCloseTo(0.84 * PORTRAIT.width, 3)
  expect(heightOf(short!.scale)).toBeCloseTo(0.13 * PORTRAIT.height, 3)
  expect(widthOf("ถ้าคุณ", short!.scale)).toBeLessThan(0.84 * PORTRAIT.width)

  // landscape frames are short, so the height limit bites sooner
  const [wide] = layoutGroup(["ถ้าคุณ"], "kanit", LANDSCAPE, fixed("top")).lines
  expect(heightOf(wide!.scale, LANDSCAPE)).toBeCloseTo(0.13 * LANDSCAPE.height, 3)
})

/** Top and bottom edge of each line's box, in CapCut's y units (+1 top of frame, −1 bottom). */
function boxes(texts: string[], placement: HighlightPlacement, canvas = PORTRAIT) {
  return layoutGroup(texts, "kanit", canvas, placement).lines.map(({ y, scale }) => {
    const half = ((LINE_WIDTH_RATIO * scale * canvas.width) / canvas.height) * 1.05
    return { top: y + half, bottom: y - half }
  })
}

const HOOK = ["ถ้าคุณ", "กำลังมองหา", "ร้านทำเล็บ"]

test("lines stack downwards in order without overlapping", () => {
  const stacked = boxes(HOOK, fixed("top"))
  for (let i = 1; i < stacked.length; i++) {
    expect(stacked[i]!.top).toBeCloseTo(stacked[i - 1]!.bottom, 6)
    expect(stacked[i]!.bottom).toBeLessThan(stacked[i]!.top)
  }
})

test("the block sits at the top, around the middle, or above the subtitles", () => {
  expect(boxes(HOOK, fixed("top"))[0]!.top).toBeCloseTo(0.72, 6)
  const middle = boxes(HOOK, fixed("middle"))
  expect((middle[0]!.top + middle.at(-1)!.bottom) / 2).toBeCloseTo(0.1, 6)
  expect(boxes(HOOK, fixed("bottom")).at(-1)!.bottom).toBeCloseTo(-0.52, 6)
  // one line at the bottom sits in the same place
  expect(boxes(["ถ้าคุณ"], fixed("bottom"))[0]!.bottom).toBeCloseTo(-0.52, 6)
})

test("a block too tall for its place is kept inside the frame", () => {
  const tall = ["ก", "ข", "ค", "ง", "จ", "ฉ", "ช", "ซ"]
  expect(boxes(tall, fixed("bottom"))[0]!.top).toBeLessThanOrEqual(0.92 + 1e-9)
  const top = boxes(tall, fixed("top"))
  expect(top.at(-1)!.bottom).toBeGreaterThanOrEqual(-0.92 - 1e-9)
})

test("no lines, no layout", () => {
  expect(layoutGroup([], "kanit", PORTRAIT, fixed("middle"))).toEqual({ lines: [], dodge: "fixed" })
  expect(layoutGroup([], "kanit", PORTRAIT, auto(null))).toEqual({ lines: [], dodge: "no-picture" })
})

const dodgeOf = (texts: string[], placement: HighlightPlacement) => layoutGroup(texts, "kanit", PORTRAIT, placement).dodge
const ONE = ["ถ้าคุณ"]
const THREE = HOOK

test("with nothing to keep clear the text sits on top, as it always did", () => {
  expect(boxes(ONE, auto(null))[0]!.top).toBeCloseTo(0.72, 6)
  expect(dodgeOf(ONE, auto(null))).toBe("no-picture")
  expect(boxes(THREE, auto(null))).toEqual(boxes(THREE, fixed("top")))
})

test("a face low in the frame leaves the text where it always sits", () => {
  // 45–80 % down the frame: the band's top is y 0.1, so a block ending at 0.72 − its height clears it
  expect(boxes(ONE, auto([0.45, 0.8]))[0]!.top).toBeCloseTo(0.72, 6)
  expect(dodgeOf(ONE, auto([0.45, 0.8]))).toBe("above")
})

test("a face higher up pushes the text up, but never off the frame", () => {
  // 25–70 %: the band's top is y 0.5, so with the 5 % margin the block must end at 0.6 or above
  const [box] = boxes(ONE, auto([0.25, 0.7]))
  expect(box!.bottom).toBeCloseTo(0.6, 6)
  expect(box!.top).toBeGreaterThan(0.72)
  expect(box!.top).toBeLessThanOrEqual(0.92)
  expect(dodgeOf(ONE, auto([0.25, 0.7]))).toBe("above")
})

test("no room above sends the text under the face, at the usual bottom or lower", () => {
  // a face across the top half leaves nothing above but plenty below
  const under = boxes(ONE, auto([0.05, 0.5]))
  expect(under.at(-1)!.bottom).toBeCloseTo(-0.52, 6)
  expect(dodgeOf(ONE, auto([0.05, 0.5]))).toBe("below")

  // a face reaching further down pushes it lower still, but not off the frame
  const lower = boxes(ONE, auto([0.05, 0.76]))
  expect(lower[0]!.top).toBeCloseTo(-0.62, 6)
  expect(lower.at(-1)!.bottom).toBeLessThan(-0.52)
  expect(lower.at(-1)!.bottom).toBeGreaterThanOrEqual(-0.92 - 1e-9)
})

test("with subtitles on, text under the face still stays above them", () => {
  const withSubtitles = boxes(ONE, auto([0.1, 0.5], true))
  expect(withSubtitles.at(-1)!.bottom).toBeCloseTo(-0.52, 6)
  expect(dodgeOf(ONE, auto([0.1, 0.5], true))).toBe("below")
  expect(boxes(ONE, auto([0.1, 0.5]))).toEqual(withSubtitles)

  // a face reaching down to where the text would go leaves nowhere with subtitles on, but room without them
  expect(dodgeOf(ONE, auto([0.05, 0.76], true))).toBe("over")
  // it then goes to the top of the frame, where it covers the least of the face
  expect(boxes(ONE, auto([0.05, 0.76], true))[0]!.top).toBeCloseTo(0.92, 6)
  expect(dodgeOf(ONE, auto([0.05, 0.76]))).toBe("below")
})

test("a face filling the middle leaves the text right above it rather than over it", () => {
  // what Claude said about the 0917 clip: the face runs 18–62 % down the frame
  const face = auto([0.18, 0.62], true)
  const [box] = boxes(ONE, face)
  expect(dodgeOf(ONE, face)).toBe("above")
  // no room for the 5 % margin, so the text sits right on the edge of the face and no lower
  expect(box!.bottom).toBeCloseTo(1 - 2 * 0.18, 6)
  expect(box!.top).toBeLessThanOrEqual(0.92)
})

test("text made smaller to fit under a face stays under it, with the subtitles off", () => {
  // a face down to 62 % and three lines: only a smaller block fits below, and it must not climb back up
  const face = auto([0.05, 0.62])
  expect(dodgeOf(THREE, face)).toBe("below")
  const under = boxes(THREE, face)
  expect(under[0]!.top).toBeLessThanOrEqual(1 - 2 * 0.62 + 1e-9)
  expect(under.at(-1)!.bottom).toBeGreaterThanOrEqual(-0.92 - 1e-9)
})

test("text too tall for the gap is made smaller rather than put across the face", () => {
  // the 0917 face with a two-line hook: neither gap fits it whole
  const face = auto([0.22, 0.58], true)
  const two = HOOK.slice(0, 2)
  const full = boxes(two, fixed("top"))
  const dodged = boxes(two, face)
  expect(dodgeOf(two, face)).toBe("above")
  // it clears the face and is smaller, but not by more than 40 %
  expect(dodged.at(-1)!.bottom).toBeGreaterThanOrEqual(1 - 2 * 0.22 - 1e-9)
  expect(dodged[0]!.top).toBeCloseTo(0.92, 6)
  const heightOfBlock = (block: { top: number; bottom: number }[]) => block[0]!.top - block.at(-1)!.bottom
  expect(heightOfBlock(dodged)).toBeLessThan(heightOfBlock(full))
  expect(heightOfBlock(dodged) / heightOfBlock(full)).toBeGreaterThanOrEqual(0.6)
  // the lines are drawn smaller too, not just squeezed together
  expect(layoutGroup(two, "kanit", PORTRAIT, face).lines[0]!.scale).toBeLessThan(layoutGroup(two, "kanit", PORTRAIT, fixed("top")).lines[0]!.scale)
})

test("when there is more room under the picture, the smaller text goes there", () => {
  // a face across the top: the gap below it is the bigger one, but not big enough for three lines whole
  const high = auto([0.05, 0.45], true)
  expect(dodgeOf(THREE, high)).toBe("below")
  const dodged = boxes(THREE, high)
  expect(dodged[0]!.top).toBeCloseTo(1 - 2 * 0.45, 6)
  expect(dodged.at(-1)!.bottom).toBeGreaterThanOrEqual(-0.52 - 1e-9)
  expect(dodged[0]!.top - dodged.at(-1)!.bottom).toBeLessThan(boxes(THREE, fixed("top"))[0]!.top - boxes(THREE, fixed("top")).at(-1)!.bottom)
})

test("text that would have to shrink by more than 40 % covers the picture instead", () => {
  // three lines against a face across most of the frame: shrinking that far would be unreadable
  expect(dodgeOf(THREE, auto([0.2, 0.7], true))).toBe("over")
  // a little more room and it shrinks to clear the face instead
  expect(dodgeOf(THREE, auto([0.3, 0.62], true))).toBe("above")
})

test("a picture that must stay clear everywhere is covered as little as possible", () => {
  const overAll = boxes(THREE, auto([0, 1]))
  expect(dodgeOf(THREE, auto([0, 1]))).toBe("over")
  // the top of the frame: the same overlap either way, so the text goes up
  expect(overAll[0]!.top).toBeCloseTo(0.92, 6)

  // a band that leaves a little more room at the bottom sends it there
  const lowerHalf = boxes(THREE, auto([0, 0.85]))
  expect(lowerHalf.at(-1)!.bottom).toBeCloseTo(-0.92, 6)
  expect(dodgeOf(THREE, auto([0, 0.85]))).toBe("over")
})

test("a pinned position ignores the picture", () => {
  expect(boxes(THREE, fixed("middle"))).not.toEqual(boxes(THREE, auto([0.05, 0.5])))
  expect(dodgeOf(THREE, fixed("bottom"))).toBe("fixed")
})

test("one word on its own goes taller in the punch pattern, and no further", () => {
  const [stacked] = layoutGroup(["ว้าว"], "kanit", PORTRAIT, fixed("top")).lines
  const [punched] = layoutGroup(["ว้าว"], "kanit", PORTRAIT, fixed("top"), "punch").lines
  expect(heightOf(stacked!.scale)).toBeCloseTo(0.13 * PORTRAIT.height, 3)
  expect(heightOf(punched!.scale)).toBeCloseTo(0.2 * PORTRAIT.height, 3)
  // a long line is still held to the width of the frame
  const [long] = layoutGroup(["ร้านทำเล็บจตุจักร"], "kanit", PORTRAIT, fixed("top"), "punch").lines
  expect(widthOf("ร้านทำเล็บจตุจักร", long!.scale)).toBeCloseTo(0.84 * PORTRAIT.width, 3)
})

test("staggered lines alternate sides and stay narrow enough to keep apart", () => {
  const { lines } = layoutGroup(HOOK, "kanit", PORTRAIT, fixed("top"), "stair")
  expect(lines.map((line) => line.x)).toEqual([-0.2, 0.2, -0.2])
  lines.forEach((line, i) => expect(widthOf(HOOK[i]!, line.scale)).toBeLessThanOrEqual(0.6 * PORTRAIT.width + 1e-9))
  const [long] = layoutGroup(["ร้านทำเล็บจตุจักร"], "kanit", PORTRAIT, fixed("top"), "stair").lines
  expect(widthOf("ร้านทำเล็บจตุจักร", long!.scale)).toBeCloseTo(0.6 * PORTRAIT.width, 3)
  // every other pattern keeps its lines centred
  expect(layoutGroup(HOOK, "kanit", PORTRAIT, fixed("top")).lines.map((line) => line.x)).toEqual([0, 0, 0])
})

test("a bar is as wide as its line plus a margin, as tall as a line may be, and the bars do not touch", () => {
  const { lines } = layoutGroup(["ถ้าคุณ", "ร้านทำเล็บ"], "kanit", PORTRAIT, fixed("top"), "bar")
  // the height limit is the bar's, not the text's: a short word's bar is as tall as a plain line may be
  expect(lines[0]!.bar!.height * PORTRAIT.width).toBeCloseTo(0.13 * PORTRAIT.height, 3)
  const [first, second] = lines
  expect(first!.bar!.width).toBeCloseTo(textUnits("ถ้าคุณ", "kanit") * LINE_WIDTH_RATIO * first!.scale + 0.04, 9)
  expect(first!.bar!.height).toBeCloseTo(LINE_WIDTH_RATIO * first!.scale * 1.25, 9)
  // a bar line is kept narrow enough for its bar to stay inside the frame
  const [long] = layoutGroup(["ร้านทำเล็บจตุจักร"], "kanit", PORTRAIT, fixed("top"), "bar").lines
  expect(long!.bar!.width).toBeCloseTo(0.84, 9)

  // in y units, the gap between the two centres is more than the two half-bars
  const inY = (share: number) => (2 * share * PORTRAIT.width) / PORTRAIT.height
  expect(first!.y - second!.y).toBeGreaterThan(inY(first!.bar!.height / 2 + second!.bar!.height / 2))
  // the other patterns draw no bar
  expect(layoutGroup(["ถ้าคุณ"], "kanit", PORTRAIT, fixed("top")).lines[0]!.bar).toBeNull()
})

test("a group with bars still dodges what the picture must keep clear", () => {
  expect(layoutGroup(ONE, "kanit", PORTRAIT, auto([0.45, 0.8]), "bar").dodge).toBe("above")
  const { lines } = layoutGroup(ONE, "kanit", PORTRAIT, auto([0, 0.5]), "bar")
  expect(lines[0]!.y).toBeLessThan(0)
  expect(lines[0]!.bar).not.toBeNull()

  // text that had to shrink to clear the picture takes its bar down with it
  const shrunk = layoutGroup(THREE, "kanit", PORTRAIT, auto([0.4, 0.7], true), "bar")
  expect(shrunk.dodge).toBe("above")
  shrunk.lines.forEach((line, i) => expect(line.bar!.width).toBeCloseTo(textUnits(THREE[i]!, "kanit") * LINE_WIDTH_RATIO * line.scale + 0.04, 9))
  expect(shrunk.lines[0]!.scale).toBeLessThan(layoutGroup(THREE, "kanit", PORTRAIT, fixed("top"), "bar").lines[0]!.scale)
})

test("a pattern the app no longer knows is laid out as a plain stack", () => {
  const unknown = layoutGroup(HOOK, "kanit", PORTRAIT, fixed("top"), "nope" as never)
  expect(unknown).toEqual(layoutGroup(HOOK, "kanit", PORTRAIT, fixed("top")))
})

test("wide output gets no bars: CapCut draws its shapes to a scale this app has not measured there", () => {
  const wide = layoutGroup(["ถ้าคุณ", "ร้านทำเล็บ"], "kanit", LANDSCAPE, fixed("top"), "bar")
  expect(wide).toEqual(layoutGroup(["ถ้าคุณ", "ร้านทำเล็บ"], "kanit", LANDSCAPE, fixed("top")))
  expect(wide.lines.every((line) => line.bar === null)).toBe(true)
  // a square frame still gets them
  expect(layoutGroup(["ถ้าคุณ"], "kanit", { width: 1080, height: 1080 }, fixed("top"), "bar").lines[0]!.bar).not.toBeNull()
})

test("the room kept for subtitles starts where text pinned above them ends, as a share of the frame from the top", () => {
  // the bottom position's last line ends at -0.52 in CapCut's units, which is 0.76 of the way down
  expect(SUBTITLE_ROOM_FROM_Y).toBeCloseTo(0.76, 9)
})
