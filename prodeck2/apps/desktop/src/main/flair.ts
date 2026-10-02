import type { CutClip, CutPlan, CutRules } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"

/** What a cached description was made from: the prompt and the model that looked at the picture. */
export interface MediaKey {
  prompt: string
  model: string
}
import { exitById, TEXT_PATTERNS, type FlairLevel, type FlairOptions, type TextPattern } from "@boxblack/core/flair/catalogue"
import {
  acceptTechniques,
  clock,
  describeTechniques,
  findWord,
  planTechniques,
  TECHNIQUES_PROMPT,
  TechniquesReplySchema,
  type TechniqueClip,
  type TechniquePoint,
  type TechniqueScene,
} from "@boxblack/core/flair/direct"
import { isMove, type MoveCue, type Pose } from "@boxblack/core/flair/moves"
import { OBJECTS_VERSION } from "@boxblack/core/vision"
import { DEFAULT_LOOK, ZOOM_KINDS, type CueAnchor, type GroupLook, type InsertCue, type PieceAnchor, type ZoomCue, type ZoomKind } from "@boxblack/core/flair/plan"
import { stageBox } from "@boxblack/core/graphics/framing"
import { planFreeGraphics, type FreeClip } from "@boxblack/core/graphics/motion/free"
import { frameKey, type GraphicPoint } from "@boxblack/core/graphics/motion/points"
import { editBrief, motionBrief } from "@boxblack/core/graphics/motion/write"
import { clipText, FREE_GRAPHIC_MIN_US, GRAPHIC_MIN_US, isFree, isMotion, isPrevious, MOTION_VERSION, type GraphicCue, type MotionSpec, type PlacedGraphic, type PreviousFragment } from "@boxblack/core/graphics/plan"
import type { Importance } from "@boxblack/core/emphasis/types"
import { timeHighlights } from "@boxblack/core/highlights"
import { SUBTITLE_ROOM_FROM_Y } from "@boxblack/core/highlights/layout"
import { DEFAULT_HIGHLIGHT_OPTIONS, styleFor } from "@boxblack/core/highlights/styles"
import type { LlmTransport } from "@boxblack/core/llm"
import { isComposed, isSoundPrevious, type ComposedSound } from "@boxblack/core/sound/spec"
import type { FlairLookPatch, GraphicPatch, HighlightViewOptions, MoveAnchor, PostRequest, StoredOutline } from "../shared/api.ts"
import { hashOfHtml, wordsOnCutAt, type CutWordAt } from "./composed-cues.ts"
import { admitFree, boxesOverlap, framesWanted, MOTION_RUN_ON_US, graphicPoints, isGraphicEntry, ownBandsIn, renderSeconds, scenesOnCut, sentenceOf, textBands, textGroupsIn, wordsSaidFrom, zoomedFaces, type FreeRoom } from "./graphics-cues.ts"
import type { GraphicsRenderer, RenderJob } from "./graphics-render.ts"
import { answerOnBeats, everyPointShown, looksInForce, placedPoints, placeStored, pointAnchor, pointText, showRulesOver, styleInForce, timelineOf, type ShowRules } from "./highlight-state.ts"
import { moveAt, movesOnCut, pieceCap, sameMove, withoutStrandedMoves, type OffMove, type PlacedMove } from "./move-cues.ts"
import { heldMoments, punchMoment, samePlace, slotsFor, startMoment, withoutSoundsOn } from "./sound-cues.ts"
import { itemPlaceOf, placeOf, withDescriptions, type SpareMedia } from "./insert-media.ts"
import { writeAll, writePiece, type PieceToWrite, type Written } from "./motion-write.ts"
import { CALLS_AT_ONCE, createCallLimit } from "./call-limit.ts"
import { describeMedia, MEDIA_PROMPT_VERSION, type MediaFit, type MediaFrame, type MediaLook } from "@boxblack/core/flair/look-at"
import type { BinMedia } from "@boxblack/core/flair/media"
import { pointPiece, samePiece, zoomSlotsFor } from "./zoom-cues.ts"
import { spokenSentences, wordsIn } from "./spoken.ts"
import type { SoundLibrary } from "./sound-library.ts"
import type { OutlineStore } from "./planner.ts"
import type { TimelineService } from "./timeline.ts"
import { countedOne, createSoundActions, soundSteppedBack, type SoundActionsDeps } from "./sound-actions.ts"
import { createSoundWork } from "./sound-work.ts"

export interface FlairDeps {
  outlines: OutlineStore
  timeline: Pick<TimelineService, "compiled">
  /** the sounds this machine's CapCut has */
  sounds?: Pick<SoundLibrary, "list">
  /** the project's own spare photos and clips */
  media?: SpareMedia
  /** what each picture shows, kept between runs, for the file as it was when it was looked at */
  descriptions?: { entry(path: string, key: MediaKey): Promise<{ get(): Promise<MediaLook | null>; put(value: MediaLook): Promise<void> }> }
  /** frames of the pictures, and of the footage at each point's first kept moment for the graphics, for Claude to look at; kept until the work that asked for them is over */
  frames?: () => LookingSession
  /** the Claude connection chosen in settings */
  llm?: () => Promise<{ transport: LlmTransport; model: string }>
  /** where a video of the project is on disk, for frames of it; null when its file is gone */
  videoPath?: (folder: string, videoId: string) => Promise<string | null>
  /**
   * the graphics renderer: it starts on the graphics a plan leaves with a job, renders the fragment a writing is
   * checking and says why that failed, forgets what it found wrong with the machine as a writing begins, and
   * forgets a failed render on a retry
   */
  graphics?: Pick<GraphicsRenderer, "ensure" | "wait" | "failureOf" | "forgetMachine" | "retry" | "hashOf">
  /** whether graphics can render now: the renderer pack is installed and no render found the machine unfit. Without it a writing is checked by the linter alone */
  graphicsReady?: () => Promise<boolean>
  /**
   * the graphics in force and their render jobs, and the switched-off ones, built from the stored outline the way the
   * preview builds them; a free graphic tied to a point carries that point's highlight text, which its writing is told of
   */
  graphicJobs?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: WithPointText[]; off: WithPointText[]; jobs: (RenderJob | null)[] }>
  /** the render job a placed motion graphic would have with the spec a writing would store for it, drawn as the preview draws it; null with no frame to draw on */
  candidateJob?: (folder: string, rules: CutRules, graphic: PlacedGraphic, spec: MotionSpec) => Promise<RenderJob | null>
  /** one stored graphic's render job as the post-production page shows it; null when it does not play */
  jobFor?: (folder: string, cue: GraphicCue) => Promise<RenderJob | null>
  /** the composed sounds as the preview places them, playing and switched off, which work 4 and a redo or an edit compose each for the room it has */
  composedSounds?: SoundActionsDeps["composedSounds"]
  /** the sound renderer, which renders the code a composing is checking; without it a sound is checked by the linter alone */
  soundRenderer?: SoundActionsDeps["renderer"]
}

/** A placed graphic with the text of the point it is tied to, as the groups made for that point say it with every point shown; absent on one with no such text. */
export type WithPointText = PlacedGraphic & { pointText?: string }

export interface LookingSession {
  /** one frame for a photo, three across a clip */
  of(media: BinMedia): Promise<string[]>
  /** frames of a video at those source times, in that order: what the graphics are planned on */
  at?(path: string, timesUs: number[]): Promise<string[]>
  dispose(): Promise<void>
}

/**
 * A graphic as the user changed it by hand, which makes it theirs: switched off or on. It is Claude's to draw,
 * so nothing else of it is changed by hand.
 */
const changedGraphic = (graphic: GraphicCue, patch: GraphicPatch): GraphicCue => ({ ...graphic, off: patch.off ?? graphic.off, edited: true })

/**
 * The composed sounds less those tied to a graphic `gone` says is gone (spec §11): a sound scores its graphic and
 * goes with it. A sound on speech alone, and what a file holds there that is no composed sound, stay as they are.
 */
const withoutTiedTo = (composed: ComposedSound[], gone: (graphic: CueAnchor) => boolean): ComposedSound[] =>
  composed.filter((sound) => !isComposed(sound) || sound.graphic === undefined || !gone(sound.graphic))

/** The most characters of the outline's title and summary a graphic's writing is told the clip is about. */
const ABOUT_MAX = 300

/**
 * What the clip is about, in one line, as a graphic's writing call is told it: the outline's title, then its
 * summary, cut by whole letters, and the video type after them when the brief names one. One of the two left
 * empty is left out, with the colon between them.
 */
function aboutOf(stored: StoredOutline): string {
  const said = [stored.outline.title, stored.outline.summary].map((part) => part.replace(/\s+/g, " ").trim()).filter((part) => part !== "")
  const about = clipText(said.join(": "), ABOUT_MAX).trimEnd()
  return [about, ...(stored.brief.videoType ? [`(${stored.brief.videoType})`] : [])].filter((part) => part !== "").join(" ")
}

/**
 * The fragment a spec holds, with what it was written for, the change that made it when one did, and, on a free
 * graphic, whether it was written to take its point's text's place; none when it holds no fragment. A change stored as
 * anything but a text (a file edited by hand) is left off, and the fragment is kept.
 */
function fragmentHeld(spec: MotionSpec): PreviousFragment | undefined {
  if (spec.html === null) return undefined
  return {
    html: spec.html,
    seconds: spec.seconds,
    words: spec.words,
    version: spec.version,
    ...(typeof spec.instruction === "string" ? { instruction: spec.instruction } : {}),
    ...(typeof spec.replacesText === "boolean" ? { replacesText: spec.replacesText } : {}),
  }
}

/**
 * What a writing that ends keeps for one step back: the fragment the graphic had until then, when it had one, else
 * the one it kept already, so a writing that fails after another failed still keeps the last good fragment. What a
 * file holds there that is no fragment (`isPrevious`) is not carried forward.
 */
function keptBefore(spec: MotionSpec): { previous?: PreviousFragment } {
  const previous = fragmentHeld(spec) ?? spec.previous
  return isPrevious(previous) ? { previous } : {}
}

/**
 * A motion graphic's spec once a writing of it (a plan's, or a redo) has ended. Written, it holds the fragment with
 * the length and the words it was written for, under the contract in force now, so that it says truthfully what the
 * fragment is for and the graphic is fresh until the cut changes again; why an earlier writing failed goes. Failed,
 * it holds no fragment, and why; its length and words stay as they were. Either way the fragment it had until then
 * is kept for one step back (`keptBefore`), and the change a user asked for and why an edit failed go, since
 * neither is about the fragment it has now. A free graphic is stored with whether it was written to take its point's
 * text's place (`replacesText`), set on every writing, failed or not; a legacy one has none.
 */
function afterWriting(spec: MotionSpec, writtenFor: PieceToWrite, written: Written, replacesText: boolean | undefined): MotionSpec {
  const { failed: _failed, instruction: _instruction, editFailed: _editFailed, previous: _previous, ...rest } = spec
  const kept = keptBefore(spec)
  const replacing = replacesText === undefined ? {} : { replacesText }
  return "html" in written
    ? { ...rest, version: MOTION_VERSION, html: written.html, seconds: writtenFor.seconds, words: writtenFor.words, ...replacing, ...kept }
    : { ...rest, html: null, failed: written.failed, ...replacing, ...kept }
}

/**
 * A motion graphic's spec once an edit of it has ended. Written, it holds the new fragment as `afterWriting` holds
 * one, with the change that made it, and keeps the fragment it had until then for one step back; why a writing or an
 * earlier edit failed goes, and a free one is stored with whether it was written to take its point's text's place, as
 * `afterWriting` stores it. Failed, it is as it was, with why the edit failed: the fragment it had still plays, with what it
 * was written for.
 */
