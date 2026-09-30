import { afterEach, expect, test } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { RendererApi, StoredOutline, UnusedPart } from "../../../shared/api.ts"
import { mediaUrl } from "../../../shared/media-url.ts"
import { detail, fakeApi, storedOutline } from "../../test/fake-api.ts"
import { t } from "../i18n.ts"
import { OutlineScreen } from "./OutlineScreen.tsx"

afterEach(cleanup)

const project = detail()
const FOLDER = project.folder

function renderScreen(overrides: Partial<RendererApi> = {}) {
  const api = fakeApi(overrides)
  const confirmed: StoredOutline[] = []
  render(<OutlineScreen api={api} project={project} videoIds={["a", "b"]} onConfirmed={(stored) => confirmed.push(stored)} />)
  return { api, confirmed }
}

const withSaved = (stored = storedOutline()) => ({ getOutline: async () => stored })
const beatItems = () => screen.getAllByRole("listitem").filter((item) => item.classList.contains("beat"))
const beatNames = () => beatItems().map((item) => within(item).getByRole("heading").textContent)

test("asks for a brief first and plans with what the user filled in", async () => {
  const { api } = renderScreen()
  await userEvent.click(await screen.findByRole("radio", { name: t("brief.minutes", { minutes: 1 }) }))
  await userEvent.selectOptions(screen.getByLabelText(t("brief.type")), "review")
  await userEvent.type(screen.getByLabelText(t("brief.instructions")), "เน้นช่วงตลก")
  await userEvent.click(screen.getByRole("button", { name: t("brief.submit") }))
  expect(api.calls).toContainEqual(["planOutline", FOLDER, ["a", "b"], { targetSeconds: 60, videoType: "review", instructions: "เน้นช่วงตลก" }])
  expect(await screen.findByRole("heading", { name: "นักบินอวกาศ" })).toBeTruthy()
})

test("the brief can be left empty", async () => {
  const { api } = renderScreen()
  await userEvent.click(await screen.findByRole("button", { name: t("brief.submit") }))
  expect(api.calls).toContainEqual(["planOutline", FOLDER, ["a", "b"], { targetSeconds: null, videoType: null, instructions: "" }])
})

test("while planning it says so and can be cancelled", async () => {
  const { api } = renderScreen({ planOutline: () => new Promise(() => {}) })
  await userEvent.click(await screen.findByRole("button", { name: t("brief.submit") }))
  expect(screen.getByText(t("outline.planning"))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("outline.cancel") }))
  expect(api.calls).toContainEqual(["cancelPlanning"])
})

test("a failed plan shows why and keeps the brief to try again", async () => {
  renderScreen({
    planOutline: async () => {
      throw new Error("Claude Code failed: overloaded")
    },
  })
  await userEvent.type(await screen.findByLabelText(t("brief.instructions")), "สั้นๆ")
  await userEvent.click(screen.getByRole("button", { name: t("brief.submit") }))
  expect(await screen.findByText(t("error.generic", { message: "Claude Code failed: overloaded" }))).toBeTruthy()
  expect(screen.getByLabelText(t("brief.instructions"))).toHaveProperty("value", "สั้นๆ")
})

test("an outline saved earlier for this project is shown without planning again", async () => {
  const { api } = renderScreen(withSaved())
  expect(await screen.findByRole("heading", { name: "นักบินอวกาศ" })).toBeTruthy()
  expect(api.calls.some(([name]) => name === "planOutline")).toBe(false)
})

test("an outline saved for different videos is not reused", async () => {
  renderScreen(withSaved(storedOutline({ videoIds: ["a"] })))
  expect(await screen.findByRole("button", { name: t("brief.submit") })).toBeTruthy()
})

test("each beat shows what it is for, where it comes from, what is said and seen", async () => {
  renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  const first = beatItems()[0]!
  expect(within(first).getByRole("heading").textContent).toBe("เปิดเรื่อง")
  expect(within(first).getByText("หน้าที่ของเปิดเรื่อง")).toBeTruthy()
  expect(within(first).getByText(t("outline.source", { clip: "intro.mov", from: "0:01.9", to: "0:07.0", seconds: "5.1" }))).toBeTruthy()
  expect(within(first).getByText("คำพูดในเปิดเรื่อง")).toBeTruthy()
  expect(within(first).getByText("ภาพในเปิดเรื่อง")).toBeTruthy()
})

