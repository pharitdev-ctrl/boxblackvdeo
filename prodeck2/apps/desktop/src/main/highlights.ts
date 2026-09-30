import { randomUUID } from "node:crypto"
import type { CutClip, CutPlan, CutRules } from "@boxblack/core/cut"
import { groupsFromWords, layoutGroup, PART_BREAK, pickHighlights, timeHighlights, type HighlightGroup, type HighlightPoint } from "@boxblack/core/highlights"
import { joinWords } from "@boxblack/core/subtitles/captions"
import { SUBTITLE_ROOM_FROM_Y } from "@boxblack/core/highlights/layout"
import { DEFAULT_HIGHLIGHT_OPTIONS, HIGHLIGHT_STYLE_IDS, maxHighlightChars, styleFor, type HighlightStyle, type HighlightStyleId } from "@boxblack/core/highlights/styles"
import type { LlmTransport } from "@boxblack/core/llm"
import type { TimedGroup } from "@boxblack/core/highlights"
import type { HighlightPreview, HighlightViewOptions, StoredHighlights, StoredOutline } from "../shared/api.ts"
import { loadFootage, transcriptFingerprint, type FootageDeps } from "./footage.ts"
import {
  beatsKey,
  currentGroups,
  heldExits,
  isLandscape,
  looksInForce,
  missingPictures,
  placedPoints,
  placeStored,
  placementOf,
  pointText,
  regroupFlair,
  SHOW_ALL,
  showRulesOver,
  styleInForce,
  timelineOf,
  withLineText,
  withoutLine,
  withoutOverlaps,
  type ShowRules,
} from "./highlight-state.ts"
import { emphasisView, offGoneLines } from "./emphasis.ts"
import type { PlacedPoint, PointFilter } from "@boxblack/core/emphasis"
import { cuesInForce, samePlace, slotFinder, slotsFor } from "./sound-cues.ts"
import { pieceFinder, pieceKey, zoomSlotsFor, zoomsInForce } from "./zoom-cues.ts"
import { hasBeatless, withBeats, type BeatFinders } from "./legacy-beats.ts"
import { insertsInForce, itemPlaceOf, placeOf, type SpareMedia } from "./insert-media.ts"
import { graphicJob, graphicsInForce, graphicViews, isReplaced, keepClearsIn, replacedPoints, sentenceOf, textBands, textBandsIn, wordsSaidFrom } from "./graphics-cues.ts"
import type { GraphicsRenderer, RenderJob } from "./graphics-render.ts"
import { spokenSentences, wordsIn } from "./spoken.ts"
import type { MediaLook } from "@boxblack/core/flair/look-at"
import type { BinMedia } from "@boxblack/core/flair/media"
import type { SoundLibrary } from "./sound-library.ts"
import { exitsFor, type FlairOptions } from "@boxblack/core/flair/catalogue"
import type { SoundEffect } from "@boxblack/core/flair/sounds"
import { soundNeedsPro, usableSounds } from "@boxblack/core/flair/sound-catalogue"
import type { SoundCue } from "@boxblack/core/flair/plan"
import type { GraphicCue, MotionSpec, PlacedGraphic } from "@boxblack/core/graphics/plan"
import type { OutlineStore } from "./planner.ts"
import type { TimelineService } from "./timeline.ts"

export interface HighlightDeps {
  outlines: OutlineStore
  timeline: Pick<TimelineService, "compiled">
  footage: FootageDeps
  /** the sounds this machine's CapCut has, for the cues */
  sounds?: Pick<SoundLibrary, "list">
  /** the project's own spare photos and clips, for the cutaways */
  media?: SpareMedia
  /** what each picture shows, as the flair step last saw it */
  descriptions?: (paths: string[]) => Promise<Record<string, MediaLook>>
  /** the Claude connection chosen in settings */
  llm?: () => Promise<{ transport: LlmTransport; model: string }>
  /** the graphics renderer: what is made, what is not, and the pictures of it */
  graphics?: Pick<GraphicsRenderer, "hashOf" | "statusOf" | "posterOf" | "failureOf" | "ensure" | "environmentProblem">
  /** whether the renderer pack is installed */
  graphicsReady?: () => Promise<boolean>
  /** the highlight style in force, custom palette included, for the graphics' colours */
  styleOf?: (stored: StoredOutline) => Promise<HighlightStyle>
  newId?: () => string
}

type Canvas = { width: number; height: number }

/** Each group's lines as the write lays them out, trimmed. */
const shownLines = (timed: TimedGroup[]) => timed.map((group) => ({ id: group.groupId, lines: group.lines.map((line) => ({ lineIndex: line.lineIndex, text: line.text.trim() })) }))

/** A line longer than this is not highlight text, whatever the request says. */
const MAX_TEXT_LENGTH = 100
const LINE_LENGTHS = [maxHighlightChars({ width: 1080, height: 1920 }), maxHighlightChars({ width: 1920, height: 1080 })]

const EMPTY: StoredHighlights = { style: null, styleByAi: null, groups: [], beatsKey: null, transcripts: {} }

