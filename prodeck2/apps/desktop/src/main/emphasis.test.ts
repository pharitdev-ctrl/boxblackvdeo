import { expect, test } from "vitest"
import type { Transcript } from "@boxblack/core/asr"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import { DEFAULT_CUT_RULES, type CutRow } from "@boxblack/core/cut/rules"
import type { EmphasisAnchor, EmphasisPoint, EmphasisReply, StoredEmphasis } from "@boxblack/core/emphasis"
import type { GroupLook } from "@boxblack/core/flair/plan"
import type { GraphicCue } from "@boxblack/core/graphics/plan"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import type { Beat } from "@boxblack/core/planner"
import type { Scene, VideoInsight } from "@boxblack/core/vision"
import type { StoredOutline } from "../shared/api.ts"
import { createEmphasisService, emphasisScenes, emphasisView, withoutPoint } from "./emphasis.ts"
import { transcriptFingerprint } from "./footage.ts"
import { OutlineStore } from "./planner.ts"
import { CLIP_ID, countdown, s, setup, transcript } from "./timeline-fixture.ts"

// ---- a hand-made rough cut for the pure helpers ----
// "v" is said: แมว(0) กิน(1) ปลา(2) ทอด(3) ที่(4) บ้าน(5), one word a second; "ทอด" is cut as a filler.
// "p" is a picture beat of a cat and fish, kept 1–3 s and 4–5 s. The rough cut: v 0–3 s | v 4–6 s | p 1–3 s | p 4–5 s,
// playing at 0, 3, 5 and 7 s, 8 s in all.

const second = (text: string, at: number) => ({ text, startUs: at * 1_000_000, endUs: (at + 1) * 1_000_000 })
const TALK: Transcript = {
  engine: "whisper-local",
  model: "large-v3-q5_0",
  language: "th",
  utterances: [],
  words: [second("แมว", 0), second("กิน", 1), second("ปลา", 2), second("ทอด", 3), second("ที่", 4), second("บ้าน", 5)],
  audioEvents: [],
}
const scene = (from: number, to: number, description: string, kind: Scene["kind"] = "b-roll"): Scene => ({ startUs: from * 1_000_000, endUs: to * 1_000_000, description, kind, issues: [], keepClear: null })
const insightOf = (scenes: Scene[]): VideoInsight => ({
  model: "claude-opus-5",
  promptVersion: "vision",
  frameCount: scenes.length,
  retakes: [],
  signals: { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] },
  summary: "",
  scenes,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
})
const CLIPS: CutClip[] = [
  // a speech beat's pictures are never offered as scenes
  { id: "v", name: "talk.mov", durationUs: 6_000_000, transcript: TALK, insight: insightOf([scene(0, 6, "คนพูดหน้ากล้อง", "talking-head")]) },
  { id: "p", name: "cat.mp4", durationUs: 8_000_000, transcript: null, insight: insightOf([scene(0, 2, "แมวกระโดดขึ้นโต๊ะ"), scene(2, 6, "ปลาทอดในจาน"), scene(6, 8, "ประตูบ้าน")]) },
]
const beat = (id: string, name: string, videoId: string, kind: Beat["kind"], visual: string): Beat => ({
  id,
  name,
  purpose: `หน้าที่ของ${name}`,
  videoId,
  videoName: `${videoId}.mov`,
  kind,
  fromIndex: 0,
  toIndex: 0,
  startUs: 0,
  endUs: 6_000_000,
  speech: "",
  visual,
})
const used = (indexes: number[], text: string): CutRow => ({
  state: "used",
  reason: null,
  startUs: indexes[0]! * 1_000_000,
  endUs: (indexes.at(-1)! + 1) * 1_000_000,
  text,
  toggle: { type: "words", indexes, keep: false },
})
const PLAN: CutPlan = {
  beats: [
    {
      beatId: "b1",
      videoId: "v",
      pieces: [
        { startUs: 0, endUs: 3_000_000 },
        { startUs: 4_000_000, endUs: 6_000_000 },
      ],
      removals: [{ reason: "filler", startUs: 3_000_000, endUs: 4_000_000, text: "ทอด" }],
      originalUs: 6_000_000,
      keptUs: 5_000_000,
      notes: [],
      rows: [used([0, 1, 2], "แมวกินปลา"), { state: "cut", reason: "filler", startUs: 3_000_000, endUs: 4_000_000, text: "ทอด", toggle: { type: "words", indexes: [3], keep: true } }, used([4, 5], "ที่บ้าน")],
    },
    {
      beatId: "b2",
      videoId: "p",
      pieces: [
        { startUs: 1_000_000, endUs: 3_000_000 },
        { startUs: 4_000_000, endUs: 5_000_000 },
      ],
      removals: [],
      originalUs: 8_000_000,
      keptUs: 3_000_000,
      notes: [],
      rows: [],
    },
  ],
  cuts: [
    { binId: "v", sourceStartUs: 0, sourceDurationUs: 3_000_000 },
    { binId: "v", sourceStartUs: 4_000_000, sourceDurationUs: 2_000_000 },
    { binId: "p", sourceStartUs: 1_000_000, sourceDurationUs: 2_000_000 },
    { binId: "p", sourceStartUs: 4_000_000, sourceDurationUs: 1_000_000 },
  ],
  durationUs: 8_000_000,
}
const words = (from: number, to: number): EmphasisAnchor => ({ kind: "speech", videoId: "v", from, to, beatId: "b1" })
const PA: EmphasisPoint = { id: "pa", anchor: words(1, 3), importance: "key", type: "product", reason: "ของกิน", source: "ai", edited: false }
// every word of it is cut
const PB: EmphasisPoint = { id: "pb", anchor: words(3, 4), importance: "secondary", type: "product", reason: "", source: "ai", edited: false }
const PC: EmphasisPoint = { id: "pc", anchor: words(4, 6), importance: "extra", type: "place", reason: "", source: "user", edited: false }
const PD: EmphasisPoint = { id: "pd", anchor: { kind: "scene", videoId: "p", startUs: 2_000_000, endUs: 3_000_000, beatId: "b2" }, importance: "key", type: "visual", reason: "", source: "ai", edited: false }
const OUTLINE: StoredOutline = {
  folder: "/drafts/cat",
  videoIds: ["v", "p"],
  brief: { targetSeconds: 30, videoType: "review", instructions: "" },
  outline: { title: "แมว", summary: "", omitted: "", beats: [beat("b1", "เปิด", "v", "speech", ""), beat("b2", "ภาพ", "p", "scenes", "แมวกับปลาทอด")], warnings: [] },
  confirmed: true,
  model: "claude-opus-5",
  promptVersion: "planner",
  updatedAt: 0,
  emphasis: { points: [PA, PB, PC, PD], version: 5, plannedOn: { graphics: 5, sounds: 4 }, transcripts: { v: transcriptFingerprint(TALK) } },
}

