import { expect, test } from "vitest"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TranscriptCache, type Transcript } from "@boxblack/core/asr"
import { MediaCache } from "@boxblack/core/cache"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { OBJECTS_VERSION, PROMPT_VERSION, VISION_SAMPLING, visionSampling, type SceneObjects, type VideoInsight, type VisionKey, type VisionTools } from "@boxblack/core/vision"
import type { ProjectDetail } from "../shared/api.ts"
import { footageKeys } from "./footage.ts"
import { locateVideos, objectsFor, objectsKey, videosWithoutObjects, type ObjectsKey, type ObjectsStatus } from "./objects.ts"
import { SettingsStore } from "./settings.ts"

const transcript: Transcript = { engine: "whisper-local", model: "large-v3-q5_0", language: "th", utterances: [], words: [], audioEvents: [] }

const scene = (startS: number, endS: number, description: string) => ({
  startUs: startS * 1_000_000,
  endUs: endS * 1_000_000,
  description,
  kind: "talking-head" as const,
  issues: [],
  keepClear: null,
})

const insight: VideoInsight = {
  model: "claude-opus-5",
  promptVersion: PROMPT_VERSION,
  frameCount: 2,
  retakes: [],
  // a cut at 4 s: the frames sampled are the ones the pictures were described from
  signals: { sceneCutsUs: [4_000_000], black: [], frozen: [], silent: [], blurry: [] },
  summary: "คนพูด",
  scenes: [scene(0, 4, "คนพูดกับกล้อง"), scene(4, 10, "โชว์แก้วกาแฟ")],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}

const VISION_KEY: VisionKey = { model: "claude-opus-5", promptVersion: PROMPT_VERSION, intervalUs: VISION_SAMPLING.intervalUs, maxFrames: VISION_SAMPLING.maxFrames }

const reply = {
  scenes: [
    { scene: 1, objects: [{ what: "ใบหน้า", kind: "keep", box: [0.3, 0.1, 0.7, 0.4], still: false }] },
    { scene: 2, objects: [{ what: "แก้วกาแฟ", kind: "point", box: [0.6, 0.6, 0.8, 0.9], still: true }] },
  ],
}

