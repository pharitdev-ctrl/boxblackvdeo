import { expect, test } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { createFrameFiles, lookTimes } from "./frame-files.ts"

/** Stands in for ffmpeg: a frame file named by its time, holding the name of the video it came from. */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "boxblack-frame-files-"))
  const workDir = join(root, "work")
  const files = createFrameFiles({
    workDir,
    extract: (input, timesUs, outDir) =>
      Promise.all(
        timesUs.map(async (atUs) => {
          const path = join(outDir, `frame-${atUs}.jpg`)
          await writeFile(path, basename(input))
          return { atUs, path }
        }),
      ),
  })
  return { workDir, files }
}

test("two pictures looked at at the same moment each keep their own frame", async () => {
  const { files } = await setup()
  const looking = files.session()
  const [red] = await looking.of("/photos/red.heic", [0])
  const [blue] = await looking.of("/photos/blue.heic", [0])
  expect(red).not.toBe(blue)
  expect([await readFile(red!, "utf8"), await readFile(blue!, "utf8")]).toEqual(["red.heic", "blue.heic"])
})

test("the frames of a session are gone once it is over, and the work folder is made when missing", async () => {
  const { workDir, files } = await setup()
  const looking = files.session()
  const frames = await looking.of("/clips/shop.mov", [1_500_000, 5_000_000])
  expect(frames).toHaveLength(2)
  expect(frames.every((frame) => frame.startsWith(workDir))).toBe(true)
  await looking.dispose()
  expect(await readdir(workDir)).toEqual([])
})

test("a session that looked at nothing has nothing to clear away", async () => {
  const { files } = await setup()
  await expect(files.session().dispose()).resolves.toBeUndefined()
})

test("one frame is read and its file taken away", async () => {
  const { workDir, files } = await setup()
  expect((await files.one("/clips/talk.mov", 4_000_000)).toString()).toBe("talk.mov")
  expect(await readdir(workDir)).toEqual([])
})

test("a photo is looked at once; a clip near its start, middle and end", () => {
  expect(lookTimes({ kind: "photo", durationUs: 0 })).toEqual([0])
  expect(lookTimes({ kind: "video", durationUs: 10_000_000 })).toEqual([1_500_000, 5_000_000, 8_500_000])
})
