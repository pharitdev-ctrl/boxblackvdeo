import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LOUDNESS_STEP_US, LoudnessMeter, measureLoudness } from "./loudness.ts"
import { findExecutable } from "./tools.ts"

/** 16 kHz mono s16le samples. */
function pcm(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, i) => buffer.writeInt16LE(sample, i * 2))
  return buffer
}

const SAMPLES_PER_STEP = 160

test("the meter gives one level per 10 ms, in whole dB of full scale", () => {
  const meter = new LoudnessMeter()
  meter.push(pcm([...Array(SAMPLES_PER_STEP).fill(32767), ...Array(SAMPLES_PER_STEP).fill(3277)]))
  expect(meter.finish()).toEqual({ stepUs: LOUDNESS_STEP_US, db: [0, -20] })
})

test("silence reads as the floor, not minus infinity", () => {
  const meter = new LoudnessMeter()
  meter.push(pcm(Array(SAMPLES_PER_STEP).fill(0)))
  expect(meter.finish().db).toEqual([-100])
})

test("samples split across chunks, even mid-sample, are counted once in order", () => {
  const whole = pcm([...Array(SAMPLES_PER_STEP).fill(32767), ...Array(SAMPLES_PER_STEP).fill(0)])
  const meter = new LoudnessMeter()
  meter.push(whole.subarray(0, 101))
  meter.push(whole.subarray(101, 333))
  meter.push(whole.subarray(333))
  expect(meter.finish().db).toEqual([0, -100])
})

test("a last partial step is still measured", () => {
  const meter = new LoudnessMeter()
  meter.push(pcm([...Array(SAMPLES_PER_STEP).fill(0), ...Array(40).fill(32767)]))
  expect(meter.finish().db).toEqual([-100, 0])
})

const ffmpeg = findExecutable("ffmpeg")

describe.skipIf(!ffmpeg)("with ffmpeg installed", () => {
  test("measureLoudness hears where a clip is loud and where it is silent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-loudness-"))
    const clip = join(dir, "beep.m4a")
    // 0.5 s tone, 0.5 s silence
    execFileSync(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5:sample_rate=48000", "-af", "apad=pad_dur=0.5", clip])
    const { stepUs, db } = await measureLoudness({ ffmpeg: ffmpeg!, input: clip })
    expect(stepUs).toBe(10_000)
    expect(db.length).toBeGreaterThanOrEqual(99)
    expect(Math.max(...db.slice(10, 40))).toBeGreaterThan(-25)
    expect(Math.max(...db.slice(60, 90))).toBeLessThan(-70)
  })
})
