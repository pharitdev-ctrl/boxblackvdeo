import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import type { PointFilter } from "@boxblack/core/emphasis"
import { FLAIR_LEVELS, type FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import { GRAPHIC_MIN_US, type MotionWord, type PlacedGraphic } from "@boxblack/core/graphics/plan"
import { isComposed, isSoundPrevious, SOUND_SECONDS_MIN, SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import type { ComposedSoundView } from "../shared/api.ts"
import { MOTION_RUN_ON_US, renderSeconds } from "./graphics-cues.ts"
import type { ItemPlace } from "./insert-media.ts"
import { samePlace } from "./sound-cues.ts"
import type { SoundJob, SoundRenderer } from "./sound-render.ts"
import type { SpokenSentence } from "./spoken.ts"

/*
 * Where the sounds Claude composed play on the rough cut, whether each still plays as it was composed for, and how
 * the post-production page shows them (spec §8). A sound sits on a moment of speech as a graphic does, or scores a
 * graphic and goes where that graphic goes.
 */

/**
 * What a graphic's fragment is known by in a sound composed for it: the first sixteen hex digits of its sha256. A
 * sound tied to a graphic keeps the hash of the fragment it was composed to (`graphicHtml`); another one there now
 * means the picture changed under it.
 */
export const hashOfHtml = (html: string): string => createHash("sha256").update(html).digest("hex").slice(0, 16)

/**
 * How far short of its length a written sound may be cut and still be fresh: by then its tail has died away (spec §8).
 * A shorter room would cut into what was composed, and the times in its code cannot be moved without Claude.
 */
const SOUND_CUT_SHORT_US = 100_000

/** A composed sound with where it plays on the rough cut and how long, and whether it still plays as it was composed for. */
export interface PlacedComposed {
  /** as stored, which an edit finds it by */
  sound: ComposedSound
  atUs: number
  /** how long it plays: its length, or less where its room ends first */
  durationUs: number
  /** the beat it plays in */
  beatId: string
  /** the graphic it scores, as placed; null for a sound on a moment of speech alone */
  graphic: PlacedGraphic | null
  /** the words said while it plays now, each with its seconds from where it starts */
  wordsNow: MotionWord[]
  /** written, and no longer played as it was composed for: by the cut (its words, its room, its contract) or by its graphic's picture */
  stale: "cut" | "picture" | null
}

/** A word the rough cut plays: what is said, and where on the rough cut it starts. */
export interface CutWord {
  text: string
  atUs: number
}

/** A word the rough cut plays with the moment of speech it is said at, as a sound planned to start on it is stored. */
export interface CutWordAt extends CutWord {
  anchor: CueAnchor
}

/**
 * The words of every sentence the rough cut plays (`spokenSentences`), in playing order, each where the sentence
 * times it on the rough cut. That is every word of each sentence, as a graphic's words are (`motionWords`): one the
 * cut took out of the middle of a sentence is still listed, at the time of the next word still played there. A word
 * with no rough-cut time of its own (a sentence made by hand) is as long after its sentence's start as it was said.
 * Footage played twice says its words twice. Planning the sounds and placing them later both read the words from
 * here, so the two cannot disagree about which words a sound has. Each word carries the moment it is said at, a
 * moment of speech at its source time in its sentence's beat, which a sound planned on it starts at.
 */
export function wordsOnCutAt(sentences: SpokenSentence[]): CutWordAt[] {
  const words = sentences.flatMap((sentence) => {
    const first = sentence.words[0]
    return sentence.words.map((word) => ({
      text: word.text,
      atUs: word.timelineUs ?? sentence.timelineUs + word.startUs - first!.startUs,
      anchor: { kind: "speech" as const, videoId: sentence.videoId, sourceUs: word.startUs, beatId: sentence.beatId },
    }))
  })
  return words.sort((a, b) => a.atUs - b.atUs)
}

/** The words of every sentence the rough cut plays, in playing order, each where it plays (`wordsOnCutAt`). */
export const wordsOnCut = (sentences: SpokenSentence[]): CutWord[] => wordsOnCutAt(sentences).map(({ text, atUs }) => ({ text, atUs }))

/** Seconds to the millisecond, so that a time that has not really moved gives the same number every time. */
const toMillisecond = (seconds: number) => Math.round(seconds * 1000) / 1000

/**
 * The words said while a sound plays: those that start from `atUs` on, within `seconds` of it, whatever sentence
 * they are in, each with its seconds from `atUs` to the millisecond. A word said as the sound ends is out, as is one
 * said before it starts.
 */
export function wordsWithin(words: CutWord[], atUs: number, seconds: number): MotionWord[] {
  return words
    .filter((word) => word.atUs >= atUs)
    .map((word) => ({ text: word.text, atS: toMillisecond((word.atUs - atUs) / 1_000_000) }))
    .filter((word) => word.atS < seconds)
}

/**
 * Whether a placed sound still plays as it was composed for. One not composed yet, or whose composing failed, has
 * nothing to be stale: it is composed for what there is when it is. A written one tied to a graphic is stale by the
 * picture when that graphic's fragment is not the one it was composed to, or the graphic has none (it waits to be
 * written again), or the graphic is stale: such a graphic is not laid in a write, and its sound is not laid alone. That
 * is told first, since composing it again for the new picture is what it needs. Otherwise it
 * is stale by the cut when the words said while it plays are not the ones it was composed for, in text, order or
 * number (the same words at other times are not: its code is handed their times now), when it plays more than
 * SOUND_CUT_SHORT_US short of its length, or when it was composed under another contract than the app's.
 */
function staleness(sound: ComposedSound, graphic: PlacedGraphic | null, wordsNow: MotionWord[], playsUs: number): PlacedComposed["stale"] {
  if (sound.code === null) return null
  const html = graphic?.cue.spec.html ?? null
  if (graphic && (html === null || graphic.stale === true || hashOfHtml(html) !== sound.graphicHtml)) return "picture"
  // a stored word that is no word (a file edited by hand) is a word changed
  const reworded = wordsNow.length !== sound.words.length || wordsNow.some((word, i) => word.text !== (sound.words[i] as MotionWord | null | undefined)?.text)
  const short = Math.round(sound.seconds * 1_000_000) - playsUs > SOUND_CUT_SHORT_US
  return sound.version !== SOUND_VERSION || reworded || short ? "cut" : null
}

/**
 * The composed sounds that will really play, and the switched-off ones, placed on the rough cut. With the sound switch
 * off there are none. One shows at the level when the level is at least its lowest (`from`) and its point, if it has
 * one, passes (`passes`); one held back is neither listed nor counted, switched off or not. What is read is an outline
 * file, outside the type system: a stored entry that is no composed sound (`isComposed`) is left out the same way.
 *
 * A sound on a moment of speech is placed with its point (`place`, itemPlaceOf): one whose moment the cut took out
 * plays where its point starts now. It plays for its length, or until the piece playing the sentence of the moment it
 * plays by ends, whichever comes first; but, as with a graphic, its piece never leaves it less than GRAPHIC_MIN_US, so
 * a sound on a sentence's last word keeps its tail, ringing on into the next piece. A written one whose room is up to
 * MOTION_RUN_ON_US short of its length plays its whole length all the same, as a written graphic does.
 *
 * A sound tied to a graphic (`graphic`) starts with that graphic as `graphics` placed it, playing or switched off, and
 * plays as long as the graphic does and the graphic's run-on (MOTION_RUN_ON_US) after it, whatever its sentence. One
 * whose graphic is not among them (gone from the cut, removed, of another kind, or hidden) has no place; one whose
 * graphic is switched off is switched off with it. While graphics are not shown at all (`graphics` null: switched off,
 * or no frame to draw on) a tied sound is left out like one the level holds back, neither listed nor counted.
 *
 * The end of the rough cut cuts any sound short, and one with less than SOUND_SECONDS_MIN left there has no place.
 * One with no place is counted as `unplaced`, unless it or its graphic is switched off. Each carries the words said now while it plays
 * (`wordsAt`, asked from where it starts for as long as it plays, as `renderSeconds` gives it) and whether it is stale
 * (`staleness`). Stale or not written yet, it is still placed and listed, played or switched off as it is: the screen
 * shows it and offers to compose it again, and a write leaves it out. A switched-off one is placed and judged as one
 * that plays, so switching it on changes neither. Both lists are in playing order.
 */
export function composedInForce(input: {
  /** the stored `flair.composed` */
  sounds: ComposedSound[]
  place: (anchor: CueAnchor, pointId?: string) => ItemPlace | null
  /** the graphics in force on this rough cut (`graphicsInForce`), placed with the same `place`; null when graphics are not shown: switched off, or no frame to draw on */
  graphics: { kept: PlacedGraphic[]; off: PlacedGraphic[] } | null
  flair: FlairOptions
  durationUs: number
  /** which items show: one on no point, or on a point placed on this rough cut whose importance the level lets through */
  passes: PointFilter
  /** where the piece playing the sentence a moment of speech is in ends, on the rough cut; null when that is not known */
  pieceEndOf: (anchor: CueAnchor) => number | null
  /** the words said from a moment of the rough cut on, within that many seconds of it, each with its seconds from that moment (`wordsWithin`) */
  wordsAt: (atUs: number, seconds: number) => MotionWord[]
}): { kept: PlacedComposed[]; off: PlacedComposed[]; unplaced: number } {
  if (!input.flair.sound) return { kept: [], off: [], unplaced: 0 }
  const level = FLAIR_LEVELS.indexOf(input.flair.level)
  const kept: PlacedComposed[] = []
  const off: PlacedComposed[] = []
  let unplaced = 0
  for (const sound of input.sounds) {
    if (!isComposed(sound)) continue
    if (FLAIR_LEVELS.indexOf(sound.from) > level || !input.passes(sound.pointId)) continue
    const secondsUs = Math.round(sound.seconds * 1_000_000)
    const written = sound.code !== null
    // where it starts, the beat there, how long it may play, and the graphic it scores, if any
    let at: { atUs: number; beatId: string; roomUs: number; graphic: PlacedGraphic | null; off: boolean } | null = null
    if (sound.graphic !== undefined) {
      if (input.graphics === null) continue
      const tied = sound.graphic
      const graphic = [...input.graphics.kept, ...input.graphics.off].find((placed) => samePlace(placed.cue.anchor, tied))
      const where = graphic && input.place(graphic.cue.anchor, graphic.cue.pointId)
      if (graphic && where) at = { atUs: graphic.atUs, beatId: where.beatId, roomUs: Math.min(secondsUs, graphic.durationUs + MOTION_RUN_ON_US), graphic, off: sound.off || graphic.cue.off }
    } else {
      const where = input.place(sound.anchor, sound.pointId)
      if (where) {
        // the sentence of the moment it plays at, which is its point's start when its own moment was cut
        const pieceEndUs = input.pieceEndOf(where.by)
        const roomUs = pieceEndUs === null ? secondsUs : Math.min(secondsUs, Math.max(pieceEndUs - where.atUs, GRAPHIC_MIN_US))
        // a written sound with a little less room than it was composed for plays its whole length all the same
        at = { atUs: where.atUs, beatId: where.beatId, roomUs: written && secondsUs - roomUs <= MOTION_RUN_ON_US ? secondsUs : roomUs, graphic: null, off: sound.off }
      }
    }
    const durationUs = at === null ? 0 : Math.min(at.roomUs, input.durationUs - at.atUs)
    if (at === null || durationUs < SOUND_SECONDS_MIN * 1_000_000) {
      if (!(sound.off || at?.off)) unplaced++
      continue
    }
    const wordsNow = input.wordsAt(at.atUs, renderSeconds(durationUs))
    const placed: PlacedComposed = { sound, atUs: at.atUs, durationUs, beatId: at.beatId, graphic: at.graphic, wordsNow, stale: staleness(sound, at.graphic, wordsNow, durationUs) }
    if (at.off) off.push(placed)
    else kept.push(placed)
  }
  const byTime = (a: PlacedComposed, b: PlacedComposed) => a.atUs - b.atUs
  return { kept: kept.sort(byTime), off: off.sort(byTime), unplaced }
}

/** What the renderer has made of a placed sound's file so far, and why it failed when it did. */
export type SoundStatus = (placed: PlacedComposed) => { state: "pending" | "ready" | "failed"; error: string | null }

/**
 * What the sound renderer makes a placed sound's file from: what is heard of it now, its code, its length and its
 * loudness, with its words at the times they fall now (`wordsNow`), as a graphic's are. A sound still fresh says the
 * same words, so its code is only handed their new times; said as it was composed, the job is the one the writing's
 * check rendered, and nothing is rendered twice. The preview and the write both ask through it. Only for a written sound.
 */
export const soundJobOf = (placed: PlacedComposed): SoundJob => ({ code: placed.sound.code!, seconds: placed.sound.seconds, words: placed.wordsNow, loudness: placed.sound.loudness })

/**
 * The preview's SoundStatus, read from the renderer by each sound's job (soundJobOf), as its `statusOf` reads it: ready
 * while its file is there, failed with the reason the renderer kept, else waiting to be made. The file is looked for
 * at once (`exists`, the disk by default), since a view is made without waiting.
 */
export function soundStatusOf(renderer: Pick<SoundRenderer, "fileOf" | "failureOf">, exists: (path: string) => boolean = existsSync): SoundStatus {
  return (placed) => {
    const job = soundJobOf(placed)
    if (exists(renderer.fileOf(job))) return { state: "ready", error: null }
    const failure = renderer.failureOf(job)
    return failure === null ? { state: "pending", error: null } : { state: "failed", error: failure }
  }
}

/**
 * The composed sounds as the post-production page shows them, the switched-off ones last, each carrying its stored
 * anchor, which an edit finds it by. Each says what it does, from which level it plays and how loud, the graphic it
 * scores by that graphic's idea, whether it is written, whether it is stale and why its last composing failed; and, of
 * the user's edits, the change that made its code, why the last edit failed, and whether a code is kept to go back to.
 * Its render is `status`'s answer for a sound that plays as it was composed: written, fresh and switched on. Any other
 * waits with no error, and `status` is not asked about it: its state line says why. With no `status` (the renderer
 * not wired) every sound waits.
 */
export function composedViews(sounds: { kept: PlacedComposed[]; off: PlacedComposed[] }, status?: SoundStatus): ComposedSoundView[] {
  const viewOf = (placed: PlacedComposed, off: boolean): ComposedSoundView => {
    const { sound } = placed
    const written = sound.code !== null
    const render = status && written && placed.stale === null && !off ? status(placed) : { state: "pending" as const, error: null }
    return {
      anchor: sound.anchor,
      atUs: placed.atUs,
      durationUs: placed.durationUs,
      beatId: placed.beatId,
      role: sound.role,
      from: sound.from,
      loudness: sound.loudness,
      ...(sound.pointId !== undefined ? { pointId: sound.pointId } : {}),
      graphic: placed.graphic ? { summary: placed.graphic.cue.spec.idea } : null,
      written,
      stale: placed.stale,
      // isComposed lets these through only as texts
      writeFailed: sound.failed ?? null,
      instruction: sound.instruction ?? null,
      editFailed: sound.editFailed ?? null,
      // what a file holds there that is no code is nothing to go back to
      canUndo: isSoundPrevious(sound.previous),
      off,
      render: render.state,
      error: render.error,
    }
  }
  return [...sounds.kept.map((placed) => viewOf(placed, false)), ...sounds.off.map((placed) => viewOf(placed, true))]
}
