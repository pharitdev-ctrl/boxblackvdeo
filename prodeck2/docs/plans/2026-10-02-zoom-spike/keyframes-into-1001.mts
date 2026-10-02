// Spike for 0.8.0 (free zoom): writes test keyframes into the user's draft "1001 (1)" so the user can look in CapCut
// whether rotation, many keyframes in one piece, a pan, eased moves made of many straight steps, and keyframes on an
// overlay video all play as meant, and whether export asks for Pro. Run only with CapCut closed and after a backup.
//   node docs/plans/2026-10-02-zoom-spike/keyframes-into-1001.mts
import { join } from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { loadDraft, writeDraft } from "../../../packages/core/src/capcut/index.ts"

const FOLDER = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/1001 (1)")
const draft = await loadDraft(FOLDER)
const info = structuredClone(draft.info)

type Seg = { source_timerange?: { start: number }; speed?: number; clip?: { scale?: { x?: number }; transform?: { x?: number; y?: number }; rotation?: number }; common_keyframes?: unknown[] }
const point = (time: number, value: number) => ({
  id: randomUUID().toUpperCase(),
  curveType: "Line",
  time_offset: time,
  left_control: { x: 0, y: 0 },
  right_control: { x: 0, y: 0 },
  values: [value],
  string_value: "",
  graphID: "",
})
const track = (type: string, points: ReturnType<typeof point>[]) => ({ id: randomUUID().toUpperCase(), material_id: "", property_type: type, keyframe_list: points })

/** A pose at a moment of the piece: seconds from the piece's start, scale, shift in half-frames, and degrees. */
type Pose = { s: number; scale: number; x?: number; y?: number; rot?: number }

/** Smooth in and out between two poses, as many straight steps: the way an eased move is made without CapCut's curves. */
function eased(from: Pose, to: Pose, steps: number): Pose[] {
  const out: Pose[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    const mix = (a = 0, b = 0) => a + (b - a) * k
    out.push({ s: mix(from.s, to.s) + 0 * k, scale: mix(from.scale, to.scale), x: mix(from.x, to.x), y: mix(from.y, to.y), rot: mix(from.rot, to.rot) })
  }
  // the time goes on evenly; only the values ease
  return out.map((pose, i) => ({ ...pose, s: from.s + ((to.s - from.s) * (i + 1)) / steps }))
}

function keyframe(segment: Seg, poses: Pose[]): void {
  const speed = typeof segment.speed === "number" && segment.speed > 0 ? segment.speed : 1
  const start = segment.source_timerange?.start ?? 0
  const at = (s: number) => start + Math.round(s * 1_000_000 * speed)
  const base = segment.clip?.scale?.x ?? 1
  const bx = segment.clip?.transform?.x ?? 0
  const by = segment.clip?.transform?.y ?? 0
  const br = segment.clip?.rotation ?? 0
  segment.common_keyframes = [
    track("KFTypeScaleX", poses.map((p) => point(at(p.s), base * p.scale))),
    track("KFTypePositionX", poses.map((p) => point(at(p.s), bx + (p.x ?? 0) || 0))),
    track("KFTypePositionY", poses.map((p) => point(at(p.s), by + (p.y ?? 0) || 0))),
    track("KFTypeRotation", poses.map((p) => point(at(p.s), br + (p.rot ?? 0) || 0))),
  ]
}

const main = info.tracks[0]!.segments as Seg[]
const overlay = info.tracks[5]!.segments as Seg[]

// A (0:00-0:05) rotation: in to 115% while turning to +4 degrees, over to -4, back to straight
keyframe(main[0]!, [
  { s: 0, scale: 1, rot: 0 },
  { s: 1.2, scale: 1.15, rot: 4 },
  { s: 2.6, scale: 1.15, rot: -4 },
  { s: 4, scale: 1, rot: 0 },
])
// B (0:05-0:08.6) many moves in one piece: punch in, bounce back, harder punch, hold, out
keyframe(main[1]!, [
  { s: 0, scale: 1 },
  { s: 0.5, scale: 1 },
  { s: 0.7, scale: 1.2 },
  { s: 1.2, scale: 1 },
  { s: 2.0, scale: 1 },
  { s: 2.2, scale: 1.3 },
  { s: 2.9, scale: 1.3 },
  { s: 3.2, scale: 1 },
])
// C (0:08.6-0:12.4) pan at 125%: left to right, and the edges must never show
keyframe(main[2]!, [
  { s: 0, scale: 1.25, x: -0.2 },
  { s: 3.6, scale: 1.25, x: 0.2 },
])
// D (0:12.4-0:15.5) an eased push from 100% to 125% and back, made of straight steps (8 each way)
keyframe(main[3]!, [{ s: 0, scale: 1 }, ...eased({ s: 0, scale: 1 }, { s: 1.4, scale: 1.25 }, 8), ...eased({ s: 1.6, scale: 1.25 }, { s: 3, scale: 1 }, 8)])
// E (0:06.5-0:08.6, the graphic on the overlay track) keyframes on an overlay video: grows to 120% and back
keyframe(overlay[0]!, [
  { s: 0, scale: 1 },
  { s: 1, scale: 1.2 },
  { s: 2, scale: 1 },
])

await writeDraft(draft, info)
console.log("written: A rotation, B many moves, C pan, D eased push, E overlay keyframes")
