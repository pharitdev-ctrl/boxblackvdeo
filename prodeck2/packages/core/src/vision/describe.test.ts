import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import { describeVideo, PROMPT_VERSION, VISION_PROMPT, type FrameBatchReply } from "./describe.ts"
import type { VideoSignals } from "./signals.ts"

const noSignals: VideoSignals = { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] }

async function frames(timesUs: number[]) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-describe-"))
  return Promise.all(
    timesUs.map(async (atUs) => {
      const path = join(dir, `frame-${atUs}.jpg`)
      await writeFile(path, `jpeg-${atUs}`)
      return { atUs, path }
    }),
  )
}

/** Replies with one scene covering each batch, and records every request. */
function fakeTransport(reply?: (request: LlmRequest<unknown>, call: number) => FrameBatchReply) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const times = request.content.flatMap((c) => (c.type === "text" ? [...c.text.matchAll(/เวลา ([\d.]+) วินาที/g)] : [])).map((m) => Number(m[1]))
      const output: FrameBatchReply = reply?.(request as LlmRequest<unknown>, requests.length) ?? {
        summary: `ชุดที่ ${requests.length}`,
        scenes: [{ startSec: times[0]!, endSec: times.at(-1)!, description: "ชายหนุ่มพูดกับกล้อง", kind: "talking-head", issues: [], keepClear: [0.1, 0.45] }],
      }
      return { output: output as T, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, requests }
}

const base = { model: "claude-opus-5", durationUs: 30_000_000, signals: noSignals, utterances: [], batchSize: 10 }

test("labels every frame with its time and sends it as a JPEG", async () => {
  const { transport, requests } = await fakeTransport()
  await describeVideo({ ...base, transport, frames: await frames([500_000, 3_500_000]) })
  const content = requests[0]!.content
  expect(content.slice(0, 4)).toEqual([
    { type: "text", text: "ภาพที่ 1 · เวลา 0.5 วินาที" },
    { type: "image", mediaType: "image/jpeg", data: Buffer.from("jpeg-500000").toString("base64") },
    { type: "text", text: "ภาพที่ 2 · เวลา 3.5 วินาที" },
    { type: "image", mediaType: "image/jpeg", data: Buffer.from("jpeg-3500000").toString("base64") },
  ])
})

test("gives the model what was said and the measured problems as context", async () => {
  const { transport, requests } = await fakeTransport()
  await describeVideo({
    ...base,
    transport,
    frames: await frames([500_000]),
    utterances: [{ text: "เอาล่ะครับวันนี้", startUs: 1_900_000, endUs: 7_040_000 }],
    signals: { ...noSignals, blurry: [{ startUs: 8_000_000, endUs: 9_500_000 }] },
  })
  const context = requests[0]!.content.at(-1)
  expect(context).toMatchObject({ type: "text" })
  const text = (context as { text: string }).text
  expect(text).toContain("1.9–7.0 วินาที: เอาล่ะครับวันนี้")
  expect(text).toContain("ภาพเบลอ 8.0–9.5 วินาที")
})

test("uses the chosen model with a system prompt and a reply schema", async () => {
  const { transport, requests } = await fakeTransport()
  await describeVideo({ ...base, transport, frames: await frames([500_000]) })
  expect(requests[0]!.model).toBe("claude-opus-5")
  expect(requests[0]!.system).toContain("ภาษาไทย")
  expect(requests[0]!.schema.safeParse({ summary: "x", scenes: [] }).success).toBe(true)
})

test("sends long videos in batches and joins the scenes in time order", async () => {
  const { transport, requests } = await fakeTransport()
  const insight = await describeVideo({ ...base, transport, batchSize: 2, frames: await frames([500_000, 3_500_000, 6_500_000]) })
  expect(requests).toHaveLength(2)
  expect(insight.scenes.map((s) => [s.startUs, s.endUs])).toEqual([
    [500_000, 3_500_000],
    [6_500_000, 6_500_000],
  ])
  expect(insight.summary).toBe("ชุดที่ 1\nชุดที่ 2")
})

