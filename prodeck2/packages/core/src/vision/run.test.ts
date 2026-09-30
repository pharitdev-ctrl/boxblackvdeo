import { expect, test } from "vitest"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MediaCache } from "../cache.ts"
import type { TimedText } from "../asr/types.ts"
import type { LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import { VISION_PROMPT, type VideoInsight } from "./describe.ts"
import { RETAKE_PROMPT } from "./retakes.ts"
import { cachedInsight, describeVideos, insightFits, type VisionEvent, type VisionKey, type VisionTools } from "./run.ts"
import type { VideoSignals } from "./signals.ts"

const noSignals: VideoSignals = { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] }

async function setup(names: string[], words: TimedText[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-vision-run-"))
  const videos = []
  for (const name of names) {
    const path = join(dir, name)
    await writeFile(path, `video ${name}`)
    videos.push({ id: name, path, durationUs: 10_000_000, utterances: [], words })
  }
  return { videos, workDir: join(dir, "work"), cache: new MediaCache<VideoInsight, VisionKey>(join(dir, "cache")) }
}

function fakeTools(overrides: Partial<VisionTools> = {}): VisionTools & { measured: string[]; extracted: number[][] } {
  const measured: string[] = []
  const extracted: number[][] = []
  return {
    measured,
    extracted,
    hasAudio: async () => true,
    measure: async (input, _durationUs, _hasAudio, _signal, onProgress) => {
      measured.push(input)
      onProgress?.(0.5)
      return noSignals
    },
    extractFrames: async (_input, timesUs, outDir) => {
      extracted.push(timesUs)
      return Promise.all(
        timesUs.map(async (atUs) => {
          const path = join(outDir, `frame-${atUs}.jpg`)
          await writeFile(path, `jpeg ${atUs}`)
          return { atUs, path }
        }),
      )
    },
    ...overrides,
  }
}

function fakeTransport(fail?: (call: number) => Error | null): LlmTransport & { calls: number; requests: LlmRequest<unknown>[] } {
  const transport = {
    id: "claude-cli" as const,
    calls: 0,
    requests: [] as LlmRequest<unknown>[],
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      transport.calls += 1
      transport.requests.push(request as LlmRequest<unknown>)
      const error = fail?.(transport.calls)
      if (error) throw error
      if (request.system === RETAKE_PROMPT) {
        const output = { takeA: "นิ้วไม่ตรง", takeB: "นิ้วตรงกับตัวเลข", better: "B", reason: "เทค B ชูนิ้วตรงกับที่พูด" }
        return { output: output as T, usage: { inputTokens: 2000, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } }
      }
      const output = { summary: "สรุป", scenes: [{ startSec: 0.5, endSec: 9.5, description: "คนพูด", kind: "talking-head", issues: [], keepClear: [0.1, 0.5] }] }
      return { output: output as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return transport
}

const options = { model: "claude-opus-5", intervalUs: 3_000_000, maxFrames: 120, batchSize: 30 }

test("describes every video and reports each one's steps", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  const events: VisionEvent[] = []
  const result = await describeVideos({ ...options, videos, transport: fakeTransport(), tools: fakeTools(), cache, workDir, onEvent: (e) => events.push(e) })
  expect(result.get("a.mov")!.scenes[0]!.description).toBe("คนพูด")
  expect(events.map((e) => e.status.state)).toEqual(["queued", "measuring", "measuring", "describing", "describing", "done"])
})

test("a cached insight skips measuring and the model", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  const tools = fakeTools()
  const transport = fakeTransport()
  await describeVideos({ ...options, videos, transport, tools, cache, workDir })
  const events: VisionEvent[] = []
  await describeVideos({ ...options, videos, transport, tools, cache, workDir, onEvent: (e) => events.push(e) })
  expect(tools.measured).toHaveLength(1)
  expect(transport.calls).toBe(1)
  expect(events.at(-1)!.status).toMatchObject({ state: "done", fromCache: true })
})

test("choosing another model is a cache miss", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  const transport = fakeTransport()
  await describeVideos({ ...options, videos, transport, tools: fakeTools(), cache, workDir })
  await describeVideos({ ...options, model: "claude-sonnet-5", videos, transport, tools: fakeTools(), cache, workDir })
  expect(transport.calls).toBe(2)
})

