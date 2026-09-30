import { expect, test } from "vitest"
import { describePoints, findWord, frameKey, framesToAttach, startOf, wordAt, type GraphicPoint, type GraphicSentence } from "./points.ts"

const canvas = { width: 1080, height: 1920 }
const BRIEF = { videoType: null, instructions: "" } as never

/**
 * Real ASR splits Thai far finer than Claude answers with: ICU segmentation turns
 * "ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท" into nine tokens, not the five words Claude would say. "หนึ่งล้าน"
 * and "สองแสน" each span two of them.
 */
const words = (texts: string[], startUs: number, timelineUs: number, stepUs = 300_000) => texts.map((text, i) => ({ text, startUs: startUs + i * stepUs, timelineUs: timelineUs + i * stepUs }))
/** Words the rough cut plays as they were said, from `atUs` on: nothing cut out between them. */
const playedWhole = (said: { text: string; startUs: number }[], atUs = 0) => said.map((word) => ({ ...word, timelineUs: atUs + word.startUs - said[0]!.startUs }))
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
/** The request's lines for a point per sentence, with no frame attached and no graphic of the user's. */
const linesFor = (sentences: GraphicSentence[]) => describePoints({ brief: BRIEF, points: onPoints(sentences), canvas, framed: new Set(), existing: [] })

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

test("the request opens with the brief, the frame and the subtitles, then each point with its scene, and the user's own graphics last", () => {
  const existing = [{ point: 2, summary: "คลื่นซัดเข้าฝั่ง", off: true }]
  expect(describePoints({ brief: BRIEF, points: [ON_MILLION, SEA], canvas, captionsFromY: 0.82, framed: new Set(), existing })).toEqual([
    "brief",
    "- ประเภทวิดีโอ: ไม่ระบุ",
    "- คำสั่งเพิ่มเติม: ไม่ระบุ",
    "",
    "จอ แนวตั้ง · ซับเริ่มที่ y = 0.82 ห้ามทับ",
    "",
    "จุดเน้น (เวลาบนคลิป · ความยาว · ความสำคัญ · วลีหรือภาพ · ฉาก)",
    "[1] 0:03.2 ยาว 1.8 วิ (สำคัญ · ตัวเลข/ราคา) “หนึ่งล้าน” ในประโยค “ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท” — ยอดขาย\n    ฉาก: talking-head · คนพูดกลางเฟรม · keepClear [0.1, 0.45]",
    "[2] 0:09.0 ยาว 3.0 วิ (เสริม · ภาพสวย) ภาพ: ทะเลตอนเย็น — ทะเล (ผู้ใช้ใส่เองแล้ว ห้ามใส่ซ้ำ)\n    ฉาก: b-roll · ทะเลตอนเย็น · keepClear ไม่มี",
    "",
    "กราฟิกที่ผู้ใช้ใส่เอง (ผู้ใช้แก้เอง) แอปคงไว้ตามนั้น ห้ามใส่อันใหม่บนจุดเหล่านี้",
    "[2] คลื่นซัดเข้าฝั่ง (ผู้ใช้ปิดไว้)",
  ])
})

test("a point's length is how long it plays on the rough cut, with a pause the cut took out left out", () => {
  // said over 3.6 s of the source (10.0–13.6 s), it plays 2.0–4.3 s of the rough cut
  expect(linesFor([PAUSED]).find((line) => line.startsWith("[1] "))).toContain("[1] 0:02.0 ยาว 2.3 วิ")
  // the first sentence plays 2.0–5.0 s, and is shown with what it must keep clear and no text over it
  const lines = linesFor(SENTENCES)
  expect(lines.find((line) => line.startsWith("[1] "))).toContain("[1] 0:02.0 ยาว 3.0 วิ")
  expect(lines.find((line) => line.startsWith("[1] "))).toContain("keepClear [0.1, 0.45]")
  expect(lines.find((line) => line.startsWith("[2] "))).toContain("ข้อความเด่นของจุดนี้ [0.1, 0.3]")
})

test("a point that stops playing before it starts is shown as playing for no time, never less", () => {
  // the cut's edge falls inside its last word: it stops at 1.9 s, before its first word plays at 2.0 s
  const clipped: GraphicPoint = { ...pointOn(SENTENCES[0]!), timelineEndUs: 1_900_000 }
  expect(describePoints({ brief: BRIEF, points: [clipped], canvas, framed: new Set(), existing: [] }).find((line) => line.startsWith("[1] "))).toContain("[1] 0:02.0 ยาว 0.0 วิ")
})

