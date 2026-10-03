import { expect, test, vi } from "vitest"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { DraftMeta } from "@boxblack/core/capcut"
import { CUT_PRESETS, DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import type { EmphasisPoint, Importance } from "@boxblack/core/emphasis/types"
import type { FlairLevel, FlairOptions } from "@boxblack/core/flair/catalogue"
import { MOTION_VERSION, type GraphicCue, type MotionSpec } from "@boxblack/core/graphics/plan"
import { layoutGroup } from "@boxblack/core/highlights"
import { styleFor } from "@boxblack/core/highlights/styles"
import { LOUDNESS_STEP_US } from "@boxblack/core/media"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import type { Beat } from "@boxblack/core/planner"
import { cardFraming } from "../../../../packages/core/src/capcut/framing.ts"
import { makeDraftRoot } from "../../../../packages/core/test/fixture-root.ts"
import { CLIP_ID, countdown, heard, readInfo, s, segments, setup, storePoints, transcript, word } from "./timeline-fixture.ts"
import { transcriptFingerprint } from "./footage.ts"
import type { AppEvent } from "../shared/api.ts"
import { problemFor, type RenderJob } from "./graphics-render.ts"
import { beatsKey } from "./highlight-state.ts"
import { createHighlightService, type HighlightService } from "./highlights.ts"
import { createTimelineService, tally, wavLengthUs, type TimelineDeps } from "./timeline.ts"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import { hashOfHtml, soundJobOf, soundStatusOf } from "./composed-cues.ts"
import { samePlace } from "./sound-cues.ts"
import { hashOf as soundHashOf, type SoundJob } from "./sound-render.ts"

test("the preview cuts the confirmed outline with the chosen rules", async () => {
  const { service, folder } = await setup()
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  expect(plan.beats[0]!.removals.map((r) => [r.reason, r.text])).toEqual([["retake", "สาม สอง หนึ่ง"]])
  expect(plan.cuts).toHaveLength(2)

  const kept = await service.preview(folder, { ...DEFAULT_CUT_RULES, cutRetakes: false })
  expect(kept.cuts).toHaveLength(1)
})

test("nothing is cut from an outline the user has not confirmed", async () => {
  const { service, folder } = await setup({ confirmed: false })
  await expect(service.preview(folder, DEFAULT_CUT_RULES)).rejects.toThrow(/not been confirmed/)
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0)).rejects.toThrow(/not been confirmed/)
})

test("writing backs the draft up first, then replaces the timeline with the rough cut", async () => {
  const { service, folder } = await setup()
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0)

  const info = await readInfo(folder)
  expect(segments(info)).toBe(2)
  expect(info.tracks[0]!.segments.map((segment) => segment.source_timerange!.start)).toEqual([17_000_000, 22_466_666])
  expect(result).toMatchObject({ durationUs: info.duration, segmentCount: 2, captionCount: 0 })
  expect(info.tracks.map((track) => track.type)).toEqual(["video"])

  expect(result.backup).toMatchObject({ createdAt: "2026-09-17T08:01:00.000Z", segmentCount: 0, durationUs: 0 })
})

test("the backup holds the draft as it was before the write", async () => {
  const { service, folder, deps } = await setup()
  const before = await readFile(join(folder, "draft_info.json"), "utf8")
  const { backup } = await service.write(folder, DEFAULT_CUT_RULES, 0)
  expect(await readFile(join(deps.backupRoot, backup.id, "draft", "draft_info.json"), "utf8")).toBe(before)
})

test("nothing is backed up or written while CapCut is open", async () => {
  const { service, folder, capcut, deps } = await setup()
  capcut.running = true
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0)).rejects.toThrow(/CapCut/)
  expect(segments(await readInfo(folder))).toBe(0)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("nothing is written when the timeline changed since the user was warned about it", async () => {
  const { service, folder, deps } = await setup()
  await expect(service.write(folder, DEFAULT_CUT_RULES, 3)).rejects.toThrow(/changed/)
  expect(segments(await readInfo(folder))).toBe(0)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("backups are listed newest first, only for their own project", async () => {
  const { service, folder } = await setup()
  const first = await service.write(folder, DEFAULT_CUT_RULES, 0)
  const second = await service.write(folder, { ...DEFAULT_CUT_RULES, cutRetakes: false }, 2)

  const backups = await service.backups(folder)
  expect(backups.map((b) => b.id)).toEqual([second.backup.id, first.backup.id])
  expect(backups.map((b) => b.segmentCount)).toEqual([2, 0])
  await expect(service.backups("/somewhere/else")).rejects.toThrow(/not a CapCut project/)
})

test("restoring puts the backed-up timeline back", async () => {
  const { service, folder } = await setup()
  const { backup } = await service.write(folder, DEFAULT_CUT_RULES, 0)
  await service.restore(folder, backup.id)
  expect(segments(await readInfo(folder))).toBe(0)
})

test("restoring refuses while CapCut is open, and refuses backups of other drafts", async () => {
  const { service, folder, capcut } = await setup()
  const { backup } = await service.write(folder, DEFAULT_CUT_RULES, 0)
  await expect(service.restore(folder, "../../etc")).rejects.toThrow(/unknown backup/)
  await expect(service.restore(folder, "0917-nope")).rejects.toThrow(/unknown backup/)

  capcut.running = true
  await expect(service.restore(folder, backup.id)).rejects.toThrow(/CapCut/)
  expect(segments(await readInfo(folder))).toBe(2)
})

test("cut edges follow how loud the video is, measured once per video and then reused", async () => {
  const measured: string[] = []
  const { service, folder } = await setup({
    measure: async (path) => {
      measured.push(path)
      return heard()
    },
  })
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  // word times alone end the first take at 19.78 s, where "สาม" is already sounding
  expect(plan.cuts[0]!.sourceStartUs + plan.cuts[0]!.sourceDurationUs).toBeLessThanOrEqual(19_720_000)
  await service.preview(folder, DEFAULT_CUT_RULES)
  expect(measured).toHaveLength(1)
})

test("without ffmpeg to measure loudness, cuts still follow the word times", async () => {
  const { service, folder } = await setup({ measure: null })
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  expect(plan.cuts[0]!.sourceStartUs + plan.cuts[0]!.sourceDurationUs).toBe(19_780_000)
})

test("a video whose loudness cannot be measured is still cut, by the word times", async () => {
  const { service, folder } = await setup({
    measure: async () => {
      throw new Error("ffmpeg exited with code 234")
    },
  })
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  expect(plan.cuts[0]!.sourceStartUs + plan.cuts[0]!.sourceDurationUs).toBe(19_780_000)
})

test("the cut presets come from the license server when it has sent them", async () => {
  const tight = { ...DEFAULT_CUT_RULES, preset: "tight" as const, cutRetakes: false }
  // the built-in tight preset cuts the countdown's 0.42 s and 0.56 s pauses
  const builtIn = await setup()
  expect((await builtIn.service.preview(builtIn.folder, tight)).beats[0]!.removals.map((r) => r.reason)).toEqual(["pause", "pause"])

  const presets = { ...CUT_PRESETS, tight: { maxPauseUs: 5_000_000, paddingUs: 80_000 } }
  const fromServer = await setup({ presets: async () => presets })
  expect((await fromServer.service.preview(fromServer.folder, tight)).beats[0]!.removals).toEqual([])
})

test("subtitle lines follow the words the cut keeps, placed on the new timeline under their beat", async () => {
  const { service, folder } = await setup()
  // the failed countdown was cut, so the second line starts on the second piece
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line")).map(({ key: _key, ...line }) => line)).toEqual([
    { beatId: "beat-1", startUs: 150_000, endUs: 2_770_000, text: "ขึ้นไปในอวกาศใน" },
    { beatId: "beat-1", startUs: 2_920_000, endUs: 5_700_000, text: "สามสองหนึ่ง" },
  ])
  // short captions also break at the 0.3 s pause after "สาม"
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "short")).map((line) => line.text)).toEqual(["ขึ้นไปใน", "อวกาศใน", "สาม", "สองหนึ่ง"])
})

test("each subtitle line belongs to the beat its words were cut from", async () => {
  const beats: Beat[] = [
    { ...countdown, id: "beat-1", toIndex: 0, startUs: s(17.16), endUs: s(18.75) },
    { ...countdown, id: "beat-2", fromIndex: 2, toIndex: 2, startUs: s(22.62), endUs: s(25.25) },
  ]
  const { service, folder } = await setup({ beats })
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line")).map((line) => [line.beatId, line.text])).toEqual([
    ["beat-1", "ขึ้นไปในอวกาศ"],
    ["beat-2", "สามสองหนึ่ง"],
  ])
})

test("subtitles follow the frame the video segment really starts on, not the unrounded cut", async () => {
  // the first word at 17.18 s pads the cut back to 17.03 s, which the writer rounds up to frame 511 (17.0333 s)
  const words = [word("ขึ้น", 17.18, 17.44), ...transcript.words.slice(1)]
  const { service, folder } = await setup({ transcript: { ...transcript, words } })
  await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "line", texts: ["ขึ้นไปในอวกาศใน", "สามสองหนึ่ง"] })
  const info = await readInfo(folder)
  expect(info.tracks[0]!.segments[0]!.source_timerange!.start).toBe(17_033_333)
  // 17.18 − 17.0333 s = 4.4 frames, so frame 4; timed from the unrounded 17.03 s it would be 4.5, frame 5
  expect(info.tracks[1]!.segments[0]!.target_timerange.start).toBe(133_333)
})

test("a line of subtitles is as wide as the video the rough cut will play at", async () => {
  // 31 characters said without a pause: two even lines across the portrait clip, one would fit a landscape frame
  const said = ["แมว", "กิน", "ปลา", "ทอด", "ที่", "บ้าน", "ของ", "ยาย", "ตอน", "เช้า", "ทุก", "วัน"]
  const words = said.map((text, i) => word(text, 17.2 + i * 0.15, 17.35 + i * 0.15))
  const utterances = [0, 4, 8].map((from) => ({ text: said.slice(from, from + 4).join(""), startUs: words[from]!.startUs, endUs: words[from + 3]!.endUs }))
  const { service, folder } = await setup({ transcript: { ...transcript, utterances, words } })
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line")).map((line) => line.text)).toEqual(["แมวกินปลาทอดที่บ้าน", "ของยายตอนเช้าทุกวัน"])
})

function fakeClaude(answer: (lines: string[]) => string[]) {
  const requests: LlmRequest<unknown>[] = []
  const chosen = { model: "claude-sonnet-5" }
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const text = request.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
      const lines = [...text.matchAll(/^\d+\. (.*)$/gm)].map((match) => match[1]!)
      return { output: { lines: answer(lines) } as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { llm: async () => ({ transport, model: chosen.model }), requests, chosen }
}

test("polishing asks the chosen Claude, and the same lines are not paid for twice", async () => {
  const claude = fakeClaude((lines) => lines.map((line) => `${line}ครับ`))
  const { service } = await setup({ llm: claude.llm })
  const lines = ["ขึ้นไปในอวกาศใน", "สาม"]
  expect(await service.polish(lines)).toEqual({ lines: ["ขึ้นไปในอวกาศในครับ", "สามครับ"], accepted: true })
  expect(claude.requests[0]!.model).toBe("claude-sonnet-5")
  expect(await service.polish(lines)).toEqual({ lines: ["ขึ้นไปในอวกาศในครับ", "สามครับ"], accepted: true })
  expect(claude.requests).toHaveLength(1)
  await service.polish(["สาม"])
  expect(claude.requests).toHaveLength(2)
  // another model may answer differently
  claude.chosen.model = "claude-opus-5"
  await service.polish(lines)
  expect(claude.requests).toHaveLength(3)
})

test("an answer that does not fit the lines is not kept, so asking again asks Claude again", async () => {
  const claude = fakeClaude(() => ["ทุกบรรทัดรวมกัน"])
  const { service } = await setup({ llm: claude.llm })
  const lines = ["ขึ้นไปในอวกาศใน", "สาม"]
  expect(await service.polish(lines)).toEqual({ lines, accepted: false })
  await service.polish(lines)
  expect(claude.requests).toHaveLength(2)
})

test("the stored lines' polish keeps what it changed in the outline, by line; a line polished back to what the app made keeps nothing", async () => {
  let answer = (line: string) => (line === "สาม" ? "3" : line)
  const claude = fakeClaude((lines) => lines.map((line) => answer(line)))
  const { service, folder, outlines } = await setup({ llm: claude.llm })
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "short")
  expect(lines.map((line) => line.text)).toEqual(["ขึ้นไปใน", "อวกาศใน", "สาม", "สองหนึ่ง"])
  expect(await service.polishStored(folder, DEFAULT_CUT_RULES, "short", false)).toEqual({ count: 1, accepted: true })
  expect((await outlines.get(folder))!.subtitleTexts).toEqual({ [lines[2]!.key]: "3" })
  // what is polished is what shows: the stored "3", which the polish now turns back into the generated line
  answer = (line) => (line === "3" ? "สาม" : line)
  expect(await service.polishStored(folder, DEFAULT_CUT_RULES, "short", false)).toEqual({ count: 1, accepted: true })
  expect(claude.requests.at(-1)!.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")).toContain("3. 3")
  expect((await outlines.get(folder))!.subtitleTexts).toEqual({})
})

test("the stored lines' polish keeps the 5,000 texts set last too: what it changes is newest, and the oldest are forgotten to make room", async () => {
  const claude = fakeClaude((lines) => lines.map((line) => (line === "สาม" ? "3" : line)))
  const { service, folder, outlines } = await setup({ llm: claude.llm })
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "short")
  const full = Object.fromEntries(Array.from({ length: 5_000 }, (_, i) => [`k${i}`, "x"]))
  await outlines.update(folder, (stored) => ({ ...stored!, subtitleTexts: full }))
  expect(await service.polishStored(folder, DEFAULT_CUT_RULES, "short", false)).toEqual({ count: 1, accepted: true })
  const texts = (await outlines.get(folder))!.subtitleTexts!
  expect([Object.keys(texts).length, Object.hasOwn(texts, "k0"), Object.hasOwn(texts, "k1"), Object.keys(texts).at(-1), texts[lines[2]!.key]]).toEqual([5_000, false, true, lines[2]!.key, "3"])
})

test("a line the user types while the stored polish waits on Claude keeps the user's text", async () => {
  let typed = false
  const claude = fakeClaude((lines) => {
    // Claude has answered; the user types the line before the answer is stored
    typed = true
    return lines.map((line) => (line === "สาม" ? "3" : line))
  })
  const { service, folder, outlines } = await setup({ llm: claude.llm })
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "short")
  const update = outlines.update.bind(outlines)
  outlines.update = (async (target: string, change: Parameters<typeof update>[1]) => {
    if (typed) {
      typed = false
      await update(target, (stored) => ({ ...stored!, subtitleTexts: { [lines[2]!.key]: "สามครั้ง" } }))
    }
    return update(target, change)
  }) as typeof outlines.update
  expect(await service.polishStored(folder, DEFAULT_CUT_RULES, "short", false)).toEqual({ count: 0, accepted: true })
  expect((await outlines.get(folder))!.subtitleTexts).toEqual({ [lines[2]!.key]: "สามครั้ง" })
})

test("a plan run's stop goes with the stored lines' polish", async () => {
  const claude = fakeClaude((lines) => lines.map((line) => `${line}!`))
  const { service, folder } = await setup({ llm: claude.llm })
  const stop = new AbortController()
  await service.polishStored(folder, DEFAULT_CUT_RULES, "short", false, stop.signal)
  expect(claude.requests[0]!.signal).toBe(stop.signal)
})

