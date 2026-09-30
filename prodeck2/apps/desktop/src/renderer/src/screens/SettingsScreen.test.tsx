import { PINNED_WHISPER_VERSION, WHISPER_TAP_FORMULA } from "../../../shared/whisper-tap.ts"
import { afterEach, expect, test } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { ClaudeCodeStatus, GraphicCleanResult, RendererApi, SettingsView } from "../../../shared/api.ts"
import { GRAPHICS_PACK } from "../../../shared/graphics-pack.ts"
import { activeLicense, claudeCodeStatus, fakeApi, LICENSE_EXPIRES_AT, settingsView } from "../../test/fake-api.ts"
import { formatBytes, formatDate } from "../format.ts"
import { t } from "../i18n.ts"
import { SettingsScreen } from "./SettingsScreen.tsx"

afterEach(cleanup)

const missingModel = (extra: Partial<SettingsView> = {}) =>
  settingsView({
    model: { label: "Whisper large-v3 (q5_0)", sizeBytes: 1_081_140_203, state: { status: "missing" }, downloading: false },
    readiness: { problems: ["model-missing"] },
    ...extra,
  })

const scribe = (extra: Partial<SettingsView> = {}) => settingsView({ asr: { engine: "scribe", language: "th" }, ...extra })

function renderWith(views: SettingsView[], overrides: Partial<RendererApi> = {}) {
  let index = 0
  const api = fakeApi({ getSettings: async () => views[Math.min(index++, views.length - 1)]!, ...overrides })
  render(<SettingsScreen api={api} onAppearance={() => {}} />)
  return api
}

type Tab = "general" | "asr" | "llm" | "license"
const tabOf = (tab: Tab) => screen.findByRole("tab", { name: new RegExp(t(`settings.tab.${tab}`)) })
const open = async (tab: Tab) => userEvent.click(await tabOf(tab))
const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent

const asrSection = () => screen.getByRole("region", { name: t("settings.asrTitle") })
const llmSection = () => screen.getByRole("region", { name: t("settings.llmTitle") })

/* the tabs */

test("settings that cannot be read say why instead of showing nothing", async () => {
  render(
    <SettingsScreen
      api={fakeApi({
        getSettings: async () => {
          throw new Error("settings.json is damaged")
        },
      })}
      onAppearance={() => {}}
    />,
  )
  expect(await screen.findByText(t("error.generic", { message: "settings.json is damaged" }))).toBeTruthy()
})

test("opens on the first tab, with the others a click away", async () => {
  renderWith([settingsView()])
  await tabOf("general")
  expect(selectedTab()).toBe(t("settings.tab.general"))
  expect(screen.getByRole("radiogroup", { name: t("settings.appearance") })).toBeTruthy()
  expect(screen.queryByRole("region", { name: t("settings.asrTitle") })).toBeNull()

  await open("asr")
  expect(asrSection()).toBeTruthy()
  expect(screen.queryByRole("radiogroup", { name: t("settings.appearance") })).toBeNull()
})

test("opens on the first tab with something to fix, and marks every tab that has one", async () => {
  renderWith([settingsView({ readiness: { problems: ["scribe-key-missing", "anthropic-key-missing"] } })])
  await tabOf("asr")
  expect(selectedTab()).toContain(t("settings.tab.asr"))
  const flagged = screen.getAllByRole("tab", { name: new RegExp(t("settings.needsFixing")) }).map((tab) => tab.textContent)
  expect(flagged).toEqual([expect.stringContaining(t("settings.tab.asr")), expect.stringContaining(t("settings.tab.llm"))])
})

test("a tool problem belongs to the general tab, where the tools are", async () => {
  renderWith([settingsView({ readiness: { problems: ["whisper-missing"] } })])
  await tabOf("general")
  expect(selectedTab()).toContain(t("settings.tab.general"))
  expect(screen.getByText(t("problem.whisper-missing"))).toBeTruthy()
})

/* transcription */

test("offers to download the local model and shows its size", async () => {
  const api = renderWith([missingModel()])
  expect(await screen.findByText(t("settings.modelMissing", { size: "1.08 GB" }))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("settings.modelDownload") }))
  expect(api.calls).toContainEqual(["downloadModel"])
})

test("offers to resume a download that stopped part way", async () => {
  renderWith([
    missingModel({ model: { label: "m", sizeBytes: 1_081_140_203, state: { status: "partial", bytes: 432_000_000 }, downloading: false } }),
  ])
  expect(await screen.findByText(t("settings.modelPartial", { done: "432 MB", size: "1.08 GB" }))).toBeTruthy()
  expect(screen.getByRole("button", { name: t("settings.modelResume") })).toBeTruthy()
})

test("shows download progress as it arrives and can cancel it", async () => {
  const api = renderWith([missingModel()])
  await userEvent.click(await screen.findByRole("button", { name: t("settings.modelDownload") }))
  act(() => api.emit({ type: "model-download", state: "progress", received: 540_570_101, total: 1_081_140_203 }))
  expect(await screen.findByText(t("settings.modelDownloading", { percent: 50, done: "541 MB", size: "1.08 GB" }))).toBeTruthy()
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50")
  await userEvent.click(screen.getByRole("button", { name: t("settings.modelCancel") }))
  expect(api.calls).toContainEqual(["cancelModelDownload"])
})

test("shows the model as ready once the download finishes", async () => {
  const api = renderWith([missingModel(), settingsView()])
  await screen.findByText(t("settings.modelMissing", { size: "1.08 GB" }))
  act(() => api.emit({ type: "model-download", state: "done" }))
  expect(await screen.findByText(t("settings.modelReady"))).toBeTruthy()
})

