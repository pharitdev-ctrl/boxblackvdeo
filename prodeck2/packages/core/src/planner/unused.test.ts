import { describe, expect, test } from "vitest"
import type { TimedText, Transcript } from "../asr/types.ts"
import type { Scene, VideoInsight } from "../vision/describe.ts"
import type { FootageClip } from "./footage.ts"
import { buildBeat, resolveOutline, type Beat, type Outline } from "./outline.ts"
import { addUnusedPart, unusedParts } from "./unused.ts"

const s = (seconds: number) => Math.round(seconds * 1_000_000)
const line = (text: string, start: number, end: number): TimedText => ({ text, startUs: s(start), endUs: s(end) })
const scene = (description: string, start: number, end: number): Scene => ({ startUs: s(start), endUs: s(end), description, kind: "b-roll", issues: [], keepClear: null })

function insight(scenes: Scene[], retakes: VideoInsight["retakes"] = []): VideoInsight {
  const signals = { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] }
  return { model: "m", promptVersion: "v", frameCount: 1, signals, summary: "", scenes, retakes, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
}

const utterances = [
  line("เอาละครับ", 1, 2),
  line("วันนี้คิดว่า", 3, 4),
  line("นักบินขึ้นไปได้ยังไง", 5, 7),
  line("เขาไปได้ไหม", 8, 9),
  line("สาม สอง หนึ่ง", 10, 12),
  line("ไม่ได้ครับ", 13, 14),
  line("สาม สอง หนึ่ง", 15, 17),
  line("สุดยอดไปเลย", 18, 19),
]
const transcript: Transcript = { engine: "whisper-local", model: "m", language: "th", utterances, words: [], audioEvents: [] }
const talk: FootageClip = {
  id: "talk",
  name: "talk.mov",
  durationUs: s(30),
  transcript,
  insight: insight([scene("คนพูดกับกล้อง", 0.5, 19), scene("ห้องว่าง", 22, 25)], [
    {
      takes: [
        { startUs: s(10), endUs: s(12), text: "สามสองหนึ่ง" },
        { startUs: s(15), endUs: s(17), text: "สามสองหนึ่ง" },
      ],
      notes: ["", ""],
      better: "B",
      reason: "",
    },
  ]),
}
const gallery: FootageClip = { id: "gallery", name: "gallery.mp4", durationUs: s(9), transcript: null, insight: insight([scene("รูปเล็บชมพู", 0, 3), scene("รูปเล็บฟ้า", 3, 6), scene("โลโก้ร้าน", 6, 6)]) }
const logo: FootageClip = { id: "logo", name: "logo.mp4", durationUs: s(5), transcript: null, insight: insight([scene("โลโก้", 1, 4)]) }
const clips = [talk, gallery, logo]
const index = { clip: (ref: string) => ({ v1: talk, v2: gallery, v3: logo })[ref], refOf: () => undefined }

/** talk u3–u4, talk u6, gallery s1 — in that order */
const outline: Outline = resolveOutline(
  {
    title: "t",
    summary: "",
    omitted: "",
    direction: "",
    beats: [
      { name: "คำถาม", purpose: "เปิด", clip: "v1", from: "u3", to: "u4" },
      { name: "คำตอบ", purpose: "เฉลย", clip: "v1", from: "u6", to: "u6" },
      { name: "ผลงาน", purpose: "โชว์", clip: "v2", from: "s1", to: "s1" },
    ],
  },
  index,
)
const summary = (beats: Beat[]) => beats.map((beat) => `${beat.videoId}:${beat.kind}:${beat.fromIndex}-${beat.toIndex}`)

describe("unusedParts", () => {
  test("every sentence no beat uses, one by one, and pictures nobody speaks over, grouped by clip in time order", () => {
    const parts = unusedParts(clips, outline)
    expect(parts.map((part) => [part.id, part.kind, part.startUs / 1e6, part.endUs / 1e6, part.text])).toEqual([
      ["talk:u0", "speech", 1, 2, "เอาละครับ"],
      ["talk:u1", "speech", 3, 4, "วันนี้คิดว่า"],
      ["talk:u4", "speech", 10, 12, "สาม สอง หนึ่ง"],
      ["talk:u6", "speech", 15, 17, "สาม สอง หนึ่ง"],
      ["talk:u7", "speech", 18, 19, "สุดยอดไปเลย"],
      ["talk:s1", "scenes", 22, 25, "ห้องว่าง"],
      ["gallery:s1", "scenes", 3, 6, "รูปเล็บฟ้า"],
      ["gallery:s2", "scenes", 6, 9, "โลโก้ร้าน"],
      ["logo:s0", "scenes", 1, 4, "โลโก้"],
    ])
    expect(parts[0]).toMatchObject({ videoId: "talk", videoName: "talk.mov", index: 0 })
  })

  test("a picture beat over a talking clip uses the sentences said during it; a talking clip's own scenes never show up", () => {
    const pictureBeat = buildBeat(talk, "scenes", 0, 0, { tag: "0", name: "ภาพ", purpose: "" })
    expect(unusedParts([talk], { ...outline, beats: [pictureBeat] }).map((part) => part.id)).toEqual(["talk:s1"])
    expect(unusedParts([talk], { ...outline, beats: [] }).map((part) => part.id)).toEqual(["talk:u0", "talk:u1", "talk:u2", "talk:u3", "talk:u4", "talk:u5", "talk:u6", "talk:u7", "talk:s1"])
  })

  test("parts of a clip come in time order, pictures and sentences mixed", () => {
    const mixed: FootageClip = { ...logo, id: "mixed", transcript: { ...transcript, utterances: [line("สวัสดี", 5, 6)] }, insight: insight([scene("โลโก้", 0, 2)]) }
    expect(unusedParts([mixed], { ...outline, beats: [] }).map((part) => part.id)).toEqual(["mixed:s0", "mixed:u0"])
  })

  test("a sentence that is a take of a reviewed retake says which take it is and which one Claude preferred", () => {
    const parts = unusedParts(clips, outline)
    expect(parts.find((part) => part.id === "talk:u4")!.retake).toEqual({ take: "A", better: "B" })
    expect(parts.find((part) => part.id === "talk:u6")!.retake).toEqual({ take: "B", better: "B" })
    expect(parts.find((part) => part.id === "talk:u0")!.retake).toBeNull()
  })
})

