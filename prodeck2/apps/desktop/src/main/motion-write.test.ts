import { expect, test, vi } from "vitest"
import { lintFragment } from "@boxblack/core/graphics/motion/lint"
import { editBrief, MOTION_CONTRACT, motionBrief, repairBrief } from "@boxblack/core/graphics/motion/write"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { writeAll, writePiece, type PieceToWrite } from "./motion-write.ts"

/** What one graphic is written for: its stage, its length, the words said while it plays, its idea and the clip's subject. */
const PIECE: PieceToWrite = {
  stage: { width: 864, height: 288 },
  seconds: 1.7,
  words: [
    { text: "อวกาศ", atS: 0 },
    { text: "ใน", atS: 0.92 },
  ],
  idea: "จรวดพุ่งขึ้นจากขอบล่างพอดีคำว่า “อวกาศ”",
  about: "นักบินอวกาศ: เล่าว่าขึ้นไปอย่างไร (review)",
}

/** A fragment the linter passes. */
const GOOD = '<style>.n{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="n">3 2 1</div>'
/** Another one, so a repaired fragment can be told from the first. */
const MENDED = '<style>.m{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="m">อวกาศ</div>'
/** One the linter refuses for one thing: a timer. */
const TIMER = `${GOOD}<script>setTimeout(() => {}, 10)</script>`
/** One it refuses for more than three things. */
const MANY = '<style>.n{color:red}</style><img src="x.png"><div class="n">3</div><script>setTimeout(() => {}, 10); fetch("a"); eval("1"); localStorage.a = 1</script>'

/** A stand-in for Claude that answers each call with the next of `answers`: what it wrote, or the error the call fails with. */
function fakeClaude(answers: (string | Error)[]) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const answer = answers[requests.length - 1]
      if (answer === undefined) throw new Error("Claude was asked once more than the test has answers for")
      if (answer instanceof Error) throw answer
      return { output: answer as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { requests, deps: { transport, model: "claude-sonnet-5" } }
}

/** The request text of a call: its brief. */
const briefOf = (request: LlmRequest<unknown>) => request.content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join("\n")

/** A render that answers each fragment it is handed with the next of `verdicts`, null among them as it is, and passes any fragment after they run out. */
const renderOf = (...verdicts: (string[] | null)[]) => {
  let n = 0
  return vi.fn(async (_html: string): Promise<string[] | null> => (n < verdicts.length ? (verdicts[n++] as string[] | null) : []))
}

test("a fragment that passes the linter and the render is the answer, after one call made with the contract, the piece's brief and the stop", async () => {
  const claude = fakeClaude([GOOD])
  const render = renderOf([])
  const stop = new AbortController()
  expect(await writePiece(PIECE, { ...claude.deps, render, signal: stop.signal })).toEqual({ html: GOOD })
  expect(claude.requests).toHaveLength(1)
  expect(claude.requests[0]).toMatchObject({ model: "claude-sonnet-5", system: MOTION_CONTRACT, signal: stop.signal })
  expect(briefOf(claude.requests[0]!)).toBe(motionBrief(PIECE))
  expect(render.mock.calls).toEqual([[GOOD]])
})

test("a fragment the linter refuses gets one repair, asked with the first brief, the problems and the fragment; what comes back is checked again and is the answer when it passes", async () => {
  const claude = fakeClaude([TIMER, MENDED])
  const render = renderOf([])
  expect(await writePiece(PIECE, { ...claude.deps, render })).toEqual({ html: MENDED })
  expect(claude.requests).toHaveLength(2)
  const repair = briefOf(claude.requests[1]!)
  expect(repair).toBe(repairBrief({ brief: motionBrief(PIECE), html: TIMER, problems: lintFragment(TIMER) }))
  // the first brief as it was, then the linter's problem on a line of its own, then the fragment it was found in
  expect(repair.startsWith(`${motionBrief(PIECE)}\n`)).toBe(true)
  expect(repair).toContain("\n- uses `setTimeout`: ")
  expect(repair.endsWith(`\n${TIMER}`)).toBe(true)
  expect(claude.requests[1]).toMatchObject({ model: "claude-sonnet-5", system: MOTION_CONTRACT })
  // what the linter refused was never rendered
  expect(render.mock.calls).toEqual([[MENDED]])
})