test("reports a failed download", async () => {
  const api = renderWith([missingModel()])
  await screen.findByText(t("settings.modelMissing", { size: "1.08 GB" }))
  act(() => api.emit({ type: "model-download", state: "failed", error: "checksum" }))
  expect(await screen.findByText(t("settings.modelFailed", { message: "checksum" }))).toBeTruthy()
})

test("switching to ElevenLabs saves the choice and asks for its key", async () => {
  const api = renderWith([settingsView(), scribe({ readiness: { problems: ["scribe-key-missing"] } })])
  await open("asr")
  await userEvent.click(await screen.findByRole("radio", { name: new RegExp(t("settings.engineScribe")) }))
  expect(api.calls).toContainEqual(["updateSettings", { asr: { engine: "scribe" } }])
  expect(await screen.findByLabelText(t("settings.scribeKeyLabel"))).toBeTruthy()
})

test("saving a key sends it once and then only shows its last four characters", async () => {
  const api = renderWith([scribe(), scribe({ keyHints: { elevenlabs: "1234", anthropic: "9876" } })])
  await open("asr")
  await userEvent.type(await screen.findByLabelText(t("settings.scribeKeyLabel")), "sk_abcd1234")
  await userEvent.click(within(asrSection()).getByRole("button", { name: t("settings.keySave") }))
  expect(api.calls).toContainEqual(["saveApiKey", "elevenlabs", "sk_abcd1234"])
  expect(await within(asrSection()).findByText(t("settings.keySaved", { hint: "1234" }))).toBeTruthy()
  expect(screen.queryByDisplayValue("sk_abcd1234")).toBeNull()
})

test("a saved ElevenLabs key can be removed", async () => {
  const api = renderWith([scribe({ keyHints: { elevenlabs: "1234", anthropic: null } })])
  await open("asr")
  await userEvent.click(await within(asrSection()).findByRole("button", { name: t("settings.keyDelete") }))
  expect(api.calls).toContainEqual(["deleteApiKey", "elevenlabs"])
})

test("changing the spoken language saves it", async () => {
  const api = renderWith([settingsView()])
  await open("asr")
  await userEvent.selectOptions(await screen.findByLabelText(t("settings.language")), "en")
  await waitFor(() => expect(api.calls).toContainEqual(["updateSettings", { asr: { language: "en" } }]))
})

/* Claude */

test("the Anthropic API key is saved under its own name", async () => {
  const api = renderWith([settingsView({ keyHints: { elevenlabs: null, anthropic: null } })])
  await open("llm")
  await userEvent.type(await screen.findByLabelText(t("settings.anthropicKeyLabel")), "sk-ant-xyz")
  await userEvent.click(within(llmSection()).getByRole("button", { name: t("settings.keySave") }))
  expect(api.calls).toContainEqual(["saveApiKey", "anthropic", "sk-ant-xyz"])
})

test("a saved Anthropic key shows its last four characters and can be removed", async () => {
  const api = renderWith([settingsView()])
  await open("llm")
  const section = llmSection()
  expect(within(section).getByText(t("settings.keySaved", { hint: "9876" }))).toBeTruthy()
  await userEvent.click(within(section).getByRole("button", { name: t("settings.keyDelete") }))
  expect(api.calls).toContainEqual(["deleteApiKey", "anthropic"])
})

test("choosing Claude Code on this computer saves the choice and warns about Anthropic's terms", async () => {
  const api = renderWith([settingsView(), settingsView({ llm: { transport: "claude-cli", model: "claude-opus-5", effort: "medium" } })])
  await open("llm")
  await userEvent.click(await screen.findByRole("radio", { name: new RegExp(t("settings.transportCli")) }))
  expect(api.calls).toContainEqual(["updateSettings", { llm: { transport: "claude-cli" } }])
  expect(await screen.findByText(t("settings.transportCliWarning"))).toBeTruthy()
})

test("says so when Claude Code is chosen but not installed", async () => {
  renderWith([settingsView({ llm: { transport: "claude-cli", model: "claude-opus-5", effort: "medium" }, claudeCliFound: false, readiness: { problems: ["claude-cli-missing"] } })])
  expect(await screen.findByText(t("problem.claude-cli-missing"))).toBeTruthy()
  expect(selectedTab()).toContain(t("settings.tab.llm"))
})

