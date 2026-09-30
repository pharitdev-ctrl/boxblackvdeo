import { expect, test } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import { POST_WORKS, type AppEvent, type HighlightPreview, type PostRequest, type PostWork, type StoredOutline } from "../shared/api.ts"
import { CANCELLED } from "./ai-calls.ts"
import type { OutlineStore } from "./planner.ts"
import { createPostPlanService, type PostPlanDeps } from "./post-plan.ts"

const FLAIR = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: true }
const REQUEST: PostRequest = {
  rules: DEFAULT_CUT_RULES,
  view: { position: "auto", subtitlesOn: true, highlightsOn: true, flair: FLAIR },
  subtitles: { length: "short", polish: true, hideUnderHighlights: false },
}
const done = (count: number, dropped: number) => ({ state: "done" as const, count, dropped })

/**
 * Projects whose works answer at once and write down the order they ran in, and what each was handed
 * after the folder. Each outline holds points at version 4, planned on by neither work; `points` says how
 * many play on the cut.
 */
function harness(points = 2) {
  const order: string[] = []
  const events: AppEvent[] = []
  const handed = new Map<string, unknown[]>()
  const counted: unknown[][] = []
  const stores = new Map<string, StoredOutline>()
  const storeOf = (folder: string) =>
    stores.get(folder) ?? ({ folder, emphasis: { points: [], version: 4, plannedOn: { graphics: null, sounds: null }, transcripts: {} } } as unknown as StoredOutline)
  const outlines = {
    get: async (folder: string) => storeOf(folder),
    update: async (folder: string, change: (latest: StoredOutline | null) => StoredOutline) => {
      const next = change(storeOf(folder))
      stores.set(folder, next)
      return next
    },
  } as unknown as OutlineStore
  const ran =
    (name: string, answer: { count: number; dropped: number }) =>
    async (_folder: string, ...args: unknown[]) => {
      order.push(name)
      handed.set(name, args)
      return answer
    }
  const deps: PostPlanDeps = {
    outlines,
    emphasis: {
      plan: ran("emphasis", { count: 3, dropped: 1 }),
      placedCount: async (...args) => {
        counted.push(args)
        return points
      },
    },
    highlights: {
      pick: async (_folder, ...args) => {
        order.push("text")
        handed.set("text", args)
        return { preview: { groups: [{}, {}] } as unknown as HighlightPreview, dropped: 1 }
      },
    },
    flair: {
      planTechniques: ran("techniques", { count: 2, dropped: 0 }),
      planGraphics: ran("graphics", { count: 1, dropped: 1 }),
      planSounds: ran("sounds", { count: 4, dropped: 0 }),
      redoGraphic: ran("redo", { count: 1, dropped: 0 }),
      editGraphic: ran("edit", { count: 1, dropped: 0 }),
      undoGraphic: async (folder, anchor) => void order.push(`undo ${folder} ${anchor.kind}`),
    },
    timeline: {
      polishStored: async (_folder, ...args) => {
        order.push("subtitles")
        handed.set("subtitles", args)
        return { count: 2, accepted: true }
      },
    },
    send: (event) => events.push(event),
  }
  /** What the screen was told about one work of a project, in order. */
  const told = (work: PostWork, folder = "/p") =>
    events.flatMap((event) => (event.type === "post-plan" && event.folder === folder && event.work === work ? [event.state.state] : []))
  /** Changes a project's points as the emphasis tab would: their version goes up. */
  const bump = (folder: string, version: number) => {
    const stored = storeOf(folder)
    stores.set(folder, { ...stored, emphasis: { ...stored.emphasis!, version } })
  }
  return { deps, order, events, handed, counted, told, bump, plannedOn: (folder = "/p") => storeOf(folder).emphasis!.plannedOn }
}

