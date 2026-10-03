import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import {
  assertCapCutClosed,
  backupDraft,
  binVideos,
  buildRoughCut,
  liveTimelines,
  loadDraft,
  outputCanvas,
  restoreDraft,
  writeDraft,
  type BinItem,
  type Draft,
  type DraftInfo,
  type IsCapCutRunning,
  type RootMetaEntry,
  type TimelineCaption,
} from "@boxblack/core/capcut"
import { writeFileAtomic } from "@boxblack/core/atomic-write"
import type { MediaCache } from "@boxblack/core/cache"
import {
  applyCutDecision,
  compileCuts,
  emptyCutDecisions,
  type CutClip,
  type CutDecisionChange,
  type CutDecisions,
  type CutPlan,
  type CutPreset,
  type CutPresetId,
  type CutRules,
} from "@boxblack/core/cut"
import { exitById } from "@boxblack/core/flair/catalogue"
import { DEFAULT_LOOK } from "@boxblack/core/flair/plan"
import { layoutGroup, timeHighlights, type PlacedGroup } from "@boxblack/core/highlights"
import { styleFor } from "@boxblack/core/highlights/styles"
import type { LlmTransport } from "@boxblack/core/llm"
import { LOUDNESS_STEP_US, type Loudness } from "@boxblack/core/media"
import { buildCaptions, captionLimits, polishSubtitles, SUBTITLE_POLISH_PROMPT, type Caption, type SubtitleLength } from "@boxblack/core/subtitles"
import type { AppEvent, BackupInfo, HighlightRequest, HighlightViewOptions, StoredOutline, SubtitleLine, SubtitleRequest, WriteResult } from "../shared/api.ts"
import { END_HOLD_US, endsOnPoint } from "./end-hold.ts"
import { loadFootage, transcriptFingerprint, type FootageDeps } from "./footage.ts"
import type { HighlightAssets } from "./highlight-assets.ts"
import { isReplaced, replacedPoints, zoomedFaces } from "./graphics-cues.ts"
import { heldExits, hiddenWords, looksInForce, placedPoints, placementOf, placeStored, SHOW_ALL, showRulesOf, showRulesOver, styleInForce, timelineOf, type ShowRules } from "./highlight-state.ts"
import { cuesInForce, samePlace, slotsFor } from "./sound-cues.ts"
import { itemPlaceOf, keepClearAt, placeOf, type SpareMedia } from "./insert-media.ts"
import { spokenSentences, wordsIn } from "./spoken.ts"
import type { TimelineInsert } from "@boxblack/core/capcut/inserts"
import { faceYOf, pieceKey, punchAtUs, zoomSlotsFor, zoomsInForce } from "./zoom-cues.ts"
import type { TimelineZoom } from "@boxblack/core/capcut/zoom"
import { zoomsBesideMoves, type TimelineMove } from "@boxblack/core/capcut/moves"
import type { PlacedInsert } from "@boxblack/core/flair/plan"
import { movesOnCut, type PlacedMove } from "./move-cues.ts"
import type { SoundLibrary } from "./sound-library.ts"
import type { TimelineSoundCue } from "@boxblack/core/capcut/sounds"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import { soundNeedsPro } from "@boxblack/core/flair/sound-catalogue"
import type { PlacedPoint, PointFilter } from "@boxblack/core/emphasis"
import type { TimelineGraphic } from "@boxblack/core/capcut/graphics"
import { binIdOf, graphicBinItem, soundBinItem } from "@boxblack/core/capcut/bin"
import type { TimelineComposedSound } from "@boxblack/core/capcut/composed-sounds"
import { soundJobOf, type PlacedComposed } from "./composed-cues.ts"
import type { SoundRenderer } from "./sound-render.ts"
import type { PlacedGraphic } from "@boxblack/core/graphics/plan"
import type { GraphicsRenderer, RenderJob } from "./graphics-render.ts"
import type { OutlineStore } from "./planner.ts"
import type { TimelineStore } from "./timeline-store.ts"
import { pipelinePieces, TIMELINE_VERSION, writeTimeline, type AgentTimeline } from "@boxblack/core/timeline"

export interface TimelineDeps extends FootageDeps {
  /** Rejects folders CapCut has not registered. Unlike inspect, it does not need the draft to be readable, so a broken draft can still be restored. */
  registered(folder: string): Promise<void>
  outlines: OutlineStore
  loudness: MediaCache<Loudness, { stepUs: number }>
  /** null when ffmpeg is missing; cuts then follow the word times alone */
  measureLoudness: ((path: string) => Promise<Loudness>) | null
  backupRoot: string
  /** preset values from the license server; the built-in ones when absent */
  presets?: () => Promise<Record<CutPresetId, CutPreset>>
  isCapCutRunning: IsCapCutRunning
  now?: () => Date
  /** the Claude connection chosen in settings, for polishing subtitles */
  llm?: () => Promise<{ transport: LlmTransport; model: string }>
  /** where polished subtitles are kept, so the same lines are not sent twice */
  polishDir: string
  /** fonts and animations for highlight text; a write with highlight text fails without them */
  highlightAssets?: HighlightAssets
  /** the sounds this machine's CapCut has, for the sound effect cues */
  sounds?: Pick<SoundLibrary, "list">
  /** the project's own spare photos and clips, for the cutaways */
  media?: SpareMedia
  /** the graphics renderer, which the write waits for */
  graphics?: Pick<GraphicsRenderer, "wait" | "rendered" | "hashOf" | "environmentProblem">
  /** whether the renderer pack is installed */
  graphicsReady?: () => Promise<boolean>
  /**
   * the graphics in force, each with its render job or null when it has none (a motion graphic not written yet, or
   * stale): the highlight service's, handed in because that service already depends on this one. The points whose
   * highlight text they take the place of are read from them, for the write and for the subtitle lines
   */
  graphicJobs?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: PlacedGraphic[]; jobs: (RenderJob | null)[] }>
  /** where the renderer keeps the rendered graphics (~/Movies/CapCut/BOXBLACK/graphics); the bin entries for the ones a write no longer plays are taken out */
  graphicsDir?: string
  /** the composed sounds' renderer, which the write waits for as it does for the graphics */
  soundRenderer?: Pick<SoundRenderer, "ensure" | "statusOf" | "fileOf" | "forgetMachine" | "environmentProblem">
  /**
   * the composed sounds in force, placed as the preview places them, each tied one with the graphic it scores: the
   * highlight service's (`composedSounds`), handed in as `graphicJobs` is
   */
  composedSounds?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: PlacedComposed[]; off: PlacedComposed[]; unplaced: number }>
  /** where the sound renderer keeps the composed sounds (~/Movies/CapCut/BOXBLACK/sounds); the bin entries for the ones a write no longer plays are taken out */
  soundsDir?: string
  /** tells the app when a write starts and how it ended */
  send?: (event: AppEvent) => void
  /** where the timeline of each write is kept; without it nothing is kept */
  timelines?: Pick<TimelineStore, "put">
}

