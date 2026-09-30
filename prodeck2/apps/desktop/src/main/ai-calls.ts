import type { LlmTransport } from "@boxblack/core/llm"

/** Longer than any answer the editing room waits for; then it is given up rather than left hanging. */
const TIMEOUT_MS = 10 * 60_000

/** What a call the user stopped fails with, so a job that keeps going past other failures still stops on this one. */
export const CANCELLED = "cancelled"

/**
 * The Claude calls the editing room makes — the emphasis points, the highlight text with its looks,
 * zooms and cutaways, graphics, sounds, polishing subtitles, describing pictures — all of which the user waits on: every one can be stopped from
 * the screen or by quitting the app, and none waits forever. A stopped call fails with
 * "cancelled", one that ran out of time with "timed out", so the screen can tell them apart.
 */
export function createAiCalls(options: { timeoutMs?: number } = {}) {
  let stop = new AbortController()
  return {
    /**
     * The connection one job uses for all its calls: a stop pressed at any point of the job — while
     * a call runs, or between two of them — ends it.
     */
    wrap(chosen: { transport: LlmTransport; model: string }): { transport: LlmTransport; model: string } {
      const inner = chosen.transport
      const stopped = stop.signal
      const transport: LlmTransport = {
        id: inner.id,
        async generate(request) {
          const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)
          const signal = AbortSignal.any([stopped, timeout, ...(request.signal ? [request.signal] : [])])
          try {
            return await inner.generate({ ...request, signal })
          } catch (error) {
            if (stopped.aborted) throw new Error(CANCELLED)
            if (timeout.aborted) throw new Error("timed out")
            // the caller's own stop (a plan run's) ended it: said as that stop says, whatever the transport threw
            // (the Anthropic SDK throws its own abort error); a reason that is no error reads as a stop
            if (request.signal?.aborted) throw request.signal.reason instanceof Error ? request.signal.reason : new Error(CANCELLED)
            throw error
          }
        },
      }
      return { transport, model: chosen.model }
    },

    /** Stops every call that is going; the next one starts afresh. */
    cancel(): void {
      stop.abort()
      stop = new AbortController()
    },

    /** The signal the next stop aborts: a job of several calls reads it when it starts, so a stop between two of its calls ends it too. */
    signal(): AbortSignal {
      return stop.signal
    },
  }
}

export type AiCalls = ReturnType<typeof createAiCalls>
