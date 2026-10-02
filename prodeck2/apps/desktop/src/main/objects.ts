import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { MediaCache } from "@boxblack/core/cache"
import type { LlmTransport } from "@boxblack/core/llm"
import {
  locateObjects,
  OBJECTS_VERSION,
  sampleTimes,
  visionSampling,
  type SceneObjects,
  type VideoInsight,
  type VisionKey,
  type VisionSampling,
  type VisionTools,
} from "@boxblack/core/vision"
import { analysedVideos, fittingInsight, footageKeys, type FootageDeps } from "./footage.ts"

/**
 * What the objects of a video are stored under: the insight they were found for, the objects prompt,
 * and the scenes they are numbered by. An insight described again, with other scenes, misses its old
 * objects rather than reading them against the wrong scenes.
 */
export type ObjectsKey = VisionKey & { objects: string; scenes: string }

export type ObjectsCache = MediaCache<SceneObjects, ObjectsKey>

export type ObjectsStatus = { state: "running" } | { state: "done" } | { state: "failed"; error: string }

export function objectsKey(insightKey: VisionKey, insight: VideoInsight): ObjectsKey {
  const scenes = createHash("sha256")
    .update(JSON.stringify(insight.scenes.map((s) => [s.startUs, s.endUs, s.description])))
    .digest("hex")
    .slice(0, 16)
  return { ...insightKey, objects: OBJECTS_VERSION, scenes }
}

/** The objects stored for a video's insight, or null when none were found for it yet (or there is no cache to read). */
export async function objectsFor(deps: { objects?: ObjectsCache }, videoPath: string, insightKey: VisionKey, insight: VideoInsight): Promise<SceneObjects | null> {
  return deps.objects ? deps.objects.get(videoPath, objectsKey(insightKey, insight)) : null
}

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted === true || (error instanceof Error && error.name === "AbortError")

/**
 * For each video, has Claude record where things are in each scene its insight found, and stores
 * that beside the insight. The frames shown are the very ones the pictures were described from: the
 * same sampling, over the scene cuts measured then, so nothing is measured again. One video at a
 * time; a video's failure is reported and the next one goes, and a cancel rejects the whole pass.
 *
 * Right after an analysis, `described` hands over the insights and the key and sampling they were
 * made with, so a settings change during the run cannot make the pass miss them. Without it, the
 * settings in force are read once and each insight is looked up as the post page would find it.
 */
export async function locateVideos(args: {
  footage: FootageDeps & { objects: ObjectsCache }
  videos: { id: string; path: string; durationUs: number }[]
  described?: { insightKey: VisionKey; sampling: VisionSampling; insights: Map<string, VideoInsight> }
  transport: LlmTransport
  model: string
  extractFrames: VisionTools["extractFrames"]
  /** frames live here while a video is looked at */
  workDir: string
  signal?: AbortSignal
  onEvent?: (videoId: string, status: ObjectsStatus) => void
}): Promise<void> {
  const { footage, signal } = args
  const emit = (videoId: string, status: ObjectsStatus) => args.onEvent?.(videoId, status)
  const inForce = async () => {
    const [keys, { vision }] = await Promise.all([footageKeys(footage), footage.settings.read()])
    return { keys, sampling: visionSampling(vision.frameEveryS) }
  }
  let current: Awaited<ReturnType<typeof inForce>> | undefined

  for (const [index, video] of args.videos.entries()) {
    signal?.throwIfAborted()
    const framesDir = join(args.workDir, `objects-${index}`)
    try {
      let insightKey: VisionKey
      let sampling: VisionSampling
      let insight: VideoInsight | null
      if (args.described) {
        ;({ insightKey, sampling } = args.described)
        insight = args.described.insights.get(video.id) ?? null
      } else {
        current ??= await inForce()
        ;({ insight: insightKey } = current.keys)
        sampling = current.sampling
        const transcript = await footage.transcripts.get(video.path, current.keys.transcript)
        insight = transcript ? await fittingInsight(footage, video.path, insightKey, transcript) : null
      }
      if (!insight) throw new Error("the pictures of this video are not analysed yet")

      // stored for the file as it is now, even if it is replaced while it is looked at
      const entry = await footage.objects.entry(video.path, objectsKey(insightKey, insight))
      if (await entry.get()) {
        emit(video.id, { state: "done" })
        continue
      }

      emit(video.id, { state: "running" })
      await mkdir(framesDir, { recursive: true })
      const timesUs = sampleTimes({ durationUs: video.durationUs, sceneCutsUs: insight.signals.sceneCutsUs, intervalUs: sampling.intervalUs, maxFrames: sampling.maxFrames })
      const frames = await args.extractFrames(video.path, timesUs, framesDir, signal)
      // with no frame the model is asked nothing and every scene comes back empty, which would be kept as
      // "nothing there"; a video with no scenes has truly nothing to find
      if (frames.length === 0 && insight.scenes.length > 0) throw new Error("no frame could be taken from this video")

      const found = await locateObjects({ transport: args.transport, model: args.model, frames, scenes: insight.scenes, batchSize: sampling.batchSize, signal })
      await entry.put(found)
      emit(video.id, { state: "done" })
    } catch (error) {
      if (isAbort(error, signal)) throw error
      emit(video.id, { state: "failed", error: error instanceof Error ? error.message : String(error) })
    } finally {
      await rm(framesDir, { recursive: true, force: true })
    }
  }
}

/**
 * The videos of a project that are analysed under the settings in force (both their speech and
 * their pictures cached) but have had no objects found for that insight: ones analysed before the
 * objects pass existed, or whose pass failed.
 */
export async function videosWithoutObjects(deps: FootageDeps, folder: string): Promise<string[]> {
  const analysed = await analysedVideos(deps, folder)
  const project = await deps.inspect(folder)
  const { transcript: transcriptKey, insight: insightKey } = await footageKeys(deps)
  const found = await Promise.all(
    project.videos
      .filter((video) => analysed.includes(video.id))
      .map(async (video) => {
        const transcript = await deps.transcripts.get(video.path, transcriptKey)
        const insight = transcript ? await fittingInsight(deps, video.path, insightKey, transcript) : null
        return insight && !(await objectsFor(deps, video.path, insightKey, insight)) ? video.id : null
      }),
  )
  return found.filter((id): id is string => id !== null)
}
