/** How far something has got, or that it is going but cannot say how far (`value` null). */
export function Progress({ value, label }: { value: number | null; label: string }) {
  const percent = value === null ? null : Math.round(Math.min(Math.max(value, 0), 1) * 100)
  return (
    <div
      className={percent === null ? "progress unknown" : "progress"}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { "aria-valuenow": percent })}
    >
      <span style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  )
}
