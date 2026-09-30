import { expect, test } from "vitest"
import type { CutPlan } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueSlot } from "@boxblack/core/flair/direct"
import type { BinMedia } from "@boxblack/core/flair/media"
import type { CueAnchor, InsertCue } from "@boxblack/core/flair/plan"
import { timelineOf } from "./highlight-state.ts"
import { createSpareMedia, insertsInForce, itemPlaceOf, keepClearAt, placeOf, withDescriptions } from "./insert-media.ts"
import type { SpokenSentence } from "./spoken.ts"

const bin = (id: string, path: string, kind = "photo") => ({ id, metetype: kind, file_Path: path, extra_info: path.split("/").pop(), width: 3024, height: 4032, duration: 5_000_000 })

test("the project's bin, minus the footage the outline plays", async () => {
  const reads: string[] = []
  const media = createSpareMedia({
    readMeta: async (folder) => {
      reads.push(folder)
      return { draft_materials: [{ type: 0, value: [bin("clip", "/media/talk.mov", "video"), bin("pic", "/media/nail.jpg")] }] }
    },
    exists: () => true,
  })
  expect((await media.list("/drafts/0917", ["clip"])).map((entry) => entry.binId)).toEqual(["pic"])
  expect(reads).toEqual(["/drafts/0917"])
})

test("a project whose bin cannot be read has nothing to cut away to", async () => {
  const media = createSpareMedia({
    readMeta: async () => {
      throw new Error("no such file")
    },
  })
  expect(await media.list("/drafts/gone", [])).toEqual([])
})

/* where an anchor plays */

const slots: CueSlot[] = [
  { anchor: { kind: "highlight", groupId: "g1", line: 0 }, atUs: 1_000_000, what: 'ข้อความเด่น "เล็บ" บรรทัด 1', beatId: "b1" },
  { anchor: { kind: "beat", beatId: "b2", edge: "start" }, atUs: 8_000_000, what: 'ต้นช่วง "รีวิว"', beatId: "b2" },
]

