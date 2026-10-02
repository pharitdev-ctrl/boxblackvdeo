import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { placeOnCanvas, stageBox } from "@boxblack/core/graphics/framing"
import { motionAssets, motionHtml } from "@boxblack/core/graphics/motion"
import { lintFragment } from "@boxblack/core/graphics/motion/lint"
import { MOTION_VERSION, type MotionSpec } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import { ProcessError } from "@boxblack/core/media"
import type { AppEvent } from "../shared/api.ts"
import { GRAPHICS_PACK, PACK_HYPERFRAMES_VERSION } from "../shared/graphics-pack.ts"
import { createGraphicsRenderer, EnvironmentError, hashOf, inspectionOf, offlineChrome, quietHyperframesHome, renderBinDir, type Inspection, type RenderJob } from "./graphics-render.ts"

// rename can only fail across volumes, which a test cannot set up: this makes a rendered file's fail on demand, and notes every rename.
// Nor can a test fill a disk: `noRoomFor` makes the write of any file whose name ends with it fail as it does on a full one.
// `compositionsStay` makes the removal of a composition's own folder (<work>/compose/<hash>) fail, as one the app may not remove would
const fsControl = vi.hoisted(() => ({ renameFails: false, renames: [] as [string, string][], noRoomFor: null as string | null, compositionsStay: false }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...real,
    rename: async (from: string, to: string) => {
      fsControl.renames.push([from, to])
      if (fsControl.renameFails && from.endsWith(".mov")) throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${from}' -> '${to}'`), { code: "EXDEV" })
      return real.rename(from, to)
    },
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      const [file] = args
      if (fsControl.noRoomFor !== null && typeof file === "string" && file.endsWith(fsControl.noRoomFor)) throw Object.assign(new Error(`ENOSPC: no space left on device, write '${file}'`), { code: "ENOSPC" })
      return real.writeFile(...args)
    },
    rm: async (...args: Parameters<typeof real.rm>) => {
      const [path] = args
      if (fsControl.compositionsStay && typeof path === "string" && /\/compose\/[0-9a-f]{16}$/.test(path)) throw Object.assign(new Error(`EACCES: permission denied, rm '${path}'`), { code: "EACCES" })
      return real.rm(...args)
    },
  }
})

