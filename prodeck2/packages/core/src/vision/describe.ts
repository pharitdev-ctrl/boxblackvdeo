import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { TimedText } from "../asr/types.ts"
import type { LlmContent, LlmTransport, LlmUsage, SystemPrompt } from "../llm/types.ts"
import type { FrameImage } from "./frames.ts"
import type { RetakeReview } from "./retakes.ts"
import type { TimeRangeUs, VideoSignals } from "./signals.ts"

/** Part of the cache key: changing the prompt or schema must invalidate stored insights. */
export const PROMPT_VERSION = "vision-2026-09-18-keepclear"

const SCENE_KINDS = ["talking-head", "b-roll", "product", "screen", "text", "other"] as const

export const FrameBatchReplySchema = z.object({
  summary: z.string(),
  scenes: z.array(
    z.object({
      startSec: z.number(),
      endSec: z.number(),
      description: z.string(),
      kind: z.enum(SCENE_KINDS),
      issues: z.array(z.string()),
      keepClear: z.array(z.number()),
    }),
  ),
})

export type FrameBatchReply = z.infer<typeof FrameBatchReplySchema>

export interface Scene {
  startUs: number
  endUs: number
  description: string
  kind: (typeof SCENE_KINDS)[number]
  issues: string[]
  /** the band of the frame that must not be covered, as a share of the height from the top; null when nothing must */
  keepClear: { fromY: number; toY: number } | null
}

/** Only a band the model gave as two shares, top before bottom, is usable. */
function keepClearOf(answer: number[]): Scene["keepClear"] {
  if (answer.length !== 2) return null
  // comparisons with NaN are false, so a number the model could not give is left out too
  const [fromY, toY] = answer as [number, number]
  return fromY >= 0 && fromY < toY && toY <= 1 ? { fromY, toY } : null
}

export interface VideoInsight {
  model: string
  promptVersion: string
  frameCount: number
  signals: VideoSignals
  summary: string
  scenes: Scene[]
  /** lines the speaker said twice, with Claude's comparison of the takes */
  retakes: RetakeReview[]
  usage: LlmUsage
  /** the speech the pictures were described with (`speechKey`); absent on insights saved before it was recorded */
  speech?: string
}

const SYSTEM = `คุณช่วยโปรแกรมตัดต่อวิดีโอดูภาพจากวิดีโอหนึ่งไฟล์ ภาพที่ได้รับคือเฟรมที่ดึงมาตามเวลาที่เขียนไว้ก่อนแต่ละภาพ

แบ่งวิดีโอเป็นฉากตามสิ่งที่เห็น (ฉากใหม่เริ่มเมื่อสิ่งที่อยู่ในภาพ มุมกล้อง หรือสถานที่เปลี่ยน) แล้วบรรยายแต่ละฉากสั้นๆ ให้คนตัดต่อตัดสินใจได้ว่าจะใช้ช่วงไหน
- startSec และ endSec คือเวลาของเฟรมแรกและเฟรมสุดท้ายของฉาก
- kind: talking-head คนพูดกับกล้อง · b-roll ภาพประกอบ · product โชว์สินค้า · screen หน้าจออุปกรณ์ · text ภาพที่ตัวหนังสือเป็นหลัก · other อย่างอื่น
- keepClear: ส่วนของภาพที่ห้ามมีตัวหนังสือไปทับ ได้แก่ ใบหน้าคน ของหรือสินค้าที่กำลังโชว์ และตัวหนังสือที่อยู่ในภาพอยู่แล้ว (ไม่นับลำตัว มือ ฉากหลัง ข้าวของทั่วไป) · ตอบเป็น [ขอบบน, ขอบล่าง] เป็นสัดส่วนความสูงของเฟรมนับจากขอบบน เช่น [0.12, 0.48] · ให้ครอบคลุมทุกเฟรมของฉากนั้น ถ้าคนขยับให้กินช่วงกว้างพอ · ถ้าไม่มีอะไรที่ห้ามบังให้ตอบ []
- issues: สิ่งที่ทำให้ช่วงนั้นไม่ควรใช้ เช่น เบลอ มืด กล้องสั่น มีสิ่งบังเลนส์ คนหลุดเฟรม ถ้าไม่มีให้เป็นรายการว่าง · ท่าทางที่เป็นส่วนหนึ่งของการพูด (ชูนิ้วนับ ชี้ โบกมือ ยื่นของเข้าหากล้อง) ไม่ใช่ปัญหา แม้จะบังหน้าหรือเบลอจากการขยับ ให้บรรยายไว้ใน description แทน
- summary: หนึ่งถึงสองประโยคว่าช่วงนี้ของวิดีโอเกี่ยวกับอะไร
เขียนทุกอย่างเป็นภาษาไทย บรรยายเฉพาะสิ่งที่เห็นในภาพหรือยืนยันได้จากข้อมูลประกอบ`

