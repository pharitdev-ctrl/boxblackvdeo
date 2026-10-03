import { expect, test, vi } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import type { EmphasisPoint, PlacedPoint } from "@boxblack/core/emphasis"
import { MOTION_VERSION, type GraphicCue, type MotionSpec, type PlacedGraphic } from "@boxblack/core/graphics/plan"
import type { TimedGroup } from "@boxblack/core/highlights"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { describeSoundClip, SOUND_PLAN_PROMPT, type PlannedSound } from "@boxblack/core/sound/plan"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import { lintCompose } from "@boxblack/core/sound/lint"
import { SOUND_CONTRACT, soundBrief, soundRepairBrief } from "@boxblack/core/sound/write"
import type { PostRequest } from "../shared/api.ts"
import { CANCELLED } from "./ai-calls.ts"
import { hashOfHtml, type PlacedComposed } from "./composed-cues.ts"
import { createFlairService, type FlairDeps } from "./flair.ts"
import { transcriptFingerprint } from "./footage.ts"
import { createHighlightService } from "./highlights.ts"
import type { SoundJob } from "./sound-render.ts"
import { soundClipOf, soundsToStore } from "./sound-work.ts"
import type { SpokenSentence } from "./spoken.ts"
import { CLIP_ID, s, setup, transcript } from "./timeline-fixture.ts"

// Work 4 on the fixture draft. The rough cut plays ขึ้น ไป ใน อวกาศ ใน (0.15 s to 2.77 s, one piece) and the second
// สาม สอง หนึ่ง (2.92 s on, a piece of its own to the end): eight words, numbered from 1 as Claude is shown them.
// อวกาศ is the 4th, 1.07 s in; the second สาม is the 6th, 2.92 s in.

const POINTS: EmphasisPoint[] = [
  { id: "p-space", anchor: { kind: "speech", videoId: CLIP_ID, from: 3, to: 4, beatId: "beat-1" }, importance: "key", type: "place", reason: "ไปอวกาศ", source: "ai", edited: false },
  { id: "p-count", anchor: { kind: "speech", videoId: CLIP_ID, from: 8, to: 11, beatId: "beat-1" }, importance: "secondary", type: "number", reason: "นับถอยหลัง", source: "ai", edited: false },
]
const FLAIR = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false }
const request = (flair: Partial<typeof FLAIR> = {}): PostRequest => ({
  rules: DEFAULT_CUT_RULES,
  view: { position: "auto", subtitlesOn: false, highlightsOn: true, flair: { ...FLAIR, ...flair } },
  subtitles: null,
})
const ABOUT = "นักบินอวกาศ"
const PALETTE = "Key: C major\nInstruments: soft sine bells"
/** Code the linter passes, and a second one, so a repaired code can be told from the first. */
const GOOD = "function compose(ctx, cue, kit) { }"
const MENDED = "function compose(ctx, cue, kit) { const o = ctx.createOscillator() }"
/** Code the linter refuses, for the network. */
const FETCHES = "function compose(ctx, cue, kit) { fetch('x') }"
const at = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
const STYLE = HIGHLIGHT_STYLES["bold-white"]
const PICTURE = { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo" as const, width: 3024, height: 4032, durationUs: 5_000_000 }
/** A written graphic on อวกาศ, fresh: written for the 1.7 s its piece leaves it and the words said in that time. */
const FRAGMENT = '<style>.r{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="r">อวกาศ</div>'
const ON_SPACE: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.72 }, seconds: 1.7, why: "", idea: "จรวดพุ่งขึ้นไปอวกาศ", words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], html: FRAGMENT }
const ROCKET: GraphicCue = { anchor: at(s(18.08)), spec: ON_SPACE, edited: false, off: false, pointId: "p-space" }

/** One sound of Claude's plan, numbered from 1 as the reply numbers it. */
const planned = (word: number, role: string, extra: Partial<{ graphic: number | null; seconds: number; point: number | null; from: string; loudness: string }> = {}) => ({
  word,
  graphic: null,
  seconds: 3,
  role,
  point: null,
  from: "light",
  loudness: "normal",
  ...extra,
})

/** One transport for every call, each prompt with the reply set for it; a reply that is a function is asked with the call, and may answer in its own time. */
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

