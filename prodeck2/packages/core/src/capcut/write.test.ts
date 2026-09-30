import { test, vi } from "vitest"
import assert from "node:assert/strict"
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { addBinItems, graphicBinItem } from "./bin.ts"
import { binVideos, loadDraft, readJson } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import type { Draft, DraftInfo, DraftMeta, RootMeta } from "./types.ts"
import { backupDraft, liveTimelines, restoreDraft, timelineCopies, writeDraft } from "./write.ts"

// a full disk can fail a write after the file is already made, which a test cannot set up: this makes
// the next write of a new copy staged beside `stagedFails` fail on demand, once the file is down
const fsControl = vi.hoisted(() => ({ stagedFails: null as string | null }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...real,
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      await real.writeFile(...args)
      const path = String(args[0])
      const beside = fsControl.stagedFails
      if (beside !== null && path !== beside && path.startsWith(beside)) {
        fsControl.stagedFails = null
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" })
      }
    },
  }
})

const notRunning = async () => false

/** Every file and folder under a dir, so a test can tell nothing was left behind whatever it is called. */
const listing = async (dir: string) => (await readdir(dir, { recursive: true })).sort()

async function setup(): Promise<{ draft: Draft; next: DraftInfo }> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  const [clip] = binVideos(draft.meta)
  const next = buildRoughCut(draft.info, [{ binId: clip!.id, sourceStartUs: 0, sourceDurationUs: 2_000_000 }], [clip!])
  return { draft, next }
}

test("timelineCopies lists the six files CapCut keeps the timeline in", async () => {
  const { draft } = await setup()
  const tl = join(draft.folder, "Timelines", draft.mainTimelineId)
  assert.deepEqual(timelineCopies(draft), [
    join(draft.folder, "draft_info.json"),
    join(draft.folder, "draft_info.json.bak"),
    join(draft.folder, "template-2.tmp"),
    join(tl, "draft_info.json"),
    join(tl, "draft_info.json.bak"),
    join(tl, "template-2.tmp"),
  ])
})

test("liveTimelines counts the project's timelines that are not marked deleted", async () => {
  const { draft } = await setup()
  assert.equal(await liveTimelines(draft), 1)

  // a second timeline made in CapCut, and a third made and then deleted
  const path = join(draft.folder, "Timelines", "project.json")
  const project = JSON.parse(await readFile(path, "utf8")) as { timelines: Record<string, unknown>[] }
  const [main] = project.timelines
  project.timelines.push({ ...main, id: "1B7E2C4A-0000-4000-8000-000000000002", name: "ไทม์ไลน์ 02" })
  project.timelines.push({ ...main, id: "1B7E2C4A-0000-4000-8000-000000000003", name: "ไทม์ไลน์ 03", is_marked_delete: true })
  await writeFile(path, JSON.stringify(project))
  assert.equal(await liveTimelines(draft), 2)
})

test("liveTimelines takes a project.json that is missing or unreadable as one timeline", async () => {
  const { draft } = await setup()
  const path = join(draft.folder, "Timelines", "project.json")
  await writeFile(path, "{ not json")
  assert.equal(await liveTimelines(draft), 1)
  await writeFile(path, JSON.stringify({ main_timeline_id: draft.mainTimelineId }))
  assert.equal(await liveTimelines(draft), 1)
  await rm(path)
  assert.equal(await liveTimelines(draft), 1)
})

test("writeDraft puts the new timeline in every timeline copy", async () => {
  const { draft, next } = await setup()
  await writeDraft(draft, next, { isCapCutRunning: notRunning })
  for (const path of timelineCopies(draft)) {
    assert.deepEqual(await readJson(path), next, path)
  }
})

test("writeDraft leaves the Timelines template.tmp snapshot alone", async () => {
  const { draft, next } = await setup()
  const path = join(draft.folder, "Timelines", draft.mainTimelineId, "template.tmp")
  const before = await readFile(path, "utf8")
  await writeDraft(draft, next, { isCapCutRunning: notRunning })
  assert.equal(await readFile(path, "utf8"), before)
})

test("writeDraft records the new duration in draft_meta_info.json", async () => {
  const { draft, next } = await setup()
  await writeDraft(draft, next, { isCapCutRunning: notRunning, nowUs: 1_800_000_000_000_000 })
  const meta = await readJson<DraftMeta>(join(draft.folder, "draft_meta_info.json"))
  assert.equal(meta.tm_duration, 2_000_000)
  assert.equal(meta.tm_draft_modified, 1_800_000_000_000_000)
  assert.deepEqual(meta.draft_materials, draft.meta.draft_materials)
})

