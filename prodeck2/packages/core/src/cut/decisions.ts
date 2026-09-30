import type { CutDecisionChange, SourceRange, VideoCutDecisions } from "./rules.ts"

export function emptyCutDecisions(transcript: string): VideoCutDecisions {
  return { transcript, keepWords: [], cutWords: [], keepPauses: [], keepProblems: [], cutPieces: [] }
}

const sorted = (values: Iterable<number>) => [...new Set(values)].sort((a, b) => a - b)
const without = (values: number[], gone: number[]) => values.filter((value) => !gone.includes(value))
const sameRange = (a: SourceRange, b: SourceRange) => a.startUs === b.startUs && a.endUs === b.endUs
const withoutRanges = (ranges: SourceRange[], gone: SourceRange[]) => ranges.filter((range) => !gone.some((g) => sameRange(g, range)))
const withRanges = (ranges: SourceRange[], added: SourceRange[]) => [...ranges, ...withoutRanges(added, ranges)].sort((a, b) => a.startUs - b.startUs)

/** Stores one decision. Pure. */
export function applyCutDecision(current: VideoCutDecisions, change: CutDecisionChange): VideoCutDecisions {
  const next = structuredClone(current)
  switch (change.type) {
    case "words": {
      next.keepWords = without(next.keepWords, change.indexes)
      next.cutWords = without(next.cutWords, change.indexes)
      if (change.keep === true) next.keepWords = sorted([...next.keepWords, ...change.indexes])
      if (change.keep === false) next.cutWords = sorted([...next.cutWords, ...change.indexes])
      return next
    }
    case "pause":
      next.keepPauses = change.keep === true ? sorted([...next.keepPauses, change.after]) : without(next.keepPauses, [change.after])
      return next
    case "problems":
      next.keepProblems = change.keep === true ? withRanges(next.keepProblems, change.ranges) : withoutRanges(next.keepProblems, change.ranges)
      return next
    case "pieces":
      next.cutPieces = change.keep === false ? withRanges(next.cutPieces, change.ranges) : withoutRanges(next.cutPieces, change.ranges)
      return next
  }
}
