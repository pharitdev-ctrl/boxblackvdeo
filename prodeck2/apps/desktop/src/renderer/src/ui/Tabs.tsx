import { useRef, type KeyboardEvent, type ReactNode } from "react"

export interface TabSpec {
  id: string
  label: string
  /** shown next to the label, e.g. how many things are in that tab */
  count?: number
  /** the kind is switched off; the tab can still be opened, and says so */
  disabled?: boolean
  /** something in the tab needs attention; the text says what the mark means */
  flag?: string
  /** a work of this tab is running; the text says so */
  busy?: string
}

export interface TabsProps {
  label: string
  value: string
  tabs: TabSpec[]
  onChange: (id: string) => void
  /** the id of the TabPanel that shows the open tab: each tab says it controls it */
  panelId?: string
}

/** The id a tab has when it controls a panel, which names the panel while that tab is open. */
const tabIdOf = (panelId: string, tab: string) => `${panelId}-tab-${tab}`

/**
 * The sections of one thing, one visible at a time. A tab whose kind is switched off stays
 * reachable — it is where the user goes to turn the kind back on.
 */
export function Tabs({ label, value, tabs, onChange, panelId }: TabsProps) {
  const strip = useRef<HTMLDivElement>(null)

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === value)
    const next = tabs[(index + step + tabs.length) % tabs.length]!
    onChange(next.id)
    strip.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={strip} onKeyDown={move}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={panelId === undefined ? undefined : tabIdOf(panelId, tab.id)}
          aria-controls={panelId}
          data-tab={tab.id}
          className={tab.id === value ? "tab on" : "tab"}
          aria-selected={tab.id === value}
          aria-disabled={tab.disabled === true}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
          {tab.busy && <span className="tab-busy" role="img" aria-label={tab.busy} />}
          {tab.flag && <span className="tab-flag" role="img" aria-label={tab.flag} />}
        </button>
      ))}
    </div>
  )
}

/** What the open tab shows, named by that tab for a screen reader. `id` is the one given the tabs as `panelId`. */
export function TabPanel({ id, value, className, busy, children }: { id: string; value: string; className?: string; busy?: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={tabIdOf(id, value)} className={className} aria-busy={busy}>
      {children}
    </div>
  )
}
