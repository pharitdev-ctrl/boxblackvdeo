import { afterEach, expect, test, vi } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { activeLicense, backupInfo, detail, fakeApi, insight, settingsView, summary, transcript } from "../test/fake-api.ts"
import type { StoredOutline, WriteResult } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { formatDate } from "./format.ts"
import { t } from "./i18n.ts"

afterEach(cleanup)
afterEach(() => {
  vi.useRealTimers()
})

async function openProject(name = "0917") {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(name) }))
  return screen.findByRole("heading", { name })
}

test("lists CapCut projects in the order the main process gives them", async () => {
  render(<App api={fakeApi()} pollMs={10} />)
  const cards = await screen.findAllByRole("button", { name: /08|09/ })
  expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual(["0917", "0815"])
})







test("warns when the project was saved by a CapCut version the writer is not tested on", async () => {
  render(<App api={fakeApi({ inspectProject: async () => detail({ capcutVersion: "9.5.0", versionTested: false }) })} pollMs={10} />)
  await openProject()
  expect(screen.getByText(t("warn.untestedVersion", { version: "9.5.0" }))).toBeTruthy()
})

test("warns that whatever is already on the timeline will be replaced", async () => {
  render(<App api={fakeApi({ inspectProject: async () => detail({ timelineSegmentCount: 4 }) })} pollMs={10} />)
  await openProject()
  expect(screen.getByText(t("warn.timelineReplaced", { count: 4 }))).toBeTruthy()
})




test("while CapCut is running a banner says to close it and start is blocked", async () => {
  render(<App api={fakeApi({}, { running: true })} pollMs={10} />)
  expect(await screen.findByText(t("gate.running"))).toBeTruthy()
  await openProject()
  await waitFor(() => expect(screen.getByRole("button", { name: t("prepare.start") })).toHaveProperty("disabled", true))
  expect(screen.getByText(t("gate.startBlocked"))).toBeTruthy()
})

test("start unlocks by itself once CapCut is closed", async () => {
  const capcut = { running: true }
  render(<App api={fakeApi({}, capcut)} pollMs={10} />)
  await openProject()
  await screen.findByText(t("gate.running"))
  capcut.running = false
  await waitFor(() => expect(screen.getByRole("button", { name: t("prepare.start") })).toHaveProperty("disabled", false))
  expect(screen.queryByText(t("gate.running"))).toBeNull()
})

test("starting the reading stays on the same screen and asks only for the ticked videos", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await openProject()
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  await waitFor(() => expect(screen.getByRole("button", { name: t("prepare.start") })).toHaveProperty("disabled", false))
  await userEvent.click(screen.getByRole("button", { name: t("prepare.start") }))
  await waitFor(() => expect(api.calls).toContainEqual(["startAnalysis", "/drafts/0917", ["a"]]))
  expect(screen.getByRole("heading", { name: "0917" })).toBeTruthy()
})



const stageChip = (name: string) =>
  within(screen.getByRole("navigation", { name: t("stages.label") })).getByRole("button", { name: new RegExp(name) })

test("the project list has no stage to point at; opening a project starts at เตรียม", async () => {
  render(<App api={fakeApi()} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  expect(screen.queryByRole("navigation", { name: t("stages.label") })).toBeNull()

  await openProject()
  expect(stageChip(t("stage.prepare")).getAttribute("aria-current")).toBe("step")
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", true)
  expect(stageChip(t("stage.post"))).toHaveProperty("disabled", true)
  // three stages: the write button is on the post-production page, not a stage of its own
  expect(within(screen.getByRole("navigation", { name: t("stages.label") })).getAllByRole("button")).toHaveLength(3)
})

const backToProjects = () => screen.getByRole("button", { name: new RegExp(t("nav.projects")) })

test("the project list's head has the waving mascot beside its title, hidden from screen readers", async () => {
  render(<App api={fakeApi()} pollMs={10} />)
  const heading = await screen.findByRole("heading", { name: t("projects.title") })
  const mascot = heading.closest(".screen-head")?.querySelector("img.mascot")
  expect(mascot?.getAttribute("alt")).toBe("")
  expect(mascot?.getAttribute("src")).toMatch(/mascot-wave/)
})

test("a project that is open can be left for the list, and another one opened", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await openProject()
  await userEvent.click(backToProjects())
  expect(await screen.findByRole("heading", { name: t("projects.title") })).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: /0815/ }))
  await waitFor(() => expect(api.calls).toContainEqual(["inspectProject", "/drafts/0815"]))
})

