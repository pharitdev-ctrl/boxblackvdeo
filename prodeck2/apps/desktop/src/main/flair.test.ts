import { expect, test, vi } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import type { TextPattern } from "@boxblack/core/flair"
import type { HighlightReply } from "@boxblack/core/highlights"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import { MEDIA_PROMPT, type MediaLook } from "@boxblack/core/flair/look-at"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import type { EmphasisPoint } from "@boxblack/core/emphasis/types"
import { MOTION_VERSION, type GraphicCue, type MotionSpec } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import { createFlairService, type FlairDeps } from "./flair.ts"
import type { RenderJob } from "./graphics-render.ts"
import { createHighlightService } from "./highlights.ts"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Beat } from "@boxblack/core/planner"
import { CLIP_ID, countdown, fixturePoints, readInfo, s, segments, setup, storePoints } from "./timeline-fixture.ts"

// the fixture's points: "ขึ้นไปในอวกาศ" (point 1) and the second countdown (point 2); the looks come with the text
const HIGHLIGHTS: HighlightReply = {
  style: "sale-yellow",
  groups: [
    { point: 1, lines: [{ quote: "ขึ้นไป", text: "ขึ้นไป" }, { quote: "อวกาศ", text: "อวกาศ 500" }], pattern: "bar", tone: "base", accentLine: 2, accentWord: "500", exit: "" },
    { point: 2, lines: [{ quote: "สาม", text: "3" }], pattern: "punch", tone: "base", accentLine: 0, accentWord: "", exit: "" },
  ],
}

