import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { replySchema } from "../../llm/schema.ts"
import type { LlmContent, LlmRequest, LlmTransport } from "../../llm/types.ts"
import { frameKey, type GraphicPoint, type GraphicSentence } from "./points.ts"
import { MOTION_VERSION, type MotionSpec } from "../plan.ts"
import { acceptMotionPlan, MOTION_PLAN_PROMPT, MOTION_PLAN_PROMPT_VERSION, MotionPlanReplySchema, motionWords, planMotion, type MotionPlanReply } from "./direct.ts"

const canvas = { width: 1080, height: 1920 }
const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const BRIEF = { videoType: null, instructions: "" } as never

// a real JPEG on disk, not /dev/null: readFile on a device file behaves differently than on a regular file
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQgJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+UP38//Z",
  "base64",
)

/**
 * Real ASR splits Thai far finer than Claude answers with: ICU segmentation turns
 * "ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท" into nine tokens, not the five words Claude would say. "หนึ่งล้าน"
 * and "สองแสน" each span two of them.
 */
const words = (texts: string[], startUs: number, timelineUs: number, stepUs = 300_000) => texts.map((text, i) => ({ text, startUs: startUs + i * stepUs, timelineUs: timelineUs + i * stepUs }))
/** Words the rough cut plays as they were said, from `atUs` on: nothing cut out between them. */
const playedWhole = (said: { text: string; startUs: number }[], atUs = 0) => said.map((word) => ({ ...word, timelineUs: atUs + word.startUs - said[0]!.startUs }))
/** A sentence of these words, with nothing under it and nothing over it. */
const sentenceOf = (said: GraphicSentence["words"]): GraphicSentence => ({
  videoId: "v9",
  beatId: "b9",
  atUs: said[0]?.timelineUs ?? 0,
  text: said.map((word) => word.text).join(""),
  words: said,
  timelineEndUs: (said.at(-1)?.timelineUs ?? 0) + 400_000,
  scene: null,
})
const SENTENCES: GraphicSentence[] = [
  {
    videoId: "v",
    beatId: "b1",
    atUs: 2_000_000,
    text: "ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท",
    words: words(["ยอด", "ขาย", "เดือน", "นี้", "หนึ่ง", "ล้าน", "สอง", "แสน", "บาท"], 10_000_000, 2_000_000),
    timelineEndUs: 5_000_000,
    scene: { description: "คนพูดกลางเฟรม", kind: "talking-head", keepClear: { fromY: 0.1, toY: 0.45 } },
  },
  {
    videoId: "v",
    beatId: "b1",
    atUs: 6_000_000,
    text: "ดูตรงนี้",
    words: words(["ดู", "ตรง", "นี้"], 14_000_000, 6_000_000),
    timelineEndUs: 7_200_000,
    scene: null,
  },
]
/**
 * "ยอดขาย ปีนี้ … หนึ่ง ล้าน บาท" with 1.5 s of silence after "ปีนี้": the rough cut takes 1.2 s of it
 * out, so from "หนึ่ง" on every word plays 1.2 s sooner after the sentence's start than it was said.
 */
const PAUSED: GraphicSentence = {
  videoId: "v16", beatId: "b16", atUs: 2_000_000, text: "ยอดขายปีนี้หนึ่งล้านบาท",
  words: [
    { text: "ยอดขาย", startUs: 10_000_000, timelineUs: 2_000_000 },
    { text: "ปีนี้", startUs: 10_500_000, timelineUs: 2_500_000 },
    { text: "หนึ่ง", startUs: 12_500_000, timelineUs: 3_300_000 },
    { text: "ล้าน", startUs: 12_800_000, timelineUs: 3_600_000 },
    { text: "บาท", startUs: 13_100_000, timelineUs: 3_900_000 },
  ],
  timelineEndUs: 4_300_000, scene: null,
}

/** A point on the whole of a sentence, from its first word. The point on the second of SENTENCES has highlight text of its own, over 0.1 to 0.3 of the frame. */
const pointOn = (sentence: GraphicSentence, index = 0): GraphicPoint => ({
  pointId: `p${index + 1}`,
  kind: "speech",
  importance: "key",
  type: "number",
  reason: "",
  videoId: sentence.videoId,
  beatId: sentence.beatId,
  atUs: sentence.words[0]?.timelineUs ?? sentence.atUs,
  timelineEndUs: sentence.timelineEndUs,
  anchor: { kind: "speech", videoId: sentence.videoId, sourceUs: sentence.words[0]?.startUs ?? 0, beatId: sentence.beatId },
  text: sentence.text,
  sentence,
  scene: sentence.scene,
  textBand: sentence === SENTENCES[1] ? { fromY: 0.1, toY: 0.3 } : null,
})
const onPoints = (sentences: GraphicSentence[]): GraphicPoint[] => sentences.map((sentence, index) => pointOn(sentence, index))
/** acceptMotionPlan on a point per sentence. */
const accept = (reply: MotionPlanReply, sentences: GraphicSentence[], taken?: Set<number>) => acceptMotionPlan(reply, onPoints(sentences), taken)

const IDEA = 'ตัวเลขวิ่งจาก 0 ถึง 1,200,000 หยุดพอดีคำว่า "สองแสน" แล้วหน่วย "บาท" เด้งขึ้น'
const reply = (over: Partial<MotionPlanReply["graphics"][number]> = {}): MotionPlanReply => ({
  graphics: [{ point: 1, word: "หนึ่งล้าน", until: "", seconds: 3, why: "ตัวเลขยอดขาย", box: [0.04, 0.55, 0.96, 0.9], idea: IDEA, ...over }],
})
/** The graphic one answer becomes, on a point per sentence. */
const planned = (over: Partial<MotionPlanReply["graphics"][number]>, sentences = SENTENCES) => accept(reply(over), sentences).graphics[0]!.spec as MotionSpec

/** A point on "หนึ่งล้าน" in the first sentence: its first kept word is หนึ่ง, 11.2 s of the source, 3.2 s on the rough cut. */
const ON_MILLION: GraphicPoint = {
  ...pointOn(SENTENCES[0]!),
  pointId: "p-million",
  reason: "ยอดขาย",
  text: "หนึ่งล้าน",
  atUs: 3_200_000,
  anchor: { kind: "speech", videoId: "v", sourceUs: 11_200_000, beatId: "b1" },
}
/** A point on a scene of a picture beat: no words, only a moment of the file. */
const SEA: GraphicPoint = {
  pointId: "p-sea",
  kind: "scene",
  importance: "extra",
  type: "visual",
  reason: "ทะเล",
  videoId: "w",
  beatId: "b2",
  atUs: 9_000_000,
  timelineEndUs: 12_000_000,
  anchor: { kind: "speech", videoId: "w", sourceUs: 40_000_000, beatId: "b2" },
  text: "ทะเลตอนเย็น",
  sentence: null,
  scene: { description: "ทะเลตอนเย็น", kind: "b-roll", keepClear: null },
  textBand: null,
}

/** A transport that records every request and answers with a fixed reply. */
function fakeTransport(output: MotionPlanReply = reply()) {
  const calls: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate(request) {
      calls.push(request)
      return { output: output as never, usage: USAGE }
    },
  }
  return { transport, calls }
}

const textOf = (content: LlmContent[]) => content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join("\n")

// the words a graphic is written for

test("the words start at the word that starts at the moment given, each with its seconds from there on the rough cut", () => {
  expect(motionWords(SENTENCES[0]!, 11_200_000, 3)).toEqual([
    { text: "หนึ่ง", atS: 0 },
    { text: "ล้าน", atS: 0.3 },
    { text: "สอง", atS: 0.6 },
    { text: "แสน", atS: 0.9 },
    { text: "บาท", atS: 1.2 },
  ])
  // from the sentence's first word, the whole of it
  expect(motionWords(SENTENCES[1]!, 14_000_000, 3)).toEqual([{ text: "ดู", atS: 0 }, { text: "ตรง", atS: 0.3 }, { text: "นี้", atS: 0.6 }])
})

test("with no word starting at that moment, the words start at the last one that starts before it; with none before it, at the first", () => {
  // 11.35 s falls inside หนึ่ง, which starts at 11.2 s
  expect(motionWords(SENTENCES[0]!, 11_350_000, 3).map((word) => word.text)).toEqual(["หนึ่ง", "ล้าน", "สอง", "แสน", "บาท"])
  expect(motionWords(SENTENCES[0]!, 11_350_000, 3)[0]).toEqual({ text: "หนึ่ง", atS: 0 })
  // a hair before the next word is still the one before it
  expect(motionWords(SENTENCES[0]!, 11_499_999, 3)[0]).toEqual({ text: "หนึ่ง", atS: 0 })
  // past the last word, the last word alone
  expect(motionWords(SENTENCES[0]!, 99_000_000, 3)).toEqual([{ text: "บาท", atS: 0 }])
  // before the sentence, its first word
  expect(motionWords(SENTENCES[0]!, 5_000_000, 1)).toEqual([{ text: "ยอด", atS: 0 }, { text: "ขาย", atS: 0.3 }, { text: "เดือน", atS: 0.6 }, { text: "นี้", atS: 0.9 }])
})