test("the scenes offered are the kept parts of picture beats' scenes, numbered in playing order; a scene cut in two plays both parts", () => {
  expect(emphasisScenes(OUTLINE, PLAN, CLIPS)).toEqual([
    { label: "s1", videoId: "p", beatId: "b2", beatName: "ภาพ", startUs: 1_000_000, endUs: 2_000_000, timelineUs: 5_000_000, durationUs: 1_000_000, description: "แมวกระโดดขึ้นโต๊ะ", kind: "b-roll", visual: "แมวกับปลาทอด" },
    { label: "s2", videoId: "p", beatId: "b2", beatName: "ภาพ", startUs: 2_000_000, endUs: 5_000_000, timelineUs: 6_000_000, durationUs: 2_000_000, description: "ปลาทอดในจาน", kind: "b-roll", visual: "แมวกับปลาทอด" },
  ])
})

test("the emphasis tab shows the placed points with what plays on each, the sentences and scenes to pick from, and whether works 2 and 4 are behind", () => {
  const items = { text: ["pa", undefined, "pa"], zoom: ["pd"], insert: [], graphic: ["pc"], sound: ["pa", "pd", undefined] }
  const view = emphasisView({ stored: OUTLINE, plan: PLAN, clips: CLIPS, level: "medium", items })
  expect(view.points).toEqual([
    { ...PA, beatId: "b1", atUs: 1_000_000, endUs: 3_000_000, text: "กินปลา", shown: true, items: { text: 2, zoom: 0, insert: 0, graphic: 0, sound: 1 } },
    // extra points get no effect at the middle level
    { ...PC, beatId: "b1", atUs: 3_000_000, endUs: 5_000_000, text: "ที่บ้าน", shown: false, items: { text: 0, zoom: 0, insert: 0, graphic: 1, sound: 0 } },
    { ...PD, beatId: "b2", atUs: 6_000_000, endUs: 7_000_000, text: "ปลาทอดในจาน", shown: true, items: { text: 0, zoom: 1, insert: 0, graphic: 0, sound: 1 } },
  ])
  expect(view.sentences).toEqual([
    { videoId: "v", beatId: "b1", from: 0, to: 3, atUs: 0, words: ["แมว", "กิน", "ปลา"] },
    { videoId: "v", beatId: "b1", from: 4, to: 6, atUs: 3_000_000, words: ["ที่", "บ้าน"] },
  ])
  expect(view.scenes).toEqual([
    { videoId: "p", beatId: "b2", startUs: 1_000_000, endUs: 2_000_000, atUs: 5_000_000, durationUs: 1_000_000, description: "แมวกระโดดขึ้นโต๊ะ", pointId: null },
    { videoId: "p", beatId: "b2", startUs: 2_000_000, endUs: 5_000_000, atUs: 6_000_000, durationUs: 2_000_000, description: "ปลาทอดในจาน", pointId: "pd" },
  ])
  // "ทอด" is cut, so its point waits unseen; sounds were planned on version 4 of the points, graphics on 5
  expect([view.hidden, view.version, view.changed]).toEqual([1, 5, { graphics: false, sounds: true }])
})

const NOTHING_PLAYS = { text: [], zoom: [], insert: [], graphic: [], sound: [] }

test("at the loudest level every point shows; a work that never ran and placed nothing is not behind, one whose first run failed but placed items is", () => {
  const stored = { ...OUTLINE, emphasis: { ...OUTLINE.emphasis!, plannedOn: { graphics: null, sounds: null } } }
  const view = emphasisView({ stored, plan: PLAN, clips: CLIPS, level: "heavy", items: NOTHING_PLAYS })
  expect(view.points.map((point) => [point.id, point.shown])).toEqual([
    ["pa", true],
    ["pc", true],
    ["pd", true],
  ])
  expect(view.changed).toEqual({ graphics: false, sounds: false })
  const changedOf = (outline: StoredOutline) => emphasisView({ stored: outline, plan: PLAN, clips: CLIPS, level: "medium", items: NOTHING_PLAYS }).changed
  // a first run of work 2 whose graphics call failed leaves plannedOn.graphics null, but the zoom its
  // techniques call stored sits on the points of that time: the graphics tab is behind, even after a restart
  const zoomOn = { anchor: { videoId: "v", sourceUs: 0, beatId: "b1" }, kind: "punch" as const, edited: false, pointId: "pa" }
  const failedFirst: StoredOutline = { ...stored, flair: { looks: {}, zooms: [zoomOn] } }
  expect(changedOf(failedFirst)).toEqual({ graphics: true, sounds: false })
  // a sound work 4 stored on a point does the same for the sounds tab
  const soundOn = { anchor: { kind: "cut" as const, videoId: "v", sourceUs: 3_000_000, beatId: "b1" }, effectId: "s", edited: false, pointId: "pd" }
  const bothFailed: StoredOutline = { ...failedFirst, flair: { ...failedFirst.flair!, cues: [soundOn] } }
  expect(changedOf(bothFailed)).toEqual({ graphics: true, sounds: true })
  // items bound to no point say nothing about the points
  const { pointId: _zoom, ...freeZoom } = zoomOn
  const { pointId: _sound, ...freeSound } = soundOn
  expect(changedOf({ ...stored, flair: { looks: {}, zooms: [freeZoom], cues: [freeSound] } })).toEqual({ graphics: false, sounds: false })
  // a work that planned on the version in force is not behind, whatever it placed; one on an older version is
  const current = (graphics: number, sounds: number): StoredOutline => ({ ...bothFailed, emphasis: { ...OUTLINE.emphasis!, plannedOn: { graphics, sounds } } })
  expect(changedOf(current(5, 5))).toEqual({ graphics: false, sounds: false })
  expect(changedOf(current(5, 4))).toEqual({ graphics: false, sounds: true })
  // an outline with no points yet
  expect(emphasisView({ stored: { ...OUTLINE, emphasis: undefined }, plan: PLAN, clips: CLIPS, level: "medium", items: NOTHING_PLAYS })).toMatchObject({ points: [], hidden: 0, version: 0, changed: { graphics: false, sounds: false } })
})

