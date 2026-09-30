import type { EmphasisType, Importance } from "../../emphasis/types.ts"
import { clock, pointLabel, type SpeechSlot } from "../../flair/direct.ts"
import type { CueAnchor } from "../../flair/plan.ts"
import type { Brief } from "../../planner/brief.ts"
import { comparable } from "../../thai.ts"
import type { Scene } from "../../vision/describe.ts"

/** The spoken sentence a point's phrase is in, whose words anchor a graphic and are the words it is written for. */
export interface GraphicSentence extends SpeechSlot {
  /**
   * its words with their source times, which anchor a graphic, and where each plays on the rough cut,
   * which is the time a graphic is handed for it: the cut may take a pause out of the middle of a sentence,
   * so the two clocks drift apart after it
   */
  words: { text: string; startUs: number; timelineUs: number }[]
  /** where it stops playing on the rough cut, like `atUs` */
  timelineEndUs: number
  scene: Pick<Scene, "description" | "kind" | "keepClear"> | null
}

/** A point as Claude is shown it for graphics: what a graphic is asked on. */
export interface GraphicPoint {
  pointId: string
  kind: "speech" | "scene"
  importance: Importance
  type: EmphasisType
  reason: string
  videoId: string
  beatId: string
  /** where it starts and stops on the rough cut */
  atUs: number
  timelineEndUs: number
  /** where a graphic on it starts when Claude names no word it can find: the phrase's first kept word, or the scene's first kept moment (a "speech" anchor) */
  anchor: CueAnchor
  /** the phrase, or the scene's description */
  text: string
  /** a speech point's sentence, whose words anchor the graphic and are those it is written for; null for a scene point */
  sentence: GraphicSentence | null
  /** the scene playing there (a scene point's own) */
  scene: Pick<Scene, "description" | "kind" | "keepClear"> | null
  /**
   * where the point's own highlight text sits, as shares of the frame height: the text of the groups made for
   * it, which a graphic put on it takes the place of, and no other point's; null when it has none
   */
  textBand: { fromY: number; toY: number } | null
}

/** Frames attached per request, capped here: each JPEG costs roughly 130–1,500 tokens, and past a dozen the bill outgrows the help. */
const MAX_FRAMES = 12

/** `said` is every word's comparable text joined with no gaps; `owner[i]` is the index into `sentence.words` that wrote the character at `said[i]`. Mirrors `findQuote` in `highlights/pick.ts`, but a graphic's words are already scoped to one sentence and carry their own time instead of an index into a shared array. */
function saidOf(sentence: SpeechSlot): { said: string; owner: number[] } {
  let said = ""
  const owner: number[] = []
  sentence.words.forEach((word, index) => {
    const text = comparable(word.text)
    said += text
    for (let i = 0; i < text.length; i++) owner.push(index)
  })
  return { said, owner }
}

/** Where a word was found in `said`: its first character and the one just past its last. */
type Hit = { start: number; end: number }

/**
 * Where `word` is said, searched from `fromChar` on — so a word said twice resolves to the occurrence
 * inside the window rather than an earlier one outside it — or null when the sentence does not say it
 * there. Real transcripts split Thai far finer than Claude answers with (ASR's ICU segmentation turns
 * "หนึ่งล้าน" into the two tokens "หนึ่ง" and "ล้าน"), so this matches by substring across word
 * boundaries, the way `findQuote` does. A hit that starts and ends on the edges of the transcript's own
 * words wins over one inside a longer word, wherever that one is: otherwise "990" lands inside an
 * earlier "1,990", "25" inside "2025" and "ถูก" inside "ถูกใจ". Only a sentence that says the letters
 * no other way gets the hit inside a word.
 */
export function findWord(said: { said: string; owner: number[] }, word: string, fromChar: number): Hit | null {
  const wanted = comparable(word)
  if (!wanted) return null
  const edge = (i: number) => i === 0 || i === said.said.length || said.owner[i - 1] !== said.owner[i]
  let first: number | null = null
  for (let at = said.said.indexOf(wanted, fromChar); at >= 0; at = said.said.indexOf(wanted, at + 1)) {
    if (edge(at) && edge(at + wanted.length)) return { start: at, end: at + wanted.length }
    first ??= at
  }
  return first === null ? null : { start: first, end: first + wanted.length }
}

