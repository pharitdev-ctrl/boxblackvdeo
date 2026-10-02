import { expect, test, vi } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import { POST_WORKS, type AppEvent, type CueAnchor, type HighlightPreview, type PostRequest, type PostWork, type StoredOutline } from "../shared/api.ts"
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
      redoMove: ran("redoMove", { count: 1, dropped: 0 }),
      editMove: ran("editMove", { count: 1, dropped: 0 }),
      undoMove: async (folder, anchor) => void order.push(`undoMove ${folder} ${anchor.insert === true ? "cutaway" : "word"}`),
      soundsAfterGraphic: ran("follow", { count: 0, dropped: 0 }),
      redoSound: ran("redoSound", { count: 1, dropped: 0 }),
      editSound: ran("editSound", { count: 1, dropped: 0 }),
      undoSound: async (folder, anchor) => void order.push(`undoSound ${folder} ${anchor.kind}`),
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
  /** Stores a composed sound tied to the graphic at `anchor`, as work 4 would leave one. */
  const tie = (folder: string, anchor: CueAnchor) => {
    const stored = storeOf(folder)
    const sound = { anchor, graphic: anchor, graphicHtml: "h", from: "light", role: "วูบ", loudness: "normal", seconds: 1, words: [], code: "c", version: "v", off: false }
    stores.set(folder, { ...stored, flair: { looks: {}, composed: [sound] } } as StoredOutline)
  }
  return { deps, order, events, handed, counted, told, bump, tie, plannedOn: (folder = "/p") => storeOf(folder).emphasis!.plannedOn }
}

test("the one button plans the points, then the moves and cutaways, the text and the graphics, then the sounds, with the subtitles' polish alongside", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  expect(await post.plan("/p", REQUEST)).toEqual({
    running: false,
    states: { emphasis: done(3, 1), text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1), sounds: done(4, 0), subtitles: done(2, 0) },
  })
  expect(h.order).toEqual(["subtitles", "emphasis", "techniques", "text", "graphics", "sounds"])
  // the screen hears of every work it will fill before any starts, then of each as it runs and ends, then that the run is over
  expect(h.events.slice(0, 6)).toEqual(POST_WORKS.map((work) => ({ type: "post-plan", folder: "/p", work, state: { state: "waiting" } })))
  expect(h.told("techniques")).toEqual(["waiting", "running", "done"])
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
  // works 2 and 4 planned on the points as they were: the "จุดเน้นเปลี่ยน" banner goes
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
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
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
  // either of the zooms and the cutaways is enough for work 2b to be asked
  h.order.length = 0
  await post.plan("/p", { ...quiet, view: { ...quiet.view, flair: { ...quiet.view.flair, insert: true } } })
  expect(h.order).toEqual(["emphasis", "techniques", "graphics"])
})

test("with all of work 2 switched off, thinking its text and techniques or its graphics again asks nothing but still notes the points as planned on, each for itself", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  const allOff: PostRequest = { ...REQUEST, view: { ...REQUEST.view, highlightsOn: false, flair: { ...FLAIR, zoom: false, insert: false, graphic: false } } }
  const off = { state: "skipped", reason: "off" }
  expect((await post.rethink("/p", "techniques", allOff)).states).toEqual({ text: off, techniques: off })
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: null, sounds: null })
  expect((await post.rethink("/p", "graphics", allOff)).states).toEqual({ text: off, techniques: off, graphics: off })
  expect(h.order).toEqual([])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: null })
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
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
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

test("a work that fails does not stop the next, and each part of work 2 counts as planned only when none of its own calls failed", async () => {
  const h = harness()
  h.deps.flair.planTechniques = async () => {
    throw new Error("the pictures cannot be read")
  }
  const { states } = await createPostPlanService(h.deps).plan("/p", REQUEST)
  expect(states.techniques).toEqual({ state: "failed", error: "the pictures cannot be read" })
  expect(h.order).toEqual(["subtitles", "emphasis", "text", "graphics", "sounds"])
  // the graphics, which did not fail, are noted on their own; the text and techniques are noted as never planned
  expect(h.plannedOn()).toEqual({ techniques: null, graphics: 4, sounds: 4 })
  // the graphics failing leaves the text and techniques noted
  const other = harness()
  other.deps.flair.planGraphics = async () => {
    throw new Error("the draft cannot be read")
  }
  await createPostPlanService(other.deps).plan("/p", REQUEST)
  expect(other.plannedOn()).toEqual({ techniques: 4, graphics: null, sounds: 4 })
})

