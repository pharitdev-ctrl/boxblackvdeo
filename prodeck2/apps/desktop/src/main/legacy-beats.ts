import type { CueAnchor, PieceAnchor } from "@boxblack/core/flair/plan"
import type { StoredOutline } from "../shared/api.ts"

/** The beat each kind of thing plays in on the rough cut as it is now; none when its place is gone. */
export interface BeatFinders {
  cue: (anchor: CueAnchor) => string | undefined
  insert: (anchor: CueAnchor) => string | undefined
  zoom: (anchor: PieceAnchor) => string | undefined
}

/** A join, a moment of speech or a piece saved before they knew their beat. */
const beatless = (anchor: CueAnchor | PieceAnchor) => ("kind" in anchor ? anchor.kind === "cut" || anchor.kind === "speech" : true) && !("beatId" in anchor && anchor.beatId !== undefined)

/** Whether anything in the outline was saved before it knew its beat. */
export function hasBeatless(stored: StoredOutline): boolean {
  const flair = stored.flair
  return [...(flair?.cues ?? []), ...(flair?.inserts ?? []), ...(flair?.zooms ?? []), ...(flair?.graphics ?? [])].some((item) => beatless(item.anchor))
}

/**
 * Sounds on joins, cutaways and graphics on words and zooms saved before they knew their beat name footage
 * only; on footage two beats both play, each plays where it always has. That beat is written onto
 * it — the rough cut is what says where it plays — so that setting or taking off something on the
 * other beat's copy of that footage leaves it alone. What has no place now is left as it was.
 */
export function withBeats(stored: StoredOutline, find: BeatFinders): StoredOutline {
  const flair = stored.flair
  if (!flair) return stored
  let changed = false
  const settle = <T extends { anchor: A }, A extends CueAnchor | PieceAnchor>(items: T[] | undefined, beatOf: (anchor: A) => string | undefined): T[] | undefined =>
    items?.map((item) => {
      const beatId = beatless(item.anchor) ? beatOf(item.anchor) : undefined
      if (beatId === undefined) return item
      changed = true
      return { ...item, anchor: { ...item.anchor, beatId } }
    })
  const cues = settle(flair.cues, find.cue)
  const inserts = settle(flair.inserts, find.insert)
  const zooms = settle(flair.zooms, find.zoom)
  // a graphic sits on a moment of speech as a cutaway does, so its beat is found the same way
  const graphics = settle(flair.graphics, find.insert)
  if (!changed) return stored
  return { ...stored, flair: { ...flair, ...(cues ? { cues } : {}), ...(inserts ? { inserts } : {}), ...(zooms ? { zooms } : {}), ...(graphics ? { graphics } : {}) } }
}
