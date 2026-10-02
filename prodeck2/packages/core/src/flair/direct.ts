import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { EmphasisType, Importance } from "../emphasis/types.ts"
import type { LlmContent, LlmTransport, SystemPrompt } from "../llm/types.ts"
import type { Brief } from "../planner/brief.ts"
import type { MediaFit, SubjectBox } from "./look-at.ts"
import type { BinMedia } from "./media.ts"
import { FLAIR_LEVELS, type FlairLevel } from "./catalogue.ts"
import { EASES, MOVE_POSES_MAX, type Pose } from "./moves.ts"
import type { CueAnchor, InsertCue, PieceAnchor } from "./plan.ts"
import { band, boxText, clipText } from "../graphics/plan.ts"
import type { SceneObject } from "../vision/objects.ts"
import { composeThai as composed } from "../thai.ts"

export const TECHNIQUES_PROMPT_VERSION = "techniques-2026-10-02-moves"

const SYSTEM = `คุณวาง "เทคนิคภาพ" ให้วิดีโอสั้นตามจุดเน้นที่วางไว้แล้ว มีสองอย่าง คือการเคลื่อนภาพ (ซูม) และตัดไปสื่อแทรก (รูปหรือคลิปของโปรเจคที่คลิปที่ตัดแล้วไม่ได้ใช้)

ข้อมูลที่ได้: brief ของวิดีโอ ระดับที่ผู้ใช้เลือก คำพูดทุกคำพร้อมเลขและเวลา จุดเน้นทุกจุดตามลำดับที่เล่น (เลขจุด เวลาบนคลิปที่ตัดแล้ว ความสำคัญ ชนิด วลีที่เน้นหรือคำบรรยายฉาก เหตุผล) ชิ้นวิดีโอพร้อมเพดานซูม ฉากพร้อมของที่อยู่ในภาพและหน้าคน และรูปที่แทรกได้ รูปจริงแนบท้ายคำขอตามเลขเดียวกัน

การเคลื่อนภาพ (ซูม): คุณออกแบบการขยับของตัวคลิปวิดีโอเอง ตัวหนังสือ ซับ และกราฟิกไม่ขยับตาม
- ใส่ตรงคำไหนก็ได้ที่การเคลื่อนภาพช่วยเน้นหรือสร้างอารมณ์ เช่น กระแทกเข้าตรงคำสำคัญ ดันเข้าช้าๆ ตอนเล่า ถอยออกตอนเฉลย เด้งเข้าแล้วกลับตรงมุก หรือสลับใกล้ไกลตามคัต ไม่ต้องอยู่บนจุดเน้น ให้ภาพได้พักด้วย
- แต่ละท่อนเริ่มที่คำหนึ่งคำ (word) แล้วเป็นรายการท่า (poses) ตามเวลา s วินาทีนับจากคำนั้น แต่ละท่ามี scale (1 = ขนาดเดิม) x และ y (เลื่อน หน่วยครึ่งจอ ขวาและขึ้นเป็นบวก) rot (องศา) และ ease = ความเร็วจากท่าก่อนหน้ามาท่านี้: line เท่ากันตลอด · in ค่อยๆ เร่ง · out ค่อยๆ ผ่อน · inOut ค่อยๆ เร่งแล้วผ่อน · cut เปลี่ยนทันที
- ท่อนจบตรงท่าสุดท้าย แล้วภาพค้างท่านั้นจนท่อนถัดไปหรือจบชิ้น ชิ้นใหม่เริ่มที่ขนาดเดิมเสมอ ท่อนไม่ข้ามคัต และสองท่อนในชิ้นเดียวกันห้ามซ้อนเวลา
- ความแรง: 108–120% ใช้บ่อย สูงกว่านั้นเฉพาะจุดพีค และห้ามเกิน "ซูมได้ไม่เกิน" ของชิ้นนั้น · หมุนไม่เกิน 5 องศา ใช้น้อยๆ
- ห้ามเห็นขอบภาพ: ยิ่งขยายน้อยยิ่งเลื่อนหรือหมุนได้น้อย ที่ขนาดเดิม (1.0) ห้ามเลื่อนห้ามหมุน
- ฉากที่มีหน้าคน หน้าต้องอยู่ในจอครบตลอด ใช้กรอบหน้าที่ให้มาคำนวณ ฉากที่ไม่มีหน้า ขยับได้อิสระ ของที่โชว์ขอแค่จุดกลางอยู่ในจอ
- สื่อแทรกขยับได้ด้วย: ตอบ insert = เลขของสื่อแทรกในคำตอบนี้ (นับจาก 1) แล้ว word เป็นคำที่สื่อแทรกนั้นขึ้น รูปนิ่งควรมีการเคลื่อน เช่น ค่อยๆ ดันหรือเลื่อนผ่าน
- ทุกท่อนบอก from = ระดับต่ำสุดที่เล่น light เฉพาะช่วงสำคัญที่สุด · medium เพิ่มช่วงที่ช่วยเสริมชัด · heavy ใส่เต็มที่ ใส่ให้ระดับที่ผู้ใช้เลือกเต็มอย่างน้อยเท่าที่ระดับนั้นขอ
- point = เลขจุดเน้นที่ท่อนนี้เกี่ยว (0 = ไม่เกี่ยว) · about = หนึ่งบรรทัดภาษาไทยว่าท่อนนี้ทำอะไร เช่น "ดันเข้าช้าๆ แล้วกระแทกตรงคำว่า 990"
- ไม่เกิน 12 ท่าต่อท่อน

สื่อแทรก: ตอบเป็นเลขจุดกับเลขรูป รูปขึ้นตรงต้นวลีของจุดนั้น จุดเน้นภาพขึ้นตรงต้นฉาก
- แทรกเฉพาะจุดที่พูดถึงหรือเห็นสิ่งที่อยู่ในรูปจริงๆ รูปที่ไม่เกี่ยวอย่าแทรก
- หนึ่งจุดแทรกได้รูปเดียว รูปเดียวกันใช้ได้หลายจุดถ้าเข้ากันจริงๆ
- ให้ดูรูปจริงที่แนบมาเองแล้วเลือกจากสิ่งที่เห็น ไม่ใช่จากคำบรรยายอย่างเดียว

แอปเลือกเองว่าจะแสดงจุดระดับไหนตามระดับความจัดที่ผู้ใช้ตั้ง จึงให้วางกับทุกจุดที่เหมาะ ไม่ว่าจะสำคัญ รอง หรือเสริม · จุดสำคัญควรได้เทคนิคก่อนถ้าเทคนิคช่วยได้ · ของที่ซ้อนเวลากันแอปวางแยกชั้นให้เอง
ไม่มีจุดไหนเหมาะก็ตอบเป็นรายการว่าง`

