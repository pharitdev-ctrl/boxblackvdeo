import { steps, type Look, type Pose } from "../flair/moves.ts"
import type { DraftInfo, Keyframes, Segment, Written } from "./types.ts"
import { point, sourceTime, track } from "./zoom.ts"

/** A move on one piece of the rough cut. */
export interface TimelineMove {
  /** the piece's place in the rough cut, which is its segment's place on the video track */
  cut: number
  /** where the move starts, in µs as the piece plays from its start */
  startUs: number
  poses: Pose[]
}

/** How the picture sits before any move: as the piece already is. */
const IDENTITY: Look = { scale: 1, x: 0, y: 0, rot: 0 }

/** A cut that opens a move jumps this long after its start, as `steps` writes a cut inside one. */
const CUT_US = 1_000

/** One point of a piece's keyframes: how the picture sits `us` µs into the piece as it plays. */
interface MovePoint {
  us: number
  look: Look
}

const sameLook = (a: Look, b: Look) => a.scale === b.scale && a.x === b.x && a.y === b.y && a.rot === b.rot

const pointsOf = (poses: Pose[], startUs: number): MovePoint[] =>
  steps(poses).map((step) => ({ us: startUs + Math.round(step.s * 1_000_000), look: step }))

/**
 * The four tracks CapCut is given for a list of points, on top of the segment's own framing: its
 * scale times the pose's, its place plus the pose's shift, and its turn plus the pose's. Each point
 * is timed in the segment's source file (`sourceTime`) and runs straight to the next. `|| 0` so a
 * still value is written as 0, not JavaScript's negative zero.
 */
function keyframesOf(segment: Segment, points: MovePoint[], base: Look): Keyframes[] {
  const at = points.map((entry) => sourceTime(segment, entry.us))
  const along = (property: string, value: (look: Look) => number) =>
    track(
      property,
      points.map((entry, i) => point(at[i]!, value(entry.look))),
    )
  return [
    along("KFTypeScaleX", (look) => base.scale * look.scale),
    along("KFTypePositionX", (look) => base.x + look.x || 0),
    along("KFTypePositionY", (look) => base.y + look.y || 0),
    along("KFTypeRotation", (look) => base.rot + look.rot || 0),
  ]
}

/** A segment's own framing, which the moves go on top of. */
function baseOf(segment: Segment): Look {
  const clip = segment.clip as { scale?: { x?: number }; transform?: { x?: number; y?: number }; rotation?: number } | null
  return { scale: clip?.scale?.x ?? 1, x: clip?.transform?.x ?? 0, y: clip?.transform?.y ?? 0, rot: clip?.rotation ?? 0 }
}

/**
 * The keyframes of one move laid on a segment from its first frame, over `base`: how a cutaway is
 * moved, on top of its framing.
 */
export function poseKeyframes(segment: Segment, poses: Pose[], base: Look): Keyframes[] {
  return keyframesOf(segment, pointsOf(poses, 0), base)
}

/**
 * Keyframes the video pieces with Claude's moves. Pure. The moves of one piece are merged into one
 * list in start order: before the first the picture rests as it is, from time 0; each later move
 * starts from the pose held when it begins (the last point of the move before), and its first
 * stretch runs from that pose, so a move never jumps unless its first pose is a cut, which jumps a
 * millisecond after its start. A move that starts before the one before it has finished, or at the
 * same moment, is a placement mistake and is left out, as is a
 * move on a piece that is not there or with no poses. The moves go on top of the piece's own size,
 * place and turn, and each keyframe is timed in the piece's source file, as `addZooms` does; only
 * the first video track is moved, and this runs before the overlays are added. A piece has one set
 * of keyframes, so the legacy zooms of a moved piece are taken out beforehand (`zoomsBesideMoves`).
 * Points past the piece's end are written as they are: main cuts each move at its piece's end before it gets here.
 * Answers how many moves it wrote and how many it left out.
 */
export function addMoves(info: DraftInfo, moves: TimelineMove[]): Written {
  const out = structuredClone(info)
  const video = out.tracks.find((entry) => entry.type === "video")
  if (!video) return { info: out, kept: 0, dropped: moves.length }

  // the moves of each piece, in start order
  const byPiece = new Map<number, TimelineMove[]>()
  let dropped = 0
  for (const move of moves) {
    if (!video.segments[move.cut] || move.poses.length === 0) {
      dropped++
      continue
    }
    byPiece.set(move.cut, [...(byPiece.get(move.cut) ?? []), move])
  }

  let kept = 0
  for (const [cut, list] of byPiece) {
    const segment = video.segments[cut]!
    const points: MovePoint[] = []
    // each point comes after the one before: one that would land on or before it is the same pose
    // again and is skipped, or a jump of its own, put a millisecond later so it is not lost
    const add = (entry: MovePoint) => {
      const last = points.at(-1)
      if (!last || entry.us > last.us) points.push(entry)
      else if (!sameLook(entry.look, last.look)) points.push({ ...entry, us: last.us + CUT_US })
    }
    let previousStartUs: number | null = null
    for (const move of [...list].sort((a, b) => a.startUs - b.startUs)) {
      const last = points.at(-1)
      if (move.startUs < (last?.us ?? 0) || move.startUs === previousStartUs) {
        dropped++
        continue
      }
      previousStartUs = move.startUs
      const first = move.poses[0]!
      if (move.startUs > 0 || last) {
        const held = last?.look ?? IDENTITY
        if (!last) add({ us: 0, look: IDENTITY })
        add({ us: move.startUs, look: held })
        if (first.ease === "cut") {
          add({ us: move.startUs + CUT_US, look: first })
          for (const entry of pointsOf(move.poses, move.startUs)) add(entry)
        } else {
          // the move's first stretch runs from the held pose, so an eased start never snaps to its own first pose
          const poses = [{ ...first, scale: held.scale, x: held.x, y: held.y, rot: held.rot }, ...move.poses.slice(1)]
          for (const entry of pointsOf(poses, move.startUs)) add(entry)
        }
      } else {
        for (const entry of pointsOf(move.poses, move.startUs)) add(entry)
      }
      kept++
    }
    if (points.length > 0) segment.common_keyframes = keyframesOf(segment, points, baseOf(segment))
  }
  return { info: out, kept, dropped }
}

/**
 * The legacy zooms on pieces that carry no move, and how many were left out because the moves win.
 * A move with no poses is not written, so it takes no piece from a zoom.
 */
export function zoomsBesideMoves<Z extends { cut: number }>(zooms: Z[], moves: { cut: number; poses?: unknown[] }[]): { zooms: Z[]; dropped: number } {
  const moved = new Set(moves.filter((move) => move.poses === undefined || move.poses.length > 0).map((move) => move.cut))
  const beside = zooms.filter((zoom) => !moved.has(zoom.cut))
  return { zooms: beside, dropped: zooms.length - beside.length }
}