function afterEdit(spec: MotionSpec, writtenFor: PieceToWrite, written: Written, instruction: string, replacesText: boolean | undefined): MotionSpec {
  if (!("html" in written)) return { ...spec, editFailed: written.failed }
  const { failed: _failed, editFailed: _editFailed, previous: _previous, ...rest } = spec
  return {
    ...rest,
    version: MOTION_VERSION,
    html: written.html,
    seconds: writtenFor.seconds,
    words: writtenFor.words,
    instruction,
    ...(replacesText === undefined ? {} : { replacesText }),
    ...keptBefore(spec),
  }
}

/**
 * A motion graphic's spec one step back: the fragment kept takes the place of the one there, with the length, the
 * words, the contract, the change it was written for (none when no change made it) and whether it was written to take
 * its point's text's place (none when it was not said), and the one there is kept in
 * its place when there is one; one with no fragment (a writing again that failed) leaves nothing to come back to.
 * Why a writing or an edit failed goes, since it was about the fragment that leaves; nothing else changes.
 */
function steppedBack(spec: MotionSpec, previous: PreviousFragment): MotionSpec {
  const { failed: _failed, editFailed: _editFailed, instruction: _instruction, previous: _previous, replacesText: _replacesText, ...rest } = spec
  const now = fragmentHeld(spec)
  return {
    ...rest,
    html: previous.html,
    seconds: previous.seconds,
    words: previous.words,
    version: previous.version,
    ...(previous.instruction !== undefined ? { instruction: previous.instruction } : {}),
    ...(previous.replacesText !== undefined ? { replacesText: previous.replacesText } : {}),
    ...(now ? { previous: now } : {}),
  }
}

/**
 * A motion graphic as it is placed, to be written there: the graphic, its spec as it is placed, how long it plays, which
 * is the length it is written for, and the text of the point it is tied to (`WithPointText`).
 */
interface PlacedMotion {
  graphic: PlacedGraphic
  spec: MotionSpec
  playsUs: number
  pointText?: string
}

/**
 * What the writings of one work share, the graphics work or one graphic written again: the project and the rules its
 * graphics are placed under, the Claude connection, the frame they are drawn on, what the clip is about, where the
 * room kept for subtitles starts (null with subtitles off), and the work's stop.
 */
interface WritingWork {
  folder: string
  rules: CutRules
  llm: { transport: LlmTransport; model: string }
  canvas: { width: number; height: number }
  about: string
  captionsFromY: number | null
  signal?: AbortSignal
}

/** Where the room highlights/layout.ts keeps highlight text above starts while subtitles are on; null while they are off. */
const captionsOf = (view: HighlightViewOptions): number | null => (view.subtitlesOn ? SUBTITLE_ROOM_FROM_Y : null)

/** A stored graphic as compared when it is put back: everything but why an edit failed, which an edit may add meanwhile. */
const stampOf = (cue: GraphicCue): string => {
  const { editFailed: _editFailed, ...spec } = cue.spec as MotionSpec
  return JSON.stringify({ ...cue, spec })
}

/** A spec in `box` whose fragments, the one it plays and the one kept for a step back, are said to take its point's text's place or not. */
function withReplacing(spec: MotionSpec, replacesText: boolean, box: MotionSpec["box"]): MotionSpec {
  const previous = isPrevious(spec.previous) ? { previous: { ...spec.previous, replacesText } } : {}
  return { ...spec, box, ...(spec.html !== null ? { replacesText } : {}), ...previous }
}

/** The level a legacy graphic plays from once it is free: its point's importance, as the level filter lets points through. With no point, or one no longer stored, the loudest level. */
const LEVEL_OF: Record<Importance, FlairLevel> = { key: "light", secondary: "medium", extra: "heavy" }

/**
 * What a free graphic's writing is told beyond its room (`motionBrief`): whether it shows in place of its point's text,
 * which it does when its box covers that text where it plays (`covering`), and is then told the text, or beside it; and,
 * while subtitles are on and its box reaches below where their room starts, where that is on its stage, in the stage's
 * own pixels, never above its top. A legacy graphic is told neither, as it was before 0.7.0.
 */
function freeBrief(graphic: PlacedGraphic, box: MotionSpec["box"], stageHeight: number, pointText: string | undefined, captionsFromY: number | null): Pick<PieceToWrite, "text" | "captionsFromPx"> {
  if (!isFree(graphic.cue)) return {}
  const text: PieceToWrite["text"] = graphic.covering === true && pointText !== undefined ? { replaces: pointText } : { pairs: true }
  const under = captionsFromY !== null && box.y1 > captionsFromY
  return { text, ...(under ? { captionsFromPx: Math.max(0, Math.round(((captionsFromY - box.y0) / (box.y1 - box.y0)) * stageHeight)) } : {}) }
}

/**
 * The clips with their faces as the techniques call is told them: a clip whose objects pass is of another version than
 * OBJECTS_VERSION, made before faces, has every keep object marked a face, since a face not known is taken to be one
 * (spec §8), as the moves are checked (`move-cues.ts`). A clip of a current pass is as it is, one that marked no face
 * having none, and so is a clip the pass has not run on.
 */
function withFacesKnown(clips: CutClip[]): CutClip[] {
  return clips.map((clip) => {
    const objects = clip.objects
    if (!objects || objects.version === OBJECTS_VERSION) return clip
    return { ...clip, objects: { ...objects, scenes: objects.scenes.map((scene) => scene.map((object) => (object.kind === "keep" ? { ...object, face: true } : object))) } }
  })
}

/**
 * The clip as the techniques call is shown it, but for the brief, the level and the pictures: every placed point, and,
 * while the zooms are on and the rough cut has a frame, every word it plays (`wordsOnCutAt`, each with the moment it is
 * said at, which a move on it starts at), the pieces long enough to zoom (`zoomSlotsFor`), each with how far its video
 * may be pushed in (`pieceCap`), and the scenes with their things, faces marked (`withFacesKnown`). With the zooms off
 * or no frame there are no words, pieces or scenes, and no move is asked for. The text is placed with every point shown.
 */
function techniqueClipOf(input: { stored: StoredOutline; plan: CutPlan; clips: CutClip[]; canvas: { width: number; height: number } | null; view: HighlightViewOptions; placed: PlacedPoint[] }): {
  words: CutWordAt[]
  points: TechniquePoint[]
  pieces: TechniqueClip["pieces"]
  scenes: TechniqueScene[]
} {
  const { stored, plan, clips, canvas, view, placed } = input
  const at = timelineOf(plan)
  const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
  // the text as it plays with every point shown, which names what a piece holds
  const timed = timeHighlights(placeStored(stored, plan, clips, everyPointShown(placed, view.highlightsOn)), at, plan.durationUs)
  const slots = view.flair.zoom ? zoomSlotsFor({ plan, groups: timed, beatNames, at }) : []
  const points: TechniquePoint[] = placed.map((point: PlacedPoint) => ({
    pointId: point.point.id,
    kind: point.point.anchor.kind,
    importance: point.point.importance,
    type: point.point.type,
    reason: point.point.reason,
    videoId: point.videoId,
    beatId: point.beatId,
    atUs: point.atUs,
    anchor: pointAnchor(point),
    text: pointText(point, clips),
    piece: pointPiece(slots, point),
  }))
  if (!view.flair.zoom || canvas === null) return { words: [], points, pieces: [], scenes: [] }
  const words = wordsOnCutAt(spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at }))
  const pieces = slots.map((slot) => {
    const clip = clips.find((one) => one.id === plan.cuts[slot.cut]!.binId)
    return { atUs: slot.atUs, durationUs: slot.durationUs, video: clip?.name ?? slot.anchor.videoId, cap: pieceCap(clip, canvas) }
  })
  return { words, points, pieces, scenes: scenesOnCut(plan, withFacesKnown(clips)) }
}

/**
 * Why a move's new poses may not take the place of the ones it has, or null when they may. The move is placed with them
 * as it is switched now (`place`, the moves in force on an outline): switched on, it has to play, and every other move
 * that plays now has to play still, and no other start to, since a move that would push another out, or let one back
 * in, changes more than the move asked for. Switched off, it is judged as a switched-off one is. Why one that does not
 * play is not told by the placing is found by judging it switched off beside the others; one that passes that way
 * fails only beside them.
 */
function judgedAgain(
  compiled: { stored: StoredOutline },
  cue: MoveCue,
  poses: Pose[],
  before: PlacedMove[],
  place: (outline: StoredOutline) => { kept: PlacedMove[]; off: OffMove[] },
): string | null {
  const { stored } = compiled
  const placedWith = (trial: MoveCue) => place({ ...stored, flair: { ...stored.flair!, moves: (stored.flair?.moves ?? []).map((move) => (move === cue ? trial : move)) } })
  const offWhy = () => {
    const judged = placedWith({ ...cue, poses, off: true }).off.find((entry) => sameMove(entry.cue, cue))
    return judged?.placed ? judged.why : "it has no place on the clip now"
  }
  if (cue.off) return offWhy()
  const after = placedWith({ ...cue, poses })
  if (!after.kept.some((placed) => sameMove(placed.cue, cue))) return offWhy() ?? "it would stop another move from playing"
  const others = (kept: PlacedMove[]) => new Set(kept.filter((placed) => placed.cue !== cue && !sameMove(placed.cue, cue)).map((placed) => placed.cue))
  const was = others(before)
  const now = others(after.kept)
  if ([...was].some((move) => !now.has(move))) return "it would stop another move from playing"
  if ([...now].some((move) => !was.has(move))) return "it would let a move play that does not play now"
  return null
}

/** The stored moves, when there are any, less Claude's moves on cutaways that `inserts` leave with none at their place (`withoutStrandedMoves`). */
const movesBeside = (flair: NonNullable<StoredOutline["flair"]>, inserts: InsertCue[]): { moves?: MoveCue[] } =>
  flair.moves ? { moves: withoutStrandedMoves(flair.moves, inserts) } : {}

/** Whether a stored entry has a place to be found by, as a move on a cutaway has to have. */
const isObjectAt = (entry: { anchor?: unknown }): boolean => typeof entry.anchor === "object" && entry.anchor !== null

/** What a move had before a change, for one step back: its poses, its line, and the change that made them when one did and it is a text. */
const moveBefore = (move: MoveCue): NonNullable<MoveCue["previous"]> => ({ poses: move.poses, about: move.about, ...(typeof move.instruction === "string" ? { instruction: move.instruction } : {}) })

/**
 * A move once a redesign (`instruction` null) or a change of it passed: the new poses and line, with the change when
 * there is one, and what it had until then kept for one step back. Why an earlier one failed goes, and a redesign takes
 * the change that made the poses before away.
 */
function movedAgain(move: MoveCue, answer: { poses: Pose[]; about: string }, instruction: string | null): MoveCue {
  const { editFailed: _editFailed, instruction: _instruction, previous: _previous, ...rest } = move
  return { ...rest, poses: answer.poses, about: answer.about, ...(instruction !== null ? { instruction } : {}), previous: moveBefore(move) }
}

/** A move one step back: what it kept takes the place of what it has, which is kept in its place, so a second step back comes back. Why a change failed goes. */
function movedBack(move: MoveCue, previous: NonNullable<MoveCue["previous"]>): MoveCue {
  const { editFailed: _editFailed, instruction: _instruction, previous: _previous, ...rest } = move
  return { ...rest, poses: previous.poses, about: previous.about, ...(typeof previous.instruction === "string" ? { instruction: previous.instruction } : {}), previous: moveBefore(move) }
}