/** The fixture with its two points stored, the services wired as the app wires them, and a renderer that passes every sound. */
async function withSounds(extra: Partial<FlairDeps> = {}, graphics: GraphicCue[] = []) {
  const base = await setup({})
  await base.outlines.update(base.folder, (stored) => ({
    ...stored!,
    emphasis: { points: POINTS, version: 2, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
    flair: { looks: {}, graphics },
  }))
  const claude = fakeClaude()
  claude.replies.set(SOUND_CONTRACT, GOOD)
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
  const progress: [number, number][] = []
  const plan = (asked = request(), signal?: AbortSignal, drawing?: Promise<void>) => flair.planSounds(base.folder, asked, signal, (done, total) => progress.push([done, total]), drawing)
  const composed = async () => (await base.outlines.get(base.folder))!.flair?.composed ?? []
  return { ...base, claude, renderer, highlights, flair, plan, progress, composed }
}

test("the plan is stored with its palette, then each sound is composed for the room it has on the rough cut and stored with what it was composed for", async () => {
  const h = await withSounds()
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(1, "ติ๊งเบาๆ", { seconds: 1 }), planned(4, "วูบขึ้นตอนอวกาศ", { point: 1, loudness: "strong" }), planned(6, "นับถอยหลัง", { seconds: 2, point: 2, from: "heavy" })] })
  expect(await h.plan()).toEqual({ count: 3, dropped: 0 })
  expect(await h.composed()).toEqual([
    // ขึ้น ไป ใน อวกาศ in its one second
    { anchor: at(s(17.16)), from: "light", role: "ติ๊งเบาๆ", loudness: "normal", seconds: 1, words: [{ text: "ขึ้น", atS: 0 }, { text: "ไป", atS: 0.28 }, { text: "ใน", atS: 0.52 }, { text: "อวกาศ", atS: 0.92 }], code: GOOD, version: SOUND_VERSION, off: false },
    // planned for 3 s, it has 1.7 s before its piece ends: it is composed for that
    { anchor: at(s(18.08)), pointId: "p-space", from: "light", role: "วูบขึ้นตอนอวกาศ", loudness: "strong", seconds: 1.7, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], code: GOOD, version: SOUND_VERSION, off: false },
    { anchor: at(s(22.62)), pointId: "p-count", from: "heavy", role: "นับถอยหลัง", loudness: "normal", seconds: 2, words: [{ text: "สาม", atS: 0 }, { text: "สอง", atS: 1.26 }], code: GOOD, version: SOUND_VERSION, off: false },
  ])
  expect((await h.outlines.get(h.folder))!.flair!.palette).toBe(PALETTE)
  // the planning call, then one composing call each, made with the brief for the room each has
  expect(h.claude.requests.map((asked) => asked.system)).toEqual([SOUND_PLAN_PROMPT, SOUND_CONTRACT, SOUND_CONTRACT, SOUND_CONTRACT])
  const briefs = h.claude.requests.slice(1).map((asked) => textOf(asked.content))
  expect(briefs[1]).toBe(soundBrief({ palette: PALETTE, about: ABOUT, role: "วูบขึ้นตอนอวกาศ", seconds: 1.7, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], loudness: "strong" }))
  // each was rendered as it is kept: its code, the length and the words it was composed for, its loudness
  expect(h.renderer.check.mock.calls[1]).toEqual([{ code: GOOD, seconds: 1.7, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], loudness: "strong" }])
  expect(h.renderer.forgetMachine).toHaveBeenCalledTimes(1)
  expect(h.progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
  // what was checked is what is stored, so the file the check made is the one the preview and the write ask for
  const stored = await h.composed()
  expect(h.renderer.check.mock.calls.map(([job]) => job)).toEqual(stored.map(({ code, seconds, words, loudness }) => ({ code, seconds, words, loudness })))
  // composed for the room each has, each is fresh where it plays: at the loudest level and at the middle one
  for (const level of ["heavy", "medium"] as const) {
    const { view } = request()
    const placed = await h.highlights.composedSounds(h.folder, DEFAULT_CUT_RULES, { ...view, flair: { ...view.flair, level } })
    expect(placed.kept.map((sound) => sound.stale)).toEqual(level === "heavy" ? [null, null, null] : [null, null])
  }
})

test("Claude is shown the clip as it plays after the other works: every word, the beats, the points, the text, the graphics, the camera moves and the cutaways", async () => {
  const h = await withSounds({ media: { list: async () => [PICTURE] } as unknown as FlairDeps["media"] }, [ROCKET])
  const countPiece = (await h.highlights.preview(h.folder, DEFAULT_CUT_RULES, request().view)).pieces.find((piece) => piece.anchor.sourceUs <= s(22.62) && s(22.62) < piece.anchor.sourceUs + piece.durationUs)!
  // text on อวกาศ, and a cutaway of the picture, never looked at, where the countdown starts
  await h.highlights.addFromWords(h.folder, CLIP_ID, [3], 12, "beat-1")
  const cutaway = { anchor: at(s(22.62)), binId: "m1", edited: false, fit: "cover" as const, subject: null, pointId: "p-count" }
  // Claude's move on อวกาศ, from the loudest level only, which the sounds are shown all the same; and a legacy punch on the countdown's piece
  const move = {
    anchor: at(s(18.08)),
    from: "heavy" as const,
    about: "ดันเข้าช้าๆ ตรงอวกาศ",
    poses: [
      { s: 0, scale: 1, x: 0, y: 0, rot: 0, ease: "line" as const },
      { s: 1, scale: 1.15, x: 0, y: 0, rot: 0, ease: "inOut" as const },
    ],
    edited: false,
    off: false,
  }
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, outline: { ...stored!.outline, direction: "ลุ้น จังหวะเร็ว" }, flair: { ...stored!.flair!, zooms: [{ anchor: countPiece.anchor, kind: "punch", edited: false, pointId: "p-count" }], moves: [move], inserts: [cutaway] } }))
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [] })
  await h.plan(request({ graphic: true }))
  const text = textOf(h.claude.requests[0]!.content)
  expect(text.split("\n").slice(0, 14)).toEqual([
    `The clip: ${ABOUT}`,
    "Direction: ลุ้น จังหวะเร็ว",
    "Level: medium",
    "Words:",
    "1. 0:00.2 ขึ้น",
    "2. 0:00.4 ไป",
    "3. 0:00.7 ใน",
    "4. 0:01.1 อวกาศ",
    "5. 0:02.0 ใน",
    "6. 0:02.9 สาม",
    "7. 0:04.2 สอง",
    "8. 0:05.1 หนึ่ง",
    "Beats:",
    "- 0:00.0 นับถอยหลัง",
  ])
  expect(text).toContain("Emphasis points:\n1. 0:01.1 [key place] อวกาศ\n2. 0:02.9 [secondary number] สามสองหนึ่ง\nHighlight text lines:\n- 0:01.1 อวกาศ\n")
  expect(text).toContain(`Graphics:\n1. 0:01.1, 1.7 s: จรวดพุ่งขึ้นไปอวกาศ\n<fragment>\n${FRAGMENT}\n</fragment>\n`)
  // each move with how long it runs and what it does; a legacy punch in a piece with no text lands at the piece's start, and says what it is
  expect(text).toContain("Camera moves:\n- 0:01.1 1 s: ดันเข้าช้าๆ ตรงอวกาศ\n- 0:02.8 0.4 s: zoom punch\n")
  // a picture never looked at is named by its file
  expect(text).toContain("Cutaways:\n- 0:02.9 IMG_1.JPG")
})

