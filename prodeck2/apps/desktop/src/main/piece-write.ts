/*
 * The writing of one piece Claude writes and the app checks, whatever it is: a motion graphic's fragment, a sound's
 * code. It is asked for, linted, checked, and repaired once. What the piece is, how it is asked for, linted, checked
 * and repaired, and what is done with the answer are the caller's.
 */

export interface CheckedDeps {
  /** the first request, as it is asked and as the one repair carries it */
  first: string
  /** asks Claude with a request and answers the text it wrote; one that fails is the writing's failure */
  call: (request: string) => Promise<string>
  /** what the linter refuses in a text, one problem each; none when it passes */
  lint: (text: string) => string[]
  /**
   * What is wrong with a text the linter passed once it is run as it will be: its problems, one each; none when it
   * passes; null when this machine cannot check it now. One that throws ends the writing with what it threw.
   */
  check: (text: string) => Promise<string[] | null>
  /** the request of the one repair: the first request, the text and what is wrong with it */
  repair: (args: { brief: string; text: string; problems: string[] }) => string
  /** the stop of the run the writing is part of: it ends the writing wherever it has got to */
  signal?: AbortSignal
}

/** How a writing ended: with the text, or with why there is none. */
export type CheckedWritten = { text: string } | { failed: string }

/** What one call came to: a writing that has ended, or a text with what is wrong with it. */
type Attempt = CheckedWritten | { text: string; problems: string[] }

/** The most problems kept as the reason a writing failed, one a line. */
const PROBLEMS_KEPT = 3

/** What a failed call said: an error's message, or whatever was thrown as it reads. */
const messageOf = (error: unknown): string => (error instanceof Error && error.message !== "" ? error.message : String(error))

/**
 * What a check comes to, unless the stop comes first: then this rejects at once with the stop's reason. The check is
 * left to end by itself, since it cannot be called back; what it then answers, or fails with, goes unheard. Nothing
 * stays listening on the stop once either has happened: a run's stop outlives every writing made with it.
 */
function unlessStopped<T>(check: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return check
  return new Promise<T>((resolve, reject) => {
    const stopped = () => reject(signal.reason)
    if (signal.aborted) stopped()
    else signal.addEventListener("abort", stopped, { once: true })
    // the check's end is always taken here, so one that fails after the stop does not go unhandled; by then neither
    // of these changes anything
    check.then(resolve, reject).finally(() => signal.removeEventListener("abort", stopped))
  })
}

/**
 * Writes one piece: Claude writes it from the first request, the linter checks it, and one that passes is checked as
 * it will be run. A text with problems, the linter's or the check's, goes back to Claude once, with the first request
 * as it was asked, the problems and the text, and what comes back is checked the same way. There is one repair to a
 * writing, whatever it is spent on: a text still wrong after it is the writing's failure, said as the first few of its
 * problems, one a line. Where the check cannot be made (null), the text that passed the linter is the answer as it
 * is, and no repair is spent on it.
 *
 * A call that fails is the writing's failure too, said as the call said it, and nothing follows it.
 *
 * Only the stop is no failure. It ends the writing at once, wherever it has got to, and nothing is answered: a writing
 * that was stopped always rejects. No call is made once `signal` has aborted; a call it ends rejects with what that
 * call failed with; a check under way is waited for no longer, and the writing rejects with the stop's reason while
 * the check ends by itself in the background; and the stop is looked for again as soon as a call or a check has
 * ended, before anything is done with what it gave.
 */
export async function writeChecked(deps: CheckedDeps): Promise<CheckedWritten> {
  const attempt = async (request: string): Promise<Attempt> => {
    deps.signal?.throwIfAborted()
    let text: string
    try {
      text = await deps.call(request)
    } catch (error) {
      if (deps.signal?.aborted) throw error
      return { failed: messageOf(error) }
    }
    deps.signal?.throwIfAborted()
    const refused = deps.lint(text)
    if (refused.length > 0) return { text, problems: refused }
    // only what the linter passes is checked; with no check to be had it is kept as it is
    const found = await unlessStopped(deps.check(text), deps.signal)
    deps.signal?.throwIfAborted()
    return found === null || found.length === 0 ? { text } : { text, problems: found }
  }
  const first = await attempt(deps.first)
  if (!("problems" in first)) return first
  const repaired = await attempt(deps.repair({ brief: deps.first, text: first.text, problems: first.problems }))
  return "problems" in repaired ? { failed: repaired.problems.slice(0, PROBLEMS_KEPT).join("\n") } : repaired
}
