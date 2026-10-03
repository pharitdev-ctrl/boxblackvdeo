import { z } from "zod"
import type { TimedText } from "../asr/types.ts"
import type { EmphasisType, Importance } from "../emphasis/types.ts"
import { exitsFor, patternsFor, TEXT_PATTERNS } from "../flair/catalogue.ts"
import { findWord, pointLabel } from "../flair/direct.ts"
import { enforce, TONES, type GroupLook } from "../flair/plan.ts"
import type { LlmTransport, SystemPrompt } from "../llm/types.ts"
import type { Brief } from "../planner/brief.ts"
import { joinWords, textLength } from "../subtitles/captions.ts"
import { SCENE_LABEL_MAX_US, type HighlightGroup, type HighlightLine } from "./placement.ts"
import { HIGHLIGHT_STYLES, PICKABLE_STYLE_IDS, type HighlightStyleId } from "./styles.ts"
import { comparable, composeThai as composed } from "../thai.ts"

// M25: picked from the emphasis points, with each group's look in the same answer
export const HIGHLIGHT_PROMPT_VERSION = "highlights-2026-10-03-direction"

/**
 * What stands between the parts of a sentence Claude is shown where the cut took words out: a mark of
 * its own, since a single part can hold plain spaces too (Thai beside a number or a Latin word).
 */
export const PART_BREAK = " … "

