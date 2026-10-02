import type { CutRules } from "@boxblack/core/cut"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import type { LlmTransport } from "@boxblack/core/llm"
import { lintCompose } from "@boxblack/core/sound/lint"
import { isComposed, isSoundPrevious, SOUND_VERSION, type ComposedSound, type SoundPrevious } from "@boxblack/core/sound/spec"
import { composeSound, soundBrief, soundEditBrief, soundRepairBrief } from "@boxblack/core/sound/write"
import type { HighlightViewOptions, PostRequest, StoredOutline } from "../shared/api.ts"
import { CALLS_AT_ONCE, createCallLimit, type CallLimit } from "./call-limit.ts"
import { hashOfHtml, type PlacedComposed } from "./composed-cues.ts"
import { renderSeconds } from "./graphics-cues.ts"
import { writeChecked, type CheckedWritten } from "./piece-write.ts"
import type { OutlineStore } from "./planner.ts"
import { samePlace } from "./sound-cues.ts"
import type { SoundRenderer } from "./sound-render.ts"

/*
 * What the user asks of one composed sound, as of a motion graphic in 0.5.1 (spec §12): composed again, changed by an
 * instruction, one step back, switched off or on, removed. One composing path serves them and work 4 alike
 * (`composePlaced`), and a sound tied to a graphic follows that graphic when it is written again (spec §11).
 */

/** What every composing of one work shares: the Claude connection, the clip's palette, what the clip is about, and the work's stop. */
export interface ComposingWork {
  llm: { transport: LlmTransport; model: string }
  palette: string
  about: string
  signal?: AbortSignal
}

/** What one composing stores its sound with and checks its code by. */
export interface ComposingDeps {
  outlines: OutlineStore
  /** renders a sound's code as it will be kept and says what is wrong with it; without it each is taken on the linter alone */
  renderer?: Pick<SoundRenderer, "check" | "forgetMachine">
}

/** What a sound was composed for: the length and the words it has room for, and the hash of the fragment it scores when it is tied. */
interface ComposedFor {
  seconds: number
  words: ComposedSound["words"]
  graphicHtml?: string
}

/**
 * The code a sound holds, with what it was composed for and the change that made it when one did; none when it holds
 * no code. A change or a hash stored as anything but a text (a file edited by hand) is left off, and the code is kept.
 */
function codeHeld(sound: ComposedSound): SoundPrevious | undefined {
  if (sound.code === null) return undefined
  return {
    code: sound.code,
    seconds: sound.seconds,
    words: sound.words,
    version: sound.version,
    ...(typeof sound.graphicHtml === "string" ? { graphicHtml: sound.graphicHtml } : {}),
    ...(typeof sound.instruction === "string" ? { instruction: sound.instruction } : {}),
  }
}

/**
 * What a composing that ends keeps for one step back: the code the sound had until then, when it had one, else the one
 * it kept already, so a composing that fails after another failed still keeps the last good code. What a file holds
 * there that is no code (`isSoundPrevious`) is not carried forward.
 */
function keptBefore(sound: ComposedSound): { previous?: SoundPrevious } {
  const previous = codeHeld(sound) ?? sound.previous
  return isSoundPrevious(previous) ? { previous } : {}
}

/** The code written, with the length and the words it was composed for under the contract in force now, and the hash of the fragment it scores. */
const writtenWith = (code: string, composedFor: ComposedFor) => ({
  code,
  version: SOUND_VERSION,
  seconds: composedFor.seconds,
  words: composedFor.words,
  ...(composedFor.graphicHtml !== undefined ? { graphicHtml: composedFor.graphicHtml } : {}),
})

/**
 * A sound once a composing of it (work 4's, or a redo) has ended. Written, it holds the code with what it was composed
 * for (`writtenWith`); failed, it holds no code, and why, its length and words as they were. Either way the code it
 * had until then is kept for one step back (`keptBefore`), and why an earlier composing failed, the change a user
 * asked for and why an edit failed go, since none is about the code it has now.
 */
function afterWriting(sound: ComposedSound, composedFor: ComposedFor, written: CheckedWritten): ComposedSound {
  const { failed: _failed, instruction: _instruction, editFailed: _editFailed, previous: _previous, ...rest } = sound
  const kept = keptBefore(sound)
  return "text" in written ? { ...rest, ...writtenWith(written.text, composedFor), ...kept } : { ...rest, code: null, failed: written.failed, ...kept }
}

