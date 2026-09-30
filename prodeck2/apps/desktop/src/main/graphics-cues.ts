import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { PointFilter } from "@boxblack/core/emphasis"
import type { CueAnchor, GroupLook } from "@boxblack/core/flair/plan"
import { dodgeKeepClear, mergeBands } from "@boxblack/core/graphics/framing"
import { motionWords } from "@boxblack/core/graphics/motion/direct"
import { frameKey, framesToAttach, type ExistingGraphic, type GraphicPoint, type GraphicSentence } from "@boxblack/core/graphics/motion/points"
import { enforceGraphics, GRAPHIC_MIN_US, isMotion, MOTION_VERSION, type GraphicBox, type GraphicCue, type MotionSpec, type MotionWord, type PlacedGraphic } from "@boxblack/core/graphics/plan"
import { layoutGroup, LINE_WIDTH_RATIO, type PlacedGroup, type TimedGroup } from "@boxblack/core/highlights"
import { HIGHLIGHT_FONTS, type HighlightFontId, type HighlightPosition, type HighlightStyle } from "@boxblack/core/highlights/styles"
import type { GraphicView } from "../shared/api.ts"
import type { RenderJob } from "./graphics-render.ts"
import { placementOf, pointAnchor, pointText, sceneAt } from "./highlight-state.ts"
import type { ItemPlace } from "./insert-media.ts"
import type { SpokenSentence } from "./spoken.ts"

/** A full-width band of the frame, as shares of its height from the top. */
export interface Band {
  fromY: number
  toY: number
}

/** A stretch of the rough cut, from its start to just before its end. */
export interface Span {
  startUs: number
  endUs: number
}

/** Where one group on the rough cut draws its text, the words it shows there, and when it is on screen. */
export interface GroupBand extends Span {
  groupId: string
  videoId: string
  beatId: string
  /** the emphasis point the group was made for; absent on one bound to none (the user's own) */
  pointId?: string
  /** its shown words [from, to) in the video's transcript */
  words: { from: number; to: number }
  band: Band
}

/** The family name each shipped highlight font declares, which the graphic's page asks for. */
const FONT_FAMILY: Record<HighlightFontId, string> = { kanit: "Kanit", mali: "Mali", chonburi: "Chonburi" }

const overlaps = (a: Span, b: Span) => a.startUs < b.endUs && b.startUs < a.endUs
const covers = (box: GraphicBox, band: Band) => box.y1 > band.fromY && box.y0 < band.toY

/**
 * The sentence a moment of speech is in: the same video, from its first word to its end (a last word
 * timed with no length included), in the moment's own beat — or, for one saved before graphics knew
 * their beat, the first sentence playing it. Unlike the sentence lookup in `placeOf`, which takes the
 * first sentence of the video whatever its beat, this honours the beat, so footage two beats both
 * play resolves to the sentence of the beat the moment was put in. A sentence that ends on a word timed
 * with no length holds that word's moment only when no sentence has the moment inside it: where the next
 * sentence begins at that very instant, the moment is the next one's first word.
 */
export function sentenceOf<T extends SpokenSentence>(sentences: T[], anchor: CueAnchor): T | null {
  if (anchor.kind !== "speech") return null
  // in the moment's video and beat, and begun by then
  const begun = (sentence: T) => sentence.videoId === anchor.videoId && (anchor.beatId === undefined || sentence.beatId === anchor.beatId) && sentence.words[0]!.startUs <= anchor.sourceUs
  // a sentence ending on a word timed with no length holds that word too
  const onLastWord = (sentence: T) => anchor.sourceUs === sentence.endUs && sentence.words.at(-1)!.startUs === sentence.endUs
  return sentences.find((sentence) => begun(sentence) && anchor.sourceUs < sentence.endUs) ?? sentences.find((sentence) => begun(sentence) && onLastWord(sentence)) ?? null
}

/**
 * Where each group on the rough cut draws its text, laid out as the preview and the write lay it
 * out (`placementOf` and `layoutGroup`, the shown lines trimmed as both draw them). A line's
 * transform y runs from +1 at the top of the frame to −1 at the bottom, and its height is the
 * font's line at its scale — `LINE_WIDTH_RATIO` of the canvas width at scale 1 — or its bar when
 * that is taller; both become shares of the frame height from the top. The band is rounded out to
 * hundredths: Claude reads it, and the layout is an estimate of CapCut's drawing anyway.
 */
