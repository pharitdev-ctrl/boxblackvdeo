import { laneOf } from "./lanes.ts"
import { newId, segmentExtras, videoMaterial, videoSegment } from "./templates.ts"
import { frameToUs } from "./time.ts"
import type { BinVideo, DraftInfo, Segment, Track } from "./types.ts"

/** A picture to lay over the rough cut, already on its frames. */
export interface OverlayPiece {
  startFrame: number
  endFrame: number
  /** the file; its id is the bin item's, which the material points at with `local_material_id` */
  file: BinVideo
  /** what the material calls the file; a plain video when not given */
  type?: "photo" | "video"
  /** the size it is drawn at and where, in CapCut's units */
  place: { scale: number; x: number; y: number }
}

/**
 * Lays pictures over the rough cut on overlay video tracks above the tracks `info` has, and answers
 * the draft info after. Pure. Each piece is silent and plays from the start of its file. Pieces
 * that overlap go on tracks of their own, newest on top (laneOf): lane n becomes the n-th new track,
 * and each lane's track draws above the one below it, from `renderBase` on. The pieces come in
 * start order, each at least one frame long: a lane's segments go on its track in the order given,
 * and a piece with no frame would be a segment of no length. The cutaways and the graphics are both
 * laid this way; each writer says which pieces play, where, and from which base.
 */
export function addOverlayTracks(info: DraftInfo, pieces: OverlayPiece[], renderBase: number): DraftInfo {
  const fps = info.fps
  const out = structuredClone(info)
  if (pieces.length === 0) return out
  const materials: unknown[] = []
  const extrasByKey = new Map<string, unknown[]>()
  const lanes = laneOf(pieces)
  // each lane's segments, in the order the pieces came; lane n becomes the n-th new track
  const tracks: Segment[][] = []

  for (const [i, piece] of pieces.entries()) {
    const lane = lanes[i]!
    const trackIndex = out.tracks.length + lane
    const start = frameToUs(piece.startFrame, fps)
    const duration = frameToUs(piece.endFrame, fps) - start
    const materialId = newId()
    const material = videoMaterial(materialId, piece.file)
    // an overlay is silent: a photo has no sound, and a clip's or a graphic's own would talk over the speaker
    materials.push({ ...material, type: piece.type ?? material.type, has_audio: false })

    const extras = segmentExtras()
    for (const [key, entry] of extras) extrasByKey.set(key, [...(extrasByKey.get(key) ?? []), entry])
    const segment = videoSegment({
      id: newId(),
      materialId,
      extraRefs: extras.map(([, entry]) => entry.id),
      source: { start: 0, duration },
      target: { start, duration },
    })
    const onLane = (tracks[lane] ??= [])
    onLane.push({
      ...segment,
      volume: 0,
      last_nonzero_volume: 1,
      clip: { ...(segment.clip as object), scale: { x: piece.place.scale, y: piece.place.scale }, transform: { x: piece.place.x, y: piece.place.y } },
      // a higher track draws over a lower one: each lane's track above the last, all under the text
      render_index: renderBase + trackIndex,
      track_render_index: trackIndex,
    })
  }

  const existing = (key: string) => (Array.isArray(out.materials[key]) ? (out.materials[key] as unknown[]) : [])
  const merged: Record<string, unknown> = { ...out.materials, videos: [...existing("videos"), ...materials] }
  for (const [key, entries] of extrasByKey) merged[key] = [...existing(key), ...entries]
  out.materials = merged

  // overlay tracks, lowest lane first: `flag: 2` is what CapCut writes for a picture laid over the main one
  const overlays: Track[] = tracks.map((segments) => ({ id: newId(), type: "video", flag: 2, attribute: 0, name: "", is_default_name: true, segments }))
  out.tracks = [...out.tracks, ...overlays]
  return out
}
