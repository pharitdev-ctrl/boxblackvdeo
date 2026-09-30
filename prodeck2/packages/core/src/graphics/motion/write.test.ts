import { expect, test } from "vitest"
import { TEXT_REPLY } from "../../llm/text-reply.ts"
import type { LlmRequest, LlmTransport } from "../../llm/types.ts"
import { allFixtures, fixture } from "./fixtures/index.ts"
import { lintFragment } from "./lint.ts"
import { editBrief, fragmentOf, MOTION_CONTRACT, MOTION_WRITE_PROMPT_VERSION, motionBrief, repairBrief, writeMotion } from "./write.ts"

const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** The part of the contract under one heading: from the bold words that open it to the next heading. */
function section(heading: string): string {
  const start = MOTION_CONTRACT.indexOf(`\n**${heading}`)
  if (start < 0) throw new Error(`the contract has no section that opens with "${heading}"`)
  const end = MOTION_CONTRACT.indexOf("\n**", start + 1)
  return MOTION_CONTRACT.slice(start + 1, end < 0 ? undefined : end)
}
/** Everything a text names between backticks, as the contract names tags, attributes and names in code. */
const named = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((found) => found[1]!)
/** What the linter says about a fragment, as one text. */
const said = (html: string) => lintFragment(html).join("\n")

// the contract

test("the contract opens with its title and what to return, has its six sections in order, and goes by its version", () => {
  expect(MOTION_WRITE_PROMPT_VERSION).toBe("motion-write-2026-10-01")
  expect(MOTION_CONTRACT.startsWith("# Contract for one free-form motion graphic\n\nYou write ONE HTML fragment, in exactly this order: one `<style>` block first, then markup, then (optionally) one plain `<script>` block as the very last thing. Return only the fragment, with no code fence and no explanation.\n")).toBe(true)
  const headings = MOTION_CONTRACT.split("\n").flatMap((line) => /^\*\*([^*]+)\*\*/.exec(line)?.[1] ?? [])
  expect(headings).toEqual(["Shape, checked by a linter that refuses anything else.", "The script, when there is one.", "Where it goes.", "Time.", "Words are variables.", "Look."])
})

test("the contract says what a fragment is made of, and what it may not hold", () => {
  const shape = section("Shape")
  // one style first, one plain script last
  expect(shape).toContain("- Exactly one `<style>` (no attributes) first, then the markup, then at most one `<script>` (no attributes); nothing after `</script>`.\n")
  expect(shape).toContain("- Nothing is loaded: no external files, no URLs, no `src` or `srcset`, no `@import`.")
  expect(shape).toContain("- No HTML comments (`<!-- -->`) and no other `<!…>` or `<?…>`. A CSS `/* */` comment is fine, one line at most.\n")
  expect(shape).toContain("- No inline event handlers (`onload=`, `onclick=` …): code goes in the script block.\n")
  expect(shape).toContain("- No SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`): the renderer cannot seek them.")
  const script = section("The script")
  expect(script).toContain("- `T` is given to you by the page: do not declare anything named `T`.\n")
  expect(script).toContain("- The script runs once, where it stands, after the markup:")
  expect(section("Where it goes")).toContain("The fragment is placed inside a transparent stage `W × H` CSS pixels (given below)")
})

test("the contract says how a fragment moves: CSS animations and Web Animations only, no timers, window.frame for what is worked out each frame, and gone at D", () => {
  const time = section("Time")
  expect(time).toContain("The graphic lasts `D` seconds (given). Time 0 is when it appears.\n")
  expect(time).toContain('- Animate ONLY with CSS animations (`animation:` with `@keyframes`) and/or the Web Animations API (`el.animate(keyframes, { duration, delay, fill: "both", easing })`).')
  // an entrance fills both ways; an exit of the same property fills forwards, or goes on a wrapping element, since the host reports one that fills backwards over the entrance
  expect(time).toContain("Every animation runs once, with an absolute delay measured from time 0, and an element's entrance uses `animation-fill-mode: both`. When one element has an entrance and an exit (two animations of the same property), the exit uses `animation-fill-mode: forwards` (in script `fill: \"forwards\"`), since with `both` its first frame applies before it starts and hides the entrance; or put the exit on a wrapping element.\n")
  expect(time).not.toContain("Every animation runs once, with an absolute delay measured from time 0, and `animation-fill-mode: both`.")
  expect(time).toContain("So: NO `requestAnimationFrame`, NO `setTimeout`/`setInterval`, NO `Date`/`performance.now`, NO `Math.random`, NO transitions triggered by class changes, NO `<canvas>`, video or audio.\n")
  expect(time).toContain("set `window.frame = (t) => { ... }` where `t` is seconds from 0; it must draw the same thing for the same `t`.\n")
  // the last frame drawn is one frame before D, so the way out is over a little before it
  expect(time).toContain("- The way out must be over, with the whole graphic fully invisible, by 0.1 s before `D` (the last frame drawn is just before `D`, and whatever it still shows is cut off hard). Leave about the last 0.4 s for the way out.")
  expect(time).toContain("by 0.1 s before `D`")
})

test("the contract gives the words as variables, in the brief's order, and the colours as variables", () => {
  const words = section("Words are variables")
  expect(words).toContain("The times are given to the page as CSS variables `--w1`, `--w2`, … (seconds, unitless, in the order listed) and as the array `T` in script (`T[0]` is the first word).\n")
  expect(words).toContain("- Every delay that depends on a word MUST be written from its variable, never as a typed number: `animation-delay: calc(var(--w2) * 1s - 0.3s)`, or `animation: pop .4s calc(var(--w3) * 1s - .25s) both`, or in script `delay: T[1] * 1000 - 300`.\n")
  const look = section("Look")
  expect(look).toContain("- Colours come from variables: `var(--ink)` (dark outline and dark shapes), `var(--paper)` (white), `var(--accent)` (the main accent), `var(--alt)` (second colour), `var(--bar)` and `var(--text)` (a plate and the text that is readable on it).")
  expect(look).toContain("- Text is Thai.")
  // the last section runs to the end of the contract
  expect(MOTION_CONTRACT.endsWith(look)).toBe(true)
})

