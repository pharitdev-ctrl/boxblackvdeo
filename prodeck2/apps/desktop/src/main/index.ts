import { homedir, hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { TranscriptCache, WHISPER_MODELS } from "@boxblack/core/asr"
import { MediaCache } from "@boxblack/core/cache"
import { findDraftsRoot, isCapCutRunning } from "@boxblack/core/capcut"
import { findExecutable, inspectTools, measureLoudness, ProcessError, runProcess, type Loudness } from "@boxblack/core/media"
import { extractFrames, type VideoInsight, type VisionKey } from "@boxblack/core/vision"
import { motionAssets, type MotionAssets } from "@boxblack/core/graphics/motion"
import { styleFor } from "@boxblack/core/highlights/styles"
import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, safeStorage, session, shell } from "electron"
import { API_METHODS, type AppEvent, type DesktopApi, type StoredOutline } from "../shared/api.ts"
import { GRAPHICS_PACK } from "../shared/graphics-pack.ts"
import { MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES } from "../shared/media-url.ts"
import { createApi } from "./api.ts"
import { deviceId } from "./device.ts"
import { createLicenseService } from "./license.ts"
import { createLicenseApi, gateApi, noLicenseApi } from "./license-api.ts"
import { LICENSING } from "./edition.ts"
import { PINNED_WHISPER_DIRS } from "../shared/whisper-tap.ts"
import { DEFAULT_REMOTE_CONFIG } from "@boxblack/core/license/protocol"
import { LICENSE_PUBLIC_KEY } from "./license-public-key.ts"
import { resolvePrompts } from "./prompts.ts"
import { createMediaHandler, createThumbnailer } from "./media.ts"
import { migrateDataDir } from "./migrate-data.ts"
import { createOutlineApi } from "./outline-api.ts"
import { chosenLlm } from "./llm.ts"
import { createPlannerService, OutlineStore } from "./planner.ts"
import { outlineUpgrades } from "./post-cleanup.ts"
import { ProgressStore, stagesOf } from "./progress.ts"
import { SecretStore, SettingsStore } from "./settings.ts"
import { createAnalysisService } from "./analysis.ts"
import type { ObjectsCache } from "./objects.ts"
import { createClaudeCode, parseAuthStatus, spawnGroup } from "./claude-code.ts"
import { createClaudeCodeApi } from "./claude-code-api.ts"
import { createFrameFiles, lookTimes } from "./frame-files.ts"
import { createAiCalls } from "./ai-calls.ts"
import { createGraphicsPack } from "./graphics-pack.ts"
import { createGraphicsRenderer } from "./graphics-render.ts"
import { cleanGraphicFiles, graphicFilesInfo } from "./graphics-files.ts"
import { createSettingsApi } from "./settings-api.ts"
import { AgentStore, createAgentService } from "./agent.ts"
import { createAgentApi } from "./agent-api.ts"
import { createAgentWiring } from "./agent-wiring.ts"
import { TimelineStore } from "./timeline-store.ts"
import { createTimelineService } from "./timeline.ts"
import { createTimelineApi } from "./timeline-api.ts"
import { createFlairService } from "./flair.ts"
import { createPostPlanService } from "./post-plan.ts"
import { createSoundLibrary, unfetchableFile } from "./sound-library.ts"
import { createSpareMedia } from "./insert-media.ts"
import { MEDIA_PROMPT_VERSION, type MediaLook } from "@boxblack/core/flair/look-at"
import type { MediaKey } from "./flair.ts"
import { createHighlightApi } from "./highlight-api.ts"
import { createHighlightAssets } from "./highlight-assets.ts"
import { createHighlightService } from "./highlights.ts"
import { createEmphasisService } from "./emphasis.ts"
import { styleInForce } from "./highlight-state.ts"
import { createToolbox } from "./tools.ts"
import { createUpdater } from "./updater.ts"
import { sendTo } from "./main-window.ts"
import { createSoundRenderer } from "./sound-render.ts"
import { createSealedPage } from "./sound-window.ts"
import { createDrawPage } from "./preview-window.ts"
import { createPreviewFrames } from "./preview-frames.ts"
import { createPreview } from "./preview.ts"
import { createPreviewVideo } from "./preview-video.ts"
import { soundStatusOf } from "./composed-cues.ts"

