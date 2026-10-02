import { expect, test } from "vitest"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import { frameKey } from "@boxblack/core/graphics/motion/points"
import { COVER_MAX_US, FREE_GRAPHIC_MIN_US, MOTION_VERSION, type GraphicBox, type GraphicCue, type GraphicSpec, type MotionSpec } from "@boxblack/core/graphics/plan"
import type { PlacedGroup, TimedGroup } from "@boxblack/core/highlights"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import {
  framesWanted,
  graphicJob,
  graphicPoints,
  graphicsInForce,
  admitFree,
  boxesOverlap,
  graphicViews,
  isReplaced,
  keepBoxesIn,
  keepClearsIn,
  renderSeconds,
  replacedPoints,
  replacesText,
  roomOf,
  scenesOnCut,
  sentenceOf,
  textBands,
  textBandsIn,
  wordsSaidFrom,
  zoomedFaces,
} from "./graphics-cues.ts"
import type { ItemPlace } from "./insert-media.ts"
import type { Pose } from "@boxblack/core/flair/moves"
import { OBJECTS_VERSION } from "@boxblack/core/vision"
import type { PlacedMove } from "./move-cues.ts"
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

const ON: FlairOptions = { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: true }
/** Each graphic plays 10 s before its source time; one at 30 s of the source has no place on the cut. */
const place = (anchor: CueAnchor): ItemPlace | null => (anchor.kind === "speech" && anchor.sourceUs < 25_000_000 ? { atUs: anchor.sourceUs - 10_000_000, what: "ที่ “ล้านสองแสน”", beatId: "b1", by: anchor } : null)
/** A box's edges to the millionth, so the sums of shares compare cleanly. */
const rounded = (box: GraphicSpec["box"]) => Object.fromEntries(Object.entries(box).map(([edge, value]) => [edge, Number(value.toFixed(6))]))
const inForce = (graphics: GraphicCue[], over: Partial<Parameters<typeof graphicsInForce>[0]> = {}) =>
  graphicsInForce({
    graphics,
    place,
    flair: ON,
    durationUs: 60_000_000,
    passes: () => true,
    pieceEndOf: () => null,
    keepClearIn: () => [],
    textIn: () => [],
    room: { textIn: () => [], ownTextIn: () => [], keepIn: () => [] },
    pointPlaced: () => true,
    wordsFrom: () => [],
    captionsFromY: null,
    ...over,
  })

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
  // nor are they listed on the screen
  expect(graphicViews(beside, place).map((view) => view.anchor)).toEqual([MOTION_CUE.anchor, SECOND_CUE.anchor])
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
      from: null,
      replaces: false,
      coversKeep: false,
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
    from: null,
    // a legacy graphic made for no point takes no text's place
    replaces: false,
    coversKeep: false,
  })
  // not written yet: no writing has failed, and it is not stale
  expect(waiting).toMatchObject({ atUs: 7_000_000, summary: MOTION.idea, written: false, stale: false, writeFailed: null, off: false })
  // its last writing failed: the view says why, switched off or not
  expect(off).toMatchObject({ atUs: 10_000_000, summary: MOTION.idea, written: false, stale: false, writeFailed: failure, off: true })
  // written, and stale now that a word of it is cut
  expect(graphicViews(inForce([MOTION_CUE], { wordsFrom: said(["ล้าน", 0]) }), place)).toMatchObject([{ summary: MOTION.idea, what: "ที่ “ล้านสองแสน”", written: true, stale: true, writeFailed: null }])
})

test("a graphic whose stored failure, change or failed edit is no text (an outline edited by hand may hold anything) shows none of them", () => {
  for (const odd of [7, { why: "nothing was drawn" }]) {
    const cue: GraphicCue = { ...MOTION_CUE, spec: { ...MOTION, failed: odd, instruction: odd, editFailed: odd } as unknown as MotionSpec }
    expect(graphicViews(inForce([cue], { wordsFrom: AS_WRITTEN }), place), JSON.stringify(odd)).toMatchObject([{ written: true, writeFailed: null, instruction: null, editFailed: null }])
  }
  // text is shown as it is stored
  const said: GraphicCue = { ...MOTION_CUE, spec: { ...MOTION, failed: "a", instruction: "b", editFailed: "c" } }
  expect(graphicViews(inForce([said], { wordsFrom: AS_WRITTEN }), place)).toMatchObject([{ writeFailed: "a", instruction: "b", editFailed: "c" }])
})

test("a graphic is summed up on the screen by its idea, written or not", () => {
  const unwritten: GraphicCue = { ...MOTION_CUE, anchor: speech(17_000_000, "b1"), spec: { ...MOTION, html: null, failed: "nothing was drawn: every frame is empty" } }
  expect(graphicViews(inForce([MOTION_CUE, unwritten], { wordsFrom: AS_WRITTEN }), place).map((view) => view.summary)).toEqual([MOTION.idea, MOTION.idea])
})

/* free graphics */

const box = (x0: number, y0: number, x1: number, y1: number): GraphicBox => ({ x0, y0, x1, y1 })
const FACE = box(0.3, 0.1, 0.7, 0.45)
const SHOWN = box(0.2, 0.6, 0.5, 0.9)
const POINTED = box(0.6, 0.6, 0.9, 0.9)

/**
 * Clip "a" with its objects found: a face and a thing pointed at in its first scene, a shown thing in its second. Clip "b"
 * with no objects pass yet: a face band in its first scene, and nothing to keep clear in its second.
 */
const OBJECT_CLIPS = [
  {
    id: "a",
    insight: {
      scenes: [
        { startUs: 0, endUs: 10_000_000, description: "คนพูด", kind: "talking-head", issues: [], keepClear: { fromY: 0.1, toY: 0.4 } },
        { startUs: 10_000_000, endUs: 20_000_000, description: "ถือสินค้า", kind: "product", issues: [], keepClear: { fromY: 0.5, toY: 0.9 } },
      ],
    },
    objects: {
      version: "objects-2026-10-01",
      scenes: [
        [
          { what: "หน้า", kind: "keep", box: FACE, still: false },
          { what: "แก้ว", kind: "point", box: POINTED, still: true },
        ],
        [{ what: "กล่อง", kind: "keep", box: SHOWN, still: true }],
      ],
    },
  },
  {
    id: "b",
    insight: {
      scenes: [
        { startUs: 0, endUs: 10_000_000, description: "หน้าตรง", kind: "talking-head", issues: [], keepClear: { fromY: 0.5, toY: 0.9 } },
        { startUs: 10_000_000, endUs: 20_000_000, description: "มือ", kind: "b-roll", issues: [], keepClear: null },
      ],
    },
    objects: null,
  },
] as unknown as CutClip[]