export function textBands(input: {
  placed: PlacedGroup[]
  timed: TimedGroup[]
  clips: CutClip[]
  canvas: { width: number; height: number }
  font: HighlightFontId
  /** each group's look in force, by group id; a group with none is the plain stack */
  looks: Record<string, GroupLook>
  position: HighlightPosition
  subtitlesOn: boolean
}): GroupBand[] {
  const byId = new Map(input.placed.map((group) => [group.groupId, group]))
  const toHeight = input.canvas.width / input.canvas.height
  return input.timed.flatMap((group) => {
    const placed = byId.get(group.groupId)
    if (!placed) return []
    const placement = placementOf(placed, input.clips, input.position, input.subtitlesOn)
    const { lines } = layoutGroup(
      group.lines.map((line) => line.text.trim()),
      input.font,
      input.canvas,
      placement,
      input.looks[group.groupId]?.pattern,
    )
    if (lines.length === 0) return []
    const bands = lines.map((line) => {
      const tall = Math.max(LINE_WIDTH_RATIO * line.scale, line.bar?.height ?? 0) * toHeight
      const middle = (1 - line.y) / 2
      return { fromY: middle - tall / 2, toY: middle + tall / 2 }
    })
    const all = mergeBands(bands)!
    const band = { fromY: Math.max(0, Math.floor(all.fromY * 100 + 1e-9) / 100), toY: Math.min(1, Math.ceil(all.toY * 100 - 1e-9) / 100) }
    const shown = new Set(group.lines.map((line) => line.lineIndex))
    const words = placed.lines.filter((line) => shown.has(line.lineIndex)).map((line) => line.words)
    return [
      {
        groupId: group.groupId,
        videoId: placed.videoId,
        beatId: placed.beatId,
        ...(placed.pointId !== undefined ? { pointId: placed.pointId } : {}),
        words: { from: Math.min(...words.map((range) => range.from)), to: Math.max(...words.map((range) => range.to)) },
        band,
        startUs: group.startUs,
        endUs: group.endUs,
      },
    ]
  })
}

/**
 * Where the highlight text on screen at any moment of a span of the rough cut is drawn: every group showing then,
 * whatever sentence it is on. With `exceptPointId`, the groups made for that point are left out: a graphic on a
 * point takes the place of that point's text, so it is not kept off it. A group bound to no point is never left out.
 */
export const textBandsIn = (bands: GroupBand[], span: Span, exceptPointId?: string): Band[] =>
  bands.filter((entry) => overlaps(entry, span) && (exceptPointId === undefined || entry.pointId !== exceptPointId)).map((entry) => entry.band)

/**
 * The bands the video underneath must keep clear at any moment of a span of the rough cut: the face or
 * the product of every scene any piece plays inside it, across its cuts. A moment with no picture
 * analysed keeps nothing clear. `keepClearAt` in insert-media.ts is the same for a single moment.
 */
export function keepClearsIn(plan: CutPlan, clips: CutClip[], span: Span): Band[] {
  const bands: Band[] = []
  let start = 0
  for (const cut of plan.cuts) {
    const end = start + cut.sourceDurationUs
    if (span.startUs < end && start < span.endUs) {
      const source = { startUs: cut.sourceStartUs + Math.max(0, span.startUs - start), endUs: cut.sourceStartUs + Math.min(cut.sourceDurationUs, span.endUs - start) }
      const scenes = clips.find((clip) => clip.id === cut.binId)?.insight?.scenes ?? []
      for (const scene of scenes) if (scene.keepClear && overlaps(scene, source)) bands.push(scene.keepClear)
    }
    start = end
  }
  return bands
}

/**
 * A spoken sentence as a graphic's words are timed on: the scene playing at its first word, and where
 * each word plays on the rough cut. A word with no rough-cut time of its own (a sentence made by hand)
 * plays as long after the sentence's start as it was said.
 */