test("the one button plans the points, then the text, the zooms and cutaways and the graphics, then the sounds, with the subtitles' polish alongside", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  expect(await post.plan("/p", REQUEST)).toEqual({
    running: false,
    states: { emphasis: done(3, 1), text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1), sounds: done(4, 0), subtitles: done(2, 0) },
  })
  expect(h.order).toEqual(["subtitles", "emphasis", "text", "techniques", "graphics", "sounds"])
  // the screen hears of every work it will fill before any starts, then of each as it runs and ends, then that the run is over
  expect(h.events.slice(0, 6)).toEqual(POST_WORKS.map((work) => ({ type: "post-plan", folder: "/p", work, state: { state: "waiting" } })))
  expect(h.told("techniques")).toEqual(["waiting", "running", "done"])
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
  // works 2 and 4 planned on the points as they were: the "จุดเน้นเปลี่ยน" banner goes
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
})

test("a work switched off is skipped and not asked", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  const quiet: PostRequest = { ...REQUEST, view: { ...REQUEST.view, highlightsOn: false, flair: { ...FLAIR, zoom: false, insert: false, sound: false } }, subtitles: null }
  const { states } = await post.plan("/p", quiet)
  expect(h.order).toEqual(["emphasis", "graphics"])
  const off = { state: "skipped", reason: "off" }
  expect(states).toMatchObject({ text: off, techniques: off, graphics: done(1, 1), sounds: off, subtitles: off })
  // the sounds are off, so there is nothing of theirs to think again: the banner goes for them too
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
  // either of the zooms and the cutaways is enough for work 2b to be asked
  h.order.length = 0
  await post.plan("/p", { ...quiet, view: { ...quiet.view, flair: { ...quiet.view.flair, insert: true } } })
  expect(h.order).toEqual(["emphasis", "techniques", "graphics"])
})

test("with all of work 2 switched off, thinking it again asks nothing but still notes the points as planned on", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  const allOff: PostRequest = { ...REQUEST, view: { ...REQUEST.view, highlightsOn: false, flair: { ...FLAIR, zoom: false, insert: false, graphic: false } } }
  const off = { state: "skipped", reason: "off" }
  expect((await post.rethink("/p", "graphics", allOff)).states).toEqual({ text: off, techniques: off, graphics: off })
  expect(h.order).toEqual([])
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: null })
})

test("with no point on the cut, work 2 all switched off notes nothing", async () => {
  const h = harness(0)
  const allOff: PostRequest = { ...REQUEST, view: { ...REQUEST.view, highlightsOn: false, flair: { ...FLAIR, zoom: false, insert: false, graphic: false, sound: false } } }
  await createPostPlanService(h.deps).plan("/p", allOff)
  expect(h.plannedOn()).toEqual({ graphics: null, sounds: null })
})

test("graphics that find no canvas to draw on show as skipped, not done, and do not keep work 2 from counting as planned", async () => {
  const h = harness()
  h.deps.flair.planGraphics = async () => {
    h.order.push("graphics")
    return { count: 0, dropped: 0, skipped: "no-canvas" as const }
  }
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(states.graphics).toEqual({ state: "skipped", reason: "off" })
  expect(h.told("graphics")).toEqual(["waiting", "running", "skipped"])
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
})

test("points that fail keep works 2 and 4 from starting, but not the subtitles' polish", async () => {
  const h = harness()
  h.deps.emphasis.plan = async () => {
    h.order.push("emphasis")
    throw new Error("Claude is busy")
  }
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(h.order).toEqual(["subtitles", "emphasis"])
  const none = { state: "skipped", reason: "no-emphasis" }
  expect(states).toEqual({ emphasis: { state: "failed", error: "Claude is busy" }, text: none, techniques: none, graphics: none, sounds: none, subtitles: done(2, 0) })
  expect(h.plannedOn()).toEqual({ graphics: null, sounds: null })
})

test("with no point on the cut, works 2 and 4 have nothing to go on", async () => {
  const h = harness(0)
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(h.order).toEqual(["subtitles", "emphasis"])
  expect(states.emphasis).toEqual(done(3, 1))
  expect(states.sounds).toEqual({ state: "skipped", reason: "no-emphasis" })
})

test("the points are counted on the cut under the run's rules, the points alone: no preview is made for it", async () => {
  const h = harness()
  await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(h.counted).toEqual([["/p", REQUEST.rules]])
})