test("the boxes to keep clear over a span are the keep objects of every scene played in it, or a scene's keepClear band across the frame when its video has no objects", () => {
  // 5–15 s of a plays at 0–10 s, then 5–15 s of b at 10–20 s
  const plan = { beats: [], cuts: [{ binId: "a", sourceStartUs: 5_000_000, sourceDurationUs: 10_000_000 }, { binId: "b", sourceStartUs: 5_000_000, sourceDurationUs: 10_000_000 }], durationUs: 20_000_000 } as unknown as CutPlan
  // both scenes of a: the face and the shown thing, and never the thing pointed at, nor a's keepClear bands
  expect(keepBoxesIn(plan, OBJECT_CLIPS, { startUs: 0, endUs: 10_000_000 })).toEqual([FACE, SHOWN])
  expect(keepBoxesIn(plan, OBJECT_CLIPS, { startUs: 6_000_000, endUs: 7_000_000 })).toEqual([SHOWN])
  // b has no objects: its first scene's band, across the frame
  expect(keepBoxesIn(plan, OBJECT_CLIPS, { startUs: 12_000_000, endUs: 14_000_000 })).toEqual([box(0, 0.5, 1, 0.9)])
  // b's second scene has neither
  expect(keepBoxesIn(plan, OBJECT_CLIPS, { startUs: 16_000_000, endUs: 18_000_000 })).toEqual([])
  // a scene whose objects are only things to point at keeps nothing clear
  const pointing = [{ ...OBJECT_CLIPS[0]!, objects: { version: "objects-2026-10-01", scenes: [[{ what: "แก้ว", kind: "point", box: POINTED, still: true }], []] } }] as unknown as CutClip[]
  expect(keepBoxesIn(plan, pointing, { startUs: 0, endUs: 10_000_000 })).toEqual([])
})

test("the scenes on the cut are each scene a piece plays, timed on the rough cut, with the scene before merged when it goes on", () => {
  // a 2–4 s, a 5–8 s and a 8–12 s play at 0–9 s, all but the last 2 s in a's first scene; b 0–2 s at 9–11 s; a 0–1 s at 11–12 s
  const plan = {
    beats: [],
    cuts: [
      { binId: "a", sourceStartUs: 2_000_000, sourceDurationUs: 2_000_000 },
      { binId: "a", sourceStartUs: 5_000_000, sourceDurationUs: 3_000_000 },
      { binId: "a", sourceStartUs: 8_000_000, sourceDurationUs: 4_000_000 },
      { binId: "b", sourceStartUs: 0, sourceDurationUs: 2_000_000 },
      { binId: "a", sourceStartUs: 0, sourceDurationUs: 1_000_000 },
    ],
    durationUs: 12_000_000,
  } as unknown as CutPlan
  const talking = { kind: "talking-head", description: "คนพูด", keepClear: { fromY: 0.1, toY: 0.4 }, objects: [{ what: "หน้า", kind: "keep", box: FACE, still: false }, { what: "แก้ว", kind: "point", box: POINTED, still: true }] }
  expect(scenesOnCut(plan, OBJECT_CLIPS)).toEqual([
    { startUs: 0, endUs: 7_000_000, ...talking },
    { startUs: 7_000_000, endUs: 9_000_000, kind: "product", description: "ถือสินค้า", keepClear: { fromY: 0.5, toY: 0.9 }, objects: [{ what: "กล่อง", kind: "keep", box: SHOWN, still: true }] },
    // b has no objects pass yet
    { startUs: 9_000_000, endUs: 11_000_000, kind: "talking-head", description: "หน้าตรง", keepClear: { fromY: 0.5, toY: 0.9 }, objects: null },
    // a's first scene again, after another video: an entry of its own
    { startUs: 11_000_000, endUs: 12_000_000, ...talking },
  ])
})

test("boxes overlap only with a positive area on both axes: touching is not overlapping", () => {
  const left = box(0, 0, 0.5, 0.5)
  expect(boxesOverlap(left, box(0.5, 0, 1, 0.5))).toBe(false)
  expect(boxesOverlap(left, box(0, 0.5, 0.5, 1))).toBe(false)
  expect(boxesOverlap(left, box(0.5, 0.5, 1, 1))).toBe(false)
  expect(boxesOverlap(left, box(0.49, 0.49, 1, 1))).toBe(true)
  expect(boxesOverlap(box(0.1, 0.1, 0.2, 0.2), left)).toBe(true)
  // overlapping on one axis only is apart
  expect(boxesOverlap(left, box(0.2, 0.6, 0.4, 0.9))).toBe(false)
  // touching is not overlapping whichever box is named first, on either axis
  expect(boxesOverlap(box(0.5, 0, 1, 0.5), left)).toBe(false)
  expect(boxesOverlap(box(0, 0.5, 0.5, 1), left)).toBe(false)
})

test("two of Claude's free graphics side by side, touching at x, are on screen together: both are admitted, in either order", () => {
  const room = roomWith({})
  const at = (sourceUs: number, x0: number, x1: number): GraphicCue => ({ ...FREE, anchor: speech(sourceUs, "b1"), spec: { ...MOTION, html: null, box: box(x0, 0.6, x1, 0.8) } })
  // the earlier on the left, the later on the right; then the earlier on the right
  for (const [first, second] of [
    [at(12_000_000, 0.1, 0.5), at(12_500_000, 0.5, 0.9)],
    [at(12_000_000, 0.5, 0.9), at(12_500_000, 0.1, 0.5)],
  ]) {
    expect(admitFree([first!, second!], placedOf, room, [])).toEqual({ admitted: [first, second], dropped: 0 })
    // and placed, neither gives way to the other
    expect(inForce([first!, second!], { room }).kept.map((graphic) => graphic.cue)).toEqual([first, second])
  }
})