test("the list itself has nothing to go back to, and no backups of its own", async () => {
  render(<App api={fakeApi()} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  expect(screen.queryByRole("button", { name: new RegExp(t("nav.projects")) })).toBeNull()
  expect(screen.queryByRole("button", { name: new RegExp(t("shell.backups")) })).toBeNull()

  await openProject()
  expect(backToProjects()).toBeTruthy()
  expect(screen.getByRole("button", { name: new RegExp(t("shell.backups")) })).toBeTruthy()

  await userEvent.click(backToProjects())
  await screen.findByRole("heading", { name: t("projects.title") })
  expect(screen.queryByRole("button", { name: new RegExp(t("shell.backups")) })).toBeNull()
})

test("going back to the list keeps how far the project got, so its stages are still there", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await openProject()
  await waitFor(() => expect(screen.getByRole("button", { name: t("prepare.start") })).toHaveProperty("disabled", false))
  await userEvent.click(screen.getByRole("button", { name: t("prepare.start") }))
  act(() => {
    for (const videoId of ["a", "b"]) {
      api.emit({ type: "transcription", folder: "/drafts/0917", videoId, status: { state: "done", fromCache: false, transcript: transcript("x") } })
      api.emit({ type: "vision", folder: "/drafts/0917", videoId, status: { state: "done", fromCache: false, insight: insight("y") } })
    }
    api.emit({ type: "analysis-finished", folder: "/drafts/0917", outcome: "done" })
  })
  await userEvent.click(await screen.findByRole("button", { name: t("prepare.next") }))
  await screen.findByRole("button", { name: t("brief.submit") })

  await userEvent.click(backToProjects())
  await screen.findByRole("heading", { name: t("projects.title") })
  await openProject()
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", false)
})

test("settings open from the bar and back returns to where the user was", async () => {
  render(<App api={fakeApi()} pollMs={10} />)
  await openProject()
  await userEvent.click(screen.getByRole("button", { name: t("nav.settings") }))
  expect(await screen.findByRole("tablist", { name: t("settings.tabs") })).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("nav.back")) }))
  expect(await screen.findByRole("heading", { name: "0917" })).toBeTruthy()
})


test("after analysis the user plans the outline, confirms it and reaches post-production, the last stage, with the way back and forward again", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await openProject()
  await waitFor(() => expect(screen.getByRole("button", { name: t("prepare.start") })).toHaveProperty("disabled", false))
  await userEvent.click(screen.getByRole("button", { name: t("prepare.start") }))
  await waitFor(() => expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(true))

  act(() => {
    for (const videoId of ["a", "b"]) {
      api.emit({ type: "transcription", folder: "/drafts/0917", videoId, status: { state: "done", fromCache: false, transcript: transcript("x") } })
      api.emit({ type: "vision", folder: "/drafts/0917", videoId, status: { state: "done", fromCache: false, insight: insight("y") } })
    }
    api.emit({ type: "analysis-finished", folder: "/drafts/0917", outcome: "done" })
  })
  await userEvent.click(await screen.findByRole("button", { name: t("prepare.next") }))

  expect(stageChip(t("stage.outline")).getAttribute("aria-current")).toBe("step")
  await userEvent.click(await screen.findByRole("button", { name: t("brief.submit") }))
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })

  await userEvent.click(screen.getByRole("button", { name: t("outline.confirm") }))
  expect(await screen.findByRole("heading", { name: /เปิดเรื่อง/ })).toBeTruthy()
  expect(stageChip(t("stage.post")).getAttribute("aria-current")).toBe("step")
  // the write button is on this page's bar, in the box the page draws its buttons into, and no chip is named for writing
  expect(within(document.querySelector<HTMLElement>(".toolbar-slot")!).getByRole("button", { name: t("timeline.write") })).toBeTruthy()

  // the stages behind are the way back, and the way forward again
  await userEvent.click(stageChip(t("stage.outline")))
  expect(await screen.findByRole("heading", { name: t("brief.title") })).toBeTruthy()
  await userEvent.click(stageChip(t("stage.prepare")))
  expect(await screen.findByRole("heading", { name: "0917" })).toBeTruthy()
  await userEvent.click(stageChip(t("stage.post")))
  expect(await screen.findByRole("heading", { name: /เปิดเรื่อง/ })).toBeTruthy()
})

test("a project written to before offers its backups for restoring, and rechecks the draft afterwards", async () => {
  let restored = false
  const backup = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
  const api = fakeApi({
    listBackups: async () => [backup],
    inspectProject: async () => detail({ timelineSegmentCount: restored ? 3 : 5 }),
    restoreBackup: async () => {
      restored = true
    },
  })
  render(<App api={api} pollMs={10} />)
  await openProject()
  expect(await screen.findByText(t("warn.timelineReplaced", { count: 5 }))).toBeTruthy()

  const date = formatDate(Date.parse(backup.createdAt) * 1000)
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  const row = screen.getByText(t("backups.item", { date, duration: "0:14", count: 3 })).closest("li")!
  await userEvent.click(within(row).getByRole("button", { name: t("backups.restore") }))
  await userEvent.click(within(row).getByRole("button", { name: t("backups.confirm") }))
  expect(api.calls.filter(([name]) => name === "restoreBackup")).toEqual([["restoreBackup", "/drafts/0917", "0917-older"]])
})

test("a project never written to says its backup list is empty", async () => {
  render(<App api={fakeApi()} pollMs={10} />)
  await openProject()
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backups") }))
  expect(screen.getByText(t("backups.empty"))).toBeTruthy()
})

