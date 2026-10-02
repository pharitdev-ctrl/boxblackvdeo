import { expect, test, vi } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import type { EmphasisPoint } from "@boxblack/core/emphasis"
import type { FlairLevel } from "@boxblack/core/flair/catalogue"
import { FREE_PLAN_PROMPT } from "@boxblack/core/graphics/motion/free"
import { MOTION_CONTRACT } from "@boxblack/core/graphics/motion/write"
import { MOTION_VERSION, type GraphicCue, type MotionSpec } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import { lintCompose } from "@boxblack/core/sound/lint"
import { SOUND_CONTRACT, soundBrief, soundEditBrief } from "@boxblack/core/sound/write"
import type { AppEvent, PostRequest } from "../shared/api.ts"
import { CANCELLED } from "./ai-calls.ts"
import { hashOfHtml } from "./composed-cues.ts"
import { createFlairService, type FlairDeps } from "./flair.ts"
import { transcriptFingerprint } from "./footage.ts"
import { createHighlightService } from "./highlights.ts"
import { createPostPlanService, type PostPlanDeps } from "./post-plan.ts"
import type { SoundJob } from "./sound-render.ts"
import { CLIP_ID, s, setup, transcript } from "./timeline-fixture.ts"

// Redo, edit, undo, off and remove of composed sounds, and how a sound tied to a graphic follows it, on the fixture
// draft. The rough cut plays ขึ้น ไป ใน อวกาศ ใน (0.15 s to 2.77 s, one piece) and the second สาม สอง หนึ่ง (2.92 s on,
// a piece of its own to the end). อวกาศ is said 1.07 s in, and its piece leaves 1.7 s from there.

const POINTS: EmphasisPoint[] = [
  { id: "p-space", anchor: { kind: "speech", videoId: CLIP_ID, from: 3, to: 4, beatId: "beat-1" }, importance: "key", type: "place", reason: "ไปอวกาศ", source: "ai", edited: false },
  { id: "p-count", anchor: { kind: "speech", videoId: CLIP_ID, from: 8, to: 11, beatId: "beat-1" }, importance: "secondary", type: "number", reason: "นับถอยหลัง", source: "ai", edited: false },
]
const FLAIR = { enabled: true, level: "medium" as FlairLevel, text: true, sound: true, zoom: true, insert: true, graphic: true }
const request = (flair: Partial<typeof FLAIR> = {}): PostRequest => ({
  rules: DEFAULT_CUT_RULES,
  view: { position: "auto", subtitlesOn: false, highlightsOn: true, flair: { ...FLAIR, ...flair } },
  subtitles: null,
})
const ABOUT = "นักบินอวกาศ"
const PALETTE = "Key: C major\nInstruments: soft sine bells"
/** Codes the linter passes, each told apart from the others. */
const GOOD = "function compose(ctx, cue, kit) { }"
const MENDED = "function compose(ctx, cue, kit) { const o = ctx.createOscillator() }"
const LOUDER = "function compose(ctx, cue, kit) { const g = ctx.createGain() }"
/** Code the linter refuses, for the network. */
const FETCHES = "function compose(ctx, cue, kit) { fetch('x') }"
const at = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
const STYLE = HIGHLIGHT_STYLES["bold-white"]
const SPACE_WORDS = [
  { text: "อวกาศ", atS: 0 },
  { text: "ใน", atS: 0.92 },
]
/** A written graphic on อวกาศ, fresh: written for the 1.7 s its piece leaves it and the words said in that time. */
const FRAGMENT = '<style>.r{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="r">อวกาศ</div>'
const REDRAWN = '<style>.q{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="q">จรวด</div>'
const ON_SPACE: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.72 }, seconds: 1.7, why: "", idea: "จรวดพุ่งขึ้นไปอวกาศ", words: SPACE_WORDS, html: FRAGMENT }
const ROCKET: GraphicCue = { anchor: at(s(18.08)), spec: ON_SPACE, edited: false, off: false, pointId: "p-space" }

