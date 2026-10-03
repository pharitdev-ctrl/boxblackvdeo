import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { LlmRequest, LlmTransport } from "../../llm/types.ts"
import { FREE_GRAPHIC_MIN_US, GRAPHIC_MAX_S } from "../plan.ts"
import { acceptFreePlan, describeFreeClip, FREE_PLAN_PROMPT, FREE_PLAN_PROMPT_VERSION, FreePlanSchema, planFreeGraphics, type FreeClip, type FreePlan } from "./free.ts"

const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9])

const CLIP: FreeClip = {
  brief: { targetSeconds: null, videoType: "review", instructions: " เน้นราคา " },
  direction: "สนุก จังหวะเร็ว ช่วงราคาเป็นไฮไลต์",
  level: "medium",
  portrait: true,
  captionsFromY: 0.82,
  words: [
    { text: "แก้ว", atUs: 0 },
    { text: "ใบนี้", atUs: 400_000 },
    { text: "เก็บ", atUs: 1_000_000 },
    { text: "ความเย็น", atUs: 1_500_000 },
    { text: "ได้", atUs: 2_000_000 },
    { text: "ยี่สิบสี่", atUs: 2_500_000 },
    { text: "ชั่วโมง", atUs: 3_250_000 },
  ],
  points: [
    { atUs: 400_000, kind: "speech", importance: "key", type: "product", text: "แก้วใบนี้", reason: "ของที่ขาย" },
    { atUs: 2_500_000, kind: "speech", importance: "secondary", type: "number", text: "ยี่สิบสี่ชั่วโมง", reason: "" },
    // a scene point: its text is what the picture shows
    { atUs: 3_000_000, kind: "scene", importance: "extra", type: "visual", text: "ทะเล", reason: "" },
  ],
  texts: [
    { startUs: 300_000, endUs: 1_800_000, point: 1, band: { fromY: 0.1, toY: 0.25 }, text: "แก้วเก็บเย็น" },
    { startUs: 2_400_000, endUs: 4_000_000, point: null, band: { fromY: 0.6666, toY: 0.755 }, text: "24 ชม." },
  ],
  scenes: [
    { startUs: 0, endUs: 2_000_000, kind: "talking-head", description: "คนถือแก้ว", keepClear: { fromY: 0.2, toY: 0.58 }, objects: [
      { what: "หน้าคน", kind: "keep", box: { x0: 0.3, y0: 0.15, x1: 0.7, y1: 0.45 }, still: false },
      { what: "แก้ว", kind: "point", box: { x0: 0.62, y0: 0.55, x1: 0.8, y1: 0.7 }, still: true },
    ] },
    { startUs: 2_000_000, endUs: 3_000_000, kind: "b-roll", description: "แก้วบนโต๊ะ", keepClear: null, objects: [] },
    { startUs: 3_000_000, endUs: 4_000_000, kind: "b-roll", description: "ทะเล", keepClear: null, objects: null },
  ],
  own: [
    { startUs: 1_000_000, endUs: 3_500_000, box: { x0: 0.05, y0: 0.6, x1: 0.95, y1: 0.8 }, idea: "ตัวเลข 24 วิ่ง", off: false },
    { startUs: 3_000_000, endUs: 4_000_000, box: { x0: 0.1, y0: 0.1, x1: 0.333333, y1: 0.2 }, idea: "ดาว", off: true },
  ],
}