const SYSTEM = `คุณทำ "ข้อความเด่น" ให้วิดีโอสั้น คือตัวหนังสือใหญ่บนภาพ ซ้อนกันทีละบรรทัดตรงจังหวะที่พูด แล้วหายไปพร้อมกัน และเลือกว่าแต่ละชุดแสดงแบบไหน

ข้อมูลที่ได้: brief ของวิดีโอ แนวทางของคลิป สไตล์ตัวอักษร รูปแบบและแอนิเมชันที่ใช้ได้ และจุดเน้นของคลิปเรียงตามเวลา แต่ละจุดมีเลข ชนิด (คำพูดหรือภาพ) ความสำคัญ (สำคัญ รอง เสริม) ประเภท ชื่อช่วง เวลาบนวิดีโอ และเหตุผลที่เน้น

เลือกจุด
- ตัวหนังสือมาจากจุดเน้นเท่านั้น ตอบหนึ่งชุดต่อจุด point คือเลขจุด จุดหนึ่งมีได้ชุดเดียว
- ไม่ต้องทำทุกจุด เลือกจุดที่ตัวหนังสือช่วยให้คนดูจำหรือเข้าใจ จุดสำคัญควรมีตัวหนังสือ จุดที่ภาพหรือเสียงพูดชัดอยู่แล้วปล่อยไว้ได้
- ชุดแรกของคลิปควรเป็นจุด hook ถ้ามี

จุดคำพูด
- ชุดหนึ่งมี 1–3 บรรทัด แต่ละบรรทัดเป็นวลีสั้นที่พูดต่อกัน เรียงตามลำดับที่พูด
- เอาจากวลีของจุดนั้น ขยายไปถึงคำข้างเคียงในประโยคเดียวกันได้ถ้าช่วยให้อ่านรู้เรื่อง แต่ต้องมีคำในวลีของจุดอยู่ด้วย
- quote คือคำที่คัดลอกจากประโยคของจุดนั้นตรงตัว ระบบใช้หาเวลาที่พูด
- ประโยคที่คลิปตัดคำออกไปบางคำจะมาเป็นหลายท่อนคั่นด้วย${PART_BREAK}ตรงที่คำหายไป บรรทัดหนึ่งห้ามคร่อม${PART_BREAK}ให้คัดลอกจากท่อนเดียว
- text คือข้อความที่จะแสดง ปกติเหมือน quote แต่ย่อให้กระชับหรือแก้คำที่ถอดเสียงผิดได้ ความหมายต้องเหมือนเดิม ไม่ใส่ emoji

จุดภาพ
- ไม่มีคำพูด ให้เขียนป้ายสั้น 1–3 บรรทัดจากคำบรรยายฉาก ใส่ใน text และให้ quote เป็นค่าว่าง
- ป้ายขึ้นพร้อมกันทุกบรรทัดตลอดช่วงของจุด ไม่เกิน ${SCENE_LABEL_MAX_US / 1_000_000} วินาที ใช้คำน้อยที่อ่านทัน

ทุกชุด
- แต่ละบรรทัดยาวไม่เกินจำนวนตัวอักษรที่กำหนด (สระบนล่างและวรรณยุกต์ไม่นับ)
- ชุดต้องไม่ซ้อนเวลากัน ข้อความเด่นทุกชุดขึ้นที่ตำแหน่งเดียวกันของจอ ถ้าซ้อนจะทับกันจนอ่านไม่ออก จุดสองจุดในประโยคเดียวกันจึงห้ามใช้คำซ้ำกัน

แบบของแต่ละชุด
- pattern: รูปแบบการวาง เลือกจากรายการที่ให้เท่านั้น ชุดที่ไม่มีอะไรพิเศษใช้ stack
- accentLine กับ accentWord: คำเดียวในชุดที่ควรเป็นสีต่างจากคำอื่น เช่น ตัวเลข ราคา ชื่อสินค้า ชื่อสถานที่ ถ้าไม่มีคำแบบนั้นให้ accentLine เป็น 0 และ accentWord เป็นค่าว่าง
- accentLine นับบรรทัดของชุดนั้นจาก 1 และ accentWord ต้องคัดลอกจาก text ของบรรทัดนั้นตรงตัว ไม่ตัดคำใหม่ ไม่เติมคำ
- exit: แอนิเมชันตอนข้อความหายไป เลือกจากรายการที่ให้ ถ้าไม่ต้องการให้เป็นค่าว่าง
- เลือกรูปแบบจากเนื้อหาของชุด ไม่ใช่สุ่ม เช่น ราคาหรือข้อเสนอเหมาะกับแถบสี คำสั้นคำเดียวที่ต้องการกระแทกตาเหมาะกับคำเดียวเต็มจอ
- รูปแบบเดียวกันติดกันไม่เกิน 3 ชุด สลับให้วิดีโอมีจังหวะ แต่ชุดที่เนื้อหาธรรมดาก็ใช้ stack ได้

โทนสี: tone คือสีของตัวหนังสือทั้งชุด เลือกจากสีของสไตล์
- base = สีหลัก ใช้กับชุดทั่วไป
- accent = สีเน้นทั้งชุด ใช้กับชุดของจุดสำคัญที่สุดในคลิป 1–2 ชุด เช่น ราคา ข้อเสนอ ประโยคเด็ด
- alt = สีที่สอง สลับให้คลิปไม่จำเจ
- โทนเดียวกันติดกันไม่เกิน 3 ชุด · คำที่เน้นสี (accentWord) ยังใช้ได้ทุกโทน จะได้สีที่ต่างจากชุดนั้นเอง

เลือกสไตล์หนึ่งแบบที่เข้ากับเนื้อหาและอารมณ์ของวิดีโอ ตอบด้วย id ของสไตล์

ทำให้เข้ากับแนวทางของคลิป ถ้าแนวทางขัดกับคำสั่งเพิ่มเติมของผู้ใช้ ให้ทำตามคำสั่งของผู้ใช้`

/** The prompt built into the app. */
export const HIGHLIGHT_PROMPT: SystemPrompt = { system: SYSTEM, version: HIGHLIGHT_PROMPT_VERSION }

export const HighlightReplySchema = z.object({
  // the user's own colours are theirs to choose, not Claude's
  style: z.enum(PICKABLE_STYLE_IDS),
  groups: z.array(
    z.object({
      /** the point's number in the list Claude was given, from 1 */
      point: z.number().int(),
      /** quote: copied from the point's sentence, "" on a picture point; text: what shows */
      lines: z.array(z.object({ quote: z.string(), text: z.string() })),
      pattern: z.enum(TEXT_PATTERNS),
      /** which of the palette's colours the whole group reads in */
      tone: z.enum(TONES).default("base"),
      /** the line the coloured word is on, from 1; 0 for none */
      accentLine: z.number().int(),
      /** copied from that line's text, "" for none */
      accentWord: z.string(),
      /** an exit animation id, "" for none */
      exit: z.string(),
    }),
  ),
})
export type HighlightReply = z.infer<typeof HighlightReplySchema>

