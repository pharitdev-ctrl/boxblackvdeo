import { runProcess } from "@boxblack/core/media"

/*
 * The loudness of a composed sound, measured and set with the app's own ffmpeg (spec §7). A render is not scaled in the
 * page, and the spike's ranged from -31.6 to -19.6 LUFS, so every sound is set to the level its loudness class asks for
 * before it is laid under the voice: ebur128 measures it, and the volume filter turns it, written as a plain 16-bit
 * stereo 48 kHz WAV.
 */

/** Runs a tool to its end and gives back what it printed: runProcess, or a test's fake ffmpeg. */
export type RunTool = (command: string, args: string[], options?: { signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string }>

/** How long one ffmpeg call over a sound of a few seconds may take before it is stopped: a hang, never the sound's doing. */
export const FFMPEG_TIMEOUT_MS = 30_000

/** What ebur128 measured of a file. */
export interface Measured {
  /** its integrated loudness in LUFS; null when it is too short (under one 400 ms block) or too quiet to gate */
  lufs: number | null
  /** its true peak in dBFS; minus infinity for digital silence */
  peak: number
}

/** What ebur128 reports, or less, for a file it could not gate. */
const UNGATED_LUFS = -70
/** Where the peak of a sound with no loudness to go by is set. */
const PEAK_WITHOUT_LOUDNESS = -6
/** The highest the peak of any sound is lifted to, with room for what playback adds between samples. */
const PEAK_CEILING = -1

/** The summary's lines: indented, alone on the line, unlike a frame's, which ebur128 prints after its own tag. */
const INTEGRATED = /^\s*I:\s+(-?\d+(?:\.\d+)?) LUFS\s*$/gm
const PEAK = /^\s*Peak:\s+(-inf|-?\d+(?:\.\d+)?) dBFS\s*$/gm

/**
 * What ebur128 measured, from what ffmpeg printed: the last integrated loudness and the last peak of its summary. The
 * peak is the true peak, since the app asks for it (`peak=true`) rather than the sample peak: it is the higher of the
 * two, and what a sound reaches once it is played back. Output with no summary is an error.
 */
export function loudnessOf(printed: string): Measured {
  const integrated = [...printed.matchAll(INTEGRATED)].at(-1)?.[1]
  const peak = [...printed.matchAll(PEAK)].at(-1)?.[1]
  if (integrated === undefined || peak === undefined) throw new Error("ffmpeg did not report the sound's loudness")
  const lufs = Number(integrated)
  return { lufs: lufs <= UNGATED_LUFS ? null : lufs, peak: peak === "-inf" ? -Infinity : Number(peak) }
}

/** Measures a WAV's integrated loudness and true peak with ebur128, stopping ffmpeg after `timeoutMs` (it then rejects with a TimeoutError). */
export async function measureLoudness(ffmpeg: string, wavPath: string, run: RunTool = runProcess, timeoutMs = FFMPEG_TIMEOUT_MS): Promise<Measured> {
  const signal = AbortSignal.timeout(timeoutMs)
  const { stdout, stderr } = await run(ffmpeg, ["-nostdin", "-hide_banner", "-i", wavPath, "-af", "ebur128=framelog=quiet:peak=true", "-f", "null", "-"], { signal })
  return loudnessOf(`${stdout}\n${stderr}`)
}

/**
 * The gain in dB that sets a sound to `target` LUFS, or, when it has no loudness to go by, brings its peak to -6 dBFS.
 * Either way it never lifts the peak above -1 dBFS. Digital silence is left as it is.
 */
function gainFor(measured: Measured, target: number): number {
  if (!Number.isFinite(measured.peak)) return 0
  const wanted = measured.lufs === null ? PEAK_WITHOUT_LOUDNESS - measured.peak : target - measured.lufs
  return Math.min(wanted, PEAK_CEILING - measured.peak)
}

/**
 * Writes `inPath` to `outPath` set to `target` LUFS: measured first, then turned by the volume filter, as 16-bit stereo
 * 48 kHz PCM in a WAV. The output is named by the caller, whatever its name ends with, and written over; it carries no
 * tags, so it is the plain WAV the harness writes and CapCut was shown to take (Task 1). Each ffmpeg call is stopped
 * after `timeoutMs`, and the levelling then rejects with a TimeoutError.
 */
export async function setLoudness(ffmpeg: string, inPath: string, outPath: string, target: number, run: RunTool = runProcess, timeoutMs = FFMPEG_TIMEOUT_MS): Promise<void> {
  // cut down to the hundredth below, never rounded up past the ceiling; the millionth forgives a float's noise (1.7 held as 1.6999…)
  const gain = Math.floor(gainFor(await measureLoudness(ffmpeg, inPath, run, timeoutMs), target) * 100 + 1e-6) / 100
  await run(ffmpeg, [
    "-nostdin", "-v", "error", "-y", "-i", inPath, "-af", `volume=${gain.toFixed(2)}dB`,
    "-map_metadata", "-1", "-fflags", "+bitexact", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "wav", outPath,
  ], { signal: AbortSignal.timeout(timeoutMs) })
}
