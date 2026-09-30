import { beforeAll, describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { extractAudio, findExecutable, hasAudioStream, inspectTools, measureLoudness } from "@boxblack/core/media"
import { extractFrames, measureSignals } from "@boxblack/core/vision"
import { BUNDLED_FFMPEG } from "../../scripts/release-check.ts"

/**
 * The ffmpeg and ffprobe the app ships (Resources/bin) doing every job the app gives them. The
 * shipped build is cut down to what BOXBLACK uses, so the clips here are made with the machine's
 * own full ffmpeg — the shipped one cannot make them — and only read back with the shipped one.
 */
const BIN = join(import.meta.dirname, "../../resources/bin")
const shipped = { ffmpeg: join(BIN, "ffmpeg"), ffprobe: join(BIN, "ffprobe") }
const maker = findExecutable("ffmpeg", {
  pathEnv: (process.env.PATH ?? "").split(delimiter).filter((dir) => !dir.startsWith(BIN)).join(delimiter),
})
const probe = (file: string, entries: string) =>
  execFileSync(shipped.ffprobe, ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", file], { encoding: "utf8" }).trim()

describe.skipIf(!existsSync(shipped.ffmpeg))("the ffmpeg that ships with the app", () => {
  test("is the version the release check wants, with every filter and encoder the analysis uses", async () => {
    const report = await inspectTools({ ...shipped, whisper: null, claude: null })
    expect(report.ffmpeg).toMatchObject({ version: BUNDLED_FFMPEG, missing: [] })
  })

  test("needs nothing from Homebrew: it links only what macOS has", () => {
    const linked = execFileSync("otool", ["-L", shipped.ffmpeg], { encoding: "utf8" }).split("\n").slice(1).map((line) => line.trim()).filter(Boolean)
    for (const library of linked) expect(library).toMatch(/^\/(usr\/lib|System\/Library)\//)
  })

  test("is LGPL: nothing built in that would make the app's use of it GPL", () => {
    const config = execFileSync(shipped.ffmpeg, ["-hide_banner", "-buildconf"], { encoding: "utf8" })
    expect(config).not.toMatch(/enable-gpl|enable-nonfree/)
  })

  describe.skipIf(!maker)("reading clips made the way customers' are", () => {
    let dir: string
    let iphone: string
    let broll: string
    let photo: string

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "boxblack-shipped-"))
      iphone = join(dir, "IMG_0001.MOV")
      broll = join(dir, "broll.mp4")
      photo = join(dir, "photo.jpg")
      // an iPhone clip: portrait HEVC with AAC sound in a .mov
      execFileSync(maker!, [
        "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=3", "-f", "lavfi", "-i", "sine=f=440:d=3:sample_rate=48000",
        "-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", iphone,
      ])
      execFileSync(maker!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", broll])
      execFileSync(maker!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=3024x4032", "-frames:v", "1", "-update", "1", photo])
    }, 120_000)

    test("tells a clip with sound from one without", async () => {
      expect(await hasAudioStream(shipped.ffprobe, iphone)).toBe(true)
      expect(await hasAudioStream(shipped.ffprobe, broll)).toBe(false)
    })

    test("pulls the speech out as 16 kHz mono WAV and FLAC", async () => {
      for (const format of ["wav", "flac"] as const) {
        const output = join(dir, `speech.${format}`)
        await extractAudio({ ffmpeg: shipped.ffmpeg, input: iphone, output, format })
        expect(probe(output, "stream=codec_name,sample_rate,channels")).toBe(`${format === "wav" ? "pcm_s16le" : "flac"},16000,1`)
      }
    })

    test("takes small JPEG frames from an HEVC clip and from a photo", async () => {
      const [clipFrame] = await extractFrames({ ffmpeg: shipped.ffmpeg, input: iphone, timesUs: [1_500_000], outDir: dir })
      expect(probe(clipFrame!.path, "stream=width,height")).toBe("216,384")
      const [still] = await extractFrames({ ffmpeg: shipped.ffmpeg, input: photo, timesUs: [0], outDir: dir })
      expect(probe(still!.path, "stream=width,height")).toBe("288,384")
    })

    test.skipIf(!existsSync("/usr/bin/sips"))("takes the whole picture of an iPhone HEIC photo, stored as tiles", async () => {
      const heic = join(dir, "IMG_0002.HEIC")
      execFileSync("/usr/bin/sips", ["-s", "format", "heic", photo, "--out", heic])
      const [still] = await extractFrames({ ffmpeg: shipped.ffmpeg, input: heic, timesUs: [0], outDir: join(dir) })
      expect(probe(still!.path, "stream=width,height")).toBe("288,384")
    })

    test("runs every picture and sound filter the analysis asks for", async () => {
      const signals = await measureSignals({ ffmpeg: shipped.ffmpeg, input: iphone, durationUs: 3_000_000, hasAudio: true })
      // a steady test pattern with a steady tone: nothing black, nothing silent, and the run finished
      expect(signals.black).toEqual([])
      expect(signals.silent).toEqual([])
    })

    test("measures loudness from the clip's sound", async () => {
      const { stepUs, db } = await measureLoudness({ ffmpeg: shipped.ffmpeg, input: iphone })
      expect(stepUs).toBe(10_000)
      expect(db.length).toBeGreaterThan(250)
      expect(Math.max(...db)).toBeGreaterThan(-25)
    })

    test("writes a transparent ProRes 4444 .mov and a PNG poster, which the graphics need", async () => {
      // the shipped ffmpeg has no lavfi (devices are disabled), so even this tiny source picture
      // has to come from the machine's own ffmpeg; only the encode and the poster use the shipped one
      const source = join(dir, "graphic-source.png")
      const clip = join(dir, "graphic.mov")
      const poster = join(dir, "graphic-poster.png")
      execFileSync(maker!, [
        "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=64x64,format=rgba",
        "-frames:v", "1", "-update", "1", source,
      ])
      execFileSync(shipped.ffmpeg, [
        "-v", "error", "-y", "-loop", "1", "-t", "0.2", "-r", "30", "-i", source,
        "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", clip,
      ])
      // ffmpeg 8.1.2's prores decoder always reports profile 4444 back as 12-bit when probed,
      // whatever precision it was encoded at, so that -- not yuva444p10le -- is what a correct build shows
      expect(probe(clip, "stream=codec_name,pix_fmt")).toBe("prores,yuva444p12le")
      execFileSync(shipped.ffmpeg, ["-v", "error", "-y", "-i", clip, "-frames:v", "1", "-pix_fmt", "rgba", "-update", "1", poster])
      expect(probe(poster, "stream=codec_name")).toBe("png")
    })
  })
})
