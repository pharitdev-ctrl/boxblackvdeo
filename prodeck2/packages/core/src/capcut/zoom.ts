import type { ZoomKind } from "../flair/plan.ts"
import { newId } from "./templates.ts"
import type { DraftInfo, Segment, Written } from "./types.ts"

/** A zoom on one piece of the rough cut. */
export interface TimelineZoom {
  /** the piece's place in the rough cut, which is its segment's place on the video track */
  cut: number
  kind: ZoomKind
  /** where the punch lands inside the piece, in µs as it plays from the piece's start; a drift ignores it */
  atUs: number
  /** the piece's length as it plays (µs on the timeline) */
  durationUs: number
  /** the face's height in CapCut's transform units (+1 top, −1 bottom); 0 without a picture */
  faceY: number
}

/** How far a punch goes in. */
const PUNCH_SCALE = 1.15
/** How far a drift has gone by the end of its piece. */
const DRIFT_SCALE = 1.08
/** How long a punch takes to land. */
const PUNCH_US = 350_000

/** One point of a keyframed property, as CapCut 9.4 writes it (0815). */
export const point = (timeOffset: number, value: number) => ({
  id: newId(),
  curveType: "Line",
  time_offset: timeOffset,
  left_control: { x: 0, y: 0 },
  right_control: { x: 0, y: 0 },
  values: [value],
  string_value: "",
  graphID: "",
})

export const track = (propertyType: string, points: ReturnType<typeof point>[]) => ({
  id: newId(),
  material_id: "",
  property_type: propertyType,
  keyframe_list: points,
})

/**
 * Where the picture is at each moment of the zoom: the scale, and the shift that keeps the face
 * where it was while the picture grows around it.
 */
function framesOf(zoom: TimelineZoom): { at: number; scale: number }[] {
  if (zoom.kind === "drift") {
    return [
      { at: 0, scale: 1 },
      { at: zoom.durationUs, scale: DRIFT_SCALE },
    ]
  }
  // a punch that lands at the very start rises from the first frame
  const from = Math.max(0, Math.min(zoom.atUs, zoom.durationUs - PUNCH_US))
  const to = Math.min(from + PUNCH_US, zoom.durationUs)
  const frames = [{ at: from, scale: 1 }, { at: to, scale: PUNCH_SCALE }]
  return from > 0 ? [{ at: 0, scale: 1 }, ...frames] : frames
}

/**
 * Where a moment `atUs` into a piece is in the piece's source file: CapCut 9.5 times a video segment's
 * keyframes by its source, not by the segment's start (two exports of 0917, 2026-09-29: a punch written 3.145 s
 * into a piece whose file starts at 1.8 s landed 1.35 s into it, and pieces starting later in their file stayed
 * zoomed throughout). A piece played faster goes through its file faster.
 */
export function sourceTime(segment: Segment, atUs: number): number {
  const speed = typeof segment.speed === "number" && segment.speed > 0 ? segment.speed : 1
  return (segment.source_timerange?.start ?? 0) + Math.round(atUs * speed)
}

/**
 * Keyframes the video pieces so the picture moves. Pure. The zoom is on top of whatever size and
 * place the piece already has, and the face stays where it was: scaling the picture by z moves a
 * point on screen at `faceY` to `faceY × z`, so adding `faceY × (1 − z)` to the piece's own
 * transform holds it still. Since |faceY| ≤ 1 that shift never opens the frame's edge. Each keyframe
 * is timed in the piece's source file (`sourceTime`), which is how CapCut reads them. A zoom on a
 * piece that is not there, with no length, or on a piece already zoomed (a piece has one set of
 * keyframes, and a second would silently replace the first) is left out. Answers how many pieces it
 * zoomed and how many zooms it left out.
 */
export function addZooms(info: DraftInfo, zooms: TimelineZoom[]): Written {
  const out = structuredClone(info)
  const video = out.tracks.find((entry) => entry.type === "video")
  if (!video) return { info: out, kept: 0, dropped: zooms.length }

  // the pieces zoomed so far, by their place on the video track
  const zoomed = new Set<number>()
  for (const zoom of zooms) {
    const segment = video.segments[zoom.cut] as Segment | undefined
    if (!segment || zoom.durationUs <= 0 || zoomed.has(zoom.cut)) continue
    zoomed.add(zoom.cut)
    const frames = framesOf(zoom).map((frame) => ({ ...frame, at: sourceTime(segment, frame.at) }))
    const clip = segment.clip as { scale?: { x?: number }; transform?: { x?: number; y?: number } } | null
    const base = clip?.scale?.x ?? 1
    const baseX = clip?.transform?.x ?? 0
    const baseY = clip?.transform?.y ?? 0
    // `|| 0` so a still picture is written as 0, not JavaScript's negative zero
    const shift = (zoomScale: number) => baseY + zoom.faceY * (1 - zoomScale) || 0

    segment.common_keyframes = [
      track(
        "KFTypeScaleX",
        frames.map((frame) => point(frame.at, base * frame.scale)),
      ),
      track(
        "KFTypePositionX",
        frames.map((frame) => point(frame.at, baseX)),
      ),
      track(
        "KFTypePositionY",
        frames.map((frame) => point(frame.at, shift(frame.scale))),
      ),
    ]
    // the clip's own values are left as they are: every zoom starts where the piece already is,
    // so the first keyframe already says what the clip says, the way CapCut writes them
  }
  return { info: out, kept: zoomed.size, dropped: zooms.length - zoomed.size }
}
