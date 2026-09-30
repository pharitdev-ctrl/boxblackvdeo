import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { contrast, hexOf, READABLE, rgbOf, WHITE, type Rgb } from "../../highlights/colour.ts"
import { HIGHLIGHT_STYLES, PICKABLE_STYLE_IDS, type Palette } from "../../highlights/styles.ts"
import { motionAssets, motionColours, motionHtml } from "./html.ts"

const rgb = (hex: string): Rgb => rgbOf(hex)!

// the words a graphic can hold that a careless page builder would mistake for its own: replace() patterns, a closing tag, Thai
const FRAGMENT = `<style>.a{animation:pop .4s calc(var(--w2) * 1s) both}</style>
<div class="a">ราคา $& $1 $\` $' &amp; "quoted" </div>
<script>window.frame = (t) => {}</script>`
const palette: Palette = { text: rgb("#ffffff"), accent: rgb("#ffd600"), alt: rgb("#4fc3ff"), bar: rgb("#1a1030") }
const args = {
  html: FRAGMENT,
  stage: { width: 864, height: 768 },
  seconds: 3,
  fps: 30,
  times: [0.15, 1.2, 2.05],
  palette,
  font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" },
  assets: { host: "/*host*/" },
}

/** The declarations of the rule for `selector` in the page's style, or fails the test when there is none. */
function rule(html: string, selector: string): string {
  const found = html.match(new RegExp(`^ *${selector.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")} \\{([^}]*)\\}`, "m"))?.[1]
  expect(found, `the page has no rule for ${selector}`).toBeDefined()
  return found ?? ""
}
/** The value a CSS variable is given in the stage's rule. */
const stageVar = (html: string, name: string) => rule(html, "#stage").match(new RegExp(`--${name}: ([^;]+);`))?.[1]

test("the page carries the content security policy of the design, exactly, ahead of every style and script", () => {
  const html = motionHtml(args)
  const policy = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data: 'self'; img-src data: 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'"
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${policy}">`)
  expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<style>"))
  expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script>"))
  expect(html).toMatch(/^<!doctype html>\n<html lang="th">/)
  expect(html).toContain('<meta charset="UTF-8" />')
})

test("the composition is the stage's size and as long as the graphic, at the render's frame rate; the stage is the one clip in it", () => {
  const html = motionHtml(args)
  expect(html).toContain('<div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="864" data-height="768" data-fps="30">')
  expect(html).toContain('<div id="stage" class="clip" data-start="0" data-duration="3" data-track-index="0">')
  expect(rule(html, "#root, #stage")).toContain("width: 864px; height: 768px;")
  // nothing in it is fixed: another stage, length and frame rate
  const other = motionHtml({ ...args, stage: { width: 1080, height: 900 }, seconds: 3.5, fps: 25 })
  expect(other).toContain('data-duration="3.5" data-width="1080" data-height="900" data-fps="25">')
  expect(other).toContain('data-start="0" data-duration="3.5" data-track-index="0">')
  expect(rule(other, "#root, #stage")).toContain("width: 1080px; height: 900px;")
})

test("the page and its body are transparent and the size of the stage, so what the fragment does not paint is the video", () => {
  const declarations = rule(motionHtml(args), "html, body")
  expect(declarations).toContain("width: 864px; height: 768px;")
  expect(declarations).toContain("overflow: hidden;")
  expect(declarations).toContain("background: transparent;")
  expect(rule(motionHtml(args), "#root, #stage")).toContain("overflow: hidden;")
})