test("writeDraft applies the bin callback to the meta it reads, in the same write", async () => {
  const { draft, next } = await setup()
  // clearly not the fixture's placeholder id (cd484075-d92a-4bc9-b45c-d093d2f9e71b), not a near-miss of it
  const item = graphicBinItem({ id: "00000000-0000-0000-0000-000000000000", path: "/g.mov", width: 10, height: 20, durationUs: 1_000_000, nowMs: 1_800_000_000_000 })
  await writeDraft(draft, next, { isCapCutRunning: notRunning, nowUs: 1_800_000_000_000_000, bin: (meta) => addBinItems(meta, [item]) })
  const meta = await readJson<DraftMeta>(join(draft.folder, "draft_meta_info.json"))
  const imported = meta.draft_materials.find((group) => group.type === 0)!
  assert.deepEqual(imported.value.at(-1), item)
  // the tm_* fields are still updated in the same write
  assert.equal(meta.tm_duration, 2_000_000)
  assert.equal(meta.tm_draft_modified, 1_800_000_000_000_000)
})

test("writeDraft with no bin callback leaves draft_materials exactly as it was", async () => {
  const { draft, next } = await setup()
  await writeDraft(draft, next, { isCapCutRunning: notRunning })
  const meta = await readJson<DraftMeta>(join(draft.folder, "draft_meta_info.json"))
  assert.deepEqual(meta.draft_materials, draft.meta.draft_materials)
})

test("a bin callback that throws leaves every file of the draft unchanged, and no temp files", async () => {
  const { draft, next } = await setup()
  const files = await listing(draft.root)
  const before = await Promise.all(timelineCopies(draft).map((p) => readFile(p, "utf8")))
  const metaBefore = await readFile(join(draft.folder, "draft_meta_info.json"), "utf8")

  await assert.rejects(
    writeDraft(draft, next, {
      isCapCutRunning: notRunning,
      bin: () => {
        throw new Error("boom")
      },
    }),
    /boom/,
  )

  assert.deepEqual(await Promise.all(timelineCopies(draft).map((p) => readFile(p, "utf8"))), before)
  assert.equal(await readFile(join(draft.folder, "draft_meta_info.json"), "utf8"), metaBefore)
  assert.deepEqual(await listing(draft.root), files)
})

test("the bin callback sees the meta as it is on disk at write time, not as loadDraft saw it", async () => {
  const { draft, next } = await setup()
  const metaPath = join(draft.folder, "draft_meta_info.json")
  const onDisk = JSON.parse(await readFile(metaPath, "utf8")) as DraftMeta
  onDisk.draft_name = "edited-after-load"
  await writeFile(metaPath, JSON.stringify(onDisk))

  let sawName: string | undefined
  await writeDraft(draft, next, {
    isCapCutRunning: notRunning,
    bin: (meta) => {
      sawName = meta.draft_name
      return meta
    },
  })
  assert.equal(sawName, "edited-after-load")
})

test("writeDraft updates only this draft's entry in root_meta_info.json", async () => {
  const { draft, next } = await setup()
  const before = await readJson<RootMeta>(join(draft.root, "root_meta_info.json"))
  await writeDraft(draft, next, { isCapCutRunning: notRunning, nowUs: 1_800_000_000_000_000 })
  const after = await readJson<RootMeta>(join(draft.root, "root_meta_info.json"))
  const mine = after.all_draft_store.find((e) => e.draft_fold_path === draft.folder)!
  assert.equal(mine.tm_duration, 2_000_000)
  assert.equal(mine.tm_draft_modified, 1_800_000_000_000_000)
  const others = (m: RootMeta) => m.all_draft_store.filter((e) => e.draft_fold_path !== draft.folder)
  assert.deepEqual(others(after), others(before))
})

test("writeDraft refuses to touch anything while CapCut is running", async () => {
  const { draft, next } = await setup()
  const before = await readFile(join(draft.folder, "draft_info.json"), "utf8")
  await assert.rejects(writeDraft(draft, next, { isCapCutRunning: async () => true }), /CapCut/)
  assert.equal(await readFile(join(draft.folder, "draft_info.json"), "utf8"), before)
})

test("writeDraft leaves no temp files behind", async () => {
  const { draft, next } = await setup()
  const files = await listing(draft.root)
  await writeDraft(draft, next, { isCapCutRunning: notRunning })
  assert.deepEqual(await listing(draft.root), files)
})

test("two writes of one draft at once never swap in each other's staged files: both finish, every file whole, and no temp files", async () => {
  const { draft, next } = await setup()
  const files = await listing(draft.root)
  const other = { ...next, duration: next.duration + 1 }
  await Promise.all([writeDraft(draft, next, { isCapCutRunning: notRunning }), writeDraft(draft, other, { isCapCutRunning: notRunning })])
  // each copy is one write's timeline whole, never one cut short by the other
  const written = [JSON.stringify(next), JSON.stringify(other)]
  for (const path of timelineCopies(draft)) assert.ok(written.includes(await readFile(path, "utf8")), path)
  assert.deepEqual(await listing(draft.root), files)
})

