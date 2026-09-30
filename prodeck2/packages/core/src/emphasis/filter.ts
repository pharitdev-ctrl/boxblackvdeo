import type { TimedText } from "../asr/types.ts"
import type { CutPlan } from "../cut/compile.ts"
import { playsIn } from "../cut/plays.ts"
import type { FlairLevel } from "../flair/catalogue.ts"
import { passesLevel, type EmphasisAnchor, type EmphasisPoint } from "./types.ts"

/** A stored point where it plays on this rough cut. */
export interface PlacedPoint {
  point: EmphasisPoint
  videoId: string
  /** the beat it plays in */
  beatId: string
  /** index into plan.cuts of the piece its first kept moment plays in */
  cut: number
  /** its first kept moment in the source: a speech point's first kept word start (never before its piece's start), a scene point's first moment inside a kept piece */
  sourceUs: number
  /** where it starts and ends on the rough cut, before rounding to frames */
  atUs: number
  endUs: number
}

/** The rough cut's pieces as the placing needs them: which beat plays each, and where a source moment of one plays. */
interface Pieces {
  plan: CutPlan
  beatOf: string[]
  at: (cut: number, sourceUs: number) => number
}

function piecesOf(plan: CutPlan): Pieces {
  // the pieces play back to back, so each starts where the ones before it add up to
  const offsets: number[] = []
  plan.cuts.reduce((start, cut) => (offsets.push(start), start + cut.sourceDurationUs), 0)
  return {
    plan,
    beatOf: plan.beats.flatMap((beat) => beat.pieces.map(() => beat.beatId)),
    at: (cut, sourceUs) => offsets[cut]! + sourceUs - plan.cuts[cut]!.sourceStartUs,
  }
}

const endOf = (cut: { sourceStartUs: number; sourceDurationUs: number }) => cut.sourceStartUs + cut.sourceDurationUs

/**
 * A speech point in one beat. Each word finds its piece by placeHighlights' rule (its own beat's piece
 * when that beat plays it, else the first piece that does); the point then plays in its own beat when
 * that beat plays any of its words, else in the beat its first kept word plays in, and spans only the
 * words that beat plays, so it never starts in one play of the footage and ends in another.
 */
function placeSpeech(point: EmphasisPoint, anchor: Extract<EmphasisAnchor, { kind: "speech" }>, words: TimedText[], pieces: Pieces): PlacedPoint | null {
  const { cuts } = pieces.plan
  const span = (cut: (typeof cuts)[number]) => ({ startUs: cut.sourceStartUs, endUs: endOf(cut) })
  const sameVideo = cuts.filter((cut) => cut.binId === anchor.videoId).map(span)
  const plays = (cut: (typeof cuts)[number], word: TimedText) => cut.binId === anchor.videoId && playsIn(word, span(cut), sameVideo)
  // the first piece of a beat that plays a word, or -1 when that beat does not play it
  const pieceIn = (beatId: string, word: TimedText) => cuts.findIndex((cut, i) => pieces.beatOf[i] === beatId && plays(cut, word))

  const kept: { index: number; cut: number }[] = []
  for (let index = anchor.from; index < anchor.to && index < words.length; index++) {
    const word = words[index]!
    // the same words can play in two beats: the point's own, else the first
    const inBeat = pieceIn(anchor.beatId, word)
    const cut = inBeat >= 0 ? inBeat : cuts.findIndex((candidate) => plays(candidate, word))
    if (cut >= 0) kept.push({ index, cut })
  }
  if (kept.length === 0) return null
  const beatId = kept.some(({ cut }) => pieces.beatOf[cut] === anchor.beatId) ? anchor.beatId : pieces.beatOf[kept[0]!.cut]!
  const inIt = kept.flatMap(({ index }) => {
    const cut = pieceIn(beatId, words[index]!)
    return cut >= 0 ? [{ index, cut }] : []
  })
  // never empty: the own beat is chosen only when it plays a kept word, any other beat because it plays the first one
  const first = inIt[0]!
  const last = inIt.at(-1)!

  const sourceUs = Math.max(words[first.index]!.startUs, cuts[first.cut]!.sourceStartUs)
  const atUs = pieces.at(first.cut, sourceUs)
  const endUs = pieces.at(last.cut, Math.min(words[last.index]!.endUs, endOf(cuts[last.cut]!)))
  // a guard: a beat that plays its footage out of order can play a later word first; the point never ends before it starts
  return { point, videoId: anchor.videoId, beatId, cut: first.cut, sourceUs, atUs, endUs: Math.max(atUs, endUs) }
}