test("shows the total length against the target, and what was left out", async () => {
  renderScreen(withSaved())
  expect(await screen.findByText(t("outline.length", { total: "0:11", target: "0:30" }))).toBeTruthy()
  expect(screen.getByText(t("outline.omitted", { text: "ตัดช่วงนับถอยหลังที่พูดผิด" }))).toBeTruthy()
})

test("warns when the AI referred to material that does not exist", async () => {
  const stored = storedOutline()
  renderScreen(withSaved({ ...stored, outline: { ...stored.outline, warnings: [{ beat: 4, problem: "unknown-part" }] } }))
  expect(await screen.findByText(t("outline.warnings", { count: 1 }))).toBeTruthy()
})

test("moving a beat down reorders the outline and saves it", async () => {
  const { api } = renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  await userEvent.click(within(beatItems()[0]!).getByRole("button", { name: t("outline.moveDown") }))
  expect(beatNames()).toEqual(["ภาพประกอบ", "เปิดเรื่อง", "ปิดท้าย"])
  expect(api.calls).toContainEqual(["saveOutlineEdits", FOLDER, ["b2", "b1", "b3"], false])
})

test("a beat dragged onto another takes its place, and the new order is saved", async () => {
  const { api } = renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  const items = beatItems()
  const transfer = { effectAllowed: "", setData: () => {}, getData: () => "" }
  fireEvent.dragStart(items[2]!, { dataTransfer: transfer })
  fireEvent.dragOver(items[0]!, { dataTransfer: transfer })
  fireEvent.drop(items[0]!, { dataTransfer: transfer })

  expect(beatNames()).toEqual(["ปิดท้าย", "เปิดเรื่อง", "ภาพประกอบ"])
  expect(api.calls).toContainEqual(["saveOutlineEdits", FOLDER, ["b3", "b1", "b2"], false])
})

test("a beat dropped back where it started changes nothing", async () => {
  const { api } = renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  const items = beatItems()
  const transfer = { effectAllowed: "", setData: () => {}, getData: () => "" }
  fireEvent.dragStart(items[1]!, { dataTransfer: transfer })
  fireEvent.drop(items[1]!, { dataTransfer: transfer })
  expect(beatNames()).toEqual(["เปิดเรื่อง", "ภาพประกอบ", "ปิดท้าย"])
  expect(api.calls.some(([name]) => name === "saveOutlineEdits")).toBe(false)
})

test("the first beat cannot move up and the last cannot move down", async () => {
  renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  expect(within(beatItems()[0]!).getByRole("button", { name: t("outline.moveUp") })).toHaveProperty("disabled", true)
  expect(within(beatItems()[2]!).getByRole("button", { name: t("outline.moveDown") })).toHaveProperty("disabled", true)
})

test("removing a beat saves the outline without it", async () => {
  const { api } = renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  await userEvent.click(within(beatItems()[1]!).getByRole("button", { name: t("outline.remove") }))
  expect(beatNames()).toEqual(["เปิดเรื่อง", "ปิดท้าย"])
  expect(api.calls).toContainEqual(["saveOutlineEdits", FOLDER, ["b1", "b3"], false])
})

test("previewing a beat plays just that stretch of its video, with controls for that stretch only", async () => {
  renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  await userEvent.click(within(beatItems()[0]!).getByRole("button", { name: t("outline.preview") }))
  const video = document.querySelector("video")!
  expect(video.getAttribute("src")).toBe(mediaUrl(FOLDER, "a"))
  expect(video.controls).toBe(false)
  // the first beat runs from 1.9 s to 7 s of clip a
  expect(screen.getByRole("slider", { name: t("preview.position") }).getAttribute("max")).toBe("5.1")
  fireEvent(video, new Event("loadedmetadata"))
  expect(video.currentTime).toBe(1.9)

  await userEvent.keyboard("{Escape}")
  expect(document.querySelector("video")).toBeNull()
})

test("the user can tell the AI what to change", async () => {
  const revised = storedOutline()
  const { api } = renderScreen({ ...withSaved(), reviseOutline: async () => ({ ...revised, outline: { ...revised.outline, title: "ฉบับแก้" } }) })
  await userEvent.type(await screen.findByLabelText(t("outline.reviseLabel")), "ตัดช่วงปิดท้ายออก")
  await userEvent.click(screen.getByRole("button", { name: t("outline.revise") }))
  expect(api.calls).toContainEqual(["reviseOutline", FOLDER, "ตัดช่วงปิดท้ายออก", storedOutline().brief])
  expect(await screen.findByRole("heading", { name: "ฉบับแก้" })).toBeTruthy()
})

