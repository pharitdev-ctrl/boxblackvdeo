import { expect, test } from "vitest"
import { loudnessOf, measureLoudness, setLoudness } from "./sound-loudness.ts"

/*
 * What the app's ffmpeg (8.1.2, resources/bin) printed on standard error for `-af ebur128=framelog=quiet:peak=true`,
 * captured from real runs and kept as it was but for the addresses: the spike's hook sound (3.2 s), a 0.25 s tone,
 * shorter than the 400 ms block ebur128 gates by, and half a second of digital silence.
 */
const HOOK = `[aist#0:0/pcm_s16le @ 0x754ac04180] Guessed Channel Layout: stereo
Input #0, wav, from '/w/hook.raw.wav':
  Duration: 00:00:03.20, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (pcm_s16le (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Metadata:
    encoder         : Lavf62.12.102
  Stream #0:0: Audio: pcm_s16le, 48000 Hz, stereo, s16, 1536 kb/s
    Metadata:
      encoder         : Lavc62.28.102 pcm_s16le
[Parsed_ebur128_0 @ 0x754b010780] Summary:

  Integrated loudness:
    I:         -23.7 LUFS
    Threshold: -37.0 LUFS

  Loudness range:
    LRA:        20.3 LU
    Threshold: -48.2 LUFS
    LRA low:   -48.2 LUFS
    LRA high:  -27.9 LUFS

  True peak:
    Peak:       -7.5 dBFS
[out#0/null @ 0x754b010300] video:0KiB audio:600KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:00:03.20 bitrate=N/A speed= 249x elapsed=0:00:00.01
`
const SHORT = `[Parsed_ebur128_0 @ 0x7556c1c600] Summary:

  Integrated loudness:
    I:         -70.0 LUFS
    Threshold:   0.0 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:      -21.1 dBFS
[out#0/null @ 0x7556c1c180] video:0KiB audio:47KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:00:00.25 bitrate=N/A speed= 146x elapsed=0:00:00.00
`
const SILENT = `[Parsed_ebur128_0 @ 0x74b2c1c600] Summary:

  Integrated loudness:
    I:         -70.0 LUFS
    Threshold:   0.0 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:       -inf dBFS
[out#0/null @ 0x74b2c1c180] video:0KiB audio:94KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:00:00.50 bitrate=N/A speed= 219x elapsed=0:00:00.00
`
/** A summary as ebur128 prints it with framelog on, after a frame's line, which has an I: of its own. */
const WITH_FRAMES = `[Parsed_ebur128_0 @ 0x1] t: 3.1      TARGET:-23 LUFS    M: -24.9 S: -24.0     I: -23.6 LUFS       LRA:  20.3 LU  TPK:  -7.5  -7.6 dBFS
${HOOK}`

/** An ffmpeg that prints `printed` on standard error for a measure, and nothing for anything else; every call is noted. */
function fakeFfmpeg(printed: string) {
  const calls: { command: string; args: string[] }[] = []
  const run = async (command: string, args: string[]) => {
    calls.push({ command, args })
    return { stdout: "", stderr: args.includes("null") ? printed : "" }
  }
  return { run, calls }
}

/** The gain a levelling call asked of the volume filter, in dB. */
const gainOf = (args: string[]) => Number(/^volume=(-?\d+(?:\.\d+)?)dB$/.exec(args[args.indexOf("-af") + 1] ?? "")?.[1])

test("the loudness is read from ebur128's summary: the integrated loudness in LUFS and the true peak in dBFS", () => {
  expect(loudnessOf(HOOK)).toEqual({ lufs: -23.7, peak: -7.5 })
})

test("ebur128's -70 LUFS is no loudness at all: the sound was too short or too quiet to gate", () => {
  expect(loudnessOf(SHORT)).toEqual({ lufs: null, peak: -21.1 })
  expect(loudnessOf(SHORT.replace("-70.0 LUFS", "-70.9 LUFS"))).toEqual({ lufs: null, peak: -21.1 })
  expect(loudnessOf(SHORT.replace("-70.0 LUFS", "-69.9 LUFS"))).toEqual({ lufs: -69.9, peak: -21.1 })
})

test("digital silence has a peak of minus infinity", () => {
  expect(loudnessOf(SILENT)).toEqual({ lufs: null, peak: -Infinity })
})

test("the summary's integrated loudness is the one read, not a frame's", () => {
  expect(loudnessOf(WITH_FRAMES)).toEqual({ lufs: -23.7, peak: -7.5 })
})

test("output with no summary is an error, not a loudness", () => {
  expect(() => loudnessOf("[in#0 @ 0x1] Error opening input: Invalid data found when processing input\n")).toThrow("ffmpeg did not report the sound's loudness")
  expect(() => loudnessOf(HOOK.replace(/ {4}Peak:.*\n/, ""))).toThrow("ffmpeg did not report the sound's loudness")
})

