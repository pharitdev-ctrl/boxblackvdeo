import type { ReactNode } from "react"

/**
 * A caption above a control that names itself — a Segmented, a list of switches. `Field` wraps its
 * control in a label, which would rename the parts inside; this only writes the caption.
 */
export function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label" aria-hidden>
        {label}
      </span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}
