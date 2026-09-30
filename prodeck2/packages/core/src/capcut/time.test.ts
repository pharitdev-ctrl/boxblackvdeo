import { test } from "vitest"
import assert from "node:assert/strict"
import { snapToFrame } from "./time.ts"

test("snapToFrame keeps a value already on a frame boundary", () => {
  assert.equal(snapToFrame(1_000_000, 30), 1_000_000)
})

test("snapToFrame rounds to the nearest frame", () => {
  assert.equal(snapToFrame(1_010_000, 30), 1_000_000)
  assert.equal(snapToFrame(1_020_000, 30), 1_033_333)
})

test("snapToFrame floors the microsecond value the way CapCut stores it", () => {
  // 23 frames @30fps = 766,666.67 µs — CapCut writes 766666 (seen in a real 9.2 draft)
  assert.equal(snapToFrame(766_700, 30), 766_666)
  assert.equal(snapToFrame(1_833_300, 30), 1_833_333)
})
