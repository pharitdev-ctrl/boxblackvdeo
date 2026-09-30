import { expect, test } from "vitest"
import { allFixtures } from "./fixtures/index.ts"
import { readShape, SHAPE } from "./shape.ts"

/** A fragment that moves and holds nothing else: the shape to change one thing in. */
const MOVING = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div>`
/** A script that ends a fragment. */
const SCRIPT = "<script>window.frame = (t) => {}</script>"
/** The moving fragment with a script of this code at its end. */
const withCode = (code: string) => `${MOVING}\n<script>\n${code}\n</script>`
/** What the reader says about a fragment, as one text. */
const said = (html: string) => readShape(html).problems.join("\n")

test("a fragment is read as its markup and its script, and a well-made one has nothing wrong with it", () => {
  for (const { name, html } of allFixtures()) {
    const shape = readShape(html)
    expect(shape.problems, name).toEqual([])
    const afterStyles = html.slice(html.indexOf("</style>") + "</style>".length)
    const script = html.trim().endsWith("</script>")
    expect(shape.code !== "", name).toBe(script)
    if (script) {
      // the script, when there is one, is the text between the plain tags that end the fragment
      expect(html.trim().endsWith(`<script>${shape.code}</script>`), name).toBe(true)
      // and the markup is what lies between the styles and the script, with a line break where the script was
      expect(shape.markup, name).toBe(`${afterStyles.slice(0, afterStyles.indexOf("<script>"))}\n${html.slice(html.lastIndexOf("</script>") + "</script>".length)}`)
    } else {
      expect(shape.markup, name).toBe(afterStyles)
    }
    expect(shape.markup, name).not.toContain("<style")
    expect(shape.markup, name).not.toContain("<script")
    expect(shape.markup, name).toContain("<div")
  }
})

test("what comes after the styles is markup up to the first script, the script's text runs to the last end tag, and what follows it is markup again; the reader hands back those three and nothing more", () => {
  const shape = readShape("<style>.a{}</style><p>one</p><script>x = 1</script><p>two</p>")
  expect(shape.markup).toBe("<p>one</p>\n<p>two</p>")
  expect(shape.code).toBe("x = 1")
  expect(Object.keys(shape).sort()).toEqual(["code", "markup", "problems"])
  // a script that hides code between two end tags is read to the last, so the code it hides is code
  expect(readShape("<style></style><script>a</script>b<script>c</script>").code).toBe("a</script>b<script>c")
  // one never closed runs to the end
  expect(readShape("<style></style><p>x</p><script>x = 1").code).toBe("x = 1")
  // a fragment with no style block has no styles, and its markup is all of it; it is told how to start
  const bare = readShape("<p>x</p>")
  expect([bare.markup, bare.code]).toEqual(["<p>x</p>", ""])
  expect(bare.problems.join("\n")).toContain("instead of a plain `<style>` block")
})

test("the styles end at the first end tag of the style, so a script named inside them is not a script", () => {
  const shape = readShape("<style>/*<script>*/</style><p>x</p>")
  expect(shape.code).toBe("")
  expect(shape.markup).toBe("<p>x</p>")
  expect(shape.problems.join("\n")).toContain("has `<script` in the styles")
})

test("the styles end with a plain end tag, or the fragment says how it ends instead", () => {
  expect(readShape("<style>.a{}</style><p>x</p>").problems).toEqual([])
  for (const end of ["</style >", "</STYLE>", '</style x="a>b">']) {
    const problems = readShape(`<style>.a{}${end}<p>x</p>`).problems
    // the tag is named as far as its first >
    expect(problems.join("\n"), end).toContain(`has \`${end.slice(0, 8)}`)
    expect(problems.join("\n"), end).toContain("instead of a plain `</style>` to end the styles")
  }
})

test("the problems about how a fragment is built all carry the rule for building one", () => {
  for (const html of ["<p>x</p>", "<style></style><p>x</p><script>1", "<style></style><script src=x></script>", "<style>", "<style></style><style></style>", "<style></style></style>", "<style></style><script>1</script><p>x</p>"]) {
    const problems = readShape(html).problems.filter((problem) => !problem.includes("where no tag starts"))
    expect(problems.length, html).toBeGreaterThan(0)
    for (const problem of problems) expect(problem, html).toContain(SHAPE)
  }
})

test("a fragment starts with one plain style block: markup first, a style with attributes, another spelling, text before it, or no style at all is refused, saying how a fragment is built", () => {
  const moves = "<style>@keyframes a{to{opacity:0}}</style>"
  for (const html of [`<div class="a">ก</div>${moves}`, `<style media="print">@keyframes a{to{opacity:0}}</style><div>ก</div>`, `<STYLE>@keyframes a{to{opacity:0}}</STYLE><div>ก</div>`, `ก${moves}<div>ก</div>`, `<div>ก</div>`]) {
    const problems = said(html)
    expect(problems, html).toContain("instead of a plain `<style>` block")
    expect(problems, html).toContain(SHAPE)
  }
  // white space around it is nothing, and a style that holds a > is a style
  expect(readShape(`\n  \t${MOVING}\n\n`).problems).toEqual([])
  expect(readShape(`<style>.a > .b{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div>`).problems).toEqual([])
})

