import { expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrateDataDir, OWN_ENTRIES } from "./migrate-data.ts"

async function dirs() {
  const root = await mkdtemp(join(tmpdir(), "boxblack-migrate-"))
  // the folder the product's earlier name used, and the one in force
  const from = join(root, "prodeck2")
  const to = join(root, "BOXBLACK")
  await mkdir(from, { recursive: true })
  await mkdir(to, { recursive: true })
  return { from, to }
}

test("the app's own files move to the new folder, and Chromium's are left where they are", async () => {
  const { from, to } = await dirs()
  await writeFile(join(from, "license.json"), "{\"token\":\"t\"}")
  await writeFile(join(from, "settings.json"), "{}")
  await mkdir(join(from, "models"))
  await writeFile(join(from, "models", "large-v3.bin"), "model")
  // Chromium's own state belongs to whichever name the app runs under
  await mkdir(join(from, "Cache"))
  await writeFile(join(from, "Cookies"), "c")

  expect(await migrateDataDir({ from, to })).toEqual(["license.json", "models", "settings.json"])
  expect(await readFile(join(to, "license.json"), "utf8")).toBe("{\"token\":\"t\"}")
  expect(await readFile(join(to, "models", "large-v3.bin"), "utf8")).toBe("model")
  // moved, not copied: the old folder keeps only what is not ours
  expect((await readdir(from)).sort()).toEqual(["Cache", "Cookies"])
})

test("a file the new folder already has is left alone, so a second run moves nothing", async () => {
  const { from, to } = await dirs()
  await writeFile(join(from, "settings.json"), "old")
  await writeFile(join(to, "settings.json"), "new")
  await mkdir(join(from, "outlines"))
  await writeFile(join(from, "outlines", "a.json"), "{}")

  expect(await migrateDataDir({ from, to })).toEqual(["outlines"])
  expect(await readFile(join(to, "settings.json"), "utf8")).toBe("new")
  expect(await readFile(join(from, "settings.json"), "utf8")).toBe("old")
  expect(await migrateDataDir({ from, to })).toEqual([])
})

test("with no old folder, or the same folder twice, nothing happens", async () => {
  const { to } = await dirs()
  expect(await migrateDataDir({ from: join(to, "..", "gone"), to })).toEqual([])
  expect(await migrateDataDir({ from: to, to })).toEqual([])
})

test("everything the app keeps in its data folder is on the list", () => {
  // the entries index.ts builds its stores from; a new store means a new entry here
  expect([...OWN_ENTRIES].sort()).toEqual([
    "backups",
    "device-id",
    "insights",
    "license.json",
    "loudness",
    "media-looks",
    "models",
    "outlines",
    "secrets.json",
    "settings.json",
    "subtitle-polish",
    "transcripts",
  ])
})
