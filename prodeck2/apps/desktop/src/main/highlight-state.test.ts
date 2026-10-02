import { expect, test } from "vitest"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { HighlightGroup, PlacedGroup, TimedGroup } from "@boxblack/core/highlights"
import type { StoredOutline } from "../shared/api.ts"
import { DEFAULT_LOOK, type CueAnchor, type GroupLook } from "@boxblack/core/flair/plan"
import { findWord } from "@boxblack/core/flair/direct"
import { transcriptFingerprint } from "./footage.ts"
import {
  answerOnBeats,
  beatsKey,
  currentGroups,
  currentPoints,
  heldExits,
  hiddenWords,
  looksInForce,
  placedPoints,
  placementOf,
  placeStored,
  pointText,
  regroupFlair,
  SHOW_ALL,
  showRulesOf,
  styleInForce,
  withLineText,
  withoutLine,
  withoutOverlaps,
  type ShowRules,
} from "./highlight-state.ts"
import { countdown, s, transcript } from "./timeline-fixture.ts"
import type { EmphasisPoint, StoredEmphasis } from "@boxblack/core/emphasis/types"
import type { PlacedPoint } from "@boxblack/core/emphasis"

const group = (id: string, lines: [videoId: string, from: number, to: number][]): HighlightGroup => ({
  id,
  source: "ai",
  edited: false,
  lines: lines.map(([videoId, from, to]) => ({ videoId, from, to, text: id })),
})

test("the style in force is the user's, else Claude's, else the default", () => {
  const base = { groups: [], beatsKey: null, transcripts: {} }
  expect(styleInForce(undefined)).toBe("bold-white")
  expect(styleInForce({ ...base, style: null, styleByAi: null })).toBe("bold-white")
  expect(styleInForce({ ...base, style: null, styleByAi: "headline" })).toBe("headline")
  expect(styleInForce({ ...base, style: "cute-pink", styleByAi: "headline" })).toBe("cute-pink")
})

test("beats are told apart by id, video and range", () => {
  const key = beatsKey([countdown])
  expect(beatsKey([{ ...countdown }])).toBe(key)
  expect(beatsKey([{ ...countdown, name: "renamed" }])).toBe(key)
  for (const changed of [{ id: "other" }, { videoId: "other" }, { startUs: 1 }, { endUs: 1 }]) expect(beatsKey([{ ...countdown, ...changed }])).not.toBe(key)
  expect(beatsKey([countdown, countdown])).not.toBe(key)
})

test("groups overlapping kept ones are left out, counting their lines; touching is not overlapping", () => {
  const kept = [group("k", [["v1", 4, 8]])]
  const result = withoutOverlaps(
    [group("before", [["v1", 0, 4]]), group("inside", [["v1", 2, 3], ["v1", 7, 9]]), group("after", [["v1", 8, 10]]), group("other clip", [["v2", 4, 8]])],
    kept,
  )
  expect(result.groups.map((g) => g.id)).toEqual(["before", "after", "other clip"])
  expect(result.droppedLines).toBe(2)
})

test("only groups on the transcript a video has now count", () => {
  const clips = [{ id: "v1", transcript }, { id: "v2", transcript: null }] as CutClip[]
  const stored = {
    highlights: {
      style: null,
      styleByAi: null,
      beatsKey: null,
      transcripts: { v1: transcriptFingerprint(transcript), v2: "old" },
      groups: [group("now", [["v1", 0, 1]]), group("old", [["v2", 0, 1]]), group("mixed", [["v1", 2, 3], ["v2", 0, 1]]), group("gone", [["v3", 0, 1]])],
    },
  } as unknown as StoredOutline
  expect(currentGroups(stored, clips).map((g) => g.id)).toEqual(["now"])
  expect(currentGroups({} as StoredOutline, clips)).toEqual([])
})

test("hidden words run from each group's first shown word to its last, in the pieces the group plays across", () => {
  // lines: [piece, first word, word after the last]
  const placed = (groupId: string, lines: [number, number, number][]) =>
    ({ groupId, videoId: "v", lines: lines.map(([cut, from, to], lineIndex) => ({ lineIndex, cut, words: { from, to } })) }) as unknown as PlacedGroup
  const shown = (groupId: string, lineIndexes: number[]) =>
    ({ groupId, endUs: 2_000_000, lines: lineIndexes.map((lineIndex) => ({ lineIndex, startUs: 0 })) }) as unknown as TimedGroup
  const groups = [placed("a", [[0, 0, 2], [1, 2, 3]]), placed("b", [[2, 8, 10]]), placed("c", [[3, 5, 6]])]
  const hidden = hiddenWords(groups, [shown("a", [0, 1]), shown("b", [0]), shown("c", [0])])
  expect([...hidden.keys()].sort()).toEqual([0, 1, 2, 3])
  expect([...hidden.get(0)!].sort((x, y) => x - y)).toEqual([0, 1, 2])
  expect([...hidden.get(1)!].sort((x, y) => x - y)).toEqual([0, 1, 2])
  expect([...hidden.get(2)!].sort((x, y) => x - y)).toEqual([8, 9])
  expect([...hidden.get(3)!]).toEqual([5])
})

test("words of a line cut off by the next group, or on screen for less than a frame, stay in the subtitles", () => {
  // group A's lines are words 0-1 and 6-7; a group on words 3-4 starts before A's second line, which goes
  const a = { groupId: "A", videoId: "v", lines: [{ lineIndex: 0, cut: 0, words: { from: 0, to: 2 } }, { lineIndex: 1, cut: 0, words: { from: 6, to: 8 } }] } as unknown as PlacedGroup
  const b = { groupId: "B", videoId: "v", lines: [{ lineIndex: 0, cut: 0, words: { from: 3, to: 5 } }, { lineIndex: 1, cut: 0, words: { from: 5, to: 6 } }] } as unknown as PlacedGroup
  const gone = { groupId: "C", videoId: "v", lines: [{ lineIndex: 0, cut: 0, words: { from: 9, to: 10 } }] } as unknown as PlacedGroup
  // B's second line comes 10 ms before B ends
  const timed = [
    { groupId: "A", endUs: 1_000_000, lines: [{ lineIndex: 0, startUs: 0 }] },
    { groupId: "B", endUs: 2_000_000, lines: [{ lineIndex: 0, startUs: 1_000_000 }, { lineIndex: 1, startUs: 1_990_000 }] },
  ] as unknown as TimedGroup[]
  expect([...hiddenWords([a, b, gone], timed, 33_333).get(0)!].sort((x, y) => x - y)).toEqual([0, 1, 3, 4])
})