test("a scene still playing at the next point is said once, as the same scene as before, not repeated", () => {
  const scene = { description: "คนพูดกลางเฟรม", kind: "talking-head" as const, keepClear: { fromY: 0.1, toY: 0.45 } }
  const text = linesFor([{ ...SENTENCES[0]!, scene }, { ...SENTENCES[1]!, scene: { ...scene } }]).join("\n")
  expect(text).toContain("ฉากเดียวกับจุดก่อน")
  expect(text.match(/คนพูดกลางเฟรม/g)).toHaveLength(1)
  // one that keeps another band clear is another scene, and is said again
  const moved = linesFor([{ ...SENTENCES[0]!, scene }, { ...SENTENCES[1]!, scene: { ...scene, keepClear: { fromY: 0.2, toY: 0.45 } } }]).join("\n")
  expect(moved).not.toContain("ฉากเดียวกับจุดก่อน")
  expect(moved.match(/คนพูดกลางเฟรม/g)).toHaveLength(2)
})

test("a point whose frame is attached says so, beside the text over it when it has some", () => {
  const lines = describePoints({ brief: BRIEF, points: onPoints(SENTENCES), canvas, framed: new Set([2]), existing: [] })
  expect(lines.find((line) => line.startsWith("[1] "))).not.toContain("มีเฟรม")
  expect(lines.find((line) => line.startsWith("[2] "))).toContain("(ข้อความเด่นของจุดนี้ [0.1, 0.3] · มีเฟรม)")
})

test("framesToAttach spreads more than MAX_FRAMES paths evenly across the clip, not just the first twelve", () => {
  const many: GraphicSentence[] = []
  const frames: Record<string, string> = {}
  for (let i = 0; i < 30; i++) {
    const sentence: GraphicSentence = { ...SENTENCES[0]!, videoId: `v${i}` }
    many.push(sentence)
    frames[frameKey(sentence, i)] = `/frame/${i}.jpg`
  }
  const chosen = framesToAttach(onPoints(many), frames)
  expect(chosen).toHaveLength(12)
  // index i chosen is floor(i * 30 / 12): the first sentence and one near the end are both included
  expect(chosen[0]!.pointNumbers).toEqual([1])
  expect(chosen.at(-1)!.pointNumbers).toEqual([28])
  // and the result stays in clip order, not just insertion order
  const numbers = chosen.map((entry) => entry.pointNumbers[0]!)
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
})

test("frames go only to points Claude may put a graphic on: not one already the user's", () => {
  const many: GraphicSentence[] = []
  const frames: Record<string, string> = {}
  for (let i = 0; i < 30; i++) {
    const sentence: GraphicSentence = { ...SENTENCES[0]!, videoId: `v${i}` }
    many.push(sentence)
    frames[frameKey(sentence, i)] = `/frame/${i}.jpg`
  }
  // points 2 and 3 (from 1) carry the user's own graphics
  const chosen = framesToAttach(onPoints(many), frames, new Set([2, 3]))
  const numbers = chosen.flatMap((entry) => entry.pointNumbers)
  expect(numbers).toHaveLength(12)
  expect(numbers.filter((n) => n === 2 || n === 3)).toEqual([])
  // spread over the twenty-eight left, the first and one near the end included
  expect(numbers[0]).toBe(1)
  expect(numbers.at(-1)).toBeGreaterThanOrEqual(26)

  // a frame shared with a point Claude may not use is still sent for the one it may, and names only that one
  const shared = framesToAttach(onPoints(SENTENCES), { [frameKey(SENTENCES[0]!, 0)]: "/f.jpg", [frameKey(SENTENCES[1]!, 1)]: "/f.jpg" }, new Set([1]))
  expect(shared).toEqual([{ path: "/f.jpg", pointNumbers: [2] }])
})

test("a frame is named by its point's video and number, and points that share a path are one frame carrying both numbers", () => {
  expect(frameKey({ videoId: "v" }, 0)).toBe("v:1")
  expect(frameKey(SEA, 4)).toBe("w:5")
  const points = onPoints(SENTENCES)
  expect(framesToAttach(points, { "v:1": "/f.jpg", "v:2": "/f.jpg" })).toEqual([{ path: "/f.jpg", pointNumbers: [1, 2] }])
  expect(framesToAttach(points, { "v:2": "/g.jpg" })).toEqual([{ path: "/g.jpg", pointNumbers: [2] }])
  expect(framesToAttach(points, {})).toEqual([])
})

