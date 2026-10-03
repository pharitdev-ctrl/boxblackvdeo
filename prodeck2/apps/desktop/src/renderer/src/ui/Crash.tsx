import { Component, type ErrorInfo, type ReactNode } from "react"
import { t } from "../i18n.ts"

/**
 * Catches an error while drawing what it holds, so one part of the page that breaks shows what broke, and a way to
 * try again, instead of the whole window going blank.
 */
export class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="notice error crash" role="alert">
        <p>{t("error.generic", { message: error.message })}</p>
        <pre className="mono">{(error.stack ?? "").split("\n").slice(0, 8).join("\n")}</pre>
        <button type="button" onClick={() => this.setState({ error: null })}>
          {t("crash.retry")}
        </button>
      </div>
    )
  }
}
