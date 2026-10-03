import type { CutRules } from "@boxblack/core/cut"
import type { PlacedPoint } from "@boxblack/core/emphasis"
import type { FlairLevel } from "@boxblack/core/flair/catalogue"
import type { BinMedia } from "@boxblack/core/flair/media"
import type { MediaLook } from "@boxblack/core/flair/look-at"
import type { PlacedGraphic } from "@boxblack/core/graphics/plan"
import { timeHighlights, type TimedGroup } from "@boxblack/core/highlights"
import type { LlmTransport } from "@boxblack/core/llm"
import { planComposedSounds, type PlannedSound, type SoundClip } from "@boxblack/core/sound/plan"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import type { HighlightViewOptions, PostRequest, StoredOutline } from "../shared/api.ts"
import { hashOfHtml, wordsOnCutAt, wordsWithin, type CutWordAt, type PlacedComposed } from "./composed-cues.ts"
import { answerOnBeats, everyPointShown, placedPoints, placeStored, pointText, timelineOf } from "./highlight-state.ts"
import { CALLS_AT_ONCE, createCallLimit, type CallLimit } from "./call-limit.ts"
import type { SpareMedia } from "./insert-media.ts"
import { legacyZoomsBeside, movesOnCut } from "./move-cues.ts"
import { writeAll } from "./motion-write.ts"
import type { OutlineStore } from "./planner.ts"
import { amend, composePlaced, type ComposingWork } from "./sound-actions.ts"
import { samePlace } from "./sound-cues.ts"
import type { SoundRenderer } from "./sound-render.ts"
import { spokenSentences, wordsIn, type SpokenSentence } from "./spoken.ts"
import type { TimelineService } from "./timeline.ts"
import { pieceKey, punchAtUs, zoomSlotsFor, zoomsInForce } from "./zoom-cues.ts"

/*
 * Work 4 (spec §3): Claude plans the clip's sounds in one call, on the clip as it plays after the other works, and
 * composes each one in a call of its own, a few at a time, through the same write, lint, check and one repair as a
 * motion graphic. The plan is stored as it comes, none of its sounds composed yet; each sound is then composed for
 * the room it has on the rough cut, as the preview places it, and stored as its composing ends.
 */

export interface SoundWorkDeps {
  outlines: OutlineStore
  timeline: Pick<TimelineService, "compiled">
  /** the Claude connection for this work, or why there is none */
  llm: () => Promise<{ transport: LlmTransport; model: string }>
  /** what the clip is about, in one line, as every writing is told it */
  about: (stored: StoredOutline) => string
  /** the project's own spare photos and clips, which the cutaways show */
  media?: SpareMedia
  /** what Claude last said a picture shows, from the cache alone; null when it has not been looked at */
  lookedAt?: (picture: BinMedia) => Promise<MediaLook | null>
  /** the graphics in force, built from the stored outline the way the preview builds them */
  graphicJobs?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: PlacedGraphic[] }>
  /** the composed sounds as the preview places them; without it no sound has a place, and none is composed */
  composedSounds?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: PlacedComposed[] }>
  /** renders a sound's code as it will be kept and says what is wrong with it; without it each is taken on the linter alone */
  renderer?: Pick<SoundRenderer, "check" | "forgetMachine">
  /** the slots the composings take their turns in, shared with the graphics' writing; without it the work has its own */
  calls?: CallLimit
}

/** What the clip is made of, as work 4 gathers it from the rough cut, before it is told to Claude. */
export interface SoundClipInput {
  about: string
  /** the outline's direction for decorating the clip; absent on outlines from before 0.8.4 */
  direction?: string
  level: FlairLevel
  /** the sentences the rough cut plays, whose words are the clip's */
  sentences: SpokenSentence[]
  beats: { name: string; startUs: number }[]
  /** every placed point, with what it stresses */
  points: { placed: PlacedPoint; what: string }[]
  /** the text as it plays with every point shown */
  groups: TimedGroup[]
  /** the graphics in force at the loudest level */
  graphics: PlacedGraphic[]
  /** the moves of the picture, each where it starts, how long it runs and what it does; a legacy punch is one too */
  moves: { atUs: number; durationUs: number; about: string }[]
  inserts: { what: string; atUs: number }[]
  /** the graphics are being written while the sounds are planned: the ones not written yet are shown too */
  drawing?: boolean
}

