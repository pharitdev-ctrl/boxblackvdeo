import type { TimedText } from "../asr/types.ts"
import type { Cut } from "../capcut/types.ts"
import type { Loudness } from "../media/loudness.ts"
import type { FootageClip } from "../planner/footage.ts"
import type { Beat } from "../planner/outline.ts"
import { joinWords } from "../subtitles/captions.ts"
import {
  CUT_PRESETS,
  type BeatCut,
  type CutDecisions,
  type CutPreset,
  type CutPresetId,
  type CutRow,
  type CutRules,
  type Removal,
  type RemovalReason,
  type SourceRange,
  type VideoCutDecisions,
} from "./rules.ts"
import { changesMeaning, falseStarts, isFiller, MAX_EXTRA_WORDS, repeatedUtterancePairs } from "./words.ts"

/** An analysed video, plus how loud its audio is over time when that has been measured. */
export type CutClip = FootageClip & { loudness?: Loudness | null }

export interface CutPlan {
  beats: BeatCut[]
  /** every kept piece in playing order, ready for the draft writer */
  cuts: Cut[]
  durationUs: number
}

/** A scene beat's edges are sample-frame times; a real shot edge this close is where the shot actually starts or ends. */
const SHOT_SNAP_US = 1_500_000
/** Picture left between two problems that is shorter than this would only flash on screen. */
const MIN_SCENE_PIECE_US = 500_000
/** A piece of speech shorter than this is a sliver no one hears, and under a frame the writer cannot place it (1.2 frames at 24 fps). */
const MIN_SPEECH_PIECE_US = 50_000

/** How far a cut edge may move from where the word times put it to find a quieter spot. whisper word starts are off by up to ~80 ms (p90). */
const SNAP_US = 120_000
/** A spot this much further away must be this many dB quieter to win, so flat audio leaves edges where the words put them. */
const DISTANCE_DB = 6

const midpoint = (item: SourceRange) => (item.startUs + item.endUs) / 2

/** The quietest moment near `targetUs`, within [minUs, maxUs]. Without loudness, the target itself. */
export function quietestNear(loudness: Loudness | null | undefined, targetUs: number, minUs: number, maxUs: number): number {
  const clamped = Math.min(Math.max(targetUs, minUs), maxUs)
  if (!loudness || loudness.db.length === 0) return clamped
  const { stepUs, db } = loudness
  const lo = Math.max(minUs, targetUs - SNAP_US)
  const hi = Math.min(maxUs, targetUs + SNAP_US)

  let best = clamped
  let bestScore = Infinity
  for (let i = Math.max(0, Math.floor(lo / stepUs)); i < db.length && i * stepUs <= hi; i++) {
    const at = i * stepUs + stepUs / 2
    if (at < lo || at > hi) continue
    const score = db[i]! + (DISTANCE_DB * Math.abs(at - targetUs)) / SNAP_US
    if (score < bestScore) {
      bestScore = score
      best = at
    }
  }
  return Math.round(best)
}

const length = (pieces: SourceRange[]) => pieces.reduce((sum, piece) => sum + piece.endUs - piece.startUs, 0)

const byStart = <T extends { startUs: number }>(items: T[]) => items.sort((a, b) => a.startUs - b.startUs)

