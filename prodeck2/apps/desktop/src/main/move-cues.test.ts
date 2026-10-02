import { expect, test } from "vitest"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueAnchor, PlacedInsert, PlacedZoom } from "@boxblack/core/flair/plan"
import type { MoveCue, Pose } from "@boxblack/core/flair/moves"
import { OBJECTS_VERSION, type SceneObject } from "@boxblack/core/vision"
import type { ItemPlace } from "./insert-media.ts"
import { faceBandIn, faceBoxesIn, legacyZoomsBeside, moveViews, movesInForce, type PlacedMove } from "./move-cues.ts"
import type { PieceSlot } from "./zoom-cues.ts"

const V = "v1"
/** The user's portrait rough cut. */
const CANVAS = { width: 1080, height: 1920 }

/** Two pieces of one video: 0–5 s of it, then 10–16 s, played from 0 and from 5 s. */
const plan = {
  durationUs: 11_000_000,
  cuts: [
    { binId: V, sourceStartUs: 0, sourceDurationUs: 5_000_000 },
    { binId: V, sourceStartUs: 10_000_000, sourceDurationUs: 6_000_000 },
  ],
  beats: [{ beatId: "b1", videoId: V, pieces: [] }],
} as unknown as CutPlan

const at = (cut: number, sourceUs: number) => [0, 5_000_000][cut]! + sourceUs - [0, 10_000_000][cut]!

const object = (box: SceneObject["box"], extra: Partial<SceneObject> = {}): SceneObject => ({ what: "หน้า", kind: "keep", box, still: false, ...extra })
/** A face in the middle until 2.5 s; after that a face near the right edge and a glass shown on the left. */
const FACE_MIDDLE = { x0: 0.4, y0: 0.3, x1: 0.6, y1: 0.5 }
const FACE_RIGHT = { x0: 0.85, y0: 0.3, x1: 0.95, y1: 0.5 }
const GLASS = { x0: 0.1, y0: 0.6, x1: 0.3, y1: 0.8 }
const objects = {
  version: OBJECTS_VERSION,
  scenes: [[object(FACE_MIDDLE, { face: true })], [object(FACE_RIGHT, { face: true }), object(GLASS, { what: "แก้ว", face: false })]],
}

function clipOf(extra: Partial<CutClip> = {}): CutClip {
  const scenes = [
    { startUs: 0, endUs: 2_500_000, keepClear: { fromY: 0.3, toY: 0.5 } },
    { startUs: 2_500_000, endUs: 20_000_000, keepClear: { fromY: 0.3, toY: 0.5 } },
  ]
  return { id: V, name: "v1.mov", durationUs: 20_000_000, width: 1080, height: 1920, transcript: null, insight: { scenes }, objects, ...extra } as unknown as CutClip
}

const word = (sourceUs: number): CueAnchor => ({ kind: "speech", videoId: V, sourceUs, beatId: "b1" })

/** A word plays where the piece holding it puts it; one the cut took out has no place. */
function place(anchor: CueAnchor): ItemPlace | null {
  if (anchor.kind !== "speech") return null
  const index = plan.cuts.findIndex((cut) => cut.sourceStartUs <= anchor.sourceUs && anchor.sourceUs < cut.sourceStartUs + cut.sourceDurationUs)
  return index < 0 ? null : { atUs: at(index, anchor.sourceUs), what: "", beatId: "b1", by: anchor }
}

const pose = (s: number, scale: number, extra: Partial<Pose> = {}): Pose => ({ s, scale, x: 0, y: 0, rot: 0, ease: "line", ...extra })
const move = (anchor: CueAnchor, poses: Pose[], extra: Partial<MoveCue> = {}): MoveCue => ({ anchor, from: "medium", about: "ดันเข้า", poses, edited: false, off: false, ...extra })

const FLAIR: FlairOptions = { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false }