/** What the numbers of a plan's answer name: the words with the moments they are said at, the graphics and the points. */
export interface ClipSources {
  words: CutWordAt[]
  graphics: PlacedGraphic[]
  pointIds: string[]
}

const byTime = <T extends { atUs: number }>(a: T, b: T) => a.atUs - b.atUs

/** How long a legacy punch takes to land, as the sounds are told it (capcut/zoom.ts). */
const PUNCH_US = 350_000

/**
 * The clip as the planning call is shown it, and what its lists are made from, in the same order. The words are every
 * word the rough cut plays (`wordsOnCutAt`), as the placing reads them, so a sound's words cannot be one list's when
 * it is planned and another's when it is placed. Only a graphic written and fresh is shown: one not written yet has no
 * picture to score, and one gone stale is not laid in a write. While the graphics are being written (`drawing`), one
 * not written yet is shown too, with no fragment: it is about to have one. The caller hands in only those being
 * written then (`gather`). Every list is in playing order.
 */
export function soundClipOf(input: SoundClipInput): { clip: SoundClip; sources: ClipSources } {
  const words = wordsOnCutAt(input.sentences)
  const points = [...input.points].sort((a, b) => a.placed.atUs - b.placed.atUs)
  const graphics = input.graphics.filter((graphic) => (input.drawing === true || graphic.cue.spec.html !== null) && graphic.stale !== true).sort(byTime)
  const clip: SoundClip = {
    about: input.about,
    ...(input.direction === undefined ? {} : { direction: input.direction }),
    level: input.level,
    words: words.map(({ text, atUs }) => ({ text, atUs })),
    beats: input.beats,
    points: points.map(({ placed, what }) => ({ importance: placed.point.importance, type: placed.point.type, what, atUs: placed.atUs })),
    lines: input.groups.flatMap((group) => group.lines.map((line) => ({ text: line.text.trim(), atUs: line.startUs }))).sort(byTime),
    graphics: graphics.map((graphic) => ({ idea: graphic.cue.spec.idea, html: graphic.cue.spec.html, atUs: graphic.atUs, seconds: graphic.durationUs / 1_000_000 })),
    moves: [...input.moves].sort(byTime).map(({ atUs, durationUs, about }) => ({ atUs, seconds: Math.round(durationUs / 100_000) / 10, about })),
    inserts: [...input.inserts].sort(byTime),
  }
  return { clip, sources: { words, graphics, pointIds: points.map(({ placed }) => placed.point.id) } }
}

/**
 * The planned sounds as they are stored, none composed yet. One on a word starts at the moment that word is said; one
 * that scores a graphic has the graphic's place, and is tied to it with the hash of the fragment it scores. Each has
 * the length it was planned for and the words said from its start within it, which its composing replaces with the
 * room it really has. A sound is known by its place, so one whose place an earlier sound holds (footage played twice
 * in a beat says a word twice at one moment of speech) is dropped and counted.
 */
