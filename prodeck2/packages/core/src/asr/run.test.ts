import { expect, test } from "vitest"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TranscriptCache } from "./cache.ts"
import { transcribeVideos, type AsrEngine, type MediaTools, type TranscriptionEvent } from "./run.ts"
import type { Transcript } from "./types.ts"

const spoken = (text: string): Transcript => ({
  engine: "scribe",
  model: "scribe_v2",
  language: "tha",
  utterances: [{ text, startUs: 0, endUs: 1_000_000 }],
  words: [{ text, startUs: 0, endUs: 1_000_000 }],
  audioEvents: [],
})

async function setup(names: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-run-"))
  const videos = []
  for (const name of names) {
    const path = join(dir, name)
    await writeFile(path, `video ${name}`)
    videos.push({ id: name, path })
  }
  const workDir = join(dir, "work")
  return { dir, videos, workDir, cache: new TranscriptCache(join(dir, "cache")) }
}

function fakeEngine(overrides: Partial<AsrEngine> = {}): AsrEngine & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    settings: { engine: "scribe", model: "scribe_v2", language: "th" },
    audioFormat: "flac",
    transcribe: async (audioPath, { onProgress }) => {
      calls.push(audioPath)
      onProgress?.(0.5)
      return spoken(audioPath)
    },
    ...overrides,
  }
}

function fakeMedia(silent: string[] = []): MediaTools & { extracted: string[] } {
  const extracted: string[] = []
  return {
    extracted,
    hasAudio: async (path) => !silent.some((name) => path.endsWith(name)),
    extractAudio: async (_input, output) => {
      extracted.push(output)
      await writeFile(output, "audio")
    },
  }
}

test("transcribes every video and returns transcripts by video id", async () => {
  const { videos, workDir, cache } = await setup(["a.mov", "b.mov"])
  const engine = fakeEngine()
  const result = await transcribeVideos({ videos, engine, media: fakeMedia(), cache, workDir })
  expect([...result.keys()]).toEqual(["a.mov", "b.mov"])
  expect(engine.calls).toEqual([join(workDir, "a.mov.flac"), join(workDir, "b.mov.flac")])
})

test("reports each video moving through the steps", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  const events: TranscriptionEvent[] = []
  await transcribeVideos({ videos, engine: fakeEngine(), media: fakeMedia(), cache, workDir, onEvent: (e) => events.push(e) })
  expect(events.map((e) => e.status.state)).toEqual(["queued", "extracting", "transcribing", "transcribing", "done"])
  expect(events[3]!.status).toEqual({ state: "transcribing", progress: 0.5 })
})

test("uses a cached transcript instead of transcribing again", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  await cache.put(videos[0]!.path, { engine: "scribe", model: "scribe_v2", language: "th" }, spoken("from cache"))
  const engine = fakeEngine()
  const events: TranscriptionEvent[] = []
  const result = await transcribeVideos({ videos, engine, media: fakeMedia(), cache, workDir, onEvent: (e) => events.push(e) })
  expect(engine.calls).toEqual([])
  expect(result.get("a.mov")!.words[0]!.text).toBe("from cache")
  expect(events.at(-1)!.status).toMatchObject({ state: "done", fromCache: true })
})

test("stores new transcripts so the next run is instant", async () => {
  const { videos, workDir, cache } = await setup(["a.mov"])
  await transcribeVideos({ videos, engine: fakeEngine(), media: fakeMedia(), cache, workDir })
  expect(await cache.get(videos[0]!.path, { engine: "scribe", model: "scribe_v2", language: "th" })).not.toBeNull()
})

test("a video without sound gets an empty transcript without calling the engine", async () => {
  const { videos, workDir, cache } = await setup(["broll.mov"])
  const engine = fakeEngine()
  const media = fakeMedia(["broll.mov"])
  const result = await transcribeVideos({ videos, engine, media, cache, workDir })
  expect(engine.calls).toEqual([])
  expect(media.extracted).toEqual([])
  expect(result.get("broll.mov")).toMatchObject({ engine: "none", words: [], utterances: [] })
})

test("one failing video does not stop the others", async () => {
  const { videos, workDir, cache } = await setup(["bad.mov", "good.mov"])
  const engine = fakeEngine({
    transcribe: async (audioPath) => {
      if (audioPath.includes("bad")) throw new Error("engine exploded")
      return spoken("ok")
    },
  })
  const events: TranscriptionEvent[] = []
  const result = await transcribeVideos({ videos, engine, media: fakeMedia(), cache, workDir, onEvent: (e) => events.push(e) })
  expect([...result.keys()]).toEqual(["good.mov"])
  expect(events.find((e) => e.videoId === "bad.mov" && e.status.state === "failed")!.status).toEqual({
    state: "failed",
    error: "engine exploded",
  })
})

test("a video whose file is gone fails on its own, and the rest are still transcribed", async () => {
  const { videos, workDir, cache } = await setup(["gone.mov", "good.mov"])
  const { rm } = await import("node:fs/promises")
  await rm(videos[0]!.path)
  const failing: MediaTools = { ...fakeMedia(), hasAudio: async (path) => {
    if (path.includes("gone")) throw new Error("no such file")
    return true
  } }
  const events: TranscriptionEvent[] = []
  const result = await transcribeVideos({ videos, engine: fakeEngine(), media: failing, cache, workDir, onEvent: (e) => events.push(e) })
  expect([...result.keys()]).toEqual(["good.mov"])
  expect(events.find((e) => e.videoId === "gone.mov")?.status.state === "queued").toBe(true)
  expect(events.some((e) => e.videoId === "gone.mov" && e.status.state === "failed")).toBe(true)
})

test("temporary audio files are removed afterwards, even after a failure", async () => {
  const { videos, workDir, cache } = await setup(["bad.mov", "good.mov"])
  const engine = fakeEngine({
    transcribe: async (audioPath) => {
      if (audioPath.includes("bad")) throw new Error("boom")
      return spoken("ok")
    },
  })
  await transcribeVideos({ videos, engine, media: fakeMedia(), cache, workDir })
  expect(await readdir(workDir)).toEqual([])
})

test("cancelling stops the run and rejects", async () => {
  const { videos, workDir, cache } = await setup(["a.mov", "b.mov"])
  const controller = new AbortController()
  let started = 0
  const engine = fakeEngine({
    transcribe: async () => {
      started += 1
      controller.abort()
      controller.signal.throwIfAborted()
      return spoken("never")
    },
  })
  await expect(
    transcribeVideos({ videos, engine, media: fakeMedia(), cache, workDir, signal: controller.signal }),
  ).rejects.toThrow(/abort/i)
  // b.mov is never started
  expect(started).toBe(1)
})