// the contract and the linter, which must not drift apart

test("every fragment written by a real call under the contract passes the linter", () => {
  const all = allFixtures()
  expect(all).toHaveLength(15)
  for (const { name, html } of all) expect(lintFragment(html), name).toEqual([])
})

/** One fragment that uses everything the contract offers, written the way the contract says to write it. */
const OFFERED = `<style>
/* one plate, one number, one path */
.plate{position:absolute;left:40px;top:40px;padding:12px 28px;border-radius:18px;background:var(--bar);color:var(--text);font-size:56px;animation:pop .4s calc(var(--w3) * 1s - .25s) both}
.num{position:absolute;left:40px;top:200px;font-size:96px;color:var(--accent);-webkit-text-stroke:10px var(--ink);paint-order: stroke fill;animation-name:pop;animation-duration:.4s;animation-delay: calc(var(--w2) * 1s - 0.3s);animation-fill-mode: both}
.tint{fill:color-mix(in srgb, var(--alt) 60%, var(--paper))}
.ring{transform-box: fill-box; transform-origin: center;animation:pop .4s calc(var(--w1) * 1s) both}
.cut{clip-path:url(#cut)}
.all{animation:out .3s 3.1s both}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@keyframes out{to{opacity:0}}
</style>
<div class="all">
  <div class="plate"><span id="label">ถูกกว่า 1 &lt; 2</span></div>
  <div class="num" id="num">0</div>
  <svg id="art" width="1080" height="700" viewBox="0 0 1080 700">
    <defs><clipPath id="cut"><rect width="1080" height="700"/></clipPath><circle id="dot" r="14"/></defs>
    <g class="cut">
      <g transform="translate(540 420)"><g class="ring"><circle class="tint" r="60" stroke="var(--ink)" stroke-width="8"/></g></g>
      <path id="way" d="M80 600 Q540 200 1000 600" fill="none" stroke="var(--ink)" stroke-width="8"/>
      <use href="#dot" id="runner" fill="var(--accent)"/>
    </g>
  </svg>
</div>
<script>
const art = document.getElementById("art"), way = art.querySelector("#way"), runner = document.querySelector("#runner");
const num = document.getElementById("num");
const NS = "http://www.w3.org/2000/svg";
const spot = document.createElementNS(NS, "circle");
spot.setAttribute("r", "10");
spot.setAttribute("fill", "var(--alt)");
art.appendChild(spot);
const past = document.createElement("span");
past.textContent = "ก่อน";
past.style.opacity = "0";
document.querySelector(".plate").appendChild(past);
const steps = document.querySelectorAll(".ring");
const launch = (el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: T[1] * 1000 - 300, fill: "both", easing: "ease-out" });
steps.forEach((el) => launch(el));
const length = way.getTotalLength();
window.frame = (t) => {
  const p = way.getPointAtLength(length * Math.min(1, t / T[0]));
  runner.setAttribute("x", String(p.x));
  runner.setAttribute("y", String(p.y));
  num.textContent = String(Math.round(28000 * Math.min(1, t / T[2])));
};
</script>`

/** What the contract offers a fragment, in the contract's own words, and where the fragment above uses each. */
const ALLOWED: [says: string, ...uses: string[]][] = [
  // under "Shape"
  ["The markup is `<div>`, `<span>` and inline `<svg>` with its shapes.", '<div class="all">', '<span id="label">', '<svg id="art"'],
  ['`href="#id"` (as in `<use href="#id">`) and `url(#id)` point at a shape in the fragment and are fine.', '<use href="#dot"', "clip-path:url(#cut)"],
  ["A CSS `/* */` comment is fine", "/* one plate, one number, one path */"],
  ["a less-than sign in text is `&lt;`", "1 &lt; 2"],
  // under "The script"
  ["`document.getElementById`", 'document.getElementById("art")'],
  ["`querySelector`", 'art.querySelector("#way")', 'document.querySelector("#runner")'],
  ["`querySelectorAll`", 'document.querySelectorAll(".ring")'],
  ["`document.createElementNS`", 'document.createElementNS(NS, "circle")'],
  ["`document.createElement`", 'document.createElement("span")'],
  ["`setAttribute`", 'spot.setAttribute("r", "10")'],
  ["`appendChild`", "art.appendChild(spot)"],
  ["`textContent`", 'past.textContent = "ก่อน"'],
  ["`style`", 'past.style.opacity = "0"'],
  ["`el.animate()`", "el.animate([{ opacity: 0 }"],
  ["`getTotalLength()`", "way.getTotalLength()"],
  ["`getPointAtLength()`", "way.getPointAtLength("],
  ["`Math` (without `Math.random`)", "Math.round(", "Math.min("],
  ["and `window.frame`.", "window.frame = (t) => {"],
  ["Build shapes with `createElementNS` and `setAttribute`", "document.createElementNS(NS,", 'spot.setAttribute("fill"'],
  ['reuse a shape with `<use href="#id">` in the markup', '<use href="#dot" id="runner"'],
  ["You need `window` only for `window.frame`.", "window.frame = "],
  ["Say `spot`, `past`, `steps`, `launch`.", "const spot = ", "const past = ", "const steps = ", "const launch = "],
  ["- `T` is given to you by the page", "T[0]", "T[2]"],
  // under "Time"
  ["`animation:` with `@keyframes`", "animation:pop .4s", "@keyframes pop{"],
  ['`el.animate(keyframes, { duration, delay, fill: "both", easing })`', '{ duration: 400, delay: T[1] * 1000 - 300, fill: "both", easing: "ease-out" }'],
  ["`animation-fill-mode: both`", "animation-fill-mode: both"],
  ["`window.frame = (t) => { ... }`", "window.frame = (t) => {"],
  // under "Words are variables"
  ["`animation-delay: calc(var(--w2) * 1s - 0.3s)`", "animation-delay: calc(var(--w2) * 1s - 0.3s)"],
  ["`animation: pop .4s calc(var(--w3) * 1s - .25s) both`", "animation:pop .4s calc(var(--w3) * 1s - .25s) both"],
  ["`delay: T[1] * 1000 - 300`", "delay: T[1] * 1000 - 300"],
  // under "Look"
  ["`-webkit-text-stroke` with `paint-order: stroke fill`", "-webkit-text-stroke:10px var(--ink)", "paint-order: stroke fill"],
  ["`var(--ink)` (dark outline and dark shapes), `var(--paper)` (white), `var(--accent)` (the main accent), `var(--alt)` (second colour), `var(--bar)` and `var(--text)`", "var(--ink)", "var(--paper)", "var(--accent)", "var(--alt)", "var(--bar)", "var(--text)"],
  ["except a tint made with `color-mix()` from these", "color-mix(in srgb, var(--alt) 60%, var(--paper))"],
  ['place with an outer `<g transform="translate(x y)">` and animate an inner `<g>`', '<g transform="translate(540 420)"><g class="ring">'],
  ["set `transform-box: fill-box; transform-origin: center` on it", "transform-box: fill-box; transform-origin: center"],
]

