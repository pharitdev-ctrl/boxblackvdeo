import { expect, test } from "vitest"
import { formatBytes, formatDate, formatDay, formatDuration, formatResolution, formatTimestamp, lastLines, playedSeconds } from "./format.ts"

test("formatDuration shows minutes and seconds for clips under an hour", () => {
  expect(formatDuration(0)).toBe("0:00")
  expect(formatDuration(14_000_000)).toBe("0:14")
  expect(formatDuration(65_900_000)).toBe("1:05")
})

test("formatDuration adds hours once a clip passes an hour", () => {
  expect(formatDuration(3_723_000_000)).toBe("1:02:03")
})

test("formatResolution shows width by height", () => {
  expect(formatResolution(1080, 1920)).toBe("1080×1920")
})

test("formatDate shows a CapCut microsecond timestamp as a Thai date and time", () => {
  expect(formatDate(1_789_623_936_439_997, "Asia/Bangkok")).toBe("17 ก.ย. 2569 12:45")
})

test("formatDay leaves the time off, for a badge with no room for it", () => {
  expect(formatDay(1_789_623_936_439_997, "Asia/Bangkok")).toBe("17 ก.ย. 2569")
})

test("formatBytes shows downloads in decimal megabytes and gigabytes", () => {
  expect(formatBytes(432_000_000)).toBe("432 MB")
  expect(formatBytes(540_570_101)).toBe("541 MB")
  expect(formatBytes(1_081_140_203)).toBe("1.08 GB")
})

test("formatTimestamp shows a position in a clip to a tenth of a second", () => {
  expect(formatTimestamp(1_900_000)).toBe("0:01.9")
  expect(formatTimestamp(75_460_000)).toBe("1:15.4")
})

test("playedSeconds shows how long a graphic plays to the tenth of a second below, never rounded up to a length it does not reach", () => {
  expect(playedSeconds(3_000_000)).toBe("3.0")
  expect(playedSeconds(2_160_000)).toBe("2.1")
  expect(playedSeconds(2_199_999)).toBe("2.1")
  expect(playedSeconds(1_500_000)).toBe("1.5")
})

test("lastLines keeps the last three lines that say something, on one line, where a tool says what went wrong", () => {
  expect(lastLines("Error: exited with code 1\nat render (render.js:10)\n\nChrome crashed\nframe 12 of 90\nout of memory\n")).toBe("Chrome crashed frame 12 of 90 out of memory")
  expect(lastLines("Claude is busy")).toBe("Claude is busy")
})