const clipWith = (id: string, scenes: [number, number, [number, number] | null][]): CutClip =>
  ({
    id,
    insight: {
      scenes: scenes.map(([startUs, endUs, band]) => ({
        startUs,
        endUs,
        description: "",
        kind: "talking-head",
        issues: [],
        keepClear: band && { fromY: band[0], toY: band[1] },
      })),
    },
  }) as unknown as CutClip

const placed = (videoId: string, fromUs: number, toUs: number): PlacedGroup =>
  ({ groupId: "g", beatId: "b", videoId, lines: [{ lineIndex: 0, text: "x", cut: 0, sourceUs: fromUs, partial: false, words: { from: 0, to: 1 } }], end: { cut: 0, sourceUs: toUs } }) as PlacedGroup

test("the band to dodge comes from the scenes of the group's own clip that it plays over", () => {
  const clips = [
    clipWith("v1", [[0, 5_000_000, [0.1, 0.3]]]),
    clipWith("v2", [[0, 5_000_000, [0.6, 0.9]], [6_000_000, 9_000_000, [0.2, 0.4]], [20_000_000, 30_000_000, [0, 1]]]),
  ]
  // 0–7 s of v2 covers its first two scenes, not the one at 20 s
  expect(placementOf(placed("v2", 0, 7_000_000), clips, "auto", false)).toEqual({
    kind: "auto",
    keepClear: { fromY: 0.2, toY: 0.9 },
    keepSubtitleRoom: false,
  })
  // a group of the other clip gets that clip's band
  expect(placementOf(placed("v1", 0, 1_000_000), clips, "auto", true)).toEqual({ kind: "auto", keepClear: { fromY: 0.1, toY: 0.3 }, keepSubtitleRoom: true })
  // a clip nobody analysed, and a scene with nothing to keep clear, leave no band
  expect(placementOf(placed("v3", 0, 1), clips, "auto", false)).toEqual({ kind: "auto", keepClear: null, keepSubtitleRoom: false })
  expect(placementOf(placed("v1", 0, 1), [clipWith("v1", [[0, 5_000_000, null]])], "auto", false)).toEqual({ kind: "auto", keepClear: null, keepSubtitleRoom: false })
})

test("a scene the group never reaches is not dodged", () => {
  const clips = [clipWith("v1", [[0, 5_000_000, [0.6, 0.9]], [5_000_001, 9_000_000, [0, 0.2]]])]
  expect(placementOf(placed("v1", 0, 5_000_000), clips, "auto", false)).toEqual({ kind: "auto", keepClear: { fromY: 0.6, toY: 0.9 }, keepSubtitleRoom: false })
})

test("a face band, where one is known, stands in for the scenes' bands; where none is, they are dodged as before", () => {
  const clips = [clipWith("v1", [[0, 5_000_000, [0.6, 0.9]]])]
  const group = placed("v1", 0, 1_000_000)
  const asked: PlacedGroup[] = []
  const zoomed = (one: PlacedGroup) => (asked.push(one), { fromY: 0.5, toY: 0.95 })
  expect(placementOf(group, clips, "auto", false, zoomed)).toEqual({ kind: "auto", keepClear: { fromY: 0.5, toY: 0.95 }, keepSubtitleRoom: false })
  expect(asked).toEqual([group])
  expect(placementOf(group, clips, "auto", false, () => null)).toEqual({ kind: "auto", keepClear: { fromY: 0.6, toY: 0.9 }, keepSubtitleRoom: false })
  // a pinned position asks nothing
  expect(placementOf(group, clips, "top", false, zoomed)).toEqual({ kind: "fixed", position: "top" })
  expect(asked).toHaveLength(1)
})

test("a pinned position needs no picture at all", () => {
  expect(placementOf(placed("v1", 0, 1), [], "bottom", true)).toEqual({ kind: "fixed", position: "bottom" })
})

const look = (line: number): GroupLook => ({ pattern: "stack", tone: "base", accent: { line, from: 0, to: 3 }, exit: null, edited: true })
const on = (groupId: string, line: number): CueAnchor => ({ kind: "highlight", groupId, line })

test("a coloured word shows on the line it was put on, wherever that line shows, and not at all while it is cut", () => {
  const stored = { flair: { looks: { g: look(1), h: look(0) } } } as unknown as StoredOutline
  const flair = { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: false } as const
  // the first line of each group is cut: "สองสอง" is line 1 of g shown first, and h's coloured line is not shown
  const lines = [{ lineIndex: 1, text: "สองสอง" }]
  const looks = looksInForce(stored, [{ id: "g", lines }, { id: "h", lines }], flair, null)
  expect(looks.g!.accent).toEqual({ line: 0, from: 0, to: 3 })
  expect(looks.h!.accent).toBeNull()
})