test("pictures described with other words are described again; ones described before the words were recorded are kept", async () => {
  const said = (text: string) => [{ text, startUs: 1_000_000, endUs: 2_000_000 }]
  const { videos, workDir, cache } = await setup(["a.mov"])
  const transport = fakeTransport()
  const withWords = (text: string) => videos.map((video) => ({ ...video, utterances: said(text), words: said(text) }))
  await describeVideos({ ...options, videos: withWords("สวัสดี"), transport, tools: fakeTools(), cache, workDir })
  // the same words: the cache answers
  await describeVideos({ ...options, videos: withWords("สวัสดี"), transport, tools: fakeTools(), cache, workDir })
  expect(transport.calls).toBe(1)
  // the speech read again, differently: the pictures are looked at with the new words
  const again = await describeVideos({ ...options, videos: withWords("หวัดดี"), transport, tools: fakeTools(), cache, workDir })
  expect(transport.calls).toBe(2)
  expect(insightFits(again.get("a.mov")!, { utterances: said("หวัดดี"), words: said("หวัดดี") })).toBe(true)
  expect(insightFits(again.get("a.mov")!, { utterances: said("สวัสดี"), words: said("สวัสดี") })).toBe(false)

  // back to the first words: what was described with them is still there
  await describeVideos({ ...options, videos: withWords("สวัสดี"), transport, tools: fakeTools(), cache, workDir })
  expect(transport.calls).toBe(2)

  // an insight saved before the words were recorded fits any words
  const entry = await cache.entry(videos[0]!.path, { model: options.model, promptVersion: VISION_PROMPT.version, intervalUs: options.intervalUs, maxFrames: options.maxFrames })
  const { speech: _speech, ...old } = again.get("a.mov")!
  await entry.put(old)
  await describeVideos({ ...options, videos: withWords("อะไรก็ได้"), transport, tools: fakeTools(), cache, workDir })
  expect(transport.calls).toBe(2)
  expect(insightFits(old, { utterances: [], words: [] })).toBe(true)
  // the same words split into other sentences are other words to describe with
  const split = [{ text: "สวัสดี", startUs: 1_000_000, endUs: 1_500_000 }]
  expect(insightFits(again.get("a.mov")!, { utterances: split, words: said("หวัดดี") })).toBe(false)
})

test("one failing video does not stop the others", async () => {
  const { videos, workDir, cache } = await setup(["bad.mov", "good.mov"])
  const events: VisionEvent[] = []
  const transport = fakeTransport((call) => (call === 1 ? new Error("Claude Code failed: overloaded") : null))
  const result = await describeVideos({ ...options, videos, transport, tools: fakeTools(), cache, workDir, onEvent: (e) => events.push(e) })
  expect([...result.keys()]).toEqual(["good.mov"])
  expect(events.find((e) => e.videoId === "bad.mov" && e.status.state === "failed")!.status).toEqual({
    state: "failed",
    error: "Claude Code failed: overloaded",
  })
})

test("extracted frames are deleted afterwards", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  await describeVideos({ ...options, videos, transport: fakeTransport(), tools: fakeTools(), cache, workDir })
  expect(await readdir(workDir)).toEqual([])
})

test("cancelling rejects the run", async () => {
  const { videos, workDir, cache } = await setup(["a.mov", "b.mov"])
  const controller = new AbortController()
  const transport = fakeTransport(() => {
    controller.abort()
    return new DOMException("The operation was aborted", "AbortError")
  })
  await expect(
    describeVideos({ ...options, videos, transport, tools: fakeTools(), cache, workDir, signal: controller.signal }),
  ).rejects.toThrow(/abort/i)
  expect(transport.calls).toBe(1)
})

test("a different system prompt is a cache miss and is the one sent", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  const systems: string[] = []
  const transport = fakeTransport()
  const generate = transport.generate.bind(transport)
  transport.generate = async (request) => {
    systems.push(request.system)
    return generate(request)
  }
  await describeVideos({ ...options, videos, transport, tools: fakeTools(), cache, workDir })
  await describeVideos({ ...options, videos, transport, tools: fakeTools(), cache, workDir, prompt: { system: "prompt ใหม่", version: "v-new" } })
  expect(transport.calls).toBe(2)
  expect(systems[1]).toBe("prompt ใหม่")
})

const timed = (text: string, start: number, end: number): TimedText => ({ text, startUs: start * 1_000_000, endUs: end * 1_000_000 })
// a countdown said, then said again after a pause
const countdown = [timed("สาม", 1, 1.3), timed("สอง", 1.4, 1.7), timed("หนึ่ง", 1.8, 2), timed("สาม", 3, 3.4), timed("สอง", 3.5, 3.9), timed("หนึ่ง", 3.9, 4.3)]