test("a first brief handed in, as an edit's is, is the first request as it is, and the one repair carries it as the first brief", async () => {
  const brief = editBrief({ brief: motionBrief(PIECE), html: GOOD, instruction: "ตัวเลขใหญ่ขึ้น" })
  // the repair spent on the linter
  const linted = fakeClaude([TIMER, MENDED])
  expect(await writePiece(PIECE, { ...linted.deps, render: renderOf([]) }, brief)).toEqual({ html: MENDED })
  expect(briefOf(linted.requests[0]!)).toBe(brief)
  expect(linted.requests[0]).toMatchObject({ system: MOTION_CONTRACT })
  const repair = briefOf(linted.requests[1]!)
  expect(repair).toBe(repairBrief({ brief, html: TIMER, problems: lintFragment(TIMER) }))
  expect(repair.startsWith(`${brief}\n\nYou wrote the fragment below for this brief. It was rendered, and it has these problems:\n`)).toBe(true)
  // the repair spent on the render
  const rendered = fakeClaude([GOOD, MENDED])
  expect(await writePiece(PIECE, { ...rendered.deps, render: renderOf(["nothing was drawn: every frame is empty"], []) }, brief)).toEqual({ html: MENDED })
  expect(briefOf(rendered.requests[0]!)).toBe(brief)
  expect(briefOf(rendered.requests[1]!)).toBe(repairBrief({ brief, html: GOOD, problems: ["nothing was drawn: every frame is empty"] }))
  // with none handed in, the first brief is the piece's own, as it always was
  const plain = fakeClaude([TIMER, MENDED])
  await writePiece(PIECE, { ...plain.deps, render: renderOf([]) }, undefined)
  expect(plain.requests.map(briefOf)).toEqual([motionBrief(PIECE), repairBrief({ brief: motionBrief(PIECE), html: TIMER, problems: lintFragment(TIMER) })])
})

test("an empty answer is a problem of the linter's like any other, and gets the repair", async () => {
  const claude = fakeClaude(["", GOOD])
  expect(await writePiece(PIECE, { ...claude.deps, render: renderOf([]) })).toEqual({ html: GOOD })
  expect(briefOf(claude.requests[1]!)).toContain("\n- the fragment is empty: ")
})

test("a fragment the render fails gets the same one repair, each problem on a line of its own, and the repaired one is rendered again", async () => {
  const claude = fakeClaude([GOOD, MENDED])
  const problems = ["window.frame threw: needle is not defined", '<g class="icon"> has a transform attribute and an animation of its transform']
  const render = renderOf(problems, [])
  expect(await writePiece(PIECE, { ...claude.deps, render })).toEqual({ html: MENDED })
  expect(claude.requests).toHaveLength(2)
  const repair = briefOf(claude.requests[1]!)
  expect(repair).toBe(repairBrief({ brief: motionBrief(PIECE), html: GOOD, problems }))
  expect(repair).toContain('\n- window.frame threw: needle is not defined\n- <g class="icon"> has a transform attribute and an animation of its transform\n')
  expect(render.mock.calls).toEqual([[GOOD], [MENDED]])
})

test("nothing drawn is a render's failure like any other: one repair, and the repaired fragment is the answer", async () => {
  const claude = fakeClaude([GOOD, MENDED])
  expect(await writePiece(PIECE, { ...claude.deps, render: renderOf(["nothing was drawn: every frame is empty"], []) })).toEqual({ html: MENDED })
  expect(briefOf(claude.requests[1]!)).toContain("\n- nothing was drawn: every frame is empty\n")
})