test("without a license the activation screen stands in for the project list", async () => {
  const api = fakeApi({ licenseState: async () => ({ state: "unlicensed" }) })
  render(<App api={api} pollMs={10} />)
  expect(await screen.findByRole("heading", { name: t("activation.title") })).toBeTruthy()
  expect(screen.queryByRole("button", { name: /0917/ })).toBeNull()
  expect(api.calls.some(([name]) => name === "listProjects")).toBe(false)
})

test("a build without licensing opens straight to the projects, and its settings have no License tab", async () => {
  render(<App api={fakeApi({ licenseState: async () => ({ state: "not-required" }) })} pollMs={10} />)
  expect(await screen.findByRole("button", { name: /0917/ })).toBeTruthy()
  expect(screen.queryByRole("heading", { name: t("activation.title") })).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: t("nav.settings") }))
  await screen.findByRole("tablist", { name: t("settings.tabs") })
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).not.toContain(t("settings.tab.license"))
  // back out of settings, the work is open too: a project opens as it would with a license
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("nav.back")) }))
  await openProject()
})

test("activating opens the project list", async () => {
  render(<App api={fakeApi({ licenseState: async () => ({ state: "unlicensed" }) })} pollMs={10} />)
  await userEvent.type(await screen.findByLabelText(t("activation.keyLabel")), "PD2-AAAAA")
  await userEvent.click(screen.getByRole("button", { name: t("activation.submit") }))
  expect(await screen.findByRole("button", { name: /0917/ })).toBeTruthy()
})

test("a license change pushed from the main process takes effect at once", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  act(() => api.emit({ type: "license", state: { state: "blocked", reason: "revoked", license: null } }))
  expect(await screen.findByText(t("activation.blocked.revoked"))).toBeTruthy()
})

test("settings stay reachable without a license", async () => {
  render(<App api={fakeApi({ licenseState: async () => ({ state: "unlicensed" }) })} pollMs={10} />)
  await screen.findByRole("heading", { name: t("activation.title") })
  await userEvent.click(screen.getByRole("button", { name: t("nav.settings") }))
  expect(await screen.findByRole("tablist", { name: t("settings.tabs") })).toBeTruthy()
})

test("working offline, a banner says until when", async () => {
  const until = Date.parse("2026-09-20T10:00:00Z")
  render(<App api={fakeApi({ licenseState: async () => activeLicense({ offline: true, tokenExpiresAt: until }) })} pollMs={10} />)
  expect(await screen.findByText(t("license.offline", { date: formatDate(until * 1000) }))).toBeTruthy()
})

test("a license ending within a week is flagged", async () => {
  const soon = Date.now() + 2 * 86_400_000
  const state = activeLicense()
  const license = state.state === "active" ? { ...state.license, expiresAt: soon } : null
  render(<App api={fakeApi({ licenseState: async () => activeLicense({ license: license! }) })} pollMs={10} />)
  expect(await screen.findByText(t("license.expiresSoon", { date: formatDate(soon * 1000) }))).toBeTruthy()
})

test("a downloaded update offers to restart into the new version", async () => {
  const api = fakeApi({ updateState: async () => ({ state: "ready", version: "0.2.0" }) })
  render(<App api={api} pollMs={10} />)
  await userEvent.click(await screen.findByRole("button", { name: t("update.restart") }))
  expect(screen.getByText(t("update.ready", { version: "0.2.0" }))).toBeTruthy()
  await waitFor(() => expect(api.calls).toContainEqual(["installUpdate"]))
})

test("an update finishing in the background shows up without a restart", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  expect(screen.queryByRole("button", { name: t("update.restart") })).toBeNull()
  act(() => api.emit({ type: "update", state: { state: "ready", version: "0.2.0" } }))
  expect(await screen.findByRole("button", { name: t("update.restart") })).toBeTruthy()
})

test("the open project's name is on the bar, and its backups are one click away from every stage", async () => {
  const api = fakeApi({ listBackups: async () => [backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })] })
  const { container } = render(<App api={api} pollMs={10} />)
  await openProject()
  expect(container.querySelector(".topbar")!.textContent).toContain("0917")
  await userEvent.click(screen.getByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  const date = formatDate(Date.parse("2026-09-17T08:00:00.000Z") * 1000)
  expect(screen.getAllByText(t("backups.item", { date, duration: "0:14", count: 3 })).length).toBeGreaterThan(0)
})

