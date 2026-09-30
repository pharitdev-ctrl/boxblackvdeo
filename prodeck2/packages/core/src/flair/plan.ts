import { TEXT_PATTERNS_BY_ID, usableExit, type TextPattern } from "./catalogue.ts"
import type { MediaFit, SubjectBox } from "./look-at.ts"
import type { BinMedia } from "./media.ts"
import type { SoundEffect } from "./sounds.ts"

/** Which word of a group is coloured: the line, and the word's place in it counted in code points. */
export interface Accent {
  line: number
  from: number
  to: number
}

/** Which of the palette's colours a whole group reads in. */
export const TONES = ["base", "accent", "alt"] as const
export type Tone = (typeof TONES)[number]

/** How one highlight group looks. */
export interface GroupLook {
  pattern: TextPattern
  /** the colour of the group's text: the palette's text, its accent, or its second colour */
  tone: Tone
  accent: Accent | null
  /** id from EXIT_ANIMATIONS, or null for no exit animation */
  exit: string | null
  /** set by hand on the post-production page: planning again leaves it as it is */
  edited: boolean
}

export const DEFAULT_LOOK: GroupLook = { pattern: "stack", tone: "base", accent: null, exit: null, edited: false }

/** How many groups in a row may share a pattern before it stops being a surprise. */
const MAX_RUN = 3

/** A pattern that can be drawn for a group of this many lines on this output. */
const drawable = (pattern: TextPattern, lines: number, landscape: boolean): boolean => {
  const entry = TEXT_PATTERNS_BY_ID[pattern]
  if (entry === undefined || (landscape && entry.portraitOnly)) return false
  return lines >= entry.lines.min && lines <= entry.lines.max
}

const accentFits = (accent: Accent, lines: string[]): boolean => {
  const line = lines[accent.line]
  if (line === undefined) return false
  return Number.isInteger(accent.from) && Number.isInteger(accent.to) && accent.from >= 0 && accent.from < accent.to && accent.to <= [...line].length
}

/**
 * The rules the app keeps whatever Claude answered or the settings changed to: a pattern the group
 * or the output cannot carry falls back to the plain stack — including one that only works on
 * portrait output — an accent or exit that does not exist, or an exit that needs CapCut Pro the user
 * does not have, is dropped, an unknown tone is the base one, and neither the same pattern nor the
 * same tone runs for more than three groups. Every level may use every pattern and exit the user may
 * have: the level only chooses which emphasis points get effects. A look the user edited is kept
 * whatever run it is in, but not what cannot be drawn: a pattern the group or the output cannot
 * carry, an exit that does not exist or needs Pro the user lacks, a tone that does not exist, a
 * coloured word the text has no room for. It still counts towards a run.
 */
export function enforce(looks: GroupLook[], groups: { lines: string[] }[], landscape = false, pro = false): GroupLook[] {
  // the runs count what shows, so a group set by hand as it showed leaves its neighbours as they were
  let run: { value: TextPattern; length: number } = { value: "stack", length: 0 }
  let toneRun: { value: Tone; length: number } = { value: "base", length: 0 }
  const after = <T>(current: { value: T; length: number }, value: T) => (value === current.value ? { value, length: current.length + 1 } : { value, length: 1 })
  return groups.map((group, i) => {
    const look = looks[i] ?? DEFAULT_LOOK
    const fits = drawable(look.pattern, group.lines.length, landscape)
    let pattern: TextPattern = fits ? look.pattern : "stack"
    if (!look.edited && after(run, pattern).length > MAX_RUN) pattern = "stack"
    run = after(run, pattern)
    let tone: Tone = TONES.includes(look.tone) ? look.tone : "base"
    if (!look.edited && after(toneRun, tone).length > MAX_RUN) tone = "base"
    toneRun = after(toneRun, tone)
    const accent = look.accent !== null && accentFits(look.accent, group.lines) ? look.accent : null
    const exit = usableExit(look.exit, pro)
    if (look.edited) return { ...look, pattern, tone, accent, exit }
    return { pattern, tone, accent, exit, edited: false }
  })
}

/** Where a sound effect sits: on a line of highlight text, on a cut, or at the edge of a beat. */
export type CueAnchor =
  | { kind: "highlight"; groupId: string; line: number }
  /** a join; `beatId` tells apart footage played in two beats (absent on anchors saved before) */
  | { kind: "cut"; videoId: string; sourceUs: number; beatId?: string }
  | { kind: "beat"; beatId: string; edge: "start" | "end" }
  /** a moment of speech: the source time of a word, or of the sentence, it lands on */
  | { kind: "speech"; videoId: string; sourceUs: number; beatId?: string }

export interface SoundCue {
  anchor: CueAnchor
  effectId: string
  /** set by hand on the post-production page: planning again leaves it alone */
  edited: boolean
  /** the emphasis point it was made for; absent on the user's own and on edited items whose point was deleted */
  pointId?: string
}

/** A cue with the time it plays at on the rough cut and the sound it will use. */
export interface PlacedCue {
  cue: SoundCue
  atUs: number
  sound: SoundEffect
}

/**
 * The cues that play: every one that starts inside the timeline, in time order, at every level. How
 * many there are and how close they sit is Claude's call and the user's — the app drops none of
 * them, and two that overlap play on separate audio tracks.
 */
