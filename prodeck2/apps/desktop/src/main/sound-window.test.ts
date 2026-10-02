import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { EnvironmentError } from "./environment-error.ts"
import { runInNewContext } from "node:vm"
import { SOUND_HARNESS } from "@boxblack/core/sound/harness"
import { createSealedPage, SEAL_PRELUDE, type SealedElectron } from "./sound-window.ts"

/*
 * The sealed page against a fake Electron: every option a window is made with and every answer a handler gives is
 * pinned here, so that a later change cannot loosen one without a test saying so. Nothing here starts Electron.
 */

type Listener = (...args: unknown[]) => unknown

/** A fake of the window the page makes: what it was made with, what was set on its contents, and what it was asked to run. */
class FakeWindow {
  static made: FakeWindow[] = []
  /** whether the next window's load fails */
  static loadFails = false
  /** a load that waits for this before it finishes, when one is set */
  static loadGate: Promise<void> | null = null
  /** what each run of a script answers; a run with none left hangs until the window is destroyed */
  static answers: (() => Promise<unknown>)[] = []
  /** everything the fakes were asked, in order, across windows */
  static log: string[] = []

  readonly options: unknown
  readonly n: number
  destroyed = false
  loaded: string[] = []
  openHandler: (() => unknown) | null = null
  listeners = new Map<string, Listener[]>()
  muted: boolean | null = null
  webrtc: string | null = null
  /** each script run, as the caller gave it, with whether the seal prelude came first in the same call */
  scripts: { js: string; sealedFirst: boolean; userGesture: boolean | undefined }[] = []
  private hung: ((error: Error) => void)[] = []

  constructor(options: unknown) {
    this.options = options
    this.n = FakeWindow.made.push(this)
    FakeWindow.log.push(`make ${this.n}`)
  }

  readonly webContents = {
    setWindowOpenHandler: (handler: () => unknown) => {
      this.openHandler = handler
    },
    on: (event: string, listener: Listener) => {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    },
    setAudioMuted: (muted: boolean) => {
      this.muted = muted
    },
    setWebRTCIPHandlingPolicy: (policy: string) => {
      this.webrtc = policy
    },
    forcefullyCrashRenderer: () => {
      FakeWindow.log.push(`crash ${this.n}`)
    },
    executeJavaScript: (js: string, userGesture?: boolean): Promise<unknown> => {
      const sealedFirst = js.startsWith(SEAL_PRELUDE)
      const given = sealedFirst ? js.slice(SEAL_PRELUDE.length) : js
      FakeWindow.log.push(`run ${given} in ${this.n}`)
      this.scripts.push({ js: given, sealedFirst, userGesture })
      const answer = FakeWindow.answers.shift()
      if (answer) return answer()
      return new Promise((_resolve, reject) => this.hung.push(reject))
    },
  }

  async loadURL(url: string): Promise<void> {
    FakeWindow.log.push(`load ${url} in ${this.n}`)
    this.loaded.push(url)
    if (FakeWindow.loadFails) throw new Error("ERR_FAILED (-2) loading 'about:blank'")
    if (FakeWindow.loadGate) await FakeWindow.loadGate
    FakeWindow.log.push(`loaded ${this.n}`)
  }