function graphicSentence(sentence: SpokenSentence, clips: CutClip[]): GraphicSentence {
  const first = sentence.words[0]!
  const scene = sceneAt(clips, sentence.videoId, first.startUs)
  return {
    videoId: sentence.videoId,
    beatId: sentence.beatId,
    atUs: sentence.timelineUs,
    text: sentence.text,
    words: sentence.words.map((word) => ({ text: word.text, startUs: word.startUs, timelineUs: word.timelineUs ?? sentence.timelineUs + word.startUs - first.startUs })),
    timelineEndUs: sentence.timelineEndUs,
    scene: scene ? { description: scene.description, kind: scene.kind, keepClear: scene.keepClear } : null,
  }
}

/**
 * The words said from a moment of speech on, for a length, on the rough cut as it is now: those of the sentence
 * that holds the moment, in its beat, picked and timed by core's `motionWords` on the sentence as a graphic's plan
 * is shown it (`graphicSentence`), so placing a motion graphic finds its words the way planning it did. A moment
 * no sentence holds has none: a scene point's, on a picture beat, where nothing is said.
 */
export function wordsSaidFrom(input: { sentences: SpokenSentence[]; clips: CutClip[] }): (anchor: CueAnchor, seconds: number) => MotionWord[] {
  return (anchor, seconds) => {
    if (anchor.kind !== "speech") return []
    const sentence = sentenceOf(input.sentences, anchor)
    return sentence ? motionWords(graphicSentence(sentence, input.clips), anchor.sourceUs, seconds) : []
  }
}

/**
 * The placed points as Claude is shown them for graphics, in playing order. A speech point comes with
 * the sentence its first kept moment is in, in its own beat (`sentenceOf`), whose words a graphic on it
 * is written for; one whose sentence is not on the cut is shown with no sentence, as a scene point is.
 * Every point carries the scene playing at its first kept moment, and where its own highlight text is
 * drawn: the text of the groups made for it, together, which a graphic put on it takes the place of.
 * Text made for another point, or bound to none, is not told as the point's, whatever sentence it is on.
 */
export function graphicPoints(input: { points: PlacedPoint[]; sentences: SpokenSentence[]; clips: CutClip[]; bands: GroupBand[] }): GraphicPoint[] {
  return input.points.map((placed) => {
    const anchor = pointAnchor(placed)
    const spoken = placed.point.anchor.kind === "speech" ? sentenceOf(input.sentences, anchor) : null
    const sentence = spoken ? graphicSentence(spoken, input.clips) : null
    const scene = sceneAt(input.clips, placed.videoId, placed.sourceUs)
    return {
      pointId: placed.point.id,
      kind: placed.point.anchor.kind,
      importance: placed.point.importance,
      type: placed.point.type,
      reason: placed.point.reason,
      videoId: placed.videoId,
      beatId: placed.beatId,
      atUs: placed.atUs,
      timelineEndUs: placed.endUs,
      anchor,
      text: pointText(placed, input.clips),
      sentence,
      scene: scene ? { description: scene.description, kind: scene.kind, keepClear: scene.keepClear } : null,
      textBand: mergeBands(input.bands.filter((entry) => entry.pointId === placed.point.id).map((entry) => entry.band)),
    }
  })
}

/**
 * The frames worth extracting for the graphics call. Each point is shown at its first kept moment on the
 * source, so Claude sees the picture as it is when the point begins, and points starting at the same
 * moment of the same video — footage played twice — share one. Those moments go through core's
 * `framesToAttach`, so only the ones the call will really attach are extracted: at most a dozen, spread
 * over the points Claude may put a graphic on — none in `taken` (point numbers from 1, the user's own).
 * `keys` names each point's moment by its `frameKey`; `wanted` lists the chosen moments by video, in clip
 * order.
 */
export function framesWanted(points: GraphicPoint[], taken: Set<number> = new Set()): { keys: Record<string, string>; wanted: Map<string, { name: string; sourceUs: number }[]> } {
  const keys: Record<string, string> = {}
  const moments = new Map<string, { videoId: string; sourceUs: number }>()
  points.forEach((point, index) => {
    if (point.anchor.kind !== "speech") return
    const name = JSON.stringify([point.videoId, point.anchor.sourceUs])
    moments.set(name, { videoId: point.videoId, sourceUs: point.anchor.sourceUs })
    keys[frameKey(point, index)] = name
  })
  const wanted = new Map<string, { name: string; sourceUs: number }[]>()
  for (const { path: name } of framesToAttach(points, keys, taken)) {
    const moment = moments.get(name)!
    wanted.set(moment.videoId, [...(wanted.get(moment.videoId) ?? []), { name, sourceUs: moment.sourceUs }])
  }
  return { keys, wanted }
}