/**
 * A sound once an edit of it has ended. Written, it holds the new code as `afterWriting` holds one, with the change
 * that made it, and keeps the code it had until then for one step back; why a composing or an earlier edit failed
 * goes. Failed, it is as it was, with why the edit failed: the code it had still plays.
 */
function afterEdit(sound: ComposedSound, composedFor: ComposedFor, written: CheckedWritten, instruction: string): ComposedSound {
  if (!("text" in written)) return { ...sound, editFailed: written.failed }
  const { failed: _failed, editFailed: _editFailed, previous: _previous, ...rest } = sound
  return { ...rest, ...writtenWith(written.text, composedFor), instruction, ...keptBefore(sound) }
}

/**
 * A sound one step back: the code kept takes the place of the one there, with the length, the words, the contract, the
 * hash of the fragment and the change it was composed for (none of the last two when it had none), and the one there
 * is kept in its place when there is one; one with no code (a composing again that failed) leaves nothing to come back
 * to. Why a composing or an edit failed goes, since it was about the code that leaves; nothing else changes.
 */
export function soundSteppedBack(sound: ComposedSound, previous: SoundPrevious): ComposedSound {
  const { failed: _failed, editFailed: _editFailed, instruction: _instruction, previous: _previous, graphicHtml: _graphicHtml, ...rest } = sound
  const now = codeHeld(sound)
  return {
    ...rest,
    code: previous.code,
    seconds: previous.seconds,
    words: previous.words,
    version: previous.version,
    ...(previous.graphicHtml !== undefined ? { graphicHtml: previous.graphicHtml } : {}),
    ...(previous.instruction !== undefined ? { instruction: previous.instruction } : {}),
    ...(now ? { previous: now } : {}),
  }
}

/** Changes the outline as it is on disk now, after any change made meanwhile; one with no outline yet fails with why. */
export function amend(outlines: OutlineStore, folder: string, change: (stored: StoredOutline) => StoredOutline): Promise<StoredOutline> {
  return outlines.update(folder, (latest) => {
    if (!latest) throw new Error("this project has no outline yet")
    return change(latest)
  })
}

/**
 * Composes one placed sound for the room it has on the rough cut now: the length it plays, to the millisecond below,
 * and the words said in it, with the graphic it scores as that graphic is now. Its code is linted and rendered as it
 * will be kept, and repaired once. How it ended is stored on the outline as it is then, the sound found by its place:
 * as any composing ends (`afterWriting`), or, with `edit`, as an edit does (`afterEdit`). One taken away meanwhile is
 * left alone, not put back. Answers how it ended, "gone" when nothing was stored. The work's stop ends it wherever it
 * has got to, and this rejects with nothing stored.
 *
 * With `edit`, Claude is asked from the brief for the room it has now with the user's change and the code it has
 * (`soundEditBrief`), and the one repair carries that request.
 */
export async function composePlaced(deps: ComposingDeps, folder: string, work: ComposingWork, placed: PlacedComposed, edit?: { instruction: string; code: string }): Promise<"written" | "failed" | "gone"> {
  const { sound } = placed
  const seconds = renderSeconds(placed.durationUs)
  const words = placed.wordsNow
  // the caller composes a tied sound only when its graphic has a fragment
  const html = placed.graphic?.cue.spec.html ?? null
  const graphic = placed.graphic && html !== null ? { idea: placed.graphic.cue.spec.idea, html } : undefined
  const brief = soundBrief({ palette: work.palette, about: work.about, role: sound.role, seconds, words, loudness: sound.loudness, ...(graphic ? { graphic } : {}) })
  const written = await writeChecked({
    first: edit ? soundEditBrief({ brief, code: edit.code, instruction: edit.instruction }) : brief,
    call: (request) => composeSound({ ...work.llm, brief: request, signal: work.signal }),
    lint: lintCompose,
    check: (code) => (deps.renderer ? deps.renderer.check({ code, seconds, words, loudness: sound.loudness }) : Promise.resolve(null)),
    repair: ({ brief: first, text, problems }) => soundRepairBrief({ brief: first, code: text, problems }),
    signal: work.signal,
  })
  const composedFor: ComposedFor = { seconds, words, ...(graphic ? { graphicHtml: hashOfHtml(graphic.html) } : {}) }
  let stored = false
  await amend(deps.outlines, folder, (latest) => {
    const sounds = latest.flair?.composed ?? []
    const index = sounds.findIndex((candidate) => isComposed(candidate) && samePlace(candidate.anchor, sound.anchor))
    if (index < 0) return latest
    stored = true
    const ended = (was: ComposedSound) => (edit ? afterEdit(was, composedFor, written, edit.instruction) : afterWriting(was, composedFor, written))
    return { ...latest, flair: { ...latest.flair!, composed: sounds.map((other, i) => (i === index ? ended(other) : other)) } }
  })
  if (!stored) return "gone"
  return "text" in written ? "written" : "failed"
}

