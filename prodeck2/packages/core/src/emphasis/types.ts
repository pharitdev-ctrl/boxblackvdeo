// The emphasis plan's data. Only type imports, so the renderer can import it.
import type { FlairLevel } from "../flair/catalogue.ts"

/** How much a point matters: key must be remembered, secondary helps understanding, extra is for a loud clip. Thai: สำคัญ · รอง · เสริม. */
export const IMPORTANCE = ["key", "secondary", "extra"] as const
export type Importance = (typeof IMPORTANCE)[number]

/** What kind of thing a point is: the opening hook, a number or price, a product, an action, a feeling, a place, a good-looking picture. */
export const EMPHASIS_TYPES = ["hook", "number", "product", "action", "emotion", "place", "visual"] as const
export type EmphasisType = (typeof EMPHASIS_TYPES)[number]

/** Where a point is: words [from, to) of a video's transcript said in a beat, or a stretch of a picture beat's file. */
export type EmphasisAnchor =
  | { kind: "speech"; videoId: string; from: number; to: number; beatId: string }
  | { kind: "scene"; videoId: string; startUs: number; endUs: number; beatId: string }

/** One thing the clip should stress; works 2 and 4 put their items on it. */
export interface EmphasisPoint {
  id: string
  anchor: EmphasisAnchor
  importance: Importance
  type: EmphasisType
  /** Claude's one line on why, or the user's */
  reason: string
  source: "ai" | "user"
  /** the user changed its importance, type, reason or phrase: thinking again leaves it alone */
  edited: boolean
}

/** The points of one outline, stored as `StoredOutline.emphasis`. */
export interface StoredEmphasis {
  points: EmphasisPoint[]
  /** goes up by one whenever the points change in a way works 2 and 4 should hear about */
  version: number
  /** the version works 2 and 4 last planned on; one that differs from `version` shows the "จุดเน้นเปลี่ยน" banner */
  plannedOn: { graphics: number | null; sounds: number | null }
  /** per video, the transcript fingerprint the speech points' word numbers belong to */
  transcripts: Record<string, string>
}

/** What the user may change on a point; a field left out stays. */
export interface EmphasisPatch {
  importance?: Importance
  type?: EmphasisType
  reason?: string
  /** a new phrase (or scene stretch) for the point */
  anchor?: EmphasisAnchor
}

/** An outline with no points yet. Frozen through, since every outline without points shares this one copy. */
export const EMPTY_EMPHASIS: StoredEmphasis = Object.freeze({
  // frozen at run time; typed as the plain array a StoredEmphasis holds
  points: Object.freeze<EmphasisPoint[]>([]) as EmphasisPoint[],
  version: 0,
  plannedOn: Object.freeze({ graphics: null, sounds: null }),
  transcripts: Object.freeze({}),
})

/** The longest reason kept, Claude's or the user's, in UTF-16 units: what `reason.length` counts. */
export const EMPHASIS_REASON_MAX = 200

const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" })

/**
 * A reason as it is stored: trimmed, and cut to at most EMPHASIS_REASON_MAX UTF-16 units by whole
 * graphemes, so a Thai letter keeps its marks and an emoji with a skin tone or joiners is kept or
 * dropped whole. A space the cut leaves at the end goes too, so a kept reason keeps as it is.
 */
export function keptReason(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= EMPHASIS_REASON_MAX) return trimmed
  let kept = ""
  for (const { segment } of graphemes.segment(trimmed)) {
    if (kept.length + segment.length > EMPHASIS_REASON_MAX) break
    kept += segment
  }
  return kept.trimEnd()
}

/** The importances each level lets through: light the key points, medium key and secondary, heavy all. */
export const LEVEL_IMPORTANCE: Record<FlairLevel, readonly Importance[]> = { light: ["key"], medium: ["key", "secondary"], heavy: ["key", "secondary", "extra"] }

/** Whether a point of this importance gets effects at this level. */
export const passesLevel = (importance: Importance, level: FlairLevel): boolean => LEVEL_IMPORTANCE[level].includes(importance)
