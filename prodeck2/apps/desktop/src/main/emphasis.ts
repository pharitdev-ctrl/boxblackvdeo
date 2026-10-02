import { randomUUID } from "node:crypto"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import { DEFAULT_CUT_RULES, type CutRules } from "@boxblack/core/cut/rules"
import {
  EMPTY_EMPHASIS,
  passesLevel,
  planEmphasis,
  pointsOverlap,
  type EmphasisAnchor,
  type EmphasisPatch,
  type EmphasisPoint,
  type EmphasisScene,
} from "@boxblack/core/emphasis"
import { keptReason } from "@boxblack/core/emphasis/types"
import type { FlairLevel } from "@boxblack/core/flair/catalogue"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import type { HighlightGroup } from "@boxblack/core/highlights"
import type { LlmTransport } from "@boxblack/core/llm"
import { isComposed } from "@boxblack/core/sound/spec"
import { samePlace } from "./sound-cues.ts"
import { withoutStrandedMoves } from "./move-cues.ts"
import type { EmphasisView, StoredOutline } from "../shared/api.ts"
import { transcriptFingerprint } from "./footage.ts"
import { currentPoints, placedPoints, pointText, regroupFlair, timelineOf } from "./highlight-state.ts"
import type { OutlineStore } from "./planner.ts"
import { spokenSentences, wordsIn } from "./spoken.ts"
import type { TimelineService } from "./timeline.ts"

export interface EmphasisDeps {
  outlines: OutlineStore
  timeline: Pick<TimelineService, "compiled">
  /** the Claude connection chosen in settings */
  llm?: () => Promise<{ transport: LlmTransport; model: string }>
  newId?: () => string
}

/** A copy of an item bound to no point, so it shows at every level; the item itself when it is bound to none already. */
export function unbound<T extends { pointId?: string }>(item: T): T {
  if (item.pointId === undefined) return item
  const copy = { ...item }
  delete copy.pointId
  return copy
}

/**
 * Whether a highlight group is the user's to keep: one they made, one they changed, or one whose look
 * they set by hand (setLook marks only the look). Such a group outlives its point and the one-time
 * cleanup, look and all; withoutPoint and withoutOldEffects both ask this, so the two keep the same rule.
 */
export function usersGroup(stored: StoredOutline, group: HighlightGroup): boolean {
  return group.source === "user" || group.edited || stored.flair?.looks?.[group.id]?.edited === true
}

/**
 * Moves the user's edited items off the lines of highlight groups that are going, to the start of the
 * line's beat, so regroupFlair (which drops whatever sits on a line it has nowhere to follow) leaves them
 * be: spec §4.4 and §7 keep what the user edited. The beat is the group's own while the outline has it,
 * else the first beat that plays the line's video; an item whose line has neither (a group never stored,
 * a video no beat plays) is left as it is, and regroupFlair drops it as before. The outline holds no word
 * times, only transcript fingerprints, so a beat's start is the nearest place a pure function can name:
 * nearly every beat has a sound slot there (not when a line of text starts at the same instant, which takes
 * the slot, or when the beat keeps no piece), and a cutaway fits there.
 *
 * Nothing moved is left out for lack of room. Cutaways stacked on one beat start all play, each on a lane
 * of its own. Two sounds moved to one beat start are both kept but play as one: cuesInForce plays one
 * sound a place, the user's first, in the order they are stored. The app puts graphics on moments of speech,
 * never on a line, so in practice none is moved. Unedited items, and items on groups that stay or on no line,
 * are handed back as they are. `before` are the groups as stored before the change, `staying` the ids of
 * those that stay.
 */
export function offGoneLines<T extends { anchor: CueAnchor; edited: boolean }>(items: T[], stored: StoredOutline, before: HighlightGroup[], staying: ReadonlySet<string>): T[] {
  const beatOf = (groupId: string, line: number): string | undefined => {
    const group = before.find((one) => one.id === groupId)
    if (!group) return undefined
    if (group.beatId !== undefined && stored.outline.beats.some((beat) => beat.id === group.beatId)) return group.beatId
    const videoId = group.lines[line]?.videoId
    return stored.outline.beats.find((beat) => beat.videoId === videoId)?.id
  }
  return items.map((item) => {
    // typed as the union, so the kind check narrows it
    const anchor: CueAnchor = item.anchor
    if (!item.edited || anchor.kind !== "highlight" || staying.has(anchor.groupId)) return item
    const beatId = beatOf(anchor.groupId, anchor.line)
    return beatId === undefined ? item : { ...item, anchor: { kind: "beat" as const, beatId, edge: "start" as const } }
  })
}

