import { expect, test } from "vitest"
import { ProcessError, runProcess } from "./process.ts"

test("runProcess returns what the tool printed", async () => {
  expect((await runProcess("/bin/echo", ["hello"])).stdout).toBe("hello\n")
})

test("runProcess feeds text to the tool's standard input", async () => {
  expect((await runProcess("/bin/cat", [], { stdin: "เสียง\nline two" })).stdout).toBe("เสียง\nline two")
})

test("runProcess runs the tool in the given working directory", async () => {
  expect((await runProcess("/bin/pwd", [], { cwd: "/tmp" })).stdout.trim()).toMatch(/\/tmp$/)
})

test("runProcess reports a non-zero exit with the end of stderr", async () => {
  await expect(runProcess("/bin/sh", ["-c", "echo broken >&2; exit 3"])).rejects.toThrow(/code 3: broken/)
})

test("a failed run still hands back what the tool printed", async () => {
  const failure = await runProcess("/bin/sh", ["-c", "echo partial; exit 2"]).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(ProcessError)
  expect((failure as ProcessError).stdout).toBe("partial\n")
  expect((failure as ProcessError).code).toBe(2)
})

test("text cut between two reads in the middle of a character comes back whole", async () => {
  // "ก" is three bytes; the tool writes two of them, and the last one a moment later, on each stream
  const script = `
    process.stdout.write(Buffer.from([0xe0, 0xb8]))
    process.stderr.write(Buffer.from([0xe0, 0xb8]))
    setTimeout(() => { process.stdout.write(Buffer.from([0x81])); process.stderr.write(Buffer.from([0x81])) }, 30)
  `
  expect(await runProcess(process.execPath, ["-e", script])).toEqual({ stdout: "ก", stderr: "ก" })
})

test("runProcess can stream binary output instead of collecting it as text", async () => {
  const chunks: Buffer[] = []
  const result = await runProcess("/bin/sh", ["-c", "printf '\\001\\377\\000'"], { onStdout: (chunk) => chunks.push(chunk) })
  expect([...Buffer.concat(chunks)]).toEqual([1, 255, 0])
  expect(result.stdout).toBe("")
})

test("runs the tool with the environment it is given, and nothing else", async () => {
  const { stdout } = await runProcess("/bin/sh", ["-c", "echo $BOXBLACK_TEST; echo ${HOME:-nohome}"], { env: { BOXBLACK_TEST: "yes" } })
  expect(stdout.trim().split("\n")).toEqual(["yes", "nohome"])
})

/** Runs a shell that traps TERM as `trap`, and aborts it with `reason` once it says it is ready. */
async function stopped(trap: string, stopGraceMs: number, reason: Error) {
  const controller = new AbortController()
  let out = ""
  let abortedAt = 0
  const settled = await runProcess("/bin/sh", ["-c", `trap ${trap} TERM; echo ready; while :; do sleep 0.05; done`], {
    signal: controller.signal,
    stopGraceMs,
    onStdout: (chunk) => {
      out += chunk.toString()
      if (out.includes("ready") && !abortedAt) {
        abortedAt = Date.now()
        controller.abort(reason)
      }
    },
  }).then(
    () => ({ rejected: null }),
    (error: unknown) => ({ rejected: error }),
  )
  return { ...settled, out, ms: Date.now() - abortedAt }
}

test("with a stop grace, an abort asks the tool to stop with SIGTERM and rejects with the abort's reason once it has", async () => {
  const reason = new Error("cancelled")
  const { rejected, out, ms } = await stopped(`'echo bye; exit 0'`, 2000, reason)
  expect(rejected).toBe(reason)
  expect(out).toContain("bye")
  // it stopped on its own, well before the grace ran out
  expect(ms).toBeLessThan(1500)
})

test("with a stop grace, a tool that ignores SIGTERM is killed once the grace is over", async () => {
  const reason = new Error("cancelled")
  const { rejected, out, ms } = await stopped(`''`, 200, reason)
  expect(rejected).toBe(reason)
  expect(out).not.toContain("bye")
  expect(ms).toBeGreaterThanOrEqual(200)
  expect(ms).toBeLessThan(1500)
})