/** A sentence the rough cut uses, numbered for Claude from 1 in playing order. */
export interface HighlightSentence {
  videoId: string
  beatId: string
  beatName: string
  /** its words [from, to) in the video's transcript */
  from: number
  to: number
  text: string
  /** where it starts on the rough cut */
  timelineUs: number
}

/**
 * An emphasis point as the text call is shown it, numbered from 1 in playing order: a phrase said in
 * a sentence, or a stretch of a picture beat. `text` is the phrase as the rough cut plays it (PART_BREAK
 * where the cut took words out of it), or the scene's description.
 */
export type HighlightPoint = {
  pointId: string
  importance: Importance
  type: EmphasisType
  /** why it matters, Claude's or the user's; "" for none */
  reason: string
  videoId: string
  beatId: string
  beatName: string
  /** where it starts on the rough cut */
  atUs: number
  text: string
} & (
  | {
      kind: "speech"
      /** the point's own words [from, to) in the transcript */
      phrase: { from: number; to: number }
      /**
       * the words a line may quote: from the first to the last word of the rough cut's rows that say any of
       * the phrase in the point's beat, and those rows' text, PART_BREAK between two rows (the cut took words out there)
       */
      sentence: { from: number; to: number; text: string }
    }
  | {
      kind: "scene"
      /** its stretch in the file as the point stores it; placement clips it to the kept pieces */
      startUs: number
      endUs: number
      /** how long the kept part of that stretch plays on the rough cut (the placed point's length, not endUs - startUs) */
      durationUs: number
    }
)

const MAX_LINES = 3
const DEFAULT_STYLE: HighlightStyleId = "bold-white"

/** The words [from, to) a quote says inside a sentence (any run of a transcript's words), or null when the sentence does not say it. The emphasis plan finds its quotes with it too. */
export function findQuote(words: TimedText[], sentence: { from: number; to: number }, quote: string): { from: number; to: number } | null {
  const wanted = comparable(quote)
  if (!wanted) return null
  let said = ""
  const owner: number[] = []
  for (let index = sentence.from; index < sentence.to && index < words.length; index++) {
    const text = comparable(words[index]!.text)
    said += text
    for (let i = 0; i < text.length; i++) owner.push(index)
  }
  const at = said.indexOf(wanted)
  return at < 0 ? null : { from: owner[at]!, to: owner[at + wanted.length - 1]! + 1 }
}

type Answer = HighlightReply["groups"][number]
/** The lines of an answer the app keeps, the place each had in Claude's answer (for its coloured word), and how many went. */
type Kept = { lines: HighlightLine[]; asked: number[]; dropped: number }

/**
 * Turns Claude's reply into groups the app can place, with their looks. An answer on a point not on
 * the list, or on a point that already has a group, is dropped with its lines. On a spoken point a
 * line is dropped when its quote is not in the point's sentence, its text is too long to read, or it
 * is said before the line above it, and a group that says none of the point's phrase is dropped; on a
 * picture point a line is Claude's own label, dropped when blank or too long. A group keeps three
 * lines, and one that reaches back into the words of the group before it in the same beat is dropped.
 * Each group carries its point and, on a picture point, its stretch; its look is keyed by its new id,
 * put through `enforce` alone, and what `enforce` or the words turned down is counted.
 */
