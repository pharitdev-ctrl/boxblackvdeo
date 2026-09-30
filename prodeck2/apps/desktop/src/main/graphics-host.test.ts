import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createContext, runInContext } from "node:vm"
import { describe, expect, test, vi } from "vitest"
import { motionAssets, motionHtml } from "@boxblack/core/graphics/motion"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"

/** The host script as the app ships it (Resources/graphics), inlined into every motion graphic's page. */
const DIR = join(import.meta.dirname, "../../resources/graphics")
const HOST = readFileSync(join(DIR, "host.js"), "utf8")

/** The timeline the host hands over, as the renderer meets it. */
interface Timeline {
  duration(): number
  totalDuration(): number
  time(): number
  totalTime(t?: number): number | Timeline
  seek(t: number): Timeline
  progress(p?: number): number | Timeline
  pause(): Timeline
  play(): Timeline
}
interface FakeWindow {
  frame?: unknown
  __timelines?: Record<string, unknown>
  __hf?: { buildReady?: Record<string, Promise<void> | undefined> }
}

/** When an animation starts, how long it runs and how it fills, in ms, as getTiming() gives them. */
interface FakeTiming {
  delay: number
  duration: number
  fill: string
}

/**
 * What an animation does and to what, as the host reads it: its target (and the pseudo-element of it, when it is one),
 * how it meets what the target already has (it replaces it when nothing is said), its keyframes, and, when it can
 * say, when it starts, how long it runs and how it fills, which updateTiming() changes. One that `startsUnderneath`
 * has no first keyframe of its own: getKeyframes() lists one all the same, as Chrome does, but the page starts it
 * from the value underneath.
 */
interface FakeEffect {
  target: unknown
  pseudoElement?: string | null
  composite?: string
  startsUnderneath?: boolean
  getKeyframes(): Record<string, unknown>[]
  getTiming?(): FakeTiming
  getComputedTiming?(): FakeTiming & { activeDuration: number }
  updateTiming?(change: Partial<FakeTiming>): void
}

/**
 * An element of an SVG drawing, as the host reads one: its tag and its attributes. The fake page's SVGElement is
 * this class, so an element made by it is one of a drawing, and anything else is not.
 */
class FakeSvgElement {
  tagName: string
  attributes: Record<string, string>
  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName
    this.attributes = attributes
  }
  getAttribute(name: string): string | null {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name]! : null
  }
  hasAttribute(name: string): boolean {
    return Object.hasOwn(this.attributes, name)
  }
}

/** An element of the page's HTML, as the host reads one: its tag, in capitals as a browser gives it, and its attributes. It is not one of a drawing. */
class FakeHtmlElement {
  tagName: string
  attributes: Record<string, string>
  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName.toUpperCase()
    this.attributes = attributes
  }
  getAttribute(name: string): string | null {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name]! : null
  }
  hasAttribute(name: string): boolean {
    return Object.hasOwn(this.attributes, name)
  }
}

/** An effect that moves its target by its transform. */
const moving = (target: unknown, composite?: string): FakeEffect => ({ target, composite, getKeyframes: () => [{ offset: 0, transform: "scale(0)" }, { offset: 1, transform: "scale(1)" }] })

/** What the host says of an SVG element whose transform attribute an animation of its transform replaces, after naming the element. */
const REPLACED = " has a transform attribute and an animation of its transform: the animation replaces the attribute, so the element jumps to the corner of the drawing. Keep the attribute on an outer <g> and animate an inner <g>"

/**
 * An animation as document.getAnimations() lists it: it can be paused and given a time, and notes each time it is
 * given in `log`. One that `refuses` throws when given one. Its `effect`, when it has one, is what the host reads
 * to see what it animates.
 */
function fakeAnimation(refuses = false, log: string[] = [], effect?: FakeEffect) {
  const seen = { pauses: 0, currentTime: null as number | null }
  return {
    seen,
    effect,
    pause() {
      seen.pauses++
    },
    get currentTime() {
      return seen.currentTime
    },
    set currentTime(value: number | null) {
      log.push(`set ${value}`)
      if (refuses) throw new Error("this animation refuses a time")
      seen.currentTime = value
    },
  }
}
type FakeAnimation = ReturnType<typeof fakeAnimation>

/** A keyframe as getKeyframes() gives one: where it sits, its easing and how it composites, besides what it sets. */
const frame = (offset: number, sets: Record<string, string | null>) => ({ offset, computedOffset: offset, easing: "ease", composite: "auto", ...sets })

/**
 * An animation of `target` as the page lists it, that starts `delay` ms in (getTiming() gives the delay worked out,
 * calc() and all), runs `duration` ms (300 unless it says) and fills as `fill` says: a CSS animation when it has an
 * animationName, and otherwise one that el.animate() made, whose id is empty unless it was given one. `log`, when
 * one is given, notes each time it is set and each fill it is given.
 */
function timed(target: unknown, frames: Record<string, unknown>[], over: { delay: number; duration?: number; fill: string; animationName?: string; id?: string; composite?: string; pseudoElement?: string; startsUnderneath?: boolean; log?: string[] }) {
  const timing: FakeTiming = { delay: over.delay, duration: over.duration ?? 300, fill: over.fill }
  const effect: FakeEffect = {
    target,
    pseudoElement: over.pseudoElement ?? null,
    composite: over.composite,
    startsUnderneath: over.startsUnderneath,
    getKeyframes: () => frames,
    getTiming: () => ({ ...timing }),
    getComputedTiming: () => ({ ...timing, activeDuration: timing.duration }),
    updateTiming(change) {
      if (change.fill !== undefined) over.log?.push(`fill ${change.fill}`)
      Object.assign(timing, change)
    },
  }
  const animation = fakeAnimation(false, over.log, effect)
  return over.animationName === undefined ? Object.assign(animation, { id: over.id ?? "" }) : Object.assign(animation, { animationName: over.animationName, id: "" })
}

/** What a keyframe object holds besides the properties it sets. */
const NOT_SET = ["offset", "computedOffset", "easing", "composite"]

