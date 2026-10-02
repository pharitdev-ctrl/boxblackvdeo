import { expect, test } from "vitest"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import { MOTION_VERSION, type GraphicCue, type MotionSpec, type PlacedGraphic } from "@boxblack/core/graphics/plan"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import { composedInForce, composedViews, hashOfHtml, soundJobOf, soundStatusOf, wordsOnCut, wordsWithin, type PlacedComposed } from "./composed-cues.ts"
import { hashOf, type SoundJob } from "./sound-render.ts"
import type { ItemPlace } from "./insert-media.ts"
import type { SpokenSentence } from "./spoken.ts"

const speech = (sourceUs: number, beatId?: string): CueAnchor => ({ kind: "speech", videoId: "v", sourceUs, ...(beatId ? { beatId } : {}) })
const ON: FlairOptions = { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: true }
/** Each moment plays 10 s before its source time; one at 30 s of the source has no place on the cut. */
const place = (anchor: CueAnchor): ItemPlace | null => (anchor.kind === "speech" && anchor.sourceUs < 25_000_000 ? { atUs: anchor.sourceUs - 10_000_000, what: "ที่ “ล้านสองแสน”", beatId: "b1", by: anchor } : null)

/** A sound composed for the second it has on ล้าน, 2 s into the rough cut, and the two words said in it. */
const SOUND: ComposedSound = {
  anchor: speech(12_000_000, "b1"),
  from: "medium",
  role: "เสียงติ๊งสองทีตามตัวเลขที่พูด",
  loudness: "normal",
  seconds: 1,
  words: [
    { text: "ล้าน", atS: 0 },
    { text: "สองแสน", atS: 0.5 },
  ],
  code: "function compose(ctx, cue, kit) {}",
  version: SOUND_VERSION,
  off: false,
}
/** What is said now, as the caller's `wordsAt` answers it: these words, each at its seconds from the sound's start. */
const said =
  (...words: [string, number][]) =>
  () =>
    words.map(([text, atS]) => ({ text, atS }))
/** The words SOUND was composed for, said when they were. */
const AS_WRITTEN = said(["ล้าน", 0], ["สองแสน", 0.5])

const none = { kept: [], off: [] }
const inForce = (sounds: ComposedSound[], over: Partial<Parameters<typeof composedInForce>[0]> = {}) =>
  composedInForce({ sounds, place, graphics: none, flair: ON, durationUs: 60_000_000, passes: () => true, pieceEndOf: () => null, wordsAt: AS_WRITTEN, ...over })

test("a fragment's hash is the first sixteen hex digits of its sha256", () => {
  expect(hashOfHtml("")).toBe("e3b0c44298fc1c14")
  expect(hashOfHtml("abc")).toBe("ba7816bf8f01cfea")
})

test("a composed sound plays where its moment does, for its length, with the words said now while it plays", () => {
  const asked: [number, number][] = []
  const result = inForce([SOUND], { wordsAt: (atUs, seconds) => (asked.push([atUs, seconds]), AS_WRITTEN()) })
  expect(result).toEqual({ kept: [{ sound: SOUND, atUs: 2_000_000, durationUs: 1_000_000, beatId: "b1", graphic: null, wordsNow: SOUND.words, stale: null }], off: [], unplaced: 0 })
  // the words are asked from where it starts, for as long as it plays
  expect(asked).toEqual([[2_000_000, 1]])
})

test("a stored entry that is no composed sound is left out: neither placed, listed as off, nor counted, and nothing is asked about it", () => {
  // what an outline file may hold is outside the type: nothing, a sound of no level, one neither on nor off
  const odd = [null, {}, { ...SOUND, from: "loud" }, { ...SOUND, off: "no" }, { ...SOUND, anchor: null }] as unknown as ComposedSound[]
  const asked: string[] = []
  const watching = {
    place: (anchor: CueAnchor) => (asked.push("place"), place(anchor)),
    pieceEndOf: () => (asked.push("pieceEndOf"), null),
    wordsAt: () => (asked.push("wordsAt"), []),
  }
  expect(inForce(odd, watching)).toEqual({ kept: [], off: [], unplaced: 0 })
  expect(asked).toEqual([])
  // and the sounds beside them are placed as if they were not there
  expect(inForce([odd[0]!, SOUND, odd[2]!])).toEqual(inForce([SOUND]))
})