test("thinking the graphics again on an outline from before 0.7.0 leaves the text and techniques as far behind as they were", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  // the points are at version 4; the outline noted work 2 on version 3, before the text and techniques had a note of their own
  await h.deps.outlines.update("/p", (stored) => ({ ...stored!, emphasis: { ...stored!.emphasis!, plannedOn: { graphics: 3, sounds: 3 } } }))
  await post.rethink("/p", "graphics", REQUEST)
  expect(h.plannedOn()).toEqual({ techniques: 3, graphics: 4, sounds: null })
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
  // the text and techniques had ended well before the stop
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: null, sounds: null })
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

test("thinking again runs only that work: techniques are work 2's moves and cutaways and then its text, graphics its graphics, sounds the sounds, subtitles the polish", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  expect(await post.rethink("/p", "techniques", REQUEST)).toEqual({ running: false, states: { techniques: done(2, 0), text: done(2, 1) } })
  // the text is placed after the moves, off the faces where the moves take them
  expect(h.order).toEqual(["techniques", "text"])
  // the text is one of its works: the screen hears that both wait before either runs, then of each as it runs and ends
  expect(h.events.slice(0, 2)).toEqual([
    { type: "post-plan", folder: "/p", work: "techniques", state: { state: "waiting" } },
    { type: "post-plan", folder: "/p", work: "text", state: { state: "waiting" } },
  ])
  expect(h.told("text")).toEqual(["waiting", "running", "done"])
  expect(h.handed.get("text")).toEqual([REQUEST.rules, { ...REQUEST.view, flair: { ...REQUEST.view.flair, graphic: false } }, expect.any(AbortSignal)])
  expect(h.told("graphics")).toEqual([])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: null, sounds: null })
  h.order.length = 0
  expect(await post.rethink("/p", "graphics", REQUEST)).toEqual({ running: false, states: { text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1) } })
  expect(h.order).toEqual(["graphics"])
  expect(h.told("sounds")).toEqual([])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: null })
  // the graphics are thought on the text as it stands: the text is not picked again for them
  expect(h.handed.get("graphics")).toEqual([REQUEST, expect.any(AbortSignal), expect.any(Function)])
  h.order.length = 0
  // each answer keeps how the works it did not touch last stood
  expect((await post.rethink("/p", "sounds", REQUEST)).states).toEqual({ text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1), sounds: done(4, 0) })
  expect((await post.rethink("/p", "subtitles", REQUEST)).states).toEqual({ text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1), sounds: done(4, 0), subtitles: done(2, 0) })
  expect(h.order).toEqual(["sounds", "subtitles"])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
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
  expect(await orderOf({ ...hiding, view: { ...hiding.view, flair: { ...FLAIR, graphic: false } } })).toEqual(["emphasis", "techniques", "text", "subtitles", "sounds"])
  // with them on, the lines change as graphics are written: the polish starts once the graphics work is over
  expect(await orderOf(hiding)).toEqual(["emphasis", "techniques", "text", "graphics", "subtitles", "sounds"])
  // however that work ended
  const failing = (deps: PostPlanDeps) => {
    deps.flair.planGraphics = async () => {
      throw new Error("Claude is unreachable")
    }
  }
  expect(await orderOf(hiding, failing)).toEqual(["emphasis", "techniques", "text", "subtitles", "sounds"])
  // a graphics work that was stopped ended the run: the polish that waited for it is stopped with it, and is not asked
  const stopped = harness()
  stopped.deps.flair.planGraphics = async () => {
    throw new Error(CANCELLED)
  }
  const { states } = await createPostPlanService(stopped.deps).plan("/p", hiding)
  expect(stopped.order).toEqual(["emphasis", "techniques", "text"])
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
  expect(await orderOf(REQUEST)).toEqual(["subtitles", "emphasis", "techniques", "text", "graphics", "sounds"])
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
  // the sounds work is handed the request, the run's stop and a way to report
  const signal = h.handed.get("sounds")![1] as AbortSignal
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
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 5 })
})

