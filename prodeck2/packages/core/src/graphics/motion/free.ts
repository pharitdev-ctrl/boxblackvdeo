import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { EmphasisType, Importance } from "../../emphasis/types.ts"
import { FLAIR_LEVELS, type FlairLevel } from "../../flair/catalogue.ts"
import { clock, pointLabel } from "../../flair/direct.ts"
import type { LlmContent, LlmTransport, SystemPrompt } from "../../llm/types.ts"
import type { Brief } from "../../planner/brief.ts"
import type { SceneObject } from "../../vision/objects.ts"
import { band, boxText, clipText, FREE_GRAPHIC_MIN_US, GRAPHIC_MAX_S, TOP_KEPT, type GraphicBox } from "../plan.ts"

/*
 * Free graphics (0.7.0) as one planning call: Claude is shown the whole clip as it plays after the rough cut, every
 * word numbered, and answers graphics that start on a word, anywhere in the clip, each with the lowest level it plays
 * at and, when it tells a point's story, that point. It replaces planMotion, which put graphics on points only. The
 * app admits each answer by the room rules placement uses; each is written afterwards by a call of its own (write.ts).
 */

export const FREE_PLAN_PROMPT_VERSION = "free-plan-2026-10-01b"

const SYSTEM = `คุณออกแบบ "โมชันกราฟิก" ให้วิดีโอสั้นทั้งคลิป เลือกว่าช่วงไหนควรมีกราฟิก คิดไอเดียของแต่ละชิ้น และวางกรอบบนจอ โมชันกราฟิกคือภาพเคลื่อนไหวที่วาดเฉพาะช่วงนั้น วางซ้อนบนวิดีโอ และขยับตามจังหวะคำพูด ขั้นถัดไปจะมีนักออกแบบเขียนแอนิเมชันจริงจากไอเดียของคุณ นักออกแบบเห็นแค่ไอเดีย คำที่พูดพร้อมเวลา และขนาดกรอบ ไม่เห็นวิดีโอ

ข้อมูลที่ได้: brief · ระดับที่ผู้ใช้เลือก · คำพูดทุกคำของคลิปที่ตัดแล้วพร้อมเลขคำและเวลา · จุดเน้นพร้อมความสำคัญ · ข้อความเด่นแต่ละกลุ่มพร้อมช่วงเวลาที่ขึ้น แถบบนจอ และเลขจุดของมัน · แถบซับ · ฉากพร้อมช่วงเวลา keepClear และของในภาพ (ถ้าจดไว้) · กราฟิกที่ผู้ใช้ใส่เอง · เฟรมของบางช่วงแนบท้าย
พิกัดทั้งหมดเป็นสัดส่วน 0–1 นับจากมุมซ้ายบนของจอ · แถบ [บน, ล่าง] = เต็มความกว้าง · กรอบ [ซ้าย, บน, ขวา, ล่าง]
คำพูดถอดจากเสียง อาจสะกดผิด ให้อ่านความหมายจากทั้งประโยค

ใส่ตรงไหน
- ข้อความเด่นยังขึ้นตามปกติ กราฟิกเป็นตัวเสริม ไม่ต้องดีกว่าตัวหนังสือ ใส่ได้ทุกช่วงของคลิปที่ภาพช่วยให้คนดูเข้าใจหรือรู้สึกตามได้ ไม่ต้องอยู่บนจุดเน้น
- เหมาะ: ตัวเลขหรือสถิติ (ตัวเลขวิ่ง มาตรวัด วงแหวนเปอร์เซ็นต์) · การเทียบ (แท่งเทียบ ก่อนกับหลัง) · ขั้นตอนหรือรายการ (เส้นเวลา รายการติ๊ก) · การเคลื่อนที่หรือการเปลี่ยนแปลง · ของ การกระทำ คำเตือน หรืออารมณ์ที่วาดเป็นภาพได้ · ภาพประกอบเล็ก ๆ ที่เข้ากับคำพูด เช่น จรวดเล็กลอยข้างคำว่า "อวกาศ"
- ห้าม: รูปถ่าย โลโก้ หน้าคนจริง อีโมจิ · หนึ่งชิ้นมีเรื่องเดียว
- ระดับ: ทุกชิ้นบอกระดับต่ำสุดที่เล่น light = เฉพาะช่วงที่สำคัญที่สุด · medium = เพิ่มชิ้นที่ช่วยเสริมชัด · heavy = ใส่เต็มที่ คำตอบเดียวใช้ได้ทุกระดับ จึงให้ระดับต่ำสุดที่แต่ละชิ้นควรเล่น และใส่ให้ระดับที่ผู้ใช้เลือกเต็มอย่างน้อยเท่าที่ระดับนั้นขอ

ข้อความเด่น
- ชิ้นที่เล่าเรื่องของจุดเน้นไหน ให้บอกเลขจุด ชิ้นนั้นต้องเริ่มในช่วงของจุดนั้น คือช่วงที่ข้อความเด่นของจุดขึ้น หรือช่วงที่จุดนั้นเล่นถ้าจุดไม่มีข้อความเด่น
- ชิ้นที่ผูกจุดวางทับแถบข้อความเด่นของจุดตัวเองได้ เมื่อทับ ข้อความนั้นจะไม่ขึ้น และกราฟิกต้องพาคำสำคัญของจุดมาด้วย สั้น ๆ ตรงตัว ใช้เมื่อไม่มีที่ว่างอื่น
- ห้ามทับแถบข้อความเด่นอื่นที่ขึ้นอยู่ช่วงเดียวกับกราฟิก

กรอบ
- ไม่มีขนาดขั้นต่ำ ให้ใหญ่เท่าที่ไอเดียต้องการและที่ว่างมี · กรอบที่สูงไม่ถึง 0.07 ของจอใส่ตัวหนังสือไม่ได้ ให้เป็นภาพล้วน
- เว้น 0.07 บนสุดของจอไว้ให้แถบเมนูของแอปโซเชียล
- เลือกที่ว่างที่เหมาะเองจากหน้าคน ข้อความเด่น และซับของช่วงนั้น ไม่ต้องอยู่ครึ่งล่าง
- ซับอยู่ข้างหน้ากราฟิก กรอบทับแถบซับได้ แต่ตัวหนังสือ ตัวเลข และจุดสนใจของกราฟิกต้องอยู่นอกแถบซับ
- ของชนิด keep (หน้าคน ของที่โชว์ ตัวหนังสือในภาพ) หรือแถบ keepClear ของฉากที่ไม่ได้จดของ ห้ามทับ ยกเว้นชิ้นที่ขึ้นจอรวมไม่เกิน 1.5 วินาที
- ชี้หรือวางข้างของในภาพได้เฉพาะของชนิด point ที่นิ่ง ใช้กรอบของเป็นตำแหน่ง และไอเดียต้องบอกว่าชี้อะไร อยู่ตรงไหนของกรอบ
- กราฟิกสองชิ้นขึ้นพร้อมกันได้ถ้ากรอบไม่ทับกัน ถ้ากรอบทับกัน ชิ้นแรกต้องจบก่อนชิ้นถัดไปขึ้น · กราฟิกที่ผู้ใช้ใส่เองก็เช่นกัน

ตอบต่อกราฟิก เรียงตามเวลา
- word: เลขคำที่กราฟิกเริ่มขึ้น · เลือกคำที่มาก่อนคำสำคัญเล็กน้อย เพื่อให้ขึ้นทันก่อนถึงจังหวะหลัก
- until: เลขคำสุดท้ายที่ไอเดียใช้เป็นจังหวะ แอปจะให้อยู่ถึงคำนี้แล้วเผื่อเวลาให้อ่านและออกเอง · 0 = ไอเดียไม่ผูกกับคำไหนหลังคำเริ่ม
- seconds: อยากให้อยู่นานกี่วินาที 0.8–6 นับจากคำเริ่ม ถ้าคำใน until มาช้ากว่านั้น แอปยืดให้ · ชิ้นที่ทับของชนิด keep ไม่เกิน 1.5
- point: เลขจุดเน้นที่ชิ้นนี้เล่าเรื่อง · 0 = ไม่ผูกจุด
- from: ระดับต่ำสุดที่เล่น "light" "medium" หรือ "heavy"
- box: [ซ้าย, บน, ขวา, ล่าง]
- why: หนึ่งบรรทัดว่าทำไมตรงนี้
- idea: วาดอะไรและขยับอย่างไร เป็นภาษาไทย หนึ่งถึงสองประโยค ชัดพอให้นักออกแบบลงมือได้โดยไม่ต้องเดา
  · บอกของที่อยู่ในภาพ สิ่งที่ขยับ และคำพูดคำไหนเป็นจังหวะของอะไร โดยยกคำมาใส่ในเครื่องหมายคำพูด
  · ข้อความหรือตัวเลขที่ต้องขึ้นบนกราฟิกให้เขียนมาตรงตัว สั้น ๆ ตัวเลขใช้เลขอารบิก
  · ใช้ได้เฉพาะสิ่งที่วาดเองได้: เส้น รูปทรง ไอคอนง่าย ๆ และตัวหนังสือ
  · ไม่ต้องระบุสี นักออกแบบใช้ชุดสีของสไตล์ที่ผู้ใช้เลือก
  · ตัวอย่าง: ตัวเลขวิ่งจาก 0 ถึง 28,000 หยุดพอดีคำว่า "สองหมื่นแปดพัน" แล้วหน่วย "กม./ชม." เด้งขึ้น มีเข็มวัดความเร็วกวาดตามตัวเลข
  · ตัวอย่าง: จรวดเล็กวาดด้วยเส้นลอยขึ้นข้างหน้าคนตอนพูด "อวกาศ" แล้วหายไปด้านบน (ภาพล้วน กรอบเล็ก)
  · ตัวอย่าง: ลูกศรโค้งชี้ลงที่แก้วบนโต๊ะ (ของชนิด point ที่นิ่ง กรอบ [0.62, 0.55, 0.8, 0.7]) พร้อมป้าย "แก้วเก็บความเย็น" เด้งข้างลูกศรตอนพูด "แก้วใบนี้"
`