test("a sound plays from its lowest level up, and on a point only while the point passes; one held back is neither listed nor counted", () => {
  const light = { ...SOUND, from: "light" as const }
  const heavy = { ...SOUND, anchor: speech(15_000_000, "b1"), from: "heavy" as const }
  const atLevel = (level: FlairOptions["level"]) => inForce([light, SOUND, heavy], { flair: { ...ON, level } })
  expect(atLevel("light").kept.map((placed) => placed.sound)).toEqual([light])
  expect(atLevel("medium").kept.map((placed) => placed.sound)).toEqual([light, SOUND])
  expect(atLevel("heavy").kept.map((placed) => placed.sound)).toEqual([light, SOUND, heavy])
  // a switched-off one above the level is not listed either, and none of them is counted
  expect(inForce([{ ...heavy, off: true }], { flair: { ...ON, level: "medium" } })).toEqual({ kept: [], off: [], unplaced: 0 })
  // on a point the level hides it is neither in force, listed as off, nor counted, even with no place
  const gone = { ...SOUND, anchor: speech(30_000_000, "b1") }
  const hidden = inForce([{ ...SOUND, pointId: "p" }, { ...heavy, off: true, pointId: "p" }, { ...gone, pointId: "p" }, { ...heavy, pointId: "q" }], { passes: (id) => id !== "p" })
  expect(hidden.kept.map((placed) => placed.sound.pointId)).toEqual(["q"])
  expect([hidden.off, hidden.unplaced]).toEqual([[], 0])
  // and with the sound switch off none plays
  expect(inForce([SOUND, { ...heavy, off: true }], { flair: { ...ON, sound: false } })).toEqual({ kept: [], off: [], unplaced: 0 })
})

test("a sound whose moment the cut took out plays where its point starts now; with no place at all it is unplaced, unless switched off", () => {
  const start = speech(11_500_000, "b1")
  const byPoint = (anchor: CueAnchor, pointId?: string): ItemPlace | null => place(anchor) ?? (pointId === "p1" ? { ...place(start)!, by: start } : null)
  const moved = { ...SOUND, anchor: speech(30_000_000, "b1"), pointId: "p1" }
  const asked: CueAnchor[] = []
  const result = inForce([moved, { ...moved, pointId: "p2" }, { ...moved, pointId: "p2", off: true }], { place: byPoint, pieceEndOf: (anchor) => (asked.push(anchor), null) })
  expect(result.kept.map((placed) => [placed.sound, placed.atUs])).toEqual([[moved, 1_500_000]])
  // its piece is asked for by the moment it plays by
  expect(asked).toEqual([start])
  // the one whose point is not placed has nowhere to play, and is counted; switched off, it is not
  expect([result.off, result.unplaced]).toEqual([[], 1])
})

test("a sound plays until the piece playing its sentence ends, but is never cut shorter than 1.5 s by it; a written one with up to 0.3 s less room plays whole; the end of the rough cut cuts it, and one with less than 0.2 s left there is unplaced", () => {
  // composed for 3 s from 2.0 s, the same words said throughout
  const long = { ...SOUND, seconds: 3 }
  const playing = (over: Partial<Parameters<typeof composedInForce>[0]>, sound: ComposedSound = long) => {
    const { kept, off } = inForce([sound], over)
    return [...kept, ...off].map((placed) => [placed.durationUs, placed.stale])
  }
  expect(playing({})).toEqual([[3_000_000, null]])
  expect(playing({ pieceEndOf: () => 9_000_000 })).toEqual([[3_000_000, null]])
  // its piece ends a second sooner: it has 2 s, which is too short for what it was composed for
  expect(playing({ pieceEndOf: () => 4_000_000 })).toEqual([[2_000_000, "cut"]])
  // 0.21 s sooner, and 0.3 s: it plays its whole length all the same, on into the next piece
  expect(playing({ pieceEndOf: () => 4_790_000 })).toEqual([[3_000_000, null]])
  expect(playing({ pieceEndOf: () => 4_700_000 })).toEqual([[3_000_000, null]])
  expect(playing({ pieceEndOf: () => 4_699_999 })).toEqual([[2_699_999, "cut"]])
  // one not composed yet has no length to play out: it is given the room there is
  expect(playing({ pieceEndOf: () => 4_790_000 }, { ...long, code: null })).toEqual([[2_790_000, null]])
  // a piece that leaves less than 1.5 s leaves it 1.5 s; one shorter than that plays its length
  expect(playing({ pieceEndOf: () => 2_500_000 }, { ...long, code: null })).toEqual([[1_500_000, null]])
  expect(playing({ pieceEndOf: () => 2_500_000 })).toEqual([[1_500_000, "cut"]])
  expect(playing({ pieceEndOf: () => 2_500_000 }, SOUND)).toEqual([[1_000_000, null]])
  // the end of the rough cut cuts it, played out or not, a switched-off one as one that plays
  expect(playing({ durationUs: 4_500_000 })).toEqual([[2_500_000, "cut"]])
  expect(playing({ durationUs: 4_500_000 }, { ...long, off: true })).toEqual([[2_500_000, "cut"]])
  expect(playing({ pieceEndOf: () => 4_790_000, durationUs: 4_950_000 })).toEqual([[2_950_000, null]])
  // with less than 0.2 s left before it ends, there is no sound to play: unplaced, and counted unless switched off
  expect(inForce([long], { durationUs: 2_199_999 })).toEqual({ kept: [], off: [], unplaced: 1 })
  expect(inForce([{ ...long, off: true }], { durationUs: 2_199_999 })).toEqual({ kept: [], off: [], unplaced: 0 })
  expect(playing({ durationUs: 2_200_000 }, { ...long, code: null })).toEqual([[200_000, null]])
})