test("the prompt goes by its version and asks for every field of the reply on a line of its own", () => {
  expect(FREE_PLAN_PROMPT_VERSION).toBe("free-plan-2026-10-03-direction")
  expect(FREE_PLAN_PROMPT.system).toContain("\n- ทำให้เข้ากับแนวทางของคลิป ทั้งช่วงที่ควรใส่หนักหรือเบาและสไตล์ภาพ ถ้าแนวทางขัดกับคำสั่งเพิ่มเติมของผู้ใช้ ให้ทำตามคำสั่งของผู้ใช้\n")
  // a graphic tied to a point starts in that point's stretch: where its text comes up, or where it plays when it has none
  expect(FREE_PLAN_PROMPT.system).toContain("\n- ชิ้นที่เล่าเรื่องของจุดเน้นไหน ให้บอกเลขจุด ชิ้นนั้นต้องเริ่มในช่วงของจุดนั้น คือช่วงที่ข้อความเด่นของจุดขึ้น หรือช่วงที่จุดนั้นเล่นถ้าจุดไม่มีข้อความเด่น\n")
  expect(FREE_PLAN_PROMPT.version).toBe(FREE_PLAN_PROMPT_VERSION)
  const fields = Object.keys(FreePlanSchema.shape.graphics.element.shape)
  expect(fields).toEqual(["word", "until", "seconds", "point", "from", "box", "why", "idea"])
  for (const field of fields) expect(FREE_PLAN_PROMPT.system, field).toContain(`\n- ${field}: `)
  expect(FREE_PLAN_PROMPT.system.startsWith('คุณออกแบบ "โมชันกราฟิก" ให้วิดีโอสั้นทั้งคลิป')).toBe(true)
  expect(FREE_PLAN_PROMPT.system.endsWith('พร้อมป้าย "แก้วเก็บความเย็น" เด้งข้างลูกศรตอนพูด "แก้วใบนี้"\n')).toBe(true)
})

test("the clip is described with every list in its order, each time on the clock and each number to two decimals at most, and a scene point as its picture", () => {
  expect(describeFreeClip(CLIP)).toBe(
    [
      "brief",
      "- ประเภทวิดีโอ: review",
      "- คำสั่งเพิ่มเติม: เน้นราคา",
      "- แนวทางของคลิป: สนุก จังหวะเร็ว ช่วงราคาเป็นไฮไลต์",
      "",
      "ระดับที่ผู้ใช้เลือก: medium",
      "จอ แนวตั้ง · ซับ: แถบ [0.82, 1] อยู่ข้างหน้ากราฟิก",
      "",
      "คำพูด",
      "1. 0:00.0 แก้ว",
      "2. 0:00.4 ใบนี้",
      "3. 0:01.0 เก็บ",
      "4. 0:01.5 ความเย็น",
      "5. 0:02.0 ได้",
      "6. 0:02.5 ยี่สิบสี่",
      "7. 0:03.3 ชั่วโมง",
      "",
      "จุดเน้น",
      "[1] 0:00.4 (สำคัญ · ของ) “แก้วใบนี้” — ของที่ขาย",
      "[2] 0:02.5 (รอง · ตัวเลข/ราคา) “ยี่สิบสี่ชั่วโมง”",
      "[3] 0:03.0 (เสริม · ภาพสวย) ภาพ: ทะเล",
      "",
      "ข้อความเด่น",
      "- 0:00.3–0:01.8 จุด 1 แถบ [0.1, 0.25] “แก้วเก็บเย็น”",
      "- 0:02.4–0:04.0 ไม่มีจุด แถบ [0.67, 0.76] “24 ชม.”",
      "",
      "ฉาก",
      "- 0:00.0–0:02.0 talking-head · คนถือแก้ว · keepClear [0.2, 0.58]",
      "    ของ: keep “หน้าคน” [0.3, 0.15, 0.7, 0.45] · point “แก้ว” [0.62, 0.55, 0.8, 0.7] นิ่ง",
      "- 0:02.0–0:03.0 b-roll · แก้วบนโต๊ะ · keepClear ไม่มี",
      "    ของ: ไม่มี",
      "- 0:03.0–0:04.0 b-roll · ทะเล · keepClear ไม่มี",
      "    ของ: ไม่ได้จด",
      "",
      "กราฟิกที่ผู้ใช้ใส่เอง",
      "- 0:01.0–0:03.5 [0.05, 0.6, 0.95, 0.8] ตัวเลข 24 วิ่ง",
      "- 0:03.0–0:04.0 [0.1, 0.1, 0.33, 0.2] ดาว (ปิดไว้)",
    ].join("\n"),
  )
})