/** A free graphic on the moment MOTION_CUE plays at (2–5 s of the rough cut, box 0.3–0.5 of the height), written to stay beside its point's text. */
const FREE: GraphicCue = { ...MOTION_CUE, from: "medium", spec: { ...MOTION, replacesText: false } }
/** Text on screen, as the room hands it: a band, and the point its group was made for. */
const textIn =
  (...groups: [number, number, string?][]) =>
  () =>
    groups.map(([fromY, toY, pointId]) => ({ band: { fromY, toY }, ...(pointId !== undefined ? { pointId } : {}) }))
type At = { startUs: number; endUs: number }
/** A room with the text drawn at the level, and the same text as its point's own with every point shown unless told otherwise. */
const roomWith = (over: { textIn?: ReturnType<typeof textIn>; ownTextIn?: (span: At, pointId: string) => { fromY: number; toY: number }[]; keepIn?: (span: At) => GraphicBox[] }) => ({
  textIn: over.textIn ?? (() => []),
  ownTextIn:
    over.ownTextIn ??
    ((_span: At, pointId: string) =>
      (over.textIn?.() ?? []).flatMap((group) => (group.pointId === pointId ? [group.band] : []))),
  keepIn: over.keepIn ?? (() => []),
})

test("a free graphic's room: another point's text, or text bound to none, under its box makes it gone; its own point's makes it covering; a face or a shown thing under it is covered", () => {
  const span = { startUs: 2_000_000, endUs: 5_000_000 }
  const tied = (pointId?: string): GraphicCue => ({ ...FREE, ...(pointId !== undefined ? { pointId } : {}) })
  expect(roomOf(tied("p1"), span, roomWith({ textIn: textIn([0.25, 0.55, "p1"]) }))).toEqual({ gone: false, covering: true, coversKeep: false })
  expect(roomOf(tied("p2"), span, roomWith({ textIn: textIn([0.25, 0.55, "p1"]) }))).toEqual({ gone: true })
  expect(roomOf(tied("p1"), span, roomWith({ textIn: textIn([0.25, 0.55]) }))).toEqual({ gone: true })
  // one tied to no point is gone over any text
  expect(roomOf(tied(), span, roomWith({ textIn: textIn([0.25, 0.55, "p1"]) }))).toEqual({ gone: true })
  // text beside it, touching its edge, is neither
  expect(roomOf(tied("p2"), span, roomWith({ textIn: textIn([0.5, 0.6, "p1"], [0.1, 0.3]) }))).toEqual({ gone: false, covering: false, coversKeep: false })
  expect(roomOf(tied("p1"), span, roomWith({ textIn: textIn([0.5, 0.6, "p1"]) }))).toEqual({ gone: false, covering: false, coversKeep: false })
  // a keep box overlapping it in both directions is covered; one only touching it, or beside it across, is not
  expect(roomOf(tied(), span, roomWith({ keepIn: () => [box(0.4, 0.4, 0.6, 0.6)] }))).toEqual({ gone: false, covering: false, coversKeep: true })
  expect(roomOf(tied(), span, roomWith({ keepIn: () => [box(0.9, 0.3, 1, 0.5), box(0.1, 0.5, 0.9, 0.7)] }))).toEqual({ gone: false, covering: false, coversKeep: false })
  // the room is asked for the span given
  const asked: unknown[] = []
  roomOf(tied("p1"), span, { textIn: (at) => (asked.push(at), []), ownTextIn: (at, pointId) => (asked.push([at, pointId]), []), keepIn: (at) => (asked.push(at), []) })
  expect(asked).toEqual([span, [span, "p1"], span])
  // text bound to no point under a graphic tied to none: gone, not covering
  expect(roomOf(tied(), span, roomWith({ textIn: textIn([0.25, 0.55]) }))).toEqual({ gone: true })
})

test("a free graphic plays from its own level up, whatever its point's importance, and not on a point the cut took away; neither is listed or counted", () => {
  const off: GraphicCue = { ...FREE, anchor: speech(15_000_000, "b1"), off: true }
  const shown = (level: "light" | "medium" | "heavy") => inForce([FREE, off], { flair: { ...ON, level }, wordsFrom: AS_WRITTEN })
  expect(shown("light")).toEqual({ kept: [], dropped: 0, off: [] })
  expect(shown("medium").kept.map((graphic) => graphic.cue)).toEqual([FREE])
  expect(shown("medium").off.map((graphic) => graphic.cue)).toEqual([off])
  expect(shown("heavy").kept.map((graphic) => graphic.cue)).toEqual([FREE])
  // a point the level hides does not hide it: it has a level of its own
  expect(inForce([{ ...FREE, pointId: "p1" }], { passes: () => false, wordsFrom: AS_WRITTEN }).kept).toHaveLength(1)
  // tied to a point not on this cut, it is hidden, switched off or not
  const away = inForce([{ ...FREE, pointId: "gone" }, { ...off, pointId: "gone" }, { ...FREE, anchor: speech(20_000_000, "b1"), pointId: "p1" }], { pointPlaced: (id) => id !== "gone", wordsFrom: AS_WRITTEN })
  expect([away.kept.map((graphic) => graphic.cue.pointId), away.off, away.dropped]).toEqual([["p1"], [], 0])
})

test("a free graphic is never moved: another point's text under it makes it gone and counted, unless it is off; its own point's text makes it covering", () => {
  const other = inForce([{ ...FREE, pointId: "p2" }], { room: roomWith({ textIn: textIn([0.25, 0.55, "p1"]) }), wordsFrom: AS_WRITTEN })
  expect(other).toEqual({ kept: [], dropped: 1, off: [] })
  // switched off it is listed all the same, as a legacy one with no room is, and not counted
  const offOther = inForce([{ ...FREE, pointId: "p2", off: true }], { room: roomWith({ textIn: textIn([0.25, 0.55, "p1"]) }), wordsFrom: AS_WRITTEN })
  expect([offOther.kept, offOther.off.length, offOther.dropped]).toEqual([[], 1, 0])
  // its own point's text: kept where it was stored, covering, and written to stay beside it, so stale and replacing nothing
  const own = inForce([{ ...FREE, pointId: "p1" }], { room: roomWith({ textIn: textIn([0.25, 0.55, "p1"]) }), keepClearIn: () => [{ fromY: 0, toY: 1 }], wordsFrom: AS_WRITTEN })
  expect(own.kept.map((graphic) => [graphic.cue.spec.box, graphic.covering, graphic.coversKeep, graphic.stale, graphic.replaces])).toEqual([[MOTION.box, true, false, true, false]])
  // beside it: not covering
  const beside = inForce([{ ...FREE, pointId: "p1" }], { room: roomWith({ textIn: textIn([0.6, 0.7, "p1"]) }), wordsFrom: AS_WRITTEN })
  expect(beside.kept.map((graphic) => [graphic.covering, graphic.stale, graphic.replaces])).toEqual([[false, false, false]])
})

