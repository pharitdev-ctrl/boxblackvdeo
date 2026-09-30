import { expect, test } from "vitest"
import type { TimedText } from "../asr/types.ts"
import type { HighlightSentence } from "../highlights/pick.ts"
import { replySchema } from "../llm/schema.ts"
import type { LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import {
  acceptEmphasis,
  describeEmphasis,
  EMPHASIS_PROMPT,
  EMPHASIS_PROMPT_VERSION,
  EmphasisReplySchema,
  planEmphasis,
  type EmphasisBeat,
  type EmphasisReply,
  type EmphasisScene,
} from "./plan.ts"
import { EMPHASIS_REASON_MAX, keptReason, type EmphasisPoint } from "./types.ts"

const texts = ["ถ้า", "คุณ", "กำลัง", "มอง", "หา", "ร้าน", "ทำ", "เล็บ", "ราคา", "เริ่ม", "ต้น", "299", "บาท", "ทัก", "มา", "ได้", "เลย"]
const words: TimedText[] = texts.map((text, i) => ({ text, startUs: i * 300_000, endUs: i * 300_000 + 250_000 }))
const wordsOf = (videoId: string) => (videoId === "v1" ? words : [])

const sentences: HighlightSentence[] = [
  { videoId: "v1", beatId: "b1", beatName: "เปิดคลิป", from: 0, to: 8, text: "ถ้าคุณกำลังมองหาร้านทำเล็บ", timelineUs: 0 },
  { videoId: "v1", beatId: "b1", beatName: "เปิดคลิป", from: 8, to: 13, text: "ราคาเริ่มต้น 299 บาท", timelineUs: 2_500_000 },
  { videoId: "v1", beatId: "b2", beatName: "ปิดท้าย", from: 13, to: 17, text: "ทักมาได้เลย", timelineUs: 30_000_000 },
]
const scenes: EmphasisScene[] = [
  { label: "s1", videoId: "v2", beatId: "b3", beatName: "หน้าร้าน", startUs: 1_000_000, endUs: 4_000_000, timelineUs: 10_000_000, durationUs: 3_000_000, description: "หน้าร้านสีชมพูมีป้ายไฟ", kind: "b-roll", visual: "ร้านจากด้านนอก" },
  { label: "s2", videoId: "v2", beatId: "b3", beatName: "หน้าร้าน", startUs: 6_000_000, endUs: 8_500_000, timelineUs: 13_000_000, durationUs: 2_500_000, description: "มือช่างกำลังทาเล็บสีแดง", kind: "product", visual: "ร้านจากด้านนอก" },
]
const beats: EmphasisBeat[] = [
  { id: "b1", name: "เปิดคลิป", purpose: "ดึงคนดูและบอกว่าร้านทำเล็บ" },
  { id: "b3", name: "หน้าร้าน", purpose: "" },
  { id: "b2", name: "ปิดท้าย", purpose: "ชวนทัก" },
]

type Answer = EmphasisReply["points"][number]
const said = (at: number, quote: string, over: Partial<Answer> = {}): Answer => ({ at, scene: "", quote, importance: "key", type: "number", reason: "", ...over })
const pictured = (scene: string, over: Partial<Answer> = {}): Answer => ({ at: null, scene, quote: "", importance: "key", type: "visual", reason: "", ...over })

function ids() {
  let n = 0
  return () => `e${++n}`
}

const accept = (points: Answer[], kept: EmphasisPoint[] = []) => acceptEmphasis({ reply: { points }, sentences, scenes, wordsOf, kept, newId: ids() })

const point = (id: string, anchor: EmphasisPoint["anchor"], over: Partial<EmphasisPoint> = {}): EmphasisPoint => ({ id, anchor, importance: "key", type: "number", reason: "", source: "ai", edited: false, ...over })

test("quotes become the words that say them, scene labels their stretch; points come in playing order with ids in that order", () => {
  const result = accept([
    said(3, "ทักมา", { importance: "secondary", type: "action", reason: "  ชวนทักแชท  " }),
    pictured("s2", { importance: "extra", reason: "ภาพทาเล็บสวย" }),
    said(2, "299 บาท", { reason: "ราคาเริ่มต้น" }),
    said(1, "ร้านทำเล็บ", { type: "hook", reason: "บอกว่าคลิปนี้เรื่องอะไร" }),
    // a second phrase of the same sentence, said before the first one Claude gave
    said(2, "เริ่มต้น", { importance: "secondary" }),
  ])
  expect(result).toEqual({
    dropped: 0,
    points: [
      point("e1", { kind: "speech", videoId: "v1", from: 5, to: 8, beatId: "b1" }, { type: "hook", reason: "บอกว่าคลิปนี้เรื่องอะไร" }),
      point("e2", { kind: "speech", videoId: "v1", from: 9, to: 11, beatId: "b1" }, { importance: "secondary" }),
      point("e3", { kind: "speech", videoId: "v1", from: 11, to: 13, beatId: "b1" }, { reason: "ราคาเริ่มต้น" }),
      point("e4", { kind: "scene", videoId: "v2", startUs: 6_000_000, endUs: 8_500_000, beatId: "b3" }, { importance: "extra", type: "visual", reason: "ภาพทาเล็บสวย" }),
      point("e5", { kind: "speech", videoId: "v1", from: 13, to: 15, beatId: "b2" }, { importance: "secondary", type: "action", reason: "ชวนทักแชท" }),
    ],
  })
})

test("answers that cannot be found or overlap an earlier answer or a kept point are dropped and counted", () => {
  const kept = [
    point("u1", { kind: "scene", videoId: "v2", startUs: 2_000_000, endUs: 3_000_000, beatId: "b3" }, { source: "user" }),
    point("u2", { kind: "speech", videoId: "v1", from: 8, to: 9, beatId: "b1" }, { edited: true }),
  ]
  const result = accept(
    [
      said(9, "ถ้าคุณ"), // no such sentence
      said(0, "ถ้าคุณ"), // numbering starts at 1
      said(1, "ราคา"), // said, but in the next sentence
      said(1, "ไม่ได้พูด"), // not said
      said(1, ""), // nothing quoted
      pictured("s9"), // no such scene
      pictured(""), // neither a sentence nor a scene
      said(1, "ถ้าคุณ"),
      said(1, "คุณกำลัง"), // shares "คุณ" with the answer above
      pictured("s1"), // overlaps the user's point on that scene
      said(2, "ราคา"), // the edited point's words
      pictured(" S2 "), // a label written loosely is still found
    ],
    kept,
  )
  expect(result.points.map((one) => one.anchor)).toEqual([
    { kind: "speech", videoId: "v1", from: 0, to: 2, beatId: "b1" },
    { kind: "scene", videoId: "v2", startUs: 6_000_000, endUs: 8_500_000, beatId: "b3" },
  ])
  expect(result.dropped).toBe(10)
})

test("an answer with a sentence number is a speech point even when it names a scene too; a scene with no real sentence number is a scene point", () => {
  const result = accept([
    said(2, "299 บาท", { scene: "s1" }),
    // the number wins, so a sentence that is not there drops the answer rather than falling back to the scene
    said(9, "ถ้าคุณ", { scene: "s1" }),
    // 0 or less is no sentence: Claude meant the scene
    pictured("s2", { at: 0 }),
    pictured("s1", { at: -1 }),
  ])
  expect(result.points.map((one) => one.anchor)).toEqual([
    { kind: "speech", videoId: "v1", from: 11, to: 13, beatId: "b1" },
    { kind: "scene", videoId: "v2", startUs: 1_000_000, endUs: 4_000_000, beatId: "b3" },
    { kind: "scene", videoId: "v2", startUs: 6_000_000, endUs: 8_500_000, beatId: "b3" },
  ])
  expect(result.dropped).toBe(1)
})

test("a quote may be its whole sentence, even one past the transcript's end, and then claims every word of it", () => {
  expect(accept([said(1, "ถ้าคุณกำลังมองหาร้านทำเล็บ", { type: "hook" }), said(3, "ทักมาได้เลย", { type: "action" })])).toEqual({
    dropped: 0,
    points: [
      point("e1", { kind: "speech", videoId: "v1", from: 0, to: 8, beatId: "b1" }, { type: "hook" }),
      point("e2", { kind: "speech", videoId: "v1", from: 13, to: 17, beatId: "b2" }, { type: "action" }),
    ],
  })
  const anchors = (result: ReturnType<typeof accept>) => ({ dropped: result.dropped, at: result.points.map((one) => one.anchor.kind === "speech" && [one.anchor.from, one.anchor.to]) })
  // the whole sentence takes every word, so a part of it said after is an overlap; the first answer wins either way
  expect(anchors(accept([said(3, "ทักมาได้เลย"), said(3, "ทักมา")]))).toEqual({ dropped: 1, at: [[13, 17]] })
  expect(anchors(accept([said(3, "ทักมา"), said(3, "ทักมาได้เลย")]))).toEqual({ dropped: 1, at: [[13, 15]] })
  // a kept point on one word of the sentence still turns the whole sentence away
  expect(accept([said(2, "ราคาเริ่มต้น 299 บาท")], [point("u2", { kind: "speech", videoId: "v1", from: 8, to: 9, beatId: "b1" }, { edited: true })])).toEqual({ dropped: 1, points: [] })
  // a sentence that runs past the transcript's end is quoted whole by every word it has left
  const longer: HighlightSentence[] = [{ ...sentences[2]!, to: 20 }]
  expect(acceptEmphasis({ reply: { points: [said(1, "ทักมาได้เลย")] }, sentences: longer, scenes: [], wordsOf, kept: [], newId: ids() })).toEqual({
    dropped: 0,
    points: [point("e1", { kind: "speech", videoId: "v1", from: 13, to: 17, beatId: "b2" })],
  })
})

test("draft 0917: the opening question and the countdown, each a sentence of its own, are kept whole", () => {
  const spoken: TimedText[] = ["นักบิน", "อวกาศ", "บิน", "ขึ้น", "ไป", "ใน", "อวกาศ", "ได้", "ยัง", "ไง", "สาม", "สอง", "หนึ่ง"].map((text, i) => ({
    text,
    startUs: i * 300_000,
    endUs: i * 300_000 + 250_000,
  }))
  const rows: HighlightSentence[] = [
    { videoId: "v9", beatId: "open", beatName: "ตั้งคำถามเปิดเรื่อง", from: 0, to: 10, text: "นักบินอวกาศบินขึ้นไปในอวกาศได้ยังไง", timelineUs: 3_100_000 },
    { videoId: "v9", beatId: "count", beatName: "นับถอยหลัง 3-2-1", from: 10, to: 13, text: "สามสองหนึ่ง", timelineUs: 15_500_000 },
  ]
  const result = acceptEmphasis({
    reply: { points: [said(1, "นักบินอวกาศบินขึ้นไปในอวกาศได้ยังไง", { type: "hook" }), said(2, "สามสองหนึ่ง")] },
    sentences: rows,
    scenes: [],
    wordsOf: () => spoken,
    kept: [],
    newId: ids(),
  })
  expect(result.dropped).toBe(0)
  // the first point in playing order is the hook the prompt asks for
  expect(result.points.map((one) => [one.anchor.kind === "speech" && [one.anchor.from, one.anchor.to], one.type])).toEqual([
    [[0, 10], "hook"],
    [[10, 13], "number"],
  ])
})

test("a reason is trimmed and cut to 200 UTF-16 units, never through an emoji", () => {
  expect(accept([said(1, "ถ้าคุณ", { reason: ` ${"ก".repeat(250)} ` })]).points[0]!.reason).toBe("ก".repeat(200))
  // each rocket is two units
  expect(accept([said(1, "ถ้าคุณ", { reason: "🚀".repeat(201) })]).points[0]!.reason).toBe("🚀".repeat(100))
})

test("keptReason trims a reason and cuts it to EMPHASIS_REASON_MAX UTF-16 units by whole characters", () => {
  expect(EMPHASIS_REASON_MAX).toBe(200)
  expect(keptReason("  ชวนทัก  ")).toBe("ชวนทัก")
  expect(keptReason("ก".repeat(200))).toBe("ก".repeat(200))
  // a thumb with a skin tone is four units: it does not fit in the last two, and is not split from its tone
  expect(keptReason(`${"ก".repeat(198)}👍🏽`)).toBe("ก".repeat(198))
  // a family joined by zero-width joiners is eleven units, kept or dropped whole
  expect(keptReason(`${"ก".repeat(189)}👨‍👩‍👧‍👦`)).toBe(`${"ก".repeat(189)}👨‍👩‍👧‍👦`)
  expect(keptReason(`${"ก".repeat(190)}👨‍👩‍👧‍👦`)).toBe("ก".repeat(190))
  // a Thai letter keeps its vowel and tone marks
  expect(keptReason(`${"ก".repeat(199)}ที่`)).toBe("ก".repeat(199))
  // a space the cut leaves at the end goes too, so keeping a kept reason changes nothing
  expect(keptReason(`${"ก".repeat(199)} ข`)).toBe("ก".repeat(199))
})

test("Claude is shown the brief, the beats with their purpose, the numbered sentences and the scenes with their time, length, kind, description and the beat's picture", () => {
  const text = describeEmphasis({ brief: { targetSeconds: 60, videoType: "review", instructions: "เน้นราคา" }, durationUs: 45_000_000, beats, sentences, scenes })
  expect(text).toBe(
    [
      "brief",
      "- ประเภทวิดีโอ: review",
      "- ความยาวที่ต้องการ: 60 วินาที",
      "- คำสั่งเพิ่มเติม: เน้นราคา",
      "",
      "ความยาววิดีโอหลังตัด 0:45",
      "",
      "บีตตามลำดับที่เล่น (ชื่อ: หน้าที่ของบีต)",
      "1. เปิดคลิป: ดึงคนดูและบอกว่าร้านทำเล็บ",
      "2. หน้าร้าน: ไม่ระบุ",
      "3. ปิดท้าย: ชวนทัก",
      "",
      "ประโยค",
      '[1] ช่วง "เปิดคลิป" 0:00.0 ถ้าคุณกำลังมองหาร้านทำเล็บ',
      '[2] ช่วง "เปิดคลิป" 0:02.5 ราคาเริ่มต้น 299 บาท',
      '[3] ช่วง "ปิดท้าย" 0:30.0 ทักมาได้เลย',
      "",
      "ฉากในบีตภาพ",
      '[s1] ช่วง "หน้าร้าน" 0:10.0 ยาว 3.0 วิ ชนิด b-roll: หน้าร้านสีชมพูมีป้ายไฟ · ภาพที่บีตนี้ต้องการ: ร้านจากด้านนอก',
      '[s2] ช่วง "หน้าร้าน" 0:13.0 ยาว 2.5 วิ ชนิด product: มือช่างกำลังทาเล็บสีแดง · ภาพที่บีตนี้ต้องการ: ร้านจากด้านนอก',
    ].join("\n"),
  )
})

test("what is missing is said so: an empty brief, no sentences, no scenes, a beat with no picture asked for", () => {
  const text = describeEmphasis({ brief: { targetSeconds: null, videoType: null, instructions: "  " }, durationUs: 1, beats: [], sentences: [], scenes: [{ ...scenes[0]!, visual: " " }] })
  expect(text).toContain("- ประเภทวิดีโอ: ไม่ระบุ\n- ความยาวที่ต้องการ: ไม่ระบุ\n- คำสั่งเพิ่มเติม: ไม่ระบุ")
  expect(text).toContain("ประโยค\nไม่มีประโยคที่พูด ตอบเฉพาะจุดจากฉาก")
  expect(text).toContain("ภาพที่บีตนี้ต้องการ: ไม่ระบุ")
  expect(describeEmphasis({ brief: { targetSeconds: null, videoType: null, instructions: "" }, durationUs: 1, beats: [], sentences, scenes: [] })).toContain("ฉากในบีตภาพ\nไม่มีฉากในบีตภาพ ตอบเฉพาะจุดจากคำพูด")
})

function fakeTransport(reply: EmphasisReply) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      return { output: reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, requests }
}

