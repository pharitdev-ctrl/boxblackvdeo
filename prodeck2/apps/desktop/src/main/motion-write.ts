import { lintFragment } from "@boxblack/core/graphics/motion/lint"
import { motionBrief, repairBrief, writeMotion } from "@boxblack/core/graphics/motion/write"
import type { MotionWord } from "@boxblack/core/graphics/plan"
import type { LlmTransport } from "@boxblack/core/llm"
import type { CallLimit } from "./call-limit.ts"
import { writeChecked } from "./piece-write.ts"

/*
 * The writing of motion graphics: one graphic through its writing, its checks and its one repair, and many of them
 * a few at a time. Nothing here knows of outlines, of where a graphic is placed or of the renderer: what a graphic
 * is written for, how a fragment is rendered and what is done with the answer are the caller's.
 */

/** What one graphic is written for: all that its brief says. */
export interface PieceToWrite {
  /** the stage it is drawn on, in pixels */
  stage: { width: number; height: number }
  /** how long it plays */
  seconds: number
  /** the words said while it plays, each with its seconds from the graphic's start */
  words: MotionWord[]
  /** what is drawn, as it was planned */
  idea: string
  /** what the clip is about, in one line */
  about: string
  /** on a free graphic: whether it shows in place of its point's highlight text, which it is then told, or beside the text of its moment */
  text?: { replaces: string } | { pairs: true }
  /** on a free graphic reaching below where the subtitles' room starts: where that is on its stage, in its own pixels */
  captionsFromPx?: number
}

export interface WriteDeps {
  transport: LlmTransport
  model: string
  /**
   * Renders the fragment as the piece would be rendered and says what is wrong with it: its problems, one each;
   * none when it renders and passes inspection; null when this machine cannot render now (no pack, a machine
   * fault, renders stopped).
   */
  render: (html: string) => Promise<string[] | null>
  /** the stop of the run the writing is part of: every call is made with it, and it ends the writing wherever it has got to */
  signal?: AbortSignal
}

/** How a writing ended: with the fragment, or with why there is none. */
export type Written = { html: string } | { failed: string }

/**
 * Writes one motion graphic: Claude writes the fragment from the piece's brief, or from `firstBrief` when one is
 * handed in (an edit's, which carries the fragment to change), the linter checks it, and one that passes is
 * rendered. A fragment with problems, the linter's or the render's, goes back to Claude once, with the first brief
 * as it was asked, the problems and the fragment, and what comes back is checked the same way. There is one repair to
 * a writing, whatever it is spent on: a fragment still wrong after it is the writing's failure, said as the first
 * few of its problems, one a line. On a machine that cannot render, the fragment that passed the linter is the
 * answer as it is, and no repair is spent on it.
 *
 * A call that fails is this graphic's failure too, said as the call said it, and nothing follows it: the reply hit
 * the token limit, Claude declined, Claude Code failed, the call ran out of time.
 *
 * Only the stop is no failure. It ends the writing at once, wherever it has got to, and nothing is answered: a
 * writing that was stopped always rejects. No call is made once `signal` has aborted; a call it ends rejects with
 * what that call failed with; a render under way is waited for no longer, and the writing rejects with the stop's
 * reason while the render ends by itself in the background; and the stop is looked for again as soon as a call or
 * a render has ended, before anything is done with what it gave. The loop is `writeChecked`'s, which the sounds'
 * writing shares.
 */
export async function writePiece(piece: PieceToWrite, deps: WriteDeps, firstBrief?: string): Promise<Written> {
  const written = await writeChecked({
    first: firstBrief ?? motionBrief(piece),
    call: (request) => writeMotion({ transport: deps.transport, model: deps.model, brief: request, signal: deps.signal }),
    lint: lintFragment,
    check: (html) => deps.render(html),
    repair: ({ brief, text, problems }) => repairBrief({ brief, html: text, problems }),
    signal: deps.signal,
  })
  return "text" in written ? { html: written.text } : written
}

/**
 * Runs `write` on every piece, as many at a time as `limit` lets, which another pool may be sharing: the pieces take
 * their turns in the order given, each as soon as a slot is free, and after each settles `onProgress` is told how
 * many have, of how many. A write that fails does not stop the others, and neither does a report that throws: the
 * pool goes on to its end, so that nothing is still being written once this has settled, and then the first failure
 * is thrown. With no piece it does nothing and reports nothing.
 */
export async function writeAll<P>(pieces: P[], write: (piece: P) => Promise<void>, onProgress: (done: number, total: number) => void, limit: CallLimit): Promise<void> {
  const failures: unknown[] = []
  let done = 0
  await Promise.all(
    pieces.map(async (piece) => {
      try {
        await limit.run(() => write(piece))
      } catch (error) {
        failures.push(error)
      }
      try {
        onProgress(++done, pieces.length)
      } catch (error) {
        failures.push(error)
      }
    }),
  )
  if (failures.length > 0) throw failures[0]
}
