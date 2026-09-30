import { expect, test } from "vitest"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { makeDraftRoot } from "../../../../packages/core/test/fixture-root.ts"
import { createApi } from "./api.ts"

const notRunning = async () => false
const noStages = async () => ({})

async function apiWithFixture() {
  const root = await makeDraftRoot()
  return { root, api: createApi({ root: () => root, isCapCutRunning: notRunning, testedVersions: async () => ["9.4.0"], stages: noStages }) }
}

test("listProjects returns the drafts folder and its projects", async () => {
  const { root, api } = await apiWithFixture()
  const list = await api.listProjects()
  expect(list.root).toBe(root)
  expect(list.projects.map((p) => p.name)).toEqual(["0917"])
})

test("listProjects says how far the app got with each project, so the list can show it", async () => {
  const root = await makeDraftRoot()
  const api = createApi({
    root: () => root,
    isCapCutRunning: notRunning,
    testedVersions: async () => ["9.4.0"],
    stages: async () => ({ [join(root, "0917")]: { stage: "confirmed" as const, at: 5_000 } }),
  })
  const list = await api.listProjects()
  expect(list.stages).toEqual({ [join(root, "0917")]: { stage: "confirmed", at: 5_000 } })
})

test("listProjects says so when CapCut's drafts folder was not found", async () => {
  const api = createApi({ root: () => null, isCapCutRunning: notRunning, testedVersions: async () => ["9.4.0"], stages: noStages })
  expect(await api.listProjects()).toEqual({ root: null, projects: [], stages: {} })
})

test("CapCut opened for the first time after the app started is found without starting the app again", async () => {
  const root = await makeDraftRoot()
  let installed = false
  const api = createApi({ root: () => (installed ? root : null), isCapCutRunning: notRunning, testedVersions: async () => ["9.4.0"], stages: noStages })
  expect((await api.listProjects()).projects).toEqual([])
  installed = true
  expect((await api.listProjects()).projects.map((p) => p.name)).toEqual(["0917"])
})

test("inspectProject describes a listed project", async () => {
  const { root, api } = await apiWithFixture()
  const detail = await api.inspectProject(join(root, "0917"))
  expect(detail.name).toBe("0917")
  expect(detail.versionTested).toBe(true)
  expect(detail.videos).toHaveLength(1)
})

test("inspectProject refuses a folder that is not one of CapCut's projects", async () => {
  const { root, api } = await apiWithFixture()
  await expect(api.inspectProject("/etc")).rejects.toThrow(/not a CapCut project/)
  await expect(api.inspectProject(join(root, "0917", ".."))).rejects.toThrow(/not a CapCut project/)
})

test("readCover returns the cover as a JPEG data URL", async () => {
  const { root, api } = await apiWithFixture()
  await writeFile(join(root, "0917", "draft_cover.jpg"), Buffer.from([0xff, 0xd8, 0xff]))
  expect(await api.readCover(join(root, "0917"))).toBe("data:image/jpeg;base64,/9j/")
})

test("readCover returns null when the project has no cover yet", async () => {
  const { root, api } = await apiWithFixture()
  expect(await api.readCover(join(root, "0917"))).toBeNull()
})

test("readCover refuses a folder that is not one of CapCut's projects", async () => {
  const { api } = await apiWithFixture()
  await expect(api.readCover("/etc")).rejects.toThrow(/not a CapCut project/)
})

test("capcutStatus reports whether CapCut is running", async () => {
  const root = await makeDraftRoot()
  const api = createApi({ root: () => root, isCapCutRunning: async () => true, testedVersions: async () => ["9.4.0"], stages: noStages })
  expect(await api.capcutStatus()).toEqual({ running: true })
})

test("the CapCut versions counted as tested come from the license server's latest list", async () => {
  const root = await makeDraftRoot()
  let versions = ["9.3.0"]
  const api = createApi({ root: () => root, isCapCutRunning: notRunning, testedVersions: async () => versions, stages: noStages })
  expect((await api.inspectProject(join(root, "0917"))).versionTested).toBe(false)
  versions = ["9.3.0", "9.4.0"]
  expect((await api.inspectProject(join(root, "0917"))).versionTested).toBe(true)
})