test("taking a line out of a group moves what is on the lines below it up, drops what was on it, and leaves the rest alone", () => {
  const cue = (anchor: CueAnchor) => ({ anchor, effectId: "s", edited: true })
  const insert = (anchor: CueAnchor) => ({ anchor, binId: "m", edited: true })
  const beat: CueAnchor = { kind: "beat", beatId: "b", edge: "start" }
  const stored = {
    flair: {
      looks: { g: look(2), other: look(2) },
      cues: [cue(on("g", 0)), cue(on("g", 1)), cue(on("g", 2)), cue(on("other", 1)), cue(on("other", 2)), cue(beat)],
      inserts: [insert(on("g", 1)), insert(on("g", 2))],
    },
  } as unknown as StoredOutline
  const after = withoutLine(stored, "g", 1).flair!
  expect(after.cues!.map((entry) => entry.anchor)).toEqual([on("g", 0), on("g", 1), on("other", 1), on("other", 2), beat])
  expect(after.inserts!.map((entry) => entry.anchor)).toEqual([on("g", 1)])
  expect(after.looks.g!.accent).toEqual({ line: 1, from: 0, to: 3 })
  expect(after.looks.other).toEqual(look(2))

  // an accent above the line stays where it is; one on the line goes
  const above = { flair: { looks: { g: look(0) } } } as unknown as StoredOutline
  expect(withoutLine(above, "g", 1).flair!.looks.g!.accent).toEqual({ line: 0, from: 0, to: 3 })
  const onIt = { flair: { looks: { g: look(1) } } } as unknown as StoredOutline
  expect(withoutLine(onIt, "g", 1).flair!.looks.g!.accent).toBeNull()
  // a project with no flair has nothing to move
  const bare = {} as StoredOutline
  expect(withoutLine(bare, "g", 1)).toBe(bare)
})

test("sounds and cutaways on replaced text follow the words: to the line showing most of them, on the same transcript only", () => {
  const cue = (anchor: CueAnchor, effectId = "s", edited = false) => ({ anchor, effectId, edited })
  const beat: CueAnchor = { kind: "beat", beatId: "b", edge: "start" }
  const before = [group("old", [["v", 0, 4], ["v", 4, 8], ["w", 0, 2]]), group("kept", [["v", 10, 12]])]
  // the new groups: "n1" shows words 3–4 then 5–9, "n2" words 0–3 of v and 0–2 of the other video
  const now = [group("n1", [["v", 3, 5], ["v", 5, 9]]), group("n2", [["v", 0, 3], ["w", 0, 2]]), group("kept", [["v", 10, 12]])]
  const stored = {
    highlights: { groups: now },
    flair: {
      looks: {},
      cues: [cue(on("old", 0), "a"), cue(on("old", 1), "b"), cue(on("old", 2), "c"), cue(on("kept", 0), "d"), cue(beat, "e")],
      inserts: [{ anchor: on("old", 1), binId: "m", edited: false }],
    },
  } as unknown as StoredOutline
  const after = regroupFlair(stored, before, () => true).flair!
  expect(after.cues!.map((entry) => [entry.effectId, entry.anchor])).toEqual([
    // words 0–4 are mostly on n2's first line (0–3), words 4–8 on n1's second (5–9), the other video's on n2's second
    ["a", on("n2", 0)],
    ["b", on("n1", 1)],
    ["c", on("n2", 1)],
    ["d", on("kept", 0)],
    ["e", beat],
  ])
  expect(after.inserts!.map((entry) => entry.anchor)).toEqual([on("n1", 1)])

  // a transcript that changed has word numbers that mean nothing now: what was on it goes
  const renumbered = regroupFlair(stored, before, (videoId) => videoId !== "v").flair!
  expect(renumbered.cues!.map((entry) => entry.effectId)).toEqual(["c", "d", "e"])
  expect(renumbered.inserts).toEqual([])
})

test("graphics sit on moments of speech, so text replaced or taken out leaves them as they are", () => {
  const spec = { kind: "motion" as const, version: "m", box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.8 }, seconds: 3, why: "", idea: "ป้ายเด้งขึ้น", words: [], html: "<style></style>" }
  const graphics = [
    { anchor: { kind: "speech", videoId: "v", sourceUs: 1_000_000, beatId: "b" } as CueAnchor, spec, edited: true, off: false },
    { anchor: { kind: "speech", videoId: "v", sourceUs: 2_000_000 } as CueAnchor, spec, edited: false, off: true },
  ]
  const before = [group("old", [["v", 0, 4], ["v", 4, 8]])]
  const stored = { highlights: { groups: [group("n1", [["v", 3, 5], ["v", 5, 9]])] }, flair: { looks: {}, graphics } } as unknown as StoredOutline
  expect(regroupFlair(stored, before, () => true).flair!.graphics).toEqual(graphics)
  expect(regroupFlair({ ...stored, highlights: { groups: [] } } as unknown as StoredOutline, before, () => false).flair!.graphics).toEqual(graphics)
})

test("a graphic Claude put on a moment of speech follows its beat as it is now: renamed in place, or gone with it", () => {
  const beat = (id: string) => ({ id, videoId: "v", kind: "speech" }) as never
  const graphic = (beatId: string) => ({ anchor: { kind: "speech", videoId: "v", sourceUs: 5, beatId } as CueAnchor, edited: false })
  const anchors = (items: { anchor: CueAnchor }[]) => items.map((item) => item.anchor)
  // b grew in the same place and got a new id
  expect(anchors(answerOnBeats([graphic("a"), graphic("b")], [beat("a"), beat("b")], [beat("a"), beat("b2")]))).toEqual(anchors([graphic("a"), graphic("b2")]))
  // b was taken out
  expect(anchors(answerOnBeats([graphic("a"), graphic("b")], [beat("a"), beat("b")], [beat("a")]))).toEqual(anchors([graphic("a")]))
})

