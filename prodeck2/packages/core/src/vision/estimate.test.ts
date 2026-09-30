import { expect, test } from "vitest"
import { DEFAULT_FRAME_EVERY_S, estimateVision, FRAME_EVERY_S, VISION_SAMPLING, visionSampling } from "./estimate.ts"

const video = (durationUs: number, retakes: { reviews: number; frames: number } | null = null) => ({ durationUs, retakes })

test("samples a frame every 3 s, at most 120 per video, 30 per request", () => {
  expect(VISION_SAMPLING).toEqual({ intervalUs: 3_000_000, maxFrames: 120, batchSize: 30 })
})

test("estimates frames and tokens close to a measured run", () => {
  // measured 2026-09-17: a 31 s clip, 11 frames, one request — 3,362 input and 1,310 output tokens
  const estimate = estimateVision([video(31_106_000, { reviews: 0, frames: 0 })])
  expect(estimate.frames).toBe(11)
  expect(estimate.requests).toBe(1)
  expect(estimate.reviews).toBe(0)
  expect(estimate.tokens).toBeGreaterThan(4_000)
  expect(estimate.tokens).toBeLessThan(6_000)
})

test("a line said twice adds its comparison: the pictures of both takes and a request of its own", () => {
  // measured 2026-09-23 on three 30 s clips of 10–11 frames: one comparison of 11 pictures took 3,400–4,300 tokens more than none
  const none = estimateVision([video(31_106_000, { reviews: 0, frames: 0 })])
  const one = estimateVision([video(31_106_000, { reviews: 1, frames: 11 })])
  expect(one.frames).toBe(none.frames + 11)
  expect(one.reviews).toBe(1)
  expect(one.tokens - none.tokens).toBeGreaterThan(3_400)
  expect(one.tokens - none.tokens).toBeLessThan(4_300)
})

test("a long video's estimate comes close to what it really took", () => {
  // measured 2026-09-23: a 22.9 min video, 120 frames in four requests and 19 lines said twice on 134 pictures, took 134,021 tokens
  const long = estimateVision([video(1_374_000_000, { reviews: 19, frames: 134 })])
  expect(long.tokens).toBeGreaterThan(134_021 * 0.9)
  expect(long.tokens).toBeLessThan(134_021 * 1.1)
})

test("a video whose speech is not read yet is expected to have a line said twice about every 70 s", () => {
  // measured 2026-09-23: a 22.9 min video had 19 lines said twice, compared on 134 pictures, and took 134,021 tokens in all
  const long = estimateVision([video(1_374_000_000)])
  expect(long.reviews).toBe(20)
  expect(long.frames).toBe(120 + 20 * 7)
  expect(long.tokens).toBeGreaterThan(90_000)
  // a short clip is not expected to have one
  expect(estimateVision([video(31_106_000)]).reviews).toBe(0)
})

test("adds up several videos and caps long ones", () => {
  const estimate = estimateVision([video(31_106_000, { reviews: 0, frames: 0 }), video(3_600_000_000, { reviews: 2, frames: 16 })])
  expect(estimate.frames).toBe(11 + 120 + 16)
  expect(estimate.requests).toBe(1 + 4)
  expect(estimate.reviews).toBe(2)
})

test("nothing chosen costs nothing", () => {
  expect(estimateVision([])).toEqual({ frames: 0, requests: 0, reviews: 0, tokens: 0 })
})

test("the user picks how often Claude looks: a frame every 1, 2, 3, 5 or 10 s, with the cap per video keeping six minutes of frames at that rate", () => {
  expect(FRAME_EVERY_S).toEqual([1, 2, 3, 5, 10])
  expect(DEFAULT_FRAME_EVERY_S).toBe(3)
  expect(visionSampling(3)).toEqual(VISION_SAMPLING)
  expect(visionSampling(1)).toEqual({ intervalUs: 1_000_000, maxFrames: 360, batchSize: 30 })
  expect(visionSampling(2)).toEqual({ intervalUs: 2_000_000, maxFrames: 180, batchSize: 30 })
  expect(visionSampling(5)).toEqual({ intervalUs: 5_000_000, maxFrames: 72, batchSize: 30 })
  expect(visionSampling(10)).toEqual({ intervalUs: 10_000_000, maxFrames: 36, batchSize: 30 })
})

test("the estimate follows the sampling: a frame every second is about three times the frames of every 3 s, and a long video is still capped at that rate", () => {
  const clip = video(31_106_000, { reviews: 0, frames: 0 })
  expect(estimateVision([clip]).frames).toBe(11)
  expect(estimateVision([clip], visionSampling(1)).frames).toBe(31)
  expect(estimateVision([clip], visionSampling(1)).requests).toBe(2)
  // a 22.9 min video: 1,374 frames a second apart would be sent, so the cap of 360 spreads them 3.8 s apart instead
  const long = video(1_374_000_000, { reviews: 0, frames: 0 })
  expect(estimateVision([long]).frames).toBe(120)
  expect(estimateVision([long], visionSampling(1)).frames).toBe(360)
  expect(estimateVision([long], visionSampling(10)).frames).toBe(36)
})
