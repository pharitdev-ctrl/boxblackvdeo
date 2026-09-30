import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TranscriptCache, type Transcript } from "@boxblack/core/asr"
import { MediaCache } from "@boxblack/core/cache"
import type { DraftInfo } from "@boxblack/core/capcut"
import type { Loudness } from "@boxblack/core/media"
import type { Beat } from "@boxblack/core/planner"
import { VISION_PROMPT, VISION_SAMPLING, type Scene, type VideoInsight, type VisionKey } from "@boxblack/core/vision"
import type { EmphasisPoint } from "@boxblack/core/emphasis"
import { makeDraftRoot } from "../../../../packages/core/test/fixture-root.ts"
import type { ProjectDetail, StoredOutline } from "../shared/api.ts"
import { transcriptFingerprint } from "./footage.ts"
import { OutlineStore } from "./planner.ts"
import { SettingsStore } from "./settings.ts"
import { createTimelineService, type TimelineDeps } from "./timeline.ts"

// Shared set-up for the timeline and highlight text tests: the fixture draft 0917 with IMG_9646.MOV analysed.

/** The one video in the fixture draft's media bin. */
export const CLIP_ID = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

export const s = (seconds: number) => Math.round(seconds * 1_000_000)
export const word = (text: string, start: number, end: number) => ({ text, startUs: s(start), endUs: s(end) })

// whisper.cpp on IMG_9646.MOV around the countdown that starts over
export const transcript: Transcript = {
  engine: "whisper-local",
  model: "large-v3-q5_0",
  language: "th",
  utterances: [
    { text: "ขึ้นไปในอวกาศ ในสาม สอง", startUs: s(17.16), endUs: s(21.14) },
    { text: "หนึ่ง", startUs: s(21.56), endUs: s(22.06) },
    { text: "สาม สอง หนึ่ง", startUs: s(22.62), endUs: s(25.25) },
  ],
  words: [
    word("ขึ้น", 17.16, 17.44),
    word("ไป", 17.44, 17.68),
    word("ใน", 17.68, 18.08),
    word("อวกาศ", 18.08, 18.75),
    word("ใน", 19.0, 19.78),
    word("สาม", 19.78, 20.51),
    word("สอง", 20.66, 21.14),
    word("หนึ่ง", 21.56, 22.06),
    word("สาม", 22.62, 23.58),
    word("สอง", 23.88, 24.84),
    word("หนึ่ง", 24.84, 25.25),
  ],
  audioEvents: [],
}

export const countdown: Beat = {
  id: "beat-1",
  name: "นับถอยหลัง",
  purpose: "ลุ้น",
  videoId: CLIP_ID,
  videoName: "IMG_9646.MOV",
  kind: "speech",
  fromIndex: 0,
  toIndex: 2,
  startUs: s(17.16),
  endUs: s(25.25),
  speech: "",
  visual: "",
}

export const segments = (info: DraftInfo) => info.tracks.reduce((sum, track) => sum + track.segments.length, 0)
export const readInfo = async (folder: string) => JSON.parse(await readFile(join(folder, "draft_info.json"), "utf8")) as DraftInfo

/** Quiet everywhere except where IMG_9646.MOV is actually heard around the countdown. */
export function heard(): Loudness {
  const loud = [[17.1, 18.8], [19.2, 19.5], [19.72, 21.2], [21.56, 22.06], [22.62, 25.3]]
  const db = Array.from({ length: 3111 }, (_, i) => (loud.some(([a, b]) => i / 100 >= a! && i / 100 < b!) ? -25 : -60))
  return { stepUs: 10_000, db }
}