const temps: string[] = []
async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}
afterEach(async () => {
  fsControl.noRoomFor = null
  fsControl.compositionsStay = false
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const canvas = { width: 1080, height: 1920 }
/** A fragment the linter plainly passes: a style with keyframes and an animation of them, then one element. */
const FRAGMENT = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div>`
const MOTION: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 }, seconds: 3, why: "", idea: "จรวดพุ่งขึ้น", words: [{ text: "จรวด", atS: 0.2 }, { text: "พุ่ง", atS: 1.1 }], html: FRAGMENT }
/** A job for MOTION, asked for with no times: what the tests about the queue, the files and the machine render, where which graphic it is does not matter. */
const job = (over: Partial<RenderJob> = {}): RenderJob => ({ spec: MOTION, canvas, fps: 30, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, palette: HIGHLIGHT_STYLES["bold-white"].palette, ...over })
/** A graphic's job as the app makes it: its two words are said at other times now than when it was written. */
const motionJob = (over: Partial<MotionSpec> = {}, rest: Partial<RenderJob> = {}): RenderJob => job({ spec: { ...MOTION, ...over }, times: [0.25, 1.4], ...rest })
/** What the fake host script is, in every page a fake renderer builds. */
const HOST = "/*h*/"
/** What an inspection says of a good file: something is drawn, and nothing is left at the end. */
const SEEN: Inspection = { visible: true, goneAtEnd: true }

/**
 * A renderer whose `run` writes the "rendered" file, noting what sat next to the page and the page
 * itself. `gate` holds every run until it opens; `holdFirst` holds that many runs, each until the
 * test calls its `release` or its signal aborts. `answers` is what the
 * fakes say of a render, for a test to change: what the renderer printed, and what the inspection
 * saw of the file, or `"never"` for an inspection that hangs until its signal aborts. `inspected`
 * notes each file the inspection was given, whether it was there then, and whether the graphics
 * folder already held it; `inspectedUnder` is the signal each was given.
 */
async function setup(over: { fail?: boolean; gate?: Promise<void>; holdFirst?: number } = {}) {
  const dir = await temp("grender-")
  await mkdir(join(dir, "fonts"), { recursive: true })
  await writeFile(join(dir, "fonts", "Kanit-ExtraBold.ttf"), "ttf")
  const events: AppEvent[] = []
  const runs: { project: string; output: string; fps: number; signal: AbortSignal; release?: () => void; files?: string[]; html?: string }[] = []
  const answers: { printed: string | undefined; inspection: Inspection | "never" } = { printed: undefined, inspection: SEEN }
  const inspected: { mov: string; there: boolean; kept: boolean }[] = []
  const inspectedUnder: AbortSignal[] = []
  const renderer = createGraphicsRenderer({
    graphicsDir: join(dir, "graphics"), workDir: join(dir, "work"), fontDir: join(dir, "fonts"),
    motionAssets: async () => ({ host: HOST }),
    pack: async () => ({ root: "/p", node: "/p/node", hyperframes: "/p/hf.mjs", chrome: "/p/chrome" }),
    ffmpeg: () => "/usr/bin/true",
    ffprobe: () => "/usr/bin/true",
    run: async (project, output, fps, signal) => {
      const entry: (typeof runs)[number] = { project, output, fps, signal }
      runs.push(entry)
      if (over.gate) await over.gate
      if (runs.length <= (over.holdFirst ?? 0)) {
        await new Promise<void>((resolve, reject) => {
          entry.release = resolve
          if (signal.aborted) reject(signal.reason)
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      }
      if (over.fail) throw new Error("chrome crashed")
      expect(await readFile(join(project, "index.html"), "utf8")).toContain("data-composition-id")
      // the style's font sits next to the page, which names it by file
      expect(await readFile(join(project, "Kanit-ExtraBold.ttf"), "utf8")).toBe("ttf")
      entry.files = (await readdir(project)).sort()
      entry.html = await readFile(join(project, "index.html"), "utf8")
      await writeFile(output, "mov")
      return answers.printed
    },
    inspect: async (mov, signal) => {
      inspected.push({ mov, there: existsSync(mov), kept: existsSync(join(dir, "graphics", basename(mov))) })
      inspectedUnder.push(signal)
      if (answers.inspection === "never") {
        return new Promise<Inspection>((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason)
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      }
      return answers.inspection
    },
    poster: async (mov, png) => writeFile(png, "png"),
    send: (event) => events.push(event),
  })
  return { dir, events, runs, answers, inspected, inspectedUnder, renderer }
}

test("a job is named by what is drawn, by itself and as the renderer names it: what else its spec says, the fragment kept for a step back among it, makes no other file", async () => {
  const { renderer } = await setup()
  const drawn = motionJob()
  expect(hashOf(drawn)).toBe(renderer.hashOf(drawn))
  // its reason, its idea, its words as they were written, the contract stamped on it, a change asked, a failed edit and the fragment kept
  const said = motionJob({ why: "อื่น", idea: "อื่น", words: [], version: "motion-2026-01-01", instruction: "ใหญ่ขึ้น", editFailed: "timed out", previous: { html: "<style></style>", seconds: 2, words: [], version: MOTION_VERSION } })
  expect(hashOf(said)).toBe(hashOf(drawn))
  // what is drawn does
  expect(hashOf(motionJob({ html: `${FRAGMENT} ` }))).not.toBe(hashOf(drawn))
  expect(hashOf(motionJob({ seconds: 2.5 }))).not.toBe(hashOf(drawn))
  expect(hashOf(motionJob({}, { times: [0.25, 1.5] }))).not.toBe(hashOf(drawn))
})

test("the hash names the file; the same job is not rendered twice; another palette is another file", async () => {
  const { dir, renderer, runs } = await setup()
  const a = renderer.hashOf(job())
  expect(a).toMatch(/^[0-9a-f]{16}$/)
  expect(renderer.hashOf(job({ palette: HIGHLIGHT_STYLES["sale-yellow"].palette }))).not.toBe(a)
  await expect(renderer.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [a], failed: [] })
  await renderer.wait([job()], "/drafts/0917")
  expect(runs).toHaveLength(1)
  expect(runs[0]!.fps).toBe(30)
  expect(await renderer.statusOf(a)).toBe("ready")
  expect((await stat(join(dir, "graphics", `${a}.mov`))).size).toBeGreaterThan(0)
  const box = stageBox(MOTION.box, canvas)
  const meta = JSON.parse(await readFile(join(dir, "graphics", `${a}.json`), "utf8"))
  expect(meta).toEqual({ width: box.width, height: box.height, durationUs: 3_000_000, place: placeOnCanvas(box, canvas) })
  expect(await renderer.rendered(job())).toEqual({ hash: a, path: join(dir, "graphics", `${a}.mov`), ...meta })
  expect(await renderer.rendered(job({ fps: 25 }))).toBeNull()
})

test("a graphic's page is its fragment on a stage the size of its box, with the times of its words now and the style's font and colours; the font sits beside it, and nothing else does", async () => {
  const { dir, renderer, runs } = await setup()
  expect(lintFragment(FRAGMENT)).toEqual([])
  const one = motionJob()
  const hash = renderer.hashOf(one)
  expect(hash).toMatch(/^[0-9a-f]{16}$/)
  await expect(renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })
  // the stage is the box itself in even pixels, with no room added around it
  const stage = stageBox(MOTION.box, canvas)
  expect(stage).toEqual({ x: 108, y: 960, width: 864, height: 768 })
  expect(runs[0]!.html).toBe(motionHtml({ html: FRAGMENT, stage: { width: 864, height: 768 }, seconds: 3, fps: 30, times: [0.25, 1.4], palette: one.palette, font: one.font, assets: { host: HOST } }))
  expect(runs[0]!.fps).toBe(30)
  expect(runs[0]!.files).toEqual(["Kanit-ExtraBold.ttf", "index.html", "renders"])
  // made, with the meta the writer places it by: the stage, where it is on the frame
  expect(await renderer.statusOf(hash)).toBe("ready")
  const meta = JSON.parse(await readFile(join(dir, "graphics", `${hash}.json`), "utf8"))
  expect(meta).toEqual({ width: 864, height: 768, durationUs: 3_000_000, place: placeOnCanvas(stage, canvas) })
  expect(await renderer.rendered(one)).toEqual({ hash, path: join(dir, "graphics", `${hash}.mov`), ...meta })
  await renderer.wait([one], "/drafts/0917")
  expect(runs).toHaveLength(1)

  // another style's font and colours, on another frame, are the ones its page is drawn in
  await writeFile(join(dir, "fonts", "Mali-Bold.ttf"), "mali")
  const pages: { html: string; files: string[]; font: string }[] = []
  const styled = createGraphicsRenderer({
    ...renderer.deps,
    run: async (project, output) => {
      pages.push({ html: await readFile(join(project, "index.html"), "utf8"), files: (await readdir(project)).sort(), font: await readFile(join(project, "Mali-Bold.ttf"), "utf8") })
      await writeFile(output, "mov")
    },
  })
  const wide = { width: 1920, height: 1080 }
  const other = motionJob({ seconds: 2.5 }, { canvas: wide, fps: 25, font: { family: "Mali", file: "Mali-Bold.ttf" }, palette: HIGHLIGHT_STYLES["sale-yellow"].palette })
  await expect(styled.wait([other], "/drafts/0917")).resolves.toEqual({ ready: [styled.hashOf(other)], failed: [] })
  const wideStage = stageBox(MOTION.box, wide)
  expect(wideStage).toEqual({ x: 192, y: 540, width: 1536, height: 432 })
  expect(pages).toEqual([
    {
      html: motionHtml({ html: FRAGMENT, stage: { width: 1536, height: 432 }, seconds: 2.5, fps: 25, times: [0.25, 1.4], palette: HIGHLIGHT_STYLES["sale-yellow"].palette, font: { family: "Mali", file: "Mali-Bold.ttf" }, assets: { host: HOST } }),
      files: ["Mali-Bold.ttf", "index.html", "renders"],
      font: "mali",
    },
  ])
  expect(JSON.parse(await readFile(join(dir, "graphics", `${styled.hashOf(other)}.json`), "utf8"))).toEqual({ width: 1536, height: 432, durationUs: 2_500_000, place: placeOnCanvas(wideStage, wide) })
})

test("a motion graphic asked for with no times is drawn with none", async () => {
  const { renderer, runs } = await setup()
  const bare = job({ spec: MOTION })
  await expect(renderer.wait([bare], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(bare)], failed: [] })
  expect(runs[0]!.html).toBe(motionHtml({ html: FRAGMENT, stage: { width: 864, height: 768 }, seconds: 3, fps: 30, times: [], palette: bare.palette, font: bare.font, assets: { host: HOST } }))
  expect(runs[0]!.html).toContain("<script>const T = []</script>")
  // the same graphic as one asked for with an empty list
  expect(renderer.hashOf(job({ spec: MOTION, times: [] }))).toBe(renderer.hashOf(bare))
})

test("a motion graphic's poster is taken from the middle of the file once it is kept, and its meta is written last", async () => {
  const { dir, renderer } = await setup()
  const posters: { mov: string; png: string; midS: number; kept: string[] }[] = []
  const watched = createGraphicsRenderer({
    ...renderer.deps,
    poster: async (mov, png, midS) => {
      posters.push({ mov, png, midS, kept: (await readdir(join(dir, "graphics"))).sort() })
      await writeFile(png, "png")
    },
  })
  const one = motionJob({ seconds: 2.5 })
  const hash = watched.hashOf(one)
  await expect(watched.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })
  // the file alone is there when the poster is taken: no meta yet, so nothing reads the graphic as made
  expect(posters).toEqual([{ mov: join(dir, "graphics", `${hash}.mov`), png: join(dir, "graphics", `${hash}.png`), midS: 1.25, kept: [`${hash}.mov`] }])
  expect((await readdir(join(dir, "graphics"))).sort()).toEqual([`${hash}.json`, `${hash}.mov`, `${hash}.png`])
  expect(await watched.posterOf(hash)).toBe(`data:image/png;base64,${Buffer.from("png").toString("base64")}`)
})

/**
 * Lines HyperFrames 0.8.65 printed for pages whose script was broken, each render exiting 0, and for a
 * request the page's policy blocked (captured in the spike: spike/renderer-output-samples.txt in the notes
 * of the 2026-09-30 plan). A normal render prints no line that starts with [Browser:.
 */
const PRINTED = {
  syntaxError: `[initSession:screenshot] page.goto start (0ms)
[initSession:screenshot] page.goto start (0ms)
[Browser:PAGEERROR] Unexpected token ';'
[Browser:PAGEERROR] Unexpected token ';'
[FrameCapture:sub_timeline_readiness_timeout] Sub-composition timelines did not become ready within 20000ms { timeoutMs: 20000, sources: [] }
[WARN] Render completed capture with correctness warnings {"renderJobId":"cb2f4f5d-4fdb-4d7e-a344-0869287aac74","strictness":"best-effort","warningCodes":["sub_timeline_readiness_timeout"],"warningReasons":[],"warningStages":[],"warningOwners":[]}
  [sub_timeline_readiness_timeout] Sub-composition timelines did not become ready within 20000ms
`,
  frameThrows: `[initSession:screenshot] page.goto complete (69ms)
[Browser:ERROR] BOXBLACK motion error: window.frame threw: boom in frame at 0
[Browser:ERROR] BOXBLACK motion error: window.frame threw: boom in frame at 0
[Browser:ERROR] BOXBLACK motion error: window.frame threw: boom in frame at 0.0002
[Browser:ERROR] BOXBLACK motion error: window.frame threw: boom in frame at 0.001
`,
  neverReady: `[FrameCapture:sub_timeline_readiness_timeout] Sub-composition timelines did not become ready within 20000ms { timeoutMs: 20000, sources: [] }
[WARN] Render completed capture with correctness warnings {"renderJobId":"3ebf8532-9ef9-47d0-9667-d6e23f79d9ec","strictness":"best-effort","warningCodes":["sub_timeline_readiness_timeout"],"warningReasons":[],"warningStages":[],"warningOwners":[]}
  [sub_timeline_readiness_timeout] Sub-composition timelines did not become ready within 20000ms
`,
  policy: `[Browser:ERROR] Connecting to 'http://127.0.0.1:18934/loop-fetch' violates the following Content Security Policy directive: "connect-src 'none'". The action has been blocked.
[Browser:ERROR] Fetch API cannot load http://127.0.0.1:18934/loop-fetch. Refused to connect because it violates the document's Content Security Policy.
`,
}
/** A line of the host's, as HyperFrames prints what a page says through console.error. */
const said = (message: string) => `[Browser:ERROR] BOXBLACK motion error: ${message}\n`
/** What the host reports of an SVG element whose transform attribute an animation of its transform replaces (host.js has the words). */
const replaced = (n: number) => `<g class="icn i${n}"> has a transform attribute and an animation of its transform: the animation replaces the attribute, so the element jumps to the corner of the drawing. Keep the attribute on an outer <g> and animate an inner <g>`
const threw = (at: string) => `window.frame threw: boom in frame at ${at}`
/** What the app says of a page HyperFrames gave up waiting for. */
const NEVER_READY = "the page never became ready (its script did not finish)"

test("a motion graphic whose page broke fails with what the renderer printed of it, though the renderer itself reported nothing wrong; the fault is the graphic's, never the machine's", async () => {
  const cases: [what: string, printed: string, failure: string][] = [
    ["a syntax error in the script, printed once by each Chrome worker", PRINTED.syntaxError, "the script failed: Unexpected token ';'"],
    ["a page error with nothing after it", "[Browser:PAGEERROR]\n", "the script failed: (no message)"],
    ["a page error with only a space after it", "[Browser:PAGEERROR] \n", "the script failed: (no message)"],
    ["a page error too long to be read: its first 300 characters", `[Browser:PAGEERROR] ${"x".repeat(400)}\n`, `the script failed: ${"x".repeat(300)}`],
    // the host's reports, one a line: what window.frame threw first, then the rest, each in the order it came
    ["a window.frame that throws another message on each frame, among elements the host reported: five are named and the rest counted", `${PRINTED.frameThrows}${said(replaced(1))}${said(threw("0.0333"))}${said(replaced(2))}${said(replaced(1))}${said(replaced(3))}`, [threw("0"), threw("0.0002"), threw("0.001"), threw("0.0333"), replaced(1), "and 2 more"].join("\n")],
    ["five reports: none is left to count", `${said(replaced(1))}${said(threw("0"))}${said(replaced(2))}${said(threw("0.0002"))}${said(replaced(3))}`, [threw("0"), threw("0.0002"), replaced(1), replaced(2), replaced(3)].join("\n")],
    ["six reports: one is left to count", `${said(replaced(1))}${said(replaced(2))}${said(replaced(3))}${said(replaced(4))}${said(replaced(5))}${said(replaced(6))}`, [replaced(1), replaced(2), replaced(3), replaced(4), replaced(5), "and 1 more"].join("\n")],
    ["one message, said once by each Chrome worker", `${said("window.frame threw: boom")}${said("window.frame threw: boom")}`, "window.frame threw: boom"],
    // as HyperFrames printed them for the trial's fifth fragment: each element once from each worker
    ["three elements, each said by both workers", `${said(replaced(1))}${said(replaced(2))}${said(replaced(3))}${said(replaced(1))}${said(replaced(2))}${said(replaced(3))}`, [replaced(1), replaced(2), replaced(3)].join("\n")],
    ["a message too long to be read: its first 300 characters, and two alike that far are one", `${said(`window.frame threw: ${"x".repeat(300)} in frame 1`)}${said(`window.frame threw: ${"x".repeat(300)} in frame 2`)}`, `window.frame threw: ${"x".repeat(280)}`],
    ["a message cut where a character would be split keeps its characters whole", said(`window.frame threw: ${"x".repeat(279)}🚀 and more`), `window.frame threw: ${"x".repeat(279)}`],
    ["a report with nothing in it", "[Browser:ERROR] BOXBLACK motion error:\n", "(no message)"],
    ["a page that never became ready", PRINTED.neverReady, NEVER_READY],
    // of the three kinds the first wins, wherever each was printed
    ["all three kinds, the script's own error printed last", `${PRINTED.neverReady}${PRINTED.frameThrows}[Browser:PAGEERROR] Unexpected token ';'\n`, "the script failed: Unexpected token ';'"],
    ["the host's report, printed after the page was given up on", `${PRINTED.neverReady}${said("window.frame threw: boom")}`, "window.frame threw: boom"],
  ]
  for (const [what, printed, failure] of cases) {
    const { dir, answers, events, renderer, runs } = await setup()
    answers.printed = printed
    const one = motionJob()
    const hash = renderer.hashOf(one)
    await expect(renderer.wait([one], "/drafts/0917"), what).resolves.toEqual({ ready: [], failed: [hash] })
    expect(renderer.failureOf(hash), what).toBe(failure)
    expect(events, what).toContainEqual({ type: "graphics", folder: "/drafts/0917", state: "failed", hash, error: failure })
    expect(await renderer.statusOf(hash), what).toBe("failed")
    expect(existsSync(join(dir, "graphics", `${hash}.mov`)), what).toBe(false)
    // the machine is fit: the same graphic renders once its page prints nothing of the kind
    expect(renderer.environmentProblem(), what).toBeNull()
    expect(renderer.machineReady(), what).toBe(true)
    answers.printed = undefined
    renderer.retry(hash)
    await expect(renderer.wait([one], "/drafts/0917"), what).resolves.toEqual({ ready: [hash], failed: [] })
    expect(runs, what).toHaveLength(2)
  }
})

test("what else the renderer prints fails no motion graphic: a request the page's policy blocked, a warning, a line that only holds one of the markers further in, or nothing at all", async () => {
  const harmless = [
    PRINTED.policy,
    "[WARN] something the renderer warned of\n[Browser:ERROR] something the fragment said through console.error\n",
    // a marker counts at the start of a line, where HyperFrames prints it, and nowhere else
    "[INFO] the page said [Browser:PAGEERROR] Unexpected token ';'\n[Browser:ERROR] it said: [Browser:ERROR] BOXBLACK motion error: window.frame threw: boom\n",
    "",
    undefined,
  ]
  for (const printed of harmless) {
    const { answers, renderer } = await setup()
    answers.printed = printed
    const one = motionJob()
    await expect(renderer.wait([one], "/drafts/0917"), printed).resolves.toEqual({ ready: [renderer.hashOf(one)], failed: [] })
  }
})

test("a motion graphic's fragment is checked again when it is rendered: one the linter refuses fails with its first three problems, and nothing is written or rendered", async () => {
  const { dir, renderer, runs } = await setup()
  // refused however the linter's finer rules stand: things loaded, embedded and played, and nothing that moves
  const refused = `<script src="x"></script><iframe></iframe><img src="y.png"><video></video>`
  const problems = lintFragment(refused)
  expect(problems.length).toBeGreaterThan(3)
  const bad = motionJob({ html: refused })
  const hash = renderer.hashOf(bad)
  await expect(renderer.wait([bad], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(renderer.failureOf(hash)).toBe(`the fragment was refused: ${problems.slice(0, 3).join("; ")}`)
  expect(renderer.failureOf(hash)).not.toContain("\n")
  expect(runs).toHaveLength(0)
  expect(existsSync(join(dir, "work"))).toBe(false)
  // the graphic's own failure: the machine is fit, and a good one behind it renders
  expect(renderer.machineReady()).toBe(true)
  await expect(renderer.wait([bad, motionJob()], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(motionJob())], failed: [hash] })
  expect(runs).toHaveLength(1)
})

test("a motion graphic that has not been written fails, and nothing is rendered", async () => {
  const { dir, renderer, runs } = await setup()
  const unwritten = motionJob({ html: null })
  const hash = renderer.hashOf(unwritten)
  await expect(renderer.wait([unwritten], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(renderer.failureOf(hash)).toBe("the graphic has not been written")
  expect(runs).toHaveLength(0)
  expect(existsSync(join(dir, "work"))).toBe(false)
  expect(renderer.machineReady()).toBe(true)
})

test("a motion graphic's font is named by its file alone too: a path in its place fails it before anything is said of its fragment", async () => {
  const { dir, renderer, runs } = await setup()
  const font = { family: "Kanit", file: "../fonts/Kanit-ExtraBold.ttf" }
  // one not written, and one the linter would refuse: neither is looked at
  for (const sneaky of [motionJob({ html: null }, { font }), motionJob({ html: `<script src="x"></script>` }, { font }), motionJob({}, { font })]) {
    const hash = renderer.hashOf(sneaky)
    await expect(renderer.wait([sneaky], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
    expect(renderer.failureOf(hash)).toBe("a graphic's font must be a file name alone, not ../fonts/Kanit-ExtraBold.ttf")
  }
  expect(runs).toHaveLength(0)
  expect(existsSync(join(dir, "work"))).toBe(false)
})

test("a motion graphic that draws nothing, or is still on screen at its end, fails: the failure is the graphic's, kept until it is retried", async () => {
  const cases: [Inspection, string][] = [
    [{ visible: false, goneAtEnd: true }, "nothing was drawn: every frame is empty"],
    [{ visible: true, goneAtEnd: false }, "it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D"],
  ]
  for (const [inspection, failure] of cases) {
    const { answers, events, renderer, runs } = await setup()
    answers.inspection = inspection
    const one = motionJob()
    const hash = renderer.hashOf(one)
    await expect(renderer.wait([one], "/drafts/0917"), failure).resolves.toEqual({ ready: [], failed: [hash] })
    expect(renderer.failureOf(hash)).toBe(failure)
    expect(await renderer.statusOf(hash)).toBe("failed")
    expect(events).toContainEqual({ type: "graphics", folder: "/drafts/0917", state: "failed", hash, error: failure })
    // not the machine's: nothing else is held back for it
    expect(renderer.environmentProblem()).toBeNull()
    expect(renderer.machineReady()).toBe(true)
    // kept: asked for again, it is not rendered again
    await expect(renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
    expect(runs).toHaveLength(1)
    // until it is retried, when it is rendered and looked at afresh
    answers.inspection = SEEN
    renderer.retry(hash)
    expect(renderer.failureOf(hash)).toBeNull()
    await expect(renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })
    expect(runs).toHaveLength(2)
  }
})

test("a motion graphic is inspected where HyperFrames wrote it, before it is kept: one that is refused leaves no file, poster or meta in the graphics folder", async () => {
  const { dir, answers, inspected, renderer, runs } = await setup()
  const kept = (hash: string) => ["mov", "png", "json"].filter((kind) => existsSync(join(dir, "graphics", `${hash}.${kind}`)))
  const written = (hash: string) => join(dir, "work", "compose", hash, "renders", `${hash}.mov`)

  answers.inspection = { visible: false, goneAtEnd: true }
  const empty = motionJob()
  await renderer.wait([empty], "/drafts/0917")
  expect(inspected).toEqual([{ mov: written(renderer.hashOf(empty)), there: true, kept: false }])
  expect(inspected[0]!.mov).toBe(runs[0]!.output)
  expect(kept(renderer.hashOf(empty))).toEqual([])

  // one whose script broke is refused by what the renderer printed, and is not looked at: that says more than an empty picture does
  answers.printed = PRINTED.syntaxError
  const broken = motionJob({ seconds: 4 })
  await renderer.wait([broken], "/drafts/0917")
  expect(renderer.failureOf(renderer.hashOf(broken))).toBe("the script failed: Unexpected token ';'")
  expect(inspected).toHaveLength(1)
  expect(kept(renderer.hashOf(broken))).toEqual([])
  // nothing is left of either composition
  expect(await readdir(join(dir, "work", "compose"))).toEqual([])

  // one that passes is looked at the same way, and only then kept whole
  answers.printed = undefined
  answers.inspection = SEEN
  const good = motionJob({ seconds: 5 })
  await expect(renderer.wait([good], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(good)], failed: [] })
  expect(inspected[1]).toEqual({ mov: written(renderer.hashOf(good)), there: true, kept: false })
  expect(kept(renderer.hashOf(good))).toEqual(["mov", "png", "json"])
})

test("a motion graphic's render that HyperFrames fails keeps what it said as the failure, and nothing is inspected or kept", async () => {
  const { dir, inspected, renderer } = await setup({ fail: true })
  const one = motionJob()
  const hash = renderer.hashOf(one)
  await expect(renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(renderer.failureOf(hash)).toBe("chrome crashed")
  expect(inspected).toEqual([])
  expect(existsSync(join(dir, "graphics"))).toBe(false)
  expect(renderer.machineReady()).toBe(true)
})

test("a motion host that cannot be read, a font that cannot be copied and an ffmpeg that is not there to inspect with are the app's problems: no motion graphic fails for them", async () => {
  const hostless = await setup()
  let readable = false
  const noHost = createGraphicsRenderer({
    ...hostless.renderer.deps,
    motionAssets: async () => {
      if (!readable) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${join(hostless.dir, "graphics", "host.js")}'`), { code: "ENOENT" })
      return { host: HOST }
    },
  })
  expect(noHost.machineReady()).toBe(true)
  // a graphic cannot be drawn without the host; another asked for behind it then waits as for any fault of the machine
  const one = motionJob()
  await expect(noHost.wait([one, job({ fps: 25 })], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(noHost.failureOf(noHost.hashOf(one))).toBeNull()
  expect(await noHost.statusOf(noHost.hashOf(one))).toBe("waiting")
  // short, saying how to put it right, and with no path in it: it is shown to the user as it is
  expect(noHost.environmentProblem()).toEqual({ text: "the app's motion host is missing: reinstall BOXBLACK" })
  expect(noHost.machineReady()).toBe(false)
  expect(hostless.runs).toHaveLength(0)
  expect(hostless.events.some((event) => event.type === "graphics" && event.state === "failed")).toBe(false)
  // the page it was for is not left behind
  expect(existsSync(join(hostless.dir, "work", "compose", noHost.hashOf(one)))).toBe(false)
  // put right and told so, the same graphic renders
  readable = true
  noHost.forgetFailures()
  await expect(noHost.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [noHost.hashOf(one)], failed: [] })

  const fontless = await setup()
  await rm(join(fontless.dir, "fonts", "Kanit-ExtraBold.ttf"))
  await expect(fontless.renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(fontless.renderer.failureOf(fontless.renderer.hashOf(one))).toBeNull()
  expect(fontless.renderer.environmentProblem()).toEqual({ text: "the app's font Kanit-ExtraBold.ttf could not be copied (ENOENT)" })
  expect(fontless.runs).toHaveLength(0)

  // with no ffmpeg the file HyperFrames made cannot be looked at: it is not kept, and not failed either
  const blind = await setup()
  const noFfmpeg = createGraphicsRenderer({ ...blind.renderer.deps, inspect: undefined, ffmpeg: () => null })
  await expect(noFfmpeg.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(noFfmpeg.failureOf(noFfmpeg.hashOf(one))).toBeNull()
  expect(noFfmpeg.environmentProblem()).toEqual({ text: "the app's ffmpeg is missing" })
  expect(blind.runs).toHaveLength(1)
  expect(existsSync(join(blind.dir, "graphics"))).toBe(false)
})

const bareDeps = { graphicsDir: "/g", workDir: "/w", fontDir: "/f", motionAssets: async () => ({ host: "" }), pack: async () => null, ffmpeg: () => null, ffprobe: () => null, send: () => {} }

test("everything the picture depends on is part of the hash", () => {
  const { hashOf } = createGraphicsRenderer(bareDeps)
  const hashes = [
    job(),
    job({ spec: { ...MOTION, box: { ...MOTION.box, y0: 0.55 } } }),
    job({ spec: { ...MOTION, html: FRAGMENT.replace("ก", "ข") } }),
    job({ spec: { ...MOTION, seconds: 4 } }),
    job({ times: [0.25] }),
    job({ canvas: { width: 1920, height: 1080 } }),
    job({ fps: 60 }),
    job({ font: { family: "Mali", file: "Mali-Bold.ttf" } }),
    job({ palette: { ...HIGHLIGHT_STYLES["bold-white"].palette, bar: [1, 2, 3] } }),
  ].map(hashOf)
  expect(new Set(hashes).size).toBe(hashes.length)
  expect(hashOf(job())).toBe(hashes[0])
})

test("a motion graphic's hash is of what its page is made from and the contract in force now: the fragment, each time, the box, the length, the frame, the frame rate, the font and the colours, and nothing else", () => {
  const { hashOf } = createGraphicsRenderer(bareDeps)
  const base = motionJob()
  const drawn = [
    base,
    motionJob({ html: FRAGMENT.replace("ก", "ข") }),
    motionJob({}, { times: [0.3, 1.4] }),
    motionJob({}, { times: [0.25, 1.5] }),
    motionJob({}, { times: [0.25] }),
    motionJob({ box: { ...MOTION.box, y0: 0.55 } }),
    motionJob({ seconds: 4 }),
    motionJob({}, { canvas: { width: 1920, height: 1080 } }),
    motionJob({}, { fps: 60 }),
    motionJob({}, { font: { family: "Mali", file: "Mali-Bold.ttf" } }),
    motionJob({}, { palette: { ...HIGHLIGHT_STYLES["bold-white"].palette, bar: [1, 2, 3] } }),
  ].map(hashOf)
  expect(new Set(drawn).size).toBe(drawn.length)
  expect(hashOf(motionJob())).toBe(drawn[0])
  // what is not drawn leaves the file as it is: Claude's reason, the idea, the words as they were when it was written,
  // a failed writing noted on it, and the version stamped on the spec
  for (const same of [{ why: "another reason" }, { idea: "อย่างอื่น" }, { words: [] }, { failed: "the writing failed once" }, { version: "motion-older" }]) expect(hashOf(motionJob(same)), JSON.stringify(same)).toBe(drawn[0])
  // the contract in force now is the shipped one, whatever version the spec was stamped with
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)
  expect(drawn[0]).toBe(sha([FRAGMENT, MOTION.box, 3, [0.25, 1.4], base.canvas, base.fps, base.font, base.palette, MOTION_VERSION]))
})