/**
 * Whether an entry of the stored graphics is a graphic at all: something on a place. What is read is an outline
 * file, which is outside the type system: an entry that is null, or has no place, is none, and is left out
 * wherever the stored graphics are read (placed, shown, or merged with a new plan, which so takes it away).
 */
export const isGraphicEntry = (cue: GraphicCue | null | undefined): cue is GraphicCue => typeof cue === "object" && cue !== null && typeof cue.anchor === "object" && cue.anchor !== null

/**
 * Whether an entry of the stored graphics is a motion graphic on a place, the one kind the app plays: an entry
 * that is no graphic at all, and one of another kind (a file edited by hand, a kind a later version stores), are
 * both left out wherever graphics are placed or shown.
 */
const isMotionCue = (cue: GraphicCue | null | undefined): cue is GraphicCue => isGraphicEntry(cue) && isMotion(cue.spec)

/**
 * The graphics the user put or changed by hand, as Claude is shown them: by the number of the point they
 * sit on (the point their pointId names, or for one bound to no point, the first point whose sentence
 * holds its moment, in its beat), with what they draw, which is their idea. One switched off still keeps
 * Claude off its point; one on no point shown is not shown, and neither is a stored entry that is no
 * motion graphic on a place (`isMotionCue`), which has no idea to show and plays nowhere (`graphicsInForce`).
 */
export function existingGraphics(graphics: GraphicCue[], points: GraphicPoint[]): ExistingGraphic[] {
  const holds = (point: GraphicPoint, anchor: CueAnchor) => {
    const words = point.sentence?.words ?? []
    if (anchor.kind !== "speech" || words.length === 0) return false
    const beatOk = anchor.beatId === undefined || anchor.beatId === point.beatId
    return point.videoId === anchor.videoId && beatOk && words[0]!.startUs <= anchor.sourceUs && anchor.sourceUs <= words.at(-1)!.startUs
  }
  return graphics.flatMap((graphic) => {
    if (!isMotionCue(graphic) || !graphic.edited) return []
    const index = graphic.pointId !== undefined ? points.findIndex((point) => point.pointId === graphic.pointId) : points.findIndex((point) => holds(point, graphic.anchor))
    if (index < 0) return []
    return [{ point: index + 1, summary: graphic.spec.idea, off: graphic.off }]
  })
}

/** A box moved off every band it would cover: those it covers are merged and dodged as one, and again with any the move lands it on. */
function dodgeAll(box: GraphicBox, bands: Band[]): GraphicBox {
  let hit = bands.filter((band) => covers(box, band))
  let moved = box
  while (hit.length > 0) {
    moved = dodgeKeepClear(box, mergeBands(hit))
    const more = bands.filter((band) => !hit.includes(band) && covers(moved, band))
    if (more.length === 0) break
    hit = [...hit, ...more]
  }
  return moved
}

/**
 * Where a box goes clear of what it must not cover: off the faces (or products) and the highlight
 * text on screen while it plays, and off the subtitles' room too when there is space. When there is none for all
 * three, the subtitles give way — the face and the text never do — and when there is none even for
 * those two, there is nowhere: null. Known limit: `keepClear` is a share of the source frame while
 * boxes are shares of the canvas; they agree when the footage fills the canvas (the usual case,
 * portrait footage on a portrait canvas), but on a letterboxed or zoomed piece the dodge can be off.
 * Not handled in v1.
 */
function dodgeBands(box: GraphicBox, never: Band[], subtitles: Band | null): GraphicBox | null {
  const everything = subtitles ? [...never, subtitles] : never
  const moved = dodgeAll(box, everything)
  if (!everything.some((band) => covers(moved, band))) return moved
  const onSubtitles = dodgeAll(box, never)
  return never.some((band) => covers(onSubtitles, band)) ? null : onSubtitles
}

/**
 * A length in microseconds as the seconds a graphic playing that long is written and rendered for: to the
 * millisecond below, never rounded up past where it is cut. A word's time is counted in milliseconds too, so
 * a motion graphic stored with this length has, when it is placed again, the words it had when it was written.
 */
