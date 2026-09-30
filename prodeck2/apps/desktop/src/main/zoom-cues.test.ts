import { expect, test } from "vitest"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { ZoomCue } from "@boxblack/core/flair/plan"
import type { TimedGroup } from "@boxblack/core/highlights"
import type { PlacedPoint } from "@boxblack/core/emphasis"
import { faceYOf, pieceKey, pointPiece, punchAtUs, samePiece, zoomSlotsFor, zoomsInForce } from "./zoom-cues.ts"

const V = "v1"
const piece = (startUs: number, endUs: number) => ({ startUs, endUs })

/** Three pieces: 5 s, 1 s (too short to zoom) and 6 s, in two beats. */
const plan = {
  durationUs: 12_000_000,
  cuts: [
    { binId: V, sourceStartUs: 0, sourceDurationUs: 5_000_000 },
    { binId: V, sourceStartUs: 9_000_000, sourceDurationUs: 1_000_000 },
    { binId: V, sourceStartUs: 14_000_000, sourceDurationUs: 6_000_000 },
  ],
  beats: [
    { beatId: "b1", videoId: V, pieces: [piece(0, 5_000_000), piece(9_000_000, 10_000_000)] },
    { beatId: "b2", videoId: V, pieces: [piece(14_000_000, 20_000_000)] },
  ],
} as unknown as CutPlan

const at = (cut: number, sourceUs: number) => {
  const starts = [0, 5_000_000, 6_000_000]
  const pieces = [0, 9_000_000, 14_000_000]
  return starts[cut]! + sourceUs - pieces[cut]!
}

const groups: TimedGroup[] = [
  { groupId: "g1", beatId: "b2", startUs: 8_000_000, endUs: 10_000_000, lines: [{ lineIndex: 0, text: "ราคา", startUs: 8_000_000, partial: false }] } as unknown as TimedGroup,
]
const beatNames = new Map([
  ["b1", "เปิดคลิป"],
  ["b2", "รีวิว"],
])
const slots = () => zoomSlotsFor({ plan, groups, beatNames, at })

test("every piece with room offers a zoom, and a short one does not", () => {
  expect(slots().map((slot) => [slot.atUs, slot.durationUs, slot.what])).toEqual([
    [0, 5_000_000, 'ช่วง "เปิดคลิป"'],
    [6_000_000, 6_000_000, 'ช่วง "รีวิว" มีข้อความเด่น "ราคา"'],
  ])
  expect(slots()[0]!.anchor).toEqual({ videoId: V, sourceUs: 0, beatId: "b1" })
})

test("a punch lands on the highlight line inside its piece, else at the start", () => {
  const [first, second] = slots()
  expect(punchAtUs(first!, groups)).toBe(0)
  // the line plays at 8 s and the piece starts at 6 s
  expect(punchAtUs(second!, groups)).toBe(2_000_000)
})

const clip = (scenes: unknown[]): CutClip => ({ id: V, insight: { scenes } } as unknown as CutClip)
const scene = (startUs: number, endUs: number, band: { fromY: number; toY: number } | null) => ({ startUs, endUs, keepClear: band })

test("the face's height comes from the bands the picture must keep clear", () => {
  // a face from 20 % to 60 % down the frame has its middle at 40 %, which is +0.2 in CapCut's units
  const clips = [clip([scene(0, 6_000_000, { fromY: 0.2, toY: 0.6 })])]
  expect(faceYOf(clips, { videoId: V, sourceUs: 0 }, 5_000_000)).toBeCloseTo(0.2, 9)

  // a piece playing over two scenes takes both bands together
  const two = [clip([scene(0, 3_000_000, { fromY: 0.2, toY: 0.4 }), scene(3_000_000, 6_000_000, { fromY: 0.5, toY: 0.8 })])]
  expect(faceYOf(two, { videoId: V, sourceUs: 0 }, 5_000_000)).toBeCloseTo(1 - (0.2 + 0.8), 9)
})

