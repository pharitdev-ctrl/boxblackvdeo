import { afterEach, expect, test, vi } from "vitest"
import { useLayoutEffect, useState } from "react"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { AppEvent, CueAnchor, HighlightPreview, PostRunView, PostWork, PostWorkState, ProjectDetail, RendererApi, SubtitleLine, WriteResult } from "../../../shared/api.ts"
import { DEFAULT_HIGHLIGHT_OPTIONS } from "@boxblack/core/highlights/styles"
import { detail, fakeApi, highlightPreview, settingsView, storedOutline, subtitleLines } from "../../test/fake-api.ts"
import { renderRoom } from "../../test/room.tsx"
import { ACTION_TOAST_MS, toldMessage } from "../edit/writeEnd.tsx"
import { WriteButton } from "../edit/WriteButton.tsx"
import { t } from "../i18n.ts"
import { PostScreen } from "../screens/PostScreen.tsx"
import { ClipRoom, useClipRoom, type ClipRoomProps, type ClipRoomValue } from "./ClipRoom.tsx"

afterEach(cleanup)
afterEach(() => {
  vi.useRealTimers()
})

const project = detail()
const FOLDER = project.folder
const stored = storedOutline({ confirmed: true })

const calls = (api: { calls: unknown[][] }, name: string) => api.calls.filter(([method]) => method === name)
const postReady = () => screen.findByRole("heading", { name: /เปิดเรื่อง/ })
/** The write button and the rest of the room's toolbar are on the bar the room's page draws them into. */
const bar = () => document.querySelector<HTMLElement>(".topbar")!
const writeButton = () => within(bar()).getByRole("button", { name: t("timeline.write") })
const writingButton = () => within(bar()).getByRole("button", { name: t("write.writing") })
const againButton = () => within(bar()).getByRole("button", { name: t("write.again") })
/** Writes as soon as everything the write waits for is in: the bar's button, then เขียนเลย in the sheet it opens. */
const writeNow = async () => {
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  await userEvent.click(writeButton())
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("write.confirm") }))
}
/** The words of every toast on screen. */
const toasts = () => screen.queryAllByRole("status").map((toast) => toast.textContent)
/** What the fake write answers, for events that carry it. */
const writeResult = () => fakeApi().writeTimeline(FOLDER, settingsView().cut, 0, null, null)
const writeEvent = (event: { state: "started" } | { state: "done"; result: WriteResult } | { state: "failed"; error: string }) => ({ type: "timeline-write", folder: FOLDER, ...event }) as AppEvent
const postEvent = (work: PostWork, state: PostWorkState): AppEvent => ({ type: "post-plan", folder: FOLDER, work, state })
const withSubtitles = { getSettings: async () => settingsView({ subtitles: { enabled: true, length: "line" as const, polish: false } }) }

type RoomProps = Partial<Omit<ClipRoomProps, "children">>

/** The room alone, with a child that hands the test what the room gives its page. */
function renderProbe(overrides: Partial<RendererApi> = {}, props: RoomProps = {}) {
  const api = fakeApi(overrides)
  let room: ClipRoomValue | null = null
  function Probe() {
    room = useClipRoom()
    return null
  }
  const element = (more: RoomProps) => (
    <ClipRoom api={api} project={project} stored={stored} capcutRunning={false} {...props} {...more}>
      <Probe />
    </ClipRoom>
  )
  const view = render(element({}))
  return { api, room: () => room!, rerender: (more: RoomProps) => view.rerender(element(more)) }
}

/* the draft, and who claims its write ends */

test("the room claims its draft once, and keeps the claim while the app tells it CapCut is opened and closed", async () => {
  const claims: (string | null)[] = []
  const room = renderRoom({}, { claim: (folder) => claims.push(folder) })
  await postReady()
  room.setCapcutRunning(true)
  room.setCapcutRunning(false)
  expect(claims).toEqual([FOLDER])
})

test("the room claims its draft's write ends only once it listens for them, so one ending in that moment is told by the room", async () => {
  const result = await writeResult()
  const claims: (string | null)[] = []
  renderRoom(
    {},
    {
      claim: (folder, api) => {
        claims.push(folder)
        // from here on the app leaves this draft's ends to the room
        if (folder) api.emit(writeEvent({ state: "done", result }))
      },
    },
  )
  await postReady()
  expect(claims).toEqual([FOLDER])
  expect(await screen.findByRole("status")).toHaveProperty("textContent", t("write.done", { pieces: 5, duration: "0:12" }))
})

test("the room gives its claim up in the same moment it leaves the screen, before what replaces it runs", async () => {
  const api = fakeApi()
  const claims: (string | null)[] = []
  let seenByNext: string | null | undefined
  function Next() {
    useLayoutEffect(() => {
      seenByNext = claims.at(-1)
    }, [])
    return null
  }
  let leave!: () => void
  function Host() {
    const [open, setOpen] = useState(true)
    leave = () => setOpen(false)
    return open ? (
      <ClipRoom api={api} project={project} stored={stored} capcutRunning={false} claim={(folder) => claims.push(folder)}>
        <PostScreen onEditOutline={() => {}} />
      </ClipRoom>
    ) : (
      <Next />
    )
  }
  render(<Host />)
  await postReady()
  act(() => leave())
  expect(seenByNext).toBeNull()
  expect(claims).toEqual([FOLDER, null])
})

test("an answer about the draft the room showed before, coming once it shows another, says nothing of the one it shows now", async () => {
  const asked: { folder: string; answer: (writing: boolean) => void }[] = []
  const api = fakeApi({ writingTimeline: (folder) => new Promise<boolean>((resolve) => asked.push({ folder, answer: resolve })) })
  const other = detail({ name: "0815", folder: "/drafts/0815" })
  let show!: (next: typeof project) => void
  function Host() {
    const [shown, setShown] = useState(project)
    show = setShown
    return (
      <ClipRoom api={api} project={shown} stored={stored} capcutRunning={false}>
        <WriteButton />
      </ClipRoom>
    )
  }
  render(<Host />)
  const button = () => screen.getByRole("button", { name: t("timeline.write") })
  act(() => show(other))
  await waitFor(() => expect(asked.map(({ folder }) => folder)).toEqual([FOLDER, other.folder]))
  await act(async () => asked[1]!.answer(false))
  await waitFor(() => expect(button()).toHaveProperty("disabled", false))
  // the first draft's write is running, but that is not this draft's
  await act(async () => asked[0]!.answer(true))
  expect(button()).toHaveProperty("disabled", false)
  expect(screen.queryByRole("button", { name: t("write.writing") })).toBeNull()
})

test("the draft is read again once CapCut is closed, since its timeline may have been edited there", async () => {
  const { api, rerender } = renderProbe({}, { capcutRunning: true })
  await waitFor(() => expect(calls(api, "inspectProject")).toHaveLength(1))
  rerender({ capcutRunning: false })
  await waitFor(() => expect(calls(api, "inspectProject")).toHaveLength(2))
})

test("the draft is read again after a backup was put back", async () => {
  const { api, rerender } = renderProbe({}, { draftVersion: 0 })
  await waitFor(() => expect(calls(api, "inspectProject")).toHaveLength(1))
  rerender({ draftVersion: 1 })
  await waitFor(() => expect(calls(api, "inspectProject")).toHaveLength(2))
})

/* what the room gives its page */

test("what the room gives its page keeps its identity while nothing in it changes, its actions keep theirs for good, and it says what is switched on", async () => {
  const { room, rerender } = renderProbe(withSubtitles)
  await waitFor(() => expect(room().lines).not.toBeNull())
  await waitFor(() => expect(room().preview).not.toBeNull())
  await waitFor(() => expect(room().plan).not.toBeNull())
  await waitFor(() => expect(room().writeKnown).toBe(true))
  await act(async () => {})
  const before = room()
  expect([before.highlightsOn, before.subtitlesOn, before.graphicsOn, before.empty]).toEqual([false, true, false, false])
  rerender({})
  expect(room()).toBe(before)
  act(() => room().setError("something"))
  expect(room()).not.toBe(before)
  for (const action of ["decide", "changeRules", "changeSubtitles", "changeHighlights", "changeFlair", "changeHighlightText", "editSubtitle", "retry", "request", "planPost", "rethink", "redoGraphic", "editGraphic", "undoGraphic", "runWrite"] as const) {
    expect(room()[action]).toBe(before[action])
  }
})

/* the preview */