test("a work that fails does not stop the next, and work 2 counts as planned only when none of its calls failed", async () => {
  const h = harness()
  h.deps.flair.planTechniques = async () => {
    throw new Error("the pictures cannot be read")
  }
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(states.techniques).toEqual({ state: "failed", error: "the pictures cannot be read" })
  expect(h.order).toEqual(["subtitles", "emphasis", "text", "graphics", "sounds"])
  expect(h.plannedOn()).toEqual({ graphics: null, sounds: 4 })
})

test("Stop during a work fails it as cancelled and skips the rest as stopped; the run still ends and says so", async () => {
  const h = harness()
  h.deps.flair.planGraphics = async () => {
    throw new Error(CANCELLED)
  }
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(states.graphics).toEqual({ state: "failed", error: CANCELLED })
  expect(states.sounds).toEqual({ state: "skipped", reason: "stopped" })
  expect(h.order).not.toContain("sounds")
  expect(h.plannedOn()).toEqual({ graphics: null, sounds: null })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
})

test("Stop pressed between two works ends the run too", async () => {
  const h = harness()
  const stop = new AbortController()
  h.deps.stopSignal = () => stop.signal
  h.deps.flair.planTechniques = async () => {
    // the call itself had answered; the user pressed stop before the next one began
    stop.abort()
    return { count: 1, dropped: 0 }
  }
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(states.techniques).toEqual(done(1, 0))
  expect(states.graphics).toEqual({ state: "skipped", reason: "stopped" })
  expect(states.sounds).toEqual({ state: "skipped", reason: "stopped" })
  expect(h.order).not.toContain("graphics")
})

test("one run a project at a time, and how it stands can be read while it goes and after", async () => {
  const h = harness()
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  h.deps.emphasis.plan = async () => {
    await gate
    return { count: 1, dropped: 0 }
  }
  const post = createPostPlanService(h.deps)
  expect(post.state("/p")).toBeNull()
  const first = post.plan("/p", REQUEST)
  expect(post.state("/p")).toMatchObject({ running: true, states: { emphasis: { state: "running" }, sounds: { state: "waiting" } } })
  await expect(post.plan("/p", REQUEST)).rejects.toThrow("a plan for this project is already running")
  await expect(post.rethink("/p", "sounds", REQUEST)).rejects.toThrow("a plan for this project is already running")
  await expect(post.emphasisOnly("/p", DEFAULT_CUT_RULES)).rejects.toThrow("a plan for this project is already running")
  release()
  await first
  expect(post.state("/p")).toMatchObject({ running: false, states: { emphasis: done(1, 0), sounds: done(4, 0) } })
})

test("thinking again runs only that work: graphics are work 2's three calls, sounds the sounds, subtitles the polish", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  expect(await post.rethink("/p", "graphics", REQUEST)).toEqual({ running: false, states: { text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1) } })
  expect(h.order).toEqual(["text", "techniques", "graphics"])
  expect(h.told("sounds")).toEqual([])
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: null })
  h.order.length = 0
  // each answer keeps how the works it did not touch last stood
  expect((await post.rethink("/p", "sounds", REQUEST)).states).toEqual({ text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1), sounds: done(4, 0) })
  expect((await post.rethink("/p", "subtitles", REQUEST)).states).toEqual({ text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1), sounds: done(4, 0), subtitles: done(2, 0) })
  expect(h.order).toEqual(["sounds", "subtitles"])
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
})

test("thinking one work again keeps a failure of another where the screen can still read it", async () => {
  const h = harness()
  h.deps.flair.planTechniques = async () => {
    throw new Error("the pictures cannot be read")
  }
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  const { states } = await post.rethink("/p", "sounds", REQUEST)
  expect(states.techniques).toEqual({ state: "failed", error: "the pictures cannot be read" })
  expect(states.sounds).toEqual(done(4, 0))
  expect(post.state("/p")!.states.emphasis).toEqual(done(3, 1))
  // the run tells the screen only of the work it touches
  expect(h.events.filter((event) => event.type === "post-plan").slice(-3).map((event) => event.type === "post-plan" && event.work)).toEqual(["sounds", "sounds", "sounds"])
})