test("the stage sets the words' times as the variables --w1 to --wN, unitless, and the colours a fragment draws with", () => {
  const html = motionHtml(args)
  expect(stageVar(html, "w1")).toBe("0.15")
  expect(stageVar(html, "w2")).toBe("1.2")
  expect(stageVar(html, "w3")).toBe("2.05")
  expect(stageVar(html, "w4")).toBeUndefined()
  // the colours are motionColours' own, and the stage's text is the one that reads on its plate
  const colours = motionColours(palette)
  for (const name of ["ink", "paper", "accent", "alt", "bar", "text"] as const) expect(stageVar(html, name), name).toBe(colours[name])
  expect(rule(html, "#stage")).toContain("color: var(--text);")
  // a time is the plain number it is, whatever its digits
  expect(stageVar(motionHtml({ ...args, times: [0, 0.1234567, 12] }), "w2")).toBe("0.1234567")
  // no words, no variables
  expect(rule(motionHtml({ ...args, times: [] }), "#stage")).not.toContain("--w")
})

test("a script before the fragment declares T, the same times in order, for code to read", () => {
  const html = motionHtml(args)
  const declared = html.match(/<script>(const T = [^<]*)<\/script>/)?.[1]
  expect(declared).toBeDefined()
  // run as the page runs it
  expect(new Function(`${declared}; return T`)()).toEqual([0.15, 1.2, 2.05])
  expect(html.indexOf(declared!)).toBeLessThan(html.indexOf(FRAGMENT))
  expect(html.indexOf(declared!)).toBeGreaterThan(html.indexOf('<div id="stage"'))
  const none = motionHtml({ ...args, times: [] }).match(/<script>(const T = [^<]*)<\/script>/)![1]!
  expect(new Function(`${none}; return T`)()).toEqual([])
})

test("the fragment sits inside the stage exactly as it was given, and the host script comes after it, last in the body", () => {
  const html = motionHtml(args)
  // inserted whole: a page built by replacing a marker would have turned $& and $1 into something else
  const at = html.indexOf(FRAGMENT)
  expect(at).toBeGreaterThan(html.indexOf('<div id="stage"'))
  expect(html.indexOf(FRAGMENT, at + 1)).toBe(-1)
  // the stage and the root close right after it, and only the host follows
  expect(html.slice(at + FRAGMENT.length)).toBe("\n      </div>\n    </div>\n    <script>\n/*host*/\n    </script>\n  </body>\n</html>\n")
  expect(html.match(/<script>/g)).toHaveLength(3)
  expect(html.lastIndexOf("<script>")).toBeGreaterThan(at)
})

test("the font face names the file beside the page, the stage takes it and nothing is faked from it", () => {
  const html = motionHtml(args)
  expect(html).toContain('@font-face { font-family: "Kanit"; src: url("Kanit-ExtraBold.ttf") format("truetype"); }')
  const declarations = rule(html, "#root, #stage")
  expect(declarations).toContain('font-family: "Kanit", sans-serif;')
  expect(declarations).toContain("font-synthesis: none;")
  const mali = motionHtml({ ...args, font: { family: "Mali", file: "Mali-Bold.ttf" } })
  expect(mali).toContain('@font-face { font-family: "Mali"; src: url("Mali-Bold.ttf") format("truetype"); }')
  expect(rule(mali, "#root, #stage")).toContain('font-family: "Mali", sans-serif;')
})

test("nothing in the page around the fragment reaches out: no URL, no script with a source, no link", () => {
  const html = motionHtml({ ...args, html: "" })
  expect(html).not.toMatch(/https?:\/\//)
  expect(html).not.toMatch(/<script[^>]*\ssrc=/)
  expect(html).not.toMatch(/<link\b/)
})

test("the host script is inlined as it was given, whatever characters it holds", () => {
  const html = motionHtml({ ...args, assets: { host: "/* host $& */ window.__x = 1" } })
  expect(html).toContain("\n/* host $& */ window.__x = 1\n    </script>")
})

test("a time that is not a finite number is a bug in the caller: the page is not built, and the error says which word", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expect(() => motionHtml({ ...args, times: [0.15, bad, 2.05] }), String(bad)).toThrow(/the time of word 2 .*finite/)
  }
  // zero and a negative are numbers
  expect(() => motionHtml({ ...args, times: [0, -0.5] })).not.toThrow()
})

