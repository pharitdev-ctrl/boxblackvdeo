const pad = (n: number) => String(n).padStart(2, "0")

/** CapCut durations are microseconds; partial seconds are dropped. */
export function formatDuration(us: number): string {
  const total = Math.floor(us / 1_000_000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export function formatResolution(width: number, height: number): string {
  return `${width}×${height}`
}

/** `timeZone` exists for tests; the app shows the viewer's local time. */
export function formatDate(us: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(us / 1000))
}

/** The day alone, for a line too narrow to carry the time as well. */
export function formatDay(us: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone }).format(new Date(us / 1000))
}

/** Decimal units, matching how macOS Finder reports file sizes. */
export function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`
}

/** A position inside a clip, to the tenth of a second: 0:01.9 */
export function formatTimestamp(us: number): string {
  const tenths = Math.floor(us / 100_000)
  const minutes = Math.floor(tenths / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${minutes}:${pad(seconds)}.${tenths % 10}`
}

/** How long a graphic plays, to the tenth of a second below: one cut short must never read as its full length. */
export function playedSeconds(durationUs: number): string {
  return (Math.floor(durationUs / 100_000) / 10).toFixed(1)
}

/** The end of a failure's message, where a tool says what went wrong: its last three lines that say something, on one line. The rest would not fit a row. */
export const lastLines = (error: string): string =>
  error
    .split("\n")
    .filter((line) => line.trim())
    .slice(-3)
    .join(" ")
