import { createContext, useState, type ReactNode } from "react"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { ToastStack } from "../ui/Toast.tsx"
import { AlertBar, type Alert } from "./AlertBar.tsx"
import { BackupMenu, type BackupMenuProps } from "./BackupMenu.tsx"
import { StageChips, type Stage } from "./StageChips.tsx"

export interface AppShellProps {
  /** the project's name, or the app's own on the project list */
  title: string
  stage: Stage | null
  reachable: Record<Stage, boolean>
  /** why a stage cannot be gone back to just now */
  shut?: Partial<Record<Stage, string>>
  onStage: (stage: Stage) => void
  /** the way out: back to the project list, or out of a place such as settings */
  onBack?: () => void
  /** where back goes, when it is not simply back */
  backLabel?: string
  alerts: Alert[]
  /** shown once a project is open */
  backups?: BackupMenuProps
  /** left out on the settings screen itself */
  onSettings?: () => void
  children: ReactNode
}

/**
 * Where a stage puts the buttons it owns, on the right of the bar. The stage portals them here from
 * inside its own providers, so they read the same context as the page they belong to.
 */
export const ToolbarSlot = createContext<HTMLElement | null>(null)

/**
 * The frame every screen sits in: one bar across the top with where the user is and what this
 * stage can do, whatever the app has to say under it, and the screen itself below that.
 */
export function AppShell({ title, stage, reachable, shut, onStage, onBack, backLabel, alerts, backups, onSettings, children }: AppShellProps) {
  // the stage's own toasts live on the bar and the app's in the screen; both are gathered here
  const [toasts, setToasts] = useState<HTMLDivElement | null>(null)
  // the bar's box for the stage's buttons; the bar is outside the stage's providers, so it cannot hold them itself
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return (
    <ToastStack.Provider value={toasts}>
      <ToolbarSlot.Provider value={slot}>
        <div className="app">
          <header className="topbar">
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                {`‹ ${backLabel ?? t("nav.back")}`}
              </Button>
            )}
            <span className="topbar-title">{title}</span>
            <StageChips stage={stage} reachable={reachable} shut={shut} onStage={onStage} />
            <span className="topbar-gap" />
            {/* the stage's buttons are drawn here from inside its own providers; the box adds none of its own to the bar */}
            <div className="toolbar-slot" ref={setSlot} />
            {backups && <BackupMenu {...backups} />}
            {onSettings && (
              <Button variant="ghost" onClick={onSettings}>
                {t("nav.settings")}
              </Button>
            )}
          </header>
          {/* always here, empty or not, so the bar / alerts / screen rows of the grid stay put */}
          <div className="alerts-slot">
            <AlertBar alerts={alerts} />
          </div>
          <main className="main">{children}</main>
        </div>
        {/* outside the grid; two toasts at once sit one above the other rather than on the same spot */}
        <div className="toasts" ref={setToasts} />
      </ToolbarSlot.Provider>
    </ToastStack.Provider>
  )
}
