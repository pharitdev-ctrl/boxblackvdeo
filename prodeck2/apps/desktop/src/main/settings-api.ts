import type { CutPreset, CutPresetId } from "@boxblack/core/cut/rules"
import type { ApiKeyName, DesktopApi, GraphicCleanResult, GraphicsProblem } from "../shared/api.ts"
import type { AnalysisService } from "./analysis.ts"
import type { GraphicsPack } from "./graphics-pack.ts"
import type { SoundLibrary } from "./sound-library.ts"
import type { Toolbox } from "./tools.ts"
import type { AppSettings, SecretStore, SettingsStore } from "./settings.ts"

type SettingsApi = Pick<
  DesktopApi,
  | "getSettings"
  | "updateSettings"
  | "saveApiKey"
  | "deleteApiKey"
  | "downloadModel"
  | "cancelModelDownload"
  | "installGraphicsPack"
  | "cancelGraphicsPack"
  | "removeGraphicsPack"
  | "cleanGraphicFiles"
  | "rescanTools"
  | "startAnalysis"
  | "cancelAnalysis"
  | "analysisState"
  | "analysedVideos"
  | "knownRetakes"
  | "videosWithoutObjects"
  | "locateObjects"
  | "retryUnfetchableSounds"
>

const KEY_NAMES: ApiKeyName[] = ["elevenlabs", "anthropic"]

function knownKey(name: ApiKeyName): ApiKeyName {
  if (!KEY_NAMES.includes(name)) throw new Error(`unknown key "${name}"`)
  return name
}

export function createSettingsApi(deps: {
  settings: SettingsStore
  secrets: SecretStore
  analysis: AnalysisService
  cutPresets: () => Promise<Record<CutPresetId, CutPreset>>
  toolbox: Pick<Toolbox, "report" | "rescan">
  appVersion: string
  /** told the settings after every change, so the app can follow them (the window's appearance) */
  applied?: (settings: AppSettings) => void
  /** the sounds CapCut could not fetch, which the user may have tried again */
  sounds?: Pick<SoundLibrary, "failedCount" | "retry">
  /** installs, removes and reports on the renderer pack graphics overlays need */
  graphicsPack?: Pick<GraphicsPack, "state" | "install" | "cancel" | "remove">
  /** the rendered graphics kept on disk: how many and how large, and trashing the ones no draft refers to */
  graphicFiles?: { info(): Promise<{ count: number; bytes: number }>; clean(): Promise<GraphicCleanResult> }
  /** why graphics cannot render on this machine, as a render last found it (the renderer's `environmentProblem`), or null */
  graphicsProblem?: () => GraphicsProblem | null
}): SettingsApi {
  const { settings, secrets, analysis } = deps
  return {
    async getSettings() {
      const [current, elevenlabs, anthropic, info, readiness, cutPresets, tools, unfetchableSounds, graphicsPack, graphicFiles] = await Promise.all([
        settings.read(),
        secrets.hint("elevenlabs"),
        secrets.hint("anthropic"),
        analysis.modelInfo(),
        analysis.readiness(),
        deps.cutPresets(),
        deps.toolbox.report(),
        deps.sounds ? deps.sounds.failedCount() : 0,
        deps.graphicsPack ? deps.graphicsPack.state() : { state: "missing" as const },
        deps.graphicFiles ? deps.graphicFiles.info() : { count: 0, bytes: 0 },
      ])
      return {
        ...current,
        unfetchableSounds,
        cutPresets,
        tools,
        appVersion: deps.appVersion,
        keyHints: { elevenlabs, anthropic },
        model: { label: info.model.label, sizeBytes: info.model.sizeBytes, state: info.state, downloading: info.downloading },
        graphicsPack,
        graphicsProblem: deps.graphicsProblem?.() ?? null,
        graphicFiles,
        claudeCliFound: analysis.claudeCliFound(),
        readiness,
      }
    },
    async updateSettings(patch) {
      deps.applied?.(await settings.update(patch))
    },
    async saveApiKey(name, key) {
      const trimmed = key.trim()
      if (!trimmed) throw new Error("the API key is empty")
      await secrets.set(knownKey(name), trimmed)
    },
    async deleteApiKey(name) {
      await secrets.delete(knownKey(name))
    },
    downloadModel: () => analysis.downloadModel(),
    async cancelModelDownload() {
      analysis.cancelModelDownload()
    },
    async installGraphicsPack() {
      if (!deps.graphicsPack) throw new Error("the graphics renderer is not available in this build")
      const state = await deps.graphicsPack.state()
      if (state.state === "downloading" || state.state === "installing") throw new Error("the graphics renderer is already downloading")
      // returns at once, before the install finishes: the graphics-pack events (progress/installing/
      // done/cancelled/failed) carry the whole story from here. A rejection here would just be the
      // install failing or being cancelled, which those events already say — never let it surface
      // as this call's own error
      void deps.graphicsPack.install().catch(() => {})
    },
    async cancelGraphicsPack() {
      deps.graphicsPack?.cancel()
    },
    async removeGraphicsPack() {
      await deps.graphicsPack?.remove()
    },
    async cleanGraphicFiles() {
      return deps.graphicFiles ? deps.graphicFiles.clean() : { trashed: 0, blockedBy: null, kept: null }
    },
    rescanTools: () => deps.toolbox.rescan(),
    startAnalysis: (folder, videoIds) => analysis.start(folder, videoIds),
    async cancelAnalysis() {
      analysis.cancel()
    },
    async analysisState() {
      return analysis.state()
    },
    async analysedVideos(folder) {
      return analysis.analysed(folder)
    },
    async knownRetakes(folder) {
      return analysis.retakes(folder)
    },
    async videosWithoutObjects(folder) {
      return analysis.withoutObjects(folder)
    },
    async locateObjects(folder, videoIds) {
      await analysis.locateObjects(folder, videoIds)
    },
    async retryUnfetchableSounds() {
      await deps.sounds?.retry()
    },
  }
}