/**
 * The placed points as the text call is shown them, in playing order: every point on the rough cut,
 * whatever the level, since the level only filters what shows. A spoken point carries the rows of the
 * rough cut's sentences in its beat that say any of its phrase (the cut splits a sentence into rows
 * where it takes a word out), from the first row's first word to the last row's last, for its lines to
 * be quoted from, and its phrase as those rows play it; one said in no row of its beat is left out. A
 * picture point carries its stretch and the description of the scene at its first kept moment (pointText,
 * the one way every call and the emphasis tab name a point).
 */
function highlightPoints(stored: StoredOutline, plan: CutPlan, clips: CutClip[]): HighlightPoint[] {
  const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
  const wordsOf = wordsIn(clips)
  const sentences = spokenSentences({ plan, wordsOf, beatNames, at: timelineOf(plan) })
  return placedPoints(stored, plan, clips).flatMap((placed): HighlightPoint[] => {
    const { point } = placed
    const base = {
      pointId: point.id,
      importance: point.importance,
      type: point.type,
      reason: point.reason,
      videoId: placed.videoId,
      beatId: placed.beatId,
      beatName: beatNames.get(placed.beatId) ?? placed.beatId,
      atUs: placed.atUs,
    }
    const anchor = point.anchor
    if (anchor.kind === "scene") {
      return [{ ...base, kind: "scene", text: pointText(placed, clips), startUs: anchor.startUs, endUs: anchor.endUs, durationUs: placed.endUs - placed.atUs }]
    }
    // the rows of its beat that say any of the phrase, in playing order; words the cut took out lie between them
    const rows = sentences.filter((candidate) => candidate.videoId === anchor.videoId && candidate.beatId === placed.beatId && candidate.from < anchor.to && anchor.from < candidate.to)
    if (rows.length === 0) return []
    const words = wordsOf(anchor.videoId)
    // the phrase as the rows play it: its words the cut kept, PART_BREAK where it took some out
    const text = rows.map((row) => joinWords(words.slice(Math.max(row.from, anchor.from), Math.min(row.to, anchor.to)).map((word) => word.text))).join(PART_BREAK)
    return [
      {
        ...base,
        kind: "speech",
        text,
        phrase: { from: anchor.from, to: anchor.to },
        sentence: { from: Math.min(...rows.map((row) => row.from)), to: Math.max(...rows.map((row) => row.to)), text: rows.map((row) => row.text).join(PART_BREAK) },
      },
    ]
  })
}

