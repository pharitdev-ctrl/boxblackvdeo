import { z } from "zod"
import { TONES, type Tone } from "../flair/plan.ts"
import { EASES, type Pose } from "../flair/moves.ts"

export const ACTION_TYPES = ["set_direction", "add_text", "add_move", "add_graphic", "add_sound", "edit_piece", "remove_piece", "ask_user"] as const
export type ActionType = (typeof ACTION_TYPES)[number]
export const LOUDNESSES = ["soft", "normal", "strong"] as const
export type Loudness = (typeof LOUDNESSES)[number]

/** The most actions one round may carry, and the most poses one move may have (as the techniques work allows). */
export const MOST_ACTIONS = 20
export const MOST_POSES = 12
/** How long a graphic and a sound may be, in seconds. */
export const GRAPHIC_SECONDS = { min: 0.3, max: 8 } as const
export const SOUND_SECONDS = { min: 0.2, max: 6 } as const

const PoseSchema = z.object({
  s: z.number(),
  scale: z.number(),
  x: z.number().default(0),
  y: z.number().default(0),
  rot: z.number().default(0),
  ease: z.enum(EASES).default("line"),
})

/**
 * One action as Claude answers it: a flat object whose `type` says which fields it uses; every other field is null.
 * Flat and without bounds in the schema, since structured outputs take few JSON Schema keywords: `parseAction`
 * checks the fields each type needs and their ranges, and says what is wrong in Thai.
 */
const RawActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  id: z.string().nullable().default(null),
  text: z.string().nullable().default(null),
  fromWord: z.number().int().nullable().default(null),
  toWord: z.number().int().nullable().default(null),
  atWord: z.number().int().nullable().default(null),
  atS: z.number().nullable().default(null),
  seconds: z.number().nullable().default(null),
  lines: z.array(z.string()).nullable().default(null),
  tone: z.enum(TONES).nullable().default(null),
  poses: z.array(PoseSchema).nullable().default(null),
  box: z.array(z.number()).nullable().default(null),
  idea: z.string().nullable().default(null),
  about: z.string().nullable().default(null),
  pick: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  loudness: z.enum(LOUDNESSES).nullable().default(null),
})
export type RawAction = z.infer<typeof RawActionSchema>

/** One round's answer: what Claude says to the user, the actions in the order to carry them out, and whether it is finished. */
export const AgentReplySchema = z.object({
  say: z.string().default(""),
  actions: z.array(RawActionSchema),
  done: z.boolean(),
})
export type AgentReply = z.infer<typeof AgentReplySchema>

/** Where a piece starts: on a word of the list (its number from 1), or at a time on the rough cut. */
export type At = { word: number } | { s: number }

export type Action =
  | { type: "set_direction"; text: string }
  | { type: "add_text"; fromWord: number; toWord: number; lines: string[]; tone: Tone | null }
  | { type: "add_move"; at: At; poses: Pose[]; about: string }
  | { type: "add_graphic"; atS: number; seconds: number; box: [number, number, number, number]; idea: string }
  | { type: "add_sound"; atS: number; seconds: number; pick: string | null; role: string | null; loudness: Loudness }
  | { type: "edit_piece"; id: string; changes: Partial<Omit<RawAction, "type" | "id">> }
  | { type: "remove_piece"; id: string }
  | { type: "ask_user"; question: string }

export type Parsed = { ok: true; action: Action } | { ok: false; problem: string }

const finite = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value)
const words = (text: string | null) => (text ?? "").trim()

/**
 * An action Claude answered, checked for the fields its type needs and the ranges they must be in. Places in the clip
 * (a word that exists, a time inside the clip) are checked by the app when it carries the action out, since only it
 * knows the clip.
 */
