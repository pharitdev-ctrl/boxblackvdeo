import { newId, segmentExtras, videoMaterial, videoSegment, videoTrack } from "./templates.ts"
import { frameToUs, usToFrame } from "./time.ts"
import type { BinVideo, Cut, DraftInfo, Segment } from "./types.ts"

function emptyArrays(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Array.isArray(value) ? [] : value]))
}

/**
 * Replaces the whole timeline with the cuts laid end to end on one video track.
 * Pure: returns a new DraftInfo and leaves every field it does not own as it was.
 *
 * All arithmetic is done in whole frames and converted back at the edges, which
 * reproduces CapCut's own rounding (source 766666+1833334, target 0+1833333 for
 * frames 23..78 @30fps) and keeps target ranges gap-free.
 */
export function buildRoughCut(info: DraftInfo, cuts: Cut[], bin: BinVideo[]): DraftInfo {
  if (cuts.length === 0) throw new Error("no cuts to write")
  const fps = info.fps
  const clips = new Map(bin.map((clip) => [clip.id, clip]))

  const out = structuredClone(info)
  const materials = emptyArrays(out.materials)
  const add = (key: string, entry: unknown) => {
    const list = materials[key]
    if (Array.isArray(list)) list.push(entry)
    else materials[key] = [entry]
  }

  const segments: Segment[] = []
  let cursor = 0

  for (const cut of cuts) {
    const clip = clips.get(cut.binId)
    if (!clip) throw new Error(`cut points at "${cut.binId}", which is not a video in the media bin`)
    const endUs = cut.sourceStartUs + cut.sourceDurationUs
    if (endUs > clip.durationUs) {
      throw new Error(`cut on ${clip.name} ends at ${endUs} µs, past the end of the file (${clip.durationUs} µs)`)
    }
    const startFrame = usToFrame(cut.sourceStartUs, fps)
    // rounding up to the nearest frame may step past a file that does not end on a frame
    const endFrame = Math.min(usToFrame(endUs, fps), Math.floor((clip.durationUs * fps) / 1_000_000))
    const frames = endFrame - startFrame
    if (frames < 1) throw new Error(`cut on ${clip.name} at ${cut.sourceStartUs} µs is shorter than one frame`)

    // one material per segment, never shared: CapCut re-saves a shared one as duplicate entries with one id
    const materialId = newId()
    add("videos", videoMaterial(materialId, clip))

    const extras = segmentExtras()
    for (const [key, entry] of extras) add(key, entry)

    segments.push(
      videoSegment({
        id: newId(),
        materialId,
        extraRefs: extras.map(([, entry]) => entry.id),
        source: { start: frameToUs(startFrame, fps), duration: frameToUs(endFrame, fps) - frameToUs(startFrame, fps) },
        target: { start: frameToUs(cursor, fps), duration: frameToUs(cursor + frames, fps) - frameToUs(cursor, fps) },
      }),
    )
    cursor += frames
  }

  out.materials = materials
  out.keyframes = emptyArrays(out.keyframes)
  out.tracks = [videoTrack(newId(), segments)]
  out.duration = frameToUs(cursor, fps)
  if (Array.isArray(out.relationships)) out.relationships = []
  if ("group_container" in out) out.group_container = null

  out.canvas_config = { ...out.canvas_config, ...outputCanvas(out, clips.get(cuts[0]!.binId)!) }
  return out
}

/** The size the rough cut plays at: an "original" ratio canvas follows the first clip. */
export function outputCanvas(info: DraftInfo, first: BinVideo): { width: number; height: number } {
  return info.canvas_config.ratio === "original"
    ? { width: first.width, height: first.height }
    : { width: info.canvas_config.width, height: info.canvas_config.height }
}
