import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { contrast, hexOf, onSurface, READABLE, rgbOf, WHITE } from "../../highlights/colour.ts"
import type { Palette } from "../../highlights/styles.ts"

/** The script inlined into every page, which lets the renderer draw the page at any time. */
export interface MotionAssets {
  /** host.js: a timeline that sets the time of every CSS animation and Web Animation on the page, and calls window.frame with it if the fragment sets one */
  host: string
}

/**
 * The host as the app ships it (Resources/graphics): its file lives with the app, not beside this module,
 * because core is bundled into the app and files next to a module would not ship. Read once and handed to every
 * `motionHtml`; a folder without it fails here, where it can be told, rather than render graphics that never move.
 */
export async function motionAssets(dir: string): Promise<MotionAssets> {
  return { host: await readFile(join(dir, "host.js"), "utf8") }
}

/** The dark a graphic outlines and fills its dark shapes with, unless the style's own text is darker. */
const INK = "#1F2227"
const PAPER = "#FFFFFF"

/**
 * The colours a fragment draws with, as hex: the style's accent, second colour and bar as they are; the text to
 * put on the bar, which is the style's own text when that reads on the bar and otherwise black or white, whichever
 * stands out from the bar more (the rule the highlights follow), so a fragment that writes its
 * words on its bar is always readable; white; and an ink, for outlines and dark shapes, which is the style's text
 * when that is darker than #1F2227 against white (bold-black's) and #1F2227 otherwise, so a style whose text is
 * white or yellow still gets a dark ink.
 */
export function motionColours(palette: Palette): { ink: string; paper: string; accent: string; alt: string; bar: string; text: string } {
  const own = contrast(palette.text, WHITE) > contrast(rgbOf(INK)!, WHITE)
  const reads = contrast(palette.text, palette.bar) >= READABLE
  return { ink: own ? hexOf(palette.text) : INK, paper: PAPER, accent: hexOf(palette.accent), alt: hexOf(palette.alt), bar: hexOf(palette.bar), text: hexOf(reads ? palette.text : onSurface(palette.bar)) }
}

/**
 * The page's policy. It stops the page loading anything from a URL (scripts, styles, pictures, fonts, frames,
 * media), making a connection (fetch, XMLHttpRequest, WebSocket, beacons), submitting a form anywhere, and
 * moving where its addresses point with a base. Styles and scripts are inline; a font or a picture may be a data
 * address (HyperFrames embeds the font as one) or a file beside the page. Inline scripts, and the inline handlers
 * the same word allows, are permitted, since the page is made of them: script-src 'unsafe-inline' cannot tell the
 * fragment's script from the host's. It does not stop navigation: a meta refresh, a link followed, a change of
 * location or a window opened takes the page elsewhere whatever a policy says. The linter refuses the plain ways to
 * do any of those, not every way: code can be written in more ways than any list of names holds. The guard that
 * holds is the render's own Chrome, which has no route off this machine and opens no new window; the policy and
 * the linter are what keep a graphic from trying.
 */
const POLICY = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data: 'self'; img-src data: 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'"

/** What a font family or file name may be, since both are written into the page's styles: no quote, bracket, slash or line break. */
const FONT_NAME = /^[\w .-]+$/

/** A number written into the page is finite, or the caller has a bug: a NaN or an Infinity would be written into the page as text. */
function finite(what: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`motionHtml: ${what} must be a finite number, not ${value}`)
}

/** A size, a length or a rate is finite and above zero, or the caller has a bug: a stage with no width or a graphic with no length draws nothing. */
function positive(what: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`motionHtml: ${what} must be a finite number above 0, not ${value}`)
}

/**
 * One HyperFrames composition for one motion graphic, everything inline but the font file, which sits next to
 * it. The stage is transparent, `stage` pixels across, and carries the fragment as it is with the colours and
 * the times of the words said while it plays as CSS variables (`--w1`, `--w2` … in seconds, no unit) and as
 * the array `T`; the host script comes last and hands the renderer its timeline. The fragment is not checked
 * here (`lintFragment` does that); the numbers and the font names are, since they are written into the page:
 * a time that is not finite, a size, length or frame rate that is not finite and above zero, or a font name with
 * anything but letters, digits, spaces, dots, dashes and underscores in it, throws.
 */
export function motionHtml(args: {
  html: string
  stage: { width: number; height: number }
  seconds: number
  fps: number
  times: number[]
  palette: Palette
  font: { family: string; file: string }
  assets: MotionAssets
}): string {
  const { html, stage, seconds, fps, times, palette, font, assets } = args
  for (const [what, value] of [["the stage's width", stage.width], ["the stage's height", stage.height], ["the length in seconds", seconds], ["the frame rate", fps]] as const) positive(what, value)
  times.forEach((time, i) => finite(`the time of word ${i + 1}`, time))
  if (!FONT_NAME.test(font.family)) throw new Error(`motionHtml: the font family ${JSON.stringify(font.family)} may hold only letters, digits, spaces, dots, dashes and underscores`)
  if (!FONT_NAME.test(font.file)) throw new Error(`motionHtml: the font file ${JSON.stringify(font.file)} may hold only letters, digits, spaces, dots, dashes and underscores`)
  const colours = motionColours(palette)
  const declarations = [
    ...times.map((time, i) => `--w${i + 1}: ${time};`),
    ...(["ink", "paper", "accent", "alt", "bar", "text"] as const).map((name) => `--${name}: ${colours[name]};`),
    "color: var(--text);",
  ].join(" ")
  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${POLICY}">
    <style>
      @font-face { font-family: "${font.family}"; src: url("${font.file}") format("truetype"); }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${stage.width}px; height: ${stage.height}px; overflow: hidden; background: transparent; }
      #stage { ${declarations} }
      #root, #stage { position: relative; width: ${stage.width}px; height: ${stage.height}px; font-family: "${font.family}", sans-serif; font-synthesis: none; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${seconds}" data-width="${stage.width}" data-height="${stage.height}" data-fps="${fps}">
      <div id="stage" class="clip" data-start="0" data-duration="${seconds}" data-track-index="0">
<script>const T = ${JSON.stringify(times)}</script>
${html}
      </div>
    </div>
    <script>
${assets.host}
    </script>
  </body>
</html>
`
}
