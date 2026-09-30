import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findExecutable } from "../media/tools.ts"
import { measureSignals, parseSignals } from "./signals.ts"

// shaped like ffmpeg 8 stderr for the detector chain, prefixes included
const LOG = `
[Parsed_scdet_2 @ 0xb86c0f840] lavfi.scd.score: 43.059, lavfi.scd.time: 1.5
[blackdetect @ 0xb86c0f900] black_start:0 black_end:1.5 black_duration:1.5
[freezedetect @ 0xb86c0fa00] lavfi.freezedetect.freeze_start: 3.5
[silencedetect @ 0xb86c0fb00] silence_start: 3.499979
[freezedetect @ 0xb86c0fa00] lavfi.freezedetect.freeze_duration: 2
[freezedetect @ 0xb86c0fa00] lavfi.freezedetect.freeze_end: 5.5
[silencedetect @ 0xb86c0fb00] silence_end: 5.500021 | silence_duration: 2.000042
[Parsed_scdet_2 @ 0xb86c0f840] lavfi.scd.score: 26.168, lavfi.scd.time: 3.5
[Parsed_metadata_6 @ 0xb86c0f840] frame:0    pts:0       pts_time:7	[Parsed_metadata_6 @ 0xb86c0f840] lavfi.blur=5.1
[Parsed_metadata_6 @ 0xb86c0f840] frame:1    pts:1       pts_time:7.5
[Parsed_metadata_6 @ 0xb86c0f840] lavfi.blur=18.9
[Parsed_metadata_6 @ 0xb86c0f840] frame:2    pts:2       pts_time:8
[Parsed_metadata_6 @ 0xb86c0f840] lavfi.blur=19.5
[Parsed_metadata_6 @ 0xb86c0f840] frame:3    pts:3       pts_time:8.5
[Parsed_metadata_6 @ 0xb86c0f840] lavfi.blur=nan
[silencedetect @ 0xb86c0fb00] silence_start: 8.2
`

test("parseSignals reads scene cuts in order", () => {
  expect(parseSignals(LOG, 9_000_000).sceneCutsUs).toEqual([1_500_000, 3_500_000])
})

test("parseSignals reads black stretches", () => {
  expect(parseSignals(LOG, 9_000_000).black).toEqual([{ startUs: 0, endUs: 1_500_000 }])
})

test("parseSignals reads frozen picture stretches", () => {
  expect(parseSignals(LOG, 9_000_000).frozen).toEqual([{ startUs: 3_500_000, endUs: 5_500_000 }])
})

test("parseSignals closes a silence that runs to the end of the file", () => {
  expect(parseSignals(LOG, 9_000_000).silent).toEqual([
    { startUs: 3_499_979, endUs: 5_500_021 },
    { startUs: 8_200_000, endUs: 9_000_000 },
  ])
})

test("parseSignals groups blur samples above the threshold into stretches", () => {
  // samples every 0.5 s; a stretch lasts until the next sharp (or unmeasurable) sample
  expect(parseSignals(LOG, 9_000_000).blurry).toEqual([{ startUs: 7_500_000, endUs: 8_500_000 }])
})

test("parseSignals finds nothing in a clean log", () => {
  expect(parseSignals("", 5_000_000)).toEqual({ sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] })
})

const ffmpeg = findExecutable("ffmpeg")

describe.skipIf(!ffmpeg)("with ffmpeg installed", () => {
  test("measureSignals finds cuts, black, freezes, silence and blur in a generated clip", { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-signals-"))
    const clip = join(dir, "signals.mp4")
    const v = (source: string) => ["-f", "lavfi", "-i", `${source}:s=320x240:r=30`]
    execFileSync(ffmpeg!, [
      "-v", "error", "-y",
      ...v("color=black:d=1.5"), ...v("testsrc=d=2"), ...v("color=red:d=2"), ...v("testsrc2=d=2"), ...v("testsrc2=d=1.5"),
      "-f", "lavfi", "-i", "sine=f=440:d=3.5:sample_rate=48000",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=2",
      "-f", "lavfi", "-i", "sine=f=660:d=3.5:sample_rate=48000",
      "-filter_complex", "[4:v]gblur=sigma=12[bl];[0:v][1:v][2:v][3:v][bl]concat=n=5:v=1:a=0[v];[5:a][6:a][7:a]concat=n=3:v=0:a=1[a]",
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip,
    ])

    const progress: number[] = []
    const signals = await measureSignals({ ffmpeg: ffmpeg!, input: clip, durationUs: 9_000_000, hasAudio: true, onProgress: (f) => progress.push(f) })

    const near = (us: number, expected: number) => Math.abs(us - expected) <= 250_000
    expect(signals.sceneCutsUs.some((us) => near(us, 3_500_000))).toBe(true)
    expect(signals.sceneCutsUs.some((us) => near(us, 5_500_000))).toBe(true)
    expect(signals.black.some((r) => near(r.startUs, 0) && near(r.endUs, 1_500_000))).toBe(true)
    expect(signals.frozen.some((r) => near(r.startUs, 3_500_000) && near(r.endUs, 5_500_000))).toBe(true)
    expect(signals.silent.some((r) => near(r.startUs, 3_500_000) && near(r.endUs, 5_500_000))).toBe(true)
    expect(signals.blurry.some((r) => near(r.startUs, 7_500_000) && near(r.endUs, 9_000_000))).toBe(true)
    expect(progress.at(-1)).toBe(1)
  })
})
