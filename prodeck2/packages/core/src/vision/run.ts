import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { TimedText } from "../asr/types.ts"
import type { MediaCache } from "../cache.ts"
import type { LlmTransport, SystemPrompt } from "../llm/types.ts"
import { describeVideo, VISION_PROMPT, type VideoInsight } from "./describe.ts"
import { sampleTimes, type FrameImage } from "./frames.ts"
import { findRetakes, reviewRetake, takeFrameTimes, type RetakeReview } from "./retakes.ts"
import type { VideoSignals } from "./signals.ts"

export interface VisionTools {
  hasAudio(path: string, signal?: AbortSignal): Promise<boolean>
  measure(input: string, durationUs: number, hasAudio: boolean, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<VideoSignals>
  extractFrames(input: string, timesUs: number[], outDir: string, signal?: AbortSignal): Promise<FrameImage[]>
}

/** Everything that changes what the model would say about a file. */
export interface VisionKey {
  model: string
  promptVersion: string
  intervalUs: number
  maxFrames: number
  /** the words the pictures are described with (`speechKey`), so what was seen with each transcript is kept */
  speech?: string
}

export type VisionStatus =
  | { state: "queued" }
  | { state: "measuring"; progress: number | null }
  | { state: "describing"; progress: number | null }
  | { state: "done"; fromCache: boolean; insight: VideoInsight }
  | { state: "failed"; error: string }

export interface VisionEvent {
  videoId: string
  status: VisionStatus
}

/** Names the speech a video's pictures are described with: its words, as they were read. */
export function speechKey(speech: { utterances: TimedText[]; words: TimedText[] }): string {
  const timed = (items: TimedText[]) => items.map((item) => [item.text, item.startUs, item.endUs])
  return createHash("sha256").update(JSON.stringify([timed(speech.utterances), timed(speech.words)])).digest("hex").slice(0, 16)
}

/**
 * Whether what was seen still goes with what was said: the pictures were described, and the lines
 * said twice found, with these words. One saved before the words were recorded with it is taken
 * as it is, rather than have every video looked at again.
 */
export function insightFits(insight: VideoInsight, speech: { utterances: TimedText[]; words: TimedText[] }): boolean {
  return insight.speech === undefined || insight.speech === speechKey(speech)
}

/**
 * What was seen in a video, cached for the settings in force and the speech as it reads now. One
 * saved before the speech was part of the key is under the key without it, and is taken when it
 * fits the speech.
 */
export async function cachedInsight(
  cache: MediaCache<VideoInsight, VisionKey>,
  path: string,
  key: VisionKey,
  speech: { utterances: TimedText[]; words: TimedText[] } | null,
): Promise<VideoInsight | null> {
  const own = speech ? await cache.get(path, { ...key, speech: speechKey(speech) }) : null
  if (own) return own
  const before = await cache.get(path, key)
  return before && (!speech || insightFits(before, speech)) ? before : null
}

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted === true || (error instanceof Error && error.name === "AbortError")

/**
 * For each video: measure picture and sound problems with ffmpeg, sample frames, and have
 * Claude describe them. One video at a time; a failure is reported and skipped, cancelling
 * rejects the whole run.
 */
export async function describeVideos(args: {
  videos: { id: string; path: string; durationUs: number; utterances: TimedText[]; words: TimedText[] }[]
  transport: LlmTransport
  model: string
  tools: VisionTools
  cache: MediaCache<VideoInsight, VisionKey>
  workDir: string
  intervalUs: number
  maxFrames: number
  batchSize: number
  prompt?: SystemPrompt
  signal?: AbortSignal
  onEvent?: (event: VisionEvent) => void
}): Promise<Map<string, VideoInsight>> {
  const { videos, tools, signal } = args
  const emit = (videoId: string, status: VisionStatus) => args.onEvent?.({ videoId, status })
  const prompt = args.prompt ?? VISION_PROMPT
  const key: VisionKey = { model: args.model, promptVersion: prompt.version, intervalUs: args.intervalUs, maxFrames: args.maxFrames }
  const results = new Map<string, VideoInsight>()

  for (const video of videos) emit(video.id, { state: "queued" })

  for (const [index, video] of videos.entries()) {
    signal?.throwIfAborted()
    // the result is stored for the file as it is now, even if it is replaced while it is looked at;
    // a file that cannot be read fails below, as that video and no other
    // kept per speech, so reading the speech again another way and back again costs nothing twice
    const entry = await args.cache.entry(video.path, { ...key, speech: speechKey(video) }).catch(() => null)
    const cached = entry ? await cachedInsight(args.cache, video.path, key, video) : null
    if (cached) {
      results.set(video.id, cached)
      emit(video.id, { state: "done", fromCache: true, insight: cached })
      continue
    }

    const framesDir = join(args.workDir, `frames-${index}`)
    try {
      emit(video.id, { state: "measuring", progress: null })
      const hasAudio = await tools.hasAudio(video.path, signal)
      const signals = await tools.measure(video.path, video.durationUs, hasAudio, signal, (progress) =>
        emit(video.id, { state: "measuring", progress }),
      )

      await mkdir(framesDir, { recursive: true })
      const timesUs = sampleTimes({ durationUs: video.durationUs, sceneCutsUs: signals.sceneCutsUs, intervalUs: args.intervalUs, maxFrames: args.maxFrames })
      const frames = await tools.extractFrames(video.path, timesUs, framesDir, signal)

      emit(video.id, { state: "describing", progress: null })
      const described = await describeVideo({
        transport: args.transport,
        model: args.model,
        frames,
        durationUs: video.durationUs,
        signals,
        utterances: video.utterances,
        batchSize: args.batchSize,
        prompt,
        signal,
        onProgress: (progress) => emit(video.id, { state: "describing", progress }),
      })

      // a line said twice: look closely at both takes so the planner can pick the one whose picture fits the words
      const usage = { ...described.usage }
      const retakes: RetakeReview[] = []
      for (const [n, retake] of findRetakes({ utterances: video.utterances, words: video.words }).entries()) {
        try {
          const retakeDir = join(framesDir, `retake-${n + 1}`)
          await mkdir(retakeDir, { recursive: true })
          const [timesA, timesB] = retake.takes.map(takeFrameTimes) as [number[], number[]]
          const extracted = await tools.extractFrames(video.path, [...timesA, ...timesB], retakeDir, signal)
          const { review, usage: used } = await reviewRetake({
            transport: args.transport,
            model: args.model,
            retake,
            frames: [extracted.slice(0, timesA.length), extracted.slice(timesA.length)],
            words: video.words,
            signal,
          })
          retakes.push(review)
          usage.inputTokens += used.inputTokens
          usage.outputTokens += used.outputTokens
          usage.cacheReadTokens += used.cacheReadTokens
          usage.cacheWriteTokens += used.cacheWriteTokens
        } catch (error) {
          // the pictures are described and paid for by now: a comparison that cannot be made is
          // one hint the planner goes without, not a reason to throw the whole video away
          if (isAbort(error, signal)) throw error
        }
      }
      const insight: VideoInsight = { ...described, retakes, usage, speech: speechKey(video) }

      await entry?.put(insight)
      results.set(video.id, insight)
      emit(video.id, { state: "done", fromCache: false, insight })
    } catch (error) {
      if (isAbort(error, signal)) throw error
      emit(video.id, { state: "failed", error: error instanceof Error ? error.message : String(error) })
    } finally {
      await rm(framesDir, { recursive: true, force: true })
    }
  }
  return results
}