/**
 * The outline with a point taken out: every highlight group, sound, zoom, cutaway and graphic that
 * carries its id and that Claude placed goes (a group through regroupFlair, so its look and Claude's
 * line sounds go too). The user's stay with their pointId removed, so they show at every level: an
 * edited item, and a group that is the user's (usersGroup), the rule the one-time cleanup keeps too.
 * An edited sound, cutaway or graphic on a line of a group that goes stays too, moved to the start of
 * the group's beat (offGoneLines). A sound Claude composed is never the user's, edited or not: every one
 * made for the point goes, one tied to a graphic of the user's too, and so does one tied to a graphic of Claude's
 * that goes with the point, whatever point the sound names. Pure.
 */
export function withoutPoint(stored: StoredOutline, pointId: string): StoredOutline {
  /** an item on the point goes, unless it is the user's: then it stays, bound to nothing */
  const settle = <T extends { pointId?: string }>(items: T[], theirs: (item: T) => boolean): T[] =>
    items.flatMap((item) => (item.pointId !== pointId ? [item] : theirs(item) ? [unbound(item)] : []))
  // sounds, zooms, moves, cutaways and graphics carry no source: the user's are the ones they edited or made (both edited)
  const edited = (item: { edited: boolean }) => item.edited
  const emphasis = stored.emphasis && { ...stored.emphasis, points: stored.emphasis.points.filter((point) => point.id !== pointId) }
  const before = stored.highlights?.groups ?? []
  const groups = settle(before, (group) => usersGroup(stored, group))
  const staying = new Set(groups.map((group) => group.id))
  /** what stays of sounds, cutaways and graphics: one the user edited on a line of a group that goes moves off it first */
  const kept = <T extends { pointId?: string; edited: boolean; anchor: CueAnchor }>(items: T[]): T[] => offGoneLines(settle(items, edited), stored, before, staying)
  const was = stored.flair
  // Claude's graphics on the point, which go: a sound tied to one goes with it
  const goneGraphics = (was?.graphics ?? []).filter((graphic) => graphic.pointId === pointId && !graphic.edited)
  const tiedToGone = (sound: { graphic?: CueAnchor }) => sound.graphic !== undefined && goneGraphics.some((graphic) => samePlace(graphic.anchor, sound.graphic!))
  const inserts = was?.inserts ? kept(was.inserts) : undefined
  const flair = was && {
    ...was,
    ...(was.cues ? { cues: kept(was.cues) } : {}),
    ...(was.zooms ? { zooms: settle(was.zooms, edited) } : {}),
    // Claude's moves on a cutaway that went with the point go too
    ...(was.moves ? { moves: withoutStrandedMoves(settle(was.moves, edited), inserts ?? []) } : {}),
    ...(inserts ? { inserts } : {}),
    ...(was.graphics ? { graphics: kept(was.graphics) } : {}),
    // a stored entry that is no composed sound is left as it is
    ...(was.composed ? { composed: was.composed.filter((sound) => !isComposed(sound) || (sound.pointId !== pointId && !tiedToGone(sound))) } : {}),
  }
  const highlights = stored.highlights && { ...stored.highlights, groups }
  const next: StoredOutline = { ...stored, ...(emphasis ? { emphasis } : {}), ...(flair ? { flair } : {}), ...(highlights ? { highlights } : {}) }
  // a group that went takes its look, and Claude's items still on its lines, with it
  return regroupFlair(next, before, () => false)
}