test("thinking work 2 again puts the sounds behind: they may sit on what it replaced; one that changed nothing leaves them", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
  // every call of work 2 switched off: nothing is replaced
  const allOff: PostRequest = { ...REQUEST, view: { ...REQUEST.view, highlightsOn: false, flair: { ...FLAIR, zoom: false, insert: false, graphic: false } } }
  await post.rethink("/p", "techniques", allOff)
  await post.rethink("/p", "graphics", allOff)
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
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
  expect(failing.plannedOn()).toEqual({ techniques: null, graphics: null, sounds: 4 })
  await again.rethink("/p", "techniques", REQUEST)
  await again.rethink("/p", "graphics", REQUEST)
  expect(failing.plannedOn()).toEqual({ techniques: null, graphics: null, sounds: 4 })
  // work 2's graphics thought again: the sounds tab asks for the sounds to be thought again too
  await post.rethink("/p", "graphics", REQUEST)
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: null })
  // the sounds thought again clear it
  await post.rethink("/p", "sounds", REQUEST)
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
  // and so does work 2's text and techniques thought again
  await post.rethink("/p", "techniques", REQUEST)
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: null })
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
    { techniques: 4, graphics: 4, sounds: 4 },
    { techniques: 4, graphics: 4, sounds: 4 },
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

