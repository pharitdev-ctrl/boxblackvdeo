import { runProcess } from "../media/process.ts"

export interface TimeRangeUs {
  startUs: number
  endUs: number
}

/** Measurable picture and sound problems, found locally with ffmpeg before any model looks at the video. */
export interface VideoSignals {
  sceneCutsUs: number[]
  black: TimeRangeUs[]
  frozen: TimeRangeUs[]
  silent: TimeRangeUs[]
  blurry: TimeRangeUs[]
}

/**
 * blurdetect on 320 px frames: sharp phone footage measured 5.7–7.4 and a heavy gaussian
 * blur about 19 (2026-09-17). No real out-of-focus footage has been measured yet, so this
 * sits well clear of sharp material.
 */
const BLUR_THRESHOLD = 12

const us = (seconds: string) => Math.round(Number(seconds) * 1_000_000)

function pairs(log: string, startPattern: RegExp, endPattern: RegExp, durationUs: number): TimeRangeUs[] {
  const events = [
    ...[...log.matchAll(startPattern)].map((m) => ({ at: m.index, kind: "start" as const, us: us(m[1]!) })),
    ...[...log.matchAll(endPattern)].map((m) => ({ at: m.index, kind: "end" as const, us: us(m[1]!) })),
  ].sort((a, b) => a.at - b.at)

  const ranges: TimeRangeUs[] = []
  let open: number | null = null
  for (const event of events) {
    if (event.kind === "start") open = event.us
    else if (open !== null) {
      ranges.push({ startUs: open, endUs: event.us })
      open = null
    }
  }
  if (open !== null) ranges.push({ startUs: open, endUs: durationUs })
  return ranges
}

function blurryStretches(log: string, durationUs: number): TimeRangeUs[] {
  const samples = [...log.matchAll(/pts_time:([\d.]+)[\s\S]*?lavfi\.blur=(\S+)/g)]
    .map((m) => ({ us: us(m[1]!), blur: Number(m[2]) }))
    .sort((a, b) => a.us - b.us)

  const ranges: TimeRangeUs[] = []
  let start: number | null = null
  for (const sample of samples) {
    // NaN (a flat picture with no edges) counts as not blurry
    const blurry = sample.blur >= BLUR_THRESHOLD
    if (blurry && start === null) start = sample.us
    if (!blurry && start !== null) {
      ranges.push({ startUs: start, endUs: sample.us })
      start = null
    }
  }
  if (start !== null) ranges.push({ startUs: start, endUs: durationUs })
  return ranges
}

export function parseSignals(log: string, durationUs: number): VideoSignals {
  const sceneCutsUs = [...new Set([...log.matchAll(/lavfi\.scd\.time: ([\d.]+)/g)].map((m) => us(m[1]!)))].sort((a, b) => a - b)
  const black = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ startUs: us(m[1]!), endUs: us(m[2]!) }))
  return {
    sceneCutsUs,
    black,
    frozen: pairs(log, /freeze_start: ([\d.]+)/g, /freeze_end: ([\d.]+)/g, durationUs),
    silent: pairs(log, /silence_start: ([\d.]+)/g, /silence_end: ([\d.]+)/g, durationUs),
    blurry: blurryStretches(log, durationUs),
  }
}

/**
 * One decoding pass over the file. Pictures are sampled at 5 fps and shrunk to 320 px
 * wide, which keeps an hour of 1080p footage to a few minutes on a laptop.
 */
export async function measureSignals(args: {
  ffmpeg: string
  input: string
  durationUs: number
  hasAudio: boolean
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}): Promise<VideoSignals> {
  let log = ""
  await runProcess(
    args.ffmpeg,
    [
      "-nostdin", "-hide_banner", "-i", args.input,
      "-map", "0:v:0",
      "-vf", [
        "fps=5", "scale=320:-2",
        "scdet=threshold=10",
        "blackdetect=d=0.5:pix_th=0.10",
        "freezedetect=n=0.003:d=1.5",
        "blurdetect=block_width=32:block_height=32", "metadata=print:key=lavfi.blur",
      ].join(","),
      ...(args.hasAudio ? ["-map", "0:a:0", "-af", "silencedetect=noise=-35dB:d=0.7"] : []),
      "-f", "null", "-",
    ],
    {
      signal: args.signal,
      onStderr: (chunk) => {
        log += chunk
        for (const match of chunk.matchAll(/time=(\d+):(\d+):([\d.]+)/g)) {
          const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
          args.onProgress?.(Math.min(1, (seconds * 1_000_000) / args.durationUs))
        }
      },
    },
  )
  args.onProgress?.(1)
  return parseSignals(log, args.durationUs)
}
