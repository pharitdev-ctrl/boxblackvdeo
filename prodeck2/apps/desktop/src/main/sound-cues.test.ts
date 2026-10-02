import { expect, test } from "vitest"
import type { CutPlan } from "@boxblack/core/cut"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueAnchor, SoundCue } from "@boxblack/core/flair/plan"
import type { TimedGroup } from "@boxblack/core/highlights"
import { placeOf } from "./insert-media.ts"
import { anchorKey, cuesInForce, samePlace, slotFinder, slotsFor } from "./sound-cues.ts"

const V = "v1"
const piece = (startUs: number, endUs: number) => ({ startUs, endUs })

/** Two beats: the first keeps two pieces with a 4 s jump between them, the second one piece. */
const plan = {
  durationUs: 20_000_000,
  cuts: [
    { binId: V, sourceStartUs: 0, sourceDurationUs: 5_000_000 },
    { binId: V, sourceStartUs: 9_000_000, sourceDurationUs: 5_000_000 },
    { binId: V, sourceStartUs: 14_100_000, sourceDurationUs: 10_000_000 },
  ],
  beats: [
    { beatId: "b1", videoId: V, pieces: [piece(0, 5_000_000), piece(9_000_000, 14_000_000)] },
    { beatId: "b2", videoId: V, pieces: [piece(14_100_000, 24_100_000)] },
  ],
} as unknown as CutPlan

/** Where a source time of the n-th kept piece plays on the rough cut. */
const at = (cut: number, sourceUs: number) => {
  const starts = [0, 5_000_000, 10_000_000]
  const pieces = [0, 9_000_000, 14_100_000]
  return starts[cut]! + sourceUs - pieces[cut]!
}

const groups: TimedGroup[] = [
  {
    groupId: "g1",
    beatId: "b1",
    startUs: 1_000_000,
    endUs: 4_000_000,
    lines: [
      { lineIndex: 0, text: "ขึ้นไป", startUs: 1_000_000, partial: false },
      { lineIndex: 1, text: "อวกาศ", startUs: 2_000_000, partial: false },
    ],
  } as unknown as TimedGroup,
]

const beatNames = new Map([
  ["b1", "นับถอยหลัง"],
  ["b2", "ปิดท้าย"],
])
const slots = () => slotsFor({ plan, groups, beatNames, at })

test("every highlight line is a place a sound can go", () => {
  const lines = slots().filter((slot) => slot.anchor.kind === "highlight")
  expect(lines.map((slot) => [slot.atUs, slot.what])).toEqual([
    [1_000_000, 'ข้อความเด่น "ขึ้นไป" บรรทัด 1'],
    [2_000_000, 'ข้อความเด่น "อวกาศ" บรรทัด 2'],
  ])
  expect(lines[1]!.anchor).toEqual({ kind: "highlight", groupId: "g1", line: 1 })
})

test("a highlight line is named by where it shows, but anchored to the line it is when a line above it was cut", () => {
  const cutAbove = [{ ...groups[0]!, lines: [groups[0]!.lines[1]!] }] as TimedGroup[]
  const lines = slotsFor({ plan, groups: cutAbove, beatNames, at }).filter((slot) => slot.anchor.kind === "highlight")
  expect(lines).toEqual([{ anchor: { kind: "highlight", groupId: "g1", line: 1 }, atUs: 2_000_000, what: 'ข้อความเด่น "อวกาศ" บรรทัด 1', beatId: "b1" }])
})

test("a join that really jumps is a place; one that only trims is not", () => {
  const cuts = slots().filter((slot) => slot.anchor.kind === "cut")
  // only the 4 s jump inside the first beat: the join into the second beat is that beat's own start
  expect(cuts.map((slot) => slot.what)).toEqual(["รอยตัด ข้ามไป 4.0 วิ"])
  expect(cuts[0]!.anchor).toEqual({ kind: "cut", videoId: V, sourceUs: 9_000_000, beatId: "b1" })
  expect(cuts[0]!.atUs).toBe(5_000_000)

  // the same plan with a 0.4 s trim instead of a jump offers no place there
  const trimmed = {
    ...plan,
    cuts: [plan.cuts[0]!, { binId: V, sourceStartUs: 5_400_000, sourceDurationUs: 5_000_000 }, plan.cuts[2]!],
    beats: [{ ...plan.beats[0]!, pieces: [piece(0, 5_000_000), piece(5_400_000, 10_400_000)] }, plan.beats[1]!],
  } as unknown as CutPlan
  const near = slotsFor({ plan: trimmed, groups, beatNames, at }).filter((slot) => slot.anchor.kind === "cut")
  expect(near).toEqual([])
})