test("the sounds work is handed a way to say how far its composing has got, on a run of all the works and on the sounds thought again", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  h.deps.flair.planSounds = async (_folder, _request, _signal, progress) => {
    progress?.(0, 2)
    progress?.(1, 2)
    progress?.(2, 2)
    return { count: 2, dropped: 0 }
  }
  const soundStates = () => h.events.flatMap((event) => (event.type === "post-plan" && event.work === "sounds" ? [event.state] : []))
  const told = [{ state: "waiting" }, { state: "running" }, { state: "running", done: 0, total: 2 }, { state: "running", done: 1, total: 2 }, { state: "running", done: 2, total: 2 }, done(2, 0)]
  await post.plan("/p", REQUEST)
  expect(soundStates()).toEqual(told)
  h.events.length = 0
  await post.rethink("/p", "sounds", REQUEST)
  expect(soundStates()).toEqual(told)
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
  // no other work ran, no sound is tied to the graphic, and nothing was planned: the points are noted as planned on no more than they were
  expect(h.order).toEqual(["redo"])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
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
  // the run begins once the works it will touch have been read from the outline
  await vi.waitFor(() => expect(post.state("/p")?.running).toBe(true))
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
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
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
  // the run begins once the works it will touch have been read from the outline
  await vi.waitFor(() => expect(post.state("/p")?.running).toBe(true))
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

test("while a step back is being stored no run of the project begins and no second step back is taken, on that project alone; the hold goes once it is stored, and when it fails", async () => {
  const h = harness()
  let store!: () => void
  const storing = new Promise<void>((resolve) => (store = resolve))
  h.deps.flair.undoGraphic = async (folder) => {
    h.order.push(`undo ${folder}`)
    await storing
  }
  const post = createPostPlanService(h.deps)
  const undoing = post.undoGraphic("/p", GRAPHIC_AT)
  // the outline is being changed: an edit begun now would write over the fragment going back, and keep the wrong one
  const refused = "a plan for this project is already running"
  await expect(post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).rejects.toThrow(refused)
  await expect(post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).rejects.toThrow(refused)
  await expect(post.plan("/p", REQUEST)).rejects.toThrow(refused)
  await expect(post.rethink("/p", "graphics", REQUEST)).rejects.toThrow(refused)
  await expect(post.emphasisOnly("/p", DEFAULT_CUT_RULES)).rejects.toThrow(refused)
  await expect(post.undoGraphic("/p", GRAPHIC_AT)).rejects.toThrow(refused)
  // the refused second step back leaves the first one's hold as it was: an edit is still refused while it is stored
  await expect(post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).rejects.toThrow(refused)
  expect(h.order).toEqual(["undo /p"])
  // nothing was marked on the screen for the runs that did not begin
  expect(h.events).toEqual([])
  // another project is free meanwhile
  expect((await post.editGraphic("/q", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).states).toEqual({ graphics: done(1, 0) })
  store()
  await undoing
  // stored: the edit is let through
  expect((await post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).states).toEqual({ graphics: done(1, 0) })

  // a step back that fails lets go of the project all the same
  h.deps.flair.undoGraphic = async () => {
    throw new Error("this graphic has nothing to go back to")
  }
  await expect(post.undoGraphic("/p", GRAPHIC_AT)).rejects.toThrow("this graphic has nothing to go back to")
  expect((await post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).states).toMatchObject({ graphics: done(1, 0) })
})

/* moves */

const MOVE_AT = { kind: "speech" as const, videoId: "v1", sourceUs: 2_000_000, beatId: "b1", insert: true }

test("designing one move again, or changing it, is a run of the techniques work alone: the work is handed the place, the change, the request, the run's stop and a way to report, and the other works keep how they stood", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  h.order.length = 0
  h.events.length = 0
  let handed: unknown[] = []
  h.deps.flair.redoMove = async (folder, anchor, request, signal, progress) => {
    h.order.push("redoMove")
    handed = [folder, anchor, request, signal]
    progress?.(0, 1)
    progress?.(1, 1)
    return { count: 1, dropped: 0 }
  }
  expect(await post.redoMove("/p", MOVE_AT, REQUEST)).toEqual({
    running: false,
    states: { emphasis: done(3, 1), text: done(2, 1), techniques: done(1, 0), graphics: done(1, 1), sounds: done(4, 0), subtitles: done(2, 0) },
  })
  // the text is not placed again and nothing is planned: the points are noted as planned on no more than they were
  expect(h.order).toEqual(["redoMove"])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
  expect(handed.slice(0, 3)).toEqual(["/p", MOVE_AT, REQUEST])
  expect(handed[3]).toBeInstanceOf(AbortSignal)
  expect(h.events).toEqual([
    { type: "post-plan", folder: "/p", work: "techniques", state: { state: "waiting" } },
    { type: "post-plan", folder: "/p", work: "techniques", state: { state: "running" } },
    { type: "post-plan", folder: "/p", work: "techniques", state: { state: "running", done: 0, total: 1 } },
    { type: "post-plan", folder: "/p", work: "techniques", state: { state: "running", done: 1, total: 1 } },
    { type: "post-plan", folder: "/p", work: "techniques", state: done(1, 0) },
    { type: "post-plan-finished", folder: "/p" },
  ])
  h.order.length = 0
  expect((await post.editMove("/p", MOVE_AT, "ช้าลง", REQUEST)).states.techniques).toEqual(done(1, 0))
  expect(h.order).toEqual(["editMove"])
  expect(h.handed.get("editMove")!.slice(0, 3)).toEqual([MOVE_AT, "ช้าลง", REQUEST])
  // one that cannot be designed again fails the work with why, and a stop ends it as a stop does
  h.deps.flair.redoMove = async () => {
    throw new Error("this move has no place on the clip now")
  }
  expect((await post.redoMove("/p", MOVE_AT, REQUEST)).states.techniques).toEqual({ state: "failed", error: "this move has no place on the clip now" })
  h.deps.flair.editMove = async () => {
    throw new Error(CANCELLED)
  }
  expect((await post.editMove("/p", MOVE_AT, "ช้าลง", REQUEST)).states.techniques).toEqual({ state: "failed", error: CANCELLED })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
})

test("a move is not designed again or changed while another run goes on the project, and its step back is held as a graphic's: refused during a run, and no run begins while it is stored", async () => {
  const h = harness()
  let finish!: () => void
  const writing = new Promise<void>((resolve) => (finish = resolve))
  h.deps.flair.redoMove = async () => {
    await writing
    return { count: 1, dropped: 0 }
  }
  const post = createPostPlanService(h.deps)
  const redoing = post.redoMove("/p", MOVE_AT, REQUEST)
  const refused = "a plan for this project is already running"
  await expect(post.editMove("/p", MOVE_AT, "ช้าลง", REQUEST)).rejects.toThrow(refused)
  await expect(post.undoMove("/p", MOVE_AT)).rejects.toThrow(refused)
  await expect(post.plan("/p", REQUEST)).rejects.toThrow(refused)
  finish()
  await redoing
  let store!: () => void
  const storing = new Promise<void>((resolve) => (store = resolve))
  h.deps.flair.undoMove = async (folder, anchor) => {
    h.order.push(`undoMove ${folder} ${anchor.insert === true ? "cutaway" : "word"}`)
    await storing
  }
  const told = h.events.length
  const undoing = post.undoMove("/p", MOVE_AT)
  await expect(post.redoMove("/p", MOVE_AT, REQUEST)).rejects.toThrow(refused)
  await expect(post.undoGraphic("/p", GRAPHIC_AT)).rejects.toThrow(refused)
  store()
  await undoing
  // no run began or ended for it
  expect(h.events).toHaveLength(told)
  expect(h.order).toEqual(["undoMove /p cutaway"])
})

/* sounds */

test("a graphic written again or edited has the sounds tied to it composed again in the same run, which reports how far the sounds work has got", async () => {
  for (const which of ["redo", "edit"] as const) {
    const h = harness()
    h.tie("/p", GRAPHIC_AT)
    const post = createPostPlanService(h.deps)
    let handed: unknown[] = []
    h.deps.flair.soundsAfterGraphic = async (folder, anchor, request, signal, progress) => {
      h.order.push("follow")
      handed = [folder, anchor, request, signal]
      progress?.(0, 2)
      progress?.(1, 2)
      progress?.(2, 2)
      return { count: 1, dropped: 1 }
    }
    const view = which === "redo" ? await post.redoGraphic("/p", GRAPHIC_AT, REQUEST) : await post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)
    expect(view).toEqual({ running: false, states: { graphics: done(1, 0), sounds: done(1, 1) } })
    expect(h.order).toEqual([which, "follow"])
    expect(handed.slice(0, 3)).toEqual(["/p", GRAPHIC_AT, REQUEST])
    expect(handed[3]).toBeInstanceOf(AbortSignal)
    expect(h.told("sounds")).toEqual(["waiting", "running", "running", "running", "running", "done"])
    expect(h.events.filter((event) => event.type === "post-plan" && event.work === "sounds").map((event) => (event as { state: unknown }).state)).toContainEqual({ state: "running", done: 1, total: 2 })
  }
})

