// The picture's own moves: Claude's poses over time, sampled, turned into straight steps for CapCut,
// and checked against the frame. Pure geometry, so the renderer and main can both use it.

import type { Box as PixelSize, Framing } from "../capcut/framing.ts"
import { FLAIR_LEVELS, type FlairLevel } from "./catalogue.ts"
import type { SubjectBox } from "./look-at.ts"
import type { CueAnchor } from "./plan.ts"

export const EASES = ["line", "in", "out", "inOut", "cut"] as const
export type Ease = (typeof EASES)[number]

/** A pose `s` seconds after the move's start: scale (1 = as is), shift in half-frames (CapCut's units), degrees, and how it is reached from the pose before. */
export interface Pose {
  s: number
  scale: number
  x: number
  y: number
  rot: number
  ease: Ease
}

export interface MoveCue {
  /** a spoken word (speech anchor), or a cutaway's start with `insert: true` */
  anchor: CueAnchor
  insert?: boolean
  from: FlairLevel
  pointId?: string
  /** Claude's one line in Thai on what the move does */
  about: string
  poses: Pose[]
  edited: boolean
  off: boolean
  instruction?: string
  editFailed?: string
  previous?: { poses: Pose[]; about: string; instruction?: string }
}

export const MOVE_POSES_MAX = 12
export const ROT_MAX = 5
export const SCALE_CAP_1080 = 1.3
export const SCALE_CAP_MAX = 1.5
/** Straight steps per eased segment when written for CapCut. */
export const EASE_STEPS = 8

/** One point of a move as CapCut is given it: no ease, since CapCut runs straight from point to point. */
export interface PoseStep {
  s: number
  scale: number
  x: number
  y: number
  rot: number
}

/** How the picture sits at one moment, whatever the time. */
export type Look = Pick<Pose, "scale" | "x" | "y" | "rot">

/** A box in shares of a picture or of the frame, from the top-left: a face, a shown thing, a card. */
export type ShareBox = SubjectBox

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

function isPose(value: unknown): value is Pose {
  if (!isObject(value)) return false
  const numbers = isNumber(value.s) && isNumber(value.scale) && isNumber(value.x) && isNumber(value.y) && isNumber(value.rot)
  return numbers && (EASES as readonly unknown[]).includes(value.ease)
}

const arePoses = (value: unknown): value is Pose[] => Array.isArray(value) && value.length > 0 && value.every(isPose)

/** The move kept for undo, when there is one, has to be playable too. */
const isPrevious = (value: unknown) => value === undefined || (isObject(value) && arePoses(value.poses) && typeof value.about === "string")

/** Whether a stored value is a move the app can play. */
export const isMove = (value: unknown): value is MoveCue =>
  isObject(value) &&
  isObject(value.anchor) &&
  (FLAIR_LEVELS as readonly unknown[]).includes(value.from) &&
  typeof value.about === "string" &&
  arePoses(value.poses) &&
  typeof value.edited === "boolean" &&
  typeof value.off === "boolean" &&
  isPrevious(value.previous)

/** How far along the way to the next pose the picture is, `t` of the time in. */
function mixOf(ease: Ease, t: number): number {
  switch (ease) {
    case "line":
      return t
    case "in":
      return t * t
    case "out":
      return 1 - (1 - t) * (1 - t)
    case "inOut":
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    case "cut":
      return t > 0 ? 1 : 0
  }
}

const stepOf = (pose: Look, s: number): PoseStep => ({ s, scale: pose.scale, x: pose.x, y: pose.y, rot: pose.rot })

/**
 * The pose `s` seconds into a move. Before its first pose the picture is at that pose, after its
 * last it holds it, and in between the later pose's ease shapes the way there.
 */
export function poseAt(poses: Pose[], s: number): PoseStep {
  const first = poses[0]
  if (!first) return { s, scale: 1, x: 0, y: 0, rot: 0 }
  if (s <= first.s) return stepOf(first, s)
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1]!
    const b = poses[i]!
    if (s > b.s) continue
    const mix = mixOf(b.ease, b.s > a.s ? (s - a.s) / (b.s - a.s) : 1)
    const between = (from: number, to: number) => from + (to - from) * mix
    return { s, scale: between(a.scale, b.scale), x: between(a.x, b.x), y: between(a.y, b.y), rot: between(a.rot, b.rot) }
  }
  return stepOf(poses[poses.length - 1]!, s)
}

/** A cut is written as a jump this long after the pose before, since CapCut only runs straight between points. */
const CUT_S = 0.001

