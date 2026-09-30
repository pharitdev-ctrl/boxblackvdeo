import type { TextPattern } from "../flair/catalogue.ts"
import { FONT_METRICS } from "./font-metrics.ts"
import type { FixedPosition, HighlightFontId } from "./styles.ts"

/**
 * CapCut 9.4 draws text of size 15 at scale 1 so that one line — the font's OS/2 typo ascender to
 * descender — is this share of the canvas width. Measured on portrait and landscape canvases with
 * six fonts; text is never wrapped.
 */
export const LINE_WIDTH_RATIO = 0.087

/** How much of the frame width a line may take. */
const MAX_WIDTH = 0.84
/** How much of the frame height one line may take, so short words do not fill the screen. */
const MAX_LINE_HEIGHT = 0.13
/** Room between stacked lines, as a share of a line's height. */
const LINE_SPACING = 1.05
/** CapCut's y runs from +1 at the top of the frame to −1 at the bottom; text stays this far inside. */
const EDGE = 0.92
const TOP = 0.72
const MIDDLE = 0.1
/** Clear of subtitles, which sit at −0.8. */
const BOTTOM = -0.52
/** Where the room kept for subtitles starts, as a share of the frame height from the top: highlight text stays above it when subtitles are on. */
export const SUBTITLE_ROOM_FROM_Y = (1 - BOTTOM) / 2
/** Room left above and below what must stay clear: 5 % of the frame height, about how far the estimate can be out. */
const MARGIN = 0.1
/** How small the text may be made to fit beside the picture before covering it is the better answer. */
const MIN_SHRINK = 0.6
/** One word on its own may be this tall — the "punch" pattern trades the height limit for impact. */
const PUNCH_LINE_HEIGHT = 0.2
/** Staggered lines are narrower, so the two sides do not meet in the middle. */
const STAIR_WIDTH = 0.6
/** How far a staggered line sits from the centre, in CapCut's x units. */
const STAIR_X = 0.2
/** Room left each side of a line inside its bar, as a share of the canvas width. */
const BAR_PAD = 0.02
/** A bar is this many line heights tall. */
const BAR_TALL = 1.25
/** Room between stacked bars, as a share of a bar's height, so two bars do not read as one slab. */
const BAR_APART = 1.2

/** What a pattern does to the size of the lines. */
interface PatternShape {
  /** how much of the frame width a line may take */
  width: number
  /** how much of the frame height one line may take */
  height: number
  /** the height of a line's box, in line heights */
  spacing: number
  /** draw a bar behind each line */
  bar: boolean
  /** how far lines alternate from the centre */
  stagger: number
}

const SHAPES: Record<TextPattern, PatternShape> = {
  stack: { width: MAX_WIDTH, height: MAX_LINE_HEIGHT, spacing: LINE_SPACING, bar: false, stagger: 0 },
  punch: { width: MAX_WIDTH, height: PUNCH_LINE_HEIGHT, spacing: LINE_SPACING, bar: false, stagger: 0 },
  // the bar, not the text inside it, is what the height limit is about
  bar: { width: MAX_WIDTH - 2 * BAR_PAD, height: MAX_LINE_HEIGHT / BAR_TALL, spacing: BAR_TALL * BAR_APART, bar: true, stagger: 0 },
  stair: { width: STAIR_WIDTH, height: MAX_LINE_HEIGHT, spacing: LINE_SPACING, bar: false, stagger: STAIR_X },
}

/**
 * A pattern that is not in the catalogue — an older stored plan — is drawn as the plain stack, and
 * so is a bar on wide output, where CapCut's shapes are drawn to a scale this app has not measured.
 */
const shapeOf = (pattern: TextPattern, canvas: { width: number; height: number }): PatternShape =>
  (canvas.width > canvas.height && pattern === "bar" ? SHAPES.stack : SHAPES[pattern]) ?? SHAPES.stack

/** Where a group goes: pinned by the user, or worked out from the band of the picture that must stay clear. */
export type HighlightPlacement =
  | { kind: "fixed"; position: FixedPosition }
  | { kind: "auto"; keepClear: { fromY: number; toY: number } | null; keepSubtitleRoom: boolean }

/** What the placement did, so the screen can say it. */
export type Dodge = "fixed" | "above" | "below" | "over" | "no-picture"

