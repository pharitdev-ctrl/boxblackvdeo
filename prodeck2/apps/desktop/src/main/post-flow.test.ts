import { createHash } from "node:crypto"
import { join } from "node:path"
import { expect, test } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import { EMPHASIS_PROMPT, type EmphasisPoint, type EmphasisReply } from "@boxblack/core/emphasis"
import type { FlairLevel } from "@boxblack/core/flair/catalogue"
import { TECHNIQUES_PROMPT } from "@boxblack/core/flair/direct"
import type { CueAnchor, InsertCue, SoundCue } from "@boxblack/core/flair/plan"
import { SOUNDS_PROMPT } from "@boxblack/core/flair/sound-plan"
import { BUILT_IN_SOUNDS } from "@boxblack/core/flair/sound-catalogue"
import type { SoundEffect } from "@boxblack/core/flair/sounds"
import { MOTION_PLAN_PROMPT } from "@boxblack/core/graphics/motion/direct"
import { MOTION_CONTRACT } from "@boxblack/core/graphics/motion/write"
import { isMotion, MOTION_VERSION, type GraphicCue, type MotionSpec } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_PROMPT, type HighlightReply } from "@boxblack/core/highlights"
import { styleFor } from "@boxblack/core/highlights/styles"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import type { AppEvent, HighlightPreview, PostRequest, PostWork, WriteResult } from "../shared/api.ts"
import { createEmphasisService } from "./emphasis.ts"
import { createFlairService } from "./flair.ts"
import { transcriptFingerprint } from "./footage.ts"
import { problemFor, type RenderJob } from "./graphics-render.ts"
import { createHighlightService } from "./highlights.ts"
import { CANCELLED } from "./ai-calls.ts"
import { createPostPlanService } from "./post-plan.ts"
import { createTimelineService, type TimelineDeps } from "./timeline.ts"
import { CLIP_ID, readInfo, s, segments, setup, transcript } from "./timeline-fixture.ts"

// The post-production chain on the fixture draft with the real services, Claude faked by prompt. Its transcript:
// ขึ้น(0) ไป(1) ใน(2) อวกาศ(3) ใน(4) สาม(5) สอง(6) หนึ่ง(7) | สาม(8) สอง(9) หนึ่ง(10); the cut keeps "ขึ้นไปในอวกาศใน"
// and the second "สามสองหนึ่ง" (the first countdown, 5–7, is a retake), each in a piece of its own

const SOUNDS = [{ effectId: "s1", name: "ปัง", durationUs: 330_000, path: "/cache/s1.mp3" }]
const PICTURE = { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo" as const, width: 3024, height: 4032, durationUs: 5_000_000 }
const STYLE = styleFor("custom", { text: [0, 1, 0], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0, 0, 0] })
/** Under the text Claude picks and clear of the subtitles' room. */
const BOX = { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.72 }
const FRAME_US = 33_334

const ALL_ON = { enabled: true, level: "medium" as FlairLevel, text: true, sound: true, zoom: true, insert: true, graphic: true }
const requestAt = (level: FlairLevel = "medium"): PostRequest => ({
  rules: DEFAULT_CUT_RULES,
  view: { position: "auto", subtitlesOn: false, highlightsOn: true, flair: { ...ALL_ON, level } },
  subtitles: null,
})