test("the polish waits for the text when it leaves out the words shown as text, and for the graphics when they are on too, since a graphic written takes its point's text away", async () => {
  const hiding: PostRequest = { ...REQUEST, subtitles: { length: "short", polish: true, hideUnderHighlights: true } }
  const orderOf = async (request: PostRequest, change: (deps: PostPlanDeps) => void = () => {}) => {
    const h = harness()
    change(h.deps)
    await createPostPlanService(h.deps).plan("/p", request)
    return h.order
  }
  // with the graphics off the lines are settled once the text is
  expect(await orderOf({ ...hiding, view: { ...hiding.view, flair: { ...FLAIR, graphic: false } } })).toEqual(["emphasis", "text", "subtitles", "techniques", "sounds"])
  // with them on, the lines change as graphics are written: the polish starts once the graphics work is over
  expect(await orderOf(hiding)).toEqual(["emphasis", "text", "techniques", "graphics", "subtitles", "sounds"])
  // however that work ended
  const failing = (deps: PostPlanDeps) => {
    deps.flair.planGraphics = async () => {
      throw new Error("Claude is unreachable")
    }
  }
  expect(await orderOf(hiding, failing)).toEqual(["emphasis", "text", "techniques", "subtitles", "sounds"])
  // a graphics work that was stopped ended the run: the polish that waited for it is stopped with it, and is not asked
  const stopped = harness()
  stopped.deps.flair.planGraphics = async () => {
    throw new Error(CANCELLED)
  }
  const { states } = await createPostPlanService(stopped.deps).plan("/p", hiding)
  expect(stopped.order).toEqual(["emphasis", "text", "techniques"])
  expect(states).toMatchObject({ graphics: { state: "failed", error: CANCELLED }, subtitles: { state: "skipped", reason: "stopped" }, sounds: { state: "skipped", reason: "stopped" } })
  // and when the points failed, so that no graphic is planned at all, it still runs
  const pointless = (deps: PostPlanDeps) => {
    deps.emphasis.plan = async () => {
      throw new Error("Claude is unreachable")
    }
  }
  expect(await orderOf(hiding, pointless)).toEqual(["subtitles"])
  // with the text off nothing is hidden under it, whatever the switch says: the polish needs no one
  expect(await orderOf({ ...hiding, view: { ...hiding.view, highlightsOn: false } })).toEqual(["subtitles", "emphasis", "techniques", "graphics", "sounds"])
  // and lines that hide nothing wait for no one, graphics on or not
  expect(await orderOf(REQUEST)).toEqual(["subtitles", "emphasis", "text", "techniques", "graphics", "sounds"])
})

test("a polish whose reply did not fit changes no line and counts one answer it could not use", async () => {
  const h = harness()
  h.deps.timeline.polishStored = async () => ({ count: 0, accepted: false })
  expect((await createPostPlanService(h.deps).rethink("/p", "subtitles", REQUEST)).states).toEqual({ subtitles: done(0, 1) })
})

test("the points alone answer how many there are; a failure is thrown once the screen has been told", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  expect(await post.emphasisOnly("/p", DEFAULT_CUT_RULES)).toEqual({ count: 3, dropped: 1 })
  expect(h.told("emphasis")).toEqual(["waiting", "running", "done"])
  expect(h.told("text")).toEqual([])
  h.deps.emphasis.plan = async () => {
    throw new Error("Claude is busy")
  }
  await expect(post.emphasisOnly("/p", DEFAULT_CUT_RULES)).rejects.toThrow("Claude is busy")
  expect(post.state("/p")).toEqual({ running: false, states: { emphasis: { state: "failed", error: "Claude is busy" } } })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
})

test("a points check that cannot be made fails works 2 and 4 with its reason, not as having no points; the polish still runs", async () => {
  const h = harness()
  h.deps.emphasis.placedCount = async () => {
    throw new Error("the draft cannot be read")
  }
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  const failed = { state: "failed", error: "the draft cannot be read" }
  expect(states).toEqual({ emphasis: done(3, 1), text: failed, techniques: failed, graphics: failed, sounds: failed, subtitles: done(2, 0) })
  expect(h.order).toEqual(["subtitles", "emphasis"])
  expect(h.plannedOn()).toEqual({ graphics: null, sounds: null })
  // a work switched off is still only off
  const off = harness()
  off.deps.emphasis.placedCount = h.deps.emphasis.placedCount
  expect((await createPostPlanService(off.deps).plan("/p", { ...REQUEST, view: { ...REQUEST.view, flair: { ...FLAIR, sound: false } } })).states.sounds).toEqual({ state: "skipped", reason: "off" })
})