/** The parts of backupDraft's manifest.json this service reads. */
interface Manifest {
  folder: string
  createdAt: string
  rootEntry: RootMetaEntry | null
}

const segmentCount = (info: DraftInfo) => info.tracks.reduce((sum, track) => sum + track.segments.length, 0)

/** The kinds of item a writer lays on the rough cut, as the write result counts them: the composed sounds apart from CapCut's. */
type LaidKind = keyof WriteResult["dropped"] | "composed"

/**
 * The write result's counts of what the writers laid, each read from that writer's own answer: how
 * many items it placed and how many it left out. A kind no writer ran for (nothing was sent to it)
 * placed and left out nothing. The composed sounds are counted apart from CapCut's sounds, but one
 * their writer left out is a sound left out like any other.
 */
export function tally(laid: Partial<Record<LaidKind, { kept: number; dropped: number }>>): Pick<WriteResult, "soundCount" | "composedCount" | "zoomCount" | "insertCount" | "graphicCount" | "dropped"> {
  const of = (kind: LaidKind) => laid[kind] ?? { kept: 0, dropped: 0 }
  return {
    soundCount: of("sounds").kept,
    composedCount: of("composed").kept,
    zoomCount: of("zooms").kept,
    insertCount: of("inserts").kept,
    graphicCount: of("graphics").kept,
    dropped: {
      sounds: of("sounds").dropped + of("composed").dropped,
      zooms: of("zooms").dropped,
      inserts: of("inserts").dropped,
      graphics: of("graphics").dropped,
      moves: of("moves").dropped,
    },
  }
}

/** The bytes of one second of a composed sound's file: 16-bit stereo at 48 kHz, as the sound renderer writes them. */
const WAV_BYTES_PER_SECOND = 4 * 48_000

/**
 * A composed sound's own length, in whole microseconds, read from its file: the size of its data chunk, found past
 * whatever chunks ffmpeg put before it, and never more than the file holds. It throws on a file that is not a WAV.
 */