test("a word said exactly as the graphic ends is out, and one a millisecond before is in", () => {
  const sentence = sentenceOf([
    { text: "ก", startUs: 1_000_000, timelineUs: 0 },
    { text: "ข", startUs: 3_999_000, timelineUs: 2_999_000 },
    { text: "ค", startUs: 4_000_000, timelineUs: 3_000_000 },
    { text: "ง", startUs: 4_300_000, timelineUs: 3_300_000 },
  ])
  expect(motionWords(sentence, 1_000_000, 3)).toEqual([{ text: "ก", atS: 0 }, { text: "ข", atS: 2.999 }])
  // a longer graphic takes them in
  expect(motionWords(sentence, 1_000_000, 3.001).map((word) => word.text)).toEqual(["ก", "ข", "ค"])
  expect(motionWords(sentence, 1_000_000, 6).map((word) => word.text)).toEqual(["ก", "ข", "ค", "ง"])
})

test("at most the first forty words are kept", () => {
  const many = sentenceOf(words(Array.from({ length: 45 }, (_, i) => `คำ${i + 1}`), 20_000_000, 1_000_000, 100_000))
  const kept = motionWords(many, 20_000_000, 6)
  expect(kept).toHaveLength(40)
  expect(kept.map((word) => word.text)).toEqual(Array.from({ length: 40 }, (_, i) => `คำ${i + 1}`))
  expect(kept.at(-1)).toEqual({ text: "คำ40", atS: 3.9 })
  // forty from the word it starts at, not the sentence's first forty
  expect(motionWords(many, 20_200_000, 6).map((word) => word.text)).toEqual(Array.from({ length: 40 }, (_, i) => `คำ${i + 3}`))
  // exactly forty are all kept
  expect(motionWords(many, 20_500_000, 6)).toHaveLength(40)
  expect(motionWords(many, 20_600_000, 6)).toHaveLength(39)
})

test("a word's seconds are rounded to the millisecond, so a time that has not really moved is the same number every time", () => {
  const sentence = sentenceOf([
    { text: "ก", startUs: 0, timelineUs: 7_000_000 },
    { text: "ข", startUs: 1_234_567, timelineUs: 8_234_567 },
    { text: "ค", startUs: 1_600_000, timelineUs: 8_600_400 },
    { text: "ง", startUs: 1_900_000, timelineUs: 8_900_500 },
  ])
  expect(motionWords(sentence, 0, 6)).toEqual([{ text: "ก", atS: 0 }, { text: "ข", atS: 1.235 }, { text: "ค", atS: 1.6 }, { text: "ง", atS: 1.901 }])
  // 0.1 + 0.2 of a second is 0.3, not 0.30000000000000004
  expect(motionWords(sentenceOf(words(["ก", "ข", "ค", "ง"], 0, 100_000, 100_000)), 100_000, 6).map((word) => word.atS)).toEqual([0, 0.1, 0.2])
})

test("a sentence with no words has no words to write for", () => {
  expect(motionWords({ ...SENTENCES[0]!, words: [] }, 11_200_000, 3)).toEqual([])
})

test("the words are counted on the rough cut, where a pause inside the sentence may be cut out, and a word that plays before the first is left out", () => {
  // "ยอดขาย ปีนี้ … หนึ่ง ล้าน บาท" with 1.5 s of silence after "ปีนี้", of which the rough cut takes 1.2 s out
  expect(motionWords(PAUSED, 10_000_000, 3)).toEqual([
    { text: "ยอดขาย", atS: 0 },
    { text: "ปีนี้", atS: 0.5 },
    { text: "หนึ่ง", atS: 1.3 },
    { text: "ล้าน", atS: 1.6 },
    { text: "บาท", atS: 1.9 },
  ])
  // a sentence made by hand, whose second word the cut plays before its first
  const shuffled = sentenceOf([
    { text: "ก", startUs: 1_000_000, timelineUs: 5_000_000 },
    { text: "ข", startUs: 1_300_000, timelineUs: 4_000_000 },
    { text: "ค", startUs: 1_600_000, timelineUs: 5_600_000 },
  ])
  expect(motionWords(shuffled, 1_000_000, 3)).toEqual([{ text: "ก", atS: 0 }, { text: "ค", atS: 0.6 }])
  // and a word of the sentence before the one the words start at is not one of them, though the cut plays it after
  expect(motionWords(shuffled, 1_300_000, 3)).toEqual([{ text: "ข", atS: 0 }, { text: "ค", atS: 1.6 }])
})

test("of two words that start at the same moment the first is where the words start, and a word's text is kept as the sentence has it", () => {
  const sentence = sentenceOf([
    { text: "กิน", startUs: 4_000_000, timelineUs: 0 },
    // whisper.cpp writes "ทำ" as a separate nikhahit and sara aa: the text is not rewritten
    { text: "ทํา", startUs: 5_000_000, timelineUs: 1_000_000 },
    { text: " อาหาร", startUs: 5_000_000, timelineUs: 1_000_000 },
    { text: "เย็น", startUs: 5_500_000, timelineUs: 1_500_000 },
  ])
  expect(motionWords(sentence, 5_000_000, 3)).toEqual([{ text: "ทํา", atS: 0 }, { text: " อาหาร", atS: 0 }, { text: "เย็น", atS: 0.5 }])
})

// Claude's answer, made into cues

test("an answer becomes a motion graphic not yet written: on the word it starts at, with its box, seconds, reason, idea and the words said while it plays", () => {
  const { graphics, dropped } = accept(reply(), SENTENCES)
  expect(dropped).toBe(0)
  // "หนึ่งล้าน" spans two ICU tokens, "หนึ่ง" and "ล้าน": it resolves to the start of "หนึ่ง"
  expect(graphics).toStrictEqual([
    {
      anchor: { kind: "speech", videoId: "v", sourceUs: 11_200_000, beatId: "b1" },
      spec: {
        kind: "motion",
        version: MOTION_VERSION,
        box: { x0: 0.04, y0: 0.55, x1: 0.96, y1: 0.9 },
        seconds: 3,
        why: "ตัวเลขยอดขาย",
        idea: IDEA,
        words: [{ text: "หนึ่ง", atS: 0 }, { text: "ล้าน", atS: 0.3 }, { text: "สอง", atS: 0.6 }, { text: "แสน", atS: 0.9 }, { text: "บาท", atS: 1.2 }],
        html: null,
      },
      edited: false,
      off: false,
      // the point the helper put on the first sentence
      pointId: "p1",
    },
  ])
})

test("the words of a graphic are motionWords of its point's sentence, from the moment it is anchored at, for its length after clamping", () => {
  for (const over of [{}, { word: "สองแสน" }, { word: "ไม่มี" }, { word: "", seconds: 0.5 }, { word: "ยอดขาย", seconds: 9 }, { word: "เดือน", seconds: 1.8 }, { word: "ยอดขาย", seconds: 1.5, until: "บาท" }]) {
    const [graphic] = accept(reply(over), SENTENCES).graphics
    const anchor = graphic!.anchor as { sourceUs: number }
    expect(graphic!.spec, JSON.stringify(over)).toMatchObject({ words: motionWords(SENTENCES[0]!, anchor.sourceUs, graphic!.spec.seconds) })
  }
  // a sentence of more words than a graphic is written for: the first forty from its word, as motionWords has them
  const many = sentenceOf(words(Array.from({ length: 45 }, (_, i) => `คำ${i + 1}`), 20_000_000, 1_000_000, 100_000))
  const long = accept(reply({ word: "คำ2", seconds: 6 }), [many]).graphics[0]!
  expect(long.spec).toMatchObject({ words: motionWords(many, 20_100_000, 6) })
  expect((long.spec as { words: unknown[] }).words).toHaveLength(40)
  // a graphic too short to reach a word does not carry it: 1.5 s from "เดือน" stops short of "แสน", said just as it ends, and of "บาท" after that
  expect(accept(reply({ word: "เดือน", seconds: 0.5 }), SENTENCES).graphics[0]!.spec).toMatchObject({ seconds: 1.5, words: [{ text: "เดือน", atS: 0 }, { text: "นี้", atS: 0.3 }, { text: "หนึ่ง", atS: 0.6 }, { text: "ล้าน", atS: 0.9 }, { text: "สอง", atS: 1.2 }] })
})

test("a word matching by ICU-token substring, not compound-token equality, is what the graphic's word uses", () => {
  const { graphics } = accept(reply({ word: "สองแสน" }), SENTENCES)
  expect(graphics[0]!.anchor).toMatchObject({ sourceUs: 11_800_000 })
  expect(graphics[0]!.spec).toMatchObject({ words: [{ text: "สอง", atS: 0 }, { text: "แสน", atS: 0.3 }, { text: "บาท", atS: 0.6 }] })
})

