import type { GraphicBox } from "./plan.ts"

export interface PixelBox {
  x: number
  y: number
  width: number
  height: number
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
const floorEven = (n: number) => Math.floor(n / 2) * 2
const ceilEven = (n: number) => Math.ceil(n / 2) * 2

/**
 * Whole-pixel products of a share and a canvas side can come out a hair off (0.35 * 720 is 251.99999999999997):
 * an edge that close to a pixel is that pixel, and does not step out to the next even one.
 */
const PIXEL_NOISE = 1e-6

/**
 * The two edges of a stage along one side of the canvas, from the two edges of the box in pixels in either order:
 * the lower rounded down to an even pixel and the higher up, both inside the canvas, and at least 2 apart. A box
 * with no size, or one the canvas cuts to nothing, is widened to 2 from where it is, back from the far edge when it
 * is there.
 */
function stageSpan(a: number, b: number, max: number): [number, number] {
  const low = clamp(floorEven(Math.min(a, b) + PIXEL_NOISE), 0, max)
  const high = clamp(ceilEven(Math.max(a, b) - PIXEL_NOISE), 0, max)
  if (high - low >= 2) return [low, high]
  const end = Math.min(low + 2, max)
  return [end - 2, end]
}

/**
 * The stage a motion graphic is written for: the box it was planned in, in pixels, with no margin. Claude
 * draws inside exactly this and is told its width and height. The box's edges may come in either order. Each
 * edge that falls on an odd pixel steps out to the next even one (the left and top down, the right and bottom up)
 * so the width and height are even: the video file is rendered at exactly this size, and an even size keeps the
 * stage's centre on a whole pixel, so `placeOnCanvas` lands it back exactly where it was measured. The whole is
 * clamped inside the canvas: on an odd-sized canvas it reaches only `floorEven(canvas.width/height)`, one pixel
 * short of the far edge, where `placeOnCanvas` still places it exactly. It is never under 2 pixels across or
 * tall. An edge or a canvas side that is not a finite number is a bug in the caller, and so is a canvas under
 * 2 pixels: there is no stage to give, and it throws.
 */
export function stageBox(box: GraphicBox, canvas: { width: number; height: number }): PixelBox {
  for (const [what, value] of [["x0", box.x0], ["y0", box.y0], ["x1", box.x1], ["y1", box.y1], ["the canvas width", canvas.width], ["the canvas height", canvas.height]] as const) {
    if (!Number.isFinite(value)) throw new Error(`stageBox: ${what} must be a finite number, not ${value}`)
  }
  const maxX = floorEven(canvas.width)
  const maxY = floorEven(canvas.height)
  if (maxX < 2 || maxY < 2) throw new Error(`stageBox: a canvas ${canvas.width} by ${canvas.height} is too small to hold a stage of 2 pixels`)
  const [x0, x1] = stageSpan(box.x0 * canvas.width, box.x1 * canvas.width, maxX)
  const [y0, y1] = stageSpan(box.y0 * canvas.height, box.y1 * canvas.height, maxY)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * How CapCut must draw a rendered file so it lands on its own pixels: CapCut draws a picture "fit"
 * at scale 1 (one side spans the canvas), so the scale undoes that, and the transform moves its
 * centre in half-canvases (+1 = right / top).
 */
export function placeOnCanvas(box: PixelBox, canvas: { width: number; height: number }): { scale: number; x: number; y: number } {
  const fit = Math.min(canvas.width / box.width, canvas.height / box.height)
  const scale = 1 / fit
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return { scale, x: (cx / canvas.width - 0.5) * 2, y: (0.5 - cy / canvas.height) * 2 }
}

/** The one band that covers every band given, gaps between them included, so several can be dodged at once; null when there are none. */
export function mergeBands(bands: { fromY: number; toY: number }[]): { fromY: number; toY: number } | null {
  if (bands.length === 0) return null
  return { fromY: Math.min(...bands.map((band) => band.fromY)), toY: Math.max(...bands.map((band) => band.toY)) }
}

/** The gap `dodgeKeepClear` leaves between the box and the band's edge, so the two don't visibly touch. */
const KEEP_CLEAR_GAP = 0.02

/**
 * A box that overlaps the band the picture must keep clear (a face, the product) moves whole into
 * the taller free band above or below it — the same choice a cutaway card makes, a tie going below
 * — but unlike the card it doesn't centre in that band: it hugs the band's edge with a small gap, so
 * it sits as close to its original spot as it can. It only moves when the box actually overlaps the
 * band; touching the band's edge exactly is left alone. It stays inside the frame even when the
 * free band is too short for it.
 */
export function dodgeKeepClear(box: GraphicBox, keepClear: { fromY: number; toY: number } | null): GraphicBox {
  if (!keepClear || box.y1 <= keepClear.fromY || box.y0 >= keepClear.toY) return box
  const h = box.y1 - box.y0
  const above = keepClear.fromY
  const below = 1 - keepClear.toY
  const y0 = above > below ? clamp(above - h - KEEP_CLEAR_GAP, 0, 1 - h) : clamp(keepClear.toY + KEEP_CLEAR_GAP, 0, 1 - h)
  return { ...box, y0, y1: y0 + h }
}