  destroy(): void {
    FakeWindow.log.push(`destroy ${this.n}`)
    this.destroyed = true
    // what a destroyed page was running is lost with it
    for (const reject of this.hung.splice(0)) reject(new Error("Render frame was disposed before WebFrameMain could be accessed"))
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

/** A fake of the sound session: the partition it was asked for, and the handlers set on it. */
function fakeSession() {
  const seen = {
    partitions: [] as string[],
    beforeRequest: null as ((details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void) | null,
    permissionRequest: null as ((webContents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null,
    permissionCheck: null as ((webContents: unknown, permission: string) => boolean) | null,
    /** each proxy set, with how many windows had been made by the time it was in force */
    proxies: [] as { config: unknown; windowsBefore: number }[],
    listeners: new Map<string, Listener[]>(),
    /** how many times each handler was set on the session */
    registered: new Map<string, number>(),
    proxyAsked: 0,
  }
  const count = (name: string) => seen.registered.set(name, (seen.registered.get(name) ?? 0) + 1)
  /** how many of the next proxy settings fail; `proxyHangs` makes each one never settle */
  const control = { proxyFails: 0 as number | boolean, proxyHangs: false }
  const session = {
    setProxy: async (config: unknown) => {
      seen.proxyAsked++
      if (control.proxyHangs) await new Promise(() => {})
      await Promise.resolve()
      if (control.proxyFails === true) throw new Error("proxy refused")
      if (typeof control.proxyFails === "number" && control.proxyFails > 0) {
        control.proxyFails--
        throw new Error("proxy refused")
      }
      seen.proxies.push({ config, windowsBefore: FakeWindow.made.length })
    },
    on: (event: string, listener: Listener) => {
      count(event)
      seen.listeners.set(event, [...(seen.listeners.get(event) ?? []), listener])
    },
    webRequest: {
      onBeforeRequest: (listener: typeof seen.beforeRequest) => {
        count("onBeforeRequest")
        seen.beforeRequest = listener
      },
    },
    setPermissionRequestHandler: (handler: typeof seen.permissionRequest) => {
      count("permissionRequest")
      seen.permissionRequest = handler
    },
    setPermissionCheckHandler: (handler: typeof seen.permissionCheck) => {
      count("permissionCheck")
      seen.permissionCheck = handler
    },
  }
  const electron = {
    BrowserWindow: FakeWindow,
    session: {
      fromPartition: (partition: string) => {
        seen.partitions.push(partition)
        return session
      },
    },
  } as unknown as SealedElectron
  return { electron, session, seen, control }
}

const answer = (value: unknown) => () => Promise.resolve(value)

beforeEach(() => {
  vi.useFakeTimers()
  FakeWindow.made = []
  FakeWindow.loadFails = false
  FakeWindow.loadGate = null
  FakeWindow.answers = []
  FakeWindow.log = []
})
afterEach(() => {
  vi.useRealTimers()
})

/** What a window is made with: hidden, and sealed. */
const SEALED_OPTIONS = (session: unknown) => ({
  show: false,
  webPreferences: {
    session,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    spellcheck: false,
    disableDialogs: true,
    webSecurity: true,
    images: false,
  },
})

/** That a window was sealed as every one must be: its options, no window opened from it, no navigation or redirect, muted, about:blank loaded once. */
function expectSealed(window: FakeWindow, session: unknown) {
  expect(window.options).toEqual(SEALED_OPTIONS(session))
  // toEqual passes over a key that is there with nothing in it: there is no preload at all
  expect(Object.keys((window.options as { webPreferences: object }).webPreferences)).not.toContain("preload")
  expect(window.openHandler!()).toEqual({ action: "deny" })
  for (const event of ["will-navigate", "will-redirect"]) {
    const listeners = window.listeners.get(event) ?? []
    expect(listeners, event).toHaveLength(1)
    const preventDefault = vi.fn()
    listeners[0]!({ preventDefault }, "https://example.com/")
    expect(preventDefault, event).toHaveBeenCalledOnce()
  }
  expect(window.muted).toBe(true)
  // WebRTC goes through the proxy, which is not there, or not at all
  expect(window.webrtc).toBe("disable_non_proxied_udp")
  // a Bluetooth picker is never shown, and nothing is chosen
  const bluetooth = window.listeners.get("select-bluetooth-device") ?? []
  expect(bluetooth).toHaveLength(1)
  const preventDefault = vi.fn()
  const choose = vi.fn()
  bluetooth[0]!({ preventDefault }, [{ deviceId: "d1", deviceName: "speaker" }], choose)
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(choose).toHaveBeenCalledWith("")
  expect(window.loaded).toEqual(["about:blank"])
}

test("nothing is made until the first run", () => {
  const { electron, seen } = fakeSession()
  createSealedPage(electron)
  expect(FakeWindow.made).toEqual([])
  expect(seen.partitions).toEqual([])
})

test("the window is hidden, sandboxed and isolated, in its own session with no preload, no dialogs and no images; nothing opens from it, it cannot move on, and it is muted", async () => {
  const { electron, session } = fakeSession()
  FakeWindow.answers.push(answer("ok"))
  await createSealedPage(electron).run("1", 20_000)
  expect(FakeWindow.made).toHaveLength(1)
  expectSealed(FakeWindow.made[0]!, session)
})

test("its session is the page's own partition, kept in memory only, and set up once", async () => {
  const { electron, seen } = fakeSession()
  FakeWindow.answers.push(answer("ok"), answer("ok"))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  await page.run("2", 20_000)
  expect(seen.partitions).toEqual(["boxblack-sound"])
})

test("every request but about:blank is cancelled", async () => {
  const { electron, seen } = fakeSession()
  FakeWindow.answers.push(answer("ok"))
  await createSealedPage(electron).run("1", 20_000)
  const answerFor = (url: string) => {
    let response: { cancel?: boolean } | undefined
    seen.beforeRequest!({ url }, (given) => (response = given))
    return response
  }
  expect(answerFor("about:blank")).toEqual({ cancel: false })
  expect(answerFor("https://example.com/a.js")).toEqual({ cancel: true })
  expect(answerFor("http://127.0.0.1:9/")).toEqual({ cancel: true })
  expect(answerFor("file:///etc/passwd")).toEqual({ cancel: true })
  expect(answerFor("boxblack-media://x/y.mp4")).toEqual({ cancel: true })
  expect(answerFor("about:blank#x")).toEqual({ cancel: true })
})

test("all its traffic goes to a proxy that is not there, set once and in force before the first window is made", async () => {
  const { electron, seen } = fakeSession()
  FakeWindow.answers.push(answer("ok"), answer("ok"))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  await page.run("2", 20_000)
  expect(seen.proxies).toEqual([{ config: { proxyRules: "socks5://127.0.0.1:9" }, windowsBefore: 0 }])
})

test("a proxy that cannot be set is the machine's fault, and no window is made", async () => {
  const { electron, control } = fakeSession()
  control.proxyFails = true
  const failed = await createSealedPage(electron).run("1", 20_000).catch((error: unknown) => error)
  expect(failed).toBeInstanceOf(EnvironmentError)
  expect((failed as Error).message).toBe("the sound page could not start")
  expect(FakeWindow.made).toEqual([])
})

test("a proxy that failed to be set is tried again by the next run, and only the proxy: every handler is set on the session once", async () => {
  const { electron, control, seen } = fakeSession()
  control.proxyFails = 1
  const page = createSealedPage(electron)
  await expect(page.run("1", 20_000)).rejects.toThrow("the sound page could not start")
  expect(FakeWindow.made).toEqual([])
  FakeWindow.answers.push(answer("up"))
  expect(await page.run("2", 20_000)).toBe("up")
  expect(seen.proxyAsked).toBe(2)
  expect(seen.proxies).toEqual([{ config: { proxyRules: "socks5://127.0.0.1:9" }, windowsBefore: 0 }])
  expect(Object.fromEntries(seen.registered)).toEqual({
    onBeforeRequest: 1,
    permissionRequest: 1,
    permissionCheck: 1,
    "will-download": 1,
    "select-hid-device": 1,
    "select-serial-port": 1,
    "select-usb-device": 1,
  })
  expect(seen.partitions).toEqual(["boxblack-sound"])
})

test("a proxy that never settles ends the run at its time, as the machine's fault, with no window made", async () => {
  const { electron, control } = fakeSession()
  control.proxyHangs = true
  const run = createSealedPage(electron).run("1", 20_000).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20_000)
  const failed = await run
  expect(failed).toBeInstanceOf(EnvironmentError)
  expect((failed as Error).message).toBe("the sound page could not start")
  expect(FakeWindow.made).toEqual([])
})

test("nothing is downloaded, and no device picker is shown: each is refused with nothing chosen", async () => {
  const { electron, seen } = fakeSession()
  FakeWindow.answers.push(answer("ok"))
  await createSealedPage(electron).run("1", 20_000)
  const fire = (event: string, ...args: unknown[]) => {
    const listeners = seen.listeners.get(event) ?? []
    expect(listeners, event).toHaveLength(1)
    const preventDefault = vi.fn()
    listeners[0]!({ preventDefault }, ...args)
    expect(preventDefault, event).toHaveBeenCalledOnce()
  }
  fire("will-download", { getFilename: () => "a.bin" }, {})
  const hid = vi.fn()
  fire("select-hid-device", { deviceList: [{ deviceId: "h1" }] }, hid)
  expect(hid).toHaveBeenCalledWith(null)
  const serial = vi.fn()
  fire("select-serial-port", [{ portId: "s1" }], {}, serial)
  expect(serial).toHaveBeenCalledWith("")
  const usb = vi.fn()
  fire("select-usb-device", { deviceList: [{ deviceId: "u1" }] }, usb)
  expect(usb).toHaveBeenCalledOnce()
  expect(usb.mock.calls[0]).toEqual([])
})

test("every permission is refused, whether asked for or checked", async () => {
  const { electron, seen } = fakeSession()
  FakeWindow.answers.push(answer("ok"))
  await createSealedPage(electron).run("1", 20_000)
  for (const permission of ["media", "notifications", "midi", "clipboard-read", "openExternal", "fullscreen"]) {
    let granted: boolean | undefined
    seen.permissionRequest!({}, permission, (given) => (granted = given))
    expect(granted, permission).toBe(false)
    expect(seen.permissionCheck!({}, permission), permission).toBe(false)
  }
})

test("a run hands the script to the page with no user's gesture, and answers what it came to", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(answer({ wav: "UklGRg==" }))
  expect(await createSealedPage(electron).run("renderSound()", 20_000)).toEqual({ wav: "UklGRg==" })
  expect(FakeWindow.made[0]!.scripts).toEqual([{ js: "renderSound()", sealedFirst: true, userGesture: false }])
})

test("a run waits for about:blank to finish loading before it runs anything", async () => {
  const { electron } = fakeSession()
  let open: () => void = () => {}
  FakeWindow.loadGate = new Promise((resolve) => (open = resolve))
  FakeWindow.answers.push(answer("ok"))
  const run = createSealedPage(electron).run("1", 20_000)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(FakeWindow.made[0]!.scripts).toEqual([])
  open()
  expect(await run).toBe("ok")
  expect(FakeWindow.log).toEqual(["make 1", "load about:blank in 1", "loaded 1", "run 1 in 1"])
})

test("every run has a fresh page of its own: a new window is made, sealed and loaded, and only then is the window of the run before destroyed", async () => {
  // what one sound's code changes in its page, a builtin it replaced, must never reach the next sound's render
  const { electron, session } = fakeSession()
  FakeWindow.answers.push(answer("a"), answer("b"), answer("c"))
  const page = createSealedPage(electron)
  expect(await page.run("1", 20_000)).toBe("a")
  expect(await page.run("2", 20_000)).toBe("b")
  expect(await page.run("3", 20_000)).toBe("c")
  expect(FakeWindow.log).toEqual([
    "make 1", "load about:blank in 1", "loaded 1", "run 1 in 1",
    "make 2", "load about:blank in 2", "loaded 2", "destroy 1", "run 2 in 2",
    "make 3", "load about:blank in 3", "loaded 3", "destroy 2", "run 3 in 3",
  ])
  // a page that answered is only destroyed: its renderer is not crashed under the next one
  expect(FakeWindow.log.filter((line) => line.startsWith("crash"))).toEqual([])
  for (const window of FakeWindow.made) expectSealed(window, session)
  expect(FakeWindow.made.map((window) => window.scripts.length)).toEqual([1, 1, 1])
  // and each page is locked by the prelude in the same call as its script, with no moment between
  expect(FakeWindow.made.every((window) => window.scripts.every((script) => script.sealedFirst))).toBe(true)
})

test("runs asked for together take turns: the next starts on its own page once the one before has answered", async () => {
  const { electron } = fakeSession()
  let finish: (value: unknown) => void = () => {}
  FakeWindow.answers.push(() => new Promise((resolve) => (finish = resolve)), answer("second"))
  const page = createSealedPage(electron)
  const first = page.run("1", 20_000)
  const second = page.run("2", 20_000)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(FakeWindow.made).toHaveLength(1)
  finish("first")
  expect(await first).toBe("first")
  expect(await second).toBe("second")
  expect(FakeWindow.log).toEqual(["make 1", "load about:blank in 1", "loaded 1", "run 1 in 1", "make 2", "load about:blank in 2", "loaded 2", "destroy 1", "run 2 in 2"])
})

test("a script that throws rejects the run, and the next run is made as usual", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(() => Promise.reject(new Error("Script failed to execute")), answer("next"))
  const page = createSealedPage(electron)
  await expect(page.run("x", 20_000)).rejects.toThrow("Script failed to execute")
  expect(await page.run("y", 20_000)).toBe("next")
})

test("a run that takes too long destroys the window, ending the script, and rejects saying how long it was given", async () => {
  const { electron } = fakeSession()
  const page = createSealedPage(electron)
  const run = page.run("while (true) {}", 20_000)
  const settled = expect(run).rejects.toThrow("the sound took longer than 20 s to render")
  await vi.advanceTimersByTimeAsync(19_999)
  expect(FakeWindow.made[0]!.destroyed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await settled
  // what the destroyed page's script then fails with is no one's: the run has already answered, and nothing is left unhandled
  expect(FakeWindow.made[0]!.destroyed).toBe(true)
  // its renderer is ended first, so a script that never stops cannot hold the process
  expect(FakeWindow.log.slice(-2)).toEqual(["crash 1", "destroy 1"])
})

test("a time given in part of a second is said as it is", async () => {
  const { electron } = fakeSession()
  const run = createSealedPage(electron).run("while (true) {}", 2_500)
  const settled = expect(run).rejects.toThrow("the sound took longer than 2.5 s to render")
  await vi.advanceTimersByTimeAsync(2_500)
  await settled
})

test("a load that never finishes is the machine's fault once the time is up, not the sound's", async () => {
  const { electron } = fakeSession()
  FakeWindow.loadGate = new Promise(() => {})
  const run = createSealedPage(electron).run("1", 20_000).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20_000)
  const failed = await run
  expect(failed).toBeInstanceOf(EnvironmentError)
  expect((failed as Error).message).toBe("the sound page could not start")
  expect(FakeWindow.made[0]!.destroyed).toBe(true)
  expect(FakeWindow.made[0]!.scripts).toEqual([])
  // a page that never loaded has no renderer known to be running: it is only destroyed
  expect(FakeWindow.log).not.toContain("crash 1")
})

test("a run after one that ran out of time makes a new window, sealed as the first", async () => {
  const { electron, session } = fakeSession()
  const page = createSealedPage(electron)
  const first = expect(page.run("while (true) {}", 20_000)).rejects.toThrow("took longer")
  await vi.advanceTimersByTimeAsync(20_000)
  await first
  FakeWindow.answers.push(answer("again"))
  expect(await page.run("1", 20_000)).toBe("again")
  expect(FakeWindow.made).toHaveLength(2)
  expectSealed(FakeWindow.made[1]!, session)
})

test("the last run's window closes after 30 s with nothing run", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(answer(1), answer(2))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  await vi.advanceTimersByTimeAsync(29_999)
  expect(FakeWindow.made[0]!.destroyed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(FakeWindow.made[0]!.destroyed).toBe(true)
  // and the next run makes another
  expect(await page.run("2", 20_000)).toBe(2)
  expect(FakeWindow.made).toHaveLength(2)
})

test("a run under way is never closed for being idle", async () => {
  const { electron } = fakeSession()
  let finish: (value: unknown) => void = () => {}
  FakeWindow.answers.push(answer(1), () => new Promise((resolve) => (finish = resolve)))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  await vi.advanceTimersByTimeAsync(25_000)
  const long = page.run("2", 60_000)
  await vi.advanceTimersByTimeAsync(40_000)
  expect(FakeWindow.made[1]!.destroyed).toBe(false)
  finish("done")
  expect(await long).toBe("done")
})

test("close destroys the window at once, and the page is shut: a later run rejects at once and makes nothing", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(answer(1), answer(2))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  page.close()
  expect(FakeWindow.made[0]!.destroyed).toBe(true)
  // the idle timer of the run before is gone with it: nothing is destroyed twice
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeWindow.log.filter((line) => line === "destroy 1")).toHaveLength(1)
  const failed = await page.run("2", 20_000).catch((error: unknown) => error)
  expect(failed).toBeInstanceOf(EnvironmentError)
  expect((failed as Error).message).toBe("the app is quitting")
  expect(FakeWindow.made).toHaveLength(1)
})

