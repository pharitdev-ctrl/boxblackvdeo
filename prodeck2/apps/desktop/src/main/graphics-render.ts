import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative } from "node:path"
import { writeFileAtomic } from "@boxblack/core/atomic-write"
import { placeOnCanvas, stageBox } from "@boxblack/core/graphics/framing"
import { motionHtml, type MotionAssets } from "@boxblack/core/graphics/motion"
import { lintFragment } from "@boxblack/core/graphics/motion/lint"
import { clipText, MOTION_VERSION, type GraphicSpec, type MotionSpec } from "@boxblack/core/graphics/plan"
import type { Palette } from "@boxblack/core/highlights/styles"
import { ProcessError, runProcess } from "@boxblack/core/media"
import type { AppEvent, GraphicRenderState, GraphicsProblem } from "../shared/api.ts"
import { PACK_HYPERFRAMES_VERSION } from "../shared/graphics-pack.ts"
import type { GraphicsPackPaths } from "./graphics-pack.ts"
import { EnvironmentError } from "./environment-error.ts"

/** Everything a render depends on; the hash of what is drawn, with the contract in force now, names the file. */
export interface RenderJob {
  spec: GraphicSpec
  canvas: { width: number; height: number }
  fps: number
  font: { family: string; file: string }
  /** the highlight style's palette as it is (Rgb); the graphic's page gives its colours to the fragment (`motionColours`) */
  palette: Palette
  /** the times now, in seconds from the graphic's start, of the words the graphic was written for; none when it has no words */
  times?: number[]
}

/** What the writer needs about a rendered file. */
export interface RenderedGraphic {
  hash: string
  path: string
  width: number
  height: number
  durationUs: number
  place: { scale: number; x: number; y: number }
}

/** What a rendered graphic shows, read from how opaque each of its frames is at its most opaque point. */
export interface Inspection {
  /** some frame has something drawn in it */
  visible: boolean
  /** the last frame has nothing drawn in it */
  goneAtEnd: boolean
}

export interface GraphicsRenderDeps {
  /** where the .mov, .png and .json land: ~/Movies/CapCut/BOXBLACK/graphics */
  graphicsDir: string
  /** scratch for the composition folders and HyperFrames' own HOME */
  workDir: string
  /** where the highlight fonts are (Resources/fonts) */
  fontDir: string
  /** the script every graphic's page ends with (Resources/graphics/host.js); when it cannot be read, that is the machine's problem and no graphic's */
  motionAssets: () => Promise<MotionAssets>
  pack: () => Promise<GraphicsPackPaths | null>
  ffmpeg: () => string | null
  /** the app's ffprobe, which HyperFrames is given alongside ffmpeg */
  ffprobe: () => string | null
  /**
   * renders `project`/index.html into `output`, stopping when `signal` aborts, and answers what the renderer
   * printed, standard output and standard error together, or nothing when it printed nothing; HyperFrames
   * under the pack's Node by default
   */
  run?: (project: string, output: string, fps: number, signal: AbortSignal) => Promise<string | void>
  /** what a rendered graphic shows, from the alpha of each of its frames, stopping when `signal` aborts; the shipped ffmpeg by default */
  inspect?: (mov: string, signal: AbortSignal) => Promise<Inspection>
  /** one small PNG from the middle of the file; the shipped ffmpeg by default */
  poster?: (mov: string, png: string, midS: number) => Promise<void>
  /** how long one render may take, the inspection included, before it counts as failed; RENDER_TIMEOUT_MS by default */
  renderTimeoutMs?: number
  send: (event: AppEvent) => void
}

type GraphicMeta = Omit<RenderedGraphic, "hash" | "path">

const RENDER_TIMEOUT_MS = 120_000
/** how long a cancelled HyperFrames gets to close its Chrome workers before it is killed */
const RENDER_STOP_GRACE_MS = 5_000
const POSTER_WIDTH = 270
/** what `hashOf` makes; anything else handed in as a hash never reaches a path */
const HASH = /^[0-9a-f]{16}$/

const isFile = (path: string) => stat(path).then((found) => found.isFile(), () => false)

// the machine's fault, shared with the sound renderer; still exported from here for what imports it from here
export { EnvironmentError }

