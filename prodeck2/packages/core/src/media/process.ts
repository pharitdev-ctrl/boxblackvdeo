import { spawn } from "node:child_process"
import { basename } from "node:path"
import { StringDecoder } from "node:string_decoder"

/** Enough of stderr to explain a failure, without holding hours of progress output. */
const STDERR_KEEP = 64_000

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError")
}

export class ProcessError extends Error {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string

  constructor(command: string, code: number | null, stdout: string, stderr: string) {
    super(`${basename(command)} exited with code ${code}: ${stderr.trim().slice(-800)}`)
    this.name = "ProcessError"
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

/** Runs a tool to completion. Rejects with the tail of stderr on a non-zero exit; stops it on abort. */
export function runProcess(
  command: string,
  args: string[],
  options: {
    signal?: AbortSignal
    onStderr?: (chunk: string) => void
    /** takes stdout as it arrives, for binary or very long output; `stdout` in the result is then empty */
    onStdout?: (chunk: Buffer) => void
    stdin?: string
    cwd?: string
    /** the whole environment of the child; the app's own when absent */
    env?: NodeJS.ProcessEnv
    /** on abort, ask with SIGTERM and only SIGKILL after this many ms; SIGKILL at once when absent */
    stopGraceMs?: number
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { signal, onStderr } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal))

    // arguments go straight to the tool, never through a shell
    const child = spawn(command, args, {
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      cwd: options.cwd,
      env: options.env,
    })
    if (options.stdin !== undefined) {
      // a tool may exit before reading all of its input; that is not a failure in itself
      child.stdin!.on("error", () => {})
      child.stdin!.end(options.stdin)
    }
    let stdout = ""
    let stderr = ""
    // a read can end in the middle of a character: the decoders hold those bytes for the next one
    const outText = new StringDecoder("utf8")
    const errText = new StringDecoder("utf8")
    child.stdout!.on("data", (chunk: Buffer) => {
      if (options.onStdout) options.onStdout(chunk)
      else stdout += outText.write(chunk)
    })
    child.stderr!.on("data", (chunk: Buffer) => {
      const text = errText.write(chunk)
      stderr = (stderr + text).slice(-STDERR_KEEP)
      onStderr?.(text)
    })

    let grace: NodeJS.Timeout | undefined
    // a tool that cleans up after itself (HyperFrames closes its Chrome) gets the chance to, but not forever
    const kill = () => {
      if (options.stopGraceMs === undefined) return void child.kill("SIGKILL")
      child.kill("SIGTERM")
      grace = setTimeout(() => child.kill("SIGKILL"), options.stopGraceMs)
    }
    signal?.addEventListener("abort", kill, { once: true })

    child.on("error", (error) => {
      signal?.removeEventListener("abort", kill)
      clearTimeout(grace)
      reject(error)
    })
    child.on("close", (code) => {
      signal?.removeEventListener("abort", kill)
      clearTimeout(grace)
      stdout += outText.end()
      stderr += errText.end()
      if (signal?.aborted) reject(abortReason(signal))
      else if (code === 0) resolve({ stdout, stderr })
      else reject(new ProcessError(command, code, stdout, stderr))
    })
  })
}