test("close ends the run under way and the runs waiting, each as the app quitting", async () => {
  const { electron } = fakeSession()
  const page = createSealedPage(electron)
  const running = page.run("while (true) {}", 20_000).catch((error: unknown) => error)
  const waiting = page.run("2", 20_000).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(1_000)
  page.close()
  for (const failed of [await running, await waiting]) {
    expect(failed).toBeInstanceOf(EnvironmentError)
    expect((failed as Error).message).toBe("the app is quitting")
  }
  expect(FakeWindow.made).toHaveLength(1)
  expect(FakeWindow.made[0]!.destroyed).toBe(true)
  // its script was running, so its renderer is stopped first
  expect(FakeWindow.log.slice(-2)).toEqual(["crash 1", "destroy 1"])
})

test("a page that cannot load is the machine's fault, and the next run tries a new window", async () => {
  const { electron } = fakeSession()
  FakeWindow.loadFails = true
  const page = createSealedPage(electron)
  const failed = await page.run("1", 20_000).catch((error: unknown) => error)
  expect(failed).toBeInstanceOf(EnvironmentError)
  expect((failed as Error).message).toBe("the sound page could not start")
  expect(FakeWindow.made[0]!.destroyed).toBe(true)
  expect(FakeWindow.made[0]!.scripts).toEqual([])
  expect(FakeWindow.log).not.toContain("crash 1")
  FakeWindow.loadFails = false
  FakeWindow.answers.push(answer("up"))
  expect(await page.run("2", 20_000)).toBe("up")
})