test("a line already taken keeps its sound; one set by hand moves before one Claude chose; a line no one shows takes its sound away", () => {
  const cue = (anchor: CueAnchor, effectId: string, edited = false) => ({ anchor, effectId, edited })
  const before = [group("old", [["v", 0, 2], ["v", 2, 4], ["v", 20, 22]])]
  const now = [group("n", [["v", 0, 4]])]
  const stored = {
    highlights: { groups: now },
    flair: { looks: {}, cues: [cue(on("old", 0), "claude"), cue(on("old", 1), "mine", true), cue(on("old", 2), "nowhere")] },
  } as unknown as StoredOutline
  expect(regroupFlair(stored, before, () => true).flair!.cues!.map((entry) => [entry.effectId, entry.anchor])).toEqual([["mine", on("n", 0)]])

  const taken = { ...stored, flair: { looks: {}, cues: [cue(on("n", 0), "there"), cue(on("old", 0), "claude", true)] } } as unknown as StoredOutline
  expect(regroupFlair(taken, before, () => true).flair!.cues!.map((entry) => entry.effectId)).toEqual(["there"])

  // two new lines showing as many of the words: the first one takes it
  const tied = { ...stored, highlights: { groups: [group("t1", [["v", 0, 1]]), group("t2", [["v", 1, 2]])] }, flair: { looks: {}, cues: [cue(on("old", 0), "claude")] } } as unknown as StoredOutline
  expect(regroupFlair(tied, before, () => true).flair!.cues!.map((entry) => entry.anchor)).toEqual([on("t1", 0)])

  // nothing to move: the outline comes back as it was
  const bare = { highlights: { groups: now } } as unknown as StoredOutline
  expect(regroupFlair(bare, before, () => true)).toBe(bare)
  const noCues = { highlights: { groups: now }, flair: { looks: {} } } as unknown as StoredOutline
  expect(regroupFlair(noCues, before, () => true).flair).toEqual({ looks: {} })
})

const textGroup = (id: string, lines: [videoId: string, from: number, to: number, text: string][]): HighlightGroup => ({
  id,
  source: "ai",
  edited: false,
  lines: lines.map(([videoId, from, to, text]) => ({ videoId, from, to, text })),
})

test("a look goes to the group now showing most of its words, its coloured word found again in the line it moved to", () => {
  const accented = (line: number, edited = false): GroupLook => ({ pattern: "bar", tone: "accent", accent: { line, from: 5, to: 8 }, exit: null, edited })
  const before = [textGroup("old", [["v", 0, 2, "ขึ้นไป"], ["v", 2, 4, "ราคา 500"]]), textGroup("other", [["v", 20, 22, "จบ"]])]
  const now = [textGroup("small", [["v", 0, 1, "ขึ้น"]]), textGroup("big", [["v", 1, 2, "ไป"], ["v", 2, 4, "ถูก 500"]])]
  const stored = { highlights: { groups: now }, flair: { looks: { old: accented(1), other: look(0) } } } as unknown as StoredOutline
  const after = regroupFlair(stored, before, () => true).flair!.looks
  // "big" shares three words, "small" one; "other" shares none and goes nowhere
  expect(after.big).toEqual({ ...accented(1), accent: { line: 1, from: 4, to: 7 } })
  expect(after.small).toBeUndefined()
  // on a transcript that changed nothing moves
  expect(regroupFlair(stored, before, () => false).flair!.looks.big).toBeUndefined()

  // the coloured word's line went to another group, or its word is not in the new line: no colour
  const split = [textGroup("first", [["v", 0, 2, "ขึ้นไป"]]), textGroup("second", [["v", 2, 4, "ราคา 500"]])]
  const onFirst = { highlights: { groups: [split[0]!] }, flair: { looks: { old: accented(1) } } } as unknown as StoredOutline
  expect(regroupFlair(onFirst, before, () => true).flair!.looks.first!.accent).toBeNull()
  // the look goes where most of the words went; the coloured word's own line went to another group, so it has no colour
  const scattered = { highlights: { groups: [textGroup("most", [["v", 0, 2, "ขึ้นไป 500"]]), textGroup("tail", [["v", 2, 3, "ราคา 500"]])] }, flair: { looks: { old: accented(1) } } } as unknown as StoredOutline
  expect(regroupFlair(scattered, before, () => true).flair!.looks.most!.accent).toBeNull()
  const reworded = { highlights: { groups: [textGroup("n", [["v", 0, 2, "ขึ้นไป"], ["v", 2, 4, "ไม่มีเลข"]])] }, flair: { looks: { old: accented(1) } } } as unknown as StoredOutline
  expect(regroupFlair(reworded, before, () => true).flair!.looks.n!.accent).toBeNull()
})

test("a group that already has a look keeps it, and a look set by hand moves before one Claude chose", () => {
  const plain = (edited: boolean, pattern: GroupLook["pattern"]): GroupLook => ({ pattern, tone: "base", accent: null, exit: null, edited })
  const before = [textGroup("claude", [["v", 0, 3, "ก"]]), textGroup("mine", [["v", 3, 4, "ข"]])]
  const now = [textGroup("n", [["v", 0, 4, "กข"]])]
  const stored = { highlights: { groups: now }, flair: { looks: { claude: plain(false, "bar"), mine: plain(true, "punch") } } } as unknown as StoredOutline
  expect(regroupFlair(stored, before, () => true).flair!.looks.n).toEqual(plain(true, "punch"))

  const taken = { ...stored, flair: { looks: { ...stored.flair!.looks, n: plain(false, "stair") } } } as unknown as StoredOutline
  expect(regroupFlair(taken, before, () => true).flair!.looks.n).toEqual(plain(false, "stair"))
})

test("a coloured word stays on its word when the line's text changes, and only that line's colour is looked at", () => {
  const lineLook = (line: number): GroupLook => ({ pattern: "stack", tone: "base", accent: { line, from: 5, to: 8 }, exit: null, edited: true })
  const edited = (text: string, line: number) =>
    ({ highlights: { groups: [textGroup("g", [["v", 0, 2, "ขึ้นไป"], ["v", 2, 4, text]])] }, flair: { looks: { g: lineLook(line) } } }) as unknown as StoredOutline
  expect(withLineText(edited("ถูก 500", 1), "g", 1, "ราคา 500").flair!.looks.g!.accent).toEqual({ line: 1, from: 4, to: 7 })
  expect(withLineText(edited("ไม่มีเลข", 1), "g", 1, "ราคา 500").flair!.looks.g!.accent).toBeNull()
  // a colour on another line of the group is left as it is
  const other = edited("ถูก 500", 0)
  expect(withLineText(other, "g", 1, "ราคา 500")).toBe(other)
  const bare = { highlights: { groups: [] } } as unknown as StoredOutline
  expect(withLineText(bare, "g", 1, "x")).toBe(bare)
})

