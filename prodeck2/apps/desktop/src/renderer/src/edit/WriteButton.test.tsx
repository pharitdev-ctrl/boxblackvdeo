import { afterEach, expect, test } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { AppEvent, ComposedSoundView, CueView, CutPlan, EmphasisPointView, GraphicView, InsertView, MoveView, RendererApi, WriteResult, ZoomView } from "../../../shared/api.ts"
import { MOTION_VERSION, type MotionSpec } from "@boxblack/core/graphics/plan"
import { DEFAULT_HIGHLIGHT_OPTIONS } from "@boxblack/core/highlights/styles"
import { cutPlan, detail, fakeApi, highlightGroups, highlightPreview, settingsView, subtitleLines } from "../../test/fake-api.ts"
import { renderRoom, type RoomOptions } from "../../test/room.tsx"
import { t } from "../i18n.ts"
import { WRITE_REASON_ID } from "./WriteButton.tsx"

afterEach(cleanup)

const FOLDER = detail().folder

/**
 * The post page in its room. The write button is the one on its bar, where the page draws it, and the
 * notices of failed reads are the page's own, at its top.
 */
const renderButton = (overrides: Partial<RendererApi> = {}, options: RoomOptions = {}) => renderRoom(overrides, options)

const calls = (api: { calls: unknown[][] }, name: string) => api.calls.filter(([method]) => method === name)
/** The app's bar, where the write button and the reason beside it are. */
const bar = () => document.querySelector<HTMLElement>(".topbar")!
const writeButton = () => within(bar()).getByRole("button", { name: t("timeline.write") })
const writingButton = () => within(bar()).getByRole("button", { name: t("write.writing") })
const againButton = () => within(bar()).getByRole("button", { name: t("write.again") })
const reasonElement = () => bar().querySelector(".write-reason")
/** The words beside the button that say why it is off, or null when it says none. */
const reason = () => reasonElement()?.textContent ?? null
/** What is said in the bar, by its words: the reason beside the button. */
const inBar = () => within(bar())
/** The notices of failed reads, which the page puts at its top and announces. */
const notices = () => screen.queryAllByRole("alert")
/** What a retry button is described by: the words of its notice. */
const describedBy = (button: HTMLElement) => document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent ?? null
const retryButtons = () => notices().flatMap((notice) => within(notice).queryAllByRole("button", { name: t("write.check.retry") }))

/** Waits until the button can write, and opens the sheet from the button given (the one that reads เขียนอีกครั้ง after a write). */
const openSheet = async (name = detail().name, button = writeButton) => {
  await waitFor(() => expect(button()).toHaveProperty("disabled", false))
  await userEvent.click(button())
  return screen.getByRole("dialog", { name: t("write.title", { project: name }) })
}
const confirm = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole("button", { name: t("write.confirm") }))
/** Writes as soon as everything the write waits for is in: opens the sheet and says yes. */
const writeNow = async () => confirm(await openSheet())

/** What the fake write answers, for events that carry it. */
const writeResult = () => fakeApi().writeTimeline(FOLDER, settingsView().cut, 0, null, null)
const writeEvent = (event: { state: "started" } | { state: "done"; result: WriteResult } | { state: "failed"; error: string }) => ({ type: "timeline-write", folder: FOLDER, ...event }) as AppEvent
const textAndSubtitles = () =>
  settingsView({
    subtitles: { enabled: true, length: "line", polish: true },
    highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
  })

/** Answers a read at once, fails it, or holds it until the test lets it land, as the test sets `mode`. */
function readControl<T>(answer: () => T) {
  const held: (() => void)[] = []
  const control = {
    mode: "ok" as "ok" | "fail" | "hold",
    held,
    read: (): Promise<T> => {
      if (control.mode === "fail") return Promise.reject(new Error("read broke"))
      if (control.mode === "hold") return new Promise<T>((resolve) => held.push(() => resolve(answer())))
      return Promise.resolve(answer())
    },
  }
  return control
}
/** A run whose one work is done, and which is over: what that work changed is read again. */
const workDone = (api: { emit(event: AppEvent): void }, work: "text" | "subtitles") =>
  act(() => {
    api.emit({ type: "post-plan", folder: FOLDER, work, state: { state: "done", count: 1, dropped: 0 } })
    api.emit({ type: "post-plan-finished", folder: FOLDER })
  })
/** The keep button of the second row of the cut tab: a decision, which reads the cut again. */
const keep = () =>
  within(screen.getAllByRole("listitem").filter((item) => item.classList.contains("speech-row"))[1]!).getByRole("button", { name: t("timeline.action.keep") })

/* the button, and the reason it is off */

test("with everything in, the button reads เขียนลง CapCut, is enabled and shows no reason", async () => {
  renderButton()
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
  expect(writeButton().getAttribute("aria-describedby")).toBeNull()
  expect(writeButton().getAttribute("title")).toBeNull()
  // asking comes first: the sheet is not open until the button is pressed
  expect(screen.queryByRole("dialog")).toBeNull()
})

test("with CapCut open, the button is disabled and the reason shows next to it, with the same full text as its title", async () => {
  const room = renderButton({}, { capcutRunning: true })
  const why = await inBar().findByText(t("write.check.capcutOpen"))
  expect(writeButton()).toHaveProperty("disabled", true)
  expect(why.getAttribute("title")).toBe(t("write.check.capcutOpen"))
  // the bar's reason is for reading and for the button's description, not announced
  expect(why.getAttribute("role")).toBeNull()
  // the button is described by the reason, so a screen reader says why it is off; the bar's reason has one id, since one page is open at a time
  expect(why.id).toBe(WRITE_REASON_ID)
  expect(writeButton().getAttribute("aria-describedby")).toBe(WRITE_REASON_ID)
  // the button has the reason for its title too, for a bar too narrow to show the reason whole
  expect(writeButton().getAttribute("title")).toBe(t("write.check.capcutOpen"))
  // CapCut closes and the button can write once the room is in: CapCut was the only hold
  room.setCapcutRunning(false)
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
  expect(writeButton().getAttribute("aria-describedby")).toBeNull()
  expect(writeButton().getAttribute("title")).toBeNull()
})