test("a word the sentence does not say starts the graphic at the point's start", () => {
  const { graphics, dropped } = accept(reply({ word: "ไม่มี" }), SENTENCES)
  expect(dropped).toBe(0)
  expect(graphics[0]!.anchor).toMatchObject({ sourceUs: 10_000_000 })
  expect(graphics[0]!.spec).toMatchObject({ words: [{ text: "ยอด", atS: 0 }, { text: "ขาย", atS: 0.3 }, { text: "เดือน", atS: 0.6 }, { text: "นี้", atS: 0.9 }, { text: "หนึ่ง", atS: 1.2 }, { text: "ล้าน", atS: 1.5 }, { text: "สอง", atS: 1.8 }, { text: "แสน", atS: 2.1 }, { text: "บาท", atS: 2.4 }] })
})

/** "ในอวกาศไม่มีอากาศ คนในยานต้องใส่ชุด": "ใน" is said twice, 2.4 s apart. */
const TWICE = sentenceOf(
  playedWhole([
    { text: "ใน", startUs: 30_000_000 },
    { text: "อวกาศ", startUs: 30_300_000 },
    { text: "ไม่มี", startUs: 30_800_000 },
    { text: "อากาศ", startUs: 31_200_000 },
    { text: "คน", startUs: 32_000_000 },
    { text: "ใน", startUs: 32_400_000 },
    { text: "ยาน", startUs: 32_700_000 },
    { text: "ต้อง", startUs: 33_100_000 },
    { text: "ใส่", startUs: 33_400_000 },
    { text: "ชุด", startUs: 33_700_000 },
  ]),
)
/** A point of that sentence whose own first word is the one said at this moment. */
const pointAt = (sourceUs: number, sentence = TWICE): GraphicPoint => ({ ...pointOn(sentence), anchor: { kind: "speech", videoId: sentence.videoId, sourceUs, beatId: sentence.beatId } })
/** The graphic one answer becomes on that point. */
const startedAt = (sourceUs: number, over: Partial<MotionPlanReply["graphics"][number]>, sentence = TWICE) => acceptMotionPlan(reply(over), [pointAt(sourceUs, sentence)]).graphics[0]!

test("a word said twice starts the graphic at the saying nearest the point's own moment, not at the first: the earlier of two as near", () => {
  // the point is on "ยาน", 32.7 s: the "ใน" just before it, not the one that opens the sentence 2.7 s earlier
  const near = startedAt(32_700_000, { word: "ใน" })
  expect(near.anchor).toEqual({ kind: "speech", videoId: "v9", sourceUs: 32_400_000, beatId: "b9" })
  expect((near.spec as MotionSpec).words.map((word) => word.text)).toEqual(["ใน", "ยาน", "ต้อง", "ใส่", "ชุด"])
  expect((near.spec as MotionSpec).words[1]).toEqual({ text: "ยาน", atS: 0.3 })
  // the point is on "ไม่มี", 30.8 s: the first "ใน", 0.8 s before, is nearer than the second, 1.6 s after
  expect(startedAt(30_800_000, { word: "ใน" }).anchor).toMatchObject({ sourceUs: 30_000_000 })
  // a saying after the point is taken too when it is the nearer one: from "คน", 32.0 s, the second is 0.4 s on
  expect(startedAt(32_000_000, { word: "ใน" }).anchor).toMatchObject({ sourceUs: 32_400_000 })
  // on "อากาศ", 31.2 s, the two are 1.2 s away each: the earlier
  expect(startedAt(31_200_000, { word: "ใน" }).anchor).toMatchObject({ sourceUs: 30_000_000 })
})

test("a word said once starts the graphic where it is said, wherever the point is, and one not said at the point's own word, as before", () => {
  expect(startedAt(30_800_000, { word: "ยาน" }).anchor).toMatchObject({ sourceUs: 32_700_000 })
  expect(startedAt(33_400_000, { word: "อวกาศ" }).anchor).toMatchObject({ sourceUs: 30_300_000 })
  // not said, or none named: the word of the sentence said at the point's own moment
  expect(startedAt(32_700_000, { word: "ไม่เคย" }).anchor).toMatchObject({ sourceUs: 32_700_000 })
  expect(startedAt(32_700_000, { word: "" }).anchor).toMatchObject({ sourceUs: 32_700_000 })
  // a saying of the word on its own is what counts, however near the same letters sit inside a longer word
  const inside = sentenceOf(playedWhole([{ text: "ใน", startUs: 0 }, { text: "ห้อง", startUs: 400_000 }, { text: "ข้างใน", startUs: 2_000_000 }, { text: "ยาน", startUs: 2_600_000 }]))
  expect(startedAt(2_600_000, { word: "ใน" }, inside).anchor).toMatchObject({ sourceUs: 0 })
  // with no saying of it on its own, the longer words that hold it are its places, and the nearest of them is taken the same way
  const only = sentenceOf(playedWhole([{ text: "ถูกใจ", startUs: 0 }, { text: "มาก", startUs: 400_000 }, { text: "จริงใจ", startUs: 800_000 }, { text: "เลย", startUs: 1_300_000 }]))
  expect(startedAt(1_300_000, { word: "ใจ" }, only).anchor).toMatchObject({ sourceUs: 800_000 })
  expect(startedAt(0, { word: "ใจ" }, only).anchor).toMatchObject({ sourceUs: 0 })
})

test("the last word is looked for from the saying the graphic starts at", () => {
  // from the second "ใน", "ชุด" is 1.3 s on: a second more
  expect((startedAt(32_700_000, { word: "ใน", seconds: 1.5, until: "ชุด" }).spec as MotionSpec).seconds).toBe(2.3)
  // "อวกาศ" is said only before it, and changes nothing
  expect((startedAt(32_700_000, { word: "ใน", seconds: 1.5, until: "อวกาศ" }).spec as MotionSpec).seconds).toBe(1.5)
  // from the first "ใน", it is 0.3 s on, and "ชุด" 3.7 s on
  expect((startedAt(30_800_000, { word: "ใน", seconds: 1.5, until: "ชุด" }).spec as MotionSpec).seconds).toBe(4.7)
  // a last word said twice is its first saying from there: the second "ใน" from "อวกาศ", 2.1 s on
  expect((startedAt(30_300_000, { word: "อวกาศ", seconds: 1.5, until: "ใน" }).spec as MotionSpec).seconds).toBe(3.1)
})

test("a sentence with no words gets no start, and the answer is dropped", () => {
  const empty: GraphicSentence = { ...SENTENCES[0]!, words: [] }
  expect(accept(reply(), [empty])).toEqual({ graphics: [], dropped: 1 })
})

const THAI_COMPOSE_SENTENCE: GraphicSentence = {
  videoId: "v9",
  beatId: "b9",
  atUs: 0,
  text: "กินทำอาหาร",
  // whisper.cpp writes "ทำ" as a separate nikhahit + sara aa; Claude answers with the single composed character
  words: playedWhole([{ text: "กิน", startUs: 4_000_000 }, { text: "ทํา", startUs: 5_000_000 }, { text: "อาหาร", startUs: 5_500_000 }]),
  timelineEndUs: 2_000_000,
  scene: null,
}

test("the graphic's word is matched the way Thai is shown, whatever the transcript wrote, and whichever of the two wrote it apart", () => {
  // the fallback (the sentence's start, "กิน" at 4,000,000) would land on a different, wrong, time
  expect(accept(reply({ word: "ทำ" }), [THAI_COMPOSE_SENTENCE]).graphics[0]!.anchor).toMatchObject({ sourceUs: 5_000_000 })
  // the other way round: the transcript writes "ทำ" composed, and Claude spells it with a separate nikhahit and sara aa
  const composedTranscript: GraphicSentence = { ...THAI_COMPOSE_SENTENCE, words: playedWhole([{ text: "กิน", startUs: 4_000_000 }, { text: "ทำ", startUs: 5_000_000 }, { text: "อาหาร", startUs: 5_500_000 }]) }
  expect(accept(reply({ word: "ทํา" }), [composedTranscript]).graphics[0]!.anchor).toMatchObject({ sourceUs: 5_000_000 })
})

test("a space inside Claude's word does not stop it matching", () => {
  // "หนึ่ง ล้าน" (with a space) must still find "หนึ่งล้าน" in the sentence, which has none between its tokens
  expect(accept(reply({ word: "หนึ่ง ล้าน" }), SENTENCES).graphics[0]!.anchor).toMatchObject({ sourceUs: 11_200_000 })
})

/** "ปกติ 1,990 บาท เหลือ 990 บาท": the sale price is the last three digits of the old one. */
const PRICE_DROP: GraphicSentence = {
  videoId: "v12", beatId: "b12", atUs: 0, text: "ปกติ 1,990 บาท เหลือ 990 บาท",
  words: playedWhole([
    { text: "ปกติ", startUs: 0 },
    { text: "1,990", startUs: 500_000 },
    { text: "บาท", startUs: 1_200_000 },
    { text: "เหลือ", startUs: 1_800_000 },
    { text: "990", startUs: 2_600_000 },
    { text: "บาท", startUs: 3_300_000 },
  ]),
  timelineEndUs: 3_800_000, scene: null,
}