test("a free graphic over a face or a shown thing plays 1.5 s at most; a keepClear band does the same on a video with no objects", () => {
  const unwritten: GraphicCue = { ...FREE, spec: { ...MOTION, html: null } }
  const over = inForce([unwritten], { room: roomWith({ keepIn: () => [box(0.4, 0.4, 0.6, 0.6)] }) })
  expect(over.kept.map((graphic) => [graphic.durationUs, graphic.coversKeep])).toEqual([[COVER_MAX_US, true]])
  // and the same when it is switched off, which says what it would do switched on
  expect(inForce([{ ...unwritten, off: true }], { room: roomWith({ keepIn: () => [box(0.4, 0.4, 0.6, 0.6)] }) }).off.map((graphic) => [graphic.durationUs, graphic.coversKeep])).toEqual([[COVER_MAX_US, true]])
  // the source plays as it is on the rough cut: v has its face band at 0.1–0.45 until 11.2 s, and no objects; a has a face high in the frame
  const plan = (binId: string) => ({ beats: [], cuts: [{ binId, sourceStartUs: 0, sourceDurationUs: 60_000_000 }], durationUs: 60_000_000 }) as unknown as CutPlan
  const clips = [...CLIPS, { ...OBJECT_CLIPS[0]!, id: "a" }] as CutClip[]
  const keepOf = (binId: string) => roomWith({ keepIn: (span) => keepBoxesIn(plan(binId), clips, span) })
  expect(inForce([unwritten], { room: keepOf("v") }).kept.map((graphic) => [graphic.durationUs, graphic.coversKeep])).toEqual([[COVER_MAX_US, true]])
  // a's face is at 0.1–0.45 across 0.3–0.7 of the width, over the graphic's box: covered too; its second scene's thing is low and not
  expect(inForce([unwritten], { room: keepOf("a") }).kept.map((graphic) => graphic.coversKeep)).toEqual([true])
  expect(inForce([{ ...unwritten, anchor: speech(22_000_000, "b1") }], { room: keepOf("a") }).kept.map((graphic) => [graphic.durationUs, graphic.coversKeep])).toEqual([[3_000_000, false]])
  // nothing kept clear: its whole length
  expect(inForce([unwritten]).kept.map((graphic) => [graphic.durationUs, graphic.coversKeep])).toEqual([[3_000_000, false]])
})

test("of two free graphics on screen together in the same place the later is dropped and counted; in time only, or in place only, both play", () => {
  const later = (sourceUs: number, over: Partial<MotionSpec> = {}): GraphicCue => ({ ...FREE, anchor: speech(sourceUs, "b1"), spec: { ...FREE.spec, ...over } })
  const both = inForce([later(13_000_000), FREE], { wordsFrom: AS_WRITTEN })
  expect([both.kept.map((graphic) => graphic.atUs), both.dropped]).toEqual([[2_000_000], 1])
  const apart = inForce([FREE, later(13_000_000, { box: box(0.1, 0.6, 0.9, 0.8) })], { wordsFrom: AS_WRITTEN })
  expect([apart.kept.map((graphic) => graphic.atUs), apart.dropped]).toEqual([[2_000_000, 3_000_000], 0])
  const afterwards = inForce([FREE, later(15_000_000)], { wordsFrom: AS_WRITTEN })
  expect([afterwards.kept.map((graphic) => graphic.atUs), afterwards.dropped]).toEqual([[2_000_000, 5_000_000], 0])
  // one dropped this way makes no room for a third: the third is judged against the ones kept
  const three = inForce([FREE, later(13_000_000), later(15_500_000, { box: box(0.1, 0.45, 0.9, 0.6) })], { wordsFrom: AS_WRITTEN })
  expect([three.kept.map((graphic) => graphic.atUs), three.dropped]).toEqual([[2_000_000, 5_500_000], 1])
  // a switched-off one takes no place
  expect(inForce([{ ...FREE, off: true }, later(13_000_000)], { wordsFrom: AS_WRITTEN }).kept.map((graphic) => graphic.atUs)).toEqual([3_000_000])
})

test("a free graphic never moves or drops a legacy one: it gives way to it, before or after, and the legacy one is placed as if it were not there", () => {
  const legacy: GraphicCue = { ...MOTION_CUE, anchor: speech(13_000_000, "b1"), pointId: "p1" }
  const alone = inForce([legacy], { wordsFrom: AS_WRITTEN })
  const before = inForce([FREE, legacy], { wordsFrom: AS_WRITTEN })
  expect([before.kept, before.dropped]).toEqual([alone.kept, 1])
  const after = inForce([legacy, { ...FREE, anchor: speech(14_000_000, "b1") }], { wordsFrom: AS_WRITTEN })
  expect([after.kept, after.dropped]).toEqual([alone.kept, 1])
  // a legacy graphic carries none of the free fields
  expect(alone.kept[0]).not.toHaveProperty("covering")
  expect(alone.kept[0]).not.toHaveProperty("replaces")
  expect(alone.kept[0]).not.toHaveProperty("coversKeep")
})

