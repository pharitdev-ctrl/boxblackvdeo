import type { GraphicSentence } from "./points.ts"
import type { MotionWord } from "../plan.ts"

/*
 * The words a motion graphic is written for, which planning it and placing it both read from here. The planning call
 * of before 0.7.0, which put graphics on points only, was replaced by the free plan (free.ts).
 */

/**
 * The most words a graphic is written for, the first of those said while it plays. A graphic lasts at most 6 s,
 * and inside a phrase speech runs at 4 to 5 words a second (a clip's average, with its pauses, is nearer 2.5), so
 * forty takes in every word of the longest one, with room: the last word its idea lands on is among them.
 */
const WORDS_MAX = 40
/** Seconds to the millisecond, so that a time that has not really moved gives the same number, and the same render, every time. */
const toMillisecond = (seconds: number) => Math.round(seconds * 1000) / 1000

/** When a word is said, in seconds from the word a graphic starts at, on the rough cut. */
const secondsFrom = (start: { timelineUs: number }, word: { timelineUs: number }) => toMillisecond((word.timelineUs - start.timelineUs) / 1_000_000)

/**
 * Which word of a sentence a graphic anchored at `fromSourceUs` starts at: the one that starts there (the first, of
 * two that do), or, when none starts exactly there, the last one that starts before it, or the sentence's first
 * word when none does.
 */
function startIndex(sentence: GraphicSentence, fromSourceUs: number): number {
  const exact = sentence.words.findIndex((word) => word.startUs === fromSourceUs)
  return exact >= 0 ? exact : Math.max(0, sentence.words.findLastIndex((word) => word.startUs <= fromSourceUs))
}

/**
 * The words a motion graphic is written for: those of the sentence said from the word that starts at `fromSourceUs`
 * on, within `seconds` of it on the rough cut, the first forty, each with its seconds from that start.
 *
 * The start is the word `startIndex` finds. A word's seconds are counted on the rough cut and rounded to the
 * millisecond. A word said as the graphic ends is out, as is one the cut plays before the start. Planning a
 * graphic and placing it later both come here, so the two cannot disagree about which words a graphic has.
 */
export function motionWords(sentence: GraphicSentence, fromSourceUs: number, seconds: number): MotionWord[] {
  const from = startIndex(sentence, fromSourceUs)
  const start = sentence.words[from]
  if (start === undefined) return []
  return sentence.words
    .slice(from)
    .map((word) => ({ text: word.text, atS: secondsFrom(start, word) }))
    .filter((word) => word.atS >= 0 && word.atS < seconds)
    .slice(0, WORDS_MAX)
}
