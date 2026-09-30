import { describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TimedText } from "../asr/types.ts"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import type { FrameImage } from "./frames.ts"
import { findRetakes, RETAKE_PROMPT, RetakeReplySchema, retakeLoad, reviewRetake, takeFrameTimes, type Retake } from "./retakes.ts"

const s = (seconds: number) => Math.round(seconds * 1_000_000)
const timed = (text: string, start: number, end: number): TimedText => ({ text, startUs: s(start), endUs: s(end) })

describe("findRetakes", () => {
  test("a countdown started again is a retake: the two takes with their times and words", () => {
    // whisper.cpp on IMG_9646.MOV (0917)
    const utterances = [timed("ขึ้นไปในอวกาศ ในสาม สอง", 17.16, 21.14), timed("หนึ่ง", 21.56, 22.06), timed("สาม สอง หนึ่ง", 22.62, 25.25)]
    const words = [
      timed("ขึ้น", 17.16, 17.44),
      timed("ไป", 17.44, 17.68),
      timed("ใน", 17.68, 18.08),
      timed("อวกาศ", 18.08, 18.75),
      timed("ใน", 19.0, 19.78),
      timed("สาม", 19.78, 20.51),
      timed("สอง", 20.66, 21.14),
      timed("หนึ่ง", 21.56, 22.06),
      timed("สาม", 22.62, 23.58),
      timed("สอง", 23.88, 24.84),
      timed("หนึ่ง", 24.84, 25.25),
    ]
    expect(findRetakes({ utterances, words })).toEqual([
      {
        takes: [
          { startUs: s(19.78), endUs: s(22.06), text: "สามสองหนึ่ง" },
          { startUs: s(22.62), endUs: s(25.25), text: "สามสองหนึ่ง" },
        ],
      },
    ])
  })

  test("a sentence said again in full is one retake of the two sentences, even though its words repeat too", () => {
    const utterances = [timed("เขาต้องไปด้วยกระสวยอวกาศเท่านั้น", 10, 13), timed("เขาต้องไปด้วยกับสวยอวกาศเท่านั้น", 14, 17)]
    const said = (start: number, vehicle: string[]) =>
      ["เขา", "ต้อง", "ไป", "ด้วย", ...vehicle, "อวกาศ", "เท่านั้น"].map((text, i, all) => timed(text, start + (i * 3) / all.length, start + ((i + 1) * 3) / all.length))
    const words = [...said(10, ["กระสวย"]), ...said(14, ["กับ", "สวย"])]
    expect(findRetakes({ utterances, words })).toEqual([
      {
        takes: [
          { startUs: s(10), endUs: s(13), text: "เขาต้องไปด้วยกระสวยอวกาศเท่านั้น" },
          { startUs: s(14), endUs: s(17), text: "เขาต้องไปด้วยกับสวยอวกาศเท่านั้น" },
        ],
      },
    ])
  })

  test("a stumble inside a sentence that is then said again in full is not reviewed on its own", () => {
    const utterances = [timed("เขาต้องเขาต้องไปด้วยกระสวยอวกาศเท่านั้น", 10, 13.5), timed("เขาต้องไปด้วยกระสวยอวกาศเท่านั้น", 14.5, 17.5)]
    const line = ["เขา", "ต้อง", "ไป", "ด้วย", "กระสวย", "อวกาศ", "เท่านั้น"]
    const words = [
      timed("เขา", 10, 10.3),
      timed("ต้อง", 10.3, 10.6),
      ...line.map((text, i) => timed(text, 11 + i * 0.35, 11.35 + i * 0.35)),
      ...line.map((text, i) => timed(text, 14.5 + i * 0.4, 14.9 + i * 0.4)),
    ]
    expect(findRetakes({ utterances, words }).map((retake) => retake.takes.map((take) => take.text))).toEqual([
      ["เขาต้องเขาต้องไปด้วยกระสวยอวกาศเท่านั้น", "เขาต้องไปด้วยกระสวยอวกาศเท่านั้น"],
    ])
  })

  test("a phrase first said at the end of a repeated sentence and started again after it is a retake of its own", () => {
    const utterances = [timed("สวัสดีครับทุกคน", 1, 2), timed("สวัสดีครับทุกคนวันนี้มารีวิว", 3, 5), timed("วันนี้มารีวิวแอปตัดต่อ", 6, 8)]
    const words = [
      ...["สวัสดี", "ครับ", "ทุก", "คน"].map((text, i) => timed(text, 1 + i * 0.25, 1.25 + i * 0.25)),
      ...["สวัสดี", "ครับ", "ทุก", "คน"].map((text, i) => timed(text, 3 + i * 0.25, 3.25 + i * 0.25)),
      timed("วันนี้", 4, 4.4),
      timed("มา", 4.4, 4.6),
      timed("รีวิว", 4.6, 5),
      timed("วันนี้", 6, 6.4),
      timed("มา", 6.4, 6.6),
      timed("รีวิว", 6.6, 7),
      timed("แอป", 7, 7.4),
      timed("ตัดต่อ", 7.4, 8),
    ]
    expect(findRetakes({ utterances, words }).map((retake) => retake.takes.map((take) => take.text))).toEqual([
      ["สวัสดีครับทุกคน", "สวัสดีครับทุกคนวันนี้มารีวิว"],
      ["วันนี้มารีวิว", "วันนี้มารีวิว"],
    ])
  })

  test("speech without repeats has no retakes", () => {
    expect(findRetakes({ utterances: [timed("สวัสดีครับ", 0, 1)], words: [timed("สวัสดี", 0, 0.5), timed("ครับ", 0.5, 1)] })).toEqual([])
  })
})

