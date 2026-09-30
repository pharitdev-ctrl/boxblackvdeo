import type { CutRules } from "@boxblack/core/cut"
import { EMPTY_EMPHASIS } from "@boxblack/core/emphasis/types"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import { POST_WORKS, type AppEvent, type PostRequest, type PostRunView, type PostWork, type PostWorkState, type RethinkWork } from "../shared/api.ts"
import { CANCELLED } from "./ai-calls.ts"
import type { EmphasisService } from "./emphasis.ts"
import type { FlairService } from "./flair.ts"
import type { HighlightService } from "./highlights.ts"
import type { OutlineStore } from "./planner.ts"
import type { TimelineService } from "./timeline.ts"

export interface PostPlanDeps {
  outlines: OutlineStore
  emphasis: Pick<EmphasisService, "plan" | "placedCount">
  highlights: Pick<HighlightService, "pick">
  flair: Pick<FlairService, "planTechniques" | "planGraphics" | "planSounds" | "redoGraphic" | "editGraphic" | "undoGraphic">
  timeline: Pick<TimelineService, "polishStored">
  send?: (event: AppEvent) => void
  /** the signal the next stop of the editing room's Claude calls aborts, read as a run starts: a stop pressed between two works ends the run too */
  stopSignal?: () => AbortSignal
}

/** What a work answers: how many things it put down, and how many of Claude's it could not use; `skipped` when it found it had nothing to draw on (graphics with no canvas). */
type Counted = { count: number; dropped: number; skipped?: "no-canvas" }

/** The works each rethink runs; the points go through emphasisOnly. */
const RETHOUGHT: Record<RethinkWork, readonly PostWork[]> = { graphics: ["text", "techniques", "graphics"], sounds: ["sounds"], subtitles: ["subtitles"] }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Whether any point plays on the rough cut now — works 2 and 4 have nothing to go on without one — or why that could not be read. */
type OnCut = { points: boolean } | { error: string }

