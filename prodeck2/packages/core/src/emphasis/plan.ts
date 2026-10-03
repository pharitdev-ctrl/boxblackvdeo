import { z } from "zod"
import type { TimedText } from "../asr/types.ts"
import { clock } from "../flair/direct.ts"
import { findQuote, type HighlightSentence } from "../highlights/pick.ts"
import type { LlmTransport, SystemPrompt } from "../llm/types.ts"
import type { Brief } from "../planner/brief.ts"
import type { Scene } from "../vision/describe.ts"
import { pointsOverlap } from "./filter.ts"
import { EMPHASIS_TYPES, IMPORTANCE, keptReason, type EmphasisAnchor, type EmphasisPoint } from "./types.ts"

export const EMPHASIS_PROMPT_VERSION = "emphasis-2026-10-03-direction"

const SYSTEM = `คุณวาง "จุดเน้น" ให้วิดีโอสั้นที่ตัดหยาบแล้ว จุดเน้นคือสิ่งที่คลิปควรย้ำให้คนดูจำได้หรือเห็นชัด ภายหลังแอปจะวางข้อความเด่น กราฟิก ซูม สื่อแทรก และเสียงเอฟเฟคลงบนจุดเหล่านี้ คุณไม่ต้องเลือกเอฟเฟคเอง

ข้อมูลที่ได้: brief ของวิดีโอ แนวทางของคลิป บีตตามลำดับที่เล่นพร้อมหน้าที่ของแต่ละบีต ประโยคที่พูดเรียงตามเวลา แต่ละประโยคมีเลข ช่วง และเวลาบนคลิปที่ตัดแล้ว และฉากในบีตภาพ (บีตที่เล่าด้วยภาพ ไม่มีคำพูด) แต่ละฉากมีเลข s1 s2 … ช่วง เวลา ความยาว ชนิดฉาก คำบรรยายฉาก และภาพที่บีตนั้นต้องการ
ช่วง "…" บอกว่าประโยคหรือฉากนั้นอยู่ในบีตไหน
คำในประโยคถอดจากเสียง อาจสะกดผิด ให้อ่านความหมายจากทั้งประโยค

วิธีเลือก
- จุดแรกของคลิปเป็น hook คือสิ่งที่ดึงคนดูไว้ตอนเปิดคลิป
- ความสำคัญมี 3 ระดับ
  · key = สิ่งที่คนดูต้องจำได้ มีไม่กี่จุดในทั้งคลิป
  · secondary = สิ่งที่ช่วยให้เข้าใจเรื่อง
  · extra = สิ่งที่ใส่เพิ่มได้ถ้าคลิปจัดเต็ม
- ชนิดของจุด: hook = ตอนเปิดที่ดึงความสนใจ · number = ตัวเลขหรือราคา · product = ของหรือสินค้า · action = การกระทำหรือคำชวนให้ทำ · emotion = อารมณ์หรือความรู้สึก · place = สถานที่ · visual = ภาพสวยหรือภาพที่ควรให้เห็นชัด
- ไม่เลือกคำอุทาน คำชมทั่วไป หรือคำลงท้าย เช่น ว้าว สุดยอด ครับ ค่ะ นะคะ
- ประโยคหนึ่งมีได้หลายจุดถ้าวลีไม่ทับกัน · สองจุดในประโยคเดียวกันห้ามใช้คำตรงตำแหน่งเดียวกันแม้แต่คำเดียว (คำเดียวกันที่พูดคนละที่ใช้ได้) · ฉากหนึ่งเป็นจุดเน้นได้จุดเดียว แอปจะตัดจุดที่ทับจุดก่อนหน้าทิ้งเอง
- ไม่ต้องเน้นทุกประโยค เลือกเฉพาะที่ควรเน้นจริง ตอบเป็นรายการว่างได้
- ทำให้เข้ากับแนวทางของคลิป ถ้าแนวทางขัดกับคำสั่งเพิ่มเติมของผู้ใช้ ให้ทำตามคำสั่งของผู้ใช้

ตอบต่อจุด
- จุดจากคำพูด: at = เลขประโยค · scene = "" · quote = วลีที่คัดลอกจากประโยคนั้นตรงตัว และสั้นกว่าทั้งประโยค ระบบใช้หาเวลาที่พูด
- quote คัดลอกตามที่เขียนในประโยคทุกตัวอักษร แม้คำนั้นถอดเสียงผิดก็ห้ามแก้ ไม่อย่างนั้นระบบหาเวลาที่พูดไม่เจอ
- จุดจากฉาก: at = null · scene = เลขฉาก เช่น "s3" · quote = ""
- importance: key, secondary หรือ extra · type: ชนิดของจุด
- reason: หนึ่งบรรทัดว่าทำไมควรเน้นตรงนี้
- เรียงตามเวลาที่เล่น`

