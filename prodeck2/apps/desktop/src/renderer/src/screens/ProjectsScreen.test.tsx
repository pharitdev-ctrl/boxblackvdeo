import { afterEach, expect, test } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { fakeApi, summary } from "../../test/fake-api.ts"
import { formatDate, formatDay } from "../format.ts"
import { t } from "../i18n.ts"
import { ProjectsScreen } from "./ProjectsScreen.tsx"

afterEach(cleanup)

const PROJECTS = [
  summary("0917", { coverPath: "/covers/0917.jpg", durationUs: 31_106_000 }),
  summary("รีวิวเล็บ", { durationUs: 44_000_000 }),
  summary("vlog ร้านใหม่", { durationUs: 120_000_000 }),
]

function renderScreen(overrides: Parameters<typeof fakeApi>[0] = {}) {
  const opened: string[] = []
  const api = fakeApi({ listProjects: async () => ({ root: "/drafts", projects: PROJECTS, stages: {} }), readCover: async () => "data:image/jpeg;base64,x", ...overrides })
  render(<ProjectsScreen api={api} onOpen={(folder) => opened.push(folder)} />)
  return { api, opened }
}

test("each project is a card with its cover, length and when it was last touched", async () => {
  renderScreen()
  const card = await screen.findByRole("button", { name: /0917/ })
  expect(within(card).getByText("0:31")).toBeTruthy()
  expect(within(card).getByText(formatDate(PROJECTS[0]!.modifiedUs))).toBeTruthy()
  await waitFor(() => expect(within(card).getByRole("presentation")).toBeTruthy())
  expect(screen.getByText(new RegExp(t("projects.count", { count: 3 })))).toBeTruthy()
})

test("a project CapCut has made no cover for says so instead of showing a hole", async () => {
  renderScreen()
  const card = await screen.findByRole("button", { name: /vlog/ })
  expect(within(card).getByText(t("projects.noCover"))).toBeTruthy()
})

test("opening a card hands back its folder", async () => {
  const { opened } = renderScreen()
  await userEvent.click(await screen.findByRole("button", { name: /0917/ }))
  expect(opened).toEqual(["/drafts/0917"])
})

test("searching narrows the list to what matches, and says when nothing does", async () => {
  renderScreen()
  await screen.findByRole("button", { name: /0917/ })
  const box = screen.getByRole("searchbox", { name: t("projects.search") })
  await userEvent.type(box, "เล็บ")
  expect(screen.getByRole("button", { name: /รีวิวเล็บ/ })).toBeTruthy()
  expect(screen.queryByRole("button", { name: /0917/ })).toBeNull()

  // stray spaces and the wrong case still find it
  await userEvent.clear(box)
  await userEvent.type(box, " VLOG ")
  expect(screen.getByRole("button", { name: /vlog/ })).toBeTruthy()
  expect(screen.queryByRole("button", { name: /0917/ })).toBeNull()

  await userEvent.clear(box)
  await userEvent.type(box, "ไม่มีจริง")
  expect(screen.getByText(t("projects.noMatch", { text: "ไม่มีจริง" }))).toBeTruthy()
})

test("the list is read again when the window comes back to the front", async () => {
  let calls = 0
  const api = fakeApi({
    listProjects: async () => {
      calls += 1
      return { root: "/drafts", projects: calls === 1 ? [summary("0917")] : [summary("0917"), summary("0920")], stages: {} }
    },
  })
  render(<ProjectsScreen api={api} onOpen={() => {}} />)
  await screen.findByRole("button", { name: /0917/ })
  window.dispatchEvent(new Event("focus"))
  expect(await screen.findByRole("button", { name: /0920/ })).toBeTruthy()
})

test("no CapCut folder, and no projects in it, each say what to do", async () => {
  renderScreen({ listProjects: async () => ({ root: null, projects: [], stages: {} }) })
  expect(await screen.findByText(t("projects.rootMissing"))).toBeTruthy()

  cleanup()
  renderScreen({ listProjects: async () => ({ root: "/drafts", projects: [], stages: {} }) })
  expect(await screen.findByText(t("projects.empty"))).toBeTruthy()
})

test("a folder that cannot be read reports why", async () => {
  renderScreen({
    listProjects: async () => {
      throw new Error("permission denied")
    },
  })
  expect(await screen.findByText(t("error.generic", { message: "permission denied" }))).toBeTruthy()
})

test("a card says how far the app got with that project, and when", async () => {
  renderScreen({
    listProjects: async () => ({
      root: "/drafts",
      projects: PROJECTS,
      stages: {
        "/drafts/0917": { stage: "confirmed" as const, at: 1_700_000_000_000 },
        "/drafts/รีวิวเล็บ": { stage: "analysed" as const, at: 1_700_000_000_000 },
      },
    }),
  })
  const done = await screen.findByRole("button", { name: /0917/ })
  expect(within(done).getByText(t("projects.stage.confirmed"))).toBeTruthy()
  expect(within(done).getByText(formatDay(1_700_000_000_000 * 1000))).toBeTruthy()

  const read = screen.getByRole("button", { name: /รีวิวเล็บ/ })
  expect(within(read).getByText(t("projects.stage.analysed"))).toBeTruthy()

  // a project nothing has been done to says nothing rather than saying "not started"
  const untouched = screen.getByRole("button", { name: /vlog/ })
  expect(within(untouched).queryByText(t("projects.stage.analysed"))).toBeNull()
  expect(within(untouched).queryByText(t("projects.stage.outline"))).toBeNull()
  expect(within(untouched).queryByText(t("projects.stage.confirmed"))).toBeNull()
})

test("a project with an outline waiting says so", async () => {
  renderScreen({
    listProjects: async () => ({ root: "/drafts", projects: PROJECTS, stages: { "/drafts/0917": { stage: "outline" as const, at: 1_700_000_000_000 } } }),
  })
  const card = await screen.findByRole("button", { name: /0917/ })
  expect(within(card).getByText(t("projects.stage.outline"))).toBeTruthy()
})
