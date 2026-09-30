import type { CueAnchor } from "../flair/plan.ts"

/** A box on the frame, as shares of its width and height from the top left. */
export interface GraphicBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Stamped on every motion graphic and part of its render hash: bumped whenever the contract Claude writes by,
 * the page around the fragment or the host script that seeks it changes what a fragment draws.
 */
export const MOTION_VERSION = "motion-2026-09-30"
/** The most characters a fragment may have: five times the longest of the five Claude wrote in the design's trial (8 KB). */
export const MOTION_HTML_MAX = 40_000

/** A word said while the graphic plays: its text, and seconds from the graphic's start when it was written. */
export interface MotionWord {
  text: string
  atS: number
}

/** The most graphemes the change a user asks of a written graphic may have. */
export const INSTRUCTION_MAX = 300

/** A fragment a writing replaced, kept for one step back: what it was written for, and the change that made it, when one did. */
export interface PreviousFragment {
  html: string
  seconds: number
  words: MotionWord[]
  version: string
  instruction?: string
}

/** A graphic Claude designed and wrote as an HTML fragment, drawn in the box and played for `seconds`. */
export interface MotionSpec {
  kind: "motion"
  /** the contract version it was written under; the render hash takes the one in force now instead */
  version: string
  box: GraphicBox
  seconds: number
  /** Claude's one line on why it is there, shown in the app */
  why: string
  /** what is drawn, one Thai line: the brief of the writing call, and the row's summary */
  idea: string
  /** the words said while it plays, in order, with the time each was said when the fragment was written */
  words: MotionWord[]
  /** the fragment Claude wrote; null until it is written, and after a redo is asked */
  html: string | null
  /** why the last writing failed; absent once it is written */
  failed?: string
  /** the user's change that made the fragment there now; absent when a plan or a redo wrote it */
  instruction?: string
  /** why the last edit failed; the fragment there is the one from before it */
  editFailed?: string
  /** the fragment before the last edit or redo, for one step back */
  previous?: PreviousFragment
}

/** What a graphic is drawn from. Every graphic is a motion graphic, since the old kit of fixed pieces left in 0.5.0. */
export type GraphicSpec = MotionSpec

/**
 * Whether what a stored graphic holds as its spec is a motion graphic's. A spec in the app's hands always is; one
 * read from an outline file may be anything, since a file is outside the type system (a file edited by hand, a
 * kind a later version stores, an entry with no spec at all), so this takes stored data of any shape, and what
 * reads stored graphics asks it and leaves the rest out. Only an object of kind "motion" is one.
 */
export const isMotion = (spec: unknown): spec is MotionSpec => typeof spec === "object" && spec !== null && (spec as { kind?: unknown }).kind === "motion"

export interface GraphicCue {
  /** a moment of speech, with the beat it plays in */
  anchor: CueAnchor
  spec: GraphicSpec
  /** set by hand on the post-production page: planning again leaves it alone */
  edited: boolean
  /** switched off by the user; kept so it can be switched back on */
  off: boolean
  /** the emphasis point it was made for; absent on the user's own and on edited items whose point was deleted */
  pointId?: string
}

/** A graphic with the time it plays at on the rough cut and how long it stays. */
export interface PlacedGraphic {
  cue: GraphicCue
  atUs: number
  durationUs: number
  /** its words as they are said now while it plays, each with its seconds from where it starts now */
  wordsNow?: MotionWord[]
  /** written, and no longer played by the rough cut as it was written for (other words, or less time), or written under another contract: it is not rendered or put in a draft until it is written again */
  stale?: boolean
}

/** Shorter than this is a flash. */
export const GRAPHIC_MIN_US = 1_500_000
/** Longer than this and the picture underneath is forgotten. */
export const GRAPHIC_MAX_S = 6

const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" })

/**
 * `text` cut to at most `max` UTF-16 code units, which is what the checks on it count, by whole
 * graphemes: a Thai letter keeps its vowel and tone marks, and an emoji is kept or dropped whole.
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  let kept = ""
  for (const { segment } of graphemes.segment(text)) {
    if (kept.length + segment.length > max) break
    kept += segment
  }
  return kept
}

/**
 * The graphics that survive the rules: one the user switched off is not counted as lost, and the end
 * of the timeline cuts one short (and drops it when less than 1.5 s is left). Two may be on screen
 * together, over a cutaway or not: each goes on a track of its own (the user's choice, 2026-09-27),
 * and there is no level and no quota.
 */
export function enforceGraphics(graphics: PlacedGraphic[], durationUs: number): { kept: PlacedGraphic[]; dropped: number } {
  const on = graphics.filter((graphic) => !graphic.cue.off)
  const kept: PlacedGraphic[] = []
  for (const candidate of on) {
    // the caller says how long this cue would play; the end of the timeline may cut it short
    const room = Math.min(candidate.durationUs, durationUs - candidate.atUs)
    if (room < GRAPHIC_MIN_US) continue
    kept.push({ ...candidate, durationUs: room })
  }
  return { kept: kept.sort((a, b) => a.atUs - b.atUs), dropped: on.length - kept.length }
}