test("text played twice: a moved sound stays with the beat it was in, and a sound whose best line is taken goes to the next line with its words", () => {
  const cue = (anchor: CueAnchor, effectId: string) => ({ anchor, effectId, edited: false })
  const inBeat = (group: HighlightGroup, beatId: string): HighlightGroup => ({ ...group, beatId })
  const before = [inBeat(group("old", [["v", 0, 2], ["v", 2, 4]]), "body")]
  // the same words picked in the hook and in the body; the hook's group comes first
  const now = [inBeat(group("hook", [["v", 0, 2], ["v", 2, 4]]), "hook"), inBeat(group("body", [["v", 0, 2], ["v", 2, 4]]), "body")]
  const stored = { highlights: { groups: now }, flair: { looks: { old: look(1) }, cues: [cue(on("old", 1), "s")] } } as unknown as StoredOutline
  const after = regroupFlair(stored, before, () => true).flair!
  expect(after.cues!.map((entry) => entry.anchor)).toEqual([on("body", 1)])
  expect(Object.keys(after.looks).filter((id) => id !== "old")).toEqual(["body"])

  // one long line and a short tail: the second sound goes to the tail, the first line being taken
  const split = [group("n", [["v", 0, 3], ["v", 3, 4]])]
  const two = { highlights: { groups: split }, flair: { looks: {}, cues: [cue(on("old", 0), "a"), cue(on("old", 1), "b")] } } as unknown as StoredOutline
  expect(regroupFlair(two, [group("old", [["v", 0, 2], ["v", 2, 4]])], () => true).flair!.cues!.map((entry) => [entry.effectId, entry.anchor])).toEqual([
    ["a", on("n", 0)],
    ["b", on("n", 1)],
  ])
})

test("looks of groups no longer stored are dropped once they have moved; a stored group's look stays, shown or not", () => {
  const plainLook = (pattern: GroupLook["pattern"]): GroupLook => ({ pattern, tone: "base", accent: null, exit: null, edited: false })
  const before = [textGroup("gone", [["v", 0, 2, "ก"]]), textGroup("away", [["v", 10, 12, "ข"]]), textGroup("kept", [["v", 20, 22, "ค"]])]
  const now = [textGroup("new", [["v", 0, 2, "ก"]]), textGroup("kept", [["v", 20, 22, "ค"]])]
  const stored = { highlights: { groups: now }, flair: { looks: { gone: plainLook("bar"), away: plainLook("punch"), kept: plainLook("stair") } } } as unknown as StoredOutline
  expect(regroupFlair(stored, before, () => true).flair!.looks).toEqual({ new: plainLook("bar"), kept: plainLook("stair") })
})

test("a coloured word that moves with its look is looked for in each line that shows its words, best first", () => {
  const text = "โปรพิเศษ ลด 299 บาท"
  const found = findWord(text, "299")!
  const accented: GroupLook = { pattern: "stack", tone: "base", accent: { line: 0, ...found }, exit: null, edited: true }
  const before = [textGroup("old", [["v", 0, 4, text]])]
  const now = [textGroup("n", [["v", 0, 3, "โปรพิเศษ ลด"], ["v", 3, 4, "299 บาท"]])]
  const stored = { highlights: { groups: now }, flair: { looks: { old: accented } } } as unknown as StoredOutline
  expect(regroupFlair(stored, before, () => true).flair!.looks.n!.accent).toEqual({ line: 1, from: 0, to: 3 })
})

test("only the groups allowed to take what moves can take it", () => {
  const cue = { anchor: on("old", 0), effectId: "s", edited: false }
  const before = [textGroup("old", [["v", 0, 2, "ก"]])]
  const now = [textGroup("mine", [["v", 0, 2, "ก"]]), textGroup("fresh", [["v", 1, 2, "ข"]])]
  const stored = { highlights: { groups: now }, flair: { looks: { old: look(0) }, cues: [cue] } } as unknown as StoredOutline
  const after = regroupFlair(stored, before, () => true, (group) => group.id !== "mine").flair!
  expect(after.cues!.map((entry) => entry.anchor)).toEqual([on("fresh", 0)])
  expect(Object.keys(after.looks)).toEqual(["fresh"])
  const none = regroupFlair(stored, before, () => true, () => false).flair!
  expect(none.cues).toEqual([])
  expect(none.looks).toEqual({})
})

test("what Claude answered about beats follows the beats as they are now: renamed, reordered or taken out", () => {
  const beat = (id: string) => ({ id, videoId: "v", kind: "speech" }) as never
  const asked = [beat("a"), beat("b"), beat("c")]
  const edge = (beatId: string, end = false): CueAnchor => ({ kind: "beat", beatId, edge: end ? "end" : "start" })
  const join = (beatId: string): CueAnchor => ({ kind: "cut", videoId: "v", sourceUs: 1, beatId })
  const items = [edge("a"), edge("c", true), join("b"), join("c"), { kind: "cut", videoId: "v", sourceUs: 2 } as CueAnchor, on("g", 0)].map((anchor) => ({ anchor }))
  // c moved to the front and b was taken out
  expect(answerOnBeats(items, asked, [beat("c"), beat("a")]).map((item) => item.anchor)).toEqual([
    edge("a"),
    // the closing sound goes to the beat that ends the video now
    edge("a", true),
    join("c"),
    { kind: "cut", videoId: "v", sourceUs: 2 },
    on("g", 0),
  ])
  // only reordered: every item stays on its own beat, and only the closing sound moves
  const reordered = [beat("c"), beat("a"), beat("b")]
  expect(answerOnBeats([{ anchor: join("b") }, { anchor: edge("a", true) }, { anchor: edge("c", true) }], asked, reordered).map((item) => item.anchor)).toEqual([join("b"), edge("a", true), edge("b", true)])
  // a grown beat got a new id in the same place
  expect(answerOnBeats([{ anchor: edge("b") }, { anchor: join("b") }], asked, [beat("a"), beat("b2"), beat("c")]).map((item) => item.anchor)).toEqual([edge("b2"), join("b2")])
  // nothing changed: the same items
  expect(answerOnBeats(items, asked, asked)).toEqual(items)
})

