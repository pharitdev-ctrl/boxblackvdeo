import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { buildSpeech, type SpeechItem } from "./speech.ts"
import type { SpokenLanguage, Transcript } from "./types.ts"

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"

/** Scribe wants ISO 639-3 codes. */
const LANGUAGE_CODES: Record<Exclude<SpokenLanguage, "auto">, string> = { th: "tha", en: "eng" }

interface ScribeWord {
  text: string
  type: "word" | "spacing" | "audio_event"
  start: number
  end: number
}

export interface ScribeResponse {
  language_code?: string
  text: string
  words: ScribeWord[]
}

const us = (seconds: number) => Math.round(seconds * 1_000_000)

export function parseScribe(response: ScribeResponse, model: string): Transcript {
  const items: SpeechItem[] = response.words.map((w) => {
    if (w.type === "audio_event") return { kind: "event", text: w.text, atUs: us(w.start) }
    if (w.type === "spacing") return { kind: "boundary" }
    return { kind: "fragment", text: w.text, startUs: us(w.start), endUs: us(w.end) }
  })
  return { engine: "scribe", model, language: response.language_code ?? "", ...buildSpeech(items) }
}

export async function transcribeWithScribe(args: {
  apiKey: string
  audioPath: string
  language: SpokenLanguage
  model: string
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}): Promise<Transcript> {
  const form = new FormData()
  form.set("model_id", args.model)
  if (args.language !== "auto") form.set("language_code", LANGUAGE_CODES[args.language])
  form.set("timestamps_granularity", "word")
  form.set("file", new Blob([new Uint8Array(await readFile(args.audioPath))]), basename(args.audioPath))

  const response = await (args.fetch ?? fetch)(ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": args.apiKey },
    body: form,
    signal: args.signal,
  })
  if (!response.ok) {
    const body = (await response.text()).slice(0, 400)
    const hint = response.status === 401 ? " — the ElevenLabs API key was rejected" : ""
    throw new Error(`ElevenLabs Scribe ${response.status}${hint}: ${body}`)
  }
  return parseScribe((await response.json()) as ScribeResponse, args.model)
}
