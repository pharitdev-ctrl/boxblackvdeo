import { expect, test } from "vitest"
import type { TimedText, Transcript } from "../asr/types.ts"
import type { FootageClip } from "../planner/footage.ts"
import type { Beat } from "../planner/outline.ts"
import type { VideoInsight } from "../vision/describe.ts"
import type { VideoSignals } from "../vision/signals.ts"
import type { Loudness } from "../media/loudness.ts"
import { compileCuts } from "./compile.ts"
import { DEFAULT_CUT_RULES, type CutRules, type VideoCutDecisions } from "./rules.ts"

const s = (seconds: number) => Math.round(seconds * 1_000_000)

const words = (dump: string): TimedText[] =>
  dump
    .trim()
    .split(/\s+/)
    .map((item) => {
      const [text, times] = item.split("@") as [string, string]
      const [start, end] = times.split("-").map(Number) as [number, number]
      return { text, startUs: s(start), endUs: s(end) }
    })

function talk(id: string, durationSec: number, utterances: string[], dump: string): FootageClip {
  const all = words(dump)
  const transcript: Transcript = {
    engine: "whisper-local",
    model: "large-v3-q5_0",
    language: "th",
    // "text@start-end" per utterance; the words say what is in it
    utterances: utterances.map((line) => {
      const [text, times] = line.split("@") as [string, string]
      const [start, end] = times.split("-").map(Number) as [number, number]
      return { text, startUs: s(start), endUs: s(end) }
    }),
    words: all,
    audioEvents: [],
  }
  return { id, name: `${id}.mov`, durationUs: s(durationSec), transcript, insight: null }
}

const noSignals: VideoSignals = { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] }

function broll(id: string, durationSec: number, signals: Partial<VideoSignals> = {}, transcriptWords = ""): FootageClip {
  const insight: VideoInsight = {
    model: "claude-opus-5",
    promptVersion: "vision",
    frameCount: 3,
    retakes: [],
    signals: { ...noSignals, ...signals },
    summary: "",
    scenes: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }
  const transcript: Transcript | null = transcriptWords
    ? { engine: "whisper-local", model: "m", language: "th", utterances: [], words: words(transcriptWords), audioEvents: [] }
    : null
  return { id, name: `${id}.mp4`, durationUs: s(durationSec), transcript, insight }
}

function beat(id: string, videoId: string, kind: Beat["kind"], startSec: number, endSec: number): Beat {
  return {
    id,
    name: id,
    purpose: "",
    videoId,
    videoName: videoId,
    kind,
    fromIndex: 0,
    toIndex: 0,
    startUs: s(startSec),
    endUs: s(endSec),
    speech: "",
    visual: "",
  }
}

const rules = (extra: Partial<CutRules> = {}): CutRules => ({ ...DEFAULT_CUT_RULES, ...extra })
const ranges = (pieces: { startUs: number; endUs: number }[]) => pieces.map((p) => [p.startUs / 1e6, p.endUs / 1e6])

// สวัสดี ครับ | วันนี้ เรา เอ่อ จะ มา รีวิว | กล้อง ตัวใหม่ | ขอบคุณ
const TALK = talk(
  "talk",
  20,
  ["สวัสดีครับ@1.0-1.8", "วันนี้เรา เอ่อ จะมารีวิว@2.6-4.8", "กล้องตัวใหม่@6.0-7.2", "ขอบคุณ@9.0-9.6"],
  "สวัสดี@1.00-1.50 ครับ@1.50-1.80 วันนี้@2.60-3.00 เรา@3.00-3.20 เอ่อ@3.30-3.70 จะ@3.80-4.00 มา@4.00-4.20 รีวิว@4.20-4.80 กล้อง@6.00-6.50 ตัวใหม่@6.50-7.20 ขอบคุณ@9.00-9.60",
)

