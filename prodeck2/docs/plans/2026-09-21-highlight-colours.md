# M13 · Highlight colours — implementation plan

> Spec: `docs/specs/2026-09-21-highlight-colours-design.md`. TDD: failing test → run → implement → run → mutation check (`scratchpad/mutate.py`).

**Goal:** no highlight text is ever drawn in a colour that cannot be read against its own stroke or bar; the five styles get palettes that look like real creators' captions; groups vary in tone across a clip; the user can set their own four colours.

**Architecture:** a style carries a four-colour palette; every other colour (stroke per range, text on a bar, accent on a bar) is derived by contrast rules in a pure `colour.ts`. The writer takes the palette and derives colours per line and range. A group's `tone` picks which palette colour its lines read in. "custom" is a sixth style whose palette lives in app settings.

---

## Task 1: `highlights/colour.ts`

**Files:** `packages/core/src/highlights/colour.ts` (new), `colour.test.ts` (new)

```ts
export type Rgb = [number, number, number]
export const BLACK: Rgb = [0, 0, 0]
export const WHITE: Rgb = [1, 1, 1]
/** WCAG 2.1 relative luminance of a colour with channels 0–1. */
export function luminance([r, g, b]: Rgb): number
/** WCAG contrast ratio, 1–21. */
export function contrast(a: Rgb, b: Rgb): number
/** Black or white, whichever the fill stands out from more. */
export function strokeFor(fill: Rgb): Rgb
/** Black or white text for a surface of this colour. */
export const onSurface = strokeFor
/** `wanted` when it reads on `surface` (≥ 3:1), else `fallback`. */
export function readableAccent(wanted: Rgb, surface: Rgb, fallback: Rgb): Rgb
export const hexOf = (c: Rgb) => "#rrggbb"
export const rgbOf = (hex: string) => Rgb | null   // "#RRGGBB" only
```

