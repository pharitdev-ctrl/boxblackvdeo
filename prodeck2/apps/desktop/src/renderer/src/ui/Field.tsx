import type { ReactNode } from "react"

/**
 * A label above one control, with an optional line of help under it. The label wraps the control,
 * so the browser names it without ids to keep in step.
 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        <span className="field-label">{label}</span>
        {children}
      </label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}
