import { expect, test } from "vitest"
import { DEFAULT_HIGHLIGHT_OPTIONS } from "@boxblack/core/highlights/styles"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WHISPER_MODELS } from "@boxblack/core/asr"
import { CUT_PRESETS } from "@boxblack/core/cut/rules"
import type { ToolReport } from "@boxblack/core/media"
import type { GraphicCleanResult, GraphicsProblem } from "../shared/api.ts"
import type { AnalysisService } from "./analysis.ts"
import type { GraphicsPack } from "./graphics-pack.ts"
import { SecretStore, SettingsStore, type SecretBox } from "./settings.ts"
import { createSettingsApi } from "./settings-api.ts"

const box: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain),
  decryptString: (cipher) => cipher.toString(),
}

async function setup(extra: {
  sounds?: { failedCount(): Promise<number>; retry(): Promise<void> }
  graphicsPack?: Pick<GraphicsPack, "state" | "install" | "cancel" | "remove">
  graphicFiles?: { info(): Promise<{ count: number; bytes: number }>; clean(): Promise<GraphicCleanResult> }
  graphicsProblem?: () => GraphicsProblem | null
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-settings-api-"))
  const calls: unknown[][] = []
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
    }
  const analysis = {
    readiness: async () => ({ problems: ["model-missing"] }),
    modelInfo: async () => ({ model: WHISPER_MODELS[0]!, state: { status: "partial", bytes: 10 }, downloading: true }),
    claudeCliFound: () => true,
    start: record("start"),
    cancel: () => calls.push(["cancel"]),
    state: () => null,
    analysed: async (folder: string) => (folder === "/drafts/0917" ? ["a", "b"] : []),
    retakes: async (folder: string) => (folder === "/drafts/0917" ? { a: { reviews: 2, frames: 14 } } : {}),
    downloadModel: record("downloadModel"),
    cancelModelDownload: () => calls.push(["cancelModelDownload"]),
  } as unknown as AnalysisService
  const settings = new SettingsStore(join(dir, "settings.json"))
  const secrets = new SecretStore(join(dir, "secrets.json"), box)
  const cutPresets = { ...CUT_PRESETS, tight: { maxPauseUs: 250_000, paddingUs: 60_000 } }
  const tools: ToolReport = { ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: "8.1.2", missing: [] }, ffprobe: { path: "/opt/homebrew/bin/ffprobe" }, whisper: null, claude: null }
  const toolbox = { report: async () => tools, rescan: async () => void calls.push(["rescan"]) }
  const applied: string[] = []
  const api = createSettingsApi({
    settings, secrets, analysis, cutPresets: async () => cutPresets, toolbox, appVersion: "0.1.0", applied: (next) => applied.push(next.appearance),
    ...(extra.sounds ? { sounds: extra.sounds } : {}),
    ...(extra.graphicsPack ? { graphicsPack: extra.graphicsPack } : {}),
    ...(extra.graphicFiles ? { graphicFiles: extra.graphicFiles } : {}),
    ...(extra.graphicsProblem ? { graphicsProblem: extra.graphicsProblem } : {}),
  })
  return { api, settings, secrets, calls, applied }
}

test("getSettings gathers choices, key hints, the model download, Claude Code and readiness", async () => {
  const { api } = await setup()
  expect(await api.getSettings()).toEqual({
    asr: { engine: "whisper-local", language: "th" },
    llm: { transport: "anthropic-api", model: "claude-opus-5", effort: "medium" },
    cut: { preset: "normal", cutFillers: true, cutRetakes: true, cutBadPicture: true },
    subtitles: { enabled: false, length: "line", polish: false },
    highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
    flair: { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false },
    vision: { frameEveryS: 3 },
    appearance: "system",
    capcut: { pro: false },
    unfetchableSounds: 0,
    cutPresets: { ...CUT_PRESETS, tight: { maxPauseUs: 250_000, paddingUs: 60_000 } },
    tools: { ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: "8.1.2", missing: [] }, ffprobe: { path: "/opt/homebrew/bin/ffprobe" }, whisper: null, claude: null },
    appVersion: "0.1.0",
    keyHints: { elevenlabs: null, anthropic: null },
    model: { label: "Whisper large-v3 (q5_0)", sizeBytes: 1_081_140_203, state: { status: "partial", bytes: 10 }, downloading: true },
    graphicsPack: { state: "missing" },
    graphicsProblem: null,
    graphicFiles: { count: 0, bytes: 0 },
    claudeCliFound: true,
    readiness: { problems: ["model-missing"] },
  })
})

