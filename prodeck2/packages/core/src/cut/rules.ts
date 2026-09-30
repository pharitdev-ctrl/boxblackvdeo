/** Cut rules the user picks on the post-production page. Node-free so the renderer can import it. */

export const CUT_PRESET_IDS = ["tight", "normal", "loose"] as const
export type CutPresetId = (typeof CUT_PRESET_IDS)[number]

export interface CutPreset {
  /** the longest silence left between words; longer ones are cut */
  maxPauseUs: number
  /** silence kept before and after speech wherever a cut is made */
  paddingUs: number
}

/** Defaults until the license server hands out tuned values (M6). */
export const CUT_PRESETS: Record<CutPresetId, CutPreset> = {
  tight: { maxPauseUs: 300_000, paddingUs: 80_000 },
  normal: { maxPauseUs: 600_000, paddingUs: 150_000 },
  loose: { maxPauseUs: 1_000_000, paddingUs: 250_000 },
}

export interface CutRules {
  preset: CutPresetId
  cutFillers: boolean
  cutRetakes: boolean
  /** blurry and black stretches, measured with ffmpeg; applies to picture-led beats only */
  cutBadPicture: boolean
}

export const DEFAULT_CUT_RULES: CutRules = { preset: "normal", cutFillers: true, cutRetakes: true, cutBadPicture: true }

export type RemovalReason = "filler" | "retake" | "pause" | "bad-picture" | "user"

/** A stretch of the source taken out of a beat, for showing the user what was cut. */
export interface Removal {
  reason: RemovalReason
  startUs: number
  endUs: number
  /** the words removed, when there were any */
  text: string
}

export interface SourceRange {
  startUs: number
  endUs: number
}

export type BeatCutNote = "no-word-timing" | "nothing-left"

/**
 * What the user decided against or on top of the rules, for one video. Words and pauses are
 * named by their place in the transcript and picture by measured ranges, so the decisions
 * hold when the rules or preset change.
 */
export interface VideoCutDecisions {
  /** the transcript the word indexes belong to; decisions made on another transcript are ignored */
  transcript: string
  /** words kept even when a rule would cut them */
  keepWords: number[]
  /** words cut although the rules keep them */
  cutWords: number[]
  /** long pauses kept, named by the index of the word before them */
  keepPauses: number[]
  /** blurry or black stretches kept, by their measured range */
  keepProblems: SourceRange[]
  /** pieces of picture cut from scene beats, by the range they had */
  cutPieces: SourceRange[]
}

/** Decisions per video id. */
export type CutDecisions = Record<string, VideoCutDecisions>

/** A decision to store: `keep` true forces in, false forces out, null leaves it to the rules. */
export type CutDecisionChange =
  | { type: "words"; indexes: number[]; keep: boolean | null }
  | { type: "pause"; after: number; keep: boolean | null }
  | { type: "problems"; ranges: SourceRange[]; keep: boolean | null }
  | { type: "pieces"; ranges: SourceRange[]; keep: boolean | null }

/** One line of a beat's review: a used sentence or piece, or a cut and its reason, and what flipping it stores. */
export interface CutRow {
  /** "kept": the rules would cut it, the user kept it — or it may be a retake, which is the user's to cut */
  state: "used" | "cut" | "kept"
  /** "maybe-retake": said again with another number or "ไม่", so it is kept unless the user cuts it */
  reason: RemovalReason | "maybe-retake" | null
  startUs: number
  endUs: number
  text: string
  toggle: CutDecisionChange | null
}

export interface BeatCut {
  beatId: string
  videoId: string
  /** the parts of the source that stay, in playing order */
  pieces: SourceRange[]
  removals: Removal[]
  /** length of the beat as the planner chose it */
  originalUs: number
  keptUs: number
  notes: BeatCutNote[]
  /** what is used and what is cut, in source order */
  rows: CutRow[]
}
