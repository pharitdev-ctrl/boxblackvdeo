import type { MediaFit, SubjectBox } from "../flair/look-at.ts"
import { cardFraming, coverFraming } from "./framing.ts"
import { addOverlayTracks } from "./overlays.ts"
import { usToFrame } from "./time.ts"
import type { DraftInfo, Written } from "./types.ts"

/** A cutaway to a picture or clip from the project's bin. */
export interface TimelineInsert {
  atUs: number
  durationUs: number
  /** the bin item, which the material points at with `local_material_id` */
  binId: string
  path: string
  name: string
  kind: "photo" | "video"
  width: number
  height: number
  /** the file's own length; a photo's is nominal */
  durationOfFileUs: number
  /** over the whole frame, or as a card the speaker stays visible beside */
  fit: MediaFit
  /** where the subject sits inside the picture, for a cover that crops to it */
  subject?: SubjectBox | null
  /** the band of the video underneath that must stay clear, for a card to dodge */
  keepClear?: { fromY: number; toY: number } | null
}

export { coverScale } from "./framing.ts"

/** Just above the rough cut, and under the graphics (1000 + track) and the text. */
const RENDER_INDEX_BASE = 8

/**
 * Adds the cutaways on overlay video tracks above the rough cut. Pure. Each one is silent and
 * either covers the whole frame — cropped to its subject when Claude said where that is — or sits
 * as a card in the band the video underneath leaves clear; the text and the subtitles are written
 * on tracks above them. Edges land on frames, and a cutaway with no whole frame left is left out.
 * Cutaways that overlap go on tracks of their own, newest on top (laneOf), so the later one is
 * never hidden under the earlier; that also keeps apart two that only touched until each edge went
 * to its nearest frame, which one track would have overlapped by a frame. Answers how many it
 * placed and how many it left out.
 */
export function addInsertTrack(info: DraftInfo, inserts: TimelineInsert[]): Written {
  const fps = info.fps
  const lastFrame = usToFrame(info.duration, fps)
  const canvas = { width: info.canvas_config.width, height: info.canvas_config.height }

  const framed = [...inserts]
    .sort((a, b) => a.atUs - b.atUs)
    .map((insert) => {
      const startFrame = usToFrame(insert.atUs, fps)
      // a clip plays from its start, and only for the whole frames it has: rounding its end up may step past the file
      const fileFrames = insert.kind === "video" ? Math.floor((insert.durationOfFileUs * fps) / 1_000_000) : Infinity
      return { insert, startFrame, endFrame: Math.min(usToFrame(insert.atUs + insert.durationUs, fps), lastFrame, startFrame + fileFrames) }
    })
  const kept = framed.filter((entry) => entry.startFrame >= 0 && entry.endFrame - entry.startFrame >= 1)
  const pieces = kept.map(({ insert, startFrame, endFrame }) => ({
    startFrame,
    endFrame,
    file: { id: insert.binId, path: insert.path, name: insert.name, durationUs: insert.durationOfFileUs, width: insert.width, height: insert.height },
    // a photo is written as a photo, a clip as a video
    type: insert.kind,
    place: insert.fit === "card" ? cardFraming(insert, canvas, insert.keepClear ?? null) : coverFraming(insert, canvas, insert.subject ?? null),
  }))
  return { info: addOverlayTracks(info, pieces, RENDER_INDEX_BASE), kept: kept.length, dropped: inserts.length - kept.length }
}