export const renderSeconds = (durationUs: number): number => Math.floor(durationUs / 1_000) / 1_000

/**
 * How far before its written length is up the piece playing a written motion graphic may end and the graphic
 * still play its whole length, on into the next piece. A piece's end moves without a word changing: by up to
 * about 0.3 s when the cut preset changes and loudness is measured, by 0.21 s when a pause is cut out of the
 * sentence. The graphic is on its way out by then, so it runs on, as one shorter than GRAPHIC_MIN_US already
 * does, rather than go stale over a change it does not show.
 */
const MOTION_RUN_ON_US = 300_000

/**
 * How far short of its written length a written motion graphic may be cut and still be fresh: the figure of
 * the contract it was written under, by which its way out is over, and nothing is drawn, 0.1 s before its end.
 */
const MOTION_CUT_SHORT_US = 100_000

/**
 * A placed motion graphic with the words said now while it plays, and whether it is stale: written, and no longer
 * played as it was written for. It was written for its words in their order, so another word now, a word more or
 * a word fewer makes it stale; the same words said at other times do not, since its page is handed their times
 * now. It was written for its length: playing `playsUs`, more than MOTION_CUT_SHORT_US short of that, its file
 * would be cut before its way out, and the times typed into a fragment cannot be moved without Claude. And it
 * was written under a contract, for a page and a host: under another than the app's now (MOTION_VERSION), it
 * is to be written again. One not written yet has nothing to be stale: it is written for the words, the room
 * and the contract there are when it is.
 */
function withWordsNow(graphic: PlacedGraphic, spec: MotionSpec, wordsNow: MotionWord[], playsUs: number): PlacedGraphic {
  const reworded = wordsNow.length !== spec.words.length || wordsNow.some((word, i) => word.text !== spec.words[i]!.text)
  const short = Math.round(spec.seconds * 1_000_000) - playsUs > MOTION_CUT_SHORT_US
  return { ...graphic, wordsNow, stale: spec.html !== null && (spec.version !== MOTION_VERSION || reworded || short) }
}

/**
 * The graphics that will really play: the stored ones whose place is still on the rough cut, each for
 * its seconds or until the piece playing its sentence ends, whichever comes first — past that piece the
 * picture may be another take, scene or video — but never for less than the shortest a graphic may be:
 * one whose piece leaves less than that plays that long all the same, running on into the next piece,
 * rather than being lost to a flash. Their boxes are moved off what the picture must keep clear and the
 * highlight text on screen at any time while they play, whatever sentence it is on, and off the
 * subtitles (see `dodgeBands`), at the size they have; then they are put through the rules. The text of
 * a graphic's own point is not text it is moved off: it takes that text's place (`replacesText`), so it
 * may sit where that text is drawn. One made for no point is moved off all text. A cutaway
 * playing at the same time takes nothing from them: each goes on a track of its own. One on an emphasis
 * point the level hides is neither in force, listed as off, nor dropped. Each is placed with its point
 * (itemPlaceOf): one whose moment the cut took out plays where its point starts now, and lasts by the
 * sentence there. One with no clear place, or whose place is gone, is counted as dropped. The ones
 * switched off are not counted: `off` lists those whose place is still there, placed and moved the same
 * way (or left where they were stored when nowhere is clear), so the screen can offer to switch them
 * back on. The rules are applied as a graphic is read, not to what is stored.
 *
 * What is read is an outline file, which is outside the type system: a stored entry that is no motion
 * graphic on a place (`isMotionCue`: a file edited by hand, a kind a later version stores, an entry that is
 * null or has no place) is left out, neither placed, listed as off, nor counted as dropped.
 *
 * A written graphic whose piece ends a little before its length is up (MOTION_RUN_ON_US) plays its
 * whole length all the same, on into the next piece, and keeps clear of what is on screen there; only
 * the end of the rough cut cuts it. Each carries the words said now while it plays (`wordsFrom`, asked
 * from the moment it plays by for the length every rule has left it, as `renderSeconds`) and says
 * whether it is stale (`withWordsNow`). Stale or not written yet, it is still placed and listed, kept
 * or switched off as it is, since the screen shows it and offers to write it again; it has no render
 * job (`graphicJob`), so nothing renders it and a write leaves it out.
 */