Tests: white/black contrast 21; `contrast(WHITE, [1, 0.878, 0])` ≈ 1.3; `strokeFor(WHITE)` black, `strokeFor([0.07,0.07,0.07])` white, `strokeFor([1, 0.56, 0.69])` (pink) black; `readableAccent(pink, pink-bar, black)` black; `readableAccent(red, yellow-bar, black)` red? (contrast(#E63946, #F7C204) ≈ 3.2 → red); hex round-trips; bad hex → null.

## Task 2: palettes in `styles.ts`, guard test

**Files:** `packages/core/src/highlights/styles.ts`, `styles.test.ts` (new), `highlights/index.ts`

- `export interface Palette { text: Rgb; accent: Rgb; alt: Rgb; bar: Rgb }`
- `HighlightStyle`: `id, name, mood, font, strokeWidth, barRoundness, palette, animation` (drop fill/stroke/accent/bar).
- `HIGHLIGHT_STYLE_IDS = ["bold-white", "bold-black", "sale-yellow", "cute-pink", "headline", "custom"]`; `PICKABLE_STYLE_IDS` = the first five; `HIGHLIGHT_STYLES` keyed by the five (custom has no entry; its font/animation/strokeWidth/roundness come from bold-white).
- `export function styleFor(id: HighlightStyleId, custom: Palette): HighlightStyle` — custom → `{ ...HIGHLIGHT_STYLES["bold-white"], id: "custom", name: "กำหนดเอง", palette: custom }`.
- `HighlightOptions.custom: Palette`, default = bold-white's palette. `DEFAULT_HIGHLIGHT_OPTIONS` updated.
- Palettes per the spec table.

Guard test: for every style, `contrast(text, strokeFor(text)) ≥ 4.5`, `contrast(onSurface(bar), bar) ≥ 4.5`, `contrast(accent, strokeFor(accent)) ≥ 3`, `contrast(alt, strokeFor(alt)) ≥ 3`, `readableAccent(accent, bar, …) !== onSurface(bar)` for at least four styles (an accent that reads on the bar).

## Task 3: tone in the look (`flair/plan.ts`, `flair/direct.ts`)

- `export const TONES = ["base", "accent", "alt"] as const; export type Tone`. `GroupLook.tone: Tone`; `DEFAULT_LOOK.tone = "base"`.
- `enforce`: a tone run longer than `MAX_RUN` falls to "base" (counted like patterns; edited looks count but are returned untouched); an unknown tone → "base".
- `FlairReplySchema.groups[].tone: z.enum(TONES).default("base")`; `acceptFlair` copies it. Prompt: a "โทนสี" paragraph; `FLAIR_PROMPT_VERSION = "flair-2026-09-21-tones"`.
- Tests: plan.test (run of four accents → fourth base; edited kept), direct.test (tone accepted; prompt names the tones; missing tone → base).

## Task 4: the writer derives colours (`capcut/highlights.ts`)

- `HighlightLook = { fontPath; strokeWidth; barRoundness; palette: Palette; animation }`.
- `TimelineHighlightLine.tone?: Tone` (default base).
- `textMaterial`: `lineColour = onBar ? onSurface(palette.bar) : palette[tone === "base" ? "text" : tone]`; `accentColour = onBar ? readableAccent(palette.accent, palette.bar, readableAccent(palette.alt, palette.bar, onSurface(palette.bar))) : tone === "accent" ? palette.alt : palette.accent`; each range's stroke = `strokeFor(range.color)`, width `look.strokeWidth`; bars keep no stroke. `border_color` = first range's stroke. Bar colour = `palette.bar`, roundness `look.barRoundness`.
- Tests: white line → black stroke; black line (bold-black) → white stroke; a pink accent word on white text gets a black stroke of its own while the base ranges keep theirs; tone "accent" line reads in the accent colour with the alt as its accented word; bar text is black on a yellow bar and white on a black bar; accent on a pink bar falls back when it cannot read.

## Task 5: main — settings, style in force, write, api, look patch

- `settings.ts`: `highlights.custom` read through `palette(raw, fallback)` (four `[r,g,b]` arrays of numbers in 0..1, else fallback); patch replaces the whole palette.
- `timeline.ts`: `const style = styleFor(styleInForce(stored.highlights), settings.highlights.custom)`; look = `{ fontPath, strokeWidth, barRoundness, palette, animation }`; each line gets `tone: look.tone` from its group look.
- `highlights.ts`: font from `styleFor(...)`; `setStyle` accepts custom; `pick` unchanged (schema already limits Claude).
- `highlight-api.ts`: `setHighlightStyle` accepts custom; `setFlairLook` validates `tone ∈ TONES`.
- `flair.ts setLook`: `tone: patch.tone ?? look.tone`.
- Tests: settings.test (custom palette kept, bad values fall back, patch replaces), highlight-api.test (tone + custom pass, bad tone refused), flair.test ("a custom palette from settings is what the write draws with" — set `highlights.custom` with a green text, write, read the text material's fill), plan run rule already core.

## Task 6: renderer

- `ClipSettingsSheet` highlights tab: after the style Select, `<Swatches palette={...} />` (four `.swatch` spans with `aria-label` "ตัวหนังสือ/คำเน้น/สีที่สอง/แถบ" and `title` hex); when `props.style.value === "custom"`, four `<input type="color">` labelled the same, `onChange` → `props.onHighlights({ ...highlights, custom: { ...custom, [role]: rgbOf(value) } })`. The sheet needs `custom` from `highlights.custom`.
- `LookPopover`: `Group "โทนสี"` Segmented over TONES.
- `FlairLookPatch.tone?: Tone`.
- i18n: `highlights.style.custom`, `highlights.swatch.text/accent/alt/bar`, `flair.tone`, `flair.tone.base/accent/alt`.
- Tests (EditScreen.test): the sheet shows four swatches for the style in force; choosing "กำหนดเอง" shows colour inputs and changing one saves `highlights.custom`; the look popover saves a tone.

## Outcome (2026-09-21)

Done as planned, TDD with mutation checks on `colour.ts`, `styles.ts`, `plan.ts`, `direct.ts`, `capcut/highlights.ts`, `settings.ts` and `ClipSettingsSheet.tsx` — no survivors, except one equivalent mutant (the sheet's `rgbOf` null guard: a colour input never yields a bad value in a browser). 1,008 tests pass, typecheck clean.

What the work turned up:

- The palettes were tuned against the rules before they were written down: a bar colour has to let *some* palette colour read on it as an accent that is not the bar's own text colour, which is why bold-white's bar became blue (`#1d4ed8`, yellow accent reads on it), sale-yellow's bar a darker red (`#c1121f`, white text, the yellow text colour serves as the accent) and cute-pink's a deeper pink (`#e75480`, black text, white accent). A pastel bar could not carry any accent at all.
- The stroke is chosen by contrast alone, so a pure red gets a black stroke (5.0:1 beats white's 4.2:1). It reads; it is not always what a designer would pick by eye.
- `SpeechSlot`-style splitting again: `Palette` is what the renderer, settings and writer share; `HighlightStyle` still carries font, animation, stroke width and bar roundness per style, and `custom` borrows bold-white's.
- The old layout test that checked bar colours by a linear luminance difference went; `styles.test.ts` checks every palette with the real WCAG rule.

Checked in the real app on 0917: the sheet shows the four dots of the style in force (`ขาวสะอาด (AI เลือก)` → `#ffffff #f7c204 #8fd3ff #1d4ed8`), choosing กำหนดเอง swaps them for four colour inputs preloaded with bold-white's palette, choosing พาสเทลชมพู shows `#ffffff #ff8fb1 #ffd166 #e75480`, and the look popover has the โทนสี row. A real write in พาสเทลชมพู with "นักบินอวกาศ" accented, read back from `draft_info.json`: the pink accent range `(1, 0.561, 0.694)` carries a **black** stroke — the exact case that was a pink blob before — white ranges carry black strokes, bar text is black on `#e75480` pill bars, and an all-accent line on a bar is white. The style was put back to ขาวสะอาด and the draft restored from the write's own backup.

Not seen: the result inside CapCut itself (no way to look from here); the user judges the palettes by eye there.

## Task 7: docs, DMG, and a written 0917 read back

- Write 0917 with `cute-pink` and an accented word through the real app (backup, restore after) and read `draft_info.json` back: the accent range's stroke is black, not pink.
- Master spec M13 entry; plan Outcome; memory.
