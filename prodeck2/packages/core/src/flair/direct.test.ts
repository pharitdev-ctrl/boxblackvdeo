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
  TechniquesReplySchema,
  type TechniqueClip,
  type TechniquePoint,
  type TechniquesReply,
} from "./direct.ts"
import { MOVE_POSES_MAX, type Pose } from "./moves.ts"

const BRIEF = { videoType: "review", targetSeconds: 30, instructions: "เน้นราคา" } as const

/** Two speech points and a scene point; the piece a point plays in is no longer shown. */
const POINTS: TechniquePoint[] = [
  { pointId: "p1", kind: "speech", importance: "key", type: "number", reason: "ราคาโปร", videoId: "v", beatId: "b1", atUs: 1_000_000, anchor: { kind: "speech", videoId: "v", sourceUs: 5_000_000, beatId: "b1" }, text: "299 บาท", piece: null },
  { pointId: "p2", kind: "speech", importance: "secondary", type: "product", reason: "", videoId: "v", beatId: "b1", atUs: 2_000_000, anchor: { kind: "speech", videoId: "v", sourceUs: 6_000_000, beatId: "b1" }, text: "ยาทาเล็บ", piece: null },
  { pointId: "p3", kind: "scene", importance: "extra", type: "visual", reason: "วิวสวย", videoId: "w", beatId: "b2", atUs: 7_500_000, anchor: { kind: "speech", videoId: "w", sourceUs: 30_000_000, beatId: "b2" }, text: "ทะเลตอนเย็น", piece: null },
]
const WORDS = [
  { text: "ราคา", atUs: 0 },
  { text: "299", atUs: 1_000_000 },
  { text: "บาท", atUs: 1_500_000 },
]
const MEDIA: InsertMedia[] = [
  { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo", width: 3024, height: 4032, durationUs: 5_000_000, what: "เล็บสีชมพู", subject: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, fit: "cover" },
  { binId: "m2", path: "/clips/shop.mp4", name: "IMG_2.MOV", kind: "video", width: 1080, height: 1920, durationUs: 2_000_000 },
]

/** A transport that records every request and answers with a fixed reply. */
function fakeTransport(output: TechniquesReply = { moves: [], inserts: [] }) {
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

const CLIP: TechniqueClip = {
  brief: BRIEF,
  level: "medium",
  words: WORDS,
  points: POINTS,
  pieces: [
    { atUs: 0, durationUs: 2_500_000, video: "v", cap: 1.3 },
    { atUs: 2_500_000, durationUs: 5_000_000, video: "w", cap: 1.5 },
  ],
  scenes: [
    {
      startUs: 0,
      endUs: 2_500_000,
      kind: "talking",
      description: "คนพูดหน้ากล้อง",
      keepClear: { fromY: 0.2, toY: 0.6 },
      objects: [
        { what: "หน้าผู้พูด", kind: "keep", box: { x0: 0.3, y0: 0.2, x1: 0.7, y1: 0.5 }, still: false, face: true },
        { what: "ขวดยาทาเล็บ", kind: "point", box: { x0: 0.1, y0: 0.6, x1: 0.3, y1: 0.9 }, still: true },
      ],
    },
    { startUs: 2_500_000, endUs: 7_500_000, kind: "broll", description: "ทะเลตอนเย็น", keepClear: null, objects: null },
  ],
  media: MEDIA,
}

/** A pose as Claude answers it, with what the schema fills in. */
const pose = (s: number, scale: number, more: Partial<Pose> = {}): Pose => ({ s, scale, x: 0, y: 0, rot: 0, ease: "line", ...more })
type MoveAnswer = TechniquesReply["moves"][number]
const move = (word: number, more: Partial<MoveAnswer> = {}): MoveAnswer => ({ word, insert: 0, point: 0, from: "light", about: "ดันเข้า", poses: [pose(0, 1), pose(0.4, 1.15, { ease: "out" })], ...more })

test("the request lists the level, every word, the points, the pieces with their caps, the scenes with their faces and things, and the pictures", () => {
  expect(describeTechniques(CLIP)).toBe(
    [
      "brief",
      "- ประเภทวิดีโอ: review",
      "- คำสั่งเพิ่มเติม: เน้นราคา",
      "",
      "ระดับที่ผู้ใช้เลือก: medium",
      "",
      "คำพูด",
      "1. 0:00.0 ราคา",
      "2. 0:01.0 299",
      "3. 0:01.5 บาท",
      "",
      "จุดเน้น",
      "[1] 0:01.0 (สำคัญ · ตัวเลข/ราคา) “299 บาท” — ราคาโปร",
      "[2] 0:02.0 (รอง · ของ) “ยาทาเล็บ”",
      "[3] 0:07.5 (เสริม · ภาพสวย) ภาพ: ทะเลตอนเย็น — วิวสวย",
      "",
      "ชิ้นวิดีโอ",
      "- 0:00.0–0:02.5 ซูมได้ไม่เกิน 130%",
      "- 0:02.5–0:07.5 ซูมได้ไม่เกิน 150%",
      "",
      "ฉาก",
      "- 0:00.0–0:02.5 talking · คนพูดหน้ากล้อง · keepClear [0.2, 0.6]",
      "    ของ: keep หน้า “หน้าผู้พูด” [0.3, 0.2, 0.7, 0.5] · point “ขวดยาทาเล็บ” [0.1, 0.6, 0.3, 0.9] นิ่ง",
      "- 0:02.5–0:07.5 broll · ทะเลตอนเย็น · keepClear ไม่มี",
      "    ของ: ไม่ได้จด",
      "",
      "รูปที่แทรกได้",
      "1. เล็บสีชมพู",
      "2. IMG_2.MOV (คลิป)",
    ].join("\n"),
  )
})

test("a list with nothing in it says so on its heading's line", () => {
  const bare = describeTechniques({ ...CLIP, words: [], points: [], pieces: [], scenes: [{ ...CLIP.scenes[0]!, objects: [] }], media: [] }).split("\n")
  expect(bare).toEqual(expect.arrayContaining(["คำพูด ไม่มี", "จุดเน้น ไม่มี", "ชิ้นวิดีโอ ไม่มี", "    ของ: ไม่มี", "รูปที่แทรกได้ ไม่มี"]))
  expect(describeTechniques({ ...CLIP, scenes: [] })).toContain("\nฉาก ไม่มี\n")
})

test("a cutaway lands where its point starts, one a point, any picture as often as it fits", () => {
  const reply: TechniquesReply = {
    moves: [],
    inserts: [
      { point: 1, picture: 1 },
      { point: 1, picture: 2 },
      { point: 3, picture: 1 },
      { point: 2, picture: 2 },
      { point: 2, picture: 5 },
    ],
  }
  const { inserts, dropped } = acceptTechniques(reply, CLIP)
  expect(inserts).toEqual([
    { anchor: POINTS[0]!.anchor, binId: "m1", edited: false, fit: "cover", subject: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, pointId: "p1" },
    // the same picture again, on another point
    { anchor: POINTS[2]!.anchor, binId: "m1", edited: false, fit: "cover", subject: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, pointId: "p3" },
    // a picture Claude has not looked at is laid on a card
    { anchor: POINTS[1]!.anchor, binId: "m2", edited: false, fit: "card", subject: null, pointId: "p2" },
  ])
  expect(dropped).toBe(2)
})

test("a move starts on a word from 1 and keeps its poses as answered, its point from 1 and its about made one line", () => {
  const poses = [pose(0, 1), pose(0.3, 1.25, { x: -0.1, y: 0.05, rot: 2, ease: "out" }), pose(1.2, 1.1, { ease: "inOut" })]
  const reply: TechniquesReply = { inserts: [], moves: [move(2, { point: 1, from: "medium", about: "  กระแทก\n  ตรงคำว่า 299  ", poses })] }
  expect(acceptTechniques(reply, CLIP)).toEqual({ moves: [{ word: 1, insert: null, from: "medium", pointId: "p1", about: "กระแทก ตรงคำว่า 299", poses }], inserts: [], dropped: 0 })
})

test("a point of 0 or out of range is none, and the move stays", () => {
  const reply: TechniquesReply = { inserts: [], moves: [move(1, { point: 0 }), move(2, { point: 4 }), move(3, { point: -1 })] }
  const { moves, dropped } = acceptTechniques(reply, CLIP)
  expect(moves.map((kept) => [kept.word, kept.pointId])).toEqual([
    [0, undefined],
    [1, undefined],
    [2, undefined],
  ])
  expect(dropped).toBe(0)
})

test("a move on a word out of range, with an empty about, or with poses empty, too many or out of time order is dropped", () => {
  const reply: TechniquesReply = {
    inserts: [],
    moves: [
      move(0),
      move(4),
      move(1, { about: " \n " }),
      move(1, { poses: [] }),
      move(1, { poses: Array.from({ length: MOVE_POSES_MAX + 1 }, (_, i) => pose(i * 0.1, 1 + i * 0.01)) }),
      // two poses at one moment are not in order either
      move(1, { poses: [pose(0, 1), pose(0, 1.2)] }),
      move(1, { poses: [pose(0.5, 1.2), pose(0.2, 1)] }),
      // the most poses a move may have is fine
      move(3, { poses: Array.from({ length: MOVE_POSES_MAX }, (_, i) => pose(i * 0.1, 1 + i * 0.01)) }),
    ],
  }
  const { moves, dropped } = acceptTechniques(reply, CLIP)
  expect(moves.map((kept) => kept.word)).toEqual([2])
  expect(dropped).toBe(7)
})

test("about is cut to 200 characters", () => {
  const { moves } = acceptTechniques({ inserts: [], moves: [move(1, { about: "ก".repeat(250) })] }, CLIP)
  expect(moves[0]!.about).toBe("ก".repeat(200))
})

test("a second move on the same word of the footage, or on the same cutaway, is dropped; the first stays", () => {
  const reply: TechniquesReply = {
    inserts: [{ point: 1, picture: 1 }],
    moves: [
      move(2, { about: "แรก" }),
      move(2, { about: "สอง" }),
      move(1, { insert: 1, about: "บนรูป" }),
      move(1, { about: "บนคลิป" }),
      move(3, { insert: 1, about: "บนรูปอีก" }),
      move(2, { insert: 1, about: "อีก" }),
    ],
  }
  const { moves, dropped } = acceptTechniques(reply, CLIP)
  // a move on a cutaway does not take its word from the footage, nor the footage's from the cutaway
  expect(moves.map((kept) => [kept.word, kept.insert, kept.about])).toEqual([
    [1, null, "แรก"],
    [0, 0, "บนรูป"],
    [0, null, "บนคลิป"],
  ])
  expect(dropped).toBe(3)
})

test("a move on a cutaway names it by its number in this reply, and lands on it as kept; one naming a cutaway dropped or none is dropped", () => {
  const reply: TechniquesReply = {
    inserts: [
      { point: 1, picture: 1 },
      // dropped: a second cutaway on point 1
      { point: 1, picture: 2 },
      { point: 3, picture: 2 },
    ],
    moves: [move(1, { insert: 3 }), move(2, { insert: 2 }), move(2, { insert: 4 }), move(2, { insert: -1 }), move(3, { insert: 1 })],
  }
  const { moves, inserts, dropped } = acceptTechniques(reply, CLIP)
  expect(inserts.map((insert) => insert.pointId)).toEqual(["p1", "p3"])
  expect(moves.map((kept) => [kept.word, kept.insert])).toEqual([
    [0, 1],
    [2, 0],
  ])
  // the second cutaway, and the three moves naming nothing kept
  expect(dropped).toBe(4)
})

test("a pose answered with only its moment and scale stands still and runs straight; a reply without moves has none", () => {
  const reply = TechniquesReplySchema.parse({ inserts: [], moves: [{ word: 1, from: "heavy", about: "ดันเข้า", poses: [{ s: 0, scale: 1 }, { s: 1, scale: 1.1 }] }] })
  expect(acceptTechniques(reply, CLIP).moves).toEqual([{ word: 0, insert: null, from: "heavy", about: "ดันเข้า", poses: [pose(0, 1), pose(1, 1.1)] }])
  expect(acceptTechniques({ inserts: [] } as unknown as TechniquesReply, CLIP)).toEqual({ moves: [], inserts: [], dropped: 0 })
})

test("no words and no picture means no call; words alone, or pictures alone, are enough", async () => {
  const { transport, calls } = fakeTransport()
  expect(await planTechniques({ transport, model: "m", ...CLIP, words: [], media: [] })).toEqual({ moves: [], inserts: [], dropped: 0 })
  expect(calls).toHaveLength(0)
  await planTechniques({ transport, model: "m", ...CLIP, points: [], media: [] })
  await planTechniques({ transport, model: "m", ...CLIP, words: [], points: [] })
  expect(calls).toHaveLength(2)
})

test("the call carries the prompt, room for a long answer, and each picture's frames after its number, and its answer comes back accepted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "techniques-"))
  const path = join(dir, "m1.jpg")
  await writeFile(path, Buffer.from([1, 2, 3]))
  const { transport, calls } = fakeTransport({ moves: [move(2, { point: 1 }), move(1, { insert: 1 })], inserts: [{ point: 3, picture: 1 }] })
  const planned = await planTechniques({ transport, model: "m", ...CLIP, pictureFrames: { m1: [path] } })
  expect(planned.moves.map((kept) => [kept.word, kept.insert, kept.pointId])).toEqual([
    [1, null, "p1"],
    [0, 0, undefined],
  ])
  expect(planned.inserts.map((insert) => insert.pointId)).toEqual(["p3"])
  expect(calls[0]!.system).toBe(TECHNIQUES_PROMPT.system)
  expect(calls[0]!.maxTokens).toBe(16_000)
  const content = calls[0]!.content
  const label = content.findIndex((part) => part.type === "text" && part.text === "รูปที่ 1")
  expect(content[label + 1]).toEqual({ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mediaType: "image/jpeg" })
  expect(textOf(content)).toContain("[3] 0:07.5")
})

test("the prompt asks for moves on words and cutaways in place of zooms on points, and keeps the cutaway rules", () => {
  expect(TECHNIQUES_PROMPT.version).toBe(TECHNIQUES_PROMPT_VERSION)
  expect(TECHNIQUES_PROMPT_VERSION).toBe("techniques-2026-10-02-moves")
  const system = TECHNIQUES_PROMPT.system
  // the plan's block, verbatim, then the cutaway part
  const moves = [
    "การเคลื่อนภาพ (ซูม): คุณออกแบบการขยับของตัวคลิปวิดีโอเอง ตัวหนังสือ ซับ และกราฟิกไม่ขยับตาม",
    "- ใส่ตรงคำไหนก็ได้ที่การเคลื่อนภาพช่วยเน้นหรือสร้างอารมณ์ เช่น กระแทกเข้าตรงคำสำคัญ ดันเข้าช้าๆ ตอนเล่า ถอยออกตอนเฉลย เด้งเข้าแล้วกลับตรงมุก หรือสลับใกล้ไกลตามคัต ไม่ต้องอยู่บนจุดเน้น ให้ภาพได้พักด้วย",
    "- แต่ละท่อนเริ่มที่คำหนึ่งคำ (word) แล้วเป็นรายการท่า (poses) ตามเวลา s วินาทีนับจากคำนั้น แต่ละท่ามี scale (1 = ขนาดเดิม) x และ y (เลื่อน หน่วยครึ่งจอ ขวาและขึ้นเป็นบวก) rot (องศา) และ ease = ความเร็วจากท่าก่อนหน้ามาท่านี้: line เท่ากันตลอด · in ค่อยๆ เร่ง · out ค่อยๆ ผ่อน · inOut ค่อยๆ เร่งแล้วผ่อน · cut เปลี่ยนทันที",
    "- ท่อนจบตรงท่าสุดท้าย แล้วภาพค้างท่านั้นจนท่อนถัดไปหรือจบชิ้น ชิ้นใหม่เริ่มที่ขนาดเดิมเสมอ ท่อนไม่ข้ามคัต และสองท่อนในชิ้นเดียวกันห้ามซ้อนเวลา",
    '- ความแรง: 108–120% ใช้บ่อย สูงกว่านั้นเฉพาะจุดพีค และห้ามเกิน "ซูมได้ไม่เกิน" ของชิ้นนั้น · หมุนไม่เกิน 5 องศา ใช้น้อยๆ',
    "- ห้ามเห็นขอบภาพ: ยิ่งขยายน้อยยิ่งเลื่อนหรือหมุนได้น้อย ที่ขนาดเดิม (1.0) ห้ามเลื่อนห้ามหมุน",
    "- ฉากที่มีหน้าคน หน้าต้องอยู่ในจอครบตลอด ใช้กรอบหน้าที่ให้มาคำนวณ ฉากที่ไม่มีหน้า ขยับได้อิสระ ของที่โชว์ขอแค่จุดกลางอยู่ในจอ",
    "- สื่อแทรกขยับได้ด้วย: ตอบ insert = เลขของสื่อแทรกในคำตอบนี้ (นับจาก 1) แล้ว word เป็นคำที่สื่อแทรกนั้นขึ้น รูปนิ่งควรมีการเคลื่อน เช่น ค่อยๆ ดันหรือเลื่อนผ่าน",
    "- ทุกท่อนบอก from = ระดับต่ำสุดที่เล่น light เฉพาะช่วงสำคัญที่สุด · medium เพิ่มช่วงที่ช่วยเสริมชัด · heavy ใส่เต็มที่ ใส่ให้ระดับที่ผู้ใช้เลือกเต็มอย่างน้อยเท่าที่ระดับนั้นขอ",
    '- point = เลขจุดเน้นที่ท่อนนี้เกี่ยว (0 = ไม่เกี่ยว) · about = หนึ่งบรรทัดภาษาไทยว่าท่อนนี้ทำอะไร เช่น "ดันเข้าช้าๆ แล้วกระแทกตรงคำว่า 990"',
    "- ไม่เกิน 12 ท่าต่อท่อน",
  ]
  expect(moves).toHaveLength(11)
  expect(system).toContain(`\n\n${moves.join("\n")}\n\nสื่อแทรก:`)
  expect(system).toContain("มีสองอย่าง คือการเคลื่อนภาพ (ซูม) และตัดไปสื่อแทรก")
  expect(system).toContain("ข้อมูลที่ได้: brief ของวิดีโอ ระดับที่ผู้ใช้เลือก คำพูดทุกคำพร้อมเลขและเวลา")
  expect(system).toContain("รูปเดียวกันใช้ได้หลายจุดถ้าเข้ากันจริงๆ")
  expect(system).not.toContain("ซูมภาพ:")
  expect(system).not.toContain("หนึ่งชิ้นซูมได้ครั้งเดียว")
  expect(system).not.toContain("รูปหนึ่งใช้ครั้งเดียว")
})
