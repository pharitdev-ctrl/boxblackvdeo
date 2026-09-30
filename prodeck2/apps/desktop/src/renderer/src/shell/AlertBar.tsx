import { useState, type ReactNode } from "react"
import { Button } from "../ui/Button.tsx"
import { t } from "../i18n.ts"

export interface Alert {
  id: string
  tone: "info" | "warn" | "danger"
  text: string
  /** a second line, for a warning that needs explaining */
  detail?: string
  action?: { label: string; onClick: () => void }
}

function Row({ alert }: { alert: Alert }): ReactNode {
  return (
    <div className={`alert ${alert.tone}`} role="status">
      <span className="alert-dot" aria-hidden />
      <div className="alert-text">
        <span>{alert.text}</span>
        {alert.detail && <span className="hint">{alert.detail}</span>}
      </div>
      {alert.action && (
        <Button size="sm" onClick={alert.action.onClick}>
          {alert.action.label}
        </Button>
      )}
    </div>
  )
}

/**
 * What the app has to say before the user does anything else. Only the first one is in the way;
 * the others wait behind a count, so a stack of warnings never pushes the work off screen.
 */
export function AlertBar({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState(false)
  if (alerts.length === 0) return null
  const [first, ...rest] = alerts
  return (
    <div className="alerts">
      <Row alert={first!} />
      {open && rest.map((alert) => <Row key={alert.id} alert={alert} />)}
      {rest.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          {open ? t("alerts.hide") : t("alerts.showAll", { count: rest.length })}
        </Button>
      )}
    </div>
  )
}