export async function wavLengthUs(path: string): Promise<number> {
  const bytes = await readFile(path)
  if (bytes.length < 12 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WAVE") throw new Error(`${basename(path)} is not a WAV file`)
  let at = 12
  while (at + 8 <= bytes.length) {
    const size = bytes.readUInt32LE(at + 4)
    if (bytes.toString("latin1", at, at + 4) === "data") return Math.floor((Math.min(size, bytes.length - at - 8) * 1_000_000) / WAV_BYTES_PER_SECOND)
    // a chunk of an odd size is padded to an even one
    at += 8 + size + (size % 2)
  }
  throw new Error(`${basename(path)} has no sound in it`)
}


/** CapCut's bin ids are lower-case UUIDs, unlike its upper-case segment and material ids (read from 0917 on 2026-09-24). */
const newBinId = () => randomUUID()

/**
 * The most subtitle texts one outline keeps: a limit keeps a bad renderer from growing the file without end.
 * The oldest go to make room, since a line's key changes with the cut and the line length and old keys pile up.
 */
const MAX_SUBTITLE_TEXTS = 5_000

/**
 * The subtitle texts with `set` stored (each the newest, in order) and `forget` taken out, those set longest ago
 * forgotten past MAX_SUBTITLE_TEXTS. The map keeps the order texts were set in (a key always holds ":", so JSON
 * never reorders it), newest last; it is rebuilt as own entries, so no key can reach the object's prototype.
 */
function withTexts(texts: Record<string, string> | undefined, set: [string, string][], forget: string[] = []): Record<string, string> {
  const changed = new Set([...set.map(([key]) => key), ...forget])
  const all = [...Object.entries(texts ?? {}).filter(([key]) => !changed.has(key)), ...set]
  return Object.fromEntries(all.slice(Math.max(0, all.length - MAX_SUBTITLE_TEXTS)))
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

/** One frame of the draft, in µs: anything on screen for less than this cannot be written. */
const frameUs = (draft: Draft) => 1_000_000 / draft.info.fps

/**
 * Where a moment of the rough cut, timed before rounding, plays once each piece sits on its
 * frames: the same place in the same piece, on the clock of the pieces as written.
 */
function onFrames(plan: CutPlan, at: (cut: number, sourceUs: number) => number): (rawUs: number) => number {
  return (rawUs) => {
    let start = 0
    for (const [index, cut] of plan.cuts.entries()) {
      const end = start + cut.sourceDurationUs
      if (rawUs < end || index === plan.cuts.length - 1) return at(index, cut.sourceStartUs + rawUs - start)
      start = end
    }
    return rawUs
  }
}

export function createTimelineService(deps: TimelineDeps) {
  const now = deps.now ?? (() => new Date())

  async function confirmedOutline(folder: string): Promise<StoredOutline> {
    const stored = await deps.outlines.get(folder)
    if (!stored) throw new Error("this project has no outline yet")
    if (!stored.confirmed) throw new Error("the outline has not been confirmed")
    return stored
  }

  /** Loudness of a spoken clip, measured the first time a cut needs it. */
  async function loudnessOf(path: string): Promise<Loudness | null> {
    // kept for the file as it is now, even if it is replaced while it is measured
    const entry = await deps.loudness.entry(path, { stepUs: LOUDNESS_STEP_US }).catch(() => null)
    const cached = (await entry?.get()) ?? null
    if (cached || !deps.measureLoudness) return cached
    try {
      const measured = await deps.measureLoudness(path)
      await entry?.put(measured)
      return measured
    } catch {
      // loudness only refines the edges; the word times alone still make a usable cut
      return null
    }
  }

  async function compile(folder: string, rules: CutRules): Promise<{ stored: StoredOutline; plan: CutPlan; clips: CutClip[] }> {
    const stored = await confirmedOutline(folder)
    const footage = await loadFootage(deps, folder, stored.videoIds)
    const clips: CutClip[] = []
    // one at a time: each measurement decodes a whole audio track
    for (const clip of footage) {
      const spoken = clip.transcript !== null && clip.transcript.words.length > 0
      clips.push({ ...clip, loudness: spoken ? await loudnessOf(clip.path) : null })
    }
    const decisions: CutDecisions = {}
    for (const clip of clips) {
      const made = stored.cutDecisions?.[clip.id]
      if (made && made.transcript === transcriptFingerprint(clip.transcript)) decisions[clip.id] = made
    }
    const asked = { beats: stored.outline.beats, clips, rules, presets: await deps.presets?.(), decisions }
    const plan = compileCuts(asked)
    // the last words carry a point: the cut keeps footage after them so what sits on it can show before the clip ends
    return { stored, plan: endsOnPoint(stored, plan, clips) ? compileCuts({ ...asked, endHoldUs: END_HOLD_US }) : plan, clips }
  }

  /** The frame size the rough cut plays at, which follows its first video; null when nothing is kept. */
  function canvasOf(plan: CutPlan, draft: Draft): { width: number; height: number } | null {
    const first = binVideos(draft.meta).find((video) => video.id === plan.cuts[0]?.binId)
    return first ? outputCanvas(draft.info, first) : null
  }

  /**
   * Captions for the kept words, as wide as the video the rough cut plays at, leaving out the
   * `hidden` word numbers of each piece. The same for the preview and the write.
   */
  function captionsFor(plan: CutPlan, clips: CutClip[], draft: Draft, length: SubtitleLength, hidden: Map<number, Set<number>>): Caption[] {
    const canvas = canvasOf(plan, draft)
    if (!canvas) return []
    const words = new Map(clips.map((clip) => [clip.id, clip.transcript?.words ?? []]))
    return buildCaptions({
      cuts: plan.cuts,
      wordsOf: (id, cut) => (words.get(id) ?? []).filter((_, index) => !hidden.get(cut)?.has(index)),
      ...captionLimits(length, canvas),
      minUs: frameUs(draft),
    })
  }

  /**
   * The words shown as highlight text under these show rules, piece by piece. Judged on the rough cut
   * before rounding, for the preview and the write alike, so both find the same subtitle lines. A group
   * of one of the `replaced` points, whose graphic plays in its text's place, is timed with the rest and
   * hides no word: its words are not on screen as text, so the subtitles say them.
   */
  function hiddenFor(stored: StoredOutline, plan: CutPlan, clips: CutClip[], draft: Draft, show: ShowRules, replaced: ReadonlySet<string>): Map<number, Set<number>> {
    const placed = placeStored(stored, plan, clips, show)
    const timed = timeHighlights(placed, timelineOf(plan), plan.durationUs)
    return hiddenWords(placed.filter((group) => !isReplaced(group, replaced)), timed, frameUs(draft))
  }

  /**
   * The points whose highlight text a graphic takes the place of under these options, read from the graphics in
   * force as the write has them (`replacedPoints`). With graphics off none plays, and nothing is worked out.
   */
  async function replacedUnder(folder: string, rules: CutRules, options: HighlightViewOptions): Promise<ReadonlySet<string>> {
    if (!options.flair.graphic || !deps.graphicJobs) return new Set()
    return replacedPoints(await deps.graphicJobs(folder, rules, options))
  }

  async function describe(id: string): Promise<{ folder: string; backup: BackupInfo }> {
    const dir = join(deps.backupRoot, id)
    const [manifest, info] = await Promise.all([readJson<Manifest>(join(dir, "manifest.json")), readJson<DraftInfo>(join(dir, "draft", "draft_info.json"))])
    return {
      folder: manifest.folder,
      backup: { id, createdAt: manifest.createdAt, durationUs: manifest.rootEntry?.tm_duration ?? info.duration, segmentCount: segmentCount(info) },
    }
  }

  async function backups(folder: string): Promise<BackupInfo[]> {
    await deps.registered(folder)
    if (!existsSync(deps.backupRoot)) return []
    const entries = await readdir(deps.backupRoot, { withFileTypes: true })
    const found = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => describe(entry.name).catch(() => null)),
    )
    return found
      .flatMap((entry) => (entry?.folder === folder ? [entry.backup] : []))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * The cutaways the preview would have shown, ready for the overlay writer: `kept` are the cutaways in force as the
   * moves were placed on them (`movesOnCut`), chosen as the preview chose them on the rough cut before rounding, and
   * each carries the poses of the move kept on it, if any (`moves`).
   */
  function insertCutaways(kept: PlacedInsert[], moves: PlacedMove[], plan: CutPlan, clips: CutClip[], onFrames: (rawUs: number) => number): TimelineInsert[] {
    return kept.map((insert, index) => {
      const move = moves.find((entry) => entry.insertIndex === index)
      return {
        // then played where that moment lands once the pieces are on their frames
        atUs: onFrames(insert.atUs),
        durationUs: insert.durationUs,
        fit: insert.cue.fit ?? "cover",
        subject: insert.cue.subject ?? null,
        keepClear: keepClearAt(plan, clips, insert.atUs),
        binId: insert.media.binId,
        path: insert.media.path,
        name: insert.media.name,
        kind: insert.media.kind,
        width: insert.media.width,
        height: insert.media.height,
        durationOfFileUs: insert.media.durationUs,
        ...(move ? { poses: move.poses } : {}),
      }
    })
  }

  /** The zooms the preview would have shown, ready for the keyframe writer, and how many stored zooms lost their piece. */
  function zoomsFor(stored: StoredOutline, plan: CutPlan, placed: PlacedGroup[], clips: CutClip[], flair: FlairOptions, passes: PointFilter): { zooms: TimelineZoom[]; lost: number } {
    if (!flair.zoom) return { zooms: [], lost: 0 }
    const at = timelineOf(plan)
    const timed = timeHighlights(placed, at, plan.durationUs)
    const slots = zoomSlotsFor({ plan, groups: timed, beatNames: new Map(stored.outline.beats.map((beat) => [beat.id, beat.name])), at })
    const { kept, lost } = zoomsInForce({ zooms: stored.flair?.zooms ?? [], slots, flair, durationUs: plan.durationUs, passes })
    const byAnchor = new Map(slots.map((slot) => [pieceKey(slot.anchor), slot]))
    const zooms = kept.map((zoom) => {
      const slot = byAnchor.get(pieceKey(zoom.cue.anchor))!
      return {
        cut: slot.cut,
        kind: zoom.cue.kind,
        atUs: punchAtUs(slot, timed),
        durationUs: zoom.durationUs,
        faceY: faceYOf(clips, zoom.cue.anchor, zoom.durationUs),
      }
    })
    return { zooms, lost }
  }

  /**
   * The sound effects the preview would have shown, ready for the writer, and how many stored ones are left out
   * because they need CapCut Pro, which the user does not have (`pro`); `points` are the points placed on this rough cut.
   */
  async function soundCues(
    stored: StoredOutline,
    plan: CutPlan,
    placed: PlacedGroup[],
    clips: CutClip[],
    flair: FlairOptions,
    passes: PointFilter,
    points: PlacedPoint[],
    onFrames: (rawUs: number) => number,
    pro: boolean,
  ): Promise<{ cues: TimelineSoundCue[]; pro: number }> {
    if (!flair.sound || !deps.sounds) return { cues: [], pro: 0 }
    // chosen exactly as the preview chose them — the spacing rules run on the same clock — then
    // played where each moment lands once the pieces are on their frames
    const at = timelineOf(plan)
    const timed = timeHighlights(placed, at, plan.durationUs)
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const slots = slotsFor({ plan, groups: timed, beatNames, at })
    // a sound on a point's start or a graphic's is a moment of speech, which only placeOf finds; one whose moment
    // the cut took out plays where its point starts now, as the preview shows it
    const place = itemPlaceOf(placeOf({ slots, sentences: spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at }), plan, at }), points)
    // a sound that needs Pro is not written, as the preview does not play it; it stays stored
    const { kept, pro: heldForPro } = cuesInForce({
      cues: stored.flair?.cues ?? [],
      place,
      sounds: await deps.sounds.list(),
      flair,
      durationUs: plan.durationUs,
      passes,
      needsPro: pro ? undefined : soundNeedsPro,
    })
    const cues = kept.map((cue) => ({
      atUs: onFrames(cue.atUs),
      effectId: cue.sound.effectId,
      name: cue.sound.name,
      path: cue.sound.path,
      durationUs: cue.sound.durationUs,
    }))
    return { cues, pro: heldForPro }
  }

  /** The drafts a write or a restore is changing right now, and which of the two. */
  const running = new Map<string, "write" | "restore">()
  /** every write that started, refused ones aside: one that came and went unseen still moved this on */
  let writesStarted = 0

  /**
   * Runs one write or restore of a draft, and refuses another on the same draft meanwhile. A write
   * waits minutes for its graphics before it touches the draft: a second write in that time would
   * swap its files in turn by turn with the first, leaving copies CapCut finds disagreeing, and a
   * restore would be written over as soon as the graphics were made.
   */
  async function alone<T>(folder: string, kind: "write" | "restore", work: () => Promise<T>): Promise<T> {
    const busy = running.get(folder)
    if (busy === "write") throw new Error("a write to this project is already running; wait for it to finish")
    if (busy === "restore") throw new Error("a backup of this project is being put back; wait for it to finish")
    running.set(folder, kind)
    try {
      return await work()
    } finally {
      running.delete(folder)
    }
  }

  /** The write itself; `write` below lets only one run on a draft at a time. */
  /**
   * Every piece a write of this request lays, at its times, as a timeline: what `writeNow` writes, and what the agent
   * editor starts from. `write` makes it the write's own: CapCut must be closed, the graphics and composed sounds are
   * waited for (rendered first when need be), and the draft must still have `expectedSegments`. Without it, a dry run:
   * nothing is waited for or checked against CapCut, and a graphic or sound not made yet is left out, as a write
   * leaves out one whose render failed.
   */
  async function assemble(folder: string, rules: CutRules, subtitles: SubtitleRequest | null, highlights: HighlightRequest | null, write: { expectedSegments: number } | null) {
    const { stored, plan: cutPlan, clips } = await compile(folder, rules)
    if (cutPlan.cuts.length === 0) throw new Error("the rough cut is empty: every beat was cut away")

    // the graphics are waited for before the draft is read: rendering can take minutes, time enough
    // for CapCut to open, change and close the project, and the write must start from what it left
    const waitedFor: { graphic: PlacedGraphic; job: RenderJob }[] = []
    // the graphics in force that have nothing to render: left out of the draft, and counted
    let unmade = 0
    // the points whose highlight text a graphic takes the place of: those of the graphics in force that have a job,
    // as the preview marks them. It goes by the job, not by the render that follows, or the write and the preview
    // would disagree about the text: a render that fails below leaves its point with neither text nor graphic in
    // this write, which counts the graphic as skipped
    let replaced: ReadonlySet<string> = new Set()
    // what the request shows, as the preview it was made from showed it
    const view: HighlightViewOptions | null = highlights && { position: highlights.position, subtitlesOn: subtitles !== null, highlightsOn: highlights.highlightsOn, flair: highlights.flair }
    if (view?.flair.graphic && deps.graphicJobs) {
      const inForce = await deps.graphicJobs(folder, rules, view)
      replaced = replacedPoints(inForce)
      // a motion graphic not written yet, or stale, has no job: the write does not wait for it, and it stops nothing
      const withJobs = inForce.kept.flatMap((graphic, i) => {
        const job = inForce.jobs[i]
        return job ? [{ graphic, job }] : []
      })
      unmade = inForce.kept.length - withJobs.length
      const jobs = withJobs.map(({ job }) => job)
      if (write && jobs.length > 0) {
        const notInstalled = "the graphics renderer is not installed: install it in settings, or turn graphics off"
        const renderer = deps.graphics
        if (!renderer) throw new Error(notInstalled)
        // a render found the machine unfit (the pack damaged, the app's ffmpeg or a font missing): the pack may well be installed
        const unfit = () => {
          const problem = renderer.environmentProblem()
          return problem === null ? null : new Error(`graphics cannot be made on this machine: ${problem.text}; the draft was not changed`)
        }
        // the pack is only needed for what is not made yet
        if (!(await deps.graphicsReady?.())) {
          for (const job of jobs) if (!(await renderer.rendered(job))) throw unfit() ?? new Error(notInstalled)
        }
        const { ready, failed } = await renderer.wait(jobs, folder)
        // a job neither made nor failed was stopped (the app is quitting, or the renderer pack is being replaced), or
        // the machine was found unfit while it waited: that is not a graphic to leave out
        const settled = new Set([...ready, ...failed])
        const unsettled = jobs.filter((job) => !settled.has(renderer.hashOf(job)))
        if (unsettled.length > 0) throw unfit() ?? new Error("the graphics were stopped before they were made; the draft was not changed")
      }
      waitedFor.push(...withJobs)
    }

    // the composed sounds are waited for in the same way, for the same reason. Only the written and fresh ones are
    // made, and one tied to a graphic only while that graphic has a job: it is never laid without it
    const soundsWaitedFor: PlacedComposed[] = []
    const composedLeftOut = { unwritten: 0, stale: 0, failed: 0 }
    if (view?.flair.sound && deps.composedSounds) {
      const inForce = await deps.composedSounds(folder, rules, view)
      for (const placed of inForce.kept) {
        const { sound, graphic } = placed
        if (sound.code === null) {
          if (sound.failed !== undefined) composedLeftOut.failed++
          else composedLeftOut.unwritten++
        } else if (placed.stale !== null || (graphic && !waitedFor.some((waited) => samePlace(waited.graphic.cue.anchor, graphic.cue.anchor)))) {
          composedLeftOut.stale++
        } else soundsWaitedFor.push(placed)
      }
      const jobs = soundsWaitedFor.map(soundJobOf)
      if (write && jobs.length > 0) {
        const renderer = deps.soundRenderer
        if (!renderer) throw new Error("the sounds cannot be made: there is no sound renderer; the draft was not changed")
        // a machine an earlier render found unfit may be fit by now (the page restarted, ffmpeg found again): it is tried again
        renderer.forgetMachine()
        await renderer.ensure(jobs)
        // a sound neither made nor failed was stopped (the app is quitting), or the machine was found unfit while it
        // waited: that is not a sound to leave out
        const states = await Promise.all(jobs.map((job) => renderer.statusOf(job)))
        if (states.includes("pending")) {
          const problem = renderer.environmentProblem()
          throw new Error(
            problem === null
              ? "the sounds were stopped before they were made; the draft was not changed"
              : `the sounds cannot be made on this machine: ${problem}, or turn sounds off; the draft was not changed`,
          )
        }
      }
    }
    // CapCut may have been opened while the graphics and sounds rendered: a write it would refuse must not take a backup first
    if (write) await assertCapCutClosed(deps.isCapCutRunning)

    const draft = await loadDraft(folder)
    const current = segmentCount(draft.info)
    if (write && current !== write.expectedSegments) {
      throw new Error(`the timeline changed after it was checked (it now has ${current} segments, not ${write.expectedSegments}); check it again before writing`)
    }
    const time = now()
    // the rough cut alone, for where its pieces play once on frames; the whole timeline is written from it below
    const rough = buildRoughCut(draft.info, cutPlan.cuts, binVideos(draft.meta))
    // the segment each cut became; its frame-rounded times are where the words really play
    const video = rough.tracks[0]!.segments
    const at = (cut: number, sourceUs: number) => video[cut]!.target_timerange.start - video[cut]!.source_timerange!.start + sourceUs
    const played = onFrames(cutPlan, at)
    // the emphasis points placed on this rough cut (without a highlight request nothing below reads them)
    const points = highlights ? placedPoints(stored, cutPlan, clips) : []
    // what the request shows: the text only while it is on, and each item only when the level lets its point through
    const show = highlights ? showRulesOver(points, highlights) : SHOW_ALL
    // the points the level lets through, whether or not a work put anything on them: counted by the very
    // filter the items pass, so the count and what is written cannot disagree
    const emphasisCount = points.filter((where) => show.passes(where.point.id)).length
    const placed = highlights ? placeStored(stored, cutPlan, clips, show) : []
    const canvas = canvasOf(cutPlan, draft)
    // the moves of the picture and the cutaways they may move, placed as the preview places them (movesOnCut), on the
    // rough cut before rounding: the text keeps off the faces where they put them, as the preview showed it
    const beforeRounding = timelineOf(cutPlan)
    const timedBefore = timeHighlights(placed, beforeRounding, cutPlan.durationUs)
    const pictures = highlights?.flair.insert && deps.media ? await deps.media.list(folder, stored.videoIds) : []
    const moved = highlights
      ? movesOnCut({ stored, plan: cutPlan, clips, canvas, flair: highlights.flair, points, groups: timedBefore, pictures, passes: show.passes, at: beforeRounding })
      : { kept: [], off: [], dropped: 0, lost: 0, inserts: [] }

    let captions: TimelineCaption[] = []
    if (subtitles) {
      // with the text off no group is placed, so none hides a word; nor does a replaced group, which is not drawn
      const hidden = highlights?.hideSubtitles ? hiddenFor(stored, cutPlan, clips, draft, show, replaced) : new Map<number, Set<number>>()
      const shown = captionsFor(cutPlan, clips, draft, subtitles.length, hidden)
      if (shown.length !== subtitles.texts.length) {
        throw new Error(`the subtitles changed since they were shown (${shown.length} lines now, not ${subtitles.texts.length}); look at them again before writing`)
      }
      captions = shown.map((caption, i) => ({ startUs: at(caption.cut, caption.startUs), endUs: at(caption.cut, caption.endUs), text: subtitles.texts[i]! }))
    }

    // read once, so the text and the sounds are written under the same CapCut Pro setting
    const settings = await deps.settings.read()
    // the groups' exits left out for want of CapCut Pro, counted over the groups written
    let exitsHeld = 0
    let highlightText: AgentTimeline["highlights"] = null
    if (highlights) {
      // every group the rules show, the replaced ones among them, as the preview lists them: they are timed and
      // given their looks together, since a group ends where the next begins and a run of looks counts them all
      const groups = timeHighlights(placed, at, rough.duration)
      if (groups.length !== highlights.groupCount) {
        throw new Error(`the highlight text changed since it was shown (${groups.length} groups now, not ${highlights.groupCount}); look at it again before writing`)
      }
      // what is drawn as text: not the groups of a point whose graphic plays in their place
      const drawn = groups.filter((group) => !isReplaced(group, replaced))
      if (drawn.length > 0 && canvas) {
        if (!deps.highlightAssets) throw new Error("highlight text is not ready: its fonts are missing")
        // the custom style's colours are the user's own, kept in settings
        const style = styleFor(styleInForce(stored.highlights), settings.highlights.custom)
        const byId = new Map(placed.map((group) => [group.groupId, group]))
        // the faces where the moves put them while each group is on screen, as the preview times it before rounding
        const faceBand = zoomedFaces({ moves: moved.kept, plan: cutPlan, clips, canvas, at: beforeRounding }).bandIn
        const onScreen = new Map(timedBefore.map((group) => [group.groupId, { startUs: group.startUs, endUs: group.endUs }]))
        // an exit that needs CapCut Pro the user does not have is written as none; it stays stored
        const looks = looksInForce(
          stored,
          groups.map((group) => ({ id: group.groupId, lines: group.lines.map((line) => ({ lineIndex: line.lineIndex, text: line.text.trim() })) })),
          highlights.flair,
          canvas,
          settings.capcut.pro,
        )
        exitsHeld = Object.keys(heldExits(stored, drawn.map((group) => group.groupId), highlights.flair, settings.capcut.pro)).length
        const laidOut = drawn.map((group) => {
          const placement = placementOf(byId.get(group.groupId)!, clips, highlights.position, subtitles !== null, () => faceBand(onScreen.get(group.groupId)!))
          const look = looks[group.groupId] ?? DEFAULT_LOOK
          const { lines } = layoutGroup(group.lines.map((line) => line.text.trim()), style.font, canvas, placement, look.pattern)
          const exit = look.exit === null ? null : (exitById(look.exit) ?? null)
          return {
            endUs: group.endUs,
            exit: exit && { resourceId: exit.resourceId, name: exit.name },
            lines: group.lines.map((line, i) => ({
              startUs: line.startUs,
              text: line.text,
              ...lines[i]!,
              tone: look.tone,
              accent: look.accent?.line === i ? { from: look.accent.from, to: look.accent.to } : null,
            })),
          }
        })
        highlightText = {
          look: {
            fontPath: await deps.highlightAssets.fontPath(style.font),
            strokeWidth: style.strokeWidth,
            barRoundness: style.barRoundness,
            palette: style.palette,
            animation: { ...style.animation, path: await deps.highlightAssets.animationPath(style.animation.resourceId) },
          },
          groups: pipelinePieces("highlight", laidOut, (group) => group.lines.map((line) => line.text.trim()).join(" / ")),
        }
      }
    }

    // the picture moves before anything is laid on top of it: Claude's moves on their pieces, and the legacy zooms on
    // the pieces no move plays on, since a piece has one set of keyframes and the move wins. The moves the checks
    // turned down are counted with those the writer left out
    const moves: TimelineMove[] = moved.kept.flatMap((move) => (move.cut !== undefined ? [{ cut: move.cut, startUs: move.startUs, poses: move.poses }] : []))
    const zoomed = highlights ? zoomsFor(stored, cutPlan, placed, clips, highlights.flair, show.passes) : { zooms: [], lost: 0 }
    const beside = zoomsBesideMoves(zoomed.zooms, moves).zooms

    // the cutaways sit over the picture but under the text, each with the move kept on it
    // timed like the text, on the frames the picture really starts on
    const inserts = highlights && highlights.flair.insert && deps.media ? insertCutaways(moved.inserts, moved.kept, cutPlan, clips, played) : []
    // a move on a cutaway the overlay writer leaves out goes with it, counted as that cutaway, not as a move

    // the graphics sit over the cutaways but under the text, timed like the cutaways
    const graphics: TimelineGraphic[] = []
    const binItems: BinItem[] = []
    const idOfPath = new Map<string, string>()
    // those with nothing to render are left out before any is laid
    let graphicsSkipped = unmade
    // the graphics laid, which the sounds tied to them need
    const graphicsLaid: PlacedGraphic[] = []
    // what each laid graphic shows, in Claude's words, for the agent's list of pieces
    const graphicNotes: string[] = []
    for (const { graphic, job } of waitedFor) {
      const file = deps.graphics ? await deps.graphics.rendered(job) : null
      // its render failed, or it was made and its file is gone since
      if (!file) {
        graphicsSkipped++
        continue
      }
      // a file already in the bin (written before) keeps its entry, and two graphics made of the same file share one;
      // the item is always handed over — addBinItems skips an id that is there — in case the entry is gone by the
      // time the bin is written
      const binId = idOfPath.get(file.path) ?? binIdOf(draft.meta, file.path) ?? newBinId()
      idOfPath.set(file.path, binId)
      binItems.push(graphicBinItem({ id: binId, path: file.path, width: file.width, height: file.height, durationUs: file.durationUs, nowMs: time.getTime() }))
      graphicsLaid.push(graphic)
      graphicNotes.push("idea" in graphic.cue.spec && typeof graphic.cue.spec.idea === "string" ? graphic.cue.spec.idea : "")
      graphics.push({
        atUs: played(graphic.atUs),
        durationUs: graphic.durationUs,
        binId,
        path: file.path,
        name: basename(file.path),
        width: file.width,
        height: file.height,
        durationOfFileUs: file.durationUs,
        place: file.place,
      })
    }

    // the composed sounds go on above the graphics, each for its file's own length, timed like the graphics; one tied
    // to a graphic the write left out goes with it, as stale
    const composed: TimelineComposedSound[] = []
    for (const placed of soundsWaitedFor) {
      const { graphic } = placed
      if (graphic && !graphicsLaid.some((laid) => samePlace(laid.cue.anchor, graphic.cue.anchor))) {
        composedLeftOut.stale++
        continue
      }
      const job = soundJobOf(placed)
      const renderer = deps.soundRenderer
      if (!renderer) {
        composedLeftOut.failed++
        continue
      }
      // its render failed (or, in a dry run, is not made yet), or it was made and its file is gone since, cannot be read, or holds no sound
      const durationUs = (await renderer.statusOf(job)) === "ready" ? await wavLengthUs(renderer.fileOf(job)).catch(() => null) : null
      if (durationUs === null || durationUs <= 0) {
        composedLeftOut.failed++
        continue
      }
      const path = renderer.fileOf(job)
      // as for a graphic: a file in the bin keeps its entry, and two sounds made of the same file share one
      const binId = idOfPath.get(path) ?? binIdOf(draft.meta, path) ?? newBinId()
      idOfPath.set(path, binId)
      binItems.push(soundBinItem({ id: binId, path, durationUs, nowMs: time.getTime() }))
      composed.push({ atUs: played(placed.atUs), durationUs, path, binId })
    }

    // the sound effects go on last, so their track sits above the text
    const sounds = highlights ? await soundCues(stored, cutPlan, placed, clips, highlights.flair, show.passes, points, played, settings.capcut.pro) : { cues: [], pro: 0 }

    // the bin is brought in line on every write, graphics and sounds on or off, so graphics and composed sounds this
    // timeline no longer plays leave the user's media panel. Only files in BOXBLACK's own graphics and sounds folders
    // are ever taken out, each folder kept to what this timeline plays from it, and the write replaces the whole
    // timeline — unless the project holds other timelines, which share this bin and may still play older ones
    const timeline: AgentTimeline = {
      version: TIMELINE_VERSION,
      direction: stored.outline.direction ?? "",
      canvas,
      durationUs: rough.duration,
      cuts: pipelinePieces("cut", cutPlan.cuts),
      subtitles: subtitles !== null,
      captions: pipelinePieces("caption", captions, (caption) => caption.text),
      highlights: highlightText,
      moves: pipelinePieces("move", moves),
      zooms: pipelinePieces("zoom", beside),
      inserts: pipelinePieces("insert", inserts),
      graphics: pipelinePieces("graphic", graphics).map((piece, i) => ({ ...piece, note: graphicNotes[i] || piece.item.name })),
      composed: pipelinePieces("composed", composed),
      sounds: pipelinePieces("sound", sounds.cues),
      binItems,
    }
    return {
      timeline,
      draft,
      time,
      movesDropped: moved.dropped,
      // the moves with no place on the cut are counted with the zooms whose piece is gone, as the preview counts them
      zoomsLost: zoomed.lost + moved.lost,
      graphicsSkipped,
      composedLeftOut,
      emphasisCount,
      proLeftOut: { exits: exitsHeld, sounds: sounds.pro },
    }
  }

  async function writeNow(
    folder: string,
    rules: CutRules,
    expectedSegments: number,
    subtitles: SubtitleRequest | null,
    highlights: HighlightRequest | null,
  ): Promise<WriteResult> {
    await assertCapCutClosed(deps.isCapCutRunning)
    const { timeline, draft, time, movesDropped, ...counts } = await assemble(folder, rules, subtitles, highlights, { expectedSegments })
    // build first: a timeline the writers reject must not leave a backup behind for nothing
    const written = writeTimeline(draft.info, binVideos(draft.meta), timeline, {
      subtitleGroupId: `boxblack_${time.getTime()}`,
      prune: (await liveTimelines(draft)) <= 1 ? { graphicsDir: deps.graphicsDir, soundsDir: deps.soundsDir } : null,
    })
    const { info } = written
    // the moves the checks turned down are counted with those the writer left out
    const laid = { ...written.laid, moves: { kept: written.laid.moves?.kept ?? 0, dropped: (written.laid.moves?.dropped ?? 0) + movesDropped } }
    const dir = await backupDraft(draft, deps.backupRoot, time)
    await writeDraft(draft, info, { isCapCutRunning: deps.isCapCutRunning, bin: written.bin })
    // what was written, for the agent editor and for reading the draft back later; a failure here leaves the write as it is
    await deps.timelines?.put({ folder, writtenAt: time.getTime(), timeline }).catch(() => undefined)

    const { backup } = await describe(basename(dir))
    const textSegments = (flag: number) => info.tracks.filter((track) => track.type === "text" && track.flag === flag).reduce((sum, track) => sum + track.segments.length, 0)
    return {
      backup,
      durationUs: info.duration,
      segmentCount: segmentCount(info),
      captionCount: textSegments(1),
      highlightCount: textSegments(0),
      ...tally(laid),
      ...counts,
    }
  }

  /**
   * Writes a timeline made elsewhere (the agent editor's) with the same care as a write: CapCut closed, the draft
   * unchanged since it was checked, a backup first, and the timeline kept as the project's last write.
   */
  async function writeTimelineNow(folder: string, timeline: AgentTimeline, expectedSegments: number): Promise<{ backup: BackupInfo; durationUs: number; segmentCount: number }> {
    await assertCapCutClosed(deps.isCapCutRunning)
    const draft = await loadDraft(folder)
    const current = segmentCount(draft.info)
    if (current !== expectedSegments) {
      throw new Error(`the timeline changed after it was checked (it now has ${current} segments, not ${expectedSegments}); check it again before writing`)
    }
    const time = now()
    const written = writeTimeline(draft.info, binVideos(draft.meta), timeline, {
      subtitleGroupId: `boxblack_${time.getTime()}`,
      prune: (await liveTimelines(draft)) <= 1 ? { graphicsDir: deps.graphicsDir, soundsDir: deps.soundsDir } : null,
    })
    const dir = await backupDraft(draft, deps.backupRoot, time)
    await writeDraft(draft, written.info, { isCapCutRunning: deps.isCapCutRunning, bin: written.bin })
    await deps.timelines?.put({ folder, writtenAt: time.getTime(), timeline }).catch(() => undefined)
    const { backup } = await describe(basename(dir))
    return { backup, durationUs: written.info.duration, segmentCount: segmentCount(written.info) }
  }

  const service = {
    preview: async (folder: string, rules: CutRules): Promise<CutPlan> => (await compile(folder, rules)).plan,

    /** The confirmed outline cut under these rules, with its videos, frame size and frame rate, for the highlight text service. */
    async compiled(folder: string, rules: CutRules) {
      const { stored, plan, clips } = await compile(folder, rules)
      const draft = await loadDraft(folder)
      return { stored, plan, clips, canvas: canvasOf(plan, draft), fps: draft.info.fps }
    },

    /**
     * The subtitle lines a write would add, timed on the rough cut before its edges are rounded to frames.
     * `hideUnderHighlights` leaves out the words shown as highlight text at the level in the saved
     * settings, which the screen saves on every change of it and the write then carries. The text of a
     * point whose graphic plays is not shown, so its words stay: the graphics are those in force under the
     * saved settings too (the text's position and the flair), with the subtitles on, as a write that lays
     * these lines asks for them. Lines that hide nothing are worked out without the graphics, as they were.
     */
    async subtitles(folder: string, rules: CutRules, length: SubtitleLength, hideUnderHighlights = false): Promise<SubtitleLine[]> {
      const { stored, plan, clips } = await compile(folder, rules)
      const draft = await loadDraft(folder)
      let hidden = new Map<number, Set<number>>()
      if (hideUnderHighlights) {
        const settings = await deps.settings.read()
        // text is hidden under only while it is on, as it must be for this to be asked
        const show = showRulesOf(stored, plan, clips, { highlightsOn: true, flair: settings.flair })
        const replaced = await replacedUnder(folder, rules, { position: settings.highlights.position, subtitlesOn: true, highlightsOn: true, flair: settings.flair })
        hidden = hiddenFor(stored, plan, clips, draft, show, replaced)
      }
      const captions = captionsFor(plan, clips, draft, length, hidden)
      const beatOfCut = plan.beats.flatMap((beat) => beat.pieces.map(() => beat.beatId))
      const offsets: number[] = []
      plan.cuts.reduce((at, cut) => (offsets.push(at), at + cut.sourceDurationUs), 0)
      const texts = stored.subtitleTexts ?? {}
      return captions.map((caption) => {
        const cut = plan.cuts[caption.cut]!
        const at = offsets[caption.cut]! - cut.sourceStartUs
        const key = `${cut.binId}:${caption.startUs}:${caption.endUs}:${caption.text}`
        return {
          key,
          beatId: beatOfCut[caption.cut]!,
          startUs: at + caption.startUs,
          endUs: at + caption.endUs,
          text: caption.text,
          // the user's text for the line, or the polish's, kept with the outline
          ...(Object.hasOwn(texts, key) ? { savedText: texts[key]! } : {}),
        }
      })
    },

    /** Stores a keep or cut decision on a video of the confirmed outline, checked against that video's transcript and length. */
    async decide(folder: string, videoId: string, change: CutDecisionChange): Promise<void> {
      const stored = await confirmedOutline(folder)
      if (!stored.videoIds.includes(videoId)) throw new Error(`video ${videoId} is not in this outline`)
      const [clip] = await loadFootage(deps, folder, [videoId])
      const words = clip!.transcript?.words.length ?? 0
      const inVideo = (range: { startUs: number; endUs: number }) => range.startUs >= 0 && range.startUs < range.endUs && range.endUs <= clip!.durationUs
      const fits =
        change.type === "words"
          ? change.indexes.length > 0 && change.indexes.every((index) => index >= 0 && index < words)
          : change.type === "pause"
            ? change.after >= 0 && change.after < words - 1
            : change.ranges.length > 0 && change.ranges.every(inVideo)
      if (!fits) throw new Error("the decision is outside this video")

      const fingerprint = transcriptFingerprint(clip!.transcript)
      // onto the outline as it is now, so a decision never undoes a change made meanwhile
      await deps.outlines.update(folder, (latest) => {
        const outline = latest ?? stored
        const made = outline.cutDecisions?.[videoId]
        const current = made?.transcript === fingerprint ? made : emptyCutDecisions(fingerprint)
        return { ...outline, cutDecisions: { ...outline.cutDecisions, [videoId]: applyCutDecision(current, change) } }
      })
    },

    /**
     * Stores the user's text for one subtitle line by its key, or forgets it with null, so the edit outlives the page.
     * The texts set longest ago make room past the limit (withTexts): most are keys of lines the cut no longer makes.
     */
    async setSubtitleText(folder: string, key: string, text: string | null): Promise<void> {
      await deps.outlines.update(folder, (latest) => {
        if (!latest) throw new Error("this project has no outline yet")
        return { ...latest, subtitleTexts: text === null ? withTexts(latest.subtitleTexts, [], [key]) : withTexts(latest.subtitleTexts, [[key, text]]) }
      })
    },

    /** Claude's corrections of mis-heard words, kept on disk so the same lines are not paid for twice; `signal` is a plan run's stop. */
    async polish(lines: string[], signal?: AbortSignal): Promise<{ lines: string[]; accepted: boolean }> {
      if (!deps.llm) throw new Error("polishing subtitles is not ready: no Claude connection")
      const { transport, model } = await deps.llm()
      const key = createHash("sha256").update(JSON.stringify([model, SUBTITLE_POLISH_PROMPT.version, lines])).digest("hex")
      const file = join(deps.polishDir, `${key}.json`)
      try {
        return { lines: JSON.parse(await readFile(file, "utf8")) as string[], accepted: true }
      } catch {
        // not polished before
      }
      const result = await polishSubtitles({ transport, model, lines, signal })
      // a reply that did not fit may fit next time, so only good answers are kept
      if (result.accepted) {
        await writeFileAtomic(file, JSON.stringify(result.lines))
      }
      return result
    },

    /**
     * Polishes the subtitle lines a write with these options would carry, as they show (the text stored
     * for a line, else the generated one), and keeps what the polish changed in the outline's
     * subtitleTexts, by line key, as the newest texts, under the same limit as the user's (withTexts); a line
     * the polish turned back into its generated text keeps nothing. A reply that did not fit changes nothing.
     * `count` is how many lines it changed. `signal` is a plan run's stop, which the call is made with.
     */
    async polishStored(folder: string, rules: CutRules, length: SubtitleLength, hideUnderHighlights: boolean, signal?: AbortSignal): Promise<{ count: number; accepted: boolean }> {
      const lines = await service.subtitles(folder, rules, length, hideUnderHighlights)
      if (lines.length === 0) return { count: 0, accepted: true }
      const shown = lines.map((line) => line.savedText ?? line.text)
      const result = await service.polish(shown, signal)
      if (!result.accepted) return { count: 0, accepted: false }
      let count = 0
      // onto the outline as it is now: a line the user typed meanwhile is not written over by an answer about another text
      await deps.outlines.update(folder, (latest) => {
        if (!latest) throw new Error("this project has no outline yet")
        const set: [string, string][] = []
        const forget: string[] = []
        lines.forEach((line, i) => {
          const polished = result.lines[i]
          if (polished === undefined || polished === shown[i] || (latest.subtitleTexts?.[line.key] ?? line.text) !== shown[i]) return
          if (polished === line.text) forget.push(line.key)
          else set.push([line.key, polished])
        })
        count = set.length + forget.length
        return { ...latest, subtitleTexts: withTexts(latest.subtitleTexts, set, forget) }
      })
      return { count, accepted: true }
    },

    /**
     * Backs the draft up and replaces its timeline. Only one write or restore of a draft runs at a
     * time, and the app is told when a write starts and how it ended: the page that asked may have been
     * left and opened again while the write waited for its graphics.
     */
    async write(
      folder: string,
      rules: CutRules,
      expectedSegments: number,
      subtitles: SubtitleRequest | null = null,
      highlights: HighlightRequest | null = null,
    ): Promise<WriteResult> {
      return alone(folder, "write", async () => {
        writesStarted++
        deps.send?.({ type: "timeline-write", folder, state: "started" })
        try {
          const result = await writeNow(folder, rules, expectedSegments, subtitles, highlights)
          deps.send?.({ type: "timeline-write", folder, state: "done", result })
          return result
        } catch (error) {
          deps.send?.({ type: "timeline-write", folder, state: "failed", error: (error as Error).message })
          throw error
        }
      })
    },

    /** The timeline a write of this request would lay, without writing or waiting for renders: where the agent editor starts. */
    dryAssemble: async (folder: string, rules: CutRules, subtitles: SubtitleRequest | null, highlights: HighlightRequest | null): Promise<AgentTimeline> =>
      (await assemble(folder, rules, subtitles, highlights, null)).timeline,

    /** Writes the agent editor's timeline, one write at a time per draft, as `write` does. */
    async writeTimeline(folder: string, timeline: AgentTimeline, expectedSegments: number) {
      return alone(folder, "write", async () => {
        writesStarted++
        return writeTimelineNow(folder, timeline, expectedSegments)
      })
    },

    /** Whether a write to this draft is running now (a restore is not a write). */
    writing: (folder: string): boolean => running.get(folder) === "write",

    /**
     * Whether a write to any draft is running now, and how many have started so far: the graphics a
     * write lays down are in no draft until it is done, so nothing may trash them meanwhile, and a
     * write that came and went while the drafts were being read is only seen by the count.
     */
    anyWriting: (): boolean => [...running.values()].includes("write"),
    writesStarted: (): number => writesStarted,

    backups,

    async restore(folder: string, backupId: string): Promise<void> {
      return alone(folder, "restore", async () => {
        const known = await backups(folder)
        if (!known.some((backup) => backup.id === backupId)) throw new Error(`unknown backup "${backupId}" for this project`)
        await restoreDraft(join(deps.backupRoot, backupId), { isCapCutRunning: deps.isCapCutRunning })
      })
    },
  }
  return service
}

export type TimelineService = ReturnType<typeof createTimelineService>