export function enforceCues(cues: PlacedCue[], durationUs: number): { kept: PlacedCue[]; dropped: number } {
  const kept = cues.filter((cue) => cue.atUs >= 0 && cue.atUs < durationUs).sort((a, b) => a.atUs - b.atUs)
  return { kept, dropped: cues.length - kept.length }
}

export const ZOOM_KINDS = ["punch", "drift"] as const
export type ZoomKind = (typeof ZOOM_KINDS)[number]

/** A piece of the rough cut, named by the source it plays and the beat it plays in. */
export interface PieceAnchor {
  videoId: string
  sourceUs: number
  /** the beat the piece plays in, so footage two beats both play is two pieces; absent on zooms saved before */
  beatId?: string
}

export interface ZoomCue {
  anchor: PieceAnchor
  kind: ZoomKind
  /** set by hand on the post-production page: planning again leaves it alone */
  edited: boolean
  /** the emphasis point it was made for; absent on the user's own and on edited items whose point was deleted */
  pointId?: string
}

/** A zoom with the piece it sits on, on the rough cut. */
export interface PlacedZoom {
  cue: ZoomCue
  atUs: number
  durationUs: number
}

/** A punch needs this much picture to rise and settle in. */
const MIN_PUNCH_US = 1_500_000
/** A drift across anything shorter than this is not a move, it is a wobble. */
const MIN_DRIFT_US = 2_500_000

/**
 * The zooms that survive the rules: the user's own come first, one on a piece that does not start
 * inside the timeline goes, a drift on a piece too short becomes a punch (and a piece too short for
 * that loses its zoom), and a piece takes one zoom — its keyframes are one set, so a second would
 * silently write over the first. Two name one piece when they name the same footage in the same beat
 * (the caller has put each on its piece's own anchor). No level and no quota: how many and how close
 * is Claude's call and the user's (the user's choice, 2026-09-27).
 */
export function enforceZooms(zooms: PlacedZoom[], durationUs: number): { kept: PlacedZoom[]; dropped: number } {
  const byTime = [...zooms].sort((a, b) => a.atUs - b.atUs)
  const order = [...byTime.filter((zoom) => zoom.cue.edited), ...byTime.filter((zoom) => !zoom.cue.edited)]

  const kept: PlacedZoom[] = []
  const zoomed = new Set<string>()
  for (const candidate of order) {
    if (candidate.atUs < 0 || candidate.atUs >= durationUs || candidate.durationUs < MIN_PUNCH_US) continue
    const { videoId, sourceUs, beatId } = candidate.cue.anchor
    const piece = `${videoId}:${sourceUs}:${beatId ?? ""}`
    if (zoomed.has(piece)) continue
    zoomed.add(piece)
    const kind = candidate.cue.kind === "drift" && candidate.durationUs < MIN_DRIFT_US ? "punch" : candidate.cue.kind
    kept.push({ ...candidate, cue: { ...candidate.cue, kind } })
  }
  return { kept: kept.sort((a, b) => a.atUs - b.atUs), dropped: zooms.length - kept.length }
}

/** A cutaway to a picture from the project's bin, anchored where a sound cue would be. */
export interface InsertCue {
  anchor: CueAnchor
  binId: string
  /** set by hand on the post-production page: planning again leaves it alone */
  edited: boolean
  /** how the picture is laid on the frame, as Claude saw it or as the user set it */
  fit?: MediaFit
  /** where the subject sits inside the picture, for a cover that crops to it */
  subject?: SubjectBox | null
  /** the emphasis point it was made for; absent on the user's own and on edited items whose point was deleted */
  pointId?: string
}

/** An insert with the time it plays at, the file it shows and how long it stays. */
export interface PlacedInsert {
  cue: InsertCue
  atUs: number
  media: BinMedia
  durationUs: number
}

/** How long a photo stays on screen. */
export const INSERT_PHOTO_US = 2_000_000
/** No cutaway outstays this, however long its clip is. */
export const INSERT_MAX_US = 3_000_000
/** A cutaway shorter than this is a flash, not a shot. */
const INSERT_MIN_US = 700_000

/** How long a cutaway to this file would play, before the end of the timeline is taken into account. */
export const insertLength = (media: BinMedia): number => (media.kind === "photo" ? INSERT_PHOTO_US : Math.min(media.durationUs, INSERT_MAX_US))

/**
 * The cutaways that survive the rules: one is cut short by the end of the timeline, and dropped when
 * less than a flash is left. Two may overlap and one file may show again: overlapping cutaways go on
 * tracks of their own (the user's choice, 2026-09-27), and there is no level and no quota.
 */
export function enforceInserts(inserts: PlacedInsert[], durationUs: number): { kept: PlacedInsert[]; dropped: number } {
  const kept: PlacedInsert[] = []
  for (const candidate of inserts) {
    // the caller says how long this file would play; the end of the timeline may cut it short
    const room = Math.min(candidate.durationUs, durationUs - candidate.atUs)
    if (room < INSERT_MIN_US) continue
    kept.push({ ...candidate, durationUs: room })
  }
  return { kept: kept.sort((a, b) => a.atUs - b.atUs), dropped: inserts.length - kept.length }
}
