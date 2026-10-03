import { afterEach, expect, test, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type {
  AppEvent,
  ComposedSoundView,
  EmphasisPointView,
  EmphasisSceneView,
  EmphasisSentenceView,
  EmphasisView,
  FlairOptions,
  GraphicView,
  HighlightGroupView,
  HighlightPreview,
  InsertView,
  MoveView,
  PostRequest,
  PostRunView,
  PostWork,
  PostWorkState,
  RendererApi,
  WriteResult,
  ZoomView,
} from "../../../shared/api.ts"
import { mediaUrl } from "../../../shared/media-url.ts"
import { agentView, cutPlan, detail, emphasisView, fakeApi, highlightGroups, highlightPreview, settingsView, subtitleLines } from "../../test/fake-api.ts"
import { renderRoom } from "../../test/room.tsx"
import { MOTION_VERSION, type MotionSpec } from "@boxblack/core/graphics/plan"
import { DEFAULT_HIGHLIGHT_OPTIONS } from "@boxblack/core/highlights/styles"
import { POST_TABS, type PostTab } from "../edit/postTabs.ts"
import { t, type MessageKey } from "../i18n.ts"

afterEach(cleanup)
afterEach(() => {
  vi.useRealTimers()
})

const project = detail()
const FOLDER = project.folder

/** The post page in its room, with the bar it draws its buttons into rendered beside it, as the app does. */
const renderScreen = (overrides: Partial<RendererApi> = {}, options: { capcutRunning?: boolean | null } = {}) => renderRoom(overrides, options)

/** The app's bar: the page draws the AI menu and the write button into it from inside the room. */
const bar = () => document.querySelector<HTMLElement>(".topbar")!
/** The write button on the bar, by what it says now (เขียนลง CapCut, until a write has been done). */
const barWrite = (name: string = t("timeline.write")) => within(bar()).getByRole("button", { name })

const calls = (api: { calls: unknown[][] }, name: string) => api.calls.filter(([method]) => method === name)
const beatPick = (name: string | RegExp) => screen.getByRole("button", { name: typeof name === "string" ? new RegExp(name) : name })
const speechRows = () => screen.getAllByRole("listitem").filter((item) => item.classList.contains("speech-row"))
/** the groups are being placed again: the page says so, and nothing is written meanwhile */
const placing = () => document.querySelector("section.edit")!.getAttribute("aria-busy") === "true"
const ready = () => screen.findByRole("heading", { name: /เปิดเรื่อง/ })

/** A tab of the post page by its id, whatever count, spinner or flag it carries. */
const tab = (id: PostTab) => screen.getAllByRole("tab").find((one) => one.getAttribute("data-tab") === id)!
const openTab = (id: PostTab) => userEvent.click(tab(id))
/** The body of the open tab. */
const panel = () => document.querySelector<HTMLElement>(".beat-panel-body")!
/** The settings live at the head of their tab now: opening them is opening the tab. */
async function openSettings(id: PostTab) {
  await openTab(id)
  return panel()
}
const wholeClipPick = () => screen.getByRole("button", { name: new RegExp(`^${t("post.wholeClip")}`) })
/** The AI menu's first item, which runs the whole plan; the menu must be open. */
const planItem = () => within(screen.getByRole("group", { name: t("post.ai") })).getByRole("button", { name: `✦ ${t("post.planAll")}` })
/** Opens the AI menu and runs the whole plan from it, once it can run. */
async function planAll() {
  await openAi()
  await waitFor(() => expect(planItem()).toHaveProperty("disabled", false))
  await userEvent.click(planItem())
}
/** Why the item cannot run, as it is read with it. */
const reasonOf = (button: HTMLElement) => document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent ?? null

/* the page */

test("the post page has six tabs in the order of the work, then the agent's, and the rough cut open first", async () => {
  renderScreen()
  await ready()
  expect(screen.getAllByRole("tab").map((one) => one.getAttribute("data-tab"))).toEqual([...POST_TABS])
  expect(screen.getAllByRole("tab").map((one) => one.childNodes[0]!.textContent)).toEqual(POST_TABS.map((id) => t(`post.tab.${id}` as MessageKey)))
  // exactly these, in these words: colour is not the app's work (M26 cancelled, 0.4.1), the graphics have a tab of their own (0.7.0), and the agent's is last
  expect(screen.getAllByRole("tab").map((one) => one.childNodes[0]!.textContent)).toEqual(["ตัดหยาบ", "จุดเน้น", "ข้อความและเทคนิค", "กราฟิก", "เสียง", "ซับ", "คุยกับ AI"])
  expect(tab("cut").getAttribute("aria-selected")).toBe("true")
})

test("each beat is listed with what it carries for the open tab, and the first is open", async () => {
  const preview = highlightPreview({
    groups: highlightGroups(),
    sounds: [{ effectId: "s1", name: "ปัง" }],
    // the user's own CapCut sound, which the sound tab lists, and so counts
    cues: [{ anchor: { kind: "highlight", groupId: "g1", line: 0 }, atUs: 100_000, what: 'ข้อความเด่น "เอาล่ะ"', beatId: "b1", effectId: "s1", soundName: "ปัง", edited: true }],
    emphasis: emphasisOf(),
  })
  renderScreen({
    getSettings: async () =>
      settingsView({
        highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
        subtitles: { enabled: true, length: "line", polish: false },
      }),
    previewHighlights: async () => preview,
  })
  await ready()
  expect(beatPick("เปิดเรื่อง").getAttribute("aria-current")).toBe("true")
  expect(within(beatPick("เปิดเรื่อง")).getByText(t("edit.beatLength", { before: "5.1", after: "4.5" }))).toBeTruthy()
  expect(screen.getByText(t("edit.summaryTarget", { total: "0:12", target: "0:30", pieces: 5 }))).toBeTruthy()
  // the rough cut has no marks of its own
  expect(within(beatPick("เปิดเรื่อง")).queryByText(/Aa|🔊|★|CC/)).toBeNull()
  await openTab("techniques")
  // the fake's groups sit in the first and the last beat
  await waitFor(() => expect(within(beatPick("เปิดเรื่อง")).getByText("Aa 1")).toBeTruthy())
  expect(within(beatPick("ปิดท้าย")).getByText("Aa 1")).toBeTruthy()
  expect(within(beatPick("เปิดเรื่อง")).queryByText("🔊 1")).toBeNull()
  await openTab("sound")
  expect(within(beatPick("เปิดเรื่อง")).getByText("🔊 1")).toBeTruthy()
  expect(within(beatPick("เปิดเรื่อง")).queryByText("Aa 1")).toBeNull()
  await openTab("emphasis")
  expect(within(beatPick("เปิดเรื่อง")).getByText("★ 1")).toBeTruthy()
  // the picture beat's point is held back by the level, so it marks nothing
  expect(within(beatPick("ภาพประกอบ")).queryByText(/★/)).toBeNull()
  await openTab("subtitles")
  await waitFor(() => expect(within(beatPick("เปิดเรื่อง")).getByText("CC 2")).toBeTruthy())
  expect(within(beatPick("ปิดท้าย")).getByText("CC 1")).toBeTruthy()
})

test("a beat's marks are read out in words, and the open tab's body is its panel", async () => {
  renderScreen({ ...withText, previewHighlights: async () => highlightPreview({ groups: highlightGroups(), emphasis: emphasisOf() }) })
  await ready()
  expect(screen.getByRole("tabpanel", { name: t("post.tab.cut") })).toBeTruthy()
  await openTab("techniques")
  await waitFor(() => expect(within(beatPick("เปิดเรื่อง")).getByText("Aa 1")).toBeTruthy())
  expect(within(beatPick("เปิดเรื่อง")).getByText("Aa 1").getAttribute("aria-hidden")).toBe("true")
  expect(screen.getAllByRole("button", { name: new RegExp(t("post.mark.text", { count: 1 })) })).toContain(beatPick("เปิดเรื่อง"))
  expect(screen.getByRole("tabpanel", { name: new RegExp(t("post.tab.techniques")) })).toBe(panel())
  await openTab("emphasis")
  expect(screen.getAllByRole("button", { name: new RegExp(t("post.mark.emphasis", { count: 1 })) })).toContain(beatPick("เปิดเรื่อง"))
})

test("choosing another beat shows that beat, and only what belongs to it", async () => {
  renderScreen(withText)
  await ready()
  await openTab("techniques")
  // the opening's group, not the ending's
  expect(screen.getByText(t("highlights.group", { start: "0:00.1", end: "0:02.1" }))).toBeTruthy()
  expect(screen.queryByText(t("highlights.group", { start: "0:08.6", end: "0:10.0" }))).toBeNull()

  await userEvent.click(beatPick("ปิดท้าย"))
  expect(screen.getByRole("heading", { name: /ปิดท้าย/ })).toBeTruthy()
  expect(screen.getByText(t("highlights.group", { start: "0:08.6", end: "0:10.0" }))).toBeTruthy()
  expect(screen.queryByText(t("highlights.group", { start: "0:00.1", end: "0:02.1" }))).toBeNull()
})

test("the whole clip is a choice above the beats, and shows what every beat carries", async () => {
  renderScreen(withText)
  await ready()
  await openTab("techniques")
  await screen.findByText(t("highlights.group", { start: "0:00.1", end: "0:02.1" }))
  await userEvent.click(wholeClipPick())
  expect(screen.getByRole("heading", { name: t("post.wholeClip") })).toBeTruthy()
  expect(wholeClipPick().getAttribute("aria-current")).toBe("true")
  // the opening's group and the ending's, together
  expect(screen.getByText(t("highlights.group", { start: "0:00.1", end: "0:02.1" }))).toBeTruthy()
  expect(screen.getByText(t("highlights.group", { start: "0:08.6", end: "0:10.0" }))).toBeTruthy()
  expect(within(wholeClipPick()).getByText("Aa 2")).toBeTruthy()
  // the cut tab lists every beat's speech, one beat after another
  await openTab("cut")
  expect(speechRows()).toHaveLength(7)
})

test("the cut rules stay on screen while no rough cut is there, even when working one out fails, so they can be changed back", async () => {
  const { api } = renderScreen({
    previewCut: async () => {
      throw new Error("อ่านไฟล์ไม่ได้")
    },
  })
  expect(await screen.findByText(t("error.generic", { message: "อ่านไฟล์ไม่ได้" }))).toBeTruthy()
  expect(tab("cut").getAttribute("aria-selected")).toBe("true")
  await userEvent.click(await within(panel()).findByRole("radio", { name: t("timeline.preset.loose") }))
  expect(api.calls).toContainEqual(["updateSettings", { cut: { ...settingsView().cut, preset: "loose" } }])
})

test("the beat's speech says what is used and what was cut, and folds its pauses", async () => {
  renderScreen()
  await ready()
  expect(speechRows().map((row) => row.querySelector(".pill")!.textContent)).toEqual([
    t("timeline.row.used"),
    t("timeline.row.cut", { reason: t("timeline.removed.filler") }),
    t("timeline.row.used"),
    t("timeline.row.used"),
  ])
  expect(within(speechRows()[1]!).getByText("0:03.3–0:03.7")).toBeTruthy()
  expect(screen.getByText(t("timeline.pauses", { count: 1, seconds: "0.5" }))).toBeTruthy()
})

test("flipping a cut stores the decision and previews the cut again", async () => {
  const { api } = renderScreen()
  await ready()
  await userEvent.click(within(speechRows()[1]!).getByRole("button", { name: t("timeline.action.keep") }))
  expect(api.calls).toContainEqual(["setCutDecision", FOLDER, "a", { type: "words", indexes: [3], keep: true }])
  await waitFor(() => expect(calls(api, "previewCut")).toHaveLength(2))
})

test("a take that may be a retake stays in, says so, and one click cuts it", async () => {
  const plan = cutPlan()
  plan.beats[0]!.rows[0] = { ...plan.beats[0]!.rows[0]!, state: "kept", reason: "maybe-retake", text: "ราคา 590 บาท", toggle: { type: "words", indexes: [0, 1, 2], keep: false } }
  const { api } = renderScreen({ previewCut: async () => plan })
  await ready()
  const row = speechRows()[0]!
  expect(row.querySelector(".pill")!.textContent).toBe(t("timeline.row.kept", { reason: t("timeline.removed.maybe-retake") }))
  await userEvent.click(within(row).getByRole("button", { name: t("timeline.action.cut") }))
  expect(api.calls).toContainEqual(["setCutDecision", FOLDER, "a", { type: "words", indexes: [0, 1, 2], keep: false }])
})

test("a part plays with a second before and after it", async () => {
  renderScreen()
  await ready()
  await userEvent.click(within(speechRows()[0]!).getByRole("button", { name: t("timeline.play") }))
  const video = document.querySelector("video")!
  expect(video.getAttribute("src")).toBe(mediaUrl(FOLDER, "a"))
  // the row runs 1.9–3.3 s, so the player covers 0.9–4.3 s
  expect(screen.getByRole("slider", { name: t("preview.position") }).getAttribute("max")).toBe("3.4")
})

test("a beat that lost everything, or could not be trimmed, says so", async () => {
  const plan = cutPlan()
  renderScreen({ previewCut: async () => ({ ...plan, beats: plan.beats.map((beat) => ({ ...beat, notes: ["nothing-left" as const] })) }) })
  await ready()
  expect(screen.getAllByText(t("timeline.note.nothing-left")).length).toBeGreaterThan(0)
})

/* the cut rules */

test("the cut rules sit at the head of the cut tab, and changing one previews again", async () => {
  const { api } = renderScreen({ getSettings: async () => settingsView({ cut: { preset: "tight", cutFillers: false, cutRetakes: true, cutBadPicture: true } }) })
  await ready()
  expect(calls(api, "previewCut")).toEqual([["previewCut", FOLDER, { preset: "tight", cutFillers: false, cutRetakes: true, cutBadPicture: true }]])

  const settings = await openSettings("cut")
  expect(((await within(settings).findByRole("radio", { name: t("timeline.preset.tight") })) as HTMLInputElement).checked).toBe(true)
  expect((within(settings).getByRole("switch", { name: t("timeline.cutFillers") }) as HTMLInputElement).checked).toBe(false)

  await userEvent.click(within(settings).getByRole("radio", { name: t("timeline.preset.loose") }))
  expect(api.calls).toContainEqual(["updateSettings", { cut: { preset: "loose", cutFillers: false, cutRetakes: true, cutBadPicture: true } }])
  await waitFor(() => expect(calls(api, "previewCut")).toHaveLength(2))

  await userEvent.click(within(panel()).getByRole("switch", { name: t("timeline.cutRetakes") }))
  expect(api.calls).toContainEqual(["updateSettings", { cut: { preset: "loose", cutFillers: false, cutRetakes: false, cutBadPicture: true } }])
})

test("preset descriptions follow the values the license server sent", async () => {
  renderScreen({ getSettings: async () => settingsView({ cutPresets: { ...settingsView().cutPresets, normal: { maxPauseUs: 800_000, paddingUs: 150_000 } } }) })
  await ready()
  await openSettings("cut")
  expect(screen.getByText(t("timeline.preset.normalHint", { pause: "0.8" }))).toBeTruthy()
})

/* subtitles */

const withSubtitles = { getSettings: async () => settingsView({ subtitles: { enabled: true, length: "line" as const, polish: true } }) }

test("the subtitle tab holds the subtitle settings, and turning subtitles on lists the beat's lines", async () => {
  const { api } = renderScreen()
  await ready()
  await openTab("subtitles")
  expect(tab("subtitles").querySelector(".tab-count")).toBeNull()
  const enabled = screen.getByRole("switch", { name: t("subtitles.enabled") })
  expect(enabled).toHaveProperty("checked", false)
  expect(screen.queryAllByRole("textbox")).toEqual([])
  await userEvent.click(enabled)
  expect(api.calls).toContainEqual(["updateSettings", { subtitles: { enabled: true, length: "line", polish: false } }])
  expect(await screen.findByDisplayValue("สวัสดีครับวันนี้")).toBeTruthy()
  expect(screen.getByRole("switch", { name: t("subtitles.polish") })).toBeTruthy()
  // the polish is the plan's work 5, or the AI menu's, not a button of the tab
  expect(screen.queryByRole("button", { name: /เกลา/ })).toBeNull()
})

test("with subtitles on, the beat's own lines are listed, and a line typed is kept through setSubtitleText", async () => {
  const { api } = renderScreen(withSubtitles)
  await ready()
  await openTab("subtitles")
  const boxes = await screen.findAllByRole("textbox")
  expect(boxes).toHaveLength(2)
  expect((boxes[0] as HTMLInputElement).value).toBe("สวัสดีครับวันนี้")
  await userEvent.clear(boxes[0]!)
  await userEvent.type(boxes[0]!, "สวัสดีครับ")
  expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("สวัสดีครับ")
  await waitFor(() => expect(calls(api, "setSubtitleText").at(-1)).toEqual(["setSubtitleText", FOLDER, subtitleLines()[0]!.key, "สวัสดีครับ"]))
  expect(calls(api, "previewSubtitles")).toEqual([["previewSubtitles", FOLDER, settingsView().cut, "line", false]])
})

test("the switch that keeps subtitles out from under highlight text lives with the subtitles, and only while highlight text is on", async () => {
  const both = {
    getSettings: async () =>
      settingsView({
        subtitles: { enabled: true, length: "line", polish: false },
        highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
      }),
  }
  const { api } = renderScreen(both)
  await ready()
  await openTab("subtitles")
  await userEvent.click(await screen.findByRole("switch", { name: t("highlights.hideSubtitles") }))
  expect(api.calls).toContainEqual(["updateSettings", { highlights: { enabled: true, position: "auto", hideSubtitles: false, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom } }])
  cleanup()

  renderScreen(withSubtitles)
  await ready()
  await openTab("subtitles")
  await screen.findByRole("switch", { name: t("subtitles.polish") })
  expect(screen.queryByRole("switch", { name: t("highlights.hideSubtitles") })).toBeNull()
})

/* highlight text */

const PREVIEW = () => highlightPreview({ groups: highlightGroups(), styleByAi: "headline", style: "headline" })
const withText = {
  getSettings: async () => settingsView({ highlights: { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom } }),
  previewHighlights: async () => PREVIEW(),
}

test("with highlight text on, the beat's groups are shown with their lines", async () => {
  renderScreen(withText)
  await ready()
  await openTab("techniques")
  expect(screen.getByText(t("highlights.group", { start: "0:00.1", end: "0:02.1" }))).toBeTruthy()
  expect((screen.getByRole("textbox", { name: t("highlights.lineLabel", { number: 1, time: "0:00.1" }) }) as HTMLInputElement).value).toBe("เอาล่ะ")
  expect(screen.getByText(t("highlights.dodge.above"))).toBeTruthy()
})

test("a beat with no highlight text says how to add some", async () => {
  renderScreen({ ...withText, previewHighlights: async () => highlightPreview() })
  await ready()
  await openTab("techniques")
  expect(screen.getByText(t("edit.textEmpty"))).toBeTruthy()
  expect(screen.getByText(t("edit.textEmptyHint"))).toBeTruthy()
})

test("a group a graphic takes the place of says so on its row, where the placement is said, and the row is dimmed; its lines can still be changed and it can still be removed", async () => {
  const [opening, ending] = highlightGroups()
  const { api } = renderScreen({ ...withText, previewHighlights: async () => highlightPreview({ groups: [{ ...opening!, replaced: true }, ending!], styleByAi: "headline", style: "headline" }) })
  await ready()
  await openTab("techniques")
  const row = screen.getByText(t("highlights.group", { start: "0:00.1", end: "0:02.1" })).closest("li")!
  expect(t("highlights.replaced")).toBe("มีกราฟิกแทน ไม่ขึ้นในคลิป")
  const note = within(row).getByText(t("highlights.replaced"))
  expect(note.className).toBe("hint")
  // where its text would sit is beside the point while it is not drawn
  expect(within(row).queryByText(t("highlights.dodge.above"))).toBeNull()
  // dimmed the way a switched-off graphic's row is
  expect([...row.classList]).toEqual(["highlight-group", "off"])
  // the beat's mark counts the text that is drawn: none here
  expect(within(beatPick("เปิดเรื่อง")).queryByText(/Aa/)).toBeNull()
  // its lines and its buttons work as any group's
  const line = within(row).getByRole("textbox", { name: t("highlights.lineLabel", { number: 1, time: "0:00.1" }) })
  expect(line).toHaveProperty("disabled", false)
  await userEvent.clear(line)
  await userEvent.type(line, "เอาล่ะนะ")
  await userEvent.tab()
  expect(api.calls).toContainEqual(["editHighlightLine", FOLDER, "g1", 0, "เอาล่ะนะ"])
  await userEvent.click(within(row).getByRole("button", { name: t("highlights.removeGroup") }))
  expect(api.calls).toContainEqual(["removeHighlightGroup", FOLDER, "g1"])
  // a group that is drawn says nothing of it, and is not dimmed
  await userEvent.click(beatPick("ปิดท้าย"))
  const drawn = screen.getByText(t("highlights.group", { start: "0:08.6", end: "0:10.0" })).closest("li")!
  expect(within(drawn).queryByText(t("highlights.replaced"))).toBeNull()
  expect([...drawn.classList]).toEqual(["highlight-group"])
  expect(within(beatPick("ปิดท้าย")).getByText("Aa 1")).toBeTruthy()
})

test("a line is saved when the user leaves it; a cleared line and a group can be removed", async () => {
  const { api } = renderScreen(withText)
  await ready()
  await openTab("techniques")
  const line = screen.getByRole("textbox", { name: t("highlights.lineLabel", { number: 1, time: "0:00.1" }) })
  await userEvent.clear(line)
  await userEvent.type(line, "เอาล่ะนะ")
  await userEvent.tab()
  expect(api.calls).toContainEqual(["editHighlightLine", FOLDER, "g1", 0, "เอาล่ะนะ"])

  await userEvent.click(screen.getAllByRole("button", { name: t("highlights.removeLine") })[0]!)
  expect(api.calls).toContainEqual(["editHighlightLine", FOLDER, "g1", 0, null])
  await userEvent.click(screen.getByRole("button", { name: t("highlights.removeGroup") }))
  expect(api.calls).toContainEqual(["removeHighlightGroup", FOLDER, "g1"])
})

test("lines removed one after another are the lines clicked: the next waits for the group to be placed again", async () => {
  // main removes a line by its place in the group, as editLine does
  let lines = ["หนึ่ง", "สอง", "สาม"]
  const view = (): HighlightGroupView[] => [
    {
      id: "g1",
      beatId: "b1",
      source: "ai",
      replaced: false,
      placement: "above",
      look: { pattern: "stack", tone: "base", accent: null, exit: null, edited: false },
      startUs: 100_000,
      endUs: 2_100_000,
      lines: lines.map((text, index) => ({ index, text, startUs: 100_000 + index * 400_000, partial: false })),
    },
  ]
  // placing the groups again takes longer in main than saving one line: while `holding`, a placement waits until the test lets it land
  let holding = false
  const held: (() => void)[] = []
  renderScreen({
    ...withText,
    previewHighlights: () => {
      const snapshot = view()
      const land = (resolve: (preview: HighlightPreview) => void) => () => resolve(highlightPreview({ groups: snapshot }))
      return new Promise((resolve) => (holding ? held.push(land(resolve)) : setTimeout(land(resolve), 0)))
    },
    editHighlightLine: async (_folder, _group, index, text) => {
      lines = text === null ? lines.filter((_, i) => i !== index) : lines.map((line, i) => (i === index ? text : line))
    },
  })
  await ready()
  await openTab("techniques")
  const removeOf = (text: string) => within(screen.getByDisplayValue(text).closest("li")!).getByRole("button", { name: t("highlights.removeLine") })
  holding = true
  await userEvent.click(removeOf("หนึ่ง"))
  // saved, but the old view is still on screen until the new placement comes: its buttons wait
  await waitFor(() => expect(lines).toEqual(["สอง", "สาม"]))
  await waitFor(() => expect(held.length).toBeGreaterThan(0))
  expect(screen.getByDisplayValue("หนึ่ง")).toBeTruthy()
  expect(removeOf("สอง")).toHaveProperty("disabled", true)
  // and so does typing into a line, which is saved by its place too
  expect(screen.getByDisplayValue("สอง")).toHaveProperty("disabled", true)
  // the new placement lands
  holding = false
  act(() => held.splice(0).forEach((land) => land()))
  await waitFor(() => expect(screen.queryByDisplayValue("หนึ่ง")).toBeNull())
  await waitFor(() => expect(removeOf("สอง")).toHaveProperty("disabled", false))
  await userEvent.click(removeOf("สอง"))
  await waitFor(() => expect(lines).toEqual(["สาม"]))
})

test("a line left unchanged is not saved again", async () => {
  const { api } = renderScreen(withText)
  await ready()
  await openTab("techniques")
  await userEvent.click(screen.getByRole("textbox", { name: t("highlights.lineLabel", { number: 1, time: "0:00.1" }) }))
  await userEvent.tab()
  expect(calls(api, "editHighlightLine")).toEqual([])
})

test("choosing a style or a position saves it", async () => {
  const { api } = renderScreen(withText)
  await ready()
  const settings = await openSettings("techniques")
  await userEvent.selectOptions(await within(settings).findByRole("combobox", { name: t("highlights.style") }), "cute-pink")
  expect(api.calls).toContainEqual(["setHighlightStyle", FOLDER, "cute-pink"])
  await userEvent.click(within(settings).getByRole("radio", { name: t("highlights.position.bottom") }))
  expect(api.calls).toContainEqual(["updateSettings", { highlights: { enabled: true, position: "bottom", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom } }])
})

test("the highlight settings show the four colours of the style in force", async () => {
  renderScreen(withText)
  await ready()
  const settings = await openSettings("techniques")
  // headline: white text, gold accent, teal second colour, near-black bar
  expect(await within(settings).findByRole("img", { name: `${t("highlights.swatch.text")} #ffffff` })).toBeTruthy()
  expect(within(settings).getByRole("img", { name: `${t("highlights.swatch.accent")} #f2c14e` })).toBeTruthy()
  expect(within(settings).getByRole("img", { name: `${t("highlights.swatch.alt")} #7fb7be` })).toBeTruthy()
  expect(within(settings).getByRole("img", { name: `${t("highlights.swatch.bar")} #111111` })).toBeTruthy()
  expect(within(settings).queryByLabelText(t("highlights.swatch.accent"))).toBeNull()
})

test("the user's own colours are picked with the highlight settings and saved with them", async () => {
  const { api } = renderScreen({ ...withText, previewHighlights: async () => highlightPreview({ groups: highlightGroups(), style: "custom", styleByAi: "headline" }) })
  await ready()
  const settings = await openSettings("techniques")
  expect(((await within(settings).findByRole("combobox", { name: t("highlights.style") })) as HTMLSelectElement).value).toBe("custom")
  const accent = within(settings).getByLabelText(t("highlights.swatch.accent")) as HTMLInputElement
  expect(accent.type).toBe("color")
  expect(accent.value).toBe("#f7c204")
  fireEvent.change(accent, { target: { value: "#ff0000" } })
  expect(api.calls).toContainEqual([
    "updateSettings",
    { highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: { ...DEFAULT_HIGHLIGHT_OPTIONS.custom, accent: [1, 0, 0] } } },
  ])
  // the swatches make way for the inputs
  expect(within(settings).queryByRole("img", { name: new RegExp(t("highlights.swatch.text")) })).toBeNull()
})

test("the style Claude chose is marked as its choice", async () => {
  renderScreen(withText)
  await ready()
  await openSettings("techniques")
  expect(await screen.findByRole("option", { name: t("highlights.styleByAi", { name: "พาดหัวคลาสสิก" }) })).toBeTruthy()
})

test("a changed outline, hidden groups and missing pictures are pointed out with the highlight settings", async () => {
  renderScreen({ ...withText, previewHighlights: async () => highlightPreview({ groups: highlightGroups(), outlineChanged: true, hidden: 2, needsPictures: true }) })
  await ready()
  await openSettings("techniques")
  expect(await screen.findByText(t("highlights.outlineChanged"))).toBeTruthy()
  expect(screen.getByText(t("highlights.hidden", { count: 2 }))).toBeTruthy()
  expect(screen.getByText(t("highlights.needsPictures"))).toBeTruthy()
})

test("the highlight settings also count the points the cut hides, since Claude's text on them is hidden with them", async () => {
  // Claude's groups whose point is not placed are counted with the points, not with the groups
  renderScreen({ ...withText, previewHighlights: async () => highlightPreview({ groups: highlightGroups(), hidden: 1, emphasis: emphasisView({ hidden: 3 }) }) })
  await ready()
  const settings = await openSettings("techniques")
  expect(await within(settings).findByText(t("emphasis.hidden", { count: 3 }))).toBeTruthy()
  expect(within(settings).getByText(t("highlights.hidden", { count: 1 }))).toBeTruthy()
  cleanup()

  renderScreen(withText)
  await ready()
  const none = await openSettings("techniques")
  await within(none).findByRole("combobox", { name: t("highlights.style") })
  expect(within(none).queryByText(t("emphasis.hidden", { count: 0 }))).toBeNull()
})

/* the plan and the AI menu */

const openAi = async () => {
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("post.ai")) }))
  return screen.getByRole("group", { name: t("post.ai") })
}
/** The AI menu, opened if it is shut: the level is set at its head, and choosing one leaves it open. */
const levelMenu = async () => screen.queryByRole("group", { name: t("post.ai") }) ?? (await openAi())

test("a run going can be stopped from the AI menu, and a stop is not an error", async () => {
  let stop!: () => void
  const { api } = renderScreen({
    planPost: () => new Promise((resolve) => (stop = () => resolve({ running: false, states: { emphasis: { state: "failed", error: "cancelled" } } }))),
    cancelAi: async () => stop(),
  })
  await ready()
  await planAll()
  await userEvent.click(await screen.findByRole("button", { name: t("edit.ai.stop") }))
  expect(calls(api, "cancelAi")).toHaveLength(1)
  await waitFor(() => expect(screen.queryByRole("button", { name: t("edit.ai.stop") })).toBeNull())
  expect(screen.queryByText(new RegExp(t("error.generic", { message: "" })))).toBeNull()
})

test("a work that took Claude far too long says so in plain words", async () => {
  renderScreen({ postPlanState: async () => ({ running: false, states: { emphasis: { state: "failed", error: "timed out" } } }) })
  await ready()
  expect(await screen.findByText(t("post.run.failed", { work: t("post.work.emphasis"), message: t("edit.ai.timedOut") }))).toBeTruthy()
})

test("ทำทั้งหมด heads the AI menu in bold, over a line and then the works one by one, and there is no plan button of its own on the bar or in the cut tab", async () => {
  renderScreen(withPoints())
  await ready()
  expect(t("post.planAll")).toBe("ทำทั้งหมด")
  expect(within(bar()).queryByRole("button", { name: `✦ ${t("post.planAll")}` })).toBeNull()
  expect(screen.queryByText(t("post.planHint"))).toBeNull()
  const menu = await openAi()
  const rows = [...menu.querySelectorAll(".ai-items > li")]
  expect(rows.map((row) => (row.getAttribute("role") === "separator" ? "—" : row.querySelector("button")!.textContent))).toEqual([
    `✦ ${t("post.planAll")}`,
    "—",
    t("post.ai.rethink.emphasis"),
    t("post.ai.rethink.techniques"),
    t("post.ai.rethink.graphics"),
    t("post.ai.rethink.sounds"),
    t("post.ai.rethink.subtitles"),
  ])
  expect(planItem().classList.contains("lead")).toBe(true)
  // its hint says what the whole plan does
  expect(planItem().title).toBe(t("post.planHint"))
})

