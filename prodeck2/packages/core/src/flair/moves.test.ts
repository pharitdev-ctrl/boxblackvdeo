import { expect, test } from "vitest"
import { cardFraming, coverFraming } from "../capcut/framing.ts"
import {
  centreAfter,
  checkMove,
  covers,
  EASE_STEPS,
  EASES,
  faceAfter,
  isMove,
  MOVE_POSES_MAX,
  poseAt,
  steps,
  zoomCap,
  type MoveContext,
  type Pose,
} from "./moves.ts"

/** The user's portrait rough cut. */
const CANVAS = { width: 1080, height: 1920 }

const pose = (s: number, scale: number, extra: Partial<Pose> = {}): Pose => ({ s, scale, x: 0, y: 0, rot: 0, ease: "line", ...extra })

const goodMove = () => ({
  anchor: { kind: "speech", videoId: "v1", sourceUs: 1_000_000 },
  from: "medium",
  about: "ดันเข้าช้าๆ",
  poses: [pose(0, 1), pose(1.5, 1.15, { ease: "inOut" })],
  edited: false,
  off: false,
})

test("a stored move is told from anything else by its anchor, level, about, poses and flags", () => {
  expect(isMove(goodMove())).toBe(true)
  expect(isMove({ ...goodMove(), insert: true, pointId: "p1", instruction: "แรงขึ้น", previous: { poses: [pose(0, 1.1)], about: "เดิม" } })).toBe(true)

  const bad: unknown[] = [
    null,
    "move",
    { ...goodMove(), anchor: undefined },
    { ...goodMove(), anchor: "speech" },
    { ...goodMove(), from: "wild" },
    { ...goodMove(), about: 3 },
    { ...goodMove(), poses: [] },
    { ...goodMove(), poses: "1.2" },
    { ...goodMove(), poses: [{ ...pose(0, 1), scale: "1.2" }] },
    { ...goodMove(), poses: [{ ...pose(0, 1), rot: Number.NaN }] },
    { ...goodMove(), poses: [{ ...pose(0, 1), ease: "bounce" }] },
    { ...goodMove(), poses: [null] },
    { ...goodMove(), edited: "no" },
    { ...goodMove(), off: undefined },
    // a move kept for undo must itself be playable
    { ...goodMove(), previous: "old" },
    { ...goodMove(), previous: { poses: [], about: "เดิม" } },
    { ...goodMove(), previous: { poses: [{ ...pose(0, 1), ease: "bounce" }], about: "เดิม" } },
    { ...goodMove(), previous: { poses: [pose(0, 1)] } },
  ]
  for (const value of bad) expect(isMove(value), JSON.stringify(value)).toBe(false)
})

test("the eases are the five the prompt names", () => {
  expect([...EASES]).toEqual(["line", "in", "out", "inOut", "cut"])
})

test("each ease shapes the mix from the pose before to the pose it reaches", () => {
  // from 1 at 0 s to 2 at 4 s, so the scale reads the mix straight off
  const mix = (ease: Pose["ease"], t: number) => poseAt([pose(0, 1), pose(4, 2, { ease })], 4 * t).scale - 1
  const expected: Record<Pose["ease"], number[]> = {
    line: [0, 0.25, 0.5, 1],
    in: [0, 0.0625, 0.25, 1],
    out: [0, 0.4375, 0.75, 1],
    inOut: [0, 0.125, 0.5, 1],
    cut: [0, 1, 1, 1],
  }
  for (const ease of EASES) {
    const got = [0, 0.25, 0.5, 1].map((t) => mix(ease, t))
    got.forEach((value, i) => expect(value, `${ease} at ${[0, 0.25, 0.5, 1][i]}`).toBeCloseTo(expected[ease][i]!, 10))
  }
})

test("before the first pose the move is at its first pose, and after the last it holds the last", () => {
  const poses = [pose(1, 1.1, { x: 0.05 }), pose(2, 1.2, { y: -0.1, rot: 2 })]
  expect(poseAt(poses, 0)).toMatchObject({ scale: 1.1, x: 0.05, y: 0, rot: 0 })
  expect(poseAt(poses, 9)).toMatchObject({ scale: 1.2, x: 0, y: -0.1, rot: 2 })
  // every number moves with the same mix
  const half = poseAt(poses, 1.5)
  expect(half.s).toBe(1.5)
  expect(half.scale).toBeCloseTo(1.15, 10)
  expect(half.x).toBeCloseTo(0.025, 10)
  expect(half.y).toBeCloseTo(-0.05, 10)
  expect(half.rot).toBeCloseTo(1, 10)
})

