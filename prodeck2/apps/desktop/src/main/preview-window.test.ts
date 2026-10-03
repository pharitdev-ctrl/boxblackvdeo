import { afterEach, expect, test, vi } from "vitest"
import { drawTiles, type DrawTile } from "@boxblack/core/preview"
import { createDrawPage, type DrawElectron, type DrawWindow } from "./preview-window.ts"

/** A canvas that writes down what is drawn on it. */
function recordingCanvas() {
  const calls: string[] = []
  const ctx = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 10 }) } as Record<string, unknown>,
    {
      get(target, name: string) {
        if (name in target) return target[name]
        return (...args: unknown[]) => calls.push(`${name}(${args.map((a) => (typeof a === "number" ? Math.round(a) : typeof a === "string" ? a.slice(0, 20) : "·")).join(",")})`)
      },
      set(_target, name: string, value) {
        calls.push(`${name}=${typeof value === "number" ? Math.round(value * 100) / 100 : value}`)
        return true
      },
    },
  )
  return { calls, canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement }
}

afterEach(() => vi.unstubAllGlobals())

test("the drawing code uses nothing from outside itself: run from its source text alone it draws video, bar and text in each tile", async () => {
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) {
      setTimeout(() => (value.includes("bad") ? this.onerror?.() : this.onload?.()), 0)
    }
  }
  vi.stubGlobal("Image", FakeImage)
  const draw = new Function(`return ${String(drawTiles)}`)() as typeof drawTiles
  const look = { scale: 1, x: 0, y: 0, rot: 0, alpha: 1 }
  const tiles: DrawTile[] = [
    {
      label: "1.25s",
      layers: [
        { kind: "video", segmentId: "s1", speed: 1, file: "/v.mov", photo: false, sourceUs: 0, native: { width: 1080, height: 1920 }, look, overlay: false, src: "data:image/jpeg;base64,AA" },
        { kind: "shape", width: 540, height: 120, color: "rgba(255,224,0,1)", roundness: 50, look: { ...look, y: -0.2 } },
        { kind: "text", lines: [[{ text: "ราคา ", color: [1, 1, 1], stroke: { width: 0.08, color: [0, 0, 0] } }, { text: "5", color: [1, 0, 0], stroke: null }]], sizePx: 72, font: "Mali-Bold", fontFile: "/f/Mali-Bold.ttf", subtitle: false, look: { ...look, y: 0.6, scale: 2 } },
      ],
    },
    { label: "1.75s", layers: [{ kind: "video", segmentId: "s1", speed: 1, file: "/v.mov", photo: false, sourceUs: 0, native: { width: 1080, height: 1920 }, look, overlay: false, src: "data:bad" }] },
  ]
  const { calls, canvas } = recordingCanvas()
  await draw(canvas, tiles, { canvas: { width: 1080, height: 1920 }, tile: { width: 288, height: 512 }, columns: 4, fonts: ["Mali-Bold"], fallbackFont: "Thonburi" })
  // two tiles across, one row
  expect([canvas.width, canvas.height]).toEqual([576, 512])
  expect(calls).toContain("drawImage(·,-144,-256,288,512)")
  // the bar: a rounded rect, filled in its colour
  expect(calls).toContain("fillStyle=rgba(255,224,0,1)")
  // text in the app's font at the tile's size: 72 px on 1080 is 19.2 on 288, twice for the line's scale
  expect(calls).toContain('font=38.4px "Mali-Bold"')
  expect(calls).toContain("strokeText(ราคา ,-30,0)")
  expect(calls).toContain("fillStyle=rgb(255,0,0)")
  // the time in each tile, and a grey box where a frame could not be loaded
  expect(calls.filter((call) => call.startsWith("fillText(1."))).toHaveLength(2)
  expect(calls).toContain("fillStyle=#333")
})

/** Electron, as far as the page uses it: windows whose pages answer what `answer` says. */
function fakeElectron(answer: (code: string) => unknown) {
  const windows: { scripts: string[]; destroyed: boolean; options: Record<string, unknown> }[] = []
  const blocked: boolean[] = []
  let requestFilter: ((details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) | null = null
  const electron: DrawElectron = {
    BrowserWindow: class implements DrawWindow {
      record: { scripts: string[]; destroyed: boolean; options: Record<string, unknown> }
      constructor(options: Record<string, unknown>) {
        this.record = { scripts: [], destroyed: false, options }
        windows.push(this.record)
      }
      loadURL = async () => {}
      destroy = () => void (this.record.destroyed = true)
      isDestroyed = () => this.record.destroyed
      webContents = {
        executeJavaScript: async (code: string) => {
          this.record.scripts.push(code)
          return answer(code)
        },
        setAudioMuted: () => {},
        setWindowOpenHandler: () => {},
        on: () => {},
      }
    } as unknown as DrawElectron["BrowserWindow"],
    session: {
      fromPartition: () => ({
        webRequest: { onBeforeRequest: (listener) => void (requestFilter = listener) },
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
        on: () => {},
      }),
    },
  }
  const asks = (url: string) => {
    requestFilter!({ url }, (response) => blocked.push(response.cancel))
    return blocked.at(-1)
  }
  return { electron, windows, asks }
}

const options = { canvas: { width: 1080, height: 1920 }, tile: { width: 288, height: 512 }, columns: 4, fallbackFont: "Thonburi" }

test("one hidden, sealed window draws every picture, loads each font once as bytes, and answers JPEG bytes", async () => {
  const jpeg = `data:image/jpeg;base64,${Buffer.from("picture").toString("base64")}`
  const { electron, windows, asks } = fakeElectron((code) => (code.includes("FontFace") ? true : jpeg))
  const page = createDrawPage(electron, { readFont: async () => Buffer.from("font") })
  const first = await page.draw([{ label: "0.25s", layers: [] }], options, ["/f/Mali-Bold.ttf"])
  await page.draw([{ label: "0.75s", layers: [] }], options, ["/f/Mali-Bold.ttf"])
  expect(first.toString()).toBe("picture")
  expect(windows).toHaveLength(1)
  expect(windows[0]!.options).toMatchObject({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  expect(windows[0]!.options.webPreferences).not.toHaveProperty("preload")
  const scripts = windows[0]!.scripts
  expect(scripts.filter((code) => code.includes("FontFace"))).toHaveLength(1)
  expect(scripts.filter((code) => code.includes("toDataURL"))).toHaveLength(2)
  expect(scripts.at(-1)).toContain('"fonts":["Mali-Bold"]')
  // nothing from disk or the network, only the blank page and data
  expect([asks("about:blank"), asks("data:image/png;base64,AA"), asks("file:///etc/passwd"), asks("https://example.com")]).toEqual([false, false, true, true])
  page.close()
  await expect(page.draw([], options, [])).rejects.toThrow(/quitting/)
})

test("a page that draws nothing fails the draw, and the next draw starts on a fresh window", async () => {
  let n = 0
  const { electron, windows } = fakeElectron(() => (++n === 1 ? null : "data:image/jpeg;base64,AA"))
  const page = createDrawPage(electron)
  await expect(page.draw([], options, [])).rejects.toThrow(/drew nothing/)
  await page.draw([], options, [])
  expect(windows.map((w) => w.destroyed)).toEqual([true, false])
})