test("a word that is a whole word of the sentence wins over the same letters inside an earlier, longer one", () => {
  expect(accept(reply({ word: "990" }), [PRICE_DROP]).graphics[0]!.anchor).toMatchObject({ sourceUs: 2_600_000 })
  // "ถูก" said inside "ถูกใจ" first, then on its own
  const cheap = sentenceOf(playedWhole([{ text: "ถูกใจ", startUs: 0 }, { text: "มาก", startUs: 400_000 }, { text: "ถูก", startUs: 800_000 }, { text: "จริง", startUs: 1_100_000 }]))
  expect(accept(reply({ word: "ถูก" }), [cheap]).graphics[0]!.anchor).toMatchObject({ sourceUs: 800_000 })
})

test("the same letters inside a longer word still match when the sentence says them no other way, and found only inside longer words they resolve to the first", () => {
  // Claude answers "ใจ", which the transcript only has inside "ถูกใจ"
  const once = sentenceOf(playedWhole([{ text: "มาก", startUs: 0 }, { text: "ถูกใจ", startUs: 400_000 }]))
  expect(accept(reply({ word: "ใจ" }), [once]).graphics[0]!.anchor).toMatchObject({ sourceUs: 400_000 })
  // "ใจ" is said only inside "ถูกใจ" and, later, inside "จริงใจ"
  const twice = sentenceOf(playedWhole([{ text: "ถูกใจ", startUs: 0 }, { text: "มาก", startUs: 400_000 }, { text: "จริงใจ", startUs: 800_000 }]))
  expect(accept(reply({ word: "ใจ" }), [twice]).graphics[0]!.anchor).toMatchObject({ sourceUs: 0 })
})

test("a graphic is anchored where its word is said in the source, and its words are timed on the rough cut it plays on", () => {
  const { graphics } = accept(reply({ word: "ปีนี้", seconds: 1.5 }), [PAUSED])
  expect(graphics[0]!.anchor).toMatchObject({ sourceUs: 10_500_000 })
  // "ล้าน" is heard 1.1 s after "ปีนี้" on the cut, inside the 1.5 s, though it was said 2.3 s after it; "บาท" is heard 1.4 s after
  expect(graphics[0]!.spec).toMatchObject({ words: [{ text: "ปีนี้", atS: 0 }, { text: "หนึ่ง", atS: 0.8 }, { text: "ล้าน", atS: 1.1 }, { text: "บาท", atS: 1.4 }] })
})

test("a graphic on a point starts at the point's own first word when Claude names none, and carries the point", () => {
  const { graphics } = acceptMotionPlan(reply({ word: "" }), [ON_MILLION])
  expect(graphics[0]).toMatchObject({ anchor: { kind: "speech", videoId: "v", sourceUs: 11_200_000, beatId: "b1" }, pointId: "p-million" })
  expect(graphics[0]!.spec).toMatchObject({ words: [{ text: "หนึ่ง", atS: 0 }, { text: "ล้าน", atS: 0.3 }, { text: "สอง", atS: 0.6 }, { text: "แสน", atS: 0.9 }, { text: "บาท", atS: 1.2 }] })
  // a word Claude names is found anywhere in the point's sentence, before the point too
  expect(acceptMotionPlan(reply({ word: "ยอดขาย" }), [ON_MILLION]).graphics[0]!.anchor).toMatchObject({ sourceUs: 10_000_000 })
})

test("a scene point takes a graphic at its own moment, with no words said while it plays", () => {
  const { graphics, dropped } = acceptMotionPlan(reply({ word: "" }), [SEA])
  expect(dropped).toBe(0)
  expect(graphics[0]).toMatchObject({ anchor: { kind: "speech", videoId: "w", sourceUs: 40_000_000, beatId: "b2" }, pointId: "p-sea" })
  expect(graphics[0]!.spec).toMatchObject({ kind: "motion", words: [], html: null })
  // a word named on a point with no sentence finds nothing, and changes nothing
  expect(acceptMotionPlan(reply({ word: "ทะเล" }), [SEA]).graphics[0]!.anchor).toMatchObject({ sourceUs: 40_000_000 })
})

test("what does not fit is dropped and counted", () => {
  const cases: Partial<MotionPlanReply["graphics"][number]>[] = [
    { point: 9 }, // no such point
    { point: 0 }, // points are numbered from 1
    { point: 3 }, // one past the last
    { box: [0.04, 0.55, 0.96] },
    { box: [0.04, 0.55, 0.96, 0.9, 1] }, // five numbers, not four
    { box: [] },
    { box: [0.96, 0.55, 0.04, 0.9] }, // right of its own right edge
    { box: [0.04, 0.9, 0.96, 0.55] }, // below its own bottom edge
    { box: [-0.01, 0.55, 0.96, 0.9] }, // an edge left of the frame, otherwise a fine size
    { box: [0.04, -0.01, 0.96, 0.3] }, // an edge above the frame
    { box: [0.04, 0.55, 1.01, 0.9] }, // an edge right of the frame
    { box: [0.04, 0.7, 0.96, 1.01] }, // an edge below the frame
    { box: [0.3, 0.55, 0.7, 0.9] }, // too narrow, tall enough
    { box: [0.04, 0.55, 0.96, 0.62] }, // wide enough, too short
    { box: [0.04, 0.2, 0.96, 0.9] }, // wide enough, too tall
    { idea: "" },
    { idea: "   \n " }, // white space only
  ]
  for (const over of cases) expect(accept(reply(over), SENTENCES), JSON.stringify(over)).toEqual({ graphics: [], dropped: 1 })
})

test("a box is half the frame wide or more and 0.15 to a half of it tall, each with 0.05 of slack for a model that rounds, and is kept as it was given", () => {
  const kept = (box: number[]) => accept(reply({ box }), SENTENCES).graphics.map((graphic) => graphic.spec.box)
  // the whole width, and as tall as the prompt allows
  expect(kept([0, 0.5, 1, 1])).toEqual([{ x0: 0, y0: 0.5, x1: 1, y1: 1 }])
  // as narrow and as short as the prompt allows: the free band under a talking head, from 0.58 of the frame to the subtitles at 0.76, takes a box no taller
  expect(kept([0.25, 0.6, 0.75, 0.75])).toEqual([{ x0: 0.25, y0: 0.6, x1: 0.75, y1: 0.75 }])
  expect(kept([0.04, 0.59, 0.96, 0.75])).toEqual([{ x0: 0.04, y0: 0.59, x1: 0.96, y1: 0.75 }])
  // 0.45 wide is within the slack, and is not widened: 0.725 − 0.275 is 0.44999999999999996
  expect(kept([0.275, 0.55, 0.725, 0.9])).toEqual([{ x0: 0.275, y0: 0.55, x1: 0.725, y1: 0.9 }])
  expect(kept([0.28, 0.55, 0.72, 0.9])).toEqual([])
  // 0.10 tall is within the slack: 0.65 − 0.55 is 0.09999999999999998, and 0.8 − 0.7 is 0.10000000000000009
  expect(kept([0.04, 0.55, 0.96, 0.65])).toEqual([{ x0: 0.04, y0: 0.55, x1: 0.96, y1: 0.65 }])
  expect(kept([0.04, 0.7, 0.96, 0.8])).toEqual([{ x0: 0.04, y0: 0.7, x1: 0.96, y1: 0.8 }])
  // and a hair under that is not: 0.099 tall
  expect(kept([0.04, 0.66, 0.96, 0.759])).toEqual([])
  expect(kept([0.04, 0.7, 0.96, 0.79])).toEqual([])
  // 0.55 tall is within the slack, and is not cut down: 0.9 − 0.35 is 0.55, and 0.95 − 0.4 is 0.5499999999999999
  expect(kept([0.04, 0.35, 0.96, 0.9])).toEqual([{ x0: 0.04, y0: 0.35, x1: 0.96, y1: 0.9 }])
  expect(kept([0.04, 0.4, 0.96, 0.95])).toEqual([{ x0: 0.04, y0: 0.4, x1: 0.96, y1: 0.95 }])
  expect(kept([0.04, 0.34, 0.96, 0.9])).toEqual([])
  // a hair over the cap is within it as a hair under the floors is; no box of two or three decimals comes out over 0.55, so this one is written by hand
  expect(kept([0.04, 0.35, 0.96, 0.9000000000005])).toHaveLength(1)
  expect(kept([0.04, 0.35, 0.96, 0.90001])).toEqual([])
})

