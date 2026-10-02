import type { CutPlan } from "@boxblack/core/cut"
import type { PointFilter } from "@boxblack/core/emphasis"
import type { CueSlot } from "@boxblack/core/flair/direct"
import { enforceCues, type CueAnchor, type PlacedCue, type SoundCue, type ZoomCue } from "@boxblack/core/flair/plan"
import type { SoundEffect } from "@boxblack/core/flair/sounds"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { TimedGroup } from "@boxblack/core/highlights"
import type { Place } from "./insert-media.ts"

/** A join worth a sound: it skips at least this much of the source. */
const MIN_SKIP_US = 2_000_000
/** A closing sound lands this far before the end, so there is room for it to play. */
const TAIL_US = 500_000

export const anchorKey = (anchor: CueAnchor): string => JSON.stringify(anchor)

/**
 * How far a join may move and still be the same join: a cut preset pads the words by 80–250 ms,
 * and two joins of one beat are always more than 2 s of skipped source apart.
 */
const JOIN_DRIFT_US = 500_000

/**
 * Two anchors that name the same place: the same anchor, a join of the same beat the cut moved a
 * little, or the same moment of speech. A join or moment saved before they knew their beat may be
 * either beat's.
 */
export function samePlace(a: CueAnchor, b: CueAnchor): boolean {
  const sameBeat = (x: { beatId?: string }, y: { beatId?: string }) => x.beatId === undefined || y.beatId === undefined || x.beatId === y.beatId
  if (a.kind === "cut" && b.kind === "cut") return a.videoId === b.videoId && sameBeat(a, b) && Math.abs(a.sourceUs - b.sourceUs) <= JOIN_DRIFT_US
  // a moment of speech saved before it knew its beat is that moment in either beat
  if (a.kind === "speech" && b.kind === "speech") return a.videoId === b.videoId && sameBeat(a, b) && a.sourceUs === b.sourceUs
  return anchorKey(a) === anchorKey(b)
}

/** Where an item had a sound slot of its own, and the point it was made for: a sound goes with the item only when it is on both. */
export type SlotOf = { at: CueAnchor; pointId?: string }

/**
 * Where a zoom had a sound slot of its own when Claude picked CapCut sounds: a punch's piece start. A punch that lands on a line
 * of text shares that line's moment, where the line's slot takes it and keeps its sound; a drift has no slot.
 */
export const punchMoment = (zoom: ZoomCue): SlotOf | null =>
  zoom.kind === "punch"
    ? { at: { kind: "speech", videoId: zoom.anchor.videoId, sourceUs: zoom.anchor.sourceUs, ...(zoom.anchor.beatId !== undefined ? { beatId: zoom.anchor.beatId } : {}) }, pointId: zoom.pointId }
    : null

/** Where a cutaway or graphic had its sound slot: its own start, when that is a moment of speech (on a line, the line's slot takes it). */
export const startMoment = (item: { anchor: CueAnchor; pointId?: string }): SlotOf | null => (item.anchor.kind === "speech" ? { at: item.anchor, pointId: item.pointId } : null)

/**
 * The sounds once some of Claude's zooms, cutaways or graphics went: Claude's unedited sounds on the slot one
 * of those had — its moment, and its point — go with it, unless an item still there holds that moment. A
 * sound of another point that sits on the same moment (that point's own place) stays, and so do the user's
 * own sounds, wherever they are.
 */
export function withoutSoundsOn(cues: SoundCue[], gone: (SlotOf | null)[], held: (SlotOf | null)[]): SoundCue[] {
  const still = held.flatMap((slot) => (slot === null ? [] : [slot.at]))
  const slots = gone.filter((slot): slot is SlotOf => slot !== null && !still.some((kept) => samePlace(kept, slot.at)))
  return cues.filter((cue) => cue.edited || !slots.some((slot) => slot.pointId === cue.pointId && samePlace(slot.at, cue.anchor)))
}

/** Each slot the zooms, cutaways and graphics of a flair hold. */
export const heldMoments = (flair: { zooms?: ZoomCue[]; inserts?: { anchor: CueAnchor; pointId?: string }[]; graphics?: { anchor: CueAnchor; pointId?: string }[] }) => [
  ...(flair.zooms ?? []).map(punchMoment),
  ...(flair.inserts ?? []).map(startMoment),
  ...(flair.graphics ?? []).map(startMoment),
]

/** The place an anchor names on this rough cut: its own slot, or for a join, the nearest one the cut moved it to. */
export function slotFinder(slots: CueSlot[]): (anchor: CueAnchor) => CueSlot | undefined {
  const byKey = new Map(slots.map((slot) => [anchorKey(slot.anchor), slot]))
  const joins = slots.filter((slot) => slot.anchor.kind === "cut")
  return (anchor) => {
    const exact = byKey.get(anchorKey(anchor))
    if (exact || anchor.kind !== "cut") return exact
    const near = joins.filter((slot) => samePlace(slot.anchor, anchor))
    const distance = (slot: CueSlot) => Math.abs((slot.anchor as { sourceUs: number }).sourceUs - anchor.sourceUs)
    return near.sort((a, b) => distance(a) - distance(b))[0]
  }
}

const seconds = (us: number) => (us / 1e6).toFixed(1)

/**
 * Every place a sound effect can go on this rough cut: each line of highlight text (anchored to
 * the stored line it is, named by where it shows — the two differ when a line above it was cut), each join
 * inside a beat that really jumps (a trimmed filler is not a jump), and the start and end of each
 * beat that ends the video — an earlier beat's end is the next one's start. Two places at the same
 * moment are one slot, and the one that says most about the moment wins: the highlight text, then a
 * beat start, then the closing place, then a join.
 */
