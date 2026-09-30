import { expect, test } from "vitest"
import { contrast, onSurface, readableAccent, strokeFor } from "./colour.ts"
import { accentOnBar, DEFAULT_HIGHLIGHT_OPTIONS, HIGHLIGHT_STYLE_IDS, HIGHLIGHT_STYLES, PICKABLE_STYLE_IDS, styleFor, type Palette } from "./styles.ts"

test("every palette reads: the text against its stroke, the text on the bar, and each accent against its own stroke", () => {
  for (const id of PICKABLE_STYLE_IDS) {
    const { palette } = HIGHLIGHT_STYLES[id]
    expect(contrast(palette.text, strokeFor(palette.text)), id).toBeGreaterThanOrEqual(4.5)
    expect(contrast(onSurface(palette.bar), palette.bar), id).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.accent, strokeFor(palette.accent)), id).toBeGreaterThanOrEqual(3)
    expect(contrast(palette.alt, strokeFor(palette.alt)), id).toBeGreaterThanOrEqual(3)
    // the accent and the second colour are colours of their own, not the text's
    expect(palette.accent, id).not.toEqual(palette.text)
    expect(palette.alt, id).not.toEqual(palette.text)
  }
})

test("on every style's bar the accented word can be told from the text beside it", () => {
  for (const id of PICKABLE_STYLE_IDS) {
    const { palette } = HIGHLIGHT_STYLES[id]
    const accent = accentOnBar(palette)
    expect(accent, id).not.toEqual(onSurface(palette.bar))
    expect(contrast(accent, palette.bar), id).toBeGreaterThanOrEqual(3)
    // it is one of the palette's own colours, chosen by the same rule
    expect(accent).toEqual(readableAccent([palette.accent, palette.alt, palette.text], palette.bar, onSurface(palette.bar)))
  }
})

test("custom is a style too: bold-white's font and animation with the palette it is given", () => {
  const palette: Palette = { text: [0, 1, 0], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0, 0, 0] }
  expect(HIGHLIGHT_STYLE_IDS).toContain("custom")
  expect(PICKABLE_STYLE_IDS).not.toContain("custom")
  const style = styleFor("custom", palette)
  expect(style).toMatchObject({ id: "custom", font: "kanit", palette, animation: HIGHLIGHT_STYLES["bold-white"].animation })
  expect(styleFor("headline", palette)).toBe(HIGHLIGHT_STYLES.headline)
  expect(DEFAULT_HIGHLIGHT_OPTIONS.custom).toEqual(HIGHLIGHT_STYLES["bold-white"].palette)
  expect(DEFAULT_HIGHLIGHT_OPTIONS.enabled).toBe(true)
})

test("never needs CapCut Pro for a style's entrance animation", () => {
  for (const style of Object.values(HIGHLIGHT_STYLES)) expect(style.animation.pro).toBe(false)
})