test("a fragment has exactly one style block, and it is closed: a second one, one in the svg, an unclosed one, or a second end tag is refused", () => {
  const cases: [string, string][] = [
    ["a second style block", `${MOVING}<style>.b{color:red}</style>`],
    ["a style in the svg", `${MOVING}<svg><style>.b{color:red}</style></svg>`],
    ["a second one in another spelling", `${MOVING}<STYLE>.b{color:red}</STYLE>`],
  ]
  for (const [label, html] of cases) {
    expect(said(html), label).toContain("has 2 `<style` tags")
    expect(said(html), label).toContain(SHAPE)
  }
  const unclosed = said(`<style>@keyframes a{to{opacity:0}}<div>ก</div>`)
  expect(unclosed).toContain("has a `<style>` that is never closed")
  expect(unclosed).toContain(SHAPE)
  const twice = said(`${MOVING}</style>`)
  expect(twice).toContain("has 2 `</style`")
  expect(twice).toContain(SHAPE)
  // the end tag of the style block is plain too: nothing after its name, in any spelling
  for (const end of ["</style >", "</STYLE>", "</style\n>", '</style x="a>b">', "</style/>"]) {
    const problems = said(`<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}${end}<div class="a">ก</div>`)
    expect(problems, end).toContain("instead of a plain `</style>`")
    expect(problems, end).toContain(SHAPE)
  }
  // in code, style is only a name: a comparison with a variable called style is not a tag
  expect(readShape(withCode("const style = 3; for (let i = 0; i<style; i++) {} if (2<style.length) {}")).problems).toEqual([])
})

test("a fragment has at most one script, a plain one, and its end tag is the last thing: another, attributes on it, text after it, or one never closed is refused", () => {
  const script = "window.frame = (t) => {}"
  const cases: [string, string, string][] = [
    ["a second script", `${withCode(script)}<script>1</script>`, "has 2 `<script` tags"],
    ["a script in the svg beside the last", `${MOVING}<svg><script>1</script></svg><script>${script}</script>`, "has 2 `<script` tags"],
    ["a script in the code", `${MOVING}<script>const s = "<script>"; ${script}</script>`, "has 2 `<script` tags"],
    ["a type", `${MOVING}<script type="module">${script}</script>`, "`<script type=\"module\">` for its script, which must have no attributes (no src, no type)"],
    ["a source", `${MOVING}<script src="x.js"></script>`, "`<script src=\"x.js\">` for its script, which must have no attributes (no src, no type)"],
    ["an attribute that holds a >", `${MOVING}<script data-x="a>b" src="x.js"></script>`, "for its script, which must have no attributes (no src, no type)"],
    ["upper case", `${MOVING}<SCRIPT>${script}</SCRIPT>`, "`<SCRIPT>` for its script, which must have no attributes"],
    ["a script never closed", `${MOVING}<script>${script}`, "has a `<script>` that is never closed"],
    ["an end tag in the code", `${MOVING}<script>const s = "</script>"; ${script}</script>`, "has 2 `</script`"],
    ["an end tag with no script", `${MOVING}</script>`, "has a `</script` with no `<script>` before it"],
    ["markup after the script", `${withCode(script)}<p>x</p>`, "ends with `</script><p>x</p>` instead of a plain `</script>` as the very last thing"],
    ["a script in the svg and nothing after it", `${MOVING}<svg><script>1</script></svg>`, "ends with `</script></svg>` instead of a plain `</script>` as the very last thing"],
    ["an end tag that is not plain", `${MOVING}<script>${script}</script >`, "instead of a plain `</script>` as the very last thing"],
  ]
  for (const [label, html, words] of cases) {
    const problems = said(html)
    expect(problems, label).toContain(words)
    expect(problems, label).toContain(SHAPE)
  }
  // one plain script, the last thing, is the shape; white space around it is nothing
  expect(readShape(`\n  ${withCode(script)}\n\n`).problems).toEqual([])
  expect(readShape(`${MOVING}<script>${script}</script>`).problems).toEqual([])
})