export async function setup(
  options: {
    confirmed?: boolean
    measure?: ((path: string) => Promise<Loudness>) | null
    presets?: TimelineDeps["presets"]
    transcript?: Transcript
    beats?: Beat[]
    llm?: TimelineDeps["llm"]
    highlightAssets?: TimelineDeps["highlightAssets"]
    sounds?: TimelineDeps["sounds"]
    media?: TimelineDeps["media"]
    /** what the vision step saw; without it the clip has no pictures analysed */
    scenes?: Scene[]
    /** the user's CapCut Pro setting; on unless a test of the gate says otherwise */
    pro?: boolean
  } = {},
) {
  const root = await makeDraftRoot()
  const folder = join(root, "0917")
  const dir = await mkdtemp(join(tmpdir(), "boxblack-timeline-"))
  const media = join(dir, "IMG_9646.MOV")
  await writeFile(media, "video")

  const project: ProjectDetail = {
    name: "0917",
    folder,
    capcutVersion: "9.4.0",
    versionTested: true,
    fps: 30,
    // what the fixture draft says; its "original" ratio makes the rough cut follow the portrait clip
    canvas: { width: 1920, height: 1080 },
    timelineSegmentCount: 0,
    videos: [{ id: CLIP_ID, path: media, name: "IMG_9646.MOV", durationUs: 31_106_000, width: 1080, height: 1920, exists: true }],
  }

  const settings = new SettingsStore(join(dir, "settings.json"))
  // the tests before 0.4.2 were written for an app that used every CapCut resource; the tests of the Pro gate turn it off
  await settings.update({ capcut: { pro: options.pro ?? true } })
  const transcripts = new TranscriptCache(join(dir, "transcripts"))
  await transcripts.put(media, { engine: "whisper-local", model: "large-v3-q5_0", language: "th" }, options.transcript ?? transcript)
  const insights = new MediaCache<VideoInsight, VisionKey>(join(dir, "insights"))
  if (options.scenes) {
    const key: VisionKey = { model: "claude-opus-5", promptVersion: VISION_PROMPT.version, intervalUs: VISION_SAMPLING.intervalUs, maxFrames: VISION_SAMPLING.maxFrames }
    const insight: VideoInsight = {
      model: "claude-opus-5",
      promptVersion: VISION_PROMPT.version,
      frameCount: options.scenes.length,
      signals: { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] },
      summary: "",
      scenes: options.scenes,
      retakes: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }
    await insights.put(media, key, insight)
  }
  const outlines = new OutlineStore(join(dir, "outlines"))
  const stored: StoredOutline = {
    folder,
    videoIds: [CLIP_ID],
    brief: { targetSeconds: null, videoType: null, instructions: "" },
    outline: { title: "นักบินอวกาศ", summary: "", omitted: "", beats: options.beats ?? [countdown], warnings: [] },
    confirmed: options.confirmed ?? true,
    model: "claude-opus-5",
    promptVersion: "planner",
    updatedAt: 0,
  }
  await outlines.put(stored)

  const capcut = { running: false }
  let clock = Date.parse("2026-09-17T08:00:00Z")
  const deps: TimelineDeps = {
    settings,
    transcripts,
    insights,
    whisperModelId: "large-v3-q5_0",
    inspect: async (f) => {
      if (f !== folder) throw new Error(`${f} is not a CapCut project`)
      return project
    },
    registered: async (f) => {
      if (f !== folder) throw new Error(`${f} is not a CapCut project`)
    },
    outlines,
    loudness: new MediaCache<Loudness, { stepUs: number }>(join(dir, "loudness")),
    measureLoudness: options.measure === undefined ? null : options.measure,
    backupRoot: join(dir, "backups"),
    isCapCutRunning: async () => capcut.running,
    now: () => new Date((clock += 60_000)),
    presets: options.presets,
    llm: options.llm,
    polishDir: join(dir, "subtitle-polish"),
    highlightAssets: options.highlightAssets,
    sounds: options.sounds,
    media: options.media,
  }
  return { service: createTimelineService(deps), folder, root, capcut, deps, outlines, dir }
}

/**
 * The emphasis points the highlight tests pick text from, as planEmphasis stores them: "ขึ้นไปในอวกาศ"
 * (words 0–3) and the second countdown (words 8–10), both key points of `beatId`, so every level shows them.
 */
export const fixturePoints = (beatId = "beat-1"): EmphasisPoint[] => [
  { id: "p1", anchor: { kind: "speech", videoId: CLIP_ID, from: 0, to: 4, beatId }, importance: "key", type: "hook", reason: "เปิดคลิป", source: "ai", edited: false },
  { id: "p2", anchor: { kind: "speech", videoId: CLIP_ID, from: 8, to: 11, beatId }, importance: "key", type: "number", reason: "นับถอยหลัง", source: "ai", edited: false },
]

/** Stores emphasis points on a project's outline, their words numbered on the fixture's transcript. */
export async function storePoints(outlines: OutlineStore, folder: string, points: EmphasisPoint[]): Promise<void> {
  await outlines.update(folder, (stored) => ({
    ...stored!,
    emphasis: { points, version: 1, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
  }))
}