/** The kept scenes of the outline's picture beats (Beat.kind "scenes"), numbered s1… in playing order, as planEmphasis is shown them. */
export function emphasisScenes(stored: StoredOutline, plan: CutPlan, clips: CutClip[]): EmphasisScene[] {
  const at = timelineOf(plan)
  const beats = new Map(stored.outline.beats.map((beat) => [beat.id, beat]))
  const found: Omit<EmphasisScene, "label">[] = []
  // plan.cuts are the beats' pieces one after another, so a beat's first piece is at the count of the pieces before it
  let first = 0
  for (const cut of plan.beats) {
    const start = first
    first += cut.pieces.length
    const beat = beats.get(cut.beatId)
    if (!beat || beat.kind !== "scenes") continue
    for (const scene of clips.find((clip) => clip.id === cut.videoId)?.insight?.scenes ?? []) {
      // what each kept piece of the beat plays of the scene
      const parts = cut.pieces.flatMap((piece, i) => {
        const from = Math.max(scene.startUs, piece.startUs)
        const to = Math.min(scene.endUs, piece.endUs)
        return to > from ? [{ cut: start + i, from, to }] : []
      })
      if (parts.length === 0) continue
      found.push({
        videoId: cut.videoId,
        beatId: cut.beatId,
        beatName: beat.name,
        startUs: Math.min(...parts.map((part) => part.from)),
        endUs: Math.max(...parts.map((part) => part.to)),
        timelineUs: at(parts[0]!.cut, parts[0]!.from),
        durationUs: parts.reduce((sum, part) => sum + part.to - part.from, 0),
        description: scene.description,
        kind: scene.kind,
        visual: beat.visual,
      })
    }
  }
  return found.sort((a, b) => a.timelineUs - b.timelineUs).map((scene, i) => ({ ...scene, label: `s${i + 1}` }))
}

/**
 * Whether work 2's text and techniques (text, zooms, moves, cutaways), its graphics, and work 4 (sounds) left anything on
 * the points: a stored item of Claude's, unedited, that carries a pointId. What the user made for a point or changed
 * by hand says nothing about whether Claude's work is behind. A composed sound is always Claude's, so every one on a
 * point counts. Read from the stored outline, so the level in force hides none.
 */
function placedOnPoints(stored: StoredOutline): { techniques: boolean; graphics: boolean; sounds: boolean } {
  const bound = (items: { pointId?: string; edited: boolean }[] | undefined) => (items ?? []).some((item) => item.pointId !== undefined && !item.edited)
  const flair = stored.flair
  const groups = (stored.highlights?.groups ?? []).filter((group) => group.source === "ai")
  return {
    techniques: bound(groups) || bound(flair?.zooms) || bound(flair?.moves) || bound(flair?.inserts),
    graphics: bound(flair?.graphics),
    sounds: bound(flair?.cues) || (flair?.composed ?? []).some((sound) => isComposed(sound) && sound.pointId !== undefined),
  }
}

/**
 * A work is behind the points when it planned on an older version of them. With no version stored
 * (plannedOn null) it is behind when it placed items anyway: a first run with a failed call stores what its
 * other calls made and no version, and those items sit on the points of that time. A work that never ran
 * and placed nothing is not behind.
 */
const behind = (plannedOn: number | null, version: number, placed: boolean): boolean => (plannedOn !== null ? plannedOn !== version : placed)