/*
 * The window of the run before is kept until the next page has loaded, so no moment with no window at all comes
 * between runs: an app that quits when its last window closes (Electron's default with no window-all-closed listener)
 * would quit there. These tests pin the order with fakes only; the guard that Electron honours it is a check in a real
 * Electron that runs repeated renders, runaway scripts and escape probes.
 */

test("the window of the run before stays while the next page loads, and goes once it has loaded, before the script runs", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(answer(1), answer(2))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  let open: () => void = () => {}
  FakeWindow.loadGate = new Promise((resolve) => (open = resolve))
  const second = page.run("2", 60_000)
  // past the first run's 30 s idle close: the run cleared it as it started, so neither window goes for it
  await vi.advanceTimersByTimeAsync(31_000)
  expect(FakeWindow.made).toHaveLength(2)
  expect(FakeWindow.made[0]!.destroyed).toBe(false)
  expect(FakeWindow.made[1]!.destroyed).toBe(false)
  open()
  expect(await second).toBe(2)
  expect(FakeWindow.made[0]!.destroyed).toBe(true)
  expect(FakeWindow.log.slice(-3)).toEqual(["loaded 2", "destroy 1", "run 2 in 2"])
})

test("the window of the run before goes too when the next page cannot load", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(answer(1))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  FakeWindow.loadFails = true
  await expect(page.run("2", 20_000)).rejects.toThrow("the sound page could not start")
  expect(FakeWindow.made.map((window) => window.destroyed)).toEqual([true, true])
  expect(FakeWindow.log.filter((line) => line.startsWith("crash"))).toEqual([])
})

