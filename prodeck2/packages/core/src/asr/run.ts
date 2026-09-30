import { mkdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import type { AudioFormat } from "../media/audio.ts"
import type { TranscriptCache, TranscriptSettings } from "./cache.ts"
import type { Transcript } from "./types.ts"

export interface AsrEngine {
  settings: TranscriptSettings
  audioFormat: AudioFormat
  transcribe(audioPath: string, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void }): Promise<Transcript>
}

export interface MediaTools {
  hasAudio(path: string, signal?: AbortSignal): Promise<boolean>
  extractAudio(input: string, output: string, format: AudioFormat, signal?: AbortSignal): Promise<void>
}

export type VideoStatus =
  | { state: "queued" }
  | { state: "extracting" }
  | { state: "transcribing"; progress: number | null }
  | { state: "done"; fromCache: boolean; transcript: Transcript }
  | { state: "failed"; error: string }

export interface TranscriptionEvent {
  videoId: string
  status: VideoStatus
}

const silence = (): Transcript => ({ engine: "none", model: "", language: "", utterances: [], words: [], audioEvents: [] })

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted === true || (error instanceof Error && error.name === "AbortError")

/**
 * Transcribes videos one at a time (a local model already uses the whole GPU).
 * A video that fails is reported and skipped; cancelling rejects the whole run.
 */
export async function transcribeVideos(args: {
  videos: { id: string; path: string }[]
  engine: AsrEngine
  media: MediaTools
  cache: TranscriptCache
  /** where extracted audio is written while a video is being transcribed */
  workDir: string
  signal?: AbortSignal
  onEvent?: (event: TranscriptionEvent) => void
}): Promise<Map<string, Transcript>> {
  const { videos, engine, media, cache, signal } = args
  const emit = (videoId: string, status: VideoStatus) => args.onEvent?.({ videoId, status })
  const results = new Map<string, Transcript>()

  for (const video of videos) emit(video.id, { state: "queued" })
  await mkdir(args.workDir, { recursive: true })

  for (const video of videos) {
    signal?.throwIfAborted()
    // the transcript is stored for the file as it is now, even if it is replaced while it is heard;
    // a file that cannot be read fails below, as that video and no other
    const entry = await cache.entry(video.path, engine.settings).catch(() => null)
    const cached = (await entry?.get()) ?? null
    if (cached) {
      results.set(video.id, cached)
      emit(video.id, { state: "done", fromCache: true, transcript: cached })
      continue
    }

    const audio = join(args.workDir, `${basename(video.path)}.${engine.audioFormat}`)
    try {
      emit(video.id, { state: "extracting" })
      let transcript: Transcript
      if (await media.hasAudio(video.path, signal)) {
        await media.extractAudio(video.path, audio, engine.audioFormat, signal)
        emit(video.id, { state: "transcribing", progress: null })
        transcript = await engine.transcribe(audio, {
          signal,
          onProgress: (progress) => emit(video.id, { state: "transcribing", progress }),
        })
      } else {
        transcript = silence()
      }
      await entry?.put(transcript)
      results.set(video.id, transcript)
      emit(video.id, { state: "done", fromCache: false, transcript })
    } catch (error) {
      if (isAbort(error, signal)) throw error
      emit(video.id, { state: "failed", error: error instanceof Error ? error.message : String(error) })
    } finally {
      await rm(audio, { force: true })
    }
  }
  return results
}