test("with no point on the rough cut no work is behind: thinking a work again could not catch it up, so the banner does not ask for it", () => {
  // the only point's words are cut, and the points changed since either work planned on them, which also left items on them
  const cueOn = { anchor: { kind: "cut" as const, videoId: "v", sourceUs: 3_000_000, beatId: "b1" }, effectId: "s", edited: false, pointId: "pb" }
  const cutAway: StoredOutline = { ...OUTLINE, emphasis: { ...OUTLINE.emphasis!, points: [PB], plannedOn: { graphics: 4, sounds: null } }, flair: { looks: {}, cues: [cueOn] } }
  expect(emphasisView({ stored: cutAway, plan: PLAN, clips: CLIPS, level: "heavy", items: NOTHING_PLAYS })).toMatchObject({ points: [], hidden: 1, changed: { graphics: false, sounds: false } })
  // once a point is on the cut again, both are
  const back: StoredOutline = { ...cutAway, emphasis: { ...cutAway.emphasis!, points: [PB, PA] } }
  expect(emphasisView({ stored: back, plan: PLAN, clips: CLIPS, level: "heavy", items: NOTHING_PLAYS }).changed).toEqual({ graphics: true, sounds: true })
})

const LOOK: GroupLook = { pattern: "stack", tone: "base", accent: null, exit: null, edited: false }
const CUT = { kind: "cut" as const, videoId: "v", sourceUs: 3_000_000, beatId: "b1" }
const graphicOn = (pointId?: string): GraphicCue => ({
  anchor: { kind: "speech", videoId: "v", sourceUs: 1_000_000, beatId: "b1" },
  spec: { kind: "motion", version: "m", box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.8 }, seconds: 3, why: "", idea: "ป้ายเด้งขึ้น", words: [], html: "<style></style>" },
  edited: true,
  off: false,
  ...(pointId ? { pointId } : {}),
})

test("only Claude's own items on the points put a work behind: what the user made or changed on a point does not", () => {
  const unplanned = { ...OUTLINE, emphasis: { ...OUTLINE.emphasis!, plannedOn: { graphics: null, sounds: null } } }
  const changedOf = (flair: StoredOutline["flair"], groups: NonNullable<StoredOutline["highlights"]>["groups"] = []) =>
    emphasisView({
      stored: { ...unplanned, flair, highlights: { groups, style: null, styleByAi: null, transcripts: {} } as unknown as StoredOutline["highlights"] },
      plan: PLAN,
      clips: CLIPS,
      level: "medium",
      items: NOTHING_PLAYS,
    }).changed
  const at = { kind: "speech" as const, videoId: "v", sourceUs: 1_000_000, beatId: "b1" }
  const line = { videoId: "v", from: 1, to: 3, text: "กินปลา" }
  const mine = {
    looks: {},
    zooms: [{ anchor: { videoId: "v", sourceUs: 0, beatId: "b1" }, kind: "punch" as const, edited: true, pointId: "pa" }],
    inserts: [{ anchor: at, binId: "m", edited: true, pointId: "pa" }],
    graphics: [graphicOn("pa")],
    cues: [{ anchor: at, effectId: "s", edited: true, pointId: "pa" }],
  }
  const groups = [
    { id: "g-user", source: "user" as const, edited: false, lines: [line], pointId: "pa" },
    { id: "g-changed", source: "ai" as const, edited: true, lines: [line], pointId: "pa" },
  ]
  expect(changedOf(mine, groups)).toEqual({ graphics: false, sounds: false })
  // each of Claude's own that is left does
  expect(changedOf({ looks: {}, inserts: [{ anchor: at, binId: "m", edited: false, pointId: "pa" }] })).toEqual({ graphics: true, sounds: false })
  expect(changedOf({ looks: {}, graphics: [{ ...graphicOn("pa"), edited: false }] })).toEqual({ graphics: true, sounds: false })
  expect(changedOf({ looks: {} }, [{ ...groups[1]!, edited: false }])).toEqual({ graphics: true, sounds: false })
  expect(changedOf({ looks: {}, cues: [{ anchor: at, effectId: "s", edited: false, pointId: "pa" }] })).toEqual({ graphics: false, sounds: true })
})

