import { expect, test } from "vitest"
import type { Transcript } from "../asr/types.ts"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import type { FootageClip } from "./footage.ts"
import type { OutlineReply } from "./outline.ts"
import type { Brief } from "./brief.ts"
import { planOutline, PLANNER_PROMPT, PLANNER_PROMPT_VERSION } from "./plan.ts"

const transcript: Transcript = {
  engine: "scribe",
  model: "scribe_v2",
  language: "tha",
  utterances: [
    { text: "เอาล่ะครับวันนี้", startUs: 1_900_000, endUs: 7_000_000 },
    { text: "ไม่ได้ครับผม", startUs: 10_200_000, endUs: 11_000_000 },
  ],
  words: [],
  audioEvents: [],
}
const clips: FootageClip[] = [{ id: "bin-a", name: "talk.mov", durationUs: 31_000_000, transcript, insight: null }]

function fakeTransport(reply: OutlineReply) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      return { output: reply as T, usage: { inputTokens: 5000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, requests }
}

const reply: OutlineReply = {
  title: "นักบินอวกาศ",
  summary: "เล่าว่านักบินขึ้นอวกาศอย่างไร",
  omitted: "ตัดช่วงนับถอยหลังที่พูดผิด",
  direction: "  ตื่นเต้น จังหวะเร็ว ช่วงคำตอบเป็นไฮไลต์  ",
  beats: [
    { name: "เปิดเรื่อง", purpose: "ตั้งคำถาม", clip: "v1", from: "u1", to: "u1" },
    { name: "คำตอบ", purpose: "เฉลย", clip: "v1", from: "u2", to: "u2" },
  ],
}

const noBrief: Brief = { targetSeconds: null, videoType: null, instructions: "" }
const texts = (content: LlmContent[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : []))

test("sends the footage first, marked for prompt caching, with the chosen model and planner instructions", async () => {
  const { transport, requests } = fakeTransport(reply)
  await planOutline({ transport, model: "claude-opus-5", clips, brief: noBrief })
  const request = requests[0]!
  expect(request.model).toBe("claude-opus-5")
  expect(request.system).toContain("u1")
  expect(request.content[0]).toMatchObject({ type: "text", cache: true })
  expect(texts(request.content)[0]).toContain("u1 [1.9–7.0] เอาล่ะครับวันนี้")
})

test("spells out the brief the user filled in", async () => {
  const { transport, requests } = fakeTransport(reply)
  await planOutline({
    transport,
    model: "m",
    clips,
    brief: { targetSeconds: 60, videoType: "review", instructions: "เน้นช่วงสนุก" },
  })
  const brief = texts(requests[0]!.content)[1]!
  expect(brief).toContain("ความยาวเป้าหมาย: ประมาณ 60 วินาที")
  expect(brief).toContain("ประเภทคลิป: รีวิว")
  expect(brief).toContain("คำสั่งเพิ่มเติม: เน้นช่วงสนุก")
})

test("says what to do when the brief is left empty", async () => {
  const { transport, requests } = fakeTransport(reply)
  await planOutline({ transport, model: "m", clips, brief: noBrief })
  const brief = texts(requests[0]!.content)[1]!
  expect(brief).toContain("ความยาวเป้าหมาย: ไม่กำหนด")
  expect(brief).toContain("ประเภทคลิป: ไม่ระบุ")
  expect(brief).toContain("คำสั่งเพิ่มเติม: ไม่มี")
})

test("returns the outline with real times, plus usage", async () => {
  const { transport } = fakeTransport(reply)
  const result = await planOutline({ transport, model: "m", clips, brief: noBrief })
  expect(result.outline.title).toBe("นักบินอวกาศ")
  expect(result.outline.beats.map((b) => [b.name, b.startUs, b.endUs])).toEqual([
    ["เปิดเรื่อง", 1_900_000, 7_000_000],
    ["คำตอบ", 10_200_000, 11_000_000],
  ])
  expect(result.usage.inputTokens).toBe(5000)
  expect(result.promptVersion).toBe(PLANNER_PROMPT_VERSION)
})