test("the text is picked without the graphics, whose renders work 2c is about to replace; the rest of the view is as asked", async () => {
  const h = harness()
  await createPostPlanService(h.deps).plan("/p", REQUEST)
  const [rules, view] = h.handed.get("text")!
  expect(rules).toEqual(REQUEST.rules)
  expect(view).toEqual({ ...REQUEST.view, flair: { ...FLAIR, graphic: false } })
  // the graphics call itself is asked with them on
  expect(h.handed.get("graphics")![0]).toEqual(REQUEST)
})

test("every work is handed the run's own stop, which a Stop aborts as the user's stop", async () => {
  const h = harness()
  const stop = new AbortController()
  h.deps.stopSignal = () => stop.signal
  let seen: AbortSignal | undefined
  h.deps.flair.planSounds = async (_folder, _request, signal) => {
    // the user presses Stop while the sounds are planned
    stop.abort()
    seen = signal
    return { count: 1, dropped: 0 }
  }
  await createPostPlanService(h.deps).plan("/p", REQUEST)
  // the graphics work is handed a way to report how far it has got after the stop
  const signals = ["emphasis", "text", "techniques", "graphics", "subtitles"].map((work) => h.handed.get(work)!.find((handed) => handed instanceof AbortSignal))
  expect(seen).toBeInstanceOf(AbortSignal)
  expect(new Set([...signals, seen]).size).toBe(1)
  expect(seen!.aborted).toBe(true)
  // read by a Claude call as the stop it is, not as a failure of its own
  expect((seen!.reason as Error).message).toBe(CANCELLED)
})

test("a Stop pressed after a run is over is not the finished run's", async () => {
  const h = harness()
  const stop = new AbortController()
  h.deps.stopSignal = () => stop.signal
  await createPostPlanService(h.deps).plan("/p", REQUEST)
  const signal = h.handed.get("sounds")!.at(-1) as AbortSignal
  stop.abort()
  expect(signal.aborted).toBe(false)
})

test("a work that runs while the points change notes the version it started on, so the banner stays up", async () => {
  const h = harness()
  // the user moves a point while the zooms are planned, and again while the sounds are
  h.deps.flair.planTechniques = async () => {
    h.bump("/p", 5)
    return { count: 1, dropped: 0 }
  }
  h.deps.flair.planSounds = async () => {
    h.bump("/p", 6)
    return { count: 1, dropped: 0 }
  }
  await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 5 })
})

test("thinking work 2 again puts the sounds behind: they may sit on what it replaced; one that changed nothing leaves them", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
  // every call of work 2 switched off: nothing is replaced
  const allOff: PostRequest = { ...REQUEST, view: { ...REQUEST.view, highlightsOn: false, flair: { ...FLAIR, zoom: false, insert: false, graphic: false } } }
  await post.rethink("/p", "graphics", allOff)
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
  // every call failed: nothing is replaced either
  const failing = harness()
  const broken = async () => {
    throw new Error("Claude is busy")
  }
  failing.deps.highlights.pick = broken
  failing.deps.flair.planTechniques = broken
  failing.deps.flair.planGraphics = broken
  const again = createPostPlanService(failing.deps)
  await again.plan("/p", REQUEST)
  expect(failing.plannedOn()).toEqual({ graphics: null, sounds: 4 })
  await again.rethink("/p", "graphics", REQUEST)
  expect(failing.plannedOn()).toEqual({ graphics: null, sounds: 4 })
  // work 2 thought again: the sounds tab asks for the sounds to be thought again too
  await post.rethink("/p", "graphics", REQUEST)
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: null })
  // the sounds thought again clear it
  await post.rethink("/p", "sounds", REQUEST)
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
})