test("composing one sound again, or editing it, is a run of the sounds work alone: the work is handed the place, the change, the request, the run's stop and a way to report, and the other works keep how they stood", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  h.order.length = 0
  h.events.length = 0
  let handed: unknown[] = []
  h.deps.flair.redoSound = async (folder, anchor, request, signal, progress) => {
    h.order.push("redoSound")
    handed = [folder, anchor, request, signal]
    progress?.(0, 1)
    progress?.(1, 1)
    return { count: 0, dropped: 1 }
  }
  expect(await post.redoSound("/p", GRAPHIC_AT, REQUEST)).toEqual({
    running: false,
    states: { emphasis: done(3, 1), text: done(2, 1), techniques: done(2, 0), graphics: done(1, 1), sounds: done(0, 1), subtitles: done(2, 0) },
  })
  expect(handed.slice(0, 3)).toEqual(["/p", GRAPHIC_AT, REQUEST])
  expect(handed[3]).toBeInstanceOf(AbortSignal)
  expect(h.events).toEqual([
    { type: "post-plan", folder: "/p", work: "sounds", state: { state: "waiting" } },
    { type: "post-plan", folder: "/p", work: "sounds", state: { state: "running" } },
    { type: "post-plan", folder: "/p", work: "sounds", state: { state: "running", done: 0, total: 1 } },
    { type: "post-plan", folder: "/p", work: "sounds", state: { state: "running", done: 1, total: 1 } },
    { type: "post-plan", folder: "/p", work: "sounds", state: done(0, 1) },
    { type: "post-plan-finished", folder: "/p" },
  ])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })

  h.events.length = 0
  h.deps.flair.editSound = async (folder, anchor, instruction, request, signal, progress) => {
    h.order.push("editSound")
    handed = [folder, anchor, instruction, request, signal]
    progress?.(0, 1)
    progress?.(1, 1)
    return { count: 1, dropped: 0 }
  }
  expect((await post.editSound("/p", GRAPHIC_AT, "เบาลง", REQUEST)).states).toMatchObject({ graphics: done(1, 1), sounds: done(1, 0) })
  expect(handed.slice(0, 4)).toEqual(["/p", GRAPHIC_AT, "เบาลง", REQUEST])
  expect(h.told("sounds")).toEqual(["waiting", "running", "running", "running", "done"])
  expect(h.order).toEqual(["redoSound", "editSound"])
})