export function createHighlightService(deps: HighlightDeps) {
  const newId = deps.newId ?? randomUUID

  /** The machine's sounds, read only when the cues could use them. */
  const library = async (flair: FlairOptions): Promise<SoundEffect[]> => (flair.sound && deps.sounds ? deps.sounds.list() : [])

  /** The project's spare pictures, read only when a cutaway could use them. */
  const spare = async (stored: StoredOutline, flair: FlairOptions, folder: string): Promise<BinMedia[]> =>
    flair.insert && deps.media ? deps.media.list(folder, stored.videoIds) : []

  /** What those pictures show, as the flair step last saw them; never a fresh look. */
  const describedBy = async (pictures: BinMedia[]): Promise<Record<string, string>> => {
    if (pictures.length === 0 || !deps.descriptions) return {}
    // the store is keyed by file, and the rest of the app by bin item
    const byPath = await deps.descriptions(pictures.map((picture) => picture.path))
    return Object.fromEntries(pictures.flatMap((picture) => (byPath[picture.path] ? [[picture.binId, byPath[picture.path]!.what]] : [])))
  }

  async function outline(folder: string): Promise<StoredOutline> {
    const stored = await deps.outlines.get(folder)
    if (!stored) throw new Error("this project has no outline yet")
    return stored
  }

  async function view(
    stored: StoredOutline,
    plan: CutPlan,
    clips: CutClip[],
    canvas: Canvas | null,
    fps: number,
    options: HighlightViewOptions,
    /** the user has CapCut Pro: without it the exits and sounds that need it are held, and only the free ones offered */
    pro: boolean,
    sounds: SoundEffect[],
    pictures: BinMedia[],
    said: Record<string, string>,
    folder: string,
  ): Promise<HighlightPreview> {
    const highlights = stored.highlights
    // what these options show, worked out once for the text and every kind of item, over the points placed on
    // this rough cut, where an item whose own moment the cut took out plays instead
    const points = placedPoints(stored, plan, clips)
    const show = showRulesOver(points, options)
    const placed = placeStored(stored, plan, clips, show)
    const timed = timeHighlights(placed, timelineOf(plan), plan.durationUs)
    const sources = new Map((highlights?.groups ?? []).map((group) => [group.id, group.source]))
    const byId = new Map(placed.map((group) => [group.groupId, group]))
    // the graphics, worked out once, against the text of every group shown and before the groups are listed: the
    // groups of a point whose graphic plays are replaced. With graphics off, or no frame to draw on, none plays
    const inForce = options.flair.graphic && canvas ? graphicsOn(stored, plan, clips, canvas, options, show, points) : null
    const replaced = replacedPoints(inForce ?? { kept: [] })
    // the custom style draws in bold-white's font, so its palette is beside the point here
    const font = styleFor(styleInForce(highlights), DEFAULT_HIGHLIGHT_OPTIONS.custom).font
    const frame = canvas ?? { width: 1080, height: 1920 }
    const looks = looksInForce(stored, shownLines(timed), options.flair, canvas, pro)
    // the exits the groups shown keep stored but that are not written without Pro
    const held = heldExits(stored, timed.map((group) => group.groupId), options.flair, pro)
    const dodgeOf = (group: TimedGroup) =>
      layoutGroup(
        group.lines.map((line) => line.text.trim()),
        font,
        frame,
        placementOf(byId.get(group.groupId)!, clips, options.position, options.subtitlesOn),
        looks[group.groupId]?.pattern,
      ).dodge
    // the sounds, worked out once: what they hold back for want of Pro is counted below with the exits
    const sounded = soundView(stored, plan, timed, clips, sounds, options.flair, currentGroups(stored, clips), show, points, pro)
    const preview: Omit<HighlightPreview, "emphasis"> = {
      style: styleInForce(highlights),
      styleByAi: highlights?.styleByAi ?? null,
      groups: timed.map((group) => ({
        id: group.groupId,
        beatId: group.beatId,
        source: sources.get(group.groupId)!,
        ...(group.pointId !== undefined ? { pointId: group.pointId } : {}),
        // listed whether or not it is drawn: a replaced group keeps its times, its look and its lines
        replaced: isReplaced(group, replaced),
        startUs: group.startUs,
        endUs: group.endUs,
        placement: dodgeOf(group),
        look: looks[group.groupId]!,
        ...(held[group.groupId] ? { heldExit: held[group.groupId]! } : {}),
        lines: group.lines.map((line) => ({ index: line.lineIndex, text: line.text, startUs: line.startUs, partial: line.partial })),
        ...(byId.get(group.groupId)!.scene ? { scene: true as const } : {}),
      })),
      // while the text is on: stored groups bound to no point, or to a point that plays at a level that shows it,
      // which do not play themselves, since every word is cut or they were made on an earlier transcript
      hidden: show.text ? (highlights?.groups ?? []).filter((group) => show.passes(group.pointId)).length - timed.length : 0,
      outlineChanged: highlights?.beatsKey != null && highlights.beatsKey !== beatsKey(stored.outline.beats),
      needsPictures: options.position === "auto" && missingPictures(clips),
      landscape: isLandscape(canvas),
      ...sounded,
      ...zoomView(stored, plan, timed, clips, options.flair, show.passes),
      ...insertView(stored, plan, timed, clips, pictures, said, options.flair, show.passes, points),
      ...(await graphicView(stored, canvas, fps, inForce, folder)),
      maxChars: maxHighlightChars(frame),
      exits: exitsFor(pro).map(({ id, name }) => ({ id, name })),
      // the exits held back are those of the groups that are written, which a replaced group is not; the sounds
      // held back are the stored ones that would play here but for Pro
      proLeftOut: { exits: timed.filter((group) => held[group.groupId] && !isReplaced(group, replaced)).length, sounds: sounded.unusedSounds.pro },
    }
    return {
      ...preview,
      // what plays on each point, as the lists above show it: a switched-off graphic plays nothing. A replaced group
      // still counts as its point's text: the point has it, so the emphasis tab offers to make no second one
      emphasis: emphasisView({
        stored,
        plan,
        clips,
        level: options.flair.level,
        items: {
          text: preview.groups.map((group) => group.pointId),
          zoom: preview.zooms.map((zoom) => zoom.pointId),
          insert: preview.inserts.map((insert) => insert.pointId),
          graphic: preview.graphics.filter((graphic) => !graphic.off).map((graphic) => graphic.pointId),
          sound: preview.cues.map((cue) => cue.pointId),
        },
      }),
    }
  }

  /**
   * The graphics on this rough cut, placed and moved as their plan was, each lasting until the piece
   * playing its sentence ends when that comes first: off what the picture keeps clear and the highlight
   * text on screen (laid out with the looks the preview shows) at any time while it plays, but for the
   * text of its own point, and, while subtitles are on, off their room. A cutaway playing at the same
   * time takes nothing from them. `off` are the switched-off ones still on the cut. One whose moment the
   * cut took out plays where its point starts now (itemPlaceOf over `points`, the points placed on this
   * rough cut). Each comes with the words said now while it plays, those of the sentence its moment is
   * in, and with whether it is stale. The preview, the render jobs and so the write all take them from here.
   *
   * The order is fixed, and never repeated: the groups are placed, timed and given their looks over every
   * group the rules show; the graphics are placed against those groups' text, each less its own point's;
   * and only then are the points whose graphic plays read from the graphics kept (`replacedPoints`), and
   * their groups not drawn. So a graphic also keeps off another point's text that turns out replaced.
   */
  function graphicsOn(stored: StoredOutline, plan: CutPlan, clips: CutClip[], canvas: Canvas, options: HighlightViewOptions, show: ShowRules, points: PlacedPoint[]) {
    const at = timelineOf(plan)
    const placed = placeStored(stored, plan, clips, show)
    const timed = timeHighlights(placed, at, plan.durationUs)
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const sentences = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at })
    const place = itemPlaceOf(placeOf({ slots: slotsFor({ plan, groups: timed, beatNames, at }), sentences, plan, at }), points)
    // the custom style draws in bold-white's font, so its palette is beside the point here
    const font = styleFor(styleInForce(stored.highlights), DEFAULT_HIGHLIGHT_OPTIONS.custom).font
    const looks = looksInForce(stored, shownLines(timed), options.flair, canvas)
    const bands = textBands({ placed, timed, clips, canvas, font, looks, position: options.position, subtitlesOn: options.subtitlesOn })
    const { kept, off } = graphicsInForce({
      graphics: stored.flair?.graphics ?? [],
      place,
      flair: options.flair,
      durationUs: plan.durationUs,
      passes: show.passes,
      pieceEndOf: (anchor) => sentenceOf(sentences, anchor)?.pieceEndUs ?? null,
      keepClearIn: (span) => keepClearsIn(plan, clips, span),
      textIn: (span, pointId) => textBandsIn(bands, span, pointId),
      wordsFrom: wordsSaidFrom({ sentences, clips }),
      // the room highlights/layout.ts keeps highlight text above while subtitles are on
      captionsFromY: options.subtitlesOn ? SUBTITLE_ROOM_FROM_Y : null,
    })
    return { kept, off, place }
  }

  /**
   * What the renderer is asked for: each graphic that plays, drawn in the style in force on the rough cut's frame, at its
   * frame rate. The jobs come in the order of `kept`, with null for a graphic that has none: one not written
   * yet, or stale.
   */
  async function jobsOf(stored: StoredOutline, kept: PlacedGraphic[], canvas: Canvas, fps: number): Promise<(RenderJob | null)[]> {
    if (kept.length === 0) return []
    if (!deps.styleOf) throw new Error("the graphics cannot be drawn: there is no highlight style to draw them in")
    const style = await deps.styleOf(stored)
    return kept.map((graphic) => graphicJob(graphic, { canvas, fps, style }))
  }

  /**
   * The graphics that will play, then the switched-off ones, with what the renderer has made of them so far; what is not
   * made yet starts now. One with no job (not written yet, or stale) waits, with no poster and no error, and the
   * renderer is asked nothing about it. `inForce` is what `graphicsOn` found for this look at the preview, null
   * when it was not asked: with graphics off, or no frame to draw on.
   */
  async function graphicView(
    stored: StoredOutline,
    canvas: Canvas | null,
    fps: number,
    inForce: ReturnType<typeof graphicsOn> | null,
    folder: string,
  ): Promise<Pick<HighlightPreview, "graphics" | "graphicsWaitForPack" | "graphicsProblem">> {
    // with graphics off, or no frame to draw on, none plays: nothing to show, and no pack worth installing for it
    if (!inForce || !canvas) return { graphics: [], graphicsWaitForPack: false, graphicsProblem: null }
    const { kept, off, place } = inForce
    const views = graphicViews({ kept, off }, place)
    const ready = (await deps.graphicsReady?.()) ?? false
    const waiting = { render: "waiting" as const, poster: null, error: null }
    const renderer = deps.graphics
    // why they wait when the pack is in: a render found the machine unfit (the pack damaged, the app's ffmpeg or a font missing)
    if (!renderer || !deps.styleOf) return { graphics: views.map((graphic) => ({ ...graphic, ...waiting })), graphicsWaitForPack: !ready, graphicsProblem: renderer?.environmentProblem() ?? null }
    const jobs = await jobsOf(stored, kept, canvas, fps)
    // what the renderer is asked for: the jobs there are
    const asked = jobs.filter((job) => job !== null)
    const graphicsProblem = renderer.environmentProblem()
    // in the background; the renderer answers what is made or failed at once, and nothing renders without the pack
    if (ready) renderer.ensure(asked, folder)
    const graphics = await Promise.all(
      views.map(async (graphic, i) => {
        // the ones that play come first, each with its job, if it has one; a switched-off one is never rendered
        const job = graphic.off ? null : (jobs[i] ?? null)
        if (job === null) return { ...graphic, ...waiting }
        const hash = renderer.hashOf(job)
        return { ...graphic, render: await renderer.statusOf(hash), poster: await renderer.posterOf(hash), error: renderer.failureOf(hash) }
      }),
    )
    return { graphics, graphicsWaitForPack: !ready, graphicsProblem }
  }

  /**
   * The graphics in force under these rules and options, with their render jobs; the plan starts them, the write waits
   * for them. `jobs[i]` is the job of `kept[i]`, or null when it has none (a graphic not written yet, or stale):
   * whoever hands the jobs to the renderer leaves the nulls out. `off` are the switched-off ones still on the cut,
   * placed as the list shows them, which have no job: one of them may still be written again.
   */
  async function graphicJobs(folder: string, rules: CutRules, options: HighlightViewOptions): Promise<{ kept: PlacedGraphic[]; off: PlacedGraphic[]; jobs: (RenderJob | null)[] }> {
    const { stored, plan, clips, canvas, fps } = await deps.timeline.compiled(folder, rules)
    if (!canvas) return { kept: [], off: [], jobs: [] }
    const points = placedPoints(stored, plan, clips)
    const { kept, off } = graphicsOn(stored, plan, clips, canvas, options, showRulesOver(points, options), points)
    return { kept, off, jobs: await jobsOf(stored, kept, canvas, fps) }
  }

  /**
   * The sound effects that will play, the places one could go, and what of this machine's the user may use;
   * `points` are the points placed on this rough cut. Without CapCut Pro (`pro`) a stored cue on a sound that
   * needs it neither plays nor is offered, and is counted apart; it stays stored.
   */
  function soundView(stored: StoredOutline, plan: CutPlan, timed: TimedGroup[], clips: CutClip[], sounds: SoundEffect[], flair: FlairOptions, current: HighlightGroup[], show: ShowRules, points: PlacedPoint[], pro: boolean) {
    if (!flair.sound) return { cues: [], slots: [], sounds: [], unusedSounds: { unplaced: 0, missing: 0, lost: 0, pro: 0 } }
    const at = timelineOf(plan)
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const slots = slotsFor({ plan, groups: timed, beatNames, at })
    // a sound on a point's start or a graphic's is a moment of speech, which only placeOf finds; one whose moment
    // the cut took out plays where its point starts now, as the cutaway or graphic it is on does
    const place = itemPlaceOf(placeOf({ slots, sentences: spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at }), plan, at }), points)
    const cues = stored.flair?.cues ?? []
    const groups = new Map(current.map((group) => [group.id, group]))
    // a sound on text made from an earlier transcript never plays again: it is lost, not waiting
    const lostCue = (cue: SoundCue) => cue.anchor.kind === "highlight" && !groups.has(cue.anchor.groupId)
    // one on a line of text these options do not show (the text is off, or its point is below the level) waits with it
    const waits = (cue: SoundCue) => {
      const group = cue.anchor.kind === "highlight" ? groups.get(cue.anchor.groupId) : undefined
      return group !== undefined && (!show.text || !show.passes(group.pointId))
    }
    const { kept, unplaced, missing, pro: heldForPro } = cuesInForce({
      cues: cues.filter((cue) => !lostCue(cue) && !waits(cue)),
      place,
      sounds,
      flair,
      durationUs: plan.durationUs,
      passes: show.passes,
      needsPro: pro ? undefined : soundNeedsPro,
    })
    const lost = cues.filter(lostCue).length
    const slotOf = slotFinder(slots)
    return {
      // each cue is shown on the place it plays at, so the screen finds it there even when the cut moved its join
      cues: kept.map((placed) => ({
        // a moment of speech (a point's start, a graphic's) has no slot: it is shown by its own anchor
        anchor: slotOf(placed.cue.anchor)?.anchor ?? placed.cue.anchor,
        atUs: placed.atUs,
        what: place(placed.cue.anchor, placed.cue.pointId)!.what,
        beatId: place(placed.cue.anchor, placed.cue.pointId)!.beatId,
        effectId: placed.cue.effectId,
        soundName: placed.sound.use ?? placed.sound.name,
        edited: placed.cue.edited,
        ...(placed.cue.pointId !== undefined ? { pointId: placed.cue.pointId } : {}),
      })),
      slots: slots.map((slot) => ({ anchor: slot.anchor, atUs: slot.atUs, what: slot.what, beatId: slot.beatId })),
      // what a sound is for reads better than CapCut's catalogue titles, which are often Japanese or Chinese
      sounds: usableSounds(sounds, pro).map((sound) => ({ effectId: sound.effectId, name: sound.use ?? sound.name })),
      unusedSounds: { unplaced, missing, lost, pro: heldForPro },
    }
  }

  /**
   * The cutaways that will play, and the pictures this project could cut away to; `points` are the points placed
   * on this rough cut, where one whose moment the cut took out plays instead. Each is shown with its stored anchor,
   * which an edit finds it by.
   */
  function insertView(stored: StoredOutline, plan: CutPlan, timed: TimedGroup[], clips: CutClip[], pictures: BinMedia[], said: Record<string, string>, flair: FlairOptions, passes: PointFilter, points: PlacedPoint[]) {
    if (!flair.insert) return { inserts: [], media: [] }
    const at = timelineOf(plan)
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const slots = slotsFor({ plan, groups: timed, beatNames, at })
    const sentences = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at })
    const place = itemPlaceOf(placeOf({ slots, sentences, plan, at }), points)
    const kept = insertsInForce({ inserts: stored.flair?.inserts ?? [], place, media: pictures, flair, durationUs: plan.durationUs, passes }).kept
    const nameOf = (picture: BinMedia) => said[picture.binId] || picture.name
    return {
      inserts: kept.map((placed) => ({
        anchor: placed.cue.anchor,
        atUs: placed.atUs,
        durationUs: placed.durationUs,
        what: place(placed.cue.anchor, placed.cue.pointId)!.what,
        beatId: place(placed.cue.anchor, placed.cue.pointId)!.beatId,
        binId: placed.cue.binId,
        picture: nameOf(placed.media),
        fit: placed.cue.fit ?? "cover",
        edited: placed.cue.edited,
        ...(placed.cue.pointId !== undefined ? { pointId: placed.cue.pointId } : {}),
      })),
      media: pictures.map((picture) => ({ binId: picture.binId, name: picture.name, kind: picture.kind, what: nameOf(picture) })),
    }
  }

  /** The zooms that will play, every piece one could go on, and how many stored zooms lost their piece. */
  function zoomView(stored: StoredOutline, plan: CutPlan, timed: TimedGroup[], clips: CutClip[], flair: FlairOptions, passes: PointFilter) {
    if (!flair.zoom) return { zooms: [], pieces: [], zoomsLost: 0 }
    const slots = zoomSlotsFor({ plan, groups: timed, beatNames: new Map(stored.outline.beats.map((beat) => [beat.id, beat.name])), at: timelineOf(plan) })
    const { kept, lost } = zoomsInForce({ zooms: stored.flair?.zooms ?? [], slots, flair, durationUs: plan.durationUs, passes })
    const byAnchor = new Map(slots.map((slot) => [pieceKey(slot.anchor), slot]))
    return {
      zooms: kept.map((placed) => ({
        anchor: placed.cue.anchor,
        atUs: placed.atUs,
        durationUs: placed.durationUs,
        what: byAnchor.get(pieceKey(placed.cue.anchor))!.what,
        beatId: byAnchor.get(pieceKey(placed.cue.anchor))!.beatId,
        kind: placed.cue.kind,
        edited: placed.cue.edited,
        ...(placed.cue.pointId !== undefined ? { pointId: placed.cue.pointId } : {}),
      })),
      pieces: slots.map((slot) => ({ anchor: slot.anchor, atUs: slot.atUs, durationUs: slot.durationUs, what: slot.what, beatId: slot.beatId })),
      zoomsLost: lost,
    }
  }

  /**
   * What was saved before it knew its beat is given the beat it plays in, once, so later changes on
   * the other beat leave it be. Written only when something found its beat, and only onto the
   * outline the cut was made from: a beat or cut change that landed meanwhile is left for the next look.
   */
  async function settleBeats(folder: string, stored: StoredOutline, plan: CutPlan, clips: CutClip[]): Promise<StoredOutline> {
    if (!hasBeatless(stored)) return stored
    const find = beatsOn(stored, plan, clips)
    if (withBeats(stored, find) === stored) return stored
    const cutFrom = (outline: StoredOutline) => JSON.stringify([outline.outline, outline.cutDecisions ?? null, outline.highlights ?? null])
    return amend(folder, (latest) => (cutFrom(latest) === cutFrom(stored) ? withBeats(latest, find) : latest))
  }

  /** Where things play on this rough cut, the way the preview and the write place them. */
  function beatsOn(stored: StoredOutline, plan: CutPlan, clips: CutClip[]): BeatFinders {
    const at = timelineOf(plan)
    // every stored group, whatever the options: an old item finds its beat wherever it plays
    const timed = timeHighlights(placeStored(stored, plan, clips, SHOW_ALL), at, plan.durationUs)
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const slots = slotsFor({ plan, groups: timed, beatNames, at })
    const slotOf = slotFinder(slots)
    const place = placeOf({ slots, sentences: spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at }), plan, at })
    const pieceOf = pieceFinder(zoomSlotsFor({ plan, groups: timed, beatNames, at }))
    return { cue: (anchor) => slotOf(anchor)?.beatId, insert: (anchor) => place(anchor)?.beatId, zoom: (anchor) => pieceOf(anchor)?.beatId }
  }

  /** Changes the outline as it is on disk now, after any change made meanwhile. */
  function amend(folder: string, change: (stored: StoredOutline) => StoredOutline): Promise<StoredOutline> {
    return deps.outlines.update(folder, (latest) => {
      if (!latest) throw new Error("this project has no outline yet")
      return change(latest)
    })
  }

  /** Applies a change to the stored groups of a project. */
  async function change(folder: string, update: (highlights: StoredHighlights) => StoredHighlights): Promise<void> {
    await outline(folder)
    await amend(folder, (stored) => ({ ...stored, highlights: update(stored.highlights ?? EMPTY) }))
  }

  function findGroup(highlights: StoredHighlights, groupId: string): HighlightGroup {
    const group = highlights.groups.find((candidate) => candidate.id === groupId)
    if (!group) throw new Error(`unknown highlight group ${groupId}`)
    return group
  }

  return {
    async preview(folder: string, rules: CutRules, options: HighlightViewOptions): Promise<HighlightPreview> {
      const compiled = await deps.timeline.compiled(folder, rules)
      const { plan, clips, canvas, fps } = compiled
      const stored = await settleBeats(folder, compiled.stored, plan, clips)
      const pictures = await spare(stored, options.flair, folder)
      const { pro } = (await deps.footage.settings.read()).capcut
      return view(stored, plan, clips, canvas, fps, options, pro, await library(options.flair), pictures, await describedBy(pictures), folder)
    },

    graphicJobs,

    /**
     * One stored graphic's render job as the post-production page shows it, for a retry: the page previews
     * under the rules and options in settings, so under those the graphic is placed and moved as it was
     * shown, and the job's hash is the one that failed. Null when it does not play there, or plays with no
     * job: a motion graphic not written yet, or stale.
     */
    async jobFor(folder: string, cue: GraphicCue): Promise<RenderJob | null> {
      const settings = await deps.footage.settings.read()
      const { kept, jobs } = await graphicJobs(folder, settings.cut, { position: settings.highlights.position, subtitlesOn: settings.subtitles.enabled, highlightsOn: settings.highlights.enabled, flair: settings.flair })
      const index = kept.findIndex((graphic) => samePlace(graphic.cue.anchor, cue.anchor))
      return index < 0 ? null : (jobs[index] ?? null)
    },

    /**
     * The render job a placed motion graphic would have with `spec`, its spec as a writing would store it (the
     * fragment, and the length and the words it was written for): the graphic as `graphicJobs` placed it, fresh,
     * drawn as the preview draws it, on the rough cut's frame at its frame rate under these rules, in the style
     * in force. A writing renders its candidate through this, so the file its check makes is the one the preview
     * and the write then use, and nothing is rendered twice. Null with no frame to draw on.
     */
    async candidateJob(folder: string, rules: CutRules, graphic: PlacedGraphic, spec: MotionSpec): Promise<RenderJob | null> {
      const { stored, canvas, fps } = await deps.timeline.compiled(folder, rules)
      if (!canvas) return null
      const [job] = await jobsOf(stored, [{ ...graphic, cue: { ...graphic.cue, spec }, stale: false }], canvas, fps)
      return job ?? null
    },

    /**
     * Work 2a: Claude picks the text from the emphasis points — every point placed on the rough cut, at
     * every level — with each group's look, in one call. Claude's text is replaced only on the points it was
     * asked about: its text on a point that is still there but Claude was not asked about (one not on the
     * rough cut now, its words or its stretch cut; or one no sentence of its beat says) waits: it stays as it
     * is, with its look and what is on its lines, hidden while its point does not play (spec §4.3). Groups the
     * user made or edited stay, and so does the user's style; Claude's new groups carry their point, and their
     * looks are stored with them. What the user edited on Claude's replaced text follows the new text with the
     * same words, never text that waits, else goes to the start of its beat. `signal` is a plan run's stop,
     * which the call is made with.
     */
    async pick(folder: string, rules: CutRules, options: HighlightViewOptions, signal?: AbortSignal): Promise<{ preview: HighlightPreview; dropped: number }> {
      if (!deps.llm) throw new Error("picking highlight text is not ready: no Claude connection")
      const { transport, model } = await deps.llm()
      const { stored, plan, clips, canvas, fps } = await deps.timeline.compiled(folder, rules)
      const { pro } = (await deps.footage.settings.read()).capcut
      // the points Claude is shown, as they were when it was asked (the merge's `points` are those stored when it lands)
      const offered = highlightPoints(stored, plan, clips)
      const picked = await pickHighlights({
        transport,
        model,
        brief: stored.brief,
        durationUs: plan.durationUs,
        points: offered,
        wordsOf: wordsIn(clips),
        maxChars: maxHighlightChars(canvas ?? { width: 1080, height: 1920 }),
        landscape: isLandscape(canvas),
        pro,
        newId,
        signal,
      })

      // merged into the outline as it is now: what the user did while Claude thought stays
      let dropped = picked.dropped
      const next = await amend(folder, (latest) => {
        // with no point on the rough cut Claude was not asked (pickHighlights answers nothing without a
        // call): an empty answer must not wipe the text Claude picked before, its looks, or its style
        if (offered.length === 0) return latest
        const points = new Set((latest.emphasis?.points ?? []).map((point) => point.id))
        const asked = new Set(offered.map((point) => point.pointId))
        // Claude's text on a point it was not asked about, which is still there, waits for its point to play
        // again. Only text on the transcript stored now can: this pick stores the transcripts' fingerprints as
        // they are, so text on an earlier one could never show again (its point is on that transcript too)
        const waits = (group: HighlightGroup) => group.pointId !== undefined && !asked.has(group.pointId) && points.has(group.pointId)
        const current = currentGroups(latest, clips)
        const mine = current.filter((group) => group.source === "user" || group.edited)
        const kept = current.filter((group) => mine.includes(group) || waits(group))
        // a point deleted while Claude thought takes the text made for it away; the new text keeps off the
        // words of the user's text, but not off text that waits, which is hidden while its point does not play
        const fresh = withoutOverlaps(
          picked.groups.filter((group) => group.pointId === undefined || points.has(group.pointId)),
          mine,
        )
        dropped = picked.dropped + fresh.droppedLines
        const highlights: StoredHighlights = {
          style: latest.highlights?.style ?? null,
          styleByAi: picked.style,
          groups: [...kept, ...fresh.groups],
          beatsKey: beatsKey(latest.outline.beats),
          transcripts: Object.fromEntries(clips.map((clip) => [clip.id, transcriptFingerprint(clip.transcript)])),
        }
        // the sounds, cutaways and graphics on the text Claude replaced move to the new lines saying the same
        // words; one the user edited that no such line takes moves to the start of its beat instead of going
        // (offGoneLines, spec §5.1, the user's decision of 2026-09-28); Claude's own that no line takes go.
        // offGoneLines is handed every item once the lines have taken theirs, and leaves alone what sits on a
        // group that stays or on no line at all. Claude's text that waits takes nothing: it is hidden while its
        // point does not play, so what moves onto it would go quiet with it; the user's own text takes as before
        const sameWords = (videoId: string) => latest.highlights?.transcripts[videoId] === highlights.transcripts[videoId]
        const before = latest.highlights?.groups ?? []
        const staying = new Set(highlights.groups.map((group) => group.id))
        const canTake = (group: HighlightGroup) => !(waits(group) && !mine.includes(group))
        const moved = regroupFlair({ ...latest, highlights }, before, sameWords, canTake, (items) => offGoneLines(items, latest, before, staying))
        // Claude's looks go on its new groups; a look the user set by hand that moved onto one of them stays theirs
        // (one with no new group on the same words goes with its group: a look has no beat-start form)
        const looks = { ...(moved.flair?.looks ?? {}) }
        for (const group of fresh.groups) {
          const look = picked.looks[group.id]
          if (look && !looks[group.id]?.edited) looks[group.id] = look
        }
        return { ...moved, flair: { ...(moved.flair ?? {}), looks } }
      })
      const pictures = await spare(next, options.flair, folder)
      return { preview: await view(next, plan, clips, canvas, fps, options, pro, await library(options.flair), pictures, await describedBy(pictures), folder), dropped }
    },

    async setStyle(folder: string, style: HighlightStyleId): Promise<void> {
      if (!HIGHLIGHT_STYLE_IDS.includes(style)) throw new Error(`unknown style ${String(style)}`)
      await change(folder, (highlights) => ({ ...highlights, style }))
    },

    /**
     * Sets a line's text, or removes the line when `text` is null; a group left with no line goes.
     * A line taken out takes its sound, cutaway and coloured word with it.
     */
    async editLine(folder: string, groupId: string, lineIndex: number, text: string | null): Promise<void> {
      const trimmed = text?.trim() ?? null
      if (trimmed !== null && !trimmed) throw new Error("the highlight text is empty")
      if (trimmed !== null && trimmed.length > MAX_TEXT_LENGTH) throw new Error("the highlight text is too long")
      await outline(folder)
      await amend(folder, (stored) => {
        const highlights = stored.highlights ?? EMPTY
        const group = findGroup(highlights, groupId)
        if (!Number.isInteger(lineIndex) || !group.lines[lineIndex]) throw new Error(`unknown highlight line ${lineIndex} of ${groupId}`)
        const lines = trimmed === null ? group.lines.filter((_, i) => i !== lineIndex) : group.lines.map((line, i) => (i === lineIndex ? { ...line, text: trimmed } : line))
        const groups = highlights.groups.flatMap((other) => (other !== group ? [other] : lines.length > 0 ? [{ ...group, edited: true, lines }] : []))
        const next = { ...stored, highlights: { ...highlights, groups } }
        if (trimmed !== null) return withLineText(next, groupId, lineIndex, group.lines[lineIndex]!.text)
        // what sat on the line goes with it; a group left with no line takes its look too
        return regroupFlair(withoutLine(next, groupId, lineIndex), highlights.groups, () => false)
      })
    },

    /** Takes a group out, with the sounds and cutaways on its lines. */
    async removeGroup(folder: string, groupId: string): Promise<void> {
      await outline(folder)
      await amend(folder, (stored) => {
        const highlights = stored.highlights ?? EMPTY
        const group = findGroup(highlights, groupId)
        const next = { ...stored, highlights: { ...highlights, groups: highlights.groups.filter((other) => other !== group) } }
        return regroupFlair(next, highlights.groups, () => false)
      })
    },

    /**
     * Highlight text of the user's from words they picked, in lines of at most `maxChars`. `pointId` binds it to a point (the emphasis tab's
     * "Aa"), which must be stored: bound, it follows the point's level, hidden with the point as a graphic made
     * for it is.
     */
    async addFromWords(folder: string, videoId: string, indexes: number[], maxChars: number, beatId?: string, pointId?: string): Promise<void> {
      if (!LINE_LENGTHS.includes(maxChars)) throw new Error(`unknown line length ${maxChars}`)
      const stored = await outline(folder)
      if (!stored.videoIds.includes(videoId)) throw new Error(`video ${videoId} is not in this outline`)
      const [clip] = await loadFootage(deps.footage, folder, [videoId])
      const made = groupsFromWords({ videoId, words: clip!.transcript?.words ?? [], indexes, maxChars, newId, beatId })
      const added = pointId === undefined ? made : made.map((group) => ({ ...group, pointId }))
      if (added.length === 0) throw new Error("no words to show as highlight text")

      const fingerprint = transcriptFingerprint(clip!.transcript)
      await amend(folder, (latest) => {
        if (pointId !== undefined && !(latest.emphasis?.points ?? []).some((point) => point.id === pointId)) throw new Error(`there is no point ${pointId}`)
        const highlights = latest.highlights ?? EMPTY
        // groups made on an earlier transcript of this video can never show again; a label on a picture beat says no words, so it stays
        const stale = highlights.transcripts[videoId] !== fingerprint
        const groups = highlights.groups.filter((group) => !(stale && group.scene === undefined && group.lines.some((line) => line.videoId === videoId)))
        const next = { ...latest, highlights: { ...highlights, groups: [...groups, ...added], transcripts: { ...highlights.transcripts, [videoId]: fingerprint } } }
        // what was on those groups' lines goes with them: their word numbers mean nothing now
        return regroupFlair(next, highlights.groups, () => false)
      })
    },
  }
}

export type HighlightService = ReturnType<typeof createHighlightService>
