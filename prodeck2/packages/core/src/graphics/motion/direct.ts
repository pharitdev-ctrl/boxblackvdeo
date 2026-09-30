import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { CueAnchor } from "../../flair/plan.ts"
import type { LlmContent, LlmTransport, SystemPrompt } from "../../llm/types.ts"
import type { Brief } from "../../planner/brief.ts"
import { describePoints, findWord, framesToAttach, startOf, wordAt, type ExistingGraphic, type GraphicPoint, type GraphicSentence } from "./points.ts"
import { clipText, GRAPHIC_MAX_S, GRAPHIC_MIN_US, MOTION_VERSION, type GraphicBox, type GraphicCue, type MotionWord } from "../plan.ts"

export const MOTION_PLAN_PROMPT_VERSION = "motion-plan-2026-09-30b"

const SYSTEM = `คุณเลือกว่าจุดเน้นไหนของวิดีโอสั้นควรมี "โมชันกราฟิก" และคิดไอเดียของแต่ละชิ้น โมชันกราฟิกคือภาพเคลื่อนไหวที่ออกแบบเฉพาะจุดนั้น วางซ้อนบนวิดีโอ และขยับตามจังหวะคำพูด ขั้นถัดไปจะมีนักออกแบบเขียนแอนิเมชันจริงจากไอเดียของคุณ นักออกแบบเห็นแค่ไอเดีย คำที่พูดพร้อมเวลา และขนาดกรอบ ไม่เห็นวิดีโอ

ข้อมูลที่ได้: brief จุดเน้นทุกจุดตามลำดับที่เล่นพร้อมเวลาและความยาวบนคลิปที่ตัดแล้ว (ความสำคัญ ชนิด วลีที่เน้นกับประโยคของมัน หรือคำบรรยายฉากของจุดเน้นภาพ และเหตุผล) ฉากที่เล่นตรงนั้น (คำบรรยาย ชนิด และ keepClear = แถบของภาพที่ห้ามบัง) ข้อความเด่นของแต่ละจุดและซับที่ครองพื้นที่อยู่แล้ว และเฟรมของบางจุดแนบท้าย — จุดที่ไม่มีเฟรม ดูภาพเองไม่ได้
keepClear และแถบข้อความเด่น [บน, ล่าง] = แถบเต็มความกว้าง สัดส่วนความสูงจากขอบบน
คำในประโยคถอดจากเสียง อาจสะกดผิด ให้อ่านความหมายจากทั้งประโยค

จุดที่คุณใส่กราฟิก ข้อความเด่นของจุดนั้นจะไม่ขึ้น กราฟิกขึ้นแทน จึงใส่เฉพาะจุดที่ภาพเคลื่อนไหวช่วยให้คนดูเข้าใจหรือรู้สึกตามได้มากกว่าข้อความเด่นของจุดนั้น จุดที่ไม่เหมาะไม่ต้องใส่ ข้อความเด่นจะขึ้นตามเดิม ห้ามใส่แค่ตกแต่ง ตอบเป็นรายการว่างได้
- แอปเลือกเองว่าจะแสดงจุดระดับไหนตามระดับความจัดที่ผู้ใช้ตั้ง จึงให้วางกับทุกจุดที่เหมาะ ไม่ว่าจะสำคัญ รอง หรือเสริม · จุดสำคัญควรได้กราฟิกก่อนถ้ากราฟิกช่วยได้
- เหมาะ: ตัวเลขหรือสถิติ (ตัวเลขวิ่ง มาตรวัด วงแหวนเปอร์เซ็นต์) · การเทียบ (แท่งเทียบ ก่อนกับหลัง) · ขั้นตอนหรือรายการ (เส้นเวลา รายการติ๊ก) · การเคลื่อนที่หรือการเปลี่ยนแปลง (ของวิ่งตามเส้นทาง ของโตขึ้น ราคาถูกขีดฆ่า) · ของ การกระทำ หรือคำเตือนที่วาดเป็นภาพได้ชัด
- ไม่เหมาะ: คำอุทานหรือคำชมทั่วไป · จุดที่ข้อความเด่นพูดครบแล้วและไม่มีอะไรให้เห็นเพิ่ม · สิ่งที่ต้องใช้รูปถ่าย โลโก้ หรือหน้าคนจริง · การชี้ของที่อยู่ในวิดีโอ เพราะนักออกแบบไม่เห็นวิดีโอ
- กราฟิกขึ้นแทนข้อความเด่นของจุดนั้น ให้แสดงสิ่งที่ตัวหนังสืออย่างเดียวทำให้เห็นไม่ได้ ถ้าคนดูต้องได้อ่านคำสำคัญของจุด ให้กราฟิกพาคำนั้นไปด้วย สั้น ๆ ตรงตัว
- จุดเน้นภาพไม่มีคำพูด ใส่ได้จากสิ่งที่เห็นในฉาก · word ของจุดเน้นภาพให้เป็นค่าว่าง
- หนึ่งจุดมีกราฟิกได้อันเดียว · ถ้าสองจุดอยู่ใกล้กัน ให้ชิ้นแรกจบก่อนชิ้นถัดไปขึ้น หรือวางกรอบไม่ให้ทับกัน
- กรอบ: กว้าง 0.5–1.0 ของจอ สูง 0.15–0.5 ให้ใหญ่ที่สุดเท่าที่ที่ว่างของจุดนั้นมี เพราะกราฟิกถูกวาดอยู่ในกรอบเท่านั้น และไอเดียต้องพอดีกับกรอบ (กรอบเตี้ยใช้ไอเดียแถวเดียว เช่น ตัวเลขวิ่งหรือแถบ) · ห้ามทับ keepClear ของฉากนั้น ห้ามทับพื้นที่ซับ · แถบข้อความเด่นของจุดที่ใส่กราฟิกใช้ได้ เพราะข้อความนั้นจะไม่ขึ้น แต่ห้ามทับข้อความเด่นของจุดอื่นที่ขึ้นระหว่างกราฟิกอยู่บนจอ · เว้น 0.07 บนสุดของจอไว้ให้แถบเมนูของแอปโซเชียล · บนจอแนวตั้งวางไว้ครึ่งล่างเป็นหลัก ถ้าครึ่งล่างไม่ว่างค่อยใช้ช่วงบนเหนือหัวคน

ตอบต่อกราฟิก
- point: เลขจุดเน้น
- word: คำในประโยคของจุดนั้นที่กราฟิกเริ่มขึ้น คัดลอกตรงตัว ("" = ต้นวลีของจุด) · เลือกคำที่มาก่อนคำสำคัญ เพื่อให้กราฟิกขึ้นทันก่อนถึงจังหวะหลัก
- until: คำสุดท้ายในประโยคของจุดนั้นที่ไอเดียใช้เป็นจังหวะ คัดลอกตรงตัว แอปรู้เวลาของทุกคำ จะให้กราฟิกอยู่ถึงคำนี้แล้วเผื่อเวลาให้อ่านและออกเอง ("" = ไอเดียไม่ผูกกับคำไหนหลังคำเริ่ม)
- seconds: อยากให้อยู่นานกี่วินาที 1.5–6 นับจากคำเริ่ม ถ้าคำใน until มาช้ากว่านั้น แอปยืดให้ถึงเอง (ถ้าภาพตัดไปช่วงอื่นก่อนครบ กราฟิกจะจบตรงนั้น)
- box: [ซ้าย, บน, ขวา, ล่าง] ทศนิยม 0–1 นับจากมุมซ้ายบนของทั้งจอ เช่น [0.04, 0.55, 0.96, 0.9]
- why: หนึ่งบรรทัดว่าทำไมตรงนี้
- idea: วาดอะไรและขยับอย่างไร เป็นภาษาไทย หนึ่งถึงสองประโยค ชัดพอให้นักออกแบบลงมือได้โดยไม่ต้องเดา
  · บอกของที่อยู่ในภาพ สิ่งที่ขยับ และคำพูดคำไหนเป็นจังหวะของอะไร โดยยกคำจากประโยคมาใส่ในเครื่องหมายคำพูด
  · ข้อความหรือตัวเลขที่ต้องขึ้นบนกราฟิกให้เขียนมาตรงตัว สั้น ๆ ตัวเลขใช้เลขอารบิก
  · ใช้ได้เฉพาะสิ่งที่วาดเองได้: เส้น รูปทรง ไอคอนง่าย ๆ และตัวหนังสือ ไม่มีรูปถ่าย โลโก้ หรืออีโมจิ
  · ไม่ต้องระบุสี นักออกแบบใช้ชุดสีของสไตล์ที่ผู้ใช้เลือก
  · หนึ่งชิ้นมีเรื่องเดียว อย่าใส่หลายเรื่องในชิ้นเดียว
  · ตัวอย่าง: ตัวเลขวิ่งจาก 0 ถึง 28,000 หยุดพอดีคำว่า "สองหมื่นแปดพัน" แล้วหน่วย "กม./ชม." เด้งขึ้น มีเข็มวัดความเร็วกวาดตามตัวเลข
  · ตัวอย่าง: รายการ 3 ข้อ (ชุดอวกาศ / ออกซิเจน / เชื้อเพลิง) เลื่อนเข้าทีละข้อแล้วติ๊กถูกพอดีคำของมัน
  · ตัวอย่าง: ป้ายราคา "2,900" ถูกขีดฆ่าตอนพูด "เหลือแค่" แล้วป้าย "1,500" ตัวใหญ่กระแทกลงมาพอดีคำว่า "พันห้า"
`