test("a speech beat keeps its words with padding and cuts pauses longer than the preset allows", () => {
  const plan = compileCuts({ beats: [beat("b1", "talk", "speech", 1.0, 7.2)], clips: [TALK], rules: rules({ cutFillers: false }) })
  const [cut] = plan.beats
  // normal: pauses over 0.6 s are cut, 0.15 s of padding stays on each side
  expect(ranges(cut!.pieces)).toEqual([
    [0.85, 1.95],
    [2.45, 4.95],
    [5.85, 7.35],
  ])
  expect(cut!.removals).toEqual([
    { reason: "pause", startUs: s(1.95), endUs: s(2.45), text: "" },
    { reason: "pause", startUs: s(4.95), endUs: s(5.85), text: "" },
  ])
  expect(cut!.originalUs).toBe(s(6.2))
  expect(cut!.keptUs).toBe(s(5.1))
  expect(cut!.notes).toEqual([])
})

test("the loose preset keeps a pause the normal one cuts, with wider padding", () => {
  const plan = compileCuts({
    beats: [beat("b1", "talk", "speech", 1.0, 7.2)],
    clips: [TALK],
    rules: rules({ preset: "loose", cutFillers: false }),
  })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([
    [0.75, 5.05],
    [5.75, 7.45],
  ])
})

test("fillers are cut at the word's own edges, and only when that rule is on", () => {
  const on = compileCuts({ beats: [beat("b1", "talk", "speech", 2.6, 4.8)], clips: [TALK], rules: rules() })
  expect(ranges(on.beats[0]!.pieces)).toEqual([
    [2.45, 3.3],
    [3.7, 4.95],
  ])
  expect(on.beats[0]!.removals).toEqual([{ reason: "filler", startUs: s(3.3), endUs: s(3.7), text: "เอ่อ" }])

  const off = compileCuts({ beats: [beat("b1", "talk", "speech", 2.6, 4.8)], clips: [TALK], rules: rules({ cutFillers: false }) })
  expect(ranges(off.beats[0]!.pieces)).toEqual([[2.45, 4.95]])
})

test("padding never reaches into words outside the beat", () => {
  const clip = talk("tight", 5, ["หนึ่ง@1.0-1.5", "สอง@1.6-2.0"], "หนึ่ง@1.00-1.50 สอง@1.60-2.00")
  const plan = compileCuts({ beats: [beat("b1", "tight", "speech", 1.6, 2.0)], clips: [clip], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[1.5, 2.15]])
})

test("a beat that opens with a filler starts after it", () => {
  const clip = talk("open", 5, ["เอ่อ สวัสดี@1.0-2.0"], "เอ่อ@1.00-1.40 สวัสดี@1.50-2.00")
  const plan = compileCuts({ beats: [beat("b1", "open", "speech", 1.0, 2.0)], clips: [clip], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[1.4, 2.15]])
  expect(plan.beats[0]!.removals).toEqual([{ reason: "filler", startUs: s(1.0), endUs: s(1.4), text: "เอ่อ" }])
})

// whisper.cpp on IMG_9646.MOV: the countdown fails once and starts over
const COUNTDOWN = talk(
  "astronaut",
  31.106,
  ["และผมก็กำลังจะขึ้นไปในอวกาศ ในสาม สอง@16.06-21.14", "หนึ่ง@21.56-22.06", "สาม สอง หนึ่ง@22.62-25.25"],
  "และ@16.06-16.48 ผม@16.48-16.64 ก็@16.64-16.84 กำลัง@16.84-17.04 จะ@17.04-17.16 ขึ้น@17.16-17.44 ไป@17.44-17.68 ใน@17.68-18.08 อวกาศ@18.08-18.75 ใน@19.00-19.78 สาม@19.78-20.51 สอง@20.66-21.14 หนึ่ง@21.56-22.06 สาม@22.62-23.58 สอง@23.88-24.84 หนึ่ง@24.84-25.25",
)

