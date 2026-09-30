import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findExecutable } from "../media/tools.ts"
import { extractFrames, sampleTimes } from "./frames.ts"

test("samples a single shot every interval, starting half a second in", () => {
  expect(sampleTimes({ durationUs: 10_000_000, sceneCutsUs: [], intervalUs: 3_000_000, maxFrames: 100 })).toEqual([
    500_000, 3_500_000, 6_500_000, 9_500_000,
  ])
})

test("every shot gets a frame near its start", () => {
  expect(sampleTimes({ durationUs: 10_000_000, sceneCutsUs: [4_000_000], intervalUs: 3_000_000, maxFrames: 100 })).toEqual([
    500_000, 3_500_000, 4_500_000, 7_500_000,
  ])
})

test("a very short shot is sampled in its middle", () => {
  expect(
    sampleTimes({ durationUs: 5_000_000, sceneCutsUs: [2_000_000, 2_600_000], intervalUs: 3_000_000, maxFrames: 100 }),
  ).toContain(2_300_000)
})

test("long footage stays under the frame cap and still covers the whole file", () => {
  const times = sampleTimes({ durationUs: 3_600_000_000, sceneCutsUs: [], intervalUs: 3_000_000, maxFrames: 120 })
  expect(times.length).toBeLessThanOrEqual(120)
  expect(times.length).toBeGreaterThan(100)
  expect(times[0]!).toBeLessThan(60_000_000)
  expect(times.at(-1)!).toBeGreaterThan(3_500_000_000)
})

test("more shots than the cap allows are thinned evenly", () => {
  const cuts = Array.from({ length: 300 }, (_, i) => (i + 1) * 1_000_000)
  const times = sampleTimes({ durationUs: 301_000_000, sceneCutsUs: cuts, intervalUs: 3_000_000, maxFrames: 50 })
  expect(times.length).toBeLessThanOrEqual(50)
  expect(times.at(-1)!).toBeGreaterThan(290_000_000)
  expect([...times].sort((a, b) => a - b)).toEqual(times)
})

const ffmpeg = findExecutable("ffmpeg")
const ffprobe = findExecutable("ffprobe")

describe.skipIf(!ffmpeg || !ffprobe)("with ffmpeg installed", () => {
  test("extractFrames saves a small JPEG for each time, longest side 384 px", { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-frames-"))
    const clip = join(dir, "portrait.mp4")
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=3", "-pix_fmt", "yuv420p", clip])

    const frames = await extractFrames({ ffmpeg: ffmpeg!, input: clip, timesUs: [500_000, 2_000_000], outDir: dir })

    expect(frames.map((f) => f.atUs)).toEqual([500_000, 2_000_000])
    for (const frame of frames) {
      expect(existsSync(frame.path)).toBe(true)
      const size = execFileSync(ffprobe!, ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", frame.path]).toString().trim()
      expect(size).toBe("216,384")
    }
  })

  test("a still picture gives its one frame, with nothing to seek into", { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-photo-"))
    const photo = join(dir, "photo.jpg")
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=3024x4032", "-frames:v", "1", "-update", "1", photo])

    const [frame] = await extractFrames({ ffmpeg: ffmpeg!, input: photo, timesUs: [0], outDir: dir })
    expect(existsSync(frame!.path)).toBe(true)
    const size = execFileSync(ffprobe!, ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", frame!.path]).toString().trim()
    expect(size).toBe("288,384")
  })

  test.skipIf(!existsSync("/usr/bin/sips"))("an iPhone HEIC photo, stored as a grid of tiles, gives its whole picture", { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-heic-"))
    const jpeg = join(dir, "source.jpg")
    const heic = join(dir, "IMG_0001.HEIC")
    execFileSync(ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=3024x4032", "-frames:v", "1", "-update", "1", jpeg])
    // macOS writes a photo this size the way an iPhone does: 512 px tiles joined by a grid
    execFileSync("/usr/bin/sips", ["-s", "format", "heic", jpeg, "--out", heic])

    const [frame] = await extractFrames({ ffmpeg: ffmpeg!, input: heic, timesUs: [0], outDir: dir })
    const size = execFileSync(ffprobe!, ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", frame!.path]).toString().trim()
    // the whole 3:4 picture scaled down, not one 512 px tile
    expect(size).toBe("288,384")
    // the full-size picture it was scaled from is not left behind
    expect(readdirSync(dir).sort()).toEqual(["IMG_0001.HEIC", "frame-0.jpg", "source.jpg"])
  })
})

test("the encoder is asked for one thread, so a frame never fails for want of a thread pool", async () => {
  // ffmpeg's mjpeg encoder starts a frame-thread pool by default; when the machine will not give it
  // the threads, `ff_frame_thread_encoder_init failed` kills the frame. One 384 px JPEG needs none.
  const dir = await mkdtemp(join(tmpdir(), "boxblack-args-"))
  const log = join(dir, "args.txt")
  const fake = join(dir, "fake-ffmpeg.sh")
  await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`)
  await chmod(fake, 0o755)

  await extractFrames({ ffmpeg: fake, input: "/clips/talk.mov", timesUs: [500_000], outDir: dir })

  const args = (await readFile(log, "utf8")).trim()
  expect(args).toContain("-threads 1")
  // after -i, so it is the encoder that is held to one thread; seeking the file keeps every core
  expect(args.indexOf("-threads 1")).toBeGreaterThan(args.indexOf("-i "))
})

test("only a tiled photo gets the second try: any other failure is ffmpeg's own error, at once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-fail-"))
  const log = join(dir, "calls.txt")
  const fake = join(dir, "fake-ffmpeg.sh")
  await writeFile(fake, `#!/bin/sh\necho call >> ${JSON.stringify(log)}\necho "photo.jpg: Invalid data found when processing input" >&2\nexit 1\n`)
  await chmod(fake, 0o755)

  await expect(extractFrames({ ffmpeg: fake, input: "/clips/broken.jpg", timesUs: [0], outDir: dir })).rejects.toThrow("Invalid data found")
  expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1)
})