/**
 * The points CapCut is given for a move, starting at its first pose: a straight segment is its end
 * alone, an eased one is cut into EASE_STEPS straight steps that follow the ease, and a cut holds
 * the pose before until a millisecond after it, then jumps.
 */
export function steps(poses: Pose[]): PoseStep[] {
  const first = poses[0]
  if (!first) return []
  const points = [stepOf(first, first.s)]
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1]!
    const b = poses[i]!
    if (b.ease === "cut") {
      // two poses closer than the jump itself are just the jump
      if (b.s - a.s > CUT_S) points.push(stepOf(b, a.s + CUT_S))
    } else if (b.ease !== "line") {
      for (let k = 1; k < EASE_STEPS; k++) points.push(poseAt(poses.slice(i - 1, i + 1), a.s + ((b.s - a.s) * k) / EASE_STEPS))
    }
    points.push(stepOf(b, b.s))
  }
  return points
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * How far a video may be pushed in before it looks soft. CapCut already enlarges a video that is
 * smaller than the canvas, which uses up some of the room; a video of 4K or more gets the higher cap.
 */
export function zoomCap(video: { width: number; height: number }, canvas: { width: number; height: number }): number {
  if (video.width <= 0 || video.height <= 0) return 1
  const fit = Math.max(canvas.width / video.width, canvas.height / video.height)
  const sharp = Math.min(video.width, video.height) >= 2160 ? SCALE_CAP_MAX / SCALE_CAP_1080 : 1
  return clamp((SCALE_CAP_1080 / fit) * sharp, 1, SCALE_CAP_MAX)
}

/** Room for the rounding of numbers that sit exactly on an edge. */
const EPSILON = 1e-9

/**
 * Where the picture is at a pose, in pixels from the canvas's middle with y up, as CapCut draws it:
 * its on-screen size at the base framing times the pose's scale, turned about its own middle, with
 * that middle at the base's place plus the pose's shift. With no base the picture exactly covers the
 * canvas, as a main piece of the canvas's own shape does.
 *
 * Positive degrees turn clockwise on screen. That sense has not been checked against CapCut; every
 * check here holds the same both ways, so it does not change what passes.
 */
function placeOf(look: Look, canvas: PixelSize, base?: Framing) {
  const drawn = base?.drawn ?? canvas
  const turn = (look.rot * Math.PI) / 180
  return {
    halfWidth: (drawn.width * look.scale) / 2,
    halfHeight: (drawn.height * look.scale) / 2,
    centreX: (((base?.x ?? 0) + look.x) * canvas.width) / 2,
    centreY: (((base?.y ?? 0) + look.y) * canvas.height) / 2,
    cos: Math.cos(turn),
    sin: Math.sin(turn),
  }
}

/** A point of the picture, in shares of it from its top-left, to shares of the frame from its top-left. */
function pointAfter(u: number, v: number, look: Look, canvas: PixelSize, base?: Framing): { x: number; y: number } {
  const place = placeOf(look, canvas, base)
  const px = (2 * u - 1) * place.halfWidth
  const py = (1 - 2 * v) * place.halfHeight
  // clockwise with y up
  const x = place.centreX + px * place.cos + py * place.sin
  const y = place.centreY - px * place.sin + py * place.cos
  return { x: 0.5 + x / canvas.width, y: 0.5 - y / canvas.height }
}

/** Whether the picture at this pose still fills the whole frame, with no background showing at any corner. */
export function covers(look: Look, canvas: PixelSize, base?: Framing): boolean {
  const place = placeOf(look, canvas, base)
  for (const [cx, cy] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    // the canvas corner seen from the picture's middle, turned back by the picture's turn
    const dx = (cx * canvas.width) / 2 - place.centreX
    const dy = (cy * canvas.height) / 2 - place.centreY
    const along = dx * place.cos - dy * place.sin
    const up = dx * place.sin + dy * place.cos
    if (Math.abs(along) > place.halfWidth + EPSILON || Math.abs(up) > place.halfHeight + EPSILON) return false
  }
  return true
}