/* what the options show */

// the fixture's words: ขึ้น(0) ไป(1) ใน(2) อวกาศ(3) ใน(4) สาม(5) สอง(6) หนึ่ง(7) สาม(8) สอง(9) หนึ่ง(10), 17.16–25.25 s
/** One piece of v1 playing 17.0–25.5 s of its source: every word of the fixture plays. */
const ONE_PIECE = {
  durationUs: s(8.5),
  cuts: [{ binId: "v1", sourceStartUs: s(17), sourceDurationUs: s(8.5) }],
  beats: [{ beatId: "b1", videoId: "v1", pieces: [{ startUs: s(17), endUs: s(25.5) }] }],
} as unknown as CutPlan
/** The same video from 19 s: ขึ้น ไป ใน อวกาศ are cut. */
const FROM_19 = {
  durationUs: s(6.5),
  cuts: [{ binId: "v1", sourceStartUs: s(19), sourceDurationUs: s(6.5) }],
  beats: [{ beatId: "b1", videoId: "v1", pieces: [{ startUs: s(19), endUs: s(25.5) }] }],
} as unknown as CutPlan
const V1 = [{ id: "v1", transcript }] as CutClip[]
const FLAIR = { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false } as const
const point = (id: string, importance: EmphasisPoint["importance"], from: number, to: number, videoId = "v1"): EmphasisPoint => ({
  id,
  anchor: { kind: "speech", videoId, from, to, beatId: "b1" },
  importance,
  type: "hook",
  reason: "",
  source: "ai",
  edited: false,
})
const emphasisOf = (points: EmphasisPoint[], transcripts: Record<string, string> = { v1: transcriptFingerprint(transcript) }): StoredEmphasis => ({
  points,
  version: 1,
  plannedOn: { graphics: null, sounds: null },
  transcripts,
})

test("stored points count on the transcript a video has now; a scene point is always current", () => {
  const scene: EmphasisPoint = { ...point("scene", "key", 0, 1), anchor: { kind: "scene", videoId: "v2", startUs: 0, endUs: s(2), beatId: "b2" } }
  const stored = { emphasis: emphasisOf([point("now", "key", 0, 2), scene, point("gone", "key", 0, 2, "v3")], { v1: transcriptFingerprint(transcript), v2: "old" }) } as unknown as StoredOutline
  expect(currentPoints(stored, V1).map((entry) => entry.id)).toEqual(["now", "scene"])
  expect(currentPoints({ emphasis: emphasisOf([point("old", "key", 0, 2)], { v1: "earlier" }) } as unknown as StoredOutline, V1)).toEqual([])
  expect(currentPoints({} as StoredOutline, V1)).toEqual([])
})

test("the show rules: the text as switched, and an item on a point only while the point plays and the level lets its importance through", () => {
  const stored = { emphasis: emphasisOf([point("key", "key", 0, 2), point("extra", "extra", 5, 6)]) } as unknown as StoredOutline
  const medium = showRulesOf(stored, ONE_PIECE, V1, { highlightsOn: true, flair: FLAIR })
  expect(medium.text).toBe(true)
  // an item on no point always shows; one naming a point that is not there never does
  expect([undefined, "key", "extra", "nowhere"].map((id) => medium.passes(id))).toEqual([true, true, false, false])
  const light = showRulesOf(stored, ONE_PIECE, V1, { highlightsOn: false, flair: { ...FLAIR, level: "light" } })
  expect(light.text).toBe(false)
  expect([undefined, "key", "extra"].map((id) => light.passes(id))).toEqual([true, true, false])
  const heavy = showRulesOf(stored, ONE_PIECE, V1, { highlightsOn: true, flair: { ...FLAIR, level: "heavy" } })
  expect([undefined, "key", "extra"].map((id) => heavy.passes(id))).toEqual([true, true, true])
  // a point whose every word is cut is not placed, so what sits on it shows at no level
  expect(placedPoints(stored, FROM_19, V1).map((placed) => placed.point.id)).toEqual(["extra"])
  expect(showRulesOf(stored, FROM_19, V1, { highlightsOn: true, flair: { ...FLAIR, level: "heavy" } }).passes("key")).toBe(false)
  expect([SHOW_ALL.text, SHOW_ALL.passes("nowhere"), SHOW_ALL.passes(undefined)]).toEqual([true, true, true])
})

test("the stored groups are placed under the show rules: none with the text off, none on a point the level holds back", () => {
  const stored = {
    emphasis: emphasisOf([point("key", "key", 0, 2), point("extra", "extra", 5, 6)]),
    highlights: {
      style: null,
      styleByAi: null,
      beatsKey: null,
      transcripts: { v1: transcriptFingerprint(transcript) },
      groups: [{ ...group("on key", [["v1", 0, 2]]), pointId: "key" }, { ...group("on extra", [["v1", 5, 6]]), pointId: "extra" }, group("mine", [["v1", 8, 9]])],
    },
  } as unknown as StoredOutline
  const ids = (show: ShowRules) => placeStored(stored, ONE_PIECE, V1, show).map((placed) => placed.groupId)
  expect(ids(showRulesOf(stored, ONE_PIECE, V1, { highlightsOn: true, flair: FLAIR }))).toEqual(["on key", "mine"])
  expect(ids(showRulesOf(stored, ONE_PIECE, V1, { highlightsOn: true, flair: { ...FLAIR, level: "heavy" } }))).toEqual(["on key", "on extra", "mine"])
  expect(ids(showRulesOf(stored, ONE_PIECE, V1, { highlightsOn: false, flair: { ...FLAIR, level: "heavy" } }))).toEqual([])
  expect(ids(SHOW_ALL)).toEqual(["on key", "on extra", "mine"])
})