/** A composed sound of Claude's as a composing left it, fresh on อวกาศ: 1.7 s with the words said in it. */
const SPACE: ComposedSound = { anchor: at(s(18.08)), pointId: "p-space", from: "light", role: "วูบขึ้นตอนอวกาศ", loudness: "strong", seconds: 1.7, words: SPACE_WORDS, code: GOOD, version: SOUND_VERSION, off: false }
/** A sound on the countdown, 2 s from the second สาม. */
const COUNT: ComposedSound = { anchor: at(s(22.62)), pointId: "p-count", from: "medium", role: "นับถอยหลัง", loudness: "normal", seconds: 2, words: [{ text: "สาม", atS: 0 }, { text: "สอง", atS: 1.26 }], code: GOOD, version: SOUND_VERSION, off: false }
/** A sound tied to the rocket, composed to its fragment. */
const TIED: ComposedSound = { ...SPACE, role: "จรวดพุ่ง", graphic: ROCKET.anchor, graphicHtml: hashOfHtml(FRAGMENT) }

/** One transport for every call, each prompt with the reply set for it; a reply that is a function is asked with the call. */
function fakeClaude() {
  const requests: LlmRequest<unknown>[] = []
  const replies = new Map<string, unknown>()
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(asked: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(asked as LlmRequest<unknown>)
      if (asked.signal?.aborted) throw asked.signal.reason
      const reply = replies.get(asked.system) ?? {}
      const output = typeof reply === "function" ? await (reply as (call: LlmRequest<unknown>) => unknown)(asked as LlmRequest<unknown>) : reply
      return { output: output as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { requests, replies, llm: async () => ({ transport, model: "claude-sonnet-5" }) }
}

const textOf = (content: LlmContent[]) => content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join("\n")

/** A renderer that passes every sound unless `verdict` says otherwise, and remembers what it was asked to check. */
function fakeRenderer(verdict: (job: SoundJob) => string[] | null = () => []) {
  return { check: vi.fn(async (job: SoundJob) => verdict(job)), forgetMachine: vi.fn() }
}

/** The fixture with its two points, the palette, these sounds and graphics stored, the services wired as the app wires them. */
async function withStored(sounds: ComposedSound[], graphics: GraphicCue[] = [], extra: Partial<FlairDeps> = {}) {
  const base = await setup({})
  await base.outlines.update(base.folder, (stored) => ({
    ...stored!,
    emphasis: { points: POINTS, version: 2, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
    flair: { looks: {}, graphics, composed: sounds, palette: PALETTE },
  }))
  const claude = fakeClaude()
  claude.replies.set(SOUND_CONTRACT, MENDED)
  claude.replies.set(MOTION_CONTRACT, REDRAWN)
  const renderer = fakeRenderer()
  const highlights = createHighlightService({ outlines: base.outlines, timeline: base.service, footage: base.deps, styleOf: async () => STYLE, graphicsReady: async () => true })
  const flair = createFlairService({
    outlines: base.outlines,
    timeline: base.service,
    llm: claude.llm,
    graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options),
    composedSounds: (folder, rules, options) => highlights.composedSounds(folder, rules, options),
    soundRenderer: renderer,
    ...extra,
  })
  const composed = async () => (await base.outlines.get(base.folder))!.flair?.composed ?? []
  const graphicsNow = async () => (await base.outlines.get(base.folder))!.flair?.graphics ?? []
  const briefs = () => claude.requests.filter((asked) => asked.system === SOUND_CONTRACT).map((asked) => textOf(asked.content))
  const placed = async (asked = request()) => highlights.composedSounds(base.folder, DEFAULT_CUT_RULES, asked.view)
  return { ...base, claude, renderer, highlights, flair, composed, graphicsNow, briefs, placed }
}

/** What a composing that replaces a sound's code keeps of it for one step back. */
const keptOf = (sound: ComposedSound) => ({
  code: sound.code!,
  seconds: sound.seconds,
  words: sound.words,
  version: sound.version,
  ...(sound.graphicHtml !== undefined ? { graphicHtml: sound.graphicHtml } : {}),
  ...(sound.instruction !== undefined ? { instruction: sound.instruction } : {}),
})

/* composed again */

test("a sound is composed again from its role for the room it has now, with the clip's palette: its code stays until the composing has ended, then gives way and is kept for one step back; the others are left alone", async () => {
  const edited = { ...SPACE, instruction: "เบาลง", editFailed: "the render failed" }
  const h = await withStored([edited, COUNT])
  let answer!: (code: string) => void
  let asked!: () => void
  const composing = new Promise<void>((resolve) => (asked = resolve))
  h.claude.replies.set(SOUND_CONTRACT, () => {
    asked()
    return new Promise<string>((resolve) => (answer = resolve))
  })
  const progress = vi.fn()
  const redoing = h.flair.redoSound(h.folder, SPACE.anchor, request(), undefined, progress)
  await composing
  expect(await h.composed()).toEqual([edited, COUNT])
  expect(progress.mock.calls).toEqual([[0, 1]])
  answer(MENDED)
  expect(await redoing).toEqual({ count: 1, dropped: 0 })
  // the change asked and why an edit failed are not about the new code
  expect(await h.composed()).toEqual([{ ...SPACE, code: MENDED, previous: keptOf(edited) }, COUNT])
  expect(progress.mock.calls).toEqual([[0, 1], [1, 1]])
  expect(h.briefs()).toEqual([soundBrief({ palette: PALETTE, about: ABOUT, role: SPACE.role, seconds: 1.7, words: SPACE_WORDS, loudness: "strong" })])
  // the machine was looked at afresh before the check, and the code checked as it is kept
  expect(h.renderer.forgetMachine).toHaveBeenCalledTimes(1)
  expect(h.renderer.forgetMachine.mock.invocationCallOrder[0]).toBeLessThan(h.renderer.check.mock.invocationCallOrder[0]!)
  expect(h.renderer.check.mock.calls).toEqual([[{ code: MENDED, seconds: 1.7, words: SPACE_WORDS, loudness: "strong" }]])
})

test("a sound gone stale is put right by composing it again for the words and the length it has now", async () => {
  // composed for one second more than its piece leaves it, and for other words
  const stale = { ...SPACE, seconds: 2.7, words: [{ text: "อวกาศ", atS: 0 }] }
  const h = await withStored([stale])
  expect((await h.placed()).kept.map((sound) => sound.stale)).toEqual(["cut"])
  await h.flair.redoSound(h.folder, SPACE.anchor, request())
  expect(await h.composed()).toEqual([{ ...SPACE, code: MENDED, previous: keptOf(stale) }])
  expect((await h.placed()).kept.map((sound) => sound.stale)).toEqual([null])
})

test("a composing again that fails leaves the sound with no code and why, the one it had kept for one step back; composed again well, the good one is still kept", async () => {
  const h = await withStored([SPACE])
  h.claude.replies.set(SOUND_CONTRACT, FETCHES)
  expect(await h.flair.redoSound(h.folder, SPACE.anchor, request())).toEqual({ count: 0, dropped: 1 })
  expect(await h.composed()).toEqual([{ ...SPACE, code: null, failed: lintCompose(FETCHES)[0], previous: keptOf(SPACE) }])
  h.claude.replies.set(SOUND_CONTRACT, LOUDER)
  expect(await h.flair.redoSound(h.folder, SPACE.anchor, request())).toEqual({ count: 1, dropped: 0 })
  expect(await h.composed()).toEqual([{ ...SPACE, code: LOUDER, previous: keptOf(SPACE) }])
})

test("a switched-off sound is composed again where it would play, and stays off", async () => {
  const h = await withStored([{ ...SPACE, off: true }])
  expect(await h.flair.redoSound(h.folder, SPACE.anchor, request())).toEqual({ count: 1, dropped: 0 })
  expect(await h.composed()).toEqual([{ ...SPACE, off: true, code: MENDED, previous: keptOf(SPACE) }])
})

test("a tied sound is composed again to its graphic's fragment as it is now, and stores that fragment's hash; the one before keeps the hash it had", async () => {
  const redrawn = { ...ROCKET, spec: { ...ON_SPACE, html: REDRAWN } }
  const h = await withStored([TIED], [redrawn])
  expect((await h.placed()).kept.map((sound) => sound.stale)).toEqual(["picture"])
  await h.flair.redoSound(h.folder, TIED.anchor, request())
  expect(await h.composed()).toEqual([{ ...TIED, graphicHtml: hashOfHtml(REDRAWN), code: MENDED, previous: keptOf(TIED) }])
  expect(h.briefs()).toEqual([soundBrief({ palette: PALETTE, about: ABOUT, role: TIED.role, seconds: 1.7, words: SPACE_WORDS, loudness: "strong", graphic: { idea: ON_SPACE.idea, html: REDRAWN } })])
  expect((await h.placed()).kept.map((sound) => sound.stale)).toEqual([null])
})

test("a sound with no place on the clip now is not composed again or edited: one the level hides, one that is not there, one whose graphic has no fragment, one whose graphic is not shown", async () => {
  const unwritten = { ...ROCKET, spec: { ...ON_SPACE, html: null } }
  const tiedLate = { ...TIED, anchor: at(s(23.88)), graphic: at(s(23.88)) }
  const h = await withStored([SPACE, COUNT, tiedLate], [{ ...unwritten, anchor: at(s(23.88)), pointId: "p-count" }])
  const noPlace = /^this sound has no place on the clip now$/
  // the one tied to a graphic not written yet is placed with it, and has no picture to score
  expect((await h.placed()).kept.map((placed) => [placed.sound.role, placed.graphic?.cue.spec.html])).toContainEqual([TIED.role, null])
  // the lightest level hides the countdown's point, which is secondary
  for (const call of [
    () => h.flair.redoSound(h.folder, COUNT.anchor, request({ level: "light" })),
    () => h.flair.editSound(h.folder, COUNT.anchor, "เบาลง", request({ level: "light" })),
    () => h.flair.redoSound(h.folder, at(s(17.16)), request()),
    () => h.flair.redoSound(h.folder, tiedLate.anchor, request()),
    () => h.flair.redoSound(h.folder, tiedLate.anchor, request({ graphic: false })),
    // with the sounds off none plays
    () => h.flair.redoSound(h.folder, SPACE.anchor, request({ sound: false })),
  ])
    await expect(call()).rejects.toThrow(noPlace)
  expect(h.claude.requests).toEqual([])
  expect(await h.composed()).toEqual([SPACE, COUNT, tiedLate])
})

test("with no Claude connection a sound is not composed again or edited, and says why", async () => {
  const h = await withStored([SPACE])
  const unconnected = createFlairService({ outlines: h.outlines, timeline: h.service, composedSounds: (folder, rules, options) => h.highlights.composedSounds(folder, rules, options) })
  await expect(unconnected.redoSound(h.folder, SPACE.anchor, request())).rejects.toThrow(/^composing sounds is not ready: no Claude connection$/)
  await expect(unconnected.editSound(h.folder, SPACE.anchor, "เบาลง", request())).rejects.toThrow(/^composing sounds is not ready: no Claude connection$/)
  expect(await h.composed()).toEqual([SPACE])
})

test("a stop while a sound is composed again ends it with nothing stored", async () => {
  const h = await withStored([SPACE])
  const stop = new AbortController()
  h.claude.replies.set(SOUND_CONTRACT, () => {
    stop.abort(new Error(CANCELLED))
    throw new Error(CANCELLED)
  })
  const progress = vi.fn()
  await expect(h.flair.redoSound(h.folder, SPACE.anchor, request(), stop.signal, progress)).rejects.toThrow(CANCELLED)
  expect(await h.composed()).toEqual([SPACE])
  expect(progress.mock.calls).toEqual([[0, 1]])
})

/* edited */

test("a sound is changed as the user asks: Claude is given the brief for the room it has now, the change and its code; the new code is kept with the change, the one before for one step back", async () => {
  const h = await withStored([SPACE, COUNT])
  const progress = vi.fn()
  expect(await h.flair.editSound(h.folder, SPACE.anchor, "  เบาลงหน่อย \n", request(), undefined, progress)).toEqual({ count: 1, dropped: 0 })
  const brief = soundBrief({ palette: PALETTE, about: ABOUT, role: SPACE.role, seconds: 1.7, words: SPACE_WORDS, loudness: "strong" })
  expect(h.briefs()).toEqual([soundEditBrief({ brief, code: GOOD, instruction: "เบาลงหน่อย" })])
  expect(await h.composed()).toEqual([{ ...SPACE, code: MENDED, instruction: "เบาลงหน่อย", previous: keptOf(SPACE) }, COUNT])
  expect(progress.mock.calls).toEqual([[0, 1], [1, 1]])
  expect(h.renderer.forgetMachine).toHaveBeenCalledTimes(1)
  // a second edit keeps the first one's code, with the change that made it
  await h.flair.editSound(h.folder, SPACE.anchor, "ดังขึ้น", request())
  expect(await h.composed()).toMatchObject([{ instruction: "ดังขึ้น", previous: { code: MENDED, instruction: "เบาลงหน่อย" } }, COUNT])
})

test("an edit that fails leaves the sound as it was, with why the edit failed; the repair carries the edit's request", async () => {
  const h = await withStored([{ ...SPACE, failed: "old" } as ComposedSound])
  h.claude.replies.set(SOUND_CONTRACT, FETCHES)
  expect(await h.flair.editSound(h.folder, SPACE.anchor, "เบาลง", request())).toEqual({ count: 0, dropped: 1 })
  expect(await h.composed()).toEqual([{ ...SPACE, failed: "old", editFailed: lintCompose(FETCHES)[0] }])
  const [first, repair] = h.briefs()
  expect(repair!.startsWith(first!)).toBe(true)
  expect(first).toContain('"เบาลง"')
})

test("a sound not written yet cannot be edited", async () => {
  const h = await withStored([{ ...SPACE, code: null }])
  await expect(h.flair.editSound(h.folder, SPACE.anchor, "เบาลง", request())).rejects.toThrow(/^this sound has not been written yet$/)
  expect(h.claude.requests).toEqual([])
})

/* one step back */

test("one step back swaps the code kept with the one there, the fragment's hash and the change with it, and a second step back comes back", async () => {
  const before = { ...TIED, graphicHtml: "old-hash", instruction: "เบาลง" }
  const now: ComposedSound = { ...TIED, code: MENDED, previous: keptOf(before), editFailed: "x" }
  const h = await withStored([now, COUNT], [ROCKET])
  await h.flair.undoSound(h.folder, TIED.anchor)
  expect(await h.composed()).toEqual([{ ...before, previous: keptOf({ ...TIED, code: MENDED }) }, COUNT])
  await h.flair.undoSound(h.folder, TIED.anchor)
  expect(await h.composed()).toEqual([{ ...TIED, code: MENDED, previous: keptOf(before) }, COUNT])
  expect(h.claude.requests).toEqual([])
})

test("a sound with nothing kept, or not there, has nothing to go back to", async () => {
  const h = await withStored([SPACE, { ...COUNT, previous: { code: 3 } } as unknown as ComposedSound])
  for (const anchor of [SPACE.anchor, COUNT.anchor, at(s(17.16))]) await expect(h.flair.undoSound(h.folder, anchor)).rejects.toThrow(/^this sound has nothing to go back to$/)
})

/* off and removed */

test("a sound is switched off and on, or removed, and no other is touched", async () => {
  const h = await withStored([SPACE, COUNT])
  await h.flair.setSound(h.folder, SPACE.anchor, { off: true })
  expect(await h.composed()).toEqual([{ ...SPACE, off: true }, COUNT])
  expect((await h.placed()).off.map((sound) => sound.sound.role)).toEqual([SPACE.role])
  await h.flair.setSound(h.folder, SPACE.anchor, { off: false })
  expect(await h.composed()).toEqual([SPACE, COUNT])
  await h.flair.setSound(h.folder, COUNT.anchor, null)
  expect(await h.composed()).toEqual([SPACE])
  await expect(h.flair.setSound(h.folder, at(s(17.16)), null)).rejects.toThrow(/^there is no sound at that place$/)
})

/* sounds follow their graphic */

test("a graphic written again has every sound tied to it composed again to its new fragment, one at a time; the others are left alone", async () => {
  const h = await withStored([TIED, COUNT], [ROCKET])
  expect(await h.flair.redoGraphic(h.folder, ROCKET.anchor, request())).toEqual({ count: 1, dropped: 0 })
  expect((await h.graphicsNow())[0]!.spec).toMatchObject({ html: REDRAWN })
  const progress = vi.fn()
  expect(await h.flair.soundsAfterGraphic(h.folder, ROCKET.anchor, request(), undefined, progress)).toEqual({ count: 1, dropped: 0 })
  expect(await h.composed()).toEqual([{ ...TIED, graphicHtml: hashOfHtml(REDRAWN), code: MENDED, previous: keptOf(TIED) }, COUNT])
  expect(h.briefs()).toEqual([soundBrief({ palette: PALETTE, about: ABOUT, role: TIED.role, seconds: 1.7, words: SPACE_WORDS, loudness: "strong", graphic: { idea: ON_SPACE.idea, html: REDRAWN } })])
  expect(progress.mock.calls).toEqual([[0, 1], [1, 1]])
  expect(h.renderer.forgetMachine).toHaveBeenCalledTimes(1)
  // a graphic with no sound tied to it asks nothing and reports nothing
  const none = vi.fn()
  expect(await h.flair.soundsAfterGraphic(h.folder, at(s(22.62)), request(), undefined, none)).toEqual({ count: 0, dropped: 0 })
  expect(none).not.toHaveBeenCalled()
  expect(h.briefs()).toHaveLength(1)
})

test("a graphic stepped back takes back each tied sound composed to the fragment that returns; one composed to another picture is left, stale by the picture", async () => {
  const newer = { ...ROCKET, spec: { ...ON_SPACE, html: REDRAWN, previous: { html: FRAGMENT, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION } } }
  // composed again for the new fragment, keeping the one composed for the fragment that returns
  const follows: ComposedSound = { ...TIED, graphicHtml: hashOfHtml(REDRAWN), code: MENDED, previous: keptOf(TIED) }
  // tied at another moment to the same graphic place is impossible: a second graphic stands for the one left alone
  const other = { ...ROCKET, anchor: at(s(22.62)), pointId: "p-count" }
  const otherNewer = { ...other, spec: { ...newer.spec } }
  const left: ComposedSound = { ...TIED, anchor: other.anchor, graphic: other.anchor, graphicHtml: hashOfHtml(REDRAWN), code: MENDED, previous: { ...keptOf(TIED), graphicHtml: "another-picture" } }
  const h = await withStored([follows, left, COUNT], [newer, otherNewer])
  await h.flair.undoGraphic(h.folder, ROCKET.anchor)
  expect(await h.composed()).toEqual([{ ...TIED, previous: keptOf(follows) }, left, COUNT])
  await h.flair.undoGraphic(h.folder, other.anchor)
  expect(await h.composed()).toEqual([{ ...TIED, previous: keptOf(follows) }, left, COUNT])
})

test("a graphic removed takes the sounds tied to it along; switched off, it keeps them", async () => {
  const h = await withStored([TIED, COUNT], [ROCKET])
  await h.flair.setGraphic(h.folder, ROCKET.anchor, { off: true })
  expect(await h.composed()).toEqual([TIED, COUNT])
  await h.flair.setGraphic(h.folder, ROCKET.anchor, null)
  expect(await h.composed()).toEqual([COUNT])
})

test("rethinking the graphics takes the sounds tied to graphics that went along; a sound on speech alone stays", async () => {
  const h = await withStored([TIED, COUNT], [ROCKET])
  // Claude answers no graphic this time: the rocket goes
  h.claude.replies.set(FREE_PLAN_PROMPT.system, { graphics: [] })
  await h.flair.planGraphics(h.folder, request())
  expect(await h.graphicsNow()).toEqual([])
  expect(await h.composed()).toEqual([COUNT])
})

test("a graphic the user made theirs stays through a rethink, and so does the sound tied to it", async () => {
  const mine = { ...ROCKET, edited: true }
  const h = await withStored([TIED, COUNT], [mine])
  h.claude.replies.set(FREE_PLAN_PROMPT.system, { graphics: [] })
  await h.flair.planGraphics(h.folder, request())
  expect(await h.composed()).toEqual([TIED, COUNT])
})

test("a graphic stepped back leaves a tied sound already composed to the fragment that returns, and takes back one whose composing again failed", async () => {
  const newer = { ...ROCKET, spec: { ...ON_SPACE, html: REDRAWN, previous: { html: FRAGMENT, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION } } }
  // composed to the returning fragment already, with an older code kept for the same picture: stepping back would lose it
  const already: ComposedSound = { ...TIED, code: MENDED, previous: keptOf(TIED) }
  const h = await withStored([already], [newer])
  await h.flair.undoGraphic(h.folder, ROCKET.anchor)
  expect(await h.composed()).toEqual([already])

  // composed again for the new fragment, which failed: no code, the one for the returning fragment kept
  const failed: ComposedSound = { ...TIED, code: null, failed: "the render failed", previous: keptOf(TIED) }
  const again = await withStored([failed], [newer])
  await again.flair.undoGraphic(again.folder, ROCKET.anchor)
  expect(await again.composed()).toEqual([TIED])
})

test("rethinking the graphics takes the sound of a Claude graphic replaced by a new answer at the same place: it was composed to the graphic that went", async () => {
  const h = await withStored([TIED, COUNT], [ROCKET])
  // Claude answers a graphic on อวกาศ, the fourth word of the rough cut, again: a new one, at the rocket's very place
  h.claude.replies.set(FREE_PLAN_PROMPT.system, { graphics: [{ word: 4, until: 0, seconds: 2, point: 0, from: "light", why: "", box: [0.1, 0.6, 0.9, 0.75], idea: "ดาวเทียม" }] })
  await h.flair.planGraphics(h.folder, request())
  expect((await h.graphicsNow()).map((graphic) => [graphic.anchor, graphic.spec.kind === "motion" && graphic.spec.idea])).toEqual([[ROCKET.anchor, "ดาวเทียม"]])
  expect(await h.composed()).toEqual([COUNT])
})

test("a sound removed, or switched off, while it is composed again stays removed or switched off", async () => {
  for (const change of [null, { off: true }] as const) {
    const h = await withStored([SPACE, COUNT])
    let answer!: () => void
    const held = new Promise<void>((resolve) => (answer = resolve))
    let asked!: () => void
    const composing = new Promise<void>((resolve) => (asked = resolve))
    h.claude.replies.set(SOUND_CONTRACT, async () => {
      asked()
      await held
      return MENDED
    })
    const redoing = h.flair.redoSound(h.folder, SPACE.anchor, request())
    await composing
    await h.flair.setSound(h.folder, SPACE.anchor, change)
    answer()
    if (change === null) {
      expect(await redoing).toEqual({ count: 0, dropped: 0 })
      expect(await h.composed()).toEqual([COUNT])
    } else {
      expect(await redoing).toEqual({ count: 1, dropped: 0 })
      expect(await h.composed()).toEqual([{ ...SPACE, off: true, code: MENDED, previous: keptOf(SPACE) }, COUNT])
    }
  }
})

test("end to end, a graphic written again through its run has the sound tied to it composed again to its new fragment in the same run", async () => {
  const h = await withStored([TIED, COUNT], [ROCKET])
  const events: AppEvent[] = []
  const post = createPostPlanService({
    outlines: h.outlines,
    flair: h.flair,
    emphasis: {} as PostPlanDeps["emphasis"],
    highlights: {} as PostPlanDeps["highlights"],
    timeline: {} as PostPlanDeps["timeline"],
    send: (event) => events.push(event),
  })
  expect(await post.redoGraphic(h.folder, ROCKET.anchor, request())).toEqual({ running: false, states: { graphics: { state: "done", count: 1, dropped: 0 }, sounds: { state: "done", count: 1, dropped: 0 } } })
  expect((await h.graphicsNow())[0]!.spec).toMatchObject({ html: REDRAWN })
  expect(await h.composed()).toEqual([{ ...TIED, graphicHtml: hashOfHtml(REDRAWN), code: MENDED, previous: keptOf(TIED) }, COUNT])
  expect(h.claude.requests.map((asked) => asked.system)).toEqual([MOTION_CONTRACT, SOUND_CONTRACT])
  const sounds = events.flatMap((event) => (event.type === "post-plan" && event.work === "sounds" ? [event.state] : []))
  expect(sounds).toEqual([{ state: "waiting" }, { state: "running" }, { state: "running", done: 0, total: 1 }, { state: "running", done: 1, total: 1 }, { state: "done", count: 1, dropped: 0 }])
  // the graphic stored written first, the sound composed after it
  expect(events.findIndex((event) => event.type === "post-plan" && event.work === "graphics" && event.state.state === "done")).toBeLessThan(events.findIndex((event) => event.type === "post-plan" && event.work === "sounds" && event.state.state === "running"))
})