/** The license server fixed at build time; while developing, BOXBLACK_LICENSE_SERVER can point elsewhere. */
const LICENSE_SERVER = (!app.isPackaged && process.env.BOXBLACK_LICENSE_SERVER) || __LICENSE_SERVER__
/** How often a packaged app with an update feed looks for a new version. */
const UPDATE_CHECK_MS = 6 * 3_600_000
/** How often the app looks at whether its license token is due for a refresh. */
const LICENSE_CHECK_MS = 15 * 60_000

// Node's own fetch, backed by undici, can throw an uncaught assertion out of a socket event
// (`assert(!this.paused)`) when a big download's connection ends while backpressure has the
// parser paused waiting on disk — Electron then shows that as a blocking "JavaScript error"
// alert with no way to catch it. net.fetch uses Chromium's network stack instead, which does
// not hit this, and it follows the system proxy too. Only the two big downloads (the graphics
// renderer pack, the whisper model) need it; every other fetch in this app reads a small response.
const bigDownloadFetch: typeof fetch = (input, init) =>
  // no-store: these are large, content-addressed downloads with their own Range resume — Chromium's
  // disk cache would only add writes and a second, conflicting idea of what byte range is cached
  net.fetch(input instanceof URL ? input.href : input, { ...init, cache: "no-store" })

// user data goes to ~/Library/Application Support/BOXBLACK, next to the downloaded model
app.setName("BOXBLACK")

// must happen before the app is ready
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES }])

/**
 * The app's one window to the user. The hidden page sounds are rendered in is a window too, so the app's events and
 * the dock's activate go by this one, not by the count of windows.
 */
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = window
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null
  })
  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())

  // the dev server is for development only: a packaged app never loads a page named by the environment
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(import.meta.dirname, "../renderer/index.html"))
}

function send(event: AppEvent): void {
  sendTo(mainWindow, event)
}