export function acceptHighlights(args: {
  points: HighlightPoint[]
  wordsOf: (videoId: string) => TimedText[]
  reply: HighlightReply
  maxChars: number
  landscape: boolean
  /** the user has CapCut Pro: an exit that needs it is kept; off when not given */
  pro?: boolean
  newId: () => string
}): { style: HighlightStyleId; groups: HighlightGroup[]; looks: Record<string, GroupLook>; dropped: number } {
  let dropped = 0

  /** The lines of an answer on a spoken point, quoted from the point's sentence. */
  const spoken = (point: Extract<HighlightPoint, { kind: "speech" }>, answer: Answer): Kept => {
    const words = args.wordsOf(point.videoId)
    const kept: Kept = { lines: [], asked: [], dropped: 0 }
    answer.lines.forEach((reply, i) => {
      const found = findQuote(words, point.sentence, reply.quote)
      const previous = kept.lines.at(-1)
      if (!found || kept.lines.length === MAX_LINES || (previous && found.from < previous.to)) {
        kept.dropped++
        return
      }
      const text = composed(reply.text.trim() || joinWords(words.slice(found.from, found.to).map((word) => word.text)))
      if (textLength(text) > args.maxChars) {
        kept.dropped++
        return
      }
      kept.lines.push({ videoId: point.videoId, from: found.from, to: found.to, text })
      kept.asked.push(i)
    })
    // text of this point says some of its phrase: lines of the neighbouring words alone belong to no point
    const onPhrase = kept.lines.some((line) => line.from < point.phrase.to && point.phrase.from < line.to)
    return onPhrase ? kept : { lines: [], asked: [], dropped: kept.dropped + kept.lines.length }
  }

  /** The lines of a label on a picture point: Claude's own words, quoting nothing. */
  const labelled = (point: Extract<HighlightPoint, { kind: "scene" }>, answer: Answer): Kept => {
    const kept: Kept = { lines: [], asked: [], dropped: 0 }
    answer.lines.forEach((reply, i) => {
      const text = composed(reply.text.trim())
      if (!text || kept.lines.length === MAX_LINES || textLength(text) > args.maxChars) {
        kept.dropped++
        return
      }
      // a label says no words: its word numbers are 0 and mean nothing
      kept.lines.push({ videoId: point.videoId, from: 0, to: 0, text })
      kept.asked.push(i)
    })
    return kept
  }

  const candidates: { number: number; answer: Answer; kept: Kept }[] = []
  const taken = new Set<number>()
  for (const answer of args.reply.groups) {
    const point = args.points[answer.point - 1]
    // one group a point, on a point of the list
    if (!point || taken.has(answer.point)) {
      dropped += Math.max(1, answer.lines.length)
      continue
    }
    const kept = point.kind === "speech" ? spoken(point, answer) : labelled(point, answer)
    dropped += kept.dropped
    if (kept.lines.length === 0) continue
    taken.add(answer.point)
    candidates.push({ number: answer.point, answer, kept })
  }

  // in playing order, which is the points' order
  candidates.sort((a, b) => a.number - b.number)
  const groups: HighlightGroup[] = []
  const looks: Record<string, GroupLook> = {}
  let previous: { point: HighlightPoint; to: number } | null = null
  for (const { number, answer, kept } of candidates) {
    const point = args.points[number - 1]!
    const { lines } = kept
    // text never overlaps in time, since every group shows in the same place on screen: a group that
    // reaches back into the words of the one before it, said in the same beat, is dropped
    const before = previous?.point
    if (before && before.kind === "speech" && point.kind === "speech" && before.videoId === point.videoId && before.beatId === point.beatId && lines[0]!.from < previous!.to) {
      dropped += lines.length
      continue
    }
    const id = args.newId()
    groups.push({
      id,
      source: "ai",
      edited: false,
      lines,
      beatId: point.beatId,
      pointId: point.pointId,
      ...(point.kind === "scene" ? { scene: { videoId: point.videoId, startUs: point.startUs, endUs: point.endUs } } : {}),
    })
    previous = { point, to: lines.at(-1)!.to }

    // the look chosen with it: the coloured word is looked for on the line Claude named, counted among the lines it gave
    const line = kept.asked.indexOf(answer.accentLine - 1)
    const found = line < 0 ? null : findWord(lines[line]!.text, answer.accentWord)
    if (answer.accentWord.trim() && !found) dropped++
    const asked: GroupLook = {
      pattern: answer.pattern,
      // a transport that skipped the schema's defaults hands over no tone at all
      tone: answer.tone ?? "base",
      accent: found && { line, from: found.from, to: found.to },
      exit: answer.exit.trim() || null,
      edited: false,
    }
    // checked against its own group alone: the runs of same patterns and tones are ruled each time the
    // groups are shown (looksInForce), so a later change to a neighbour is not frozen in here
    const look = enforce([asked], [{ lines: lines.map((shown) => shown.text) }], args.landscape, args.pro ?? false)[0]!
    if (look.pattern !== asked.pattern || (asked.exit !== null && look.exit === null)) dropped++
    looks[id] = look
  }
  return { style: args.reply.style, groups, looks, dropped }
}