test("the Claude model can be changed, Opus 5.5 among them", async () => {
  const api = renderWith([settingsView()])
  await open("llm")
  const select = await screen.findByLabelText(t("settings.llmModel"))
  expect([...(select as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Claude Opus 5.5", "Claude Opus 5", "Claude Sonnet 5"])
  await userEvent.selectOptions(select, "claude-sonnet-5")
  await waitFor(() => expect(api.calls).toContainEqual(["updateSettings", { llm: { model: "claude-sonnet-5" } }]))
  await userEvent.selectOptions(select, "claude-opus-5-5")
  await waitFor(() => expect(api.calls).toContainEqual(["updateSettings", { llm: { model: "claude-opus-5-5" } }]))
})

test("with Opus 5.5 chosen, how hard it thinks can be set; the other models keep their own level and show no choice", async () => {
  const opus = settingsView({ llm: { transport: "anthropic-api", model: "claude-opus-5-5", effort: "medium" } })
  const api = renderWith([opus, { ...opus, llm: { ...opus.llm, effort: "high" } }])
  await open("llm")
  const group = await screen.findByRole("radiogroup", { name: t("settings.llmEffort") })
  expect(within(group).getAllByRole("radio").map((radio) => radio.closest("label")!.textContent)).toEqual([
    t("settings.effort.low"),
    t("settings.effort.medium"),
    t("settings.effort.high"),
  ])
  expect(within(group).getByRole("radio", { name: t("settings.effort.medium") })).toHaveProperty("checked", true)
  await userEvent.click(within(group).getByRole("radio", { name: t("settings.effort.high") }))
  await waitFor(() => expect(api.calls).toContainEqual(["updateSettings", { llm: { effort: "high" } }]))
  expect(await within(group).findByRole("radio", { name: t("settings.effort.high") })).toHaveProperty("checked", true)
  cleanup()

  renderWith([settingsView()])
  await open("llm")
  await screen.findByLabelText(t("settings.llmModel"))
  expect(screen.queryByRole("radiogroup", { name: t("settings.llmEffort") })).toBeNull()
})

test("sounds CapCut could not fetch are counted, and can be tried again; with none, nothing is shown", async () => {
  const api = renderWith([settingsView({ unfetchableSounds: 2 }), settingsView({ unfetchableSounds: 0 })])
  const retry = await screen.findByRole("button", { name: t("settings.soundsRetry") })
  expect(screen.getByText(t("settings.soundsUnfetchable", { count: 2 }))).toBeTruthy()
  await userEvent.click(retry)
  expect(api.calls).toContainEqual(["retryUnfetchableSounds"])
  await waitFor(() => expect(screen.queryByRole("button", { name: t("settings.soundsRetry") })).toBeNull())
})

/* the graphics renderer pack */

test("offers to install the graphics renderer pack and shows its size", async () => {
  const api = renderWith([settingsView()])
  expect(await screen.findByText(t("settings.graphicsPackHint", { size: formatBytes(GRAPHICS_PACK.bytes) }))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("settings.graphicsPackInstall") }))
  expect(api.calls).toContainEqual(["installGraphicsPack"])
})

test("shows the graphics pack's download progress as it arrives, and can cancel it", async () => {
  const api = renderWith([settingsView()])
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicsPackInstall") }))
  const size = formatBytes(GRAPHICS_PACK.bytes)
  const percent = Math.round((81_294_115 / GRAPHICS_PACK.bytes) * 100)
  act(() => api.emit({ type: "graphics-pack", state: "progress", received: 81_294_115, total: GRAPHICS_PACK.bytes }))
  expect(await screen.findByText(t("settings.graphicsPackDownloading", { percent, done: formatBytes(81_294_115), size }))).toBeTruthy()
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(String(percent))
  await userEvent.click(screen.getByRole("button", { name: t("settings.graphicsPackCancel") }))
  expect(api.calls).toContainEqual(["cancelGraphicsPack"])
})

test("shows the graphics pack as installed once the download finishes", async () => {
  const api = renderWith([settingsView(), settingsView({ graphicsPack: { state: "installed", version: GRAPHICS_PACK.version } })])
  await screen.findByRole("button", { name: t("settings.graphicsPackInstall") })
  act(() => api.emit({ type: "graphics-pack", state: "done" }))
  expect(await screen.findByText(t("settings.graphicsPackInstalled", { version: GRAPHICS_PACK.version }))).toBeTruthy()
})

test("an installed renderer pack that a render found unusable says why on its row, and how to put it right", async () => {
  const problem = "the graphics renderer is damaged: reinstall it in settings (chrome-headless-shell is missing)"
  renderWith([settingsView({ graphicsPack: { state: "installed", version: GRAPHICS_PACK.version }, graphicsProblem: { text: problem } })])
  expect(await screen.findByText(t("settings.graphicsPackProblem", { problem }))).toBeTruthy()
  expect(screen.getByText(t("settings.graphicsPackInstalled", { version: GRAPHICS_PACK.version }))).toBeTruthy()
  expect(screen.getByRole("button", { name: t("settings.graphicsPackRemove") })).toBeTruthy()
})

test("a problem a render found is not told while the pack is not installed: installing it is what the row offers", async () => {
  const problem = "the graphics renderer is damaged: reinstall it in settings (chrome-headless-shell is missing)"
  renderWith([settingsView({ graphicsPack: { state: "missing" }, graphicsProblem: { text: problem } })])
  expect(await screen.findByRole("button", { name: t("settings.graphicsPackInstall") })).toBeTruthy()
  expect(screen.queryByText(t("settings.graphicsPackProblem", { problem }))).toBeNull()
})

test("a renderer pack with nothing wrong found says nothing more than that it is installed", async () => {
  renderWith([settingsView({ graphicsPack: { state: "installed", version: GRAPHICS_PACK.version } })])
  await screen.findByText(t("settings.graphicsPackInstalled", { version: GRAPHICS_PACK.version }))
  expect(screen.queryByText(/เรนเดอร์กราฟิกไม่ได้/)).toBeNull()
})

test("reports a failed graphics pack install on the row only — not the generic error banner", async () => {
  const api = renderWith([settingsView()])
  await screen.findByRole("button", { name: t("settings.graphicsPackInstall") })
  act(() => api.emit({ type: "graphics-pack", state: "failed", error: "checksum" }))
  expect(await screen.findByText(t("settings.graphicsPackFailed", { message: "checksum" }))).toBeTruthy()
  expect(screen.queryByText(t("error.generic", { message: "checksum" }))).toBeNull()
  expect(document.querySelector(".notice.error")).toBeNull()
})

test("a cancelled install shows no generic error banner and returns the row to normal", async () => {
  const api = renderWith([settingsView()])
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicsPackInstall") }))
  act(() => api.emit({ type: "graphics-pack", state: "cancelled" }))
  await waitFor(() => expect(screen.getByRole("button", { name: t("settings.graphicsPackInstall") })).toBeTruthy())
  expect(document.querySelector(".notice.error")).toBeNull()
})

test("shows the indeterminate bar while unpacking, and it can still be cancelled", async () => {
  const api = renderWith([settingsView()])
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicsPackInstall") }))
  act(() => api.emit({ type: "graphics-pack", state: "installing" }))
  expect(await screen.findByText(t("settings.graphicsPackInstalling"))).toBeTruthy()
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false)
  await userEvent.click(screen.getByRole("button", { name: t("settings.graphicsPackCancel") }))
  expect(api.calls).toContainEqual(["cancelGraphicsPack"])
})

