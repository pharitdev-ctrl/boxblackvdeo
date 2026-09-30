import { readFile, rm } from "node:fs/promises"
import { availableParallelism } from "node:os"
import { runProcess } from "../media/process.ts"
import type { WhisperModel } from "./models.ts"
import { buildSpeech, type SpeechItem } from "./speech.ts"
import type { SpokenLanguage, Transcript } from "./types.ts"

interface WhisperToken {
  text: string
  /** milliseconds, from whisper's own timestamp tokens — measured 1.9 s early on real Thai speech */
  offsets: { from: number; to: number }
  /** 10 ms steps, from DTW alignment — matched ElevenLabs Scribe within 20 ms on the same clip */
  t_dtw?: number
}

interface WhisperOutput {
  result?: { language?: string }
  transcription: { tokens: WhisperToken[] }[]
}

type Piece =
  | { kind: "fragment"; text: string; startUs: number; anchorUs: number; durationUs: number }
  | { kind: "boundary" }

/**
 * Reads `whisper-cli -ojf -dtw` output.
 *
 * whisper.cpp copies each token's bytes into the JSON verbatim, so a token can end in
 * the middle of a UTF-8 character. The file is therefore read as latin1 (one char per
 * byte) and decoded as a stream; a character belongs to the token that completes it
 * and starts when the first of its bytes did.
 *
 * A fragment directly followed by another runs until that one starts. Before a break,
 * it lasts as long as whisper's own token span, which ended utterances within 10 ms
 * of Scribe on a real clip.
 */
export function parseWhisperJson(raw: Buffer, model: string): Transcript {
  const output = JSON.parse(raw.toString("latin1")) as WhisperOutput
  const decoder = new TextDecoder("utf-8")
  const pieces: Piece[] = []
  let lastAnchor = 0
  let carriedStart: number | null = null

  for (const segment of output.transcription) {
    for (const token of segment.tokens) {
      if (token.text.startsWith("[_")) continue
      const ownUs = token.t_dtw !== undefined && token.t_dtw >= 0 ? token.t_dtw * 10_000 : token.offsets.from * 1000
      const anchorUs = Math.max(ownUs, lastAnchor)
      lastAnchor = anchorUs

      const text = decoder.decode(Buffer.from(token.text, "latin1"), { stream: true })
      if (!text) {
        carriedStart ??= anchorUs
        continue
      }
      const startUs = carriedStart ?? anchorUs
      carriedStart = null

      const trimmed = text.trim()
      if (/^\s/.test(text)) pieces.push({ kind: "boundary" })
      if (trimmed) {
        const durationUs = Math.max(0, token.offsets.to - token.offsets.from) * 1000
        pieces.push({ kind: "fragment", text: trimmed, startUs, anchorUs, durationUs })
        if (/\s$/.test(text)) pieces.push({ kind: "boundary" })
      }
    }
    // whisper segments end at sentence breaks
    pieces.push({ kind: "boundary" })
  }

  const items: SpeechItem[] = new Array(pieces.length)
  let nextFragmentStart = Infinity
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]!
    if (piece.kind === "boundary") {
      items[i] = piece
      continue
    }
    const next = pieces[i + 1]
    const endUs =
      next?.kind === "fragment" ? next.startUs : Math.min(nextFragmentStart, piece.anchorUs + piece.durationUs)
    items[i] = { kind: "fragment", text: piece.text, startUs: piece.startUs, endUs: Math.max(endUs, piece.startUs) }
    nextFragmentStart = piece.startUs
  }

  return { engine: "whisper-local", model, language: output.result?.language ?? "", ...buildSpeech(items) }
}

export function whisperArgs(args: {
  modelPath: string
  audioPath: string
  outputBase: string
  language: SpokenLanguage
  dtwPreset: string
  threads: number
}): string[] {
  return [
    "-m", args.modelPath,
    "-f", args.audioPath,
    "-l", args.language,
    "-ojf", "-of", args.outputBase,
    // DTW does not work with flash attention, which whisper.cpp turns on by default
    "-dtw", args.dtwPreset, "-nfa",
    "-t", String(args.threads),
    "-pp", "-np",
  ]
}

/** Runs whisper-cli on 16 kHz mono WAV. Progress comes from its stderr progress lines. */
export async function transcribeWithWhisper(args: {
  binary: string
  modelPath: string
  model: WhisperModel
  audioPath: string
  language: SpokenLanguage
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}): Promise<Transcript> {
  const outputBase = `${args.audioPath}.whisper`
  try {
    await runProcess(
      args.binary,
      whisperArgs({
        modelPath: args.modelPath,
        audioPath: args.audioPath,
        outputBase,
        language: args.language,
        dtwPreset: args.model.dtwPreset,
        threads: Math.min(8, availableParallelism()),
      }),
      {
        signal: args.signal,
        onStderr: (chunk) => {
          for (const match of chunk.matchAll(/progress = +(\d+)%/g)) args.onProgress?.(Number(match[1]) / 100)
        },
      },
    )
    const transcript = parseWhisperJson(await readFile(`${outputBase}.json`), args.model.id)
    args.onProgress?.(1)
    return transcript
  } finally {
    await rm(`${outputBase}.json`, { force: true })
  }
}