test("each beat offers its start, and the last one a place to close on", () => {
  const beats = slots().filter((slot) => slot.anchor.kind === "beat")
  expect(beats.map((slot) => [slot.atUs, slot.what])).toEqual([
    [0, 'ต้นช่วง "นับถอยหลัง"'],
    // an earlier beat's end is the next one's start, so only the last beat closes
    [10_000_000, 'ต้นช่วง "ปิดท้าย"'],
    // half a second before the last frame, so the sound has room to play
    [19_500_000, 'ท้ายช่วง "ปิดท้าย"'],
  ])
})

test("a clip too short to close on offers no closing place", () => {
  const brief = { ...plan, durationUs: 100_000 } as unknown as CutPlan
  const beats = slotsFor({ plan: brief, groups, beatNames, at }).filter((slot) => slot.anchor.kind === "beat")
  expect(beats.map((slot) => slot.what)).toEqual(['ต้นช่วง "นับถอยหลัง"', 'ต้นช่วง "ปิดท้าย"'])
})

test("two places at the same moment become one, and the list is in time order", () => {
  const list = slots()
  expect(list.map((slot) => slot.atUs)).toEqual([...list.map((slot) => slot.atUs)].sort((a, b) => a - b))
  expect(new Set(list.map((slot) => slot.atUs)).size).toBe(list.length)
  expect(list.find((slot) => slot.atUs === 10_000_000)!.anchor).toEqual({ kind: "beat", beatId: "b2", edge: "start" })
})

const sounds = [
  { effectId: "s1", name: "ปัง", durationUs: 300_000, path: "/cache/s1.mp3" },
  { effectId: "s2", name: "ฟิ้ว", durationUs: 400_000, path: null },
]
const ON: FlairOptions = { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: false }
const cue = (anchorIndex: number, effectId = "s1", edited = false): SoundCue => ({ anchor: slots()[anchorIndex]!.anchor, effectId, edited })

const inForce = (cues: SoundCue[], flair: FlairOptions = ON, needsPro?: (effectId: string) => boolean) =>
  cuesInForce({ cues, place: placeOf({ slots: slots(), sentences: [], plan, at }), sounds, flair, durationUs: plan.durationUs, passes: () => true, needsPro })

test("a stored cue plays at the time of the place it is anchored to", () => {
  const { kept, unplaced, missing } = inForce([cue(0)])
  expect([unplaced, missing]).toEqual([0, 0])
  expect(kept.map((placed) => [placed.atUs, placed.sound.name])).toEqual([[slots()[0]!.atUs, "ปัง"]])
})

test("a cue whose place is not on the rough cut, or whose sound the machine does not have, is counted apart", () => {
  const gone: SoundCue = { anchor: { kind: "beat", beatId: "nope", edge: "start" }, effectId: "s1", edited: false }
  const goneToo: SoundCue = { ...gone, effectId: "s9" }
  const unknown: SoundCue = { ...cue(0), effectId: "s9" }
  const result = inForce([gone, goneToo, unknown, cue(1)])
  expect(result.kept).toHaveLength(1)
  // a cue with neither its place nor its sound is counted once, by its place
  expect([result.unplaced, result.missing]).toEqual([2, 1])
})