test("the preview is read whatever is switched on, and says whether the highlight text is", async () => {
  const { api } = renderProbe()
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(1))
  expect(calls(api, "previewHighlights")[0]![3]).toMatchObject({ position: "auto", subtitlesOn: false, highlightsOn: false })
})

/* a new level and the subtitle lines */

// the lines leave out the words of the text the level shows, which main reads from the saved settings
const hidingUnderText = (hideSubtitles = true) =>
  settingsView({
    subtitles: { enabled: true, length: "line", polish: false },
    highlights: { enabled: true, position: "auto", hideSubtitles, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
  })

test("a new level is read into the subtitle lines once saved, even when hiding under the text came on only after the level changed", async () => {
  const saves: (() => void)[] = []
  const { api, room } = renderProbe({
    getSettings: async () => hidingUnderText(false),
    updateSettings: () => new Promise<void>((resolve) => saves.push(resolve)),
  })
  await waitFor(() => expect(room().lines).not.toBeNull())
  // nothing is hidden under the text yet: the lines on screen are right at any level
  act(() => room().changeFlair({ ...room().flair!, level: "heavy" }))
  expect(room().lines).not.toBeNull()
  const read = calls(api, "previewSubtitles").length
  // hiding comes on before the level is saved: main would still read the old level, so the lines wait for it
  act(() => room().changeHighlights({ ...room().highlights!, hideSubtitles: true }))
  await act(async () => {})
  expect(room().lines).toBeNull()
  expect(calls(api, "previewSubtitles")).toHaveLength(read)
  await act(async () => saves[0]!())
  await waitFor(() => expect(room().lines).not.toBeNull())
  expect(calls(api, "previewSubtitles").slice(read)).toEqual([["previewSubtitles", FOLDER, settingsView().cut, "line", true]])
})

test("only the latest level saved reads the subtitle lines again: an earlier save landing first leaves them waiting", async () => {
  const saves: (() => void)[] = []
  const { api, room } = renderProbe({
    getSettings: async () => hidingUnderText(),
    updateSettings: () => new Promise<void>((resolve) => saves.push(resolve)),
  })
  await waitFor(() => expect(room().lines).not.toBeNull())
  const read = calls(api, "previewSubtitles").length
  act(() => room().changeFlair({ ...room().flair!, level: "heavy" }))
  act(() => room().changeFlair({ ...room().flair!, level: "light" }))
  expect(room().lines).toBeNull()
  // main may not have written the second level yet when the first save answers
  await act(async () => saves[0]!())
  expect(calls(api, "previewSubtitles")).toHaveLength(read)
  expect(room().lines).toBeNull()
  await act(async () => saves[1]!())
  await waitFor(() => expect(room().lines).not.toBeNull())
  expect(calls(api, "previewSubtitles")).toHaveLength(read + 1)
})

test("a level whose save fails goes back to the level main kept, and the subtitle lines are read again at it", async () => {
  const { api, room } = renderProbe({
    getSettings: async () => hidingUnderText(),
    updateSettings: async () => {
      throw new Error("the settings could not be saved")
    },
  })
  await waitFor(() => expect(room().lines).not.toBeNull())
  const kept = room().flair!.level
  const read = calls(api, "previewSubtitles").length
  act(() => room().changeFlair({ ...room().flair!, level: kept === "heavy" ? "light" : "heavy" }))
  expect(room().lines).toBeNull()
  await waitFor(() => expect(room().error).toBe("the settings could not be saved"))
  await waitFor(() => expect(room().flair!.level).toBe(kept))
  await waitFor(() => expect(room().lines).not.toBeNull())
  expect(calls(api, "previewSubtitles")).toHaveLength(read + 1)
})

test("a save that fails while a later level is still being saved leaves that later level on screen, and the later save reads the lines", async () => {
  const saves: { resolve: () => void; reject: (error: Error) => void }[] = []
  const { api, room } = renderProbe({
    getSettings: async () => hidingUnderText(),
    updateSettings: () => new Promise<void>((resolve, reject) => saves.push({ resolve, reject })),
  })
  await waitFor(() => expect(room().lines).not.toBeNull())
  const settingsReads = calls(api, "getSettings").length
  act(() => room().changeFlair({ ...room().flair!, level: "heavy" }))
  act(() => room().changeFlair({ ...room().flair!, level: "light" }))
  await act(async () => saves[0]!.reject(new Error("the settings could not be saved")))
  // the later save stores the whole setting again: what main keeps is for that one to say
  expect(calls(api, "getSettings")).toHaveLength(settingsReads)
  expect(room().flair!.level).toBe("light")
  await act(async () => saves[1]!.resolve())
  await waitFor(() => expect(room().lines).not.toBeNull())
  expect(room().flair!.level).toBe("light")
  // the later save went through: the failure it overtook is nothing to show
  expect(room().error).toBeNull()
})

test("a cut rule, a subtitle setting or a highlight setting whose save fails says why, and goes back to what main keeps", async () => {
  const { room } = renderProbe({
    updateSettings: async () => {
      throw new Error("the settings could not be saved")
    },
  })
  await waitFor(() => expect(room().rules).not.toBeNull())
  act(() => room().changeRules({ ...room().rules!, preset: "loose" }))
  expect(room().rules!.preset).toBe("loose")
  await waitFor(() => expect(room().rules).toEqual(settingsView().cut))
  expect(room().error).toBe("the settings could not be saved")

  act(() => room().changeSubtitles({ ...room().subtitles!, enabled: true }))
  expect(room().subtitles!.enabled).toBe(true)
  await waitFor(() => expect(room().subtitles).toEqual(settingsView().subtitles))
  expect(room().error).toBe("the settings could not be saved")

  act(() => room().changeHighlights({ ...room().highlights!, position: "bottom" }))
  expect(room().highlights!.position).toBe("bottom")
  await waitFor(() => expect(room().highlights).toEqual(settingsView().highlights))
  expect(room().error).toBe("the settings could not be saved")
})

test("a setting's save overtaken by a later one that goes through leaves no error, and its read-back nothing to undo", async () => {
  const saves: { resolve: () => void; reject: (error: Error) => void }[] = []
  const { api, room } = renderProbe({ updateSettings: () => new Promise<void>((resolve, reject) => saves.push({ resolve, reject })) })
  await waitFor(() => expect(room().rules).not.toBeNull())
  const settingsReads = calls(api, "getSettings").length
  act(() => room().changeRules({ ...room().rules!, preset: "loose" }))
  act(() => room().changeRules({ ...room().rules!, preset: "tight" }))
  await act(async () => saves[0]!.reject(new Error("the settings could not be saved")))
  await act(async () => saves[1]!.resolve())
  expect(room().error).toBeNull()
  expect(room().rules!.preset).toBe("tight")
  expect(calls(api, "getSettings")).toHaveLength(settingsReads)
})

test("a level chosen while the kept one is still being read back is not undone by that late answer", async () => {
  let failing = true
  let answer!: () => void
  let reads = 0
  const { room } = renderProbe({
    getSettings: () => {
      reads += 1
      // the first read opens the room; the next reads back what main keeps after the failed save, and waits
      return reads === 1 ? Promise.resolve(hidingUnderText()) : new Promise((resolve) => (answer = () => resolve(hidingUnderText())))
    },
    updateSettings: async () => {
      if (failing) throw new Error("the settings could not be saved")
    },
  })
  await waitFor(() => expect(room().lines).not.toBeNull())
  act(() => room().changeFlair({ ...room().flair!, level: "heavy" }))
  await waitFor(() => expect(reads).toBe(2))
  failing = false
  act(() => room().changeFlair({ ...room().flair!, level: "light" }))
  await waitFor(() => expect(room().lines).not.toBeNull())
  await act(async () => answer())
  expect(room().flair!.level).toBe("light")
})

/* subtitle texts kept by main */

test("a subtitle line the user changed before shows as they left it, from the text main keeps", async () => {
  const { room } = renderProbe({ ...withSubtitles, previewSubtitles: async () => subtitleLines().map((line, i) => (i === 0 ? { ...line, savedText: "สวัสดีทุกคน" } : line)) })
  await waitFor(() => expect(room().texts).toEqual(["สวัสดีทุกคน", "จะมารีวิวแอป", "ขอบคุณที่ดูครับ"]))
})

test("a typed line shows at once and is saved once the typing rests; one typed back to the generated text is forgotten", async () => {
  const { api, room } = renderProbe(withSubtitles)
  const key = subtitleLines()[0]!.key
  await waitFor(() => expect(room().lines).not.toBeNull())
  act(() => room().editSubtitle(0, "สวัสดี"))
  act(() => room().editSubtitle(0, "สวัสดีครับ"))
  expect(room().texts[0]).toBe("สวัสดีครับ")
  // two keys in a row are one save
  await waitFor(() => expect(calls(api, "setSubtitleText")).toEqual([["setSubtitleText", FOLDER, key, "สวัสดีครับ"]]))
  act(() => room().editSubtitle(0, "สวัสดีครับวันนี้"))
  await waitFor(() => expect(calls(api, "setSubtitleText")).toHaveLength(2))
  expect(calls(api, "setSubtitleText")[1]).toEqual(["setSubtitleText", FOLDER, key, null])
})

test("a line typed while the lines are read again keeps its text when that read answers with what main kept before the save", async () => {
  const held: ((lines: SubtitleLine[]) => void)[] = []
  let reads = 0
  const { api, room } = renderProbe({
    ...withSubtitles,
    previewSubtitles: () => {
      reads += 1
      return reads === 1 ? Promise.resolve(subtitleLines()) : new Promise<SubtitleLine[]>((resolve) => held.push(resolve))
    },
  })
  const key = subtitleLines()[0]!.key
  const withSaved = (text: string) => subtitleLines().map((line, i) => (i === 0 ? { ...line, savedText: text } : line))
  const polished = () => act(() => api.emit(postEvent("subtitles", { state: "done", count: 1, dropped: 0 })))
  await waitFor(() => expect(room().lines).not.toBeNull())
  act(() => room().editSubtitle(0, "สวัสดีทุกคน"))
  // a polish ends, and the lines are read again: asked before the typed line is saved
  polished()
  await waitFor(() => expect(held).toHaveLength(1))
  await waitFor(() => expect(calls(api, "setSubtitleText")).toEqual([["setSubtitleText", FOLDER, key, "สวัสดีทุกคน"]]))
  await act(async () => {})
  // that read answers with what main kept before the save: the typed text stays, on screen and for the write
  await act(async () => held[0]!(subtitleLines()))
  expect(room().texts[0]).toBe("สวัสดีทุกคน")
  // a read asked once the save landed carries what main keeps, which the polish may have changed since: that shows
  polished()
  await waitFor(() => expect(held).toHaveLength(2))
  await act(async () => held[1]!(withSaved("สวัสดีทุกคนเลย")))
  expect(room().texts[0]).toBe("สวัสดีทุกคนเลย")
  // from then on the text main keeps is the one shown: a later polish of it shows
  polished()
  await waitFor(() => expect(held).toHaveLength(3))
  await act(async () => held[2]!(withSaved("สวัสดีทุกท่าน")))
  expect(room().texts[0]).toBe("สวัสดีทุกท่าน")
})

test("a typed line whose save fails says so, and keeps the typed text through the next read", async () => {
  const { api, room } = renderProbe({
    ...withSubtitles,
    setSubtitleText: async () => {
      throw new Error("the outline could not be saved")
    },
  })
  await waitFor(() => expect(room().lines).not.toBeNull())
  act(() => room().editSubtitle(1, "จะมารีวิวแอปใหม่"))
  await waitFor(() => expect(room().error).toBe("the outline could not be saved"))
  act(() => api.emit(postEvent("subtitles", { state: "done", count: 1, dropped: 0 })))
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  await waitFor(() => expect(room().lines).not.toBeNull())
  expect(room().texts[1]).toBe("จะมารีวิวแอปใหม่")
})

test("a line typed just before the room goes is saved as it goes", async () => {
  const { api, room } = renderProbe(withSubtitles)
  await waitFor(() => expect(room().lines).not.toBeNull())
  act(() => room().editSubtitle(2, "ขอบคุณครับ"))
  cleanup()
  expect(calls(api, "setSubtitleText")).toEqual([["setSubtitleText", FOLDER, subtitleLines()[2]!.key, "ขอบคุณครับ"]])
})

/* how a write's end is told */

/** A room opened on a write that is running, so it follows it: the button says so, and what the room reads for the page is in. */
async function renderFollowing() {
  const room = renderRoom({ writingTimeline: async () => true })
  await postReady()
  await screen.findByRole("button", { name: t("write.writing") })
  await waitFor(() => expect(calls(room.api, "previewHighlights").length).toBeGreaterThan(0))
  await act(async () => {})
  return room
}

test("a write that ends is told by a toast: what was written, then what it left out, each in its words", async () => {
  const { api } = await renderFollowing()
  const result = {
    ...(await writeResult()),
    dropped: { sounds: 1, zooms: 0, inserts: 2, graphics: 0 },
    zoomsLost: 1,
    proLeftOut: { exits: 1, sounds: 2 },
  }
  act(() => api.emit(writeEvent({ state: "done", result })))
  // a kind with nothing left out says nothing of it
  const said = [
    t("write.done", { pieces: 5, duration: "0:12" }),
    t("write.resultDropped", { what: t("flair.sound"), count: 1 }),
    t("write.resultDropped", { what: t("flair.insert"), count: 2 }),
    t("write.zoomsLost", { count: 1 }),
    t("write.proLeftOut", { exits: 1, sounds: 2 }),
  ].join(" · ")
  expect(toasts()).toEqual([said])
  expect(toasts()).toEqual([toldMessage(result)])
})

test("an end with nothing to add is told for the toast's own time; one with notes, or with graphics left out, stays ACTION_TOAST_MS", async () => {
  const plain = await writeResult()
  const cases: [what: string, result: WriteResult, stays: number][] = [
    ["nothing left out", plain, 6_000],
    ["a kind dropped", { ...plain, dropped: { ...plain.dropped, sounds: 1 } }, ACTION_TOAST_MS],
    ["zooms lost", { ...plain, zoomsLost: 1 }, ACTION_TOAST_MS],
    ["Pro items left out", { ...plain, proLeftOut: { exits: 0, sounds: 1 } }, ACTION_TOAST_MS],
    ["graphics left out", { ...plain, graphicCount: 1, graphicsSkipped: 1 }, ACTION_TOAST_MS],
  ]
  for (const [what, result, stays] of cases) {
    const { api } = await renderFollowing()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    act(() => api.emit(writeEvent({ state: "done", result })))
    expect(toasts(), what).toEqual([toldMessage(result)])
    act(() => vi.advanceTimersByTime(stays - 1))
    expect(toasts(), `${what}, just before ${stays} ms`).toEqual([toldMessage(result)])
    act(() => vi.advanceTimersByTime(1))
    expect(toasts(), `${what}, at ${stays} ms`).toEqual([])
    vi.useRealTimers()
    cleanup()
  }
})

test("the toast counts the graphics the write placed, and the ones a failed render kept out", async () => {
  const toldFor = async (graphicCount: number, graphicsSkipped: number) => {
    const { api } = await renderFollowing()
    const result = { ...(await writeResult()), graphicCount, graphicsSkipped }
    act(() => api.emit(writeEvent({ state: "done", result })))
    const text = (await screen.findByRole("status")).textContent
    cleanup()
    return text
  }
  expect(await toldFor(2, 0)).toBe(t("write.doneGraphics", { pieces: 5, duration: "0:12", graphics: 2 }))
  expect(await toldFor(2, 1)).toBe(t("write.doneGraphicsSkipped", { pieces: 5, duration: "0:12", graphics: 2, skipped: 1 }))
  expect(await toldFor(0, 3)).toBe(t("write.doneGraphicsAllSkipped", { pieces: 5, duration: "0:12", skipped: 3 }))
})

test("a write of the room's own is told only once the project is read again: until then the button keeps saying กำลังเขียน… and no toast shows", async () => {
  const result = await writeResult()
  // the read of the project after the write is held; the one that opened the room was not
  let afterWrite = false
  let release!: () => void
  const { api } = renderRoom({
    writeTimeline: async () => {
      afterWrite = true
      return result
    },
    inspectProject: () => (afterWrite ? new Promise<ProjectDetail>((resolve) => (release = () => resolve(detail()))) : Promise.resolve(detail())),
  })
  await writeNow()
  await waitFor(() => expect(typeof release).toBe("function"))
  // the write answered, but the timeline count the next write is checked against is not read yet: no confirm can be pressed, and none is lost
  expect(writingButton()).toHaveProperty("disabled", true)
  expect(toasts()).toEqual([])
  expect(calls(api, "writeTimeline")).toHaveLength(1)
  await act(async () => release())
  expect(toasts()).toEqual([t("write.done", { pieces: 5, duration: "0:12" })])
  expect(againButton()).toHaveProperty("disabled", false)
})

test("a success toast is gone the moment the next write starts, and each write's toast has its whole time though two say the same words", async () => {
  const result = await writeResult()
  let asked = 0
  let answer!: (result: WriteResult) => void
  const { api, room } = renderProbe({
    writeTimeline: () => {
      asked += 1
      // the first answers at once, the second waits to be answered
      return asked === 1 ? Promise.resolve(result) : new Promise<WriteResult>((resolve) => (answer = resolve))
    },
  })
  await waitFor(() => expect(room().writeKnown).toBe(true))
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const write = () => room().runWrite(() => api.writeTimeline(FOLDER, settingsView().cut, 0, null, null))
  const told = t("write.done", { pieces: 5, duration: "0:12" })
  await act(async () => {
    await write()
  })
  expect(toasts()).toEqual([told])
  // most of its time goes, and another write starts: what the last one told is over
  act(() => vi.advanceTimersByTime(4_000))
  let second!: Promise<void>
  act(() => {
    second = write()
  })
  expect(toasts()).toEqual([])
  await act(async () => {
    answer(result)
    await second
  })
  expect(toasts()).toEqual([told])
  // its time starts when it ends: the 2 s the first had left do not cut it short
  act(() => vi.advanceTimersByTime(5_999))
  expect(toasts()).toEqual([told])
  act(() => vi.advanceTimersByTime(1))
  expect(toasts()).toEqual([])
})

test("the same holds for a write the room follows: its start takes away what the last one told, a failure too, and each end has its whole time", async () => {
  const result = await writeResult()
  const { api } = renderRoom()
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const told = t("write.done", { pieces: 5, duration: "0:12" })
  act(() => api.emit(writeEvent({ state: "started" })))
  act(() => api.emit(writeEvent({ state: "done", result })))
  expect(toasts()).toEqual([told])
  act(() => vi.advanceTimersByTime(4_000))
  act(() => api.emit(writeEvent({ state: "started" })))
  expect(toasts()).toEqual([])
  act(() => api.emit(writeEvent({ state: "done", result })))
  expect(toasts()).toEqual([told])
  act(() => vi.advanceTimersByTime(5_999))
  expect(toasts()).toEqual([told])
  act(() => vi.advanceTimersByTime(1))
  expect(toasts()).toEqual([])
  // a failure is over as well once another write starts
  act(() => api.emit(writeEvent({ state: "started" })))
  act(() => api.emit(writeEvent({ state: "failed", error: "the graphics were stopped" })))
  expect(toasts()).toEqual([t("write.failed", { message: "the graphics were stopped" })])
  act(() => api.emit(writeEvent({ state: "started" })))
  expect(toasts()).toEqual([])
})

test("a write of the room's own that fails is told by a toast for ACTION_TOAST_MS, and by no notice on the page; the button is ready to write again", async () => {
  let fail!: (error: Error) => void
  const { api } = renderRoom({ writeTimeline: () => new Promise<WriteResult>((_resolve, reject) => (fail = reject)) })
  await writeNow()
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(1))
  expect(writingButton()).toHaveProperty("disabled", true)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  await act(async () => fail(new Error("CapCut is running")))
  const said = t("write.failed", { message: "CapCut is running" })
  expect(toasts()).toEqual([said])
  // failed, not written: the button reads as it did before the write
  expect(writeButton()).toHaveProperty("disabled", false)
  // the toast is the one place that says it
  const carriers = screen.getAllByText(/CapCut is running/)
  expect(carriers).toHaveLength(1)
  expect(carriers[0]!.closest('[role="status"]')).not.toBeNull()
  // the event of that same write, late: it adds nothing
  act(() => api.emit(writeEvent({ state: "failed", error: "CapCut is running, said again" })))
  expect(toasts()).toEqual([said])
  // it stays as long as it takes to read, though a graphic made meanwhile renders the room again
  act(() => vi.advanceTimersByTime(5_000))
  await act(async () => api.emit({ type: "graphics", folder: FOLDER, state: "done" }))
  act(() => vi.advanceTimersByTime(ACTION_TOAST_MS - 5_000 - 1))
  expect(toasts()).toEqual([said])
  act(() => vi.advanceTimersByTime(1))
  expect(toasts()).toEqual([])
})