test("saveApiKey stores the trimmed key and only its last four characters come back", async () => {
  const { api, secrets } = await setup()
  await api.saveApiKey("anthropic", "  sk-ant-abcd1234 \n")
  expect(await secrets.get("anthropic")).toBe("sk-ant-abcd1234")
  expect((await api.getSettings()).keyHints).toEqual({ elevenlabs: null, anthropic: "1234" })
})

test("saveApiKey rejects an empty key", async () => {
  const { api } = await setup()
  await expect(api.saveApiKey("elevenlabs", "   ")).rejects.toThrow(/empty/)
})

test("saveApiKey only accepts the keys the app knows", async () => {
  const { api } = await setup()
  await expect(api.saveApiKey("openai" as "anthropic", "sk")).rejects.toThrow(/unknown key/)
})

test("deleteApiKey removes the stored key", async () => {
  const { api, secrets } = await setup()
  await api.saveApiKey("elevenlabs", "sk_abcd1234")
  await api.deleteApiKey("elevenlabs")
  expect(await secrets.get("elevenlabs")).toBeNull()
})

test("updateSettings saves transcription, Claude, cut and subtitle choices", async () => {
  const { api, settings } = await setup()
  await api.updateSettings({
    asr: { engine: "scribe" },
    llm: { transport: "claude-cli", model: "claude-sonnet-5", effort: "high" },
    cut: { preset: "loose" },
    subtitles: { enabled: true, polish: true },
    highlights: { enabled: true, position: "middle" },
    flair: { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: true },
  })
  expect(await settings.read()).toEqual({
    asr: { engine: "scribe", language: "th" },
    llm: { transport: "claude-cli", model: "claude-sonnet-5", effort: "high" },
    cut: { preset: "loose", cutFillers: true, cutRetakes: true, cutBadPicture: true },
    subtitles: { enabled: true, length: "line", polish: true },
    highlights: { enabled: true, position: "middle", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
    flair: { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: true },
    vision: { frameEveryS: 3 },
    appearance: "system",
    capcut: { pro: false },
  })
})

test("analysis and model download requests go to the analysis service", async () => {
  const { api, calls } = await setup()
  await api.startAnalysis("/drafts/p", ["a"])
  await api.cancelAnalysis()
  await api.downloadModel()
  await api.cancelModelDownload()
  expect(calls).toEqual([["start", "/drafts/p", ["a"]], ["cancel"], ["downloadModel"], ["cancelModelDownload"]])
  expect(await api.analysisState()).toBeNull()
})

test("looking for tools again rescans this machine", async () => {
  const { api, calls } = await setup()
  await api.rescanTools()
  expect(calls).toEqual([["rescan"]])
})

test("a settings change is handed to the app, so the window can follow the appearance", async () => {
  const { api, applied } = await setup()
  await api.updateSettings({ appearance: "dark" })
  expect(applied).toEqual(["dark"])
  await api.updateSettings({ subtitles: { enabled: true } })
  expect(applied).toEqual(["dark", "dark"])
})

test("analysedVideos passes the question straight to the analysis service", async () => {
  const { api } = await setup()
  expect(await api.analysedVideos("/drafts/0917")).toEqual(["a", "b"])
  expect(await api.analysedVideos("/drafts/0815")).toEqual([])
})

test("knownRetakes passes the question straight to the analysis service", async () => {
  const { api } = await setup()
  expect(await api.knownRetakes("/drafts/0917")).toEqual({ a: { reviews: 2, frames: 14 } })
  expect(await api.knownRetakes("/drafts/0815")).toEqual({})
})

test("the sounds CapCut could not fetch are counted in the settings, and can be tried again", async () => {
  let failed = 3
  const tried: string[] = []
  const { api } = await setup({ sounds: { failedCount: async () => failed, retry: async () => void (tried.push("retry"), (failed = 0)) } })
  expect((await api.getSettings()).unfetchableSounds).toBe(3)
  await api.retryUnfetchableSounds()
  expect(tried).toEqual(["retry"])
  expect((await api.getSettings()).unfetchableSounds).toBe(0)
})

/* the graphics renderer pack */

test("getSettings carries the graphics pack's state and the graphic files count from their fakes", async () => {
  const graphicsPack = {
    state: async () => ({ state: "downloading" as const, received: 40, total: 100 }),
    install: async () => {},
    cancel: () => {},
    remove: async () => {},
  }
  const graphicFiles = { info: async () => ({ count: 4, bytes: 12_000 }), clean: async () => ({ trashed: 0, blockedBy: null, kept: null }) }
  const { api } = await setup({ graphicsPack, graphicFiles })
  const view = await api.getSettings()
  expect(view.graphicsPack).toEqual({ state: "downloading", received: 40, total: 100 })
  expect(view.graphicFiles).toEqual({ count: 4, bytes: 12_000 })
})

test("getSettings says why graphics cannot render on this machine, as a render last found it, so an installed pack is not taken for a working one", async () => {
  let problem: GraphicsProblem | null = { text: "the graphics renderer is damaged: reinstall it in settings (chrome-headless-shell is missing)" }
  const { api } = await setup({ graphicsProblem: () => problem })
  expect((await api.getSettings()).graphicsProblem).toEqual({ text: "the graphics renderer is damaged: reinstall it in settings (chrome-headless-shell is missing)" })
  // read each time it is asked: another fault found since is the one said
  problem = { text: "the app's ffmpeg is missing" }
  expect((await api.getSettings()).graphicsProblem).toEqual({ text: "the app's ffmpeg is missing" })
  problem = null
  expect((await api.getSettings()).graphicsProblem).toBeNull()
})

test("installGraphicsPack, cancelGraphicsPack and removeGraphicsPack reach the graphics pack", async () => {
  const calls: string[] = []
  const graphicsPack = {
    state: async () => ({ state: "missing" as const }),
    install: async () => void calls.push("install"),
    cancel: () => calls.push("cancel"),
    remove: async () => void calls.push("remove"),
  }
  const { api } = await setup({ graphicsPack })
  await api.installGraphicsPack()
  await api.cancelGraphicsPack()
  await api.removeGraphicsPack()
  expect(calls).toEqual(["install", "cancel", "remove"])
})

test("installGraphicsPack refuses when this build has no graphics renderer to install", async () => {
  const { api } = await setup()
  await expect(api.installGraphicsPack()).rejects.toThrow(/not available/)
  // cancel and remove are no-ops without a pack, not errors: nothing to cancel or remove
  await expect(api.cancelGraphicsPack()).resolves.toBeUndefined()
  await expect(api.removeGraphicsPack()).resolves.toBeUndefined()
})

test("installGraphicsPack returns at once; it does not wait for the install to settle", async () => {
  let settled = false
  const graphicsPack = {
    state: async () => ({ state: "missing" as const }),
    install: () => new Promise<void>((resolve) => setTimeout(() => { settled = true; resolve() }, 50)),
    cancel: () => {},
    remove: async () => {},
  }
  const { api } = await setup({ graphicsPack })
  await api.installGraphicsPack()
  // if installGraphicsPack awaited the whole install, this would already be true
  expect(settled).toBe(false)
})

test("installGraphicsPack never rejects on the install's own failure or cancellation — the events say how it ended", async () => {
  const graphicsPack = {
    state: async () => ({ state: "missing" as const }),
    install: async () => {
      throw new Error("cancelled")
    },
    cancel: () => {},
    remove: async () => {},
  }
  const { api } = await setup({ graphicsPack })
  await expect(api.installGraphicsPack()).resolves.toBeUndefined()
})

test("installGraphicsPack refuses while the pack is already downloading or installing", async () => {
  const calls: string[] = []
  const busy = (state: "downloading" | "installing") => ({
    state: async () => (state === "downloading" ? { state, received: 1, total: 2 } : { state }),
    install: async () => void calls.push("install"),
    cancel: () => {},
    remove: async () => {},
  })
  const { api: downloadingApi } = await setup({ graphicsPack: busy("downloading") })
  await expect(downloadingApi.installGraphicsPack()).rejects.toThrow(/already/)
  const { api: installingApi } = await setup({ graphicsPack: busy("installing") })
  await expect(installingApi.installGraphicsPack()).rejects.toThrow(/already/)
  expect(calls).toEqual([])
})

test("cleaning the graphic files says how many went to the Trash, or which draft stopped it", async () => {
  const answers: GraphicCleanResult[] = [
    { trashed: 3, blockedBy: null, kept: "recent" },
    { trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "0917" }, kept: null },
  ]
  let cleaned = 0
  const { api } = await setup({ graphicFiles: { info: async () => ({ count: 3, bytes: 900 }), clean: async () => answers[cleaned++]! } })
  expect(await api.cleanGraphicFiles()).toEqual({ trashed: 3, blockedBy: null, kept: "recent" })
  expect(await api.cleanGraphicFiles()).toEqual({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "0917" }, kept: null })

  // a build with no graphics has nothing to clean
  const { api: without } = await setup()
  expect(await without.cleanGraphicFiles()).toEqual({ trashed: 0, blockedBy: null, kept: null })
})