test("the project list carries no project name and no backups", async () => {
  const { container } = render(<App api={fakeApi()} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  expect(container.querySelector(".topbar")!.textContent).toContain(t("app.name"))
  expect(screen.queryByRole("button", { name: t("shell.backups") })).toBeNull()
})

/** Through the stages to post-production, the way a user gets there. */
async function reachPost(api: ReturnType<typeof fakeApi>) {
  render(<App api={api} pollMs={10} />)
  await openProject()
  await waitFor(() => expect(screen.getByRole("button", { name: t("prepare.start") })).toHaveProperty("disabled", false))
  await userEvent.click(screen.getByRole("button", { name: t("prepare.start") }))
  await waitFor(() => expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(true))
  act(() => {
    for (const videoId of ["a", "b"]) {
      api.emit({ type: "transcription", folder: "/drafts/0917", videoId, status: { state: "done", fromCache: false, transcript: transcript("x") } })
      api.emit({ type: "vision", folder: "/drafts/0917", videoId, status: { state: "done", fromCache: false, insight: insight("y") } })
    }
    api.emit({ type: "analysis-finished", folder: "/drafts/0917", outcome: "done" })
  })
  await userEvent.click(await screen.findByRole("button", { name: t("prepare.next") }))
  await userEvent.click(await screen.findByRole("button", { name: t("brief.submit") }))
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  await userEvent.click(screen.getByRole("button", { name: t("outline.confirm") }))
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
}

// the write button is on the post-production page's bar, where the page draws it
const writeButton = () => within(document.querySelector<HTMLElement>(".topbar")!).getByRole("button", { name: t("timeline.write") })
/** The sheet the write button asks in, once the page lets it. */
const openWriteSheet = async () => {
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  await userEvent.click(writeButton())
  return screen.getByRole("dialog", { name: t("write.title", { project: "0917" }) })
}
/** Writes as soon as the page lets it: the button, then เขียนเลย in the sheet it asks in. */
const writeNow = async () => {
  await userEvent.click(within(await openWriteSheet()).getByRole("button", { name: t("write.confirm") }))
}
const backupsPopover = () => screen.getByRole("group", { name: t("backups.title") })

test("a write puts the backup it took in the menu straight away", async () => {
  let written = false
  const backup = backupInfo("0917-2026-09-17T09-00-00-000Z", "2026-09-17T09:00:00.000Z")
  const base = fakeApi()
  const api = fakeApi({
    listBackups: async () => (written ? [backup] : []),
    writeTimeline: async (...args) => {
      written = true
      return base.writeTimeline(...args)
    },
  })
  await reachPost(api)
  expect(screen.getByRole("button", { name: t("shell.backups") })).toBeTruthy()
  await writeNow()
  expect(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) })).toBeTruthy()
})

test("a write that ends while no room of its draft is open to show it is still told, with the project it was for", async () => {
  let fail!: (error: Error) => void
  const api = fakeApi({ writeTimeline: () => new Promise((_, reject) => (fail = reject)) })
  await reachPost(api)
  await writeNow()
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "started" }))
  // in the settings, replacing the renderer pack stops the graphics the write is waiting for
  await userEvent.click(screen.getByRole("button", { name: t("nav.settings") }))
  await screen.findByRole("tablist", { name: t("settings.tabs") })
  const stopped = "the graphics were stopped before they were made; the draft was not changed"
  await act(async () => {
    api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "failed", error: stopped })
    fail(new Error(stopped))
  })
  const told = t("write.away", { project: "0917", message: t("write.failed", { message: stopped }) })
  expect(await screen.findByText(told)).toBeTruthy()
  // the room opened again has nothing running to follow, and says it no second time
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("nav.back")) }))
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(screen.getAllByText(told)).toHaveLength(1)
  expect(screen.queryByText(t("write.failed", { message: stopped }))).toBeNull()
  expect(screen.queryByText(t("error.generic", { message: stopped }))).toBeNull()
})

test("a write that went well is told on the project list too", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await screen.findByRole("heading", { name: t("projects.title") })
  const result = await fakeApi().writeTimeline("/drafts/0815", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result }))
  expect(await screen.findByText(t("write.away", { project: "0815", message: t("write.done", { pieces: 5, duration: "0:12" }) }))).toBeTruthy()
})

test("the toast of a write that ends away from its room has the mascot glad when it went well, and sorry when it failed", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await screen.findByRole("heading", { name: t("projects.title") })
  const poses = () => [...document.querySelectorAll(".toast img.mascot")].map((image) => [image.className, image.getAttribute("alt")])
  const result = await fakeApi().writeTimeline("/drafts/0815", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result }))
  await waitFor(() => expect(poses()).toEqual([["mascot mascot-done", ""]]))
  cleanup()

  const failing = fakeApi()
  render(<App api={failing} pollMs={10} />)
  await screen.findByRole("heading", { name: t("projects.title") })
  act(() => failing.emit({ type: "timeline-write", folder: "/drafts/0815", state: "failed", error: "CapCut is running" }))
  await waitFor(() => expect(poses()).toEqual([["mascot mascot-oops", ""]]))
})