test("a written free graphic is stale when it was written to replace its point's text and does not cover it now, or the other way round", () => {
  const written = (replacesText: boolean): GraphicCue => ({ ...FREE, pointId: "p1", spec: { ...MOTION, replacesText } })
  const over = roomWith({ textIn: textIn([0.25, 0.55, "p1"]) })
  const judged = (cue: GraphicCue, room = roomWith({})) => inForce([cue], { room, wordsFrom: AS_WRITTEN }).kept.map((graphic) => [graphic.covering, graphic.stale, graphic.replaces])
  expect(judged(written(true), over)).toEqual([[true, false, true]])
  expect(judged(written(true))).toEqual([[false, true, false]])
  expect(judged(written(false), over)).toEqual([[true, true, false]])
  expect(judged(written(false))).toEqual([[false, false, false]])
  // one not written yet is never stale, and replaces nothing until it is written
  expect(judged({ ...written(true), spec: { ...MOTION, html: null } }, over)).toEqual([[true, false, false]])
})

test("a free graphic plays as short as 0.8 s: 0.9 s plays, where a legacy one of the same length does not, and its piece's end gives it no less than 0.8 s", () => {
  const short: MotionSpec = { ...MOTION, html: null, seconds: 0.9 }
  expect(inForce([{ ...FREE, spec: short }]).kept.map((graphic) => graphic.durationUs)).toEqual([900_000])
  expect(inForce([{ ...MOTION_CUE, spec: short }])).toEqual({ kept: [], dropped: 1, off: [] })
  expect(inForce([{ ...FREE, spec: { ...MOTION, html: null } }], { pieceEndOf: () => 2_500_000 }).kept.map((graphic) => graphic.durationUs)).toEqual([FREE_GRAPHIC_MIN_US])
})

test("a free graphic takes its point's text's place only when it covers it and is written and fresh; replacedPoints follows", () => {
  const over = roomWith({ textIn: textIn([0.25, 0.55, "p1"]) })
  const replacing: GraphicCue = { ...FREE, pointId: "p1", spec: { ...MOTION, replacesText: true } }
  const kept = inForce([replacing], { room: over, wordsFrom: AS_WRITTEN })
  expect(kept.kept.map(replacesText)).toEqual([true])
  expect([...replacedPoints(kept)]).toEqual(["p1"])
  // beside its point's text, written to stay beside it: fresh, with a job, and the text stays
  const beside = inForce([{ ...FREE, pointId: "p1" }], { wordsFrom: AS_WRITTEN })
  expect(graphicJob(beside.kept[0]!, { canvas: PORTRAIT, fps: 30, style: HIGHLIGHT_STYLES["bold-white"] })).not.toBeNull()
  expect([...replacedPoints(beside)]).toEqual([])
})

test("the view of a free graphic says its level, whether it takes its point's text's place and whether it covers a face or a shown thing; a legacy one has no level", () => {
  const replacing: GraphicCue = { ...FREE, pointId: "p1", spec: { ...MOTION, replacesText: true } }
  const views = graphicViews(inForce([replacing], { room: roomWith({ textIn: textIn([0.25, 0.55, "p1"]), keepIn: () => [box(0.4, 0.4, 0.6, 0.6)] }), wordsFrom: said(["ล้าน", 0]) }), place)
  // covering a face it plays 1.5 s, and the words said in those are the ones it is judged by
  expect(views.map((view) => [view.from, view.coversKeep])).toEqual([["medium", true]])
  // a second, tied to no point, low in the frame clear of the text, from the loudest level
  const low: GraphicCue = { ...FREE, anchor: speech(20_000_000, "b1"), from: "heavy", spec: { ...FREE.spec, box: box(0.1, 0.6, 0.9, 0.8) } }
  const fresh = graphicViews(inForce([replacing, low], { room: roomWith({ textIn: textIn([0.25, 0.55, "p1"]) }), wordsFrom: AS_WRITTEN }), place)
  expect(fresh.map((view) => [view.from, view.replaces, view.coversKeep])).toEqual([
    ["medium", true, false],
    ["heavy", false, false],
  ])
  // a legacy one made for a point says it replaces by the old rule
  const legacy = graphicViews(inForce([{ ...MOTION_CUE, pointId: "p1" }], { wordsFrom: AS_WRITTEN }), place)
  expect(legacy.map((view) => [view.from, view.replaces, view.coversKeep])).toEqual([[null, true, false]])
})

/** Where each cue of an admission plays: 10 s before its source moment, for its seconds; none past 25 s. */
const placedOf = (cue: GraphicCue) => (cue.anchor.kind === "speech" && cue.anchor.sourceUs < 25_000_000 ? { atUs: cue.anchor.sourceUs - 10_000_000, durationUs: Math.round(cue.spec.seconds * 1_000_000) } : null)
/** p1's text on screen from 1 s to 4 s at 0.25–0.55, as the room hands it for a span. */
const P1_TEXT = {
  textIn: (span: At) => (span.startUs < 4_000_000 && 1_000_000 < span.endUs ? [{ band: { fromY: 0.25, toY: 0.55 }, pointId: "p1" }] : []),
  ownTextIn: (span: At, pointId: string) => (pointId === "p1" && span.startUs < 4_000_000 && 1_000_000 < span.endUs ? [{ fromY: 0.25, toY: 0.55 }] : []),
  keepIn: () => [],
}

test("admitting Claude's free graphics drops one with no place, one gone, and one tied to a point that does not start while its point's text is on screen", () => {
  const tied = (sourceUs: number, pointId?: string): GraphicCue => ({ ...FREE, anchor: speech(sourceUs, "b1"), spec: { ...MOTION, html: null }, ...(pointId !== undefined ? { pointId } : {}) })
  // starts at 2 s, while p1's text is up
  expect(admitFree([tied(12_000_000, "p1")], placedOf, P1_TEXT, [])).toEqual({ admitted: [tied(12_000_000, "p1")], dropped: 0 })
  // no place on the cut
  expect(admitFree([tied(30_000_000, "p1")], placedOf, P1_TEXT, [])).toEqual({ admitted: [], dropped: 1 })
  // over p1's text, tied to another point or to none
  expect(admitFree([tied(12_000_000, "p2"), tied(12_000_000)], placedOf, P1_TEXT, [])).toEqual({ admitted: [], dropped: 2 })
  // starts at 4 s, after p1's text has gone: its start is outside its point's text, though it plays on
  const late = tied(14_000_000, "p1")
  expect(admitFree([late], placedOf, P1_TEXT, [])).toEqual({ admitted: [], dropped: 1 })
  // one tied to no point may start anywhere clear
  expect(admitFree([tied(16_000_000)], placedOf, P1_TEXT, [])).toEqual({ admitted: [tied(16_000_000)], dropped: 0 })
})