/** What the emphasis tab shows (see EmphasisView). `items` are the ids carried by what plays now, by kind. Pure. */
export function emphasisView(input: {
  stored: StoredOutline
  plan: CutPlan
  clips: CutClip[]
  level: FlairLevel
  items: { text: (string | undefined)[]; zoom: (string | undefined)[]; insert: (string | undefined)[]; graphic: (string | undefined)[]; sound: (string | undefined)[] }
}): EmphasisView {
  const { stored, plan, clips, level, items } = input
  const emphasis = stored.emphasis ?? EMPTY_EMPHASIS
  const placed = placedPoints(stored, plan, clips)
  const wordsOf = wordsIn(clips)
  const count = (ids: (string | undefined)[], id: string) => ids.filter((one) => one === id).length
  const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
  const onPoints = placedOnPoints(stored)
  // with no point on the rough cut a work thought again has nothing to go on and notes no version, so it could
  // never catch up: nothing is behind until a point plays again
  const onCut = placed.length > 0
  return {
    points: placed.map((entry) => {
      const { point, beatId, atUs, endUs } = entry
      return {
        id: point.id,
        anchor: point.anchor,
        importance: point.importance,
        type: point.type,
        reason: point.reason,
        source: point.source,
        edited: point.edited,
        beatId,
        atUs,
        endUs,
        text: pointText(entry, clips),
        shown: passesLevel(point.importance, level),
        items: {
          text: count(items.text, point.id),
          zoom: count(items.zoom, point.id),
          insert: count(items.insert, point.id),
          graphic: count(items.graphic, point.id),
          sound: count(items.sound, point.id),
        },
      }
    }),
    // every sentence the cut plays, with its words from the transcript, to pick a phrase from
    sentences: spokenSentences({ plan, wordsOf, beatNames, at: timelineOf(plan) }).map((sentence) => ({
      videoId: sentence.videoId,
      beatId: sentence.beatId,
      from: sentence.from,
      to: sentence.to,
      atUs: sentence.timelineUs,
      words: wordsOf(sentence.videoId)
        .slice(sentence.from, sentence.to)
        .map((word) => word.text),
    })),
    scenes: emphasisScenes(stored, plan, clips).map((scene) => {
      const stretch: EmphasisAnchor = { kind: "scene", videoId: scene.videoId, startUs: scene.startUs, endUs: scene.endUs, beatId: scene.beatId }
      return {
        videoId: scene.videoId,
        beatId: scene.beatId,
        startUs: scene.startUs,
        endUs: scene.endUs,
        atUs: scene.timelineUs,
        durationUs: scene.durationUs,
        description: scene.description,
        pointId: placed.find((entry) => pointsOverlap(entry.point.anchor, stretch))?.point.id ?? null,
      }
    }),
    hidden: emphasis.points.length - placed.length,
    version: emphasis.version,
    changed: {
      // an outline from before 0.7.0 noted the text and techniques with the graphics; a note of null is their own
      techniques: onCut && behind(emphasis.plannedOn.techniques === undefined ? emphasis.plannedOn.graphics : emphasis.plannedOn.techniques, emphasis.version, onPoints.techniques),
      graphics: onCut && behind(emphasis.plannedOn.graphics, emphasis.version, onPoints.graphics),
      sounds: onCut && behind(emphasis.plannedOn.sounds, emphasis.version, onPoints.sounds),
    },
  }
}

/**
 * Refuses an anchor the outline cannot hold: its video must be in it, its beat must play that video
 * and be of its kind (words on a speech beat, a stretch on a picture beat), its words or stretch must
 * be inside the file, and then inside the beat as the cut sees it.
 */
function checkAnchor(stored: StoredOutline, clips: CutClip[], anchor: EmphasisAnchor): void {
  if (!stored.videoIds.includes(anchor.videoId)) throw new Error(`video ${anchor.videoId} is not in this outline`)
  const beat = stored.outline.beats.find((one) => one.id === anchor.beatId)
  if (!beat || beat.videoId !== anchor.videoId) throw new Error(`unknown beat ${anchor.beatId} for video ${anchor.videoId}`)
  // words are said in a speech beat; a scene is a stretch of a picture beat
  if ((anchor.kind === "speech") !== (beat.kind === "speech")) throw new Error(`the point is on the wrong kind of beat for a ${anchor.kind} point`)
  const clip = clips.find((one) => one.id === anchor.videoId)
  if (anchor.kind === "speech") {
    const words = clip?.transcript?.words ?? []
    if (anchor.to > words.length) throw new Error("the point is outside its video")
    // the cut counts a word in a beat when its middle falls in the beat's span, ends included (compileCuts)
    const inBeat = (word: { startUs: number; endUs: number }) => {
      const middle = (word.startUs + word.endUs) / 2
      return middle >= beat.startUs && middle <= beat.endUs
    }
    if (!inBeat(words[anchor.from]!) || !inBeat(words[anchor.to - 1]!)) throw new Error("the point is outside its beat")
    return
  }
  if (anchor.endUs > (clip?.durationUs ?? 0)) throw new Error("the point is outside its video")
  // touching the beat is enough: the cut may move a picture beat's edges to a nearby shot change
  if (anchor.endUs <= beat.startUs || anchor.startUs >= beat.endUs) throw new Error("the point is outside its beat")
}

/** Whether two anchors name the same words, or the same stretch, of the same video and beat. */
function sameAnchor(a: EmphasisAnchor, b: EmphasisAnchor): boolean {
  if (a.videoId !== b.videoId || a.beatId !== b.beatId) return false
  if (a.kind === "speech") return b.kind === "speech" && a.from === b.from && a.to === b.to
  return b.kind === "scene" && a.startUs === b.startUs && a.endUs === b.endUs
}

/** Whether every field the patch names is what the point has already; a patch that names none changes nothing. */
function changesNothing(point: EmphasisPoint, patch: EmphasisPatch): boolean {
  return (
    (patch.importance === undefined || patch.importance === point.importance) &&
    (patch.type === undefined || patch.type === point.type) &&
    // the reason as it would be kept: trimmed, and cut to the longest kept
    (patch.reason === undefined || keptReason(patch.reason) === point.reason) &&
    (patch.anchor === undefined || sameAnchor(patch.anchor, point.anchor))
  )
}