test("a phrase started over is cut back to its last take", () => {
  const plan = compileCuts({ beats: [beat("b1", "astronaut", "speech", 16.06, 25.25)], clips: [COUNTDOWN], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([
    [15.91, 19.78],
    [22.47, 25.4],
  ])
  expect(plan.beats[0]!.removals).toEqual([{ reason: "retake", startUs: s(19.78), endUs: s(22.47), text: "สาม สอง หนึ่ง" }])

  const off = compileCuts({ beats: [beat("b1", "astronaut", "speech", 16.06, 25.25)], clips: [COUNTDOWN], rules: rules({ cutRetakes: false }) })
  expect(off.beats[0]!.removals.map((r) => r.reason)).toEqual([])
})

test("a line said again with another price is kept, and offered as a retake the user can cut", () => {
  const clip = talk(
    "price",
    10,
    ["ตัวนี้ราคา 590 บาท@1.0-2.6", "ตัวนี้ราคา 790 บาท@3.4-5.0"],
    "ตัว@1.0-1.3 นี้@1.3-1.6 ราคา@1.6-2.0 590@2.0-2.3 บาท@2.3-2.6 ตัว@3.4-3.7 นี้@3.7-4.0 ราคา@4.0-4.4 790@4.4-4.7 บาท@4.7-5.0",
  )
  const plan = compileCuts({ beats: [beat("b1", "price", "speech", 1.0, 5.0)], clips: [clip], rules: rules() })
  expect(plan.beats[0]!.removals.filter((removal) => removal.reason === "retake")).toEqual([])
  expect(plan.durationUs).toBeGreaterThan(s(3))
  expect(rowsOf(plan)[0]).toEqual(["kept", "maybe-retake", 1.0, 2.6, "ตัวนี้ราคา 590 บาท", { type: "words", indexes: [0, 1, 2, 3, 4], keep: false }])

  // cutting it is the user's own cut, and flipping it back offers it again
  const cut = compileCuts({ beats: [beat("b1", "price", "speech", 1.0, 5.0)], clips: [clip], rules: rules(), decisions: { price: decide({ cutWords: [0, 1, 2, 3, 4] }) } })
  expect(cut.beats[0]!.removals[0]).toMatchObject({ reason: "user", text: "ตัว นี้ ราคา 590 บาท" })
  expect(rowsOf(cut)[0]).toEqual(["cut", "user", 1.0, 2.6, "ตัวนี้ราคา 590 บาท", { type: "words", indexes: [0, 1, 2, 3, 4], keep: null }])

  // a phrase broken off and started again with another number is offered the same way
  const restart = talk("restart", 10, ["ตัวนี้ราคา 30 ตัวนี้ราคา 50 บาท@1.0-4.0"], "ตัว@1.0-1.2 นี้@1.2-1.4 ราคา@1.4-1.7 30@1.7-2.0 ตัว@2.6-2.8 นี้@2.8-3.0 ราคา@3.0-3.3 50@3.3-3.6 บาท@3.6-4.0")
  const again = compileCuts({ beats: [beat("b1", "restart", "speech", 1.0, 4.0)], clips: [restart], rules: rules() })
  expect(again.beats[0]!.removals.filter((removal) => removal.reason === "retake")).toEqual([])
  expect(rowsOf(again)[0]!.slice(0, 2)).toEqual(["kept", "maybe-retake"])

  // the new price comes a few words later in the second take than in the first
  const later = talk("later", 10, ["ราคาตอนนี้ 590 ราคาตอนนี้เหลือแค่ 790 บาท@1.0-4.0"], "ราคา@1.0-1.3 ตอนนี้@1.3-1.6 590@1.6-2.0 ราคา@2.6-2.9 ตอนนี้@2.9-3.2 เหลือ@3.2-3.4 แค่@3.4-3.6 790@3.6-3.8 บาท@3.8-4.0")
  const further = compileCuts({ beats: [beat("b1", "later", "speech", 1.0, 4.0)], clips: [later], rules: rules() })
  expect(further.beats[0]!.removals.filter((removal) => removal.reason === "retake")).toEqual([])
})

test("a whole line said again is dropped even when its first word was misheard", () => {
  const clip = talk(
    "again",
    20,
    ["เค้าต้องไปด้วยกระสวยอวกาศเท่านั้น@1.0-3.8", "เขาต้องไปด้วยกระสวยอวกาศเท่านั้น@5.0-7.8"],
    "เค้า@1.0-1.4 ต้อง@1.4-1.8 ไป@1.8-2.2 ด้วย@2.2-2.6 กระสวย@2.6-3.0 อวกาศ@3.0-3.4 เท่านั้น@3.4-3.8 เขา@5.0-5.4 ต้อง@5.4-5.8 ไป@5.8-6.2 ด้วย@6.2-6.6 กระสวย@6.6-7.0 อวกาศ@7.0-7.4 เท่านั้น@7.4-7.8",
  )
  const plan = compileCuts({ beats: [beat("b1", "again", "speech", 1.0, 7.8)], clips: [clip], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[4.85, 7.95]])
  expect(plan.beats[0]!.removals).toEqual([
    { reason: "retake", startUs: s(1.0), endUs: s(4.85), text: "เค้า ต้อง ไป ด้วย กระสวย อวกาศ เท่านั้น" },
  ])
})

test("a beat whose words are all cut leaves nothing and says so", () => {
  const clip = talk("um", 5, ["เอ่อ@1.0-1.4"], "เอ่อ@1.00-1.40")
  const plan = compileCuts({ beats: [beat("b1", "um", "speech", 1.0, 1.4)], clips: [clip], rules: rules() })
  expect(plan.beats[0]!.pieces).toEqual([])
  expect(plan.beats[0]!.notes).toEqual(["nothing-left"])
  expect(plan.cuts).toEqual([])
})

test("without word times a speech beat is used as the planner gave it", () => {
  const clip = { ...TALK, id: "plain", transcript: { ...TALK.transcript!, words: [] } }
  const plan = compileCuts({ beats: [beat("b1", "plain", "speech", 1.0, 7.2)], clips: [clip], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[1.0, 7.2]])
  expect(plan.beats[0]!.notes).toEqual(["no-word-timing"])
})

test("a scene beat stretches to a shot edge within one and a half seconds", () => {
  const clip = broll("gallery", 10, { sceneCutsUs: [s(4.0)] })
  const plan = compileCuts({ beats: [beat("b1", "gallery", "scenes", 0.5, 3.5)], clips: [clip], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[0, 4.0]])

  const far = compileCuts({ beats: [beat("b1", "gallery", "scenes", 5.8, 7.0)], clips: [clip], rules: rules() })
  expect(ranges(far.beats[0]!.pieces)).toEqual([[5.8, 7.0]])
})

test("blurry and black stretches are cut out of a scene beat when that rule is on", () => {
  const clip = broll("shaky", 10, { sceneCutsUs: [s(4.0)], blurry: [{ startUs: s(6.0), endUs: s(6.8) }], black: [{ startUs: s(9.0), endUs: s(9.2) }] })
  const on = compileCuts({ beats: [beat("b1", "shaky", "scenes", 4.5, 9.5)], clips: [clip], rules: rules() })
  expect(ranges(on.beats[0]!.pieces)).toEqual([
    [4.0, 6.0],
    [6.8, 9.0],
    [9.2, 10.0],
  ])
  expect(on.beats[0]!.removals).toEqual([
    { reason: "bad-picture", startUs: s(6.0), endUs: s(6.8), text: "" },
    { reason: "bad-picture", startUs: s(9.0), endUs: s(9.2), text: "" },
  ])

  const off = compileCuts({ beats: [beat("b1", "shaky", "scenes", 4.5, 9.5)], clips: [clip], rules: rules({ cutBadPicture: false }) })
  expect(ranges(off.beats[0]!.pieces)).toEqual([[4.0, 10.0]])
})

test("slivers of picture left between problems are dropped rather than flashed on screen", () => {
  const clip = broll("mostly-bad", 10, { blurry: [{ startUs: s(3.2), endUs: s(6.8) }] })
  const plan = compileCuts({ beats: [beat("b1", "mostly-bad", "scenes", 3.0, 7.0)], clips: [clip], rules: rules() })
  expect(plan.beats[0]!.pieces).toEqual([])
  expect(plan.beats[0]!.notes).toEqual(["nothing-left"])
})

test("a scene beat does not start or stop in the middle of a spoken word", () => {
  const clip = broll("voice", 10, {}, "ครับ@1.80-2.30 สวัสดี@2.80-3.40")
  const plan = compileCuts({ beats: [beat("b1", "voice", "scenes", 2.0, 3.0)], clips: [clip], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[2.3, 2.8]])
})

test("the plan lists every kept piece in playing order as cuts on the media bin videos", () => {
  const clip = broll("gallery", 10, { sceneCutsUs: [s(4.0)] })
  const plan = compileCuts({
    beats: [beat("b2", "gallery", "scenes", 0.5, 3.5), beat("b1", "talk", "speech", 1.0, 7.2)],
    clips: [TALK, clip],
    rules: rules({ cutFillers: false }),
  })
  expect(plan.cuts).toEqual([
    { binId: "gallery", sourceStartUs: 0, sourceDurationUs: s(4.0) },
    { binId: "talk", sourceStartUs: s(0.85), sourceDurationUs: s(1.1) },
    { binId: "talk", sourceStartUs: s(2.45), sourceDurationUs: s(2.5) },
    { binId: "talk", sourceStartUs: s(5.85), sourceDurationUs: s(1.5) },
  ])
  expect(plan.durationUs).toBe(s(9.1))
})

test("pieces stay inside the source file", () => {
  const clip = talk("end", 2, ["จบ@1.5-1.95"], "จบ@1.50-1.95")
  const plan = compileCuts({ beats: [beat("b1", "end", "speech", 1.5, 1.95)], clips: [clip], rules: rules() })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[1.35, 2.0]])
})