/**
 * Why graphics cannot render, from what a render found wrong with the machine, which stops every
 * graphic; null when none did. The renderer answers by this, and so do the fakes of it in the tests,
 * which then cannot drift from it.
 */
export function problemFor(machine: string | null): GraphicsProblem | null {
  return machine === null ? null : { text: machine }
}

/**
 * What is kept of a graphic's failure, and sent with the event that reports it: a plain error's
 * message alone, since the "Error: " in front of it says nothing. Any other error is kept as it
 * reads, with the name that says what kind it is (a ProcessError, a TimeoutError), and so is a plain
 * error with no message, whose name is all it has. A graphic's failure is handed to Claude as the
 * reasons to repair it, one a line.
 */
function failureText(error: unknown): string {
  return error instanceof Error && error.name === "Error" && error.message !== "" ? error.message : String(error)
}

/**
 * Why a file could not be read or copied, short enough to show: its error code when it has one,
 * since the message carries the path, which can run through the user's home folder.
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.message) : String(error)
}

/**
 * The machine's fault when the renderer's work folder cannot be made ready for a render, wherever that
 * shows: no room, no permission, or something in the way. A repair of the graphic would not put it right.
 */
const unprepared = (error: unknown) => new EnvironmentError(`the renderer's work folder could not be prepared (${reasonOf(error)})`)

/** The machine's fault when what was rendered cannot be put in the graphics folder: the folder, the file or its meta cannot be written. */
const unkept = (error: unknown) => new EnvironmentError(`the rendered graphic could not be kept (${reasonOf(error)})`)

/**
 * Before every command HyperFrames asks the npm registry for a newer version of itself and GitHub
 * (through git) for newer agent skills, unless its config (`<HOME>/.hyperframes/config.json`) says
 * it asked less than a day ago; the environment variables only stop the notices and the
 * self-install, not the requests, and with no skills installed it never records the skills check.
 * Writing that both were just checked, the pinned version being the latest, keeps a render off the
 * network. Other keys are kept.
 */
export async function quietHyperframesHome(home: string, version: string, now = new Date()): Promise<void> {
  const file = join(home, ".hyperframes", "config.json")
  let config: Record<string, unknown> = {}
  try {
    const read = JSON.parse(await readFile(file, "utf8")) as unknown
    if (read && typeof read === "object" && !Array.isArray(read)) config = read as Record<string, unknown>
  } catch {
    // none yet, or not JSON: start over
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ ...config, lastUpdateCheck: now.toISOString(), latestVersion: version, lastSkillsCheck: now.toISOString() }))
}

/**
 * What a render runs by name: `id`, `pgrep` and `ps` watch and clean up the Chrome processes, and
 * `ps` samples their memory while frames are captured (read in HyperFrames 0.8.65's cli.js; the
 * pack build script links the same set, so a pack that needs another one fails there first).
 * ffmpeg and ffprobe are given by path (HYPERFRAMES_FFMPEG_PATH / HYPERFRAMES_FFPROBE_PATH), which
 * also stops HyperFrames falling back to a Homebrew ffmpeg when ours is missing.
 */
const RENDER_TOOLS = { id: "/usr/bin/id", pgrep: "/usr/bin/pgrep", ps: "/bin/ps" } as const

/**
 * The only folder on a render's PATH, made fresh each time, holding links to the system tools a
 * render needs and nothing else: with /usr/bin on the PATH, HyperFrames' skills check would run
 * git, which on a Mac without the developer tools pops up an installer on every render.
 */
export async function renderBinDir(dir: string): Promise<string> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const [name, target] of Object.entries(RENDER_TOOLS)) await symlink(target, join(dir, name))
  return dir
}

/**
 * The Chrome a render runs: a script in `dir`, written again before each render, that runs the pack's
 * own Chrome with no route off this machine. Every connection but one to this machine itself goes to
 * a proxy that is not there: Chrome sends loopback and link-local addresses direct whatever proxy is
 * set, so `<-loopback>` takes those rules of its own away, and the three names after it give back
 * this machine alone, where HyperFrames serves the page. WebRTC is held to the proxy too, and no new
 * window is opened. A page's content security policy does not stop its script moving the page on or
 * opening a window; with this, neither reaches another machine. A navigation to another port of this
 * machine still sends one request, which is known and accepted.
 *
 * The flags come after the renderer's own arguments: Chrome takes the last of a repeated switch, so a
 * proxy switch among the renderer's would not win. The path is written in single quotes, each quote
 * in it as '\'', since it runs through the user's Application Support and is never trusted to be
 * plain; the list of what goes direct has quotes of its own, `<`, `>` and `;` being the shell's.
 * HyperFrames takes the script for its browser (HYPERFRAMES_BROWSER_PATH).
 */