test("a stored polish whose reply does not fit keeps no line", async () => {
  const claude = fakeClaude(() => ["ทุกบรรทัดรวมกัน"])
  const { service, folder, outlines } = await setup({ llm: claude.llm })
  expect(await service.polishStored(folder, DEFAULT_CUT_RULES, "short", false)).toEqual({ count: 0, accepted: false })
  expect((await outlines.get(folder))!.subtitleTexts).toBeUndefined()
})

test("writing with subtitles puts the edited lines where their words play in the new timeline", async () => {
  const { service, folder } = await setup()
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "short", texts: ["ขึ้นไป", "อวกาศ", "  ", "สอง หนึ่ง"] })

  const info = await readInfo(folder)
  expect(info.tracks.map((track) => track.type)).toEqual(["video", "text"])
  // each caption lands on frames of the segment its words play in; the blank line is left out
  expect(info.tracks[1]!.segments.map((segment) => [segment.target_timerange.start, segment.target_timerange.duration])).toEqual([
    [166_666, 900_000],
    [1_066_666, 1_700_000],
    [4_166_666, 1_533_334],
  ])
  const texts = info.materials.texts as { content: string; group_id: string; type: string }[]
  expect(texts.map((text) => JSON.parse(text.content).text)).toEqual(["ขึ้นไป", "อวกาศ", "สอง หนึ่ง"])
  expect(texts.map((text) => text.type)).toEqual(["subtitle", "subtitle", "subtitle"])
  expect(texts[0]!.group_id).toMatch(/^boxblack_\d+$/)
  expect(new Set(texts.map((text) => text.group_id)).size).toBe(1)
  expect(result).toMatchObject({ segmentCount: 5, captionCount: 3 })
})

test("subtitles that no longer match the cut are refused before anything is backed up", async () => {
  const { service, folder, deps } = await setup()
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, { length: "short", texts: ["ขึ้นไปในอวกาศใน", "สาม", "สองหนึ่ง"] })).rejects.toThrow(/subtitles changed/)
  expect(segments(await readInfo(folder))).toBe(0)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("keeping a cut is stored with the outline and used by the preview and the write", async () => {
  const { service, folder } = await setup()
  // words 5–7 are the first "สาม สอง หนึ่ง", cut as a retake
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [5, 6, 7], keep: true })
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  expect(plan.cuts).toHaveLength(1)
  expect(plan.beats[0]!.rows.map((row) => [row.state, row.reason, row.text])).toContainEqual(["kept", "retake", "สามสองหนึ่ง"])

  await service.decide(folder, CLIP_ID, { type: "words", indexes: [5, 6, 7], keep: null })
  expect((await service.preview(folder, DEFAULT_CUT_RULES)).cuts).toHaveLength(2)

  await service.decide(folder, CLIP_ID, { type: "words", indexes: [5, 6, 7], keep: true })
  await service.write(folder, DEFAULT_CUT_RULES, 0)
  expect(segments(await readInfo(folder))).toBe(1)
})

test("decisions made on another transcript of the video are ignored", async () => {
  const { service, folder, deps } = await setup()
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [5, 6, 7], keep: true })
  const media = (await deps.inspect(folder)).videos[0]!.path
  await deps.transcripts.put(media, { engine: "whisper-local", model: "large-v3-q5_0", language: "th" }, { ...transcript, words: transcript.words.map((w) => ({ ...w, endUs: w.endUs - 1 })) })
  expect((await service.preview(folder, DEFAULT_CUT_RULES)).cuts).toHaveLength(2)
  // a new decision starts over on the new transcript
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [5, 6, 7], keep: true })
  expect((await service.preview(folder, DEFAULT_CUT_RULES)).cuts).toHaveLength(1)
})

test("decisions outside the video, or on a video the outline does not use, are refused", async () => {
  const { service, folder } = await setup()
  await expect(service.decide(folder, CLIP_ID, { type: "words", indexes: [11], keep: true })).rejects.toThrow(/outside/)
  await expect(service.decide(folder, CLIP_ID, { type: "words", indexes: [], keep: true })).rejects.toThrow(/outside/)
  await expect(service.decide(folder, CLIP_ID, { type: "pause", after: 10, keep: true })).rejects.toThrow(/outside/)
  await expect(service.decide(folder, CLIP_ID, { type: "pieces", ranges: [{ startUs: 5, endUs: 4 }], keep: false })).rejects.toThrow(/outside/)
  await expect(service.decide(folder, "other-video", { type: "pause", after: 1, keep: true })).rejects.toThrow(/not in this outline/)
})

test("each subtitle line has a key made of its source, so edits can follow it", async () => {
  const { service, folder } = await setup()
  const [first] = await service.subtitles(folder, DEFAULT_CUT_RULES, "line")
  expect(first!.key).toBe(`${CLIP_ID}:17160000:19780000:ขึ้นไปในอวกาศใน`)
})

test("a subtitle line's text is kept with the outline by its key, comes back as savedText, and is forgotten with null", async () => {
  const { service, folder, outlines } = await setup()
  const [first, second] = await service.subtitles(folder, DEFAULT_CUT_RULES, "line")
  await service.setSubtitleText(folder, first!.key, "ขึ้นไปในอวกาศ")
  // an empty text is kept too: the write leaves that line out
  await service.setSubtitleText(folder, second!.key, "")
  expect((await outlines.get(folder))!.subtitleTexts).toEqual({ [first!.key]: "ขึ้นไปในอวกาศ", [second!.key]: "" })
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "line")
  expect(lines.map((line) => [line.text, line.savedText])).toEqual([
    ["ขึ้นไปในอวกาศใน", "ขึ้นไปในอวกาศ"],
    ["สามสองหนึ่ง", ""],
  ])
  await service.setSubtitleText(folder, first!.key, null)
  expect((await outlines.get(folder))!.subtitleTexts).toEqual({ [second!.key]: "" })
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line"))[0]).not.toHaveProperty("savedText")
})

test("subtitle texts need an outline, and a project keeps the 5,000 set last, forgetting the oldest to make room", async () => {
  const { service, folder, outlines } = await setup()
  await expect(service.setSubtitleText("/drafts/none", "k", "x")).rejects.toThrow(/no outline/)
  const texts = async () => (await outlines.get(folder))!.subtitleTexts!
  const full = Object.fromEntries(Array.from({ length: 5_000 }, (_, i) => [`k${i}`, "x"]))
  await outlines.update(folder, (stored) => ({ ...stored!, subtitleTexts: full }))
  // a key kept already changes in place and becomes the newest: nothing is forgotten
  await service.setSubtitleText(folder, "k0", "y")
  const changed = await texts()
  expect([changed.k0, Object.keys(changed).length, Object.keys(changed).at(-1)]).toEqual(["y", 5_000, "k0"])
  // a new key forgets the text set longest ago: k1, now that k0 was set again
  await service.setSubtitleText(folder, "one-more", "x")
  const added = await texts()
  expect([Object.hasOwn(added, "k1"), Object.hasOwn(added, "k0"), added["one-more"], Object.keys(added).length]).toEqual([false, true, "x", 5_000])
  // a map grown past the limit (an older version's polish kept every line it changed) comes back down to it with the next text
  const over = Object.fromEntries(Array.from({ length: 5_010 }, (_, i) => [`o${i}`, "x"]))
  await outlines.update(folder, (stored) => ({ ...stored!, subtitleTexts: over }))
  await service.setSubtitleText(folder, "last", "z")
  const trimmed = await texts()
  expect([Object.keys(trimmed).length, Object.hasOwn(trimmed, "o10"), Object.hasOwn(trimmed, "o11"), trimmed.last]).toEqual([5_000, false, true, "z"])
  // any can be forgotten
  await service.setSubtitleText(folder, "last", null)
  expect(Object.keys(await texts()).length).toBe(4_999)
})

test("a sound on a join lands on the frame the picture jumps on, however many joins came before it", async () => {
  // every word is kept alone: each piece starts 0.4 of a frame past a frame (rounded down) and ends
  // 0.6 past one (rounded up), so each written piece is 0.8 of a frame longer than the cut asked for
  const said = ["แมว", "กิน", "ปลา", "ทอด"]
  const words = said.map((text, i) => {
    const start = (510 + 90 * i + 0.4) / 30 + 0.15
    return { text, startUs: s(start), endUs: s(start + 15.2 / 30) }
  })
  const utterances = words.map((w) => ({ ...w }))
  const beats: Beat[] = [{ ...countdown, fromIndex: 0, toIndex: 3, startUs: words[0]!.startUs, endUs: words[3]!.endUs }]
  const sounds = { list: async () => [{ effectId: "s1", name: "ปัง", durationUs: 330_000, path: null }] }
  const photo = { binId: "m1", path: "/pics/cat.jpg", name: "cat.jpg", kind: "photo" as const, width: 1080, height: 1920, durationUs: 5_000_000 }
  const media = { list: async () => [photo] }
  const { service, folder, outlines } = await setup({ transcript: { ...transcript, utterances, words }, beats, sounds, media })

  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  expect(plan.cuts).toHaveLength(4)
  const last = plan.cuts[3]!
  const stored = (await outlines.get(folder))!
  // and a cutaway on the third word, which is timed the same way (the last has too little room left)
  const cat = { kind: "speech" as const, videoId: CLIP_ID, sourceUs: words[2]!.startUs }
  await outlines.put({
    ...stored,
    flair: {
      looks: {},
      cues: [{ anchor: { kind: "cut", videoId: CLIP_ID, sourceUs: last.sourceStartUs }, effectId: "s1", edited: true }],
      inserts: [{ anchor: cat, binId: "m1", edited: true, fit: "cover", subject: null }],
    },
  })

  const flair = { enabled: true, level: "heavy" as const, text: true, sound: true, zoom: false, insert: true, graphic: false }
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair })
  expect(result.soundCount).toBe(1)
  const info = await readInfo(folder)
  const [sound] = info.tracks.find((track) => track.type === "audio")!.segments
  expect(sound!.target_timerange.start).toBe(info.tracks[0]!.segments[3]!.target_timerange.start)
  const piece = info.tracks[0]!.segments[2]!
  const [cutaway] = info.tracks.find((track) => track.type === "video" && track.flag === 2)!.segments
  const wordAt = piece.target_timerange.start - piece.source_timerange!.start + words[2]!.startUs
  expect(Math.abs(cutaway!.target_timerange.start - wordAt)).toBeLessThanOrEqual(1_000_000 / 30 / 2)
})

test("the write keeps every sound the preview kept: the spacing rules run on the same clock as the preview", async () => {
  // two beat starts 1.5017 s apart before rounding, 1.4667 s once the first piece is rounded to its frames
  const words = [
    { text: "แมว", startUs: 996_667, endUs: 2_198_333 },
    { text: "ปลาทอด", startUs: 5_003_333, endUs: 9_000_000 },
  ]
  const utterances = words.map((w) => ({ ...w }))
  const beats: Beat[] = [
    { ...countdown, id: "b1", name: "หนึ่ง", fromIndex: 0, toIndex: 0, startUs: s(0.9), endUs: s(2.3) },
    { ...countdown, id: "b2", name: "สอง", fromIndex: 1, toIndex: 1, startUs: s(4.9), endUs: s(9.1) },
  ]
  const library = [
    { effectId: "s1", name: "ปัง", durationUs: 330_000, path: null },
    { effectId: "s2", name: "ฟิ้ว", durationUs: 330_000, path: null },
  ]
  const { service, folder, outlines } = await setup({ transcript: { ...transcript, utterances, words }, beats, sounds: { list: async () => library } })
  const stored = (await outlines.get(folder))!
  const cues = [
    { anchor: { kind: "beat" as const, beatId: "b1", edge: "start" as const }, effectId: "s1", edited: true },
    { anchor: { kind: "beat" as const, beatId: "b2", edge: "start" as const }, effectId: "s2", edited: true },
  ]
  await outlines.put({ ...stored, flair: { looks: {}, cues, inserts: [] } })
  const flair = { enabled: true, level: "heavy" as const, text: true, sound: true, zoom: false, insert: false, graphic: false }
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair })
  expect(result.soundCount).toBe(2)
  const info = await readInfo(folder)
  // and each lands where its piece really starts
  const starts = info.tracks[0]!.segments.map((segment) => segment.target_timerange.start)
  expect(info.tracks.find((track) => track.type === "audio")!.segments.map((segment) => segment.target_timerange.start)).toEqual(starts)
})

test("a card at the start of a piece keeps clear of that piece's face, not the one before it", async () => {
  const words = [
    { text: "แมว", startUs: s(1.0), endUs: s(1.51) },
    { text: "ปลาทอด", startUs: s(5.0), endUs: s(7.0) },
  ]
  const utterances = words.map((w) => ({ ...w }))
  const beats: Beat[] = [
    { ...countdown, id: "beat-1", fromIndex: 0, toIndex: 0, startUs: s(0.9), endUs: s(1.6) },
    { ...countdown, id: "beat-2", name: "ช่วงสอง", fromIndex: 1, toIndex: 1, startUs: s(4.9), endUs: s(7.1) },
  ]
  // the face sits high in the first piece and low in the second
  const scenes = [
    { startUs: 0, endUs: s(3), description: "", kind: "talking-head" as const, issues: [], keepClear: { fromY: 0.1, toY: 0.4 } },
    { startUs: s(3), endUs: s(31), description: "", kind: "talking-head" as const, issues: [], keepClear: { fromY: 0.55, toY: 0.9 } },
  ]
  const photo = { binId: "m1", path: "/pics/cat.jpg", name: "cat.jpg", kind: "photo" as const, width: 1080, height: 1080, durationUs: 5_000_000 }
  const { service, folder, outlines } = await setup({ transcript: { ...transcript, utterances, words }, beats, scenes, media: { list: async () => [photo] } })
  const stored = (await outlines.get(folder))!
  await outlines.put({
    ...stored,
    flair: { looks: {}, cues: [], inserts: [{ anchor: { kind: "beat", beatId: "beat-2", edge: "start" }, binId: "m1", edited: true, fit: "card", subject: null }] },
  })
  const flair = { enabled: true, level: "heavy" as const, text: true, sound: false, zoom: false, insert: true, graphic: false }
  await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair })
  const info = await readInfo(folder)
  const [card] = info.tracks.find((track) => track.type === "video" && track.flag === 2)!.segments
  const canvas = { width: info.canvas_config.width, height: info.canvas_config.height }
  expect((card!.clip as { transform: { y: number } }).transform.y).toBeCloseTo(cardFraming(photo, canvas, scenes[1]!.keepClear).y, 6)
})