/** The prompt built into the app. */
export const TECHNIQUES_PROMPT: SystemPrompt = { system: SYSTEM, version: TECHNIQUES_PROMPT_VERSION }

export const TechniquesReplySchema = z.object({
  /**
   * a move of the picture: the word it starts on, the cutaway it moves (its number in this reply's inserts, 0 for
   * the footage) and the point it belongs to (0 for none), all from 1, then its poses in time from that word
   */
  moves: z.array(
    z.object({
      word: z.number().int(),
      insert: z.number().int().default(0),
      point: z.number().int().default(0),
      from: z.enum(FLAIR_LEVELS),
      about: z.string().default(""),
      poses: z.array(z.object({ s: z.number(), scale: z.number(), x: z.number().default(0), y: z.number().default(0), rot: z.number().default(0), ease: z.enum(EASES).default("line") })),
    }),
  ),
  /** a cutaway at a point: the point's number and the picture's number, both from 1 */
  inserts: z.array(z.object({ point: z.number().int(), picture: z.number().int() })),
})
export type TechniquesReply = z.infer<typeof TechniquesReplySchema>

/** A place a sound can go, as Claude is shown it. */
export interface CueSlot {
  anchor: CueAnchor
  /** where it plays on the rough cut */
  atUs: number
  /** what is there, in the user's language: a line of text, a graphic, a cutaway, a punch, a point nothing sits on, a join, a beat's edge */
  what: string
  /** the beat it sits in, so the screen can show it with that beat */
  beatId: string
}