test("seconds are held to 1.5–6, and are 3 when Claude gives no number", () => {
  const seconds = (answer: number) => accept(reply({ seconds: answer }), SENTENCES).graphics[0]!.spec.seconds
  expect(seconds(9)).toBe(6)
  expect(seconds(6)).toBe(6)
  expect(seconds(4.2)).toBe(4.2)
  expect(seconds(1.5)).toBe(1.5)
  expect(seconds(0.5)).toBe(1.5)
  expect(seconds(-2)).toBe(1.5)
  expect(seconds(Number.NaN)).toBe(3)
  expect(seconds(Number.POSITIVE_INFINITY)).toBe(3)
  // whatever they came from, they come out to the millisecond: the length is written into the page and is part of a render's hash
  expect(seconds(2.23456)).toBe(2.235)
  expect(seconds(4.2000000001)).toBe(4.2)
  expect(seconds(3.0004)).toBe(3)
  expect(seconds(5.9996)).toBe(6)
})

test("a graphic lasts a second past the last word its idea lands on, when that is later than the seconds Claude asked for, and the word is then one of its words", () => {
  // from "ยอด" on, "บาท" is heard 2.4 s later: 3.4 s, not the 1.5 s asked for
  const stretched = planned({ word: "ยอดขาย", seconds: 1.5, until: "บาท" })
  expect(stretched.seconds).toBe(3.4)
  expect(stretched.words.map((word) => word.text)).toEqual(["ยอด", "ขาย", "เดือน", "นี้", "หนึ่ง", "ล้าน", "สอง", "แสน", "บาท"])
  expect(stretched.words.at(-1)).toEqual({ text: "บาท", atS: 2.4 })
  // without the word, the 1.5 s asked for stop at "หนึ่ง": "ล้าน" is said just as they end
  expect(planned({ word: "ยอดขาย", seconds: 1.5 }).words.map((word) => word.text)).toEqual(["ยอด", "ขาย", "เดือน", "นี้", "หนึ่ง"])
  // the time is counted from the word the graphic starts at: from "หนึ่ง", "บาท" is 1.2 s on
  expect(planned({ word: "หนึ่งล้าน", seconds: 1.5, until: "บาท" }).seconds).toBe(2.2)
  // with no number from Claude, the 3 s it then gets are what the word's time is held against
  expect(planned({ word: "ยอดขาย", seconds: Number.NaN, until: "บาท" }).seconds).toBe(3.4)
  expect(planned({ word: "หนึ่งล้าน", seconds: Number.NaN, until: "บาท" }).seconds).toBe(3)
})

test("at the pace of a phrase, five words a second, a graphic stretched to its last word carries that word: the twenty-fifth, 4.8 s in", () => {
  // inside a phrase the real transcript runs at 4 to 4.7 words a second (ten words in 1.92 s), not at the clip's average with its pauses
  const spoken = sentenceOf(words(Array.from({ length: 30 }, (_, i) => `คำ${i + 1}`), 20_000_000, 1_000_000, 200_000))
  const stretched = planned({ word: "คำ1", seconds: 3, until: "คำ25" }, [spoken])
  expect(stretched.seconds).toBe(5.8)
  expect(stretched.words[24]).toEqual({ text: "คำ25", atS: 4.8 })
  // every word said in those 5.8 s, the last of them 5.6 s in
  expect(stretched.words).toHaveLength(29)
  expect(stretched.words).toEqual(motionWords(spoken, 20_000_000, 5.8))
  // a graphic of the longest length takes in every one of the thirty, which are fewer than the cap
  expect(motionWords(spoken, 20_000_000, 6)).toHaveLength(30)
})

test("a last word said sooner than the seconds Claude asked for leaves them as they are", () => {
  // "เดือน" is 0.6 s after "ยอด"
  expect(planned({ word: "ยอดขาย", seconds: 4, until: "เดือน" }).seconds).toBe(4)
  expect(planned({ word: "ยอดขาย", seconds: 3.5, until: "บาท" }).seconds).toBe(3.5)
  // a second past it is just what was asked for
  expect(planned({ word: "ยอดขาย", seconds: 3.4, until: "บาท" }).seconds).toBe(3.4)
  // the word the graphic starts at may be its last word too: a second, which the 1.5 s every graphic gets covers
  expect(planned({ word: "หนึ่งล้าน", seconds: 0.5, until: "หนึ่งล้าน" }).seconds).toBe(1.5)
})

test("the stretch is held to 6 s as any length is, and a last word said no sooner than that is not reached", () => {
  // five words 1.5 s apart: 0, 1.5, 3, 4.5 and 6 s
  const slow = sentenceOf(words(["ก", "ข", "ค", "ง", "จ"], 30_000_000, 1_000_000, 1_500_000))
  expect(planned({ word: "ก", seconds: 2, until: "ง" }, [slow]).seconds).toBe(5.5)
  const held = planned({ word: "ก", seconds: 2, until: "จ" }, [slow])
  expect(held.seconds).toBe(6)
  expect(held.words).toEqual([{ text: "ก", atS: 0 }, { text: "ข", atS: 1.5 }, { text: "ค", atS: 3 }, { text: "ง", atS: 4.5 }])
})

test("a last word the sentence does not say from the graphic's word on changes nothing: one it never says, one said only before, none at all, and any on a point with no sentence", () => {
  expect(planned({ word: "หนึ่งล้าน", seconds: 1.5, until: "ไม่มี" }).seconds).toBe(1.5)
  // "ยอดขาย" is said, but before "หนึ่งล้าน"; from the sentence's start it is found, and is the start itself
  expect(planned({ word: "หนึ่งล้าน", seconds: 1.5, until: "ยอดขาย" }).seconds).toBe(1.5)
  expect(planned({ word: "หนึ่งล้าน", seconds: 1.5, until: "" }).seconds).toBe(1.5)
  expect(planned({ word: "หนึ่งล้าน", seconds: 1.5, until: "   " }).seconds).toBe(1.5)
  // the same answers with the word that is said after it do stretch
  expect(planned({ word: "หนึ่งล้าน", seconds: 1.5, until: "บาท" }).seconds).toBe(2.2)
  // a scene point has no words to find it in
  const onScene = acceptMotionPlan(reply({ word: "", seconds: 2, until: "ทะเล" }), [SEA]).graphics[0]!.spec as MotionSpec
  expect(onScene).toMatchObject({ seconds: 2, words: [] })
  // an answer that never went through the schema, as a stand-in for Claude may give, has no last word at all
  expect(planned({ word: "หนึ่งล้าน", seconds: 1.5, until: undefined as never }).seconds).toBe(1.5)
})

test("the last word is found the way the graphic's own word is: across the transcript's finer words, a whole word first, as Thai is shown, and the first saying of it from the graphic's word on", () => {
  // "สองแสน" spans two ICU tokens and is timed by the first, "สอง", 1.8 s after "ยอด"; a space in it does not matter
  expect(planned({ word: "ยอดขาย", seconds: 1.5, until: "สองแสน" }).seconds).toBe(2.8)
  expect(planned({ word: "ยอดขาย", seconds: 1.5, until: "สอง แสน" }).seconds).toBe(2.8)
  // "990" on its own, 2.6 s in, not the end of "1,990" 0.5 s in
  expect(planned({ word: "ปกติ", seconds: 1.5, until: "990" }, [PRICE_DROP]).seconds).toBe(3.6)
  // a word said twice: from "ปกติ" the first "บาท", 1.2 s on; from "เหลือ" the one after it, 1.5 s on
  expect(planned({ word: "ปกติ", seconds: 1.5, until: "บาท" }, [PRICE_DROP]).seconds).toBe(2.2)
  expect(planned({ word: "เหลือ", seconds: 1.5, until: "บาท" }, [PRICE_DROP]).seconds).toBe(2.5)
  // the transcript's "ทํา", written apart, is Claude's "ทำ", 1 s after "กิน"
  expect(planned({ word: "กิน", seconds: 1.5, until: "ทำ" }, [THAI_COMPOSE_SENTENCE]).seconds).toBe(2)
})

test("the last word's time is counted on the rough cut, as the words' own times are, and the stretched length comes out to the millisecond", () => {
  // "บาท" was said 3.1 s after "ยอดขาย" and plays 1.9 s after it, with the pause cut out
  const paused = planned({ word: "ยอดขาย", seconds: 1.5, until: "บาท" }, [PAUSED])
  expect(paused.seconds).toBe(2.9)
  expect(paused.words.at(-1)).toEqual({ text: "บาท", atS: 1.9 })
  const uneven = sentenceOf([
    { text: "ก", startUs: 0, timelineUs: 7_000_000 },
    { text: "ข", startUs: 1_234_567, timelineUs: 8_234_567 },
    { text: "ค", startUs: 2_000_000, timelineUs: 9_000_000 },
  ])
  const stretched = planned({ word: "ก", seconds: 1.5, until: "ข" }, [uneven])
  // 1.235 s and a second, which is 2.2350000000000003 when added as it stands
  expect(stretched.seconds).toBe(2.235)
  expect(stretched.words).toEqual([{ text: "ก", atS: 0 }, { text: "ข", atS: 1.235 }, { text: "ค", atS: 2 }])
})

