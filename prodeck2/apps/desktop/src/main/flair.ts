import type { CutRules } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"

/** What a cached description was made from: the prompt and the model that looked at the picture. */
export interface MediaKey {
  prompt: string
  model: string
}
import { exitById, TEXT_PATTERNS, type TextPattern } from "@boxblack/core/flair/catalogue"
import { findWord, planTechniques, type TechniquePoint } from "@boxblack/core/flair/direct"
import { DEFAULT_LOOK, ZOOM_KINDS, type CueAnchor, type GroupLook, type InsertCue, type PieceAnchor, type ZoomKind } from "@boxblack/core/flair/plan"
import { planSounds } from "@boxblack/core/flair/sound-plan"
import { usableSounds } from "@boxblack/core/flair/sound-catalogue"
import { stageBox } from "@boxblack/core/graphics/framing"
import { planMotion } from "@boxblack/core/graphics/motion/direct"
import type { GraphicPoint } from "@boxblack/core/graphics/motion/points"
import { editBrief, motionBrief } from "@boxblack/core/graphics/motion/write"
import { clipText, GRAPHIC_MIN_US, isMotion, MOTION_VERSION, type GraphicCue, type MotionSpec, type PlacedGraphic, type PreviousFragment } from "@boxblack/core/graphics/plan"
import { timeHighlights } from "@boxblack/core/highlights"
import { SUBTITLE_ROOM_FROM_Y } from "@boxblack/core/highlights/layout"
import { DEFAULT_HIGHLIGHT_OPTIONS, styleFor } from "@boxblack/core/highlights/styles"
import type { LlmTransport } from "@boxblack/core/llm"
import type { FlairLookPatch, GraphicPatch, HighlightViewOptions, PostRequest, StoredOutline } from "../shared/api.ts"
import { existingGraphics, framesWanted, graphicPoints, isGraphicEntry, renderSeconds, textBands } from "./graphics-cues.ts"
import type { GraphicsRenderer, RenderJob } from "./graphics-render.ts"
import { answerOnBeats, everyPointShown, looksInForce, placedPoints, placeStored, pointAnchor, pointText, styleInForce, timelineOf, type ShowRules } from "./highlight-state.ts"
import { heldMoments, punchMoment, samePlace, slotsFor, soundSlotsFor, startMoment, withoutSoundsOn } from "./sound-cues.ts"
import { insertsInForce, itemPlaceOf, placeOf, withDescriptions, type SpareMedia } from "./insert-media.ts"
import { writeAll, writePiece, type PieceToWrite, type Written } from "./motion-write.ts"
import { describeMedia, MEDIA_PROMPT_VERSION, type MediaFit, type MediaFrame, type MediaLook } from "@boxblack/core/flair/look-at"
import type { BinMedia } from "@boxblack/core/flair/media"
import { pieceKey, pointPiece, punchAtUs, samePiece, zoomSlotsFor, zoomsInForce } from "./zoom-cues.ts"
import { spokenSentences, wordsIn } from "./spoken.ts"
import type { SoundLibrary } from "./sound-library.ts"
import type { OutlineStore } from "./planner.ts"
import type { TimelineService } from "./timeline.ts"

export interface FlairDeps {
  outlines: OutlineStore
  timeline: Pick<TimelineService, "compiled">
  /** the sounds this machine's CapCut has */
  sounds?: Pick<SoundLibrary, "list">
  /** whether the user has CapCut Pro, read from settings each time: without it Claude is offered only the free sounds (spec 0.4.2) */
  pro: () => Promise<boolean>
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
  /** the graphics in force and their render jobs, and the switched-off ones, built from the stored outline the way the preview builds them */
  graphicJobs?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: PlacedGraphic[]; off: PlacedGraphic[]; jobs: (RenderJob | null)[] }>
  /** the render job a placed motion graphic would have with the spec a writing would store for it, drawn as the preview draws it; null with no frame to draw on */
  candidateJob?: (folder: string, rules: CutRules, graphic: PlacedGraphic, spec: MotionSpec) => Promise<RenderJob | null>
  /** one stored graphic's render job as the post-production page shows it; null when it does not play */
  jobFor?: (folder: string, cue: GraphicCue) => Promise<RenderJob | null>
}

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