/** The word of the sentence that says the character at `charAt`. */
export const wordAt = (said: { said: string; owner: number[] }, sentence: GraphicSentence, charAt: number) => sentence.words[said.owner[charAt]!]!

/** Where a graphic's words are looked for: the sentence, and the graphic's own word as a place in it. */
interface Scope {
  said: { said: string; owner: number[] }
  sentence: GraphicSentence
  /** where the graphic's own word starts in `said`: a later word of its idea is looked for from here on */
  fromChar: number
}

/** What a graphic's words are looked for in when its point has no sentence: nothing, so no word is found. */
const NO_WORDS: { said: string; owner: number[] } = { said: "", owner: [] }

/** A sentence with no words, standing in for the one a scene point does not have. */
const wordless = (point: GraphicPoint): GraphicSentence => ({
  videoId: point.videoId,
  beatId: point.beatId,
  atUs: point.atUs,
  text: "",
  words: [],
  timelineEndUs: point.timelineEndUs,
  scene: point.scene,
})

/** A moment's source time; the point anchors the app builds are all moments of speech. */
const sourceOf = (anchor: CueAnchor): number => ("sourceUs" in anchor ? anchor.sourceUs : 0)

/**
 * Where a graphic on a point starts, and where a later word of its idea is looked for from. On a
 * speech point: the word Claude named, found anywhere in the point's sentence, else the point's own
 * first word, which is the last word of the sentence said at or before the point's anchor; null when
 * the sentence has no words. On a scene point (no sentence): the point's own moment, with no words to
 * find.
 */
export function startOf(point: GraphicPoint, word: string): { sourceUs: number; scope: Scope } | null {
  const sentence = point.sentence
  if (sentence === null) return { sourceUs: sourceOf(point.anchor), scope: { said: NO_WORDS, sentence: wordless(point), fromChar: 0 } }
  const said = saidOf(sentence)
  const named = findWord(said, word, 0)
  const own = Math.max(0, sentence.words.findLastIndex((entry) => entry.startUs <= sourceOf(point.anchor)))
  const start = named === null ? sentence.words[own] : wordAt(said, sentence, named.start)
  if (start === undefined) return null
  // a later word is looked for from the graphic's own word on
  const fromChar = named?.start ?? Math.max(0, said.owner.indexOf(own))
  return { sourceUs: start.startUs, scope: { said, sentence, fromChar } }
}

/** The frame of the scene at a point is named by its video and the number of the point. */
export const frameKey = (point: { videoId: string }, index: number) => `${point.videoId}:${index + 1}`

/**
 * The frames worth attaching: grouped by path (several points may share a scene), each carrying every
 * point number (from 1) it belongs to. When there are more distinct paths than `MAX_FRAMES`, they are
 * spread evenly across the clip (index `Math.floor(i * n / MAX_FRAMES)` for `i` from 0 to
 * `MAX_FRAMES - 1`) rather than only the first `MAX_FRAMES` in clip order, so Claude sees where the free
 * room is late in a long clip too, not just near its start. Only points Claude may put a graphic on
 * are counted, not one in `taken` (point numbers from 1) that already carries the user's own, so no
 * frame is spent where no graphic can go. The caller uses this to know exactly which frames it is about
 * to send.
 */
export function framesToAttach(points: GraphicPoint[], frames: Record<string, string>, taken: Set<number> = new Set()): { path: string; pointNumbers: number[] }[] {
  const byPath = new Map<string, number[]>()
  points.forEach((point, index) => {
    const path = frames[frameKey(point, index)]
    if (!path || taken.has(index + 1)) return
    const list = byPath.get(path)
    if (list) list.push(index + 1)
    else byPath.set(path, [index + 1])
  })
  const all = [...byPath.entries()].map(([path, pointNumbers]) => ({ path, pointNumbers }))
  if (all.length <= MAX_FRAMES) return all
  return Array.from({ length: MAX_FRAMES }, (_, i) => all[Math.floor((i * all.length) / MAX_FRAMES)]!)
}

/** Whether two scenes are the same one still playing, worth saying once instead of repeating. */
function sameScene(a: NonNullable<GraphicPoint["scene"]>, b: NonNullable<GraphicPoint["scene"]>): boolean {
  const clearEqual = (a.keepClear === null && b.keepClear === null) || (a.keepClear !== null && b.keepClear !== null && a.keepClear.fromY === b.keepClear.fromY && a.keepClear.toY === b.keepClear.toY)
  return a.description === b.description && a.kind === b.kind && clearEqual
}