test("a legacy punch gives way to a move only where that move plays at the level set: one from the loudest level alone leaves the punch playing at the middle one, and both are shown", async () => {
  const h = await withSounds()
  const countPiece = (await h.highlights.preview(h.folder, DEFAULT_CUT_RULES, request().view)).pieces.find((piece) => piece.anchor.sourceUs <= s(22.62) && s(22.62) < piece.anchor.sourceUs + piece.durationUs)!
  const move = {
    anchor: at(s(22.62)),
    from: "heavy" as const,
    about: "ดันเข้าตอนนับ",
    poses: [
      { s: 0, scale: 1, x: 0, y: 0, rot: 0, ease: "line" as const },
      { s: 1, scale: 1.1, x: 0, y: 0, rot: 0, ease: "line" as const },
    ],
    edited: false,
    off: false,
  }
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, zooms: [{ anchor: countPiece.anchor, kind: "punch", edited: false }], moves: [move] } }))
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [] })
  const shown = async (level: "medium" | "heavy") => {
    const { view } = request()
    await h.plan({ ...request(), view: { ...view, flair: { ...view.flair, level } } })
    const text = textOf(h.claude.requests.at(-1)!.content)
    return text.slice(text.indexOf("Camera moves:"), text.indexOf("Cutaways:"))
  }
  expect(await shown("medium")).toBe("Camera moves:\n- 0:02.8 0.4 s: zoom punch\n- 0:02.9 1 s: ดันเข้าตอนนับ\n")
  // at the loudest level the move plays on that piece, and the punch is replaced there
  expect(await shown("heavy")).toBe("Camera moves:\n- 0:02.9 1 s: ดันเข้าตอนนับ\n")
})

