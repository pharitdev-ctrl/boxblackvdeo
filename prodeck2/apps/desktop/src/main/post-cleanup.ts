import { join } from "node:path"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import { isMotion, type GraphicCue } from "@boxblack/core/graphics/plan"
import type { StoredOutline } from "../shared/api.ts"
import { offGoneLines, unbound, usersGroup } from "./emphasis.ts"
import { regroupFlair } from "./highlight-state.ts"
import type { UpgradeStep } from "./project-files.ts"
import { heldMoments, startMoment, withoutSoundsOn } from "./sound-cues.ts"

/** The post-production data version M25's cleanup leaves an outline at, and an outline made by 0.4 carries: its graphics may be of the old kit. */
const M25_VERSION = 1
/**
 * The post-production data version an outline written by this app carries: one without any is from before M25,
 * and one at 1 is from before 0.5.0, when graphics were drawn by the old kit of fixed pieces.
 */
export const POST_VERSION = 2

/**
 * The one-time cleanup of an outline from before M25: Claude's highlight groups that are not the user's
 * (usersGroup: made, changed, or given a look by hand) go with their looks and the line sounds nobody
 * edited (regroupFlair with nothing taking them), every unedited sound, zoom, move, cutaway and graphic goes,
 * and postVersion becomes 1, where 0.4 had it, for the cleanup of 0.5.0 to take from there. What the user
 * edited stays, with no pointId: spec §7 lets a group take only its own look and its unedited line sounds,
 * so an edited sound, cutaway or graphic on a line of a group that goes moves to the start of that line's
 * beat instead of going with it (offGoneLines; the user's decision of 2026-09-28 for sounds).
 * An outline that has postVersion is handed back as the same object, so running it twice changes nothing.
 */
export function withoutOldEffects(stored: StoredOutline): StoredOutline {
  if (stored.postVersion !== undefined) return stored
  const before = stored.highlights?.groups ?? []
  // the groups the user made or changed, or whose look they set by hand, stay with their looks
  const kept = before.filter((group) => usersGroup(stored, group)).map(unbound)
  const staying = new Set(kept.map((group) => group.id))
  // Claude placed these on its own old picks; the plan on emphasis points places them again
  const edited = <T extends { pointId?: string; edited: boolean }>(items: T[]): T[] => items.filter((item) => item.edited).map(unbound)
  const was = stored.flair
  const flair = was && {
    ...was,
    // an edited line sound moves off a group that goes, like a cutaway or graphic (spec §7)
    ...(was.cues ? { cues: offGoneLines(edited(was.cues), stored, before, staying) } : {}),
    ...(was.zooms ? { zooms: edited(was.zooms) } : {}),
    ...(was.moves ? { moves: edited(was.moves) } : {}),
    ...(was.inserts ? { inserts: offGoneLines(edited(was.inserts), stored, before, staying) } : {}),
    ...(was.graphics ? { graphics: offGoneLines(edited(was.graphics), stored, before, staying) } : {}),
  }
  const highlights = stored.highlights && { ...stored.highlights, groups: kept }
  const next: StoredOutline = { ...stored, ...(flair ? { flair } : {}), ...(highlights ? { highlights } : {}) }
  return { ...regroupFlair(next, before, () => false), postVersion: M25_VERSION }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** Whether an entry of a stored list of graphics is a motion graphic the app can place: it has a place, and its spec is a motion graphic's. */
const storedMotion = (entry: unknown): entry is GraphicCue => isObject(entry) && isObject(entry.anchor) && isMotion(entry.spec)

/** Where an entry that goes had its sound slot, when it is enough of a graphic to have had one: it has a place. */
const slotOfEntry = (entry: unknown) => (isObject(entry) && isObject(entry.anchor) ? startMoment(entry as { anchor: CueAnchor; pointId?: string }) : null)

/**
 * The one-time cleanup of an outline from before 0.5.0, which is one at version 1: the old kit of fixed pieces
 * is gone from the app, so every stored graphic that is not a motion graphic goes, the ones the user
 * made theirs too (the user's decision of 2026-09-30; the store keeps a copy of the outline as it was), and
 * postVersion becomes POST_VERSION. Claude's unedited sounds on the moment and the point of a graphic that goes
 * go with it, unless a zoom, a cutaway or a graphic still there holds that moment (withoutSoundsOn, as when one
 * of Claude's graphics is taken away by hand). Here a sound on one of the user's own graphics goes the same way:
 * it was chosen for a graphic that can never play again. A motion graphic stays as it is, and so do the text and
 * its looks, the zooms, the moves, the cutaways, the user's own sounds and every other sound.
 * The list is a file's, which is outside the type system: an entry of any other shape than a motion graphic with
 * a place (none at all, one with no spec or no place) goes as the kit's do, and a list that is no list is none.
 * An outline at any other version is handed back as the same object: one at POST_VERSION is clean already, and
 * one with no version is M25's cleanup's to bring to 1 first, which the store does in the same read.
 */
export function withoutKitGraphics(stored: StoredOutline): StoredOutline {
  if (stored.postVersion !== M25_VERSION) return stored
  const was = stored.flair
  if (!was || was.graphics === undefined) return { ...stored, postVersion: POST_VERSION }
  const all: unknown[] = Array.isArray(was.graphics) ? was.graphics : []
  const graphics = all.filter(storedMotion)
  const gone = all.filter((entry) => !storedMotion(entry))
  const cues = withoutSoundsOn(was.cues ?? [], gone.map(slotOfEntry), heldMoments({ ...was, graphics }))
  return { ...stored, flair: { ...was, graphics, ...(was.cues ? { cues } : {}) }, postVersion: POST_VERSION }
}

/**
 * The cleanups an outline goes through when it is read, in order, each with the folder that keeps a copy of the
 * outline as it was before it: beside the outlines folder under the app's data folder rather than in it, which
 * is read whole for the project list. An outline from before M25 goes through both and is copied once, beside
 * M25's copies; one from 0.4 is copied beside 0.5.0's.
 */
export function outlineUpgrades(userData: string): UpgradeStep<StoredOutline>[] {
  return [
    { upgrade: withoutOldEffects, backupDir: join(userData, "outlines-before-m25") },
    { upgrade: withoutKitGraphics, backupDir: join(userData, "outlines-before-050") },
  ]
}