test("ทำทั้งหมด runs the whole plan with the settings on screen from any tab, even before the groups are placed for them", async () => {
  const { api } = renderScreen({
    ...withText,
    // placing for the new position never lands while the test runs
    previewHighlights: (_folder, _rules, options) => new Promise((resolve) => (options.position === "bottom" ? undefined : setTimeout(() => resolve(PREVIEW()), 0))),
  })
  await ready()
  const settings = await openSettings("techniques")
  await userEvent.click(await within(settings).findByRole("radio", { name: t("highlights.position.bottom") }))
  await planAll()
  await waitFor(() => expect(calls(api, "planPost")).toHaveLength(1))
  const [, folder, request] = calls(api, "planPost")[0] as [string, string, PostRequest]
  expect(folder).toBe(FOLDER)
  expect(request.rules).toEqual(settingsView().cut)
  expect(request.view).toMatchObject({ position: "bottom", highlightsOn: true })
})

test("ทำทั้งหมด waits, and says why, before the preview is ready and while a run goes; it does not wait for points, since it places them", async () => {
  let finish!: (view: PostRunView) => void
  renderScreen({
    planPost: () => new Promise((resolve) => (finish = resolve)),
    // the preview never lands, so there is nothing yet to plan on
    previewHighlights: () => new Promise(() => undefined),
  })
  await ready()
  await openAi()
  expect(planItem()).toHaveProperty("disabled", true)
  expect(reasonOf(planItem())).toBe(t("edit.busy"))
  cleanup()

  const ran = renderScreen({ ...withPoints({ points: [] }), planPost: () => new Promise((resolve) => (finish = resolve)) })
  await ready()
  await openAi()
  // no points yet: the works that stand on them wait, the whole plan does not
  await waitFor(() => expect(planItem()).toHaveProperty("disabled", false))
  expect(planItem().getAttribute("aria-describedby")).toBeNull()
  await userEvent.click(planItem())
  await waitFor(() => expect(calls(ran.api, "planPost")).toHaveLength(1))
  // the menu's button names the run and the stop comes right after it, in the same row, as for any run
  const stop = await within(bar()).findByRole("button", { name: t("edit.ai.stop") })
  const running = within(bar()).getByRole("button", { name: `✦ ${t("post.planRunning")}` })
  expect(stop.parentElement).toBe(running.parentElement)
  expect(running.nextElementSibling).toBe(stop)
  expect(running.parentElement!.classList.contains("ai-menu")).toBe(true)
  // the run is said once on the bar: the write's reason beside it does not say it again
  expect(within(bar()).getAllByText(/AI กำลังวางแผน/)).toHaveLength(1)
  expect(bar().querySelector(".write-reason")).toBeNull()
  await userEvent.click(running)
  // every item waits for the same run, so the menu says why once, at its head, and each item is read with that
  const menu = screen.getByRole("group", { name: t("post.ai") })
  expect(within(menu).getAllByText(t("post.planRunning"))).toHaveLength(1)
  expect(menu.querySelector(".ai-note")!.textContent).toBe(t("post.planRunning"))
  expect(menu.querySelectorAll(".ai-items .hint")).toHaveLength(0)
  for (const item of within(menu).getAllByRole("button")) {
    expect(item).toHaveProperty("disabled", true)
    expect(reasonOf(item)).toBe(t("post.planRunning"))
  }
  // the level is a setting, not a run: it can still be changed while one goes, above the note that holds the items
  for (const level of within(menu).getAllByRole("radio")) expect(level).toHaveProperty("disabled", false)
  expect(menu.firstElementChild!.contains(within(menu).getByRole("radiogroup", { name: t("flair.level") }))).toBe(true)
  await act(async () => finish({ running: false, states: {} }))
  await waitFor(() => expect(planItem()).toHaveProperty("disabled", false))
})

test("a plan run shows on the tabs: a spinner on those working, a warning on one that failed, and counts once they are done", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  act(() => {
    api.emit(planEvent("emphasis", { state: "done", count: 2, dropped: 0 }))
    api.emit(planEvent("text", { state: "running" }))
    api.emit(planEvent("sounds", { state: "failed", error: "Claude is busy" }))
    api.emit(planEvent("subtitles", { state: "failed", error: "cancelled" }))
  })
  await waitFor(() => expect(within(tab("techniques")).getByRole("img", { name: t("post.tabBusy") })).toBeTruthy())
  expect(tab("techniques").querySelector(".tab-count")).toBeNull()
  // the text is not the graphics' work: their tab neither spins nor loses its count
  expect(within(tab("graphics")).queryByRole("img")).toBeNull()
  expect(tab("graphics").querySelector(".tab-count")).not.toBeNull()
  // the strip under the tabs names the work running, over a bar of how many of the run's works are over: three of four
  expect(screen.getByText(t("post.run.running", { work: t("post.work.text") }))).toBeTruthy()
  expect(screen.getByRole("progressbar", { name: t("post.planRunning") }).getAttribute("aria-valuenow")).toBe("75")
  expect(within(tab("sound")).getByRole("img", { name: t("post.tabFailed") })).toBeTruthy()
  // the user's stop is not a failure
  expect(within(tab("subtitles")).queryByRole("img")).toBeNull()
  await waitFor(() => expect(tab("emphasis").querySelector(".tab-count")!.textContent).toBe("1"))
  act(() => api.emit(planEvent("text", { state: "done", count: 1, dropped: 0 })))
  await waitFor(() => expect(within(tab("techniques")).queryByRole("img", { name: t("post.tabBusy") })).toBeNull())
  expect(tab("techniques").querySelector(".tab-count")).not.toBeNull()
  // the graphics work spins the graphics tab alone
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  await waitFor(() => expect(within(tab("graphics")).getByRole("img", { name: t("post.tabBusy") })).toBeTruthy())
  expect(within(tab("techniques")).queryByRole("img")).toBeNull()
})

test("the strip under the tabs says how each work went: counts, what could not be used, a skip, a failure, and a stop in plain words", async () => {
  renderScreen({
    postPlanState: async () => ({
      running: false,
      states: {
        emphasis: { state: "done", count: 5, dropped: 2 },
        text: { state: "done", count: 3, dropped: 0 },
        techniques: { state: "skipped", reason: "off" },
        graphics: { state: "failed", error: "Claude is busy" },
        sounds: { state: "failed", error: "cancelled" },
        subtitles: { state: "skipped", reason: "stopped" },
      },
    }),
  })
  await ready()
  const work = (id: PostWork) => t(`post.work.${id}` as MessageKey)
  expect(await screen.findByText(t("post.run.done", { work: work("emphasis"), count: 5 }))).toBeTruthy()
  expect(screen.getByText(t("post.run.dropped", { work: work("emphasis"), count: 2 }))).toBeTruthy()
  expect(screen.getByText(t("post.run.done", { work: work("text"), count: 3 }))).toBeTruthy()
  expect(screen.queryByText(t("post.run.dropped", { work: work("text"), count: 0 }))).toBeNull()
  expect(screen.getByText(t("post.run.off", { work: work("techniques") }))).toBeTruthy()
  expect(screen.getByText(t("post.run.failed", { work: work("graphics"), message: "Claude is busy" }))).toBeTruthy()
  expect(screen.getByText(t("post.run.stopped", { work: work("sounds") }))).toBeTruthy()
  // the works after it were never begun, so they say nothing
  expect(screen.queryByText(t("post.run.stopped", { work: work("subtitles") }))).toBeNull()
  expect(screen.queryByText(/cancelled/)).toBeNull()
  // nothing runs, so there is no bar
  expect(screen.queryByRole("progressbar")).toBeNull()
})

test("while the graphics are being written the strip counts them; before the count comes, and for any other work, it says only that the work runs", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  const running = (work: PostWork) => t("post.run.running", { work: t(`post.work.${work}` as MessageKey) })
  // the graphics work plans first: nothing is being written yet, so there is nothing to count
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  expect(screen.getByText(running("graphics"))).toBeTruthy()
  act(() => api.emit(planEvent("graphics", { state: "running", done: 0, total: 5 })))
  expect(screen.getByText("กำลังเขียนกราฟิก 0 จาก 5")).toBeTruthy()
  expect(screen.queryByText(running("graphics"))).toBeNull()
  act(() => api.emit(planEvent("graphics", { state: "running", done: 2, total: 5 })))
  expect(screen.getByText("กำลังเขียนกราฟิก 2 จาก 5")).toBeTruthy()
  expect(screen.queryByText("กำลังเขียนกราฟิก 0 จาก 5")).toBeNull()
  // the graphics and the sounds are counted (the sounds' count is said in the sound tab's tests): another work is said to run, whatever its state carries
  act(() => api.emit(planEvent("techniques", { state: "running", done: 1, total: 2 })))
  expect(screen.getByText(running("techniques"))).toBeTruthy()
  // the count is of graphics written, not of the run's works: the bar still counts the works that are over
  expect(screen.getByRole("progressbar", { name: t("post.planRunning") }).getAttribute("aria-valuenow")).toBe("0")
  act(() => api.emit(planEvent("graphics", { state: "done", count: 4, dropped: 1 })))
  expect(screen.queryByText(/กำลังเขียนกราฟิก/)).toBeNull()
  expect(screen.getByText(t("post.run.done", { work: t("post.work.graphics"), count: 4 }))).toBeTruthy()
})

test("a graphics work whose count came without its total says only that the work runs", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  act(() => api.emit(planEvent("graphics", { state: "running", done: 1 })))
  expect(screen.getByText(t("post.run.running", { work: t("post.work.graphics") }))).toBeTruthy()
  expect(screen.queryByText(/กำลังเขียนกราฟิก/)).toBeNull()
})

test("a graphic that cannot be written again, having no place on the clip now, says so in Thai as the graphics work's failure, not above the page", async () => {
  // main throws it inside the graphics work: the work ends failed, the run ends, and the call is answered with how it stands
  const noPlace: PostWorkState = { state: "failed", error: "this graphic has no place on the clip now" }
  let answer!: (view: PostRunView) => void
  const previews = listedPreviews(() => [{ ...MOTION, off: true }])
  const { api } = renderScreen({
    ...withGraphics({}, ONLY_GRAPHICS),
    previewHighlights: previews.previewHighlights,
    redoGraphic: () => new Promise<PostRunView>((resolve) => (answer = resolve)),
  })
  await ready()
  await openFlair()
  const redo = screen.getByRole("button", { name: redoLabel() })
  await waitFor(() => expect(redo).toHaveProperty("disabled", false))
  await userEvent.click(redo)
  act(() => api.emit(planEvent("graphics", { state: "waiting" })))
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  previews.hold()
  act(() => api.emit(planEvent("graphics", noPlace)))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => answer({ running: false, states: { graphics: noPlace } }))
  expect(await screen.findByText(`${t("post.work.graphics")} ไม่สำเร็จ: กราฟิกนี้ไม่มีที่บนคลิปตอนนี้ (จุดของมันถูกซ่อนไว้ หรือไม่มีที่ว่างบนเฟรม)`)).toBeTruthy()
  expect(screen.queryByText(/no place on the clip/)).toBeNull()
  expect(screen.queryByText(new RegExp(t("error.generic", { message: "" })))).toBeNull()
  // failed, its end is held like any other: the row goes on saying it is being written until the read after the run is in
  expect(stateOf(graphicRows()[0]!)).toEqual([WRITING])
  await previews.land()
  // nothing was written: the row says what it said
  await waitFor(() => expect(stateOf(graphicRows()[0]!)).toEqual([t("graphics.offState")]))
})

test("the bar counts only the works of the run going, not how the others last ended", async () => {
  const done = { state: "done" as const, count: 1, dropped: 0 }
  const { api } = renderScreen({
    ...withPoints(),
    postPlanState: async () => ({ running: false, states: { emphasis: done, text: done, techniques: done, graphics: done, sounds: done, subtitles: done } }),
    // the sounds thought again, which runs until the test ends
    rethinkPost: () => new Promise(() => {}),
  })
  await ready()
  await screen.findByText(t("post.run.done", { work: t("post.work.sounds"), count: 1 }))
  const item = within(await openAi()).getByRole("button", { name: t("post.ai.rethink.sounds") })
  await waitFor(() => expect(item).toHaveProperty("disabled", false))
  await userEvent.click(item)
  act(() => api.emit(planEvent("sounds", { state: "waiting" })))
  expect(screen.getByRole("progressbar", { name: t("post.planRunning") }).getAttribute("aria-valuenow")).toBe("0")
  act(() => api.emit(planEvent("sounds", { state: "done", count: 2, dropped: 0 })))
  expect(screen.getByRole("progressbar", { name: t("post.planRunning") }).getAttribute("aria-valuenow")).toBe("100")
})

test("points thought again that fail are told once: by the strip and the tab's flag, not above them as well", async () => {
  let failed = false
  renderScreen({
    ...withPoints(),
    planEmphasis: async () => {
      failed = true
      throw new Error("Error invoking remote method 'api:planEmphasis': Error: Claude is busy")
    },
    postPlanState: async () => (failed ? { running: false, states: { emphasis: { state: "failed", error: "Claude is busy" } } } : null),
  })
  await ready()
  const item = within(await openAi()).getByRole("button", { name: t("post.ai.rethink.emphasis") })
  await waitFor(() => expect(item).toHaveProperty("disabled", false))
  await userEvent.click(item)
  expect(await screen.findByText(t("post.run.failed", { work: t("post.work.emphasis"), message: "Claude is busy" }))).toBeTruthy()
  expect(within(tab("emphasis")).getByRole("img", { name: t("post.tabFailed") })).toBeTruthy()
  expect(screen.queryByText(t("error.generic", { message: "Claude is busy" }))).toBeNull()
  expect(screen.queryByText(new RegExp(t("error.generic", { message: "" })))).toBeNull()
})

test("when the points fail, the works that stand on them are skipped and the strip says why, while the polish still runs", async () => {
  renderScreen({
    postPlanState: async () => ({
      running: false,
      states: {
        emphasis: { state: "failed", error: "Claude is busy" },
        text: { state: "skipped", reason: "no-emphasis" },
        techniques: { state: "skipped", reason: "no-emphasis" },
        graphics: { state: "skipped", reason: "no-emphasis" },
        sounds: { state: "skipped", reason: "no-emphasis" },
        subtitles: { state: "done", count: 2, dropped: 0 },
      },
    }),
  })
  await ready()
  const work = (id: PostWork) => t(`post.work.${id}` as MessageKey)
  expect(await screen.findByText(t("post.run.failed", { work: work("emphasis"), message: "Claude is busy" }))).toBeTruthy()
  for (const skipped of ["text", "techniques", "graphics", "sounds"] as const) {
    expect(screen.getByText(t("post.run.noEmphasis", { work: work(skipped) }))).toBeTruthy()
  }
  expect(screen.getByText(t("post.run.done", { work: work("subtitles"), count: 2 }))).toBeTruthy()
  // a skip is not a failure of its own: only the points' tab is flagged
  expect(within(tab("emphasis")).getByRole("img", { name: t("post.tabFailed") })).toBeTruthy()
  expect(within(tab("techniques")).queryByRole("img")).toBeNull()
  expect(within(tab("graphics")).queryByRole("img")).toBeNull()
  expect(within(tab("sound")).queryByRole("img")).toBeNull()
})

test("the AI menu thinks one work again: the points through planEmphasis, the other works through rethinkPost", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  const menu = await openAi()
  expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual([
    `✦ ${t("post.planAll")}`,
    t("post.ai.rethink.emphasis"),
    t("post.ai.rethink.techniques"),
    t("post.ai.rethink.graphics"),
    t("post.ai.rethink.sounds"),
    t("post.ai.rethink.subtitles"),
  ])
  expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual(["✦ ทำทั้งหมด", "คิดใหม่: จุดเน้น", "คิดใหม่: ข้อความและเทคนิค", "คิดใหม่: กราฟิก", "คิดใหม่: เสียง", "คิดใหม่: ซับ"])
  await userEvent.click(within(menu).getByRole("button", { name: t("post.ai.rethink.emphasis") }))
  await waitFor(() => expect(calls(api, "planEmphasis")).toEqual([["planEmphasis", FOLDER, settingsView().cut]]))
  for (const work of ["techniques", "graphics", "sounds", "subtitles"] as const) {
    // while one runs the menu's button names the run instead
    await waitFor(() => expect(screen.getByRole("button", { name: new RegExp(t("post.ai")) })).toBeTruthy())
    const again = await openAi()
    const item = within(again).getByRole("button", { name: t(`post.ai.rethink.${work}` as MessageKey) })
    await waitFor(() => expect(item).toHaveProperty("disabled", false))
    await userEvent.click(item)
  }
  await waitFor(() =>
    expect(calls(api, "rethinkPost").map((call) => call.slice(0, 3))).toEqual([
      ["rethinkPost", FOLDER, "techniques"],
      ["rethinkPost", FOLDER, "graphics"],
      ["rethinkPost", FOLDER, "sounds"],
      ["rethinkPost", FOLDER, "subtitles"],
    ]),
  )
})

test("the works that stand on points wait for them, and say so", async () => {
  renderScreen(withPoints({ points: [] }))
  await ready()
  await openTab("emphasis")
  await screen.findByText(t("emphasis.empty"))
  const menu = await openAi()
  expect(within(menu).getByRole("button", { name: t("post.ai.rethink.emphasis") })).toHaveProperty("disabled", false)
  expect(within(menu).getByRole("button", { name: t("post.ai.rethink.techniques") })).toHaveProperty("disabled", true)
  expect(within(menu).getByRole("button", { name: t("post.ai.rethink.graphics") })).toHaveProperty("disabled", true)
  expect(within(menu).getByRole("button", { name: t("post.ai.rethink.sounds") })).toHaveProperty("disabled", true)
  // the three share one reason, so it is said once, at the foot of the menu after the list, and not at its head
  expect(within(menu).getAllByText(t("post.ai.planFirstHere"))).toHaveLength(1)
  const foot = menu.querySelector<HTMLElement>(".ai-foot")!
  expect(foot.textContent).toBe(t("post.ai.planFirstHere"))
  expect(foot.previousElementSibling!.classList.contains("ai-items")).toBe(true)
  expect(menu.querySelector(".ai-note:not(.ai-foot)")).toBeNull()
  expect(menu.querySelectorAll(".ai-items .hint")).toHaveLength(0)
  // inside the AI menu it names the item to press, not the menu itself
  expect(t("post.ai.planFirstHere")).toBe("ต้องกด ✦ ทำทั้งหมด ก่อน")
  // each item it holds back is read with that one note
  for (const work of ["techniques", "graphics", "sounds"] as const) {
    expect(within(menu).getByRole("button", { name: t(`post.ai.rethink.${work}` as MessageKey) }).getAttribute("aria-describedby")).toBe(foot.id)
  }
  expect(within(menu).getByRole("button", { name: t("post.ai.rethink.emphasis") }).getAttribute("aria-describedby")).toBeNull()
  expect(within(menu).getByRole("button", { name: t("post.ai.rethink.subtitles") })).toHaveProperty("disabled", false)
})

test("a reason only one item has stays under that item, while the reason the others share is said once at the foot", async () => {
  const plan = cutPlan()
  renderScreen({ ...withPoints({ points: [] }), previewCut: async () => ({ ...plan, cuts: [] }) })
  await ready()
  const menu = await openAi()
  await waitFor(() => expect(planItem()).toHaveProperty("disabled", true))
  expect(reasonOf(planItem())).toBe(t("timeline.empty"))
  const lone = document.getElementById(planItem().getAttribute("aria-describedby")!)!
  expect(lone.closest("li")).toBe(planItem().closest("li"))
  expect(lone.classList.contains("ai-reason")).toBe(true)
  const foot = menu.querySelector<HTMLElement>(".ai-foot")!
  expect(foot.textContent).toBe(t("post.ai.planFirstHere"))
  expect(within(menu).getByRole("button", { name: t("post.ai.rethink.graphics") }).getAttribute("aria-describedby")).toBe(foot.id)
  expect(menu.querySelector(".ai-note:not(.ai-foot)")).toBeNull()
})

test("the preview is read with the text on, and a new level reads the subtitle lines again once it is saved: they hide the words of the text that level shows", async () => {
  const { api } = renderScreen({
    getSettings: async () =>
      settingsView({
        subtitles: { enabled: true, length: "line", polish: false },
        highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
        flair: FLAIR_ON,
      }),
    previewHighlights: async () => PREVIEW(),
  })
  await ready()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(1))
  expect(calls(api, "previewHighlights")[0]![3]).toMatchObject({ highlightsOn: true })
  const menu = await levelMenu()
  await userEvent.click(await within(menu).findByRole("radio", { name: t("flair.level.heavy") }))
  expect(api.calls).toContainEqual(["updateSettings", { flair: { ...FLAIR_ON, level: "heavy" } }])
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  expect(calls(api, "previewSubtitles")[1]).toEqual(["previewSubtitles", FOLDER, settingsView().cut, "line", true])
})

test("a new level holds the write until the subtitle lines it hides are read again, and a save of it that fails goes back to the level kept", async () => {
  // the settings main keeps: whatever was saved last
  let saved = settingsView({
    subtitles: { enabled: true, length: "line", polish: false },
    highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
    flair: FLAIR_ON,
  })
  const saves: { resolve: () => void; reject: (error: Error) => void }[] = []
  const { api } = renderScreen({
    getSettings: async () => saved,
    previewHighlights: async () => PREVIEW(),
    updateSettings: (patch) =>
      new Promise<void>((resolve, reject) =>
        saves.push({
          resolve: () => {
            if (patch.flair) saved = { ...saved, flair: { ...saved.flair, ...patch.flair } }
            resolve()
          },
          reject,
        }),
      ),
  })
  await ready()
  const level = async (name: string) => {
    const menu = await levelMenu()
    await userEvent.click(await within(menu).findByRole("radio", { name }))
  }
  // the write button is on the bar of this same page: the write waits there, and its reason says why
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))

  await level(t("flair.level.heavy"))
  // the groups are placed at the new level, but the lines on screen still hide the old level's text
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(2))
  await act(async () => {})
  expect(barWrite()).toHaveProperty("disabled", true)
  expect(within(bar()).getByText(t("write.check.placing"))).toBeTruthy()
  expect(calls(api, "previewSubtitles")).toHaveLength(1)
  await act(async () => saves.at(-1)!.resolve())
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))

  // a level that could not be saved is not what the lines would be read for: the failure is shown, and the
  // level goes back to the one main kept, which the lines are read again for
  await level(t("flair.level.medium"))
  await act(async () => saves.at(-1)!.reject(new Error("the settings could not be saved")))
  expect(await screen.findByText(t("error.generic", { message: "the settings could not be saved" }))).toBeTruthy()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(3))
  const menu = await levelMenu()
  expect(((await within(menu).findByRole("radio", { name: t("flair.level.heavy") })) as HTMLInputElement).checked).toBe(true)
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  expect(calls(api, "previewSubtitles").at(-1)).toEqual(["previewSubtitles", FOLDER, settingsView().cut, "line", true])
})

test("with the lines under the text hidden, the subtitle lines are read again when the groups a graphic takes the place of change, and the write waits for them", async () => {
  // main marks the opening's group replaced while the graphics are on
  const { api } = renderScreen({
    getSettings: async () =>
      settingsView({
        subtitles: { enabled: true, length: "line", polish: false },
        highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
        flair: { ...FLAIR_ON, graphic: true },
      }),
    previewHighlights: async (_folder, _rules, options) => highlightPreview({ groups: highlightGroups().map((group) => (group.id === "g1" ? { ...group, replaced: options.flair.graphic } : group)) }),
  })
  await ready()
  // once as the room opens, and again once the preview says which groups are replaced: their words are in the lines
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  const settings = await openSettings("graphics")
  // the graphics switched off: no group is replaced now, so the opening's words go back under its text
  await userEvent.click(await within(settings).findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) }))
  await waitFor(() => expect(calls(api, "previewHighlights").at(-1)![3]).toMatchObject({ flair: { graphic: false } }))
  await waitFor(() => expect(calls(api, "previewSubtitles").length).toBeGreaterThan(2))
  expect(calls(api, "previewSubtitles").at(-1)).toEqual(["previewSubtitles", FOLDER, settingsView().cut, "line", true])
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
})

/**
 * The room with the lines hidden under the text and the graphics on, where main marks the opening's group replaced
 * while the graphics are on and the text is not pinned to the bottom, and every save of a setting waits until the
 * test lets it land (`landSave`) or fails it (`failSave`). `landed` are the options of every preview that has
 * answered, in order; `rereads` says whether a read of the settings after the room opened answers or fails.
 */
function withHeldSaves() {
  const saves: { resolve: () => void; reject: (error: Error) => void }[] = []
  const landed: unknown[] = []
  const rereads = { fail: false, count: 0 }
  const saved = settingsView({
    subtitles: { enabled: true, length: "line", polish: false },
    highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
    flair: { ...FLAIR_ON, graphic: true },
  })
  let opened = false
  const room = renderScreen({
    getSettings: async () => {
      if (opened) {
        rereads.count++
        if (rereads.fail) throw new Error("the settings could not be read")
      }
      opened = true
      return saved
    },
    previewHighlights: async (_folder, _rules, options) => {
      landed.push(options)
      return highlightPreview({ groups: highlightGroups().map((group) => (group.id === "g1" ? { ...group, replaced: options.flair.graphic && options.position !== "bottom" } : group)) })
    },
    updateSettings: () => new Promise<void>((resolve, reject) => saves.push({ resolve, reject })),
  })
  return {
    ...room,
    saves,
    landed,
    rereads,
    landSave: () => act(async () => saves.at(-1)!.resolve()),
    failSave: () => act(async () => saves.at(-1)!.reject(new Error("the settings could not be saved"))),
    /** Waits until a preview asked with these options has answered, and the room has drawn it. */
    previewLanded: async (asked: object) => {
      await waitFor(() => expect(landed.at(-1)).toMatchObject(asked))
      await act(async () => {})
    },
  }
}

test.each([
  ["the graphics switch", "graphics", (settings: HTMLElement) => within(settings).findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) }), { flair: { graphic: false } }],
  ["the text looks' switch", "techniques", (settings: HTMLElement) => within(settings).findByRole("switch", { name: new RegExp(`^${t("flair.text")}`) }), { flair: { text: false } }],
  ["the text's position", "techniques", (settings: HTMLElement) => within(settings).findByRole("radio", { name: t("highlights.position.bottom") }), { position: "bottom" }],
] as const)("with the lines under the text hidden, a change of %s reads no subtitle lines until its save has landed, holds the write meanwhile, and then reads them once", async (_what, where, control, asked) => {
  const { api, saves, landSave, previewLanded } = withHeldSaves()
  await ready()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  const settings = await openSettings(where)
  await userEvent.click(await control(settings))
  expect(saves).toHaveLength(1)
  // the preview for what is on screen has landed, with another set of replaced groups or the same, while the save is still out
  await previewLanded(asked)
  // main would read the lines under the settings saved before: they are not asked for, and nothing is written from the old ones
  expect(calls(api, "previewSubtitles")).toHaveLength(2)
  expect(barWrite()).toHaveProperty("disabled", true)
  await landSave()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(3))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  await act(async () => {})
  expect(calls(api, "previewSubtitles")).toHaveLength(3)
})

test("with the lines under the text hidden, a position whose save fails goes back to the one main keeps, and the lines are read for it", async () => {
  const { api, failSave, previewLanded } = withHeldSaves()
  await ready()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  const settings = await openSettings("techniques")
  await userEvent.click(await within(settings).findByRole("radio", { name: t("highlights.position.bottom") }))
  await previewLanded({ position: "bottom" })
  expect(calls(api, "previewSubtitles")).toHaveLength(2)
  await failSave()
  expect(await screen.findByText(t("error.generic", { message: "the settings could not be saved" }))).toBeTruthy()
  // the position main keeps is shown again, and the lines are read under it
  await waitFor(() => expect((within(settings).getByRole("radio", { name: t("highlights.position.auto") }) as HTMLInputElement).checked).toBe(true))
  await previewLanded({ position: "auto" })
  await waitFor(() => expect(calls(api, "previewSubtitles").length).toBeGreaterThan(2))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
})

test("with the lines under the text hidden, a save that fails and settings that then cannot be read again do not hold the lines, or the write, for ever", async () => {
  const { api, failSave, rereads, previewLanded } = withHeldSaves()
  await ready()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  const settings = await openSettings("graphics")
  await userEvent.click(await within(settings).findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) }))
  await previewLanded({ flair: { graphic: false } })
  rereads.fail = true
  await failSave()
  await waitFor(() => expect(rereads.count).toBe(1))
  // nothing more will say what main keeps: the lines are read under whatever it does keep, and the write can go
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(3))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
})

test("with the lines under the text hidden, a preview that lands with the same replaced groups reads no lines again", async () => {
  const { api, landed } = withHeldSaves()
  await ready()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  // a graphic made in the background reads the preview again; the same group is replaced in it
  const before = landed.length
  act(() => api.emit({ type: "graphics", folder: FOLDER, state: "done" }))
  await waitFor(() => expect(landed.length).toBe(before + 1))
  await act(async () => {})
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  expect(calls(api, "previewSubtitles")).toHaveLength(2)
})

test("with the lines under the text hidden, a save of the flair that lands does not release the lines while a change of the position is still unsaved", async () => {
  const { api, saves } = withHeldSaves()
  await ready()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(2))
  const settings = await openSettings("techniques")
  await userEvent.click(await within(settings).findByRole("radio", { name: t("highlights.position.bottom") }))
  const graphics = await openSettings("graphics")
  await userEvent.click(await within(graphics).findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) }))
  expect(saves).toHaveLength(2)
  // the flair's save lands; the position's is still out
  await act(async () => saves[1]!.resolve())
  await act(async () => {})
  expect(calls(api, "previewSubtitles")).toHaveLength(2)
  expect(barWrite()).toHaveProperty("disabled", true)
  await act(async () => saves[0]!.resolve())
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(3))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
})

test("while the subtitle lines hide nothing under the text, a change of the groups a graphic takes the place of reads none again", async () => {
  const { api } = renderScreen({
    getSettings: async () =>
      settingsView({
        subtitles: { enabled: true, length: "line", polish: false },
        highlights: { enabled: true, position: "auto", hideSubtitles: false, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
        flair: { ...FLAIR_ON, graphic: true },
      }),
    previewHighlights: async (_folder, _rules, options) => highlightPreview({ groups: highlightGroups().map((group) => (group.id === "g1" ? { ...group, replaced: options.flair.graphic } : group)) }),
  })
  await ready()
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  expect(calls(api, "previewSubtitles")).toHaveLength(1)
  const settings = await openSettings("graphics")
  await userEvent.click(await within(settings).findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) }))
  await waitFor(() => expect(calls(api, "previewHighlights").at(-1)![3]).toMatchObject({ flair: { graphic: false } }))
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  expect(calls(api, "previewSubtitles")).toHaveLength(1)
})

test("a new level leaves the subtitle lines alone while they hide nothing under the text", async () => {
  const { api } = renderScreen({
    getSettings: async () =>
      settingsView({
        subtitles: { enabled: true, length: "line", polish: false },
        highlights: { enabled: true, position: "auto", hideSubtitles: false, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
        flair: FLAIR_ON,
      }),
    previewHighlights: async () => PREVIEW(),
  })
  await ready()
  await waitFor(() => expect(calls(api, "previewSubtitles")).toHaveLength(1))
  const menu = await levelMenu()
  await userEvent.click(await within(menu).findByRole("radio", { name: t("flair.level.heavy") }))
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(2))
  // nothing the lines leave out depends on the level: the write does not wait for them
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  expect(calls(api, "previewSubtitles")).toHaveLength(1)
})

/* flair */

const FLAIR_ON = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false }
const flairPreview = (extra: Partial<HighlightPreview> = {}) =>
  highlightPreview({
    groups: highlightGroups(),
    sounds: [
      { effectId: "s1", name: "ปัง" },
      { effectId: "s2", name: "ฟิ้ว" },
    ],
    slots: [{ anchor: { kind: "highlight", groupId: "g1", line: 0 }, atUs: 100_000, what: 'ข้อความเด่น "เอาล่ะ"', beatId: "b1" }],
    media: [{ binId: "m1", name: "IMG_1.JPG", kind: "photo", what: "เล็บสีชมพู" }],
    ...extra,
  })