test("the clip's lists are made from what work 4 gathers, in playing order, and what each answer's numbers name is kept beside them", () => {
  const sentence: SpokenSentence = {
    videoId: "v",
    beatId: "b1",
    beatName: "เปิด",
    from: 0,
    to: 2,
    text: "ยอดขาย",
    timelineUs: 0,
    timelineEndUs: 800_000,
    endUs: 10_800_000,
    words: [
      { text: "ยอด", startUs: 10_000_000, timelineUs: 0 },
      { text: "ขาย", startUs: 10_400_000, timelineUs: 400_000 },
    ],
  }
  const point = (id: string, atUs: number): PlacedPoint => ({ point: { ...POINTS[0]!, id }, videoId: "v", beatId: "b1", cut: 0, sourceUs: 10_000_000, atUs, endUs: atUs + 1 })
  const graphic = (idea: string, atUs: number, extra: Partial<PlacedGraphic> = {}, html: string | null = FRAGMENT): PlacedGraphic => ({ cue: { ...ROCKET, spec: { ...ON_SPACE, idea, html } }, atUs, durationUs: 1_500_000, ...extra })
  const group: TimedGroup = { groupId: "g", beatId: "b1", startUs: 0, endUs: 1, lines: [{ lineIndex: 0, text: " ยอดขาย ", startUs: 400_000, partial: false }, { lineIndex: 1, text: "พุ่ง", startUs: 100_000, partial: false }] }
  const { clip, sources } = soundClipOf({
    about: "ยอดขาย",
    level: "heavy",
    sentences: [sentence],
    beats: [{ name: "เปิด", startUs: 0 }],
    points: [
      { placed: point("later", 400_000), what: "ขาย" },
      { placed: point("first", 0), what: "ยอด" },
    ],
    groups: [group],
    graphics: [graphic("ทีหลัง", 400_000), graphic("ยังไม่เขียน", 0, {}, null), graphic("เก่า", 0, { stale: true }), graphic("ก่อน", 0)],
    moves: [
      { atUs: 400_000, durationUs: 350_000, about: "zoom punch" },
      { atUs: 100_000, durationUs: 1_234_567, about: "ดันเข้า" },
    ],
    inserts: [{ what: "รูปร้าน", atUs: 400_000 }],
  })
  expect(clip).toEqual({
    about: "ยอดขาย",
    level: "heavy",
    words: [
      { text: "ยอด", atUs: 0 },
      { text: "ขาย", atUs: 400_000 },
    ],
    beats: [{ name: "เปิด", startUs: 0 }],
    points: [
      { importance: "key", type: "place", what: "ยอด", atUs: 0 },
      { importance: "key", type: "place", what: "ขาย", atUs: 400_000 },
    ],
    lines: [
      { text: "พุ่ง", atUs: 100_000 },
      { text: "ยอดขาย", atUs: 400_000 },
    ],
    // only what is written and fresh
    graphics: [
      { idea: "ก่อน", html: FRAGMENT, atUs: 0, seconds: 1.5 },
      { idea: "ทีหลัง", html: FRAGMENT, atUs: 400_000, seconds: 1.5 },
    ],
    // in playing order, each running for its length to the tenth of a second
    moves: [
      { atUs: 100_000, seconds: 1.2, about: "ดันเข้า" },
      { atUs: 400_000, seconds: 0.4, about: "zoom punch" },
    ],
    inserts: [{ what: "รูปร้าน", atUs: 400_000 }],
  })
  // each word with the moment of speech it is said at, in its sentence's beat
  expect(sources.words.map((word) => word.anchor)).toEqual([
    { kind: "speech", videoId: "v", sourceUs: 10_000_000, beatId: "b1" },
    { kind: "speech", videoId: "v", sourceUs: 10_400_000, beatId: "b1" },
  ])
  expect(sources.graphics.map((placed) => placed.cue.spec.idea)).toEqual(["ก่อน", "ทีหลัง"])
  expect(sources.pointIds).toEqual(["first", "later"])
  expect(describeSoundClip(clip)).toContain("Words:\n1. 0:00.0 ยอด\n2. 0:00.4 ขาย")
})

test("while the graphics are being written, the clip lists the ones not written yet too, with no fragment; one gone stale is still left out", () => {
  const graphic = (idea: string, atUs: number, extra: Partial<PlacedGraphic> = {}, html: string | null = FRAGMENT): PlacedGraphic => ({ cue: { ...ROCKET, spec: { ...ON_SPACE, idea, html } }, atUs, durationUs: 1_500_000, ...extra })
  const { clip, sources } = soundClipOf({
    about: "ยอดขาย",
    level: "heavy",
    sentences: [],
    beats: [],
    points: [],
    groups: [],
    graphics: [graphic("ทีหลัง", 400_000), graphic("ยังไม่เขียน", 0, {}, null), graphic("เก่า", 0, { stale: true }), graphic("ก่อน", 0)],
    moves: [],
    inserts: [],
    drawing: true,
  })
  expect(clip.graphics).toEqual([
    { idea: "ยังไม่เขียน", html: null, atUs: 0, seconds: 1.5 },
    { idea: "ก่อน", html: FRAGMENT, atUs: 0, seconds: 1.5 },
    { idea: "ทีหลัง", html: FRAGMENT, atUs: 400_000, seconds: 1.5 },
  ])
  expect(sources.graphics.map((placed) => placed.cue.spec.idea)).toEqual(["ยังไม่เขียน", "ก่อน", "ทีหลัง"])
})

test("a planned sound is stored on its word's moment, or with its graphic's place and the hash of its fragment; one whose place an earlier one holds is dropped", () => {
  const word = (text: string, atUs: number, sourceUs: number) => ({ text, atUs, anchor: at(sourceUs) })
  const rocket: PlacedGraphic = { cue: ROCKET, atUs: 1_000_000, durationUs: 1_700_000 }
  // footage played twice in one beat says ยอด twice at one moment of speech
  const sources = { words: [word("ยอด", 0, 100), word("ขาย", 500_000, 200), word("ยอด", 1_000_000, 100)], graphics: [rocket], pointIds: ["p1"] }
  const sound = (extra: Partial<PlannedSound>): PlannedSound => ({ word: 0, graphic: null, seconds: 0.6, role: "ติ๊ง", point: null, from: "medium", loudness: "soft", ...extra })
  const { sounds, dropped } = soundsToStore([sound({ point: 0 }), sound({ word: 2 }), sound({ word: 1, graphic: 0, seconds: 1 })], sources)
  expect(dropped).toBe(1)
  expect(sounds).toEqual([
    { anchor: at(100), pointId: "p1", from: "medium", role: "ติ๊ง", loudness: "soft", seconds: 0.6, words: [{ text: "ยอด", atS: 0 }, { text: "ขาย", atS: 0.5 }], code: null, version: SOUND_VERSION, off: false },
    // its words are from where its graphic comes up
    { anchor: ROCKET.anchor, graphic: ROCKET.anchor, graphicHtml: hashOfHtml(FRAGMENT), from: "medium", role: "ติ๊ง", loudness: "soft", seconds: 1, words: [{ text: "ยอด", atS: 0 }], code: null, version: SOUND_VERSION, off: false },
  ])
})

