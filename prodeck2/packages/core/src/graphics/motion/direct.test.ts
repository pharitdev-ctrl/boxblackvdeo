import { expect, test } from "vitest"
import type { GraphicSentence } from "./points.ts"
import { motionWords } from "./direct.ts"

/**
 * Real ASR splits Thai far finer than Claude answers with: ICU segmentation turns
 * "ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท" into nine tokens, not the five words Claude would say. "หนึ่งล้าน"
 * and "สองแสน" each span two of them.
 */
const words = (texts: string[], startUs: number, timelineUs: number, stepUs = 300_000) => texts.map((text, i) => ({ text, startUs: startUs + i * stepUs, timelineUs: timelineUs + i * stepUs }))
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

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/graphics/motion/direct")
  expect(exported.motionWords).toBe(motionWords)
})
