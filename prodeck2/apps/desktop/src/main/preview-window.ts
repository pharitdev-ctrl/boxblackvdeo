import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { drawTiles, type DrawOptions, type DrawTile } from "@boxblack/core/preview"

/**
 * The hidden page the preview is drawn in: a canvas in a window that is never shown, which draws the tiles it is
 * handed (`drawTiles`, as its source text) and answers the picture as a JPEG. Only the app's own code runs in it, and
 * everything it draws is handed in as data (frames as data URLs, fonts as bytes), so its session refuses every request
 * but about:blank and data: URLs, every permission and every download, and it has no preload, so no way to the app's
 * IPC. One window serves every draw, a draw at a time; it is closed after a while with nothing drawn.
 */

/** What the page needs of a window: Electron's BrowserWindow has all of it. */
export interface DrawWindow {
  loadURL(url: string): Promise<void>
  destroy(): void
  isDestroyed(): boolean
  webContents: {
    executeJavaScript(code: string): Promise<unknown>
    setAudioMuted(muted: boolean): void
    setWindowOpenHandler(handler: () => { action: "deny" }): void
    on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): void
  }
}

export interface DrawSession {
  webRequest: { onBeforeRequest(listener: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void): void }
  setPermissionRequestHandler(handler: (webContents: unknown, permission: string, callback: (granted: boolean) => void) => void): void
  setPermissionCheckHandler(handler: () => boolean): void
  on(event: "will-download", listener: (event: { preventDefault(): void }) => void): void
}

export interface DrawElectron {
  BrowserWindow: new (options: Record<string, unknown>) => DrawWindow
  session: { fromPartition(partition: string, options: { cache: boolean }): DrawSession }
}

/** In memory only: nothing the page holds outlives the app. */
const PARTITION = "boxblack-preview"
const IDLE_CLOSE_MS = 60_000
const DRAW_TIMEOUT_MS = 60_000

/** The fonts a draw needs, by file; the family each is drawn in is its file name without the extension. */
export type FontFiles = string[]

const familyOf = (file: string) => basename(file).replace(/\.(ttf|otf)$/i, "")

export function createDrawPage(electron: DrawElectron, deps: { readFont?: (file: string) => Promise<Buffer> } = {}) {
  const readFont = deps.readFont ?? ((file: string) => readFile(file))
  let session: DrawSession | null = null
  let window: DrawWindow | null = null
  let ready: Promise<void> | null = null
  const loaded = new Set<string>()
  let turns: Promise<unknown> = Promise.resolve()
  let idle: NodeJS.Timeout | undefined
  let shut = false

  function sealed(): DrawSession {
    if (session) return session
    const own = electron.session.fromPartition(PARTITION, { cache: false })
    own.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !(details.url === "about:blank" || details.url.startsWith("data:")) }))
    own.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    own.setPermissionCheckHandler(() => false)
    own.on("will-download", (event) => event.preventDefault())
    session = own
    return own
  }

  function discard() {
    clearTimeout(idle)
    if (window && !window.isDestroyed()) window.destroy()
    window = null
    ready = null
    loaded.clear()
  }

  function page(): Promise<void> {
    if (window && !window.isDestroyed() && ready) return ready
    discard()
    const opened = new electron.BrowserWindow({
      show: false,
      width: 400,
      height: 400,
      webPreferences: { session: sealed(), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, disableDialogs: true, webSecurity: true },
    })
    opened.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    opened.webContents.on("will-navigate", (event) => event.preventDefault())
    opened.webContents.setAudioMuted(true)
    window = opened
    ready = opened.loadURL("about:blank")
    return ready
  }

  async function withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("drawing the preview took too long")), DRAW_TIMEOUT_MS)))])
    } finally {
      clearTimeout(timer)
    }
  }

  async function drawNow(tiles: DrawTile[], options: Omit<DrawOptions, "fonts">, fonts: FontFiles): Promise<Buffer> {
    if (shut) throw new Error("the app is quitting")
    clearTimeout(idle)
    await page()
    const own = window!
    // each font once per window, as bytes: the page may load nothing from disk
    for (const file of fonts) {
      if (loaded.has(file)) continue
      const bytes = await readFont(file).catch(() => null)
      if (!bytes) continue
      await own.webContents.executeJavaScript(
        `(async () => { const b = Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}), (c) => c.charCodeAt(0)); const face = new FontFace(${JSON.stringify(familyOf(file))}, b); await face.load(); document.fonts.add(face); return true })()`,
      )
      loaded.add(file)
    }
    const families = [...loaded].map(familyOf)
    const script = `(async () => { const draw = ${String(drawTiles)}; const canvas = document.createElement("canvas"); await draw(canvas, ${JSON.stringify(tiles)}, ${JSON.stringify({ ...options, fonts: families })}); return canvas.toDataURL("image/jpeg", 0.85) })()`
    const answer = await withTimeout(own.webContents.executeJavaScript(script))
    if (typeof answer !== "string" || !answer.startsWith("data:image/jpeg;base64,")) throw new Error("the preview page drew nothing")
    idle = setTimeout(discard, IDLE_CLOSE_MS)
    return Buffer.from(answer.slice("data:image/jpeg;base64,".length), "base64")
  }

  return {
    /** Draws the tiles, after any draw under way, and answers the picture as JPEG bytes. */
    draw(tiles: DrawTile[], options: Omit<DrawOptions, "fonts">, fonts: FontFiles): Promise<Buffer> {
      const mine = turns.then(() => drawNow(tiles, options, fonts))
      // a draw that failed takes its window with it, so the next starts on a fresh page
      turns = mine.catch(() => discard())
      return mine
    },
    /** The app is quitting: the window goes, and every later draw rejects. */
    close() {
      shut = true
      discard()
    },
  }
}

export type DrawPage = ReturnType<typeof createDrawPage>
