import { expect, test } from "vitest"
import { dodgeKeepClear, mergeBands, placeOnCanvas, stageBox } from "./framing.ts"

const canvas = { width: 1080, height: 1920 }
const landscapeCanvas = { width: 1920, height: 1080 }
const box = { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.7 }

test("placing a pixel box on the canvas: scale undoes CapCut's fit, transform moves the centre", () => {
  // a 1080-wide box already spans the canvas: scale 1, centred horizontally
  expect(placeOnCanvas({ x: 0, y: 960, width: 1080, height: 480 }, canvas)).toEqual({ scale: 1, x: 0, y: -0.25 })
  // a 540×480 box is fitted by its width at scale 1 (540 × 480 → 1080 × 960), so half that to draw it 540 wide
  const small = placeOnCanvas({ x: 0, y: 0, width: 540, height: 480 }, canvas)
  expect(small.scale).toBeCloseTo(0.5)
  expect(small.x).toBeCloseTo(-0.5)
  expect(small.y).toBeCloseTo(0.75)
})

test("placing a pixel box whose fit is limited by height, not width", () => {
  // fit = min(1080/400, 1920/1600) = min(2.7, 1.2) = 1.2 — the height ratio is the smaller one, so
  // a fit that used width alone (2.7) would give a very different, wrong scale
  const box = placeOnCanvas({ x: 100, y: 200, width: 400, height: 1600 }, canvas)
  expect(box.scale).toBeCloseTo(1 / 1.2)
  // centre is (300, 1000): x = (300/1080 - 0.5) * 2 = -0.4444; y = (0.5 - 1000/1920) * 2 = -0.0417
  expect(box.x).toBeCloseTo(-0.4444, 4)
  expect(box.y).toBeCloseTo(-0.0417, 4)
})

test("placing a pixel box on a landscape canvas", () => {
  // fit = min(1920/1920, 1080/540) = min(1, 2) = 1 (width limited); centre is (960, 270)
  const box = placeOnCanvas({ x: 0, y: 0, width: 1920, height: 540 }, landscapeCanvas)
  expect(box.scale).toBeCloseTo(1)
  expect(box.x).toBeCloseTo(0)
  expect(box.y).toBeCloseTo(0.5)
})

test("a box that only touches the band, without crossing into it, is left alone", () => {
  // ends exactly at fromY (0.5): box.y1 <= fromY is true on the boundary itself, not just past it
  const touchesFromAbove = { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 }
  expect(dodgeKeepClear(touchesFromAbove, { fromY: 0.5, toY: 0.8 })).toEqual(touchesFromAbove)
  // starts exactly at toY (0.8): box.y0 >= toY is true on the boundary itself, not just past it
  const touchesFromBelow = { x0: 0.1, y0: 0.8, x1: 0.9, y1: 1.0 }
  expect(dodgeKeepClear(touchesFromBelow, { fromY: 0.5, toY: 0.8 })).toEqual(touchesFromBelow)
  // no band, or a band nowhere near the box: unchanged either way
  expect(dodgeKeepClear(box, null)).toEqual(box)
  expect(dodgeKeepClear(box, { fromY: 0.1, toY: 0.3 })).toEqual(box)
})

test("a box over the band moves below it, past the band's edge by the 0.02 gap, when below is freer", () => {
  // h = 0.2; above = fromY = 0.2, below = 1 - toY = 0.45, so below wins: y0 = toY + 0.02 = 0.57
  const moved = dodgeKeepClear({ x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 }, { fromY: 0.2, toY: 0.55 })
  expect(moved.y0).toBeCloseTo(0.57)
  expect(moved.y1).toBeCloseTo(0.77)
})

test("a box over the band moves above it, short of the band's edge by the 0.02 gap, when above is freer", () => {
  // h = 0.2; above = fromY = 0.6, below = 1 - toY = 0.05, so above wins: y0 = fromY - h - 0.02 = 0.38
  const moved = dodgeKeepClear({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.7 }, { fromY: 0.6, toY: 0.95 })
  expect(moved.y0).toBeCloseTo(0.38)
  expect(moved.y1).toBeCloseTo(0.58)
})

