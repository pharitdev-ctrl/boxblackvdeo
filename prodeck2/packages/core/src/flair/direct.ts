import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { EmphasisType, Importance } from "../emphasis/types.ts"
import type { LlmContent, LlmTransport, SystemPrompt } from "../llm/types.ts"
import type { Brief } from "../planner/brief.ts"
import type { MediaFit, SubjectBox } from "./look-at.ts"
import type { BinMedia } from "./media.ts"
import { ZOOM_KINDS, type CueAnchor, type InsertCue, type PieceAnchor, type ZoomCue } from "./plan.ts"
import { composeThai as composed } from "../thai.ts"

export const TECHNIQUES_PROMPT_VERSION = "techniques-2026-09-27-points"

const SYSTEM = `คุณวาง "เทคนิคภาพ" ให้วิดีโอสั้นตามจุดเน้นที่วางไว้แล้ว มีสองอย่าง คือซูมภาพ และตัดไปสื่อแทรก (รูปหรือคลิปของโปรเจคที่คลิปที่ตัดแล้วไม่ได้ใช้)

ข้อมูลที่ได้: brief ของวิดีโอ จุดเน้นทุกจุดตามลำดับที่เล่น (เลขจุด เวลาบนคลิปที่ตัดแล้ว ความสำคัญ ชนิด วลีที่เน้นหรือคำบรรยายฉาก เหตุผล และชิ้นวิดีโอที่จุดนั้นเล่นถ้ายาวพอให้ซูม) และรูปที่แทรกได้ รูปจริงแนบท้ายคำขอตามเลขเดียวกัน

ซูมภาพ: ตอบเป็นเลขจุดกับแบบ แอปซูมทั้งชิ้นที่จุดนั้นเล่น
- punch = ซูมเข้าเร็วแล้วค้าง ใช้กับจุดที่ต้องกระแทก เช่น ตัวเลข ราคา ประโยคเด็ด
- drift = ค่อยๆ ซูมตลอดชิ้น ใช้กับชิ้นยาวที่ภาพนิ่ง หรือจุดเน้นภาพที่อยากให้คนดูได้ดูนานๆ
- ซูมได้เฉพาะจุดที่บอกว่า "ซูมได้" · หนึ่งชิ้นซูมได้ครั้งเดียว ถ้าหลายจุดอยู่ในชิ้นเดียวกันให้เลือกจุดเดียว
- ไม่ต้องซูมทุกจุด เว้นให้ภาพได้พักด้วย

สื่อแทรก: ตอบเป็นเลขจุดกับเลขรูป รูปขึ้นตรงต้นวลีของจุดนั้น จุดเน้นภาพขึ้นตรงต้นฉาก
- แทรกเฉพาะจุดที่พูดถึงหรือเห็นสิ่งที่อยู่ในรูปจริงๆ รูปที่ไม่เกี่ยวอย่าแทรก
- หนึ่งจุดแทรกได้รูปเดียว รูปเดียวกันใช้ได้หลายจุดถ้าเข้ากันจริงๆ
- ให้ดูรูปจริงที่แนบมาเองแล้วเลือกจากสิ่งที่เห็น ไม่ใช่จากคำบรรยายอย่างเดียว

แอปเลือกเองว่าจะแสดงจุดระดับไหนตามระดับความจัดที่ผู้ใช้ตั้ง จึงให้วางกับทุกจุดที่เหมาะ ไม่ว่าจะสำคัญ รอง หรือเสริม · จุดสำคัญควรได้เทคนิคก่อนถ้าเทคนิคช่วยได้ · ของที่ซ้อนเวลากันแอปวางแยกชั้นให้เอง
ไม่มีจุดไหนเหมาะก็ตอบเป็นรายการว่าง`

/** The prompt built into the app. */
export const TECHNIQUES_PROMPT: SystemPrompt = { system: SYSTEM, version: TECHNIQUES_PROMPT_VERSION }