void app.whenReady().then(async () => {
  const userData = app.getPath("userData")
  // the product was called prodeck2 before BOXBLACK, and the data folder is named after it: the
  // customer's license, keys, transcription model and caches move across the first time
  await migrateDataDir({ from: join(dirname(userData), "prodeck2"), to: userData })
  // tools shipped inside the app bundle win over ones installed on the machine
  const bundledDirs = [join(process.resourcesPath, "bin")]
  // Claude Code's native installer puts it under ~/.local/bin, which a Finder-launched app does not have on PATH
  const tool = (name: string) =>
    findExecutable(name, {
      // the whisper-cli from BOXBLACK's own tap is the tested one, so it wins over Homebrew's whisper-cpp
      bundledDirs: name === "whisper-cli" ? [...bundledDirs, ...PINNED_WHISPER_DIRS] : bundledDirs,
      searchDirs: [join(homedir(), ".local", "bin"), join(homedir(), ".claude", "local")],
    })
  // ffmpeg ships in Resources/bin; customers install whisper-cli and Claude Code themselves, and a rescan picks them up
  const toolbox = createToolbox({
    find: tool,
    inspect: (paths) => inspectTools(paths),
    bundledDirs,
    pinnedDirs: PINNED_WHISPER_DIRS,
    // an ffmpeg or ffprobe found again may be what the graphics or the sounds failed for: each gets another try
    rescanned: () => {
      graphicsRenderer.forgetFailures()
      soundRenderer.forgetFailures()
    },
  })
  const tools = toolbox.paths

  let machine: Promise<string> | null = null
  // a build without licensing never creates the service: nothing is sent to a license server
  const license = LICENSING ? createLicenseService({
    serverUrl: LICENSE_SERVER,
    publicKey: LICENSE_PUBLIC_KEY,
    file: join(userData, "license.json"),
    box: safeStorage,
    deviceId: () =>
      (machine ??= deviceId({ platform: process.platform, dataDir: userData, run: async (command, args) => (await runProcess(command, args)).stdout })),
    device: { name: hostname().replace(/\.local$/, ""), platform: process.platform, appVersion: app.getVersion() },
    onChange: (state) => send({ type: "license", state }),
  }) : null
  // what the license server would send; the app's own defaults when there is none to ask
  const remoteConfig = async () => (license ? license.config() : DEFAULT_REMOTE_CONFIG)
  const prompts = async () => resolvePrompts((await remoteConfig()).prompts)

  const settings = new SettingsStore(join(userData, "settings.json"))
  // not "cache": the file system is case-insensitive and Chromium owns (and clears) userData/Cache
  const transcripts = new TranscriptCache(join(userData, "transcripts"))
  const insights = new MediaCache<VideoInsight, VisionKey>(join(userData, "insights"))
  // where things are in each scene of an insight, kept apart so the insights, their scenes and the outlines stay as they are
  const objects: ObjectsCache = new MediaCache(join(userData, "insights-objects"))
  const secrets = new SecretStore(join(userData, "secrets.json"), safeStorage)
  // an outline from before M25 loses Claude's old effects once, the first time it is read (spec §7), and one from
  // before 0.5.0 the graphics of the old kit; a copy of it as it was is kept first, beside the outlines folder
  // rather than in it, which is read whole for the project list
  const outlines = new OutlineStore(join(userData, "outlines"), { steps: outlineUpgrades(userData) })
  const progress = new ProgressStore(join(userData, "progress"))
  const projects = createApi({
    root: () => findDraftsRoot(homedir()),
    isCapCutRunning,
    testedVersions: async () => (await remoteConfig()).capcutVersions,
    stages: async () => stagesOf(await progress.all(), await outlines.all()),
  })
  // `claude auth status` for the readiness check and the settings screen; null when it cannot be asked
  const claudeAccount = async (path: string) => {
    try {
      return parseAuthStatus((await runProcess(path, ["auth", "status", "--json"], { signal: AbortSignal.timeout(15_000) })).stdout)
    } catch (error) {
      // signed out, it exits non-zero and still prints the status
      return error instanceof ProcessError ? parseAuthStatus(error.stdout) : null
    }
  }
  const claudeCode = createClaudeCode({
    macosMajor: Number(process.getSystemVersion().split(".")[0]),
    claudePath: () => tools.claude,
    version: async () => (await toolbox.report()).claude?.version ?? null,
    rescan: () => toolbox.rescan(),
    askStatus: claudeAccount,
    spawn: spawnGroup,
    openExternal: (url) => shell.openExternal(url),
    send,
  })
  const analysis = createAnalysisService({
    settings,
    secrets,
    transcripts,
    insights,
    objects,
    progress,
    workDir: join(tmpdir(), "boxblack-work"),
    modelsDir: join(userData, "models"),
    model: WHISPER_MODELS[0]!,
    tools,
    toolReport: toolbox.report,
    claudeSignedIn: async () => (tools.claude ? ((await claudeAccount(tools.claude))?.loggedIn ?? null) : null),
    inspect: (folder) => projects.inspectProject(folder),
    send,
    prompts,
    fetch: bigDownloadFetch,
  })
  const planner = createPlannerService({
    settings,
    secrets,
    transcripts,
    insights,
    objects,
    store: outlines,
    whisperModelId: WHISPER_MODELS[0]!.id,
    tools,
    inspect: (folder) => projects.inspectProject(folder),
    prompts,
  })
  const workDir = join(tmpdir(), "boxblack-work")
  // the Claude calls the editing room waits on: each can be stopped, and none waits forever
  const aiCalls = createAiCalls()
  const editingLlm = async (task: string) => aiCalls.wrap(await chosenLlm({ settings, secrets, tools }, task))
  const frameFiles = createFrameFiles({ workDir, extract: (input, timesUs, outDir) => extractFrames({ ffmpeg: tools.ffmpeg!, input, timesUs, outDir }) })
  const sounds = createSoundLibrary({
    projects: async () => (await projects.listProjects()).projects.map((project) => ({ folder: project.folder })),
    unfetchable: unfetchableFile(join(userData, "unfetchable-sounds.json")),
  })
  const media = createSpareMedia()
  const mediaLooks = new MediaCache<MediaLook, MediaKey>(join(userData, "media-looks"))
  // the renderer pack graphics overlays need; downloaded into userData on request, from the settings screen
  const graphicsPack = createGraphicsPack({ dir: join(userData, "hyperframes"), pack: GRAPHICS_PACK, fetch: bigDownloadFetch, send })
  // every rendered graphic lands here; the timeline write only prunes the media bin of files from this one folder
  const graphicsDir = join(homedir(), "Movies", "CapCut", "BOXBLACK", "graphics")
  // every composed sound's levelled WAV lands here, named by what it is made from; the write prunes the media bin of this folder too
  const soundsDir = join(homedir(), "Movies", "CapCut", "BOXBLACK", "sounds")
  const backupRoot = join(userData, "backups")
  // the app's shipped resources: next to the app when packaged, apps/desktop/resources in development
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(import.meta.dirname, "../../resources")
  // the script every graphic's page ends with, read once: it never changes while the app runs. A read that fails is
  // not kept, so the next ask reads again
  let motionHost: Promise<MotionAssets> | undefined
  const motion = () =>
    (motionHost ??= motionAssets(join(resourcesDir, "graphics")).catch((error: unknown) => {
      motionHost = undefined
      throw error
    }))
  // above zero for as long as the pack is being installed or removed, so a render never runs against a
  // pack folder that is about to be rm'd and re-extracted, or one whose installed.json is about to go
  let packChanging = 0
  const graphicsRenderer = createGraphicsRenderer({
    graphicsDir,
    workDir: join(tmpdir(), "boxblack-graphics"),
    fontDir: join(resourcesDir, "fonts"),
    motionAssets: motion,
    pack: async () => (packChanging > 0 ? null : graphicsPack.paths()),
    ffmpeg: () => tools.ffmpeg,
    ffprobe: () => tools.ffprobe,
    send,
  })
  // a machine a render found unfit (the pack damaged, the app's ffmpeg, motion host or a font missing) waits as a missing pack does,
  // until the pack is installed or removed or the tools are looked for again
  const graphicsReady = async () =>
    packChanging === 0 && graphicsRenderer.machineReady() && (await graphicsPack.paths()) !== null && tools.ffmpeg !== null && tools.ffprobe !== null
  const graphicFiles = {
    info: () => graphicFilesInfo(graphicsDir, soundsDir),
    clean: () => {
      // what a render is making, or a write is about to lay down, is in no draft yet. A write that starts after the
      // clean did counts even once it is over: the drafts it wrote to may have been read before it wrote them
      const writes = timeline.writesStarted()
      return cleanGraphicFiles({
        dir: graphicsDir,
        soundsDir,
        draftsRoot: findDraftsRoot(homedir()),
        backupRoot,
        trash: (path) => shell.trashItem(path),
        busy: () => !graphicsRenderer.idle() || !soundRenderer.idle() || timeline.anyWriting() || timeline.writesStarted() !== writes,
      })
    },
  }
  // the highlight style in force, custom palette included, for a graphic's colours
  const styleOf = async (stored: StoredOutline) => styleFor(styleInForce(stored.highlights), (await settings.read()).highlights.custom)
  // a counter, not a flag: an install() that fails "already downloading" must not clear another install's hold on this
  const changingPack = async (change: () => Promise<void>) => {
    packChanging++
    graphicsRenderer.cancel()
    try {
      await change()
      // a pack put in, or taken out, may be what the graphics failed for: each gets another try
      graphicsRenderer.forgetFailures()
    } finally {
      packChanging--
    }
  }
  const graphicsPackApi = {
    state: () => graphicsPack.state(),
    install: () => changingPack(() => graphicsPack.install()),
    cancel: () => graphicsPack.cancel(),
    remove: () => changingPack(() => graphicsPack.remove()),
  }
  // the sealed hidden page composed sounds are rendered in; its window is made on the first render. Both are made
  // before the timeline and highlight services, which the renderer is handed to
  const soundPage = createSealedPage({ BrowserWindow, session })
  // the agent's look at its own work: the frames pulled with ffmpeg, drawn in a hidden page of the app's own
  const drawPage = createDrawPage({ BrowserWindow, session })
  // each render that ends is told to the page, which reads its sounds again: a row would otherwise stay on กำลังเรนเดอร์…
  const soundRenderer = createSoundRenderer({ dir: soundsDir, ffmpeg: () => tools.ffmpeg, page: soundPage, onSettled: () => send({ type: "sounds-rendered" }) })
  const highlightAssets = createHighlightAssets({
    sourceDir: join(resourcesDir, "fonts"),
    // CapCut is sandboxed to ~/Movies, where its own drafts live too
    fontDir: join(homedir(), "Movies", "CapCut", "BOXBLACK", "fonts"),
    effectCache: join(homedir(), "Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect"),
  })
  const timeline = createTimelineService({
    settings,
    transcripts,
    insights,
    objects,
    whisperModelId: WHISPER_MODELS[0]!.id,
    inspect: (folder) => projects.inspectProject(folder),
    prompts,
    presets: async () => (await remoteConfig()).cutPresets,
    registered: async (folder) => {
      const { projects: known } = await projects.listProjects()
      if (!known.some((project) => project.folder === folder)) throw new Error(`${folder} is not a CapCut project`)
    },
    outlines,
    timelines: new TimelineStore(join(userData, "timelines")),
    loudness: new MediaCache<Loudness, { stepUs: number }>(join(userData, "loudness")),
    measureLoudness: (input) => (tools.ffmpeg ? measureLoudness({ ffmpeg: tools.ffmpeg, input }) : Promise.reject(new Error("ffmpeg-missing"))),
    backupRoot,
    isCapCutRunning,
    llm: () => editingLlm("polishing subtitles"),
    polishDir: join(userData, "subtitle-polish"),
    highlightAssets,
    sounds,
    media,
    graphics: graphicsRenderer,
    graphicsReady,
    graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options),
    graphicsDir,
    soundRenderer,
    composedSounds: (folder, rules, options) => highlights.composedSounds(folder, rules, options),
    soundsDir,
    send,
  })
  const highlights = createHighlightService({
    outlines,
    timeline,
    footage: { settings, transcripts, insights, objects, whisperModelId: WHISPER_MODELS[0]!.id, inspect: (folder) => projects.inspectProject(folder), prompts },
    llm: () => editingLlm("picking highlight text"),
    sounds,
    media,
    descriptions: async (paths) => {
      const said: Record<string, MediaLook> = {}
      const { llm } = await settings.read()
      for (const path of paths) {
        const known = await mediaLooks.get(path, { prompt: MEDIA_PROMPT_VERSION, model: llm.model })
        if (known !== null) said[path] = known
      }
      return said
    },
    graphics: graphicsRenderer,
    graphicsReady,
    styleOf,
    soundStatus: soundStatusOf(soundRenderer),
    soundRenderer,
  })
  const flair = createFlairService({
    outlines,
    timeline,
    sounds,
    media,
    descriptions: mediaLooks,
    frames: () => {
      const looking = frameFiles.session()
      return {
        of: (picture) => (tools.ffmpeg ? looking.of(picture.path, lookTimes(picture)) : Promise.resolve([])),
        at: (path, timesUs) => (tools.ffmpeg ? looking.of(path, timesUs) : Promise.resolve([])),
        dispose: looking.dispose,
      }
    },
    llm: () => editingLlm("planning zooms, cutaways, graphics and sounds"),
    videoPath: async (folder, videoId) => (await projects.inspectProject(folder)).videos.find((video) => video.id === videoId && video.exists)?.path ?? null,
    graphics: graphicsRenderer,
    graphicsReady,
    graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options),
    candidateJob: (folder, rules, graphic, spec) => highlights.candidateJob(folder, rules, graphic, spec),
    jobFor: (folder, cue) => highlights.jobFor(folder, cue),
    composedSounds: (folder, rules, options) => highlights.composedSounds(folder, rules, options),
    soundRenderer,
  })
  const emphasis = createEmphasisService({ outlines, timeline, llm: () => editingLlm("planning the emphasis points") })
  // the run behind the post page's one button: each work stored as it comes, the screen told how each stands;
  // cancelAi stops it, between two works too
  const post = createPostPlanService({ outlines, emphasis, highlights, flair, timeline, send, stopSignal: () => aiCalls.signal() })

  // the agent editor's previews: Claude's looks and the user's playable one, drawn from the timeline in memory
  const preview = createPreview({ frames: createPreviewFrames({ ffmpeg: tools.ffmpeg ?? "ffmpeg", dir: join(workDir, "preview-frames") }), page: drawPage })
  const previews = tools.ffmpeg ? createPreviewVideo({ ffmpeg: tools.ffmpeg, dir: join(workDir, "previews"), page: drawPage, draftOf: preview.draftOf }) : undefined

  // the agent editor: a conversation with Claude per project, on its own working timeline
  const agentWiring = createAgentWiring({
    timeline,
    outlines,
    settings,
    highlightAssets,
    sounds,
    graphics: graphicsRenderer,
    soundRenderer,
    llm: () => editingLlm("the agent editor"),
  })
  const agent = createAgentService({
    store: new AgentStore(join(userData, "agent")),
    llm: () => editingLlm("the agent editor"),
    footage: (folder) => agentWiring.footage(folder),
    clip: (folder) => agentWiring.clip(folder),
    makers: (folder) => agentWiring.makers(folder),
    send: (view) => send({ type: "agent", view }),
    look: tools.ffmpeg ? (folder, agentTimeline, span, signal) => preview.look(folder, agentTimeline, span, signal) : undefined,
  })

  const thumbnail = createThumbnailer({
    inspect: (folder) => projects.inspectProject(folder),
    extract: (input, atUs) => (tools.ffmpeg ? frameFiles.one(input, atUs) : Promise.reject(new Error("ffmpeg-missing"))),
  })

  protocol.handle(MEDIA_SCHEME, createMediaHandler((folder) => projects.inspectProject(folder), (id, name) => previews?.fileOf(id, name) ?? null))

  const updater = createUpdater({
    feedUrl: app.isPackaged && __UPDATE_URL__ ? __UPDATE_URL__ : null,
    load: async () => (await import("electron-updater")).autoUpdater,
    send,
  })

  const all: DesktopApi = {
      ...projects,
      ...createSettingsApi({
        settings,
        secrets,
        analysis,
        cutPresets: async () => (await remoteConfig()).cutPresets,
        toolbox,
        appVersion: app.getVersion(),
        sounds,
        graphicsPack: graphicsPackApi,
        graphicsProblem: () => graphicsRenderer.environmentProblem(),
        graphicFiles,
        // the window's own chrome and vibrancy follow the choice, not just the page
        applied: (next) => (nativeTheme.themeSource = next.appearance),
      }),
      ...createOutlineApi({ planner, thumbnail }),
      ...createClaudeCodeApi({ claudeCode }),
      ...createTimelineApi({ timeline }),
      ...createHighlightApi({ highlights, flair, emphasis, post }),
      ...createAgentApi({ agent, wiring: agentWiring, timeline, previews }),
      ...(license ? createLicenseApi({ license }) : noLicenseApi()),
      cancelAi: async () => aiCalls.cancel(),
      updateState: async () => updater.state(),
      installUpdate: async () => updater.install(),
    }
  const api: DesktopApi = license ? gateApi(all, () => license.assertLicensed()) : all

  for (const method of API_METHODS) {
    ipcMain.handle(`api:${method}`, (_event, ...args: unknown[]) =>
      (api[method] as (...params: unknown[]) => Promise<unknown>)(...args),
    )
  }

  if (license) {
    void (async () => {
      // development only: activate from BOXBLACK_DEV_LICENSE_KEY so a test key never has to be typed
      const devKey = app.isPackaged ? undefined : process.env.BOXBLACK_DEV_LICENSE_KEY
      if (devKey && (await license.state()).state !== "active") await license.activate(devKey)
      await license.refreshIfDue()
    })().catch((error: unknown) => console.error("license check failed", error))
  }
  const licenseTimer = license ? setInterval(() => void license.refreshIfDue().catch(() => {}), LICENSE_CHECK_MS) : undefined
  void updater.start().catch((error: unknown) => console.error("updater failed to start", error))
  const updateTimer = setInterval(() => void updater.check(), UPDATE_CHECK_MS)

  // a running whisper-cli, download, installer or sign-in must not outlive the app
  app.on("before-quit", () => {
    clearInterval(licenseTimer)
    clearInterval(updateTimer)
    analysis.cancel()
    planner.cancel()
    analysis.cancelModelDownload()
    graphicsPack.cancel()
    graphicsRenderer.cancel()
    void claudeCode.cancel()
    aiCalls.cancel()
    // the renders are cancelled before the page closes, so that the render the close ends is no sound's failure; a
    // composing waiting on its check is ended by its run's stop, which relies on aiCalls.cancel() above running first
    soundRenderer.cancel()
    soundPage.close()
    drawPage.close()
  })

  // the stored choice applies as soon as it has been read; the window is already painting by then
  void settings.read().then((stored) => (nativeTheme.themeSource = stored.appearance))

  createWindow()
  app.on("activate", () => {
    if (mainWindow === null || mainWindow.isDestroyed()) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