/** A spoken sentence of the rough cut with its words: what a graphic's words are found and timed in (GraphicSentence builds on it). */
export interface SpeechSlot {
  videoId: string
  beatId: string
  /** where it starts on the rough cut */
  atUs: number
  text: string
  /** its words with their source times, so an answer's word becomes a time */
  words: { text: string; startUs: number }[]
}

/** One of the project's spare pictures, with what Claude said it is. */
export interface InsertMedia extends BinMedia {
  /** what the picture shows, when it has been looked at */
  what?: string
  /** where the subject sits inside it, for a cover that crops to it */
  subject?: SubjectBox | null
  /** how it should be framed on the video */
  fit?: MediaFit
}

/** A piece of the rough cut a zoom could go on, as Claude is shown it. */
export interface ZoomSlot {
  anchor: PieceAnchor
  /** where the piece starts on the rough cut */
  atUs: number
  durationUs: number
  /** what plays there, in the user's language */
  what: string
  /** the beat it sits in, so the screen can show it with that beat */
  beatId: string
}

/** A point as Claude is shown it for zooms and cutaways. */
export interface TechniquePoint {
  pointId: string
  kind: "speech" | "scene"
  importance: Importance
  type: EmphasisType
  reason: string
  videoId: string
  beatId: string
  /** where it starts on the rough cut */
  atUs: number
  /** where a cutaway on it starts: the phrase's first kept word, or the scene's first kept moment (a "speech" anchor) */
  anchor: CueAnchor
  /** the phrase, or the scene's description */
  text: string
  /** the piece that plays it, when that piece is long enough to zoom; null otherwise. No longer shown to Claude */
  piece: ZoomSlot | null
}

/** A scene on the cut as the techniques call is shown it, as the free plan shows it. */
export interface TechniqueScene {
  startUs: number
  endUs: number
  kind: string
  description: string
  keepClear: { fromY: number; toY: number } | null
  /** the things the objects pass found in it, faces marked, or null when the pass has not been run for its video */
  objects: SceneObject[] | null
}

/** The clip as the techniques call is shown it, every time on the rough cut and every list in the order it plays. */
export interface TechniqueClip {
  brief: Brief
  /** the level of decoration the user chose */
  level: FlairLevel
  /** every word spoken, with when it starts; a move starts on one */
  words: { text: string; atUs: number }[]
  points: TechniquePoint[]
  /** the pieces of footage, each with the most it may be zoomed for its video's resolution */
  pieces: { atUs: number; durationUs: number; video: string; cap: number }[]
  scenes: TechniqueScene[]
  /** the project's spare pictures, with what Claude said each one is */
  media: InsertMedia[]
}

/** A move as Claude answered it, before main places it on a piece. */
export interface PlannedMove {
  /** the word it starts on: an index from 0 into the clip's words */
  word: number
  /** for a move on a cutaway, the index from 0 into the `inserts` this same call returns; null on the main footage */
  insert: number | null
  from: FlairLevel
  pointId?: string
  about: string
  poses: Pose[]
}

/** Where a word sits in its line, counted in code points, or null when the line does not say it. */
export function findWord(line: string, word: string): { from: number; to: number } | null {
  const wanted = composed(word.trim())
  if (!wanted) return null
  const text = composed(line)
  const at = text.indexOf(wanted)
  if (at < 0) return null
  // indexOf counts UTF-16 units; CapCut counts characters, so convert
  const from = [...text.slice(0, at)].length
  return { from, to: from + [...wanted].length }
}

/** The word an accent colours in its line, counted in code points the way `findWord` counts them. */
export function wordAt(line: string, from: number, to: number): string {
  return [...composed(line)].slice(from, to).join("")
}