test("a sound that scores a graphic is stored on the graphic's place, tied to it with the hash of its fragment, and composed to its picture", async () => {
  const h = await withSounds({}, [ROCKET])
  // the word answered for a graphic's sound is not read: it starts with the graphic
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 })] })
  expect(await h.plan(request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  expect(await h.composed()).toMatchObject([{ anchor: ROCKET.anchor, graphic: ROCKET.anchor, graphicHtml: hashOfHtml(FRAGMENT), seconds: 1.2, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], code: GOOD }])
  expect(textOf(h.claude.requests[1]!.content)).toBe(
    soundBrief({ palette: PALETTE, about: ABOUT, role: "จรวดพุ่ง", seconds: 1.2, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], loudness: "normal", graphic: { idea: ON_SPACE.idea, html: FRAGMENT } }),
  )
  // its graphic's fragment changed: the sound is stale by the picture, as its hash says
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [{ ...ROCKET, spec: { ...ON_SPACE, html: `${FRAGMENT}<i></i>` } }] } }))
  expect((await h.highlights.composedSounds(h.folder, DEFAULT_CUT_RULES, request({ graphic: true }).view)).kept.map((sound) => sound.stale)).toEqual(["picture"])
})

test("a sound whose code still fails after its one repair is stored with no code and why, and counts as dropped; the others are composed all the same", async () => {
  const h = await withSounds()
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(1, "ติ๊ง", { seconds: 1 }), planned(4, "พัง")] })
  h.claude.replies.set(SOUND_CONTRACT, (asked: LlmRequest<unknown>) => (textOf(asked.content).includes("พัง") ? FETCHES : GOOD))
  expect(await h.plan()).toEqual({ count: 1, dropped: 1 })
  const [kept, broken] = await h.composed()
  expect(kept).toMatchObject({ code: GOOD })
  expect(broken).toMatchObject({ code: null, failed: lintCompose(FETCHES)[0] })
  // the one repair was asked with the first brief, the problems and the code
  const asked = h.claude.requests.filter((call) => call.system === SOUND_CONTRACT).map((call) => textOf(call.content))
  expect(asked).toHaveLength(3)
  expect(asked.at(-1)).toBe(soundRepairBrief({ brief: asked.find((brief) => brief.includes("พัง"))!, code: FETCHES, problems: lintCompose(FETCHES) }))
})

test("a render that fails sends the code to its one repair; where nothing can be rendered the code the linter passed is kept as it is", async () => {
  const failing = await withSounds({ soundRenderer: fakeRenderer((job) => (job.code === GOOD ? ["it is silent"] : [])) })
  failing.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(4, "วูบ")] })
  let calls = 0
  failing.claude.replies.set(SOUND_CONTRACT, () => (++calls === 1 ? GOOD : MENDED))
  expect(await failing.plan()).toEqual({ count: 1, dropped: 0 })
  expect(await failing.composed()).toMatchObject([{ code: MENDED }])
  expect(textOf(failing.claude.requests.at(-1)!.content)).toContain("\n- it is silent\n")

  for (const renderer of [fakeRenderer(() => null), undefined]) {
    const unrendered = await withSounds({ soundRenderer: renderer })
    unrendered.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(4, "วูบ")] })
    expect(await unrendered.plan()).toEqual({ count: 1, dropped: 0 })
    expect(await unrendered.composed()).toMatchObject([{ code: GOOD }])
    expect(unrendered.claude.requests).toHaveLength(2)
  }
})

test("a planned sound with no place on the rough cut is stored and left uncomposed", async () => {
  const h = await withSounds()
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(1, "ติ๊ง", { seconds: 1 }), planned(4, "วูบ")] })
  // the placing finds no place for the first one
  const placing = createHighlightService({ outlines: h.outlines, timeline: h.service, footage: h.deps })
  const flair = createFlairService({
    outlines: h.outlines,
    timeline: h.service,
    llm: h.claude.llm,
    composedSounds: async (folder, rules, options) => {
      const placed = await placing.composedSounds(folder, rules, options)
      return { ...placed, kept: placed.kept.slice(1), unplaced: placed.unplaced + 1 }
    },
    soundRenderer: h.renderer,
  })
  const progress: [number, number][] = []
  expect(await flair.planSounds(h.folder, request(), undefined, (done, total) => progress.push([done, total]))).toEqual({ count: 1, dropped: 0 })
  expect((await h.composed()).map((sound) => [sound.anchor, sound.code, sound.failed])).toEqual([
    [at(s(17.16)), null, undefined],
    [at(s(18.08)), GOOD, undefined],
  ])
  expect(progress).toEqual([[0, 1], [1, 1]])
})

