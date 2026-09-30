import { expect, test } from "vitest"
import { applyCutDecision, emptyCutDecisions } from "./decisions.ts"

const range = (startUs: number, endUs: number) => ({ startUs, endUs })

test("keeping words forces them in, cutting forces them out, and clearing leaves them to the rules", () => {
  let d = emptyCutDecisions("t1")
  expect(d).toEqual({ transcript: "t1", keepWords: [], cutWords: [], keepPauses: [], keepProblems: [], cutPieces: [] })
  d = applyCutDecision(d, { type: "words", indexes: [5, 3], keep: false })
  expect(d.cutWords).toEqual([3, 5])
  d = applyCutDecision(d, { type: "words", indexes: [5, 7], keep: true })
  expect([d.keepWords, d.cutWords]).toEqual([[5, 7], [3]])
  d = applyCutDecision(d, { type: "words", indexes: [3, 7], keep: null })
  expect([d.keepWords, d.cutWords]).toEqual([[5], []])
})

test("pauses are kept or left to the rules", () => {
  let d = applyCutDecision(emptyCutDecisions("t"), { type: "pause", after: 4, keep: true })
  d = applyCutDecision(d, { type: "pause", after: 4, keep: true })
  expect(d.keepPauses).toEqual([4])
  expect(applyCutDecision(d, { type: "pause", after: 4, keep: null }).keepPauses).toEqual([])
  expect(applyCutDecision(d, { type: "pause", after: 4, keep: false }).keepPauses).toEqual([])
})

test("picture problems are kept by their measured range, and pieces cut by theirs", () => {
  let d = applyCutDecision(emptyCutDecisions("t"), { type: "problems", ranges: [range(1, 2), range(5, 6)], keep: true })
  d = applyCutDecision(d, { type: "problems", ranges: [range(1, 2)], keep: true })
  expect(d.keepProblems).toEqual([range(1, 2), range(5, 6)])
  d = applyCutDecision(d, { type: "problems", ranges: [range(1, 2)], keep: null })
  expect(d.keepProblems).toEqual([range(5, 6)])

  d = applyCutDecision(d, { type: "pieces", ranges: [range(8, 9)], keep: false })
  expect(d.cutPieces).toEqual([range(8, 9)])
  expect(applyCutDecision(d, { type: "pieces", ranges: [range(8, 9)], keep: null }).cutPieces).toEqual([])
  expect(applyCutDecision(d, { type: "pieces", ranges: [range(8, 9)], keep: true }).cutPieces).toEqual([])
})

test("the decisions it was given are not changed", () => {
  const d = emptyCutDecisions("t")
  applyCutDecision(d, { type: "words", indexes: [1], keep: true })
  expect(d.keepWords).toEqual([])
})
