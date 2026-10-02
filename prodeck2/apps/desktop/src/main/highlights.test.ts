import { expect, test, vi } from "vitest"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import { layoutGroup } from "@boxblack/core/highlights"
import type { HighlightReply } from "@boxblack/core/highlights"
import type { Segment } from "@boxblack/core/capcut"
import type { Beat } from "@boxblack/core/planner"
import type { Scene } from "@boxblack/core/vision"
import type { InsertCue } from "@boxblack/core/flair/plan"
import type { EmphasisPoint } from "@boxblack/core/emphasis"
import { MOTION_VERSION, type GraphicCue, type GraphicSpec, type MotionSpec } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_FONTS, styleFor, type HighlightStyle } from "@boxblack/core/highlights/styles"
import { BUILT_IN_SOUNDS } from "@boxblack/core/flair/sound-catalogue"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import type { GraphicRenderState, StoredOutline } from "../shared/api.ts"
import { problemFor, type RenderJob } from "./graphics-render.ts"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { transcriptFingerprint } from "./footage.ts"
import { unbound, withoutPoint } from "./emphasis.ts"
import { createHighlightService } from "./highlights.ts"
import { hashOfHtml, type SoundStatus } from "./composed-cues.ts"
import type { SoundJob } from "./sound-render.ts"
import * as graphicsCues from "./graphics-cues.ts"

// the real module, with the placing of the graphics watched: one test counts how often a look at the preview places them
vi.mock("./graphics-cues.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graphics-cues.ts")>()
  return { ...actual, graphicsInForce: vi.fn(actual.graphicsInForce) }
})
import { CLIP_ID, countdown, fixturePoints, readInfo, s, segments, setup, storePoints, transcript } from "./timeline-fixture.ts"

// the fixture's transcript: ขึ้น(0) ไป(1) ใน(2) อวกาศ(3) ใน(4) สาม(5) สอง(6) หนึ่ง(7) | สาม(8) สอง(9) หนึ่ง(10)
// the first countdown (5–7) is cut as a retake, so the used sentences are words 0–4 and 8–10; the fixture's
// points are "ขึ้นไปในอวกาศ" (0–3) and the second countdown (8–10)
const PLAIN = { pattern: "stack" as const, tone: "base" as const, accentLine: 0, accentWord: "", exit: "" }
const REPLY: HighlightReply = {
  style: "headline",
  groups: [
    { point: 1, lines: [{ quote: "ขึ้นไป", text: "ขึ้นไป" }, { quote: "อวกาศ", text: "อวกาศ!" }], ...PLAIN },
    { point: 2, lines: [{ quote: "สาม", text: "3" }, { quote: "สอง", text: "2" }, { quote: "หนึ่ง", text: "1" }], ...PLAIN },
  ],
}
/** The plain look, as a group picked with PLAIN stores it. */
const PLAIN_LOOK = { pattern: "stack", tone: "base", accent: null, exit: null, edited: false }
/** Every exit animation, as the look popover may offer them with CapCut Pro. */
const EVERY_EXIT = [
  { id: "fade-out", name: "จางหายหลอน ๆ" },
  { id: "fade-dim", name: "จางหายหม่นหมอง" },
  { id: "fade-alt", name: "อัลเทอร์เนตเฟด" },
  { id: "spin-out", name: "หมุนหายไป" },
  { id: "burst-out", name: "แตกกระจาย" },
]
/** หมุนหายไป, an exit that needs CapCut Pro, as the writer names its resource. */
const SPIN_OUT = "7664531039884152084"
/** อัลเทอร์เนตเฟด, which needs CapCut Pro too (its cached entry said free; CapCut 9.5's export dialog did not). */
const FADE_ALT = "7646374090143567112"

function fakeClaude(reply: HighlightReply) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      return { output: claude.reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  const claude = { reply, requests, llm: async () => ({ transport, model: "claude-sonnet-5" }) }
  return claude
}

async function withHighlights(options: Parameters<typeof setup>[0] & { claude?: boolean; points?: EmphasisPoint[] } = {}) {
  const base = await setup(options)
  if (options.points) await storePoints(base.outlines, base.folder, options.points)
  const claude = fakeClaude(REPLY)
  let n = 0
  const highlights = createHighlightService({
    outlines: base.outlines,
    timeline: base.service,
    footage: base.deps,
    llm: options.claude === false ? undefined : claude.llm,
    // the library the timeline writes from, as the app hands both services one
    sounds: options.sounds,
    newId: () => `id${++n}`,
  })
  // the text is picked from emphasis points: a test that stored none picks from the fixture's two
  const pick: typeof highlights.pick = async (folder, rules, view, signal) => {
    if ((await base.outlines.get(folder))?.emphasis === undefined) await storePoints(base.outlines, folder, fixturePoints())
    return highlights.pick(folder, rules, view, signal)
  }
  return { ...base, highlights: { ...highlights, pick }, claude }
}

/** The user has not pinned a position, there are no subtitles, and only the text is on, unless a test says otherwise. */
const VIEW = { position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair: { enabled: false, level: "medium" as const, text: true, sound: false, zoom: false, insert: false, graphic: false } }

/** What the emphasis tab shows on the fixture with no point: its two sentences, and no scene (its one beat is speech). */
const NO_POINTS = {
  points: [],
  sentences: [
    { videoId: CLIP_ID, beatId: "beat-1", from: 0, to: 5, atUs: 150_000, words: ["ขึ้น", "ไป", "ใน", "อวกาศ", "ใน"] },
    { videoId: CLIP_ID, beatId: "beat-1", from: 8, to: 11, atUs: 2_920_000, words: ["สาม", "สอง", "หนึ่ง"] },
  ],
  scenes: [],
  hidden: 0,
  version: 0,
  changed: { techniques: false, graphics: false, sounds: false },
}

const textOf = (content: LlmContent[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n")

test("before any is picked there is no highlight text, the default style and a portrait line length", async () => {
  const { highlights, folder } = await withHighlights()
  expect(await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).toEqual({
    style: "bold-white",
    styleByAi: null,
    groups: [],
    hidden: 0,
    outlineChanged: false,
    needsPictures: true,
    maxChars: 12,
    landscape: false,
    cues: [],
    slots: [],
    sounds: [],
    unusedSounds: { unplaced: 0, missing: 0, lost: 0, pro: 0 },
    composed: [],
    ownSounds: [],
    zooms: [],
    moves: [],
    pieces: [],
    zoomsLost: 0,
    inserts: [],
    media: [],
    graphics: [],
    graphicsWaitForPack: false,
    graphicsProblem: null,
    soundsProblem: null,
    emphasis: NO_POINTS,
    exits: EVERY_EXIT,
    proLeftOut: { exits: 0, sounds: 0 },
  })
})

test("Claude picks from the emphasis points; each group carries its point, shows where its words play, and has the look chosen with it", async () => {
  const { highlights, folder, claude, outlines } = await withHighlights()
  const { preview, dropped } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(dropped).toBe(0)

  const request = textOf(claude.requests[0]!.content)
  // the cut starts 0.15 s before "ขึ้น" (17.16 s); the second piece starts 0.15 s before the second "สาม" (22.62 s), 2.92 s in
  expect(request).toContain('[1] คำพูด · สำคัญ · hook · ช่วง "นับถอยหลัง" 0:00.2 “ขึ้นไปในอวกาศ” ในประโยค “ขึ้นไปในอวกาศใน” · เหตุผล: เปิดคลิป')
  expect(request).toContain('[2] คำพูด · สำคัญ · ตัวเลข/ราคา · ช่วง "นับถอยหลัง" 0:02.9 “สามสองหนึ่ง” ในประโยค “สามสองหนึ่ง” · เหตุผล: นับถอยหลัง')
  expect(request).toContain("ไม่เกิน 12 ตัวอักษร")

  expect(preview).toMatchObject({
    style: "headline",
    styleByAi: "headline",
    hidden: 0,
    outlineChanged: false,
    // the fixture clip has no pictures analysed
    needsPictures: true,
    maxChars: 12,
    landscape: false,
    groups: [
      {
        id: "id1",
        beatId: "beat-1",
        source: "ai",
        pointId: "p1",
        placement: "no-picture",
        look: PLAIN_LOOK,
        startUs: 150_000,
        // "อวกาศ!" shows at 1.07 s and stays at least 1 s
        endUs: 2_070_000,
        lines: [
          { index: 0, text: "ขึ้นไป", startUs: 150_000, partial: false },
          { index: 1, text: "อวกาศ!", startUs: 1_070_000, partial: false },
        ],
      },
      {
        id: "id2",
        beatId: "beat-1",
        source: "ai",
        pointId: "p2",
        placement: "no-picture",
        look: PLAIN_LOOK,
        startUs: 2_920_000,
        // the timeline ends at 5.7 s
        endUs: 5_700_000,
        lines: [
          { index: 0, text: "3", startUs: 2_920_000, partial: false },
          { index: 1, text: "2", startUs: 4_180_000, partial: false },
          { index: 2, text: "1", startUs: 5_140_000, partial: false },
        ],
      },
    ],
  })
  // words said, not labels
  expect(preview.groups.some((group) => group.scene)).toBe(false)
  // the emphasis tab counts each group as the text on its point
  expect(preview.emphasis.points.map((point) => [point.id, point.items.text])).toEqual([
    ["p1", 1],
    ["p2", 1],
  ])

  const stored = (await outlines.get(folder))!
  expect(stored.highlights).toMatchObject({ style: null, styleByAi: "headline", transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } })
  expect(stored.highlights!.beatsKey).toEqual(expect.any(String))
  expect(stored.highlights!.groups.map((group) => [group.pointId, group.lines.map((line) => [line.from, line.to])])).toEqual([
    ["p1", [[0, 2], [3, 4]]],
    ["p2", [[8, 9], [9, 10], [10, 11]]],
  ])
  // each group's look is stored with it
  expect(stored.flair!.looks).toEqual({ id1: PLAIN_LOOK, id2: PLAIN_LOOK })
})

test("picking again replaces Claude's groups, keeps the ones the user made or edited, and keeps the user's style", async () => {
  const { highlights, folder } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const again = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(again.preview.groups.map((group) => group.id)).toEqual(["id3", "id4"])

  await highlights.editLine(folder, "id3", 1, "ไปอวกาศ")
  await highlights.removeGroup(folder, "id4")
  await highlights.addFromWords(folder, CLIP_ID, [8, 9, 10], 12)
  await highlights.setStyle(folder, "cute-pink")
  const third = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  // both new groups fall on words the kept groups already show
  expect(third.dropped).toBe(5)
  expect(third.preview.groups.map((group) => [group.id, group.source, group.lines.map((line) => line.text)])).toEqual([
    ["id3", "ai", ["ขึ้นไป", "ไปอวกาศ"]],
    ["id5", "user", ["สามสองหนึ่ง"]],
  ])
  expect(third.preview.style).toBe("cute-pink")
  expect(third.preview.styleByAi).toBe("headline")
})

test("lines can be edited and removed; a group with no line left goes", async () => {
  const { highlights, folder, outlines } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await highlights.editLine(folder, "id2", 0, "  สาม ")
  await highlights.editLine(folder, "id1", 0, null)
  let stored = (await outlines.get(folder))!.highlights!
  expect(stored.groups.map((group) => [group.id, group.edited, group.lines.map((line) => line.text)])).toEqual([
    ["id1", true, ["อวกาศ!"]],
    ["id2", true, ["สาม", "2", "1"]],
  ])
  await highlights.editLine(folder, "id1", 0, null)
  stored = (await outlines.get(folder))!.highlights!
  expect(stored.groups.map((group) => group.id)).toEqual(["id2"])
  await highlights.removeGroup(folder, "id2")
  expect((await outlines.get(folder))!.highlights!.groups).toEqual([])

  await expect(highlights.editLine(folder, "nope", 0, "x")).rejects.toThrow(/unknown highlight/)
  await expect(highlights.editLine(folder, "id2", 3, "x")).rejects.toThrow(/unknown highlight/)
  await expect(highlights.editLine(folder, "id2", 0, "   ")).rejects.toThrow(/empty/)
  await expect(highlights.removeGroup(folder, "nope")).rejects.toThrow(/unknown highlight/)
})

test("the user can make a group from words; bad requests are refused", async () => {
  const { highlights, folder, outlines } = await withHighlights({ claude: false })
  await highlights.addFromWords(folder, CLIP_ID, [0, 1, 2, 3, 4], 12)
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.groups.map((group) => [group.source, group.lines.map((line) => line.text)])).toEqual([["user", ["ขึ้นไปใน", "อวกาศใน"]]])
  // the beat the words were picked in goes with them, for footage that plays twice
  await highlights.addFromWords(folder, CLIP_ID, [8], 12, "beat-1")
  expect((await outlines.get(folder))!.highlights!.groups.at(-1)).toMatchObject({ source: "user", beatId: "beat-1" })

  await expect(highlights.addFromWords(folder, "other", [0], 12)).rejects.toThrow(/not in this outline/)
  await expect(highlights.addFromWords(folder, CLIP_ID, [0], 30)).rejects.toThrow(/line length/)
  await expect(highlights.addFromWords(folder, CLIP_ID, [40, -1], 12)).rejects.toThrow(/no words/)
  await expect(highlights.setStyle(folder, "neon" as never)).rejects.toThrow(/unknown style/)
})

test("groups whose words are cut are hidden, not forgotten, and a changed outline is pointed out", async () => {
  const { highlights, folder, service, outlines } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4], keep: false })
  let preview = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.groups.map((group) => group.id)).toEqual(["id2"])
  // id1's point is cut away with its words, so the point filter holds id1 back and it is not counted
  expect(preview.hidden).toBe(0)
  // a group bound to no point is counted while its words are cut
  await outlines.update(folder, (stored) => ({ ...stored!, highlights: { ...stored!.highlights!, groups: stored!.highlights!.groups.map(unbound) } }))
  preview = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.groups.map((group) => group.id)).toEqual(["id2"])
  expect(preview.hidden).toBe(1)
  expect(preview.outlineChanged).toBe(false)

  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4], keep: null })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).groups).toHaveLength(2)

  const stored = (await outlines.get(folder))!
  await outlines.put({ ...stored, outline: { ...stored.outline, beats: stored.outline.beats.map((beat) => ({ ...beat, endUs: s(24.5) })) } })
  preview = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.outlineChanged).toBe(true)
  // "หนึ่ง" at 24.84 s is no longer in the beat
  expect(preview.groups[1]!.lines.map((line) => line.text)).toEqual(["3", "2"])
})

test("groups made on another transcript of the video are ignored, and dropped once new ones are made", async () => {
  const { highlights, folder, deps, outlines } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const media = (await deps.inspect(folder)).videos[0]!.path
  await deps.transcripts.put(media, { engine: "whisper-local", model: "large-v3-q5_0", language: "th" }, { ...transcript, words: transcript.words.map((w) => ({ ...w, endUs: w.endUs - 1 })) })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.groups).toEqual([])
  // their points' words belong to the earlier transcript too, so the point filter holds the groups back uncounted
  expect(preview.hidden).toBe(0)
  // groups bound to no point are counted
  await outlines.update(folder, (stored) => ({ ...stored!, highlights: { ...stored!.highlights!, groups: stored!.highlights!.groups.map(unbound) } }))
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).hidden).toBe(2)

  await highlights.addFromWords(folder, CLIP_ID, [8], 12)
  expect((await outlines.get(folder))!.highlights!.groups.map((group) => group.source)).toEqual(["user"])
})

test("without a Claude connection nothing is picked", async () => {
  const { highlights, folder } = await withHighlights({ claude: false })
  await expect(highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)).rejects.toThrow(/not ready/)
})

test("subtitles can leave out the words shown as highlight text", async () => {
  const { highlights, folder, service } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line", false)).map((line) => line.text)).toEqual(["ขึ้นไปในอวกาศใน", "สามสองหนึ่ง"])
  // the groups cover ขึ้นไป…อวกาศ (0–3) and สาม…หนึ่ง (8–10); only "ใน" is left
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line", true)).map((line) => line.text)).toEqual(["ใน"])
})