/**
 * The computed style of the page's elements, worked out from its animations at the times they are set to, as
 * getComputedStyle() gives it: a property of an element (or of one pseudo-element of it) is what the last of its
 * animations that applies sets it to, and "" when none does. Before it starts, an animation applies when it fills
 * backwards, with its first keyframe, unless it starts from the value underneath; while it runs it holds the last
 * keyframe it has reached; once it is over it applies when it fills forwards, with its last keyframe.
 */
function computedStyle(animations: FakeAnimation[]) {
  return (target: unknown, pseudoElement: string | null = null) => {
    const values: Record<string, string> = {}
    for (const animation of animations) {
      const effect = animation.effect
      if (!effect?.getTiming || effect.target !== target || (effect.pseudoElement ?? null) !== pseudoElement) continue
      const { delay, duration, fill } = effect.getTiming()
      const frames = effect.getKeyframes()
      const local = (animation.seen.currentTime ?? 0) - delay
      const shows =
        local < 0
          ? (fill === "backwards" || fill === "both") && !effect.startsUnderneath
            ? frames[0]
            : undefined
          : local < duration
            ? frames.findLast((k) => Number(k.offset) <= local / duration)
            : fill === "forwards" || fill === "both"
              ? frames.at(-1)
              : undefined
      for (const [property, value] of Object.entries(shows ?? {})) if (!NOT_SET.includes(property) && value !== null && value !== undefined) values[property] = String(value)
    }
    return Object.assign(values, { getPropertyValue: (property: string) => values[property] ?? "" })
  }
}

/** The keyframes of the countdown the last live test wrote (live-look/countdown-overlap.html), as getKeyframes() gives them: each digit slams in and shrinks out, and the dial comes in and fades out. */
const SLAM = [frame(0, { opacity: "0", transform: "scale(2.3)" }), frame(0.55, { opacity: "1", transform: "scale(0.88)" }), frame(1, { opacity: "1", transform: "scale(1)" })]
const SHRINK_OUT = [frame(0, { opacity: "1", transform: "scale(1)" }), frame(1, { opacity: "0", transform: "scale(0.4)" })]
const DIAL_IN = [frame(0, { opacity: "0", transform: "scale(0.6)" }), frame(1, { opacity: "1", transform: "scale(1)" })]
const FADE_OUT = [frame(0, { opacity: "1" }), frame(1, { opacity: "0" })]
const BURST = [frame(0, { opacity: "0.9", transform: "scale(1)" }), frame(1, { opacity: "0", transform: "scale(1.14)" })]
const FLASH = [frame(0, { opacity: "0", transform: "scale(1.5)" }), frame(0.3, { opacity: "1", transform: "scale(0.95)" }), frame(1, { opacity: "0", transform: "scale(1.1)" })]
/** A move with no fading in it, the countdown's ring drawn round, and a turn. */
const DRAW_ROUND = [frame(0, { strokeDashoffset: "0" }), frame(1, { strokeDashoffset: "100" })]
const TURN = [frame(0, { transform: "rotate(0deg)" }), frame(1, { transform: "rotate(90deg)" })]

/**
 * The countdown the last live test wrote (live-look/countdown-overlap.html), with its words said at 400, 1100 and
 * 1800 ms, as the page lists its animations: the CSS animations by where their elements sit in the page and then by
 * their order in animation-name, and the one its script made after them. The ring is placed by its transform
 * attribute and drawn round by the script, which is not a move of its transform. The digits' exits start from the
 * value underneath when `startsUnderneath` says so, as they do once their 0% keyframe is taken out. The first
 * animation notes its times in `log`, when one is given.
 */
function countdown(exit: { startsUnderneath?: boolean }, log?: string[]) {
  const w = [400, 1100, 1800] as const
  const dial = new FakeHtmlElement("div", { class: "cen dial" })
  const pulses = [new FakeSvgElement("circle", { class: "pulse p2" }), new FakeSvgElement("circle", { class: "pulse p3" })]
  const digits = ["n3", "n2", "n1"].map((n) => new FakeHtmlElement("span", { class: `num ${n}` }))
  const go = new FakeHtmlElement("div", { class: "go" })
  const ring = new FakeSvgElement("circle", { id: "ring", transform: "rotate(-90 498 145)" })
  const slam = (digit: unknown, delay: number) => timed(digit, SLAM, { delay, duration: 320, fill: "both", animationName: "slam" })
  const shrinkOut = (digit: unknown, delay: number, duration = 160) => timed(digit, SHRINK_OUT, { delay, duration, fill: "both", animationName: "shrinkOut", startsUnderneath: exit.startsUnderneath })
  return [
    timed(dial, DIAL_IN, { delay: 0, duration: 300, fill: "both", animationName: "dialIn", log }),
    timed(dial, FADE_OUT, { delay: 2360, duration: 140, fill: "both", animationName: "fadeOut" }),
    timed(pulses[0], BURST, { delay: w[1] - 50, duration: 450, fill: "both", animationName: "burst" }),
    timed(pulses[1], BURST, { delay: w[2] - 50, duration: 450, fill: "both", animationName: "burst" }),
    slam(digits[0], w[0]),
    shrinkOut(digits[0], w[1] - 160),
    slam(digits[1], w[1] - 180),
    shrinkOut(digits[1], w[2] - 160),
    slam(digits[2], w[2] - 180),
    shrinkOut(digits[2], 2300, 120),
    timed(go, FLASH, { delay: 2400, duration: 300, fill: "both", animationName: "flash" }),
    timed(ring, DRAW_ROUND, { delay: w[0], duration: w[2] + 150, fill: "both" }),
  ]
}

/** What the host says of an element whose later animation of `property` fills backwards over an earlier one, after naming the element; `fix` is what the later one is to be given. */
const hidden = (property: string, later: string, earlier: string, fix = "animation-fill-mode forwards") =>
  ` has two animations of ${property}, and the later one (${later}) fills backwards: before it starts, its first frame shows and hides the earlier one (${earlier}). Give the later one ${fix}, or put it on a wrapping element`

