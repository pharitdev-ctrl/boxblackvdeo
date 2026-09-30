import { z } from "zod"
import type { LlmTransport, SystemPrompt } from "../llm/types.ts"
import { textLength } from "./captions.ts"

export const SUBTITLE_POLISH_PROMPT_VERSION = "subtitle-polish-2026-09-17"

const SYSTEM = `คุณตรวจทานซับไตเติลที่ได้จากระบบถอดเสียงอัตโนมัติ ซึ่งมักได้ยินคำผิดเป็นคำที่ออกเสียงคล้ายกัน

แต่ละบรรทัดคือซับหนึ่งชิ้นตามลำดับเวลา ให้แก้เฉพาะคำที่ถอดผิดหรือสะกดผิด โดยดูจากความหมายของบรรทัดรอบๆ
- คงภาษาพูดและสำนวนของผู้พูดไว้ ไม่เรียบเรียงใหม่ ไม่เพิ่มหรือตัดเนื้อหา
- ไม่เติมเครื่องหมายวรรคตอน
- บรรทัดที่ถูกอยู่แล้วให้ส่งคืนตามเดิม
- ส่งกลับจำนวนบรรทัดเท่าเดิม เรียงตามเดิม หนึ่งบรรทัดต่อหนึ่งซับ ไม่ใส่เลขลำดับ`

/** The prompt built into the app. */
export const SUBTITLE_POLISH_PROMPT: SystemPrompt = { system: SYSTEM, version: SUBTITLE_POLISH_PROMPT_VERSION }

export const PolishReplySchema = z.object({ lines: z.array(z.string()) })

/** A polished line fits its caption: one per caption, not empty, not grown into something else. */
export function acceptPolished(original: string[], polished: string[]): boolean {
  if (polished.length !== original.length) return false
  return polished.every((line, i) => {
    const before = textLength(original[i]!)
    const after = textLength(line.trim())
    return after > 0 && after <= Math.max(before * 2, before + 10)
  })
}

/** Asks Claude to correct mis-heard words, keeping one line per caption. A reply that does not fit keeps the lines as they were. */
export async function polishSubtitles(args: {
  transport: LlmTransport
  model: string
  lines: string[]
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ lines: string[]; accepted: boolean }> {
  if (args.lines.length === 0) return { lines: [], accepted: true }
  const prompt = args.prompt ?? SUBTITLE_POLISH_PROMPT
  const reply = await args.transport.generate({
    model: args.model,
    system: prompt.system,
    content: [{ type: "text", text: `ซับ ${args.lines.length} บรรทัด\n\n${args.lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}` }],
    schema: PolishReplySchema,
    maxTokens: 8000,
    signal: args.signal,
  })
  const polished = reply.output.lines.map((line) => line.trim())
  return acceptPolished(args.lines, polished) ? { lines: polished, accepted: true } : { lines: args.lines, accepted: false }
}