export interface SoundActionsDeps extends ComposingDeps {
  /** the Claude connection for composing, or why there is none */
  llm: () => Promise<{ transport: LlmTransport; model: string }>
  /** what the clip is about, in one line, as every composing is told it */
  about: (stored: StoredOutline) => string
  /** the composed sounds as the preview places them, playing and switched off; without it no sound has a place */
  composedSounds?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: PlacedComposed[]; off: PlacedComposed[] }>
  /** the slots every composing takes its turn in, shared with the graphics' writing; without it the actions have their own */
  calls?: CallLimit
}

/** What one piece written again or edited, a graphic or a sound, counts for its run: written, or failed and dropped; neither when it was taken away meanwhile. */
export const countedOne = (ended: "written" | "failed" | "gone") => ({ count: ended === "written" ? 1 : 0, dropped: ended === "failed" ? 1 : 0 })

/**
 * Whether a placed sound has a picture to be composed to: one on speech alone always has, a tied one when its graphic
 * has a fragment. A graphic gone stale still has one, and a redo or an edit asked for by the user composes to the
 * fragment it has now: that is what plays once the graphic is written again, and the sound is then fresh with it.
 * (Work 4 waits for such a graphic instead, since it composes what nobody asked to see yet.)
 */
const hasPicture = (placed: PlacedComposed) => placed.graphic === null || placed.graphic.cue.spec.html !== null