/** A scene point where its stretch overlaps kept pieces of its video: its own beat's, else those of the first beat that plays it, never a mix. */
function placeScene(point: EmphasisPoint, anchor: Extract<EmphasisAnchor, { kind: "scene" }>, pieces: Pieces): PlacedPoint | null {
  const { cuts } = pieces.plan
  const overlapping = cuts.flatMap((cut, index) => (cut.binId === anchor.videoId && cut.sourceStartUs < anchor.endUs && anchor.startUs < endOf(cut) ? [index] : []))
  const own = overlapping.filter((index) => pieces.beatOf[index] === anchor.beatId)
  const chosen = own.length > 0 ? own : overlapping.filter((index) => pieces.beatOf[index] === pieces.beatOf[overlapping[0]!])
  const first = chosen[0]
  const last = chosen.at(-1)
  if (first === undefined || last === undefined) return null

  const sourceUs = Math.max(anchor.startUs, cuts[first]!.sourceStartUs)
  const endUs = pieces.at(last, Math.min(anchor.endUs, endOf(cuts[last]!)))
  return { point, videoId: anchor.videoId, beatId: pieces.beatOf[first]!, cut: first, sourceUs, atUs: pieces.at(first, sourceUs), endUs }
}

/**
 * Where stored points play on a rough cut, in playing order. Pure. A speech point is placed by the
 * rule placeHighlights uses: a word is kept when its middle falls in a kept piece of its video,
 * preferring the pieces of the point's own beat; unlike a highlight line, the point then keeps only
 * the words of one beat. A point with no kept word is left out. A scene point is placed where its
 * stretch overlaps kept pieces of its video, its own beat's first; it is left out when no piece
 * overlaps.
 */
export function placePoints(args: { points: EmphasisPoint[]; plan: CutPlan; wordsOf: (videoId: string) => TimedText[] }): PlacedPoint[] {
  const pieces = piecesOf(args.plan)
  const placed = args.points.flatMap((point) => {
    const anchor = point.anchor
    const one = anchor.kind === "speech" ? placeSpeech(point, anchor, args.wordsOf(anchor.videoId), pieces) : placeScene(point, anchor, pieces)
    return one ? [one] : []
  })
  return placed.sort((a, b) => a.atUs - b.atUs)
}

/** Whether an item bound to a point shows: an item with no point always does; one on a point shows only when that point is placed and passes the level. */
export type PointFilter = (pointId: string | undefined) => boolean

/** The filter for a level: unbound items pass, items on a placed point of an importance the level lets through pass, all others (a point cut away, hidden, or gone) do not. */
export function pointFilter(placed: PlacedPoint[], level: FlairLevel): PointFilter {
  const passing = new Set(placed.filter((one) => passesLevel(one.point.importance, level)).map((one) => one.point.id))
  return (pointId) => pointId === undefined || passing.has(pointId)
}

/** Whether two points claim the same thing: speech on the same video, beat and overlapping words; scene on the same video, beat and overlapping time. Speech never overlaps scene. */
export function pointsOverlap(a: EmphasisAnchor, b: EmphasisAnchor): boolean {
  if (a.videoId !== b.videoId || a.beatId !== b.beatId) return false
  if (a.kind === "speech" && b.kind === "speech") return a.from < b.to && b.from < a.to
  if (a.kind === "scene" && b.kind === "scene") return a.startUs < b.endUs && b.startUs < a.endUs
  return false
}