test("a beat on a video that was not analysed is an error", () => {
  expect(() => compileCuts({ beats: [beat("b1", "missing", "speech", 1, 2)], clips: [TALK], rules: rules() })).toThrow(/missing/)
})

/** A level every 10 ms: `base` everywhere, with the given stretches (in seconds) set to their own level. */
function loudness(durationSec: number, base: number, stretches: [number, number, number][] = []): Loudness {
  const db = Array.from({ length: Math.round(durationSec * 100) }, (_, i) => {
    const t = i / 100
    return stretches.find(([from, to]) => t >= from - 1e-9 && t < to - 1e-9)?.[2] ?? base
  })
  return { stepUs: 10_000, db }
}

const near = (actualUs: number, expectedSec: number, toleranceSec: number) =>
  expect(Math.abs(actualUs - s(expectedSec)), `${actualUs / 1e6} vs ${expectedSec}`).toBeLessThanOrEqual(s(toleranceSec))

test("a cut between two words lands in the quiet between them, even when the word times are late", () => {
  // what whisper did on IMG_9646.MOV: "สาม" timed at 19.78 s, but its sound starts at 19.72 s
  const heard = { ...COUNTDOWN, loudness: loudness(31.106, -60, [[19.2, 19.5, -25], [19.72, 21.2, -25], [21.56, 22.06, -25], [22.62, 25.25, -25]]) }
  const plan = compileCuts({ beats: [beat("b1", "astronaut", "speech", 16.06, 25.25)], clips: [heard], rules: rules() })
  const [first, second] = plan.beats[0]!.pieces
  expect(first!.endUs).toBeLessThanOrEqual(s(19.72))
  expect(first!.endUs).toBeGreaterThanOrEqual(s(19.5))
  expect(plan.beats[0]!.removals[0]).toMatchObject({ reason: "retake", startUs: first!.endUs, endUs: second!.startUs })
})