test("deleting a point takes Claude's items on it along, a group with its look and line sounds; the user's own and edited ones stay, bound to no point, an edited one on a line of a group that goes at the start of the group's beat", () => {
  const onG1 = { kind: "highlight" as const, groupId: "g1", line: 0 }
  const atB1 = { kind: "beat" as const, beatId: "b1", edge: "start" as const }
  const stored: StoredOutline = {
    ...OUTLINE,
    highlights: {
      style: null,
      styleByAi: null,
      beatsKey: null,
      transcripts: {},
      groups: [
        { id: "g1", source: "ai", edited: false, pointId: "pa", beatId: "b1", lines: [{ videoId: "v", from: 1, to: 3, text: "กินปลา" }] },
        { id: "g2", source: "ai", edited: true, pointId: "pa", beatId: "b1", lines: [{ videoId: "v", from: 4, to: 6, text: "ที่บ้าน" }] },
        { id: "g3", source: "user", edited: false, beatId: "b1", lines: [{ videoId: "v", from: 0, to: 1, text: "แมว" }] },
        // one the user made for the point ("Aa" on its row): theirs, though never edited
        { id: "g4", source: "user", edited: false, pointId: "pa", beatId: "b1", lines: [{ videoId: "v", from: 5, to: 6, text: "บ้าน" }] },
      ],
    },
    flair: {
      looks: { g1: LOOK, g2: LOOK },
      cues: [
        // a sound the user changed on a line of Claude's group: the group goes, the sound stays
        { anchor: onG1, effectId: "on-g1", edited: true, pointId: "pa" },
        // one of Claude's for another point on that line: its line goes, so it goes too, as before
        { anchor: onG1, effectId: "claude-on-g1", edited: false, pointId: "pd" },
        // one the user changed on the line of a group that stays is left where it is
        { anchor: { kind: "highlight", groupId: "g2", line: 0 }, effectId: "on-g2", edited: true },
        { anchor: CUT, effectId: "claude", edited: false, pointId: "pa" },
        { anchor: CUT, effectId: "mine", edited: true, pointId: "pa" },
        { anchor: CUT, effectId: "other", edited: false, pointId: "pd" },
      ],
      zooms: [
        { anchor: { videoId: "v", sourceUs: 0, beatId: "b1" }, kind: "punch", edited: false, pointId: "pa" },
        { anchor: { videoId: "v", sourceUs: 4_000_000, beatId: "b1" }, kind: "drift", edited: true, pointId: "pa" },
      ],
      inserts: [
        { anchor: CUT, binId: "m", edited: false, pointId: "pa" },
        { anchor: onG1, binId: "n", edited: true, pointId: "pa" },
      ],
      graphics: [graphicOn("pa"), { ...graphicOn("pa"), anchor: onG1 }],
    },
  }
  const left = withoutPoint(stored, "pa")
  expect(left.emphasis).toEqual({ ...OUTLINE.emphasis!, points: [PB, PC, PD] })
  expect(left.highlights!.groups).toEqual([
    { id: "g2", source: "ai", edited: true, beatId: "b1", lines: [{ videoId: "v", from: 4, to: 6, text: "ที่บ้าน" }] },
    { id: "g3", source: "user", edited: false, beatId: "b1", lines: [{ videoId: "v", from: 0, to: 1, text: "แมว" }] },
    { id: "g4", source: "user", edited: false, beatId: "b1", lines: [{ videoId: "v", from: 5, to: 6, text: "บ้าน" }] },
  ])
  expect(left.flair).toEqual({
    looks: { g2: LOOK },
    cues: [
      { anchor: atB1, effectId: "on-g1", edited: true },
      { anchor: { kind: "highlight", groupId: "g2", line: 0 }, effectId: "on-g2", edited: true },
      { anchor: CUT, effectId: "mine", edited: true },
      { anchor: CUT, effectId: "other", edited: false, pointId: "pd" },
    ],
    zooms: [{ anchor: { videoId: "v", sourceUs: 4_000_000, beatId: "b1" }, kind: "drift", edited: true }],
    inserts: [{ anchor: atB1, binId: "n", edited: true }],
    graphics: [graphicOn(), { ...graphicOn(), anchor: atB1 }],
  })
})

test("a Claude group on a deleted point whose look the user set by hand is theirs: it stays with its look, bound to no point", () => {
  const set = { ...LOOK, pattern: "bar" as const, edited: true }
  const line = { videoId: "v", from: 1, to: 3, text: "กินปลา" }
  const stored: StoredOutline = {
    ...OUTLINE,
    highlights: { style: null, styleByAi: null, beatsKey: null, transcripts: {}, groups: [{ id: "g1", source: "ai", edited: false, pointId: "pa", beatId: "b1", lines: [line] }] },
    flair: { looks: { g1: set } },
  }
  const left = withoutPoint(stored, "pa")
  expect(left.highlights!.groups).toEqual([{ id: "g1", source: "ai", edited: false, beatId: "b1", lines: [line] }])
  expect(left.flair!.looks).toEqual({ g1: set })
})

test("every edited item moved off the lines of a group that goes lands on its beat's start, in list order: nothing is left out for lack of room", () => {
  const lines = [0, 1].map((i) => ({ videoId: "v", from: i, to: i + 1, text: `w${i}` }))
  const onLine = (line: number) => ({ kind: "highlight" as const, groupId: "g1", line })
  const start = { kind: "beat" as const, beatId: "b1", edge: "start" as const }
  const left = withoutPoint(
    {
      ...OUTLINE,
      highlights: { style: null, styleByAi: null, beatsKey: null, transcripts: {}, groups: [{ id: "g1", source: "ai", edited: false, pointId: "pa", beatId: "b1", lines }] },
      flair: {
        looks: {},
        cues: [
          // one of Claude's, made for another point, on the beat's start already
          { anchor: start, effectId: "claude", edited: false, pointId: "pd" },
          { anchor: onLine(0), effectId: "first", edited: true, pointId: "pa" },
          { anchor: onLine(1), effectId: "second", edited: true, pointId: "pa" },
        ],
        inserts: [
          { anchor: onLine(0), binId: "m1", edited: true, pointId: "pa" },
          { anchor: onLine(1), binId: "m2", edited: true, pointId: "pa" },
        ],
      },
    },
    "pa",
  )
  expect(left.flair!.cues).toEqual([
    { anchor: start, effectId: "claude", edited: false, pointId: "pd" },
    { anchor: start, effectId: "first", edited: true },
    { anchor: start, effectId: "second", edited: true },
  ])
  expect(left.flair!.inserts).toEqual([
    { anchor: start, binId: "m1", edited: true },
    { anchor: start, binId: "m2", edited: true },
  ])
})