/** The prompt built into the app. */
export const MOTION_PLAN_PROMPT: SystemPrompt = { system: SYSTEM, version: MOTION_PLAN_PROMPT_VERSION }

export const MotionPlanReplySchema = z.object({
  graphics: z.array(
    z.object({
      /** the point's number in the list Claude was shown, from 1 */
      point: z.number().int(),
      word: z.string().default(""),
      until: z.string().default(""),
      seconds: z.number(),
      why: z.string().default(""),
      box: z.array(z.number()),
      // an answer with no idea reads as an empty one, which drops that graphic rather than failing the whole reply
      idea: z.string().default(""),
    }),
  ),
})
export type MotionPlanReply = z.infer<typeof MotionPlanReplySchema>

/**
 * The box the prompt asks for: half the frame wide or more, the whole width too, and 0.15 to a half of it tall.
 * The floor is what the free band under a talking head has room for: in real projects the band to keep clear
 * ends near 0.58 of the frame and the subtitles' room starts at 0.76, which leaves about 0.18.
 */
const BOX = { minWidth: 0.5, minHeight: 0.15, maxHeight: 0.5 }
/** How far past a limit a box is still taken: slack for a model that rounds. */
const BOX_SLACK = 0.05
/**
 * The most characters an idea keeps. The real ideas of a first run were 158 to 198 characters, and the end of an
 * idea is where the word it lands on is named, so the cut stands well clear of them; the row shows as much of an
 * idea as its own styles let it.
 */
