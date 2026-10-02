import { useId, useState } from "react"
import type { FlairLevel, RethinkWork } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Popover } from "../ui/Popover.tsx"
import { LevelControl } from "./TabSettings.tsx"

export interface AiItem {
  id: "all" | "emphasis" | RethinkWork
  label: string
  /** what it does, said as its title */
  hint?: string
  /** why it cannot run, when it cannot */
  disabled?: string
  /** the menu's head: set in bold, with a line between it and the items after it */
  lead?: boolean
  onRun: () => void
}

/** How loud the clip is, set at the head of the menu: a setting, not a run, so it neither closes the menu nor waits for a run. */
export interface AiLevel {
  value: FlairLevel
  onChange: (level: FlairLevel) => void
  disabled: boolean
}

/**
 * The one place the user asks Claude for the whole plan or to think one work again, and stops what
 * it is doing. Only one run goes at a time, the whole plan or one work: `running` names it and brings
 * the stop button. The level, when given, heads it, since it decides how much of what Claude plans plays.
 */
export function AiMenu({ items, running, onStop, level }: { items: AiItem[]; running: string | null; onStop: () => void; level?: AiLevel }) {
  const [open, setOpen] = useState(false)
  // each item's reason is read with it
  const reasons = useId()
  // when every item waits for the same thing (a run going, a write), it is said once at the head of the menu, not under each
  const first = items[0]?.disabled
  const shared = first !== undefined && items.every((item) => item.disabled === first) ? first : undefined
  const noteId = `${reasons}-note`
  // a reason some of the items share, but not all, is said once at the foot of the menu, after the list;
  // a reason only one item has is said under that item
  const counts = new Map<string, number>()
  for (const item of items) if (item.disabled !== undefined) counts.set(item.disabled, (counts.get(item.disabled) ?? 0) + 1)
  const footed = shared === undefined ? [...counts].filter(([, count]) => count > 1).map(([reason]) => reason) : []
  const footId = (reason: string) => `${reasons}-foot-${footed.indexOf(reason)}`
  const own = (item: AiItem) => item.disabled !== undefined && shared === undefined && !footed.includes(item.disabled)
  const reasonId = (item: AiItem) =>
    item.disabled === undefined ? undefined : shared !== undefined ? noteId : own(item) ? `${reasons}-${item.id}` : footId(item.disabled)

  return (
    <div className="ai-menu">
      <Button variant="ai" aria-expanded={open} onClick={() => setOpen(!open)}>
        {running ? `✦ ${running}` : `✦ ${t("post.ai")} ▾`}
      </Button>
      {running && (
        <Button variant="ghost" onClick={onStop}>
          {t("edit.ai.stop")}
        </Button>
      )}
      <Popover open={open} label={t("post.ai")} onClose={() => setOpen(false)}>
        {level && (
          <>
            <div className="ai-level">
              <LevelControl level={level.value} onLevel={level.onChange} disabled={level.disabled} />
            </div>
            <div role="separator" className="ai-line" />
          </>
        )}
        {shared !== undefined && (
          <p className="hint ai-note" id={noteId}>
            {shared}
          </p>
        )}
        <ul className="ai-items">
          {items.flatMap((item) => [
            <li key={item.id}>
              <Button
                variant="ghost"
                className={item.lead ? "lead" : undefined}
                title={item.hint}
                disabled={item.disabled !== undefined}
                aria-describedby={reasonId(item)}
                onClick={() => {
                  setOpen(false)
                  item.onRun()
                }}
              >
                {item.label}
              </Button>
              {own(item) && (
                <span className="hint ai-reason" id={`${reasons}-${item.id}`}>
                  {item.disabled}
                </span>
              )}
            </li>,
            ...(item.lead ? [<li key={`${item.id}-line`} role="separator" className="ai-line" />] : []),
          ])}
        </ul>
        {footed.map((reason) => (
          <p key={reason} className="hint ai-note ai-foot" id={footId(reason)}>
            {reason}
          </p>
        ))}
      </Popover>
    </div>
  )
}