// ---- the service, on the fixture draft ----
// the fixture's transcript: ขึ้น(0) ไป(1) ใน(2) อวกาศ(3) ใน(4) สาม(5) สอง(6) หนึ่ง(7) | สาม(8) สอง(9) หนึ่ง(10)
// the first countdown (5–7) is cut as a retake, so the sentences are [1] words 0–4 and [2] words 8–10

const FINGERPRINT = transcriptFingerprint(transcript)
const speech = (from: number, to: number): EmphasisAnchor => ({ kind: "speech", videoId: CLIP_ID, from, to, beatId: "beat-1" })
const point = (id: string, from: number, to: number, extra: Partial<EmphasisPoint> = {}): EmphasisPoint => ({
  id,
  anchor: speech(from, to),
  importance: "key",
  type: "place",
  reason: "",
  source: "ai",
  edited: false,
  ...extra,
})
const answer = (at: number, quote: string, extra: Partial<EmphasisReply["points"][number]> = {}): EmphasisReply["points"][number] => ({ at, scene: "", quote, importance: "key", type: "place", reason: "", ...extra })
const REPLY: EmphasisReply = {
  points: [answer(1, "อวกาศ", { reason: "จุดหมายของเรื่อง" }), answer(2, "สามสอง", { importance: "secondary", type: "number", reason: "นับถอยหลัง" })],
}
const cue = (effectId: string, pointId: string, edited: boolean) => ({ anchor: { kind: "cut" as const, videoId: CLIP_ID, sourceUs: 22_470_000, beatId: "beat-1" }, effectId, edited, pointId })
const textOf = (content: LlmContent[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n")

// a picture beat over the end of the clip, after the countdown, for scene points
const PICTURES: Beat = { ...countdown, id: "beat-sky", name: "ฟ้า", kind: "scenes", fromIndex: 0, toIndex: 0, startUs: s(26), endUs: s(31), visual: "ท้องฟ้า" }
const sky = (startUs: number, endUs: number, beatId = PICTURES.id): EmphasisAnchor => ({ kind: "scene", videoId: CLIP_ID, startUs, endUs, beatId })
// a speech beat of the opening line only, 17.5–19 s: the middle of "ขึ้น"(0), 17.30 s, is before it, and that of "ใน"(4), 19.39 s, after it
const OPENING: Beat = { ...countdown, id: "beat-open", name: "เปิด", toIndex: 0, startUs: s(17.5), endUs: s(19) }

async function withEmphasis(reply: EmphasisReply = REPLY, options: { claude?: boolean; beats?: Beat[]; scenes?: Scene[] } = {}) {
  const base = await setup({ ...(options.beats ? { beats: options.beats } : {}), ...(options.scenes ? { scenes: options.scenes } : {}) })
  const requests: LlmRequest<unknown>[] = []
  /** `during` runs while Claude thinks, before it answers: what the user does meanwhile, or a call that fails */
  const claude: { reply: EmphasisReply; during?: () => Promise<unknown> } = { reply }
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      await claude.during?.()
      return { output: claude.reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  let n = 0
  const emphasis = createEmphasisService({
    outlines: base.outlines,
    timeline: base.service,
    llm: options.claude === false ? undefined : async () => ({ transport, model: "claude-sonnet-5" }),
    newId: () => `id${++n}`,
  })
  return { ...base, emphasis, claude, requests }
}

/** Stores points on the fixture outline, on its transcript unless said otherwise. */
async function seed(outlines: OutlineStore, folder: string, points: EmphasisPoint[], extra: Partial<StoredEmphasis> = {}) {
  await outlines.update(folder, (stored) => ({ ...stored!, emphasis: { points, version: 1, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: FINGERPRINT }, ...extra } }))
}

test("Claude plans the points from the beats and sentences of the rough cut; they are stored with the transcripts they were made on", async () => {
  const { emphasis, folder, outlines, requests } = await withEmphasis()
  expect(await emphasis.plan(folder, DEFAULT_CUT_RULES)).toEqual({ count: 2, dropped: 0 })
  const request = textOf(requests[0]!.content)
  // the beat's purpose, which no other work reads, and the sentence
  expect(request).toContain("ลุ้น")
  expect(request).toContain("ขึ้นไปในอวกาศใน")
  expect((await outlines.get(folder))!.emphasis).toEqual({
    points: [point("id1", 3, 4, { reason: "จุดหมายของเรื่อง" }), point("id2", 8, 10, { importance: "secondary", type: "number", reason: "นับถอยหลัง" })],
    version: 1,
    plannedOn: { graphics: null, sounds: null },
    transcripts: { [CLIP_ID]: FINGERPRINT },
  })
})

test("planning again keeps the user's points and the ones they changed; Claude's others go, with what Claude put on them", async () => {
  const { emphasis, folder, outlines, claude } = await withEmphasis()
  await emphasis.plan(folder, DEFAULT_CUT_RULES)
  await emphasis.setPoint(folder, "id1", { importance: "extra" })
  const added = await emphasis.addPoint(folder, speech(0, 2))
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, cues: [cue("a", "id2", false), cue("b", "id2", true), cue("c", "id1", false)] } }))
  // "อวกาศ" is the changed point's already, so it is dropped
  claude.reply = { points: [answer(1, "อวกาศ"), answer(2, "สามสอง")] }
  expect(await emphasis.plan(folder, DEFAULT_CUT_RULES)).toEqual({ count: 1, dropped: 1 })

  const stored = (await outlines.get(folder))!
  const span = (entry: EmphasisPoint) => (entry.anchor.kind === "speech" ? [entry.anchor.from, entry.anchor.to] : [])
  expect(stored.emphasis!.points.map((entry) => [entry.id === "id1" || entry.id === added, ...span(entry), entry.source, entry.edited])).toEqual([
    [true, 3, 4, "ai", true],
    [true, 0, 2, "user", false],
    [false, 8, 10, "ai", false],
  ])
  expect(stored.emphasis!.points.map((entry) => entry.id)).not.toContain("id2")
  // plan, a new importance, a point added, plan again
  expect(stored.emphasis!.version).toBe(4)
  const { pointId: _gone, ...unbound } = cue("b", "id2", true)
  expect(stored.flair!.cues).toEqual([unbound, cue("c", "id1", false)])
})

