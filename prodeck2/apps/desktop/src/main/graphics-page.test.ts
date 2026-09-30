import { join } from "node:path"
// @ts-expect-error jsdom ships no types, and this file only reads the pages the app builds
import { JSDOM } from "jsdom"
import { describe, expect, test } from "vitest"
import { motionAssets, motionHtml } from "@boxblack/core/graphics/motion"
import { allFixtures, fixture } from "@boxblack/core/graphics/motion/fixtures"
import { lintFragment, REFUSED_TAGS } from "@boxblack/core/graphics/motion/lint"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"

/** The graphics resources as the app ships them (Resources/graphics): the host script is read from here. */
const RESOURCES = join(import.meta.dirname, "../../resources/graphics")
/** F, one of the fragments the design was tried on: the others are read with allFixtures(). */
const F = fixture("spike-F")

/** The page motionHtml builds for a fragment, read by a browser's parser (jsdom's, which is parse5) and not run. */
async function pageOf(fragment: string) {
  const assets = await motionAssets(RESOURCES)
  const html = motionHtml({
    html: fragment,
    stage: { width: 864, height: 768 },
    seconds: 3,
    fps: 30,
    times: [0.15, 1.2, 2.05],
    palette: HIGHLIGHT_STYLES["bold-white"].palette,
    font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" },
    assets,
  })
  return { assets, document: new JSDOM(html).window.document as Document }
}

/** What a fragment may not put in the page, as the parser makes elements of it: every tag the linter refuses, from the list it is built from. SVG names keep their case. */
const REFUSED = REFUSED_TAGS.join(", ")

describe("the page around a fragment, as a browser's parser reads it", () => {
  test("has two scripts round a fragment with none and three round one with a script: the times, the fragment's own, and the host, which is the last element of the body; a page is built from every fragment the design was tried on", async () => {
    for (const { name, html: fragment } of allFixtures()) {
      expect(lintFragment(fragment), name).toEqual([])
      // the fragment's own script, as the parser reads the fragment alone: there is none, or one
      const own = JSDOM.fragment(fragment).querySelectorAll("script").length
      expect(own, name).toBeLessThanOrEqual(1)
      const count = 2 + own
      const { assets, document } = await pageOf(fragment)
      const all = [...document.querySelectorAll("script")]
      expect(all, name).toHaveLength(count)
      // the times come first and the host last, and the host is the last element of the body
      expect(all[0]!.textContent, name).toBe("const T = [0.15,1.2,2.05]")
      expect(all.at(-1)!.textContent!.trim(), name).toBe(assets.host.trim())
      expect(document.body.lastElementChild, name).toBe(all.at(-1))
      // the times and the fragment's own script sit in the stage, and the host does not
      const stage = document.getElementById("stage")!
      expect([...stage.querySelectorAll("script")], name).toHaveLength(count - 1)
      expect(stage.contains(all.at(-1)!), name).toBe(false)
    }
  })

  test("holds the fragment's elements in the stage, whole and in order, after the times", async () => {
    for (const { name, html: fragment } of allFixtures()) {
      const { document } = await pageOf(fragment)
      const stage = document.getElementById("stage")!
      const made = [...stage.children].slice(1).map((child) => child.outerHTML)
      const parsed = [...JSDOM.fragment(fragment).children].map((child: Element) => child.outerHTML)
      expect(made, name).toEqual(parsed)
      expect(made.length, name).toBeGreaterThan(1)
      // the fragment's style is the first of them, and the page's own styles are not inside the stage
      expect(stage.children[1]!.tagName, name).toBe("STYLE")
    }
  })

  test("has nothing in it a fragment that passes the linter may not have: no handler, no refused element, and no script but the three", async () => {
    // the fifteen the design was tried on, and two that pass but look like trouble: text that spells tags, and odd but plain quoting
    const fragments = [
      ...allFixtures().map(({ html }) => html),
      `<style>@keyframes out{to{opacity:0}}.a{animation:out 1s both}</style><div class="a">&lt;script&gt;alert(1)&lt;/script&gt; &lt;!-- --&gt; and a title</div>`,
      `<style>\n.a{animation:out 1s both}\n@keyframes out{to{opacity:0}}\n</style>\n<div class='a' title=one data-online = "1">ก</div>  \n<script>\n  window.frame = (t) => {}\n</script>\n`,
    ]
    for (const [i, fragment] of fragments.entries()) {
      expect(lintFragment(fragment), `fragment ${i}`).toEqual([])
      const { document } = await pageOf(fragment)
      const root = document.getElementById("root")!
      expect(root.querySelectorAll(REFUSED), `fragment ${i}`).toHaveLength(0)
      const handlers = [...root.querySelectorAll("*")].flatMap((element) => [...element.attributes].filter((attribute) => /^on/i.test(attribute.name)))
      expect(handlers, `fragment ${i}`).toHaveLength(0)
      // one style of its own in the body, and the page's one in the head
      expect(document.querySelectorAll("style"), `fragment ${i}`).toHaveLength(2)
      expect(document.querySelectorAll("script").length, `fragment ${i}`).toBeLessThanOrEqual(3)
    }
  })
})