test("a straight segment is written as its end point only", () => {
  const points = steps([pose(0, 1), pose(1, 1.2, { x: 0.1 }), pose(2, 1.1, { rot: -2 })])
  expect(points).toEqual([
    { s: 0, scale: 1, x: 0, y: 0, rot: 0 },
    { s: 1, scale: 1.2, x: 0.1, y: 0, rot: 0 },
    { s: 2, scale: 1.1, x: 0, y: 0, rot: -2 },
  ])
})

test("an eased segment is written as straight steps that follow the ease", () => {
  const points = steps([pose(0, 1), pose(0.8, 1.2, { ease: "in" })])
  expect(points).toHaveLength(1 + EASE_STEPS)
  expect(points[0]).toEqual({ s: 0, scale: 1, x: 0, y: 0, rot: 0 })
  points.slice(1).forEach((point, i) => {
    const t = (i + 1) / EASE_STEPS
    expect(point.s).toBeCloseTo(0.8 * t, 10)
    expect(point.scale).toBeCloseTo(1 + 0.2 * t * t, 10)
  })
  expect(points.at(-1)).toEqual({ s: 0.8, scale: 1.2, x: 0, y: 0, rot: 0 })
  // out and inOut take the same number of steps
  expect(steps([pose(0, 1), pose(1, 1.1, { ease: "out" }), pose(2, 1, { ease: "inOut" })])).toHaveLength(1 + 2 * EASE_STEPS)
})

test("a cut holds the pose before until a millisecond after it, then jumps and holds the new one", () => {
  const points = steps([pose(0.5, 1.1), pose(2, 1.3, { ease: "cut", x: 0.1 })])
  expect(points).toHaveLength(3)
  expect(points[0]).toEqual({ s: 0.5, scale: 1.1, x: 0, y: 0, rot: 0 })
  expect(points[1]!.s).toBeCloseTo(0.501, 10)
  expect(points[1]).toMatchObject({ scale: 1.3, x: 0.1 })
  expect(points[2]).toEqual({ s: 2, scale: 1.3, x: 0.1, y: 0, rot: 0 })
})

test("a cut closer than a millisecond to the pose before is the jump alone", () => {
  expect(steps([pose(0, 1), pose(0.0005, 1.2, { ease: "cut" })])).toEqual([
    { s: 0, scale: 1, x: 0, y: 0, rot: 0 },
    { s: 0.0005, scale: 1.2, x: 0, y: 0, rot: 0 },
  ])
})