function speechCut(
  beat: Beat,
  clip: CutClip,
  rules: CutRules,
  preset: CutPreset,
  decisions: VideoCutDecisions | undefined,
  endHoldUs?: number,
): Omit<BeatCut, "beatId" | "videoId" | "originalUs" | "keptUs"> {
  const words = clip.transcript?.words ?? []
  const inBeat = words.flatMap((word, index) => {
    const mid = midpoint(word)
    return mid >= beat.startUs && mid <= beat.endUs ? [index] : []
  })
  if (inBeat.length === 0) return { pieces: [{ startUs: beat.startUs, endUs: beat.endUs }], removals: [], notes: ["no-word-timing"], rows: [] }

  const keepWords = new Set(decisions?.keepWords)
  const cutWords = new Set(decisions?.cutWords)
  const keepPauses = new Set(decisions?.keepPauses)

  const dropped = new Map<number, RemovalReason>()
  // takes said again with another number or "ไม่": kept, and offered to the user as a retake to cut
  const maybe = new Set<number>()
  if (rules.cutRetakes) {
    const utterances = (clip.transcript?.utterances ?? []).filter((u) => midpoint(u) >= beat.startUs && midpoint(u) <= beat.endUs)
    for (const [n, later] of repeatedUtterancePairs(utterances)) {
      const line = utterances[n]!
      const unsure = changesMeaning(line.text, utterances[later]!.text)
      for (const index of inBeat) {
        if (midpoint(words[index]!) < line.startUs || midpoint(words[index]!) > line.endUs) continue
        if (unsure) maybe.add(index)
        else dropped.set(index, "retake")
      }
    }
    // only the takes that survived the line-level pass are compared word by word
    const remaining = inBeat.filter((index) => !dropped.has(index) && !maybe.has(index))
    const text = (indexes: number[]) => indexes.map((index) => words[index]!.text).join(" ")
    for (const { from, to } of falseStarts(remaining.map((index) => words[index]!))) {
      const earlier = remaining.slice(from, to)
      // the later take may say a few more words before its number, as a restart allows
      const unsure = changesMeaning(text(earlier), text(remaining.slice(to, to + earlier.length + MAX_EXTRA_WORDS)))
      for (const index of earlier) {
        if (unsure) maybe.add(index)
        else dropped.set(index, "retake")
      }
    }
  }
  if (rules.cutFillers) {
    for (const index of inBeat) if (!dropped.has(index) && isFiller(words[index]!.text)) dropped.set(index, "filler")
  }

  // the user's word decisions go over the rules
  const byRule = new Map(dropped)
  for (const index of inBeat) {
    if (keepWords.has(index)) dropped.delete(index)
    else if (cutWords.has(index) && !dropped.has(index)) dropped.set(index, "user")
  }

  // runs of words with the same fate; used words are grouped per sentence so a sentence can be cut on its own
  const utterances = clip.transcript?.utterances ?? []
  const sentenceOf = (index: number) => utterances.findIndex((u) => midpoint(words[index]!) >= u.startUs && midpoint(words[index]!) <= u.endUs)
  const fate = (index: number): Pick<CutRow, "state" | "reason"> & { keep: boolean | null } => {
    const rule = byRule.get(index)
    if (keepWords.has(index) && rule) return { state: "kept", reason: rule, keep: null }
    if (rule) return { state: "cut", reason: rule, keep: true }
    if (dropped.has(index)) return { state: "cut", reason: "user", keep: null }
    if (maybe.has(index)) return { state: "kept", reason: "maybe-retake", keep: false }
    return { state: "used", reason: null, keep: false }
  }
  const rows: CutRow[] = []
  let run: number[] = []
  const closeRun = () => {
    if (run.length === 0) return
    const { state, reason, keep } = fate(run[0]!)
    rows.push({
      state,
      reason,
      startUs: words[run[0]!]!.startUs,
      endUs: words[run.at(-1)!]!.endUs,
      text: joinWords(run.map((index) => words[index]!.text)),
      toggle: { type: "words", indexes: run, keep },
    })
    run = []
  }
  for (const index of inBeat) {
    const last = run.at(-1)
    const same =
      last !== undefined &&
      index === last + 1 &&
      fate(index).state === fate(last).state &&
      fate(index).reason === fate(last).reason &&
      (fate(index).state !== "used" || sentenceOf(index) === sentenceOf(last))
    if (!same) closeRun()
    run.push(index)
  }
  closeRun()

  const removals: Removal[] = []
  /** a removal covering the dropped words between two indexes (exclusive), or a plain pause */
  const removal = (after: number, before: number, startUs: number, endUs: number): Removal => {
    const gone = inBeat.filter((index) => index > after && index < before && dropped.has(index))
    const reasons = gone.map((index) => dropped.get(index)!)
    const reason: RemovalReason = reasons.includes("retake") ? "retake" : reasons.includes("filler") ? "filler" : reasons.includes("user") ? "user" : "pause"
    return { reason, startUs, endUs, text: gone.map((index) => words[index]!.text).join(" ") }
  }

  const kept = inBeat.filter((index) => !dropped.has(index))
  if (kept.length === 0) {
    const first = words[inBeat[0]!]!
    const last = words[inBeat.at(-1)!]!
    return { pieces: [], removals: [removal(inBeat[0]! - 1, inBeat.at(-1)! + 1, first.startUs, last.endUs)], notes: ["nothing-left"], rows: byStart(rows) }
  }

  const { maxPauseUs, paddingUs } = preset
  const firstIndex = kept[0]!
  const lastIndex = kept.at(-1)!
  const wordMid = (index: number) => midpoint(words[index]!)
  // edges move to the quietest spot nearby, but never past the middle of a kept word
  const snap = (targetUs: number, minUs: number, maxUs: number) => quietestNear(clip.loudness, targetUs, minUs, maxUs)

  // padding stops at the neighbouring word, whether it is cut or sits outside the beat
  const rawStartUs = Math.max(words[firstIndex]!.startUs - paddingUs, words[firstIndex - 1]?.endUs ?? 0, 0)
  let startUs = snap(rawStartUs, firstIndex > 0 ? wordMid(firstIndex - 1) : 0, wordMid(firstIndex))
  if (inBeat[0]! < firstIndex) removals.push(removal(inBeat[0]! - 1, firstIndex, words[inBeat[0]!]!.startUs, startUs))

  const pieces: SourceRange[] = []
  for (let n = 1; n < kept.length; n++) {
    const a = kept[n - 1]!
    const b = kept[n]!
    const gap = words[b]!.startUs - words[a]!.endUs
    const longPause = b === a + 1 && gap > maxPauseUs
    if (longPause && keepPauses.has(a)) {
      rows.push({ state: "kept", reason: "pause", startUs: words[a]!.endUs, endUs: words[b]!.startUs, text: "", toggle: { type: "pause", after: a, keep: null } })
      continue
    }
    if (b === a + 1 && !longPause) continue

    const rawEndUs = Math.min(words[a]!.endUs + paddingUs, words[a + 1]!.startUs)
    const rawNextUs = Math.max(words[b]!.startUs - paddingUs, words[b - 1]!.endUs)
    // word times that overlap leave no room to cut; keep the words rather than guess
    if (rawEndUs >= rawNextUs) continue
    const endMin = Math.max(startUs, wordMid(a))
    let endUs = snap(rawEndUs, endMin, rawNextUs)
    let nextStartUs = snap(rawNextUs, endUs, wordMid(b))
    if (endUs >= nextStartUs) {
      // both edges want the same quiet spot: a pause can stay, but a dropped word still has to go,
      // at the edges its own timing gives, kept inside the same bounds
      if (b === a + 1) continue
      endUs = Math.min(Math.max(rawEndUs, endMin), rawNextUs)
      nextStartUs = Math.min(Math.max(rawNextUs, endUs), wordMid(b))
      if (endUs >= nextStartUs) continue
    }

    // a sliver too short to hear or to place is left out rather than written
    if (endUs - startUs >= MIN_SPEECH_PIECE_US) pieces.push({ startUs, endUs })
    removals.push(removal(a, b, endUs, nextStartUs))
    if (longPause) rows.push({ state: "cut", reason: "pause", startUs: endUs, endUs: nextStartUs, text: "", toggle: { type: "pause", after: a, keep: true } })
    startUs = nextStartUs
  }

  const rawEndUs = Math.min(words[lastIndex]!.endUs + (endHoldUs ?? paddingUs), words[lastIndex + 1]?.startUs ?? Infinity, clip.durationUs)
  // a held end is silence already, and snapping could pull it back toward the word it is there to give room after
  const endUs =
    endHoldUs === undefined
      ? snap(rawEndUs, Math.max(startUs, wordMid(lastIndex)), Math.min(lastIndex + 1 < words.length ? wordMid(lastIndex + 1) : Infinity, clip.durationUs))
      : Math.max(rawEndUs, startUs)
  if (endUs - startUs >= MIN_SPEECH_PIECE_US) pieces.push({ startUs, endUs })
  if (lastIndex < inBeat.at(-1)!) removals.push(removal(lastIndex, inBeat.at(-1)! + 1, endUs, words[inBeat.at(-1)!]!.endUs))

  return { pieces, removals, notes: pieces.length === 0 ? ["nothing-left"] : [], rows: byStart(rows) }
}

