import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, vi } from "vitest"
import { MediaCache } from "@boxblack/core/cache"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import type { EmphasisPoint } from "@boxblack/core/emphasis/types"
import { TECHNIQUES_PROMPT } from "@boxblack/core/flair/direct"
import { MEDIA_PROMPT, type MediaLook } from "@boxblack/core/flair/look-at"
import { SOUNDS_PROMPT } from "@boxblack/core/flair/sound-plan"
import { BUILT_IN_SOUNDS } from "@boxblack/core/flair/sound-catalogue"
import { stageBox } from "@boxblack/core/graphics/framing"
import { MOTION_PLAN_PROMPT } from "@boxblack/core/graphics/motion/direct"
import { lintFragment } from "@boxblack/core/graphics/motion/lint"
import { editBrief, MOTION_CONTRACT, motionBrief, repairBrief } from "@boxblack/core/graphics/motion/write"
import { isMotion, MOTION_VERSION, type GraphicCue, type MotionSpec, type MotionWord, type PreviousFragment } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import type { Beat } from "@boxblack/core/planner"
import type { Scene } from "@boxblack/core/vision"
import type { PostRequest, StoredOutline } from "../shared/api.ts"
import { CANCELLED } from "./ai-calls.ts"
import { withoutPoint } from "./emphasis.ts"
import { createFlairService, type FlairDeps } from "./flair.ts"
import type { RenderJob } from "./graphics-render.ts"
import { transcriptFingerprint } from "./footage.ts"
import { createHighlightService } from "./highlights.ts"
import { CLIP_ID, countdown, readInfo, s, setup, transcript } from "./timeline-fixture.ts"

// Works 2b, 2c and 4 on the fixture draft. Its transcript: ขึ้น(0) ไป(1) ใน(2) อวกาศ(3) ใน(4) สาม(5) สอง(6)
// หนึ่ง(7) | สาม(8) สอง(9) หนึ่ง(10); the cut keeps "ขึ้นไปในอวกาศใน" and the second "สามสองหนึ่ง", each in a
// piece of its own about 2.9 s long
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

