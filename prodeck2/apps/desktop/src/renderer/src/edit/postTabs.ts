import { POST_WORKS, type EmphasisPointView, type PostRunView, type PostWork } from "../../../shared/api.ts"
import { t, type MessageKey } from "../i18n.ts"

/** The five tabs of the post-production page, in the order of the work. */
export const POST_TABS = ["cut", "emphasis", "graphics", "sound", "subtitles"] as const
export type PostTab = (typeof POST_TABS)[number]

/** Which tab each work of the run fills. */
export const TAB_OF_WORK: Record<PostWork, PostTab> = { emphasis: "emphasis", text: "graphics", techniques: "graphics", graphics: "graphics", sounds: "sound", subtitles: "subtitles" }

/** How a tab stands in the run: a spinner while a work of it runs, a warning when one failed (not stopped), else its count. */
export type TabRun = { state: "idle" } | { state: "running" } | { state: "failed"; error: string }

/**
 * Main's own words for what the user can meet on the post-production page — a run refused because another of
 * the project's is going, a work with no Claude connection, a point or a picture main refuses — each matched
 * by how its message ends, wrapped or not by Electron's "Error invoking remote method …: Error: ", with the key
 * that says it in the user's language. Main's messages stay as they are, in its own words, for its tests.
 */
const MAIN_WORDS: [RegExp, MessageKey][] = [
  [/(?:^|: )a plan for this project is already running$/, "post.alreadyRunning"],
  [/ is not ready: no Claude connection$/, "error.noClaude"],
  // the real app's connection (main/llm.ts chosenLlm) says which part is missing
  [/ is not ready: claude-cli-missing$/, "problem.claude-cli-missing"],
  [/ is not ready: anthropic-key-missing$/, "problem.anthropic-key-missing"],
  [/(?:^|: )the point is outside its video$/, "emphasis.refused.outsideVideo"],
  [/(?:^|: )the point is outside its beat$/, "emphasis.refused.outsideBeat"],
  [/(?:^|: )the point is on the wrong kind of beat for a (?:speech|scene) point$/, "emphasis.refused.wrongBeat"],
  [/(?:^|: )unknown beat \S+ for video \S+$/, "emphasis.refused.beatGone"],
  [/(?:^|: )the point overlaps another point$/, "emphasis.refused.overlaps"],
  [/(?:^|: )(?:unknown emphasis point|there is no point) \S+$/, "emphasis.refused.gone"],
  [/(?:^|: )the point \S+ is not on the rough cut$/, "emphasis.refused.offCut"],
  [/(?:^|: )this project has no picture \S+$/, "graphics.refused.noPicture"],
  [/(?:^|: )there is no cutaway of that picture at that place$/, "graphics.refused.noCutaway"],
  // thrown inside the graphics work when one graphic is written again, so it comes as that work's failure in the strip
  [/(?:^|: )this graphic has no place on the clip now$/, "graphics.refused.noPlace"],
]

/** A message from main in the user's words when it is one they can meet on the page (MAIN_WORDS), else as it came. */
export function mainText(error: string): string {
  const known = MAIN_WORDS.find(([pattern]) => pattern.test(error))
  return known ? t(known[1]) : error
}

/**
 * What a failed Claude call's message tells the user: nothing when it was their own stop, plain words
 * when it ran out of time, main's known words in the user's (mainText), else the message as it came.
 * The room's `aiFailure` and the plan strip both use it, so the two cannot drift apart.
 */
export function failureText(error: string): string | null {
  if (/\bcancelled$/.test(error)) return null
  if (/\btimed out$/.test(error)) return t("edit.ai.timedOut")
  return mainText(error)
}

/** A failure that is the user's own stop, which is not a failure to show. */
export const wasStopped = (error: string): boolean => failureText(error) === null

/** Each tab's state in the run: a running work of a tab says more than a failed one. */
export function tabRuns(run: PostRunView): Record<PostTab, TabRun> {
  const runs = Object.fromEntries(POST_TABS.map((tab) => [tab, { state: "idle" } as TabRun])) as Record<PostTab, TabRun>
  for (const work of POST_WORKS) {
    const state = run.states[work]
    const tab = TAB_OF_WORK[work]
    if (state?.state === "running") runs[tab] = { state: "running" }
    else if (state?.state === "failed" && !wasStopped(state.error) && runs[tab].state !== "running") runs[tab] = { state: "failed", error: state.error }
  }
  return runs
}

/** Which point an item was made for, in the user's words; null for an item bound to none, or to a point not on the cut now. */
export function pointLabel(points: EmphasisPointView[], pointId: string | undefined): string | null {
  if (pointId === undefined) return null
  const point = points.find((one) => one.id === pointId)
  return point ? t("emphasis.from", { text: point.text }) : null
}