test("the other numbers written into the page are finite too", () => {
  for (const over of [{ seconds: Number.NaN }, { fps: Number.POSITIVE_INFINITY }, { stage: { width: Number.NaN, height: 768 } }, { stage: { width: 864, height: Number.NEGATIVE_INFINITY } }]) {
    expect(() => motionHtml({ ...args, ...over }), JSON.stringify(over)).toThrow(/finite/)
  }
})

test("a length, a frame rate or a side of the stage that is zero or negative is a bug in the caller too: the page is not built, and the error says which and that it must be above zero", () => {
  const cases: [what: string, over: object][] = [
    ["the length in seconds", { seconds: 0 }],
    ["the length in seconds", { seconds: -1 }],
    ["the frame rate", { fps: 0 }],
    ["the frame rate", { fps: -30 }],
    ["the stage's width", { stage: { width: 0, height: 768 } }],
    ["the stage's width", { stage: { width: -864, height: 768 } }],
    ["the stage's height", { stage: { width: 864, height: 0 } }],
    ["the stage's height", { stage: { width: 864, height: -1 } }],
  ]
  for (const [what, over] of cases) {
    expect(() => motionHtml({ ...args, ...over }), JSON.stringify(over)).toThrow(new RegExp(`${what} must be a finite number above 0`))
  }
  // small is fine, and so is a length that is not whole
  expect(() => motionHtml({ ...args, seconds: 0.04, fps: 1, stage: { width: 1, height: 1 } })).not.toThrow()
  // the times of the words are not lengths: zero and a negative are still numbers there
  expect(() => motionHtml({ ...args, times: [0, -0.5] })).not.toThrow()
})

test("a font family or file with anything but letters, digits, spaces, dots, dashes and underscores is refused, since both are written into the styles", () => {
  for (const bad of ['Kanit"; } body { display: none', "Kanit'", "a/b.ttf", "../Kanit.ttf", "Kanit\n", "", "Kanit;", "Kanit)", "Kanit\\x"]) {
    expect(() => motionHtml({ ...args, font: { family: bad, file: "Kanit-ExtraBold.ttf" } }), JSON.stringify(bad)).toThrow(/font family/)
    expect(() => motionHtml({ ...args, font: { family: "Kanit", file: bad } }), JSON.stringify(bad)).toThrow(/font file/)
  }
  for (const good of ["Kanit", "Kanit-ExtraBold.ttf", "Noto Sans Thai", "My_Font.v2.otf", "Chonburi-Regular.ttf"]) {
    expect(() => motionHtml({ ...args, font: { family: good, file: good } }), good).not.toThrow()
  }
})

test("motionColours: accent, alt and bar are the style's own colours as hex, the text is its own when it reads on the bar, and paper is white", () => {
  for (const id of PICKABLE_STYLE_IDS) {
    const { palette: own } = HIGHLIGHT_STYLES[id]
    const colours = motionColours(own)
    expect(colours.accent, id).toBe(hexOf(own.accent))
    expect(colours.alt, id).toBe(hexOf(own.alt))
    expect(colours.bar, id).toBe(hexOf(own.bar))
    expect(colours.text, id).toBe(hexOf(own.text))
    expect(colours.paper, id).toBe("#FFFFFF")
  }
  expect(motionColours(palette)).toEqual({ ink: "#1F2227", paper: "#FFFFFF", accent: "#ffd600", alt: "#4fc3ff", bar: "#1a1030", text: "#ffffff" })
})

