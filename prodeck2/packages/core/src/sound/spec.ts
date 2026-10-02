import { FLAIR_LEVELS, type FlairLevel } from "../flair/catalogue.ts"
import type { CueAnchor } from "../flair/plan.ts"
import type { MotionWord } from "../graphics/plan.ts"

/*
 * A sound effect Claude composed for one moment of the clip, as Web Audio code (spec §4). The outline keeps it in
 * `flair.composed`, apart from the CapCut library sounds of 0.5.x in `flair.cues`, and it lives as a graphic of
 * 0.5.1 does: written by a plan or a redo, changed by an edit, one step back, switched off, removed.
 */

/** The contract and harness a sound's code was composed for; a new one makes every sound stale. */
export const SOUND_VERSION = "sound-2026-10-01"
/** The most characters a sound's code may have: about three times the longest of the four the spike's calls wrote (6 KB). */
export const SOUND_CODE_MAX = 20_000
/** The shortest a sound lasts with its tail, in seconds: shorter is a click, not a sound. */
export const SOUND_SECONDS_MIN = 0.2
/** The longest a sound lasts with its tail, in seconds: longer is music, not an effect. */
export const SOUND_SECONDS_MAX = 6
/** The most characters the Thai sentence saying what a sound does may have. */
export const SOUND_ROLE_MAX = 200
/** How loud a sound is meant to sit under the voice, as Claude plans it; the app sets each to its level after the render. */
export const SOUND_LOUDNESS = ["soft", "normal", "strong"] as const
export type SoundLoudness = (typeof SOUND_LOUDNESS)[number]
/** integrated loudness each class is set to, LUFS; starting values, tuned in the live test */
export const LOUDNESS_LUFS: Record<SoundLoudness, number> = { soft: -30, normal: -26, strong: -22 }

/** The code a writing replaced, kept for one step back. */
export interface SoundPrevious {
  code: string
  seconds: number
  words: MotionWord[]
  version: string
  /** the hash of its graphic's fragment when it was composed, for a sound tied to a graphic */
  graphicHtml?: string
  /** the user's change that made it, when one did */
  instruction?: string
}

export interface ComposedSound {
  /** where it starts: a speech anchor; a sound tied to a graphic has the graphic's anchor */
  anchor: CueAnchor
  /** the graphic it scores; it is switched off, removed, undone and written again with it */
  graphic?: CueAnchor
  /** hashOfHtml of that graphic's fragment when this code was composed */
  graphicHtml?: string
  /** the emphasis point it serves, when it serves one */
  pointId?: string
  /** the lowest level it plays at */
  from: FlairLevel
  /** what it does, in Thai: the composing brief and the row's text */
  role: string
  loudness: SoundLoudness
  /** its length with its tail, SOUND_SECONDS_MIN..MAX, as composed */
  seconds: number
  /** the words spoken in it, seconds from its start, when composed */
  words: MotionWord[]
  /** the function Claude wrote; null until it is written, and when the writing failed */
  code: string | null
  /** the contract it was composed under: SOUND_VERSION when it was written */
  version: string
  /** why the last writing failed; absent once it is written */
  failed?: string
  /** the user's change that made the code there now; absent when a plan or a redo wrote it */
  instruction?: string
  /** why the last edit failed; the code there is the one from before it */
  editFailed?: string
  /** the code before the last edit or redo, for one step back */
  previous?: SoundPrevious
  /** switched off by the user; kept so it can be switched back on */
  off: boolean
}

/** Whether a stored value is an anchor: an object with a string kind. What places it reads the rest. */
const isAnchor = (value: unknown) => typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string"
/** Absent, or a string. */
const textOrAbsent = (value: unknown) => value === undefined || typeof value === "string"

/**
 * Whether a stored value is a composed sound, field by field: an anchor with a kind, its role, its code or none,
 * a finite length, its words, its lowest level, its loudness, its version and whether it is off; and, of what it may
 * leave out, a graphic that is an anchor and texts that are strings. A sound in the app's hands always
 * is one; one read from an outline file may hold anything (a file edited by hand, a field a later version stores),
 * so what reads stored sounds asks this first and leaves the rest out.
 */
export function isComposed(value: unknown): value is ComposedSound {
  if (typeof value !== "object" || value === null) return false
  const { anchor, graphic, graphicHtml, pointId, role, code, seconds, words, from, loudness, version, failed, instruction, editFailed, off } = value as Record<string, unknown>
  return (
    isAnchor(anchor) &&
    (graphic === undefined || isAnchor(graphic)) &&
    textOrAbsent(graphicHtml) &&
    textOrAbsent(pointId) &&
    typeof role === "string" &&
    (typeof code === "string" || code === null) &&
    typeof seconds === "number" &&
    Number.isFinite(seconds) &&
    Array.isArray(words) &&
    (FLAIR_LEVELS as readonly unknown[]).includes(from) &&
    (SOUND_LOUDNESS as readonly unknown[]).includes(loudness) &&
    typeof version === "string" &&
    textOrAbsent(failed) &&
    textOrAbsent(instruction) &&
    textOrAbsent(editFailed) &&
    typeof off === "boolean"
  )
}

/**
 * Whether what a stored sound holds as its code kept for a step back is one: the code, its length, its words and its
 * contract, and the graphic's hash and the change that made it only as texts. As with a graphic's (isPrevious), what
 * uses it asks this first, since a file may hold anything there.
 */
export function isSoundPrevious(value: unknown): value is SoundPrevious {
  if (typeof value !== "object" || value === null) return false
  const { code, seconds, words, version, graphicHtml, instruction } = value as Record<string, unknown>
  return (
    typeof code === "string" &&
    typeof seconds === "number" &&
    Array.isArray(words) &&
    typeof version === "string" &&
    textOrAbsent(graphicHtml) &&
    textOrAbsent(instruction)
  )
}
