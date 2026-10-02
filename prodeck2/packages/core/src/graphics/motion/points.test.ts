import { expect, test } from "vitest"
import { frameKey, framesToAttach, type GraphicPoint, type GraphicSentence } from "./points.ts"

/**
 * Real ASR splits Thai far finer than Claude answers with: ICU segmentation turns
 * "ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท" into nine tokens, not the five words Claude would say. "หนึ่งล้าน"
 * and "สองแสน" each span two of them.
 */
const words = (texts: string[], startUs: number, timelineUs: number, stepUs = 300_000) => texts.map((text, i) => ({ text, startUs: startUs + i * stepUs, timelineUs: timelineUs + i * stepUs }))
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

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/graphics/motion/points")
  expect(exported.framesToAttach).toBe(framesToAttach)
  expect(exported.frameKey).toBe(frameKey)
})
