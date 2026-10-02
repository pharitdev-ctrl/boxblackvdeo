import { createHash } from "node:crypto"
import type { Transcript, TranscriptCache, TranscriptSettings } from "@boxblack/core/asr"
import type { MediaCache } from "@boxblack/core/cache"
import type { FootageClip } from "@boxblack/core/planner"
import { cachedInsight, retakeLoad, VISION_PROMPT, visionSampling, type RetakeLoad, type VideoInsight, type VisionKey } from "@boxblack/core/vision"
import type { ProjectDetail } from "../shared/api.ts"
import { SCRIBE_MODEL } from "./analysis.ts"
import type { Prompts } from "./prompts.ts"
import type { SettingsStore } from "./settings.ts"
import { objectsFor, type ObjectsCache } from "./objects.ts"

export interface FootageDeps {
  settings: SettingsStore
  transcripts: TranscriptCache
  insights: MediaCache<VideoInsight, VisionKey>
  /** where things are in each scene, found by the objects pass; absent, every clip loads without them */
  objects?: ObjectsCache
  whisperModelId: string
  /** Resolves a registered CapCut project; rejects anything else. */
  inspect(folder: string): Promise<ProjectDetail>
  /** prompts from the license server; the built-in ones when absent */
  prompts?: () => Promise<Prompts>
}

/** Names the transcript word numbers were taken from; the same numbers mean other words in another one. */
export function transcriptFingerprint(transcript: Transcript | null): string {
  const words = transcript ? [transcript.engine, transcript.model, transcript.language, transcript.words.map((w) => [w.text, w.startUs, w.endUs])] : null
  return createHash("sha256").update(JSON.stringify(words)).digest("hex").slice(0, 16)
}

/** The cache keys the settings in force store a video's analysis under. */
export async function footageKeys(deps: FootageDeps): Promise<{ transcript: TranscriptSettings; insight: VisionKey }> {
  const { asr, llm, vision } = await deps.settings.read()
  const sampling = visionSampling(vision.frameEveryS)
  return {
    transcript: { engine: asr.engine, model: asr.engine === "scribe" ? SCRIBE_MODEL : deps.whisperModelId, language: asr.language },
    insight: {
      model: llm.model,
      promptVersion: ((await deps.prompts?.())?.vision ?? VISION_PROMPT).version,
      intervalUs: sampling.intervalUs,
      maxFrames: sampling.maxFrames,
    },
  }
}

/** What was seen, cached for a video, if it was seen with the speech as it reads now. */
export async function fittingInsight(deps: FootageDeps, path: string, key: VisionKey, transcript: Transcript | null): Promise<VideoInsight | null> {
  return cachedInsight(deps.insights, path, key, transcript)
}

/**
 * The videos of a project that need no analysing: their file is there, and both what was said and
 * what was seen are already cached under the settings in force — what was seen, with those words.
 * Silent videos have a transcript of silence, so they count like any other.
 */
export async function analysedVideos(deps: FootageDeps, folder: string): Promise<string[]> {
  const project = await deps.inspect(folder)
  const { transcript, insight } = await footageKeys(deps)
  const found = await Promise.all(
    project.videos.map(async (video) => {
      if (!video.exists) return null
      const said = await deps.transcripts.get(video.path, transcript)
      return said && (await fittingInsight(deps, video.path, insight, said)) ? video.id : null
    }),
  )
  return found.filter((id): id is string => id !== null)
}

/**
 * What comparing the lines said twice will take, for each video of a project whose speech is read
 * already under the settings in force, so the estimate can count them rather than guess.
 */
export async function knownRetakes(deps: FootageDeps, folder: string): Promise<Record<string, RetakeLoad>> {
  const project = await deps.inspect(folder)
  const { transcript: key } = await footageKeys(deps)
  const found = await Promise.all(
    project.videos.map(async (video) => {
      const transcript = video.exists ? await deps.transcripts.get(video.path, key) : null
      return transcript ? [[video.id, retakeLoad(transcript)] as const] : []
    }),
  )
  return Object.fromEntries(found.flat())
}

/** The chosen videos of a project with whatever analysis is cached for the current settings. */
export async function loadFootage(deps: FootageDeps, folder: string, videoIds: string[]): Promise<(FootageClip & { path: string })[]> {
  const project = await deps.inspect(folder)
  const { transcript: transcriptKey, insight: insightKey } = await footageKeys(deps)

  const clips = await Promise.all(
    videoIds.map(async (id) => {
      const video = project.videos.find((v) => v.id === id && v.exists)
      if (!video) throw new Error(`video ${id} is not in this project`)
      const transcript = await deps.transcripts.get(video.path, transcriptKey)
      const insight = await fittingInsight(deps, video.path, insightKey, transcript)
      // a video analysed before the objects pass, or whose pass failed, loads without them
      const objects = insight ? await objectsFor(deps, video.path, insightKey, insight) : null
      return { id, name: video.name, path: video.path, durationUs: video.durationUs, width: video.width, height: video.height, transcript, insight, objects }
    }),
  )
  if (clips.every((clip) => !clip.transcript && !clip.insight)) {
    throw new Error("the chosen videos are not analysed yet with the current settings")
  }
  return clips
}