function run(moves: MoveCue[], extra: Partial<Parameters<typeof movesInForce>[0]> = {}) {
  return movesInForce({ moves, place, inserts: [], plan, clips: [clipOf()], at, canvas: CANVAS, flair: FLAIR, pointPlaced: () => true, ...extra })
}

test("a move on a word plays from that word on its piece, for as long as its poses run", () => {
  const poses = [pose(0, 1), pose(1.5, 1.15, { ease: "inOut", x: -0.05 })]
  const { kept, off, dropped, lost } = run([move(word(11_000_000), poses)])
  expect(kept).toHaveLength(1)
  expect(kept[0]).toMatchObject({ atUs: 6_000_000, startUs: 1_000_000, durationUs: 1_500_000, cut: 1, beatId: "b1", poses })
  expect(kept[0]!.insertIndex).toBeUndefined()
  expect([off, dropped, lost]).toEqual([[], 0, 0])
})

test("a move that runs past its piece's end is cut there, its last pose sampled where the piece ends", () => {
  const { kept } = run([move(word(4_000_000), [pose(0, 1), pose(2, 1.2), pose(3, 1.1)])])
  expect(kept[0]).toMatchObject({ atUs: 4_000_000, startUs: 4_000_000, durationUs: 1_000_000 })
  expect(kept[0]!.poses).toHaveLength(2)
  expect(kept[0]!.poses[0]).toEqual(pose(0, 1))
  expect(kept[0]!.poses[1]!.s).toBe(1)
  expect(kept[0]!.poses[1]!.scale).toBeCloseTo(1.1)
})

test("a move above the level, on a point not placed, or with zooms off plays nowhere and is not counted", () => {
  const high = move(word(1_000_000), [pose(0, 1.1)], { from: "heavy" })
  const onGonePoint = move(word(1_000_000), [pose(0, 1.1)], { pointId: "p9" })
  expect(run([high, onGonePoint], { pointPlaced: (id) => id !== "p9" })).toEqual({ kept: [], off: [], dropped: 0, lost: 0 })
  expect(run([move(word(1_000_000), [pose(0, 1.1)])], { flair: { ...FLAIR, zoom: false } })).toEqual({ kept: [], off: [], dropped: 0, lost: 0 })
  // at the heavy level the first one plays
  expect(run([high], { flair: { ...FLAIR, level: "heavy" } }).kept).toHaveLength(1)
})

test("a move whose word the cut took out is lost; a switched-off one is listed with no place and not counted", () => {
  const gone = move(word(7_000_000), [pose(0, 1.1)])
  const result = run([gone, { ...gone, off: true }])
  expect(result.lost).toBe(1)
  expect(result.kept).toEqual([])
  expect(result.off).toEqual([{ cue: { ...gone, off: true }, placed: null, why: null }])
})

test("of two moves on one piece that overlap, the later is dropped; one starting where the other ends plays on", () => {
  const first = move(word(500_000), [pose(0, 1), pose(2, 1.1)])
  const inside = move(word(1_500_000), [pose(0, 1), pose(1, 1.1)])
  const after = move(word(2_500_000), [pose(0, 1.1), pose(1, 1)])
  const other = move(word(10_500_000), [pose(0, 1), pose(1, 1.1)])
  const { kept, dropped } = run([first, inside, after, other])
  expect(kept.map((placed) => placed.cue)).toEqual([first, after, other])
  expect(dropped).toBe(1)
})

test("the cap comes from the video's size: 1080 wide stops at 1.3, 4K goes to 1.5, and an unknown size counts as the canvas's", () => {
  // pushed in and back out, so what it holds afterwards is no part of the test
  const push = move(word(500_000), [pose(0, 1), pose(0.5, 1.4), pose(1, 1)])
  expect(run([push])).toMatchObject({ kept: [], dropped: 1 })
  expect(run([push], { clips: [clipOf({ width: 2160, height: 3840 })] }).kept).toHaveLength(1)
  expect(run([push], { clips: [clipOf({ width: undefined, height: undefined })] })).toMatchObject({ kept: [], dropped: 1 })
})