const brief = { targetSeconds: 60, videoType: "review" as const, instructions: "" }

test("planEmphasis asks Claude once with the prompt, the schema and the described clip, and accepts the answer around the kept points", async () => {
  const { transport, requests } = fakeTransport({ points: [said(2, "299 บาท"), pictured("s1"), said(2, "เริ่มต้น")] })
  const signal = new AbortController().signal
  const kept = [point("u1", { kind: "speech", videoId: "v1", from: 9, to: 11, beatId: "b1" }, { source: "user" })]
  const args = { transport, model: "claude-opus-5-5", brief, durationUs: 45_000_000, beats, sentences, scenes, wordsOf, kept, newId: ids(), signal }
  const result = await planEmphasis(args)
  expect(result).toEqual({
    dropped: 1,
    points: [point("e1", { kind: "speech", videoId: "v1", from: 11, to: 13, beatId: "b1" }), point("e2", { kind: "scene", videoId: "v2", startUs: 1_000_000, endUs: 4_000_000, beatId: "b3" }, { type: "visual" })],
  })
  expect(requests).toHaveLength(1)
  const request = requests[0]!
  expect(request.model).toBe("claude-opus-5-5")
  expect(request.system).toBe(EMPHASIS_PROMPT.system)
  expect(request.schema).toBe(EmphasisReplySchema)
  expect(request.maxTokens).toBe(16_000)
  expect(request.signal).toBe(signal)
  expect(request.content).toEqual([{ type: "text", text: describeEmphasis(args) }])
})

