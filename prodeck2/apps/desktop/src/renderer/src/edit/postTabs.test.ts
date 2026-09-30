import { expect, test } from "vitest"
import type { EmphasisPointView } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { failureText, mainText, pointLabel, POST_TABS, TAB_OF_WORK, tabRuns, wasStopped } from "./postTabs.ts"

test("the five tabs are in the order of the work, and each work of the run fills one of them", () => {
  expect(POST_TABS).toEqual(["cut", "emphasis", "graphics", "sound", "subtitles"])
  expect(TAB_OF_WORK).toEqual({ emphasis: "emphasis", text: "graphics", techniques: "graphics", graphics: "graphics", sounds: "sound", subtitles: "subtitles" })
})

test("a tab spins while a work of it runs, is flagged when one failed, and is idle otherwise", () => {
  const runs = tabRuns({
    running: true,
    states: {
      emphasis: { state: "done", count: 4, dropped: 0 },
      text: { state: "failed", error: "Claude is busy" },
      techniques: { state: "running" },
      sounds: { state: "waiting" },
      subtitles: { state: "failed", error: "timed out" },
    },
  })
  expect(runs).toEqual({
    cut: { state: "idle" },
    emphasis: { state: "idle" },
    graphics: { state: "running" },
    sound: { state: "idle" },
    subtitles: { state: "failed", error: "timed out" },
  })
})

test("a failed work of a tab shows until another work of that tab runs", () => {
  expect(tabRuns({ running: true, states: { text: { state: "running" }, techniques: { state: "failed", error: "Claude is busy" } } }).graphics).toEqual({ state: "running" })
  expect(tabRuns({ running: false, states: { text: { state: "done", count: 1, dropped: 0 }, graphics: { state: "failed", error: "Claude is busy" } } }).graphics).toEqual({
    state: "failed",
    error: "Claude is busy",
  })
})

test("the user's stop is not a failure: the tab it caught stays idle", () => {
  expect(wasStopped("cancelled")).toBe(true)
  expect(wasStopped("Error invoking remote method 'api:planPost': Error: cancelled")).toBe(true)
  expect(wasStopped("cancelled by the network")).toBe(false)
  expect(tabRuns({ running: false, states: { sounds: { state: "failed", error: "cancelled" }, subtitles: { state: "skipped", reason: "stopped" } } })).toEqual(
    tabRuns({ running: false, states: {} }),
  )
})

test("a failed call is told in plain words: nothing for the user's stop, the timeout in Thai, anything else as it came", () => {
  expect(failureText("Error invoking remote method 'api:planPost': Error: cancelled")).toBeNull()
  expect(failureText("claude timed out")).toBe(t("edit.ai.timedOut"))
  expect(failureText("timed out after the answer")).toBe("timed out after the answer")
  expect(failureText("Claude is busy")).toBe("Claude is busy")
})

test("a run refused because another of this project's is going says so in Thai, not in main's own words", () => {
  expect(failureText("Error invoking remote method 'api:rethinkPost': Error: a plan for this project is already running")).toBe(t("post.alreadyRunning"))
  expect(failureText("a plan for this project is already running")).toBe(t("post.alreadyRunning"))
  // only main's refusal itself, not a message that merely ends like it
  expect(failureText("not a plan for this project is already running")).toBe("not a plan for this project is already running")
})

test("what main refuses on the page, and a work with no Claude connection, is said in Thai, wrapped by Electron or not", () => {
  const wrapped = (message: string) => `Error invoking remote method 'api:setEmphasisPoint': Error: ${message}`
  const said: [string, string][] = [
    ["planning the emphasis is not ready: no Claude connection", t("error.noClaude")],
    ["planning zooms and cutaways is not ready: no Claude connection", t("error.noClaude")],
    ["planning the emphasis is not ready: claude-cli-missing", t("problem.claude-cli-missing")],
    ["planning sounds is not ready: anthropic-key-missing", t("problem.anthropic-key-missing")],
    ["the point is outside its video", t("emphasis.refused.outsideVideo")],
    ["the point is outside its beat", t("emphasis.refused.outsideBeat")],
    ["the point is on the wrong kind of beat for a speech point", t("emphasis.refused.wrongBeat")],
    ["the point is on the wrong kind of beat for a scene point", t("emphasis.refused.wrongBeat")],
    ["unknown beat beat-9 for video 8efd5c3a", t("emphasis.refused.beatGone")],
    ["the point overlaps another point", t("emphasis.refused.overlaps")],
    ["unknown emphasis point p-9", t("emphasis.refused.gone")],
    ["there is no point p-9", t("emphasis.refused.gone")],
    ["the point p-9 is not on the rough cut", t("emphasis.refused.offCut")],
    ["this project has no picture m9", t("graphics.refused.noPicture")],
    ["there is no cutaway of that picture at that place", t("graphics.refused.noCutaway")],
    ["this graphic has no place on the clip now", t("graphics.refused.noPlace")],
    ["this graphic has not been written yet", t("graphics.refused.notWritten")],
    ["this graphic has nothing to go back to", t("graphics.refused.nothingBack")],
    ["a plan for this project is already running", t("post.alreadyRunning")],
  ]
  for (const [message, thai] of said) {
    expect(mainText(message)).toBe(thai)
    expect(mainText(wrapped(message))).toBe(thai)
    // a work's failure in the run says the same
    expect(failureText(message)).toBe(thai)
  }
  // only main's own words, not a message that merely ends like them; anything else as it came
  expect(mainText("not the point overlaps another point")).toBe("not the point overlaps another point")
  expect(mainText("Claude is busy")).toBe("Claude is busy")
})

test("an item names the point it was made for; one bound to none, or to a point not on the cut, names nothing", () => {
  const point = { id: "p1", text: "ราคา 590" } as EmphasisPointView
  expect(pointLabel([point], "p1")).toBe(t("emphasis.from", { text: "ราคา 590" }))
  expect(pointLabel([point], undefined)).toBeNull()
  expect(pointLabel([point], "p9")).toBeNull()
})
