/** Anything with a start and an end in the source: a word, a kept piece. */
interface Span {
  startUs: number
  endUs: number
}

const holds = (piece: Span, atUs: number) => atUs >= piece.startUs && atUs < piece.endUs

/**
 * Whether a word plays in a kept piece: its middle falls inside it. A word timed with no length
 * right at the piece's end — whisper times words in 20 ms steps, so the last word kept can sit on
 * the edge — plays there too, unless a piece starting at that moment holds it. (A word with length
 * whose middle is the end has half of it cut off, and does not.) `pieces` are the kept pieces of
 * the same video.
 */
export function playsIn(word: Span, piece: Span, pieces: Span[]): boolean {
  const middle = (word.startUs + word.endUs) / 2
  if (holds(piece, middle)) return true
  return word.endUs === word.startUs && middle === piece.endUs && !pieces.some((other) => holds(other, middle))
}