test("each run replaces the composed sounds and Claude's CapCut sounds; the user's own CapCut sounds stay", async () => {
  const h = await withSounds()
  const old: ComposedSound = { anchor: at(s(19.0)), from: "light", role: "เก่า", loudness: "soft", seconds: 1, words: [], code: GOOD, version: SOUND_VERSION, off: false }
  const claudes = { anchor: at(s(17.16)), effectId: "s1", edited: false, pointId: "p-space" }
  const mine = { anchor: at(s(22.62)), effectId: "s2", edited: true }
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, composed: [old], palette: "old", cues: [claudes, mine] } }))
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(4, "วูบ")] })
  await h.plan()
  const flair = (await h.outlines.get(h.folder))!.flair!
  expect(flair.cues).toEqual([mine])
  expect(flair.composed!.map((sound) => sound.role)).toEqual(["วูบ"])
  expect(flair.palette).toBe(PALETTE)
})

test("a stop while the sounds are composed ends the work as a stopped call ends one: what was composed stays, the rest is left uncomposed", async () => {
  const stop = new AbortController()
  const h = await withSounds()
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(1, "ติ๊ง", { seconds: 1 }), planned(4, "วูบ")] })
  h.claude.replies.set(SOUND_CONTRACT, async (asked: LlmRequest<unknown>) => {
    if (textOf(asked.content).includes("ติ๊ง")) return GOOD
    // the other is still being composed when the user presses stop, once the first is stored
    while ((await h.composed())[0]?.code !== GOOD) await new Promise((resolve) => setTimeout(resolve, 2))
    stop.abort(new Error(CANCELLED))
    throw new Error(CANCELLED)
  })
  await expect(h.plan(request(), stop.signal)).rejects.toThrow(CANCELLED)
  expect((await h.composed()).map((sound) => [sound.code, sound.failed])).toEqual([
    [GOOD, undefined],
    [null, undefined],
  ])
  // nothing is reported after the stop
  expect(h.progress).toEqual([[0, 2], [1, 2]])
})

test("a beat that gets a new id while Claude plans keeps its sounds, and a point deleted meanwhile takes its sound along", async () => {
  const h = await withSounds()
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let asked!: () => void
  const planning = new Promise<void>((resolve) => (asked = resolve))
  h.claude.replies.set(SOUND_PLAN_PROMPT, async () => {
    asked()
    await held
    return { palette: PALETTE, sounds: [planned(4, "วูบ", { point: 1 }), planned(6, "นับ", { point: 2 })] }
  })
  const running = h.plan()
  await planning
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    emphasis: { ...stored!.emphasis!, points: stored!.emphasis!.points.filter((point) => point.id !== "p-count") },
    outline: { ...stored!.outline, beats: stored!.outline.beats.map((beat) => ({ ...beat, id: `${beat.id}-grown` })) },
  }))
  release()
  await running
  expect((await h.composed()).map((sound) => [sound.anchor, sound.pointId])).toEqual([[{ ...at(s(18.08)), beatId: "beat-1-grown" }, "p-space"]])
})

test("with no word on the rough cut Claude is not asked and nothing changes; with no Claude connection the work fails with why", async () => {
  const h = await withSounds()
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], keep: false })
  const before = await h.outlines.get(h.folder)
  expect(await h.plan()).toEqual({ count: 0, dropped: 0 })
  expect(h.claude.requests).toHaveLength(0)
  expect(await h.outlines.get(h.folder)).toEqual(before)

  const unconnected = createFlairService({ outlines: h.outlines, timeline: h.service })
  await expect(unconnected.planSounds(h.folder, request())).rejects.toThrow(/^composing sounds is not ready: no Claude connection$/)
  // with the sounds off nothing is asked
  expect(await h.flair.planSounds(h.folder, request({ sound: false }))).toEqual({ count: 0, dropped: 0 })
})

/** Holds Claude's answer to the planning call until the test lets it go, once the work has asked. */
function heldPlan(h: Awaited<ReturnType<typeof withSounds>>, reply: unknown) {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let asked!: () => void
  const thinking = new Promise<void>((resolve) => (asked = resolve))
  h.claude.replies.set(SOUND_PLAN_PROMPT, async () => {
    asked()
    await held
    return reply
  })
  return { thinking, release }
}

test("a sound for a graphic taken away while Claude plans is not stored; the others are", async () => {
  const h = await withSounds({}, [ROCKET])
  const plan = heldPlan(h, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 }), planned(6, "นับ", { seconds: 2 })] })
  const running = h.plan(request({ graphic: true }))
  await plan.thinking
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [] } }))
  plan.release()
  expect(await running).toEqual({ count: 1, dropped: 0 })
  expect((await h.composed()).map((sound) => [sound.anchor, sound.graphic, sound.code])).toEqual([[at(s(22.62)), undefined, GOOD]])
})