test("motionColours: ink is the darker of the style's text and #1F2227 against white, so a style whose text is light still gets a dark ink", () => {
  // white text, and warm yellow text: nothing dark of their own
  expect(motionColours(HIGHLIGHT_STYLES["bold-white"].palette).ink).toBe("#1F2227")
  expect(motionColours(HIGHLIGHT_STYLES["sale-yellow"].palette).ink).toBe("#1F2227")
  // bold-black's near-black text is darker than #1F2227 and is the ink
  expect(motionColours(HIGHLIGHT_STYLES["bold-black"].palette).ink).toBe("#111111")
  expect(motionColours({ ...palette, text: rgb("#000000") }).ink).toBe("#000000")
  // a dark text that is lighter than #1F2227 loses to it, and so does one just as dark: the ink is the fixed one
  expect(motionColours({ ...palette, text: rgb("#444444") }).ink).toBe("#1F2227")
  expect(motionColours({ ...palette, text: rgb("#1f2227") }).ink).toBe("#1F2227")
  // whichever wins, no built-in style ends up with an ink that stands out from white less than #1F2227 does
  const floor = contrast(rgb("#1F2227"), WHITE)
  for (const id of PICKABLE_STYLE_IDS) expect(contrast(rgb(motionColours(HIGHLIGHT_STYLES[id].palette).ink), WHITE), id).toBeGreaterThanOrEqual(floor)
})

test("motionColours: the text is the style's own text when it reads on its bar, and black or white, whichever stands out from the bar more, when it does not", () => {
  // every built-in style's text reads on its bar, so all of them keep the text they have
  for (const id of PICKABLE_STYLE_IDS) {
    const { palette: own } = HIGHLIGHT_STYLES[id]
    expect(contrast(own.text, own.bar), id).toBeGreaterThanOrEqual(READABLE)
    expect(motionColours(own).text, id).toBe(hexOf(own.text))
  }
  // white on white, and dark on dark: nothing to read, so the text is what the bar stands out from
  expect(motionColours({ ...palette, text: rgb("#ffffff"), bar: rgb("#ffffff") }).text).toBe("#000000")
  expect(motionColours({ ...palette, text: rgb("#111111"), bar: rgb("#000000") }).text).toBe("#ffffff")
  expect(motionColours({ ...palette, text: rgb("#1a1a1a"), bar: rgb("#111111") }).text).toBe("#ffffff")
  expect(motionColours({ ...palette, text: rgb("#ffe45c"), bar: rgb("#ffffff") }).text).toBe("#000000")
  // just under the line is not read, and just over it is (#949494 on white is 3.03 to 1, #999999 is 2.85)
  expect(motionColours({ ...palette, text: rgb("#999999"), bar: rgb("#ffffff") }).text).toBe("#000000")
  expect(motionColours({ ...palette, text: rgb("#949494"), bar: rgb("#ffffff") }).text).toBe("#949494")
  // a light bar with dark text and a dark bar with light text read, and are kept
  expect(motionColours({ ...palette, text: rgb("#777777"), bar: rgb("#ffffff") }).text).toBe("#777777")
  expect(motionColours({ ...palette, text: rgb("#808080"), bar: rgb("#000000") }).text).toBe("#808080")
  // only the text is changed: the other colours are the style's own, whatever the text does, and so is the ink
  const unreadable = motionColours({ ...palette, text: rgb("#ffffff"), bar: rgb("#ffffff") })
  expect(unreadable).toEqual({ ink: "#1F2227", paper: "#FFFFFF", accent: "#ffd600", alt: "#4fc3ff", bar: "#ffffff", text: "#000000" })
  // and it is the colour the stage takes as its own: the one a fragment writes its words in
  const html = motionHtml({ ...args, palette: { ...palette, text: rgb("#ffffff"), bar: rgb("#ffffff") } })
  expect(stageVar(html, "text")).toBe("#000000")
  expect(stageVar(html, "bar")).toBe("#ffffff")
})

test("motionAssets reads the host script from the folder it is given", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-motion-"))
  await writeFile(join(dir, "host.js"), "/* the host */")
  await expect(motionAssets(dir)).resolves.toEqual({ host: "/* the host */" })
})

test("motionAssets fails loudly when the host is missing, rather than rendering a graphic that never moves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-motion-"))
  await expect(motionAssets(dir)).rejects.toThrow(/host\.js/)
})