test("what the contract offers a fragment passes the linter: one fragment that uses all of it", () => {
  for (const [says, ...uses] of ALLOWED) {
    expect(MOTION_CONTRACT, says).toContain(says)
    expect(uses.length, says).toBeGreaterThan(0)
    for (const use of uses) expect(OFFERED, `${says}: ${use}`).toContain(use)
  }
  expect(lintFragment(OFFERED)).toEqual([])
  // written as the contract says to write a script: with no comments in it, and the window named only for window.frame
  const script = OFFERED.slice(OFFERED.indexOf("<script>"))
  expect(script.replaceAll("http://www.w3.org/2000/svg", "")).not.toMatch(/\/\/|\/\*/)
  expect(script.match(/window/g)).toEqual(["window"])
})

test("every name the contract lists as enough for any graphic is one the fragment above uses", () => {
  const enough = section("The script").split("\n").find((line) => line.startsWith("- This is enough for any graphic: "))
  expect(enough).toBeDefined()
  const offered = new Set(ALLOWED.flatMap(([says]) => named(says)))
  expect(named(enough!).filter((term) => !offered.has(term))).toEqual([])
  expect(named(enough!)).toEqual(expect.arrayContaining(["document.getElementById", "el.animate()", "window.frame"]))
})

/** A fragment that moves and holds nothing else the rules mind: the shape to change one thing in. */
const MOVING = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div>`
/** The moving fragment with more markup after it. */
const markup = (html: string) => `${MOVING}${html}`
/** The moving fragment with more rules in its one style block. */
const css = (rules: string) => MOVING.replace("</style>", `${rules}</style>`)
/** The moving fragment with a script at its end. */
const code = (script: string) => `${MOVING}<script>${script}</script>`
/** A script that does nothing the rules mind, for the fragments that are about where a script stands. */
const FRAME = "window.frame = (t) => {}"

/** What the contract forbids and the linter enforces: the contract's own words, a small fragment that does it, and what the linter's problem says of it. */
type Refused = [says: string, fragment: string, problem: string]

/** A tag the contract names as one a fragment may not have. */
const tag = (name: string, fragment = markup(`<${name}>`)): Refused => [`\`<${name}>\``, fragment, `uses \`<${name}>\``]
/** Something the contract refuses in code, in a script that does it. */
const inCode = (says: string, script: string, problem: string): Refused => [says, code(script), problem]