test("two projects run at once, each with its own states and events", async () => {
  const h = harness()
  const gates = new Map<string, () => void>()
  h.deps.emphasis.plan = (folder) =>
    new Promise((resolve) => {
      gates.set(folder, () => resolve({ count: folder === "/p" ? 1 : 2, dropped: 0 }))
    })
  h.deps.flair.planSounds = async (folder) => {
    h.order.push(`sounds ${folder}`)
    return { count: folder === "/p" ? 5 : 6, dropped: 0 }
  }
  const post = createPostPlanService(h.deps)
  const first = post.plan("/p", REQUEST)
  const second = post.plan("/q", REQUEST)
  expect(post.state("/p")).toMatchObject({ running: true, states: { emphasis: { state: "running" } } })
  expect(post.state("/q")).toMatchObject({ running: true, states: { emphasis: { state: "running" } } })
  // the second project finishes first
  gates.get("/q")!()
  expect((await second).states).toMatchObject({ emphasis: done(2, 0), sounds: done(6, 0) })
  expect(post.state("/p")).toMatchObject({ running: true })
  gates.get("/p")!()
  expect((await first).states).toMatchObject({ emphasis: done(1, 0), sounds: done(5, 0) })
  expect(h.order.filter((work) => work.startsWith("sounds"))).toEqual(["sounds /q", "sounds /p"])
  expect(h.told("sounds", "/p")).toEqual(["waiting", "running", "done"])
  expect(h.told("sounds", "/q")).toEqual(["waiting", "running", "done"])
  expect(h.events.filter((event) => event.type === "post-plan-finished").map((event) => event.folder)).toEqual(["/q", "/p"])
  expect([h.plannedOn("/p"), h.plannedOn("/q")]).toEqual([
    { graphics: 4, sounds: 4 },
    { graphics: 4, sounds: 4 },
  ])
})

/* the graphics work says how far it has got; one graphic written again */

/** What the screen was told about the graphics work of a project, in order, each state whole. */
const graphicsStates = (events: AppEvent[]) => events.flatMap((event) => (event.type === "post-plan" && event.work === "graphics" ? [event.state] : []))

test("the graphics work is handed a way to say how far it has got: its running state carries what it reports, and the screen is told each time", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  const seen: unknown[] = []
  h.deps.flair.planGraphics = async (_folder, _request, _signal, progress) => {
    progress?.(0, 2)
    progress?.(1, 2)
    // how the run stands can be read while the work goes
    seen.push(post.state("/p")!.states.graphics)
    progress?.(2, 2)
    return { count: 2, dropped: 0 }
  }
  const { states } = await post.plan("/p", REQUEST)
  expect(seen).toEqual([{ state: "running", done: 1, total: 2 }])
  expect(states.graphics).toEqual(done(2, 0))
  expect(graphicsStates(h.events)).toEqual([
    { state: "waiting" },
    { state: "running" },
    { state: "running", done: 0, total: 2 },
    { state: "running", done: 1, total: 2 },
    { state: "running", done: 2, total: 2 },
    done(2, 0),
  ])
  // a work that reports nothing runs as it always did
  expect(h.told("techniques")).toEqual(["waiting", "running", "done"])
})

test("a report that comes once the work is over is not taken: neither the state nor the screen hears of it", async () => {
  const h = harness()
  let late: ((done: number, total: number) => void) | undefined
  h.deps.flair.planGraphics = async (_folder, _request, _signal, progress) => {
    late = progress
    throw new Error("Claude is busy")
  }
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  const told = h.events.length
  late!(1, 3)
  expect(post.state("/p")!.states.graphics).toEqual({ state: "failed", error: "Claude is busy" })
  expect(h.events).toHaveLength(told)
})

const GRAPHIC_AT = { kind: "speech" as const, videoId: "v1", sourceUs: 18_080_000, beatId: "b1" }

