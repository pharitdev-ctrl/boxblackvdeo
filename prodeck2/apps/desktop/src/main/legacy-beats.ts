import type { CueAnchor, PieceAnchor } from "@boxblack/core/flair/plan"
import { isComposed } from "@boxblack/core/sound/spec"
import type { StoredOutline } from "../shared/api.ts"

/** The beat each kind of thing plays in on the rough cut as it is now; none when its place is gone. */
export interface BeatFinders {
  cue: (anchor: CueAnchor) => string | undefined
  insert: (anchor: CueAnchor) => string | undefined
  zoom: (anchor: PieceAnchor) => string | undefined
}

/** A join, a moment of speech (a move's among them) or a piece saved before they knew their beat. */
const beatless = (anchor: CueAnchor | PieceAnchor) => ("kind" in anchor ? anchor.kind === "cut" || anchor.kind === "speech" : true) && !("beatId" in anchor && anchor.beatId !== undefined)

/**
 * Whether anything in the outline was saved before it knew its beat: a composed sound by its own moment, or by its
 * graphic's. A stored composed entry that is no sound (`isComposed`) is passed over.
 */
export function hasBeatless(stored: StoredOutline): boolean {
  const flair = stored.flair
  const composed = (flair?.composed ?? []).filter(isComposed)
  const tied = composed.flatMap((sound) => (sound.graphic ? [{ anchor: sound.graphic }] : []))
  return [...(flair?.cues ?? []), ...(flair?.inserts ?? []), ...(flair?.zooms ?? []), ...(flair?.moves ?? []), ...(flair?.graphics ?? []), ...composed, ...tied].some((item) => beatless(item.anchor))
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
  // a graphic sits on a moment of speech as a cutaway does, so its beat is found the same way, and so does a move,
  // on its word or on its cutaway's moment
  const graphics = settle(flair.graphics, find.insert)
  const moves = settle(flair.moves, find.insert)
  // and so does a composed sound, and the moment it names the graphic it scores by; an entry that is no sound is left as it is
  const composed = flair.composed?.map((sound) => {
    if (!isComposed(sound)) return sound
    const [settled] = settle([sound], find.insert)!
    return settled!.graphic ? { ...settled!, graphic: settle([{ anchor: settled!.graphic }], find.insert)![0]!.anchor } : settled!
  })
  if (!changed) return stored
  return {
    ...stored,
    flair: { ...flair, ...(cues ? { cues } : {}), ...(inserts ? { inserts } : {}), ...(zooms ? { zooms } : {}), ...(moves ? { moves } : {}), ...(graphics ? { graphics } : {}), ...(composed ? { composed } : {}) },
  }
}