/** The prompt built into the app. */
export const FREE_PLAN_PROMPT: SystemPrompt = { system: SYSTEM, version: FREE_PLAN_PROMPT_VERSION }

/**
 * The clip as the planning call is shown it, every time on the rough cut. The lists are in the order they play, and
 * an answer's numbers count from 1 in them; every box and band is in shares of the frame from its top left.
 */
export interface FreeClip {
  brief: Brief
  /** the level of decoration the user chose */
  level: FlairLevel
  portrait: boolean
  /** the top of the subtitle band, or null with subtitles off */
  captionsFromY: number | null
  /** every word spoken, with when it starts */
  words: { text: string; atUs: number }[]
  /** a speech point's text is its phrase; a scene point's is what the picture shows */
  points: { atUs: number; kind: "speech" | "scene"; importance: Importance; type: EmphasisType; text: string; reason: string }[]
  /** the highlight text groups, each with the point it belongs to, from 1, or null for none */
  texts: { startUs: number; endUs: number; point: number | null; band: { fromY: number; toY: number }; text: string }[]
  /** the scenes on the cut, each with the things the objects pass found in it, or null when the pass has not been run for its video */
  scenes: { startUs: number; endUs: number; kind: string; description: string; keepClear: { fromY: number; toY: number } | null; objects: SceneObject[] | null }[]
  /** the graphics the user put or changed by hand */
  own: { startUs: number; endUs: number; box: GraphicBox; idea: string; off: boolean }[]
}