/** Two pieces of one clip: 17.0–19.0 s plays first, then 22.0–26.0 s; the 3 s between them is cut. */
const plan = {
  durationUs: 6_000_000,
  beats: [
    { beatId: "b1", videoId: "v1", pieces: [{ startUs: 17_000_000, endUs: 19_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [] },
    { beatId: "b2", videoId: "v1", pieces: [{ startUs: 22_000_000, endUs: 26_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [] },
  ],
  cuts: [
    { binId: "v1", sourceStartUs: 17_000_000, sourceDurationUs: 2_000_000 },
    { binId: "v1", sourceStartUs: 22_000_000, sourceDurationUs: 4_000_000 },
  ],
} as unknown as CutPlan

const sentences: SpokenSentence[] = [
  {
    videoId: "v1",
    beatId: "b1",
    beatName: "เปิด",
    from: 0,
    to: 4,
    text: "ขึ้นไปในอวกาศ",
    timelineUs: 160_000,
    timelineEndUs: 1_750_000,
    endUs: 18_750_000,
    words: [
      { text: "ขึ้น", startUs: 17_160_000 },
      { text: "ไป", startUs: 17_440_000 },
      { text: "ใน", startUs: 17_680_000 },
      { text: "อวกาศ", startUs: 18_080_000 },
    ],
  },
  { videoId: "v1", beatId: "b2", beatName: "นับ", from: 8, to: 11, text: "สาม สอง หนึ่ง", timelineUs: 2_620_000, timelineEndUs: 5_250_000, endUs: 25_250_000, words: [{ text: "สาม", startUs: 22_620_000 }, { text: "สอง", startUs: 23_880_000 }, { text: "หนึ่ง", startUs: 24_840_000 }] },
]

const place = placeOf({ slots, sentences, plan, at: timelineOf(plan) })
const speech = (sourceUs: number, videoId = "v1"): CueAnchor => ({ kind: "speech", videoId, sourceUs })

test("a speech anchor plays where its piece plays, and names the sentence and the word", () => {
  expect(place(speech(18_080_000))).toEqual({ atUs: 1_080_000, what: "ที่ “ขึ้นไปในอวกาศ” ตรงคำว่า “อวกาศ”", beatId: "b1" })
  expect(place(speech(23_880_000))).toEqual({ atUs: 3_880_000, what: "ที่ “สาม สอง หนึ่ง” ตรงคำว่า “สอง”", beatId: "b2" })
})

test("a speech anchor between words names only its sentence, and one on no sentence its time", () => {
  expect(place(speech(18_000_000))).toEqual({ atUs: 1_000_000, what: "ที่ “ขึ้นไปในอวกาศ”", beatId: "b1" })
  expect(place(speech(25_500_000))).toEqual({ atUs: 5_500_000, what: "ที่ 0:05.5", beatId: "b2" })
})

test("a speech anchor whose moment was cut away, or whose video is not on the cut, has nowhere to play", () => {
  expect(place(speech(20_000_000))).toBeNull()
  expect(place(speech(26_000_000))).toBeNull()
  expect(place(speech(18_000_000, "v9"))).toBeNull()
})

test("a point anchor still plays at its slot, and one on a join the cut moved a little at that join", () => {
  expect(place({ kind: "highlight", groupId: "g1", line: 0 })).toEqual({ atUs: 1_000_000, what: 'ข้อความเด่น "เล็บ" บรรทัด 1', beatId: "b1" })
  expect(place({ kind: "beat", beatId: "b9", edge: "start" })).toBeNull()
  const join: CueSlot = { anchor: { kind: "cut", videoId: "v1", sourceUs: 22_000_000 }, atUs: 2_000_000, what: "รอยตัด ข้ามไป 3.0 วิ", beatId: "b2" }
  const withJoin = placeOf({ slots: [...slots, join], sentences, plan, at: timelineOf(plan) })
  expect(withJoin({ kind: "cut", videoId: "v1", sourceUs: 21_900_000 })).toEqual({ atUs: 2_000_000, what: "รอยตัด ข้ามไป 3.0 วิ", beatId: "b2" })
})

/* what will really play */

const pictures: BinMedia[] = [
  { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo", width: 3024, height: 4032, durationUs: 5_000_000 },
  { binId: "m2", path: "/clips/shop.mp4", name: "IMG_2.MOV", kind: "video", width: 1080, height: 1920, durationUs: 1_500_000 },
]
const ON: FlairOptions = { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: false }
const cue = (anchor: CueAnchor, binId: string, edited = false): InsertCue => ({ anchor, binId, edited })
const inForce = (inserts: InsertCue[], flair: FlairOptions = ON) => insertsInForce({ inserts, place, media: pictures, flair, durationUs: 20_000_000, passes: () => true })

test("a stored cutaway plays at its place, for as long as its file allows", () => {
  const { kept, dropped } = inForce([cue(speech(18_080_000), "m1"), cue(slots[1]!.anchor, "m2")])
  expect(dropped).toBe(0)
  expect(kept.map((insert) => [insert.atUs, insert.durationUs, insert.media.name])).toEqual([
    [1_080_000, 2_000_000, "IMG_1.JPG"],
    [8_000_000, 1_500_000, "IMG_2.MOV"],
  ])
})

test("a cutaway whose place is gone, or whose file the project lost, is dropped", () => {
  const gone: InsertCue = { anchor: { kind: "beat", beatId: "nope", edge: "start" }, binId: "m1", edited: false }
  expect(inForce([gone, cue(speech(20_000_000), "m1"), cue(slots[0]!.anchor, "m9")])).toEqual({ kept: [], dropped: 3 })
})

test("with the cutaways switched off nothing is inserted; the old switch for all flair is not read", () => {
  expect(inForce([cue(slots[0]!.anchor, "m1")], { ...ON, insert: false })).toEqual({ kept: [], dropped: 0 })
  expect(inForce([cue(slots[0]!.anchor, "m1")], { ...ON, enabled: false }).kept).toHaveLength(1)
})

test("the rules that are left still apply at every level: one picture may show again", () => {
  expect(inForce([cue(slots[0]!.anchor, "m1"), cue(slots[1]!.anchor, "m1")], { ...ON, level: "light" }).kept).toHaveLength(2)
})

test("a cutaway on an emphasis point the level hides waits: it is neither kept nor dropped", () => {
  const hidden: InsertCue = { ...cue(slots[0]!.anchor, "m1"), pointId: "p" }
  const hiddenLost: InsertCue = { ...cue(slots[0]!.anchor, "m9"), pointId: "p" }
  const shown: InsertCue = { ...cue(slots[1]!.anchor, "m2"), pointId: "q" }
  const result = insertsInForce({ inserts: [hidden, hiddenLost, shown], place, media: pictures, flair: ON, durationUs: 20_000_000, passes: (id) => id !== "p" })
  expect(result).toMatchObject({ kept: [{ cue: shown }], dropped: 0 })
})

/* where an item plays when its own moment was cut */

/** A point of b1 whose first kept word is "ไป" at 17.44 s, 0.44 s into the rough cut: its first word was cut. */
const placedPoint = (id: string, sourceUs = 17_440_000, beatId = "b1"): PlacedPoint => ({
  point: { id, anchor: { kind: "speech", videoId: "v1", from: 0, to: 4, beatId }, importance: "key", type: "place", reason: "", source: "ai", edited: false },
  videoId: "v1",
  beatId,
  cut: 0,
  sourceUs,
  atUs: sourceUs - 17_000_000,
  endUs: 1_750_000,
})
const placeItem = itemPlaceOf(place, [placedPoint("p")])
const inB1 = (sourceUs: number): CueAnchor => ({ kind: "speech", videoId: "v1", sourceUs, beatId: "b1" })

test("an item plays by its own anchor while that is on the cut, point or not", () => {
  expect(placeItem(inB1(18_080_000), "p")).toEqual({ atUs: 1_080_000, what: "ที่ “ขึ้นไปในอวกาศ” ตรงคำว่า “อวกาศ”", beatId: "b1", by: inB1(18_080_000) })
  expect(placeItem(slots[1]!.anchor)).toEqual({ ...place(slots[1]!.anchor)!, by: slots[1]!.anchor })
})

test("an item on a moment the cut took out plays where its point starts now; one on no point, or on a point not placed, plays nowhere", () => {
  // 20.0 s is between the two pieces
  expect(placeItem(inB1(20_000_000), "p")).toEqual({ atUs: 440_000, what: "ที่ “ขึ้นไปในอวกาศ” ตรงคำว่า “ไป”", beatId: "b1", by: inB1(17_440_000) })
  expect(placeItem(inB1(20_000_000))).toBeNull()
  expect(placeItem(inB1(20_000_000), "gone")).toBeNull()
})

test("a line of text, a beat's edge or a join that is gone takes its item with it, whatever point it was made for", () => {
  expect(placeItem({ kind: "highlight", groupId: "g9", line: 0 }, "p")).toBeNull()
  expect(placeItem({ kind: "beat", beatId: "b9", edge: "start" }, "p")).toBeNull()
  expect(placeItem({ kind: "cut", videoId: "v1", sourceUs: 30_000_000 }, "p")).toBeNull()
})

test("a cutaway whose moment the cut took out plays at its point's start, for as long as its file allows", () => {
  const { kept, dropped } = insertsInForce({ inserts: [{ ...cue(inB1(20_000_000), "m1"), pointId: "p" }, cue(inB1(20_000_000), "m2")], place: placeItem, media: pictures, flair: ON, durationUs: 20_000_000, passes: () => true })
  expect(kept.map((insert) => [insert.atUs, insert.durationUs, insert.cue.anchor])).toEqual([[440_000, 2_000_000, inB1(20_000_000)]])
  expect(dropped).toBe(1)
})

test("a picture Claude has looked at is named by what it shows", () => {
  expect(withDescriptions(pictures, { m1: { what: "เล็บสีชมพู", subject: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }, fit: "cover" } })).toEqual([
    { ...pictures[0], what: "เล็บสีชมพู", subject: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }, fit: "cover" },
    pictures[1],
  ])
})

/* what the video underneath must keep clear */

const clips = [
  {
    id: "v1",
    insight: {
      scenes: [
        { startUs: 17_000_000, endUs: 19_000_000, keepClear: { fromY: 0.1, toY: 0.5 } },
        { startUs: 22_000_000, endUs: 24_000_000, keepClear: { fromY: 0.6, toY: 0.9 } },
        { startUs: 24_000_000, endUs: 26_000_000, keepClear: null },
      ],
    },
  },
] as unknown as Parameters<typeof keepClearAt>[1]

test("a card is told the band of the scene playing at that moment on the rough cut", () => {
  // 0.5 s in plays 17.5 s of the source, in the first scene; 2.5 s in plays 22.5 s, in the second
  expect(keepClearAt(plan, clips, 500_000)).toEqual({ fromY: 0.1, toY: 0.5 })
  expect(keepClearAt(plan, clips, 2_500_000)).toEqual({ fromY: 0.6, toY: 0.9 })
  // a scene that says nothing must stay clear, a moment past the end, and a video with no pictures
  expect(keepClearAt(plan, clips, 4_500_000)).toBeNull()
  expect(keepClearAt(plan, clips, 99_000_000)).toBeNull()
  expect(keepClearAt(plan, [], 500_000)).toBeNull()
})

test("a cutaway on the first word of a piece whose start the cut moved into that word still plays, at the piece's start", () => {
  // the piece starts at 22.0 s, inside "นี่" (21.9–22.3 s): the cut snapped its start past the word's beginning
  const early: SpokenSentence[] = [{ videoId: "v1", beatId: "b2", beatName: "นับ", from: 0, to: 2, text: "นี่คือ", timelineUs: 2_000_000, timelineEndUs: 3_000_000, endUs: 23_000_000, words: [{ text: "นี่", startUs: 21_900_000 }, { text: "คือ", startUs: 22_300_000 }] }]
  const placeEarly = placeOf({ slots, sentences: early, plan, at: timelineOf(plan) })
  expect(placeEarly(speech(21_900_000))).toEqual({ atUs: 2_000_000, what: "ที่ “นี่คือ” ตรงคำว่า “นี่”", beatId: "b2" })
  // a word that ends before the piece starts was cut away with its moment
  const gone: SpokenSentence[] = [{ ...early[0]!, words: [{ text: "นั่น", startUs: 21_000_000 }, { text: "นี่", startUs: 21_500_000 }] }]
  expect(placeOf({ slots, sentences: gone, plan, at: timelineOf(plan) })(speech(21_000_000))).toBeNull()
})

test("a cutaway on footage played in two beats plays in the beat it was put in", () => {
  const twice = {
    durationUs: 4_000_000,
    beats: [
      { beatId: "b1", videoId: "v1", pieces: [{ startUs: 17_000_000, endUs: 19_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [] },
      { beatId: "b2", videoId: "v1", pieces: [{ startUs: 17_000_000, endUs: 19_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [] },
    ],
    cuts: [
      { binId: "v1", sourceStartUs: 17_000_000, sourceDurationUs: 2_000_000 },
      { binId: "v1", sourceStartUs: 17_000_000, sourceDurationUs: 2_000_000 },
    ],
  } as unknown as CutPlan
  const placeTwice = placeOf({ slots, sentences, plan: twice, at: timelineOf(twice) })
  expect(placeTwice({ kind: "speech", videoId: "v1", sourceUs: 18_080_000, beatId: "b2" })).toMatchObject({ atUs: 3_080_000, beatId: "b2" })
  expect(placeTwice({ kind: "speech", videoId: "v1", sourceUs: 18_080_000, beatId: "b1" })).toMatchObject({ atUs: 1_080_000, beatId: "b1" })
  // saved before cutaways knew their beat: the first place it plays
  expect(placeTwice(speech(18_080_000))).toMatchObject({ atUs: 1_080_000, beatId: "b1" })
})

test("a cutaway that names a beat the rough cut no longer has does not play in another", () => {
  expect(place({ kind: "speech", videoId: "v1", sourceUs: 18_080_000, beatId: "b9" })).toBeNull()
  expect(place({ kind: "speech", videoId: "v1", sourceUs: 18_080_000, beatId: "b1" })).toMatchObject({ beatId: "b1" })
})
