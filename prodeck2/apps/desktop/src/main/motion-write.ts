import { lintFragment } from "@boxblack/core/graphics/motion/lint"
import { motionBrief, repairBrief, writeMotion } from "@boxblack/core/graphics/motion/write"
import type { MotionWord } from "@boxblack/core/graphics/plan"
import type { LlmTransport } from "@boxblack/core/llm"

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

/** What one call came to: a writing that has ended, or a fragment with what is wrong with it. */
type Attempt = Written | { html: string; problems: string[] }

/** The most problems kept as the reason a writing failed, one a line. */
const PROBLEMS_KEPT = 3
/** How many graphics are written at the same time. */
const AT_ONCE = 3

/** What a failed call said: an error's message, or whatever was thrown as it reads. */
const messageOf = (error: unknown): string => (error instanceof Error && error.message !== "" ? error.message : String(error))

/**
 * What a render comes to, unless the stop comes first: then this rejects at once with the stop's reason. The
 * render is left to end by itself, since it cannot be called back; what it then answers, or fails with, goes
 * unheard. Nothing stays listening on the stop once either has happened: a run's stop outlives every writing
 * made with it.
 */
function unlessStopped<T>(render: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return render
  return new Promise<T>((resolve, reject) => {
    const stopped = () => reject(signal.reason)
    if (signal.aborted) stopped()
    else signal.addEventListener("abort", stopped, { once: true })
    // the render's end is always taken here, so one that fails after the stop does not go unhandled; by then neither
    // of these changes anything
    render.then(resolve, reject).finally(() => signal.removeEventListener("abort", stopped))
  })
}

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
 * a render has ended, before anything is done with what it gave.
 */
export async function writePiece(piece: PieceToWrite, deps: WriteDeps, firstBrief?: string): Promise<Written> {
  const brief = firstBrief ?? motionBrief(piece)
  const attempt = async (request: string): Promise<Attempt> => {
    deps.signal?.throwIfAborted()
    let html: string
    try {
      html = await writeMotion({ transport: deps.transport, model: deps.model, brief: request, signal: deps.signal })
    } catch (error) {
      if (deps.signal?.aborted) throw error
      return { failed: messageOf(error) }
    }
    deps.signal?.throwIfAborted()
    const refused = lintFragment(html)
    if (refused.length > 0) return { html, problems: refused }
    // only what the linter passes is rendered; with no render to be had it is kept as it is
    const drawn = await unlessStopped(deps.render(html), deps.signal)
    deps.signal?.throwIfAborted()
    return drawn === null || drawn.length === 0 ? { html } : { html, problems: drawn }
  }
  const first = await attempt(brief)
  if (!("problems" in first)) return first
  const repaired = await attempt(repairBrief({ brief, html: first.html, problems: first.problems }))
  return "problems" in repaired ? { failed: repaired.problems.slice(0, PROBLEMS_KEPT).join("\n") } : repaired
}

/**
 * Runs `write` on every piece, three at a time at the most: the pieces are started in the order given, the next
 * as soon as one has settled, and after each settles `onProgress` is told how many have, of how many. A write
 * that fails does not stop the others, and neither does a report that throws: the pool goes on to its end, so
 * that nothing is still being written once this has settled, and then the first failure is thrown. With no piece
 * it does nothing and reports nothing.
 */
export async function writeAll<P>(pieces: P[], write: (piece: P) => Promise<void>, onProgress: (done: number, total: number) => void): Promise<void> {
  const failures: unknown[] = []
  let next = 0
  let done = 0
  /** One of the writers at work: it takes the next piece not yet taken until none is left. */
  const writer = async () => {
    while (next < pieces.length) {
      const piece = pieces[next++]!
      try {
        await write(piece)
      } catch (error) {
        failures.push(error)
      }
      try {
        onProgress(++done, pieces.length)
      } catch (error) {
        failures.push(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, pieces.length) }, writer))
  if (failures.length > 0) throw failures[0]
}
