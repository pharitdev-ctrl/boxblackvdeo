import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import type { BinMedia } from "@boxblack/core/flair/media"

export interface FrameFilesDeps {
  /** where the frames go; made when missing, as macOS clears temp folders that go unused */
  workDir: string
  /** ffmpeg: the frames of `input` at those times, written into `outDir` */
  extract: (input: string, timesUs: number[], outDir: string) => Promise<{ path: string }[]>
}

/** A photo has one frame; a clip is looked at near its start, middle and end, so nothing that only shows up late is missed. */
export function lookTimes(picture: Pick<BinMedia, "kind" | "durationUs">): number[] {
  return picture.kind === "video" ? [0.15, 0.5, 0.85].map((share) => Math.floor(picture.durationUs * share)) : [0]
}

/**
 * Frames pulled out of pictures, each request in a folder of its own: frames are named by their
 * time, so two pictures looked at at the same moment would otherwise write over each other.
 */
export function createFrameFiles(deps: FrameFilesDeps) {
  const scratch = async (prefix: string) => {
    await mkdir(deps.workDir, { recursive: true })
    return mkdtemp(join(deps.workDir, prefix))
  }
  return {
    /** One frame, read and its file taken away. */
    async one(input: string, atUs: number): Promise<Buffer> {
      const dir = await scratch("thumb-")
      try {
        const [frame] = await deps.extract(input, [atUs], dir)
        return await readFile(frame!.path)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },

    /** Frames that stay on disk until whoever is looking at them is done. */
    session() {
      let dir: Promise<string> | null = null
      let count = 0
      return {
        async of(input: string, timesUs: number[]): Promise<string[]> {
          const outDir = join(await (dir ??= scratch("look-")), String(count++))
          await mkdir(outDir)
          return (await deps.extract(input, timesUs, outDir)).map((frame) => frame.path)
        },
        async dispose(): Promise<void> {
          if (dir) await rm(await dir, { recursive: true, force: true })
        },
      }
    },
  }
}

export type FrameFiles = ReturnType<typeof createFrameFiles>
