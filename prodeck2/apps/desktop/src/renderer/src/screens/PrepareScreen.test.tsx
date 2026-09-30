import { afterEach, expect, test } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { AppEvent, ProjectDetail, RendererApi } from "../../../shared/api.ts"
import { detail, fakeApi, insight, settingsView, transcript } from "../../test/fake-api.ts"
import { t } from "../i18n.ts"
import { PrepareScreen } from "./PrepareScreen.tsx"

afterEach(cleanup)

const FOLDER = "/drafts/0917"

function renderScreen(overrides: Partial<RendererApi> = {}, capcut = { running: false }) {
  const api = fakeApi(overrides, capcut)
  let settings = 0
  const next: { project: ProjectDetail; videoIds: string[] }[] = []
  render(
    <PrepareScreen
      api={api}
      folder={FOLDER}
      capcutRunning={!capcut.running ? false : true}
      onOpenSettings={() => (settings += 1)}
      onNext={(project, videoIds) => next.push({ project, videoIds })}
    />,
  )
  return { api, next, settings: () => settings }
}

const push = (api: ReturnType<typeof fakeApi>, event: AppEvent) => act(() => api.emit(event))
const done = (api: ReturnType<typeof fakeApi>, videoId: string) => {
  push(api, { type: "transcription", folder: FOLDER, videoId, status: { state: "done", fromCache: false, transcript: transcript("เอาล่ะครับ") } })
  push(api, { type: "vision", folder: FOLDER, videoId, status: { state: "done", fromCache: false, insight: insight("ชายหนุ่มพูดหน้ากล้อง") } })
}
const start = () => screen.getByRole("button", { name: t("prepare.start") })

test("the project's videos are listed, ticked, with length and size", async () => {
  renderScreen()
  const intro = await screen.findByRole("checkbox", { name: /intro\.mov/ })
  expect(intro).toHaveProperty("checked", true)
  const row = intro.closest("li")!
  expect(within(row).getByText("0:31")).toBeTruthy()
  expect(within(row).getByText("1080×1920")).toBeTruthy()
})

test("a video whose file is gone is flagged and cannot be used", async () => {
  const videos = detail().videos.map((video) => (video.id === "b" ? { ...video, exists: false } : video))
  renderScreen({ inspectProject: async () => detail({ videos }) })
  const broll = await screen.findByRole("checkbox", { name: /broll\.mp4/ })
  expect(broll).toHaveProperty("checked", false)
  expect(broll).toHaveProperty("disabled", true)
  expect(screen.getByText(t("warn.missingFiles", { count: 1 }))).toBeTruthy()
})

test("what is ticked drives the summary and the estimate", async () => {
  renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  expect(screen.getByText(t("detail.selectedSummary", { selected: 2, total: 2, duration: "0:41" }))).toBeTruthy()
  expect(screen.getByText(t("detail.estimate", { frames: 15, tokens: "8,783" }))).toBeTruthy()

  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  expect(screen.getByText(t("detail.selectedSummary", { selected: 1, total: 2, duration: "0:31" }))).toBeTruthy()
  expect(screen.getByText(t("detail.estimate", { frames: 11, tokens: "5,163" }))).toBeTruthy()
})

test("the estimate counts only what still has to be read: a video read before costs nothing again", async () => {
  renderScreen({ analysedVideos: async () => ["a"] })
  await screen.findByText(t("detail.estimate", { frames: 4, tokens: "3,620" }))
})

test("the estimate counts Claude comparing the lines said twice: exactly for a video whose speech is read, at the usual rate for one not read yet", async () => {
  // intro.mov's speech is read: two lines said twice, compared on 12 pictures; broll.mp4 is too short to expect one
  renderScreen({ knownRetakes: async () => ({ a: { reviews: 2, frames: 12 } }) })
  await screen.findByText(t("detail.estimateRetakes", { frames: 15 + 12, reviews: 2, tokens: "15,343" }))
  cleanup()

  // 23 minutes not read yet: about one every 70 s
  const long = detail().videos.map((video) => (video.id === "a" ? { ...video, durationUs: 1_374_000_000 } : video))
  renderScreen({ inspectProject: async () => detail({ videos: [long[0]!] }) })
  await screen.findByText(t("detail.estimateRetakes", { frames: 120 + 140, reviews: 20, tokens: "136,220" }))
})

