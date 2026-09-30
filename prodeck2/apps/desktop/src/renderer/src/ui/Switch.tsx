export interface SwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  hint?: string
}

/** An on/off choice that takes effect at once — a checkbox that says it is a switch. */
export function Switch({ label, checked, onChange, disabled = false, hint }: SwitchProps) {
  return (
    <label className={disabled ? "switch off" : "switch"}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden />
      <span className="switch-label">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </span>
    </label>
  )
}
