import { mkdir, readFile, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { runProcess } from "@boxblack/core/media"

/** One picture of a file at a time, for the preview to draw. */
export interface FrameAsk {
  file: string
  /** the time in the file; ignored for a still picture */
  sourceUs: number
  photo: boolean
  /** see-through: a graphic over the video, pulled as PNG with its alpha */
  alpha: boolean
  /** at most this wide */
  width: number
}

export interface PreviewFramesDeps {
  ffmpeg: string
  /** where the pulled frames are kept for the session */
  dir: string
  run?: (command: string, args: string[], options: { signal?: AbortSignal }) => Promise<unknown>
}

const CONCURRENCY = 4
/** Frames are kept to the nearest thirtieth of a second: two asks within one frame share the picture. */
const FRAME_US = 1_000_000 / 30

/**
 * Pulls single frames out of the clip's files with ffmpeg, a few at a time, as data URLs the drawing page can load.
 * Each frame is kept on disk for the session, by file, time, size and kind, so a second look at the same moment pulls
 * nothing. A frame that cannot be pulled answers null: the preview draws a grey box there rather than failing.
 */
export function createPreviewFrames(deps: PreviewFramesDeps) {
  const run = deps.run ?? ((command, args, options) => runProcess(command, args, options))
  const kept = new Map<string, Promise<string | null>>()

  function keyOf(ask: FrameAsk) {
    const at = ask.photo ? 0 : Math.round(ask.sourceUs / FRAME_US)
    return `${ask.file}|${at}|${ask.width}|${ask.alpha ? "a" : "o"}`
  }

  async function pull(ask: FrameAsk, signal?: AbortSignal): Promise<string | null> {
    await mkdir(deps.dir, { recursive: true })
    const name = createHash("sha1").update(keyOf(ask)).digest("hex").slice(0, 20)
    const out = join(deps.dir, `${name}.${ask.alpha ? "png" : "jpg"}`)
    const seconds = Math.max(0, Math.round(ask.sourceUs / FRAME_US) * FRAME_US) / 1_000_000
    const args = [
      "-nostdin", "-v", "error", "-y",
      // a still picture has nothing to seek into
      ...(!ask.photo && seconds > 0 ? ["-ss", seconds.toFixed(3)] : []),
      "-i", ask.file,
      "-frames:v", "1",
      "-vf", `scale='min(${ask.width},iw)':-2`,
      ...(ask.alpha ? ["-pix_fmt", "rgba"] : ["-q:v", "4"]),
      "-threads", "1",
      out,
    ]
    try {
      await run(deps.ffmpeg, args, { signal })
      const bytes = await readFile(out)
      return `data:image/${ask.alpha ? "png" : "jpeg"};base64,${bytes.toString("base64")}`
    } catch {
      if (signal?.aborted) throw signal.reason ?? new Error("stopped")
      await rm(out, { force: true })
      return null
    }
  }

  return {
    /** The frames asked for, in order; the same frame asked twice is pulled once. */
    async frames(asks: FrameAsk[], signal?: AbortSignal): Promise<(string | null)[]> {
      const answers: Promise<string | null>[] = new Array(asks.length)
      const queue: (() => void)[] = []
      let active = 0
      const next = () => {
        while (active < CONCURRENCY && queue.length > 0) {
          active++
          queue.shift()!()
        }
      }
      asks.forEach((ask, i) => {
        const key = keyOf(ask)
        let found = kept.get(key)
        if (!found) {
          found = new Promise<string | null>((resolve, reject) => {
            queue.push(() =>
              pull(ask, signal)
                .then(resolve, reject)
                .finally(() => {
                  active--
                  next()
                }),
            )
          })
          // a failed or stopped pull is not kept, so the next look tries again
          found.then(
            (value) => value === null && kept.delete(key),
            () => kept.delete(key),
          )
          kept.set(key, found)
        }
        answers[i] = found
      })
      next()
      return Promise.all(answers)
    },
  }
}

export type PreviewFrames = ReturnType<typeof createPreviewFrames>