test("no picture, or no band, means the zoom moves around the middle", () => {
  expect(faceYOf([], { videoId: V, sourceUs: 0 }, 5_000_000)).toBe(0)
  expect(faceYOf([clip([scene(0, 6_000_000, null)])], { videoId: V, sourceUs: 0 }, 5_000_000)).toBe(0)
  // a scene that does not play where the piece does says nothing about it
  expect(faceYOf([clip([scene(30_000_000, 40_000_000, { fromY: 0.2, toY: 0.6 })])], { videoId: V, sourceUs: 0 }, 5_000_000)).toBe(0)
})

const ON: FlairOptions = { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: false }
const zoom = (index: number, kind: "punch" | "drift" = "punch", edited = false): ZoomCue => ({ anchor: slots()[index]!.anchor, kind, edited })
const inForce = (zooms: ZoomCue[], flair: FlairOptions = ON) => zoomsInForce({ zooms, slots: slots(), flair, durationUs: plan.durationUs, passes: () => true })

test("a stored zoom plays on the piece it is anchored to", () => {
  const { kept, dropped } = inForce([zoom(0, "drift")])
  expect(dropped).toBe(0)
  expect(kept.map((placed) => [placed.atUs, placed.durationUs, placed.cue.kind])).toEqual([[0, 5_000_000, "drift"]])
})

test("the rules still apply to what is left, and no level holds a zoom back", () => {
  // the two pieces start six seconds apart: both play at every level, the lightest included
  expect(inForce([zoom(0), zoom(1)], { ...ON, level: "light" }).kept).toHaveLength(2)
  expect(inForce([zoom(0), zoom(1)], { ...ON, level: "medium" }).kept).toHaveLength(2)
  // a drift on a piece long enough stays a drift; the rules would turn a short one into a punch
  expect(inForce([zoom(1, "drift")]).kept.map((placed) => placed.cue.kind)).toEqual(["drift"])
  // a piece carries one zoom: the user's wins, the other is dropped
  expect(inForce([zoom(0, "punch"), zoom(0, "drift", true)])).toMatchObject({ kept: [{ cue: { kind: "drift", edited: true } }], dropped: 1, lost: 0 })
})

test("a zoom whose piece is gone is lost, not dropped: the cut moved its start", () => {
  const gone: ZoomCue = { anchor: { videoId: V, sourceUs: 99_000_000 }, kind: "punch", edited: false }
  expect(inForce([gone])).toEqual({ kept: [], dropped: 0, lost: 1 })
})

test("with the zooms switched off nothing moves; the old switch for all flair is not read", () => {
  expect(inForce([zoom(0)], { ...ON, zoom: false, insert: true })).toEqual({ kept: [], dropped: 0, lost: 0 })
  expect(inForce([zoom(0)], { ...ON, enabled: false }).kept).toHaveLength(1)
})

test("a zoom on an emphasis point the level hides waits: it is neither kept, dropped nor lost", () => {
  const hidden: ZoomCue = { ...zoom(0), pointId: "p" }
  const hiddenGone: ZoomCue = { anchor: { videoId: V, sourceUs: 99_000_000 }, kind: "punch", edited: false, pointId: "p" }
  const shown: ZoomCue = { ...zoom(1), pointId: "q" }
  const result = zoomsInForce({ zooms: [hidden, hiddenGone, shown], slots: slots(), flair: ON, durationUs: plan.durationUs, passes: (id) => id !== "p" })
  expect(result.kept.map((placed) => placed.cue.pointId)).toEqual(["q"])
  expect([result.dropped, result.lost]).toEqual([0, 0])
})

test("a piece is one key however its anchor is written", () => {
  expect(pieceKey({ videoId: V, sourceUs: 0 })).toBe(pieceKey({ videoId: V, sourceUs: 0 }))
  expect(pieceKey({ videoId: V, sourceUs: 0 })).not.toBe(pieceKey({ videoId: V, sourceUs: 1 }))
})

test("every piece says which beat it sits in", () => {
  expect(slots().map((slot) => [slot.atUs, slot.beatId])).toEqual([
    [0, "b1"],
    [6_000_000, "b2"],
  ])
})