test("measureLoudness runs ebur128 on the file with the true peak, and reads what it printed", async () => {
  const ffmpeg = fakeFfmpeg(HOOK)
  expect(await measureLoudness("/app/ffmpeg", "/s/a.raw.wav", ffmpeg.run)).toEqual({ lufs: -23.7, peak: -7.5 })
  expect(ffmpeg.calls).toEqual([
    { command: "/app/ffmpeg", args: ["-nostdin", "-hide_banner", "-i", "/s/a.raw.wav", "-af", "ebur128=framelog=quiet:peak=true", "-f", "null", "-"] },
  ])
})

test("setLoudness measures the file, then writes it as a plain 16-bit stereo 48 kHz WAV, turned by the gain that reaches the target", async () => {
  const ffmpeg = fakeFfmpeg(HOOK)
  await setLoudness("/app/ffmpeg", "/s/a.raw.wav", "/s/a.wav.tmp", -26, ffmpeg.run)
  expect(ffmpeg.calls).toHaveLength(2)
  expect(ffmpeg.calls[0]!.args).toContain("ebur128=framelog=quiet:peak=true")
  expect(ffmpeg.calls[1]).toEqual({
    command: "/app/ffmpeg",
    args: [
      "-nostdin", "-v", "error", "-y", "-i", "/s/a.raw.wav", "-af", "volume=-2.30dB",
      "-map_metadata", "-1", "-fflags", "+bitexact", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "wav", "/s/a.wav.tmp",
    ],
  })
})

test("a sound turned up to its target is lifted no further than a peak of -1 dBFS", async () => {
  // -23.7 to -22 is +1.7 dB, which brings a -7.5 peak to -5.8: allowed
  const allowed = fakeFfmpeg(HOOK)
  await setLoudness("/f", "/in", "/out", -22, allowed.run)
  expect(gainOf(allowed.calls[1]!.args)).toBe(1.7)
  // -40 to -22 is +18 dB, which would bring a -7.5 peak to +10.5: held at -1, so +6.5
  const held = fakeFfmpeg(HOOK.replace("-23.7 LUFS", "-40.0 LUFS"))
  await setLoudness("/f", "/in", "/out", -22, held.run)
  expect(gainOf(held.calls[1]!.args)).toBe(6.5)
})

test("the gain is cut down to two decimals, never rounded up, so the -1 dBFS ceiling holds exactly", async () => {
  // -23.716 to -22 is +1.716 dB: written as +1.71, not +1.72
  const fine = fakeFfmpeg(HOOK.replace("-23.7 LUFS", "-23.716 LUFS"))
  await setLoudness("/f", "/in", "/out", -22, fine.run)
  expect(gainOf(fine.calls[1]!.args)).toBe(1.71)
  // held at the ceiling: a peak of -7.556 may rise 6.556 dB, written as 6.55, which leaves it just under -1
  const held = fakeFfmpeg(HOOK.replace("-23.7 LUFS", "-40.0 LUFS").replace("-7.5 dBFS", "-7.556 dBFS"))
  await setLoudness("/f", "/in", "/out", -22, held.run)
  expect(gainOf(held.calls[1]!.args)).toBe(6.55)
})

test("a sound with no loudness to go by has its peak brought to -6 dBFS", async () => {
  const quiet = fakeFfmpeg(SHORT)
  await setLoudness("/f", "/in", "/out", -26, quiet.run)
  expect(gainOf(quiet.calls[1]!.args)).toBe(15.1)
  const loud = fakeFfmpeg(SHORT.replace("-21.1 dBFS", "-2.5 dBFS"))
  await setLoudness("/f", "/in", "/out", -26, loud.run)
  expect(gainOf(loud.calls[1]!.args)).toBe(-3.5)
})

test("digital silence is written as it is: there is nothing to turn up", async () => {
  const ffmpeg = fakeFfmpeg(SILENT)
  await setLoudness("/f", "/in", "/out", -26, ffmpeg.run)
  expect(gainOf(ffmpeg.calls[1]!.args)).toBe(0)
})

test("a measure that fails writes nothing", async () => {
  const ffmpeg = fakeFfmpeg("nothing")
  await expect(setLoudness("/f", "/in", "/out", -26, ffmpeg.run)).rejects.toThrow("ffmpeg did not report the sound's loudness")
  expect(ffmpeg.calls).toHaveLength(1)
})

test("each ffmpeg call is given 30 s, and one that never ends is stopped then", async () => {
  const signals: (AbortSignal | undefined)[] = []
  const recorded = async (_command: string, args: string[], options?: { signal?: AbortSignal }) => {
    signals.push(options?.signal)
    return { stdout: "", stderr: args.includes("null") ? HOOK : "" }
  }
  await setLoudness("/f", "/in", "/out", -26, recorded)
  expect(signals).toHaveLength(2)
  for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal)
  // a run that never ends but for its signal, given 50 ms here rather than 30 s
  const never = (_command: string, _args: string[], options?: { signal?: AbortSignal }) =>
    new Promise<{ stdout: string; stderr: string }>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true }))
  const stopped = await measureLoudness("/f", "/in", never, 50).catch((error: unknown) => error)
  expect((stopped as Error).name).toBe("TimeoutError")
  const levelStopped = await setLoudness("/f", "/in", "/out", -26, never, 50).catch((error: unknown) => error)
  expect((levelStopped as Error).name).toBe("TimeoutError")
})
