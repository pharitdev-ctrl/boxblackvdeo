import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Outline } from "@boxblack/core/planner"
import type { StoredOutline } from "../shared/api.ts"
import { ProgressStore, stagesOf } from "./progress.ts"

const store = async () => new ProgressStore(await mkdtemp(join(tmpdir(), "boxblack-progress-")))

const outline: Outline = { title: "เรื่อง", summary: "สรุป", omitted: "", warnings: [], beats: [] }
const stored = (folder: string, extra: Partial<StoredOutline> = {}): StoredOutline => ({
  folder,
  videoIds: ["a"],
  brief: { targetSeconds: null, videoType: null, instructions: "" },
  outline,
  confirmed: false,
  model: "claude-opus-5",
  promptVersion: "planner-1",
  updatedAt: 2_000,
  ...extra,
})

test("what a project has had analysed is written and read back", async () => {
  const progress = await store()
  await progress.put({ folder: "/drafts/0917", analysedAt: 1_000, videoIds: ["a", "b"] })
  expect(await progress.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", analysedAt: 1_000, videoIds: ["a", "b"] })
  expect(await progress.get("/drafts/0815")).toBeNull()
})

test("a later run replaces the earlier one, and every project is read in one go", async () => {
  const progress = await store()
  await progress.put({ folder: "/drafts/0917", analysedAt: 1_000, videoIds: ["a"] })
  await progress.put({ folder: "/drafts/0815", analysedAt: 1_500, videoIds: ["c"] })
  await progress.put({ folder: "/drafts/0917", analysedAt: 3_000, videoIds: ["a", "b"] })
  const all = await progress.all()
  expect(all.map((one) => one.folder).sort()).toEqual(["/drafts/0815", "/drafts/0917"])
  expect(all.find((one) => one.folder === "/drafts/0917")).toEqual({ folder: "/drafts/0917", analysedAt: 3_000, videoIds: ["a", "b"] })
})

test("a file that is not ours, or half written, is passed over rather than failing the list", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-progress-"))
  const progress = new ProgressStore(dir)
  await progress.put({ folder: "/drafts/0917", analysedAt: 1_000, videoIds: ["a"] })
  await writeFile(join(dir, "broken.json"), "{ not json")
  // readable JSON that is not one of ours at all: it names no project
  await writeFile(join(dir, "stray.json"), JSON.stringify({ hello: "world" }))
  expect((await progress.all()).map((one) => one.folder)).toEqual(["/drafts/0917"])
})

test("no folder at all reads as nothing done yet", async () => {
  const progress = new ProgressStore(join(tmpdir(), "boxblack-progress-missing"))
  expect(await progress.all()).toEqual([])
  expect(await progress.get("/drafts/0917")).toBeNull()
})

test("the stage shown is the furthest a project reached, with the time that stage was reached", () => {
  const stages = stagesOf(
    [
      { folder: "/drafts/analysed", analysedAt: 1_000, videoIds: ["a"] },
      { folder: "/drafts/planned", analysedAt: 1_000, videoIds: ["a"] },
      { folder: "/drafts/confirmed", analysedAt: 1_000, videoIds: ["a"] },
    ],
    [stored("/drafts/planned"), stored("/drafts/confirmed", { confirmed: true, updatedAt: 5_000 })],
  )
  expect(stages).toEqual({
    "/drafts/analysed": { stage: "analysed", at: 1_000 },
    "/drafts/planned": { stage: "outline", at: 2_000 },
    "/drafts/confirmed": { stage: "confirmed", at: 5_000 },
  })
})

test("an outline whose project was analysed by an older build still shows its stage", () => {
  expect(stagesOf([], [stored("/drafts/planned")])).toEqual({ "/drafts/planned": { stage: "outline", at: 2_000 } })
})

test("a project nothing has been done to has no stage at all", () => {
  expect(stagesOf([], [])).toEqual({})
})