test("asking for a fresh take shows the previous outline and asks for something different", async () => {
  const first = await planOutline({ ...fakeTransport(reply), model: "m", clips, brief: noBrief })
  const { transport, requests } = fakeTransport(reply)
  await planOutline({ transport, model: "m", clips, brief: noBrief, previous: first.outline })
  const last = texts(requests[0]!.content).at(-1)!
  expect(last).toContain("1. v1 u1–u1 · เปิดเรื่อง — ตั้งคำถาม")
  expect(last).toContain("ต่างจากฉบับก่อน")
})

test("a revision passes the current outline and the user's instruction", async () => {
  const first = await planOutline({ ...fakeTransport(reply), model: "m", clips, brief: noBrief })
  const edited = { ...first.outline, beats: [first.outline.beats[1]!] }
  const { transport, requests } = fakeTransport(reply)
  await planOutline({ transport, model: "m", clips, brief: noBrief, previous: edited, instruction: "เพิ่มช่วงเปิดกลับมา" })
  const last = texts(requests[0]!.content).at(-1)!
  expect(last).toContain("1. v1 u2–u2 · คำตอบ — เฉลย")
  expect(last).not.toContain("เปิดเรื่อง")
  expect(last).toContain("คำสั่งแก้จากผู้ใช้: เพิ่มช่วงเปิดกลับมา")
})

test("the outline keeps the planner's direction, trimmed", async () => {
  const { transport } = fakeTransport(reply)
  const result = await planOutline({ transport, model: "m", clips, brief: noBrief })
  expect(result.outline.direction).toBe("ตื่นเต้น จังหวะเร็ว ช่วงคำตอบเป็นไฮไลต์")
})

test("the planner is told what the decorating adds and asked for a direction", () => {
  const { system } = PLANNER_PROMPT
  expect(system).toContain("ซูมและขยับภาพ แทรกรูปหรือคลิปจากโปรเจค ข้อความเด่นบนจอ กราฟิกเคลื่อนไหว เสียงประกอบ และซับ")
  expect(system).toContain("direction คือแนวทางตกแต่งของทั้งคลิป")
})

test("a revision and a fresh take show the current direction, or none on an older outline", async () => {
  const first = await planOutline({ ...fakeTransport(reply), model: "m", clips, brief: noBrief })
  const revised = fakeTransport(reply)
  await planOutline({ transport: revised.transport, model: "m", clips, brief: noBrief, previous: first.outline, instruction: "สั้นลง" })
  const revision = texts(revised.requests[0]!.content).at(-1)!
  expect(revision).toContain("แนวทางตกแต่งฉบับปัจจุบัน: ตื่นเต้น จังหวะเร็ว ช่วงคำตอบเป็นไฮไลต์")
  expect(revision).toContain("คง direction ไว้ถ้าคำสั่งไม่เกี่ยวกับเรื่องนี้")

  const { direction: _, ...older } = first.outline
  const fresh = fakeTransport(reply)
  await planOutline({ transport: fresh.transport, model: "m", clips, brief: noBrief, previous: older })
  expect(texts(fresh.requests[0]!.content).at(-1)!).toContain("แนวทางตกแต่งฉบับปัจจุบัน: ไม่มี")
})

test("a system prompt handed in replaces the built-in one, and its version is returned", async () => {
  const { transport, requests } = fakeTransport(reply)
  const result = await planOutline({ transport, model: "m", clips, brief: noBrief, prompt: { system: "วางโครงเรื่องแบบใหม่", version: "planner-server-xyz" } })
  expect(requests[0]!.system).toBe("วางโครงเรื่องแบบใหม่")
  expect(result.promptVersion).toBe("planner-server-xyz")
})

test("the planner is told how to choose between takes of a line said twice", () => {
  const { system } = PLANNER_PROMPT
  expect(system).toContain("ให้ใช้เทคที่รายการเทคซ้ำบอกว่าควรใช้ ถ้าไม่มีในรายการหรือพอๆ กัน ให้ใช้เทคหลัง")
  expect(system).toContain("ถ้าใช้เทคก่อน ช่วงนั้นต้องจบก่อนเทคหลังเริ่ม")
  expect(system).toContain("ท่าทางที่ไปกับคำพูด เช่น ชูนิ้วนับ ชี้ หรือยื่นของให้ดู ไม่ใช่ปัญหาภาพ")
  expect(system).not.toContain("ให้ใช้เทคที่สมบูรณ์ที่สุด")
})
