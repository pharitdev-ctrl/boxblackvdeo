import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPreviewFrames } from "./preview-frames.ts"

test("frames are pulled once per file, frame time, size and kind, at the time in the file, as data URLs; one that fails is null and tried again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-preview-"))
  const runs: string[][] = []
  let failing = true
  const frames = createPreviewFrames({
    ffmpeg: "ffmpeg",
    dir,
    run: async (_command, args) => {
      runs.push(args)
      if (args.includes("/broken.mov") && failing) throw new Error("no frame")
      await writeFile(args.at(-1)!, "px")
    },
  })
  const ask = { file: "/v.mov", sourceUs: 10_500_000, photo: false, alpha: false, width: 432 }
  const answers = await frames.frames([ask, { ...ask, sourceUs: 10_510_000 }, { ...ask, file: "/g.mov", alpha: true, sourceUs: 0 }, { ...ask, file: "/broken.mov" }, { ...ask, file: "/p.heic", photo: true }])
  expect(answers).toEqual([`data:image/jpeg;base64,${Buffer.from("px").toString("base64")}`, expect.any(String), `data:image/png;base64,${Buffer.from("px").toString("base64")}`, null, expect.any(String)])
  // the two asks within one frame share a pull
  expect(runs.filter((args) => args.includes("/v.mov"))).toHaveLength(1)
  const video = runs.find((args) => args.includes("/v.mov"))!
  expect(video.slice(video.indexOf("-ss"), video.indexOf("-ss") + 2)).toEqual(["-ss", "10.500"])
  expect(runs.find((args) => args.includes("/g.mov"))).toEqual(expect.arrayContaining(["-pix_fmt", "rgba"]))
  expect(runs.find((args) => args.includes("/p.heic"))).not.toContain("-ss")
  // a second look pulls nothing it has, and tries the broken one again
  failing = false
  const again = await frames.frames([ask, { ...ask, file: "/broken.mov" }])
  expect(again[1]).not.toBeNull()
  expect(runs.filter((args) => args.includes("/v.mov"))).toHaveLength(1)
})