const assets = {
  fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`,
  animationPath: async (id: string) => `/effect/${id}/hash`,
}

test("writing adds the groups above the subtitles, in the style's font, stacked where the user put them", async () => {
  const { highlights, folder, service } = await withHighlights({ highlightAssets: assets })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "line", texts: ["ใน"] }, { position: "bottom", hideSubtitles: true, highlightsOn: true, groupCount: 2, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })

  const info = await readInfo(folder)
  expect(info.tracks.map((track) => [track.type, track.flag])).toEqual([
    ["video", 0],
    ["text", 1],
    ["text", 0],
    ["text", 0],
    ["text", 0],
  ])
  expect(result).toMatchObject({ captionCount: 1, highlightCount: 5, soundCount: 0, zoomCount: 0, insertCount: 0, segmentCount: 8 })

  const texts = info.materials.texts as { id: string; content: string; font_path: string }[]
  const animations = info.materials.material_animations as { id: string; animations: { path: string; resource_id: string }[] }[]
  const [line1, line2, line3] = info.tracks.slice(2)
  const position = (segment: Segment) => {
    const clip = segment.clip as { transform: { y: number }; scale: { x: number } }
    return { y: clip.transform.y, scale: clip.scale.x }
  }
  const shown = (segment: Segment) => {
    const material = texts.find((text) => text.id === segment.material_id)!
    return { text: JSON.parse(material.content).text as string, font: material.font_path, ...position(segment) }
  }
  // headline style: Chonburi, curtain-up animation
  const countdown = layoutGroup(["3", "2", "1"], "chonburi", { width: 1080, height: 1920 }, { kind: "fixed", position: "bottom" }).lines
  expect([line1!.segments[1]!, line2!.segments[1]!, line3!.segments[0]!].map(shown)).toEqual(
    ["3", "2", "1"].map((text, i) => ({ text, font: "/Movies/CapCut/boxblack/fonts/chonburi.ttf", y: countdown[i]!.y, scale: countdown[i]!.scale })),
  )
  expect(shown(line1!.segments[0]!).text).toBe("ขึ้นไป")
  const animation = animations.find((entry) => entry.id === line1!.segments[0]!.extra_material_refs[0])!
  expect(animation.animations[0]).toMatchObject({ resource_id: "7643711191419833618", path: "/effect/7643711191419833618/hash" })
})

test("highlight text that changed since it was shown is refused before anything is backed up", async () => {
  const { highlights, folder, service, deps } = await withHighlights({ highlightAssets: assets })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "top", hideSubtitles: false, highlightsOn: true, groupCount: 3, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })).rejects.toThrow(/highlight text changed/)
  expect(segments(await readInfo(folder))).toBe(0)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("writing no highlight text needs no fonts", async () => {
  const { folder, service } = await withHighlights()
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: 0, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })
  expect(result).toMatchObject({ highlightCount: 0, captionCount: 0, segmentCount: 2 })
})

test("each point is shown with its weight, type, beat, its time on the rough cut and the sentence it is said in", async () => {
  const beats = [
    { ...countdown, id: "beat-1", name: "ขึ้นไป", toIndex: 0, startUs: s(17.16), endUs: s(18.75) },
    { ...countdown, id: "beat-2", name: "นับ", fromIndex: 1, toIndex: 2, startUs: s(21.56), endUs: s(25.25) },
  ]
  const points: EmphasisPoint[] = [
    { id: "p1", anchor: { kind: "speech", videoId: CLIP_ID, from: 0, to: 4, beatId: "beat-1" }, importance: "key", type: "hook", reason: "", source: "ai", edited: false },
    { id: "p2", anchor: { kind: "speech", videoId: CLIP_ID, from: 8, to: 11, beatId: "beat-2" }, importance: "extra", type: "action", reason: "ลุ้น", source: "user", edited: false },
  ]
  const { highlights, folder, claude, service } = await withHighlights({ beats, points })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const request = textOf(claude.requests[0]!.content)
  // where a word starts on the rough cut: the pieces play back to back
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  const playsAt = (index: number) => {
    const word = transcript.words[index]!
    let offset = 0
    for (const cut of plan.cuts) {
      const mid = (word.startUs + word.endUs) / 2
      if (mid >= cut.sourceStartUs && mid < cut.sourceStartUs + cut.sourceDurationUs) return offset + word.startUs - cut.sourceStartUs
      offset += cut.sourceDurationUs
    }
    throw new Error(`word ${index} is not played`)
  }
  const clock = (us: number) => `0:${(Math.round(us / 100_000) / 10).toFixed(1).padStart(4, "0")}`
  // a point with no reason says none
  expect(request).toContain(`[1] คำพูด · สำคัญ · hook · ช่วง "ขึ้นไป" ${clock(playsAt(0))} “ขึ้นไปในอวกาศ” ในประโยค “ขึ้นไปในอวกาศ”\n`)
  expect(request).toContain(`[2] คำพูด · เสริม · การกระทำ · ช่วง "นับ" ${clock(playsAt(8))} “สามสองหนึ่ง” ในประโยค “สามสองหนึ่ง” · เหตุผล: ลุ้น`)
  // the second beat starts after the first beat's 1.7 s
  expect(playsAt(8)).toBeGreaterThan(1_500_000)
})

test("a point whose words are all cut is not offered; kept again, it is", async () => {
  const { highlights, folder, claude, service } = await withHighlights()
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4], keep: false })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const first = textOf(claude.requests[0]!.content)
  expect(first).toContain("[1] คำพูด · สำคัญ · ตัวเลข/ราคา")
  expect(first).not.toContain("[2]")

  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4], keep: null })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(textOf(claude.requests[1]!.content)).toContain("[2] คำพูด · สำคัญ · ตัวเลข/ราคา")
})

test("lines may be longer when the rough cut plays landscape", async () => {
  const { highlights, folder, root, claude } = await withHighlights()
  // make the clip in the draft's media bin landscape; the rough cut follows its first clip
  const metaFile = join(root, "0917", "draft_meta_info.json")
  const meta = JSON.parse(await readFile(metaFile, "utf8")) as { draft_materials: { value: { width: number; height: number }[] }[] }
  for (const item of meta.draft_materials.flatMap((group) => group.value)) if (item.width === 1080) Object.assign(item, { width: 1920, height: 1080 })
  await writeFile(metaFile, JSON.stringify(meta))
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).maxChars).toBe(18)
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(textOf(claude.requests[0]!.content)).toContain("ไม่เกิน 18 ตัวอักษร")
})

test("writing highlight text without its fonts is refused before anything is backed up", async () => {
  const { highlights, folder, service, deps } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "top", hideSubtitles: false, highlightsOn: true, groupCount: 2, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })).rejects.toThrow(/fonts are missing/)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

const scene = (startS: number, endS: number, keepClear: { fromY: number; toY: number } | null): Scene => ({
  startUs: s(startS),
  endUs: s(endS),
  description: "ชายหนุ่มพูดกับกล้อง",
  kind: "talking-head",
  issues: [],
  keepClear,
})

test("a group dodges the band every scene it plays over wants kept clear", async () => {
  // the face sits high in the first scene and low in the second; group 2 plays over both
  const scenes = [scene(0, 23, { fromY: 0.05, toY: 0.4 }), scene(23, 31, { fromY: 0.55, toY: 0.9 })]
  const { highlights, folder } = await withHighlights({ scenes })
  const { preview } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.needsPictures).toBe(false)
  // group 1 is inside the first scene: the face is high, so its text goes under it
  expect(preview.groups[0]!.placement).toBe("below")
  // group 2 crosses into the second scene, so both faces are dodged and nothing is left clear
  expect(preview.groups[1]!.placement).toBe("over")
})

test("a face low in the frame leaves the text where it always sits", async () => {
  const { highlights, folder } = await withHighlights({ scenes: [scene(0, 31, { fromY: 0.5, toY: 0.95 })] })
  const { preview } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.groups.map((group) => group.placement)).toEqual(["above", "above"])
})

test("a scene with nothing to keep clear, or a pinned position, places the text as before", async () => {
  const { highlights, folder } = await withHighlights({ scenes: [scene(0, 31, null)] })
  const { preview } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.needsPictures).toBe(false)
  expect(preview.groups.map((group) => group.placement)).toEqual(["no-picture", "no-picture"])

  const pinned = await highlights.preview(folder, DEFAULT_CUT_RULES, { position: "middle", subtitlesOn: false, highlightsOn: true, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })
  expect(pinned.groups.map((group) => group.placement)).toEqual(["fixed", "fixed"])
  expect(pinned.needsPictures).toBe(false)
})

test("the preview lays the text out as the write does, without the spaces around a line", async () => {
  const keepClear = { fromY: 0.05, toY: 0.85 }
  const { highlights, folder, outlines } = await withHighlights({ scenes: [scene(0, 31, keepClear)] })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const stored = (await outlines.get(folder))!
  const pad = " ".repeat(40)
  const groups = stored.highlights!.groups.map((group, i) => (i === 0 ? { ...group, lines: group.lines.map((line) => ({ ...line, text: `${line.text}${pad}` })) } : group))
  await outlines.put({ ...stored, highlights: { ...stored.highlights!, groups } })
  // laid out with its spaces the text would be narrow enough to fit under the face; the write trims them and covers it
  const written = layoutGroup(["ขึ้นไป", "อวกาศ!"], "chonburi", { width: 1080, height: 1920 }, { kind: "auto", keepClear, keepSubtitleRoom: false }).dodge
  expect(written).toBe("over")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).groups[0]!.placement).toBe(written)
})

test("a clip with no pictures analysed says so, and only while the placement is automatic", async () => {
  const { highlights, folder } = await withHighlights()
  const { preview } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.needsPictures).toBe(true)
  expect(preview.groups.map((group) => group.placement)).toEqual(["no-picture", "no-picture"])
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, { position: "top", subtitlesOn: false, highlightsOn: true, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })).needsPictures).toBe(false)
})

test("the write puts the groups where the preview said", async () => {
  const scenes = [scene(0, 31, { fromY: 0.05, toY: 0.4 })]
  const { highlights, folder, service } = await withHighlights({ scenes, highlightAssets: assets })
  const { preview } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(preview.groups[0]!.placement).toBe("below")
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 2, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })

  const info = await readInfo(folder)
  const firstLine = info.tracks.find((track) => track.type === "text" && track.flag === 0)!.segments[0]!
  const below = layoutGroup(["ขึ้นไป", "อวกาศ!"], "chonburi", { width: 1080, height: 1920 }, { kind: "auto", keepClear: { fromY: 0.05, toY: 0.4 }, keepSubtitleRoom: false })
  expect((firstLine.clip as { transform: { y: number } }).transform.y).toBeCloseTo(below.lines[0]!.y, 6)
  expect(below.dodge).toBe("below")
})

test("the text keeps off the face where a move pushes it in, in the preview and in the write alike; with no move it is placed as before", async () => {
  // the face from 0.2 to 0.75 of the height leaves room for the text under it; pushed in to 1.3 about the middle it
  // reaches 0.11–0.825, and the text has nowhere left to go but over it
  const keepClear = { fromY: 0.2, toY: 0.75 }
  const { highlights, folder, outlines, service } = await withHighlights({ scenes: [scene(0, 31, keepClear)], highlightAssets: assets })
  const zoomOn = { ...VIEW, flair: { ...VIEW.flair, zoom: true } }
  const { preview } = await highlights.pick(folder, DEFAULT_CUT_RULES, zoomOn)
  expect(preview.groups[0]!.placement).toBe("below")
  const stored = (await outlines.get(folder))!
  const punch = { anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(17.16), beatId: "beat-1" }, from: "medium" as const, about: "ดันเข้า", poses: [{ s: 0, scale: 1.3, x: 0, y: 0, rot: 0, ease: "cut" as const }], edited: false, off: false }
  await outlines.put({ ...stored, flair: { looks: {}, ...stored.flair, moves: [punch] } })
  const moved = await highlights.preview(folder, DEFAULT_CUT_RULES, zoomOn)
  expect(moved.moves).toHaveLength(1)
  expect(moved.groups[0]!.placement).toBe("over")
  // with the zooms off no move plays, and the text is placed as before
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).groups[0]!.placement).toBe("below")

  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 2, flair: zoomOn.flair })
  const info = await readInfo(folder)
  const firstLine = info.tracks.find((track) => track.type === "text" && track.flag === 0)!.segments[0]!
  const over = layoutGroup(["ขึ้นไป", "อวกาศ!"], "chonburi", { width: 1080, height: 1920 }, { kind: "auto", keepClear: { fromY: 0.11, toY: 0.825 }, keepSubtitleRoom: false })
  expect(over.dodge).toBe("over")
  expect((firstLine.clip as { transform: { y: number } }).transform.y).toBeCloseTo(over.lines[0]!.y, 2)
})

/** A service whose Claude answers `reply` only once `release` is called; `asked` settles when the call is made. */
function heldClaude(base: Awaited<ReturnType<typeof setup>>, reply: HighlightReply) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let settle!: () => void
  const asked = new Promise<void>((resolve) => (settle = resolve))
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(): Promise<LlmResponse<T>> {
      settle()
      await gate
      return { output: reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  let n = 0
  const highlights = createHighlightService({ outlines: base.outlines, timeline: base.service, footage: base.deps, llm: async () => ({ transport, model: "m" }), newId: () => `id${++n}` })
  return { highlights, asked, release: () => release() }
}

test("what the user does while Claude picks is still there when the pick lands", async () => {
  const base = await setup({})
  await storePoints(base.outlines, base.folder, fixturePoints())
  const { highlights, asked, release } = heldClaude(base, { style: "headline", groups: [{ point: 1, lines: [{ quote: "ขึ้นไป", text: "ขึ้นไป" }], ...PLAIN }] })
  const picking = highlights.pick(base.folder, DEFAULT_CUT_RULES, VIEW)
  await asked
  // while Claude thinks, the user keeps the cut countdown and makes a group of their own
  await base.service.decide(base.folder, CLIP_ID, { type: "words", indexes: [5, 6, 7], keep: true })
  await highlights.addFromWords(base.folder, CLIP_ID, [8, 9, 10], 12, "beat-1")
  release()
  const { preview } = await picking
  const after = (await base.outlines.get(base.folder))!
  expect(after.cutDecisions?.[CLIP_ID]?.keepWords).toEqual([5, 6, 7])
  expect(after.highlights!.groups.map((group) => group.source).sort()).toEqual(["ai", "user"])
  expect(preview.groups.map((group) => group.source).sort()).toEqual(["ai", "user"])
})

test("a point deleted while Claude picks takes the text made for it away", async () => {
  const base = await setup({})
  await storePoints(base.outlines, base.folder, fixturePoints())
  const { highlights, asked, release } = heldClaude(base, REPLY)
  const picking = highlights.pick(base.folder, DEFAULT_CUT_RULES, VIEW)
  await asked
  await base.outlines.update(base.folder, (stored) => ({ ...stored!, emphasis: { ...stored!.emphasis!, points: stored!.emphasis!.points.filter((point) => point.id !== "p1") } }))
  release()
  await picking
  expect((await base.outlines.get(base.folder))!.highlights!.groups.map((group) => group.pointId)).toEqual(["p2"])
})

/* graphics */

const GRAPHICS_ON = { position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair: { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: true } }
/** A fragment the linter passes, as a writing answers. */
const FRAGMENT = '<style>.r{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="r">อวกาศ</div>'
/**
 * A graphic as its plan leaves it, not written yet, for 2 s: it is placed by every rule a graphic is placed by, has
 * nothing to go stale, and has no render job until it is written. Its box is clear of the fixture's highlight text
 * (0.14–0.41 of the height once picked) and of the subtitles' room (from 0.76).
 */
const SPEC: MotionSpec = {
  kind: "motion",
  version: MOTION_VERSION,
  box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.72 },
  seconds: 2,
  why: "ชี้ว่าไปไหน",
  idea: "จรวดพุ่งขึ้นไปอวกาศ",
  words: [],
  html: null,
}
/** In the subtitles' room. */
const LOW = { x0: 0.1, y0: 0.8, x1: 0.9, y1: 0.9 }
/** A graphic on a moment of speech of the fixture's one beat: อวกาศ at 18.08 s is in the first sentence, สาม at 22.62 s starts the second. */
const graphicAt = (sourceUs: number, extra: Partial<GraphicCue> = {}): GraphicCue => ({ anchor: { kind: "speech", videoId: CLIP_ID, sourceUs, beatId: "beat-1" }, spec: SPEC, edited: false, off: false, ...extra })
/** What the fake styleOf hands out: the custom style, in colours no shipped style has. */
const STYLE: HighlightStyle = styleFor("custom", { text: [0, 1, 0], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0, 0, 0] })
/** What the renderer is asked for on the fixture: its portrait frame at the draft's 30 fps, in the style's font and colours. */
const jobOf = (spec: GraphicSpec): RenderJob => ({ spec, canvas: { width: 1080, height: 1920 }, fps: 30, font: { family: "Kanit", file: HIGHLIGHT_FONTS.kanit }, palette: STYLE.palette })
const POSTER = "data:image/png;base64,UE5H"

/**
 * A renderer that knows jobs by their whole content, the times of a graphic's words included: the ones it made, and the ones that failed and why. Like the real one, it cannot hash a job that is not there.
 * `problem` is what a render found wrong with the machine, which stops every graphic.
 */
function fakeRenderer(made: RenderJob[] = [], failed: [RenderJob, string][] = [], problem: string | null = null) {
  const hashOf = (job: RenderJob) => JSON.stringify([job.spec, job.canvas, job.fps, job.font, job.palette, job.times ?? null])
  const ready = new Set(made.map(hashOf))
  const errors = new Map(failed.map(([job, error]) => [hashOf(job), error]))
  return {
    hashOf,
    statusOf: async (hash: string): Promise<GraphicRenderState> => (ready.has(hash) ? "ready" : errors.has(hash) ? "failed" : "waiting"),
    posterOf: async (hash: string) => (ready.has(hash) ? POSTER : null),
    failureOf: (hash: string) => errors.get(hash) ?? null,
    ensure: vi.fn<(jobs: RenderJob[], folder: string) => void>(),
    environmentProblem: vi.fn(() => problemFor(problem)),
  }
}

const PICTURE = { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo" as const, width: 3024, height: 4032, durationUs: 5_000_000 }

async function withGraphics(
  graphics: GraphicCue[],
  extra: {
    renderer?: ReturnType<typeof fakeRenderer> | null
    /** null: the service is not told whether the pack is installed */
    packReady?: boolean | null
    /** false: the service has no style to draw the graphics in */
    styled?: boolean
    inserts?: InsertCue[]
    scenes?: Scene[]
    /** the outline's beats, when not the fixture's one */
    beats?: Beat[]
  } = {},
) {
  const base = await setup({ ...(extra.scenes ? { scenes: extra.scenes } : {}), ...(extra.beats ? { beats: extra.beats } : {}) })
  const renderer = extra.renderer === undefined ? fakeRenderer() : extra.renderer
  const styleOf = vi.fn(async () => STYLE)
  let n = 0
  const highlights = createHighlightService({
    outlines: base.outlines,
    timeline: base.service,
    footage: base.deps,
    llm: fakeClaude(REPLY).llm,
    newId: () => `id${++n}`,
    media: { list: async () => [PICTURE] },
    ...(renderer ? { graphics: renderer } : {}),
    ...(renderer && extra.styled !== false ? { styleOf } : {}),
    ...(extra.packReady === null ? {} : { graphicsReady: async () => extra.packReady ?? true }),
  })
  await base.outlines.update(base.folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics, inserts: extra.inserts ?? [] } }))
  return { ...base, highlights, renderer: renderer!, styleOf }
}

/**
 * The graphic on อวกาศ as its writing stored it: written for the 1.7 s it has there, from 1.07 s until its piece ends at
 * 2.77 s, where the retake is cut, and for the two words said in them, อวกาศ as it starts and ใน 0.92 s in.
 */
const ON_SPACE: MotionSpec = { ...SPEC, seconds: 1.7, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], html: FRAGMENT }
/** Its render job on the fixture: the times its words are said at now are the ones it was written with. */
const spaceJob = (spec: MotionSpec = ON_SPACE): RenderJob => ({ ...jobOf(spec), times: [0, 0.92] })
/** The written graphic, stored on อวกาศ. */
const onSpace = (extra: Partial<GraphicCue> = {}): GraphicCue => graphicAt(s(18.08), { spec: ON_SPACE, ...extra })

test("the preview lists the graphics that play, with what the renderer has made of them, and starts the ones not made", async () => {
  const { highlights, folder, renderer, styleOf, outlines } = await withGraphics([onSpace()], { renderer: fakeRenderer([spaceJob()]) })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphicsWaitForPack).toBe(false)
  expect(preview.graphicsProblem).toBeNull()
  expect(preview.graphics).toEqual([
    {
      anchor: graphicAt(s(18.08)).anchor,
      // อวกาศ plays 1.07 s into the rough cut, and its piece ends at 2.77 s
      atUs: 1_070_000,
      durationUs: 1_700_000,
      what: "ที่ “ขึ้นไปในอวกาศใน” ตรงคำว่า “อวกาศ”",
      beatId: "beat-1",
      why: "ชี้ว่าไปไหน",
      summary: "จรวดพุ่งขึ้นไปอวกาศ",
      spec: ON_SPACE,
      written: true,
      stale: false,
      writeFailed: null,
      instruction: null,
      editFailed: null,
      canUndo: false,
      render: "ready",
      poster: POSTER,
      error: null,
      edited: false,
      off: false,
      // made for no point and planned before 0.7.0: no level of its own, and no text's place to take
      from: null,
      replaces: false,
      coversKeep: false,
    },
  ])
  // one job per graphic that plays, drawn in the style the stored outline has, with the times its words are said at
  expect(renderer.ensure).toHaveBeenCalledTimes(1)
  expect(renderer.ensure).toHaveBeenCalledWith([spaceJob()], folder)
  expect(styleOf).toHaveBeenCalledWith(await outlines.get(folder))
})

test("a graphic whose render failed says why, with no poster", async () => {
  const { highlights, folder } = await withGraphics([onSpace()], { renderer: fakeRenderer([], [[spaceJob(), "Chrome crashed"]]) })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphics).toMatchObject([{ render: "failed", poster: null, error: "Chrome crashed" }])
})

test("without the renderer pack nothing is started, and the preview says the graphics wait for it", async () => {
  const { highlights, folder, renderer } = await withGraphics([onSpace()], { packReady: false })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphicsWaitForPack).toBe(true)
  expect(preview.graphics).toMatchObject([{ anchor: graphicAt(s(18.08)).anchor, render: "waiting", poster: null, error: null }])
  expect(renderer.ensure).not.toHaveBeenCalled()

  // with the graphics off there are none and nothing waits
  const off = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...GRAPHICS_ON, flair: { ...GRAPHICS_ON.flair, graphic: false } })
  expect([off.graphics, off.graphicsWaitForPack]).toEqual([[], false])
})

test("a machine a render found unfit to render on says why, and its graphics wait rather than fail", async () => {
  const problem = "the graphics renderer is damaged: reinstall it in settings (chrome-headless-shell is missing)"
  // the app counts the renderer not ready while it has a problem
  const { highlights, folder, renderer } = await withGraphics([onSpace()], { renderer: fakeRenderer([], [], problem), packReady: false })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphicsProblem).toEqual({ text: problem })
  expect(preview.graphics).toMatchObject([{ render: "waiting", poster: null, error: null }])
  expect(renderer.ensure).not.toHaveBeenCalled()
  // with the graphics off there is nothing to say
  const off = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...GRAPHICS_ON, flair: { ...GRAPHICS_ON.flair, graphic: false } })
  expect(off.graphicsProblem).toBeNull()
})

test("with no renderer the graphics are still listed, waiting", async () => {
  const { highlights, folder } = await withGraphics([onSpace()], { renderer: null })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphics).toMatchObject([{ anchor: graphicAt(s(18.08)).anchor, render: "waiting", poster: null, error: null }])
})

test("a graphic switched off is listed after the ones that play, so it can be switched on again, and nothing is rendered for it", async () => {
  const off = onSpace({ off: true, edited: true })
  const on = graphicAt(s(22.62), { spec: COUNTDOWN })
  // the renderer made the switched-off one earlier: it shows as off all the same
  const { highlights, folder, renderer } = await withGraphics([off, on], { renderer: fakeRenderer([spaceJob()]) })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphics.map((graphic) => [graphic.anchor, graphic.off, graphic.render, graphic.poster, graphic.error])).toEqual([
    [on.anchor, false, "waiting", null, null],
    [off.anchor, true, "waiting", null, null],
  ])
  expect(renderer.ensure).toHaveBeenCalledWith([motionJob(COUNTDOWN, [0, 1.26])], folder)
})

test("a graphic plays over a cutaway the preview plays: the write puts each on a track of its own", async () => {
  const insert: InsertCue = { anchor: graphicAt(s(18.08)).anchor, binId: "m1", edited: true, fit: "cover", subject: null }
  const { highlights, folder } = await withGraphics([graphicAt(s(18.08))], { inserts: [insert] })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.inserts).toHaveLength(1)
  expect(preview.graphics).toHaveLength(1)
  expect(preview.graphics[0]!.atUs).toBe(preview.inserts[0]!.atUs)
})

test("a graphic is moved off the highlight text of its sentence, as its plan was, and rendered where it moved to", async () => {
  const overText = { ...ON_SPACE, box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.32 } }
  const { highlights, folder, renderer, outlines } = await withGraphics([graphicAt(s(18.08), { spec: overText })])
  await storePoints(outlines, folder, fixturePoints())
  const boxOf = async () => (await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics[0]!.spec.box
  // no highlight text yet: it stays where it was put
  expect(await boxOf()).toEqual(overText.box)
  // the first sentence's text is drawn over 0.14–0.41 of the frame's height
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const moved = await boxOf()
  expect(moved.y1 <= 0.14 || moved.y0 >= 0.41).toBe(true)
  expect(renderer.ensure).toHaveBeenLastCalledWith([spaceJob({ ...overText, box: moved })], folder)
})

test("a graphic made for a point is not moved off that point's own highlight text, and is rendered where it was planned; made for another point, it keeps off it", async () => {
  const overText = { ...ON_SPACE, box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.32 } }
  const { highlights, folder, renderer, outlines } = await withGraphics([graphicAt(s(18.08), { spec: overText, pointId: "p1" })])
  await storePoints(outlines, folder, fixturePoints())
  // the first sentence's text, made for p1, is drawn over 0.14–0.41 of the frame's height, where the graphic was planned
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const boxOf = async () => (await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics[0]!.spec.box
  expect(await boxOf()).toEqual(overText.box)
  expect(renderer.ensure).toHaveBeenLastCalledWith([spaceJob(overText)], folder)
  // the jobs a write waits for are the same
  expect((await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).jobs).toEqual([spaceJob(overText)])
  // the same graphic made for the countdown's point keeps off p1's text, up while it plays
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [graphicAt(s(18.08), { spec: overText, pointId: "p2" })] } }))
  const moved = await boxOf()
  expect(moved.y1 <= 0.14 || moved.y0 >= 0.41).toBe(true)
})

test("a graphic ends where the piece playing its sentence does, and the preview, the jobs and a retry all take it that long: one planned for longer has that room to be written for, and one written for it is rendered for it", async () => {
  // planned for 2 s and not written yet: its piece leaves it 1.7 s, which is what it will be written for
  const planned = graphicAt(s(18.08))
  const { highlights, folder, deps, outlines } = await withGraphics([planned])
  await deps.settings.update({ flair: { enabled: true, graphic: true } })
  const options = { position: "auto" as const, subtitlesOn: (await deps.settings.read()).subtitles.enabled, highlightsOn: true, flair: (await deps.settings.read()).flair }
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, options)
  expect(preview.graphics.map((graphic) => [graphic.atUs, graphic.durationUs, graphic.spec.seconds])).toEqual([[1_070_000, 1_700_000, 2]])
  const unwritten = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, options)
  expect(unwritten.kept.map((graphic) => graphic.durationUs)).toEqual([1_700_000])
  expect(unwritten.jobs).toEqual([null])
  expect(await highlights.jobFor(folder, planned)).toBeNull()
  // written for those 1.7 s, it plays them and is rendered that long
  const cue = onSpace()
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [cue] } }))
  const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, options)
  expect(kept.map((graphic) => graphic.durationUs)).toEqual([1_700_000])
  expect(jobs.map((job) => job!.spec.seconds)).toEqual([1.7])
  expect(jobs).toEqual([spaceJob()])
  expect(await highlights.jobFor(folder, cue)).toEqual(jobs[0])
})

test("a graphic that runs on across a cut keeps clear of what the next piece's picture keeps clear, too", async () => {
  // the face fills the top of the first take, a product the middle of the second
  const { highlights, folder } = await withGraphics([graphicAt(s(19.0))], { scenes: [scene(0, 20, { fromY: 0.1, toY: 0.45 }), scene(20, 31, { fromY: 0.5, toY: 0.75 })] })
  const [graphic] = (await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics
  // "ใน" plays 1.99 s in, 0.78 s before its piece ends: it still plays the shortest a graphic may, 1.5 s, into the second take
  expect([graphic!.atUs, graphic!.durationUs]).toEqual([1_990_000, 1_500_000])
  // at 0.6–0.72 it was clear of the face but not of the product: it goes below both
  expect(graphic!.spec.box.y0).toBeGreaterThanOrEqual(0.75)
})

test("a graphic keeps clear of highlight text that comes on screen only partway through it, too", async () => {
  // between the first sentence's text (0.14–0.41 of the height) and where the countdown's reaches down to
  const box = { x0: 0.1, y0: 0.43, x1: 0.9, y1: 0.55 }
  const { highlights, folder, outlines } = await withGraphics([graphicAt(s(19.0), { spec: { ...SPEC, box } })])
  await storePoints(outlines, folder, fixturePoints())
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  // "ใน" plays 1.99 s in, while the first sentence's text is up; it runs on to 3.49 s, and the countdown's comes up at 2.92 s
  expect(preview.groups.map((group) => [group.startUs, group.endUs])).toEqual([[150_000, 2_070_000], [2_920_000, 5_700_000]])
  const [graphic] = preview.graphics
  expect([graphic!.atUs, graphic!.durationUs]).toEqual([1_990_000, 1_500_000])
  // clear of the text up when it comes up, but not of the countdown's: it goes below that too
  expect(graphic!.spec.box.y0).toBeGreaterThanOrEqual(0.55)
})

test("a graphic is moved off the subtitles' room while they are on, and off what the picture keeps clear", async () => {
  const { highlights, folder } = await withGraphics([graphicAt(s(22.62), { spec: { ...SPEC, box: LOW } })])
  const boxOf = async (subtitlesOn: boolean) => (await highlights.preview(folder, DEFAULT_CUT_RULES, { ...GRAPHICS_ON, subtitlesOn })).graphics[0]!.spec.box
  expect(await boxOf(false)).toEqual(LOW)
  expect((await boxOf(true)).y1).toBeLessThanOrEqual(0.76)

  // a face over the lower half of the picture
  const face = await withGraphics([graphicAt(s(22.62))], { scenes: [scene(0, 31, { fromY: 0.5, toY: 0.75 })] })
  const box = (await face.highlights.preview(face.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics[0]!.spec.box
  expect(box.y1 <= 0.5 || box.y0 >= 0.75).toBe(true)
})

test("the render jobs of the graphics in force are the preview's own, for whoever renders them; switched-off ones have none", async () => {
  const off = onSpace({ off: true })
  const on = graphicAt(s(22.62), { spec: { ...COUNTDOWN, box: LOW } })
  const { highlights, folder, renderer } = await withGraphics([off, on])
  const options = { ...GRAPHICS_ON, subtitlesOn: true }
  const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, options)
  // asking for the jobs starts nothing
  expect(renderer.ensure).not.toHaveBeenCalled()
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, options)
  expect(kept.map((graphic) => [graphic.cue.anchor, graphic.atUs, graphic.durationUs])).toEqual([[on.anchor, preview.graphics[0]!.atUs, 2_000_000]])
  // moved off the subtitles, as the preview shows it
  expect(jobs).toEqual([motionJob(preview.graphics[0]!.spec, [0, 1.26])])
  expect(jobs[0]!.spec.box).not.toEqual(LOW)
  expect(renderer.ensure).toHaveBeenLastCalledWith(jobs, folder)

  expect(await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, { ...options, flair: { ...options.flair, graphic: false } })).toEqual({ kept: [], off: [], jobs: [] })
})

test("the jobs of graphics that play cannot be made without the style to draw them in", async () => {
  const base = await setup({})
  const highlights = createHighlightService({ outlines: base.outlines, timeline: base.service, footage: base.deps, graphics: fakeRenderer() })
  await base.outlines.update(base.folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics: [graphicAt(s(18.08))] } }))
  await expect(highlights.graphicJobs(base.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).rejects.toThrow(/style/)
})

test("one graphic's job is the one the post-production page shows, under the settings the page follows", async () => {
  const cue = graphicAt(s(22.62), { spec: { ...COUNTDOWN, box: LOW } })
  const { highlights, folder, deps } = await withGraphics([onSpace({ off: true }), cue])
  await deps.settings.update({ subtitles: { enabled: true }, flair: { enabled: true, graphic: true } })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: true, highlightsOn: true, flair: (await deps.settings.read()).flair })
  // the box moved off the subtitles, so the hash is the one the renderer used
  expect(await highlights.jobFor(folder, cue)).toEqual(motionJob(preview.graphics[0]!.spec, [0, 1.26]))
  expect(preview.graphics[0]!.spec.box).not.toEqual(LOW)
  // one that does not play has none
  expect(await highlights.jobFor(folder, onSpace({ off: true }))).toBeNull()
})

test("a rough cut that keeps nothing has no graphics and no jobs", async () => {
  const { highlights, folder, service, renderer } = await withGraphics([onSpace()], { packReady: false })
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4, 8, 9, 10], keep: false })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect([preview.graphics, preview.graphicsWaitForPack]).toEqual([[], false])
  expect(await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).toEqual({ kept: [], off: [], jobs: [] })
  expect(renderer.ensure).not.toHaveBeenCalled()
})

test("a service not told whether the renderer pack is installed takes it as missing", async () => {
  const { highlights, folder, renderer } = await withGraphics([onSpace()], { packReady: null })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphicsWaitForPack).toBe(true)
  expect(preview.graphics).toMatchObject([{ render: "waiting" }])
  expect(renderer.ensure).not.toHaveBeenCalled()
})

test("with a renderer but no style to draw in, the graphics are listed waiting, and with none stored there are no jobs to make", async () => {
  const { highlights, folder, renderer, outlines } = await withGraphics([onSpace()], { styled: false })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphics).toMatchObject([{ anchor: graphicAt(s(18.08)).anchor, render: "waiting", poster: null, error: null }])
  expect(renderer.ensure).not.toHaveBeenCalled()

  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [] } }))
  expect(await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).toEqual({ kept: [], off: [], jobs: [] })
})

test("at the lightest level the graphics play as at any other, whatever the old switch for all flair says", async () => {
  const { highlights, folder } = await withGraphics([graphicAt(s(18.08), { off: true, edited: true }), graphicAt(s(22.62))], { packReady: false })
  const options = { ...GRAPHICS_ON, flair: { ...GRAPHICS_ON.flair, enabled: false, level: "light" as const } }
  const light = await highlights.preview(folder, DEFAULT_CUT_RULES, options)
  expect(light.graphics.map((graphic) => graphic.off)).toEqual([false, true])
  expect(light.graphicsWaitForPack).toBe(true)
  expect((await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, options)).kept).toHaveLength(1)
})

/* motion graphics */

/**
 * A motion graphic for the second countdown, on สาม at 22.62 s, written for its 2 s and the two words said in them on
 * the fixture's rough cut: สาม as it starts and สอง 1.26 s in (หนึ่ง comes 2.22 s in, when it is gone).
 */
const COUNTDOWN: MotionSpec = {
  kind: "motion",
  version: MOTION_VERSION,
  box: SPEC.box,
  seconds: 2,
  why: "นับถอยหลัง",
  idea: "เลข 3 2 1 เด้งขึ้นทีละตัวตามคำที่นับ",
  words: [
    { text: "สาม", atS: 0 },
    { text: "สอง", atS: 1.26 },
  ],
  html: '<style>.n{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="n">3 2 1</div>',
}
/** What the renderer is asked for a motion graphic: its spec, the fixture's frame and style, and the times its words are said at now. */
const motionJob = (spec: MotionSpec, times: number[]): RenderJob => ({ ...jobOf(spec), times })
/** Every job the renderer was asked to start, over every look at the preview. */
const started = (renderer: ReturnType<typeof fakeRenderer>) => renderer.ensure.mock.calls.flatMap(([jobs]) => jobs)

test("the preview lists a motion graphic by its idea, written and fresh, and renders it with the times its words are said at now", async () => {
  // written when สอง came a second after สาม: on this rough cut it comes 1.26 s after
  const spec: MotionSpec = { ...COUNTDOWN, words: [{ text: "สาม", atS: 0 }, { text: "สอง", atS: 1 }] }
  const cue = graphicAt(s(22.62), { spec })
  const job = motionJob(spec, [0, 1.26])
  const { highlights, folder, renderer } = await withGraphics([cue], { renderer: fakeRenderer([job]) })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphics).toEqual([
    {
      anchor: cue.anchor,
      // สาม plays 2.92 s into the rough cut, in a piece that plays on past its 2 s
      atUs: 2_920_000,
      durationUs: 2_000_000,
      what: "ที่ “สามสองหนึ่ง” ตรงคำว่า “สาม”",
      beatId: "beat-1",
      why: "นับถอยหลัง",
      summary: "เลข 3 2 1 เด้งขึ้นทีละตัวตามคำที่นับ",
      spec,
      written: true,
      stale: false,
      writeFailed: null,
      instruction: null,
      editFailed: null,
      canUndo: false,
      render: "ready",
      poster: POSTER,
      error: null,
      edited: false,
      off: false,
      // made for no point and planned before 0.7.0: no level of its own, and no text's place to take
      from: null,
      replaces: false,
      coversKeep: false,
    },
  ])
  expect(renderer.ensure).toHaveBeenCalledTimes(1)
  expect(renderer.ensure).toHaveBeenCalledWith([job], folder)
  // a file made for the times it was written with is another graphic's: this one still waits to be made
  const old = await withGraphics([cue], { renderer: fakeRenderer([motionJob(spec, [0, 1])]) })
  expect((await old.highlights.preview(old.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics).toMatchObject([{ written: true, stale: false, render: "waiting", poster: null }])
})

test("a motion graphic not written yet is listed waiting, with why its last writing failed, and nothing is asked of the renderer for it", async () => {
  const failure = "nothing was drawn: every frame is empty"
  // on อวกาศ, which plays 1.07 s in, 1.7 s before its piece ends: อวกาศ and the ใน after it are said in that time
  const spec: MotionSpec = { ...COUNTDOWN, html: null, failed: failure }
  const unwritten = graphicAt(s(18.08), { spec })
  // a renderer that holds a file for what would be its job: it is not asked for it
  const { highlights, folder, renderer } = await withGraphics([unwritten], { renderer: fakeRenderer([motionJob(spec, [0, 0.92])]) })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphics).toMatchObject([
    { anchor: unwritten.anchor, atUs: 1_070_000, durationUs: 1_700_000, summary: COUNTDOWN.idea, spec, written: false, stale: false, writeFailed: failure, render: "waiting", poster: null, error: null, off: false },
  ])
  expect(started(renderer)).toEqual([])
  // one whose writing has never failed has no failure to show
  const never = await withGraphics([graphicAt(s(18.08), { spec: { ...COUNTDOWN, html: null } })])
  expect((await never.highlights.preview(never.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics).toMatchObject([{ written: false, stale: false, writeFailed: null, render: "waiting" }])
})

test("a motion graphic shows the change the user asked that made its fragment, why its last edit failed and whether a fragment is kept to go back to; one never edited or written again shows none of them", async () => {
  const kept = { html: FRAGMENT, seconds: 2, words: [], version: MOTION_VERSION }
  // edited as the user asked, then an edit that failed: the fragment there is the edited one, with the one before it kept
  const edited = graphicAt(s(22.62), { spec: { ...COUNTDOWN, instruction: "ตัวเลขใหญ่ขึ้น", editFailed: "timed out", previous: kept } })
  // written again when its writing failed: nothing to show of a change, and a fragment to go back to, switched off or not
  const redone = graphicAt(s(18.08), { spec: { ...COUNTDOWN, html: null, failed: "nothing was drawn: every frame is empty", previous: kept }, off: true })
  const { highlights, folder } = await withGraphics([edited, redone], { packReady: false })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics.map((graphic) => [graphic.anchor, graphic.instruction, graphic.editFailed, graphic.canUndo])).toEqual([
    [edited.anchor, "ตัวเลขใหญ่ขึ้น", "timed out", true],
    [redone.anchor, null, null, true],
  ])
  const plain = await withGraphics([graphicAt(s(22.62), { spec: COUNTDOWN })], { packReady: false })
  expect((await plain.highlights.preview(plain.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics).toMatchObject([{ instruction: null, editFailed: null, canUndo: false }])
})

test("a graphic whose stored fragment kept for a step back is no fragment (a file may hold anything) has nothing to go back to", async () => {
  for (const previous of [null, {}, "x"]) {
    const cue = graphicAt(s(22.62), { spec: { ...COUNTDOWN, previous } as unknown as MotionSpec })
    const { highlights, folder } = await withGraphics([cue], { packReady: false })
    expect((await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics, JSON.stringify(previous)).toMatchObject([{ canUndo: false }])
  }
})

test("a motion graphic goes stale when the cut takes out a word it was written for: it is listed waiting and nothing renders it, until the word is back", async () => {
  const cue = graphicAt(s(22.62), { spec: COUNTDOWN })
  const job = motionJob(COUNTDOWN, [0, 1.26])
  // the renderer made it as it was written, and holds a file for what it would be with สาม alone: that one is never asked for
  const { highlights, folder, renderer, service } = await withGraphics([cue], { renderer: fakeRenderer([job, motionJob(COUNTDOWN, [0])]) })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics).toMatchObject([{ written: true, stale: false, render: "ready", poster: POSTER }])
  expect(started(renderer)).toEqual([job])

  // the user cuts สอง out of the countdown: only สาม is said while it plays, and its piece ends 1.11 s on, so it plays
  // the shortest a graphic may, 1.5 s of the 2 it was written for
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [9], keep: false })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(preview.graphics).toMatchObject([{ anchor: cue.anchor, atUs: 2_920_000, durationUs: 1_500_000, summary: COUNTDOWN.idea, written: true, stale: true, writeFailed: null, render: "waiting", poster: null, error: null }])
  expect(started(renderer)).toEqual([job])
  const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(kept).toMatchObject([{ cue, wordsNow: [{ text: "สาม", atS: 0 }], stale: true }])
  expect(jobs).toEqual([null])

  // kept again, it is what it was written for, and the file made for it is its file
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [9], keep: null })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics).toMatchObject([{ stale: false, render: "ready", poster: POSTER }])
})

test("the render jobs are one for each graphic in force that is written and fresh, none for one not written yet or stale, and each goes with the words said now; a retry finds the same job, or none", async () => {
  const unwritten = graphicAt(s(18.08), { spec: { ...COUNTDOWN, html: null } })
  // written for the countdown's two words, and put on ใน, the one word said in the 1.5 s it plays there
  const stale = graphicAt(s(19.0), { spec: COUNTDOWN })
  const fresh = graphicAt(s(22.62), { spec: COUNTDOWN })
  const { highlights, folder, renderer, deps } = await withGraphics([fresh, stale, unwritten])
  const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(kept.map((graphic) => graphic.cue.anchor)).toEqual([unwritten.anchor, stale.anchor, fresh.anchor])
  expect(jobs).toEqual([null, null, motionJob(COUNTDOWN, [0, 1.26])])
  expect(kept.map((graphic) => [graphic.durationUs, graphic.wordsNow, graphic.stale])).toEqual([
    // the 1.7 s its piece leaves it, which is what it will be written for
    [1_700_000, [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], false],
    // ใน is the last word of its piece: it plays the shortest a graphic may, on into the next piece
    [1_500_000, [{ text: "ใน", atS: 0 }], true],
    [2_000_000, [{ text: "สาม", atS: 0 }, { text: "สอง", atS: 1.26 }], false],
  ])
  // asking for the jobs starts nothing; the preview starts the one there is
  expect(renderer.ensure).not.toHaveBeenCalled()
  await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(renderer.ensure).toHaveBeenLastCalledWith([motionJob(COUNTDOWN, [0, 1.26])], folder)

  // a retry, under the settings the page follows
  await deps.settings.update({ flair: { enabled: true, graphic: true } })
  expect(await highlights.jobFor(folder, fresh)).toEqual(motionJob(COUNTDOWN, [0, 1.26]))
  expect(await highlights.jobFor(folder, unwritten)).toBeNull()
  expect(await highlights.jobFor(folder, stale)).toBeNull()
})

test("a tighter cut, which ends the last piece 0.07 s sooner and changes no word, leaves a motion graphic written up to that end fresh", async () => {
  // written under the normal cut for the 2.78 s from สาม to the end of the rough cut, and the three words said in them
  const spec: MotionSpec = { ...COUNTDOWN, seconds: 2.78, words: [...COUNTDOWN.words, { text: "หนึ่ง", atS: 2.22 }] }
  const { highlights, folder } = await withGraphics([graphicAt(s(22.62), { spec })])
  const placedUnder = async (preset: "normal" | "tight") => {
    const { kept, jobs } = await highlights.graphicJobs(folder, { ...DEFAULT_CUT_RULES, preset }, GRAPHICS_ON)
    return kept.map((graphic, i) => [graphic.durationUs, graphic.stale, jobs[i]?.spec.seconds, jobs[i]?.times])
  }
  expect(await placedUnder("normal")).toEqual([[2_780_000, false, 2.78, [0, 1.26, 2.22]]])
  // the rough cut ends 0.07 s sooner: within the 0.1 s its way out is over by, so the same file, cut that much short
  expect(await placedUnder("tight")).toEqual([[2_710_000, false, 2.78, [0, 1.26, 2.22]]])
})

test("a motion graphic whose own word is cut plays where its point starts now, with the words said from there: a written one is stale, one not written yet is written for them", async () => {
  // both made for the second countdown (words 8–10) and put on its first word, สาม
  const written = graphicAt(s(22.62), { spec: COUNTDOWN, pointId: "p2" })
  const unwritten = graphicAt(s(22.62), { spec: { ...COUNTDOWN, html: null }, pointId: "p2" })
  for (const cue of [written, unwritten]) {
    const { highlights, folder, outlines, service } = await withGraphics([cue])
    await storePoints(outlines, folder, fixturePoints())
    // as planned: by its own word, for its 2 s
    expect((await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).kept).toMatchObject([{ atUs: 2_920_000, durationUs: 2_000_000, wordsNow: COUNTDOWN.words, stale: false }])
    // the user cuts สาม: the point starts on สอง now, which plays where สาม did, 0.96 s before หนึ่ง, in a piece 1.52 s long
    await service.decide(folder, CLIP_ID, { type: "words", indexes: [8], keep: false })
    const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
    expect(kept).toEqual([{ cue, atUs: 2_920_000, durationUs: 1_520_000, wordsNow: [{ text: "สอง", atS: 0 }, { text: "หนึ่ง", atS: 0.96 }], stale: cue === written }])
    expect(jobs).toEqual([null])
    // the screen names it by where it plays now, and finds it by the anchor it was stored with
    expect((await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics).toMatchObject([{ anchor: cue.anchor, what: "ที่ “สองหนึ่ง” ตรงคำว่า “สอง”", pointId: "p2", stale: cue === written }])
  }
})

test("a motion graphic on a scene point has no words, since nothing is said on a picture beat: written for none, it is fresh and rendered with no times", async () => {
  // on the point's first kept moment, 2 s into the sky
  const spec: MotionSpec = { ...COUNTDOWN, idea: "เมฆลอยผ่านแล้วดวงอาทิตย์โผล่", words: [] }
  const onSky = graphicAt(s(2), { anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(2), beatId: "sky" }, spec, pointId: "p0" })
  const { highlights, folder, outlines } = await withGraphics([onSky], { beats: [SKY, countdown], scenes: SKY_SCENES })
  await storePoints(outlines, folder, [ON_SKY])
  const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(kept).toMatchObject([{ cue: onSky, atUs: 2_000_000, durationUs: 2_000_000, wordsNow: [], stale: false }])
  expect(jobs).toEqual([motionJob(spec, [])])
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics).toMatchObject([{ what: "ที่ 0:02.0", beatId: "sky", summary: "เมฆลอยผ่านแล้วดวงอาทิตย์โผล่", written: true, stale: false, pointId: "p0" }])
})

test("the switched-off graphics come with the ones in force, placed as the list shows them and judged by the length they would play switched on; none has a job", async () => {
  const on = graphicAt(s(18.08), { spec: { ...COUNTDOWN, html: null } })
  // written for 1.7 s and switched off, on สอง, which plays 1.52 s before the rough cut ends
  const offSpec: MotionSpec = { ...COUNTDOWN, seconds: 1.7, words: [{ text: "สอง", atS: 0 }, { text: "หนึ่ง", atS: 0.96 }] }
  const switchedOff = graphicAt(s(23.88), { spec: offSpec, off: true, edited: true })
  const { highlights, folder } = await withGraphics([on, switchedOff])
  const { kept, off, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(kept.map((graphic) => graphic.cue.anchor)).toEqual([on.anchor])
  expect(jobs).toEqual([null])
  // listed for the 1.7 s it was written for; switched on it would be cut at the end of the rough cut, 0.18 s short, so it is stale
  expect(off).toEqual([{ cue: switchedOff, atUs: 4_180_000, durationUs: 1_700_000, wordsNow: offSpec.words, stale: true }])
})

/** Another fragment, as a writing of the countdown's graphic might answer. */
const CANDIDATE = '<style>.c{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="c">อวกาศ</div>'

test("the job a placed motion graphic would have with what a writing would store for it is the job it has once that is stored", async () => {
  // not written yet, on อวกาศ, where it has 1.7 s and two words are said in them; its last writing failed
  const unwritten = graphicAt(s(18.08), { spec: { ...COUNTDOWN, html: null, failed: "nothing was drawn: every frame is empty" } })
  const { highlights, folder, outlines, renderer } = await withGraphics([unwritten])
  const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(jobs).toEqual([null])
  const placed = kept[0]!
  expect([placed.durationUs, placed.wordsNow]).toEqual([1_700_000, [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }]])
  // as a writing stores it: the fragment, the length it has and the words said in it
  const written: MotionSpec = { ...COUNTDOWN, seconds: 1.7, words: placed.wordsNow!, html: CANDIDATE }
  const job = await highlights.candidateJob(folder, DEFAULT_CUT_RULES, placed, written)
  // drawn as the preview draws it: the fixture's frame and frame rate, the style in force, the words' times now
  expect(job).toEqual(motionJob(written, [0, 0.92]))
  // asking for it renders nothing
  expect(renderer.ensure).not.toHaveBeenCalled()
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [{ ...unwritten, spec: written }] } }))
  const stored = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(stored.kept).toMatchObject([{ stale: false }])
  expect(stored.jobs).toEqual([job])
})

test("a stale graphic's candidate has a job, since it is judged as written for what is said now; without a frame to draw on there is none, and without a style it cannot be made", async () => {
  // written for the countdown's two words: with สอง cut it is stale, and plays the shortest a graphic may
  const cue = graphicAt(s(22.62), { spec: COUNTDOWN })
  const { highlights, folder, service, outlines, deps } = await withGraphics([cue])
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [9], keep: false })
  const { kept, jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(kept).toMatchObject([{ durationUs: 1_500_000, wordsNow: [{ text: "สาม", atS: 0 }], stale: true }])
  expect(jobs).toEqual([null])
  const written: MotionSpec = { ...COUNTDOWN, seconds: 1.5, words: [{ text: "สาม", atS: 0 }], html: CANDIDATE }
  expect(await highlights.candidateJob(folder, DEFAULT_CUT_RULES, kept[0]!, written)).toEqual(motionJob(written, [0]))

  // a rough cut with no frame size (its first kept video is not in the draft's bin)
  const blind = createHighlightService({
    outlines,
    timeline: { ...service, compiled: async (...args: Parameters<typeof service.compiled>) => ({ ...(await service.compiled(...args)), canvas: null }) },
    footage: deps,
    graphics: fakeRenderer(),
    styleOf: async () => STYLE,
  })
  expect(await blind.candidateJob(folder, DEFAULT_CUT_RULES, kept[0]!, written)).toBeNull()
  const unstyled = createHighlightService({ outlines, timeline: service, footage: deps, graphics: fakeRenderer() })
  await expect(unstyled.candidateJob(folder, DEFAULT_CUT_RULES, kept[0]!, written)).rejects.toThrow(/style/)
})

const ON_POINT: EmphasisPoint = { id: "p1", anchor: { kind: "speech", videoId: CLIP_ID, from: 3, to: 4, beatId: "beat-1" }, importance: "key", type: "place", reason: "จุดหมาย", source: "ai", edited: false }

/** The text and the zooms on, so the punch made for a point plays. */
const WITH_ZOOMS = { ...VIEW, flair: { ...VIEW.flair, zoom: true } }

/** A user's group on "อวกาศ" and a punch on the first piece, both made for `point`. */
async function withPointItems(point: EmphasisPoint) {
  const context = await withHighlights()
  const { highlights, folder, outlines } = context
  await highlights.addFromWords(folder, CLIP_ID, [3], 12, "beat-1")
  const { pieces } = await highlights.preview(folder, DEFAULT_CUT_RULES, WITH_ZOOMS)
  await outlines.update(folder, (stored) => ({
    ...stored!,
    emphasis: { points: [point], version: 2, plannedOn: { graphics: 1, sounds: 2 }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
    highlights: { ...stored!.highlights!, groups: stored!.highlights!.groups.map((group) => ({ ...group, pointId: point.id })) },
    flair: { looks: {}, zooms: [{ anchor: pieces[0]!.anchor, kind: "punch", edited: false, pointId: point.id }] },
  }))
  return context
}

test("the preview says which point each item was made for, and the emphasis tab counts what plays on each point", async () => {
  const { highlights, folder } = await withPointItems(ON_POINT)
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, WITH_ZOOMS)
  expect(preview.groups.map((group) => group.pointId)).toEqual(["p1"])
  expect(preview.zooms.map((zoom) => zoom.pointId)).toEqual(["p1"])
  // "อวกาศ" plays 1.07 s in
  expect(preview.emphasis.points).toMatchObject([{ id: "p1", beatId: "beat-1", atUs: 1_070_000, text: "อวกาศ", shown: true, items: { text: 1, zoom: 1, insert: 0, graphic: 0, sound: 0 } }])
  // graphics were planned on version 1 of the points, sounds on 2; an outline from before 0.7.0 noted the text and
  // techniques with the graphics
  expect([preview.emphasis.hidden, preview.emphasis.version, preview.emphasis.changed]).toEqual([0, 2, { techniques: true, graphics: true, sounds: false }])
})

test("a point the level leaves out takes its items off the preview, and the emphasis tab says it does not show", async () => {
  const { highlights, folder } = await withPointItems({ ...ON_POINT, importance: "secondary" })
  const light = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...WITH_ZOOMS, flair: { ...WITH_ZOOMS.flair, level: "light" as const } })
  expect([light.groups, light.zooms]).toEqual([[], []])
  expect(light.emphasis.points).toMatchObject([{ id: "p1", shown: false, items: { text: 0, zoom: 0, insert: 0, graphic: 0, sound: 0 } }])
})

/** Stores ON_POINT on a fixture outline, on the transcript it has. */
const pointStored = (stored: StoredOutline): StoredOutline => ({
  ...stored,
  emphasis: { points: [ON_POINT], version: 1, plannedOn: { graphics: 1, sounds: 1 }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
})

test("a sound and a cutaway say which point they were made for, and the emphasis tab counts them on it", async () => {
  const base = await setup()
  const highlights = createHighlightService({
    outlines: base.outlines,
    timeline: base.service,
    footage: base.deps,
    sounds: { list: async () => [{ effectId: "s1", name: "ปัง", durationUs: 330_000, path: "/cache/s1.mp3" }] },
    media: { list: async () => [PICTURE] },
  })
  // a sound on the start of the fixture's one beat, and a cutaway on "อวกาศ", both the user's and made for p1
  const cutaway: InsertCue = { anchor: graphicAt(s(18.08)).anchor, binId: "m1", edited: true, fit: "cover", subject: null, pointId: "p1" }
  await base.outlines.update(base.folder, (stored) => ({
    ...pointStored(stored!),
    flair: { looks: {}, cues: [{ anchor: { kind: "beat", beatId: "beat-1", edge: "start" }, effectId: "s1", edited: true, pointId: "p1" }], inserts: [cutaway] },
  }))
  const preview = await highlights.preview(base.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect([preview.cues.map((cue) => cue.pointId), preview.inserts.map((insert) => insert.pointId)]).toEqual([["p1"], ["p1"]])
  expect(preview.emphasis.points).toMatchObject([{ id: "p1", items: { text: 0, zoom: 0, insert: 1, graphic: 0, sound: 1 } }])
})

test("a graphic switched off plays nothing, so the emphasis tab does not count it on its point", async () => {
  const off = graphicAt(s(18.08), { off: true, edited: true, pointId: "p1" })
  const on = graphicAt(s(22.62), { pointId: "p1", spec: { ...SPEC, why: "นับ", idea: "เลข 3 2 1 เด้งขึ้น" } })
  const { highlights, folder, outlines } = await withGraphics([off, on])
  await outlines.update(folder, (stored) => pointStored(stored!))
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  // both are listed, the switched-off one last, and both name their point
  expect(preview.graphics.map((graphic) => [graphic.pointId, graphic.off])).toEqual([
    ["p1", false],
    ["p1", true],
  ])
  expect(preview.emphasis.points).toMatchObject([{ id: "p1", items: { graphic: 1 } }])
})

test("what the user edited on the lines of a Claude group whose point is deleted plays from the beat's start: every cutaway, but only the first of two sounds", async () => {
  const base = await setup()
  const other = { ...PICTURE, binId: "m2", path: "/pics/nail2.jpg", name: "IMG_2.JPG" }
  const highlights = createHighlightService({
    outlines: base.outlines,
    timeline: base.service,
    footage: base.deps,
    sounds: {
      list: async () => [
        { effectId: "s1", name: "ปัง", durationUs: 330_000, path: "/cache/s1.mp3" },
        { effectId: "s2", name: "ฟิ้ว", durationUs: 330_000, path: "/cache/s2.mp3" },
      ],
    },
    media: { list: async () => [PICTURE, other] },
  })
  const onLine = (line: number) => ({ kind: "highlight" as const, groupId: "g", line })
  const lines = [
    { videoId: CLIP_ID, from: 3, to: 4, text: "อวกาศ" },
    { videoId: CLIP_ID, from: 8, to: 9, text: "สาม" },
  ]
  const stored = pointStored((await base.outlines.get(base.folder))!)
  await base.outlines.put(
    withoutPoint(
      {
        ...stored,
        highlights: { style: null, styleByAi: null, beatsKey: null, transcripts: {}, groups: [{ id: "g", source: "ai", edited: false, pointId: "p1", beatId: "beat-1", lines }] },
        flair: {
          looks: {},
          cues: [
            { anchor: onLine(0), effectId: "s1", edited: true, pointId: "p1" },
            { anchor: onLine(1), effectId: "s2", edited: true, pointId: "p1" },
          ],
          inserts: [
            { anchor: onLine(0), binId: "m1", edited: true, pointId: "p1" },
            { anchor: onLine(1), binId: "m2", edited: true, pointId: "p1" },
          ],
        },
      },
      "p1",
    ),
  )
  const preview = await highlights.preview(base.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  const start = { kind: "beat", beatId: "beat-1", edge: "start" }
  // both cutaways play from the beat's start, each on a track of its own when written
  expect(preview.inserts.map((insert) => [insert.binId, insert.anchor, insert.atUs])).toEqual([
    ["m1", start, 0],
    ["m2", start, 0],
  ])
  // the known limit: one sound a place, so the second stays stored but neither plays nor shows, and the next sound change at that beat start removes it
  expect(preview.cues.map((cue) => [cue.effectId, cue.anchor, cue.atUs])).toEqual([["s1", start, 0]])
})

test("with no emphasis point on the rough cut Claude is not asked, and the text, looks and style it picked before stay", async () => {
  const { highlights, folder, claude, outlines, service } = await withHighlights({ points: [fixturePoints()[0]!] })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const before = (await outlines.get(folder))!
  expect(before.highlights!.groups.map((group) => group.pointId)).toEqual(["p1"])
  expect(before.highlights!.styleByAi).toBe("headline")
  // the only point's words are cut away, so no point is on the rough cut
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4], keep: false })
  const { dropped } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(dropped).toBe(0)
  expect(claude.requests).toHaveLength(1)
  const after = (await outlines.get(folder))!
  expect(after.highlights).toEqual(before.highlights)
  expect(after.flair?.looks).toEqual(before.flair?.looks)
})

test("a look the user set by hand moves onto the text Claude picks again on the same words, and Claude's look does not replace it", async () => {
  const { highlights, folder, outlines } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const handSet = { pattern: "punch" as const, tone: "alt" as const, accent: null, exit: null, edited: true }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, looks: { ...stored!.flair!.looks, id1: handSet } } }))
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const after = (await outlines.get(folder))!
  expect(after.highlights!.groups.map((group) => group.id)).toEqual(["id3", "id4"])
  // id1's look followed its words to id3; Claude's plain look goes only where no hand-set look is
  expect(after.flair!.looks).toEqual({ id3: handSet, id4: PLAIN_LOOK })
})

// spec §5.1, the user's decision of 2026-09-28: an edited item on replaced text is never lost to a re-pick
test("picking again, what the user edited on Claude's replaced text follows the new text with the same words, else moves to its beat's start; Claude's own goes", async () => {
  const { highlights, folder, claude, outlines } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const line = (groupId: string, index: number) => ({ kind: "highlight" as const, groupId, line: index })
  // the user's sound on "ขึ้นไป" and cutaway on "อวกาศ!" (both id1), Claude's sound on "อวกาศ!", the user's sound on "3" (id2)
  await outlines.update(folder, (stored) => ({
    ...stored!,
    flair: {
      ...stored!.flair!,
      cues: [
        { anchor: line("id1", 0), effectId: "mine-on-id1", edited: true },
        { anchor: line("id1", 1), effectId: "claude-on-id1", edited: false },
        { anchor: line("id2", 0), effectId: "mine-on-id2", edited: true },
      ],
      inserts: [{ anchor: line("id1", 1), binId: "m", edited: true }],
    },
  }))
  // Claude picks again and makes text for the countdown's point only: no new text says "ขึ้นไปในอวกาศ"
  claude.reply = { style: "headline", groups: [REPLY.groups[1]!] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const after = (await outlines.get(folder))!
  expect(after.highlights!.groups.map((group) => [group.id, group.pointId])).toEqual([["id3", "p2"]])
  // id1's beat, where its lines were (offGoneLines)
  const beatStart = { kind: "beat", beatId: "beat-1", edge: "start" }
  expect(after.flair!.cues).toEqual([
    { anchor: beatStart, effectId: "mine-on-id1", edited: true },
    { anchor: line("id3", 0), effectId: "mine-on-id2", edited: true },
  ])
  expect(after.flair!.inserts).toEqual([{ anchor: beatStart, binId: "m", edited: true }])
})

test("each group's look comes with it and is stored with it; a fourth pattern in a row shows as the stack", async () => {
  // four one-word points: "ขึ้นไป", "อวกาศ", and "สาม" and "สอง" of the second countdown
  const on = (id: string, from: number, to: number): EmphasisPoint => ({ id, anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" }, importance: "key", type: "number", reason: "", source: "ai", edited: false })
  const { highlights, folder, claude, outlines } = await withHighlights({ points: [on("a", 0, 2), on("b", 3, 4), on("c", 8, 9), on("d", 9, 10)] })
  const punch = (point: number, quote: string) => ({ point, lines: [{ quote, text: quote }], ...PLAIN, pattern: "punch" as const })
  claude.reply = { style: "headline", groups: [{ ...punch(1, "ขึ้นไป"), tone: "accent" as const, exit: "fade-out" }, punch(2, "อวกาศ"), punch(3, "สาม"), { ...punch(4, "สอง"), accentLine: 1, accentWord: "สอง" }] }
  const { preview, dropped } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(dropped).toBe(0)
  // a phrase in the middle of its sentence is shown as its own words, in the whole sentence
  expect(textOf(claude.requests[0]!.content)).toContain("“อวกาศ” ในประโยค “ขึ้นไปในอวกาศใน”")
  const looks = (await outlines.get(folder))!.flair!.looks
  expect(looks.id1).toEqual({ pattern: "punch", tone: "accent", accent: null, exit: "fade-out", edited: false })
  expect(looks.id4).toEqual({ pattern: "punch", tone: "base", accent: { line: 0, from: 0, to: 3 }, exit: null, edited: false })
  // stored as Claude chose them; shown with the rule that no pattern runs for more than three groups
  expect(preview.groups.map((group) => group.look.pattern)).toEqual(["punch", "punch", "punch", "stack"])
})

/** Gives a stored group the exit spin-out, which needs CapCut Pro, as the user would set it by hand. */
async function spinOut(outlines: Awaited<ReturnType<typeof withHighlights>>["outlines"], folder: string, groupId: string): Promise<void> {
  const look = { pattern: "stack" as const, tone: "base" as const, accent: null, exit: "spin-out", edited: true }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, looks: { ...stored!.flair!.looks, [groupId]: look } } }))
}

test("without CapCut Pro an exit that needs it shows as none and is named as held, no exit is offered, since every one needs Pro, and it stays stored", async () => {
  const { highlights, folder, outlines, deps } = await withHighlights({ pro: false })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await spinOut(outlines, folder, "id1")

  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  const group = preview.groups.find((candidate) => candidate.id === "id1")!
  expect(group.look.exit).toBeNull()
  expect(group.heldExit).toEqual({ id: "spin-out", name: "หมุนหายไป" })
  expect(preview.groups.find((candidate) => candidate.id === "id2")!).not.toHaveProperty("heldExit")
  expect(preview.exits).toEqual([])
  expect(preview.proLeftOut).toEqual({ exits: 1, sounds: 0 })
  expect((await outlines.get(folder))!.flair!.looks.id1!.exit).toBe("spin-out")

  // only the groups shown count: with the text off none is, and none holds an exit on the screen
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, { ...VIEW, highlightsOn: false })).proLeftOut.exits).toBe(0)

  // Pro turned on later brings the stored exit back
  await deps.settings.update({ capcut: { pro: true } })
  const withPro = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  const shown = withPro.groups.find((candidate) => candidate.id === "id1")!
  expect(shown.look.exit).toBe("spin-out")
  expect(shown).not.toHaveProperty("heldExit")
  expect(withPro.exits).toEqual(EVERY_EXIT)
  expect(withPro.proLeftOut).toEqual({ exits: 0, sounds: 0 })
})

test("with CapCut Pro a stored Pro exit shows, nothing is held, and every exit is offered", async () => {
  const { highlights, folder, outlines } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await spinOut(outlines, folder, "id1")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  const group = preview.groups.find((candidate) => candidate.id === "id1")!
  expect(group.look.exit).toBe("spin-out")
  expect(group).not.toHaveProperty("heldExit")
  expect(preview.exits).toEqual(EVERY_EXIT)
  expect(preview.proLeftOut).toEqual({ exits: 0, sounds: 0 })
})

test("without CapCut Pro Claude is offered no exit, and each in its answer, อัลเทอร์เนตเฟด too, is not kept but counted; with Pro อัลเทอร์เนตเฟด is offered, kept and written", async () => {
  const { highlights, folder, claude, outlines, service, deps } = await withHighlights({ highlightAssets: assets, pro: false })
  claude.reply = { style: "headline", groups: [{ ...REPLY.groups[0]!, exit: "spin-out" }, { ...REPLY.groups[1]!, exit: "fade-alt" }] }
  const { preview, dropped } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const request = textOf(claude.requests[0]!.content)
  expect(request).toContain("- (ไม่มีให้เลือก ให้ตอบค่าว่าง)")
  expect(request).not.toContain("- fade-alt: ")
  expect(request).not.toContain("- spin-out: ")
  const looks = (await outlines.get(folder))!.flair!.looks
  expect([looks.id1!.exit, looks.id2!.exit]).toEqual([null, null])
  // counted like any exit that needs Pro: CapCut 9.5's export dialog asked for Pro for อัลเทอร์เนตเฟด
  expect(dropped).toBe(2)
  expect(preview.exits).toEqual([])

  // with Pro the same answer keeps both, and the draft gets อัลเทอร์เนตเฟด
  await deps.settings.update({ capcut: { pro: true } })
  const withPro = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(textOf(claude.requests[1]!.content)).toContain("- fade-alt: อัลเทอร์เนตเฟด")
  expect(withPro.dropped).toBe(0)
  expect(withPro.preview.groups.map((group) => group.look.exit)).toEqual(["spin-out", "fade-alt"])
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "bottom", hideSubtitles: false, highlightsOn: true, groupCount: 2, flair: VIEW.flair })
  const written = ((await readInfo(folder)).materials.material_animations as { animations: { resource_id: string }[] }[]).flatMap((entry) => entry.animations.map((animation) => animation.resource_id))
  expect(written).toContain(FADE_ALT)
  expect(written).toContain(SPIN_OUT)
})

test("without CapCut Pro an exit that needs it is not written but counted, and stays stored; with Pro the same outline writes it", async () => {
  const { highlights, folder, service, outlines, deps } = await withHighlights({ highlightAssets: assets, pro: false })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await spinOut(outlines, folder, "id1")
  const request = { position: "bottom" as const, hideSubtitles: false, highlightsOn: true, groupCount: 2, flair: VIEW.flair }
  const written = async () =>
    ((await readInfo(folder)).materials.material_animations as { animations: { resource_id: string }[] }[]).flatMap((entry) => entry.animations.map((animation) => animation.resource_id))

  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request)
  expect(await written()).not.toContain(SPIN_OUT)
  expect(result.highlightCount).toBe(5)
  expect(result.proLeftOut).toEqual({ exits: 1, sounds: 0 })
  expect((await outlines.get(folder))!.flair!.looks.id1!.exit).toBe("spin-out")

  await deps.settings.update({ capcut: { pro: true } })
  const again = await service.write(folder, DEFAULT_CUT_RULES, result.segmentCount, null, request)
  expect(await written()).toContain(SPIN_OUT)
  expect(again.proLeftOut).toEqual({ exits: 0, sounds: 0 })
})

test("with the looks off, the text off or no highlight request, a write leaves nothing out for want of CapCut Pro", async () => {
  const { highlights, folder, service, outlines } = await withHighlights({ highlightAssets: assets, pro: false })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await spinOut(outlines, folder, "id1")
  const request = { position: "bottom" as const, hideSubtitles: false, highlightsOn: true, groupCount: 2, flair: { ...VIEW.flair, text: false } }
  // the looks off: the groups are written as the plain stack, which has no exit, so none is held back
  const looksOff = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request)
  expect(looksOff.highlightCount).toBe(5)
  expect(looksOff.proLeftOut).toEqual({ exits: 0, sounds: 0 })
  // the text off: no group is written
  const textOff = await service.write(folder, DEFAULT_CUT_RULES, looksOff.segmentCount, null, { ...request, highlightsOn: false, groupCount: 0, flair: VIEW.flair })
  expect(textOff.highlightCount).toBe(0)
  expect(textOff.proLeftOut).toEqual({ exits: 0, sounds: 0 })
  expect((await service.write(folder, DEFAULT_CUT_RULES, textOff.segmentCount)).proLeftOut).toEqual({ exits: 0, sounds: 0 })
})

/** A sound CapCut ships free, which the app offers on every machine. */
const FREE_SOUND = BUILT_IN_SOUNDS[0]!
/** A sound read from a draft on this machine: it may be a Pro one, so without CapCut Pro it counts as one. */
const DRAFT_SOUND = { effectId: "from-a-draft", name: "เสียงจากดราฟต์", durationUs: 330_000, path: "/cache/from-a-draft.mp3" }
/** Only the sounds on. */
const SOUNDS_ON = { ...VIEW, flair: { ...VIEW.flair, sound: true } }

/** The fixture with a library of one free sound and one read from a draft, and a cue on each: Claude's free one on the first place, the user's draft one on the next. */
async function withBothSounds(pro: boolean) {
  const h = await withHighlights({ pro, sounds: { list: async () => [FREE_SOUND, DRAFT_SOUND] } })
  const [first, next] = (await h.highlights.preview(h.folder, DEFAULT_CUT_RULES, SOUNDS_ON)).slots
  const cues = [
    { anchor: first!.anchor, effectId: FREE_SOUND.effectId, edited: false },
    { anchor: next!.anchor, effectId: DRAFT_SOUND.effectId, edited: true },
  ]
  await h.outlines.update(h.folder, (stored) => ({ ...stored!, flair: { looks: {}, cues } }))
  return { ...h, cues }
}

test("without CapCut Pro only the free sounds are offered and play; one on a sound read from a draft is counted apart from a missing one, and stays stored", async () => {
  const { highlights, folder, outlines, deps, cues: both } = await withBothSounds(false)
  // and one the user set on a sound this machine does not have
  const cues = [...both, { anchor: both[0]!.anchor, effectId: "not-here", edited: true }]
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, cues } }))
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(preview.sounds.map((sound) => sound.effectId)).toEqual([FREE_SOUND.effectId])
  expect(preview.cues.map((cue) => cue.effectId)).toEqual([FREE_SOUND.effectId])
  expect(preview.unusedSounds).toEqual({ unplaced: 0, missing: 1, lost: 0, pro: 1 })
  expect(preview.proLeftOut).toEqual({ exits: 0, sounds: 1 })
  // the stored cue is untouched
  expect((await outlines.get(folder))!.flair!.cues).toEqual(cues)
  // with the sounds off none plays, so none is held back
  const off = await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)
  expect([off.unusedSounds, off.proLeftOut]).toEqual([{ unplaced: 0, missing: 0, lost: 0, pro: 0 }, { exits: 0, sounds: 0 }])

  // Pro turned on later brings the stored cue back
  await deps.settings.update({ capcut: { pro: true } })
  const withPro = await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(withPro.sounds.map((sound) => sound.effectId)).toEqual([FREE_SOUND.effectId, DRAFT_SOUND.effectId])
  expect(withPro.cues.map((cue) => cue.effectId)).toEqual([FREE_SOUND.effectId, DRAFT_SOUND.effectId])
  expect(withPro.unusedSounds).toEqual({ unplaced: 0, missing: 1, lost: 0, pro: 0 })
  expect(withPro.proLeftOut).toEqual({ exits: 0, sounds: 0 })
})

test("without CapCut Pro a sound read from a draft is not written but counted, and stays stored; with Pro the same outline writes it", async () => {
  const { folder, service, outlines, deps, cues } = await withBothSounds(false)
  const request = { position: "bottom" as const, hideSubtitles: false, highlightsOn: true, groupCount: 0, flair: SOUNDS_ON.flair }
  const written = async () => ((await readInfo(folder)).materials.audios as { effect_id: string }[]).map((audio) => audio.effect_id)

  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request)
  expect(await written()).toContain(FREE_SOUND.effectId)
  expect(await written()).not.toContain(DRAFT_SOUND.effectId)
  expect(result.soundCount).toBe(1)
  expect(result.proLeftOut).toEqual({ exits: 0, sounds: 1 })
  expect((await outlines.get(folder))!.flair!.cues).toEqual(cues)

  await deps.settings.update({ capcut: { pro: true } })
  const again = await service.write(folder, DEFAULT_CUT_RULES, result.segmentCount, null, request)
  expect(await written()).toContain(DRAFT_SOUND.effectId)
  expect(again.soundCount).toBe(2)
  expect(again.proLeftOut).toEqual({ exits: 0, sounds: 0 })
})

test("a point on a picture beat gets a label from its scene, up for its stretch but at most 3 s, and written like any text", async () => {
  // a picture beat of the sky before the countdown: 0–10 s of the clip, kept whole
  const sky: Beat = { ...countdown, id: "sky", name: "ท้องฟ้า", kind: "scenes", fromIndex: 0, toIndex: 0, startUs: 0, endUs: s(10), visual: "ท้องฟ้าสีคราม" }
  const scenes: Scene[] = [{ ...scene(0, 10, null), description: "ท้องฟ้าสีครามก่อนปล่อยจรวด", kind: "b-roll" }, scene(10, 31, null)]
  const point: EmphasisPoint = { id: "p0", anchor: { kind: "scene", videoId: CLIP_ID, startUs: s(2), endUs: s(8), beatId: "sky" }, importance: "key", type: "visual", reason: "ภาพเปิด", source: "ai", edited: false }
  const { highlights, folder, claude, outlines, service, deps } = await withHighlights({ beats: [sky, countdown], scenes, highlightAssets: assets, points: [point] })
  claude.reply = { style: "headline", groups: [{ point: 1, lines: [{ quote: "", text: "ฟ้าใส" }], ...PLAIN }] }
  const { preview, dropped } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(dropped).toBe(0)
  expect(textOf(claude.requests[0]!.content)).toContain('[1] ภาพ · สำคัญ · ภาพสวย · ช่วง "ท้องฟ้า" 0:02.0 ยาว 6.0 วิ ฉาก: ท้องฟ้าสีครามก่อนปล่อยจรวด · เหตุผล: ภาพเปิด')
  // from 2 s, where the stretch starts, for 3 s of its 6
  expect(preview.groups).toMatchObject([{ id: "id1", beatId: "sky", source: "ai", scene: true, startUs: 2_000_000, endUs: 5_000_000, lines: [{ index: 0, text: "ฟ้าใส", startUs: 2_000_000, partial: false }] }])
  expect((await outlines.get(folder))!.highlights!.groups).toEqual([
    { id: "id1", source: "ai", edited: false, lines: [{ videoId: CLIP_ID, from: 0, to: 0, text: "ฟ้าใส" }], beatId: "sky", pointId: "p0", scene: { videoId: CLIP_ID, startUs: s(2), endUs: s(8) } },
  ])

  // the write lays it on the timeline like any group
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "bottom", hideSubtitles: false, highlightsOn: true, groupCount: 1, flair: VIEW.flair })
  expect(result.highlightCount).toBe(1)
  const texts = (await readInfo(folder)).materials.texts as { content: string }[]
  expect(texts.map((text) => (JSON.parse(text.content) as { text: string }).text)).toContain("ฟ้าใส")

  // a new transcript of the clip leaves the label: it says no words
  const media = (await deps.inspect(folder)).videos[0]!.path
  await deps.transcripts.put(media, { engine: "whisper-local", model: "large-v3-q5_0", language: "th" }, { ...transcript, words: transcript.words.map((w) => ({ ...w, endUs: w.endUs - 1 })) })
  await highlights.addFromWords(folder, CLIP_ID, [8], 12)
  expect((await outlines.get(folder))!.highlights!.groups.map((group) => group.source)).toEqual(["ai", "user"])
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).groups.map((group) => group.id)).toContain("id1")
})

/* picking again: what stays, and what Claude is shown */

/** A picture beat of the sky before the countdown, 0–10 s of the clip kept whole, and a key point on 2–8 s of it. */
const SKY: Beat = { ...countdown, id: "sky", name: "ท้องฟ้า", kind: "scenes", fromIndex: 0, toIndex: 0, startUs: 0, endUs: s(10), visual: "ท้องฟ้าสีคราม" }
const SKY_SCENES: Scene[] = [{ ...scene(0, 10, null), description: "ท้องฟ้าสีครามก่อนปล่อยจรวด", kind: "b-roll" }, scene(10, 31, null)]
const ON_SKY: EmphasisPoint = { id: "p0", anchor: { kind: "scene", videoId: CLIP_ID, startUs: s(2), endUs: s(8), beatId: "sky" }, importance: "key", type: "visual", reason: "ภาพเปิด", source: "ai", edited: false }

// spec §4.3: an item on a point that does not play now is hidden, not deleted, and that holds for Claude's text too
test("picking again leaves Claude's text on a point that is not on the rough cut now as it was, with its look and sound, for when it comes back", async () => {
  const { highlights, folder, claude, outlines, service } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const handSet = { pattern: "stair" as const, tone: "alt" as const, accent: null, exit: null, edited: true }
  const sound = { anchor: { kind: "highlight" as const, groupId: "id1", line: 0 }, effectId: "claude-on-id1", edited: false }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, looks: { ...stored!.flair!.looks, id1: handSet }, cues: [sound] } }))
  const before = (await outlines.get(folder))!
  // p1's words are all cut, so Claude is asked about p2 alone, now point 1
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4], keep: false })
  claude.reply = { style: "headline", groups: [{ ...REPLY.groups[1]!, point: 1 }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(textOf(claude.requests[1]!.content)).not.toContain("[2]")
  const after = (await outlines.get(folder))!
  // id2, on the point Claude was asked about, is replaced; id1 waits as it was
  expect(after.highlights!.groups.map((group) => [group.id, group.pointId])).toEqual([
    ["id1", "p1"],
    ["id3", "p2"],
  ])
  expect(after.highlights!.groups[0]).toEqual(before.highlights!.groups[0])
  expect(after.flair!.looks.id1).toEqual(handSet)
  expect(after.flair!.cues).toEqual([sound])
  // its words kept again, p1's text shows as it was, in the look the user set
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4], keep: null })
  const [first] = (await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).groups
  expect(first).toMatchObject({ id: "id1", pointId: "p1", look: handSet, lines: [{ text: "ขึ้นไป" }, { text: "อวกาศ!" }] })
})

test("picking again replaces Claude's text on a point that is gone", async () => {
  const { highlights, folder, claude, outlines } = await withHighlights()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  // p1 is taken out of the points without its text: the text's point is gone, so it does not wait for it
  await outlines.update(folder, (stored) => ({ ...stored!, emphasis: { ...stored!.emphasis!, points: stored!.emphasis!.points.filter((point) => point.id !== "p1") } }))
  claude.reply = { style: "headline", groups: [{ ...REPLY.groups[1]!, point: 1 }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect((await outlines.get(folder))!.highlights!.groups.map((group) => [group.id, group.pointId])).toEqual([["id3", "p2"]])
})

test("picking again replaces Claude's text on a point of an earlier transcript: its word numbers mean nothing on the transcript stored now", async () => {
  const { highlights, folder, claude, outlines, deps } = await withHighlights({ beats: [SKY, countdown], scenes: SKY_SCENES, points: [ON_SKY, ...fixturePoints()] })
  claude.reply = { style: "headline", groups: [{ point: 1, lines: [{ quote: "", text: "ฟ้า" }], ...PLAIN }, { ...REPLY.groups[0]!, point: 2 }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  // the clip is transcribed again: p1 and p2 belong to the transcript before, so Claude is asked about the sky alone
  const media = (await deps.inspect(folder)).videos[0]!.path
  await deps.transcripts.put(media, { engine: "whisper-local", model: "large-v3-q5_0", language: "th" }, { ...transcript, words: transcript.words.map((w) => ({ ...w, endUs: w.endUs - 1 })) })
  claude.reply = { style: "headline", groups: [{ point: 1, lines: [{ quote: "", text: "ฟ้าใส" }], ...PLAIN }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(textOf(claude.requests[1]!.content)).not.toContain("[2]")
  expect((await outlines.get(folder))!.highlights!.groups.map((group) => [group.id, group.pointId])).toEqual([["id3", "p0"]])
})

test("a sound the user set on a label Claude replaces with no label on the same stretch moves to the start of the label's beat", async () => {
  const { highlights, folder, claude, outlines } = await withHighlights({ beats: [SKY, countdown], scenes: SKY_SCENES, points: [ON_SKY] })
  claude.reply = { style: "headline", groups: [{ point: 1, lines: [{ quote: "", text: "ฟ้าใส" }], ...PLAIN }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, cues: [{ anchor: { kind: "highlight", groupId: "id1", line: 0 }, effectId: "mine", edited: true }] } }))
  // Claude makes no label this time
  claude.reply = { style: "headline", groups: [] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const after = (await outlines.get(folder))!
  expect(after.highlights!.groups).toEqual([])
  expect(after.flair!.cues).toEqual([{ anchor: { kind: "beat", beatId: "sky", edge: "start" }, effectId: "mine", edited: true }])
})

test("a phrase the cut splits in two is shown to Claude as both rows it is said in, and a line may quote either", async () => {
  const { highlights, folder, claude, outlines, service } = await withHighlights()
  // "ใน" (word 2) is cut from the middle of p1's phrase: the rough cut plays "ขึ้นไป" and "อวกาศใน" as two rows
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [2], keep: false })
  claude.reply = { style: "headline", groups: [{ ...PLAIN, point: 1, lines: [{ quote: "ขึ้นไป", text: "ขึ้นไป" }, { quote: "อวกาศใน", text: "อวกาศใน" }] }] }
  const { dropped } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  // the phrase as the rough cut plays it, and both rows, "…" where the cut took "ใน" out
  expect(textOf(claude.requests[0]!.content)).toContain("“ขึ้นไป … อวกาศ” ในประโยค “ขึ้นไป … อวกาศใน” · เหตุผล: เปิดคลิป")
  expect(dropped).toBe(0)
  expect((await outlines.get(folder))!.highlights!.groups.map((group) => group.lines.map((line) => [line.from, line.to]))).toEqual([
    [
      [0, 2],
      [3, 5],
    ],
  ])
})

test("footage played twice: a point is shown with the rows of its own beat only", async () => {
  const { highlights, folder, claude } = await withHighlights({ beats: [{ ...countdown, id: "hook", name: "เปิด" }, countdown] })
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(textOf(claude.requests[0]!.content)).toContain("“ขึ้นไปในอวกาศ” ในประโยค “ขึ้นไปในอวกาศใน” · เหตุผล: เปิดคลิป")
})

test("a spoken point placed on a beat that plays none of the rough cut's sentences is not offered", async () => {
  // the opening words are also a picture beat, and p1 is put on it: that beat has pieces of picture, no sentences
  const picture: Beat = { ...countdown, id: "picture", name: "ภาพ", kind: "scenes", startUs: s(17.16), endUs: s(18.75) }
  const [opening, countdownPoint] = fixturePoints()
  const onPicture: EmphasisPoint = { ...opening!, anchor: { kind: "speech", videoId: CLIP_ID, from: 0, to: 4, beatId: "picture" } }
  const { highlights, folder, claude } = await withHighlights({ beats: [picture, countdown], points: [onPicture, countdownPoint!] })
  claude.reply = { style: "headline", groups: [{ ...REPLY.groups[1]!, point: 1 }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  const request = textOf(claude.requests[0]!.content)
  expect(request).toContain("[1] คำพูด · สำคัญ · ตัวเลข/ราคา")
  expect(request).not.toContain("[2]")
})

test("Claude's new text is not held back by its text that waits on a point not on the rough cut now", async () => {
  // two points in the opening sentence: "ขึ้นไป" and "อวกาศ"
  const [opening] = fixturePoints()
  const on = (id: string, from: number, to: number): EmphasisPoint => ({ ...opening!, id, anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" } })
  const { highlights, folder, claude, outlines, service } = await withHighlights({ points: [on("pa", 0, 2), on("pb", 3, 4)] })
  // the text on "ขึ้นไป" reaches on to "อวกาศ", and "อวกาศ" gets none of its own
  claude.reply = { style: "headline", groups: [{ ...PLAIN, point: 1, lines: [{ quote: "ขึ้นไป", text: "ขึ้นไป" }, { quote: "อวกาศ", text: "อวกาศ" }] }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  // "ขึ้นไป" is cut, so that text waits; picked again, "อวกาศ" gets text on the same word
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: false })
  claude.reply = { style: "headline", groups: [{ ...PLAIN, point: 1, lines: [{ quote: "อวกาศ", text: "อวกาศ" }] }] }
  const { dropped } = await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect(dropped).toBe(0)
  expect((await outlines.get(folder))!.highlights!.groups.map((group) => [group.id, group.pointId])).toEqual([
    ["id1", "pa"],
    ["id2", "pb"],
  ])
})

/**
 * Two points of the opening sentence, "ขึ้นไป" (pa) and "อวกาศ" (pb). Claude's first text on pa reaches on to "อวกาศ"
 * (id1); then "ขึ้นไป" is cut, so id1 waits, and Claude picks pb text of its own on "อวกาศ" (id2), where the user puts a sound.
 */
async function withWaitingText() {
  const [opening] = fixturePoints()
  const on = (id: string, from: number, to: number): EmphasisPoint => ({ ...opening!, id, anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" } })
  const context = await withHighlights({ points: [on("pa", 0, 2), on("pb", 3, 4)] })
  const { highlights, folder, claude, outlines, service } = context
  claude.reply = { style: "headline", groups: [{ ...PLAIN, point: 1, lines: [{ quote: "ขึ้นไป", text: "ขึ้นไป" }, { quote: "อวกาศ", text: "อวกาศ" }] }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: false })
  claude.reply = { style: "headline", groups: [{ ...PLAIN, point: 1, lines: [{ quote: "อวกาศ", text: "อวกาศ" }] }] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, cues: [{ anchor: { kind: "highlight", groupId: "id2", line: 0 }, effectId: "mine", edited: true }] } }))
  return context
}

test("what the user set on replaced text never follows onto Claude's text that waits: it goes to the new text on its words, else to its beat's start", async () => {
  const { highlights, folder, outlines } = await withWaitingText()
  // picked again with the same answer: the sound goes to the new "อวกาศ" (id3), not to id1's hidden one
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect((await outlines.get(folder))!.flair!.cues).toEqual([{ anchor: { kind: "highlight", groupId: "id3", line: 0 }, effectId: "mine", edited: true }])
  expect((await outlines.get(folder))!.highlights!.groups.map((group) => group.id)).toEqual(["id1", "id3"])
})

test("with no new text on its words, what the user set on replaced text goes to its beat's start, not onto Claude's text that waits", async () => {
  const { highlights, folder, claude, outlines } = await withWaitingText()
  claude.reply = { style: "headline", groups: [] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect((await outlines.get(folder))!.flair!.cues).toEqual([{ anchor: { kind: "beat", beatId: "beat-1", edge: "start" }, effectId: "mine", edited: true }])
})

test("text that waits but that the user edited takes what moves off replaced text, as the user's text always has", async () => {
  const { highlights, folder, claude, outlines } = await withWaitingText()
  // the user edits id1 while it waits: it is theirs now
  await highlights.editLine(folder, "id1", 0, "ขึ้นไปเลย")
  claude.reply = { style: "headline", groups: [] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW)
  expect((await outlines.get(folder))!.flair!.cues).toEqual([{ anchor: { kind: "highlight", groupId: "id1", line: 1 }, effectId: "mine", edited: true }])
})

test("a plan run's stop goes with the text's call", async () => {
  const { highlights, folder, claude } = await withHighlights()
  const stop = new AbortController()
  await highlights.pick(folder, DEFAULT_CUT_RULES, VIEW, stop.signal)
  expect(claude.requests.at(-1)!.signal).toBe(stop.signal)
})

/* a graphic in the place of its point's highlight text */

const pointOn = (id: string, from: number, to: number): EmphasisPoint => ({ id, anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" }, importance: "key", type: "place", reason: "", source: "ai", edited: false })

/**
 * The fixture with two points and the user's own text on each, bound to it: "ขึ้นไป" on pa (group id1), up from 0.15 s,
 * and "อวกาศ" on pb (group id2), which comes up at 1.07 s and so ends pa's there, before its 1.2 s are up.
 */
async function withReplacing(graphics: GraphicCue[], extra: Parameters<typeof withGraphics>[1] = {}) {
  const context = await withGraphics(graphics, extra)
  await storePoints(context.outlines, context.folder, [pointOn("pa", 0, 2), pointOn("pb", 3, 4)])
  await context.highlights.addFromWords(context.folder, CLIP_ID, [0, 1], 12, "beat-1", "pa")
  await context.highlights.addFromWords(context.folder, CLIP_ID, [3], 12, "beat-1", "pb")
  return context
}
const GRAPHICS_OFF = { ...GRAPHICS_ON, flair: { ...GRAPHICS_ON.flair, graphic: false } }

test("a written graphic takes the place of its point's highlight text: the point's group is listed as replaced, and is otherwise the group it was", async () => {
  const { highlights, folder, outlines, service, deps } = await withReplacing([onSpace({ pointId: "pb" })], { renderer: fakeRenderer([spaceJob()]) })
  const shown = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  // pa's text still ends where pb's would come up: a replaced group is timed with the rest
  expect(shown.groups.map((group) => [group.id, group.pointId, group.replaced, group.startUs, group.endUs])).toEqual([
    ["id1", "pa", false, 150_000, 1_070_000],
    ["id2", "pb", true, 1_070_000, 2_270_000],
  ])
  // the graphic plays from the moment the text would have come up, where it was planned
  expect(shown.graphics.map((graphic) => [graphic.pointId, graphic.atUs, graphic.spec.box, graphic.render])).toEqual([["pb", 1_070_000, ON_SPACE.box, "ready"]])
  // with the graphics switched off nothing is replaced, and the groups are the same ones
  const off = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_OFF)
  expect(off.groups.map((group) => group.replaced)).toEqual([false, false])
  const unmarked = (preview: typeof shown) => preview.groups.map(({ replaced: _replaced, ...group }) => group)
  expect(unmarked(shown)).toEqual(unmarked(off))
  // its lines are moments of the clip as before: a sound may go on them, and its piece is named by the text in it
  expect(shown.slots.map((slot) => slot.anchor)).toContainEqual({ kind: "highlight", groupId: "id2", line: 0 })
  expect([shown.slots, shown.pieces]).toEqual([off.slots, off.pieces])
  // the point still has its text, so the emphasis tab offers to make none; nothing is counted as hidden
  expect(shown.emphasis.points.map((point) => [point.id, point.items.text, point.items.graphic])).toEqual([
    ["pa", 1, 0],
    ["pb", 1, 1],
  ])
  expect(shown.hidden).toBe(0)
  // a rough cut with no frame size to draw on (its first kept video is not in the draft's bin) plays no graphic: nothing is replaced
  const blind = createHighlightService({
    outlines,
    timeline: { ...service, compiled: async (...args: Parameters<typeof service.compiled>) => ({ ...(await service.compiled(...args)), canvas: null }) },
    footage: deps,
    graphics: fakeRenderer(),
    styleOf: async () => STYLE,
  })
  const unseen = await blind.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect([unseen.groups.map((group) => group.replaced), unseen.graphics]).toEqual([[false, false], []])
})

test("every group of a replaced point is replaced, and none of another point or of no point", async () => {
  const { highlights, folder } = await withReplacing([onSpace({ pointId: "pa" })])
  // a second group on pa, and the user's own on the countdown, bound to no point
  await highlights.addFromWords(folder, CLIP_ID, [2], 12, "beat-1", "pa")
  await highlights.addFromWords(folder, CLIP_ID, [8], 12, "beat-1")
  const shown = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(shown.groups.map((group) => [group.pointId, group.replaced])).toEqual([
    ["pa", true],
    ["pa", true],
    ["pb", false],
    [undefined, false],
  ])
})

test("a free graphic beside its point's text leaves the text drawn; one over it, written to replace it, takes its place; a legacy one still replaces", { timeout: 20_000 }, async () => {
  const shown = async (graphics: GraphicCue[]) => {
    const { highlights, folder } = await withReplacing(graphics)
    const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
    return { replaced: preview.groups.map((group) => group.replaced), graphics: preview.graphics.map((graphic) => [graphic.from, graphic.replaces, graphic.stale]) }
  }
  // beside pb's text, which is drawn at 0.14–0.41 of the height: the box the fixture's graphics are planned in
  expect(await shown([onSpace({ pointId: "pb", from: "medium", spec: { ...ON_SPACE, replacesText: false } })])).toEqual({ replaced: [false, false], graphics: [["medium", false, false]] })
  // over pb's text, written to take its place
  const over = { ...ON_SPACE, box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.35 }, replacesText: true }
  expect(await shown([onSpace({ pointId: "pb", from: "medium", spec: over })])).toEqual({ replaced: [false, true], graphics: [["medium", true, false]] })
  // over it, but written to stay beside it: stale, so the text is drawn
  expect(await shown([onSpace({ pointId: "pb", from: "medium", spec: { ...over, replacesText: false } })])).toEqual({ replaced: [false, false], graphics: [["medium", false, true]] })
  // from a level louder than the one chosen it does not play, and the text stays
  expect(await shown([onSpace({ pointId: "pb", from: "heavy", spec: over })])).toEqual({ replaced: [false, false], graphics: [] })
  // a legacy one in the box beside the text replaces it all the same
  expect(await shown([onSpace({ pointId: "pb" })])).toEqual({ replaced: [false, true], graphics: [[null, true, false]] })
})

test("a free graphic written to take its secondary point's place stays fresh at the level that hides the point's text", { timeout: 20_000 }, async () => {
  const over = { ...ON_SPACE, box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.35 }, replacesText: true }
  const { highlights, folder, outlines } = await withGraphics([onSpace({ pointId: "pb", from: "light", spec: over })])
  // both points secondary: at light neither's text is drawn
  await storePoints(outlines, folder, [{ ...pointOn("pa", 0, 2), importance: "secondary" }, { ...pointOn("pb", 3, 4), importance: "secondary" }])
  await highlights.addFromWords(folder, CLIP_ID, [0, 1], 12, "beat-1", "pa")
  await highlights.addFromWords(folder, CLIP_ID, [3], 12, "beat-1", "pb")
  const at = async (level: "light" | "medium") => {
    const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...GRAPHICS_ON, flair: { ...GRAPHICS_ON.flair, level } })
    return { replaced: preview.groups.map((group) => group.replaced), graphics: preview.graphics.map((graphic) => [graphic.replaces, graphic.stale]) }
  }
  expect(await at("light")).toEqual({ replaced: [], graphics: [[true, false]] })
  expect(await at("medium")).toEqual({ replaced: [false, true], graphics: [[true, false]] })
})

test("a free graphic over what the picture keeps clear plays 1.5 s at the most, and says so", { timeout: 20_000 }, async () => {
  // a face across the lower half of the frame for the whole clip, where the graphic on อวกาศ is drawn: it was written for 1.7 s
  const { highlights, folder } = await withReplacing([onSpace({ pointId: "pb", from: "medium", spec: { ...ON_SPACE, replacesText: false } })], { scenes: [scene(0, 31, { fromY: 0.5, toY: 0.75 })] })
  const { graphics } = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(graphics.map((graphic) => [graphic.coversKeep, graphic.durationUs])).toEqual([[true, 1_500_000]])
  // clear of the face, it plays its length
  const clear = await withReplacing([onSpace({ pointId: "pb", from: "medium", spec: { ...ON_SPACE, replacesText: false } })], { scenes: [scene(0, 31, { fromY: 0.8, toY: 0.95 })] })
  expect((await clear.highlights.preview(clear.folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics.map((graphic) => [graphic.coversKeep, graphic.durationUs])).toEqual([[false, 1_700_000]])
})

test("at the loudest level a free graphic is judged against the text as it is shown, which is every point's: the same as against the text laid out with every point shown", { timeout: 20_000 }, async () => {
  const over = { ...ON_SPACE, box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.35 }, replacesText: true }
  const { highlights, folder } = await withReplacing([onSpace({ pointId: "pb", from: "medium", spec: over }), graphicAt(s(19.0), { from: "light", spec: { ...SPEC, box: { x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.55 }, replacesText: false } })])
  const at = async (level: "medium" | "heavy") => {
    const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...GRAPHICS_ON, flair: { ...GRAPHICS_ON.flair, level } })
    return { replaced: preview.groups.map((group) => group.replaced), graphics: preview.graphics.map(({ render: _render, poster: _poster, error: _error, ...graphic }) => graphic) }
  }
  // both points are key, so the middle level shows every point too, and lays the text out again to judge by
  const heavy = await at("heavy")
  expect(heavy.replaced).toEqual([false, true])
  expect(heavy).toEqual(await at("medium"))
})

test("a free graphic tied to a point whose words are cut away is hidden; one tied to no point still plays", { timeout: 20_000 }, async () => {
  const beside = { ...ON_SPACE, replacesText: false }
  const { highlights, folder, outlines, service } = await withReplacing([onSpace({ pointId: "pc", from: "medium", spec: beside }), graphicAt(s(19.0), { from: "medium", spec: { ...SPEC, box: { x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.55 }, replacesText: false } })])
  await storePoints(outlines, folder, [pointOn("pa", 0, 2), pointOn("pb", 3, 4), pointOn("pc", 8, 9)])
  const shown = async () => (await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).graphics.map((graphic) => graphic.pointId ?? null)
  // the second plays beside the first, lower, so neither gives way to the other
  expect(await shown()).toEqual(["pc", null])
  // pc's word, สาม at 22.62 s, is cut: pc is on the rough cut no more
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [8], keep: false })
  expect(await shown()).toEqual([null])
})

// many whole fixtures in one test: more than the default five seconds on a cold start
test("a graphic that is not written, stale, switched off, with no room on the frame or made for no point leaves its point's text drawn", { timeout: 20_000 }, async () => {
  const replaced = async (graphics: GraphicCue[], extra: Parameters<typeof withGraphics>[1] = {}) => {
    const { highlights, folder } = await withReplacing(graphics, extra)
    return (await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)).groups.map((group) => group.replaced)
  }
  expect(await replaced([onSpace({ pointId: "pb" })])).toEqual([false, true])
  // planned, and not written yet
  expect(await replaced([graphicAt(s(18.08), { pointId: "pb" })])).toEqual([false, false])
  // written for a word that is not said while it plays now
  expect(await replaced([onSpace({ pointId: "pb", spec: { ...ON_SPACE, words: [{ text: "อวกาศ", atS: 0 }, { text: "นะ", atS: 0.92 }] } })])).toEqual([false, false])
  expect(await replaced([onSpace({ pointId: "pb", off: true })])).toEqual([false, false])
  // the whole frame is to be kept clear: the graphic has no room, and is not listed
  expect(await replaced([onSpace({ pointId: "pb" })], { scenes: [scene(0, 31, { fromY: 0, toY: 1 })] })).toEqual([false, false])
  // the user's own, bound to no point
  expect(await replaced([onSpace()])).toEqual([false, false])
  expect(await replaced([])).toEqual([false, false])
  // how its render stands does not matter: the preview and the write both go by its job, not by a finished render
  expect(await replaced([onSpace({ pointId: "pb" })], { renderer: fakeRenderer([], [[spaceJob(), "Chrome crashed"]]) })).toEqual([false, true])
  expect(await replaced([onSpace({ pointId: "pb" })], { packReady: false })).toEqual([false, true])
})

test("a replaced group still counts in the run of looks: the group after it looks as it did", async () => {
  // four one-word points, each with a group in the same pattern: no pattern runs for more than three groups
  const { highlights, folder, outlines } = await withGraphics([onSpace({ pointId: "b" })])
  await storePoints(outlines, folder, [pointOn("a", 0, 2), pointOn("b", 3, 4), pointOn("c", 8, 9), pointOn("d", 9, 10)])
  for (const [pointId, indexes] of [["a", [0, 1]], ["b", [3]], ["c", [8]], ["d", [9]]] as const) await highlights.addFromWords(folder, CLIP_ID, [...indexes], 12, "beat-1", pointId)
  // Claude's looks, as a pick stores them: one the user set by hand would be kept whatever run it is in
  const punch = { pattern: "punch" as const, tone: "base" as const, accent: null, exit: null, edited: false }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, looks: { id1: punch, id2: punch, id3: punch, id4: punch } } }))
  const shown = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(shown.groups.map((group) => [group.replaced, group.look.pattern])).toEqual([
    [false, "punch"],
    [true, "punch"],
    [false, "punch"],
    [false, "stack"],
  ])
})

test("without CapCut Pro the exits left out are counted over the groups that are written: a replaced group keeps its held exit on its row, uncounted", async () => {
  const { highlights, folder, outlines, deps } = await withReplacing([onSpace({ pointId: "pb" })])
  await deps.settings.update({ capcut: { pro: false } })
  await spinOut(outlines, folder, "id1")
  await spinOut(outlines, folder, "id2")
  const shown = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(shown.groups.map((group) => [group.replaced, group.heldExit?.id])).toEqual([
    [false, "spin-out"],
    [true, "spin-out"],
  ])
  expect(shown.proLeftOut.exits).toBe(1)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_OFF)).proLeftOut.exits).toBe(2)
})

test("the graphics are worked out once for a look at the preview, before the groups are listed", async () => {
  const { highlights, folder, styleOf, renderer } = await withReplacing([onSpace({ pointId: "pb" })])
  const placing = vi.mocked(graphicsCues.graphicsInForce)
  placing.mockClear()
  const shown = await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(shown.groups.map((group) => group.replaced)).toEqual([false, true])
  // the graphics were placed once: what marks the groups is what the graphics' rows are made from
  expect(placing).toHaveBeenCalledTimes(1)
  // with the graphics off they are not placed at all
  placing.mockClear()
  await highlights.preview(folder, DEFAULT_CUT_RULES, GRAPHICS_OFF)
  expect(placing).not.toHaveBeenCalled()
  // one look, one set of jobs, one start of the renders
  expect(styleOf).toHaveBeenCalledTimes(1)
  expect(renderer.ensure).toHaveBeenCalledTimes(1)
  expect(renderer.ensure).toHaveBeenCalledWith([spaceJob()], folder)
})

/* composed sounds */

/** A moment of speech of the fixture's one beat. */
const said = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
/** A sound Claude composed on อวกาศ, 1.07 s into the rough cut, for 1.2 s: อวกาศ as it starts and ใน 0.92 s in are said in it, as they still are. */
const SPACE_SOUND: ComposedSound = {
  anchor: said(s(18.08)),
  from: "medium",
  role: "เสียงวูบขึ้นตอนพูดว่าอวกาศ",
  loudness: "normal",
  seconds: 1.2,
  words: [
    { text: "อวกาศ", atS: 0 },
    { text: "ใน", atS: 0.92 },
  ],
  code: "function compose(ctx, cue, kit) {}",
  version: SOUND_VERSION,
  off: false,
}
/** One for the second countdown, on สาม at 2.92 s, for 2 s, where สอง comes 1.26 s in; it plays at the loudest level only. */
const COUNT_SOUND: ComposedSound = { ...SPACE_SOUND, anchor: said(s(22.62)), from: "heavy", seconds: 2, words: [{ text: "สาม", atS: 0 }, { text: "สอง", atS: 1.26 }] }
/** One switched off on สอง at 4.18 s, never composed, which would play at every level. */
const OFF_SOUND: ComposedSound = { ...SPACE_SOUND, anchor: said(s(23.88)), from: "light", seconds: 0.5, words: [], code: null, off: true }

/** A renderer status that answers ready for every sound, and keeps what it was asked about. */
function readySounds() {
  const asked: ComposedSound[] = []
  const status: SoundStatus = (placed) => (asked.push(placed.sound), { state: "ready", error: null })
  return { status, asked }
}

/** The fixture with these composed sounds and graphics stored, its graphics drawn in the test style, and a library of one free sound. */
async function withComposed(composed: ComposedSound[], extra: { status?: SoundStatus; graphics?: GraphicCue[]; ensure?: (jobs: SoundJob[]) => Promise<void>; problem?: string } = {}) {
  const base = await setup({})
  const highlights = createHighlightService({
    outlines: base.outlines,
    timeline: base.service,
    footage: base.deps,
    sounds: { list: async () => [FREE_SOUND] },
    graphics: fakeRenderer(),
    styleOf: async () => STYLE,
    graphicsReady: async () => true,
    ...(extra.status ? { soundStatus: extra.status } : {}),
    ...(extra.ensure || extra.problem ? { soundRenderer: { ensure: extra.ensure ?? (async () => {}), environmentProblem: () => extra.problem ?? null } } : {}),
  })
  await base.outlines.update(base.folder, (stored) => ({ ...stored!, flair: { looks: {}, composed, graphics: extra.graphics ?? [] } }))
  return { ...base, highlights }
}

test("the preview lists the sounds Claude composed that play at the level in force, then the switched-off ones, with what the renderer made of each", async () => {
  const { status, asked } = readySounds()
  const { highlights, folder } = await withComposed([COUNT_SOUND, OFF_SOUND, SPACE_SOUND], { status })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(preview.composed).toEqual([
    {
      anchor: SPACE_SOUND.anchor,
      // its piece ends at 2.77 s, which leaves it the 1.2 s it was composed for
      atUs: 1_070_000,
      durationUs: 1_200_000,
      beatId: "beat-1",
      role: "เสียงวูบขึ้นตอนพูดว่าอวกาศ",
      from: "medium",
      loudness: "normal",
      graphic: null,
      written: true,
      stale: null,
      writeFailed: null,
      instruction: null,
      editFailed: null,
      canUndo: false,
      off: false,
      render: "ready",
      error: null,
    },
    expect.objectContaining({ anchor: OFF_SOUND.anchor, atUs: 4_180_000, durationUs: 500_000, from: "light", written: false, off: true, render: "pending" }),
  ])
  // only the one that plays as it was composed is asked about
  expect(asked).toEqual([SPACE_SOUND])
  // the countdown's plays at the loudest level, its words said as they were
  const heavy = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...SOUNDS_ON, flair: { ...SOUNDS_ON.flair, level: "heavy" } })
  expect(heavy.composed.map((sound) => [sound.atUs, sound.durationUs, sound.stale, sound.off])).toEqual([
    [1_070_000, 1_200_000, null, false],
    [2_920_000, 2_000_000, null, false],
    [4_180_000, 500_000, null, true],
  ])
  // with the sounds switched off none is listed
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).composed).toEqual([])
})

test("a machine a sound's render found unfit says why while the sounds are on, and nothing while they are off or nothing is known", async () => {
  const problem = "the sound page could not be opened: the app's ffmpeg is missing"
  const { highlights, folder } = await withComposed([SPACE_SOUND], { problem })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)).soundsProblem).toBe(problem)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).soundsProblem).toBeNull()
  const fit = await withComposed([SPACE_SOUND], { ensure: async () => {} })
  expect((await fit.highlights.preview(fit.folder, DEFAULT_CUT_RULES, SOUNDS_ON)).soundsProblem).toBeNull()
  const unwired = await withComposed([SPACE_SOUND])
  expect((await unwired.highlights.preview(unwired.folder, DEFAULT_CUT_RULES, SOUNDS_ON)).soundsProblem).toBeNull()
})

test("a composed sound that no longer plays as it was composed for is listed stale and waits; with no renderer status every one waits", async () => {
  const { status, asked } = readySounds()
  // composed when nothing was said after อวกาศ
  const reworded = { ...SPACE_SOUND, words: [{ text: "อวกาศ", atS: 0 }] }
  const { highlights, folder } = await withComposed([reworded], { status })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)).composed).toMatchObject([{ written: true, stale: "cut", render: "pending", error: null }])
  expect(asked).toEqual([])
  const unwired = await withComposed([SPACE_SOUND])
  expect((await unwired.highlights.preview(unwired.folder, DEFAULT_CUT_RULES, SOUNDS_ON)).composed).toMatchObject([{ written: true, stale: null, render: "pending", error: null }])
})

test("a sound tied to a graphic is listed where the graphic plays, named by the graphic's idea; it is off while the graphic is, gone while graphics are, and stale once the graphic is written again", async () => {
  const tied: ComposedSound = { ...SPACE_SOUND, graphic: onSpace().anchor, graphicHtml: hashOfHtml(FRAGMENT) }
  const { highlights, folder, outlines } = await withComposed([tied], { graphics: [onSpace()], status: readySounds().status })
  const listed = async (options = GRAPHICS_ON) => (await highlights.preview(folder, DEFAULT_CUT_RULES, options)).composed.map((sound) => [sound.atUs, sound.durationUs, sound.graphic, sound.stale, sound.off, sound.render])
  expect(await listed()).toEqual([[1_070_000, 1_200_000, { summary: "จรวดพุ่งขึ้นไปอวกาศ" }, null, false, "ready"]])
  expect(await listed(GRAPHICS_OFF)).toEqual([])
  const graphics = async (graphic: GraphicCue) => outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: [graphic] } }))
  await graphics(onSpace({ off: true, edited: true }))
  expect(await listed()).toEqual([[1_070_000, 1_200_000, { summary: "จรวดพุ่งขึ้นไปอวกาศ" }, null, true, "pending"]])
  await graphics(onSpace({ spec: { ...ON_SPACE, html: `${FRAGMENT}<i></i>` } }))
  expect(await listed()).toEqual([[1_070_000, 1_200_000, { summary: "จรวดพุ่งขึ้นไปอวกาศ" }, "picture", false, "pending"]])
})

test("the user's own CapCut sounds that still play are listed by name, to be taken off; Claude's are not, though they still play", async () => {
  const base = await withComposed([])
  const [first, next] = (await base.highlights.preview(base.folder, DEFAULT_CUT_RULES, SOUNDS_ON)).slots
  const cues = [
    { anchor: first!.anchor, effectId: FREE_SOUND.effectId, edited: false },
    { anchor: next!.anchor, effectId: FREE_SOUND.effectId, edited: true },
  ]
  await base.outlines.update(base.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, cues } }))
  const preview = await base.highlights.preview(base.folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(preview.ownSounds).toEqual([{ anchor: next!.anchor, atUs: next!.atUs, name: FREE_SOUND.use ?? FREE_SOUND.name }])
  expect(preview.cues.map((cue) => cue.edited)).toEqual([false, true])
  expect((await base.highlights.preview(base.folder, DEFAULT_CUT_RULES, VIEW)).ownSounds).toEqual([])
})

test("what plays on each point counts the composed sounds on it that are not switched off", async () => {
  const { highlights, folder, outlines } = await withComposed([{ ...SPACE_SOUND, pointId: "p1" }, { ...OFF_SOUND, pointId: "p1" }, { ...COUNT_SOUND, from: "medium", pointId: "p2" }])
  await storePoints(outlines, folder, fixturePoints())
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(preview.emphasis.points.map((point) => [point.id, point.items.sound])).toEqual([
    ["p1", 1],
    ["p2", 1],
  ])
})

test("the composed sounds are handed to whoever writes or composes them as the preview places them, under the rules and options given", async () => {
  const tied: ComposedSound = { ...SPACE_SOUND, anchor: onSpace().anchor, graphic: onSpace().anchor, graphicHtml: hashOfHtml(FRAGMENT), seconds: 1 }
  const { highlights, folder } = await withComposed([COUNT_SOUND, OFF_SOUND, tied], { graphics: [onSpace()] })
  const placed = await highlights.composedSounds(folder, DEFAULT_CUT_RULES, GRAPHICS_ON)
  expect(placed.kept.map((sound) => [sound.sound, sound.atUs, sound.durationUs, sound.graphic?.cue.anchor, sound.wordsNow, sound.stale])).toEqual([
    [tied, 1_070_000, 1_000_000, onSpace().anchor, [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }], null],
  ])
  expect(placed.off.map((sound) => sound.sound)).toEqual([OFF_SOUND])
  expect(placed.unplaced).toBe(0)
  // planning asks at the loudest level, where the countdown's plays too
  const loudest = await highlights.composedSounds(folder, DEFAULT_CUT_RULES, { ...GRAPHICS_ON, flair: { ...GRAPHICS_ON.flair, level: "heavy" } })
  expect(loudest.kept.map((sound) => sound.sound)).toEqual([tied, COUNT_SOUND])
  // with the graphics switched off the tied one is left out, as the user chose, and not counted as having no place
  const bare = await highlights.composedSounds(folder, DEFAULT_CUT_RULES, GRAPHICS_OFF)
  expect([bare.kept, bare.unplaced]).toEqual([[], 0])
})

test("a composed sound with no place on the rough cut is counted with the stored sounds not playing; one bound to no point whose word the cut took out has none", async () => {
  // the first สาม (19.78 s) is cut as a retake
  const onCutWord = { ...SPACE_SOUND, anchor: said(s(19.78)) }
  const { highlights, folder } = await withComposed([SPACE_SOUND, onCutWord, { ...onCutWord, anchor: said(s(20.66)), off: true }])
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(preview.composed.map((sound) => sound.anchor)).toEqual([SPACE_SOUND.anchor])
  // the switched-off one is not counted
  expect(preview.unusedSounds).toEqual({ unplaced: 1, missing: 0, lost: 0, pro: 0 })
  // with the sounds off nothing is
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, VIEW)).unusedSounds.unplaced).toBe(0)
})

test("the preview starts the renders of the written, fresh sounds that play and have no file, in the background, and asks no more of one already under way", async () => {
  const waiting: (() => void)[] = []
  const asked: SoundJob[][] = []
  const ensure = (jobs: SoundJob[]) => {
    asked.push(jobs)
    return new Promise<void>((resolve) => waiting.push(resolve))
  }
  // nothing is made: every sound waits, unless it has failed
  const states = new Map<string, "pending" | "failed" | "ready">()
  const status: SoundStatus = (placed) => ({ state: states.get(placed.sound.role) ?? "pending", error: null })
  const failed = { ...SPACE_SOUND, anchor: said(s(17.16)), role: "พัง", words: [{ text: "ขึ้น", atS: 0 }, { text: "ไป", atS: 0.28 }, { text: "ใน", atS: 0.52 }, { text: "อวกาศ", atS: 0.92 }] }
  states.set("พัง", "failed")
  const stale = { ...COUNT_SOUND, from: "medium" as const, words: [] }
  const { highlights, folder, outlines } = await withComposed([SPACE_SOUND, OFF_SOUND, stale, failed], { status, ensure })
  // the preview does not wait for the render it started
  const shown = await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(shown.composed.map((sound) => [sound.role, sound.stale, sound.render])).toEqual([
    ["พัง", null, "failed"],
    ["เสียงวูบขึ้นตอนพูดว่าอวกาศ", null, "pending"],
    ["เสียงวูบขึ้นตอนพูดว่าอวกาศ", "cut", "pending"],
    ["เสียงวูบขึ้นตอนพูดว่าอวกาศ", null, "pending"],
  ])
  // only the written, fresh one that plays and waits for its file, with its words as they fall now
  expect(asked).toEqual([[{ code: SPACE_SOUND.code, seconds: 1.2, words: SPACE_SOUND.words, loudness: "normal" }]])
  // while that render is under way, another preview asks nothing more
  await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(asked).toHaveLength(1)
  // once it is over, a sound still without a file is asked for again; a made one is not
  waiting.shift()!()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(asked).toHaveLength(2)
  waiting.shift()!()
  await new Promise((resolve) => setTimeout(resolve, 0))
  states.set(SPACE_SOUND.role, "ready")
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, composed: [SPACE_SOUND] } }))
  await highlights.preview(folder, DEFAULT_CUT_RULES, SOUNDS_ON)
  expect(asked).toHaveLength(2)
})