test("where a graphic on a point starts is the word Claude named, else the point's own first word, else nowhere", () => {
  // the word named, found anywhere in the point's sentence
  expect(startOf(ON_MILLION, "สองแสน")).toMatchObject({ sourceUs: 11_800_000 })
  // before the point too
  expect(startOf(ON_MILLION, "ยอดขาย")).toMatchObject({ sourceUs: 10_000_000, scope: { fromChar: 0 } })
  // none named, or one the sentence does not say: the point's own first word
  expect(startOf(ON_MILLION, "")).toMatchObject({ sourceUs: 11_200_000 })
  expect(startOf(ON_MILLION, "ไม่มี")).toMatchObject({ sourceUs: 11_200_000 })
  // a scene point has no words: its own moment
  expect(startOf(SEA, "ทะเล")).toMatchObject({ sourceUs: 40_000_000 })
  // a sentence with no words has nowhere to start from
  expect(startOf({ ...ON_MILLION, sentence: { ...SENTENCES[0]!, words: [] } }, "หนึ่งล้าน")).toBeNull()
})

test("with no word named, a later word is looked for from the point's own word on, not from one said before it", () => {
  const repeated: GraphicSentence = {
    videoId: "v3", beatId: "b3", atUs: 0, text: "ราคาเดิมราคาใหม่",
    words: playedWhole([{ text: "ราคา", startUs: 20_000_000 }, { text: "เดิม", startUs: 20_300_000 }, { text: "ราคา", startUs: 20_600_000 }, { text: "ใหม่", startUs: 20_900_000 }]),
    timelineEndUs: 1_200_000, scene: null,
  }
  const onNew: GraphicPoint = { ...pointOn(repeated), text: "ราคาใหม่", atUs: 600_000, anchor: { kind: "speech", videoId: "v3", sourceUs: 20_600_000, beatId: "b3" } }
  const { sourceUs, scope } = startOf(onNew, "")!
  expect(sourceUs).toBe(20_600_000)
  // the second "ราคา", the point's own, not the first one before it
  const hit = findWord(scope.said, "ราคา", scope.fromChar)!
  expect(wordAt(scope.said, scope.sentence, hit.start)).toMatchObject({ startUs: 20_600_000 })
})

test("a word is looked for in what a sentence says from a place on, a whole word before the same letters inside a longer one, and the word that says a place is the transcript's own", () => {
  // "ปกติ 1,990 บาท เหลือ 990 บาท", looked through from its first word
  const { scope } = startOf(pointOn(PRICE_DROP), "ปกติ")!
  const at = (word: string, fromChar = scope.fromChar) => {
    const hit = findWord(scope.said, word, fromChar)
    return hit === null ? null : wordAt(scope.said, scope.sentence, hit.start)
  }
  expect(scope.fromChar).toBe(0)
  // "990" on its own, not the end of "1,990" before it
  expect(at("990")).toEqual({ text: "990", startUs: 2_600_000, timelineUs: 2_600_000 })
  expect(at("1,990")).toMatchObject({ text: "1,990", startUs: 500_000 })
  // a word said twice is its first saying from the place on: past the first "บาท", the second
  const first = findWord(scope.said, "บาท", 0)!
  expect(wordAt(scope.said, scope.sentence, first.start)).toMatchObject({ startUs: 1_200_000 })
  expect(at("บาท", first.end)).toMatchObject({ startUs: 3_300_000 })
  // a word said only before the place, one never said, and no word at all, are not found
  expect(at("ปกติ", first.end)).toBeNull()
  expect(at("ไม่มี")).toBeNull()
  expect(at("")).toBeNull()
  expect(at("  ")).toBeNull()
})

test("a word Claude writes as one is found across the transcript's finer words, and starts at the first of them", () => {
  // "หนึ่งล้าน" is the two tokens "หนึ่ง" and "ล้าน"
  const { scope } = startOf(pointOn(SENTENCES[0]!), "")!
  const hit = findWord(scope.said, "หนึ่งล้าน", 0)!
  expect(wordAt(scope.said, scope.sentence, hit.start)).toEqual({ text: "หนึ่ง", startUs: 11_200_000, timelineUs: 3_200_000 })
  expect(wordAt(scope.said, scope.sentence, hit.end - 1)).toMatchObject({ text: "ล้าน" })
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/graphics/motion/points")
  expect(exported.describePoints).toBe(describePoints)
  expect(exported.framesToAttach).toBe(framesToAttach)
  expect(exported.frameKey).toBe(frameKey)
})
