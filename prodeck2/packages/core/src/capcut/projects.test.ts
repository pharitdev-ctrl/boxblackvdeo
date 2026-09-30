import { test } from "vitest"
import assert from "node:assert/strict"
import { cp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { findDraftsRoot, inspectProject, listProjects } from "./projects.ts"
import type { DraftInfo, DraftMeta, RootMeta } from "./types.ts"

async function editJson<T>(path: string, edit: (value: T) => void): Promise<void> {
  const value = JSON.parse(await readFile(path, "utf8")) as T
  edit(value)
  await writeFile(path, JSON.stringify(value))
}

/** Adds a second on-disk draft "0918" (a copy of 0917) registered with the given modified time. */
async function addDraft(root: string, modifiedUs: number, extra: Record<string, unknown> = {}): Promise<string> {
  const folder = join(root, "0918")
  await cp(join(root, "0917"), folder, { recursive: true })
  await editJson<DraftMeta>(join(folder, "draft_meta_info.json"), (meta) => {
    meta.draft_name = "0918"
  })
  await editJson<RootMeta>(join(root, "root_meta_info.json"), (rootMeta) => {
    const template = rootMeta.all_draft_store[0]!
    rootMeta.all_draft_store.push({
      ...template,
      draft_name: "0918",
      draft_fold_path: folder,
      tm_duration: 5_000_000,
      tm_draft_modified: modifiedUs,
      ...extra,
    })
  })
  return folder
}

test("findDraftsRoot picks CapCut's drafts folder under the user's Movies folder", () => {
  const expected = "/Users/me/Movies/CapCut/User Data/Projects/com.lveditor.draft"
  assert.equal(findDraftsRoot("/Users/me", (path) => path === join(expected, "root_meta_info.json")), expected)
})

test("findDraftsRoot falls back to CapCut's sandbox container", () => {
  const expected = "/Users/me/Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Projects/com.lveditor.draft"
  assert.equal(findDraftsRoot("/Users/me", (path) => path === join(expected, "root_meta_info.json")), expected)
})

test("findDraftsRoot returns null when CapCut has never saved a project", () => {
  assert.equal(findDraftsRoot("/Users/me", () => false), null)
})

test("listProjects skips registered drafts whose folder no longer exists", async () => {
  const root = await makeDraftRoot()
  // the fixture registers 0815 too, but only ships the 0917 folder
  const projects = await listProjects(root)
  assert.deepEqual(
    projects.map((p) => [p.name, p.folder]),
    [["0917", join(root, "0917")]],
  )
})

test("listProjects reports duration and last-modified time from root_meta_info.json", async () => {
  const root = await makeDraftRoot()
  const [project] = await listProjects(root)
  assert.equal(project!.durationUs, 0)
  assert.equal(project!.modifiedUs, 1_789_623_936_439_997)
})

test("listProjects lists the most recently edited project first", async () => {
  const root = await makeDraftRoot()
  await addDraft(root, 1_900_000_000_000_000)
  assert.deepEqual(
    (await listProjects(root)).map((p) => p.name),
    ["0918", "0917"],
  )
})

test("listProjects leaves out drafts CapCut hides", async () => {
  const root = await makeDraftRoot()
  await addDraft(root, 1_900_000_000_000_000, { draft_is_invisible: true })
  assert.deepEqual(
    (await listProjects(root)).map((p) => p.name),
    ["0917"],
  )
})

test("listProjects points at the cover image only when CapCut has made one", async () => {
  const root = await makeDraftRoot()
  assert.equal((await listProjects(root))[0]!.coverPath, null)
  await writeFile(join(root, "0917", "draft_cover.jpg"), "jpeg")
  assert.equal((await listProjects(root))[0]!.coverPath, join(root, "0917", "draft_cover.jpg"))
})

test("inspectProject describes the project and every video in its media bin", async () => {
  const root = await makeDraftRoot()
  const detail = await inspectProject(join(root, "0917"), { testedVersions: ["9.4.0"], fileExists: () => true })
  assert.deepEqual(detail, {
    name: "0917",
    folder: join(root, "0917"),
    capcutVersion: "9.4.0",
    versionTested: true,
    fps: 30,
    canvas: { width: 1920, height: 1080 },
    timelineSegmentCount: 0,
    videos: [
      {
        id: "8efd5c3a-62ad-4e1b-9ea9-7b603c267884",
        path: "/fixture/media/IMG_9646.MOV",
        name: "IMG_9646.MOV",
        durationUs: 31_106_000,
        width: 1080,
        height: 1920,
        exists: true,
      },
    ],
  })
})

test("inspectProject flags videos whose file is gone", async () => {
  const root = await makeDraftRoot()
  const detail = await inspectProject(join(root, "0917"), { testedVersions: ["9.4.0"], fileExists: () => false })
  assert.equal(detail.videos[0]!.exists, false)
})

test("inspectProject flags a CapCut version nobody has tested the writer against", async () => {
  const root = await makeDraftRoot()
  const detail = await inspectProject(join(root, "0917"), { testedVersions: ["9.3.0"], fileExists: () => true })
  assert.equal(detail.versionTested, false)
})

test("inspectProject leaves out BOXBLACK's own rendered graphics, but not the user's other files under Movies/CapCut", async () => {
  const root = await makeDraftRoot()
  await editJson<DraftMeta>(join(root, "0917", "draft_meta_info.json"), (meta) => {
    const imported = meta.draft_materials.find((group) => group.type === 0)!
    const realVideo = imported.value.find((entry) => entry.metetype === "video")!
    imported.value.push(
      { ...realVideo, id: "GRAPHIC", file_Path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", extra_info: "ab12.mov" },
      // a user's own file also happens to sit under Movies/CapCut, just not in BOXBLACK's own folder
      { ...realVideo, id: "USER-ELSEWHERE", file_Path: "/Users/x/Movies/CapCut/broll.mov", extra_info: "broll.mov" },
    )
  })
  const detail = await inspectProject(join(root, "0917"), { testedVersions: ["9.4.0"], fileExists: () => true })
  const ids = detail.videos.map((video) => video.id)
  assert.ok(!ids.includes("GRAPHIC"))
  assert.ok(ids.includes("USER-ELSEWHERE"))
  assert.ok(ids.includes("8efd5c3a-62ad-4e1b-9ea9-7b603c267884"))
})

test("inspectProject counts what is already on the timeline", async () => {
  const root = await makeDraftRoot()
  await editJson<DraftInfo>(join(root, "0917", "draft_info.json"), (info) => {
    info.tracks = [
      { id: "T1", type: "video", segments: [{ id: "S1" }, { id: "S2" }] as never },
      { id: "T2", type: "text", segments: [{ id: "S3" }] as never },
    ]
  })
  const detail = await inspectProject(join(root, "0917"), { testedVersions: ["9.4.0"], fileExists: () => true })
  assert.equal(detail.timelineSegmentCount, 3)
})