const withFlair = (extra: Partial<HighlightPreview> = {}) => ({
  getSettings: async () => settingsView({ highlights: { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }, flair: FLAIR_ON }),
  previewHighlights: async () => flairPreview(extra),
})

/* the emphasis points */

const POINTS: EmphasisPointView[] = [
  {
    id: "p1",
    anchor: { kind: "speech", videoId: "a", from: 0, to: 2, beatId: "b1" },
    importance: "key",
    type: "hook",
    reason: "เปิดให้คนดูอยากรู้",
    source: "ai",
    edited: false,
    beatId: "b1",
    atUs: 100_000,
    endUs: 900_000,
    text: "เอาล่ะครับ",
    shown: true,
    items: { text: 1, zoom: 0, insert: 0, graphic: 1, sound: 1 },
  },
  {
    id: "p2",
    anchor: { kind: "scene", videoId: "b", startUs: 500_000, endUs: 2_500_000, beatId: "b2" },
    importance: "extra",
    type: "visual",
    reason: "ภาพสวย",
    source: "user",
    edited: true,
    beatId: "b2",
    atUs: 4_500_000,
    endUs: 6_500_000,
    text: "หน้าร้านตอนกลางคืน",
    // medium lets key and secondary points through, not extra ones
    shown: false,
    items: { text: 0, zoom: 0, insert: 0, graphic: 0, sound: 0 },
  },
  {
    id: "p3",
    anchor: { kind: "speech", videoId: "a", from: 23, to: 24, beatId: "b3" },
    importance: "secondary",
    type: "place",
    reason: "",
    source: "ai",
    edited: false,
    beatId: "b3",
    atUs: 9_000_000,
    endUs: 9_800_000,
    text: "เราอยู่ใน",
    shown: true,
    items: { text: 0, zoom: 0, insert: 0, graphic: 0, sound: 0 },
  },
]
// the kept sentences of cutPlan(), word by word
const SENTENCES: EmphasisSentenceView[] = [
  { videoId: "a", beatId: "b1", from: 0, to: 3, atUs: 100_000, words: ["เอาล่ะ", "ครับ", "วันนี้"] },
  { videoId: "a", beatId: "b1", from: 4, to: 6, atUs: 1_550_000, words: ["เราจะ", "มาดู"] },
  { videoId: "a", beatId: "b1", from: 6, to: 8, atUs: 2_950_000, words: ["นักบิน", "อวกาศ"] },
  { videoId: "a", beatId: "b3", from: 22, to: 25, atUs: 8_600_000, words: ["ตอนนี้", "เราอยู่ใน", "อวกาศ"] },
]
const SCENES: EmphasisSceneView[] = [
  { videoId: "b", beatId: "b2", startUs: 500_000, endUs: 2_500_000, atUs: 4_500_000, durationUs: 2_000_000, description: "หน้าร้านตอนกลางคืน", pointId: "p2" },
  { videoId: "b", beatId: "b2", startUs: 2_500_000, endUs: 3_500_000, atUs: 6_500_000, durationUs: 1_000_000, description: "ป้ายชื่อร้าน", pointId: null },
]
/** The points above, with their sentences and scenes, on an otherwise empty emphasis view. */
const emphasisOf = (extra: Partial<EmphasisView> = {}): EmphasisView => emphasisView({ points: POINTS, sentences: SENTENCES, scenes: SCENES, version: 3, ...extra })
const withPoints = (extra: Partial<EmphasisView> = {}) => ({ previewHighlights: async () => highlightPreview({ emphasis: emphasisOf(extra) }) })
/** A point's row, by the words it stresses. */
const pointRow = (text: string) => screen.getAllByRole("listitem").find((item) => item.classList.contains("emphasis-point") && item.querySelector("q")?.textContent === text)!
const planEvent = (work: PostWork, state: PostWorkState): AppEvent => ({ type: "post-plan", folder: FOLDER, work, state })

/* the emphasis tab */

test("the emphasis tab lists the beat's points with their time, words, importance, type and reason", async () => {
  renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  const row = pointRow("เอาล่ะครับ")
  expect(within(row).getByText("0:00.1")).toBeTruthy()
  expect(within(row).getByText(t("emphasis.source.ai"))).toBeTruthy()
  expect((within(row).getByRole("combobox", { name: t("emphasis.importanceLabel", { text: "เอาล่ะครับ" }) }) as HTMLSelectElement).value).toBe("key")
  expect((within(row).getByRole("combobox", { name: t("emphasis.typeLabel", { text: "เอาล่ะครับ" }) }) as HTMLSelectElement).value).toBe("hook")
  expect((within(row).getByRole("textbox", { name: t("emphasis.reasonLabel", { text: "เอาล่ะครับ" }) }) as HTMLInputElement).value).toBe("เปิดให้คนดูอยากรู้")
  expect(within(row).getByText(t("emphasis.items", { text: 1, zoom: 0, insert: 0, graphic: 1, sound: 1 }))).toBeTruthy()
  // only the opening's points: the ending's is in its own beat
  expect(screen.getAllByRole("listitem").filter((item) => item.classList.contains("emphasis-point"))).toHaveLength(1)
  // the words a point already has cannot be picked again; the next word can
  expect(screen.getByRole("button", { name: "ครับ" })).toHaveProperty("disabled", true)
  expect(screen.getByRole("button", { name: "วันนี้" })).toHaveProperty("disabled", false)
  // the tab and the beat count the points that play
  expect(tab("emphasis").querySelector(".tab-count")!.textContent).toBe("1")
  expect(within(beatPick("เปิดเรื่อง")).getByText("★ 1")).toBeTruthy()
})

test("a point is listed in the beat the sidebar counts it in: one whose beat is not on the cut, in the last beat", async () => {
  // as byBeat places everything whose beat the cut does not play
  const stray: EmphasisPointView = { ...POINTS[2]!, id: "p9", beatId: "gone", text: "หลงบีต" }
  renderScreen(withPoints({ points: [...POINTS, stray] }))
  await ready()
  await userEvent.click(beatPick("ปิดท้าย"))
  await openTab("emphasis")
  expect(await screen.findByText("หลงบีต")).toBeTruthy()
  expect(within(beatPick("ปิดท้าย")).getByText("★ 2")).toBeTruthy()
})

test("a point's importance, type and reason are changed in place, and a reason left as it was is not sent", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  const field = (name: string, role: "combobox" | "textbox") => within(pointRow("เอาล่ะครับ")).getByRole(role, { name })
  await userEvent.selectOptions(field(t("emphasis.importanceLabel", { text: "เอาล่ะครับ" }), "combobox"), "secondary")
  expect(api.calls).toContainEqual(["setEmphasisPoint", FOLDER, "p1", { importance: "secondary" }])
  await waitFor(() => expect(field(t("emphasis.typeLabel", { text: "เอาล่ะครับ" }), "combobox")).toHaveProperty("disabled", false))
  await userEvent.selectOptions(field(t("emphasis.typeLabel", { text: "เอาล่ะครับ" }), "combobox"), "number")
  expect(api.calls).toContainEqual(["setEmphasisPoint", FOLDER, "p1", { type: "number" }])
  await waitFor(() => expect(field(t("emphasis.reasonLabel", { text: "เอาล่ะครับ" }), "textbox")).toHaveProperty("disabled", false))
  await userEvent.click(field(t("emphasis.reasonLabel", { text: "เอาล่ะครับ" }), "textbox"))
  await userEvent.tab()
  expect(calls(api, "setEmphasisPoint")).toHaveLength(2)
  await userEvent.clear(field(t("emphasis.reasonLabel", { text: "เอาล่ะครับ" }), "textbox"))
  await userEvent.type(field(t("emphasis.reasonLabel", { text: "เอาล่ะครับ" }), "textbox"), "ตัวเลขที่ต้องจำ")
  await userEvent.tab()
  expect(api.calls).toContainEqual(["setEmphasisPoint", FOLDER, "p1", { reason: "ตัวเลขที่ต้องจำ" }])
})

test("a point's new importance is read back from main once it is saved", async () => {
  // main keeps what it was given, and the preview reads it
  let importance: EmphasisPointView["importance"] = "key"
  const { api } = renderScreen({
    setEmphasisPoint: async (_folder, _id, patch) => {
      importance = patch?.importance ?? importance
    },
    previewHighlights: async () => highlightPreview({ emphasis: emphasisOf({ points: POINTS.map((point) => (point.id === "p1" ? { ...point, importance } : point)) }) }),
  })
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  const reads = calls(api, "previewHighlights").length
  await userEvent.selectOptions(screen.getByRole("combobox", { name: t("emphasis.importanceLabel", { text: "เอาล่ะครับ" }) }), "secondary")
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(reads + 1))
  await waitFor(() => expect((screen.getByRole("combobox", { name: t("emphasis.importanceLabel", { text: "เอาล่ะครับ" }) }) as HTMLSelectElement).value).toBe("secondary"))
})

test("a point main refuses says why in Thai, and keeps the words picked and the move begun, to be changed and tried again", async () => {
  const refused = async () => {
    throw new Error("Error invoking remote method 'api:addEmphasisPoint': Error: the point overlaps another point")
  }
  renderScreen({ ...withPoints(), addEmphasisPoint: refused, setEmphasisPoint: refused })
  await ready()
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: "วันนี้" }))
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.add") }))
  expect(await screen.findByText(t("error.generic", { message: t("emphasis.refused.overlaps") }))).toBeTruthy()
  expect(screen.getByRole("button", { name: "วันนี้" }).getAttribute("aria-pressed")).toBe("true")
  await waitFor(() => expect(screen.getByRole("button", { name: t("emphasis.add") })).toHaveProperty("disabled", false))

  await userEvent.click(within(pointRow("เอาล่ะครับ")).getByRole("button", { name: t("emphasis.moveLabel", { text: "เอาล่ะครับ" }) }))
  await userEvent.click(screen.getByRole("button", { name: "เราจะ" }))
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.moveHere") }))
  await waitFor(() => expect(screen.getByRole("button", { name: t("emphasis.moveHere") })).toHaveProperty("disabled", false))
  expect(screen.getByText(t("emphasis.moveHint"))).toBeTruthy()
  expect(screen.getByRole("button", { name: "เราจะ" }).getAttribute("aria-pressed")).toBe("true")
})

test("deleting the point being moved ends the move", async () => {
  renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  await userEvent.click(within(pointRow("เอาล่ะครับ")).getByRole("button", { name: t("emphasis.moveLabel", { text: "เอาล่ะครับ" }) }))
  await userEvent.click(screen.getByRole("button", { name: "วันนี้" }))
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.deleteLabel", { text: "เอาล่ะครับ" }) }))
  expect(screen.queryByText(t("emphasis.moveHint"))).toBeNull()
  expect(screen.getByRole("button", { name: t("emphasis.add") })).toBeTruthy()
  expect(screen.queryByRole("button", { name: t("emphasis.cancelMove") })).toBeNull()
})

test("a word inside a stretch picked starts the pick again from it, and the pick can be let go at once", async () => {
  renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  const word = (text: string) => screen.getByRole("button", { name: text })
  await userEvent.click(await screen.findByRole("button", { name: "เราจะ" }))
  await userEvent.click(word("มาดู"))
  expect([word("เราจะ"), word("มาดู")].map((one) => one.getAttribute("aria-pressed"))).toEqual(["true", "true"])
  // a stretch made shorter
  await userEvent.click(word("มาดู"))
  expect([word("เราจะ"), word("มาดู")].map((one) => one.getAttribute("aria-pressed"))).toEqual(["false", "true"])
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.clearPick") }))
  expect(word("มาดู").getAttribute("aria-pressed")).toBe("false")
  expect(screen.getByRole("button", { name: t("emphasis.add") })).toHaveProperty("disabled", true)
  expect(screen.queryByRole("button", { name: t("emphasis.clearPick") })).toBeNull()
})

test("the words are one stop for the keyboard: left and right within a sentence, up and down between them, home and end to its ends", async () => {
  renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  const word = (text: string) => screen.getByRole("button", { name: text })
  const stops = () => ["เอาล่ะ", "ครับ", "วันนี้", "เราจะ", "มาดู", "นักบิน", "อวกาศ"].map((text) => word(text).tabIndex)
  await screen.findByRole("button", { name: "เราจะ" })
  // one word of the whole list takes the tab stop: the first one free, as "เอาล่ะ" and "ครับ" are the point's
  expect(stops()).toEqual([-1, -1, 0, -1, -1, -1, -1])
  act(() => word("เราจะ").focus())
  expect(stops()).toEqual([-1, -1, -1, 0, -1, -1, -1])
  const press = async (key: string, lands: string) => {
    await userEvent.keyboard(`{${key}}`)
    expect(document.activeElement, key).toBe(word(lands))
  }
  await press("ArrowRight", "มาดู")
  // the end of the sentence goes no further
  await press("ArrowRight", "มาดู")
  await press("ArrowLeft", "เราจะ")
  // up to the sentence above, onto its free word nearest the same place
  await press("ArrowUp", "วันนี้")
  await press("ArrowDown", "มาดู")
  await press("ArrowDown", "อวกาศ")
  await press("Home", "นักบิน")
  await press("End", "อวกาศ")
  // the last sentence goes no further down
  await press("ArrowDown", "อวกาศ")
  expect(stops()).toEqual([-1, -1, -1, -1, -1, -1, 0])
  cleanup()

  // a point's words in the middle of a sentence are stepped over
  renderScreen(withPoints())
  await ready()
  await userEvent.click(beatPick("ปิดท้าย"))
  await openTab("emphasis")
  ;(await screen.findByRole("button", { name: "ตอนนี้" })).focus()
  await userEvent.keyboard("{ArrowRight}")
  expect(document.activeElement).toBe(word("อวกาศ"))
})

test("the words keep the focus through a save, and a word another point takes meanwhile hands it on to the next free word", async () => {
  // "มาดู", the second word of the opening's second sentence
  const LOOK: EmphasisPointView = { ...TODAY, id: "p6", anchor: { kind: "speech", videoId: "a", from: 5, to: 6, beatId: "b1" }, atUs: 2_000_000, text: "มาดู" }
  let points = POINTS
  let hold = false
  const held: (() => void)[] = []
  const { api } = renderScreen({
    previewHighlights: () => {
      const preview = highlightPreview({ emphasis: emphasisOf({ points: [...points] }) })
      return hold ? new Promise((resolve) => held.push(() => resolve(preview))) : Promise.resolve(preview)
    },
  })
  await ready()
  await openTab("emphasis")
  const word = (text: string) => screen.getByRole("button", { name: text })
  const look = await screen.findByRole("button", { name: "มาดู" })
  act(() => look.focus())
  // Claude's new points land: "มาดู" is one's now, and the preview is read again for it
  hold = true
  points = [POINTS[0]!, LOOK, ...POINTS.slice(1)]
  act(() => api.emit(planEvent("emphasis", { state: "done", count: 1, dropped: 0 })))
  await waitFor(() => expect(held).toHaveLength(1))
  // while it is read the words wait, still able to hold the focus
  expect(word("มาดู").getAttribute("aria-disabled")).toBe("true")
  expect(word("มาดู")).toHaveProperty("disabled", false)
  expect(document.activeElement).toBe(word("มาดู"))
  await act(async () => held[0]!())
  await waitFor(() => expect(word("มาดู")).toHaveProperty("disabled", true))
  // the next free word, in the next sentence, takes the focus: not the first free word of the list
  await waitFor(() => expect(document.activeElement).toBe(word("นักบิน")))
})

test("a point deleted moves the focus to the next point, or to the list's heading when none is left", async () => {
  let points = [POINTS[0]!, TODAY]
  renderScreen({
    setEmphasisPoint: async (_folder, id, patch) => {
      if (patch === null) points = points.filter((point) => point.id !== id)
    },
    previewHighlights: async () => highlightPreview({ emphasis: emphasisOf({ points: [...points, ...POINTS.slice(1)] }) }),
  })
  await ready()
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: t("emphasis.deleteLabel", { text: "เอาล่ะครับ" }) }))
  await waitFor(() => expect(document.activeElement).toBe(pointRow("วันนี้")))
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.deleteLabel", { text: "วันนี้" }) }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: t("emphasis.pointsTitle") })))
})

test("a delete main refuses leaves the focus alone, even once the point goes some other way", async () => {
  let points = [POINTS[0]!, TODAY]
  const { api } = renderScreen({
    setEmphasisPoint: async () => {
      throw new Error("the outline changed")
    },
    previewHighlights: async () => highlightPreview({ emphasis: emphasisOf({ points: [...points, ...POINTS.slice(1)] }) }),
  })
  await ready()
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: t("emphasis.deleteLabel", { text: "เอาล่ะครับ" }) }))
  await screen.findByText(t("error.generic", { message: "the outline changed" }))
  const word = await screen.findByRole("button", { name: "เราจะ" })
  word.focus()
  // the points planned again elsewhere: the one whose delete was refused is gone
  points = [TODAY]
  act(() => api.emit(planEvent("emphasis", { state: "done", count: 1, dropped: 0 })))
  await waitFor(() => expect(screen.queryByText("เอาล่ะครับ")).toBeNull())
  expect(document.activeElement).toBe(word)
})

test("a point is deleted from its row", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: t("emphasis.deleteLabel", { text: "เอาล่ะครับ" }) }))
  expect(api.calls).toContainEqual(["setEmphasisPoint", FOLDER, "p1", null])
})

test("words picked in a sentence become a point of the user's; a word picked twice is let go", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  const add = await screen.findByRole("button", { name: t("emphasis.add") })
  expect(add).toHaveProperty("disabled", true)
  await userEvent.click(screen.getByRole("button", { name: "วันนี้" }))
  expect(screen.getByRole("button", { name: "วันนี้" }).getAttribute("aria-pressed")).toBe("true")
  expect(add).toHaveProperty("disabled", false)
  await userEvent.click(screen.getByRole("button", { name: "วันนี้" }))
  expect(add).toHaveProperty("disabled", true)
  // picked from the end back to the start: the stretch covers both
  await userEvent.click(screen.getByRole("button", { name: "มาดู" }))
  await userEvent.click(screen.getByRole("button", { name: "เราจะ" }))
  await userEvent.click(add)
  expect(api.calls).toContainEqual(["addEmphasisPoint", FOLDER, { kind: "speech", videoId: "a", from: 4, to: 6, beatId: "b1" }])
})

test("a stretch picked across another point's words starts again from the word picked last", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await userEvent.click(beatPick("ปิดท้าย"))
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: "ตอนนี้" }))
  await userEvent.click(screen.getByRole("button", { name: "อวกาศ" }))
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.add") }))
  expect(api.calls).toContainEqual(["addEmphasisPoint", FOLDER, { kind: "speech", videoId: "a", from: 24, to: 25, beatId: "b3" }])
})

test("a scene of a picture beat becomes a point; one a point already stands on offers no second", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await userEvent.click(beatPick("ภาพประกอบ"))
  await openTab("emphasis")
  await screen.findByText("ป้ายชื่อร้าน")
  const sceneRows = screen.getAllByRole("listitem").filter((item) => item.classList.contains("emphasis-scene"))
  expect(sceneRows).toHaveLength(2)
  expect(within(sceneRows[0]!).queryByRole("button")).toBeNull()
  await userEvent.click(within(sceneRows[1]!).getByRole("button", { name: t("emphasis.addScene") }))
  expect(api.calls).toContainEqual(["addEmphasisPoint", FOLDER, { kind: "scene", videoId: "b", startUs: 2_500_000, endUs: 3_500_000, beatId: "b2" }])
})

test("a point's phrase is moved by picking new words, its own words among them", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  await userEvent.click(within(pointRow("เอาล่ะครับ")).getByRole("button", { name: t("emphasis.moveLabel", { text: "เอาล่ะครับ" }) }))
  expect(screen.getByText(t("emphasis.moveHint"))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "ครับ" }))
  await userEvent.click(screen.getByRole("button", { name: "วันนี้" }))
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.moveHere") }))
  expect(api.calls).toContainEqual(["setEmphasisPoint", FOLDER, "p1", { anchor: { kind: "speech", videoId: "a", from: 1, to: 3, beatId: "b1" } }])
  expect(calls(api, "addEmphasisPoint")).toEqual([])
  expect(screen.queryByText(t("emphasis.moveHint"))).toBeNull()
})

test("a move can be called off, and leaves the point where it was", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  await userEvent.click(within(pointRow("เอาล่ะครับ")).getByRole("button", { name: t("emphasis.moveLabel", { text: "เอาล่ะครับ" }) }))
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.cancelMove") }))
  expect(screen.queryByText(t("emphasis.moveHint"))).toBeNull()
  expect(screen.getByRole("button", { name: "ครับ" })).toHaveProperty("disabled", true)
  expect(calls(api, "setEmphasisPoint")).toEqual([])
})

test("words picked in one beat, and a move begun there, are let go when another beat is opened", async () => {
  renderScreen(withPoints())
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  await userEvent.click(within(pointRow("เอาล่ะครับ")).getByRole("button", { name: t("emphasis.moveLabel", { text: "เอาล่ะครับ" }) }))
  // the third word of the opening's first sentence; the ending's first sentence has a free third word too
  await userEvent.click(screen.getByRole("button", { name: "วันนี้" }))
  await userEvent.click(beatPick("ปิดท้าย"))
  await screen.findByRole("button", { name: "ตอนนี้" })
  expect(screen.getByRole("button", { name: "อวกาศ" }).getAttribute("aria-pressed")).toBe("false")
  expect(screen.getByRole("button", { name: t("emphasis.add") })).toHaveProperty("disabled", true)
  expect(screen.queryByText(t("emphasis.moveHint"))).toBeNull()
})

test("a point the level holds back says so, and the level is set in the AI menu, not in the emphasis tab", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  await userEvent.click(beatPick("ภาพประกอบ"))
  await openTab("emphasis")
  await screen.findByText(t("emphasis.notShown"))
  const row = pointRow("หน้าร้านตอนกลางคืน")
  expect(within(row).getByText(t("emphasis.source.user"))).toBeTruthy()
  expect(within(row).getByText(new RegExp(t("emphasis.edited")))).toBeTruthy()
  expect(screen.queryByRole("radiogroup", { name: t("flair.level") })).toBeNull()
  expect(screen.queryByText(t("flair.level.mediumHint"))).toBeNull()
  const menu = await openAi()
  await userEvent.click(within(menu).getByRole("radio", { name: t("flair.level.heavy") }))
  expect(api.calls).toContainEqual(["updateSettings", { flair: { ...settingsView().flair, level: "heavy" } }])
})

test("the level heads the open AI menu with the one in force chosen; choosing another saves it, keeps the menu open and runs nothing", async () => {
  const { api } = renderScreen(withPoints())
  await ready()
  const menu = await openAi()
  // at the head, over the items and set apart from them by a line
  const head = menu.firstElementChild!
  expect(within(head as HTMLElement).getByRole("radiogroup", { name: t("flair.level") })).toBeTruthy()
  expect(head.nextElementSibling!.getAttribute("role")).toBe("separator")
  expect(within(menu).getByText(t("flair.level.mediumHint"))).toBeTruthy()
  expect((within(menu).getByRole("radio", { name: t("flair.level.medium") }) as HTMLInputElement).checked).toBe(true)
  expect(within(menu).getByRole("radio", { name: t("flair.level.heavy") })).toHaveProperty("disabled", false)
  // the button on the bar says what it always said
  expect(screen.getByRole("button", { name: `✦ ${t("post.ai")} ▾` })).toBeTruthy()

  await userEvent.click(within(menu).getByRole("radio", { name: t("flair.level.heavy") }))
  expect(api.calls).toContainEqual(["updateSettings", { flair: { ...settingsView().flair, level: "heavy" } }])
  const still = screen.getByRole("group", { name: t("post.ai") })
  expect((within(still).getByRole("radio", { name: t("flair.level.heavy") }) as HTMLInputElement).checked).toBe(true)
  expect(within(still).getByText(t("flair.level.heavyHint"))).toBeTruthy()
  expect(api.calls.filter(([name]) => name === "planPost" || name === "rethinkPost")).toHaveLength(0)
})

test("points the cut hides, and what the run on screen could not use of the points, are counted", async () => {
  renderScreen({
    ...withPoints({ hidden: 2 }),
    postPlanState: async () => ({ running: false, states: { emphasis: { state: "done", count: 3, dropped: 1 } } }),
  })
  await ready()
  await openTab("emphasis")
  expect(await screen.findByText(t("emphasis.hidden", { count: 2 }))).toBeTruthy()
  expect(await screen.findByText(t("emphasis.dropped", { count: 1 }))).toBeTruthy()
})

test("with no point yet the emphasis tab says how to get some, and still offers the words", async () => {
  renderScreen(withPoints({ points: [] }))
  await ready()
  await openTab("emphasis")
  expect(await screen.findByText(t("emphasis.empty"))).toBeTruthy()
  expect(screen.getByRole("button", { name: "ครับ" })).toHaveProperty("disabled", false)
})

test("a point with no text offers its words as highlight text made for it, while highlight text is on; a point with text offers none", async () => {
  const bare = POINTS.map((point) => ({ ...point, items: { ...point.items, text: 0 } }))
  const { api } = renderScreen({ ...withText, ...withPoints({ points: bare }) })
  await ready()
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: t("highlights.addLabel", { text: "เอาล่ะครับ" }) }))
  // made for the point: it plays at the point's level, like a graphic made for it
  expect(api.calls).toContainEqual(["addHighlightGroup", FOLDER, "a", [0, 1], 12, "b1", "p1"])
  cleanup()

  // the opening's point has text already
  renderScreen({ ...withText, ...withPoints() })
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  expect(screen.queryByRole("button", { name: t("highlights.addLabel", { text: "เอาล่ะครับ" }) })).toBeNull()
  cleanup()

  renderScreen(withPoints({ points: bare }))
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  expect(screen.queryByRole("button", { name: t("highlights.addLabel", { text: "เอาล่ะครับ" }) })).toBeNull()
  cleanup()

  // a point whose text a graphic takes the place of still has that text, listed and marked: main counts it on the
  // point, so no second text is offered for it
  const replaced = highlightGroups().map((group) => (group.id === "g1" ? { ...group, pointId: "p1", replaced: true } : group))
  renderScreen({ ...withText, previewHighlights: async () => highlightPreview({ groups: replaced, emphasis: emphasisOf() }) })
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  expect(screen.queryByRole("button", { name: t("highlights.addLabel", { text: "เอาล่ะครับ" }) })).toBeNull()
  cleanup()

  // a point the level holds back counts no text, though it may have some: it offers none
  renderScreen({ ...withText, ...withPoints({ points: bare.map((point) => (point.id === "p3" ? { ...point, shown: false } : point)) }) })
  await ready()
  await userEvent.click(beatPick("ปิดท้าย"))
  await openTab("emphasis")
  await screen.findByText("เราอยู่ใน", { selector: "q" })
  expect(screen.queryByRole("button", { name: t("highlights.addLabel", { text: "เราอยู่ใน" }) })).toBeNull()
})

// "วันนี้", the third word of the opening's first sentence: a second point in the sentence of "เอาล่ะครับ"
const TODAY: EmphasisPointView = {
  ...POINTS[0]!,
  id: "p4",
  anchor: { kind: "speech", videoId: "a", from: 2, to: 3, beatId: "b1" },
  source: "user",
  atUs: 900_000,
  endUs: 1_400_000,
  text: "วันนี้",
  items: { text: 0, zoom: 0, insert: 1, graphic: 0, sound: 0 },
}

test("a point's picture is its own: picking one names the point, and another point's cutaway in the same sentence is neither shown nor touched", async () => {
  const pick = (text: string) => t("inserts.pickLabel", { text })
  // p4's cutaway, where the sentence both points are in starts
  const today: InsertView = { ...ON_ROW, anchor: { kind: "speech", videoId: "a", sourceUs: 1_900_000, beatId: "b1" }, pointId: "p4" }
  const { api } = renderScreen({ ...withFlair(), previewHighlights: async () => flairPreview({ emphasis: emphasisOf({ points: [POINTS[0]!, TODAY, ...POINTS.slice(1)] }), inserts: [today] }) })
  await ready()
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: pick("เอาล่ะครับ") }))
  const mine = screen.getByRole("group", { name: pick("เอาล่ะครับ") })
  expect(within(mine).getByRole("button", { name: "เล็บสีชมพู" }).getAttribute("aria-pressed")).toBe("false")
  // nothing on the point to take off
  expect(within(mine).queryByRole("button", { name: t("flair.insert.none") })).toBeNull()
  await userEvent.click(within(mine).getByRole("button", { name: "เล็บสีชมพู" }))
  expect(api.calls).toContainEqual(["setPointPicture", FOLDER, settingsView().cut, "p1", "m1"])
  expect(calls(api, "setInsert")).toEqual([])

  // the other point's picker shows its own, and takes off that one alone
  await waitFor(() => expect(screen.getByRole("button", { name: pick("วันนี้") })).toHaveProperty("disabled", false))
  await userEvent.click(screen.getByRole("button", { name: pick("วันนี้") }))
  const theirs = screen.getByRole("group", { name: pick("วันนี้") })
  expect(within(theirs).getByRole("button", { name: "เล็บสีชมพู" }).getAttribute("aria-pressed")).toBe("true")
  await userEvent.click(within(theirs).getByRole("button", { name: t("flair.insert.none") }))
  expect(api.calls).toContainEqual(["setPointPicture", FOLDER, settingsView().cut, "p4", null])
  expect(calls(api, "setInsert")).toEqual([])
})

test("a picture that replaced Claude's on a point stays on the point's row, and a second pick replaces it again rather than stacking", async () => {
  const pick = t("inserts.pickLabel", { text: "เอาล่ะครับ" })
  const media = [
    { binId: "m1", name: "IMG_1.JPG", kind: "photo" as const, what: "เล็บสีชมพู" },
    { binId: "m2", name: "IMG_2.JPG", kind: "photo" as const, what: "หน้าร้าน" },
  ]
  // main keeps the point's one cutaway, replaced where it is
  let onPoint: InsertView = { ...ON_ROW, edited: false, pointId: "p1" }
  const { api } = renderScreen({
    ...withFlair(),
    setPointPicture: async (_folder, _rules, _pointId, binId) => {
      onPoint = { ...onPoint, binId: binId!, picture: media.find((one) => one.binId === binId)!.what, edited: true }
    },
    previewHighlights: async () =>
      flairPreview({
        media,
        inserts: [onPoint],
        emphasis: emphasisOf({ points: POINTS.map((point) => (point.id === "p1" ? { ...point, items: { ...point.items, insert: 1 } } : point)) }),
      }),
  })
  await ready()
  await openTab("emphasis")
  await userEvent.click(await screen.findByRole("button", { name: pick }))
  await userEvent.click(within(screen.getByRole("group", { name: pick })).getByRole("button", { name: "หน้าร้าน" }))
  await waitFor(() => expect(calls(api, "previewHighlights").length).toBeGreaterThan(1))
  await waitFor(() => expect(screen.getByRole("button", { name: pick })).toHaveProperty("disabled", false))
  await userEvent.click(screen.getByRole("button", { name: pick }))
  expect(within(screen.getByRole("group", { name: pick })).getByRole("button", { name: "หน้าร้าน" }).getAttribute("aria-pressed")).toBe("true")
  await userEvent.click(within(screen.getByRole("group", { name: pick })).getByRole("button", { name: "เล็บสีชมพู" }))
  expect(calls(api, "setPointPicture").map((call) => call.slice(3))).toEqual([
    ["p1", "m2"],
    ["p1", "m1"],
  ])
  // one cutaway on the point, which the techniques tab lists as the point's
  expect(within(pointRow("เอาล่ะครับ")).getByText(t("emphasis.items", { text: 1, zoom: 0, insert: 1, graphic: 1, sound: 1 }))).toBeTruthy()
  await openTab("techniques")
  await screen.findByText(t("edit.flairInserts"))
  expect(screen.getAllByRole("button", { name: new RegExp(t("inserts.removeLabel", { picture: ".+" })) })).toHaveLength(1)
  expect(screen.getByText(t("emphasis.from", { text: "เอาล่ะครับ" }))).toBeTruthy()
})