export function createPostPlanService(deps: PostPlanDeps) {
  const send = deps.send ?? (() => {})
  /** each project's run as it stands, or as the last one ended, since the app started */
  const runs = new Map<string, PostRunView>()

  /** Refuses what may not happen while a run goes on the project: another run, or a graphic taken a step back. */
  function refuseWhileRunning(folder: string): void {
    if (runs.get(folder)?.running) throw new Error("a plan for this project is already running")
  }

  /**
   * One run of some works on a project: every work it will touch is marked waiting and the screen told,
   * then each is marked as it runs and ends. The works it does not touch keep how they stood after the
   * project's last run, so thinking one work again does not hide that another failed. A second run on
   * the project is refused while this one goes.
   */
  function begin(folder: string, works: readonly PostWork[]) {
    refuseWhileRunning(folder)
    const stop = deps.stopSignal?.()
    // the works' own stop, handed to every Claude call they make: the user's stop aborts it, with the reason a
    // call reads as a stop, so a work that got its Claude connection after the Stop is stopped all the same
    const own = new AbortController()
    const forward = () => own.abort(new Error(CANCELLED))
    stop?.addEventListener("abort", forward, { once: true })
    let stopped = false
    const view: PostRunView = { running: true, states: { ...(runs.get(folder)?.states ?? {}) } }
    runs.set(folder, view)
    const mark = (work: PostWork, state: PostWorkState) => {
      view.states = { ...view.states, [work]: state }
      send({ type: "post-plan", folder, work, state })
    }
    for (const work of works) mark(work, { state: "waiting" })
    /** the user pressed stop: during a call, which then failed "cancelled", or between two */
    const halted = () => stopped || stop?.aborted === true
    return {
      halted,
      /** The stop every Claude call of this run is made with. */
      signal: own.signal,
      /** Whether a work of this run ended done: it put something down, or had nothing to replace. */
      done: (work: PostWork): boolean => view.states[work]?.state === "done",
      /** Runs one work unless the run was stopped; true when it is done. A failure is kept on the work, not thrown, so the next work still runs. */
      async run(work: PostWork, body: () => Promise<Counted>): Promise<boolean> {
        if (halted()) {
          mark(work, { state: "skipped", reason: "stopped" })
          return false
        }
        mark(work, { state: "running" })
        try {
          const { count, dropped, skipped } = await body()
          // found only once it looked, as the graphics find a rough cut with no canvas: as good as switched off
          if (skipped !== undefined) mark(work, { state: "skipped", reason: "off" })
          else mark(work, { state: "done", count, dropped })
          return true
        } catch (error) {
          const message = messageOf(error)
          if (message === CANCELLED) stopped = true
          mark(work, { state: "failed", error: message })
          return false
        }
      },
      /**
       * How a work that goes through its things one by one says how far it has got (the graphics work, as each
       * graphic's writing ends): kept on its running state, and the screen told. A report that comes when the work
       * is not running, before it began or once it is over, is not taken.
       */
      progress:
        (work: PostWork) =>
        (done: number, total: number): void => {
          if (view.states[work]?.state === "running") mark(work, { state: "running", done, total })
        },
      /** A work that could not start, and why: the points on the cut could not be read. False, as for any failure; after a stop, it was stopped. */
      fail(work: PostWork, error: string): false {
        mark(work, halted() ? { state: "skipped", reason: "stopped" } : { state: "failed", error })
        return false
      },
      /** A work that does not run: its switch is off, or there is nothing for it to go on; after a stop, it was stopped. */
      skip(work: PostWork, reason: "off" | "no-emphasis"): void {
        mark(work, halted() ? { state: "skipped", reason: "stopped" } : { state: "skipped", reason })
      },
      end(): void {
        stop?.removeEventListener("abort", forward)
        view.running = false
        send({ type: "post-plan-finished", folder })
      },
    }
  }
  type Run = ReturnType<typeof begin>

  /** How a project's run stands, as a copy the caller cannot change. */
  function stateOf(folder: string): PostRunView | null {
    const view = runs.get(folder)
    return view ? { running: view.running, states: { ...view.states } } : null
  }

  /** The version of the points as they are stored now. */
  const versionNow = async (folder: string): Promise<number> => (await deps.outlines.get(folder))?.emphasis?.version ?? 0

  /**
   * Notes that a work planned on this version of the points, so the "จุดเน้นเปลี่ยน" banner goes; one that
   * cannot be noted leaves the banner up. Null says the work is behind whatever it planned on.
   */
  async function plannedOn(folder: string, work: "graphics" | "sounds", version: number | null): Promise<void> {
    await deps.outlines
      .update(folder, (latest) => {
        if (!latest) throw new Error("this project has no outline yet")
        const emphasis = latest.emphasis ?? EMPTY_EMPHASIS
        return { ...latest, emphasis: { ...emphasis, plannedOn: { ...emphasis.plannedOn, [work]: version } } }
      })
      .catch(() => {})
  }

  /**
   * Whether any point plays on the rough cut under the run's rules — the points alone, no preview — or why
   * that could not be read, which fails the works that needed it rather than passing for no points.
   */
  async function onCut(folder: string, request: PostRequest): Promise<OnCut> {
    try {
      return { points: (await deps.emphasis.placedCount(folder, request.rules)) > 0 }
    } catch (error) {
      return { error: messageOf(error) }
    }
  }

  /**
   * Work 2 in its three calls, in order: the text (2a), zooms and cutaways (2b), then graphics (2c),
   * which keep clear of the text just placed. A call switched off is skipped; with no point, all are; when
   * the points on the cut could not be read, each fails with why. With points on the cut, the version the
   * points had when it started is noted as planned on when none of the calls that ran failed or was
   * stopped — also when all three are off, since there is then nothing to think again and the
   * "จุดเน้นเปลี่ยน" banner must be able to go (a call switched off is never one a stop kept from running).
   * `afterText` is told once the text is over, however it ended. Answers whether any call ended done, so
   * put down or replaced what was there.
   */
  async function workTwo(folder: string, request: PostRequest, run: Run, cut: OnCut, afterText: () => void = () => {}): Promise<boolean> {
    const { view } = request
    const version = await versionNow(folder)
    const points = "points" in cut && cut.points
    const results: boolean[] = []
    const step = async (work: PostWork, on: boolean, body: () => Promise<Counted>) => {
      if (!on) return run.skip(work, "off")
      if ("error" in cut) return void results.push(run.fail(work, cut.error))
      if (!points) return run.skip(work, "no-emphasis")
      results.push(await run.run(work, body))
    }
    // the text is picked without the graphics: reading them would start renders work 2c is about to replace
    await step("text", view.highlightsOn, async () => {
      const { preview, dropped } = await deps.highlights.pick(folder, request.rules, { ...view, flair: { ...view.flair, graphic: false } }, run.signal)
      return { count: preview.groups.length, dropped }
    })
    afterText()
    await step("techniques", view.flair.zoom || view.flair.insert, () => deps.flair.planTechniques(folder, request, run.signal))
    await step("graphics", view.flair.graphic, () => deps.flair.planGraphics(folder, request, run.signal, run.progress("graphics")))
    if (points && results.every(Boolean)) await plannedOn(folder, "graphics", version)
    return run.done("text") || run.done("techniques") || run.done("graphics")
  }

  /** Work 4: the sounds, on the slots of what work 2 put down; noted as planned on as work 2 is, the sounds switched off included. */
  async function workFour(folder: string, request: PostRequest, run: Run, cut: OnCut): Promise<void> {
    const version = await versionNow(folder)
    const points = "points" in cut && cut.points
    if (!request.view.flair.sound) {
      run.skip("sounds", "off")
      // nothing to think again while the sounds are off: the banner that asks for it goes
      if (points) await plannedOn(folder, "sounds", version)
      return
    }
    if ("error" in cut) return void run.fail("sounds", cut.error)
    if (!points) return run.skip("sounds", "no-emphasis")
    if (await run.run("sounds", () => deps.flair.planSounds(folder, request, run.signal))) await plannedOn(folder, "sounds", version)
  }

  /** Work 5: the subtitles' polish, when subtitles are on and the polish is asked for. */
  function workFive(folder: string, request: PostRequest, run: Run): Promise<unknown> {
    const subtitles = request.subtitles
    if (subtitles === null || !subtitles.polish) {
      run.skip("subtitles", "off")
      return Promise.resolve()
    }
    return run.run("subtitles", async () => {
      const { count, accepted } = await deps.timeline.polishStored(folder, request.rules, subtitles.length, subtitles.hideUnderHighlights, run.signal)
      // a reply that did not fit leaves every line as it was: one answer Claude gave that could not be used
      return { count, dropped: accepted ? 0 : 1 }
    })
  }

  return {
    /** The run behind the one button (spec §5.1): emphasis; then text, techniques, graphics; then sounds; the subtitles' polish alongside. */
    async plan(folder: string, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, POST_WORKS)
      try {
        // the polish needs no one, unless the lines under the text are hidden: then it waits for the text. With
        // graphics on too it waits for the graphics work instead: a graphic written takes its point's text away,
        // which puts that text's words back in the lines, so the lines are not settled until the graphics are
        const waitsForText = request.subtitles?.hideUnderHighlights === true && request.view.highlightsOn
        const waitsForGraphics = waitsForText && request.view.flair.graphic
        let polishing: Promise<unknown> | null = waitsForText ? null : workFive(folder, request, run)
        const emphasis = await run.run("emphasis", () => deps.emphasis.plan(folder, request.rules, run.signal))
        // the points failed or there are none on the cut: works 2 and 4 do not start
        const cut: OnCut = emphasis ? await onCut(folder, request) : { points: false }
        await workTwo(folder, request, run, cut, () => {
          if (!waitsForGraphics) polishing ??= workFive(folder, request, run)
        })
        // work 2 is over, its graphics with it, however they ended
        polishing ??= workFive(folder, request, run)
        await workFour(folder, request, run, cut)
        await polishing
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /**
     * One work again on the points as they are ("graphics" runs text, techniques and graphics); the user's
     * own stays. Work 2 thought again may replace what the sounds sat on, so when any of its calls ended
     * done the sounds are behind: their banner asks for them to be thought again too.
     */
    async rethink(folder: string, work: RethinkWork, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, RETHOUGHT[work])
      try {
        if (work === "subtitles") await workFive(folder, request, run)
        else {
          const cut = await onCut(folder, request)
          if (work === "sounds") await workFour(folder, request, run, cut)
          else if (await workTwo(folder, request, run, cut)) await plannedOn(folder, "sounds", null)
        }
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /**
     * One motion graphic written again, as a run of the graphics work alone: refused while another run goes on the
     * project, stopped by the user's stop, and told to the screen as any work is, with how far it has got. Nothing
     * is planned, so the points are noted as planned on no more than they were, and the other works keep how they
     * stood. A graphic that cannot be written again (it has no place on the rough cut now) fails the work with why.
     */
    async redoGraphic(folder: string, anchor: CueAnchor, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, ["graphics"])
      try {
        await run.run("graphics", () => deps.flair.redoGraphic(folder, anchor, request, run.signal, run.progress("graphics")))
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /**
     * One written motion graphic changed as the user asks (`instruction`), as a run of the graphics work alone, as a
     * graphic written again is: refused while another run goes on the project, stopped by the user's stop, and told
     * to the screen with how far it has got. Nothing is planned and the other works keep how they stood. A graphic
     * that cannot be edited (no place on the rough cut now, or no fragment yet) fails the work with why.
     */
    async editGraphic(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, ["graphics"])
      try {
        await run.run("graphics", () => deps.flair.editGraphic(folder, anchor, instruction, request, run.signal, run.progress("graphics")))
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /**
     * One step back on a graphic. It asks no Claude and is no run, so the screen is told nothing, but it is refused
     * while a run goes on the project, whose writing would store over it or keep what it swapped away.
     */
    async undoGraphic(folder: string, anchor: CueAnchor): Promise<void> {
      refuseWhileRunning(folder)
      await deps.flair.undoGraphic(folder, anchor)
    },

    /** The points alone, with the same events (the planEmphasis API); a failure is thrown once the events are sent. */
    async emphasisOnly(folder: string, rules: CutRules): Promise<Counted> {
      const run = begin(folder, ["emphasis"])
      const outcome: { counted?: Counted; failure?: unknown } = {}
      try {
        await run.run("emphasis", async () => {
          try {
            outcome.counted = await deps.emphasis.plan(folder, rules, run.signal)
            return outcome.counted
          } catch (error) {
            outcome.failure = error
            throw error
          }
        })
      } finally {
        run.end()
      }
      if (outcome.counted === undefined) throw outcome.failure instanceof Error ? outcome.failure : new Error(messageOf(outcome.failure))
      return outcome.counted
    },

    /** How the run of this project stands, or how the last one ended; null when none ran since the app started. */
    state: stateOf,
  }
}

export type PostPlanService = ReturnType<typeof createPostPlanService>
