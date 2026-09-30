import { expect, test } from "vitest"
import type { TimedText } from "../asr/types.ts"
import type { CutPlan } from "../cut/compile.ts"
import type { BeatCut } from "../cut/rules.ts"
import type { InsertCue, SoundCue, ZoomCue } from "../flair/plan.ts"
import type { GraphicCue } from "../graphics/plan.ts"
import { placeHighlights, type HighlightGroup } from "../highlights/placement.ts"
import { placePoints, pointFilter, pointsOverlap } from "./filter.ts"
import { EMPTY_EMPHASIS, LEVEL_IMPORTANCE, passesLevel, type EmphasisAnchor, type EmphasisPoint, type Importance } from "./types.ts"

const S = 1_000_000

/** Word i of video v1 is said from 1.0 s + 0.5 s × i, for 0.4 s. */
const words: TimedText[] = Array.from({ length: 18 }, (_, i) => ({ text: `w${i}`, startUs: S + (S / 2) * i, endUs: S + (S / 2) * i + 400_000 }))
const wordsOf = (videoId: string) => (videoId === "v1" ? words : [])

const beat = (beatId: string, videoId: string, pieces: [number, number][]): BeatCut => ({
  beatId,
  videoId,
  pieces: pieces.map(([startUs, endUs]) => ({ startUs, endUs })),
  removals: [],
  originalUs: 0,
  keptUs: 0,
  notes: [],
  rows: [],
})

// On the rough cut, back to back:
//   cut 0  b1 v1 1.0–3.0 s  at 0.0     cut 1  b1 v1 4.1–6.0 s  at 2.0
//   cut 2  b2 v1 8.0–9.8 s  at 3.9     cut 3  b3 v2 0.0–2.0 s  at 5.7     cut 4  b3 v2 5.0–8.0 s  at 7.7
//   cut 5  b4 v1 2.0–3.0 s  at 10.7 (b1's words played again)            cut 6  b5 v2 0.0–1.0 s  at 11.7 (b3's picture played again)
const beats = [
  beat("b1", "v1", [
    [1_000_000, 3_000_000],
    [4_100_000, 6_000_000],
  ]),
  beat("b2", "v1", [[8_000_000, 9_800_000]]),
  beat("b3", "v2", [
    [0, 2_000_000],
    [5_000_000, 8_000_000],
  ]),
  beat("b4", "v1", [[2_000_000, 3_000_000]]),
  beat("b5", "v2", [[0, 1_000_000]]),
]
const plan: CutPlan = {
  beats,
  cuts: beats.flatMap((b) => b.pieces.map((p) => ({ binId: b.videoId, sourceStartUs: p.startUs, sourceDurationUs: p.endUs - p.startUs }))),
  durationUs: 12_700_000,
}

const speech = (id: string, from: number, to: number, beatId: string, importance: Importance = "key", videoId = "v1"): EmphasisPoint => ({
  id,
  anchor: { kind: "speech", videoId, from, to, beatId },
  importance,
  type: "number",
  reason: "",
  source: "ai",
  edited: false,
})
const scene = (id: string, startUs: number, endUs: number, beatId: string, importance: Importance = "key"): EmphasisPoint => ({
  id,
  anchor: { kind: "scene", videoId: "v2", startUs, endUs, beatId },
  importance,
  type: "visual",
  reason: "",
  source: "ai",
  edited: false,
})

const placeOne = (point: EmphasisPoint) => {
  const placed = placePoints({ points: [point], plan, wordsOf })
  expect(placed.length).toBeLessThanOrEqual(1)
  return placed[0] ? { beatId: placed[0].beatId, cut: placed[0].cut, sourceUs: placed[0].sourceUs, atUs: placed[0].atUs, endUs: placed[0].endUs } : null
}

test("a speech point plays from its first kept word to the end of its last, in its own beat", () => {
  const point = speech("p1", 2, 4, "b1")
  expect(placePoints({ points: [point], plan, wordsOf })).toEqual([{ point, videoId: "v1", beatId: "b1", cut: 0, sourceUs: 2_000_000, atUs: 1_000_000, endUs: 1_900_000 }])
})

test("words two beats both play are placed in the point's own beat", () => {
  expect(placeOne(speech("p1", 2, 4, "b4"))).toEqual({ beatId: "b4", cut: 5, sourceUs: 2_000_000, atUs: 10_700_000, endUs: 11_600_000 })
})

