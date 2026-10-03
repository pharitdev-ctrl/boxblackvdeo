import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"
import { FLAIR_LEVELS, type FlairOptions } from "@boxblack/core/flair/catalogue"
import type { PointFilter } from "@boxblack/core/emphasis"
import type { CueAnchor, GroupLook } from "@boxblack/core/flair/plan"
import { dodgeKeepClear, mergeBands } from "@boxblack/core/graphics/framing"
import { motionWords } from "@boxblack/core/graphics/motion/direct"
import type { FreeClip } from "@boxblack/core/graphics/motion/free"
import { frameKey, framesToAttach, type GraphicPoint, type GraphicSentence } from "@boxblack/core/graphics/motion/points"
import { COVER_MAX_US, enforceGraphics, FREE_GRAPHIC_MIN_US, GRAPHIC_MIN_US, isFree, isMotion, isPrevious, MOTION_VERSION, type GraphicBox, type GraphicCue, type MotionSpec, type MotionWord, type PlacedGraphic } from "@boxblack/core/graphics/plan"
import { layoutGroup, LINE_WIDTH_RATIO, type PlacedGroup, type TimedGroup } from "@boxblack/core/highlights"
import { HIGHLIGHT_FONTS, type HighlightFontId, type HighlightPosition, type HighlightStyle } from "@boxblack/core/highlights/styles"
import type { GraphicView } from "../shared/api.ts"
import type { RenderJob } from "./graphics-render.ts"
import { placementOf, pointAnchor, pointText, sceneAt } from "./highlight-state.ts"
import type { ItemPlace } from "./insert-media.ts"
import { faceBandIn, faceBoxesIn, type PlacedMove } from "./move-cues.ts"
import type { SpokenSentence } from "./spoken.ts"
import { OBJECTS_VERSION, type SceneObject } from "@boxblack/core/vision"

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
export const FONT_FAMILY: Record<HighlightFontId, string> = { kanit: "Kanit", mali: "Mali", chonburi: "Chonburi" }

const overlaps = (a: Span, b: Span) => a.startUs < b.endUs && b.startUs < a.endUs
const covers = (box: GraphicBox, band: Band) => box.y1 > band.fromY && box.y0 < band.toY