export function graphicsInForce(input: {
  graphics: GraphicCue[]
  place: (anchor: CueAnchor, pointId?: string) => ItemPlace | null
  flair: FlairOptions
  durationUs: number
  /** which items show: one on no point, or on a point placed on this rough cut whose importance the level lets through; one on a point cut away, deleted or on an earlier transcript does not */
  passes: PointFilter
  /** where the piece playing the sentence a graphic sits on ends, on the rough cut; null when that is not known */
  pieceEndOf: (anchor: CueAnchor) => number | null
  /** the bands the picture must keep clear at any moment of a span of the rough cut */
  keepClearIn: (span: Span) => Band[]
  /** where the highlight text on screen at any moment of a span of the rough cut is drawn, less the text of the groups made for the point named, which is the graphic's own (`textBandsIn`) */
  textIn: (span: Span, pointId?: string) => Band[]
  /** the words said from a moment on, within that many seconds of it, on the rough cut as it is now, each with its seconds from that moment; none where no sentence holds the moment (`wordsSaidFrom`) */
  wordsFrom: (anchor: CueAnchor, seconds: number) => MotionWord[]
  /** where the room kept for subtitles starts, when they are on */
  captionsFromY: number | null
}): { kept: PlacedGraphic[]; dropped: number; off: PlacedGraphic[] } {
  if (!input.flair.graphic) return { kept: [], dropped: 0, off: [] }
  const subtitles = input.captionsFromY === null ? null : { fromY: input.captionsFromY, toY: 1 }
  const placed: PlacedGraphic[] = []
  const off: PlacedGraphic[] = []
  let gone = 0
  for (const cue of input.graphics) {
    // a stored entry that is no graphic the app draws plays nowhere and is no loss to count
    if (!isMotionCue(cue)) continue
    if (!input.passes(cue.pointId)) continue
    const where = input.place(cue.anchor, cue.pointId)
    if (!where) {
      if (!cue.off) gone++
      continue
    }
    const secondsUs = Math.round(cue.spec.seconds * 1_000_000)
    // the sentence of the moment it plays at, which is its point's start when its own moment was cut
    const pieceEndUs = input.pieceEndOf(where.by)
    const roomUs = pieceEndUs === null ? secondsUs : Math.min(secondsUs, Math.max(pieceEndUs - where.atUs, GRAPHIC_MIN_US))
    // a written graphic with a little less room than it was written for plays its whole length all the same
    const durationUs = cue.spec.html !== null && secondsUs - roomUs <= MOTION_RUN_ON_US ? secondsUs : roomUs
    const span = { startUs: where.atUs, endUs: where.atUs + durationUs }
    const box = dodgeBands(cue.spec.box, [...input.keepClearIn(span), ...input.textIn(span, cue.pointId)], subtitles)
    if (box === null && !cue.off) {
      gone++
      continue
    }
    const moved = box === null || box === cue.spec.box ? cue : { ...cue, spec: { ...cue.spec, box } }
    const at: PlacedGraphic = { cue: moved, atUs: where.atUs, durationUs }
    if (cue.off) off.push(at)
    else placed.push(at)
  }
  const { kept, dropped } = enforceGraphics(placed, input.durationUs)
  // a graphic's words are found last, for the length the rules left it (`playsUs`), from the moment it plays
  // by: its own, or its point's start when its own was cut. The length is asked for as `renderSeconds` gives it, the
  // length a graphic is written for, so one written for these words is given the same words when it is placed again
  const worded = (graphic: PlacedGraphic, playsUs: number): PlacedGraphic => {
    const { by } = input.place(graphic.cue.anchor, graphic.cue.pointId)!
    return withWordsNow(graphic, graphic.cue.spec, input.wordsFrom(by, renderSeconds(playsUs)), playsUs)
  }
  return {
    kept: kept.map((graphic) => worded(graphic, graphic.durationUs)),
    dropped: dropped + gone,
    // a switched-off one is listed for as long as it was, and judged by the length it would get switched on, which
    // the end of the rough cut may cut short, so that switching it on does not make it stale
    off: off.map((graphic) => worded(graphic, Math.max(0, Math.min(graphic.durationUs, input.durationUs - graphic.atUs)))),
  }
}

