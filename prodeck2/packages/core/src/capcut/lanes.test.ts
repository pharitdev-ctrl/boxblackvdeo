import { expect, test } from "vitest"
import { laneOf } from "./lanes.ts"

const span = (startFrame: number, endFrame: number) => ({ startFrame, endFrame })

test("nothing to place, no lanes", () => {
  expect(laneOf([])).toEqual([])
})

test("items that follow one another, or only touch, share the first lane", () => {
  expect(laneOf([span(0, 30), span(30, 60), span(75, 90)])).toEqual([0, 0, 0])
})

test("an item that starts while another plays goes on the lane above it", () => {
  expect(laneOf([span(0, 60), span(30, 90)])).toEqual([0, 1])
  // one frame of overlap is still an overlap
  expect(laneOf([span(0, 60), span(59, 90)])).toEqual([0, 1])
})

test("newest on top: a later item goes above every lane still playing, even with a free lane below", () => {
  // when D starts at 35, B (lane 1) has ended but A (lane 0) and C (lane 2) still play: D goes on lane 3
  const [a, b, c, d] = [span(0, 100), span(10, 30), span(20, 40), span(35, 50)]
  expect(laneOf([a, b, c, d])).toEqual([0, 1, 2, 3])
  // once every one has ended, the next starts again on the first lane; while only A plays, one goes just above it
  expect(laneOf([a, b, c, d, span(60, 70), span(100, 120)])).toEqual([0, 1, 2, 3, 1, 0])
})

test("the lanes follow the longest chain of items that each start while the one before still plays, not the most that play at once", () => {
  // no more than two ever play together, yet each starts while the one before it still plays
  expect(laneOf([span(0, 20), span(15, 35), span(30, 50), span(45, 65)])).toEqual([0, 1, 2, 3])
})

test("items given out of order are placed in start order and answered in the order given", () => {
  expect(laneOf([span(30, 90), span(0, 60)])).toEqual([1, 0])
})

test("items that start on the same frame keep the order they were given in", () => {
  expect(laneOf([span(0, 30), span(0, 60)])).toEqual([0, 1])
  expect(laneOf([span(0, 60), span(0, 30)])).toEqual([0, 1])
})
