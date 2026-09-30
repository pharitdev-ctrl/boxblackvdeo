import { expect, test } from "vitest"
import type { CutPlan, EmphasisPointView, GraphicView, HighlightPreview } from "../../../shared/api.ts"
import { emphasisView, highlightPreview } from "../../test/fake-api.ts"
import { byBeat, wholeClip } from "./byBeat.ts"

const plan = { durationUs: 12_000_000, cuts: [], beats: [{ beatId: "b1" }, { beatId: "b2" }, { beatId: "b3" }] } as unknown as CutPlan
const point = (id: string, beatId: string, atUs: number, shown = true) => ({ id, beatId, atUs, shown }) as unknown as EmphasisPointView

const anchor = (line: number) => ({ kind: "highlight" as const, groupId: `g${line}`, line })
const graphic = (summary: string, beatId: string, atUs: number, off = false) =>
  ({
    anchor: { kind: "speech", videoId: "a", sourceUs: atUs, beatId },
    atUs,
    durationUs: 3_000_000,
    what: summary,
    beatId,
    why: "",
    summary,
    spec: {},
    render: off ? "waiting" : "ready",
    poster: null,
    error: null,
    edited: false,
    off,
  }) as unknown as GraphicView
const group = (id: string, beatId: string, startUs: number) =>
  ({ id, beatId, source: "ai", placement: "fixed", look: { pattern: "stack", accent: null, exit: null, edited: false }, startUs, endUs: startUs + 1, lines: [] }) as unknown as HighlightPreview["groups"][number]

const preview = () =>
  highlightPreview({
    groups: [group("g2", "b3", 9_000_000), group("g1", "b1", 1_000_000), group("g3", "b1", 0)],
    slots: [
      { anchor: anchor(0), atUs: 5_000_000, what: "ปลายบีต 1", beatId: "b1" },
      { anchor: anchor(1), atUs: 1_000_000, what: "ต้นบีต 1", beatId: "b1" },
      { anchor: anchor(2), atUs: 8_000_000, what: "บีต 3", beatId: "b3" },
    ],
    cues: [{ anchor: anchor(1), atUs: 1_000_000, what: "ต้นบีต 1", beatId: "b1", effectId: "s1", soundName: "ปัง", edited: false }],
    inserts: [{ anchor: anchor(2), atUs: 8_000_000, durationUs: 2_000_000, what: "บีต 3", beatId: "b3", binId: "m1", fit: "cover" as const, picture: "หน้าร้าน", edited: true }],
    pieces: [
      { anchor: { videoId: "a", sourceUs: 9_000_000 }, atUs: 6_000_000, durationUs: 2_000_000, what: "ชิ้นท้าย", beatId: "b2" },
      { anchor: { videoId: "a", sourceUs: 0 }, atUs: 0, durationUs: 3_000_000, what: "ชิ้นแรก", beatId: "b2" },
    ],
    zooms: [{ anchor: { videoId: "a", sourceUs: 0 }, atUs: 0, durationUs: 3_000_000, what: "ชิ้นแรก", beatId: "b2", kind: "punch", edited: false }],
  })

test("every beat of the plan gets an entry, even one with nothing on it", () => {
  const beats = byBeat(preview(), plan)
  expect([...beats.keys()]).toEqual(["b1", "b2", "b3"])
})

test("each thing lands in its own beat", () => {
  const beats = byBeat(preview(), plan)
  expect(beats.get("b1")!.groups.map((group) => group.id)).toEqual(["g3", "g1"])
  expect(beats.get("b1")!.cues.map((cue) => cue.soundName)).toEqual(["ปัง"])
  expect(beats.get("b2")!.zooms.map((zoom) => zoom.kind)).toEqual(["punch"])
  expect(beats.get("b3")!.inserts.map((insert) => insert.picture)).toEqual(["หน้าร้าน"])
  expect(beats.get("b3")!.groups.map((group) => group.id)).toEqual(["g2"])
  expect(beats.get("b2")!.groups).toEqual([])
})

test("what a beat holds is in the order it plays", () => {
  const beats = byBeat(preview(), plan)
  expect(beats.get("b1")!.slots.map((slot) => slot.what)).toEqual(["ต้นบีต 1", "ปลายบีต 1"])
  expect(beats.get("b2")!.pieces.map((piece) => piece.what)).toEqual(["ชิ้นแรก", "ชิ้นท้าย"])
})