test("a write the room follows that fails is told the same way: a toast for ACTION_TOAST_MS, the button ready to write again, no notice on the page", async () => {
  const { api } = await renderFollowing()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const stopped = "the graphics were stopped before they were made; the draft was not changed"
  act(() => api.emit(writeEvent({ state: "failed", error: stopped })))
  const said = t("write.failed", { message: stopped })
  expect(toasts()).toEqual([said])
  expect(writeButton()).toHaveProperty("disabled", false)
  const carriers = screen.getAllByText(new RegExp(stopped))
  expect(carriers).toHaveLength(1)
  expect(carriers[0]!.closest('[role="status"]')).not.toBeNull()
  act(() => vi.advanceTimersByTime(5_000))
  await act(async () => api.emit({ type: "graphics", folder: FOLDER, state: "done" }))
  act(() => vi.advanceTimersByTime(ACTION_TOAST_MS - 5_000 - 1))
  expect(toasts()).toEqual([said])
  act(() => vi.advanceTimersByTime(1))
  expect(toasts()).toEqual([])
})

test("a write tried again after one failed takes the failure off the screen at once, whatever comes of the new try", async () => {
  let asked = 0
  const { api } = renderRoom({
    writeTimeline: () => {
      asked += 1
      // the first try fails, the second is left running
      return asked === 1 ? Promise.reject(new Error("CapCut is running")) : new Promise<WriteResult>(() => {})
    },
  })
  await writeNow()
  const said = t("write.failed", { message: "CapCut is running" })
  await waitFor(() => expect(toasts()).toEqual([said]))
  await writeNow()
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(2))
  expect(toasts()).toEqual([])
  expect(writingButton()).toHaveProperty("disabled", true)
})