export function parseAction(raw: RawAction): Parsed {
  const fail = (problem: string): Parsed => ({ ok: false, problem })
  switch (raw.type) {
    case "set_direction":
      return words(raw.text) ? { ok: true, action: { type: "set_direction", text: words(raw.text).slice(0, 1000) } } : fail("ต้องมี text")
    case "add_text": {
      const lines = (raw.lines ?? []).map((line) => line.trim()).filter((line) => line !== "")
      if (!finite(raw.fromWord) || !finite(raw.toWord)) return fail("ต้องมี fromWord และ toWord")
      if (raw.toWord < raw.fromWord) return fail("toWord ต้องไม่น้อยกว่า fromWord")
      if (lines.length < 1 || lines.length > 3) return fail("ข้อความเด่นมีได้ 1–3 บรรทัด")
      return { ok: true, action: { type: "add_text", fromWord: raw.fromWord, toWord: raw.toWord, lines, tone: raw.tone } }
    }
    case "add_move": {
      const at: At | null = finite(raw.atWord) ? { word: raw.atWord } : finite(raw.atS) ? { s: raw.atS } : null
      const poses = raw.poses ?? []
      if (!at) return fail("ต้องมี atWord หรือ atS")
      if (poses.length < 1 || poses.length > MOST_POSES) return fail(`การเคลื่อนภาพมีได้ 1–${MOST_POSES} ท่า`)
      if (poses.some((pose, i) => pose.s < 0 || (i > 0 && pose.s < poses[i - 1]!.s))) return fail("เวลา s ของท่าต้องเริ่มที่ 0 ขึ้นไปและเรียงจากน้อยไปมาก")
      return { ok: true, action: { type: "add_move", at, poses, about: words(raw.about) } }
    }
    case "add_graphic": {
      if (!finite(raw.atS) || !finite(raw.seconds)) return fail("ต้องมี atS และ seconds")
      if (raw.seconds < GRAPHIC_SECONDS.min || raw.seconds > GRAPHIC_SECONDS.max) return fail(`กราฟิกยาวได้ ${GRAPHIC_SECONDS.min}–${GRAPHIC_SECONDS.max} วินาที`)
      const box = raw.box ?? []
      if (box.length !== 4 || box.some((v) => !finite(v) || v < 0 || v > 1) || box[0]! >= box[2]! || box[1]! >= box[3]!) return fail("box ต้องเป็น [ซ้าย, บน, ขวา, ล่าง] ระหว่าง 0–1 และซ้าย<ขวา บน<ล่าง")
      if (!words(raw.idea)) return fail("ต้องมี idea")
      return { ok: true, action: { type: "add_graphic", atS: raw.atS, seconds: raw.seconds, box: box as [number, number, number, number], idea: words(raw.idea) } }
    }
    case "add_sound": {
      if (!finite(raw.atS)) return fail("ต้องมี atS")
      if (!words(raw.pick) && !words(raw.role)) return fail("ต้องมี pick (ชื่อเสียงในคลัง) หรือ role (เสียงที่จะแต่ง)")
      const seconds = finite(raw.seconds) ? raw.seconds : 1
      if (seconds < SOUND_SECONDS.min || seconds > SOUND_SECONDS.max) return fail(`เสียงยาวได้ ${SOUND_SECONDS.min}–${SOUND_SECONDS.max} วินาที`)
      return { ok: true, action: { type: "add_sound", atS: raw.atS, seconds, pick: words(raw.pick) || null, role: words(raw.role) || null, loudness: raw.loudness ?? "normal" } }
    }
    case "edit_piece": {
      if (!words(raw.id)) return fail("ต้องมี id ของชิ้นที่จะแก้")
      const { type: _type, id, ...rest } = raw
      const changes = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null)) as Partial<Omit<RawAction, "type" | "id">>
      if (Object.keys(changes).length === 0) return fail("ไม่ได้บอกว่าจะแก้อะไร")
      return { ok: true, action: { type: "edit_piece", id: id!.trim(), changes } }
    }
    case "remove_piece":
      return words(raw.id) ? { ok: true, action: { type: "remove_piece", id: words(raw.id) } } : fail("ต้องมี id ของชิ้นที่จะลบ")
    case "ask_user":
      return words(raw.text) ? { ok: true, action: { type: "ask_user", question: words(raw.text) } } : fail("ต้องมี text เป็นคำถาม")
  }
}

/** µs from Claude's seconds on the rough cut's clock, on whole milliseconds. */
export const secondsToUs = (s: number) => Math.round(s * 1000) * 1000

/** One action in a line, as the conversation history keeps it: its type and the fields it set. */
export function actionLabel(raw: RawAction): string {
  const { type, ...rest } = raw
  const set = Object.entries(rest)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
  return `${type} ${set.join(" ")}`.trim()
}