export function slotsFor(input: {
  plan: CutPlan
  groups: TimedGroup[]
  beatNames: Map<string, string>
  /** where a source time of a kept piece plays on the rough cut */
  at: (cut: number, sourceUs: number) => number
}): CueSlot[] {
  const found: { slot: CueSlot; rank: number }[] = []

  for (const group of input.groups) {
    group.lines.forEach((line, index) => {
      found.push({
        rank: 0,
        slot: { anchor: { kind: "highlight", groupId: group.groupId, line: line.lineIndex }, atUs: line.startUs, what: `ข้อความเด่น "${line.text}" บรรทัด ${index + 1}`, beatId: group.beatId },
      })
    })
  }

  // which beat each kept piece belongs to, in playing order
  const beatOf: string[] = []
  for (const beat of input.plan.beats) for (const _ of beat.pieces) beatOf.push(beat.beatId)

  input.plan.cuts.forEach((cut, index) => {
    const before = index > 0 ? input.plan.cuts[index - 1]! : null
    // a join between beats is the beat's own start, which says more about the moment and takes
    // that slot anyway; skipping it here also keeps the skip arithmetic inside one video
    if (!before || beatOf[index] !== beatOf[index - 1] || before.binId !== cut.binId) return
    const skipped = cut.sourceStartUs - (before.sourceStartUs + before.sourceDurationUs)
    if (skipped < MIN_SKIP_US) return
    found.push({
      rank: 3,
      slot: { anchor: { kind: "cut", videoId: cut.binId, sourceUs: cut.sourceStartUs, beatId: beatOf[index]! }, atUs: input.at(index, cut.sourceStartUs), what: `รอยตัด ข้ามไป ${seconds(skipped)} วิ`, beatId: beatOf[index]! },
    })
  })

  let piece = 0
  input.plan.beats.forEach((beat, index) => {
    const first = beat.pieces[0]
    const firstIndex = piece
    piece += beat.pieces.length
    if (!first) return
    const name = input.beatNames.get(beat.beatId) ?? beat.beatId
    const startUs = input.at(firstIndex, first.startUs)
    found.push({ rank: 1, slot: { anchor: { kind: "beat", beatId: beat.beatId, edge: "start" }, atUs: startUs, what: `ต้นช่วง "${name}"`, beatId: beat.beatId } })

    // only the last beat ends the video; every other beat's end is the next one's start. The
    // closing sound sits before the last frame, or it would have nowhere to play.
    const closing = input.plan.durationUs - TAIL_US
    if (index === input.plan.beats.length - 1 && closing > startUs) {
      found.push({ rank: 2, slot: { anchor: { kind: "beat", beatId: beat.beatId, edge: "end" }, atUs: closing, what: `ท้ายช่วง "${name}"`, beatId: beat.beatId } })
    }
  })

  const byTime = new Map<number, { slot: CueSlot; rank: number }>()
  for (const entry of found.sort((a, b) => a.rank - b.rank)) {
    if (!byTime.has(entry.slot.atUs)) byTime.set(entry.slot.atUs, entry)
  }
  return [...byTime.values()].map((entry) => entry.slot).sort((a, b) => a.atUs - b.atUs)
}

/**
 * The cues that will really play: the stored ones on a point the level lets through (or on none),
 * whose place is still on the rough cut and whose sound this machine still has and the user may use. The
 * rest are counted by why they are not playing, so the screen can say so; one whose sound needs CapCut Pro,
 * which the user does not have, is counted apart from one this machine does not have. The ones the level
 * holds back are neither. A cue held back for Pro stays stored and takes no place, so another there may play,
 * and is counted only when Pro would play it. With sound off there are none. A cue is placed by `place` with its point (itemPlaceOf), so a sound on a
 * moment of speech — a point's start, a graphic's or a cutaway's — plays where that moment does, or where
 * its point starts now when the cut took that moment out, and one on a join the cut moved plays on the join
 * it moved to.
 */
export function cuesInForce(input: {
  cues: SoundCue[]
  place: (anchor: CueAnchor, pointId?: string) => Place | null
  sounds: SoundEffect[]
  flair: FlairOptions
  durationUs: number
  passes: PointFilter
  /** a sound the user may not use: it needs CapCut Pro, which they do not have; none when not given */
  needsPro?: (effectId: string) => boolean
}): { kept: PlacedCue[]; unplaced: number; missing: number; pro: number } {
  if (!input.flair.sound) return { kept: [], unplaced: 0, missing: 0, pro: 0 }
  const sounds = new Map(input.sounds.map((sound) => [sound.effectId, sound]))
  const placed: PlacedCue[] = []
  // one sound a moment: two stored on one place (a join the cut moved onto another's) play as one, the user's first
  const filled = new Set<number>()
  // the moments a cue held back for Pro would take with Pro, each counted once
  const wanted = new Set<number>()
  let unplaced = 0
  let missing = 0
  let pro = 0
  for (const cue of [...input.cues].sort((a, b) => Number(b.edited) - Number(a.edited))) {
    if (!input.passes(cue.pointId)) continue
    const where = input.place(cue.anchor, cue.pointId)
    const sound = sounds.get(cue.effectId)
    if (!where) unplaced++
    else if (!sound) missing++
    else if (input.needsPro?.(sound.effectId)) {
      // on a moment another plays already, or one held back already wants, it would stay quiet with Pro too
      if (!filled.has(where.atUs) && !wanted.has(where.atUs)) {
        wanted.add(where.atUs)
        pro++
      }
    } else if (!filled.has(where.atUs)) {
      filled.add(where.atUs)
      placed.push({ cue, atUs: where.atUs, sound })
    }
  }
  return { kept: enforceCues(placed, input.durationUs).kept, unplaced, missing, pro }
}
