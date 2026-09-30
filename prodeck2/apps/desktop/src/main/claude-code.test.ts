import { expect, test } from "vitest"
import { EventEmitter, once } from "node:events"
import { PassThrough } from "node:stream"
import { runProcess } from "@boxblack/core/media"
import type { AppEvent, ClaudeCodeStatus } from "../shared/api.ts"
import { createClaudeCode, INSTALL_COMMAND, parseAuthStatus, spawnGroup, type ClaudeCodeDeps, type ClaudeChild } from "./claude-code.ts"

/** A child process the test drives: it prints, reads, and exits when told to. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    killed: false,
    kill() {
      child.killed = true
      child.emit("close", null)
      return true
    },
  })
  const typed: string[] = []
  child.stdin.on("data", (chunk: Buffer) => typed.push(chunk.toString()))
  return {
    child: child as unknown as ClaudeChild,
    say: (text: string) => child.stdout.write(text),
    fail: (text: string) => child.stderr.write(text),
    exit: (code: number) => child.emit("close", code),
    typed,
    killed: () => child.killed,
  }
}

function setup(overrides: Partial<ClaudeCodeDeps> = {}) {
  const events: AppEvent[] = []
  const spawned: { command: string; args: string[]; child: ReturnType<typeof fakeChild> }[] = []
  const opened: string[] = []
  let claude: string | null = null
  let loggedIn = false
  let rescans = 0
  const deps: ClaudeCodeDeps = {
    macosMajor: 15,
    claudePath: () => claude,
    version: async () => (claude ? "2.1.280" : null),
    rescan: async () => {
      rescans += 1
    },
    askStatus: async () => ({ loggedIn, subscription: loggedIn ? "max" : null }),
    spawn: (command, args) => {
      const fake = fakeChild()
      spawned.push({ command, args, child: fake })
      return fake.child
    },
    openExternal: async (url) => void opened.push(url),
    send: (event) => events.push(event),
    ...overrides,
  }
  const service = createClaudeCode(deps)
  const last = () => (events.filter((e) => e.type === "claude-code").at(-1) as Extract<AppEvent, { type: "claude-code" }> | undefined)
  return {
    service,
    events,
    spawned,
    opened,
    last,
    install: (path: string | null) => (claude = path),
    login: (value: boolean) => (loggedIn = value),
    rescans: () => rescans,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("a Mac with no Claude Code is told so, and nothing is asked of a program that is not there", async () => {
  const { service } = setup()
  expect(await service.status()).toEqual<ClaudeCodeStatus>({ supported: true, path: null, version: null, account: null, busy: null })
})

test("an installed Claude Code reports its version and whether it is logged in, and to which plan", async () => {
  const context = setup()
  context.install("/Users/me/.local/bin/claude")
  context.login(true)
  expect(await context.service.status()).toEqual<ClaudeCodeStatus>({
    supported: true,
    path: "/Users/me/.local/bin/claude",
    version: "2.1.280",
    account: { loggedIn: true, subscription: "max" },
    busy: null,
  })
})

test("macOS 12 cannot run Claude Code: nothing is offered and installing is refused", async () => {
  const { service, spawned } = setup({ macosMajor: 12 })
  expect((await service.status()).supported).toBe(false)
  await expect(service.install()).rejects.toThrow("macOS 13")
  expect(spawned).toEqual([])
})

test("installing runs Anthropic's own installer, shows what it says, then looks for the tool again", async () => {
  const context = setup()
  const done = context.service.install()
  await tick()
  // with pipefail, a download that fails fails the install, instead of bash running nothing and calling that done
  expect(context.spawned[0]).toMatchObject({ command: "/bin/bash", args: ["-o", "pipefail", "-c", INSTALL_COMMAND] })
  expect(INSTALL_COMMAND).toBe("curl -fsSL https://claude.ai/install.sh | bash")
  expect((await context.service.status()).busy).toBe("installing")

  context.spawned[0]!.child.say("Setting up Claude Code...\n")
  await tick()
  expect(context.last()).toMatchObject({ progress: "Setting up Claude Code..." })

  context.install("/Users/me/.local/bin/claude")
  context.spawned[0]!.child.say("\u001b[32m✅ Installation complete!\u001b[0m\n")
  await tick()
  // the installer's colours are for a terminal; the screen shows the words
  expect(context.last()).toMatchObject({ progress: "✅ Installation complete!" })
  context.spawned[0]!.child.exit(0)
  await done
  expect(context.rescans()).toBe(1)
  expect(context.last()?.status).toMatchObject({ path: "/Users/me/.local/bin/claude", busy: null })
  expect(context.last()?.error).toBeUndefined()
})

test("an installer that fails says why, in its own last words", async () => {
  const context = setup()
  const done = context.service.install()
  await tick()
  context.spawned[0]!.child.fail("Checksum verification failed\n")
  context.spawned[0]!.child.exit(1)
  await expect(done).rejects.toThrow("Checksum verification failed")
  expect(context.last()).toMatchObject({ error: "Checksum verification failed", status: { busy: null } })
})

test("logging in opens the browser through Claude Code, and finishes when Claude Code does", async () => {
  const context = setup()
  context.install("/Users/me/.local/bin/claude")
  const done = context.service.login()
  await tick()
  expect(context.spawned[0]).toMatchObject({ command: "/Users/me/.local/bin/claude", args: ["auth", "login"] })
  expect((await context.service.status()).busy).toBe("logging-in")

  context.spawned[0]!.child.say(
    "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x\nPaste code here if prompted > ",
  )
  await tick()
  // the page it opened can be opened again from the app, but only a Claude page
  await context.service.openLoginPage()
  expect(context.opened).toEqual(["https://claude.com/cai/oauth/authorize?code=true&state=x"])

  context.login(true)
  context.spawned[0]!.child.exit(0)
  await done
  expect(context.last()?.status).toMatchObject({ account: { loggedIn: true, subscription: "max" }, busy: null })
})

test("a code the sign-in page shows instead of coming back is typed into Claude Code for the user", async () => {
  const context = setup()
  context.install("/Users/me/.local/bin/claude")
  void context.service.login()
  await tick()
  await context.service.submitLoginCode("  abc123#state  ")
  expect(context.spawned[0]!.child.typed).toEqual(["abc123#state\n"])
})

test("a code sent after Claude Code stopped reading does not bring the app down", async () => {
  const context = setup()
  context.install("/Users/me/.local/bin/claude")
  void context.service.login().catch(() => {})
  await tick()
  const crashes: unknown[] = []
  const record = (error: unknown) => crashes.push(error)
  process.on("uncaughtException", record)
  try {
    // it read one code and closed its end: a second one meets a broken pipe
    context.spawned[0]!.child.child.stdin.destroy(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))
    await context.service.submitLoginCode("again")
    await new Promise((resolve) => setTimeout(resolve, 20))
  } finally {
    process.off("uncaughtException", record)
  }
  expect(crashes).toEqual([])
})

test("a login page that is not Claude's is never opened", async () => {
  const context = setup()
  context.install("/Users/me/.local/bin/claude")
  void context.service.login()
  await tick()
  context.spawned[0]!.child.say("If the browser didn't open, visit: https://evil.example.com/login\n")
  await tick()
  await context.service.openLoginPage()
  expect(context.opened).toEqual([])
})

test("cancelling stops what is running and leaves Claude Code as it was", async () => {
  const context = setup()
  context.install("/Users/me/.local/bin/claude")
  const done = context.service.login()
  await tick()
  await context.service.cancel()
  await expect(done).rejects.toThrow()
  expect(context.spawned[0]!.child.killed()).toBe(true)
  expect((await context.service.status()).busy).toBeNull()
})

test("stopping a step stops everything it started, not only the shell it began with", async () => {
  // the installer is a pipeline that starts `claude install` of its own: all of it has to go
  const child = spawnGroup("/bin/bash", ["-c", "sleep 30 | cat"])
  const members = async () => {
    try {
      return (await runProcess("/usr/bin/pgrep", ["-g", String(child.pid)])).stdout.trim().split("\n").filter(Boolean)
    } catch {
      return []
    }
  }
  const settle = async (want: number) => {
    for (let i = 0; i < 100 && (await members()).length !== want; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    return (await members()).length
  }
  expect(await settle(3)).toBe(3)
  child.kill()
  await once(child, "close")
  expect(await settle(0)).toBe(0)
})

test("one thing at a time: a second install or login waits for none, it is refused", async () => {
  const context = setup()
  void context.service.install()
  await tick()
  await expect(context.service.install()).rejects.toThrow("busy")
  await expect(context.service.login()).rejects.toThrow("busy")
})

test("logging in needs Claude Code installed first", async () => {
  const { service } = setup()
  await expect(service.login()).rejects.toThrow("not installed")
})

test("what `claude auth status --json` says is read for the login and the plan, and nothing else is kept", () => {
  const signedIn = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max", email: "someone@example.com", orgId: "x" })
  expect(parseAuthStatus(signedIn)).toEqual({ loggedIn: true, subscription: "max" })
  expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ loggedIn: false, subscription: null })
  // an older Claude Code that prints something else is not taken for signed in or out
  expect(parseAuthStatus("Logged in as someone")).toBeNull()
  expect(parseAuthStatus(JSON.stringify({ authMethod: "claude.ai" }))).toBeNull()
})

test("a sign-in nobody finishes is given up after a while, and says it ran out of time", async () => {
  const context = setup({ timeoutMs: 20 })
  context.install("/Users/me/.local/bin/claude")
  const done = context.service.login()
  await expect(done).rejects.toThrow("timed out")
  expect(context.spawned[0]!.child.killed()).toBe(true)
  expect(context.last()).toMatchObject({ error: "timed out", status: { busy: null } })
})

test("a sign-in that ends without an error but leaves Claude Code signed out says so, instead of going quiet", async () => {
  // seen for real: approved in the browser, `claude auth login` exited 0, and the token never reached a keychain
  const context = setup()
  context.install("/Users/me/.local/bin/claude")
  const done = context.service.login()
  await tick()
  context.spawned[0]!.child.exit(0)
  await expect(done).rejects.toThrow("not signed in")
  expect(context.last()).toMatchObject({ error: "not signed in", status: { account: { loggedIn: false } } })
})