test("moving below clamps to stay inside the frame when the free band below, though still the larger side, is smaller than the box", () => {
  // h = 0.3; above = fromY = 0.02, below = 1 - toY = 0.1, so below still wins the comparison, but
  // the box doesn't fit in a 0.1-tall band: unclamped y0 would be toY + 0.02 = 0.92, which would
  // push y1 to 1.22, past the frame — clamped, y0 lands at 1 - h = 0.7 instead
  const moved = dodgeKeepClear({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.8 }, { fromY: 0.02, toY: 0.9 })
  expect(moved.y0).toBeCloseTo(0.7)
  expect(moved.y1).toBeCloseTo(1)
})

test("a band that leaves no room on either side keeps the box inside the frame, overlapping", () => {
  // h = 0.2; above = fromY = 0.05, below = 1 - toY = 0.05 — a tie, so the "below" branch runs:
  // unclamped y0 would be toY + 0.02 = 0.97, past 1 - h = 0.8, so it clamps there instead
  const moved = dodgeKeepClear({ x0: 0, y0: 0.4, x1: 1, y1: 0.6 }, { fromY: 0.05, toY: 0.95 })
  expect(moved.y0).toBeCloseTo(0.8)
  expect(moved.y1).toBeCloseTo(1)
})

test("several bands merge into the one band that covers them all, gaps included; none is no band", () => {
  expect(mergeBands([{ fromY: 0.5, toY: 0.62 }, { fromY: 0.1, toY: 0.45 }])).toEqual({ fromY: 0.1, toY: 0.62 })
  expect(mergeBands([{ fromY: 0.3, toY: 0.4 }])).toEqual({ fromY: 0.3, toY: 0.4 })
  // one inside another leaves the outer one
  expect(mergeBands([{ fromY: 0.2, toY: 0.9 }, { fromY: 0.4, toY: 0.5 }])).toEqual({ fromY: 0.2, toY: 0.9 })
  expect(mergeBands([])).toBeNull()
})