test("with no pictures in the project, or cutaways off, a point offers none", async () => {
  const pick = t("inserts.pickLabel", { text: "เอาล่ะครับ" })
  renderScreen({ ...withFlair(), previewHighlights: async () => flairPreview({ emphasis: emphasisOf(), media: [] }) })
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  expect(screen.queryByRole("button", { name: pick })).toBeNull()
  cleanup()

  renderScreen({ getSettings: async () => settingsView({ flair: { ...FLAIR_ON, insert: false } }), previewHighlights: async () => flairPreview({ emphasis: emphasisOf() }) })
  await ready()
  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  expect(screen.queryByRole("button", { name: pick })).toBeNull()
})

test("the techniques, graphics and sound tabs say when the points changed since they were planned, and think again from there", async () => {
  const { api } = renderScreen({ ...withFlair(), previewHighlights: async () => flairPreview({ emphasis: emphasisOf({ changed: { techniques: false, graphics: true, sounds: false } }) }) })
  await ready()
  await openTab("graphics")
  expect(await screen.findByText(t("emphasis.changed"))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("emphasis.changedAction") }))
  await waitFor(() => expect(calls(api, "rethinkPost").map((call) => call.slice(0, 3))).toEqual([["rethinkPost", FOLDER, "graphics"]]))
  await openTab("techniques")
  expect(screen.queryByText(t("emphasis.changed"))).toBeNull()
  await openTab("sound")
  expect(screen.queryByText(t("emphasis.changed"))).toBeNull()
  cleanup()

  const { api: techniques } = renderScreen({ ...withFlair(), previewHighlights: async () => flairPreview({ emphasis: emphasisOf({ changed: { techniques: true, graphics: false, sounds: false } }) }) })
  await ready()
  await openTab("graphics")
  await screen.findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) })
  expect(screen.queryByText(t("emphasis.changed"))).toBeNull()
  await openTab("techniques")
  await userEvent.click(await screen.findByRole("button", { name: t("emphasis.changedAction") }))
  await waitFor(() => expect(calls(techniques, "rethinkPost").map((call) => call.slice(0, 3))).toEqual([["rethinkPost", FOLDER, "techniques"]]))
  cleanup()

  const { api: sounds } = renderScreen({ ...withFlair(), previewHighlights: async () => flairPreview({ emphasis: emphasisOf({ changed: { techniques: false, graphics: false, sounds: true } }) }) })
  await ready()
  await openTab("sound")
  await userEvent.click(await screen.findByRole("button", { name: t("emphasis.changedAction") }))
  await waitFor(() => expect(calls(sounds, "rethinkPost").map((call) => call.slice(0, 3))).toEqual([["rethinkPost", FOLDER, "sounds"]]))
})

test("the banners are read again once a run is over, sounds switched off included, and hidden while it runs", async () => {
  // main notes the points as planned on only after a work's "done", and a work switched off sends none
  let changed = { techniques: false, graphics: true, sounds: true }
  const { api } = renderScreen({
    ...withFlair(),
    getSettings: async () => settingsView({ highlights: { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }, flair: { ...FLAIR_ON, sound: false } }),
    previewHighlights: async () => flairPreview({ emphasis: emphasisOf({ changed }) }),
  })
  await ready()
  await openTab("graphics")
  expect(await screen.findByText(t("emphasis.changed"))).toBeTruthy()
  const before = calls(api, "previewHighlights").length
  act(() => {
    api.emit(planEvent("text", { state: "running" }))
  })
  // a banner asking for a run while one goes would ask for what is being done
  await waitFor(() => expect(screen.queryByText(t("emphasis.changed"))).toBeNull())
  await openTab("sound")
  expect(screen.queryByText(t("emphasis.changed"))).toBeNull()
  await openTab("graphics")
  act(() => {
    api.emit(planEvent("text", { state: "done", count: 1, dropped: 0 }))
    api.emit(planEvent("sounds", { state: "skipped", reason: "off" }))
  })
  await waitFor(() => expect(calls(api, "previewHighlights").length).toBeGreaterThan(before))
  changed = { techniques: false, graphics: false, sounds: false }
  const reads = calls(api, "previewHighlights").length
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(reads + 1))
  await act(async () => {})
  expect(screen.queryByText(t("emphasis.changed"))).toBeNull()
  await openTab("sound")
  expect(screen.queryByText(t("emphasis.changed"))).toBeNull()

  // the graphics thought again put the sounds behind, which main says once the run is over
  act(() => api.emit(planEvent("text", { state: "running" })))
  act(() => api.emit(planEvent("text", { state: "done", count: 1, dropped: 0 })))
  await act(async () => {})
  changed = { techniques: false, graphics: false, sounds: true }
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  expect(await screen.findByText(t("emphasis.changed"))).toBeTruthy()
})

test("each item in the techniques, graphics and sound tabs says which point it was made for", async () => {
  const from = t("emphasis.from", { text: "เอาล่ะครับ" })
  const [g1, g2] = highlightGroups()
  renderScreen({
    ...withGraphics(),
    previewHighlights: async () =>
      flairPreview({
        emphasis: emphasisOf(),
        groups: [{ ...g1!, pointId: "p1" }, g2!],
        graphics: [{ ...MOTION, pointId: "p1" }],
        composed: [{ ...SOUND, pointId: "p1" }],
      }),
  })
  await ready()
  await openTab("techniques")
  // the group; there is no move or zoom to name one
  expect(await screen.findAllByText(from)).toHaveLength(1)
  // cut short when the row is narrow, whole when pointed at
  expect(screen.getByText(from).getAttribute("title")).toBe(from)
  // a graphic planned before 0.7.0 names its point as before
  await openTab("graphics")
  await screen.findByText(MOTION.summary)
  expect(screen.getByText(from).getAttribute("title")).toBe(from)
  await openTab("sound")
  expect(await screen.findByText(from)).toBeTruthy()
})

test("the techniques tab has no zoom to pick per piece any more: the moves are listed by time instead", async () => {
  renderScreen(withFlair())
  await ready()
  await openTab("techniques")
  expect(await screen.findByText(t("edit.flairMoves"))).toBeTruthy()
  expect(screen.queryByRole("combobox", { name: /การซูมของ/ })).toBeNull()
  expect(screen.queryByRole("option", { name: t("flair.zoom.punch") })).toBeNull()
})

test("the sound tab says how many sounds are not playing, and why", async () => {
  renderScreen(withFlair({ unusedSounds: { unplaced: 2, missing: 1, lost: 3, pro: 0 } }))
  await ready()
  await openTab("sound")
  expect(await screen.findByText(t("flair.unplaced", { count: 2 }))).toBeTruthy()
  expect(screen.getByText(t("flair.missing", { count: 1 }))).toBeTruthy()
  expect(screen.getByText(t("flair.lost", { count: 3 }))).toBeTruthy()
})

test("the sound tab says sounds that need CapCut Pro are left out, and not that the machine lacks them", async () => {
  renderScreen(withFlair({ unusedSounds: { unplaced: 0, missing: 0, lost: 0, pro: 2 } }))
  await ready()
  await openTab("sound")
  expect(await screen.findByText("มีเสียง 2 จุดที่ไม่ใส่ เพราะต้องมี CapCut Pro (ถ้ามี เปิด “มี CapCut Pro” ในตั้งค่า)")).toBeTruthy()
  expect(screen.queryByText(/เครื่องนี้ไม่มี/)).toBeNull()
})

test("at the lightest level everything switched on shows: sounds, zooms and cutaways, and every pattern and exit for a group's look", async () => {
  renderScreen({
    ...withFlair({ composed: [SOUND] }),
    getSettings: async () =>
      settingsView({ highlights: { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }, flair: { ...FLAIR_ON, level: "light" as const } }),
  })
  await ready()
  await openTab("sound")
  expect(await screen.findByText(SOUND.role)).toBeTruthy()
  await openTab("techniques")
  expect(screen.getByText(t("edit.flairMoves"))).toBeTruthy()
  expect(screen.getByText(t("inserts.pickHint"))).toBeTruthy()
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  const look = screen.getByRole("group", { name: t("edit.look") })
  expect(within(look).getByRole("radio", { name: "คำเดียวเต็มจอ" })).toBeTruthy()
  expect(within(look).getByRole("option", { name: "แตกกระจาย" })).toBeTruthy()
})

test("the sound tab says nothing about unused sounds when every one plays", async () => {
  renderScreen(withFlair())
  await ready()
  await openTab("sound")
  await screen.findByText(t("sounds.composed"))
  expect(screen.queryByText(t("flair.unplaced", { count: 0 }))).toBeNull()
  expect(screen.queryByText(t("flair.missing", { count: 0 }))).toBeNull()
  expect(screen.queryByText(t("flair.lost", { count: 0 }))).toBeNull()
  expect(screen.queryByText(t("flair.needsPro", { count: 0 }))).toBeNull()
})

/* cutaways */

const ON_ROW: InsertView = {
  anchor: { kind: "speech", videoId: "a", sourceUs: 2_500_000 },
  atUs: 750_000,
  durationUs: 2_000_000,
  what: "ที่ “เอาล่ะครับวันนี้” ตรงคำว่า “ครับ”",
  beatId: "b1",
  binId: "m1",
  picture: "เล็บสีชมพู",
  fit: "cover",
  edited: true,
}

test("a cutaway is listed in the techniques tab, and taken off there by its own anchor", async () => {
  const { api } = renderScreen(withFlair({ inserts: [ON_ROW] }))
  await ready()
  await openTab("techniques")
  expect(await screen.findByText(t("edit.flairInserts"))).toBeTruthy()
  expect(screen.getByText(ON_ROW.what)).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("inserts.removeLabel", { picture: "เล็บสีชมพู" }) }))
  // named by its picture too, since several may sit at one place
  expect(api.calls).toContainEqual(["setInsert", FOLDER, ON_ROW.anchor, null, undefined, "m1"])
})

test("a cutaway says whether it covers the frame or sits as a card, and flips between the two", async () => {
  const { api } = renderScreen(withFlair({ inserts: [ON_ROW] }))
  await ready()
  await openTab("techniques")
  const fit = await screen.findByRole("button", { name: t("inserts.fitLabel", { picture: "เล็บสีชมพู" }) })
  expect(fit.textContent).toBe(t("inserts.fit.cover"))
  await userEvent.click(fit)
  expect(api.calls).toContainEqual(["setInsert", FOLDER, ON_ROW.anchor, "m1", "card", "m1"])
})

test("two cutaways stacked at one place are listed apart, and each is changed and taken off by its own picture", async () => {
  // the user's two moved to the beat's start when their text went
  const start = { kind: "beat" as const, beatId: "b1", edge: "start" as const }
  const first: InsertView = { ...ON_ROW, anchor: start, what: "ต้นบีต", binId: "m1", picture: "เล็บสีชมพู" }
  const second: InsertView = { ...ON_ROW, anchor: start, what: "ต้นบีต", binId: "m2", picture: "หน้าร้าน", fit: "card" }
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  const { api } = renderScreen(withFlair({ inserts: [first, second] }))
  await ready()
  await openTab("techniques")
  await userEvent.click(await screen.findByRole("button", { name: t("inserts.fitLabel", { picture: "หน้าร้าน" }) }))
  expect(api.calls).toContainEqual(["setInsert", FOLDER, start, "m2", "cover", "m2"])
  const remove = () => screen.getByRole("button", { name: t("inserts.removeLabel", { picture: "เล็บสีชมพู" }) })
  await waitFor(() => expect(remove()).toHaveProperty("disabled", false))
  await userEvent.click(remove())
  expect(api.calls).toContainEqual(["setInsert", FOLDER, start, null, undefined, "m1"])
  // each row is a row of its own to React too
  expect(errors.mock.calls.filter((call) => /same key/.test(String(call[0])))).toEqual([])
  cleanup()

  // even one picture stacked twice at one place
  renderScreen(withFlair({ inserts: [first, { ...first, fit: "card" }] }))
  await ready()
  await openTab("techniques")
  expect(await screen.findAllByRole("button", { name: t("inserts.removeLabel", { picture: "เล็บสีชมพู" }) })).toHaveLength(2)
  expect(errors.mock.calls.filter((call) => /same key/.test(String(call[0])))).toEqual([])
  errors.mockRestore()
})

test("with pictures but no cutaway yet, the techniques tab says where to pick one", async () => {
  renderScreen(withFlair())
  await ready()
  await openTab("techniques")
  expect(await screen.findByText(t("inserts.pickHint"))).toBeTruthy()
})

test("a project with no spare pictures says so in the techniques tab", async () => {
  renderScreen(withFlair({ media: [] }))
  await ready()
  await openTab("techniques")
  expect(await screen.findByText(t("flair.noMedia"))).toBeTruthy()
})

test("the techniques tab holds the switches of highlight text, its looks, zooms and cutaways, and each saves its choice; the graphics switch is not among them", async () => {
  const highlightsOn = { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }
  const switches: [MessageKey, unknown][] = [
    ["highlights.enabled", { highlights: { ...highlightsOn, enabled: false } }],
    ["flair.text", { flair: { ...FLAIR_ON, text: false } }],
    ["flair.zoom", { flair: { ...FLAIR_ON, zoom: false } }],
    ["flair.insert", { flair: { ...FLAIR_ON, insert: false } }],
  ]
  for (const [label, saved] of switches) {
    const { api } = renderScreen(withFlair())
    await ready()
    await openTab("techniques")
    // a switch's hint is part of its name
    await userEvent.click(await within(panel()).findByRole("switch", { name: new RegExp(`^${t(label)}`) }))
    expect(api.calls, label).toContainEqual(["updateSettings", saved])
    cleanup()
  }

  // with the highlight text off, the zooms and cutaways are still there to set
  renderScreen({ ...withFlair(), getSettings: async () => settingsView({ flair: FLAIR_ON }) })
  await ready()
  await openTab("techniques")
  expect(await screen.findByText(t("edit.flairMoves"))).toBeTruthy()
  expect(screen.getByText(t("edit.flairInserts"))).toBeTruthy()
  expect(screen.queryByRole("radio", { name: t("highlights.position.bottom") })).toBeNull()
  // the graphics have a tab of their own, and so do their rows
  expect(within(panel()).queryByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) })).toBeNull()
  expect(screen.queryByText(t("edit.flairGraphics"))).toBeNull()
})

test("turning sounds off takes them away and saves the choice", async () => {
  const { api } = renderScreen(withFlair({ composed: [SOUND] }))
  await ready()
  const settings = await openSettings("sound")
  expect(await screen.findByText(SOUND.role)).toBeTruthy()
  await userEvent.click(await within(settings).findByRole("switch", { name: t("flair.sound") }))
  expect(api.calls).toContainEqual(["updateSettings", { flair: { ...FLAIR_ON, sound: false } }])
  expect(screen.queryByText(SOUND.role)).toBeNull()
  expect(screen.queryByText(t("sounds.none"))).toBeNull()
})

test("a group's look is changed in a popover of its own", async () => {
  const { api } = renderScreen(withFlair())
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  const look = screen.getByRole("group", { name: t("edit.look") })
  await userEvent.click(within(look).getByRole("radio", { name: "คำเดียวเต็มจอ" }))
  // every change keeps the rest of the look as it shows, so what is saved is what was seen
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "punch", tone: "base", exit: null }])
  await userEvent.click(within(look).getByRole("radio", { name: t("flair.tone.alt") }))
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stack", tone: "alt", exit: null }])
})

test("changing one thing of a look keeps the rest as it shows, not as it was stored", async () => {
  // the level now in force shows this group as the stack, whatever Claude once chose
  const [g1, g2] = highlightGroups()
  const shown = { ...g1!, look: { ...g1!.look, pattern: "stair" as const, tone: "accent" as const } }
  const { api } = renderScreen(withFlair({ groups: [shown, g2!] }))
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  await userEvent.click(within(screen.getByRole("group", { name: t("edit.look") })).getByRole("radio", { name: t("flair.tone.alt") }))
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stair", tone: "alt", exit: null }])
})

/** the first group holds a Pro exit the user lacks; the popover offers it with the exits the preview lists */
const withHeldExit = () => {
  const [g1, g2] = highlightGroups()
  const held = { ...g1!, heldExit: { id: "spin-out", name: "หมุนหายไป" } }
  // the exit offered is just what this preview lists: since 0.4.3 the real list without Pro is empty (see the `exits: []` tests)
  return withFlair({ groups: [held, g2!], exits: [{ id: "fade-alt", name: "อัลเทอร์เนตเฟด" }] })
}

test("an exit held for want of CapCut Pro shows as chosen, followed by the exits the preview lists and no other", async () => {
  renderScreen(withHeldExit())
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  const look = screen.getByRole("group", { name: t("edit.look") })
  const exit = within(look).getByRole("combobox", { name: t("flair.exit") }) as HTMLSelectElement
  expect(exit.selectedOptions[0]!.textContent).toBe("หมุนหายไป (ต้องมี CapCut Pro · ไม่ใส่ตอนเขียน)")
  expect([...exit.options].map((option) => option.textContent)).toEqual(["หายเฉยๆ", "หมุนหายไป (ต้องมี CapCut Pro · ไม่ใส่ตอนเขียน)", "อัลเทอร์เนตเฟด"])
  expect(within(look).queryByRole("option", { name: "แตกกระจาย" })).toBeNull()
})

test("changing the pattern or the tone of a group with a held exit sends the held exit back, so the stored one is not lost", async () => {
  const { api } = renderScreen(withHeldExit())
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  const look = screen.getByRole("group", { name: t("edit.look") })
  await userEvent.click(within(look).getByRole("radio", { name: "คำเดียวเต็มจอ" }))
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "punch", tone: "base", exit: "spin-out" }])
  await userEvent.click(within(look).getByRole("radio", { name: t("flair.tone.alt") }))
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stack", tone: "alt", exit: "spin-out" }])
})

test("choosing 'no exit' on a group with a held exit drops it on purpose", async () => {
  const { api } = renderScreen(withHeldExit())
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  await userEvent.selectOptions(screen.getByRole("combobox", { name: t("flair.exit") }), "หายเฉยๆ")
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stack", tone: "base", exit: null }])
})

test("choosing another exit on a group with a held exit replaces the held one on purpose", async () => {
  const { api } = renderScreen(withHeldExit())
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  await userEvent.selectOptions(screen.getByRole("combobox", { name: t("flair.exit") }), "อัลเทอร์เนตเฟด")
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stack", tone: "base", exit: "fade-alt" }])
})

/** The line under the exit select when the preview offers no exit, as without CapCut Pro, which every exit needs. */
const ALL_EXITS_PRO = "แอนิเมชันตอนหายไปทุกแบบต้องมี CapCut Pro (ถ้ามี เปิด “มี CapCut Pro” ในตั้งค่า)"

test("with no exit the user may have, the exit select is off, offers only 'no exit', and says every exit needs CapCut Pro", async () => {
  renderScreen(withFlair({ exits: [] }))
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  const look = screen.getByRole("group", { name: t("edit.look") })
  const exit = within(look).getByRole("combobox", { name: t("flair.exit") }) as HTMLSelectElement
  expect(exit.disabled).toBe(true)
  expect([...exit.options].map((option) => option.textContent)).toEqual(["หายเฉยๆ"])
  expect(within(look).getByText(ALL_EXITS_PRO)).toBeTruthy()
  // only the exit is off: the rest of the look still changes
  expect((within(look).getByRole("radio", { name: "คำเดียวเต็มจอ" }) as HTMLInputElement).disabled).toBe(false)
})

test("with no exit the user may have, a held exit keeps the select on, so it can still be dropped, and the line still shows", async () => {
  const [g1, g2] = highlightGroups()
  const held = { ...g1!, heldExit: { id: "spin-out", name: "หมุนหายไป" } }
  const { api } = renderScreen(withFlair({ groups: [held, g2!], exits: [] }))
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  const look = screen.getByRole("group", { name: t("edit.look") })
  const exit = within(look).getByRole("combobox", { name: t("flair.exit") }) as HTMLSelectElement
  expect(exit.disabled).toBe(false)
  expect([...exit.options].map((option) => option.textContent)).toEqual(["หายเฉยๆ", "หมุนหายไป (ต้องมี CapCut Pro · ไม่ใส่ตอนเขียน)"])
  expect(exit.selectedOptions[0]!.textContent).toBe("หมุนหายไป (ต้องมี CapCut Pro · ไม่ใส่ตอนเขียน)")
  expect(within(look).getByText(ALL_EXITS_PRO)).toBeTruthy()
  await userEvent.selectOptions(exit, "หายเฉยๆ")
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stack", tone: "base", exit: null }])
})

test("with no exit the user may have, a held exit's select waits while a change is placed, still showing it as chosen, and is on again once it lands", async () => {
  const [g1, g2] = highlightGroups()
  const held = { ...g1!, heldExit: { id: "spin-out", name: "หมุนหายไป" } }
  let shown = flairPreview({ groups: [held, g2!], exits: [] })
  const previews = heldPreviews(() => shown)
  const { api } = renderScreen({ ...withFlair(), previewHighlights: previews.previewHighlights })
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await waitFor(() => expect(placing()).toBe(false))
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  const exit = () => within(screen.getByRole("group", { name: t("edit.look") })).getByRole("combobox", { name: t("flair.exit") }) as HTMLSelectElement
  const heldLabel = "หมุนหายไป (ต้องมี CapCut Pro · ไม่ใส่ตอนเขียน)"
  expect(exit().disabled).toBe(false)

  previews.holding = true
  await userEvent.click(within(screen.getByRole("group", { name: t("edit.look") })).getByRole("radio", { name: t("flair.tone.alt") }))
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stack", tone: "alt", exit: "spin-out" }])
  await waitFor(() => expect(previews.held.length).toBeGreaterThan(0))
  expect(exit().disabled).toBe(true)
  expect(exit().selectedOptions[0]!.textContent).toBe(heldLabel)

  // the new placement lands: the tone changed, the exit still held
  shown = flairPreview({ groups: [{ ...held, look: { ...held.look, tone: "alt" } }, g2!], exits: [] })
  previews.holding = false
  await act(async () => previews.held.splice(0).forEach(({ resolve }) => resolve(shown)))
  await waitFor(() => expect(placing()).toBe(false))
  expect(exit().disabled).toBe(false)
  expect(exit().selectedOptions[0]!.textContent).toBe(heldLabel)
})

test("with exits the preview lists, the exit select is on and says nothing about CapCut Pro, held exit or not", async () => {
  // every exit, as with CapCut Pro; then one exit and a held one
  for (const view of [withFlair(), withHeldExit()]) {
    renderScreen(view)
    await ready()
    await openTab("techniques")
    await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
    await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
    const look = screen.getByRole("group", { name: t("edit.look") })
    expect((within(look).getByRole("combobox", { name: t("flair.exit") }) as HTMLSelectElement).disabled).toBe(false)
    expect(within(look).queryByText(ALL_EXITS_PRO)).toBeNull()
    cleanup()
  }
})

test("a coloured word says which stored line it is on, when a line above it was cut", async () => {
  // the group's first stored line was cut: what shows first is its second
  const [g1, g2] = highlightGroups()
  const shifted = { ...g1!, lines: [{ index: 1, text: "ราคา 500", startUs: 900_000, partial: false }] }
  const { api } = renderScreen(withFlair({ groups: [shifted, g2!] }))
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("edit.look")) })[0]!)
  await userEvent.selectOptions(screen.getByRole("combobox", { name: t("flair.accent") }), "0:500")
  expect(api.calls).toContainEqual(["setFlairLook", FOLDER, "g1", { pattern: "stack", tone: "base", exit: null, accent: { line: 0, lineIndex: 1, word: "500" } }])
})

test("with the looks off a group offers none", async () => {
  renderScreen({
    ...withText,
    getSettings: async () => settingsView({ highlights: { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }, flair: { ...FLAIR_ON, text: false } }),
  })
  await ready()
  await openTab("techniques")
  await screen.findAllByRole("button", { name: t("highlights.removeGroup") })
  expect(screen.queryByRole("button", { name: new RegExp(t("edit.look")) })).toBeNull()
})

/* graphics */

const GRAPHICS_ON = { ...FLAIR_ON, graphic: true }
const withGraphics = (extra: Partial<HighlightPreview> = {}, flair: Partial<FlairOptions> = {}) => ({
  ...withFlair(extra),
  getSettings: async () =>
    settingsView({ highlights: { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }, flair: { ...GRAPHICS_ON, ...flair } }),
})
const openFlair = () => openTab("graphics")
const graphicRows = () => screen.getAllByRole("listitem").filter((item) => item.classList.contains("graphic"))
const ONLY_GRAPHICS = { sound: false, zoom: false, insert: false }

// what is drawn and how it moves, as Claude's plan says it: the brief its writing is given, and the row's summary
const IDEA = "ตัวเลข 590 บาทเด้งขึ้นบนแผ่นป้ายกลางจอ เส้นใต้ลากตามคำว่าบาท แล้วทั้งแผ่นจางหายไป"
const MOTION_SPEC: MotionSpec = {
  kind: "motion",
  version: MOTION_VERSION,
  box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 },
  seconds: 3,
  why: "ย้ำราคาให้จำง่าย",
  idea: IDEA,
  words: [
    { text: "ราคา", atS: 0.2 },
    { text: "590", atS: 0.7 },
    { text: "บาท", atS: 1.2 },
  ],
  html: '<style>.tag{animation:pop 0.4s both}@keyframes pop{from{opacity:0}to{opacity:1}}</style><div class="tag">590</div>',
}
// a motion graphic Claude has written, as the main process lists it while its render goes
const MOTION: GraphicView = {
  anchor: { kind: "speech", videoId: "a", sourceUs: 2_500_000, beatId: "b1" },
  atUs: 750_000,
  durationUs: 3_000_000,
  what: "ที่ “เอาล่ะครับวันนี้”",
  beatId: "b1",
  why: "ย้ำราคาให้จำง่าย",
  summary: IDEA,
  spec: MOTION_SPEC,
  written: true,
  stale: false,
  writeFailed: null,
  instruction: null,
  editFailed: null,
  canUndo: false,
  render: "rendering",
  poster: null,
  error: null,
  edited: false,
  off: false,
  from: null,
  replaces: false,
  coversKeep: false,
}
/** A motion graphic with no fragment yet, as the main process lists it: nothing of it is rendered, so it waits with no poster. */
const unwritten = (extra: Partial<GraphicView> = {}): GraphicView => ({ ...MOTION, spec: { ...MOTION_SPEC, html: null }, written: false, render: "waiting", ...extra })
/** The same graphic at another place of the opening, which is what the main process finds a graphic by. */
const motionAt = (sourceUs: number, extra: Partial<GraphicView> = {}): GraphicView => ({ ...MOTION, anchor: { kind: "speech", videoId: "a", sourceUs, beatId: "b1" }, atUs: sourceUs - 1_750_000, ...extra })
// a second graphic of the opening, drawn from another idea, so that its row is told apart by what it shows
const OTHER_IDEA = "ป้ายลดครึ่งราคาหมุนเข้ามาจากขวา แล้วเด้งหนึ่งครั้ง"
const OTHER: GraphicView = motionAt(4_000_000, { summary: OTHER_IDEA, spec: { ...MOTION_SPEC, idea: OTHER_IDEA } })
const graphicButton = (
  key: "graphics.redoLabel" | "graphics.editLabel" | "graphics.undoLabel" | "graphics.offLabel" | "graphics.onLabel" | "graphics.removeLabel" | "graphics.retryLabel",
  summary = MOTION.summary,
) => screen.getByRole("button", { name: t(key, { summary }) })
// the words of spec §8 of the free-form motion design, as the user reads them
const REDO = "ทำใหม่"
// read out, the button is named by what it shows and then by its graphic, as the row's other buttons are
const redoLabel = (summary = IDEA) => `${REDO} ${summary}`
const WRITING = "กำลังเขียน…"
const UNWRITTEN = "ยังไม่ได้เขียน กดทำใหม่"
const WRITE_FAILED = "เขียนไม่สำเร็จ"
const STALE = "การตัดช่วงนี้เปลี่ยนไป กดทำใหม่"
// the words of §2 of the design of editing a graphic by instruction (0.5.1), as the user reads them
const EDIT = "แก้"
const UNDO = "ย้อน"
const editLabel = (summary = IDEA) => `${EDIT} ${summary}`
const undoLabel = (summary = IDEA) => `${UNDO} ${summary}`
const EDIT_FIELD = "จะให้ AI แก้อะไร"
const SEND = "ส่งให้ AI แก้"
const CANCEL = "ยกเลิก"
const TOO_LONG = "ยาวเกิน 300 ตัวอักษร"
const EDITING = "กำลังแก้…"
const EDIT_FAILED = "แก้ไม่สำเร็จ"
const editField = () => screen.getByRole("textbox", { name: EDIT_FIELD })
const noEditField = () => expect(screen.queryByRole("textbox", { name: EDIT_FIELD })).toBeNull()
/** What a row says of how its graphic stands: one line, so one text. */
const stateOf = (row: HTMLElement) => [...row.querySelectorAll(".graphic-state")].map((line) => line.textContent)

test("the graphics switch sits at the head of the graphics tab, says what turning it on brings, and turning it on saves the choice", async () => {
  const { api } = renderScreen(withFlair())
  await ready()
  const settings = await openSettings("graphics")
  // the hint is part of the switch's name
  const graphics = (await within(settings).findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) })) as HTMLInputElement
  // Claude writes each graphic itself now: the hint names no kit, and says what it costs
  expect(within(graphics.closest("label")!).getByText("AI ออกแบบและเขียนแอนิเมชันเองให้เข้ากับเรื่องที่พูด ต้องติดตั้งตัวเรนเดอร์ในหน้าตั้งค่า และเรียก Claude เพิ่มหนึ่งครั้งต่อชิ้นตอนวางแผน")).toBeTruthy()
  expect(graphics.checked).toBe(false)
  await userEvent.click(graphics)
  expect(api.calls).toContainEqual(["updateSettings", { flair: GRAPHICS_ON }])
})

test("the graphics tab lists the beat's graphics with what they show and how their render stands", async () => {
  renderScreen(withGraphics({ graphics: [MOTION] }))
  await ready()
  await openFlair()
  expect(screen.getByText(t("edit.flairGraphics"))).toBeTruthy()
  expect(screen.getByText(MOTION.summary)).toBeTruthy()
  expect(screen.getByText(MOTION.why)).toBeTruthy()
  expect(screen.getByText(t("graphics.render.rendering"))).toBeTruthy()
  // no poster until it is made, and the space it takes is not the look of an empty list
  const [row] = graphicRows()
  expect(row!.querySelector("img")).toBeNull()
  expect(row!.querySelector(".empty")).toBeNull()
  expect(screen.queryByText(t("graphics.waitForPack"))).toBeNull()
})

