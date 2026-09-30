import { runProcess } from "./process.ts"

export async function hasAudioStream(ffprobe: string, path: string, signal?: AbortSignal): Promise<boolean> {
  const { stdout } = await runProcess(
    ffprobe,
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
    { signal },
  )
  return stdout.trim() !== ""
}

/** whisper.cpp reads 16 kHz mono WAV; FLAC is the same audio at about half the size, for uploads. */
export type AudioFormat = "wav" | "flac"

const CODECS: Record<AudioFormat, string> = { wav: "pcm_s16le", flac: "flac" }

export async function extractAudio(args: {
  ffmpeg: string
  input: string
  /** ffmpeg input format, for generated test sources */
  inputFormat?: string
  output: string
  format: AudioFormat
  signal?: AbortSignal
}): Promise<void> {
  await runProcess(
    args.ffmpeg,
    [
      "-nostdin", "-v", "error", "-y",
      ...(args.inputFormat ? ["-f", args.inputFormat] : []),
      "-i", args.input,
      // first audio stream only; phones record a single one
      "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", CODECS[args.format],
      args.output,
    ],
    { signal: args.signal },
  )
}
