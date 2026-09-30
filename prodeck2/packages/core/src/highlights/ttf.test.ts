import { readFile } from "node:fs/promises"
import { expect, test } from "vitest"
import { readFontMetrics } from "./ttf.ts"

const font = (file: string) => readFile(new URL(`../../../../apps/desktop/resources/fonts/${file}`, import.meta.url))

// reference values read with fontTools 4.60
test("reads the typo line height and advance widths in em", async () => {
  const kanit = readFontMetrics(await font("Kanit-ExtraBold.ttf"), ["ก", "A", " ", "ำ", "่", "ญ"])
  expect(kanit.lineHeight).toBe(1.495)
  expect(kanit.advances).toEqual({ ก: 0.642, A: 0.76, " ": 0.205, ำ: 0.457, "่": 0, ญ: 0.97 })

  const mali = readFontMetrics(await font("Mali-Bold.ttf"), ["ก", "A", " "])
  expect(mali.lineHeight).toBe(1.3)
  expect(mali.advances).toEqual({ ก: 0.686, A: 0.697, " ": 0.36 })

  const chonburi = readFontMetrics(await font("Chonburi-Regular.ttf"), ["ก", "ญ"])
  expect(chonburi.lineHeight).toBe(1)
  expect(chonburi.advances).toEqual({ ก: 0.762, ญ: 1.119 })
})

test("characters the font does not have are left out", async () => {
  // U+0E3B is unassigned in Thai; the fonts have no glyph for it
  expect(readFontMetrics(await font("Kanit-ExtraBold.ttf"), ["\u0E3B", "ก"]).advances).toEqual({ ก: 0.642 })
})

test("anything but a TrueType font is refused", () => {
  expect(() => readFontMetrics(new TextEncoder().encode("not a font at all, just text"), ["ก"])).toThrow(/font/)
})
