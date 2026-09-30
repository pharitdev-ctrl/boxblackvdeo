import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { playsIn, type CutClip, type CutPlan } from "@boxblack/core/cut"
import type { CueSlot, InsertMedia } from "@boxblack/core/flair/direct"
import type { MediaLook } from "@boxblack/core/flair/look-at"
import { spareMedia, type BinMedia } from "@boxblack/core/flair/media"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { PlacedPoint, PointFilter } from "@boxblack/core/emphasis"
import { enforceInserts, insertLength, type CueAnchor, type InsertCue, type PlacedInsert } from "@boxblack/core/flair/plan"
import { pointAnchor } from "./highlight-state.ts"
import { slotFinder } from "./sound-cues.ts"
import type { SpokenSentence } from "./spoken.ts"

export interface SpareMediaDeps {
  /** the draft's own `draft_meta_info.json`; injected so tests need no files */
  readMeta?: (folder: string) => Promise<unknown>
  exists?: (path: string) => boolean
}

/** The photos and clips of a project that the rough cut does not already play. */
export function createSpareMedia(deps: SpareMediaDeps = {}) {
  const readMeta = deps.readMeta ?? (async (folder: string) => JSON.parse(await readFile(join(folder, "draft_meta_info.json"), "utf8")) as unknown)
  const exists = deps.exists ?? existsSync

  return {
    async list(folder: string, usedBinIds: string[]): Promise<BinMedia[]> {
      try {
        return spareMedia(await readMeta(folder), usedBinIds, exists)
      } catch {
        // a project whose bin cannot be read simply has nothing to cut away to
        return []
      }
    },
  }
}

export type SpareMedia = ReturnType<typeof createSpareMedia>

/** Where an anchor plays on the rough cut, and what is there, in the user's language. */
export interface Place {
  atUs: number
  what: string
  beatId: string
}