test("a start edge moves back to the quiet before a word that begins earlier than its timing says", () => {
  // tight padding would start at 1.42 s, but the word is already sounding from 1.38 s
  const clip = { ...talk("early", 5, ["สวัสดี@1.5-2.0"], "สวัสดี@1.50-2.00"), loudness: loudness(5, -60, [[1.38, 2.0, -20]]) }
  const plan = compileCuts({ beats: [beat("b1", "early", "speech", 1.5, 2.0)], clips: [clip], rules: rules({ preset: "tight" }) })
  expect(plan.beats[0]!.pieces[0]!.startUs).toBeLessThanOrEqual(s(1.38))
})

test("with even loudness the edges stay where the word times put them", () => {
  const clip = { ...TALK, loudness: loudness(20, -30) }
  const plan = compileCuts({ beats: [beat("b1", "talk", "speech", 1.0, 7.2)], clips: [clip], rules: rules({ cutFillers: false }) })
  const pieces = plan.beats[0]!.pieces
  const expected = [
    [0.85, 1.95],
    [2.45, 4.95],
    [5.85, 7.35],
  ]
  pieces.forEach((piece, i) => {
    near(piece.startUs, expected[i]![0]!, 0.005)
    near(piece.endUs, expected[i]![1]!, 0.005)
  })
})

