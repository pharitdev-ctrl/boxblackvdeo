import type { ReactNode } from "react"

export interface SelectProps {
  label?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
}

/** A native select, so the list is the system's and long lists stay usable. */
export function Select({ label, value, onChange, disabled = false, children }: SelectProps) {
  return (
    <select className="select" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  )
}