/** Lets everything waiting on a resolved promise run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * The host run in a context of its own, on a page made of fakes: a root that is `duration` seconds long, the
 * animations the page has (the array may grow later), the fonts and pictures it must wait for, and the window
 * the fragment may already have written to. Its computed style follows its animations, unless `getComputedStyle`
 * says otherwise. `warnings` and `errors` are what the host logged; `log`, when one is given, takes each error as it
 * comes too, so that a test can tell what was reported before a draw from what came after it.
 */
function load(over: { duration?: string; animations?: FakeAnimation[]; fonts?: { family: string; load(): Promise<unknown> }[]; fontsReady?: Promise<unknown>; images?: { decode?: () => Promise<unknown> }[]; window?: FakeWindow; log?: string[]; getComputedStyle?: (target: unknown, pseudoElement?: string | null) => unknown } = {}) {
  const warnings: string[] = []
  const errors: string[] = []
  const win: FakeWindow = { ...over.window }
  const animations = over.animations ?? []
  const document = {
    getElementById: (id: string) => (id === "root" ? { getAttribute: (name: string) => (name === "data-duration" ? (over.duration ?? "3") : null) } : null),
    getAnimations: () => animations,
    fonts: Object.assign(new Set(over.fonts ?? []), { ready: over.fontsReady ?? Promise.resolve() }),
    images: over.images ?? [],
  }
  const console = {
    warn: (message: string) => warnings.push(message),
    error: (message: string) => {
      errors.push(message)
      over.log?.push(`error ${message}`)
    },
  }
  runInContext(HOST, createContext({ document, window: win, console, SVGElement: FakeSvgElement, getComputedStyle: over.getComputedStyle ?? computedStyle(animations) }))
  return {
    win,
    warnings,
    errors,
    /** settles once the host has drawn time 0 and registered its timeline */
    ready: win.__hf?.buildReady?.host,
    timeline: () => win.__timelines?.main as Timeline | undefined,
  }
}

/** A promise that stays pending until `release` is called. */
function held() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}