test("words its own beat does not play are placed where they play first, and that beat is the one it plays in", () => {
  expect(placeOne(speech("p1", 0, 2, "b2"))).toEqual({ beatId: "b1", cut: 0, sourceUs: 1_000_000, atUs: 0, endUs: 900_000 })
})

test("a point whose middle words were cut spans from its first kept word to its last", () => {
  // word 3 plays in cut 0; words 4 and 5 were cut; word 6 plays in cut 1
  expect(placeOne(speech("p1", 3, 7, "b1"))).toEqual({ beatId: "b1", cut: 0, sourceUs: 2_500_000, atUs: 1_500_000, endUs: 2_300_000 })
})

test("a first word that starts before its piece starts the point where the piece starts; a last word that runs past its piece ends it there", () => {
  // word 6 is said 4.0–4.4 s, its piece starts at 4.1 s
  expect(placeOne(speech("p1", 6, 8, "b1"))).toEqual({ beatId: "b1", cut: 1, sourceUs: 4_100_000, atUs: 2_000_000, endUs: 2_800_000 })
  // word 17 is said 9.5–9.9 s, its piece ends at 9.8 s; the anchor runs past the transcript's end
  expect(placeOne(speech("p1", 16, 40, "b2"))).toEqual({ beatId: "b2", cut: 2, sourceUs: 9_000_000, atUs: 4_900_000, endUs: 5_700_000 })
})

test("a speech point whose words play in two beats is placed wholly in one: its own when it plays any of them, else the one its first kept word plays in", () => {
  // words 2 and 3 play in b4's piece at 10.7 s; words 4 and 5 were cut; words 6 and 7 play only in b1, so they are left out
  expect(placeOne(speech("p1", 2, 8, "b4"))).toEqual({ beatId: "b4", cut: 5, sourceUs: 2_000_000, atUs: 10_700_000, endUs: 11_600_000 })
  // words 0 and 1 play only in b1, at the start of the clip; b4 plays words 2 and 3, so the point is those two, in b4
  expect(placeOne(speech("p1", 0, 4, "b4"))).toEqual({ beatId: "b4", cut: 5, sourceUs: 2_000_000, atUs: 10_700_000, endUs: 11_600_000 })
  // its own beat is gone: words 8 and 9 play first, in b1's cut 1; words 14 and 15, in b2, are left out
  expect(placeOne(speech("p1", 8, 16, "gone"))).toEqual({ beatId: "b1", cut: 1, sourceUs: 5_000_000, atUs: 2_900_000, endUs: 3_800_000 })
})

test("a point placed outside its own beat takes every word that beat plays, also one another beat plays first", () => {
  // a1 plays v1 2.5–3.0 s first, b1 plays 2.0–3.0 s after it: word 2 (2.0 s) plays only in b1, word 3 (2.5 s) in both
  const a1 = beat("a1", "v1", [[2_500_000, 3_000_000]])
  const b1 = beat("b1", "v1", [[2_000_000, 3_000_000]])
  const twice: CutPlan = { beats: [a1, b1], cuts: [a1, b1].map((b) => ({ binId: "v1", sourceStartUs: b.pieces[0]!.startUs, sourceDurationUs: b.pieces[0]!.endUs - b.pieces[0]!.startUs })), durationUs: 1_500_000 }
  const [placed] = placePoints({ points: [speech("p1", 2, 4, "gone")], plan: twice, wordsOf })
  expect({ beatId: placed!.beatId, cut: placed!.cut, atUs: placed!.atUs, endUs: placed!.endUs }).toEqual({ beatId: "b1", cut: 1, atUs: 500_000, endUs: 1_400_000 })
})

test("a speech point never ends before it starts, even in a beat that plays its footage out of order", () => {
  // one beat plays v1 4.1–6.0 s first, then 1.0–3.0 s: word 3 (2.5 s) plays at 3.4 s, word 6 (4.0 s) at 0.0 s
  const backwards = beat("b1", "v1", [
    [4_100_000, 6_000_000],
    [1_000_000, 3_000_000],
  ])
  const shuffled: CutPlan = { beats: [backwards], cuts: backwards.pieces.map((p) => ({ binId: "v1", sourceStartUs: p.startUs, sourceDurationUs: p.endUs - p.startUs })), durationUs: 3_900_000 }
  const [placed] = placePoints({ points: [speech("p1", 3, 7, "b1")], plan: shuffled, wordsOf })
  expect({ cut: placed!.cut, sourceUs: placed!.sourceUs, atUs: placed!.atUs, endUs: placed!.endUs }).toEqual({ cut: 1, sourceUs: 2_500_000, atUs: 3_400_000, endUs: 3_400_000 })
})

