import type { ComposedSoundView, CutPlan, CueView, EmphasisPointView, GraphicView, HighlightGroupView, HighlightPreview, InsertView, MoveView, ZoomView } from "../../../shared/api.ts"

/** Everything the post page shows for one beat, or for the whole clip. */
export interface BeatFlair {
  groups: HighlightGroupView[]
  cues: CueView[]
  /** the sounds Claude composed */
  composed: ComposedSoundView[]
  inserts: InsertView[]
  /** the punches and drifts of before 0.8.0 that play */
  zooms: ZoomView[]
  /** Claude's moves of the picture, the switched-off ones among them */
  moves: MoveView[]
  graphics: GraphicView[]
  /** the emphasis points placed in it */
  points: EmphasisPointView[]
  counts: { text: number; sound: number; zoom: number; insert: number; graphic: number; emphasis: number }
}

/** A beat, or a clip, that carries nothing: its lists are its own to fill. */
export const emptyFlair = (): BeatFlair => ({
  groups: [],
  cues: [],
  composed: [],
  inserts: [],
  zooms: [],
  moves: [],
  graphics: [],
  points: [],
  counts: { text: 0, sound: 0, zoom: 0, insert: 0, graphic: 0, emphasis: 0 },
})

const byTime = <T extends { atUs: number }>(items: T[]): T[] => [...items].sort((a, b) => a.atUs - b.atUs)

/** The lists in playing order, and what they count. */
const settled = (flair: BeatFlair): BeatFlair => ({
  groups: [...flair.groups].sort((a, b) => a.startUs - b.startUs),
  cues: byTime(flair.cues),
  composed: byTime(flair.composed),
  inserts: byTime(flair.inserts),
  zooms: byTime(flair.zooms),
  moves: byTime(flair.moves),
  graphics: byTime(flair.graphics),
  points: byTime(flair.points),
  counts: {
    // the text that is drawn: a group a graphic takes the place of is listed so it can be changed, and is not counted
    text: flair.groups.filter((group) => !group.replaced).length,
    // the rows the sound tab lists that play: the user's own CapCut sounds, and the composed ones that are on, as the
    // graphics are counted. Claude's CapCut sounds from before 0.6.0 still play, but are not listed
    sound: flair.cues.filter((cue) => cue.edited).length + flair.composed.filter((sound) => !sound.off).length,
    // the moves that play and the legacy zooms in force: one switched off is listed so it can be switched back on, and is not counted
    zoom: flair.moves.filter((move) => !move.off).length + flair.zooms.length,
    insert: flair.inserts.length,
    // every graphic that is on is counted, written or not: it is the number of rows listed that are on, and the write
    // sheet says how many of them a write leaves out. One switched off is listed so it can be switched back on, and is not counted
    graphic: flair.graphics.filter((graphic) => !graphic.off).length,
    // a point the level holds back is listed so it can be changed, but nothing plays on it
    emphasis: flair.points.filter((point) => point.shown).length,
  },
})

/** Puts every item of the preview where `into` says its beat is. */
function pour(preview: HighlightPreview, into: (beatId: string) => BeatFlair): void {
  for (const group of preview.groups) into(group.beatId).groups.push(group)
  for (const cue of preview.cues) into(cue.beatId).cues.push(cue)
  for (const sound of preview.composed) into(sound.beatId).composed.push(sound)
  for (const insert of preview.inserts) into(insert.beatId).inserts.push(insert)
  for (const zoom of preview.zooms) into(zoom.beatId).zooms.push(zoom)
  for (const move of preview.moves) into(move.beatId).moves.push(move)
  for (const graphic of preview.graphics) into(graphic.beatId).graphics.push(graphic)
  for (const point of preview.emphasis.points) into(point.beatId).points.push(point)
}

/**
 * Sorts a preview's flat lists into the beats of the plan, in time order inside each: the one rule for
 * which beat anything, a point included, belongs to. Anything whose beat is not on the rough cut lands in
 * the last beat rather than disappearing — it is still on the timeline somewhere, and the user has to be
 * able to reach it.
 */
export function byBeat(preview: HighlightPreview, plan: CutPlan): Map<string, BeatFlair> {
  const beats = new Map<string, BeatFlair>()
  for (const beat of plan.beats) beats.set(beat.beatId, emptyFlair())
  if (beats.size === 0) return beats

  const last = beats.get(plan.beats.at(-1)!.beatId)!
  pour(preview, (beatId) => beats.get(beatId) ?? last)
  for (const [beatId, flair] of beats) beats.set(beatId, settled(flair))
  return beats
}

/** Everything the preview holds, as one list for the whole clip, in playing order. */
export function wholeClip(preview: HighlightPreview): BeatFlair {
  const all = emptyFlair()
  pour(preview, () => all)
  return settled(all)
}