/** The prompt built into the app. */
export const EMPHASIS_PROMPT: SystemPrompt = { system: SYSTEM, version: EMPHASIS_PROMPT_VERSION }

/** A kept scene of a picture beat, numbered s1… for Claude. */
export interface EmphasisScene {
  /** "s1", "s2"… in playing order */
  label: string
  videoId: string
  beatId: string
  beatName: string
  /** the scene's stretch in its file, clipped to what the rough cut keeps */
  startUs: number
  endUs: number
  /** where it starts on the rough cut, and how long it plays there */
  timelineUs: number
  durationUs: number
  description: string
  kind: Scene["kind"]
  /** the beat's own `Beat.visual` */
  visual: string
}

/** A beat as Claude is shown it, in playing order. */
export interface EmphasisBeat {
  id: string
  name: string
  purpose: string
}

export const EmphasisReplySchema = z.object({
  points: z.array(
    z.object({
      /** the sentence's number from 1, or null for a scene point */
      at: z.number().int().nullable(),
      /** "s3" for a scene point, "" for a speech one */
      scene: z.string().default(""),
      /** copied from the sentence; its whole sentence is accepted too; "" for a scene point */
      quote: z.string().default(""),
      importance: z.enum(IMPORTANCE),
      type: z.enum(EMPHASIS_TYPES),
      reason: z.string().default(""),
    }),
  ),
})
export type EmphasisReply = z.infer<typeof EmphasisReplySchema>
type Answer = EmphasisReply["points"][number]