test("the write leaves out a cutaway on an emphasis point the level holds back, and writes it at a level that shows it", async () => {
  const photo = { binId: "m1", path: "/pics/cat.jpg", name: "cat.jpg", kind: "photo" as const, width: 1080, height: 1920, durationUs: 5_000_000 }
  const write = async (level: FlairOptions["level"]) => {
    const { service, folder, outlines } = await setup({ media: { list: async () => [photo] } })
    const stored = (await outlines.get(folder))!
    // อวกาศ (word 3) is a point of the least importance, which only the heavy level lets through
    const extra = { id: "p1", anchor: { kind: "speech" as const, videoId: CLIP_ID, from: 3, to: 4, beatId: countdown.id }, importance: "extra" as const, type: "hook" as const, reason: "", source: "ai" as const, edited: false }
    await outlines.put({
      ...stored,
      emphasis: { points: [extra], version: 1, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) } },
      flair: {
        looks: {},
        inserts: [
          { anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.08) }, binId: "m1", edited: false, fit: "cover", subject: null, pointId: "p1" },
          // the user's own, on no point, plays at every level
          { anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(22.62) }, binId: "m1", edited: true, fit: "cover", subject: null },
        ],
      },
    })
    const flair = { enabled: true, level, text: true, sound: false, zoom: false, insert: true, graphic: false }
    const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair })
    const cutaways = (await readInfo(folder)).tracks.filter((track) => track.type === "video" && track.flag === 2).flatMap((track) => track.segments)
    return { counted: result.insertCount, written: cutaways.length }
  }
  expect(await write("medium")).toEqual({ counted: 1, written: 1 })
  expect(await write("heavy")).toEqual({ counted: 2, written: 2 })
})

/** Stores highlight groups as the user made them, for the subtitle tests below. */
async function withGroups(context: Awaited<ReturnType<typeof setup>>, t: typeof transcript, beats: Beat[], groups: { id: string; beatId?: string; lines: { from: number; to: number; text: string }[] }[]) {
  const stored = (await context.outlines.get(context.folder))!
  await context.outlines.put({
    ...stored,
    highlights: {
      style: null,
      styleByAi: null,
      beatsKey: beatsKey(beats),
      transcripts: { [CLIP_ID]: transcriptFingerprint(t) },
      groups: groups.map((group) => ({ id: group.id, source: "user" as const, edited: false, ...(group.beatId ? { beatId: group.beatId } : {}), lines: group.lines.map((line) => ({ videoId: CLIP_ID, ...line })) })),
    },
  })
}
const textsOf = async (folder: string) => ((await readInfo(folder)).materials.texts as { content: string }[]).map((m) => JSON.parse(m.content).text as string)

test("footage played in two beats keeps its subtitles in the beat that shows no highlight text", async () => {
  const words = [word("ราคา", 1.0, 1.4), word("ห้าร้อย", 1.4, 2.0), word("บาท", 2.0, 2.4)]
  const t = { ...transcript, utterances: [{ text: "ราคา ห้าร้อย บาท", startUs: s(1.0), endUs: s(2.4) }], words }
  const beats: Beat[] = [
    { ...countdown, id: "hook", name: "hook", fromIndex: 0, toIndex: 0, startUs: s(0.9), endUs: s(2.5) },
    { ...countdown, id: "price", name: "ราคา", fromIndex: 0, toIndex: 0, startUs: s(0.9), endUs: s(2.5) },
  ]
  const context = await setup({ transcript: t, beats })
  await withGroups(context, t, beats, [{ id: "g1", beatId: "price", lines: [{ from: 0, to: 3, text: "ราคา 500 บาท" }] }])
  const lines = await context.service.subtitles(context.folder, DEFAULT_CUT_RULES, "line", true)
  expect(lines.map((line) => line.beatId)).toEqual(["hook"])
})

test("a caption that would get no whole frame gives its words to the next one, in the preview and the write alike", async () => {
  const words = [word("สวัสดีทุกคนครับ", 1.0, 1.01), word("วันนี้เราจะมาดูกัน", 1.012, 2.0)]
  const t = { ...transcript, utterances: [{ text: "สวัสดีทุกคนครับ วันนี้เราจะมาดูกัน", startUs: s(1.0), endUs: s(2.0) }], words }
  const beats: Beat[] = [{ ...countdown, fromIndex: 0, toIndex: 0, startUs: s(0.9), endUs: s(2.1) }]
  const { service, folder } = await setup({ transcript: t, beats })
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "short", false)
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "short", texts: lines.map((line) => line.text) })
  expect(result.captionCount).toBe(lines.length)
  expect((await textsOf(folder)).join("")).toContain("สวัสดีทุกคนครับ")
})

test("a highlight line with no whole frame on screen leaves its words in the subtitles", async () => {
  // "นะ" is 10 ms long and the next group starts on the word after it
  const words = [word("ราคา", 1.0, 1.5), word("ถูก", 1.5, 1.99), word("นะ", 1.99, 2.0), word("ซื้อ", 2.0, 2.5), word("เลย", 2.5, 3.0)]
  const t = { ...transcript, utterances: [{ text: "ราคาถูกนะ ซื้อเลย", startUs: s(1.0), endUs: s(3.0) }], words }
  const beats: Beat[] = [{ ...countdown, fromIndex: 0, toIndex: 0, startUs: s(0.9), endUs: s(3.1) }]
  const assets = { fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`, animationPath: async (id: string) => `/effect/${id}/hash` }
  const context = await setup({ transcript: t, beats, highlightAssets: assets })
  await withGroups(context, t, beats, [
    { id: "a", lines: [{ from: 0, to: 2, text: "ราคาถูก" }, { from: 2, to: 3, text: "นะ" }] },
    { id: "b", lines: [{ from: 3, to: 5, text: "ซื้อเลย" }] },
  ])
  const lines = await context.service.subtitles(context.folder, DEFAULT_CUT_RULES, "short", true)
  const flair = { enabled: false, level: "medium" as const, text: false, sound: false, zoom: false, insert: false, graphic: false }
  await context.service.write(context.folder, DEFAULT_CUT_RULES, 0, { length: "short", texts: lines.map((line) => line.text) }, { position: "auto", hideSubtitles: true, highlightsOn: true, groupCount: 2, flair })
  expect((await textsOf(context.folder)).join(" ")).toContain("นะ")
})

test("a line starting in the last frame is judged the same way by the preview and the write, so the write goes through", async () => {
  // the fixture file is 31.106 s long: 933.18 frames at 30 fps
  const words = [word("ราคา", 29.0, 29.5), word("ห้าร้อย", 29.5, 30.2), word("บาท", 31.101, 31.106)]
  const t = { ...transcript, utterances: [{ text: "ราคา ห้าร้อย บาท", startUs: s(29.0), endUs: s(31.106) }], words }
  const beats: Beat[] = [{ ...countdown, id: "b", fromIndex: 0, toIndex: 0, startUs: s(28.9), endUs: s(31.106) }]
  const assets = { fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`, animationPath: async (id: string) => `/effect/${id}/hash` }
  const context = await setup({ transcript: t, beats, highlightAssets: assets })
  await withGroups(context, t, beats, [{ id: "g1", lines: [{ from: 0, to: 2, text: "ราคาห้าร้อย" }, { from: 2, to: 3, text: "บาท" }] }])
  const shown = await context.service.subtitles(context.folder, DEFAULT_CUT_RULES, "line", true)
  const flair = { enabled: false, level: "medium" as const, text: false, sound: false, zoom: false, insert: false, graphic: false }
  await expect(
    context.service.write(context.folder, DEFAULT_CUT_RULES, 0, { length: "line", texts: shown.map((line) => line.text) }, { position: "auto", hideSubtitles: true, highlightsOn: true, groupCount: 1, flair }),
  ).resolves.toBeTruthy()
})

test("loudness measured from a clip that is replaced meanwhile is kept for the old clip, not the new one", async () => {
  let media = ""
  const context = await setup({
    measure: async (path) => {
      // the first time, the clip is exported again while it is being measured
      if (!media) await (await import("node:fs/promises")).writeFile(path, "a new cut of the video")
      media = path
      return heard()
    },
  })
  await context.service.preview(context.folder, DEFAULT_CUT_RULES)
  expect(media).not.toBe("")
  expect(await context.deps.loudness.get(media, { stepUs: LOUDNESS_STEP_US })).toBeNull()
})

/* graphics */

/** A fragment the linter passes, as a writing answers, and another, for a graphic drawn differently. */
const FRAGMENT = '<style>.r{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="r">อวกาศ</div>'
const OTHER_FRAGMENT = '<style>.o{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="o">อีกป้าย</div>'
/** A written graphic, clear of the subtitles' room (from 0.76 of the height); these tests have no highlight text to keep off. */
const SPEC: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.72 }, seconds: 2, why: "ชี้ว่าไปไหน", idea: "ป้ายชี้ไปอวกาศ", words: [], html: FRAGMENT }
/**
 * What a writing stored for a graphic on each moment of the fixture these tests put one on: the seconds it plays
 * there and the words said in them, so that it is fresh, has a render job and is written into the draft. ขึ้น at
 * 17.16 s plays its 2 s; อวกาศ at 18.08 s has 1.7 s before its piece ends, where the retake is cut.
 */
const WRITTEN_FOR: Record<number, Pick<MotionSpec, "seconds" | "words">> = {
  [s(17.16)]: { seconds: 2, words: [{ text: "ขึ้น", atS: 0 }, { text: "ไป", atS: 0.28 }, { text: "ใน", atS: 0.52 }, { text: "อวกาศ", atS: 0.92 }, { text: "ใน", atS: 1.84 }] },
  [s(18.08)]: { seconds: 1.7, words: [{ text: "อวกาศ", atS: 0 }, { text: "ใน", atS: 0.92 }] },
}
const graphicAt = (sourceUs: number, beatId = "beat-1", writtenFor: Pick<MotionSpec, "seconds" | "words"> | undefined = WRITTEN_FOR[sourceUs]): GraphicCue => ({
  anchor: { kind: "speech", videoId: CLIP_ID, sourceUs, beatId },
  spec: { ...SPEC, ...writtenFor },
  edited: true,
  off: false,
})
const GRAPHICS: FlairOptions = { enabled: true, level: "medium", text: true, sound: false, zoom: false, insert: false, graphic: true }
const request = (flair: FlairOptions = GRAPHICS) => ({ position: "auto" as const, hideSubtitles: false, highlightsOn: true, groupCount: 0, flair })
const PICTURE = { binId: "m1", path: "/pics/cat.jpg", name: "cat.jpg", kind: "photo" as const, width: 1080, height: 1920, durationUs: 5_000_000 }
const NOT_INSTALLED = "the graphics renderer is not installed: install it in settings, or turn graphics off"

/**
 * A renderer that makes every job it is waited for, unless `outcome` says the job fails or is
 * stopped before it is made. Like the real one it knows a job by what is drawn, the same graphic
 * asked for twice is one job, and a stopped job is in neither list. `gone` are the hashes whose
 * file is deleted once they are waited for: made as far as the wait knows, and not found after.
 */
function fakeRenderer(dir: string, outcome: (job: RenderJob) => "made" | "failed" | "stopped" = () => "made") {
  const hashOf = (job: RenderJob) => createHash("sha256").update(JSON.stringify(job)).digest("hex").slice(0, 16)
  const made = new Set<string>()
  const gone = new Set<string>()
  const waited: [RenderJob[], string][] = []
  /** what a render found wrong with the machine, as the real renderer keeps it */
  let problem: string | null = null
  return {
    made,
    gone,
    waited,
    hashOf,
    environmentProblem: () => problemFor(problem),
    findsMachineUnfit: (why: string) => void (problem = why),
    async wait(jobs: RenderJob[], folder: string) {
      waited.push([jobs, folder])
      const ready: string[] = []
      const failed: string[] = []
      for (const [hash, job] of new Map(jobs.map((job) => [hashOf(job), job]))) {
        const result = made.has(hash) ? "made" : outcome(job)
        if (result === "made") made.add(hash), ready.push(hash)
        else if (result === "failed") failed.push(hash)
      }
      return { ready, failed }
    },
    async rendered(job: RenderJob) {
      const hash = hashOf(job)
      return made.has(hash) && !gone.has(hash) ? { hash, path: join(dir, `${hash}.mov`), width: 864, height: 230, durationUs: job.spec.seconds * 1_000_000, place: { scale: 0.8, x: 0, y: 0.3 } } : null
    },
  }
}

/**
 * The timeline service with graphics: its jobs from the highlight service, as the app wires it,
 * a fake renderer writing into a graphics folder shaped like the app's own, and the pack installed
 * unless a test says otherwise.
 */
async function withGraphics(
  graphics: GraphicCue[],
  extra: Parameters<typeof setup>[0] & { outcome?: Parameters<typeof fakeRenderer>[1]; packReady?: boolean; inserts?: boolean } = {},
) {
  const media = extra.inserts ? { list: async () => [PICTURE] } : undefined
  const base = await setup({ ...extra, media })
  const inserts = extra.inserts ? [{ anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs: s(22.62), beatId: "beat-1" }, binId: "m1", edited: true, fit: "cover" as const, subject: null }] : []
  await base.outlines.update(base.folder, (stored) => ({ ...stored!, flair: { looks: {}, graphics, inserts } }))
  const style = styleFor("custom", { text: [0, 1, 0], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0, 0, 0] })
  const highlights = createHighlightService({ outlines: base.outlines, timeline: base.service, footage: base.deps, media, styleOf: async () => style })
  const graphicsDir = join(base.dir, "Movies", "CapCut", "BOXBLACK", "graphics")
  const renderer = fakeRenderer(graphicsDir, extra.outcome)
  const pack = { ready: extra.packReady ?? true }
  const graphicJobs = vi.fn(highlights.graphicJobs)
  const deps: TimelineDeps = { ...base.deps, graphics: renderer, graphicsReady: async () => pack.ready, graphicJobs, graphicsDir }
  return { ...base, deps, service: createTimelineService(deps), highlights, renderer, pack, graphicsDir, graphicJobs }
}

/** The highlight service's graphics with the first one played again 2.5 s later: the same graphic twice, so the same job and the same file. */
const playedTwice =
  (highlights: HighlightService): TimelineDeps["graphicJobs"] =>
  async (...args) => {
    const { kept, jobs } = await highlights.graphicJobs(...args)
    return { kept: [...kept, { ...kept[0]!, atUs: kept[0]!.atUs + 2_500_000 }], jobs: [...jobs, jobs[0]!] }
  }

const readMeta = async (folder: string) => JSON.parse(await readFile(join(folder, "draft_meta_info.json"), "utf8")) as DraftMeta
const imported = async (folder: string) => (await readMeta(folder)).draft_materials.find((group) => group.type === 0)!.value
const overlays = (info: Awaited<ReturnType<typeof readInfo>>) => info.tracks.filter((track) => track.type === "video" && track.flag === 2)
/** The bin entry each segment of the graphics track plays, by the material it points at. */
const binIdsPlayed = (info: Awaited<ReturnType<typeof readInfo>>) =>
  overlays(info)[0]!.segments.map((segment) => (info.materials.videos as { id: string; local_material_id: string }[]).find((video) => video.id === segment.material_id)!.local_material_id)

test("the write waits for the graphics in force, then lays them on one overlay track above the cutaways, each file in the media bin", async () => {
  // a graphic on the first word, and a cutaway on the second sentence clear of it
  const { service, folder, renderer, graphicsDir } = await withGraphics([graphicAt(s(17.16))], { inserts: true })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { ...request({ ...GRAPHICS, insert: true }), hideSubtitles: true })
  expect(result.graphicCount).toBe(1)
  expect(result.graphicsSkipped).toBe(0)
  expect(result.insertCount).toBe(1)
  expect(renderer.waited).toEqual([[[expect.objectContaining({ fps: 30, canvas: { width: 1080, height: 1920 } })], folder]])

  const info = await readInfo(folder)
  const [cutaways, graphics] = overlays(info)
  expect(info.tracks.at(-1)).toBe(graphics)
  const [segment] = graphics!.segments
  expect(segment!.render_index).toBeGreaterThan(cutaways!.segments[0]!.render_index as number)
  expect(segment!.render_index).toBeLessThan(13_000)
  const path = join(graphicsDir, `${renderer.hashOf(renderer.waited[0]![0][0]!)}.mov`)
  const entry = (await imported(folder)).find((item) => item.file_Path === path)!
  // CapCut's own bin ids are lower-case UUIDs
  expect(entry).toMatchObject({ width: 864, height: 230, duration: 2_000_000, metetype: "video" })
  expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  const material = (info.materials.videos as { id: string; path: string; local_material_id: string }[]).find((video) => video.id === segment!.material_id)!
  expect(material).toMatchObject({ path, local_material_id: entry.id })
})