const REFUSED_IN_SHAPE: Refused[] = [
  // one style first, one plain script last
  ["- Exactly one `<style>` (no attributes) first", `<div class="a">ก</div>${MOVING}`, 'starts with `<div class="a">ก</div><style>.` instead of a plain `<style>` block'],
  ["- Exactly one `<style>` (no attributes) first", `${MOVING}<style>.b{color:red}</style>`, "has 2 `<style` tags, but a fragment has just one style block"],
  ["- Exactly one `<style>` (no attributes) first", MOVING.replace("<style>", '<style media="all">'), 'starts with `<style media="all">.a{animatio` instead of a plain `<style>` block'],
  ["then at most one `<script>` (no attributes)", `${code(FRAME)}<script>${FRAME}</script>`, "has 2 `<script` tags, but a fragment has at most one script"],
  ["then at most one `<script>` (no attributes)", `${MOVING}<script type="module">${FRAME}</script>`, 'has `<script type="module">` for its script, which must have no attributes'],
  ["nothing after `</script>`", `${code(FRAME)}<div>ข</div>`, "ends with `</script><div>ข</div>` instead of a plain `</script>` as the very last thing"],
  // the tags it may not have
  tag("html"),
  tag("head"),
  tag("body"),
  tag("meta"),
  tag("link"),
  tag("base"),
  tag("form"),
  tag("iframe"),
  tag("object"),
  tag("embed"),
  tag("img"),
  tag("video"),
  tag("audio"),
  tag("canvas"),
  tag("template"),
  tag("textarea"),
  tag("noscript"),
  tag("title"),
  ["and no `<title>` (not inside an SVG either)", markup("<svg><title>จรวด</title></svg>"), "uses `<title>`"],
  // nothing is loaded
  ["no external files, no URLs", markup('<svg><use href="sprites.svg#a"></use></svg>'), 'has `href="sprites.svg#a"`: nothing can be loaded from a URL or a file'],
  ["no external files, no URLs", markup('<svg><use href="https://example.com/a.svg#a"></use></svg>'), 'has `href="https://example.com/a.svg#a"`: nothing can be loaded from a URL or a file'],
  ["no external files, no URLs", css(".b{background:url(a.png)}"), "has `url(a.png)`: url() may only point at a shape in the fragment"],
  ["no `src` or `srcset`", markup('<svg><use src="#a"></use></svg>'), 'has `src="#a"`: nothing can be loaded into src or srcset'],
  ["no `src` or `srcset`", markup('<svg><use srcset="a.png 2x"></use></svg>'), 'has `srcset="a.png 2x"`: nothing can be loaded into src or srcset'],
  ["no `@import`", css('@import "a.css";'), "uses `@import`"],
  // comments, declarations and instructions
  ["- No HTML comments (`<!-- -->`)", markup("<!-- a note -->"), "has an HTML comment (`<!--`): no HTML comments; a CSS /* */ comment is fine"],
  ["and no other `<!…>` or `<?…>`", markup("<!doctype html>"), "has `<!doctype ht` where no tag starts"],
  ["and no other `<!…>` or `<?…>`", markup('<?xml version="1.0"?>'), "has `<?xml versio` where no tag starts"],
  // tags written plainly
  ["with no `<` or `>` inside a value", markup('<div title="1<2">ข</div>'), 'has `<div title="1<2">` that the check cannot read'],
  ["with no `<` or `>` inside a value", markup('<div title="2>1">ข</div>'), 'has `<div title="2>1">` that the check cannot read'],
  ["a less-than sign in text is `&lt;`", markup("<div>1 < 2</div>"), "has `< 2</div>` where no tag starts: write &lt; for a less-than sign in text"],
  ["Close every `<svg>` before the script.", `${MOVING}<svg><circle r="4"/><script>${FRAME}</script>`, "has an `<svg>` that is never closed"],
  // handlers
  ["- No inline event handlers (`onload=`, `onclick=` …)", markup('<svg onload="1"></svg>'), "has the event handler `onload`: no inline event handlers"],
  ["- No inline event handlers (`onload=`, `onclick=` …)", markup('<div onclick="1">ข</div>'), "has the event handler `onclick`: no inline event handlers"],
  // SMIL
  tag("animate", markup('<svg><circle r="4"><animate attributeName="opacity" to="0" dur="1s"/></circle></svg>')),
  tag("animateTransform", markup('<svg><g><animateTransform attributeName="transform" type="rotate" to="90" dur="1s"/></g></svg>')),
  tag("animateMotion", markup('<svg><g><animateMotion dur="1s" path="M0 0L9 9"/></g></svg>')),
  tag("set", markup('<svg><circle r="4"><set attributeName="opacity" to="0"/></circle></svg>')),
]

const NOT_NAMED = "- Do not name a variable or a function `location`, `history`, `navigation`, `navigator` or `open`"

const REFUSED_IN_THE_SCRIPT: Refused[] = [
  // a refused name is refused wherever it is written
  inCode("a refused name is refused inside a string or a comment too", `const word = "fetch"; ${FRAME}`, "uses `fetch`"),
  inCode("a refused name is refused inside a string or a comment too", `// not a fetch\n${FRAME}`, "uses `fetch`"),
  inCode("`Math` (without `Math.random`)", "const r = Math.random()", "uses `Math.random`"),
  // nothing that loads, sends, stores, navigates, clicks, or makes code or markup from text
  inCode("no `fetch`", 'fetch("#a")', "uses `fetch`"),
  inCode("`import`", 'import("./a.js")', "uses `import`"),
  inCode("`eval`", 'eval("1 + 1")', "uses `eval`"),
  inCode("`Function`", 'const f = Function("return 1")', "uses `Function`"),
  inCode("`Function`", 'const f = new Function("return 1")', "uses `new Function`"),
  inCode("workers or `postMessage`", 'new Worker("a.js")', "uses `Worker`"),
  inCode("workers or `postMessage`", 'new SharedWorker("a.js")', "uses `SharedWorker`"),
  inCode("workers or `postMessage`", "const w = ServiceWorker", "uses `ServiceWorker`"),
  inCode("workers or `postMessage`", 'postMessage("x", "*")', "uses `postMessage`"),
  inCode("storage or cookies", 'localStorage.setItem("a", "b")', "uses `localStorage`"),
  inCode("storage or cookies", 'sessionStorage.getItem("a")', "uses `sessionStorage`"),
  inCode("storage or cookies", 'indexedDB.open("a")', "uses `indexedDB`"),
  inCode("storage or cookies", 'document.cookie = "a=b"', "uses `document.cookie`"),
  inCode("`navigator`", "const agent = navigator.userAgent", "uses `navigator.`"),
  inCode("`location`", "const where = location", "uses `location`"),
  inCode("`history`", "history.back()", "uses `history.`"),
  inCode("`navigation`", 'navigation.navigate("#a")', "uses `navigation`"),
  inCode("`open(`", 'open("#a")', "uses `open(`"),
  inCode("`.click(`", 'document.querySelector(".a").click()', "uses `.click(`"),
  inCode("`.submit(`", 'document.querySelector(".a").submit()', "uses `.submit(`"),
  inCode("`dispatchEvent(`", 'document.querySelector(".a").dispatchEvent(new Event("x"))', "uses `dispatchEvent(`"),
  inCode("assigning `.src`, `.href` or `.action`", 'document.querySelector(".a").src = "a.png"', "uses `.src`"),
  inCode("assigning `.src`, `.href` or `.action`", 'document.querySelector(".a").href = "#a"', "uses `.href`"),
  inCode("assigning `.src`, `.href` or `.action`", 'document.querySelector(".a").action = "#a"', "uses `.action`"),
  inCode("`document.write`", 'document.write("x")', "uses `document.write`"),
  inCode("`innerHTML`", 'document.querySelector(".a").innerHTML = "x"', "uses `innerHTML`"),
  inCode("`outerHTML`", 'document.querySelector(".a").outerHTML = "x"', "uses `outerHTML`"),
  inCode("`insertAdjacentHTML`", 'document.querySelector(".a").insertAdjacentHTML("beforeend", "x")', "uses `insertAdjacentHTML`"),
  inCode("`DOMParser`", "const parser = new DOMParser()", "uses `DOMParser`"),
  inCode("(which cannot set `href`, `src` or an `on…` handler", 'document.querySelector(".a").setAttribute("href", "#a")', 'uses `setAttribute("href")`'),
  inCode("(which cannot set `href`, `src` or an `on…` handler", 'document.querySelector(".a").setAttribute("src", "a.png")', 'uses `setAttribute("src")`'),
  inCode("(which cannot set `href`, `src` or an `on…` handler", 'document.querySelector(".a").setAttribute("onclick", "1")', 'uses `setAttribute("onclick")`'),
  // the window and the document are not read by a computed name
  inCode("- No `window[...]`", 'window["frame"] = (t) => {}', "uses `window[`"),
  inCode("`document[...]`", 'const el = document["body"]', "uses `document[`"),
  inCode("`self[...]`", 'const f = self["frame"]', "uses `self[`"),
  inCode("`this[...]`", 'const f = this["frame"]', "uses `this[`"),
  inCode("or `globalThis`", "globalThis.frame = (t) => {}", "uses `globalThis`"),
  // names a browser gives to the page's window, as a fragment would come to use them for its own
  inCode(NOT_NAMED, "const location = { x: 1, y: 2 }", "uses `location`"),
  inCode(NOT_NAMED, "const history = []; history.push(1)", "uses `history.`"),
  inCode(NOT_NAMED, "const navigation = [1, 2]", "uses `navigation`"),
  inCode(NOT_NAMED, "const navigator = { step: 1 }; const s = navigator.step", "uses `navigator.`"),
  inCode(NOT_NAMED, "function open(el) { el.style.opacity = 1 }", "uses `open(`"),
  // escapes, and the page's own T
  inCode("- No `\\u` or `\\x` escapes", 'const s = "\\u0e01"', "uses `\\u`"),
  inCode("- No `\\u` or `\\x` escapes", 'const s = "\\x41"', "uses `\\x`"),
  inCode("do not declare anything named `T`", "const T = [0.2, 0.8]", "declares `const T` at the top of the script"),
  inCode("do not declare anything named `T`", "let T = 1", "declares `let T` at the top of the script"),
  inCode("do not declare anything named `T`", "var T = 1", "declares `var T` at the top of the script"),
  inCode("do not declare anything named `T`", "function T(x) { return x }", "declares `function T` at the top of the script"),
]

