import { useCallback, useEffect, useRef, useState } from "react"
import { FRAME_EVERY_S } from "@boxblack/core/vision/estimate"
import { CLAUDE_MODELS, EFFORT_MODELS, EFFORTS } from "@boxblack/core/llm/types"
import {
  APPEARANCES,
  type Appearance,
  type ApiKeyName,
  type ClaudeModelId,
  type GraphicCleanBlock,
  type GraphicCleanResult,
  type GraphicsPackState,
  type ReadinessProblem,
  type RendererApi,
  type SettingsPatch,
  type SettingsView,
  type SpokenLanguage,
} from "../../../shared/api.ts"
import { GRAPHICS_PACK } from "../../../shared/graphics-pack.ts"
import { Button } from "../ui/Button.tsx"
import { Progress } from "../ui/Progress.tsx"
import { Segmented } from "../ui/Segmented.tsx"
import { Switch } from "../ui/Switch.tsx"
import { Tabs } from "../ui/Tabs.tsx"
import { formatBytes } from "../format.ts"
import { Check } from "../components/Check.tsx"
import { ClaudeCodeCard } from "../components/ClaudeCodeCard.tsx"
import { LicenseCard } from "../components/LicenseCard.tsx"
import { ToolsCard } from "../components/ToolsCard.tsx"
import { t, type MessageKey } from "../i18n.ts"

type Run = (action: () => Promise<void>) => Promise<void>

type Tab = "general" | "asr" | "llm" | "license"
const TABS: Tab[] = ["general", "asr", "llm", "license"]

/** The tab where each thing that stops an analysis is put right. */
const TAB_OF: Record<ReadinessProblem, Tab> = {
  "ffmpeg-missing": "general",
  "ffmpeg-incomplete": "general",
  "whisper-missing": "general",
  "whisper-unusable": "general",
  "model-missing": "asr",
  "scribe-key-missing": "asr",
  "anthropic-key-missing": "llm",
  "claude-cli-missing": "llm",
  "claude-cli-login": "llm",
}

const TOOL_PROBLEMS: ReadinessProblem[] = ["ffmpeg-missing", "ffmpeg-incomplete", "whisper-missing", "whisper-unusable"]

/** The first tab, in order, with something to fix — or the first tab. */
const firstToFix = (view: SettingsView): Tab => TABS.find((tab) => view.readiness.problems.some((problem) => TAB_OF[problem] === tab)) ?? "general"

function ModelRow({ api, view, download, error }: {
  api: RendererApi
  view: SettingsView
  download: { received: number; total: number } | null
  error: string | null
}) {
  const { model } = view
  const size = formatBytes(model.sizeBytes)

  if (download || model.downloading) {
    const received = download?.received ?? 0
    const percent = Math.round((received / model.sizeBytes) * 100)
    const text = t("settings.modelDownloading", { percent, done: formatBytes(received), size })
    return (
      <div className="model-row">
        <div className="model-status">
          <span>{text}</span>
          <Progress value={received / model.sizeBytes} label={text} />
        </div>
        <Button size="sm" onClick={() => void api.cancelModelDownload()}>
          {t("settings.modelCancel")}
        </Button>
      </div>
    )
  }

  if (model.state.status === "ready") return <Check text={t("settings.modelReady")} />

  return (
    <div className="model-row">
      <div className="model-status">
        <span>
          {model.state.status === "partial"
            ? t("settings.modelPartial", { done: formatBytes(model.state.bytes), size })
            : t("settings.modelMissing", { size })}
        </span>
        {error && <span className="error-text">{t("settings.modelFailed", { message: error })}</span>}
      </div>
      <Button size="sm" variant="primary" onClick={() => void api.downloadModel()}>
        {model.state.status === "partial" ? t("settings.modelResume") : t("settings.modelDownload")}
      </Button>
    </div>
  )
}