test("still failing after the repair, the writing has failed with the last attempt's problems, the first three, one a line; there is never a third call", async () => {
  // the repair was spent on the render, and the render fails again
  const twice = fakeClaude([GOOD, MENDED, GOOD])
  const render = renderOf(["nothing was drawn: every frame is empty"], ["it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D"])
  expect(await writePiece(PIECE, { ...twice.deps, render })).toEqual({ failed: "it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D" })
  expect(twice.requests).toHaveLength(2)
  expect(render).toHaveBeenCalledTimes(2)

  // the repair was spent on the linter, and the render fails what came back: no repair is left for it
  const linted = fakeClaude([TIMER, GOOD, GOOD])
  expect(await writePiece(PIECE, { ...linted.deps, render: renderOf(["the script failed: Unexpected token ';'", "and the page never became ready"]) })).toEqual({
    failed: "the script failed: Unexpected token ';'\nand the page never became ready",
  })
  expect(linted.requests).toHaveLength(2)

  // the repair was spent on the render, and the linter refuses what came back, for more than three things
  const refused = fakeClaude([GOOD, MANY, GOOD])
  const rendered = renderOf(["nothing was drawn: every frame is empty"])
  const found = lintFragment(MANY)
  expect(found.length).toBeGreaterThan(3)
  expect(await writePiece(PIECE, { ...refused.deps, render: rendered })).toEqual({ failed: found.slice(0, 3).join("\n") })
  expect(refused.requests).toHaveLength(2)
  // refused by the linter, the repaired fragment was not rendered
  expect(rendered.mock.calls).toEqual([[GOOD]])
})

test("on a machine that cannot render, the fragment that passed the linter is the answer, unrendered, and no repair is spent", async () => {
  const claude = fakeClaude([GOOD, MENDED])
  const render = renderOf(null)
  expect(await writePiece(PIECE, { ...claude.deps, render })).toEqual({ html: GOOD })
  expect(claude.requests).toHaveLength(1)
  expect(render.mock.calls).toEqual([[GOOD]])

  // the linter's own repair is still made, and what it gives is kept the same way
  const repaired = fakeClaude([TIMER, MENDED, GOOD])
  expect(await writePiece(PIECE, { ...repaired.deps, render: renderOf(null) })).toEqual({ html: MENDED })
  expect(repaired.requests).toHaveLength(2)
})

/**
 * A stand-in for Claude on which the user presses stop: it answers `answers`, then the call after them is the one
 * the stop (the signal of `stop`) ends, which fails with `cancelled` as a stopped call does.
 */
function stoppedClaude(answers: string[], stop: AbortController, cancelled: Error) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const answer = answers[requests.length - 1]
      if (answer !== undefined) return { output: answer as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
      stop.abort(new Error("the user pressed stop"))
      throw cancelled
    },
  }
  return { requests, deps: { transport, model: "claude-sonnet-5" } }
}

test("a stop rejects with the error the call failed with, and nothing is answered: during the writing, and during the repair", async () => {
  const cancelled = new Error("cancelled")
  const render = renderOf([])
  const stop = new AbortController()
  const writing = stoppedClaude([], stop, cancelled)
  await expect(writePiece(PIECE, { ...writing.deps, render, signal: stop.signal })).rejects.toBe(cancelled)
  expect(writing.requests).toHaveLength(1)

  const again = new AbortController()
  const repairing = stoppedClaude([TIMER], again, cancelled)
  await expect(writePiece(PIECE, { ...repairing.deps, render, signal: again.signal })).rejects.toBe(cancelled)
  expect(repairing.requests).toHaveLength(2)
  expect(render).not.toHaveBeenCalled()
})

/** Lets what is waiting on a settled promise run. */
const settled = () => new Promise((resolve) => setImmediate(resolve))