test("the user can ask for a completely new outline", async () => {
  const { api } = renderScreen(withSaved())
  await userEvent.click(await screen.findByRole("button", { name: t("outline.replan") }))
  expect(api.calls).toContainEqual(["regenerateOutline", FOLDER, storedOutline().brief])
})

test("the brief the outline was made from is shown beside it, and a change to it goes with the new plan", async () => {
  const { api } = renderScreen(withSaved())
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  expect((screen.getByRole("radio", { name: t("brief.seconds", { seconds: 30 }) }) as HTMLInputElement).checked).toBe(true)
  await userEvent.click(screen.getByRole("radio", { name: t("brief.minutes", { minutes: 1.5 }) }))
  expect((screen.getByRole("radio", { name: t("brief.minutes", { minutes: 1.5 }) }) as HTMLInputElement).checked).toBe(true)
  await userEvent.click(screen.getByRole("button", { name: t("outline.replan") }))
  expect(api.calls).toContainEqual(["regenerateOutline", FOLDER, { ...storedOutline().brief, targetSeconds: 90 }])
  // the plan that comes back is for the changed brief, and the panel keeps showing it
  await waitFor(() => expect((screen.getByRole("radio", { name: t("brief.minutes", { minutes: 1.5 }) }) as HTMLInputElement).checked).toBe(true))
})

test("confirming saves the outline as confirmed and moves on", async () => {
  const { api, confirmed } = renderScreen(withSaved())
  await userEvent.click(await screen.findByRole("button", { name: t("outline.confirm") }))
  expect(api.calls).toContainEqual(["saveOutlineEdits", FOLDER, ["b1", "b2", "b3"], true])
  await waitFor(() => expect(confirmed).toHaveLength(1))
  expect(confirmed[0]!.confirmed).toBe(true)
})

test("a confirm that fails says why, and can be tried again", async () => {
  let fail = true
  const { confirmed } = renderScreen({
    ...withSaved(),
    saveOutlineEdits: async (_folder, beatIds, isConfirmed) => {
      if (fail) throw new Error("unknown beat b3")
      return { ...storedOutline(), confirmed: isConfirmed, outline: { ...storedOutline().outline, beats: storedOutline().outline.beats.filter((beat) => beatIds.includes(beat.id)) } }
    },
  })
  await userEvent.click(await screen.findByRole("button", { name: t("outline.confirm") }))
  expect(await screen.findByText(t("error.generic", { message: "unknown beat b3" }))).toBeTruthy()
  expect(confirmed).toEqual([])
  fail = false
  await userEvent.click(screen.getByRole("button", { name: t("outline.confirm") }))
  await waitFor(() => expect(confirmed).toHaveLength(1))
})

test("an outline that cannot be read says why instead of loading forever", async () => {
  renderScreen({
    getOutline: async () => {
      throw new Error("outline file damaged")
    },
  })
  expect(await screen.findByText(t("error.generic", { message: "outline file damaged" }))).toBeTruthy()
  expect(screen.queryByText(t("detail.loading"))).toBeNull()
})

test("an outline with no beats left cannot be confirmed", async () => {
  const stored = storedOutline()
  renderScreen(withSaved({ ...stored, outline: { ...stored.outline, beats: [] } }))
  expect(await screen.findByRole("button", { name: t("outline.confirm") })).toHaveProperty("disabled", true)
})


const part = (id: string, videoId: string, videoName: string, start: number, text: string, extra: Partial<UnusedPart> = {}): UnusedPart => ({
  id,
  videoId,
  videoName,
  kind: "speech",
  index: 0,
  startUs: start * 1_000_000,
  endUs: (start + 2) * 1_000_000,
  text,
  retake: null,
  ...extra,
})
const unusedList = () => screen.getByRole("region", { name: t("unused.title") })