const clock = (us: number) => {
  const tenths = Math.round(us / 100_000)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`
}

/**
 * Where each kind of anchor plays on this rough cut: a point by its slot, a moment of speech by
 * the piece that holds its source time — none when that moment was cut away. A speech place is
 * named by its sentence and, when it starts a word, that word.
 */
export function placeOf(input: {
  slots: CueSlot[]
  sentences: SpokenSentence[]
  plan: CutPlan
  /** where a source time of a kept piece plays on the rough cut */
  at: (cut: number, sourceUs: number) => number
}): (anchor: CueAnchor) => Place | null {
  const slotOf = slotFinder(input.slots)
  // which beat each kept piece belongs to, in playing order
  const beatOf: string[] = []
  for (const beat of input.plan.beats) for (const _ of beat.pieces) beatOf.push(beat.beatId)

  return (anchor) => {
    if (anchor.kind !== "speech") {
      const slot = slotOf(anchor)
      return slot ? { atUs: slot.atUs, what: slot.what, beatId: slot.beatId } : null
    }
    // a sentence ending on a word timed with no length holds that word too
    const holds = (candidate: SpokenSentence) => anchor.sourceUs < candidate.endUs || (anchor.sourceUs === candidate.endUs && candidate.words.at(-1)!.startUs === candidate.endUs)
    const sentence = input.sentences.find((candidate) => candidate.videoId === anchor.videoId && candidate.words[0]!.startUs <= anchor.sourceUs && holds(candidate))
    const word = sentence?.words.find((entry) => entry.startUs === anchor.sourceUs)
    // the cut may snap a piece's start past the beginning of its first word: that word still plays, from the piece's start
    const wordEnd = word ? (sentence!.words[sentence!.words.indexOf(word) + 1]?.startUs ?? sentence!.endUs) : null
    // a word timed with no length at the very end of a piece plays there, as it does for the captions
    const noLength = sentence !== undefined && anchor.sourceUs === sentence.endUs && sentence.words.at(-1)!.startUs === sentence.endUs
    const span = (cut: CutPlan["cuts"][number]) => ({ startUs: cut.sourceStartUs, endUs: cut.sourceStartUs + cut.sourceDurationUs })
    const sameVideo = input.plan.cuts.filter((cut) => cut.binId === anchor.videoId).map(span)
    const plays = (cut: CutPlan["cuts"][number]) =>
      cut.binId === anchor.videoId &&
      ((cut.sourceStartUs <= anchor.sourceUs && anchor.sourceUs < cut.sourceStartUs + cut.sourceDurationUs) ||
        (noLength && playsIn({ startUs: anchor.sourceUs, endUs: anchor.sourceUs }, span(cut), sameVideo)) ||
        (wordEnd !== null && anchor.sourceUs < cut.sourceStartUs && cut.sourceStartUs < wordEnd))
    // footage played in two beats: the beat it was put in; one saved before cutaways knew their beat, the first
    const index = input.plan.cuts.findIndex((cut, i) => plays(cut) && (anchor.beatId === undefined || beatOf[i] === anchor.beatId))
    if (index < 0) return null
    const atUs = input.at(index, Math.max(anchor.sourceUs, input.plan.cuts[index]!.sourceStartUs))
    const what = !sentence ? `ที่ ${clock(atUs)}` : word ? `ที่ “${sentence.text}” ตรงคำว่า “${word.text}”` : `ที่ “${sentence.text}”`
    return { atUs, what, beatId: beatOf[index]! }
  }
}

/** Where an item plays, and the anchor it plays by: its own, or the start of the point it was made for. */
export interface ItemPlace extends Place {
  by: CueAnchor
}

/**
 * Where an item plays on this rough cut: by its own anchor, else — when that is a moment of speech the cut
 * took out (the first word of its point cut, say) and the item was made for a point placed here — where that
 * point starts now (pointAnchor), so Claude's cutaway or graphic on it, and the sounds on those, follow the
 * point instead of going quiet; a sound and a cutaway on one point go there together. A line of text, a beat's
 * edge or a join is a place of its own, which the text switch, the level or the cut takes away with its thing,
 * so an item on one has no fallback; nor has one on no point or on a point not placed here. The stored anchor
 * stays as it is: the lists show it, so an edit finds the item again. `points` are the points placed on this
 * rough cut, whatever the level.
 */
export function itemPlaceOf(place: (anchor: CueAnchor) => Place | null, points: PlacedPoint[]): (anchor: CueAnchor, pointId?: string) => ItemPlace | null {
  const byId = new Map(points.map((placed) => [placed.point.id, placed]))
  return (anchor, pointId) => {
    const own = place(anchor)
    if (own) return { ...own, by: anchor }
    const placed = anchor.kind === "speech" && pointId !== undefined ? byId.get(pointId) : undefined
    if (!placed) return null
    const start = pointAnchor(placed)
    const there = place(start)
    return there && { ...there, by: start }
  }
}

/**
 * The cutaways that will really play: the stored ones the level lets through whose place is still on
 * the rough cut and whose file the project still has, put through the rules. One on an emphasis point
 * the level hides is neither kept nor dropped. `place` is handed each cutaway's point too (itemPlaceOf).
 */
export function insertsInForce(input: {
  inserts: InsertCue[]
  place: (anchor: CueAnchor, pointId?: string) => Place | null
  media: BinMedia[]
  flair: FlairOptions
  durationUs: number
  /** which items show: one on no point, or on a point placed on this rough cut whose importance the level lets through; one on a point cut away, deleted or on an earlier transcript does not */
  passes: PointFilter
}): { kept: PlacedInsert[]; dropped: number } {
  if (!input.flair.insert) return { kept: [], dropped: 0 }
  const media = new Map(input.media.map((picture) => [picture.binId, picture]))
  const placed: PlacedInsert[] = []
  let gone = 0
  for (const cue of input.inserts) {
    if (!input.passes(cue.pointId)) continue
    const where = input.place(cue.anchor, cue.pointId)
    const picture = media.get(cue.binId)
    if (!where || !picture) {
      gone++
      continue
    }
    placed.push({ cue, atUs: where.atUs, media: picture, durationUs: insertLength(picture) })
  }
  const { kept, dropped } = enforceInserts(placed, input.durationUs)
  return { kept, dropped: dropped + gone }
}

/** The pictures as Claude is shown them: what each one is, when it has been looked at. */
export const withDescriptions = (media: BinMedia[], said: Record<string, MediaLook>): InsertMedia[] =>
  media.map((picture) => {
    const look = said[picture.binId]
    return look ? { ...picture, what: look.what, subject: look.subject, fit: look.fit } : picture
  })

/**
 * The band the video underneath must keep clear at a moment on the rough cut — the face or the
 * product of the scene playing then — so a card is put somewhere else. Null when that moment has
 * no picture analysed.
 */
export function keepClearAt(plan: CutPlan, clips: CutClip[], atUs: number): { fromY: number; toY: number } | null {
  let start = 0
  for (const cut of plan.cuts) {
    const end = start + cut.sourceDurationUs
    if (atUs < end) {
      const sourceUs = cut.sourceStartUs + (atUs - start)
      const scenes = clips.find((clip) => clip.id === cut.binId)?.insight?.scenes ?? []
      return scenes.find((scene) => scene.startUs <= sourceUs && sourceUs < scene.endUs)?.keepClear ?? null
    }
    start = end
  }
  return null
}