const REFUSED_IN_TIME: Refused[] = [
  inCode("NO `requestAnimationFrame`", "requestAnimationFrame(() => {})", "uses `requestAnimationFrame`"),
  inCode("NO `setTimeout`/`setInterval`", "setTimeout(() => {}, 100)", "uses `setTimeout`"),
  inCode("NO `setTimeout`/`setInterval`", "setInterval(() => {}, 100)", "uses `setInterval`"),
  inCode("NO `Date`/`performance.now`", "const start = Date.now()", "uses `Date`"),
  inCode("NO `Date`/`performance.now`", "const now = new Date()", "uses `Date`"),
  inCode("NO `Date`/`performance.now`", "const t0 = performance.now()", "uses `performance.now`"),
  inCode("NO `Math.random`", "const r = Math.random()", "uses `Math.random`"),
  ["NO `<canvas>`, video or audio", markup('<canvas width="10" height="10"></canvas>'), "uses `<canvas>`"],
  ["NO `<canvas>`, video or audio", markup("<video></video>"), "uses `<video>`"],
  ["NO `<canvas>`, video or audio", markup("<audio></audio>"), "uses `<audio>`"],
]

/** The line of "Time" that lists what may not be used, which is the part of that section the linter enforces. */
const timers = () => section("Time").split("\n").find((line) => line.includes("So: NO ")) ?? ""

test("what the contract forbids is refused by the linter, each with a problem that names it: one small fragment for each tag, attribute and name", () => {
  // the fragment every one of them is made from passes, so each is refused for the one thing it adds
  expect(lintFragment(MOVING)).toEqual([])
  expect(lintFragment(code(FRAME))).toEqual([])
  const tables: [under: string, where: string, rows: Refused[]][] = [
    ["Shape", section("Shape"), REFUSED_IN_SHAPE],
    ["The script", section("The script"), REFUSED_IN_THE_SCRIPT],
    ["Time", timers(), REFUSED_IN_TIME],
  ]
  // every row that has drifted, at once: the words are the contract's, under the heading the table is for, and the linter's problem names the thing
  const drifted = tables.flatMap(([under, where, rows]) =>
    rows.flatMap(([says, fragment, problem]) => (where.includes(says) && said(fragment).includes(problem) ? [] : [{ under, says, inTheContract: where.includes(says), fragment, problem, theLinterSaid: lintFragment(fragment) }])),
  )
  expect(drifted).toEqual([])
  for (const [under, , rows] of tables) expect(rows.length, under).toBeGreaterThan(0)
})