const IDEA_MAX = 400
/**
 * The most words a graphic is written for, the first of those said while it plays. A graphic lasts at most 6 s,
 * and inside a phrase speech runs at 4 to 5 words a second (a clip's average, with its pauses, is nearer 2.5), so
 * forty takes in every word of the longest one, with room: the last word its idea lands on is among them.
 */
const WORDS_MAX = 40
/** How long a graphic stays after the last word its idea lands on is said: half a second to read what landed, and the way out. */
const AFTER_LAST_WORD_S = 1

/**
 * A box Claude answered, as it was given, when it is inside the frame and within the limits with their slack. A
 * box written at a limit comes out a hair past it in floating point (0.725 − 0.275 is 0.44999999999999996), and
 * is still within it.
 */
function boxOf(answer: number[]): GraphicBox | null {
  if (answer.length !== 4) return null
  const [x0, y0, x1, y1] = answer as [number, number, number, number]
  const inside = x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1
  const width = x1 - x0
  const height = y1 - y0
  // a box written the wrong way round has a width or a height below nothing, and is too small
  const fits = width >= BOX.minWidth - BOX_SLACK - 1e-9 && height >= BOX.minHeight - BOX_SLACK - 1e-9 && height <= BOX.maxHeight + BOX_SLACK + 1e-9
  return inside && fits ? { x0, y0, x1, y1 } : null
}

/** Seconds to the millisecond, so that a time that has not really moved gives the same number, and the same render, every time. */
const toMillisecond = (seconds: number) => Math.round(seconds * 1000) / 1000

/** When a word is said, in seconds from the word a graphic starts at, on the rough cut. */
const secondsFrom = (start: { timelineUs: number }, word: { timelineUs: number }) => toMillisecond((word.timelineUs - start.timelineUs) / 1_000_000)

/**
 * Which word of a sentence a graphic anchored at `fromSourceUs` starts at: the one that starts there (the first, of
 * two that do), or, when none starts exactly there, the last one that starts before it, or the sentence's first
 * word when none does.
 */
function startIndex(sentence: GraphicSentence, fromSourceUs: number): number {
  const exact = sentence.words.findIndex((word) => word.startUs === fromSourceUs)
  return exact >= 0 ? exact : Math.max(0, sentence.words.findLastIndex((word) => word.startUs <= fromSourceUs))
}

/**
 * The words a motion graphic is written for: those of the sentence said from the word that starts at `fromSourceUs`
 * on, within `seconds` of it on the rough cut, the first forty, each with its seconds from that start.
 *
 * The start is the word `startIndex` finds. A word's seconds are counted on the rough cut and rounded to the
 * millisecond. A word said as the graphic ends is out, as is one the cut plays before the start. Planning a
 * graphic and placing it later both come here, so the two cannot disagree about which words a graphic has.
 */
