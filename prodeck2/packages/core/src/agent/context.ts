import type { LlmContent } from "../llm/types.ts"

/** One word as it plays on the rough cut. */
export interface AgentWord {
  text: string
  atUs: number
}

/** What does not change while the user and Claude talk about one clip: it goes first, so it is cached. */
export interface AgentFootage {
  title: string
  summary: string
  /** the outline's beats, in playing order, with where each starts on the rough cut */
  beats: { name: string; purpose: string; startUs: number }[]
  words: AgentWord[]
  /** the sound library's names Claude may pick from */
  sounds: string[]
  /** the brief's video type and instructions, as the user gave them */
  brief: { videoType: string | null; instructions: string }
}

/** One entry of the conversation, oldest first. */
export type AgentTurn =
  | { role: "user"; text: string }
  | { role: "claude"; say: string; actions: string[] }
  | { role: "results"; lines: string[] }

/** How many characters of past conversation a request carries; older turns are dropped first. */
export const HISTORY_BUDGET = 24_000

const sec = (us: number) => (us / 1_000_000).toFixed(2)

/** The footage block: the outline, the beats, every word numbered with its time, the sounds. Exported for tests. */
export function describeFootage(footage: AgentFootage): string {
  return [
    "โครงเรื่อง",
    `- ชื่อเรื่อง: ${footage.title || "ไม่มี"}`,
    `- เรื่องย่อ: ${footage.summary || "ไม่มี"}`,
    `- ประเภทวิดีโอ: ${footage.brief.videoType ?? "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติมของผู้ใช้: ${footage.brief.instructions.trim() || "ไม่มี"}`,
    "",
    "บีต",
    ...(footage.beats.length ? footage.beats.map((beat, i) => `${i + 1}. ${sec(beat.startUs)}s ${beat.name}: ${beat.purpose || "-"}`) : ["ไม่มี"]),
    "",
    "คำพูด (เลขคำ เวลาเป็นวินาทีบนคลิปที่ตัดแล้ว)",
    ...(footage.words.length ? [footage.words.map((word, i) => `w${i + 1}@${sec(word.atUs)} ${word.text}`).join(" · ")] : ["ไม่มีคำพูด"]),
    "",
    "เสียงในคลัง",
    footage.sounds.length ? footage.sounds.join(" · ") : "ไม่มี",
  ].join("\n")
}

function turnText(turn: AgentTurn): string {
  switch (turn.role) {
    case "user":
      return `ผู้ใช้: ${turn.text}`
    case "claude":
      return [`คุณตอบ: ${turn.say || "(ไม่ได้พูด)"}`, ...turn.actions.map((action) => `  สั่ง ${action}`)].join("\n")
    case "results":
      return ["ผลของคำสั่ง:", ...turn.lines.map((line) => `  ${line}`)].join("\n")
  }
}

/** The conversation within `budget` characters: the newest turns whole, and a line saying how many older ones were left out. */
export function historyText(turns: AgentTurn[], budget = HISTORY_BUDGET): string {
  const kept: string[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const text = turnText(turns[i]!)
    if (used + text.length > budget && kept.length > 0) {
      kept.unshift(`(ข้อความก่อนหน้านี้อีก ${i + 1} รายการไม่ได้แสดง)`)
      break
    }
    kept.unshift(text)
    used += text.length
  }
  return kept.join("\n\n")
}

/**
 * The content of one round's request, in the order that keeps the cache: the footage (the same for the whole
 * session, marked for caching), the conversation so far, then the timeline as it is now and what is asked of this
 * round last, since those change every round.
 */
export function agentRequest(args: { footage: AgentFootage; turns: AgentTurn[]; timeline: string; ask?: string }): LlmContent[] {
  return [
    { type: "text", text: describeFootage(args.footage), cache: true },
    { type: "text", text: `การคุยที่ผ่านมา\n\n${historyText(args.turns) || "ยังไม่มี"}` },
    { type: "text", text: `ไทม์ไลน์ตอนนี้\n${args.timeline}` },
    { type: "text", text: args.ask ?? "ทำงานรอบนี้ต่อ" },
  ]
}