test("a graphic whose render failed is left out and counted, and the rest of the write goes ahead", async () => {
  const cue = graphicAt(s(18.08))
  const { service, folder, renderer } = await withGraphics([cue], { outcome: () => "failed" })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 0, graphicsSkipped: 1, segmentCount: 2 })
  // it was written and fresh, so it had a job, and that one job was waited for: it is the render that left it out
  expect(renderer.waited).toEqual([[[expect.objectContaining({ spec: cue.spec, times: [0, 0.92] })], folder]])
  expect(overlays(await readInfo(folder))).toEqual([])
  expect((await imported(folder)).some((item) => item.file_Path.endsWith(".mov"))).toBe(false)
})

test("without the renderer pack a write with graphics still to make fails with a clear message, before anything is written", async () => {
  const { service, folder, deps, renderer } = await withGraphics([graphicAt(s(18.08))], { packReady: false })
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow(NOT_INSTALLED)
  expect(renderer.waited).toEqual([])
  expect(segments(await readInfo(folder))).toBe(0)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()

  // with no renderer at all it is the same
  const bare = createTimelineService({ ...deps, graphics: undefined, graphicsReady: undefined })
  await expect(bare.write(folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow(NOT_INSTALLED)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("without the renderer pack a write fails if any of its graphics is still to make, even with others made", async () => {
  const { deps, folder, renderer, highlights } = await withGraphics([graphicAt(s(18.08))], { packReady: false })
  // a second graphic, drawn differently, 2.5 s later; only the first is made
  const graphicJobs: TimelineDeps["graphicJobs"] = async (...args) => {
    const { kept, jobs } = await highlights.graphicJobs(...args)
    const spec = { ...kept[0]!.cue.spec, html: OTHER_FRAGMENT }
    return { kept: [...kept, { cue: { ...kept[0]!.cue, spec }, atUs: kept[0]!.atUs + 2_500_000, durationUs: kept[0]!.durationUs }], jobs: [...jobs, { ...jobs[0]!, spec }] }
  }
  const { jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair: GRAPHICS })
  renderer.made.add(renderer.hashOf(jobs[0]!))
  const service = createTimelineService({ ...deps, graphicJobs })
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow(NOT_INSTALLED)
  expect(renderer.waited).toEqual([])
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("a machine a render found unfit says why the write cannot make its graphics, before and after the wait", async () => {
  const problem = "the graphics renderer is damaged: reinstall it in settings (chrome-headless-shell is missing)"
  // found before: the app counts the renderer not ready while it has a problem, and nothing is waited for
  const before = await withGraphics([graphicAt(s(18.08))], { packReady: false })
  before.renderer.findsMachineUnfit(problem)
  await expect(before.service.write(before.folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow(`graphics cannot be made on this machine: ${problem}; the draft was not changed`)
  expect(before.renderer.waited).toEqual([])
  await expect(readdir(before.deps.backupRoot)).rejects.toThrow()

  // found during the wait: the graphics were neither made nor failed, and it is not that they were stopped
  const during = await withGraphics([graphicAt(s(18.08))], { outcome: () => "stopped" })
  const service = createTimelineService({
    ...during.deps,
    graphics: {
      ...during.renderer,
      wait: async (jobs, at) => {
        during.renderer.findsMachineUnfit(problem)
        return during.renderer.wait(jobs, at)
      },
    },
  })
  const files = () => Promise.all(["draft_info.json", "draft_meta_info.json"].map((file) => readFile(join(during.folder, file), "utf8")))
  const unchanged = await files()
  await expect(service.write(during.folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow(`graphics cannot be made on this machine: ${problem}; the draft was not changed`)
  expect(await files()).toEqual(unchanged)
  await expect(readdir(during.deps.backupRoot)).rejects.toThrow()
})

test("graphics made before are written without the renderer pack", async () => {
  const { service, folder, renderer, highlights } = await withGraphics([graphicAt(s(18.08))], { packReady: false })
  const { jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair: GRAPHICS })
  for (const job of jobs) renderer.made.add(renderer.hashOf(job!))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 1, graphicsSkipped: 0 })
  expect(overlays(await readInfo(folder))).toHaveLength(1)
})

test("graphics stopped before they were made (the app is quitting) leave the draft as it was, and no backup", async () => {
  const { deps, folder, renderer, highlights } = await withGraphics([graphicAt(s(18.08))], { outcome: () => "stopped" })
  // the same graphic twice is one job, and it was never made
  const service = createTimelineService({ ...deps, graphicJobs: playedTwice(highlights) })
  const files = () => Promise.all(["draft_info.json", "draft_meta_info.json"].map((file) => readFile(join(folder, file), "utf8")))
  const before = await files()
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow("the graphics were stopped before they were made; the draft was not changed")
  expect(renderer.waited[0]![0]).toHaveLength(2)
  expect(await files()).toEqual(before)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("CapCut opened while the graphics rendered stops the write before the draft is read, so no backup is left behind", async () => {
  const { deps, folder, renderer, capcut } = await withGraphics([graphicAt(s(18.08))])
  const service = createTimelineService({
    ...deps,
    graphics: {
      ...renderer,
      wait: async (jobs, at) => {
        capcut.running = true
        return renderer.wait(jobs, at)
      },
    },
  })
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow(/CapCut is running/)
  expect(renderer.waited).toHaveLength(1)
  expect(segments(await readInfo(folder))).toBe(0)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
})

test("while a write waits for its graphics, another write or a restore of the draft is refused, and the first goes ahead", async () => {
  const { deps, folder, renderer } = await withGraphics([graphicAt(s(18.08))])
  let release!: () => void
  const rendering = new Promise<void>((resolve) => (release = resolve))
  const sent: AppEvent[] = []
  const service = createTimelineService({
    ...deps,
    send: (event) => sent.push(event),
    graphics: {
      ...renderer,
      wait: async (jobs, at) => {
        await rendering
        return renderer.wait(jobs, at)
      },
    },
  })
  // a write without graphics, which leaves a backup to put back
  const earlier = await service.write(folder, DEFAULT_CUT_RULES, 0)
  expect(service.writing(folder)).toBe(false)
  sent.length = 0

  const first = service.write(folder, DEFAULT_CUT_RULES, earlier.segmentCount, null, request())
  expect(service.writing(folder)).toBe(true)
  await expect(service.write(folder, DEFAULT_CUT_RULES, earlier.segmentCount, null, request())).rejects.toThrow("a write to this project is already running")
  await expect(service.restore(folder, earlier.backup.id)).rejects.toThrow("a write to this project is already running")
  // a refused write is no write: the room following the first is told nothing about it
  expect(sent).toEqual([{ type: "timeline-write", folder, state: "started" }])

  release()
  expect(await first).toMatchObject({ graphicCount: 1 })
  expect(renderer.waited).toHaveLength(1)
  expect(service.writing(folder)).toBe(false)
  await service.restore(folder, earlier.backup.id)
  expect(segments(await readInfo(folder))).toBe(earlier.backup.segmentCount)
})

test("while a write to one draft waits for its graphics, a write to another draft goes ahead", async () => {
  const { deps, folder, renderer, outlines } = await withGraphics([graphicAt(s(18.08))])
  // a second draft in a drafts folder of its own, cut from the same analysed video
  const other = join(await makeDraftRoot(), "0917")
  await outlines.put({ ...(await outlines.get(folder))!, folder: other })
  const project = await deps.inspect(folder)
  let release!: () => void
  const rendering = new Promise<void>((resolve) => (release = resolve))
  const service = createTimelineService({
    ...deps,
    inspect: async (f) => (f === other ? { ...project, folder: other } : deps.inspect(f)),
    registered: async (f) => (f === other ? undefined : deps.registered(f)),
    graphics: {
      ...renderer,
      wait: async (jobs, at) => {
        await rendering
        return renderer.wait(jobs, at)
      },
    },
  })
  const first = service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(service.writing(folder)).toBe(true)
  expect(service.writing(other)).toBe(false)

  expect(await service.write(other, DEFAULT_CUT_RULES, 0)).toMatchObject({ segmentCount: 2 })
  expect(segments(await readInfo(other))).toBe(2)
  expect(service.writing(folder)).toBe(true)

  release()
  expect(await first).toMatchObject({ graphicCount: 1 })
})

test("anyWriting() says whether a write to any draft is running, and writesStarted() counts the writes that started", async () => {
  const { deps, folder, renderer } = await withGraphics([graphicAt(s(18.08))])
  let release!: () => void
  const rendering = new Promise<void>((resolve) => (release = resolve))
  const service = createTimelineService({
    ...deps,
    graphics: {
      ...renderer,
      wait: async (jobs, at) => {
        await rendering
        return renderer.wait(jobs, at)
      },
    },
  })
  expect([service.anyWriting(), service.writesStarted()]).toEqual([false, 0])
  const earlier = await service.write(folder, DEFAULT_CUT_RULES, 0)
  expect([service.anyWriting(), service.writesStarted()]).toEqual([false, 1])

  const first = service.write(folder, DEFAULT_CUT_RULES, earlier.segmentCount, null, request())
  expect([service.anyWriting(), service.writesStarted()]).toEqual([true, 2])
  // a refused write is no write
  await expect(service.write(folder, DEFAULT_CUT_RULES, earlier.segmentCount, null, request())).rejects.toThrow("a write to this project is already running")
  expect(service.writesStarted()).toBe(2)
  release()
  await first
  expect(service.anyWriting()).toBe(false)

  // nor is a restore
  const restoring = service.restore(folder, earlier.backup.id)
  expect(service.anyWriting()).toBe(false)
  await restoring
  expect(service.writesStarted()).toBe(2)
})

test("a write while a backup of the draft is being put back is refused, and does not count as writing", async () => {
  const { service: plain, folder, deps } = await setup()
  const { backup } = await plain.write(folder, DEFAULT_CUT_RULES, 0)
  let release!: () => void
  const checked = new Promise<void>((resolve) => (release = resolve))
  const service = createTimelineService({
    ...deps,
    // the restore waits on its look at whether CapCut is open
    isCapCutRunning: async () => {
      await checked
      return false
    },
  })
  const restoring = service.restore(folder, backup.id)
  expect(service.writing(folder)).toBe(false)
  await expect(service.write(folder, DEFAULT_CUT_RULES, 2)).rejects.toThrow("a backup of this project is being put back")
  release()
  await restoring
  expect(segments(await readInfo(folder))).toBe(0)
  expect((await service.write(folder, DEFAULT_CUT_RULES, 0)).segmentCount).toBe(2)
})

test("a write says when it starts and how it ended, so a room opened meanwhile can show it", async () => {
  const sent: AppEvent[] = []
  const { deps, folder } = await setup()
  const service = createTimelineService({ ...deps, send: (event) => sent.push(event) })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0)
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0)).rejects.toThrow(/changed/)
  expect(sent).toEqual([
    { type: "timeline-write", folder, state: "started" },
    { type: "timeline-write", folder, state: "done", result },
    { type: "timeline-write", folder, state: "started" },
    { type: "timeline-write", folder, state: "failed", error: expect.stringMatching(/^the timeline changed after it was checked/) },
  ])
  // a failed write holds nothing up
  expect(service.writing(folder)).toBe(false)
})

test("with graphics off nothing is rendered and no track is added", async () => {
  const { service, folder, renderer, graphicJobs } = await withGraphics([graphicAt(s(18.08))])
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request({ ...GRAPHICS, graphic: false }))
  expect(result).toMatchObject({ graphicCount: 0, graphicsSkipped: 0 })
  // not even asked for: that would cut the whole rough cut again for nothing
  expect(graphicJobs).not.toHaveBeenCalled()
  expect(renderer.waited).toEqual([])
  expect(overlays(await readInfo(folder))).toEqual([])
})

test("the lightest level writes the graphics as any other does, whatever the old switch for all flair says", async () => {
  const { service, folder, graphicJobs } = await withGraphics([graphicAt(s(18.08))])
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request({ ...GRAPHICS, enabled: false, level: "light" }))
  expect(graphicJobs).toHaveBeenCalledTimes(1)
  expect(result.graphicCount).toBe(1)
})

test("the graphics are asked for with the subtitles the write lays down, as the preview placed them", async () => {
  const { service, folder, graphicJobs } = await withGraphics([graphicAt(s(18.08))])
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "line")
  const first = await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "line", texts: lines.map((line) => line.text) }, request())
  expect(graphicJobs).toHaveBeenLastCalledWith(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: true, highlightsOn: true, flair: GRAPHICS })
  await service.write(folder, DEFAULT_CUT_RULES, first.segmentCount, null, request())
  expect(graphicJobs).toHaveBeenLastCalledWith(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair: GRAPHICS })
})

test("a graphic whose file is gone by the time the draft is written is left out and counted", async () => {
  const { service, folder, renderer, highlights } = await withGraphics([graphicAt(s(18.08))])
  const { jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair: GRAPHICS })
  renderer.gone.add(renderer.hashOf(jobs[0]!))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(renderer.waited).toHaveLength(1)
  expect(result).toMatchObject({ graphicCount: 0, graphicsSkipped: 1 })
  expect(overlays(await readInfo(folder))).toEqual([])
  expect((await imported(folder)).some((item) => item.file_Path.endsWith(".mov"))).toBe(false)
})

test("two graphics made of the same file share one entry in the media bin", async () => {
  const { deps, folder, highlights } = await withGraphics([graphicAt(s(18.08))])
  const service = createTimelineService({ ...deps, graphicJobs: playedTwice(highlights) })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result.graphicCount).toBe(2)
  const info = await readInfo(folder)
  expect(overlays(info)[0]!.segments).toHaveLength(2)
  const movs = (await imported(folder)).filter((item) => item.file_Path.endsWith(".mov"))
  expect(movs).toHaveLength(1)
  expect(binIdsPlayed(info)).toEqual([movs[0]!.id, movs[0]!.id])
})

test("writing the same graphic again reuses its entry in the media bin, and puts it back if it went meanwhile", async () => {
  const { service, folder, deps, renderer } = await withGraphics([graphicAt(s(18.08))])
  const first = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  const movs = async () => (await imported(folder)).filter((item) => item.file_Path.endsWith(".mov"))
  const [entry] = await movs()
  expect(entry).toBeDefined()

  // the entry is taken out on disk after the draft was read (as CapCut would, opened and closed meanwhile)
  const metaPath = join(folder, "draft_meta_info.json")
  const again = createTimelineService({
    ...deps,
    graphics: {
      ...renderer,
      rendered: async (job) => {
        const meta = await readMeta(folder)
        const group = meta.draft_materials.find((g) => g.type === 0)!
        group.value = group.value.filter((item) => item.id !== entry!.id)
        await writeFile(metaPath, JSON.stringify(meta))
        return renderer.rendered(job)
      },
    },
  })
  await again.write(folder, DEFAULT_CUT_RULES, first.segmentCount, null, request())
  expect((await movs()).map((item) => [item.id, item.file_Path])).toEqual([[entry!.id, entry!.file_Path]])
  expect(binIdsPlayed(await readInfo(folder))).toEqual([entry!.id])
})

