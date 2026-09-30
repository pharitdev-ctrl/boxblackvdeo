import { rm } from "node:fs/promises"
import { join } from "node:path"
import { ProcessError, runProcess } from "../media/process.ts"

export { sampleTimes } from "./sampling.ts"

export interface FrameImage {
  atUs: number
  path: string
}

/** Longest side of the frames sent to the model: ~110 image tokens each for 9:16 footage. */
const FRAME_SIZE = 384
const CONCURRENCY = 4

/**
 * ffmpeg joins the tiles of a gridded HEIF image (how an iPhone stores a photo) with a filter graph
 * of its own, and refuses to add a second, simple one after it — which is what scaling is.
 */
const TILED = "Simple and complex filtering cannot be used together"

/** One frame, `size` px on its longest side, or at full size when `size` is null. */
function frameArgs(input: string, atUs: number, output: string, size: number | null): string[] {
  return [
    "-nostdin", "-v", "error", "-y",
    // a still picture has nothing to seek into: asking for 0 s would land past its one frame
    ...(atUs > 0 ? ["-ss", String(atUs / 1_000_000)] : []),
    "-i", input,
    "-frames:v", "1",
    ...(size === null ? ["-q:v", "2"] : ["-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease`, "-q:v", "5"]),
    // one small JPEG needs no encoder thread pool, and a machine that will not give it the
    // threads fails the frame outright with "ff_frame_thread_encoder_init failed"
    "-threads", "1",
    output,
  ]
}

/** One accurate seek per frame, a few at a time. */
export async function extractFrames(args: {
  ffmpeg: string
  input: string
  timesUs: number[]
  outDir: string
  signal?: AbortSignal
}): Promise<FrameImage[]> {
  const frames: FrameImage[] = args.timesUs.map((atUs) => ({ atUs, path: join(args.outDir, `frame-${atUs}.jpg`) }))
  const run = (list: string[]) => runProcess(args.ffmpeg, list, { signal: args.signal })
  let next = 0
  const worker = async () => {
    while (next < frames.length) {
      const frame = frames[next++]!
      try {
        await run(frameArgs(args.input, frame.atUs, frame.path, FRAME_SIZE))
      } catch (error) {
        if (!(error instanceof ProcessError && error.stderr.includes(TILED))) throw error
        // a tiled photo: let ffmpeg join the tiles into the whole picture first, then scale that
        const whole = `${frame.path}.whole.jpg`
        try {
          await run(frameArgs(args.input, frame.atUs, whole, null))
          await run(frameArgs(whole, 0, frame.path, FRAME_SIZE))
        } finally {
          await rm(whole, { force: true })
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, frames.length) }, worker))
  return frames
}