test("writing one graphic again is a run of the graphics work alone: the work is handed the place, the request, the run's stop and a way to report, and the other works keep how they stood", async () => {
  const h = harness()
  const stop = new AbortController()
  h.deps.stopSignal = () => stop.signal
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  h.order.length = 0
  h.events.length = 0
  let handed: unknown[] = []
  h.deps.flair.redoGraphic = async (folder, anchor, request, signal, progress) => {
    h.order.push("redo")
    handed = [folder, anchor, request, signal]
    progress?.(0, 1)
    progress?.(1, 1)
    return { count: 1, dropped: 0 }
  }
  expect(await post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).toEqual({
    running: false,
    states: { emphasis: done(3, 1), text: done(2, 1), techniques: done(2, 0), graphics: done(1, 0), sounds: done(4, 0), subtitles: done(2, 0) },
  })
  // no other work ran, and nothing was planned: the points are noted as planned on no more than they were
  expect(h.order).toEqual(["redo"])
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
  expect(handed.slice(0, 3)).toEqual(["/p", GRAPHIC_AT, REQUEST])
  // the run's own stop, which the user's stop aborts as theirs
  const signal = handed[3] as AbortSignal
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal.aborted).toBe(false)
  expect(h.events).toEqual([
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "waiting" } },
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "running" } },
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "running", done: 0, total: 1 } },
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "running", done: 1, total: 1 } },
    { type: "post-plan", folder: "/p", work: "graphics", state: done(1, 0) },
    { type: "post-plan-finished", folder: "/p" },
  ])
})

test("a graphic is not written again while another run goes on the project, and no run starts while one is", async () => {
  const h = harness()
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  h.deps.emphasis.plan = async () => {
    await gate
    return { count: 1, dropped: 0 }
  }
  const post = createPostPlanService(h.deps)
  const planning = post.plan("/p", REQUEST)
  await expect(post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).rejects.toThrow("a plan for this project is already running")
  expect(h.order).not.toContain("redo")
  release()
  await planning

  let finish!: () => void
  const writing = new Promise<void>((resolve) => (finish = resolve))
  h.deps.flair.redoGraphic = async () => {
    await writing
    return { count: 1, dropped: 0 }
  }
  const redoing = post.redoGraphic("/p", GRAPHIC_AT, REQUEST)
  expect(post.state("/p")).toMatchObject({ running: true, states: { graphics: { state: "running" }, sounds: done(4, 0) } })
  await expect(post.rethink("/p", "sounds", REQUEST)).rejects.toThrow("a plan for this project is already running")
  await expect(post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).rejects.toThrow("a plan for this project is already running")
  // another project's graphic is written again meanwhile
  h.deps.flair.redoGraphic = async () => ({ count: 1, dropped: 0 })
  expect((await post.redoGraphic("/q", GRAPHIC_AT, REQUEST)).states).toEqual({ graphics: done(1, 0) })
  finish()
  expect((await redoing).running).toBe(false)
})

test("a graphic that cannot be written again fails the work with why, a writing that failed counts as one dropped, and a stop during it ends it as a stop does; the run is over each time", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  h.deps.flair.redoGraphic = async () => {
    throw new Error("this graphic has no place on the clip now")
  }
  expect((await post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).states).toEqual({ graphics: { state: "failed", error: "this graphic has no place on the clip now" } })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
  h.deps.flair.redoGraphic = async () => ({ count: 0, dropped: 1 })
  expect((await post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).states).toEqual({ graphics: done(0, 1) })
  h.deps.flair.redoGraphic = async () => {
    throw new Error(CANCELLED)
  }
  expect(await post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).toEqual({ running: false, states: { graphics: { state: "failed", error: CANCELLED } } })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
})

test("editing one graphic is a run of the graphics work alone, as writing it again is: the work is handed the place, the change, the request, the run's stop and a way to report, and the other works keep how they stood", async () => {
  const h = harness()
  const stop = new AbortController()
  h.deps.stopSignal = () => stop.signal
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  h.order.length = 0
  h.events.length = 0
  let handed: unknown[] = []
  h.deps.flair.editGraphic = async (folder, anchor, instruction, request, signal, progress) => {
    h.order.push("edit")
    handed = [folder, anchor, instruction, request, signal]
    progress?.(0, 1)
    progress?.(1, 1)
    return { count: 0, dropped: 1 }
  }
  expect(await post.editGraphic("/p", GRAPHIC_AT, "ตัวเลขใหญ่ขึ้น", REQUEST)).toEqual({
    running: false,
    states: { emphasis: done(3, 1), text: done(2, 1), techniques: done(2, 0), graphics: done(0, 1), sounds: done(4, 0), subtitles: done(2, 0) },
  })
  // no other work ran, and nothing was planned: the points are noted as planned on no more than they were
  expect(h.order).toEqual(["edit"])
  expect(h.plannedOn()).toEqual({ graphics: 4, sounds: 4 })
  expect(handed.slice(0, 4)).toEqual(["/p", GRAPHIC_AT, "ตัวเลขใหญ่ขึ้น", REQUEST])
  // the run's own stop, which the user's stop aborts as theirs
  const signal = handed[4] as AbortSignal
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal.aborted).toBe(false)
  expect(h.events).toEqual([
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "waiting" } },
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "running" } },
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "running", done: 0, total: 1 } },
    { type: "post-plan", folder: "/p", work: "graphics", state: { state: "running", done: 1, total: 1 } },
    { type: "post-plan", folder: "/p", work: "graphics", state: done(0, 1) },
    { type: "post-plan-finished", folder: "/p" },
  ])
})