test("a sound whose graphic has no picture to score, not written or gone stale, is left uncomposed", async () => {
  for (const graphic of [{ stale: true }, { html: null }]) {
    const h = await withSounds({}, [ROCKET])
    h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 }), planned(6, "นับ", { seconds: 2 })] })
    // the graphic changed after the plan was stored: the placing hands the sound on with it so
    const placing = h.highlights.composedSounds
    const flair = createFlairService({
      outlines: h.outlines,
      timeline: h.service,
      llm: h.claude.llm,
      graphicJobs: (folder, rules, options) => h.highlights.graphicJobs(folder, rules, options),
      composedSounds: async (folder, rules, options) => {
        const placed = await placing(folder, rules, options)
        const changed = (sound: PlacedComposed): PlacedComposed =>
          sound.graphic
            ? { ...sound, graphic: { ...sound.graphic, ...("stale" in graphic ? { stale: true } : { cue: { ...sound.graphic.cue, spec: { ...sound.graphic.cue.spec, html: null } } }) } }
            : sound
        return { ...placed, kept: placed.kept.map(changed) }
      },
      soundRenderer: h.renderer,
    })
    expect(await flair.planSounds(h.folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
    expect((await h.composed()).map((sound) => [sound.graphic !== undefined, sound.code])).toEqual([
      [true, null],
      [false, GOOD],
    ])
    expect(h.claude.requests.filter((asked) => asked.system === SOUND_CONTRACT)).toHaveLength(1)
  }
})

test("a sound taken away while it is composed is not put back", async () => {
  const h = await withSounds()
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(4, "วูบ")] })
  let answer!: () => void
  const held = new Promise<void>((resolve) => (answer = resolve))
  let composing!: () => void
  const asked = new Promise<void>((resolve) => (composing = resolve))
  h.claude.replies.set(SOUND_CONTRACT, async () => {
    composing()
    await held
    return GOOD
  })
  const running = h.plan()
  await asked
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, composed: [] } }))
  answer()
  expect(await running).toEqual({ count: 0, dropped: 0 })
  expect(await h.composed()).toEqual([])
})

test("a sound tied to a graphic is stored and left uncomposed while graphics are not shown where it is placed", async () => {
  const h = await withSounds({}, [ROCKET])
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 })] })
  // planned with the graphics shown, placed with them switched off: the placing leaves the tied sound out
  const flair = createFlairService({
    outlines: h.outlines,
    timeline: h.service,
    llm: h.claude.llm,
    graphicJobs: (folder, rules, options) => h.highlights.graphicJobs(folder, rules, options),
    composedSounds: (folder, rules, options) => h.highlights.composedSounds(folder, rules, { ...options, flair: { ...options.flair, graphic: false } }),
    soundRenderer: h.renderer,
  })
  const progress: [number, number][] = []
  expect(await flair.planSounds(h.folder, request({ graphic: true }), undefined, (done, total) => progress.push([done, total]))).toEqual({ count: 0, dropped: 0 })
  expect((await h.composed()).map((sound) => [sound.graphic, sound.code])).toEqual([[ROCKET.anchor, null]])
  expect(h.claude.requests.filter((asked) => asked.system === SOUND_CONTRACT)).toHaveLength(0)
  expect(progress).toEqual([])
})

/* the sounds planned while the graphics are being written */

/** The rocket planned and stored, not written yet, as work 2c leaves it before its writing. */
const UNWRITTEN: GraphicCue = { ...ROCKET, spec: { ...ON_SPACE, html: null } }

/** The graphics' writing as the sounds work is handed it: a promise the test settles once it has stored what the writing ended with. */
function drawingHeld() {
  let end!: () => void
  const drawing = new Promise<void>((resolve) => (end = resolve))
  return { drawing, end }
}

test("planned while the graphics are being written, the sounds see the graphics not written yet; the untied ones compose at once, a tied one waits for its graphic and composes from the fragment it got", async () => {
  const h = await withSounds({}, [UNWRITTEN])
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 }), planned(6, "นับ", { seconds: 2 })] })
  const held = drawingHeld()
  const running = h.plan(request({ graphic: true }), undefined, held.drawing)
  // the untied sound is composed while the graphic is still being written
  while ((await h.composed()).find((sound) => sound.graphic === undefined)?.code !== GOOD) await new Promise((resolve) => setTimeout(resolve, 2))
  expect(textOf(h.claude.requests[0]!.content)).toContain("Graphics:\n1. 0:01.1, 1.7 s: จรวดพุ่งขึ้นไปอวกาศ\n(not drawn yet)\n")
  expect(h.claude.requests.filter((asked) => asked.system === SOUND_CONTRACT)).toHaveLength(1)
  expect(h.progress).toEqual([[0, 2], [1, 2]])
  // the graphic is written and stored, and its writing ends: the tied sound composes to that fragment
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [ROCKET] } }))
  held.end()
  expect(await running).toEqual({ count: 2, dropped: 0 })
  const composings = h.claude.requests.filter((asked) => asked.system === SOUND_CONTRACT)
  expect(composings).toHaveLength(2)
  expect(textOf(composings[1]!.content)).toBe(
    soundBrief({ palette: PALETTE, about: ABOUT, role: "จรวดพุ่ง", seconds: 1.2, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], loudness: "normal", graphic: { idea: ON_SPACE.idea, html: FRAGMENT } }),
  )
  expect((await h.composed()).map((sound) => [sound.graphic, sound.graphicHtml, sound.code])).toEqual([
    [ROCKET.anchor, hashOfHtml(FRAGMENT), GOOD],
    [undefined, undefined, GOOD],
  ])
  expect(h.progress).toEqual([[0, 2], [1, 2], [2, 2]])
  // fresh where it plays: composed to the picture its graphic has
  expect((await h.highlights.composedSounds(h.folder, DEFAULT_CUT_RULES, request({ graphic: true }).view)).kept.map((sound) => sound.stale)).toEqual([null, null])
})