/** The fragment a spec holds, with what it was written for and the change that made it when one did; none when it holds no fragment. */
function fragmentHeld(spec: MotionSpec): PreviousFragment | undefined {
  if (spec.html === null) return undefined
  return { html: spec.html, seconds: spec.seconds, words: spec.words, version: spec.version, ...(spec.instruction !== undefined ? { instruction: spec.instruction } : {}) }
}

/**
 * What a writing that ends keeps for one step back: the fragment the graphic had until then, when it had one, else
 * the one it kept already, so a writing that fails after another failed still keeps the last good fragment.
 */
function keptBefore(spec: MotionSpec): { previous?: PreviousFragment } {
  const previous = fragmentHeld(spec) ?? spec.previous
  return previous ? { previous } : {}
}

/**
 * A motion graphic's spec once a writing of it (a plan's, or a redo) has ended. Written, it holds the fragment with
 * the length and the words it was written for, under the contract in force now, so that it says truthfully what the
 * fragment is for and the graphic is fresh until the cut changes again; why an earlier writing failed goes. Failed,
 * it holds no fragment, and why; its length and words stay as they were. Either way the fragment it had until then
 * is kept for one step back (`keptBefore`), and the change a user asked for and why an edit failed go, since
 * neither is about the fragment it has now.
 */
function afterWriting(spec: MotionSpec, writtenFor: PieceToWrite, written: Written): MotionSpec {
  const { failed: _failed, instruction: _instruction, editFailed: _editFailed, previous: _previous, ...rest } = spec
  const kept = keptBefore(spec)
  return "html" in written
    ? { ...rest, version: MOTION_VERSION, html: written.html, seconds: writtenFor.seconds, words: writtenFor.words, ...kept }
    : { ...rest, html: null, failed: written.failed, ...kept }
}

/**
 * A motion graphic's spec once an edit of it has ended. Written, it holds the new fragment as `afterWriting` holds
 * one, with the change that made it, and keeps the fragment it had until then for one step back; why a writing or an
 * earlier edit failed goes. Failed, it is as it was, with why the edit failed: the fragment it had still plays.
 */
function afterEdit(spec: MotionSpec, writtenFor: PieceToWrite, written: Written, instruction: string): MotionSpec {
  if (!("html" in written)) return { ...spec, editFailed: written.failed }
  const { failed: _failed, editFailed: _editFailed, previous: _previous, ...rest } = spec
  return { ...rest, version: MOTION_VERSION, html: written.html, seconds: writtenFor.seconds, words: writtenFor.words, instruction, ...keptBefore(spec) }
}

/**
 * A motion graphic's spec one step back: the fragment kept takes the place of the one there, with the length, the
 * words, the contract and the change it was written for (none when no change made it), and the one there is kept in
 * its place when there is one; one with no fragment (a writing again that failed) leaves nothing to come back to.
 * Why a writing or an edit failed goes, since it was about the fragment that leaves; nothing else changes.
 */
function steppedBack(spec: MotionSpec, previous: PreviousFragment): MotionSpec {
  const { failed: _failed, editFailed: _editFailed, instruction: _instruction, previous: _previous, ...rest } = spec
  const now = fragmentHeld(spec)
  return {
    ...rest,
    html: previous.html,
    seconds: previous.seconds,
    words: previous.words,
    version: previous.version,
    ...(previous.instruction !== undefined ? { instruction: previous.instruction } : {}),
    ...(now ? { previous: now } : {}),
  }
}

/** A motion graphic as it is placed, to be written there: the graphic, its spec as it is placed, and how long it plays, which is the length it is written for. */
interface PlacedMotion {
  graphic: PlacedGraphic
  spec: MotionSpec
  playsUs: number
}

