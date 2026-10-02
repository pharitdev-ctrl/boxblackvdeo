import type { BrowserWindowConstructorOptions, Session } from "electron"
import { EnvironmentError } from "./environment-error.ts"

/*
 * The hidden page composed sounds are rendered in (spec §7). The code Claude wrote runs here, so the page is sealed:
 * a session of its own kept in memory only, which shares nothing with the main window (not its boxblack-media://
 * files); every request but about:blank cancelled, and what goes around webRequest (WebRTC, a socket the network
 * service opens itself) sent to a proxy that is not there; every permission refused, every download and every
 * device picker too; no preload, so no way to the app's IPC; the renderer sandboxed and its world isolated; no window
 * opened from it, no navigation and no redirect; no alert, confirm or prompt that could block it; no image loaded,
 * and nothing played aloud. The script runs with no user's gesture, so the page has no user activation to spend.
 * Copying to the system clipboard (document.execCommand("copy")) needs neither a permission in Electron nor a gesture,
 * and the linter is no barrier (a function's constructor reached through a string reaches the page's globals), so
 * the page locks it before the script runs, and print too, which held a run until its time ran out (SEAL_PRELUDE). It
 * is not one of the app's windows to the user: it gets no app:event and is never shown, and the app quits and makes
 * its main window as if it were not there.
 *
 * Every run has a page of its own. The code can replace what the page's own functions do (Math.pow, say), and a page
 * used again would carry that into the next sound's render, so each run makes a new window, sealed as the first,
 * loads about:blank in it and runs the script once that has loaded. The window of the run before is kept until the
 * new page has loaded, and destroyed then, before the script runs (or when the new page fails to load or runs out of
 * time, the session cannot be sealed, or the page is closed), so no moment with no window at all comes between runs: an app that quits when its last window closes
 * (Electron's default with no window-all-closed listener) would quit there. A renderer is crashed only for a page
 * known to be running. The last window goes after 30 s with nothing run. Runs take turns: a run asked for while one
 * is under way starts once that one has answered. Once the page is closed it stays shut: the app is quitting.
 *
 * The tests pin all of this with fakes; the guard that Electron and Chromium honour it is a check in a real Electron
 * that runs repeated renders, runaway scripts and escape probes.
 */

/** The page sounds are rendered in: one script run at a time, each in a page of its own. */
export interface SealedPage {
  /** Runs `js` in a fresh page and answers what it came to; rejects when it throws, or when it takes longer than `timeoutMs`. */
  run(js: string, timeoutMs: number): Promise<unknown>
  /** Shuts the page for good (the app is quitting): its window is destroyed, and the run under way and every later one reject. */
  close(): void
}

/** What the page asks of a window: Electron's BrowserWindow has all of it. */
interface SealedWindow {
  loadURL(url: string): Promise<void>
  destroy(): void
  isDestroyed(): boolean
  webContents: {
    setWindowOpenHandler(handler: () => { action: "deny" }): void
    on(event: "will-navigate" | "will-redirect", listener: (event: { preventDefault(): void }) => void): unknown
    on(event: "select-bluetooth-device", listener: (event: { preventDefault(): void }, devices: unknown[], callback: (deviceId: string) => void) => void): unknown
    setAudioMuted(muted: boolean): void
    setWebRTCIPHandlingPolicy(policy: "disable_non_proxied_udp"): void
    forcefullyCrashRenderer(): void
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  }
}

/** What of Electron the page is made with, handed in so that the tests can give fakes: the app gives Electron's own. */
export interface SealedElectron {
  BrowserWindow: new (options: BrowserWindowConstructorOptions) => SealedWindow
  session: { fromPartition(partition: string): Session }
}

/**
 * What runs in the page before the script, in the same call, so that no moment comes between them: copying to the
 * clipboard (Document.prototype.execCommand) answers false, and print does nothing, and neither can be put back,
 * written over or defined again. One that cannot be locked (no print on the page) is left as it is. It is a statement
 * on its own, so the script after it is still what the call answers with (a script's value is its last statement's).
 *
 * The script is glued after it as one script, so it must not declare Object, Document, globalThis or print at its
 * top level: a function of one of those names would be hoisted over the page's own before the prelude runs, and a
 * let, const or class of one would make the prelude throw. The harness declares only renderSound (pinned in a test).
 */
export const SEAL_PRELUDE = `(() => {
  const lock = (target, name, value) => { try { Object.defineProperty(target, name, { value, writable: false, configurable: false }) } catch (error) {} }
  lock(Document.prototype, "execCommand", () => false)
  if ("print" in globalThis) lock(globalThis, "print", () => {})
})();
`

/** The page's session: no `persist:`, so nothing it holds outlives the app. */
const PARTITION = "boxblack-sound"
/** A proxy that is not there: whatever leaves the page without passing webRequest goes nowhere. */
const DEAD_PROXY = "socks5://127.0.0.1:9"
/** How long the last run's window is kept with nothing run before it is closed. */
const IDLE_CLOSE_MS = 30_000

/**
 * Seals the page's session, once for its life: every request but about:blank cancelled, every permission refused,
 * asked for or checked, nothing downloaded, and no device chosen. The dead proxy is set apart from these (`proxied`),
 * since it is what can fail, and is tried again.
 */