/** Moves an edge that falls inside a spoken word out of it, towards the inside of the range. */
function clearOfWords(range: SourceRange, words: TimedText[]): SourceRange {
  let { startUs, endUs } = range
  const inStart = words.find((word) => word.startUs < startUs && word.endUs > startUs)
  if (inStart) startUs = inStart.endUs
  const inEnd = words.find((word) => word.startUs < endUs && word.endUs > endUs)
  if (inEnd) endUs = inEnd.startUs
  return endUs - startUs >= MIN_SCENE_PIECE_US ? { startUs, endUs } : range
}

function sceneCut(beat: Beat, clip: CutClip, rules: CutRules, decisions: VideoCutDecisions | undefined): Omit<BeatCut, "beatId" | "videoId" | "originalUs" | "keptUs"> {
  const signals = clip.insight?.signals
  const bounds = [0, ...(signals?.sceneCutsUs ?? []), clip.durationUs]

  let startUs = beat.startUs
  let endUs = Math.min(beat.endUs, clip.durationUs)
  const before = Math.max(...bounds.filter((bound) => bound <= startUs))
  if (startUs - before <= SHOT_SNAP_US) startUs = before
  const after = Math.min(...bounds.filter((bound) => bound >= endUs))
  if (after - endUs <= SHOT_SNAP_US) endUs = after
  const range = clearOfWords({ startUs, endUs }, clip.transcript?.words ?? [])

  const sameRange = (a: SourceRange, b: SourceRange) => a.startUs === b.startUs && a.endUs === b.endUs
  const overlaps = (a: SourceRange, b: SourceRange) => a.startUs < b.endUs && b.startUs < a.endUs
  const measured = rules.cutBadPicture ? [...(signals?.blurry ?? []), ...(signals?.black ?? [])].sort((a, b) => a.startUs - b.startUs) : []
  const isKept = (problem: SourceRange) => (decisions?.keepProblems ?? []).some((kept) => sameRange(kept, problem))
  const problems = measured.filter((problem) => !isKept(problem))
  let pieces: SourceRange[] = [range]
  for (const problem of problems) {
    pieces = pieces.flatMap((piece) => {
      if (problem.endUs <= piece.startUs || problem.startUs >= piece.endUs) return [piece]
      return [
        { startUs: piece.startUs, endUs: problem.startUs },
        { startUs: problem.endUs, endUs: piece.endUs },
      ].filter((part) => part.endUs > part.startUs)
    })
  }
  pieces = pieces.filter((piece) => piece.endUs - piece.startUs >= MIN_SCENE_PIECE_US)

  // everything between the kept pieces went for its picture
  const edges = [range.startUs, ...pieces.flatMap((piece) => [piece.startUs, piece.endUs]), range.endUs]
  const removals: Removal[] = []
  const rows: CutRow[] = []
  for (let i = 0; i < edges.length; i += 2) {
    if (edges[i + 1]! <= edges[i]!) continue
    const gone = { startUs: edges[i]!, endUs: edges[i + 1]! }
    removals.push({ reason: "bad-picture", ...gone, text: "" })
    const causes = problems.filter((problem) => overlaps(problem, gone))
    rows.push({ state: "cut", reason: "bad-picture", ...gone, text: "", toggle: causes.length ? { type: "problems", ranges: causes, keep: true } : null })
  }
  for (const problem of measured.filter((problem) => isKept(problem) && overlaps(problem, range))) {
    rows.push({ state: "kept", reason: "bad-picture", ...problem, text: "", toggle: { type: "problems", ranges: [problem], keep: null } })
  }

  // pieces the user cut, matched by where their middle falls
  const cutBy = (piece: SourceRange) => (decisions?.cutPieces ?? []).find((cut) => midpoint(piece) >= cut.startUs && midpoint(piece) <= cut.endUs)
  const used: SourceRange[] = []
  for (const piece of pieces) {
    const cut = cutBy(piece)
    if (cut) {
      removals.push({ reason: "user", ...piece, text: "" })
      rows.push({ state: "cut", reason: "user", ...piece, text: "", toggle: { type: "pieces", ranges: [cut], keep: null } })
    } else {
      used.push(piece)
      rows.push({ state: "used", reason: null, ...piece, text: "", toggle: { type: "pieces", ranges: [piece], keep: false } })
    }
  }
  return { pieces: used, removals: byStart(removals), notes: used.length === 0 ? ["nothing-left"] : [], rows: byStart(rows) }
}