test("a point gets one graphic: a second answer on it is dropped and counted, and an answer that is dropped leaves its point free for a later one", () => {
  const second = { ...reply().graphics[0]!, idea: "แท่งเทียบสองแท่ง", why: "อีกอัน" }
  const twice = accept({ graphics: [reply().graphics[0]!, second] }, SENTENCES)
  expect(twice.graphics.map((graphic) => graphic.spec.why)).toEqual(["ตัวเลขยอดขาย"])
  expect(twice.dropped).toBe(1)
  // the second starting on another word of the point's sentence, so no two start at one place: still one a point
  const elsewhere = accept({ graphics: [reply().graphics[0]!, { ...second, word: "ยอดขาย" }] }, SENTENCES)
  expect(elsewhere.graphics.map((graphic) => graphic.spec.why)).toEqual(["ตัวเลขยอดขาย"])
  expect(elsewhere.dropped).toBe(1)
  // the first has no idea and is dropped: the second takes the point
  const after = accept({ graphics: [{ ...reply().graphics[0]!, idea: " " }, second] }, SENTENCES)
  expect(after.graphics.map((graphic) => graphic.spec.why)).toEqual(["อีกอัน"])
  expect(after.dropped).toBe(1)
  // answers on different points are all kept, in the order Claude gave them
  const both = accept({ graphics: [{ ...reply().graphics[0]!, point: 2, word: "ตรง" }, reply().graphics[0]!] }, SENTENCES)
  expect(both.graphics.map((graphic) => graphic.pointId)).toEqual(["p2", "p1"])
  expect(both.graphics[0]!.anchor).toEqual({ kind: "speech", videoId: "v", sourceUs: 14_300_000, beatId: "b1" })
  expect(both.dropped).toBe(0)
})

test("a place gets one graphic: of two points of one sentence whose answers start on the same word, the second is dropped and counted, and an answer that is dropped leaves its word free for a later one", () => {
  // two points of the first sentence: the whole of it, and "หนึ่งล้าน" in it
  const points = [pointOn(SENTENCES[0]!), ON_MILLION]
  const first = { ...reply().graphics[0]!, point: 1, word: "หนึ่งล้าน" }
  const second = { ...reply().graphics[0]!, point: 2, word: "หนึ่งล้าน", idea: "แท่งเทียบสองแท่ง", why: "อีกอัน" }
  // both start on หนึ่ง, 11.2 s into the source: a graphic is known by where it starts, so only the first is kept
  const both = acceptMotionPlan({ graphics: [first, second] }, points)
  expect(both.graphics.map((graphic) => [graphic.pointId, graphic.anchor])).toEqual([["p1", { kind: "speech", videoId: "v", sourceUs: 11_200_000, beatId: "b1" }]])
  expect(both.dropped).toBe(1)
  // the first has no idea and is dropped: the second takes the word
  const after = acceptMotionPlan({ graphics: [{ ...first, idea: " " }, second] }, points)
  expect(after.graphics.map((graphic) => graphic.pointId)).toEqual(["p-million"])
  expect(after.dropped).toBe(1)
  // the two points' answers on different words are both kept
  const apart = acceptMotionPlan({ graphics: [{ ...first, word: "ยอด" }, second] }, points)
  expect(apart.graphics.map((graphic) => [graphic.pointId, graphic.anchor.kind === "speech" && graphic.anchor.sourceUs])).toEqual([
    ["p1", 10_000_000],
    ["p-million", 11_200_000],
  ])
  expect(apart.dropped).toBe(0)
})

test("the same word of the same footage played in another beat is another place, and takes a graphic of its own", () => {
  // the first sentence played twice: in its own beat, and again in a later one
  const again: GraphicSentence = { ...SENTENCES[0]!, beatId: "b2", atUs: 20_000_000, timelineEndUs: 23_000_000 }
  const answer = reply().graphics[0]!
  const { graphics, dropped } = accept({ graphics: [answer, { ...answer, point: 2 }] }, [SENTENCES[0]!, again])
  expect(graphics.map((graphic) => graphic.anchor)).toEqual([
    { kind: "speech", videoId: "v", sourceUs: 11_200_000, beatId: "b1" },
    { kind: "speech", videoId: "v", sourceUs: 11_200_000, beatId: "b2" },
  ])
  expect(dropped).toBe(0)
})

test("a reply with no list of graphics, as a stand-in for Claude may give, is no graphics and nothing dropped", () => {
  expect(acceptMotionPlan({} as never, onPoints(SENTENCES))).toEqual({ graphics: [], dropped: 0 })
  expect(acceptMotionPlan({ graphics: [] }, onPoints(SENTENCES))).toEqual({ graphics: [], dropped: 0 })
})

test("an answer on a point that already carries the user's own graphic is dropped and counted", () => {
  expect(accept(reply(), SENTENCES, new Set([1]))).toEqual({ graphics: [], dropped: 1 })
  // the same answer on a point the user left alone is kept
  expect(accept(reply(), SENTENCES, new Set([2])).graphics).toHaveLength(1)
})

test("the idea and the reason are trimmed, and an idea longer than 400 characters is cut to what it keeps, by whole letters", () => {
  const { graphics } = accept(reply({ idea: `  ${IDEA}\n`, why: "  ตัวเลขยอดขาย  " }), SENTENCES)
  expect(graphics[0]!.spec).toMatchObject({ idea: IDEA, why: "ตัวเลขยอดขาย" })
  const idea = (answer: string) => planned({ idea: answer }).idea
  expect(idea("ก".repeat(400))).toBe("ก".repeat(400))
  expect(idea("ก".repeat(450))).toBe("ก".repeat(400))
  // the real ideas of the smoke run ran to 158–198 characters, and the end of an idea is where its landing word is: one of that length is kept whole
  expect(idea("ก".repeat(198))).toBe("ก".repeat(198))
  // a cut that would part a letter from its vowel or tone mark drops the whole cluster: "ที่" ends one code unit past the limit
  expect(idea(`${"ก".repeat(398)}ที่`)).toBe("ก".repeat(398))
  // the white space around it is not counted
  expect(idea(`   ${"ก".repeat(400)}   `)).toBe("ก".repeat(400))
  // and a cut that lands just after a space leaves none at the end
  expect(idea(`${"ก".repeat(399)} ${"ข".repeat(50)}`)).toBe("ก".repeat(399))
})

test("an idea is one line: every run of white space in it, line breaks too, is one space, before it is cut", () => {
  const idea = (answer: string) => planned({ idea: answer }).idea
  expect(idea("ตัวเลขวิ่งถึง 28,000\nแล้วหน่วย  เด้งขึ้น\r\n\n\tเข็มกวาดตาม")).toBe("ตัวเลขวิ่งถึง 28,000 แล้วหน่วย เด้งขึ้น เข็มกวาดตาม")
  expect(idea("\n  ป้ายราคา \n")).toBe("ป้ายราคา")
  // the white space taken out is not counted against the cut: 390 letters, a long gap and 5 more are 396 characters, and all are kept
  expect(idea(`${"ก".repeat(390)}${" \n".repeat(15)}${"ข".repeat(5)}`)).toBe(`${"ก".repeat(390)} ${"ข".repeat(5)}`)
  // white space alone is no idea
  expect(accept(reply({ idea: " \n\t " }), SENTENCES)).toEqual({ graphics: [], dropped: 1 })
})

test("an answer written without a word, a last word or a reason reads as starting at its point, lasting as long as asked, with no reason; one without an idea is dropped alone", () => {
  const parsed = MotionPlanReplySchema.parse({
    graphics: [
      { point: 1, seconds: 3, box: [0.04, 0.55, 0.96, 0.9], idea: IDEA },
      { point: 2, word: "ตรง", seconds: 2, why: "ชี้", box: [0.04, 0.55, 0.96, 0.9] },
    ],
  })
  expect(parsed.graphics.map((graphic) => [graphic.word, graphic.until, graphic.why, graphic.idea])).toEqual([["", "", "", IDEA], ["ตรง", "", "ชี้", ""]])
  const { graphics, dropped } = accept(parsed, SENTENCES)
  expect(graphics.map((graphic) => [graphic.pointId, graphic.spec.why, graphic.spec.seconds])).toEqual([["p1", "", 3]])
  expect(dropped).toBe(1)
})

// the prompt and the schema