test("a written sound is stale by the cut when the words said while it plays are not the ones it was composed for, in text, order or number, when it plays more than 0.1 s short of its length, or when it was composed under another contract", () => {
  const staleWhen = (over: Partial<Parameters<typeof composedInForce>[0]>, sound: ComposedSound = SOUND) => {
    const { kept, off } = inForce([sound], over)
    return [...kept, ...off].map((placed) => placed.stale)
  }
  // the same words said at other times: fresh, and it carries the times now
  expect(inForce([SOUND], { wordsAt: said(["ล้าน", 0], ["สองแสน", 0.72]) }).kept.map((placed) => placed.wordsNow)).toEqual([[{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.72 }]])
  expect(staleWhen({ wordsAt: said(["ล้าน", 0], ["สองแสน", 0.72]) })).toEqual([null])
  // a word cut, another in its place, a word more, the two the other way round, none at all
  for (const wordsAt of [said(["ล้าน", 0]), said(["ล้าน", 0], ["สามแสน", 0.5]), said(["ล้าน", 0], ["สองแสน", 0.5], ["บาท", 0.9]), said(["สองแสน", 0], ["ล้าน", 0.5]), said()]) {
    expect(staleWhen({ wordsAt })).toEqual(["cut"])
  }
  // 0.1 s short to the microsecond is fresh; a microsecond more is stale
  expect(staleWhen({ durationUs: 2_900_000 })).toEqual([null])
  expect(staleWhen({ durationUs: 2_899_999 })).toEqual(["cut"])
  // composed under another contract
  expect(staleWhen({}, { ...SOUND, version: "sound-2026-01-01" })).toEqual(["cut"])
  // a switched-off one is judged the same
  expect(staleWhen({ wordsAt: said() }, { ...SOUND, off: true })).toEqual(["cut"])
  // one not composed yet, or whose composing failed, has nothing to be stale: it is composed for what there is then
  const unwritten = { ...SOUND, code: null, version: "sound-2026-01-01", failed: "the sound is silent: nothing above 1% of full scale" }
  expect(staleWhen({ wordsAt: said(), durationUs: 2_300_000 }, unwritten)).toEqual([null])
})

/** A motion graphic on ล้าน, written, placed 5 s into the rough cut for 2 s. */
const FRAGMENT = '<style>.n{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="n">1,200,000</div>'
const MOTION: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 }, seconds: 2, why: "ตัวเลขยอดขาย", idea: "ตัวเลขวิ่งถึง 1,200,000", words: [], html: FRAGMENT }
const GRAPHIC: GraphicCue = { anchor: speech(15_000_000, "b1"), spec: MOTION, edited: false, off: false }
const PLACED: PlacedGraphic = { cue: GRAPHIC, atUs: 5_000_000, durationUs: 2_000_000, wordsNow: [], stale: false }
/** A sound composed for that graphic as it is: it starts with it, on its anchor. */
const TIED: ComposedSound = { ...SOUND, anchor: GRAPHIC.anchor, graphic: GRAPHIC.anchor, graphicHtml: hashOfHtml(FRAGMENT) }