test("with nothing ticked, or CapCut open, the work cannot start", async () => {
  renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(screen.getByRole("checkbox", { name: /intro\.mov/ }))
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  expect(start()).toHaveProperty("disabled", true)

  cleanup()
  renderScreen({}, { running: true })
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  expect(start()).toHaveProperty("disabled", true)
  expect(screen.getByText(t("gate.startBlocked"))).toBeTruthy()
})

test("starting asks for the ticked videos and fills the rows in place", async () => {
  const { api } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  await userEvent.click(start())
  await waitFor(() => expect(api.calls).toContainEqual(["startAnalysis", FOLDER, ["a"]]))

  push(api, { type: "transcription", folder: FOLDER, videoId: "a", status: { state: "transcribing", progress: 0.45 } })
  const row = screen.getByRole("checkbox", { name: /intro\.mov/ }).closest("li")!
  expect(within(row).getByText(t("analyze.transcribing", { percent: 45 }))).toBeTruthy()
  expect(within(row).getByRole("progressbar", { name: t("analyze.audioLabel") }).getAttribute("aria-valuenow")).toBe("45")
  // the video that was not asked for shows no progress at all
  expect(within(screen.getByRole("checkbox", { name: /broll\.mp4/ }).closest("li")!).queryByRole("progressbar")).toBeNull()
})

test("when a video is read, what was read can be looked at", async () => {
  const { api } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  await waitFor(() => expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(true))
  done(api, "a")

  const row = screen.getByRole("checkbox", { name: /intro\.mov/ }).closest("li")!
  expect(within(row).getByText(t("analyze.done", { words: 1 }))).toBeTruthy()
  expect(within(row).getByText(t("analyze.visionDone", { scenes: 1 }))).toBeTruthy()
  await userEvent.click(within(row).getByRole("button", { name: t("prepare.peek") }))
  expect(screen.getByText("เอาล่ะครับ")).toBeTruthy()
  expect(screen.getByText("ชายหนุ่มพูดหน้ากล้อง")).toBeTruthy()
})

test("a machine that is not set up sends the user to settings instead of starting", async () => {
  const { api, settings } = renderScreen({ getSettings: async () => settingsView({ readiness: { problems: ["model-missing"] } }) })
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  expect(await screen.findByText(new RegExp(t("problem.model-missing")))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("analyze.openSettings") }))
  expect(settings()).toBe(1)
  expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(false)
})

test("a run can be cancelled and started again", async () => {
  const { api } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  await waitFor(() => expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(true))
  await userEvent.click(screen.getByRole("button", { name: t("prepare.cancel") }))
  expect(api.calls).toContainEqual(["cancelAnalysis"])

  push(api, { type: "analysis-finished", folder: FOLDER, outcome: "cancelled" })
  expect(screen.getByText(t("analyze.cancelled"))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("prepare.restart") }))
  await waitFor(() => expect(api.calls.filter(([name]) => name === "startAnalysis")).toHaveLength(2))
})

test("a video that failed offers another go, and blocks the next stage", async () => {
  const { api } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  await waitFor(() => expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(true))
  done(api, "a")
  push(api, { type: "transcription", folder: FOLDER, videoId: "b", status: { state: "failed", error: "ffmpeg ล้ม" } })
  push(api, { type: "analysis-finished", folder: FOLDER, outcome: "done" })

  expect(screen.getByText(t("analyze.failed", { message: "ffmpeg ล้ม" }))).toBeTruthy()
  expect(screen.queryByRole("button", { name: t("prepare.next") })).toBeNull()
  expect(screen.getByRole("button", { name: t("prepare.retry") })).toBeTruthy()
})

test("starting again after a cancel reads what is ticked now", async () => {
  const { api } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  await waitFor(() => expect(api.calls).toContainEqual(["startAnalysis", FOLDER, ["a", "b"]]))
  push(api, { type: "analysis-finished", folder: FOLDER, outcome: "cancelled" })
  // the user takes the long one out before starting again
  await userEvent.click(screen.getByRole("checkbox", { name: /intro\.mov/ }))
  await userEvent.click(screen.getByRole("button", { name: t("prepare.restart") }))
  await waitFor(() => expect(api.calls.filter(([name]) => name === "startAnalysis").at(-1)).toEqual(["startAnalysis", FOLDER, ["b"]]))
})

