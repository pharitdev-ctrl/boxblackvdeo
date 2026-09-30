import { expect, test } from "vitest"
import { cardFraming, coverFraming, coverScale } from "./framing.ts"

/** The rough cut of the user's own portrait footage, and one of their 3:4 photos. */
const CANVAS = { width: 1080, height: 1920 }
const PHOTO = { width: 3024, height: 4032 }
const WIDE = { width: 1920, height: 1080 }

test("covering the frame needs the ratio between covering and fitting", () => {
  expect(coverScale(PHOTO, CANVAS)).toBeCloseTo(4 / 3, 5)
  expect(coverScale(WIDE, CANVAS)).toBeCloseTo((1920 / 1080) / (1080 / 1920), 5)
  // a picture of the canvas's own shape needs nothing, and a broken one is left alone
  expect(coverScale({ width: 1080, height: 1920 }, CANVAS)).toBe(1)
  expect(coverScale({ width: 0, height: 0 }, CANVAS)).toBe(1)
})

test("with no subject to go by, cover is the plain fill of the frame from the middle", () => {
  const framing = coverFraming(PHOTO, CANVAS, null)
  expect(framing).toMatchObject({ scale: 4 / 3, x: 0, y: 0 })
  expect(framing.drawn.width).toBeCloseTo(1440, 3)
  expect(framing.drawn.height).toBeCloseTo(1920, 3)
})

test("a subject low and left of the picture is blown up until it fills the frame, and moved into the middle", () => {
  // the nails take the lower-left 60 % of the photo
  const framing = coverFraming(PHOTO, CANVAS, { x0: 0.1, y0: 0.4, x1: 0.7, y1: 1 })
  expect(framing.scale).toBeCloseTo(20 / 9, 4)
  expect(framing.drawn.width).toBeCloseTo(2400, 2)
  expect(framing.drawn.height).toBeCloseTo(3200, 2)
  // the picture moves right and up, so what was low and left is now in the middle
  expect(framing.x).toBeCloseTo(0.4444, 4)
  expect(framing.y).toBeCloseTo(0.6667, 4)
})

test("a subject wider than it is tall is blown up by its width, not its height", () => {
  // half the width but nearly the whole height: the width is what still has to be filled
  const framing = coverFraming(PHOTO, CANVAS, { x0: 0.25, y0: 0.05, x1: 0.75, y1: 0.95 })
  expect(framing.scale).toBeCloseTo(2, 4)
  expect(framing.drawn.width).toBeCloseTo(2160, 2)
})

test("the picture is never moved so far that an edge of it shows", () => {
  // a subject in the very corner would need more shift than the picture has to give
  const framing = coverFraming(PHOTO, CANVAS, { x0: 0, y0: 0, x1: 0.9, y1: 0.9 })
  const overflowX = framing.drawn.width / CANVAS.width - 1
  const overflowY = framing.drawn.height / CANVAS.height - 1
  expect(Math.abs(framing.x)).toBeLessThanOrEqual(overflowX + 1e-9)
  expect(Math.abs(framing.y)).toBeLessThanOrEqual(overflowY + 1e-9)
})

test("a tiny subject is only blown up so far, so the picture does not fall apart", () => {
  const framing = coverFraming(PHOTO, CANVAS, { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 })
  expect(framing.scale).toBeCloseTo((4 / 3) * 2.5, 5)
})

test("a subject that already fills the picture asks for no more than the plain cover", () => {
  expect(coverFraming(PHOTO, CANVAS, { x0: 0, y0: 0, x1: 1, y1: 1 }).scale).toBeCloseTo(4 / 3, 5)
})

test("a card is 62 % of the frame wide and sits low, where nothing has to stay clear", () => {
  const framing = cardFraming(PHOTO, CANVAS, null)
  expect(framing.drawn.width).toBeCloseTo(0.62 * 1080, 3)
  expect(framing.drawn.height).toBeCloseTo(0.62 * 1440, 3)
  expect(framing.x).toBe(0)
  expect(framing.y).toBeCloseTo(-0.35, 5)
})

test("a card goes in the taller of the bands the picture leaves free", () => {
  // a face across the top half leaves the bottom free
  const low = cardFraming(PHOTO, CANVAS, { fromY: 0.12, toY: 0.48 })
  expect(low.y).toBeCloseTo(-0.48, 5)
  // a face low in the frame sends the card up
  const high = cardFraming(PHOTO, CANVAS, { fromY: 0.55, toY: 0.95 })
  expect(high.y).toBeCloseTo(1 - 2 * 0.275, 5)
})

test("a card stays inside the frame even when its band is too small for it", () => {
  const framing = cardFraming(PHOTO, CANVAS, { fromY: 0.05, toY: 0.95 })
  const half = framing.drawn.height / CANVAS.height / 2
  const centre = (1 - framing.y) / 2
  expect(centre).toBeGreaterThanOrEqual(half - 1e-9)
  expect(centre).toBeLessThanOrEqual(1 - half + 1e-9)
})

test("a wide picture makes a shorter card of the same width", () => {
  const framing = cardFraming(WIDE, CANVAS, null)
  expect(framing.drawn.width).toBeCloseTo(0.62 * 1080, 3)
  expect(framing.drawn.height).toBeCloseTo(0.62 * 607.5, 3)
})
