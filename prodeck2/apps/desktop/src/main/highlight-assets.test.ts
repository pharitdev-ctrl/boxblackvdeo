import { expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHighlightAssets } from "./highlight-assets.ts"

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-assets-"))
  const sourceDir = join(dir, "resources")
  await mkdir(sourceDir)
  await writeFile(join(sourceDir, "Kanit-ExtraBold.ttf"), "kanit font")
  await writeFile(join(sourceDir, "Mali-Bold.ttf"), "mali")
  const fontDir = join(dir, "Movies", "CapCut", "BOXBLACK", "fonts")
  const effectCache = join(dir, "effect")
  return { dir, sourceDir, fontDir, effectCache, assets: createHighlightAssets({ sourceDir, fontDir, effectCache }) }
}

test("a font is copied where CapCut may read it, once", async () => {
  const { fontDir, assets } = await setup()
  const path = await assets.fontPath("kanit")
  expect(path).toBe(join(fontDir, "Kanit-ExtraBold.ttf"))
  expect(await readFile(path, "utf8")).toBe("kanit font")

  const copied = (await stat(path)).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 20))
  await assets.fontPath("kanit")
  expect((await stat(path)).mtimeMs).toBe(copied)
})

test("a font that differs from the shipped one is replaced", async () => {
  const { fontDir, assets } = await setup()
  await mkdir(fontDir, { recursive: true })
  await writeFile(join(fontDir, "Mali-Bold.ttf"), "an older, longer mali font")
  expect(await readFile(await assets.fontPath("mali"), "utf8")).toBe("mali")
})

test("a missing shipped font is an error, not a draft pointing nowhere", async () => {
  const { assets } = await setup()
  await expect(assets.fontPath("chonburi")).rejects.toThrow(/Chonburi-Regular.ttf/)
})

test("an animation's path is its folder in CapCut's effect cache, or empty for CapCut to download it", async () => {
  const { effectCache, assets } = await setup()
  expect(await assets.animationPath("7664531520492686613")).toBe("")
  await mkdir(join(effectCache, "7664531520492686613", "27f95588e49939b1aef6d5e55555a36e"), { recursive: true })
  expect(await assets.animationPath("7664531520492686613")).toBe(join(effectCache, "7664531520492686613", "27f95588e49939b1aef6d5e55555a36e"))
  // a stray file next to the folder is not the animation
  await mkdir(join(effectCache, "7643711191419833618"), { recursive: true })
  await writeFile(join(effectCache, "7643711191419833618", ".DS_Store"), "")
  expect(await assets.animationPath("7643711191419833618")).toBe("")
  // ids are digits only, so nothing outside the cache is looked at
  expect(await assets.animationPath("../resources")).toBe("")
})
