import { useId } from "react"

export interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}

/**
 * One choice out of a few, side by side. Real radios underneath, so the arrow keys, the reader and
 * the form behaviour are the browser's, not ours.
 */
export function Segmented<T extends string>({ label, value, options, onChange, disabled = false }: SegmentedProps<T>) {
  const name = useId()
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={option.value === value ? "segment on" : "segment"}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