test("the window of the run before goes too when the next page never loads in time", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(answer(1))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  FakeWindow.loadGate = new Promise(() => {})
  const second = page.run("2", 20_000).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(((await second) as Error).message).toBe("the sound page could not start")
  expect(FakeWindow.made.map((window) => window.destroyed)).toEqual([true, true])
  expect(FakeWindow.log.filter((line) => line.startsWith("crash"))).toEqual([])
})

test("close while the next page loads destroys both windows, and the run rejects as the app quitting", async () => {
  const { electron } = fakeSession()
  FakeWindow.answers.push(answer(1))
  const page = createSealedPage(electron)
  await page.run("1", 20_000)
  FakeWindow.loadGate = new Promise(() => {})
  const second = page.run("2", 20_000).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(1_000)
  page.close()
  expect(((await second) as Error).message).toBe("the app is quitting")
  expect(FakeWindow.made.map((window) => window.destroyed)).toEqual([true, true])
  // the one that never loaded is only destroyed
  expect(FakeWindow.log).not.toContain("crash 2")
})

test("a window that cannot be made is the machine's fault", async () => {
  const electron = {
    BrowserWindow: class {
      constructor() {
        throw new Error("no display")
      }
    },
    session: fakeSession().electron.session,
  } as unknown as SealedElectron
  const failed = await createSealedPage(electron).run("1", 20_000).catch((error: unknown) => error)
  expect(failed).toBeInstanceOf(EnvironmentError)
  expect((failed as Error).message).toBe("the sound page could not start")
})