test("keeps scene times inside the video and in order even if the model is sloppy", async () => {
  const { transport } = await fakeTransport(() => ({
    summary: "s",
    scenes: [
      { startSec: 20, endSec: 99, description: "b", kind: "b-roll", issues: [], keepClear: [] },
      { startSec: -3, endSec: 5, description: "a", kind: "talking-head", issues: ["เบลอ"], keepClear: [] },
    ],
  }))
  const insight = await describeVideo({ ...base, transport, frames: await frames([500_000]) })
  expect(insight.scenes).toEqual([
    { startUs: 0, endUs: 5_000_000, description: "a", kind: "talking-head", issues: ["เบลอ"], keepClear: null },
    { startUs: 20_000_000, endUs: 30_000_000, description: "b", kind: "b-roll", issues: [], keepClear: null },
  ])
})

test("records model, prompt version, signals and total token use", async () => {
  const { transport } = await fakeTransport()
  const insight = await describeVideo({ ...base, transport, batchSize: 1, frames: await frames([500_000, 3_500_000]) })
  expect(insight).toMatchObject({
    model: "claude-opus-5",
    promptVersion: PROMPT_VERSION,
    frameCount: 2,
    signals: noSignals,
    usage: { inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })
})

test("reports progress after each batch", async () => {
  const { transport } = await fakeTransport()
  const progress: number[] = []
  await describeVideo({
    ...base,
    transport,
    batchSize: 1,
    frames: await frames([500_000, 3_500_000]),
    onProgress: (fraction) => progress.push(fraction),
  })
  expect(progress).toEqual([0.5, 1])
})

test("a video with no frames needs no model call", async () => {
  const { transport, requests } = await fakeTransport()
  const insight = await describeVideo({ ...base, transport, frames: [] })
  expect(requests).toHaveLength(0)
  expect(insight.scenes).toEqual([])
})

test("a system prompt handed in replaces the built-in one, and its version is recorded", async () => {
  const { transport, requests } = fakeTransport()
  const insight = await describeVideo({ ...base, transport, frames: await frames([500_000]), prompt: { system: "บรรยายสั้นๆ", version: "vision-server-abc" } })
  expect(requests[0]!.system).toBe("บรรยายสั้นๆ")
  expect(insight.promptVersion).toBe("vision-server-abc")
})

test("gestures that go with the words are not listed as problems", () => {
  expect(VISION_PROMPT.system).toContain("ท่าทางที่เป็นส่วนหนึ่งของการพูด")
})

test("each scene says which band of the frame must stay clear", async () => {
  const { transport, requests } = await fakeTransport()
  const insight = await describeVideo({ ...base, transport, frames: await frames([500_000]) })
  expect(insight.scenes[0]!.keepClear).toEqual({ fromY: 0.1, toY: 0.45 })
  expect(requests[0]!.schema.safeParse({ summary: "x", scenes: [{ startSec: 0, endSec: 1, description: "d", kind: "b-roll", issues: [], keepClear: [0, 1] }] }).success).toBe(true)
  expect(requests[0]!.schema.safeParse({ summary: "x", scenes: [{ startSec: 0, endSec: 1, description: "d", kind: "b-roll", issues: [] }] }).success).toBe(false)
})

test("a band that makes no sense is taken as no band at all", async () => {
  const answers = [[], [0.4], [0.6, 0.2], [0.2, 0.2], [-0.1, 0.5], [0.5, 1.4], [0.2, 0.5, 0.9], [Number.NaN, 0.5]]
  const { transport } = await fakeTransport((_request, call) => ({
    summary: "s",
    scenes: [{ startSec: 0, endSec: 1, description: "d", kind: "b-roll", issues: [], keepClear: answers[call - 1]! }],
  }))
  for (const answer of answers) {
    const insight = await describeVideo({ ...base, transport, frames: await frames([500_000]) })
    expect(insight.scenes[0]!.keepClear, JSON.stringify(answer)).toBeNull()
  }
})

test("the prompt asks only for what must not be covered", () => {
  expect(VISION_PROMPT.system).toContain("keepClear")
  expect(VISION_PROMPT.system).toContain("ใบหน้า")
  expect(VISION_PROMPT.system).toContain("ไม่นับลำตัว")
  expect(PROMPT_VERSION).toBe("vision-2026-09-18-keepclear")
})