test("what the user does while Claude thinks stays: the answer is merged into the outline as it is by then", async () => {
  // Claude answers on "ขึ้นไป", on "อวกาศ" and on the last "หนึ่ง"
  const { emphasis, folder, outlines, claude } = await withEmphasis({ points: [answer(1, "ขึ้นไป"), answer(1, "อวกาศ"), answer(2, "หนึ่ง")] })
  await seed(outlines, folder, [point("pa", 3, 4), point("pb", 8, 10)])
  const mine = point("mine", 0, 2, { source: "user" })
  // meanwhile the user adds a point on "ขึ้นไป", gives Claude's pa a new importance and deletes pb, as the tab does:
  // the point added and the new importance each raise the version
  claude.during = () =>
    outlines.update(folder, (stored) => {
      const was = stored!.emphasis!
      return { ...stored!, emphasis: { ...was, points: [{ ...was.points[0]!, importance: "secondary", edited: true }, mine], version: was.version + 2 } }
    })
  // Claude's answers on the user's new point and on the point they changed are dropped
  expect(await emphasis.plan(folder, DEFAULT_CUT_RULES)).toEqual({ count: 1, dropped: 2 })
  const stored = (await outlines.get(folder))!.emphasis!
  expect(stored.points).toEqual([point("pa", 3, 4, { importance: "secondary", edited: true }), mine, point("id3", 10, 11)])
  // one above the version the user left, not the one Claude was asked on
  expect(stored.version).toBe(4)
})

test("a Claude call that fails leaves the points, what sits on them and their version as they were", async () => {
  const { emphasis, folder, outlines, claude } = await withEmphasis()
  await seed(outlines, folder, [point("pa", 3, 4), point("pb", 8, 10)])
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, cues: [cue("a", "pa", false)] } }))
  const before = (await outlines.get(folder))!
  claude.during = async () => {
    throw new Error("Claude is busy")
  }
  await expect(emphasis.plan(folder, DEFAULT_CUT_RULES)).rejects.toThrow("Claude is busy")
  const after = (await outlines.get(folder))!
  expect([after.emphasis, after.flair]).toEqual([before.emphasis, before.flair])
})

test("with no sentence and no scene on the cut Claude is not asked, and its old points stay, with what sits on them and their version", async () => {
  const { emphasis, folder, outlines, requests, service } = await withEmphasis()
  await seed(outlines, folder, [point("pa", 3, 4), point("pb", 8, 10)])
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, cues: [cue("a", "pa", false)] } }))
  // every word cut: the rough cut says nothing, and the one beat is no picture beat
  await service.decide(folder, CLIP_ID, { type: "words", indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], keep: false })
  const before = (await outlines.get(folder))!
  expect(await emphasis.plan(folder, DEFAULT_CUT_RULES)).toEqual({ count: 0, dropped: 0 })
  expect(requests).toEqual([])
  const after = (await outlines.get(folder))!
  expect([after.emphasis, after.flair]).toEqual([before.emphasis, before.flair])
})

test("a rough cut of picture beats alone offers Claude its scenes, and the points it answers replace its old ones", async () => {
  const sceneAnswer = { at: 0, scene: "s1", quote: "", importance: "key" as const, type: "visual" as const, reason: "" }
  const { emphasis, folder, outlines, requests } = await withEmphasis({ points: [sceneAnswer] }, { beats: [PICTURES], scenes: [scene(26, 31, "ท้องฟ้าสีคราม")] })
  await seed(outlines, folder, [point("old", 3, 4)])
  expect(await emphasis.plan(folder, DEFAULT_CUT_RULES)).toEqual({ count: 1, dropped: 0 })
  expect(textOf(requests[0]!.content)).toContain("ท้องฟ้าสีคราม")
  expect((await outlines.get(folder))!.emphasis!.points.map((entry) => [entry.id, entry.anchor.kind])).toEqual([["id1", "scene"]])
})

test("a point Claude made on a beat taken out while it thought is dropped and counted", async () => {
  // the same footage played twice: its sentences are [1] and [2] in beat-1, [3] and [4] in the beat played again
  const again: Beat = { ...countdown, id: "beat-again", name: "ซ้ำ" }
  const { emphasis, folder, outlines, claude } = await withEmphasis({ points: [answer(1, "อวกาศ"), answer(3, "อวกาศ")] }, { beats: [countdown, again] })
  claude.during = () => outlines.update(folder, (stored) => ({ ...stored!, outline: { ...stored!.outline, beats: [countdown] } }))
  expect(await emphasis.plan(folder, DEFAULT_CUT_RULES)).toEqual({ count: 1, dropped: 1 })
  expect((await outlines.get(folder))!.emphasis!.points.map((entry) => [entry.anchor.beatId, entry.anchor.kind === "speech" && entry.anchor.from])).toEqual([["beat-1", 3]])
})