test("ensure() renders in the background one at a time and reports each graphic as it is made; wait() joins what is already under way", async () => {
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  const { events, renderer, runs } = await setup({ gate })
  const longer = job({ spec: { ...MOTION, seconds: 4 } })
  renderer.ensure([job(), longer], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(await renderer.statusOf(renderer.hashOf(job()))).toBe("rendering")
  expect(await renderer.statusOf(renderer.hashOf(longer))).toBe("waiting")
  const waited = renderer.wait([longer], "/drafts/0918")
  open()
  await expect(waited).resolves.toEqual({ ready: [renderer.hashOf(longer)], failed: [] })
  await vi.waitFor(() => expect(events.filter((event) => event.type === "graphics" && event.state === "done")).toHaveLength(2))
  expect(runs).toHaveLength(2)
  // each render's start is told to the project that queued it, as it happens
  const of = (folder: string) => events.filter((event) => event.type === "graphics" && event.folder === folder && event.state !== "started")
  const started = events.filter((event) => event.type === "graphics" && event.state === "started")
  expect(started).toEqual([
    { type: "graphics", folder: "/drafts/0917", state: "started", hash: renderer.hashOf(job()) },
    { type: "graphics", folder: "/drafts/0917", state: "started", hash: renderer.hashOf(longer) },
  ])
  expect(of("/drafts/0917")).toEqual([
    { type: "graphics", folder: "/drafts/0917", state: "progress", hash: renderer.hashOf(job()), done: 1, total: 2 },
    { type: "graphics", folder: "/drafts/0917", state: "progress", hash: renderer.hashOf(longer), done: 2, total: 2 },
    { type: "graphics", folder: "/drafts/0917", state: "done" },
  ])
  expect(of("/drafts/0918")).toEqual([{ type: "graphics", folder: "/drafts/0918", state: "progress", hash: renderer.hashOf(longer), done: 1, total: 1 }, { type: "graphics", folder: "/drafts/0918", state: "done" }])
  expect(await renderer.statusOf(renderer.hashOf(job()))).toBe("ready")
})

test("asking for graphics already made or failed, or for none, queues nothing and says nothing", async () => {
  const { renderer, events, runs } = await setup()
  const made = job()
  await renderer.wait([made], "/drafts/0917")
  const failing = createGraphicsRenderer({ ...renderer.deps, run: async () => Promise.reject(new Error("chrome crashed")) })
  const broken = job({ fps: 25 })
  await failing.wait([broken], "/drafts/0917")
  events.length = 0
  failing.ensure([made, broken], "/drafts/0917")
  failing.ensure([], "/drafts/0917")
  await expect(failing.wait([made, broken, made, broken], "/drafts/0917")).resolves.toEqual({ ready: [failing.hashOf(made)], failed: [failing.hashOf(broken)] })
  await expect(failing.wait([], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  // each ask is sorted in the order it came, so by now the ensures above have had their say
  const other = job({ fps: 24 })
  await renderer.wait([other, other], "/drafts/0918")
  expect(events).toEqual([
    { type: "graphics", folder: "/drafts/0918", state: "started", hash: renderer.hashOf(other) },
    { type: "graphics", folder: "/drafts/0918", state: "progress", hash: renderer.hashOf(other), done: 1, total: 1 },
    { type: "graphics", folder: "/drafts/0918", state: "done" },
  ])
  expect(runs).toHaveLength(2)
})

test("a render says when it starts, while it reads as rendering; the look at the preview that brings about asks for nothing new", async () => {
  const { renderer, runs } = await setup({ holdFirst: 2 })
  const two = [job(), job({ fps: 25 })]
  const events: AppEvent[] = []
  const seen: Promise<string>[] = []
  let looks = 0
  // the post-production page reads the preview again on every graphics event for its project, and that read asks for the same graphics
  const room: typeof renderer = createGraphicsRenderer({
    ...renderer.deps,
    send: (event) => {
      events.push(event)
      if (event.type !== "graphics") return
      if (event.state === "started") seen.push(room.statusOf(event.hash))
      if (++looks < 100) room.ensure(two, "/drafts/0917")
    },
  })
  room.ensure(two, "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(await seen[0]).toBe("rendering")
  runs[0]!.release!()
  await vi.waitFor(() => expect(runs).toHaveLength(2))
  expect(await seen[1]).toBe("rendering")
  runs[1]!.release!()
  await expect(room.wait(two, "/drafts/0917")).resolves.toEqual({ ready: two.map(room.hashOf), failed: [] })
  await vi.waitFor(() => expect(room.idle()).toBe(true))
  const heard = events.length
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(events.length).toBe(heard)
  expect(looks).toBeLessThan(100)
  expect(runs).toHaveLength(2)
  expect(events.filter((event) => event.type === "graphics" && event.state === "started")).toEqual(two.map((one) => ({ type: "graphics", folder: "/drafts/0917", state: "started", hash: room.hashOf(one) })))
})

test("idle() says whether anything asked for is still being sorted, queued or rendered", async () => {
  const { renderer, runs } = await setup({ holdFirst: 1 })
  expect(renderer.idle()).toBe(true)
  const waited = renderer.wait([job(), job({ fps: 25 })], "/drafts/0917")
  expect(renderer.idle()).toBe(false)
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(renderer.idle()).toBe(false)
  runs[0]!.release!()
  await waited
  expect(renderer.idle()).toBe(true)
  // a look at graphics already made is over once they are sorted
  renderer.ensure([job()], "/drafts/0917")
  expect(renderer.idle()).toBe(false)
  await vi.waitFor(() => expect(renderer.idle()).toBe(true))
  // and a cancelled queue is over once the render under way has stopped
  const cancelled = createGraphicsRenderer({ ...renderer.deps, run: (_project, _output, _fps, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) })
  cancelled.ensure([job({ fps: 24 }), job({ fps: 23 })], "/drafts/0917")
  await vi.waitFor(async () => expect(await cancelled.statusOf(cancelled.hashOf(job({ fps: 24 })))).toBe("rendering"))
  cancelled.cancel()
  await vi.waitFor(() => expect(cancelled.idle()).toBe(true))
})

test("a graphic already made does not wait behind a render under way", async () => {
  const { renderer, runs } = await setup({ holdFirst: 2 })
  const made = job()
  const waited = renderer.wait([made], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  runs[0]!.release!()
  await waited
  const other = job({ fps: 25 })
  renderer.ensure([other], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(2))
  // settles while the other render is still held open
  await expect(renderer.wait([made], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(made)], failed: [] })
  runs[1]!.release!()
  await renderer.wait([other], "/drafts/0917")
})

test("a graphic is made only when its meta reads and its file is there: anything less is rendered again", async () => {
  const meta = JSON.stringify({ width: 10, height: 10, durationUs: 1, place: { scale: 1, x: 0, y: 0 } })
  for (const [json, mov] of [["", true], ['{"width": 10, "hei', true], [meta, false]] as const) {
    const { dir, renderer, runs } = await setup()
    const hash = renderer.hashOf(job())
    await mkdir(join(dir, "graphics"), { recursive: true })
    await writeFile(join(dir, "graphics", `${hash}.json`), json)
    if (mov) await writeFile(join(dir, "graphics", `${hash}.mov`), "left over")
    expect(await renderer.statusOf(hash), json).toBe("waiting")
    expect(await renderer.rendered(job())).toBeNull()
    await expect(renderer.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })
    expect(runs).toHaveLength(1)
    expect(await readFile(join(dir, "graphics", `${hash}.mov`), "utf8")).toBe("mov")
    expect(await renderer.rendered(job())).toMatchObject({ hash, width: stageBox(MOTION.box, canvas).width })
  }
})

test("the meta is written whole, through a file renamed into place", async () => {
  const { dir, renderer } = await setup()
  fsControl.renames.length = 0
  await renderer.wait([job()], "/drafts/0917")
  const json = join(dir, "graphics", `${renderer.hashOf(job())}.json`)
  expect(fsControl.renames).toContainEqual([expect.stringMatching(/\.json\.\d+-\d+\.tmp$/), json])
})

test("a failed render is remembered until retried, and reported", async () => {
  const { dir, events, renderer, runs } = await setup({ fail: true })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(await renderer.statusOf(hash)).toBe("failed")
  expect(renderer.failureOf(hash)).toContain("chrome crashed")
  expect(renderer.failureOf(renderer.hashOf(job({ fps: 25 })))).toBeNull()
  expect(events).toContainEqual({ type: "graphics", folder: "/drafts/0917", state: "failed", hash, error: expect.stringContaining("chrome crashed") })
  await renderer.wait([job()], "/drafts/0917")
  expect(runs).toHaveLength(1)
  renderer.retry(hash)
  expect(await renderer.statusOf(hash)).toBe("waiting")
  await renderer.wait([job()], "/drafts/0917")
  expect(runs).toHaveLength(2)
  // nothing is left of the composition, made or not
  expect(await readdir(join(dir, "work", "compose"))).toEqual([])
})

test("a failure says what went wrong and no more: a plain error's message alone, any other error as it reads, and the same in the event as in what is kept", async () => {
  const thrown: [error: unknown, says: string][] = [
    [new Error("chrome crashed"), "chrome crashed"],
    // with no message there is only the name to give
    [new Error(""), "Error"],
    // another kind of error keeps its name, which says what kind of thing went wrong
    [new TypeError("project is not a folder"), "TypeError: project is not a folder"],
    // and what is no error at all is said as it reads. A HyperFrames that exits with an error is another matter: it
    // is read by what it printed, in the tests of that below
    ["just words", "just words"],
  ]
  for (const [error, says] of thrown) {
    const { events, renderer } = await setup()
    const failing = createGraphicsRenderer({ ...renderer.deps, run: async () => Promise.reject(error) })
    const hash = failing.hashOf(job())
    await expect(failing.wait([job()], "/drafts/0917"), says).resolves.toEqual({ ready: [], failed: [hash] })
    expect(failing.failureOf(hash)).toBe(says)
    expect(events).toContainEqual({ type: "graphics", folder: "/drafts/0917", state: "failed", hash, error: says })
  }
})

test("forgetFailures() lets a failed graphic render again when next asked", async () => {
  let fail = true
  const { renderer, runs } = await setup()
  const flaky = createGraphicsRenderer({
    ...renderer.deps,
    run: async (project, output, fps, signal) => {
      if (fail) throw new Error("chrome crashed")
      return renderer.deps.run!(project, output, fps, signal)
    },
  })
  const hash = flaky.hashOf(job())
  await expect(flaky.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  fail = false
  flaky.forgetFailures()
  expect(flaky.failureOf(hash)).toBeNull()
  expect(await flaky.statusOf(hash)).toBe("waiting")
  await expect(flaky.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })
  expect(runs).toHaveLength(1)
})

test("a font that cannot be copied is the app's problem, not the graphic's: nothing fails, nothing more is tried, until forgetFailures()", async () => {
  const { dir, events, renderer, runs } = await setup()
  const two = [job(), job({ fps: 25 })]
  await rm(join(dir, "fonts", "Kanit-ExtraBold.ttf"))
  await expect(renderer.wait(two, "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  for (const one of two) {
    expect(renderer.failureOf(renderer.hashOf(one))).toBeNull()
    expect(await renderer.statusOf(renderer.hashOf(one))).toBe("waiting")
  }
  // short, and with no path in it: it is shown to the user as it is
  expect(renderer.environmentProblem()).toEqual({ text: "the app's font Kanit-ExtraBold.ttf could not be copied (ENOENT)" })
  expect(renderer.machineReady()).toBe(false)
  expect(events.some((event) => event.type === "graphics" && event.state === "failed")).toBe(false)
  // put right, but the renderer is not told: an ask queues nothing and says nothing, so a room reading on every event cannot loop
  await writeFile(join(dir, "fonts", "Kanit-ExtraBold.ttf"), "ttf")
  events.length = 0
  renderer.ensure(two, "/drafts/0917")
  await expect(renderer.wait(two, "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(events).toEqual([])
  expect(runs).toHaveLength(0)
  renderer.forgetFailures()
  expect(renderer.environmentProblem()).toBeNull()
  expect(renderer.machineReady()).toBe(true)
  await expect(renderer.wait(two, "/drafts/0917")).resolves.toEqual({ ready: two.map(renderer.hashOf), failed: [] })
})

test("what is wrong with the machine is kept to its last line, for the app to show", async () => {
  const { renderer } = await setup()
  const noisy = createGraphicsRenderer({
    ...renderer.deps,
    run: async () => {
      throw new EnvironmentError("Error: something below gave way\n    at a (x.js:1)\nthe graphics renderer is damaged\n\n")
    },
  })
  await noisy.wait([job()], "/drafts/0917")
  expect(noisy.environmentProblem()).toEqual({ text: "the graphics renderer is damaged" })
})

test("a machine the first render of a wait finds unfit renders none of the jobs queued behind it", async () => {
  const { renderer, events } = await setup()
  const ran: string[] = []
  const unfit = createGraphicsRenderer({
    ...renderer.deps,
    run: async (project) => {
      ran.push(project)
      throw new EnvironmentError("the graphics renderer is damaged")
    },
  })
  const two = [job(), job({ fps: 25 })]
  await expect(unfit.wait(two, "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(ran).toHaveLength(1)
  for (const one of two) expect(unfit.failureOf(unfit.hashOf(one))).toBeNull()
  expect(events.filter((event) => event.type === "graphics" && event.state === "started")).toHaveLength(1)
})

test("no pack: nothing renders, status says waiting, wait() reports them as not ready without throwing", async () => {
  const { renderer, runs } = await setup()
  const none = createGraphicsRenderer({ ...renderer.deps, pack: async () => null })
  expect(await none.wait([job()], "/drafts/0917")).toEqual({ ready: [], failed: [] })
  expect(await none.statusOf(none.hashOf(job()))).toBe("waiting")
  expect(runs).toHaveLength(0)
})

test("a wait for a graphic already under way joins it, rather than waiting behind the rest of the queue", async () => {
  const { renderer, runs } = await setup({ holdFirst: 2 })
  const other = job({ fps: 25 })
  renderer.ensure([job(), other], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  const waited = renderer.wait([job()], "/drafts/0918")
  runs[0]!.release!()
  await vi.waitFor(() => expect(runs).toHaveLength(2))
  // the other render is held open until after this: a wait queued behind it would never settle here
  await expect(waited).resolves.toEqual({ ready: [renderer.hashOf(job())], failed: [] })
  runs[1]!.release!()
  await renderer.wait([other], "/drafts/0917")
})

test("cancel() stops the render in flight; a cancelled graphic is not a failure and renders when next asked", async () => {
  const { renderer, runs, events } = await setup({ holdFirst: 2 })
  const hash = renderer.hashOf(job())
  const waited = renderer.wait([job()], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(runs[0]!.signal.aborted).toBe(false)
  renderer.cancel()
  expect(runs[0]!.signal.aborted).toBe(true)
  await expect(waited).resolves.toEqual({ ready: [], failed: [] })
  expect(await renderer.statusOf(hash)).toBe("waiting")
  expect(renderer.failureOf(hash)).toBeNull()
  expect(events.some((event) => event.type === "graphics" && event.state === "failed")).toBe(false)
  // nothing in flight: a cancel then is a no-op, and the next ask renders it again
  renderer.cancel()
  const again = renderer.wait([job()], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(2))
  expect(runs[1]!.signal.aborted).toBe(false)
  renderer.cancel()
  await again
})

test("cancel() stops the whole queue: nothing queued then starts or counts as failed, and what is asked later renders", async () => {
  const { renderer, runs, events } = await setup({ holdFirst: 1 })
  const three = [job(), job({ fps: 25 }), job({ fps: 24 })]
  const waited = renderer.wait(three, "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  renderer.cancel()
  await expect(waited).resolves.toEqual({ ready: [], failed: [] })
  expect(runs).toHaveLength(1)
  for (const one of three) {
    expect(renderer.failureOf(renderer.hashOf(one))).toBeNull()
    expect(await renderer.statusOf(renderer.hashOf(one))).toBe("waiting")
  }
  expect(events.some((event) => event.type === "graphics" && event.state === "failed")).toBe(false)
  // the quit was called off and the app goes on: so do its renders
  await expect(renderer.wait(three, "/drafts/0917")).resolves.toEqual({ ready: three.map(renderer.hashOf), failed: [] })
  expect(runs).toHaveLength(4)
})

test("a graphic asked for right after cancel() renders, rather than joining the cancelled one", async () => {
  const { renderer, runs } = await setup({ holdFirst: 1 })
  renderer.ensure([job()], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  renderer.cancel()
  await expect(renderer.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(job())], failed: [] })
  expect(runs).toHaveLength(2)
})

test("a cancel while a job checks for the renderer pack stops it before it starts", async () => {
  const { renderer, runs } = await setup()
  let open!: () => void
  const packChecked = new Promise<void>((resolve) => (open = resolve))
  let asked = 0
  const slow = createGraphicsRenderer({
    ...renderer.deps,
    pack: async () => {
      asked++
      await packChecked
      return renderer.deps.pack()
    },
  })
  const waited = slow.wait([job()], "/drafts/0917")
  await vi.waitFor(() => expect(asked).toBe(1))
  slow.cancel()
  open()
  await expect(waited).resolves.toEqual({ ready: [], failed: [] })
  expect(runs).toHaveLength(0)
})

test("a render that runs past its time is stopped and counts as failed, unlike a cancel", async () => {
  const { renderer, runs, events } = await setup({ holdFirst: 1 })
  const slow = createGraphicsRenderer({ ...renderer.deps, renderTimeoutMs: 50 })
  const hash = slow.hashOf(job())
  await expect(slow.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(runs[0]!.signal.aborted).toBe(true)
  expect(slow.failureOf(hash)).toBe(OUT_OF_TIME)
  expect(events).toContainEqual(expect.objectContaining({ type: "graphics", state: "failed", hash }))
})

test("nothing the app hands in can stop the queue: a pack or an event that throws is caught, and is no graphic's failure", async () => {
  const unhandled: unknown[] = []
  const listener = (reason: unknown) => unhandled.push(reason)
  process.on("unhandledRejection", listener)
  try {
    const { renderer, runs } = await setup()
    const deaf = createGraphicsRenderer({ ...renderer.deps, send: () => { throw new Error("the window is gone") } })
    const hash = deaf.hashOf(job())
    deaf.ensure([job({ fps: 25 })], "/drafts/0917")
    await expect(deaf.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })
    expect(deaf.failureOf(hash)).toBeNull()
    const broken = createGraphicsRenderer({ ...renderer.deps, pack: async () => { throw new Error("installed.json is a folder") } })
    const other = job({ fps: 24 })
    broken.ensure([other], "/drafts/0917")
    await expect(broken.wait([other], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
    expect(broken.failureOf(broken.hashOf(other))).toBeNull()
    expect(runs).toHaveLength(2)
    await new Promise((resolve) => setImmediate(resolve))
    expect(unhandled).toEqual([])
  } finally {
    process.off("unhandledRejection", listener)
  }
})

test("a font is named by its file alone: a path in its place fails the graphic before anything is copied", async () => {
  const { renderer, runs } = await setup()
  const sneaky = job({ font: { family: "Kanit", file: "../fonts/Kanit-ExtraBold.ttf" } })
  const hash = renderer.hashOf(sneaky)
  await expect(renderer.wait([sneaky], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(renderer.failureOf(hash)).toContain("../fonts/Kanit-ExtraBold.ttf")
  expect(runs).toHaveLength(0)
})

test("anything but a hash given for one gets a neutral answer, and never reaches a path", async () => {
  const { renderer } = await setup()
  await renderer.wait([job()], "/drafts/0917")
  const hash = renderer.hashOf(job())
  // the same made graphic, reached through the folder above
  const around = `../graphics/${hash}`
  expect(await renderer.statusOf(around)).toBe("waiting")
  expect(await renderer.posterOf(around)).toBeNull()
  expect(renderer.failureOf(around)).toBeNull()
  renderer.retry(around)
  expect(await renderer.statusOf(hash)).toBe("ready")
  expect(await renderer.posterOf(hash)).not.toBeNull()
})

test("a file rendered on another volume than the graphics folder is copied over", async () => {
  const { dir, renderer } = await setup()
  fsControl.renameFails = true
  try {
    await expect(renderer.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(job())], failed: [] })
  } finally {
    fsControl.renameFails = false
  }
  expect(await readFile(join(dir, "graphics", `${renderer.hashOf(job())}.mov`), "utf8")).toBe("mov")
})

test("a HyperFrames home says it just checked for updates, so a render never asks the npm registry", async () => {
  const home = await temp("hfhome-")
  await mkdir(join(home, ".hyperframes"), { recursive: true })
  await writeFile(join(home, ".hyperframes", "config.json"), JSON.stringify({ anonymousId: "keep-me", latestVersion: "0.9.0", lastUpdateCheck: "2020-01-01T00:00:00.000Z" }))
  const now = new Date("2026-09-24T10:00:00.000Z")
  await quietHyperframesHome(home, "0.8.65", now)
  expect(JSON.parse(await readFile(join(home, ".hyperframes", "config.json"), "utf8"))).toEqual({ anonymousId: "keep-me", latestVersion: "0.8.65", lastUpdateCheck: "2026-09-24T10:00:00.000Z", lastSkillsCheck: "2026-09-24T10:00:00.000Z" })
  const fresh = await temp("hfhome-")
  await quietHyperframesHome(fresh, "0.8.65", now)
  expect(JSON.parse(await readFile(join(fresh, ".hyperframes", "config.json"), "utf8"))).toEqual({ latestVersion: "0.8.65", lastUpdateCheck: "2026-09-24T10:00:00.000Z", lastSkillsCheck: "2026-09-24T10:00:00.000Z" })
  // a config that is not an object is started over
  await writeFile(join(fresh, ".hyperframes", "config.json"), "[1, 2]")
  await quietHyperframesHome(fresh, "0.8.65", now)
  expect(JSON.parse(await readFile(join(fresh, ".hyperframes", "config.json"), "utf8"))).toEqual({ latestVersion: "0.8.65", lastUpdateCheck: "2026-09-24T10:00:00.000Z", lastSkillsCheck: "2026-09-24T10:00:00.000Z" })
})

test("a render's PATH holds the three system tools and nothing left from before", async () => {
  const dir = join(await temp("rpath-"), "bin")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "git"), "stale")
  expect(await renderBinDir(dir)).toBe(dir)
  expect((await readdir(dir)).sort()).toEqual(["id", "pgrep", "ps"])
  expect(await readlink(join(dir, "id"))).toBe("/usr/bin/id")
  expect(await readlink(join(dir, "pgrep"))).toBe("/usr/bin/pgrep")
  expect(await readlink(join(dir, "ps"))).toBe("/bin/ps")
})

test("a render's Chrome is a script that runs the pack's own with no route off this machine: written again each time, executable, its own flags after the renderer's, and safe for a path with a space, a quote, a dollar and a backtick in it", async () => {
  const dir = await temp("rchrome-")
  // the pack lives under the user's Application Support, and a path is never trusted to be plain
  const folder = join(dir, "Application Support", "it's $HOME `here`")
  const chrome = join(folder, "chrome-headless-shell")
  const work = join(dir, "work")
  // what a render that never finished left behind, or another pack's: replaced, and made executable
  await mkdir(work, { recursive: true })
  await writeFile(join(work, "chrome-offline.sh"), "#!/bin/sh\nexec /somewhere/else/chrome \"$@\"\n", { mode: 0o600 })
  const script = await offlineChrome(work, chrome)
  expect(script).toBe(join(work, "chrome-offline.sh"))
  expect((await stat(script)).mode & 0o777).toBe(0o755)
  const lines = (await readFile(script, "utf8")).split("\n")
  expect(lines).toHaveLength(4)
  expect(lines[0]).toBe("#!/bin/sh")
  expect(lines[1]).toMatch(/^# \S/)
  // one command: the path in single quotes, each quote in it written '\'', then what the renderer gives, then the
  // script's own four, the list of what goes direct in quotes of its own (<, > and ; are the shell's)
  const quoted = join(dir, "Application Support", "it'\\''s $HOME `here`", "chrome-headless-shell")
  expect(lines[2]).toBe("exec '" + quoted + "' \"$@\" --proxy-server=http://127.0.0.1:9 '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]' --force-webrtc-ip-handling-policy=disable_non_proxied_udp --block-new-web-contents")
  expect(lines[3]).toBe("")
  // run as HyperFrames runs it, by a stand-in Chrome that notes beside itself what it was given: the renderer's own
  // arguments first, each whole, then the four, so that a proxy switch among the renderer's would not be the last
  await mkdir(folder, { recursive: true })
  await writeFile(chrome, `#!/bin/sh\n: > "$0.args"\nfor a in "$@"; do printf '%s\\n' "$a" >> "$0.args"; done\n`)
  await chmod(chrome, 0o755)
  execFileSync(script, ["--headless", "--user-data-dir=/a folder/with a space", "--proxy-server=http://elsewhere:8080"])
  expect((await readFile(`${chrome}.args`, "utf8")).trimEnd().split("\n")).toEqual([
    "--headless",
    "--user-data-dir=/a folder/with a space",
    "--proxy-server=http://elsewhere:8080",
    "--proxy-server=http://127.0.0.1:9",
    "--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--block-new-web-contents",
  ])
  // a work folder that is not there yet is made
  const fresh = join(dir, "not", "there", "yet")
  expect(await offlineChrome(fresh, chrome)).toBe(join(fresh, "chrome-offline.sh"))
  expect((await stat(join(fresh, "chrome-offline.sh"))).mode & 0o777).toBe(0o755)
})

test("the poster is a small PNG next to the file, given to the app as a data URL", async () => {
  const { renderer } = await setup()
  await renderer.wait([job()], "/drafts/0917")
  expect(await renderer.posterOf(renderer.hashOf(job()))).toBe(`data:image/png;base64,${Buffer.from("png").toString("base64")}`)
  expect(await renderer.posterOf("0000000000000000")).toBeNull()
})

/** A stand-in for a program: records its arguments (and, with `env`, its environment) and writes `made` to the path after `outFlag`, or the last argument. */
async function recorder(dir: string, name: string, options: { env?: boolean; outFlag?: string } = {}): Promise<{ path: string; args: () => Promise<string[]>; env: () => Promise<Record<string, string>> }> {
  const path = join(dir, name)
  const out = options.outFlag ? `out=""; prev=""; for a in "$@"; do [ "$prev" = "${options.outFlag}" ] && out="$a"; prev="$a"; done` : `for a in "$@"; do out="$a"; done`
  await writeFile(path, `#!/bin/sh
: > "${path}.args"
for a in "$@"; do printf '%s\\n' "$a" >> "${path}.args"; done
${options.env ? `/usr/bin/env > "${path}.env"` : ""}
${out}
printf made > "$out"
`)
  await chmod(path, 0o755)
  return {
    path,
    args: async () => (await readFile(`${path}.args`, "utf8")).trimEnd().split("\n"),
    env: async () => Object.fromEntries((await readFile(`${path}.env`, "utf8")).trimEnd().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])),
  }
}

/**
 * A renderer with the default runner and poster, run by stand-ins in `dir/tools`: a recording
 * "node" (or the script given), a recording ffmpeg, and empty files for the rest of the pack. The
 * inspection is a fake that sees a good file: the recording ffmpeg writes to its last argument, and
 * the real inspection's last argument is no file.
 */
async function standIns(over: { node?: string } = {}) {
  const dir = await temp("grender-")
  await mkdir(join(dir, "fonts"), { recursive: true })
  await writeFile(join(dir, "fonts", "Kanit-ExtraBold.ttf"), "ttf")
  const tools = join(dir, "tools")
  await mkdir(tools, { recursive: true })
  const node = await recorder(tools, "node", { env: true, outFlag: "-o" })
  const ffmpeg = await recorder(tools, "ffmpeg")
  for (const name of ["hyperframes.mjs", "chrome-headless-shell", "ffprobe"]) await writeFile(join(tools, name), "")
  const pack = { root: tools, node: over.node ?? node.path, hyperframes: join(tools, "hyperframes.mjs"), chrome: join(tools, "chrome-headless-shell") }
  const work = join(dir, "work")
  const events: AppEvent[] = []
  const renderer = createGraphicsRenderer({
    graphicsDir: join(dir, "graphics"), workDir: work, fontDir: join(dir, "fonts"),
    motionAssets: async () => ({ host: HOST }),
    pack: async () => pack,
    ffmpeg: () => ffmpeg.path,
    ffprobe: () => join(tools, "ffprobe"),
    inspect: async () => SEEN,
    send: (event) => events.push(event),
  })
  return { dir, tools, work, pack, node, ffmpeg, events, renderer }
}

test("by default HyperFrames runs under the pack's Node with only what a render needs, and ffmpeg takes the poster from the middle", async () => {
  const { dir, tools, work, pack, node, ffmpeg, renderer } = await standIns()
  const hash = renderer.hashOf(job())
  await expect(renderer.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })

  const args = await node.args()
  expect(args.slice(0, 3)).toEqual([pack.hyperframes, "render", join(work, "compose", hash)])
  const flag = (name: string) => args[args.indexOf(name) + 1]
  expect([flag("--format"), flag("--fps"), flag("--player-ready-timeout"), flag("--frames-cache-dir")]).toEqual(["mov", "30", "20000", "off"])
  expect(args).toContain("--quiet")
  expect(flag("-o")).toBe(join(work, "compose", hash, "renders", `${hash}.mov`))

  const home = join(work, "home")
  const env = await node.env()
  const expected = {
    HOME: home,
    TMPDIR: join(home, "tmp"),
    XDG_STATE_HOME: join(home, ".state"),
    PATH: join(work, "bin"),
    LANG: "en_US.UTF-8",
    HYPERFRAMES_FFMPEG_PATH: ffmpeg.path,
    HYPERFRAMES_FFPROBE_PATH: join(tools, "ffprobe"),
    // not the pack's Chrome itself: the script that runs it cut off from the network
    HYPERFRAMES_BROWSER_PATH: join(work, "chrome-offline.sh"),
    HYPERFRAMES_FONT_CACHE_DIR: join(home, "fonts"),
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_NO_AUTO_INSTALL: "1",
  }
  expect(env).toMatchObject(expected)
  // nothing of the app's own environment reaches it; the shell running the stand-in adds these three
  expect(Object.keys(env).filter((name) => !["PWD", "SHLVL", "_"].includes(name)).sort()).toEqual(Object.keys(expected).sort())
  expect((await readdir(join(work, "bin"))).sort()).toEqual(["id", "pgrep", "ps"])
  expect((await stat(join(work, "chrome-offline.sh"))).mode & 0o777).toBe(0o755)
  expect((await readFile(join(work, "chrome-offline.sh"), "utf8")).split("\n")[2]).toBe(`exec '${pack.chrome}' "$@" --proxy-server=http://127.0.0.1:9 '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]' --force-webrtc-ip-handling-policy=disable_non_proxied_udp --block-new-web-contents`)
  expect(JSON.parse(await readFile(join(home, ".hyperframes", "config.json"), "utf8"))).toMatchObject({ latestVersion: PACK_HYPERFRAMES_VERSION })
  expect((await stat(join(home, "tmp"))).isDirectory()).toBe(true)

  const poster = await ffmpeg.args()
  const png = join(dir, "graphics", `${hash}.png`)
  expect(poster).toEqual(["-nostdin", "-v", "error", "-y", "-ss", "1.5", "-i", join(dir, "graphics", `${hash}.mov`), "-frames:v", "1", "-vf", "scale=270:-2", "-pix_fmt", "rgba", "-update", "1", png])
  expect(await readFile(png, "utf8")).toBe("made")
})

test("each render starts clean: nothing is left of a composition or a Chrome profile from one that never finished", async () => {
  const { work, pack, renderer } = await standIns()
  await mkdir(join(work, "compose", "0123456789abcdef", "renders"), { recursive: true })
  await writeFile(join(work, "compose", "0123456789abcdef", "renders", "0123456789abcdef.mov"), "half")
  await mkdir(join(work, "home", "tmp", "puppeteer_dev_chrome_profile-old", "Default"), { recursive: true })
  // nor of the script Chrome runs through, which may name a pack that has since been replaced
  await writeFile(join(work, "chrome-offline.sh"), "#!/bin/sh\nexec /an/older/pack/chrome \"$@\"\n")
  await renderer.wait([job()], "/drafts/0917")
  expect(await readdir(join(work, "compose"))).toEqual([])
  expect(await readdir(join(work, "home", "tmp"))).toEqual([])
  expect(await readFile(join(work, "chrome-offline.sh"), "utf8")).toContain(`exec '${pack.chrome}' `)
})

test("a pack short of a program, or the app short of ffmpeg or ffprobe, stops the renders before HyperFrames runs, saying what is missing, and fails no graphic", async () => {
  const { tools, work, pack, node, renderer, events } = await standIns()
  const gone = join(tools, "gone")
  const cases = [
    // named inside the pack: the full path runs through the user's home folder, and is shown to them
    [{ pack: async () => ({ ...pack, chrome: gone }) }, "the graphics renderer is damaged: reinstall it in settings (gone is missing)"],
    [{ pack: async () => ({ ...pack, node: gone }) }, "the graphics renderer is damaged: reinstall it in settings (gone is missing)"],
    [{ pack: async () => ({ ...pack, hyperframes: gone }) }, "the graphics renderer is damaged: reinstall it in settings (gone is missing)"],
    // the tool alone: its path can run through the user's home folder (~/Applications, ~/.local/bin)
    [{ ffmpeg: () => gone }, "the app's ffmpeg is missing"],
    [{ ffprobe: () => gone }, "the app's ffprobe is missing"],
    [{ ffmpeg: () => null }, "the app's ffmpeg is missing"],
    [{ ffprobe: () => null }, "the app's ffprobe is missing"],
  ] as const
  for (const [over, message] of cases) {
    const short = createGraphicsRenderer({ ...renderer.deps, ...over })
    const hash = short.hashOf(job())
    // the fault is the machine's: once it is put right (a reinstall, a rescan), the same graphic renders
    await expect(short.wait([job()], "/drafts/0917"), message).resolves.toEqual({ ready: [], failed: [] })
    expect(short.failureOf(hash)).toBeNull()
    expect(await short.statusOf(hash)).toBe("waiting")
    expect(short.environmentProblem()).toEqual({ text: message })
    expect(short.environmentProblem()?.text).not.toContain(tools)
  }
  expect(events.some((event) => event.type === "graphics" && event.state === "failed")).toBe(false)
  // HyperFrames never ran: what the pack or the app is short of is told before it is given anything to run
  expect(existsSync(`${node.path}.args`)).toBe(false)
  // and the script Chrome runs through was not written for a pack with no Chrome for it to run
  expect(existsSync(join(work, "chrome-offline.sh"))).toBe(false)
})

test("a work folder the page cannot be put in is the machine's fault, not the graphic's: there is a file where the folder goes, or no room for the page", async () => {
  const cases: [what: string, spoil: (dir: string) => Promise<unknown>, mend: (dir: string) => Promise<unknown>, reason: string][] = [
    // the compose folder's parent, the work folder itself, is a file
    ["a file where the work folder goes", (dir) => writeFile(join(dir, "work"), "not a folder"), (dir) => rm(join(dir, "work")), "ENOTDIR"],
    ["no room for the page", async () => (fsControl.noRoomFor = "index.html"), async () => (fsControl.noRoomFor = null), "ENOSPC"],
  ]
  for (const [what, spoil, mend, reason] of cases) {
    const { dir, events, renderer, runs } = await setup()
    await spoil(dir)
    const asked = [motionJob(), job()]
    await expect(renderer.wait(asked, "/drafts/0917"), what).resolves.toEqual({ ready: [], failed: [] })
    // no graphic's failure: a repair of a fragment that was fine would put nothing right
    for (const one of asked) {
      expect(renderer.failureOf(renderer.hashOf(one)), what).toBeNull()
      expect(await renderer.statusOf(renderer.hashOf(one)), what).toBe("waiting")
    }
    // short, and with no path in it: it is shown to the user as it is
    expect(renderer.environmentProblem(), what).toEqual({ text: `the renderer's work folder could not be prepared (${reason})` })
    expect(renderer.machineReady(), what).toBe(false)
    expect(events.some((event) => event.type === "graphics" && event.state === "failed"), what).toBe(false)
    expect(runs, what).toHaveLength(0)
    // put right and told so, the same graphics render
    await mend(dir)
    renderer.forgetFailures()
    await expect(renderer.wait(asked, "/drafts/0917"), what).resolves.toEqual({ ready: asked.map(renderer.hashOf), failed: [] })
  }
})

test("a rendered graphic that cannot be kept is the machine's fault, not the graphic's: the graphics folder is a file, something is in the file's place or the meta's, or there is no room for the meta", async () => {
  const cases: [what: string, spoil: (dir: string, hash: string) => Promise<unknown>, mend: (dir: string, hash: string) => Promise<unknown>, reason: string][] = [
    ["a file where the graphics folder goes", (dir) => writeFile(join(dir, "graphics"), "not a folder"), (dir) => rm(join(dir, "graphics")), "EEXIST"],
    // the rendered file can be neither moved nor copied over a folder
    ["a folder in the file's place", (dir, hash) => mkdir(join(dir, "graphics", `${hash}.mov`), { recursive: true }), (dir, hash) => rm(join(dir, "graphics", `${hash}.mov`), { recursive: true }), "EISDIR"],
    ["a folder in the meta's place", (dir, hash) => mkdir(join(dir, "graphics", `${hash}.json`), { recursive: true }), (dir, hash) => rm(join(dir, "graphics", `${hash}.json`), { recursive: true }), "EISDIR"],
    ["no room for the meta", async () => (fsControl.noRoomFor = ".tmp"), async () => (fsControl.noRoomFor = null), "ENOSPC"],
  ]
  for (const [what, spoil, mend, reason] of cases) {
    const { dir, events, inspected, renderer, runs } = await setup()
    const asked = [motionJob(), job()]
    const first = renderer.hashOf(asked[0]!)
    await spoil(dir, first)
    await expect(renderer.wait(asked, "/drafts/0917"), what).resolves.toEqual({ ready: [], failed: [] })
    for (const one of asked) {
      expect(renderer.failureOf(renderer.hashOf(one)), what).toBeNull()
      expect(await renderer.statusOf(renderer.hashOf(one)), what).toBe("waiting")
    }
    expect(renderer.environmentProblem(), what).toEqual({ text: `the rendered graphic could not be kept (${reason})` })
    expect(renderer.machineReady(), what).toBe(false)
    expect(events.some((event) => event.type === "graphics" && event.state === "failed"), what).toBe(false)
    // the first was rendered and passed its checks before it could not be kept; the one behind it was not tried
    expect(runs, what).toHaveLength(1)
    expect(inspected, what).toHaveLength(1)
    // nothing is left of its composition, and nothing reads as made
    expect(await readdir(join(dir, "work", "compose")), what).toEqual([])
    expect(await renderer.rendered(asked[0]!), what).toBeNull()
    await mend(dir, first)
    renderer.forgetFailures()
    await expect(renderer.wait(asked, "/drafts/0917"), what).resolves.toEqual({ ready: asked.map(renderer.hashOf), failed: [] })
  }
})

test("a poster that cannot be taken fails the graphic it is of, as before: ffmpeg failing on one file is not the machine's fault", async () => {
  const { renderer } = await setup()
  const dim = createGraphicsRenderer({
    ...renderer.deps,
    poster: async () => {
      throw new ProcessError("/tools/ffmpeg", 183, "", "Invalid data found when processing input\n")
    },
  })
  for (const one of [motionJob(), job()]) {
    const hash = dim.hashOf(one)
    await expect(dim.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
    expect(dim.failureOf(hash)).toBe("ProcessError: ffmpeg exited with code 183: Invalid data found when processing input")
  }
  expect(dim.environmentProblem()).toBeNull()
  expect(dim.machineReady()).toBe(true)
})

test("a composition's folder that cannot be removed fails nothing and hides nothing: a render that succeeded is made, and what was found wrong before the removal is still what is told", async () => {
  // a render that succeeded is made all the same; what was left behind goes when the next render clears the folder
  const fine = await setup()
  fsControl.compositionsStay = true
  const asked = [motionJob(), job()]
  await expect(fine.renderer.wait(asked, "/drafts/0917")).resolves.toEqual({ ready: asked.map(fine.renderer.hashOf), failed: [] })
  for (const one of asked) {
    expect(fine.renderer.failureOf(fine.renderer.hashOf(one))).toBeNull()
    expect(await fine.renderer.rendered(one)).not.toBeNull()
  }
  expect(fine.events.some((event) => event.type === "graphics" && event.state === "failed")).toBe(false)
  expect(fine.renderer.machineReady()).toBe(true)
  expect(await readdir(join(fine.dir, "work", "compose"))).toEqual([fine.renderer.hashOf(asked[1]!)])

  // a fault of the machine found before the removal is still the machine's
  const unkept = await setup()
  await writeFile(join(unkept.dir, "graphics"), "not a folder")
  const one = motionJob()
  await expect(unkept.renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(unkept.renderer.failureOf(unkept.renderer.hashOf(one))).toBeNull()
  expect(unkept.renderer.environmentProblem()).toEqual({ text: "the rendered graphic could not be kept (EEXIST)" })
  expect(unkept.renderer.machineReady()).toBe(false)

  // and a graphic's own failure is still the graphic's, in its own words
  const empty = await setup()
  empty.answers.inspection = { visible: false, goneAtEnd: true }
  await expect(empty.renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [empty.renderer.hashOf(one)] })
  expect(empty.renderer.failureOf(empty.renderer.hashOf(one))).toBe("nothing was drawn: every frame is empty")
  expect(empty.renderer.machineReady()).toBe(true)
})

test("forgetMachine() looks at the machine afresh and forgets no graphic's own failure: what waited for a fault since mended renders when next asked, and what failed stays failed until it is retried", async () => {
  const { answers, renderer, runs } = await setup()
  // a graphic that fails for itself
  answers.inspection = { visible: false, goneAtEnd: true }
  const empty = motionJob({ seconds: 4 })
  await expect(renderer.wait([empty], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [renderer.hashOf(empty)] })
  answers.inspection = SEEN
  // then a fault of the machine: a disk with no room for the page
  fsControl.noRoomFor = "index.html"
  const one = motionJob()
  await expect(renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(renderer.machineReady()).toBe(false)
  // the user makes room, but the renderer is not told: nothing is tried
  fsControl.noRoomFor = null
  await expect(renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  expect(runs).toHaveLength(1)

  renderer.forgetMachine()
  expect(renderer.machineReady()).toBe(true)
  expect(renderer.environmentProblem()).toBeNull()
  // the graphic's own failure is still there, and still keeps it from being rendered again
  expect(renderer.failureOf(renderer.hashOf(empty))).toBe("nothing was drawn: every frame is empty")
  expect(await renderer.statusOf(renderer.hashOf(empty))).toBe("failed")
  await expect(renderer.wait([one, empty], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(one)], failed: [renderer.hashOf(empty)] })
  expect(runs).toHaveLength(2)
  // until it is retried
  renderer.retry(renderer.hashOf(empty))
  await expect(renderer.wait([empty], "/drafts/0917")).resolves.toEqual({ ready: [renderer.hashOf(empty)], failed: [] })
  expect(runs).toHaveLength(3)
})

test("a work folder that cannot be prepared for a render is the machine's fault, not the graphic's: nothing fails for it, and HyperFrames is not run", async () => {
  const cases: [what: string, spoil: (work: string) => Promise<unknown>, mend: (work: string) => Promise<unknown>, reason: string][] = [
    // where Chrome's script is written there is a folder, which cannot be written over
    ["the script Chrome runs through", (work) => mkdir(join(work, "chrome-offline.sh"), { recursive: true }), (work) => rm(join(work, "chrome-offline.sh"), { recursive: true }), "EISDIR"],
    // where HyperFrames' home is made there is a file
    [
      "HyperFrames' home",
      async (work) => {
        await mkdir(work, { recursive: true })
        await writeFile(join(work, "home"), "not a folder")
      },
      (work) => rm(join(work, "home")),
      "ENOTDIR",
    ],
  ]
  for (const [what, spoil, mend, reason] of cases) {
    const { work, node, renderer, events } = await standIns()
    await spoil(work)
    const one = motionJob()
    await expect(renderer.wait([one, job()], "/drafts/0917"), what).resolves.toEqual({ ready: [], failed: [] })
    // no graphic's failure: a repair of a fragment that was fine would put nothing right
    for (const asked of [one, job()]) {
      expect(renderer.failureOf(renderer.hashOf(asked)), what).toBeNull()
      expect(await renderer.statusOf(renderer.hashOf(asked)), what).toBe("waiting")
    }
    // short, and with no path in it: it is shown to the user as it is
    expect(renderer.environmentProblem(), what).toEqual({ text: `the renderer's work folder could not be prepared (${reason})` })
    expect(renderer.machineReady(), what).toBe(false)
    expect(events.some((event) => event.type === "graphics" && event.state === "failed"), what).toBe(false)
    expect(existsSync(`${node.path}.args`), what).toBe(false)
    // put right and told so, the same graphics render
    await mend(work)
    renderer.forgetFailures()
    await expect(renderer.wait([one, job()], "/drafts/0917"), what).resolves.toEqual({ ready: [renderer.hashOf(one), renderer.hashOf(job())], failed: [] })
  }
})

test("cancel() asks the default runner's HyperFrames to stop with SIGTERM, so it can close its Chrome, rather than killing it", async () => {
  const dir = await temp("grender-sig-")
  // a stand-in "node" that runs until it is asked to stop, and notes that it was asked
  const node = join(dir, "node")
  await writeFile(node, `#!/bin/sh
trap 'printf term > "${node}.term"; exit 0' TERM
printf started > "${node}.started"
while :; do /bin/sleep 0.05; done
`)
  await chmod(node, 0o755)
  const { renderer } = await standIns({ node })
  const waited = renderer.wait([job()], "/drafts/0917")
  await vi.waitFor(() => expect(existsSync(`${node}.started`)).toBe(true), { timeout: 5000 })
  renderer.cancel()
  await expect(waited).resolves.toEqual({ ready: [], failed: [] })
  // SIGKILL would have given it no chance to write this
  expect(await readFile(`${node}.term`, "utf8")).toBe("term")
})

/** A stand-in "node" that does as HyperFrames might: `body` is a shell script's lines, with the path after -o in `$out`. */
async function standInNode(dir: string, body: string): Promise<string> {
  const node = join(dir, "node")
  await writeFile(node, `#!/bin/sh
out=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
${body}
`)
  await chmod(node, 0o755)
  return node
}

test("the default runner hands back everything HyperFrames printed, on either stream, and a motion graphic is judged by it", async () => {
  // exits 0 with its file written, as HyperFrames does when the page's script broke; what it says on standard output
  // does not end its last line, and is still told from what it says on standard error
  const node = await standInNode(await temp("grender-out-"), `printf mov > "$out"
printf '%s' "[Browser:ERROR] BOXBLACK motion error: window.frame threw: said on standard output"
echo "[Browser:ERROR] BOXBLACK motion error: window.frame threw: said on standard error" >&2`)
  const { dir, renderer } = await standIns({ node })
  const one = motionJob()
  const hash = renderer.hashOf(one)
  await expect(renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(renderer.failureOf(hash)).toBe("window.frame threw: said on standard output\nwindow.frame threw: said on standard error")
  expect(existsSync(join(dir, "graphics"))).toBe(false)

  // one that prints nothing of the kind is rendered from its page in the work folder, and kept
  const quiet = await standIns()
  await expect(quiet.renderer.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [hash], failed: [] })
  expect((await quiet.node.args()).slice(0, 3)).toEqual([quiet.pack.hyperframes, "render", join(quiet.work, "compose", hash)])
  expect(await readFile(join(quiet.dir, "graphics", `${hash}.mov`), "utf8")).toBe("made")
})

/**
 * What HyperFrames 0.8.65 printed, before it exited non-zero, for a page that navigated away and was
 * lost to it (captured in the spike: "A page that navigates away" in spike/renderer-output-samples.txt
 * in the notes of the 2026-09-30 plan). It names the renderer's own globals, which the linter refuses
 * in a fragment.
 */
const LOST_PAGE = String.raw`[WARN] [Render] Capture attempt made no forward progress; composition is likely structurally broken — not retrying. {"renderJobId":"9a5efd1e-fd2c-4cea-b478-d08acf2f9efb","attempt":0,"frameCount":60,"remainingCount":60,"workers":2}
[INFO] [Render] Failure summary {"renderJobId":"9a5efd1e-fd2c-4cea-b478-d08acf2f9efb","failedStage":"Capturing frame 0/60 (2 workers)","error":"[Parallel] Capture failed: Worker 0: Parallel worker cancelled; Worker 1: [FrameCapture] window.__hf not ready after 20000ms. Page must expose window.__hf = { duration, seek }.\n  State: __hf=false, seek=false, player=false, renderReady=false, duration=-1","elapsedMs":20413,"
`
const COULD_NOT_DRAW = "the renderer could not draw the page: its script must finish at once, and must not leave, reload or replace the page"
const OUT_OF_TIME = "the render ran out of time: the script must finish at once and draw every frame quickly"

/** What every render whose Chrome starts prints on standard output, before the page is loaded (the first line of every captured log, this one from the page that navigated away). */
const LAUNCHED = "[BrowserManager] Browser launched (HeadlessChrome/152.0.7977.30, screenshot, gl=--use-gl=angle --use-angle=metal, headlessShell=true, platform=darwin)\n"
const NO_BROWSER = "the graphics renderer could not start its browser: reinstall it in settings"

test("a HyperFrames that started its browser and then exits with an error fails the graphic in the app's own words, which say what to change", async () => {
  // as it printed for the page that navigated away: the browser's start on standard output, its own lines on standard
  // error. The render's PATH has no cat on it, so it is named whole
  const node = await standInNode(await temp("grender-exit-"), `printf '%s\\n' '${LAUNCHED.trim()}'\n/bin/cat <<'LINES' >&2\n${LOST_PAGE}LINES\nexit 1`)
  const { renderer } = await standIns({ node })
  const motion = motionJob()
  await expect(renderer.wait([motion], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [renderer.hashOf(motion)] })
  // not HyperFrames' last lines: a repair that took "Page must expose window.__hf" at its word would write what the linter refuses
  expect(renderer.failureOf(renderer.hashOf(motion))).toBe(COULD_NOT_DRAW)
  expect(LOST_PAGE).toContain("window.__hf not ready")
  expect(renderer.machineReady()).toBe(true)
})

test("a HyperFrames that exits with an error without ever starting its browser is the machine's fault: the fragment is not to blame, and every graphic waits", async () => {
  // the stand-in's own words, not captured ones: no render of the spike ever failed to start its browser. What
  // counts is what is missing from them, the line every browser that starts is announced with
  const node = await standInNode(await temp("grender-exit-"), `echo "[INFO] [Render] Pipeline started" >&2
echo "the stand-in found no browser to start" >&2
exit 1`)
  const died = await standIns({ node })
  const motion = motionJob()
  const behind = motionJob({ seconds: 4 })
  await expect(died.renderer.wait([motion, behind], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [] })
  for (const one of [motion, behind]) {
    expect(died.renderer.failureOf(died.renderer.hashOf(one))).toBeNull()
    expect(await died.renderer.statusOf(died.renderer.hashOf(one))).toBe("waiting")
  }
  expect(died.renderer.environmentProblem()).toEqual({ text: NO_BROWSER })
  expect(died.renderer.machineReady()).toBe(false)
  expect(died.events.some((event) => event.type === "graphics" && event.state === "failed")).toBe(false)
})

test("what a HyperFrames that exits with an error printed is read for a motion graphic as it is when it exits 0: a page failure found there is the reason, on either stream; with none, whether its browser ever started says whose fault it is", async () => {
  const cases: [what: string, stdout: string, stderr: string, failure: string | null][] = [
    ["the script's own error, before the renderer's last lines", `${LAUNCHED}[Browser:PAGEERROR] Unexpected token ';'\n`, LOST_PAGE, "the script failed: Unexpected token ';'"],
    ["what the host reported", `${LAUNCHED}${said(replaced(1))}${said(threw("0"))}`, LOST_PAGE, `${threw("0")}\n${replaced(1)}`],
    ["a page that never became ready, said on standard error", LAUNCHED, PRINTED.neverReady, NEVER_READY],
    ["the host's report on standard error, after a standard output that does not end its last line", LAUNCHED.trim(), said("window.frame threw: boom"), "window.frame threw: boom"],
    // a page failure is the reason wherever it is found, whatever else was or was not printed
    ["the script's own error, with no word of the browser's start", "[Browser:PAGEERROR] Unexpected token ';'\n", LOST_PAGE, "the script failed: Unexpected token ';'"],
    ["nothing of the page, from a browser that started", `${LAUNCHED}[initSession:screenshot] page.goto start (0ms)\n`, LOST_PAGE, COULD_NOT_DRAW],
    ["nothing of the page, the browser's start said on standard error", "", `${LAUNCHED}${LOST_PAGE}`, COULD_NOT_DRAW],
    // no browser, no page: the machine's fault, and no failure of the graphic
    ["nothing of the page, and no browser started", "[initSession:screenshot] page.goto start (0ms)\n", LOST_PAGE, null],
    ["a line that only holds the words of a start further in", `[INFO] waiting for: ${LAUNCHED}`, LOST_PAGE, null],
    ["nothing at all", "", "", null],
  ]
  for (const [what, stdout, stderr, failure] of cases) {
    const { events, inspected, renderer } = await setup()
    const failing = createGraphicsRenderer({ ...renderer.deps, run: async () => Promise.reject(new ProcessError("/p/node", 1, stdout, stderr)) })
    const one = motionJob()
    const hash = failing.hashOf(one)
    await expect(failing.wait([one], "/drafts/0917"), what).resolves.toEqual({ ready: [], failed: failure === null ? [] : [hash] })
    expect(failing.failureOf(hash), what).toBe(failure)
    expect(inspected, what).toEqual([])
    if (failure === null) {
      expect(failing.environmentProblem(), what).toEqual({ text: NO_BROWSER })
      expect(failing.machineReady(), what).toBe(false)
      expect(events.some((event) => event.type === "graphics" && event.state === "failed"), what).toBe(false)
    } else {
      expect(events, what).toContainEqual({ type: "graphics", folder: "/drafts/0917", state: "failed", hash, error: failure })
      expect(failing.environmentProblem(), what).toBeNull()
      expect(failing.machineReady(), what).toBe(true)
    }
  }
})

test("a render that runs out of its time fails in the app's own words, and a cancel is no failure at all", async () => {
  const { events, renderer, runs } = await setup({ holdFirst: 2 })
  const hurried = createGraphicsRenderer({ ...renderer.deps, renderTimeoutMs: 50 })
  const one = motionJob()
  const hash = hurried.hashOf(one)
  await expect(hurried.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(runs[0]!.signal.aborted).toBe(true)
  expect(hurried.failureOf(hash)).toBe(OUT_OF_TIME)
  expect(events).toContainEqual({ type: "graphics", folder: "/drafts/0917", state: "failed", hash, error: OUT_OF_TIME })
  expect(hurried.machineReady()).toBe(true)

  // stopped by cancel() with time to spare: nothing wrong with the graphic
  const other = motionJob({ seconds: 4 })
  const waited = renderer.wait([other], "/drafts/0917")
  await vi.waitFor(() => expect(runs).toHaveLength(2))
  renderer.cancel()
  await expect(waited).resolves.toEqual({ ready: [], failed: [] })
  expect(renderer.failureOf(renderer.hashOf(other))).toBeNull()
  expect(await renderer.statusOf(renderer.hashOf(other))).toBe("waiting")
})

test("the inspection is given the render's signal: time that runs out while it looks fails the motion graphic as out of time, and a cancel then is no failure", async () => {
  const { dir, answers, inspected, inspectedUnder, renderer, runs } = await setup()
  answers.inspection = "never"
  const hurried = createGraphicsRenderer({ ...renderer.deps, renderTimeoutMs: 50 })
  const one = motionJob()
  const hash = hurried.hashOf(one)
  await expect(hurried.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(hurried.failureOf(hash)).toBe(OUT_OF_TIME)
  // the one signal, which HyperFrames had first: the time is the render's, not each step's
  expect(inspectedUnder[0]).toBe(runs[0]!.signal)
  expect(inspectedUnder[0]!.aborted).toBe(true)
  expect(existsSync(join(dir, "graphics"))).toBe(false)

  const other = motionJob({ seconds: 4 })
  const waited = renderer.wait([other], "/drafts/0917")
  await vi.waitFor(() => expect(inspected).toHaveLength(2))
  expect(inspectedUnder[1]!.aborted).toBe(false)
  renderer.cancel()
  await expect(waited).resolves.toEqual({ ready: [], failed: [] })
  expect(inspectedUnder[1]!.aborted).toBe(true)
  expect(renderer.failureOf(renderer.hashOf(other))).toBeNull()
  expect(await renderer.statusOf(renderer.hashOf(other))).toBe("waiting")
  expect(existsSync(join(dir, "graphics"))).toBe(false)
})

test("the default runner and the default inspection are stopped when a motion graphic's render runs out of time, and the inspection's ffmpeg when it is cancelled, rather than left to go on", async () => {
  // a stand-in that notes its process beside itself, goes on for three seconds as one stuck would, and says so if it is left to finish
  const stuck = async (path: string) => {
    await writeFile(path, `#!/bin/sh
trap 'exit 0' TERM
printf '%s' "$$" > "$0.pid"
i=0; while [ $i -lt 60 ]; do /bin/sleep 0.05; i=$((i+1)); done
printf finished > "$0.finished"
`)
    await chmod(path, 0o755)
    return path
  }
  /** The process the stand-in at `path` noted, once it got as far as noting one. */
  const pidOf = async (path: string) => Number(await readFile(`${path}.pid`, "utf8").catch(() => "")) || null
  /** That process is gone, and was not left to finish: signal 0 asks only whether it is there. */
  const gone = (path: string, pid: number) => {
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/)
    expect(existsSync(`${path}.finished`)).toBe(false)
  }
  const one = motionJob()

  // HyperFrames itself: out of time, in the app's words, and stopped (on a machine so busy that its time ran out before
  // it had started, there is no process to look for)
  const node = await stuck(join(await temp("grender-stuck-"), "node"))
  const slow = await standIns({ node })
  const hurried = createGraphicsRenderer({ ...slow.renderer.deps, renderTimeoutMs: 300 })
  await expect(hurried.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hurried.hashOf(one)] })
  expect(hurried.failureOf(hurried.hashOf(one))).toBe(OUT_OF_TIME)
  const ran = await pidOf(node)
  if (ran !== null) gone(node, ran)

  // the app's ffmpeg, looking at the file: the same
  const { renderer } = await setup()
  const ffmpeg = await stuck(join(await temp("grender-stuck-"), "ffmpeg"))
  const looking = createGraphicsRenderer({ ...renderer.deps, inspect: undefined, ffmpeg: () => ffmpeg, renderTimeoutMs: 300 })
  await expect(looking.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [looking.hashOf(one)] })
  expect(looking.failureOf(looking.hashOf(one))).toBe(OUT_OF_TIME)
  const looked = await pidOf(ffmpeg)
  if (looked !== null) gone(ffmpeg, looked)

  // and cancelled once it is known to be looking: stopped, and no failure
  const again = await stuck(join(await temp("grender-stuck-"), "ffmpeg"))
  const patient = createGraphicsRenderer({ ...renderer.deps, inspect: undefined, ffmpeg: () => again })
  const other = motionJob({ seconds: 4 })
  const waited = patient.wait([other], "/drafts/0917")
  await vi.waitFor(async () => expect(await pidOf(again)).not.toBeNull(), { timeout: 5000 })
  patient.cancel()
  await expect(waited).resolves.toEqual({ ready: [], failed: [] })
  expect(patient.failureOf(patient.hashOf(other))).toBeNull()
  gone(again, (await pidOf(again))!)
}, 20_000)

test("an inspection reads each frame's most opaque point from what ffmpeg prints: something was drawn when some frame's is over 16 of 255, and it is gone at the end when the last frame's is 16 or under", () => {
  // three frames of what ffmpeg printed for the spike's fragment A (spike/inspect-A.txt in the notes of the 2026-09-30
  // plan): the first, the third and the last of its 96
  const captured = `frame:0    pts:0       pts_time:0
lavfi.signalstats.YMAX=0
frame:2    pts:1024    pts_time:0.0666667
lavfi.signalstats.YMAX=255
frame:95   pts:48640   pts_time:3.166667
lavfi.signalstats.YMAX=0
`
  expect(inspectionOf(captured)).toEqual({ visible: true, goneAtEnd: true })
  const frames = (...peaks: number[]) => peaks.map((peak, i) => `frame:${i}    pts:${i * 512}    pts_time:${i / 30}\nlavfi.signalstats.YMAX=${peak}\n`).join("")
  // the same file had it ended a frame sooner, where its way out was not over (52)
  expect(inspectionOf(frames(0, 255, 52))).toEqual({ visible: true, goneAtEnd: false })
  expect(inspectionOf(frames(0, 0, 0))).toEqual({ visible: false, goneAtEnd: true })
  // 16 is still empty, 17 is not: for a frame in the middle, and for the last one
  expect(inspectionOf(frames(16, 16, 16))).toEqual({ visible: false, goneAtEnd: true })
  expect(inspectionOf(frames(0, 17, 0))).toEqual({ visible: true, goneAtEnd: true })
  expect(inspectionOf(frames(255, 16))).toEqual({ visible: true, goneAtEnd: true })
  expect(inspectionOf(frames(255, 17))).toEqual({ visible: true, goneAtEnd: false })
  // it is the last frame that must be empty, not any one before it
  expect(inspectionOf(frames(0, 255))).toEqual({ visible: true, goneAtEnd: false })
  // a file with no frame at all shows nothing
  expect(inspectionOf("")).toEqual({ visible: false, goneAtEnd: true })
})

/**
 * A stand-in for the app's ffmpeg reading a rendered file's alpha: records its arguments and prints,
 * on standard output, the two lines the real one prints for each frame, with the frames' most opaque
 * points from `peaks`. With `fails` it says that on standard error and exits with that code instead.
 */
async function alphaReader(dir: string, peaks: number[], fails?: { code: number; says: string }): Promise<{ path: string; args: () => Promise<string[]> }> {
  const path = join(dir, "ffmpeg")
  const frames = peaks.map((peak, i) => `frame:${i}    pts:${i * 512}    pts_time:${i / 30}\nlavfi.signalstats.YMAX=${peak}\n`).join("")
  await writeFile(path, `#!/bin/sh
: > "${path}.args"
for a in "$@"; do printf '%s\\n' "$a" >> "${path}.args"; done
${fails ? `echo "${fails.says}" >&2\nexit ${fails.code}` : `cat <<'FRAMES'\n${frames}FRAMES`}
`)
  await chmod(path, 0o755)
  return { path, args: async () => (await readFile(`${path}.args`, "utf8")).trimEnd().split("\n") }
}

test("by default a motion graphic is inspected by the app's ffmpeg, which reads the alpha of every frame of the file HyperFrames wrote", async () => {
  const { dir, renderer } = await setup()
  const tools = await temp("grender-ffmpeg-")
  const ffmpeg = await alphaReader(tools, [0, 174, 255, 52, 0])
  const real = createGraphicsRenderer({ ...renderer.deps, inspect: undefined, ffmpeg: () => ffmpeg.path })
  const good = motionJob()
  await expect(real.wait([good], "/drafts/0917")).resolves.toEqual({ ready: [real.hashOf(good)], failed: [] })
  const mov = join(dir, "work", "compose", real.hashOf(good), "renders", `${real.hashOf(good)}.mov`)
  expect(await ffmpeg.args()).toEqual(["-nostdin", "-v", "error", "-i", mov, "-vf", "alphaextract,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-", "-f", "null", "-"])

  await alphaReader(tools, [0, 9, 16, 0])
  const empty = motionJob({ seconds: 4 })
  await expect(real.wait([empty], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [real.hashOf(empty)] })
  expect(real.failureOf(real.hashOf(empty))).toBe("nothing was drawn: every frame is empty")

  await alphaReader(tools, [0, 255, 255, 17])
  const stuck = motionJob({ seconds: 5 })
  await expect(real.wait([stuck], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [real.hashOf(stuck)] })
  expect(real.failureOf(real.hashOf(stuck))).toBe("it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D")

  // a file with no frame in it shows nothing either
  await alphaReader(tools, [])
  const blank = motionJob({ seconds: 6 })
  await expect(real.wait([blank], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [real.hashOf(blank)] })
  expect(real.failureOf(real.hashOf(blank))).toBe("nothing was drawn: every frame is empty")
})

test("an ffmpeg that cannot read one motion graphic's file fails that graphic and not the machine: the next graphic renders", async () => {
  const { dir, renderer } = await setup()
  const tools = await temp("grender-ffmpeg-")
  const ffmpeg = await alphaReader(tools, [], { code: 183, says: "Invalid data found when processing input" })
  const real = createGraphicsRenderer({ ...renderer.deps, inspect: undefined, ffmpeg: () => ffmpeg.path })
  const one = motionJob()
  const hash = real.hashOf(one)
  await expect(real.wait([one], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(real.failureOf(hash)).toBe("ProcessError: ffmpeg exited with code 183: Invalid data found when processing input")
  expect(await real.statusOf(hash)).toBe("failed")
  expect(existsSync(join(dir, "graphics"))).toBe(false)
  // one unreadable file does not mark the machine unfit, which would stop every graphic
  expect(real.environmentProblem()).toBeNull()
  expect(real.machineReady()).toBe(true)
  await alphaReader(tools, [0, 255, 0])
  const next = motionJob({ seconds: 4 })
  await expect(real.wait([next], "/drafts/0917")).resolves.toEqual({ ready: [real.hashOf(next)], failed: [] })
})

/**
 * One real render through the renderer pack: set BOXBLACK_TEST_GRAPHICS_PACK to an unpacked pack
 * (the folder the app installs, laid out as GRAPHICS_PACK says: node/, node_modules/,
 * chrome-headless-shell/), for example
 *   BOXBLACK_TEST_GRAPHICS_PACK="<userData>/hyperframes/2026-09-24" npx vitest run apps/desktop/src/main/graphics-render.test.ts
 * It needs resources/bin/ffmpeg rebuilt with the ProRes and PNG encoders and the mov muxer.
 * Without either, this is skipped.
 */
const RESOURCES = join(import.meta.dirname, "../../resources")
const PACK_ROOT = process.env.BOXBLACK_TEST_GRAPHICS_PACK
const realPack = PACK_ROOT ? { root: PACK_ROOT, node: join(PACK_ROOT, GRAPHICS_PACK.node), hyperframes: join(PACK_ROOT, GRAPHICS_PACK.hyperframes), chrome: join(PACK_ROOT, GRAPHICS_PACK.chrome) } : null
const shipped = { ffmpeg: join(RESOURCES, "bin", "ffmpeg"), ffprobe: join(RESOURCES, "bin", "ffprobe") }
const haveAll = realPack !== null && [realPack.node, realPack.hyperframes, realPack.chrome, shipped.ffmpeg, shipped.ffprobe].every((path) => existsSync(path))

/** Every Chrome process running now, by pid. */
function chromes(): { pid: number; ppid: number; command: string }[] {
  return execFileSync("/bin/ps", ["-axww", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((match) => match !== null && match[3]!.includes("chrome-headless-shell"))
    .map((match) => ({ pid: Number(match![1]), ppid: Number(match![2]), command: match![3]! }))
}

/**
 * The pids of the Chrome processes renders under `workDir` started: the browser is the one whose
 * profile (puppeteer's, made in TMPDIR) sits in its HOME, and its helpers (GPU, network,
 * renderers) are its children, which carry no profile of their own.
 */
function chromesUnder(workDir: string): number[] {
  const running = chromes()
  const browsers = running.filter((chrome) => chrome.command.includes(`--user-data-dir=${join(workDir, "home", "tmp")}/`)).map((chrome) => chrome.pid)
  return running.filter((chrome) => browsers.includes(chrome.pid) || browsers.includes(chrome.ppid)).map((chrome) => chrome.pid)
}

/**
 * A fragment the real renderer draws, for a graphic that lasts `seconds`: a plate over the middle of the stage,
 * about half of it, that comes up in the first tenth of its length, holds, and is gone by four fifths of it.
 */
const plate = (seconds: number) =>
  `<style>.p{position:absolute;left:15%;top:15%;width:70%;height:70%;background:var(--bar);animation:show ${seconds}s linear both}@keyframes show{0%{opacity:0}10%{opacity:1}70%{opacity:1}80%{opacity:0}100%{opacity:0}}</style><div class="p"></div>`

test("the fragment the real renders draw is one the linter passes, whether or not the pack is here to draw it", () => {
  expect(lintFragment(plate(1.5))).toEqual([])
  expect(lintFragment(plate(6))).toEqual([])
})

describe.skipIf(!haveAll)("a real render with the renderer pack", () => {
  const realJob = (seconds = 1.5): RenderJob => ({
    spec: { kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 }, seconds, why: "", idea: "แผ่นสีขึ้นกลางกรอบ", words: [], html: plate(seconds) },
    canvas,
    fps: 30,
    font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" },
    palette: HIGHLIGHT_STYLES["bold-white"].palette,
    times: [],
  })

  async function realRenderer() {
    const dir = await temp("grender-real-")
    const events: AppEvent[] = []
    const renderer = createGraphicsRenderer({
      graphicsDir: join(dir, "graphics"), workDir: join(dir, "work"), fontDir: join(RESOURCES, "fonts"),
      motionAssets: () => motionAssets(join(RESOURCES, "graphics")),
      pack: async () => realPack,
      ffmpeg: () => shipped.ffmpeg,
      ffprobe: () => shipped.ffprobe,
      send: (event) => events.push(event),
    })
    return { dir, events, renderer }
  }

  test("makes a transparent ProRes file, an 8-bit RGBA poster and the meta the writer places it by, and leaves HyperFrames' update and skills notes as seeded", async () => {
    const { dir, renderer } = await realRenderer()
    const job = realJob()
    const hash = renderer.hashOf(job)
    // the seeded update checks carry a time of our choosing, so a rewrite by HyperFrames would show
    const seeded = new Date(Date.now() - 60 * 60 * 1000 + 123)
    vi.useFakeTimers({ toFake: ["Date"], now: seeded })
    let result: { ready: string[]; failed: string[] }
    try {
      result = await renderer.wait([job], "/drafts/real")
    } finally {
      vi.useRealTimers()
    }
    expect(result, renderer.failureOf(hash) ?? "").toEqual({ ready: [hash], failed: [] })

    const mov = join(dir, "graphics", `${hash}.mov`)
    const probe = JSON.parse(execFileSync(shipped.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,width,height", "-of", "json", mov], { encoding: "utf8" })) as { streams: { codec_name: string; pix_fmt: string; width: number; height: number }[] }
    const box = stageBox(job.spec.box, canvas)
    expect(probe.streams[0]).toEqual({ codec_name: "prores", pix_fmt: expect.stringMatching(/^yuva/), width: box.width, height: box.height })

    // PNG header: bit depth 8, colour type 6 (RGBA)
    const poster = join(dir, "graphics", `${hash}.png`)
    const png = await readFile(poster)
    expect([png[24], png[25]]).toEqual([8, 6])
    expect(png.readUInt32BE(16)).toBe(270)
    // the plate is drawn, on a transparent ground: about half the stage is opaque halfway through
    const alpha = execFileSync(shipped.ffmpeg, ["-nostdin", "-v", "error", "-i", poster, "-vf", "alphaextract,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], { encoding: "utf8" })
    const averageAlpha = Number(alpha.match(/YAVG=([\d.]+)/)?.[1])
    expect(averageAlpha).toBeGreaterThan(64)
    expect(averageAlpha).toBeLessThan(230)

    expect(JSON.parse(await readFile(join(dir, "graphics", `${hash}.json`), "utf8"))).toEqual({ width: box.width, height: box.height, durationUs: 1_500_000, place: placeOnCanvas(box, canvas) })

    const config = JSON.parse(await readFile(join(dir, "work", "home", ".hyperframes", "config.json"), "utf8"))
    expect(config).toMatchObject({ latestVersion: PACK_HYPERFRAMES_VERSION, lastUpdateCheck: seeded.toISOString(), lastSkillsCheck: seeded.toISOString() })
    expect(await readdir(join(dir, "work", "compose"))).toEqual([])
  }, 180_000)

  test("cancel() stops the render and HyperFrames closes its Chrome", async () => {
    const { dir, renderer } = await realRenderer()
    const job = realJob(6)
    const waited = renderer.wait([job], "/drafts/real")
    // cancelled a second after its Chrome is up, so the check below has something to see go
    await vi.waitFor(() => expect(chromesUnder(join(dir, "work"))).not.toEqual([]), { timeout: 30_000, interval: 100 })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const before = chromesUnder(join(dir, "work"))
    expect(before).not.toEqual([])
    renderer.cancel()
    await expect(waited).resolves.toEqual({ ready: [], failed: [] })
    await new Promise((resolve) => setTimeout(resolve, 6000))
    expect(chromesUnder(join(dir, "work"))).toEqual([])
    // nor any helper left behind by a browser that went: those would have lost their parent
    expect(chromes().filter((chrome) => before.includes(chrome.pid))).toEqual([])
    expect(await renderer.statusOf(renderer.hashOf(job))).toBe("waiting")
  }, 60_000)
})
