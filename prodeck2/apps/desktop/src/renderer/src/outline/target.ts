// Kept free of React so the parsing can be tested on its own.

/** The shortest target length the brief takes: under five seconds is no clip. */
export const TARGET_MIN_S = 5
/** The longest: past half an hour the planner's rules for a short clip stop making sense. */
export const TARGET_MAX_S = 30 * 60
/** The lengths offered as buttons; a stored length that is none of these shows as a custom one. */
export const TARGET_PRESETS: readonly number[] = [30, 60, 90]

/**
 * Seconds from what the user typed: minutes and seconds like "2:30" (the seconds under 60), or a
 * plain count of seconds like "150". Null when it is neither, or outside TARGET_MIN_S–TARGET_MAX_S.
 */
export function parseTarget(text: string): number | null {
  const typed = text.trim()
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(typed)
  const seconds = clock ? Number(clock[1]) * 60 + Number(clock[2]) : /^\d{1,5}$/.test(typed) ? Number(typed) : null
  return seconds !== null && seconds >= TARGET_MIN_S && seconds <= TARGET_MAX_S ? seconds : null
}

/** A length as "m:ss", the way the clip's own length is shown. */
export const formatTarget = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
