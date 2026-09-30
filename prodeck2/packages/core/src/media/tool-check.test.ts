import { describe, expect, test } from "vitest"
import { findExecutable } from "./tools.ts"
import { inspectTools, missingFfmpegParts, parseToolVersion, whisperSupportsDtw } from "./tool-check.ts"

const FILTERS = ` Filters:
  T.. = Timeline support
  ------
 .. silencedetect     A->A       Detect silence.
 .S blackdetect       V->V       Detect video intervals that are (almost) black.
 .. fps               V->V       Force constant framerate.
 T. metadata          V->V       Manipulate video frame metadata.
 .. scale             V->V       Scale the input video size and/or convert the image format.
`
// FILTERS above is missing scdet, freezedetect and blurdetect on purpose (see the test that reads it);
// this is the same listing with those three added back, for tests that want a fully complete build.
const COMPLETE_FILTERS = FILTERS.replace(
  "  ------\n",
  "  ------\n .. scdet             V->V       Detect video scene change.\n .S freezedetect      V->V       Detect frozen video.\n .. blurdetect        V->V       Blur detection filter.\n",
)
const ENCODERS = ` Encoders:
 ------
 V....D mjpeg                MJPEG (Motion JPEG)
 V....D wrapped_avframe      AVFrame to AVPacket passthrough
 V....D prores_ks            Apple ProRes (iCodec Kostya)
 V....D png                  PNG (Portable Network Graphics) image
 A....D flac                 FLAC (Free Lossless Audio Codec)
 A....D pcm_s16le            PCM signed 16-bit little-endian
`
const MUXERS = `Formats:
 D.. = Demuxing supported
 .E. = Muxing supported
 ---
  E  flac            raw FLAC
  E  image2          image2 sequence
 DE  mov             QuickTime / MOV
  E  null            raw null video
  E  s16le           PCM signed 16-bit little-endian
 DE  wav             WAV / WAVE (Waveform Audio)
`

test("names the filters and encoders an ffmpeg build lacks for analysis", () => {
  expect(missingFfmpegParts(FILTERS, ENCODERS, MUXERS)).toEqual(["scdet", "freezedetect", "blurdetect"])
  expect(missingFfmpegParts(FILTERS, " Encoders:\n ------\n A....D flac  FLAC\n", MUXERS)).toEqual([
    "scdet", "freezedetect", "blurdetect", "mjpeg", "pcm_s16le", "wrapped_avframe", "prores_ks", "png",
  ])
})

test("names prores_ks, png and mov -- what M23's graphics need -- when an otherwise-complete build lacks them", () => {
  const noGraphicsEncoders = ENCODERS.replace(/.*prores_ks.*\n/, "").replace(/.*png.*\n/, "")
  const noGraphicsMuxers = MUXERS.replace(/.*mov.*\n/, "")
  expect(missingFfmpegParts(COMPLETE_FILTERS, noGraphicsEncoders, noGraphicsMuxers)).toEqual(["prores_ks", "png", "mov"])
})

test("a build that cannot write what the analysis writes is caught too, not only one missing a filter", () => {
  // the null sink needs wrapped_avframe, and loudness reads raw s16le from a pipe: a cut-down build
  // that has every filter but not these fails on the first clip
  const noSink = ENCODERS.replace(/.*wrapped_avframe.*\n/, "")
  const noRaw = MUXERS.replace(/.*s16le.*\n/, "")
  expect(missingFfmpegParts(FILTERS, noSink, noRaw).slice(-2)).toEqual(["wrapped_avframe", "s16le"])
})

test("reads tool versions from their first line", () => {
  expect(parseToolVersion("ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers")).toBe("8.1.2")
  expect(parseToolVersion("ffmpeg version n7.0-static https://johnvansickle.com")).toBe("n7.0-static")
  expect(parseToolVersion("2.1.233 (Claude Code)")).toBe("2.1.233")
  expect(parseToolVersion("")).toBeNull()
})

test("knows whether whisper-cli can compute DTW word timings", () => {
  expect(whisperSupportsDtw("  -dtw MODEL --dtw MODEL            [       ] compute token-level timestamps")).toBe(true)
  expect(whisperSupportsDtw("  -ojf,      --output-json-full     [false  ] include more information")).toBe(false)
})

test("a tool that is not installed, or that fails to run, is reported as such", async () => {
  const report = await inspectTools({ ffmpeg: null, ffprobe: null, whisper: "/nope/whisper-cli", claude: null }, async () => {
    throw new Error("ENOENT")
  })
  expect(report).toEqual({ ffmpeg: null, ffprobe: null, whisper: { path: "/nope/whisper-cli", usable: false }, claude: null })
})

const ffmpeg = findExecutable("ffmpeg")
const ffprobe = findExecutable("ffprobe")

describe.skipIf(!ffmpeg || !ffprobe)("with ffmpeg installed", () => {
  test("inspects the real ffmpeg: its version and that nothing needed is missing", async () => {
    const report = await inspectTools({ ffmpeg, ffprobe, whisper: null, claude: null })
    expect(report.ffmpeg).toMatchObject({ path: ffmpeg, missing: [] })
    expect(report.ffmpeg?.version).toMatch(/\d/)
    expect(report.ffprobe).toEqual({ path: ffprobe })
  })
})