test("a write that ends while no room of its draft is open tells what it left out too, and stays as long as those notes take to read", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  const plain = await fakeApi().writeTimeline("/drafts/0815", settingsView().cut, 0, null, null)
  const result = { ...plain, dropped: { ...plain.dropped, sounds: 1 }, zoomsLost: 1, proLeftOut: { exits: 0, sounds: 2 } }
  const told = t("write.away", {
    project: "0815",
    message: [
      t("write.done", { pieces: 5, duration: "0:12" }),
      t("write.resultDropped", { what: t("flair.sound"), count: 1 }),
      t("write.zoomsLost", { count: 1 }),
      t("write.proLeftOut", { exits: 0, sounds: 2 }),
    ].join(" · "),
  })
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result }))
  expect(screen.getByText(told)).toBeTruthy()
  // more to read than the count, so it stays as long as the room's own toast does for the same
  act(() => vi.advanceTimersByTime(11_999))
  expect(screen.getByText(told)).toBeTruthy()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.queryByText(told)).toBeNull()
})

test("a write that ends while its own room is open is told there once, and not again by the app", async () => {
  const api = fakeApi()
  await reachPost(api)
  await writeNow()
  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  act(() => {
    api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "started" })
    api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result })
  })
  // the room tells it by a toast of its own
  const done = t("write.done", { pieces: 5, duration: "0:12" })
  expect(await screen.findByText(done)).toBeTruthy()
  expect(screen.getAllByText(done)).toHaveLength(1)
  expect(screen.queryByText(t("write.away", { project: "0917", message: done }))).toBeNull()
  // another project's write has no room open here: the app tells it
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result }))
  expect(await screen.findByText(t("write.away", { project: "0815", message: done }))).toBeTruthy()
})

test("writes that end together while no room of theirs is open are told one after the other, neither lost to the other", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  const result = await fakeApi().writeTimeline("/drafts/0815", settingsView().cut, 0, null, null)
  const stopped = "the graphics were stopped before they were made; the draft was not changed"
  const failed = t("write.away", { project: "0917", message: t("write.failed", { message: stopped }) })
  const done = t("write.away", { project: "0815", message: t("write.done", { pieces: 5, duration: "0:12" }) })
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  act(() => {
    api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "failed", error: stopped })
    api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result })
  })
  expect(screen.getByText(failed)).toBeTruthy()
  expect(screen.queryByText(done)).toBeNull()
  // a failure asks the user to write again, so it stays up as long as that takes to read
  act(() => vi.advanceTimersByTime(12_000))
  expect(screen.queryByText(failed)).toBeNull()
  expect(screen.getByText(done)).toBeTruthy()
  act(() => vi.advanceTimersByTime(6_000))
  expect(screen.queryByText(done)).toBeNull()
})

test("while a write runs its draft's backups cannot be put back, in the room or away from it", async () => {
  const backup = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
  const api = fakeApi({ listBackups: async () => [backup], writeTimeline: () => new Promise(() => {}) })
  await reachPost(api)
  await writeNow()
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "started" }))
  const restore = () => within(backupsPopover()).getByRole("button", { name: t("backups.restore") })
  await userEvent.click(screen.getByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  expect(restore()).toHaveProperty("disabled", true)
  expect(within(backupsPopover()).getByText(t("backups.writing"))).toBeTruthy()

  // the write goes on while the user is at another stage of the same project
  await userEvent.click(stageChip(t("stage.prepare")))
  await screen.findByRole("heading", { name: "0917" })
  await userEvent.click(screen.getByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  expect(restore()).toHaveProperty("disabled", true)

  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result }))
  expect(restore()).toHaveProperty("disabled", false)
  expect(screen.queryByText(t("backups.writing"))).toBeNull()
})

/** Both videos read by a run that is over, as the first stage finds them when it opens. */
const readEarlier = () => ({
  folder: "/drafts/0917",
  running: false as const,
  outcome: "done" as const,
  error: null,
  transcription: Object.fromEntries(["a", "b"].map((id) => [id, { state: "done" as const, fromCache: true, transcript: transcript("x") }])),
  vision: Object.fromEntries(["a", "b"].map((id) => [id, { state: "done" as const, fromCache: true, insight: insight("y") }])),
})

test("while a write runs the outline cannot be reached, so no change to it is saved and left out of the write", async () => {
  // once through, the reading of both videos is over, which the first stage finds on the way back in
  let read = false
  const api = fakeApi({
    writeTimeline: () => new Promise(() => {}),
    analysisState: async () => (read ? readEarlier() : null),
  })
  await reachPost(api)
  read = true
  await writeNow()
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "started" }))
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", true)
  expect(stageChip(t("stage.outline")).getAttribute("title")).toBe(t("edit.ai.writing"))

  // nor by way of the first stage
  await userEvent.click(stageChip(t("stage.prepare")))
  const next = await screen.findByRole("button", { name: t("prepare.next") })
  expect(next).toHaveProperty("disabled", true)
  expect(screen.getByText(t("edit.ai.writing"))).toBeTruthy()

  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result }))
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", false)
  expect(stageChip(t("stage.outline")).getAttribute("title")).toBeNull()
  expect(next).toHaveProperty("disabled", false)
  expect(screen.queryByText(t("edit.ai.writing"))).toBeNull()
})