test("an empty clip says so on every list, and a landscape one with no subtitles and no brief says that", () => {
  const empty: FreeClip = { ...CLIP, brief: { targetSeconds: null, videoType: null, instructions: "  " }, direction: undefined, level: "light", portrait: false, captionsFromY: null, words: [], points: [], texts: [], scenes: [], own: [] }
  expect(describeFreeClip(empty)).toBe(
    [
      "brief",
      "- ประเภทวิดีโอ: ไม่ระบุ",
      "- คำสั่งเพิ่มเติม: ไม่ระบุ",
      "- แนวทางของคลิป: ไม่มี",
      "",
      "ระดับที่ผู้ใช้เลือก: light",
      "จอ แนวนอน · ไม่มีซับ",
      "",
      "คำพูด ไม่มี",
      "",
      "จุดเน้น ไม่มี",
      "",
      "ข้อความเด่น ไม่มี",
      "",
      "ฉาก ไม่มี",
      "",
      "กราฟิกที่ผู้ใช้ใส่เอง ไม่มี",
    ].join("\n"),
  )
})

type Answer = FreePlan["graphics"][number]
const answer = (over: Partial<Answer> = {}): Answer => ({ word: 2, until: 0, seconds: 2.5, point: 1, from: "light", box: [0.55, 0.5, 0.85, 0.72], why: " ชี้แก้ว ", idea: "ลูกศรชี้แก้ว", ...over })
const plan = (...graphics: Answer[]): FreePlan => ({ graphics })

test("an answer is taken with its word and point made indexes from 0, its why trimmed and its seconds as asked", () => {
  expect(acceptFreePlan(plan(answer()), CLIP)).toEqual({
    graphics: [{ word: 1, point: 0, from: "light", seconds: 2.5, box: { x0: 0.55, y0: 0.5, x1: 0.85, y1: 0.72 }, why: "ชี้แก้ว", idea: "ลูกศรชี้แก้ว" }],
    dropped: 0,
  })
})

test("a word that names nothing is dropped and counted", () => {
  const out = acceptFreePlan(plan(answer({ word: 0 }), answer({ word: 8 }), answer({ word: -1 }), answer({ word: 7 })), CLIP)
  expect(out.graphics.map((graphic) => graphic.word)).toEqual([6])
  expect(out.dropped).toBe(3)
})

test("a box that is not four finite numbers inside the frame, written the right way round, is dropped and counted", () => {
  const bad = [
    [0.1, 0.5, 0.9],
    [0.1, 0.5, 0.9, 0.8, 0.9],
    [Number.NaN, 0.5, 0.9, 0.8],
    [0.1, 0.5, Number.POSITIVE_INFINITY, 0.8],
    [-0.01, 0.5, 0.9, 0.8],
    [0.1, 0.5, 1.01, 0.8],
    [0.1, 0.5, 0.9, 1.01],
    [0.9, 0.5, 0.1, 0.8],
    [0.5, 0.5, 0.5, 0.8],
    [0.1, 0.8, 0.9, 0.5],
    [0.1, 0.6, 0.9, 0.6],
  ]
  const out = acceptFreePlan(plan(...bad.map((box, i) => answer({ word: (i % 7) + 1, box }))), CLIP)
  expect(out).toEqual({ graphics: [], dropped: bad.length })
  // the whole frame, and a tiny box, are both boxes
  expect(acceptFreePlan(plan(answer({ box: [0, 0.07, 1, 1] }), answer({ word: 3, box: [0.4, 0.4, 0.41, 0.41] })), CLIP).dropped).toBe(0)
})