test("a speech point starts and ends where a highlight line on the same words, picked in the same beat, does", () => {
  // spec §4.1: a point finds its time the way placeHighlights does; this keeps filter.ts's copy of that rule from drifting away from placement.ts
  const starts = plan.cuts.map((_, i) => plan.cuts.slice(0, i).reduce((sum, cut) => sum + cut.sourceDurationUs, 0))
  const at = (where: { cut: number; sourceUs: number }) => starts[where.cut]! + where.sourceUs - plan.cuts[where.cut]!.sourceStartUs
  const cases: [number, number, string][] = [
    [2, 4, "b4"],
    [0, 2, "b2"],
    [3, 7, "b1"],
    [6, 8, "b1"],
    [16, 40, "b2"],
  ]
  for (const [from, to, beatId] of cases) {
    const [group] = placeHighlights({ plan, wordsOf, groups: [{ id: "g", source: "ai", edited: false, beatId, lines: [{ videoId: "v1", from, to, text: "" }] }] })
    const [placed] = placePoints({ points: [speech("p", from, to, beatId)], plan, wordsOf })
    expect({ beatId: placed!.beatId, cut: placed!.cut, sourceUs: placed!.sourceUs, endUs: placed!.endUs }).toEqual({
      beatId: group!.beatId,
      cut: group!.lines[0]!.cut,
      sourceUs: group!.lines[0]!.sourceUs,
      endUs: at(group!.end),
    })
  }
})

test("a speech point with no kept word, or on a video with no words, is left out", () => {
  expect(placeOne(speech("p1", 4, 6, "b1"))).toBeNull()
  expect(placeOne(speech("p1", 10, 14, "b1"))).toBeNull()
  expect(placeOne(speech("p1", 0, 3, "b3", "key", "v9"))).toBeNull()
})

test("a scene point plays where its stretch overlaps its beat's kept pieces, cut gaps included", () => {
  expect(placeOne(scene("p1", 1_000_000, 6_000_000, "b3"))).toEqual({ beatId: "b3", cut: 3, sourceUs: 1_000_000, atUs: 6_700_000, endUs: 8_700_000 })
  // it starts in the part cut away: it plays from where the next kept piece starts
  expect(placeOne(scene("p1", 3_000_000, 7_000_000, "b3"))).toEqual({ beatId: "b3", cut: 4, sourceUs: 5_000_000, atUs: 7_700_000, endUs: 9_700_000 })
})

test("a scene whose stretch only touches kept pieces, or falls wholly in a cut, is left out", () => {
  expect(placeOne(scene("p1", 2_000_000, 5_000_000, "b3"))).toBeNull()
  expect(placeOne(scene("p1", 2_500_000, 4_000_000, "b3"))).toBeNull()
})

test("a picture two beats play is placed in the point's own beat, else in the first beat that plays it, never across both", () => {
  expect(placeOne(scene("p1", 0, 1_500_000, "b5"))).toEqual({ beatId: "b5", cut: 6, sourceUs: 0, atUs: 11_700_000, endUs: 12_700_000 })
  expect(placeOne(scene("p1", 0, 1_500_000, "gone"))).toEqual({ beatId: "b3", cut: 3, sourceUs: 0, atUs: 5_700_000, endUs: 7_200_000 })
})

test("points come back in playing order, whatever order they are stored in", () => {
  const placed = placePoints({ points: [speech("late", 2, 4, "b4"), scene("middle", 1_000_000, 6_000_000, "b3"), speech("early", 2, 4, "b1"), speech("cut", 4, 6, "b1")], plan, wordsOf })
  expect(placed.map((one) => one.point.id)).toEqual(["early", "middle", "late"])
})

