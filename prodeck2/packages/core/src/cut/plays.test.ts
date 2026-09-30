import { expect, test } from "vitest"
import { playsIn } from "./plays.ts"

const piece = (startUs: number, endUs: number) => ({ startUs, endUs })
const word = (startUs: number, endUs: number) => ({ startUs, endUs })

test("a word plays in the piece its middle falls in", () => {
  const pieces = [piece(0, 1_000), piece(2_000, 3_000)]
  expect(playsIn(word(100, 300), pieces[0]!, pieces)).toBe(true)
  expect(playsIn(word(100, 300), pieces[1]!, pieces)).toBe(false)
  expect(playsIn(word(1_200, 1_400), pieces[0]!, pieces)).toBe(false)
})

test("a word timed with no length at the very end of a piece plays there, unless a piece starting then holds it", () => {
  const apart = [piece(0, 1_000), piece(2_000, 3_000)]
  expect(playsIn(word(1_000, 1_000), apart[0]!, apart)).toBe(true)
  // two pieces back to back: it plays once, in the one that starts there
  const touching = [piece(0, 1_000), piece(1_000, 2_000)]
  expect(playsIn(word(1_000, 1_000), touching[0]!, touching)).toBe(false)
  expect(playsIn(word(1_000, 1_000), touching[1]!, touching)).toBe(true)
  // a word with length whose middle is the end has half of it cut off
  expect(playsIn(word(900, 1_100), apart[0]!, apart)).toBe(false)
})