test("a box whose top is in the band kept for the app's bar is dropped, with half a hundredth of slack", () => {
  expect(acceptFreePlan(plan(answer({ box: [0.1, 0.06, 0.9, 0.3] })), CLIP)).toEqual({ graphics: [], dropped: 1 })
  expect(acceptFreePlan(plan(answer({ box: [0.1, 0, 0.9, 0.3] })), CLIP)).toEqual({ graphics: [], dropped: 1 })
  expect(acceptFreePlan(plan(answer({ box: [0.1, 0.066, 0.9, 0.3] })), CLIP).graphics).toHaveLength(1)
})

test("an idea is made one line and cut to 400 characters by whole letters, and one with nothing in it is dropped", () => {
  const out = acceptFreePlan(plan(answer({ idea: "  ลูกศร\n  ชี้แก้ว  " }), answer({ word: 3, idea: "ที่".repeat(200) }), answer({ word: 4, idea: " \n " }), answer({ word: 5, idea: undefined as never })), CLIP)
  expect(out.graphics.map((graphic) => graphic.idea)).toEqual(["ลูกศร ชี้แก้ว", "ที่".repeat(133)])
  expect(out.dropped).toBe(2)
})

test("a second answer on a word already taken is dropped, and one dropped for another reason takes nothing", () => {
  const out = acceptFreePlan(plan(answer({ box: [0.1] }), answer({ idea: "แรก" }), answer({ idea: "สอง" })), CLIP)
  expect(out.graphics.map((graphic) => graphic.idea)).toEqual(["แรก"])
  expect(out.dropped).toBe(2)
})

test("a point of 0 or one that names nothing is none, and the graphic stays", () => {
  const out = acceptFreePlan(plan(answer({ word: 1, point: 0 }), answer({ word: 2, point: 4 }), answer({ word: 3, point: -1 }), answer({ word: 4, point: 2 })), CLIP)
  expect(out.graphics.map((graphic) => graphic.point)).toEqual([null, null, null, 1])
  expect(out.dropped).toBe(0)
})

test("a graphic lasts until its last word is said and a second more, when that is longer than it asked", () => {
  // from word 2 (0.4 s) to word 7 (3.25 s) is 2.85 s, and a second more
  expect(acceptFreePlan(plan(answer({ until: 7, seconds: 2 })), CLIP).graphics[0]!.seconds).toBe(3.85)
  // what it asked is longer
  expect(acceptFreePlan(plan(answer({ until: 3, seconds: 2 })), CLIP).graphics[0]!.seconds).toBe(2)
  // its own word is a last word too: a second
  expect(acceptFreePlan(plan(answer({ until: 2, seconds: 0.5 })), CLIP).graphics[0]!.seconds).toBe(1)
})

test("an until of 0, one that names nothing, and one before the start are none", () => {
  for (const until of [0, 8, -2, 1]) expect(acceptFreePlan(plan(answer({ until, seconds: 1.2 })), CLIP).graphics[0]!.seconds, String(until)).toBe(1.2)
  // a stand-in reply that never went through the schema may have no until or point
  const bare = acceptFreePlan(plan(answer({ until: undefined as never, point: undefined as never, why: undefined as never, seconds: 1.2 })), CLIP).graphics[0]!
  expect([bare.seconds, bare.point, bare.why]).toEqual([1.2, null, ""])
})

test("the seconds are 3 when not a number, held to the free floor and the ceiling, and rounded to the millisecond", () => {
  const seconds = (over: Partial<Answer>) => acceptFreePlan(plan(answer(over)), CLIP).graphics[0]!.seconds
  expect(seconds({ seconds: Number.NaN })).toBe(3)
  expect(seconds({ seconds: Number.POSITIVE_INFINITY })).toBe(3)
  expect(seconds({ seconds: 0.2 })).toBe(FREE_GRAPHIC_MIN_US / 1e6)
  expect(seconds({ seconds: 0.8 })).toBe(0.8)
  expect(seconds({ seconds: 9 })).toBe(GRAPHIC_MAX_S)
  expect(seconds({ seconds: 1.23456 })).toBe(1.235)
  // a last word past the ceiling is held to it too
  expect(acceptFreePlan(plan(answer({ word: 1, until: 7, seconds: 1 })), { ...CLIP, words: CLIP.words.map((word, i) => ({ ...word, atUs: i * 2_000_000 })) }).graphics[0]!.seconds).toBe(GRAPHIC_MAX_S)
})