export async function offlineChrome(dir: string, chrome: string): Promise<string> {
  const script = join(dir, "chrome-offline.sh")
  await mkdir(dir, { recursive: true })
  await writeFile(
    script,
    `#!/bin/sh
# Chrome with no route off this machine: every connection but one to this machine itself goes to a proxy that is not there.
exec '${chrome.replaceAll("'", String.raw`'\''`)}' "$@" --proxy-server=http://127.0.0.1:9 '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]' --force-webrtc-ip-handling-policy=disable_non_proxied_udp --block-new-web-contents
`,
  )
  // whatever the umask made of it, or the file it replaced was
  await chmod(script, 0o755)
  return script
}

/** The most problems of the linter's a graphic's failure names, all on its one line. */
const LINT_PROBLEMS_NAMED = 3
/** The most reports of the host's a failure names, one a line; the rest are counted. */
const HOST_REPORTS_NAMED = 5
/** The most characters a failure keeps of one message a page gave. */
const MESSAGE_MAX = 300
/** How HyperFrames prints an error the page's script did not catch, or one in its syntax. */
const PAGE_ERROR = "[Browser:PAGEERROR]"
/** How it prints what the app's host script reports through console.error (see host.js). */
const HOST_ERROR = "[Browser:ERROR] BOXBLACK motion error:"
/** How the host's report of an error thrown by the fragment's window.frame starts. */
const FRAME_THREW = "window.frame threw:"
/** How HyperFrames says, on standard output and before the page is loaded, that its Chrome has started: every render whose browser starts prints it. */
const BROWSER_LAUNCHED = "[BrowserManager] Browser launched"

/** What a line says after the marker it starts with: cut, by whole characters, to a length that can be read, and never nothing. */
const saidAfter = (marker: string, line: string) => clipText(line.slice(marker.length).trim(), MESSAGE_MAX) || "(no message)"

/**
 * Why a graphic's page failed, from what HyperFrames printed while it rendered it, or null when
 * it printed nothing of the kind. HyperFrames exits 0 when the page's script is broken or throws, and
 * takes 20 s to give up on a page that never hands it a timeline, so what it printed is the only place
 * that shows; when it does exit with an error (a page that navigates away is lost to it), what it
 * printed is read the same way. The script's own error comes first; then what the host reported, one
 * report a line, what window.frame threw before the rest, the first few named and the others counted;
 * then the page never becoming ready. A line is printed once by each Chrome worker, so each message
 * counts once. A marker counts at the start of a line, where HyperFrames prints it. Anything else the
 * page or the renderer said is left alone: a request the page's policy blocked prints an error too,
 * and the render goes on. The words are read by Claude when the graphic is repaired, each line a reason.
 */
function pageFailure(printed: string): string | null {
  const lines = printed.split("\n")
  const thrown = lines.find((line) => line.startsWith(PAGE_ERROR))
  if (thrown !== undefined) return `the script failed: ${saidAfter(PAGE_ERROR, thrown)}`
  const reported = [...new Set(lines.filter((line) => line.startsWith(HOST_ERROR)).map((line) => saidAfter(HOST_ERROR, line)))]
  if (reported.length > 0) {
    const ordered = [...reported.filter((report) => report.startsWith(FRAME_THREW)), ...reported.filter((report) => !report.startsWith(FRAME_THREW))]
    const named = ordered.slice(0, HOST_REPORTS_NAMED)
    return [...named, ...(ordered.length > named.length ? [`and ${ordered.length - named.length} more`] : [])].join("\n")
  }
  if (printed.includes("sub_timeline_readiness_timeout")) return "the page never became ready (its script did not finish)"
  return null
}

/** A frame whose most opaque point is at or under this, on the scale of 0 to 255 ffmpeg reports it on, has nothing drawn in it. */
const EMPTY_FRAME_MAX = 16