test("admitting drops one on screen with the user's own graphic or an earlier one admitted in the same place, and cuts one over a face or a shown thing to 1.5 s", () => {
  const at = (sourceUs: number, over: Partial<MotionSpec> = {}): GraphicCue => ({ ...FREE, anchor: speech(sourceUs, "b1"), spec: { ...MOTION, html: null, ...over } })
  const room = roomWith({})
  // the user's own at 3–6 s in the same box
  const own = [{ span: { startUs: 3_000_000, endUs: 6_000_000 }, box: MOTION.box }]
  expect(admitFree([at(12_000_000)], placedOf, room, own)).toEqual({ admitted: [], dropped: 1 })
  // in another place, or after it, it stays
  expect(admitFree([at(12_000_000, { box: box(0.1, 0.6, 0.9, 0.8) }), at(16_000_000)], placedOf, room, own).dropped).toBe(0)
  // two of Claude's together in the same place: the later goes, whatever order they come in
  expect(admitFree([at(13_000_000), at(12_000_000)], placedOf, room, [])).toEqual({ admitted: [at(12_000_000)], dropped: 1 })
  // over a face: kept, its seconds cut to 1.5, and so clear of one that starts at 1.6 s after it
  const face = roomWith({ keepIn: () => [box(0.4, 0.4, 0.6, 0.6)] })
  expect(admitFree([at(12_000_000), at(13_600_000)], placedOf, face, [])).toEqual({ admitted: [at(12_000_000, { seconds: COVER_MAX_US / 1e6 }), at(13_600_000, { seconds: COVER_MAX_US / 1e6 })], dropped: 0 })
  // a short one keeps its seconds
  expect(admitFree([at(12_000_000, { seconds: 1 })], placedOf, face, []).admitted.map((cue) => cue.spec.seconds)).toEqual([1])
})

test("a free graphic's covering is judged against its point's text with every point shown, so a level that hides that text makes it neither uncovering nor stale", () => {
  // p1 is secondary: at light its text is not drawn, but with every point shown it is under the graphic
  const graphic: GraphicCue = { ...FREE, from: "light", pointId: "p1", spec: { ...MOTION, replacesText: true } }
  const drawnAt = (level: "light" | "medium") => (level === "light" ? textIn() : textIn([0.25, 0.55, "p1"]))
  for (const level of ["light", "medium"] as const) {
    const room = roomWith({ textIn: drawnAt(level), ownTextIn: () => [{ fromY: 0.25, toY: 0.55 }] })
    const [placed] = inForce([graphic], { flair: { ...ON, level }, room, wordsFrom: AS_WRITTEN }).kept
    expect([placed!.covering, placed!.stale, placed!.replaces], level).toEqual([true, false, true])
  }
})

test("a free graphic's covering is judged on the span it plays once cut: by a face, or by the end of the rough cut", () => {
  // p1's own text comes up at 4 s; the graphic plays 2–5 s at full length
  const late = roomWith({ ownTextIn: (span) => (span.endUs > 4_000_000 ? [{ fromY: 0.25, toY: 0.55 }] : []) })
  const cue: GraphicCue = { ...FREE, pointId: "p1", spec: { ...MOTION, html: null } }
  expect(inForce([cue], { room: late }).kept.map((graphic) => graphic.covering)).toEqual([true])
  // over a face it plays 2–3.5 s, and never covers the text
  const face = { ...late, keepIn: () => [box(0.4, 0.4, 0.6, 0.6)] }
  expect(inForce([cue], { room: face }).kept.map((graphic) => [graphic.durationUs, graphic.coversKeep, graphic.covering])).toEqual([[COVER_MAX_US, true, false]])
  // the rough cut ends at 3.9 s: it plays 2–3.9 s, and never covers the text either, switched on or off
  expect(inForce([cue], { room: late, durationUs: 3_900_000 }).kept.map((graphic) => [graphic.durationUs, graphic.covering])).toEqual([[1_900_000, false]])
  expect(inForce([{ ...cue, off: true }], { room: late, durationUs: 3_900_000 }).off.map((graphic) => graphic.covering)).toEqual([false])
})

test("a free graphic is never moved off the subtitles: it keeps its box where they would be", () => {
  expect(inForce([FREE], { captionsFromY: 0.4, wordsFrom: AS_WRITTEN }).kept.map((graphic) => graphic.cue.spec.box)).toEqual([MOTION.box])
})

test("admitting drops a tied graphic that starts before its point's text comes up, though it plays over it later", () => {
  // plays 0.5–3.5 s; p1's text is up 1–4 s
  const early: GraphicCue = { ...FREE, anchor: speech(10_500_000, "b1"), pointId: "p1", spec: { ...MOTION, html: null } }
  expect(admitFree([early], placedOf, P1_TEXT, [])).toEqual({ admitted: [], dropped: 1 })
})

test("scenes on the cut merge only where the rough cut runs on: a piece of a video with no pictures analysed between two of one scene parts them", () => {
  const plan = {
    beats: [],
    cuts: [
      { binId: "a", sourceStartUs: 2_000_000, sourceDurationUs: 2_000_000 },
      { binId: "c", sourceStartUs: 0, sourceDurationUs: 1_000_000 },
      { binId: "a", sourceStartUs: 5_000_000, sourceDurationUs: 1_000_000 },
    ],
    durationUs: 4_000_000,
  } as unknown as CutPlan
  const clips = [...OBJECT_CLIPS, { id: "c", insight: null }] as unknown as CutClip[]
  expect(scenesOnCut(plan, clips).map((scene) => [scene.startUs, scene.endUs, scene.description])).toEqual([
    [0, 2_000_000, "คนพูด"],
    [3_000_000, 4_000_000, "คนพูด"],
  ])
})