/** A source or timeline time as Claude is shown it: minutes, seconds, tenths. Shared by every prompt that lists moments in the clip. */
export const clock = (us: number) => {
  const tenths = Math.round(us / 100_000)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`
}

const IMPORTANCE_NAMES: Record<Importance, string> = { key: "สำคัญ", secondary: "รอง", extra: "เสริม" }
const TYPE_NAMES: Record<EmphasisType, string> = { hook: "hook", number: "ตัวเลข/ราคา", product: "ของ", action: "การกระทำ", emotion: "อารมณ์", place: "สถานที่", visual: "ภาพสวย" }

/** A point's importance and type as every prompt that lists points shows them, in Thai: "สำคัญ · ตัวเลข/ราคา". */
export const pointLabel = (importance: Importance, type: EmphasisType): string => `${IMPORTANCE_NAMES[importance]} · ${TYPE_NAMES[type]}`

/** The most characters a move's about keeps: one line in the move's row. */
const ABOUT_MAX = 200

/** Whether each pose comes strictly after the one before it: two at one moment are not in order. */
const inOrder = (poses: Pose[]) => poses.every((pose, i) => i === 0 || pose.s > poses[i - 1]!.s)

/**
 * Turns Claude's reply into moves and cutaways. A cutaway lands where its point starts, one a point, any picture
 * as often as Claude likes; what names no point or picture is dropped and counted. A move starts on a word, and
 * is dropped and counted when the word names nothing; when it names a cutaway by a number this reply's kept
 * cutaways do not have; when its about, made one line and cut to 200 characters, is empty; when its poses are
 * none, more than MOVE_POSES_MAX or not in time order; or when an earlier move kept is on the same word of the
 * footage, or on the same cutaway. A point that names nothing becomes none and the move stays. The poses keep
 * Claude's numbers: whether the frame allows them is main's to check, against each piece.
 */
export function acceptTechniques(reply: TechniquesReply, clip: Pick<TechniqueClip, "words" | "points" | "media">): { moves: PlannedMove[]; inserts: InsertCue[]; dropped: number } {
  const { points, media } = clip
  let dropped = 0
  const inserts: InsertCue[] = []
  /** where each cutaway answered, by its index in the reply, sits in the kept ones */
  const keptAt = new Map<number, number>()
  // one cutaway a point: two on one moment would share an anchor, which the user's changes find by
  const filled = new Set<number>()
  for (const [index, answer] of (reply.inserts ?? []).entries()) {
    const point = points[answer.point - 1]
    const picture = media[answer.picture - 1]
    if (!point || !picture || filled.has(answer.point)) {
      dropped++
      continue
    }
    filled.add(answer.point)
    keptAt.set(index, inserts.length)
    inserts.push({ anchor: point.anchor, binId: picture.binId, edited: false, fit: picture.fit ?? "card", subject: picture.subject ?? null, pointId: point.pointId })
  }

  const moves: PlannedMove[] = []
  const wordsTaken = new Set<number>()
  const insertsTaken = new Set<number>()
  // a stand-in for Claude in a test may answer with no list at all, and moves without the schema's defaults
  for (const answer of reply.moves ?? []) {
    const word = answer.word - 1
    const insert = (answer.insert ?? 0) === 0 ? null : (keptAt.get(answer.insert - 1) ?? -1)
    const about = clipText((answer.about ?? "").replace(/\s+/g, " ").trim(), ABOUT_MAX).trimEnd()
    const poses: Pose[] = (answer.poses ?? []).map((pose) => ({ s: pose.s, scale: pose.scale, x: pose.x ?? 0, y: pose.y ?? 0, rot: pose.rot ?? 0, ease: pose.ease ?? "line" }))
    const taken = insert === null ? wordsTaken.has(word) : insertsTaken.has(insert)
    if (clip.words[word] === undefined || insert === -1 || !about || poses.length === 0 || poses.length > MOVE_POSES_MAX || !inOrder(poses) || taken) {
      dropped++
      continue
    }
    if (insert === null) wordsTaken.add(word)
    else insertsTaken.add(insert)
    const point = points[(answer.point ?? 0) - 1]
    moves.push({ word, insert, from: answer.from, ...(point ? { pointId: point.pointId } : {}), about, poses })
  }
  return { moves, inserts, dropped }
}

/**
 * The request text: the brief and the level, then every list under its heading, one line to an item with its
 * times on the rough cut (`clock`). Words and points are numbered from 1, as the answer names them; a piece
 * says how far it may be zoomed; a scene has a second line with the things in it, a face marked `หน้า`, as
 * the free plan shows them. A list with nothing in it says so on its heading's line. Exported for tests.
 */
export function describeTechniques(clip: TechniqueClip): string {
  const list = <T>(heading: string, items: T[], line: (item: T, i: number) => string[]) => (items.length === 0 ? [`${heading} ไม่มี`] : [heading, ...items.flatMap(line)])
  const things = (objects: SceneObject[] | null) =>
    objects === null ? "ไม่ได้จด" : objects.map((object) => `${object.kind}${object.face ? " หน้า" : ""} “${object.what}” ${boxText(object.box)}${object.still ? " นิ่ง" : ""}`).join(" · ") || "ไม่มี"
  const said = (point: TechniquePoint) => (point.kind === "scene" ? `ภาพ: ${point.text}` : `“${point.text}”`)
  return [
    "brief",
    `- ประเภทวิดีโอ: ${clip.brief.videoType ?? "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${clip.brief.instructions.trim() || "ไม่ระบุ"}`,
    "",
    `ระดับที่ผู้ใช้เลือก: ${clip.level}`,
    "",
    ...list("คำพูด", clip.words, (word, i) => [`${i + 1}. ${clock(word.atUs)} ${word.text}`]),
    "",
    ...list("จุดเน้น", clip.points, (point, i) => [`[${i + 1}] ${clock(point.atUs)} (${pointLabel(point.importance, point.type)}) ${said(point)}${point.reason ? ` — ${point.reason}` : ""}`]),
    "",
    ...list("ชิ้นวิดีโอ", clip.pieces, (piece) => [`- ${clock(piece.atUs)}–${clock(piece.atUs + piece.durationUs)} ซูมได้ไม่เกิน ${Math.round(piece.cap * 100)}%`]),
    "",
    ...list("ฉาก", clip.scenes, (scene) => [
      `- ${clock(scene.startUs)}–${clock(scene.endUs)} ${scene.kind} · ${scene.description} · ${scene.keepClear ? `keepClear ${band(scene.keepClear.fromY, scene.keepClear.toY)}` : "keepClear ไม่มี"}`,
      `    ของ: ${things(scene.objects)}`,
    ]),
    "",
    ...list("รูปที่แทรกได้", clip.media, (picture, i) => [`${i + 1}. ${picture.what || picture.name}${picture.kind === "video" ? " (คลิป)" : ""}`]),
  ].join("\n")
}