test("a write left running is followed by the room opened again, which tells its end once", async () => {
  let running = false
  renderRoom({
    writeTimeline: () => {
      running = true
      return new Promise<WriteResult>(() => {})
    },
  })
  await writeNow()
  // the user goes to the outline and back: the room goes, the write goes on
  cleanup()
  const { api } = renderRoom({ writingTimeline: async () => running })
  expect(await screen.findByRole("button", { name: t("write.writing") })).toHaveProperty("disabled", true)
  const result = await writeResult()
  running = false
  act(() => api.emit(writeEvent({ state: "done", result })))
  const told = t("write.done", { pieces: 5, duration: "0:12" })
  expect(toasts()).toEqual([told])
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
  // heard again, it is not told a second time: there is nothing left to follow
  act(() => api.emit(writeEvent({ state: "done", result: { ...result, segmentCount: 9 } })))
  expect(toasts()).toEqual([told])
})

test("a room that cannot learn whether a write is running tells its own write's end once, even when the event of it comes late", async () => {
  const { api } = renderRoom({ writingTimeline: async () => Promise.reject(new Error("no answer")) })
  await writeNow()
  const told = t("write.done", { pieces: 5, duration: "0:12" })
  await waitFor(() => expect(toasts()).toEqual([told]))
  // nothing is left to follow, so what the late event says is not told
  const late = { ...(await writeResult()), segmentCount: 9 }
  act(() => api.emit(writeEvent({ state: "done", result: late })))
  expect(toasts()).toEqual([told])
})

test("the room that started a write tells how it ended once, whether its answer or the event of its end comes first", async () => {
  const result = await writeResult()
  for (const eventFirst of [true, false]) {
    let answer!: (result: WriteResult) => void
    const { api } = renderRoom({ writeTimeline: () => new Promise<WriteResult>((resolve) => (answer = resolve)) })
    await writeNow()
    act(() => api.emit(writeEvent({ state: "started" })))
    // the event says a different length, so a second telling would show
    const late = { ...result, segmentCount: 9 }
    if (eventFirst) {
      act(() => api.emit(writeEvent({ state: "done", result: late })))
      expect(writingButton()).toHaveProperty("disabled", true)
    }
    await act(async () => answer(result))
    if (!eventFirst) act(() => api.emit(writeEvent({ state: "done", result: late })))
    expect(toasts()).toEqual([t("write.done", { pieces: 5, duration: "0:12" })])
    cleanup()
  }
})