test("a video that failed can be left out, and the rest goes on to the outline", async () => {
  const { api, next } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  await waitFor(() => expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(true))
  done(api, "a")
  push(api, { type: "transcription", folder: FOLDER, videoId: "b", status: { state: "failed", error: "ffmpeg ล้ม" } })
  push(api, { type: "analysis-finished", folder: FOLDER, outcome: "done" })
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  expect(screen.queryByRole("button", { name: t("prepare.retry") })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: t("prepare.next") }))
  expect(next.map((entry) => entry.videoIds)).toEqual([["a"]])
})

test("a clean run hands the ticked videos to the next stage", async () => {
  const { api, next } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  await waitFor(() => expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(true))
  done(api, "a")
  done(api, "b")
  push(api, { type: "analysis-finished", folder: FOLDER, outcome: "done" })

  expect(screen.getByText(t("analyze.allDone", { count: 2 }))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("prepare.next") }))
  expect(next).toHaveLength(1)
  expect(next[0]!.videoIds).toEqual(["a", "b"])
  expect(next[0]!.project.folder).toBe(FOLDER)
})

test("a run already going for this project is picked up on the way back in", async () => {
  const { api } = renderScreen({
    analysisState: async () => ({
      folder: FOLDER,
      running: true,
      outcome: null,
      error: null,
      transcription: { a: { state: "transcribing", progress: 0.3 } },
      vision: { a: { state: "queued" } },
    }),
  })
  const row = (await screen.findByRole("checkbox", { name: /intro\.mov/ })).closest("li")!
  expect(await within(row).findByText(t("analyze.transcribing", { percent: 30 }))).toBeTruthy()
  expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(false)
  expect(screen.getByRole("button", { name: t("prepare.cancel") })).toBeTruthy()
})

const finishedForA = {
  analysisState: async () => ({
    folder: FOLDER,
    running: false as const,
    outcome: "done" as const,
    error: null,
    transcription: { a: { state: "done" as const, fromCache: true, transcript: transcript("เอาล่ะครับ") } },
    vision: { a: { state: "done" as const, fromCache: true, insight: insight("ชายหนุ่มพูดหน้ากล้อง") } },
  }),
}

test("a run that finished while the user was away is still finished on the way back in", async () => {
  const { api, next } = renderScreen(finishedForA)
  expect(await screen.findByText(t("analyze.allDone", { count: 1 }))).toBeTruthy()
  const row = screen.getByRole("checkbox", { name: /intro\.mov/ }).closest("li")!
  expect(within(row).getByText(t("analyze.doneCached", { words: 1 }))).toBeTruthy()
  expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(false)
  // broll was never read, so with only intro ticked the story can be planned
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  expect(screen.queryByRole("button", { name: t("prepare.start") })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: t("prepare.next") }))
  expect(next[0]!.videoIds).toEqual(["a"])
})

test("a video the finished run did not read can still be read, without leaving and coming back", async () => {
  const { api } = renderScreen(finishedForA)
  await screen.findByText(t("analyze.allDone", { count: 1 }))
  expect(screen.queryByRole("button", { name: t("prepare.next") })).toBeNull()
  await userEvent.click(start())
  await waitFor(() => expect(api.calls).toContainEqual(["startAnalysis", FOLDER, ["a", "b"]]))
})

test("ticking a video after a run finished brings the start back for it", async () => {
  const { api, next } = renderScreen()
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  await userEvent.click(start())
  await waitFor(() => expect(api.calls).toContainEqual(["startAnalysis", FOLDER, ["a"]]))
  done(api, "a")
  push(api, { type: "analysis-finished", folder: FOLDER, outcome: "done" })
  expect(screen.getByText(t("analyze.allDone", { count: 1 }))).toBeTruthy()
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  expect(screen.queryByRole("button", { name: t("prepare.next") })).toBeNull()
  await userEvent.click(start())
  await waitFor(() => expect(api.calls).toContainEqual(["startAnalysis", FOLDER, ["a", "b"]]))
  expect(next).toEqual([])
})

