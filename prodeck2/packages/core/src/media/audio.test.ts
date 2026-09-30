import { beforeAll, describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractAudio, hasAudioStream } from "./audio.ts"
import { findExecutable } from "./tools.ts"

const ffmpeg = findExecutable("ffmpeg")
const ffprobe = findExecutable("ffprobe")

function probe(path: string): Record<string, string> {
  const out = execFileSync(ffprobe!, [
    "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "default=nw=1", path,
  ]).toString()
  return Object.fromEntries(out.trim().split("\n").map((line) => line.split("=") as [string, string]))
}

describe.skipIf(!ffmpeg || !ffprobe)("with ffmpeg installed", () => {
  let dir: string
  let withAudio: string
  let silentVideo: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "boxblack-audio-"))
    withAudio = join(dir, "talk.mp4")
    silentVideo = join(dir, "broll.mp4")
    const color = ["-f", "lavfi", "-i", "color=c=black:s=64x64:d=2"]
    execFileSync(ffmpeg!, ["-v", "error", ...color, "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000", "-ac", "2", "-shortest", withAudio])
    execFileSync(ffmpeg!, ["-v", "error", ...color, silentVideo])
  })

  test("hasAudioStream tells a clip with sound from one without", async () => {
    expect(await hasAudioStream(ffprobe!, withAudio)).toBe(true)
    expect(await hasAudioStream(ffprobe!, silentVideo)).toBe(false)
  })

  test("extractAudio writes 16 kHz mono PCM WAV for whisper.cpp", async () => {
    const output = join(dir, "talk.wav")
    await extractAudio({ ffmpeg: ffmpeg!, input: withAudio, output, format: "wav" })
    const info = probe(output)
    expect([info.codec_name, info.sample_rate, info.channels]).toEqual(["pcm_s16le", "16000", "1"])
    expect(Number(info.duration)).toBeCloseTo(2, 1)
  })

  test("extractAudio writes 16 kHz mono FLAC for upload", async () => {
    const output = join(dir, "talk.flac")
    await extractAudio({ ffmpeg: ffmpeg!, input: withAudio, output, format: "flac" })
    const info = probe(output)
    expect([info.codec_name, info.sample_rate, info.channels]).toEqual(["flac", "16000", "1"])
  })

  test("extractAudio reports ffmpeg's own error for a file it cannot read", async () => {
    await expect(
      extractAudio({ ffmpeg: ffmpeg!, input: join(dir, "nope.mov"), output: join(dir, "x.wav"), format: "wav" }),
    ).rejects.toThrow(/No such file/)
  })

  test("extractAudio stops ffmpeg when cancelled", async () => {
    const controller = new AbortController()
    const running = extractAudio({
      ffmpeg: ffmpeg!,
      // an endless generated source only ends when the process is killed
      input: "sine=frequency=440",
      inputFormat: "lavfi",
      output: join(dir, "endless.wav"),
      format: "wav",
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 100)
    await expect(running).rejects.toThrow(/abort/i)
  })
})