test("an edge never moves more than halfway into a word that is kept", () => {
  // the only quiet spot is in the first half of "ครับ", which stays; the filler after it goes
  const clip = { ...talk("half", 5, ["ครับ เอ่อ ผม@1.5-2.0"], "ครับ@1.50-1.60 เอ่อ@1.60-1.90 ผม@1.90-2.00"), loudness: loudness(5, -20, [[1.5, 1.54, -70]]) }
  const plan = compileCuts({ beats: [beat("b1", "half", "speech", 1.5, 2.0)], clips: [clip], rules: rules() })
  expect(plan.beats[0]!.pieces[0]!.endUs).toBeGreaterThanOrEqual(s(1.55))
  expect(plan.beats[0]!.removals.map((r) => r.reason)).toEqual(["filler"])
})

const decide = (extra: Partial<VideoCutDecisions>): VideoCutDecisions => ({
  transcript: "t",
  keepWords: [],
  cutWords: [],
  keepPauses: [],
  keepProblems: [],
  cutPieces: [],
  ...extra,
})
const rowsOf = (plan: ReturnType<typeof compileCuts>) =>
  plan.beats[0]!.rows.map((row) => [row.state, row.reason, row.startUs / 1e6, row.endUs / 1e6, row.text, row.toggle])

test("each beat lists what is used, sentence by sentence, and what is cut and why, with what flipping it would store", () => {
  const plan = compileCuts({ beats: [beat("b1", "talk", "speech", 1.0, 7.2)], clips: [TALK], rules: rules() })
  expect(rowsOf(plan)).toEqual([
    ["used", null, 1.0, 1.8, "สวัสดีครับ", { type: "words", indexes: [0, 1], keep: false }],
    ["cut", "pause", 1.95, 2.45, "", { type: "pause", after: 1, keep: true }],
    ["used", null, 2.6, 3.2, "วันนี้เรา", { type: "words", indexes: [2, 3], keep: false }],
    ["cut", "filler", 3.3, 3.7, "เอ่อ", { type: "words", indexes: [4], keep: true }],
    ["used", null, 3.8, 4.8, "จะมารีวิว", { type: "words", indexes: [5, 6, 7], keep: false }],
    ["cut", "pause", 4.95, 5.85, "", { type: "pause", after: 7, keep: true }],
    ["used", null, 6.0, 7.2, "กล้องตัวใหม่", { type: "words", indexes: [8, 9], keep: false }],
  ])
})

test("a filler the user keeps stays in, and flipping it again returns it to the rules", () => {
  const plan = compileCuts({ beats: [beat("b1", "talk", "speech", 2.6, 4.8)], clips: [TALK], rules: rules(), decisions: { talk: decide({ keepWords: [4] }) } })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([[2.45, 4.95]])
  expect(plan.beats[0]!.removals).toEqual([])
  expect(rowsOf(plan)).toEqual([
    ["used", null, 2.6, 3.2, "วันนี้เรา", { type: "words", indexes: [2, 3], keep: false }],
    ["kept", "filler", 3.3, 3.7, "เอ่อ", { type: "words", indexes: [4], keep: null }],
    ["used", null, 3.8, 4.8, "จะมารีวิว", { type: "words", indexes: [5, 6, 7], keep: false }],
  ])
})

test("a sentence the user cuts goes, as a cut of their own", () => {
  const plan = compileCuts({ beats: [beat("b1", "talk", "speech", 1.0, 7.2)], clips: [TALK], rules: rules(), decisions: { talk: decide({ cutWords: [8, 9] }) } })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([
    [0.85, 1.95],
    [2.45, 3.3],
    [3.7, 4.95],
  ])
  expect(plan.beats[0]!.removals.at(-1)).toEqual({ reason: "user", startUs: s(4.95), endUs: s(7.2), text: "กล้อง ตัวใหม่" })
  expect(rowsOf(plan).at(-1)).toEqual(["cut", "user", 6.0, 7.2, "กล้องตัวใหม่", { type: "words", indexes: [8, 9], keep: null }])
})