test("every tag, attribute and name the contract writes out under Shape, The script and the timers of Time is one the tables above refuse, or one the fragment of what is offered uses", () => {
  const offered = new Set(ALLOWED.flatMap(([says]) => named(says)))
  const unaccounted = (where: string, rows: Refused[]) => {
    const refused = new Set(rows.flatMap(([says]) => named(says)))
    return named(where).filter((term) => !refused.has(term) && !offered.has(term))
  }
  expect({
    shape: unaccounted(section("Shape"), REFUSED_IN_SHAPE),
    theScript: unaccounted(section("The script"), REFUSED_IN_THE_SCRIPT),
    timers: unaccounted(timers(), REFUSED_IN_TIME),
  }).toEqual({ shape: [], theScript: [], timers: [] })
  // and the sections do name things: a contract read wrongly, with nothing found between backticks, would pass the check above with nothing checked
  expect(named(section("Shape"))).toEqual(expect.arrayContaining(["<style>", "<html>", "srcset", "<!-- -->", "onclick=", "<set>"]))
  expect(named(section("The script"))).toEqual(expect.arrayContaining(["document.getElementById", "fetch", "this[...]", "open", "\\x", "T"]))
  expect(named(timers())).toEqual(["requestAnimationFrame", "setTimeout", "setInterval", "Date", "performance.now", "Math.random", "<canvas>"])
})

// the briefs

/** The fifth brief of the trial, a timeline of three steps, whose first fragment drew wrongly and was repaired by one real call. */
const TIMELINE = {
  stage: { width: 1080, height: 640 },
  seconds: 4.5,
  words: [
    { text: "ขั้นแรก", atS: 0.2 },
    { text: "ปล่อยตัว", atS: 0.7 },
    { text: "ขั้นสอง", atS: 1.5 },
    { text: "เข้าวงโคจร", atS: 2 },
    { text: "ขั้นสาม", atS: 2.9 },
    { text: "เชื่อมต่อสถานี", atS: 3.4 },
  ],
  idea: "เส้นเวลาแนวนอน 3 จุด แต่ละจุดเด้งขึ้นพร้อมไอคอนเล็กและชื่อขั้น (ปล่อยตัว / เข้าวงโคจร / เชื่อมต่อสถานี) ตามจังหวะที่พูด เส้นเชื่อมวิ่งต่อไปจุดถัดไป",
  about: "how astronauts get to space (a short, playful explainer)",
}
const TIMELINE_BRIEF = `Brief:
- Stage: W = 1080, H = 640 px.
- D = 4.5 seconds.
- Words, in order, with the time each is said now: --w1 "ขั้นแรก" 0.20 · --w2 "ปล่อยตัว" 0.70 · --w3 "ขั้นสอง" 1.50 · --w4 "เข้าวงโคจร" 2.00 · --w5 "ขั้นสาม" 2.90 · --w6 "เชื่อมต่อสถานี" 3.40.
- What to draw: เส้นเวลาแนวนอน 3 จุด แต่ละจุดเด้งขึ้นพร้อมไอคอนเล็กและชื่อขั้น (ปล่อยตัว / เข้าวงโคจร / เชื่อมต่อสถานี) ตามจังหวะที่พูด เส้นเชื่อมวิ่งต่อไปจุดถัดไป
- The clip is about: how astronauts get to space (a short, playful explainer).`

test("the brief gives the stage, the length, the words in order with their variables and times, what to draw, and what the clip is about", () => {
  expect(motionBrief(TIMELINE)).toBe(TIMELINE_BRIEF)
  expect(
    motionBrief({
      stage: { width: 1080, height: 700 },
      seconds: 3.6,
      words: [{ text: "ยานอวกาศ", atS: 0.2 }, { text: "ต้องเร็วถึง", atS: 0.8 }],
      idea: 'ตัวเลขวิ่งจาก 0 ถึง 28,000 แล้วหยุดพอดีคำว่า "สองหมื่นแปดพัน"',
      about: "การไปอวกาศ (อธิบาย)",
    }).split("\n"),
  ).toEqual([
    "Brief:",
    "- Stage: W = 1080, H = 700 px.",
    "- D = 3.6 seconds.",
    '- Words, in order, with the time each is said now: --w1 "ยานอวกาศ" 0.20 · --w2 "ต้องเร็วถึง" 0.80.',
    '- What to draw: ตัวเลขวิ่งจาก 0 ถึง 28,000 แล้วหยุดพอดีคำว่า "สองหมื่นแปดพัน"',
    "- The clip is about: การไปอวกาศ (อธิบาย).",
  ])
})

test("a word's time is written to two decimals, the length as the number it is, and one word has no separator", () => {
  const lines = motionBrief({ stage: { width: 864, height: 768 }, seconds: 4, words: [{ text: "ราคา", atS: 0 }], idea: "ป้ายราคา", about: "ขายของ" }).split("\n")
  expect(lines[1]).toBe("- Stage: W = 864, H = 768 px.")
  expect(lines[2]).toBe("- D = 4 seconds.")
  expect(lines[3]).toBe('- Words, in order, with the time each is said now: --w1 "ราคา" 0.00.')
  const times = motionBrief({ stage: { width: 864, height: 768 }, seconds: 1.5, words: [{ text: "ก", atS: 0.15 }, { text: "ข", atS: 1.235 }, { text: "ค", atS: 1.4 }], idea: "x", about: "y" }).split("\n")
  expect(times[2]).toBe("- D = 1.5 seconds.")
  expect(times[3]).toBe('- Words, in order, with the time each is said now: --w1 "ก" 0.15 · --w2 "ข" 1.24 · --w3 "ค" 1.40.')
})

test("with no words said while it plays, the brief says so", () => {
  expect(motionBrief({ stage: { width: 1080, height: 600 }, seconds: 3, words: [], idea: "คลื่นซัดเข้าฝั่ง", about: "ทะเล" }).split("\n")).toEqual([
    "Brief:",
    "- Stage: W = 1080, H = 600 px.",
    "- D = 3 seconds.",
    "- Words: none are said while it plays.",
    "- What to draw: คลื่นซัดเข้าฝั่ง",
    "- The clip is about: ทะเล.",
  ])
})

/** What the host reported of the trial's fifth fragment at render time, which is what the one real repair call was given. */
const TRANSFORM_PROBLEMS = [1, 2, 3].map(
  (n) =>
    `<g class="icn i${n}"> has a transform attribute and an animation of its transform: the animation replaces the attribute, so the element jumps to the corner of the drawing. Keep the attribute on an outer <g> and animate an inner <g>`,
)

