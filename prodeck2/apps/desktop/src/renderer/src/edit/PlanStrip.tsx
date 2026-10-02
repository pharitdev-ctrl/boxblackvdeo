import { POST_WORKS, type PostRunView, type PostWork, type PostWorkState } from "../../../shared/api.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Mascot } from "../ui/Mascot.tsx"
import { Progress } from "../ui/Progress.tsx"
import { failureText } from "./postTabs.ts"

/** What one work's state says, line by line; a `warn` line asks the user to look. */
function linesOf(work: PostWork, state: PostWorkState, afterGraphic: boolean): { text: string; warn: boolean }[] {
  const name = t(`post.work.${work}` as MessageKey)
  switch (state.state) {
    case "waiting":
      return []
    case "running":
      // the graphics work counts the graphics whose writing has ended, once it is writing them: before that it plans, with nothing to count
      if (work === "graphics" && state.done !== undefined && state.total !== undefined) return [{ text: t("post.run.writingGraphics", { done: state.done, total: state.total }), warn: false }]
      // the sounds work counts the sounds whose composing has ended, once it is composing them
      if (work === "sounds" && state.done !== undefined && state.total !== undefined) return [{ text: t("plan.composing", { done: state.done, total: state.total }), warn: false }]
      return [{ text: t("post.run.running", { work: name }), warn: false }]
    case "done":
      // a graphic written again runs the sounds work after it, which composes nothing when no sound follows that graphic:
      // that is nothing to tell. A run asked for the sounds says it composed none
      if (work === "sounds" && afterGraphic && state.count + state.dropped === 0) return []
      return [
        { text: t("post.run.done", { work: name, count: state.count }), warn: false },
        ...(state.dropped > 0 ? [{ text: t("post.run.dropped", { work: name, count: state.dropped }), warn: true }] : []),
      ]
    case "skipped":
      if (state.reason === "off") return [{ text: t("post.run.off", { work: name }), warn: false }]
      if (state.reason === "no-emphasis") return [{ text: t("post.run.noEmphasis", { work: name }), warn: true }]
      // the work the stop caught says so; the ones after it were never begun
      return []
    case "failed": {
      // the user's stop is not a failure, and a work that ran out of time says so in plain words
      const message = failureText(state.error)
      if (message === null) return [{ text: t("post.run.stopped", { work: name }), warn: false }]
      return [{ text: t("post.run.failed", { work: name, message }), warn: true }]
    }
  }
}

/**
 * The line under the tabs: which work of the plan runs, and how each finished one went, with the mascot
 * before it while the run goes or when a work of it failed. Nothing before the first run. The bar counts the works of the run going (`current`), not how the others last ended; with
 * those not known (the room opened on a run already going) it counts every work there is word of.
 */
export function PlanStrip({ run, current }: { run: PostRunView; current: readonly PostWork[] | null }) {
  const works = POST_WORKS.filter((work) => run.states[work] !== undefined)
  if (works.length === 0) return null
  const counted = current === null ? works : works.filter((work) => current.includes(work))
  const over = counted.filter((work) => !["waiting", "running"].includes(run.states[work]!.state)).length
  // the run is a graphic's redo or edit, whose works are the graphics' and then the sounds' alone; a whole plan, a run
  // asked for the sounds, or one whose works are not known says what its sounds work did, none included
  const afterGraphic = current !== null && current.length === 2 && current.includes("graphics") && current.includes("sounds")
  // the mascot thinks while the run goes, and is sorry once it is over with a work failed; the user's stop is no failure
  const failed = works.some((work) => {
    const state = run.states[work]!
    return state.state === "failed" && failureText(state.error) !== null
  })
  const pose = run.running ? "think" : failed ? "oops" : null
  return (
    <div className="plan-strip" aria-live="polite">
      {run.running && <Progress value={counted.length > 0 ? over / counted.length : null} label={t("post.planRunning")} />}
      <div className="plan-said">
        {pose && <Mascot pose={pose} size={48} />}
        <ul className="plan-lines">
          {works.flatMap((work) =>
            linesOf(work, run.states[work]!, afterGraphic).map((line, index) => (
              <li key={`${work}-${index}`} className={line.warn ? "warn-text" : undefined}>
                {line.text}
              </li>
            )),
          )}
        </ul>
      </div>
    </div>
  )
}
