import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { PlacedPoint, PointFilter } from "@boxblack/core/emphasis"
import type { ZoomSlot } from "@boxblack/core/flair/direct"
import { enforceZooms, type PieceAnchor, type PlacedZoom, type ZoomCue } from "@boxblack/core/flair/plan"
import type { TimedGroup } from "@boxblack/core/highlights"

/** A piece shorter than this has no room for a zoom at all; the rules say the rest. */
const MIN_PIECE_US = 1_500_000

export const pieceKey = (anchor: PieceAnchor): string => `${anchor.videoId}:${anchor.sourceUs}:${anchor.beatId ?? ""}`

/** Two anchors that name the same piece: the same footage in the same beat. A zoom saved before zooms knew their beat may be either beat's. */
export function samePiece(a: PieceAnchor, b: PieceAnchor): boolean {
  return a.videoId === b.videoId && a.sourceUs === b.sourceUs && (a.beatId === undefined || b.beatId === undefined || a.beatId === b.beatId)
}

/** A piece a zoom could go on, with its place among the rough cut's pieces for the writer. */
export type PieceSlot = ZoomSlot & { cut: number }

/**
 * The pieces of the rough cut a zoom could go on: every piece with room for one, with the beat it
 * belongs to and the highlight line a punch would land on.
 */
export function zoomSlotsFor(input: {
  plan: CutPlan
  groups: TimedGroup[]
  beatNames: Map<string, string>
  /** where a source time of a kept piece plays on the rough cut */
  at: (cut: number, sourceUs: number) => number
}): PieceSlot[] {
  const beatOf: string[] = []
  for (const beat of input.plan.beats) for (const _ of beat.pieces) beatOf.push(beat.beatId)

  return input.plan.cuts.flatMap((cut, index) => {
    if (cut.sourceDurationUs < MIN_PIECE_US) return []
    const atUs = input.at(index, cut.sourceStartUs)
    const endUs = atUs + cut.sourceDurationUs
    const name = input.beatNames.get(beatOf[index]!) ?? beatOf[index]
    const inside = input.groups.find((group) => group.lines[0]!.startUs >= atUs && group.lines[0]!.startUs < endUs)
    const what = inside ? `ช่วง "${name}" มีข้อความเด่น "${inside.lines[0]!.text}"` : `ช่วง "${name}"`
    return [{ anchor: { videoId: cut.binId, sourceUs: cut.sourceStartUs, beatId: beatOf[index]! }, atUs, durationUs: cut.sourceDurationUs, what, beatId: beatOf[index]!, cut: index }]
  })
}

/** The piece a point plays on, when it is long enough to zoom; null otherwise. */
export function pointPiece(slots: PieceSlot[], point: PlacedPoint): PieceSlot | null {
  return slots.find((slot) => slot.cut === point.cut) ?? null
}

/** Where inside its piece a punch lands: on the first highlight line there, else at the start. */
export function punchAtUs(slot: ZoomSlot, groups: TimedGroup[]): number {
  const inside = groups.find((group) => group.lines[0]!.startUs >= slot.atUs && group.lines[0]!.startUs < slot.atUs + slot.durationUs)
  return inside ? inside.lines[0]!.startUs - slot.atUs : 0
}

/**
 * The face's height in CapCut's transform units (+1 top, −1 bottom) for a piece: the middle of the
 * bands the picture must keep clear where that piece plays. No picture analysed, no face: 0, and
 * the zoom then moves around the middle of the frame.
 */
export function faceYOf(clips: CutClip[], anchor: PieceAnchor, durationUs: number): number {
  const scenes = clips.find((clip) => clip.id === anchor.videoId)?.insight?.scenes ?? []
  const to = anchor.sourceUs + durationUs
  const bands = scenes.flatMap((scene) => (scene.keepClear && scene.startUs <= to && scene.endUs >= anchor.sourceUs ? [scene.keepClear] : []))
  if (bands.length === 0) return 0
  const fromY = Math.min(...bands.map((band) => band.fromY))
  const toY = Math.max(...bands.map((band) => band.toY))
  return 1 - (fromY + toY)
}

/** The piece a zoom plays on: its own, or for one saved before zooms knew their beat, the last piece that plays its footage. */
export const pieceFinder =
  (slots: ZoomSlot[]) =>
  (anchor: PieceAnchor): ZoomSlot | undefined =>
    slots.findLast((slot) => samePiece(slot.anchor, anchor))

/**
 * The zooms that will really play: the stored ones the level lets through whose piece is still there,
 * through the rules, each named by its piece's own anchor. A zoom saved before zooms knew their beat
 * stays where it always played: on the last piece that plays its footage. `lost` counts the zooms whose
 * piece is not on the rough cut (the cut moved its start), `dropped` those the rules turned down; one on
 * an emphasis point the level hides is in neither.
 */
export function zoomsInForce(input: { zooms: ZoomCue[]; slots: ZoomSlot[]; flair: FlairOptions; durationUs: number; passes: PointFilter }): { kept: PlacedZoom[]; dropped: number; lost: number } {
  if (!input.flair.zoom) return { kept: [], dropped: 0, lost: 0 }
  const placed: PlacedZoom[] = []
  const pieceOf = pieceFinder(input.slots)
  let lost = 0
  for (const cue of input.zooms) {
    if (!input.passes(cue.pointId)) continue
    const slot = pieceOf(cue.anchor)
    if (!slot) {
      lost++
      continue
    }
    placed.push({ cue: { ...cue, anchor: slot.anchor }, atUs: slot.atUs, durationUs: slot.durationUs })
  }
  const { kept, dropped } = enforceZooms(placed, input.durationUs)
  return { kept, dropped, lost }
}
