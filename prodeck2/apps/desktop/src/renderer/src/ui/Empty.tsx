import type { ReactNode } from "react"

/** What a list says when it has nothing in it: what is missing and what to do about it. */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p className="hint">{hint}</p>}
      {action}
    </div>
  )
}