describe("what the parser makes of the shapes the linter refuses", () => {
  test("a comment that opens a script's escape hides a second script and the code after it: the parser reads one script that runs it, and the linter refuses the whole", async () => {
    const hidden = `${F}<script><!--<script></script>\nlocation="x"\n--></script>`
    const { document } = await pageOf(hidden)
    const scripts = [...document.getElementById("stage")!.querySelectorAll("script")]
    // the times, and one script whose text runs on past the first end tag to the location that follows
    expect(scripts).toHaveLength(2)
    expect(scripts[1]!.textContent).toBe('<!--<script></script>\nlocation="x"\n-->')
    expect(lintFragment(hidden).join("\n")).toContain("`location`")
    expect(lintFragment(hidden).join("\n")).toContain("HTML comment")
  })

  test("an attribute value can hold a >, and the source it goes on to name is the script's", async () => {
    const attribute = `${F}<script data-x="a>b" src="x.js"></script>`
    const { document } = await pageOf(attribute)
    const scripts = [...document.getElementById("stage")!.querySelectorAll("script")]
    expect(scripts[1]!.getAttribute("src")).toBe("x.js")
    expect(lintFragment(attribute).join("\n")).toContain("no attributes")
  })

  test("an event handler on an svg is an attribute of it, and a script or style never closed swallows what follows", async () => {
    const handler = `${F}<svg onload="location = 'x'"></svg>`
    const { document } = await pageOf(handler)
    expect(document.getElementById("stage")!.querySelector("svg[onload]")!.getAttribute("onload")).toBe("location = 'x'")
    expect(lintFragment(handler).join("\n")).toContain("no inline event handlers")

    // an open script takes the rest of the page, the host's script and its tags included, as its own text: the host
    // would never run to register a timeline
    const open = `${F}<script>window.frame = (t) => {}`
    const swallowed = [...(await pageOf(open)).document.querySelectorAll("script")]
    expect(swallowed).toHaveLength(2)
    expect(swallowed[1]!.textContent).toContain("window.frame")
    expect(swallowed[1]!.textContent).toContain("__timelines")
    expect(lintFragment(open).join("\n")).toContain("never closed")

    // an open style does the same to every script after it: only the times are left
    const style = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}<div class="a">ก</div>`
    const restyled = (await pageOf(style)).document
    expect(restyled.querySelectorAll("script")).toHaveLength(1)
    expect(lintFragment(style).join("\n")).toContain("never closed")
  })
})

/** A fragment that moves and is otherwise plain: what the hostile shapes below are added to. */
const MOVING = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div>`

describe("what a browser's parser makes of text the check must not take for code", () => {
  // each of these was passed by a check that cut the script out by its tags alone; the parser read something else there
  const finds: [label: string, fragment: string, made: (document: Document) => boolean, words: string[]][] = [
    ["CDATA is a comment to the parser, and the script tag inside it is not one: a handler is a real attribute", `${MOVING}<![CDATA[<script>x</math><b onclick=1>y</script>`, (d) => d.querySelector("#stage [onclick]") !== null, ["where no tag starts"]],
    ["a declaration and an instruction swallow the tag: a picture with a handler is real", `${MOVING}<!x> <? &amp;<script>x</svg><img src=x onerror=1></script>`, (d) => d.querySelector("#stage img[onerror]") !== null, ["where no tag starts"]],
    ["a bare <! swallows the script tag: a frame is real", `${MOVING}'<!<script>window.frame = (t) => {}</svg><iframe></iframe></script>`, (d) => d.querySelector("#stage iframe") !== null, ["where no tag starts"]],
    ["a script left open inside an svg is read as markup: a frame is real", `${MOVING}<use href="#a"> <svg><script>window.frame = (t) => {}</svg><iframe></iframe></script>`, (d) => d.querySelector("#stage iframe") !== null, ["has an `<svg>` that is never closed"]],
    ["a table and a bogus comment: a picture with a handler is real", `${MOVING}<table> <!<script>x</svg><img src=x onerror=1></script>`, (d) => d.querySelector("#stage img[onerror]") !== null, ["where no tag starts"]],
    ["an instruction swallows the script tag: the script is text, and nothing runs", `${MOVING}<? </<script>window.frame = (t) => { const s = "</scr" + "ipt>" }</script>`, (d) => d.querySelectorAll("#stage script").length === 1, ["where no tag starts"]],
    ["noframes is raw text to its end: the script and the host after it are text", `${MOVING}<noframes><script>window.frame = (t) => {}</svg><iframe></iframe></script>`, (d) => d.querySelectorAll("script").length === 1, ["uses `<noframes>`"]],
    ["noembed is the same", `${MOVING}<noembed> <use href="#a"><script>window.frame = (t) => {} // c</script>`, (d) => d.querySelectorAll("script").length === 1, ["uses `<noembed>`"]],
    // three rules see this one: the script in the styles, the end tag with no script before it, and the handler in the markup
    [
      "a script named in the styles is no script: the markup after the styles is real, handler and all",
      `<style>/*<script>*/.a{animation:o 1s both}@keyframes o{to{opacity:0}}</style><div class="a" onclick=1>ก</div></script>`,
      (d) => d.querySelector("#stage [onclick]") !== null,
      ["has `<script` in the styles", "has a `</script` with no `<script>` before it", "has the event handler `onclick`"],
    ],
    ["a script tag in an attribute value is no script: what follows is real markup", `${MOVING}<div title="<script>"><img src=x onerror=1></script>`, (d) => d.querySelector("#stage img[onerror]") !== null, ["that never ends"]],
  ]

  test("each thing the parser makes of them is something the check did not read as markup, and each is refused with the words of the rules that see it", async () => {
    for (const [label, fragment, made, words] of finds) {
      const { document } = await pageOf(fragment)
      expect(made(document), label).toBe(true)
      const problems = lintFragment(fragment)
      expect(problems.length, label).toBeGreaterThan(0)
      for (const word of words) expect(problems.join("\n"), `${label}: ${word}`).toContain(word)
    }
  })

  // the constructs a parser reads in states of its own, in any order, before a script or none; every tag the linter refuses is among them, opened and closed, from the list it is built from
  const PIECES = [
    ...REFUSED_TAGS.flatMap((name) => [`<${name}>`, `</${name}>`]),
    '<div class="a">x</div>', "<svg>", "</svg>", "<math>", "</math>", "<![CDATA[", "]]>", "<?php x ?>", "<!x>", "<!DOCTYPE html>", "</ x>", '<a href="#x">', "</a>",
    "<p>", "</p>", "<table>", "<tr>", "<td>", "<select>", "<option>", "<input>", "<button>", "<foreignObject>", "</foreignObject>", '<annotation-xml encoding="text/html">',
    "&lt;script&gt;", "&#60;script&#62;", "<scr\u0000ipt>", "<ScRiPt>", "<script\f>", "<SCRIPT>", "</SCRIPT>", "</script >", "</script\n>", "<script", "</script",
    "<style", "</style", "<STYLE>", "</STYLE>", "<style>", "</style>", "<!--", "-->", "--!>", "<!-->", "<image src=x>", "<img src=x>", "<svg><style>", "<svg><script>",
    '<div title="<script>">', "<div title='</script>'>", '<div data-x="a>b" onclick="1">', "<div onclick=x>", "<div\nonclick\n=\n1>", "<b onmouseover=1>",
    "<meta http-equiv=refresh>", "<base href=#>", '<a href="javascript:1">', '<use href="#a">', '<use xlink:href="//x">', '<use src="#a">', '<svg srcset="#a">', '<use href="">', '<use src="">',
    " ", "\n", "ก", "&amp;", "<", ">", "</", "<!", "<?", "'", '"', "\\", "<SET/>", "<br>", "<hr/>",
    "<script>1</script>", "<script>window.frame=(t)=>{}</script>", "<script>window.frame=(t)=>{}", "<script src=x></script>", "<script type=module>1</script>",
  ]
  const ENDINGS = [
    "", "", "", "<script>window.frame = (t) => {}</script>", "<script>window.frame = (t) => {} // c</script>", "<script>const x = '<b>'; window.frame = (t) => {}</script>",
    '<script>window.frame = (t) => { const s = "</scr" + "ipt>" }</script>', "<script>x</svg><img src=x onerror=1></script>", "<script>x</math><b onclick=1>y</script>", "<script>window.frame = (t) => {}</svg><iframe></iframe></script>",
  ]
  // a refusal by a rule about a name in code would go if that rule were loosened; one about the shape or the markup would not, so the count of those is a floor that no such loosening can trip.
  // The corpus is fixed by its seed: at the time of writing 204 of the thousand pass and 796 are refused for their shape or their markup.
  const FLOOR = 500
  const ABOUT_A_NAME = /^(?:uses `(?!<)|creates |declares )/
  test("for a thousand fragments of them in any order, every one the check passes is read by the parser as the check read it: one script with exactly the code it read, and no handler, refused element or loading attribute made of text it took for code", async () => {
    let seed = 7
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]!
    let passed = 0
    let refusedByTheShape = 0
    const wrong: string[] = []
    for (let n = 0; n < 1000; n++) {
      const middle = Array.from({ length: Math.floor(random() * 6) }, () => pick(PIECES)).join(random() < 0.5 ? "" : " ")
      const fragment = (random() < 0.9 ? `<style>.a{animation:o 1s both}@keyframes o{to{opacity:0}}</style>` : pick(PIECES)) + middle + pick(ENDINGS)
      const problems = lintFragment(fragment)
      if (problems.length > 0) {
        if (problems.some((problem) => !ABOUT_A_NAME.test(problem))) refusedByTheShape++
        continue
      }
      passed++
      const { assets, document } = await pageOf(fragment)
      const root = document.getElementById("root")!
      const scripts = [...document.querySelectorAll("script")]
      const host = scripts.filter((script) => script.textContent!.trim() === assets.host.trim())
      const times = scripts.filter((script) => script.textContent === "const T = [0.15,1.2,2.05]")
      const own = scripts.filter((script) => !host.includes(script) && !times.includes(script))
      const text = fragment.trim()
      const scripted = /<script/i.test(text)
      const code = scripted ? text.slice(text.search(/<script/i) + "<script>".length, text.length - "</script>".length) : ""
      const reasons: string[] = []
      if (host.length !== 1) reasons.push("the host script is not a script")
      if (times.length !== 1) reasons.push("the times script is not a script")
      if (own.length !== (scripted ? 1 : 0)) reasons.push(`${own.length} scripts of its own where the check read ${scripted ? 1 : 0}`)
      else if (scripted && own[0]!.textContent !== code) reasons.push("a script whose text is not exactly the code the check read")
      if (root.querySelectorAll(REFUSED).length > 0) reasons.push("a refused element")
      if ([...root.querySelectorAll("*")].some((element) => [...element.attributes].some((attribute) => /^on/i.test(attribute.name)))) reasons.push("an event handler")
      // src and srcset load whatever they hold; href and xlink:href may only point at a shape in the fragment
      const loads = (name: string, value: string) => (/^(src|srcset)$/i.test(name) && value !== "") || (/^(href|xlink:href)$/i.test(name) && value !== "" && !value.startsWith("#"))
      if ([...root.querySelectorAll("*")].some((element) => [...element.attributes].some((attribute) => loads(attribute.name, attribute.value.trim())))) reasons.push("a loading attribute")
      if (reasons.length > 0) wrong.push(`${JSON.stringify(fragment)}: ${reasons.join("; ")}`)
    }
    // the corpus is not vacuous: a fair share passes the check, and a fair share is refused for its shape or its markup, which no loosening of a rule about names in code can undo
    expect(passed).toBeGreaterThan(150)
    expect(refusedByTheShape).toBeGreaterThan(FLOOR)
    expect(wrong).toEqual([])
  }, 60_000)
})