test("a write with graphics off takes an earlier graphic out of the media bin and leaves the user's own media", async () => {
  const { service, folder } = await withGraphics([graphicAt(s(18.08))])
  const before = await imported(folder)
  const first = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(await imported(folder)).toHaveLength(before.length + 1)
  await service.write(folder, DEFAULT_CUT_RULES, first.segmentCount, null, request({ ...GRAPHICS, graphic: false }))
  expect(await imported(folder)).toEqual(before)
})

test("a project with another timeline gets each new graphic in its media bin and keeps the old ones, since that timeline may still play them", async () => {
  const { service, folder } = await withGraphics([graphicAt(s(18.08))])
  const path = join(folder, "Timelines", "project.json")
  const project = JSON.parse(await readFile(path, "utf8")) as { timelines: Record<string, unknown>[] }
  project.timelines.push({ ...project.timelines[0], id: "1B7E2C4A-0000-4000-8000-000000000002", name: "ไทม์ไลน์ 02" })
  await writeFile(path, JSON.stringify(project))

  const first = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  const withGraphic = await imported(folder)
  const movs = withGraphic.filter((item) => item.file_Path.endsWith(".mov"))
  expect(movs).toHaveLength(1)
  expect(binIdsPlayed(await readInfo(folder))).toEqual([movs[0]!.id])

  await service.write(folder, DEFAULT_CUT_RULES, first.segmentCount, null, request({ ...GRAPHICS, graphic: false }))
  expect(await imported(folder)).toEqual(withGraphic)
})

test("a graphic lands on the frame its word plays on, however many joins came before it", async () => {
  // as in the sound test above: each piece is written 0.8 of a frame longer than the cut asked for
  const said = ["แมว", "กิน", "ปลา", "ทอด"]
  const words = said.map((text, i) => {
    const start = (510 + 150 * i + 0.4) / 30 + 0.15
    return { text, startUs: s(start), endUs: s(start + 75.2 / 30) }
  })
  const utterances = words.map((w) => ({ ...w }))
  const beats: Beat[] = [{ ...countdown, fromIndex: 0, toIndex: 3, startUs: words[0]!.startUs, endUs: words[3]!.endUs }]
  // written for its 2 s on ปลา, the one word said in them: the next piece comes half a second after they are over
  const { service, folder } = await withGraphics([graphicAt(words[2]!.startUs, "beat-1", { seconds: 2, words: [{ text: "ปลา", atS: 0 }] })], { transcript: { ...transcript, utterances, words }, beats })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result.graphicCount).toBe(1)
  const info = await readInfo(folder)
  const piece = info.tracks[0]!.segments[2]!
  const wordAt = piece.target_timerange.start - piece.source_timerange!.start + words[2]!.startUs
  const [graphic] = overlays(info)[0]!.segments
  expect(Math.abs(graphic!.target_timerange.start - wordAt)).toBeLessThanOrEqual(1_000_000 / 30 / 2)
})

/* motion graphics */

/**
 * A motion graphic for the second countdown, on สาม at 22.62 s, written for its 2 s and the two words said in them on
 * the fixture's rough cut: สาม as it starts and สอง 1.26 s in.
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
const motionAt = (sourceUs: number, spec: MotionSpec): GraphicCue => ({ ...graphicAt(sourceUs), spec, edited: false })
/** Written, and said now as it was written for. */
const FRESH = motionAt(s(22.62), COUNTDOWN)
/** Planned on the first word, and not written yet. */
const UNWRITTEN = motionAt(s(17.16), { ...COUNTDOWN, html: null })
/** Written for the countdown's words, but on อวกาศ, where other words are said. */
const STALE = motionAt(s(18.08), COUNTDOWN)

test("a motion graphic not written yet, or stale, is left out of the draft and counted, and the write does not wait for it", async () => {
  const { service, folder, renderer } = await withGraphics([FRESH, UNWRITTEN, STALE])
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 1, graphicsSkipped: 2, dropped: { graphics: 0 }, segmentCount: 3 })
  // only the one that has a job was waited for: the written one, with the times its words are said at now
  expect(renderer.waited).toEqual([[[expect.objectContaining({ spec: COUNTDOWN, times: [0, 1.26] })], folder]])
  const tracks = overlays(await readInfo(folder))
  expect(tracks.map((track) => track.segments.length)).toEqual([1])
  // สาม plays 2.92 s in: the frame it lands on
  expect(Math.abs(tracks[0]!.segments[0]!.target_timerange.start - 2_920_000)).toBeLessThanOrEqual(1_000_000 / 30)
  expect((await imported(folder)).filter((item) => item.file_Path.endsWith(".mov"))).toHaveLength(1)
})

test("a written motion graphic whose render fails and one not written yet are each left out and counted once", async () => {
  const { service, folder, renderer } = await withGraphics([FRESH, UNWRITTEN], { outcome: () => "failed" })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 0, graphicsSkipped: 2, dropped: { graphics: 0 }, segmentCount: 2 })
  // the written one alone was waited for
  expect(renderer.waited).toEqual([[[expect.objectContaining({ spec: COUNTDOWN })], folder]])
  expect(overlays(await readInfo(folder))).toEqual([])
})

test("a write whose motion graphics are all unwritten or stale has nothing to make: it goes ahead without the renderer pack, or any renderer, and counts them", async () => {
  const { service, folder, renderer, deps } = await withGraphics([UNWRITTEN, STALE], { packReady: false })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 0, graphicsSkipped: 2, segmentCount: 2 })
  expect(renderer.waited).toEqual([])
  expect(overlays(await readInfo(folder))).toEqual([])

  // with no renderer at all it is the same
  const bare = createTimelineService({ ...deps, graphics: undefined, graphicsReady: undefined })
  expect(await bare.write(folder, DEFAULT_CUT_RULES, result.segmentCount, null, request())).toMatchObject({ graphicCount: 0, graphicsSkipped: 2, segmentCount: 2 })
})

test("without the renderer pack a written motion graphic still to make stops the write; made before, it is written, and the unwritten one beside it is only counted", async () => {
  const { service, folder, renderer, highlights, deps } = await withGraphics([FRESH, UNWRITTEN], { packReady: false })
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, request())).rejects.toThrow(NOT_INSTALLED)
  expect(renderer.waited).toEqual([])
  expect(segments(await readInfo(folder))).toBe(0)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()

  // the unwritten one plays first and has no job; the written one's is made
  const { jobs } = await highlights.graphicJobs(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair: GRAPHICS })
  expect(jobs.map((job) => job?.spec.seconds ?? null)).toEqual([null, 2])
  renderer.made.add(renderer.hashOf(jobs[1]!))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 1, graphicsSkipped: 1 })
  expect(overlays(await readInfo(folder))).toHaveLength(1)
})

/* overlapping items, and what the write really placed */

test("cutaways that overlap are written on tracks of their own, the later on top, and the result counts what was really written", async () => {
  const cat = { binId: "m1", path: "/pics/cat.jpg", name: "cat.jpg", kind: "photo" as const, width: 1080, height: 1920, durationUs: 5_000_000 }
  const dog = { ...cat, binId: "m2", path: "/pics/dog.jpg", name: "dog.jpg" }
  const { service, folder, outlines } = await setup({ media: { list: async () => [cat, dog] } })
  const stored = (await outlines.get(folder))!
  // on "ขึ้น" and on "อวกาศ", 0.92 s apart: a photo stays 2 s, so the dog comes on while the cat is still up
  const on = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
  await outlines.put({
    ...stored,
    flair: {
      looks: {},
      cues: [],
      inserts: [
        { anchor: on(s(17.16)), binId: "m1", edited: true, fit: "cover", subject: null },
        { anchor: on(s(18.08)), binId: "m2", edited: true, fit: "cover", subject: null },
      ],
    },
  })
  const flair = { enabled: true, level: "heavy" as const, text: true, sound: false, zoom: false, insert: true, graphic: false }
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair })
  expect(result).toMatchObject({ insertCount: 2, dropped: { sounds: 0, zooms: 0, inserts: 0, graphics: 0 }, zoomsLost: 0, emphasisCount: 0 })

  const info = await readInfo(folder)
  const tracks = overlays(info)
  expect(tracks.map((track) => track.segments.length)).toEqual([1, 1])
  const [lower, upper] = tracks.map((track) => track.segments[0]!)
  const binOf = (segment: typeof lower) => (info.materials.videos as { id: string; local_material_id: string }[]).find((video) => video.id === segment!.material_id)!.local_material_id
  expect([binOf(lower), binOf(upper)]).toEqual(["m1", "m2"])
  expect(upper!.render_index).toBe((lower!.render_index as number) + 1)
  expect(upper!.target_timerange.start).toBeLessThan(lower!.target_timerange.start + lower!.target_timerange.duration)
})

/* the moves of the picture */

/** A move of Claude's on a word, or on the cutaway there. */
const moveOn = (sourceUs: number, poses: { s: number; scale: number; ease?: "line" | "inOut" | "cut" }[], insert = false) => ({
  anchor: { kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" },
  ...(insert ? { insert: true } : {}),
  from: "medium" as const,
  about: "ดันเข้า",
  poses: poses.map((pose) => ({ x: 0, y: 0, rot: 0, ease: "line" as const, ...pose })),
  edited: false,
  off: false,
})
const MOVES_ON = { enabled: true, level: "heavy" as const, text: true, sound: false, zoom: true, insert: true, graphic: false }
const scaleKeyframes = (segment: { common_keyframes?: { property_type: string; keyframe_list: { values: number[] }[] }[] | null }) =>
  segment.common_keyframes?.find((entry) => entry.property_type === "KFTypeScaleX")?.keyframe_list.map((entry) => entry.values[0]) ?? []

test("the write lays the moves as keyframes: on their piece, in place of a legacy zoom there, and on a cutaway's overlay", async () => {
  const cat = { binId: "m1", path: "/pics/cat.jpg", name: "cat.jpg", kind: "photo" as const, width: 1080, height: 1920, durationUs: 5_000_000 }
  const { service, folder, outlines } = await setup({ media: { list: async () => [cat] } })
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  const stored = (await outlines.get(folder))!
  const pieceAnchor = (cut: number) => ({ videoId: CLIP_ID, sourceUs: plan.cuts[cut]!.sourceStartUs, beatId: "beat-1" })
  await outlines.put({
    ...stored,
    flair: {
      looks: {},
      // a legacy zoom on each piece: the first piece's gives way to the move on "ขึ้น"
      zooms: [
        { anchor: pieceAnchor(0), kind: "punch", edited: true },
        { anchor: pieceAnchor(1), kind: "punch", edited: true },
      ],
      inserts: [{ anchor: { kind: "speech", videoId: CLIP_ID, sourceUs: s(18.08), beatId: "beat-1" }, binId: "m1", edited: true, fit: "cover", subject: null }],
      moves: [
        moveOn(s(17.16), [{ s: 0, scale: 1 }, { s: 1, scale: 1.2, ease: "inOut" }]),
        moveOn(s(18.08), [{ s: 0, scale: 1.1, ease: "cut" }, { s: 1, scale: 1.2 }], true),
      ],
    },
  })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair: MOVES_ON })
  expect(result).toMatchObject({ zoomCount: 1, insertCount: 1, dropped: { moves: 0, zooms: 0, inserts: 0 } })

  const info = await readInfo(folder)
  const [first, second] = info.tracks[0]!.segments
  // the move: at rest until "ขึ้น", as far into the piece as the cut has it, then eased up to 1.2 in straight steps
  const moved = scaleKeyframes(first!)
  expect(moved[0]).toBe(1)
  expect(moved.at(-1)).toBeCloseTo(1.2)
  expect(moved.length).toBeGreaterThan(4)
  const times = first!.common_keyframes![0]!.keyframe_list.map((entry) => entry.time_offset)
  expect(times[1]).toBe(first!.source_timerange!.start + s(17.16) - plan.cuts[0]!.sourceStartUs)
  // the second piece keeps its legacy punch
  expect(scaleKeyframes(second!)).toEqual([1, 1.15])
  // the cutaway's move goes on its overlay, on top of its framing
  const [cutaway] = overlays(info).flatMap((track) => track.segments)
  const onCutaway = scaleKeyframes(cutaway!)
  expect(onCutaway[0]).toBeCloseTo(1.1)
  expect(onCutaway.at(-1)).toBeCloseTo(1.2)
})

test("a move on the second of two cutaways goes on that cutaway's overlay alone", async () => {
  const cat = { binId: "m1", path: "/pics/cat.jpg", name: "cat.jpg", kind: "photo" as const, width: 1080, height: 1920, durationUs: 5_000_000 }
  const dog = { ...cat, binId: "m2", path: "/pics/dog.jpg", name: "dog.jpg" }
  const { service, folder, outlines } = await setup({ media: { list: async () => [cat, dog] } })
  const stored = (await outlines.get(folder))!
  const on = (sourceUs: number) => ({ kind: "speech" as const, videoId: CLIP_ID, sourceUs, beatId: "beat-1" })
  await outlines.put({
    ...stored,
    flair: {
      looks: {},
      inserts: [
        { anchor: on(s(17.16)), binId: "m1", edited: true, fit: "cover", subject: null },
        { anchor: on(s(18.08)), binId: "m2", edited: true, fit: "cover", subject: null },
      ],
      moves: [moveOn(s(18.08), [{ s: 0, scale: 1.1, ease: "cut" }, { s: 1, scale: 1.2 }], true)],
    },
  })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair: MOVES_ON })
  expect(result).toMatchObject({ insertCount: 2, dropped: { moves: 0, inserts: 0 } })
  const info = await readInfo(folder)
  const binOf = (segment: { material_id: string }) => (info.materials.videos as { id: string; local_material_id: string }[]).find((video) => video.id === segment.material_id)!.local_material_id
  const [lower, upper] = overlays(info).map((track) => track.segments[0]!)
  expect([binOf(lower!), binOf(upper!)]).toEqual(["m1", "m2"])
  expect(scaleKeyframes(lower!)).toEqual([])
  expect(scaleKeyframes(upper!)[0]).toBeCloseTo(1.1)
  expect(scaleKeyframes(upper!).at(-1)).toBeCloseTo(1.2)
})

test("the write's graphics are judged against the faces where the moves put them: a free graphic the move covers its face with is stale for its old length, and waits", async () => {
  // a face from 0.25 to 0.59 of the height, just above SPEC's box (0.6–0.72) until pushed in to 1.3 from "ขึ้น"
  const scenes = [{ startUs: s(0), endUs: s(31), description: "หน้าคนพูด", kind: "talking-head" as const, issues: [], keepClear: { fromY: 0.25, toY: 0.59 } }]
  const free: GraphicCue = { ...graphicAt(s(17.16)), from: "medium", spec: { ...SPEC, ...WRITTEN_FOR[s(17.16)]!, replacesText: false } }
  const withMove = async (moves: ReturnType<typeof moveOn>[]) => {
    const { service, folder, outlines, graphicJobs } = await withGraphics([free], { scenes })
    await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, moves } }))
    const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request({ ...GRAPHICS, zoom: true }))
    const { kept } = await graphicJobs.mock.results[0]!.value
    return [result.graphicCount, result.graphicsSkipped, kept.map((graphic: { durationUs: number }) => graphic.durationUs)]
  }
  expect(await withMove([])).toEqual([1, 0, [2_000_000]])
  expect(await withMove([moveOn(s(17.16), [{ s: 0, scale: 1.3, ease: "cut" }])])).toEqual([0, 1, [1_500_000]])
})