export function motionWords(sentence: GraphicSentence, fromSourceUs: number, seconds: number): MotionWord[] {
  const from = startIndex(sentence, fromSourceUs)
  const start = sentence.words[from]
  if (start === undefined) return []
  return sentence.words
    .slice(from)
    .map((word) => ({ text: word.text, atS: secondsFrom(start, word) }))
    .filter((word) => word.atS >= 0 && word.atS < seconds)
    .slice(0, WORDS_MAX)
}

/**
 * When the last word a graphic's idea lands on is said, in seconds from the word the graphic starts at, counted
 * as `motionWords` counts a word's; null when the sentence does not say it from that word on, as one with no
 * words (a scene point's) never does. It is looked for as the graphic's own word is (`findWord`), from that word
 * on, so a word said twice is its first saying from there, and one said only before it is not found.
 */
function lastWordAt(start: NonNullable<ReturnType<typeof startOf>>, until: string): number | null {
  const { said, sentence, fromChar } = start.scope
  const hit = findWord(said, until, fromChar)
  const first = sentence.words[startIndex(sentence, start.sourceUs)]
  return hit === null || first === undefined ? null : secondsFrom(first, wordAt(said, sentence, hit.start))
}

/**
 * Where a motion graphic on a point starts: as `startOf` has it, but for a word the sentence says more than once.
 * `startOf` takes the first saying, and the prompt asks for a word a little before the key word, which is often a
 * common one, so the first saying may be seconds before the point. Of the places the word is said, this takes the
 * one that starts nearest the point's own moment, the earlier of two as near; a last word is then looked for from
 * there on. The places are of the kind `findWord` prefers: the sayings of the word on its own, or, when there is
 * none, the longer words that hold it.
 */
function startNear(point: GraphicPoint, word: string): ReturnType<typeof startOf> {
  const start = startOf(point, word)
  if (start === null) return null
  const { said, sentence } = start.scope
  const first = findWord(said, word, 0)
  if (first === null) return start
  const edge = (i: number) => i === 0 || i === said.said.length || said.owner[i - 1] !== said.owner[i]
  const onItsOwn = (hit: typeof first) => edge(hit.start) && edge(hit.end)
  const own = "sourceUs" in point.anchor ? point.anchor.sourceUs : 0
  const away = (hit: typeof first) => Math.abs(wordAt(said, sentence, hit.start).startUs - own)
  let nearest = first
  // every later saying of the same kind: once the sayings of the word on its own run out, what is found is inside a longer word
  for (let hit = findWord(said, word, first.start + 1); hit !== null && onItsOwn(hit) === onItsOwn(first); hit = findWord(said, word, hit.start + 1)) {
    if (away(hit) < away(nearest)) nearest = hit
  }
  const at = wordAt(said, sentence, nearest.start)
  return { sourceUs: at.startUs, scope: { ...start.scope, fromChar: nearest.start } }
}

/**
 * Turns Claude's reply into cues on the points it was shown, each a motion graphic still to be written (`html` is
 * null). An answer is dropped, and counted, when its point or its box does not resolve, it has no idea, its
 * point's sentence has no words to start it from, or its point is already filled or is one of `taken` (point
 * numbers from 1: the points that carry a graphic of the user's). So is one that starts where an earlier answer
 * of the reply starts, on the same word of the same video in the same beat, as the answers of two points of one
 * sentence may: a graphic is known by the place it starts at, so a place takes one. A box is kept as it was
 * given. A word the point's sentence does not say only moves the graphic to the point's own first word, and one
 * it says twice starts it at the saying nearest the point (`startNear`); a scene point, which has no sentence,
 * takes a graphic at its own moment, with no words. Claude plans without the words' times, so it cannot tell how
 * long a graphic must last to reach the word its idea lands on: it names that word (`until`), and the seconds are
 * the larger of those it asked for, 3 when it gives no number, and that word's time and a second more; then they
 * are held to 1.5–6 and rounded to the millisecond. The idea is made one line and cut to 400 characters by whole
 * letters. Every graphic carries its point's id. Whether a point's frame was attached changes nothing here: a
 * motion graphic points at nothing in the picture.
 */