/**
 * What a rendered file shows, from what ffmpeg printed of its alpha: one `lavfi.signalstats.YMAX`
 * line a frame, the frame's most opaque point. A file with no frame at all shows nothing.
 */
export function inspectionOf(printed: string): Inspection {
  const peaks = [...printed.matchAll(/^lavfi\.signalstats\.YMAX=(\d+)/gm)].map((found) => Number(found[1]))
  return { visible: peaks.some((peak) => peak > EMPTY_FRAME_MAX), goneAtEnd: (peaks.at(-1) ?? 0) <= EMPTY_FRAME_MAX }
}

/**
 * The name of a job's file. A graphic's file is of what its page is made from: the fragment, its box on the frame, its
 * length, the times of its words now and the style it is drawn in, with the contract in force now (MOTION_VERSION,
 * which stands for the page and the host too) and not the version stamped on the spec. Its reason, its idea, its words
 * as they were when it was written, a failed writing or edit, the change that made it and the fragment kept for a step
 * back are not drawn, so they make no other file.
 */
export function hashOf(job: RenderJob): string {
  const parts = [job.spec.html, job.spec.box, job.spec.seconds, job.times ?? [], job.canvas, job.fps, job.font, job.palette, MOTION_VERSION]
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)
}

/**
 * Renders graphics one at a time in the background and keeps what it made by the hash of the job,
 * so the same graphic is never rendered twice and any change to it is a new file. Each is checked
 * as well: its fragment by the linter before it is rendered, then what HyperFrames printed and what
 * its frames show, and one that fails a check is not kept. A graphic's failure is kept until the
 * user retries, or until `forgetFailures()`; a fault of the machine is no graphic's failure. Nothing
 * is deleted here (a CapCut draft may point at the file).
 */