test("a main piece of another shape than the canvas starts fitted, so a move that does not push in far enough shows its edge", () => {
  // a square video on the portrait canvas sits as a band across the middle
  const square = clipOf({ width: 1920, height: 1920, objects: null, insight: { scenes: [] } as unknown as CutClip["insight"] })
  expect(run([move(word(500_000), [pose(0, 1), pose(1, 1.1)])], { clips: [square] })).toMatchObject({ kept: [], dropped: 1 })
})

test("a face that leaves the frame, or a shown thing whose middle does, drops the move", () => {
  // panned right, the face near the right edge goes off it
  expect(run([move(word(3_000_000), [pose(0, 1), pose(0.5, 1.2, { x: 0.2 })])])).toMatchObject({ kept: [], dropped: 1 })
  // panned left, the glass's middle goes off the left edge
  expect(run([move(word(3_000_000), [pose(0, 1), pose(0.5, 1.3, { x: -0.3 })])])).toMatchObject({ kept: [], dropped: 1 })
  // the same pan in the first scene, with only a face in the middle, is fine
  expect(run([move(word(500_000), [pose(0, 1), pose(0.5, 1.2, { x: 0.2 }), pose(1, 1)])]).kept).toHaveLength(1)
})

test("faces come from objects marked as faces; a pass before faces keeps every keep box as one; no pass keeps the scene's band", () => {
  const right = move(word(3_000_000), [pose(0, 1), pose(1, 1.2, { x: -0.15 })])
  // the glass is shown, not a face: only its middle has to stay on screen
  expect(run([right]).kept).toHaveLength(1)
  // before faces, the glass is a face too, and panning left takes its left edge off the frame
  const beforeFaces = { version: "old", scenes: objects.scenes.map((scene) => scene.map(({ face: _face, ...rest }) => rest)) }
  expect(run([right], { clips: [clipOf({ objects: beforeFaces })] })).toMatchObject({ kept: [], dropped: 1 })
  // with no objects at all the band 0.3–0.5 is a face, checked only up and down: the push keeps it in frame
  expect(run([right], { clips: [clipOf({ objects: null })] }).kept).toHaveLength(1)
  // and nothing to keep at all lets it through
  expect(run([right], { clips: [clipOf({ objects: null, insight: { scenes: [] } as unknown as CutClip["insight"] })] }).kept).toHaveLength(1)
})

test("whether faces are known goes by the pass's version: a pass before faces has every keep box a face, marked or not; a current pass that marked none has no face", () => {
  // pushed to 1.2 about the middle, the face near the right edge leaves the frame, its middle does not
  const push = move(word(3_000_000), [pose(0, 1), pose(0.5, 1.2)])
  expect(run([push])).toMatchObject({ kept: [], dropped: 1 })
  // a pass of another version is from before faces, whatever its objects say
  expect(run([move(word(3_000_000), [pose(0, 1), pose(1, 1.2, { x: -0.15 })])], { clips: [clipOf({ objects: { version: "old", scenes: objects.scenes } })] })).toMatchObject({ kept: [], dropped: 1 })
  // a current pass that found no face: the box near the edge is a thing shown, whose middle stays on screen
  const noFace = { version: OBJECTS_VERSION, scenes: objects.scenes.map((scene) => scene.map(({ face: _face, ...rest }) => rest)) }
  expect(run([push], { clips: [clipOf({ objects: noFace })] }).kept).toHaveLength(1)
  // and the face boxes the text keeps off are those things, where they are
  near(faceBoxesIn({ startUs: 3_000_000, endUs: 3_500_000 }, [], plan, [clipOf({ objects: noFace })], CANVAS, at), [FACE_RIGHT, GLASS])
})