/** One transport for every call: each prompt gets the reply set for it; a reply that is a function is asked with the call, and may answer in its own time or fail. */
function fakeClaude() {
  const requests: LlmRequest<unknown>[] = []
  const replies = new Map<string, unknown>()
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const reply = replies.get(request.system) ?? {}
      const output = typeof reply === "function" ? await (reply as (asked: LlmRequest<unknown>) => unknown)(request as LlmRequest<unknown>) : reply
      return { output: output as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { requests, replies, llm: async () => ({ transport, model: "claude-sonnet-5" }) }
}

/**
 * A renderer that makes every job it is waited for, and never fails one; like the real one it knows a job by what is
 * drawn: the fragment, its box and length, the times of its words, the frame, the font and the colours. What else the
 * spec says (its reason, its idea, the change that made it, the fragment kept for a step back) makes no other file.
 */
function fakeRenderer(dir: string) {
  const hashOf = (job: RenderJob) =>
    createHash("sha256")
      .update(JSON.stringify([job.spec.html, job.spec.box, job.spec.seconds, job.times ?? [], job.canvas, job.fps, job.font, job.palette]))
      .digest("hex")
      .slice(0, 16)
  const made = new Set<string>()
  return {
    hashOf,
    /** every job made so far, by its hash */
    made,
    ensure() {},
    retry() {},
    forgetMachine() {},
    failureOf: () => null,
    environmentProblem: () => problemFor(null),
    async wait(jobs: RenderJob[]) {
      for (const job of jobs) made.add(hashOf(job))
      return { ready: jobs.map(hashOf), failed: [] as string[] }
    },
    async rendered(job: RenderJob) {
      const hash = hashOf(job)
      return made.has(hash) ? { hash, path: join(dir, `${hash}.mov`), width: 864, height: 230, durationUs: job.spec.seconds * 1_000_000, place: { scale: 0.8, x: 0, y: 0.3 } } : null
    },
  }
}

/**
 * Every service of the post-production page, wired as the app wires them: the points, the text, the flair, the
 * run, and a timeline service that writes graphics through the highlight service's jobs. The flair service and
 * the timeline share one renderer, so a graphic rendered as its writing is checked is made when the write asks.
 */
async function withFlow(options: { pro?: boolean; sounds?: SoundEffect[]; /** the user's stop, as the app's Claude calls hand the run theirs */ stop?: AbortSignal } = {}) {
  const library = { list: async () => options.sounds ?? SOUNDS }
  const media = { list: async () => [PICTURE] }
  const highlightAssets = { fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`, animationPath: async (id: string) => `/effect/${id}/hash` }
  const base = await setup({ sounds: library, media, highlightAssets, pro: options.pro })
  const claude = fakeClaude()
  let points = 0
  let groups = 0
  const events: AppEvent[] = []
  const emphasis = createEmphasisService({ outlines: base.outlines, timeline: base.service, llm: claude.llm, newId: () => `p${++points}` })
  const highlights = createHighlightService({
    outlines: base.outlines,
    timeline: base.service,
    footage: base.deps,
    sounds: library,
    media,
    llm: claude.llm,
    styleOf: async () => STYLE,
    graphicsReady: async () => true,
    newId: () => `g${++groups}`,
  })
  const graphicsDir = join(base.dir, "Movies", "CapCut", "BOXBLACK", "graphics")
  const renderer = fakeRenderer(graphicsDir)
  const flair = createFlairService({
    outlines: base.outlines,
    timeline: base.service,
    llm: claude.llm,
    sounds: library,
    // read from settings, as the app wires it
    pro: async () => (await base.deps.settings.read()).capcut.pro,
    media,
    graphics: renderer,
    graphicsReady: async () => true,
    graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options),
    candidateJob: (folder, rules, graphic, spec) => highlights.candidateJob(folder, rules, graphic, spec),
  })
  const deps: TimelineDeps = { ...base.deps, graphics: renderer, graphicsReady: async () => true, graphicJobs: highlights.graphicJobs, graphicsDir }
  const timeline = createTimelineService(deps)
  const post = createPostPlanService({ outlines: base.outlines, emphasis, highlights, flair, timeline, send: (event) => events.push(event), ...(options.stop ? { stopSignal: () => options.stop! } : {}) })
  const { folder } = base

  const preview = (level: FlairLevel = "medium") => highlights.preview(folder, DEFAULT_CUT_RULES, requestAt(level).view)
  /** Writes what the preview at this level shows, onto the draft as it is. */
  const write = async (level: FlairLevel, shown: HighlightPreview): Promise<WriteResult> => {
    const { view } = requestAt(level)
    return timeline.write(folder, DEFAULT_CUT_RULES, segments(await readInfo(folder)), null, { position: view.position, hideSubtitles: false, highlightsOn: true, groupCount: shown.groups.length, flair: view.flair })
  }
  /** What the screen was told about one work, in order. */
  const told = (work: PostWork) => events.flatMap((event) => (event.type === "post-plan" && event.work === work ? [event.state.state] : []))
  return { ...base, claude, emphasis, highlights, flair, timeline, post, events, preview, write, told, renderer }
}

type Flow = Awaited<ReturnType<typeof withFlow>>

/** Where the written draft plays each kind: the cutaways and graphics by their files, the sounds on their track. */
async function written(flow: Flow) {
  const info = await readInfo(flow.folder)
  const videos = info.materials.videos as { id: string; path: string }[]
  const overlays = info.tracks.filter((track) => track.type === "video" && track.flag === 2).flatMap((track) => track.segments)
  const pathOf = (segment: (typeof overlays)[number]) => videos.find((video) => video.id === segment.material_id)?.path ?? ""
  return {
    cutaways: overlays.filter((segment) => pathOf(segment) === PICTURE.path).map((segment) => segment.target_timerange.start),
    graphics: overlays.filter((segment) => pathOf(segment).endsWith(".mov")).map((segment) => segment.target_timerange.start),
    sounds: info.tracks.filter((track) => track.type === "audio").flatMap((track) => track.segments.map((segment) => segment.target_timerange.start)),
  }
}

/** Each written start is within a frame of the preview's, in the same order. */
const sameTimes = (writtenUs: number[], previewUs: number[]) => {
  expect(writtenUs).toHaveLength(previewUs.length)
  writtenUs.forEach((at, i) => expect(Math.abs(at - previewUs[i]!)).toBeLessThan(FRAME_US))
}

/* an item on a point whose first word the user cut */

const moment = (sourceUs: number): CueAnchor => ({ kind: "speech", videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
const speechPoint = (id: string, from: number, to: number, importance: EmphasisPoint["importance"]): EmphasisPoint => ({
  id,
  anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" },
  importance,
  type: "place",
  reason: "",
  source: "ai",
  edited: false,
})
test("after the user cuts a planned point's first word, Claude's cutaway, graphic and sounds on it play where the point starts now, in the preview and the write alike", async () => {
  const flow = await withFlow()
  const { folder, outlines, claude } = flow
  // "ขึ้นไปในอวกาศ" (key) and the second countdown (secondary), which start at 17.16 s and 22.62 s; the first
  // countdown is a retake the cut takes out, so its point is never on the rough cut
  const points = [speechPoint("pa", 0, 4, "key"), speechPoint("pb", 8, 11, "secondary"), speechPoint("gone", 5, 8, "key")]
  const cutaway = (at: CueAnchor, pointId: string): InsertCue => ({ anchor: at, binId: "m1", edited: false, fit: "cover", subject: null, pointId })
  // Claude's graphic, written when no word was said in its two seconds
  const rocket: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "ไปไหน", idea: "จรวด", words: [], html: FRAGMENT }
  const graphic = (at: CueAnchor, pointId: string): GraphicCue => ({ anchor: at, spec: rocket, edited: false, off: false, pointId })
  const sound = (at: CueAnchor, pointId: string): SoundCue => ({ anchor: at, effectId: "s1", edited: false, pointId })
  await outlines.update(folder, (stored) => ({
    ...stored!,
    emphasis: { points, version: 1, plannedOn: { graphics: 1, sounds: 1 }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
    flair: {
      looks: {},
      // on pa's start: a cutaway, a graphic on its first word, and the sound on both; a sound on pb's start, which carries nothing else
      inserts: [cutaway(moment(s(17.16)), "pa"), cutaway(moment(s(19.78)), "gone")],
      graphics: [graphic(moment(s(17.16)), "pa"), graphic(moment(s(19.78)), "gone")],
      cues: [sound(moment(s(17.16)), "pa"), sound(moment(s(22.62)), "pb"), sound(moment(s(19.78)), "gone")],
    },
  }))
  const before = await flow.preview()
  expect(before.emphasis.points.map((point) => point.id)).toEqual(["pa", "pb"])
  expect(before.inserts.map((insert) => insert.atUs)).toEqual([before.emphasis.points[0]!.atUs])

  // "ขึ้น" and the second "สาม" cut: pa starts at "ไป", pb at "สอง"
  await flow.service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 8], keep: false })
  const medium = await flow.preview("medium")
  const [pa, pb] = medium.emphasis.points
  expect([pa!.id, pb!.id]).toEqual(["pa", "pb"])
  // each still shows as it is stored, so it is found again to be changed
  expect(medium.inserts.map((insert) => [insert.anchor, insert.atUs, insert.pointId])).toEqual([[moment(s(17.16)), pa!.atUs, "pa"]])
  expect(medium.graphics.map((graphic) => [graphic.anchor, graphic.atUs, graphic.pointId])).toEqual([[moment(s(17.16)), pa!.atUs, "pa"]])
  expect(medium.cues.map((cue) => [cue.anchor, cue.atUs, cue.pointId])).toEqual([
    [moment(s(17.16)), pa!.atUs, "pa"],
    [moment(s(22.62)), pb!.atUs, "pb"],
  ])
  expect(medium.emphasis.points.map((point) => [point.id, point.items])).toEqual([
    ["pa", { text: 0, zoom: 0, insert: 1, graphic: 1, sound: 1 }],
    ["pb", { text: 0, zoom: 0, insert: 0, graphic: 0, sound: 1 }],
  ])

  // the graphic was written for other words than it plays over now, so it waits to be written again; written for the
  // cut as it is, it is fresh, still Claude's, and still found by the moment it is stored on
  expect(medium.graphics).toMatchObject([{ stale: true }])
  claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await flow.flair.redoGraphic(folder, moment(s(17.16)), requestAt("medium"))).toEqual({ count: 1, dropped: 0 })
  expect((await flow.preview("medium")).graphics.map((shown) => [shown.anchor, shown.atUs, shown.pointId, shown.stale])).toEqual([[moment(s(17.16)), pa!.atUs, "pa", false]])

  // the write plays the same, where the preview shows it
  const result = await flow.write("medium", medium)
  expect(result).toMatchObject({ insertCount: 1, graphicCount: 1, soundCount: 2, dropped: { sounds: 0, zooms: 0, inserts: 0, graphics: 0 } })
  const laid = await written(flow)
  sameTimes(laid.cutaways, [pa!.atUs])
  sameTimes(laid.graphics, [pa!.atUs])
  sameTimes(laid.sounds, [pa!.atUs, pb!.atUs])

  // at the level that hides pb, its sound waits; pa's items play on
  const light = await flow.preview("light")
  expect(light.cues.map((cue) => cue.pointId)).toEqual(["pa"])
  expect((await flow.write("light", light)).soundCount).toBe(1)
})

test("an item whose own moment is cut away and whose point is not on the rough cut still plays nowhere", async () => {
  const flow = await withFlow()
  const { folder, outlines } = flow
  await outlines.update(folder, (stored) => ({
    ...stored!,
    emphasis: { points: [speechPoint("pa", 0, 4, "key")], version: 1, plannedOn: { graphics: 1, sounds: 1 }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
    flair: {
      looks: {},
      inserts: [{ anchor: moment(s(17.16)), binId: "m1", edited: false, pointId: "pa" }],
      cues: [{ anchor: moment(s(17.16)), effectId: "s1", edited: false, pointId: "pa" }],
    },
  }))
  // every word of pa cut: it is not placed, so what is on it plays at no level
  await flow.service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3], keep: false })
  const heavy = await flow.preview("heavy")
  expect([heavy.inserts, heavy.cues, heavy.emphasis.points]).toEqual([[], [], []])
  expect(await flow.write("heavy", heavy)).toMatchObject({ insertCount: 0, soundCount: 0 })
})

/* the whole chain behind the one button */

const answer = (at: number, quote: string, importance: EmphasisPoint["importance"], type: EmphasisPoint["type"]): EmphasisReply["points"][number] => ({ at, scene: "", quote, importance, type, reason: "" })
const PLAIN = { pattern: "stack" as const, tone: "base" as const, accentLine: 0, accentWord: "", exit: "" }
const lines = (...pairs: [string, string][]) => pairs.map(([quote, text]) => ({ quote, text }))
/** Claude's plan for one motion graphic, from its point's first word, under the text and clear of the subtitles' room. */
const MOTION_REPLY = { word: "", until: "", seconds: 2, why: "ไปไหน", box: [0.1, 0.6, 0.9, 0.75], idea: "จรวดพุ่งขึ้นจากขอบล่างของกรอบ" }
/** What Claude writes for it: a fragment the linter passes. */
const FRAGMENT = '<style>.n{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="n">อวกาศ</div>'
const done = (count: number, dropped = 0) => ({ state: "done", count, dropped })

/**
 * What the preview at a level shows, kind by kind, and that the write at that level lays the same. The text is
 * the groups that are drawn: one a graphic takes the place of is listed by the preview, and not written.
 */
async function previewEqualsWrite(flow: Flow, level: FlairLevel) {
  const shown = await flow.preview(level)
  const result = await flow.write(level, shown)
  const drawn = shown.groups.filter((group) => !group.replaced)
  const counts = {
    text: drawn.length,
    zooms: shown.zooms.length,
    inserts: shown.inserts.length,
    graphics: shown.graphics.filter((graphic) => !graphic.off).length,
    sounds: shown.cues.length,
    points: shown.emphasis.points.filter((point) => point.shown).length,
  }
  expect({
    highlightCount: result.highlightCount,
    zoomCount: result.zoomCount,
    insertCount: result.insertCount,
    graphicCount: result.graphicCount,
    soundCount: result.soundCount,
    emphasisCount: result.emphasisCount,
    dropped: result.dropped,
    lost: [result.zoomsLost, result.graphicsSkipped],
    proLeftOut: result.proLeftOut,
  }).toEqual({
    highlightCount: drawn.reduce((sum, group) => sum + group.lines.length, 0),
    zoomCount: counts.zooms,
    insertCount: counts.inserts,
    graphicCount: counts.graphics,
    soundCount: counts.sounds,
    emphasisCount: counts.points,
    dropped: { sounds: 0, zooms: 0, inserts: 0, graphics: 0 },
    lost: [0, 0],
    proLeftOut: shown.proLeftOut,
  })
  const laid = await written(flow)
  sameTimes(laid.cutaways, shown.inserts.map((insert) => insert.atUs))
  sameTimes(laid.graphics, shown.graphics.filter((graphic) => !graphic.off).map((graphic) => graphic.atUs))
  sameTimes(laid.sounds, shown.cues.map((cue) => cue.atUs))
  return counts
}

test("without CapCut Pro the exits and sounds held back are counted over what the level shows, in the preview and the write alike", async () => {
  // s1 stands for a sound read from a draft, which counts as a Pro one; the built-in one is free
  const free = BUILT_IN_SOUNDS[0]!
  const flow = await withFlow({ pro: false, sounds: [...SOUNDS, free] })
  const { folder, outlines, claude, highlights } = flow
  // "ขึ้นไปในอวกาศ" (key) and the second countdown (extra), which the middle level holds back
  await outlines.update(folder, (stored) => ({
    ...stored!,
    emphasis: { points: [speechPoint("pa", 0, 4, "key"), speechPoint("pb", 8, 11, "extra")], version: 1, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
  }))
  claude.replies.set(HIGHLIGHT_PROMPT.system, { style: "headline", groups: [{ point: 1, lines: lines(["ขึ้นไป", "ขึ้นไป"]), ...PLAIN }, { point: 2, lines: lines(["สาม", "3"], ["สอง", "2"]), ...PLAIN }] })
  await highlights.pick(folder, DEFAULT_CUT_RULES, requestAt("heavy").view)
  // the countdown's text gets หมุนหายไป, which needs Pro, by hand; the key point a Pro sound at its start, the countdown a free one
  await outlines.update(folder, (stored) => ({
    ...stored!,
    flair: {
      ...stored!.flair!,
      looks: { ...stored!.flair!.looks, g2: { pattern: "stack", tone: "base", accent: null, exit: "spin-out", edited: true } },
      cues: [
        { anchor: moment(s(17.16)), effectId: "s1", edited: true, pointId: "pa" },
        { anchor: moment(s(22.62)), effectId: free.effectId, edited: false, pointId: "pb" },
      ],
    },
  }))

  // the middle level does not show the countdown, so only the key point's sound is held back, and no exit
  expect((await flow.preview("medium")).proLeftOut).toEqual({ exits: 0, sounds: 1 })
  expect(await previewEqualsWrite(flow, "medium")).toMatchObject({ text: 1, sounds: 0 })
  // the top level shows it: its exit is held back in both, and its free sound plays
  expect((await flow.preview("heavy")).proLeftOut).toEqual({ exits: 1, sounds: 1 })
  expect(await previewEqualsWrite(flow, "heavy")).toMatchObject({ text: 2, sounds: 1 })
})

test("the one button plans every work on the points, the preview at each level is what the write lays, and the banner follows the points as they change", async () => {
  const flow = await withFlow()
  const { folder, outlines, claude, post, emphasis } = flow
  // "ขึ้นไป" (key), "อวกาศ" (secondary) and the second countdown's "สามสอง" (extra), numbered in playing order
  claude.replies.set(EMPHASIS_PROMPT.system, { points: [answer(1, "ขึ้นไป", "key", "action"), answer(1, "อวกาศ", "secondary", "place"), answer(2, "สามสอง", "extra", "number")] })
  const text: HighlightReply = {
    style: "headline",
    groups: [
      { point: 1, lines: lines(["ขึ้นไป", "ขึ้นไป"]), ...PLAIN },
      { point: 2, lines: lines(["อวกาศ", "อวกาศ!"]), ...PLAIN },
      { point: 3, lines: lines(["สาม", "3"], ["สอง", "2"]), ...PLAIN },
    ],
  }
  claude.replies.set(HIGHLIGHT_PROMPT.system, text)
  // a cutaway where "ขึ้นไป" starts, a punch on the countdown's piece, a motion graphic on "อวกาศ", which Claude then writes
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 3, kind: "punch" }], inserts: [{ point: 1, picture: 1 }] })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION_REPLY, point: 2 }] })
  claude.replies.set(MOTION_CONTRACT, FRAGMENT)
  // a sound on the first line of each point's text, where the cutaway, the graphic and the punch share its moment
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }, { at: 2, sound: 1 }, { at: 3, sound: 1 }] })

  const ran = await post.plan(folder, requestAt("medium"))
  expect(ran).toEqual({
    running: false,
    states: {
      emphasis: done(3),
      // the text the middle level shows: the extra point's is held back
      text: done(2),
      techniques: done(2),
      graphics: done(1),
      sounds: done(3),
      subtitles: { state: "skipped", reason: "off" },
    },
  })
  for (const work of ["emphasis", "text", "techniques", "sounds"] as const) expect(flow.told(work)).toEqual(["waiting", "running", "done"])
  // the graphics work says how far its writing has got: before its one graphic, and after it
  expect(flow.events.flatMap((event) => (event.type === "post-plan" && event.work === "graphics" ? [event.state] : []))).toEqual([
    { state: "waiting" },
    { state: "running" },
    { state: "running", done: 0, total: 1 },
    { state: "running", done: 1, total: 1 },
    done(1),
  ])
  expect(flow.told("subtitles")).toEqual(["waiting", "skipped"])
  // the graphic was rendered as its writing was checked
  expect(flow.renderer.made.size).toBe(1)
  expect(flow.events.at(-1)).toEqual({ type: "post-plan-finished", folder })
  // both works ran clean on the points as they are: nothing is behind
  expect((await outlines.get(folder))!.emphasis).toMatchObject({ version: 1, plannedOn: { graphics: 1, sounds: 1 } })
  expect((await flow.preview()).emphasis.changed).toEqual({ graphics: false, sounds: false })

  // each level shows the points it lets through, and the write lays what the preview shows. Where "อวกาศ" shows, its
  // graphic plays in the place of its text, so one group fewer is drawn; the sound on that text's line plays all the same
  expect(await previewEqualsWrite(flow, "light")).toEqual({ text: 1, zooms: 0, inserts: 1, graphics: 0, sounds: 1, points: 1 })
  expect(await previewEqualsWrite(flow, "medium")).toEqual({ text: 1, zooms: 0, inserts: 1, graphics: 1, sounds: 2, points: 2 })
  expect(await previewEqualsWrite(flow, "heavy")).toEqual({ text: 2, zooms: 1, inserts: 1, graphics: 1, sounds: 3, points: 3 })
  expect((await flow.preview("heavy")).groups.map((group) => [group.pointId, group.replaced])).toEqual([
    ["p1", false],
    ["p2", true],
    ["p3", false],
  ])
  // the writes laid the file the writing's check made: nothing was rendered a second time
  expect(flow.renderer.made.size).toBe(1)

  // a point deleted takes Claude's items on it along and leaves the version: no banner
  await emphasis.setPoint(folder, "p2", null)
  const deleted = await flow.preview("heavy")
  expect([deleted.emphasis.points.map((point) => point.id), deleted.graphics, deleted.emphasis.changed]).toEqual([["p1", "p3"], [], { graphics: false, sounds: false }])
  // a point added raises it: both works are behind
  const added = await emphasis.addPoint(folder, { kind: "speech", videoId: CLIP_ID, from: 4, to: 5, beatId: "beat-1" })
  expect((await flow.preview()).emphasis.changed).toEqual({ graphics: true, sounds: true })

  // thinking the graphics again catches them up: the graphic goes on the new point, and the sounds are behind what they sat on
  claude.replies.set(HIGHLIGHT_PROMPT.system, { style: "headline", groups: [text.groups[0]!, { ...text.groups[2]!, point: 3 }] })
  const graphics = await post.rethink(folder, "graphics", requestAt("medium"))
  expect(graphics.states).toMatchObject({ text: { state: "done" }, techniques: done(2), graphics: done(1), sounds: done(3) })
  expect((await outlines.get(folder))!.emphasis!.plannedOn).toEqual({ graphics: 2, sounds: null })
  const rethought = await flow.preview("heavy")
  expect(rethought.graphics.map((graphic) => graphic.pointId)).toEqual([added])
  expect(rethought.emphasis.changed).toEqual({ graphics: false, sounds: true })

  // thinking the sounds again catches them up too
  const sounds = await post.rethink(folder, "sounds", requestAt("medium"))
  expect(sounds.states.sounds).toMatchObject({ state: "done" })
  expect(flow.told("sounds").slice(-3)).toEqual(["waiting", "running", "done"])
  expect((await outlines.get(folder))!.emphasis!.plannedOn).toEqual({ graphics: 2, sounds: 2 })
  expect((await flow.preview()).emphasis.changed).toEqual({ graphics: false, sounds: false })
  await previewEqualsWrite(flow, "heavy")
})

/* the graphics' writing through the run: a stop, and one graphic written again */

/** What the screen was told about the graphics work, in order, each state whole. */
const graphicsStates = (flow: Flow) => flow.events.flatMap((event) => (event.type === "post-plan" && event.work === "graphics" ? [event.state] : []))
/** The fragment of each stored graphic, in order; null for one not written. */
const fragments = async (flow: Flow) => ((await flow.outlines.get(flow.folder))!.flair?.graphics ?? []).map((graphic) => isMotion(graphic.spec) && graphic.spec.html)
/** Another fragment, as a later writing answers. */
const MENDED = '<style>.m{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="m">ขึ้นไป</div>'

test("a stop pressed while the graphics are written ends the work as a stopped call ends one: what was written stays, the rest is left unwritten, and the works after it are stopped", async () => {
  const stop = new AbortController()
  const flow = await withFlow({ stop: stop.signal })
  const { folder, claude, post } = flow
  claude.replies.set(EMPHASIS_PROMPT.system, { points: [answer(1, "ขึ้นไป", "key", "action"), answer(2, "สามสอง", "key", "number")] })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION_REPLY, point: 1, idea: "จรวด" }, { ...MOTION_REPLY, point: 2, idea: "นาฬิกา" }] })
  // the rocket is written at once; the clock's call is still going when the user presses stop, once the rocket is stored
  claude.replies.set(MOTION_CONTRACT, async (asked: LlmRequest<unknown>) => {
    if (asked.content.some((entry) => entry.type === "text" && entry.text.includes("จรวด"))) return FRAGMENT
    while ((await fragments(flow))[0] !== FRAGMENT) await new Promise((resolve) => setTimeout(resolve, 2))
    stop.abort()
    // as a call ends when the run's stop is pressed
    throw asked.signal!.reason
  })
  // only the points, the graphics and the sounds are on
  const asked = requestAt("medium")
  const ran = await post.plan(folder, { ...asked, view: { ...asked.view, highlightsOn: false, flair: { ...ALL_ON, zoom: false, insert: false } } })
  const off = { state: "skipped", reason: "off" }
  expect(ran).toEqual({
    running: false,
    states: { emphasis: done(2), text: off, techniques: off, graphics: { state: "failed", error: CANCELLED }, sounds: { state: "skipped", reason: "stopped" }, subtitles: off },
  })
  expect(graphicsStates(flow)).toEqual([{ state: "waiting" }, { state: "running" }, { state: "running", done: 0, total: 2 }, { state: "running", done: 1, total: 2 }, { state: "failed", error: CANCELLED }])
  expect(await fragments(flow)).toEqual([FRAGMENT, null])
  // the sounds were never asked for
  expect(claude.requests.some((request) => request.system === SOUNDS_PROMPT.system)).toBe(false)
  expect(flow.events.at(-1)).toEqual({ type: "post-plan-finished", folder })
})

test("a graphic gone stale is written again through a run of its own: the screen is told how far it has got, the new fragment is stored, and the write lays it", async () => {
  const flow = await withFlow()
  const { folder, outlines, claude, post } = flow
  // Claude's graphic on "ขึ้น", written when no word was said in its two seconds: five are now, so it is stale
  const stale: GraphicCue = {
    anchor: moment(s(17.16)),
    spec: { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, seconds: 2, why: "ไปไหน", idea: "จรวด", words: [], html: FRAGMENT },
    edited: false,
    off: false,
    pointId: "pa",
  }
  await outlines.update(folder, (stored) => ({
    ...stored!,
    emphasis: { points: [speechPoint("pa", 0, 4, "key")], version: 1, plannedOn: { graphics: 1, sounds: 1 }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
    flair: { looks: {}, graphics: [stale] },
  }))
  expect((await flow.preview()).graphics).toMatchObject([{ written: true, stale: true }])
  // stale, it is left out of a write
  expect(await flow.write("medium", await flow.preview())).toMatchObject({ graphicCount: 0, graphicsSkipped: 1 })

  claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await post.redoGraphic(folder, stale.anchor, requestAt("medium"))).toEqual({ running: false, states: { graphics: done(1) } })
  expect(graphicsStates(flow)).toEqual([{ state: "waiting" }, { state: "running" }, { state: "running", done: 0, total: 1 }, { state: "running", done: 1, total: 1 }, done(1)])
  expect(flow.events.at(-1)).toEqual({ type: "post-plan-finished", folder })
  // one call, the writing: nothing was planned again, and the points are noted as planned on no more than they were
  expect(claude.requests.map((request) => request.system)).toEqual([MOTION_CONTRACT])
  expect((await outlines.get(folder))!.emphasis!.plannedOn).toEqual({ graphics: 1, sounds: 1 })
  expect(await fragments(flow)).toEqual([MENDED])
  expect((await flow.preview()).graphics).toMatchObject([{ written: true, stale: false, edited: false }])
  // fresh, it is laid into the draft
  expect(await previewEqualsWrite(flow, "medium")).toMatchObject({ graphics: 1 })
})

/* a graphic in the place of its point's highlight text */

/** The highlight text the written draft draws, in playing order. */
async function textWritten(flow: Flow): Promise<string[]> {
  const info = await readInfo(flow.folder)
  const texts = info.materials.texts as { id: string; content: string }[]
  return info.tracks
    .filter((track) => track.type === "text" && track.flag === 0)
    .flatMap((track) => track.segments)
    .sort((a, b) => a.target_timerange.start - b.target_timerange.start)
    .map((segment) => JSON.parse(texts.find((text) => text.id === segment.material_id)!.content).text as string)
}

// many whole fixtures in one test: more than the default five seconds on a cold start
test("a graphic the plan wrote takes the place of its point's highlight text, in the preview and the write alike; switched off, gone stale or removed, the text is written again", { timeout: 20_000 }, async () => {
  const flow = await withFlow()
  const { folder, claude, post } = flow
  // "ขึ้นไป" and "อวกาศ", both key, each with text; the graphic goes on "อวกาศ"
  claude.replies.set(EMPHASIS_PROMPT.system, { points: [answer(1, "ขึ้นไป", "key", "action"), answer(1, "อวกาศ", "key", "place")] })
  claude.replies.set(HIGHLIGHT_PROMPT.system, { style: "headline", groups: [{ point: 1, lines: lines(["ขึ้นไป", "ขึ้นไป"]), ...PLAIN }, { point: 2, lines: lines(["อวกาศ", "อวกาศ!"]), ...PLAIN }] })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION_REPLY, point: 2 }] })
  claude.replies.set(MOTION_CONTRACT, FRAGMENT)
  const asked = requestAt("medium")
  const ran = await post.plan(folder, { ...asked, view: { ...asked.view, flair: { ...ALL_ON, zoom: false, insert: false, sound: false } } })
  // the text work counts both groups: it looks without the graphics, which are not planned yet
  expect(ran.states).toMatchObject({ emphasis: done(2), text: done(2), graphics: done(1) })
  // the graphics were planned knowing each point's own text, which a graphic on the point takes the place of
  const planning = claude.requests.find((request) => request.system === MOTION_PLAN_PROMPT.system)!
  const pointLines = planning.content.flatMap((part) => (part.type === "text" ? part.text.split("\n") : [])).filter((line) => /^\[\d\] /.test(line))
  expect(pointLines).toHaveLength(2)
  for (const line of pointLines) expect(line).toMatch(/\(ข้อความเด่นของจุดนี้ \[[\d.]+, [\d.]+\]/)

  /** Which groups the preview lists as replaced, and what a write of what it shows draws and lays. */
  const state = async () => {
    const shown = await flow.preview()
    const result = await flow.write("medium", shown)
    return {
      replaced: shown.groups.map((group) => [group.pointId, group.replaced]),
      graphics: shown.graphics.map((graphic) => [graphic.pointId, graphic.written, graphic.stale, graphic.off]),
      written: await textWritten(flow),
      counts: [result.highlightCount, result.graphicCount, result.graphicsSkipped],
    }
  }
  const textOnly = [["p1", false], ["p2", false]]
  const both = ["ขึ้นไป", "อวกาศ!"]

  // written: the group is listed, marked, and not drawn; the write's count of groups is still of both
  expect(await state()).toEqual({ replaced: [["p1", false], ["p2", true]], graphics: [["p2", true, false, false]], written: ["ขึ้นไป"], counts: [1, 1, 0] })
  const [graphic] = (await flow.preview()).graphics
  // the point still counts its text, so the emphasis tab offers to make none
  expect((await flow.preview()).emphasis.points.map((point) => [point.id, point.items.text, point.items.graphic])).toEqual([
    ["p1", 1, 0],
    ["p2", 1, 1],
  ])

  // switched off: the text is drawn again; switched back on, the graphic takes its place again
  await flow.flair.setGraphic(folder, graphic!.anchor, { off: true })
  expect(await state()).toEqual({ replaced: textOnly, graphics: [["p2", true, false, true]], written: both, counts: [2, 0, 0] })
  await flow.flair.setGraphic(folder, graphic!.anchor, { off: false })
  expect(await state()).toMatchObject({ replaced: [["p1", false], ["p2", true]], written: ["ขึ้นไป"], counts: [1, 1, 0] })

  // gone stale: "ใน", said while it plays, is cut from under it, so it is left out of the write and the text is drawn
  await flow.service.decide(folder, CLIP_ID, { type: "words", indexes: [4], keep: false })
  expect(await state()).toEqual({ replaced: textOnly, graphics: [["p2", true, true, false]], written: both, counts: [2, 0, 1] })
  // written again for the cut as it is, it takes the text's place again
  claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await flow.flair.redoGraphic(folder, graphic!.anchor, requestAt("medium"))).toEqual({ count: 1, dropped: 0 })
  expect(await state()).toMatchObject({ replaced: [["p1", false], ["p2", true]], graphics: [["p2", true, false, false]], written: ["ขึ้นไป"], counts: [1, 1, 0] })

  // removed: the text is back for good
  await flow.flair.setGraphic(folder, graphic!.anchor, null)
  expect(await state()).toEqual({ replaced: textOnly, graphics: [], written: both, counts: [2, 0, 0] })
})

test("with the lines under the text hidden, the subtitles say the words of a point whose graphic plays, and a write that carries those lines goes through", async () => {
  const flow = await withFlow()
  const { folder, claude, post, deps } = flow
  claude.replies.set(EMPHASIS_PROMPT.system, { points: [answer(1, "ขึ้นไป", "key", "action"), answer(1, "อวกาศ", "key", "place")] })
  claude.replies.set(HIGHLIGHT_PROMPT.system, { style: "headline", groups: [{ point: 1, lines: lines(["ขึ้นไป", "ขึ้นไป"]), ...PLAIN }, { point: 2, lines: lines(["อวกาศ", "อวกาศ!"]), ...PLAIN }] })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION_REPLY, point: 2 }] })
  claude.replies.set(MOTION_CONTRACT, FRAGMENT)
  // the screen saves what it shows: the lines are read under the saved settings
  const flairOn = { ...ALL_ON, zoom: false, insert: false, sound: false }
  await deps.settings.update({ flair: flairOn, subtitles: { enabled: true } })
  const view = { position: "auto" as const, subtitlesOn: true, highlightsOn: true, flair: flairOn }
  await post.plan(folder, { rules: DEFAULT_CUT_RULES, view, subtitles: { length: "line", polish: false, hideUnderHighlights: true } })
  const shown = await flow.highlights.preview(folder, DEFAULT_CUT_RULES, view)
  expect(shown.groups.map((group) => group.replaced)).toEqual([false, true])
  // "ขึ้นไป" is drawn as text and left out of the lines; "อวกาศ" is drawn by its graphic, and said by the lines
  const shownLines = await flow.timeline.subtitles(folder, DEFAULT_CUT_RULES, "line", true)
  expect(shownLines.map((line) => line.text)).toEqual(["ในอวกาศใน", "สามสองหนึ่ง"])
  const result = await flow.timeline.write(folder, DEFAULT_CUT_RULES, segments(await readInfo(folder)), { length: "line", texts: shownLines.map((line) => line.text) }, { position: "auto", hideSubtitles: true, highlightsOn: true, groupCount: shown.groups.length, flair: flairOn })
  expect(result).toMatchObject({ captionCount: 2, highlightCount: 1, graphicCount: 1 })
  expect(await textWritten(flow)).toEqual(["ขึ้นไป"])
})

/* a graphic edited as the user asks, then taken one step back */

/** The file each graphic the written draft plays is laid from, in playing order. */
async function graphicFiles(flow: Flow): Promise<string[]> {
  const info = await readInfo(flow.folder)
  const videos = info.materials.videos as { id: string; path: string }[]
  return info.tracks
    .filter((track) => track.type === "video" && track.flag === 2)
    .flatMap((track) => track.segments)
    .sort((a, b) => a.target_timerange.start - b.target_timerange.start)
    .map((segment) => videos.find((video) => video.id === segment.material_id)?.path ?? "")
    .filter((path) => path.endsWith(".mov"))
}

test("a graphic edited through a run of its own and taken one step back plays as it did before the edit: the preview shows it so, and the write lays the file made for it then, with nothing rendered again", async () => {
  const flow = await withFlow()
  const { folder, claude, post } = flow
  claude.replies.set(EMPHASIS_PROMPT.system, { points: [answer(1, "อวกาศ", "key", "place")] })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION_REPLY, point: 1 }] })
  claude.replies.set(MOTION_CONTRACT, FRAGMENT)
  // only the points and the graphics are on
  const asked = requestAt("medium")
  const graphicsOnly = { ...asked, view: { ...asked.view, highlightsOn: false, flair: { ...ALL_ON, zoom: false, insert: false, sound: false } } }
  await post.plan(folder, graphicsOnly)
  const [planned] = (await flow.preview()).graphics
  expect(planned).toMatchObject({ spec: { html: FRAGMENT }, written: true, stale: false, instruction: null, editFailed: null, canUndo: false })
  expect(await flow.write("medium", await flow.preview())).toMatchObject({ graphicCount: 1 })
  // one file, made as the plan's writing was checked
  expect(flow.renderer.made.size).toBe(1)
  const [before] = flow.renderer.made
  expect(await graphicFiles(flow)).toEqual([expect.stringMatching(new RegExp(`/${before}\\.mov$`))])

  // edited: a run of the graphics work alone, Claude asked with the change and the fragment, and the new one made as it was checked
  claude.replies.set(MOTION_CONTRACT, MENDED)
  flow.events.length = 0
  expect(await post.editGraphic(folder, planned!.anchor, "  ตัวหนังสือใหญ่ขึ้น ", graphicsOnly)).toMatchObject({ running: false, states: { graphics: done(1) } })
  expect(graphicsStates(flow)).toEqual([{ state: "waiting" }, { state: "running" }, { state: "running", done: 0, total: 1 }, { state: "running", done: 1, total: 1 }, done(1)])
  expect(flow.events.at(-1)).toEqual({ type: "post-plan-finished", folder })
  const editCall = claude.requests.at(-1)!
  expect(editCall.system).toBe(MOTION_CONTRACT)
  expect(editCall.content).toEqual([{ type: "text", text: expect.stringContaining(`The user asks for this change:\n"ตัวหนังสือใหญ่ขึ้น"\n\n`) }])
  expect(editCall.content).toEqual([{ type: "text", text: expect.stringMatching(new RegExp(`\n${FRAGMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)) }])
  expect((await flow.preview()).graphics).toMatchObject([{ spec: { html: MENDED }, written: true, stale: false, instruction: "ตัวหนังสือใหญ่ขึ้น", editFailed: null, canUndo: true, edited: false }])
  expect(flow.renderer.made.size).toBe(2)

  // one step back: no run and no call; the graphic is as it was before the edit, and can come back to the edit
  const calls = claude.requests.length
  const told = flow.events.length
  await post.undoGraphic(folder, planned!.anchor)
  expect(claude.requests).toHaveLength(calls)
  expect(flow.events).toHaveLength(told)
  const back = await flow.preview()
  expect(back.graphics).toEqual([{ ...planned, spec: { ...planned!.spec, previous: { html: MENDED, seconds: planned!.spec.seconds, words: planned!.spec.words, version: MOTION_VERSION, instruction: "ตัวหนังสือใหญ่ขึ้น" } }, canUndo: true }])
  // the write lays the file made for it before the edit: the renderer was not asked to make another
  expect(await previewEqualsWrite(flow, "medium")).toMatchObject({ graphics: 1 })
  expect(flow.renderer.made.size).toBe(2)
  expect(await graphicFiles(flow)).toEqual([expect.stringMatching(new RegExp(`/${before}\\.mov$`))])
})