test("reopening settings mid-download shows progress and Cancel right away, with no events yet", async () => {
  renderWith([settingsView({ graphicsPack: { state: "downloading", received: 40_000_000, total: GRAPHICS_PACK.bytes } })])
  const percent = Math.round((40_000_000 / GRAPHICS_PACK.bytes) * 100)
  expect(await screen.findByText(t("settings.graphicsPackDownloading", { percent, done: formatBytes(40_000_000), size: formatBytes(GRAPHICS_PACK.bytes) }))).toBeTruthy()
  expect(screen.getByRole("button", { name: t("settings.graphicsPackCancel") })).toBeTruthy()
})

test("Remove calls removeGraphicsPack", async () => {
  const api = renderWith([settingsView({ graphicsPack: { state: "installed", version: GRAPHICS_PACK.version } })])
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicsPackRemove") }))
  expect(api.calls).toContainEqual(["removeGraphicsPack"])
})

test("clicking Install goes through installing to installed, without a stale 'downloading' flash when it finishes", async () => {
  const views = [
    settingsView(),
    settingsView({ graphicsPack: { state: "downloading", received: 0, total: GRAPHICS_PACK.bytes } }),
    settingsView({ graphicsPack: { state: "installed", version: GRAPHICS_PACK.version } }),
  ]
  let index = 0
  const api = fakeApi({ getSettings: async () => views[Math.min(index++, views.length - 1)]! })
  render(<SettingsScreen api={api} onAppearance={() => {}} />)
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicsPackInstall") }))
  act(() => api.emit({ type: "graphics-pack", state: "installing" }))
  await screen.findByText(t("settings.graphicsPackInstalling"))
  expect(screen.queryByText(/กำลังโหลด/)).toBeNull()
  act(() => api.emit({ type: "graphics-pack", state: "done" }))
  // right away — before any further refresh can resolve — the row must not fall back to "downloading"
  expect(screen.queryByText(/กำลังโหลด/)).toBeNull()
  expect(await screen.findByText(t("settings.graphicsPackInstalled", { version: GRAPHICS_PACK.version }))).toBeTruthy()
  expect(screen.queryByText(/กำลังโหลด/)).toBeNull()
})

test("a fast failure still ends showing the failure message and Install, even if the install's own stale refresh resolves later", async () => {
  let resolveRunRefresh!: () => void
  let calls = 0
  const api = fakeApi({
    getSettings: async () => {
      const call = calls++
      if (call === 1) {
        // run's own refresh: held open, and captures a stale "still downloading" snapshot from
        // before the failure — exactly what a slow IPC round trip could hand back late
        await new Promise<void>((resolve) => {
          resolveRunRefresh = resolve
        })
        return settingsView({ graphicsPack: { state: "downloading", received: 0, total: GRAPHICS_PACK.bytes } })
      }
      return settingsView()
    },
  })
  render(<SettingsScreen api={api} onAppearance={() => {}} />)
  const clicking = userEvent.click(await screen.findByRole("button", { name: t("settings.graphicsPackInstall") }))
  await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2))
  // the failed event "arrives" (its own push channel) before run's own refresh has resolved
  act(() => api.emit({ type: "graphics-pack", state: "failed", error: "offline" }))
  expect(await screen.findByText(t("settings.graphicsPackFailed", { message: "offline" }))).toBeTruthy()
  expect(screen.getByRole("button", { name: t("settings.graphicsPackInstall") })).toBeTruthy()
  // resolved inside act so the late answer has been handled before the checks below
  await act(async () => resolveRunRefresh())
  await clicking
  // run's late, stale "downloading" response must not undo what the failure already corrected
  expect(await screen.findByText(t("settings.graphicsPackFailed", { message: "offline" }))).toBeTruthy()
  expect(screen.getByRole("button", { name: t("settings.graphicsPackInstall") })).toBeTruthy()
  expect(screen.queryByText(/กำลังโหลด/)).toBeNull()
})

/* the rendered graphic files */

test("shows the rendered graphic files with their total size", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })])
  expect(await screen.findByText(t("settings.graphicFiles", { count: 3, size: formatBytes(40_000_000) }))).toBeTruthy()
})

test("the result is announced through a status region that stays empty until a clean has run", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })])
  await screen.findByText(t("settings.graphicFilesHint"))
  expect(screen.getByRole("status")).toHaveProperty("textContent", "")
})

test("with no graphic files, there is no row for them", async () => {
  renderWith([settingsView({ graphicFiles: { count: 0, bytes: 0 } })])
  await screen.findByText(t("settings.graphicsPackHint", { size: formatBytes(GRAPHICS_PACK.bytes) }))
  expect(screen.queryByText(t("settings.graphicFilesHint"))).toBeNull()
})