test("Claude is asked for a list of graphics, each a point, the word it starts at, the last word it lands on, seconds, a reason, a box and an idea, and nothing else", () => {
  const schema = replySchema(MotionPlanReplySchema) as { properties: { graphics: { items: { properties: Record<string, unknown>; additionalProperties: boolean } } } }
  expect(schema).toMatchObject({
    type: "object",
    required: ["graphics"],
    additionalProperties: false,
    properties: {
      graphics: {
        type: "array",
        items: {
          type: "object",
          properties: { point: { type: "integer" }, word: { type: "string" }, until: { type: "string" }, seconds: { type: "number" }, why: { type: "string" }, box: { type: "array", items: { type: "number" } }, idea: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
  })
  const fields = Object.keys(schema.properties.graphics.items.properties)
  expect([...fields].sort()).toEqual(["box", "idea", "point", "seconds", "until", "why", "word"])
  // and the prompt says what each of them is
  for (const field of fields) expect(MOTION_PLAN_PROMPT.system, field).toContain(`\n- ${field}: `)
})

test("the prompt holds a graphic to the rules the app applies, and says nothing of the kit it replaces", () => {
  const { system } = MOTION_PLAN_PROMPT
  expect(MOTION_PLAN_PROMPT_VERSION).toBe("motion-plan-2026-09-30b")
  expect(MOTION_PLAN_PROMPT.version).toBe(MOTION_PLAN_PROMPT_VERSION)
  expect(system.startsWith('คุณเลือกว่าจุดเน้นไหนของวิดีโอสั้นควรมี "โมชันกราฟิก" และคิดไอเดียของแต่ละชิ้น')).toBe(true)
  // what the request holds, which the first lines tell Claude how to read
  expect(system).toContain("ข้อความเด่นของแต่ละจุดและซับที่ครองพื้นที่อยู่แล้ว และเฟรมของบางจุดแนบท้าย — จุดที่ไม่มีเฟรม ดูภาพเองไม่ได้\n")
  expect(system).toContain("\nkeepClear และแถบข้อความเด่น [บน, ล่าง] = แถบเต็มความกว้าง สัดส่วนความสูงจากขอบบน\n")
  // a graphic takes the place of its point's highlight text, so it goes only where it says more than that text does; no quota, and the app chooses the level
  expect(system).toContain(
    "\n\nจุดที่คุณใส่กราฟิก ข้อความเด่นของจุดนั้นจะไม่ขึ้น กราฟิกขึ้นแทน จึงใส่เฉพาะจุดที่ภาพเคลื่อนไหวช่วยให้คนดูเข้าใจหรือรู้สึกตามได้มากกว่าข้อความเด่นของจุดนั้น จุดที่ไม่เหมาะไม่ต้องใส่ ข้อความเด่นจะขึ้นตามเดิม ห้ามใส่แค่ตกแต่ง ตอบเป็นรายการว่างได้\n",
  )
  // the text gone, the graphic carries the word the viewer must read
  expect(system).toContain("\n- กราฟิกขึ้นแทนข้อความเด่นของจุดนั้น ให้แสดงสิ่งที่ตัวหนังสืออย่างเดียวทำให้เห็นไม่ได้ ถ้าคนดูต้องได้อ่านคำสำคัญของจุด ให้กราฟิกพาคำนั้นไปด้วย สั้น ๆ ตรงตัว\n")
  // what it said while the text stayed is gone
  for (const old of ["มากกว่าคำพูดกับข้อความเด่นที่มีอยู่แล้ว", "กราฟิกต้องไม่เขียนคำเดิมซ้ำ", "ทั้งของจุดนั้นและจุดถัดไป"]) expect(system, old).not.toContain(old)
  expect(system).toContain("แอปเลือกเองว่าจะแสดงจุดระดับไหนตามระดับความจัดที่ผู้ใช้ตั้ง จึงให้วางกับทุกจุดที่เหมาะ")
  expect(system).not.toContain("ใส่ได้ไม่เกิน")
  expect(system).toContain("\n- หนึ่งจุดมีกราฟิกได้อันเดียว · ")
  // the limits acceptMotionPlan holds an answer to
  expect(system).toContain(
    "\n- กรอบ: กว้าง 0.5–1.0 ของจอ สูง 0.15–0.5 ให้ใหญ่ที่สุดเท่าที่ที่ว่างของจุดนั้นมี เพราะกราฟิกถูกวาดอยู่ในกรอบเท่านั้น และไอเดียต้องพอดีกับกรอบ (กรอบเตี้ยใช้ไอเดียแถวเดียว เช่น ตัวเลขวิ่งหรือแถบ) · ห้ามทับ keepClear ของฉากนั้น ห้ามทับพื้นที่ซับ · แถบข้อความเด่นของจุดที่ใส่กราฟิกใช้ได้ เพราะข้อความนั้นจะไม่ขึ้น แต่ห้ามทับข้อความเด่นของจุดอื่นที่ขึ้นระหว่างกราฟิกอยู่บนจอ · เว้น 0.07 บนสุดของจอไว้ให้แถบเมนูของแอปโซเชียล · บนจอแนวตั้งวางไว้ครึ่งล่างเป็นหลัก ถ้าครึ่งล่างไม่ว่างค่อยใช้ช่วงบนเหนือหัวคน\n",
  )
  expect(system).toContain('\n- word: คำในประโยคของจุดนั้นที่กราฟิกเริ่มขึ้น คัดลอกตรงตัว ("" = ต้นวลีของจุด) · ')
  expect(system).toContain("· word ของจุดเน้นภาพให้เป็นค่าว่าง\n")
  // Claude plans without the words' times: it names the last word its idea lands on, and the app sees to the length
  expect(system).toContain('\n- until: คำสุดท้ายในประโยคของจุดนั้นที่ไอเดียใช้เป็นจังหวะ คัดลอกตรงตัว แอปรู้เวลาของทุกคำ จะให้กราฟิกอยู่ถึงคำนี้แล้วเผื่อเวลาให้อ่านและออกเอง ("" = ไอเดียไม่ผูกกับคำไหนหลังคำเริ่ม)\n')
  expect(system).toContain("\n- seconds: อยากให้อยู่นานกี่วินาที 1.5–6 นับจากคำเริ่ม ถ้าคำใน until มาช้ากว่านั้น แอปยืดให้ถึงเอง (ถ้าภาพตัดไปช่วงอื่นก่อนครบ กราฟิกจะจบตรงนั้น)\n")
  expect(system).toContain("\n- idea: วาดอะไรและขยับอย่างไร เป็นภาษาไทย หนึ่งถึงสองประโยค ชัดพอให้นักออกแบบลงมือได้โดยไม่ต้องเดา\n")
  // the designer sees no video, so nothing in it is pointed at, and nothing that cannot be drawn is asked for
  expect(system).toContain("นักออกแบบเห็นแค่ไอเดีย คำที่พูดพร้อมเวลา และขนาดกรอบ ไม่เห็นวิดีโอ")
  expect(system).toContain("ไม่มีรูปถ่าย โลโก้ หรืออีโมจิ")
  // a box at the very top sits under the social apps' own menu, and an idea that names colours fights the style's palette
  expect(system).toContain("· เว้น 0.07 บนสุดของจอไว้ให้แถบเมนูของแอปโซเชียล · ")
  expect(system).toContain("\n  · ไม่ต้องระบุสี นักออกแบบใช้ชุดสีของสไตล์ที่ผู้ใช้เลือก\n")
  for (const gone of ["การ์ด", "สติกเกอร์", "sticker", "card", "pieces", "motion:", "emoji:", "tone", "arrow", "ring"]) expect(system, gone).not.toContain(gone)
})

test("the box the prompt gives as its example is one the app takes", () => {
  const example = /\n- box: [^\n]*เช่น \[([\d., ]+)\]/.exec(MOTION_PLAN_PROMPT.system)?.[1]
  expect(example).toBe("0.04, 0.55, 0.96, 0.9")
  const box = example!.split(",").map(Number)
  expect(accept(reply({ box }), SENTENCES).graphics[0]!.spec.box).toEqual({ x0: 0.04, y0: 0.55, x1: 0.96, y1: 0.9 })
})

// the call

test("with no point, or every point already the user's, Claude is not asked", async () => {
  const { transport, calls } = fakeTransport()
  expect(await planMotion({ transport, model: "m", brief: BRIEF, points: [], canvas, frames: {} })).toEqual({ graphics: [], dropped: 0 })
  const existing = [
    { point: 1, summary: "ตัวเลขวิ่ง", off: true },
    { point: 2, summary: "ลูกศรชี้", off: false },
  ]
  expect(await planMotion({ transport, model: "m", brief: BRIEF, points: onPoints(SENTENCES), canvas, frames: {}, existing })).toEqual({ graphics: [], dropped: 0 })
  expect(calls).toHaveLength(0)
})

test("Claude is asked once, with the prompt, the schema and the stop signal, and its answer becomes the graphics", async () => {
  const { transport, calls } = fakeTransport()
  const stop = new AbortController()
  const points = onPoints(SENTENCES)
  const out = await planMotion({ transport, model: "claude-opus-5-5", brief: BRIEF, points, canvas, frames: {}, signal: stop.signal })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.model).toBe("claude-opus-5-5")
  expect(calls[0]!.system).toBe(MOTION_PLAN_PROMPT.system)
  expect(calls[0]!.schema).toBe(MotionPlanReplySchema)
  expect(calls[0]!.signal).toBe(stop.signal)
  // every point of a long clip may get a graphic, each with an idea of a sentence or two
  expect(calls[0]!.maxTokens).toBe(16_000)
  // no frame to attach: the request is its text alone
  expect(calls[0]!.content).toHaveLength(1)
  expect(out).toEqual(acceptMotionPlan(reply(), points))
  expect(out.graphics).toHaveLength(1)
  expect(out.graphics[0]!.spec).toMatchObject({ kind: "motion", html: null })
})

test("a prompt given to the call is the one Claude is asked with", async () => {
  const { transport, calls } = fakeTransport()
  await planMotion({ transport, model: "m", brief: BRIEF, points: onPoints(SENTENCES), canvas, frames: {}, prompt: { system: "อีกแบบ", version: "x" } })
  expect(calls[0]!.system).toBe("อีกแบบ")
})

test("the request opens with the lines every request on the points opens with, which way the frame lies and where the subtitles start among them, and ends with the note on the frames", async () => {
  const { transport, calls } = fakeTransport()
  await planMotion({ transport, model: "m", brief: { videoType: "review", instructions: " เน้นราคา " } as never, points: [ON_MILLION, SEA, pointOn(SENTENCES[1]!, 2)], canvas, captionsFromY: 0.82, frames: {} })
  expect(textOf(calls[0]!.content)).toBe(
    [
      "brief",
      "- ประเภทวิดีโอ: review",
      "- คำสั่งเพิ่มเติม: เน้นราคา",
      "",
      "จอ แนวตั้ง · ซับเริ่มที่ y = 0.82 ห้ามทับ",
      "",
      "จุดเน้น (เวลาบนคลิป · ความยาว · ความสำคัญ · วลีหรือภาพ · ฉาก)",
      "[1] 0:03.2 ยาว 1.8 วิ (สำคัญ · ตัวเลข/ราคา) “หนึ่งล้าน” ในประโยค “ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท” — ยอดขาย",
      "    ฉาก: talking-head · คนพูดกลางเฟรม · keepClear [0.1, 0.45]",
      "[2] 0:09.0 ยาว 3.0 วิ (เสริม · ภาพสวย) ภาพ: ทะเลตอนเย็น — ทะเล",
      "    ฉาก: b-roll · ทะเลตอนเย็น · keepClear ไม่มี",
      "[3] 0:06.0 ยาว 1.2 วิ (สำคัญ · ตัวเลข/ราคา) “ดูตรงนี้” (ข้อความเด่นของจุดนี้ [0.1, 0.3])",
      "    ฉาก: ไม่มีข้อมูลภาพ",
      "",
      "เฟรมของบางจุดแนบท้ายตามเลขจุด ดูภาพเองก่อนวางกรอบ",
    ].join("\n"),
  )
})

test("the request says a landscape frame is one, and that there are no subtitles when there are none", async () => {
  const { transport, calls } = fakeTransport()
  await planMotion({ transport, model: "m", brief: BRIEF, points: onPoints(SENTENCES), canvas: { width: 1920, height: 1080 }, frames: {} })
  await planMotion({ transport, model: "m", brief: BRIEF, points: onPoints(SENTENCES), canvas, captionsFromY: null, frames: {} })
  expect(textOf(calls[0]!.content).split("\n")).toContain("จอ แนวนอน · ไม่มีซับ")
  expect(textOf(calls[1]!.content).split("\n")).toContain("จอ แนวตั้ง · ไม่มีซับ")
  // nothing of the old kit's request is said: no table of room, no round of cards only, nothing to point at
  for (const text of calls.map((call) => textOf(call.content))) {
    expect(text).not.toContain("สติกเกอร์")
    expect(text).not.toContain("การ์ด")
    expect(text).not.toContain("ชี้ตำแหน่ง")
  }
})

test("the user's own graphics are shown and keep Claude off their points", async () => {
  const { transport, calls } = fakeTransport()
  const out = await planMotion({ transport, model: "m", brief: BRIEF, points: onPoints(SENTENCES), canvas, frames: {}, existing: [{ point: 1, summary: "ตัวเลขวิ่งถึง 1,200,000", off: true }] })
  const lines = textOf(calls[0]!.content).split("\n")
  expect(lines).toContain("กราฟิกที่ผู้ใช้ใส่เอง (ผู้ใช้แก้เอง) แอปคงไว้ตามนั้น ห้ามใส่อันใหม่บนจุดเหล่านี้")
  expect(lines).toContain("[1] ตัวเลขวิ่งถึง 1,200,000 (ผู้ใช้ปิดไว้)")
  // the point itself says so where Claude reads it
  expect(lines.find((line) => line.startsWith("[1] 0:02.0"))).toContain("(ผู้ใช้ใส่เองแล้ว ห้ามใส่ซ้ำ)")
  expect(lines.find((line) => line.startsWith("[2] 0:06.0"))).not.toContain("ผู้ใช้ใส่เองแล้ว")
  // Claude's answer lands on the user's point anyway: it is dropped
  expect(out).toEqual({ graphics: [], dropped: 1 })
})

test("frames are attached one a path, labelled with every point that shares it, and marked on those points", async () => {
  const dir = await mkdtemp(join(tmpdir(), "motion-frame-"))
  const path = join(dir, "frame.jpg")
  await writeFile(path, JPEG)
  const points = onPoints(SENTENCES)
  const { transport, calls } = fakeTransport()
  await planMotion({ transport, model: "m", brief: BRIEF, points, canvas, frames: { [frameKey(points[0]!, 0)]: path, [frameKey(points[1]!, 1)]: path } })
  const content = calls[0]!.content
  expect(content.map((part) => part.type)).toEqual(["text", "text", "image"])
  expect(content[1]).toEqual({ type: "text", text: "เฟรมของจุด 1, 2" })
  expect(content[2]).toEqual({ type: "image", mediaType: "image/jpeg", data: JPEG.toString("base64") })
  const lines = textOf(content).split("\n")
  expect(lines.find((line) => line.startsWith("[1] "))).toContain("(มีเฟรม)")
  expect(lines.find((line) => line.startsWith("[2] "))).toContain("(ข้อความเด่นของจุดนี้ [0.1, 0.3] · มีเฟรม)")
  // a frame of one point alone names that point, and the other is not marked
  const one = fakeTransport()
  await planMotion({ transport: one.transport, model: "m", brief: BRIEF, points, canvas, frames: { [frameKey(points[1]!, 1)]: path } })
  expect(one.calls[0]!.content[1]).toEqual({ type: "text", text: "เฟรมของจุด 2" })
  expect(textOf(one.calls[0]!.content).split("\n").find((line) => line.startsWith("[1] "))).not.toContain("มีเฟรม")
})

test("no more than twelve frames are attached, and none of a point that is already the user's", async () => {
  const dir = await mkdtemp(join(tmpdir(), "motion-cap-"))
  const many: GraphicPoint[] = []
  const frames: Record<string, string> = {}
  for (let i = 0; i < 13; i++) {
    const path = join(dir, `f${i}.jpg`)
    await writeFile(path, JPEG)
    const point = pointOn({ ...SENTENCES[0]!, videoId: `v${i}` }, i)
    many.push(point)
    frames[frameKey(point, i)] = path
  }
  const { transport, calls } = fakeTransport()
  await planMotion({ transport, model: "m", brief: BRIEF, points: many, canvas, frames })
  expect(calls[0]!.content.filter((part) => part.type === "image")).toHaveLength(12)
  // the first point is the user's: its frame is not sent, and the twelve left all are
  const owned = fakeTransport()
  await planMotion({ transport: owned.transport, model: "m", brief: BRIEF, points: many, canvas, frames, existing: [{ point: 1, summary: "ตัวเลขวิ่ง", off: false }] })
  expect(owned.calls[0]!.content.filter((part) => part.type === "image")).toHaveLength(12)
  expect(textOf(owned.calls[0]!.content)).not.toContain("เฟรมของจุด 1\n")
  expect(textOf(owned.calls[0]!.content)).toContain("เฟรมของจุด 2\n")
})

test("a frame that cannot be read is left out, its point is not marked as having one, and the call goes on", async () => {
  const dir = await mkdtemp(join(tmpdir(), "motion-frame-"))
  const path = join(dir, "frame.jpg")
  await writeFile(path, JPEG)
  const points = onPoints(SENTENCES)
  const { transport, calls } = fakeTransport()
  const out = await planMotion({ transport, model: "m", brief: BRIEF, points, canvas, frames: { [frameKey(points[0]!, 0)]: join(dir, "gone.jpg"), [frameKey(points[1]!, 1)]: path } })
  const content = calls[0]!.content
  expect(content.filter((part) => part.type === "image")).toHaveLength(1)
  expect(textOf(content)).toContain("เฟรมของจุด 2")
  expect(textOf(content)).not.toContain("เฟรมของจุด 1")
  expect(textOf(content).split("\n").find((line) => line.startsWith("[1] "))).not.toContain("มีเฟรม")
  // a motion graphic points at nothing in the picture, so one on a point with no frame is kept
  expect(out.graphics.map((graphic) => graphic.pointId)).toEqual(["p1"])
  expect(out.dropped).toBe(0)
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/graphics/motion/direct")
  expect(exported.planMotion).toBe(planMotion)
  expect(exported.acceptMotionPlan).toBe(acceptMotionPlan)
  expect(exported.motionWords).toBe(motionWords)
})