/** One transport for every call: it answers the picture-describing call on its own and the rest with whichever reply the test set last. */
function fakeClaude() {
  const requests: LlmRequest<unknown>[] = []
  const claude = {
    requests,
    reply: HIGHLIGHTS as unknown,
    pictures: { pictures: [{ picture: 1, what: "เล็บสีชมพู", subject: [], fit: "card" }] } as unknown,
    llm: async () => ({ transport, model: "claude-sonnet-5" }),
  }
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const looking = request.system === MEDIA_PROMPT.system
      return { output: (looking ? claude.pictures : claude.reply) as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return claude
}

const view = (flair: FlairOptions) => ({ position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair })
const ON = view({ enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false })
/** Every work switched off; the old switch for all flair is off too, and no longer means anything. */
const OFF = view({ enabled: false, level: "medium", text: false, sound: false, zoom: false, insert: false, graphic: false })

const assets = {
  fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`,
  animationPath: async (id: string) => `/effect/${id}/hash`,
}

const SOUNDS = [
  { effectId: "s1", name: "ปัง", durationUs: 330_000, path: "/cache/s1.mp3" },
  { effectId: "s2", name: "ฟิ้ว", durationUs: 3_000_000, path: null },
]

const PICTURES = [
  { binId: "m1", path: "/pics/nail.jpg", name: "IMG_1.JPG", kind: "photo" as const, width: 3024, height: 4032, durationUs: 5_000_000 },
  { binId: "m2", path: "/clips/shop.mp4", name: "IMG_2.MOV", kind: "video" as const, width: 1080, height: 1920, durationUs: 2_000_000 },
]

async function withFlair(sounds = SOUNDS, pictures = PICTURES, beats?: Beat[], extra: Partial<FlairDeps> = {}) {
  const library = { list: async () => sounds }
  const media = { list: async () => pictures }
  const looks = new Map<string, MediaLook>()
  const descriptions = {
    entry: async (path: string) => ({
      get: async () => looks.get(path) ?? null,
      put: async (value: MediaLook) => void looks.set(path, value),
    }),
  }
  const frameDir = await mkdtemp(join(tmpdir(), "boxblack-frames-"))
  // each planning looks at pictures in a session of its own, which is over once the plan is made
  const lookings: { pictures: string[]; moments: { path: string; timesUs: number[] }[]; over: boolean }[] = []
  const base = await setup({ highlightAssets: assets, sounds: library, media, ...(beats ? { beats } : {}) })
  const claude = fakeClaude()
  let n = 0
  const highlights = createHighlightService({
    outlines: base.outlines,
    timeline: base.service,
    footage: base.deps,
    llm: claude.llm,
    newId: () => `id${++n}`,
    sounds: library,
    media,
    descriptions: async (paths) => Object.fromEntries(paths.flatMap((path) => (looks.has(path) ? [[path, looks.get(path)!]] : []))),
  })
  const flair = createFlairService({
    outlines: base.outlines,
    timeline: base.service,
    llm: claude.llm,
    sounds: library,
    // read from settings, as the app wires it
    pro: async () => (await base.deps.settings.read()).capcut.pro,
    media,
    descriptions,
    frames: () => {
      lookings.push({ pictures: [], moments: [], over: false })
      const looking = lookings.at(-1)!
      return {
        of: async (picture: { binId: string }) => {
          looking.pictures.push(picture.binId)
          const path = join(frameDir, `${picture.binId}.jpg`)
          await writeFile(path, Buffer.from([1]))
          return [path]
        },
        at: async (path: string, timesUs: number[]) => {
          looking.moments.push({ path, timesUs })
          return Promise.all(
            timesUs.map(async (us) => {
              const frame = join(frameDir, `${lookings.length}-${us}.jpg`)
              await writeFile(frame, Buffer.from([1]))
              return frame
            }),
          )
        },
        dispose: async () => {
          looking.over = true
        },
      }
    },
    ...extra,
  })
  // the points the text is picked from, in the first beat as the sentences the old replies named were
  await storePoints(base.outlines, base.folder, fixturePoints(beats?.[0]?.id))
  await highlights.pick(base.folder, DEFAULT_CUT_RULES, OFF)
  return { ...base, highlights, flair, claude, lookings }
}

test("with the looks off the groups are plain, whatever is stored", async () => {
  const { highlights, folder } = await withFlair()
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, OFF)
  expect(preview.groups.map((group) => group.look.pattern)).toEqual(["stack", "stack"])
})

test("a stored look shows at every level, the lightest included", async () => {
  const { folder, highlights } = await withFlair()
  const light = await highlights.preview(folder, DEFAULT_CUT_RULES, view({ enabled: true, level: "light", text: true, sound: true, zoom: true, insert: true, graphic: false }))
  expect(light.groups.map((group) => group.look.pattern)).toEqual(["bar", "punch"])
})

test("a look set by hand can be cleared again, and a word that is not in the line is refused", async () => {
  const { flair, folder, highlights } = await withFlair()
  const [, second] = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  await flair.setLook(folder, second!.id, { accent: { line: 0, word: "3" } })
  await flair.setLook(folder, second!.id, { accent: null })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups[1]!.look.accent).toBeNull()
  await expect(flair.setLook(folder, second!.id, { accent: { line: 0, word: "ไม่มีคำนี้" } })).rejects.toThrow(/is not in line 1/)
  await expect(flair.setLook(folder, "nope", { pattern: "bar" })).rejects.toThrow(/unknown highlight group/)
  await expect(flair.setLook(folder, second!.id, { exit: "made-up" })).rejects.toThrow(/unknown exit animation/)
})

test("a word coloured on a line whose line above was cut is looked up in that line, and coloured there", async () => {
  const { flair, folder, highlights, service, outlines } = await withFlair()
  // the words of "ขึ้นไป", the first line of the first group, are cut: "อวกาศ 500" is shown first
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: false })
  const [first] = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  expect(first!.lines.map((line) => [line.index, line.text])).toEqual([[1, "อวกาศ 500"]])
  await flair.setLook(folder, first!.id, { accent: { line: 0, lineIndex: 1, word: "500" } })
  // kept by the line it is on, not by where that line happens to show
  expect((await outlines.get(folder))!.flair!.looks[first!.id]!.accent).toEqual({ line: 1, from: 6, to: 9 })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups[0]!.look.accent).toEqual({ line: 0, from: 6, to: 9 })

  // "ขึ้นไป" kept again: the colour stays on "อวกาศ 500", now the second line
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: null })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups[0]!.look.accent).toEqual({ line: 1, from: 6, to: 9 })
})

test("a sound on a line of highlight text stays with that line when the line above it is cut", async () => {
  const { flair, folder, highlights, service } = await withFlair()
  // the loudest level has room for a sound on each line of this short clip
  const LOUD = view({ ...ON.flair, level: "heavy" })
  const lineSlot = async (text: string) => (await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)).slots.find((slot) => slot.what.includes(`"${text}"`))!
  await flair.setCue(folder, (await lineSlot("ขึ้นไป")).anchor, "s1")
  await flair.setCue(folder, (await lineSlot("อวกาศ 500")).anchor, "s2")

  // the words of "ขึ้นไป" are cut: its sound goes with it, and "อวกาศ 500" keeps its own
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: false })
  const cut = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  expect(cut.cues.map((cue) => [cue.effectId, cue.what])).toEqual([["s2", 'ข้อความเด่น "อวกาศ 500" บรรทัด 1']])

  // kept again, each sound is back on its own line
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: null })
  const back = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  expect(back.cues.map((cue) => [cue.effectId, cue.what])).toEqual([
    ["s1", 'ข้อความเด่น "ขึ้นไป" บรรทัด 1'],
    ["s2", 'ข้อความเด่น "อวกาศ 500" บรรทัด 2'],
  ])
})

test("a line of highlight text taken out takes its sound with it, and the line below keeps its sound, cutaway and coloured word", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const group = before.groups[0]!
  const slotOf = (text: string) => before.slots.find((slot) => slot.what.includes(`"${text}"`))!
  await flair.setCue(folder, slotOf("ขึ้นไป").anchor, "s1")
  await flair.setCue(folder, slotOf("อวกาศ 500").anchor, "s2")
  await flair.setInsert(folder, slotOf("อวกาศ 500").anchor, "m1")
  await flair.setLook(folder, group.id, { accent: { line: 1, lineIndex: 1, word: "500" } })

  await highlights.editLine(folder, group.id, 0, null)
  const after = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(after.groups[0]!.lines.map((line) => line.text)).toEqual(["อวกาศ 500"])
  expect(after.cues.map((cue) => [cue.effectId, cue.what])).toEqual([["s2", 'ข้อความเด่น "อวกาศ 500" บรรทัด 1']])
  expect(after.inserts.map((insert) => [insert.binId, insert.what])).toEqual([["m1", 'ข้อความเด่น "อวกาศ 500" บรรทัด 1']])
  expect(after.groups[0]!.look.accent).toEqual({ line: 0, from: 6, to: 9 })
  // the sound of the line taken out is gone from the project, not waiting on a line that is not there
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => cue.effectId)).toEqual(["s2"])
})

test("a line of highlight text edited in place keeps its sound", async () => {
  const { flair, folder, highlights } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const slot = before.slots.find((entry) => entry.what.includes('"อวกาศ 500"'))!
  await flair.setCue(folder, slot.anchor, "s2")
  await highlights.editLine(folder, before.groups[0]!.id, 0, "ขึ้นไปเลย")
  const after = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(after.cues.map((cue) => [cue.effectId, cue.what])).toEqual([["s2", 'ข้อความเด่น "อวกาศ 500" บรรทัด 2']])
})

test("the write colours the word on the line it belongs to when a line above it is cut", async () => {
  const { flair, folder, highlights, service } = await withFlair()
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: false })
  const [first] = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  await flair.setLook(folder, first!.id, { accent: { line: 0, lineIndex: 1, word: "500" } })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: preview.groups.length, flair: ON.flair })

  const texts = (await readInfo(folder)).materials.texts as { content: string }[]
  const accented = texts.find((text) => (JSON.parse(text.content) as { text: string }).text === "อวกาศ 500")!
  expect((JSON.parse(accented.content) as { styles: { range: number[] }[] }).styles.map((style) => style.range)).toEqual([
    [0, 6],
    [6, 9],
  ])
})

test("a patch changes only what it names, and the catalogue rules what it may say", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const [first] = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  await flair.setLook(folder, first!.id, { accent: { line: 0, word: "ขึ้นไป" } })
  await flair.setLook(folder, first!.id, { pattern: "stair" })
  const kept = (await outlines.get(folder))!.flair!.looks[first!.id]!
  expect(kept).toEqual({ pattern: "stair", tone: "base", accent: { line: 0, from: 0, to: 6 }, exit: null, edited: true })

  await flair.setLook(folder, first!.id, { exit: "fade-out" })
  expect((await outlines.get(folder))!.flair!.looks[first!.id]!.exit).toBe("fade-out")
  await flair.setLook(folder, first!.id, { exit: null })
  expect((await outlines.get(folder))!.flair!.looks[first!.id]!.exit).toBeNull()
  await expect(flair.setLook(folder, first!.id, { pattern: "made-up" as TextPattern })).rejects.toThrow(/unknown pattern/)
})

test("the write lays the groups out the way the preview showed them", async () => {
  const { highlights, folder, service } = await withFlair()
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(preview.groups[0]!.look.pattern).toBe("bar")
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: preview.groups.length, flair: ON.flair })

  const info = await readInfo(folder)
  // the first group has bars: one sticker track per line slot, under the text tracks
  expect(info.tracks.filter((track) => track.type === "sticker")).toHaveLength(2)
  const [bar] = info.tracks.filter((track) => track.type === "sticker")[0]!.segments
  const shapes = (info.materials.shapes ?? []) as { id: string; shape_size: number[] }[]
  expect(shapes.find((shape) => shape.id === bar!.material_id)!.shape_size[0]).toBeGreaterThan(0)

  // the accented word is its own style on the line that says it
  const texts = info.materials.texts as { id: string; content: string }[]
  const accented = texts.find((text) => (JSON.parse(text.content) as { text: string }).text === "อวกาศ 500")!
  const styles = (JSON.parse(accented.content) as { styles: { range: number[] }[] }).styles
  expect(styles.map((style) => style.range)).toEqual([
    [0, 6],
    [6, 9],
  ])

  // with the looks off the same groups are written plain
  await service.write(folder, DEFAULT_CUT_RULES, segments(info), null, {
    position: "auto",
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: preview.groups.length,
    flair: OFF.flair,
  })
  const plain = await readInfo(folder)
  expect(plain.tracks.some((track) => track.type === "sticker")).toBe(false)
})

test("a look for a group that is gone is never used", async () => {
  const { folder, highlights, outlines } = await withFlair()
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const stored = (await outlines.get(folder))!
  expect(Object.keys(stored.flair!.looks)).toEqual(preview.groups.map((group) => group.id))

  // the clip is transcribed again: the groups go, and their looks are simply never asked for
  await outlines.put({ ...stored, highlights: { ...stored.highlights!, transcripts: { [Object.keys(stored.highlights!.transcripts)[0]!]: "other" } } })
  const after = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(after.groups).toEqual([])
  expect((await outlines.get(folder))!.flair!.looks).toEqual(stored.flair!.looks)
})


test("a sound that says in Thai what it is for is shown by that, not by CapCut's catalogue title", async () => {
  const labelled = [{ effectId: "s1", name: "Culin. It looks like a light bulb mark is on the head.", durationUs: 1_000_000, path: null, use: "ไอเดียผุด นึกออก" }]
  const { flair, folder, highlights } = await withFlair(labelled)
  await flair.setCue(folder, (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).slots[0]!.anchor, "s1")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(preview.sounds).toEqual([{ effectId: "s1", name: "ไอเดียผุด นึกออก" }])
  expect(preview.cues[0]).toMatchObject({ effectId: "s1", soundName: "ไอเดียผุด นึกออก" })
})

test("a sound I chose myself plays, and can be taken off", async () => {
  const { flair, folder, highlights } = await withFlair()
  const slot = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).slots[1]!
  await flair.setCue(folder, slot.anchor, "s2")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).cues).toMatchObject([{ effectId: "s2", edited: true }])

  await flair.setCue(folder, slot.anchor, null)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).cues.every((cue) => cue.effectId !== "s2")).toBe(true)
  await expect(flair.setCue(folder, slot.anchor, "nope")).rejects.toThrow(/no sound/)
})

test("the write puts the sounds on their own audio track, and cuts a long one short", async () => {
  const { flair, folder, service, highlights } = await withFlair()
  // the fixture's rough cut is under six seconds, so two sounds need the loudest level
  const loud = view({ enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: false })
  const slots = (await highlights.preview(folder, DEFAULT_CUT_RULES, loud)).slots
  await flair.setCue(folder, slots[0]!.anchor, "s1")
  // a three second sound on the closing place has only the half second before the last frame
  await flair.setCue(folder, slots.at(-1)!.anchor, "s2")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, loud)
  expect(preview.cues).toHaveLength(2)

  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, {
    position: "auto",
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: preview.groups.length,
    flair: loud.flair,
  })
  expect(result.soundCount).toBe(2)

  const info = await readInfo(folder)
  const audio = info.tracks.filter((track) => track.type === "audio")
  expect(audio).toHaveLength(1)
  expect(audio[0]!.segments.map((segment) => segment.target_timerange.duration)).toEqual([330_000, 500_000])
  const materials = info.materials.audios as { effect_id: string; path: string }[]
  expect(materials.map((entry) => [entry.effect_id, entry.path])).toEqual([
    ["s1", "/cache/s1.mp3"],
    ["s2", ""],
  ])
})

test("a sound on a line of highlight text starts on the frame the text does, not on the unrounded cut", async () => {
  const { flair, folder, service, highlights } = await withFlair()
  const preview0 = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const line = preview0.slots.find((slot) => slot.anchor.kind === "highlight")!
  await flair.setCue(folder, line.anchor, "s1")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: preview.groups.length, flair: ON.flair })
  const info = await readInfo(folder)
  const text = info.tracks.filter((track) => track.type === "text").flatMap((track) => track.segments.map((segment) => segment.target_timerange.start))
  const [sound] = info.tracks.find((track) => track.type === "audio")!.segments
  expect(text).toContain(sound!.target_timerange.start)
})

test("with the sounds switched off nothing plays or is written, and what is stored stays", async () => {
  const { flair, folder, service, highlights, outlines } = await withFlair()
  await flair.setCue(folder, (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).slots[0]!.anchor, "s1")
  const quiet = view({ enabled: true, level: "medium", text: true, sound: false, zoom: true, insert: true, graphic: false })
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, quiet)
  expect(preview.cues).toEqual([])
  expect(preview.slots).toEqual([])

  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, {
    position: "auto",
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: preview.groups.length,
    flair: quiet.flair,
  })
  expect(result.soundCount).toBe(0)
  expect((await readInfo(folder)).tracks.some((track) => track.type === "audio")).toBe(false)
  // waiting for the sounds to be switched back on
  expect((await outlines.get(folder))!.flair!.cues).toMatchObject([{ effectId: "s1", edited: true }])
})


test("a zoom I chose myself plays, and can be taken off", async () => {
  const { flair, folder, highlights } = await withFlair()
  const piece = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).pieces[0]!
  await flair.setZoom(folder, piece.anchor, "drift")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).zooms).toMatchObject([{ kind: "drift", edited: true }])

  await flair.setZoom(folder, piece.anchor, null)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).zooms).toEqual([])
  await expect(flair.setZoom(folder, piece.anchor, "swoop" as never)).rejects.toThrow(/unknown zoom/)
})

test("the write keyframes the pieces the preview said would move", async () => {
  const { flair, folder, service, highlights } = await withFlair()
  const piece = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).pieces[0]!
  await flair.setZoom(folder, piece.anchor, "punch")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(preview.zooms).toHaveLength(1)

  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, {
    position: "auto",
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: preview.groups.length,
    flair: ON.flair,
  })
  expect(result.zoomCount).toBe(1)

  const info = await readInfo(folder)
  const keyframed = info.tracks[0]!.segments.filter((segment) => (segment.common_keyframes ?? []).length > 0)
  expect(keyframed).toHaveLength(1)
  const scale = keyframed[0]!.common_keyframes!.find((entry) => entry.property_type === "KFTypeScaleX")!
  // the punch waits for the highlight line inside the piece, so it holds at 1 until then
  expect(scale.keyframe_list.map((entry) => entry.values[0])).toEqual([1, 1, 1.15])
  expect(scale.keyframe_list[1]!.time_offset).toBe(keyframed[0]!.source_timerange!.start + (preview.groups[0]!.lines[0]!.startUs - preview.pieces[0]!.atUs))

  // with the zooms off the same piece is written still
  const quiet = view({ enabled: true, level: "medium", text: true, sound: true, zoom: false, insert: true, graphic: false })
  await service.write(folder, DEFAULT_CUT_RULES, segments(info), null, {
    position: "auto",
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: preview.groups.length,
    flair: quiet.flair,
  })
  expect((await readInfo(folder)).tracks[0]!.segments.every((segment) => (segment.common_keyframes ?? []).length === 0)).toBe(true)
})


test("setting a zoom by hand keeps the sounds", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  await flair.setZoom(folder, preview.pieces[0]!.anchor, "drift")
  await flair.setCue(folder, preview.slots[0]!.anchor, "s1")
  await flair.setZoom(folder, preview.pieces[0]!.anchor, "punch")
  const stored = (await outlines.get(folder))!.flair!
  expect(stored.zooms).toMatchObject([{ kind: "punch", edited: true }])
  expect(stored.cues).toMatchObject([{ effectId: "s1", edited: true }])
})


/** The countdown played twice: first as the hook, then in its place. */
const TWICE: Beat[] = [{ ...countdown, id: "hook", name: "เปิด" }, countdown]
const LOUD = view({ enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: false })

test("footage played in two beats can be zoomed in each, and each zoom stays in its own beat", async () => {
  const { flair, folder, highlights, service } = await withFlair(SOUNDS, PICTURES, TWICE)
  const { pieces } = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  const later = pieces.find((piece) => piece.beatId === "beat-1")!
  const hook = pieces.find((piece) => piece.beatId === "hook" && piece.anchor.sourceUs === later.anchor.sourceUs)!
  await flair.setZoom(folder, hook.anchor, "punch")
  await flair.setZoom(folder, later.anchor, "drift")
  const both = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  expect(both.zooms.map((zoom) => [zoom.beatId, zoom.atUs, zoom.kind])).toEqual([
    ["hook", hook.atUs, "punch"],
    ["beat-1", later.atUs, "drift"],
  ])

  // the write keyframes those two pieces and no other
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: both.groups.length, flair: LOUD.flair })
  const keyframed = (await readInfo(folder)).tracks[0]!.segments.filter((segment) => (segment.common_keyframes ?? []).length > 0)
  expect(keyframed.map((segment) => segment.target_timerange.start)).toEqual([hook.atUs, later.atUs])

  // taking one off leaves the other
  await flair.setZoom(folder, hook.anchor, null)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)).zooms.map((zoom) => [zoom.beatId, zoom.kind])).toEqual([["beat-1", "drift"]])
})

test("a zoom saved before zooms knew their beat is changed and taken off by the anchor its piece has now", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const piece = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).pieces[0]!
  const before = { videoId: piece.anchor.videoId, sourceUs: piece.anchor.sourceUs }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...(stored!.flair ?? { looks: {} }), zooms: [{ anchor: before, kind: "punch", edited: true }] } }))
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).zooms).toMatchObject([{ kind: "punch", anchor: piece.anchor }])

  await flair.setZoom(folder, piece.anchor, "drift")
  expect((await outlines.get(folder))!.flair!.zooms).toEqual([{ anchor: piece.anchor, kind: "drift", edited: true }])
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, zooms: [{ anchor: before, kind: "punch", edited: true }] } }))
  await flair.setZoom(folder, piece.anchor, null)
  expect((await outlines.get(folder))!.flair!.zooms).toEqual([])
})

test("on footage two beats both play, a zoom, a join's sound and a cutaway saved before they knew their beat keep their place when the other beat gets its own", async () => {
  const { flair, folder, highlights, outlines } = await withFlair(SOUNDS, PICTURES, TWICE)
  const first = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  const laterPiece = first.pieces.find((piece) => piece.beatId === "beat-1")!
  const hookPiece = first.pieces.find((piece) => piece.beatId === "hook" && piece.anchor.sourceUs === laterPiece.anchor.sourceUs)!
  const hookJoin = first.slots.find((slot) => slot.anchor.kind === "cut" && slot.beatId === "hook")!
  const laterJoin = first.slots.find((slot) => slot.anchor.kind === "cut" && slot.beatId === "beat-1" && (slot.anchor as { sourceUs: number }).sourceUs === (hookJoin.anchor as { sourceUs: number }).sourceUs)!
  const bare = <T extends { beatId?: string }>({ beatId: _beat, ...anchor }: T) => anchor
  // what 0.1.10 would have saved: no beats. The zoom plays in the later beat, the sound and the cutaway in the hook
  await outlines.update(folder, (stored) => ({
    ...stored!,
    flair: {
      ...(stored!.flair ?? { looks: {} }),
      zooms: [{ anchor: bare(laterPiece.anchor), kind: "drift", edited: true }],
      cues: [{ anchor: bare(hookJoin.anchor as { kind: "cut"; videoId: string; sourceUs: number; beatId?: string }), effectId: "s1", edited: true }],
      inserts: [{ anchor: speech(s(18.08)), binId: "m1", edited: true, fit: "cover" }],
    },
  }))
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  expect(before.zooms.map((zoom) => zoom.beatId)).toEqual(["beat-1"])
  expect(before.cues.map((cue) => cue.beatId)).toEqual(["hook"])
  expect(before.inserts.map((insert) => insert.beatId)).toEqual(["hook"])

  // the other beat gets its own on the same footage: the ones saved before stay where they were
  await flair.setZoom(folder, hookPiece.anchor, "punch")
  await flair.setCue(folder, laterJoin.anchor, "s1")
  await flair.setInsert(folder, { ...speech(s(18.08)), beatId: "beat-1" }, "m2")
  const after = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  expect(after.zooms.map((zoom) => [zoom.beatId, zoom.kind])).toEqual([
    ["hook", "punch"],
    ["beat-1", "drift"],
  ])
  expect(after.cues.map((cue) => cue.beatId).sort()).toEqual(["beat-1", "hook"])
  expect(after.inserts.map((insert) => [insert.beatId, insert.binId]).sort()).toEqual([
    ["beat-1", "m2"],
    ["hook", "m1"],
  ])
})

test("the preview does not write the outline for something saved without a beat that has no place on the cut", async () => {
  const { folder, highlights, outlines } = await withFlair(SOUNDS, PICTURES, TWICE)
  // a zoom from 0.1.10 on footage no beat plays any more
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...(stored!.flair ?? { looks: {} }), zooms: [{ anchor: { videoId: CLIP_ID, sourceUs: 1 }, kind: "punch", edited: true }] } }))
  const put = vi.spyOn(outlines, "put")
  await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  expect(put).not.toHaveBeenCalled()
})

test("a beat change that lands while the preview works out beats is not overwritten with beats from before it", async () => {
  const { folder, highlights, outlines } = await withFlair(SOUNDS, PICTURES, TWICE)
  const { pieces } = await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  const later = pieces.find((piece) => piece.beatId === "beat-1")!
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...(stored!.flair ?? { looks: {} }), zooms: [{ anchor: { videoId: later.anchor.videoId, sourceUs: later.anchor.sourceUs }, kind: "punch", edited: true }] } }))
  // the later beat is taken out just before the preview writes what it found
  const update = outlines.update.bind(outlines)
  let raced = false
  outlines.update = async (target, change) => {
    if (!raced) {
      raced = true
      await update(target, (stored) => ({ ...stored!, outline: { ...stored!.outline, beats: stored!.outline.beats.filter((beat) => beat.id !== "beat-1") } }))
    }
    return update(target, change)
  }
  await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)
  outlines.update = update
  // the zoom is not tied to the beat that is gone: the next look finds it on the hook
  expect((await outlines.get(folder))!.flair!.zooms![0]!.anchor.beatId).not.toBe("beat-1")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, LOUD)).zooms.map((zoom) => zoom.beatId)).toEqual(["hook"])
})

// the fixture's first spoken sentence is ขึ้นไปในอวกาศใน; อวกาศ starts at 18.08 s of the source
const speech = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs })

test("a cutaway I put on a sentence myself plays there, and comes off by its own anchor", async () => {
  const { flair, folder, highlights } = await withFlair()
  // the second sentence the cut plays starts at สาม, 22.62 s
  await flair.setInsert(folder, speech(s(22.62)), "m2")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).inserts).toMatchObject([{ binId: "m2", edited: true, what: "ที่ “สามสองหนึ่ง” ตรงคำว่า “สาม”" }])

  await flair.setInsert(folder, speech(s(22.62)), null)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).inserts.every((insert) => insert.binId !== "m2")).toBe(true)
  await expect(flair.setInsert(folder, speech(s(22.62)), "nope")).rejects.toThrow(/no picture/)
})

test("cutaways stacked at one place are changed and taken off one at a time, each named by its picture", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  // two of the user's at one moment, as a deleted point's text leaves them at its beat's start
  const at = speech(s(22.62))
  await outlines.update(folder, (stored) => ({
    ...stored!,
    flair: {
      ...stored!.flair!,
      inserts: [
        { anchor: at, binId: "m1", edited: true, fit: "cover", subject: null },
        { anchor: at, binId: "m2", edited: true, fit: "cover", subject: null },
      ],
    },
  }))
  const stack = async () => (await outlines.get(folder))!.flair!.inserts!.map((insert) => [insert.binId, insert.fit])
  // the second sits as a card; the first stays as it was
  await flair.setInsert(folder, at, "m2", "card", "m2")
  expect(await stack()).toEqual([
    ["m1", "cover"],
    ["m2", "card"],
  ])
  // the same picture picked again keeps how that one, not the first there, was framed
  await flair.setInsert(folder, at, "m2", undefined, "m2")
  expect(await stack()).toEqual([
    ["m1", "cover"],
    ["m2", "card"],
  ])
  // the first changed keeps its place in the stack, so what plays over what stays as it was
  await flair.setInsert(folder, at, "m1", "card", "m1")
  expect(await stack()).toEqual([
    ["m1", "card"],
    ["m2", "card"],
  ])
  // one taken off leaves the other
  await flair.setInsert(folder, at, null, undefined, "m1")
  expect(await stack()).toEqual([["m2", "card"]])
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).inserts.map((insert) => insert.binId)).toEqual(["m2"])
  // a picture no cutaway there shows is refused, rather than another stacked or the rest replaced
  await expect(flair.setInsert(folder, at, "m2", undefined, "m1")).rejects.toThrow(/no cutaway of that picture/)
  expect(await stack()).toEqual([["m2", "card"]])
  // with none named, every cutaway at the place gives way, as a fresh pick does
  await flair.setInsert(folder, at, "m1")
  expect(await stack()).toEqual([["m1", "cover"]])
})

test("a sentence the user cuts takes its cutaway with it", async () => {
  const { flair, folder, highlights, service } = await withFlair()
  await flair.setInsert(folder, speech(s(22.62)), "m2")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).inserts).toHaveLength(1)
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [8, 9, 10], keep: false })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).inserts).toEqual([])
})

test("the write lays the cutaways over the picture on their own track, at the word's time", async () => {
  const { flair, folder, service, highlights } = await withFlair()
  await flair.setInsert(folder, speech(s(18.08)), "m1")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(preview.inserts).toHaveLength(1)

  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, {
    position: "auto",
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: preview.groups.length,
    flair: ON.flair,
  })
  expect(result.insertCount).toBe(1)

  const info = await readInfo(folder)
  const overlay = info.tracks.filter((track) => track.type === "video" && track.flag === 2)
  expect(overlay).toHaveLength(1)
  const [segment] = overlay[0]!.segments
  expect(Math.abs(segment!.target_timerange.start - preview.inserts[0]!.atUs)).toBeLessThan(33_334)
  const material = (info.materials.videos as { id: string; local_material_id: string; path: string }[]).find((entry) => entry.id === segment!.material_id)!
  expect(material).toMatchObject({ local_material_id: "m1", path: "/pics/nail.jpg" })

  // with the cutaways off the same project is written without the overlay
  const quiet = view({ enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: false, graphic: false })
  await service.write(folder, DEFAULT_CUT_RULES, segments(info), null, {
    position: "auto",
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: preview.groups.length,
    flair: quiet.flair,
  })
  expect((await readInfo(folder)).tracks.some((track) => track.type === "video" && track.flag === 2)).toBe(false)
})


test("the custom style draws in the user's own colours from settings, with strokes and bar text worked out for them", async () => {
  const { folder, highlights, service, deps } = await withFlair()
  await deps.settings.update({ highlights: { custom: { text: [0, 1, 0], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0, 0, 0] } } })
  await highlights.setStyle(folder, "custom")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(preview.style).toBe("custom")
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: preview.groups.length, flair: ON.flair })
  const info = await readInfo(folder)
  const texts = (info.materials.texts as { type: string; text_color: string; border_color: string; content: string }[]).filter((text) => text.type === "text")
  expect(texts.length).toBeGreaterThan(0)
  // green text takes a black stroke; text on the black bar is white and unstroked
  expect(texts.some((text) => text.text_color === "#00ff00" && text.border_color === "#000000")).toBe(true)
  expect(texts.some((text) => text.text_color === "#ffffff" && text.border_color === "")).toBe(true)
  const shapes = info.materials.shapes as { fill_render_style: { color: { solid: { color: string } } } }[]
  expect(shapes.every((shape) => shape.fill_render_style.color.solid.color === "#000000")).toBe(true)
})

test("sounds all play however close together, and two that overlap are written on two audio tracks", async () => {
  const { flair, folder, highlights, service } = await withFlair()
  // the first three places: the beat's start, "ขึ้นไป" at 0.15 s and "อวกาศ 500" at 1.07 s; "ฟิ้ว" is cut to 1.5 s
  const slots = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).slots
  await flair.setCue(folder, slots[0]!.anchor, "s1")
  await flair.setCue(folder, slots[1]!.anchor, "s2")
  await flair.setCue(folder, slots[2]!.anchor, "s1")
  const preview = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(preview.cues.map((cue) => cue.effectId)).toEqual(["s1", "s2", "s1"])

  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: preview.groups.length, flair: ON.flair })
  const audio = (await readInfo(folder)).tracks.filter((track) => track.type === "audio")
  expect(audio.map((track) => track.segments.length).reduce((sum, n) => sum + n, 0)).toBe(3)
  expect(audio.length).toBeGreaterThan(1)
})

test("Claude picking the highlight text again moves each sound and cutaway to the new line showing the same words", async () => {
  const { flair, folder, highlights, outlines, claude } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const slotOf = (text: string) => before.slots.find((slot) => slot.what.includes(`"${text}"`))!
  await flair.setCue(folder, slotOf("ขึ้นไป").anchor, "s1")
  await flair.setCue(folder, slotOf("อวกาศ 500").anchor, "s2")
  await flair.setInsert(folder, slotOf("อวกาศ 500").anchor, "m1")
  await flair.setCue(folder, slotOf("3").anchor, "s1")

  // "อวกาศ" now makes a group of its own, "ขึ้นไป" is not picked, and "สาม" is picked as before
  claude.reply = { style: "sale-yellow", groups: [{ ...HIGHLIGHTS.groups[0]!, lines: [{ quote: "อวกาศ", text: "อวกาศ!" }], pattern: "stack", accentLine: 0, accentWord: "" }, HIGHLIGHTS.groups[1]!] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, ON)
  const after = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(after.groups.map((group) => group.lines.map((line) => line.text))).toEqual([["อวกาศ!"], ["3"]])
  expect(after.cues.map((cue) => [cue.effectId, cue.what])).toEqual([
    // the sound set by hand on "ขึ้นไป", which no new text says, moved to the start of its beat (spec §5.1, decided 2026-09-28)
    ["s1", 'ต้นช่วง "นับถอยหลัง"'],
    ["s2", 'ข้อความเด่น "อวกาศ!" บรรทัด 1'],
    ["s1", 'ข้อความเด่น "3" บรรทัด 1'],
  ])
  expect(after.inserts.map((insert) => [insert.binId, insert.what])).toEqual([["m1", 'ข้อความเด่น "อวกาศ!" บรรทัด 1']])
  // nothing is left waiting on a group that is not there
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => cue.effectId).sort()).toEqual(["s1", "s1", "s2"])
  expect(after.unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 0, pro: 0 })
})

test("a group taken out takes its sounds and cutaways out of the project", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const three = before.slots.find((slot) => slot.what.includes('"3"'))!
  await flair.setCue(folder, three.anchor, "s1")
  await flair.setInsert(folder, three.anchor, "m1")
  await flair.setCue(folder, before.slots.find((slot) => slot.what.includes('"ขึ้นไป"'))!.anchor, "s2")
  await highlights.removeGroup(folder, before.groups[1]!.id)
  const stored = (await outlines.get(folder))!.flair!
  expect(stored.cues!.map((cue) => cue.effectId)).toEqual(["s2"])
  expect(stored.inserts).toEqual([])

  // taken out by hand, a group's sound goes, even when a group the user made shows the same words
  await highlights.addFromWords(folder, CLIP_ID, [0, 1], 12)
  await highlights.removeGroup(folder, before.groups[0]!.id)
  expect((await outlines.get(folder))!.flair!.cues).toEqual([])
})

test("the preview counts the sounds that are not playing, and why", async () => {
  const { flair, folder, highlights, outlines, service } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const slotOf = (text: string) => before.slots.find((slot) => slot.what.includes(`"${text}"`))!
  await flair.setCue(folder, slotOf("ขึ้นไป").anchor, "s1")
  // the words of "ขึ้นไป" are cut, so its sound has nowhere to play for now
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1], keep: false })
  // and two sounds this machine does not have
  const stored = (await outlines.get(folder))!
  const notHere = (anchor: CueAnchor) => ({ anchor, effectId: "not-here", edited: true })
  await outlines.put({ ...stored, flair: { ...stored.flair!, cues: [...stored.flair!.cues!, notHere(slotOf("3").anchor), notHere(before.slots[0]!.anchor)] } })

  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).unusedSounds).toEqual({ unplaced: 1, missing: 2, lost: 0, pro: 0 })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, view({ ...ON.flair, sound: false }))).unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 0, pro: 0 })
})

test("text picked again on a transcript that changed does not take the old sounds along, its word numbers meaning nothing now: one set by hand goes to its beat's start", async () => {
  const { flair, folder, highlights, outlines, claude } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  await flair.setCue(folder, before.slots.find((slot) => slot.what.includes('"อวกาศ 500"'))!.anchor, "s2")
  // as if the clip had been transcribed again since the text was picked
  const stored = (await outlines.get(folder))!
  await outlines.put({ ...stored, highlights: { ...stored.highlights!, transcripts: { [CLIP_ID]: "earlier" } } })

  // Claude picks the same words: the sound would follow them, were the numbers still comparable
  claude.reply = HIGHLIGHTS
  await highlights.pick(folder, DEFAULT_CUT_RULES, ON)
  // it does not; set by hand, it moves to the start of its beat instead of going (spec §5.1, decided 2026-09-28)
  expect((await outlines.get(folder))!.flair!.cues).toEqual([{ anchor: { kind: "beat", beatId: "beat-1", edge: "start" }, effectId: "s2", edited: true }])
})

test("groups made on an earlier transcript take their sounds with them when words are added on the new one", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  await flair.setCue(folder, before.slots.find((slot) => slot.what.includes('"อวกาศ 500"'))!.anchor, "s2")
  const stored = (await outlines.get(folder))!
  await outlines.put({ ...stored, highlights: { ...stored.highlights!, transcripts: { [CLIP_ID]: "earlier" } } })

  await highlights.addFromWords(folder, CLIP_ID, [3], 12)
  expect((await outlines.get(folder))!.flair!.cues).toEqual([])
})

test("a line whose text is edited keeps its coloured word on that word, and loses the colour when the word is gone", async () => {
  const { flair, folder, highlights } = await withFlair()
  const [first] = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  await flair.setLook(folder, first!.id, { accent: { line: 1, lineIndex: 1, word: "500" } })

  await highlights.editLine(folder, first!.id, 1, "ราคา 500 บาท")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups[0]!.look.accent).toEqual({ line: 1, from: 5, to: 8 })
  await highlights.editLine(folder, first!.id, 1, "ไม่มีเลข")
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups[0]!.look.accent).toBeNull()
})

test("Claude picking the same text again keeps every look, and a coloured word follows its word into the new line", async () => {
  const { flair, folder, highlights, claude } = await withFlair()
  const [, second] = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  await flair.setLook(folder, second!.id, { pattern: "stack", tone: "alt" })
  const looks = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups.map((group) => group.look)

  claude.reply = HIGHLIGHTS
  await highlights.pick(folder, DEFAULT_CUT_RULES, ON)
  const again = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  expect(again.map((group) => group.id)).not.toContain(second!.id)
  expect(again.map((group) => group.look)).toEqual(looks)

  // the same words said with other text: the colour finds "500" where it now sits
  claude.reply = { ...HIGHLIGHTS, groups: [{ ...HIGHLIGHTS.groups[0]!, lines: [{ quote: "ขึ้นไป", text: "ขึ้นไป" }, { quote: "อวกาศ", text: "ถูก 500" }] }, HIGHLIGHTS.groups[1]!] }
  await highlights.pick(folder, DEFAULT_CUT_RULES, ON)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups[0]!.look.accent).toEqual({ line: 1, from: 4, to: 7 })
})

test("a sound on a join stays on it when the cut preset moves the join a little, and choosing another replaces it", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const join = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).slots.find((slot) => slot.anchor.kind === "cut")!
  await flair.setCue(folder, join.anchor, "s1")

  // the tight preset pads the words less, so the join starts a few frames later in the source
  const tight = { ...DEFAULT_CUT_RULES, preset: "tight" as const }
  const moved = await highlights.preview(folder, tight, ON)
  const there = moved.slots.find((slot) => slot.anchor.kind === "cut")!
  expect(there.anchor).not.toEqual(join.anchor)
  expect(moved.cues.map((cue) => [cue.effectId, cue.anchor])).toEqual([["s1", there.anchor]])
  expect(moved.unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 0, pro: 0 })

  // the place shown now is the same place: a sound chosen there replaces the one on it
  await flair.setCue(folder, there.anchor, "s2")
  expect((await outlines.get(folder))!.flair!.cues!.map((cue) => cue.effectId)).toEqual(["s2"])
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).cues.map((cue) => [cue.effectId, cue.anchor])).toEqual([["s2", join.anchor]])
})

test("a sound on text made from an earlier transcript is counted as lost, not as coming back, until the text is picked again", async () => {
  const { flair, folder, highlights, outlines, claude } = await withFlair()
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  await flair.setCue(folder, before.slots.find((slot) => slot.what.includes('"อวกาศ 500"'))!.anchor, "s2")
  // as if the clip had been transcribed again since the text was picked
  const stored = (await outlines.get(folder))!
  await outlines.put({ ...stored, highlights: { ...stored.highlights!, transcripts: { [CLIP_ID]: "earlier" } } })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 1, pro: 0 })
  // and it is counted the same at the lightest level
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, view({ ...ON.flair, level: "light" }))).unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 1, pro: 0 })

  claude.reply = HIGHLIGHTS
  await highlights.pick(folder, DEFAULT_CUT_RULES, ON)
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 0, pro: 0 })
})

test("the look of a group taken out goes with it, as does one whose last line is taken out", async () => {
  const { flair, folder, highlights, outlines } = await withFlair()
  const [first, second] = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).groups
  await flair.setLook(folder, first!.id, { pattern: "stair" })
  await flair.setLook(folder, second!.id, { pattern: "stack", tone: "alt" })
  await highlights.removeGroup(folder, first!.id)
  expect(Object.keys((await outlines.get(folder))!.flair!.looks)).toEqual([second!.id])
  await highlights.editLine(folder, second!.id, 0, null)
  expect((await outlines.get(folder))!.flair!.looks).toEqual({})
})


/* graphics: planned in flair-plan.test.ts; stored ones read here */

const SPEC: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, seconds: 2, why: "", idea: "ป้ายเด้งขึ้น", words: [], html: "<style></style>" }
/** A graphic stored on a moment of speech of the fixture's one beat. */
const graphicAt = (sourceUs: number, edited: boolean): GraphicCue => ({ anchor: { ...speech(sourceUs), beatId: "beat-1" }, spec: SPEC, edited, off: false })

/* graphics changed by hand */

async function withGraphics(graphics: GraphicCue[], extra: Partial<FlairDeps> = {}) {
  const base = await withFlair(SOUNDS, PICTURES, undefined, extra)
  await base.outlines.update(base.folder, (outline) => ({ ...outline!, flair: { ...(outline!.flair ?? { looks: {} }), graphics } }))
  const graphicsNow = async () => (await base.outlines.get(base.folder))!.flair!.graphics!
  return { ...base, graphicsNow }
}

test("a graphic switched off and on again by hand is the user's from then on, and the others are left alone", async () => {
  const cue = graphicAt(s(18.08), false)
  const other = graphicAt(s(22.62), false)
  const { flair, folder, graphicsNow, outlines } = await withGraphics([cue, other])
  const looks = (await outlines.get(folder))!.flair!.looks
  await flair.setGraphic(folder, cue.anchor, { off: true })
  expect(await graphicsNow()).toEqual([{ ...cue, off: true, edited: true }, other])
  await flair.setGraphic(folder, cue.anchor, { off: false })
  expect(await graphicsNow()).toEqual([{ ...cue, off: false, edited: true }, other])
  // a patch that does not name it leaves it as it was
  await flair.setGraphic(folder, cue.anchor, { off: true })
  await flair.setGraphic(folder, cue.anchor, {})
  expect((await graphicsNow())[0]!.off).toBe(true)
  expect((await outlines.get(folder))!.flair!.looks).toEqual(looks)
})

test("a graphic is Claude's to draw: by hand it is only switched off or on, which makes it the user's, and whatever else a change names is not taken; it can be taken away", async () => {
  const motion: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: SPEC.box, seconds: 3, why: "", idea: "จรวดพุ่งขึ้น", words: [{ text: "จรวด", atS: 0.2 }], html: "<style></style>" }
  const cue: GraphicCue = { ...graphicAt(s(18.08), false), spec: motion }
  const other = graphicAt(s(22.62), false)
  const { flair, folder, graphicsNow } = await withGraphics([cue, other])
  await flair.setGraphic(folder, cue.anchor, { off: true })
  expect(await graphicsNow()).toEqual([{ ...cue, off: true, edited: true }, other])
  await flair.setGraphic(folder, cue.anchor, { off: false })
  expect(await graphicsNow()).toEqual([{ ...cue, off: false, edited: true }, other])
  // a length, an idea or a fragment is no field of a change: one that names them anyway leaves them as they are, and
  // the switch in the same change is taken
  await flair.setGraphic(folder, cue.anchor, { off: true, seconds: 5, idea: "อย่างอื่น", html: "<p></p>" } as never)
  expect(await graphicsNow()).toEqual([{ ...cue, off: true, edited: true }, other])
  // a change that does not name the switch leaves it as it was
  await flair.setGraphic(folder, cue.anchor, { seconds: 5 } as never)
  expect(await graphicsNow()).toEqual([{ ...cue, off: true, edited: true }, other])
  await flair.setGraphic(folder, cue.anchor, null)
  expect(await graphicsNow()).toEqual([other])
})

test("one of Claude's graphics taken away takes Claude's sound on its moment with it", async () => {
  const motion: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: SPEC.box, seconds: 3, why: "", idea: "จรวดพุ่งขึ้น", words: [], html: null }
  const cue: GraphicCue = { ...graphicAt(s(18.08), false), spec: motion, pointId: "p1" }
  const { flair, folder, graphicsNow, outlines } = await withGraphics([cue])
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, cues: [{ anchor: cue.anchor, effectId: "s1", edited: false, pointId: "p1" }] } }))
  await flair.setGraphic(folder, cue.anchor, null)
  expect(await graphicsNow()).toEqual([])
  expect((await outlines.get(folder))!.flair!.cues).toEqual([])
})

test("a graphic can be taken away by hand, and one that is not there cannot be changed", async () => {
  const cue = graphicAt(s(18.08), false)
  const other = graphicAt(s(22.62), true)
  const { flair, folder, graphicsNow } = await withGraphics([cue, other])
  await flair.setGraphic(folder, cue.anchor, null)
  expect(await graphicsNow()).toEqual([other])
  await expect(flair.setGraphic(folder, cue.anchor, { off: true })).rejects.toThrow(/no graphic/)
  await expect(flair.setGraphic(folder, cue.anchor, null)).rejects.toThrow(/no graphic/)
  expect(await graphicsNow()).toEqual([other])
})

/* one step back from an edit or a writing again */

/** The fragment an edit wrote in place of SPEC's. */
const EDITED_HTML = '<style>.m{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="m">ป้าย</div>'
/** Its words, as they were said when the edit wrote it. */
const EDITED_WORDS = [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }]

test("going back swaps the fragment there with the one kept, each with the length, the words, the contract and the change it was written for; pressed again, it comes back", async () => {
  // edited as the user asked, switched off by them since: the fragment before the edit was written by a plan, under an earlier contract
  const edited: GraphicCue = {
    ...graphicAt(s(18.08), true),
    off: true,
    pointId: "p1",
    spec: { ...SPEC, seconds: 1.7, words: EDITED_WORDS, html: EDITED_HTML, instruction: "ใหญ่ขึ้น", previous: { html: SPEC.html!, seconds: 2, words: [], version: "motion-2026-01-01" } },
  }
  const other = graphicAt(s(22.62), false)
  const { flair, folder, graphicsNow } = await withGraphics([edited, other])
  await flair.undoGraphic(folder, edited.anchor)
  const back = await graphicsNow()
  // nothing else of it changes: its place, idea and box, whose it is and its switch
  expect(back).toEqual([
    { ...edited, spec: { ...SPEC, version: "motion-2026-01-01", seconds: 2, words: [], html: SPEC.html, previous: { html: EDITED_HTML, seconds: 1.7, words: EDITED_WORDS, version: MOTION_VERSION, instruction: "ใหญ่ขึ้น" } } },
    other,
  ])
  // no change made the fragment there now
  expect(Object.keys(back[0]!.spec)).not.toContain("instruction")
  await flair.undoGraphic(folder, edited.anchor)
  expect(await graphicsNow()).toEqual([edited, other])
})

test("going back takes away why an edit or a writing failed; from a graphic whose writing again failed it leaves nothing to come back to", async () => {
  // an edit of it failed: the fragment there is the one before that edit
  const failedEdit: GraphicCue = { ...graphicAt(s(18.08), false), spec: { ...SPEC, editFailed: "timed out", previous: { html: EDITED_HTML, seconds: 1.7, words: EDITED_WORDS, version: MOTION_VERSION, instruction: "ใหญ่ขึ้น" } } }
  // its writing again failed: it has no fragment, and keeps the good one
  const failedRedo: GraphicCue = { ...graphicAt(s(22.62), false), spec: { ...SPEC, html: null, failed: "nothing was drawn: every frame is empty", previous: { html: EDITED_HTML, seconds: 1.7, words: EDITED_WORDS, version: MOTION_VERSION } } }
  const { flair, folder, graphicsNow } = await withGraphics([failedEdit, failedRedo])
  await flair.undoGraphic(folder, failedEdit.anchor)
  await flair.undoGraphic(folder, failedRedo.anchor)
  const [edit, redo] = await graphicsNow()
  expect(edit!.spec).toEqual({ ...SPEC, seconds: 1.7, words: EDITED_WORDS, html: EDITED_HTML, instruction: "ใหญ่ขึ้น", previous: { html: SPEC.html, seconds: 2, words: [], version: MOTION_VERSION } })
  expect(Object.keys(edit!.spec)).not.toContain("editFailed")
  expect(redo!.spec).toEqual({ ...SPEC, seconds: 1.7, words: EDITED_WORDS, html: EDITED_HTML })
  expect(Object.keys(redo!.spec)).not.toContain("failed")
  expect(Object.keys(redo!.spec)).not.toContain("previous")
  // so there is no going back a second time
  await expect(flair.undoGraphic(folder, failedRedo.anchor)).rejects.toThrow(/^this graphic has nothing to go back to$/)
})

test("a graphic with no fragment kept, one that is not there and one of no kind the app draws have nothing to go back to, and nothing changes", async () => {
  const plain = graphicAt(s(18.08), false)
  const card = { anchor: { ...speech(s(19.0)), beatId: "beat-1" }, spec: { version: "k", box: SPEC.box, seconds: 2, pieces: [], why: "", previous: { html: SPEC.html } }, edited: true, off: false } as unknown as GraphicCue
  const { flair, folder, graphicsNow } = await withGraphics([plain, card])
  const nothing = /^this graphic has nothing to go back to$/
  await expect(flair.undoGraphic(folder, plain.anchor)).rejects.toThrow(nothing)
  await expect(flair.undoGraphic(folder, { ...speech(s(22.62)), beatId: "beat-1" })).rejects.toThrow(nothing)
  await expect(flair.undoGraphic(folder, card.anchor)).rejects.toThrow(nothing)
  expect(await graphicsNow()).toEqual([plain, card])
})

test("a retry forgets the failed render of the job the post-production page shows for that graphic", async () => {
  const job: RenderJob = { spec: SPEC, canvas: { width: 1080, height: 1920 }, fps: 30, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, palette: HIGHLIGHT_STYLES["bold-white"].palette }
  const retry = vi.fn()
  const jobFor = vi.fn(async (): Promise<RenderJob | null> => job)
  const cue = graphicAt(s(18.08), false)
  const { flair, folder } = await withGraphics([cue], { graphics: { ensure: vi.fn(), wait: vi.fn(), failureOf: vi.fn(), forgetMachine: vi.fn(), retry, hashOf: (asked) => `hash of ${asked.fps}` }, jobFor })
  await flair.retryGraphic(folder, cue.anchor)
  expect(jobFor).toHaveBeenCalledWith(folder, cue)
  expect(retry).toHaveBeenCalledWith("hash of 30")

  // nothing is forgotten for a graphic that is not there, or that has no job
  retry.mockClear()
  await flair.retryGraphic(folder, graphicAt(s(22.62), false).anchor)
  jobFor.mockResolvedValueOnce(null)
  await flair.retryGraphic(folder, cue.anchor)
  expect(retry).not.toHaveBeenCalled()
})

/* the level as a filter on emphasis points */

/** Makes the first group, and a sound put on the first beat's start, sit on one emphasis point of the least importance. */
async function onExtraPoint(context: Awaited<ReturnType<typeof withFlair>>) {
  const { folder, highlights, outlines, flair } = context
  const before = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  const [first, second] = before.groups
  await flair.setCue(folder, before.slots.find((slot) => slot.anchor.kind === "beat")!.anchor, "s1")
  const stored = (await outlines.get(folder))!
  const extra: EmphasisPoint = { id: "p1", anchor: { kind: "speech", videoId: CLIP_ID, from: 0, to: 2, beatId: first!.beatId }, importance: "extra", type: "hook", reason: "", source: "ai", edited: false }
  await outlines.put({
    ...stored,
    // the fixture's other point stays, so the second group keeps the point it was picked for
    emphasis: { points: [extra, ...stored.emphasis!.points.filter((point) => point.id !== "p1")], version: 1, plannedOn: { graphics: null, sounds: null }, transcripts: stored.highlights!.transcripts },
    highlights: { ...stored.highlights!, groups: stored.highlights!.groups.map((group) => (group.id === first!.id ? { ...group, pointId: "p1" } : group)) },
    flair: { ...stored.flair!, cues: stored.flair!.cues!.map((cue) => ({ ...cue, pointId: "p1" })) },
  })
  return { first: first!, second: second! }
}

test("text and sounds on an emphasis point show only at a level that lets its importance through, and nothing stored changes", async () => {
  const context = await withFlair()
  const { first, second } = await onExtraPoint(context)
  const { folder, highlights, outlines } = context
  const medium = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(medium.groups.map((group) => group.id)).toEqual([second.id])
  expect(medium.cues).toEqual([])
  // held back by the level is neither text the cut hid nor a sound that cannot play
  expect(medium.hidden).toBe(0)
  expect(medium.unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 0, pro: 0 })
  const heavy = await highlights.preview(folder, DEFAULT_CUT_RULES, view({ ...ON.flair, level: "heavy" }))
  expect(heavy.groups.map((group) => group.id)).toEqual([first.id, second.id])
  expect(heavy.cues.map((cue) => cue.effectId)).toEqual(["s1"])
  expect((await outlines.get(folder))!.flair!.cues).toHaveLength(1)
})

test("a sound on a line of text that is not shown waits with it: with the text off it neither plays nor counts as unused", async () => {
  const { flair, folder, highlights } = await withFlair()
  const line = (await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).slots.find((slot) => slot.anchor.kind === "highlight")!
  await flair.setCue(folder, line.anchor, "s2")
  const off = await highlights.preview(folder, DEFAULT_CUT_RULES, { ...ON, highlightsOn: false })
  expect([off.groups, off.cues, off.hidden]).toEqual([[], [], 0])
  expect(off.unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 0, pro: 0 })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, ON)).cues).toHaveLength(1)
})

test("a sound the user put on a line of text the level holds back plays nowhere: neither the preview nor the write has it, and at a level that shows the text both do", async () => {
  const context = await withFlair()
  const { first } = await onExtraPoint(context)
  const { flair, folder, highlights, service } = context
  const loud = view({ ...ON.flair, level: "heavy" })
  // the user's own sound, bound to no point, on the first line of the text on the extra point
  const line = (await highlights.preview(folder, DEFAULT_CUT_RULES, loud)).slots.find((slot) => slot.anchor.kind === "highlight" && slot.anchor.groupId === first.id)!
  await flair.setCue(folder, line.anchor, "s2")
  // the medium level holds that text back: the preview neither plays the sound nor counts it as unused
  const medium = await highlights.preview(folder, DEFAULT_CUT_RULES, ON)
  expect(medium.cues).toEqual([])
  expect(medium.unusedSounds).toEqual({ unplaced: 0, missing: 0, lost: 0, pro: 0 })
  const write = async (options: ReturnType<typeof view>, expected: number) =>
    service.write(folder, DEFAULT_CUT_RULES, expected, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: (await highlights.preview(folder, DEFAULT_CUT_RULES, options)).groups.length, flair: options.flair })
  // and the write leaves it out: that line has no place on the cut the level shows
  expect((await write(ON, 0)).soundCount).toBe(0)
  // at the loudest level the text shows, and both play the sound on it, with the extra point's own
  const heavy = await highlights.preview(folder, DEFAULT_CUT_RULES, loud)
  expect(heavy.cues.map((cue) => cue.effectId).sort()).toEqual(["s1", "s2"])
  expect((await write(loud, segments(await readInfo(folder)))).soundCount).toBe(2)
})

test("the subtitles hide only the words of text the saved level shows, and the write, at that level, hides the same", async () => {
  const context = await withFlair()
  await onExtraPoint(context)
  const { folder, service, deps } = context
  const text = (lines: { text: string }[]) => lines.map((line) => line.text).join("")
  // the settings are at the medium level: the first group is held back, so its words stay in the subtitles
  const medium = await service.subtitles(folder, DEFAULT_CUT_RULES, "line", true)
  await deps.settings.update({ flair: { level: "heavy" } })
  const heavy = await service.subtitles(folder, DEFAULT_CUT_RULES, "line", true)
  expect(text(heavy).length).toBeLessThan(text(medium).length)
  await deps.settings.update({ flair: { level: "medium" } })
  // a write whose subtitles did not match what it hides would be refused before anything is written
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "line", texts: medium.map((line) => line.text) }, { position: "auto", hideSubtitles: true, highlightsOn: true, groupCount: 1, flair: ON.flair })
  // the sound on the held-back point is not written
  expect(result.soundCount).toBe(0)
})

