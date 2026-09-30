import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { extractAudio } from "../media/audio.ts"
import { findExecutable } from "../media/tools.ts"
import { WHISPER_MODELS } from "./models.ts"
import { parseWhisperJson, transcribeWithWhisper, whisperArgs } from "./whisper.ts"

interface Token {
  /** raw UTF-8 bytes, which may stop in the middle of a character */
  bytes: Buffer
  dtw: number
  from: number
  to: number
}

const tok = (text: string, dtw: number, from: number, to: number): Token => ({ bytes: Buffer.from(text), dtw, from, to })

/**
 * Builds whisper-cli -ojf output the way whisper.cpp writes it: token text is copied
 * byte for byte, so a token may hold half of a UTF-8 character.
 */
function whisperJson(segments: Token[][], language = "th"): Buffer {
  const json = {
    result: { language },
    transcription: segments.map((tokens) => ({
      offsets: { from: 0, to: 0 },
      text: "",
      tokens: [
        { text: "[_BEG_]", offsets: { from: 0, to: 0 }, t_dtw: -1, p: 1 },
        ...tokens.map((t) => ({ text: t.bytes.toString("latin1"), offsets: { from: t.from, to: t.to }, t_dtw: t.dtw, p: 1 })),
        { text: "[_TT_500]", offsets: { from: 0, to: 0 }, t_dtw: -1, p: 1 },
      ],
    })),
  }
  return Buffer.from(JSON.stringify(json), "latin1")
}

test("times tokens by their DTW position and drops whisper's special tokens", () => {
  // t_dtw is in 10 ms steps; the last token of an utterance lasts as long as whisper's own token span
  const transcript = parseWhisperJson(whisperJson([[tok("สวัส", 188, 0, 400), tok("ดี", 220, 400, 600)]]), "large-v3-q5_0")
  expect(transcript.utterances).toEqual([{ text: "สวัสดี", startUs: 1_880_000, endUs: 2_400_000 }])
  expect(transcript.words).toEqual([{ text: "สวัสดี", startUs: 1_880_000, endUs: 2_400_000 }])
})

test("a token inside a phrase runs until the next token starts", () => {
  const transcript = parseWhisperJson(whisperJson([[tok("ดี", 100, 0, 100), tok("มาก", 150, 100, 400)]]), "m")
  expect(transcript.words).toEqual([
    { text: "ดี", startUs: 1_000_000, endUs: 1_500_000 },
    { text: "มาก", startUs: 1_500_000, endUs: 1_800_000 },
  ])
})

test("a space followed by a pause starts a new utterance", () => {
  const transcript = parseWhisperJson(
    whisperJson([[tok("หนึ่ง", 100, 1000, 1200), tok(" ", 130, 1200, 1200), tok("สอง", 200, 2000, 2200)]]),
    "m",
  )
  expect(transcript.utterances).toEqual([
    { text: "หนึ่ง", startUs: 1_000_000, endUs: 1_200_000 },
    { text: "สอง", startUs: 2_000_000, endUs: 2_200_000 },
  ])
})

test("a character whose bytes are split across two tokens starts at the first of them", () => {
  const sa = Buffer.from("ส") // e0 b8 aa
  const transcript = parseWhisperJson(
    whisperJson([
      [
        { bytes: sa.subarray(0, 2), dtw: 100, from: 0, to: 50 },
        { bytes: Buffer.concat([sa.subarray(2), Buffer.from("วัสดี")]), dtw: 110, from: 50, to: 400 },
      ],
    ]),
    "m",
  )
  expect(transcript.utterances).toEqual([{ text: "สวัสดี", startUs: 1_000_000, endUs: 1_450_000 }])
})

test("falls back to whisper's own token times when DTW gave none", () => {
  const transcript = parseWhisperJson(whisperJson([[tok("ok", -1, 3000, 3400)]]), "m")
  expect(transcript.words).toEqual([{ text: "ok", startUs: 3_000_000, endUs: 3_400_000 }])
})

test("records the engine, model and detected language", () => {
  const transcript = parseWhisperJson(whisperJson([[tok("hi", 10, 0, 100)]], "en"), "large-v3-q5_0")
  expect([transcript.engine, transcript.model, transcript.language, transcript.audioEvents]).toEqual([
    "whisper-local",
    "large-v3-q5_0",
    "en",
    [],
  ])
})

test("whisperArgs asks for full JSON with DTW token timestamps and progress", () => {
  const args = whisperArgs({
    modelPath: "/models/ggml-large-v3-q5_0.bin",
    audioPath: "/work/clip.wav",
    outputBase: "/work/clip",
    language: "th",
    dtwPreset: "large.v3",
    threads: 6,
  })
  expect(args).toEqual([
    "-m", "/models/ggml-large-v3-q5_0.bin",
    "-f", "/work/clip.wav",
    "-l", "th",
    "-ojf", "-of", "/work/clip",
    // DTW does not work with flash attention, which whisper.cpp turns on by default
    "-dtw", "large.v3", "-nfa",
    "-t", "6",
    "-pp", "-np",
  ])
})

const whisperCli = findExecutable("whisper-cli")
const ffmpeg = findExecutable("ffmpeg")
const modelPath = join(homedir(), "Library/Application Support/BOXBLACK/models", WHISPER_MODELS[0]!.file)
const say = existsSync("/usr/bin/say")

describe.skipIf(!whisperCli || !ffmpeg || !existsSync(modelPath) || !say)("with whisper.cpp and the model installed", () => {
  test("transcribes real speech and reports progress", { timeout: 120_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-whisper-"))
    const aiff = join(dir, "speech.aiff")
    const wav = join(dir, "speech.wav")
    execFileSync("/usr/bin/say", ["-v", "Samantha", "-o", aiff, "Good morning. Today we are going to space."])
    await extractAudio({ ffmpeg: ffmpeg!, input: aiff, output: wav, format: "wav" })

    const progress: number[] = []
    const transcript = await transcribeWithWhisper({
      binary: whisperCli!,
      modelPath,
      model: WHISPER_MODELS[0]!,
      audioPath: wav,
      language: "en",
      onProgress: (fraction) => progress.push(fraction),
    })

    const text = transcript.utterances.map((u) => u.text).join(" ").toLowerCase()
    expect(text).toContain("morning")
    expect(text).toContain("space")
    expect(transcript.words.length).toBeGreaterThan(4)
    expect(progress.at(-1)).toBe(1)
    expect(existsSync(`${wav}.whisper.json`)).toBe(false)
  })
})