test("the looks in force: every pattern and exit at every level, whatever the old switch for all flair says; the plain stack with the looks off", () => {
  const stored = { flair: { looks: { g: { pattern: "punch", tone: "alt", accent: null, exit: "burst-out", edited: false } } } } as unknown as StoredOutline
  const lines = [{ lineIndex: 0, text: "ลดครึ่งราคา" }]
  expect(looksInForce(stored, [{ id: "g", lines }], { ...FLAIR, enabled: false, level: "light" }, null, true).g).toEqual({ pattern: "punch", tone: "alt", accent: null, exit: "burst-out", edited: false })
  expect(looksInForce(stored, [{ id: "g", lines }], { ...FLAIR, text: false }, null).g).toEqual(DEFAULT_LOOK)
})

test("without CapCut Pro a stored exit shows as none, and is named as held: อัลเทอร์เนตเฟด too, since every exit needs Pro; with Pro it shows", () => {
  const stored = { flair: { looks: { g: { pattern: "punch", tone: "alt", accent: null, exit: "spin-out", edited: true }, fade: { ...DEFAULT_LOOK, exit: "fade-alt" } } } } as unknown as StoredOutline
  const groups = [{ id: "g", lines: [{ lineIndex: 0, text: "ลดครึ่งราคา" }] }, { id: "fade", lines: [{ lineIndex: 0, text: "วันนี้" }] }]
  expect(looksInForce(stored, groups, FLAIR, null, false).g).toEqual({ pattern: "punch", tone: "alt", accent: null, exit: null, edited: true })
  // not told the user has Pro, it is taken that they have not: a Pro exit is never written by mistake
  expect(looksInForce(stored, groups, FLAIR, null).g!.exit).toBeNull()
  // there is no free exit: อัลเทอร์เนตเฟด, whose cached entry said free, shows only with Pro (CapCut 9.5's export dialog asked for it)
  expect(looksInForce(stored, groups, FLAIR, null, false).fade!.exit).toBeNull()
  expect(looksInForce(stored, groups, FLAIR, null, true).fade!.exit).toBe("fade-alt")
  const fadeAlt = { id: "fade-alt", name: "อัลเทอร์เนตเฟด" }
  expect(heldExits(stored, ["g", "fade"], FLAIR, false)).toEqual({ g: { id: "spin-out", name: "หมุนหายไป" }, fade: fadeAlt })
  // only the groups asked about: one not shown holds nothing on the screen
  expect(heldExits(stored, ["fade"], FLAIR, false)).toEqual({ fade: fadeAlt })
  // with Pro, or with the looks off, nothing is held
  expect(heldExits(stored, ["g", "fade"], FLAIR, true)).toEqual({})
  expect(heldExits(stored, ["g", "fade"], { ...FLAIR, text: false }, false)).toEqual({})
  // what is stored is untouched
  expect(stored.flair!.looks.g!.exit).toBe("spin-out")
  expect(stored.flair!.looks.fade!.exit).toBe("fade-alt")
})

/** A label on a stretch of a video's picture, as highlights.pick stores one. */
const label = (id: string, videoId: string, startUs: number, endUs: number): HighlightGroup => ({
  id,
  source: "ai",
  edited: false,
  lines: [{ videoId, from: 0, to: 0, text: id }],
  scene: { videoId, startUs, endUs },
})

test("a label on a picture beat counts whatever the transcript says, while its video is in the outline", () => {
  const clips = [{ id: "v1", transcript }, { id: "v2", transcript: null }] as CutClip[]
  const stored = {
    highlights: {
      style: null,
      styleByAi: null,
      beatsKey: null,
      transcripts: { v1: transcriptFingerprint(transcript), v2: "old" },
      groups: [label("sky", "v2", 0, 1_000_000), label("gone", "v3", 0, 1_000_000), group("old", [["v2", 0, 1]])],
    },
  } as unknown as StoredOutline
  expect(currentGroups(stored, clips).map((g) => g.id)).toEqual(["sky"])
})

test("labels overlap when their stretches of one video do; a label never overlaps words said", () => {
  const kept = [label("k", "v1", 2_000_000, 5_000_000), group("words", [["v1", 0, 4]])]
  const result = withoutOverlaps(
    [label("inside", "v1", 4_000_000, 6_000_000), label("after", "v1", 5_000_000, 7_000_000), label("other clip", "v2", 2_000_000, 5_000_000), group("said", [["v1", 4, 6]])],
    kept,
  )
  expect(result.groups.map((g) => g.id)).toEqual(["after", "other clip", "said"])
  expect(result.droppedLines).toBe(1)
})

test("a label on a picture beat hides no subtitle words", () => {
  const sky = { groupId: "sky", videoId: "v", scene: true, lines: [{ lineIndex: 0, cut: 0, words: { from: 0, to: 0 } }] } as unknown as PlacedGroup
  const said = { groupId: "w", videoId: "v", lines: [{ lineIndex: 0, cut: 1, words: { from: 2, to: 4 } }] } as unknown as PlacedGroup
  const timed = [
    { groupId: "sky", endUs: 3_000_000, lines: [{ lineIndex: 0, startUs: 0 }] },
    { groupId: "w", endUs: 5_000_000, lines: [{ lineIndex: 0, startUs: 3_000_000 }] },
  ] as unknown as TimedGroup[]
  const hidden = hiddenWords([sky, said], timed)
  expect([...hidden.keys()]).toEqual([1])
  expect([...hidden.get(1)!]).toEqual([2, 3])
})

