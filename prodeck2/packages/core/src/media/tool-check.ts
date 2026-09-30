import { ProcessError, runProcess } from "./process.ts"

/** What the analysis runs through ffmpeg: the signal filters, frame export and audio extraction. */
const REQUIRED_FILTERS = ["scdet", "blackdetect", "freezedetect", "blurdetect", "silencedetect", "fps", "scale", "metadata"]
/** wrapped_avframe is what `-f null` encodes the video into while the signal filters run; prores_ks makes the graphics, png their posters */
const REQUIRED_ENCODERS = ["mjpeg", "flac", "pcm_s16le", "wrapped_avframe", "prores_ks", "png"]
/** frames, extracted speech, the loudness pipe, the null sink the signal filters write to, and the .mov the graphics land in */
const REQUIRED_MUXERS = ["image2", "wav", "flac", "s16le", "null", "mov"]

/** Names in the second column of `ffmpeg -filters` / `-encoders` / `-muxers` listings, after the rule of dashes. */
function listedNames(listing: string): Set<string> {
  const lines = listing.split("\n")
  const rule = lines.findIndex((line) => /^-+$/.test(line.trim()))
  return new Set(lines.slice(rule + 1).flatMap((line) => line.trim().split(/\s+/)[1] ?? []))
}

export function missingFfmpegParts(filters: string, encoders: string, muxers: string): string[] {
  const have = [listedNames(filters), listedNames(encoders), listedNames(muxers)] as const
  return [
    ...REQUIRED_FILTERS.filter((name) => !have[0].has(name)),
    ...REQUIRED_ENCODERS.filter((name) => !have[1].has(name)),
    ...REQUIRED_MUXERS.filter((name) => !have[2].has(name)),
  ]
}

export function parseToolVersion(firstLine: string): string | null {
  return /(?:version\s+)?(\S*\d\S*)/.exec(firstLine.trim())?.[1] ?? null
}

/** The word timings BOXBLACK relies on come from whisper.cpp's DTW option. */
export function whisperSupportsDtw(help: string): boolean {
  return /(^|\s)-dtw\b/m.test(help)
}

export interface ToolReport {
  /** `bundled` is set by the app when this ffmpeg is the one it ships with */
  ffmpeg: { path: string; version: string | null; missing: string[]; bundled?: boolean } | null
  ffprobe: { path: string } | null
  /** `usable` is false when the binary does not run or lacks DTW word timings; `pinned` is set by the app for the version it tested */
  whisper: { path: string; usable: boolean; pinned?: boolean; bundled?: boolean } | null
  claude: { path: string; version: string | null } | null
}

type Run = (command: string, args: string[]) => Promise<string>

/** Both streams: whisper-cli prints its help to stderr, most tools print to stdout. */
const runBoth: Run = async (command, args) => {
  try {
    const { stdout, stderr } = await runProcess(command, args)
    return `${stdout}\n${stderr}`
  } catch (error) {
    if (error instanceof ProcessError) return `${error.stdout}\n${error.stderr}`
    throw error
  }
}

/** Checks the tools found on this machine can do what analysis asks of them. Never throws. */
export async function inspectTools(
  paths: { ffmpeg: string | null; ffprobe: string | null; whisper: string | null; claude: string | null },
  run: Run = runBoth,
): Promise<ToolReport> {
  const attempt = async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn()
    } catch {
      return fallback
    }
  }
  const firstLine = (text: string) => text.trim().split("\n")[0] ?? ""

  const [ffmpeg, whisper, claude] = await Promise.all([
    paths.ffmpeg
      ? attempt(async () => {
          const [version, filters, encoders, muxers] = await Promise.all([
            run(paths.ffmpeg!, ["-hide_banner", "-version"]),
            run(paths.ffmpeg!, ["-hide_banner", "-filters"]),
            run(paths.ffmpeg!, ["-hide_banner", "-encoders"]),
            run(paths.ffmpeg!, ["-hide_banner", "-muxers"]),
          ])
          return { path: paths.ffmpeg!, version: parseToolVersion(firstLine(version)), missing: missingFfmpegParts(filters, encoders, muxers) }
        }, { path: paths.ffmpeg, version: null, missing: ["ffmpeg"] })
      : null,
    paths.whisper
      ? attempt(async () => ({ path: paths.whisper!, usable: whisperSupportsDtw(await run(paths.whisper!, ["--help"])) }), { path: paths.whisper, usable: false })
      : null,
    paths.claude
      ? attempt(async () => ({ path: paths.claude!, version: parseToolVersion(firstLine(await run(paths.claude!, ["--version"]))) }), { path: paths.claude, version: null })
      : null,
  ])
  return { ffmpeg, ffprobe: paths.ffprobe ? { path: paths.ffprobe } : null, whisper, claude }
}
