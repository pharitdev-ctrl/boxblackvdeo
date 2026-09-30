import { expect, test } from "vitest"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeFileAtomic } from "./atomic-write.ts"

test("writes started together all succeed, one after another, and the last one wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-atomic-"))
  const file = join(dir, "nested", "state.json")
  await Promise.all(Array.from({ length: 20 }, (_, n) => writeFileAtomic(file, JSON.stringify({ n }))))
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ n: 19 })
  expect(await readdir(join(dir, "nested"))).toEqual(["state.json"])
})

test("a failed write does not stop the next one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-atomic-"))
  const file = join(dir, "state.json")
  const failing = writeFileAtomic(file, "x", { mode: -1 })
  const next = writeFileAtomic(file, "ok")
  await expect(failing).rejects.toThrow()
  await next
  expect(await readFile(file, "utf8")).toBe("ok")
})

test("a write that cannot take the file's place leaves no temporary file behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-atomic-"))
  const file = join(dir, "state.json")
  // a folder with something in it where the file should go
  await mkdir(file)
  await writeFile(join(file, "inside"), "x")
  await expect(writeFileAtomic(file, "{}")).rejects.toThrow()
  expect(await readdir(dir)).toEqual(["state.json"])
})