test("a pause the user keeps is not cut, whatever the preset", () => {
  for (const preset of ["tight", "normal"] as const) {
    const plan = compileCuts({ beats: [beat("b1", "talk", "speech", 1.0, 3.2)], clips: [TALK], rules: rules({ preset }), decisions: { talk: decide({ keepPauses: [1] }) } })
    expect(plan.beats[0]!.pieces).toHaveLength(1)
    expect(rowsOf(plan)).toContainEqual(["kept", "pause", 1.8, 2.6, "", { type: "pause", after: 1, keep: null }])
  }
})

test("an earlier take is one row across sentences, and keeping it keeps both takes", () => {
  const cut = compileCuts({ beats: [beat("b1", "astronaut", "speech", 16.06, 25.25)], clips: [COUNTDOWN], rules: rules() })
  expect(rowsOf(cut)).toEqual([
    ["used", null, 16.06, 19.78, "และผมก็กำลังจะขึ้นไปในอวกาศใน", { type: "words", indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], keep: false }],
    ["cut", "retake", 19.78, 22.06, "สามสองหนึ่ง", { type: "words", indexes: [10, 11, 12], keep: true }],
    ["used", null, 22.62, 25.25, "สามสองหนึ่ง", { type: "words", indexes: [13, 14, 15], keep: false }],
  ])

  const kept = compileCuts({
    beats: [beat("b1", "astronaut", "speech", 16.06, 25.25)],
    clips: [COUNTDOWN],
    rules: rules(),
    decisions: { astronaut: decide({ keepWords: [10, 11, 12] }) },
  })
  expect(ranges(kept.beats[0]!.pieces)).toEqual([[15.91, 25.4]])
  expect(rowsOf(kept)[1]).toEqual(["kept", "retake", 19.78, 22.06, "สามสองหนึ่ง", { type: "words", indexes: [10, 11, 12], keep: null }])
})

test("a short word the user cuts goes even when the quiet spots on either side of it meet", () => {
  // the only quiet is a breath just before "ก็", so both edges want the same spot
  const clip = { ...talk("breath", 3, ["ร้านก็อร่อย@1.0-2.0"], "ร้าน@1.00-1.40 ก็@1.44-1.55 อร่อย@1.55-2.00"), loudness: loudness(3, -20, [[1.4, 1.44, -45]]) }
  const plan = compileCuts({ beats: [beat("b1", "breath", "speech", 1.0, 2.0)], clips: [clip], rules: rules(), decisions: { breath: decide({ cutWords: [1] }) } })
  const [cut] = plan.beats[0]!.removals
  expect(cut).toMatchObject({ reason: "user", text: "ก็" })
  // nothing that plays overlaps the word
  for (const piece of plan.beats[0]!.pieces) expect(piece.endUs <= s(1.44) || piece.startUs >= s(1.55)).toBe(true)
  expect(plan.beats[0]!.pieces).toHaveLength(2)
})

test("a cut never leaves a sliver of a piece the writer cannot place, nor a piece that ends before it starts", () => {
  // a 39 ms word kept between two fillers, with the quiet on either side of it
  const sliver = { ...talk("sliver", 3, ["ก เอ่อ ข เอ่อ ค@0-1.5"], "ก@0.00-0.50 เอ่อ@0.55-0.91 ข@0.91-0.949 เอ่อ@0.949-1.00 ค@1.05-1.50"), loudness: loudness(3, -25, [[0.92, 0.93, -90], [0.96, 0.97, -90]]) }
  // word times that overlap, with two quiet spots inside them
  const tangled = { ...talk("tangled", 3, ["ก เอ่อ ข เอ่อ ค@0-2"], "ก@0.00-0.50 เอ่อ@0.95-1.00 ข@1.00-1.40 เอ่อ@1.10-1.25 ค@1.45-2.00"), loudness: loudness(3, -25, [[1.11, 1.12, -90], [1.2, 1.21, -90]]) }
  for (const clip of [sliver, tangled]) {
    const plan = compileCuts({ beats: [beat("b1", clip.id, "speech", 0, 2)], clips: [clip], rules: rules() })
    for (const piece of plan.beats[0]!.pieces) expect(piece.endUs - piece.startUs, JSON.stringify(piece)).toBeGreaterThanOrEqual(50_000)
    plan.beats[0]!.pieces.slice(1).forEach((piece, i) => expect(piece.startUs).toBeGreaterThanOrEqual(plan.beats[0]!.pieces[i]!.endUs))
  }
  // the fallback edges stay out of the middle of a kept word: "ข" still plays
  const plan = compileCuts({ beats: [beat("b1", "tangled", "speech", 0, 2)], clips: [tangled], rules: rules() })
  expect(plan.beats[0]!.pieces.some((piece) => piece.startUs <= s(1.2) && s(1.2) <= piece.endUs)).toBe(true)
  // a beat whose only kept word is a sliver has nothing left, and says so
  const lone = { ...talk("lone", 3, ["เอ่อ ข เอ่อ@0.5-1.0"], "เอ่อ@0.50-0.91 ข@0.91-0.93 เอ่อ@0.93-1.00"), loudness: loudness(3, -25, [[0.905, 0.915, -90], [0.925, 0.935, -90]]) }
  const nothing = compileCuts({ beats: [beat("b1", "lone", "speech", 0.5, 1.0)], clips: [lone], rules: rules({ preset: "tight" }) })
  expect(nothing.beats[0]!.pieces).toEqual([])
  expect(nothing.beats[0]!.notes).toEqual(["nothing-left"])
})