test("a move whose word the cut took out is counted with the zooms whose piece is gone, in the write and the preview alike", async () => {
  const { service, folder, outlines, deps } = await setup()
  const stored = (await outlines.get(folder))!
  // "สาม" at 19.78 s is in the first countdown, cut as a retake
  await outlines.put({ ...stored, flair: { looks: {}, moves: [moveOn(s(19.78), [{ s: 0, scale: 1.1, ease: "cut" }])] } })
  const view = { position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair: MOVES_ON }
  const highlights = createHighlightService({ outlines, timeline: service, footage: deps })
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, view)).zoomsLost).toBe(1)
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair: MOVES_ON })
  expect(result).toMatchObject({ zoomsLost: 1, dropped: { moves: 0 } })
})

test("a move the checks turn down is not written and is counted, and the legacy zoom on its piece plays on", async () => {
  const { service, folder, outlines } = await setup()
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  const stored = (await outlines.get(folder))!
  await outlines.put({
    ...stored,
    flair: {
      looks: {},
      zooms: [{ anchor: { videoId: CLIP_ID, sourceUs: plan.cuts[0]!.sourceStartUs, beatId: "beat-1" }, kind: "punch", edited: true }],
      // pushed in past the cap of a 1080-wide video
      moves: [moveOn(s(17.16), [{ s: 0, scale: 1 }, { s: 1, scale: 1.8 }])],
    },
  })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { position: "auto", hideSubtitles: false, highlightsOn: true, groupCount: 0, flair: MOVES_ON })
  expect(result).toMatchObject({ zoomCount: 1, dropped: { moves: 1, zooms: 0 } })
  expect(scaleKeyframes((await readInfo(folder)).tracks[0]!.segments[0]!)).toEqual([1, 1.15])
})

test("graphics that overlap are written on tracks of their own, the later on top", async () => {
  // "ขึ้น" and "อวกาศ" are 0.92 s apart, and each graphic plays well over a second
  const { service, folder } = await withGraphics([graphicAt(s(17.16)), graphicAt(s(18.08))])
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 2, graphicsSkipped: 0, dropped: { graphics: 0 } })
  const tracks = overlays(await readInfo(folder))
  expect(tracks.map((track) => track.segments.length)).toEqual([1, 1])
  const [lower, upper] = tracks.map((track) => track.segments[0]!)
  expect(upper!.render_index).toBe((lower!.render_index as number) + 1)
  expect(lower!.render_index as number).toBeGreaterThan(1000)
  expect(upper!.render_index as number).toBeLessThan(13_000)
  // the later one on top, coming on while the earlier still plays
  expect(upper!.target_timerange.start).toBeGreaterThan(lower!.target_timerange.start)
  expect(upper!.target_timerange.start).toBeLessThan(lower!.target_timerange.start + lower!.target_timerange.duration)
})

test("the result counts what each writer placed and left out from that writer's own answer, and nothing for a writer that did not run", () => {
  // each writer was sent more than it placed, and no two answer alike
  const laid = { sounds: { kept: 1, dropped: 2 }, zooms: { kept: 3, dropped: 4 }, inserts: { kept: 5, dropped: 6 }, graphics: { kept: 7, dropped: 8 }, moves: { kept: 9, dropped: 10 } }
  expect(tally(laid)).toEqual({ soundCount: 1, composedCount: 0, zoomCount: 3, insertCount: 5, graphicCount: 7, dropped: { sounds: 2, zooms: 4, inserts: 6, graphics: 8, moves: 10 } })
  expect(tally({ inserts: { kept: 2, dropped: 1 } })).toEqual({ soundCount: 0, composedCount: 0, zoomCount: 0, insertCount: 2, graphicCount: 0, dropped: { sounds: 0, zooms: 0, inserts: 1, graphics: 0, moves: 0 } })
  // the composed sounds are counted apart, and those their writer left out are sounds left out
  expect(tally({ sounds: { kept: 1, dropped: 2 }, composed: { kept: 3, dropped: 4 } })).toEqual({ soundCount: 1, composedCount: 3, zoomCount: 0, insertCount: 0, graphicCount: 0, dropped: { sounds: 6, zooms: 0, inserts: 0, graphics: 0, moves: 0 } })
})

test("a graphic the writer finds no frame for is counted as left out, not as written", async () => {
  const { deps, folder, highlights, service: plain } = await withGraphics([graphicAt(s(18.08))])
  const plan = await plain.preview(folder, DEFAULT_CUT_RULES)
  // the same graphic again, asked for a second past the end of the rough cut: nothing of it can play
  const pastTheEnd: TimelineDeps["graphicJobs"] = async (...args) => {
    const { kept, jobs } = await highlights.graphicJobs(...args)
    return { kept: [...kept, { ...kept[0]!, atUs: plan.durationUs + 1_000_000 }], jobs: [...jobs, jobs[0]!] }
  }
  const result = await createTimelineService({ ...deps, graphicJobs: pastTheEnd }).write(folder, DEFAULT_CUT_RULES, 0, null, request())
  expect(result).toMatchObject({ graphicCount: 1, graphicsSkipped: 0, dropped: { graphics: 1 } })
  expect(overlays(await readInfo(folder)).flatMap((track) => track.segments)).toHaveLength(1)
})

test("the result counts the emphasis points the level lets through and the zooms whose piece is gone, and the preview counts those zooms too", async () => {
  const { service, folder, outlines, deps } = await setup()
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  const stored = (await outlines.get(folder))!
  const point = (id: string, from: number, to: number, importance: Importance): EmphasisPoint => ({
    id,
    anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" },
    importance,
    type: "action",
    reason: "",
    source: "ai",
    edited: false,
  })
  await outlines.put({
    ...stored,
    emphasis: {
      // words 5–7 are the first countdown, cut as a retake: that point plays nowhere, so no level counts it
      points: [point("p1", 0, 3, "key"), point("p2", 3, 4, "secondary"), point("p3", 8, 10, "extra"), point("p4", 5, 8, "key")],
      version: 1,
      plannedOn: { graphics: null, sounds: null },
      transcripts: { [CLIP_ID]: transcriptFingerprint(transcript) },
    },
    flair: {
      looks: {},
      zooms: [
        // on the first piece, which plays
        { anchor: { videoId: CLIP_ID, sourceUs: plan.cuts[0]!.sourceStartUs, beatId: "beat-1" }, kind: "punch", edited: true },
        // on a piece starting at 19 s, which no piece of this cut does
        { anchor: { videoId: CLIP_ID, sourceUs: s(19.0), beatId: "beat-1" }, kind: "punch", edited: true },
      ],
    },
  })
  const asked = (level: FlairLevel) => ({
    position: "auto" as const,
    hideSubtitles: false,
    highlightsOn: true,
    groupCount: 0,
    // `enabled: false`, as an old settings file still carries it: nothing reads it (spec §7), so the zoom
    // is written, and the write and the preview both count the one that lost its piece
    flair: { enabled: false, level, text: true, sound: false, zoom: true, insert: false, graphic: false },
  })

  const medium = await service.write(folder, DEFAULT_CUT_RULES, 0, null, asked("medium"))
  expect(medium).toMatchObject({ emphasisCount: 2, zoomCount: 1, zoomsLost: 1, dropped: { zooms: 0 } })
  expect((await service.write(folder, DEFAULT_CUT_RULES, medium.segmentCount, null, asked("light"))).emphasisCount).toBe(1)
  expect((await service.write(folder, DEFAULT_CUT_RULES, medium.segmentCount, null, asked("heavy"))).emphasisCount).toBe(3)
  // without a highlight request no flair is written and no point is counted
  expect(await service.write(folder, DEFAULT_CUT_RULES, medium.segmentCount)).toMatchObject({ emphasisCount: 0, zoomCount: 0, zoomsLost: 0 })

  // the preview says so before any write
  const highlights = createHighlightService({ outlines, timeline: service, footage: deps })
  const view = { position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair: asked("medium").flair }
  expect((await highlights.preview(folder, DEFAULT_CUT_RULES, view)).zoomsLost).toBe(1)
})

/* a graphic in the place of its point's highlight text */

const ASSETS = { fontPath: async (font: string) => `/Movies/CapCut/boxblack/fonts/${font}.ttf`, animationPath: async (id: string) => `/effect/${id}/hash` }
const SOUND = { effectId: "s1", name: "ปัง", durationUs: 330_000, path: "/cache/s1.mp3" }
const FRAME_US = 1_000_000 / 30

/**
 * The fixture with two key points and the user's own text on each, bound to it: "ขึ้นไป" on pa (group ga), up from
 * 0.15 s, and "อวกาศ" on pb (group gb), which comes up at 1.07 s and so ends pa's there; and a graphic made for pb
 * on its word, written for the 1.7 s it has there, unless `graphic` says otherwise (null: none stored).
 */
async function withReplaced(graphic: Partial<GraphicCue> | null = {}, extra: Parameters<typeof withGraphics>[1] = {}) {
  const context = await withGraphics(graphic ? [{ ...graphicAt(s(18.08)), pointId: "pb", ...graphic }] : [], { highlightAssets: ASSETS, ...extra })
  const point = (id: string, from: number, to: number): EmphasisPoint => ({ id, anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" }, importance: "key", type: "place", reason: "", source: "ai", edited: false })
  const group = (id: string, pointId: string, from: number, to: number, text: string) => ({ id, source: "user" as const, edited: false, beatId: "beat-1", pointId, lines: [{ videoId: CLIP_ID, from, to, text }] })
  const fingerprints = { [CLIP_ID]: transcriptFingerprint(transcript) }
  await context.outlines.update(context.folder, (stored) => ({
    ...stored!,
    emphasis: { points: [point("pa", 0, 2), point("pb", 3, 4)], version: 1, plannedOn: { graphics: 1, sounds: 1 }, transcripts: fingerprints },
    highlights: { style: null, styleByAi: null, beatsKey: beatsKey([countdown]), transcripts: fingerprints, groups: [group("ga", "pa", 0, 2, "ขึ้นไป"), group("gb", "pb", 3, 4, "อวกาศ")] },
  }))
  return context
}
/** What the preview of withReplaced lists: both groups, the replaced one among them. */
const bothGroups = (flair: FlairOptions = GRAPHICS) => ({ ...request(flair), groupCount: 2 })
/** The highlight text segments of the written draft, in playing order. */
const highlightSegments = async (folder: string) =>
  (await readInfo(folder)).tracks
    .filter((track) => track.type === "text" && track.flag === 0)
    .flatMap((track) => track.segments)
    .sort((a, b) => a.target_timerange.start - b.target_timerange.start)

test("the write leaves the text of a replaced group out of the draft and lays its graphic; the group before it still ends where it would have come up, and the count checked is of every group listed", async () => {
  const { service, folder } = await withReplaced()
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, bothGroups())
  expect(result).toMatchObject({ highlightCount: 1, graphicCount: 1, graphicsSkipped: 0 })
  expect(await textsOf(folder)).toEqual(["ขึ้นไป"])
  // "อวกาศ" would have come up 1.07 s in: pa's text leaves there, not once its own 1.2 s are up
  const [text] = await highlightSegments(folder)
  expect(Math.abs(text!.target_timerange.start + text!.target_timerange.duration - 1_070_000)).toBeLessThanOrEqual(FRAME_US)
  // the graphic plays from there
  expect(Math.abs(overlays(await readInfo(folder))[0]!.segments[0]!.target_timerange.start - 1_070_000)).toBeLessThanOrEqual(FRAME_US)
  // the number of groups written is not the number listed: a request that counted only those is refused
  await expect(service.write(folder, DEFAULT_CUT_RULES, result.segmentCount, null, { ...request(), groupCount: 1 })).rejects.toThrow(/highlight text changed since it was shown \(2 groups now, not 1\)/)
})

// many whole fixtures in one test: more than the default five seconds on a cold start
test("the write draws a point's text when its graphic does not play: switched off, stale, not written, none stored, or the graphics off", { timeout: 20_000 }, async () => {
  const written = async (graphic: Partial<GraphicCue> | null, flair: FlairOptions = GRAPHICS) => {
    const { service, folder } = await withReplaced(graphic)
    const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, bothGroups(flair))
    return [await textsOf(folder), result.highlightCount, result.graphicCount]
  }
  const both = ["ขึ้นไป", "อวกาศ"]
  expect(await written({})).toEqual([["ขึ้นไป"], 1, 1])
  expect(await written({ off: true })).toEqual([both, 2, 0])
  // written for the countdown's words, which are not said where it plays
  expect(await written({ spec: COUNTDOWN })).toEqual([both, 2, 0])
  expect(await written({ spec: { ...SPEC, html: null } })).toEqual([both, 2, 0])
  expect(await written(null)).toEqual([both, 2, 0])
  expect(await written({}, { ...GRAPHICS, graphic: false })).toEqual([both, 2, 0])
  // made for no point, it plays beside the text of both
  expect(await written({ pointId: undefined })).toEqual([both, 2, 1])
})

test("a graphic whose render fails at write time leaves its point with neither text nor graphic in that write, which counts the graphic as skipped", async () => {
  const { service, folder } = await withReplaced({}, { outcome: () => "failed" })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, bothGroups())
  expect(result).toMatchObject({ highlightCount: 1, graphicCount: 0, graphicsSkipped: 1 })
  expect(await textsOf(folder)).toEqual(["ขึ้นไป"])
  expect(overlays(await readInfo(folder))).toEqual([])
})

test("a write whose groups are all replaced writes no highlight text, and needs no fonts for it", async () => {
  const { service, folder, outlines } = await withReplaced({}, { highlightAssets: undefined })
  // pa's text goes: the one group left is pb's, which its graphic replaces
  await outlines.update(folder, (stored) => ({ ...stored!, highlights: { ...stored!.highlights!, groups: stored!.highlights!.groups.filter((group) => group.id === "gb") } }))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { ...request(), groupCount: 1 })
  expect(result).toMatchObject({ highlightCount: 0, graphicCount: 1 })
})

test("a replaced group still counts in the run of looks the write draws: the groups after it are drawn as the preview shows them", async () => {
  const { service, folder, outlines } = await withReplaced()
  // four one-line groups in a row, all Claude's punch, the second one replaced: no pattern runs for more than three
  // groups, so the fourth is drawn as the plain stack, as it is with all four drawn
  const punch = { pattern: "punch" as const, tone: "base" as const, accent: null, exit: null, edited: false }
  await outlines.update(folder, (stored) => {
    const [pa, pb] = stored!.emphasis!.points
    const [ga, gb] = stored!.highlights!.groups
    const on = (from: number): EmphasisPoint["anchor"] => ({ kind: "speech", videoId: CLIP_ID, from, to: from + 1, beatId: "beat-1" })
    const text = (id: string, pointId: string, from: number, said: string) => ({ ...gb!, id, pointId, lines: [{ videoId: CLIP_ID, from, to: from + 1, text: said }] })
    return {
      ...stored!,
      emphasis: { ...stored!.emphasis!, points: [pa!, pb!, { ...pb!, id: "pc", anchor: on(8) }, { ...pb!, id: "pd", anchor: on(9) }] },
      highlights: { ...stored!.highlights!, groups: [ga!, gb!, text("gc", "pc", 8, "สาม"), text("gd", "pd", 9, "สอง")] },
      flair: { ...stored!.flair!, looks: { ga: punch, gb: punch, gc: punch, gd: punch } },
    }
  })
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, { ...request(), groupCount: 4 })
  expect(result).toMatchObject({ highlightCount: 3, graphicCount: 1 })
  expect(await textsOf(folder)).toEqual(["ขึ้นไป", "สาม", "สอง"])
  const scaleOf = (pattern: "punch" | "stack", said: string) => layoutGroup([said], "kanit", { width: 1080, height: 1920 }, { kind: "auto", keepClear: null, keepSubtitleRoom: false }, pattern).lines[0]!.scale
  expect(scaleOf("punch", "สอง")).not.toBe(scaleOf("stack", "สอง"))
  const scales = (await highlightSegments(folder)).map((segment) => (segment.clip as { scale: { x: number } }).scale.x)
  expect(scales).toEqual([scaleOf("punch", "ขึ้นไป"), scaleOf("punch", "สาม"), scaleOf("stack", "สอง")])
})