/** Top edge of the block, how much it had to shrink to get there, and what it did. */
function anchorFor(placement: HighlightPlacement, height: number): { top: number; shrink: number; dodge: Dodge } {
  const pinned = (position: FixedPosition, dodge: Dodge) => ({
    top: position === "top" ? TOP : position === "middle" ? MIDDLE + height / 2 : BOTTOM + height,
    shrink: 1,
    dodge,
  })
  if (placement.kind === "fixed") return pinned(placement.position, "fixed")
  if (!placement.keepClear) return pinned("top", "no-picture")

  const bandTop = 1 - 2 * placement.keepClear.fromY
  const bandBottom = 1 - 2 * placement.keepClear.toY
  const floor = placement.keepSubtitleRoom ? BOTTOM : -EDGE

  // with room to spare first, then right up against the picture rather than over it. A block that
  // fits its gap stays inside the frame either way, so sliding needs no clamp of its own.
  const gaps = (margin: number) => ({
    above: { from: bandTop + margin, room: EDGE - (bandTop + margin) },
    below: { to: bandBottom - margin, room: bandBottom - margin - floor },
  })
  for (const margin of [MARGIN, 0]) {
    const { above, below } = gaps(margin)
    if (height <= above.room) return { top: Math.max(TOP, above.from + height), shrink: 1, dodge: "above" }
    if (height <= below.room) return { top: Math.min(BOTTOM + height, below.to), shrink: 1, dodge: "below" }
  }

  // smaller text that clears the picture beats big text across someone's face, down to a point.
  // Shrunk text fills its gap exactly, so it sits at the frame's edge or right against the picture.
  const { above, below } = gaps(0)
  const fit = Math.max(above.room, below.room) / height
  if (fit >= MIN_SHRINK) {
    // a hair's difference is a tie, and a tie goes above: text over someone's chest reads worse
    return above.room + 1e-9 >= below.room ? { top: EDGE, shrink: fit, dodge: "above" } : { top: below.to, shrink: fit, dodge: "below" }
  }

  // nowhere clear even then: cover as little of it as possible, the top for a tie
  const covered = (top: number) => Math.max(0, Math.min(top, bandTop) - Math.max(top - height, bandBottom))
  const lowest = floor + height
  return { top: covered(EDGE) <= covered(lowest) ? EDGE : lowest, shrink: 1, dodge: "over" }
}

const averageConsonant = new Map<HighlightFontId, number>()

function consonantAverage(font: HighlightFontId): number {
  let average = averageConsonant.get(font)
  if (average === undefined) {
    const { advances } = FONT_METRICS[font]
    const widths = Object.entries(advances).flatMap(([char, width]) => (char >= "ก" && char <= "ฮ" ? [width] : []))
    average = widths.reduce((sum, width) => sum + width, 0) / widths.length
    averageConsonant.set(font, average)
  }
  return average
}

/** Width of a line in lines of the font's own height; a character the font lacks counts as an average Thai consonant. */
export function textUnits(text: string, font: HighlightFontId): number {
  const { advances, lineHeight } = FONT_METRICS[font]
  let width = 0
  for (const char of text) width += advances[char] ?? consonantAverage(font)
  return width / lineHeight
}

/** Where one line goes: its centre, its size, and the bar behind it as shares of the canvas width. */
export interface LaidLine {
  y: number
  scale: number
  x: number
  bar: { width: number; height: number } | null
}

/**
 * Size and height of each line of a group, stacked in order: each line fills the usable width
 * up to a height limit, and the block sits at the chosen place inside the frame. The pattern
 * decides how big the lines may be, whether they alternate sides, and whether each gets a bar.
 */
export function layoutGroup(
  texts: string[],
  font: HighlightFontId,
  canvas: { width: number; height: number },
  placement: HighlightPlacement,
  pattern: TextPattern = "stack",
): { lines: LaidLine[]; dodge: Dodge } {
  if (texts.length === 0) return { lines: [], dodge: placement.kind === "fixed" ? "fixed" : "no-picture" }
  const shape = shapeOf(pattern, canvas)
  const heightCap = (shape.height * canvas.height) / (LINE_WIDTH_RATIO * canvas.width)
  let scales = texts.map((text) => Math.min(shape.width / (Math.max(textUnits(text, font), 1e-6) * LINE_WIDTH_RATIO), heightCap))
  const boxHeight = (scale: number) => ((2 * LINE_WIDTH_RATIO * scale * canvas.width) / canvas.height) * shape.spacing

  // a block taller than the frame shrinks to fit
  const room = 2 * EDGE
  const total = scales.reduce((sum, scale) => sum + boxHeight(scale), 0)
  if (total > room) scales = scales.map((scale) => (scale * room) / total)
  const heights = scales.map(boxHeight)
  const block = heights.reduce((sum, height) => sum + height, 0)

  const { top: wanted, shrink, dodge } = anchorFor(placement, block)
  // the block keeps inside the frame at the height it is drawn: shrunk text below a face would
  // otherwise be pushed back up into it by the room its unshrunk size would need
  let top = Math.min(Math.max(wanted, -EDGE + block * shrink), EDGE)
  const lines = scales.map((scale, i) => {
    const height = heights[i]! * shrink
    const y = top - height / 2
    top -= height
    const size = scale * shrink
    const bar = shape.bar ? { width: textUnits(texts[i]!, font) * LINE_WIDTH_RATIO * size + 2 * BAR_PAD, height: LINE_WIDTH_RATIO * size * BAR_TALL } : null
    const x = shape.stagger === 0 ? 0 : i % 2 === 0 ? -shape.stagger : shape.stagger
    return { y, scale: size, x, bar }
  })
  return { lines, dodge }
}