export const FreePlanSchema = z.object({
  graphics: z.array(
    z.object({
      /** the word's number in the list Claude was shown, from 1, as every number of the reply */
      word: z.number().int(),
      /** the last word the idea lands on; 0 for none */
      until: z.number().int().default(0),
      seconds: z.number(),
      /** the point it tells the story of; 0 for none */
      point: z.number().int().default(0),
      from: z.enum(FLAIR_LEVELS),
      box: z.array(z.number()),
      why: z.string().default(""),
      // an answer with no idea reads as an empty one, which drops that graphic rather than failing the whole reply
      idea: z.string().default(""),
    }),
  ),
})
export type FreePlan = z.infer<typeof FreePlanSchema>

/** One graphic of the plan, its numbers checked and made indexes from 0 into the clip's lists. */
export interface PlannedFree {
  /** the word it starts on */
  word: number
  /** the point it tells the story of, or null */
  point: number | null
  /** the lowest level it plays at */
  from: FlairLevel
  /** how long it plays, held to FREE_GRAPHIC_MIN_US..GRAPHIC_MAX_S and to the millisecond */
  seconds: number
  box: GraphicBox
  why: string
  /** what is drawn, one line */
  idea: string
}

/** The most characters an idea keeps, as planMotion's: well clear of the ideas Claude writes. */
const IDEA_MAX = 400
/** How long a graphic stays after the last word its idea lands on is said: half a second to read what landed, and the way out. */
const AFTER_LAST_WORD_S = 1
/** How far into the band kept for the app's bar a box's top may still reach: slack for a model that rounds. */
const TOP_SLACK = 0.005


