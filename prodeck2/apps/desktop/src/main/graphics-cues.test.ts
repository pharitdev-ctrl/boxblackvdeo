import { expect, test } from "vitest"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import { frameKey } from "@boxblack/core/graphics/motion/points"
import { MOTION_VERSION, type GraphicCue, type GraphicSpec, type MotionSpec } from "@boxblack/core/graphics/plan"
import type { PlacedGroup, TimedGroup } from "@boxblack/core/highlights"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import {
  existingGraphics,
  framesWanted,
  graphicJob,
  graphicPoints,
  graphicsInForce,
  graphicViews,
  isReplaced,
  keepClearsIn,
  renderSeconds,
  replacedPoints,
  replacesText,
  sentenceOf,
  textBands,
  textBandsIn,
  wordsSaidFrom,
} from "./graphics-cues.ts"
import type { ItemPlace } from "./insert-media.ts"
import type { SpokenSentence } from "./spoken.ts"

const PORTRAIT = { width: 1080, height: 1920 }

/** Two sentences of one clip in beat b1, and the second one again in beat b2 (footage played twice). */
const SENTENCES: SpokenSentence[] = [
  {
    videoId: "v",
    beatId: "b1",
    beatName: "เปิด",
    from: 0,
    to: 3,
    text: "ยอดขายเดือนนี้",
    timelineUs: 0,
    timelineEndUs: 1_000_000,
    endUs: 11_000_000,
    words: [
      { text: "ยอด", startUs: 10_000_000 },
      { text: "ขาย", startUs: 10_300_000 },
      { text: "เดือนนี้", startUs: 10_600_000 },
    ],
  },
  { videoId: "v", beatId: "b1", beatName: "เปิด", from: 3, to: 5, text: "ล้านสองแสน", timelineUs: 1_500_000, timelineEndUs: 2_800_000, endUs: 12_800_000, words: [{ text: "ล้าน", startUs: 11_500_000 }, { text: "สองแสน", startUs: 12_000_000 }] },
  { videoId: "v", beatId: "b2", beatName: "ปิด", from: 3, to: 5, text: "ล้านสองแสน", timelineUs: 5_000_000, timelineEndUs: 6_300_000, endUs: 12_800_000, words: [{ text: "ล้าน", startUs: 11_500_000 }, { text: "สองแสน", startUs: 12_000_000 }] },
]

const CLIPS = [
  {
    id: "v",
    insight: {
      scenes: [
        { startUs: 0, endUs: 11_200_000, description: "คนพูดกลางเฟรม", kind: "talking-head", issues: [], keepClear: { fromY: 0.1, toY: 0.45 } },
        { startUs: 11_200_000, endUs: 20_000_000, description: "ถือสินค้า", kind: "product", issues: [], keepClear: null },
      ],
    },
  },
] as unknown as CutClip[]

/** One group of one line on words 0–2 of the clip, in beat b1. */
const placed = (groupId: string, words: { from: number; to: number }, beatId = "b1"): PlacedGroup => ({
  groupId,
  beatId,
  videoId: "v",
  lines: [{ lineIndex: 0, text: "ราคา", cut: 0, sourceUs: 10_000_000, partial: false, words }],
  end: { cut: 0, sourceUs: 11_000_000 },
})
const timed = (groupId: string, beatId = "b1"): TimedGroup => ({ groupId, beatId, startUs: 0, endUs: 1_200_000, lines: [{ lineIndex: 0, text: "ราคา", startUs: 0, partial: false }] })

const bandsOf = (position: "top" | "auto", subtitlesOn: boolean, groups: PlacedGroup[] = [placed("g1", { from: 0, to: 2 })]) =>
  textBands({ placed: groups, timed: groups.map((group) => timed(group.groupId, group.beatId)), clips: CLIPS, canvas: PORTRAIT, font: "kanit", looks: {}, position, subtitlesOn })

test("a group's text band is where the layout draws its lines, as shares of the frame from the top", () => {
  // pinned to the top: the block starts at 0.72 in CapCut's units, 0.14 from the top; a short word
  // is drawn as tall as a line may be, 0.13 of the frame, in the middle of its 1.05-line box
  expect(bandsOf("top", false).map((entry) => entry.band)).toEqual([{ fromY: 0.14, toY: 0.28 }])
  // placed automatically over a face at 0.1–0.45 with subtitles on: under the face, just above the subtitles' room at 0.76
  expect(bandsOf("auto", true).map((entry) => entry.band)).toEqual([{ fromY: 0.62, toY: 0.76 }])
})

test("the band follows the group's pattern: a bar is drawn taller than a plain line", () => {
  const groups = [placed("g1", { from: 0, to: 2 })]
  const bands = (pattern: "bar" | "stack") =>
    textBands({ placed: groups, timed: groups.map((group) => timed(group.groupId)), clips: CLIPS, canvas: PORTRAIT, font: "kanit", looks: { g1: { pattern, tone: "base", accent: null, exit: null, edited: false } }, position: "top", subtitlesOn: false })
  expect(bands("stack").map((entry) => entry.band)).toEqual([{ fromY: 0.14, toY: 0.28 }])
  // the bar's box is 1.5 lines tall and the bar itself 1.25: its middle sits lower and it reaches further
  expect(bands("bar").map((entry) => entry.band)).toEqual([{ fromY: 0.15, toY: 0.29 }])
})

/** The clip with its words: ยอด(0) ขาย(1) เดือนนี้(2) ล้าน(3) สองแสน(4). */
const TRANSCRIBED = [{ ...CLIPS[0]!, transcript: { words: ["ยอด", "ขาย", "เดือนนี้", "ล้าน", "สองแสน"].map((text) => ({ text, startUs: 0, endUs: 0 })) } }] as unknown as CutClip[]
/** A point on the first word of a sentence (or, as a scene point, on its stretch), placed where the sentence plays. */
const pointOn = (sentence: SpokenSentence, id: string, kind: "speech" | "scene" = "speech"): PlacedPoint => ({
  point: {
    id,
    anchor:
      kind === "speech"
        ? { kind, videoId: "v", from: sentence.from, to: sentence.from + 1, beatId: sentence.beatId }
        : { kind, videoId: "v", startUs: sentence.words[0]!.startUs, endUs: sentence.endUs, beatId: sentence.beatId },
    importance: "key",
    type: "number",
    reason: "ยอดขาย",
    source: "ai",
    edited: false,
  },
  videoId: "v",
  beatId: sentence.beatId,
  cut: 0,
  sourceUs: sentence.words[0]!.startUs,
  atUs: sentence.timelineUs,
  endUs: sentence.timelineEndUs,
})

