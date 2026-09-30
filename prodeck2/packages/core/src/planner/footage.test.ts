import { expect, test } from "vitest"
import type { Transcript } from "../asr/types.ts"
import type { VideoInsight } from "../vision/describe.ts"
import { describeFootage, type FootageClip } from "./footage.ts"

const transcript: Transcript = {
  engine: "scribe",
  model: "scribe_v2",
  language: "tha",
  utterances: [
    { text: "เอาล่ะครับวันนี้", startUs: 1_900_000, endUs: 7_040_000 },
    { text: "ไม่ได้ครับผม", startUs: 10_220_000, endUs: 10_980_000 },
  ],
  words: [],
  audioEvents: [],
}

const insight: VideoInsight = {
  model: "claude-opus-5",
  promptVersion: "vision-2026-09-17",
  frameCount: 4,
  retakes: [],
  signals: { sceneCutsUs: [], black: [], frozen: [], silent: [{ startUs: 0, endUs: 1_900_000 }], blurry: [{ startUs: 8_000_000, endUs: 9_500_000 }] },
  summary: "ชายหนุ่มพูดเรื่องอวกาศ",
  scenes: [
    { startUs: 500_000, endUs: 9_500_000, description: "ชายหนุ่มพูดกับกล้อง", kind: "talking-head", issues: [], keepClear: null },
    { startUs: 12_500_000, endUs: 18_500_000, description: "ยกมือประกอบ", kind: "talking-head", issues: ["มือบังหน้า"], keepClear: null },
  ],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}

const talk: FootageClip = { id: "bin-a", name: "IMG_9646.MOV", durationUs: 31_106_000, transcript, insight }
const broll: FootageClip = { id: "bin-b", name: "gallery.mp4", durationUs: 5_000_000, transcript: null, insight: null }

test("gives every clip a short reference and lists what was said with ids and times", () => {
  const { text } = describeFootage([talk, broll])
  expect(text).toContain("คลิป v1 · IMG_9646.MOV · ยาว 31.1 วินาที")
  expect(text).toContain("u1 [1.9–7.0] เอาล่ะครับวันนี้")
  expect(text).toContain("u2 [10.2–11.0] ไม่ได้ครับผม")
  expect(text).toContain("คลิป v2 · gallery.mp4 · ยาว 5.0 วินาที")
})

test("lists the scenes with their kind and any problems Claude saw", () => {
  const { text } = describeFootage([talk])
  expect(text).toContain("ภาพรวม: ชายหนุ่มพูดเรื่องอวกาศ")
  expect(text).toContain("s1 [0.5–9.5] talking-head · ชายหนุ่มพูดกับกล้อง")
  expect(text).toContain("s2 [12.5–18.5] talking-head · ยกมือประกอบ · ปัญหา: มือบังหน้า")
})

test("includes measured picture problems but not ordinary pauses", () => {
  const { text } = describeFootage([talk])
  expect(text).toContain("ภาพเบลอ 8.0–9.5")
  expect(text).not.toContain("0.0–1.9")
})

test("says plainly when a clip has no speech or was not analysed", () => {
  const { text } = describeFootage([broll])
  expect(text).toContain("คำพูด: ไม่มี")
  expect(text).toContain("ฉาก: ยังไม่ได้วิเคราะห์ภาพ")
})

test("the index maps references back to clips, utterances and scenes", () => {
  const { index } = describeFootage([talk, broll])
  expect(index.clip("v1")?.id).toBe("bin-a")
  expect(index.clip("v2")?.id).toBe("bin-b")
  expect(index.clip("v3")).toBeUndefined()
  expect(index.refOf("bin-b")).toBe("v2")
})

test("lists lines said twice with Claude's comparison of the takes, and nothing when there are none", () => {
  const retake = (better: "A" | "B" | "same") => ({
    takes: [
      { startUs: 19_780_000, endUs: 22_060_000, text: "สามสองหนึ่ง" },
      { startUs: 22_620_000, endUs: 25_250_000, text: "สามสองหนึ่ง" },
    ] as [{ startUs: number; endUs: number; text: string }, { startUs: number; endUs: number; text: string }],
    notes: ["ชูสามนิ้วตอนพูดสอง", "ชูนิ้วตรงกับตัวเลขทุกคำ"] as [string, string],
    better,
    reason: "เทคหลังนิ้วตรงกับที่พูด",
  })
  const text = (better: "A" | "B" | "same") => describeFootage([{ ...talk, insight: { ...insight, retakes: [retake(better)] } }]).text

  expect(text("B")).toContain(
    "เทคซ้ำ (พูดซ้ำ เทียบภาพของแต่ละเทคแล้ว):\n- เทคก่อน [19.8–22.1] สามสองหนึ่ง · เทคหลัง [22.6–25.3] สามสองหนึ่ง · ควรใช้เทคหลัง: เทคหลังนิ้วตรงกับที่พูด (เทคก่อน: ชูสามนิ้วตอนพูดสอง · เทคหลัง: ชูนิ้วตรงกับตัวเลขทุกคำ)",
  )
  expect(text("A")).toContain("· ควรใช้เทคก่อน: ")
  expect(text("same")).toContain("· สองเทคพอๆ กัน: ")
  expect(describeFootage([talk]).text).not.toContain("เทคซ้ำ")
})