/**
 * The request text of the planning call: the brief, the level, the frame and the subtitles, then every list under
 * its heading, one line to an item with its times on the rough cut as every planning request prints one (`clock`).
 * Words and points are numbered from 1, as the answer names them; a speech point's phrase is quoted, and a scene
 * point is shown as its picture. A scene has a second line with the things in it:
 * none when the objects pass found none, and a note that they were not recorded when it has not been run. A list
 * with nothing in it says so on its heading's line.
 */
export function describeFreeClip(clip: FreeClip): string {
  const list = <T>(heading: string, items: T[], line: (item: T, i: number) => string[]) => (items.length === 0 ? [`${heading} ไม่มี`] : [heading, ...items.flatMap(line)])
  const things = (objects: SceneObject[] | null) =>
    objects === null ? "ไม่ได้จด" : objects.map((object) => `${object.kind} “${object.what}” ${boxText(object.box)}${object.still ? " นิ่ง" : ""}`).join(" · ") || "ไม่มี"
  return [
    "brief",
    `- ประเภทวิดีโอ: ${clip.brief.videoType ?? "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${clip.brief.instructions.trim() || "ไม่ระบุ"}`,
    "",
    `ระดับที่ผู้ใช้เลือก: ${clip.level}`,
    `จอ ${clip.portrait ? "แนวตั้ง" : "แนวนอน"} · ${clip.captionsFromY === null ? "ไม่มีซับ" : `ซับ: แถบ ${band(clip.captionsFromY, 1)} อยู่ข้างหน้ากราฟิก`}`,
    "",
    ...list("คำพูด", clip.words, (word, i) => [`${i + 1}. ${clock(word.atUs)} ${word.text}`]),
    "",
    ...list("จุดเน้น", clip.points, (point, i) => [`[${i + 1}] ${clock(point.atUs)} (${pointLabel(point.importance, point.type)}) ${point.kind === "scene" ? `ภาพ: ${point.text}` : `“${point.text}”`}${point.reason ? ` — ${point.reason}` : ""}`]),
    "",
    ...list("ข้อความเด่น", clip.texts, (text) => [`- ${clock(text.startUs)}–${clock(text.endUs)} ${text.point ? `จุด ${text.point}` : "ไม่มีจุด"} แถบ ${band(text.band.fromY, text.band.toY)} “${text.text}”`]),
    "",
    ...list("ฉาก", clip.scenes, (scene) => [
      `- ${clock(scene.startUs)}–${clock(scene.endUs)} ${scene.kind} · ${scene.description} · ${scene.keepClear ? `keepClear ${band(scene.keepClear.fromY, scene.keepClear.toY)}` : "keepClear ไม่มี"}`,
      `    ของ: ${things(scene.objects)}`,
    ]),
    "",
    ...list("กราฟิกที่ผู้ใช้ใส่เอง", clip.own, (own) => [`- ${clock(own.startUs)}–${clock(own.endUs)} ${boxText(own.box)} ${own.idea}${own.off ? " (ปิดไว้)" : ""}`]),
  ].join("\n")
}

/**
 * A box Claude answered, when it is four finite numbers inside the frame written the right way round, with its top
 * below the band kept for the app's bar (with TOP_SLACK). There is no least size: a small box is a picture with no text.
 */
function boxOf(answer: number[]): GraphicBox | null {
  if (answer.length !== 4 || !answer.every(Number.isFinite)) return null
  const [x0, y0, x1, y1] = answer as [number, number, number, number]
  if (!(0 <= x0 && x0 < x1 && x1 <= 1 && y0 < y1 && y1 <= 1)) return null
  return y0 < TOP_KEPT - TOP_SLACK ? null : { x0, y0, x1, y1 }
}