test("cleaning trashes the unused graphic files and says how many", async () => {
  const api = renderWith(
    [settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } }), settingsView({ graphicFiles: { count: 1, bytes: 10_000_000 } })],
    { cleanGraphicFiles: async () => ({ trashed: 2, blockedBy: null, kept: null }) },
  )
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(api.calls).toContainEqual(["cleanGraphicFiles"])
  expect(await screen.findByText(t("settings.graphicFilesCleaned", { count: 2 }))).toBeTruthy()
  expect(screen.getByRole("status")).toHaveProperty("className", "hint")
})

test("once cleaning empties the folder, the row and its result stay so the user sees what happened", async () => {
  const api = renderWith(
    [settingsView({ graphicFiles: { count: 2, bytes: 20_000_000 } }), settingsView({ graphicFiles: { count: 0, bytes: 0 } })],
    { cleanGraphicFiles: async () => ({ trashed: 2, blockedBy: null, kept: null }) },
  )
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesCleaned", { count: 2 }))).toBeTruthy()
  expect(api.calls).toContainEqual(["cleanGraphicFiles"])
  expect(screen.queryByRole("button", { name: t("settings.graphicFilesClean") })).toBeNull()
})

test("a CapCut project that cannot be read is named by itself, never by its full path", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "0917" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedDraft", { name: "0917" }))).toBeTruthy()
  expect(screen.queryByText(/Users\/ford/)).toBeNull()
})

test("a project in CapCut's recycle bin that cannot be read says so by its own name, without the recycle bin folder", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: ".recycle_bin/0917" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedRecycled", { name: "0917" }))).toBeTruthy()
  expect(screen.queryByText(/recycle_bin/)).toBeNull()
})

test("CapCut's recycle bin itself, when it cannot be read, says so", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: ".recycle_bin" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedRecycleBin"))).toBeTruthy()
})

test("CapCut's projects folder itself, when it cannot be read, says so", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedRoot"))).toBeTruthy()
})

test("a BOXBLACK backup that cannot be read is named by its own backup folder, not the draft copy inside it", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "unreadable", where: "backup", name: "0917-20260924-101500" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedBackup", { name: "0917-20260924-101500" }))).toBeTruthy()
})

test("BOXBLACK's own backups folder, when it cannot be read, says so", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "unreadable", where: "backup", name: "" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedBackups"))).toBeTruthy()
})

test("files left because they were just rendered are said to be, whether others moved or none did", async () => {
  const answers = [
    { trashed: 2, blockedBy: null, kept: "recent" as const },
    { trashed: 0, blockedBy: null, kept: "recent" as const },
  ]
  let cleaned = 0
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], { cleanGraphicFiles: async () => answers[cleaned++]! })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesCleanedRecent", { count: 2 }))).toBeTruthy()
  expect(screen.getByRole("status")).toHaveProperty("className", "hint")
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesNoneRecent"))).toBeTruthy()
  // the rest are not claimed to be in use: some were only too new to move
  expect(screen.queryByText(t("settings.graphicFilesNoneUnused"))).toBeNull()
})

test("a clean that stopped partway because a render or a write started says so, with how many moved", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 1, blockedBy: null, kept: "stopped" }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesStopped", { count: 1 }))).toBeTruthy()
  expect(screen.queryByText(t("settings.graphicFilesCleaned", { count: 1 }))).toBeNull()
})

test("a clean while graphics render or a draft is being written says to try again once they are done, and that nothing moved", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "busy" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedBusy"))).toBeTruthy()
  expect(screen.getByRole("status")).toHaveProperty("className", "error-text")
})

test("cleaning with nothing unused says so, without claiming any file moved", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: null, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesNoneUnused"))).toBeTruthy()
  expect(screen.queryByText(/ย้ายไปถังขยะ/)).toBeNull()
})

test("a blocked result shows only the blocked message, never the success line", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "no-drafts-root" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedNoRoot"))).toBeTruthy()
  expect(screen.queryByText(t("settings.graphicFilesNoneUnused"))).toBeNull()
  expect(screen.queryByText(/ย้ายไปถังขยะ/)).toBeNull()
  expect(screen.getByRole("status")).toHaveProperty("className", "error-text")
})

test("a fresh attempt clears the old result, so a failure after a success shows no stale success", async () => {
  let call = 0
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => {
      call++
      if (call === 1) return { trashed: 2, blockedBy: null, kept: null }
      throw new Error("offline")
    },
  })
  const button = await screen.findByRole("button", { name: t("settings.graphicFilesClean") })
  await userEvent.click(button)
  expect(await screen.findByText(t("settings.graphicFilesCleaned", { count: 2 }))).toBeTruthy()
  await userEvent.click(button)
  await waitFor(() => expect(screen.queryByText(t("settings.graphicFilesCleaned", { count: 2 }))).toBeNull())
})

test("with no CapCut projects folder found, cleaning says so", async () => {
  renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "no-drafts-root" }, kept: null }),
  })
  await userEvent.click(await screen.findByRole("button", { name: t("settings.graphicFilesClean") }))
  expect(await screen.findByText(t("settings.graphicFilesBlockedNoRoot"))).toBeTruthy()
})

test("the clean button disables while it runs, so a second click cannot start another", async () => {
  let resolveClean!: (value: GraphicCleanResult) => void
  const api = renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: () =>
      new Promise((resolve) => {
        resolveClean = resolve
      }),
  })
  const button = await screen.findByRole("button", { name: t("settings.graphicFilesClean") })
  await userEvent.click(button)
  expect(button).toHaveProperty("disabled", true)
  await act(async () => resolveClean({ trashed: 1, blockedBy: null, kept: null }))
  expect(api.calls.filter(([name]) => name === "cleanGraphicFiles")).toHaveLength(1)
})