/** A render that is held open until the test ends it, with an answer or with a failure. */
function heldRender() {
  let end!: { answer: (verdict: string[] | null) => void; fail: (error: Error) => void }
  const render = vi.fn((_html: string) => new Promise<string[] | null>((resolve, reject) => (end = { answer: resolve, fail: reject })))
  return { render, answer: (verdict: string[] | null) => end.answer(verdict), fail: (error: Error) => end.fail(error) }
}

test("a stop while a fragment is being rendered ends the writing at once, with the stop's reason; the render is left to end by itself, and whatever comes of it, no call follows", async () => {
  for (const late of [[], ["nothing was drawn: every frame is empty"], null, new Error("the draft cannot be read")]) {
    const claude = fakeClaude([GOOD, MENDED])
    const held = heldRender()
    const stop = new AbortController()
    const reason = new Error("cancelled")
    const outcome = writePiece(PIECE, { ...claude.deps, render: held.render, signal: stop.signal }).then(
      () => "answered",
      (error: unknown) => error,
    )
    // Claude has answered and the fragment's render is under way
    await settled()
    expect(held.render).toHaveBeenCalledTimes(1)
    stop.abort(reason)
    expect(await outcome).toBe(reason)
    // the render ends after the stop: passing, failing, unable to render, or thrown
    if (late instanceof Error) held.fail(late)
    else held.answer(late)
    await settled()
    expect(claude.requests).toHaveLength(1)
    expect(held.render).toHaveBeenCalledTimes(1)
  }
})

test("a stop during the render of a repaired fragment ends the writing the same way, and a stop pressed before the writing begins rejects with no call made", async () => {
  const reason = new Error("cancelled")
  // the first fragment fails its render, the repair's render is under way when the stop comes
  const claude = fakeClaude([GOOD, MENDED, GOOD])
  const stop = new AbortController()
  let renders = 0
  const render = vi.fn((_html: string) => (++renders === 1 ? Promise.resolve(["nothing was drawn: every frame is empty"]) : new Promise<string[] | null>(() => {})))
  const outcome = writePiece(PIECE, { ...claude.deps, render, signal: stop.signal }).then(
    () => "answered",
    (error: unknown) => error,
  )
  while (renders < 2) await settled()
  stop.abort(reason)
  expect(await outcome).toBe(reason)
  expect(claude.requests).toHaveLength(2)

  const never = fakeClaude([GOOD])
  const before = new AbortController()
  before.abort(reason)
  const unasked = renderOf([])
  await expect(writePiece(PIECE, { ...never.deps, render: unasked, signal: before.signal })).rejects.toBe(reason)
  expect(never.requests).toHaveLength(0)
  expect(unasked).not.toHaveBeenCalled()
})