test("a sound that cannot be composed again or edited fails the work with why, a stop ends it as a stop does, and neither starts while another run goes", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  h.deps.flair.redoSound = async () => {
    throw new Error("this sound has no place on the clip now")
  }
  expect((await post.redoSound("/p", GRAPHIC_AT, REQUEST)).states).toEqual({ sounds: { state: "failed", error: "this sound has no place on the clip now" } })
  h.deps.flair.editSound = async () => {
    throw new Error(CANCELLED)
  }
  expect(await post.editSound("/p", GRAPHIC_AT, "เบาลง", REQUEST)).toEqual({ running: false, states: { sounds: { state: "failed", error: CANCELLED } } })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })

  let finish!: () => void
  const writing = new Promise<void>((resolve) => (finish = resolve))
  h.deps.flair.redoGraphic = async () => {
    await writing
    return { count: 1, dropped: 0 }
  }
  const redoing = post.redoGraphic("/p", GRAPHIC_AT, REQUEST)
  const refused = "a plan for this project is already running"
  await expect(post.redoSound("/p", GRAPHIC_AT, REQUEST)).rejects.toThrow(refused)
  await expect(post.editSound("/p", GRAPHIC_AT, "เบาลง", REQUEST)).rejects.toThrow(refused)
  await expect(post.undoSound("/p", GRAPHIC_AT)).rejects.toThrow(refused)
  finish()
  await redoing
  // and a sound being composed again holds the project as any run does
  let answer!: () => void
  const answered = new Promise<void>((resolve) => (answer = resolve))
  h.deps.flair.redoSound = async () => {
    await answered
    return { count: 1, dropped: 0 }
  }
  const composing = post.redoSound("/p", GRAPHIC_AT, REQUEST)
  await expect(post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).rejects.toThrow(refused)
  await expect(post.undoGraphic("/p", GRAPHIC_AT)).rejects.toThrow(refused)
  answer()
  expect((await composing).running).toBe(false)
})

test("a sound's step back is no run and shares the hold of a graphic's: while either is stored, no run begins and no step back of either is taken", async () => {
  const h = harness()
  let store!: () => void
  const storing = new Promise<void>((resolve) => (store = resolve))
  h.deps.flair.undoSound = async (folder) => {
    h.order.push(`undoSound ${folder}`)
    if (folder === "/p") await storing
  }
  const post = createPostPlanService(h.deps)
  const undoing = post.undoSound("/p", GRAPHIC_AT)
  const refused = "a plan for this project is already running"
  await expect(post.redoSound("/p", GRAPHIC_AT, REQUEST)).rejects.toThrow(refused)
  await expect(post.undoGraphic("/p", GRAPHIC_AT)).rejects.toThrow(refused)
  await expect(post.undoSound("/p", GRAPHIC_AT)).rejects.toThrow(refused)
  await expect(post.plan("/p", REQUEST)).rejects.toThrow(refused)
  expect(h.events).toEqual([])
  // another project is free meanwhile
  await post.undoSound("/q", GRAPHIC_AT)
  store()
  await undoing
  expect(h.order).toEqual(["undoSound /p", "undoSound /q"])
  expect((await post.redoSound("/p", GRAPHIC_AT, REQUEST)).states).toEqual({ sounds: done(1, 0) })

  // a step back that fails lets go of the project all the same
  h.deps.flair.undoSound = async () => {
    throw new Error("this sound has nothing to go back to")
  }
  await expect(post.undoSound("/p", GRAPHIC_AT)).rejects.toThrow("this sound has nothing to go back to")
  expect((await post.redoSound("/p", GRAPHIC_AT, REQUEST)).states).toEqual({ sounds: done(1, 0) })
})