test("parts the AI left out are listed by clip, and putting one back updates the outline and the list", async () => {
  const withIntro = storedOutline()
  const added = { ...withIntro, outline: { ...withIntro.outline, beats: [{ ...withIntro.outline.beats[0]!, id: "new", name: "สวัสดีทุกคน" }, ...withIntro.outline.beats] }, confirmed: false }
  const { api } = renderScreen({
    ...withSaved(),
    unusedParts: async () => [part("a:u0", "a", "intro.mov", 0.2, "สวัสดีทุกคน"), part("a:u9", "a", "intro.mov", 20, "ตอนนี้"), part("b:s2", "b", "broll.mp4", 5, "ภาพร้าน", { kind: "scenes" })],
    addOutlinePart: async () => added,
  })
  await screen.findByRole("region", { name: t("unused.title") })
  expect(within(unusedList()).getByText(t("unused.clip", { clip: "intro.mov", count: 2 }))).toBeTruthy()
  expect(within(unusedList()).getByText(t("unused.clip", { clip: "broll.mp4", count: 1 }))).toBeTruthy()
  const intro = within(unusedList()).getByText("สวัสดีทุกคน").closest("li")!
  expect(within(intro).getByText("0:00.2")).toBeTruthy()

  await userEvent.click(within(intro).getByRole("button", { name: t("unused.add") }))
  expect(api.calls).toContainEqual(["addOutlinePart", FOLDER, "a:u0"])
  expect(await screen.findByRole("heading", { name: "สวัสดีทุกคน" })).toBeTruthy()
  await waitFor(() => expect(api.calls.filter(([name]) => name === "unusedParts").length).toBeGreaterThanOrEqual(2))
})

test("a left-out take of a retake says what the AI preferred", async () => {
  renderScreen({
    ...withSaved(),
    unusedParts: async () => [
      part("a:u4", "a", "intro.mov", 10, "สาม สอง หนึ่ง", { retake: { take: "A", better: "B" } }),
      part("a:u6", "a", "intro.mov", 15, "สาม สอง หนึ่ง", { retake: { take: "B", better: "B" } }),
      part("a:u8", "a", "intro.mov", 20, "ครับ", { retake: { take: "A", better: "same" } }),
    ],
  })
  await screen.findByRole("region", { name: t("unused.title") })
  expect(within(unusedList()).getByText(t("unused.retake", { verdict: t("unused.retakeOther") }))).toBeTruthy()
  expect(within(unusedList()).getByText(t("unused.retake", { verdict: t("unused.retakeThis") }))).toBeTruthy()
  expect(within(unusedList()).getByText(t("unused.retake", { verdict: t("unused.retakeSame") }))).toBeTruthy()
})

test("a clip with many left-out parts shows five until asked for all", async () => {
  renderScreen({ ...withSaved(), unusedParts: async () => Array.from({ length: 7 }, (_, n) => part(`a:u${n}`, "a", "intro.mov", n * 3, `ประโยค ${n + 1}`)) })
  await screen.findByRole("region", { name: t("unused.title") })
  expect(within(unusedList()).getAllByRole("button", { name: t("unused.add") })).toHaveLength(5)
  await userEvent.click(within(unusedList()).getByRole("button", { name: t("unused.showAll", { count: 7 }) }))
  expect(within(unusedList()).getAllByRole("button", { name: t("unused.add") })).toHaveLength(7)
})

test("a left-out part plays on its own", async () => {
  renderScreen({ ...withSaved(), unusedParts: async () => [part("a:u9", "a", "intro.mov", 20, "ตอนนี้")] })
  const row = (await screen.findByText("ตอนนี้")).closest("li")!
  await userEvent.click(within(row).getByRole("button", { name: t("unused.play") }))
  expect(row.querySelector("video")!.getAttribute("src")).toBe(mediaUrl(FOLDER, "a"))
  expect(within(row).getByRole("slider", { name: t("preview.position") }).getAttribute("max")).toBe("2")
})

test("after a beat is removed and saved, the list is asked for again", async () => {
  let saved = false
  const { api } = renderScreen({
    ...withSaved(),
    saveOutlineEdits: async (_folder, beatIds, confirmed) => {
      saved = true
      return { ...storedOutline(), confirmed, outline: { ...storedOutline().outline, beats: storedOutline().outline.beats.filter((b) => beatIds.includes(b.id)) } }
    },
    unusedParts: async () => (saved ? [part("a:u1", "a", "intro.mov", 2, "เอาล่ะครับวันนี้")] : []),
  })
  await screen.findByRole("heading", { name: "นักบินอวกาศ" })
  expect(screen.queryByRole("region", { name: t("unused.title") })).toBeNull()
  await userEvent.click(within(beatItems()[0]!).getByRole("button", { name: t("outline.remove") }))
  expect(await screen.findByText("เอาล่ะครับวันนี้")).toBeTruthy()
  expect(api.calls.filter(([name]) => name === "unusedParts").length).toBeGreaterThanOrEqual(2)
})