/** Seconds to the millisecond, so that a time that has not really moved gives the same number, and the same render, every time. */
const toMillisecond = (seconds: number) => Math.round(seconds * 1000) / 1000

/**
 * Turns Claude's reply into the plan, its numbers from 1 made indexes from 0. An answer is dropped, and counted,
 * when its word names nothing; when its box is not four finite numbers inside the frame the right way round, or its
 * top is in the band kept for the app's bar; when its idea, made one line and cut to 400 characters by whole
 * letters, is empty; or when an earlier answer kept starts on the same word, since a graphic is known by the place
 * it starts at. A point that names nothing becomes null and the graphic stays. Claude plans by word numbers, so it
 * names the last word its idea lands on (`until`) rather than reckon its time: the seconds are the larger of those it
 * asked for (3 when it gives no number) and that word's time from the start and a second more, then held to
 * FREE_GRAPHIC_MIN_US..GRAPHIC_MAX_S and rounded to the millisecond. An until of 0, one that names nothing, or one
 * before the start word is none. The why is trimmed.
 */
export function acceptFreePlan(reply: FreePlan, clip: Pick<FreeClip, "words" | "points">): { graphics: PlannedFree[]; dropped: number } {
  const graphics: PlannedFree[] = []
  /** the word each graphic kept so far starts on */
  const taken = new Set<number>()
  let dropped = 0
  // a stand-in for Claude in a test may answer with no list at all
  for (const answer of reply.graphics ?? []) {
    const word = answer.word - 1
    const start = clip.words[word]
    const box = boxOf(answer.box ?? [])
    // made one line and cut here, where it is stored: it is one line of the writing call's brief and the summary of the row. A cut may land just after a space
    const idea = clipText((answer.idea ?? "").replace(/\s+/g, " ").trim(), IDEA_MAX).trimEnd()
    if (start === undefined || box === null || !idea || taken.has(word)) {
      dropped++
      continue
    }
    taken.add(word)
    // an answer that never went through the schema, as a stand-in for Claude in a test may give, has no until or point at all
    const until = (answer.until ?? 0) - 1
    const last = until >= word ? clip.words[until] : undefined
    const landsS = last === undefined ? 0 : (last.atUs - start.atUs) / 1_000_000 + AFTER_LAST_WORD_S
    const asked = Number.isFinite(answer.seconds) ? answer.seconds : 3
    const seconds = toMillisecond(Math.min(GRAPHIC_MAX_S, Math.max(FREE_GRAPHIC_MIN_US / 1_000_000, asked, landsS)))
    const point = clip.points[(answer.point ?? 0) - 1] === undefined ? null : (answer.point as number) - 1
    graphics.push({ word, point, from: answer.from, seconds, box, why: (answer.why ?? "").trim(), idea })
  }
  return { graphics, dropped }
}

/**
 * Asks Claude where in the clip motion graphics go and what each one draws; no call when the clip has no word to
 * start one on. The frames go after the clip, each after its label; a frame that cannot be read is left out.
 */
export async function planFreeGraphics(args: {
  transport: LlmTransport
  model: string
  clip: FreeClip
  frames: { label: string; path: string }[]
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ graphics: PlannedFree[]; dropped: number }> {
  if (args.clip.words.length === 0) return { graphics: [], dropped: 0 }
  const content: LlmContent[] = [{ type: "text", text: describeFreeClip(args.clip) }]
  for (const frame of args.frames) {
    // a frame that cannot be read is left out, and the call goes on without it
    const data = await readFile(frame.path).then(
      (bytes) => bytes.toString("base64"),
      () => null,
    )
    if (data === null) continue
    content.push({ type: "text", text: frame.label })
    content.push({ type: "image", mediaType: "image/jpeg", data })
  }
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? FREE_PLAN_PROMPT).system,
    content,
    schema: FreePlanSchema,
    // a long clip at the heaviest level may get many graphics, each with an idea of a sentence or two
    maxTokens: 16_000,
    signal: args.signal,
  })
  return acceptFreePlan(reply.output, args.clip)
}