test("with no objects pass the scene's band is a face only up and down: a push passes while the band stays in frame, and fails when it leaves", () => {
  const low = clipOf({ objects: null, insight: { scenes: [{ startUs: 0, endUs: 20_000_000, keepClear: { fromY: 0.6, toY: 0.95 } }] } as unknown as CutClip["insight"] })
  // pushed in and lifted, the band near the foot stays in frame
  expect(run([move(word(3_000_000), [pose(0, 1), pose(1, 1.3, { y: 0.3 })])], { clips: [low] }).kept).toHaveLength(1)
  // pushed in and lowered, it goes off the bottom
  expect(run([move(word(3_000_000), [pose(0, 1), pose(1, 1.3, { y: -0.3 })])], { clips: [low] })).toMatchObject({ kept: [], dropped: 1 })
})

test("a later move on a piece is checked from the pose held when it starts, as the writer lays it, unless it opens with a cut", () => {
  // its own first pose is above the cap, but the writer never lays it
  const poses = [pose(0, 1.4), pose(0.5, 1.2, { x: -0.1 })]
  // at the piece's very start, with nothing before it, it is laid as it is
  expect(run([move(word(10_000_000), poses)])).toMatchObject({ kept: [], dropped: 1 })
  // later on the piece it starts from the picture at rest
  expect(run([move(word(11_000_000), poses)]).kept).toHaveLength(1)
  // after another move it starts from the pose that one holds
  const first = move(word(10_000_000), [pose(0, 1), pose(0.5, 1.2, { x: -0.1 })])
  expect(run([first, move(word(11_000_000), poses)]).kept).toHaveLength(2)
  // opening with a cut it jumps to its own first pose, which is then checked
  const cutIn = move(word(11_000_000), [{ ...poses[0]!, ease: "cut" }, poses[1]!])
  expect(run([first, cutIn])).toMatchObject({ dropped: 1 })
  expect(run([first, cutIn]).kept.map((placed) => placed.cue)).toEqual([first])
})

test("the pose a move ends on is held until the next move or the piece's end, and has to keep the faces there in frame too", () => {
  // panned right it is fine for the face in the middle, but held into the next scene it takes the face near the edge off
  const panned = move(word(500_000), [pose(0, 1), pose(1, 1.2, { x: 0.2 })])
  expect(run([panned])).toMatchObject({ kept: [], dropped: 1 })
  // a move that brings the picture back before that scene saves it
  const back = move(word(2_000_000), [pose(0, 1), pose(0.4, 1)])
  expect(run([panned, back]).kept.map((placed) => placed.cue)).toEqual([panned, back])
})

test("a switched-off move is judged as if it played, kept in the off list with why it would not, and never counted", () => {
  const tooFar = move(word(10_500_000), [pose(0, 1), pose(1, 1.4)], { off: true })
  const fine = move(word(500_000), [pose(0, 1), pose(1, 1.1)])
  const overlapping = move(word(1_000_000), [pose(0, 1.1)], { off: true })
  const { kept, off, dropped, lost } = run([fine, tooFar, overlapping])
  expect(kept.map((placed) => placed.cue)).toEqual([fine])
  expect(off.map((entry) => entry.cue)).toEqual([overlapping, tooFar])
  expect(off[0]!.why).toMatch(/another move/)
  expect(off[1]!.why).toMatch(/cap/)
  expect(off[1]!.placed).toMatchObject({ atUs: 5_500_000, durationUs: 1_000_000, cut: 1 })
  expect([dropped, lost]).toEqual([0, 0])
})

test("a move dropped for the pose it holds no longer seams the move after it, which is judged again from rest", () => {
  // held panned right into the next scene, the first takes the face near the edge off; the second starts from that pose there
  const first = move(word(500_000), [pose(0, 1), pose(1, 1.2, { x: 0.2 })])
  const second = move(word(3_000_000), [pose(0, 1), pose(1, 1.1)])
  const { kept, dropped } = run([first, second])
  // with the first gone, the second starts from rest and plays
  expect(kept.map((placed) => placed.cue)).toEqual([second])
  expect(dropped).toBe(1)
})