export function createSoundActions(deps: SoundActionsDeps) {
  const calls = deps.calls ?? createCallLimit(CALLS_AT_ONCE)
  async function outline(folder: string): Promise<StoredOutline> {
    const stored = await deps.outlines.get(folder)
    if (!stored) throw new Error("this project has no outline yet")
    return stored
  }

  /** The sounds placed under the request, playing and switched off, as the preview places them. */
  async function placedUnder(folder: string, request: PostRequest): Promise<PlacedComposed[]> {
    if (!deps.composedSounds) return []
    const { kept, off } = await deps.composedSounds(folder, request.rules, request.view)
    return [...kept, ...off]
  }

  /**
   * One sound as it is placed under the request, to be composed again or edited for the room it has there, with the
   * stored outline its composing reads the palette from. It is looked for among those placed, playing or switched off
   * (a switched-off one is placed as if it played); one with no place now fails with why: its point is hidden by the
   * level, too little of the rough cut is left to play it, it is tied to a graphic that is not shown or has no
   * fragment to score, or it is not there.
   */
  async function placedToCompose(folder: string, anchor: CueAnchor, request: PostRequest): Promise<{ stored: StoredOutline; placed: PlacedComposed }> {
    const stored = await outline(folder)
    const placed = (await placedUnder(folder, request)).find((candidate) => samePlace(candidate.sound.anchor, anchor))
    if (!placed || !hasPicture(placed)) throw new Error("this sound has no place on the clip now")
    return { stored, placed }
  }

  /** What the composings of one run share: the palette the clip's sounds were planned with, and what the clip is about. */
  const workOf = (stored: StoredOutline, llm: ComposingWork["llm"], signal?: AbortSignal): ComposingWork => ({ llm, palette: stored.flair?.palette ?? "", about: deps.about(stored), signal })

  return {
    /**
     * One composed sound composed again from its role, for the room it has on the rough cut now, with the clip's
     * palette, which is how one gone stale is put right. Its code stays until the composing has ended, then gives way
     * to the new one, or to none and why, and is kept for one step back (`undo`); the change a user asked for and why
     * an edit failed go. No other sound is touched. `signal` is the run's stop, which ends the composing at once with
     * nothing stored; `progress` is told (0, 1) as it begins and (1, 1) once it has ended.
     */
    async redo(folder: string, anchor: CueAnchor, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<{ count: number; dropped: number }> {
      const { stored, placed } = await placedToCompose(folder, anchor, request)
      const llm = await deps.llm()
      progress?.(0, 1)
      // a fault a render found on this machine may have been mended since: the composing looks again
      deps.renderer?.forgetMachine()
      const ended = await calls.run(() => composePlaced(deps, folder, workOf(stored, llm, signal), placed))
      progress?.(1, 1)
      return countedOne(ended)
    },

    /**
     * One written sound changed as the user asks (`instruction`), found as `redo` finds it; one not written yet fails
     * with why. Claude is given the brief for the room it has now, the change and the code it has (`soundEditBrief`).
     * Written, the new code is stored with the change, as it was typed less the white space around it, and the code
     * before is kept for one step back. Failed, the sound keeps the code it had, with why the edit failed. `signal` and
     * `progress` are as a redo's.
     */
    async edit(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<{ count: number; dropped: number }> {
      const { stored, placed } = await placedToCompose(folder, anchor, request)
      const code = placed.sound.code
      if (code === null) throw new Error("this sound has not been written yet")
      const llm = await deps.llm()
      progress?.(0, 1)
      // a fault a render found on this machine may have been mended since: the composing looks again
      deps.renderer?.forgetMachine()
      const ended = await calls.run(() => composePlaced(deps, folder, workOf(stored, llm, signal), placed, { instruction: instruction.trim(), code }))
      progress?.(1, 1)
      return countedOne(ended)
    },

    /**
     * One step back on a sound: the code kept by its last edit or composing again changes places with the one there
     * (`soundSteppedBack`), the hash of the fragment it scored with it, in one change of the outline as it is now, so a
     * second step back comes back. Claude is not asked and nothing is rendered. One that is not there, or has no code
     * kept (`isSoundPrevious`), has nothing to go back to.
     */
    async undo(folder: string, anchor: CueAnchor): Promise<void> {
      await outline(folder)
      await amend(deps.outlines, folder, (stored) => {
        const sounds = stored.flair?.composed ?? []
        const index = sounds.findIndex((sound) => isComposed(sound) && samePlace(sound.anchor, anchor))
        const found = sounds[index]
        // what a file holds there that is no code is nothing to go back to
        if (!found || !isSoundPrevious(found.previous)) throw new Error("this sound has nothing to go back to")
        const previous = found.previous
        return { ...stored, flair: { ...stored.flair!, composed: sounds.map((sound, i) => (i === index ? soundSteppedBack(found, previous) : sound)) } }
      })
    },

    /** A sound switched off or on by hand, or taken away with null. Nothing else of it changes, and no other sound. */
    async set(folder: string, anchor: CueAnchor, patch: { off: boolean } | null): Promise<void> {
      await outline(folder)
      await amend(deps.outlines, folder, (stored) => {
        const sounds = stored.flair?.composed ?? []
        const index = sounds.findIndex((sound) => isComposed(sound) && samePlace(sound.anchor, anchor))
        if (index < 0) throw new Error("there is no sound at that place")
        const composed = patch === null ? sounds.filter((_, i) => i !== index) : sounds.map((sound, i) => (i === index ? { ...sound, off: patch.off } : sound))
        return { ...stored, flair: { ...stored.flair!, composed } }
      })
    },

    /**
     * Every sound tied to the graphic at `graphic` composed again, one at a time, as `redo` would compose it, once that
     * graphic has been written again or edited: each scores the fragment it has now. Only those placed under the
     * request are, playing or switched off; none placed asks nothing of Claude and reports nothing. `progress` is told
     * how many composings have ended, of how many, before the first and after each, and nothing after a stop. The count
     * is the sounds written; dropped are the ones whose composing failed.
     */
    async afterGraphic(folder: string, graphic: CueAnchor, request: PostRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<{ count: number; dropped: number }> {
      const tied = (await placedUnder(folder, request)).filter((placed) => placed.sound.graphic !== undefined && samePlace(placed.sound.graphic, graphic) && hasPicture(placed))
      if (tied.length === 0) return { count: 0, dropped: 0 }
      const llm = await deps.llm()
      const work = workOf(await outline(folder), llm, signal)
      // a fault a render found on this machine may have been mended since: the composing looks again
      deps.renderer?.forgetMachine()
      let written = 0
      let failed = 0
      progress?.(0, tied.length)
      for (const [i, placed] of tied.entries()) {
        const ended = await calls.run(() => composePlaced(deps, folder, work, placed))
        if (ended === "written") written++
        else if (ended === "failed") failed++
        if (!signal?.aborted) progress?.(i + 1, tied.length)
      }
      return { count: written, dropped: failed }
    },
  }
}

export type SoundActions = ReturnType<typeof createSoundActions>