test("a write that fails part of the way leaves every copy as it was, and no temp files", async () => {
  const copies = (draft: Draft) => Promise.all(timelineCopies(draft).map((p) => readFile(p, "utf8")))

  // the Timelines copies cannot be written: nothing is changed anywhere
  const one = await setup()
  const files = await listing(one.draft.root)
  const before = await copies(one.draft)
  const timelines = join(one.draft.folder, "Timelines", one.draft.mainTimelineId)
  await chmod(timelines, 0o555)
  try {
    await assert.rejects(writeDraft(one.draft, one.next, { isCapCutRunning: notRunning }))
  } finally {
    await chmod(timelines, 0o755)
  }
  assert.deepEqual(await copies(one.draft), before)
  assert.deepEqual(await listing(one.draft.root), files)

  // the timeline went in but CapCut's list of drafts cannot be updated: the timeline goes back too
  const two = await setup()
  const files2 = await listing(two.draft.root)
  const before2 = await copies(two.draft)
  const meta2 = await readFile(join(two.draft.folder, "draft_meta_info.json"), "utf8")
  await chmod(two.draft.root, 0o555)
  try {
    await assert.rejects(writeDraft(two.draft, two.next, { isCapCutRunning: notRunning }))
  } finally {
    await chmod(two.draft.root, 0o755)
  }
  assert.deepEqual(await copies(two.draft), before2)
  assert.equal(await readFile(join(two.draft.folder, "draft_meta_info.json"), "utf8"), meta2)
  assert.deepEqual(await listing(two.draft.root), files2)

  // the disk fills up while a file is being written: the part of it already down is taken away too
  const three = await setup()
  const files3 = await listing(three.draft.root)
  const before3 = await copies(three.draft)
  const metaPath = join(three.draft.folder, "draft_meta_info.json")
  const meta3 = await readFile(metaPath, "utf8")
  fsControl.stagedFails = metaPath
  try {
    await assert.rejects(writeDraft(three.draft, three.next, { isCapCutRunning: notRunning }), /ENOSPC/)
  } finally {
    fsControl.stagedFails = null
  }
  assert.deepEqual(await copies(three.draft), before3)
  assert.equal(await readFile(metaPath, "utf8"), meta3)
  assert.deepEqual(await listing(three.draft.root), files3)
})

test("a draft whose name has a slash in it is backed up in a folder of its own, where it can be found", async () => {
  const { draft } = await setup()
  const backups = await mkdtemp(join(tmpdir(), "boxblack-backups-"))
  for (const name of ["โปรโมต 9/9", "../../outside", ".hidden"]) {
    const dir = await backupDraft({ ...draft, name }, backups, new Date(Date.UTC(2026, 8, 23, 8, 0, backups.length)))
    assert.equal(join(dir, ".."), backups)
    assert.ok(!dir.slice(backups.length + 1).startsWith("."))
  }
  assert.equal((await readdir(backups)).length, 3)
})

test("restoreDraft brings back the draft exactly as it was before the write", async () => {
  const { draft, next } = await setup()
  const backups = await mkdtemp(join(tmpdir(), "boxblack-backups-"))
  const snapshot = async () => ({
    copies: await Promise.all(timelineCopies(draft).map((p) => readFile(p, "utf8"))),
    meta: await readFile(join(draft.folder, "draft_meta_info.json"), "utf8"),
    entry: (await readJson<RootMeta>(join(draft.root, "root_meta_info.json"))).all_draft_store,
  })
  const before = await snapshot()

  const backupDir = await backupDraft(draft, backups)
  await writeDraft(draft, next, { isCapCutRunning: notRunning })
  await restoreDraft(backupDir, { isCapCutRunning: notRunning })

  assert.deepEqual(await snapshot(), before)
})

test("restoreDraft keeps the folder it replaces instead of deleting it", async () => {
  const { draft, next } = await setup()
  const backups = await mkdtemp(join(tmpdir(), "boxblack-backups-"))
  const backupDir = await backupDraft(draft, backups)
  await writeDraft(draft, next, { isCapCutRunning: notRunning })
  await restoreDraft(backupDir, { isCapCutRunning: notRunning })
  const replaced = (await readdir(backupDir)).filter((name) => name.startsWith("replaced-"))
  assert.equal(replaced.length, 1)
  assert.deepEqual(await readJson(join(backupDir, replaced[0]!, "draft_info.json")), next)
})

test("restoreDraft refuses to run while CapCut is running", async () => {
  const { draft } = await setup()
  const backups = await mkdtemp(join(tmpdir(), "boxblack-backups-"))
  const backupDir = await backupDraft(draft, backups)
  await assert.rejects(restoreDraft(backupDir, { isCapCutRunning: async () => true }), /CapCut/)
})