export function createGraphicsRenderer(deps: GraphicsRenderDeps) {
  const failures = new Map<string, string>()
  /** why nothing can render on this machine, as the last render found: kept until `forgetMachine()` or `forgetFailures()`, and no graphic's failure */
  let environment: string | null = null
  /** the asks not settled yet: being sorted, or waiting for their renders */
  let asking = 0
  /** each job's task until it settles, by generation and hash, so asking for it again joins it rather than queueing behind the rest */
  const inFlight = new Map<string, Promise<void>>()
  /** the one render under way, which `cancel()` stops */
  let current: { hash: string; controller: AbortController } | null = null
  /** moved on by `cancel()`: a job asked for before then does not start */
  let generation = 0
  let chain: Promise<void> = Promise.resolve()
  /** each ask's sorting of its jobs, in the order the asks came, so jobs queue in the order they were asked for */
  let sorting: Promise<unknown> = Promise.resolve()

  const files = (hash: string) => ({ mov: join(deps.graphicsDir, `${hash}.mov`), png: join(deps.graphicsDir, `${hash}.png`), json: join(deps.graphicsDir, `${hash}.json`) })

  /** An event the app cannot take is its loss: never a graphic's failure, nor a stop to the queue. */
  function send(event: AppEvent): void {
    try {
      deps.send(event)
    } catch {
      // nothing to be done about it here
    }
  }

  /** A made graphic's meta: its .json reads and the file it describes is there. Null for anything less, which is rendered again. */
  async function made(hash: string): Promise<GraphicMeta | null> {
    try {
      const meta = JSON.parse(await readFile(files(hash).json, "utf8")) as GraphicMeta
      await stat(files(hash).mov)
      return meta
    } catch {
      return null
    }
  }

  async function runHyperframes(project: string, output: string, fps: number, signal: AbortSignal): Promise<string> {
    const pack = await deps.pack()
    if (!pack) throw new EnvironmentError("the graphics renderer is not installed")
    const ffmpeg = deps.ffmpeg()
    if (!ffmpeg) throw new EnvironmentError("the app's ffmpeg is missing")
    const ffprobe = deps.ffprobe()
    if (!ffprobe) throw new EnvironmentError("the app's ffprobe is missing")
    // a pack short of a program is the machine's fault, told before HyperFrames runs. The browser HyperFrames
    // is given is the app's own script (see offlineChrome), which is always there, so HyperFrames itself would
    // never find the pack's Chrome missing (given a browser path with no file, it downloads a Chrome, about
    // 100 MB, from Google); that Chrome is what the script runs, so it is looked for here
    for (const part of [pack.node, pack.hyperframes, pack.chrome]) {
      // named inside the pack: the whole path runs through the user's home folder, and the app shows this
      if (!(await isFile(part))) throw new EnvironmentError(`the graphics renderer is damaged: reinstall it in settings (${relative(pack.root, part)} is missing)`)
    }
    for (const [name, path] of [["ffmpeg", ffmpeg], ["ffprobe", ffprobe]] as const) {
      // the tool alone, as the app shows it: its path can run through the user's home folder
      if (!(await isFile(path))) throw new EnvironmentError(`the app's ${name} is missing`)
    }
    const home = join(deps.workDir, "home")
    let bin: string
    let chrome: string
    try {
      // before every render: both checks' notes last a day, and the skills one is never renewed without skills
      await quietHyperframesHome(home, PACK_HYPERFRAMES_VERSION)
      // renders run one at a time: a Chrome profile here is one a render that never finished left behind
      await rm(join(home, "tmp"), { recursive: true, force: true })
      await mkdir(join(home, "tmp"), { recursive: true })
      bin = await renderBinDir(join(deps.workDir, "bin"))
      // the pack's Chrome, found to be there above, run through a script that leaves it no route off this machine
      chrome = await offlineChrome(deps.workDir, pack.chrome)
    } catch (error) {
      throw unprepared(error)
    }
    const { stdout, stderr } = await runProcess(pack.node, [pack.hyperframes, "render", project, "--format", "mov", "--fps", String(fps), "--workers", "2", "--quiet", "--frames-cache-dir", "off", "--player-ready-timeout", "20000", "-o", output], {
      signal,
      // HyperFrames takes SIGTERM as "cancel the render" and closes its Chrome workers itself
      stopGraceMs: RENDER_STOP_GRACE_MS,
      env: {
        HOME: home,
        TMPDIR: join(home, "tmp"),
        XDG_STATE_HOME: join(home, ".state"),
        // only what a render calls: see renderBinDir
        PATH: bin,
        HYPERFRAMES_FFMPEG_PATH: ffmpeg,
        HYPERFRAMES_FFPROBE_PATH: ffprobe,
        HYPERFRAMES_NO_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        HYPERFRAMES_SKIP_SKILLS: "1",
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
        HYPERFRAMES_NO_AUTO_INSTALL: "1",
        HYPERFRAMES_BROWSER_PATH: chrome,
        HYPERFRAMES_FONT_CACHE_DIR: join(home, "fonts"),
        LANG: "en_US.UTF-8",
      },
    })
    return `${stdout}\n${stderr}`
  }

  /** The app's host script for a graphic's page, or that there is none to be had, which is no graphic's fault. */
  async function motionHost(): Promise<MotionAssets> {
    try {
      return await deps.motionAssets()
    } catch {
      throw new EnvironmentError("the app's motion host is missing: reinstall BOXBLACK")
    }
  }

  async function makePoster(mov: string, png: string, midS: number): Promise<void> {
    const ffmpeg = deps.ffmpeg()
    if (!ffmpeg) throw new EnvironmentError("the app's ffmpeg is missing")
    // 8-bit RGBA: the file itself is 12-bit, which would otherwise make a 16-bit PNG
    await runProcess(ffmpeg, ["-nostdin", "-v", "error", "-y", "-ss", String(midS), "-i", mov, "-frames:v", "1", "-vf", `scale=${POSTER_WIDTH}:-2`, "-pix_fmt", "rgba", "-update", "1", png])
  }

  /**
   * What a rendered file shows, as the app's ffmpeg reads the alpha of each of its frames, stopped when
   * the render's `signal` aborts so that an ffmpeg stuck on a file is not left to hang. An ffmpeg that
   * is not there is the machine's problem; one that fails on this file fails this graphic, as a poster
   * that cannot be made does.
   */
  async function inspect(mov: string, signal: AbortSignal): Promise<Inspection> {
    const ffmpeg = deps.ffmpeg()
    if (!ffmpeg) throw new EnvironmentError("the app's ffmpeg is missing")
    // with -v error, standard output holds only each frame's two lines
    const { stdout } = await runProcess(ffmpeg, ["-nostdin", "-v", "error", "-i", mov, "-vf", "alphaextract,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-", "-f", "null", "-"], { signal })
    return inspectionOf(stdout)
  }

  /**
   * A graphic's fragment, fit to be rendered: written, and passed by the linter here whatever
   * checked it when it was written, so that nothing the linter refuses reaches the renderer's Chrome.
   */
  function checkedFragment(spec: MotionSpec): string {
    if (spec.html === null) throw new Error("the graphic has not been written")
    const problems = lintFragment(spec.html)
    if (problems.length > 0) throw new Error(`the fragment was refused: ${problems.slice(0, LINT_PROBLEMS_NAMED).join("; ")}`)
    return spec.html
  }

  /**
   * Renders a graphic's page into `rendered` and checks what came of it: what HyperFrames printed,
   * then what the frames of the file show, looked at where HyperFrames wrote it so that a file refused
   * leaves nothing in the graphics folder. What fails it here is read by Claude when the graphic is
   * repaired, so it is said in the app's own words, which say what to change in the fragment:
   * HyperFrames' last lines name its own globals (window.__hf), which the linter refuses, and a
   * timeout's own words say nothing of the script. A HyperFrames that gave up without its browser ever
   * starting is the machine's fault, which no repair of a fragment puts right. The time is the render's,
   * the inspection included.
   */
  async function renderChecked(project: string, rendered: string, fps: number, stop: AbortSignal): Promise<void> {
    const limit = AbortSignal.timeout(deps.renderTimeoutMs ?? RENDER_TIMEOUT_MS)
    const signal = AbortSignal.any([stop, limit])
    // stopped by its time running out, which is not a cancel: a cancel is no failure at all, and is left as it is
    const orOutOfTime = (error: unknown) => (limit.aborted && error === limit.reason ? new Error("the render ran out of time: the script must finish at once and draw every frame quickly") : error)
    let printed: string | void
    try {
      printed = await (deps.run ?? runHyperframes)(project, rendered, fps, signal)
    } catch (error) {
      if (!(error instanceof ProcessError)) throw orOutOfTime(error)
      // HyperFrames gave up: what it printed by then is read as it is when it exits 0
      const said = `${error.stdout}\n${error.stderr}`
      const fault = pageFailure(said)
      if (fault !== null) throw new Error(fault)
      // with no word of its browser starting there was no page to blame: the fragment is left as it is, and every
      // graphic waits, as for a damaged pack
      if (!said.split("\n").some((line) => line.startsWith(BROWSER_LAUNCHED))) throw new EnvironmentError("the graphics renderer could not start its browser: reinstall it in settings")
      throw new Error("the renderer could not draw the page: its script must finish at once, and must not leave, reload or replace the page")
    }
    // HyperFrames renders a page whose script is broken or throws all the same, and exits 0: only what it printed says so
    const broken = pageFailure(printed ?? "")
    if (broken !== null) throw new Error(broken)
    const seen = await (deps.inspect ?? inspect)(rendered, signal).catch((error: unknown) => {
      throw orOutOfTime(error)
    })
    if (!seen.visible) throw new Error("nothing was drawn: every frame is empty")
    // the last frame is drawn one frame before D, where a way out that ends at D itself still shows
    if (!seen.goneAtEnd) throw new Error("it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D")
  }

  async function render(job: RenderJob, hash: string, stop: AbortSignal): Promise<void> {
    if (await made(hash)) return
    // the page names the font by its file name, copied next to it: never a path that leads elsewhere
    if (basename(job.font.file) !== job.font.file) throw new Error(`a graphic's font must be a file name alone, not ${job.font.file}`)
    // a graphic is drawn from the fragment Claude wrote for it, and what fails it from here on is read by
    // Claude when it is repaired
    const fragment = checkedFragment(job.spec)
    const out = files(hash)
    // it is drawn on a stage that is its box and no more
    const box = stageBox(job.spec.box, job.canvas)
    const compose = join(deps.workDir, "compose")
    const project = join(compose, hash)
    try {
      // renders run one at a time: anything here is what a render that never finished left behind
      await rm(compose, { recursive: true, force: true })
      await mkdir(join(project, "renders"), { recursive: true })
    } catch (error) {
      throw unprepared(error)
    }
    try {
      const html = motionHtml({ html: fragment, stage: box, seconds: job.spec.seconds, fps: job.fps, times: job.times ?? [], palette: job.palette, font: job.font, assets: await motionHost() })
      await writeFile(join(project, "index.html"), html).catch((error: unknown) => {
        throw unprepared(error)
      })
      await copyFile(join(deps.fontDir, job.font.file), join(project, job.font.file)).catch((error: unknown) => {
        throw new EnvironmentError(`the app's font ${job.font.file} could not be copied (${reasonOf(error)})`)
      })
      const rendered = join(project, "renders", `${hash}.mov`)
      await renderChecked(project, rendered, job.fps, stop)
      // a graphics folder that cannot be written is the machine's fault, as the work folder is; a poster that
      // cannot be taken is still the graphic's, since ffmpeg failed on its file
      try {
        await mkdir(deps.graphicsDir, { recursive: true })
        // rename cannot cross volumes (tmp to ~/Movies): copy instead, and the original goes with the compose folder below
        await rename(rendered, out.mov).catch(() => copyFile(rendered, out.mov))
      } catch (error) {
        throw unkept(error)
      }
      await (deps.poster ?? makePoster)(out.mov, out.png, job.spec.seconds / 2)
      const meta: GraphicMeta = { width: box.width, height: box.height, durationUs: Math.round(job.spec.seconds * 1_000_000), place: placeOnCanvas(box, job.canvas) }
      // written last and whole: once it reads, the graphic is made
      await writeFileAtomic(out.json, JSON.stringify(meta)).catch((error: unknown) => {
        throw unkept(error)
      })
    } finally {
      // as well as it can: a folder that cannot be removed must not replace what was thrown above, nor fail a
      // render that was made. It goes when the next render clears the compose folder, which says so if it cannot
      await rm(project, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** The job's place in the queue: joined when it is already there, else added at the back. */
  function queue(job: RenderJob, hash: string, asked: number, folder: string): Promise<void> {
    // after a cancel, a job gets a task of its own rather than joining the cancelled one
    const key = `${asked} ${hash}`
    const joined = inFlight.get(key)
    if (joined) return joined
    const task = chain.then(async () => {
      try {
        // a machine found unfit by the job before this one is no better for this one
        if (failures.has(hash) || environment !== null) return
        if (!(await deps.pack())) return
        // cancelled while it waited its turn, or while the pack was checked: not made, and not a failure
        if (asked !== generation) return
        const controller = new AbortController()
        current = { hash, controller }
        // the look at the preview this brings about reads it as rendering, and joins it rather than queueing it again
        send({ type: "graphics", folder, state: "started", hash })
        try {
          await render(job, hash, controller.signal)
        } catch (error) {
          // stopped by cancel(): nothing wrong with the graphic, so it renders again when next asked
          if (controller.signal.aborted) return
          // nor with it when the machine is to blame: it waits, as for a missing pack, until that is put right
          if (error instanceof EnvironmentError) {
            // the app shows it as it is: its last line says what is wrong
            environment = error.message.split("\n").filter((line) => line.trim()).at(-1)?.trim() || "graphics cannot be rendered on this machine"
            return
          }
          const failure = failureText(error)
          failures.set(hash, failure)
          send({ type: "graphics", folder, state: "failed", hash, error: failure })
        } finally {
          current = null
        }
      } catch {
        // a pack that cannot even be looked for renders nothing, and must not stop the jobs behind this one
      }
    })
    chain = task
    inFlight.set(key, task)
    void task.finally(() => inFlight.delete(key))
    return task
  }

  /**
   * Queues the jobs not made yet, one render after another, reporting each as it starts and as it
   * is done, and then the end, to `folder`. Jobs already made or failed are answered at once, and an
   * ask that queues nothing sends nothing: the app asks on every look at a preview. Nor is anything
   * queued on a machine a render found unfit, until `forgetMachine()` or `forgetFailures()`.
   */
  function schedule(jobs: RenderJob[], folder: string): Promise<{ ready: string[]; failed: string[] }> {
    asking++
    return sortAndRender(jobs, folder).finally(() => asking--)
  }

  function sortAndRender(jobs: RenderJob[], folder: string): Promise<{ ready: string[]; failed: string[] }> {
    const asked = generation
    const sorted = sorting.then(async () => {
      const ready: string[] = []
      const failed: string[] = []
      const todo: [string, RenderJob][] = []
      // the same graphic asked for twice is one job
      for (const [hash, job] of new Map(jobs.map((job) => [hashOf(job), job]))) {
        if (await made(hash)) ready.push(hash)
        else if (failures.has(hash)) failed.push(hash)
        else todo.push([hash, job])
      }
      return { ready, failed, todo }
    })
    sorting = sorted.catch(() => {})
    return sorted.then(async ({ ready, failed, todo }) => {
      // on a machine a render found unfit everything waits, and is not asked for again until `forgetMachine()` or `forgetFailures()`
      const able = environment === null ? todo : []
      if (able.length === 0) return { ready, failed }
      let done = 0
      await Promise.all(
        able.map(([hash, job]) =>
          queue(job, hash, asked, folder).then(async () => {
            done++
            if (await made(hash)) ready.push(hash)
            else if (failures.has(hash)) failed.push(hash)
            send({ type: "graphics", folder, state: "progress", hash, done, total: able.length })
          }),
        ),
      )
      send({ type: "graphics", folder, state: "done" })
      return { ready, failed }
    })
  }

  function forgetMachine(): void {
    environment = null
  }

  return {
    deps,
    hashOf,
    /** Starts rendering what is not made yet and returns at once. */
    ensure(jobs: RenderJob[], folder: string): void {
      schedule(jobs, folder).catch(() => {})
    },
    /** Renders what is not made yet and settles when every job is made, has failed, was cancelled, or cannot render on this machine. */
    wait(jobs: RenderJob[], folder: string): Promise<{ ready: string[]; failed: string[] }> {
      return schedule(jobs, folder)
    },
    /** Nothing asked for is being sorted, queued or rendered: no file is in the making, or about to be. */
    idle: (): boolean => asking === 0,
    /** Made, failed, being rendered now, or waiting: queued behind another, for the renderer pack, or not asked for since a cancel. */
    async statusOf(hash: string): Promise<GraphicRenderState> {
      if (!HASH.test(hash)) return "waiting"
      if (await made(hash)) return "ready"
      if (failures.has(hash)) return "failed"
      return current?.hash === hash ? "rendering" : "waiting"
    },
    failureOf: (hash: string): string | null => failures.get(hash) ?? null,
    retry(hash: string): void {
      failures.delete(hash)
    },
    /**
     * Why graphics cannot render on this machine now, as a render found it: the pack is missing or
     * damaged or its browser does not start, the app's ffmpeg, ffprobe, motion host or a font is
     * missing, or the work folder or the graphics folder cannot be written. Null when none was found
     * since `forgetMachine()` or `forgetFailures()`.
     */
    environmentProblem: (): GraphicsProblem | null => problemFor(environment),
    /** No render found the machine unfit. */
    machineReady: (): boolean => environment === null,
    /**
     * Forgets what a render found wrong with the machine, and nothing else: what waited for it is
     * tried again when next asked, so that a fault the user has since mended (a full disk freed) does
     * not go on holding every graphic. Each graphic's own failure stays, until `retry()` or
     * `forgetFailures()`.
     */
    forgetMachine,
    /**
     * Forgets every failure, the machine's and each graphic's, once something that may have put them
     * right has happened (the pack installed or removed, the tools looked for again): each graphic
     * renders again when next asked, rather than keeping a failure the user was told how to fix.
     */
    forgetFailures(): void {
      failures.clear()
      forgetMachine()
    },
    /**
     * Stops the render under way and every job queued behind it (the app is quitting): HyperFrames
     * gets to close its Chrome first, and nothing new starts. If the quit is called off, what is
     * asked for after this renders as usual, once the stopped render has closed.
     */
    cancel(): void {
      generation++
      current?.controller.abort()
    },
    async posterOf(hash: string): Promise<string | null> {
      if (!HASH.test(hash)) return null
      try {
        return `data:image/png;base64,${(await readFile(files(hash).png)).toString("base64")}`
      } catch {
        return null
      }
    },
    /** The rendered file for a job, or null when it is not made. */
    async rendered(job: RenderJob): Promise<RenderedGraphic | null> {
      const hash = hashOf(job)
      const meta = await made(hash)
      return meta ? { hash, path: files(hash).mov, ...meta } : null
    },
  }
}

export type GraphicsRenderer = ReturnType<typeof createGraphicsRenderer>