test("the sounds work joins a graphic's run only when a composed sound is tied to that graphic and the sounds are on; otherwise it keeps how it stood", async () => {
  const h = harness()
  h.tie("/p", GRAPHIC_AT)
  const post = createPostPlanService(h.deps)
  await post.plan("/p", REQUEST)
  // another graphic's place: nothing tied to it
  const elsewhere = { ...GRAPHIC_AT, sourceUs: 20_000_000 }
  expect((await post.redoGraphic("/p", elsewhere, REQUEST)).states.sounds).toEqual(done(4, 0))
  // the sounds switched off
  const quiet = { ...REQUEST, view: { ...REQUEST.view, flair: { ...FLAIR, sound: false } } }
  expect((await post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", quiet)).states.sounds).toEqual(done(4, 0))
  expect(h.order).not.toContain("follow")
  // tied and on: the sounds work runs, and with a graphic whose writing failed it ends with nothing done
  h.deps.flair.redoGraphic = async () => ({ count: 0, dropped: 1 })
  expect((await post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).states).toMatchObject({ graphics: done(0, 1), sounds: done(0, 0) })
  expect(h.order).not.toContain("follow")
  // a stop during the graphic skips it as stopped
  h.deps.flair.redoGraphic = async () => {
    throw new Error(CANCELLED)
  }
  expect((await post.redoGraphic("/p", GRAPHIC_AT, REQUEST)).states).toMatchObject({ graphics: { state: "failed", error: CANCELLED }, sounds: { state: "skipped", reason: "stopped" } })
})

test("while a graphic's run reads which works it will touch, the project is held as a run holds it", async () => {
  const h = harness()
  h.tie("/p", GRAPHIC_AT)
  let release!: () => void
  const reading = new Promise<void>((resolve) => (release = resolve))
  const get = h.deps.outlines.get
  h.deps.outlines.get = async (folder: string) => {
    await reading
    return get(folder)
  }
  const post = createPostPlanService(h.deps)
  const redoing = post.redoGraphic("/p", GRAPHIC_AT, REQUEST)
  const refused = "a plan for this project is already running"
  await expect(post.undoSound("/p", GRAPHIC_AT)).rejects.toThrow(refused)
  await expect(post.editGraphic("/p", GRAPHIC_AT, "ใหญ่ขึ้น", REQUEST)).rejects.toThrow(refused)
  release()
  expect((await redoing).states).toEqual({ graphics: done(1, 0), sounds: done(0, 0) })
  expect(h.order).toEqual(["redo", "follow"])
})

/* the sounds beside the graphics' writing */

/**
 * A graphics work that stores its plan, says so, and then writes until the test lets it end: `stored` once it has
 * told the run, `end` to let the writing end with `answer`, or `fail` to end it with an error.
 */
function heldGraphics(h: ReturnType<typeof harness>, answer = { count: 2, dropped: 0 }) {
  let told!: () => void
  const stored = new Promise<void>((resolve) => (told = resolve))
  let end!: () => void
  let fail!: (error: Error) => void
  const writing = new Promise<void>((resolve, reject) => {
    end = resolve
    fail = reject
  })
  h.deps.flair.planGraphics = async (_folder, _request, _signal, progress, onStored) => {
    h.order.push("graphics")
    onStored?.()
    told()
    progress?.(0, 2)
    await writing
    progress?.(2, 2)
    h.order.push("graphics written")
    return answer
  }
  return { stored, end, fail }
}

/** A sounds work that writes down what it was handed and composes until the test lets it end. */
function heldSounds(h: ReturnType<typeof harness>) {
  const handed: { drawing?: Promise<unknown> } = {}
  let end!: () => void
  const composing = new Promise<void>((resolve) => (end = resolve))
  h.deps.flair.planSounds = async (_folder, _request, _signal, progress, drawing) => {
    h.order.push("sounds")
    handed.drawing = drawing
    progress?.(0, 3)
    await composing
    progress?.(3, 3)
    return { count: 3, dropped: 0 }
  }
  return { handed, end }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test("in the one button the sounds start once the graphics are stored and run while those are written: both show running, and the sounds are handed the graphics' writing, which settles when it ends", async () => {
  const h = harness()
  const post = createPostPlanService(h.deps)
  const graphics = heldGraphics(h)
  const sounds = heldSounds(h)
  const running = post.plan("/p", REQUEST)
  await graphics.stored
  await settle()
  expect(h.order).toEqual(["subtitles", "emphasis", "techniques", "text", "graphics", "sounds"])
  // two works running at once, each with how far it has got
  expect(post.state("/p")).toMatchObject({ running: true, states: { graphics: { state: "running", done: 0, total: 2 }, sounds: { state: "running", done: 0, total: 3 } } })
  expect(h.events.filter((event) => event.type === "post-plan" && event.state.state === "running").map((event) => event.type === "post-plan" && event.work)).toContain("sounds")
  // the graphics' writing is still going: what the sounds were handed has not settled
  let drawn = false
  void sounds.handed.drawing!.then(() => (drawn = true))
  await settle()
  expect(drawn).toBe(false)
  graphics.end()
  await settle()
  expect(drawn).toBe(true)
  expect(post.state("/p")).toMatchObject({ running: true, states: { graphics: done(2, 0), sounds: { state: "running", done: 0, total: 3 } } })
  sounds.end()
  expect((await running).states).toMatchObject({ graphics: done(2, 0), sounds: done(3, 0), subtitles: done(2, 0) })
  expect(h.order).toEqual(["subtitles", "emphasis", "techniques", "text", "graphics", "sounds", "graphics written"])
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: 4, sounds: 4 })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
})

test("the graphics' writing that fails still lets the sounds' wait end; the sounds work ends as it ends", async () => {
  const h = harness()
  const graphics = heldGraphics(h)
  const sounds = heldSounds(h)
  const running = createPostPlanService(h.deps).plan("/p", REQUEST)
  await graphics.stored
  await settle()
  expect(sounds.handed.drawing).toBeInstanceOf(Promise)
  graphics.fail(new Error("the draft cannot be read"))
  await sounds.handed.drawing
  sounds.end()
  const { states } = await running
  expect(states).toMatchObject({ graphics: { state: "failed", error: "the draft cannot be read" }, sounds: done(3, 0) })
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: null, sounds: 4 })
})

