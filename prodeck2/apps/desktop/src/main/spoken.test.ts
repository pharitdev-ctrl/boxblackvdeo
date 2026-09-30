import { expect, test } from "vitest"
import type { CutPlan } from "@boxblack/core/cut"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import { timelineOf } from "./highlight-state.ts"
import { placeOf } from "./insert-media.ts"
import { spokenSentences } from "./spoken.ts"
import { CLIP_ID, s, setup } from "./timeline-fixture.ts"

async function sentencesOf(service: Awaited<ReturnType<typeof setup>>["service"], folder: string) {
  const { stored, plan, clips } = await service.compiled(folder, DEFAULT_CUT_RULES)
  const at = timelineOf(plan)
  const sentences = spokenSentences({
    plan,
    wordsOf: (videoId) => clips.find((clip) => clip.id === videoId)?.transcript?.words ?? [],
    beatNames: new Map(stored.outline.beats.map((beat) => [beat.id, beat.name])),
    at,
  })
  return { sentences, at, plan }
}

test("the sentences the rough cut plays, in playing order, each with its words and their source times", async () => {
  const { service, folder } = await setup()
  const { sentences, at, plan } = await sentencesOf(service, folder)
  // the fixture's first countdown is a retake the rules cut, so it is not a sentence the cut plays; Thai rows are joined without spaces
  expect(sentences.map((sentence) => sentence.text)).toEqual(["ขึ้นไปในอวกาศใน", "สามสองหนึ่ง"])
  expect(sentences[0]).toMatchObject({ videoId: CLIP_ID, beatId: "beat-1", beatName: "นับถอยหลัง", from: 0, to: 5, endUs: s(19.78) })
  // it plays where its first word plays: the piece's edge snaps to quiet a little before it
  expect(sentences[0]!.timelineUs).toBe(at(0, s(17.16)))
  // each word also says where it plays on the rough cut: nothing is cut out of this sentence, so as far on as it was said
  expect(sentences[0]!.words).toEqual([
    { text: "ขึ้น", startUs: s(17.16), timelineUs: at(0, s(17.16)) },
    { text: "ไป", startUs: s(17.44), timelineUs: at(0, s(17.44)) },
    { text: "ใน", startUs: s(17.68), timelineUs: at(0, s(17.68)) },
    { text: "อวกาศ", startUs: s(18.08), timelineUs: at(0, s(18.08)) },
    { text: "ใน", startUs: s(19.0), timelineUs: at(0, s(19.0)) },
  ])
  expect(sentences[1]!.words[0]).toEqual({ text: "สาม", startUs: s(22.62), timelineUs: at(1, s(22.62)) })
  // each plays in a piece of its own: the first runs to the end of the first piece, where the retake is cut
  expect(sentences.map((sentence) => sentence.pieceEndUs)).toEqual([plan.cuts[0]!.sourceDurationUs, plan.durationUs])
  // the second sentence plays after the first piece, wherever the retake's cut lands
  expect(sentences[1]!.timelineUs).toBeGreaterThan(sentences[0]!.timelineUs)
})

test("a sentence the user cuts is no longer one the cut plays", async () => {
  const { service, folder } = await setup()
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [8, 9, 10], keep: false })
  expect((await sentencesOf(service, folder)).sentences.map((sentence) => sentence.text)).toEqual(["ขึ้นไปในอวกาศใน"])
})