test("a line said twice has its takes looked at every half second and compared, and the review is kept", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"], countdown)
  const tools = fakeTools()
  const transport = fakeTransport()
  const insight = (await describeVideos({ ...options, videos, transport, tools, cache, workDir })).get("a.mov")!

  expect(tools.extracted.at(-1)).toEqual([1_000_000, 1_500_000, 2_000_000, 3_000_000, 3_500_000, 4_000_000])
  expect(transport.calls).toBe(2)
  // each take is shown with its own frames
  const shown = transport.requests[1]!.content.map((part) => (part.type === "image" ? Buffer.from(part.data, "base64").toString() : part.text.split("\n")[0]!))
  expect(shown.filter((part) => part.startsWith("jpeg") || /^เทค [AB] · \d/.test(part) && !part.includes("เวลา"))).toEqual([
    "เทค A · 1.0–2.0 วินาที",
    "jpeg 1000000",
    "jpeg 1500000",
    "jpeg 2000000",
    "เทค B · 3.0–4.3 วินาที",
    "jpeg 3000000",
    "jpeg 3500000",
    "jpeg 4000000",
  ])
  expect(insight.retakes).toEqual([
    {
      takes: [
        { startUs: 1_000_000, endUs: 2_000_000, text: "สามสองหนึ่ง" },
        { startUs: 3_000_000, endUs: 4_300_000, text: "สามสองหนึ่ง" },
      ],
      notes: ["นิ้วไม่ตรง", "นิ้วตรงกับตัวเลข"],
      better: "B",
      reason: "เทค B ชูนิ้วตรงกับที่พูด",
    },
  ])
  expect(insight.usage.inputTokens).toBe(2001)
  expect((await cachedInsight(cache, videos[0]!.path, { model: options.model, promptVersion: insight.promptVersion, intervalUs: options.intervalUs, maxFrames: options.maxFrames }, videos[0]!))!.retakes).toHaveLength(1)
  expect(await readdir(workDir)).toEqual([])
})

test("without repeated lines nothing more is extracted or asked", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  const tools = fakeTools()
  const transport = fakeTransport()
  const insight = (await describeVideos({ ...options, videos, transport, tools, cache, workDir })).get("a.mov")!
  expect(tools.extracted).toHaveLength(1)
  expect(transport.calls).toBe(1)
  expect(insight.retakes).toEqual([])
})

test("a comparison that fails keeps the pictures already described, and paid for", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"], countdown)
  const tools = fakeTools()
  // the describing call goes through; comparing the two takes is what breaks
  const transport = fakeTransport((call) => (call === 2 ? new Error("ffmpeg exited with code 234") : null))
  const insight = (await describeVideos({ ...options, videos, transport, tools, cache, workDir })).get("a.mov")!

  expect(insight.summary).toBe("สรุป")
  expect(insight.retakes).toEqual([])
  expect(insight.usage.inputTokens).toBe(1)
  const key = { model: options.model, promptVersion: insight.promptVersion, intervalUs: options.intervalUs, maxFrames: options.maxFrames }
  expect(await cachedInsight(cache, videos[0]!.path, key, videos[0]!)).not.toBeNull()
  expect(await readdir(workDir)).toEqual([])
})

test("frames a comparison cannot get are the comparison's loss, not the whole video's", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"], countdown)
  const plain = fakeTools()
  let calls = 0
  const tools = fakeTools({
    extractFrames: async (input, timesUs, outDir, signal) => {
      calls += 1
      if (calls > 1) throw new Error("ff_frame_thread_encoder_init failed")
      return plain.extractFrames(input, timesUs, outDir, signal)
    },
  })
  const transport = fakeTransport()
  const insight = (await describeVideos({ ...options, videos, transport, tools, cache, workDir })).get("a.mov")!

  expect(insight.retakes).toEqual([])
  expect(insight.scenes).toHaveLength(1)
  // only the describing call was made: nothing was asked about a take whose frames never arrived
  expect(transport.calls).toBe(1)
})

test("cancelling while the takes are compared still rejects the run", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"], countdown)
  const tools = fakeTools()
  const transport = fakeTransport((call) => (call === 2 ? Object.assign(new Error("aborted"), { name: "AbortError" }) : null))
  await expect(describeVideos({ ...options, videos, transport, tools, cache, workDir })).rejects.toThrow("aborted")
})
