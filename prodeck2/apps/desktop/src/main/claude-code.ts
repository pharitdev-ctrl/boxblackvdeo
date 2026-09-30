import { spawn } from "node:child_process"
import type { EventEmitter } from "node:events"
import type { Readable, Writable } from "node:stream"
import type { AppEvent, ClaudeCodeStatus } from "../shared/api.ts"

/** Anthropic's own installer for macOS: no admin rights, everything under the user's home (~/.local/bin/claude). */
export const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash"
/** With pipefail, a download that fails fails the install; without it bash runs nothing and exits 0. */
const INSTALL_ARGS = ["-o", "pipefail", "-c", INSTALL_COMMAND]

/** Only a sign-in page of Claude's is ever opened from the app, whatever Claude Code prints. */
const CLAUDE_PAGE = /^https:\/\/(claude\.com|claude\.ai|platform\.claude\.com)\/\S*$/
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g
/** Longer than any real install or sign-in; then the attempt is given up rather than left hanging. */
const TIMEOUT_MS = 15 * 60_000

/**
 * Reads `claude auth status --json` (Claude Code 2.1.276): whether it is signed in and on which
 * plan. The email and organisation it also prints are left where they are.
 */
export function parseAuthStatus(stdout: string): { loggedIn: boolean; subscription: string | null } | null {
  try {
    const status = JSON.parse(stdout) as { loggedIn?: unknown; subscriptionType?: unknown }
    if (typeof status.loggedIn !== "boolean") return null
    return { loggedIn: status.loggedIn, subscription: typeof status.subscriptionType === "string" ? status.subscriptionType : null }
  } catch {
    return null
  }
}

export interface ClaudeChild extends EventEmitter {
  pid?: number
  stdout: Readable
  stderr: Readable
  stdin: Writable
  kill(): boolean
}

/**
 * Starts a program in a process group of its own, so that stopping it stops everything it
 * started: the installer is a pipeline that runs `claude install` under it, and a kill that only
 * reaches the shell leaves the rest going, with the pipes — and the busy state — open.
 */
export function spawnGroup(command: string, args: string[]): ClaudeChild {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], detached: true })
  const kill = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL")
    } catch {
      // already gone
    }
    return true
  }
  return Object.assign(child, { kill }) as unknown as ClaudeChild
}

export interface ClaudeCodeDeps {
  /** the major version of macOS; Claude Code needs 13 or later */
  macosMajor: number
  /** where the tool search found Claude Code, or null */
  claudePath: () => string | null
  version: () => Promise<string | null>
  /** looks for the tools again, after an install */
  rescan: () => Promise<void>
  /** `claude auth status --json`, or null when it could not be asked */
  askStatus: (path: string) => Promise<{ loggedIn: boolean; subscription: string | null } | null>
  spawn: (command: string, args: string[]) => ClaudeChild
  openExternal: (url: string) => Promise<void>
  send: (event: AppEvent) => void
  /** how long an install or sign-in may take before it is given up; 15 minutes unless a test says otherwise */
  timeoutMs?: number
}

/**
 * Installs Claude Code and signs it in without the customer opening a terminal: the install is
 * Anthropic's own script, and the sign-in is `claude auth login`, which opens the browser and
 * keeps the login in Claude Code's own Keychain entry — the app never holds a token.
 */
export function createClaudeCode(deps: ClaudeCodeDeps) {
  const supported = deps.macosMajor >= 13
  let busy: ClaudeCodeStatus["busy"] = null
  let running: ClaudeChild | null = null
  let cancelled = false
  let loginPage: string | null = null

  async function status(): Promise<ClaudeCodeStatus> {
    const path = deps.claudePath()
    const [version, account] = path ? await Promise.all([deps.version(), deps.askStatus(path)]) : [null, null]
    return { supported, path, version, account, busy }
  }

  async function announce(extra: { progress?: string; error?: string } = {}): Promise<void> {
    deps.send({ type: "claude-code", status: await status(), ...extra })
  }

  /** Runs one step, handing each line it prints to `onLine`; settles when the program exits. */
  function run(kind: NonNullable<ClaudeCodeStatus["busy"]>, command: string, args: string[], onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = deps.spawn(command, args)
      // a sign-in code sent after Claude Code stopped reading meets a closed pipe: that is no crash
      child.stdin.on("error", () => {})
      running = child
      busy = kind
      cancelled = false
      let lastError = ""
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, deps.timeoutMs ?? TIMEOUT_MS)
      const lines = (stream: Readable, handle: (line: string) => void) => {
        let buffer = ""
        stream.on("data", (chunk: Buffer) => {
          buffer += chunk.toString()
          const parts = buffer.split("\n")
          buffer = parts.pop()!
          for (const part of parts) {
            const line = part.replace(ANSI, "").trim()
            if (line) handle(line)
          }
        })
      }
      lines(child.stdout, onLine)
      lines(child.stderr, (line) => (lastError = line))
      const settle = (error: Error | null) => {
        clearTimeout(timer)
        running = null
        busy = null
        if (error) reject(error)
        else resolve()
      }
      child.on("error", (error: Error) => settle(error))
      child.on("close", (code: number | null) => {
        if (code === 0) settle(null)
        // killed for taking too long, Claude Code exits 143 — which says nothing to the person waiting
        else settle(new Error(cancelled ? "cancelled" : timedOut ? "timed out" : lastError || `exited with code ${code}`))
      })
    })
  }

  /** Runs a step and tells the screen how it ended; a cancel is not reported as a failure. */
  async function step(work: () => Promise<void>): Promise<void> {
    try {
      await work()
      await announce()
    } catch (error) {
      await announce(cancelled ? {} : { error: (error as Error).message })
      throw error
    }
  }

  return {
    status,

    async install(): Promise<void> {
      if (!supported) throw new Error("Claude Code needs macOS 13 or later")
      if (busy) throw new Error("Claude Code is busy")
      await step(async () => {
        const work = run("installing", "/bin/bash", INSTALL_ARGS, (line) => void announce({ progress: line }))
        void announce()
        await work
        await deps.rescan()
      })
    },

    async login(): Promise<void> {
      if (busy) throw new Error("Claude Code is busy")
      const path = deps.claudePath()
      if (!path) throw new Error("Claude Code is not installed")
      loginPage = null
      await step(async () => {
        const work = run("logging-in", path, ["auth", "login"], (line) => {
          const url = /https:\/\/\S+/.exec(line)?.[0]
          if (url && CLAUDE_PAGE.test(url)) loginPage = url
        })
        void announce()
        await work
        // `claude auth login` can exit 0 with nothing saved (a keychain it could not write to): only the status says
        if ((await deps.askStatus(path))?.loggedIn === false) throw new Error("not signed in")
      })
    },

    /** Opens the sign-in page again, for a browser that did not open or was closed. */
    async openLoginPage(): Promise<void> {
      if (busy === "logging-in" && loginPage) await deps.openExternal(loginPage)
    },

    /** The code a sign-in page shows when it cannot come back to Claude Code by itself. */
    async submitLoginCode(code: string): Promise<void> {
      const clean = code.replace(/[\r\n]/g, "").trim()
      if (busy !== "logging-in" || !running || !clean || clean.length > 500) return
      running.stdin.write(`${clean}\n`)
    },

    async cancel(): Promise<void> {
      if (!running) return
      cancelled = true
      running.kill()
    },
  }
}

export type ClaudeCode = ReturnType<typeof createClaudeCode>
