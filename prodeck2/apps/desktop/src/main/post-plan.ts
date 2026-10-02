import type { CutRules } from "@boxblack/core/cut"
import { EMPTY_EMPHASIS } from "@boxblack/core/emphasis/types"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import { isComposed } from "@boxblack/core/sound/spec"
import { POST_WORKS, type AppEvent, type MoveAnchor, type PostRequest, type PostRunView, type PostWork, type PostWorkState, type RethinkWork } from "../shared/api.ts"
import { CANCELLED } from "./ai-calls.ts"
import type { EmphasisService } from "./emphasis.ts"
import type { FlairService } from "./flair.ts"
import type { HighlightService } from "./highlights.ts"
import type { OutlineStore } from "./planner.ts"
import { samePlace } from "./sound-cues.ts"
import type { TimelineService } from "./timeline.ts"

export interface PostPlanDeps {
  outlines: OutlineStore
  emphasis: Pick<EmphasisService, "plan" | "placedCount">
  highlights: Pick<HighlightService, "pick">
  flair: Pick<FlairService, "planTechniques" | "planGraphics" | "planSounds" | "redoGraphic" | "editGraphic" | "undoGraphic" | "redoMove" | "editMove" | "undoMove" | "soundsAfterGraphic" | "redoSound" | "editSound" | "undoSound">
  timeline: Pick<TimelineService, "polishStored">
  send?: (event: AppEvent) => void
  /** the signal the next stop of the editing room's Claude calls aborts, read as a run starts: a stop pressed between two works ends the run too */
  stopSignal?: () => AbortSignal
}

/** What a work answers: how many things it put down, and how many of Claude's it could not use; `skipped` when it found it had nothing to draw on (graphics with no canvas). */
type Counted = { count: number; dropped: number; skipped?: "no-canvas" }

/** The works each rethink runs; the points go through emphasisOnly. */
const RETHOUGHT: Record<RethinkWork, readonly PostWork[]> = { techniques: ["techniques", "text"], graphics: ["graphics"], sounds: ["sounds"], subtitles: ["subtitles"] }

/** The two parts of work 2 a run may think: the moves and cutaways with the text (2b and 2a), and the graphics (2c). */
type WorkTwoParts = { techniques: boolean; graphics: boolean }
const ALL_OF_TWO: WorkTwoParts = { techniques: true, graphics: true }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Whether any point plays on the rough cut now — works 2 and 4 have nothing to go on without one — or why that could not be read. */
type OnCut = { points: boolean } | { error: string }