test("graphic points carry the sentence of their first kept moment, in their own beat, with its scene, and the band of their own text; a scene point has no sentence", () => {
  // the text of the first sentence was made for p1
  const bands = bandsOf("top", false, [{ ...placed("g1", { from: 0, to: 2 }), pointId: "p1" }])
  const points = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1"), pointOn(SENTENCES[2]!, "p2"), pointOn(SENTENCES[1]!, "p3", "scene")], sentences: SENTENCES, clips: TRANSCRIBED, bands })
  const talking = { description: "คนพูดกลางเฟรม", kind: "talking-head", keepClear: { fromY: 0.1, toY: 0.45 } }
  expect(points[0]).toEqual({
    pointId: "p1",
    kind: "speech",
    importance: "key",
    type: "number",
    reason: "ยอดขาย",
    videoId: "v",
    beatId: "b1",
    atUs: 0,
    timelineEndUs: 1_000_000,
    anchor: { kind: "speech", videoId: "v", sourceUs: 10_000_000, beatId: "b1" },
    text: "ยอด",
    sentence: {
      videoId: "v",
      beatId: "b1",
      atUs: 0,
      text: "ยอดขายเดือนนี้",
      // words with no rough-cut time of their own play as they were said, from the sentence's start
      words: [
        { text: "ยอด", startUs: 10_000_000, timelineUs: 0 },
        { text: "ขาย", startUs: 10_300_000, timelineUs: 300_000 },
        { text: "เดือนนี้", startUs: 10_600_000, timelineUs: 600_000 },
      ],
      timelineEndUs: 1_000_000,
      scene: talking,
    },
    scene: talking,
    textBand: { fromY: 0.14, toY: 0.28 },
  })
  // footage played twice: the point in beat b2 takes b2's sentence
  expect(points[1]).toMatchObject({ pointId: "p2", beatId: "b2", text: "ล้าน", sentence: { beatId: "b2", atUs: 5_000_000 }, scene: { kind: "product" } })
  expect(points[2]).toMatchObject({ pointId: "p3", kind: "scene", sentence: null, text: "ถือสินค้า", scene: { description: "ถือสินค้า" }, textBand: null })
  // a point is told of its own text and no other: text made for another point is not its text, though it is on its
  // sentence or on screen while it plays, and neither is text bound to no point
  const others = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p9"), { ...pointOn(SENTENCES[1]!, "p3", "scene"), atUs: 0, endUs: 500_000 }], sentences: SENTENCES, clips: TRANSCRIBED, bands })
  expect(others.map((point) => point.textBand)).toEqual([null, null])
  expect(graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1")], sentences: SENTENCES, clips: TRANSCRIBED, bands: bandsOf("top", false) })[0]!.textBand).toBeNull()
  // a scene point's own text is its label
  expect(graphicPoints({ points: [pointOn(SENTENCES[1]!, "p1", "scene")], sentences: SENTENCES, clips: TRANSCRIBED, bands })[0]!.textBand).toEqual({ fromY: 0.14, toY: 0.28 })
  // two groups made for one point (Claude's, and one the user made on it): the band covers both
  const two = [{ ...bands[0]!, band: { fromY: 0.1, toY: 0.2 } }, { ...bands[0]!, groupId: "g2", band: { fromY: 0.6, toY: 0.7 } }, { ...bands[0]!, groupId: "g3", pointId: "p2", band: { fromY: 0.8, toY: 0.9 } }]
  expect(graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1")], sentences: SENTENCES, clips: TRANSCRIBED, bands: two })[0]!.textBand).toEqual({ fromY: 0.1, toY: 0.7 })
  // words that know where they play on the rough cut keep it
  const cut: SpokenSentence = { ...SENTENCES[0]!, words: [{ text: "ยอด", startUs: 10_000_000, timelineUs: 0 }, { text: "ขาย", startUs: 12_000_000, timelineUs: 400_000 }] }
  expect(graphicPoints({ points: [pointOn(cut, "p")], sentences: [cut], clips: CLIPS, bands: [] })[0]!.sentence!.words.map((word) => word.timelineUs)).toEqual([0, 400_000])
})

test("each point's frame is its first kept moment; points at the same moment share one, and none is taken of the user's own", () => {
  const points = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1"), pointOn(SENTENCES[1]!, "p2"), pointOn(SENTENCES[2]!, "p3")], sentences: SENTENCES, clips: CLIPS, bands: [] })
  const { keys, wanted } = framesWanted(points)
  expect(Object.keys(keys)).toEqual([frameKey(points[0]!, 0), frameKey(points[1]!, 1), frameKey(points[2]!, 2)])
  // footage played twice: one frame for both showings
  expect(keys[frameKey(points[1]!, 1)]).toBe(keys[frameKey(points[2]!, 2)])
  expect([...wanted.entries()].map(([videoId, moments]) => [videoId, moments.map((moment) => moment.sourceUs)])).toEqual([["v", [10_000_000, 11_500_000]]])
  const moments = (taken: Set<number>) => [...framesWanted(points, taken).wanted.values()].flat().map((moment) => moment.sourceUs)
  expect(moments(new Set([1]))).toEqual([11_500_000])
  expect(moments(new Set([1, 2, 3]))).toEqual([])
})

test("only the frames the call will attach are wanted: a dozen at most, spread over the clip, whatever video they are of", () => {
  const one = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p")], sentences: SENTENCES, clips: CLIPS, bands: [] })[0]!
  // thirty points, each at its own moment, alternating between two videos
  const many = Array.from({ length: 30 }, (_, i) => {
    const videoId = i % 2 === 0 ? "v" : "w"
    return { ...one, videoId, anchor: { kind: "speech" as const, videoId, sourceUs: i * 1_000_000, beatId: "b1" } }
  })
  const { keys, wanted } = framesWanted(many)
  expect(Object.keys(keys)).toHaveLength(30)
  const chosen = [...wanted.values()].flat().map((moment) => moment.sourceUs).sort((a, b) => a - b)
  // point floor(i * 30 / 12) for i = 0..11, the way core spreads them
  expect(chosen).toEqual([0, 2, 5, 7, 10, 12, 15, 17, 20, 22, 25, 27].map((n) => n * 1_000_000))
  expect(wanted.get("v")!.every((moment) => (moment.sourceUs / 1_000_000) % 2 === 0)).toBe(true)
})

/** A graphic as its plan leaves it, not written yet: it is placed by every rule a graphic is placed by, and has nothing to go stale. */
const SPEC: MotionSpec = {
  kind: "motion",
  version: MOTION_VERSION,
  box: { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 },
  seconds: 3,
  why: "ตัวเลขยอดขาย",
  idea: "ตัวเลขวิ่งถึง 1,200,000 แล้วคำว่า บาท เด้งขึ้น",
  words: [],
  html: null,
}
const speech = (sourceUs: number, beatId?: string): CueAnchor => ({ kind: "speech", videoId: "v", sourceUs, ...(beatId ? { beatId } : {}) })
const CUE: GraphicCue = { anchor: speech(12_000_000, "b1"), spec: SPEC, edited: false, off: false }
const LATE_CUE: GraphicCue = { ...CUE, anchor: speech(30_000_000, "b1") }
/** A second graphic, which plays at 10 s of the rough cut. */
const SECOND_CUE: GraphicCue = { ...CUE, anchor: speech(20_000_000, "b1") }

test("a moment of speech is in the sentence of its video and beat that holds it; one saved without a beat, the first", () => {
  expect(sentenceOf(SENTENCES, speech(12_000_000, "b2"))).toBe(SENTENCES[2])
  expect(sentenceOf(SENTENCES, speech(12_000_000))).toBe(SENTENCES[1])
  expect(sentenceOf(SENTENCES, speech(10_000_000, "b1"))).toBe(SENTENCES[0])
  expect(sentenceOf(SENTENCES, speech(11_200_000, "b1"))).toBeNull()
  expect(sentenceOf(SENTENCES, { kind: "beat", beatId: "b1", edge: "start" })).toBeNull()
})

test("a moment on a word timed with no length at the very end of a sentence is still in that sentence", () => {
  // the last word starts where the sentence ends, as placeOf's tests in insert-media.test.ts pin it
  const flat: SpokenSentence = { ...SENTENCES[0]!, endUs: 10_600_000 }
  expect(sentenceOf([flat], speech(10_600_000, "b1"))).toBe(flat)
  // a sentence whose last word has a length ends before its end time
  expect(sentenceOf([SENTENCES[0]!], speech(11_000_000, "b1"))).toBeNull()
})

test("a moment where one sentence ends on a word timed with no length and the next begins is in the sentence that begins there", () => {
  // ยอด ขาย ค่ะ, with ค่ะ timed at 11.0 s with no length, then ล้าน at 11.0 s and สองแสน half a second on
  const before: SpokenSentence = { ...SENTENCES[0]!, text: "ยอดขายค่ะ", endUs: 11_000_000, words: [{ text: "ยอด", startUs: 10_000_000 }, { text: "ขาย", startUs: 10_300_000 }, { text: "ค่ะ", startUs: 11_000_000 }] }
  const after: SpokenSentence = { ...SENTENCES[1]!, timelineUs: 1_000_000, endUs: 12_300_000, words: [{ text: "ล้าน", startUs: 11_000_000 }, { text: "สองแสน", startUs: 11_500_000 }] }
  expect(sentenceOf([before, after], speech(11_000_000, "b1"))).toBe(after)
  // so a motion graphic there is written for the words that follow, not for the word that ended the sentence before
  expect(wordsSaidFrom({ sentences: [before, after], clips: CLIPS })(speech(11_000_000, "b1"), 3)).toEqual([{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.5 }])
  // with no sentence beginning there, the one that ends on it still holds it; and whichever comes first in the list
  expect(sentenceOf([before], speech(11_000_000, "b1"))).toBe(before)
  expect(sentenceOf([after, before], speech(11_000_000, "b1"))).toBe(after)
  // a moment inside the first is in the first
  expect(sentenceOf([before, after], speech(10_300_000, "b1"))).toBe(before)
})

test("the user's own graphics are shown to Claude by the point they sit on and what they draw; Claude's own and those on no point shown are not", () => {
  const points = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1"), pointOn(SENTENCES[1]!, "p2"), pointOn(SENTENCES[2]!, "p3")], sentences: SENTENCES, clips: CLIPS, bands: [] })
  const graphics: GraphicCue[] = [
    { ...CUE, edited: true, pointId: "p3" },
    // Claude's own
    { ...CUE, anchor: speech(10_300_000, "b1") },
    // bound to no point: it sits on the point whose sentence holds its moment, in its beat
    { ...CUE, anchor: speech(12_000_000, "b2"), edited: true, off: true },
    { ...CUE, edited: true, pointId: "gone" },
    { ...CUE, anchor: speech(40_000_000, "b1"), edited: true },
  ]
  expect(existingGraphics(graphics, points)).toEqual([
    { point: 3, summary: "ตัวเลขวิ่งถึง 1,200,000 แล้วคำว่า บาท เด้งขึ้น", off: false },
    { point: 3, summary: "ตัวเลขวิ่งถึง 1,200,000 แล้วคำว่า บาท เด้งขึ้น", off: true },
  ])
})

const ON: FlairOptions = { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: true }
/** Each graphic plays 10 s before its source time; one at 30 s of the source has no place on the cut. */
const place = (anchor: CueAnchor): ItemPlace | null => (anchor.kind === "speech" && anchor.sourceUs < 25_000_000 ? { atUs: anchor.sourceUs - 10_000_000, what: "ที่ “ล้านสองแสน”", beatId: "b1", by: anchor } : null)
/** A box's edges to the millionth, so the sums of shares compare cleanly. */
const rounded = (box: GraphicSpec["box"]) => Object.fromEntries(Object.entries(box).map(([edge, value]) => [edge, Number(value.toFixed(6))]))
const inForce = (graphics: GraphicCue[], over: Partial<Parameters<typeof graphicsInForce>[0]> = {}) =>
  graphicsInForce({ graphics, place, flair: ON, durationUs: 60_000_000, passes: () => true, pieceEndOf: () => null, keepClearIn: () => [], textIn: () => [], wordsFrom: () => [], captionsFromY: null, ...over })

test("graphics in force: placed on the rough cut, off ones skipped, boxes moved off the face", () => {
  const { kept, dropped } = inForce([CUE, { ...CUE, off: true }, SECOND_CUE], {
    keepClearIn: (span) => (span.startUs === 2_000_000 ? [{ fromY: 0.1, toY: 0.45 }] : []),
  })
  expect(kept.map((graphic) => [graphic.atUs, graphic.durationUs])).toEqual([
    [2_000_000, 3_000_000],
    [10_000_000, 3_000_000],
  ])
  // the box moved whole below the face, keeping its height
  expect(rounded(kept[0]!.cue.spec.box)).toEqual({ x0: 0.1, y0: 0.47, x1: 0.9, y1: 0.67 })
  // the one switched off is not counted
  expect(dropped).toBe(0)
})

/** A motion graphic on the moment CUE plays at, written for its 3 s and the two words said in them: ล้าน as it starts, สองแสน half a second in. */
const MOTION: MotionSpec = {
  kind: "motion",
  version: MOTION_VERSION,
  box: SPEC.box,
  seconds: 3,
  why: "ตัวเลขยอดขาย",
  idea: "ตัวเลขวิ่งถึง 1,200,000 แล้วคำว่า บาท เด้งขึ้น",
  words: [
    { text: "ล้าน", atS: 0 },
    { text: "สองแสน", atS: 0.5 },
  ],
  html: '<style>.n{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="n">1,200,000</div>',
}
const MOTION_CUE: GraphicCue = { ...CUE, spec: MOTION }
/** What is said now, as the caller's `wordsFrom` answers it: these words, each at its seconds from the graphic's start. */
const said =
  (...words: [string, number][]) =>
  () =>
    words.map(([text, atS]) => ({ text, atS }))
/** The words MOTION was written for, said when they were. */
const AS_WRITTEN = said(["ล้าน", 0], ["สองแสน", 0.5])

test("a motion graphic is placed as every graphic is: where its moment plays, the switched-off ones apart, and not at all on a point the level hides", () => {
  const second: GraphicCue = { ...MOTION_CUE, anchor: speech(20_000_000, "b1") }
  const off: GraphicCue = { ...MOTION_CUE, anchor: speech(15_000_000, "b1"), off: true }
  const result = inForce([MOTION_CUE, off, second])
  expect(result.kept.map((graphic) => [graphic.cue.anchor, graphic.atUs, graphic.durationUs])).toEqual([
    [MOTION_CUE.anchor, 2_000_000, 3_000_000],
    [second.anchor, 10_000_000, 3_000_000],
  ])
  expect(result.off.map((graphic) => [graphic.cue.anchor, graphic.atUs, graphic.durationUs])).toEqual([[off.anchor, 5_000_000, 3_000_000]])
  expect(result.dropped).toBe(0)
  // one whose moment the cut took out counts as dropped, unless it was switched off
  const gone: GraphicCue = { ...MOTION_CUE, anchor: speech(30_000_000, "b1") }
  expect(inForce([gone])).toEqual({ kept: [], dropped: 1, off: [] })
  expect(inForce([{ ...gone, off: true }])).toEqual({ kept: [], dropped: 0, off: [] })
  // on a point the level hides it is neither in force, listed as off, nor dropped
  const hidden = inForce([{ ...MOTION_CUE, pointId: "p" }, { ...off, pointId: "p" }, { ...gone, pointId: "p" }, { ...second, pointId: "q" }], { passes: (id) => id !== "p" })
  expect(hidden.kept.map((graphic) => graphic.cue.anchor)).toEqual([second.anchor])
  expect([hidden.off, hidden.dropped]).toEqual([[], 0])
  // and with the switch off none is in force
  expect(inForce([MOTION_CUE, off], { flair: { ...ON, graphic: false } })).toEqual({ kept: [], dropped: 0, off: [] })
})

test("a motion graphic ends where the piece playing its sentence does, but never plays shorter than 1.5 s, and the end of the rough cut cuts it short", () => {
  // MOTION_CUE plays from 2.0 s for 3 s
  const lasting = (over: Partial<Parameters<typeof graphicsInForce>[0]>) => inForce([MOTION_CUE], over).kept.map((graphic) => graphic.durationUs)
  expect(lasting({ pieceEndOf: () => 4_000_000 })).toEqual([2_000_000])
  expect(lasting({ pieceEndOf: () => 9_000_000 })).toEqual([3_000_000])
  expect(lasting({ pieceEndOf: () => null })).toEqual([3_000_000])
  expect(lasting({ pieceEndOf: () => 2_500_000 })).toEqual([1_500_000])
  // the piece is asked for by the anchor it plays by, and a switched-off one is cut the same way
  const asked: CueAnchor[] = []
  expect(inForce([{ ...MOTION_CUE, off: true }], { pieceEndOf: (anchor) => (asked.push(anchor), 4_000_000) }).off.map((graphic) => graphic.durationUs)).toEqual([2_000_000])
  expect(asked).toEqual([MOTION_CUE.anchor])
  // a rough cut that ends 2.5 s after it starts leaves it that long; one that leaves it under 1.5 s drops it, and counts it
  expect(lasting({ durationUs: 4_500_000 })).toEqual([2_500_000])
  expect(inForce([MOTION_CUE], { durationUs: 3_000_000 })).toEqual({ kept: [], dropped: 1, off: [] })
})

test("a motion graphic's box moves whole off the face, the highlight text and then the subtitles, keeping its size; with nowhere to go it is dropped", () => {
  const face = { fromY: 0.1, toY: 0.45 }
  const text = { fromY: 0.5, toY: 0.62 }
  const boxOf = (over: Partial<Parameters<typeof graphicsInForce>[0]>) => rounded(inForce([MOTION_CUE], over).kept[0]!.cue.spec.box)
  // stored at 0.3–0.5: below the face, then below the text too
  expect(boxOf({ keepClearIn: () => [face] })).toEqual({ x0: 0.1, y0: 0.47, x1: 0.9, y1: 0.67 })
  expect(boxOf({ keepClearIn: () => [face], textIn: () => [text] })).toEqual({ x0: 0.1, y0: 0.64, x1: 0.9, y1: 0.84 })
  // with the subtitles from 0.76 nowhere is clear of all three: the subtitles give way, the face and the text never do
  expect(boxOf({ keepClearIn: () => [face], textIn: () => [text], captionsFromY: 0.76 })).toEqual({ x0: 0.1, y0: 0.64, x1: 0.9, y1: 0.84 })
  // off the subtitles when there is room above them
  expect(boxOf({ captionsFromY: 0.4 })).toEqual({ x0: 0.1, y0: 0.18, x1: 0.9, y1: 0.38 })
  // both are asked for the span it really plays: 2.0 s on, to the end of its piece
  const spans: { startUs: number; endUs: number }[] = []
  inForce([MOTION_CUE], { pieceEndOf: () => 4_000_000, keepClearIn: (span) => (spans.push(span), []), textIn: (span) => (spans.push(span), []) })
  expect(spans).toEqual([{ startUs: 2_000_000, endUs: 4_000_000 }, { startUs: 2_000_000, endUs: 4_000_000 }])
  // text reaching down to 0.9 leaves nothing clear of the face and the text together: dropped, and counted
  const crowded = { keepClearIn: () => [face], textIn: () => [{ fromY: 0.5, toY: 0.9 }], captionsFromY: 0.76 }
  expect(inForce([MOTION_CUE], crowded)).toEqual({ kept: [], dropped: 1, off: [] })
  // one switched off there is not counted, and is still listed, where it was stored, to be switched back on
  const off: GraphicCue = { ...MOTION_CUE, off: true }
  const listed = inForce([off], crowded)
  expect(listed.off.map((graphic) => [graphic.cue, graphic.atUs, graphic.durationUs])).toEqual([[off, 2_000_000, 3_000_000]])
  expect([listed.kept, listed.dropped]).toEqual([[], 0])
})

test("a stored graphic that is no motion graphic is left out where graphics are placed: neither in force, listed as off, nor counted as dropped", () => {
  // what an outline file may hold is outside the type: a card of the old kit, which stored no kind, one of its stickers, a kind a later version stores
  const stored = (spec: object, over: Partial<GraphicCue> = {}) => ({ ...CUE, ...over, spec }) as unknown as GraphicCue
  const card = { version: "kit-2026-09-25-2", box: SPEC.box, seconds: 3, tone: "accent", in: "pop", out: "fade", pieces: [{ kind: "number", text: "ยอดขาย", from: 0, to: 1_200_000, unit: "บาท", atS: 0, untilS: 1.5 }], why: "" }
  const sticker = { kind: "sticker", version: "kit-2026-09-25-2", box: SPEC.box, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "" }
  const later = { ...MOTION, kind: "hologram" }
  const others = [stored(card), stored(card, { edited: true }), stored(sticker, { anchor: speech(15_000_000, "b1"), off: true }), stored(later, { anchor: speech(17_000_000, "b1") }), stored(card, { anchor: speech(30_000_000, "b1") })]
  // nothing is asked about them: where they would play, how long, or what they must keep clear of
  const asked: string[] = []
  const watching = {
    place: (anchor: CueAnchor) => (asked.push("place"), place(anchor)),
    pieceEndOf: () => (asked.push("pieceEndOf"), null),
    keepClearIn: () => (asked.push("keepClearIn"), []),
    textIn: () => (asked.push("textIn"), []),
    wordsFrom: () => (asked.push("wordsFrom"), []),
  }
  expect(inForce(others, watching)).toEqual({ kept: [], dropped: 0, off: [] })
  expect(asked).toEqual([])
  // and the motion graphics beside them are placed as if they were not there
  const beside = inForce([others[0]!, MOTION_CUE, others[2]!, SECOND_CUE, others[4]!], { wordsFrom: AS_WRITTEN })
  expect(beside).toEqual(inForce([MOTION_CUE, SECOND_CUE], { wordsFrom: AS_WRITTEN }))
  expect(beside.kept.map((graphic) => graphic.cue)).toEqual([MOTION_CUE, SECOND_CUE])
  // nor are they listed on the screen, or shown to Claude as the user's own
  expect(graphicViews(beside, place).map((view) => view.anchor)).toEqual([MOTION_CUE.anchor, SECOND_CUE.anchor])
  const points = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1"), pointOn(SENTENCES[1]!, "p2")], sentences: SENTENCES, clips: CLIPS, bands: [] })
  expect(existingGraphics([stored(card, { edited: true, pointId: "p1" }), { ...MOTION_CUE, edited: true, pointId: "p2" }], points)).toEqual([{ point: 2, summary: MOTION.idea, off: false }])
})

test("a motion graphic carries the words said now while it plays, asked for by the moment it plays by and the length the rules leave it", () => {
  const now = [{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.4 }]
  /** What `wordsFrom` was asked while these graphics were placed, with what came of placing them. */
  const placing = (graphics: GraphicCue[], over: Partial<Parameters<typeof graphicsInForce>[0]> = {}) => {
    const asked: [CueAnchor, number][] = []
    return { ...inForce(graphics, { wordsFrom: (anchor, seconds) => (asked.push([anchor, seconds]), now), ...over }), asked }
  }
  // by its own anchor, for its seconds
  const whole = placing([MOTION_CUE])
  expect(whole.asked).toEqual([[MOTION_CUE.anchor, 3]])
  expect(whole.kept[0]!.wordsNow).toEqual(now)
  // cut short by the end of its piece, and shorter still by the end of the rough cut: the length left after every rule
  expect(placing([MOTION_CUE], { pieceEndOf: () => 4_000_000 }).asked).toEqual([[MOTION_CUE.anchor, 2]])
  expect(placing([MOTION_CUE], { pieceEndOf: () => 4_800_000, durationUs: 4_500_000 }).asked).toEqual([[MOTION_CUE.anchor, 2.5]])
  // a piece that leaves less than the shortest a graphic may be: the 1.5 s it plays all the same
  expect(placing([MOTION_CUE], { pieceEndOf: () => 2_500_000 }).asked).toEqual([[MOTION_CUE.anchor, 1.5]])
  // a length that ends part of a millisecond on is asked for to the millisecond below, which is as long as a graphic is
  // ever written and rendered for: a word said in that last part is not one of its words, then or when it is placed again
  expect(placing([MOTION_CUE], { pieceEndOf: () => 4_133_333 }).asked).toEqual([[MOTION_CUE.anchor, 2.133]])
  expect(placing([MOTION_CUE], { durationUs: 4_499_999 }).asked).toEqual([[MOTION_CUE.anchor, 2.499]])
  // one whose own moment the cut took out plays by its point's start, and its words are those said from there
  const start = speech(11_500_000, "b1")
  const byPoint = (anchor: CueAnchor, pointId?: string): ItemPlace | null => place(anchor) ?? (pointId === "p1" ? { ...place(start)!, by: start } : null)
  expect(placing([{ ...MOTION_CUE, anchor: speech(30_000_000, "b1"), pointId: "p1" }], { place: byPoint }).asked).toEqual([[start, 3]])
  // a switched-off one is listed with its words too
  const off = placing([{ ...MOTION_CUE, off: true }])
  expect(off.asked).toEqual([[MOTION_CUE.anchor, 3]])
  expect(off.off[0]!.wordsNow).toEqual(now)
  // one that is not placed is not asked about: hidden by the level, its place gone, or dropped for want of room
  const hidden = placing([{ ...MOTION_CUE, pointId: "p" }], { passes: (id) => id !== "p" })
  const gone = placing([{ ...MOTION_CUE, anchor: speech(30_000_000, "b1") }])
  const crowded = placing([MOTION_CUE], { keepClearIn: () => [{ fromY: 0, toY: 1 }] })
  expect([hidden.asked, gone.asked, crowded.asked]).toEqual([[], [], []])
  expect([hidden.kept, gone.kept, crowded.kept]).toEqual([[], [], []])
})

test("a written motion graphic is stale once the words said while it plays are not the ones it was written for, in text, order and number", () => {
  // the same words said at other times: fresh, and it carries the times now
  expect(inForce([MOTION_CUE], { wordsFrom: said(["ล้าน", 0], ["สองแสน", 0.72]) }).kept).toEqual([
    { cue: MOTION_CUE, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: [{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.72 }], stale: false },
  ])
  const staleWhen = (wordsFrom: () => { text: string; atS: number }[]) => inForce([MOTION_CUE], { wordsFrom }).kept.map((graphic) => graphic.stale)
  expect(staleWhen(AS_WRITTEN)).toEqual([false])
  // a word cut, another word in its place, a word more, the same two the other way round, and none said at all
  expect(staleWhen(said(["ล้าน", 0]))).toEqual([true])
  expect(staleWhen(said(["ล้าน", 0], ["สามแสน", 0.5]))).toEqual([true])
  expect(staleWhen(said(["ล้าน", 0], ["สองแสน", 0.5], ["บาท", 0.9]))).toEqual([true])
  expect(staleWhen(said(["สองแสน", 0], ["ล้าน", 0.5]))).toEqual([true])
  expect(staleWhen(said())).toEqual([true])
  // stale, it is still placed and listed, kept or switched off as it is, with the words said now, and is not counted as dropped
  const off: GraphicCue = { ...MOTION_CUE, anchor: speech(15_000_000, "b1"), off: true }
  const stale = inForce([MOTION_CUE, off], { wordsFrom: said(["ล้าน", 0]) })
  expect(stale).toEqual({
    kept: [{ cue: MOTION_CUE, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: [{ text: "ล้าน", atS: 0 }], stale: true }],
    dropped: 0,
    off: [{ cue: off, atUs: 5_000_000, durationUs: 3_000_000, wordsNow: [{ text: "ล้าน", atS: 0 }], stale: true }],
  })
  // one written for no words, as on a scene point, is fresh while none are said, and stale once some are
  const wordless: GraphicCue = { ...MOTION_CUE, spec: { ...MOTION, words: [] } }
  expect(inForce([wordless], { wordsFrom: said() }).kept).toEqual([{ cue: wordless, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: [], stale: false }])
  expect(inForce([wordless], { wordsFrom: AS_WRITTEN }).kept.map((graphic) => graphic.stale)).toEqual([true])
})

test("a written motion graphic whose piece ends up to 0.3 s before its length is up plays its whole length all the same, on into the next piece; with less room than that it is given the room there is, and is stale", () => {
  // MOTION_CUE plays from 2.0 s and was written for 3 s; what is said is what it was written for throughout
  const playing = (over: Partial<Parameters<typeof graphicsInForce>[0]>, cue = MOTION_CUE) => inForce([cue], { wordsFrom: AS_WRITTEN, ...over }).kept.map((graphic) => [graphic.durationUs, graphic.stale])
  expect(playing({})).toEqual([[3_000_000, false]])
  // its piece ends 0.07 s sooner (a tighter cut), 0.21 s sooner (a pause cut out of its sentence), and 0.3 s sooner
  expect(playing({ pieceEndOf: () => 4_930_000 })).toEqual([[3_000_000, false]])
  expect(playing({ pieceEndOf: () => 4_790_000 })).toEqual([[3_000_000, false]])
  expect(playing({ pieceEndOf: () => 4_700_000 })).toEqual([[3_000_000, false]])
  // played out, it has the words of its whole length, and keeps clear of what is on screen over all of it
  const asked: [CueAnchor, number][] = []
  const spans: { startUs: number; endUs: number }[] = []
  const [out] = inForce([MOTION_CUE], { pieceEndOf: () => 4_790_000, wordsFrom: (anchor, seconds) => (asked.push([anchor, seconds]), AS_WRITTEN()), keepClearIn: (span) => (spans.push(span), []) }).kept
  expect(asked).toEqual([[MOTION_CUE.anchor, 3]])
  expect(spans).toEqual([{ startUs: 2_000_000, endUs: 5_000_000 }])
  expect(out).toEqual({ cue: MOTION_CUE, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: MOTION.words, stale: false })
  // a microsecond sooner than that, and 0.31 s sooner: it is given the room there is, as any graphic is, and is stale
  expect(playing({ pieceEndOf: () => 4_699_999 })).toEqual([[2_699_999, true]])
  expect(playing({ pieceEndOf: () => 4_690_000 })).toEqual([[2_690_000, true]])
  expect(playing({ pieceEndOf: () => 4_000_000 })).toEqual([[2_000_000, true]])
  // one not written yet has no length to play out: it is given the room there is
  expect(playing({ pieceEndOf: () => 4_790_000 }, { ...MOTION_CUE, spec: { ...MOTION, html: null } })).toEqual([[2_790_000, false]])
  expect(inForce([CUE], { pieceEndOf: () => 4_790_000 }).kept.map((graphic) => graphic.durationUs)).toEqual([2_790_000])
  // one written for the room it had, to the microsecond, plays that
  const exact: GraphicCue = { ...MOTION_CUE, spec: { ...MOTION, seconds: 2.133333 } }
  expect(playing({ pieceEndOf: () => 4_133_333 }, exact)).toEqual([[2_133_333, false]])
})

test("the end of the rough cut cannot be run past: a written motion graphic it cuts more than 0.1 s short of its length is stale", () => {
  const playing = (over: Partial<Parameters<typeof graphicsInForce>[0]>, cue = MOTION_CUE) => {
    const { kept, off } = inForce([cue], { wordsFrom: AS_WRITTEN, ...over })
    return [...kept, ...off].map((graphic) => [graphic.durationUs, graphic.stale])
  }
  // 0.1 s short to the microsecond: its way out, over 0.1 s before its end, is not cut into
  expect(playing({ durationUs: 4_930_000 })).toEqual([[2_930_000, false]])
  expect(playing({ durationUs: 4_900_000 })).toEqual([[2_900_000, false]])
  // a microsecond more, and 0.11 s short
  expect(playing({ durationUs: 4_899_999 })).toEqual([[2_899_999, true]])
  expect(playing({ durationUs: 4_890_000 })).toEqual([[2_890_000, true]])
  // played out past the end of its piece, it still stops where the rough cut does
  expect(playing({ pieceEndOf: () => 4_800_000, durationUs: 4_950_000 })).toEqual([[2_950_000, false]])
  expect(playing({ pieceEndOf: () => 4_800_000, durationUs: 4_850_000 })).toEqual([[2_850_000, true]])
  // a switched-off one is listed for as long as it was, and judged by the length it would get switched on, so that
  // switching it on does not make it stale
  const off: GraphicCue = { ...MOTION_CUE, off: true }
  expect(playing({}, off)).toEqual([[3_000_000, false]])
  expect(playing({ durationUs: 4_900_000 }, off)).toEqual([[3_000_000, false]])
  expect(playing({ durationUs: 4_890_000 }, off)).toEqual([[3_000_000, true]])
  expect(playing({ pieceEndOf: () => 4_000_000 }, off)).toEqual([[2_000_000, true]])
  // and asked for the words of that length
  const asked: number[] = []
  inForce([off], { durationUs: 4_500_000, wordsFrom: (_, seconds) => (asked.push(seconds), AS_WRITTEN()) })
  expect(asked).toEqual([2.5])
})

test("a motion graphic written under another contract than the app's is stale, whatever is said and however long it plays", () => {
  const old: GraphicCue = { ...MOTION_CUE, spec: { ...MOTION, version: "motion-2026-01-01" } }
  const result = inForce([old, { ...old, anchor: speech(15_000_000, "b1"), off: true }], { wordsFrom: AS_WRITTEN })
  expect(result.kept).toEqual([{ cue: old, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: MOTION.words, stale: true }])
  expect(result.off.map((graphic) => graphic.stale)).toEqual([true])
  expect(graphicJob(result.kept[0]!, { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES["bold-white"] })).toBeNull()
  expect(graphicViews(result, place).map((view) => [view.written, view.stale])).toEqual([
    [true, true],
    [true, true],
  ])
  // one planned under it and not written yet is written under the contract there is then: not stale
  expect(inForce([{ ...old, spec: { ...MOTION, version: "motion-2026-01-01", html: null } }], { wordsFrom: AS_WRITTEN }).kept.map((graphic) => graphic.stale)).toEqual([false])
  // the app's own
  expect(MOTION.version).toBe(MOTION_VERSION)
  expect(inForce([MOTION_CUE], { wordsFrom: AS_WRITTEN }).kept.map((graphic) => graphic.stale)).toEqual([false])
})

test("a motion graphic not written yet is never stale, whatever is said now and however long it plays, and is placed and listed all the same", () => {
  const unwritten: GraphicCue = { ...MOTION_CUE, spec: { ...MOTION, html: null } }
  const failed: GraphicCue = { ...MOTION_CUE, anchor: speech(15_000_000, "b1"), spec: { ...MOTION, html: null, failed: "nothing was drawn: every frame is empty" }, off: true }
  // other words than its plan's, in a piece that ends a second before its seconds are up
  expect(inForce([unwritten, failed], { wordsFrom: said(["ยอด", 0]), pieceEndOf: () => 4_000_000 })).toEqual({
    kept: [{ cue: unwritten, atUs: 2_000_000, durationUs: 2_000_000, wordsNow: [{ text: "ยอด", atS: 0 }], stale: false }],
    dropped: 0,
    // the switched-off one plays from 5.0 s, past where that piece ends: the shortest a graphic may play
    off: [{ cue: failed, atUs: 5_000_000, durationUs: 1_500_000, wordsNow: [{ text: "ยอด", atS: 0 }], stale: false }],
  })
})

test("a motion graphic written for the words and the room it is placed with is fresh when it is placed again, even when its room ends part of a millisecond on", () => {
  // ล้าน plays 2.0 s into the rough cut, สองแสน 0.5 s after it and บาท 2.1331 s after it, 0.2 ms before the piece playing them ends
  const sentence: SpokenSentence = {
    ...SENTENCES[1]!,
    timelineUs: 2_000_000,
    timelineEndUs: 4_133_333,
    endUs: 14_200_000,
    words: [
      { text: "ล้าน", startUs: 12_000_000, timelineUs: 2_000_000 },
      { text: "สองแสน", startUs: 12_500_000, timelineUs: 2_500_000 },
      { text: "บาท", startUs: 14_133_100, timelineUs: 4_133_100 },
    ],
  }
  const over = { wordsFrom: wordsSaidFrom({ sentences: [sentence], clips: CLIPS }), pieceEndOf: () => 4_133_333 }
  const unwritten: GraphicCue = { ...MOTION_CUE, spec: { ...MOTION, html: null } }
  const [placed] = inForce([unwritten], over).kept
  // บาท, said 2.133 s in to the millisecond, is not said within the 2.133 s the graphic can be written for
  expect([placed!.durationUs, placed!.wordsNow]).toEqual([2_133_333, [{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.5 }]])
  // written as it is placed, for the length it plays to the millisecond below and the words it has there
  const written: GraphicCue = { ...unwritten, spec: { ...MOTION, seconds: Math.floor(placed!.durationUs / 1_000) / 1_000, words: placed!.wordsNow! } }
  expect(inForce([written], over).kept).toEqual([{ cue: written, atUs: 2_000_000, durationUs: 2_133_000, wordsNow: placed!.wordsNow, stale: false }])
  // and the same when it is written for that length to the microsecond
  const exact: GraphicCue = { ...written, spec: { ...written.spec, seconds: placed!.durationUs / 1_000_000 } }
  expect(inForce([exact], over).kept).toEqual([{ cue: exact, atUs: 2_000_000, durationUs: 2_133_333, wordsNow: placed!.wordsNow, stale: false }])
})

test("the words said from a moment on are those of the sentence that holds it, in its beat, from its word for the length asked; a moment no sentence holds has none", () => {
  const wordsFrom = wordsSaidFrom({ sentences: SENTENCES, clips: CLIPS })
  // ขาย is said 0.3 s into the first sentence, and เดือนนี้ 0.3 s after it
  expect(wordsFrom(speech(10_300_000, "b1"), 3)).toEqual([{ text: "ขาย", atS: 0 }, { text: "เดือนนี้", atS: 0.3 }])
  // a word said as the length runs out is not said while the graphic plays
  expect(wordsFrom(speech(10_300_000, "b1"), 0.3)).toEqual([{ text: "ขาย", atS: 0 }])
  expect(wordsFrom(speech(10_300_000, "b1"), 0.301)).toEqual([{ text: "ขาย", atS: 0 }, { text: "เดือนนี้", atS: 0.3 }])
  // from the sentence's first word, all of it
  expect(wordsFrom(speech(10_000_000, "b1"), 6).map((word) => word.text)).toEqual(["ยอด", "ขาย", "เดือนนี้"])
  // words that know where they play on the rough cut are timed there: a pause the cut took out brings the next word sooner
  const tightened: SpokenSentence = { ...SENTENCES[1]!, words: [{ text: "ล้าน", startUs: 11_500_000, timelineUs: 1_500_000 }, { text: "สองแสน", startUs: 12_000_000, timelineUs: 1_720_000 }] }
  // footage played twice: the sentence of the moment's own beat, and for a moment saved before it knew its beat, the first
  const twice = wordsSaidFrom({ sentences: [SENTENCES[0]!, tightened, SENTENCES[2]!], clips: CLIPS })
  expect(twice(speech(11_500_000, "b1"), 3)).toEqual([{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.22 }])
  expect(twice(speech(11_500_000, "b2"), 3)).toEqual([{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.5 }])
  expect(twice(speech(11_500_000), 3)).toEqual([{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.22 }])
  // a moment between two sentences, a place that is no moment of speech, and a scene point's moment on a picture beat, where nothing is said
  expect(wordsFrom(speech(11_200_000, "b1"), 3)).toEqual([])
  expect(wordsFrom({ kind: "beat", beatId: "b1", edge: "start" }, 3)).toEqual([])
  expect(wordsFrom(speech(3_000_000, "sky"), 3)).toEqual([])
})

test("a graphic left where it was keeps its cue as stored, and one that is moved plays what was stored but for where its box went", () => {
  expect(inForce([CUE]).kept[0]!.cue).toBe(CUE)
  expect(inForce([MOTION_CUE], { wordsFrom: AS_WRITTEN }).kept[0]!.cue).toBe(MOTION_CUE)
  const [moved] = inForce([MOTION_CUE], { keepClearIn: () => [{ fromY: 0.1, toY: 0.45 }], wordsFrom: AS_WRITTEN }).kept
  expect(moved!.cue).toEqual({ ...MOTION_CUE, spec: { ...MOTION, box: moved!.cue.spec.box } })
  expect(moved!.cue.spec.box).not.toEqual(MOTION.box)
})

test("a box moved off the face does not land on the sentence's text or the subtitles: every band it would cover is dodged together", () => {
  const face = { fromY: 0.1, toY: 0.45 }
  const text = { fromY: 0.5, toY: 0.62 }
  // off the face alone it would sit at 0.47–0.67, on the text
  const [moved] = inForce([CUE], { keepClearIn: () => [face], textIn: () => [text] }).kept
  expect(rounded(moved!.cue.spec.box)).toEqual({ x0: 0.1, y0: 0.64, x1: 0.9, y1: 0.84 })
  for (const band of [face, text]) expect(moved!.cue.spec.box.y1 <= band.fromY || moved!.cue.spec.box.y0 >= band.toY).toBe(true)

  // with the subtitles from 0.76 too, nowhere is clear of all three: it keeps off the face and the text and sits on the subtitles
  const [squeezed] = inForce([CUE], { keepClearIn: () => [face], textIn: () => [text], captionsFromY: 0.76 }).kept
  expect(rounded(squeezed!.cue.spec.box)).toEqual({ x0: 0.1, y0: 0.64, x1: 0.9, y1: 0.84 })
  // a box clear of everything stays put
  const low = { ...CUE, spec: { ...SPEC, box: { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.7 } } }
  expect(inForce([low], { keepClearIn: () => [face], captionsFromY: 0.76 }).kept[0]!.cue).toBe(low)
})

test("the face and the text are never covered: when they leave no room but the subtitles' the box sits there, and when they leave none at all it is dropped", () => {
  const face = { fromY: 0.1, toY: 0.45 }
  const tall = { ...CUE, spec: { ...SPEC, box: { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.48 } } }
  // text placed under the face, right above the subtitles' room: off the face alone it lands on the text, off both on the subtitles
  const [onSubtitles] = inForce([tall], { keepClearIn: () => [face], textIn: () => [{ fromY: 0.62, toY: 0.76 }], captionsFromY: 0.76 }).kept
  expect(rounded(onSubtitles!.cue.spec.box)).toEqual({ x0: 0.1, y0: 0.78, x1: 0.9, y1: 0.96 })

  // text reaching down to 0.9: nothing is clear of the face and the text together
  const crowded = { keepClearIn: () => [face], textIn: () => [{ fromY: 0.5, toY: 0.9 }], captionsFromY: 0.76 }
  expect(inForce([tall], crowded)).toEqual({ kept: [], dropped: 1, off: [] })
  // one switched off there is not counted, and is still listed, where it was stored, to be switched back on
  const off = { ...tall, off: true }
  expect(inForce([off], crowded)).toEqual({ kept: [], dropped: 0, off: [{ cue: off, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: [], stale: false }] })
})

test("a graphic ends where the piece playing its sentence does, when that comes before its seconds run out, but never plays shorter than 1.5 s", () => {
  // CUE plays from 2.0 s for 3 s
  const lasting = (pieceEndUs: number | null) => inForce([CUE], { pieceEndOf: () => pieceEndUs }).kept.map((graphic) => graphic.durationUs)
  expect(lasting(4_000_000)).toEqual([2_000_000])
  expect(lasting(9_000_000)).toEqual([3_000_000])
  expect(lasting(null)).toEqual([3_000_000])
  // a piece that leaves less than the shortest a graphic may be: it still plays that long, running on into
  // the next piece, and keeps clear of what is on screen there too
  expect(lasting(2_500_000)).toEqual([1_500_000])
  // the piece is asked for by the graphic's own anchor, and the switched-off ones are cut the same way
  const asked: CueAnchor[] = []
  const off = { ...CUE, off: true }
  expect(inForce([off], { pieceEndOf: (anchor) => (asked.push(anchor), 4_000_000) }).off.map((graphic) => graphic.durationUs)).toEqual([2_000_000])
  expect(asked).toEqual([CUE.anchor])
})

test("the box keeps clear of every face and every highlight text on screen at any time while it plays, not only at its first moment", () => {
  const spans: { startUs: number; endUs: number }[] = []
  const face = { fromY: 0.1, toY: 0.45 }
  const later = { fromY: 0.5, toY: 0.62 }
  const [kept] = inForce([CUE], {
    pieceEndOf: () => 4_000_000,
    keepClearIn: (span) => (spans.push(span), [face]),
    textIn: (span) => (spans.push(span), span.endUs > 3_000_000 ? [later] : []),
  }).kept
  // both are asked for the span it really plays: 2.0 s on, to the end of its piece
  expect(spans).toEqual([{ startUs: 2_000_000, endUs: 4_000_000 }, { startUs: 2_000_000, endUs: 4_000_000 }])
  // off the face alone it would sit on the text that comes up at 3 s
  expect(rounded(kept!.cue.spec.box)).toEqual({ x0: 0.1, y0: 0.64, x1: 0.9, y1: 0.84 })
})

test("the highlight text a graphic must keep clear of is every group on screen at any time over its span", () => {
  const band = (fromY: number, startUs: number, endUs: number) => ({ groupId: `g${startUs}`, videoId: "v", beatId: "b1", words: { from: 0, to: 1 }, band: { fromY, toY: fromY + 0.1 }, startUs, endUs })
  const bands = [band(0.1, 0, 1_000_000), band(0.3, 1_500_000, 3_000_000), band(0.5, 4_000_000, 5_000_000), band(0.7, 5_000_000, 6_000_000)]
  // on screen 1.0–5.0 s: the group showing 1.5–3.0 s and the one showing 4.0–5.0 s; one gone at 1.0 s or come at 5.0 s is not
  expect(textBandsIn(bands, { startUs: 1_000_000, endUs: 5_000_000 })).toEqual([{ fromY: 0.3, toY: 0.4 }, { fromY: 0.5, toY: 0.6 }])
  expect(textBandsIn(bands, { startUs: 3_000_000, endUs: 4_000_000 })).toEqual([])
  // a group already on screen when the graphic comes up counts too, though it came on before
  expect(textBandsIn(bands, { startUs: 2_000_000, endUs: 3_500_000 })).toEqual([{ fromY: 0.3, toY: 0.4 }])
})

/** A text band on screen from 2.0 s to 5.0 s of the rough cut, while MOTION_CUE plays, drawn by a group of the point named; of the user's own, bound to no point, when none is. */
const textOf = (groupId: string, band: { fromY: number; toY: number }, pointId?: string) => ({ groupId, videoId: "v", beatId: "b1", words: { from: 3, to: 5 }, band, startUs: 2_000_000, endUs: 5_000_000, ...(pointId !== undefined ? { pointId } : {}) })

test("a text band knows the point its group was made for, and the text on screen over a span can be asked for less one point's", () => {
  const groups = [{ ...placed("g1", { from: 0, to: 2 }), pointId: "p1" }, placed("g2", { from: 3, to: 4 })]
  const laid = bandsOf("top", false, groups)
  expect(laid.map((entry) => [entry.groupId, entry.pointId])).toEqual([
    ["g1", "p1"],
    ["g2", undefined],
  ])
  expect(laid[1]).not.toHaveProperty("pointId")
  // two groups of p1 (Claude's, and one the user made on the point), one of p2, and the user's own, bound to no point
  const bands = [textOf("a", { fromY: 0.1, toY: 0.2 }, "p1"), textOf("b", { fromY: 0.3, toY: 0.4 }, "p1"), textOf("c", { fromY: 0.5, toY: 0.6 }, "p2"), textOf("d", { fromY: 0.7, toY: 0.8 })]
  const span = { startUs: 2_000_000, endUs: 4_000_000 }
  const tops = (pointId?: string) => textBandsIn(bands, span, pointId).map((band) => band.fromY)
  expect(tops()).toEqual([0.1, 0.3, 0.5, 0.7])
  // every group of the point named is left out, and no other: text bound to no point is never left out
  expect(tops("p1")).toEqual([0.5, 0.7])
  expect(tops("p2")).toEqual([0.1, 0.3, 0.7])
  // a point with no text leaves none out
  expect(tops("p9")).toEqual([0.1, 0.3, 0.5, 0.7])
  // and a group off screen over the span is still not there
  expect(textBandsIn(bands, { startUs: 5_000_000, endUs: 6_000_000 }, "p1")).toEqual([])
})

test("a graphic is not pushed away by the highlight text of its own point, which it takes the place of; it keeps off another point's text and off text bound to no point, and one bound to no point keeps off all text", () => {
  // MOTION_CUE is planned at 0.3–0.5 of the height and plays from 2.0 s for 3 s; p1's text is drawn over 0.25–0.55 meanwhile
  const own = textOf("g1", { fromY: 0.25, toY: 0.55 }, "p1")
  const onPoint = (pointId?: string): GraphicCue => ({ ...MOTION_CUE, ...(pointId !== undefined ? { pointId } : {}) })
  const placing = (cue: GraphicCue, bands: ReturnType<typeof textOf>[]) => inForce([cue], { textIn: (span, pointId) => textBandsIn(bands, span, pointId), wordsFrom: AS_WRITTEN })
  const boxOf = (cue: GraphicCue, bands: ReturnType<typeof textOf>[]) => rounded(placing(cue, bands).kept[0]!.cue.spec.box)
  const below = { x0: 0.1, y0: 0.57, x1: 0.9, y1: 0.77 }
  // on its own point's text it stays where it was planned: its cue is the stored one, so its render is the one of its plan
  const mine = onPoint("p1")
  expect(placing(mine, [own]).kept[0]!.cue).toBe(mine)
  // the same text, made for another point, pushes it below
  expect(boxOf(onPoint("p2"), [own])).toEqual(below)
  // a graphic bound to no point keeps off all text
  expect(boxOf(onPoint(), [own])).toEqual(below)
  // text bound to no point, the user's own, is kept off by every graphic
  expect(boxOf(mine, [textOf("g1", own.band)])).toEqual(below)
  // beside its own text, another point's that comes up at 0.45–0.6 while it plays still moves it: above that, over its own
  const others = textOf("g2", { fromY: 0.45, toY: 0.6 }, "p2")
  expect(boxOf(mine, [own, others])).toEqual({ x0: 0.1, y0: 0.23, x1: 0.9, y1: 0.43 })
  // one bound to no point there keeps off both
  expect(boxOf(onPoint(), [own, others])).toEqual({ x0: 0.1, y0: 0.62, x1: 0.9, y1: 0.82 })
  // the text is asked for with the graphic's point, once, for the span it plays: a switched-off one the same
  const asked: [{ startUs: number; endUs: number }, string | undefined][] = []
  inForce([mine, { ...onPoint("p2"), anchor: speech(15_000_000, "b1"), off: true }, { ...onPoint(), anchor: speech(20_000_000, "b1") }], { textIn: (span, pointId) => (asked.push([span, pointId]), []), wordsFrom: AS_WRITTEN })
  expect(asked).toEqual([
    [{ startUs: 2_000_000, endUs: 5_000_000 }, "p1"],
    [{ startUs: 5_000_000, endUs: 8_000_000 }, "p2"],
    [{ startUs: 10_000_000, endUs: 13_000_000 }, undefined],
  ])
  // with nowhere clear of another point's text and the face it is dropped, as before; its own text never drops it
  const face = { fromY: 0.1, toY: 0.45 }
  expect(inForce([mine], { keepClearIn: () => [face], textIn: (span, pointId) => textBandsIn([textOf("g1", { fromY: 0.5, toY: 0.9 }, "p2")], span, pointId), captionsFromY: 0.76 })).toMatchObject({ kept: [], dropped: 1 })
  expect(inForce([mine], { keepClearIn: () => [face], textIn: (span, pointId) => textBandsIn([textOf("g1", { fromY: 0.5, toY: 0.9 }, "p1")], span, pointId), captionsFromY: 0.76 }).kept).toHaveLength(1)
})

test("a group's text band says when it is on screen", () => {
  expect(bandsOf("top", false).map((entry) => [entry.startUs, entry.endUs])).toEqual([[0, 1_200_000]])
})

test("the bands to keep clear over a span are those of every scene any piece plays inside it, across cuts", () => {
  const clips = [
    {
      id: "v",
      insight: {
        scenes: [
          { startUs: 0, endUs: 11_200_000, description: "หน้า", kind: "talking-head", issues: [], keepClear: { fromY: 0.1, toY: 0.45 } },
          { startUs: 11_200_000, endUs: 15_500_000, description: "มือ", kind: "b-roll", issues: [], keepClear: null },
          { startUs: 15_500_000, endUs: 20_000_000, description: "สินค้า", kind: "product", issues: [], keepClear: { fromY: 0.5, toY: 0.9 } },
        ],
      },
    },
  ] as unknown as CutClip[]
  // 10–12 s of the source plays at 0–2 s, then 15–18 s at 2–5 s
  const plan = { beats: [], cuts: [{ binId: "v", sourceStartUs: 10_000_000, sourceDurationUs: 2_000_000 }, { binId: "v", sourceStartUs: 15_000_000, sourceDurationUs: 3_000_000 }], durationUs: 5_000_000 } as unknown as CutPlan
  // 1–3 s plays 11–12 s (the face, then the hands) and 15–16 s (the hands, then the product)
  expect(keepClearsIn(plan, clips, { startUs: 1_000_000, endUs: 3_000_000 })).toEqual([{ fromY: 0.1, toY: 0.45 }, { fromY: 0.5, toY: 0.9 }])
  expect(keepClearsIn(plan, clips, { startUs: 0, endUs: 1_000_000 })).toEqual([{ fromY: 0.1, toY: 0.45 }])
  // 2.2–2.4 s is the hands alone, which keep nothing clear
  expect(keepClearsIn(plan, clips, { startUs: 2_200_000, endUs: 2_400_000 })).toEqual([])
  // 1.5–2.0 s plays 11.5–12 s, the hands alone: the face the piece opened on is over by then
  expect(keepClearsIn(plan, clips, { startUs: 1_500_000, endUs: 2_000_000 })).toEqual([])
  // past the end of the rough cut there is nothing
  expect(keepClearsIn(plan, clips, { startUs: 6_000_000, endUs: 7_000_000 })).toEqual([])
})

test("a graphic whose sentence is cut away is not in force and counts, unless it was switched off", () => {
  expect(inForce([LATE_CUE])).toEqual({ kept: [], dropped: 1, off: [] })
  expect(inForce([{ ...LATE_CUE, off: true }])).toEqual({ kept: [], dropped: 0, off: [] })
})

test("switched-off graphics whose place is still there are listed apart, placed and dodged like the rest", () => {
  const off = { ...CUE, anchor: speech(15_000_000, "b1"), off: true }
  const result = inForce([CUE, off], { keepClearIn: () => [{ fromY: 0.1, toY: 0.45 }] })
  expect(result.kept.map((graphic) => graphic.cue.anchor)).toEqual([CUE.anchor])
  expect(result.off.map((graphic) => [graphic.cue.anchor, graphic.cue.off, graphic.atUs, graphic.durationUs, rounded(graphic.cue.spec.box)])).toEqual([
    [off.anchor, true, 5_000_000, 3_000_000, { x0: 0.1, y0: 0.47, x1: 0.9, y1: 0.67 }],
  ])
  expect(result.dropped).toBe(0)
})

test("with the switch off nothing is in force; at every level each plays, whatever the old switch for all flair says", () => {
  expect(inForce([CUE, { ...CUE, off: true }], { flair: { ...ON, graphic: false } })).toEqual({ kept: [], dropped: 0, off: [] })
  expect(inForce([CUE], { flair: { ...ON, enabled: false, level: "light" } }).kept.map((graphic) => graphic.atUs)).toEqual([2_000_000])
})

test("a graphic on an emphasis point the level hides is neither in force, listed as off, nor dropped", () => {
  const hidden: GraphicCue = { ...CUE, pointId: "p" }
  const hiddenOff: GraphicCue = { ...CUE, anchor: speech(15_000_000, "b1"), off: true, pointId: "p" }
  const hiddenGone: GraphicCue = { ...CUE, anchor: speech(30_000_000, "b1"), pointId: "p" }
  const shown: GraphicCue = { ...CUE, anchor: speech(20_000_000, "b1"), pointId: "q" }
  const result = inForce([hidden, hiddenOff, hiddenGone, shown], { passes: (id) => id !== "p" })
  expect(result.kept.map((graphic) => graphic.cue.anchor)).toEqual([shown.anchor])
  expect([result.off, result.dropped]).toEqual([[], 0])
})

test("a graphic whose own moment the cut took out plays where its point starts now, lasts by the sentence there, and is shown there with its stored anchor", () => {
  // p1 starts at 11.5 s of the source now; a moment at 30 s has no place of its own
  const start = speech(11_500_000, "b1")
  const byPoint = (anchor: CueAnchor, pointId?: string): ItemPlace | null => place(anchor) ?? (pointId === "p1" ? { ...place(start)!, what: "ที่จุดเน้น", by: start } : null)
  const asked: CueAnchor[] = []
  const moved: GraphicCue = { ...CUE, anchor: speech(30_000_000, "b1"), pointId: "p1" }
  const result = inForce([moved, { ...moved, pointId: "p2" }], { place: byPoint, pieceEndOf: (anchor) => (asked.push(anchor), 3_000_000) })
  expect(result.kept.map((graphic) => [graphic.cue.anchor, graphic.atUs, graphic.durationUs])).toEqual([[moved.anchor, 1_500_000, 1_500_000]])
  // the one whose point is not placed has nowhere to play
  expect(result.dropped).toBe(1)
  expect(asked).toEqual([start])
  expect(graphicViews(result, byPoint)).toMatchObject([{ anchor: moved.anchor, atUs: 1_500_000, what: "ที่จุดเน้น", pointId: "p1" }])
})

test("the screen is told which point a graphic was made for; one bound to none says nothing", () => {
  const [bound, free] = graphicViews(inForce([{ ...CUE, pointId: "p1" }, { ...CUE, anchor: speech(17_000_000, "b1") }]), place)
  expect(bound!.pointId).toBe("p1")
  expect(free).not.toHaveProperty("pointId")
})

test("a job for the renderer carries the spec, the frame, the style in force and the times its words are said at", () => {
  const [kept] = inForce([MOTION_CUE], { wordsFrom: AS_WRITTEN }).kept
  expect(graphicJob(kept!, { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES["bold-white"] })).toEqual({
    spec: MOTION,
    canvas: PORTRAIT,
    fps: 30,
    font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" },
    palette: HIGHLIGHT_STYLES["bold-white"].palette,
    times: [0, 0.5],
  })
  expect(graphicJob(kept!, { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES["cute-pink"] })!.font).toEqual({ family: "Mali", file: "Mali-Bold.ttf" })
  expect(graphicJob(kept!, { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES.headline })!.font).toEqual({ family: "Chonburi", file: "Chonburi-Regular.ttf" })
})

test("a written motion graphic that is not stale gets a job: its spec as placed, as long as it was written for, with the times its words are said at now", () => {
  const args = { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES["cute-pink"] }
  // moved off the face, its second word said later than when it was written, and the rough cut ending 0.04 s before its 3 s are up
  const [kept] = inForce([MOTION_CUE], { keepClearIn: () => [{ fromY: 0.1, toY: 0.45 }], wordsFrom: said(["ล้าน", 0], ["สองแสน", 0.72]), durationUs: 4_960_000 }).kept
  expect([kept!.durationUs, kept!.stale]).toEqual([2_960_000, false])
  const job = graphicJob(kept!, args)!
  expect(job).toEqual({
    spec: { ...MOTION, box: kept!.cue.spec.box },
    canvas: PORTRAIT,
    fps: 30,
    font: { family: "Mali", file: "Mali-Bold.ttf" },
    palette: HIGHLIGHT_STYLES["cute-pink"].palette,
    times: [0, 0.72],
  })
  expect(rounded(job.spec.box)).toEqual({ x0: 0.1, y0: 0.47, x1: 0.9, y1: 0.67 })
  // never made shorter: the times typed into its fragment are for the length it was written for
  expect(job.spec.seconds).toBe(3)
  // drawn in the font and colours of the style in force
  expect(graphicJob(kept!, { ...args, style: HIGHLIGHT_STYLES["bold-white"] })).toMatchObject({ font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, palette: HIGHLIGHT_STYLES["bold-white"].palette })
  // one written for no words, as on a scene point, has no times
  const [wordless] = inForce([{ ...MOTION_CUE, spec: { ...MOTION, words: [] } }], { wordsFrom: said() }).kept
  expect(graphicJob(wordless!, args)!.times).toEqual([])
})

test("a motion graphic that is stale, or not written yet, has no job: there is nothing to render until it is written again", () => {
  const args = { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES["bold-white"] }
  // its words changed
  const [reworded] = inForce([MOTION_CUE], { wordsFrom: said(["ล้าน", 0]) }).kept
  expect(graphicJob(reworded!, args)).toBeNull()
  // it plays a second short of what it was written for
  const [short] = inForce([MOTION_CUE], { wordsFrom: AS_WRITTEN, pieceEndOf: () => 4_000_000 }).kept
  expect(graphicJob(short!, args)).toBeNull()
  // not written yet, whether or not a writing failed: there is no fragment to render
  const unwritten = inForce([{ ...MOTION_CUE, spec: { ...MOTION, html: null } }, { ...MOTION_CUE, anchor: speech(20_000_000, "b1"), spec: { ...MOTION, html: null, failed: "nothing was drawn: every frame is empty" } }], { wordsFrom: AS_WRITTEN }).kept
  expect(unwritten.map((graphic) => graphicJob(graphic, args))).toEqual([null, null])
  // the same graphic, written and fresh, has one
  const [fresh] = inForce([MOTION_CUE], { wordsFrom: AS_WRITTEN }).kept
  expect(graphicJob(fresh!, args)).toMatchObject({ spec: MOTION, times: [0, 0.5] })
  // one that was never judged has none either: only a piece found fresh where it was placed is rendered
  expect(graphicJob({ cue: MOTION_CUE, atUs: 2_000_000, durationUs: 3_000_000 }, args)).toBeNull()
  expect(graphicJob({ cue: MOTION_CUE, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: MOTION.words }, args)).toBeNull()
  expect(graphicJob({ cue: MOTION_CUE, atUs: 2_000_000, durationUs: 3_000_000, wordsNow: MOTION.words, stale: false }, args)).toMatchObject({ times: [0, 0.5] })
})

test("a kept graphic takes the place of its point's highlight text when it is made for a point, written and fresh, which is when it has a render job; the replaced points are read from the graphics kept", () => {
  const args = { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES["bold-white"] }
  const at = (seconds: number, pointId: string | undefined, over: Partial<GraphicCue> = {}): GraphicCue => ({ ...MOTION_CUE, anchor: speech(seconds * 1_000_000, "b1"), ...(pointId !== undefined ? { pointId } : {}), ...over })
  const fresh = at(12, "p1")
  const unwritten = at(14, "p2", { spec: { ...MOTION, html: null } })
  const failed = at(16, "p3", { spec: { ...MOTION, html: null, failed: "nothing was drawn: every frame is empty" } })
  const older = at(18, "p4", { spec: { ...MOTION, version: "motion-2026-01-01" } })
  const free = at(20, undefined)
  const off = at(22, "p5", { off: true })
  const hidden = at(24, "p6")
  const placed = inForce([fresh, unwritten, failed, older, free, off, hidden, at(30, "p7")], { wordsFrom: AS_WRITTEN, passes: (id) => id !== "p6" })
  // kept: the fresh one, the one not written yet, the one whose writing failed, the stale one and the one made for no point
  expect(placed.kept.map((graphic) => [graphic.cue.pointId, replacesText(graphic)])).toEqual([
    ["p1", true],
    ["p2", false],
    ["p3", false],
    ["p4", false],
    [undefined, false],
  ])
  // switched off, hidden by the level, or with no place on the cut, a graphic is not kept, so its point's text stays
  expect([...replacedPoints(placed)]).toEqual(["p1"])
  // it is the condition of a render job, for a graphic made for a point
  for (const graphic of placed.kept) expect(replacesText(graphic)).toBe(graphic.cue.pointId !== undefined && graphicJob(graphic, args) !== null)
  // stale over a word cut from under it: its text is drawn again
  expect([...replacedPoints(inForce([fresh], { wordsFrom: said(["ล้าน", 0]) }))]).toEqual([])
  // dropped for lack of room: its text stays too
  expect([...replacedPoints(inForce([fresh], { keepClearIn: () => [{ fromY: 0, toY: 1 }], wordsFrom: AS_WRITTEN }))]).toEqual([])
  // with the graphics switched off none is kept
  expect([...replacedPoints(inForce([fresh], { flair: { ...ON, graphic: false }, wordsFrom: AS_WRITTEN }))]).toEqual([])
  // one that was never judged where it was placed replaces nothing, as it has no job
  expect(replacesText({ cue: fresh, atUs: 2_000_000, durationUs: 3_000_000 })).toBe(false)
  // two graphics of one point, and graphics of two points
  expect([...replacedPoints(inForce([fresh, at(20, "p1"), at(22, "p2")], { wordsFrom: AS_WRITTEN }))]).toEqual(["p1", "p2"])
})

test("a group is replaced when it was made for a replaced point; one bound to no point never is", () => {
  const points = new Set(["p1"])
  expect(isReplaced({ pointId: "p1" }, points)).toBe(true)
  expect(isReplaced({ pointId: "p2" }, points)).toBe(false)
  expect(isReplaced({}, points)).toBe(false)
  expect(isReplaced({ pointId: "p1" }, new Set())).toBe(false)
})

test("an entry of the stored graphics that is no graphic at all is left out like one of another kind: null, or with no place", () => {
  // what an outline file may hold is outside the type
  const broken = [null, { spec: MOTION, edited: true, off: false }, { ...MOTION_CUE, anchor: null }, "graphic"] as unknown as GraphicCue[]
  const asked: string[] = []
  const watching = {
    place: (anchor: CueAnchor) => (asked.push("place"), place(anchor)),
    pieceEndOf: () => (asked.push("pieceEndOf"), null),
    keepClearIn: () => (asked.push("keepClearIn"), []),
    textIn: () => (asked.push("textIn"), []),
  }
  // neither placed, listed as off, nor counted as dropped, and nothing is asked about them
  expect(inForce(broken, watching)).toEqual({ kept: [], dropped: 0, off: [] })
  expect(asked).toEqual([])
  // the graphics beside them are placed as if they were not there
  const beside = inForce([broken[0]!, MOTION_CUE, broken[1]!, SECOND_CUE, broken[2]!], { wordsFrom: AS_WRITTEN })
  expect(beside).toEqual(inForce([MOTION_CUE, SECOND_CUE], { wordsFrom: AS_WRITTEN }))
  expect(graphicViews(beside, place).map((view) => view.anchor)).toEqual([MOTION_CUE.anchor, SECOND_CUE.anchor])
  // nor are they shown to Claude as the user's own
  const points = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1"), pointOn(SENTENCES[1]!, "p2")], sentences: SENTENCES, clips: CLIPS, bands: [] })
  expect(existingGraphics([...broken, { ...MOTION_CUE, edited: true, pointId: "p2" }], points)).toEqual([{ point: 2, summary: MOTION.idea, off: false }])
})

test("a length in microseconds is written and rendered for as seconds to the millisecond below", () => {
  expect(renderSeconds(3_000_000)).toBe(3)
  expect(renderSeconds(2_133_333)).toBe(2.133)
  // never rounded up: 1.235 s would run past where it is cut
  expect(renderSeconds(1_234_567)).toBe(1.234)
  expect(renderSeconds(1_700_000)).toBe(1.7)
})

test("the views list the switched-off graphics after the ones that play, so they can be switched back on", () => {
  // the one switched off plays earlier, and is still listed last
  const views = graphicViews(inForce([CUE, { ...CUE, anchor: speech(11_000_000, "b1"), off: true }]), place)
  expect(views.map((view) => [view.atUs, view.off])).toEqual([
    [2_000_000, false],
    [1_000_000, true],
  ])
})

test("the view of a graphic says where it plays and what it is", () => {
  expect(graphicViews(inForce([{ ...CUE, edited: true }]), place)).toEqual([
    {
      anchor: CUE.anchor,
      atUs: 2_000_000,
      durationUs: 3_000_000,
      what: "ที่ “ล้านสองแสน”",
      beatId: "b1",
      why: "ตัวเลขยอดขาย",
      summary: "ตัวเลขวิ่งถึง 1,200,000 แล้วคำว่า บาท เด้งขึ้น",
      spec: SPEC,
      written: false,
      stale: false,
      writeFailed: null,
      instruction: null,
      editFailed: null,
      canUndo: false,
      edited: true,
      off: false,
    },
  ])
})

test("the view of a motion graphic is summed up by its idea, names the words it sits on, and says whether it is written, whether it is stale, and why its last writing failed", () => {
  const failure = "it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D"
  const unwritten: GraphicCue = { ...MOTION_CUE, anchor: speech(17_000_000, "b1"), spec: { ...MOTION, html: null } }
  const failed: GraphicCue = { ...MOTION_CUE, anchor: speech(20_000_000, "b1"), spec: { ...MOTION, html: null, failed: failure }, off: true }
  const [fresh, waiting, off] = graphicViews(inForce([MOTION_CUE, unwritten, failed], { wordsFrom: AS_WRITTEN }), place)
  expect(fresh).toEqual({
    anchor: MOTION_CUE.anchor,
    atUs: 2_000_000,
    durationUs: 3_000_000,
    what: "ที่ “ล้านสองแสน”",
    beatId: "b1",
    why: "ตัวเลขยอดขาย",
    summary: "ตัวเลขวิ่งถึง 1,200,000 แล้วคำว่า บาท เด้งขึ้น",
    spec: MOTION,
    written: true,
    stale: false,
    writeFailed: null,
    instruction: null,
    editFailed: null,
    canUndo: false,
    edited: false,
    off: false,
  })
  // not written yet: no writing has failed, and it is not stale
  expect(waiting).toMatchObject({ atUs: 7_000_000, summary: MOTION.idea, written: false, stale: false, writeFailed: null, off: false })
  // its last writing failed: the view says why, switched off or not
  expect(off).toMatchObject({ atUs: 10_000_000, summary: MOTION.idea, written: false, stale: false, writeFailed: failure, off: true })
  // written, and stale now that a word of it is cut
  expect(graphicViews(inForce([MOTION_CUE], { wordsFrom: said(["ล้าน", 0]) }), place)).toMatchObject([{ summary: MOTION.idea, what: "ที่ “ล้านสองแสน”", written: true, stale: true, writeFailed: null }])
})

test("a graphic is summed up by its idea, written or not, on the screen and in what Claude is told of the user's own graphics", () => {
  const unwritten: GraphicCue = { ...MOTION_CUE, anchor: speech(17_000_000, "b1"), spec: { ...MOTION, html: null, failed: "nothing was drawn: every frame is empty" } }
  expect(graphicViews(inForce([MOTION_CUE, unwritten], { wordsFrom: AS_WRITTEN }), place).map((view) => view.summary)).toEqual([MOTION.idea, MOTION.idea])
  const points = graphicPoints({ points: [pointOn(SENTENCES[0]!, "p1"), pointOn(SENTENCES[1]!, "p2")], sentences: SENTENCES, clips: CLIPS, bands: [] })
  expect(existingGraphics([{ ...MOTION_CUE, edited: true, pointId: "p2" }, { ...MOTION_CUE, edited: true, off: true, pointId: "p1" }], points)).toEqual([
    { point: 2, summary: MOTION.idea, off: false },
    { point: 1, summary: MOTION.idea, off: true },
  ])
})