test("a sound tied to a graphic starts with it, and plays as long as the graphic does and the graphic's run-on, whatever its sentence", () => {
  const asked: [number, number][] = []
  const pieces: CueAnchor[] = []
  const tied = (seconds: number, over: Partial<Parameters<typeof composedInForce>[0]> = {}) =>
    inForce([{ ...TIED, seconds }], { graphics: { kept: [PLACED], off: [] }, pieceEndOf: (anchor) => (pieces.push(anchor), 5_500_000), ...over })
  expect(tied(1, { wordsAt: (atUs, seconds) => (asked.push([atUs, seconds]), AS_WRITTEN()) })).toEqual({
    kept: [{ sound: { ...TIED, seconds: 1 }, atUs: 5_000_000, durationUs: 1_000_000, beatId: "b1", graphic: PLACED, wordsNow: SOUND.words, stale: null }],
    off: [],
    unplaced: 0,
  })
  expect(asked).toEqual([[5_000_000, 1]])
  // the graphic plays 2 s: the sound may ring 0.3 s past it, and composed for longer it is cut there, and stale
  expect(tied(2.3).kept.map((placed) => [placed.durationUs, placed.stale])).toEqual([[2_300_000, null]])
  expect(tied(3).kept.map((placed) => [placed.durationUs, placed.stale])).toEqual([[2_300_000, "cut"]])
  expect(tied(3, { graphics: { kept: [{ ...PLACED, durationUs: 2_700_000 }], off: [] } }).kept.map((placed) => [placed.durationUs, placed.stale])).toEqual([[3_000_000, null]])
  // its sentence's piece is not what ends it
  expect(pieces).toEqual([])
  // the end of the rough cut cuts it as any other
  expect(tied(2.3, { durationUs: 6_000_000 }).kept.map((placed) => placed.durationUs)).toEqual([1_000_000])
  // it is found by its graphic's place, whatever its own anchor says
  expect(inForce([{ ...TIED, anchor: speech(30_000_000, "b1") }], { graphics: { kept: [PLACED], off: [] } }).kept.map((placed) => placed.atUs)).toEqual([5_000_000])
})

test("a tied sound whose graphic is not placed is unplaced, unless switched off; one whose graphic is switched off is off with it", () => {
  // the graphic gone from the cut, removed, of another kind, or hidden: none is among those placed
  expect(inForce([TIED])).toEqual({ kept: [], off: [], unplaced: 1 })
  expect(inForce([{ ...TIED, off: true }])).toEqual({ kept: [], off: [], unplaced: 0 })
  expect(inForce([TIED], { graphics: { kept: [{ ...PLACED, cue: { ...GRAPHIC, anchor: speech(16_000_000, "b1") } }], off: [] } }).unplaced).toBe(1)
  // its graphic switched off: listed apart, with the graphic, placed as it would play
  const offGraphic: PlacedGraphic = { ...PLACED, cue: { ...GRAPHIC, off: true } }
  expect(inForce([TIED], { graphics: { kept: [], off: [offGraphic] } })).toEqual({
    kept: [],
    off: [{ sound: TIED, atUs: 5_000_000, durationUs: 1_000_000, beatId: "b1", graphic: offGraphic, wordsNow: SOUND.words, stale: null }],
    unplaced: 0,
  })
  // switched off itself under a graphic that plays
  expect(inForce([{ ...TIED, off: true }], { graphics: { kept: [PLACED], off: [] } }).off.map((placed) => placed.graphic)).toEqual([PLACED])
  // its graphic switched off with too little of the rough cut left to play: no place, and not counted, as the user switched it off
  expect(inForce([TIED], { graphics: { kept: [], off: [offGraphic] }, durationUs: 5_100_000 })).toEqual({ kept: [], off: [], unplaced: 0 })
  expect(inForce([TIED], { graphics: { kept: [PLACED], off: [] }, durationUs: 5_100_000 })).toEqual({ kept: [], off: [], unplaced: 1 })
})

test("while graphics are not shown (switched off, or no frame to draw on) a tied sound is left out, neither placed nor counted; the others play as ever", () => {
  expect(inForce([TIED, SOUND], { graphics: null })).toEqual(inForce([SOUND]))
  expect(inForce([TIED], { graphics: null })).toEqual({ kept: [], off: [], unplaced: 0 })
})