/** Refuses an anchor that claims what another current point claims; `self` is the point being moved. */
function checkFree(stored: StoredOutline, clips: CutClip[], anchor: EmphasisAnchor, self?: string): void {
  if (currentPoints(stored, clips).some((point) => point.id !== self && pointsOverlap(point.anchor, anchor))) throw new Error("the point overlaps another point")
}

/**
 * The outline ready for a point on this anchor. A speech point's word numbers belong to its video's
 * transcript as it is now: the points made on an earlier transcript of that video (all but `self`)
 * can never show again, so they go with what Claude put on them, and the new fingerprint is kept.
 */
function onTranscriptOf(stored: StoredOutline, clips: CutClip[], anchor: EmphasisAnchor, self?: string): StoredOutline {
  if (anchor.kind !== "speech") return stored
  const fingerprint = transcriptFingerprint(clips.find((clip) => clip.id === anchor.videoId)?.transcript ?? null)
  const emphasis = stored.emphasis ?? EMPTY_EMPHASIS
  if (emphasis.transcripts[anchor.videoId] === fingerprint) return stored
  const stale = emphasis.points.filter((point) => point.id !== self && point.anchor.kind === "speech" && point.anchor.videoId === anchor.videoId)
  const cleared = stale.reduce((outline, point) => withoutPoint(outline, point.id), stored)
  const now = cleared.emphasis ?? EMPTY_EMPHASIS
  return { ...cleared, emphasis: { ...now, transcripts: { ...now.transcripts, [anchor.videoId]: fingerprint } } }
}

/** The outline with these points; the version goes up by one when works 2 and 4 should hear about the change. */
function withPoints(stored: StoredOutline, points: EmphasisPoint[], bump: boolean): StoredOutline {
  const emphasis = stored.emphasis ?? EMPTY_EMPHASIS
  return { ...stored, emphasis: { ...emphasis, points, version: bump ? emphasis.version + 1 : emphasis.version } }
}