/** Whether two boxes overlap with an area: on both axes at once. Two that only touch along an edge do not. */
export const boxesOverlap = (a: GraphicBox, b: GraphicBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

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
  /** where the faces are over a stretch once the picture has moved (`zoomedFaces`' bandIn), which `placementOf` keeps the text off while each group is on screen */
  faceBand?: (span: Span) => Band | null
}): GroupBand[] {
  const byId = new Map(input.placed.map((group) => [group.groupId, group]))
  const toHeight = input.canvas.width / input.canvas.height
  return input.timed.flatMap((group) => {
    const placed = byId.get(group.groupId)
    if (!placed) return []
    const faceBand = input.faceBand
    const placement = placementOf(placed, input.clips, input.position, input.subtitlesOn, faceBand && (() => faceBand({ startUs: group.startUs, endUs: group.endUs })))
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
  return scenesPlayedIn(plan, clips, span).flatMap(({ scene }) => (scene.keepClear ? [scene.keepClear] : []))
}

/** Every scene any piece plays inside a span of the rough cut, across its cuts, with its clip and its place in the clip's scenes. */
function scenesPlayedIn(plan: CutPlan, clips: CutClip[], span: Span) {
  const played: { clip: CutClip; scene: NonNullable<CutClip["insight"]>["scenes"][number]; index: number }[] = []
  let start = 0
  for (const cut of plan.cuts) {
    const end = start + cut.sourceDurationUs
    if (span.startUs < end && start < span.endUs) {
      const source = { startUs: cut.sourceStartUs + Math.max(0, span.startUs - start), endUs: cut.sourceStartUs + Math.min(cut.sourceDurationUs, span.endUs - start) }
      const clip = clips.find((one) => one.id === cut.binId)
      clip?.insight?.scenes.forEach((scene, index) => {
        if (overlaps(scene, source)) played.push({ clip, scene, index })
      })
    }
    start = end
  }
  return played
}

/**
 * The boxes the picture must keep clear at any moment of a span of the rough cut, for a free graphic: those of the
 * things to keep (a face, a thing shown) the objects pass found in every scene any piece plays inside it. A video the
 * pass has not run on keeps each scene's keepClear band instead, across the whole width, and so does a scene the
 * objects found miss (objects out of step with the scenes); a scene with neither keeps nothing. A thing found only to
 * be pointed at is never kept clear.
 */
export function keepBoxesIn(plan: CutPlan, clips: CutClip[], span: Span): GraphicBox[] {
  return scenesPlayedIn(plan, clips, span).flatMap(({ clip, scene, index }) => {
    const objects = clip.objects?.scenes[index]
    if (objects) return objects.filter((object) => object.kind === "keep").map((object) => object.box)
    return scene.keepClear ? [{ x0: 0, y0: scene.keepClear.fromY, x1: 1, y1: scene.keepClear.toY }] : []
  })
}

/**
 * Where the faces and the things shown are once the picture has moved (spec §6), under the moves of the picture in
 * force (`moves`, movesInForce's kept list, placed with `at`), for the highlight text and the free graphics to keep
 * off, and for Claude to be told of. A move on a main piece moves the picture from its start to its piece's end (it
 * holds its last pose there); a stretch no move reaches is as it was before moves.
 *
 * - `bandIn` is the band the text keeps off over a stretch it is on screen: where a move reaches the stretch, the
 *   faces after the moves (`faceBandIn`) joined with the scenes' keepClear bands over the parts of it no move
 *   reaches, so text beside a move never keeps off less than it did; null where no move reaches it, or where the
 *   faces after the moves are none, and `placementOf` then keeps to the scenes' bands as before.
 * - `keepIn` are the boxes a free graphic keeps off: the faces and things shown after the moves (`faceBoxesIn`) where a
 *   move reaches the span, else the plain boxes (`keepBoxesIn`).
 * - `facesIn` are the faces alone after the moves over a span a move reaches, null over one none does.
 */
export function zoomedFaces(input: {
  moves: PlacedMove[]
  plan: CutPlan
  clips: CutClip[]
  canvas: { width: number; height: number }
  /** where a source time of a kept piece plays on the rough cut, as the moves were placed */
  at: (cut: number, sourceUs: number) => number
}): { bandIn: (span: Span) => Band | null; keepIn: (span: Span) => GraphicBox[]; facesIn: (span: Span) => GraphicBox[] | null } {
  const { moves, plan, clips, canvas, at } = input
  // the stretches of the rough cut each move moves the picture over, from its start to its piece's end
  const playing = moves.flatMap((move) => (move.cut !== undefined ? [{ startUs: move.atUs, endUs: move.atUs - move.startUs + plan.cuts[move.cut]!.sourceDurationUs }] : []))
  const moved = (span: Span) => playing.some((stretch) => overlaps(stretch, span))
  // the parts of a span no move reaches
  const still = (span: Span): Span[] =>
    playing
      .filter((stretch) => overlaps(stretch, span))
      .sort((a, b) => a.startUs - b.startUs)
      .reduce<Span[]>(
        (parts, stretch) => parts.flatMap((part) => (overlaps(part, stretch) ? [{ startUs: part.startUs, endUs: stretch.startUs }, { startUs: stretch.endUs, endUs: part.endUs }].filter((left) => left.startUs < left.endUs) : [part])),
        [span],
      )
  // only the faces of each clip: the keep objects the pass marked as faces, or every one of a pass made before faces
  const faceClips = clips.map((clip) =>
    clip.objects
      ? { ...clip, objects: { ...clip.objects, scenes: clip.objects.scenes.map((objects) => objects.filter((object) => object.kind === "keep" && (clip.objects!.version !== OBJECTS_VERSION || object.face === true))) } }
      : clip,
  )
  return {
    bandIn: (span) => {
      if (!moved(span)) return null
      const zoomed = faceBandIn(span, moves, plan, clips, canvas, at)
      if (!zoomed) return null
      return mergeBands([zoomed, ...still(span).flatMap((part) => keepClearsIn(plan, clips, part))])
    },
    keepIn: (span) => (moved(span) ? faceBoxesIn(span, moves, plan, clips, canvas, at) : keepBoxesIn(plan, clips, span)),
    facesIn: (span) => (moved(span) ? faceBoxesIn(span, moves, plan, faceClips, canvas, at) : null),
  }
}

/**
 * The scenes on the rough cut as Claude is shown them for free graphics: each scene of each kept piece, timed by the
 * part of it the piece plays, with what the objects pass found in it (null for a video it has not run on, or a scene
 * the objects found miss). A scene that goes on into the next piece with nothing between, as when a pause is cut from
 * the middle of it, is one entry, not two. With `facesIn` (`zoomedFaces`), a scene with objects that a move of the
 * picture plays over has its faces listed where the moves put them, as keep objects named "หน้า (หลังซูม)", in place
 * of the faces the pass found (spec §6); its other objects stay as they are.
 */
export function scenesOnCut(plan: CutPlan, clips: CutClip[], facesIn?: (span: Span) => GraphicBox[] | null): FreeClip["scenes"] {
  const entries: (FreeClip["scenes"][number] & { videoId: string; index: number })[] = []
  let start = 0
  for (const cut of plan.cuts) {
    const clip = clips.find((one) => one.id === cut.binId)
    const sourceEndUs = cut.sourceStartUs + cut.sourceDurationUs
    clip?.insight?.scenes.forEach((scene, index) => {
      const fromUs = Math.max(scene.startUs, cut.sourceStartUs)
      const toUs = Math.min(scene.endUs, sourceEndUs)
      if (fromUs >= toUs) return
      const startUs = start + fromUs - cut.sourceStartUs
      const endUs = start + toUs - cut.sourceStartUs
      const last = entries.at(-1)
      if (last && last.videoId === clip.id && last.index === index && last.endUs === startUs) {
        last.endUs = endUs
        return
      }
      const objects = clip.objects?.scenes[index] ?? null
      entries.push({ videoId: clip.id, index, startUs, endUs, kind: scene.kind, description: scene.description, keepClear: scene.keepClear, objects })
    })
    start += cut.sourceDurationUs
  }
  return entries.map(({ videoId, index: _index, ...scene }) => {
    const zoomed = scene.objects && facesIn?.(scene)
    if (!zoomed) return scene
    // pushed in or panned over: the faces where the moves put them, in place of the faces as the pass found them. A
    // face a piece of the scene plays as it is (no move there) keeps its own name, once
    const before = clips.find((clip) => clip.id === videoId)!.objects!.version !== OBJECTS_VERSION
    const isFace = (object: SceneObject) => object.kind === "keep" && (before || object.face === true)
    const found = scene.objects!.filter(isFace)
    const same = (a: GraphicBox, b: GraphicBox) => Math.abs(a.x0 - b.x0) + Math.abs(a.y0 - b.y0) + Math.abs(a.x1 - b.x1) + Math.abs(a.y1 - b.y1) < 1e-9
    const faces = [...new Set(zoomed.map((box) => found.find((object) => same(object.box, box)) ?? { what: "หน้า (หลังซูม)", kind: "keep" as const, box, still: false, face: true }))]
    return { ...scene, objects: [...faces, ...scene.objects!.filter((object) => !isFace(object))] }
  })
}

/** What a free graphic is judged by where it plays: the highlight text and the things to keep clear on screen while it does. */
export interface FreeRoom {
  /** bands of highlight text on screen in the span, with the point each group was made for */
  textIn: (span: Span) => { band: Band; pointId?: string }[]
  /** the bands of one point's own text on screen in the span with every point shown, whatever the level: what covering is judged by, so a level that hides the point's text does not change it */
  ownTextIn: (span: Span, pointId: string) => Band[]
  keepIn: (span: Span) => GraphicBox[]
}

/** Whether a free graphic tied to a point covers that point's own text while it plays over a span (`FreeRoom.ownTextIn`). */
const coveringIn = (cue: GraphicCue, span: Span, room: FreeRoom): boolean => cue.pointId !== undefined && room.ownTextIn(span, cue.pointId).some((band) => covers(cue.spec.box, band))

/** The highlight text on screen at any moment of a span of the rough cut, each band with the point its group was made for: a free graphic's `FreeRoom.textIn`. */
export const textGroupsIn = (bands: GroupBand[], span: Span): { band: Band; pointId?: string }[] =>
  bands.filter((entry) => overlaps(entry, span)).map((entry) => (entry.pointId !== undefined ? { band: entry.band, pointId: entry.pointId } : { band: entry.band }))

/** The bands of one point's own text on screen at any moment of a span of the rough cut: a free graphic's `FreeRoom.ownTextIn`, over the bands with every point shown. */
export const ownBandsIn = (bands: GroupBand[], span: Span, pointId: string): Band[] => bands.filter((entry) => entry.pointId === pointId && overlaps(entry, span)).map((entry) => entry.band)

/** The groups of one point's own text that a box covers at any moment of a span of the rough cut: the text a free graphic over them takes the place of. */
export const ownGroupsCovered = (bands: GroupBand[], span: Span, pointId: string, box: GraphicBox): GroupBand[] =>
  bands.filter((entry) => entry.pointId === pointId && overlaps(entry, span) && covers(box, entry.band))

/**
 * Whether a free graphic has room where it plays, its box as it was planned, never moved. It is gone when its box
 * covers the band of a highlight text group of another point, or of one made for no point: text stays on screen
 * beside a free graphic, so it must not be drawn over; its own point's text is no other. It is covering when it is
 * tied to a point and its box covers a band of that point's own text as drawn with every point shown, which it then
 * takes the place of (`replaces`). It covers a thing to keep when its
 * box overlaps one of the span's keep boxes with an area, and so plays no longer than COVER_MAX_US. The subtitles are
 * no part of its room: they are drawn over every graphic.
 */
export function roomOf(cue: GraphicCue, span: Span, room: FreeRoom): { gone: true } | { gone: false; covering: boolean; coversKeep: boolean } {
  const box = cue.spec.box
  if (room.textIn(span).some((text) => covers(box, text.band) && (cue.pointId === undefined || text.pointId !== cue.pointId))) return { gone: true }
  return { gone: false, covering: coveringIn(cue, span, room), coversKeep: room.keepIn(span).some((keep) => boxesOverlap(box, keep)) }
}

/** Whether two placed graphics are on screen together in the same place: their times overlap, and so do their boxes. */
const clash = (a: { span: Span; box: GraphicBox }, b: { span: Span; box: GraphicBox }) => overlaps(a.span, b.span) && boxesOverlap(a.box, b.box)
const spanOf = (graphic: PlacedGraphic) => ({ span: { startUs: graphic.atUs, endUs: graphic.atUs + graphic.durationUs }, box: graphic.cue.spec.box })

/**
 * Claude's free graphics as they are stored: those of `cues` that have room where they play, in time order. One is
 * dropped, and counted, when it has no place on the cut (`placedOf`); when `roomOf` finds it gone; when it is tied to
 * a point and starts while none of that point's text is on screen (with every point shown), since it tells that
 * point's story, though it would play over that text later; and when it is
 * on screen in the same place as one of `others` (the user's own graphics) or as one admitted before it. One that
 * covers a face or a shown thing is admitted for COVER_MAX_US at most, and is judged against the later ones for that.
 */
export function admitFree(
  cues: GraphicCue[],
  placedOf: (cue: GraphicCue) => { atUs: number; durationUs: number } | null,
  room: FreeRoom,
  others: { span: Span; box: GraphicBox }[],
): { admitted: GraphicCue[]; dropped: number } {
  const placed = cues.flatMap((cue) => {
    const at = placedOf(cue)
    return at ? [{ cue, ...at }] : []
  })
  placed.sort((a, b) => a.atUs - b.atUs)
  let dropped = cues.length - placed.length
  const admitted: GraphicCue[] = []
  const taken = [...others]
  for (const { cue, atUs, durationUs } of placed) {
    const judged = roomOf(cue, { startUs: atUs, endUs: atUs + durationUs }, room)
    const onOwnText = cue.pointId === undefined || room.ownTextIn({ startUs: atUs, endUs: atUs + 1 }, cue.pointId).length > 0
    if (judged.gone || !onOwnText) {
      dropped++
      continue
    }
    const playsUs = judged.coversKeep ? Math.min(durationUs, COVER_MAX_US) : durationUs
    const at = { span: { startUs: atUs, endUs: atUs + playsUs }, box: cue.spec.box }
    if (taken.some((other) => clash(other, at))) {
      dropped++
      continue
    }
    taken.push(at)
    const shortened = judged.coversKeep && cue.spec.seconds > COVER_MAX_US / 1_000_000
    admitted.push(shortened ? { ...cue, spec: { ...cue.spec, seconds: COVER_MAX_US / 1_000_000 } } : cue)
  }
  return { admitted, dropped }
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
export const MOTION_RUN_ON_US = 300_000

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
 *
 * All of that is for a legacy graphic, one planned before 0.7.0. A free one (`isFree`, one with a level of its own)
 * is placed by other rules. It plays from its own level up, whatever its point's importance, and not at all when it is
 * tied to a point not placed on this rough cut; such a one is neither in force, listed as off, nor dropped. Its
 * piece gives it no less than FREE_GRAPHIC_MIN_US. Its box is never moved: `roomOf` judges it where it was planned,
 * and one that would cover another point's text is gone, counted as one with no room is, unless it is switched off;
 * one over a face or a shown thing plays COVER_MAX_US at most. Once the rules have run, a free graphic on screen in
 * the same place as a legacy one, or as an earlier free one that was kept, is dropped and counted: a legacy graphic
 * is never moved or dropped for a free one. It is stale, besides, when it was written to take its point's text's
 * place and does not cover that text now, or the other way round, and it replaces that text only when it covers it,
 * is written and is fresh (`replaces`). A switched-off one carries the same judgement, so the screen can say what it
 * would do switched on.
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
  /** the text and the things to keep clear a free graphic is judged by (`roomOf`) */
  room: FreeRoom
  /** whether a point is placed on this rough cut, whatever its importance */
  pointPlaced: (pointId: string) => boolean
}): { kept: PlacedGraphic[]; dropped: number; off: PlacedGraphic[] } {
  if (!input.flair.graphic) return { kept: [], dropped: 0, off: [] }
  const subtitles = input.captionsFromY === null ? null : { fromY: input.captionsFromY, toY: 1 }
  const placed: PlacedGraphic[] = []
  const off: PlacedGraphic[] = []
  let gone = 0
  const level = FLAIR_LEVELS.indexOf(input.flair.level)
  // a free graphic shows from its own level up, and only while the point it is tied to is on the cut
  const freeShows = (cue: GraphicCue) => FLAIR_LEVELS.indexOf(cue.from!) <= level && (cue.pointId === undefined || input.pointPlaced(cue.pointId))
  for (const cue of input.graphics) {
    // a stored entry that is no graphic the app draws plays nowhere and is no loss to count
    if (!isMotionCue(cue)) continue
    const free = isFree(cue)
    if (free ? !freeShows(cue) : !input.passes(cue.pointId)) continue
    const where = input.place(cue.anchor, cue.pointId)
    if (!where) {
      if (!cue.off) gone++
      continue
    }
    const secondsUs = Math.round(cue.spec.seconds * 1_000_000)
    // the sentence of the moment it plays at, which is its point's start when its own moment was cut
    const pieceEndUs = input.pieceEndOf(where.by)
    const roomUs = pieceEndUs === null ? secondsUs : Math.min(secondsUs, Math.max(pieceEndUs - where.atUs, free ? FREE_GRAPHIC_MIN_US : GRAPHIC_MIN_US))
    // a written graphic with a little less room than it was written for plays its whole length all the same
    const durationUs = cue.spec.html !== null && secondsUs - roomUs <= MOTION_RUN_ON_US ? secondsUs : roomUs
    const span = { startUs: where.atUs, endUs: where.atUs + durationUs }
    if (free) {
      const room = roomOf(cue, span, input.room)
      if (room.gone && !cue.off) {
        gone++
        continue
      }
      // whether it covers its point's text is judged last, on the span every rule has left it
      const coversKeep = !room.gone && room.coversKeep
      const at: PlacedGraphic = { cue, atUs: where.atUs, durationUs: coversKeep ? Math.min(durationUs, COVER_MAX_US) : durationUs, coversKeep }
      if (cue.off) off.push(at)
      else placed.push(at)
      continue
    }
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
  const enforced = enforceGraphics(placed, input.durationUs)
  // in time order, a free graphic gives way to every legacy one and to the free ones kept before it
  const kept: PlacedGraphic[] = []
  let crowded = 0
  for (const graphic of enforced.kept) {
    const before = enforced.kept.filter((other) => other !== graphic && (!isFree(other.cue) || kept.includes(other)))
    if (isFree(graphic.cue) && before.some((other) => clash(spanOf(other), spanOf(graphic)))) crowded++
    else kept.push(graphic)
  }
  // a graphic's words are found last, for the length the rules left it (`playsUs`), from the moment it plays
  // by: its own, or its point's start when its own was cut. The length is asked for as `renderSeconds` gives it, the
  // length a graphic is written for, so one written for these words is given the same words when it is placed again
  const worded = (graphic: PlacedGraphic, playsUs: number): PlacedGraphic => {
    const { by } = input.place(graphic.cue.anchor, graphic.cue.pointId)!
    const spec = graphic.cue.spec
    const judged = withWordsNow(graphic, spec, input.wordsFrom(by, renderSeconds(playsUs)), playsUs)
    if (!isFree(graphic.cue)) return judged
    // a free one covers its point's text or not over the span it really plays, cut by a face or by the end of the
    // rough cut; it was written either to take that text's place or to stay beside it, and is stale where it does the other
    const covering = coveringIn(graphic.cue, { startUs: graphic.atUs, endUs: graphic.atUs + playsUs }, input.room)
    const fresh = { ...judged, stale: judged.stale === true || (spec.html !== null && spec.replacesText !== covering) }
    return { ...fresh, covering, replaces: covering && hasJob(fresh) }
  }
  return {
    kept: kept.map((graphic) => worded(graphic, graphic.durationUs)),
    dropped: enforced.dropped + crowded + gone,
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
 * with neither text nor graphic in that write, which reports the graphic as skipped. That is a legacy graphic's
 * rule; a free one takes its point's text's place only when `graphicsInForce` found it `replaces`: its box covers
 * that text, and it is written and fresh.
 */
export const replacesText = (graphic: PlacedGraphic): boolean => (isFree(graphic.cue) ? graphic.replaces === true : graphic.cue.pointId !== undefined && hasJob(graphic))

/** The points whose highlight text a graphic takes the place of, read from the graphics `graphicsInForce` kept. */
export const replacedPoints = (graphics: { kept: PlacedGraphic[] }): Set<string> => new Set(graphics.kept.filter(replacesText).map((graphic) => graphic.cue.pointId!))

/**
 * Whether a highlight group is replaced: it was made for one of the replaced points (`replacedPoints`), so it
 * is not drawn while that point's graphic plays in the clip. Every group of such a point is; one bound to no
 * point never is.
 */
export const isReplaced = (group: { pointId?: string }, replaced: ReadonlySet<string>): boolean => group.pointId !== undefined && replaced.has(group.pointId)

/** A stored field the screen shows as text: the text itself, or null for anything else. */
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null)

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
      // an outline edited by hand may hold anything in these: what is no text is nothing to show, as `previous` below
      writeFailed: textOrNull(spec.failed),
      instruction: textOrNull(spec.instruction),
      editFailed: textOrNull(spec.editFailed),
      // what a file holds there that is no fragment is nothing to go back to
      canUndo: isPrevious(spec.previous),
      edited: graphic.cue.edited,
      off: graphic.cue.off,
      from: graphic.cue.from ?? null,
      replaces: graphic.replaces ?? replacesText(graphic),
      coversKeep: graphic.coversKeep === true,
      ...(graphic.cue.pointId !== undefined ? { pointId: graphic.cue.pointId } : {}),
    }
  })
}