test("a sound bound to no point whose own word the cut took out has nowhere to play, and is counted", () => {
  // nothing to fall back on: it is no point's
  expect(inForce([{ ...SOUND, anchor: speech(30_000_000, "b1") }])).toEqual({ kept: [], off: [], unplaced: 1 })
})

test("a stored word that is no word makes the words changed, rather than stopping the placing", () => {
  const odd = { ...SOUND, words: [null, 7] } as unknown as ComposedSound
  expect(inForce([odd]).kept.map((placed) => placed.stale)).toEqual(["cut"])
})

test("a written tied sound is stale by the picture when its graphic's fragment is not the one it was composed for, or the graphic has none; the picture is told before the cut", () => {
  const staleWith = (sound: ComposedSound, graphic: PlacedGraphic = PLACED, over: Partial<Parameters<typeof composedInForce>[0]> = {}) => inForce([sound], { graphics: { kept: [graphic], off: [] }, ...over }).kept.map((placed) => placed.stale)
  expect(staleWith(TIED)).toEqual([null])
  // the graphic written again
  expect(staleWith(TIED, { ...PLACED, cue: { ...GRAPHIC, spec: { ...MOTION, html: `${FRAGMENT}<b></b>` } } })).toEqual(["picture"])
  // the graphic waiting to be written again
  expect(staleWith(TIED, { ...PLACED, cue: { ...GRAPHIC, spec: { ...MOTION, html: null } } })).toEqual(["picture"])
  // the graphic stale, with the fragment the sound was composed to: it is not laid, so the sound is not laid alone
  expect(staleWith(TIED, { ...PLACED, stale: true })).toEqual(["picture"])
  // a hash never stored is no match
  const { graphicHtml: _hash, ...unhashed } = TIED
  expect(staleWith(unhashed)).toEqual(["picture"])
  // the picture and the words both changed: the picture is told
  expect(staleWith({ ...TIED, graphicHtml: "0000000000000000" }, PLACED, { wordsAt: said() })).toEqual(["picture"])
  expect(staleWith(TIED, PLACED, { wordsAt: said() })).toEqual(["cut"])
  // one not composed yet is composed for the picture there is then
  expect(staleWith({ ...TIED, code: null, graphicHtml: "0000000000000000" }, { ...PLACED, cue: { ...GRAPHIC, spec: { ...MOTION, html: null } } })).toEqual([null])
})

test("the sounds are listed in the order they play, the switched-off ones apart", () => {
  const late = { ...SOUND, anchor: speech(20_000_000, "b1") }
  const early = { ...SOUND, anchor: speech(11_000_000, "b1") }
  const result = inForce([late, { ...late, anchor: speech(19_000_000, "b1"), off: true }, TIED, early, { ...early, anchor: speech(10_500_000, "b1"), off: true }], { graphics: { kept: [PLACED], off: [] } })
  expect(result.kept.map((placed) => placed.atUs)).toEqual([1_000_000, 5_000_000, 10_000_000])
  expect(result.off.map((placed) => placed.atUs)).toEqual([500_000, 9_000_000])
})

/** Two sentences of one clip in beat b1, the second again in beat b2 (footage played twice); a word of the first has no rough-cut time of its own. */
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
      { text: "ยอด", startUs: 10_000_000, timelineUs: 0 },
      { text: "ขาย", startUs: 10_300_000 },
      { text: "เดือนนี้", startUs: 10_600_000, timelineUs: 600_000 },
    ],
  },
  { videoId: "v", beatId: "b1", beatName: "เปิด", from: 3, to: 5, text: "ล้านสองแสน", timelineUs: 1_500_000, timelineEndUs: 2_800_000, endUs: 12_800_000, words: [{ text: "ล้าน", startUs: 11_500_000, timelineUs: 1_500_000 }, { text: "สองแสน", startUs: 12_000_000, timelineUs: 2_000_000 }] },
  { videoId: "v", beatId: "b2", beatName: "ปิด", from: 3, to: 5, text: "ล้านสองแสน", timelineUs: 5_000_000, timelineEndUs: 6_300_000, endUs: 12_800_000, words: [{ text: "ล้าน", startUs: 11_500_000, timelineUs: 5_000_000 }, { text: "สองแสน", startUs: 12_000_000, timelineUs: 5_500_000 }] },
]