/** The prompt built into the app; the license server may hand out another. */
export const VISION_PROMPT: SystemPrompt = { system: SYSTEM, version: PROMPT_VERSION }

const sec = (us: number) => (us / 1_000_000).toFixed(1)
const overlaps = (range: TimeRangeUs, start: number, end: number) => range.endUs >= start && range.startUs <= end

function contextText(args: { durationUs: number; utterances: TimedText[]; signals: VideoSignals; startUs: number; endUs: number }): string {
  const { startUs, endUs, signals } = args
  const lines = [`ข้อมูลประกอบ (วิดีโอยาว ${sec(args.durationUs)} วินาที)`]

  const spoken = args.utterances.filter((u) => overlaps(u, startUs, endUs))
  lines.push("คำพูดในช่วงนี้:", ...(spoken.length ? spoken.map((u) => `${sec(u.startUs)}–${sec(u.endUs)} วินาที: ${u.text}`) : ["(ไม่มี)"]))

  const measured = [
    ...signals.blurry.filter((r) => overlaps(r, startUs, endUs)).map((r) => `ภาพเบลอ ${sec(r.startUs)}–${sec(r.endUs)} วินาที`),
    ...signals.black.filter((r) => overlaps(r, startUs, endUs)).map((r) => `ภาพดำ ${sec(r.startUs)}–${sec(r.endUs)} วินาที`),
    ...signals.frozen.filter((r) => overlaps(r, startUs, endUs)).map((r) => `ภาพนิ่งค้าง ${sec(r.startUs)}–${sec(r.endUs)} วินาที`),
    ...signals.sceneCutsUs.filter((at) => at >= startUs && at <= endUs).map((at) => `เปลี่ยนช็อตที่ ${sec(at)} วินาที`),
  ]
  lines.push("สิ่งที่วัดได้จากไฟล์:", ...(measured.length ? measured : ["(ไม่พบปัญหา)"]))
  return lines.join("\n")
}

/**
 * Shows the sampled frames to Claude a batch at a time, each labelled with its time, and
 * joins the replies into one list of scenes for the whole file.
 */
export async function describeVideo(args: {
  transport: LlmTransport
  model: string
  frames: FrameImage[]
  durationUs: number
  signals: VideoSignals
  utterances: TimedText[]
  batchSize: number
  prompt?: SystemPrompt
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}): Promise<VideoInsight> {
  const { frames, durationUs } = args
  const prompt = args.prompt ?? VISION_PROMPT
  const batches: FrameImage[][] = []
  for (let i = 0; i < frames.length; i += args.batchSize) batches.push(frames.slice(i, i + args.batchSize))

  const scenes: Scene[] = []
  const summaries: string[] = []
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let numbered = 0

  for (const [index, batch] of batches.entries()) {
    const startUs = index === 0 ? 0 : batch[0]!.atUs
    const endUs = batches[index + 1]?.[0]?.atUs ?? durationUs

    const content: LlmContent[] = []
    for (const frame of batch) {
      numbered += 1
      content.push({ type: "text", text: `ภาพที่ ${numbered} · เวลา ${sec(frame.atUs)} วินาที` })
      content.push({ type: "image", mediaType: "image/jpeg", data: (await readFile(frame.path)).toString("base64") })
    }
    content.push({ type: "text", text: contextText({ durationUs, utterances: args.utterances, signals: args.signals, startUs, endUs }) })

    const reply = await args.transport.generate({
      model: args.model,
      system: prompt.system,
      content,
      schema: FrameBatchReplySchema,
      maxTokens: 8000,
      signal: args.signal,
    })

    summaries.push(reply.output.summary)
    for (const scene of reply.output.scenes) {
      const clamp = (seconds: number) => Math.min(durationUs, Math.max(0, Math.round(seconds * 1_000_000)))
      const start = clamp(scene.startSec)
      scenes.push({
        startUs: start,
        endUs: Math.max(start, clamp(scene.endSec)),
        description: scene.description,
        kind: scene.kind,
        issues: scene.issues,
        keepClear: keepClearOf(scene.keepClear),
      })
    }
    usage.inputTokens += reply.usage.inputTokens
    usage.outputTokens += reply.usage.outputTokens
    usage.cacheReadTokens += reply.usage.cacheReadTokens
    usage.cacheWriteTokens += reply.usage.cacheWriteTokens
    args.onProgress?.((index + 1) / batches.length)
  }

  return {
    model: args.model,
    promptVersion: prompt.version,
    frameCount: frames.length,
    signals: args.signals,
    summary: summaries.join("\n"),
    scenes: scenes.sort((a, b) => a.startUs - b.startUs),
    retakes: [],
    usage,
  }
}