export function acceptMotionPlan(reply: MotionPlanReply, points: GraphicPoint[], taken: Set<number> = new Set()): { graphics: GraphicCue[]; dropped: number } {
  const graphics: GraphicCue[] = []
  const filled = new Set<number>()
  /** where the answers taken so far start: the video, the beat and the moment of the source */
  const started = new Set<string>()
  let dropped = 0
  // a stand-in for Claude in a test may answer with no list at all
  for (const answer of reply.graphics ?? []) {
    const point = points[answer.point - 1]
    const box = boxOf(answer.box)
    // made one line and cut here, where it is stored: it is one line of the writing call's brief and the summary of the row. A cut may land just after a space
    const idea = clipText(answer.idea.replace(/\s+/g, " ").trim(), IDEA_MAX).trimEnd()
    const start = point ? startNear(point, answer.word) : null
    const place = point && start ? JSON.stringify([point.videoId, point.beatId, start.sourceUs]) : null
    if (!point || !box || !idea || !start || place === null || filled.has(answer.point) || taken.has(answer.point) || started.has(place)) {
      dropped++
      continue
    }
    const asked = Number.isFinite(answer.seconds) ? answer.seconds : 3
    // an answer that never went through the schema, as a stand-in for Claude in a test may give, has no last word at all
    const landsAt = lastWordAt(start, answer.until ?? "")
    const wanted = landsAt === null ? asked : Math.max(asked, landsAt + AFTER_LAST_WORD_S)
    // to the millisecond, whatever it came from: 1.235 s and a second more is 2.2350000000000003 as it stands, and the length is written into the page and is part of the render's hash
    const seconds = toMillisecond(Math.min(GRAPHIC_MAX_S, Math.max(GRAPHIC_MIN_US / 1_000_000, wanted)))
    const anchor: CueAnchor = { kind: "speech", videoId: point.videoId, sourceUs: start.sourceUs, beatId: point.beatId }
    const words = point.sentence ? motionWords(point.sentence, start.sourceUs, seconds) : []
    filled.add(answer.point)
    started.add(place)
    graphics.push({ anchor, spec: { kind: "motion", version: MOTION_VERSION, box, seconds, why: answer.why.trim(), idea, words, html: null }, edited: false, off: false, pointId: point.pointId })
  }
  return { graphics, dropped }
}

/** The request text: the points as every request for graphics on them lists them, and the note on the frames, which show Claude where the free room is. */
const describe = (args: Parameters<typeof describePoints>[0]): string => [...describePoints(args), "", "เฟรมของบางจุดแนบท้ายตามเลขจุด ดูภาพเองก่อนวางกรอบ"].join("\n")

/** Asks Claude which points a motion graphic would help, and what each one draws; no call when there is no point Claude may use. */
export async function planMotion(args: {
  transport: LlmTransport
  model: string
  brief: Brief
  points: GraphicPoint[]
  canvas: { width: number; height: number }
  /** the top of the subtitle area, as a share of the frame height; null or omitted when captions are off */
  captionsFromY?: number | null
  /** one JPEG per point, keyed by `frameKey`; several points may share a path when they play the same scene */
  frames: Record<string, string>
  /** the graphics the user put or changed by hand, which stay as they are and keep Claude off their points */
  existing?: ExistingGraphic[]
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ graphics: GraphicCue[]; dropped: number }> {
  const existing = args.existing ?? []
  const taken = new Set(existing.map((graphic) => graphic.point))
  // nothing to place: no point, or every one already the user's
  if (args.points.every((_, i) => taken.has(i + 1))) return { graphics: [], dropped: 0 }
  const attached: { pointNumbers: number[]; data: string }[] = []
  for (const { path, pointNumbers } of framesToAttach(args.points, args.frames, taken)) {
    // a frame that cannot be read is left out: its points are shown as having none
    const data = await readFile(path).then(
      (bytes) => bytes.toString("base64"),
      () => null,
    )
    if (data !== null) attached.push({ pointNumbers, data })
  }
  const framed = new Set<number>(attached.flatMap((entry) => entry.pointNumbers))
  const content: LlmContent[] = [{ type: "text", text: describe({ brief: args.brief, points: args.points, canvas: args.canvas, captionsFromY: args.captionsFromY, framed, existing }) }]
  for (const { pointNumbers, data } of attached) {
    content.push({ type: "text", text: `เฟรมของจุด ${pointNumbers.join(", ")}` })
    content.push({ type: "image", mediaType: "image/jpeg", data })
  }
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? MOTION_PLAN_PROMPT).system,
    content,
    schema: MotionPlanReplySchema,
    // every point of a long clip may get a graphic, each with an idea of a sentence or two
    maxTokens: 16_000,
    signal: args.signal,
  })
  return acceptMotionPlan(reply.output, args.points, taken)
}