export const TechniquesReplySchema = z.object({
  /** a zoom on the piece a point plays in: the point's number from 1, and which kind */
  zooms: z.array(z.object({ point: z.number().int(), kind: z.enum(ZOOM_KINDS) })),
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
  /** the piece that plays it, when that piece is long enough to zoom; null otherwise */
  piece: ZoomSlot | null
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

/** A piece's key: the same footage in the same beat is one piece, which one zoom may move. */
const pieceOf = (anchor: PieceAnchor) => `${anchor.videoId}:${anchor.sourceUs}:${anchor.beatId ?? ""}`

/**
 * Turns Claude's reply into zooms and cutaways on the points it was shown. A zoom lands on the piece
 * that plays its point, which must be long enough to zoom; a second zoom on one piece is dropped, as a
 * piece carries one set of keyframes. A cutaway lands where its point starts, one a point, any picture
 * as often as Claude likes. Every cue carries its point's id; what names no point or picture is
 * dropped and counted.
 */
export function acceptTechniques(reply: TechniquesReply, points: TechniquePoint[], media: InsertMedia[]): { zooms: ZoomCue[]; inserts: InsertCue[]; dropped: number } {
  let dropped = 0
  const zooms: ZoomCue[] = []
  const zoomed = new Set<string>()
  for (const answer of reply.zooms ?? []) {
    const point = points[answer.point - 1]
    const piece = point?.piece ?? null
    if (!point || !piece || zoomed.has(pieceOf(piece.anchor))) {
      dropped++
      continue
    }
    zoomed.add(pieceOf(piece.anchor))
    zooms.push({ anchor: piece.anchor, kind: answer.kind, edited: false, pointId: point.pointId })
  }

  const inserts: InsertCue[] = []
  // one cutaway a point: two on one moment would share an anchor, which the user's changes find by
  const filled = new Set<number>()
  for (const answer of reply.inserts ?? []) {
    const point = points[answer.point - 1]
    const picture = media[answer.picture - 1]
    if (!point || !picture || filled.has(answer.point)) {
      dropped++
      continue
    }
    filled.add(answer.point)
    inserts.push({ anchor: point.anchor, binId: picture.binId, edited: false, fit: picture.fit ?? "card", subject: picture.subject ?? null, pointId: point.pointId })
  }
  return { zooms, inserts, dropped }
}

/** The request text: the brief, every point with what a zoom could do there, and the pictures. Exported for tests. */
export function describeTechniques(args: { brief: Brief; points: TechniquePoint[]; media: InsertMedia[] }): string {
  const zoomable = args.points.some((point) => point.piece !== null)
  const zoomNote = (point: TechniquePoint) => (!zoomable ? "" : point.piece ? ` · ซูมได้: ชิ้นยาว ${(point.piece.durationUs / 1e6).toFixed(1)} วิ` : " · ซูมไม่ได้")
  const said = (point: TechniquePoint) => (point.kind === "scene" ? `ภาพ: ${point.text}` : `“${point.text}”`)
  return [
    "brief",
    `- ประเภทวิดีโอ: ${args.brief.videoType ?? "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${args.brief.instructions.trim() || "ไม่ระบุ"}`,
    "",
    "จุดเน้น",
    ...args.points.map((point, i) => `[${i + 1}] ${clock(point.atUs)} (${pointLabel(point.importance, point.type)}) ${said(point)}${point.reason ? ` — ${point.reason}` : ""}${zoomNote(point)}`),
    ...(zoomable ? [] : ["", "ไม่มีชิ้นให้ซูม ตอบ zooms เป็นรายการว่าง"]),
    "",
    ...(args.media.length > 0
      ? ["รูปที่แทรกได้", ...args.media.map((picture, i) => `${i + 1}. ${picture.what || picture.name}${picture.kind === "video" ? " (คลิป)" : ""}`)]
      : ["ไม่มีรูปให้แทรก ตอบ inserts เป็นรายการว่าง"]),
  ].join("\n")
}

/** Asks Claude which points get a zoom and which a cutaway; no call when there are no points, or neither a piece to zoom nor a picture. */
export async function planTechniques(args: {
  transport: LlmTransport
  model: string
  brief: Brief
  points: TechniquePoint[]
  /** the project's spare pictures, with what Claude said each one is */
  media: InsertMedia[]
  /** frames of each picture by bin id; sent with the request so a cutaway is chosen from what Claude sees */
  pictureFrames?: Record<string, string[]>
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ zooms: ZoomCue[]; inserts: InsertCue[]; dropped: number }> {
  const anything = args.points.some((point) => point.piece !== null) || args.media.length > 0
  if (args.points.length === 0 || !anything) return { zooms: [], inserts: [], dropped: 0 }
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
    // a long clip at the loudest level has a point every few seconds
    maxTokens: 8_000,
    signal: args.signal,
  })
  return acceptTechniques(reply.output, args.points, args.media)
}