test("a repair's brief is the first brief as it was, then the problems one to a line, then what to do about them, then the fragment: the one a real call put right", () => {
  const repair = repairBrief({ brief: motionBrief(TIMELINE), html: fixture("trial-5"), problems: TRANSFORM_PROBLEMS })
  expect(repair).toBe(
    `${TIMELINE_BRIEF}

You wrote the fragment below for this brief. It was rendered, and it has these problems:
- <g class="icn i1"> has a transform attribute and an animation of its transform: the animation replaces the attribute, so the element jumps to the corner of the drawing. Keep the attribute on an outer <g> and animate an inner <g>
- <g class="icn i2"> has a transform attribute and an animation of its transform: the animation replaces the attribute, so the element jumps to the corner of the drawing. Keep the attribute on an outer <g> and animate an inner <g>
- <g class="icn i3"> has a transform attribute and an animation of its transform: the animation replaces the attribute, so the element jumps to the corner of the drawing. Keep the attribute on an outer <g> and animate an inner <g>

Put right every problem and change nothing else. Return the whole corrected fragment, with no code fence and no explanation.

${fixture("trial-5")}`,
  )
  expect(repair.startsWith(`${motionBrief(TIMELINE)}\n\n`)).toBe(true)
  expect(repair.endsWith(`\n\n${fixture("trial-5")}`)).toBe(true)
})

test("a repair for what the linter refused uses the same words, with the linter's problems as they are", () => {
  const html = `<style>.a{color:red}</style><div class="a">ก</div><script>setTimeout(() => {}, 100)</script>`
  const problems = lintFragment(html)
  expect(problems).toHaveLength(2)
  const lines = repairBrief({ brief: "Brief:\n- D = 3 seconds.", html, problems }).split("\n")
  expect(lines).toEqual([
    "Brief:",
    "- D = 3 seconds.",
    "",
    "You wrote the fragment below for this brief. It was rendered, and it has these problems:",
    `- ${problems[0]}`,
    `- ${problems[1]}`,
    "",
    "Put right every problem and change nothing else. Return the whole corrected fragment, with no code fence and no explanation.",
    "",
    html,
  ])
  // one problem is one line
  expect(repairBrief({ brief: "Brief:", html: "<style></style>", problems: ["nothing was drawn: every frame is empty"] })).toBe(
    "Brief:\n\nYou wrote the fragment below for this brief. It was rendered, and it has these problems:\n- nothing was drawn: every frame is empty\n\nPut right every problem and change nothing else. Return the whole corrected fragment, with no code fence and no explanation.\n\n<style></style>",
  )
})

/** What an edit tells Claude to do with the user's change, word for word. */
const EDIT_ASK =
  "Make that change and keep everything else as it is, unless the brief above has changed (the length, the words and their times, the stage): then fit the fragment to the brief as it is now. Return the whole fragment, with no code fence and no explanation."

test("an edit's brief is the first brief as it is now, then the user's change in double quotes on a line of its own, then what to do with it, then the fragment", () => {
  const edit = editBrief({ brief: motionBrief(TIMELINE), html: fixture("trial-5-repaired"), instruction: "ตัวเลขใหญ่ขึ้น" })
  expect(edit).toBe(
    `${TIMELINE_BRIEF}

You wrote the fragment below for this brief. The user asks for this change:
"ตัวเลขใหญ่ขึ้น"

${EDIT_ASK}

${fixture("trial-5-repaired")}`,
  )
  expect(edit.startsWith(`${motionBrief(TIMELINE)}\n\n`)).toBe(true)
  expect(edit.endsWith(`\n\n${fixture("trial-5-repaired")}`)).toBe(true)
})

test("the user's change is one line: trimmed, every run of white space made one space, and a double quote inside it kept as it is", () => {
  const lines = editBrief({ brief: "Brief:\n- D = 3 seconds.", html: "<style></style>", instruction: '  ให้ตัวเลข\n\tใหญ่ขึ้น   แล้ว "เด้ง"  แรงกว่านี้ \r\n' }).split("\n")
  expect(lines).toEqual([
    "Brief:",
    "- D = 3 seconds.",
    "",
    "You wrote the fragment below for this brief. The user asks for this change:",
    '"ให้ตัวเลข ใหญ่ขึ้น แล้ว "เด้ง" แรงกว่านี้"',
    "",
    EDIT_ASK,
    "",
    "<style></style>",
  ])
  // a change already on one line is given as it was typed
  expect(editBrief({ brief: "Brief:", html: "<style></style>", instruction: "จรวดพุ่งจากขวาแทน" }).split("\n")[3]).toBe('"จรวดพุ่งจากขวาแทน"')
})

// the answer

test("a code fence around the answer is taken off, with or without a language on it, and so is the white space around it", () => {
  const html = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style>\n<div class="a">ก</div>`
  expect(fragmentOf(`\`\`\`html\n${html}\n\`\`\``)).toBe(html)
  expect(fragmentOf(`\`\`\`\n${html}\n\`\`\``)).toBe(html)
  expect(fragmentOf(`\n\n  \`\`\`HTML\n${html}\n\`\`\`  \n`)).toBe(html)
  expect(fragmentOf(`\`\`\`html\r\n${html}\r\n\`\`\`\r\n`)).toBe(html)
  // blank lines inside the fence are white space around the fragment too
  expect(fragmentOf(`\`\`\`html\n\n${html}\n\n\`\`\``)).toBe(html)
  // a fence opened and never closed still comes off
  expect(fragmentOf(`\`\`\`html\n${html}`)).toBe(html)
  // the closing fence may be indented, or have white space after it
  expect(fragmentOf(`\`\`\`html\n${html}\n  \`\`\``)).toBe(html)
  expect(fragmentOf(`\`\`\`html\n${html}\n\t\`\`\` \t\n`)).toBe(html)
})