/** Asks Claude for the picture's moves and the cutaways; no call when the clip has no word to start a move on and no picture. */
export async function planTechniques(
  args: TechniqueClip & {
    transport: LlmTransport
    model: string
    /** frames of each picture by bin id; sent with the request so a cutaway is chosen from what Claude sees */
    pictureFrames?: Record<string, string[]>
    prompt?: SystemPrompt
    signal?: AbortSignal
  },
): Promise<{ moves: PlannedMove[]; inserts: InsertCue[]; dropped: number }> {
  if (args.words.length === 0 && args.media.length === 0) return { moves: [], inserts: [], dropped: 0 }
  const content: LlmContent[] = [{ type: "text", text: describeTechniques(args) }]
  // the pictures themselves, so a cutaway is placed by what is in them rather than by their description
  for (const [index, picture] of args.media.entries()) {
    const paths = args.pictureFrames?.[picture.binId] ?? []
    if (paths.length === 0) continue
    content.push({ type: "text", text: `รูปที่ ${index + 1}` })
    for (const path of paths) content.push({ type: "image", data: (await readFile(path)).toString("base64"), mediaType: "image/jpeg" })
  }
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? TECHNIQUES_PROMPT).system,
    content,
    schema: TechniquesReplySchema,
    // a long clip at the loudest level has a move every few words, each with its poses
    maxTokens: 16_000,
    signal: args.signal,
  })
  return acceptTechniques(reply.output, args)
}