async function setup(options: { frames?: (timesUs: number[], outDir: string) => Promise<{ atUs: number; path: string }[]> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-objects-"))
  const videos = ["read", "unread"].map((id) => ({ id, name: `${id}.mov`, path: join(dir, `${id}.mov`), durationUs: 10_000_000, width: 1080, height: 1920, exists: true }))
  for (const video of videos) await writeFile(video.path, video.id)
  const project: ProjectDetail = {
    name: "p",
    folder: "/drafts/p",
    capcutVersion: "9.4.0",
    versionTested: true,
    fps: 30,
    canvas: { width: 1080, height: 1920 },
    timelineSegmentCount: 0,
    videos,
  }
  const transcripts = new TranscriptCache(join(dir, "transcripts"))
  const insights = new MediaCache<VideoInsight, VisionKey>(join(dir, "insights"))
  const objects = new MediaCache<SceneObjects, ObjectsKey>(join(dir, "objects"))
  const asrKey = { engine: "whisper-local" as const, model: "large-v3-q5_0", language: "th" as const }
  for (const video of videos) await transcripts.put(video.path, asrKey, transcript)
  await insights.put(videos[0]!.path, VISION_KEY, insight)

  const deps = {
    settings: new SettingsStore(join(dir, "settings.json")),
    transcripts,
    insights,
    objects,
    whisperModelId: "large-v3-q5_0",
    inspect: async (folder: string) => {
      if (folder !== project.folder) throw new Error(`${folder} is not a CapCut project`)
      return project
    },
  }
  const asked: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      asked.push(request as LlmRequest<unknown>)
      return { output: reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  const extracted: number[][] = []
  const workDir = join(dir, "work")
  const extractFrames: VisionTools["extractFrames"] = async (_input, timesUs, outDir) => {
    extracted.push(timesUs)
    if (options.frames) return options.frames(timesUs, outDir)
    return Promise.all(
      timesUs.map(async (atUs) => {
        const path = join(outDir, `f-${atUs}.jpg`)
        await writeFile(path, "jpeg")
        return { atUs, path }
      }),
    )
  }
  const events: [string, ObjectsStatus][] = []
  const locate = (ids: string[], signal?: AbortSignal) =>
    locateVideos({
      footage: deps,
      videos: ids.map((id) => videos.find((video) => video.id === id)!),
      transport,
      model: "claude-opus-5",
      extractFrames,
      workDir,
      signal,
      onEvent: (videoId, status) => events.push([videoId, status]),
    })
  return { deps, project, videos, asked, extracted, events, locate, workDir }
}

test("objects are found again under the insight they were made for, and missed once its scenes or the objects version change", async () => {
  const { deps, videos } = await setup()
  const found: SceneObjects = { version: OBJECTS_VERSION, scenes: [[], []] }
  await deps.objects.put(videos[0]!.path, objectsKey(VISION_KEY, insight), found)
  expect(await objectsFor(deps, videos[0]!.path, VISION_KEY, insight)).toEqual(found)

  // described again with other scenes, the old objects would sit on the wrong ones
  const redescribed = { ...insight, scenes: [scene(0, 10, "คนพูดกับกล้อง")] }
  expect(await objectsFor(deps, videos[0]!.path, VISION_KEY, redescribed)).toBeNull()

  // a new objects prompt is a fresh look
  const older = { ...objectsKey(VISION_KEY, insight), objects: "objects-2026-01-01" }
  await deps.objects.put(videos[1]!.path, older, found)
  expect(await objectsFor(deps, videos[1]!.path, VISION_KEY, insight)).toBeNull()
  expect(objectsKey(VISION_KEY, insight)).toMatchObject({ objects: OBJECTS_VERSION, scenes: expect.stringMatching(/^[0-9a-f]{16}$/) })

  // without a cache to read, there are none
  expect(await objectsFor({}, videos[0]!.path, VISION_KEY, insight)).toBeNull()
})

test("a video is shown the frames its pictures were described from, and what is found is stored and its frames cleared", async () => {
  const { deps, videos, asked, extracted, events, locate, workDir } = await setup()
  await locate(["read"])
  // the same sampling as the describing: every shot from half a second in, every 3 s
  expect(extracted).toEqual([[500_000, 3_500_000, 4_500_000, 7_500_000]])
  expect(asked).toHaveLength(1)
  expect(asked[0]!.model).toBe("claude-opus-5")
  expect(events).toEqual([
    ["read", { state: "running" }],
    ["read", { state: "done" }],
  ])
  const stored = await objectsFor(deps, videos[0]!.path, (await footageKeys(deps)).insight, insight)
  expect(stored?.scenes.map((objects) => objects.map((o) => o.what))).toEqual([["ใบหน้า"], ["แก้วกาแฟ"]])
  expect(await readdir(workDir)).toEqual([])
})

test("a video whose objects are stored already is not looked at again", async () => {
  const { asked, extracted, events, locate } = await setup()
  await locate(["read"])
  events.length = 0
  await locate(["read"])
  expect(asked).toHaveLength(1)
  expect(extracted).toHaveLength(1)
  expect(events).toEqual([["read", { state: "done" }]])
})

test("a video whose pictures are not analysed yet fails, and the next one still goes", async () => {
  const { events, locate } = await setup()
  await locate(["unread", "read"])
  expect(events).toEqual([
    ["unread", { state: "failed", error: "the pictures of this video are not analysed yet" }],
    ["read", { state: "running" }],
    ["read", { state: "done" }],
  ])
})

test("a video no frame could be taken from fails, and nothing is stored as found", async () => {
  const { deps, videos, asked, events, locate } = await setup({ frames: async () => [] })
  await locate(["read"])
  expect(asked).toEqual([])
  expect(events.at(-1)).toEqual(["read", { state: "failed", error: "no frame could be taken from this video" }])
  expect(await objectsFor(deps, videos[0]!.path, VISION_KEY, insight)).toBeNull()
})

test("a frame that cannot be taken fails that video, and its frames are still cleared", async () => {
  const { events, locate, workDir } = await setup({
    frames: async () => {
      throw new Error("ffmpeg ล้ม")
    },
  })
  await locate(["read"])
  expect(events.at(-1)).toEqual(["read", { state: "failed", error: "ffmpeg ล้ม" }])
  expect(await readdir(workDir)).toEqual([])
})

test("a cancel stops the whole pass rather than failing a video", async () => {
  const controller = new AbortController()
  const { events, locate } = await setup({
    frames: async () => {
      controller.abort()
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    },
  })
  await expect(locate(["read"], controller.signal)).rejects.toThrow("aborted")
  expect(events).toEqual([["read", { state: "running" }]])
})

test("the analysed videos without objects are the ones the button offers", async () => {
  const { deps, project, locate } = await setup()
  // unread has no insight, so it is not analysed and not offered
  expect(await videosWithoutObjects(deps, project.folder)).toEqual(["read"])
  await locate(["read"])
  expect(await videosWithoutObjects(deps, project.folder)).toEqual([])
  await expect(videosWithoutObjects(deps, "/tmp/elsewhere")).rejects.toThrow("not a CapCut project")
})

test("a pass handed what the pictures were described with reads nothing of the settings in force", async () => {
  const { deps, videos, extracted, events, workDir } = await setup()
  // described every second under a key of its own; the settings have moved on to another rate since
  await deps.settings.update({ vision: { frameEveryS: 5 } })
  const sampling = visionSampling(1)
  const insightKey: VisionKey = { ...VISION_KEY, intervalUs: sampling.intervalUs, maxFrames: sampling.maxFrames }
  const transport: LlmTransport = {
    id: "anthropic-api",
    generate: async <T,>() => ({ output: reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
  }
  const extractFrames: VisionTools["extractFrames"] = async (_input, timesUs, outDir) => {
    extracted.push(timesUs)
    return Promise.all(timesUs.map(async (atUs) => (await writeFile(join(outDir, `f-${atUs}.jpg`), "jpeg"), { atUs, path: join(outDir, `f-${atUs}.jpg`) })))
  }
  // "unread" has no insight in the cache: the one handed over is the one used
  await locateVideos({
    footage: deps,
    videos: [videos[1]!],
    described: { insightKey, sampling, insights: new Map([["unread", insight]]) },
    transport,
    model: "claude-opus-5",
    extractFrames,
    workDir,
    onEvent: (videoId, status) => events.push([videoId, status]),
  })
  expect(events.at(-1)).toEqual(["unread", { state: "done" }])
  expect(extracted[0]).toEqual([500_000, 1_500_000, 2_500_000, 3_500_000, 4_500_000, 5_500_000, 6_500_000, 7_500_000, 8_500_000, 9_500_000])
  expect(await objectsFor(deps, videos[1]!.path, insightKey, insight)).not.toBeNull()
})
