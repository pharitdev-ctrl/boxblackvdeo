import { afterEach, expect, test } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { POST_WORKS } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { PlanStrip } from "./PlanStrip.tsx"

afterEach(cleanup)

test("with the graphics written while the sounds are composed, the strip says how far each has got, and the bar counts neither as over", () => {
  render(
    <PlanStrip
      run={{
        running: true,
        states: {
          emphasis: { state: "done", count: 2, dropped: 0 },
          text: { state: "skipped", reason: "off" },
          techniques: { state: "skipped", reason: "off" },
          graphics: { state: "running", done: 3, total: 9 },
          sounds: { state: "running", done: 5, total: 12 },
          subtitles: { state: "skipped", reason: "off" },
        },
      }}
      current={POST_WORKS}
    />,
  )
  expect(screen.getByText(t("post.run.writingGraphics", { done: 3, total: 9 }))).toBeTruthy()
  expect(screen.getByText(t("plan.composing", { done: 5, total: 12 }))).toBeTruthy()
  // four of the six works are over
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(String(Math.round((4 / 6) * 100)))
})

/* the mascot beside the strip: thinking while the run goes, sorry when a work of it failed */

const mascots = () => [...document.querySelectorAll<HTMLImageElement>(".plan-strip img.mascot")]
const poseOf = (image: HTMLImageElement) => [...image.classList].find((name) => name.startsWith("mascot-"))

test("while a run goes the mascot thinks beside the strip, and says nothing a screen reader needs", () => {
  render(<PlanStrip run={{ running: true, states: { emphasis: { state: "running" } } }} current={["emphasis"]} />)
  expect(mascots().map(poseOf)).toEqual(["mascot-think"])
  expect(mascots()[0]!.getAttribute("alt")).toBe("")
})

test("a run that is over with a work failed has the mascot say oops, not think", () => {
  render(
    <PlanStrip
      run={{ running: false, states: { emphasis: { state: "done", count: 2, dropped: 0 }, graphics: { state: "failed", error: "Claude broke" } } }}
      current={["emphasis", "graphics"]}
    />,
  )
  expect(mascots().map(poseOf)).toEqual(["mascot-oops"])
  expect(mascots()[0]!.getAttribute("alt")).toBe("")
})

test("a run that went well, or one the user stopped, leaves no mascot beside the strip", () => {
  render(<PlanStrip run={{ running: false, states: { emphasis: { state: "done", count: 2, dropped: 0 } } }} current={["emphasis"]} />)
  expect(mascots()).toEqual([])
  cleanup()
  render(<PlanStrip run={{ running: false, states: { emphasis: { state: "failed", error: "the run was cancelled" } } }} current={["emphasis"]} />)
  expect(mascots()).toEqual([])
})