test("a stop is seen as soon as a call or a render has ended, before anything is done with what it gave", async () => {
  const reason = new Error("cancelled")
  // Claude answers although the stop was pressed while it wrote: the fragment is neither checked nor rendered
  const stop = new AbortController()
  const answering: LlmTransport = {
    id: "claude-cli",
    async generate<T>(): Promise<LlmResponse<T>> {
      stop.abort(reason)
      return { output: GOOD as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  const unasked = renderOf([])
  await expect(writePiece(PIECE, { transport: answering, model: "claude-sonnet-5", render: unasked, signal: stop.signal })).rejects.toBe(reason)
  expect(unasked).not.toHaveBeenCalled()

  // the stop comes in the very turn the render's answer is taken, after the answer and before it is used: the fragment
  // passed, and is not the answer all the same
  const claude = fakeClaude([GOOD])
  const late = new AbortController()
  const render = vi.fn((_html: string) => {
    const passed = Promise.resolve<string[] | null>([])
    // put on the render's answer after the writing has put its own wait on it, so it runs right after that one
    queueMicrotask(() => void passed.then(() => late.abort(reason)))
    return passed
  })
  await expect(writePiece(PIECE, { ...claude.deps, render, signal: late.signal })).rejects.toBe(reason)
  expect(claude.requests).toHaveLength(1)
})

/** A stop whose listeners are counted as they are put on and taken off; one that has fired is not taken off, and is not looked at here. */
function watchedStop() {
  const controller = new AbortController()
  const { signal } = controller
  const listening = new Set<unknown>()
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  signal.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
    if (type === "abort") listening.add(listener)
    add(type, listener, options)
  }) as typeof signal.addEventListener
  signal.removeEventListener = ((type: string, listener: EventListener) => {
    if (type === "abort") listening.delete(listener)
    remove(type, listener)
  }) as typeof signal.removeEventListener
  return { signal, listening }
}

test("nothing is left listening on the stop once a writing has ended: a run's stop outlives every writing made with it", async () => {
  // written, its render failed, repaired and rendered again
  const twice = watchedStop()
  const claude = fakeClaude([GOOD, MENDED])
  expect(await writePiece(PIECE, { ...claude.deps, render: renderOf(["nothing was drawn: every frame is empty"], []), signal: twice.signal })).toEqual({ html: MENDED })
  expect(twice.listening.size).toBe(0)
  // a render that threw
  const thrown = watchedStop()
  const failing = vi.fn(async (_html: string): Promise<string[] | null> => {
    throw new Error("the draft cannot be read")
  })
  await expect(writePiece(PIECE, { ...fakeClaude([GOOD]).deps, render: failing, signal: thrown.signal })).rejects.toThrow("the draft cannot be read")
  expect(thrown.listening.size).toBe(0)
  // while a render is under way the writing does listen, or the stop could not end it
  const during = watchedStop()
  const held = heldRender()
  const writing = writePiece(PIECE, { ...fakeClaude([GOOD]).deps, render: held.render, signal: during.signal })
  await settled()
  expect(during.listening.size).toBe(1)
  held.answer([])
  expect(await writing).toEqual({ html: GOOD })
  expect(during.listening.size).toBe(0)
})

test("a call that fails for any other reason is the piece's failure, said as the call said it, and no repair is made", async () => {
  for (const reason of ["Claude declined this request: no", "timed out", "Claude Code failed: API Error: the response hit the output token limit"]) {
    const claude = fakeClaude([new Error(reason), GOOD])
    const render = renderOf([])
    expect(await writePiece(PIECE, { ...claude.deps, render, signal: new AbortController().signal }), reason).toEqual({ failed: reason })
    expect(claude.requests).toHaveLength(1)
    expect(render).not.toHaveBeenCalled()
  }
  // the repair call failing is the failure too, and nothing follows it
  const repair = fakeClaude([TIMER, new Error("timed out"), GOOD])
  expect(await writePiece(PIECE, { ...repair.deps, render: renderOf([]) })).toEqual({ failed: "timed out" })
  expect(repair.requests).toHaveLength(2)
  // what is thrown is said as it reads, whatever it is
  const odd: LlmTransport = { id: "claude-cli", generate: () => Promise.reject("no connection") }
  expect(await writePiece(PIECE, { transport: odd, model: "claude-sonnet-5", render: renderOf([]) })).toEqual({ failed: "no connection" })
})

/** Writes that are held until the test lets each go or fails it, and how many ran at once at the most. */
function heldWrites() {
  const gates = new Map<number, { pass: () => void; fail: (error: Error) => void }>()
  const started: number[] = []
  const state = { running: 0, most: 0 }
  const write = (piece: number) =>
    new Promise<void>((resolve, reject) => {
      started.push(piece)
      state.most = Math.max(state.most, ++state.running)
      gates.set(piece, {
        pass: () => {
          state.running--
          resolve()
        },
        fail: (error) => {
          state.running--
          reject(error)
        },
      })
    })
  return { gates, started, state, write }
}

test("the pieces are written three at a time at the most, the next one started as one settles, and how many have settled is reported after each", async () => {
  const { gates, started, state, write } = heldWrites()
  const progress: [number, number][] = []
  let over = false
  const all = writeAll([1, 2, 3, 4, 5, 6, 7], write, (done, total) => progress.push([done, total])).then(() => (over = true))
  await settled()
  expect(started).toEqual([1, 2, 3])
  expect(progress).toEqual([])
  gates.get(2)!.pass()
  await settled()
  expect(started).toEqual([1, 2, 3, 4])
  expect(progress).toEqual([[1, 7]])
  gates.get(1)!.pass()
  gates.get(4)!.pass()
  await settled()
  expect(started).toEqual([1, 2, 3, 4, 5, 6])
  for (const piece of [3, 5, 6]) gates.get(piece)!.pass()
  await settled()
  expect(started).toEqual([1, 2, 3, 4, 5, 6, 7])
  expect(over).toBe(false)
  gates.get(7)!.pass()
  await all
  expect(progress).toEqual([[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]])
  expect(state.most).toBe(3)
})

test("with fewer than three pieces all are written at once, and with none nothing is written or reported", async () => {
  const { gates, started, state, write } = heldWrites()
  const progress: [number, number][] = []
  const two = writeAll([1, 2], write, (done, total) => progress.push([done, total]))
  await settled()
  expect(started).toEqual([1, 2])
  gates.get(1)!.pass()
  gates.get(2)!.pass()
  await two
  expect([state.most, progress]).toEqual([2, [[1, 2], [2, 2]]])

  const report = vi.fn()
  const never = vi.fn(async () => {})
  await writeAll([], never, report)
  expect(never).not.toHaveBeenCalled()
  expect(report).not.toHaveBeenCalled()
})

test("a write that fails does not stop the others: every piece is still written and counted, and the failure is thrown once all have settled", async () => {
  const { gates, started, write } = heldWrites()
  const progress: [number, number][] = []
  const outcome: { error?: unknown } = {}
  const all = writeAll([1, 2, 3, 4, 5], write, (done, total) => progress.push([done, total])).catch((error: unknown) => (outcome.error = error))
  await settled()
  const broken = new Error("the outline could not be written")
  gates.get(1)!.fail(broken)
  await settled()
  // the one that failed is counted as settled, and the next is started in its place
  expect(progress).toEqual([[1, 5]])
  expect(started).toEqual([1, 2, 3, 4])
  // a second failure: the first is the one thrown
  gates.get(2)!.fail(new Error("another failure"))
  gates.get(3)!.pass()
  await settled()
  expect(started).toEqual([1, 2, 3, 4, 5])
  expect(outcome).toEqual({})
  gates.get(4)!.pass()
  gates.get(5)!.pass()
  await all
  expect(outcome.error).toBe(broken)
  expect(progress).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]])
})

test("a reporter that throws does not end the pool early: every piece is still written and reported, and the failure is thrown once all have settled", async () => {
  const { gates, started, write } = heldWrites()
  const broken = new Error("the screen could not be told")
  const progress: [number, number][] = []
  const outcome: { error?: unknown } = {}
  const all = writeAll([1, 2, 3, 4, 5], write, (done, total) => {
    progress.push([done, total])
    if (done === 1) throw broken
  }).catch((error: unknown) => (outcome.error = error))
  await settled()
  gates.get(1)!.pass()
  await settled()
  // the first report threw: the writer that made it takes the next piece all the same, and nothing is thrown yet
  expect(started).toEqual([1, 2, 3, 4])
  expect(outcome).toEqual({})
  for (const piece of [2, 3, 4]) gates.get(piece)!.pass()
  await settled()
  expect(started).toEqual([1, 2, 3, 4, 5])
  expect(outcome).toEqual({})
  gates.get(5)!.pass()
  await all
  expect(outcome.error).toBe(broken)
  expect(progress).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]])
})