test("a sound on a replaced group's line plays where the line would have come up", async () => {
  const { service, folder, outlines } = await withReplaced({}, { sounds: { list: async () => [SOUND] } })
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, cues: [{ anchor: { kind: "highlight", groupId: "gb", line: 0 }, effectId: "s1", edited: true, pointId: "pb" }] } }))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, bothGroups({ ...GRAPHICS, sound: true }))
  expect(result).toMatchObject({ highlightCount: 1, soundCount: 1, dropped: { sounds: 0 } })
  const [sound] = (await readInfo(folder)).tracks.filter((track) => track.type === "audio").flatMap((track) => track.segments)
  expect(Math.abs(sound!.target_timerange.start - 1_070_000)).toBeLessThanOrEqual(FRAME_US)
})

test("a cutaway on a replaced group's line plays where the line would have come up", async () => {
  const { service, folder, outlines } = await withReplaced({}, { inserts: true })
  // the user's cutaway on the line of pb's text, which its graphic takes the place of
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, inserts: [{ anchor: { kind: "highlight", groupId: "gb", line: 0 }, binId: "m1", edited: true, fit: "cover", subject: null, pointId: "pb" }] } }))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, bothGroups({ ...GRAPHICS, insert: true }))
  expect(result).toMatchObject({ highlightCount: 1, insertCount: 1, graphicCount: 1, dropped: { inserts: 0 } })
  const [cutaways] = overlays(await readInfo(folder))
  expect(Math.abs(cutaways!.segments[0]!.target_timerange.start - 1_070_000)).toBeLessThanOrEqual(FRAME_US)
})

test("a punch zoom lands on a replaced group's line, where it would have come up, not at the start of its piece", async () => {
  // the graphic is made for pa, on its first word: pa's text, the first line in the first piece, is the one replaced
  const { service, folder, outlines } = await withReplaced({ ...graphicAt(s(17.16)), pointId: "pa" })
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, zooms: [{ anchor: { videoId: CLIP_ID, sourceUs: plan.cuts[0]!.sourceStartUs, beatId: "beat-1" }, kind: "punch", edited: true, pointId: "pa" }] } }))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, bothGroups({ ...GRAPHICS, zoom: true }))
  expect(result).toMatchObject({ highlightCount: 1, zoomCount: 1, graphicCount: 1 })
  expect(await textsOf(folder)).toEqual(["อวกาศ"])
  const [piece] = (await readInfo(folder)).tracks[0]!.segments
  const scale = piece!.common_keyframes!.find((entry) => entry.property_type === "KFTypeScaleX")!
  // it holds until "ขึ้นไป" would have come up, 0.15 s into the piece, and punches in there
  expect(scale.keyframe_list.map((entry) => entry.values[0])).toEqual([1, 1, 1.15])
  expect(scale.keyframe_list[1]!.time_offset).toBe(piece!.source_timerange!.start + 150_000)
})

test("without CapCut Pro the exits left out are counted over the groups written: a replaced group's is not", async () => {
  const { service, folder, outlines } = await withReplaced({}, { pro: false })
  const spinOut = { pattern: "stack" as const, tone: "base" as const, accent: null, exit: "spin-out", edited: true }
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, looks: { ga: spinOut, gb: spinOut } } }))
  const replaced = await service.write(folder, DEFAULT_CUT_RULES, 0, null, bothGroups())
  expect(replaced.proLeftOut.exits).toBe(1)
  const drawn = await service.write(folder, DEFAULT_CUT_RULES, replaced.segmentCount, null, bothGroups({ ...GRAPHICS, graphic: false }))
  expect(drawn.proLeftOut.exits).toBe(2)
})

test("with the lines under the text hidden, a replaced group hides no words: the subtitles say them, in the preview of lines and in the write alike", async () => {
  const { service, folder, deps, graphicJobs } = await withReplaced()
  await deps.settings.update({ flair: GRAPHICS })
  const textOf = (lines: { text: string }[]) => lines.map((line) => line.text)
  // pa's text hides "ขึ้นไป"; pb's is not drawn, so "อวกาศ" stays in the line
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "line", true)
  expect(textOf(lines)).toEqual(["ในอวกาศใน", "สามสองหนึ่ง"])
  // the graphics are those in force under the saved settings, with the subtitles on, as the write asks for them
  expect(graphicJobs).toHaveBeenCalledTimes(1)
  expect(graphicJobs).toHaveBeenLastCalledWith(folder, DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: true, highlightsOn: true, flair: (await deps.settings.read()).flair })
  // the write finds the same lines, so its check of them passes, and the words are in the draft
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "line", texts: textOf(lines) }, { ...bothGroups(), hideSubtitles: true })
  expect(result).toMatchObject({ captionCount: 2, highlightCount: 1, graphicCount: 1 })
  expect(await textsOf(folder)).toContain("ในอวกาศใน")
  // with the graphic switched off its point's text is drawn again, and hides its word again: the line breaks around it
  await deps.outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, graphics: stored!.flair!.graphics!.map((cue) => ({ ...cue, off: true })) } }))
  expect(textOf(await service.subtitles(folder, DEFAULT_CUT_RULES, "line", true))).toEqual(["ใน", "ใน", "สามสองหนึ่ง"])
})

test("subtitles that hide nothing under the text cost what they did: the graphics are not worked out for them, nor while the graphics are off", async () => {
  const { service, folder, deps, graphicJobs } = await withReplaced()
  await deps.settings.update({ flair: GRAPHICS })
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line", false)).map((line) => line.text)).toEqual(["ขึ้นไปในอวกาศใน", "สามสองหนึ่ง"])
  expect(graphicJobs).not.toHaveBeenCalled()
  // hidden under the text, with the graphics off in the saved settings: no graphic plays, so none is worked out
  await deps.settings.update({ flair: { ...GRAPHICS, graphic: false } })
  expect((await service.subtitles(folder, DEFAULT_CUT_RULES, "line", true)).map((line) => line.text)).toEqual(["ใน", "ใน", "สามสองหนึ่ง"])
  expect(graphicJobs).not.toHaveBeenCalled()
  // a write that does not hide them asks for the graphics once, for the graphics themselves, as it always did
  const lines = await service.subtitles(folder, DEFAULT_CUT_RULES, "line", false)
  await service.write(folder, DEFAULT_CUT_RULES, 0, { length: "line", texts: lines.map((line) => line.text) }, bothGroups())
  expect(graphicJobs).toHaveBeenCalledTimes(1)
})


/* composed sounds */

const SOUNDS_ON: FlairOptions = { ...GRAPHICS, sound: true }
const CODE = "function compose(ctx, cue, kit) { return kit.silence() }"
/** A composed sound on a moment of speech, written for the seconds and words `written` says. */
const soundAt = (sourceUs: number, written: Pick<ComposedSound, "seconds" | "words">, over: Partial<ComposedSound> = {}): ComposedSound => ({
  anchor: { kind: "speech", videoId: CLIP_ID, sourceUs, beatId: "beat-1" },
  from: "light",
  role: "เสียงวูบขึ้น",
  loudness: "normal",
  code: CODE,
  version: SOUND_VERSION,
  off: false,
  ...written,
  ...over,
})
/** Written on ขึ้น for its 2 s, as the graphic there is. */
const UP = soundAt(s(17.16), WRITTEN_FOR[s(17.16)]!)
/** Written on the second countdown's สาม for its 2 s. */
const COUNT = soundAt(s(22.62), { seconds: 2, words: COUNTDOWN.words }, { code: `${CODE}\n// count` })
/** Scoring `graphic`, composed to its fragment, for the 1.7 s it has on อวกาศ. */
const tiedTo = (graphic: GraphicCue, over: Partial<ComposedSound> = {}) =>
  soundAt(graphic.anchor.kind === "speech" ? graphic.anchor.sourceUs : 0, WRITTEN_FOR[s(18.08)]!, { graphic: graphic.anchor, graphicHtml: hashOfHtml(graphic.spec.html!), code: `${CODE}\n// tied`, ...over })

const RATE_BYTES = 48_000 * 4
/** A 16-bit stereo 48 kHz WAV of `seconds`, with a LIST chunk before its data, as ffmpeg writes one. */
function wavFile(seconds: number): Buffer {
  const data = Buffer.alloc(Math.round(seconds * 48_000) * 4)
  const fmt = Buffer.alloc(24)
  fmt.write("fmt ", 0, "latin1")
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(2, 10)
  fmt.writeUInt32LE(48_000, 12)
  fmt.writeUInt32LE(RATE_BYTES, 16)
  fmt.writeUInt16LE(4, 20)
  fmt.writeUInt16LE(16, 22)
  // an odd size, padded to an even one as RIFF asks
  const list = Buffer.alloc(8 + 28)
  list.write("LIST", 0, "latin1")
  list.writeUInt32LE(27, 4)
  list.write("INFOISFT", 8, "latin1")
  const head = Buffer.alloc(8)
  head.write("data", 0, "latin1")
  head.writeUInt32LE(data.length, 4)
  const riff = Buffer.alloc(12)
  riff.write("RIFF", 0, "latin1")
  riff.writeUInt32LE(4 + fmt.length + list.length + head.length + data.length, 4)
  riff.write("WAVE", 8, "latin1")
  return Buffer.concat([riff, fmt, list, head, data])
}

/**
 * A sound renderer that makes the file of every job it is asked to ensure, unless `outcome` says it fails, is stopped,
 * or is kept as a file that is no WAV ("garbled"), as the real one does: a file there is not made again, a failure is
 * kept, and a stopped job is neither. Each file is `fileSeconds` long, by default a quarter of a second shorter than
 * the sound, as a render cut of its silent tail is. Like the real one, while the machine is found unfit (`machine.problem`)
 * nothing renders until it is forgotten; a problem that `stays` comes back as soon as it is forgotten.
 */
function fakeSoundRenderer(dir: string, outcome: (job: SoundJob) => "made" | "failed" | "stopped" | "garbled" = () => "made", fileSeconds = (job: SoundJob) => job.seconds - 0.25) {
  const failed = new Set<string>()
  const ensured: SoundJob[][] = []
  const fileOf = (job: SoundJob) => join(dir, `${soundHashOf(job)}.wav`)
  const there = (path: string) => stat(path).then(() => true, () => false)
  const machine = { problem: null as string | null, stays: false, forgotten: 0 }
  return {
    ensured,
    machine,
    fileOf,
    async ensure(jobs: SoundJob[]) {
      ensured.push(jobs)
      for (const job of jobs) {
        if ((await there(fileOf(job))) || failed.has(soundHashOf(job)) || machine.problem !== null) continue
        const result = outcome(job)
        if (result === "made" || result === "garbled") {
          await mkdir(dir, { recursive: true })
          await writeFile(fileOf(job), result === "made" ? wavFile(fileSeconds(job)) : "not a wav")
        } else if (result === "failed") failed.add(soundHashOf(job))
      }
    },
    async statusOf(job: SoundJob) {
      if (await there(fileOf(job))) return "ready" as const
      return failed.has(soundHashOf(job)) ? ("failed" as const) : ("pending" as const)
    },
    failureOf: (job: SoundJob) => (failed.has(soundHashOf(job)) ? "failed" : null),
    environmentProblem: () => machine.problem,
    forgetMachine() {
      machine.forgotten++
      if (!machine.stays) machine.problem = null
    },
  }
}

/** The graphics set-up with composed sounds stored too, placed by the highlight service as the app wires it, and a fake sound renderer writing into a sounds folder shaped like the app's. */
async function withSounds(
  sounds: ComposedSound[],
  graphics: GraphicCue[] = [],
  extra: Parameters<typeof withGraphics>[1] & { soundOutcome?: Parameters<typeof fakeSoundRenderer>[1]; fileSeconds?: Parameters<typeof fakeSoundRenderer>[2] } = {},
) {
  const context = await withGraphics(graphics, extra)
  await context.outlines.update(context.folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, composed: sounds } }))
  const soundsDir = join(context.dir, "Movies", "CapCut", "BOXBLACK", "sounds")
  const soundRenderer = fakeSoundRenderer(soundsDir, extra.soundOutcome, extra.fileSeconds)
  const deps: TimelineDeps = { ...context.deps, soundRenderer, composedSounds: (...args) => context.highlights.composedSounds(...args), soundsDir }
  return { ...context, deps, service: createTimelineService(deps), soundRenderer, soundsDir }
}

const viewOf = (flair: FlairOptions) => ({ position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair })
/** Each stored sound's render job as the write places it now (soundJobOf), found by its anchor. */
async function jobsOf(context: Awaited<ReturnType<typeof withSounds>>, flair: FlairOptions = SOUNDS_ON): Promise<(sound: ComposedSound) => SoundJob> {
  const { kept, off } = await context.highlights.composedSounds(context.folder, DEFAULT_CUT_RULES, viewOf(flair))
  return (sound) => soundJobOf([...kept, ...off].find((placed) => samePlace(placed.sound.anchor, sound.anchor))!)
}
type Info = Awaited<ReturnType<typeof readInfo>>
const composedMaterials = (info: Info) => (info.materials.audios as { id: string; type: string; path: string; duration: number; local_material_id: string }[]).filter((audio) => audio.type === "extract_music")
/** The composed sounds' segments in playing order, each with the material it plays. */
const composedSegments = (info: Info) => {
  const materials = composedMaterials(info)
  return info.tracks
    .filter((track) => track.type === "audio")
    .flatMap((track) => track.segments)
    .flatMap((segment) => {
      const material = materials.find((audio) => audio.id === segment.material_id)
      return material ? [{ segment, material }] : []
    })
    .sort((a, b) => a.segment.target_timerange.start - b.segment.target_timerange.start)
}
const NO_SOUND_LEFT_OUT = { unwritten: 0, stale: 0, failed: 0 }

