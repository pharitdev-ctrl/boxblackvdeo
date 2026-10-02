import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { LlmContent, LlmTransport, SystemPrompt } from "../llm/types.ts"
import type { Scene } from "./describe.ts"
import type { FrameImage } from "./frames.ts"

/** Part of the cache key: changing the prompt or schema must invalidate stored objects. */
export const OBJECTS_VERSION = "objects-2026-10-02-faces"

export const OBJECT_KINDS = ["keep", "point"] as const

export interface SceneObject {
  what: string
  kind: (typeof OBJECT_KINDS)[number]
  /** shares of the source frame from its top-left */
  box: { x0: number; y0: number; x1: number; y1: number }
  still: boolean
  /** a person's face; set only on a keep object, so the zoom can keep it in frame */
  face?: boolean
}

/** One entry per scene of the insight it was made for, in the same order. */
export interface SceneObjects {
  /** OBJECTS_VERSION when made */
  version: string
  scenes: SceneObject[][]
}

export const ObjectsReplySchema = z.object({
  scenes: z.array(
    z.object({
      scene: z.number().int(),
      objects: z.array(z.object({ what: z.string(), kind: z.enum(OBJECT_KINDS), box: z.array(z.number()), still: z.boolean().default(false), face: z.boolean().default(false) })).default([]),
    }),
  ),
})

export type ObjectsReply = z.infer<typeof ObjectsReplySchema>

const SYSTEM = `คุณดูภาพจากวิดีโอทีละช่วง แล้วจดตำแหน่งของในภาพของแต่ละฉาก เพื่อให้แอปวางกราฟิกไม่บังของสำคัญ และชี้ของที่อยู่นิ่งได้

ได้รับ: รายการฉากที่แบ่งไว้แล้ว (เลขฉาก ช่วงเวลา คำบรรยาย) และภาพของช่วงนั้นพร้อมเวลา

ตอบต่อฉาก
- scene: เลขฉากตามรายการ
- objects: ของในฉากนั้น ไม่เกิน 6 อัน เรียงจากสำคัญมากไปน้อย แต่ละอัน:
  - what: ของนั้นคืออะไร ภาษาไทยสั้น ๆ
  - kind: "keep" = ส่วนที่ห้ามมีอะไรไปบัง ได้แก่ ใบหน้าคน ของหรือสินค้าที่กำลังโชว์ ตัวหนังสือที่อยู่ในภาพ · "point" = ของที่เห็นชัดและกราฟิกชี้ได้ เช่น สินค้าบนโต๊ะ ป้าย เครื่องมือ (หน้าคนเป็น keep เสมอ)
  - box: [ซ้าย, บน, ขวา, ล่าง] เป็นสัดส่วน 0–1 ของภาพ นับจากมุมซ้ายบน ให้ครอบทุกเฟรมของฉากนั้น ถ้าคนหรือของขยับให้กรอบกว้างพอ
  - still: true เมื่อของอยู่ที่เดิมตลอดฉาก
  - face: true เมื่อของนั้นคือใบหน้าคน (ใช้กับ kind keep เท่านั้น)
- ไม่ต้องจดลำตัว มือ ฉากหลัง หรือข้าวของทั่วไปที่ไม่มีใครพูดถึง · ฉากที่ไม่มีของที่ต้องจด ให้ objects เป็นรายการว่าง
เขียน what เป็นภาษาไทย`

/** The prompt built into the app. Unlike the vision prompt, the license server cannot hand out another. */
export const OBJECTS_PROMPT: SystemPrompt = { system: SYSTEM, version: OBJECTS_VERSION }

/** The most objects kept for one scene. */
const OBJECTS_MAX = 6
/** The most graphemes an object's name keeps. */
const WHAT_MAX = 60

const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" })

/** A name trimmed and cut by whole graphemes, so a Thai letter keeps its marks. */
function keptWhat(text: string): string {
  let kept = ""
  let count = 0
  for (const { segment } of graphemes.segment(text.trim())) {
    if (count === WHAT_MAX) break
    kept += segment
    count++
  }
  return kept.trimEnd()
}