test("a backup put back takes a write's result away, since it no longer tells what the draft holds: the button reads เขียนลง CapCut again", async () => {
  const room = renderRoom()
  await writeNow()
  await waitFor(() => expect(againButton()).toHaveProperty("disabled", false))
  // what the write told is about a draft that is no longer there once a backup is put back
  expect(toasts()).toEqual([t("write.done", { pieces: 5, duration: "0:12" })])
  const reads = calls(room.api, "inspectProject").length
  room.restore()
  await waitFor(() => expect(writeButton()).toHaveProperty("disabled", false))
  expect(within(bar()).queryByRole("button", { name: t("write.again") })).toBeNull()
  expect(toasts()).toEqual([])
  // the draft is read again, so the next write is checked against what the backup put back
  await waitFor(() => expect(calls(room.api, "inspectProject")).toHaveLength(reads + 1))
})

test("a write that ended leaves the room holding only that it was written: what it wrote was told by the toast", async () => {
  const { api, room } = renderProbe()
  await waitFor(() => expect(room().writeKnown).toBe(true))
  await act(async () => {
    await room().runWrite(() => api.writeTimeline(FOLDER, settingsView().cut, 0, null, null))
  })
  expect(room().write).toEqual({ kind: "written" })
})

/* the plan run */

const RUNNING: PostRunView = { running: true, states: { emphasis: { state: "done", count: 4, dropped: 0 }, text: { state: "running" } } }

test("a plan run going on when the room opens is read from main, its events fill it in, and each work that ends is read again", async () => {
  const { api, room } = renderProbe({ ...withSubtitles, postPlanState: async () => RUNNING })
  await waitFor(() => expect(room().run).toEqual(RUNNING))
  await waitFor(() => expect(room().preview).not.toBeNull())
  await waitFor(() => expect(room().lines).not.toBeNull())
  const previews = calls(api, "previewHighlights").length
  const lines = calls(api, "previewSubtitles").length

  act(() => api.emit(postEvent("text", { state: "done", count: 2, dropped: 0 })))
  expect(room().run.states).toEqual({ emphasis: { state: "done", count: 4, dropped: 0 }, text: { state: "done", count: 2, dropped: 0 } })
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(previews + 1))

  act(() => api.emit(postEvent("subtitles", { state: "done", count: 3, dropped: 0 })))
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(lines + 1))

  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  expect(room().run.running).toBe(false)
  // the next run sets its own works on top of how the others last stood, as main keeps them
  act(() => api.emit(postEvent("sounds", { state: "waiting" })))
  expect(room().run).toEqual({
    running: true,
    states: { emphasis: { state: "done", count: 4, dropped: 0 }, text: { state: "done", count: 2, dropped: 0 }, subtitles: { state: "done", count: 3, dropped: 0 }, sounds: { state: "waiting" } },
  })
})

test("a run that ends reads the preview again without holding the room up: main notes what it planned on only after its works are done", async () => {
  const { api, room } = renderProbe()
  await waitFor(() => expect(room().preview).not.toBeNull())
  await waitFor(() => expect(room().placing).toBe(false))
  const previews = calls(api, "previewHighlights").length
  act(() => api.emit(postEvent("sounds", { state: "skipped", reason: "off" })))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(previews + 1))
  expect(room().placing).toBe(false)
})

test("the works of the run going are known from its first event, or from the room's own call; a room that opened on a run knows none", async () => {
  const { api, room } = renderProbe({ postPlanState: async () => RUNNING, rethinkPost: () => new Promise(() => {}) })
  await waitFor(() => expect(room().run).toEqual(RUNNING))
  expect(room().runWorks).toBeNull()
  act(() => api.emit(postEvent("text", { state: "done", count: 1, dropped: 0 })))
  expect(room().runWorks).toBeNull()
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  // another's run begins
  act(() => api.emit(postEvent("sounds", { state: "waiting" })))
  act(() => api.emit(postEvent("sounds", { state: "running" })))
  expect(room().runWorks).toEqual(["sounds"])
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(room().request()).not.toBeNull())
  act(() => void room().rethink("graphics"))
  expect(room().runWorks).toEqual([])
  act(() => {
    api.emit(postEvent("text", { state: "waiting" }))
    api.emit(postEvent("techniques", { state: "waiting" }))
  })
  expect(room().runWorks).toEqual(["text", "techniques"])
})

test("with the lines hiding the text, a points work that is done reads them again, and so does a run that ends", async () => {
  const { api, room } = renderProbe({ getSettings: async () => hidingUnderText() })
  await waitFor(() => expect(room().lines).not.toBeNull())
  const read = calls(api, "previewSubtitles").length
  // new points drop Claude's text on the old ones and change what passes the level: the words hidden change
  act(() => api.emit(postEvent("emphasis", { state: "done", count: 3, dropped: 0 })))
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(read + 1))
  await waitFor(() => expect(room().lines).not.toBeNull())
  // a run that ends, stopped or failed part way, is read for what it left
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(read + 2))
})

test("an answer about the run that comes after its events is out of date, and another project's events change nothing", async () => {
  let answer!: (view: PostRunView | null) => void
  const { api, room } = renderProbe({ postPlanState: () => new Promise<PostRunView | null>((resolve) => (answer = resolve)) })
  await waitFor(() => expect(calls(api, "postPlanState")).toHaveLength(1))
  act(() => api.emit({ type: "post-plan", folder: "/drafts/0815", work: "sounds", state: { state: "running" } }))
  expect(room().run).toEqual({ running: false, states: {} })
  act(() => api.emit(postEvent("sounds", { state: "running" })))
  await act(async () => answer({ running: false, states: {} }))
  expect(room().run).toEqual({ running: true, states: { sounds: { state: "running" } } })
})

