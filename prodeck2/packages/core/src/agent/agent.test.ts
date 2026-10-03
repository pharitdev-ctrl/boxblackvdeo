import { expect, test } from "vitest"
import { replySchema } from "../llm/schema.ts"
import { actionLabel, AgentReplySchema, parseAction, secondsToUs, type RawAction } from "./actions.ts"
import { agentRequest, describeFootage, historyText, type AgentFootage, type AgentTurn } from "./context.ts"
import { AGENT_PROMPT } from "./prompt.ts"

const raw = (fields: Partial<RawAction> & Pick<RawAction, "type">): RawAction =>
  AgentReplySchema.parse({ actions: [fields], done: false }).actions[0]!

test("a reply needs only the fields each action uses; the rest come back null", () => {
  const reply = AgentReplySchema.parse({ say: "ใส่ป้ายราคา", done: false, actions: [{ type: "add_graphic", atS: 20.7, seconds: 1.3, box: [0.2, 0.05, 0.8, 0.3], idea: "ป้าย 5 บาท" }] })
  expect(reply.actions[0]).toMatchObject({ type: "add_graphic", atS: 20.7, text: null, poses: null })
  // the reply format the transports send has no union of objects and no length bounds; the only bounds are the
  // safe-integer ones zod gives every int, as the other works' formats have
  const schema = JSON.stringify(replySchema(AgentReplySchema))
  expect(schema).not.toMatch(/"anyOf":\[\{"type":"object"|"minItems"|"maxItems"|"minLength"|"maxLength"/)
})

test("each action is checked for what its type needs, in Thai", () => {
  expect(parseAction(raw({ type: "add_text", fromWord: 3, toWord: 5, lines: [" หวาน ", ""] }))).toEqual({ ok: true, action: { type: "add_text", fromWord: 3, toWord: 5, lines: ["หวาน"], tone: null } })
  expect(parseAction(raw({ type: "add_text", fromWord: 5, toWord: 3, lines: ["ก"] }))).toEqual({ ok: false, problem: "toWord ต้องไม่น้อยกว่า fromWord" })
  expect(parseAction(raw({ type: "add_text", fromWord: 1, toWord: 2, lines: ["1", "2", "3", "4"] })).ok).toBe(false)
  expect(parseAction(raw({ type: "add_move", atS: 2, poses: [{ s: 0, scale: 1, x: 0, y: 0, rot: 0, ease: "line" }, { s: 0.4, scale: 1.15, x: 0, y: 0, rot: 0, ease: "out" }], about: "ดันเข้า" }))).toMatchObject({ ok: true, action: { at: { s: 2 } } })
  expect(parseAction(raw({ type: "add_move", atWord: 4, poses: [{ s: 0.5, scale: 1.1, x: 0, y: 0, rot: 0, ease: "line" }, { s: 0.2, scale: 1, x: 0, y: 0, rot: 0, ease: "line" }] })).ok).toBe(false)
  expect(parseAction(raw({ type: "add_graphic", atS: 1, seconds: 12, box: [0, 0, 1, 1], idea: "x" }))).toEqual({ ok: false, problem: "กราฟิกยาวได้ 0.3–8 วินาที" })
  expect(parseAction(raw({ type: "add_graphic", atS: 1, seconds: 2, box: [0.8, 0, 0.2, 1], idea: "x" })).ok).toBe(false)
  expect(parseAction(raw({ type: "add_sound", atS: 3 }))).toMatchObject({ ok: false })
  expect(parseAction(raw({ type: "add_sound", atS: 3, pick: "ติ๊ง" }))).toEqual({ ok: true, action: { type: "add_sound", atS: 3, seconds: 1, pick: "ติ๊ง", role: null, loudness: "normal" } })
  expect(parseAction(raw({ type: "edit_piece", id: "graphic-2", idea: "ใหญ่ขึ้น" }))).toEqual({ ok: true, action: { type: "edit_piece", id: "graphic-2", changes: { idea: "ใหญ่ขึ้น" } } })
  expect(parseAction(raw({ type: "edit_piece", id: "graphic-2" })).ok).toBe(false)
  expect(parseAction(raw({ type: "ask_user", text: "เอาสีชมพูไหม" }))).toEqual({ ok: true, action: { type: "ask_user", question: "เอาสีชมพูไหม" } })
  expect(secondsToUs(20.7004)).toBe(20_700_000)
  expect(actionLabel(raw({ type: "remove_piece", id: "sound-3" }))).toBe("remove_piece id=sound-3")
})

const footage: AgentFootage = {
  title: "รีวิวช็อกโกแลต",
  summary: "ชิมแล้วบอกรส",
  beats: [{ name: "เปิด", purpose: "ทักทาย", startUs: 0 }],
  words: [
    { text: "สวัสดี", atUs: 270_000 },
    { text: "ครับ", atUs: 700_000 },
  ],
  scenes: [
    {
      startUs: 0,
      endUs: 2_500_000,
      kind: "talking",
      description: "ผู้หญิงถือช็อกโกแลตยิ้มให้กล้อง",
      keepClear: { fromY: 0.18, toY: 0.55 },
      objects: [
        { kind: "keep", face: true, what: "หน้าผู้พูด", box: { x0: 0.3, y0: 0.18, x1: 0.7, y1: 0.45 }, still: false },
        { kind: "keep", face: false, what: "ช็อกโกแลต", box: { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.62 }, still: false },
      ],
    },
  ],
  sounds: ["ติ๊ง", "วูบ"],
  brief: { videoType: "review", instructions: "" },
}

test("the footage numbers every word with its time, and lists the beats and the sounds", () => {
  const text = describeFootage(footage)
  expect(text).toContain("w1@0.27 สวัสดี · w2@0.70 ครับ")
  expect(text).toContain("1. 0.00s เปิด: ทักทาย")
  expect(text).toContain("ติ๊ง · วูบ")
  expect(text).toContain("คำสั่งเพิ่มเติมของผู้ใช้: ไม่มี")
  expect(text).toContain("- 0.00s–2.50s talking · ผู้หญิงถือช็อกโกแลตยิ้มให้กล้อง · keepClear [0.18, 0.55]")
  expect(text).toContain("keep หน้า “หน้าผู้พูด” [0.3, 0.18, 0.7, 0.45]")
  expect(describeFootage({ ...footage, scenes: [] })).toContain("ฉาก ไม่มี")
})

test("the request keeps the footage first and cached, and the timeline and the ask last", () => {
  const content = agentRequest({ footage, turns: [{ role: "user", text: "ใส่ป้ายราคา" }], timeline: "Pieces:\n- cut-1", ask: "เริ่ม" })
  expect(content.map((part) => part.type === "text" && part.cache === true)).toEqual([true, false, false, false])
  expect(content.at(-2)).toMatchObject({ text: "ไทม์ไลน์ตอนนี้\nPieces:\n- cut-1" })
  expect(content.at(-1)).toMatchObject({ text: "เริ่ม" })
})

test("a long conversation keeps its newest turns and says how many older ones were left out", () => {
  const turns: AgentTurn[] = Array.from({ length: 40 }, (_, i) => ({ role: "user", text: `ข้อความที่ ${i + 1} ${"ก".repeat(500)}` }))
  const text = historyText(turns, 5_000)
  expect(text).toContain("ข้อความที่ 40")
  expect(text).not.toContain("ข้อความที่ 1 ")
  expect(text).toMatch(/^\(ข้อความก่อนหน้านี้อีก \d+ รายการไม่ได้แสดง\)/)
  expect(text.length).toBeLessThan(6_000)
})

test("the prompt names every action and the rules that matter", () => {
  for (const type of ["set_direction", "add_text", "add_move", "add_graphic", "add_sound", "edit_piece", "remove_piece", "ask_user"]) expect(AGENT_PROMPT.system).toContain(`- ${type}:`)
  expect(AGENT_PROMPT.system).toContain("ห้ามแก้หรือลบชิ้นที่ล็อก")
  expect(AGENT_PROMPT.system).toContain("ถ้าขัดกับสิ่งที่ผู้ใช้พิมพ์ ทำตามผู้ใช้")
})
