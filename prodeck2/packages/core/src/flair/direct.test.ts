import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import {
  acceptTechniques,
  clock,
  describeTechniques,
  findWord,
  planTechniques,
  pointLabel,
  TECHNIQUES_PROMPT,
  TECHNIQUES_PROMPT_VERSION,
  wordAt,
  type InsertMedia,
  type TechniquePoint,
  type TechniquesReply,
  type ZoomSlot,
} from "./direct.ts"

const BRIEF = { videoType: "review", targetSeconds: 30, instructions: "เน้นราคา" } as const

const PIECE: ZoomSlot = { anchor: { videoId: "v", sourceUs: 4_000_000, beatId: "b1" }, atUs: 0, durationUs: 2_500_000, what: 'ช่วง "ราคา"', beatId: "b1" }
/** Two speech points on one 2.5 s piece, and a scene point on a piece too short to zoom. */
const POINTS: TechniquePoint[] = [
  { pointId: "p1", kind: "speech", importance: "key", type: "number", reason: "ราคาโปร", videoId: "v", beatId: "b1", atUs: 1_000_000, anchor: { kind: "speech", videoId: "v", sourceUs: 5_000_000, beatId: "b1" }, text: "299 บาท", piece: PIECE },
  { pointId: "p2", kind: "speech", importance: "secondary", type: "product", reason: "", videoId: "v", beatId: "b1", atUs: 2_000_000, anchor: { kind: "speech", videoId: "v", sourceUs: 6_000_000, beatId: "b1" }, text: "ยาทาเล็บ", piece: PIECE },
  { pointId: "p3", kind: "scene", importance: "extra", type: "visual", reason: "วิวสวย", videoId: "w", beatId: "b2", atUs: 7_500_000, anchor: { kind: "speech", videoId: "w", sourceUs: 30_000_000, beatId: "b2" }, text: "ทะเลตอนเย็น", piece: null },
]
const MEDIA: InsertMedia[] = [
  { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo", width: 3024, height: 4032, durationUs: 5_000_000, what: "เล็บสีชมพู", subject: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, fit: "cover" },
  { binId: "m2", path: "/clips/shop.mp4", name: "IMG_2.MOV", kind: "video", width: 1080, height: 1920, durationUs: 2_000_000 },
]

/** A transport that records every request and answers with a fixed reply. */
function fakeTransport(output: TechniquesReply = { zooms: [], inserts: [] }) {
  const calls: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      calls.push(request as LlmRequest<unknown>)
      return { output: output as T, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, calls }
}

const textOf = (content: LlmContent[]) => content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join("\n")

test("a word is found in its line in code points, with Thai written the way it is shown; one the line does not say is not", () => {
  expect(findWord("ราคา 299 บาท", "299")).toEqual({ from: 5, to: 8 })
  // whisper.cpp writes ำ as ํ + า; the line and the word are compared composed
  expect(findWord("ทำเล็บ", "ทํา")).toEqual({ from: 0, to: 2 })
  expect(findWord("ราคา 299 บาท", "399")).toBeNull()
  expect(findWord("ราคา", "  ")).toBeNull()
  expect(wordAt("ราคา 299 บาท", 5, 8)).toBe("299")
})

test("a moment is shown as minutes, seconds and tenths", () => {
  expect(clock(83_450_000)).toBe("1:23.5")
  expect(clock(0)).toBe("0:00.0")
})

test("a point's importance and type read in Thai", () => {
  expect(pointLabel("key", "number")).toBe("สำคัญ · ตัวเลข/ราคา")
  expect(pointLabel("secondary", "hook")).toBe("รอง · hook")
  expect(pointLabel("extra", "visual")).toBe("เสริม · ภาพสวย")
})

test("a zoom lands on the piece of its point, one a piece; a cutaway where its point starts, one a point, any picture as often as it fits", () => {
  const reply: TechniquesReply = {
    zooms: [
      { point: 1, kind: "punch" },
      // p2 plays in the same piece: a piece carries one set of keyframes
      { point: 2, kind: "drift" },
      // p3's piece is too short to zoom
      { point: 3, kind: "punch" },
      { point: 9, kind: "punch" },
    ],
    inserts: [
      { point: 1, picture: 1 },
      { point: 1, picture: 2 },
      { point: 3, picture: 1 },
      { point: 2, picture: 2 },
      { point: 2, picture: 5 },
    ],
  }
  const { zooms, inserts, dropped } = acceptTechniques(reply, POINTS, MEDIA)
  expect(zooms).toEqual([{ anchor: PIECE.anchor, kind: "punch", edited: false, pointId: "p1" }])
  expect(inserts).toEqual([
    { anchor: POINTS[0]!.anchor, binId: "m1", edited: false, fit: "cover", subject: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, pointId: "p1" },
    // the same picture again, on another point
    { anchor: POINTS[2]!.anchor, binId: "m1", edited: false, fit: "cover", subject: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, pointId: "p3" },
    // a picture Claude has not looked at is laid on a card
    { anchor: POINTS[1]!.anchor, binId: "m2", edited: false, fit: "card", subject: null, pointId: "p2" },
  ])
  expect(dropped).toBe(5)
})

test("the request lists every point with its importance, words or picture, reason and what a zoom could do, then the pictures", () => {
  const lines = describeTechniques({ brief: BRIEF, points: POINTS, media: MEDIA }).split("\n")
  expect(lines).toContain("- ประเภทวิดีโอ: review")
  expect(lines).toContain("- คำสั่งเพิ่มเติม: เน้นราคา")
  expect(lines).toContain("[1] 0:01.0 (สำคัญ · ตัวเลข/ราคา) “299 บาท” — ราคาโปร · ซูมได้: ชิ้นยาว 2.5 วิ")
  expect(lines).toContain("[2] 0:02.0 (รอง · ของ) “ยาทาเล็บ” · ซูมได้: ชิ้นยาว 2.5 วิ")
  expect(lines).toContain("[3] 0:07.5 (เสริม · ภาพสวย) ภาพ: ทะเลตอนเย็น — วิวสวย · ซูมไม่ได้")
  expect(lines).toContain("1. เล็บสีชมพู")
  expect(lines).toContain("2. IMG_2.MOV (คลิป)")
  // nothing to zoom, nothing to cut away to: Claude is told to answer none
  const bare = describeTechniques({ brief: BRIEF, points: POINTS.map((point) => ({ ...point, piece: null })), media: [] })
  expect(bare).toContain("ไม่มีชิ้นให้ซูม ตอบ zooms เป็นรายการว่าง")
  expect(bare).toContain("ไม่มีรูปให้แทรก ตอบ inserts เป็นรายการว่าง")
  expect(bare).not.toContain("ซูมไม่ได้")
})

test("no point, or nothing to zoom and no picture, means no call", async () => {
  const { transport, calls } = fakeTransport()
  expect(await planTechniques({ transport, model: "m", brief: BRIEF, points: [], media: MEDIA })).toEqual({ zooms: [], inserts: [], dropped: 0 })
  expect(await planTechniques({ transport, model: "m", brief: BRIEF, points: [POINTS[2]!], media: [] })).toEqual({ zooms: [], inserts: [], dropped: 0 })
  expect(calls).toHaveLength(0)
})

test("the call carries the prompt and each picture's frames after its number, and its answer comes back accepted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "techniques-"))
  const path = join(dir, "m1.jpg")
  await writeFile(path, Buffer.from([1, 2, 3]))
  const { transport, calls } = fakeTransport({ zooms: [{ point: 1, kind: "punch" }], inserts: [{ point: 3, picture: 1 }] })
  const planned = await planTechniques({ transport, model: "m", brief: BRIEF, points: POINTS, media: MEDIA, pictureFrames: { m1: [path] } })
  expect(planned.zooms.map((zoom) => zoom.pointId)).toEqual(["p1"])
  expect(planned.inserts.map((insert) => insert.pointId)).toEqual(["p3"])
  expect(calls[0]!.system).toBe(TECHNIQUES_PROMPT.system)
  const content = calls[0]!.content
  const label = content.findIndex((part) => part.type === "text" && part.text === "รูปที่ 1")
  expect(content[label + 1]).toEqual({ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mediaType: "image/jpeg" })
  expect(textOf(content)).toContain("[3] 0:07.5")
})

test("the prompt has no quota and no file-once rule: every point that fits may get one, the same picture at more than one", () => {
  expect(TECHNIQUES_PROMPT.version).toBe(TECHNIQUES_PROMPT_VERSION)
  expect(TECHNIQUES_PROMPT_VERSION).toBe("techniques-2026-09-27-points")
  expect(TECHNIQUES_PROMPT.system).toContain("รูปเดียวกันใช้ได้หลายจุดถ้าเข้ากันจริงๆ")
  expect(TECHNIQUES_PROMPT.system).toContain("หนึ่งชิ้นซูมได้ครั้งเดียว")
  expect(TECHNIQUES_PROMPT.system).not.toContain("รูปหนึ่งใช้ครั้งเดียว")
})