/** Where a box of the picture ends up on the frame at this pose: the upright box around its four corners, in frame shares. */
export function faceAfter(box: ShareBox, look: Look, canvas: PixelSize, base?: Framing): ShareBox {
  const corners = [
    pointAfter(box.x0, box.y0, look, canvas, base),
    pointAfter(box.x1, box.y0, look, canvas, base),
    pointAfter(box.x0, box.y1, look, canvas, base),
    pointAfter(box.x1, box.y1, look, canvas, base),
  ]
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** Where the middle of a box of the picture ends up on the frame at this pose, in frame shares. */
export function centreAfter(box: ShareBox, look: Look, canvas: PixelSize, base?: Framing): { x: number; y: number } {
  return pointAfter((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, look, canvas, base)
}

/** What a move is checked against where it plays. */
export interface MoveContext {
  canvas: PixelSize
  /** the most the video may be pushed in, from `zoomCap` */
  cap: number
  /** how long the move plays: it is cut there */
  lengthS: number
  /** the faces in the picture, in its shares; null when there are none or they are not known */
  faces: ShareBox[] | null
  /** things shown in the picture, in its shares, whose middle has to stay on screen */
  shown: ShareBox[]
  /** for a card cutaway, the card in the picture's shares (the whole picture): it must stay inside the frame, though the frame need not be covered */
  card: ShareBox | null
  /** how the picture is laid before the move (a cutaway's framing); none for a main piece of the canvas's shape */
  base?: Framing
}

export type MoveCheck = { ok: true } | { ok: false; why: string }

/** Moments a move is sampled at, a thirtieth of a second apart, like the frames it plays on. */
const SAMPLE_S = 1 / 30

const inFrame = (box: ShareBox) => box.x0 >= -EPSILON && box.y0 >= -EPSILON && box.x1 <= 1 + EPSILON && box.y1 <= 1 + EPSILON
const onScreen = (point: { x: number; y: number }) => point.x >= -EPSILON && point.x <= 1 + EPSILON && point.y >= -EPSILON && point.y <= 1 + EPSILON

/**
 * Whether a move may play where it is put. It is looked at every thirtieth of a second until it
 * is cut, and at each of its poses, and the first broken rule is the answer: whether it has poses,
 * their start, order and number, the scale, the turn, the frame covered (or a card kept inside it),
 * the faces inside the frame, and the middle of each shown thing on screen.
 */
export function checkMove(move: { poses: Pose[] }, ctx: MoveContext): MoveCheck {
  const { poses } = move
  if (!poses[0]) return { ok: false, why: "the move has no poses" }
  if (poses[0].s < 0) return { ok: false, why: "the first pose is before the move's start" }
  for (let i = 1; i < poses.length; i++) if (!(poses[i]!.s > poses[i - 1]!.s)) return { ok: false, why: "the poses are not in time order" }
  if (poses.length > MOVE_POSES_MAX) return { ok: false, why: `more than ${MOVE_POSES_MAX} poses` }

  const times = new Set<number>()
  for (let k = 0; k * SAMPLE_S <= ctx.lengthS; k++) times.add(k / 30)
  times.add(ctx.lengthS)
  for (const pose of poses) if (pose.s >= 0 && pose.s <= ctx.lengthS) times.add(pose.s)
  const samples = [...times].sort((a, b) => a - b).map((s) => poseAt(poses, s))
  const at = (sample: PoseStep) => `${sample.s.toFixed(2)} s`

  for (const sample of samples) {
    if (sample.scale < 1 - EPSILON) return { ok: false, why: `the scale ${sample.scale.toFixed(2)} at ${at(sample)} is below 1` }
    if (sample.scale > ctx.cap + EPSILON) return { ok: false, why: `the scale ${sample.scale.toFixed(2)} at ${at(sample)} is above this video's cap of ${ctx.cap.toFixed(2)}` }
  }
  for (const sample of samples) {
    if (Math.abs(sample.rot) > ROT_MAX + EPSILON) return { ok: false, why: `a turn of ${sample.rot.toFixed(1)} degrees at ${at(sample)} is more than ${ROT_MAX}` }
  }
  for (const sample of samples) {
    if (ctx.card) {
      if (!inFrame(faceAfter(ctx.card, sample, ctx.canvas, ctx.base))) return { ok: false, why: `the card leaves the frame at ${at(sample)}` }
    } else if (!covers(sample, ctx.canvas, ctx.base)) return { ok: false, why: `the picture's edge shows at ${at(sample)}` }
  }
  for (const sample of samples) {
    for (const face of ctx.faces ?? []) {
      if (!inFrame(faceAfter(face, sample, ctx.canvas, ctx.base))) return { ok: false, why: `a face leaves the frame at ${at(sample)}` }
    }
  }
  for (const sample of samples) {
    for (const thing of ctx.shown) {
      if (!onScreen(centreAfter(thing, sample, ctx.canvas, ctx.base))) return { ok: false, why: `a shown thing's centre leaves the frame at ${at(sample)}` }
    }
  }
  return { ok: true }
}
