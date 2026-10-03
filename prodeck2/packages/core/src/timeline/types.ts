// The shared timeline of the agent editor (spec docs/specs/2026-10-03-agent-editor-design.md §4): every piece of a
// finished edit, at the times it plays, as the CapCut writers take it. Kept free of runtime dependencies.
import type { TimelineComposedSound } from "../capcut/composed-sounds.ts"
import type { TimelineGraphic } from "../capcut/graphics.ts"
import type { HighlightLook, TimelineHighlightGroup } from "../capcut/highlights.ts"
import type { TimelineInsert } from "../capcut/inserts.ts"
import type { TimelineMove } from "../capcut/moves.ts"
import type { TimelineSoundCue } from "../capcut/sounds.ts"
import type { TimelineCaption } from "../capcut/subtitles.ts"
import type { BinItem, Cut } from "../capcut/types.ts"
import type { TimelineZoom } from "../capcut/zoom.ts"

export const TIMELINE_VERSION = 1

/** Who put a piece there: the "ทำทั้งหมด" pipeline, Claude in the agent editor, or the user. */
export type PieceAuthor = "pipeline" | "claude" | "user"

/** One piece of the timeline: what its writer takes (`item`), with who made it and whether it may be changed. */
export interface Piece<K extends string, T> {
  /** stable across rebuilds of the same edit: the kind and its place among the pieces of that kind */
  id: string
  kind: K
  by: PieceAuthor
  /** a locked piece is the user's to change; Claude asks first */
  locked: boolean
  /** why it is there, in a line; empty when nothing was said */
  note: string
  item: T
}

export interface AgentTimeline {
  version: typeof TIMELINE_VERSION
  /** how the clip is decorated, from the outline; "" when it has none */
  direction: string
  /** the frame the rough cut plays at; null when nothing is kept */
  canvas: { width: number; height: number } | null
  /** the rough cut's length on frames, which every piece fits inside */
  durationUs: number
  /** the main track, in playing order */
  cuts: Piece<"cut", Cut>[]
  /** whether the edit has subtitles at all; the subtitle writer runs only when it does */
  subtitles: boolean
  captions: Piece<"caption", TimelineCaption>[]
  /** the highlight text drawn as text, with its look; null when none is drawn */
  highlights: { look: HighlightLook; groups: Piece<"highlight", TimelineHighlightGroup>[] } | null
  moves: Piece<"move", TimelineMove>[]
  /** the punches and drifts of before 0.8.0, on the pieces no move plays on */
  zooms: Piece<"zoom", TimelineZoom>[]
  inserts: Piece<"insert", TimelineInsert>[]
  graphics: Piece<"graphic", TimelineGraphic>[]
  composed: Piece<"composed", TimelineComposedSound>[]
  sounds: Piece<"sound", TimelineSoundCue>[]
  /** the media bin entries the graphics and composed sounds need */
  binItems: BinItem[]
}

/** The pipeline's pieces of one kind, with ids from their places. */
export function pipelinePieces<K extends string, T>(kind: K, items: T[], noteOf: (item: T) => string = () => ""): Piece<K, T>[] {
  return items.map((item, i) => ({ id: `${kind}-${i + 1}`, kind, by: "pipeline", locked: false, note: noteOf(item), item }))
}

/** The items of some pieces, in order: what their writer is given. */
export const itemsOf = <T>(pieces: Piece<string, T>[]): T[] => pieces.map((piece) => piece.item)
