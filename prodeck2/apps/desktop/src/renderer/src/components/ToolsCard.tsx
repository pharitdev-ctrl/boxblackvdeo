import { useState, type ReactNode } from "react"
import type { SettingsView } from "../../../shared/api.ts"
import { PINNED_WHISPER_VERSION, WHISPER_TAP_FORMULA } from "../../../shared/whisper-tap.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Check } from "./Check.tsx"

function Command({ children }: { children: string }) {
  return <code className="command">{children}</code>
}

/** One tool: its name on the left, what was found — or the command that fixes it — on the right. */
function ToolRow({ name, note, status }: { name: string; note?: string; status: ReactNode }) {
  return (
    <li className="settings-row">
      <span className="row-label">
        {name}
        {note && <span className="hint">{note}</span>}
      </span>
      <span className="row-value">{status}</span>
    </li>
  )
}

/** What the customer has installed, and the one command that fixes each gap. */
export function ToolsCard({ view, onRescan }: { view: SettingsView; onRescan: () => Promise<void> }) {
  const [scanning, setScanning] = useState(false)
  const { ffmpeg, whisper, claude } = view.tools
  const anyMissing = !ffmpeg || !whisper

  return (
    <section className="card" aria-labelledby="tools-title">
      <div className="card-head">
        <h2 id="tools-title">{t("tools.title")}</h2>
        <p className="hint">{t("tools.hint")}</p>
      </div>
      <ul className="settings-rows">
        <ToolRow
          name="ffmpeg"
          status={
            ffmpeg?.bundled && ffmpeg.missing.length === 0 ? (
              <Check text={t("tools.bundled", { version: ffmpeg.version ?? "" })} />
            ) : !ffmpeg ? (
              <span className="warn-text">
                {t("tools.missing")} <Command>brew install ffmpeg</Command>
              </span>
            ) : ffmpeg.missing.length > 0 ? (
              <span className="warn-text">
                {t("tools.ffmpegIncomplete", { parts: ffmpeg.missing.join(", ") })} <Command>brew install ffmpeg</Command>
              </span>
            ) : (
              <Check text={ffmpeg.version ?? t("tools.installed")} />
            )
          }
        />
        <ToolRow
          name="whisper-cli"
          note={t("tools.whisperOptional")}
          status={
            whisper?.bundled && whisper.usable ? (
              <Check text={t("tools.bundled", { version: PINNED_WHISPER_VERSION })} />
            ) : !whisper ? (
              <span className="warn-text">
                {t("tools.missing")} <Command>{`brew install ${WHISPER_TAP_FORMULA}`}</Command>
              </span>
            ) : !whisper.usable ? (
              <span className="warn-text">
                {t("tools.whisperUnusable")} <Command>{`brew install ${WHISPER_TAP_FORMULA}`}</Command>
              </span>
            ) : whisper.pinned ? (
              <Check text={t("tools.whisperPinned", { version: PINNED_WHISPER_VERSION })} />
            ) : (
              // it works, but it is whatever Homebrew had that day: the tested one is one command away
              <span className="hint">
                {t("tools.whisperNotPinned")} <Command>{`brew install ${WHISPER_TAP_FORMULA}`}</Command>
              </span>
            )
          }
        />
        <ToolRow
          name="Claude Code"
          note={t("tools.claudeOptional")}
          status={claude ? <Check text={claude.version ?? t("tools.installed")} /> : <span className="hint">{t("tools.claudeMissing")}</span>}
        />
      </ul>
      <div className="card-foot">
        <span className="hint">{anyMissing ? t("tools.homebrewHint") : ""}</span>
        <Button
          size="sm"
          disabled={scanning}
          onClick={async () => {
            setScanning(true)
            try {
              await onRescan()
            } finally {
              setScanning(false)
            }
          }}
        >
          {scanning ? t("tools.rescanning") : t("tools.rescan")}
        </Button>
      </div>
    </section>
  )
}