test("a second click on start while the first is still being answered starts nothing more", async () => {
  const { api } = renderScreen({ getSettings: () => new Promise((resolve) => setTimeout(() => resolve(settingsView()), 30)) })
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await userEvent.click(start())
  expect(start()).toHaveProperty("disabled", true)
  await userEvent.click(start())
  await waitFor(() => expect(api.calls.filter(([name]) => name === "startAnalysis")).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(api.calls.filter(([name]) => name === "startAnalysis")).toHaveLength(1)
})

test("while another project is being read, this one waits for it", async () => {
  const { api } = renderScreen({
    analysisState: async () => ({ folder: "/drafts/0815", running: true, outcome: null, error: null, transcription: {}, vision: {} }),
  })
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  await waitFor(() => expect(start()).toHaveProperty("disabled", true))
  expect(screen.getByText(t("prepare.busyElsewhere"))).toBeTruthy()
  push(api, { type: "analysis-finished", folder: "/drafts/0815", outcome: "done" })
  expect(start()).toHaveProperty("disabled", false)
  expect(screen.queryByText(t("prepare.busyElsewhere"))).toBeNull()
})

test("a run that failed while the user was away still says why, and offers another go", async () => {
  renderScreen({
    analysisState: async () => ({
      folder: FOLDER,
      running: false,
      outcome: "failed",
      error: "ffmpeg ล้ม",
      transcription: { a: { state: "failed", error: "ffmpeg ล้ม" } },
      vision: {},
    }),
  })
  expect(await screen.findByText(t("analyze.runFailed", { message: "ffmpeg ล้ม" }))).toBeTruthy()
  expect(screen.getByRole("button", { name: t("prepare.retry") })).toBeTruthy()
  expect(screen.queryByRole("button", { name: t("prepare.next") })).toBeNull()
})

test("a finished run for some other project is not this one's", async () => {
  renderScreen({
    analysisState: async () => ({
      folder: "/drafts/0815",
      running: false,
      outcome: "done",
      error: null,
      transcription: { a: { state: "done", fromCache: true, transcript: transcript("เอาล่ะครับ") } },
      vision: { a: { state: "done", fromCache: true, insight: insight("ชายหนุ่มพูดหน้ากล้อง") } },
    }),
  })
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  expect(start()).toBeTruthy()
  expect(screen.queryByText(t("analyze.allDone", { count: 1 }))).toBeNull()
})

test("a project with no videos says so and offers nothing to start", async () => {
  renderScreen({ inspectProject: async () => detail({ videos: [] }) })
  expect(await screen.findByText(t("detail.noVideos"))).toBeTruthy()
  expect(start()).toHaveProperty("disabled", true)
})

test("a project that cannot be read reports why", async () => {
  renderScreen({
    inspectProject: async () => {
      throw new Error("draft_info.json หาย")
    },
  })
  expect(await screen.findByText(t("error.generic", { message: "draft_info.json หาย" }))).toBeTruthy()
})

test("videos analysed already need no run: the button goes straight on to the outline", async () => {
  const { api, next } = renderScreen({ analysedVideos: async () => ["a", "b"] })
  const go = await screen.findByRole("button", { name: t("prepare.next") })
  expect(screen.queryByRole("button", { name: t("prepare.start") })).toBeNull()
  await userEvent.click(go)
  expect(next).toEqual([{ project: detail(), videoIds: ["a", "b"] }])
  expect(api.calls.some(([name]) => name === "startAnalysis")).toBe(false)
})

test("each video says it has been analysed before, so the missing button is not a mystery", async () => {
  renderScreen({ analysedVideos: async () => ["a"] })
  const row = (await screen.findByRole("checkbox", { name: /intro\.mov/ })).closest("li")!
  expect(within(row).getByText(t("prepare.analysed"))).toBeTruthy()
  const other = screen.getByRole("checkbox", { name: /broll\.mp4/ }).closest("li")!
  expect(within(other).queryByText(t("prepare.analysed"))).toBeNull()
})

test("ticking a video that has not been analysed brings the run back, and only the ticked ones go on", async () => {
  const { next } = renderScreen({ analysedVideos: async () => ["a"] })
  // b is ticked too and has never been analysed, so there is work to do
  expect(await screen.findByRole("button", { name: t("prepare.start") })).toBeTruthy()
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  expect(screen.queryByRole("button", { name: t("prepare.start") })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: t("prepare.next") }))
  expect(next).toEqual([{ project: detail(), videoIds: ["a"] }])
})