test("decisions for another video do not touch this one", () => {
  const plan = compileCuts({ beats: [beat("b1", "talk", "speech", 2.6, 4.8)], clips: [TALK], rules: rules(), decisions: { other: decide({ keepWords: [4] }) } })
  expect(plan.beats[0]!.removals.map((r) => r.reason)).toEqual(["filler"])
})

test("a blurry stretch the user keeps stays in a scene beat", () => {
  const clip = broll("shaky", 10, { sceneCutsUs: [s(4.0)], blurry: [{ startUs: s(6.0), endUs: s(6.8) }], black: [{ startUs: s(9.0), endUs: s(9.2) }] })
  const plan = compileCuts({
    beats: [beat("b1", "shaky", "scenes", 4.5, 9.5)],
    clips: [clip],
    rules: rules(),
    decisions: { shaky: decide({ keepProblems: [{ startUs: s(6.0), endUs: s(6.8) }] }) },
  })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([
    [4.0, 9.0],
    [9.2, 10.0],
  ])
  expect(rowsOf(plan)).toEqual([
    ["used", null, 4.0, 9.0, "", { type: "pieces", ranges: [{ startUs: s(4.0), endUs: s(9.0) }], keep: false }],
    ["kept", "bad-picture", 6.0, 6.8, "", { type: "problems", ranges: [{ startUs: s(6.0), endUs: s(6.8) }], keep: null }],
    ["cut", "bad-picture", 9.0, 9.2, "", { type: "problems", ranges: [{ startUs: s(9.0), endUs: s(9.2) }], keep: true }],
    ["used", null, 9.2, 10.0, "", { type: "pieces", ranges: [{ startUs: s(9.2), endUs: s(10.0) }], keep: false }],
  ])
})

test("a piece of picture the user cuts goes from a scene beat", () => {
  const clip = broll("shaky", 10, { sceneCutsUs: [s(4.0)], blurry: [{ startUs: s(6.0), endUs: s(6.8) }], black: [{ startUs: s(9.0), endUs: s(9.2) }] })
  const cutRange = { startUs: s(6.8), endUs: s(9.0) }
  const plan = compileCuts({ beats: [beat("b1", "shaky", "scenes", 4.5, 9.5)], clips: [clip], rules: rules(), decisions: { shaky: decide({ cutPieces: [cutRange] }) } })
  expect(ranges(plan.beats[0]!.pieces)).toEqual([
    [4.0, 6.0],
    [9.2, 10.0],
  ])
  expect(plan.beats[0]!.keptUs).toBe(s(2.8))
  expect(plan.beats[0]!.removals).toContainEqual({ reason: "user", startUs: s(6.8), endUs: s(9.0), text: "" })
  expect(rowsOf(plan)).toContainEqual(["cut", "user", 6.8, 9.0, "", { type: "pieces", ranges: [cutRange], keep: null }])
  // flipping a bad-picture cut keeps only the problem that made it
  expect(rowsOf(plan)).toContainEqual(["cut", "bad-picture", 6.0, 6.8, "", { type: "problems", ranges: [{ startUs: s(6.0), endUs: s(6.8) }], keep: true }])
})
