import { expect, test } from "vitest"
import { BLACK, contrast, hexOf, luminance, onSurface, readableAccent, rgbOf, strokeFor, WHITE, type Rgb } from "./colour.ts"

const YELLOW: Rgb = [1, 0.878, 0]
const PINK: Rgb = [1, 0.56, 0.69]
const RED: Rgb = [0.9, 0.22, 0.27]
const NAVY: Rgb = [0.1, 0.2, 0.5]
const NEAR_BLACK: Rgb = [0.07, 0.07, 0.07]

test("luminance and contrast follow WCAG 2.1", () => {
  expect(luminance(WHITE)).toBeCloseTo(1, 5)
  expect(luminance(BLACK)).toBe(0)
  expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 3)
  expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 3)
  // yellow on white barely differs; yellow on black stands out
  expect(contrast(WHITE, YELLOW)).toBeLessThan(1.4)
  expect(contrast(YELLOW, BLACK)).toBeGreaterThan(15)
})

test("a stroke is black or white, whichever the fill stands out from more", () => {
  expect(strokeFor(WHITE)).toEqual(BLACK)
  expect(strokeFor(YELLOW)).toEqual(BLACK)
  expect(strokeFor(PINK)).toEqual(BLACK)
  expect(strokeFor(NEAR_BLACK)).toEqual(WHITE)
  expect(strokeFor(NAVY)).toEqual(WHITE)
  // text on a surface is the same question
  expect(onSurface(YELLOW)).toEqual(BLACK)
  expect(onSurface(NEAR_BLACK)).toEqual(WHITE)
})

test("the accent is the first colour that reads on its surface and is not the text's own", () => {
  // pink on a pink bar is invisible, so the text colour is used instead
  expect(readableAccent([PINK], PINK, BLACK)).toEqual(BLACK)
  // red on yellow reads (about 3.4:1)
  expect(readableAccent([RED], YELLOW, BLACK)).toEqual(RED)
  // yellow on white does not, so the next candidate is tried
  expect(readableAccent([YELLOW, RED], WHITE, BLACK)).toEqual(RED)
  // a candidate that is the text colour itself is no accent
  expect(readableAccent([BLACK, RED], YELLOW, BLACK)).toEqual(RED)
  expect(readableAccent([], YELLOW, BLACK)).toEqual(BLACK)
})

test("colours go to and from CapCut's hex", () => {
  expect(hexOf(WHITE)).toBe("#ffffff")
  expect(hexOf(YELLOW)).toBe("#ffe000")
  expect(rgbOf("#ffe000")).toEqual([1, 0.8784313725490196, 0])
  expect(rgbOf("#FFE000")).toEqual([1, 0.8784313725490196, 0])
  expect(rgbOf("ffe000")).toBeNull()
  expect(rgbOf("#ffe")).toBeNull()
  expect(rgbOf("#gggggg")).toBeNull()
})
