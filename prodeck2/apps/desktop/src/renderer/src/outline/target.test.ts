import { expect, test } from "vitest"
import { formatTarget, parseTarget, TARGET_MAX_S, TARGET_MIN_S, TARGET_PRESETS } from "./target.ts"

test("a length typed as minutes:seconds or as plain seconds is read in seconds, spaces around it ignored", () => {
  expect(parseTarget("2:30")).toBe(150)
  expect(parseTarget("150")).toBe(150)
  expect(parseTarget(" 4:00 ")).toBe(240)
  // a single digit of seconds is that many seconds, not tens
  expect(parseTarget("2:5")).toBe(125)
  expect(parseTarget("0:05")).toBe(TARGET_MIN_S)
  expect(parseTarget("30:00")).toBe(TARGET_MAX_S)
})

test("anything else is no length: too short, too long, sixty seconds, decimals, words, nothing", () => {
  for (const text of ["0:04", "4", "30:01", "1801", "2:60", "2.5", "1:2:3", "-5", "abc", "", "   ", "2:30 นาที"]) {
    expect(parseTarget(text), text).toBeNull()
  }
})

test("a length is shown as m:ss with the seconds padded", () => {
  expect(formatTarget(150)).toBe("2:30")
  expect(formatTarget(5)).toBe("0:05")
  expect(formatTarget(1800)).toBe("30:00")
  // the buttons' own lengths round-trip through the field
  for (const seconds of TARGET_PRESETS) expect(parseTarget(formatTarget(seconds))).toBe(seconds)
})

test("the buttons are half a minute, a minute and a minute and a half — three minutes is typed instead", () => {
  expect(TARGET_PRESETS).toEqual([30, 60, 90])
})