test("after a blocked clean the button re-enables, so it can be tried again", async () => {
  const api = renderWith([settingsView({ graphicFiles: { count: 3, bytes: 40_000_000 } })], {
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: { kind: "no-drafts-root" }, kept: null }),
  })
  const button = await screen.findByRole("button", { name: t("settings.graphicFilesClean") })
  await userEvent.click(button)
  await screen.findByText(t("settings.graphicFilesBlockedNoRoot"))
  expect(button).toHaveProperty("disabled", false)
  await userEvent.click(button)
  expect(api.calls.filter(([name]) => name === "cleanGraphicFiles")).toHaveLength(2)
})

/* license */

const licenseSection = () => screen.getByRole("region", { name: t("license.title") })

test("shows whose license this is, when it ends and how many machines use it", async () => {
  renderWith([settingsView()])
  await open("license")
  const card = licenseSection()
  expect(within(card).getByText("ร้านเล็บสวย")).toBeTruthy()
  expect(within(card).getByText(t("license.plan.monthly"))).toBeTruthy()
  expect(within(card).getByText(formatDate(LICENSE_EXPIRES_AT * 1000))).toBeTruthy()
  expect(within(card).getByText(t("license.devicesValue", { used: 1, max: 2 }))).toBeTruthy()
})

test("the license can be checked with the server on demand", async () => {
  const api = renderWith([settingsView()])
  await open("license")
  await userEvent.click(await screen.findByRole("button", { name: t("license.check") }))
  await waitFor(() => expect(api.calls).toContainEqual(["refreshLicense"]))
})

test("releasing this machine asks first, then frees its seat", async () => {
  let released = false
  const api = fakeApi({
    getSettings: async () => settingsView(),
    licenseState: async () => (released ? { state: "unlicensed" } : activeLicense()),
    deactivateLicense: async () => {
      released = true
      return { ok: true }
    },
  })
  render(<SettingsScreen api={api} onAppearance={() => {}} />)
  await open("license")
  await userEvent.click(await screen.findByRole("button", { name: t("license.release") }))
  expect(api.calls.some(([name]) => name === "deactivateLicense")).toBe(false)
  expect(within(licenseSection()).getByText(t("license.releaseConfirm"))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("license.releaseYes") }))
  await waitFor(() => expect(api.calls).toContainEqual(["deactivateLicense"]))
  expect(await within(licenseSection()).findByText(t("license.none"))).toBeTruthy()
})

test("releasing while offline explains that it needs the internet", async () => {
  const api = fakeApi({ getSettings: async () => settingsView(), deactivateLicense: async () => ({ ok: false, error: "offline" }) })
  render(<SettingsScreen api={api} onAppearance={() => {}} />)
  await open("license")
  await userEvent.click(await screen.findByRole("button", { name: t("license.release") }))
  await userEvent.click(screen.getByRole("button", { name: t("license.releaseYes") }))
  expect(await screen.findByText(t("activation.error.offline"))).toBeTruthy()
})

test("a blocked license says why in settings too", async () => {
  const api = fakeApi({ getSettings: async () => settingsView(), licenseState: async () => ({ state: "blocked", reason: "revoked", license: null }) })
  render(<SettingsScreen api={api} onAppearance={() => {}} />)
  await open("license")
  expect(await screen.findByText(t("activation.blocked.revoked"))).toBeTruthy()
})

/* general: tools and appearance */

const toolsSection = () => screen.getByRole("region", { name: t("tools.title") })
const toolRow = (name: string) => within(toolsSection()).getByText(name).closest("li")!

test("lists the tools found on this machine with their versions, and the app's own version", async () => {
  renderWith([settingsView()])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow("ffmpeg")).getByText("8.1.2")).toBeTruthy()
  expect(within(toolRow("whisper-cli")).getByText(t("tools.whisperPinned", { version: PINNED_WHISPER_VERSION }))).toBeTruthy()
  expect(within(toolRow("Claude Code")).getByText("2.1.233")).toBeTruthy()
  expect(screen.getByText(t("settings.appVersion", { version: "0.1.0" }))).toBeTruthy()
})

test("the ffmpeg that comes with the app says so, and asks for no install", async () => {
  const bundled = { path: "/Applications/BOXBLACK.app/Contents/Resources/bin/ffmpeg", version: "8.1.2", missing: [], bundled: true }
  renderWith([settingsView({ tools: { ...settingsView().tools, ffmpeg: bundled } })])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow("ffmpeg")).getByText(t("tools.bundled", { version: "8.1.2" }))).toBeTruthy()
  expect(within(toolRow("ffmpeg")).queryByText("brew install ffmpeg")).toBeNull()
})

test("the whisper-cli that comes with the app says so, and asks for no install", async () => {
  const bundled = { path: "/Applications/BOXBLACK.app/Contents/Resources/bin/whisper-cli", usable: true, pinned: true, bundled: true }
  renderWith([settingsView({ tools: { ...settingsView().tools, whisper: bundled } })])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow("whisper-cli")).getByText(t("tools.bundled", { version: PINNED_WHISPER_VERSION }))).toBeTruthy()
  expect(within(toolRow("whisper-cli")).queryByText(`brew install ${WHISPER_TAP_FORMULA}`)).toBeNull()
})