test("a graphic that cannot be edited fails the work with why, and a stop during the edit ends it as a stop does; the run is over each time", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  h.deps.flair.editGraphic = async () => {
    throw new Error("this graphic has not been written yet")
  }
  expect((await post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).states).toEqual({ graphics: { state: "failed", error: "this graphic has not been written yet" } })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
  h.deps.flair.editGraphic = async () => {
    throw new Error(CANCELLED)
  }
  expect(await post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).toEqual({ running: false, states: { graphics: { state: "failed", error: CANCELLED } } })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
})

test("a graphic is not edited while another run goes on the project, and no run starts while an edit goes", async () => {
  const h = harness()
  let finish!: () => void
  const writing = new Promise<void>((resolve) => (finish = resolve))
  h.deps.flair.redoGraphic = async () => {
    await writing
    return { count: 1, dropped: 0 }
  }
  const post = createPostPlanService(h.deps)
  const redoing = post.redoGraphic("/p", GRAPHIC_AT, REQUEST)
  await expect(post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).rejects.toThrow("a plan for this project is already running")
  expect(h.order).not.toContain("edit")
  finish()
  await redoing

  let answer!: () => void
  const answered = new Promise<void>((resolve) => (answer = resolve))
  h.deps.flair.editGraphic = async () => {
    await answered
    return { count: 1, dropped: 0 }
  }
  const editing = post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)
  expect(post.state("/p")).toMatchObject({ running: true, states: { graphics: { state: "running" } } })
  await expect(post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).rejects.toThrow("a plan for this project is already running")
  await expect(post.editGraphic("/p", GRAPHIC_AT, "เล็กลง", REQUEST)).rejects.toThrow("a plan for this project is already running")
  await expect(post.plan("/p", REQUEST)).rejects.toThrow("a plan for this project is already running")
  answer()
  expect((await editing).running).toBe(false)
})

test("going back a step is no run: it is refused while a run goes on the project, let through on another project meanwhile and on this one once the run is over, and it tells the screen nothing", async () => {
  const h = harness()
  let finish!: () => void
  const writing = new Promise<void>((resolve) => (finish = resolve))
  h.deps.flair.editGraphic = async () => {
    await writing
    return { count: 1, dropped: 0 }
  }
  const post = createPostPlanService(h.deps)
  const editing = post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)
  await expect(post.undoGraphic("/p", GRAPHIC_AT)).rejects.toThrow("a plan for this project is already running")
  expect(h.order).not.toContain("undo /p speech")
  // another project goes back meanwhile
  await post.undoGraphic("/q", GRAPHIC_AT)
  expect(h.order).toContain("undo /q speech")
  finish()
  await editing
  const told = h.events.length
  const state = post.state("/p")
  await post.undoGraphic("/p", GRAPHIC_AT)
  expect(h.order.filter((name) => name.startsWith("undo"))).toEqual(["undo /q speech", "undo /p speech"])
  // no work was marked and no run began or ended
  expect(h.events).toHaveLength(told)
  expect(post.state("/p")).toEqual(state)
  expect(post.state("/q")).toBeNull()
  // what the flair service refuses is refused
  h.deps.flair.undoGraphic = async () => {
    throw new Error("this graphic has nothing to go back to")
  }
  await expect(post.undoGraphic("/p", GRAPHIC_AT)).rejects.toThrow("this graphic has nothing to go back to")
})