test("nothing before the script may hide it or make markup of its text: a declaration, a processing instruction, an end tag that closes nothing and a < that starts no tag are all refused", () => {
  for (const snippet of ["<!x>", "<!DOCTYPE html>", "<![CDATA[", '<?xml version="1.0"?>', "</ x>", "</>", "</1>", "a < b", "<3", "<", "<!"]) {
    const problems = said(`${MOVING}${snippet}${SCRIPT}`)
    expect(problems, snippet).toContain("where no tag starts")
    expect(problems, snippet).toContain("write &lt; for a less-than sign")
  }
  // with no script the same is refused, and a > in text is only text
  expect(said(`${MOVING}<![CDATA[x]]>`)).toContain("where no tag starts")
  expect(readShape(`${MOVING.replace("ก</div>", "a > b &lt; c &amp; d &#60;script&#62;</div>")}${SCRIPT}`).problems).toEqual([])
})

test("the script is not inside an svg or math element, where a parser reads its text as markup: one left open is refused; one closed, self-closed or nested is fine", () => {
  for (const open of ["<svg>", "<math>", "<SVG viewBox='0 0 1 1'>", "<svg><g>", "<svg><svg></svg>", "<svg xmlns=http://example.com/>"]) {
    const problems = said(`${MOVING}${open}${SCRIPT}`)
    expect(problems, open).toContain("that is never closed")
    expect(problems, open).toContain("close every `<svg>` and `<math>` with its end tag")
  }
  // the end tag that would close it is in the script's text, and the markup after it is real markup
  expect(said(`${MOVING}<svg><script>x</svg><img src=x onerror=1></script>`)).toContain("that is never closed")
  expect(said(`${MOVING}</svg>`)).toContain("has `</svg` with no `<svg>` before it")
  expect(said(`${MOVING}<svg></svg></math>`)).toContain("has `</math` with no `<math>` before it")
  for (const fine of ['<svg viewBox="0 0 1 1"><g></g></svg>', "<svg/>", "<svg />", '<svg><path d="M0 0"/></svg>', "<SVG><svg><path/></svg></SVG>", "<math><mi>x</mi></math>", '<svg><foreignObject><div>ก</div></foreignObject></svg>']) {
    expect(readShape(`${MOVING}${fine}${SCRIPT}`).problems, fine).toEqual([])
  }
})

test("no script or end tag hides in a tag: a < inside a name or a value, a tag or a quote never ended, or odd characters in a name are refused", () => {
  const unreadable = ["<div title='</script>'>ก</div>", '<div title="a>b">ก</div>', "<div title=a<b>ก</div>", '<div a"b=1>ก</div>', "<div title=a\"b>ก</div>", "<div a=b=c>ก</div>", "<div title=`x`>ก</div>", "<a\"b>ก</a>", "<div =x>ก</div>", "</div class=a>", "</div title='>'>"]
  for (const snippet of unreadable) {
    const problems = said(`${MOVING}${snippet}${SCRIPT}`)
    expect(problems, snippet).toContain("that the check cannot read")
  }
  // a script tag inside a tag cuts the tag short where the check reads on: the tag never ends
  for (const snippet of ['<div title="<script>">ก</div>', "<a<script>ก</a>", "<div <script>>ก</div>"]) {
    expect(said(`${MOVING}${snippet}${SCRIPT}`), snippet).toMatch(/that never ends|that the check cannot read/)
  }
  for (const snippet of ['<div class="a"', '<div class="a" title="x', "<div", "<div class='a"]) {
    const problems = said(`${MOVING}${snippet}`)
    expect(problems, snippet).toContain("that never ends")
  }
  // a script tag in a value, with only the end tag left to look like a script's
  expect(said(`${MOVING}<div title="<script>">ก</div></script>`)).toMatch(/that never ends|that the check cannot read/)
  // plain tags of every kind the fragments use are read
  const fine = ['<div class=a-b data-x = "1" hidden>ก</div>', "<div\nclass='a'\n  title=\"it's\"\n>ก</div>", '<path d="M0 0L1 1"/>', "<br>", '<circle cx=1 cy=2 r=3 />', '<div / class="a">ก</div>', '<div class="a"title="b">ก</div>', "<DIV CLASS=A>ก</DIV>", '<div title="a &lt; b &amp; c">ก</div>']
  for (const snippet of fine) expect(readShape(`${MOVING}${snippet}${SCRIPT}`).problems, snippet).toEqual([])
})

test("a NUL character is refused wherever it is: a parser changes it to U+FFFD in a script and in a value and drops it from text, so the text it runs would not be the text that was checked", () => {
  for (const html of [`${MOVING}<p>a\u0000b</p>${SCRIPT}`, `${MOVING.replace("opacity:0", "opacity:\u00000")}${SCRIPT}`, `${MOVING}${SCRIPT.replace("frame =", "frame\u0000 =")}`, `${MOVING}<div title="a\u0000b">ก</div>`]) {
    const problems = said(html)
    expect(problems, JSON.stringify(html)).toContain("has a NUL character (U+0000)")
    expect(problems, JSON.stringify(html)).toContain("a fragment holds only text, tabs and line breaks")
  }
})