test("what Claude says after the fence it closed goes with the fence, so that a remark does not become words on the screen", () => {
  const html = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style>\n<div class="a">ก</div>`
  expect(fragmentOf(`\`\`\`html\n${html}\n\`\`\`\nIt pops in on the first word.`)).toBe(html)
  expect(fragmentOf(`\`\`\`html\n${html}\n\`\`\`\n\nThe number counts up to 28,000.\nTell me if the gauge should be bigger.\n`)).toBe(html)
  // the last line that is a closing fence is the one: a line of three backticks inside the fragment's own script stays in it
  const templated = `${html}\n<script>const s = \`a\n\`\`\`\nb\`; window.frame = (t) => {}</script>`
  expect(fragmentOf(`\`\`\`html\n${templated}\n\`\`\`\nDone.`)).toBe(templated)
  // and the fragment it leaves passes the linter, where the remark would have been text after the markup
  expect(lintFragment(fragmentOf(`\`\`\`html\n${html}\n\`\`\`\nIt pops in on the first word.`))).toEqual([])
})

test("an answer with no fence is left alone, but for the white space around it", () => {
  const html = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style>\n<div class="a">ก</div>`
  expect(fragmentOf(html)).toBe(html)
  expect(fragmentOf(`\n ${html}\n\n`)).toBe(html)
  expect(fragmentOf("")).toBe("")
  // every fragment a real call wrote came with no fence, and comes back as it was written
  for (const { name, html: written } of allFixtures()) expect(fragmentOf(written), name).toBe(written.trim())
  // backticks inside the fragment are the fragment's own: a template in its script, even one with a line of three of them
  const templated = `${html}\n<script>const s = \`a\n\`\`\`\nb\`; window.frame = (t) => {}</script>`
  expect(fragmentOf(templated)).toBe(templated)
  expect(fragmentOf(`\`\`\`html\n${templated}\n\`\`\``)).toBe(templated)
  // words before a fence or after it are not a fence around the answer: the linter refuses the whole, and says why
  const chatty = `Here is the fragment:\n\`\`\`html\n${html}\n\`\`\`\nIt pops in on the first word.`
  expect(fragmentOf(chatty)).toBe(chatty)
  expect(said(fragmentOf(chatty))).toContain("starts with `Here is the fragment:")
  // a closing fence with no opening one is no fence around the answer either
  expect(fragmentOf(`${html}\n\`\`\``)).toBe(`${html}\n\`\`\``)
  expect(fragmentOf(`${html}\n\`\`\`\nDone.`)).toBe(`${html}\n\`\`\`\nDone.`)
})

// the call

/** A transport that records every request and answers with a fixed text. */
function fakeTransport(output: string) {
  const calls: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate(request) {
      calls.push(request)
      return { output: output as never, usage: USAGE }
    },
  }
  return { transport, calls }
}

test("a graphic is written by one call: the contract as the system prompt, the brief as the request, plain text asked for, 16,000 tokens at most, and the stop signal", async () => {
  const html = fixture("trial-5-repaired").trim()
  const { transport, calls } = fakeTransport(`\`\`\`html\n${html}\n\`\`\`\n`)
  const stop = new AbortController()
  const brief = motionBrief(TIMELINE)
  const written = await writeMotion({ transport, model: "claude-opus-5-5", brief, signal: stop.signal })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.model).toBe("claude-opus-5-5")
  expect(calls[0]!.system).toBe(MOTION_CONTRACT)
  expect(calls[0]!.content).toEqual([{ type: "text", text: brief }])
  // the very schema a transport takes for plain text: no JSON is asked for
  expect(calls[0]!.schema).toBe(TEXT_REPLY)
  // as many as the planning call may answer with
  expect(calls[0]!.maxTokens).toBe(16_000)
  expect(calls[0]!.signal).toBe(stop.signal)
  // the answer is the fragment, with the fence Claude was told not to put around it taken off
  expect(written).toBe(html)
  expect(lintFragment(written)).toEqual([])
})

test("a repair is written by the same call, given the repair's brief; with no signal none is passed", async () => {
  const { transport, calls } = fakeTransport(fixture("trial-5-repaired"))
  const brief = repairBrief({ brief: motionBrief(TIMELINE), html: fixture("trial-5"), problems: TRANSFORM_PROBLEMS })
  expect(await writeMotion({ transport, model: "m", brief })).toBe(fixture("trial-5-repaired").trim())
  expect(calls[0]!.content).toEqual([{ type: "text", text: brief }])
  expect(calls[0]!.system).toBe(MOTION_CONTRACT)
  expect(calls[0]!.signal).toBeUndefined()
})

test("the call does not check what Claude wrote: a fragment the linter refuses comes back as it is, for whoever asked to check and repair", async () => {
  const refused = `<style>.a{color:red}</style><div class="a">ก</div><script>setTimeout(() => {}, 100)</script>`
  const { transport } = fakeTransport(refused)
  expect(await writeMotion({ transport, model: "m", brief: "Brief:" })).toBe(refused)
  expect(lintFragment(refused).length).toBeGreaterThan(0)
  // and a call that fails, fails: nothing is made of it here
  const broken: LlmTransport = { id: "claude-cli", generate: async () => Promise.reject(new Error("Claude Code failed: Not logged in")) }
  await expect(writeMotion({ transport: broken, model: "m", brief: "Brief:" })).rejects.toThrow("Claude Code failed: Not logged in")
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/graphics/motion/write")
  expect(exported.writeMotion).toBe(writeMotion)
  expect(exported.MOTION_CONTRACT).toBe(MOTION_CONTRACT)
  expect(exported.editBrief).toBe(editBrief)
  // and the graphics' own entry offers it beside the other briefs
  expect((await import("@boxblack/core/graphics")).editBrief).toBe(editBrief)
})