/** Only four finite shares, left before right and top before bottom, make a usable box. */
function boxOf(answer: number[]): SceneObject["box"] | null {
  if (answer.length !== 4 || !answer.every(Number.isFinite)) return null
  const [x0, y0, x1, y1] = answer as [number, number, number, number]
  return x0 >= 0 && x0 < x1 && x1 <= 1 && y0 >= 0 && y0 < y1 && y1 <= 1 ? { x0, y0, x1, y1 } : null
}

/**
 * The objects of each scene a batch was asked about, by its 1-based number. An answer for a scene
 * it was not asked about is ignored, an object without a usable box or name is dropped, and a scene
 * the model left out has none.
 */
export function acceptObjects(reply: ObjectsReply, sceneNumbers: number[]): Map<number, SceneObject[]> {
  const kept = new Map<number, SceneObject[]>(sceneNumbers.map((n) => [n, []]))
  for (const answer of reply.scenes ?? []) {
    const objects = kept.get(answer.scene)
    if (!objects) continue
    for (const object of answer.objects ?? []) {
      if (objects.length === OBJECTS_MAX) break
      const box = boxOf(object.box ?? [])
      const what = keptWhat(object.what ?? "")
      // a thing named twice in one scene is kept where it was first named
      if (!box || !what || objects.some((o) => o.what === what)) continue
      objects.push({ what, kind: object.kind, box, still: object.still ?? false, ...(object.kind === "keep" && object.face === true ? { face: true } : {}) })
    }
  }
  return kept
}

const sec = (us: number) => (us / 1_000_000).toFixed(1)

/**
 * Shows the sampled frames to Claude a batch at a time, as describeVideo does, with the scenes
 * already found in each batch's stretch, and records where the things in each scene are: what
 * must not be covered and what a graphic may point at.
 */
export async function locateObjects(args: {
  transport: LlmTransport
  model: string
  frames: FrameImage[]
  scenes: Scene[]
  batchSize: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}): Promise<SceneObjects> {
  const { frames, scenes } = args
  const found: SceneObject[][] = scenes.map(() => [])
  if (scenes.length === 0) return { version: OBJECTS_VERSION, scenes: found }

  const batches: FrameImage[][] = []
  for (let i = 0; i < frames.length; i += args.batchSize) batches.push(frames.slice(i, i + args.batchSize))

  let numbered = 0
  for (const [index, batch] of batches.entries()) {
    // as in describeVideo, the first batch's stretch starts the video and the last one's runs to its end
    const startUs = index === 0 ? 0 : batch[0]!.atUs
    const endUs = batches[index + 1]?.[0]?.atUs ?? Infinity
    const asked = scenes.flatMap((scene, i) => (scene.startUs < endUs && scene.endUs >= startUs ? [i + 1] : []))

    // a stretch with no scene in it has nothing to ask about
    if (asked.length > 0) {
      const content: LlmContent[] = [
        { type: "text", text: ["ฉาก", ...asked.map((n) => `${n}. ${sec(scenes[n - 1]!.startUs)}–${sec(scenes[n - 1]!.endUs)} วินาที · ${scenes[n - 1]!.description}`)].join("\n") },
      ]
      for (const [i, frame] of batch.entries()) {
        content.push({ type: "text", text: `ภาพที่ ${numbered + i + 1} · เวลา ${sec(frame.atUs)} วินาที` })
        content.push({ type: "image", mediaType: "image/jpeg", data: (await readFile(frame.path)).toString("base64") })
      }

      const reply = await args.transport.generate({
        model: args.model,
        system: OBJECTS_PROMPT.system,
        content,
        schema: ObjectsReplySchema,
        maxTokens: 8000,
        signal: args.signal,
      })

      // a scene that spans two batches keeps what the first saw, plus anything new the second names, up to the same six
      for (const [n, objects] of acceptObjects(reply.output, asked)) {
        const kept = found[n - 1]!
        const named = new Set(kept.map((o) => o.what))
        for (const object of objects) {
          if (kept.length === OBJECTS_MAX || named.has(object.what)) continue
          kept.push(object)
          named.add(object.what)
        }
      }
    }
    numbered += batch.length
    args.onProgress?.((index + 1) / batches.length)
  }

  return { version: OBJECTS_VERSION, scenes: found }
}