test("a prompt passed in replaces the built-in one", async () => {
  const { transport, requests } = fakeTransport({ points: [] })
  await planEmphasis({ transport, model: "m", brief, durationUs: 1, beats, sentences, scenes, wordsOf, kept: [], newId: ids(), prompt: { system: "ลองดู", version: "test" } })
  expect(requests[0]!.system).toBe("ลองดู")
})

test("no sentence and no scene means no request; scenes alone are enough to ask", async () => {
  const { transport, requests } = fakeTransport({ points: [pictured("s2")] })
  const args = { transport, model: "m", brief, durationUs: 1, beats, wordsOf, kept: [], newId: ids() }
  expect(await planEmphasis({ ...args, sentences: [], scenes: [] })).toEqual({ points: [], dropped: 0 })
  expect(requests).toHaveLength(0)
  expect((await planEmphasis({ ...args, sentences: [], scenes })).points).toHaveLength(1)
  expect(requests).toHaveLength(1)
})

test("the reply schema takes whole sentence numbers or null, the known importances and types, and fills what Claude leaves out", () => {
  const base = { at: 1, scene: "", quote: "ถ้าคุณ", importance: "key", type: "hook", reason: "" }
  expect(EmphasisReplySchema.safeParse({ points: [base] }).success).toBe(true)
  expect(EmphasisReplySchema.safeParse({ points: [{ ...base, at: null }] }).success).toBe(true)
  expect(EmphasisReplySchema.safeParse({ points: [{ ...base, at: 1.5 }] }).success).toBe(false)
  expect(EmphasisReplySchema.safeParse({ points: [{ ...base, importance: "main" }] }).success).toBe(false)
  expect(EmphasisReplySchema.safeParse({ points: [{ ...base, type: "price" }] }).success).toBe(false)
  expect(EmphasisReplySchema.parse({ points: [{ at: null, importance: "extra", type: "visual" }] })).toEqual({ points: [{ at: null, scene: "", quote: "", importance: "extra", type: "visual", reason: "" }] })
  // what the transports send Claude as the reply format: `at` must be answered, a whole number or null
  const sent = replySchema(EmphasisReplySchema) as { properties: { points: { items: { properties: { at: { anyOf: { type: string }[] } }; required: string[] } } } }
  const answer = sent.properties.points.items
  expect(answer.properties.at.anyOf.map((one) => one.type)).toEqual(["integer", "null"])
  expect(answer.required).toContain("at")
})