const SOUNDS = [
  { effectId: "s1", name: "ปัง", durationUs: 330_000, path: "/cache/s1.mp3" },
  { effectId: "s2", name: "ฟิ้ว", durationUs: 3_000_000, path: null },
]
const PICTURES = [
  { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo" as const, width: 3024, height: 4032, durationUs: 5_000_000 },
  { binId: "m2", path: "/clips/shop.mp4", name: "IMG_2.MOV", kind: "video" as const, width: 1080, height: 1920, durationUs: 2_000_000 },
]
/** One graphic of Claude's plan: from its point's first word, for 2 s, in a box clear of everything on the fixture's frame. */
const MOTION = { word: "", until: "", seconds: 2, why: "ไปไหน", box: [0.1, 0.6, 0.9, 0.75], idea: "จรวดพุ่งขึ้นจากขอบล่างของกรอบ" }
/** A fragment the linter passes: what the stand-in for Claude writes for every graphic, unless a test says otherwise. */
const FRAGMENT = '<style>.n{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="n">3 2 1</div>'
/** Another one, so a fragment written later can be told from the first. */
const MENDED = '<style>.m{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="m">อวกาศ</div>'
/** One the linter refuses, for a timer. */
const TIMER = `${FRAGMENT}<script>setTimeout(() => {}, 10)</script>`
/** The style the graphics are drawn in, as the app hands the highlight service the one in force. */
const STYLE = HIGHLIGHT_STYLES["bold-white"]

/**
 * One transport for every call: each work's prompt gets the reply set for it, a stop fails them all, and a gate holds
 * them. A reply that is a function is asked with the call, and may answer in its own time: a graphic's writing and
 * its repair are one prompt, the contract, and are told apart by what they are asked.
 */
function fakeClaude() {
  const requests: LlmRequest<unknown>[] = []
  const replies = new Map<string, unknown>()
  const state = { fail: null as Error | null, gate: null as Promise<void> | null, heldAt: 0 }
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      // a call made with a stop already pressed ends at once, as the real transports end one
      if (request.signal?.aborted) throw request.signal.reason
      // Claude "thinks" until the test has made its changes
      if (state.gate) await state.gate
      if (state.fail) throw state.fail
      const reply = replies.get(request.system) ?? {}
      const output = typeof reply === "function" ? await (reply as (asked: LlmRequest<unknown>) => unknown)(request as LlmRequest<unknown>) : reply
      return { output: output as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { requests, replies, state, llm: async () => ({ transport, model: "claude-sonnet-5" }) }
}

const textOf = (content: LlmContent[]) => content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join("\n")

/** Holds every call until the returned function is called, so the user can change things while Claude thinks. */
function hold(claude: ReturnType<typeof fakeClaude>): () => void {
  let release!: () => void
  claude.state.gate = new Promise<void>((resolve) => (release = resolve))
  claude.state.heldAt = claude.requests.length
  return () => {
    claude.state.gate = null
    release()
  }
}
/** Once a held work has asked Claude: it has read the outline and waits on the answer (the fake notes a call before it waits). */
async function thinking(claude: ReturnType<typeof fakeClaude>): Promise<void> {
  while (claude.requests.length === claude.state.heldAt) await new Promise((resolve) => setImmediate(resolve))
}

/** The calls made with one prompt, in order: a plan's by its own, a graphic's writing and its repair by the contract. */
const callsWith = (claude: ReturnType<typeof fakeClaude>, system: string) => claude.requests.filter((asked) => asked.system === system)
/** What each writing call, and each repair, was asked, in order. */
const briefs = (claude: ReturnType<typeof fakeClaude>) => callsWith(claude, MOTION_CONTRACT).map((asked) => textOf(asked.content))

/**
 * Writing calls that wait until the test answers them, each known by what it was asked, and that end as a stopped
 * call ends when the stop they were made with is pressed.
 */
function heldWriting(claude: ReturnType<typeof fakeClaude>) {
  const waiting: { brief: string; answer: (fragment: string) => void }[] = []
  claude.replies.set(
    MOTION_CONTRACT,
    (asked: LlmRequest<unknown>) =>
      new Promise<string>((resolve, reject) => {
        waiting.push({ brief: textOf(asked.content), answer: resolve })
        asked.signal?.addEventListener("abort", () => reject(asked.signal!.reason), { once: true })
      }),
  )
  return {
    waiting,
    /** Once this many calls have been made. */
    async asked(count: number): Promise<void> {
      while (waiting.length < count) await new Promise((resolve) => setImmediate(resolve))
    },
    /** The last call made for the graphic with this idea: its repair, once it has one. */
    of: (idea: string) => waiting.findLast((call) => call.brief.includes(`- What to draw: ${idea}\n`))!,
  }
}

/**
 * A renderer that knows a job by its whole content, as the renderers of the other tests do. `verdict` says what
 * comes of rendering a fragment: null and it is made, words and it has failed for them, nothing (undefined) and it
 * is neither, as on a machine that cannot render. With `held`, every render takes until that settles.
 */
function fakeRenderer(verdict: (html: string) => string | null | undefined = () => null, held?: Promise<void>) {
  const hashOf = (job: RenderJob) => JSON.stringify(job)
  const failures = new Map<string, string>()
  return {
    hashOf,
    ensure: vi.fn<(jobs: RenderJob[], folder: string) => void>(),
    retry: vi.fn<(hash: string) => void>(),
    forgetMachine: vi.fn<() => void>(),
    failureOf: (hash: string) => failures.get(hash) ?? null,
    wait: vi.fn(async (jobs: RenderJob[], _folder: string) => {
      await held
      const ready: string[] = []
      const failed: string[] = []
      for (const job of jobs) {
        const said = verdict(job.spec.html ?? "")
        if (said === null) ready.push(hashOf(job))
        else if (said !== undefined) {
          failures.set(hashOf(job), said)
          failed.push(hashOf(job))
        }
      }
      return { ready, failed }
    }),
  }
}

/**
 * The fixture with the two points (or `fixture.points`) stored at version 2, as work 1 would leave them;
 * `fixture.beats` and `fixture.scenes` go to the timeline fixture. Claude describes only the first picture
 * it is shown, and writes FRAGMENT for every graphic; every look at pictures or footage is a session of its own,
 * cleared away when the work is over. The graphics are placed and their jobs made by the highlight service, as
 * the app wires it; there is no renderer unless a test hands one in.
 */
async function withPoints(extra: Partial<FlairDeps> = {}, fixture: { points?: EmphasisPoint[]; beats?: Beat[]; scenes?: Scene[] } = {}) {
  const library = { list: async () => SOUNDS }
  const media = { list: async () => PICTURES }
  // fonts and animations where a write of highlight text finds them, for the tests that write
  const highlightAssets = { fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`, animationPath: async (id: string) => `/effect/${id}/hash` }
  const base = await setup({ sounds: library, media, highlightAssets, ...(fixture.beats ? { beats: fixture.beats } : {}), ...(fixture.scenes ? { scenes: fixture.scenes } : {}) })
  await base.outlines.update(base.folder, (stored) => ({
    ...stored!,
    emphasis: { points: fixture.points ?? POINTS, version: 2, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
  }))
  const claude = fakeClaude()
  claude.replies.set(MEDIA_PROMPT.system, { pictures: [{ picture: 1, what: "เล็บสีชมพู", subject: [], fit: "card" }] })
  claude.replies.set(MOTION_CONTRACT, FRAGMENT)
  const looks = new Map<string, MediaLook>()
  const frameDir = await mkdtemp(join(tmpdir(), "boxblack-frames-"))
  const lookings: { pictures: string[]; moments: { path: string; timesUs: number[] }[]; over: boolean }[] = []
  let n = 0
  const highlights = createHighlightService({ outlines: base.outlines, timeline: base.service, footage: base.deps, sounds: library, media, styleOf: async () => STYLE, newId: () => `id${++n}` })
  const flair = createFlairService({
    outlines: base.outlines,
    timeline: base.service,
    llm: claude.llm,
    sounds: library,
    // read from settings, as the app wires it: the fixture has CapCut Pro, so every sound is offered
    pro: async () => (await base.deps.settings.read()).capcut.pro,
    media,
    descriptions: {
      entry: async (path: string) => ({ get: async () => looks.get(path) ?? null, put: async (value: MediaLook) => void looks.set(path, value) }),
    },
    frames: () => {
      lookings.push({ pictures: [], moments: [], over: false })
      const looking = lookings.at(-1)!
      const frame = async (name: string) => {
        const path = join(frameDir, `${lookings.length}-${name}.jpg`)
        await writeFile(path, Buffer.from([1]))
        return path
      }
      return {
        of: async (picture: { binId: string }) => {
          looking.pictures.push(picture.binId)
          return [await frame(picture.binId)]
        },
        at: async (path: string, timesUs: number[]) => {
          looking.moments.push({ path, timesUs })
          return Promise.all(timesUs.map((us) => frame(String(us))))
        },
        dispose: async () => {
          looking.over = true
        },
      }
    },
    graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options),
    candidateJob: (folder, rules, graphic, spec) => highlights.candidateJob(folder, rules, graphic, spec),
    ...extra,
  })
  const preview = () => highlights.preview(base.folder, DEFAULT_CUT_RULES, request().view)
  /** The graphics the outline stores now. */
  const graphics = async () => (await base.outlines.get(base.folder))!.flair?.graphics ?? []
  /** The piece of the rough cut that plays a source time. */
  const pieceAt = async (sourceUs: number) => (await preview()).pieces.find((piece) => piece.anchor.sourceUs <= sourceUs && sourceUs < piece.anchor.sourceUs + piece.durationUs)!
  return { ...base, claude, highlights, flair, preview, pieceAt, lookings, graphics }
}

test("Claude zooms the piece a point plays in and cuts away where a point starts; each carries its point", async () => {
  const { flair, folder, claude, preview, pieceAt } = await withPoints()
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [{ point: 1, picture: 1 }] })
  expect(await flair.planTechniques(folder, request())).toEqual({ count: 2, dropped: 0 })
  const shown = await preview()
  expect(shown.zooms).toMatchObject([{ kind: "punch", edited: false, anchor: (await pieceAt(s(22.62))).anchor, pointId: "p-count" }])
  expect(shown.inserts).toMatchObject([{ binId: "m1", edited: false, anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }, pointId: "p-space" }])
  // Claude was shown the points in playing order, each with what a zoom could do there, and the pictures
  const text = textOf(claude.requests.at(-1)!.content)
  expect(text).toContain("(สำคัญ · สถานที่) “อวกาศ” — ไปอวกาศ · ซูมได้: ชิ้นยาว")
  expect(text).toContain("(รอง · ตัวเลข/ราคา) “สามสองหนึ่ง” — นับถอยหลัง · ซูมได้: ชิ้นยาว")
  // the picture Claude looked at is named by what it shows, the other by its file name
  expect(text).toContain("1. เล็บสีชมพู")
  expect(text).toContain("2. IMG_2.MOV (คลิป)")
})

test("a picture is looked at once, only one Claude said nothing about is asked again, and the frames are cleared away after", async () => {
  const { flair, folder, claude, lookings } = await withPoints()
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  const looks = () => claude.requests.filter((request) => request.system === MEDIA_PROMPT.system)
  await flair.planTechniques(folder, request())
  expect(looks()).toHaveLength(1)
  expect(looks()[0]!.content.filter((entry) => entry.type === "image")).toHaveLength(2)
  expect(lookings.map((looking) => looking.over)).toEqual([true])
  await flair.planTechniques(folder, request())
  // the second look is only about the one Claude skipped, and answers about it
  expect(looks()).toHaveLength(2)
  expect(looks()[1]!.content.filter((entry) => entry.type === "image")).toHaveLength(1)
  await flair.planTechniques(folder, request())
  expect(looks()).toHaveLength(2)
  // with the cutaways off no picture is looked at
  await flair.planTechniques(folder, request({ insert: false }))
  expect(lookings).toHaveLength(3)
})

test("the user's own zoom and cutaway stay when Claude thinks again; Claude's earlier answer gives way to the new one", async () => {
  const { flair, folder, claude, outlines, pieceAt } = await withPoints()
  const spacePiece = await pieceAt(s(18.08))
  await flair.setZoom(folder, spacePiece.anchor, "drift")
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 1, kind: "punch" }, { point: 2, kind: "punch" }], inserts: [{ point: 2, picture: 2 }] })
  await flair.planTechniques(folder, request())
  // the zoom Claude put on the user's piece is not taken
  expect((await outlines.get(folder))!.flair!.zooms!.map((zoom) => [zoom.kind, zoom.edited, zoom.pointId])).toEqual([
    ["drift", true, undefined],
    ["punch", false, "p-count"],
  ])
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  await flair.planTechniques(folder, request())
  const stored = (await outlines.get(folder))!.flair!
  expect(stored.zooms).toEqual([{ anchor: spacePiece.anchor, kind: "drift", edited: true }])
  expect(stored.inserts!.map((insert) => [insert.binId, insert.pointId])).toEqual([["m1", "p-space"]])
})

test("with the zooms off no piece is offered and the zooms stay as stored; with the cutaways off no picture is", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [{ point: 1, picture: 1 }] })
  await flair.planTechniques(folder, request())
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  await flair.planTechniques(folder, request({ zoom: false }))
  expect(textOf(claude.requests.at(-1)!.content)).toContain("ไม่มีชิ้นให้ซูม ตอบ zooms เป็นรายการว่าง")
  expect((await outlines.get(folder))!.flair!.zooms).toHaveLength(1)
  expect((await outlines.get(folder))!.flair!.inserts).toEqual([])
  await flair.planTechniques(folder, request({ insert: false }))
  expect(textOf(claude.requests.at(-1)!.content)).toContain("ไม่มีรูปให้แทรก ตอบ inserts เป็นรายการว่าง")
  // both off: nothing to ask
  const asked = claude.requests.length
  expect(await flair.planTechniques(folder, request({ zoom: false, insert: false }))).toEqual({ count: 0, dropped: 0 })
  expect(claude.requests).toHaveLength(asked)
})

test("with the cutaways off, Claude's cutaways already stored stay as they are while it thinks the zooms again", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  await flair.planTechniques(folder, request())
  const planned = (await outlines.get(folder))!.flair!.inserts!
  expect(planned.map((insert) => [insert.binId, insert.edited, insert.pointId])).toEqual([["m1", false, "p-space"]])
  // the zooms are still asked for; the cutaways are neither offered nor replaced
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [] })
  expect(await flair.planTechniques(folder, request({ insert: false }))).toEqual({ count: 1, dropped: 0 })
  expect((await outlines.get(folder))!.flair!.inserts).toEqual(planned)
})

test("at the lightest level Claude is still asked on every point, one of the least importance and its items included: the level only filters what plays", async () => {
  // p-count of the least importance, which only the loudest level lets through
  const { flair, folder, claude, outlines, pieceAt } = await withPoints({}, { points: [POINTS[0]!, { ...POINTS[1]!, importance: "extra" }] })
  const drawn = request({ graphic: true })
  const light: PostRequest = { ...drawn, view: { ...drawn.view, flair: { ...drawn.view.flair, level: "light" } } }
  // Claude's punch on the countdown's piece, for p-count
  const countPiece = await pieceAt(s(22.62))
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, zooms: [{ anchor: countPiece.anchor, kind: "punch", edited: false, pointId: "p-count" }] } }))
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [] })
  await flair.planSounds(folder, light)
  const slots = textOf(claude.requests.at(-1)!.content).split("\n").filter((line) => line.startsWith("["))
  // its punch is a place for a sound as at any level, named with its point's importance
  expect(slots[1]).toMatch(/ ภาพซูมกระแทก \(เสริม · ตัวเลข\/ราคา\)$/)
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  await flair.planTechniques(folder, light)
  expect(textOf(claude.requests.at(-1)!.content)).toContain("(เสริม · ตัวเลข/ราคา) “สามสองหนึ่ง”")
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  await flair.planGraphics(folder, light)
  expect(textOf(claude.requests.at(-1)!.content)).toContain("(เสริม · ตัวเลข/ราคา) “สามสองหนึ่ง”")
})

test("a point whose words are cut is not shown to Claude, and what Claude put on it waits for it to come back", async () => {
  const { flair, folder, claude, outlines, service } = await withPoints()
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 2, picture: 2 }] })
  await flair.planTechniques(folder, request())
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [8, 9, 10], keep: false })
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  await flair.planTechniques(folder, request())
  expect(textOf(claude.requests.at(-1)!.content)).not.toContain("นับถอยหลัง")
  expect((await outlines.get(folder))!.flair!.inserts!.map((insert) => insert.pointId)).toEqual(["p-count"])
})

test("Stop pressed while Claude thinks leaves the outline as it was", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  claude.state.fail = new Error("cancelled")
  const before = await outlines.get(folder)
  await expect(flair.planTechniques(folder, request())).rejects.toThrow("cancelled")
  await expect(flair.planSounds(folder, request())).rejects.toThrow("cancelled")
  expect(await outlines.get(folder)).toEqual(before)
})

test("sounds are offered on the points and on what sits on them, never on a beat's edge or a join, each with its point's importance", async () => {
  const { flair, folder, claude, outlines, preview, pieceAt } = await withPoints()
  const countPiece = await pieceAt(s(22.62))
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, zooms: [{ anchor: countPiece.anchor, kind: "punch", edited: false, pointId: "p-count" }] } }))
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }, { at: 2, sound: 2 }] })
  expect(await flair.planSounds(folder, request())).toEqual({ count: 2, dropped: 0 })
  const text = textOf(claude.requests.at(-1)!.content)
  const slots = text.split("\n").filter((line) => line.startsWith("["))
  // p-space carries nothing yet, so it is a place of its own; p-count is heard through its punch
  expect(slots).toHaveLength(2)
  expect(slots[0]).toMatch(/ จุดเน้นในช่วง "นับถอยหลัง" — ไปอวกาศ \(สำคัญ · สถานที่\)$/)
  expect(slots[1]).toMatch(/ ภาพซูมกระแทก \(รอง · ตัวเลข\/ราคา\)$/)
  expect(text).not.toContain("ต้นช่วง")
  expect(text).not.toContain("รอยตัด")
  const shown = await preview()
  expect(shown.cues.map((cue) => [cue.effectId, cue.pointId, cue.atUs])).toEqual([
    ["s1", "p-space", shown.emphasis.points[0]!.atUs],
    ["s2", "p-count", countPiece.atUs],
  ])
})

test("a sound on a point's start is shown on the sentence and the word it plays at", async () => {
  const { flair, folder, claude, preview } = await withPoints()
  // p-space carries nothing, so its first kept moment is the first slot
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  await flair.planSounds(folder, request())
  expect((await preview()).cues).toMatchObject([
    { effectId: "s1", pointId: "p-space", anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }, what: "ที่ “ขึ้นไปในอวกาศใน” ตรงคำว่า “อวกาศ”", beatId: "beat-1" },
  ])
})

test("a sound the user chose stays, on a beat's edge too; with the sounds off nothing is asked", async () => {
  const { flair, folder, claude, outlines, preview } = await withPoints()
  const edge = (await preview()).slots.find((slot) => slot.anchor.kind === "beat")!
  await flair.setCue(folder, edge.anchor, "s2")
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  await flair.planSounds(folder, request())
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.edited, cue.pointId])).toEqual([
    ["s2", true, undefined],
    ["s1", false, "p-space"],
  ])
  expect((await preview()).cues.map((cue) => cue.effectId).sort()).toEqual(["s1", "s2"])
  const asked = claude.requests.length
  expect(await flair.planSounds(folder, request({ sound: false }))).toEqual({ count: 0, dropped: 0 })
  expect(claude.requests).toHaveLength(asked)
})

test("a graphic the user made theirs keeps Claude off its point, and stays", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  const spec: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, seconds: 2, why: "", idea: "ของฉัน", words: [], html: FRAGMENT }
  const mine = { anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }, spec, edited: true, off: false, pointId: "p-space" }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics: [mine] } }))
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 0, dropped: 1 })
  expect(textOf(claude.requests.at(-1)!.content).split("\n").find((line) => line.startsWith("[1] 0:"))).toContain("(ผู้ใช้ใส่เองแล้ว ห้ามใส่ซ้ำ)")
  expect((await outlines.get(folder))!.flair!.graphics).toEqual([mine])
})

test("an edited graphic of another kind than the app draws is not the user's own: it keeps Claude off nothing, and goes at the next plan as one of Claude's would", async () => {
  const { flair, folder, claude, graphics, outlines } = await withPoints()
  // cards of the old kit the user had edited, as an older app run on this data would leave them: they play nowhere and
  // no row shows them. One is bound to p-space; the other to no point, on the word Claude's graphic for p-count starts at
  const card = { version: "k", box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, seconds: 2, tone: "base", in: "pop", out: "fade", pieces: [{ kind: "number", text: "นับ", from: 3, to: 1, unit: "", atS: 0, untilS: 1 }], why: "" }
  const onPoint = { anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.5), beatId: "beat-1" }, spec: card, edited: true, off: false, pointId: "p-space" } as unknown as GraphicCue
  const onMoment = { anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(22.62), beatId: "beat-1" }, spec: card, edited: true, off: true } as unknown as GraphicCue
  // Claude's sound on the card's moment, made for its point, and the user's own there; and beside the cards, entries that
  // are no graphic at all, as a file edited by hand may hold: null, and one with no place
  const onCard = { anchor: onPoint.anchor, effectId: "s1", edited: false, pointId: "p-space" }
  const myOwn = { anchor: onPoint.anchor, effectId: "s2", edited: true }
  const broken = [null, { spec: card, edited: true, off: false }] as unknown as GraphicCue[]
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics: [broken[0]!, onPoint, broken[1]!, onMoment], cues: [onCard, myOwn] } }))
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }, { ...MOTION, point: 2 }] })
  // both of Claude's answers are taken and written: nothing is thrown away, counted or not
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 2, dropped: 0 })
  // the card gone, Claude's sound on its moment goes with it, edited though the card was; the user's own sound stays
  expect((await outlines.get(folder))!.flair!.cues).toEqual([myOwn])
  // Claude was not told either point is the user's
  expect(textOf(callsWith(claude, MOTION_PLAN_PROMPT.system)[0]!.content)).not.toContain("ผู้ใช้ใส่เอง")
  expect((await graphics()).map((graphic) => [graphic.pointId, graphic.anchor.kind === "speech" && graphic.anchor.sourceUs, graphic.edited, isMotion(graphic.spec) && graphic.spec.html])).toEqual([
    ["p-space", s(18.08), false, FRAGMENT],
    ["p-count", s(22.62), false, FRAGMENT],
  ])
})

test("each point's frame is taken at its first kept moment, only for what the call attaches, and cleared away after", async () => {
  const { flair, folder, claude, lookings } = await withPoints({ videoPath: async (_folder, videoId) => (videoId === CLIP_ID ? "/videos/IMG_9646.MOV" : null) })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  await flair.planGraphics(folder, request({ graphic: true }))
  expect(lookings).toHaveLength(1)
  expect(lookings[0]!.moments).toEqual([{ path: "/videos/IMG_9646.MOV", timesUs: [s(18.08), s(22.62)] }])
  expect(lookings[0]!.over).toBe(true)
  const asked = claude.requests.at(-1)!
  expect(asked.content.filter((entry) => entry.type === "image")).toHaveLength(2)
  expect(textOf(asked.content)).toContain("เฟรมของจุด 1")
})

test("a video whose file cannot be found is planned without its frames, not failed", async () => {
  const { flair, folder, claude } = await withPoints({
    videoPath: async () => {
      throw new Error("the project cannot be read")
    },
  })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  expect(callsWith(claude, MOTION_PLAN_PROMPT.system).at(-1)!.content.filter((entry) => entry.type === "image")).toEqual([])
})

test("the renders start once the graphics are stored, from the jobs the stored outline makes, and a graphic with no job is left out of what the renderer is handed", async () => {
  const job = { spec: {}, canvas: { width: 1080, height: 1920 }, fps: 30 } as unknown as RenderJob
  const renderer = fakeRenderer()
  const seen: number[] = []
  let read: (folder: string) => Promise<StoredOutline | null> = async () => null
  // two of the user's own in force: one with a job, one with none
  const mine = { cue: { anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(19.0), beatId: "beat-1" }, spec: SPEC, edited: true, off: false }, atUs: 1_990_000, durationUs: 1_500_000 }
  const graphicJobs = vi.fn(async (folder: string) => {
    seen.push((await read(folder))?.flair?.graphics?.length ?? 0)
    return { kept: [mine, mine], off: [], jobs: [null, job] }
  })
  const h = await withPoints({ graphics: renderer, graphicJobs })
  read = (folder) => h.outlines.get(folder)
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  await h.flair.planGraphics(h.folder, request({ graphic: true }))
  expect(graphicJobs).toHaveBeenCalledWith(h.folder, DEFAULT_CUT_RULES, request({ graphic: true }).view)
  // built from what the work stored
  expect(seen).toEqual([1])
  expect(renderer.ensure.mock.calls).toEqual([[[job], h.folder]])
})

test("what sits on a point whose words are cut gets no sound, and no sound Claude stores loses its point", async () => {
  // a point on "หนึ่ง" alone, at the end of the countdown's piece: cutting that word leaves the piece playing
  const one: EmphasisPoint = { id: "p-one", anchor: { kind: "speech", videoId: CLIP_ID, from: 10, to: 11, beatId: "beat-1" }, importance: "secondary", type: "number", reason: "หนึ่ง", source: "ai", edited: false }
  const { flair, folder, claude, outlines, service, pieceAt } = await withPoints({}, { points: [POINTS[0]!, one] })
  const countPiece = await pieceAt(s(22.62))
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, zooms: [{ anchor: countPiece.anchor, kind: "punch", edited: false, pointId: "p-one" }] } }))
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [10], keep: false })
  // the piece still plays from where it did, so the punch on it would still land
  expect((await pieceAt(s(22.62))).anchor).toEqual(countPiece.anchor)
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }, { at: 2, sound: 2 }] })
  expect(await flair.planSounds(folder, request())).toEqual({ count: 1, dropped: 1 })
  // only p-space is offered: p-one is not placed, so neither it nor its punch is a place for a sound
  const slots = textOf(claude.requests.at(-1)!.content).split("\n").filter((line) => line.startsWith("["))
  expect(slots).toHaveLength(1)
  expect(slots[0]).toContain("(สำคัญ · สถานที่)")
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.pointId])).toEqual([["s1", "p-space"]])
})

test("what the user sets while Claude thinks is still there when the answer lands, and keeps Claude off its place", async () => {
  const { flair, folder, claude, outlines, preview, pieceAt } = await withPoints()
  const countPiece = await pieceAt(s(22.62))
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [] })
  let release = hold(claude)
  const techniques = flair.planTechniques(folder, request())
  await thinking(claude)
  await flair.setZoom(folder, countPiece.anchor, "drift")
  release()
  await techniques
  // Claude's punch on the same piece gives way to the user's drift
  expect((await outlines.get(folder))!.flair!.zooms!.map((zoom) => [zoom.kind, zoom.edited])).toEqual([["drift", true]])

  const edge = (await preview()).slots.find((slot) => slot.anchor.kind === "beat")!
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  release = hold(claude)
  const sounds = flair.planSounds(folder, request())
  await thinking(claude)
  await flair.setCue(folder, edge.anchor, "s2")
  release()
  await sounds
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.edited])).toEqual([
    ["s2", true],
    ["s1", false],
  ])
  // a drift is no punch: its piece is no place of its own, and p-count, which nothing sits on, is
  const offered = textOf(claude.requests.at(-1)!.content)
  expect(offered).not.toContain("ภาพซูมกระแทก")
  expect(offered).toContain("— นับถอยหลัง (รอง · ตัวเลข/ราคา)")

  const spec: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, seconds: 2, why: "", idea: "ของฉัน", words: [], html: FRAGMENT }
  // on p-space, but not where Claude's graphic for p-space starts: the point, not the moment, keeps Claude off
  const mine = { anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(18.5), beatId: "beat-1" }, spec, edited: true, off: false, pointId: "p-space" }
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }, { ...MOTION, point: 2 }] })
  release = hold(claude)
  const graphics = flair.planGraphics(folder, request({ graphic: true }))
  await thinking(claude)
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [mine] } }))
  release()
  await graphics
  expect((await outlines.get(folder))!.flair!.graphics!.map((graphic) => [graphic.edited, graphic.pointId])).toEqual([
    [true, "p-space"],
    [false, "p-count"],
  ])
})

test("a beat that gets a new id while Claude thinks keeps what Claude put on it: zooms, cutaways, graphics and sounds", async () => {
  /** Runs one work with Claude held until the beat has grown a new id in the same place; answers what is stored after. */
  const grownDuring = async (h: Awaited<ReturnType<typeof withPoints>>, work: () => Promise<unknown>) => {
    const release = hold(h.claude)
    const running = work()
    await thinking(h.claude)
    await h.outlines.update(h.folder, (stored) => ({ ...stored!, outline: { ...stored!.outline, beats: stored!.outline.beats.map((beat) => ({ ...beat, id: `${beat.id}-grown` })) } }))
    release()
    await running
    return (await h.outlines.get(h.folder))!.flair!
  }
  const onSpace = { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1-grown" }

  const techniques = await withPoints()
  techniques.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [{ point: 1, picture: 1 }] })
  const planned = await grownDuring(techniques, () => techniques.flair.planTechniques(techniques.folder, request()))
  expect(planned.zooms!.map((zoom) => [zoom.anchor.beatId, zoom.pointId])).toEqual([["beat-1-grown", "p-count"]])
  expect(planned.inserts!.map((insert) => [insert.anchor, insert.pointId])).toEqual([[onSpace, "p-space"]])

  const graphics = await withPoints()
  graphics.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  const drawn = await grownDuring(graphics, () => graphics.flair.planGraphics(graphics.folder, request({ graphic: true })))
  expect(drawn.graphics!.map((graphic) => [graphic.anchor, graphic.pointId])).toEqual([[onSpace, "p-space"]])

  const sounds = await withPoints()
  sounds.claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  const heard = await grownDuring(sounds, () => sounds.flair.planSounds(sounds.folder, request()))
  expect(heard.cues!.map((cue) => [cue.anchor, cue.pointId])).toEqual([[onSpace, "p-space"]])
})

test("a line of text taken out while Claude chooses sounds takes Claude's sound for it with it", async () => {
  const { flair, folder, claude, outlines, highlights } = await withPoints()
  await highlights.addFromWords(folder, CLIP_ID, [3], 12, "beat-1")
  await outlines.update(folder, (stored) => ({ ...stored!, highlights: { ...stored!.highlights!, groups: stored!.highlights!.groups.map((group) => ({ ...group, pointId: "p-space" })) } }))
  const [group] = (await outlines.get(folder))!.highlights!.groups
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  const release = hold(claude)
  const sounds = flair.planSounds(folder, request())
  await thinking(claude)
  await highlights.removeGroup(folder, group!.id)
  release()
  await sounds
  // Claude was offered the line on p-space, not the point under it
  expect(textOf(claude.requests.at(-1)!.content)).toContain('ข้อความเด่น "อวกาศ" บรรทัด 1')
  expect((await outlines.get(folder))!.flair?.cues ?? []).toEqual([])
})

test("a cutaway set by hand before cutaways knew their beat still keeps Claude off its moment", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  const speech = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(18.08) }
  await flair.setInsert(folder, speech, "m2")
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  await flair.planTechniques(folder, request())
  expect((await outlines.get(folder))!.flair!.inserts!.map((insert) => [insert.binId, insert.edited])).toEqual([["m2", true]])
  // and it comes off by the anchor the same moment has in its beat
  await flair.setInsert(folder, { ...speech, beatId: "beat-1" }, null)
  expect((await outlines.get(folder))!.flair!.inserts).toEqual([])
})

test("a sound set by hand that this machine no longer has does not keep Claude from putting one there", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  // p-space carries nothing, so its first kept moment is the first slot; the user's sound there is one this machine lost
  const place = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, cues: [{ anchor: place, effectId: "not-here", edited: true }] } }))
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  await flair.planSounds(folder, request())
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.edited, cue.pointId])).toEqual([["s1", false, "p-space"]])
})

test("without CapCut Pro Claude is offered only the free sounds, and a sound the user set on one read from a draft stays through a new plan", async () => {
  const free = BUILT_IN_SOUNDS[0]!
  // s1 and s2 stand for sounds read from this machine's drafts, which count as Pro ones
  const { flair, folder, claude, outlines } = await withPoints({ pro: async () => false, sounds: { list: async () => [...SOUNDS, free] } })
  // the user's own on a beat's edge: a sound set by hand is checked against every sound this machine has, so a gated one is taken
  const edge = { kind: "beat" as const, beatId: "beat-1", edge: "start" as const }
  await flair.setCue(folder, edge, "s2")
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  expect(await flair.planSounds(folder, request())).toEqual({ count: 1, dropped: 0 })
  const text = textOf(claude.requests.at(-1)!.content)
  expect(text).toContain(free.use!)
  expect(text).not.toContain("ปัง")
  expect(text).not.toContain("ฟิ้ว")
  // the first sound offered is the free one, and the user's gated one is still theirs
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.edited, cue.pointId])).toEqual([
    ["s2", true, undefined],
    [free.effectId, false, "p-space"],
  ])
})

test("Claude may zoom the same footage in both beats that play it, and a zoom the user sets on one leaves the other to Claude", async () => {
  const twice: Beat[] = [{ ...countdown, id: "hook", name: "เปิด" }, countdown]
  // the countdown's words in each beat
  const inHook: EmphasisPoint = { ...POINTS[1]!, id: "p-count-hook", anchor: { kind: "speech", videoId: CLIP_ID, from: 8, to: 11, beatId: "hook" } }
  const { flair, folder, claude, preview } = await withPoints({}, { beats: twice, points: [inHook, POINTS[1]!] })
  const { pieces } = await preview()
  const later = pieces.find((piece) => piece.beatId === "beat-1" && piece.anchor.sourceUs <= s(22.62) && s(22.62) < piece.anchor.sourceUs + piece.durationUs)!
  const hook = pieces.find((piece) => piece.beatId === "hook" && piece.anchor.sourceUs === later.anchor.sourceUs)!
  // the hook plays first, so its point is [1]
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 1, kind: "punch" }, { point: 2, kind: "drift" }], inserts: [] })
  await flair.planTechniques(folder, request())
  const zooms = async () => (await preview()).zooms.map((zoom) => [zoom.beatId, zoom.kind, zoom.edited])
  expect(await zooms()).toEqual([
    ["hook", "punch", false],
    ["beat-1", "drift", false],
  ])
  await flair.setZoom(folder, hook.anchor, "drift")
  await flair.planTechniques(folder, request())
  expect(await zooms()).toEqual([
    ["hook", "drift", true],
    ["beat-1", "drift", false],
  ])
})

test("a scene point takes a cutaway at its first kept moment, and is shown for graphics as its picture with the scene's keepClear", async () => {
  // a point on the scene from 23 s of the source on, inside the countdown's piece; it is a scene point by its anchor
  const sky: EmphasisPoint = { id: "p-sky", anchor: { kind: "scene", videoId: CLIP_ID, startUs: s(23.0), endUs: s(25.0), beatId: "beat-1" }, importance: "extra", type: "visual", reason: "ฟ้าสวย", source: "ai", edited: false }
  const scenes: Scene[] = [{ startUs: s(23.0), endUs: s(31), description: "จรวดบนฟ้า", kind: "b-roll", issues: [], keepClear: { fromY: 0.5, toY: 0.75 } }]
  const { flair, folder, claude, outlines } = await withPoints({}, { points: [...POINTS, sky], scenes })
  const atSky = { kind: "speech", videoId: CLIP_ID, sourceUs: s(23.0), beatId: "beat-1" }
  // in playing order it is the third point
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 3, picture: 1 }] })
  await flair.planTechniques(folder, request())
  expect(textOf(claude.requests.at(-1)!.content)).toContain("(เสริม · ภาพสวย) ภาพ: จรวดบนฟ้า — ฟ้าสวย")
  expect((await outlines.get(folder))!.flair!.inserts).toMatchObject([{ anchor: atSky, binId: "m1", pointId: "p-sky" }])

  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 3, box: [0.1, 0.1, 0.9, 0.25] }] })
  // planned and stored; its point is of the least importance, which the middle level hides, so it is not written yet
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 0, dropped: 0 })
  const lines = textOf(claude.requests.at(-1)!.content).split("\n")
  const at = lines.findIndex((line) => line.startsWith("[3] "))
  expect(lines[at]).toContain("(เสริม · ภาพสวย) ภาพ: จรวดบนฟ้า — ฟ้าสวย")
  expect(lines[at + 1]).toBe("    ฉาก: b-roll · จรวดบนฟ้า · keepClear [0.5, 0.75]")
  expect((await outlines.get(folder))!.flair!.graphics).toMatchObject([{ anchor: atSky, pointId: "p-sky" }])
})

test("a rough cut with no frame size to draw on skips the graphics, and Claude is not asked", async () => {
  const h = await withPoints()
  const blind = createFlairService({
    outlines: h.outlines,
    timeline: { ...h.service, compiled: async (...args: Parameters<typeof h.service.compiled>) => ({ ...(await h.service.compiled(...args)), canvas: null }) },
    llm: h.claude.llm,
    pro: async () => (await h.deps.settings.read()).capcut.pro,
  })
  const asked = h.claude.requests.length
  expect(await blind.planGraphics(h.folder, request({ graphic: true }))).toEqual({ count: 0, dropped: 0, skipped: "no-canvas" })
  expect(h.claude.requests).toHaveLength(asked)
})

/* ported from flair.test.ts: cases of the old plan the new works keep, which the map above does not name */

test("a picture replaced while Claude looks at it keeps no description it was not given", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-looks-"))
  const photo = join(dir, "nail.jpg")
  await writeFile(photo, "a red mug")
  const cache = new MediaCache<MediaLook, { prompt: string; model: string }>(join(dir, "looks"))
  const h = await withPoints()
  const inner = (await h.claude.llm()).transport
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(asked: LlmRequest<T>): Promise<LlmResponse<T>> {
      // the photo is swapped for another while Claude is looking at the old one
      if (asked.system === MEDIA_PROMPT.system) await writeFile(photo, "a blue bowl, a different picture")
      return inner.generate(asked)
    },
  }
  const flair = createFlairService({
    outlines: h.outlines,
    timeline: h.service,
    llm: async () => ({ transport, model: "claude-sonnet-5" }),
    media: { list: async () => [{ ...PICTURES[0]!, path: photo }] },
    descriptions: cache,
    frames: () => ({ of: async () => [photo], dispose: async () => {} }),
    pro: async () => (await h.deps.settings.read()).capcut.pro,
  })
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  await flair.planTechniques(h.folder, request())
  // Claude did look at it, but what it said was about a picture that is not there any more
  expect(h.claude.requests.some((asked) => asked.system === MEDIA_PROMPT.system)).toBe(true)
  expect(await cache.get(photo, { prompt: MEDIA_PROMPT.version, model: "claude-sonnet-5" })).toBeNull()
})

test("with subtitles on, Claude is told where their room starts: where the highlight text stays above them", async () => {
  const { flair, folder, claude } = await withPoints()
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  const drawn = request({ graphic: true })
  await flair.planGraphics(folder, { ...drawn, view: { ...drawn.view, subtitlesOn: true } })
  expect(textOf(claude.requests.at(-1)!.content)).toContain("ซับเริ่มที่ y = 0.76")
  await flair.planGraphics(folder, drawn)
  expect(textOf(claude.requests.at(-1)!.content)).toContain("ไม่มีซับ")
})

test("Claude is told where each point's own text is drawn, laid out with the look the text has, and of no text that is not the point's", async () => {
  const { flair, folder, claude, highlights } = await withPoints()
  // text on "อวกาศ" made for p-space, the point on that word
  await highlights.addFromWords(folder, CLIP_ID, [3], 12, "beat-1", "p-space")
  const [group] = (await highlights.preview(folder, DEFAULT_CUT_RULES, request().view)).groups
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  /** The line of a point in the request the graphics are planned with. */
  const lineOf = async (point: number) => {
    await flair.planGraphics(folder, request({ graphic: true }))
    return textOf(claude.requests.at(-1)!.content)
      .split("\n")
      .find((line) => line.startsWith(`[${point}] `))!
  }
  const band = async () => /ข้อความเด่นของจุดนี้ \[([\d.]+), ([\d.]+)\]/.exec(await lineOf(1))!.slice(1).map(Number)
  await flair.setLook(folder, group!.id, { pattern: "bar" })
  const bar = await band()
  await flair.setLook(folder, group!.id, { pattern: "stack" })
  // a bar is drawn in a box of its own, so the text sits elsewhere on the frame
  const stack = await band()
  expect(stack).not.toEqual(bar)
  // the countdown's point has no text of its own
  expect(await lineOf(2)).not.toContain("ข้อความเด่น")
  // the user's own text on the countdown, bound to no point, is not the point's: a graphic there would not take its place
  await highlights.addFromWords(folder, CLIP_ID, [8], 12, "beat-1")
  expect(await lineOf(2)).not.toContain("ข้อความเด่น")
  // text made for the countdown's point is told on its line, and leaves what p-space is told of its own as it was
  await highlights.addFromWords(folder, CLIP_ID, [9], 12, "beat-1", "p-count")
  expect(await lineOf(2)).toMatch(/\(ข้อความเด่นของจุดนี้ \[[\d.]+, [\d.]+\]/)
  expect(await band()).toEqual(stack)
})

test("zooms, cutaways, graphics and sounds leave the looks of the text as they are stored", async () => {
  const { flair, folder, claude, highlights, outlines } = await withPoints()
  await highlights.addFromWords(folder, CLIP_ID, [3], 12, "beat-1")
  const [group] = (await highlights.preview(folder, DEFAULT_CUT_RULES, request().view)).groups
  await flair.setLook(folder, group!.id, { pattern: "bar", tone: "alt" })
  const looks = (await outlines.get(folder))!.flair!.looks
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 1, kind: "punch" }], inserts: [{ point: 1, picture: 1 }] })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 2 }] })
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  expect(await flair.planTechniques(folder, request({ graphic: true }))).toEqual({ count: 2, dropped: 0 })
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  expect(await flair.planSounds(folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  expect((await outlines.get(folder))!.flair!.looks).toEqual(looks)
})

test("a sound the user put where a point starts keeps Claude's off that place", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  // p-space carries nothing, so its first kept moment is the first slot Claude is offered
  await flair.setCue(folder, { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }, "s2")
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  await flair.planSounds(folder, request())
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.edited, cue.pointId])).toEqual([["s2", true, undefined]])
})

test("a graphic of the user's, bound to no point, set while Claude draws at the moment Claude's lands, keeps Claude's off that moment", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  const spec: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, seconds: 2, why: "", idea: "ของฉัน", words: [], html: FRAGMENT }
  // no pointId: only its moment, p-space's first word, says where it is
  const mine = { anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }, spec, edited: true, off: false }
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  const release = hold(claude)
  const drawing = flair.planGraphics(folder, request({ graphic: true }))
  await thinking(claude)
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...(stored!.flair ?? { looks: {} }), graphics: [mine] } }))
  release()
  await drawing
  expect((await outlines.get(folder))!.flair!.graphics).toEqual([mine])
})

test("a machine with no sounds is not asked about them", async () => {
  const h = await withPoints()
  const quiet = createFlairService({ outlines: h.outlines, timeline: h.service, llm: h.claude.llm, sounds: { list: async () => [] }, pro: async () => (await h.deps.settings.read()).capcut.pro })
  const asked = h.claude.requests.length
  expect(await quiet.planSounds(h.folder, request())).toEqual({ count: 0, dropped: 0 })
  expect(h.claude.requests).toHaveLength(asked)
})

test("Stop pressed while Claude draws the graphics saves nothing, and the frames are cleared away", async () => {
  const { flair, folder, claude, outlines, lookings } = await withPoints({ videoPath: async () => "/videos/IMG_9646.MOV" })
  claude.state.fail = new Error("cancelled")
  const before = await outlines.get(folder)
  await expect(flair.planGraphics(folder, request({ graphic: true }))).rejects.toThrow(/^cancelled$/)
  expect(await outlines.get(folder)).toEqual(before)
  expect(lookings.map((looking) => looking.over)).toEqual([true])
})

/* fix round: points deleted mid-call, the run's stop, sounds on items that go, nothing offered */

test("a point deleted while Claude thinks takes what Claude put on it with it: no zoom, cutaway, graphic or sound is left on it", async () => {
  /** Runs one work with Claude held until p-count is deleted, as the emphasis tab deletes a point; answers what is stored after. */
  const deletedDuring = async (h: Awaited<ReturnType<typeof withPoints>>, work: () => Promise<unknown>) => {
    const release = hold(h.claude)
    const running = work()
    await thinking(h.claude)
    await h.outlines.update(h.folder, (stored) => withoutPoint(stored!, "p-count"))
    release()
    await running
    return (await h.outlines.get(h.folder))!.flair!
  }
  const techniques = await withPoints()
  techniques.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [{ point: 1, picture: 1 }, { point: 2, picture: 2 }] })
  const planned = await deletedDuring(techniques, () => techniques.flair.planTechniques(techniques.folder, request()))
  expect(planned.zooms).toEqual([])
  expect(planned.inserts!.map((insert) => insert.pointId)).toEqual(["p-space"])

  const graphics = await withPoints()
  graphics.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }, { ...MOTION, point: 2 }] })
  const drawn = await deletedDuring(graphics, () => graphics.flair.planGraphics(graphics.folder, request({ graphic: true })))
  expect(drawn.graphics!.map((graphic) => graphic.pointId)).toEqual(["p-space"])

  // p-space and p-count each carry nothing: each is a place of its own
  const sounds = await withPoints()
  sounds.claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }, { at: 2, sound: 2 }] })
  const heard = await deletedDuring(sounds, () => sounds.flair.planSounds(sounds.folder, request()))
  expect(heard.cues!.map((cue) => cue.pointId)).toEqual(["p-space"])
})

test("Claude's item on a point that is gone is not kept waiting for it", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  // left behind on a point no longer stored
  const stale = { anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(19.0), beatId: "beat-1" }, binId: "m2", edited: false, fit: "card" as const, subject: null, pointId: "gone" }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, inserts: [stale] } }))
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  await flair.planTechniques(folder, request())
  expect((await outlines.get(folder))!.flair!.inserts).toEqual([])
})

test("every Claude call of a work carries the run's stop, and a stop pressed before the work reached Claude stops it there, storing nothing", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  const running = new AbortController()
  claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  claude.replies.set(SOUNDS_PROMPT.system, { cues: [] })
  await flair.planTechniques(folder, request(), running.signal)
  await flair.planGraphics(folder, request({ graphic: true }), running.signal)
  await flair.planSounds(folder, request(), running.signal)
  // the pictures' look, the zooms and cutaways, the graphics' plan and the writing of the one planned, and the sounds
  expect(claude.requests.map((asked) => asked.system)).toEqual([MEDIA_PROMPT.system, TECHNIQUES_PROMPT.system, MOTION_PLAN_PROMPT.system, MOTION_CONTRACT, SOUNDS_PROMPT.system])
  expect(claude.requests.every((asked) => asked.signal === running.signal)).toBe(true)
  // the run's stop was pressed while the work was still reading the cut: its call ends as a stop
  const stopped = new AbortController()
  stopped.abort(new Error(CANCELLED))
  const before = await outlines.get(folder)
  await expect(flair.planTechniques(folder, request(), stopped.signal)).rejects.toThrow(/^cancelled$/)
  await expect(flair.planGraphics(folder, request({ graphic: true }), stopped.signal)).rejects.toThrow(/^cancelled$/)
  await expect(flair.planSounds(folder, request(), stopped.signal)).rejects.toThrow(/^cancelled$/)
  expect(await outlines.get(folder)).toEqual(before)
})

const SPEC: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, seconds: 2, why: "", idea: "ตัวเลขนับถอยหลัง 3 2 1", words: [], html: FRAGMENT }

/**
 * Claude's punch on the countdown's piece, cutaways on p-space's first word and on "สอง" for p-count, and a
 * graphic on p-count's first word, each with Claude's sound on its moment (a punch with no text in its piece
 * lands on the piece's start); the user's own sound, for p-space, on the first cutaway's moment; and the user's own cutaway
 * on "ใน", with a sound of Claude's on it.
 */
async function withItemSounds() {
  const h = await withPoints()
  const countPiece = await h.pieceAt(s(22.62))
  const atSpace = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }
  const atPunch = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: countPiece.anchor.sourceUs, beatId: "beat-1" }
  const atGraphic = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(22.62), beatId: "beat-1" }
  const atOther = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(23.88), beatId: "beat-1" }
  const atMine = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(19.0), beatId: "beat-1" }
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    flair: {
      looks: {},
      zooms: [{ anchor: countPiece.anchor, kind: "punch", edited: false, pointId: "p-count" }],
      inserts: [
        { anchor: atSpace, binId: "m1", edited: false, fit: "card", subject: null, pointId: "p-space" },
        { anchor: atOther, binId: "m2", edited: false, fit: "card", subject: null, pointId: "p-count" },
        { anchor: atMine, binId: "m2", edited: true, fit: "card", subject: null },
      ],
      graphics: [{ anchor: atGraphic, spec: SPEC, edited: false, off: false, pointId: "p-count" }],
      cues: [
        { anchor: atPunch, effectId: "s2", edited: false, pointId: "p-count" },
        { anchor: atSpace, effectId: "s1", edited: false, pointId: "p-space" },
        { anchor: atGraphic, effectId: "s1", edited: false, pointId: "p-count" },
        // the user's own, made for p-space: it stays whatever goes
        { anchor: atSpace, effectId: "s2", edited: true, pointId: "p-space" },
        { anchor: atOther, effectId: "s2", edited: false, pointId: "p-count" },
        { anchor: atMine, effectId: "s2", edited: false },
      ],
    },
  }))
  const cues = async () => (await h.outlines.get(h.folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.anchor.kind === "speech" ? cue.anchor.sourceUs : null, cue.edited])
  return { ...h, countPiece, atSpace, atPunch, atGraphic, atMine, cues }
}

test("Claude's sounds on its punch, cutaway or graphic that a new plan replaces go with them; the user's own stay, and so does one on a moment a new item holds", async () => {
  const h = await withItemSounds()
  // no zoom this time, the same cutaway on p-space again and none for p-count: the punch's sound and the
  // p-count cutaway's go, p-space's cutaway moment still holds one
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  await h.flair.planTechniques(h.folder, request())
  expect(await h.cues()).toEqual([
    ["s1", s(18.08), false],
    ["s1", s(22.62), false],
    ["s2", s(18.08), true],
    ["s2", s(19.0), false],
  ])
  // no graphic this time: its sound goes with it
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  await h.flair.planGraphics(h.folder, request({ graphic: true }))
  expect(await h.cues()).toEqual([
    ["s1", s(18.08), false],
    ["s2", s(18.08), true],
    ["s2", s(19.0), false],
  ])
})

test("Claude's sounds on its punch, cutaway or graphic the user takes off go with it; the user's own stay", async () => {
  const h = await withItemSounds()
  await h.flair.setZoom(h.folder, h.countPiece.anchor, null)
  expect(await h.cues()).toEqual([
    ["s1", s(18.08), false],
    ["s1", s(22.62), false],
    ["s2", s(18.08), true],
    ["s2", s(23.88), false],
    ["s2", s(19.0), false],
  ])
  await h.flair.setInsert(h.folder, h.atSpace, null)
  await h.flair.setGraphic(h.folder, h.atGraphic, null)
  // the user's own cutaway taken off leaves the sound on its moment: only Claude's items take theirs along
  await h.flair.setInsert(h.folder, h.atMine, null)
  expect(await h.cues()).toEqual([
    ["s2", s(18.08), true],
    ["s2", s(23.88), false],
    ["s2", s(19.0), false],
  ])
})

test("an item of Claude's that goes takes only its own point's sounds on its moment: another point's sound there stays", async () => {
  const h = await withPoints()
  const at = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(23.88), beatId: "beat-1" }
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    flair: {
      looks: {},
      inserts: [{ anchor: at, binId: "m1", edited: false, fit: "card", subject: null, pointId: "p-count" }],
      cues: [
        { anchor: at, effectId: "s1", edited: false, pointId: "p-count" },
        // a sound Claude put on another point's place, which happens to be the same moment
        { anchor: at, effectId: "s2", edited: false, pointId: "p-space" },
      ],
    },
  }))
  await h.flair.setInsert(h.folder, at, null)
  expect((await h.outlines.get(h.folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.pointId])).toEqual([["s2", "p-space"]])
})

test("with the cutaways on but no picture to offer, Claude's cutaways stay as stored; with the zooms on but no piece long enough, its zooms do", async () => {
  const h = await withPoints()
  const countPiece = await h.pieceAt(s(22.62))
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [{ point: 1, picture: 1 }] })
  await h.flair.planTechniques(h.folder, request())
  const planned = (await h.outlines.get(h.folder))!.flair!
  expect([planned.zooms!.length, planned.inserts!.length]).toEqual([1, 1])
  // the pieces are still offered, and Claude answers the same punch; no picture is offered
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [{ point: 2, kind: "punch" }], inserts: [] })
  // the project's spare pictures are gone: nothing is offered, so nothing is replaced
  const noPictures = createFlairService({ outlines: h.outlines, timeline: h.service, llm: h.claude.llm, media: { list: async () => [] }, pro: async () => (await h.deps.settings.read()).capcut.pro })
  await noPictures.planTechniques(h.folder, request())
  expect((await h.outlines.get(h.folder))!.flair!.inserts).toEqual(planned.inserts)
  // a cut whose pieces are all too short to zoom (and p-space's word cut from them): no piece is offered
  const shortCut = createFlairService({
    outlines: h.outlines,
    timeline: {
      ...h.service,
      compiled: async (...args: Parameters<typeof h.service.compiled>) => {
        const compiled = await h.service.compiled(...args)
        const plan = compiled.plan
        const short = {
          ...plan,
          cuts: plan.cuts.map((cut) => ({ ...cut, sourceDurationUs: 1_000_000 })),
          beats: plan.beats.map((beat) => ({ ...beat, pieces: beat.pieces.map((piece) => ({ ...piece, endUs: piece.startUs + 1_000_000 })) })),
        }
        return { ...compiled, plan: short }
      },
    },
    llm: h.claude.llm,
    media: { list: async () => PICTURES },
    pro: async () => (await h.deps.settings.read()).capcut.pro,
  })
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [] })
  const asked = h.claude.requests.length
  await shortCut.planTechniques(h.folder, request())
  // Claude was asked about the pictures, with no piece to zoom
  expect(textOf(h.claude.requests.at(-1)!.content)).toContain("ไม่มีชิ้นให้ซูม")
  expect(h.claude.requests.length).toBeGreaterThan(asked)
  expect((await h.outlines.get(h.folder))!.flair!.zooms).toEqual([{ anchor: countPiece.anchor, kind: "punch", edited: false, pointId: "p-count" }])
})

test("a punch that lands on a line of text shares that line's place: Claude's sound there is the line's, and at the loudest level it plays with the punch", async () => {
  // Known limit: a punch landing on a line of a less important point is silent below the loudest level. The
  // level hides the line and the sound on it waits with it, while the punch lands on the first line the level
  // shows, or at its piece's start, where no sound was planned.
  // p-count, key, on "สามสอง"; p-one, secondary, on the "หนึ่ง" after it, in the same piece
  const points: EmphasisPoint[] = [
    POINTS[0]!,
    { ...POINTS[1]!, importance: "key", anchor: { kind: "speech", videoId: CLIP_ID, from: 8, to: 10, beatId: "beat-1" } },
    { id: "p-one", anchor: { kind: "speech", videoId: CLIP_ID, from: 10, to: 11, beatId: "beat-1" }, importance: "secondary", type: "number", reason: "หนึ่ง", source: "ai", edited: false },
  ]
  const h = await withPoints({}, { points })
  // text on p-one alone: the first line in the countdown's piece, where a punch on that piece lands
  await h.highlights.addFromWords(h.folder, CLIP_ID, [10], 12, "beat-1")
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, highlights: { ...stored!.highlights!, groups: stored!.highlights!.groups.map((group) => ({ ...group, pointId: "p-one" })) } }))
  const [group] = (await h.outlines.get(h.folder))!.highlights!.groups
  const countPiece = await h.pieceAt(s(22.62))
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, zooms: [{ anchor: countPiece.anchor, kind: "punch", edited: false, pointId: "p-count" }] } }))
  h.claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 2, sound: 1 }] })
  await h.flair.planSounds(h.folder, request())
  // p-space, which carries nothing, and p-one's line: the punch lands on that line's moment, whose place is the line's
  const text = textOf(h.claude.requests.at(-1)!.content)
  const slots = text.split("\n").filter((line) => line.startsWith("["))
  expect(slots).toHaveLength(2)
  expect(slots[1]).toContain('ข้อความเด่น "หนึ่ง" บรรทัด 1 (รอง · ตัวเลข/ราคา)')
  expect(text).not.toContain("ภาพซูมกระแทก")
  expect((await h.outlines.get(h.folder))!.flair!.cues).toEqual([{ anchor: { kind: "highlight", groupId: group!.id, line: 0 }, effectId: "s1", edited: false, pointId: "p-one" }])
  // at the loudest level the line shows: the punch lands on it, and its sound plays with the punch
  const heavy = { position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair: { ...FLAIR, level: "heavy" as const } }
  const preview = await h.highlights.preview(h.folder, DEFAULT_CUT_RULES, heavy)
  await h.service.write(h.folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: preview.groups.length, flair: heavy.flair })
  const info = await readInfo(h.folder)
  const [piece] = info.tracks[0]!.segments.filter((segment) => (segment.common_keyframes ?? []).length > 0)
  // the punch starts to rise from the last keyframe still at full size
  // keyframes are timed in the piece's source file: less its source start, the offset is time into the piece
  const offset = piece!.common_keyframes!.find((entry) => entry.property_type === "KFTypeScaleX")!.keyframe_list.findLast((entry) => entry.values[0] === 1)!.time_offset - piece!.source_timerange!.start
  const [sound] = info.tracks.find((track) => track.type === "audio")!.segments
  expect(offset).toBeGreaterThan(0)
  expect(Math.abs(piece!.target_timerange.start + offset - sound!.target_timerange.start)).toBeLessThan(33_334)
})

test("Claude's sound on a place no point is on, the user's own graphic, is kept bound to no point", async () => {
  // the user's graphic on "ใน", bound to no point, as the graphics in force hand it on
  const mine = { anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(19.0), beatId: "beat-1" }, spec: SPEC, edited: true, off: false }
  let atUs = 0
  const h = await withPoints({ graphicJobs: async () => ({ kept: [{ cue: mine, atUs, durationUs: 2_000_000 }], off: [], jobs: [] }) })
  // "ใน" plays 0.92 s after p-space's first word, in the same piece
  atUs = (await h.preview()).emphasis.points[0]!.atUs + 920_000
  h.claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 2, sound: 1 }] })
  await h.flair.planSounds(h.folder, request({ graphic: true }))
  expect(textOf(h.claude.requests.at(-1)!.content).split("\n").find((line) => line.startsWith("[2] "))).toContain("กราฟิกขึ้น: ตัวเลขนับถอยหลัง 3 2 1 (ไม่มีจุดเน้น)")
  expect((await h.outlines.get(h.folder))!.flair!.cues).toEqual([{ anchor: mine.anchor, effectId: "s1", edited: false }])
})

test("a cutaway whose moment the cut took out is offered for a sound where it plays, at its point's start, and Claude's sound plays with it", async () => {
  // "ขึ้นไปในอวกาศ": Claude's cutaway on its start, "ขึ้น", which the user then cuts
  const h = await withPoints({}, { points: [{ ...POINTS[0]!, anchor: { kind: "speech", videoId: CLIP_ID, from: 0, to: 4, beatId: "beat-1" } }] })
  const start = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(17.16), beatId: "beat-1" }
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { looks: {}, inserts: [{ anchor: start, binId: "m1", edited: false, fit: "cover", subject: null, pointId: "p-space" }] } }))
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [0], keep: false })
  h.claude.replies.set(SOUNDS_PROMPT.system, { cues: [{ at: 1, sound: 1 }] })
  await h.flair.planSounds(h.folder, request())
  const slots = textOf(h.claude.requests.at(-1)!.content).split("\n").filter((line) => line.startsWith("["))
  expect(slots).toHaveLength(1)
  expect(slots[0]).toContain("ภาพตัดไปรูป IMG_1.JPG (สำคัญ · สถานที่)")
  const shown = await h.preview()
  expect(shown.inserts.map((insert) => [insert.anchor, insert.atUs])).toEqual([[start, shown.emphasis.points[0]!.atUs]])
  expect(shown.cues.map((cue) => [cue.anchor, cue.atUs, cue.pointId])).toEqual([[start, shown.emphasis.points[0]!.atUs, "p-space"]])
})

/* a picture put on a point by hand (the emphasis tab's "รูป") */

// "ขึ้นไป", in the same sentence as p-space's "อวกาศ": a point of the user's
const UP: EmphasisPoint = { id: "p-up", anchor: { kind: "speech", videoId: CLIP_ID, from: 0, to: 2, beatId: "beat-1" }, importance: "key", type: "action", reason: "", source: "user", edited: false }
const moment = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
/** The stored cutaways as [picture, where, point, edited, fit]. */
const cutaways = async (h: Awaited<ReturnType<typeof withPoints>>) =>
  ((await h.outlines.get(h.folder))!.flair?.inserts ?? []).map((insert) => [insert.binId, insert.anchor.kind === "speech" ? insert.anchor.sourceUs : null, insert.pointId, insert.edited, insert.fit])

test("a picture put on a point by hand is the point's own: it starts where the point does, bound to it; another point's cutaway in the sentence is left alone, and taking it off takes only that one", async () => {
  const h = await withPoints({}, { points: [...POINTS, UP] })
  // Claude's cutaway on อวกาศ, in the sentence ขึ้นไป starts
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { looks: {}, inserts: [{ anchor: moment(s(18.08)), binId: "m1", edited: false, fit: "card", subject: null, pointId: "p-space" }] } }))
  // ขึ้นไป has no picture yet: taking its picture off changes nothing
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-up", null)
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", false, "card"]])
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-up", "m2", "cover")
  expect(await cutaways(h)).toEqual([
    ["m1", s(18.08), "p-space", false, "card"],
    ["m2", s(17.16), "p-up", true, "cover"],
  ])
  // it plays on its point, which counts it
  expect((await h.preview()).emphasis.points.map((point) => [point.id, point.items.insert])).toEqual([
    ["p-up", 1],
    ["p-space", 1],
    ["p-count", 0],
  ])
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-up", null)
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", false, "card"]])
})

test("a picture picked for a point Claude cut away on replaces Claude's where it is and keeps its point; a second pick replaces it again, and Claude thinking again leaves it alone", async () => {
  const h = await withPoints()
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  await h.flair.planTechniques(h.folder, request())
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", false, "card"]])
  // the same picture keeps how Claude's was framed, and becomes the user's
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m1")
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", true, "card"]])
  // another picture replaces it where it is, framed as that picture was looked at (the clip was not), or as the user says
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m2")
  expect(await cutaways(h)).toEqual([["m2", s(18.08), "p-space", true, "cover"]])
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m1", "cover")
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", true, "cover"]])
  // picked again, it keeps the framing the user gave it, not the one the picture was looked at in
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m1")
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", true, "cover"]])
  // Claude answers the same point again: the user's picture holds the point's moment
  await h.flair.planTechniques(h.folder, request())
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", true, "cover"]])
  const shown = await h.preview()
  expect(shown.inserts.map((insert) => [insert.binId, insert.pointId])).toEqual([["m1", "p-space"]])
  expect(shown.emphasis.points.find((point) => point.id === "p-space")!.items.insert).toBe(1)
})

/** What plays of the cutaways, in playing order, as [picture, where, point]. */
const playing = async (h: Awaited<ReturnType<typeof withPoints>>) =>
  (await h.preview()).inserts.map((insert) => [insert.binId, insert.anchor.kind === "speech" ? insert.anchor.sourceUs : null, insert.pointId])

test("a point's picture goes where the point starts now: one that sits elsewhere is moved there when picked; a point off the cut keeps its cutaway where it is", async () => {
  const h = await withPoints()
  // on the second word of สามสองหนึ่ง, where the cut once started the point; and one on อวกาศ, which is cut below
  const onSpace = { anchor: moment(s(18.08)), binId: "m1", edited: true, fit: "card" as const, subject: null, pointId: "p-space" }
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    flair: { looks: {}, inserts: [{ anchor: moment(s(23.88)), binId: "m1", edited: false, fit: "card", subject: null, pointId: "p-count" }, onSpace] },
  }))
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-count", "m2")
  expect(await cutaways(h)).toEqual([
    ["m2", s(22.62), "p-count", true, "cover"],
    ["m1", s(18.08), "p-space", true, "card"],
  ])
  expect(await playing(h)).toEqual([
    ["m1", s(18.08), "p-space"],
    ["m2", s(22.62), "p-count"],
  ])
  // อวกาศ cut: p-space is on the cut no more, and its picture stays where it was, for when the word comes back
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [3], keep: false })
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m2")
  expect((await cutaways(h))[1]).toEqual(["m2", s(18.08), "p-space", true, "cover"])
})

test("after the cut moves a point's start, thinking the cutaways again puts the user's picture back on it: one cutaway on the point, the user's, playing at the new start", async () => {
  const h = await withPoints()
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-count", "m2")
  expect(await playing(h)).toEqual([["m2", s(22.62), "p-count"]])
  // สาม is cut: สามสองหนึ่ง now starts at สอง, and the picture, still stored on สาม's moment, plays there, where its point starts
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [8], keep: false })
  const moved = await h.preview()
  expect(moved.inserts.map((insert) => [insert.binId, insert.anchor.kind === "speech" ? insert.anchor.sourceUs : null, insert.atUs])).toEqual([["m2", s(22.62), moved.emphasis.points[1]!.atUs]])
  // Claude answers both points: the other point's lands, and the user's picture goes back on its point
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }, { point: 2, picture: 1 }] })
  await h.flair.planTechniques(h.folder, request())
  expect(await cutaways(h)).toEqual([
    ["m2", s(23.88), "p-count", true, "cover"],
    ["m1", s(18.08), "p-space", false, "card"],
  ])
  expect(await playing(h)).toEqual([
    ["m1", s(18.08), "p-space"],
    ["m2", s(23.88), "p-count"],
  ])
})

test("after the user moves a point's phrase, thinking the cutaways again puts the user's picture on the new phrase's start", async () => {
  const h = await withPoints()
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m2")
  // the phrase moved to ขึ้นไป, as the emphasis tab moves it
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    emphasis: { ...stored!.emphasis!, points: stored!.emphasis!.points.map((point) => (point.id === "p-space" ? { ...point, anchor: { ...point.anchor, from: 0, to: 2 }, edited: true } : point)) },
  }))
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  await h.flair.planTechniques(h.folder, request())
  expect(await cutaways(h)).toEqual([["m2", s(17.16), "p-space", true, "cover"]])
  expect(await playing(h)).toEqual([["m2", s(17.16), "p-space"]])
})

test("a point planned over leaves its picture unbound; picking for the new point on the same words takes that picture over rather than stacking a second", async () => {
  const h = await withPoints()
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m2")
  // Claude plans the points again: p-space goes, the user's picture stays bound to nothing, and a new point stands on อวกาศ
  const again: EmphasisPoint = { ...POINTS[0]!, id: "p-new" }
  await h.outlines.update(h.folder, (stored) => {
    const next = withoutPoint(stored!, "p-space")
    return { ...next, emphasis: { ...next.emphasis!, points: [again, ...next.emphasis!.points] } }
  })
  expect(await cutaways(h)).toEqual([["m2", s(18.08), undefined, true, "cover"]])
  // and one of the user's own elsewhere, on "ใน", which is not the new point's to take
  const elsewhere = { anchor: moment(s(19.0)), binId: "m2", edited: true, fit: "card" as const, subject: null }
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, inserts: [elsewhere, ...stored!.flair!.inserts!] } }))
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-new", "m1")
  expect(await cutaways(h)).toEqual([
    ["m2", s(19.0), undefined, true, "card"],
    ["m1", s(18.08), "p-new", true, "cover"],
  ])
  expect(await playing(h)).toEqual([
    ["m1", s(18.08), "p-new"],
    ["m2", s(19.0), undefined],
  ])
})

test("another point's picture where a point starts is not that point's to take over: the point gets one of its own", async () => {
  const h = await withPoints({}, { points: [...POINTS, UP] })
  // p-space's picture, left on ขึ้นไป where its phrase once was, until the cutaways are thought again
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    flair: { looks: {}, inserts: [{ anchor: moment(s(17.16)), binId: "m2", edited: true, fit: "cover", subject: null, pointId: "p-space" }] },
  }))
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-up", "m1")
  expect(await cutaways(h)).toEqual([
    ["m2", s(17.16), "p-space", true, "cover"],
    ["m1", s(17.16), "p-up", true, "cover"],
  ])
})

test("a picture the user picked for a point stays on it when the beat got a new id while Claude thought, and keeps Claude's off it", async () => {
  const h = await withPoints()
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m2")
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  const release = hold(h.claude)
  const planning = h.flair.planTechniques(h.folder, request())
  await thinking(h.claude)
  // a part added to the beat gives it a new id, which the outline's items follow, the user's picture among them
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    outline: { ...stored!.outline, beats: stored!.outline.beats.map((beat) => ({ ...beat, id: `${beat.id}-grown` })) },
    flair: { ...stored!.flair!, inserts: stored!.flair!.inserts!.map((insert) => ({ ...insert, anchor: { ...insert.anchor, beatId: "beat-1-grown" } as typeof insert.anchor })) },
  }))
  release()
  await planning
  expect((await h.outlines.get(h.folder))!.flair!.inserts!.map((insert) => [insert.binId, insert.anchor, insert.pointId, insert.edited])).toEqual([
    ["m2", { ...moment(s(18.08)), beatId: "beat-1-grown" }, "p-space", true],
  ])
})

test("Claude's cutaway taken off its point takes Claude's sound on its moment with it; the user's own taken off leaves the sound", async () => {
  const h = await withPoints()
  const sound = { anchor: moment(s(18.08)), effectId: "s1", edited: false, pointId: "p-space" }
  const claudes = { anchor: moment(s(18.08)), binId: "m1", edited: false, fit: "card" as const, subject: null, pointId: "p-space" }
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { looks: {}, inserts: [claudes], cues: [sound] } }))
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", null)
  expect((await h.outlines.get(h.folder))!.flair).toMatchObject({ inserts: [], cues: [] })
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { looks: {}, inserts: [{ ...claudes, edited: true }], cues: [sound] } }))
  await h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", null)
  expect((await h.outlines.get(h.folder))!.flair).toMatchObject({ inserts: [], cues: [sound] })
})

test("a picture is refused for a point that is not stored, and a picture the project does not have is refused", async () => {
  const h = await withPoints()
  await expect(h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-nope", "m1")).rejects.toThrow(/no point p-nope/)
  await expect(h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-nope", null)).rejects.toThrow(/no point p-nope/)
  await expect(h.flair.setPointPicture(h.folder, DEFAULT_CUT_RULES, "p-space", "m9")).rejects.toThrow(/no picture m9/)
  expect((await h.outlines.get(h.folder))!.flair?.inserts ?? []).toEqual([])
})

test("Claude's cutaway changed by hand in the graphics tab stays on its point", async () => {
  const h = await withPoints()
  h.claude.replies.set(TECHNIQUES_PROMPT.system, { zooms: [], inserts: [{ point: 1, picture: 1 }] })
  await h.flair.planTechniques(h.folder, request())
  await h.flair.setInsert(h.folder, moment(s(18.08)), "m1", "cover", "m1")
  expect(await cutaways(h)).toEqual([["m1", s(18.08), "p-space", true, "cover"]])
})

test("text the user makes for a point is bound to it and shows at the point's level; a point that is not stored is refused", async () => {
  const h = await withPoints()
  // สามสองหนึ่ง, the words of p-count, which is secondary
  await h.highlights.addFromWords(h.folder, CLIP_ID, [8, 9, 10], 12, "beat-1", "p-count")
  expect((await h.outlines.get(h.folder))!.highlights!.groups.map((group) => [group.source, group.pointId])).toEqual([["user", "p-count"]])
  expect((await h.preview()).emphasis.points.map((point) => [point.id, point.items.text])).toEqual([
    ["p-space", 0],
    ["p-count", 1],
  ])
  const light = await h.highlights.preview(h.folder, DEFAULT_CUT_RULES, { ...request().view, flair: { ...FLAIR, level: "light" } })
  expect(light.groups).toEqual([])
  await expect(h.highlights.addFromWords(h.folder, CLIP_ID, [3], 12, "beat-1", "p-nope")).rejects.toThrow(/no point p-nope/)
  expect((await h.outlines.get(h.folder))!.highlights!.groups).toHaveLength(1)
})

/* motion graphics: planned, then each one written for the room it has */

/** The stage of a graphic in MOTION's box on the fixture's 1080×1920 frame: four fifths of its width, 0.15 of its height. */
const STAGE = { width: 864, height: 288 }
/** MOTION's box as a plan stores it. */
const BOX = { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }
/** What the writing calls are told the fixture's clip is about: its outline has a title, no summary, and its brief no video type. */
const ABOUT = "นักบินอวกาศ"
/** อวกาศ plays 1.07 s into the rough cut, 1.7 s before its piece ends; the ใน after it is said 0.92 s on. */
const SPACE_WORDS: MotionWord[] = [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }]
/** The second สาม plays 2.92 s in, in a piece that plays on 2.78 s to the end of the rough cut; สอง is said 1.26 s on, หนึ่ง 2.22 s on. */
const COUNT_WORDS: MotionWord[] = [{ text: "สาม", atS: 0 }, { text: "สอง", atS: 1.26 }]

/** A point on one word of the fixture, key unless said otherwise. */
const wordPoint = (id: string, word: number, importance: EmphasisPoint["importance"] = "key"): EmphasisPoint => ({
  id,
  anchor: { kind: "speech", videoId: CLIP_ID, from: word, to: word + 1, beatId: "beat-1" },
  importance,
  type: "number",
  reason: id,
  source: "ai",
  edited: false,
})
/** Five points in playing order: ขึ้น (0.15 s in), อวกาศ (1.07 s), the ใน after it (1.99 s), the second สาม (2.92 s) and the สอง after it (4.18 s). */
const FIVE = [wordPoint("p-up", 0), wordPoint("p-space", 3), wordPoint("p-in", 4), wordPoint("p-three", 8), wordPoint("p-two", 9)]

test("graphics are planned on the points and stored with their point, then each one in force is written for the room it has now and stored with what it was written for; with graphics off nothing is asked", async () => {
  const { flair, folder, claude, outlines, graphics } = await withPoints()
  await outlines.update(folder, (stored) => ({ ...stored!, brief: { ...stored!.brief, videoType: "review" }, outline: { ...stored!.outline, summary: "เล่าว่านักบินขึ้นอวกาศได้อย่างไร" } }))
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  // Claude was shown the points, each phrase in its sentence
  expect(callsWith(claude, MOTION_PLAN_PROMPT.system).map((asked) => textOf(asked.content))).toEqual([expect.stringContaining("(สำคัญ · สถานที่) “อวกาศ” ในประโยค “ขึ้นไปในอวกาศใน” — ไปอวกาศ")])
  // planned for 2 s from อวกาศ, which plays 1.7 s before its piece ends: written for those 1.7 s and the two words said in
  // them, on a stage that is its box on the frame, and told what the clip is about
  expect(briefs(claude)).toEqual([motionBrief({ stage: STAGE, seconds: 1.7, words: SPACE_WORDS, idea: MOTION.idea, about: "นักบินอวกาศ: เล่าว่านักบินขึ้นอวกาศได้อย่างไร (review)" })])
  expect(await graphics()).toEqual([
    {
      anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" },
      spec: { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 1.7, why: "ไปไหน", idea: MOTION.idea, words: SPACE_WORDS, html: FRAGMENT },
      edited: false,
      off: false,
      pointId: "p-space",
    },
  ])
  const asked = claude.requests.length
  expect(await flair.planGraphics(folder, request())).toEqual({ count: 0, dropped: 0 })
  expect(claude.requests).toHaveLength(asked)
})

/** What a writing call was told the clip is about. */
const aboutIn = (brief: string) => /^- The clip is about: (.*)\.$/m.exec(brief)?.[1]

test("a writing is told what the clip is about in one line: the title alone when there is no summary, and a long summary cut by whole letters, before the video type", async () => {
  const { flair, folder, claude, outlines } = await withPoints()
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  await flair.planGraphics(folder, request({ graphic: true }))
  expect(briefs(claude).map(aboutIn)).toEqual([ABOUT])
  // the title and its colon are 13 characters, then ที่ 200 times over two lines: the 300 kept end on a whole ที่, and the type comes after the cut
  await outlines.update(folder, (stored) => ({ ...stored!, brief: { ...stored!.brief, videoType: "vlog" }, outline: { ...stored!.outline, summary: `${"ที่".repeat(100)}\n${"ที่".repeat(100)}` } }))
  await flair.planGraphics(folder, request({ graphic: true }))
  expect(briefs(claude).map(aboutIn).at(-1)).toBe(`นักบินอวกาศ: ${"ที่".repeat(95)} (vlog)`)
})

test("the work writes what is in force and not written yet, the user's own too; one the level hides, one switched off and one already written are left as they are", async () => {
  const points = [wordPoint("p-up", 0), wordPoint("p-space", 3), wordPoint("p-in", 4), wordPoint("p-three", 8, "extra")]
  const { flair, folder, claude, outlines, graphics } = await withPoints({}, { points })
  const unwritten = (sourceUs: number, pointId: string, idea: string, extra: Partial<GraphicCue>): GraphicCue => ({
    anchor: { kind: "speech", videoId: CLIP_ID, sourceUs, beatId: "beat-1" },
    spec: { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 3, why: "", idea, words: [], html: null },
    edited: true,
    off: false,
    pointId,
    ...extra,
  })
  // the user switched one of Claude's off and on again before it was written, and left another off
  const mine = unwritten(s(17.16), "p-up", "ลูกศรชี้ขึ้น", {})
  const switchedOff = unwritten(s(19.0), "p-in", "วงแหวนหมุน", { off: true })
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics: [mine, switchedOff] } }))
  // Claude is kept off the user's points, and answers the other two: อวกาศ, and สาม, which only the loudest level shows
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 2 }, { ...MOTION, point: 4, idea: "เลขนับถอยหลัง" }] })
  const progress = vi.fn()
  expect(await flair.planGraphics(folder, request({ graphic: true }), undefined, progress)).toEqual({ count: 2, dropped: 0 })
  // in playing order: the user's on ขึ้น, for the 2.62 s its piece leaves of the 3 it was planned for, then Claude's on อวกาศ
  expect(briefs(claude)).toEqual([
    motionBrief({
      stage: STAGE,
      seconds: 2.62,
      words: [{ text: "ขึ้น", atS: 0 }, { text: "ไป", atS: 0.28 }, { text: "ใน", atS: 0.52 }, { text: "อวกาศ", atS: 0.92 }, { text: "ใน", atS: 1.84 }],
      idea: "ลูกศรชี้ขึ้น",
      about: ABOUT,
    }),
    motionBrief({ stage: STAGE, seconds: 1.7, words: SPACE_WORDS, idea: MOTION.idea, about: ABOUT }),
  ])
  expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
  const stored = await graphics()
  expect(stored.map((graphic) => [graphic.pointId, graphic.edited, graphic.off, isMotion(graphic.spec) && graphic.spec.html, graphic.spec.seconds])).toEqual([
    ["p-up", true, false, FRAGMENT, 2.62],
    ["p-in", true, true, null, 3],
    ["p-space", false, false, FRAGMENT, 1.7],
    // planned for the 2 s Claude asked, and waiting for a level that shows it
    ["p-three", false, false, null, 2],
  ])
  // thought again with nothing new to write at this level, nothing is written and nothing reported
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  progress.mockClear()
  const written = briefs(claude).length
  expect(await flair.planGraphics(folder, request({ graphic: true }), undefined, progress)).toEqual({ count: 0, dropped: 0 })
  expect(briefs(claude)).toHaveLength(written)
  expect(progress).not.toHaveBeenCalled()
  expect((await graphics()).map((graphic) => [graphic.pointId, isMotion(graphic.spec) && graphic.spec.html])).toEqual([
    ["p-up", FRAGMENT],
    ["p-in", null],
  ])
})

test("a graphic whose writing fails is stored with no fragment and why, and counts with what the plan dropped; the others are written all the same", async () => {
  const { flair, folder, claude, graphics } = await withPoints()
  // an answer for a point that is not there is dropped by the plan
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1, idea: "จรวด" }, { ...MOTION, point: 2, idea: "นาฬิกา" }, { ...MOTION, point: 9 }] })
  // the rocket's fragment is refused by the linter, and so is its repair
  claude.replies.set(MOTION_CONTRACT, (asked: LlmRequest<unknown>) => (textOf(asked.content).includes("- What to draw: จรวด\n") ? TIMER : FRAGMENT))
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 2 })
  const [problem] = lintFragment(TIMER)
  expect((await graphics()).map((graphic) => graphic.spec)).toEqual([
    // as the plan left it, less the fragment it never got
    { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "ไปไหน", idea: "จรวด", words: SPACE_WORDS, html: null, failed: problem },
    { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "ไปไหน", idea: "นาฬิกา", words: COUNT_WORDS, html: FRAGMENT },
  ])
  // the rocket was asked for twice, the second time with what was wrong with the first; the clock once
  const rocket = motionBrief({ stage: STAGE, seconds: 1.7, words: SPACE_WORDS, idea: "จรวด", about: ABOUT })
  expect(briefs(claude).filter((brief) => brief.includes("จรวด"))).toEqual([rocket, repairBrief({ brief: rocket, html: TIMER, problems: [problem!] })])
  expect(briefs(claude)).toHaveLength(3)
})

test("a writing call that fails is that graphic's failure, stored as the call said it with no repair asked, and the other graphics are written all the same", async () => {
  const { flair, folder, claude, graphics } = await withPoints()
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1, idea: "จรวด" }, { ...MOTION, point: 2, idea: "นาฬิกา" }] })
  // the rocket's call runs out of time
  claude.replies.set(MOTION_CONTRACT, (asked: LlmRequest<unknown>) => {
    if (textOf(asked.content).includes("- What to draw: จรวด\n")) throw new Error("timed out")
    return FRAGMENT
  })
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 1 })
  expect((await graphics()).map((graphic) => isMotion(graphic.spec) && [graphic.spec.idea, graphic.spec.html, graphic.spec.failed])).toEqual([
    ["จรวด", null, "timed out"],
    ["นาฬิกา", FRAGMENT, undefined],
  ])
  expect(briefs(claude)).toHaveLength(2)
})

test("a fragment is rendered as the stored graphic will be, a failed render's reasons go to the one repair a line each, and nothing is stored until the writing has ended", async () => {
  // the first fragment fails its render for two reasons; what the repair gives renders
  const failure = 'window.frame threw: needle is not defined\n\n<g class="icon"> has a transform attribute and an animation of its transform'
  const renderer = fakeRenderer((html) => (html === FRAGMENT ? failure : null))
  const h = await withPoints({ graphics: renderer, graphicsReady: async () => true })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  const held = heldWriting(h.claude)
  const working = h.flair.planGraphics(h.folder, request({ graphic: true }))
  await held.asked(1)
  held.waiting[0]!.answer(FRAGMENT)
  await held.asked(2)
  // the repair is asked with the render's reasons, the empty line between them left out
  const brief = motionBrief({ stage: STAGE, seconds: 1.7, words: SPACE_WORDS, idea: MOTION.idea, about: ABOUT })
  expect(held.waiting[1]!.brief).toBe(repairBrief({ brief, html: FRAGMENT, problems: ["window.frame threw: needle is not defined", '<g class="icon"> has a transform attribute and an animation of its transform'] }))
  // the fragment that failed was never stored: the graphic is as the plan left it
  expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual([{ kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "ไปไหน", idea: MOTION.idea, words: SPACE_WORDS, html: null }])
  held.waiting[1]!.answer(MENDED)
  expect(await working).toEqual({ count: 1, dropped: 0 })
  expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual([{ kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 1.7, why: "ไปไหน", idea: MOTION.idea, words: SPACE_WORDS, html: MENDED }])
  // each candidate was rendered alone, for this project, and the one that passed is the job the stored graphic has: the
  // preview and the write find its file made
  expect(renderer.wait.mock.calls.map(([jobs, folder]) => [jobs.length, folder])).toEqual([[1, h.folder], [1, h.folder]])
  const { jobs } = await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, request({ graphic: true }).view)
  expect(jobs).toEqual(renderer.wait.mock.calls[1]![0])
  expect(jobs[0]).toMatchObject({ spec: { html: MENDED, seconds: 1.7 }, times: [0, 0.92], canvas: { width: 1080, height: 1920 }, fps: 30, palette: STYLE.palette })
})

test("a graphic moved off the subtitles is written and rendered where it moved to, and stored where it was planned", async () => {
  const renderer = fakeRenderer()
  const h = await withPoints({ graphics: renderer, graphicsReady: async () => true })
  // planned in the subtitles' room, which starts at 0.76 of the frame's height
  const planned = { x0: 0.1, y0: 0.78, x1: 0.9, y1: 0.93 }
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1, box: [planned.x0, planned.y0, planned.x1, planned.y1] }] })
  const drawn = request({ graphic: true })
  const withSubtitles = { ...drawn, view: { ...drawn.view, subtitlesOn: true } }
  expect(await h.flair.planGraphics(h.folder, withSubtitles)).toEqual({ count: 1, dropped: 0 })
  const [job] = renderer.wait.mock.calls[0]![0]
  expect(job!.spec.box.y1).toBeLessThanOrEqual(0.76)
  // the stage Claude wrote for is the box where it plays
  const { width, height } = stageBox(job!.spec.box, { width: 1080, height: 1920 })
  expect(briefs(h.claude)).toEqual([motionBrief({ stage: { width, height }, seconds: 1.7, words: SPACE_WORDS, idea: MOTION.idea, about: ABOUT })])
  // stored where Claude planned it, since the move is made again each time it is placed; placed again, it has the job that was rendered
  expect((await h.graphics()).map((graphic) => graphic.spec.box)).toEqual([planned])
  expect((await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, withSubtitles.view)).jobs).toEqual([job])
})

test("still failing its render after the repair, the graphic is stored with no fragment and the render's reason", async () => {
  const renderer = fakeRenderer(() => "nothing was drawn: every frame is empty")
  const h = await withPoints({ graphics: renderer, graphicsReady: async () => true })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  h.claude.replies.set(MOTION_CONTRACT, (asked: LlmRequest<unknown>) => (textOf(asked.content).includes("You wrote the fragment below") ? MENDED : FRAGMENT))
  expect(await h.flair.planGraphics(h.folder, request({ graphic: true }))).toEqual({ count: 0, dropped: 1 })
  expect((await h.graphics()).map((graphic) => graphic.spec)).toMatchObject([{ html: null, failed: "nothing was drawn: every frame is empty", seconds: 2 }])
  expect(briefs(h.claude)).toHaveLength(2)
  expect(renderer.wait).toHaveBeenCalledTimes(2)
})

test("on a machine that cannot render now, the fragment that passed the linter is stored unrendered, with no repair: no renderer, the pack not ready, or a render that neither made it nor failed it", async () => {
  const plan = { graphics: [{ ...MOTION, point: 1 }] }
  const written = async (h: Awaited<ReturnType<typeof withPoints>>) => {
    h.claude.replies.set(MOTION_PLAN_PROMPT.system, plan)
    expect(await h.flair.planGraphics(h.folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
    expect((await h.graphics()).map((graphic) => graphic.spec)).toMatchObject([{ html: FRAGMENT, seconds: 1.7 }])
    expect(briefs(h.claude)).toHaveLength(1)
  }
  // the pack is not installed, or a render found the machine unfit: nothing is asked of the renderer
  const notReady = fakeRenderer(() => "never asked")
  await written(await withPoints({ graphics: notReady, graphicsReady: async () => false }))
  expect(notReady.wait).not.toHaveBeenCalled()
  // a service not told whether the pack is installed takes it as missing
  const untold = fakeRenderer(() => "never asked")
  await written(await withPoints({ graphics: untold }))
  expect(untold.wait).not.toHaveBeenCalled()
  // the render was stopped, or found the machine unfit: the job is neither made nor failed
  const unfit = fakeRenderer(() => undefined)
  await written(await withPoints({ graphics: unfit, graphicsReady: async () => true }))
  expect(unfit.wait).toHaveBeenCalledTimes(1)
  // a rough cut with no frame to draw on has no job to render
  const frameless = fakeRenderer(() => "never asked")
  await written(await withPoints({ graphics: frameless, graphicsReady: async () => true, candidateJob: async () => null }))
  expect(frameless.wait).not.toHaveBeenCalled()
  // with no renderer at all the linter alone checks it, as in most of these tests
  await written(await withPoints())
})

test("a render that failed with no words for why is a failure all the same, and gets the repair", async () => {
  // the renderer says the first fragment failed, and has nothing to say of it
  const renderer = fakeRenderer((html) => (html === FRAGMENT ? "" : null))
  const h = await withPoints({ graphics: renderer, graphicsReady: async () => true })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  h.claude.replies.set(MOTION_CONTRACT, (asked: LlmRequest<unknown>) => (textOf(asked.content).includes("You wrote the fragment below") ? MENDED : FRAGMENT))
  expect(await h.flair.planGraphics(h.folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  expect(briefs(h.claude)[1]).toContain("\n- the render failed\n")
  expect((await h.graphics()).map((graphic) => graphic.spec)).toMatchObject([{ html: MENDED }])
})

test("as the writing begins the renderer forgets what it found wrong with the machine, so a fault mended since does not leave the writing unrendered; with nothing to write it is not asked to", async () => {
  const renderer = fakeRenderer()
  const h = await withPoints({ graphics: renderer, graphicsReady: async () => true })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }, { ...MOTION, point: 2 }] })
  await h.flair.planGraphics(h.folder, request({ graphic: true }))
  expect(renderer.forgetMachine).toHaveBeenCalledTimes(1)
  expect(renderer.forgetMachine.mock.invocationCallOrder[0]).toBeLessThan(renderer.wait.mock.invocationCallOrder[0]!)
  // a plan whose graphics are all still to be written hands the renderer no job to start: each is rendered as its writing is checked
  expect(renderer.ensure.mock.calls).toEqual([[[], h.folder]])
  expect(renderer.wait.mock.calls.map(([jobs]) => jobs.map((job) => job.spec.html))).toEqual([[FRAGMENT], [FRAGMENT]])

  renderer.forgetMachine.mockClear()
  renderer.ensure.mockClear()
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  // Claude's two are replaced by none: nothing in force, nothing to write
  await h.flair.planGraphics(h.folder, request({ graphic: true }))
  expect(renderer.forgetMachine).not.toHaveBeenCalled()
  expect(renderer.ensure.mock.calls).toEqual([[[], h.folder]])
})

test("the graphics are written three at a time; a stop ends the calls in flight and starts no other, the ones already written stay, and the work ends as a stopped call ends it", async () => {
  const h = await withPoints({}, { points: FIVE })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: FIVE.map((_, i) => ({ ...MOTION, point: i + 1, idea: `ไอเดีย ${i + 1}` })) })
  const held = heldWriting(h.claude)
  const stop = new AbortController()
  const progress = vi.fn()
  const ended = h.flair.planGraphics(h.folder, request({ graphic: true }), stop.signal, progress).then(
    () => "done",
    (error: Error) => error.message,
  )
  await held.asked(3)
  // the fourth waits for one of the three to end
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(held.waiting).toHaveLength(3)
  expect(progress.mock.calls).toEqual([[0, 5]])
  held.of("ไอเดีย 2").answer(FRAGMENT)
  await held.asked(4)
  const htmls = async () => (await h.graphics()).map((graphic) => isMotion(graphic.spec) && graphic.spec.html)
  // stored as soon as it settled, before the others have
  expect(await htmls()).toEqual([null, FRAGMENT, null, null, null])
  expect(progress.mock.calls).toEqual([[0, 5], [1, 5]])
  stop.abort(new Error(CANCELLED))
  expect(await ended).toBe(CANCELLED)
  // the fifth was never asked for, and nothing more was stored or reported
  expect(callsWith(h.claude, MOTION_CONTRACT)).toHaveLength(4)
  expect(held.waiting).toHaveLength(4)
  expect(await htmls()).toEqual([null, FRAGMENT, null, null, null])
  expect((await h.graphics()).every((graphic) => isMotion(graphic.spec) && graphic.spec.failed === undefined)).toBe(true)
  expect(progress.mock.calls).toEqual([[0, 5], [1, 5]])
})

/** A render the test ends when it chooses. */
function heldOpen() {
  let end!: () => void
  const held = new Promise<void>((resolve) => (end = resolve))
  return { held, end }
}
/**
 * How a work ended. It is awaited while the step it was stopped in is still held open, so an answer at all is the
 * work ending at the stop and not when that step does; a work that waited for the step would hang here until the
 * test's own timeout.
 */
const outcomeOf = (work: Promise<unknown>) =>
  work.then(
    () => "done",
    (error: Error) => error.message,
  )

test("a stop while a fragment is being rendered ends the work at once, as a stop does, and nothing of that writing is stored; the render ending later, passing or failing, changes nothing", async () => {
  for (const verdict of [null, "nothing was drawn: every frame is empty"]) {
    const rendering = heldOpen()
    const renderer = fakeRenderer(() => verdict, rendering.held)
    const h = await withPoints({ graphics: renderer, graphicsReady: async () => true })
    h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
    const stop = new AbortController()
    const progress = vi.fn()
    const working = h.flair.planGraphics(h.folder, request({ graphic: true }), stop.signal, progress)
    // Claude has written the fragment, and its render is under way
    while (renderer.wait.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve))
    stop.abort(new Error(CANCELLED))
    expect(await outcomeOf(working)).toBe(CANCELLED)
    // as the plan left it: no fragment, and no failure either
    const planned = [{ kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "ไปไหน", idea: MOTION.idea, words: SPACE_WORDS, html: null }]
    expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual(planned)
    rendering.end()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual(planned)
    // no repair was asked for the render that failed after the stop
    expect(briefs(h.claude)).toHaveLength(1)
    expect(progress.mock.calls).toEqual([[0, 1]])
  }
})

test("a stop while the pack is looked for or the render job is made ends the work at once, and the renderer is asked for no render after it", async () => {
  for (const heldAt of ["graphicsReady", "candidateJob"] as const) {
    const making = heldOpen()
    const renderer = fakeRenderer()
    let reached = false
    /** Held until the test ends it, then what the real one answers. */
    const held = async <T>(answer: () => Promise<T>): Promise<T> => {
      reached = true
      await making.held
      return answer()
    }
    const h: Awaited<ReturnType<typeof withPoints>> = await withPoints({
      graphics: renderer,
      graphicsReady: () => (heldAt === "graphicsReady" ? held(async () => true) : Promise.resolve(true)),
      candidateJob: (folder, rules, graphic, spec) => (heldAt === "candidateJob" ? held(() => h.highlights.candidateJob(folder, rules, graphic, spec)) : h.highlights.candidateJob(folder, rules, graphic, spec)),
    })
    h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
    const stop = new AbortController()
    const working = h.flair.planGraphics(h.folder, request({ graphic: true }), stop.signal)
    // Claude has written the fragment, and its check has got as far as the held step
    while (!reached) await new Promise((resolve) => setImmediate(resolve))
    stop.abort(new Error(CANCELLED))
    expect(await outcomeOf(working), heldAt).toBe(CANCELLED)
    // the step ends after the stop: the check goes no further, so nothing is rendered for a writing that was stopped
    making.end()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(renderer.wait, heldAt).not.toHaveBeenCalled()
    expect((await h.graphics()).map((graphic) => graphic.spec)).toMatchObject([{ html: null }])
  }
})

test("a render check that cannot be made is no fault of the fragment: when the job cannot be built or the renderer throws, the fragment the linter passed is stored, with no repair", async () => {
  const thrown = (message: string) => () => {
    throw new Error(message)
  }
  const unable: Partial<FlairDeps>[] = [
    // the draft cannot be read just then
    { candidateJob: async () => thrown("the draft cannot be read")() },
    { graphicsReady: async () => thrown("the pack cannot be looked for")() },
    { graphics: { ...fakeRenderer(), hashOf: thrown("the job cannot be named") } },
    { graphics: { ...fakeRenderer(), wait: async () => thrown("the renderer is gone")() } },
    { graphics: { ...fakeRenderer(() => "it failed"), failureOf: thrown("the failure cannot be read") } },
  ]
  for (const extra of unable) {
    const h = await withPoints({ graphics: fakeRenderer(), graphicsReady: async () => true, ...extra })
    h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
    expect(await h.flair.planGraphics(h.folder, request({ graphic: true })), Object.keys(extra).join()).toEqual({ count: 1, dropped: 0 })
    expect((await h.graphics()).map((graphic) => graphic.spec)).toMatchObject([{ html: FRAGMENT, seconds: 1.7 }])
    expect(briefs(h.claude)).toHaveLength(1)
  }
})

test("when the graphics in force cannot be read once the plan is stored, the work fails with why, and the plan stays stored", async () => {
  const h = await withPoints({
    graphicJobs: async () => {
      throw new Error("the draft cannot be read")
    },
  })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  await expect(h.flair.planGraphics(h.folder, request({ graphic: true }))).rejects.toThrow(/^the draft cannot be read$/)
  expect((await h.graphics()).map((graphic) => [graphic.pointId, isMotion(graphic.spec) && graphic.spec.html])).toEqual([["p-space", null]])
  expect(briefs(h.claude)).toEqual([])
})

test("one graphic to a place: one of Claude's that waits for its point to come back gives way to a new answer on its place, and its sound goes with it", async () => {
  // Claude once started อวกาศ's graphic on ขึ้น, the first word of its sentence, and ขึ้น is a point of its own
  const h = await withPoints({}, { points: [wordPoint("p-up", 0), wordPoint("p-space", 3)] })
  const onUp = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(17.16), beatId: "beat-1" }
  const waiting: GraphicCue = { anchor: onUp, spec: { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "", idea: "จรวด", words: [], html: FRAGMENT }, edited: false, off: false, pointId: "p-space" }
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    flair: {
      looks: {},
      graphics: [waiting],
      cues: [
        // Claude's sound on its graphic, the user's own on the same moment, and Claude's for the other point there
        { anchor: onUp, effectId: "s1", edited: false, pointId: "p-space" },
        { anchor: onUp, effectId: "s2", edited: true, pointId: "p-space" },
        { anchor: onUp, effectId: "s2", edited: false, pointId: "p-up" },
      ],
    },
  }))
  // the user cuts อวกาศ: its point is off the rough cut, and what Claude put on it waits
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [3], keep: false })
  // Claude is asked about ขึ้น alone, and starts its graphic on ขึ้น: the place the waiting one is on
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1, idea: "ลูกศรชี้ขึ้น" }] })
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.planGraphics(h.folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  // the answer plays now, and wins: it alone is on the place, written with its own fragment
  expect((await h.graphics()).map((graphic) => [graphic.pointId, graphic.anchor, isMotion(graphic.spec) && [graphic.spec.idea, graphic.spec.html]])).toEqual([["p-up", onUp, ["ลูกศรชี้ขึ้น", MENDED]]])
  // Claude's sound for the one that went goes with it; the user's own stays, and so does the sound of the point whose graphic is there
  expect((await h.outlines.get(h.folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.edited, cue.pointId])).toEqual([
    ["s2", true, "p-space"],
    ["s2", false, "p-up"],
  ])
})

test("one of Claude's graphics that waits gives way to one of the user's own on its place too, with its sound; one that waits on a place of its own stays", async () => {
  const h = await withPoints({}, { points: [wordPoint("p-up", 0), wordPoint("p-space", 3), wordPoint("p-in", 4)] })
  const at = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
  const motion = (idea: string): MotionSpec => ({ kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "", idea, words: [], html: FRAGMENT })
  // Claude's two for อวกาศ's point: one started on ขึ้น, where the user then put one of their own, and one on อวกาศ itself
  const displaced: GraphicCue = { anchor: at(s(17.16)), spec: motion("จรวด"), edited: false, off: false, pointId: "p-space" }
  const kept: GraphicCue = { anchor: at(s(18.08)), spec: motion("ดาว"), edited: false, off: false, pointId: "p-space" }
  const mine: GraphicCue = { anchor: at(s(17.16)), spec: motion("ของฉัน"), edited: true, off: false }
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    flair: { looks: {}, graphics: [displaced, kept, mine], cues: [{ anchor: at(s(17.16)), effectId: "s1", edited: false, pointId: "p-space" }, { anchor: at(s(18.08)), effectId: "s2", edited: false, pointId: "p-space" }] },
  }))
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [3], keep: false })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  await h.flair.planGraphics(h.folder, request({ graphic: true }))
  expect((await h.graphics()).map((graphic) => isMotion(graphic.spec) && graphic.spec.idea)).toEqual(["ของฉัน", "ดาว"])
  expect((await h.outlines.get(h.folder))!.flair!.cues!.map((cue) => [cue.effectId, cue.anchor.kind === "speech" && cue.anchor.sourceUs])).toEqual([["s2", s(18.08)]])
})

test("the sound of a graphic that gave its place away stays when another of Claude's items for its own point still holds that moment", async () => {
  const h = await withPoints({}, { points: [wordPoint("p-up", 0), wordPoint("p-space", 3)] })
  const onUp = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(17.16), beatId: "beat-1" }
  // Claude's graphic and its cutaway for อวกาศ's point both start on ขึ้น, and share one sound there
  const waiting: GraphicCue = { anchor: onUp, spec: { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2, why: "", idea: "จรวด", words: [], html: FRAGMENT }, edited: false, off: false, pointId: "p-space" }
  const shared = { anchor: onUp, effectId: "s1", edited: false, pointId: "p-space" }
  await h.outlines.update(h.folder, (stored) => ({
    ...stored!,
    flair: { looks: {}, graphics: [waiting], inserts: [{ anchor: onUp, binId: "m1", edited: false, fit: "card", subject: null, pointId: "p-space" }], cues: [shared] },
  }))
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [3], keep: false })
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  await h.flair.planGraphics(h.folder, request({ graphic: true }))
  // the graphic gave way to the answer on its place; the cutaway still waits there, and the sound with it
  expect((await h.graphics()).map((graphic) => graphic.pointId)).toEqual(["p-up"])
  expect((await h.outlines.get(h.folder))!.flair).toMatchObject({ inserts: [{ binId: "m1", pointId: "p-space" }], cues: [shared] })
})

test("thinking the graphics again plans anew: Claude's own are replaced and written afresh, and one the user made theirs stays with its fragment and keeps Claude off its point", async () => {
  const { flair, folder, claude, graphics } = await withPoints()
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1, idea: "จรวด" }, { ...MOTION, point: 2, idea: "นาฬิกา" }] })
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 2, dropped: 0 })
  const [rocket] = await graphics()
  // switched off and on again by hand, the rocket is the user's
  await flair.setGraphic(folder, rocket!.anchor, { off: true })
  await flair.setGraphic(folder, rocket!.anchor, { off: false })
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1, idea: "ดาวเทียม" }, { ...MOTION, point: 2, idea: "ระฆัง" }] })
  claude.replies.set(MOTION_CONTRACT, MENDED)
  // Claude's answer on the user's point is not taken
  expect(await flair.planGraphics(folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 1 })
  expect((await graphics()).map((graphic) => [graphic.pointId, graphic.edited, isMotion(graphic.spec) && [graphic.spec.idea, graphic.spec.html]])).toEqual([
    ["p-space", true, ["จรวด", FRAGMENT]],
    ["p-count", false, ["ระฆัง", MENDED]],
  ])
  // only the new one was written: three writings in all
  expect(briefs(claude).map((brief) => /- What to draw: (.*)/.exec(brief)![1])).toEqual(["จรวด", "นาฬิกา", "ระฆัง"])
})

/* one graphic written again */

type MotionCue = Omit<GraphicCue, "spec"> & { spec: MotionSpec }
/** A motion graphic of Claude's as a writing left it: on a word of the fixture, written for a length and the words said in it. */
const writtenAt = (sourceUs: number, pointId: string, seconds: number, words: MotionWord[], extra: Partial<MotionCue> = {}): MotionCue => ({
  anchor: { kind: "speech", videoId: CLIP_ID, sourceUs, beatId: "beat-1" },
  spec: { kind: "motion", version: MOTION_VERSION, box: BOX, seconds, why: "ไปไหน", idea: `ไอเดียของ ${pointId}`, words, html: FRAGMENT },
  edited: false,
  off: false,
  pointId,
  ...extra,
})
const ON_SPACE = writtenAt(s(18.08), "p-space", 1.7, SPACE_WORDS)
const ON_COUNT = writtenAt(s(22.62), "p-count", 2, COUNT_WORDS)
const DRAWN = request({ graphic: true })
/** The fragment a spec holds, as a writing that replaces it keeps it for one step back: with what it was written for, and the change that made it when one did. */
const keptOf = (spec: MotionSpec): PreviousFragment => ({ html: spec.html!, seconds: spec.seconds, words: spec.words, version: spec.version, ...(spec.instruction !== undefined ? { instruction: spec.instruction } : {}) })

/** The fixture with graphics stored on it. */
async function withStored(graphics: GraphicCue[], extra: Partial<FlairDeps> = {}) {
  const h = await withPoints(extra)
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics } }))
  return h
}

test("a graphic is written again from its idea for the room it has now: its fragment stays until the new writing has ended, then gives way and is kept for one step back; it stays Claude's and the others are left alone", async () => {
  const renderer = fakeRenderer()
  const h = await withStored([ON_SPACE, ON_COUNT], { graphics: renderer, graphicsReady: async () => true })
  const held = heldWriting(h.claude)
  const progress = vi.fn()
  const redoing = h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN, undefined, progress)
  await held.asked(1)
  // while Claude writes, the graphic is as it was
  expect(await h.graphics()).toEqual([ON_SPACE, ON_COUNT])
  expect(progress.mock.calls).toEqual([[0, 1]])
  held.waiting[0]!.answer(MENDED)
  expect(await redoing).toEqual({ count: 1, dropped: 0 })
  expect(await h.graphics()).toEqual([{ ...ON_SPACE, spec: { ...ON_SPACE.spec, html: MENDED, previous: keptOf(ON_SPACE.spec) } }, ON_COUNT])
  expect(progress.mock.calls).toEqual([[0, 1], [1, 1]])
  // one call and no plan: the idea it was planned with, the length it plays and the words said in it now
  expect(h.claude.requests.map((asked) => asked.system)).toEqual([MOTION_CONTRACT])
  expect(held.waiting[0]!.brief).toBe(motionBrief({ stage: STAGE, seconds: 1.7, words: SPACE_WORDS, idea: ON_SPACE.spec.idea, about: ABOUT }))
  // the machine was looked at afresh before the render, and the candidate rendered as the stored graphic is
  expect(renderer.forgetMachine).toHaveBeenCalledTimes(1)
  expect(renderer.forgetMachine.mock.invocationCallOrder[0]).toBeLessThan(renderer.wait.mock.invocationCallOrder[0]!)
  const { jobs } = await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)
  expect(renderer.wait.mock.calls).toEqual([[[jobs[0]], h.folder]])
  // nothing else was started
  expect(renderer.ensure).not.toHaveBeenCalled()
})

test("a graphic gone stale is put right by writing it again: written for the words and the length it has now, it is fresh", async () => {
  const h = await withStored([ON_COUNT])
  // the user cuts สอง: only สาม is said while the graphic plays, for the 1.5 s a graphic plays at the least
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [9], keep: false })
  expect((await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)).kept).toMatchObject([{ stale: true }])
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.redoGraphic(h.folder, ON_COUNT.anchor, DRAWN)).toEqual({ count: 1, dropped: 0 })
  expect(briefs(h.claude)).toEqual([motionBrief({ stage: STAGE, seconds: 1.5, words: [{ text: "สาม", atS: 0 }], idea: ON_COUNT.spec.idea, about: ABOUT })])
  expect(await h.graphics()).toEqual([{ ...ON_COUNT, spec: { ...ON_COUNT.spec, seconds: 1.5, words: [{ text: "สาม", atS: 0 }], html: MENDED, previous: keptOf(ON_COUNT.spec) } }])
  const { kept, jobs } = await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)
  expect(kept).toMatchObject([{ durationUs: 1_500_000, stale: false }])
  expect(jobs).toMatchObject([{ spec: { html: MENDED }, times: [0] }])
})

test("a graphic written again under an earlier contract is stamped with the one in force, so it is stale no more", async () => {
  const old = { ...ON_SPACE, spec: { ...ON_SPACE.spec, version: "motion-2026-01-01" } }
  const h = await withStored([old])
  expect((await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)).kept).toMatchObject([{ stale: true }])
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  await h.flair.redoGraphic(h.folder, old.anchor, DRAWN)
  // the fragment it replaces is kept under the contract it was written by
  expect(await h.graphics()).toEqual([{ ...ON_SPACE, spec: { ...ON_SPACE.spec, html: MENDED, previous: { ...keptOf(ON_SPACE.spec), version: "motion-2026-01-01" } } }])
  expect((await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)).kept).toMatchObject([{ stale: false }])
})

test("a writing again that fails leaves the graphic with no fragment and why, the one it had kept for one step back, and counts as one dropped; written again well, the failure goes and the good one is still kept", async () => {
  const h = await withStored([ON_SPACE, ON_COUNT])
  h.claude.replies.set(MOTION_CONTRACT, TIMER)
  expect(await h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)).toEqual({ count: 0, dropped: 1 })
  // the fragment it had is no longer played, and is kept for one step back; its length and words are as they were
  expect(await h.graphics()).toEqual([{ ...ON_SPACE, spec: { ...ON_SPACE.spec, html: null, failed: lintFragment(TIMER).join("\n"), previous: keptOf(ON_SPACE.spec) } }, ON_COUNT])
  expect(briefs(h.claude)).toHaveLength(2)
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)).toEqual({ count: 1, dropped: 0 })
  // there was no fragment to replace: the good one is still the one kept
  expect(await h.graphics()).toEqual([{ ...ON_SPACE, spec: { ...ON_SPACE.spec, html: MENDED, previous: keptOf(ON_SPACE.spec) } }, ON_COUNT])
})

test("a graphic with no place on the clip now is not written again: one the level hides, one with too little of the rough cut left, one that is not there, one that is no motion graphic", async () => {
  // switched off on หนึ่ง, which plays 0.56 s before the rough cut ends: switched on, it would not play
  const late = writtenAt(s(24.84), "p-count", 2, [{ text: "หนึ่ง", atS: 0 }], { off: true, edited: true, spec: { ...ON_COUNT.spec, html: null } })
  // a card of the old kit, as a file from before 0.5.0 edited back in by hand would hold: of no kind the app draws
  const card = {
    anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(19.0), beatId: "beat-1" },
    spec: { version: "k", box: BOX, seconds: 2, tone: "base", in: "pop", out: "fade", pieces: [{ kind: "number", text: "นับ", from: 3, to: 1, unit: "", atS: 0, untilS: 1 }], why: "" },
    edited: true,
    off: false,
  } as unknown as GraphicCue
  const h = await withStored([ON_SPACE, ON_COUNT, late, card])
  const noPlace = /^this graphic has no place on the clip now$/
  // the lightest level hides the countdown's point, which is secondary
  await expect(h.flair.redoGraphic(h.folder, ON_COUNT.anchor, { ...DRAWN, view: { ...DRAWN.view, flair: { ...DRAWN.view.flair, level: "light" } } })).rejects.toThrow(noPlace)
  await expect(h.flair.redoGraphic(h.folder, late.anchor, DRAWN)).rejects.toThrow(noPlace)
  await expect(h.flair.redoGraphic(h.folder, { kind: "speech", videoId: CLIP_ID, sourceUs: s(17.16), beatId: "beat-1" }, DRAWN)).rejects.toThrow(noPlace)
  await expect(h.flair.redoGraphic(h.folder, card.anchor, DRAWN)).rejects.toThrow(noPlace)
  // with the graphics off none plays
  await expect(h.flair.redoGraphic(h.folder, ON_SPACE.anchor, request())).rejects.toThrow(noPlace)
  expect(h.claude.requests).toEqual([])
  expect(await h.graphics()).toEqual([ON_SPACE, ON_COUNT, late, card])
})

test("a switched-off graphic is written again for the length it would play switched on, so that it is fresh when it is", async () => {
  // written for 1.7 s on สอง and switched off: the rough cut ends 1.52 s after สอง, and หนึ่ง is said 0.96 s on
  const words = [{ text: "สอง", atS: 0 }, { text: "หนึ่ง", atS: 0.96 }]
  const off = writtenAt(s(23.88), "p-count", 1.7, words, { off: true, edited: true })
  const h = await withStored([off])
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.redoGraphic(h.folder, off.anchor, DRAWN)).toEqual({ count: 1, dropped: 0 })
  expect(briefs(h.claude)).toEqual([motionBrief({ stage: STAGE, seconds: 1.52, words, idea: off.spec.idea, about: ABOUT })])
  // still switched off, and still the user's
  expect(await h.graphics()).toEqual([{ ...off, spec: { ...off.spec, seconds: 1.52, html: MENDED, previous: keptOf(off.spec) } }])
  await h.flair.setGraphic(h.folder, off.anchor, { off: false })
  const { kept, jobs } = await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)
  expect(kept).toMatchObject([{ durationUs: 1_520_000, stale: false }])
  expect(jobs).toMatchObject([{ spec: { html: MENDED, seconds: 1.52 }, times: [0, 0.96] }])
})

test("a stop during a writing again ends it as a stop, and the fragment the graphic had stays", async () => {
  const h = await withStored([ON_SPACE, ON_COUNT])
  const held = heldWriting(h.claude)
  const stop = new AbortController()
  const progress = vi.fn()
  const redoing = h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN, stop.signal, progress).then(
    () => "done",
    (error: Error) => error.message,
  )
  await held.asked(1)
  stop.abort(new Error(CANCELLED))
  expect(await redoing).toBe(CANCELLED)
  expect(await h.graphics()).toEqual([ON_SPACE, ON_COUNT])
  expect(progress.mock.calls).toEqual([[0, 1]])
})

test("a stop while a graphic written again is being rendered ends the work at once, as a stop does, and the fragment the graphic had stays", async () => {
  const rendering = heldOpen()
  const renderer = fakeRenderer(() => null, rendering.held)
  const h = await withStored([ON_SPACE, ON_COUNT], { graphics: renderer, graphicsReady: async () => true })
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  const stop = new AbortController()
  const progress = vi.fn()
  const redoing = h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN, stop.signal, progress)
  while (renderer.wait.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve))
  stop.abort(new Error(CANCELLED))
  expect(await outcomeOf(redoing)).toBe(CANCELLED)
  expect(await h.graphics()).toEqual([ON_SPACE, ON_COUNT])
  // the render ends after the stop, and passes: what Claude wrote is not stored all the same
  rendering.end()
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(await h.graphics()).toEqual([ON_SPACE, ON_COUNT])
  expect(progress.mock.calls).toEqual([[0, 1]])
})

test("the length a graphic is written for is the millisecond below what it plays: 3.456789 s is written for, and stored, as 3.456", async () => {
  // placed for a length that is no whole number of milliseconds
  const placed = { cue: ON_SPACE, atUs: 1_070_000, durationUs: 3_456_789, wordsNow: SPACE_WORDS, stale: false }
  const h = await withStored([ON_SPACE], { graphicJobs: async () => ({ kept: [placed], off: [], jobs: [null] }) })
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)).toEqual({ count: 1, dropped: 0 })
  expect(briefs(h.claude)).toEqual([motionBrief({ stage: STAGE, seconds: 3.456, words: SPACE_WORDS, idea: ON_SPACE.spec.idea, about: ABOUT })])
  expect((await h.graphics()).map((graphic) => graphic.spec.seconds)).toEqual([3.456])
})

test("a graphic taken away while it is written again is left alone: what Claude wrote for it is not put back", async () => {
  const h = await withStored([ON_SPACE, ON_COUNT])
  const held = heldWriting(h.claude)
  const redoing = h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)
  await held.asked(1)
  await h.flair.setGraphic(h.folder, ON_SPACE.anchor, null)
  held.waiting[0]!.answer(MENDED)
  expect(await redoing).toEqual({ count: 0, dropped: 0 })
  expect(await h.graphics()).toEqual([ON_COUNT])
})

test("a graphic switched off while it is written again keeps the switch: only what the writing made is stored on it", async () => {
  const h = await withStored([ON_SPACE])
  const held = heldWriting(h.claude)
  const redoing = h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)
  await held.asked(1)
  await h.flair.setGraphic(h.folder, ON_SPACE.anchor, { off: true })
  held.waiting[0]!.answer(MENDED)
  await redoing
  expect(await h.graphics()).toEqual([{ ...ON_SPACE, off: true, edited: true, spec: { ...ON_SPACE.spec, html: MENDED, previous: keptOf(ON_SPACE.spec) } }])
})

/* what every writing that replaces a fragment keeps: one step back */

test("a writing again keeps the fragment it replaces for one step back, whether it succeeds or fails, and a second failure keeps the good one; the others are left alone", async () => {
  const h = await withStored([ON_SPACE, ON_COUNT])
  // written again well: the fragment it had until then is kept, with the length, the words and the contract it was written for
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)).toEqual({ count: 1, dropped: 0 })
  expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual([
    { ...ON_SPACE.spec, html: MENDED, previous: { html: FRAGMENT, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION } },
    ON_COUNT.spec,
  ])
  // written again and failed: it has no fragment now, and the one the failure replaced is kept
  h.claude.replies.set(MOTION_CONTRACT, TIMER)
  expect(await h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)).toEqual({ count: 0, dropped: 1 })
  const failed = { ...ON_SPACE.spec, html: null, failed: lintFragment(TIMER).join("\n"), previous: { html: MENDED, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION } }
  expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual([failed, ON_COUNT.spec])
  // failed once more: with no fragment to keep, the good one is still the one kept
  expect(await h.flair.redoGraphic(h.folder, ON_SPACE.anchor, DRAWN)).toEqual({ count: 0, dropped: 1 })
  expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual([failed, ON_COUNT.spec])
})

test("a writing again takes away the change that made the fragment and why an edit failed, and keeps the fragment it replaces with the change that made it", async () => {
  // edited once as the user asked, then an edit that failed
  const edited = { ...ON_SPACE, spec: { ...ON_SPACE.spec, instruction: "ตัวเลขใหญ่ขึ้น", editFailed: "timed out", previous: { html: MENDED, seconds: 2, words: [], version: MOTION_VERSION } } }
  const h = await withStored([edited])
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  await h.flair.redoGraphic(h.folder, edited.anchor, DRAWN)
  const [spec] = (await h.graphics()).map((graphic) => graphic.spec)
  expect(spec).toEqual({ ...ON_SPACE.spec, html: MENDED, previous: { html: FRAGMENT, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION, instruction: "ตัวเลขใหญ่ขึ้น" } })
  expect(Object.keys(spec!)).not.toContain("instruction")
  expect(Object.keys(spec!)).not.toContain("editFailed")
  // a writing again that fails takes them away as well
  const again = await withStored([edited])
  again.claude.replies.set(MOTION_CONTRACT, TIMER)
  await again.flair.redoGraphic(again.folder, edited.anchor, DRAWN)
  expect((await again.graphics()).map((graphic) => graphic.spec)).toEqual([
    { ...ON_SPACE.spec, html: null, failed: lintFragment(TIMER).join("\n"), previous: { html: FRAGMENT, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION, instruction: "ตัวเลขใหญ่ขึ้น" } },
  ])
})

test("a plan's first writing keeps no fragment before it; one of a graphic with no fragment keeps the fragment it kept, and takes away a change and why an edit failed", async () => {
  const { flair, folder, claude, graphics } = await withPoints()
  claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1 }] })
  await flair.planGraphics(folder, request({ graphic: true }))
  expect(Object.keys((await graphics())[0]!.spec)).not.toContain("previous")

  // the user's own graphic on ขึ้น, whose writing again failed: it has no fragment, and keeps the one before. A change and
  // why an edit failed are on it as no writing leaves them, but a file edited by hand may
  const before: PreviousFragment = { html: MENDED, seconds: 2.62, words: [], version: MOTION_VERSION, instruction: "ช้าลง" }
  const mine: GraphicCue = {
    anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(17.16), beatId: "beat-1" },
    spec: { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 3, why: "", idea: "ลูกศรชี้ขึ้น", words: [], html: null, failed: "timed out", instruction: "ใหญ่ขึ้น", editFailed: "timed out", previous: before },
    edited: true,
    off: false,
    pointId: "p-up",
  }
  const h = await withPoints({}, { points: [wordPoint("p-up", 0)] })
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics: [mine] } }))
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [] })
  expect(await h.flair.planGraphics(h.folder, request({ graphic: true }))).toEqual({ count: 1, dropped: 0 })
  const words = [{ text: "ขึ้น", atS: 0 }, { text: "ไป", atS: 0.28 }, { text: "ใน", atS: 0.52 }, { text: "อวกาศ", atS: 0.92 }, { text: "ใน", atS: 1.84 }]
  const [spec] = (await h.graphics()).map((graphic) => graphic.spec)
  expect(spec).toEqual({ kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 2.62, why: "", idea: "ลูกศรชี้ขึ้น", words, html: FRAGMENT, previous: before })
  expect(Object.keys(spec!)).not.toContain("instruction")
  expect(Object.keys(spec!)).not.toContain("editFailed")
})

/* one graphic edited as the user asks */

/** A third fragment, so an edit of an edit can be told from both. */
const THIRD = '<style>.t{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="t">ดาว</div>'

test("a graphic is edited as the user asks: Claude is given the brief for the room it has now, the change and its fragment; the new fragment is stored with the change, the one before is kept for one step back, and it stays Claude's", async () => {
  const renderer = fakeRenderer()
  // an edit of it failed before: this one, written, takes the failure away
  const failedBefore = { ...ON_SPACE, spec: { ...ON_SPACE.spec, editFailed: "timed out" } }
  const h = await withStored([failedBefore, ON_COUNT], { graphics: renderer, graphicsReady: async () => true })
  const held = heldWriting(h.claude)
  const progress = vi.fn()
  const editing = h.flair.editGraphic(h.folder, ON_SPACE.anchor, "  ตัวเลข\n ใหญ่ขึ้น  ", DRAWN, undefined, progress)
  await held.asked(1)
  // while Claude writes, the graphic is as it was
  expect(await h.graphics()).toEqual([failedBefore, ON_COUNT])
  expect(progress.mock.calls).toEqual([[0, 1]])
  // the brief of the room it has now, the change on one line, and the fragment it has
  const brief = motionBrief({ stage: STAGE, seconds: 1.7, words: SPACE_WORDS, idea: ON_SPACE.spec.idea, about: ABOUT })
  expect(held.waiting[0]!.brief).toBe(editBrief({ brief, html: FRAGMENT, instruction: "ตัวเลข ใหญ่ขึ้น" }))
  expect(held.waiting[0]!.brief.split("\n")).toContain('"ตัวเลข ใหญ่ขึ้น"')
  held.waiting[0]!.answer(MENDED)
  expect(await editing).toEqual({ count: 1, dropped: 0 })
  // the change is kept as it was typed, trimmed; the graphic is still Claude's, and the other one is as it was
  expect(await h.graphics()).toEqual([
    { ...ON_SPACE, spec: { ...ON_SPACE.spec, html: MENDED, instruction: "ตัวเลข\n ใหญ่ขึ้น", previous: { html: FRAGMENT, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION } } },
    ON_COUNT,
  ])
  expect(progress.mock.calls).toEqual([[0, 1], [1, 1]])
  // one call and no plan
  expect(h.claude.requests.map((asked) => asked.system)).toEqual([MOTION_CONTRACT])
  // the machine was looked at afresh before the render, and the candidate rendered as the stored graphic is
  expect(renderer.forgetMachine).toHaveBeenCalledTimes(1)
  expect(renderer.forgetMachine.mock.invocationCallOrder[0]).toBeLessThan(renderer.wait.mock.invocationCallOrder[0]!)
  const { jobs } = await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)
  expect(renderer.wait.mock.calls).toEqual([[[jobs[0]], h.folder]])
  expect(renderer.ensure).not.toHaveBeenCalled()

  // edited again: Claude changes the fragment the first edit made, and the one kept is that one, with its change
  h.claude.replies.set(MOTION_CONTRACT, THIRD)
  expect(await h.flair.editGraphic(h.folder, ON_SPACE.anchor, "ช้าลง", DRAWN)).toEqual({ count: 1, dropped: 0 })
  expect(briefs(h.claude).at(-1)).toBe(editBrief({ brief, html: MENDED, instruction: "ช้าลง" }))
  expect((await h.graphics()).map((graphic) => graphic.spec)).toEqual([
    { ...ON_SPACE.spec, html: THIRD, instruction: "ช้าลง", previous: { html: MENDED, seconds: 1.7, words: SPACE_WORDS, version: MOTION_VERSION, instruction: "ตัวเลข\n ใหญ่ขึ้น" } },
    ON_COUNT.spec,
  ])
})

test("an edit that fails leaves the graphic as it was but for why: the problems left after the one repair, the first three a line each, or what a failed call said", async () => {
  // edited once already, so it has a change and a fragment kept, which stay
  const edited = { ...ON_SPACE, spec: { ...ON_SPACE.spec, instruction: "ใหญ่ขึ้น", previous: { html: MENDED, seconds: 2, words: [], version: MOTION_VERSION } } }
  const h = await withStored([edited, ON_COUNT])
  // the linter refuses what Claude wrote, and what the repair gave
  h.claude.replies.set(MOTION_CONTRACT, TIMER)
  expect(await h.flair.editGraphic(h.folder, edited.anchor, "เร็วขึ้น", DRAWN)).toEqual({ count: 0, dropped: 1 })
  expect(await h.graphics()).toEqual([{ ...edited, spec: { ...edited.spec, editFailed: lintFragment(TIMER).slice(0, 3).join("\n") } }, ON_COUNT])
  expect(briefs(h.claude)).toHaveLength(2)
  // the call runs out of time: said as it said it, and no repair is asked
  h.claude.replies.set(MOTION_CONTRACT, () => {
    throw new Error("timed out")
  })
  expect(await h.flair.editGraphic(h.folder, edited.anchor, "เร็วขึ้น", DRAWN)).toEqual({ count: 0, dropped: 1 })
  expect(await h.graphics()).toEqual([{ ...edited, spec: { ...edited.spec, editFailed: "timed out" } }, ON_COUNT])
  expect(briefs(h.claude)).toHaveLength(3)
})

test("an edit whose render still fails after the repair leaves the graphic as it was, with the render's reason", async () => {
  const renderer = fakeRenderer((html) => (html === FRAGMENT ? null : "nothing was drawn: every frame is empty"))
  const h = await withStored([ON_SPACE], { graphics: renderer, graphicsReady: async () => true })
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.editGraphic(h.folder, ON_SPACE.anchor, "เปลี่ยนสี", DRAWN)).toEqual({ count: 0, dropped: 1 })
  expect(await h.graphics()).toEqual([{ ...ON_SPACE, spec: { ...ON_SPACE.spec, editFailed: "nothing was drawn: every frame is empty" } }])
  // the repair was asked with the edit's brief as its first brief
  const edit = editBrief({ brief: motionBrief({ stage: STAGE, seconds: 1.7, words: SPACE_WORDS, idea: ON_SPACE.spec.idea, about: ABOUT }), html: FRAGMENT, instruction: "เปลี่ยนสี" })
  expect(briefs(h.claude)).toEqual([edit, repairBrief({ brief: edit, html: MENDED, problems: ["nothing was drawn: every frame is empty"] })])
})

test("a stop during an edit ends it as a stop, and nothing is stored: the graphic keeps its fragment and has no failure", async () => {
  const h = await withStored([ON_SPACE, ON_COUNT])
  const held = heldWriting(h.claude)
  const stop = new AbortController()
  const progress = vi.fn()
  const editing = outcomeOf(h.flair.editGraphic(h.folder, ON_SPACE.anchor, "ใหญ่ขึ้น", DRAWN, stop.signal, progress))
  await held.asked(1)
  stop.abort(new Error(CANCELLED))
  expect(await editing).toBe(CANCELLED)
  expect(await h.graphics()).toEqual([ON_SPACE, ON_COUNT])
  expect(progress.mock.calls).toEqual([[0, 1]])
})

test("a graphic with no place on the clip now is not edited, and neither is one not written yet; Claude is not asked and nothing changes", async () => {
  // its writing again failed: it has no fragment to change
  const unwritten = { ...ON_SPACE, spec: { ...ON_SPACE.spec, html: null, failed: "timed out", previous: keptOf(ON_SPACE.spec) } }
  const h = await withStored([unwritten, ON_COUNT])
  // the lightest level hides the countdown's point, which is secondary; nothing is stored at the other place
  const light = { ...DRAWN, view: { ...DRAWN.view, flair: { ...DRAWN.view.flair, level: "light" as const } } }
  await expect(h.flair.editGraphic(h.folder, ON_COUNT.anchor, "ใหญ่ขึ้น", light)).rejects.toThrow(/^this graphic has no place on the clip now$/)
  await expect(h.flair.editGraphic(h.folder, { kind: "speech", videoId: CLIP_ID, sourceUs: s(17.16), beatId: "beat-1" }, "ใหญ่ขึ้น", DRAWN)).rejects.toThrow(/^this graphic has no place on the clip now$/)
  await expect(h.flair.editGraphic(h.folder, unwritten.anchor, "ใหญ่ขึ้น", DRAWN)).rejects.toThrow(/^this graphic has not been written yet$/)
  expect(h.claude.requests).toEqual([])
  expect(await h.graphics()).toEqual([unwritten, ON_COUNT])
})

test("a graphic gone stale is fresh once edited: written for the words and the length it has now, and the fragment kept is the one written for the old ones", async () => {
  const h = await withStored([ON_COUNT])
  // the user cuts สอง: only สาม is said while the graphic plays, for the 1.5 s a graphic plays at the least
  await h.service.decide(h.folder, CLIP_ID, { type: "words", indexes: [9], keep: false })
  expect((await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)).kept).toMatchObject([{ stale: true }])
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.editGraphic(h.folder, ON_COUNT.anchor, "ใหญ่ขึ้น", DRAWN)).toEqual({ count: 1, dropped: 0 })
  const now = motionBrief({ stage: STAGE, seconds: 1.5, words: [{ text: "สาม", atS: 0 }], idea: ON_COUNT.spec.idea, about: ABOUT })
  expect(briefs(h.claude)).toEqual([editBrief({ brief: now, html: FRAGMENT, instruction: "ใหญ่ขึ้น" })])
  expect(await h.graphics()).toEqual([
    { ...ON_COUNT, spec: { ...ON_COUNT.spec, seconds: 1.5, words: [{ text: "สาม", atS: 0 }], html: MENDED, instruction: "ใหญ่ขึ้น", previous: { html: FRAGMENT, seconds: 2, words: COUNT_WORDS, version: MOTION_VERSION } } },
  ])
  const { kept: placed, jobs } = await h.highlights.graphicJobs(h.folder, DEFAULT_CUT_RULES, DRAWN.view)
  expect(placed).toMatchObject([{ durationUs: 1_500_000, stale: false }])
  expect(jobs).toMatchObject([{ spec: { html: MENDED }, times: [0] }])
})

test("an edit does not make a graphic the user's: a switched-off one of theirs stays theirs and off, and one of Claude's edited is replaced by Claude thinking the graphics again, with what it kept", async () => {
  const off = { ...ON_COUNT, off: true, edited: true }
  const h = await withStored([ON_SPACE, off])
  h.claude.replies.set(MOTION_CONTRACT, MENDED)
  expect(await h.flair.editGraphic(h.folder, off.anchor, "ใหญ่ขึ้น", DRAWN)).toEqual({ count: 1, dropped: 0 })
  expect(await h.flair.editGraphic(h.folder, ON_SPACE.anchor, "ใหญ่ขึ้น", DRAWN)).toEqual({ count: 1, dropped: 0 })
  expect((await h.graphics()).map((graphic) => [graphic.pointId, graphic.edited, graphic.off, isMotion(graphic.spec) && graphic.spec.instruction])).toEqual([
    ["p-space", false, false, "ใหญ่ขึ้น"],
    ["p-count", true, true, "ใหญ่ขึ้น"],
  ])
  // thought again, Claude's answer on อวกาศ takes the place of the one it edited, which goes with its change and the fragment it kept
  h.claude.replies.set(MOTION_PLAN_PROMPT.system, { graphics: [{ ...MOTION, point: 1, idea: "ดาวเทียม" }] })
  h.claude.replies.set(MOTION_CONTRACT, THIRD)
  await h.flair.planGraphics(h.folder, DRAWN)
  const replanned = (await h.graphics()).find((graphic) => graphic.pointId === "p-space")!
  expect(replanned.spec).toEqual({ kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 1.7, why: "ไปไหน", idea: "ดาวเทียม", words: SPACE_WORDS, html: THIRD })
})
