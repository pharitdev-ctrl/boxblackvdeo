import { describe, expect, test } from "vitest"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { findExecutable } from "@boxblack/core/media"

const run = promisify(execFile)
const ffmpeg = findExecutable("ffmpeg")

function electronBinary(): string | null {
  try {
    return createRequire(import.meta.url)("electron") as string
  } catch {
    return null
  }
}
const electron = electronBinary()

// Runs in Electron, whose Node loads the app's .ts modules as they are: registers and handles the
// scheme the way the app does, loads a file:// page under the renderer's CSP (as the packaged app
// does) and reports how a <video> fares with a media URL.
const MAIN = `
import { app, BrowserWindow, protocol } from "electron"
import { join } from "node:path"
import { MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES, mediaUrl } from ${JSON.stringify(new URL("../shared/media-url.ts", import.meta.url).href)}
import { createMediaHandler } from ${JSON.stringify(new URL("./media.ts", import.meta.url).href)}

app.setPath("userData", join(import.meta.dirname, "user-data"))
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES }])

const folder = "/Users/me/Movies/CapCut/โปรเจค (1)"
const inspect = async () => ({ folder, videos: [{ id: "clip-1", path: process.env.CLIP, exists: true }] })

app.whenReady().then(async () => {
  protocol.handle(MEDIA_SCHEME, createMediaHandler(inspect))
  const window = new BrowserWindow({ show: false })
  await window.loadFile(join(import.meta.dirname, "page.html"))
  const src = mediaUrl(folder, "clip-1")
  const result = await window.webContents.executeJavaScript(\`new Promise((resolve) => {
    const video = document.createElement("video")
    const report = (event) => resolve({ event, error: video.error && video.error.code, duration: video.duration, currentTime: video.currentTime })
    // what the outline preview does to start at a beat
    video.addEventListener("loadedmetadata", () => { video.currentTime = 2.5 })
    video.addEventListener("seeked", () => report("seeked"))
    video.addEventListener("error", () => report("error"))
    setTimeout(() => report("timeout"), 15000)
    video.src = \${JSON.stringify(src)}
    document.body.append(video)
  })\`)
  console.log("RESULT " + JSON.stringify(result))
  app.quit()
})
`

describe.skipIf(!ffmpeg || !electron || process.platform !== "darwin")("with Electron and ffmpeg installed", () => {
  test("a <video> in the packaged renderer plays a full-size clip through the media scheme", { timeout: 90_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-media-"))
    const clip = join(dir, "clip.mp4")
    // a few MB with the index at the end, like camera footage; tiny clips played even when the scheme was broken
    await run(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "4M", "-pix_fmt", "yuv420p", clip])

    const html = await readFile(new URL("../renderer/index.html", import.meta.url), "utf8")
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1]
    expect(csp).toBeTruthy()
    await writeFile(join(dir, "page.html"), `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><body></body>`)
    await writeFile(join(dir, "main.mjs"), MAIN)

    const { stdout } = await run(electron!, [join(dir, "main.mjs")], { env: { ...process.env, CLIP: clip }, timeout: 60_000 })
    const line = stdout.split("\n").find((l) => l.startsWith("RESULT "))
    expect(line).toBeDefined()
    const result = JSON.parse(line!.slice("RESULT ".length)) as { event: string; error: number | null; duration: number; currentTime: number }

    expect(result).toMatchObject({ event: "seeked", error: null })
    expect(result.duration).toBeCloseTo(4, 0)
    expect(result.currentTime).toBeCloseTo(2.5, 1)
  })
})