// the seal prelude, run here in a realm of its own: no Chromium, so this shows what it does, not that Chromium honours it

/** A realm with a Document and a print of its own, as a page has, standing in for the page's globals. */
function pageRealm() {
  const realm: Record<string, unknown> = {}
  runInNewContext("function Document() {}; Document.prototype.execCommand = function () { return true }; var print = function () { while (true) {} }", realm)
  return realm
}

test("the prelude leaves the script's value as the call's answer, whatever the script ends with", async () => {
  expect(runInNewContext(`${SEAL_PRELUDE}1 + 2`, pageRealm())).toBe(3)
  // a function declared first and a promise last, as the harness and its call are
  expect(await (runInNewContext(`${SEAL_PRELUDE}async function f() { return 4 }\nf().catch(() => 0)`, pageRealm()) as Promise<number>)).toBe(4)
  expect(runInNewContext(`${SEAL_PRELUDE}const a = 5; ({ wav: "x", n: a })`, pageRealm())).toEqual({ wav: "x", n: 5 })
  // what a glued statement could join with the prelude's closing: a bracket, a parenthesis, a template
  expect(runInNewContext(`${SEAL_PRELUDE}(1)`, pageRealm())).toBe(1)
  expect(runInNewContext(`${SEAL_PRELUDE}[2][0]`, pageRealm())).toBe(2)
  expect(runInNewContext(`${SEAL_PRELUDE}\`t\${3}\``, pageRealm())).toBe("t3")
  // a script whose last statement has no value answers nothing, not the prelude's value
  expect(runInNewContext(`${SEAL_PRELUDE}let z = 1`, pageRealm())).toBeUndefined()
})

