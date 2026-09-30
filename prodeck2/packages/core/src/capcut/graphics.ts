import { addOverlayTracks } from "./overlays.ts"
import { usToFrame } from "./time.ts"
import type { DraftInfo, Written } from "./types.ts"

/** A rendered graphic laid over the rough cut. */
export interface TimelineGraphic {
  atUs: number
  durationUs: number
  /** the bin item, which the material points at with `local_material_id` */
  binId: string
  path: string
  name: string
  width: number
  height: number
  /** the rendered file's own length */
  durationOfFileUs: number
  /** how CapCut draws it so it lands on its own pixels (graphics/framing.ts's placeOnCanvas) */
  place: { scale: number; x: number; y: number }
}

/** Above the cutaways (8 + track) and below the highlight text (14000 + track) and its bars (13000 + track). */
const RENDER_INDEX_BASE = 1000

/**
 * Adds the graphics on overlay video tracks above the rough cut and its cutaways. Pure. Each is
 * silent, plays from the start of its file, and is drawn at the size and place it was rendered
 * for. Edges land on frames, and one with no whole frame left is left out. Graphics that overlap
 * go on tracks of their own, newest on top (laneOf), so the later one is never hidden under the
 * earlier — all but one overlap: each piece of the rough cut goes to its nearest frame on its own,
 * so a graphic starting just after a cut can land a frame before the end of one that touched it.
 * A graphic still playing on only the frame a later one starts on therefore ends by that frame,
 * giving up the last frame of its way out rather than pushing the later one onto a track of its
 * own over one shared frame. Answers how many it placed and how many it left out.
 */
export function addGraphicTrack(info: DraftInfo, graphics: TimelineGraphic[]): Written {
  const fps = info.fps
  const lastFrame = usToFrame(info.duration, fps)

  const framed = [...graphics]
    .sort((a, b) => a.atUs - b.atUs)
    .map((graphic) => {
      const startFrame = usToFrame(graphic.atUs, fps)
      // a rendered file plays from its start, and only for the whole frames it has: rounding its end
      // up may step past the file
      const fileFrames = Math.floor((graphic.durationOfFileUs * fps) / 1_000_000)
      return { graphic, startFrame, endFrame: Math.min(usToFrame(graphic.atUs + graphic.durationUs, fps), lastFrame, startFrame + fileFrames) }
    })
  // from the last one back, so a graphic is cut short only by a later one that is really written
  const kept: typeof framed = []
  for (const entry of framed.reverse()) {
    // a later graphic that starts on this one's last frame: the overlap two touching pieces make
    const rounded = kept.some((later) => later.startFrame === entry.endFrame - 1)
    const endFrame = rounded ? entry.endFrame - 1 : entry.endFrame
    if (entry.startFrame < 0 || endFrame - entry.startFrame < 1) continue
    kept.unshift({ ...entry, endFrame })
  }
  const pieces = kept.map(({ graphic, startFrame, endFrame }) => ({
    startFrame,
    endFrame,
    file: { id: graphic.binId, path: graphic.path, name: graphic.name, durationUs: graphic.durationOfFileUs, width: graphic.width, height: graphic.height },
    // drawn at the size and place it was rendered for
    place: graphic.place,
  }))
  return { info: addOverlayTracks(info, pieces, RENDER_INDEX_BASE), kept: kept.length, dropped: graphics.length - kept.length }
}
