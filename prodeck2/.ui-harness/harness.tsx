// Demo harness for the tutorial video: the real renderer on a scripted fake API, a serum-review project end to end.
import {
  fakeApi, settingsView, detail, storedOutline, highlightPreview, emphasisView, backupInfo, activeLicense, insight, claudeCodeStatus,
} from "../apps/desktop/src/renderer/test/fake-api.ts"
import { DEFAULT_HIGHLIGHT_OPTIONS } from "@boxblack/core/highlights/styles"
import { MOTION_VERSION } from "@boxblack/core/graphics/plan"

const q = new URLSearchParams(location.search)
const FOLDER = "/drafts/รีวิวเซรั่ม 0930"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ---------- pictures: drawn, so no real footage is needed ---------- */
function frame(kind: "talk" | "product" | "hand" | "shop" | "promo" | "nail" | "cafe", w = 540, h = 960): string {
  const c = document.createElement("canvas"); c.width = w; c.height = h
  const g = c.getContext("2d")!
  const bg = g.createLinearGradient(0, 0, 0, h)
  const pal: Record<string, [string, string]> = {
    talk: ["#e9d6c3", "#b89478"], product: ["#f4ece2", "#d9c3a8"], hand: ["#efe1d2", "#c9a68a"], shop: ["#3b4a5c", "#1d2530"],
    promo: ["#fbe3d6", "#e9a98c"], nail: ["#f6d7e2", "#d48aa6"], cafe: ["#d8c2a5", "#7c5a3d"],
  }
  bg.addColorStop(0, pal[kind][0]); bg.addColorStop(1, pal[kind][1]); g.fillStyle = bg; g.fillRect(0, 0, w, h)
  const cx = w / 2
  const bottle = (x: number, y: number, s: number) => {
    g.fillStyle = "#3a2a1c"; g.fillRect(x - 14 * s, y - 70 * s, 28 * s, 30 * s)
    const b = g.createLinearGradient(x - 30 * s, 0, x + 30 * s, 0); b.addColorStop(0, "#8a4f1f"); b.addColorStop(.5, "#e3a160"); b.addColorStop(1, "#8a4f1f")
    g.fillStyle = b; g.beginPath(); g.roundRect(x - 30 * s, y - 42 * s, 60 * s, 130 * s, 12 * s); g.fill()
    g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(x - 22 * s, y + 5 * s, 44 * s, 26 * s)
  }
  if (kind === "talk" || kind === "promo") {
    g.fillStyle = "#2b1d14"; g.beginPath(); g.ellipse(cx, h * .36, w * .2, h * .14, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = "#e2b996"; g.beginPath(); g.ellipse(cx, h * .38, w * .15, h * .1, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = kind === "promo" ? "#fff4ec" : "#f3ece2"; g.beginPath(); g.ellipse(cx, h * .95, w * .42, h * .45, 0, Math.PI, 0); g.fill()
    bottle(cx + w * .2, h * .74, 1.1)
  } else if (kind === "product") { bottle(cx, h * .5, 2.4) }
  else if (kind === "hand") {
    g.fillStyle = "#e2b996"; g.beginPath(); g.ellipse(cx, h * .62, w * .32, h * .12, -.3, 0, Math.PI * 2); g.fill()
    g.fillStyle = "rgba(255,240,215,.9)"; g.beginPath(); g.ellipse(cx + 10, h * .6, w * .1, h * .03, -.3, 0, Math.PI * 2); g.fill()
    bottle(cx + w * .2, h * .35, 1)
  } else if (kind === "shop") {
    g.fillStyle = "#f2c46d"; g.fillRect(w * .15, h * .3, w * .7, h * .3); g.fillStyle = "#1d2530"; g.fillRect(w * .2, h * .35, w * .6, h * .22)
  } else if (kind === "nail") {
    for (let i = 0; i < 4; i++) { g.fillStyle = "#c2547a"; g.beginPath(); g.roundRect(w * (.2 + i * .16), h * .4, w * .1, h * .12, 20); g.fill() }
  } else if (kind === "cafe") {
    g.fillStyle = "#fff"; g.beginPath(); g.ellipse(cx, h * .55, w * .22, h * .06, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = "#6b4226"; g.beginPath(); g.ellipse(cx, h * .55, w * .17, h * .04, 0, 0, Math.PI * 2); g.fill()
  }
  return c.toDataURL("image/jpeg", .85)
}
const covers: Record<string, string> = {}

/* ---------- the project ---------- */
const project = detail({
  name: "รีวิวเซรั่ม 0930", folder: FOLDER, timelineSegmentCount: 0,
  videos: [
    { id: "a", path: "/media/รีวิวเซรั่ม_เทคหลัก.MOV", name: "รีวิวเซรั่ม_เทคหลัก.MOV", durationUs: 252_000_000, width: 1080, height: 1920, exists: true },
    { id: "b", path: "/media/สินค้า_closeup.MOV", name: "สินค้า_closeup.MOV", durationUs: 48_000_000, width: 1080, height: 1920, exists: true },
    { id: "c", path: "/media/ทาบนหลังมือ.MOV", name: "ทาบนหลังมือ.MOV", durationUs: 36_000_000, width: 1080, height: 1920, exists: true },
  ],
})

const words = (text: string, start: number, end: number) => ({ text, startUs: start, endUs: end })
const transcriptA = {
  engine: "whisper-local", model: "large-v3-q5_0", language: "th",
  utterances: [words("ใครผิวแห้งจนแต่งหน้าไม่ติด ต้องดูคลิปนี้", 1_000_000, 4_800_000), words("เซรั่มตัวนี้ทาแล้วผิวฉ่ำทันที", 31_000_000, 34_000_000), words("ตอนนี้ลด 50% ถึงสิ้นเดือนนี้เท่านั้น", 230_000_000, 234_000_000)],
  words: Array.from({ length: 412 }, (_, i) => words("คำ", 1_000_000 + i * 600_000, 1_400_000 + i * 600_000)), audioEvents: [],
}
const visionOf = (kind: string, scenes: [number, number, string, string][]) => ({
  ...insight(""), summary: kind, frameCount: 24,
  scenes: scenes.map(([s, e, description, k]) => ({ startUs: s, endUs: e, description, kind: k, issues: [], keepClear: null })),
})
const insights: Record<string, any> = {
  a: visionOf("ผู้หญิงรีวิวเซรั่มหน้ากล้อง ถือขวดสีอำพัน", [[0, 120_000_000, "ผู้หญิงพูดหน้ากล้อง ถือขวดเซรั่ม", "talking-head"], [120_000_000, 252_000_000, "โชว์ขวดใกล้กล้อง แล้วพูดเรื่องโปรโมชั่น", "talking-head"]]),
  b: visionOf("ขวดเซรั่มบนโต๊ะไม้ แสงอุ่น", [[0, 20_000_000, "ขวดเซรั่มหมุนช้าๆ บนโต๊ะ", "b-roll"], [20_000_000, 48_000_000, "หยดเซรั่มลงจากหลอดหยด", "b-roll"]]),
  c: visionOf("ทาเซรั่มบนหลังมือ", [[0, 36_000_000, "นิ้วเกลี่ยเซรั่มบนหลังมือ เห็นผิวเงา", "b-roll"]]),
}

/* ---------- outline ---------- */
const beat = (id: string, name: string, purpose: string, videoId: string, s: number, e: number, speech: string, visual: string) => ({
  id, name, purpose, videoId, videoName: project.videos.find((v) => v.id === videoId)!.name,
  kind: videoId === "a" ? "speech" : "scenes", fromIndex: 0, toIndex: 0, startUs: s, endUs: e, speech, visual,
})
const BEATS = [
  beat("b1", "เปิดด้วยสินค้า", "ดึงสายตาใน 2 วินาทีแรก", "b", 2_000_000, 6_000_000, "", "ขวดเซรั่มหมุนช้าๆ บนโต๊ะไม้"),
  beat("b2", "ปัญหาผิวแห้ง", "ให้คนดูเห็นตัวเอง", "a", 1_000_000, 9_500_000, "ใครผิวแห้งจนแต่งหน้าไม่ติด ต้องดูคลิปนี้", "พูดหน้ากล้อง"),
  beat("b3", "ทาให้ดูเนื้อเซรั่ม", "พิสูจน์ว่าซึมไวไม่เหนอะ", "c", 4_000_000, 12_000_000, "", "เกลี่ยเซรั่มบนหลังมือ ผิวเงาฉ่ำ"),
  beat("b4", "ผลลัพธ์", "บอกสิ่งที่ได้", "a", 31_000_000, 38_500_000, "เซรั่มตัวนี้ทาแล้วผิวฉ่ำทันที ใช้ต่อเนื่องเจ็ดวันเห็นเลย", "โชว์ขวดใกล้กล้อง"),
  beat("b5", "โปรโมชั่น", "ปิดการขาย", "a", 230_000_000, 236_000_000, "ตอนนี้ลด 50% ถึงสิ้นเดือนนี้เท่านั้น", "ยิ้ม ชี้ไปที่ขวด"),
]
let outline: any = null
const makeStored = (brief: any, confirmed = false, beats = BEATS) => storedOutline({
  folder: FOLDER, videoIds: ["a", "b", "c"], brief, confirmed, model: "claude-opus-5-5",
  updatedAt: Date.parse("2026-09-30T10:05:00Z"), outline: { title: "รีวิวเซรั่มผิวฉ่ำ", summary: "จากปัญหาผิวแห้ง สู่ผิวฉ่ำ แล้วปิดด้วยโปรลด 50%", omitted: "ช่วงแนะนำตัว 40 วินาที และเทคที่พูดราคาผิด", direction: "สดใส จังหวะเร็ว เปิดด้วยปัญหาผิวแห้งให้ลุ้น ช่วงผลลัพธ์ผิวฉ่ำและโปรลด 50% เป็นไฮไลต์ ใส่กราฟิกและเสียงเต็มที่ ช่วงวิธีใช้ให้เรียบ อ่านง่าย โทนสีพาสเทลอบอุ่น", beats, warnings: [] },
})

/* ---------- the rough cut ---------- */
const row = (state: string, reason: string | null, s: number, e: number, text: string, idx: number[]) =>
  ({ state, reason, startUs: s, endUs: e, text, toggle: { type: "words", indexes: idx, keep: state !== "used" } })
const bc = (beatId: string, videoId: string, pieces: [number, number][], rows: any[], removals: any[], originalUs: number) => ({
  beatId, videoId, pieces: pieces.map(([startUs, endUs]) => ({ startUs, endUs })), removals, rows, notes: [], originalUs,
  keptUs: pieces.reduce((n, [s, e]) => n + e - s, 0),
})
const CUT = (() => {
  const beats = [
    bc("b1", "b", [[2_000_000, 6_000_000]], [{ state: "used", reason: null, startUs: 2_000_000, endUs: 6_000_000, text: "", toggle: { type: "pieces", ranges: [{ startUs: 2_000_000, endUs: 6_000_000 }], keep: false } }], [], 4_000_000),
    bc("b2", "a", [[1_000_000, 2_600_000], [3_200_000, 4_800_000], [5_400_000, 9_300_000]], [
      row("used", null, 1_000_000, 2_600_000, "ใครผิวแห้ง", [0, 1]),
      row("cut", "filler", 2_600_000, 3_200_000, "เอ่อ", [2]),
      row("used", null, 3_200_000, 4_800_000, "จนแต่งหน้าไม่ติด", [3, 4, 5]),
      row("cut", "pause", 4_800_000, 5_400_000, "", [6]),
      row("used", null, 5_400_000, 9_300_000, "ต้องดูคลิปนี้ให้จบเลยค่ะ", [7, 8, 9]),
    ], [{ reason: "filler", startUs: 2_600_000, endUs: 3_200_000, text: "เอ่อ" }, { reason: "pause", startUs: 4_800_000, endUs: 5_400_000, text: "" }], 8_500_000),
    bc("b3", "c", [[4_000_000, 11_000_000]], [{ state: "used", reason: null, startUs: 4_000_000, endUs: 11_000_000, text: "", toggle: { type: "pieces", ranges: [{ startUs: 4_000_000, endUs: 11_000_000 }], keep: false } }],
      [{ reason: "shaky", startUs: 11_000_000, endUs: 12_000_000, text: "" }], 8_000_000),
    bc("b4", "a", [[33_400_000, 38_500_000]], [
      row("cut", "retake", 31_000_000, 33_300_000, "เซรั่มตัวนี้ อ่า ทาแล้ว", [20, 21, 22]),
      row("used", null, 33_400_000, 38_500_000, "เซรั่มตัวนี้ทาแล้วผิวฉ่ำทันที ใช้ต่อเนื่องเจ็ดวันเห็นเลย", [23, 24, 25, 26]),
    ], [{ reason: "retake", startUs: 31_000_000, endUs: 33_300_000, text: "เซรั่มตัวนี้ อ่า ทาแล้ว" }], 7_500_000),
    bc("b5", "a", [[230_000_000, 235_400_000]], [row("used", null, 230_000_000, 235_400_000, "ตอนนี้ลด 50% ถึงสิ้นเดือนนี้เท่านั้น", [40, 41, 42, 43])], [], 6_000_000),
  ]
  const cuts = beats.flatMap((b) => b.pieces.map((p: any) => ({ binId: b.videoId, sourceStartUs: p.startUs, sourceDurationUs: p.endUs - p.startUs })))
  return { beats, cuts, durationUs: beats.reduce((n, b) => n + b.keptUs, 0) }
})()
const SUBS = [
  { key: "a:1", beatId: "b2", startUs: 4_000_000, endUs: 5_600_000, text: "ใครผิวแห้ง" },
  { key: "a:2", beatId: "b2", startUs: 5_600_000, endUs: 7_200_000, text: "จนแต่งหน้าไม่ติด" },
  { key: "a:3", beatId: "b2", startUs: 7_200_000, endUs: 11_100_000, text: "ต้องดูคลิปนี้ให้จบเลยค่ะ" },
  { key: "a:4", beatId: "b4", startUs: 18_100_000, endUs: 20_600_000, text: "เซรั่มตัวนี้ทาแล้วผิวฉ่ำทันที" },
  { key: "a:5", beatId: "b4", startUs: 20_600_000, endUs: 23_200_000, text: "ใช้ต่อเนื่องเจ็ดวันเห็นเลย" },
  { key: "a:6", beatId: "b5", startUs: 23_200_000, endUs: 28_600_000, text: "ตอนนี้ลด 50% ถึงสิ้นเดือนนี้เท่านั้น" },
]

/* ---------- post production (after the AI plan has run) ---------- */
let planned = q.has("planned")
const look = { pattern: "stack", tone: "base", accent: null, exit: null, edited: false }
const GROUPS = [
  { id: "g1", beatId: "b2", source: "ai", replaced: false, placement: "above", look, startUs: 4_000_000, endUs: 6_400_000, lines: [{ index: 0, text: "ผิวแห้ง", startUs: 4_000_000, partial: false }, { index: 1, text: "แต่งหน้าไม่ติด", startUs: 5_600_000, partial: false }] },
  { id: "g2", beatId: "b4", source: "ai", replaced: false, placement: "above", look, startUs: 18_400_000, endUs: 20_400_000, lines: [{ index: 0, text: "ผิวฉ่ำทันที", startUs: 18_400_000, partial: false }] },
  { id: "g3", beatId: "b5", source: "ai", replaced: false, placement: "above", look, startUs: 23_600_000, endUs: 26_000_000, lines: [{ index: 0, text: "ลด 50%", startUs: 23_600_000, partial: false }] },
]
const point = (id: string, beatId: string, videoId: string, atUs: number, endUs: number, text: string, importance: string, type: string, reason: string, items: any) => ({
  id, anchor: { kind: "speech", videoId, from: 0, to: 1, beatId }, importance, type, reason, source: "ai", edited: false, beatId, atUs, endUs, text, shown: true, items,
})
const POINTS = [
  { ...point("p0", "b1", "b", 0, 4_000_000, "ขวดเซรั่มหมุนช้าๆ", "key", "hook", "ภาพสินค้าชัดที่สุดของคลิป เปิดให้หยุดดู", { text: 0, zoom: 1, insert: 0, graphic: 0, sound: 1 }), anchor: { kind: "scene", videoId: "b", startUs: 2_000_000, endUs: 6_000_000, beatId: "b1" } },
  point("p1", "b2", "a", 4_000_000, 5_600_000, "ใครผิวแห้ง", "key", "hook", "คำถามที่คนดูผิวแห้งรู้สึกว่าพูดถึงตัวเอง", { text: 1, zoom: 1, insert: 0, graphic: 0, sound: 1 }),
  point("p2", "b4", "a", 18_100_000, 20_600_000, "ผิวฉ่ำทันที", "secondary", "product", "ผลลัพธ์ที่สินค้าสัญญา", { text: 1, zoom: 0, insert: 1, graphic: 0, sound: 1 }),
  point("p3", "b5", "a", 23_600_000, 25_000_000, "ลด 50%", "key", "number", "ราคาเป็นจุดตัดสินใจซื้อ ต้องจำได้", { text: 1, zoom: 1, insert: 0, graphic: 1, sound: 1 }),
]
const SENTENCES = [
  { videoId: "a", beatId: "b2", from: 0, to: 6, atUs: 4_000_000, words: ["ใคร", "ผิวแห้ง", "จน", "แต่งหน้า", "ไม่ติด", "ต้องดูคลิปนี้"] },
  { videoId: "a", beatId: "b4", from: 23, to: 28, atUs: 18_100_000, words: ["เซรั่มตัวนี้", "ทาแล้ว", "ผิวฉ่ำ", "ทันที", "เจ็ดวันเห็นเลย"] },
  { videoId: "a", beatId: "b5", from: 40, to: 44, atUs: 23_200_000, words: ["ตอนนี้", "ลด 50%", "ถึงสิ้นเดือน", "เท่านั้น"] },
]
const IDEA = "ป้ายราคา ฿990 ถูกขีดฆ่า แล้ว ฿495 เด้งขึ้นสีทองกลางจอ พร้อมวงแหวนครึ่งวงวิ่งรอบ"
const GRAPHIC = {
  anchor: { kind: "speech", videoId: "a", sourceUs: 230_500_000, beatId: "b5" }, atUs: 23_700_000, durationUs: 3_000_000,
  what: "ที่ “ลด 50%”", beatId: "b5", why: "ย้ำราคาให้จำง่าย", summary: IDEA,
  spec: { kind: "motion", version: MOTION_VERSION, box: { x0: .1, y0: .55, x1: .9, y1: .75 }, seconds: 3, why: "ย้ำราคาให้จำง่าย", idea: IDEA, words: [{ text: "ลด", atS: .2 }, { text: "50%", atS: .7 }], html: "<div>495</div>" },
  written: true, stale: false, writeFailed: null, instruction: null, editFailed: null, canUndo: false, render: "ready", poster: null, error: null, edited: false, off: false,
  pointId: "p3", from: "medium", replaces: false, coversKeep: false,
}
const MOVES = [
  { anchor: { kind: "beat", beatId: "b1", edge: "start" }, insert: false, atUs: 0, durationUs: 3_000_000, beatId: "b1", about: "ค่อยๆ ดันกล้องเข้าหาขวด แล้วหมุนนิดเดียวตอนจบ", from: "light", pointId: "p0", edited: false, off: false, instruction: null, editFailed: null, canUndo: false },
  { anchor: { kind: "speech", videoId: "a", sourceUs: 4_100_000, beatId: "b2" }, insert: false, atUs: 4_000_000, durationUs: 1_200_000, beatId: "b2", about: "กระแทกเข้าหน้าเร็วๆ ตรงคำว่า ผิวแห้ง", from: "medium", pointId: "p1", edited: false, off: false, instruction: null, editFailed: null, canUndo: false },
  { anchor: { kind: "speech", videoId: "a", sourceUs: 230_600_000, beatId: "b5" }, insert: false, atUs: 23_600_000, durationUs: 1_500_000, beatId: "b5", about: "ซูมเข้าเร็วแล้วสั่นเบาๆ ตอนบอกราคา", from: "medium", pointId: "p3", edited: false, off: false, instruction: null, editFailed: null, canUndo: false },
]
const snd = (beatId: string, atUs: number, role: string, pointId: string, graphic: any = null) => ({ anchor: { kind: "speech", videoId: "a", sourceUs: atUs, beatId }, atUs, durationUs: 900_000, beatId, role, from: "medium", loudness: "normal", pointId, graphic, written: true, stale: null, writeFailed: null, instruction: null, editFailed: null, canUndo: false, off: false, render: "ready", error: null })
const COMPOSED = [
  snd("b1", 300_000, "วูชนุ่มๆ ตอนกล้องดันเข้าหาขวด", "p0"),
  snd("b2", 4_000_000, "ตุ้บหนักๆ ย้ำคำว่า ผิวแห้ง", "p1"),
  snd("b4", 18_400_000, "ประกายใสๆ ตอนพูดว่า ผิวฉ่ำทันที", "p2"),
  { ...snd("b5", 23_700_000, "กริ๊งเครื่องคิดเงิน ตอนราคาเด้งเป็น ฿495", "p3", { summary: "ป้ายราคา ฿990 ถูกขีดฆ่า แล้ว ฿495 เด้งขึ้น" }), anchor: { kind: "speech", videoId: "a", sourceUs: 230_500_000, beatId: "b5" } },
]
const preview = () => planned ? highlightPreview({
  style: "headline", styleByAi: "headline", groups: GROUPS as any,
  media: [{ binId: "m1", name: "ขวดเซรั่ม.PNG", kind: "photo", what: "ขวดเซรั่มสีอำพันบนพื้นขาว" }] as any,
  graphics: [GRAPHIC] as any,
  moves: MOVES as any,
  composed: COMPOSED as any,
  emphasis: emphasisView({ points: POINTS as any, sentences: SENTENCES as any, scenes: [{ videoId: "b", beatId: "b1", startUs: 2_000_000, endUs: 6_000_000, atUs: 0, durationUs: 4_000_000, description: "ขวดเซรั่มหมุนช้าๆ บนโต๊ะไม้", pointId: "p0" }] as any, version: 2 }),
}) : highlightPreview({ emphasis: emphasisView({ sentences: SENTENCES as any }) })

/* ---------- settings: everything set up, as after the install chapter ---------- */
let settings: any = settingsView({
  subtitles: { enabled: true, length: "short", polish: true },
  highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
  flair: { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: true },
  llm: { transport: q.has("fresh") ? "anthropic-api" : "claude-code", model: "claude-opus-5-5", effort: "medium" },
  keyHints: { elevenlabs: null, anthropic: q.has("fresh") ? null : "9876" },
  model: { label: "Whisper large-v3 (q5_0)", sizeBytes: 1_081_140_203, state: q.has("fresh") ? { status: "missing" } : { status: "ready" }, downloading: false },
  graphicsPack: q.has("fresh") ? { state: "missing" } : { state: "installed", version: "0.8.65" },
  readiness: { problems: [] },
  tools: {
    ffmpeg: { path: "/Applications/BOXBLACK.app/Contents/Resources/bin/ffmpeg", version: "8.1.2", missing: [] },
    ffprobe: { path: "/Applications/BOXBLACK.app/Contents/Resources/bin/ffprobe" },
    whisper: { path: "/Applications/BOXBLACK.app/Contents/Resources/bin/whisper-cli", usable: true, pinned: true },
    claude: { path: "/Users/ford/.local/bin/claude", version: "2.1.280" },
  },
  appVersion: "0.5.0",
})
let analysed: string[] = q.has("analysed") || q.has("outlined") || q.has("planned") ? ["a", "b", "c"] : []
if (q.has("outlined") || q.has("planned")) outline = makeStored({ targetSeconds: 30, videoType: "sales", instructions: "เปิดด้วยช็อตสินค้า เน้นโปรโมชั่นตอนท้าย" }, true)
let backups: any[] = []
const fresh = q.has("fresh")
let license: any = q.has("unlicensed") ? { state: "unlicensed" } : null
let cc: any = fresh ? { supported: true, path: null, version: null, account: null, busy: null } : null
const capcut = { running: q.has("capcut") }
let state: any = null

const agentBase = (folder: string): any => ({
  folder, turns: [], running: false, round: 0, rounds: 25, costUsd: 0, summed: false,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  direction: "สดใส จังหวะเร็ว ช่วงผลลัพธ์และโปรลด 50% เป็นไฮไลต์",
  pieces: [
    { id: "caption-1", kind: "caption", startUs: 300_000, endUs: 1_900_000, label: "ผิวแห้งจนแต่งหน้าไม่ติด", by: "pipeline", locked: false },
    { id: "move-1", kind: "move", startUs: 2_100_000, endUs: 3_000_000, label: "ดันเข้าช้าๆ ตอนเล่าปัญหา", by: "pipeline", locked: false },
  ],
})
let agent: any = null
const api: any = fakeApi({
  ...modes(),
  listProjects: async () => ({
    root: "/drafts",
    projects: [
      { name: "รีวิวเซรั่ม 0930", folder: FOLDER, durationUs: 336_000_000, modifiedUs: Date.parse("2026-09-30T09:12:00Z") * 1000, coverPath: "x" },
      { name: "เล็บเจลสีนู้ด 0925", folder: "/drafts/เล็บ", durationUs: 74_000_000, modifiedUs: Date.parse("2026-09-25T13:40:00Z") * 1000, coverPath: "x" },
      { name: "คาเฟ่ใหม่ย่านอารีย์", folder: "/drafts/cafe", durationUs: 128_000_000, modifiedUs: Date.parse("2026-09-18T05:02:00Z") * 1000, coverPath: "x" },
    ],
    stages: { "/drafts/เล็บ": { stage: "confirmed", at: Date.parse("2026-09-25T14:00:00Z") }, "/drafts/cafe": { stage: "analysed", at: Date.parse("2026-09-18T06:00:00Z") } },
  }),
  readCover: async (folder: string) => (covers[folder] ??= frame(folder === FOLDER ? "talk" : folder.includes("เล็บ") ? "nail" : "cafe")),
  beatThumbnail: async (_f: string, videoId: string, atUs: number) => frame(videoId === "b" ? "product" : videoId === "c" ? "hand" : atUs > 200_000_000 ? "promo" : "talk", 270, 480),
  inspectProject: async () => project,
  getSettings: async () => settings,
  updateSettings: async (patch: any) => { settings = { ...settings, ...patch } },
  licenseStateUnused: async () => activeLicense({ license: { customer: "Thalent AI", plan: "monthly", expiresAt: Date.parse("2026-10-31T16:59:59Z"), maxDevices: 2, devicesUsed: 1 } } as any),
  analysedVideos: async () => analysed,
  analysisState: async () => state,
  knownRetakes: async () => ({}),
  startAnalysis: async (folder: string, ids: string[]) => {
    state = { folder, running: true, outcome: null, error: null, transcription: {}, vision: {} }
    ;(async () => {
      const emit = (type: string, videoId: string, status: any) => {
        state[type === "transcription" ? "transcription" : "vision"][videoId] = status
        api.emit({ type, folder, videoId, status })
      }
      for (const id of ids) { emit("transcription", id, { state: "queued" }); emit("vision", id, { state: "queued" }) }
      for (const id of ids) {
        emit("transcription", id, { state: "extracting" }); await sleep(350)
        for (const p of [.12, .35, .6, .86]) { emit("transcription", id, { state: "transcribing", progress: p }); await sleep(260) }
        emit("transcription", id, { state: "done", fromCache: false, transcript: id === "a" ? transcriptA : { engine: "none", model: "", language: "", utterances: [], words: [], audioEvents: [] } })
        for (const p of [.3, .7]) { emit("vision", id, { state: "measuring", progress: p }); await sleep(220) }
        for (const p of [.2, .55, .9]) { emit("vision", id, { state: "describing", progress: p }); await sleep(260) }
        emit("vision", id, { state: "done", fromCache: false, insight: insights[id] })
      }
      analysed = ids; state.running = false; state.outcome = "done"
      api.emit({ type: "analysis-finished", folder, outcome: "done" })
    })()
  },
  getOutline: async () => outline,
  planOutline: async (_f: string, _ids: string[], brief: any) => { await sleep(2600); return (outline = makeStored(brief)) },
  reviseOutline: async (_f: string, _i: string, brief: any) => { await sleep(1800); return (outline = makeStored(brief, false, BEATS.filter((b) => b.id !== "b4").concat([]))) },
  saveOutlineEdits: async (_f: string, ids: string[], confirmed: boolean) => (outline = { ...outline, outline: { ...outline.outline, beats: ids.map((id) => BEATS.find((b) => b.id === id)!) }, confirmed }),
  agentOpen: async (folder: string) => (agent = { ...agentBase(folder), ...agent, folder }),
  agentSend: async (folder: string, text: string) => {
    const said = [...agent.turns, { role: "user", text }]
    const step = (extra: any) => { agent = { ...agent, ...extra }; api.emit({ type: "agent", view: agent }); return agent }
    step({ turns: said, running: true, round: 1 })
    await sleep(900)
    const pieces = [
      ...agent.pieces,
      { id: "highlight-1", kind: "highlight", startUs: 17_800_000, endUs: 19_400_000, label: "ลด 50%", by: "claude", locked: false },
      { id: "graphic-1", kind: "graphic", startUs: 23_700_000, endUs: 26_200_000, label: "ป้ายราคา ฿990 ขีดฆ่า แล้ว ฿495 เด้งขึ้นตัวใหญ่", by: "claude", locked: false },
      { id: "composed-1", kind: "composed", startUs: 24_100_000, endUs: 24_900_000, label: "กริ๊งเครื่องคิดเงินตอนราคาเด้ง", by: "claude", locked: false },
    ]
    step({
      round: 2,
      pieces,
      costUsd: 0.31,
      turns: [
        ...said,
        { role: "claude", say: "ใส่ข้อความ ลด 50% ตอนพูดถึงโปร แล้วทำกราฟิกป้ายราคาตัวใหญ่ตอนท้ายพร้อมเสียงกริ๊ง", actions: ["add_text", "add_graphic", "add_sound"] },
        { role: "results", lines: ["✓ add_text: ใส่ข้อความ highlight-1 ที่ 17.80s", "✓ add_graphic: ใส่กราฟิก graphic-1 ที่ 23.70s", "✓ add_sound: แต่งเสียง composed-1 ที่ 24.10s"] },
      ],
    })
    await sleep(700)
    return step({ running: false, costUsd: 0.38, turns: [...agent.turns, { role: "claude", say: "เสร็จแล้วครับ ป้ายราคาขึ้นตอน 0:23.7 นาน 2.5 วินาที ลองดูแล้วบอกได้ว่าอยากปรับอะไร", actions: [] }] })
  },
  agentLock: async (_f: string, id: string, locked: boolean) => (agent = { ...agent, pieces: agent.pieces.map((p: any) => (p.id === id ? { ...p, locked } : p)) }),
  agentRemove: async (_f: string, id: string) => (agent = { ...agent, pieces: agent.pieces.filter((p: any) => p.id !== id) }),
  saveOutlineDirection: async (_f: string, direction: string) => (outline = { ...outline, outline: { ...outline.outline, direction: direction.trim() }, updatedAt: Date.now() }),
  unusedParts: async () => [],
  previewCut: async () => CUT,
  previewSubtitles: async () => SUBS,
  previewHighlights: async () => preview(),
  postPlanState: async () => null,
  planPost: async (folder: string) => {
    const works = ["emphasis", "text", "techniques", "graphics", "sounds", "subtitles"]
    ;(async () => {
      for (const w of works) api.emit({ type: "post-plan", folder, work: w, state: { state: "waiting" } })
      const counts: Record<string, number> = { emphasis: 4, text: 3, techniques: 4, graphics: 1, sounds: 4, subtitles: 6 }
      for (const w of works) {
        api.emit({ type: "post-plan", folder, work: w, state: { state: "running" } }); await sleep(w === "graphics" ? 900 : 550)
        api.emit({ type: "post-plan", folder, work: w, state: { state: "done", count: counts[w], dropped: 0 } })
        if (w === "emphasis") planned = true
      }
      api.emit({ type: "post-plan-finished", folder })
    })()
    return { running: true, states: Object.fromEntries(works.map((w) => [w, { state: "waiting" }])) }
  },
  writeTimeline: async (folder: string) => {
    api.emit({ type: "timeline-write", folder, state: "started" }); await sleep(1500)
    const backup = backupInfo("รีวิวเซรั่ม-2026-09-30T10-15-00-000Z", "2026-09-30T10:15:00.000Z", { durationUs: 0, segmentCount: 0 })
    backups = [backup]
    const result = { backup, durationUs: CUT.durationUs, segmentCount: 6, captionCount: 6, highlightCount: 3, soundCount: 3, zoomCount: 3, insertCount: 1, graphicCount: 1,
      composedCount: 4, dropped: { sounds: 0, zooms: 0, inserts: 0, graphics: 0, moves: 0 }, zoomsLost: 0, graphicsSkipped: 0, composedLeftOut: { unwritten: 0, stale: 0, failed: 0 }, emphasisCount: 4, proLeftOut: { exits: 0, sounds: 0 } }
    api.emit({ type: "timeline-write", folder, state: "done", result })
    return result
  },
  listBackups: async () => backups,
}, capcut)
;(window as any).boxblack = api
;(window as any).__demo = { api, capcut, setPlanned: (v: boolean) => (planned = v) }
function modes() {
  const LIC = activeLicense({ license: { customer: "Thalent AI", plan: "monthly", expiresAt: Date.parse("2026-10-31T16:59:59Z"), maxDevices: 2, devicesUsed: 1 } } as any)
  const ccReady = claudeCodeStatus({ path: "/Users/ford/.local/bin/claude" })
  return {
    licenseState: async () => license ?? LIC,
    activateLicense: async () => { await sleep(1400); license = LIC; return { ok: true, state: LIC } },
    claudeCodeStatus: async () => cc ?? ccReady,
    installClaudeCode: async () => {
      cc = { ...cc, busy: "installing" }; api.emit({ type: "claude-code", status: cc, progress: "กำลังดาวน์โหลด Claude Code…" })
      await sleep(1600); cc = { supported: true, path: "/Users/ford/.local/bin/claude", version: "2.1.280", account: { loggedIn: false, subscription: null }, busy: null }
      api.emit({ type: "claude-code", status: cc })
    },
    loginClaudeCode: async () => {
      cc = { ...cc, busy: "logging-in" }; api.emit({ type: "claude-code", status: cc })
      await sleep(1600); cc = ccReady; api.emit({ type: "claude-code", status: cc })
    },
    downloadModel: async () => {
      const total = 1_081_140_203
      settings = { ...settings, model: { ...settings.model, downloading: true } }
      ;(async () => {
        for (let i = 1; i <= 12; i++) { api.emit({ type: "model-download", state: "progress", received: Math.round(total * i / 12), total }); await sleep(250) }
        settings = { ...settings, model: { ...settings.model, state: { status: "ready" }, downloading: false } }
        api.emit({ type: "model-download", state: "done" })
      })()
    },
    installGraphicsPack: async () => {
      const total = 163_000_000
      ;(async () => {
        for (let i = 1; i <= 8; i++) { settings = { ...settings, graphicsPack: { state: "downloading", received: total * i / 8, total } }; api.emit({ type: "graphics-pack", state: "progress", received: Math.round(total * i / 8), total }); await sleep(250) }
        settings = { ...settings, graphicsPack: { state: "installing" } }; api.emit({ type: "graphics-pack", state: "installing" }); await sleep(600)
        settings = { ...settings, graphicsPack: { state: "installed", version: "0.8.65" } }; api.emit({ type: "graphics-pack", state: "done" })
      })()
    },
    saveApiKey: async () => { settings = { ...settings, keyHints: { ...settings.keyHints, anthropic: "a1B2" } } },
    restoreBackup: async () => { await sleep(900) },
  }
}
await import("../apps/desktop/src/renderer/src/main.tsx")
