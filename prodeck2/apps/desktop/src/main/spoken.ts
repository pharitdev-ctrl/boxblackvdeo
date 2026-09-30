import { playsIn, type CutClip, type CutPlan } from "@boxblack/core/cut"
import type { HighlightSentence } from "@boxblack/core/highlights"

/** A sentence the rough cut plays, with the words it is made of and where each starts in the source. */
export interface SpokenSentence extends HighlightSentence {
  /** where the sentence ends in the source */
  endUs: number
  /** where it stops playing on the rough cut: the end of its last word still played, inside that word's piece */
  timelineEndUs: number
  /**
   * where the piece that plays its last word ends on the rough cut: past it the picture may be another
   * take, scene or video. Set by `spokenSentences`; absent on a sentence made by hand
   */
  pieceEndUs?: number
  /**
   * the row's words with their source times, and where each plays on the rough cut (set by
   * `spokenSentences`; absent on a sentence made by hand, which plays as it was said)
   */
  words: { text: string; startUs: number; timelineUs?: number }[]
}

/** A clip's timed words, by clip id; a clip with no transcript has none. */
export const wordsIn =
  (clips: CutClip[]) =>
  (videoId: string): { text: string; startUs: number; endUs: number }[] =>
    clips.find((clip) => clip.id === videoId)?.transcript?.words ?? []

/**
 * Every sentence the rough cut plays — used, or kept by the user — in playing order, with where
 * it starts on the timeline. This is what Claude quotes for highlight text and what a cutaway can
 * land on; a row the rules or the user cut is not on the cut, so it is not here.
 */
export function spokenSentences(input: {
  plan: CutPlan
  wordsOf: (videoId: string) => { text: string; startUs: number; endUs: number }[]
  beatNames: Map<string, string>
  /** where a source time of a kept piece plays on the rough cut */
  at: (cut: number, sourceUs: number) => number
}): SpokenSentence[] {
  let cutIndex = 0
  const sentences: SpokenSentence[] = []
  for (const beat of input.plan.beats) {
    const first = cutIndex
    cutIndex += beat.pieces.length
    const words = input.wordsOf(beat.videoId)
    const sameVideo = input.plan.cuts.filter((cut) => cut.binId === beat.videoId).map((cut) => ({ startUs: cut.sourceStartUs, endUs: cut.sourceStartUs + cut.sourceDurationUs }))
    for (const row of beat.rows) {
      if (row.state === "cut" || row.toggle?.type !== "words") continue
      const indexes = row.toggle.indexes
      const start = words[indexes[0]!]
      const last = words[indexes.at(-1)!]
      if (!start || !last) continue
      // the piece that plays this row: the one its first word falls inside, among every piece of that video
      const piece = beat.pieces.findIndex((p) => playsIn(start, p, sameVideo))
      if (piece < 0) continue
      // the cut may take words out of its middle or its end: it stops with the last word still played,
      // cut off where that word's piece ends — the first word plays, so one is always found
      let endPiece = -1
      let endWord = start
      for (let k = indexes.length - 1; endPiece < 0; k--) {
        const word = words[indexes[k]!]
        if (!word) continue
        endPiece = beat.pieces.findIndex((p) => playsIn(word, p, sameVideo))
        endWord = word
      }
      const timelineEndUs = input.at(first + endPiece, Math.min(endWord.endUs, beat.pieces[endPiece]!.endUs))
      // each word plays in the piece that holds it — from that piece's start when the cut's edge snapped
      // past the word's own — so a pause the cut took out of the sentence brings every later word sooner.
      // A word the cut took out is where the cut goes on: where the next word still played starts
      const timesUs: number[] = []
      let nextUs = timelineEndUs
      for (let k = indexes.length - 1; k >= 0; k--) {
        const word = words[indexes[k]!]!
        const p = beat.pieces.findIndex((candidate) => playsIn(word, candidate, sameVideo))
        if (p >= 0) nextUs = input.at(first + p, Math.min(Math.max(word.startUs, beat.pieces[p]!.startUs), beat.pieces[p]!.endUs))
        timesUs[k] = nextUs
      }
      sentences.push({
        videoId: beat.videoId,
        beatId: beat.beatId,
        beatName: input.beatNames.get(beat.beatId) ?? beat.beatId,
        from: indexes[0]!,
        to: indexes.at(-1)! + 1,
        text: row.text,
        timelineUs: input.at(first + piece, start.startUs),
        timelineEndUs,
        pieceEndUs: input.at(first + endPiece, beat.pieces[endPiece]!.endUs),
        endUs: last.endUs,
        words: indexes.map((index, k) => ({ text: words[index]!.text, startUs: words[index]!.startUs, timelineUs: timesUs[k]! })),
      })
    }
  }
  // beats come in playing order and a beat's rows in source order, which on one clip is playing order too
  return sentences
}