export function createPostPlanService(deps: PostPlanDeps) {
  const send = deps.send ?? (() => {})
  /** each project's run as it stands, or as the last one ended, since the app started */
  const runs = new Map<string, PostRunView>()
  /** the projects a step back is being stored on now */
  const undoing = new Set<string>()
  /** the projects a graphic's run is being readied on now: the works it will touch are being read from the outline */
  const readying = new Set<string>()

  /**
   * Refuses what may not happen while a run goes on the project, or while a step back is being stored on it: a run,
   * or a step back. A run begun during a step back would write over the fragment going back and keep the wrong one.
   */
  function refuseWhileRunning(folder: string): void {
    if (runs.get(folder)?.running || undoing.has(folder) || readying.has(folder)) throw new Error("a plan for this project is already running")
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
       * graphic's writing ends; the sounds work, as each sound's composing ends): kept on its running state, and the
       * screen told. A report that comes when the work is not running, before it began or once it is over, is not taken.
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
   * cannot be noted leaves the banner up. Null says the work is behind whatever it planned on. On an outline from
   * before 0.7.0, which noted the text and techniques with the graphics, that note is kept for them first, so noting
   * another work leaves their banner as it was.
   */
  async function plannedOn(folder: string, work: "techniques" | "graphics" | "sounds", version: number | null): Promise<void> {
    await deps.outlines
      .update(folder, (latest) => {
        if (!latest) throw new Error("this project has no outline yet")
        const emphasis = latest.emphasis ?? EMPTY_EMPHASIS
        const was = emphasis.plannedOn
        // an outline from before 0.7.0 noted the text and techniques with the graphics: that note is theirs from now on
        const carried = { ...was, techniques: was.techniques === undefined ? was.graphics : was.techniques }
        return { ...latest, emphasis: { ...emphasis, plannedOn: { ...carried, [work]: version } } }
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
   * Work 2 in its three calls, in order: the moves and cutaways (2b), then the text (2a), which keeps off the faces
   * where the moves take them, then graphics (2c), which keep clear of the text just placed; `parts` says which of
   * them this run thinks, the techniques with the text, the graphics, or all three. A call switched off is skipped; with no point, all are; when
   * the points on the cut could not be read, each fails with why. With points on the cut, the version the
   * points had when it started is noted as planned on, for each part the run thinks, when none of that part's calls
   * that ran failed or was stopped, also when all are off, since there is then nothing to think again and the
   * "จุดเน้นเปลี่ยน" banner must be able to go (a call switched off is never one a stop kept from running).
   * `afterText` is told once the text is over, however it ended; `graphicsStored` once the graphics are planned and
   * stored, before they are written, when the graphics work gets that far. Answers whether any call ended done, so
   * put down or replaced what was there.
   */
  async function workTwo(
    folder: string,
    request: PostRequest,
    run: Run,
    cut: OnCut,
    parts: WorkTwoParts,
    afterText: () => void = () => {},
    graphicsStored?: () => void,
  ): Promise<boolean> {
    const { view } = request
    const version = await versionNow(folder)
    const points = "points" in cut && cut.points
    // how each call that ran ended, by the part of work 2 it belongs to
    const results: Record<"techniques" | "graphics", boolean[]> = { techniques: [], graphics: [] }
    const step = async (work: PostWork, on: boolean, body: () => Promise<Counted>) => {
      const part = work === "graphics" ? results.graphics : results.techniques
      if (!on) return run.skip(work, "off")
      if ("error" in cut) return void part.push(run.fail(work, cut.error))
      if (!points) return run.skip(work, "no-emphasis")
      part.push(await run.run(work, body))
    }
    if (parts.techniques) {
      await step("techniques", view.flair.zoom || view.flair.insert, () => deps.flair.planTechniques(folder, request, run.signal))
      // the text is picked without the graphics: reading them would start renders work 2c is about to replace
      await step("text", view.highlightsOn, async () => {
        const { preview, dropped } = await deps.highlights.pick(folder, request.rules, { ...view, flair: { ...view.flair, graphic: false } }, run.signal)
        return { count: preview.groups.length, dropped }
      })
      afterText()
    }
    if (parts.graphics) {
      const graphics = () =>
        graphicsStored
          ? deps.flair.planGraphics(folder, request, run.signal, run.progress("graphics"), graphicsStored)
          : deps.flair.planGraphics(folder, request, run.signal, run.progress("graphics"))
      await step("graphics", view.flair.graphic, graphics)
    }
    if (points && parts.techniques && results.techniques.every(Boolean)) await plannedOn(folder, "techniques", version)
    if (points && parts.graphics && results.graphics.every(Boolean)) await plannedOn(folder, "graphics", version)
    return (parts.techniques && (run.done("text") || run.done("techniques"))) || (parts.graphics && run.done("graphics"))
  }

  /**
   * Work 4: the sounds, planned on what work 2 put down and composed one by one, saying how far the composing has got;
   * noted as planned on as work 2 is, the sounds switched off included. `drawing` is the graphics' writing when work 4
   * runs beside it, which the sounds tied to a graphic not written yet wait for.
   */
  async function workFour(folder: string, request: PostRequest, run: Run, cut: OnCut, drawing?: Promise<void>): Promise<void> {
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
    const sounds = () =>
      drawing ? deps.flair.planSounds(folder, request, run.signal, run.progress("sounds"), drawing) : deps.flair.planSounds(folder, request, run.signal, run.progress("sounds"))
    if (await run.run("sounds", sounds)) await plannedOn(folder, "sounds", version)
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

  /**
   * The works of a run that writes the graphic at `anchor` again or edits it: the graphics work, and the sounds work
   * too when the sounds are on and the stored outline has a composed sound tied to that graphic, which the run then
   * composes again. Otherwise the sounds work is not touched and keeps how it stood. An outline that cannot be read
   * ties no sound. It is refused as a run is, and while it reads the project is held as a run would hold it, so
   * nothing slips in before the run begins.
   */
  async function graphicWorks(folder: string, anchor: CueAnchor, request: PostRequest): Promise<readonly PostWork[]> {
    refuseWhileRunning(folder)
    if (!request.view.flair.sound) return ["graphics"]
    readying.add(folder)
    try {
      const stored = await deps.outlines.get(folder).catch(() => null)
      const tied = (stored?.flair?.composed ?? []).some((sound) => isComposed(sound) && sound.graphic !== undefined && samePlace(sound.graphic, anchor))
      return tied ? ["graphics", "sounds"] : ["graphics"]
    } finally {
      readying.delete(folder)
    }
  }

  /**
   * The graphics work of a graphic written again or edited, then, when the run has it (`graphicWorks`), the sounds work
   * on the sounds tied to it (spec §11): once the graphic is stored written, each sound tied to it is composed again to
   * its new fragment, saying how far that has got. A graphic whose writing failed, or that could not be written,
   * touches no sound: the sounds work then ends with nothing done. After a stop the sounds work is skipped as stopped.
   */
  async function graphicThenSounds(folder: string, anchor: CueAnchor, request: PostRequest, works: readonly PostWork[], write: (run: Run) => Promise<Counted>): Promise<PostRunView> {
    const run = begin(folder, works)
    try {
      let written = false
      await run.run("graphics", async () => {
        const counted = await write(run)
        written = counted.count > 0
        return counted
      })
      if (works.includes("sounds")) await run.run("sounds", async () => (written ? deps.flair.soundsAfterGraphic(folder, anchor, request, run.signal, run.progress("sounds")) : { count: 0, dropped: 0 }))
    } finally {
      run.end()
    }
    return stateOf(folder)!
  }

  /**
   * A step back taken on the project, which asks no Claude and is no run: refused while a run goes on the project,
   * whose writing would store over it or keep what it swapped away; and while it is being stored, no run of the
   * project begins and no second step back, of a graphic or a sound, is taken. The project is let go once it is
   * stored, or has failed.
   */
  async function steppingBack(folder: string, step: () => Promise<void>): Promise<void> {
    refuseWhileRunning(folder)
    undoing.add(folder)
    try {
      await step()
    } finally {
      undoing.delete(folder)
    }
  }

  return {
    /**
     * The run behind the one button (spec §5.1): emphasis; then techniques, text, graphics; then sounds; the subtitles'
     * polish alongside. The sounds start as soon as the graphics are planned and stored, and are planned and composed
     * while the graphics are written, the two works running side by side; with the graphics off, or a graphics work
     * that ends before it stores any, they start once it is over, as before.
     */
    async plan(folder: string, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, POST_WORKS)
      // the works started beside another, which the run waits for before it is over, however the rest ended
      let polishing: Promise<unknown> | null = null
      let sounding: Promise<void> | null = null
      try {
        // the polish needs no one, unless the lines under the text are hidden: then it waits for the text. With
        // graphics on too it waits for the graphics work instead: a graphic written takes its point's text away,
        // which puts that text's words back in the lines, so the lines are not settled until the graphics are
        const waitsForText = request.subtitles?.hideUnderHighlights === true && request.view.highlightsOn
        const waitsForGraphics = waitsForText && request.view.flair.graphic
        if (!waitsForText) polishing = workFive(folder, request, run)
        const emphasis = await run.run("emphasis", () => deps.emphasis.plan(folder, request.rules, run.signal))
        // the points failed or there are none on the cut: works 2 and 4 do not start
        const cut: OnCut = emphasis ? await onCut(folder, request) : { points: false }
        // the graphics' writing, which the sounds started beside it wait on: it settles once work 2 is over
        let drawn!: () => void
        const drawing = new Promise<void>((resolve) => (drawn = resolve))
        try {
          await workTwo(
            folder,
            request,
            run,
            cut,
            ALL_OF_TWO,
            () => {
              if (!waitsForGraphics) polishing ??= workFive(folder, request, run)
            },
            () => {
              sounding = workFour(folder, request, run, cut, drawing)
              // awaited below; held here so that it does not fail unheard meanwhile
              sounding.catch(() => {})
            },
          )
        } finally {
          drawn()
        }
        // work 2 is over, its graphics with it, however they ended
        polishing ??= workFive(folder, request, run)
        await ((sounding as Promise<void> | null) ?? workFour(folder, request, run, cut))
        await polishing
      } finally {
        await Promise.allSettled([sounding as Promise<void> | null, polishing as Promise<unknown> | null].filter((work) => work !== null))
        run.end()
      }
      return stateOf(folder)!
    },

    /**
     * One work again on the points as they are ("techniques" runs the moves and cutaways and then the text, "graphics" the
     * graphics alone); the user's own stays. Work 2 thought again may replace what the sounds sat on, so when any of
     * its calls ended done the sounds are behind: their banner asks for them to be thought again too.
     */
    async rethink(folder: string, work: RethinkWork, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, RETHOUGHT[work])
      try {
        if (work === "subtitles") await workFive(folder, request, run)
        else {
          const cut = await onCut(folder, request)
          if (work === "sounds") await workFour(folder, request, run, cut)
          else if (await workTwo(folder, request, run, cut, { techniques: work === "techniques", graphics: work === "graphics" })) await plannedOn(folder, "sounds", null)
        }
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /**
     * One motion graphic written again, as a run of the graphics work, then the sounds tied to it composed again to
     * what it now draws when it has any (`graphicWorks`, `graphicThenSounds`): refused while another run goes on the project, stopped by the user's
     * stop, and told to the screen as any work is, with how far it has got. Nothing is planned, so the points are
     * noted as planned on no more than they were, and the other works keep how they stood. A graphic that cannot be
     * written again (it has no place on the rough cut now) fails the graphics work with why.
     */
    async redoGraphic(folder: string, anchor: CueAnchor, request: PostRequest): Promise<PostRunView> {
      const works = await graphicWorks(folder, anchor, request)
      return graphicThenSounds(folder, anchor, request, works, (run) => deps.flair.redoGraphic(folder, anchor, request, run.signal, run.progress("graphics")))
    },

    /**
     * One written motion graphic changed as the user asks (`instruction`), as a run of the graphics work and then the
     * sounds tied to it, as a graphic written again is: refused while another run goes on the project, stopped by the
     * user's stop, and told to the screen with how far it has got. Nothing is planned and the other works keep how
     * they stood. A graphic that cannot be edited (no place on the rough cut now, or no fragment yet) fails the
     * graphics work with why; an edit that failed keeps the fragment it had, and touches no sound.
     */
    async editGraphic(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest): Promise<PostRunView> {
      const works = await graphicWorks(folder, anchor, request)
      return graphicThenSounds(folder, anchor, request, works, (run) => deps.flair.editGraphic(folder, anchor, instruction, request, run.signal, run.progress("graphics")))
    },

    /**
     * One step back on a graphic. It asks no Claude and is no run, so the screen is told nothing, but it is refused
     * while a run goes on the project, whose writing would store over it or keep what it swapped away; and while it is
     * being stored, no run of the project begins and no second step back is taken. The project is let go once it is
     * stored, or has failed.
     */
    undoGraphic: (folder: string, anchor: CueAnchor): Promise<void> => steppingBack(folder, () => deps.flair.undoGraphic(folder, anchor)),

    /**
     * One move of the picture designed again by Claude, as a run of the techniques work alone: refused while another
     * run goes on the project, stopped by the user's stop, and told to the screen as any work is, with how far it has
     * got. The text is not placed again and nothing is planned, so the points are noted as planned on no more than
     * they were, and the other works keep how they stood. A move with no place on the rough cut now fails the work.
     */
    async redoMove(folder: string, anchor: MoveAnchor, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, ["techniques"])
      try {
        await run.run("techniques", () => deps.flair.redoMove(folder, anchor, request, run.signal, run.progress("techniques")))
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /** One move of the picture changed by Claude as the user asks (`instruction`), as a run of the techniques work alone, as a move designed again is. */
    async editMove(folder: string, anchor: MoveAnchor, instruction: string, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, ["techniques"])
      try {
        await run.run("techniques", () => deps.flair.editMove(folder, anchor, instruction, request, run.signal, run.progress("techniques")))
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /** One step back on a move, held as a graphic's is (`steppingBack`): no run, and the screen is told nothing. */
    undoMove: (folder: string, anchor: MoveAnchor): Promise<void> => steppingBack(folder, () => deps.flair.undoMove(folder, anchor)),

    /**
     * One composed sound composed again, as a run of the sounds work alone: refused while another run goes on the
     * project, stopped by the user's stop, and told to the screen with how far it has got. Nothing is planned and the
     * other works keep how they stood. A sound that cannot be composed again (no place on the rough cut now) fails the
     * work with why.
     */
    async redoSound(folder: string, anchor: CueAnchor, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, ["sounds"])
      try {
        await run.run("sounds", () => deps.flair.redoSound(folder, anchor, request, run.signal, run.progress("sounds")))
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /**
     * One written composed sound changed as the user asks (`instruction`), as a run of the sounds work alone, as a
     * sound composed again is. A sound that cannot be edited (no place now, or not written yet) fails the work with why.
     */
    async editSound(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest): Promise<PostRunView> {
      const run = begin(folder, ["sounds"])
      try {
        await run.run("sounds", () => deps.flair.editSound(folder, anchor, instruction, request, run.signal, run.progress("sounds")))
      } finally {
        run.end()
      }
      return stateOf(folder)!
    },

    /** One step back on a composed sound, held as a graphic's is (`steppingBack`): no run, and the screen is told nothing. */
    undoSound: (folder: string, anchor: CueAnchor): Promise<void> => steppingBack(folder, () => deps.flair.undoSound(folder, anchor)),

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