test("a move dropped for overlapping one that is then dropped for its hold comes back", () => {
  const first = move(word(500_000), [pose(0, 1), pose(2, 1.2, { x: 0.2 })])
  const inside = move(word(1_500_000), [pose(0, 1), pose(0.5, 1.1)])
  const { kept, dropped } = run([first, inside])
  expect(kept.map((placed) => placed.cue)).toEqual([inside])
  expect(dropped).toBe(1)
})

const insert = (anchor: CueAnchor, atUs: number, durationUs: number, fit: "cover" | "card", size: number, subject: PlacedInsert["cue"]["subject"] = null): PlacedInsert => ({
  cue: { anchor, binId: `pic-${atUs}`, edited: false, fit, subject },
  atUs,
  durationUs,
  media: { binId: `pic-${atUs}`, path: "/p.jpg", name: "p.jpg", kind: "photo", durationUs: 2_000_000, width: fit === "cover" ? 1080 : size, height: fit === "cover" ? 1920 : size },
})

test("a move on a cutaway plays from its first frame, cut where the cutaway ends", () => {
  const inserts = [insert(word(11_000_000), 6_000_000, 2_000_000, "cover", 0), insert(word(14_000_000), 9_000_000, 1_500_000, "card", 4000)]
  const onCover = move(word(11_000_000), [pose(0, 1), pose(3, 1.2)], { insert: true })
  const { kept, lost } = run([onCover, move(word(12_000_000), [pose(0, 1.1)], { insert: true })], { inserts })
  expect(lost).toBe(1)
  expect(kept[0]).toMatchObject({ atUs: 6_000_000, startUs: 0, durationUs: 2_000_000, insertIndex: 0, beatId: "b1" })
  expect(kept[0]!.cut).toBeUndefined()
  expect(kept[0]!.poses[1]!.scale).toBeCloseTo(1 + 0.2 * (2 / 3))
})

test("a cover cutaway may not show its edge, and a card may not leave the frame", () => {
  const inserts = [insert(word(11_000_000), 6_000_000, 2_000_000, "cover", 0), insert(word(14_000_000), 9_000_000, 1_500_000, "card", 4000)]
  const panned = move(word(11_000_000), [pose(0, 1.1, { x: 0.3 })], { insert: true })
  expect(run([panned], { inserts })).toMatchObject({ kept: [], dropped: 1 })
  // the card sits below the face band, its middle three quarters down: at 1.5 its foot is off the frame, at 1.2 it is not
  expect(run([move(word(14_000_000), [pose(0, 1.5)], { insert: true })], { inserts })).toMatchObject({ kept: [], dropped: 1 })
  expect(run([move(word(14_000_000), [pose(0, 1.2)], { insert: true })], { inserts }).kept[0]).toMatchObject({ insertIndex: 1, atUs: 9_000_000 })
})

test("a cover cropped to an off-centre subject keeps the middle of that subject on screen", () => {
  // the subject in the top right is blown up to fill the frame and brought to its middle
  const inserts = [insert(word(11_000_000), 6_000_000, 2_000_000, "cover", 0, { x0: 0.6, y0: 0.1, x1: 0.9, y1: 0.4 })]
  // a pan of 0.8 half-frames takes its middle to 0.9 of the width; 1.1 takes it off the right edge, though the picture still covers the frame
  expect(run([move(word(11_000_000), [pose(0, 1, { x: 0.8 })], { insert: true })], { inserts }).kept).toHaveLength(1)
  expect(run([move(word(11_000_000), [pose(0, 1, { x: 1.1 })], { insert: true })], { inserts })).toMatchObject({ kept: [], dropped: 1 })
})