test("while Claude plans the project the outline cannot be reached, so no beat changed or outline made again lands in the middle of the run", async () => {
  let read = false
  const api = fakeApi({ analysisState: async () => (read ? readEarlier() : null) })
  await reachPost(api)
  read = true
  // another project's run leaves this one's outline open
  act(() => api.emit({ type: "post-plan", folder: "/drafts/0815", work: "emphasis", state: { state: "running" } }))
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", false)
  act(() => api.emit({ type: "post-plan", folder: "/drafts/0917", work: "emphasis", state: { state: "running" } }))
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", true)
  expect(stageChip(t("stage.outline")).getAttribute("title")).toBe(t("edit.ai.planning"))

  // nor by way of the first stage
  await userEvent.click(stageChip(t("stage.prepare")))
  const next = await screen.findByRole("button", { name: t("prepare.next") })
  expect(next).toHaveProperty("disabled", true)
  expect(screen.getByText(t("edit.ai.planning"))).toBeTruthy()

  // another project's run ending changes nothing here; this one's end opens the way again, though a run of the other starts meanwhile
  act(() => api.emit({ type: "post-plan-finished", folder: "/drafts/0815" }))
  expect(next).toHaveProperty("disabled", true)
  act(() => api.emit({ type: "post-plan", folder: "/drafts/0815", work: "text", state: { state: "running" } }))
  act(() => api.emit({ type: "post-plan-finished", folder: "/drafts/0917" }))
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", false)
  expect(stageChip(t("stage.outline")).getAttribute("title")).toBeNull()
  expect(next).toHaveProperty("disabled", false)
  expect(screen.queryByText(t("edit.ai.planning"))).toBeNull()
})

test("a window reloaded while Claude plans the project knows of it once the project is opened again", async () => {
  const api = fakeApi({ postPlanState: async () => ({ running: true, states: {} }), analysisState: async () => readEarlier() })
  render(<App api={api} pollMs={10} />)
  await openProject()
  const next = await screen.findByRole("button", { name: t("prepare.next") })
  await waitFor(() => expect(next).toHaveProperty("disabled", true))
  expect(stageChip(t("stage.outline")).getAttribute("title")).toBe(t("edit.ai.planning"))
  expect(api.calls).toContainEqual(["postPlanState", "/drafts/0917"])
  act(() => api.emit({ type: "post-plan-finished", folder: "/drafts/0917" }))
  expect(next).toHaveProperty("disabled", false)
})

test("a plan run that ends while the app is still asking about it is over, whatever the late answer says; another project's ending leaves the answer standing", async () => {
  for (const [ended, shut] of [
    ["/drafts/0917", false],
    ["/drafts/0815", true],
  ] as const) {
    let answer!: (run: { running: boolean; states: Record<string, never> }) => void
    const api = fakeApi({ postPlanState: () => new Promise((resolve) => (answer = resolve)), analysisState: async () => readEarlier() })
    render(<App api={api} pollMs={10} />)
    await openProject()
    const next = await screen.findByRole("button", { name: t("prepare.next") })
    await waitFor(() => expect(api.calls).toContainEqual(["postPlanState", "/drafts/0917"]))
    act(() => api.emit({ type: "post-plan-finished", folder: ended }))
    await act(async () => answer({ running: true, states: {} }))
    expect(next).toHaveProperty("disabled", shut)
    cleanup()
  }
})

test("a window reloaded while a write runs knows of it once the project is opened again", async () => {
  const backup = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
  const api = fakeApi({ writingTimeline: async () => true, listBackups: async () => [backup], analysisState: async () => readEarlier() })
  render(<App api={api} pollMs={10} />)
  await openProject()
  const next = await screen.findByRole("button", { name: t("prepare.next") })
  await waitFor(() => expect(next).toHaveProperty("disabled", true))
  expect(stageChip(t("stage.outline"))).toHaveProperty("disabled", true)
  expect(stageChip(t("stage.outline")).getAttribute("title")).toBe(t("edit.ai.writing"))
  await userEvent.click(screen.getByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  const restore = screen.getByRole("button", { name: t("backups.restore") })
  expect(restore).toHaveProperty("disabled", true)

  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result }))
  expect(next).toHaveProperty("disabled", false)
  expect(restore).toHaveProperty("disabled", false)
})

test("a write that ends while the app is still asking about it is over, whatever the late answer says", async () => {
  let answer!: (writing: boolean) => void
  const backup = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
  const api = fakeApi({ writingTimeline: () => new Promise<boolean>((resolve) => (answer = resolve)), listBackups: async () => [backup] })
  render(<App api={api} pollMs={10} />)
  await openProject()
  await waitFor(() => expect(api.calls).toContainEqual(["writingTimeline", "/drafts/0917"]))
  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result }))
  await act(async () => answer(true))
  await userEvent.click(screen.getByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  expect(screen.getByRole("button", { name: t("backups.restore") })).toHaveProperty("disabled", false)
})