test("the words said on the rough cut are those of every sentence it plays, where each plays; those said while a sound plays are given in seconds from its start, to the millisecond", () => {
  const words = wordsOnCut(SENTENCES)
  expect(words).toEqual([
    { text: "ยอด", atUs: 0 },
    // with no time of its own, as long after its sentence's start as it was said
    { text: "ขาย", atUs: 300_000 },
    { text: "เดือนนี้", atUs: 600_000 },
    { text: "ล้าน", atUs: 1_500_000 },
    { text: "สองแสน", atUs: 2_000_000 },
    { text: "ล้าน", atUs: 5_000_000 },
    { text: "สองแสน", atUs: 5_500_000 },
  ])
  // from where a sound starts, for as long as it plays, across sentences: a word as it ends is out, and so is one before it starts
  expect(wordsWithin(words, 300_000, 1.7)).toEqual([
    { text: "ขาย", atS: 0 },
    { text: "เดือนนี้", atS: 0.3 },
    { text: "ล้าน", atS: 1.2 },
  ])
  expect(wordsWithin(words, 1_499_600, 0.5)).toEqual([{ text: "ล้าน", atS: 0 }])
  expect(wordsWithin(words, 1_500_000, 0.5)).toEqual([{ text: "ล้าน", atS: 0 }])
  expect(wordsWithin(words, 1_500_000, 0.501)).toEqual([{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.5 }])
  expect(wordsWithin(words, 3_000_000, 1)).toEqual([])
})

/** What a renderer status answers for a sound: ready, unless told otherwise; and what it was asked about. */
function statusOf(answer: { state: "pending" | "ready" | "failed"; error: string | null } = { state: "ready", error: null }) {
  const asked: ComposedSound[] = []
  return { status: (placed: PlacedComposed) => (asked.push(placed.sound), answer), asked }
}