test("a WAV's own length is read from its data chunk, in whole microseconds, past any chunk before it", async () => {
  const { dir } = await setup()
  const path = join(dir, "a.wav")
  await writeFile(path, wavFile(1.5))
  expect(await wavLengthUs(path)).toBe(1_500_000)
  // 7 frames are 145.833… µs: whole microseconds, never more than the file holds
  const seven = wavFile(7 / 48_000)
  await writeFile(path, seven)
  expect(await wavLengthUs(path)).toBe(145)
  await writeFile(path, "not a wav")
  await expect(wavLengthUs(path)).rejects.toThrow()
  // a data size of 0xFFFFFFFF (a stream whose length was never written back) or one cut short: what the file holds
  const second = wavFile(1)
  const sizeAt = second.length - 192_000 - 4
  const streamed = Buffer.from(second)
  streamed.writeUInt32LE(0xffffffff, sizeAt)
  await writeFile(path, streamed)
  expect(await wavLengthUs(path)).toBe(1_000_000)
  await writeFile(path, second.subarray(0, second.length - 96_000))
  expect(await wavLengthUs(path)).toBe(500_000)
  // no sound in it
  await writeFile(path, wavFile(0))
  expect(await wavLengthUs(path)).toBe(0)
  // a chunk before the data that says it is longer than the file: no data is found
  const oversized = Buffer.from(second)
  oversized.writeUInt32LE(0x7fffffff, 12 + 24 + 4)
  await writeFile(path, oversized)
  await expect(wavLengthUs(path)).rejects.toThrow("has no sound in it")
})

test("the write waits for the composed sounds in force, then lays each on an audio track for its file's own length, each file in the media bin", async () => {
  const graphic = graphicAt(s(18.08))
  const tied = tiedTo(graphic)
  const context = await withSounds([COUNT, UP, tied], [graphic])
  const { service, folder, soundRenderer, soundsDir } = context
  const jobOf = await jobsOf(context)
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ composedCount: 3, composedLeftOut: NO_SOUND_LEFT_OUT, graphicCount: 1, soundCount: 0 })
  // the three were ensured together, before the draft was read, each by what is heard of it as stored
  expect(soundRenderer.ensured).toHaveLength(1)
  expect(new Set(soundRenderer.ensured[0]!.map(soundHashOf))).toEqual(new Set([UP, tied, COUNT].map((sound) => soundHashOf(jobOf(sound)))))

  const info = await readInfo(folder)
  const laid = composedSegments(info)
  expect(laid.map(({ material }) => material.path)).toEqual([UP, tied, COUNT].map((sound) => soundRenderer.fileOf(jobOf(sound))))
  // each plays its whole file, which the render made a quarter of a second shorter than the sound
  expect(laid.map(({ segment }) => segment.target_timerange.duration)).toEqual([1_750_000, 1_450_000, 1_750_000])
  expect(laid.map(({ material }) => material.duration)).toEqual([1_750_000, 1_450_000, 1_750_000])
  // the tied one starts with its graphic
  const [graphicSegment] = overlays(info)[0]!.segments
  expect(laid[1]!.segment.target_timerange.start).toBe(graphicSegment!.target_timerange.start)
  // สาม plays 2.92 s in: the frame it lands on
  expect(Math.abs(laid[2]!.segment.target_timerange.start - 2_920_000)).toBeLessThanOrEqual(FRAME_US)

  // each file is in the media bin once, as music, and its material points at that entry
  const entries = (await imported(folder)).filter((item) => item.file_Path.startsWith(soundsDir))
  expect(entries).toHaveLength(3)
  for (const { material } of laid) {
    const entry = entries.find((item) => item.file_Path === material.path)!
    expect(entry).toMatchObject({ metetype: "music", duration: material.duration })
    expect(material.local_material_id).toBe(entry.id)
  }
})

test("the composed sounds go after the graphics and before the CapCut sounds", async () => {
  const library = { list: async () => [{ effectId: "s1", name: "ปัง", durationUs: 330_000, path: null }] }
  const graphic = graphicAt(s(18.08))
  const { service, folder, outlines } = await withSounds([COUNT], [graphic], { sounds: library })
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, cues: [{ anchor: { kind: "beat", beatId: "beat-1", edge: "start" }, effectId: "s1", edited: true }] } }))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ composedCount: 1, soundCount: 1, graphicCount: 1 })
  const info = await readInfo(folder)
  const kinds = info.tracks.map((track) => {
    if (track.type !== "audio") return track.flag === 2 ? "overlay" : track.type
    const material = (info.materials.audios as { id: string; type: string }[]).find((audio) => audio.id === track.segments[0]!.material_id)!
    return material.type
  })
  expect(kinds.slice(kinds.indexOf("overlay"))).toEqual(["overlay", "extract_music", "sound"])
})

test("a sound not composed yet, whose composing or render failed, or stale, is left out and counted; the rest are laid", async () => {
  const unwritten = soundAt(s(17.44), { seconds: 1, words: [] }, { code: null })
  const writingFailed = soundAt(s(17.68), { seconds: 1, words: [] }, { code: null, failed: "the code failed twice" })
  // composed under an older contract
  const old = soundAt(s(19.0), { seconds: 1, words: [] }, { version: "sound-2026-01-01" })
  const renderFails = { ...UP, code: `${CODE}\n// fails` }
  const context = await withSounds([unwritten, writingFailed, old, renderFails, COUNT], [], { soundOutcome: (job) => (job.code.endsWith("fails") ? "failed" : "made") })
  const { service, folder, soundRenderer } = context
  const jobOf = await jobsOf(context)
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ composedCount: 1, composedLeftOut: { unwritten: 1, stale: 1, failed: 2 } })
  // only the written, fresh ones were asked for
  expect(soundRenderer.ensured.map((jobs) => jobs.length)).toEqual([2])
  expect(composedSegments(await readInfo(folder)).map(({ material }) => material.path)).toEqual([soundRenderer.fileOf(jobOf(COUNT))])
})

test("a sound tied to a graphic the write leaves out is left out too, as stale: its graphic not written, stale or failed", async () => {
  const failing = { ...graphicAt(s(18.08)), spec: { ...graphicAt(s(18.08)).spec, html: OTHER_FRAGMENT } }
  // composed to its graphic, which is written and fresh but whose render fails
  const onFailing = tiedTo(failing)
  // composed to its graphic's fragment, which is no longer written
  const unwritten = { ...graphicAt(s(17.16)), spec: { ...graphicAt(s(17.16)).spec, html: null } }
  const onUnwritten = soundAt(s(17.16), WRITTEN_FOR[s(17.16)]!, { graphic: unwritten.anchor, graphicHtml: hashOfHtml(FRAGMENT) })
  const context = await withSounds([onFailing, onUnwritten], [failing, unwritten], { outcome: (job) => (job.spec.html === OTHER_FRAGMENT ? "failed" : "made") })
  const { service, folder, soundRenderer } = context
  const jobOf = await jobsOf(context)
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ graphicCount: 0, graphicsSkipped: 2, composedCount: 0, composedLeftOut: { unwritten: 0, stale: 2, failed: 0 } })
  // the one whose graphic had a job was made, in case the graphic is: it is in no draft
  expect(soundRenderer.ensured.flat().map(soundHashOf)).toEqual([soundHashOf(jobOf(onFailing))])
  expect(composedSegments(await readInfo(folder))).toEqual([])
})

test("a switched-off sound, one the level holds back, and every sound with the sounds off are neither laid nor counted", async () => {
  const off = { ...UP, off: true }
  const heavy = { ...COUNT, from: "heavy" as const }
  const { service, folder, soundRenderer } = await withSounds([off, heavy])
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ composedCount: 0, composedLeftOut: NO_SOUND_LEFT_OUT })
  expect(soundRenderer.ensured.flat()).toEqual([])

  const again = await withSounds([UP, COUNT])
  const quiet = await again.service.write(again.folder, DEFAULT_CUT_RULES, 0, null, request(GRAPHICS))
  expect(quiet).toMatchObject({ composedCount: 0, composedLeftOut: NO_SOUND_LEFT_OUT })
  expect(again.soundRenderer.ensured).toEqual([])
  expect(composedSegments(await readInfo(again.folder))).toEqual([])
})

test("sounds stopped before they were made leave the draft as it was, and no backup; a machine found unfit says so", async () => {
  const { deps, folder, service, soundRenderer } = await withSounds([UP, COUNT], [], { soundOutcome: (job) => (job.code === CODE ? "made" : "stopped") })
  const files = () => Promise.all(["draft_info.json", "draft_meta_info.json"].map((file) => readFile(join(folder, file), "utf8")))
  const before = await files()
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))).rejects.toThrow("the sounds were stopped before they were made; the draft was not changed")
  expect(await files()).toEqual(before)
  await expect(readdir(deps.backupRoot)).rejects.toThrow()
  // a machine found unfit is given another try before the write waits; one still unfit is named, and the write stops
  soundRenderer.machine.problem = "the app's ffmpeg is missing"
  soundRenderer.machine.stays = true
  await expect(service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))).rejects.toThrow(
    "the sounds cannot be made on this machine: the app's ffmpeg is missing, or turn sounds off; the draft was not changed",
  )
  expect(soundRenderer.machine.forgotten).toBe(2)
  expect(await files()).toEqual(before)
})

test("a machine an earlier render found unfit is forgotten before the write waits, so the sounds are made if they can be now", async () => {
  const { service, folder, soundRenderer } = await withSounds([UP, COUNT])
  soundRenderer.machine.problem = "the sound page could not start"
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ composedCount: 2, composedLeftOut: NO_SOUND_LEFT_OUT })
  expect(soundRenderer.machine.forgotten).toBe(1)
})

test("the media bin keeps one entry a file, reused on the next write, and loses the sounds a write no longer plays; the user's media stays", async () => {
  const context = await withSounds([UP, COUNT])
  const { service, folder, soundsDir, outlines } = context
  const jobOf = await jobsOf(context)
  const before = await imported(folder)
  const first = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  const wavs = async () => (await imported(folder)).filter((item) => item.file_Path.startsWith(soundsDir))
  const entries = await wavs()
  expect(entries).toHaveLength(2)
  // written again, each keeps its entry
  const second = await service.write(folder, DEFAULT_CUT_RULES, first.segmentCount, null, request(SOUNDS_ON))
  expect(await wavs()).toEqual(entries)
  expect(composedSegments(await readInfo(folder)).map(({ material }) => material.local_material_id)).toEqual(entries.map((entry) => entry.id))
  // one switched off goes from the bin; with the sounds off they all go, and the user's media stays
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { ...stored!.flair!, composed: [{ ...UP, off: true }, COUNT] } }))
  const third = await service.write(folder, DEFAULT_CUT_RULES, second.segmentCount, null, request(SOUNDS_ON))
  expect((await wavs()).map((entry) => entry.id)).toEqual([entries.find((entry) => entry.file_Path.includes(soundHashOf(jobOf(COUNT))))!.id])
  await service.write(folder, DEFAULT_CUT_RULES, third.segmentCount, null, request(GRAPHICS))
  expect(await imported(folder)).toEqual(before)
})

test("words said at other times keep a sound fresh: it is rendered for their times now, and the preview and the write ask about the same file", async () => {
  // ไป said 0.06 s later than when UP was composed, the rest as they were
  const words = transcript.words.map((said) => (said.text === "ไป" ? { ...said, startUs: s(17.5) } : said.text === "ขึ้น" ? { ...said, endUs: s(17.5) } : said))
  const context = await withSounds([UP], [], { transcript: { ...transcript, words } })
  const { service, folder, soundRenderer, outlines } = context
  const highlights = createHighlightService({ outlines, timeline: context.service, footage: context.deps, soundStatus: soundStatusOf(soundRenderer), soundRenderer })
  const [shown] = (await highlights.preview(folder, DEFAULT_CUT_RULES, viewOf(SOUNDS_ON))).composed
  expect(shown).toMatchObject({ written: true, stale: null })
  const job = (await jobsOf(context))(UP)
  expect(job.words.map((word) => word.atS)).toEqual([0, 0.34, 0.52, 0.92, 1.84])
  // the preview started its render with the words as they fall now, not as they were composed
  await vi.waitFor(() => expect(soundRenderer.ensured.flat().map(soundHashOf)).toEqual([soundHashOf(job)]))
  await vi.waitFor(async () => expect((await highlights.preview(folder, DEFAULT_CUT_RULES, viewOf(SOUNDS_ON))).composed[0]!.render).toBe("ready"))
  const result = await service.write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ composedCount: 1, composedLeftOut: NO_SOUND_LEFT_OUT })
  // the write asked about that same file, made by then, and laid it
  expect(soundRenderer.ensured.at(-1)!.map(soundHashOf)).toEqual([soundHashOf(job)])
  expect(composedSegments(await readInfo(folder)).map(({ material }) => material.path)).toEqual([soundRenderer.fileOf(job)])
})

test("a sound whose file is empty, or is there but cannot be read when it is laid, is left out as failed, with no bin entry", async () => {
  const empty = await withSounds([UP], [], { fileSeconds: () => 0 })
  expect(await empty.service.write(empty.folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))).toMatchObject({ composedCount: 0, composedLeftOut: { unwritten: 0, stale: 0, failed: 1 } })
  expect((await imported(empty.folder)).filter((item) => item.file_Path.startsWith(empty.soundsDir))).toEqual([])
  const garbled = await withSounds([UP], [], { soundOutcome: () => "garbled" })
  expect(await garbled.service.write(garbled.folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))).toMatchObject({ composedCount: 0, composedLeftOut: { unwritten: 0, stale: 0, failed: 1 } })
  expect((await imported(garbled.folder)).filter((item) => item.file_Path.startsWith(garbled.soundsDir))).toEqual([])
})

test("two sounds made of the same file share one entry in the media bin", async () => {
  const context = await withSounds([COUNT])
  const { deps, folder, highlights, soundsDir } = context
  // the same sound played again 2.5 s earlier: the same job, so the same file
  const twice: TimelineDeps["composedSounds"] = async (...args) => {
    const placed = await highlights.composedSounds(...args)
    return { ...placed, kept: [{ ...placed.kept[0]!, atUs: placed.kept[0]!.atUs - 2_500_000 }, ...placed.kept] }
  }
  const result = await createTimelineService({ ...deps, composedSounds: twice }).write(folder, DEFAULT_CUT_RULES, 0, null, request(SOUNDS_ON))
  expect(result).toMatchObject({ composedCount: 2 })
  const entries = (await imported(folder)).filter((item) => item.file_Path.startsWith(soundsDir))
  expect(entries).toHaveLength(1)
  expect(composedSegments(await readInfo(folder)).map(({ material }) => material.local_material_id)).toEqual([entries[0]!.id, entries[0]!.id])
})

test("when the clip's last words carry a point, the rough cut holds its end for what sits on them; a point earlier, or on a changed transcript, leaves it", async () => {
  const { service, folder, deps } = await setup()
  const endOf = async () => (await service.preview(folder, DEFAULT_CUT_RULES)).beats.at(-1)!.pieces.at(-1)!.endUs
  const plain = await endOf()
  const point = (from: number, to: number): EmphasisPoint => ({ id: `p${from}`, anchor: { kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" }, importance: "key", type: "number", reason: "", source: "ai", edited: false })

  // ขึ้นไปในอวกาศ is said well before the end
  await storePoints(deps.outlines, folder, [point(0, 3)])
  expect(await endOf()).toBe(plain)

  // สอง หนึ่ง are the last words: 1.5 s after หนึ่ง, which ends at 25.25 s, with no word after it in the video
  await storePoints(deps.outlines, folder, [point(0, 3), point(9, 10)])
  expect(await endOf()).toBe(s(25.25) + 1_500_000)

  // the same point on a transcript that has changed since is not the clip's any more
  await deps.outlines.update(folder, (stored) => ({ ...stored!, emphasis: { ...stored!.emphasis!, transcripts: { [CLIP_ID]: "older" } } }))
  expect(await endOf()).toBe(plain)
})
