import { expect, test } from "vitest"
import { mkdtemp, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TranscriptCache } from "./cache.ts"
import type { Transcript } from "./types.ts"

const transcript: Transcript = {
  engine: "scribe",
  model: "scribe_v2",
  language: "tha",
  utterances: [{ text: "สวัสดี", startUs: 0, endUs: 500_000 }],
  words: [{ text: "สวัสดี", startUs: 0, endUs: 500_000 }],
  audioEvents: [],
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-cache-"))
  const media = join(dir, "clip.mov")
  await writeFile(media, "video bytes")
  return { cache: new TranscriptCache(join(dir, "cache")), media }
}

const scribeTh = { engine: "scribe", model: "scribe_v2", language: "th" } as const

test("a stored transcript comes back for the same file and settings", async () => {
  const { cache, media } = await setup()
  await cache.put(media, scribeTh, transcript)
  expect(await cache.get(media, scribeTh)).toEqual(transcript)
})

test("nothing comes back for a file that was never transcribed", async () => {
  const { cache, media } = await setup()
  expect(await cache.get(media, scribeTh)).toBeNull()
})

test("a different engine, model or language is a cache miss", async () => {
  const { cache, media } = await setup()
  await cache.put(media, scribeTh, transcript)
  expect(await cache.get(media, { ...scribeTh, engine: "whisper-local" })).toBeNull()
  expect(await cache.get(media, { ...scribeTh, model: "scribe_v3" })).toBeNull()
  expect(await cache.get(media, { ...scribeTh, language: "en" })).toBeNull()
})

test("editing the file on disk invalidates its transcript", async () => {
  const { cache, media } = await setup()
  await cache.put(media, scribeTh, transcript)
  await writeFile(media, "re-exported video bytes")
  expect(await cache.get(media, scribeTh)).toBeNull()
})

test("touching the file's modified time invalidates its transcript", async () => {
  const { cache, media } = await setup()
  await cache.put(media, scribeTh, transcript)
  const later = new Date(Date.now() + 60_000)
  await utimes(media, later, later)
  expect(await cache.get(media, scribeTh)).toBeNull()
})

test("a result is kept for the file as it was when the work began, not for one put in its place meanwhile", async () => {
  const { cache, media } = await setup()
  const entry = await cache.entry(media, scribeTh)
  expect(await entry.get()).toBeNull()
  // the clip is exported again while it is being transcribed
  await writeFile(media, "a new cut of the video")
  await entry.put(transcript)
  expect(await cache.get(media, scribeTh)).toBeNull()
})
