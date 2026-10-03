import { addBinItems, pruneBinItems } from "../capcut/bin.ts"
import { addComposedSoundTrack } from "../capcut/composed-sounds.ts"
import { addGraphicTrack } from "../capcut/graphics.ts"
import { addHighlightTracks } from "../capcut/highlights.ts"
import { addInsertTrack } from "../capcut/inserts.ts"
import { addMoves } from "../capcut/moves.ts"
import { buildRoughCut } from "../capcut/rough-cut.ts"
import { addSoundTrack } from "../capcut/sounds.ts"
import { addSubtitleTrack } from "../capcut/subtitles.ts"
import type { BinVideo, DraftInfo, DraftMeta, Written } from "../capcut/types.ts"
import { addZooms } from "../capcut/zoom.ts"
import { itemsOf, type AgentTimeline } from "./types.ts"

/** The kinds of piece whose writer says how many it placed and how many it left out. */
export type LaidKind = "moves" | "zooms" | "inserts" | "graphics" | "composed" | "sounds"

export interface TimelineWrite {
  info: DraftInfo
  /** brings the media bin in line with what the timeline plays, for writeDraft */
  bin: (meta: DraftMeta) => DraftMeta
  /** each writer's own count of what it placed and left out; a kind with no pieces ran no writer */
  laid: Partial<Record<LaidKind, { kept: number; dropped: number }>>
}

/**
 * Writes a timeline into a draft's timeline, every kind on its own tracks, in the order that keeps each above what it
 * should cover: the rough cut, the subtitles, the highlight text, the picture's moves and then the old zooms beside
 * them (a piece has one set of keyframes), the cutaways, the graphics, the composed sounds, and the sound effects
 * last. Pure: the subtitle group's id comes in, and the bin folders to prune are named, so the same timeline always
 * makes the same draft but for the writers' fresh ids.
 *
 * `prune` names BOXBLACK's own graphics and sounds folders when this timeline is the project's only one: the bin
 * then keeps, of the files in them, only those this timeline plays. Null when other timelines may still play older ones.
 */
export function writeTimeline(
  draftInfo: DraftInfo,
  bin: BinVideo[],
  timeline: AgentTimeline,
  options: { subtitleGroupId: string; prune: { graphicsDir?: string; soundsDir?: string } | null },
): TimelineWrite {
  let info = buildRoughCut(draftInfo, itemsOf(timeline.cuts), bin)
  if (timeline.subtitles) info = addSubtitleTrack(info, itemsOf(timeline.captions), options.subtitleGroupId)
  if (timeline.highlights) info = addHighlightTracks(info, itemsOf(timeline.highlights.groups), timeline.highlights.look)

  const laid: TimelineWrite["laid"] = {}
  const lay = (kind: LaidKind, result: Written) => {
    const { info: after, ...counts } = result
    info = after
    laid[kind] = counts
  }
  if (timeline.moves.length > 0) lay("moves", addMoves(info, itemsOf(timeline.moves)))
  if (timeline.zooms.length > 0) lay("zooms", addZooms(info, itemsOf(timeline.zooms)))
  if (timeline.inserts.length > 0) lay("inserts", addInsertTrack(info, itemsOf(timeline.inserts)))
  if (timeline.graphics.length > 0) lay("graphics", addGraphicTrack(info, itemsOf(timeline.graphics)))
  if (timeline.composed.length > 0) lay("composed", addComposedSoundTrack(info, itemsOf(timeline.composed)))
  if (timeline.sounds.length > 0) lay("sounds", addSoundTrack(info, itemsOf(timeline.sounds)))

  const prunes: [dir: string, keep: Set<string>][] = []
  if (options.prune?.graphicsDir) prunes.push([options.prune.graphicsDir, new Set(timeline.graphics.map((piece) => piece.item.binId))])
  if (options.prune?.soundsDir) prunes.push([options.prune.soundsDir, new Set(timeline.composed.map((piece) => piece.item.binId))])
  const binItems = timeline.binItems
  return {
    info,
    bin: (meta) => addBinItems(prunes.reduce((pruned, [dir, keep]) => pruneBinItems(pruned, dir, keep), meta), binItems),
    laid,
  }
}