test("each level lets its importances through: light the key points, medium key and secondary, heavy all", () => {
  expect(LEVEL_IMPORTANCE).toEqual({ light: ["key"], medium: ["key", "secondary"], heavy: ["key", "secondary", "extra"] })
  expect(passesLevel("key", "light")).toBe(true)
  expect(passesLevel("secondary", "light")).toBe(false)
  expect(passesLevel("secondary", "medium")).toBe(true)
  expect(passesLevel("extra", "medium")).toBe(false)
  expect(passesLevel("extra", "heavy")).toBe(true)
  expect(EMPTY_EMPHASIS).toEqual({ points: [], version: 0, plannedOn: { graphics: null, sounds: null }, transcripts: {} })
  // one copy is shared by every outline with no points: nothing may change it
  expect([EMPTY_EMPHASIS, EMPTY_EMPHASIS.points, EMPTY_EMPHASIS.plannedOn, EMPTY_EMPHASIS.transcripts].map((part) => Object.isFrozen(part))).toEqual([true, true, true, true])
})

test("the filter lets through items bound to no point, and items on a placed point the level lets through", () => {
  const points = [speech("k", 2, 4, "b1", "key"), scene("s", 1_000_000, 6_000_000, "b3", "secondary"), speech("x", 6, 8, "b1", "extra"), speech("gone", 4, 6, "b1", "key")]
  const placed = placePoints({ points, plan, wordsOf })
  const shows = (level: "light" | "medium" | "heavy") => [undefined, "k", "s", "x", "gone", "never-stored"].map((id) => pointFilter(placed, level)(id))
  // an item on a point cut away, or on a point that is not stored, never shows
  expect(shows("light")).toEqual([true, true, false, false, false, false])
  expect(shows("medium")).toEqual([true, true, true, false, false, false])
  expect(shows("heavy")).toEqual([true, true, true, true, false, false])
})

test("type check: every kind of item takes an optional pointId, and that field is what pointFilter reads", () => {
  const anchor = { kind: "speech", videoId: "v1", sourceUs: 2_000_000, beatId: "b1" } as const
  const group: HighlightGroup = { id: "g1", source: "ai", edited: false, lines: [], beatId: "b1", pointId: "k" }
  const sound: SoundCue = { anchor, effectId: "e1", edited: false, pointId: "k" }
  const zoom: ZoomCue = { anchor: { videoId: "v1", sourceUs: 1_000_000, beatId: "b1" }, kind: "punch", edited: false, pointId: "x" }
  const insert: InsertCue = { anchor, binId: "m1", edited: false, pointId: "x" }
  const graphic: GraphicCue = {
    anchor,
    spec: { kind: "motion", version: "motion-1", box: { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.8 }, seconds: 3, why: "", idea: "จรวดพุ่งขึ้น", words: [], html: null },
    edited: false,
    off: false,
  }
  const passes = pointFilter(placePoints({ points: [speech("k", 2, 4, "b1", "key"), speech("x", 6, 8, "b1", "extra")], plan, wordsOf }), "light")
  expect([group, sound, zoom, insert, graphic].map((item) => passes(item.pointId))).toEqual([true, true, false, false, true])
})

test("two points overlap when they claim the same words, or the same stretch of picture, in the same beat", () => {
  const said = (from: number, to: number, beatId = "b1", videoId = "v1"): EmphasisAnchor => ({ kind: "speech", videoId, from, to, beatId })
  const picture = (startUs: number, endUs: number, beatId = "b3"): EmphasisAnchor => ({ kind: "scene", videoId: "v2", startUs, endUs, beatId })
  expect(pointsOverlap(said(2, 5), said(4, 6))).toBe(true)
  expect(pointsOverlap(said(4, 6), said(2, 5))).toBe(true)
  expect(pointsOverlap(said(2, 4), said(4, 6))).toBe(false)
  expect(pointsOverlap(said(4, 6), said(2, 4))).toBe(false)
  expect(pointsOverlap(said(2, 5), said(2, 5, "b4"))).toBe(false)
  expect(pointsOverlap(said(2, 5), said(2, 5, "b1", "v2"))).toBe(false)
  expect(pointsOverlap(picture(0, 2_000_000), picture(1_000_000, 3_000_000))).toBe(true)
  expect(pointsOverlap(picture(0, 2_000_000), picture(2_000_000, 3_000_000))).toBe(false)
  expect(pointsOverlap(picture(0, 2_000_000), picture(0, 2_000_000, "b5"))).toBe(false)
  // speech and picture never claim the same thing, even with the same video and beat
  expect(pointsOverlap({ kind: "speech", videoId: "v2", from: 0, to: 9, beatId: "b3" }, picture(0, 9_000_000))).toBe(false)
})
