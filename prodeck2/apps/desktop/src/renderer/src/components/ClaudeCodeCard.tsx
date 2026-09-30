import { useEffect, useState } from "react"
import type { ClaudeCodeStatus, RendererApi } from "../../../shared/api.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Check } from "./Check.tsx"

/** What the main process reports in plain words; anything else is Claude Code's own message, shown as it is. */
const ERRORS: Record<string, MessageKey> = { "timed out": "claudeCode.timedOut", "not signed in": "claudeCode.notSignedIn" }

/**
 * Claude Code set up without a terminal: installed with Anthropic's own installer and signed in
 * through the browser, both started from here. `onSettled` lets the screen read its readiness
 * again once an install or sign-in has finished.
 */
export function ClaudeCodeCard({ api, onSettled }: { api: RendererApi; onSettled: () => void }) {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState("")

  useEffect(() => {
    let alive = true
    void api.claudeCodeStatus().then((next) => alive && setStatus(next))
    const stop = api.onEvent((event) => {
      if (event.type !== "claude-code") return
      setStatus(event.status)
      setProgress(event.progress ?? null)
      if (event.error) setError(event.error)
      if (event.status.busy === null) onSettled()
    })
    return () => {
      alive = false
      stop()
    }
  }, [api, onSettled])

  // an install or sign-in settles with an event; a refusal to start comes back here instead
  const start = (action: () => Promise<void>) => {
    setError(null)
    action().catch((e: Error) => setError(e.message))
  }

  let body = null
  if (!status) body = null
  else if (!status.supported) body = <p className="warn-text">{t("claudeCode.unsupported")}</p>
  else if (status.busy === "installing") {
    body = (
      <div className="model-row">
        <span className="hint">
          {t("claudeCode.installing")} {progress}
        </span>
        <Button size="sm" onClick={() => void api.cancelClaudeCode()}>
          {t("claudeCode.cancel")}
        </Button>
      </div>
    )
  } else if (!status.path) {
    body = (
      <div className="model-row">
        <span className="hint">{t("claudeCode.installHint")}</span>
        <Button variant="primary" onClick={() => start(() => api.installClaudeCode())}>
          {t("claudeCode.install")}
        </Button>
      </div>
    )
  } else if (status.busy === "logging-in") {
    body = (
      <>
        <p className="hint">{t("claudeCode.waiting")}</p>
        <div className="model-row">
          <Button size="sm" onClick={() => void api.openClaudeCodeLogin()}>
            {t("claudeCode.reopen")}
          </Button>
          <Button size="sm" onClick={() => void api.cancelClaudeCode()}>
            {t("claudeCode.cancel")}
          </Button>
        </div>
        <form
          className="key-form"
          onSubmit={(event) => {
            event.preventDefault()
            // a code that did not go through stays in the box to send again
            api.submitClaudeCodeLoginCode(code).then(
              () => setCode(""),
              () => {},
            )
          }}
        >
          <label htmlFor="claude-code-login" className="field-label">
            {t("claudeCode.codeLabel")}
          </label>
          <div className="key-input">
            <input id="claude-code-login" autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />
            <Button type="submit" disabled={!code.trim()}>
              {t("claudeCode.sendCode")}
            </Button>
          </div>
        </form>
      </>
    )
  } else if (status.account?.loggedIn) {
    body = <Check text={t("claudeCode.signedIn", { plan: status.account.subscription ?? "", version: status.version ?? "" })} />
  } else {
    body = (
      <div className="model-row">
        <span className="hint">{t("claudeCode.loginHint")}</span>
        <Button variant="primary" onClick={() => start(() => api.loginClaudeCode())}>
          {t("claudeCode.login")}
        </Button>
      </div>
    )
  }

  return (
    <section className="card" aria-labelledby="claude-code-title">
      <div className="card-head">
        <h2 id="claude-code-title">{t("claudeCode.title")}</h2>
      </div>
      <div className="card-body">
        {body}
        {error && <p className="danger-text">{ERRORS[error] ? t(ERRORS[error]) : t("claudeCode.failed", { message: error })}</p>}
      </div>
    </section>
  )
}