/**
 * Turns confirmed beats into the pieces of source footage to lay on the timeline.
 * Pure — no files, no clock — so it can move to the license server later.
 */
export function compileCuts(args: {
  beats: Beat[]
  clips: CutClip[]
  rules: CutRules
  presets?: Record<CutPresetId, CutPreset>
  /** the user's keep and cut decisions, per video */
  decisions?: CutDecisions
  /**
   * footage kept after the last word of the clip, in place of the preset's padding, when the outline ends on a speech
   * beat: room for what sits on the last words to show. It never reaches the next spoken word or past the video's end
   */
  endHoldUs?: number
}): CutPlan {
  const preset = (args.presets ?? CUT_PRESETS)[args.rules.preset]
  const clips = new Map(args.clips.map((clip) => [clip.id, clip]))

  const beats = args.beats.map((beat, index): BeatCut => {
    const clip = clips.get(beat.videoId)
    if (!clip) throw new Error(`beat "${beat.name}" uses video ${beat.videoId}, which has not been analysed`)
    const decisions = args.decisions?.[beat.videoId]
    const hold = index === args.beats.length - 1 ? args.endHoldUs : undefined
    const result = beat.kind === "speech" ? speechCut(beat, clip, args.rules, preset, decisions, hold) : sceneCut(beat, clip, args.rules, decisions)
    return { beatId: beat.id, videoId: beat.videoId, ...result, originalUs: beat.endUs - beat.startUs, keptUs: length(result.pieces) }
  })

  const cuts = beats.flatMap((beat) =>
    beat.pieces.map((piece) => ({ binId: beat.videoId, sourceStartUs: piece.startUs, sourceDurationUs: piece.endUs - piece.startUs })),
  )
  return { beats, cuts, durationUs: beats.reduce((sum, beat) => sum + beat.keptUs, 0) }
}