test("the plan run is asked with the settings on screen, and ends as main says", async () => {
  const ended: PostRunView = { running: false, states: { emphasis: { state: "done", count: 3, dropped: 1 } } }
  const { api, room } = renderProbe({
    getSettings: async () =>
      settingsView({
        subtitles: { enabled: true, length: "line", polish: true },
        highlights: { enabled: true, position: "bottom", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
      }),
    planPost: async () => ended,
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await act(async () => {
    await room().planPost()
  })
  expect(calls(api, "planPost")).toEqual([
    [
      "planPost",
      FOLDER,
      {
        rules: settingsView().cut,
        view: { position: "bottom", subtitlesOn: true, highlightsOn: true, flair: settingsView().flair },
        subtitles: { length: "line", polish: true, hideUnderHighlights: true },
      },
    ],
  ])
  expect(room().run).toEqual(ended)
})

test("thinking one work again asks for that work alone, and the points go through planEmphasis", async () => {
  const { api, room } = renderProbe({ rethinkPost: async () => ({ running: false, states: {} }), planEmphasis: async () => ({ count: 2, dropped: 0 }) })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await act(async () => {
    await room().rethink("sounds")
  })
  await act(async () => {
    await room().rethink("emphasis")
  })
  expect(calls(api, "rethinkPost")).toEqual([["rethinkPost", FOLDER, "sounds", room().request()]])
  expect(calls(api, "planEmphasis")).toEqual([["planEmphasis", FOLDER, settingsView().cut]])
  // once when the room opened, once after the points: planEmphasis answers counts, main knows how the run ended
  expect(calls(api, "postPlanState")).toHaveLength(2)
  expect(room().run.running).toBe(false)
})

// where a graphic sits, which is how the main process finds it
const GRAPHIC_AT: CueAnchor = { kind: "speech", videoId: "a", sourceUs: 2_500_000, beatId: "b1" }
// the room's mark of that graphic being written again, from its idea or with a change the user asked for
const REDOING = { anchor: GRAPHIC_AT, how: "redo" }
const EDITING = { anchor: GRAPHIC_AT, how: "edit" }

test("one graphic written again is asked for by its place, with the request a plan is asked with, and ends as main says", async () => {
  const ended: PostRunView = { running: false, states: { sounds: { state: "failed", error: "Claude is busy" }, graphics: { state: "done", count: 1, dropped: 0 } } }
  let finish!: () => void
  const { api, room } = renderProbe({
    postPlanState: async () => ({ running: false, states: { sounds: { state: "failed", error: "Claude is busy" } } }),
    redoGraphic: () => new Promise<PostRunView>((resolve) => (finish = () => resolve(ended))),
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await waitFor(() => expect(room().run.states.sounds).toBeDefined())
  let going!: Promise<void>
  act(() => {
    going = room().redoGraphic(GRAPHIC_AT)
  })
  expect(calls(api, "redoGraphic")).toEqual([["redoGraphic", FOLDER, GRAPHIC_AT, room().request()]])
  // a run of its own: it goes from the moment it is asked, its works come with its events, and the other works keep how they last ended
  expect(room().run).toEqual({ running: true, states: { sounds: { state: "failed", error: "Claude is busy" } } })
  expect(room().runWorks).toEqual([])
  act(() => api.emit(postEvent("graphics", { state: "running", done: 0, total: 1 })))
  expect(room().runWorks).toEqual(["graphics"])
  await act(async () => {
    finish()
    await going
  })
  expect(room().run).toEqual(ended)
  expect(room().error).toBeNull()
})

/** The preview reads of a room: answered at once until `holding` is set, then each waits to be let land, the latest last, or to fail. */
function heldReads() {
  const held: { land: () => void; fail: () => void }[] = []
  const control = {
    holding: false,
    held,
    read: (): Promise<HighlightPreview> =>
      control.holding
        ? new Promise<HighlightPreview>((resolve, reject) => held.push({ land: () => resolve(highlightPreview()), fail: () => reject(new Error("preview broke")) }))
        : Promise.resolve(highlightPreview()),
    land: () => act(async () => held.splice(0).forEach((read) => read.land())),
    fail: () => act(async () => held.splice(0).forEach((read) => read.fail())),
  }
  return control
}

test("the room knows which graphic is being written again, by its place, from the press until the read that follows the run's end has landed or failed; nothing else is being written meanwhile", async () => {
  const ended: PostRunView = { running: false, states: { graphics: { state: "done", count: 1, dropped: 0 } } }
  for (const lands of [true, false]) {
    const previews = heldReads()
    let finish!: () => void
    const { api, room } = renderProbe({ previewHighlights: previews.read, redoGraphic: () => new Promise<PostRunView>((resolve) => (finish = () => resolve(ended))) })
    await waitFor(() => expect(room().request()).not.toBeNull())
    await waitFor(() => expect(room().preview).not.toBeNull())
    expect([room().rewriting, room().writingGraphics]).toEqual([null, false])
    let going!: Promise<void>
    act(() => {
      going = room().redoGraphic(GRAPHIC_AT)
    })
    expect(room().rewriting).toEqual(REDOING)
    // as main plays a redo, whose own count is read in the middle of it
    act(() => api.emit(postEvent("graphics", { state: "waiting" })))
    act(() => api.emit(postEvent("graphics", { state: "running" })))
    act(() => api.emit(postEvent("graphics", { state: "running", done: 0, total: 1 })))
    await act(async () => {})
    // the graphics work that runs is the redo's, which writes the one graphic: no plan run is writing the ones not written yet
    expect([room().rewriting, room().writingGraphics]).toEqual([REDOING, false])
    previews.holding = true
    act(() => api.emit(postEvent("graphics", { state: "running", done: 1, total: 1 })))
    act(() => api.emit(postEvent("graphics", { state: "done", count: 1, dropped: 0 })))
    act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
    await act(async () => {
      finish()
      await going
    })
    // the run is over as main says, and the read that follows its end is still out
    expect(room().run).toEqual(ended)
    expect(room().rewriting).toEqual(REDOING)
    await (lands ? previews.land() : previews.fail())
    expect(room().rewriting, lands ? "landed" : "failed").toBeNull()
    // the redo is over: a graphics work that runs after it is another run's, which writes every graphic not written yet
    act(() => api.emit(postEvent("graphics", { state: "running" })))
    expect(room().writingGraphics).toBe(true)
    cleanup()
  }
})

/**
 * Preview reads answered by hand. The fake hands back a thenable, not a promise, so the room's own handlers are kept
 * as it gives them, and a test lands a read by calling them, at the very place it chooses. A promise's answer is a
 * microtask, which `act` runs only once it has flushed the effects: it cannot land between an event and the read
 * that event asks for. This can, as an answer from the main process can in the app.
 */
function handReads() {
  const asked: { land: () => void; fail: () => void }[] = []
  const read = (): Promise<HighlightPreview> =>
    ({
      then: (landed: (preview: HighlightPreview) => void, failed: (error: Error) => void) => {
        asked.push({ land: () => landed(highlightPreview()), fail: () => failed(new Error("preview broke")) })
      },
    }) as unknown as Promise<HighlightPreview>
  return { asked, read }
}

test("a read asked before a writing's end, whose answer comes after it, does not take off what says the graphic is being written: only a read asked after the end does", async () => {
  const ended: PostRunView = { running: false, states: { graphics: { state: "done", count: 1, dropped: 0 } } }
  for (const answer of ["land", "fail"] as const) {
    const reads = handReads()
    let finish!: () => void
    const { api, room } = renderProbe({ previewHighlights: reads.read, redoGraphic: () => new Promise<PostRunView>((resolve) => (finish = () => resolve(ended))) })
    await waitFor(() => expect(room().request()).not.toBeNull())
    // the read the room opens with
    await waitFor(() => expect(reads.asked).toHaveLength(1))
    act(() => reads.asked[0]!.land())
    expect(room().preview).not.toBeNull()
    let going!: Promise<void>
    act(() => {
      going = room().redoGraphic(GRAPHIC_AT)
    })
    act(() => api.emit(postEvent("graphics", { state: "waiting" })))
    act(() => api.emit(postEvent("graphics", { state: "running" })))
    act(() => api.emit(postEvent("graphics", { state: "running", done: 0, total: 1 })))
    act(() => reads.asked[1]!.land())
    // the writing is stored and counted: that count's read is still out when the work ends
    act(() => api.emit(postEvent("graphics", { state: "running", done: 1, total: 1 })))
    expect(reads.asked).toHaveLength(3)
    // the work ends, and the earlier read is answered before the room has asked the read that follows the end
    act(() => {
      api.emit(postEvent("graphics", { state: "done", count: 1, dropped: 0 }))
      reads.asked[2]![answer]()
    })
    expect(reads.asked, answer).toHaveLength(4)
    // what it brought was read before the end: the graphic goes on being the one written
    expect(room().rewriting, answer).toEqual(REDOING)
    act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
    expect(reads.asked, answer).toHaveLength(5)
    await act(async () => {
      finish()
      await going
    })
    // the read asked at the work's end was overtaken by the one asked at the run's end, which is the one to wait for
    act(() => reads.asked[3]!.land())
    expect(room().rewriting, answer).toEqual(REDOING)
    act(() => reads.asked[4]!.land())
    expect(room().rewriting, answer).toBeNull()
    cleanup()
  }
})

test("a writing that begins while the read after the last run's end is still out is not taken for over when that read lands", async () => {
  /** A room whose plan run has written its graphics and ended, with the read that follows still out. */
  const ended = async (overrides: Partial<RendererApi> = {}) => {
    const previews = heldReads()
    const { api, room } = renderProbe({ previewHighlights: previews.read, ...overrides })
    await waitFor(() => expect(room().request()).not.toBeNull())
    await waitFor(() => expect(room().preview).not.toBeNull())
    act(() => api.emit(postEvent("graphics", { state: "running" })))
    previews.holding = true
    act(() => api.emit(postEvent("graphics", { state: "done", count: 1, dropped: 0 })))
    act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
    expect([room().rewriting, room().writingGraphics]).toEqual([null, true])
    return { api, room, previews }
  }

  // the user has one graphic written again before that read lands: from the press that one alone is being written
  const redo = await ended({ redoGraphic: () => new Promise<PostRunView>(() => {}) })
  act(() => void redo.room().redoGraphic(GRAPHIC_AT))
  expect([redo.room().rewriting, redo.room().writingGraphics]).toEqual([REDOING, false])
  await redo.previews.land()
  expect(redo.room().rewriting).toEqual(REDOING)
  cleanup()

  // or another run's graphics work begins to write before it lands
  const next = await ended()
  act(() => next.api.emit(postEvent("graphics", { state: "waiting" })))
  act(() => next.api.emit(postEvent("graphics", { state: "running" })))
  await next.previews.land()
  expect(next.room().writingGraphics).toBe(true)
})

test("a room opened on a run whose graphics work is running takes it for a plan run's, since main does not say it is a redo, nor of which graphic; that writing too is held until the read that follows the work's end has landed", async () => {
  const previews = heldReads()
  const { api, room } = renderProbe({ previewHighlights: previews.read, postPlanState: async () => ({ running: true, states: { graphics: { state: "running", done: 0, total: 1 } } }) })
  await waitFor(() => expect(room().run.running).toBe(true))
  await waitFor(() => expect(room().preview).not.toBeNull())
  expect([room().rewriting, room().writingGraphics]).toEqual([null, true])
  previews.holding = true
  act(() => api.emit(postEvent("graphics", { state: "done", count: 1, dropped: 0 })))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  expect(room().run.running).toBe(false)
  expect(room().writingGraphics).toBe(true)
  await previews.land()
  expect(room().writingGraphics).toBe(false)
})

test("a redo refused because a plan run goes puts back what its press took off: that run's graphics work is still writing", async () => {
  let asked = 0
  const going: PostRunView = { running: true, states: { graphics: { state: "running", done: 0, total: 2 } } }
  const { api, room } = renderProbe({
    // how the run stands, asked as the room opens, is not answered yet; asked again after the refusal, it is
    postPlanState: () => (asked++ === 0 ? new Promise<PostRunView | null>(() => {}) : Promise.resolve(going)),
    redoGraphic: async () => {
      throw new Error("Error invoking remote method 'api:redoGraphic': Error: a plan for this project is already running")
    },
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  // a room just opened on a plan run: the first it hears of the run is its graphics work's count
  act(() => api.emit(postEvent("graphics", { state: "running", done: 0, total: 2 })))
  expect([room().rewriting, room().writingGraphics]).toEqual([null, true])
  // pressed before the page shows the run
  await act(async () => {
    await room().redoGraphic(GRAPHIC_AT)
  })
  expect(room().error).toBe(t("post.alreadyRunning"))
  expect(room().run).toEqual(going)
  // no graphic is being written again, and the plan run goes on writing the ones not written yet
  expect([room().rewriting, room().writingGraphics]).toEqual([null, true])
  cleanup()

  // what the press took off was a writing already over, held only for the read after its end: it is not put back,
  // since that read may be in by then and nothing else would take it off again
  const previews = heldReads()
  const over = renderProbe({
    previewHighlights: previews.read,
    redoGraphic: async () => {
      throw new Error("Error invoking remote method 'api:redoGraphic': Error: the outline could not be read")
    },
  })
  await waitFor(() => expect(over.room().request()).not.toBeNull())
  await waitFor(() => expect(over.room().preview).not.toBeNull())
  act(() => over.api.emit(postEvent("graphics", { state: "running" })))
  previews.holding = true
  act(() => over.api.emit(postEvent("graphics", { state: "done", count: 1, dropped: 0 })))
  act(() => over.api.emit({ type: "post-plan-finished", folder: FOLDER }))
  expect(over.room().writingGraphics).toBe(true)
  await act(async () => {
    await over.room().redoGraphic(GRAPHIC_AT)
  })
  expect([over.room().rewriting, over.room().writingGraphics]).toEqual([null, false])
  await previews.land()
  expect(over.room().writingGraphics).toBe(false)
})

test("a graphic main refuses to write again while another run goes says why, leaves the run as main says it stands, and marks no graphic as being written; one the user stopped is no error", async () => {
  let reads = 0
  const going: PostRunView = { running: true, states: { sounds: { state: "running" } } }
  const { room } = renderProbe({
    // none when the room opens; another of this project's runs going by the time this one is refused
    postPlanState: async () => (reads++ === 0 ? null : going),
    redoGraphic: async () => {
      throw new Error("Error invoking remote method 'api:redoGraphic': Error: a plan for this project is already running")
    },
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await act(async () => {
    await room().redoGraphic(GRAPHIC_AT)
  })
  expect(room().error).toBe(t("post.alreadyRunning"))
  expect(room().run).toEqual(going)
  // no run of its own began, so no read follows to take the mark off: it goes with the refusal
  expect(room().rewriting).toBeNull()
  cleanup()

  // stopped: main ends the graphics work as failed with the user's stop, ends the run, and answers with how it stands
  const stoppedRun: PostRunView = { running: false, states: { graphics: { state: "failed", error: "cancelled" } } }
  let answer!: () => void
  const previews = heldReads()
  const stopped = renderProbe({ previewHighlights: previews.read, redoGraphic: () => new Promise<PostRunView>((resolve) => (answer = () => resolve(stoppedRun))) })
  await waitFor(() => expect(stopped.room().request()).not.toBeNull())
  await waitFor(() => expect(stopped.room().preview).not.toBeNull())
  let asked!: Promise<void>
  act(() => {
    asked = stopped.room().redoGraphic(GRAPHIC_AT)
  })
  act(() => stopped.api.emit(postEvent("graphics", { state: "waiting" })))
  act(() => stopped.api.emit(postEvent("graphics", { state: "running" })))
  act(() => stopped.api.emit(postEvent("graphics", { state: "running", done: 0, total: 1 })))
  await act(async () => {})
  previews.holding = true
  act(() => stopped.api.emit(postEvent("graphics", { state: "failed", error: "cancelled" })))
  act(() => stopped.api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => {
    answer()
    await asked
  })
  expect(stopped.room().error).toBeNull()
  expect(stopped.room().run).toEqual(stoppedRun)
  // stopped, its end is held like any other: the graphic is the one being written until the read that follows is in
  expect(stopped.room().rewriting).toEqual(REDOING)
  await previews.land()
  expect(stopped.room().rewriting).toBeNull()
})

/* a graphic changed as the user asks, and one step back */

test("a graphic changed as the user asks is asked for by its place and the change, with the request a plan is asked with, as a run of its own that ends as main says", async () => {
  const ended: PostRunView = { running: false, states: { sounds: { state: "failed", error: "Claude is busy" }, graphics: { state: "done", count: 1, dropped: 0 } } }
  let finish!: () => void
  const { api, room } = renderProbe({
    postPlanState: async () => ({ running: false, states: { sounds: { state: "failed", error: "Claude is busy" } } }),
    editGraphic: () => new Promise<PostRunView>((resolve) => (finish = () => resolve(ended))),
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await waitFor(() => expect(room().run.states.sounds).toBeDefined())
  let going!: Promise<void>
  act(() => {
    going = room().editGraphic(GRAPHIC_AT, "ตัวเลขใหญ่ขึ้น")
  })
  expect(calls(api, "editGraphic")).toEqual([["editGraphic", FOLDER, GRAPHIC_AT, "ตัวเลขใหญ่ขึ้น", room().request()]])
  expect(calls(api, "redoGraphic")).toEqual([])
  // a run of its own, as a redo is: it goes from the moment it is asked, and the other works keep how they last ended
  expect(room().run).toEqual({ running: true, states: { sounds: { state: "failed", error: "Claude is busy" } } })
  expect(room().runWorks).toEqual([])
  act(() => api.emit(postEvent("graphics", { state: "running", done: 0, total: 1 })))
  expect(room().runWorks).toEqual(["graphics"])
  await act(async () => {
    finish()
    await going
  })
  expect(room().run).toEqual(ended)
  expect(room().error).toBeNull()
})

test("the room knows which graphic is being changed, and that it is a change and not a redo, from the press until the read that follows the run's end has landed or failed", async () => {
  const ended: PostRunView = { running: false, states: { graphics: { state: "done", count: 1, dropped: 0 } } }
  for (const lands of [true, false]) {
    const previews = heldReads()
    let finish!: () => void
    const { api, room } = renderProbe({ previewHighlights: previews.read, editGraphic: () => new Promise<PostRunView>((resolve) => (finish = () => resolve(ended))) })
    await waitFor(() => expect(room().request()).not.toBeNull())
    await waitFor(() => expect(room().preview).not.toBeNull())
    let going!: Promise<void>
    act(() => {
      going = room().editGraphic(GRAPHIC_AT, "ช้าลงครึ่งหนึ่ง")
    })
    expect(room().rewriting).toEqual(EDITING)
    act(() => api.emit(postEvent("graphics", { state: "waiting" })))
    act(() => api.emit(postEvent("graphics", { state: "running" })))
    act(() => api.emit(postEvent("graphics", { state: "running", done: 0, total: 1 })))
    await act(async () => {})
    // the graphics work that runs is the edit's, which writes the one graphic: no plan run is writing the ones not written yet
    expect([room().rewriting, room().writingGraphics]).toEqual([EDITING, false])
    previews.holding = true
    act(() => api.emit(postEvent("graphics", { state: "running", done: 1, total: 1 })))
    act(() => api.emit(postEvent("graphics", { state: "done", count: 1, dropped: 0 })))
    act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
    await act(async () => {
      finish()
      await going
    })
    expect(room().run).toEqual(ended)
    expect(room().rewriting).toEqual(EDITING)
    await (lands ? previews.land() : previews.fail())
    expect(room().rewriting, lands ? "landed" : "failed").toBeNull()
    cleanup()
  }
})

test("an edit main refuses says why in Thai, takes its mark off the graphic, and puts back what its press took off a plan run's writing", async () => {
  let asked = 0
  let refuse!: () => void
  const going: PostRunView = { running: true, states: { graphics: { state: "running", done: 0, total: 2 } } }
  const { api, room } = renderProbe({
    // how the run stands, asked as the room opens, is not answered yet; asked again after the refusal, it is
    postPlanState: () => (asked++ === 0 ? new Promise<PostRunView | null>(() => {}) : Promise.resolve(going)),
    editGraphic: () =>
      new Promise<PostRunView>((_, reject) => (refuse = () => reject(new Error("Error invoking remote method 'api:editGraphic': Error: a plan for this project is already running")))),
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  // a room just opened on a plan run: the first it hears of the run is its graphics work's count
  act(() => api.emit(postEvent("graphics", { state: "running", done: 0, total: 2 })))
  let pressed!: Promise<void>
  act(() => {
    pressed = room().editGraphic(GRAPHIC_AT, "ช้าลง")
  })
  expect([room().rewriting, room().writingGraphics]).toEqual([EDITING, false])
  await act(async () => {
    refuse()
    await pressed
  })
  expect(room().error).toBe(t("post.alreadyRunning"))
  expect(room().run).toEqual(going)
  // no run of its own began, so no read follows to take the mark off: it goes with the refusal
  expect([room().rewriting, room().writingGraphics]).toEqual([null, true])
})

test("a step back asks main by the graphic's place, then reads the graphics again quietly: it is no run, and marks no graphic as being written", async () => {
  let answer!: () => void
  const { api, room } = renderProbe({ undoGraphic: () => new Promise<void>((resolve) => (answer = resolve)) })
  await waitFor(() => expect(room().preview).not.toBeNull())
  await waitFor(() => expect(room().placing).toBe(false))
  const reads = calls(api, "previewHighlights").length
  let going!: Promise<void>
  act(() => {
    going = room().undoGraphic(GRAPHIC_AT)
  })
  expect(calls(api, "undoGraphic")).toEqual([["undoGraphic", FOLDER, GRAPHIC_AT]])
  // a change of the user's being saved, as switching a graphic off is: the page's controls wait for it
  expect(room().editing).toBe(true)
  expect([room().run.running, room().rewriting, room().writingGraphics]).toEqual([false, null, false])
  expect(calls(api, "previewHighlights")).toHaveLength(reads)
  await act(async () => {
    answer()
    await going
  })
  expect(room().editing).toBe(false)
  expect(calls(api, "previewHighlights")).toHaveLength(reads + 1)
  // read for the graphics alone, which holds nothing up
  expect(room().placing).toBe(false)
  expect(room().error).toBeNull()
  expect(calls(api, "postPlanState")).toHaveLength(1)
})

test("a step back main refuses says why in Thai, and reads nothing again", async () => {
  const refusals: [string, string][] = [
    ["this graphic has nothing to go back to", t("graphics.refused.nothingBack")],
    ["a plan for this project is already running", t("post.alreadyRunning")],
  ]
  for (const [message, said] of refusals) {
    const { api, room } = renderProbe({
      undoGraphic: async () => {
        throw new Error(`Error invoking remote method 'api:undoGraphic': Error: ${message}`)
      },
    })
    await waitFor(() => expect(room().preview).not.toBeNull())
    await waitFor(() => expect(room().placing).toBe(false))
    const reads = calls(api, "previewHighlights").length
    await act(async () => {
      await room().undoGraphic(GRAPHIC_AT)
    })
    expect(room().error, message).toBe(said)
    expect(room().editing, message).toBe(false)
    expect(calls(api, "previewHighlights"), message).toHaveLength(reads)
    cleanup()
  }
})

test("thinking the points again keeps how the other works last ended: a failed sounds work still shows failed, as main still says", async () => {
  const failed: PostRunView = { running: false, states: { sounds: { state: "failed", error: "Claude is busy" } } }
  let state: PostRunView | null = failed
  let finish!: () => void
  const { api, room } = renderProbe({
    postPlanState: async () => state,
    planEmphasis: () => new Promise<{ count: number; dropped: number }>((resolve) => (finish = () => resolve({ count: 2, dropped: 0 }))),
  })
  await waitFor(() => expect(room().run).toEqual(failed))
  await waitFor(() => expect(room().request()).not.toBeNull())
  let going!: Promise<void>
  act(() => {
    going = room().rethink("emphasis")
  })
  // while the points are thought again, the sounds tab keeps its mark
  await waitFor(() => expect(room().run).toEqual({ running: true, states: failed.states }))
  state = { running: false, states: { ...failed.states, emphasis: { state: "done", count: 2, dropped: 0 } } }
  await act(async () => {
    finish()
    await going
  })
  expect(room().run).toEqual(state)
  // a new run's first event adds its work to the states it had, rather than starting a list afresh
  act(() => api.emit(postEvent("emphasis", { state: "running" })))
  expect(room().run).toEqual({ running: true, states: { sounds: { state: "failed", error: "Claude is busy" }, emphasis: { state: "running" } } })
})

test("a run main refuses leaves the run as main says it stands, and says why", async () => {
  let reads = 0
  const going: PostRunView = { running: true, states: { sounds: { state: "running" } } }
  const { room } = renderProbe({
    // none when the room opens; another of this project's runs going by the time this one is refused
    postPlanState: async () => (reads++ === 0 ? null : going),
    planPost: async () => {
      throw new Error("a plan for this project is already running")
    },
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await act(async () => {
    await room().planPost()
  })
  // said in Thai, not in main's own words
  expect(room().error).toBe(t("post.alreadyRunning"))
  expect(room().run).toEqual(going)
})

test("points thought again that main refuses, since another run goes, say why: the other run's points are not their failure", async () => {
  let reads = 0
  const { room } = renderProbe({
    postPlanState: async () => (reads++ === 0 ? null : { running: true, states: { emphasis: { state: "running" } } }),
    planEmphasis: async () => {
      throw new Error("Error invoking remote method 'api:planEmphasis': Error: a plan for this project is already running")
    },
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await act(async () => {
    await room().rethink("emphasis")
  })
  expect(room().error).toBe(t("post.alreadyRunning"))
})

test("the points thought again stand when main cannot say how the run ended: no error, and the marks stay as the events left them", async () => {
  let reads = 0
  let finish!: () => void
  const { api, room } = renderProbe({
    postPlanState: () => (reads++ === 0 ? Promise.resolve(null) : Promise.reject(new Error("no answer"))),
    planEmphasis: () => new Promise<{ count: number; dropped: number }>((resolve) => (finish = () => resolve({ count: 2, dropped: 0 }))),
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  let going!: Promise<void>
  act(() => {
    going = room().rethink("emphasis")
  })
  act(() => api.emit(postEvent("emphasis", { state: "done", count: 2, dropped: 0 })))
  await act(async () => {
    finish()
    await going
  })
  expect(room().error).toBeNull()
  expect(room().run).toEqual({ running: false, states: { emphasis: { state: "done", count: 2, dropped: 0 } } })
})

test("a run the user stopped is no error; one refused says why", async () => {
  const { room } = renderProbe({
    planPost: async () => {
      throw new Error("Error invoking remote method 'api:planPost': Error: cancelled")
    },
  })
  await waitFor(() => expect(room().request()).not.toBeNull())
  await act(async () => {
    await room().planPost()
  })
  expect(room().error).toBeNull()
  expect(room().run.running).toBe(false)
  cleanup()

  const refused = renderProbe({
    planPost: async () => {
      throw new Error("a plan for this project is already running")
    },
  })
  await waitFor(() => expect(refused.room().request()).not.toBeNull())
  await act(async () => {
    await refused.room().planPost()
  })
  expect(refused.room().error).toBe(t("post.alreadyRunning"))
})
