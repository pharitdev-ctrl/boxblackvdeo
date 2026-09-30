import type { LlmContent, LlmTransport, LlmUsage, SystemPrompt } from "../llm/types.ts"
import type { Brief, VideoType } from "./brief.ts"
import { describeFootage, type FootageClip } from "./footage.ts"
import { outlineAsText, OutlineReplySchema, resolveOutline, type Outline } from "./outline.ts"

export const PLANNER_PROMPT_VERSION = "planner-2026-09-17-retakes"

const TYPE_NAMES: Record<VideoType, string> = {
  review: "รีวิว",
  sales: "ขายของ",
  tutorial: "สอนหรืออธิบาย",
  vlog: "vlog",
  travel: "ท่องเที่ยว",
  other: "อื่นๆ",
}

const SYSTEM = `คุณเป็นบรรณาธิการวิดีโอ วางโครงเรื่องสำหรับตัดต่อจากฟุตเทจที่ได้รับ

โครงเรื่องคือรายการช่วง (beats) เรียงตามลำดับที่จะเล่นในวิดีโอ แต่ละช่วงใช้ส่วนที่ต่อเนื่องกันจากคลิปเดียว
- clip คือรหัสคลิป เช่น v1
- from และ to คือคำพูดแรกและคำพูดสุดท้ายที่ใช้ เช่น u1 ถึง u3 หรือฉากแรกและฉากสุดท้าย เช่น s1 ถึง s2 ช่วงเดียวกันต้องเป็นคำพูดทั้งคู่หรือฉากทั้งคู่
- ใช้คำพูดเมื่อคลิปมีคนพูด ใช้ฉากกับภาพประกอบหรือคลิปที่ไม่มีเสียงพูด

เปิดด้วยช่วงที่ดึงความสนใจได้ดีที่สุด เล่าให้คนดูตามทัน และปิดให้มีน้ำหนัก
เมื่อมีการพูดซ้ำหรือพูดผิดแล้วพูดใหม่ (เช่นมีคำว่า "เอ้ย") ให้ใช้เทคที่รายการเทคซ้ำบอกว่าควรใช้ ถ้าไม่มีในรายการหรือพอๆ กัน ให้ใช้เทคหลัง
- ถ้าใช้เทคหลัง ช่วงนั้นครอบเทคก่อนไว้ด้วยได้ โปรแกรมจะตัดเทคก่อนออกเอง
- ถ้าใช้เทคก่อน ช่วงนั้นต้องจบก่อนเทคหลังเริ่ม
เลี่ยงช่วงที่มีปัญหาภาพเว้นแต่จำเป็นต่อเรื่อง ท่าทางที่ไปกับคำพูด เช่น ชูนิ้วนับ ชี้ หรือยื่นของให้ดู ไม่ใช่ปัญหาภาพ
ถ้ามีความยาวเป้าหมาย ให้ความยาวรวมใกล้เป้าหมาย

name คือชื่อสั้นของช่วง purpose คือหน้าที่ของช่วงนั้นในเรื่อง title คือชื่อเรื่องสั้นๆ summary คือเรื่องย่อหนึ่งถึงสองประโยค omitted คือสิ่งสำคัญที่ตัดออกและเหตุผลสั้นๆ
เขียนทุกอย่างเป็นภาษาไทย`

/** The prompt built into the app; the license server may hand out another. */
export const PLANNER_PROMPT: SystemPrompt = { system: SYSTEM, version: PLANNER_PROMPT_VERSION }

function briefText(brief: Brief): string {
  return [
    "โจทย์",
    `ความยาวเป้าหมาย: ${brief.targetSeconds ? `ประมาณ ${brief.targetSeconds} วินาที` : "ไม่กำหนด เลือกความยาวที่เหมาะกับเนื้อหา"}`,
    `ประเภทคลิป: ${brief.videoType ? TYPE_NAMES[brief.videoType] : "ไม่ระบุ"}`,
    `คำสั่งเพิ่มเติม: ${brief.instructions.trim() || "ไม่มี"}`,
  ].join("\n")
}

/**
 * Asks Claude for an outline and resolves its references into real source times.
 * With `previous` only, it asks for a clearly different take; with `previous` and an
 * `instruction`, it revises the current outline (which may carry the user's own edits).
 */
export async function planOutline(args: {
  transport: LlmTransport
  model: string
  clips: FootageClip[]
  brief: Brief
  previous?: Outline
  instruction?: string
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ outline: Outline; usage: LlmUsage; promptVersion: string }> {
  const prompt = args.prompt ?? PLANNER_PROMPT
  const { text: footage, index } = describeFootage(args.clips)

  const content: LlmContent[] = [
    // identical across revisions of the same project, so it is cached
    { type: "text", text: `ฟุตเทจ\n\n${footage}`, cache: true },
    { type: "text", text: briefText(args.brief) },
  ]
  if (args.previous && args.instruction?.trim()) {
    content.push({
      type: "text",
      text: `โครงเรื่องฉบับปัจจุบัน (ผู้ใช้อาจสลับลำดับหรือลบช่วงเองมาแล้ว)\n${outlineAsText(args.previous, index)}\n\nคำสั่งแก้จากผู้ใช้: ${args.instruction.trim()}\nแก้ตามคำสั่ง ส่วนที่คำสั่งไม่ได้พูดถึงให้คงไว้`,
    })
  } else if (args.previous) {
    content.push({
      type: "text",
      text: `โครงเรื่องฉบับก่อน\n${outlineAsText(args.previous, index)}\n\nเสนอโครงเรื่องแบบใหม่ที่ต่างจากฉบับก่อนอย่างชัดเจน`,
    })
  } else {
    content.push({ type: "text", text: "วางโครงเรื่อง" })
  }

  const reply = await args.transport.generate({
    model: args.model,
    system: prompt.system,
    content,
    schema: OutlineReplySchema,
    maxTokens: 16000,
    signal: args.signal,
  })
  return { outline: resolveOutline(reply.output, index), usage: reply.usage, promptVersion: prompt.version }
}