test("a switched-off move on a cutaway another move plays on says so", () => {
  const inserts = [insert(word(11_000_000), 6_000_000, 2_000_000, "cover", 0)]
  const playing = move(word(11_000_000), [pose(0, 1), pose(1, 1.1)], { insert: true })
  const switchedOff = move(word(11_000_000), [pose(0, 1), pose(1, 1.2)], { insert: true, off: true })
  const { kept, off, dropped } = run([playing, switchedOff], { inserts })
  expect(kept.map((placed) => placed.cue)).toEqual([playing])
  expect(off).toEqual([{ cue: switchedOff, placed: expect.objectContaining({ insertIndex: 0 }), why: "another move plays on this cutaway" }])
  expect(dropped).toBe(0)
})

test("the views list the moves that play, then the switched-off ones, with what the page needs", () => {
  const playing = move(word(500_000), [pose(0, 1), pose(1, 1.1)], { pointId: "p1", instruction: "แรงขึ้น", previous: { poses: [pose(0, 1.05)], about: "เดิม" } })
  const switchedOff = move(word(3_000_000), [pose(0, 1.05)], { off: true, editFailed: "ไม่ผ่าน" })
  const gone = move(word(7_000_000), [pose(0, 1.05)], { off: true })
  expect(moveViews(run([switchedOff, playing, gone]))).toEqual([
    {
      anchor: playing.anchor,
      insert: false,
      atUs: 500_000,
      durationUs: 1_000_000,
      beatId: "b1",
      about: "ดันเข้า",
      from: "medium",
      pointId: "p1",
      edited: false,
      off: false,
      instruction: "แรงขึ้น",
      editFailed: null,
      canUndo: true,
    },
    {
      anchor: switchedOff.anchor,
      insert: false,
      atUs: 3_000_000,
      durationUs: 0,
      beatId: "b1",
      about: "ดันเข้า",
      from: "medium",
      edited: false,
      off: true,
      instruction: null,
      editFailed: "ไม่ผ่าน",
      canUndo: false,
    },
  ])
})

test("a legacy zoom on a piece with a move playing gives way to it; one on another piece plays on", () => {
  const slot = (cut: number): PieceSlot => ({ anchor: { videoId: V, sourceUs: plan.cuts[cut]!.sourceStartUs, beatId: "b1" }, atUs: [0, 5_000_000][cut]!, durationUs: plan.cuts[cut]!.sourceDurationUs, what: "", beatId: "b1", cut })
  const zoom = (cut: number): PlacedZoom => ({ cue: { anchor: slot(cut).anchor, kind: "punch", edited: false } as PlacedZoom["cue"], atUs: slot(cut).atUs, durationUs: slot(cut).durationUs })
  const { kept } = run([move(word(500_000), [pose(0, 1.1)])])
  const { inForce, replaced } = legacyZoomsBeside([zoom(0), zoom(1)], kept, [slot(0), slot(1)])
  expect(inForce).toEqual([zoom(1)])
  expect(replaced).toEqual([zoom(0)])
})

/** One scene the whole video long, with the face in the middle. */
const oneScene = () =>
  clipOf({ insight: { scenes: [{ startUs: 0, endUs: 20_000_000, keepClear: { fromY: 0.3, toY: 0.5 } }] } as unknown as CutClip["insight"], objects: { version: OBJECTS_VERSION, scenes: [[object(FACE_MIDDLE, { face: true })]] } })

const near = (boxes: { x0: number; y0: number; x1: number; y1: number }[], expected: { x0: number; y0: number; x1: number; y1: number }[]) => {
  expect(boxes).toHaveLength(expected.length)
  boxes.forEach((box, i) => {
    for (const key of ["x0", "y0", "x1", "y1"] as const) expect(box[key]).toBeCloseTo(expected[i]![key])
  })
}