/** A length as minutes and seconds, for the clip as a whole. */
const duration = (us: number) => {
  const seconds = Math.round(us / 1_000_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const orUnknown = (text: string) => text.trim() || "ไม่ระบุ"

/** The request text: brief, beats with purpose, numbered sentences with rough-cut times, scenes s1… with time, length, description, kind and visual. Exported for tests. */
export function describeEmphasis(args: { brief: Brief; direction?: string; durationUs: number; beats: EmphasisBeat[]; sentences: HighlightSentence[]; scenes: EmphasisScene[] }): string {
  const { brief } = args
  return [
    "brief",
    `- ประเภทวิดีโอ: ${brief.videoType ?? "ไม่ระบุ"}`,
    `- ความยาวที่ต้องการ: ${brief.targetSeconds ? `${brief.targetSeconds} วินาที` : "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${orUnknown(brief.instructions)}`,
    `- แนวทางของคลิป: ${args.direction?.trim() || "ไม่มี"}`,
    "",
    `ความยาววิดีโอหลังตัด ${duration(args.durationUs)}`,
    "",
    "บีตตามลำดับที่เล่น (ชื่อ: หน้าที่ของบีต)",
    ...args.beats.map((beat, i) => `${i + 1}. ${beat.name}: ${orUnknown(beat.purpose)}`),
    "",
    "ประโยค",
    ...(args.sentences.length > 0
      ? args.sentences.map((sentence, i) => `[${i + 1}] ช่วง "${sentence.beatName}" ${clock(sentence.timelineUs)} ${sentence.text}`)
      : ["ไม่มีประโยคที่พูด ตอบเฉพาะจุดจากฉาก"]),
    "",
    "ฉากในบีตภาพ",
    ...(args.scenes.length > 0
      ? args.scenes.map(
          (scene) =>
            `[${scene.label}] ช่วง "${scene.beatName}" ${clock(scene.timelineUs)} ยาว ${(scene.durationUs / 1e6).toFixed(1)} วิ ชนิด ${scene.kind}: ${scene.description} · ภาพที่บีตนี้ต้องการ: ${orUnknown(scene.visual)}`,
        )
      : ["ไม่มีฉากในบีตภาพ ตอบเฉพาะจุดจากคำพูด"]),
  ].join("\n")
}

/** What an answer points at, with where it plays for putting the points in order; null when its sentence, scene or quote is not there. */
function anchorOf(
  answer: Answer,
  sentences: HighlightSentence[],
  scenes: EmphasisScene[],
  wordsOf: (videoId: string) => TimedText[],
): { anchor: EmphasisAnchor; timelineUs: number; from: number } | null {
  // a number below 1 is no sentence: with a scene named, Claude meant the scene
  if (answer.at !== null && (answer.at >= 1 || answer.scene.trim() === "")) {
    const sentence = sentences[answer.at - 1]
    if (!sentence) return null
    const words = wordsOf(sentence.videoId)
    const found = findQuote(words, sentence, answer.quote)
    if (!found) return null
    return { anchor: { kind: "speech", videoId: sentence.videoId, from: found.from, to: found.to, beatId: sentence.beatId }, timelineUs: sentence.timelineUs, from: found.from }
  }
  const label = answer.scene.trim().toLowerCase()
  const scene = scenes.find((one) => one.label === label)
  if (!scene) return null
  return { anchor: { kind: "scene", videoId: scene.videoId, startUs: scene.startUs, endUs: scene.endUs, beatId: scene.beatId }, timelineUs: scene.timelineUs, from: 0 }
}

/**
 * Turns Claude's reply into points: a quote is found in its sentence with findQuote, and may be its
 * whole sentence (a row can be all emphasis, e.g. a question or a countdown row); an answer whose
 * sentence, scene or quote does not exist, or whose phrase overlaps an earlier answer or a `kept` point,
 * is dropped and counted. An answer with a sentence number of 1 or more is a speech point even when it
 * names a scene too; one with a scene and a number below 1 is a scene point. A quote made only of words
 * the cut removed is accepted, but placePoints never places it, so the level filter leaves its items out. The reason is kept by keptReason: trimmed and cut to
 * EMPHASIS_REASON_MAX UTF-16 units. New points are source "ai", edited false, in playing order.
 */
export function acceptEmphasis(args: {
  reply: EmphasisReply
  sentences: HighlightSentence[]
  scenes: EmphasisScene[]
  wordsOf: (videoId: string) => TimedText[]
  /** the user's and edited points that stay: new ones may not overlap them */
  kept: EmphasisPoint[]
  newId: () => string
}): { points: EmphasisPoint[]; dropped: number } {
  let dropped = 0
  const taken: EmphasisAnchor[] = args.kept.map((point) => point.anchor)
  const accepted: { anchor: EmphasisAnchor; timelineUs: number; from: number; answer: Answer }[] = []
  for (const answer of args.reply.points) {
    const found = anchorOf(answer, args.sentences, args.scenes, args.wordsOf)
    if (!found || taken.some((other) => pointsOverlap(found.anchor, other))) {
      dropped++
      continue
    }
    taken.push(found.anchor)
    accepted.push({ ...found, answer })
  }
  // ids are handed out in playing order, after the order Claude answered in decided which overlap wins
  accepted.sort((a, b) => a.timelineUs - b.timelineUs || a.from - b.from)
  const points = accepted.map(({ anchor, answer }): EmphasisPoint => ({
    id: args.newId(),
    anchor,
    importance: answer.importance,
    type: answer.type,
    // cut by whole characters to the length the checks on a stored reason count
    reason: keptReason(answer.reason),
    source: "ai",
    edited: false,
  }))
  return { points, dropped }
}

/** One Claude call for the points; no call when there is neither a sentence nor a scene. */
export async function planEmphasis(args: {
  transport: LlmTransport
  model: string
  brief: Brief
  /** the outline's direction for decorating the clip; absent on outlines from before 0.8.4 */
  direction?: string
  durationUs: number
  beats: EmphasisBeat[]
  sentences: HighlightSentence[]
  scenes: EmphasisScene[]
  wordsOf: (videoId: string) => TimedText[]
  kept: EmphasisPoint[]
  newId: () => string
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ points: EmphasisPoint[]; dropped: number }> {
  if (args.sentences.length === 0 && args.scenes.length === 0) return { points: [], dropped: 0 }
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? EMPHASIS_PROMPT).system,
    content: [{ type: "text", text: describeEmphasis(args) }],
    schema: EmphasisReplySchema,
    // a long clip with a point in nearly every sentence needs room for all of them
    maxTokens: 16_000,
    signal: args.signal,
  })
  return acceptEmphasis({ reply: reply.output, sentences: args.sentences, scenes: args.scenes, wordsOf: args.wordsOf, kept: args.kept, newId: args.newId })
}