test("another project's write ending while the app is still asking about this one's leaves the answer standing", async () => {
  let answer!: (writing: boolean) => void
  const backup = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
  const api = fakeApi({ writingTimeline: () => new Promise<boolean>((resolve) => (answer = resolve)), listBackups: async () => [backup] })
  render(<App api={api} pollMs={10} />)
  await openProject()
  await waitFor(() => expect(api.calls).toContainEqual(["writingTimeline", "/drafts/0917"]))
  const result = await fakeApi().writeTimeline("/drafts/0815", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result }))
  await act(async () => answer(true))
  await userEvent.click(screen.getByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  expect(screen.getByRole("button", { name: t("backups.restore") })).toHaveProperty("disabled", true)
  expect(screen.getByText(t("backups.writing"))).toBeTruthy()
})

test("an answer about a project the user has since left for another counts for nothing, even once they are back", async () => {
  const asked: { folder: string; answer: (writing: boolean) => void }[] = []
  const backup = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
  const api = fakeApi({
    inspectProject: async (folder) => detail({ name: folder.split("/").pop()!, folder }),
    writingTimeline: (folder) => new Promise<boolean>((resolve) => asked.push({ folder, answer: resolve })),
    listBackups: async () => [backup],
  })
  render(<App api={api} pollMs={10} />)
  await openProject()
  // the user goes on to another project before the app has heard back about this one
  await userEvent.click(backToProjects())
  await openProject("0815")
  await waitFor(() => expect(asked.map(({ folder }) => folder)).toEqual(["/drafts/0917", "/drafts/0815"]))
  // the first project's write ends, and only then does the answer about it come
  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result }))
  await act(async () => asked[0]!.answer(true))

  await userEvent.click(backToProjects())
  await openProject()
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  expect(screen.getByRole("button", { name: t("backups.restore") })).toHaveProperty("disabled", false)
  expect(screen.queryByText(t("backups.writing"))).toBeNull()
})

test("a write that starts while no room of its project is open is not told: only its end is", async () => {
  const api = fakeApi()
  render(<App api={api} pollMs={10} />)
  await screen.findByRole("button", { name: /0917/ })
  const toasts = () => within(document.querySelector<HTMLElement>(".toasts")!).queryAllByRole("status").map((toast) => toast.textContent)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "started" }))
  expect(screen.getByRole("heading", { name: t("projects.title") })).toBeTruthy()
  expect(toasts()).toEqual([])
  const result = await fakeApi().writeTimeline("/drafts/0815", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result }))
  expect(toasts()).toEqual([t("write.away", { project: "0815", message: t("write.done", { pieces: 5, duration: "0:12" }) })])
})

test("a write that ends puts its backup in the menu, even with no room of the project left to say so", async () => {
  let written = false
  const backup = backupInfo("0917-2026-09-17T09-00-00-000Z", "2026-09-17T09:00:00.000Z")
  const api = fakeApi({ listBackups: async () => (written ? [backup] : []) })
  render(<App api={api} pollMs={10} />)
  await openProject()
  await screen.findByRole("button", { name: t("shell.backups") })
  written = true
  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result }))
  expect(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) })).toBeTruthy()
})

test("the room's own toast and one for another project's write sit one above the other, not on the same spot", async () => {
  let answer!: (result: WriteResult) => void
  const api = fakeApi({ writeTimeline: () => new Promise<WriteResult>((resolve) => (answer = resolve)) })
  await reachPost(api)
  await writeNow()
  // the room, still open, tells its end
  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  await act(async () => answer(result))
  const done = t("write.done", { pieces: 5, duration: "0:12" })
  const stack = document.querySelector<HTMLElement>(".toasts")
  expect(stack).not.toBeNull()
  await waitFor(() => expect(within(stack!).getAllByRole("status").map((toast) => toast.textContent)).toEqual([done]))
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result }))
  expect(within(stack!).getAllByRole("status").map((toast) => toast.textContent)).toEqual([done, t("write.away", { project: "0815", message: done })])
})

test("a room opened again before its write ends tells the end itself, once, and the app says nothing more", async () => {
  let running = false
  let answer!: (result: WriteResult) => void
  const api = fakeApi({
    writeTimeline: () => {
      running = true
      return new Promise<WriteResult>((resolve) => (answer = resolve))
    },
    writingTimeline: async () => running,
  })
  await reachPost(api)
  await writeNow()
  act(() => api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "started" }))
  await userEvent.click(screen.getByRole("button", { name: t("nav.settings") }))
  await screen.findByRole("tablist", { name: t("settings.tabs") })
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("nav.back")) }))
  expect(await screen.findByRole("button", { name: t("write.writing") })).toHaveProperty("disabled", true)

  const result = await fakeApi().writeTimeline("/drafts/0917", settingsView().cut, 0, null, null)
  running = false
  await act(async () => {
    api.emit({ type: "timeline-write", folder: "/drafts/0917", state: "done", result })
    answer(result)
  })
  const told = t("write.done", { pieces: 5, duration: "0:12" })
  expect(await screen.findByText(told)).toBeTruthy()
  expect(screen.getAllByText(told)).toHaveLength(1)
  expect(screen.queryByText(t("write.away", { project: "0917", message: told }))).toBeNull()
})

