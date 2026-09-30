import { expect, test } from "vitest"
import { z } from "zod"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { CANCELLED, createAiCalls } from "./ai-calls.ts"

/** A Claude that answers only when told to, and stops when its request is aborted. */
function slowClaude() {
  const waiting: { request: LlmRequest<unknown>; answer: () => void }[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      return new Promise((resolve, reject) => {
        if (request.signal?.aborted) return reject(request.signal.reason)
        request.signal?.addEventListener("abort", () => reject(request.signal!.reason), { once: true })
        waiting.push({
          request: request as LlmRequest<unknown>,
          answer: () => resolve({ output: "ok" as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
        })
      })
    },
  }
  return { transport, waiting }
}

const ask = (transport: LlmTransport, signal?: AbortSignal) => transport.generate({ model: "m", system: "s", content: [], schema: z.string(), maxTokens: 10, signal })
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("stopping ends every call that is going, as cancelled, and a job asked for later goes through", async () => {
  const calls = createAiCalls()
  const claude = slowClaude()
  const { transport, model } = calls.wrap({ transport: claude.transport, model: "claude-sonnet-5" })
  expect(model).toBe("claude-sonnet-5")
  const first = ask(transport)
  const second = ask(transport)
  await tick()
  calls.cancel()
  await expect(first).rejects.toThrow(/^cancelled$/)
  await expect(second).rejects.toThrow(/^cancelled$/)

  const later = ask(calls.wrap({ transport: claude.transport, model: "claude-sonnet-5" }).transport)
  await tick()
  claude.waiting.at(-1)!.answer()
  expect((await later).output).toBe("ok")
})

test("a stop pressed between two calls of one job stops the job's next call too", async () => {
  // a job gets its connection once, then does other work (frames, the cut) between its calls
  const calls = createAiCalls()
  const claude = slowClaude()
  const { transport } = calls.wrap({ transport: claude.transport, model: "m" })
  calls.cancel()
  await expect(ask(transport)).rejects.toThrow(/^cancelled$/)
  expect(claude.waiting).toEqual([])
})

test("a call that takes longer than it ever should is given up, and says it ran out of time", async () => {
  const calls = createAiCalls({ timeoutMs: 20 })
  const claude = slowClaude()
  await expect(ask(calls.wrap({ transport: claude.transport, model: "m" }).transport)).rejects.toThrow(/^timed out$/)
})

test("a call's own signal still stops it, with its own reason", async () => {
  const calls = createAiCalls()
  const claude = slowClaude()
  const own = new AbortController()
  const call = ask(calls.wrap({ transport: claude.transport, model: "m" }).transport, own.signal)
  await tick()
  own.abort(new Error("the run was cancelled"))
  await expect(call).rejects.toThrow("the run was cancelled")
})

test("a call's own signal stops it as that signal says even when the transport throws its own abort error, as the Anthropic SDK does", async () => {
  // the SDK rejects an aborted request with its APIUserAbortError, not with the signal's reason
  const sdkLike: LlmTransport = {
    id: "anthropic-api",
    generate: (request) =>
      new Promise((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(new Error("Request was aborted.")), { once: true })
      }),
  }
  const calls = createAiCalls()
  const { transport } = calls.wrap({ transport: sdkLike, model: "m" })
  const own = new AbortController()
  const call = ask(transport, own.signal)
  await tick()
  own.abort(new Error(CANCELLED))
  await expect(call).rejects.toThrow(/^cancelled$/)
  // a reason that is no error reads as a stop
  const other = new AbortController()
  const second = ask(transport, other.signal)
  await tick()
  other.abort("the user left")
  await expect(second).rejects.toThrow(/^cancelled$/)
})

test("a call that fails for any other reason fails with that reason", async () => {
  const calls = createAiCalls()
  const broken: LlmTransport = {
    id: "claude-cli",
    generate: async () => {
      throw new Error("Claude declined this request")
    },
  }
  await expect(ask(calls.wrap({ transport: broken, model: "m" }).transport)).rejects.toThrow("Claude declined this request")
})

test("the signal read before a stop is aborted by it, and the one read after is not", () => {
  const calls = createAiCalls()
  const before = calls.signal()
  expect(before.aborted).toBe(false)
  calls.cancel()
  expect(before.aborted).toBe(true)
  expect(calls.signal().aborted).toBe(false)
})