test("a graphic that is made shows its poster", async () => {
  renderScreen(withGraphics({ graphics: [{ ...MOTION, render: "ready", poster: "data:image/png;base64,iVBORw0KGgo=" }] }))
  await ready()
  await openFlair()
  const poster = graphicRows()[0]!.querySelector("img")!
  expect(poster.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=")
  // the summary is written beside it, so the picture says nothing more to a screen reader
  expect(poster.getAttribute("alt")).toBe("")
  expect(screen.getByText(t("graphics.render.ready"))).toBeTruthy()
})

test("a graphic can be switched off, switched back on, and removed", async () => {
  const off: GraphicView = { ...OTHER, render: "waiting", off: true }
  const { api } = renderScreen(withGraphics({ graphics: [MOTION, off] }))
  await ready()
  await openFlair()
  const [playing, switchedOff] = graphicRows()
  expect(switchedOff!.classList.contains("off")).toBe(true)
  expect(within(playing!).getByRole("button", { name: t("graphics.offLabel", { summary: MOTION.summary }) }).textContent).toBe(t("graphics.off"))
  await userEvent.click(graphicButton("graphics.offLabel"))
  expect(api.calls).toContainEqual(["setGraphic", FOLDER, MOTION.anchor, { off: true }])
  await waitFor(() => expect(graphicButton("graphics.onLabel", off.summary)).toHaveProperty("disabled", false))
  expect(within(switchedOff!).getByRole("button", { name: t("graphics.onLabel", { summary: off.summary }) }).textContent).toBe(t("graphics.on"))
  await userEvent.click(graphicButton("graphics.onLabel", off.summary))
  expect(api.calls).toContainEqual(["setGraphic", FOLDER, off.anchor, { off: false }])
  await waitFor(() => expect(graphicButton("graphics.removeLabel")).toHaveProperty("disabled", false))
  expect(graphicButton("graphics.removeLabel").textContent).toBe(t("graphics.remove"))
  await userEvent.click(graphicButton("graphics.removeLabel"))
  expect(api.calls).toContainEqual(["setGraphic", FOLDER, MOTION.anchor, null])
})

test("a failed render says why in its last lines, and can be tried again", async () => {
  const error = "Error: hyperframes exited with code 1\nat render (render.js:10)\n\nChrome crashed\nframe 12 of 90\nout of memory\n"
  const { api } = renderScreen(withGraphics({ graphics: [{ ...MOTION, render: "failed", error }] }))
  await ready()
  await openFlair()
  // the whole error is kept for a pointer held over it
  expect(screen.getByText(`${t("graphics.render.failed")} · Chrome crashed frame 12 of 90 out of memory`).getAttribute("title")).toBe(error)
  expect(graphicButton("graphics.retryLabel").textContent).toBe(t("graphics.retry"))
  await userEvent.click(graphicButton("graphics.retryLabel"))
  expect(api.calls).toContainEqual(["retryGraphic", FOLDER, MOTION.anchor])
  await waitFor(() => expect(calls(api, "previewHighlights")).toHaveLength(2))
})

test("only a failed render offers to be tried again", async () => {
  renderScreen(withGraphics({ graphics: [MOTION] }))
  await ready()
  await openFlair()
  expect(screen.queryByRole("button", { name: t("graphics.retryLabel", { summary: MOTION.summary }) })).toBeNull()
})

test("graphics waiting for the renderer say where to install it", async () => {
  renderScreen(withGraphics({ graphics: [{ ...MOTION, render: "waiting" }], graphicsWaitForPack: true }))
  await ready()
  await openFlair()
  expect(screen.getByText(t("graphics.waitForPack"))).toBeTruthy()
  expect(screen.getByText(t("graphics.render.waiting"))).toBeTruthy()
})

test("graphics a render found this machine unfit for say why, and how to put it right, rather than that the renderer is not installed", async () => {
  const problem = "the graphics renderer is damaged: reinstall it in settings (chrome-headless-shell is missing)"
  renderScreen(withGraphics({ graphics: [{ ...MOTION, render: "waiting" }], graphicsWaitForPack: true, graphicsProblem: { text: problem } }))
  await ready()
  await openFlair()
  expect(screen.getByText(t("graphics.problem", { problem }))).toBeTruthy()
  expect(screen.queryByText(t("graphics.waitForPack"))).toBeNull()
  expect(screen.getByText(t("graphics.render.waiting"))).toBeTruthy()
})

test("with graphics alone on, a beat without one says so rather than that the beat has nothing", async () => {
  renderScreen(withGraphics({}, { sound: false, zoom: false, insert: false }))
  await ready()
  await openFlair()
  expect(screen.getByText(t("graphics.none"))).toBeTruthy()
  // that this stretch has none, and the menu item that plans some
  expect(t("graphics.none")).toBe("ยังไม่มีกราฟิกในช่วงนี้ กดคิดใหม่: กราฟิก ในเมนู AI")
  expect(screen.queryByText(t("edit.flairEmpty"))).toBeNull()
})

test("at the lightest level the graphics tab shows the graphics, as at any level", async () => {
  renderScreen(withGraphics({ graphics: [MOTION] }, { level: "light", sound: false, zoom: false, insert: false }))
  await ready()
  await openFlair()
  expect(screen.getByText(MOTION.summary)).toBeTruthy()
})

test("the techniques tab counts the beat's highlight text, zooms and cutaways, and the graphics tab the graphics that play", async () => {
  const off: GraphicView = { ...MOTION, anchor: { kind: "speech", videoId: "a", sourceUs: 4_000_000, beatId: "b1" }, off: true }
  renderScreen(withGraphics({ graphics: [MOTION, off], zooms: [{ anchor: { videoId: "a", sourceUs: 1_750_000 }, atUs: 0, durationUs: 1_000_000, what: "ช่วงเปิด", beatId: "b1", kind: "punch", edited: false }] }))
  await ready()
  // the opening's group and its zoom
  await waitFor(() => expect(tab("techniques").querySelector(".tab-count")!.textContent).toBe("2"))
  // the one graphic that plays
  expect(tab("graphics").querySelector(".tab-count")!.textContent).toBe("1")
})

test("the graphics tab's count leaves the graphics out while graphics are off", async () => {
  renderScreen(withGraphics({ graphics: [MOTION] }, { ...ONLY_GRAPHICS, graphic: false }))
  await ready()
  await openTab("techniques")
  // the preview is on screen once the beat counts its highlight text
  await waitFor(() => expect(within(beatPick("เปิดเรื่อง")).getByText("Aa 1")).toBeTruthy())
  expect(tab("techniques").querySelector(".tab-count")!.textContent).toBe("1")
  expect(tab("graphics").querySelector(".tab-count")!.textContent).toBe("0")
})

test("a graphic the user changed by hand says so, and one Claude made does not", async () => {
  const mine: GraphicView = { ...OTHER, edited: true }
  renderScreen(withGraphics({ graphics: [MOTION, mine] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const [claudes, users] = graphicRows()
  expect(within(users!).getByText(t("flair.edited"))).toBeTruthy()
  expect(within(claudes!).queryByText(t("flair.edited"))).toBeNull()
})

/** What a graphic's row says under its poster, line by line, in the order it says it. */
const bodyLines = (row: HTMLElement) => [...row.querySelector(".graphic-body")!.children].map((line) => line.textContent)

test("a free graphic's row says, in order: its idea, the last edit, why, the point it tells the story of, the level it plays from, that it takes the text's place, that it covers a face or a thing, how it stands, the failed edit and that it was changed by hand", async () => {
  const free: GraphicView = {
    ...MOTION,
    pointId: "p1",
    from: "medium",
    replaces: true,
    coversKeep: true,
    instruction: "ให้ตัวเลขใหญ่ขึ้น",
    editFailed: "Claude is busy",
    edited: true,
    render: "ready",
  }
  renderScreen(withGraphics({ graphics: [free], emphasis: emphasisOf() }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  await screen.findByText(MOTION.summary)
  expect(bodyLines(graphicRows()[0]!)).toEqual([
    IDEA,
    t("graphics.lastEdit", { instruction: "ให้ตัวเลขใหญ่ขึ้น" }),
    MOTION.why,
    t("graphics.ofPoint", { text: "เอาล่ะครับ" }),
    t("graphics.from.medium"),
    t("graphics.replaces"),
    t("graphics.coversKeep"),
    t("graphics.render.ready"),
    `${t("graphics.editFailed")} · Claude is busy`,
    t("flair.edited"),
  ])
  // in the user's words
  expect(bodyLines(graphicRows()[0]!).slice(3, 7)).toEqual(["เล่าเรื่องของจุด “เอาล่ะครับ”", "เล่นตั้งแต่ระดับกลาง", "ขึ้นแทนข้อความเด่น", "ทับหน้าคนหรือของ จึงขึ้นแค่ 1.5 วิ"])
})

test("a free graphic says the level it plays from, each level in its own words, and says nothing of a text it does not replace or of a cover it does not make", async () => {
  for (const from of ["light", "medium", "heavy"] as const) {
    renderScreen(withGraphics({ graphics: [{ ...MOTION, from, render: "ready" }], emphasis: emphasisOf() }, ONLY_GRAPHICS))
    await ready()
    await openFlair()
    await screen.findByText(MOTION.summary)
    expect(bodyLines(graphicRows()[0]!), from).toEqual([IDEA, MOTION.why, t(`graphics.from.${from}` as MessageKey), t("graphics.render.ready")])
    cleanup()
  }
  expect([t("graphics.from.light"), t("graphics.from.heavy")]).toEqual(["เล่นตั้งแต่ระดับเบา", "เล่นเฉพาะจัดเต็ม"])
})

test("a free graphic tied to no point, or to a point not on the cut, names none", async () => {
  renderScreen(withGraphics({ graphics: [{ ...MOTION, from: "light", render: "ready" }, motionAt(4_000_000, { from: "light", render: "ready", pointId: "p9", summary: OTHER_IDEA })], emphasis: emphasisOf() }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  await screen.findByText(MOTION.summary)
  for (const row of graphicRows()) {
    expect(within(row).queryByText(/เล่าเรื่องของจุด|จากจุดเน้น/)).toBeNull()
  }
})

test("a graphic planned before 0.7.0 names the point it was made for as before, says no level and no cover, and says it takes the text's place only when main says it does", async () => {
  renderScreen(withGraphics({ graphics: [{ ...MOTION, pointId: "p1", render: "ready" }], emphasis: emphasisOf() }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  await screen.findByText(MOTION.summary)
  expect(bodyLines(graphicRows()[0]!)).toEqual([IDEA, MOTION.why, t("emphasis.from", { text: "เอาล่ะครับ" }), t("graphics.render.ready")])
  cleanup()

  // written and fresh, a legacy graphic takes its point's text's place, and its row says so
  renderScreen(withGraphics({ graphics: [{ ...MOTION, pointId: "p1", render: "ready", replaces: true }], emphasis: emphasisOf() }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  await screen.findByText(MOTION.summary)
  expect(bodyLines(graphicRows()[0]!)).toEqual([IDEA, MOTION.why, t("emphasis.from", { text: "เอาล่ะครับ" }), t("graphics.replaces"), t("graphics.render.ready")])
})

test("with graphics off the graphics tab holds the switch alone: no heading, no notice and no rows", async () => {
  renderScreen(withGraphics({ graphics: [MOTION], graphicsWaitForPack: true }, { ...ONLY_GRAPHICS, graphic: false }))
  await ready()
  await openFlair()
  expect(await within(panel()).findByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) })).toBeTruthy()
  expect(screen.queryByText(t("edit.flairGraphics"))).toBeNull()
  expect(screen.queryByText(t("graphics.waitForPack"))).toBeNull()
  expect(panel().querySelector(".notice")).toBeNull()
  expect(screen.queryByText(MOTION.summary)).toBeNull()
  expect(screen.queryByText(t("graphics.none"))).toBeNull()
})

test("the whole clip lists its graphics in the order they play", async () => {
  renderScreen(withGraphics({ graphics: [OTHER, MOTION], emphasis: emphasisOf() }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  await userEvent.click(wholeClipPick())
  await screen.findByText(MOTION.summary)
  expect(graphicRows().map((row) => row.querySelector(".flair-what")!.textContent)).toEqual([IDEA, OTHER_IDEA])
})

test("a switched-off graphic says it is off rather than how its render stands, and offers no retry", async () => {
  const waiting: GraphicView = { ...MOTION, anchor: { kind: "speech", videoId: "a", sourceUs: 4_000_000, beatId: "b1" }, atUs: 2_000_000, render: "waiting", off: true }
  const failed: GraphicView = { ...MOTION, anchor: { kind: "speech", videoId: "a", sourceUs: 5_000_000, beatId: "b1" }, atUs: 3_000_000, render: "failed", error: "Chrome crashed", off: true }
  renderScreen(withGraphics({ graphics: [waiting, failed] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const rows = graphicRows()
  expect(rows).toHaveLength(2)
  for (const row of rows) {
    expect(within(row).getByText(t("graphics.offState"))).toBeTruthy()
    expect(within(row).queryByText(t("graphics.render.waiting"))).toBeNull()
    expect(within(row).queryByText(new RegExp(t("graphics.render.failed")))).toBeNull()
    expect(within(row).queryByRole("button", { name: t("graphics.retryLabel", { summary: MOTION.summary }) })).toBeNull()
  }
  expect(screen.queryByText(/Chrome crashed/)).toBeNull()
})

test("a graphic made in the background shows as soon as it is made", async () => {
  let made = false
  const { api } = renderScreen({
    ...withGraphics(),
    previewHighlights: async () => flairPreview({ graphics: [made ? { ...MOTION, render: "ready", poster: "data:image/png;base64,iVBORw0KGgo=" } : MOTION] }),
  })
  await ready()
  await openFlair()
  expect(screen.getByText(t("graphics.render.rendering"))).toBeTruthy()
  made = true
  act(() => api.emit({ type: "graphics", folder: FOLDER, state: "done" }))
  await waitFor(() => expect(graphicRows()[0]!.querySelector("img")).not.toBeNull())
  expect(calls(api, "previewHighlights")).toHaveLength(2)
})

test("a graphic's row says how long it plays, which the cut can make shorter than its length", async () => {
  renderScreen(withGraphics({ graphics: [{ ...MOTION, durationUs: 2_160_000 }] }))
  await ready()
  await openFlair()
  expect(within(graphicRows()[0]!).getByText(t("edit.pieceLength", { seconds: "2.1" }))).toBeTruthy()
})

/* a motion graphic's row: what it shows, how it stands, and what can be done with it */

test("a graphic's row shows its poster, its idea, why it is there, the point it was made for and how long it plays", async () => {
  const made: GraphicView = { ...MOTION, render: "ready", poster: "data:image/png;base64,iVBORw0KGgo=", durationUs: 2_160_000, pointId: "p1" }
  renderScreen(withGraphics({ graphics: [made], emphasis: emphasisOf() }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const [row] = graphicRows()
  expect(row!.querySelector("img")!.getAttribute("src")).toBe(made.poster)
  // the row holds the idea to two lines, so the whole of it is there for a pointer held over it
  expect(within(row!).getByText(IDEA).getAttribute("title")).toBe(IDEA)
  expect(within(row!).getByText(MOTION.why)).toBeTruthy()
  expect(within(row!).getByText(t("emphasis.from", { text: "เอาล่ะครับ" }))).toBeTruthy()
  // cut down, never rounded up to a length it does not reach
  expect(within(row!).getByText(t("edit.pieceLength", { seconds: "2.1" }))).toBeTruthy()
  expect(stateOf(row!)).toEqual([t("graphics.render.ready")])
})

test("a graphic not written yet says so and how to get it written; while the graphics work of a run goes, it says it is being written", async () => {
  const { api } = renderScreen(withGraphics({ graphics: [unwritten()] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const state = () => stateOf(graphicRows()[0]!)
  expect(state()).toEqual([UNWRITTEN])
  // it waits to be written, not for a render: none can be tried again
  expect(screen.queryByRole("button", { name: t("graphics.retryLabel", { summary: IDEA }) })).toBeNull()
  // a run that has not reached its graphics work is not writing it yet
  act(() => {
    api.emit(planEvent("emphasis", { state: "running" }))
    api.emit(planEvent("graphics", { state: "waiting" }))
  })
  expect(state()).toEqual([UNWRITTEN])
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  expect(state()).toEqual([WRITING])
  act(() => api.emit(planEvent("graphics", { state: "running", done: 0, total: 1 })))
  expect(state()).toEqual([WRITING])
  // the run over and the graphic still not written, as after a stop: it waits for the user again
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(state()).toEqual([UNWRITTEN]))
})

test("a graphic whose writing failed says why in its last lines, as a warning, whether or not a run is writing", async () => {
  const why = [
    "uses `setTimeout`: the renderer sets time itself, animate with CSS animations or el.animate()",
    "",
    "nothing was drawn: every frame is empty",
    "it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D",
    "the page never became ready (its script did not finish)",
  ].join("\n")
  const failed = unwritten({ spec: { ...MOTION_SPEC, html: null, failed: why }, writeFailed: why })
  // a failure that came with no words is a failure all the same
  const wordless = motionAt(4_000_000, { spec: { ...MOTION_SPEC, html: null, failed: "" }, written: false, render: "waiting", writeFailed: "" })
  const { api } = renderScreen(withGraphics({ graphics: [failed, wordless] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const said = `${WRITE_FAILED} · nothing was drawn: every frame is empty it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D the page never became ready (its script did not finish)`
  const states = () => graphicRows().map(stateOf)
  // that it is not written is said by the failure, once
  expect(states()).toEqual([[said], [WRITE_FAILED]])
  const line = within(graphicRows()[0]!).getByText(said)
  // the whole of it is kept for a pointer held over it
  expect(line.getAttribute("title")).toBe(why)
  expect(line.classList.contains("warn-text")).toBe(true)
  // a run writing graphics is not known to be writing this one: what is known of it is that its last writing failed
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  expect(states()).toEqual([[said], [WRITE_FAILED]])
})

test("a graphic the cut changed under says to have it written again, rather than that it waits for a render", async () => {
  // as the main process lists a stale one: written, with nothing of it rendered
  renderScreen(withGraphics({ graphics: [{ ...MOTION, stale: true, render: "waiting" }] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  expect(stateOf(graphicRows()[0]!)).toEqual([STALE])
  expect(screen.queryByText(t("graphics.render.waiting"))).toBeNull()
})

test("a graphic the cut changed under, whose fragment a change of the user's made, names แก้ as well: a redo would throw that change away, where แก้ fits it to the cut and keeps it", async () => {
  renderScreen(withGraphics({ graphics: [motionAt(2_500_000, { stale: true, render: "waiting", instruction: "ใหญ่ขึ้น", canUndo: true }), motionAt(4_000_000, { stale: true, render: "waiting" })] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  expect(graphicRows().map(stateOf)).toEqual([["การตัดช่วงนี้เปลี่ยนไป กดแก้หรือทำใหม่"], [STALE]])
})

test("a row says one thing of how its graphic stands, the first that holds: switched off, its writing failed, the cut changed, not written, then its render", async () => {
  const graphics = [
    motionAt(2_500_000, { off: true, written: false, stale: true, writeFailed: "nothing was drawn", render: "waiting" }),
    motionAt(3_000_000, { written: false, stale: true, writeFailed: "nothing was drawn", render: "waiting" }),
    motionAt(3_500_000, { stale: true, render: "ready" }),
    motionAt(4_000_000, { written: false, render: "ready" }),
    motionAt(4_500_000, { render: "ready" }),
  ]
  renderScreen(withGraphics({ graphics }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  expect(graphicRows().map(stateOf)).toEqual([
    [t("graphics.offState")],
    [`${WRITE_FAILED} · nothing was drawn`],
    [STALE],
    [UNWRITTEN],
    [t("graphics.render.ready")],
  ])
  // however it stands, a motion graphic can be written again
  for (const row of graphicRows()) expect(within(row).getByRole("button", { name: redoLabel() }).textContent).toBe(REDO)
})

/** The second graphic of the opening, not written yet. */
const otherUnwritten = (): GraphicView => unwritten({ anchor: OTHER.anchor, atUs: OTHER.atUs, summary: OTHER_IDEA, spec: { ...MOTION_SPEC, idea: OTHER_IDEA, html: null } })
/**
 * The previews of a room whose graphics are `listed()` when each read is answered. Every read hands over new
 * objects, as one that crosses from the main process does: a row known by the object it was given would be lost
 * at the next read. Held like `heldPreviews`, with `land` to let every held read land, the latest last.
 */
function listedPreviews(listed: () => GraphicView[]) {
  const answer = () => flairPreview({ graphics: structuredClone(listed()) })
  const previews = heldPreviews(answer)
  return {
    previewHighlights: previews.previewHighlights,
    held: previews.held,
    hold: () => void (previews.holding = true),
    land: () => act(async () => previews.held.splice(0).forEach(({ resolve }) => resolve(answer()))),
  }
}

test("while a graphic is written again only its own row reads กำลังเขียน…, from the press until the read that follows the run's end has landed: then each row reads its true line", async () => {
  // the one written again is stale, as it usually is; nothing is writing the one beside it
  let graphics: GraphicView[] = [{ ...MOTION, stale: true, render: "waiting" }, otherUnwritten()]
  const previews = listedPreviews(() => graphics)
  let finish!: (view: PostRunView) => void
  const { api } = renderScreen({
    ...withGraphics({}, ONLY_GRAPHICS),
    previewHighlights: previews.previewHighlights,
    redoGraphic: () => new Promise<PostRunView>((resolve) => (finish = resolve)),
  })
  await ready()
  await openFlair()
  await waitFor(() => expect(placing()).toBe(false))
  const states = () => graphicRows().map(stateOf)
  const reads = () => calls(api, "previewHighlights").length
  expect(states()).toEqual([[STALE], [UNWRITTEN]])

  await userEvent.click(screen.getByRole("button", { name: redoLabel() }))
  // from the press, and the one asked for alone
  expect(states()).toEqual([[WRITING], [UNWRITTEN]])
  // as the main process plays a redo: the graphics work waits, runs, and counts none written of the one
  act(() => api.emit(planEvent("graphics", { state: "waiting" })))
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  expect(states()).toEqual([[WRITING], [UNWRITTEN]])
  const before = reads()
  act(() => api.emit(planEvent("graphics", { state: "running", done: 0, total: 1 })))
  // that count is read in the middle of the writing, and the read brings new objects: the row is known by its place
  expect(reads()).toBe(before + 1)
  await act(async () => {})
  expect(states()).toEqual([[WRITING], [UNWRITTEN]])

  // the writing ends: main stores it, counts it, ends the work and the run, then answers; the reads that follow are held
  previews.hold()
  graphics = [{ ...MOTION, render: "ready" }, otherUnwritten()]
  act(() => api.emit(planEvent("graphics", { state: "running", done: 1, total: 1 })))
  act(() => api.emit(planEvent("graphics", { state: "done", count: 1, dropped: 0 })))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => finish({ running: false, states: { graphics: { state: "done", count: 1, dropped: 0 } } }))
  expect(previews.held.length).toBeGreaterThan(0)
  // the run is over, and the rows still show what was read before its end: the graphic does not go back to its old line
  expect(states()).toEqual([[WRITING], [UNWRITTEN]])
  await previews.land()
  await waitFor(() => expect(states()).toEqual([[t("graphics.render.ready")], [UNWRITTEN]]))
})

test("the graphic being written again reads กำลังเขียน… whatever else is true of it: switched off, or its last writing failed", async () => {
  const why = "nothing was drawn: every frame is empty"
  const cases: [GraphicView, string][] = [
    [{ ...MOTION, off: true }, t("graphics.offState")],
    [unwritten({ spec: { ...MOTION_SPEC, html: null, failed: why }, writeFailed: why }), `${WRITE_FAILED} · ${why}`],
  ]
  for (const [graphic, line] of cases) {
    const previews = listedPreviews(() => [graphic])
    const { api } = renderScreen({ ...withGraphics({}, ONLY_GRAPHICS), previewHighlights: previews.previewHighlights, redoGraphic: () => new Promise<PostRunView>(() => {}) })
    await ready()
    await openFlair()
    const redo = screen.getByRole("button", { name: redoLabel() })
    await waitFor(() => expect(redo).toHaveProperty("disabled", false))
    expect(stateOf(graphicRows()[0]!), line).toEqual([line])
    await userEvent.click(redo)
    expect(stateOf(graphicRows()[0]!), line).toEqual([WRITING])
    // and through the read its own count brings
    act(() => api.emit(planEvent("graphics", { state: "running", done: 0, total: 1 })))
    await act(async () => {})
    expect(stateOf(graphicRows()[0]!), line).toEqual([WRITING])
    cleanup()
  }
})

test("when the graphics work of a plan run ends, a graphic goes on reading กำลังเขียน… until the read that follows has landed, and then reads its true line: written, stopped or failed", async () => {
  /** A plan run whose graphics work is writing the one graphic listed, with nothing being placed. */
  const planWriting = async () => {
    const listed = { graphics: [unwritten()] as GraphicView[] }
    const previews = listedPreviews(() => listed.graphics)
    const { api } = renderScreen({ ...withGraphics({}, ONLY_GRAPHICS), previewHighlights: previews.previewHighlights })
    await ready()
    await openFlair()
    await waitFor(() => expect(placing()).toBe(false))
    // a run that is not a redo: its graphics work writes what is not written yet
    act(() => api.emit(planEvent("graphics", { state: "running" })))
    expect(graphicRows().map(stateOf)).toEqual([[WRITING]])
    return { api, previews, listed }
  }

  // written: main stores it, counts it and ends the work in one turn, and the read that follows is held
  const written = await planWriting()
  written.previews.hold()
  written.listed.graphics = [{ ...MOTION, render: "ready" }]
  act(() => written.api.emit(planEvent("graphics", { state: "running", done: 1, total: 1 })))
  act(() => written.api.emit(planEvent("graphics", { state: "done", count: 1, dropped: 0 })))
  act(() => written.api.emit({ type: "post-plan-finished", folder: FOLDER }))
  // the rows still show the read from before, where it has no fragment: it is written, so it does not say it waits for the user
  expect(graphicRows().map(stateOf)).toEqual([[WRITING]])
  await written.previews.land()
  await waitFor(() => expect(graphicRows().map(stateOf)).toEqual([[t("graphics.render.ready")]]))
  cleanup()

  // stopped: the work ends as failed with the user's stop, the run ends, and the graphic was not written
  const stopped = await planWriting()
  stopped.previews.hold()
  act(() => stopped.api.emit(planEvent("graphics", { state: "failed", error: "cancelled" })))
  act(() => stopped.api.emit({ type: "post-plan-finished", folder: FOLDER }))
  expect(graphicRows().map(stateOf)).toEqual([[WRITING]])
  await stopped.previews.land()
  await waitFor(() => expect(graphicRows().map(stateOf)).toEqual([[UNWRITTEN]]))
  cleanup()

  // failed in a run that goes on with its other works: the read that follows is asked for there, not left to the run's end
  const failed = await planWriting()
  failed.previews.hold()
  act(() => failed.api.emit(planEvent("graphics", { state: "failed", error: "Claude is busy" })))
  act(() => failed.api.emit(planEvent("sounds", { state: "running" })))
  expect(failed.previews.held).toHaveLength(1)
  expect(graphicRows().map(stateOf)).toEqual([[WRITING]])
  await failed.previews.land()
  await waitFor(() => expect(graphicRows().map(stateOf)).toEqual([[UNWRITTEN]]))
})

// how the main process answers a redo that wrote its graphic, once it has played it
const REDONE: PostRunView = { running: false, states: { graphics: { state: "done", count: 1, dropped: 0 } } }
/** A redo that wrote its graphic, as the main process plays it before it answers: the work waits, runs, counts its one writing, ends done, and the run is over. */
function playRedo(api: { emit(event: AppEvent): void }) {
  const states: PostWorkState[] = [{ state: "waiting" }, { state: "running" }, { state: "running", done: 0, total: 1 }, { state: "running", done: 1, total: 1 }, { state: "done", count: 1, dropped: 0 }]
  for (const state of states) act(() => api.emit(planEvent("graphics", state)))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
}

test("ทำใหม่ on a motion graphic's row has Claude write it again, asked through the room with the request a plan is asked with", async () => {
  let answer!: (view: PostRunView) => void
  const { api } = renderScreen({ ...withGraphics({ graphics: [MOTION] }, ONLY_GRAPHICS), redoGraphic: () => new Promise<PostRunView>((resolve) => (answer = resolve)) })
  await ready()
  await openFlair()
  const redo = screen.getByRole("button", { name: redoLabel() })
  expect(redo.textContent).toBe(REDO)
  await waitFor(() => expect(redo).toHaveProperty("disabled", false))
  await userEvent.click(redo)
  await waitFor(() => expect(calls(api, "redoGraphic")).toHaveLength(1))
  const [, folder, anchor, request] = calls(api, "redoGraphic")[0]!
  expect([folder, anchor]).toEqual([FOLDER, MOTION.anchor])
  expect(request).toEqual({
    rules: settingsView().cut,
    view: { position: "auto", subtitlesOn: false, highlightsOn: true, flair: { ...GRAPHICS_ON, ...ONLY_GRAPHICS } },
    subtitles: null,
  })
  playRedo(api)
  await act(async () => answer(REDONE))
  // what ทำทั้งหมด sends, to the letter
  await planAll()
  await waitFor(() => expect(calls(api, "planPost")).toHaveLength(1))
  expect(calls(api, "planPost")[0]![2]).toEqual(request)
})

test("ทำใหม่ waits while a run goes, the one it started included, and the row's other buttons do not", async () => {
  let finish!: (view: PostRunView) => void
  const { api } = renderScreen({
    ...withGraphics({ graphics: [MOTION, OTHER] }, ONLY_GRAPHICS),
    redoGraphic: () => new Promise<PostRunView>((resolve) => (finish = resolve)),
  })
  await ready()
  await openFlair()
  const redo = () => screen.getByRole("button", { name: redoLabel() })
  const otherRedo = () => screen.getByRole("button", { name: redoLabel(OTHER_IDEA) })
  await waitFor(() => expect(redo()).toHaveProperty("disabled", false))
  await userEvent.click(redo())
  // one run goes at a time on a project: no other graphic can be asked for meanwhile
  expect(redo()).toHaveProperty("disabled", true)
  expect(otherRedo()).toHaveProperty("disabled", true)
  // switching one off or removing it is the user's own change, which a run does not hold
  expect(graphicButton("graphics.offLabel")).toHaveProperty("disabled", false)
  expect(graphicButton("graphics.removeLabel")).toHaveProperty("disabled", false)
  playRedo(api)
  await act(async () => finish(REDONE))
  await waitFor(() => expect(otherRedo()).toHaveProperty("disabled", false))
  expect(redo()).toHaveProperty("disabled", false)
  // and so while the whole plan, or one work thought again, runs
  act(() => api.emit(planEvent("sounds", { state: "running" })))
  expect(redo()).toHaveProperty("disabled", true)
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(redo()).toHaveProperty("disabled", false))
})

test("a row's buttons are ทำใหม่, แก้ for a written graphic, a retry when its render failed, ย้อน when it has a step to go back to, off or on, and remove, in that order: none opens a graphic's code to the user", async () => {
  const why = "nothing was drawn: every frame is empty"
  const writeFailed: Partial<GraphicView> = { spec: { ...MOTION_SPEC, html: null, failed: why }, written: false, writeFailed: why, render: "waiting" }
  const graphics = [
    motionAt(2_500_000, { render: "ready" }),
    motionAt(3_000_000, { spec: { ...MOTION_SPEC, html: null }, written: false, render: "waiting" }),
    motionAt(3_500_000, { stale: true, render: "waiting" }),
    motionAt(4_000_000, { render: "failed", error: "Chrome crashed" }),
    motionAt(4_500_000, writeFailed),
    motionAt(5_000_000, { off: true }),
    motionAt(5_500_000, { render: "failed", error: "Chrome crashed", instruction: "ใหญ่ขึ้น", canUndo: true }),
    // a redo that failed keeps the fragment it replaced, to go back to
    motionAt(6_000_000, { ...writeFailed, canUndo: true }),
  ]
  renderScreen(withGraphics({ graphics }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const buttons = (row: HTMLElement) => within(row).getAllByRole("button").map((button) => button.textContent)
  const [written, unwrittenOne, stale, renderFailed, failedWriting, off, edited, redoFailed] = graphicRows()
  const OFF = t("graphics.off")
  const REMOVE = t("graphics.remove")
  const RETRY = t("graphics.retry")
  expect(buttons(written!)).toEqual([REDO, EDIT, OFF, REMOVE])
  // with no code there is nothing to change: it is written from its idea first
  expect(buttons(unwrittenOne!)).toEqual([REDO, OFF, REMOVE])
  // written for a cut that changed since, it can still be changed, and is fitted to the cut as it is now
  expect(buttons(stale!)).toEqual([REDO, EDIT, OFF, REMOVE])
  expect(buttons(renderFailed!)).toEqual([REDO, EDIT, RETRY, OFF, REMOVE])
  expect(buttons(failedWriting!)).toEqual([REDO, OFF, REMOVE])
  expect(buttons(off!)).toEqual([REDO, EDIT, t("graphics.on"), REMOVE])
  expect(buttons(edited!)).toEqual([REDO, EDIT, RETRY, UNDO, OFF, REMOVE])
  expect(buttons(redoFailed!)).toEqual([REDO, UNDO, OFF, REMOVE])
  // read out, แก้ and ย้อน are named by what they show and then by their graphic, as the row's other buttons are
  expect(within(edited!).getByRole("button", { name: editLabel() }).textContent).toBe(EDIT)
  expect(within(edited!).getByRole("button", { name: undoLabel() }).textContent).toBe(UNDO)
})

test("แก้ opens a field under its row to say what to change, one on the page at a time; pressing แก้ again, ยกเลิก or Escape closes it and keeps nothing", async () => {
  const { api } = renderScreen(withGraphics({ graphics: [MOTION, OTHER] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const [first, second] = graphicRows()
  const edit = within(first!).getByRole("button", { name: editLabel() })
  const otherEdit = within(second!).getByRole("button", { name: editLabel(OTHER_IDEA) })
  await waitFor(() => expect(edit).toHaveProperty("disabled", false))
  noEditField()
  expect(edit.getAttribute("aria-expanded")).toBe("false")
  await userEvent.click(edit)
  // under the row it belongs to, named, with an example of what may be asked, and ready to be typed in
  const field = within(first!).getByRole("textbox", { name: EDIT_FIELD })
  expect(field.getAttribute("placeholder")).toBe("เช่น ตัวเลขใหญ่ขึ้น หรือ จรวดพุ่งจากขวาแทน")
  expect(document.activeElement).toBe(field)
  expect(edit.getAttribute("aria-expanded")).toBe("true")
  expect(within(first!).getAllByRole("button").map((button) => button.textContent).slice(-2)).toEqual([SEND, CANCEL])
  await userEvent.type(field, "ช้าลง")
  // another row's opens in its place, empty
  await userEvent.click(otherEdit)
  expect(within(first!).queryByRole("textbox")).toBeNull()
  expect(screen.getAllByRole("textbox", { name: EDIT_FIELD })).toHaveLength(1)
  expect(within(second!).getByRole("textbox", { name: EDIT_FIELD })).toHaveProperty("value", "")
  expect([edit.getAttribute("aria-expanded"), otherEdit.getAttribute("aria-expanded")]).toEqual(["false", "true"])
  // pressing its แก้ again closes it
  await userEvent.click(otherEdit)
  noEditField()
  // ยกเลิก closes it, what was typed goes with it, and the keyboard is back on แก้
  await userEvent.click(edit)
  await userEvent.type(editField(), "ใหญ่ขึ้น")
  await userEvent.click(within(first!).getByRole("button", { name: CANCEL }))
  noEditField()
  expect(document.activeElement).toBe(edit)
  await userEvent.click(edit)
  expect(editField()).toHaveProperty("value", "")
  // and so does Escape in the field
  await userEvent.type(editField(), "ใหญ่ขึ้น{Escape}")
  noEditField()
  expect(document.activeElement).toBe(edit)
  await userEvent.click(edit)
  expect(editField()).toHaveProperty("value", "")
  expect(calls(api, "editGraphic")).toEqual([])
})

test("Escape pressed while a word is being composed belongs to the input method, and leaves the field open", async () => {
  renderScreen(withGraphics({ graphics: [MOTION] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  await waitFor(() => expect(graphicButton("graphics.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.editLabel"))
  await userEvent.type(editField(), "ใหญ่")
  fireEvent.keyDown(editField(), { key: "Escape", isComposing: true })
  expect(editField()).toHaveProperty("value", "ใหญ่")
  fireEvent.keyDown(editField(), { key: "Escape" })
  noEditField()
})

/** Opens the edit field of the one graphic listed, once its แก้ can be pressed, and types in it. */
async function openFieldOnFirst() {
  await waitFor(() => expect(graphicButton("graphics.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.editLabel"))
  await userEvent.type(editField(), "ใหญ่ขึ้น")
}

test("an open field belongs to the beat it was opened in: another beat, or the whole clip, starts with none, and coming back opens none", async () => {
  renderScreen(withGraphics({ graphics: [MOTION] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  await openFieldOnFirst()
  await userEvent.click(beatPick("ปิดท้าย"))
  noEditField()
  await userEvent.click(beatPick("เปิดเรื่อง"))
  noEditField()
  expect(document.activeElement).toBe(beatPick("เปิดเรื่อง"))
  // the whole clip lists the same graphic, and still starts with none open
  await openFieldOnFirst()
  await userEvent.click(wholeClipPick())
  noEditField()
  expect(document.activeElement).toBe(wholeClipPick())
})

test("an open field goes with its graphic's fragment: a redo that fails lets it go, and the step back that brings the fragment back opens none", async () => {
  const why = "nothing was drawn: every frame is empty"
  let graphics: GraphicView[] = [{ ...MOTION, render: "ready" }]
  const previews = listedPreviews(() => graphics)
  let finish!: (view: PostRunView) => void
  const { api } = renderScreen({
    ...withGraphics({}, ONLY_GRAPHICS),
    previewHighlights: previews.previewHighlights,
    redoGraphic: () => new Promise<PostRunView>((resolve) => (finish = resolve)),
    undoGraphic: async () => {
      // back to the fragment the redo replaced, with nothing left to go back to
      graphics = [{ ...MOTION, render: "ready" }]
    },
  })
  await ready()
  await openFlair()
  await openFieldOnFirst()
  await userEvent.click(graphicButton("graphics.redoLabel"))
  // the writing fails: the graphic has no fragment now, and keeps the one it had to go back to
  graphics = [unwritten({ spec: { ...MOTION_SPEC, html: null, failed: why }, writeFailed: why, canUndo: true })]
  playRedo(api)
  await act(async () => finish(REDONE))
  await waitFor(() => expect(stateOf(graphicRows()[0]!)).toEqual([`${WRITE_FAILED} · ${why}`]))
  noEditField()
  await waitFor(() => expect(graphicButton("graphics.undoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.undoLabel"))
  await waitFor(() => expect(stateOf(graphicRows()[0]!)).toEqual([t("graphics.render.ready")]))
  noEditField()
  expect(document.activeElement?.tagName).not.toBe("TEXTAREA")
})

test("an open field goes with its graphic removed, and opens none on a graphic written later at the same place, in the middle of a run", async () => {
  let graphics: GraphicView[] = [MOTION]
  const previews = listedPreviews(() => graphics)
  const { api } = renderScreen({
    ...withGraphics({}, ONLY_GRAPHICS),
    previewHighlights: previews.previewHighlights,
    setGraphic: async () => {
      graphics = []
    },
  })
  await ready()
  await openFlair()
  await openFieldOnFirst()
  await userEvent.click(graphicButton("graphics.removeLabel"))
  await waitFor(() => expect(screen.getByText(t("graphics.none"))).toBeTruthy())
  noEditField()
  // the graphics thought again: a new one is written at the same place, and read as its writing is stored
  graphics = [{ ...MOTION, render: "ready" }]
  act(() => api.emit(planEvent("graphics", { state: "running", done: 1, total: 1 })))
  await waitFor(() => expect(graphicRows()).toHaveLength(1))
  noEditField()
  expect(document.activeElement?.tagName).not.toBe("TEXTAREA")
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
})

test("ส่งให้ AI แก้ waits for a change to send: not nothing, not spaces alone, and at most 300 letters counted as they are seen, a Thai letter with its marks as one; past that the field says so", async () => {
  renderScreen(withGraphics({ graphics: [MOTION] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const [row] = graphicRows()
  await waitFor(() => expect(graphicButton("graphics.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.editLabel"))
  const send = () => within(row!).getByRole("button", { name: SEND })
  expect(send()).toHaveProperty("disabled", true)
  await userEvent.type(editField(), "   ")
  expect(send()).toHaveProperty("disabled", true)
  // a letter of three characters each, ท with its vowel and its tone mark, and the spaces around them are not counted
  const letters = (count: number) => "ที่".repeat(count)
  fireEvent.change(editField(), { target: { value: `  ${letters(300)}  ` } })
  expect(send()).toHaveProperty("disabled", false)
  expect(within(row!).queryByText(TOO_LONG)).toBeNull()
  expect(editField().getAttribute("aria-describedby")).toBeNull()
  expect(editField().getAttribute("aria-invalid")).toBeNull()
  fireEvent.change(editField(), { target: { value: letters(301) } })
  expect(send()).toHaveProperty("disabled", true)
  const said = within(row!).getByText(TOO_LONG)
  // the number said is the limit core keeps, not one of the text's own
  expect(t("graphics.editTooLong", { max: 1 })).toBe("ยาวเกิน 1 ตัวอักษร")
  expect(said.classList.contains("warn-text")).toBe(true)
  expect(editField().getAttribute("aria-describedby")).toBe(said.id)
  expect(editField().getAttribute("aria-invalid")).toBe("true")
  // what was typed stays, to be cut down
  expect(editField()).toHaveProperty("value", letters(301))
  fireEvent.change(editField(), { target: { value: letters(299) } })
  expect(send()).toHaveProperty("disabled", false)
  expect(within(row!).queryByText(TOO_LONG)).toBeNull()
})

test("ส่งให้ AI แก้ has Claude change the graphic as typed, trimmed, asked through the room with the request a plan is asked with; the field closes and keeps nothing", async () => {
  let answer!: (view: PostRunView) => void
  const { api } = renderScreen({ ...withGraphics({ graphics: [MOTION] }, ONLY_GRAPHICS), editGraphic: () => new Promise<PostRunView>((resolve) => (answer = resolve)) })
  await ready()
  await openFlair()
  const edit = graphicButton("graphics.editLabel")
  await waitFor(() => expect(edit).toHaveProperty("disabled", false))
  await userEvent.click(edit)
  await userEvent.type(editField(), "  ตัวเลขใหญ่ขึ้น\nแล้วช้าลง  ")
  await userEvent.click(screen.getByRole("button", { name: SEND }))
  noEditField()
  await waitFor(() => expect(calls(api, "editGraphic")).toHaveLength(1))
  const [, folder, anchor, instruction, request] = calls(api, "editGraphic")[0]!
  expect([folder, anchor, instruction]).toEqual([FOLDER, MOTION.anchor, "ตัวเลขใหญ่ขึ้น\nแล้วช้าลง"])
  expect(calls(api, "redoGraphic")).toEqual([])
  // main plays an edit as it plays a redo
  playRedo(api)
  await act(async () => answer(REDONE))
  await waitFor(() => expect(edit).toHaveProperty("disabled", false))
  await userEvent.click(edit)
  expect(editField()).toHaveProperty("value", "")
  // what ทำทั้งหมด sends, to the letter
  await planAll()
  await waitFor(() => expect(calls(api, "planPost")).toHaveLength(1))
  expect(calls(api, "planPost")[0]![2]).toEqual(request)
})

test("while a graphic is changed only its own row reads กำลังแก้…, from the press until the read that follows the run's end has landed, and แก้ and ทำใหม่ wait on every row: then it reads its true line", async () => {
  let graphics: GraphicView[] = [{ ...MOTION, render: "ready" }, { ...OTHER, render: "ready" }]
  const previews = listedPreviews(() => graphics)
  let finish!: (view: PostRunView) => void
  const { api } = renderScreen({
    ...withGraphics({}, ONLY_GRAPHICS),
    previewHighlights: previews.previewHighlights,
    editGraphic: () => new Promise<PostRunView>((resolve) => (finish = resolve)),
  })
  await ready()
  await openFlair()
  await waitFor(() => expect(placing()).toBe(false))
  const READY = t("graphics.render.ready")
  const states = () => graphicRows().map(stateOf)
  const waiting = () => graphicRows().flatMap((row) => [within(row).getByRole("button", { name: /^แก้ / }), within(row).getByRole("button", { name: /^ทำใหม่ / })].map((button) => (button as HTMLButtonElement).disabled))
  expect(states()).toEqual([[READY], [READY]])
  await waitFor(() => expect(waiting()).toEqual([false, false, false, false]))

  await userEvent.click(graphicButton("graphics.editLabel"))
  await userEvent.type(editField(), "ใหญ่ขึ้น")
  await userEvent.click(screen.getByRole("button", { name: SEND }))
  expect(states()).toEqual([[EDITING], [READY]])
  expect(waiting()).toEqual([true, true, true, true])
  // as the main process plays it, and through the read its own count brings: the strip counts it as a redo's
  act(() => api.emit(planEvent("graphics", { state: "waiting" })))
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  act(() => api.emit(planEvent("graphics", { state: "running", done: 0, total: 1 })))
  await act(async () => {})
  expect(states()).toEqual([[EDITING], [READY]])
  expect(screen.getByText("กำลังเขียนกราฟิก 0 จาก 1")).toBeTruthy()

  previews.hold()
  graphics = [{ ...MOTION, render: "rendering", instruction: "ใหญ่ขึ้น", canUndo: true }, { ...OTHER, render: "ready" }]
  act(() => api.emit(planEvent("graphics", { state: "running", done: 1, total: 1 })))
  act(() => api.emit(planEvent("graphics", { state: "done", count: 1, dropped: 0 })))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => finish(REDONE))
  expect(previews.held.length).toBeGreaterThan(0)
  // the run is over, and the rows still show what was read before its end
  expect(states()).toEqual([[EDITING], [READY]])
  await previews.land()
  await waitFor(() => expect(states()).toEqual([[t("graphics.render.rendering")], [READY]]))
  await waitFor(() => expect(waiting()).toEqual([false, false, false, false]))
})

test("a graphic changed as the user asked says the change under its idea, held to two lines, the whole of it for a pointer held over it", async () => {
  const instruction = "ตัวเลขใหญ่ขึ้นอีกเท่าหนึ่ง แล้วให้เส้นใต้ลากช้าลงจนจบประโยค"
  renderScreen(withGraphics({ graphics: [{ ...MOTION, instruction, canUndo: true }, OTHER] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const [changed, other] = graphicRows()
  const said = `แก้ล่าสุด: ${instruction}`
  const line = within(changed!).getByText(said)
  expect(line.getAttribute("title")).toBe(said)
  expect(line.classList.contains("graphic-last-edit")).toBe(true)
  // right under the idea
  expect(within(changed!).getByText(IDEA).nextElementSibling).toBe(line)
  expect(within(other!).queryByText(/แก้ล่าสุด/)).toBeNull()
})

test("the change that made a fragment is not said while that graphic is written again, from its idea or with another change: it is about the fragment being replaced", async () => {
  for (const how of ["redo", "edit"] as const) {
    const others = "ป้ายหมุนช้าลง"
    renderScreen({
      ...withGraphics({ graphics: [{ ...MOTION, instruction: "ใหญ่ขึ้น", canUndo: true }, { ...OTHER, instruction: others, canUndo: true }] }, ONLY_GRAPHICS),
      redoGraphic: () => new Promise<PostRunView>(() => {}),
      editGraphic: () => new Promise<PostRunView>(() => {}),
    })
    await ready()
    await openFlair()
    const [rewritten, other] = graphicRows()
    expect(within(rewritten!).getByText("แก้ล่าสุด: ใหญ่ขึ้น")).toBeTruthy()
    await waitFor(() => expect(graphicButton("graphics.redoLabel")).toHaveProperty("disabled", false))
    if (how === "redo") await userEvent.click(graphicButton("graphics.redoLabel"))
    else {
      await userEvent.click(graphicButton("graphics.editLabel"))
      await userEvent.type(editField(), "เล็กลง")
      await userEvent.click(screen.getByRole("button", { name: SEND }))
    }
    expect(stateOf(rewritten!), how).toEqual([how === "redo" ? WRITING : EDITING])
    expect(within(rewritten!).queryByText(/แก้ล่าสุด/), how).toBeNull()
    // the graphic beside it is not being written
    expect(within(other!).getByText(`แก้ล่าสุด: ${others}`), how).toBeTruthy()
    cleanup()
  }
})

test("an edit that failed says so on a line of its own under how the graphic stands, as a warning, in its last lines with the whole in its title; how it stands is said as before, and nothing of it while it is written again", async () => {
  const why = [
    "uses `setTimeout`: the renderer sets time itself, animate with CSS animations or el.animate()",
    "",
    "nothing was drawn: every frame is empty",
    "it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D",
    "the page never became ready (its script did not finish)",
  ].join("\n")
  renderScreen({
    ...withGraphics({ graphics: [{ ...MOTION, render: "ready", editFailed: why }, { ...OTHER, render: "ready", editFailed: "" }] }, ONLY_GRAPHICS),
    editGraphic: () => new Promise<PostRunView>(() => {}),
  })
  await ready()
  await openFlair()
  const [failed, wordless] = graphicRows()
  // the fragment from before the edit still stands, and its row says so as it would without the failure
  expect(stateOf(failed!)).toEqual([t("graphics.render.ready")])
  const said = `${EDIT_FAILED} · nothing was drawn: every frame is empty it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D the page never became ready (its script did not finish)`
  const line = within(failed!).getByText(said)
  expect(line.getAttribute("title")).toBe(why)
  expect(line.classList.contains("warn-text")).toBe(true)
  expect(failed!.querySelector(".graphic-state")!.nextElementSibling).toBe(line)
  // a failure that came with no words is a failure all the same
  expect(stateOf(wordless!)).toEqual([t("graphics.render.ready")])
  expect(within(wordless!).getByText(EDIT_FAILED)).toBeTruthy()
  // changed again, the row speaks of the writing alone until it is over
  await waitFor(() => expect(graphicButton("graphics.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.editLabel"))
  await userEvent.type(editField(), "ใหญ่ขึ้น")
  await userEvent.click(screen.getByRole("button", { name: SEND }))
  expect(stateOf(failed!)).toEqual([EDITING])
  expect(within(failed!).queryByText(new RegExp(EDIT_FAILED))).toBeNull()
  expect(within(wordless!).getByText(EDIT_FAILED)).toBeTruthy()
})

test("ย้อน takes a graphic one step back, asked by its place, and the rows are read again, quietly", async () => {
  let back = false
  const { api } = renderScreen({
    ...withGraphics({}, ONLY_GRAPHICS),
    previewHighlights: async () => flairPreview({ graphics: [back ? { ...MOTION, canUndo: true } : { ...MOTION, instruction: "ใหญ่ขึ้น", canUndo: true }] }),
    undoGraphic: async () => {
      back = true
    },
  })
  await ready()
  await openFlair()
  await screen.findByText("แก้ล่าสุด: ใหญ่ขึ้น")
  await waitFor(() => expect(placing()).toBe(false))
  const reads = calls(api, "previewHighlights").length
  const undo = graphicButton("graphics.undoLabel")
  await waitFor(() => expect(undo).toHaveProperty("disabled", false))
  await userEvent.click(undo)
  expect(calls(api, "undoGraphic")).toEqual([["undoGraphic", FOLDER, MOTION.anchor]])
  await waitFor(() => expect(screen.queryByText(/แก้ล่าสุด/)).toBeNull())
  expect(calls(api, "previewHighlights")).toHaveLength(reads + 1)
  // no Claude, and no run
  expect([calls(api, "editGraphic"), calls(api, "redoGraphic")]).toEqual([[], []])
  expect(screen.queryByRole("progressbar")).toBeNull()
})

test("ย้อน waits while its step back is being saved: a second click meanwhile asks nothing more, since a second step back would come back", async () => {
  let answer!: () => void
  const { api } = renderScreen({ ...withGraphics({ graphics: [{ ...MOTION, canUndo: true }] }, ONLY_GRAPHICS), undoGraphic: () => new Promise<void>((resolve) => (answer = resolve)) })
  await ready()
  await openFlair()
  const undo = graphicButton("graphics.undoLabel")
  await waitFor(() => expect(undo).toHaveProperty("disabled", false))
  await userEvent.dblClick(undo)
  expect(calls(api, "undoGraphic")).toHaveLength(1)
  expect(undo).toHaveProperty("disabled", true)
  await act(async () => answer())
  await waitFor(() => expect(undo).toHaveProperty("disabled", false))
  expect(calls(api, "undoGraphic")).toHaveLength(1)
})

test("ย้อน stays held while its step back is out, though another change of the user's begins and ends meanwhile", async () => {
  let answer!: () => void
  const { api } = renderScreen({ ...withGraphics({ graphics: [{ ...MOTION, canUndo: true }] }, ONLY_GRAPHICS), undoGraphic: () => new Promise<void>((resolve) => (answer = resolve)) })
  await ready()
  await openFlair()
  await waitFor(() => expect(graphicButton("graphics.undoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.undoLabel"))
  expect(graphicButton("graphics.undoLabel")).toHaveProperty("disabled", true)
  // the style waits only for a write: it is chosen, saved and placed while the step back is still out
  const settings = await openSettings("techniques")
  await userEvent.selectOptions(within(settings).getByRole("combobox", { name: t("highlights.style") }), "cute-pink")
  await waitFor(() => expect(calls(api, "setHighlightStyle")).toHaveLength(1))
  await waitFor(() => expect(placing()).toBe(false))
  await openFlair()
  const undo = graphicButton("graphics.undoLabel")
  expect(undo).toHaveProperty("disabled", true)
  await act(async () => answer())
  await waitFor(() => expect(undo).toHaveProperty("disabled", false))
  expect(calls(api, "undoGraphic")).toHaveLength(1)
})

test("what main refuses of a change or a step back is said in Thai: a graphic not written yet as the graphics work's failure, one with nothing to go back to above the page", async () => {
  // main throws it inside the graphics work, as it does a graphic with no place
  const notWritten: PostWorkState = { state: "failed", error: "this graphic has not been written yet" }
  let answer!: (view: PostRunView) => void
  const previews = listedPreviews(() => [{ ...MOTION, canUndo: true }])
  const { api } = renderScreen({
    ...withGraphics({}, ONLY_GRAPHICS),
    previewHighlights: previews.previewHighlights,
    editGraphic: () => new Promise<PostRunView>((resolve) => (answer = resolve)),
    undoGraphic: async () => {
      throw new Error("Error invoking remote method 'api:undoGraphic': Error: this graphic has nothing to go back to")
    },
  })
  await ready()
  await openFlair()
  await waitFor(() => expect(graphicButton("graphics.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.editLabel"))
  await userEvent.type(editField(), "ใหญ่ขึ้น")
  await userEvent.click(screen.getByRole("button", { name: SEND }))
  act(() => api.emit(planEvent("graphics", { state: "waiting" })))
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  act(() => api.emit(planEvent("graphics", notWritten)))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => answer({ running: false, states: { graphics: notWritten } }))
  expect(await screen.findByText(`${t("post.work.graphics")} ไม่สำเร็จ: กราฟิกนี้ยังไม่ได้เขียน กดทำใหม่ก่อน`)).toBeTruthy()
  expect(screen.queryByText(/not been written/)).toBeNull()
  await waitFor(() => expect(stateOf(graphicRows()[0]!)).toEqual([t("graphics.render.rendering")]))

  await waitFor(() => expect(graphicButton("graphics.undoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.undoLabel"))
  expect(await screen.findByText(t("error.generic", { message: "ไม่มีชิ้นก่อนหน้าให้ย้อน" }))).toBeTruthy()
  expect(screen.queryByText(/nothing to go back to/)).toBeNull()
})

test("แก้ and ย้อน wait while a run goes, as ทำใหม่ does, and so does sending a change typed meanwhile; the change stays in its field", async () => {
  const { api } = renderScreen(withGraphics({ graphics: [{ ...MOTION, canUndo: true }] }, ONLY_GRAPHICS))
  await ready()
  await openFlair()
  const edit = graphicButton("graphics.editLabel")
  const undo = graphicButton("graphics.undoLabel")
  await waitFor(() => expect(edit).toHaveProperty("disabled", false))
  expect(undo).toHaveProperty("disabled", false)
  await userEvent.click(edit)
  await userEvent.type(editField(), "ใหญ่ขึ้น")
  const send = () => screen.getByRole("button", { name: SEND })
  expect(send()).toHaveProperty("disabled", false)
  // the whole plan, or one work thought again
  act(() => api.emit(planEvent("sounds", { state: "running" })))
  expect([edit, undo, graphicButton("graphics.redoLabel"), send()].map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true, true, true])
  expect(editField()).toHaveProperty("value", "ใหญ่ขึ้น")
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(edit).toHaveProperty("disabled", false))
  expect([undo, send()].map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false])
})

test("as the graphics work counts on, the rows are read again, quietly: the plan's graphics show as being written once it is stored, and each leaves that for how it stands as its writing is stored", async () => {
  // what the main process lists at each moment: it tells that a plan or a writing was stored by the work's count alone
  let graphics: GraphicView[] = []
  const { api } = renderScreen({ ...withGraphics({}, ONLY_GRAPHICS), previewHighlights: async () => flairPreview({ graphics }) })
  await ready()
  await openFlair()
  expect(screen.getByText(t("graphics.none"))).toBeTruthy()
  await waitFor(() => expect(placing()).toBe(false))
  const reads = () => calls(api, "previewHighlights").length
  const before = reads()
  const states = () => graphicRows().map(stateOf)
  // the work begins by planning, which stores nothing yet: a running state with no count reads nothing
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  expect(reads()).toBe(before)
  // the plan is stored and the writing begins: the first count comes, with none written
  const second = unwritten({ anchor: OTHER.anchor, atUs: OTHER.atUs, summary: OTHER_IDEA, spec: { ...MOTION_SPEC, idea: OTHER_IDEA, html: null } })
  graphics = [unwritten(), second]
  act(() => api.emit(planEvent("graphics", { state: "running", done: 0, total: 2 })))
  expect(reads()).toBe(before + 1)
  // nothing of the user's is held up by it
  expect(placing()).toBe(false)
  await waitFor(() => expect(states()).toEqual([[WRITING], [WRITING]]))
  // one writing is stored, and its render was made as it was checked
  graphics = [{ ...MOTION, render: "ready" }, second]
  act(() => api.emit(planEvent("graphics", { state: "running", done: 1, total: 2 })))
  expect(reads()).toBe(before + 2)
  await waitFor(() => expect(states()).toEqual([[t("graphics.render.ready")], [WRITING]]))
  // the other's writing failed, which is stored too
  const why = "nothing was drawn: every frame is empty"
  graphics = [{ ...MOTION, render: "ready" }, { ...second, spec: { ...MOTION_SPEC, idea: OTHER_IDEA, html: null, failed: why }, writeFailed: why }]
  act(() => api.emit(planEvent("graphics", { state: "running", done: 2, total: 2 })))
  expect(reads()).toBe(before + 3)
  await waitFor(() => expect(states()).toEqual([[t("graphics.render.ready")], [`${WRITE_FAILED} · ${why}`]]))
  expect(placing()).toBe(false)
  // only the graphics and the sounds works store as they count (the sounds' are read in the sound tab's tests), and only this project's is this room's to read
  act(() => {
    api.emit(planEvent("techniques", { state: "running", done: 1, total: 2 }))
    api.emit({ type: "post-plan", folder: "/drafts/0815", work: "graphics", state: { state: "running", done: 1, total: 2 } })
  })
  expect(reads()).toBe(before + 3)
})

test("a graphic that plays is counted on its beat in the graphics tab", async () => {
  const off: GraphicView = { ...MOTION, anchor: { kind: "speech", videoId: "a", sourceUs: 4_000_000, beatId: "b1" }, off: true }
  renderScreen(withGraphics({ graphics: [MOTION, off] }, ONLY_GRAPHICS))
  await ready()
  await openTab("graphics")
  await waitFor(() => expect(within(beatPick("เปิดเรื่อง")).getByText("📊 1")).toBeTruthy())
  expect(within(beatPick("ปิดท้าย")).queryByText(/📊/)).toBeNull()
  // the graphics tab marks the graphics alone, and the techniques tab marks none
  expect(within(beatPick("เปิดเรื่อง")).queryByText(/Aa/)).toBeNull()
  await openTab("techniques")
  expect(screen.queryByText(/📊/)).toBeNull()
})

test("a graphic marks nothing when it does not play: switched off, or with graphics off", async () => {
  const cases: [GraphicView, Partial<FlairOptions>][] = [
    [{ ...MOTION, off: true }, ONLY_GRAPHICS],
    [MOTION, { ...ONLY_GRAPHICS, graphic: false }],
  ]
  for (const [graphic, flair] of cases) {
    renderScreen(withGraphics({ graphics: [graphic] }, flair))
    await ready()
    await openTab("techniques")
    // the preview is on screen once the beat counts its highlight text
    await waitFor(() => expect(within(beatPick("เปิดเรื่อง")).getByText("Aa 1")).toBeTruthy())
    await openTab("graphics")
    expect(screen.queryByText(/📊/)).toBeNull()
    cleanup()
  }
})

/** Previews come at once until `holding` is set; from then on each waits until the test lets it land or fail. */
function heldPreviews(preview: () => HighlightPreview) {
  const held: { resolve: (preview: HighlightPreview) => void; reject: (error: Error) => void }[] = []
  const control = {
    holding: false,
    held,
    previewHighlights: () =>
      control.holding ? new Promise<HighlightPreview>((resolve, reject) => held.push({ resolve, reject })) : Promise.resolve(preview()),
  }
  return control
}

/** The room with a graphic on screen and nothing being placed, before the previews are held. */
async function settledWithGraphic(overrides: Partial<RendererApi> = {}) {
  const previews = heldPreviews(() => flairPreview({ graphics: [MOTION] }))
  const { api } = renderScreen({ ...withGraphics(), previewHighlights: previews.previewHighlights, ...overrides })
  await ready()
  await openFlair()
  await screen.findByText(MOTION.summary)
  await waitFor(() => expect(placing()).toBe(false))
  previews.holding = true
  return { api, previews }
}
const made: AppEvent = { type: "graphics", folder: FOLDER, state: "done" }

test("a graphic made in the background is read without holding the room up", async () => {
  const { api, previews } = await settledWithGraphic()
  act(() => api.emit(made))
  expect(previews.held).toHaveLength(1)
  expect(placing()).toBe(false)
  expect(graphicButton("graphics.offLabel")).toHaveProperty("disabled", false)
  await act(async () => previews.held[0]!.resolve(flairPreview({ graphics: [{ ...MOTION, render: "ready" }] })))
  expect(screen.getByText(t("graphics.render.ready"))).toBeTruthy()
  expect(placing()).toBe(false)
})

test("the user's own change made while a graphic is being read still holds the room until it is placed", async () => {
  const { api, previews } = await settledWithGraphic()
  act(() => api.emit(made))
  const settings = await openSettings("sound")
  await userEvent.click(await within(settings).findByRole("switch", { name: t("flair.sound") }))
  await waitFor(() => expect(previews.held).toHaveLength(2))
  expect(placing()).toBe(true)
  // the graphic's read lands first: it was overtaken, so it changes nothing
  await act(async () => previews.held[0]!.resolve(flairPreview({ graphics: [MOTION] })))
  expect(placing()).toBe(true)
  await act(async () => previews.held[1]!.resolve(flairPreview({ graphics: [MOTION] })))
  await waitFor(() => expect(placing()).toBe(false))
})

test("a read after a graphic is made that fails leaves the screen as it was", async () => {
  const { api, previews } = await settledWithGraphic()
  act(() => api.emit(made))
  await act(async () => previews.held[0]!.reject(new Error("preview broke")))
  expect(screen.queryByText(t("error.generic", { message: "preview broke" }))).toBeNull()
  expect(screen.getByText(MOTION.summary)).toBeTruthy()
  expect(placing()).toBe(false)
})

test("a change of the user's that lands in the same moment as a graphic being made still holds the room", async () => {
  let decided!: () => void
  const { api, previews } = await settledWithGraphic({ setCutDecision: () => new Promise<void>((resolve) => (decided = resolve)) })
  await openTab("cut")
  await userEvent.click(within(speechRows()[1]!).getByRole("button", { name: t("timeline.action.keep") }))
  await act(async () => {
    // the decision is saved, and a graphic is made before the room draws again: one placement follows both
    decided()
    await Promise.resolve()
    api.emit(made)
  })
  expect(previews.held).toHaveLength(1)
  expect(placing()).toBe(true)
})

test("a graphic made while the user's change is being placed does not hide that placement failing", async () => {
  const { api, previews } = await settledWithGraphic()
  const settings = await openSettings("sound")
  await userEvent.click(await within(settings).findByRole("switch", { name: t("flair.sound") }))
  await waitFor(() => expect(previews.held).toHaveLength(1))
  act(() => api.emit(made))
  expect(previews.held).toHaveLength(2)
  expect(placing()).toBe(true)
  await act(async () => previews.held[1]!.reject(new Error("preview broke")))
  expect(screen.getByText(t("error.generic", { message: "preview broke" }))).toBeTruthy()
})

/** Graphics events arrive; the preview is read once settled, and the timers are the test's from there. */
async function graphicsEvents() {
  const { api } = renderScreen(withGraphics({ graphics: [MOTION] }))
  await ready()
  await openFlair()
  await screen.findByText(MOTION.summary)
  const before = calls(api, "previewHighlights").length
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  return { api, previews: () => calls(api, "previewHighlights").length - before }
}
const progress = (hash: string, done: number): AppEvent => ({ type: "graphics", folder: FOLDER, state: "progress", hash, done, total: 3 })

test("a burst of graphics events reads the preview once at once and once after it, never more often", async () => {
  const { api, previews } = await graphicsEvents()
  act(() => api.emit(progress("h1", 1)))
  expect(previews()).toBe(1)
  act(() => {
    vi.advanceTimersByTime(20)
    api.emit(progress("h2", 2))
  })
  act(() => {
    vi.advanceTimersByTime(20)
    api.emit({ type: "graphics", folder: FOLDER, state: "failed", hash: "h3", error: "boom" })
  })
  expect(previews()).toBe(1)
  // the last of the burst is always read, or a row would stay on "rendering"
  act(() => vi.advanceTimersByTime(459))
  expect(previews()).toBe(1)
  act(() => vi.advanceTimersByTime(1))
  expect(previews()).toBe(2)
  act(() => vi.advanceTimersByTime(2_000))
  expect(previews()).toBe(2)
})

test("graphics events for another project read nothing", async () => {
  const { api, previews } = await graphicsEvents()
  act(() => {
    api.emit({ type: "graphics", folder: "/drafts/0815", state: "done" })
    api.emit({ type: "graphics", folder: "/drafts/0815", state: "progress", hash: "h1", done: 1, total: 1 })
  })
  act(() => vi.advanceTimersByTime(1_000))
  expect(previews()).toBe(0)
})

test("leaving the room drops the read that was still due", async () => {
  const { api, previews } = await graphicsEvents()
  const scheduled = vi.spyOn(globalThis, "setTimeout")
  const cleared = vi.spyOn(globalThis, "clearTimeout")
  act(() => {
    api.emit(progress("h1", 1))
    api.emit(progress("h2", 2))
  })
  expect(previews()).toBe(1)
  // the read due once the window is over; React drops a state change on a room that is gone, so
  // only the timer itself shows whether it was dropped
  const due = scheduled.mock.results[scheduled.mock.calls.findIndex(([, ms]) => ms === 500)]!.value
  cleanup()
  expect(cleared).toHaveBeenCalledWith(due)
  act(() => vi.advanceTimersByTime(1_000))
  expect(previews()).toBe(1)
})

test("the renderer pack finishing its install reads the graphics again, so the ones waiting for it start", async () => {
  let installed = false
  const { api } = renderScreen({
    ...withGraphics(),
    previewHighlights: async () => flairPreview({ graphics: [{ ...MOTION, render: installed ? "rendering" : "waiting" }], graphicsWaitForPack: !installed }),
  })
  await ready()
  await openFlair()
  await screen.findByText(t("graphics.waitForPack"))
  const before = calls(api, "previewHighlights").length
  act(() => api.emit({ type: "graphics-pack", state: "progress", received: 1, total: 2 }))
  expect(calls(api, "previewHighlights")).toHaveLength(before)
  installed = true
  act(() => api.emit({ type: "graphics-pack", state: "done" }))
  expect(calls(api, "previewHighlights")).toHaveLength(before + 1)
  await waitFor(() => expect(screen.queryByText(t("graphics.waitForPack"))).toBeNull())
  expect(screen.getByText(t("graphics.render.rendering"))).toBeTruthy()
})

test("new colours for the user's own style read the graphics again, once saved and once the user stops picking, since graphics are drawn in them", async () => {
  const saves: (() => void)[] = []
  const { api } = renderScreen({
    ...withGraphics({ graphics: [{ ...MOTION, render: "ready" }], style: "custom" }),
    updateSettings: () => new Promise<void>((resolve) => saves.push(resolve)),
  })
  await ready()
  await openFlair()
  await screen.findByText(MOTION.summary)
  const settings = await openSettings("techniques")
  const accent = await within(settings).findByLabelText(t("highlights.swatch.accent"))
  const reads = () => calls(api, "previewHighlights").length
  const before = reads()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })

  // saved at once, but the user may still be picking: each read would render every graphic again
  fireEvent.change(accent, { target: { value: "#ff0000" } })
  await act(async () => saves.at(-1)!())
  await act(async () => vi.advanceTimersByTime(20))
  fireEvent.change(accent, { target: { value: "#00ff00" } })
  await act(async () => saves.at(-1)!())
  await act(async () => vi.advanceTimersByTime(599))
  expect(reads()).toBe(before)
  await act(async () => vi.advanceTimersByTime(1))
  expect(reads()).toBe(before + 1)

  // the main process reads the colours from the saved settings: not before they are there
  fireEvent.change(accent, { target: { value: "#0000ff" } })
  await act(async () => vi.advanceTimersByTime(2_000))
  expect(reads()).toBe(before + 1)
  await act(async () => saves.at(-1)!())
  expect(reads()).toBe(before + 2)
})

/* the sound tab: the sounds Claude composed, and the user's own */

// a sound Claude composed on วันนี้ in the opening, written and rendered, as the main process lists it
const SOUND: ComposedSoundView = {
  anchor: { kind: "speech", videoId: "a", sourceUs: 2_500_000, beatId: "b1" },
  atUs: 750_000,
  durationUs: 1_260_000,
  beatId: "b1",
  role: "เสียงวูบขึ้นสั้นๆ ตอนพูดว่าวันนี้ ให้คนดูตื่นตัว",
  from: "medium",
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
}
/** The same sound at another place of the opening, which is what the main process finds a sound by, with another role so its row is told apart. */
const soundAt = (sourceUs: number, extra: Partial<ComposedSoundView> = {}): ComposedSoundView => ({
  ...SOUND,
  anchor: { kind: "speech", videoId: "a", sourceUs, beatId: "b1" },
  atUs: sourceUs - 1_750_000,
  role: `เสียงที่ ${sourceUs}`,
  ...extra,
})
const soundRows = () => screen.getAllByRole("listitem").filter((item) => item.classList.contains("sound"))
/** What a sound's row says of how it stands: one line, so one text. */
const soundStateOf = (row: HTMLElement) => [...row.querySelectorAll(".sound-state")].map((line) => line.textContent)
const soundButton = (
  key: "sounds.redoLabel" | "sounds.editLabel" | "sounds.undoLabel" | "sounds.offLabel" | "sounds.onLabel" | "sounds.removeLabel",
  role = SOUND.role,
) => screen.getByRole("button", { name: t(key, { role }) })
const ONLY_SOUNDS = { text: false, zoom: false, insert: false }
const withSounds = (extra: Partial<HighlightPreview> = {}) => ({
  ...withFlair(extra),
  getSettings: async () => settingsView({ flair: { ...FLAIR_ON, ...ONLY_SOUNDS } }),
})
/** Preview reads that list the sounds as they are at each moment, held from `hold` until `land`. */
function listedSounds(listed: () => ComposedSoundView[]) {
  const answer = () => flairPreview({ composed: structuredClone(listed()) })
  const previews = heldPreviews(answer)
  return {
    previewHighlights: previews.previewHighlights,
    held: previews.held,
    hold: () => void (previews.holding = true),
    land: () => act(async () => previews.held.splice(0).forEach(({ resolve }) => resolve(answer()))),
  }
}
// the words of the sound tab, as the user reads them
const SOUND_EDIT_FIELD = "จะให้ AI แก้เสียงนี้อย่างไร"
const soundEditField = () => screen.getByRole("textbox", { name: SOUND_EDIT_FIELD })

test("the sound tab lists the beat's composed sounds in time order, each with its role, what it follows, the level it plays from, how it stands and how long it plays", async () => {
  const tied = soundAt(4_000_000, { graphic: { summary: IDEA }, from: "heavy" })
  renderScreen(withSounds({ composed: [tied, { ...SOUND, pointId: "p1" }], emphasis: emphasisOf() }))
  await ready()
  await openTab("sound")
  expect(await screen.findByText(t("sounds.composed"))).toBeTruthy()
  const [first, second] = soundRows()
  expect(soundRows()).toHaveLength(2)
  // in the order they play
  expect(within(first!).getByText("0:00.7")).toBeTruthy()
  // the role is held to two lines, and the whole of it is there for a pointer held over it
  expect(within(first!).getByText(SOUND.role).getAttribute("title")).toBe(SOUND.role)
  expect(within(first!).getByText(t("emphasis.from", { text: "เอาล่ะครับ" }))).toBeTruthy()
  expect(within(first!).getByText("เล่นตั้งแต่ระดับกลาง")).toBeTruthy()
  expect(soundStateOf(first!)).toEqual(["พร้อม"])
  // how long it plays, to the tenth below
  expect(within(first!).getByText(t("edit.pieceLength", { seconds: "1.2" }))).toBeTruthy()
  // one that scores a graphic names the graphic rather than a point
  expect(within(second!).getByText(`ตามกราฟิก: ${IDEA}`)).toBeTruthy()
  expect(within(second!).getByText("เล่นเฉพาะจัดเต็ม")).toBeTruthy()
  // the old way of picking a CapCut sound for each place is gone
  expect(screen.queryByRole("combobox")).toBeNull()
})

test("a sound's row says one thing of how it stands, the first that holds: switched off, its composing failed, the picture changed, the cut changed, not composed, then its render", async () => {
  const why = "the sound is silent: its peak is under -60 dBFS\nit lasts 0.1 s"
  const renderWhy = "the sealed page closed\nthe render took too long"
  const cases: [Partial<ComposedSoundView>, string, string?][] = [
    [{ off: true, writeFailed: why, stale: "cut" }, "ปิดอยู่"],
    [{ written: false, writeFailed: why, stale: "picture", render: "pending" }, "แต่งไม่สำเร็จ · the sound is silent: its peak is under -60 dBFS it lasts 0.1 s", why],
    [{ stale: "picture", render: "pending" }, "ภาพเปลี่ยน กดทำใหม่"],
    [{ stale: "cut", render: "pending" }, "การตัดช่วงนี้เปลี่ยนไป กดแก้หรือทำใหม่"],
    [{ written: false, render: "pending" }, "ยังไม่ได้แต่ง"],
    [{ render: "failed", error: renderWhy }, "เรนเดอร์ไม่สำเร็จ · the sealed page closed the render took too long", renderWhy],
    [{ render: "pending" }, "กำลังเรนเดอร์…"],
    [{}, "พร้อม"],
  ]
  for (const [extra, said, title] of cases) {
    renderScreen(withSounds({ composed: [{ ...SOUND, ...extra }] }))
    await ready()
    await openTab("sound")
    await screen.findByText(SOUND.role)
    const [row] = soundRows()
    expect(soundStateOf(row!), said).toEqual([said])
    // a failure's whole reason is kept for a pointer held over its last lines
    expect(row!.querySelector(".sound-state")!.getAttribute("title")).toBe(title ?? null)
    cleanup()
  }
})

test("a sound's buttons are ทำใหม่, แก้ for a written one, ย้อน when it has a step to go back to, off or on, and remove, in that order, each named by its role", async () => {
  const button = (row: HTMLElement) => within(row).getAllByRole("button").map((one) => one.textContent)
  renderScreen(withSounds({ composed: [{ ...SOUND, canUndo: true }, soundAt(3_000_000, { written: false, render: "pending" }), soundAt(4_000_000, { off: true })] }))
  await ready()
  await openTab("sound")
  await screen.findByText(SOUND.role)
  const [written, unwritten, off] = soundRows()
  expect(button(written!)).toEqual(["ทำใหม่", "แก้", "ย้อน", "ปิด", "ลบ"])
  expect(button(unwritten!)).toEqual(["ทำใหม่", "ปิด", "ลบ"])
  expect(button(off!)).toEqual(["ทำใหม่", "แก้", "เปิด", "ลบ"])
  expect(soundButton("sounds.redoLabel").textContent).toBe("ทำใหม่")
  expect(screen.getByRole("button", { name: `ทำเสียงนี้ใหม่: ${SOUND.role}` })).toBeTruthy()
  expect(screen.getByRole("button", { name: `ย้อนเสียง: ${SOUND.role}` })).toBeTruthy()
  expect(screen.getByRole("button", { name: `เปิดเสียง: เสียงที่ 4000000` })).toBeTruthy()
})

test("ทำใหม่ has Claude compose a sound again, asked through the room by its place; off, on and remove change it as the user's own change", async () => {
  const { api } = renderScreen(withSounds({ composed: [SOUND, soundAt(4_000_000, { off: true })] }))
  await ready()
  await openTab("sound")
  await waitFor(() => expect(soundButton("sounds.redoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.redoLabel"))
  await waitFor(() => expect(calls(api, "redoSound")).toHaveLength(1))
  expect(calls(api, "redoSound")[0]!.slice(0, 3)).toEqual(["redoSound", FOLDER, SOUND.anchor])
  await waitFor(() => expect(soundButton("sounds.offLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.offLabel"))
  expect(api.calls).toContainEqual(["setSound", FOLDER, SOUND.anchor, { off: true }])
  await waitFor(() => expect(soundButton("sounds.onLabel", "เสียงที่ 4000000")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.onLabel", "เสียงที่ 4000000"))
  expect(api.calls).toContainEqual(["setSound", FOLDER, soundAt(4_000_000).anchor, { off: false }])
  await waitFor(() => expect(soundButton("sounds.removeLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.removeLabel"))
  expect(api.calls).toContainEqual(["setSound", FOLDER, SOUND.anchor, null])
  // none of these is the old CapCut pick
  expect(calls(api, "setSoundCue")).toEqual([])
})

test("แก้ opens the field with the sound's own words, one on the page at a time; sending has Claude change the sound as typed, trimmed, and the field closes", async () => {
  const { api } = renderScreen(withSounds({ composed: [SOUND, soundAt(4_000_000)] }))
  await ready()
  await openTab("sound")
  await waitFor(() => expect(soundButton("sounds.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.editLabel"))
  expect(soundEditField().getAttribute("placeholder")).toBe("เช่น เบาลง สั้นลง หรือให้ตึงกว่านี้")
  expect(soundButton("sounds.editLabel").getAttribute("aria-expanded")).toBe("true")
  // another row's แก้ moves the field there
  await userEvent.click(soundButton("sounds.editLabel", "เสียงที่ 4000000"))
  expect(screen.getAllByRole("textbox", { name: SOUND_EDIT_FIELD })).toHaveLength(1)
  expect(within(soundRows()[1]!).getByRole("textbox", { name: SOUND_EDIT_FIELD })).toBeTruthy()
  await userEvent.click(soundButton("sounds.editLabel"))
  await userEvent.type(soundEditField(), "  เบาลงอีกนิด  ")
  await userEvent.click(screen.getByRole("button", { name: SEND }))
  await waitFor(() => expect(calls(api, "editSound")).toHaveLength(1))
  expect(calls(api, "editSound")[0]!.slice(0, 4)).toEqual(["editSound", FOLDER, SOUND.anchor, "เบาลงอีกนิด"])
  expect(screen.queryByRole("textbox", { name: SOUND_EDIT_FIELD })).toBeNull()
  // ยกเลิก closes a field and keeps nothing
  await waitFor(() => expect(soundButton("sounds.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.editLabel"))
  await userEvent.click(screen.getByRole("button", { name: CANCEL }))
  expect(screen.queryByRole("textbox", { name: SOUND_EDIT_FIELD })).toBeNull()
})

test("an open field goes with its sound's code: a sound no longer composed, or no longer listed, lets it go, and one composed later opens none", async () => {
  let composed: ComposedSoundView[] = [SOUND]
  const { api } = renderScreen({ ...withSounds(), previewHighlights: async () => flairPreview({ composed }) })
  await ready()
  await openTab("sound")
  await waitFor(() => expect(soundButton("sounds.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.editLabel"))
  expect(soundEditField()).toBeTruthy()
  // a composing again that failed took its code
  composed = [{ ...SOUND, written: false, writeFailed: "nothing was heard", render: "pending" }]
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(screen.queryByRole("textbox", { name: SOUND_EDIT_FIELD })).toBeNull())
  composed = [SOUND]
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(screen.getByRole("button", { name: t("sounds.editLabel", { role: SOUND.role }) })).toBeTruthy())
  expect(screen.queryByRole("textbox", { name: SOUND_EDIT_FIELD })).toBeNull()
})

test("a sound changed as the user asked says the change under its role; an edit that failed says so as a warning; neither is said while it is written again", async () => {
  const instruction = "เบาลงครึ่งหนึ่ง แล้วให้หางเสียงยาวขึ้น"
  const failed = "the change could not be composed\nthe sound is silent"
  let composed: ComposedSoundView[] = [{ ...SOUND, instruction, editFailed: failed, canUndo: true }]
  const previews = listedSounds(() => composed)
  let finish!: (view: PostRunView) => void
  const { api } = renderScreen({ ...withSounds(), previewHighlights: previews.previewHighlights, redoSound: () => new Promise<PostRunView>((resolve) => (finish = resolve)) })
  await ready()
  await openTab("sound")
  const last = await screen.findByText(`แก้ล่าสุด: ${instruction}`)
  expect(last.getAttribute("title")).toBe(`แก้ล่าสุด: ${instruction}`)
  const editFailed = screen.getByText("แก้ไม่สำเร็จ · the change could not be composed the sound is silent")
  expect(editFailed.getAttribute("title")).toBe(failed)
  expect(editFailed.classList.contains("warn-text")).toBe(true)
  await waitFor(() => expect(placing()).toBe(false))
  await waitFor(() => expect(soundButton("sounds.redoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.redoLabel"))
  expect(soundStateOf(soundRows()[0]!)).toEqual(["กำลังแต่ง…"])
  expect(screen.queryByText(/แก้ล่าสุด/)).toBeNull()
  expect(screen.queryByText(/แก้ไม่สำเร็จ/)).toBeNull()
  previews.hold()
  composed = [SOUND]
  act(() => api.emit(planEvent("sounds", { state: "done", count: 1, dropped: 0 })))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => finish({ running: false, states: { sounds: { state: "done", count: 1, dropped: 0 } } }))
  await previews.land()
  await waitFor(() => expect(soundStateOf(soundRows()[0]!)).toEqual(["พร้อม"]))
})

test("while a sound is written again or changed only its own row reads กำลังแต่ง… or กำลังแก้…, from the press until the read that follows the run's end has landed, and the graphic at its place reads its own line", async () => {
  for (const how of ["redo", "edit"] as const) {
    // the first sound scores the graphic, and has the graphic's place
    let composed: ComposedSoundView[] = [{ ...SOUND, anchor: MOTION.anchor, graphic: { summary: IDEA } }, soundAt(4_000_000)]
    const answer = () => flairPreview({ composed: structuredClone(composed), graphics: [{ ...MOTION, render: "ready" }] })
    const previews = heldPreviews(answer)
    let finish!: (view: PostRunView) => void
    const pending = () => new Promise<PostRunView>((resolve) => (finish = resolve))
    const { api } = renderScreen({
      ...withGraphics({}, { text: false, zoom: false, insert: false }),
      previewHighlights: previews.previewHighlights,
      redoSound: pending,
      editSound: pending,
    })
    await ready()
    await openTab("sound")
    await screen.findByText(SOUND.role)
    await waitFor(() => expect(placing()).toBe(false))
    const states = () => soundRows().map(soundStateOf)
    const marked = how === "redo" ? "กำลังแต่ง…" : "กำลังแก้…"
    await waitFor(() => expect(soundButton("sounds.editLabel")).toHaveProperty("disabled", false))
    if (how === "redo") await userEvent.click(soundButton("sounds.redoLabel"))
    else {
      await userEvent.click(soundButton("sounds.editLabel"))
      await userEvent.type(soundEditField(), "สั้นลง")
      await userEvent.click(screen.getByRole("button", { name: SEND }))
    }
    expect(states(), how).toEqual([[marked], ["พร้อม"]])
    // its buttons, and every row's that asks Claude, wait while the run goes
    expect([soundButton("sounds.redoLabel"), soundButton("sounds.redoLabel", "เสียงที่ 4000000")].map((one) => (one as HTMLButtonElement).disabled)).toEqual([true, true])
    act(() => api.emit(planEvent("sounds", { state: "running", done: 0, total: 1 })))
    await act(async () => {})
    expect(states(), how).toEqual([[marked], ["พร้อม"]])
    expect(screen.getByText("กำลังแต่งเสียง 0 จาก 1")).toBeTruthy()
    // the graphic at the same place is not the one being written
    await openTab("graphics")
    expect(stateOf(graphicRows()[0]!)).toEqual([t("graphics.render.ready")])
    await openTab("sound")

    previews.holding = true
    composed = [{ ...composed[0]!, render: "pending" }, soundAt(4_000_000)]
    act(() => api.emit(planEvent("sounds", { state: "done", count: 1, dropped: 0 })))
    act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
    await act(async () => finish({ running: false, states: { sounds: { state: "done", count: 1, dropped: 0 } } }))
    expect(previews.held.length).toBeGreaterThan(0)
    // the run is over, and the rows still show what was read before its end
    expect(states(), how).toEqual([[marked], ["พร้อม"]])
    await act(async () => previews.held.splice(0).forEach(({ resolve }) => resolve(answer())))
    await waitFor(() => expect(states(), how).toEqual([["กำลังเรนเดอร์…"], ["พร้อม"]]))
    cleanup()
  }
})

test("ย้อน takes a sound one step back by its place, the rows read again quietly; what main refuses of a sound is said in Thai", async () => {
  const notWritten: PostWorkState = { state: "failed", error: "this sound has not been written yet" }
  let answer!: (view: PostRunView) => void
  const { api } = renderScreen({
    ...withSounds({ composed: [{ ...SOUND, canUndo: true }] }),
    editSound: () => new Promise<PostRunView>((resolve) => (answer = resolve)),
    undoSound: async () => {
      throw new Error("Error invoking remote method 'api:undoSound': Error: this sound has nothing to go back to")
    },
  })
  await ready()
  await openTab("sound")
  await waitFor(() => expect(placing()).toBe(false))
  await waitFor(() => expect(soundButton("sounds.undoLabel")).toHaveProperty("disabled", false))
  const reads = calls(api, "previewHighlights").length
  await userEvent.click(soundButton("sounds.undoLabel"))
  expect(calls(api, "undoSound")).toEqual([["undoSound", FOLDER, SOUND.anchor]])
  expect(await screen.findByText(t("error.generic", { message: "ไม่มีเสียงก่อนหน้าให้ย้อน" }))).toBeTruthy()
  expect(screen.queryByText(/nothing to go back to/)).toBeNull()
  // refused, it reads nothing again
  expect(calls(api, "previewHighlights")).toHaveLength(reads)

  await waitFor(() => expect(soundButton("sounds.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.editLabel"))
  await userEvent.type(soundEditField(), "เบาลง")
  await userEvent.click(screen.getByRole("button", { name: SEND }))
  act(() => api.emit(planEvent("sounds", { state: "running" })))
  act(() => api.emit(planEvent("sounds", notWritten)))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => answer({ running: false, states: { sounds: notWritten } }))
  expect(await screen.findByText(`${t("post.work.sounds")} ไม่สำเร็จ: เสียงนี้ยังไม่ได้แต่ง กดทำใหม่ก่อน`)).toBeTruthy()
  expect(screen.queryByText(/not been written/)).toBeNull()
})

test("a step back that goes through reads the sounds again, quietly", async () => {
  let back = false
  const { api } = renderScreen({
    ...withSounds(),
    previewHighlights: async () => flairPreview({ composed: [back ? { ...SOUND } : { ...SOUND, instruction: "เบาลง", canUndo: true }] }),
    undoSound: async () => {
      back = true
    },
  })
  await ready()
  await openTab("sound")
  await screen.findByText("แก้ล่าสุด: เบาลง")
  await waitFor(() => expect(placing()).toBe(false))
  const reads = calls(api, "previewHighlights").length
  await waitFor(() => expect(soundButton("sounds.undoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(soundButton("sounds.undoLabel"))
  await waitFor(() => expect(screen.queryByText(/แก้ล่าสุด/)).toBeNull())
  expect(calls(api, "previewHighlights")).toHaveLength(reads + 1)
  expect([calls(api, "editSound"), calls(api, "redoSound")]).toEqual([[], []])
})

test("ทำใหม่, แก้ and ย้อน wait while a run goes; off and remove wait only for a change being saved", async () => {
  const { api } = renderScreen(withSounds({ composed: [{ ...SOUND, canUndo: true }] }))
  await ready()
  await openTab("sound")
  await waitFor(() => expect(soundButton("sounds.redoLabel")).toHaveProperty("disabled", false))
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  const held = () => (["sounds.redoLabel", "sounds.editLabel", "sounds.undoLabel", "sounds.offLabel", "sounds.removeLabel"] as const).map((key) => (soundButton(key) as HTMLButtonElement).disabled)
  expect(held()).toEqual([true, true, true, false, false])
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(held()).toEqual([false, false, false, false, false]))
})

test("the user's own CapCut sounds are listed under the composed ones, by time and name, each taken off by its place; the list is not there when there are none", async () => {
  const anchor = { kind: "highlight" as const, groupId: "g1", line: 0 }
  const cue = { anchor, atUs: 100_000, what: 'ข้อความเด่น "เอาล่ะ"', beatId: "b1", effectId: "s1", soundName: "ปัง", edited: true }
  const { api } = renderScreen(withSounds({ composed: [SOUND], cues: [cue], ownSounds: [{ anchor, atUs: 100_000, name: "ปัง" }] }))
  await ready()
  await openTab("sound")
  expect(await screen.findByText(t("sounds.own"))).toBeTruthy()
  const remove = screen.getByRole("button", { name: "ลบเสียง ปัง" })
  const row = remove.closest("li")!
  expect(within(row).getByText("0:00.1")).toBeTruthy()
  expect(within(row).getByText("ปัง")).toBeTruthy()
  await waitFor(() => expect(remove).toHaveProperty("disabled", false))
  await userEvent.click(remove)
  expect(api.calls).toContainEqual(["setSoundCue", FOLDER, anchor, null])
  // a beat it is not in lists none of them
  await userEvent.click(beatPick("ปิดท้าย"))
  expect(screen.queryByText(t("sounds.own"))).toBeNull()
  cleanup()

  renderScreen(withSounds({ composed: [SOUND] }))
  await ready()
  await openTab("sound")
  await screen.findByText(SOUND.role)
  expect(screen.queryByText(t("sounds.own"))).toBeNull()
})

test("with the sounds on and none composed in the beat, the tab says how to get some; a machine a sound's render found unfit says why above the list", async () => {
  renderScreen(withSounds())
  await ready()
  await openTab("sound")
  expect(await screen.findByText("ยังไม่มีเสียง กด AI คิดใหม่: เสียง")).toBeTruthy()
  expect(soundRowsOrNone()).toEqual([])
  cleanup()

  const problem = "the app's ffmpeg is missing"
  renderScreen(withSounds({ composed: [{ ...SOUND, render: "pending" }], soundsProblem: problem }))
  await ready()
  await openTab("sound")
  const notice = await screen.findByText(`ทำเสียงบนเครื่องนี้ไม่ได้ · ${problem}`)
  expect(notice.classList.contains("warn-text")).toBe(true)
  // above the list
  expect(notice.compareDocumentPosition(soundRows()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByText(t("sounds.none"))).toBeNull()
})
const soundRowsOrNone = () => screen.queryAllByRole("listitem").filter((item) => item.classList.contains("sound"))

test("the sound tab's badge counts the rows it lists that play: composed sounds switched on, and the user's own CapCut sounds", async () => {
  const cue = (groupId: string, edited: boolean) => ({ anchor: { kind: "highlight" as const, groupId, line: 0 }, atUs: 100_000, what: "", beatId: "b1", effectId: "s1", soundName: "ปัง", edited })
  renderScreen(
    withSounds({
      composed: [SOUND, soundAt(4_000_000, { off: true })],
      // Claude's CapCut sound from before 0.6.0 still plays, but is not listed
      cues: [cue("g1", true), cue("g2", false)],
      ownSounds: [{ anchor: cue("g1", true).anchor, atUs: 100_000, name: "ปัง" }],
    }),
  )
  await ready()
  await openTab("sound")
  await screen.findByText(SOUND.role)
  expect(within(beatPick("เปิดเรื่อง")).getByText("🔊 2")).toBeTruthy()
})

test("while a graphic is written again, the sound tied to it is not marked in the sound tab", async () => {
  const tied: ComposedSoundView = { ...SOUND, anchor: MOTION.anchor, graphic: { summary: IDEA } }
  renderScreen({
    ...withGraphics({ graphics: [{ ...MOTION, render: "ready" }], composed: [tied] }, { text: false, zoom: false, insert: false }),
    redoGraphic: () => new Promise<PostRunView>(() => {}),
  })
  await ready()
  await openFlair()
  await waitFor(() => expect(graphicButton("graphics.redoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(graphicButton("graphics.redoLabel"))
  expect(stateOf(graphicRows()[0]!)).toEqual([WRITING])
  await openTab("sound")
  expect(soundStateOf(soundRows()[0]!)).toEqual(["พร้อม"])
})

test("the strip counts the sounds being composed, and says nothing of a sounds work that had none to compose", async () => {
  const { api } = renderScreen(withSounds({ composed: [SOUND] }))
  await ready()
  await openTab("sound")
  await screen.findByText(SOUND.role)
  act(() => api.emit(planEvent("graphics", { state: "running" })))
  act(() => api.emit(planEvent("sounds", { state: "waiting" })))
  act(() => api.emit(planEvent("sounds", { state: "running", done: 1, total: 3 })))
  expect(screen.getByText("กำลังแต่งเสียง 1 จาก 3")).toBeTruthy()
  // a graphic written again runs the sounds work after it, which ends with nothing done when no sound follows the graphic
  act(() => api.emit(planEvent("graphics", { state: "done", count: 1, dropped: 0 })))
  act(() => api.emit(planEvent("sounds", { state: "done", count: 0, dropped: 0 })))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(screen.getByText(t("post.run.done", { work: t("post.work.graphics"), count: 1 }))).toBeTruthy())
  expect(screen.queryByText(new RegExp(`^${t("post.work.sounds")} `))).toBeNull()
  // a run asked for the sounds alone says it composed none
  act(() => api.emit(planEvent("sounds", { state: "running" })))
  act(() => api.emit(planEvent("sounds", { state: "done", count: 0, dropped: 0 })))
  expect(screen.getByText(t("post.run.done", { work: t("post.work.sounds"), count: 0 }))).toBeTruthy()
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  cleanup()

  // a whole plan, which writes graphics and then plans the sounds, says it composed none too: only a graphic's redo or edit is quiet
  const plan = renderScreen(withSounds({ composed: [SOUND] }))
  await ready()
  for (const work of ["emphasis", "text", "techniques", "graphics", "sounds", "subtitles"] as const) act(() => plan.api.emit(planEvent(work, { state: "waiting" })))
  act(() => plan.api.emit(planEvent("graphics", { state: "done", count: 1, dropped: 0 })))
  act(() => plan.api.emit(planEvent("sounds", { state: "done", count: 0, dropped: 0 })))
  expect(screen.getByText(t("post.run.done", { work: t("post.work.sounds"), count: 0 }))).toBeTruthy()
})

/* while a write runs */

test("while a write runs nothing on the post page can be changed, since the write already took what it writes", async () => {
  renderScreen({
    ...withGraphics({ graphics: [{ ...MOTION, canUndo: true }], composed: [{ ...SOUND, canUndo: true }], emphasis: emphasisOf() }),
    getSettings: async () =>
      settingsView({
        subtitles: { enabled: true, length: "line", polish: true },
        highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
        flair: GRAPHICS_ON,
      }),
    writingTimeline: async () => true,
  })
  await ready()
  await waitFor(() => expect(within(speechRows()[1]!).getByRole("button", { name: t("timeline.action.keep") })).toHaveProperty("disabled", true))
  expect(screen.getByRole("radio", { name: t("timeline.preset.loose") })).toHaveProperty("disabled", true)

  await openTab("emphasis")
  await screen.findByText("เอาล่ะครับ")
  expect(within(pointRow("เอาล่ะครับ")).getByRole("combobox", { name: t("emphasis.importanceLabel", { text: "เอาล่ะครับ" }) })).toHaveProperty("disabled", true)
  const today = screen.getByRole("button", { name: "วันนี้" })
  expect(today.getAttribute("aria-disabled")).toBe("true")
  await userEvent.click(today)
  expect(today.getAttribute("aria-pressed")).toBe("false")
  expect(screen.getByRole("button", { name: t("emphasis.deleteLabel", { text: "เอาล่ะครับ" }) })).toHaveProperty("disabled", true)

  await openTab("techniques")
  expect(screen.getByRole("textbox", { name: t("highlights.lineLabel", { number: 1, time: "0:00.1" }) })).toHaveProperty("disabled", true)
  expect(screen.getByRole("switch", { name: new RegExp(`^${t("flair.zoom")}`) })).toHaveProperty("disabled", true)

  await openTab("graphics")
  expect(graphicButton("graphics.offLabel")).toHaveProperty("disabled", true)
  expect(graphicButton("graphics.redoLabel")).toHaveProperty("disabled", true)
  expect(graphicButton("graphics.editLabel")).toHaveProperty("disabled", true)
  expect(graphicButton("graphics.undoLabel")).toHaveProperty("disabled", true)
  expect(screen.getByRole("switch", { name: new RegExp(`^${t("flair.graphic")}`) })).toHaveProperty("disabled", true)

  await openTab("sound")
  expect(screen.getByRole("switch", { name: t("flair.sound") })).toHaveProperty("disabled", true)
  for (const key of ["sounds.redoLabel", "sounds.editLabel", "sounds.undoLabel", "sounds.offLabel", "sounds.removeLabel"] as const) {
    expect(soundButton(key), key).toHaveProperty("disabled", true)
  }

  await openTab("subtitles")
  const line = (await screen.findAllByRole("textbox"))[0] as HTMLInputElement
  // shut as it looks, rather than taking the typing and dropping it
  expect(line).toHaveProperty("disabled", true)
  await userEvent.type(line, "!")
  expect(line.value).toBe("สวัสดีครับวันนี้")
  expect(screen.getByRole("switch", { name: t("subtitles.enabled") })).toHaveProperty("disabled", true)

  const menu = await openAi()
  // the level is shut with the rest: the write took it as it was
  for (const level of within(menu).getAllByRole("radio")) expect(level).toHaveProperty("disabled", true)
  for (const work of ["emphasis", "techniques", "graphics", "sounds", "subtitles"] as const) {
    expect(within(menu).getByRole("button", { name: t(`post.ai.rethink.${work}` as MessageKey) })).toHaveProperty("disabled", true)
  }
  expect(planItem()).toHaveProperty("disabled", true)
  expect(reasonOf(planItem())).toBe(t("edit.ai.writing"))
  // one reason for them all, said once
  expect(within(menu).getAllByText(t("edit.ai.writing"))).toHaveLength(1)
})

test("while a write runs the way back to the outline is shut, and looks it", async () => {
  const { outline } = renderScreen({ writingTimeline: async () => true })
  await ready()
  // an outline changed while the write waits for its graphics would be saved, and left out of the write
  const back = screen.getByRole("button", { name: new RegExp(t("edit.editOutline")) })
  await waitFor(() => expect(back).toHaveProperty("disabled", true))
  expect(back.getAttribute("title")).toBe(t("edit.ai.writing"))
  await userEvent.click(back)
  expect(outline()).toBe(0)
})

test("while Claude plans the project the way back to the outline is shut, and looks it, until the run is over", async () => {
  const { api, outline } = renderScreen()
  await ready()
  const back = screen.getByRole("button", { name: new RegExp(t("edit.editOutline")) })
  act(() => api.emit(planEvent("emphasis", { state: "running" })))
  // a beat changed or the outline made again would land in the middle of the run
  await waitFor(() => expect(back).toHaveProperty("disabled", true))
  expect(back.getAttribute("title")).toBe(t("edit.ai.planning"))
  await userEvent.click(back)
  expect(outline()).toBe(0)
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await waitFor(() => expect(back).toHaveProperty("disabled", false))
  expect(back.getAttribute("title")).toBeNull()
})

/* the bar: the AI menu and the write button */

/** What the bar holds, in order, by what each thing is. */
const barParts = () =>
  [...bar().children].map((child) => (child.classList.contains("write-reason") ? "reason" : child.classList.contains("ai-menu") ? "ai menu" : child.classList.contains("btn") ? "write button" : child.className))

test("the bar carries the reason the write is held (when one shows), then the AI menu, then the write button, so the reason comes and goes without moving the buttons", async () => {
  const room = renderScreen({}, { capcutRunning: true })
  await ready()
  expect(barParts()).toEqual(["reason", "ai menu", "write button"])
  // the whole plan is the menu's first item, not a button of its own
  expect(within(bar()).getAllByRole("button").map((button) => button.textContent)).toEqual([`✦ ${t("post.ai")} ▾`, t("timeline.write")])
  // nothing holds the write: no reason, and the buttons are where they were
  room.setCapcutRunning(false)
  await waitFor(() => expect(barParts()).toEqual(["ai menu", "write button"]))
  // a hold that comes back puts its reason before them again
  room.setCapcutRunning(true)
  expect(barParts()).toEqual(["reason", "ai menu", "write button"])
  // the write stage is gone: nothing says "go on to write", and no page is headed with it
  expect(screen.queryByRole("button", { name: /ไปเขียนลง CapCut/ })).toBeNull()
  expect(screen.queryByRole("heading", { name: "เขียนลง CapCut" })).toBeNull()
})

test("the page says it is busy while its write runs, and not before or after", async () => {
  let answer!: (result: WriteResult) => void
  renderScreen({ writeTimeline: () => new Promise<WriteResult>((resolve) => (answer = resolve)) })
  await ready()
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  const busy = () => document.querySelector("section.edit")!.getAttribute("aria-busy")
  expect(busy()).toBe("false")
  await userEvent.click(barWrite())
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("write.confirm") }))
  expect(busy()).toBe("true")
  await act(async () => answer(await fakeApi().writeTimeline(FOLDER, settingsView().cut, 0, null, null)))
  expect(busy()).toBe("false")
})

test("the write button on the bar asks in a sheet first, and เขียนเลย writes, through the real page", async () => {
  const { api } = renderScreen()
  await ready()
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
  await userEvent.click(barWrite())
  const dialog = screen.getByRole("dialog", { name: t("write.title", { project: project.name }) })
  // asking is not writing
  expect(calls(api, "writeTimeline")).toEqual([])
  await userEvent.click(within(dialog).getByRole("button", { name: t("write.confirm") }))
  await waitFor(() => expect(calls(api, "writeTimeline")).toHaveLength(1))
  expect(calls(api, "writeTimeline")[0]![1]).toBe(FOLDER)
  expect(screen.queryByRole("dialog")).toBeNull()
  // told by a toast, and the bar offers another go
  expect(await screen.findByRole("status")).toHaveProperty("textContent", t("write.done", { pieces: 5, duration: "0:12" }))
  await waitFor(() => expect(barWrite(t("write.again"))).toHaveProperty("disabled", false))
})

test("a read that failed is announced at the top of the page, with a button that reads it again", async () => {
  let broken = true
  const { api } = renderScreen({
    previewCut: async () => {
      if (broken) throw new Error("cut broke")
      return cutPlan()
    },
  })
  const notice = await screen.findByRole("alert")
  expect(within(notice).getByText(t("write.check.cutFailed"))).toBeTruthy()
  // the first thing in the page's main column, above what the room's error says
  expect(document.querySelector(".edit-main")!.firstElementChild).toBe(notice)
  const reads = calls(api, "previewCut").length
  broken = false
  await userEvent.click(within(notice).getByRole("button", { name: t("write.check.retry") }))
  await waitFor(() => expect(calls(api, "previewCut")).toHaveLength(reads + 1))
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  // the cut is back, and the write can go
  await waitFor(() => expect(barWrite()).toHaveProperty("disabled", false))
})

test("a slow preview for rules the user already changed does not replace the newer one", async () => {
  let resolveFirst: ((plan: ReturnType<typeof cutPlan>) => void) | null = null
  let call = 0
  const { api } = renderScreen({
    previewCut: async () => {
      call += 1
      if (call === 1) return new Promise((resolve) => (resolveFirst = resolve))
      return { ...cutPlan(), durationUs: 9_000_000 }
    },
  })
  await waitFor(() => expect(calls(api, "previewCut")).toHaveLength(1))
  await openSettings("cut")
  await userEvent.click(screen.getByRole("radio", { name: t("timeline.preset.loose") }))
  await waitFor(() => expect(screen.getByText(new RegExp(t("edit.summaryTarget", { total: "0:09", target: "0:30", pieces: 5 })))).toBeTruthy())

  resolveFirst!({ ...cutPlan(), durationUs: 30_000_000 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.getByText(t("edit.summaryTarget", { total: "0:09", target: "0:30", pieces: 5 }))).toBeTruthy()
})

test("the way back to the outline is one click", async () => {
  const { outline } = renderScreen()
  await ready()
  await userEvent.click(screen.getByRole("button", { name: new RegExp(t("edit.editOutline")) }))
  expect(outline()).toBe(1)
})

/* moves of the picture */

// a move Claude designed on the word the opening's graphic is on, as the main process lists it
const MOVE: MoveView = {
  anchor: { kind: "speech", videoId: "a", sourceUs: 2_500_000, beatId: "b1" },
  insert: false,
  atUs: 750_000,
  durationUs: 1_200_000,
  beatId: "b1",
  about: "ดันเข้าหาหน้าช้าๆ แล้วเอียงนิดเดียว",
  from: "medium",
  edited: false,
  off: false,
  instruction: null,
  editFailed: null,
  canUndo: false,
}
/** Another move of the opening, at another word, told apart by what it does. */
const moveAt = (sourceUs: number, extra: Partial<MoveView> = {}): MoveView => ({
  ...MOVE,
  anchor: { kind: "speech", videoId: "a", sourceUs, beatId: "b1" },
  atUs: sourceUs - 1_750_000,
  about: `ท่าที่ ${sourceUs}`,
  ...extra,
})
// a punch of before 0.8.0 on the opening's piece, still playing
const PUNCH: ZoomView = { anchor: { videoId: "a", sourceUs: 1_750_000, beatId: "b1" }, atUs: 0, durationUs: 1_550_000, what: "ช่วงเปิด", beatId: "b1", kind: "punch", edited: false }
/** What the page names a legacy zoom's row by: its kind, then its piece. */
const punchAbout = `${t("flair.zoom.punch")} ช่วงเปิด`
const moveRows = () => screen.getAllByRole("listitem").filter((item) => item.classList.contains("move"))
const moveButton = (key: "moves.redoLabel" | "moves.editLabel" | "moves.undoLabel" | "moves.offLabel" | "moves.onLabel" | "moves.removeLabel", about = MOVE.about) =>
  screen.getByRole("button", { name: t(key, { about }) })
/** The lines of a move's row, in order, under its time. */
const moveLines = (row: HTMLElement) => [...row.querySelector(".graphic-body")!.children].map((line) => line.textContent)
const moveStateOf = (row: HTMLElement) => [...row.querySelectorAll(".move-state")].map((line) => line.textContent)
/** The anchor the API is asked with: the stored place and whether it is on a cutaway. */
const moveAnchor = (move: MoveView) => ({ ...move.anchor, insert: move.insert })
const MOVE_FIELD = "บอก AI ว่าจะแก้การเคลื่อนภาพนี้อย่างไร"
const REDOING_MOVE = "AI กำลังทำใหม่…"
const EDITING_MOVE = "AI กำลังแก้…"

test("the techniques tab lists the moves and the legacy zooms in the order they play, after the highlight text and before the cutaways", async () => {
  renderScreen(withFlair({ moves: [moveAt(4_000_000), MOVE, moveAt(3_000_000, { off: true, edited: true })], zooms: [PUNCH], inserts: [ON_ROW] }))
  await ready()
  await openTab("techniques")
  await screen.findByText(MOVE.about)
  expect(moveRows().map((row) => row.querySelector(".flair-what")!.textContent)).toEqual([t("flair.zoom.punch"), MOVE.about, "ท่าที่ 3000000", "ท่าที่ 4000000"])
  expect(within(moveRows()[1]!).getByText("0:00.7")).toBeTruthy()
  // the order of the sections in the tab
  const sections = [...panel().querySelectorAll(".tab-section")].map((one) => one.textContent)
  expect(sections.indexOf(t("highlights.title"))).toBeLessThan(sections.indexOf(t("edit.flairMoves")))
  expect(sections.indexOf(t("edit.flairMoves"))).toBeLessThan(sections.indexOf(t("edit.flairInserts")))
})

test("a move's row says, in order: what it does, the last edit, the point it was made for, the level it plays from, that it moves a cutaway, how it stands, the failed edit and that it was switched by hand", async () => {
  const why = "the face leaves the frame at 0.4 s"
  const full: MoveView = { ...MOVE, insert: true, pointId: "p1", from: "light", instruction: "ช้าลง", editFailed: why, off: true, edited: true, canUndo: true }
  renderScreen(withFlair({ emphasis: emphasisOf(), moves: [full] }))
  await ready()
  await openTab("techniques")
  await screen.findByText(MOVE.about)
  const [row] = moveRows()
  expect(moveLines(row!)).toEqual([
    MOVE.about,
    "แก้ล่าสุด: ช้าลง",
    t("emphasis.from", { text: "เอาล่ะครับ" }),
    "เล่นตั้งแต่ระดับเบา",
    "บนสื่อแทรก",
    "ปิดอยู่ ไม่ใส่ในคลิป",
    `แก้ไม่สำเร็จ · ${why}`,
    t("flair.edited"),
  ])
  // the whole of why the edit failed is there for a pointer held over it
  expect(row!.querySelector(".graphic-edit-failed")!.getAttribute("title")).toBe(why)
  expect(within(row!).getByText(t("edit.pieceLength", { seconds: "1.2" }))).toBeTruthy()
  cleanup()

  // one of Claude's that plays on the footage says only what it does and the level it plays from
  renderScreen(withFlair({ moves: [MOVE] }))
  await ready()
  await openTab("techniques")
  await screen.findByText(MOVE.about)
  expect(moveLines(moveRows()[0]!)).toEqual([MOVE.about, "เล่นตั้งแต่ระดับกลาง"])
  expect(moveStateOf(moveRows()[0]!)).toEqual([])
})

test("each level a move plays from is said in its own words", async () => {
  renderScreen(withFlair({ moves: [moveAt(2_500_000, { from: "light" }), moveAt(3_000_000, { from: "medium" }), moveAt(3_500_000, { from: "heavy" })] }))
  await ready()
  await openTab("techniques")
  await screen.findByText("ท่าที่ 2500000")
  expect(moveRows().map((row) => row.querySelector(".move-from")!.textContent)).toEqual(["เล่นตั้งแต่ระดับเบา", "เล่นตั้งแต่ระดับกลาง", "เล่นเฉพาะจัดเต็ม"])
})

test("a move's buttons are ทำใหม่, แก้, ย้อน when it has a step to go back to, ปิด or เปิด, and ลบ; a legacy zoom's is ลบ alone, having no switch", async () => {
  renderScreen(withFlair({ moves: [MOVE, moveAt(3_000_000, { canUndo: true }), moveAt(3_500_000, { off: true })], zooms: [PUNCH] }))
  await ready()
  await openTab("techniques")
  await screen.findByText(MOVE.about)
  const buttons = (row: HTMLElement) => within(row).getAllByRole("button").map((button) => button.textContent)
  const [legacy, plain, undoable, off] = moveRows()
  expect(buttons(legacy!)).toEqual(["ลบ"])
  expect(buttons(plain!)).toEqual(["ทำใหม่", "แก้", "ปิด", "ลบ"])
  expect(buttons(undoable!)).toEqual(["ทำใหม่", "แก้", "ย้อน", "ปิด", "ลบ"])
  expect(buttons(off!)).toEqual(["ทำใหม่", "แก้", "เปิด", "ลบ"])
  // read out, each is named by what it shows and then by its move
  expect(within(plain!).getByRole("button", { name: `ทำใหม่ ${MOVE.about}` }).textContent).toBe("ทำใหม่")
  expect(within(legacy!).getByRole("button", { name: `ลบ ${punchAbout}` }).textContent).toBe("ลบ")
  // a legacy zoom says what it is and where, and nothing of a level or a state
  expect(moveLines(legacy!)).toEqual([t("flair.zoom.punch"), "ช่วงเปิด"])
})

test("ทำใหม่ on a move has Claude design it again, asked by its place and whether it is on a cutaway, with the request a plan is asked with", async () => {
  const onCutaway: MoveView = { ...MOVE, insert: true, about: "ซูมรูปที่แทรกเข้าช้าๆ" }
  const { api } = renderScreen(withFlair({ moves: [MOVE, onCutaway] }))
  await ready()
  await openTab("techniques")
  await waitFor(() => expect(moveButton("moves.redoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(moveButton("moves.redoLabel"))
  await waitFor(() => expect(calls(api, "redoMove")).toHaveLength(1))
  const [, folder, anchor, request] = calls(api, "redoMove")[0]!
  expect([folder, anchor]).toEqual([FOLDER, { ...MOVE.anchor, insert: false }])
  await planAll()
  await waitFor(() => expect(calls(api, "planPost")).toHaveLength(1))
  expect(calls(api, "planPost")[0]![2]).toEqual(request)
  // the one on the cutaway at the same word is asked for as that one
  await waitFor(() => expect(moveButton("moves.redoLabel", onCutaway.about)).toHaveProperty("disabled", false))
  await userEvent.click(moveButton("moves.redoLabel", onCutaway.about))
  await waitFor(() => expect(calls(api, "redoMove")).toHaveLength(2))
  expect(calls(api, "redoMove")[1]![2]).toEqual({ ...MOVE.anchor, insert: true })
})

test("ปิด, เปิด and ลบ switch a move or remove it by its place, and ย้อน takes it one step back; a legacy zoom's ลบ takes it off its piece as before", async () => {
  const off = moveAt(3_000_000, { off: true })
  const back = moveAt(3_500_000, { canUndo: true })
  const { api } = renderScreen(withFlair({ moves: [MOVE, off, back], zooms: [PUNCH] }))
  await ready()
  await openTab("techniques")
  const press = async (button: () => HTMLElement) => {
    await waitFor(() => expect(button()).toHaveProperty("disabled", false))
    await userEvent.click(button())
  }
  await press(() => moveButton("moves.offLabel"))
  await press(() => moveButton("moves.onLabel", off.about))
  await press(() => moveButton("moves.removeLabel"))
  await press(() => moveButton("moves.undoLabel", back.about))
  await press(() => moveButton("moves.removeLabel", punchAbout))
  await waitFor(() => expect(calls(api, "setZoom")).toHaveLength(1))
  expect(calls(api, "setMove")).toEqual([
    ["setMove", FOLDER, moveAnchor(MOVE), { off: true }],
    ["setMove", FOLDER, moveAnchor(off), { off: false }],
    ["setMove", FOLDER, moveAnchor(MOVE), null],
  ])
  expect(calls(api, "undoMove")).toEqual([["undoMove", FOLDER, moveAnchor(back)]])
  expect(calls(api, "setZoom")).toEqual([["setZoom", FOLDER, PUNCH.anchor, null]])
  // none of them asks Claude
  expect([calls(api, "redoMove"), calls(api, "editMove")]).toEqual([[], []])
})

test("ทำใหม่, แก้ and ย้อน wait while a run goes, the one a move started included; ปิด and ลบ do not", async () => {
  let finish!: (view: PostRunView) => void
  const other = moveAt(3_000_000, { canUndo: true })
  const { api } = renderScreen({ ...withFlair({ moves: [MOVE, other], zooms: [PUNCH] }), redoMove: () => new Promise<PostRunView>((resolve) => (finish = resolve)) })
  await ready()
  await openTab("techniques")
  await waitFor(() => expect(moveButton("moves.redoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(moveButton("moves.redoLabel"))
  const asking = () => [moveButton("moves.redoLabel"), moveButton("moves.editLabel"), moveButton("moves.redoLabel", other.about), moveButton("moves.undoLabel", other.about)]
  expect(asking().map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true, true, true])
  const own = () => [moveButton("moves.offLabel"), moveButton("moves.removeLabel"), moveButton("moves.removeLabel", punchAbout)]
  expect(own().map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false, false])
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => finish({ running: false, states: { techniques: { state: "done", count: 1, dropped: 0 } } }))
  await waitFor(() => expect(asking().map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false, false, false]))
})

test("แก้ opens a field under the move's row in the move's words, and sending has Claude change it as typed, trimmed, with the request a plan is asked with; the field closes", async () => {
  const { api } = renderScreen(withFlair({ moves: [{ ...MOVE, insert: true }] }))
  await ready()
  await openTab("techniques")
  await waitFor(() => expect(moveButton("moves.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(moveButton("moves.editLabel"))
  const field = within(moveRows()[0]!).getByRole("textbox", { name: MOVE_FIELD })
  expect(field.getAttribute("placeholder")).toBe("เช่น แรงขึ้น ช้าลง ไม่ต้องหมุน")
  expect(document.activeElement).toBe(field)
  await userEvent.type(field, "  แรงขึ้น ")
  await userEvent.click(screen.getByRole("button", { name: SEND }))
  await waitFor(() => expect(calls(api, "editMove")).toHaveLength(1))
  const [, folder, anchor, instruction, request] = calls(api, "editMove")[0]!
  expect([folder, anchor, instruction]).toEqual([FOLDER, { ...MOVE.anchor, insert: true }, "แรงขึ้น"])
  expect(request).toEqual({ rules: settingsView().cut, view: { position: "auto", subtitlesOn: false, highlightsOn: true, flair: FLAIR_ON }, subtitles: null })
  expect(screen.queryByRole("textbox", { name: MOVE_FIELD })).toBeNull()
  // ยกเลิก closes it and keeps nothing, the keyboard back on แก้
  await waitFor(() => expect(moveButton("moves.editLabel")).toHaveProperty("disabled", false))
  await userEvent.click(moveButton("moves.editLabel"))
  await userEvent.type(screen.getByRole("textbox", { name: MOVE_FIELD }), "หมุน")
  await userEvent.click(screen.getByRole("button", { name: CANCEL }))
  expect(screen.queryByRole("textbox", { name: MOVE_FIELD })).toBeNull()
  expect(document.activeElement).toBe(moveButton("moves.editLabel"))
  expect(calls(api, "editMove")).toHaveLength(1)
})

test("while a move is designed again or changed only its own row says so, not the move on the cutaway at the same word, until the read that follows the run's end has landed", async () => {
  const onCutaway: MoveView = { ...MOVE, insert: true, about: "ซูมรูปที่แทรกเข้าช้าๆ" }
  for (const how of ["redo", "edit"] as const) {
    let finish!: (view: PostRunView) => void
    const pending = () => new Promise<PostRunView>((resolve) => (finish = resolve))
    const { api } = renderScreen({ ...withFlair({ moves: [MOVE, onCutaway], graphics: [{ ...MOTION, render: "ready" }] }), redoMove: pending, editMove: pending })
    await ready()
    await openTab("techniques")
    await waitFor(() => expect(moveButton("moves.editLabel")).toHaveProperty("disabled", false))
    if (how === "redo") await userEvent.click(moveButton("moves.redoLabel"))
    else {
      await userEvent.click(moveButton("moves.editLabel"))
      await userEvent.type(screen.getByRole("textbox", { name: MOVE_FIELD }), "ช้าลง")
      await userEvent.click(screen.getByRole("button", { name: SEND }))
    }
    const marked = how === "redo" ? REDOING_MOVE : EDITING_MOVE
    expect(moveRows().map(moveStateOf), how).toEqual([[marked], []])
    act(() => api.emit(planEvent("techniques", { state: "running" })))
    act(() => api.emit(planEvent("techniques", { state: "done", count: 1, dropped: 0 })))
    act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
    await act(async () => finish({ running: false, states: { techniques: { state: "done", count: 1, dropped: 0 } } }))
    await waitFor(() => expect(moveRows().map(moveStateOf), how).toEqual([[], []]))
    cleanup()
  }
})

test("what main refuses of a move is said in Thai: one with no place now as the techniques work's failure, one with nothing to go back to above the page", async () => {
  const noPlace: PostWorkState = { state: "failed", error: "this move has no place on the clip now" }
  let answer!: (view: PostRunView) => void
  const { api } = renderScreen({
    ...withFlair({ moves: [{ ...MOVE, canUndo: true }] }),
    redoMove: () => new Promise<PostRunView>((resolve) => (answer = resolve)),
    undoMove: async () => {
      throw new Error("Error invoking remote method 'api:undoMove': Error: this move has nothing to go back to")
    },
  })
  await ready()
  await openTab("techniques")
  await waitFor(() => expect(moveButton("moves.redoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(moveButton("moves.redoLabel"))
  act(() => api.emit(planEvent("techniques", { state: "running" })))
  act(() => api.emit(planEvent("techniques", noPlace)))
  act(() => api.emit({ type: "post-plan-finished", folder: FOLDER }))
  await act(async () => answer({ running: false, states: { techniques: noPlace } }))
  expect(await screen.findByText(`${t("post.work.techniques")} ไม่สำเร็จ: การเคลื่อนภาพนี้ไม่มีที่ในคลิปแล้ว`)).toBeTruthy()
  expect(screen.queryByText(/no place on the clip/)).toBeNull()

  await waitFor(() => expect(moveButton("moves.undoLabel")).toHaveProperty("disabled", false))
  await userEvent.click(moveButton("moves.undoLabel"))
  expect(await screen.findByText(t("error.generic", { message: "ไม่มีท่าก่อนหน้าให้ย้อน" }))).toBeTruthy()
  expect(screen.queryByText(/nothing to go back to/)).toBeNull()
})

test("the techniques tab counts the moves that play and the legacy zooms, beside the highlight text; a move switched off is not counted", async () => {
  renderScreen(withFlair({ moves: [MOVE, moveAt(3_000_000, { off: true })], zooms: [PUNCH] }))
  await ready()
  // the opening's group, its move that plays and its punch
  await waitFor(() => expect(tab("techniques").querySelector(".tab-count")!.textContent).toBe("3"))
})

test("with zooms on and no move yet, the techniques tab says how to get some; with zooms off it lists none", async () => {
  renderScreen(withFlair())
  await ready()
  await openTab("techniques")
  expect(await screen.findByText(t("moves.none"))).toBeTruthy()
  cleanup()

  renderScreen({
    ...withFlair({ moves: [MOVE] }),
    getSettings: async () => settingsView({ highlights: { enabled: true, position: "auto" as const, hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom }, flair: { ...FLAIR_ON, zoom: false } }),
  })
  await ready()
  await openTab("techniques")
  await screen.findByText(t("edit.flairInserts"))
  expect(screen.queryByText(t("edit.flairMoves"))).toBeNull()
  expect(screen.queryByText(MOVE.about)).toBeNull()
})

test("the agent tab opens a conversation with the write button's request, sends what the user types, follows Claude through events, and locks a piece", async () => {
  const { api } = renderScreen()
  await ready()
  await openTab("agent")
  expect(await screen.findByText(t("agent.empty"))).toBeTruthy()
  const [opened] = calls(api, "agentOpen")
  expect(opened![2]).toMatchObject({ rules: settingsView().cut, highlights: { groupCount: expect.any(Number) } })

  await userEvent.type(screen.getByLabelText(t("agent.input")), "ใส่ป้ายราคา")
  await userEvent.click(screen.getByRole("button", { name: t("agent.send") }))
  expect(calls(api, "agentSend")).toEqual([["agentSend", opened![1], "ใส่ป้ายราคา"]])
  expect(await screen.findByText("รับทราบ")).toBeTruthy()

  // while Claude works the tab says which round it is on and offers to stop
  act(() =>
    api.emit({
      type: "agent",
      view: agentView(opened![1] as string, {
        running: true,
        round: 3,
        pieces: [{ id: "graphic-1", kind: "graphic", startUs: 20_700_000, endUs: 22_000_000, label: "ป้ายราคา 5 บาท", by: "claude", locked: false }],
      }),
    }),
  )
  expect(screen.getByText(new RegExp(t("agent.round", { round: 3, rounds: 25 })))).toBeTruthy()
  expect(screen.getByText(/ป้ายราคา 5 บาท/)).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("agent.stop") }))
  expect(calls(api, "agentStop")).toHaveLength(1)

  act(() => api.emit({ type: "agent", view: agentView(opened![1] as string, { pieces: [{ id: "graphic-1", kind: "graphic", startUs: 20_700_000, endUs: 22_000_000, label: "ป้ายราคา 5 บาท", by: "claude", locked: false }] }) }))
  await userEvent.click(screen.getByRole("button", { name: t("agent.lock") }))
  expect(calls(api, "agentLock")).toEqual([["agentLock", opened![1], "graphic-1", true]])
})

test("the agent's timeline is written after asking, with the project's segment count", async () => {
  const { api } = renderScreen()
  await ready()
  await openTab("agent")
  await screen.findByText(t("agent.empty"))
  await userEvent.click(screen.getByRole("button", { name: t("agent.write") }))
  await userEvent.click(screen.getByRole("button", { name: t("write.confirm") }))
  expect(calls(api, "agentWrite")).toEqual([["agentWrite", detail().folder, detail().timelineSegmentCount]])
  expect(await screen.findByText(t("agent.written", { duration: "0:22", segments: 51 }))).toBeTruthy()
})

test("the chat follows new turns where scrolling answers a promise, as a newer Chromium's does, without breaking the tab", async () => {
  const before = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function () {
    return Promise.resolve() as unknown as void
  }
  try {
    const { api } = renderScreen()
    await ready()
    await openTab("agent")
    expect(await screen.findByText(t("agent.empty"))).toBeTruthy()
    const [opened] = calls(api, "agentOpen")
    const folder = opened![1] as string
    act(() => api.emit({ type: "agent", view: agentView(folder, { turns: [{ role: "user", text: "ใส่ป้ายราคา" }] }) }))
    act(() => api.emit({ type: "agent", view: agentView(folder, { turns: [{ role: "user", text: "ใส่ป้ายราคา" }, { role: "claude", say: "ได้เลย", actions: [] }] }) }))
    expect(screen.getByText("ได้เลย")).toBeTruthy()
  } finally {
    Element.prototype.scrollIntoView = before
  }
})