/** What the writings of one work share, the graphics work or one graphic written again: the project and the rules its graphics are placed under, the Claude connection, the frame they are drawn on, what the clip is about, and the work's stop. */
interface WritingWork {
  folder: string
  rules: CutRules
  llm: { transport: LlmTransport; model: string }
  canvas: { width: number; height: number }
  about: string
  signal?: AbortSignal
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
   * Frames of the footage at each point's first kept moment, for the graphics call: only the ones it will
   * attach — none of a point in `taken` (the user's own, by number from 1) — one extraction per video.
   */
  async function graphicFrames(folder: string, points: GraphicPoint[], looking: LookingSession | undefined, taken: Set<number>): Promise<Record<string, string>> {
    if (!looking?.at || !deps.videoPath) return {}
    const { keys, wanted } = framesWanted(points, taken)
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
   * placed on the frame. A fragment the linter passes is rendered as the graphic will be once it is stored. How
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
  async function writeGraphic(work: WritingWork, { graphic, spec, playsUs }: PlacedMotion, edit?: { instruction: string; html: string }): Promise<"written" | "failed" | "gone"> {
    const { folder, rules } = work
    const { width, height } = stageBox(spec.box, work.canvas)
    const writtenFor: PieceToWrite = { stage: { width, height }, seconds: renderSeconds(playsUs), words: graphic.wordsNow ?? [], idea: spec.idea, about: work.about }
    const ending = (was: MotionSpec, written: Written) => (edit ? afterEdit(was, writtenFor, written, edit.instruction) : afterWriting(was, writtenFor, written))
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
   */
  async function placedToWrite(folder: string, anchor: CueAnchor, request: PostRequest): Promise<{ stored: StoredOutline; canvas: { width: number; height: number }; placed: PlacedMotion }> {
    const { rules, view } = request
    const { stored, plan, canvas } = await deps.timeline.compiled(folder, rules)
    const placed: { kept: PlacedGraphic[]; off: PlacedGraphic[] } = canvas && deps.graphicJobs ? await deps.graphicJobs(folder, rules, view) : { kept: [], off: [] }
    const here = (graphic: PlacedGraphic) => samePlace(graphic.cue.anchor, anchor)
    const playing = placed.kept.find(here)
    const switchedOff = playing ? undefined : placed.off.find(here)
    const graphic = playing ?? switchedOff
    const spec = graphic?.cue.spec
    // switched off, it plays what it is listed for, less what the end of the rough cut would cut of it switched on
    const playsUs = playing ? playing.durationUs : switchedOff ? Math.min(switchedOff.durationUs, plan.durationUs - switchedOff.atUs) : 0
    if (!canvas || !graphic || !spec || playsUs < GRAPHIC_MIN_US) throw new Error("this graphic has no place on the clip now")
    return { stored, canvas, placed: { graphic, spec, playsUs } }
  }

  /** What one graphic written again or edited counts for its run: written, or failed and dropped; neither when it was taken away meanwhile. */
  const countedOne = (ended: "written" | "failed" | "gone") => ({ count: ended === "written" ? 1 : 0, dropped: ended === "failed" ? 1 : 0 })

  return {
    /**
     * Work 2b: zooms and cutaways from the points; the user's own stay; stored as soon as they come. A kind
     * with nothing offered (switched off, no picture, no piece long enough) keeps what is stored. Claude's
     * sounds on its zooms and cutaways that go, go with them. `signal` is a plan run's stop, which every call
     * is made with.
     */
    async planTechniques(folder: string, request: PostRequest, signal?: AbortSignal): Promise<{ count: number; dropped: number }> {
      const { rules, view } = request
      if (!view.flair.zoom && !view.flair.insert) return { count: 0, dropped: 0 }
      const { transport, model } = await claude("planning zooms and cutaways")
      const { stored, plan, clips } = await deps.timeline.compiled(folder, rules)
      const placed = placedPoints(stored, plan, clips)
      if (placed.length === 0) return { count: 0, dropped: 0 }
      const at = timelineOf(plan)
      const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
      // the text as it plays with every point shown, which names what a zoomed piece holds
      const timed = timeHighlights(placeStored(stored, plan, clips, everyPoint(view, placed)), at, plan.durationUs)
      const pieces = view.flair.zoom ? zoomSlotsFor({ plan, groups: timed, beatNames, at }) : []
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
        piece: pointPiece(pieces, point),
      }))
      const pictures = view.flair.insert && deps.media ? await deps.media.list(folder, stored.videoIds) : []
      // the frames Claude looks at stay on disk only as long as this planning does
      const looking = pictures.length > 0 ? deps.frames?.() : undefined
      let planned: Awaited<ReturnType<typeof planTechniques>>
      try {
        const said = await describedMedia(pictures, { transport, model }, looking, signal)
        planned = await planTechniques({ transport, model, brief: stored.brief, points, media: withDescriptions(pictures, said), pictureFrames: await framesFor(pictures, looking), signal })
      } finally {
        await looking?.dispose()
      }
      const asked = new Set(points.map((point) => point.pointId))
      // merged into the outline as it is now: what the user set by hand, before or while Claude thought, stays,
      // and what Claude put on a point deleted meanwhile goes with it
      await amend(folder, (latest) => {
        const flair = latest.flair ?? { looks: {} }
        const now = pointsOf(latest)
        const waiting = waitingFor(asked, now)
        const myZooms = (flair.zooms ?? []).filter((zoom) => zoom.edited)
        const answerZooms = answerOnBeats(planned.zooms, stored.outline.beats, latest.outline.beats).filter(onPointNow(now))
        const zooms =
          !view.flair.zoom || pieces.length === 0
            ? (flair.zooms ?? [])
            : [...myZooms, ...(flair.zooms ?? []).filter(waiting), ...answerZooms.filter((zoom) => !myZooms.some((own) => samePiece(own.anchor, zoom.anchor)))]
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
        const inserts =
          !view.flair.insert || pictures.length === 0
            ? (flair.inserts ?? [])
            : [...myInserts, ...(flair.inserts ?? []).filter(waiting), ...answerInserts.filter((insert) => !myInserts.some(takenBy(insert)))]
        // Claude's sounds on its zooms and cutaways that went go with them
        const goneZooms = (flair.zooms ?? []).filter((zoom) => !zoom.edited && !zooms.includes(zoom))
        const goneInserts = (flair.inserts ?? []).filter((insert) => !insert.edited && !inserts.includes(insert))
        const cues = withoutSoundsOn(flair.cues ?? [], [...goneZooms.map(punchMoment), ...goneInserts.map(startMoment)], heldMoments({ zooms, inserts, graphics: flair.graphics }))
        return { ...latest, flair: { ...flair, zooms, inserts, ...(flair.cues ? { cues } : {}) } }
      })
      return { count: planned.zooms.length + planned.inserts.length, dropped: planned.dropped }
    },

    /**
     * Work 2c: motion graphics from the points, around the text 2a placed, first planned and then written.
     * Claude is shown each point with the scene under it, where the text over it is drawn with the looks in
     * force, a frame at its first kept moment, and the user's own graphics, which keep Claude off their points,
     * and answers where a graphic would help and what each one draws. The plan is stored as it comes, none of
     * its graphics written yet; Claude's sounds on its graphics that go, go with them. With no canvas it answers
     * `skipped: "no-canvas"`, which the run shows as the work skipped, as if switched off.
     *
     * Then every graphic in force at the level set that has no fragment is written, three at a time, each for
     * the room it has on the rough cut now (`writeGraphic`) and stored as its writing ends: the fragment, or why
     * there is none. One the level hides, one with no room on the frame and one switched off are not written,
     * and wait; one gone stale waits for the user to ask (`redoGraphic`). `progress` is told how many writings
     * have ended, of how many, before the first and after each. The count answered is the graphics written in
     * this run; dropped are the answers of the plan that could not be used and the graphics whose writing failed.
     *
     * `signal` is a plan run's stop, which every call is made with. Pressed during the writing, it ends every
     * writing under way at once, whether Claude is writing or the fragment is being rendered, and starts no
     * other: nothing of a stopped writing is stored, the graphics already written stay, and the work rejects as a
     * stopped call does.
     */
    async planGraphics(folder: string, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<{ count: number; dropped: number; skipped?: "no-canvas" }> {
      const { rules, view } = request
      if (!view.flair.graphic) return { count: 0, dropped: 0 }
      const llm = await claude("planning graphics")
      const { stored, plan, clips, canvas } = await deps.timeline.compiled(folder, rules)
      // no frame size to draw on (the first kept video is not in the draft's bin): the run shows the work as skipped, not done
      if (!canvas) return { count: 0, dropped: 0, skipped: "no-canvas" }
      const placed = placedPoints(stored, plan, clips)
      if (placed.length === 0) return { count: 0, dropped: 0 }
      const at = timelineOf(plan)
      const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
      const spoken = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at })
      // the text as it plays with every point shown, laid out with the looks in force; the custom style draws in bold-white's font
      const groups = placeStored(stored, plan, clips, everyPoint(view, placed))
      const timed = timeHighlights(groups, at, plan.durationUs)
      const looks = looksInForce(stored, timed.map((group) => ({ id: group.groupId, lines: group.lines.map((line) => ({ lineIndex: line.lineIndex, text: line.text.trim() })) })), view.flair, canvas)
      const font = styleFor(styleInForce(stored.highlights), DEFAULT_HIGHLIGHT_OPTIONS.custom).font
      const bands = textBands({ placed: groups, timed, clips, canvas, font, looks, position: view.position, subtitlesOn: view.subtitlesOn })
      const points = graphicPoints({ points: placed, sentences: spoken, clips, bands })
      const existing = existingGraphics(stored.flair?.graphics ?? [], points)
      const looking = deps.videoPath ? deps.frames?.() : undefined
      let answer: Awaited<ReturnType<typeof planMotion>>
      try {
        answer = await planMotion({
          ...llm,
          brief: stored.brief,
          points,
          canvas,
          // the room highlights/layout.ts keeps highlight text above while subtitles are on
          captionsFromY: view.subtitlesOn ? SUBTITLE_ROOM_FROM_Y : null,
          frames: await graphicFrames(folder, points, looking, new Set(existing.map((graphic) => graphic.point))),
          existing,
          signal,
        })
      } finally {
        await looking?.dispose()
      }
      const asked = new Set(points.map((point) => point.pointId))
      // merged into the outline as it is now: the graphics the user made theirs stay, whenever they did it,
      // and a point one of theirs sits on is theirs; Claude's answer replaces the rest, but not on a point
      // deleted meanwhile, which takes what Claude put on it along. Only a motion graphic is ever the user's
      // own: a stored one of another kind, edited or not, plays nowhere and is shown to nobody, Claude included
      // (`existingGraphics`), so it holds no point and goes as one of Claude's does. An entry of the stored list that
      // is no graphic at all (null, or with no place) is left out of the merge, and so goes too
      await amend(folder, (latest) => {
        const flair = latest.flair ?? { looks: {} }
        const now = pointsOf(latest)
        const all = (flair.graphics ?? []).filter(isGraphicEntry)
        const mine = all.filter((graphic) => graphic.edited && isMotion(graphic.spec))
        const theirs = new Set(mine.flatMap((own) => (own.pointId === undefined ? [] : [own.pointId])))
        const free = answer.graphics.filter((graphic) => graphic.pointId === undefined || !theirs.has(graphic.pointId))
        const answers = answerOnBeats(free, stored.outline.beats, latest.outline.beats)
          .filter(onPointNow(now))
          .filter((graphic) => !mine.some((own) => samePlace(own.anchor, graphic.anchor)))
        // one place holds one graphic, since a graphic is known by its place everywhere: one of Claude's that waits for
        // its point to come back gives way to what is on its place now, one of the user's own or a new answer, which plays
        const waits = all.filter(waitingFor(asked, now))
        const displaced = waits.filter((graphic) => [...mine, ...answers].some((there) => samePlace(there.anchor, graphic.anchor)))
        const graphics = [...mine, ...waits.filter((graphic) => !displaced.includes(graphic)), ...answers]
        // Claude's sounds on the graphics that went go with them, unless what is still there holds their moment. What
        // went is every stored graphic that is not in the new list: Claude's own, and an edited one of another kind,
        // which is nobody's (every motion graphic the user made theirs is in the list). The moment of one that gave
        // its place away is held by the graphic it gave way to, which its sound was not made for: its sound stays
        // only for another item of its own point there
        const gone = all.filter((graphic) => !graphics.includes(graphic))
        const held = heldMoments({ ...flair, graphics })
        const heldFor = (graphic: GraphicCue) => (displaced.includes(graphic) ? held.filter((slot) => slot?.pointId === graphic.pointId) : held)
        const cues = gone.reduce((left, graphic) => withoutSoundsOn(left, [startMoment(graphic)], heldFor(graphic)), flair.cues ?? [])
        return { ...latest, flair: { ...flair, graphics, ...(flair.cues ? { cues } : {}) } }
      })
      // what plays now, read from the stored outline as the preview will read it
      const inForce: { kept: PlacedGraphic[]; jobs: (RenderJob | null)[] } = deps.graphicJobs ? await deps.graphicJobs(folder, rules, view) : { kept: [], jobs: [] }
      // still to be written: what is in force and has no fragment, which is Claude's new ones and any the user made
      // theirs before it was written. What is in force is never switched off
      const unwritten = inForce.kept.flatMap((graphic): PlacedMotion[] => {
        const spec = graphic.cue.spec
        return spec.html === null ? [{ graphic, spec, playsUs: graphic.durationUs }] : []
      })
      // a fault a render found on this machine may have been mended since: the writing looks again
      if (unwritten.length > 0) deps.graphics?.forgetMachine()
      // the renders of what has a job start now: a graphic not written yet has none, and is rendered as its writing is checked
      deps.graphics?.ensure(
        inForce.jobs.filter((job) => job !== null),
        folder,
      )
      if (unwritten.length === 0) return { count: 0, dropped: answer.dropped }
      const work: WritingWork = { folder, rules, llm, canvas, about: aboutOf(stored), signal }
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
      )
      return { count: written, dropped: answer.dropped + failed }
    },

    /**
     * One motion graphic written again, from its idea, for the room it has on the rough cut now, which is how
     * one gone stale is put right: the body of a run of the graphics work alone. The graphic is looked for among
     * those placed under the request, playing or switched off; one with no place now fails the work: its point
     * is hidden by the level, too little of the rough cut is left to play it, or, for one that plays, there is no
     * room for it on the frame.
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
      const { stored, canvas, placed } = await placedToWrite(folder, anchor, request)
      const llm = await claude("writing a graphic")
      progress?.(0, 1)
      // a fault a render found on this machine may have been mended since: the writing looks again
      deps.graphics?.forgetMachine()
      const ended = await writeGraphic({ folder, rules: request.rules, llm, canvas, about: aboutOf(stored), signal }, placed)
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
      const { stored, canvas, placed } = await placedToWrite(folder, anchor, request)
      const html = placed.spec.html
      if (html === null) throw new Error("this graphic has not been written yet")
      const llm = await claude("editing a graphic")
      progress?.(0, 1)
      // a fault a render found on this machine may have been mended since: the writing looks again
      deps.graphics?.forgetMachine()
      const ended = await writeGraphic({ folder, rules: request.rules, llm, canvas, about: aboutOf(stored), signal }, placed, { instruction: instruction.trim(), html })
      progress?.(1, 1)
      return countedOne(ended)
    },

    /**
     * Work 4: sounds on the slots of soundSlotsFor — the points, and the start of every line of text,
     * graphic and cutaway work 2 put on them, and each punch — whatever the level in force. Claude is offered
     * only the sounds the user may use: without CapCut Pro, the free ones. The user's own sounds stay, unless
     * this machine no longer has them — one that only needs Pro stays too. `signal` is a plan run's stop, which
     * the call is made with.
     */
    async planSounds(folder: string, request: PostRequest, signal?: AbortSignal): Promise<{ count: number; dropped: number }> {
      const { rules, view } = request
      if (!view.flair.sound) return { count: 0, dropped: 0 }
      const all = deps.sounds ? await deps.sounds.list() : []
      // Claude is offered only what the user may use; the user's own choices on the others stay stored
      const sounds = usableSounds(all, await deps.pro())
      if (sounds.length === 0) return { count: 0, dropped: 0 }
      const { transport, model } = await claude("planning sounds")
      const { stored, plan, clips } = await deps.timeline.compiled(folder, rules)
      const points = placedPoints(stored, plan, clips)
      if (points.length === 0) return { count: 0, dropped: 0 }
      const at = timelineOf(plan)
      const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
      const shown = everyPoint(view, points)
      // every group the text shows, each with the point it was made for. One a graphic takes the place of is among
      // them: its lines are still moments of the clip, offered as before
      const timed = timeHighlights(placeStored(stored, plan, clips, shown), at, plan.durationUs)
      // a cutaway whose moment the cut took out is offered where it plays, at its point's start, as the preview shows it
      const place = itemPlaceOf(placeOf({ slots: slotsFor({ plan, groups: timed, beatNames, at }), sentences: spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at }), plan, at }), points)
      // each punch is offered where it lands with every point shown: on the first line of text in its piece, else
      // at its start. A punch landing on a line shares that line's moment, and the line's slot takes it (soundSlotsFor),
      // so a punch is a place of its own only in a piece with no text, where it lands at its start at every level
      const pieces = zoomSlotsFor({ plan, groups: timed, beatNames, at })
      const byPiece = new Map(pieces.map((piece) => [pieceKey(piece.anchor), piece]))
      const zoomed = zoomsInForce({ zooms: stored.flair?.zooms ?? [], slots: pieces, flair: view.flair, durationUs: plan.durationUs, passes: shown.passes }).kept
      const punches = zoomed.flatMap((zoom) => {
        const piece = byPiece.get(pieceKey(zoom.cue.anchor))
        if (!piece || zoom.cue.kind !== "punch") return []
        const offsetUs = punchAtUs(piece, timed)
        const anchor: CueAnchor = { kind: "speech", videoId: piece.anchor.videoId, sourceUs: piece.anchor.sourceUs + offsetUs, beatId: piece.beatId }
        return [{ atUs: piece.atUs + offsetUs, anchor, pointId: zoom.cue.pointId }]
      })
      const pictures = view.flair.insert && deps.media ? await deps.media.list(folder, stored.videoIds) : []
      const inserts = insertsInForce({ inserts: stored.flair?.inserts ?? [], place, media: pictures, flair: view.flair, durationUs: plan.durationUs, passes: shown.passes }).kept
      // the graphics as they play at the loudest level, where every point shows
      const graphics =
        view.flair.graphic && deps.graphicJobs
          ? await deps.graphicJobs(folder, rules, { ...view, flair: { ...view.flair, level: "heavy" } }).then(
              (made) => made.kept,
              () => [],
            )
          : []
      const slots = soundSlotsFor({ plan, groups: timed, points, zooms: punches, inserts, graphics, beatNames, at })
      const planned = await planSounds({ transport, model, brief: stored.brief, slots, sounds, signal })
      // every sound this machine has: one the user set that only needs Pro is still theirs
      const have = new Set(all.map((sound) => sound.effectId))
      const asked = new Set(points.map((point) => point.point.id))
      // merged into the outline as it is now: a place the user chose a sound for — even on a join the cut
      // has moved a little since — is theirs, unless this machine no longer has that sound
      await amend(folder, (latest) => {
        const cues = latest.flair?.cues ?? []
        const now = pointsOf(latest)
        const mine = cues.filter((cue) => cue.edited && have.has(cue.effectId))
        // a line of text taken out meanwhile takes Claude's sound for it with it, and so does a point deleted meanwhile
        const groupsNow = new Set((latest.highlights?.groups ?? []).map((group) => group.id))
        const answer = answerOnBeats(planned.cues, stored.outline.beats, latest.outline.beats)
          .filter((cue) => cue.anchor.kind !== "highlight" || groupsNow.has(cue.anchor.groupId))
          .filter(onPointNow(now))
        const next = [...mine, ...cues.filter(waitingFor(asked, now)), ...answer.filter((cue) => !mine.some((own) => samePlace(own.anchor, cue.anchor)))]
        return { ...latest, flair: { ...(latest.flair ?? { looks: {} }), cues: next } }
      })
      return { count: planned.cues.length, dropped: planned.dropped }
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
        return { ...latest, flair: { ...flair, inserts, ...(flair.cues ? { cues } : {}) } }
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
          return { ...latest, flair: { ...flair, inserts, ...(flair.cues ? { cues } : {}) } }
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
        return { ...latest, flair: { ...flair, inserts } }
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
     * taken away takes Claude's sounds on its moment with it.
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
        return { ...stored, flair: { ...flair, graphics: next, ...(flair.cues ? { cues } : {}) } }
      })
    },

    /**
     * One step back on a graphic: the fragment kept by its last edit or writing again changes places with the one
     * there (`steppedBack`), in one change of the outline as it is now, so a second step back comes back. Claude is
     * not asked and nothing is rendered: the file made for the fragment kept is found again by what it draws, and one
     * whose room has changed since is stale as any other would be. The graphic is no more the user's than it was. One
     * that is not there, or has no fragment kept, has nothing to go back to.
     */
    async undoGraphic(folder: string, anchor: CueAnchor): Promise<void> {
      await outline(folder)
      await amend(folder, (stored) => {
        const graphics = stored.flair?.graphics ?? []
        const index = graphics.findIndex((graphic) => samePlace(graphic.anchor, anchor))
        const found = graphics[index]
        const previous = found && isMotion(found.spec) ? found.spec.previous : undefined
        if (!found || !previous) throw new Error("this graphic has nothing to go back to")
        return { ...stored, flair: { ...stored.flair!, graphics: graphics.map((graphic, i) => (i === index ? { ...found, spec: steppedBack(found.spec, previous) } : graphic)) } }
      })
    },

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