describe("addUnusedPart", () => {
  test("a sentence right after a beat's last one extends that beat, so the retake rule still sees both takes", () => {
    const next = addUnusedPart(outline, clips, "talk:u4")
    expect(summary(next.beats)).toEqual(["talk:speech:2-4", "talk:speech:5-5", "gallery:scenes:0-0"])
    expect(next.beats[0]).toMatchObject({ name: "คำถาม", purpose: "เปิด", startUs: s(5), endUs: s(12), speech: "นักบินขึ้นไปได้ยังไง เขาไปได้ไหม สาม สอง หนึ่ง" })
    expect(next.beats[0]!.id).not.toBe(outline.beats[0]!.id)
  })

  test("a sentence right before a beat's first one extends that beat backwards", () => {
    expect(summary(addUnusedPart(outline, clips, "talk:u1").beats)).toEqual(["talk:speech:1-3", "talk:speech:5-5", "gallery:scenes:0-0"])
  })

  test("a part next to no beat becomes a beat of its own, before the next beat of its clip in time", () => {
    const next = addUnusedPart(outline, clips, "talk:u0")
    expect(summary(next.beats)).toEqual(["talk:speech:0-0", "talk:speech:2-3", "talk:speech:5-5", "gallery:scenes:0-0"])
    expect(next.beats[0]).toMatchObject({ name: "เอาละครับ", purpose: "ใส่กลับโดยผู้ใช้", startUs: s(1), endUs: s(2) })
  })

  test("...or after the last earlier beat of its clip, or at the end when its clip has no beat", () => {
    expect(summary(addUnusedPart(outline, clips, "talk:u7").beats)).toEqual(["talk:speech:2-3", "talk:speech:5-5", "talk:speech:7-7", "gallery:scenes:0-0"])
    expect(summary(addUnusedPart(outline, clips, "logo:s0").beats)).toEqual(["talk:speech:2-3", "talk:speech:5-5", "gallery:scenes:0-0", "logo:scenes:0-0"])
  })

  test("a picture next to a picture beat extends it; a single-frame scene lasts until the next sample", () => {
    const next = addUnusedPart(outline, clips, "gallery:s1")
    expect(summary(next.beats)).toEqual(["talk:speech:2-3", "talk:speech:5-5", "gallery:scenes:0-1"])
    expect(next.beats[2]).toMatchObject({ startUs: 0, endUs: s(6), visual: "รูปเล็บชมพู / รูปเล็บฟ้า" })
  })

  test("a picture next to a speech beat of the same clip becomes its own beat", () => {
    const speech = buildBeat(talk, "speech", 0, 0, { tag: "0", name: "เปิด", purpose: "" })
    expect(summary(addUnusedPart({ ...outline, beats: [speech] }, [talk], "talk:s1").beats)).toEqual(["talk:speech:0-0", "talk:scenes:1-1"])
  })

  test("a long sentence gets a short name", () => {
    const long = { ...talk, transcript: { ...transcript, utterances: [line("นี่คือประโยคที่ยาวมากเกินกว่าจะเป็นชื่อช่วงได้ทั้งหมด", 40, 45)] } }
    const next = addUnusedPart({ ...outline, beats: [] }, [long], "talk:u0")
    expect(next.beats[0]!.name).toBe("นี่คือประโยคที่ยาวมากเกินกว่าจะ…")
  })

  test("a part that is not unused is refused", () => {
    expect(() => addUnusedPart(outline, clips, "talk:u2")).toThrow(/not an unused part/)
    expect(() => addUnusedPart(outline, clips, "nope")).toThrow(/not an unused part/)
  })
})