test("objects out of step with a video's scenes count as none for the scenes they miss: the keepClear band is kept, and the scene is shown with no objects", () => {
  // the objects were found for a's first scene only
  const clips = [{ ...OBJECT_CLIPS[0]!, objects: { version: "objects-2026-10-01", scenes: [[{ what: "หน้า", kind: "keep", box: FACE, still: false }]] } }] as unknown as CutClip[]
  const plan = { beats: [], cuts: [{ binId: "a", sourceStartUs: 5_000_000, sourceDurationUs: 10_000_000 }], durationUs: 10_000_000 } as unknown as CutPlan
  expect(keepBoxesIn(plan, clips, { startUs: 0, endUs: 10_000_000 })).toEqual([FACE, box(0, 0.5, 1, 0.9)])
  expect(scenesOnCut(plan, clips).map((scene) => scene.objects)).toEqual([[{ what: "หน้า", kind: "keep", box: FACE, still: false }], null])
})

/** Two pieces playing clip "z" from its start for a minute, half a minute each, on a portrait canvas the clip fills. */
const ZOOM_PLAN = {
  beats: [],
  cuts: [
    { binId: "z", sourceStartUs: 0, sourceDurationUs: 30_000_000 },
    { binId: "z", sourceStartUs: 30_000_000, sourceDurationUs: 30_000_000 },
  ],
  durationUs: 60_000_000,
} as unknown as CutPlan
const zoomAt = (_cut: number, sourceUs: number) => sourceUs
/** A move held from a piece's first frame to its end: one pose. */
const heldMove = (pose: Partial<Pose>, cut = 0): PlacedMove => ({
  cue: { anchor: speech(cut * 30_000_000, "b1"), from: "medium", about: "ดันเข้า", poses: [], edited: false, off: false },
  atUs: cut * 30_000_000,
  durationUs: 0,
  beatId: "b1",
  startUs: 0,
  poses: [{ s: 0, scale: 1, x: 0, y: 0, rot: 0, ease: "cut", ...pose }],
  cut,
})

test("the highlight text keeps off the face where a punch puts it; with no move it is placed as before", () => {
  // no objects pass: the scene's band across the whole width, around the frame's middle
  const clips = [{ id: "z", width: 1080, height: 1920, insight: { scenes: [{ startUs: 0, endUs: 60_000_000, description: "", kind: "talking-head", issues: [], keepClear: { fromY: 0.36, toY: 0.62 } }] } }] as unknown as CutClip[]
  const group: PlacedGroup = { groupId: "g1", beatId: "b1", videoId: "z", lines: [{ lineIndex: 0, text: "ราคา", cut: 0, sourceUs: 1_000_000, partial: false, words: { from: 0, to: 1 } }], end: { cut: 0, sourceUs: 2_000_000 } }
  const bands = (moves: PlacedMove[]) => {
    const faces = zoomedFaces({ moves, plan: ZOOM_PLAN, clips, canvas: PORTRAIT, at: zoomAt })
    return textBands({ placed: [group], timed: [timed("g1")], clips, canvas: PORTRAIT, font: "kanit", looks: {}, position: "auto", subtitlesOn: false, faceBand: faces.bandIn })
  }
  const plain = textBands({ placed: [group], timed: [timed("g1")], clips, canvas: PORTRAIT, font: "kanit", looks: {}, position: "auto", subtitlesOn: false })
  expect(bands([])).toEqual(plain)
  // a punch to 1.3 widens the band about the middle to 0.318–0.656: text that sat just clear of 0.36–0.62 now would not
  const punched = zoomedFaces({ moves: [heldMove({ scale: 1.3 })], plan: ZOOM_PLAN, clips, canvas: PORTRAIT, at: zoomAt }).bandIn({ startUs: 0, endUs: 1_200_000 })!
  expect(punched.fromY).toBeCloseTo(0.318)
  expect(punched.toY).toBeCloseTo(0.656)
  const band = bands([heldMove({ scale: 1.3 })])[0]!.band
  expect(band.toY <= punched.fromY || band.fromY >= punched.toY).toBe(true)
  expect(band).not.toEqual(plain[0]!.band)
  // a move on another piece moves nothing here
  expect(bands([heldMove({ scale: 1.3 }, 1)])).toEqual(plain)
})

test("a free graphic over the face where a move puts it plays 1.5 s at most; with no move it plays its whole length", () => {
  // a face below the graphic's box (0.3–0.5 of the height) until the picture is pushed in and raised over it
  const face = { x0: 0.4, y0: 0.55, x1: 0.6, y1: 0.65 }
  const clips = [{ id: "z", width: 1080, height: 1920, insight: { scenes: [{ startUs: 0, endUs: 60_000_000, description: "", kind: "talking-head", issues: [], keepClear: { fromY: 0.55, toY: 0.65 } }] }, objects: { version: OBJECTS_VERSION, scenes: [[{ what: "หน้า", kind: "keep", box: face, still: false, face: true }]] } }] as unknown as CutClip[]
  const unwritten: GraphicCue = { ...FREE, spec: { ...MOTION, html: null } }
  const roomUnder = (moves: PlacedMove[]) => roomWith({ keepIn: zoomedFaces({ moves, plan: ZOOM_PLAN, clips, canvas: PORTRAIT, at: zoomAt }).keepIn })
  expect(inForce([unwritten], { room: roomUnder([]) }).kept.map((graphic) => [graphic.durationUs, graphic.coversKeep])).toEqual([[3_000_000, false]])
  expect(inForce([unwritten], { room: roomUnder([heldMove({ scale: 1.3, y: 0.2 })]) }).kept.map((graphic) => [graphic.durationUs, graphic.coversKeep])).toEqual([[COVER_MAX_US, true]])
})

/** A punch to 1.3 on the first piece of ZOOM_PLAN from `atUs` on. */
const punchFrom = (atUs: number): PlacedMove => ({ ...heldMove({ scale: 1.3 }), atUs, startUs: atUs })
/** Clip "z" with one scene to 2 s and another after it, each with its keepClear band, and objects when given. */
const twoScenes = (objects?: unknown) =>
  [
    {
      id: "z",
      width: 1080,
      height: 1920,
      insight: {
        scenes: [
          { startUs: 0, endUs: 2_000_000, description: "", kind: "talking-head", issues: [], keepClear: { fromY: 0.1, toY: 0.5 } },
          { startUs: 2_000_000, endUs: 60_000_000, description: "", kind: "talking-head", issues: [], keepClear: { fromY: 0.36, toY: 0.62 } },
        ],
      },
      ...(objects ? { objects } : {}),
    },
  ] as unknown as CutClip[]