export function createEmphasisService(deps: EmphasisDeps) {
  const newId = deps.newId ?? randomUUID

  /** Changes the outline as it is on disk now, after any change made meanwhile. */
  function amend(folder: string, change: (stored: StoredOutline) => StoredOutline): Promise<StoredOutline> {
    return deps.outlines.update(folder, (latest) => {
      if (!latest) throw new Error("this project has no outline yet")
      return change(latest)
    })
  }

  /** The outline's videos with their transcripts and pictures. The rules only shape the cut, which checking a point does not look at. */
  const clipsOf = async (folder: string): Promise<CutClip[]> => (await deps.timeline.compiled(folder, DEFAULT_CUT_RULES)).clips

  return {
    /**
     * Claude plans the points; the user's and edited ones stay, Claude's old ones go with what sat on them;
     * version goes up by one. `signal` is a plan run's stop, which the call is made with.
     */
    async plan(folder: string, rules: CutRules, signal?: AbortSignal): Promise<{ count: number; dropped: number }> {
      if (!deps.llm) throw new Error("planning the emphasis is not ready: no Claude connection")
      const { transport, model } = await deps.llm()
      const { stored, plan, clips } = await deps.timeline.compiled(folder, rules)
      const wordsOf = wordsIn(clips)
      const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
      const sentences = spokenSentences({ plan, wordsOf, beatNames, at: timelineOf(plan) })
      const scenes = emphasisScenes(stored, plan, clips)
      // nothing offered, nothing replaced: with no sentence and no scene on the cut Claude is not asked (planEmphasis
      // answers no point without a call), and an answer never given must not take Claude's old points away
      if (sentences.length === 0 && scenes.length === 0) return { count: 0, dropped: 0 }
      /** the points a new plan leaves alone: the user's own and the ones they changed, on the transcripts the videos have now */
      const keep = (outline: StoredOutline) => currentPoints(outline, clips).filter((point) => point.source === "user" || point.edited)
      const planned = await planEmphasis({
        transport,
        model,
        brief: stored.brief,
        durationUs: plan.durationUs,
        beats: stored.outline.beats.map((beat) => ({ id: beat.id, name: beat.name, purpose: beat.purpose })),
        sentences,
        scenes,
        wordsOf,
        kept: keep(stored),
        newId,
        signal,
      })

      // merged into the outline as it is now: a point the user added or changed while Claude thought stays
      let count = 0
      let dropped = planned.dropped
      await amend(folder, (latest) => {
        const kept = keep(latest)
        const keptIds = new Set(kept.map((point) => point.id))
        // a beat taken out while Claude thought takes Claude's new points on it along; they count as dropped
        const beats = new Set(latest.outline.beats.map((beat) => beat.id))
        const fresh = planned.points.filter((point) => beats.has(point.anchor.beatId) && !kept.some((other) => pointsOverlap(other.anchor, point.anchor)))
        count = fresh.length
        dropped = planned.dropped + planned.points.length - fresh.length
        // Claude's old points go, and so does every point of an earlier transcript, each with what Claude put on it
        const leaving = (latest.emphasis?.points ?? []).filter((point) => !keptIds.has(point.id))
        const cleared = leaving.reduce((outline, point) => withoutPoint(outline, point.id), latest)
        const emphasis = cleared.emphasis ?? EMPTY_EMPHASIS
        return {
          ...cleared,
          emphasis: {
            ...emphasis,
            points: [...kept, ...fresh],
            version: emphasis.version + 1,
            transcripts: Object.fromEntries(clips.map((clip) => [clip.id, transcriptFingerprint(clip.transcript)])),
          },
        }
      })
      return { count, dropped }
    },

    /** How many points play on the rough cut under these rules: the points alone, for a plan run to know whether works 2 and 4 have anything to go on. */
    async placedCount(folder: string, rules: CutRules): Promise<number> {
      const { stored, plan, clips } = await deps.timeline.compiled(folder, rules)
      return placedPoints(stored, plan, clips).length
    },

    /**
     * Changes a point by hand (it becomes edited), or deletes it with null; see withoutPoint. Importance or phrase changes
     * bump the version. A patch whose every field is what the point has already leaves the point, its `edited` and the version alone.
     */
    async setPoint(folder: string, id: string, patch: EmphasisPatch | null): Promise<void> {
      // only a new phrase needs the videos
      const clips = patch?.anchor ? await clipsOf(folder) : []
      await amend(folder, (latest) => {
        const point = latest.emphasis?.points.find((one) => one.id === id)
        if (!point) throw new Error(`unknown emphasis point ${id}`)
        // what Claude put on it goes with it, so works 2 and 4 have nothing to redo: the version stays
        if (patch === null) return withoutPoint(latest, id)
        // a patch that changes nothing leaves the point as it is: marking it edited would keep one of Claude's through every new plan
        if (changesNothing(point, patch)) return latest
        const anchor = patch.anchor
        if (anchor) checkAnchor(latest, clips, anchor)
        const ready = anchor ? onTranscriptOf(latest, clips, anchor, id) : latest
        if (anchor) checkFree(ready, clips, anchor, id)
        const changed: EmphasisPoint = {
          ...point,
          ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.reason !== undefined ? { reason: keptReason(patch.reason) } : {}),
          ...(anchor ? { anchor } : {}),
          edited: true,
        }
        // a new importance can let a point through a level with nothing on it yet, and a new phrase leaves items on the old words
        const bump = changed.importance !== point.importance || !sameAnchor(changed.anchor, point.anchor)
        return withPoints(ready, (ready.emphasis?.points ?? []).map((one) => (one.id === id ? changed : one)), bump)
      })
    },

    /** A point of the user's on words or a scene they chose; bumps the version; answers the new id. */
    async addPoint(folder: string, anchor: EmphasisAnchor): Promise<string> {
      const clips = await clipsOf(folder)
      const id = newId()
      await amend(folder, (latest) => {
        checkAnchor(latest, clips, anchor)
        const ready = onTranscriptOf(latest, clips, anchor)
        checkFree(ready, clips, anchor)
        // key, so it shows at every level; a scene is a good-looking picture, words most often name a thing: the user changes either after
        const point: EmphasisPoint = { id, anchor, importance: "key", type: anchor.kind === "scene" ? "visual" : "product", reason: "", source: "user", edited: false }
        return withPoints(ready, [...(ready.emphasis?.points ?? []), point], true)
      })
      return id
    },
  }
}

export type EmphasisService = ReturnType<typeof createEmphasisService>
