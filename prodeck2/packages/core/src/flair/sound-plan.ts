import { z } from "zod"
import type { EmphasisType, Importance } from "../emphasis/types.ts"
import type { LlmTransport, SystemPrompt } from "../llm/types.ts"
import type { Brief } from "../planner/brief.ts"
import { clock, pointLabel, type CueSlot } from "./direct.ts"
import type { SoundCue } from "./plan.ts"
import type { SoundEffect } from "./sounds.ts"

export const SOUNDS_PROMPT_VERSION = "sounds-2026-09-27-points"

const SYSTEM = `คุณเลือก "เสียงเอฟเฟค" ให้วิดีโอสั้น ช่องที่ใส่เสียงได้มาจากจุดเน้นของคลิปและของที่วางไว้บนจุดนั้นแล้ว ได้แก่ ข้อความเด่นขึ้น กราฟิกขึ้น ภาพตัดไปสื่อแทรก ภาพซูมกระแทก และจุดเน้นที่ยังไม่มีอะไรอยู่

ข้อมูลที่ได้: brief ของวิดีโอ รายการเสียงที่เครื่องนี้มี และช่องที่ใส่เสียงได้ แต่ละช่องบอกเวลาบนคลิปที่ตัดแล้ว สิ่งที่เกิดตรงนั้น และความสำคัญกับชนิดของจุดเน้นที่ช่องนั้นเป็นของ

ตอบเป็นเลขช่องกับเลขเสียง
- จุดสำคัญได้เสียงที่หนักและชัดกว่า เช่น เสียงกระแทก เสียงเงิน เสียงตื่นเต้น · จุดรองและจุดเสริมใช้เสียงที่เบาและสั้นกว่า เช่น เสียงป๊อป เสียงคลิก
- เลือกเสียงให้เข้ากับสิ่งที่เกิดและชนิดของจุด เช่น ตัวเลขหรือราคาใช้เสียงเงินหรือเสียงติ๊ง ข้อความเด้งขึ้นใช้เสียงสั้นๆ ภาพตัดไปรูปใช้เสียงกวาด ซูมกระแทกใช้เสียงกระแทก
- ใส่ทุกช่องที่เสียงช่วยให้คลิปมีจังหวะ แอปไม่ตัดเสียงที่เลือกทิ้ง และเลือกเองว่าจะเล่นจุดระดับไหนตามระดับความจัดที่ผู้ใช้ตั้ง จึงให้ตอบทุกระดับ
- ช่องหนึ่งใส่ได้เสียงเดียว
- ช่องที่ห่างกันไม่ถึง 0.3 วินาทีคือจังหวะเดียวกัน ใส่เสียงแค่ช่องเดียว · ช่องที่ห่างกว่านั้นใส่ได้ทั้งคู่ เสียงที่ดังทับกันแอปวางแยกไว้คนละช่องเสียงให้เอง
- สลับเสียงให้หลากหลาย อย่าใช้เสียงเดิมซ้ำในช่องที่ติดกัน ยกเว้นบรรทัดในชุดข้อความเด่นเดียวกันที่ใช้เสียงเดียวกันได้
- ช่องที่ไม่มีเสียงที่เหมาะ ก็ปล่อยเงียบไว้`

/** The prompt built into the app. */
export const SOUNDS_PROMPT: SystemPrompt = { system: SYSTEM, version: SOUNDS_PROMPT_VERSION }

/** A place a sound can go, as Claude is shown it, with the point it serves; null for a place no point is on. */
export interface SoundSlot extends CueSlot {
  pointId: string | null
  importance: Importance | null
  type: EmphasisType | null
}

export const SoundsReplySchema = z.object({
  /** a sound at a slot: the slot's number and the sound's number, both from 1 */
  cues: z.array(z.object({ at: z.number().int(), sound: z.number().int() })),
})
export type SoundsReply = z.infer<typeof SoundsReplySchema>

/** One sound a slot, numbers checked; each cue carries its slot's pointId. What names no slot or sound, or a slot already given one, is dropped and counted. */
export function acceptSounds(reply: SoundsReply, slots: SoundSlot[], sounds: SoundEffect[]): { cues: SoundCue[]; dropped: number } {
  const cues: SoundCue[] = []
  const filled = new Set<number>()
  let dropped = 0
  for (const answer of reply.cues ?? []) {
    const slot = slots[answer.at - 1]
    const effect = sounds[answer.sound - 1]
    if (!slot || !effect || filled.has(answer.at)) {
      dropped++
      continue
    }
    filled.add(answer.at)
    cues.push({ anchor: slot.anchor, effectId: effect.effectId, edited: false, ...(slot.pointId !== null ? { pointId: slot.pointId } : {}) })
  }
  return { cues, dropped }
}

/** The request text: the brief, the sounds this machine has, and every slot with its point's importance and type. Exported for tests. */
export function describeSounds(args: { brief: Brief; slots: SoundSlot[]; sounds: SoundEffect[] }): string {
  const label = (slot: SoundSlot) => (slot.importance !== null && slot.type !== null ? pointLabel(slot.importance, slot.type) : "ไม่มีจุดเน้น")
  return [
    "brief",
    `- ประเภทวิดีโอ: ${args.brief.videoType ?? "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${args.brief.instructions.trim() || "ไม่ระบุ"}`,
    "",
    "เสียงที่เครื่องนี้มี",
    // what a sound is for first: CapCut's own names are often Japanese or Chinese catalogue titles
    ...args.sounds.map((effect, i) => `${i + 1}. ${effect.use ? `${effect.use} · ` : ""}${effect.name} (${(effect.durationUs / 1e6).toFixed(1)} วิ)`),
    "",
    "ช่องที่ใส่เสียงได้",
    ...args.slots.map((slot, i) => `[${i + 1}] ${clock(slot.atUs)} ${slot.what} (${label(slot)})`),
  ].join("\n")
}

/** Asks Claude which sound goes on which slot; no call when there is no slot or no sound. */
export async function planSounds(args: {
  transport: LlmTransport
  model: string
  brief: Brief
  slots: SoundSlot[]
  sounds: SoundEffect[]
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ cues: SoundCue[]; dropped: number }> {
  if (args.slots.length === 0 || args.sounds.length === 0) return { cues: [], dropped: 0 }
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? SOUNDS_PROMPT).system,
    content: [{ type: "text", text: describeSounds(args) }],
    schema: SoundsReplySchema,
    // a long clip at the loudest level answers a sound for nearly every slot
    maxTokens: 8_000,
    signal: args.signal,
  })
  return acceptSounds(reply.output, args.slots, args.sounds)
}