test("a whisper-cli that works but is not the tested one says so, with the command for the tested one", async () => {
  const theirs = { path: "/opt/homebrew/bin/whisper-cli", usable: true, pinned: false }
  renderWith([settingsView({ tools: { ...settingsView().tools, whisper: theirs } })])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow("whisper-cli")).getByText(new RegExp(t("tools.whisperNotPinned")))).toBeTruthy()
  expect(within(toolRow("whisper-cli")).getByText(`brew install ${WHISPER_TAP_FORMULA}`)).toBeTruthy()
})

test("a missing tool comes with the command that installs it", async () => {
  renderWith([settingsView({ tools: { ffmpeg: null, ffprobe: null, whisper: null, claude: null } })])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow("ffmpeg")).getByText("brew install ffmpeg")).toBeTruthy()
  expect(within(toolRow("whisper-cli")).getByText(`brew install ${WHISPER_TAP_FORMULA}`)).toBeTruthy()
  expect(within(toolRow("Claude Code")).getByText(t("tools.claudeMissing"))).toBeTruthy()
  expect(within(toolsSection()).getByText(t("tools.homebrewHint"))).toBeTruthy()
})

test("an ffmpeg that lacks parts, or a whisper-cli too old for word timings, says what to do", async () => {
  renderWith([
    settingsView({
      tools: {
        ffmpeg: { path: "/usr/local/bin/ffmpeg", version: "4.4", missing: ["blurdetect", "scdet"] },
        ffprobe: { path: "/usr/local/bin/ffprobe" },
        whisper: { path: "/usr/local/bin/whisper-cli", usable: false },
        claude: null,
      },
    }),
  ])
  await screen.findByRole("region", { name: t("tools.title") })
  expect(within(toolRow("ffmpeg")).getByText(new RegExp(t("tools.ffmpegIncomplete", { parts: "blurdetect, scdet" })))).toBeTruthy()
  expect(within(toolRow("whisper-cli")).getByText(new RegExp(t("tools.whisperUnusable")))).toBeTruthy()
  expect(within(toolRow("whisper-cli")).getByText(`brew install ${WHISPER_TAP_FORMULA}`)).toBeTruthy()
})

test("after installing something, the tools can be looked for again", async () => {
  const api = renderWith([settingsView({ tools: { ffmpeg: null, ffprobe: null, whisper: null, claude: null } }), settingsView()])
  await userEvent.click(await screen.findByRole("button", { name: t("tools.rescan") }))
  await waitFor(() => expect(api.calls).toContainEqual(["rescanTools"]))
  expect(await within(toolRow("ffmpeg")).findByText("8.1.2")).toBeTruthy()
})

test("the app can be pinned light or dark, and the choice is saved", async () => {
  const chosen: string[] = []
  const api = fakeApi()
  render(<SettingsScreen api={api} onAppearance={(appearance) => chosen.push(appearance)} />)
  const group = await screen.findByRole("radiogroup", { name: t("settings.appearance") })
  expect((within(group).getByRole("radio", { name: t("settings.appearance.system") }) as HTMLInputElement).checked).toBe(true)

  await userEvent.click(within(group).getByRole("radio", { name: t("settings.appearance.dark") }))
  expect(chosen).toEqual(["dark"])
  expect(api.calls).toContainEqual(["updateSettings", { appearance: "dark" }])
})

test("the General tab turns CapCut Pro on", async () => {
  const api = renderWith([settingsView()])
  const pro = await screen.findByRole("switch", { name: /มี CapCut Pro/ })
  expect((pro as HTMLInputElement).checked).toBe(false)
  await userEvent.click(pro)
  expect(api.calls).toContainEqual(["updateSettings", { capcut: { pro: true } }])
})

test("the General tab shows CapCut Pro as on when it is, and turns it off", async () => {
  const api = renderWith([settingsView({ capcut: { pro: true } })])
  const pro = await screen.findByRole("switch", { name: /มี CapCut Pro/ })
  expect((pro as HTMLInputElement).checked).toBe(true)
  await userEvent.click(pro)
  expect(api.calls).toContainEqual(["updateSettings", { capcut: { pro: false } }])
})

test("a licensed build has a License tab; one without licensing does not", async () => {
  renderWith([settingsView()])
  expect(await tabOf("license")).toBeTruthy()
  cleanup()
  render(<SettingsScreen api={fakeApi()} onAppearance={() => {}} licensing={false} />)
  await tabOf("general")
  expect(screen.queryByRole("tab", { name: new RegExp(t("settings.tab.license")) })).toBeNull()
})

/** The Claude tab with Claude Code chosen, and Claude Code in the given state. */
async function claudeTab(status: Partial<ClaudeCodeStatus>, overrides: Partial<RendererApi> = {}) {
  const view = settingsView({ llm: { transport: "claude-cli", model: "claude-opus-5", effort: "medium" } })
  const api = fakeApi({ getSettings: async () => view, claudeCodeStatus: async () => claudeCodeStatus(status), ...overrides })
  render(<SettingsScreen api={api} onAppearance={() => {}} />)
  await open("llm")
  return api
}
const card = () => screen.getByRole("region", { name: t("claudeCode.title") })

test("Claude Code that is not on the Mac can be installed from here, with what that takes", async () => {
  const api = await claudeTab({ path: null, version: null, account: null })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  expect(within(card()).getByText(t("claudeCode.installHint"))).toBeTruthy()
  await userEvent.click(within(card()).getByRole("button", { name: t("claudeCode.install") }))
  expect(api.calls.some(([name]) => name === "installClaudeCode")).toBe(true)
})

