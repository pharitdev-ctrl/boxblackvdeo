import { expect, test } from "vitest"
import type { Transcript } from "../asr/types.ts"
import type { VideoInsight } from "../vision/describe.ts"
import { describeFootage, type FootageClip } from "./footage.ts"
import { outlineAsText, outlineDurationUs, resolveOutline, type OutlineReply } from "./outline.ts"

const transcript: Transcript = {
  engine: "scribe",
  model: "scribe_v2",
  language: "tha",
  utterances: [
    { text: "เอาล่ะครับวันนี้", startUs: 1_900_000, endUs: 7_000_000 },
    { text: "เขาไปได้ไหม", startUs: 7_400_000, endUs: 9_600_000 },
    { text: "ไม่ได้ครับผม", startUs: 10_200_000, endUs: 11_000_000 },
  ],
  words: [],
  audioEvents: [],
}

const insight = (scenes: VideoInsight["scenes"]): VideoInsight => ({
  model: "claude-opus-5",
  promptVersion: "v",
  frameCount: 1,
  retakes: [],
  signals: { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] },
  summary: "",
  scenes,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
})

const talk: FootageClip = {
  id: "bin-a",
  name: "talk.mov",
  durationUs: 31_000_000,
  transcript,
  insight: insight([
    { startUs: 500_000, endUs: 9_500_000, description: "คนพูดกับกล้อง", kind: "talking-head", issues: [], keepClear: null },
    { startUs: 12_500_000, endUs: 18_500_000, description: "ยกมือ", kind: "talking-head", issues: [], keepClear: null },
  ]),
}
const broll: FootageClip = {
  id: "bin-b",
  name: "gallery.mp4",
  durationUs: 5_000_000,
  transcript: null,
  insight: insight([
    { startUs: 500_000, endUs: 3_500_000, description: "แกลเลอรีรูป", kind: "b-roll", issues: [], keepClear: null },
    { startUs: 4_500_000, endUs: 4_500_000, description: "ภาพสุดท้าย", kind: "b-roll", issues: [], keepClear: null },
  ]),
}

const { index } = describeFootage([talk, broll])

const reply = (beats: OutlineReply["beats"]): OutlineReply => ({ title: "นักบินอวกาศ", summary: "สรุป", omitted: "", beats })
const beat = (clip: string, from: string, to: string, name = "ช่วง") => ({ name, purpose: "เหตุผล", clip, from, to })

test("a speech beat runs from the first utterance's start to the last one's end", () => {
  const outline = resolveOutline(reply([beat("v1", "u1", "u2", "เปิดเรื่อง")]), index)
  expect(outline.beats[0]).toMatchObject({
    name: "เปิดเรื่อง",
    purpose: "เหตุผล",
    videoId: "bin-a",
    videoName: "talk.mov",
    kind: "speech",
    fromIndex: 0,
    toIndex: 1,
    startUs: 1_900_000,
    endUs: 9_600_000,
    speech: "เอาล่ะครับวันนี้ เขาไปได้ไหม",
    visual: "คนพูดกับกล้อง",
  })
})

test("a scene beat takes the scenes' times and whatever was said during them", () => {
  const outline = resolveOutline(reply([beat("v1", "s1", "s1")]), index)
  expect(outline.beats[0]).toMatchObject({ kind: "scenes", startUs: 500_000, endUs: 9_500_000, speech: "เอาล่ะครับวันนี้ เขาไปได้ไหม" })
})

test("a range given backwards is turned around", () => {
  const outline = resolveOutline(reply([beat("v1", "u3", "u2")]), index)
  expect(outline.beats[0]).toMatchObject({ fromIndex: 1, toIndex: 2, startUs: 7_400_000, endUs: 11_000_000 })
})

test("a scene seen in a single frame is given a few seconds, within the clip", () => {
  const outline = resolveOutline(reply([beat("v2", "s2", "s2")]), index)
  expect(outline.beats[0]).toMatchObject({ startUs: 4_500_000, endUs: 5_000_000 })
})

test("beats that point at material that does not exist are dropped with a warning", () => {
  const outline = resolveOutline(
    reply([beat("v1", "u1", "u1"), beat("v9", "u1", "u1"), beat("v1", "u9", "u9"), beat("v2", "x1", "x1"), beat("v1", "u1", "s1")]),
    index,
  )
  expect(outline.beats).toHaveLength(1)
  expect(outline.warnings).toEqual([
    { beat: 2, problem: "unknown-clip" },
    { beat: 3, problem: "unknown-part" },
    { beat: 4, problem: "unknown-part" },
    { beat: 5, problem: "mixed-parts" },
  ])
})

test("every beat gets its own id, even when the same material is used twice", () => {
  const outline = resolveOutline(reply([beat("v1", "u1", "u1"), beat("v1", "u1", "u1")]), index)
  expect(new Set(outline.beats.map((b) => b.id)).size).toBe(2)
})

test("the outline's length is the sum of its beats", () => {
  const outline = resolveOutline(reply([beat("v1", "u1", "u1"), beat("v2", "s1", "s1")]), index)
  expect(outlineDurationUs(outline)).toBe(5_100_000 + 3_000_000)
})

test("an outline can be written back as references, in its current order", () => {
  const outline = resolveOutline(reply([beat("v2", "s1", "s2", "ภาพเปิด"), beat("v1", "u1", "u3", "เล่าเรื่อง")]), index)
  expect(outlineAsText(outline, index)).toBe("1. v2 s1–s2 · ภาพเปิด — เหตุผล\n2. v1 u1–u3 · เล่าเรื่อง — เหตุผล")
})
