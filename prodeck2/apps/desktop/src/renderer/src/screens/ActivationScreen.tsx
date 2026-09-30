import { useState } from "react"
import type { ActivationError, LicenseState, RendererApi } from "../../../shared/api.ts"
import { formatDate } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"

interface Props {
  api: RendererApi
  /** why the app is not licensed right now */
  state: Exclude<LicenseState, { state: "active" }>
  onActivated: (state: LicenseState) => void
}

export function errorMessage(error: ActivationError): string {
  const known = ["invalid-key", "revoked", "expired", "device-limit", "rate-limited", "offline"]
  return t((known.includes(error) ? `activation.error.${error}` : "activation.error.server") as MessageKey)
}

export function blockedMessage(state: Extract<LicenseState, { state: "blocked" }>): string {
  if (state.reason === "expired") return t("activation.blocked.expired", { date: state.license ? formatDate(state.license.expiresAt * 1000) : "-" })
  return t(`activation.blocked.${state.reason}` as MessageKey)
}

/** Reasons a server check can clear up; a released or copied license needs the key again instead. */
const CHECKABLE = ["revoked", "expired", "clock", "token-expired"]

export function ActivationScreen({ api, state, onActivated }: Props) {
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState<"activating" | "checking" | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const activate = async () => {
    setBusy("activating")
    setMessage(null)
    try {
      const result = await api.activateLicense(key)
      if (result.ok) onActivated(result.state)
      else setMessage(errorMessage(result.error))
    } finally {
      setBusy(null)
    }
  }

  const checkAgain = async () => {
    setBusy("checking")
    setMessage(null)
    try {
      const next = await api.refreshLicense()
      if (next.state === "active") onActivated(next)
      else setMessage(t("activation.stillBlocked"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="screen">
      <div className="content activation">
        <h1>{t("activation.title")}</h1>
        {state.state === "blocked" && (
          <div className="notice warning-block">
            <p>{blockedMessage(state)}</p>
            {CHECKABLE.includes(state.reason) && (
              <button className="button" onClick={() => void checkAgain()} disabled={busy !== null}>
                {busy === "checking" ? t("activation.checking") : t("activation.checkAgain")}
              </button>
            )}
          </div>
        )}
        <p className="subtle">{t("activation.hint")}</p>
        <form
          className="activation-form"
          onSubmit={(event) => {
            event.preventDefault()
            void activate()
          }}
        >
          <label htmlFor="license-key">{t("activation.keyLabel")}</label>
          <input
            id="license-key"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("activation.keyPlaceholder")}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <button className="button primary" type="submit" disabled={!key.trim() || busy !== null}>
            {busy === "activating" ? t("activation.submitting") : t("activation.submit")}
          </button>
        </form>
        {message && <p className="notice error">{message}</p>}
      </div>
    </section>
  )
}