test("while it installs, what the installer says is shown, and it can be stopped", async () => {
  const api = await claudeTab({ path: null, version: null, account: null })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  act(() => api.emit({ type: "claude-code", status: claudeCodeStatus({ path: null, account: null, busy: "installing" }), progress: "Setting up Claude Code..." }))
  expect(within(card()).getByText(/Setting up Claude Code\.\.\./)).toBeTruthy()
  await userEvent.click(within(card()).getByRole("button", { name: t("claudeCode.cancel") }))
  expect(api.calls.some(([name]) => name === "cancelClaudeCode")).toBe(true)
})

test("installed but signed out, it offers to sign in with a Claude account", async () => {
  const api = await claudeTab({ account: { loggedIn: false, subscription: null } })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  await userEvent.click(within(card()).getByRole("button", { name: t("claudeCode.login") }))
  expect(api.calls.some(([name]) => name === "loginClaudeCode")).toBe(true)
})

test("while the browser sign-in is open, the page can be opened again and a code handed back", async () => {
  const api = await claudeTab({ account: { loggedIn: false, subscription: null }, busy: "logging-in" })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  expect(within(card()).getByText(t("claudeCode.waiting"))).toBeTruthy()
  await userEvent.click(within(card()).getByRole("button", { name: t("claudeCode.reopen") }))
  await userEvent.type(within(card()).getByLabelText(t("claudeCode.codeLabel")), "abc123#state")
  await userEvent.click(within(card()).getByRole("button", { name: t("claudeCode.sendCode") }))
  expect(api.calls.filter(([name]) => name === "openClaudeCodeLogin" || name === "submitClaudeCodeLoginCode")).toEqual([
    ["openClaudeCodeLogin"],
    ["submitClaudeCodeLoginCode", "abc123#state"],
  ])
})

test("a sign-in code that could not be handed over stays in the box to send again", async () => {
  await claudeTab(
    { account: { loggedIn: false, subscription: null }, busy: "logging-in" },
    {
      submitClaudeCodeLoginCode: async () => {
        throw new Error("the code must be text")
      },
    },
  )
  await screen.findByRole("region", { name: t("claudeCode.title") })
  const box = within(card()).getByLabelText(t("claudeCode.codeLabel"))
  await userEvent.type(box, "abc123#state")
  await userEvent.click(within(card()).getByRole("button", { name: t("claudeCode.sendCode") }))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(box).toHaveProperty("value", "abc123#state")
})

test("signed in, it says so with the plan, and asks for nothing", async () => {
  await claudeTab({})
  await screen.findByRole("region", { name: t("claudeCode.title") })
  expect(within(card()).getByText(t("claudeCode.signedIn", { plan: "max", version: "2.1.280" }))).toBeTruthy()
  expect(within(card()).queryByRole("button", { name: t("claudeCode.login") })).toBeNull()
})

test("an install or sign-in that stopped says why", async () => {
  const api = await claudeTab({ path: null, version: null, account: null })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  act(() => api.emit({ type: "claude-code", status: claudeCodeStatus({ path: null, account: null }), error: "Checksum verification failed" }))
  expect(within(card()).getByText(new RegExp("Checksum verification failed"))).toBeTruthy()
})

test("on macOS 12 Claude Code is not offered, and the API key is pointed to instead", async () => {
  await claudeTab({ supported: false, path: null, version: null, account: null })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  expect(within(card()).getByText(t("claudeCode.unsupported"))).toBeTruthy()
  expect(within(card()).queryByRole("button", { name: t("claudeCode.install") })).toBeNull()
})

test("a sign-in that ran out of time says so in words, not in exit codes", async () => {
  const api = await claudeTab({ account: { loggedIn: false, subscription: null } })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  act(() => api.emit({ type: "claude-code", status: claudeCodeStatus({ account: { loggedIn: false, subscription: null } }), error: "timed out" }))
  expect(within(card()).getByText(t("claudeCode.timedOut"))).toBeTruthy()
})

test("a sign-in that left Claude Code signed out asks to try again, in words", async () => {
  const api = await claudeTab({ account: { loggedIn: false, subscription: null } })
  await screen.findByRole("region", { name: t("claudeCode.title") })
  act(() => api.emit({ type: "claude-code", status: claudeCodeStatus({ account: { loggedIn: false, subscription: null } }), error: "not signed in" }))
  expect(within(card()).getByText(t("claudeCode.notSignedIn"))).toBeTruthy()
})

test("how often Claude looks at the pictures is chosen in the Claude tab, every 3 s unless changed, whatever the model", async () => {
  const sonnet = settingsView({ llm: { transport: "anthropic-api", model: "claude-sonnet-5", effort: "medium" } })
  const api = renderWith([sonnet, { ...sonnet, vision: { frameEveryS: 1 } }])
  await open("llm")
  const group = await screen.findByRole("radiogroup", { name: t("settings.frameEvery") })
  expect(within(group).getAllByRole("radio").map((radio) => radio.closest("label")!.textContent)).toEqual([1, 2, 3, 5, 10].map((seconds) => t("settings.frameEverySeconds", { seconds })))
  expect(within(group).getByRole("radio", { name: t("settings.frameEverySeconds", { seconds: 3 }) })).toHaveProperty("checked", true)
  expect(screen.getByText(t("settings.frameEveryHint"))).toBeTruthy()
  await userEvent.click(within(group).getByRole("radio", { name: t("settings.frameEverySeconds", { seconds: 1 }) }))
  await waitFor(() => expect(api.calls).toContainEqual(["updateSettings", { vision: { frameEveryS: 1 } }]))
  expect(await within(group).findByRole("radio", { name: t("settings.frameEverySeconds", { seconds: 1 }) })).toHaveProperty("checked", true)
})
