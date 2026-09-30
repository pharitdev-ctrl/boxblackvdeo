/**
 * Only the parts of CapCut's undocumented draft format that BOXBLACK reads or
 * writes are typed. Everything else rides along in the index signatures and must
 * be written back untouched — CapCut adds fields between releases.
 */

/** Microseconds. */
export interface TimeRange {
  start: number
  duration: number
}

/**
 * One point of a keyframed property: its value at `time_offset` µs into a video segment's source file —
 * CapCut times a video segment's keyframes by its source, not by the segment's start.
 */
export interface KeyframePoint {
  id: string
  curveType: string
  time_offset: number
  values: number[]
  [key: string]: unknown
}

/** A property CapCut animates over a segment, such as `KFTypeScaleX` or `KFTypePositionY`. */
export interface Keyframes {
  id: string
  material_id: string
  property_type: string
  keyframe_list: KeyframePoint[]
}

export interface Segment {
  id: string
  material_id: string
  extra_material_refs: string[]
  /** null on text segments, which have no source file */
  source_timerange: TimeRange | null
  target_timerange: TimeRange
  /** what moves over the segment; empty on a segment that just plays */
  common_keyframes?: Keyframes[]
  [key: string]: unknown
}

export interface Track {
  id: string
  type: string
  segments: Segment[]
  [key: string]: unknown
}

export interface DraftInfo {
  id: string
  duration: number
  fps: number
  canvas_config: { ratio: string; width: number; height: number; [key: string]: unknown }
  tracks: Track[]
  materials: Record<string, unknown>
  keyframes: Record<string, unknown>
  platform?: { app_version?: string; [key: string]: unknown }
  last_modified_platform?: { app_version?: string; [key: string]: unknown }
  [key: string]: unknown
}

/** One file in the project's media bin (draft_meta_info.json → draft_materials[].value[]). */
export interface BinItem {
  id: string
  file_Path: string
  metetype: string
  duration: number
  width: number
  height: number
  [key: string]: unknown
}

export interface DraftMeta {
  draft_id: string
  draft_name: string
  draft_materials: { type: number; value: BinItem[] }[]
  tm_duration: number
  tm_draft_modified: number
  [key: string]: unknown
}

export interface RootMetaEntry {
  draft_name: string
  draft_fold_path: string
  draft_is_invisible?: boolean
  tm_duration: number
  tm_draft_modified: number
  [key: string]: unknown
}

export interface RootMeta {
  all_draft_store: RootMetaEntry[]
  [key: string]: unknown
}

export interface Draft {
  /** The drafts folder that holds root_meta_info.json. */
  root: string
  folder: string
  name: string
  mainTimelineId: string
  capcutVersion: string
  info: DraftInfo
  meta: DraftMeta
}

export interface BinVideo {
  /** The bin item id; the timeline material points back to it via local_material_id. */
  id: string
  path: string
  name: string
  durationUs: number
  width: number
  height: number
}

/** One piece of the rough cut, in source-file coordinates. */
export interface Cut {
  binId: string
  sourceStartUs: number
  sourceDurationUs: number
}

/**
 * What a writer laid on the timeline: the draft info after it, how many items it placed, and how
 * many it left out — one with less than a frame to play, or one that starts before the rough cut
 * does. The zoom writer's are only a safety net (a piece not there, no length, or a second zoom on a
 * piece already zoomed): the app hands it zooms on the cut's own pieces, one a piece, and counts the
 * zooms whose piece is gone itself (`zoomsLost`).
 */
export interface Written {
  info: DraftInfo
  kept: number
  dropped: number
}