test("a sound that needs CapCut Pro is not placed, and is counted apart from one the machine does not have", () => {
  // s2 stands for a sound read from a draft, which needs Pro; s9 is one this machine does not have
  const s2NeedsPro = (effectId: string) => effectId === "s2"
  const result = inForce([cue(0), cue(1, "s2"), cue(2, "s9")], ON, s2NeedsPro)
  expect(result.kept.map((placed) => placed.cue.effectId)).toEqual(["s1"])
  expect(result).toMatchObject({ unplaced: 0, missing: 1, pro: 1 })
  // two on one place: one the user set on a Pro sound does not keep the other off it, so that place plays what it can,
  // and is counted, since with Pro it would play there instead
  const exact: SoundCue = { anchor: { kind: "cut", videoId: V, sourceUs: 9_000_000 }, effectId: "s1", edited: false }
  const drifted: SoundCue = { anchor: { kind: "cut", videoId: V, sourceUs: 9_150_000 }, effectId: "s2", edited: true }
  const shared = inForce([exact, drifted], ON, s2NeedsPro)
  expect(shared.kept.map((placed) => placed.cue.effectId)).toEqual(["s1"])
  expect(shared.pro).toBe(1)
  // one on a place another plays first, or a second on a place a held one wants, would stay quiet with Pro too: not counted
  expect(inForce([{ ...exact, edited: true }, { ...drifted, edited: false }], ON, s2NeedsPro)).toMatchObject({ kept: [{ cue: { effectId: "s1" } }], pro: 0 })
  expect(inForce([drifted, { ...exact, effectId: "s2" }], ON, s2NeedsPro)).toMatchObject({ kept: [], pro: 1 })
  // without the gate every sound this machine has plays
  expect(inForce([cue(0), cue(1, "s2")])).toMatchObject({ missing: 0, pro: 0 })
})

test("every cue whose place and sound are there plays, however close together, in time order", () => {
  const { kept } = inForce([cue(2, "s2"), cue(0), cue(1)])
  expect(kept.map((placed) => placed.atUs)).toEqual([0, 1_000_000, 2_000_000])
})

test("at the lightest level every cue plays, as at any other", () => {
  expect(inForce([cue(0), cue(1)], { ...ON, level: "light" }).kept).toHaveLength(2)
})

test("with the sounds switched off nothing plays; the old switch for all flair is not read", () => {
  expect(inForce([cue(0)], { ...ON, sound: false })).toEqual({ kept: [], unplaced: 0, missing: 0, pro: 0 })
  expect(inForce([cue(0)], { ...ON, enabled: false }).kept).toHaveLength(1)
})

test("a cue on an emphasis point the level hides waits: it neither plays nor counts as unplaced or missing", () => {
  const hidden: SoundCue = { ...cue(0), pointId: "p" }
  const hiddenNowhere: SoundCue = { anchor: { kind: "beat", beatId: "nope", edge: "start" }, effectId: "s9", edited: false, pointId: "p" }
  const shown: SoundCue = { ...cue(1), pointId: "q" }
  const result = cuesInForce({ cues: [hidden, hiddenNowhere, shown], place: placeOf({ slots: slots(), sentences: [], plan, at }), sounds, flair: ON, durationUs: plan.durationUs, passes: (id) => id !== "p" })
  expect(result.kept.map((placed) => placed.cue)).toEqual([shown])
  expect([result.unplaced, result.missing]).toEqual([0, 0])
})

test("each cue is placed with the point it was made for, so one whose moment the cut took out can play where its point starts", () => {
  const moment: CueAnchor = { kind: "speech", videoId: V, sourceUs: 6_000_000, beatId: "b1" }
  const handed: [CueAnchor, string | undefined][] = []
  const place = (anchor: CueAnchor, pointId?: string) => {
    handed.push([anchor, pointId])
    return pointId === "p" ? { atUs: 3_000_000, what: "ที่จุดเน้น", beatId: "b1" } : null
  }
  const result = cuesInForce({ cues: [{ anchor: moment, effectId: "s1", edited: false, pointId: "p" }, { anchor: moment, effectId: "s1", edited: false }], place, sounds, flair: ON, durationUs: plan.durationUs, passes: () => true })
  expect(result.kept.map((placed) => [placed.atUs, placed.cue.pointId])).toEqual([[3_000_000, "p"]])
  expect(result.unplaced).toBe(1)
  expect(handed).toEqual([
    [moment, "p"],
    [moment, undefined],
  ])
})

test("an anchor is one key however its fields are written", () => {
  expect(anchorKey({ kind: "beat", beatId: "b1", edge: "start" })).toBe(anchorKey({ kind: "beat", beatId: "b1", edge: "start" }))
  expect(anchorKey({ kind: "beat", beatId: "b1", edge: "start" })).not.toBe(anchorKey({ kind: "beat", beatId: "b1", edge: "end" }))
})

