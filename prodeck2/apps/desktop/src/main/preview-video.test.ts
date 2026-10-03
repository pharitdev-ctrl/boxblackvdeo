import { expect, test } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PreviewDraft } from "@boxblack/core/preview"
import type { AgentTimeline } from "@boxblack/core/timeline"
import { createPreviewVideo, VIDEO_FPS } from "./preview-video.ts"

const s = (seconds: number) => Math.round(seconds * 1_000_000)
const look = { scale: 1, x: 0, y: 0, rot: 0, alpha: 1 }

/** A 1 s draft: one main video segment from 10 s in its file, a graphic over its second half, and its sound. */
const draft: PreviewDraft = {
  canvas: { width: 1080, height: 1920 },
  durationUs: s(1),
  placed: [
    { order: -1, startUs: 0, durationUs: s(1), sourceStartUs: s(10), speed: 1, clip: look, keyframes: [], layer: (sourceUs, l) => ({ kind: "video", segmentId: "main", speed: 1, file: "/v.mov", photo: false, sourceUs, native: { width: 1080, height: 1920 }, look: l, overlay: false }) },
    { order: 1000, startUs: s(0.5), durationUs: s(0.5), sourceStartUs: 0, speed: 1, clip: look, keyframes: [], layer: (sourceUs, l) => ({ kind: "video", segmentId: "g", speed: 1, file: "/g.mov", photo: false, sourceUs, native: { width: 400, height: 300 }, look: l, overlay: true }) },
  ],
  sounds: [{ file: "/v.mov", startUs: 0, durationUs: s(1), sourceUs: s(10), volume: 1 }],
  skipped: [],
}

test("a preview pulls each segment's frames in one run, draws every frame, mixes the sound to a WAV, and is made once per timeline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-previews-"))
  const runs: string[][] = []
  const draws: number[] = []
  const maker = createPreviewVideo({
    ffmpeg: "ffmpeg",
    dir,
    draftOf: async () => draft,
    page: { draw: async (tiles) => (draws.push(tiles[0]!.layers.length), Buffer.from("jpeg")) },
    run: async (_command, args) => {
      runs.push(args)
      const out = args.at(-1)!
      // a frames run writes as many frames as it was asked for
      if (out.includes("%05d")) {
        const count = Number(args[args.indexOf("-frames:v") + 1])
        for (let n = 1; n <= count; n++) await writeFile(out.replace("%05d", String(n).padStart(5, "0")), "px")
      } else await writeFile(out, "wav")
    },
  })
  const made = await maker.make("/drafts/1003", { a: 1 } as unknown as AgentTimeline)
  expect(made).toMatchObject({ frames: VIDEO_FPS, fps: VIDEO_FPS, audio: true, durationUs: s(1) })
  // two segments, two frame runs: the main video from 10 s, the graphic from its start, with alpha
  const frameRuns = runs.filter((args) => args.includes("-frames:v"))
  expect(frameRuns).toHaveLength(2)
  expect(frameRuns[0]!.slice(frameRuns[0]!.indexOf("-ss"), frameRuns[0]!.indexOf("-ss") + 2)).toEqual(["-ss", "10.000"])
  expect(frameRuns[1]).toEqual(expect.arrayContaining(["-pix_fmt", "rgba"]))
  // every frame drawn: the graphic over the second half
  expect(draws).toHaveLength(VIDEO_FPS)
  expect(draws.filter((layers) => layers === 2).length).toBe(7)
  const files = await readdir(join(dir, made.id))
  expect(files).toEqual(expect.arrayContaining(["00001.jpg", `000${VIDEO_FPS}.jpg`, "audio.wav", "preview.json"]))
  expect(String(await readFile(join(dir, made.id, "00001.jpg")))).toBe("jpeg")
  // the sound: trimmed from 10 s, set at 0, mixed, written as 16-bit WAV
  const audio = runs.find((args) => args.at(-1)!.endsWith("audio.wav"))!
  expect(audio.join(" ")).toContain("atrim=start=10:duration=1")
  expect(audio).toEqual(expect.arrayContaining(["-c:a", "pcm_s16le"]))

  // the same timeline again: nothing made; another one: a new preview
  const before = runs.length
  expect((await maker.make("/drafts/1003", { a: 1 } as unknown as AgentTimeline)).id).toBe(made.id)
  expect(runs.length).toBe(before)
  expect((await maker.make("/drafts/1003", { a: 2 } as unknown as AgentTimeline)).id).not.toBe(made.id)
  expect(maker.fileOf(made.id, "00001.jpg")).toBe(join(dir, made.id, "00001.jpg"))
  expect(maker.fileOf(made.id, "../x")).toBeNull()
  expect(maker.fileOf("../../etc", "00001.jpg")).toBeNull()
})