/** A graphic the user put or changed by hand: the point it sits on (from 1) and what it draws, its idea, in the user's language. */
export interface ExistingGraphic {
  point: number
  summary: string
  /** switched off by the user: it plays nothing, but its point is still theirs */
  off: boolean
}

/**
 * The lines every request for graphics on points opens with: the brief, which way the frame lies and where the
 * subtitles start, each point on two lines (when it plays and for how long, how much it matters, what is said or
 * seen, where its own highlight text sits, and the scene under it), and the graphics that are the user's own. `framed`
 * (point numbers from 1) are the points whose frame is attached.
 */
export function describePoints(args: {
  brief: Brief
  points: GraphicPoint[]
  canvas: { width: number; height: number }
  captionsFromY?: number | null
  framed: Set<number>
  existing: ExistingGraphic[]
}): string[] {
  const scene = (point: GraphicPoint, i: number) => {
    const previous = i > 0 ? args.points[i - 1] : undefined
    if (point.scene && previous?.scene && sameScene(point.scene, previous.scene)) return "ฉากเดียวกับจุดก่อน"
    if (!point.scene) return "ฉาก: ไม่มีข้อมูลภาพ"
    const clear = point.scene.keepClear ? `keepClear [${point.scene.keepClear.fromY}, ${point.scene.keepClear.toY}]` : "keepClear ไม่มี"
    return `ฉาก: ${point.scene.kind} · ${point.scene.description} · ${clear}`
  }
  const on = (point: GraphicPoint, i: number) =>
    [point.textBand ? `ข้อความเด่นของจุดนี้ [${point.textBand.fromY}, ${point.textBand.toY}]` : "", args.framed.has(i + 1) ? "มีเฟรม" : ""].filter(Boolean).join(" · ")
  // how long it plays on the rough cut, which a graphic's seconds are measured against; never less than nothing
  const lengthS = (point: GraphicPoint) => (Math.max(0, point.timelineEndUs - point.atUs) / 1_000_000).toFixed(1)
  // a speech point's phrase, with its sentence when that says more; a scene point's picture
  const said = (point: GraphicPoint) =>
    point.kind === "scene" ? `ภาพ: ${point.text}` : `“${point.text}”${point.sentence && point.sentence.text !== point.text ? ` ในประโยค “${point.sentence.text}”` : ""}`
  // "ซับ" is the app's own word for captions; "คำบรรยาย" is reserved for a scene's description
  const captionLine = args.captionsFromY == null ? "ไม่มีซับ" : `ซับเริ่มที่ y = ${args.captionsFromY} ห้ามทับ`
  const usersOwn = new Set(args.existing.map((graphic) => graphic.point))
  const taken = (i: number) => (usersOwn.has(i + 1) ? " (ผู้ใช้ใส่เองแล้ว ห้ามใส่ซ้ำ)" : "")
  const existingLines =
    args.existing.length === 0
      ? []
      : [
          "",
          "กราฟิกที่ผู้ใช้ใส่เอง (ผู้ใช้แก้เอง) แอปคงไว้ตามนั้น ห้ามใส่อันใหม่บนจุดเหล่านี้",
          ...args.existing.map((graphic) => `[${graphic.point}] ${graphic.summary}${graphic.off ? " (ผู้ใช้ปิดไว้)" : ""}`),
        ]
  return [
    "brief",
    `- ประเภทวิดีโอ: ${args.brief.videoType ?? "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${args.brief.instructions.trim() || "ไม่ระบุ"}`,
    "",
    `จอ ${args.canvas.width > args.canvas.height ? "แนวนอน" : "แนวตั้ง"} · ${captionLine}`,
    "",
    "จุดเน้น (เวลาบนคลิป · ความยาว · ความสำคัญ · วลีหรือภาพ · ฉาก)",
    ...args.points.map(
      (point, i) =>
        `[${i + 1}] ${clock(point.atUs)} ยาว ${lengthS(point)} วิ (${pointLabel(point.importance, point.type)}) ${said(point)}${point.reason ? ` — ${point.reason}` : ""}${on(point, i) ? ` (${on(point, i)})` : ""}${taken(i)}\n    ${scene(point, i)}`,
    ),
    ...existingLines,
  ]
}