test("points made on an earlier transcript of a video can never show again: planning drops them, the user's too", async () => {
  const { emphasis, folder, outlines } = await withEmphasis({ points: [] })
  await seed(outlines, folder, [point("old", 0, 2, { source: "user" })], { transcripts: { [CLIP_ID]: "earlier" } })
  expect(await emphasis.plan(folder, DEFAULT_CUT_RULES)).toEqual({ count: 0, dropped: 0 })
  expect((await outlines.get(folder))!.emphasis).toEqual({ points: [], version: 2, plannedOn: { graphics: null, sounds: null }, transcripts: { [CLIP_ID]: FINGERPRINT } })
})

test("without a Claude connection no point is planned", async () => {
  const { emphasis, folder } = await withEmphasis(REPLY, { claude: false })
  await expect(emphasis.plan(folder, DEFAULT_CUT_RULES)).rejects.toThrow(/no Claude connection/)
})

test("a point changed by hand becomes the user's to keep; only a new importance or phrase bumps the version", async () => {
  const { emphasis, folder, outlines } = await withEmphasis()
  await seed(outlines, folder, [point("p1", 3, 4), point("p2", 8, 10)])
  const read = async () => (await outlines.get(folder))!.emphasis!
  // a patch that changes nothing leaves one of Claude's points Claude's: the reason is compared as it would be kept,
  // trimmed, and the phrase field by field, whatever order the fields come in
  await emphasis.setPoint(folder, "p2", {})
  await emphasis.setPoint(folder, "p2", { importance: "key", type: "place", reason: "  ", anchor: { beatId: "beat-1", to: 10, from: 8, videoId: CLIP_ID, kind: "speech" } })
  expect(await read()).toMatchObject({ points: [point("p1", 3, 4), point("p2", 8, 10)], version: 1 })
  // a new type alone is a real change: the point becomes the user's, and the version stays
  await emphasis.setPoint(folder, "p2", { type: "number" })
  expect((await read()).points[1]).toEqual(point("p2", 8, 10, { type: "number", edited: true }))
  expect((await read()).version).toBe(1)
  await emphasis.setPoint(folder, "p1", { reason: "  ปลายทาง  ", type: "action" })
  expect((await read()).points[0]).toEqual(point("p1", 3, 4, { reason: "ปลายทาง", type: "action", edited: true }))
  expect((await read()).version).toBe(1)
  // the importance it has already
  await emphasis.setPoint(folder, "p1", { importance: "key" })
  expect((await read()).version).toBe(1)
  await emphasis.setPoint(folder, "p1", { importance: "secondary" })
  expect((await read()).version).toBe(2)
  // a new phrase may take in the point's own old words
  await emphasis.setPoint(folder, "p1", { anchor: speech(2, 4) })
  expect((await read()).points[0]!.anchor).toEqual(speech(2, 4))
  expect((await read()).version).toBe(3)
  await expect(emphasis.setPoint(folder, "p1", { anchor: speech(9, 11) })).rejects.toThrow(/overlaps another point/)
  await expect(emphasis.setPoint(folder, "p1", { anchor: speech(10, 12) })).rejects.toThrow(/outside its video/)
  await expect(emphasis.setPoint(folder, "nope", { reason: "x" })).rejects.toThrow(/unknown emphasis point/)
  expect((await read()).version).toBe(3)
})

test("deleting a point takes what Claude put on it along and leaves the version, so no banner asks to plan again", async () => {
  const { emphasis, folder, outlines } = await withEmphasis()
  await seed(outlines, folder, [point("p1", 3, 4), point("p2", 8, 10)])
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, cues: [cue("a", "p1", false), cue("b", "p1", true)] } }))
  await emphasis.setPoint(folder, "p1", null)
  const stored = (await outlines.get(folder))!
  expect(stored.emphasis!.points.map((entry) => entry.id)).toEqual(["p2"])
  expect(stored.emphasis!.version).toBe(1)
  const { pointId: _gone, ...unbound } = cue("b", "p1", true)
  expect(stored.flair!.cues).toEqual([unbound])
  await expect(emphasis.setPoint(folder, "p1", null)).rejects.toThrow(/unknown emphasis point/)
})

test("the user adds a point on words or a scene; it is key, so it counts at every level, and it bumps the version", async () => {
  const { emphasis, folder, outlines } = await withEmphasis(REPLY, { beats: [countdown, PICTURES] })
  await seed(outlines, folder, [point("p1", 3, 4)])
  const said = await emphasis.addPoint(folder, speech(8, 11))
  const seen = await emphasis.addPoint(folder, sky(s(26), s(27)))
  const stored = (await outlines.get(folder))!.emphasis!
  expect(stored.points).toEqual([
    point("p1", 3, 4),
    { id: said, anchor: speech(8, 11), importance: "key", type: "product", reason: "", source: "user", edited: false },
    { id: seen, anchor: sky(s(26), s(27)), importance: "key", type: "visual", reason: "", source: "user", edited: false },
  ])
  expect(stored.version).toBe(3)
})

test("a point is refused off the outline's videos and beats, outside its file, or on another point's words", async () => {
  const { emphasis, folder, outlines } = await withEmphasis()
  await seed(outlines, folder, [point("p1", 3, 4)])
  await expect(emphasis.addPoint(folder, { ...speech(0, 1), videoId: "other" })).rejects.toThrow(/not in this outline/)
  await expect(emphasis.addPoint(folder, { ...speech(0, 1), beatId: "nope" })).rejects.toThrow(/unknown beat/)
  // the transcript has 11 words
  await expect(emphasis.addPoint(folder, speech(10, 12))).rejects.toThrow(/outside its video/)
  await expect(emphasis.addPoint(folder, speech(2, 4))).rejects.toThrow(/overlaps another point/)
  expect((await outlines.get(folder))!.emphasis!.points.map((entry) => entry.id)).toEqual(["p1"])
})

