import { expect, test, vi } from "vitest"
import { writeChecked, type CheckedDeps } from "./piece-write.ts"

// The write loop with a toy writer: what is written is any text, the linter refuses one that says "BAD" (and one
// that says "WORSE" for four things), and the repair's request is spelt out so the test can read it back.

const FIRST = "write a chime"
const GOOD = "chime()"
const MENDED = "chime(soft)"
const BAD = "BAD()"
const WORSE = "WORSE()"

const lint = (text: string): string[] =>
  text.includes("WORSE") ? ["one", "two", "three", "four"] : text.includes("BAD") ? ["it says BAD"] : text === "" ? ["it is empty"] : []
const repair = ({ brief, text, problems }: { brief: string; text: string; problems: string[] }) => `${brief}\nproblems: ${problems.join(" | ")}\n${text}`

/** A writer that answers each call with the next of `answers`: the text, or the error the call fails with. */
function writer(answers: (string | Error)[]) {
  const requests: string[] = []
  const call = vi.fn(async (request: string) => {
    requests.push(request)
    const answer = answers[requests.length - 1]
    if (answer === undefined) throw new Error("asked once more than the test has answers for")
    if (answer instanceof Error) throw answer
    return answer
  })
  return { requests, call }
}

/** A check that answers each text it is handed with the next of `verdicts`, and passes any after they run out. */
const checkOf = (...verdicts: (string[] | null)[]) => {
  let n = 0
  return vi.fn(async (_text: string): Promise<string[] | null> => (n < verdicts.length ? (verdicts[n++] as string[] | null) : []))
}

const depsOf = (answers: (string | Error)[], check = checkOf([]), extra: Partial<CheckedDeps> = {}) => {
  const w = writer(answers)
  return { w, check, deps: { first: FIRST, call: w.call, lint, check, repair, ...extra } satisfies CheckedDeps }
}

test("a text that passes the linter and the check is the answer, after one call with the first request", async () => {
  const { w, check, deps } = depsOf([GOOD])
  expect(await writeChecked(deps)).toEqual({ text: GOOD })
  expect(w.requests).toEqual([FIRST])
  expect(check.mock.calls).toEqual([[GOOD]])
})

test("a text the linter refuses gets one repair, asked with the first request, the problems and the text; it is not checked", async () => {
  const { w, check, deps } = depsOf([BAD, MENDED])
  expect(await writeChecked(deps)).toEqual({ text: MENDED })
  expect(w.requests).toEqual([FIRST, repair({ brief: FIRST, text: BAD, problems: ["it says BAD"] })])
  expect(check.mock.calls).toEqual([[MENDED]])
})

test("a text the check fails gets the same one repair, and the repaired text is checked again", async () => {
  const { w, check, deps } = depsOf([GOOD, MENDED], checkOf(["too quiet"], []))
  expect(await writeChecked(deps)).toEqual({ text: MENDED })
  expect(w.requests[1]).toBe(repair({ brief: FIRST, text: GOOD, problems: ["too quiet"] }))
  expect(check.mock.calls).toEqual([[GOOD], [MENDED]])
})

test("still wrong after the repair, the writing fails with the last attempt's first three problems, one a line; there is never a third call", async () => {
  const checked = depsOf([GOOD, MENDED, GOOD], checkOf(["too quiet"], ["clicks at the start", "too long"]))
  expect(await writeChecked(checked.deps)).toEqual({ failed: "clicks at the start\ntoo long" })
  expect(checked.w.requests).toHaveLength(2)

  const linted = depsOf([GOOD, WORSE, GOOD], checkOf(["too quiet"]))
  expect(await writeChecked(linted.deps)).toEqual({ failed: "one\ntwo\nthree" })
  expect(linted.w.requests).toHaveLength(2)
  expect(linted.check.mock.calls).toEqual([[GOOD]])
})

test("where nothing can be checked (null), the text the linter passed is the answer, and no repair is spent", async () => {
  const { w, deps } = depsOf([GOOD, MENDED], checkOf(null))
  expect(await writeChecked(deps)).toEqual({ text: GOOD })
  expect(w.requests).toHaveLength(1)
  // the linter's own repair is still made
  const repaired = depsOf([BAD, MENDED, GOOD], checkOf(null))
  expect(await writeChecked(repaired.deps)).toEqual({ text: MENDED })
  expect(repaired.w.requests).toHaveLength(2)
})

test("a call that fails is the writing's failure as it said it, with no repair; what is thrown is said as it reads", async () => {
  const failing = depsOf([new Error("timed out"), GOOD])
  expect(await writeChecked(failing.deps)).toEqual({ failed: "timed out" })
  expect(failing.w.requests).toHaveLength(1)
  const repairFails = depsOf([BAD, new Error("Claude declined this request: no")])
  expect(await writeChecked(repairFails.deps)).toEqual({ failed: "Claude declined this request: no" })
  expect(await writeChecked({ first: FIRST, call: () => Promise.reject("no connection"), lint, check: checkOf([]), repair })).toEqual({ failed: "no connection" })
})

test("a stop rejects: before the first call with no call made, with the error of a call it ended, and at once while a check is under way", async () => {
  const reason = new Error("cancelled")
  const before = new AbortController()
  before.abort(reason)
  const unasked = depsOf([GOOD], checkOf([]), { signal: before.signal })
  await expect(writeChecked(unasked.deps)).rejects.toBe(reason)
  expect(unasked.w.requests).toHaveLength(0)

  const during = new AbortController()
  const ended = new Error("the call was cancelled")
  const call = async () => {
    during.abort(reason)
    throw ended
  }
  await expect(writeChecked({ first: FIRST, call, lint, check: checkOf([]), repair, signal: during.signal })).rejects.toBe(ended)

  const checking = new AbortController()
  let checks = 0
  const held = vi.fn((_text: string) => {
    checks++
    return new Promise<string[] | null>(() => {})
  })
  const outcome = writeChecked({ first: FIRST, call: async () => GOOD, lint, check: held, repair, signal: checking.signal }).then(
    () => "answered",
    (error: unknown) => error,
  )
  while (checks === 0) await new Promise((resolve) => setImmediate(resolve))
  checking.abort(reason)
  expect(await outcome).toBe(reason)
})

test("a check that throws ends the writing with what it threw", async () => {
  const { deps } = depsOf(
    [GOOD],
    vi.fn(async () => {
      throw new Error("the page could not start")
    }),
  )
  await expect(writeChecked(deps)).rejects.toThrow("the page could not start")
})
