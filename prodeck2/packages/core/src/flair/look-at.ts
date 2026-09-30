import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { LlmContent, LlmTransport, SystemPrompt } from "../llm/types.ts"

// bumped on 2026-09-23 without a change to the prompt: the frames shown until then could be another
// picture's, so the descriptions cached under the old version are not to be trusted
export const MEDIA_PROMPT_VERSION = "media-2026-09-23-own-frames"

const SYSTEM = `คุณดูรูปที่ผู้ใช้เอาไว้ใช้ประกอบวิดีโอ แล้วบอกว่าแต่ละรูปคืออะไร เพื่อให้เลือกไปแทรกในวิดีโอได้ถูกจังหวะและวางได้สวย

ตอบรูปละหนึ่งรายการ
- what: หนึ่งถึงสองประโยคว่าเห็นอะไร สีและลายของมัน อยู่บนอะไรหรือที่ไหน และคำที่คนพูดในคลิปน่าจะใช้เรียกสิ่งนี้ · บรรยายเฉพาะสิ่งที่เห็นจริง รูปที่ดูไม่ออกว่าเป็นอะไรให้ตอบว่า "ไม่ชัด"
- subject: กรอบของตัวของหรือตัวแบบในรูป ตอบเป็น [ซ้าย, บน, ขวา, ล่าง] เป็นสัดส่วนของความกว้างและความสูง เช่น [0.15, 0.3, 0.85, 0.95] · ถ้าของกินเต็มเฟรมอยู่แล้วหรือชี้ไม่ได้ให้ตอบ []
- fit: cover = ขึ้นเต็มจอ ใช้เมื่อของกินเฟรมเกือบหมดหรือรายละเอียดคือประเด็น เช่น โคลสอัปสินค้า ภาพหน้าจอที่ต้องอ่าน · card = ขึ้นเป็นการ์ดไม่เต็มจอ ใช้เมื่อมีที่ว่างรอบตัวของมาก เป็นภาพกว้าง หรือควรเห็นคนพูดไปด้วย
- คลิปที่ให้มาหลายเฟรมคือคลิปเดียวกันคนละช่วงเวลา ให้ตอบรวมเป็นรายการเดียว
เขียนทุกอย่างเป็นภาษาไทย`

export const MEDIA_PROMPT: SystemPrompt = { system: SYSTEM, version: MEDIA_PROMPT_VERSION }

/** How an inserted picture is framed: over the whole screen, or as a card the speaker stays visible beside. */
export const MEDIA_FITS = ["cover", "card"] as const
export type MediaFit = (typeof MEDIA_FITS)[number]

export const MediaReplySchema = z.object({
  pictures: z.array(
    z.object({
      picture: z.number().int(),
      what: z.string(),
      /** [x0, y0, x1, y1] as shares of the picture; empty when the subject fills it or cannot be told */
      subject: z.array(z.number()).default([]),
      fit: z.enum(MEDIA_FITS).default("card"),
    }),
  ),
})
export type MediaReply = z.infer<typeof MediaReplySchema>

/** Where the subject sits inside its picture, as shares of the width and height. */
export interface SubjectBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** What Claude saw in one picture. */
export interface MediaLook {
  what: string
  subject: SubjectBox | null
  fit: MediaFit
}

/** One picture to look at: the bin item it belongs to, and one frame of it — three for a clip. */
export interface MediaFrame {
  binId: string
  paths: string[]
}

/** Only a box the model gave as four shares inside the picture, left before right and top before bottom, is usable. */
function subjectOf(answer: number[]): SubjectBox | null {
  if (answer.length !== 4) return null
  const [x0, y0, x1, y1] = answer as [number, number, number, number]
  // comparisons with NaN are false, so a number the model could not give is left out too
  const inside = x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1
  return inside && x0 < x1 && y0 < y1 ? { x0, y0, x1, y1 } : null
}

/** Turns Claude's answer into a look per bin id, dropping anything that is not on the list. */
export function acceptMedia(reply: MediaReply, frames: MediaFrame[]): Record<string, MediaLook> {
  const said: Record<string, MediaLook> = {}
  for (const answer of reply.pictures ?? []) {
    const frame = frames[answer.picture - 1]
    const what = answer.what.trim()
    if (!frame || !what || said[frame.binId]) continue
    said[frame.binId] = {
      what,
      subject: subjectOf(answer.subject ?? []),
      // a transport that skipped the schema's defaults hands over no fit at all
      fit: MEDIA_FITS.includes(answer.fit) ? answer.fit : "card",
    }
  }
  return said
}

/** Asks Claude what each picture is and how to frame it, in one call. Pictures it says nothing about are left out. */
export async function describeMedia(args: {
  transport: LlmTransport
  model: string
  frames: MediaFrame[]
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<Record<string, MediaLook>> {
  if (args.frames.length === 0) return {}
  const content: LlmContent[] = []
  for (const [index, frame] of args.frames.entries()) {
    const many = frame.paths.length > 1 ? ` (คลิป ${frame.paths.length} เฟรม)` : ""
    content.push({ type: "text", text: `รูปที่ ${index + 1}${many}` })
    for (const path of frame.paths) content.push({ type: "image", data: (await readFile(path)).toString("base64"), mediaType: "image/jpeg" })
  }
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? MEDIA_PROMPT).system,
    content,
    schema: MediaReplySchema,
    // thinking counts toward the limit, and at a higher effort there is more of it
    maxTokens: 16_000,
    signal: args.signal,
  })
  return acceptMedia(reply.output, args.frames)
}
