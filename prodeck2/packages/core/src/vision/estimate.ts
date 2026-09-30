import { sampleTimes } from "./sampling.ts"

/** How often Claude looks at the pictures, in seconds between frames: the rates the user may choose. */
export const FRAME_EVERY_S = [1, 2, 3, 5, 10] as const
export type FrameEveryS = (typeof FRAME_EVERY_S)[number]
export const DEFAULT_FRAME_EVERY_S: FrameEveryS = 3
/**
 * How many frames a video may send, as seconds of footage at the chosen rate: six minutes' worth
 * (120 frames at the default 3 s), so a longer video is sampled more sparsely whatever the rate,
 * and a faster rate costs more on a long video too rather than being capped back to the old count.
 * Every rate offered divides it, so the count is whole; the rounding is only defence.
 */
const COVERAGE_S = 360
const BATCH_SIZE = 30

export interface VisionSampling {
  intervalUs: number
  maxFrames: number
  /** frames per request */
  batchSize: number
}

/** The sampling at a rate: a frame every so many seconds, at most COVERAGE_S of them per video, 30 per request. */
export function visionSampling(frameEveryS: FrameEveryS): VisionSampling {
  return { intervalUs: frameEveryS * 1_000_000, maxFrames: Math.round(COVERAGE_S / frameEveryS), batchSize: BATCH_SIZE }
}

/**
 * The sampling at the default rate: a frame every 3 s, at most 120 per video, 30 per request —
 * about 110 image tokens a frame, so an hour of footage sends roughly 13,000 tokens of pictures.
 */
export const VISION_SAMPLING: VisionSampling = visionSampling(DEFAULT_FRAME_EVERY_S)

/**
 * Tokens per frame (picture and its time label) and per request (instructions, transcript
 * context and the reply). Calibrated on a 31 s clip, 2026-09-17: 11 frames in one request
 * took 3,362 input and 1,310 output tokens.
 */
const TOKENS_PER_FRAME = 130
const TOKENS_PER_REQUEST = 2_800

/**
 * What grows with the length of the video rather than its frames: the words sent with each
 * request, the scenes written back and the thinking between. Calibrated 2026-09-23: a 22.9 min
 * video's descriptions took 45,700 tokens more than its frames and requests (33 a second); 30 s
 * clips took 14–36 a second more.
 */
const TOKENS_PER_SECOND = 30

/**
 * A comparison of two takes besides its pictures: the instructions, both takes' timed words and
 * the reply. Calibrated 2026-09-23 on three 30 s clips: one comparison of 11 pictures took
 * 3,400–4,300 tokens.
 */
const TOKENS_PER_REVIEW = 2_500

/**
 * Before its speech is read, how many lines a video will have said twice: measured 2026-09-23 on
 * this app's footage, 21 in 25 minutes (one every ~70 s), compared on 7.4 pictures each.
 */
const RETAKE_EVERY_US = 70_000_000
const FRAMES_PER_RETAKE = 7

/** What comparing a video's lines said twice takes: how many comparisons, and how many pictures they show. */
export interface RetakeLoad {
  reviews: number
  frames: number
}

/**
 * What looking at the videos will take at a sampling (the default rate's unless given): the frames
 * described and, for each line said twice, a comparison of both takes. A video whose speech is read
 * already has its comparisons counted; for one not read yet they are expected at the rate measured
 * on real footage.
 */
export function estimateVision(videos: { durationUs: number; retakes: RetakeLoad | null }[], sampling: VisionSampling = VISION_SAMPLING): { frames: number; requests: number; reviews: number; tokens: number } {
  let frames = 0
  let requests = 0
  let reviews = 0
  let lengthTokens = 0
  for (const video of videos) {
    const count = sampleTimes({ durationUs: video.durationUs, sceneCutsUs: [], intervalUs: sampling.intervalUs, maxFrames: sampling.maxFrames }).length
    const expected = Math.round(video.durationUs / RETAKE_EVERY_US)
    const retakes = video.retakes ?? { reviews: expected, frames: expected * FRAMES_PER_RETAKE }
    frames += count + retakes.frames
    requests += Math.ceil(count / sampling.batchSize)
    reviews += retakes.reviews
    lengthTokens += Math.round((video.durationUs / 1_000_000) * TOKENS_PER_SECOND)
  }
  return { frames, requests, reviews, tokens: frames * TOKENS_PER_FRAME + requests * TOKENS_PER_REQUEST + reviews * TOKENS_PER_REVIEW + lengthTokens }
}
