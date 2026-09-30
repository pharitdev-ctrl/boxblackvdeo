// Kept free of runtime dependencies so the renderer can import it.

export type Rgb = [red: number, green: number, blue: number]

export const BLACK: Rgb = [0, 0, 0]
export const WHITE: Rgb = [1, 1, 1]

/** Text and the colour it must stand out from need at least this much (WCAG AA for large text). */
export const READABLE = 3

const channel = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

/** WCAG 2.1 relative luminance of a colour with channels 0–1. */
export function luminance([red, green, blue]: Rgb): number {
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

/** WCAG 2.1 contrast ratio, from 1 (the same) to 21 (black on white). */
export function contrast(a: Rgb, b: Rgb): number {
  const light = luminance(a)
  const dark = luminance(b)
  const [high, low] = light > dark ? [light, dark] : [dark, light]
  return (high + 0.05) / (low + 0.05)
}

/** Black or white, whichever a fill of this colour stands out from more. */
export function strokeFor(fill: Rgb): Rgb {
  return contrast(fill, BLACK) >= contrast(fill, WHITE) ? BLACK : WHITE
}

/** Black or white text for a surface of this colour — the same question as the stroke's. */
export const onSurface = strokeFor

const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/**
 * The first candidate that reads on the surface and is not the fallback itself — an accent that
 * cannot be told from the text around it is no accent. None reads: the fallback.
 */
export function readableAccent(candidates: Rgb[], surface: Rgb, fallback: Rgb): Rgb {
  return candidates.find((candidate) => contrast(candidate, surface) >= READABLE && !same(candidate, fallback)) ?? fallback
}

/** CapCut's lower-case "#rrggbb". */
export const hexOf = (colour: Rgb): string => `#${colour.map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`

/** A colour from "#rrggbb" (either case), or null for anything else. */
export function rgbOf(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const value = parseInt(match[1]!, 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