test("the counts are what the sidebar shows", () => {
  const beats = byBeat(preview(), plan)
  expect(beats.get("b1")!.counts).toEqual({ text: 2, sound: 1, zoom: 0, insert: 0, graphic: 0, emphasis: 0 })
  expect(beats.get("b2")!.counts).toEqual({ text: 0, sound: 0, zoom: 1, insert: 0, graphic: 0, emphasis: 0 })
  expect(beats.get("b3")!.counts).toEqual({ text: 1, sound: 0, zoom: 0, insert: 1, graphic: 0, emphasis: 0 })
})

test("graphics land in their beat in the order they play, the switched-off ones among them", () => {
  // the preview lists the ones that play first, then the ones switched off
  const beats = byBeat(
    highlightPreview({ graphics: [graphic("ท้าย", "b2", 7_000_000), graphic("ต้น", "b2", 6_000_000), graphic("ปิดไว้", "b2", 6_500_000, true), graphic("เปิด", "b1", 1_000_000)] }),
    plan,
  )
  expect(beats.get("b1")!.graphics.map((one) => one.summary)).toEqual(["เปิด"])
  expect(beats.get("b2")!.graphics.map((one) => one.summary)).toEqual(["ต้น", "ปิดไว้", "ท้าย"])
  expect(beats.get("b3")!.graphics).toEqual([])
})

test("a graphic switched off is listed but not counted, since it does not play", () => {
  const beats = byBeat(highlightPreview({ graphics: [graphic("เล่น", "b1", 1_000_000), graphic("ปิดไว้", "b1", 2_000_000, true)] }), plan)
  expect(beats.get("b1")!.counts.graphic).toBe(1)
})

test("a group a graphic takes the place of is listed but not counted as text, since it is not drawn", () => {
  const shown = highlightPreview({ groups: [group("g1", "b1", 1_000_000), { ...group("g4", "b1", 2_000_000), replaced: true }, group("g2", "b3", 9_000_000)] })
  const beats = byBeat(shown, plan)
  expect(beats.get("b1")!.groups.map((one) => one.id)).toEqual(["g1", "g4"])
  expect(beats.get("b1")!.counts.text).toBe(1)
  expect(beats.get("b3")!.counts.text).toBe(1)
  expect(wholeClip(shown).groups).toHaveLength(3)
  expect(wholeClip(shown).counts.text).toBe(2)
})

test("something whose beat is not on the rough cut goes to the last beat, points too", () => {
  const stray = highlightPreview({
    groups: [group("gx", "gone", 4_000_000)],
    cues: [{ anchor: anchor(9), atUs: 4_000_000, what: "หาย", beatId: "gone", effectId: "s1", soundName: "ปัง", edited: false }],
    graphics: [graphic("หลง", "gone", 4_000_000)],
    emphasis: emphasisView({ points: [point("px", "gone", 4_000_000)] }),
  })
  const beats = byBeat(stray, plan)
  expect(beats.get("b3")!.points.map((one) => one.id)).toEqual(["px"])
  expect(beats.get("b3")!.groups.map((group) => group.id)).toEqual(["gx"])
  expect(beats.get("b3")!.counts.sound).toBe(1)
  expect(beats.get("b3")!.graphics.map((one) => one.summary)).toEqual(["หลง"])
})

test("a plan with no beats holds nothing", () => {
  const beats = byBeat(preview(), { durationUs: 0, cuts: [], beats: [] } as unknown as CutPlan)
  expect(beats.size).toBe(0)
})

test("points land in their beat in playing order, and only those that pass the level are counted", () => {
  const withPoints = { ...preview(), emphasis: emphasisView({ points: [point("p2", "b1", 3_000_000), point("p1", "b1", 1_000_000), point("p3", "b3", 9_000_000, false)] }) }
  const beats = byBeat(withPoints, plan)
  expect(beats.get("b1")!.points.map((one) => one.id)).toEqual(["p1", "p2"])
  expect(beats.get("b1")!.counts.emphasis).toBe(2)
  expect(beats.get("b3")!.points.map((one) => one.id)).toEqual(["p3"])
  expect(beats.get("b3")!.counts.emphasis).toBe(0)
})

test("the whole clip holds everything in playing order, whatever its beat, and counts it all", () => {
  const whole = wholeClip({ ...preview(), emphasis: emphasisView({ points: [point("p1", "b3", 9_000_000), point("p2", "gone", 1_000_000)] }) })
  expect(whole.groups.map((group) => group.id)).toEqual(["g3", "g1", "g2"])
  expect(whole.slots.map((slot) => slot.what)).toEqual(["ต้นบีต 1", "ปลายบีต 1", "บีต 3"])
  expect(whole.points.map((one) => one.id)).toEqual(["p2", "p1"])
  expect(whole.counts).toEqual({ text: 3, sound: 1, zoom: 1, insert: 1, graphic: 0, emphasis: 2 })
})