/** The renderer pack graphics overlays need: offered next to the sounds row in the general tab. */
function GraphicsPackRow({ api, view, download, installing, error, run }: {
  api: RendererApi
  view: SettingsView
  download: { received: number; total: number } | null
  installing: boolean
  error: string | null
  run: Run
}) {
  const pack = view.graphicsPack
  const size = formatBytes(GRAPHICS_PACK.bytes)

  if (installing || pack.state === "installing") {
    const text = t("settings.graphicsPackInstalling")
    return (
      <RowCard>
        <span className="row-label">
          {t("settings.graphicsPack")}
          <span className="hint">{text}</span>
        </span>
        <div className="model-status">
          <Progress value={null} label={text} />
        </div>
        <Button size="sm" onClick={() => void api.cancelGraphicsPack()}>
          {t("settings.graphicsPackCancel")}
        </Button>
      </RowCard>
    )
  }

  if (download || pack.state === "downloading") {
    const received = download?.received ?? (pack.state === "downloading" ? pack.received : 0)
    const percent = Math.round((received / GRAPHICS_PACK.bytes) * 100)
    const text = t("settings.graphicsPackDownloading", { percent, done: formatBytes(received), size })
    return (
      <RowCard>
        <span className="row-label">
          {t("settings.graphicsPack")}
          <span className="hint">{text}</span>
        </span>
        <div className="model-status">
          <Progress value={received / GRAPHICS_PACK.bytes} label={text} />
        </div>
        <Button size="sm" onClick={() => void api.cancelGraphicsPack()}>
          {t("settings.graphicsPackCancel")}
        </Button>
      </RowCard>
    )
  }

  return (
    <RowCard>
      <span className="row-label">
        {t("settings.graphicsPack")}
        <span className="hint">{pack.state === "installed" ? t("settings.graphicsPackInstalled", { version: pack.version }) : t("settings.graphicsPackHint", { size })}</span>
        {error && <span className="error-text">{t("settings.graphicsPackFailed", { message: error })}</span>}
        {/* installed is not the same as working: a render may have found the pack, or the app's ffmpeg, broken */}
        {pack.state === "installed" && view.graphicsProblem && <span className="error-text">{t("settings.graphicsPackProblem", { problem: view.graphicsProblem.text })}</span>}
      </span>
      {pack.state === "installed" ? (
        <Button size="sm" onClick={() => void run(() => api.removeGraphicsPack())}>
          {t("settings.graphicsPackRemove")}
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => void run(() => api.installGraphicsPack())}>
          {t("settings.graphicsPackInstall")}
        </Button>
      )}
    </RowCard>
  )
}

/** Why a clean trashed nothing, in words: `name` is short and never the full path, which can carry the user's home folder name. */
function blockedMessage(blocked: GraphicCleanBlock): string {
  if (blocked.kind === "no-drafts-root") return t("settings.graphicFilesBlockedNoRoot")
  if (blocked.kind === "busy") return t("settings.graphicFilesBlockedBusy")
  if (blocked.where === "backup") return blocked.name === "" ? t("settings.graphicFilesBlockedBackups") : t("settings.graphicFilesBlockedBackup", { name: blocked.name })
  if (blocked.name === "") return t("settings.graphicFilesBlockedRoot")
  if (blocked.name === ".recycle_bin") return t("settings.graphicFilesBlockedRecycleBin")
  if (blocked.name.startsWith(".recycle_bin/")) return t("settings.graphicFilesBlockedRecycled", { name: blocked.name.slice(".recycle_bin/".length) })
  return t("settings.graphicFilesBlockedDraft", { name: blocked.name })
}

/** What a clean's result says, once it is known: files left for being new, or by a clean cut short, are never said to be in use. */
function cleanResult(cleaned: GraphicCleanResult): string {
  if (cleaned.blockedBy) return blockedMessage(cleaned.blockedBy)
  if (cleaned.kept === "stopped") return t("settings.graphicFilesStopped", { count: cleaned.trashed })
  if (cleaned.kept === "recent") return cleaned.trashed === 0 ? t("settings.graphicFilesNoneRecent") : t("settings.graphicFilesCleanedRecent", { count: cleaned.trashed })
  if (cleaned.trashed === 0) return t("settings.graphicFilesNoneUnused")
  return t("settings.graphicFilesCleaned", { count: cleaned.trashed })
}