test("the view of a composed sound says where it plays, what it does, from which level and how loud, whether it is written and fresh, and what its render made", () => {
  const { status, asked } = statusOf()
  const placed = inForce([{ ...SOUND, pointId: "p1" }])
  expect(composedViews(placed, status)).toEqual([
    {
      anchor: SOUND.anchor,
      atUs: 2_000_000,
      durationUs: 1_000_000,
      beatId: "b1",
      role: "เสียงติ๊งสองทีตามตัวเลขที่พูด",
      from: "medium",
      loudness: "normal",
      pointId: "p1",
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
  ])
  expect(asked).toEqual([{ ...SOUND, pointId: "p1" }])
  // one bound to no point says nothing of one
  expect(composedViews(inForce([SOUND]), status)[0]).not.toHaveProperty("pointId")
  // a render that failed says why
  expect(composedViews(inForce([SOUND]), statusOf({ state: "failed", error: "the sound took longer than 20 s to render" }).status)).toMatchObject([{ render: "failed", error: "the sound took longer than 20 s to render" }])
})

test("a sound with nothing to render waits with no error, and its render is not asked: not written yet, failed, stale or switched off; with no status to ask, a written fresh one waits too", () => {
  const failure = "the sound is silent: nothing above 1% of full scale"
  const unwritten = { ...SOUND, anchor: speech(13_000_000, "b1"), code: null }
  const failed = { ...SOUND, anchor: speech(14_000_000, "b1"), code: null, failed: failure }
  const stale = { ...SOUND, anchor: speech(15_000_000, "b1"), version: "sound-2026-01-01" }
  const off = { ...SOUND, anchor: speech(16_000_000, "b1"), off: true }
  const { status, asked } = statusOf({ state: "failed", error: "never asked" })
  const views = composedViews(inForce([unwritten, failed, stale, off]), status)
  expect(views.map((view) => [view.written, view.stale, view.writeFailed, view.off, view.render, view.error])).toEqual([
    [false, null, null, false, "pending", null],
    [false, null, failure, false, "pending", null],
    [true, "cut", null, false, "pending", null],
    [true, null, null, true, "pending", null],
  ])
  expect(asked).toEqual([])
  expect(composedViews(inForce([SOUND]))).toMatchObject([{ written: true, stale: null, render: "pending", error: null }])
})

test("a tied sound's view names its graphic by the graphic's idea, and is off while its graphic is; the switched-off sounds come after the ones that play", () => {
  const offGraphic: PlacedGraphic = { ...PLACED, cue: { ...GRAPHIC, off: true } }
  const early = { ...SOUND, anchor: speech(11_000_000, "b1"), off: true }
  const views = composedViews(inForce([TIED, early], { graphics: { kept: [], off: [offGraphic] } }), statusOf().status)
  expect(views.map((view) => [view.atUs, view.graphic, view.off, view.render])).toEqual([
    [1_000_000, null, true, "pending"],
    [5_000_000, { summary: "ตัวเลขวิ่งถึง 1,200,000" }, true, "pending"],
  ])
  const playing = composedViews(inForce([early, TIED], { graphics: { kept: [PLACED], off: [] } }), statusOf().status)
  expect(playing.map((view) => [view.atUs, view.graphic, view.off, view.render])).toEqual([
    [5_000_000, { summary: "ตัวเลขวิ่งถึง 1,200,000" }, false, "ready"],
    [1_000_000, null, true, "pending"],
  ])
  // stale by its picture, it waits
  expect(composedViews(inForce([{ ...TIED, graphicHtml: "0000000000000000" }], { graphics: { kept: [PLACED], off: [] } }), statusOf().status)).toMatchObject([{ stale: "picture", render: "pending" }])
})

test("the view shows a stored failure, change and failed edit as they are, and offers a step back only to a kept code", () => {
  // what a file holds there that is no code is nothing to go back to
  for (const odd of [7, { code: 7 }, { code: "function compose(ctx, cue, kit) { }" }]) {
    const sound = { ...SOUND, previous: odd } as unknown as ComposedSound
    expect(composedViews(inForce([sound])), JSON.stringify(odd)).toMatchObject([{ writeFailed: null, instruction: null, editFailed: null, canUndo: false }])
  }
  const previous = { code: "function compose(ctx, cue, kit) { }", seconds: 1, words: [], version: SOUND_VERSION }
  const edited = { ...SOUND, failed: "a", instruction: "เบาลง", editFailed: "c", previous }
  expect(composedViews(inForce([edited]))).toMatchObject([{ writeFailed: "a", instruction: "เบาลง", editFailed: "c", canUndo: true }])
})

test("what is placed carries the stored sound as it is, for whoever composes it again", () => {
  const [placed] = inForce([TIED], { graphics: { kept: [PLACED], off: [] } }).kept as [PlacedComposed]
  expect(placed.sound).toBe(TIED)
  expect(placed.graphic!.cue.spec.html).toBe(FRAGMENT)
})

test("a placed sound's render job is what is heard of it now: its code, length and loudness, and the words as they fall now, nothing else", () => {
  // the same words said a little later: still fresh, and rendered for their times now, as a graphic is
  const [placed] = inForce([{ ...SOUND, role: "อื่น", pointId: "p1", instruction: "ดังขึ้น" }], { wordsAt: said(["ล้าน", 0], ["สองแสน", 0.6]) }).kept
  expect(placed!.stale).toBeNull()
  const job = soundJobOf(placed!)
  expect(job).toEqual({ code: SOUND.code, seconds: 1, words: [{ text: "ล้าน", atS: 0 }, { text: "สองแสน", atS: 0.6 }], loudness: "normal" })
  // said as it was composed, the job is the one the writing's check rendered
  const [asComposed] = inForce([SOUND]).kept
  expect(hashOf(soundJobOf(asComposed!))).toBe(hashOf({ code: SOUND.code!, seconds: SOUND.seconds, words: SOUND.words, loudness: SOUND.loudness }))
  expect(hashOf(job)).not.toBe(hashOf(soundJobOf(asComposed!)))
})

test("a sound's render status is read from the renderer by that job: ready when its file is there, failed with the reason, else waiting", () => {
  const files = new Set<string>()
  const failures = new Map<string, string>()
  const renderer = { fileOf: (job: SoundJob) => `/sounds/${hashOf(job)}.wav`, failureOf: (job: SoundJob) => failures.get(hashOf(job)) ?? null }
  const status = soundStatusOf(renderer, (path) => files.has(path))
  const [placed] = inForce([SOUND]).kept
  expect(status(placed!)).toEqual({ state: "pending", error: null })
  failures.set(hashOf(soundJobOf(placed!)), "the code failed: boom")
  expect(status(placed!)).toEqual({ state: "failed", error: "the code failed: boom" })
  files.add(renderer.fileOf(soundJobOf(placed!)))
  expect(status(placed!)).toEqual({ state: "ready", error: null })
  // the same sound with its words said at other times is another file
  const [retimed] = inForce([SOUND], { wordsAt: said(["ล้าน", 0], ["สองแสน", 0.6]) }).kept
  expect(status(retimed!)).toEqual({ state: "pending", error: null })
})