test("with the graphics off, or a graphics work that ends before storing anything, the sounds run after it as before and are handed no writing to wait for", async () => {
  // switched off
  const off = harness()
  const offSounds = heldSounds(off)
  offSounds.end()
  const { states } = await createPostPlanService(off.deps).plan("/p", { ...REQUEST, view: { ...REQUEST.view, flair: { ...FLAIR, graphic: false } } })
  expect(states).toMatchObject({ graphics: { state: "skipped", reason: "off" }, sounds: done(3, 0) })
  expect(offSounds.handed).toEqual({ drawing: undefined })
  // failed before storing: the hook it was handed was never called
  const failing = harness()
  failing.deps.flair.planGraphics = async () => {
    failing.order.push("graphics")
    throw new Error("the draft cannot be read")
  }
  const failingSounds = heldSounds(failing)
  failingSounds.end()
  await createPostPlanService(failing.deps).plan("/p", REQUEST)
  expect(failing.order).toEqual(["subtitles", "emphasis", "techniques", "text", "graphics", "sounds"])
  expect(failingSounds.handed).toEqual({ drawing: undefined })
  // skipped for no canvas: the same
  const bare = harness()
  bare.deps.flair.planGraphics = async () => ({ count: 0, dropped: 0, skipped: "no-canvas" as const })
  const bareSounds = heldSounds(bare)
  bareSounds.end()
  await createPostPlanService(bare.deps).plan("/p", REQUEST)
  expect(bareSounds.handed).toEqual({ drawing: undefined })
})

test("the graphics thought again alone are handed no hook: their storing starts no sounds, which are put behind as before", async () => {
  const h = harness()
  const graphics = heldGraphics(h)
  graphics.end()
  const { states } = await createPostPlanService(h.deps).rethink("/p", "graphics", REQUEST)
  expect(h.order).toEqual(["graphics", "graphics written"])
  expect(states.sounds).toBeUndefined()
  expect(h.plannedOn()).toEqual({ techniques: null, graphics: 4, sounds: null })
})

test("a stop while the graphics are written and the sounds composed ends both, as a stop ends one", async () => {
  const h = harness()
  const stop = new AbortController()
  h.deps.stopSignal = () => stop.signal
  let told!: () => void
  const both = new Promise<void>((resolve) => (told = resolve))
  let going = 0
  /** A work that runs until the run's stop, then fails as a stopped call does. */
  const untilStopped = (signal: AbortSignal | undefined) =>
    new Promise<never>((_, reject) => {
      if (++going === 2) told()
      signal!.addEventListener("abort", () => reject(new Error(CANCELLED)), { once: true })
    })
  h.deps.flair.planGraphics = async (_folder, _request, signal, _progress, onStored) => {
    onStored?.()
    return untilStopped(signal)
  }
  h.deps.flair.planSounds = async (_folder, _request, signal) => untilStopped(signal)
  const running = createPostPlanService(h.deps).plan("/p", REQUEST)
  await both
  stop.abort()
  const { states } = await running
  expect(states).toMatchObject({ graphics: { state: "failed", error: CANCELLED }, sounds: { state: "failed", error: CANCELLED } })
  expect(h.plannedOn()).toEqual({ techniques: 4, graphics: null, sounds: null })
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
})

test("a whole plan whose work 2 throws once the sounds have started still waits for them before the run is over", async () => {
  const h = harness()
  const graphics = heldGraphics(h)
  const sounds = heldSounds(h)
  // the screen cannot be told that the graphics ended: the graphics work, and so work 2, throws
  const send = h.deps.send!
  h.deps.send = (event) => {
    if (event.type === "post-plan" && event.work === "graphics" && (event.state.state === "done" || event.state.state === "failed")) throw new Error("the window is gone")
    send(event)
  }
  const post = createPostPlanService(h.deps)
  let over = false
  const running = post.plan("/p", REQUEST).then(
    () => (over = true),
    () => (over = true),
  )
  await graphics.stored
  graphics.end()
  await settle()
  await settle()
  // work 2 has thrown, and the sounds are still composing: the run is not over
  expect(over).toBe(false)
  expect(post.state("/p")!.running).toBe(true)
  sounds.end()
  await running
  expect(h.events.at(-1)).toEqual({ type: "post-plan-finished", folder: "/p" })
  expect(post.state("/p")!.states.sounds).toEqual(done(3, 0))
})
