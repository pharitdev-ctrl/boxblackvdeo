import { useId, useState } from "react"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Popover } from "../ui/Popover.tsx"

export interface AiItem {
  id: "emphasis" | "graphics" | "sounds" | "subtitles"
  label: string
  /** why it cannot run, when it cannot */
  disabled?: string
  onRun: () => void
}

/**
 * The one place the user asks Claude to think one work again, and stops what it is doing. Only one
 * run goes at a time, the whole plan or one work: `running` names it and brings the stop button.
 */
export function AiMenu({ items, running, onStop }: { items: AiItem[]; running: string | null; onStop: () => void }) {
  const [open, setOpen] = useState(false)
  // each item's reason is read with it
  const reasons = useId()

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
        <ul className="ai-items">
          {items.map((item) => (
            <li key={item.id}>
              <Button
                variant="ghost"
                disabled={item.disabled !== undefined}
                aria-describedby={item.disabled !== undefined ? `${reasons}-${item.id}` : undefined}
                onClick={() => {
                  setOpen(false)
                  item.onRun()
                }}
              >
                {item.label}
              </Button>
              {item.disabled && (
                <span className="hint" id={`${reasons}-${item.id}`}>
                  {item.disabled}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  )
}