describe("takeFrameTimes", () => {
  test("a frame every half second through the take", () => {
    expect(takeFrameTimes({ startUs: s(19.78), endUs: s(22.06), text: "" })).toEqual([19_780_000, 20_280_000, 20_780_000, 21_280_000, 21_780_000])
  })

  test("a long take gets eight frames spread evenly, a very short one a frame in its middle", () => {
    expect(takeFrameTimes({ startUs: 0, endUs: s(10), text: "" })).toEqual([0, 1_250_000, 2_500_000, 3_750_000, 5_000_000, 6_250_000, 7_500_000, 8_750_000])
    expect(takeFrameTimes({ startUs: s(1), endUs: s(1.2), text: "" })).toEqual([1_100_000])
  })
})

describe("reviewRetake", () => {
  const countdown: Retake = {
    takes: [
      { startUs: s(19.78), endUs: s(22.06), text: "สามสองหนึ่ง" },
      { startUs: s(22.62), endUs: s(25.25), text: "สามสองหนึ่ง" },
    ],
  }
  const words = [
    timed("ใน", 19.0, 19.78),
    timed("สาม", 19.78, 20.51),
    timed("สอง", 20.66, 21.14),
    timed("หนึ่ง", 21.56, 22.06),
    timed("สาม", 22.62, 23.58),
    timed("สอง", 23.88, 24.84),
    timed("หนึ่ง", 24.84, 25.25),
  ]

  async function frames(times: number[]): Promise<FrameImage[]> {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-retake-"))
    return Promise.all(
      times.map(async (seconds) => {
        const path = join(dir, `${seconds}.jpg`)
        await writeFile(path, `jpeg ${seconds}`)
        return { atUs: s(seconds), path }
      }),
    )
  }

  function fakeTransport() {
    const requests: LlmRequest<unknown>[] = []
    const transport: LlmTransport = {
      id: "claude-cli",
      async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
        requests.push(request as LlmRequest<unknown>)
        const output = { takeA: "ชูนิ้วสามตอนพูดสอง", takeB: "นิ้วตรงกับตัวเลขทุกคำ", better: "B", reason: "เทค B ชูนิ้วตรงกับที่พูด" }
        return { output: output as T, usage: { inputTokens: 2000, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 } }
      },
    }
    return { transport, requests }
  }

  const describePart = (part: LlmContent) => (part.type === "text" ? part.text : `[image ${Buffer.from(part.data, "base64").toString()}]`)

  test("shows Claude each take's words with their times, then that take's frames, and asks which take to use", async () => {
    const { transport, requests } = fakeTransport()
    await reviewRetake({ transport, model: "claude-opus-5", retake: countdown, words, frames: [await frames([19.78, 20.28]), await frames([22.62])] })

    const request = requests[0]!
    expect(request.model).toBe("claude-opus-5")
    expect(request.system).toBe(RETAKE_PROMPT)
    expect(request.schema).toBe(RetakeReplySchema)
    // room for the thinking as well as the reply, at any effort
    expect(request.maxTokens).toBe(16_000)
    expect(request.content.map(describePart)).toEqual([
      "เทค A · 19.8–22.1 วินาที\nคำพูด: สาม (19.8) สอง (20.7) หนึ่ง (21.6)",
      "เทค A · เวลา 19.8 วินาที",
      "[image jpeg 19.78]",
      "เทค A · เวลา 20.3 วินาที",
      "[image jpeg 20.28]",
      "เทค B · 22.6–25.3 วินาที\nคำพูด: สาม (22.6) สอง (23.9) หนึ่ง (24.8)",
      "เทค B · เวลา 22.6 วินาที",
      "[image jpeg 22.62]",
      "เทียบเทค A กับเทค B",
    ])
  })

  test("the reply becomes the review of the retake", async () => {
    const { transport } = fakeTransport()
    const { review, usage } = await reviewRetake({ transport, model: "claude-opus-5", retake: countdown, words, frames: [await frames([19.78]), await frames([22.62])] })
    expect(review).toEqual({ takes: countdown.takes, notes: ["ชูนิ้วสามตอนพูดสอง", "นิ้วตรงกับตัวเลขทุกคำ"], better: "B", reason: "เทค B ชูนิ้วตรงกับที่พูด" })
    expect(usage.inputTokens).toBe(2000)
  })
})

test("what comparing a video's lines said twice takes: one comparison each, with the pictures of both takes", () => {
  const utterances = [timed("เขาต้องไปด้วยกระสวยอวกาศเท่านั้น", 10, 13), timed("เขาต้องไปด้วยกับสวยอวกาศเท่านั้น", 14, 17)]
  const said = (start: number, vehicle: string[]) =>
    ["เขา", "ต้อง", "ไป", "ด้วย", ...vehicle, "อวกาศ", "เท่านั้น"].map((text, i, all) => timed(text, start + (i * 3) / all.length, start + ((i + 1) * 3) / all.length))
  const words = [...said(10, ["กระสวย"]), ...said(14, ["กับ", "สวย"])]
  // two 3 s takes, a picture every half second: seven each
  expect(retakeLoad({ utterances, words })).toEqual({ reviews: 1, frames: 14 })
  expect(retakeLoad({ utterances: [], words: [] })).toEqual({ reviews: 0, frames: 0 })
})