/** The rendered graphics no draft uses any more: offered right after the renderer pack row. */
function GraphicFilesRow({ api, view, run }: { api: RendererApi; view: SettingsView; run: Run }) {
  const [cleaned, setCleaned] = useState<GraphicCleanResult | null>(null)
  const [busy, setBusy] = useState(false)

  // a clean that trashed everything must not make the row, and its result, vanish with the count
  if (view.graphicFiles.count === 0 && cleaned === null) return null

  const clean = async () => {
    // a fresh attempt must not leave an earlier result on screen next to whatever this one says
    setCleaned(null)
    setBusy(true)
    try {
      await run(async () => setCleaned(await api.cleanGraphicFiles()))
    } finally {
      setBusy(false)
    }
  }

  return (
    <RowCard>
      <span className="row-label">
        {t("settings.graphicFiles", { count: view.graphicFiles.count, size: formatBytes(view.graphicFiles.bytes) })}
        <span className="hint">{t("settings.graphicFilesHint")}</span>
        {/* always mounted, as ui/Toast.tsx does, so the result is announced as it changes rather than appearing already-read */}
        <span role="status" className={cleaned?.blockedBy ? "error-text" : "hint"}>
          {cleaned && cleanResult(cleaned)}
        </span>
      </span>
      {view.graphicFiles.count > 0 && (
        <Button size="sm" disabled={busy} onClick={() => void clean()}>
          {t("settings.graphicFilesClean")}
        </Button>
      )}
    </RowCard>
  )
}

function KeyForm({ api, run, name, label, hint, saved }: {
  api: RendererApi
  run: Run
  name: ApiKeyName
  label: string
  hint: string
  saved: string | null
}) {
  const [draft, setDraft] = useState("")
  const id = `key-${name}`
  return (
    <>
      {saved && (
        <div className="model-row">
          <Check text={t("settings.keySaved", { hint: saved })} />
          <Button size="sm" onClick={() => void run(() => api.deleteApiKey(name))}>
            {t("settings.keyDelete")}
          </Button>
        </div>
      )}
      <form
        className="key-form"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            await api.saveApiKey(name, draft)
            setDraft("")
          })
        }}
      >
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <div className="key-input">
          <input id={id} type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <Button variant="primary" type="submit" disabled={!draft.trim()}>
            {t("settings.keySave")}
          </Button>
        </div>
        <span className="hint">{hint}</span>
      </form>
    </>
  )
}

function Choice({ name, checked, title, hint, onChoose }: { name: string; checked: boolean; title: string; hint: string; onChoose: () => void }) {
  return (
    <label className={checked ? "choice selected" : "choice"}>
      <input type="radio" name={name} checked={checked} onChange={onChoose} />
      <span>
        <strong>{title}</strong>
        <span className="hint">{hint}</span>
      </span>
    </label>
  )
}

function Problems({ view, only }: { view: SettingsView; only: ReadinessProblem[] }) {
  const problems = view.readiness.problems.filter((problem) => only.includes(problem))
  if (problems.length === 0) return null
  return (
    <ul className="warnings">
      {problems.map((problem) => (
        <li key={problem}>{t(`problem.${problem}` as MessageKey)}</li>
      ))}
    </ul>
  )
}

/** A card of one row: a label on the left, the control on the right. */
function RowCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="settings-row">{children}</div>
    </div>
  )
}

/**
 * Everything about this machine and this customer, in four tabs. It opens on the first tab with
 * something to fix, which is where "ไปที่ตั้งค่า" from the prepare stage lands.
 */