/** The same footage played in two beats: a hook that opens on the line the review says later. */
const twice = {
  durationUs: 9_000_000,
  cuts: [
    { binId: V, sourceStartUs: 14_000_000, sourceDurationUs: 3_000_000 },
    { binId: V, sourceStartUs: 0, sourceDurationUs: 3_000_000 },
    { binId: V, sourceStartUs: 14_000_000, sourceDurationUs: 3_000_000 },
  ],
  beats: [
    { beatId: "hook", videoId: V, pieces: [piece(14_000_000, 17_000_000)] },
    { beatId: "b1", videoId: V, pieces: [piece(0, 3_000_000)] },
    { beatId: "b2", videoId: V, pieces: [piece(14_000_000, 17_000_000)] },
  ],
} as unknown as CutPlan
const twiceSlots = () => zoomSlotsFor({ plan: twice, groups: [], beatNames, at: (cut, sourceUs) => cut * 3_000_000 + sourceUs - [14_000_000, 0, 14_000_000][cut]! })
const twiceInForce = (zooms: ZoomCue[]) => zoomsInForce({ zooms, slots: twiceSlots(), flair: ON, durationUs: twice.durationUs, passes: () => true })

test("footage played in two beats is two pieces, each named by its beat", () => {
  const [hook, , review] = twiceSlots()
  expect(hook!.anchor).toEqual({ videoId: V, sourceUs: 14_000_000, beatId: "hook" })
  expect(review!.anchor).toEqual({ videoId: V, sourceUs: 14_000_000, beatId: "b2" })
  expect(pieceKey(hook!.anchor)).not.toBe(pieceKey(review!.anchor))
})

test("a zoom on footage played twice plays in the beat it was put on, and each beat can have its own", () => {
  const [hook, , review] = twiceSlots()
  const on = (anchor: typeof hook, kind: "punch" | "drift"): ZoomCue => ({ anchor: anchor!.anchor, kind, edited: true })
  expect(twiceInForce([on(hook, "drift")]).kept.map((placed) => [placed.atUs, placed.cue.kind])).toEqual([[0, "drift"]])
  expect(twiceInForce([on(review, "punch")]).kept.map((placed) => [placed.atUs, placed.cue.kind])).toEqual([[6_000_000, "punch"]])
  expect(twiceInForce([on(review, "punch"), on(hook, "drift")]).kept.map((placed) => [placed.atUs, placed.cue.kind])).toEqual([
    [0, "drift"],
    [6_000_000, "punch"],
  ])
})

test("a zoom saved before zooms knew their beat stays where it always played, on the last time its footage plays", () => {
  const { kept, dropped } = twiceInForce([{ anchor: { videoId: V, sourceUs: 14_000_000 }, kind: "punch", edited: true }])
  expect(dropped).toBe(0)
  expect(kept.map((placed) => placed.atUs)).toEqual([6_000_000])
  // and it is shown on that piece, by the piece's own anchor
  expect(kept[0]!.cue.anchor).toEqual({ videoId: V, sourceUs: 14_000_000, beatId: "b2" })
})

test("two anchors name the same piece when the footage and the beat match; one without a beat may be either", () => {
  const at = (beatId?: string) => ({ videoId: V, sourceUs: 14_000_000, ...(beatId !== undefined ? { beatId } : {}) })
  expect(samePiece(at("hook"), at("hook"))).toBe(true)
  expect(samePiece(at("hook"), at("b2"))).toBe(false)
  expect(samePiece(at(), at("b2"))).toBe(true)
  expect(samePiece(at("hook"), at())).toBe(true)
  expect(samePiece(at("hook"), { videoId: V, sourceUs: 0, beatId: "hook" })).toBe(false)
  expect(samePiece(at("hook"), { videoId: "v2", sourceUs: 14_000_000, beatId: "hook" })).toBe(false)
})

test("a point zooms on the piece its first kept moment plays in, when that piece has room; otherwise on none", () => {
  const point = (cut: number): PlacedPoint => ({
    point: { id: "p", anchor: { kind: "speech", videoId: V, from: 0, to: 1, beatId: "b1" }, importance: "key", type: "hook", reason: "", source: "ai", edited: false },
    videoId: V,
    beatId: "b1",
    cut,
    sourceUs: 0,
    atUs: 0,
    endUs: 1,
  })
  expect(pointPiece(slots(), point(2))).toMatchObject({ cut: 2, anchor: { videoId: V, sourceUs: 14_000_000, beatId: "b2" } })
  // the second piece is 1 s long: too short to zoom
  expect(pointPiece(slots(), point(1))).toBeNull()
})