test("a join inside a later beat says it belongs to that beat, not the first", () => {
  // one beat of one piece, then a beat whose two pieces have a 4 s jump between them
  const late = {
    durationUs: 20_000_000,
    cuts: [
      { binId: V, sourceStartUs: 0, sourceDurationUs: 5_000_000 },
      { binId: V, sourceStartUs: 9_000_000, sourceDurationUs: 5_000_000 },
      { binId: V, sourceStartUs: 18_000_000, sourceDurationUs: 5_000_000 },
    ],
    beats: [
      { beatId: "b1", videoId: V, pieces: [piece(0, 5_000_000)] },
      { beatId: "b2", videoId: V, pieces: [piece(9_000_000, 14_000_000), piece(18_000_000, 23_000_000)] },
    ],
  } as unknown as CutPlan
  const cut = slotsFor({ plan: late, groups: [], beatNames, at }).find((slot) => slot.anchor.kind === "cut")!
  expect(cut.what).toBe("รอยตัด ข้ามไป 4.0 วิ")
  expect(cut.beatId).toBe("b2")
})

test("every place says which beat it sits in", () => {
  expect(slots().map((slot) => [slot.anchor.kind, slot.atUs, slot.beatId])).toEqual([
    ["beat", 0, "b1"],
    ["highlight", 1_000_000, "b1"],
    ["highlight", 2_000_000, "b1"],
    ["cut", 5_000_000, "b1"],
    ["beat", 10_000_000, "b2"],
    ["beat", 19_500_000, "b2"],
  ])
})

test("a join is the same place when the cut moves it a little, and only then", () => {
  const cut = (videoId: string, sourceUs: number) => ({ kind: "cut" as const, videoId, sourceUs })
  expect(samePlace(cut(V, 9_000_000), cut(V, 9_170_000))).toBe(true)
  expect(samePlace(cut(V, 9_000_000), cut(V, 8_500_000))).toBe(true)
  expect(samePlace(cut(V, 9_000_000), cut(V, 9_500_001))).toBe(false)
  expect(samePlace(cut(V, 9_000_000), cut("other", 9_000_000))).toBe(false)
  // every other place is the same place only when it is the very same anchor
  expect(samePlace({ kind: "beat", beatId: "b1", edge: "start" }, { kind: "beat", beatId: "b1", edge: "start" })).toBe(true)
  expect(samePlace({ kind: "beat", beatId: "b1", edge: "start" }, { kind: "beat", beatId: "b1", edge: "end" })).toBe(false)
  expect(samePlace({ kind: "speech", videoId: V, sourceUs: 1 }, { kind: "speech", videoId: V, sourceUs: 2 })).toBe(false)
})

test("a cue on a join the cut moved a little plays on the join; one on a join that is gone does not", () => {
  const near: SoundCue = { anchor: { kind: "cut", videoId: V, sourceUs: 9_100_000 }, effectId: "s1", edited: true }
  const far: SoundCue = { anchor: { kind: "cut", videoId: V, sourceUs: 12_000_000 }, effectId: "s2", edited: true }
  const { kept, unplaced } = inForce([near, far])
  expect(kept.map((placed) => placed.atUs)).toEqual([5_000_000])
  expect(unplaced).toBe(1)
})

test("a join the cut moved is found at the nearest join in reach", () => {
  const join = (sourceUs: number) => ({ anchor: { kind: "cut" as const, videoId: V, sourceUs }, atUs: sourceUs, what: "", beatId: "b" })
  const slotOf = slotFinder([join(9_000_000), join(9_400_000)])
  expect(slotOf({ kind: "cut", videoId: V, sourceUs: 9_350_000 })!.atUs).toBe(9_400_000)
  expect(slotOf({ kind: "cut", videoId: V, sourceUs: 9_050_000 })!.atUs).toBe(9_000_000)
  expect(slotOf({ kind: "cut", videoId: V, sourceUs: 10_000_000 })).toBeUndefined()
})