function seal(session: Session): Session {
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== "about:blank" }))
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.on("will-download", (event) => event.preventDefault())
  session.on("select-hid-device", (event, _details, callback) => {
    event.preventDefault()
    callback(null)
  })
  session.on("select-serial-port", (event, _ports, _webContents, callback) => {
    event.preventDefault()
    callback("")
  })
  session.on("select-usb-device", (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  return session
}

export function createSealedPage(electron: SealedElectron): SealedPage {
  /** the session, sealed on the first run; Electron must be ready by then */
  let session: Session | null = null
  /** the dead proxy being set, or set, on it; one that failed is set again by the next run */
  let proxied: Promise<void> | null = null
  /** the window of the run under way, or of the last one until it is closed */
  let window: SealedWindow | null = null
  let idle: NodeJS.Timeout | undefined
  /** each run waits for the one before to answer */
  let turns: Promise<unknown> = Promise.resolve()
  /** closed for good: the app is quitting */
  let shut = false
  /** ends the run under way at once, with the reason given */
  let stop: ((reason: Error) => void) | null = null
  /** the window of the run before, kept while the next page loads */
  let previous: SealedWindow | null = null
  /** the pages whose renderer is known to be running: loaded, with the script started in them */
  const started = new WeakSet<SealedWindow>()

  const quitting = () => new EnvironmentError("the app is quitting")

  /** Destroys the window there is, if any. */
  function discard(): void {
    clearTimeout(idle)
    if (window && !window.isDestroyed()) window.destroy()
    window = null
  }

  /** A new window, sealed, with about:blank being loaded in it: that load is what it answers. */
  function open(session: Session): { page: SealedWindow; loaded: Promise<void> } {
    const page = new electron.BrowserWindow({
      show: false,
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, disableDialogs: true, webSecurity: true, images: false },
    })
    window = page
    page.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    page.webContents.on("will-navigate", (event) => event.preventDefault())
    page.webContents.on("will-redirect", (event) => event.preventDefault())
    page.webContents.on("select-bluetooth-device", (event, _devices, callback) => {
      event.preventDefault()
      callback("")
    })
    page.webContents.setAudioMuted(true)
    page.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
    return { page, loaded: page.loadURL("about:blank") }
  }

  /**
   * Ends a page at once: its renderer first when it is known to be running, so a script that never stops cannot hold
   * the process, then its window. A page that never loaded is only destroyed: there is no running renderer to stop.
   */
  function end(page: SealedWindow): void {
    if (page.isDestroyed()) return
    if (started.has(page)) {
      try {
        page.webContents.forcefullyCrashRenderer()
      } catch {
        // the window goes all the same
      }
    }
    page.destroy()
  }

  /** Destroys the window of the run before, if it is still there: its script has answered, so it is only destroyed. */
  function retire(): void {
    const before = previous
    previous = null
    if (before && !before.isDestroyed()) before.destroy()
  }

  /** The session, sealed, with the dead proxy in force: what a window may be made in. */
  async function ready(): Promise<Session> {
    const sealed = (session ??= seal(electron.session.fromPartition(PARTITION)))
    if (!proxied) {
      proxied = sealed.setProxy({ proxyRules: DEAD_PROXY })
      proxied.catch(() => (proxied = null))
    }
    await proxied
    return sealed
  }

  /**
   * Runs `js` in a new page once about:blank has loaded in it, unless `timeoutMs` passes first, counted from the start,
   * the session's sealing included. When it passes with the script running, the page is ended, which stops a script
   * that never does, and the run rejects saying how long it was given; when it passes before the page has loaded,
   * that is the page not starting. A session that cannot be sealed, a window that cannot be made, or a page that
   * cannot load or start in time is the machine's fault, which no sound's code is to blame for.
   */
  async function runOnce(js: string, timeoutMs: number): Promise<unknown> {
    if (shut) throw quitting()
    // the page of the run before goes, with whatever its code changed in it, but only once the new one has loaded
    clearTimeout(idle)
    previous = window && !window.isDestroyed() ? window : null
    window = null
    /** the page this run made, once it has made one */
    let page: SealedWindow | null = null
    /** the page has loaded and the script is running in it */
    let running = false
    /** the run has answered: nothing more is made for it */
    let over = false
    const notStarted = () => new EnvironmentError("the sound page could not start")
    const work = (async () => {
      let session: Session
      try {
        session = await ready()
      } catch {
        throw notStarted()
      }
      if (over) return
      if (shut) throw quitting()
      let loaded: Promise<void>
      try {
        ;({ page, loaded } = open(session))
      } catch {
        throw notStarted()
      }
      const made = page
      try {
        await loaded
      } catch {
        end(made)
        throw notStarted()
      }
      if (over) return
      // a run that has answered retired the window before in its finally
      retire()
      running = true
      started.add(made)
      return made.webContents.executeJavaScript(SEAL_PRELUDE + js, false)
    })()
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          over = true
          if (page) end(page)
          reject(running ? new Error(`the sound took longer than ${timeoutMs / 1000} s to render`) : notStarted())
        }, timeoutMs)
        stop = (reason) => {
          over = true
          clearTimeout(timer)
          reject(reason)
        }
        // what the script comes to once the run has answered (a page destroyed under it rejects) is no one's
        void work.then(resolve, reject).finally(() => clearTimeout(timer))
      })
    } finally {
      stop = null
      // the new page loaded, or never will for this run: either way the window before has had its time
      retire()
      // both are set in the work above, which the compiler cannot follow
      const made = page as SealedWindow | null
      const current = window as SealedWindow | null
      if (made && current === made && !made.isDestroyed() && !shut) idle = setTimeout(discard, IDLE_CLOSE_MS)
    }
  }

  return {
    run(js, timeoutMs) {
      if (shut) return Promise.reject(quitting())
      const run = turns.then(() => runOnce(js, timeoutMs))
      turns = run.catch(() => {})
      return run
    },
    close() {
      shut = true
      stop?.(quitting())
      if (window) end(window)
      retire()
      discard()
    },
  }
}