export function SettingsScreen({
  api,
  onAppearance,
  licensing = true,
}: {
  api: RendererApi
  onAppearance: (appearance: Appearance) => void
  /** false in a build that asks for no license: there is no License tab to show */
  licensing?: boolean
}) {
  const shown = licensing ? TABS : TABS.filter((id) => id !== "license")
  const [view, setView] = useState<SettingsView | null>(null)
  const [tab, setTab] = useState<Tab | null>(null)
  const [download, setDownload] = useState<{ received: number; total: number } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [packDownload, setPackDownload] = useState<{ received: number; total: number } | null>(null)
  const [packInstalling, setPackInstalling] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // an older refresh that answers late must never overwrite a newer one already applied
  const latestRefresh = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++latestRefresh.current
    const next = await api.getSettings()
    if (request !== latestRefresh.current) return
    setView(next)
    // the first look decides the tab; after that it is the user's
    setTab((current) => current ?? firstToFix(next))
  }, [api])

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message))
  }, [refresh])

  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.type === "model-download") {
          if (event.state === "progress") {
            setDownloadError(null)
            setDownload({ received: event.received, total: event.total })
            return
          }
          setDownload(null)
          if (event.state === "failed") setDownloadError(event.error)
          void refresh()
          return
        }
        if (event.type === "graphics-pack") {
          if (event.state === "progress") {
            setPackError(null)
            setPackInstalling(false)
            setPackDownload({ received: event.received, total: event.total })
            return
          }
          if (event.state === "installing") {
            setPackInstalling(true)
            return
          }
          setPackDownload(null)
          setPackInstalling(false)
          if (event.state === "failed") setPackError(event.error)
          // give the row its final shape right away: a refresh in flight from before this event
          // (run's own, or an earlier one) must not be the only thing standing between it and a
          // stale "downloading" fallback while its own refresh is still on the way
          const graphicsPack: GraphicsPackState = event.state === "done" ? { state: "installed", version: GRAPHICS_PACK.version } : { state: "missing" }
          setView((current) => (current ? { ...current, graphicsPack } : current))
          void refresh()
        }
      }),
    [api, refresh],
  )

  // after Claude Code is installed or signed in, the Claude tab's readiness changes with it
  const settled = useCallback(() => void refresh(), [refresh])

  const run: Run = async (action) => {
    try {
      setError(null)
      await action()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const update = (patch: SettingsPatch) => run(() => api.updateSettings(patch))

  const flagged = new Set((view?.readiness.problems ?? []).map((problem) => TAB_OF[problem]))

  return (
    <section className="screen">
      <div className="content">
        <div className="settings">
          {error && <p className="notice error">{t("error.generic", { message: error })}</p>}
          {view && tab && (
            <>
              <Tabs
                label={t("settings.tabs")}
                value={tab}
                onChange={(next) => setTab(next as Tab)}
                tabs={shown.map((id) => ({ id, label: t(`settings.tab.${id}` as MessageKey), flag: flagged.has(id) ? t("settings.needsFixing") : undefined }))}
              />

              {tab === "general" && (
                <div className="settings-panel">
                  <RowCard>
                    <span className="row-label">{t("settings.appearance")}</span>
                    <Segmented
                      label={t("settings.appearance")}
                      value={view.appearance}
                      options={APPEARANCES.map((appearance) => ({ value: appearance, label: t(`settings.appearance.${appearance}` as MessageKey) }))}
                      onChange={(appearance) => {
                        onAppearance(appearance)
                        void update({ appearance })
                      }}
                    />
                  </RowCard>
                  <RowCard>
                    <Switch
                      label={t("settings.capcutPro")}
                      hint={t("settings.capcutProHint")}
                      checked={view.capcut.pro}
                      onChange={(pro) => void update({ capcut: { pro } })}
                    />
                  </RowCard>
                  {/* a sound CapCut could not fetch is not offered; after being offline the user can offer them again */}
                  {view.unfetchableSounds > 0 && (
                    <RowCard>
                      <span className="row-label">
                        {t("settings.soundsUnfetchable", { count: view.unfetchableSounds })}
                        <span className="hint">{t("settings.soundsUnfetchableHint")}</span>
                      </span>
                      <Button onClick={() => void run(() => api.retryUnfetchableSounds())}>{t("settings.soundsRetry")}</Button>
                    </RowCard>
                  )}
                  <GraphicsPackRow api={api} view={view} download={packDownload} installing={packInstalling} error={packError} run={run} />
                  <GraphicFilesRow api={api} view={view} run={run} />
                  <Problems view={view} only={TOOL_PROBLEMS} />
                  <ToolsCard view={view} onRescan={() => run(() => api.rescanTools())} />
                  <p className="hint">{t("settings.appVersion", { version: view.appVersion })}</p>
                </div>
              )}

              {tab === "asr" && (
                <div className="settings-panel">
                  <section className="card" aria-labelledby="asr-title">
                    <div className="card-head">
                      <h2 id="asr-title">{t("settings.asrTitle")}</h2>
                    </div>
                    <div className="choices">
                      <Choice
                        name="engine"
                        checked={view.asr.engine === "whisper-local"}
                        title={t("settings.engineLocal")}
                        hint={t("settings.engineLocalHint")}
                        onChoose={() => void update({ asr: { engine: "whisper-local" } })}
                      />
                      {view.asr.engine === "whisper-local" && (
                        <div className="choice-detail">
                          <ModelRow api={api} view={view} download={download} error={downloadError} />
                        </div>
                      )}
                      <Choice
                        name="engine"
                        checked={view.asr.engine === "scribe"}
                        title={t("settings.engineScribe")}
                        hint={t("settings.engineScribeHint")}
                        onChoose={() => void update({ asr: { engine: "scribe" } })}
                      />
                      {view.asr.engine === "scribe" && (
                        <div className="choice-detail">
                          <KeyForm
                            api={api}
                            run={run}
                            name="elevenlabs"
                            label={t("settings.scribeKeyLabel")}
                            hint={t("settings.scribeKeyHint")}
                            saved={view.keyHints.elevenlabs}
                          />
                        </div>
                      )}
                    </div>
                  </section>
                  <RowCard>
                    <label htmlFor="language" className="row-label">
                      {t("settings.language")}
                    </label>
                    <select
                      id="language"
                      className="select"
                      value={view.asr.language}
                      onChange={(event) => void update({ asr: { language: event.target.value as SpokenLanguage } })}
                    >
                      <option value="th">{t("settings.languageTh")}</option>
                      <option value="en">{t("settings.languageEn")}</option>
                      <option value="auto">{t("settings.languageAuto")}</option>
                    </select>
                  </RowCard>
                </div>
              )}

              {tab === "llm" && (
                <div className="settings-panel">
                  <Problems view={view} only={["claude-cli-missing", "claude-cli-login"]} />
                  <section className="card" aria-labelledby="llm-title">
                    <div className="card-head">
                      <h2 id="llm-title">{t("settings.llmTitle")}</h2>
                    </div>
                    <div className="choices">
                      <Choice
                        name="transport"
                        checked={view.llm.transport === "anthropic-api"}
                        title={t("settings.transportApi")}
                        hint={t("settings.transportApiHint")}
                        onChoose={() => void update({ llm: { transport: "anthropic-api" } })}
                      />
                      {view.llm.transport === "anthropic-api" && (
                        <div className="choice-detail">
                          <KeyForm
                            api={api}
                            run={run}
                            name="anthropic"
                            label={t("settings.anthropicKeyLabel")}
                            hint={t("settings.anthropicKeyHint")}
                            saved={view.keyHints.anthropic}
                          />
                        </div>
                      )}
                      <Choice
                        name="transport"
                        checked={view.llm.transport === "claude-cli"}
                        title={t("settings.transportCli")}
                        hint={t("settings.transportCliHint")}
                        onChoose={() => void update({ llm: { transport: "claude-cli" } })}
                      />
                      {view.llm.transport === "claude-cli" && (
                        <div className="choice-detail">
                          <p className="warn-text">{t("settings.transportCliWarning")}</p>
                        </div>
                      )}
                    </div>
                  </section>
                  {view.llm.transport === "claude-cli" && <ClaudeCodeCard api={api} onSettled={settled} />}
                  <RowCard>
                    <label htmlFor="llm-model" className="row-label">
                      {t("settings.llmModel")}
                    </label>
                    <select
                      id="llm-model"
                      className="select"
                      value={view.llm.model}
                      onChange={(event) => void update({ llm: { model: event.target.value as ClaudeModelId } })}
                    >
                      {CLAUDE_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </RowCard>
                  {/* only the models that take it; the others think at their own default */}
                  {EFFORT_MODELS.includes(view.llm.model) && (
                    <RowCard>
                      <span className="row-label">
                        {t("settings.llmEffort")}
                        <span className="hint">{t("settings.llmEffortHint")}</span>
                      </span>
                      <Segmented
                        label={t("settings.llmEffort")}
                        value={view.llm.effort}
                        options={EFFORTS.map((effort) => ({ value: effort, label: t(`settings.effort.${effort}` as MessageKey) }))}
                        onChange={(effort) => void update({ llm: { effort } })}
                      />
                    </RowCard>
                  )}
                  <RowCard>
                    <span className="row-label">
                      {t("settings.frameEvery")}
                      <span className="hint">{t("settings.frameEveryHint")}</span>
                    </span>
                    <Segmented
                      label={t("settings.frameEvery")}
                      value={String(view.vision.frameEveryS)}
                      options={FRAME_EVERY_S.map((seconds) => ({ value: String(seconds), label: t("settings.frameEverySeconds", { seconds }) }))}
                      onChange={(value) => {
                        const seconds = FRAME_EVERY_S.find((rate) => String(rate) === value)
                        if (seconds !== undefined) void update({ vision: { frameEveryS: seconds } })
                      }}
                    />
                  </RowCard>
                </div>
              )}

              {tab === "license" && licensing && (
                <div className="settings-panel">
                  <LicenseCard api={api} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