/** Whether a placed graphic has something to render: it is written, and `graphicsInForce` found it fresh where it placed it. */
const hasJob = (graphic: PlacedGraphic): boolean => graphic.cue.spec.html !== null && graphic.stale === false

/**
 * What the renderer is asked for: the graphic's spec as placed, drawn in the font and colours of the
 * highlight style in force, with the times its words are said at now, which its page hands the fragment.
 * It is rendered from the fragment Claude wrote for it and never made shorter: the times typed into a
 * fragment are for the length it was written for. One with nothing to render has no job, null: not
 * written yet, or stale, which is rendered again only once it is written again. Only one
 * `graphicsInForce` found fresh has a job: one that was never judged there has none.
 */
export function graphicJob(graphic: PlacedGraphic, args: { canvas: { width: number; height: number }; fps: number; style: HighlightStyle }): RenderJob | null {
  const spec = graphic.cue.spec
  if (!hasJob(graphic)) return null
  return {
    spec,
    canvas: args.canvas,
    fps: args.fps,
    font: { family: FONT_FAMILY[args.style.font], file: HIGHLIGHT_FONTS[args.style.font] },
    palette: args.style.palette,
    times: (graphic.wordsNow ?? []).map((word) => word.atS),
  }
}

/**
 * Whether a graphic `graphicsInForce` kept takes the place of its point's highlight text: it is made for a
 * point and has a render job (`graphicJob`), so it is switched on, its point passes the level, it has a place
 * and room on the frame, it is written and it is not stale. One that is not written, stale, switched off,
 * hidden by the level or dropped for lack of room leaves the text drawn, so a point never stands empty
 * because its graphic could not be made. The preview and the write both judge by the job, not by a finished
 * render, or the two would disagree about what is written: a render that fails at write time leaves its point
 * with neither text nor graphic in that write, which reports the graphic as skipped.
 */
export const replacesText = (graphic: PlacedGraphic): boolean => graphic.cue.pointId !== undefined && hasJob(graphic)

/** The points whose highlight text a graphic takes the place of, read from the graphics `graphicsInForce` kept. */
export const replacedPoints = (graphics: { kept: PlacedGraphic[] }): Set<string> => new Set(graphics.kept.filter(replacesText).map((graphic) => graphic.cue.pointId!))

/**
 * Whether a highlight group is replaced: it was made for one of the replaced points (`replacedPoints`), so it
 * is not drawn while that point's graphic plays in the clip. Every group of such a point is; one bound to no
 * point never is.
 */
export const isReplaced = (group: { pointId?: string }, replaced: ReadonlySet<string>): boolean => group.pointId !== undefined && replaced.has(group.pointId)

/**
 * The graphics as the post-production page shows them, the switched-off ones last, each named by where it plays
 * — `place` must be the one graphicsInForce placed them with — and carrying its stored anchor, which an edit
 * finds it by; the render state and poster are the caller's to fill in. Each is summed up by its idea, which it
 * was written from, and says whether it is written, whether it is stale, and why its last writing failed; and, of the
 * user's edits, the change that made its fragment, why the last edit failed, and whether a fragment is kept to go
 * back to.
 */
export function graphicViews(graphics: { kept: PlacedGraphic[]; off: PlacedGraphic[] }, place: (anchor: CueAnchor, pointId?: string) => ItemPlace | null): Omit<GraphicView, "render" | "poster" | "error">[] {
  return [...graphics.kept, ...graphics.off].map((graphic) => {
    const where = place(graphic.cue.anchor, graphic.cue.pointId)!
    const spec = graphic.cue.spec
    return {
      anchor: graphic.cue.anchor,
      atUs: graphic.atUs,
      durationUs: graphic.durationUs,
      what: where.what,
      beatId: where.beatId,
      why: spec.why,
      summary: spec.idea,
      spec,
      written: spec.html !== null,
      stale: graphic.stale === true,
      writeFailed: spec.failed ?? null,
      instruction: spec.instruction ?? null,
      editFailed: spec.editFailed ?? null,
      canUndo: spec.previous !== undefined,
      edited: graphic.cue.edited,
      off: graphic.cue.off,
      ...(graphic.cue.pointId !== undefined ? { pointId: graphic.cue.pointId } : {}),
    }
  })
}