test("with no move the face boxes are the plain ones", () => {
  near(faceBoxesIn({ startUs: 500_000, endUs: 1_000_000 }, [], plan, [clipOf()], CANVAS, at), [FACE_MIDDLE])
  expect(faceBandIn({ startUs: 500_000, endUs: 1_000_000 }, [], plan, [clipOf()], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.3), toY: expect.closeTo(0.5) })
  // the second scene keeps its face and its glass
  near(faceBoxesIn({ startUs: 3_000_000, endUs: 3_500_000 }, [], plan, [clipOf()], CANVAS, at), [FACE_RIGHT, GLASS])
  // nothing to keep, no band
  expect(faceBandIn({ startUs: 500_000, endUs: 1_000_000 }, [], plan, [clipOf({ objects: null, insight: { scenes: [] } as unknown as CutClip["insight"] })], CANVAS, at)).toBeNull()
})

test("a punch to 1.2 widens the face's band about the frame's middle, and a pan moves it", () => {
  const span = { startUs: 500_000, endUs: 1_000_000 }
  const punch: PlacedMove[] = run([move(word(0), [pose(0, 1.2)])], { clips: [oneScene()] }).kept
  expect(punch).toHaveLength(1)
  near(faceBoxesIn(span, punch, plan, [oneScene()], CANVAS, at), [{ x0: 0.38, y0: 0.26, x1: 0.62, y1: 0.5 }])
  expect(faceBandIn(span, punch, plan, [oneScene()], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.26), toY: expect.closeTo(0.5) })
  // pushed up a tenth of a half-frame, the face rises by a twentieth of the frame
  const pan = run([move(word(0), [pose(0, 1.2, { y: 0.1 })])], { clips: [oneScene()] }).kept
  expect(faceBandIn(span, pan, plan, [oneScene()], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.21), toY: expect.closeTo(0.45) })
  // over a span the move only reaches later, the band is the union of where the face went
  const push = run([move(word(0), [pose(0, 1), pose(1, 1.2)])], { clips: [oneScene()] }).kept
  expect(faceBandIn({ startUs: 0, endUs: 1_000_000 }, push, plan, [oneScene()], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.26), toY: expect.closeTo(0.5) })
})

test("on a later piece, a move starting after the piece's start leaves the face as it is before, then starts from rest", () => {
  // the second piece plays the video from 10 s, on the rough cut from 5 s; the move starts 2 s into it, at 7 s
  const moves = run([move(word(12_000_000), [pose(0, 1.2), pose(1, 1.2)])], { clips: [oneScene()] }).kept
  expect(moves[0]).toMatchObject({ cut: 1, startUs: 2_000_000, atUs: 7_000_000 })
  // before it, at rest
  expect(faceBandIn({ startUs: 6_000_000, endUs: 6_500_000 }, moves, plan, [oneScene()], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.3), toY: expect.closeTo(0.5) })
  // its first half second: from rest towards 1.2, so 1.1 at most, not the 1.2 of its own first pose
  expect(faceBandIn({ startUs: 7_000_000, endUs: 7_500_000 }, moves, plan, [oneScene()], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.28), toY: expect.closeTo(0.5) })
  // the piece is where `at` puts it: half a second later, the move has not started there yet
  const later = (cut: number, sourceUs: number) => at(cut, sourceUs) + (cut === 1 ? 500_000 : 0)
  expect(faceBandIn({ startUs: 7_000_000, endUs: 7_500_000 }, moves, plan, [oneScene()], CANVAS, later)).toMatchObject({ fromY: expect.closeTo(0.3), toY: expect.closeTo(0.5) })
  // then at 1.2
  expect(faceBandIn({ startUs: 8_000_000, endUs: 9_000_000 }, moves, plan, [oneScene()], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.26), toY: expect.closeTo(0.5) })
})

test("a video of another shape than the canvas has its faces where it is drawn", () => {
  // a square video on the portrait canvas is drawn as a band across the middle, from 0.21875 to 0.78125 of the height
  const square = clipOf({ width: 1920, height: 1920, insight: oneScene().insight, objects: oneScene().objects })
  expect(faceBandIn({ startUs: 500_000, endUs: 1_000_000 }, [], plan, [square], CANVAS, at)).toMatchObject({ fromY: expect.closeTo(0.3875), toY: expect.closeTo(0.5) })
})