test("a point must sit in its beat: words on a speech beat whose middles fall in it, a stretch on a picture beat that touches its span", async () => {
  const { emphasis, folder, outlines } = await withEmphasis(REPLY, { beats: [OPENING, PICTURES] })
  const open = (from: number, to: number): EmphasisAnchor => ({ kind: "speech", videoId: CLIP_ID, from, to, beatId: OPENING.id })
  // words on a picture beat, a stretch on a speech beat
  await expect(emphasis.addPoint(folder, { ...open(1, 3), beatId: PICTURES.id })).rejects.toThrow(/wrong kind of beat/)
  await expect(emphasis.addPoint(folder, sky(s(27), s(28), OPENING.id))).rejects.toThrow(/wrong kind of beat/)
  // the first word said before the beat starts, the last one after it ends
  await expect(emphasis.addPoint(folder, open(0, 2))).rejects.toThrow(/outside its beat/)
  await expect(emphasis.addPoint(folder, open(3, 5))).rejects.toThrow(/outside its beat/)
  // a stretch that ends where the beat's 26–31 s starts; one past the 31.106 s clip is outside the file first
  await expect(emphasis.addPoint(folder, sky(s(20), s(26)))).rejects.toThrow(/outside its beat/)
  await expect(emphasis.addPoint(folder, sky(31_000_000, 31_106_001))).rejects.toThrow(/outside its video/)
  expect((await outlines.get(folder))!.emphasis?.points ?? []).toEqual([])
  // words whose middles are in the beat are taken though "ไป"(1) starts before it, and a stretch that only crosses the beat's start is taken
  const said = await emphasis.addPoint(folder, open(1, 4))
  const seen = await emphasis.addPoint(folder, sky(s(25), s(27)))
  expect((await outlines.get(folder))!.emphasis!.points.map((entry) => [entry.id, entry.anchor])).toEqual([
    [said, open(1, 4)],
    [seen, sky(s(25), s(27))],
  ])
})

test("a point added on a video whose transcript changed drops the points of the old transcript, with what Claude put on them", async () => {
  const { emphasis, folder, outlines } = await withEmphasis()
  await seed(outlines, folder, [point("old", 0, 2)], { transcripts: { [CLIP_ID]: "earlier" } })
  await outlines.update(folder, (stored) => ({ ...stored!, flair: { looks: {}, cues: [cue("a", "old", false)] } }))
  // the same word numbers as the old point: they mean other words now, and the old point is gone first
  const id = await emphasis.addPoint(folder, speech(0, 2))
  const stored = (await outlines.get(folder))!
  expect(stored.emphasis!.points.map((entry) => entry.id)).toEqual([id])
  expect(stored.emphasis!.transcripts).toEqual({ [CLIP_ID]: FINGERPRINT })
  expect(stored.flair!.cues).toEqual([])
})

test("a sound and a cutaway the user changed on a line of Claude's group stay when the group's point goes, deleted or planned over: unbound, at the start of the group's beat", async () => {
  const { emphasis, folder, outlines } = await withEmphasis()
  const line = { kind: "highlight" as const, groupId: "g", line: 0 }
  const start = { kind: "beat" as const, beatId: "beat-1", edge: "start" as const }
  // Claude's unedited group on Claude's point p1, as work 2a leaves it, and on its line what works 2 and 4 put there
  const onTheLine = async () => {
    await seed(outlines, folder, [point("p1", 3, 4)])
    await outlines.update(folder, (stored) => ({
      ...stored!,
      highlights: {
        style: null,
        styleByAi: null,
        beatsKey: null,
        transcripts: {},
        groups: [{ id: "g", source: "ai", edited: false, pointId: "p1", beatId: "beat-1", lines: [{ videoId: CLIP_ID, from: 3, to: 4, text: "อวกาศ" }] }],
      },
      flair: {
        looks: {},
        cues: [
          { anchor: line, effectId: "changed", edited: true, pointId: "p1" },
          { anchor: line, effectId: "claude", edited: false, pointId: "p1" },
        ],
        inserts: [{ anchor: line, binId: "m", edited: true, pointId: "p1" }],
      },
    }))
  }
  const left = async () => {
    const stored = (await outlines.get(folder))!
    return { groups: stored.highlights!.groups, cues: stored.flair!.cues, inserts: stored.flair!.inserts }
  }
  const survivors = { groups: [], cues: [{ anchor: start, effectId: "changed", edited: true }], inserts: [{ anchor: start, binId: "m", edited: true }] }

  await onTheLine()
  await emphasis.setPoint(folder, "p1", null)
  expect(await left()).toEqual(survivors)

  // planning again takes Claude's old point away the same way
  await onTheLine()
  await emphasis.plan(folder, DEFAULT_CUT_RULES)
  expect((await outlines.get(folder))!.emphasis!.points.map((entry) => entry.id)).not.toContain("p1")
  expect(await left()).toEqual(survivors)
})

test("the points on the cut are counted under the rules given, a point whose words are all cut left out", async () => {
  const { emphasis, folder, outlines } = await withEmphasis()
  await seed(outlines, folder, [point("pa", 3, 4), point("pb", 5, 6), point("pc", 8, 9)])
  // words 5–7 are the retake the default rules cut: pb plays nowhere
  expect(await emphasis.placedCount(folder, DEFAULT_CUT_RULES)).toBe(2)
  expect(await emphasis.placedCount(folder, { ...DEFAULT_CUT_RULES, cutRetakes: false })).toBe(3)
})

test("a plan run's stop goes with the points' call", async () => {
  const { emphasis, folder, requests } = await withEmphasis()
  const stop = new AbortController()
  await emphasis.plan(folder, DEFAULT_CUT_RULES, stop.signal)
  expect(requests[0]!.signal).toBe(stop.signal)
})
