import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TranscriptCache, type Transcript } from "@boxblack/core/asr"
import { MediaCache } from "@boxblack/core/cache"
import { PROMPT_VERSION, speechKey, VISION_SAMPLING, type VideoInsight, type VisionKey } from "@boxblack/core/vision"
import type { ProjectDetail } from "../shared/api.ts"
import { analysedVideos, footageKeys, knownRetakes, loadFootage, type FootageDeps } from "./footage.ts"
import { SettingsStore } from "./settings.ts"

const transcript: Transcript = { engine: "whisper-local", model: "large-v3-q5_0", language: "th", utterances: [], words: [], audioEvents: [] }

const insight: VideoInsight = {
  model: "claude-opus-5",
  promptVersion: PROMPT_VERSION,
  frameCount: 2,
  retakes: [],
  signals: { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] },
  summary: "ภาพประกอบ",
  scenes: [],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}

const VISION_KEY: VisionKey = {
  model: "claude-opus-5",
  promptVersion: PROMPT_VERSION,
  intervalUs: VISION_SAMPLING.intervalUs,
  maxFrames: VISION_SAMPLING.maxFrames,
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-footage-"))
  const videos = [
    { id: "both", name: "both.mov" },
    { id: "audio-only", name: "audio-only.mov" },
    { id: "picture-only", name: "picture-only.mov" },
    { id: "gone", name: "gone.mov" },
  ].map((v) => ({ ...v, path: join(dir, v.name), durationUs: 10_000_000, width: 1080, height: 1920, exists: v.id !== "gone" }))
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
  const asrKey = { engine: "whisper-local" as const, model: "large-v3-q5_0", language: "th" as const }
  for (const id of ["both", "audio-only", "gone"]) await transcripts.put(videos.find((v) => v.id === id)!.path, asrKey, transcript)
  for (const id of ["both", "picture-only", "gone"]) await insights.put(videos.find((v) => v.id === id)!.path, VISION_KEY, insight)

  const deps: FootageDeps = {
    settings: new SettingsStore(join(dir, "settings.json")),
    transcripts,
    insights,
    whisperModelId: "large-v3-q5_0",
    inspect: async (folder) => {
      if (folder !== project.folder) throw new Error(`${folder} is not a CapCut project`)
      return project
    },
  }
  return { deps, project }
}

test("a video counts as analysed only when both what was said and what was seen are cached", async () => {
  const { deps, project } = await setup()
  expect(await analysedVideos(deps, project.folder)).toEqual(["both"])
})

test("a video whose file is gone is not offered, however much of it is cached", async () => {
  const { deps, project } = await setup()
  expect(await analysedVideos(deps, project.folder)).not.toContain("gone")
})

test("results belong to the settings that made them: changing the spoken language leaves none", async () => {
  const { deps, project } = await setup()
  await deps.settings.update({ asr: { language: "en" } })
  expect(await analysedVideos(deps, project.folder)).toEqual([])
})

test("a folder that is not a project of CapCut's is refused, not answered with nothing", async () => {
  const { deps } = await setup()
  await expect(analysedVideos(deps, "/tmp/elsewhere")).rejects.toThrow("not a CapCut project")
})

test("a video whose speech is read already says what comparing its lines said twice will take", async () => {
  const { deps, project } = await setup()
  const timed = (text: string, start: number, end: number) => ({ text, startUs: start * 1_000_000, endUs: end * 1_000_000 })
  const said = (start: number) => ["เขา", "ต้อง", "ไป", "ด้วย", "กระสวย", "อวกาศ", "เท่านั้น"].map((text, i) => timed(text, start + (i * 3) / 7, start + ((i + 1) * 3) / 7))
  const twice: Transcript = { ...transcript, utterances: [timed("เขาต้องไปด้วยกระสวยอวกาศเท่านั้น", 10, 13), timed("เขาต้องไปด้วยกระสวยอวกาศเท่านั้น", 14, 17)], words: [...said(10), ...said(14)] }
  const asrKey = { engine: "whisper-local" as const, model: "large-v3-q5_0", language: "th" as const }
  await deps.transcripts.put(project.videos.find((video) => video.id === "audio-only")!.path, asrKey, twice)

  // a video not read yet, or whose file is gone, is not answered for
  expect(await knownRetakes(deps, project.folder)).toEqual({ both: { reviews: 0, frames: 0 }, "audio-only": { reviews: 1, frames: 14 } })
  // and under other settings its speech is not read
  await deps.settings.update({ asr: { language: "en" } })
  expect(await knownRetakes(deps, project.folder)).toEqual({})
})

test("pictures described with other words than the speech read now are not taken as analysed, nor handed on", async () => {
  const { deps, project } = await setup()
  const both = project.videos.find((video) => video.id === "both")!
  const said = [{ text: "สวัสดี", startUs: 0, endUs: 1_000_000 }]
  // described while the speech read "สวัสดี"; the speech now reads nothing
  await deps.insights.put(both.path, VISION_KEY, { ...insight, speech: speechKey({ utterances: said, words: said }) })
  expect(await analysedVideos(deps, project.folder)).toEqual([])
  expect((await loadFootage(deps, project.folder, ["both"]))[0]!.insight).toBeNull()

  // described with the speech as it reads now
  await deps.insights.put(both.path, VISION_KEY, { ...insight, speech: speechKey(transcript) })
  expect(await analysedVideos(deps, project.folder)).toEqual(["both"])
  expect((await loadFootage(deps, project.folder, ["both"]))[0]!.insight).not.toBeNull()
})

test("what was seen belongs to how often Claude looked: at another rate a video is not analysed until it is looked at again, and the old look is kept for when the rate comes back", async () => {
  const { deps, project } = await setup()
  expect(await analysedVideos(deps, project.folder)).toEqual(["both"])
  await deps.settings.update({ vision: { frameEveryS: 1 } })
  expect((await footageKeys(deps)).insight).toMatchObject({ intervalUs: 1_000_000, maxFrames: 360 })
  expect(await analysedVideos(deps, project.folder)).toEqual([])
  await deps.settings.update({ vision: { frameEveryS: 3 } })
  expect((await footageKeys(deps)).insight).toMatchObject({ intervalUs: VISION_SAMPLING.intervalUs, maxFrames: VISION_SAMPLING.maxFrames })
  expect(await analysedVideos(deps, project.folder)).toEqual(["both"])
})
