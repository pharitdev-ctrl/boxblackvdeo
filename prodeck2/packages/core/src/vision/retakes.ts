import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { TimedText } from "../asr/types.ts"
import { falseStarts, repeatedUtterancePairs } from "../cut/words.ts"
import type { LlmContent, LlmTransport, LlmUsage } from "../llm/types.ts"
import { joinWords } from "../subtitles/captions.ts"
import type { RetakeLoad } from "./estimate.ts"
import type { FrameImage } from "./frames.ts"

/** One time the speaker said a line. */
export interface Take {
  startUs: number
  endUs: number
  text: string
}

/** The same line said twice: the earlier take first. */
export interface Retake {
  takes: [Take, Take]
}

const FRAME_STEP_US = 500_000
const MAX_FRAMES_PER_TAKE = 8

const overlaps = (a: Take, b: Take) => a.startUs < b.endUs && b.startUs < a.endUs

/**
 * Lines the speaker said again, found the way the cut compiler finds them: whole utterances
 * repeated, and phrases started again after a break. Each is reported once.
 */
export function findRetakes(transcript: { utterances: TimedText[]; words: TimedText[] }): Retake[] {
  const { utterances, words } = transcript
  const retakes: Retake[] = repeatedUtterancePairs(utterances).map(([earlier, later]) => ({
    takes: [utterances[earlier]!, utterances[later]!].map((u) => ({ startUs: u.startUs, endUs: u.endUs, text: u.text })) as [Take, Take],
  }))

  const take = (from: number, to: number): Take => ({
    startUs: words[from]!.startUs,
    endUs: words[to - 1]!.endUs,
    text: joinWords(words.slice(from, to).map((word) => word.text)),
  })
  for (const { from, to } of falseStarts(words)) {
    // the restart is taken to be as many words as the abandoned take
    const found: Retake = { takes: [take(from, to), take(to, Math.min(to + (to - from), words.length))] }
    // a restart within takes already found (the same retake, or a stumble inside one of its takes) needs no review of its own
    const covered = (take: Take) => retakes.some((retake) => retake.takes.some((known) => overlaps(known, take)))
    if (!covered(found.takes[0]) || !covered(found.takes[1])) retakes.push(found)
  }
  return retakes.sort((a, b) => a.takes[0].startUs - b.takes[0].startUs)
}

/** When to look at a take: every half second, at most eight frames spread over a long one, the middle of a very short one. */
export function takeFrameTimes(take: Take): number[] {
  const duration = take.endUs - take.startUs
  if (duration < FRAME_STEP_US) return [take.startUs + Math.round(duration / 2)]
  const count = Math.floor(duration / FRAME_STEP_US) + 1
  if (count <= MAX_FRAMES_PER_TAKE) return Array.from({ length: count }, (_, i) => take.startUs + i * FRAME_STEP_US)
  return Array.from({ length: MAX_FRAMES_PER_TAKE }, (_, i) => take.startUs + Math.round((i * duration) / MAX_FRAMES_PER_TAKE))
}

/** What comparing a video's lines said twice will take: one comparison each, showing the pictures of both takes. */
export function retakeLoad(transcript: { utterances: TimedText[]; words: TimedText[] }): RetakeLoad {
  const retakes = findRetakes(transcript)
  return { reviews: retakes.length, frames: retakes.reduce((sum, retake) => sum + takeFrameTimes(retake.takes[0]).length + takeFrameTimes(retake.takes[1]).length, 0) }
}

/** Built in; changing it must go with a new vision PROMPT_VERSION, since reviews are stored in cached insights. */
export const RETAKE_PROMPT = `ผู้พูดในวิดีโอพูดประโยคหรือวลีเดียวกันสองครั้ง (เทค A พูดก่อน เทค B พูดทีหลัง) คุณช่วยคนตัดต่อเลือกว่าจะใช้เทคไหน

แต่ละเทคมีคำพูดพร้อมเวลาของแต่ละคำ และภาพที่ดึงจากเทคนั้นทุกครึ่งวินาทีพร้อมเวลา ดูว่าภาพไปด้วยกันกับคำพูดแค่ไหน เช่น
- จำนวนนิ้วที่ชูตรงกับตัวเลขที่พูดตอนนั้นไหม ชี้หรือหยิบของมาโชว์ตรงจังหวะคำที่พูดถึงไหม
- สีหน้า การมองกล้อง ความมั่นใจ พูดติดขัดหรือหยุดกลางคัน
- ภาพเสียจริง เช่น หลุดเฟรม โฟกัสหลุด มืด
ท่าทางที่เป็นส่วนหนึ่งของการพูด (ชูนิ้วนับ ชี้ โบกมือ ยื่นของเข้าหากล้อง) ไม่ใช่ข้อเสีย แม้จะบังหน้าหรือเบลอจากการขยับ

takeA และ takeB: สิ่งที่เห็นในแต่ละเทคสั้นๆ หนึ่งถึงสองประโยค
better: A หรือ B ถ้าเทคนั้นใช้ได้ดีกว่าชัดเจน same ถ้าพอๆ กัน
reason: เหตุผลหนึ่งประโยค
เขียนเป็นภาษาไทย บรรยายเฉพาะสิ่งที่เห็นในภาพ`

export const RetakeReplySchema = z.object({
  takeA: z.string(),
  takeB: z.string(),
  better: z.enum(["A", "B", "same"]),
  reason: z.string(),
})

/** Claude's comparison of the takes of one retake. */
export interface RetakeReview {
  takes: [Take, Take]
  notes: [string, string]
  better: "A" | "B" | "same"
  reason: string
}

const sec = (us: number) => (us / 1_000_000).toFixed(1)
const LABELS = ["A", "B"] as const

/** Shows Claude both takes, each as its timed words and its frames, and asks which one to use. */
export async function reviewRetake(args: {
  transport: LlmTransport
  model: string
  retake: Retake
  /** frames of take A and of take B */
  frames: [FrameImage[], FrameImage[]]
  words: TimedText[]
  signal?: AbortSignal
}): Promise<{ review: RetakeReview; usage: LlmUsage }> {
  const content: LlmContent[] = []
  for (const [index, take] of args.retake.takes.entries()) {
    const label = LABELS[index]!
    const spoken = args.words.filter((word) => {
      const mid = (word.startUs + word.endUs) / 2
      return mid >= take.startUs && mid <= take.endUs
    })
    content.push({
      type: "text",
      text: `เทค ${label} · ${sec(take.startUs)}–${sec(take.endUs)} วินาที\nคำพูด: ${spoken.map((word) => `${word.text} (${sec(word.startUs)})`).join(" ")}`,
    })
    for (const frame of args.frames[index]!) {
      content.push({ type: "text", text: `เทค ${label} · เวลา ${sec(frame.atUs)} วินาที` })
      content.push({ type: "image", mediaType: "image/jpeg", data: (await readFile(frame.path)).toString("base64") })
    }
  }
  content.push({ type: "text", text: "เทียบเทค A กับเทค B" })

  const reply = await args.transport.generate({
    model: args.model,
    system: RETAKE_PROMPT,
    content,
    schema: RetakeReplySchema,
    // thinking counts toward the limit, and at a higher effort there is more of it
    maxTokens: 16_000,
    signal: args.signal,
  })
  const { takeA, takeB, better, reason } = reply.output
  return { review: { takes: args.retake.takes, notes: [takeA, takeB], better, reason }, usage: reply.usage }
}