describe("the host script", () => {
  test("registers its timeline under main only once it is ready, and the timeline is as long as the root says", async () => {
    const page = load({ duration: "3" })
    // the render waits on this promise: it is built in the page's own realm, so it is a promise by what it does
    expect(typeof page.ready?.then).toBe("function")
    expect(page.win.__timelines).toBeUndefined()
    await page.ready
    expect(page.timeline()).toBeDefined()
    expect(page.timeline()!.duration()).toBe(3)
    expect(page.timeline()!.totalDuration()).toBe(3)
    // another length, from the root's data-duration
    const longer = load({ duration: "2.5" })
    await longer.ready
    expect(longer.timeline()!.duration()).toBe(2.5)
  })

  test("waits for the fonts before it draws or registers anything, and a font that fails to load is warned of and does not hold the render up", async () => {
    const fontsReady = held()
    const loaded = vi.fn(async () => {})
    const page = load({ fonts: [{ family: "Kanit", load: loaded }], fontsReady: fontsReady.promise })
    await settle()
    expect(loaded).toHaveBeenCalledTimes(1)
    expect(page.timeline()).toBeUndefined()
    fontsReady.release()
    await page.ready
    expect(page.timeline()).toBeDefined()

    const failing = load({ fonts: [{ family: "Mali", load: () => Promise.reject(new Error("no file")) }] })
    await failing.ready
    expect(failing.timeline()).toBeDefined()
    expect(failing.warnings).toEqual(["host: font Mali did not load"])
  })

  test("waits for the pictures to decode, and one that fails, or cannot be decoded, does not hold the render up", async () => {
    const decoding = held()
    const page = load({ images: [{ decode: () => decoding.promise }, {}] })
    await settle()
    expect(page.timeline()).toBeUndefined()
    decoding.release()
    await page.ready
    expect(page.timeline()).toBeDefined()

    const failing = load({ images: [{ decode: () => Promise.reject(new Error("bad picture")) }] })
    await failing.ready
    expect(failing.timeline()).toBeDefined()
  })

  test("leaves what is already on the window alone: other timelines, and the other promises the render waits for", async () => {
    const fonts = Promise.resolve()
    const page = load({ window: { __timelines: { other: { id: 1 } }, __hf: { buildReady: { fonts } } } })
    await page.ready
    expect(page.win.__timelines).toMatchObject({ other: { id: 1 } })
    expect(page.win.__timelines?.main).toBeDefined()
    expect(page.win.__hf?.buildReady?.fonts).toBe(fonts)
    expect(page.win.__hf?.buildReady?.host).toBe(page.ready)
  })

  test("draws time 0 as it registers: every animation is paused and set to the start", async () => {
    const animation = fakeAnimation()
    const page = load({ animations: [animation] })
    expect(animation.seen.currentTime).toBeNull()
    await page.ready
    expect(animation.seen.pauses).toBe(1)
    expect(animation.seen.currentTime).toBe(0)
    expect(page.timeline()!.time()).toBe(0)
  })

  test("totalTime(t) pauses every animation and sets its time to t in milliseconds; asked for nothing it answers the time", async () => {
    const animations = [fakeAnimation(), fakeAnimation()]
    const page = load({ animations })
    await page.ready
    const timeline = page.timeline()!
    expect(timeline.totalTime(1.5)).toBe(timeline)
    for (const animation of animations) {
      expect(animation.seen.currentTime).toBe(1500)
      expect(animation.seen.pauses).toBe(2)
    }
    expect(timeline.totalTime()).toBe(1.5)
    expect(timeline.time()).toBe(1.5)
    // any order: back to an earlier time draws that time from scratch
    timeline.totalTime(0.25)
    expect(animations[0]!.seen.currentTime).toBe(250)
  })

  test("seek(t) draws the same, clamped to the composition: past its end is the end, before its start the start, and no number the start", async () => {
    const animation = fakeAnimation()
    const page = load({ animations: [animation], duration: "3" })
    await page.ready
    const timeline = page.timeline()!
    expect(timeline.seek(9)).toBe(timeline)
    expect(animation.seen.currentTime).toBe(3000)
    expect(timeline.time()).toBe(3)
    timeline.seek(-2)
    expect(animation.seen.currentTime).toBe(0)
    timeline.seek(2)
    timeline.seek(Number.NaN)
    expect(animation.seen.currentTime).toBe(0)
    expect(timeline.totalTime(9)).toBe(timeline)
    expect(animation.seen.currentTime).toBe(3000)
  })

  test("progress(p) draws that share of the length, and asked for nothing answers how far it has got; pause() pauses everything; play() starts nothing", async () => {
    const animation = fakeAnimation()
    const page = load({ animations: [animation], duration: "4" })
    await page.ready
    const timeline = page.timeline()!
    expect(timeline.progress()).toBe(0)
    expect(timeline.progress(0.5)).toBe(timeline)
    expect(animation.seen.currentTime).toBe(2000)
    expect(timeline.progress()).toBe(0.5)
    const pauses = animation.seen.pauses
    expect(timeline.pause()).toBe(timeline)
    expect(animation.seen.pauses).toBe(pauses + 1)
    expect(timeline.play()).toBe(timeline)
    expect(animation.seen.pauses).toBe(pauses + 1)
    expect(animation.seen.currentTime).toBe(2000)
  })

  test("drives an animation that starts after the host is loaded as it does the rest", async () => {
    const animations: FakeAnimation[] = []
    const page = load({ animations })
    await page.ready
    const late = fakeAnimation()
    animations.push(late)
    page.timeline()!.totalTime(1)
    expect(late.seen.currentTime).toBe(1000)
  })

  test("calls window.frame with the time on every draw, after the animations are set, and finds it at each draw", async () => {
    const log: string[] = []
    const frame = vi.fn((t: number) => log.push(`frame ${t}`))
    const page = load({ animations: [fakeAnimation(false, log)], window: { frame } })
    await page.ready
    expect(frame).toHaveBeenCalledTimes(1)
    expect(frame).toHaveBeenLastCalledWith(0)
    page.timeline()!.totalTime(1.5)
    expect(frame).toHaveBeenLastCalledWith(1.5)
    // the time it is given is the clamped one
    page.timeline()!.seek(9)
    expect(frame).toHaveBeenLastCalledWith(3)
    page.timeline()!.progress(0.5)
    expect(frame).toHaveBeenLastCalledWith(1.5)
    expect(frame).toHaveBeenCalledTimes(4)
    expect(log.slice(0, 4)).toEqual(["set 0", "frame 0", "set 1500", "frame 1.5"])
    // one set after the host loaded is used from then on, and a function that is replaced is replaced
    const later = vi.fn()
    page.win.frame = later
    page.timeline()!.totalTime(2)
    expect(later).toHaveBeenCalledWith(2)
    expect(frame).toHaveBeenCalledTimes(4)
  })

  test("draws without window.frame, or with one that is not a function", async () => {
    const animation = fakeAnimation()
    const none = load({ animations: [animation] })
    await none.ready
    expect(() => none.timeline()!.totalTime(1)).not.toThrow()
    expect(animation.seen.currentTime).toBe(1000)
    const notAFunction = load({ animations: [fakeAnimation()], window: { frame: "nope" } })
    await notAFunction.ready
    expect(() => notAFunction.timeline()!.totalTime(1)).not.toThrow()
  })

  test("an animation that refuses a time does not stop the others, or window.frame, and is warned of", async () => {
    const good = [fakeAnimation(), fakeAnimation()]
    const bad = fakeAnimation(true)
    const frame = vi.fn()
    const page = load({ animations: [good[0]!, bad, good[1]!], window: { frame } })
    await page.ready
    page.timeline()!.totalTime(1)
    expect(good.map((animation) => animation.seen.currentTime)).toEqual([1000, 1000])
    expect(bad.seen.pauses).toBe(2)
    expect(frame).toHaveBeenLastCalledWith(1)
    // once as it registered and once for the draw
    expect(page.warnings).toEqual(["host: an animation could not be set: this animation refuses a time", "host: an animation could not be set: this animation refuses a time"])
  })

  test("a window.frame that throws is reported through console.error, once for each distinct message, and stops nothing: the animations are set on that draw and the later ones, and the timeline is registered all the same", async () => {
    const animation = fakeAnimation()
    let message = "boom"
    const frame = vi.fn((): void => {
      throw new Error(message)
    })
    const page = load({ animations: [animation], window: { frame } })
    // the render waits on this: a rejection here would leave it waiting its whole 20 s for a timeline
    await expect(page.ready).resolves.toBeUndefined()
    expect(page.timeline()).toBeDefined()
    expect(animation.seen.currentTime).toBe(0)
    expect(page.errors).toEqual(["BOXBLACK motion error: window.frame threw: boom"])
    // the same message on a later draw is not said again, and the draw itself goes through
    expect(() => page.timeline()!.totalTime(1)).not.toThrow()
    expect(animation.seen.currentTime).toBe(1000)
    expect(frame).toHaveBeenCalledTimes(2)
    expect(page.errors).toHaveLength(1)
    // another message is said, once
    message = "bang"
    page.timeline()!.seek(2)
    page.timeline()!.seek(2.5)
    expect(animation.seen.currentTime).toBe(2500)
    expect(page.errors).toEqual(["BOXBLACK motion error: window.frame threw: boom", "BOXBLACK motion error: window.frame threw: bang"])
    // what is thrown need not be an error: it is reported as it reads
    frame.mockImplementation(() => {
      throw "just words"
    })
    page.timeline()!.progress(1)
    expect(animation.seen.currentTime).toBe(3000)
    expect(page.errors.at(-1)).toBe("BOXBLACK motion error: window.frame threw: just words")
    expect(page.warnings).toEqual([])
  })

  test("reports, before the first draw, an SVG element that has a transform attribute and an animation of its transform, by its tag and class, once", async () => {
    const log: string[] = []
    const icon = new FakeSvgElement("g", { class: "icn i1", transform: "translate(180 300)" })
    // two animations of the one element are one report; the second says outright that it replaces what is there
    const page = load({ animations: [fakeAnimation(false, log, moving(icon)), fakeAnimation(false, log, moving(icon, "replace"))], log })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <g class="icn i1">${REPLACED}`])
    // said before anything is drawn, and the page is drawn and registered all the same
    expect(log).toEqual([`error BOXBLACK motion error: <g class="icn i1">${REPLACED}`, "set 0", "set 0"])
    expect(page.timeline()).toBeDefined()
    // looked for once, not at every draw
    page.timeline()!.totalTime(1)
    page.timeline()!.totalTime(2)
    expect(page.errors).toHaveLength(1)
  })

  test("names each such element, in the order the page lists their animations, and one with no class by its tag alone", async () => {
    const first = new FakeSvgElement("g", { class: "icn i1", transform: "translate(180 300)" })
    const second = new FakeSvgElement("rect", { transform: "rotate(45)" })
    const page = load({ animations: [fakeAnimation(false, [], moving(first)), fakeAnimation(), fakeAnimation(false, [], moving(second))] })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <g class="icn i1">${REPLACED}`, `BOXBLACK motion error: <rect>${REPLACED}`])
  })

  test("says it once for elements it cannot tell apart: those with the same tag and class share one report", async () => {
    const twins = [new FakeSvgElement("g", { class: "icn", transform: "translate(180 300)" }), new FakeSvgElement("g", { class: "icn", transform: "translate(540 300)" })]
    const other = new FakeSvgElement("g", { class: "icn big", transform: "translate(900 300)" })
    const page = load({ animations: [...twins, other].map((element) => fakeAnimation(false, [], moving(element))) })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <g class="icn">${REPLACED}`, `BOXBLACK motion error: <g class="icn big">${REPLACED}`])
  })

  test("reports nothing when the attribute is not replaced: an element without one, an HTML element, an animation that adds to what is there, and one of something other than the transform", async () => {
    const placed = { class: "icn", transform: "translate(180 300)" }
    const html = { tagName: "DIV", getAttribute: (name: string) => (name === "class" ? "icn" : "translate(1 1)"), hasAttribute: () => true }
    const fading: FakeEffect = { target: new FakeSvgElement("g", placed), getKeyframes: () => [{ offset: 0, opacity: "0" }, { offset: 1, opacity: "1", transform: null }] }
    const page = load({
      animations: [
        fakeAnimation(false, [], moving(new FakeSvgElement("g", { class: "icn" }))),
        fakeAnimation(false, [], moving(html)),
        fakeAnimation(false, [], moving(new FakeSvgElement("g", placed), "add")),
        fakeAnimation(false, [], moving(new FakeSvgElement("g", placed), "accumulate")),
        fakeAnimation(false, [], fading),
        fakeAnimation(false, [], moving(null)),
      ],
    })
    await page.ready
    expect(page.errors).toEqual([])
    expect(page.timeline()).toBeDefined()
  })

  test("passes over an effect that throws when it is read, and still looks at the rest and registers", async () => {
    const placed = { class: "icn", transform: "translate(180 300)" }
    const noTarget: FakeEffect = {
      get target(): unknown {
        throw new Error("this effect has no target to give")
      },
      getKeyframes: () => [],
    }
    const noKeyframes: FakeEffect = {
      target: new FakeSvgElement("g", placed),
      getKeyframes() {
        throw new Error("this effect has no keyframes to give")
      },
    }
    const animations = [fakeAnimation(false, [], noTarget), fakeAnimation(false, [], noKeyframes), fakeAnimation(false, [], moving(new FakeSvgElement("path", placed)))]
    const page = load({ animations })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <path class="icn">${REPLACED}`])
    expect(page.timeline()).toBeDefined()
    // and every one of them is drawn
    expect(animations.map((animation) => animation.seen.currentTime)).toEqual([0, 0, 0])
  })

  test("reports, before the first draw, an element whose later animation of a property fills backwards over an earlier one and so changes what shows: the countdown whose digits all showed at once, once for each element", async () => {
    const log: string[] = []
    const frame = vi.fn()
    const page = load({ log, animations: countdown({}, log), window: { frame } })
    await page.ready
    // the message as the repair call reads it, for the second digit
    expect(page.errors).toContain(
      'BOXBLACK motion error: <span class="num n2"> has two animations of opacity, and the later one (shrinkOut) fills backwards: before it starts, its first frame shows and hides the earlier one (slam). Give the later one animation-fill-mode forwards, or put it on a wrapping element',
    )
    // each digit, and the dial, whose fade in the fade out hides as well; what has one animation is not named
    expect(page.errors).toEqual([
      `BOXBLACK motion error: <div class="cen dial">${hidden("opacity", "fadeOut", "dialIn")}`,
      `BOXBLACK motion error: <span class="num n3">${hidden("opacity", "shrinkOut", "slam")}`,
      `BOXBLACK motion error: <span class="num n2">${hidden("opacity", "shrinkOut", "slam")}`,
      `BOXBLACK motion error: <span class="num n1">${hidden("opacity", "shrinkOut", "slam")}`,
    ])
    // each measured a tenth of the way through the entrance (which is over before the exit starts), where it already
    // reads differently, so halfway is not needed; then the times the page had are put back (it had none, here), and
    // only then is time 0 drawn: said before anything is drawn, and the page is drawn and registered all the same
    expect(log).toEqual(["set 30", `error ${page.errors[0]}`, "set 432", `error ${page.errors[1]}`, "set 952", `error ${page.errors[2]}`, "set 1652", `error ${page.errors[3]}`, "set null", "set 0"])
    // the measuring draws nothing: window.frame is called by the draw alone
    expect(frame.mock.calls).toEqual([[0]])
    expect(page.timeline()).toBeDefined()
    // looked for once, not at every draw
    page.timeline()!.totalTime(1)
    page.timeline()!.totalTime(2)
    expect(page.errors).toHaveLength(4)
  })

  test("reports nothing for the same countdown when its exits start from the value underneath: their first frame is the entrance's own, so their fill changes nothing that shows", async () => {
    // Chrome lists a first keyframe for an exit that has none of its own, so the keyframes alone cannot tell this
    // countdown from the one above; the dial's fade out still has a first frame of its own
    const page = load({ animations: countdown({ startsUnderneath: true }) })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <div class="cen dial">${hidden("opacity", "fadeOut", "dialIn")}`])
  })

  test("measures at two times while the earlier animation runs, a tenth of the way in and halfway: an entrance that is done fading by halfway is caught by the first, and a pulse that starts where the exit does by the second", async () => {
    // fades in over the first 40 % and holds, so halfway it reads as the exit's first frame does: only the tenth tells
    const fast = [frame(0, { opacity: "0" }), frame(0.4, { opacity: "1" }), frame(1, { opacity: "1" })]
    const fastLog: string[] = []
    const plate = new FakeHtmlElement("div", { class: "plate" })
    const fading = load({
      log: fastLog,
      animations: [timed(plate, fast, { delay: 400, duration: 500, fill: "both", animationName: "fadeIn", log: fastLog }), timed(plate, FADE_OUT, { delay: 2300, duration: 300, fill: "both", animationName: "fadeOut" })],
    })
    await fading.ready
    expect(fading.errors).toEqual([`BOXBLACK motion error: <div class="plate">${hidden("opacity", "fadeOut", "fadeIn")}`])
    // a tenth of the way through 400 to 900 ms, and no further
    expect(fastLog).toEqual(["set 450", `error ${fading.errors[0]}`, "set null", "set 0"])

    // starts and ends where the exit starts and dips between, so only halfway tells
    const pulse = [frame(0, { opacity: "1" }), frame(0.5, { opacity: "0.5" }), frame(1, { opacity: "1" })]
    const pulseLog: string[] = []
    const ring = new FakeHtmlElement("div", { class: "ring" })
    const pulsing = load({
      log: pulseLog,
      animations: [timed(ring, pulse, { delay: 400, duration: 500, fill: "both", animationName: "throb", log: pulseLog }), timed(ring, FADE_OUT, { delay: 2300, duration: 300, fill: "both", animationName: "fadeOut" })],
    })
    await pulsing.ready
    expect(pulsing.errors).toEqual([`BOXBLACK motion error: <div class="ring">${hidden("opacity", "fadeOut", "throb")}`])
    expect(pulseLog).toEqual(["set 450", "set 650", `error ${pulsing.errors[0]}`, "set null", "set 0"])

    // and an exit that starts from the value underneath is read the same at both, and not reported
    const quiet: string[] = []
    const still = new FakeHtmlElement("div", { class: "still" })
    const underneath = load({
      animations: [timed(still, fast, { delay: 400, duration: 500, fill: "both", animationName: "fadeIn", log: quiet }), timed(still, FADE_OUT, { delay: 2300, duration: 300, fill: "both", animationName: "fadeOut", startsUnderneath: true })],
    })
    await underneath.ready
    expect(underneath.errors).toEqual([])
    expect(quiet).toEqual(["set 450", "set 650", "set null", "set 0"])
  })

  test("puts the later animation's fill back as it was, also when a read of the style throws, and the page's times too, for the draw", async () => {
    const log: string[] = []
    const digit = new FakeHtmlElement("span", { class: "num n3" })
    const slam = timed(digit, SLAM, { delay: 400, duration: 320, fill: "both", animationName: "slam", log })
    const shrinkOut = timed(digit, SHRINK_OUT, { delay: 940, duration: 160, fill: "both", animationName: "shrinkOut", log })
    // the page has run for 40 ms when the host looks
    slam.seen.currentTime = 40
    shrinkOut.seen.currentTime = 40
    const page = load({ log, animations: [slam, shrinkOut] })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <span class="num n3">${hidden("opacity", "shrinkOut", "slam")}`])
    // both set a tenth of the way through the entrance, the exit's fill set forwards and put back, then the times the
    // page had, then time 0 drawn
    expect(log).toEqual(["set 432", "set 432", "fill forwards", "fill both", `error ${page.errors[0]}`, "set 40", "set 40", "set 0", "set 0"])
    expect(shrinkOut.effect!.getTiming!().fill).toBe("both")
    expect([slam.seen.currentTime, shrinkOut.seen.currentTime]).toEqual([0, 0])

    // a style that cannot be read once the fill is forwards: nothing is reported, and the fill and the times are put back all the same
    const pair = () => {
      const again = new FakeHtmlElement("span", { class: "num n2" })
      return [timed(again, SLAM, { delay: 920, duration: 320, fill: "both", animationName: "slam" }), timed(again, SHRINK_OUT, { delay: 1640, duration: 160, fill: "backwards", animationName: "shrinkOut" })]
    }
    const unread = pair()
    const measured = computedStyle(unread)
    const throwing = load({
      animations: unread,
      getComputedStyle: (target, pseudoElement) => {
        if (unread[1]!.effect!.getTiming!().fill === "forwards") throw new Error("no style to give")
        return measured(target, pseudoElement ?? null)
      },
    })
    await throwing.ready
    expect(throwing.errors).toEqual([])
    expect(unread[1]!.effect!.getTiming!().fill).toBe("backwards")
    expect(unread.map((animation) => animation.seen.currentTime)).toEqual([0, 0])
    expect(throwing.timeline()).toBeDefined()

    // nor when no style can be read at all, when the fill is never changed
    const none = pair()
    const never = load({
      animations: none,
      getComputedStyle: () => {
        throw new Error("no style to give")
      },
    })
    await never.ready
    expect(never.errors).toEqual([])
    expect(none[1]!.effect!.getTiming!().fill).toBe("backwards")
    expect(never.timeline()).toBeDefined()
  })

  test("says it once for elements it cannot tell apart whose exit hides their entrance: those with the same tag and class share one report", async () => {
    const twins = [new FakeHtmlElement("span", { class: "num" }), new FakeHtmlElement("span", { class: "num" })]
    const other = new FakeHtmlElement("span", { class: "num big" })
    const page = load({
      animations: [...twins, other].flatMap((element, i) => [
        timed(element, SLAM, { delay: 300 + i * 500, fill: "both", animationName: "slam" }),
        timed(element, SHRINK_OUT, { delay: 2300, fill: "both", animationName: "shrinkOut" }),
      ]),
    })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <span class="num">${hidden("opacity", "shrinkOut", "slam")}`, `BOXBLACK motion error: <span class="num big">${hidden("opacity", "shrinkOut", "slam")}`])
  })

  test("reports nothing for an entrance and an exit where the exit fills forwards or not at all, adds to what is there, or starts no later than the entrance", async () => {
    const digit = (n: number) => new FakeHtmlElement("span", { class: `num n${n}` })
    const pair = (element: unknown, exit: { delay: number; fill: string; composite?: string }) => [
      timed(element, SLAM, { delay: 400, fill: "both", animationName: "slam" }),
      timed(element, SHRINK_OUT, { ...exit, animationName: "shrinkOut" }),
    ]
    const page = load({
      animations: [
        ...pair(digit(1), { delay: 2300, fill: "forwards" }),
        ...pair(digit(2), { delay: 2300, fill: "none" }),
        ...pair(digit(3), { delay: 2300, fill: "both", composite: "add" }),
        ...pair(digit(4), { delay: 2300, fill: "both", composite: "accumulate" }),
        ...pair(digit(5), { delay: 400, fill: "both" }),
        ...pair(digit(6), { delay: 100, fill: "both" }),
      ],
    })
    await page.ready
    expect(page.errors).toEqual([])
    expect(page.timeline()).toBeDefined()
  })

  test("reports nothing for two animations of different properties, though every keyframe says where it sits, its easing and how it composites", async () => {
    const icon = new FakeHtmlElement("div", { class: "icon" })
    const plate = new FakeHtmlElement("div", { class: "plate" })
    const page = load({
      animations: [
        timed(icon, TURN, { delay: 200, fill: "both", animationName: "turn" }),
        timed(icon, FADE_OUT, { delay: 2300, fill: "both", animationName: "fadeOut" }),
        // a property a keyframe holds no value for is not one it animates
        timed(plate, [frame(0, { transform: "scale(0)", opacity: null }), frame(1, { transform: "scale(1)" })], { delay: 200, fill: "both", animationName: "grow" }),
        timed(plate, FADE_OUT, { delay: 2300, fill: "both", animationName: "fadeOut" }),
      ],
    })
    await page.ready
    expect(page.errors).toEqual([])
  })

  test("reports nothing when the exit is on a wrapping element: the entrance and the exit each have an element of their own", async () => {
    const wrap = new FakeHtmlElement("div", { class: "out" })
    const digit = new FakeHtmlElement("span", { class: "num n2" })
    const page = load({
      animations: [
        timed(wrap, FADE_OUT, { delay: 2300, fill: "both", animationName: "fadeOut" }),
        timed(digit, SLAM, { delay: 900, fill: "both", animationName: "slam" }),
      ],
    })
    await page.ready
    expect(page.errors).toEqual([])
  })

  test("reports a pair el.animate() made, naming each by its id or as an el.animate() animation, and says to give the later one fill forwards; one that fills backwards alone is reported too", async () => {
    const plate = new FakeHtmlElement("div", { class: "plate" })
    const badge = new FakeHtmlElement("span", { class: "badge" })
    const page = load({
      animations: [
        // CSS animations come first in the order the page lists them, whatever the script did
        timed(badge, DIAL_IN, { delay: 200, fill: "both", animationName: "pop" }),
        timed(plate, [frame(0, { opacity: "0" }), frame(1, { opacity: "1" })], { delay: 300, fill: "both" }),
        timed(plate, FADE_OUT, { delay: 2500, fill: "both", id: "leave" }),
        timed(badge, TURN, { delay: 2000, fill: "backwards" }),
      ],
    })
    await page.ready
    // element by element, in the order the page first lists each
    expect(page.errors).toEqual([
      `BOXBLACK motion error: <span class="badge">${hidden("transform", "an el.animate() animation", "pop", 'fill: "forwards"')}`,
      `BOXBLACK motion error: <div class="plate">${hidden("opacity", "leave", "an el.animate() animation", 'fill: "forwards"')}`,
    ])
  })

  test("keeps an element and its pseudo-elements apart, and names a pseudo-element by its element", async () => {
    const tag = new FakeHtmlElement("span", { class: "tag" })
    const page = load({
      animations: [
        timed(tag, SLAM, { delay: 400, fill: "both", animationName: "slam" }),
        timed(tag, SHRINK_OUT, { delay: 2300, fill: "both", animationName: "shrinkOut", pseudoElement: "::before" }),
        timed(tag, DIAL_IN, { delay: 200, fill: "both", animationName: "dialIn", pseudoElement: "::after" }),
        timed(tag, FADE_OUT, { delay: 2300, fill: "both", animationName: "fadeOut", pseudoElement: "::after" }),
      ],
    })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <span class="tag">::after${hidden("opacity", "fadeOut", "dialIn")}`])
  })

  test("passes over an animation whose timing or keyframes cannot be read, and still looks at the rest and registers", async () => {
    const digits = [1, 2, 3].map((n) => new FakeHtmlElement("span", { class: `num n${n}` }))
    const noTiming = timed(digits[0], SHRINK_OUT, { delay: 2300, fill: "both", animationName: "shrinkOut" })
    noTiming.effect!.getTiming = () => {
      throw new Error("this effect has no timing to give")
    }
    const noKeyframes = timed(digits[1], SHRINK_OUT, { delay: 2300, fill: "both", animationName: "shrinkOut" })
    noKeyframes.effect!.getKeyframes = () => {
      throw new Error("this effect has no keyframes to give")
    }
    const animations = [
      timed(digits[0], SLAM, { delay: 400, fill: "both", animationName: "slam" }),
      noTiming,
      timed(digits[1], SLAM, { delay: 1100, fill: "both", animationName: "slam" }),
      noKeyframes,
      timed(digits[2], SLAM, { delay: 1800, fill: "both", animationName: "slam" }),
      timed(digits[2], SHRINK_OUT, { delay: 2300, fill: "both", animationName: "shrinkOut" }),
    ]
    const page = load({ animations })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <span class="num n3">${hidden("opacity", "shrinkOut", "slam")}`])
    expect(page.timeline()).toBeDefined()
    expect(animations.map((animation) => animation.seen.currentTime)).toEqual([0, 0, 0, 0, 0, 0])
  })

  test("still reports an SVG element whose transform attribute an animation replaces, first, and the same element's exit that hides its entrance after it, each once and before the first draw", async () => {
    const log: string[] = []
    const icon = new FakeSvgElement("g", { class: "icn", transform: "translate(180 300)" })
    const page = load({
      log,
      animations: [
        timed(icon, DIAL_IN, { delay: 200, fill: "both", animationName: "pop", log }),
        timed(icon, SHRINK_OUT, { delay: 2300, fill: "both", animationName: "shrinkOut" }),
      ],
    })
    await page.ready
    expect(page.errors).toEqual([`BOXBLACK motion error: <g class="icn">${REPLACED}`, `BOXBLACK motion error: <g class="icn">${hidden("opacity", "shrinkOut", "pop")}`])
    // the transform first, then the measuring a tenth of the way through the entrance, then the time 0 drawn
    expect(log).toEqual([`error ${page.errors[0]}`, "set 230", `error ${page.errors[1]}`, "set null", "set 0"])
  })

  test("is inlined into the page motionHtml builds as it is, last, and reads the length the page's root gives it", async () => {
    const assets = await motionAssets(DIR)
    expect(assets.host).toBe(HOST)
    const html = motionHtml({
      html: "<style>@keyframes a{to{opacity:0}}</style><div>ก</div>",
      stage: { width: 864, height: 768 },
      seconds: 2.5,
      fps: 30,
      times: [0.2],
      palette: HIGHLIGHT_STYLES["bold-white"].palette,
      font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" },
      assets,
    })
    expect(html.endsWith(`<script>\n${HOST}\n    </script>\n  </body>\n</html>\n`)).toBe(true)
    // the length the page's root states is the one the timeline reports
    const seconds = html.match(/<div id="root"[^>]* data-duration="([^"]*)"/)?.[1]
    expect(seconds).toBe("2.5")
    const page = load({ duration: seconds })
    await page.ready
    expect(page.timeline()!.duration()).toBe(2.5)
  })
})

/**
 * HyperFrames 0.8.65 drops any inline script that carries one of these (case aside for the file names), taking the
 * script with it: the render then comes out empty with no error at all. Copied from RUNTIME_SRC_MARKERS and
 * RUNTIME_INLINE_MARKERS in hyperframes 0.8.65's core/dist/compiler/htmlDocument.js (bundled into its dist/cli.js).
 */
const RUNTIME_MARKERS = [
  "hyperframe.runtime.iife.js",
  "hyperframes-runtime.modular.inline.js",
  "hyperframe-runtime.modular-runtime.inline.js",
  "data-hyperframes-preview-runtime",
  "__hyperframeRuntimeBootstrapped",
  "__hyperframeRuntime",
  "__hyperframeRuntimeTeardown",
  "__HF_EXPORT_RENDER_SEEK_CONFIG",
  "window.__player =",
]

describe("the shipped host", () => {
  test("never names HyperFrames' own runtime, which would get it stripped from the page", () => {
    for (const marker of RUNTIME_MARKERS) expect(HOST.toLowerCase(), marker).not.toContain(marker.toLowerCase())
  })

  test("cannot end its own inline element early", () => {
    expect(HOST).not.toMatch(/<\/script/i)
    expect(HOST).not.toContain("<!--")
  })

  test("says in its header what HyperFrames asks of the timeline it hands over, and that the app gives the page 20 s to be ready, not the 45 s a bare HyperFrames waits", () => {
    const header = HOST.slice(0, HOST.indexOf(";(function"))
    expect(header.trimStart().startsWith("/*")).toBe(true)
    for (const fact of ['window.__timelines["main"]', "window.__hf.buildReady", "duration()", "pause()", "totalTime(", "seek(", "0.8.65", "window.frame", "getAnimations"]) expect(header, fact).toContain(fact)
    // graphics-render.ts renders with --player-ready-timeout 20000
    expect(header).toContain("--player-ready-timeout 20000")
    expect(header).toContain("20 s")
    expect(header).not.toContain("45 s")
  })

  test("says in its header what it reports through console.error, which is how the app learns of it: an error window.frame throws, an SVG element whose transform attribute an animation replaces, and an element whose later animation fills backwards over an earlier one", () => {
    const header = HOST.slice(0, HOST.indexOf(";(function")).replace(/\s*\n \* ?/g, " ")
    // graphics-render.ts finds its reports in the renderer's output by this prefix
    expect(header).toContain('console.error with the prefix "BOXBLACK motion error: "')
    expect(header).toContain("An error thrown by window.frame is caught and reported once per distinct message")
    expect(header).toContain("the timeline still registers")
    expect(header).toContain("Before the first draw the host reports, the same way, each SVG element that has a transform attribute and an animation of its transform")
    expect(header).toContain("the animation replaces the attribute and the element jumps to the corner of the drawing")
    // an exit that fills backwards over the entrance of the same property, which the inspection of the render cannot see
    expect(header).toContain("It reports too each element with two animations of one property where the later one, in the order the page composites them, starts later and fills backwards")
    expect(header).toContain("and that fill changes what shows: until it starts its first frame shows over the earlier one, which never shows")
    // the keyframes cannot tell an exit that starts from its own first frame from one that starts from the value underneath, so it is measured
    expect(header).toContain("so it is measured: every animation is set to two times while the earlier one runs and before the later one starts, a tenth of the way in and halfway")
    expect(header).toContain("the computed style is read with the later one's fill as it is and set to forwards")
    expect(header).toContain("The fill and the times are put back before the first draw")
    expect(header).toContain("A later animation that adds to what is there hides nothing")
    // a report names an element by its tag and class alone, and each distinct report is made once
    expect(header).toContain("A report names the element by its tag and class, and an animation by its name")
    expect(header).toContain("Elements with the same tag and class share one report")
    expect(header).toContain("An effect or a style that cannot be read is not checked")
    expect(header).not.toContain("every SVG element")
  })
})