test("the prelude locks copying and printing before the script runs: neither can be put back", () => {
  const realm = pageRealm()
  const said = runInNewContext(
    `${SEAL_PRELUDE}
    const tries = []
    try { Document.prototype.execCommand = () => true } catch (error) { tries.push("assign") }
    try { Object.defineProperty(Document.prototype, "execCommand", { value: () => true }) } catch (error) { tries.push("define") }
    try { print = () => "printed" } catch (error) { tries.push("print") }
    ;({ copied: new Document().execCommand("copy"), printed: print(), tries })`,
    realm,
  )
  expect(said).toEqual({ copied: false, printed: undefined, tries: ["define"] })
  const descriptor = Object.getOwnPropertyDescriptor((realm.Document as { prototype: object }).prototype, "execCommand")!
  expect(descriptor.writable).toBe(false)
  expect(descriptor.configurable).toBe(false)
  const printing = runInNewContext(`Object.getOwnPropertyDescriptor(globalThis, "print")`, realm) as PropertyDescriptor
  expect(printing.writable).toBe(false)
  expect(printing.configurable).toBe(false)
})

test("the prelude still runs on a page with no print to lock", () => {
  expect(runInNewContext(`${SEAL_PRELUDE}"ran"`, { Document: function Document() {} })).toBe("ran")
})

test("the harness declares none of the names the prelude relies on at its top level, so glued after it, it neither hides them nor makes it throw", () => {
  // a top-level function of one of these names would be hoisted over the page's own; a let or class of one would make the prelude throw
  const realm = pageRealm()
  const before = new Set(runInNewContext("Object.getOwnPropertyNames(globalThis)", realm) as string[])
  const page = (realm as { Document: unknown }).Document
  const renderSound = runInNewContext(`${SEAL_PRELUDE}${SOUND_HARNESS}\nrenderSound`, realm)
  expect(typeof renderSound).toBe("function")
  const added = (runInNewContext("Object.getOwnPropertyNames(globalThis)", realm) as string[]).filter((name) => !before.has(name))
  expect(added).toEqual(["renderSound"])
  expect((realm as { Document: unknown }).Document).toBe(page)
  for (const name of ["Object", "Document", "globalThis", "print"]) expect(SOUND_HARNESS).not.toMatch(new RegExp(`^(?:async\\s+)?(?:function|class|let|const|var)\\s+${name}\\b`, "m"))
  // and the lock took on the page's own Document
  expect(Object.getOwnPropertyDescriptor((page as { prototype: object }).prototype, "execCommand")!.writable).toBe(false)
})