export function createFlairService(deps: FlairDeps) {
  /** What each picture shows: from the cache, else from Claude, once per file. */
  async function describedMedia(
    pictures: BinMedia[],
    llm: { transport: LlmTransport; model: string },
    looking: LookingSession | undefined,
    signal?: AbortSignal,
  ): Promise<Record<string, MediaLook>> {
    if (pictures.length === 0 || !deps.descriptions || !looking) return {}
    const key: MediaKey = { prompt: MEDIA_PROMPT_VERSION, model: llm.model }
    const said: Record<string, MediaLook> = {}
    const missing: MediaFrame[] = []
    // each description is kept for the file as it is now, even if it is replaced while Claude looks
    const entries = new Map<string, Awaited<ReturnType<NonNullable<FlairDeps["descriptions"]>["entry"]>>>()
    for (const picture of pictures) {
      const entry = await deps.descriptions.entry(picture.path, key).catch(() => null)
      if (entry) entries.set(picture.binId, entry)
      const known = (await entry?.get()) ?? null
      if (known !== null) said[picture.binId] = known
      else {
        const paths = await looking.of(picture)
        if (paths.length > 0) missing.push({ binId: picture.binId, paths })
      }
    }
    // describeMedia makes no call when there is nothing missing
    const fresh = await describeMedia({ transport: llm.transport, model: llm.model, frames: missing, signal })
    for (const [binId, look] of Object.entries(fresh)) {
      said[binId] = look
      await entries.get(binId)?.put(look)
    }
    return said
  }

  /** The frames of each picture Claude may cut away to, so it chooses the moment by what it sees. */
  async function framesFor(pictures: BinMedia[], looking: LookingSession | undefined): Promise<Record<string, string[]>> {
    if (!looking) return {}
    const frames: Record<string, string[]> = {}
    for (const picture of pictures) {
      const paths = await looking.of(picture)
      if (paths.length > 0) frames[picture.binId] = paths
    }
    return frames
  }

  /** What Claude last said about one picture, from the cache alone; null when it has not been looked at. */
  async function lookedAt(picture: BinMedia): Promise<MediaLook | null> {
    if (!deps.descriptions || !deps.llm) return null
    try {
      const { model } = await deps.llm()
      return await (await deps.descriptions.entry(picture.path, { prompt: MEDIA_PROMPT_VERSION, model })).get()
    } catch {
      // no Claude connection set up yet: the picture simply has no look to go by
      return null
    }
  }

  /**
   * Frames of the footage at each point's first kept moment, for the graphics call: only the ones it will attach,
   * at most a dozen spread over the clip, with one extraction per video.
   */
  async function graphicFrames(folder: string, points: GraphicPoint[], looking: LookingSession | undefined): Promise<Record<string, string>> {
    if (!looking?.at || !deps.videoPath) return {}
    const { keys, wanted } = framesWanted(points)
    const files = new Map<string, string>()
    for (const [videoId, moments] of wanted) {
      // a video that cannot be found, or a frame that cannot be taken, only means Claude does not see
      // those points: it points at nothing there
      const path = await deps.videoPath(folder, videoId).catch(() => null)
      if (!path) continue
      const frames = await looking.at(path, moments.map((moment) => moment.sourceUs)).catch(() => [])
      moments.forEach((moment, i) => {
        if (frames[i]) files.set(moment.name, frames[i])
      })
    }
    return Object.fromEntries(Object.entries(keys).flatMap(([key, name]) => (files.has(name) ? [[key, files.get(name)!]] : [])))
  }

  /**
   * The frames of the points as the free plan is shown them (`graphicFrames`), each once, in the order of the points,
   * each labelled with the time on the rough cut of the first point it was taken for.
   */
  function framesOf(points: GraphicPoint[], files: Record<string, string>): { label: string; path: string }[] {
    const frames: { label: string; path: string }[] = []
    points.forEach((point, index) => {
      const path = files[frameKey(point, index)]
      if (path !== undefined && !frames.some((frame) => frame.path === path)) frames.push({ label: `เฟรมที่ ${clock(point.atUs)}`, path })
    })
    return frames
  }

  /** The Claude connection for one work, or why there is none. */
  async function claude(work: string): Promise<{ transport: LlmTransport; model: string }> {
    if (!deps.llm) throw new Error(`${work} is not ready: no Claude connection`)
    return deps.llm()
  }

  /** The text and every placed point, whatever the level: works 2 and 4 plan on all of them (spec §4.3; everyPointShown). */
  const everyPoint = (view: HighlightViewOptions, placed: PlacedPoint[]): ShowRules => everyPointShown(placed, view.highlightsOn)

  /** The ids of the points an outline stores now: what Claude put on a point deleted while it thought goes with the point. */
  const pointsOf = (stored: StoredOutline): Set<string> => new Set((stored.emphasis?.points ?? []).map((point) => point.id))

  /** Whether an item may be stored on the points as they are now: one made for no point, or for a point still there. */
  const onPointNow =
    (now: Set<string>) =>
    (item: { pointId?: string }): boolean =>
      item.pointId === undefined || now.has(item.pointId)

  /**
   * Claude's items on points it was not shown this time (their words cut for now) wait for those points to
   * come back, as long as the point is still stored; one on a point that is gone goes.
   */
  const waitingFor =
    (asked: Set<string>, now: Set<string>) =>
    (item: { edited: boolean; pointId?: string }): boolean =>
      !item.edited && item.pointId !== undefined && !asked.has(item.pointId) && now.has(item.pointId)

  async function outline(folder: string): Promise<StoredOutline> {
    const stored = await deps.outlines.get(folder)
    if (!stored) throw new Error("this project has no outline yet")
    return stored
  }

  /** Changes the outline as it is on disk now, after any change made meanwhile. */
  function amend(folder: string, change: (stored: StoredOutline) => StoredOutline): Promise<StoredOutline> {
    return deps.outlines.update(folder, (latest) => {
      if (!latest) throw new Error("this project has no outline yet")
      return change(latest)
    })
  }

  /**
   * The moves of an outline as they play on its rough cut under `flair`, with the text and the cutaways shown by `show`
   * over the points placed there (`movesOnCut`); the pictures are the project's spare ones, which the cutaways show.
   */
  function movesPlacedOn(
    compiled: { stored: StoredOutline; plan: CutPlan; clips: CutClip[]; canvas: { width: number; height: number } | null },
    flair: FlairOptions,
    show: (points: PlacedPoint[]) => ShowRules,
    pictures: BinMedia[],
  ) {
    const { stored, plan, clips, canvas } = compiled
    const points = placedPoints(stored, plan, clips)
    const rules = show(points)
    const at = timelineOf(plan)
    const groups = timeHighlights(placeStored(stored, plan, clips, rules), at, plan.durationUs)
    return movesOnCut({ stored, plan, clips, canvas, flair, points, groups, pictures, passes: rules.passes, at })
  }

  /**
   * How many of `fresh`, moves just stored, play on the outline as it is now: at the loudest level with every point
   * shown, so the level hides none of them, and only the checks and the other moves keep one from playing.
   */
  async function newMovesPlaying(folder: string, request: PostRequest, fresh: MoveCue[], pictures: BinMedia[]): Promise<number> {
    const compiled = await deps.timeline.compiled(folder, request.rules)
    const loudest: FlairOptions = { ...request.view.flair, level: "heavy" }
    const { kept } = movesPlacedOn(compiled, loudest, (points) => everyPoint(request.view, points), pictures)
    return fresh.filter((move) => kept.some((placed) => sameMove(placed.cue, move))).length
  }

  /** The project's spare pictures while the cutaways are on, which a move on a cutaway needs to be placed; none while they are off. */
  const picturesFor = async (folder: string, stored: StoredOutline, view: HighlightViewOptions): Promise<BinMedia[]> =>
    view.flair.insert && deps.media ? deps.media.list(folder, stored.videoIds) : []

  /**
   * One move designed again by Claude, or changed as the user asks (`instruction`): the body of a run of the techniques
   * work alone. The move is looked for among those placed under the request, playing or switched off; one that is not
   * stored, or has no place now (its level or its point hides it, its word or its cutaway is gone, no frame), fails
   * the work. Claude is asked as the techniques plan asks (`techniqueClipOf`), with no pictures, and told which word to
   * answer for by its number in the clip: `ทำใหม่เฉพาะท่อนที่เริ่มคำที่ ${n}`, or for a change the change and the poses
   * the move has. Only an answer on that word is read, its cutaway number set aside: a move on a cutaway stays on it.
   *
   * A move on a cutaway is told so, the picture named. The new poses are checked where the move plays, beside the
   * other moves (`judgedAgain`): switched on, it has to play and leave what else plays as it is. Passing, they take the move's place in the outline as it is then,
   * the poses and line it had kept for one step back with the change that made them; a change is stored with them, and
   * a redesign takes the change away, with why an earlier one failed. Failing, or with no answer for that word, the
   * move is left as it was, with why. Nothing else of it changes: it is no more the user's than it was, and keeps its
   * level, its point and its switch. One taken away meanwhile is left alone. `signal` is the run's stop: a stop ends
   * the call and stores nothing; `progress` is told (0, 1) as the call begins and (1, 1) once it has ended.
   */
  async function moveAgain(
    folder: string,
    anchor: MoveAnchor,
    request: PostRequest,
    instruction: string | null,
    signal?: AbortSignal,
    progress?: (done: number, total: number) => void,
  ): Promise<{ count: number; dropped: number }> {
    const { rules, view } = request
    const compiled = await deps.timeline.compiled(folder, rules)
    const { stored, plan, clips, canvas } = compiled
    const cue = (stored.flair?.moves ?? []).find((move) => isMove(move) && sameMove(move, moveAt(anchor)))
    if (!cue) throw new Error("there is no move at that place")
    const pictures = await picturesFor(folder, stored, view)
    const shownBy = (points: PlacedPoint[]) => showRulesOver(points, view)
    // where it plays under the request, playing or switched off
    const now = movesPlacedOn(compiled, view.flair, shownBy, pictures)
    const where = now.kept.find((placed) => sameMove(placed.cue, cue)) ?? now.off.find((entry) => sameMove(entry.cue, cue))?.placed ?? null
    const placed = placedPoints(stored, plan, clips)
    const shown = techniqueClipOf({ stored, plan, clips, canvas, view, placed })
    // the word it starts on, by its anchor, else, for one whose word the cut took out, the word said where it plays
    const word = where ? shown.words.findIndex((one) => samePlace(one.anchor, cue.anchor)) : -1
    const index = word >= 0 ? word : where ? shown.words.findIndex((one) => one.atUs === where.atUs) : -1
    if (!where || index < 0) throw new Error("this move has no place on the clip now")
    const llm = await claude(instruction === null ? "designing a move again" : "changing a move")
    // a move on a cutaway is told so, with the picture named by what Claude said it shows, else by its file
    const picture = where.insertIndex !== undefined ? now.inserts[where.insertIndex]?.media : undefined
    const what = picture ? ((await lookedAt(picture))?.what || picture.name) : null
    const asked = [
      ...(what !== null ? [`ท่อนนี้ขยับสื่อแทรก “${what}” ไม่ใช่ตัวคลิป`] : []),
      ...(instruction === null ? [`ทำใหม่เฉพาะท่อนที่เริ่มคำที่ ${index + 1}`] : [`แก้ท่อนที่เริ่มคำที่ ${index + 1} ตามคำสั่ง: ${instruction}`, `ท่าเดิม: ${JSON.stringify(cue.poses)}`]),
    ]
    const clip: TechniqueClip = { brief: stored.brief, level: view.flair.level, words: shown.words.map(({ text, atUs }) => ({ text, atUs })), points: shown.points, pieces: shown.pieces, scenes: shown.scenes, media: [] }
    progress?.(0, 1)
    const reply = await llm.transport.generate({
      model: llm.model,
      system: TECHNIQUES_PROMPT.system,
      content: [{ type: "text", text: [describeTechniques(clip), "", ...asked].join("\n") }],
      schema: TechniquesReplySchema,
      maxTokens: 16_000,
      signal,
    })
    // only an answer on the word asked is read, as a move on the footage: one on a cutaway stays on its cutaway
    const answers = (reply.output.moves ?? []).filter((move) => move.word === index + 1).map((move) => ({ ...move, insert: 0 }))
    const [answer] = acceptTechniques({ moves: answers, inserts: [] }, clip).moves
    let why: string | null = answer ? null : "Claude answered no move for that word"
    if (answer) why = judgedAgain(compiled, cue, answer.poses, now.kept, (outline) => movesPlacedOn({ ...compiled, stored: outline }, view.flair, shownBy, pictures))
    let ended: "written" | "failed" | "gone" = "gone"
    await amend(folder, (latest) => {
      const moves = latest.flair?.moves ?? []
      const at = moves.findIndex((move) => isMove(move) && sameMove(move, cue))
      const found = moves[at]
      if (!found || !isMove(found)) return latest
      ended = why === null ? "written" : "failed"
      return { ...latest, flair: { ...latest.flair!, moves: moves.map((move, i) => (i === at ? (why === null ? movedAgain(found, answer!, instruction) : { ...found, editFailed: why }) : move)) } }
    })
    progress?.(1, 1)
    return countedOne(ended)
  }

  /**
   * What is wrong with a fragment written for a placed graphic once it is rendered, for its writing's one repair.
   * The job rendered is the one the graphic will have with `spec` stored (`candidateJob`), so the file made here
   * is the one the preview and the write then use, and nothing is rendered twice. None when it is made; the
   * renderer's reasons, one a line, when it failed; null when it cannot be rendered now, which is no fault of
   * the fragment: there is no renderer, the pack is not installed or a render found the machine unfit, the rough
   * cut has no frame to draw on, the render was stopped, or the check itself could not be made (the draft cannot
   * be read just then, and the job or the render throws). The fragment the linter passed is then kept as it is,
   * and the preview's render judges it later. Null too once `signal`, the work's stop, has been pressed while the
   * job was being made: the writing has ended by then, and the renderer is asked for nothing. This never rejects.
   */
  async function renderProblems(folder: string, rules: CutRules, graphic: PlacedGraphic, spec: MotionSpec, signal?: AbortSignal): Promise<string[] | null> {
    try {
      const renderer = deps.graphics
      if (!renderer || !deps.candidateJob || !(await deps.graphicsReady?.())) return null
      const job = await deps.candidateJob(folder, rules, graphic, spec)
      if (!job || signal?.aborted) return null
      const hash = renderer.hashOf(job)
      const { ready, failed } = await renderer.wait([job], folder)
      if (ready.includes(hash)) return []
      if (!failed.includes(hash)) return null
      const problems = (renderer.failureOf(hash) ?? "").split("\n").filter((line) => line.trim() !== "")
      // a failure the renderer has no words for is a failure all the same
      return problems.length > 0 ? problems : ["the render failed"]
    } catch {
      return null
    }
  }

  /**
   * Writes one placed motion graphic for the room it has on the rough cut now, not for what its plan wished: the
   * length it plays, to the millisecond below, the words said in that time, and a stage that is its box as it is
   * placed on the frame. A free graphic is told besides whether it shows in place of its point's text or beside the
   * text of its moment, and where the subtitles start over its stage (`freeBrief`), and is stored with whether it was
   * written to take that text's place (`replacesText`). A fragment the linter passes is rendered as the graphic will
   * be once it is stored. How
   * the writing ended is stored on the outline as it is then, the graphic found by its place: written, the
   * fragment with the length and the words it was written for; failed, no fragment and why; either way the
   * fragment it had until then is kept for one step back. Only its spec
   * changes, so it is no more the user's than it was, and what the user did to it meanwhile (switched it off)
   * stays. Nothing is stored before the writing has ended: a candidate that has not passed is never in the
   * outline, and a graphic written again keeps the fragment it had until then. Answers how it ended, "gone" when
   * the graphic was taken away meanwhile and nothing was stored.
   *
   * The work's stop ends the writing at once, wherever it has got to, and this rejects: before a call, during
   * one, and while the fragment is being rendered, a render that is then left to end by itself (`writePiece`).
   * Nothing of a stopped writing is stored. A writing that `writePiece` had already answered is stored even when
   * the stop lands during the store: it passed every check before the stop, so it counts among the graphics
   * already written.
   *
   * With `edit`, the writing is an edit of the fragment the graphic has: Claude is asked from the brief for the room
   * it has now with the user's change and that fragment (`editBrief`), and it is stored as an edit ends
   * (`afterEdit`): a failure leaves the fragment it had. Without, it is stored as any other writing (`afterWriting`).
   */
  async function writeGraphic(work: WritingWork, { graphic, spec, playsUs, pointText }: PlacedMotion, edit?: { instruction: string; html: string }): Promise<"written" | "failed" | "gone"> {
    const { folder, rules } = work
    const { width, height } = stageBox(spec.box, work.canvas)
    const writtenFor: PieceToWrite = {
      stage: { width, height },
      seconds: renderSeconds(playsUs),
      words: graphic.wordsNow ?? [],
      idea: spec.idea,
      about: work.about,
      ...freeBrief(graphic, spec.box, height, pointText, work.captionsFromY),
    }
    // a free graphic is written to take its point's text's place exactly when it covers that text where it plays now
    const replacing = isFree(graphic.cue) ? graphic.covering === true : undefined
    const ending = (was: MotionSpec, written: Written) => (edit ? afterEdit(was, writtenFor, written, edit.instruction, replacing) : afterWriting(was, writtenFor, written, replacing))
    const firstBrief = edit ? editBrief({ brief: motionBrief(writtenFor), html: edit.html, instruction: edit.instruction }) : undefined
    const written = await writePiece(writtenFor, { ...work.llm, render: (html) => renderProblems(folder, rules, graphic, ending(spec, { html }), work.signal), signal: work.signal }, firstBrief)
    let stored = false
    await amend(folder, (latest) => {
      const graphics = latest.flair?.graphics ?? []
      const index = graphics.findIndex((candidate) => samePlace(candidate.anchor, graphic.cue.anchor))
      const found = graphics[index]
      if (!found || !isMotion(found.spec)) return latest
      stored = true
      const ended = ending(found.spec, written)
      return { ...latest, flair: { ...latest.flair!, graphics: graphics.map((other, i) => (i === index ? { ...found, spec: ended } : other)) } }
    })
    if (!stored) return "gone"
    return "html" in written ? "written" : "failed"
  }

  /**
   * One motion graphic as it is placed under the request, to be written again or edited for the room it has there:
   * the graphic, its spec as placed and the length it would play, with the stored outline and the frame its writing
   * needs. It is looked for among those placed, playing or switched off (see `redoGraphic`); one with no place now
   * fails with why.
   *
   * A legacy graphic (one planned before 0.7.0) is made free before it is written: it is stored with the level its
   * point's importance let it play from (`LEVEL_OF`) and the box it plays in now, the one it was moved to (`madeFree`).
   * It is then placed again by the free rules. One with no place there is put back as it was, unless it was changed
   * meanwhile, and fails as any other with no place. One with a place has the fragments it holds, the one it plays and
   * the one kept for a step back, said to have been written for what it does there now: to take its point's text's
   * place when it covers that text, else to stay beside it. So the fragment it has still plays until the writing
   * replaces it, and one step back after the writing brings that fragment back, playing. `restore` puts it back as it
   * was before it was made free (see `madeFree`); null for a graphic that was free already.
   */
  async function placedToWrite(
    folder: string,
    anchor: CueAnchor,
    request: PostRequest,
  ): Promise<{ stored: StoredOutline; canvas: { width: number; height: number }; placed: PlacedMotion; restore: (() => Promise<void>) | null }> {
    const { rules, view } = request
    const { stored, plan, canvas } = await deps.timeline.compiled(folder, rules)
    const placedNow = async (): Promise<{ kept: WithPointText[]; off: WithPointText[] }> => (canvas && deps.graphicJobs ? deps.graphicJobs(folder, rules, view) : { kept: [], off: [] })
    const here = (graphic: PlacedGraphic) => samePlace(graphic.cue.anchor, anchor)
    let placed = await placedNow()
    const legacy = [...placed.kept, ...placed.off].find(here)
    const made = legacy && !isFree(legacy.cue) ? await madeFree(folder, legacy) : null
    if (made) placed = await placedNow()
    const find = () => {
      const playing = placed.kept.find(here)
      const switchedOff = playing ? undefined : placed.off.find(here)
      const graphic = playing ?? switchedOff
      // switched off, it plays what it is listed for, less what the end of the rough cut would cut of it switched on
      const playsUs = playing ? playing.durationUs : switchedOff ? Math.min(switchedOff.durationUs, plan.durationUs - switchedOff.atUs) : 0
      return { graphic, playsUs }
    }
    let { graphic, playsUs } = find()
    if (!canvas || !graphic || playsUs < (isFree(graphic.cue) ? FREE_GRAPHIC_MIN_US : GRAPHIC_MIN_US)) {
      await made?.restore()
      throw new Error("this graphic has no place on the clip now")
    }
    if (made && (await made.settle(graphic.covering === true))) {
      placed = await placedNow()
      ;({ graphic, playsUs } = find())
      if (!graphic) {
        await made.restore()
        throw new Error("this graphic has no place on the clip now")
      }
    }
    const spec = graphic.cue.spec
    return { stored, canvas, placed: { graphic, spec, playsUs, ...(graphic.pointText !== undefined ? { pointText: graphic.pointText } : {}) }, restore: made?.restore ?? null }
  }

  /**
   * Stores a legacy graphic as free (see `placedToWrite`), found by its place in the outline as it is now: with a level,
   * the box it plays in now, and the fragments it holds said to have been written to take its point's text's place,
   * which a legacy one with a point always was. Nothing is stored, and null answered, when it is not there as a legacy
   * motion graphic any more. Otherwise it answers two steps:
   * - `settle` says, of the fragments it holds, whether they take the text's place, once it is known whether the
   *   graphic covers that text as a free one; true when that changed what is stored. A legacy fragment was written
   *   to take its point's text's place, so one settled to stay beside the text (its box does not cover it), brought
   *   back by a step back after the graphic was written again, plays beside that text and may repeat its words. That
   *   is accepted: it plays, rather than going stale;
   * - `restore` puts it back as it was before, as long as what is stored there is still what this stored, but for why
   *   an edit failed, which it carries back with it.
   */
  async function madeFree(folder: string, placed: PlacedGraphic): Promise<{ settle: (covering: boolean) => Promise<boolean>; restore: () => Promise<void> } | null> {
    let was: GraphicCue | null = null
    let made: GraphicCue | null = null
    /** Changes the graphic at its place in the outline as it is now, while it is still what this stored. */
    const changeMade = (change: (now: GraphicCue) => GraphicCue | null) =>
      amend(folder, (latest) => {
        const graphics = latest.flair?.graphics ?? []
        const index = graphics.findIndex((candidate) => isGraphicEntry(candidate) && samePlace(candidate.anchor, placed.cue.anchor))
        const now = graphics[index]
        if (!now || !made || !isMotion(now.spec) || stampOf(now) !== stampOf(made)) return latest
        const next = change(now)
        if (next === null) return latest
        return { ...latest, flair: { ...latest.flair!, graphics: graphics.map((other, i) => (i === index ? next : other)) } }
      })
    await amend(folder, (latest) => {
      const graphics = latest.flair?.graphics ?? []
      const index = graphics.findIndex((candidate) => isGraphicEntry(candidate) && samePlace(candidate.anchor, placed.cue.anchor))
      const found = graphics[index]
      if (!found || isFree(found) || !isMotion(found.spec)) return latest
      const importance = latest.emphasis?.points.find((point) => point.id === found.pointId)?.importance
      was = found
      made = { ...found, from: importance ? LEVEL_OF[importance] : "heavy", spec: withReplacing(found.spec, found.pointId !== undefined, placed.cue.spec.box) }
      return { ...latest, flair: { ...latest.flair!, graphics: graphics.map((other, i) => (i === index ? made! : other)) } }
    })
    if (!was || !made) return null
    const before: GraphicCue = was
    return {
      async settle(covering) {
        const current: GraphicCue = made!
        if (!isMotion(current.spec) || (current.spec.replacesText ?? covering) === covering) return false
        const next: GraphicCue = { ...current, spec: withReplacing(current.spec, covering, current.spec.box) }
        let settled = false
        await changeMade(() => {
          settled = true
          return next
        })
        if (settled) made = next
        return settled
      },
      async restore() {
        await changeMade((now) => {
          const editFailed = isMotion(now.spec) ? now.spec.editFailed : undefined
          const { editFailed: _editFailed, ...spec } = before.spec as MotionSpec
          return { ...before, spec: { ...spec, ...(editFailed !== undefined ? { editFailed } : {}) } }
        }).catch(() => {})
      },
    }
  }

  /** Runs a writing, and puts a graphic made free for it back as it was (`restore`) when the writing rejects, a stop among them. */
  async function restoredOnStop<T>(restore: (() => Promise<void>) | null, writing: () => Promise<T>): Promise<T> {
    try {
      return await writing()
    } catch (error) {
      await restore?.()
      throw error
    }
  }

  /**
   * The slots every writing of this service takes its turn in: the graphics' and the sounds', of a whole plan or of one
   * graphic or sound, so the two works running side by side never have more of Claude's writing calls going than this.
   */
  const calls = createCallLimit(CALLS_AT_ONCE)

  /** Work 4, on the clip as the other works left it, with the pictures' looks from the cache alone. */
  const soundWork = createSoundWork({
    outlines: deps.outlines,
    timeline: deps.timeline,
    llm: () => claude("composing sounds"),
    about: aboutOf,
    media: deps.media,
    lookedAt,
    graphicJobs: deps.graphicJobs,
    composedSounds: deps.composedSounds,
    renderer: deps.soundRenderer,
    calls,
  })

  /** Redo, edit, undo, off and remove of one composed sound, and its tied sounds following a graphic written again. */
  const soundActions = createSoundActions({
    outlines: deps.outlines,
    llm: () => claude("composing sounds"),
    about: aboutOf,
    composedSounds: deps.composedSounds,
    renderer: deps.soundRenderer,
    calls,
  })

  return {
    /**
     * Work 2b: Claude's moves of the picture and the cutaways, in one call, before the text is placed (spec §3). Claude
     * is shown every word the rough cut plays, numbered, the points, the pieces of footage each with how far its video
     * may be pushed in (`pieceCap`), the scenes with the things in them and the faces marked, and the pictures, and
     * answers moves on words or on the cutaways it answers, and cutaways on points (`techniqueClipOf`). A kind with
     * nothing offered (switched off, no frame, no word, no picture) is not asked, and keeps what is stored.
     *
     * Stored in one change of the outline as it is then: the moves and the cutaways the user made theirs stay, with the
     * user's legacy zooms; Claude's moves on words and Claude's legacy zooms give way to the answer when moves were
     * offered, and Claude's moves on cutaways to the answer when cutaways were, as Claude's cutaways do. An answer on a
     * place one of the user's moves holds gives way, one on a point deleted meanwhile goes with the point, and a move on
     * a cutaway is kept only with the cutaway of Claude's it was answered with. Claude's sounds on the punches that go,
     * go with them. `signal` is a plan run's stop, which every call is made with.
     *
     * The count is the cutaways answered and the new moves that play; dropped are the answers that could not be used,
     * the new moves the merge left out among them, and those that do not play once placed, at the loudest level with
     * every point shown, which judges every move Claude answered (`movesInForce`: a move that fails its checks, or
     * overlaps another, does not play).
     */
    async planTechniques(folder: string, request: PostRequest, signal?: AbortSignal): Promise<{ count: number; dropped: number }> {
      const { rules, view } = request
      if (!view.flair.zoom && !view.flair.insert) return { count: 0, dropped: 0 }
      const { transport, model } = await claude("planning moves and cutaways")
      const { stored, plan, clips, canvas } = await deps.timeline.compiled(folder, rules)
      const placed = placedPoints(stored, plan, clips)
      if (placed.length === 0) return { count: 0, dropped: 0 }
      const shown = techniqueClipOf({ stored, plan, clips, canvas, view, placed })
      const pictures = view.flair.insert && deps.media ? await deps.media.list(folder, stored.videoIds) : []
      // what is offered this time, and so replaced by the answer: the moves need a word to start on and a frame to move in
      const movesOffered = shown.words.length > 0
      const insertsOffered = pictures.length > 0
      // the frames Claude looks at stay on disk only as long as this planning does
      const looking = pictures.length > 0 ? deps.frames?.() : undefined
      let planned: Awaited<ReturnType<typeof planTechniques>>
      try {
        const said = await describedMedia(pictures, { transport, model }, looking, signal)
        planned = await planTechniques({
          transport,
          model,
          brief: stored.brief,
          level: view.flair.level,
          words: shown.words.map(({ text, atUs }) => ({ text, atUs })),
          points: shown.points,
          pieces: shown.pieces,
          scenes: shown.scenes,
          media: withDescriptions(pictures, said),
          pictureFrames: await framesFor(pictures, looking),
          signal,
        })
      } finally {
        await looking?.dispose()
      }
      // each move on the word it starts on, or on the cutaway it was answered with
      const answerMoves: MoveCue[] = planned.moves.map((move) => ({
        anchor: move.insert === null ? shown.words[move.word]!.anchor : planned.inserts[move.insert]!.anchor,
        ...(move.insert !== null ? { insert: true } : {}),
        from: move.from,
        ...(move.pointId !== undefined ? { pointId: move.pointId } : {}),
        about: move.about,
        poses: move.poses,
        edited: false,
        off: false,
      }))
      const asked = new Set(shown.points.map((point) => point.pointId))
      let merged: MoveCue[] = []
      // merged into the outline as it is now: what the user set by hand, before or while Claude thought, stays,
      // and what Claude put on a point deleted meanwhile goes with it
      await amend(folder, (latest) => {
        const flair = latest.flair ?? { looks: {} }
        const now = pointsOf(latest)
        const waiting = waitingFor(asked, now)
        // the techniques call answers no legacy zoom any more: thinking the moves again retires Claude's, and the user's stay
        const zooms = movesOffered ? (flair.zooms ?? []).filter((zoom) => zoom.edited) : (flair.zooms ?? [])
        const answerInserts = answerOnBeats(planned.inserts, stored.outline.beats, latest.outline.beats).filter(onPointNow(now))
        // a picture of the user's bound to a point sits where the point starts now: after the cut moved that start, or
        // the user moved the phrase, it goes back there. The starts are put on the beats as they are now, as the
        // answer is: a beat that got a new id meanwhile has its items follow it
        const starts = answerOnBeats(
          placed.map((point) => ({ anchor: pointAnchor(point), pointId: point.point.id })),
          stored.outline.beats,
          latest.outline.beats,
        )
        const startOf = new Map(starts.map((start) => [start.pointId, start.anchor]))
        const homed = (insert: InsertCue): InsertCue => {
          const start = insert.pointId === undefined ? undefined : startOf.get(insert.pointId)
          return start === undefined || samePlace(insert.anchor, start) ? insert : { ...insert, anchor: start }
        }
        const myInserts = (flair.inserts ?? []).filter((insert) => insert.edited).map(homed)
        // one of the user's keeps Claude's off its moment, and off its point: the point keeps one cutaway, the user's.
        // Homed, the user's sits where Claude's answer for its point would; the point is named too, should the two differ
        const takenBy = (insert: InsertCue) => (own: InsertCue) => samePlace(own.anchor, insert.anchor) || (insert.pointId !== undefined && own.pointId === insert.pointId)
        const inserts = !insertsOffered
          ? (flair.inserts ?? [])
          : [...myInserts, ...(flair.inserts ?? []).filter(waiting), ...answerInserts.filter((insert) => !myInserts.some(takenBy(insert)))]
        // the moves the user made theirs stay. Claude's on words stay unless moves were offered; Claude's on cutaways are
        // thought again only when both moves and cutaways were offered, and otherwise stay while a cutaway of Claude's
        // still sits at their place. What the stored list holds that is no move is nobody's, and goes once its kind is
        // thought again
        const claudesAt = (anchor: CueAnchor) => inserts.some((insert) => !insert.edited && samePlace(insert.anchor, anchor))
        const stays = (move: MoveCue) => {
          if (isMove(move) && move.edited) return true
          if (move.insert !== true) return !movesOffered
          return !(movesOffered && insertsOffered) && isObjectAt(move) && claudesAt(move.anchor)
        }
        const staying = (flair.moves ?? []).filter(stays)
        merged = answerOnBeats(answerMoves, stored.outline.beats, latest.outline.beats)
          .filter(onPointNow(now))
          .filter((move) => !staying.some((other) => isMove(other) && sameMove(other, move)))
          // a move on a cutaway moves the cutaway of Claude's it was answered with, and goes when that does not stay
          .filter((move) => move.insert !== true || inserts.some((insert) => !insert.edited && samePlace(insert.anchor, move.anchor)))
        const moves = [...staying, ...merged]
        // Claude's sounds on its punches and cutaways that went go with them
        const goneZooms = (flair.zooms ?? []).filter((zoom) => !zoom.edited && !zooms.includes(zoom))
        const goneInserts = (flair.inserts ?? []).filter((insert) => !insert.edited && !inserts.includes(insert))
        const cues = withoutSoundsOn(flair.cues ?? [], [...goneZooms.map(punchMoment), ...goneInserts.map(startMoment)], heldMoments({ zooms, inserts, graphics: flair.graphics }))
        return { ...latest, flair: { ...flair, zooms, inserts, ...(flair.moves || moves.length > 0 ? { moves } : {}), ...(flair.cues ? { cues } : {}) } }
      })
      // the new moves that play, judged as they are placed on the outline as it is now, at the loudest level with every point shown
      const playing = merged.length === 0 ? 0 : await newMovesPlaying(folder, request, merged, pictures)
      return { count: planned.inserts.length + playing, dropped: planned.dropped + answerMoves.length - playing }
    },

    /**
     * Work 2c: motion graphics anywhere in the clip, around the text 2a placed, first planned and then written.
     * Claude is shown the whole clip as it plays with every point shown (`FreeClip`): every word numbered, the points,
     * the highlight text where and when it is drawn with the looks in force, the scenes with the things found in them,
     * the subtitles' room, the user's own graphics as they play at the loudest level, switched off or not, and a frame
     * at each point's first kept moment. It answers graphics that start on a word, each with the lowest level it plays
     * at and, when it tells a point's story, that point. Each answer is admitted by the room rules placement uses
     * (`admitFree`), against the text with every point shown, the things to keep clear and the user's own graphics.
     *
     * What is admitted is stored as it comes, none of it written yet, in place of every graphic Claude made before,
     * legacy or free; the user's own stay, and an answer on a place one of theirs holds gives way. Claude's sounds on
     * its graphics that go, go with them, and so do the composed sounds tied to them. With no canvas it answers
     * `skipped: "no-canvas"`, which the run shows as the work skipped, as if switched off.
     *
     * `onStored` is told once what is admitted is stored and before any of it is written, so a whole plan can plan
     * the sounds on it while it is written; it is not told when the work ends before storing anything.
     *
     * Then every graphic in force at the level set that has no fragment is written, a few at a time through the slots
     * it shares with the sounds' composing, each for the room it has on the rough cut now (`writeGraphic`) and stored as its writing ends: the fragment, or why
     * there is none. One the level hides, one with no room on the frame and one switched off are not written,
     * and wait; one gone stale waits for the user to ask for it to be written again (`redoGraphic`) or changed
     * (`editGraphic`), either of which fits it to the room it has now. `progress` is told how many writings
     * have ended, of how many, before the first and after each. The count answered is the graphics written in
     * this run; dropped are the answers of the plan that could not be used, those admission turned away, and the
     * graphics whose writing failed.
     *
     * `signal` is a plan run's stop, which every call is made with. Pressed during the writing, it ends every
     * writing under way at once, whether Claude is writing or the fragment is being rendered, and starts no
     * other: nothing of a stopped writing is stored, the graphics already written stay, and the work rejects as a
     * stopped call does.
     */
    async planGraphics(
      folder: string,
      request: PostRequest,
      signal?: AbortSignal,
      progress?: (done: number, total: number) => void,
      onStored?: () => void,
    ): Promise<{ count: number; dropped: number; skipped?: "no-canvas" }> {
      const { rules, view } = request
      if (!view.flair.graphic) return { count: 0, dropped: 0 }
      const llm = await claude("planning graphics")
      const { stored, plan, clips, canvas } = await deps.timeline.compiled(folder, rules)
      // no frame size to draw on (the first kept video is not in the draft's bin): the run shows the work as skipped, not done
      if (!canvas) return { count: 0, dropped: 0, skipped: "no-canvas" }
      // in playing order, which is how Claude numbers them
      const placed = [...placedPoints(stored, plan, clips)].sort((a, b) => a.atUs - b.atUs)
      if (placed.length === 0) return { count: 0, dropped: 0 }
      const at = timelineOf(plan)
      const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
      const spoken = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at })
      // the faces and the things shown where the moves of the picture put them, every move that plays at the loudest
      // level with every point shown, as the text is: the text keeps off those faces, and so does every graphic admitted
      const moves = movesPlacedOn({ stored, plan, clips, canvas }, { ...view.flair, level: "heavy" }, (points) => everyPoint(view, points), await picturesFor(folder, stored, view)).kept
      const faces = zoomedFaces({ moves, plan, clips, canvas, at })
      // the text as it plays with every point shown, laid out with the looks in force; the custom style draws in bold-white's font
      const font = styleFor(styleInForce(stored.highlights), DEFAULT_HIGHLIGHT_OPTIONS.custom).font
      const laidOut = (show: ShowRules) => {
        const placedGroups = placeStored(stored, plan, clips, show)
        const timedGroups = timeHighlights(placedGroups, at, plan.durationUs)
        const looks = looksInForce(stored, timedGroups.map((group) => ({ id: group.groupId, lines: group.lines.map((line) => ({ lineIndex: line.lineIndex, text: line.text.trim() })) })), view.flair, canvas)
        const bands = textBands({ placed: placedGroups, timed: timedGroups, clips, canvas, font, looks, position: view.position, subtitlesOn: view.subtitlesOn, faceBand: faces.bandIn })
        return { groups: placedGroups, timed: timedGroups, bands }
      }
      const { groups, timed, bands } = laidOut(everyPoint(view, placed))
      // each point's moment: where its text plays, as it would with the text switched on. A graphic tied to a point
      // starts in it; with the text off, nothing is drawn there, and the graphic plays beside no text
      const moments = view.highlightsOn ? bands : laidOut(everyPointShown(placed, true)).bands
      const points = graphicPoints({ points: placed, sentences: spoken, clips, bands })
      // every word the rough cut plays, numbered as the sounds' plan numbers them
      const words = wordsOnCutAt(spoken)
      const number = new Map(placed.map((point, i) => [point.point.id, i + 1]))
      const textOf = new Map(timed.map((group) => [group.groupId, group.lines.map((line) => line.text.trim()).join(" ")]))
      // the user's own as they play at the loudest level, switched off ones too: Claude is told of them, and keeps off them
      const loudest: HighlightViewOptions = { ...view, flair: { ...view.flair, level: "heavy" } }
      const before = deps.graphicJobs ? await deps.graphicJobs(folder, rules, loudest) : { kept: [], off: [] }
      const own = [...before.kept, ...before.off].filter((graphic) => graphic.cue.edited).sort((a, b) => a.atUs - b.atUs)
      const clip: FreeClip = {
        brief: stored.brief,
        level: view.flair.level,
        portrait: canvas.height > canvas.width,
        captionsFromY: captionsOf(view),
        words: words.map(({ text, atUs }) => ({ text, atUs })),
        points: placed.map((point) => ({ atUs: point.atUs, kind: point.point.anchor.kind, importance: point.point.importance, type: point.point.type, text: pointText(point, clips), reason: point.point.reason })),
        texts: bands.map((entry) => ({
          startUs: entry.startUs,
          endUs: entry.endUs,
          point: entry.pointId === undefined ? null : (number.get(entry.pointId) ?? null),
          band: entry.band,
          text: textOf.get(entry.groupId) ?? "",
        })),
        // the faces where the moves put them, in the scenes they play over
        scenes: scenesOnCut(plan, clips, faces.facesIn),
        own: own.map((graphic) => ({ startUs: graphic.atUs, endUs: graphic.atUs + graphic.durationUs, box: graphic.cue.spec.box, idea: graphic.cue.spec.idea, off: graphic.cue.off })),
      }
      const looking = deps.videoPath ? deps.frames?.() : undefined
      let answer: Awaited<ReturnType<typeof planFreeGraphics>>
      try {
        const frames = framesOf(points, await graphicFrames(folder, points, looking))
        answer = await planFreeGraphics({ ...llm, clip, frames, signal })
      } finally {
        await looking?.dispose()
      }
      // each answer on the moment its word is said, with the words said from there for the length it asked
      const wordsFrom = wordsSaidFrom({ sentences: spoken, clips })
      const answered = answer.graphics.map((planned): GraphicCue => {
        const anchor = words[planned.word]!.anchor
        const pointId = planned.point === null ? undefined : placed[planned.point]!.point.id
        return {
          anchor,
          spec: { kind: "motion", version: MOTION_VERSION, box: planned.box, seconds: planned.seconds, why: planned.why, idea: planned.idea, words: wordsFrom(anchor, planned.seconds), html: null },
          edited: false,
          off: false,
          ...(pointId !== undefined ? { pointId } : {}),
          from: planned.from,
        }
      })
      // admitted where it would be placed, as `graphicsInForce` places it: from its moment, for its seconds or until the
      // piece playing its sentence ends, but no less than its shortest (a free graphic's, or a legacy one's), all of it
      // when it is written and only a little longer than that, and never past the end of the rough cut; one the end of
      // the rough cut leaves less than its shortest has no place
      const place = itemPlaceOf(placeOf({ slots: slotsFor({ plan, groups: timed, beatNames, at }), sentences: spoken, plan, at }), placed)
      const placedOf = (cue: GraphicCue) => {
        const where = place(cue.anchor, cue.pointId)
        if (!where) return null
        const shortest = isFree(cue) ? FREE_GRAPHIC_MIN_US : GRAPHIC_MIN_US
        const secondsUs = Math.round(cue.spec.seconds * 1_000_000)
        const pieceEndUs = sentenceOf(spoken, where.by)?.pieceEndUs ?? null
        const roomUs = pieceEndUs === null ? secondsUs : Math.min(secondsUs, Math.max(pieceEndUs - where.atUs, shortest))
        const playsUs = cue.spec.html !== null && secondsUs - roomUs <= MOTION_RUN_ON_US ? secondsUs : roomUs
        const durationUs = Math.min(playsUs, plan.durationUs - where.atUs)
        return durationUs >= shortest ? { atUs: where.atUs, durationUs } : null
      }
      // a point with no text at all, even with the text on, has its own stretch of the rough cut as its moment: a
      // graphic tied to it starts there. It is told as a band of no height, which no box covers
      const texted = new Set(moments.flatMap((entry) => (entry.pointId !== undefined ? [entry.pointId] : [])))
      const stretches = new Map(placed.map((point) => [point.point.id, { startUs: point.atUs, endUs: point.endUs }]))
      const ownStretchIn = (span: { startUs: number; endUs: number }, pointId: string) => {
        const own = stretches.get(pointId)
        return own !== undefined && own.startUs < span.endUs && span.startUs < own.endUs ? [{ fromY: 0, toY: 0 }] : []
      }
      const room: FreeRoom = {
        textIn: (span) => textGroupsIn(bands, span),
        ownTextIn: (span, pointId) => (texted.has(pointId) ? ownBandsIn(moments, span, pointId) : ownStretchIn(span, pointId)),
        keepIn: faces.keepIn,
      }
      const others = own.map((graphic) => ({ span: { startUs: graphic.atUs, endUs: graphic.atUs + graphic.durationUs }, box: graphic.cue.spec.box }))
      const { admitted, dropped: refused } = admitFree(answered, placedOf, room, others)
      // merged into the outline as it is now: the graphics the user made theirs stay, whenever they did it, and an
      // answer on a place one of theirs holds gives way, since a graphic is known by its place everywhere; Claude's
      // answer replaces every graphic Claude made before, legacy or free, but not on a point deleted meanwhile, which
      // takes what Claude put on it along. Only a motion graphic is ever the user's own: a stored one of another kind,
      // edited or not, plays nowhere and is shown to nobody, Claude included, so it goes as one of Claude's does. An
      // entry of the stored list that is no graphic at all (null, or with no place) is left out of the merge, and so goes too.
      // One of the user's made meanwhile keeps the answers on screen with it in the same place off, as one Claude was
      // told of would have. Every answer the merge leaves out is counted
      let merged = 0
      await amend(folder, (latest) => {
        const flair = latest.flair ?? { looks: {} }
        const now = pointsOf(latest)
        const all = (flair.graphics ?? []).filter(isGraphicEntry)
        const mine = all.filter((graphic) => graphic.edited && isMotion(graphic.spec))
        const meanwhile = mine
          .filter((graphic) => !own.some((told) => samePlace(told.cue.anchor, graphic.anchor)))
          .flatMap((graphic) => {
            const at = placedOf(graphic)
            return at ? [{ startUs: at.atUs, endUs: at.atUs + at.durationUs, box: graphic.spec.box }] : []
          })
        const clear = admitted.filter((cue) => {
          const at = placedOf(cue)
          return at === null || !meanwhile.some((other) => other.startUs < at.atUs + at.durationUs && at.atUs < other.endUs && boxesOverlap(other.box, cue.spec.box))
        })
        const answers = answerOnBeats(clear, stored.outline.beats, latest.outline.beats)
          .filter(onPointNow(now))
          .filter((graphic) => !mine.some((own) => samePlace(own.anchor, graphic.anchor)))
        merged = answers.length
        const graphics = [...mine, ...answers]
        // Claude's sounds on the graphics that went go with them, unless what is still there holds their moment. What
        // went is every stored graphic that is not in the new list: Claude's own, and an edited one of another kind,
        // which is nobody's (every motion graphic the user made theirs is in the list)
        const gone = all.filter((graphic) => !graphics.includes(graphic))
        const held = heldMoments({ ...flair, graphics })
        const cues = gone.reduce((left, graphic) => withoutSoundsOn(left, [startMoment(graphic)], held), flair.cues ?? [])
        // a composed sound scores the graphic it was tied to: it stays only while a graphic that was there before holds its place
        const composed = flair.composed ? { composed: withoutTiedTo(flair.composed, (tied) => !mine.some((graphic) => samePlace(graphic.anchor, tied))) } : {}
        return { ...latest, flair: { ...flair, graphics, ...(flair.cues ? { cues } : {}), ...composed } }
      })
      const dropped = answer.dropped + refused + admitted.length - merged
      // what plays now, read from the stored outline as the preview will read it
      const inForce: { kept: WithPointText[]; jobs: (RenderJob | null)[] } = deps.graphicJobs ? await deps.graphicJobs(folder, rules, view) : { kept: [], jobs: [] }
      // still to be written: what is in force and has no fragment, which is Claude's new ones and any the user made
      // theirs before it was written. What is in force is never switched off
      const unwritten = inForce.kept.flatMap((graphic): PlacedMotion[] => {
        const spec = graphic.cue.spec
        return spec.html === null ? [{ graphic, spec, playsUs: graphic.durationUs, ...(graphic.pointText !== undefined ? { pointText: graphic.pointText } : {}) }] : []
      })
      // a fault a render found on this machine may have been mended since: the writing looks again
      if (unwritten.length > 0) deps.graphics?.forgetMachine()
      // the renders of what has a job start now: a graphic not written yet has none, and is rendered as its writing is checked
      deps.graphics?.ensure(
        inForce.jobs.filter((job) => job !== null),
        folder,
      )
      onStored?.()
      if (unwritten.length === 0) return { count: 0, dropped }
      const work: WritingWork = { folder, rules, llm, canvas, about: aboutOf(stored), captionsFromY: captionsOf(view), signal }
      let written = 0
      let failed = 0
      progress?.(0, unwritten.length)
      await writeAll(
        unwritten,
        // a writing begun after a stop ends before its first call, as one under way ends where it is
        async (placed) => {
          const ended = await writeGraphic(work, placed)
          if (ended === "written") written++
          else if (ended === "failed") failed++
        },
        // what a stop ended was not written: nothing more is reported after it
        (done, total) => {
          if (!signal?.aborted) progress?.(done, total)
        },
        calls,
      )
      return { count: written, dropped: dropped + failed }
    },

    /**
     * One motion graphic written again, from its idea, for the room it has on the rough cut now, which is how
     * one gone stale is put right: the body of a run of the graphics work alone. The graphic is looked for among
     * those placed under the request, playing or switched off; one with no place now fails the work: its point
     * is hidden by the level, too little of the rough cut is left to play it, or, for one that plays, there is no
     * room for it on the frame. One planned before 0.7.0 is made free first, and placed by the free rules
     * (`placedToWrite`).
     *
     * A switched-off one is listed whether or not the frame has room for it now, at the box it is stored with
     * when there is none (`graphicsInForce` does not tell the two apart), and is written for that box all the
     * same: the fragment then fits the box the graphic has when there is room again. It is listed for a length
     * the end of the rough cut has not cut, and is written for what it would play switched on, so that it is not
     * stale the moment it is.
     *
     * Its fragment stays until the new writing has ended, then gives way to the new one, or to none and why, and
     * is kept for one step back (`undoGraphic`); the change a user asked for and why an edit failed go. The graphic
     * is no more the user's than it was, and no other is touched. `signal` is the run's stop, which ends the
     * writing at once wherever it has got to, with nothing stored; `progress` is told (0, 1) as the writing begins
     * and (1, 1) once it has ended.
     */
    async redoGraphic(folder: string, anchor: CueAnchor, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<{ count: number; dropped: number }> {
      const { stored, canvas, placed, restore } = await placedToWrite(folder, anchor, request)
      // a legacy graphic made free for this writing goes back as it was when the writing stores nothing: it was stopped
      const ended = await restoredOnStop(restore, async () => {
        const llm = await claude("writing a graphic")
        progress?.(0, 1)
        // a fault a render found on this machine may have been mended since: the writing looks again
        deps.graphics?.forgetMachine()
        return calls.run(() => writeGraphic({ folder, rules: request.rules, llm, canvas, about: aboutOf(stored), captionsFromY: captionsOf(request.view), signal }, placed))
      })
      progress?.(1, 1)
      return countedOne(ended)
    },

    /**
     * One written motion graphic changed as the user asks (`instruction`), the body of a run of the graphics work
     * alone, as a redo is: the graphic is found as `redoGraphic` finds it, and one with no place now fails the work
     * the same way; one with no fragment to change fails it with why. Claude is given the brief for the room it has
     * now, the change and the fragment it has (`editBrief`), and what it writes goes through the same checks and the
     * one repair as any writing. A graphic gone stale is written for the room it has now, and so is fresh again.
     *
     * Written, the new fragment is stored with the length and the words it was written for and with the change, as
     * it was typed less the white space around it, and the fragment before is kept for one step back; why a writing
     * or an earlier edit failed goes. Failed, the graphic keeps the fragment it had, with why the edit failed. Either
     * way it is no more the user's than it was, and no other is touched. `signal` and `progress` are as a redo's: a
     * stop ends the edit at once, with nothing stored.
     */
    async editGraphic(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<{ count: number; dropped: number }> {
      const { stored, canvas, placed, restore } = await placedToWrite(folder, anchor, request)
      // a legacy graphic made free for this edit goes back as it was, with why the edit failed, when the edit stores
      // no new fragment: it failed, or was stopped
      const ended = await restoredOnStop(restore, async () => {
        const html = placed.spec.html
        if (html === null) throw new Error("this graphic has not been written yet")
        const llm = await claude("editing a graphic")
        progress?.(0, 1)
        // a fault a render found on this machine may have been mended since: the writing looks again
        deps.graphics?.forgetMachine()
        return calls.run(() => writeGraphic({ folder, rules: request.rules, llm, canvas, about: aboutOf(stored), captionsFromY: captionsOf(request.view), signal }, placed, { instruction: instruction.trim(), html }))
      })
      if (ended === "failed") await restore?.()
      progress?.(1, 1)
      return countedOne(ended)
    },

    /**
     * Work 4: the sounds Claude plans on the clip as it plays after works 1 to 3, every point shown, and composes one
     * by one for the room each has (`sound-work.ts`). With the sounds switched off nothing is asked and nothing
     * changes. `signal` is a plan run's stop, which every call is made with; `progress` is told how many composings
     * have ended, of how many. `drawing` is the graphics' writing when the sounds are planned while it goes, which the
     * sounds tied to a graphic not written yet wait for (`sound-work.ts`).
     */
    async planSounds(
      folder: string,
      request: PostRequest,
      signal?: AbortSignal,
      progress?: (done: number, total: number) => void,
      drawing?: Promise<unknown>,
    ): Promise<{ count: number; dropped: number }> {
      if (!request.view.flair.sound) return { count: 0, dropped: 0 }
      return soundWork.run(folder, request, signal, progress, drawing)
    },

    /**
     * A sound effect put on a place by hand, or taken off; Claude leaves it alone after that. It is checked against
     * every sound this machine has, Pro or not; the write leaves out what the user may not use.
     */
    async setCue(folder: string, anchor: CueAnchor, effectId: string | null): Promise<void> {
      await outline(folder)
      if (effectId !== null) {
        const sounds = deps.sounds ? await deps.sounds.list() : []
        if (!sounds.some((sound) => sound.effectId === effectId)) throw new Error(`this machine has no sound ${effectId}`)
      }
      await amend(folder, (stored) => {
        const cues = (stored.flair?.cues ?? []).filter((cue) => !samePlace(cue.anchor, anchor))
        if (effectId !== null) cues.push({ anchor, effectId, edited: true })
        return { ...stored, flair: { ...(stored.flair ?? { looks: {} }), cues } }
      })
    },

    /**
     * A cutaway put on a place by hand, or taken off; Claude leaves it alone after that. One of Claude's taken
     * off takes Claude's sounds on its moment with it. Several may sit at one place (the user's, moved to a
     * beat's start when their text went): `replacing` names the picture of the one changed, which keeps its
     * place among them; without it every one there gives way. Of two with the same picture at one place,
     * `replacing` reaches the first of them.
     */
    async setInsert(folder: string, anchor: CueAnchor, binId: string | null, fit?: MediaFit, replacing?: string): Promise<void> {
      const stored = await outline(folder)
      let look: MediaLook | null = null
      if (binId !== null) {
        const pictures = deps.media ? await deps.media.list(folder, stored.videoIds) : []
        const picture = pictures.find((entry) => entry.binId === binId)
        if (!picture) throw new Error(`this project has no picture ${binId}`)
        // what the picture said about itself, when it has been looked at
        look = await lookedAt(picture)
      }
      await amend(folder, (latest) => {
        const flair = latest.flair ?? { looks: {} }
        const all = flair.inserts ?? []
        const here = all.filter((insert) => samePlace(insert.anchor, anchor))
        const named = replacing === undefined ? undefined : here.find((insert) => insert.binId === replacing)
        // one named that is not there any more: changing another, or stacking one more, would not be what was asked
        if (replacing !== undefined && !named) throw new Error("there is no cutaway of that picture at that place")
        const was = named ?? here[0]
        const inserts = all.filter((insert) => (named ? insert !== named : !here.includes(insert)))
        if (binId !== null) {
          // the same picture keeps how it was framed; the user's own choice wins over both
          const same = binId === was?.binId
          const made = {
            anchor,
            binId,
            edited: true,
            fit: fit ?? (same ? was.fit : look?.fit) ?? "cover",
            subject: (same ? was.subject : look?.subject) ?? null,
            // the one named, changed by hand, stays on the point it was made for, as a graphic changed by hand does
            ...(named?.pointId !== undefined ? { pointId: named.pointId } : {}),
          }
          // the one named keeps its place among the others there, so what plays over what stays as it was
          if (named) inserts.splice(all.indexOf(named), 0, made)
          else inserts.push(made)
          return { ...latest, flair: { ...flair, inserts } }
        }
        const gone = (flair.inserts ?? []).filter((insert) => !insert.edited && !inserts.includes(insert))
        const cues = withoutSoundsOn(flair.cues ?? [], gone.map(startMoment), heldMoments({ ...flair, inserts }))
        // Claude's moves on a cutaway taken off go with it, when no other is left at their place
        return { ...latest, flair: { ...flair, inserts, ...(flair.cues ? { cues } : {}), ...movesBeside(flair, inserts) } }
      })
    },

    /**
     * The picture a point cuts away to, by hand from the emphasis tab: main owns where the point is and what is
     * bound to it. A picture bound to a point sits where the point starts now (the moment Claude's would take,
     * which keeps Claude's off it when the cutaways are thought again). The point's cutaway is the one bound to
     * it; with none, a picture of the user's bound to nothing already where the point starts (one a point planned
     * over left behind) is taken over rather than a second stacked. A picture replaces that one, moved to where
     * the point starts, or goes there new; either way it is the user's and bound to the point. A point off the
     * cut keeps its cutaway where it is. Null takes the point's own off, and with it Claude's sounds on its
     * moment when it was Claude's; a point with no cutaway is left as it is. Being bound to the point, the
     * picture follows the point's level: the level that hides the point hides it too, as it does a graphic.
     */
    async setPointPicture(folder: string, rules: CutRules, pointId: string, binId: string | null, fit?: MediaFit): Promise<void> {
      const { stored, plan, clips } = await deps.timeline.compiled(folder, rules)
      const placed = placedPoints(stored, plan, clips).find((entry) => entry.point.id === pointId)
      let look: MediaLook | null = null
      if (binId !== null) {
        const pictures = deps.media ? await deps.media.list(folder, stored.videoIds) : []
        const picture = pictures.find((entry) => entry.binId === binId)
        if (!picture) throw new Error(`this project has no picture ${binId}`)
        look = await lookedAt(picture)
      }
      await amend(folder, (latest) => {
        if (!pointsOf(latest).has(pointId)) throw new Error(`there is no point ${pointId}`)
        const flair = latest.flair ?? { looks: {} }
        const all = flair.inserts ?? []
        const own = all.find((insert) => insert.pointId === pointId)
        if (binId === null) {
          if (!own) return latest
          const inserts = all.filter((insert) => insert !== own)
          const cues = withoutSoundsOn(flair.cues ?? [], own.edited ? [] : [startMoment(own)], heldMoments({ ...flair, inserts }))
          return { ...latest, flair: { ...flair, inserts, ...(flair.cues ? { cues } : {}), ...movesBeside(flair, inserts) } }
        }
        const start = placed ? pointAnchor(placed) : own?.anchor
        if (start === undefined) throw new Error(`the point ${pointId} is not on the rough cut`)
        const was = own ?? all.find((insert) => insert.pointId === undefined && insert.edited && samePlace(insert.anchor, start))
        // the same picture keeps how it was framed; the user's own choice wins over both
        const same = binId === was?.binId
        const made = {
          anchor: start,
          binId,
          edited: true,
          fit: fit ?? (same ? was.fit : look?.fit) ?? "cover",
          subject: (same ? was.subject : look?.subject) ?? null,
          pointId,
        }
        const inserts = was ? all.map((insert) => (insert === was ? made : insert)) : [...all, made]
        // the picture moved to where the point starts leaves Claude's moves on it behind, with no cutaway at their place
        return { ...latest, flair: { ...flair, inserts, ...movesBeside(flair, inserts) } }
      })
    },

    /** A zoom put on a piece by hand, or taken off; Claude leaves it alone after that. One of Claude's taken off takes Claude's sounds on its moment with it. */
    async setZoom(folder: string, anchor: PieceAnchor, kind: ZoomKind | null): Promise<void> {
      if (kind !== null && !ZOOM_KINDS.includes(kind)) throw new Error(`unknown zoom ${String(kind)}`)
      await outline(folder)
      await amend(folder, (stored) => {
        const flair = stored.flair ?? { looks: {} }
        // one saved before zooms knew their beat may be on either beat's piece of that footage, so it gives way too
        const zooms = (flair.zooms ?? []).filter((zoom) => !samePiece(zoom.anchor, anchor))
        if (kind !== null) {
          zooms.push({ anchor, kind, edited: true })
          return { ...stored, flair: { ...flair, zooms } }
        }
        const gone = (flair.zooms ?? []).filter((zoom) => !zoom.edited && !zooms.includes(zoom))
        const cues = withoutSoundsOn(flair.cues ?? [], gone.map(punchMoment), heldMoments({ ...flair, zooms }))
        return { ...stored, flair: { ...flair, zooms, ...(flair.cues ? { cues } : {}) } }
      })
    },

    /**
     * A graphic switched off or on by hand, or taken away; Claude leaves it alone after that. One of Claude's
     * taken away takes Claude's sounds on its moment with it, and any graphic taken away takes the composed sounds
     * tied to it. Switched off, the sounds tied to it are switched off with it where they are placed, and stay stored.
     */
    async setGraphic(folder: string, anchor: CueAnchor, patch: GraphicPatch | null): Promise<void> {
      await outline(folder)
      await amend(folder, (stored) => {
        const graphics = stored.flair?.graphics ?? []
        const index = graphics.findIndex((graphic) => samePlace(graphic.anchor, anchor))
        if (index < 0) throw new Error("there is no graphic at that place")
        if (patch !== null) return { ...stored, flair: { ...stored.flair!, graphics: graphics.map((graphic, i) => (i === index ? changedGraphic(graphic, patch) : graphic)) } }
        const next = graphics.filter((_, i) => i !== index)
        const gone = graphics[index]!.edited ? [] : [startMoment(graphics[index]!)]
        const flair = stored.flair!
        const cues = withoutSoundsOn(flair.cues ?? [], gone, heldMoments({ ...flair, graphics: next }))
        // the composed sounds tied to it go with it, whoever's it was; switched off, they are switched off with it where they are placed
        const removed = graphics[index]!.anchor
        const composed = flair.composed ? { composed: withoutTiedTo(flair.composed, (tied) => samePlace(tied, removed)) } : {}
        return { ...stored, flair: { ...flair, graphics: next, ...(flair.cues ? { cues } : {}), ...composed } }
      })
    },

    /**
     * One step back on a graphic: the fragment kept by its last edit or writing again changes places with the one
     * there (`steppedBack`), in one change of the outline as it is now, so a second step back comes back. Claude is
     * not asked and nothing is rendered: the file made for the fragment kept is found again by what it draws, and one
     * whose room has changed since is stale as any other would be. The graphic is no more the user's than it was. One
     * that is not there, or has no fragment kept (`isPrevious`), has nothing to go back to.
     *
     * In the same change, each composed sound tied to it whose code kept for a step back was composed to the fragment
     * that comes back (by `hashOfHtml`) steps back with it; one composed to another picture is left as it is, and reads
     * as stale by the picture until it is composed again.
     */
    async undoGraphic(folder: string, anchor: CueAnchor): Promise<void> {
      await outline(folder)
      await amend(folder, (stored) => {
        const graphics = stored.flair?.graphics ?? []
        const index = graphics.findIndex((graphic) => samePlace(graphic.anchor, anchor))
        const found = graphics[index]
        const previous = found && isMotion(found.spec) ? found.spec.previous : undefined
        // what a file holds there that is no fragment is nothing to go back to
        if (!found || !isPrevious(previous)) throw new Error("this graphic has nothing to go back to")
        const spec = steppedBack(found.spec, previous)
        // a tied sound whose code kept for a step back was composed to the fragment that comes back steps back with it,
        // unless the code it has now was composed to that fragment already (stepping back would trade it for an older
        // one); another is left, and reads as composed to another picture
        const back = spec.html === null ? null : hashOfHtml(spec.html)
        const follows = (sound: ComposedSound) =>
          isComposed(sound) &&
          sound.graphic !== undefined &&
          samePlace(sound.graphic, found.anchor) &&
          back !== null &&
          isSoundPrevious(sound.previous) &&
          sound.previous.graphicHtml === back &&
          (sound.code === null || sound.graphicHtml !== back)
        const composed = stored.flair!.composed
        const sounds = composed ? { composed: composed.map((sound) => (follows(sound) ? soundSteppedBack(sound, sound.previous!) : sound)) } : {}
        return { ...stored, flair: { ...stored.flair!, graphics: graphics.map((graphic, i) => (i === index ? { ...found, spec } : graphic)), ...sounds } }
      })
    },

    /**
     * One move of the picture designed again by Claude at the word it starts on, the body of a run of the techniques
     * work alone (`moveAgain`); one with no place now fails the work. The text and the graphics are not thought again.
     */
    redoMove: (folder: string, anchor: MoveAnchor, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void) =>
      moveAgain(folder, anchor, request, null, signal, progress),

    /** One move of the picture changed by Claude as the user asks, from the poses it has, as `redoMove` designs one (`moveAgain`). */
    editMove: (folder: string, anchor: MoveAnchor, instruction: string, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void) =>
      moveAgain(folder, anchor, request, instruction.trim(), signal, progress),

    /**
     * One step back on a move: the poses and line kept by its last redesign or change change places with the ones it
     * has, in one change of the outline as it is now, so a second step back comes back. Claude is not asked. The move
     * is no more the user's than it was. One that is not there, or keeps nothing, has nothing to go back to.
     */
    async undoMove(folder: string, anchor: MoveAnchor): Promise<void> {
      await outline(folder)
      await amend(folder, (stored) => {
        const moves = stored.flair?.moves ?? []
        const index = moves.findIndex((move) => isMove(move) && sameMove(move, moveAt(anchor)))
        const found = moves[index]
        if (!found || !isMove(found) || found.previous === undefined) throw new Error("this move has nothing to go back to")
        return { ...stored, flair: { ...stored.flair!, moves: moves.map((move, i) => (i === index ? movedBack(found, found.previous!) : move)) } }
      })
    },

    /** A move switched off or on by hand, which makes it the user's (Claude leaves it alone after), or taken away with null. */
    async setMove(folder: string, anchor: MoveAnchor, patch: { off: boolean } | null): Promise<void> {
      await outline(folder)
      await amend(folder, (stored) => {
        const moves = stored.flair?.moves ?? []
        const index = moves.findIndex((move) => isMove(move) && sameMove(move, moveAt(anchor)))
        if (index < 0) throw new Error("there is no move at that place")
        const next = patch === null ? moves.filter((_, i) => i !== index) : moves.map((move, i) => (i === index ? { ...move, off: patch.off, edited: true } : move))
        return { ...stored, flair: { ...stored.flair!, moves: next } }
      })
    },

    /**
     * Every composed sound tied to the graphic at `anchor` composed again to the fragment that graphic has now, one at
     * a time, as a redo of each would compose it (spec §11): what a run of a graphic written again or edited does once
     * the graphic is stored written. `signal` is the run's stop; `progress` is told how many composings have ended, of
     * how many. With no sound tied to it, nothing is asked.
     */
    soundsAfterGraphic: soundActions.afterGraphic,

    /**
     * One composed sound composed again for the room it has now, the body of a run of the sounds work alone
     * (`sound-actions.ts`); one with no place now fails the work.
     */
    redoSound: soundActions.redo,

    /** One written composed sound changed as the user asks, the body of a run of the sounds work alone, as a redo is. */
    editSound: soundActions.edit,

    /** One step back on a composed sound: the code kept changes places with the one there. */
    undoSound: soundActions.undo,

    /** A composed sound switched off or on by hand, or taken away. */
    setSound: soundActions.set,

    /** Forgets a graphic's failed render, so the next look at the preview renders it again. */
    async retryGraphic(folder: string, anchor: CueAnchor): Promise<void> {
      const stored = await outline(folder)
      const graphic = (stored.flair?.graphics ?? []).find((candidate) => samePlace(candidate.anchor, anchor))
      if (!graphic || !deps.graphics || !deps.jobFor) return
      const job = await deps.jobFor(folder, graphic)
      if (job) deps.graphics.retry(deps.graphics.hashOf(job))
    },

    /** One group's look, set by hand on the post-production page; Claude leaves it alone after that. */
    async setLook(folder: string, groupId: string, patch: FlairLookPatch): Promise<void> {
      if (patch.pattern !== undefined && !TEXT_PATTERNS.includes(patch.pattern as TextPattern)) throw new Error(`unknown pattern ${String(patch.pattern)}`)
      if (patch.exit !== undefined && patch.exit !== null && !exitById(patch.exit)) throw new Error(`unknown exit animation ${patch.exit}`)
      await outline(folder)
      await amend(folder, (stored) => {
        const group = stored.highlights?.groups.find((candidate) => candidate.id === groupId)
        if (!group) throw new Error(`unknown highlight group ${groupId}`)

        const looks = stored.flair?.looks ?? {}
        const look = looks[groupId] ?? DEFAULT_LOOK
        let accent = look.accent
        if (patch.accent === null) accent = null
        else if (patch.accent !== undefined) {
          // the accent is kept by the stored line it is on, whichever place that line shows at
          const index = patch.accent.lineIndex ?? patch.accent.line
          const line = group.lines[index]?.text
          const found = line === undefined ? null : findWord(line, patch.accent.word)
          if (!found) throw new Error(`"${patch.accent.word}" is not in line ${patch.accent.line + 1} of this group`)
          accent = { line: index, ...found }
        }
        const next: GroupLook = {
          pattern: patch.pattern ?? look.pattern,
          tone: patch.tone ?? look.tone,
          accent,
          exit: patch.exit !== undefined ? patch.exit : look.exit,
          edited: true,
        }
        return { ...stored, flair: { ...(stored.flair ?? {}), looks: { ...looks, [groupId]: next } } }
      })
    },
  }
}

export type FlairService = ReturnType<typeof createFlairService>