test("what was on a label follows to the label now on most of the same stretch of its video, even on a new transcript", () => {
  const cue = (anchor: CueAnchor, effectId: string, edited = false) => ({ anchor, effectId, edited })
  const handSet: GroupLook = { pattern: "punch", tone: "alt", accent: null, exit: null, edited: true }
  const before = [label("old", "v", 2_000_000, 5_000_000)]
  // "elsewhere" is the same stretch of another video and "said" says words: neither shares anything with the label
  const now = [label("elsewhere", "w", 2_000_000, 5_000_000), group("said", [["v", 0, 4]]), label("new", "v", 3_000_000, 6_000_000)]
  const stored = { highlights: { groups: now }, flair: { looks: { old: handSet }, cues: [cue(on("old", 0), "mine", true)] } } as unknown as StoredOutline
  // the transcript changed, so words cannot follow; a stretch of picture still can
  const after = regroupFlair(stored, before, () => false).flair!
  expect(after.cues!.map((entry) => [entry.effectId, entry.anchor])).toEqual([["mine", on("new", 0)]])
  expect(after.looks).toEqual({ new: handSet })
})

// thinking again on the text (spec §5.1, decided 2026-09-28): what the user edited on replaced text and no new line takes is not lost
test("what no free line takes goes where orElse puts it, in its place among the rest; one orElse leaves on a gone line goes", () => {
  const cue = (anchor: CueAnchor, effectId: string, edited = false) => ({ anchor, effectId, edited })
  const start: CueAnchor = { kind: "beat", beatId: "b", edge: "start" }
  const before = [group("old", [["v", 0, 2], ["v", 2, 4], ["v", 20, 22]])]
  // only old's first line has its words shown again
  const now = [group("n", [["v", 0, 2]])]
  const stored = {
    highlights: { groups: now },
    flair: {
      looks: {},
      cues: [
        cue(on("old", 0), "follows", true),
        // words 2–4 are on no line now, and the user left it as Claude put it
        cue(on("old", 1), "claude"),
        // its words are on n's line, but "follows" took that line first
        cue(on("old", 0), "second", true),
        cue(on("old", 2), "mine", true),
        cue(start, "there"),
      ],
      inserts: [{ anchor: on("old", 2), binId: "m", edited: true }],
    },
  } as unknown as StoredOutline
  const handed: string[][] = []
  // as highlights.pick's offGoneLines does: an edited item still on a line of the gone group goes to the start of a
  // beat; everything else (unedited, or on a line or place that stays) is handed back as it is
  const orElse = <T extends { anchor: CueAnchor; edited: boolean }>(items: T[]): T[] => {
    handed.push(items.map((item) => ("effectId" in item ? String(item.effectId) : "insert")))
    return items.map((item) => {
      const anchor: CueAnchor = item.anchor
      return item.edited && anchor.kind === "highlight" && anchor.groupId === "old" ? { ...item, anchor: start } : item
    })
  }
  const after = regroupFlair(stored, before, () => true, () => true, orElse).flair!
  expect(after.cues!.map((entry) => [entry.effectId, entry.anchor])).toEqual([
    ["follows", on("n", 0)],
    ["second", start],
    ["mine", start],
    ["there", start],
  ])
  expect(after.inserts!.map((entry) => entry.anchor)).toEqual([start])
  // handed the whole list after following, in its order, once for the sounds and once for the cutaways
  expect(handed).toEqual([["follows", "claude", "second", "mine", "there"], ["insert"]])
  // with no orElse, all of it goes, as before
  const plain = regroupFlair(stored, before, () => true).flair!
  expect(plain.cues!.map((entry) => entry.effectId)).toEqual(["follows", "there"])
  expect(plain.inserts).toEqual([])
})

test("a point is named by its words, or by the scene at its first kept moment, else the first scene its stretch overlaps", () => {
  const scene = (startUs: number, endUs: number, description: string) => ({ startUs, endUs, description, kind: "b-roll", issues: [], keepClear: null })
  const clips = [
    { id: "v", transcript: { words: ["ขึ้น", "ไป", "ใน", "อวกาศ"].map((text) => ({ text, startUs: 0, endUs: 0 })) } },
    // a gap between 10 s and 12 s that no scene covers
    { id: "p", insight: { scenes: [scene(0, 10_000_000, "แมวกระโดด"), scene(12_000_000, 20_000_000, "ปลาทอด")] } },
  ] as unknown as CutClip[]
  const placed = (anchor: EmphasisPoint["anchor"], sourceUs: number): PlacedPoint => ({
    point: { id: "p1", anchor, importance: "key", type: "visual", reason: "", source: "ai", edited: false },
    videoId: anchor.videoId,
    beatId: anchor.beatId,
    cut: 0,
    sourceUs,
    atUs: 0,
    endUs: 1,
  })
  const stretch = (startUs: number, endUs: number): EmphasisPoint["anchor"] => ({ kind: "scene", videoId: "p", startUs, endUs, beatId: "b2" })
  expect(pointText(placed({ kind: "speech", videoId: "v", from: 1, to: 4, beatId: "b1" }, 0), clips)).toBe("ไปในอวกาศ")
  // the scene playing at its first kept moment, not the first one its stretch touches
  expect(pointText(placed(stretch(9_000_000, 14_000_000), 12_500_000), clips)).toBe("ปลาทอด")
  // a first kept moment in the gap between two scenes: the first scene the stretch overlaps
  expect(pointText(placed(stretch(9_000_000, 14_000_000), 10_500_000), clips)).toBe("แมวกระโดด")
  // a stretch no scene overlaps says nothing, one that starts where a scene ends included
  expect(pointText(placed(stretch(10_000_000, 11_800_000), 10_500_000), clips)).toBe("")
})