test("the zoom cap follows the video's resolution against the canvas", () => {
  // the user's own 1080p portrait footage
  expect(zoomCap({ width: 1080, height: 1920 }, CANVAS)).toBeCloseTo(1.3, 10)
  // 4K has detail to spare
  expect(zoomCap({ width: 2160, height: 3840 }, CANVAS)).toBeCloseTo(1.5, 10)
  // 720p is already enlarged by 1.5 to cover, so it gets less than 1.3, but never below 1
  expect(zoomCap({ width: 720, height: 1280 }, CANVAS)).toBe(1)
  expect(zoomCap({ width: 900, height: 1600 }, CANVAS)).toBeCloseTo(1.3 / 1.2, 10)
  // a landscape video: as is on a landscape canvas, already blown up on a portrait one
  expect(zoomCap({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBeCloseTo(1.3, 10)
  expect(zoomCap({ width: 1920, height: 1080 }, CANVAS)).toBe(1)
  expect(zoomCap({ width: 3840, height: 2160 }, CANVAS)).toBeCloseTo(1.5, 10)
  // a video with no size is left with no zoom
  expect(zoomCap({ width: 0, height: 0 }, CANVAS)).toBe(1)
})

const at = (scale: number, x = 0, y = 0, rot = 0) => ({ scale, x, y, rot })

test("the picture covers the frame as is, and when pushed in a quarter it may slide a quarter", () => {
  expect(covers(at(1), CANVAS)).toBe(true)
  // at 1.25 the picture overhangs each side by a quarter of a half-frame
  for (const x of [0.25, -0.25]) expect(covers(at(1.25, x), CANVAS), `x ${x}`).toBe(true)
  for (const y of [0.25, -0.25]) expect(covers(at(1.25, 0, y), CANVAS), `y ${y}`).toBe(true)
  for (const x of [0.26, -0.26]) expect(covers(at(1.25, x), CANVAS), `x ${x}`).toBe(false)
  expect(covers(at(1.25, 0, 0.26), CANVAS)).toBe(false)
  // any slide at all shows an edge as is
  expect(covers(at(1, 0.01), CANVAS)).toBe(false)
})

test("a turn of 5 degrees shows the corners as is, and needs the picture pushed in to about 1.16 on a 9:16 frame", () => {
  expect(covers(at(1, 0, 0, 5), CANVAS)).toBe(false)
  expect(covers(at(1, 0, 0, -5), CANVAS)).toBe(false)
  // By hand: to cover the frame turned by 5 degrees the picture's half-width must reach
  // 540·cos 5° + 960·sin 5° = 537.9 + 83.7 = 621.6 px, which is 1.151 of 540, and its half-height
  // 540·sin 5° + 960·cos 5° = 47.1 + 956.3 = 1003.4 px, 1.045 of 960. So 1.15 falls short by a
  // hair on a 9:16 (or 16:9) frame, and 1.16 covers with room for nothing else.
  expect(covers(at(1.15, 0, 0, 5), CANVAS)).toBe(false)
  expect(covers(at(1.16, 0, 0, 5), CANVAS)).toBe(true)
  expect(covers(at(1.16, 0, 0, -5), CANVAS)).toBe(true)
  // on a square frame both halves need cos 5° + sin 5° = 1.083, so 1.15 is enough there
  expect(covers(at(1.15, 0, 0, 5), { width: 1080, height: 1080 })).toBe(true)
})

test("a turn and a slide together leave less room than either alone", () => {
  // By hand, at 1.25 the picture's half-width is 675 px. Slid right by x half-frames, the left
  // corners are 540·(1 + x) px from its middle across, and the turn of 3 degrees brings them
  // 540·(1 + x)·cos 3° + 960·sin 3° = 539.3·(1 + x) + 50.2 px along it: at most 675 while
  // x ≤ 0.158. At x 0.1 that is 643.4 px. Up the picture they are 960·cos 3° - 594·sin 3° = 927.6 px
  // of its 1200, so the height never binds.
  expect(covers(at(1.25, 0.1, 0, 3), CANVAS)).toBe(true)
  expect(covers(at(1.25, 0.15, 0, 3), CANVAS)).toBe(true)
  expect(covers(at(1.25, 0.16, 0, 3), CANVAS)).toBe(false)
  expect(covers(at(1.25, -0.16, 0, 3), CANVAS)).toBe(false)
  // without the turn the same slide is well inside the quarter of room
  expect(covers(at(1.25, 0.16), CANVAS)).toBe(true)
})

test("a turned picture whose framing sits off the middle covers on one side and not on its mirror", () => {
  // A 1300 by 2300 px picture pushed to 1.02 (half-sizes 663 and 1173 px), turned 4 degrees.
  // By hand, with its middle 54 px right and 96 px up, the frame's top-left corner is 594 px left and
  // 864 px up of it, which the turn brings 594·cos 4° + 864·sin 4° = 592.6 + 60.3 = 652.9 px along:
  // inside 663, and every other corner is inside too. With its middle 54 px left instead, the
  // bottom-right corner is 594 px right and 1056 px down: 592.6 + 73.7 = 666.2 px along, past 663.
  const base = (x: number) => ({ scale: 1, x, y: 0.1, drawn: { width: 1300, height: 2300 } })
  expect(covers(at(1.02, 0, 0, 4), CANVAS, base(0.1))).toBe(true)
  expect(covers(at(1.02, 0, 0, 4), CANVAS, base(-0.1))).toBe(false)
})

test("a cover cutaway framed on its subject has the room its framing left it, and no more", () => {
  // the 3:4 photo blown up to its lower-left subject (see framing.test.ts): 2400 by 3200 px, its
  // middle 0.444 of a half-frame right (240 px) and 0.667 up (640 px)
  const base = coverFraming({ width: 3024, height: 4032 }, CANVAS, { x0: 0.1, y0: 0.4, x1: 0.7, y1: 1 })
  expect(covers(at(1), CANVAS, base)).toBe(true)
  // By hand: its left edge is at 240 - 1200 = -960 px, 420 px past the frame's -540, so it may
  // slide right 420 / 540 = 0.778 of a half-frame
  expect(covers(at(1, 0.77), CANVAS, base)).toBe(true)
  expect(covers(at(1, 0.79), CANVAS, base)).toBe(false)
  // its bottom edge is at 640 - 1600 = -960 px, exactly the frame's: it may not slide up at all,
  // but down it has 640 + 1600 - 960 = 1280 px, 1.333 half-frames
  expect(covers(at(1, 0, 0.01), CANVAS, base)).toBe(false)
  expect(covers(at(1, 0, -1.3), CANVAS, base)).toBe(true)
  expect(covers(at(1, 0, -1.34), CANVAS, base)).toBe(false)
})

test("a face box follows the push and the slide, in shares of the frame from its top-left", () => {
  const face = { x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.4 }
  expect(faceAfter(face, at(1), CANVAS)).toEqual(face)
  // pushed to 1.2 about the middle: 0.4 is 0.1 left of it, and becomes 0.12 left of it
  const pushed = faceAfter(face, at(1.2), CANVAS)
  expect(pushed.x0).toBeCloseTo(0.38, 10)
  expect(pushed.x1).toBeCloseTo(0.62, 10)
  expect(pushed.y0).toBeCloseTo(0.14, 10)
  expect(pushed.y1).toBeCloseTo(0.38, 10)
  // slid a tenth of a half-frame right and up: that is 0.05 of the frame each way, up being smaller y
  const slid = faceAfter(face, at(1.2, 0.1, 0.1), CANVAS)
  expect(slid.x0).toBeCloseTo(0.43, 10)
  expect(slid.y0).toBeCloseTo(0.09, 10)
  expect(slid.y1).toBeCloseTo(0.33, 10)
  expect(centreAfter(face, at(1.2, 0.1, 0.1), CANVAS)).toEqual({ x: expect.closeTo(0.55, 10), y: expect.closeTo(0.21, 10) })
})

test("a turned box grows to the box around its turned corners, and turns about the picture's middle", () => {
  const box = faceAfter({ x0: 0.4, y0: 0.45, x1: 0.6, y1: 0.55 }, at(1, 0, 0, 90), { width: 1000, height: 1000 })
  // a 200 by 100 px box in the middle of a square frame, turned a quarter, is 100 by 200
  expect(box.x0).toBeCloseTo(0.45, 10)
  expect(box.x1).toBeCloseTo(0.55, 10)
  expect(box.y0).toBeCloseTo(0.4, 10)
  expect(box.y1).toBeCloseTo(0.6, 10)
  // positive degrees turn clockwise on screen: a point right of the middle goes below it
  const point = centreAfter({ x0: 0.7, y0: 0.5, x1: 0.7, y1: 0.5 }, at(1, 0, 0, 90), { width: 1000, height: 1000 })
  expect(point.x).toBeCloseTo(0.5, 10)
  expect(point.y).toBeCloseTo(0.7, 10)
})

const context = (extra: Partial<MoveContext> = {}): MoveContext => ({ canvas: CANVAS, cap: 1.3, lengthS: 2, faces: null, shown: [], card: null, ...extra })
const check = (poses: Pose[], extra: Partial<MoveContext> = {}) => checkMove({ poses }, context(extra))

test("a move that stays within every rule passes", () => {
  const face = { x0: 0.35, y0: 0.15, x1: 0.65, y1: 0.35 }
  const poses = [pose(0, 1), pose(0.4, 1.2, { ease: "out", y: -0.1 }), pose(1.6, 1.25, { ease: "inOut", y: -0.15, rot: 2 })]
  expect(check(poses, { faces: [face], shown: [{ x0: 0.2, y0: 0.6, x1: 0.5, y1: 0.8 }] })).toEqual({ ok: true })
})

test("poses out of time order, or too many of them, fail", () => {
  expect(check([pose(0, 1), pose(1, 1.1), pose(0.5, 1.2)])).toEqual({ ok: false, why: "the poses are not in time order" })
  expect(check([pose(0, 1), pose(0, 1.1)])).toEqual({ ok: false, why: "the poses are not in time order" })
  expect(check([pose(-0.2, 1), pose(1, 1.1)])).toEqual({ ok: false, why: "the first pose is before the move's start" })
  expect(check([])).toEqual({ ok: false, why: "the move has no poses" })
  const many = Array.from({ length: MOVE_POSES_MAX + 1 }, (_, i) => pose(i * 0.1, 1))
  expect(check(many)).toEqual({ ok: false, why: "more than 12 poses" })
  expect(check(many.slice(1))).toEqual({ ok: true })
})

test("a scale under 1 or over the cap fails", () => {
  expect(check([pose(0, 1), pose(1, 0.9, { ease: "cut" })])).toEqual({ ok: false, why: "the scale 0.90 at 0.03 s is below 1" })
  expect(check([pose(0, 1), pose(1, 1.4, { ease: "cut" })])).toEqual({ ok: false, why: "the scale 1.40 at 0.03 s is above this video's cap of 1.30" })
  // a slow push past the cap fails where it crosses it: 1 + 0.4·t passes 1.3 after 0.75 s
  expect(check([pose(0, 1), pose(1, 1.4)])).toEqual({ ok: false, why: "the scale 1.31 at 0.77 s is above this video's cap of 1.30" })
  // a quick peak between two thirtieths of a second is still seen at its pose
  expect(check([pose(0, 1), pose(0.05, 1.4), pose(0.1, 1)])).toEqual({ ok: false, why: "the scale 1.40 at 0.05 s is above this video's cap of 1.30" })
  // and so is the very end of the move, when it falls between two of them
  expect(check([pose(0, 1), pose(1, 2)], { lengthS: 0.32 })).toEqual({ ok: false, why: "the scale 1.32 at 0.32 s is above this video's cap of 1.30" })
  expect(check([pose(0, 1), pose(1, 2)], { lengthS: 0.3 })).toEqual({ ok: true })
  // only what plays counts: a pose after the end of the piece is never reached
  expect(check([pose(0, 1), pose(1, 1.2), pose(3, 1.4)], { lengthS: 1 })).toEqual({ ok: true })
})

test("a turn of more than 5 degrees fails", () => {
  expect(check([pose(0, 1.25), pose(1, 1.25, { ease: "cut", rot: -6 })])).toEqual({ ok: false, why: "a turn of -6.0 degrees at 0.03 s is more than 5" })
})

test("a picture that shows its edge fails, at the first moment it does", () => {
  expect(check([pose(0, 1), pose(1, 1.1, { x: 0.3 })])).toEqual({ ok: false, why: "the picture's edge shows at 0.03 s" })
  expect(check([pose(0, 1.15), pose(1, 1.15, { rot: 5 })])).toMatchObject({ ok: false, why: expect.stringMatching(/^the picture's edge shows at/) })
})

test("a face that leaves the frame fails, and a frame with no faces has no such rule", () => {
  const face = { x0: 0.3, y0: 0.05, x1: 0.7, y1: 0.3 }
  // pushing in to 1.3 about the middle takes the top of the face from 0.05 to -0.085
  const poses = [pose(0, 1), pose(1, 1.3, { ease: "cut" })]
  expect(check(poses, { faces: [face] })).toEqual({ ok: false, why: "a face leaves the frame at 0.03 s" })
  expect(check(poses, { faces: null })).toEqual({ ok: true })
  // up is +y, so a picture slid down a tenth of the frame brings the face back in
  expect(check([pose(0, 1), pose(1, 1.3, { ease: "cut", y: -0.2 })], { faces: [face] })).toEqual({ ok: true })
})

test("a shown thing only needs its centre on screen", () => {
  const thing = { x0: 0.75, y0: 0.4, x1: 1, y1: 0.6 }
  // at 1.3 slid 0.3 left, the thing's centre at 0.875 goes to 0.5 + 0.375·1.3 - 0.15 = 0.8375: half the thing is off, but its centre is on
  expect(check([pose(0, 1), pose(1, 1.3, { x: -0.3 })], { shown: [thing] })).toEqual({ ok: true })
  // slid right instead: the centre goes to 0.5 + 0.4875 + 0.15 = 1.1375
  expect(check([pose(0, 1), pose(1, 1.3, { ease: "cut", x: 0.3 })], { shown: [thing] })).toEqual({
    ok: false,
    why: "a shown thing's centre leaves the frame at 0.03 s",
  })
})

test("a card may move anywhere but must stay inside the frame, and its edge may show", () => {
  // a 3:4 photo as a card, 62 % of the width, low in the frame
  const base = cardFraming({ width: 3024, height: 4032 }, CANVAS, null)
  const card = { x0: 0, y0: 0, x1: 1, y1: 1 }
  expect(check([pose(0, 1), pose(1, 1.1, { ease: "inOut" })], { base, card })).toEqual({ ok: true })
  // the card's bottom sits near the frame's: a slide down takes it off
  expect(check([pose(0, 1), pose(1, 1, { y: -0.3 })], { base, card })).toMatchObject({ ok: false, why: expect.stringMatching(/^the card leaves the frame at/) })
  // a slide with no push is fine for a card, though the same slide shows the edge of a cover picture
  expect(check([pose(0, 1), pose(1, 1, { x: 0.05 })], { base, card })).toEqual({ ok: true })
  expect(check([pose(0, 1), pose(1, 1, { x: 0.05 })])).toMatchObject({ ok: false, why: expect.stringMatching(/^the picture's edge shows at/) })
})