test("a stand-in reply with no list gives nothing and drops nothing", () => {
  expect(acceptFreePlan({} as FreePlan, CLIP)).toEqual({ graphics: [], dropped: 0 })
})

test("the schema fills in what an answer may leave out, and refuses a level that is not one", () => {
  const parsed = FreePlanSchema.parse({ graphics: [{ word: 3, seconds: 2, from: "heavy", box: [0, 0.5, 1, 0.8] }] })
  expect(parsed.graphics[0]).toEqual({ word: 3, until: 0, seconds: 2, point: 0, from: "heavy", box: [0, 0.5, 1, 0.8], why: "", idea: "" })
  expect(FreePlanSchema.safeParse({ graphics: [{ word: 3, seconds: 2, from: "max", box: [] }] }).success).toBe(false)
  expect(FreePlanSchema.safeParse({ graphics: [{ word: 3.5, seconds: 2, from: "light", box: [] }] }).success).toBe(false)
})

/** A transport that records every request and answers with a fixed reply. */
function fakeTransport(output: FreePlan = plan(answer())) {
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

test("planning sends the clip described, then each frame that can be read after its label, and accepts the reply", async () => {
  const dir = await mkdtemp(join(tmpdir(), "free-frame-"))
  const path = join(dir, "frame.jpg")
  await writeFile(path, JPEG)
  const { transport, calls } = fakeTransport(plan(answer(), answer({ word: 9 })))
  const stop = new AbortController()
  const out = await planFreeGraphics({
    transport,
    model: "claude-opus-5-5",
    clip: CLIP,
    frames: [
      { label: "เฟรมของฉาก 1", path },
      { label: "เฟรมของฉาก 2", path: join(dir, "gone.jpg") },
      { label: "เฟรมของฉาก 3", path },
    ],
    signal: stop.signal,
  })
  expect(out).toEqual(acceptFreePlan(plan(answer(), answer({ word: 9 })), CLIP))
  expect(out.dropped).toBe(1)
  expect(calls).toHaveLength(1)
  const request = calls[0]!
  expect(request.model).toBe("claude-opus-5-5")
  expect(request.system).toBe(FREE_PLAN_PROMPT.system)
  expect(request.schema).toBe(FreePlanSchema)
  expect(request.maxTokens).toBe(16_000)
  expect(request.signal).toBe(stop.signal)
  const data = JPEG.toString("base64")
  expect(request.content).toEqual([
    { type: "text", text: describeFreeClip(CLIP) },
    { type: "text", text: "เฟรมของฉาก 1" },
    { type: "image", mediaType: "image/jpeg", data },
    { type: "text", text: "เฟรมของฉาก 3" },
    { type: "image", mediaType: "image/jpeg", data },
  ])
})

test("planning goes by a prompt given in place of the built-in one", async () => {
  const { transport, calls } = fakeTransport()
  await planFreeGraphics({ transport, model: "m", clip: CLIP, frames: [], prompt: { system: "อีกแบบ", version: "x" } })
  expect(calls[0]!.system).toBe("อีกแบบ")
})

test("a clip with no words makes no call", async () => {
  const { transport, calls } = fakeTransport()
  expect(await planFreeGraphics({ transport, model: "m", clip: { ...CLIP, words: [] }, frames: [] })).toEqual({ graphics: [], dropped: 0 })
  expect(calls).toHaveLength(0)
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/graphics/motion/free")
  expect(exported.planFreeGraphics).toBe(planFreeGraphics)
  expect(exported.acceptFreePlan).toBe(acceptFreePlan)
  expect(exported.describeFreeClip).toBe(describeFreeClip)
})