const clock = (us: number) => {
  const tenths = Math.round(us / 100_000)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`
}
const duration = (us: number) => {
  const seconds = Math.round(us / 1_000_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** One point as the request lists it: its number, kind, weight, type, beat, time, words or scene, and why. */
function pointLine(point: HighlightPoint, index: number): string {
  const head = `[${index + 1}] ${point.kind === "speech" ? "คำพูด" : "ภาพ"} · ${pointLabel(point.importance, point.type)} · ช่วง "${point.beatName}" ${clock(point.atUs)}`
  const body = point.kind === "speech" ? `“${point.text}” ในประโยค “${point.sentence.text}”` : `ยาว ${(point.durationUs / 1e6).toFixed(1)} วิ ฉาก: ${point.text || "ไม่มีคำบรรยาย"}`
  const reason = point.reason.trim()
  return `${head} ${body}${reason ? ` · เหตุผล: ${reason}` : ""}`
}

function describe(args: { brief: Brief; direction?: string; durationUs: number; maxChars: number; landscape: boolean; pro: boolean; points: HighlightPoint[] }): string {
  const { brief } = args
  const exits = exitsFor(args.pro)
  return [
    "brief",
    `- ประเภทวิดีโอ: ${brief.videoType ?? "ไม่ระบุ"}`,
    `- ความยาวที่ต้องการ: ${brief.targetSeconds ? `${brief.targetSeconds} วินาที` : "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${brief.instructions.trim() || "ไม่ระบุ"}`,
    `- แนวทางของคลิป: ${args.direction?.trim() || "ไม่มี"}`,
    "",
    `ความยาววิดีโอหลังตัด ${duration(args.durationUs)}`,
    `แต่ละบรรทัดยาวไม่เกิน ${args.maxChars} ตัวอักษร`,
    "",
    "สไตล์ที่เลือกได้",
    ...Object.values(HIGHLIGHT_STYLES).map((style) => `- ${style.id}: ${style.mood}`),
    "",
    "รูปแบบที่ใช้ได้",
    ...patternsFor(args.landscape).map((entry) => `- ${entry.id}: ${entry.mood} (ใช้กับชุดที่มี ${entry.lines.min}–${entry.lines.max} บรรทัด)`),
    "",
    "แอนิเมชันตอนข้อความหายไป",
    ...(exits.length > 0 ? exits.map((exit) => `- ${exit.id}: ${exit.name}`) : ["- (ไม่มีให้เลือก ให้ตอบค่าว่าง)"]),
    "",
    "จุดเน้น",
    ...args.points.map(pointLine),
  ].join("\n")
}

/** Asks Claude for highlight text on the emphasis points, with a style and each group's look, and keeps what fits. */
export async function pickHighlights(args: {
  transport: LlmTransport
  model: string
  brief: Brief
  /** the outline's direction for decorating the clip; absent on outlines from before 0.8.4 */
  direction?: string
  durationUs: number
  points: HighlightPoint[]
  wordsOf: (videoId: string) => TimedText[]
  maxChars: number
  /** wide output: the patterns that only work on portrait are not offered */
  landscape?: boolean
  /** the user has CapCut Pro: exits that need it are offered; off when not given */
  pro?: boolean
  newId: () => string
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ style: HighlightStyleId; groups: HighlightGroup[]; looks: Record<string, GroupLook>; dropped: number }> {
  if (args.points.length === 0) return { style: DEFAULT_STYLE, groups: [], looks: {}, dropped: 0 }
  const landscape = args.landscape ?? false
  const pro = args.pro ?? false
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? HIGHLIGHT_PROMPT).system,
    content: [{ type: "text", text: describe({ ...args, landscape, pro }) }],
    schema: HighlightReplySchema,
    // every group now comes with its look
    maxTokens: 12_000,
    signal: args.signal,
  })
  return acceptHighlights({ points: args.points, wordsOf: args.wordsOf, reply: reply.output, maxChars: args.maxChars, landscape, pro, newId: args.newId })
}