test("a sentence whose first word has no length and sits right at the end of a piece still plays", () => {
  // whisper's 20 ms steps: "ครับ" is timed 2 s–2 s, the very end of the piece kept, and the cut jumps on to 5 s
  const words = [
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    { text: "ครับ", startUs: 2_000_000, endUs: 2_000_000 },
  ]
  const row = (text: string, index: number) => ({ state: "used" as const, reason: null, startUs: words[index]!.startUs, endUs: words[index]!.endUs, text, toggle: { type: "words" as const, indexes: [index] } })
  const plan = {
    beats: [{ beatId: "b1", videoId: "v1", pieces: [{ startUs: 1_000_000, endUs: 2_000_000 }, { startUs: 5_000_000, endUs: 6_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [row("ดี", 0), row("ครับ", 1)] }],
    cuts: [
      { binId: "v1", sourceStartUs: 1_000_000, sourceDurationUs: 1_000_000 },
      { binId: "v1", sourceStartUs: 5_000_000, sourceDurationUs: 1_000_000 },
    ],
    durationUs: 2_000_000,
  } as unknown as CutPlan
  const sentences = spokenSentences({ plan, wordsOf: () => words, beatNames: new Map(), at: timelineOf(plan) })
  expect(sentences.map((sentence) => [sentence.text, sentence.timelineUs])).toEqual([
    ["ดี", 0],
    ["ครับ", 1_000_000],
  ])
})

test("a word with no length where one beat's piece ends and the next beat's begins plays in the piece that begins there", () => {
  // one video: beat b1 keeps 1–2 s, beat b2 keeps 2–3 s; "ครับ" is timed 2 s–2 s and both beats hold its row
  const words = [
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    { text: "ครับ", startUs: 2_000_000, endUs: 2_000_000 },
    { text: "ต่อ", startUs: 2_200_000, endUs: 2_600_000 },
  ]
  const row = (index: number) => ({ state: "used" as const, reason: null, startUs: words[index]!.startUs, endUs: words[index]!.endUs, text: words[index]!.text, toggle: { type: "words" as const, indexes: [index] } })
  const beat = (beatId: string, piece: [number, number], rows: number[]) => ({ beatId, videoId: "v1", pieces: [{ startUs: piece[0], endUs: piece[1] }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: rows.map(row) })
  const plan = {
    beats: [beat("b1", [1_000_000, 2_000_000], [0, 1]), beat("b2", [2_000_000, 3_000_000], [1, 2])],
    cuts: [
      { binId: "v1", sourceStartUs: 1_000_000, sourceDurationUs: 1_000_000 },
      { binId: "v1", sourceStartUs: 2_000_000, sourceDurationUs: 1_000_000 },
    ],
    durationUs: 2_000_000,
  } as unknown as CutPlan
  const sentences = spokenSentences({ plan, wordsOf: () => words, beatNames: new Map(), at: timelineOf(plan) })
  expect(sentences.map((sentence) => [sentence.beatId, sentence.text])).toEqual([
    ["b1", "ดี"],
    ["b2", "ครับ"],
    ["b2", "ต่อ"],
  ])
})

test("a cutaway on a word with no length at the very end of a piece is placed there", () => {
  const words = [
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    { text: "ครับ", startUs: 2_000_000, endUs: 2_000_000 },
  ]
  const row = (text: string, index: number) => ({ state: "used" as const, reason: null, startUs: words[index]!.startUs, endUs: words[index]!.endUs, text, toggle: { type: "words" as const, indexes: [index] } })
  const plan = {
    beats: [{ beatId: "b1", videoId: "v1", pieces: [{ startUs: 1_000_000, endUs: 2_000_000 }, { startUs: 5_000_000, endUs: 6_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [row("ดี", 0), row("ครับ", 1)] }],
    cuts: [
      { binId: "v1", sourceStartUs: 1_000_000, sourceDurationUs: 1_000_000 },
      { binId: "v1", sourceStartUs: 5_000_000, sourceDurationUs: 1_000_000 },
    ],
    durationUs: 2_000_000,
  } as unknown as CutPlan
  const at = timelineOf(plan)
  const sentences = spokenSentences({ plan, wordsOf: () => words, beatNames: new Map(), at })
  const place = placeOf({ slots: [], sentences, plan, at })
  expect(place({ kind: "speech", videoId: "v1", sourceUs: 2_000_000, beatId: "b1" })).toMatchObject({ atUs: 1_000_000, beatId: "b1" })
})

test("a sentence ends on the rough cut where its last word does, in the piece that plays it, however much of its middle is cut", () => {
  // "ดี มาก ครับ": "มาก" (1.5–2.5 s) is cut, so the kept pieces are 1–1.5 s and 2.5–3.5 s
  const words = [
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    { text: "มาก", startUs: 1_500_000, endUs: 2_500_000 },
    { text: "ครับ", startUs: 2_500_000, endUs: 3_000_000 },
  ]
  const plan = {
    beats: [
      {
        beatId: "b1",
        videoId: "v1",
        pieces: [{ startUs: 1_000_000, endUs: 1_500_000 }, { startUs: 2_500_000, endUs: 3_500_000 }],
        removals: [],
        originalUs: 0,
        keptUs: 0,
        notes: [],
        rows: [{ state: "used" as const, reason: null, startUs: 1_000_000, endUs: 3_000_000, text: "ดีมากครับ", toggle: { type: "words" as const, indexes: [0, 1, 2] } }],
      },
    ],
    cuts: [
      { binId: "v1", sourceStartUs: 1_000_000, sourceDurationUs: 500_000 },
      { binId: "v1", sourceStartUs: 2_500_000, sourceDurationUs: 1_000_000 },
    ],
    durationUs: 1_500_000,
  } as unknown as CutPlan
  const [sentence] = spokenSentences({ plan, wordsOf: () => words, beatNames: new Map(), at: timelineOf(plan) })
  // said over 2 s, it plays 0–1.0 s: "ครับ" ends 0.5 s into the second piece, which starts at 0.5 s
  expect([sentence!.timelineUs, sentence!.timelineEndUs]).toEqual([0, 1_000_000])
  expect(sentence!.endUs).toBe(3_000_000)
  // "ครับ" plays 0.5 s after "ดี", not the 1.5 s after it that it was said; "มาก", cut, is where the cut goes on
  expect(sentence!.words.map((word) => [word.text, word.timelineUs])).toEqual([
    ["ดี", 0],
    ["มาก", 500_000],
    ["ครับ", 500_000],
  ])
  // the piece that plays its last word runs on to 1.5 s of the rough cut
  expect(sentence!.pieceEndUs).toBe(1_500_000)
})

test("a word cut out after a pause the cut took out too is where the cut goes on, not as far into the piece before as it was said", () => {
  // "ดี … มาก ครับ": the pause 1.5–1.8 s and "มาก" (1.8–2.5 s) are cut, so the kept pieces are 1–1.5 s and 2.5–3.5 s
  const words = [
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    { text: "มาก", startUs: 1_800_000, endUs: 2_500_000 },
    { text: "ครับ", startUs: 2_500_000, endUs: 3_000_000 },
  ]
  const plan = {
    beats: [
      {
        beatId: "b1",
        videoId: "v1",
        pieces: [{ startUs: 1_000_000, endUs: 1_500_000 }, { startUs: 2_500_000, endUs: 3_500_000 }],
        removals: [],
        originalUs: 0,
        keptUs: 0,
        notes: [],
        rows: [{ state: "used" as const, reason: null, startUs: 1_000_000, endUs: 3_000_000, text: "ดีมากครับ", toggle: { type: "words" as const, indexes: [0, 1, 2] } }],
      },
    ],
    cuts: [
      { binId: "v1", sourceStartUs: 1_000_000, sourceDurationUs: 500_000 },
      { binId: "v1", sourceStartUs: 2_500_000, sourceDurationUs: 1_000_000 },
    ],
    durationUs: 1_500_000,
  } as unknown as CutPlan
  const [sentence] = spokenSentences({ plan, wordsOf: () => words, beatNames: new Map(), at: timelineOf(plan) })
  // "มาก" is not at 0.8 s, 0.8 s into a first piece only 0.5 s long, but at 0.5 s with "ครับ"
  expect(sentence!.words.map((word) => [word.text, word.timelineUs])).toEqual([
    ["ดี", 0],
    ["มาก", 500_000],
    ["ครับ", 500_000],
  ])
})

test("a word the cut's edge snapped past plays from the start of its piece", () => {
  // the piece starts 50 ms into "ดี", at a quieter spot
  const words = [
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    { text: "ครับ", startUs: 1_600_000, endUs: 1_900_000 },
  ]
  const plan = {
    beats: [{ beatId: "b1", videoId: "v1", pieces: [{ startUs: 1_050_000, endUs: 2_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [{ state: "used" as const, reason: null, startUs: 1_000_000, endUs: 1_900_000, text: "ดีครับ", toggle: { type: "words" as const, indexes: [0, 1] } }] }],
    cuts: [{ binId: "v1", sourceStartUs: 1_050_000, sourceDurationUs: 950_000 }],
    durationUs: 950_000,
  } as unknown as CutPlan
  const [sentence] = spokenSentences({ plan, wordsOf: () => words, beatNames: new Map(), at: timelineOf(plan) })
  expect(sentence!.words.map((word) => word.timelineUs)).toEqual([0, 550_000])
  expect(sentence!.pieceEndUs).toBe(950_000)
})

test("a sentence whose last word runs past the end of its piece ends where the piece does", () => {
  const words = [
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    // its middle, 1.9 s, is inside the piece, so it plays, cut off at 2 s
    { text: "ครับ", startUs: 1_600_000, endUs: 2_200_000 },
  ]
  const plan = {
    beats: [{ beatId: "b1", videoId: "v1", pieces: [{ startUs: 1_000_000, endUs: 2_000_000 }], removals: [], originalUs: 0, keptUs: 0, notes: [], rows: [{ state: "used" as const, reason: null, startUs: 1_000_000, endUs: 2_200_000, text: "ดีครับ", toggle: { type: "words" as const, indexes: [0, 1] } }] }],
    cuts: [{ binId: "v1", sourceStartUs: 1_000_000, sourceDurationUs: 1_000_000 }],
    durationUs: 1_000_000,
  } as unknown as CutPlan
  const [sentence] = spokenSentences({ plan, wordsOf: () => words, beatNames: new Map(), at: timelineOf(plan) })
  expect(sentence!.timelineEndUs).toBe(1_000_000)
})