export function soundsToStore(planned: PlannedSound[], sources: ClipSources): { sounds: ComposedSound[]; dropped: number } {
  const sounds: ComposedSound[] = []
  let dropped = 0
  for (const sound of planned) {
    const graphic = sound.graphic === null ? undefined : sources.graphics[sound.graphic]
    const word = sources.words[sound.word]!
    const anchor = graphic ? graphic.cue.anchor : word.anchor
    if (sounds.some((there) => samePlace(there.anchor, anchor))) {
      dropped++
      continue
    }
    const pointId = sound.point === null ? undefined : sources.pointIds[sound.point]
    sounds.push({
      anchor,
      ...(graphic ? { graphic: graphic.cue.anchor, graphicHtml: hashOfHtml(graphic.cue.spec.html ?? "") } : {}),
      ...(pointId !== undefined ? { pointId } : {}),
      from: sound.from,
      role: sound.role,
      loudness: sound.loudness,
      seconds: sound.seconds,
      words: wordsWithin(sources.words, graphic ? graphic.atUs : word.atUs, sound.seconds),
      code: null,
      version: SOUND_VERSION,
      off: false,
    })
  }
  return { sounds, dropped }
}

export function createSoundWork(deps: SoundWorkDeps) {
  const calls = deps.calls ?? createCallLimit(CALLS_AT_ONCE)

  /** The clip under the request, as the planning call is shown it: the rough cut with everything works 1 to 3 put on it, every point shown. */
  async function gather(folder: string, request: PostRequest, drawing: boolean): Promise<{ stored: StoredOutline; clip: SoundClip; sources: ClipSources }> {
    const { rules, view } = request
    const { stored, plan, clips, canvas } = await deps.timeline.compiled(folder, rules)
    const points = placedPoints(stored, plan, clips)
    const at = timelineOf(plan)
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const shown = everyPointShown(points, view.highlightsOn)
    const groups = timeHighlights(placeStored(stored, plan, clips, shown), at, plan.durationUs)
    const sentences = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at })
    // a cutaway whose moment the cut took out plays at its point's start, as the preview shows it; the moves on the
    // footage and on the cutaways as they play at the loudest level, where every point shows, as the graphics are shown
    const pictures = view.flair.insert && deps.media ? await deps.media.list(folder, stored.videoIds) : []
    const moved = movesOnCut({ stored, plan, clips, canvas, flair: { ...view.flair, level: "heavy" }, points, groups, pictures, passes: shown.passes, at })
    const playing = moved.inserts
    // a legacy punch lands, with every point shown, on the first line of text in its piece, else at its start. It plays
    // on a piece no move plays on at the level set: a move held back by that level replaces it nowhere, and both are told
    const atLevel = view.flair.level === "heavy" ? moved : movesOnCut({ stored, plan, clips, canvas, flair: view.flair, points, groups, pictures, passes: shown.passes, at })
    const pieces = zoomSlotsFor({ plan, groups, beatNames, at })
    const byPiece = new Map(pieces.map((piece) => [pieceKey(piece.anchor), piece]))
    const zoomed = legacyZoomsBeside(zoomsInForce({ zooms: stored.flair?.zooms ?? [], slots: pieces, flair: view.flair, durationUs: plan.durationUs, passes: shown.passes }).kept, atLevel.kept, pieces).inForce
    const punches = zoomed.flatMap((zoom) => {
      const piece = byPiece.get(pieceKey(zoom.cue.anchor))
      return piece && zoom.cue.kind === "punch" ? [{ atUs: piece.atUs + punchAtUs(piece, groups), durationUs: PUNCH_US, about: "zoom punch" }] : []
    })
    const moves = [...moved.kept.map((move) => ({ atUs: move.atUs, durationUs: move.durationUs, about: move.cue.about })), ...punches]
    const inserts = await Promise.all(
      playing.map(async (insert) => ({ what: (await deps.lookedAt?.(insert.media).catch(() => null))?.what ?? insert.media.name, atUs: insert.atUs })),
    )
    // the graphics as they play at the loudest level, where every point shows; ones that cannot be read are none
    const loudest =
      view.flair.graphic && deps.graphicJobs
        ? await deps.graphicJobs(folder, rules, { ...view, flair: { ...view.flair, level: "heavy" } }).then(
            (made) => made.kept,
            () => [],
          )
        : []
    // while the graphics are written, one not written yet is shown only when it is among those being written: the ones in
    // force at the level set, as work 2c writes them. One the level holds back will not be drawn in this run. Each is
    // known by its place, since one may have been written between the two reads
    const writing =
      drawing && deps.graphicJobs && loudest.some((graphic) => graphic.cue.spec.html === null)
        ? await deps.graphicJobs(folder, rules, view).then(
            (made) => made.kept,
            () => [],
          )
        : []
    const graphics = loudest.filter((graphic) => graphic.cue.spec.html !== null || writing.some((written) => samePlace(written.cue.anchor, graphic.cue.anchor)))
    // where each beat starts on the rough cut: its first piece's start
    let piece = 0
    const beats = plan.beats.flatMap((beat) => {
      const first = beat.pieces[0]
      const index = piece
      piece += beat.pieces.length
      return first ? [{ name: beatNames.get(beat.beatId) ?? beat.beatId, startUs: at(index, first.startUs) }] : []
    })
    const { clip, sources } = soundClipOf({
      about: deps.about(stored),
      direction: stored.outline.direction,
      level: view.flair.level,
      sentences,
      beats,
      points: points.map((placed) => ({ placed, what: pointText(placed, clips) })),
      groups,
      graphics,
      moves,
      inserts,
      drawing,
    })
    return { stored, clip, sources }
  }

  return {
    /**
     * Work 4, the sound switch on. Claude is shown the clip (`gather`) and answers its palette and its sounds; with no
     * word on the rough cut no call is made and nothing changes. The plan is stored in one change of the outline as it
     * is then: the palette, and the planned sounds, none composed yet, in place of every composed sound before them;
     * Claude's CapCut sounds go, and the user's own stay. Answers on a beat that got a new id meanwhile follow it;
     * ones on a point deleted meanwhile go with the point, and ones for a graphic taken away meanwhile with the graphic.
     *
     * Then every planned sound with a place on the rough cut, as the preview places it at the loudest level, is
     * composed for the room it has there, a few at a time through the slots it shares with the graphics' writing
     * (`calls`), and stored as its composing ends (`composePlaced`). One with no place stays stored, not composed, and
     * the preview counts it with the sounds that have no place; so does a tied one while graphics are not shown, which
     * the placing leaves out, and one whose graphic has no picture to score (no fragment, or gone stale), which waits
     * for it. `progress` is told how many composings have ended, of how many, before the first and after each. The
     * count is the sounds composed; dropped are the answers of the plan that could not be used and the sounds whose
     * composing failed.
     *
     * `drawing`, when it is handed in, is the graphics' writing, still under way: the sounds are planned once the
     * graphics are planned and stored, and are composed while those are written. Claude is then shown the graphics not
     * written yet too, with no fragment. The sounds on speech alone are composed at once; a tied one whose graphic has
     * no fragment yet waits until `drawing` has settled, however it ended, and is then composed to the fragment its
     * graphic got, as it is placed then; one whose graphic has none even then (its writing failed, or it is gone) stays
     * stored, not composed, as one whose graphic has no picture does. The waiting ones are counted from the start in
     * what `progress` is told, and each counts as ended once it is composed or left. A composing on speech that fails,
     * for a stop or anything else, fails the work at once, and the tied ones still waiting are not composed after.
     *
     * `signal` is the run's stop, which every call is made with. Pressed while the sounds are composed, it ends every
     * composing under way and starts no other: the sounds already composed stay, and the work rejects as a stopped
     * call does.
     */
    async run(
      folder: string,
      request: PostRequest,
      signal?: AbortSignal,
      progress?: (done: number, total: number) => void,
      drawing?: Promise<unknown>,
    ): Promise<{ count: number; dropped: number }> {
      const { rules, view } = request
      const llm = await deps.llm()
      const { stored, clip, sources } = await gather(folder, request, drawing !== undefined)
      if (clip.words.length === 0) return { count: 0, dropped: 0 }
      const planned = await planComposedSounds({ ...llm, clip, signal })
      const { sounds, dropped } = soundsToStore(planned.sounds, sources)
      await amend(deps.outlines, folder, (latest) => {
        const flair = latest.flair ?? { looks: {} }
        const now = new Set((latest.emphasis?.points ?? []).map((point) => point.id))
        const graphicsNow = flair.graphics ?? []
        const composed = answerOnBeats(sounds, stored.outline.beats, latest.outline.beats)
          .filter((sound) => sound.pointId === undefined || now.has(sound.pointId))
          // a sound for a graphic taken away meanwhile has nothing to score
          .filter((sound) => sound.graphic === undefined || graphicsNow.some((graphic) => samePlace(graphic.anchor, sound.anchor)))
          // a tied sound has its graphic's place, which follows the beat with it
          .map((sound) => (sound.graphic ? { ...sound, graphic: sound.anchor } : sound))
        return { ...latest, flair: { ...flair, palette: planned.palette, composed, ...(flair.cues ? { cues: flair.cues.filter((cue) => cue.edited) } : {}) } }
      })
      // what has a place now, read from the stored outline as the preview reads it, at the loudest level
      const loudest: HighlightViewOptions = { ...view, flair: { ...view.flair, level: "heavy" } }
      const unwritten = async () => (deps.composedSounds ? (await deps.composedSounds(folder, rules, loudest)).kept.filter((sound) => sound.sound.code === null) : [])
      // a tied sound is composed to its graphic's picture: one whose graphic has none (not written, or gone stale) waits for it
      const scorable = (sound: PlacedComposed) => sound.graphic === null || (sound.graphic.cue.spec.html !== null && sound.graphic.stale !== true)
      // while the graphics are written, a tied one whose graphic has no fragment yet waits for their writing to end
      const toDraw = (sound: PlacedComposed) => drawing !== undefined && sound.graphic !== null && sound.graphic.cue.spec.html === null && sound.graphic.stale !== true
      const placedNow = await unwritten()
      const placed = placedNow.filter(scorable)
      const waiting = placedNow.filter(toDraw)
      const total = placed.length + waiting.length
      if (total === 0) return { count: 0, dropped: planned.dropped + dropped }
      // a fault a render found on this machine may have been mended since: the composing looks again
      deps.renderer?.forgetMachine()
      const work: ComposingWork = { llm, palette: planned.palette, about: deps.about(stored), signal }
      let written = 0
      let failed = 0
      let ended = 0
      // what a stop ended was not composed: nothing more is reported after it
      const report = () => {
        if (!signal?.aborted) progress?.(++ended, total)
      }
      const compose = (pool: PlacedComposed[]) =>
        writeAll(
          pool,
          async (sound) => {
            const ending = await composePlaced(deps, folder, work, sound)
            if (ending === "written") written++
            else if (ending === "failed") failed++
          },
          report,
          calls,
        )
      if (!signal?.aborted) progress?.(0, total)
      // a composing that failed for anything but a stop fails the work at once: the tied sounds are not composed after
      let givenUp = false
      const afterDrawing = async () => {
        if (waiting.length === 0) return
        await drawing!.catch(() => {})
        if (givenUp) return
        // each as it is placed once its graphic's writing has ended: one whose graphic got no fragment is left
        const now = (await unwritten()).filter(scorable)
        const ready = waiting.flatMap((sound) => now.filter((placedThen) => placedThen.graphic !== null && samePlace(placedThen.sound.anchor, sound.sound.anchor)))
        for (let left = waiting.length - ready.length; left > 0; left--) report()
        await compose(ready)
      }
      const later = afterDrawing()
      // awaited below; held here so that it does not fail unheard while the work fails first
      later.catch(() => {})
      try {
        await compose(placed)
      } catch (error) {
        // failed or stopped: the work ends now, and the tied sounds still waiting are not composed after
        givenUp = true
        throw error
      }
      await later
      return { count: written, dropped: planned.dropped + dropped + failed }
    },
  }
}

export type SoundWork = ReturnType<typeof createSoundWork>