test("two stored cues on one place play once: the one the user set", () => {
  const exact: SoundCue = { anchor: { kind: "cut", videoId: V, sourceUs: 9_000_000 }, effectId: "s1", edited: false }
  const drifted: SoundCue = { anchor: { kind: "cut", videoId: V, sourceUs: 9_150_000 }, effectId: "s2", edited: true }
  const { kept } = inForce([exact, drifted])
  expect(kept.map((placed) => placed.cue.effectId)).toEqual(["s2"])
})

test("footage played in two beats: each beat's join is a place of its own, and a sound stays in its beat", () => {
  // the same stretch, with a 4 s jump, is used by both beats
  const twice = {
    durationUs: 20_000_000,
    cuts: [
      { binId: V, sourceStartUs: 0, sourceDurationUs: 5_000_000 },
      { binId: V, sourceStartUs: 9_000_000, sourceDurationUs: 5_000_000 },
      { binId: V, sourceStartUs: 0, sourceDurationUs: 5_000_000 },
      { binId: V, sourceStartUs: 9_000_000, sourceDurationUs: 5_000_000 },
    ],
    beats: [
      { beatId: "b1", videoId: V, pieces: [piece(0, 5_000_000), piece(9_000_000, 14_000_000)] },
      { beatId: "b2", videoId: V, pieces: [piece(0, 5_000_000), piece(9_000_000, 14_000_000)] },
    ],
  } as unknown as CutPlan
  const starts = [0, 5_000_000, 10_000_000, 15_000_000]
  const sources = [0, 9_000_000, 0, 9_000_000]
  const atTwice = (cut: number, sourceUs: number) => starts[cut]! + sourceUs - sources[cut]!
  const joins = slotsFor({ plan: twice, groups: [], beatNames, at: atTwice }).filter((slot) => slot.anchor.kind === "cut")
  expect(joins.map((slot) => [slot.anchor, slot.atUs])).toEqual([
    [{ kind: "cut", videoId: V, sourceUs: 9_000_000, beatId: "b1" }, 5_000_000],
    [{ kind: "cut", videoId: V, sourceUs: 9_000_000, beatId: "b2" }, 15_000_000],
  ])
  const second: SoundCue = { anchor: joins[1]!.anchor, effectId: "s1", edited: true }
  expect(cuesInForce({ cues: [second], place: placeOf({ slots: joins, sentences: [], plan: twice, at: atTwice }), sounds, flair: ON, durationUs: 20_000_000, passes: () => true }).kept.map((placed) => placed.atUs)).toEqual([15_000_000])
  // joins of two beats are two places; an anchor saved before joins knew their beat still finds one
  expect(samePlace(joins[0]!.anchor, joins[1]!.anchor)).toBe(false)
  expect(samePlace({ kind: "cut", videoId: V, sourceUs: 9_000_000 }, joins[1]!.anchor)).toBe(true)
})

test("a moment of speech saved before it knew its beat is the same moment in either beat", () => {
  const at = (beatId?: string): CueAnchor => ({ kind: "speech", videoId: V, sourceUs: 5, ...(beatId ? { beatId } : {}) })
  expect(samePlace(at(), at("b1"))).toBe(true)
  expect(samePlace(at("b1"), at("b2"))).toBe(false)
  expect(samePlace(at("b1"), { kind: "speech", videoId: V, sourceUs: 6, beatId: "b1" })).toBe(false)
})

const speechAt = (sourceUs: number, beatId: string): CueAnchor => ({ kind: "speech", videoId: V, sourceUs, beatId })
test("a sound on a moment of speech plays where that moment plays; one on a point the level holds back is neither played nor counted", () => {
  const place = placeOf({ slots: slots(), sentences: [], plan, at })
  const onPoint = (pointId: string, sourceUs: number): SoundCue => ({ anchor: speechAt(sourceUs, "b1"), effectId: "s1", edited: false, pointId })
  const { kept, unplaced, missing } = cuesInForce({
    cues: [onPoint("shown", 11_000_000), onPoint("hidden", 12_000_000)],
    place,
    sounds,
    flair: ON,
    durationUs: plan.durationUs,
    passes: (pointId) => pointId !== "hidden",
  })
  expect(kept.map((placed) => [placed.atUs, placed.cue.pointId])).toEqual([[7_000_000, "shown"]])
  expect([unplaced, missing]).toEqual([0, 0])
})