test("before CapCut has been looked for, the reason says it is looking, not that CapCut is open", async () => {
  const room = renderButton({}, { capcutRunning: null })
  expect(await inBar().findByText(t("write.check.capcutUnknown"))).toBeTruthy()
  expect(inBar().queryByText(t("write.check.capcutOpen"))).toBeNull()
  expect(writeButton()).toHaveProperty("disabled", true)
  expect(reason()).toBe(t("write.check.capcutUnknown"))
  // the poll answers that CapCut is closed and the button can write once the room is in: not knowing was the only hold
  room.setCapcutRunning(false)
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("until the room knows whether a write is running, the reason says it is looking; a write that ends meanwhile is shown, and the late answer changes nothing", async () => {
  let known!: (writing: boolean) => void
  const { api } = renderButton({ writingTimeline: () => new Promise<boolean>((resolve) => (known = resolve)) })
  expect(reason()).toBe(t("write.check.writeKnown"))
  // everything else the write waits for is in: only the question holds it
  await waitFor(() => expect(calls(api, "previewHighlights").length).toBeGreaterThan(0))
  await act(async () => {})
  expect(writeButton()).toHaveProperty("disabled", true)
  expect(reason()).toBe(t("write.check.writeKnown"))
  const result = await writeResult()
  act(() => api.emit(writeEvent({ state: "done", result })))
  expect(againButton()).toHaveProperty("disabled", true)
  // asked before that write ended and answered after: the answer is out of date
  await act(async () => known(true))
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("a question about a running write that cannot be answered holds nothing up, and says nothing of it", async () => {
  renderButton({ writingTimeline: async () => Promise.reject(new Error("no answer")) })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
  expect(screen.queryByText(/no answer/)).toBeNull()
})

test("a room that cannot learn whether a write is running still shows how one ends: the button reads เขียนอีกครั้ง", async () => {
  const { api } = renderButton({ writingTimeline: async () => Promise.reject(new Error("no answer")) })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  const result = await writeResult()
  act(() => api.emit(writeEvent({ state: "done", result })))
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
})

test("the rough cut still being worked out has its reason, and the button waits for it", async () => {
  let finish!: (plan: CutPlan) => void
  renderButton({ previewCut: () => new Promise<CutPlan>((resolve) => (finish = resolve)) })
  expect(await inBar().findByText(t("write.check.cutting"))).toBeTruthy()
  expect(writeButton()).toHaveProperty("disabled", true)
  // the cut is asked for once the settings are read
  await waitFor(() => expect(typeof finish).toBe("function"))
  expect(reason()).toBe(t("write.check.cutting"))
  await act(async () => finish(cutPlan()))
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("a rough cut with nothing left cannot be written, and the reason says so", async () => {
  renderButton({ previewCut: async () => ({ beats: [], cuts: [], durationUs: 0 }) })
  expect(await inBar().findByText(t("write.check.cutEmpty"))).toBeTruthy()
  expect(writeButton()).toHaveProperty("disabled", true)
})

test("a plan run going on holds the write until it is over; the AI menu says the run on the bar, so only the button's title gives the reason", async () => {
  const { api } = renderButton({ postPlanState: async () => ({ running: true, states: { sounds: { state: "running" } } }) })
  await waitFor(() => expect(calls(api, "previewHighlights").length).toBeGreaterThan(0))
  await act(async () => {})
  expect(writeButton()).toHaveProperty("disabled", true)
  // every other hold has passed, so the reason is the plan's
  await waitFor(() => expect(writeButton().title).toBe(t("write.check.planning")))
  expect(reason()).toBeNull()
  expect(writeButton().getAttribute("aria-describedby")).toBeNull()
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("writing waits while the groups are being placed again, and the reason says so, so it never carries an old count", async () => {
  let groups = highlightGroups()
  // the previews asked for once the group is gone are held until the test lets them land, so the timing is the test's own
  let removed = false
  let released = false
  let held = 0
  const waiting: (() => void)[] = []
  renderButton({
    getSettings: async () => settingsView({ highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom } }),
    previewHighlights: () => {
      const snapshot = groups
      if (!removed || released) return Promise.resolve(highlightPreview({ groups: snapshot }))
      held += 1
      return new Promise((resolve) => waiting.push(() => resolve(highlightPreview({ groups: snapshot }))))
    },
    removeHighlightGroup: async (_folder, groupId) => {
      groups = groups.filter((group) => group.id !== groupId)
      removed = true
    },
  })
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  // the highlight groups live in the techniques tab
  await userEvent.click(screen.getAllByRole("tab").find((one) => one.getAttribute("data-tab") === "techniques")!)
  await userEvent.click((await screen.findAllByRole("button", { name: t("highlights.removeGroup") }))[0]!)
  await waitFor(() => expect(held).toBeGreaterThan(0))
  expect(writeButton()).toHaveProperty("disabled", true)
  expect(reason()).toBe(t("write.check.placing"))
  released = true
  for (const land of waiting.splice(0)) land()
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("while a cut decision is being saved the write waits, and the reason says the groups are to be placed again", async () => {
  let saved!: () => void
  renderButton({ setCutDecision: () => new Promise<void>((resolve) => (saved = resolve)) })
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  await userEvent.click(keep())
  // nothing else is going on: the decision being saved is what holds the write
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", true))
  expect(reason()).toBe(t("write.check.placing"))
  await act(async () => saved())
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("while a change to the text is being saved the write waits, and the reason says the groups are to be placed again", async () => {
  let saved!: () => void
  renderButton({
    getSettings: async () => settingsView({ highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom } }),
    previewHighlights: async () => highlightPreview({ groups: highlightGroups() }),
    removeHighlightGroup: () => new Promise<void>((resolve) => (saved = resolve)),
  })
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  // the highlight groups live in the techniques tab
  await userEvent.click(screen.getAllByRole("tab").find((one) => one.getAttribute("data-tab") === "techniques")!)
  await userEvent.click((await screen.findAllByRole("button", { name: t("highlights.removeGroup") }))[0]!)
  // nothing else is going on: the change being saved is what holds the write
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", true))
  expect(reason()).toBe(t("write.check.placing"))
  await act(async () => saved())
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("settings that could not be read hold the write with their own words, not those of a cut or groups being worked out", async () => {
  renderButton({
    getSettings: async () => {
      throw new Error("settings broke")
    },
  })
  expect(await inBar().findByText(t("write.check.settingsFailed"))).toBeTruthy()
  expect(reason()).toBe(t("write.check.settingsFailed"))
  expect(inBar().queryByText(t("write.check.placing"))).toBeNull()
  expect(inBar().queryByText(t("write.check.cutting"))).toBeNull()
  expect(writeButton()).toHaveProperty("disabled", true)
})

test("a cut that failed holds the write with its own words, not those of a cut being worked out", async () => {
  renderButton({
    previewCut: async () => {
      throw new Error("cut broke")
    },
  })
  expect(await inBar().findByText(t("write.check.cutFailed"))).toBeTruthy()
  expect(reason()).toBe(t("write.check.cutFailed"))
  expect(inBar().queryByText(t("write.check.cutting"))).toBeNull()
  expect(writeButton()).toHaveProperty("disabled", true)
})

test("groups that could not be placed the first time are named as failed, not as being placed", async () => {
  const previews = readControl(() => highlightPreview())
  previews.mode = "fail"
  renderButton({ previewHighlights: previews.read })
  expect(await inBar().findByText(t("write.check.previewFailed"))).toBeTruthy()
  expect(reason()).toBe(t("write.check.previewFailed"))
  expect(inBar().queryByText(t("write.check.placing"))).toBeNull()
  expect(writeButton()).toHaveProperty("disabled", true)
})

test("groups that could not be placed again hold the write until a read of them lands, and while one is tried again the reason is placing", async () => {
  const previews = readControl(() => highlightPreview())
  const { api } = renderButton({ previewHighlights: previews.read })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  // a run's text work is done and the groups are placed again for it, which fails: the preview on screen is old
  previews.mode = "fail"
  workDone(api, "text")
  expect(await inBar().findByText(t("write.check.previewFailed"))).toBeTruthy()
  expect(inBar().queryByText(t("write.check.placing"))).toBeNull()
  expect(writeButton()).toHaveProperty("disabled", true)

  // a graphic made in the background reads the same placement again, and this time it lands
  previews.mode = "ok"
  act(() => api.emit({ type: "graphics", folder: FOLDER, state: "done" }))
  await waitFor(() => expect(inBar().queryByText(t("write.check.previewFailed"))).toBeNull())
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))

  // failed once more, then tried again: while it is tried the reason is placing, rather than failed
  previews.mode = "fail"
  workDone(api, "text")
  await inBar().findByText(t("write.check.previewFailed"))
  previews.mode = "hold"
  workDone(api, "text")
  await waitFor(() => expect(previews.held).toHaveLength(1))
  expect(inBar().queryByText(t("write.check.previewFailed"))).toBeNull()
  expect(reason()).toBe(t("write.check.placing"))
  await act(async () => previews.held[0]!())
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("subtitle lines that could not be read hold the write until they are read again, and while they are the reason is placing", async () => {
  const lines = readControl(() => subtitleLines())
  lines.mode = "fail"
  const { api } = renderButton({ getSettings: async () => settingsView({ subtitles: { enabled: true, length: "line", polish: true } }), previewSubtitles: lines.read })
  expect(await inBar().findByText(t("write.check.linesFailed"))).toBeTruthy()
  expect(reason()).toBe(t("write.check.linesFailed"))
  expect(writeButton()).toHaveProperty("disabled", true)
  // a polish that ends reads them again: while it is out the reason is that they are being placed
  lines.mode = "hold"
  workDone(api, "subtitles")
  await waitFor(() => expect(lines.held).toHaveLength(1))
  expect(inBar().queryByText(t("write.check.linesFailed"))).toBeNull()
  expect(reason()).toBe(t("write.check.placing"))
  await act(async () => lines.held[0]!())
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("a cut worked out again for a decision that fails holds the write, though the cut before it is still on screen", async () => {
  const cuts = readControl(() => cutPlan())
  renderButton({ previewCut: cuts.read })
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  cuts.mode = "fail"
  await userEvent.click(keep())
  expect(await inBar().findByText(t("write.check.cutFailed"))).toBeTruthy()
  expect(writeButton()).toHaveProperty("disabled", true)
  // tried again: while it is out it has not failed
  cuts.mode = "hold"
  await userEvent.click(keep())
  await waitFor(() => expect(cuts.held).toHaveLength(1))
  expect(inBar().queryByText(t("write.check.cutFailed"))).toBeNull()
  await act(async () => cuts.held[0]!())
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("a line the user typed and a plan run then polished is written as polished, once main's lines are read again", async () => {
  let polished: string | null = null
  const room = renderButton({
    getSettings: async () => settingsView({ subtitles: { enabled: true, length: "line", polish: true } }),
    previewSubtitles: async () => subtitleLines().map((line, i) => (i === 0 && polished !== null ? { ...line, savedText: polished } : line)),
  })
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  // the subtitle lines live in the subtitle tab
  await userEvent.click(screen.getAllByRole("tab").find((one) => one.getAttribute("data-tab") === "subtitles")!)
  const box = (await screen.findAllByRole("textbox"))[0]!
  await userEvent.clear(box)
  await userEvent.type(box, "สวัสดีทุกคน")
  await waitFor(() => expect(calls(room.api, "setSubtitleText").at(-1)).toEqual(["setSubtitleText", FOLDER, subtitleLines()[0]!.key, "สวัสดีทุกคน"]))
  await act(async () => {})
  // a run's polish works on the line as saved, and main keeps what it made of it
  polished = "สวัสดีทุกคนครับ"
  act(() => {
    room.api.emit({ type: "post-plan", folder: FOLDER, work: "subtitles", state: { state: "done", count: 1, dropped: 0 } })
    room.api.emit({ type: "post-plan-finished", folder: FOLDER })
  })
  await waitFor(() => expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("สวัสดีทุกคนครับ"))
  await writeNow()
  await waitFor(() => expect(calls(room.api, "writeTimeline")).toHaveLength(1))
  expect((calls(room.api, "writeTimeline")[0]![4] as { texts: string[] }).texts[0]).toBe("สวัสดีทุกคนครับ")
})

/* the button while a write runs, and after it */

test("while the room's own write runs, the button reads กำลังเขียน…, is disabled and shows no reason, even if CapCut is opened meanwhile", async () => {
  let answer!: (result: WriteResult) => void
  const room = renderButton({ writeTimeline: () => new Promise<WriteResult>((resolve) => (answer = resolve)) })
  await writeNow()
  expect(writingButton()).toHaveProperty("disabled", true)
  expect(reason()).toBeNull()
  // CapCut opened while the write goes: the button still says it is writing, and gives no other reason
  room.setCapcutRunning(true)
  expect(writingButton()).toHaveProperty("disabled", true)
  expect(reason()).toBeNull()
  expect(writingButton().getAttribute("aria-describedby")).toBeNull()
  expect(writingButton().getAttribute("title")).toBeNull()
  const result = await writeResult()
  await act(async () => answer(result))
})

test("while a write that started elsewhere runs, the button reads กำลังเขียน…, is disabled and shows no reason, even if CapCut is opened meanwhile", async () => {
  const { api, setCapcutRunning } = renderButton({ writingTimeline: async () => false })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  act(() => api.emit(writeEvent({ state: "started" })))
  expect(writingButton()).toHaveProperty("disabled", true)
  expect(reason()).toBeNull()
  setCapcutRunning(true)
  expect(writingButton()).toHaveProperty("disabled", true)
  expect(reason()).toBeNull()
  expect(writingButton().getAttribute("aria-describedby")).toBeNull()
  expect(writingButton().getAttribute("title")).toBeNull()
})

test("a write this room did not start, starting after it heard none was running, is followed to its end: the button reads เขียนอีกครั้ง", async () => {
  const { api } = renderButton({ writingTimeline: async () => false })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  act(() => api.emit(writeEvent({ state: "started" })))
  expect(writingButton()).toHaveProperty("disabled", true)
  const result = await writeResult()
  act(() => api.emit(writeEvent({ state: "done", result })))
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
  expect(calls(api, "writeTimeline")).toEqual([])
})

test("a room opened again while its write still runs shows the button writing, and nothing more can be written", async () => {
  const { api } = renderButton({ writingTimeline: async () => true })
  expect(await screen.findByRole("button", { name: t("write.writing") })).toHaveProperty("disabled", true)
  expect(calls(api, "writingTimeline")).toEqual([["writingTimeline", FOLDER]])
  await act(async () => {})
  expect(writingButton()).toHaveProperty("disabled", true)
  expect(reason()).toBeNull()
  expect(calls(api, "writeTimeline")).toEqual([])
})

test("the room that started a write keeps the button writing until its own answer, though the event of its end comes first", async () => {
  const result = await writeResult()
  let answer!: (result: WriteResult) => void
  const { api } = renderButton({ writeTimeline: () => new Promise<WriteResult>((resolve) => (answer = resolve)) })
  await writeNow()
  act(() => api.emit(writeEvent({ state: "started" })))
  act(() => api.emit(writeEvent({ state: "done", result: { ...result, segmentCount: 9 } })))
  expect(writingButton()).toHaveProperty("disabled", true)
  await act(async () => answer(result))
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
})

test("after a write, the button reads เขียนอีกครั้ง, and another write goes through the sheet again", async () => {
  const { api } = renderButton()
  await writeNow()
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
  expect(screen.queryByRole("button", { name: t("timeline.write") })).toBeNull()
  await confirm(await openSheet(detail().name, againButton))
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(2))
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
})

test("a write that ends in a room opened again leaves the button reading เขียนอีกครั้ง, and the sheet counts what the write left in the timeline", async () => {
  let count = 0
  const { api } = renderButton({ writingTimeline: async () => true, inspectProject: async () => detail({ timelineSegmentCount: count }) })
  await screen.findByRole("button", { name: t("write.writing") })
  count = 5
  const result = await writeResult()
  act(() => api.emit(writeEvent({ state: "done", result })))
  // the next write is checked against what this one left
  const dialog = await openSheet(detail().name, againButton)
  expect(await within(dialog).findByText(t("warn.timelineReplaced", { count: 5 }))).toBeTruthy()
  expect(calls(api, "writeTimeline")).toEqual([])
})

test("a write that fails, whether the room's own or one it follows, leaves the button ready to write again", async () => {
  let fail!: (error: Error) => void
  const own = renderButton({ writeTimeline: () => new Promise<WriteResult>((_resolve, reject) => (fail = reject)) })
  await writeNow()
  // the write went, and the button says so until it fails
  await waitFor(() => expect(calls(own.api, "writeTimeline")).toHaveLength(1))
  expect(writingButton()).toHaveProperty("disabled", true)
  await act(async () => fail(new Error("CapCut is running")))
  // failed, not written: the button reads as it did before the write
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  cleanup()

  const stopped = "the graphics were stopped before they were made; the draft was not changed"
  const { api } = renderButton({ writingTimeline: async () => true })
  await screen.findByRole("button", { name: t("write.writing") })
  act(() => api.emit(writeEvent({ state: "failed", error: stopped })))
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
})

test("the write of another project changes nothing in this room's button", async () => {
  const { api } = renderButton()
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  const result = await writeResult()
  act(() => {
    api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "started" })
    api.emit({ type: "timeline-write", folder: "/drafts/0815", state: "done", result })
  })
  expect(writeButton()).toHaveProperty("disabled", false)
  expect(reason()).toBeNull()
})

/* the sheet */

test("clicking the button opens a dialog named for the project, and nothing is written yet", async () => {
  const project = detail({ name: "รีวิวแอป" })
  const { api } = renderButton({ inspectProject: async () => project }, { project })
  const dialog = await openSheet("รีวิวแอป")
  expect(within(dialog).getByRole("button", { name: t("write.cancel") })).toBeTruthy()
  expect(within(dialog).getByRole("button", { name: t("write.confirm") })).toBeTruthy()
  expect(calls(api, "writeTimeline")).toEqual([])
})

test("the sheet sums up what will be written: the video and its target, the emphasis at its level, the text, the subtitles", async () => {
  renderButton({ getSettings: async () => textAndSubtitles(), previewHighlights: async () => highlightPreview({ groups: highlightGroups() }) })
  const summary = within(await openSheet())
  expect(summary.getByText(`${t("write.video", { pieces: 5, duration: "0:12" })} · ${t("write.target", { target: "0:30" })}`)).toBeTruthy()
  expect(summary.getByText(t("write.emphasis", { count: 0, level: t("flair.level.medium") }))).toBeTruthy()
  expect(summary.getByText(t("write.text", { groups: 2, lines: 3 }))).toBeTruthy()
  expect(summary.getByText(t("write.subtitles", { count: 3 }))).toBeTruthy()
  // colour is not the app's work (M26 cancelled, 0.4.1): no line of the summary is about it
  expect(summary.getAllByRole("listitem").filter((item) => /^สี|M26/.test(item.textContent ?? ""))).toEqual([])
})

test("the sheet counts the highlight text that is drawn, groups and lines: a group a graphic takes the place of is left out, while the write is sent the number of groups listed", async () => {
  // the opening's group, of two lines, is replaced; the ending's one line is drawn
  const [opening, ending] = highlightGroups()
  const { api } = renderButton({ getSettings: async () => textAndSubtitles(), previewHighlights: async () => highlightPreview({ groups: [{ ...opening!, replaced: true }, ending!] }) })
  const dialog = await openSheet()
  expect(within(dialog).getByText(t("write.text", { groups: 1, lines: 1 }))).toBeTruthy()
  await confirm(dialog)
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(1))
  // main checks the count against every group it lists, the replaced ones among them
  expect(calls(api, "writeTimeline")[0]![5]).toMatchObject({ groupCount: 2 })
})

test("a kind that is switched off says so in the sheet instead of a count", async () => {
  renderButton({
    getSettings: async () =>
      settingsView({
        subtitles: { ...settingsView().subtitles, enabled: false },
        highlights: { ...settingsView().highlights, enabled: false },
        flair: { ...settingsView().flair, sound: true, insert: true, zoom: false, graphic: false },
      }),
  })
  const summary = within(await openSheet())
  // with none of the user's own CapCut sounds left, only the composed line is there
  expect(summary.queryByText(t("write.sounds", { count: 0 }))).toBeNull()
  expect(summary.getByText(t("write.composed", { count: 0 }))).toBeTruthy()
  expect(summary.getByText(t("write.inserts", { count: 0 }))).toBeTruthy()
  for (const what of ["highlights.title", "subtitles.title", "flair.zoom", "flair.graphic"] as const) {
    expect(summary.getByText(t("write.off", { what: t(what) }))).toBeTruthy()
  }
  cleanup()

  // and the other way about: sounds and cutaways off, zooms and graphics on
  renderButton({ getSettings: async () => settingsView({ flair: { ...settingsView().flair, sound: false, insert: false, zoom: true, graphic: true } }) })
  const other = within(await openSheet())
  expect(other.getByText(t("write.off", { what: t("flair.sound") }))).toBeTruthy()
  expect(other.getByText(t("write.off", { what: t("flair.insert") }))).toBeTruthy()
  expect(other.getByText(t("write.zooms", { count: 0 }))).toBeTruthy()
  expect(other.getByText(t("write.graphics", { count: 0 }))).toBeTruthy()
})

const soundAt = (sourceUs: number): CueView => ({
  anchor: { kind: "speech", videoId: "a", sourceUs },
  atUs: sourceUs,
  what: "ที่คำพูด",
  beatId: "b1",
  effectId: "s1",
  soundName: "ปัง",
  edited: false,
})
const zoomAt = (sourceUs: number): ZoomView => ({
  anchor: { videoId: "a", sourceUs, beatId: "b1" },
  atUs: sourceUs,
  durationUs: 1_000_000,
  what: "ชิ้นที่ซูม",
  beatId: "b1",
  kind: "punch",
  edited: false,
})
const cutawayAt = (sourceUs: number): InsertView => ({
  anchor: { kind: "speech", videoId: "a", sourceUs },
  atUs: sourceUs,
  durationUs: 2_000_000,
  what: "ที่คำพูด",
  beatId: "b1",
  binId: "m1",
  picture: "เล็บสีชมพู",
  fit: "cover",
  edited: false,
})

test("the sheet counts the sounds, zooms and cutaways that will play, each from its own list", async () => {
  renderButton({
    previewHighlights: async () =>
      highlightPreview({ cues: [soundAt(1_000_000), soundAt(2_000_000), soundAt(3_000_000)], zooms: [zoomAt(1_000_000), zoomAt(2_000_000)], inserts: [cutawayAt(1_000_000)] }),
  })
  const summary = within(await openSheet())
  expect(summary.getByText(t("write.sounds", { count: 3 }))).toBeTruthy()
  expect(summary.getByText(t("write.zooms", { count: 2 }))).toBeTruthy()
  expect(summary.getByText(t("write.inserts", { count: 1 }))).toBeTruthy()
})

const moveAt = (sourceUs: number, off = false): MoveView => ({
  anchor: { kind: "speech", videoId: "a", sourceUs, beatId: "b1" },
  insert: false,
  atUs: sourceUs,
  durationUs: 1_000_000,
  beatId: "b1",
  about: "ซูมเข้าหน้าช้าๆ",
  from: "light",
  edited: off,
  off,
  instruction: null,
  editFailed: null,
  canUndo: false,
})

test("the sheet's zoom line counts the moves that play and the legacy zooms in force, and not a move switched off", async () => {
  renderButton({ previewHighlights: async () => highlightPreview({ moves: [moveAt(1_000_000), moveAt(2_000_000), moveAt(3_000_000, true)], zooms: [zoomAt(4_000_000)] }) })
  expect(within(await openSheet()).getByText(t("write.zooms", { count: 3 }))).toBeTruthy()
})

// a sound Claude composed, written and rendered, as the main process lists it
const composedAt = (sourceUs: number, extra: Partial<ComposedSoundView> = {}): ComposedSoundView => ({
  anchor: { kind: "speech", videoId: "a", sourceUs, beatId: "b1" },
  atUs: sourceUs,
  durationUs: 1_000_000,
  beatId: "b1",
  role: "เสียงวูบ",
  from: "light",
  loudness: "normal",
  graphic: null,
  written: true,
  stale: null,
  writeFailed: null,
  instruction: null,
  editFailed: null,
  canUndo: false,
  off: false,
  render: "ready",
  error: null,
  ...extra,
})

test("the sheet counts the composed sounds a write lays, and says how many it leaves out and why, by kind", async () => {
  const sounds = [
    composedAt(1_000_000),
    // a render still going is waited for, as a graphic's is
    composedAt(1_500_000, { render: "pending" }),
    composedAt(2_000_000, { written: false, render: "pending" }),
    composedAt(2_500_000, { written: false, render: "pending" }),
    composedAt(3_000_000, { stale: "cut", render: "pending" }),
    composedAt(3_500_000, { stale: "picture", render: "pending" }),
    composedAt(4_000_000, { written: false, writeFailed: "silent", render: "pending" }),
    composedAt(4_500_000, { render: "failed", error: "the page closed" }),
    // switched off, it is nothing to warn of
    composedAt(5_000_000, { off: true, written: false, render: "pending" }),
  ]
  renderButton({ previewHighlights: async () => highlightPreview({ composed: sounds }) })
  const dialog = within(await openSheet())
  expect(dialog.getByText("เสียงที่แต่ง 2 เสียง")).toBeTruthy()
  const leftOut = dialog.getByText("เว้นไว้ 6 เสียง (ยังไม่ได้แต่ง 2 · เก่า 2 · ไม่สำเร็จ 2)")
  expect(leftOut.classList.contains("warn-text")).toBe(true)
  cleanup()

  // only the kinds there are are named; nothing left out says nothing
  renderButton({ previewHighlights: async () => highlightPreview({ composed: [composedAt(1_000_000), composedAt(2_000_000, { stale: "cut" })] }) })
  const some = within(await openSheet())
  expect(some.getByText("เสียงที่แต่ง 1 เสียง")).toBeTruthy()
  expect(some.getByText("เว้นไว้ 1 เสียง (เก่า 1)")).toBeTruthy()
  cleanup()
  renderButton({ previewHighlights: async () => highlightPreview({ composed: [composedAt(1_000_000)] }) })
  const clean = await openSheet()
  expect(within(clean).getByText("เสียงที่แต่ง 1 เสียง")).toBeTruthy()
  expect(clean.textContent).not.toContain("เว้นไว้")
  cleanup()

  // a sound tied to a graphic whose render failed is left out with it, as stale; with the graphic laid it is laid too
  const graphicHere = (render: GraphicView["render"]) => ({ ...GRAPHIC, anchor: composedAt(1_000_000).anchor, render, error: render === "failed" ? "Chrome crashed" : null })
  const tied = composedAt(1_000_000, { graphic: { summary: "จรวด" } })
  for (const [render, laid, said] of [
    ["failed", 0, "เว้นไว้ 1 เสียง (เก่า 1)"],
    ["rendering", 1, null],
  ] as const) {
    renderButton({ ...withGraphics([graphicHere(render)]), previewHighlights: async () => highlightPreview({ graphics: [graphicHere(render)], composed: [tied] }) })
    const sheet = await openSheet()
    expect(within(sheet).getByText(`เสียงที่แต่ง ${laid} เสียง`), render).toBeTruthy()
    if (said) expect(within(sheet).getByText(said)).toBeTruthy()
    else expect(sheet.textContent).not.toContain("เว้นไว้")
    cleanup()
  }

  // with the sounds off neither is said
  renderButton({
    getSettings: async () => settingsView({ flair: { ...settingsView().flair, sound: false } }),
    previewHighlights: async () => highlightPreview({ composed: [composedAt(1_000_000)] }),
  })
  const off = await openSheet()
  expect(off.textContent).not.toContain("เสียงที่แต่ง")
})

const point = (id: string, shown: boolean): EmphasisPointView => ({
  id,
  anchor: { kind: "speech", videoId: "a", from: 0, to: 2, beatId: "b1" },
  importance: shown ? "key" : "extra",
  type: "number",
  reason: "ราคาที่ต้องจำ",
  source: "ai",
  edited: false,
  beatId: "b1",
  atUs: 100_000,
  endUs: 1_400_000,
  text: "เอาล่ะครับ",
  shown,
  items: { text: 0, zoom: 0, insert: 0, graphic: 0, sound: 0 },
})

test("the emphasis points that pass the level are counted in the sheet, with the level's name", async () => {
  const base = highlightPreview()
  renderButton({ previewHighlights: async () => highlightPreview({ emphasis: { ...base.emphasis, points: [point("p1", true), point("p2", true), point("p3", false)] } }) })
  expect(within(await openSheet()).getByText(t("write.emphasis", { count: 2, level: t("flair.level.medium") }))).toBeTruthy()
})

test("zooms whose piece moved since they were made are counted in the sheet", async () => {
  renderButton({ previewHighlights: async () => highlightPreview({ zoomsLost: 2 }) })
  expect(within(await openSheet()).getByText(t("write.zoomsLost", { count: 2 }))).toBeTruthy()
})

test("what the write leaves out for want of CapCut Pro is told in the sheet, whether it is only sounds or only exits", async () => {
  const cases = [
    { left: { exits: 0, sounds: 2 }, line: "ของที่ต้องมี CapCut Pro ไม่ใส่: แอนิเมชันตอนหายไป 0 · เสียง 2 (ถ้ามี เปิด “มี CapCut Pro” ในตั้งค่า)" },
    { left: { exits: 1, sounds: 0 }, line: "ของที่ต้องมี CapCut Pro ไม่ใส่: แอนิเมชันตอนหายไป 1 · เสียง 0 (ถ้ามี เปิด “มี CapCut Pro” ในตั้งค่า)" },
  ]
  for (const { left, line } of cases) {
    renderButton({ previewHighlights: async () => highlightPreview({ proLeftOut: left }) })
    expect(within(await openSheet()).getByText(line)).toBeTruthy()
    cleanup()
  }
})

test("the sheet says nothing of CapCut Pro when nothing is left out for it", async () => {
  // the lost zooms are in the same list, so their line shows the preview has landed
  renderButton({ previewHighlights: async () => highlightPreview({ zoomsLost: 2, proLeftOut: { exits: 0, sounds: 0 } }) })
  const summary = within(await openSheet())
  expect(summary.getByText(t("write.zoomsLost", { count: 2 }))).toBeTruthy()
  expect(summary.queryByText(/CapCut Pro/)).toBeNull()
})

const MOTION_SPEC: MotionSpec = {
  kind: "motion",
  version: MOTION_VERSION,
  box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 },
  seconds: 3,
  why: "ย้ำราคาให้จำง่าย",
  idea: "ตัวเลข 590 บาทเด้งขึ้นบนแผ่นป้ายกลางจอ แล้วจางหายไป",
  words: [
    { text: "590", atS: 0.7 },
    { text: "บาท", atS: 1.2 },
  ],
  html: '<style>.tag{animation:pop 0.4s both}@keyframes pop{from{opacity:0}to{opacity:1}}</style><div class="tag">590</div>',
}
// a motion graphic that is written and made: what a write puts in the draft
const GRAPHIC: GraphicView = {
  anchor: { kind: "speech", videoId: "a", sourceUs: 2_500_000, beatId: "b1" },
  atUs: 750_000,
  durationUs: 3_000_000,
  what: "ที่ “เอาล่ะครับวันนี้”",
  beatId: "b1",
  why: "ย้ำราคาให้จำง่าย",
  summary: MOTION_SPEC.idea,
  spec: MOTION_SPEC,
  written: true,
  stale: false,
  writeFailed: null,
  instruction: null,
  editFailed: null,
  canUndo: false,
  render: "ready",
  poster: null,
  error: null,
  edited: false,
  off: false,
  from: null,
  replaces: false,
  coversKeep: false,
}
const graphicAt = (sourceUs: number, extra: Partial<GraphicView>): GraphicView => ({ ...GRAPHIC, anchor: { kind: "speech", videoId: "a", sourceUs, beatId: "b1" }, ...extra })
// as the main process lists the ones a write leaves out: nothing of them is rendered, so they wait
const NOT_WRITTEN: Partial<GraphicView> = { spec: { ...MOTION_SPEC, html: null }, written: false, render: "waiting" }
const STALE: Partial<GraphicView> = { stale: true, render: "waiting" }
const withGraphics = (graphics: GraphicView[], graphic = true): Partial<RendererApi> => ({
  getSettings: async () => settingsView({ flair: { ...settingsView().flair, graphic } }),
  previewHighlights: async () => highlightPreview({ graphics }),
})

test("the sheet counts only the graphics that play and can be written, and none while graphics are off", async () => {
  // one switched off, and one whose render failed: neither is written
  renderButton(withGraphics([GRAPHIC, graphicAt(5_700_000, { render: "failed", error: "Chrome crashed" }), graphicAt(4_000_000, { off: true })]))
  expect(within(await openSheet()).getByText(t("write.graphics", { count: 1 }))).toBeTruthy()
  cleanup()

  renderButton(withGraphics([GRAPHIC], false))
  const dialog = await openSheet()
  const summary = within(dialog)
  expect(summary.getByText(t("write.off", { what: t("flair.graphic") }))).toBeTruthy()
  expect(summary.queryByText(new RegExp(t("write.graphics", { count: "\\d+" })))).toBeNull()
  // graphics off play none, so there are no renders to tell of
  expect(dialog.textContent).not.toMatch(new RegExp(t("write.check.graphics", { done: "\\d+", total: "\\d+" })))
})

test("with graphics playing, the sheet says how many renders are finished, that the write waits for the rest, and that failed ones are skipped", async () => {
  renderButton(
    withGraphics([GRAPHIC, graphicAt(4_000_000, { render: "rendering" }), graphicAt(5_700_000, { render: "failed", error: "Chrome crashed" }), graphicAt(6_000_000, { off: true })]),
  )
  // renders still going hold nothing: main waits for them when it writes, so the button is ready all the same
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  const dialog = await openSheet()
  // one made and one failed: two of the three that play are finished
  expect(within(dialog).getByText(`${t("write.check.graphics", { done: 2, total: 3 })} · ${t("write.check.graphicsGoing")}`)).toBeTruthy()
  expect(within(dialog).getByText(t("write.check.graphicsFailed", { count: 1 }))).toBeTruthy()
  cleanup()

  // every render finished, one of them failed: nothing is left to wait for
  renderButton(withGraphics([GRAPHIC, graphicAt(5_700_000, { render: "failed", error: "Chrome crashed" })]))
  const done = await openSheet()
  expect(within(done).getByText(t("write.check.graphics", { done: 2, total: 2 }))).toBeTruthy()
  expect(done.textContent).not.toContain(t("write.check.graphicsGoing"))
  expect(within(done).getByText(t("write.check.graphicsFailed", { count: 1 }))).toBeTruthy()
  cleanup()

  // none failed: nothing is said of failed renders
  renderButton(withGraphics([GRAPHIC]))
  const clean = await openSheet()
  expect(within(clean).getByText(t("write.check.graphics", { done: 1, total: 1 }))).toBeTruthy()
  expect(clean.textContent).not.toMatch(new RegExp(t("write.check.graphicsFailed", { count: "\\d+" })))
})

test("graphics not written yet, or that the cut changed under, are not written into the draft: the sheet leaves them out of its counts, waits for no render of theirs, and warns how many there are", async () => {
  const failedWriting = "nothing was drawn: every frame is empty"
  renderButton(
    withGraphics([
      GRAPHIC,
      graphicAt(3_000_000, { render: "rendering" }),
      graphicAt(3_500_000, NOT_WRITTEN),
      graphicAt(4_000_000, STALE),
      // one whose writing failed has no fragment either
      graphicAt(4_500_000, { ...NOT_WRITTEN, spec: { ...MOTION_SPEC, html: null, failed: failedWriting }, writeFailed: failedWriting }),
      // switched off, it is not written into the draft whether it is written or not: it is nothing to warn of
      graphicAt(5_000_000, { ...NOT_WRITTEN, off: true }),
    ]),
  )
  // nothing of theirs is waited for, so the button is ready all the same
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  const dialog = await openSheet()
  // the one made and the one still rendering
  expect(within(dialog).getByText(t("write.graphics", { count: 2 }))).toBeTruthy()
  expect(within(dialog).getByText(`${t("write.check.graphics", { done: 1, total: 2 })} · ${t("write.check.graphicsGoing")}`)).toBeTruthy()
  const warning = within(dialog).getByText("กราฟิก 3 ชิ้นยังไม่ได้เขียนหรือต้องทำใหม่ จะไม่ถูกใส่")
  expect(warning.classList.contains("warn-text")).toBe(true)
  cleanup()

  // none of the graphics that play can be written: no render is counted or waited for, and the warning stands alone
  renderButton(withGraphics([graphicAt(3_500_000, NOT_WRITTEN), graphicAt(4_000_000, STALE)]))
  const none = await openSheet()
  expect(within(none).getByText(t("write.graphics", { count: 0 }))).toBeTruthy()
  expect(none.textContent).not.toMatch(new RegExp(t("write.check.graphics", { done: "\\d+", total: "\\d+" })))
  expect(none.textContent).not.toContain(t("write.check.graphicsGoing"))
  expect(within(none).getByText("กราฟิก 2 ชิ้นยังไม่ได้เขียนหรือต้องทำใหม่ จะไม่ถูกใส่")).toBeTruthy()
  cleanup()

  // every graphic written and fresh: nothing is said of it
  renderButton(withGraphics([GRAPHIC, graphicAt(3_000_000, { render: "failed", error: "Chrome crashed" })]))
  const clean = await openSheet()
  expect(within(clean).getByText(t("write.graphics", { count: 1 }))).toBeTruthy()
  expect(clean.textContent).not.toMatch(/ยังไม่ได้เขียนหรือต้องทำใหม่/)
  cleanup()

  // with graphics off none plays, so there is none to warn of
  renderButton(withGraphics([graphicAt(3_500_000, NOT_WRITTEN)], false))
  const off = await openSheet()
  expect(within(off).getByText(t("write.off", { what: t("flair.graphic") }))).toBeTruthy()
  expect(off.textContent).not.toMatch(/ยังไม่ได้เขียนหรือต้องทำใหม่/)
})

test("the sheet says how many pieces on the timeline the write replaces, with the untested version, and the count goes with the write", async () => {
  const { api } = renderButton({ inspectProject: async () => detail({ timelineSegmentCount: 4, capcutVersion: "9.5.0", versionTested: false }) })
  const dialog = await openSheet()
  expect(await within(dialog).findByText(t("warn.timelineReplaced", { count: 4 }))).toBeTruthy()
  expect(within(dialog).getByText(t("warn.untestedVersion", { version: "9.5.0" }))).toBeTruthy()
  expect(within(dialog).queryByText(t("write.fresh"))).toBeNull()
  await confirm(dialog)
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(1))
  expect(calls(api, "writeTimeline")[0]![3]).toBe(4)
})

test("the sheet says the timeline is empty when it is, and a tested CapCut version says nothing", async () => {
  renderButton()
  const dialog = await openSheet()
  expect(within(dialog).getByText(t("write.fresh"))).toBeTruthy()
  expect(within(dialog).queryByText(new RegExp(t("warn.untestedVersion", { version: ".*" })))).toBeNull()
  expect(within(dialog).queryByText(/จะถูกแทนที่ด้วยผลตัดต่อใหม่/)).toBeNull()
})

test("the sheet ends with the note that the whole draft is backed up before every write", async () => {
  renderButton()
  const dialog = await openSheet()
  expect(dialog.querySelector(".sheet-body")!.lastElementChild!.textContent).toBe(t("write.backup"))
})

test("ยกเลิก closes the sheet with no write", async () => {
  const { api } = renderButton()
  const dialog = await openSheet()
  await userEvent.click(within(dialog).getByRole("button", { name: t("write.cancel") }))
  expect(screen.queryByRole("dialog")).toBeNull()
  await act(async () => {})
  expect(calls(api, "writeTimeline")).toEqual([])
  // the button is as it was, ready for the next ask
  expect(writeButton()).toHaveProperty("disabled", false)
})

test("Escape closes the sheet with no write", async () => {
  const { api } = renderButton()
  await openSheet()
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).toBeNull()
  await act(async () => {})
  expect(calls(api, "writeTimeline")).toEqual([])
  expect(writeButton()).toHaveProperty("disabled", false)
})

test("เขียนเลย writes once, with the rules, the timeline's piece count, the subtitles and the settings on screen, and closes the sheet", async () => {
  const { api } = renderButton({ getSettings: async () => textAndSubtitles(), previewHighlights: async () => highlightPreview({ groups: highlightGroups() }) })
  await writeNow()
  expect(screen.queryByRole("dialog")).toBeNull()
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(1))
  const [, folder, rules, segments, subtitles, highlights] = calls(api, "writeTimeline")[0]!
  expect([folder, segments]).toEqual([FOLDER, 0])
  expect(rules).toEqual(settingsView().cut)
  expect(subtitles).toEqual({ length: "line", texts: subtitleLines().map((line) => line.text) })
  expect(highlights).toEqual({ position: "auto", hideSubtitles: true, highlightsOn: true, groupCount: 2, flair: textAndSubtitles().flair })
  // once: nothing writes a second time behind it
  await act(async () => {})
  expect(calls(api, "writeTimeline")).toHaveLength(1)
})

test("เขียนเลย pressed twice in the same moment writes once, and the write that runs is not turned idle by the second press", async () => {
  // main refuses a second write while one runs, as the real one does
  let asked = 0
  let answer!: (result: WriteResult) => void
  const { api } = renderButton({
    writeTimeline: () => {
      asked += 1
      if (asked > 1) return Promise.reject(new Error("a write is already running"))
      return new Promise<WriteResult>((resolve) => (answer = resolve))
    },
  })
  const dialog = await openSheet()
  const confirming = within(dialog).getByRole("button", { name: t("write.confirm") })
  // both presses land before the page has rendered again, as two activations in one tick would
  act(() => {
    fireEvent.click(confirming)
    fireEvent.click(confirming)
  })
  await act(async () => {})
  expect(calls(api, "writeTimeline")).toHaveLength(1)
  // the one that runs is still the room's own, and says it is writing; no failure was told
  expect(writingButton()).toHaveProperty("disabled", true)
  expect(screen.queryByRole("status")).toBeNull()
  await act(async () => answer(await writeResult()))
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
  expect(calls(api, "writeTimeline")).toHaveLength(1)
})

test("with subtitles and highlight text off, no subtitles are written and the request says the text is off", async () => {
  const { api } = renderButton()
  await writeNow()
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(1))
  expect(calls(api, "writeTimeline")[0]![4]).toBeNull()
  // the other works still write with the text off, so the request always goes
  expect(calls(api, "writeTimeline")[0]![5]).toEqual({ position: "auto", hideSubtitles: true, highlightsOn: false, groupCount: 0, flair: settingsView().flair })
})

test("the write carries each subtitle line as the user left it: the saved text where there is one", async () => {
  const saved = subtitleLines().map((line, i) => (i === 1 ? { ...line, savedText: "จะมารีวิวแอปใหม่" } : line))
  const { api } = renderButton({ getSettings: async () => textAndSubtitles(), previewSubtitles: async () => saved })
  await writeNow()
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(1))
  expect(calls(api, "writeTimeline")[0]![4]).toEqual({ length: "line", texts: ["สวัสดีครับวันนี้", "จะมารีวิวแอปใหม่", "ขอบคุณที่ดูครับ"] })
})

test("เขียนเลย is disabled when a hold appears while the sheet is open (CapCut opened meanwhile): the sheet says why and nothing is written, and the reason goes when CapCut closes again", async () => {
  const room = renderButton()
  const dialog = await openSheet()
  const confirming = () => within(dialog).getByRole("button", { name: t("write.confirm") })
  // while nothing holds the write, the sheet gives no reason
  expect(confirming()).toHaveProperty("disabled", false)
  expect(confirming().getAttribute("aria-describedby")).toBeNull()
  expect(within(dialog).queryByRole("status")).toBeNull()

  room.setCapcutRunning(true)
  expect(confirming()).toHaveProperty("disabled", true)
  // the dialog is modal, so it says why inside itself: right above its buttons, and เขียนเลย is described by it
  const why = within(dialog).getByRole("status")
  expect(why.textContent).toBe(t("write.check.capcutOpen"))
  expect(dialog.querySelector(".sheet-body")!.lastElementChild).toBe(why)
  expect(why.id).not.toBe("")
  expect(confirming().getAttribute("aria-describedby")).toBe(why.id)
  // the bar behind the sheet keeps its own reason
  expect(reason()).toBe(t("write.check.capcutOpen"))
  await userEvent.click(confirming())
  await act(async () => {})
  expect(calls(room.api, "writeTimeline")).toEqual([])

  // CapCut closes again: the reason goes with the hold, and เขียนเลย can write
  room.setCapcutRunning(false)
  expect(within(dialog).queryByRole("status")).toBeNull()
  expect(confirming().getAttribute("aria-describedby")).toBeNull()
  expect(confirming()).toHaveProperty("disabled", false)
  await userEvent.click(confirming())
  await waitFor(() => expect(calls(room.api, "writeTimeline")).toHaveLength(1))
  expect(screen.queryByRole("dialog")).toBeNull()
})

/* the notices of failed reads, which the post page puts at its top */

test("each failed read shows its words with a button that reads it again, described by those words, and the write can go once it lands", async () => {
  const settings = () => settingsView({ subtitles: { enabled: true, length: "line", polish: true } })
  const cases = [
    { words: "write.check.settingsFailed", method: "getSettings", answer: settings },
    { words: "write.check.cutFailed", method: "previewCut", answer: () => cutPlan() },
    { words: "write.check.previewFailed", method: "previewHighlights", answer: () => highlightPreview() },
    { words: "write.check.linesFailed", method: "previewSubtitles", answer: () => subtitleLines() },
  ] as const
  for (const { words, method, answer } of cases) {
    const read = readControl<unknown>(answer)
    read.mode = "fail"
    const { api } = renderButton({ getSettings: async () => settings(), [method]: read.read } as Partial<RendererApi>)
    // a read that failed is announced, as a save that failed in a sheet is; the reason beside the button is not
    const notice = await screen.findByRole("alert")
    expect(within(notice).getByText(t(words)), words).toBeTruthy()
    expect(notices(), words).toHaveLength(1)
    expect(reasonElement(), words).not.toBeNull()
    expect(reasonElement()!.getAttribute("role"), words).toBeNull()
    // the button says only that it tries again: its notice says what
    const retry = within(notice).getByRole("button", { name: t("write.check.retry") })
    expect(describedBy(retry), words).toBe(t(words))
    expect(retryButtons(), words).toHaveLength(1)
    const before = calls(api, method).length
    read.mode = "ok"
    await userEvent.click(retry)
    await waitFor(() => expect(calls(api, method), words).toHaveLength(before + 1))
    await waitFor(() => expect(retryButtons(), words).toHaveLength(0))
    expect(notices(), words).toEqual([])
    await waitFor(() => expect(writeButton(), words).toHaveProperty("disabled", false))
    // what was said about the failure goes with it
    expect(screen.queryByText(t("error.generic", { message: "read broke" })), words).toBeNull()
    cleanup()
  }
})

test("several failed reads each have a notice, in the order cut, placement, subtitles", async () => {
  // settings are read first and the rest wait for them, so only these three can fail together
  const failing = async () => {
    throw new Error("read broke")
  }
  renderButton({
    getSettings: async () => settingsView({ subtitles: { enabled: true, length: "line", polish: true } }),
    previewCut: failing,
    previewHighlights: failing,
    previewSubtitles: failing,
  })
  await waitFor(() => expect(retryButtons()).toHaveLength(3))
  expect(retryButtons().map(describedBy)).toEqual([t("write.check.cutFailed"), t("write.check.previewFailed"), t("write.check.linesFailed")])
  expect(notices()).toHaveLength(3)
})

test("a cut read again from its notice holds the write while it is worked out, since the cut on screen is the one before the failure", async () => {
  const cuts = readControl(() => cutPlan())
  renderButton({ previewCut: cuts.read })
  await screen.findByRole("heading", { name: /เปิดเรื่อง/ })
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  // a decision's cut that fails leaves the cut before it on screen
  cuts.mode = "fail"
  await userEvent.click(keep())
  await waitFor(() => expect(retryButtons()).toHaveLength(1))
  cuts.mode = "hold"
  await userEvent.click(retryButtons()[0]!)
  await waitFor(() => expect(cuts.held).toHaveLength(1))
  // while it is out the cut on screen is not what would be written
  expect(reason()).toBe(t("write.check.cutting"))
  expect(writeButton()).toHaveProperty("disabled", true)
  expect(retryButtons()).toHaveLength(0)
  await act(async () => cuts.held[0]!())
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(reason()).toBeNull()
})

test("with nothing failed, the page shows no notice of a failed read", async () => {
  renderButton()
  expect(notices()).toEqual([])
  expect(document.querySelector(".read-failed")).toBeNull()
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(notices()).toEqual([])
  expect(document.querySelector(".read-failed")).toBeNull()
})