test("a motion graphic's stage is its box in pixels, with no margin: the box the planner chose", () => {
  // 0.1..0.9 of 1080 is 108..972, 0.5..0.9 of 1920 is 960..1728: all even already, so nothing moves
  expect(stageBox({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 }, canvas)).toEqual({ x: 108, y: 960, width: 864, height: 768 })
  // no margin is added for an animation: the stage is written for its own box
  expect(stageBox(box, canvas)).toEqual({ x: 108, y: 960, width: 864, height: 384 })
  // a box in the middle of the frame does not grow by a pixel; one that fills the frame is the frame
  expect(stageBox({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }, canvas)).toEqual({ x: 270, y: 480, width: 540, height: 960 })
  expect(stageBox({ x0: 0, y0: 0, x1: 1, y1: 1 }, canvas)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
})

test("a stage edge that falls on an odd pixel grows outward to the next even one, so the stage has an even width and height", () => {
  const square = { width: 1000, height: 1000 }
  // 0.101 is pixel 101 and 0.601 is pixel 601: the left edge steps out to 100 and the right to 602
  expect(stageBox({ x0: 0.101, y0: 0.2, x1: 0.601, y1: 0.8 }, square)).toEqual({ x: 100, y: 200, width: 502, height: 600 })
  // an odd width or height on its own (100..601 is 501 wide, 200..701 is 501 tall) is made even the same way
  expect(stageBox({ x0: 0.1, y0: 0.2, x1: 0.601, y1: 0.701 }, square)).toEqual({ x: 100, y: 200, width: 502, height: 502 })
  // the top and bottom edges do the same: 203 steps up to 202, 807 down to 808
  expect(stageBox({ x0: 0.1, y0: 0.203, x1: 0.5, y1: 0.807 }, square)).toEqual({ x: 100, y: 202, width: 400, height: 606 })
})

test("a product that only differs from a whole pixel by floating-point noise is that pixel: the stage does not grow two pixels for it", () => {
  // on a 720 px canvas 0.35 * 720 is 251.99999999999997, 0.55 * 720 is 396.00000000000006 and 0.7 * 720 is 503.99999999999994
  expect(0.35 * 720).not.toBe(252)
  expect(0.55 * 720).not.toBe(396)
  expect(stageBox({ x0: 0.35, y0: 0.35, x1: 0.55, y1: 0.7 }, { width: 720, height: 720 })).toEqual({ x: 252, y: 252, width: 144, height: 252 })
})

test("a box past the canvas is cut to the canvas, and an odd canvas reaches only its last even pixel", () => {
  expect(stageBox({ x0: -0.1, y0: -0.2, x1: 1.3, y1: 1.5 }, canvas)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
  // over one edge only: the far side stays where the box put it
  expect(stageBox({ x0: 0.5, y0: 0.5, x1: 1.4, y1: 0.9 }, canvas)).toEqual({ x: 540, y: 960, width: 540, height: 768 })
  expect(stageBox({ x0: -0.5, y0: 0.5, x1: 0.5, y1: 0.9 }, canvas)).toEqual({ x: 0, y: 960, width: 540, height: 768 })
  // 1081 x 1921 has no even pixel past 1080 x 1920, as with the render box
  expect(stageBox({ x0: 0, y0: 0, x1: 1, y1: 1 }, { width: 1081, height: 1921 })).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
})

test("a stage's edges may come in either order: a box given the other way round is the same stage", () => {
  const box = { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 }
  expect(stageBox({ x0: box.x1, y0: box.y0, x1: box.x0, y1: box.y1 }, canvas)).toEqual(stageBox(box, canvas))
  expect(stageBox({ x0: box.x0, y0: box.y1, x1: box.x1, y1: box.y0 }, canvas)).toEqual({ x: 108, y: 960, width: 864, height: 768 })
  expect(stageBox({ x0: box.x1, y0: box.y1, x1: box.x0, y1: box.y0 }, canvas)).toEqual({ x: 108, y: 960, width: 864, height: 768 })
})

test("a stage is never under 2 pixels across or tall: a box with no size, or one cut down by the canvas, is widened inside it", () => {
  // no size, in the middle, at the origin and at the far edges
  expect(stageBox({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, canvas)).toEqual({ x: 540, y: 960, width: 2, height: 2 })
  expect(stageBox({ x0: 0, y0: 0, x1: 0, y1: 0 }, canvas)).toEqual({ x: 0, y: 0, width: 2, height: 2 })
  expect(stageBox({ x0: 1, y0: 1, x1: 1, y1: 1 }, canvas)).toEqual({ x: 1078, y: 1918, width: 2, height: 2 })
  // a box wholly past the canvas is cut to its edge and widened from there
  expect(stageBox({ x0: 2, y0: -3, x1: 3, y1: -2 }, canvas)).toEqual({ x: 1078, y: 0, width: 2, height: 2 })
  // on an odd canvas the far edge is the last even pixel
  expect(stageBox({ x0: 1, y0: 1, x1: 1, y1: 1 }, { width: 1081, height: 1921 })).toEqual({ x: 1078, y: 1918, width: 2, height: 2 })
  // one 2 pixels wide already is left as it is
  expect(stageBox({ x0: 0.5, y0: 0.5, x1: 0.5 + 2 / 1080, y1: 0.5 + 2 / 1920 }, canvas)).toEqual({ x: 540, y: 960, width: 2, height: 2 })
  // the smallest canvas that can hold one
  expect(stageBox({ x0: 0.2, y0: 0.2, x1: 0.3, y1: 0.3 }, { width: 2, height: 2 })).toEqual({ x: 0, y: 0, width: 2, height: 2 })
})

test("a box or a canvas that is not made of finite numbers is a bug in the caller, and there is no stage for it", () => {
  const box = { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 }
  for (const edge of ["x0", "y0", "x1", "y1"] as const) {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => stageBox({ ...box, [edge]: bad }, canvas), `${edge} ${bad}`).toThrow(/finite/)
    }
  }
  expect(() => stageBox(box, { width: Number.NaN, height: 1920 })).toThrow(/finite/)
  expect(() => stageBox(box, { width: 1080, height: Number.POSITIVE_INFINITY })).toThrow(/finite/)
  // and a canvas too small to hold two pixels has no stage to give
  expect(() => stageBox(box, { width: 1, height: 1920 })).toThrow(/canvas/)
  expect(() => stageBox(box, { width: 1080, height: 0 })).toThrow(/canvas/)
})

test("the stage lands on the canvas where the planner measured it", () => {
  const stage = stageBox({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 }, canvas)
  // centre (540, 1344) on a 1080 x 1920 canvas; 864 x 768 fits at 1.25, so CapCut needs 0.8
  const place = placeOnCanvas(stage, canvas)
  expect(place.scale).toBeCloseTo(0.8)
  expect(place.x).toBeCloseTo(0)
  expect(place.y).toBeCloseTo(-0.4)
})