test("a restore from the bar rereads the draft, so the next write replaces what is there now", async () => {
  let restored = false
  const backup = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
  const api = fakeApi({
    listBackups: async () => [backup],
    inspectProject: async () => detail({ timelineSegmentCount: restored ? 3 : 5 }),
    restoreBackup: async () => {
      restored = true
    },
  })
  await reachPost(api)
  // the sheet the write button asks in says how many pieces the write replaces
  const before = await openWriteSheet()
  expect(await within(before).findByText(t("warn.timelineReplaced", { count: 5 }))).toBeTruthy()
  await userEvent.click(within(before).getByRole("button", { name: t("write.cancel") }))
  await userEvent.click(screen.getByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  const date = formatDate(Date.parse(backup.createdAt) * 1000)
  const row = within(backupsPopover()).getByText(t("backups.item", { date, duration: "0:14", count: 3 })).closest("li")!
  await userEvent.click(within(row).getByRole("button", { name: t("backups.restore") }))
  await userEvent.click(within(row).getByRole("button", { name: t("backups.confirm") }))
  await waitFor(() => expect(api.calls).toContainEqual(["restoreBackup", "/drafts/0917", "0917-older"]))
  const after = await openWriteSheet()
  expect(await within(after).findByText(t("warn.timelineReplaced", { count: 3 }))).toBeTruthy()
  await userEvent.click(within(after).getByRole("button", { name: t("write.confirm") }))
  await waitFor(() => expect(api.calls.filter(([name]) => name === "writeTimeline")).toHaveLength(1))
  expect(api.calls.find(([name]) => name === "writeTimeline")![3]).toBe(3)
})

test("an outline changed after it was confirmed must be confirmed again before post-production opens", async () => {
  // the outline main keeps: whatever was saved last
  let saved: StoredOutline | null = null
  const base = fakeApi()
  const api = fakeApi({
    getOutline: async () => saved,
    saveOutlineEdits: async (folder, beatIds, confirmed) => (saved = await base.saveOutlineEdits(folder, beatIds, confirmed)),
  })
  await reachPost(api)
  expect(stageChip(t("stage.post"))).toHaveProperty("disabled", false)
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("edit.editOutline")) }))
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  await userEvent.click(screen.getAllByRole("button", { name: t("outline.remove") })[0]!)
  await waitFor(() => expect(stageChip(t("stage.post"))).toHaveProperty("disabled", true))
  // confirming it again opens the way
  await userEvent.click(screen.getByRole("button", { name: t("outline.confirm") }))
  await waitFor(() => expect(stageChip(t("stage.post")).getAttribute("aria-current")).toBe("step"))
  expect(stageChip(t("stage.post"))).toHaveProperty("disabled", false)
})

test("a new outline that lands after the user went on to post-production takes them back to confirm it", async () => {
  let saved: StoredOutline | null = null
  let finish!: (stored: StoredOutline) => void
  const base = fakeApi()
  const api = fakeApi({
    getOutline: async () => saved,
    saveOutlineEdits: async (folder, beatIds, confirmed) => (saved = await base.saveOutlineEdits(folder, beatIds, confirmed)),
    regenerateOutline: () => new Promise((resolve) => (finish = resolve)),
  })
  await reachPost(api)
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("edit.editOutline")) }))
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  await userEvent.click(screen.getByRole("button", { name: t("outline.replan") }))
  // while Claude plans, the old outline is still the confirmed one: the user goes back to it
  await userEvent.click(stageChip(t("stage.post")))
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  const next = { ...saved!, confirmed: false, outline: { ...saved!.outline, title: "ฉบับใหม่" } }
  saved = next
  act(() => finish(next))
  expect(await screen.findByRole("heading", { name: "ฉบับใหม่" })).toBeTruthy()
  expect(stageChip(t("stage.post"))).toHaveProperty("disabled", true)
})

test("the bar's box for the page's buttons is empty away from post-production, and holds exactly one write button back on it", async () => {
  await reachPost(fakeApi())
  const slot = () => document.querySelector<HTMLElement>(".toolbar-slot")!
  const writeButtons = () => within(slot()).queryAllByRole("button", { name: t("timeline.write") })
  expect(writeButtons()).toHaveLength(1)
  expect(slot().querySelectorAll(".ai-menu")).toHaveLength(1)

  await userEvent.click(stageChip(t("stage.outline")))
  await waitFor(() => expect(stageChip(t("stage.outline")).getAttribute("aria-current")).toBe("step"))
  expect(screen.queryByRole("heading", { name: /เปิดเรื่อง/ })).toBeNull()
  // nothing of the page is left on the bar
  expect(slot().children).toHaveLength(0)

  await userEvent.click(stageChip(t("stage.post")))
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  expect(writeButtons()).toHaveLength(1)
  expect(slot().querySelectorAll(".ai-menu")).toHaveLength(1)
})