test("going on to the outline is not held up by CapCut being open: it touches no draft", async () => {
  renderScreen({ analysedVideos: async () => ["a", "b"] }, { running: true })
  expect(await screen.findByRole("button", { name: t("prepare.next") })).toHaveProperty("disabled", false)
})

test("nothing ticked leaves nothing to go on with", async () => {
  renderScreen({ analysedVideos: async () => ["a", "b"] })
  await userEvent.click(await screen.findByRole("checkbox", { name: /intro\.mov/ }))
  await userEvent.click(screen.getByRole("checkbox", { name: /broll\.mp4/ }))
  expect(screen.queryByRole("button", { name: t("prepare.next") })).toBeNull()
  expect(screen.getByRole("button", { name: t("prepare.start") })).toHaveProperty("disabled", true)
})

test("once a run starts the rows show its progress, not the badge from before it", async () => {
  renderScreen({ analysedVideos: async () => ["a"] })
  const row = (await screen.findByRole("checkbox", { name: /intro\.mov/ })).closest("li")!
  expect(within(row).getByText(t("prepare.analysed"))).toBeTruthy()
  await userEvent.click(start())
  expect(within(row).queryByText(t("prepare.analysed"))).toBeNull()
})

test("a project that needs no run does not quote what a run would cost", async () => {
  renderScreen({ analysedVideos: async () => ["a", "b"] })
  await screen.findByRole("button", { name: t("prepare.next") })
  expect(screen.queryByText(/token/)).toBeNull()
  // what is ticked is still said, so it is clear what goes on to the outline
  expect(screen.getByText(t("detail.selectedSummary", { selected: 2, total: 2, duration: "0:41" }))).toBeTruthy()
})

test("a video already read is greyed out, while one still to read keeps the plain tick", async () => {
  renderScreen({ analysedVideos: async () => ["a"] })
  const read = (await screen.findByRole("checkbox", { name: /intro\.mov/ })).closest("li")!
  const todo = screen.getByRole("checkbox", { name: /broll\.mp4/ }).closest("li")!
  expect(read.className).toContain("analysed")
  expect(todo.className).not.toContain("analysed")
})

test("grey means read already, not locked: the video can still be left out of the story", async () => {
  renderScreen({ analysedVideos: async () => ["a", "b"] })
  const read = await screen.findByRole("checkbox", { name: /intro\.mov/ })
  expect(read).toHaveProperty("disabled", false)
  await userEvent.click(read)
  expect(read).toHaveProperty("checked", false)
  expect(screen.getByText(t("detail.selectedSummary", { selected: 1, total: 2, duration: "0:10" }))).toBeTruthy()
})

test("once a run starts the grey goes: the row is showing its own progress now", async () => {
  renderScreen({ analysedVideos: async () => ["a"] })
  const read = (await screen.findByRole("checkbox", { name: /intro\.mov/ })).closest("li")!
  expect(read.className).toContain("analysed")
  await userEvent.click(start())
  expect(read.className).not.toContain("analysed")
})

test("a video whose file is gone is never shown as read, whatever is left in the cache for it", async () => {
  const videos = detail().videos.map((video) => (video.id === "b" ? { ...video, exists: false } : video))
  renderScreen({ inspectProject: async () => detail({ videos }), analysedVideos: async () => ["a", "b"] })
  const gone = (await screen.findByRole("checkbox", { name: /broll\.mp4/ })).closest("li")!
  expect(gone.className).not.toContain("analysed")
  expect(within(gone).queryByText(t("prepare.analysed"))).toBeNull()
})

test("the estimate is priced at how often Claude looks, as set in the settings: a frame every second is about three times the frames", async () => {
  renderScreen({ getSettings: async () => settingsView({ vision: { frameEveryS: 1 } }) })
  await screen.findByRole("checkbox", { name: /intro\.mov/ })
  // 31 frames of the 31 s clip and 10 of the 10 s one, in 3 requests, against 15 in 2 at every 3 s
  await screen.findByText(t("detail.estimate", { frames: 41, tokens: "14,963" }))
})