test("a tied sound whose graphic's writing failed, or whose graphic is gone, stays uncomposed once the graphics' writing ends; the work's count reaches its end all the same", async () => {
  for (const ending of ["failed", "gone"] as const) {
    const h = await withSounds({}, [UNWRITTEN])
    h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 }), planned(6, "นับ", { seconds: 2 })] })
    const held = drawingHeld()
    const running = h.plan(request({ graphic: true }), undefined, held.drawing)
    while ((await h.composed()).find((sound) => sound.graphic === undefined)?.code !== GOOD) await new Promise((resolve) => setTimeout(resolve, 2))
    const graphics = ending === "failed" ? [{ ...UNWRITTEN, spec: { ...UNWRITTEN.spec, failed: "the render failed" } }] : []
    await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics } }))
    held.end()
    expect(await running, ending).toEqual({ count: 1, dropped: 0 })
    expect(h.claude.requests.filter((asked) => asked.system === SOUND_CONTRACT), ending).toHaveLength(1)
    expect((await h.composed()).map((sound) => [sound.graphic !== undefined, sound.code]), ending).toEqual([
      [true, null],
      [false, GOOD],
    ])
    expect(h.progress, ending).toEqual([[0, 2], [1, 2], [2, 2]])
  }
})

test("a stop while the sounds wait for the graphics ends the work as a stopped call ends one: the tied sound is never composed", async () => {
  const stop = new AbortController()
  const h = await withSounds({}, [UNWRITTEN])
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 }), planned(6, "นับ", { seconds: 2 })] })
  const held = drawingHeld()
  const running = h.plan(request({ graphic: true }), stop.signal, held.drawing)
  while ((await h.composed()).find((sound) => sound.graphic === undefined)?.code !== GOOD) await new Promise((resolve) => setTimeout(resolve, 2))
  // the stop ends the graphics' writing too, with its graphic written meanwhile
  stop.abort(new Error(CANCELLED))
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [ROCKET] } }))
  held.end()
  await expect(running).rejects.toThrow(CANCELLED)
  expect(h.claude.requests.filter((asked) => asked.system === SOUND_CONTRACT)).toHaveLength(1)
  expect((await h.composed()).map((sound) => [sound.graphic !== undefined, sound.code])).toEqual([
    [true, null],
    [false, GOOD],
  ])
  expect(h.progress).toEqual([[0, 2], [1, 2]])
})

test("planned while the graphics are being written, a graphic not written yet that the level set will not write is not shown, and no sound is tied to it", async () => {
  // a free graphic that plays only at the loudest level, not written, and the sounds planned at the middle one
  const heavyOnly: GraphicCue = { ...UNWRITTEN, from: "heavy" }
  const h = await withSounds({}, [heavyOnly])
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 }), planned(6, "นับ", { seconds: 2 })] })
  const held = drawingHeld()
  held.end()
  expect(await h.plan(request({ graphic: true }), undefined, held.drawing)).toEqual({ count: 1, dropped: 1 })
  expect(textOf(h.claude.requests[0]!.content)).toContain("Graphics: none\n")
  expect((await h.composed()).map((sound) => [sound.graphic, sound.code])).toEqual([[undefined, GOOD]])
  // at the loudest level the same graphic is being written, and is shown
  const loud = await withSounds({}, [heavyOnly])
  loud.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [] })
  const asked = request({ graphic: true })
  await loud.plan({ ...asked, view: { ...asked.view, flair: { ...asked.view.flair, level: "heavy" } } }, undefined, held.drawing)
  expect(textOf(loud.claude.requests[0]!.content)).toContain("Graphics:\n1. 0:01.1, 1.7 s: จรวดพุ่งขึ้นไปอวกาศ\n(not drawn yet)\n")
})

test("a composing that fails for anything but a stop while the graphics are written fails the work at once: the tied sounds are not composed after", async () => {
  const h = await withSounds({}, [UNWRITTEN])
  h.claude.replies.set(SOUND_PLAN_PROMPT, { palette: PALETTE, sounds: [planned(99, "จรวดพุ่ง", { graphic: 1, seconds: 1.2 }), planned(6, "นับ", { seconds: 2 })] })
  // the untied sound is composed, and storing it fails
  const update = h.outlines.update.bind(h.outlines)
  let composings = 0
  h.claude.replies.set(SOUND_CONTRACT, async () => {
    composings++
    h.outlines.update = async () => {
      throw new Error("the disk is full")
    }
    return GOOD
  })
  const held = drawingHeld()
  const outcome = h.plan(request({ graphic: true }), undefined, held.drawing).then(
    () => "done",
    (error: Error) => error.message,
  )
  // it fails while the graphics are still being written
  expect(await outcome).toBe("the disk is full")
  h.outlines.update = update
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [ROCKET] } }))
  held.end()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(composings).toBe(1)
})