test("the prompt carries its version and the rules the spec sets", () => {
  expect(EMPHASIS_PROMPT_VERSION).toBe("emphasis-2026-09-27")
  expect(EMPHASIS_PROMPT.version).toBe(EMPHASIS_PROMPT_VERSION)
  for (const rule of [
    "จุดแรกของคลิปเป็น hook",
    "key = สิ่งที่คนดูต้องจำได้",
    "secondary = สิ่งที่ช่วยให้เข้าใจเรื่อง",
    "extra = สิ่งที่ใส่เพิ่มได้ถ้าคลิปจัดเต็ม",
    "ครับ ค่ะ",
    "สั้นกว่าทั้งประโยค",
    "ประโยคหนึ่งมีได้หลายจุดถ้าวลีไม่ทับกัน",
    "สองจุดในประโยคเดียวกันห้ามใช้คำตรงตำแหน่งเดียวกัน",
    "คำเดียวกันที่พูดคนละที่ใช้ได้",
    "แม้คำนั้นถอดเสียงผิดก็ห้ามแก้",
    'ช่วง "…" บอกว่าประโยคหรือฉากนั้นอยู่ในบีตไหน',
    'scene = เลขฉาก เช่น "s3"',
  ])
    expect(EMPHASIS_PROMPT.system).toContain(rule)
  // the lines Claude reads say ช่วง "…", so the prompt calls it that too
  expect(EMPHASIS_PROMPT.system).not.toContain("ชื่อบีต")
})
