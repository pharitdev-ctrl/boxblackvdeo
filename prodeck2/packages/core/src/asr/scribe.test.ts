import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseScribe, transcribeWithScribe, type ScribeResponse } from "./scribe.ts"

const word = (text: string, start: number, end: number) => ({ text, type: "word" as const, start, end })
const spacing = (start: number, end: number) => ({ text: " ", type: "spacing" as const, start, end })

// Scribe returns Thai one character (or cluster) at a time; seconds as floats
const response: ScribeResponse = {
  language_code: "tha",
  text: "ดีมาก (หัวเราะ) ok ไป",
  words: [
    word("ดี", 0.1, 0.3),
    word("มาก", 0.3, 0.6),
    { text: "(หัวเราะ)", type: "audio_event", start: 0.7, end: 1.2 },
    spacing(0.6, 1.4),
    word("ok", 1.4, 1.7),
    spacing(1.7, 1.8),
    word("ไป", 1.8, 2.0),
  ],
}

test("parseScribe splits speech into utterances at pauses of 0.35 s or more", () => {
  const transcript = parseScribe(response, "scribe_v2")
  expect(transcript.utterances).toEqual([
    { text: "ดีมาก", startUs: 100_000, endUs: 600_000 },
    { text: "ok ไป", startUs: 1_400_000, endUs: 2_000_000 },
  ])
})

test("parseScribe ends an utterance at a sound effect that fills a pause between words", () => {
  // shape seen in a real response: short spacings on both sides of a 1.5 s clap
  const clap: ScribeResponse = {
    text: "สาม [เสียงตบมือ] ว้าว",
    words: [
      word("สาม", 24.9, 25.2),
      spacing(25.2, 25.34),
      { text: "[เสียงตบมือ]", type: "audio_event", start: 25.34, end: 26.8 },
      spacing(26.8, 26.82),
      word("ว้าว", 26.82, 27.1),
    ],
  }
  expect(parseScribe(clap, "scribe_v2").utterances).toEqual([
    { text: "สาม", startUs: 24_900_000, endUs: 25_200_000 },
    { text: "ว้าว", startUs: 26_820_000, endUs: 27_100_000 },
  ])
})

test("parseScribe does not split inside a word even when its characters are far apart in time", () => {
  // real response: "ใ" 8.78 s, then "น" 9.14 s, with no spacing between them ("ในปัจจุบัน")
  const slow: ScribeResponse = {
    text: "ในปัจจุบัน",
    words: [word("ใ", 8.7, 8.78), word("น", 9.14, 9.2), word("ปัจจุบัน", 9.2, 9.64)],
  }
  expect(parseScribe(slow, "scribe_v2").utterances).toEqual([{ text: "ในปัจจุบัน", startUs: 8_700_000, endUs: 9_640_000 }])
})

test("parseScribe never leaves doubled spaces inside an utterance", () => {
  const spaced: ScribeResponse = {
    text: "a b",
    words: [word("a", 0, 0.1), spacing(0.1, 0.12), spacing(0.12, 0.14), word("b", 0.14, 0.3)],
  }
  expect(parseScribe(spaced, "scribe_v2").utterances[0]!.text).toBe("a b")
})

test("parseScribe turns character fragments into words", () => {
  expect(parseScribe(response, "scribe_v2").words).toEqual([
    { text: "ดี", startUs: 100_000, endUs: 300_000 },
    { text: "มาก", startUs: 300_000, endUs: 600_000 },
    { text: "ok", startUs: 1_400_000, endUs: 1_700_000 },
    { text: "ไป", startUs: 1_800_000, endUs: 2_000_000 },
  ])
})

test("parseScribe keeps non-speech sounds apart from the words", () => {
  const transcript = parseScribe(response, "scribe_v2")
  expect(transcript.audioEvents).toEqual([{ text: "(หัวเราะ)", atUs: 700_000 }])
  expect(transcript.words.some((w) => w.text.includes("หัวเราะ"))).toBe(false)
})

test("parseScribe records engine, model and detected language", () => {
  const transcript = parseScribe(response, "scribe_v2")
  expect([transcript.engine, transcript.model, transcript.language]).toEqual(["scribe", "scribe_v2", "tha"])
})

async function audioFile(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "boxblack-scribe-")), "audio.flac")
  await writeFile(path, Buffer.from("fLaC-bytes"))
  return path
}

function recordingFetch(reply: Response) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! })
    return reply
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

test("transcribeWithScribe uploads the audio with the user's key and word timestamps", async () => {
  const { calls, fetch } = recordingFetch(Response.json(response))
  await transcribeWithScribe({ apiKey: "sk-user", audioPath: await audioFile(), language: "th", model: "scribe_v2", fetch })

  expect(calls).toHaveLength(1)
  const { url, init } = calls[0]!
  expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text")
  expect(init.method).toBe("POST")
  expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("sk-user")
  const form = init.body as FormData
  expect(form.get("model_id")).toBe("scribe_v2")
  expect(form.get("language_code")).toBe("tha")
  expect(form.get("timestamps_granularity")).toBe("word")
  const file = form.get("file") as File
  expect(file.name).toBe("audio.flac")
  expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("fLaC-bytes")
})

test("transcribeWithScribe lets Scribe detect the language when asked to", async () => {
  const { calls, fetch } = recordingFetch(Response.json(response))
  await transcribeWithScribe({ apiKey: "k", audioPath: await audioFile(), language: "auto", model: "scribe_v2", fetch })
  expect((calls[0]!.init.body as FormData).has("language_code")).toBe(false)
})

test("transcribeWithScribe returns the parsed transcript", async () => {
  const { fetch } = recordingFetch(Response.json(response))
  const transcript = await transcribeWithScribe({ apiKey: "k", audioPath: await audioFile(), language: "th", model: "scribe_v2", fetch })
  expect(transcript.utterances).toHaveLength(2)
})

test("transcribeWithScribe explains a rejected API key", async () => {
  const { fetch } = recordingFetch(new Response('{"detail":"invalid_api_key"}', { status: 401 }))
  await expect(
    transcribeWithScribe({ apiKey: "bad", audioPath: await audioFile(), language: "th", model: "scribe_v2", fetch }),
  ).rejects.toThrow(/401.*API key/s)
})

test("transcribeWithScribe reports other API failures with the response body", async () => {
  const { fetch } = recordingFetch(new Response("quota exceeded", { status: 429 }))
  await expect(
    transcribeWithScribe({ apiKey: "k", audioPath: await audioFile(), language: "th", model: "scribe_v2", fetch }),
  ).rejects.toThrow(/429.*quota exceeded/s)
})