test("the text keeps off the face where a move puts it for as long as it is on screen, after its last word too", () => {
  const clips = [{ ...twoScenes()[0]!, insight: { scenes: [{ startUs: 0, endUs: 60_000_000, description: "", kind: "talking-head", issues: [], keepClear: { fromY: 0.36, toY: 0.62 } }] } }] as unknown as CutClip[]
  // its words are said from 0.2 s to 1 s, and it stays up until 3 s; the punch comes at 2 s
  const group: PlacedGroup = { groupId: "g1", beatId: "b1", videoId: "z", lines: [{ lineIndex: 0, text: "ราคา", cut: 0, sourceUs: 200_000, partial: false, words: { from: 0, to: 1 } }], end: { cut: 0, sourceUs: 1_000_000 } }
  const up: TimedGroup = { ...timed("g1"), startUs: 200_000, endUs: 3_000_000 }
  const bands = (moves: PlacedMove[]) =>
    textBands({ placed: [group], timed: [up], clips, canvas: PORTRAIT, font: "kanit", looks: {}, position: "auto", subtitlesOn: false, faceBand: zoomedFaces({ moves, plan: ZOOM_PLAN, clips, canvas: PORTRAIT, at: zoomAt }).bandIn })
  const punched = zoomedFaces({ moves: [punchFrom(2_000_000)], plan: ZOOM_PLAN, clips, canvas: PORTRAIT, at: zoomAt }).bandIn({ startUs: 200_000, endUs: 3_000_000 })!
  expect(punched.toY).toBeCloseTo(0.656)
  const band = bands([punchFrom(2_000_000)])[0]!.band
  expect(band.toY <= punched.fromY || band.fromY >= punched.toY).toBe(true)
  expect(band).not.toEqual(bands([])[0]!.band)
  // a punch after it has gone changes nothing
  expect(bands([punchFrom(3_000_000)])).toEqual(bands([]))
})

test("text on screen across a move's start keeps off the scenes' bands where no move reaches, never less than before; with no face found under the move it keeps to them as before", () => {
  // the objects pass found the face smaller than the first scene's band; the second scene's face is in the middle
  const objects = { version: OBJECTS_VERSION, scenes: [[{ what: "หน้า", kind: "keep", box: { x0: 0.4, y0: 0.3, x1: 0.6, y1: 0.4 }, still: false, face: true }], [{ what: "หน้า", kind: "keep", box: { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }, still: false, face: true }]] }
  const faces = zoomedFaces({ moves: [punchFrom(2_000_000)], plan: ZOOM_PLAN, clips: twoScenes(objects), canvas: PORTRAIT, at: zoomAt })
  // from 1 s to 4 s: the first scene's whole band, 0.1–0.5, before the punch; the face pushed to 0.37–0.63 after it
  const band = faces.bandIn({ startUs: 1_000_000, endUs: 4_000_000 })!
  expect(band.fromY).toBeCloseTo(0.1)
  expect(band.toY).toBeCloseTo(0.63)
  // wholly under the move: the face after it alone
  const under = faces.bandIn({ startUs: 3_000_000, endUs: 4_000_000 })!
  expect([under.fromY, under.toY].map((value) => Number(value.toFixed(2)))).toEqual([0.37, 0.63])
  // no move there: no band, and the scenes' bands as before
  expect(faces.bandIn({ startUs: 500_000, endUs: 1_500_000 })).toBeNull()
  // the pass found no face under the move: no band either
  const empty = { version: OBJECTS_VERSION, scenes: [[], []] }
  expect(zoomedFaces({ moves: [punchFrom(2_000_000)], plan: ZOOM_PLAN, clips: twoScenes(empty), canvas: PORTRAIT, at: zoomAt }).bandIn({ startUs: 1_000_000, endUs: 4_000_000 })).toBeNull()
})

test("the scenes Claude is told of for graphics list the faces where a move puts them, in place of the faces found; other things and other scenes stay", () => {
  const face = { x0: 0.4, y0: 0.3, x1: 0.6, y1: 0.5 }
  const glass = { what: "แก้ว", kind: "keep", box: { x0: 0.1, y0: 0.6, x1: 0.3, y1: 0.8 }, still: true, face: false }
  const sign = { what: "ป้าย", kind: "point", box: { x0: 0.7, y0: 0.6, x1: 0.9, y1: 0.8 }, still: true }
  const objects = { version: OBJECTS_VERSION, scenes: [[{ what: "หน้า", kind: "keep", box: face, still: false, face: true }, glass, sign], [{ what: "หน้า", kind: "keep", box: face, still: false, face: true }]] }
  const clips = twoScenes(objects)
  const faces = zoomedFaces({ moves: [punchFrom(2_000_000)], plan: ZOOM_PLAN, clips, canvas: PORTRAIT, at: zoomAt })
  const told = scenesOnCut(ZOOM_PLAN, clips, faces.facesIn)
  // the first scene plays before the punch: as found
  expect(told[0]!.objects).toEqual(objects.scenes[0])
  // the second, which both pieces play: pushed in to 1.3 about the middle on the first, and as found on the second
  expect(told[1]!.objects!.map((object) => object.what)).toEqual(["หน้า (หลังซูม)", "หน้า"])
  expect(told[1]!.objects![1]).toBe(objects.scenes[1]![0])
  const zoomed = told[1]!.objects![0]!
  expect(zoomed).toMatchObject({ kind: "keep", still: false, face: true })
  for (const [edge, value] of Object.entries({ x0: 0.37, y0: 0.24, x1: 0.63, y1: 0.5 })) expect(zoomed.box[edge as keyof typeof zoomed.box]).toBeCloseTo(value)
  // without moves, as before
  expect(scenesOnCut(ZOOM_PLAN, clips)).toEqual(scenesOnCut(ZOOM_PLAN, clips, zoomedFaces({ moves: [], plan: ZOOM_PLAN, clips, canvas: PORTRAIT, at: zoomAt }).facesIn))
})
