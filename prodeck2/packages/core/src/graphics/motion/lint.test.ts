import { expect, test } from "vitest"
import { MOTION_HTML_MAX } from "../plan.ts"
import { allFixtures, fixture } from "./fixtures/index.ts"
import { lintFragment } from "./lint.ts"
import { RAW_TEXT_TAGS, REFUSED_TAGS, SMIL_TAGS } from "./tags.ts"

/** One of the fragments the design was tried on, F, written under the word and colour variables: CSS animations only. It passes. */
const FRAGMENT = fixture("spike-F")

/** What the linter says about a fragment, as one text. */
const said = (html: string) => lintFragment(html).join("\n")
/** The fragment with a script at its end: the way Claude's own code sits in it. */
const withCode = (code: string) => `${FRAGMENT}\n<script>\n${code}\n</script>`
/** A fragment that moves and holds nothing else the rules mind: the shape to change one thing in. */
const MOVING = `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div>`
/** The moving fragment with more rules in its one style block. */
const css = (rules: string) => MOVING.replace("</style>", `${rules}</style>`)
/** A fragment that moves nothing, to see the rule about that on its own. */
const STATIC = `<style>.a{color:red}</style><div class="a">ก</div>`
/** The fragment padded with a comment inside its style to exactly this many characters. */
const padded = (length: number) => FRAGMENT.replace("<style>", `<style>/*${"x".repeat(length - FRAGMENT.length - "/**/".length)}*/`)

test("the fifteen fragments the design was tried on all pass, trial-5 included, which draws wrongly in a way no rule can see", () => {
  const all = allFixtures()
  expect(all).toHaveLength(15)
  for (const { name, html } of all) expect(lintFragment(html), name).toEqual([])
})

test("the idioms of a well-made fragment pass: web animations, a per-frame function, clip paths, shapes used by reference, the SVG namespace, comments in CSS and in code, words that only look like a rule", () => {
  const script = `(() => {
  // one dot, drawn by hand and moved by a web animation
  const el = document.querySelector('.a'), NS = 'http://www.w3.org/2000/svg';
  const dot = document.createElementNS(NS, 'circle'), tick = document.createElement('i');
  el.appendChild(dot);
  /* the times of the words are T, as the page gives them */
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: T[1] * 1000 - 300, fill: 'both' });
  el.setAttribute('transform', 'translate(' + 4 + ',' + 2 + ')');
  const len = el.getTotalLength ? el.getTotalLength() : 0, mid = el.getPointAtLength ? el.getPointAtLength(len / 2) : null;
  window.frame = (t) => { dot.setAttribute('r', String(10 + 5 * Math.sin(t * 6))) };
})()`
  const html = `<style>/* clipped, filtered and masked by shapes below */
.a{clip-path:url(#c);transform:translate(4px,2px);animation-duration:1s;filter:url("#f");mask:url('#m');fill:url( #g )}
@keyframes out{to{opacity:0}}</style>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs><use href="#s"/><use xlink:href="#s"/><path fill="url(#g)"/><image href="#s"/></svg>
<header style="color:red" data-online="1">ก</header>
<script>${script}</script>`
  expect(lintFragment(html)).toEqual([])
})

test("an empty fragment, or one of white space alone, is refused with that one problem", () => {
  for (const html of ["", "   ", "\n\t \n"]) {
    const problems = lintFragment(html)
    expect(problems, JSON.stringify(html)).toHaveLength(1)
    expect(problems[0], JSON.stringify(html)).toContain("empty")
  }
})

test("a fragment over the most it may have is refused with its size alone and is not read further; one of exactly that many is not refused", () => {
  expect(padded(MOTION_HTML_MAX)).toHaveLength(MOTION_HTML_MAX)
  expect(lintFragment(padded(MOTION_HTML_MAX))).toEqual([])
  const long = lintFragment(padded(MOTION_HTML_MAX + 1))
  expect(long).toHaveLength(1)
  expect(long[0]).toContain(String(MOTION_HTML_MAX + 1))
  expect(long[0]).toContain(String(MOTION_HTML_MAX))
  // whatever else is wrong with it is left for when it is short enough
  const wrong = lintFragment(`${padded(MOTION_HTML_MAX + 1)}<canvas></canvas><script>fetch(1)`)
  expect(wrong).toHaveLength(1)
  expect(wrong[0]).toContain("more than")
})

test("the way a browser reads a comment that opens a script's escape is refused three ways: the comment, the second script, and the code it hides", () => {
  const html = `${FRAGMENT}<script><!--<script></script>\nlocation="x"\n--></script>`
  const problems = said(html)
  expect(problems).toContain("HTML comment")
  expect(problems).toContain("has 2 `<script` tags")
  expect(problems).toContain("has 2 `</script`")
  // the code the browser runs after the double escape is read as code: the last end tag ends it
  expect(problems).toContain("`location`")
})

test("no HTML comments, wherever they are; comments in CSS and in code are fine", () => {
  for (const html of [`${MOVING}<!-- a note -->`, `<style><!-- @keyframes a{to{opacity:0}} --></style><div>ก</div>`, `${MOVING}<div><!--</div>`, withCode("window.frame = (t) => {} // <!-- not a comment to the eye")]) {
    const problems = said(html)
    expect(problems, html).toContain("no HTML comments")
    expect(problems, html).toContain("`<!--`")
    // what it offers instead is what the contract offers: a comment in the styles, and none in the script
    expect(problems.split("\n"), html).toContain("has an HTML comment (`<!--`): no HTML comments; a CSS /* */ comment is fine")
  }
  expect(lintFragment(`<style>/* a note */.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div>`)).toEqual([])
  expect(lintFragment(withCode("// a note\n/* another */ window.frame = (t) => {}"))).toEqual([])
})

test("the finds of a fuzz against a browser's parser, each of which the parser read as markup where the check read code, are refused with the words of the rule that sees them", () => {
  const finds: [fragment: string, words: string[]][] = [
    [`${MOVING}<![CDATA[<script>x</math><b onclick=1>y</script>`, ["where no tag starts"]],
    [`${MOVING}<!x> <? &amp;<script>x</svg><img src=x onerror=1></script>`, ["where no tag starts"]],
    [`${MOVING}'<!<script>window.frame = (t) => {}</svg><iframe></iframe></script>`, ["where no tag starts"]],
    [`${MOVING}<noframes><script>window.frame = (t) => {}</svg><iframe></iframe></script>`, ["uses `<noframes>`"]],
    [`${MOVING}<use href="#a"> <svg><script>window.frame = (t) => {}</svg><iframe></iframe></script>`, ["has an `<svg>` that is never closed"]],
    [`${MOVING}<table> <!<script>x</svg><img src=x onerror=1></script>`, ["where no tag starts"]],
    [`${MOVING}<? </<script>window.frame = (t) => { const s = "</scr" + "ipt>" }</script>`, ["where no tag starts"]],
    [`${MOVING}<noembed> <use href="#a"><script>window.frame = (t) => {} // c</script>`, ["uses `<noembed>`"]],
  ]
  for (const [find, words] of finds) {
    const problems = said(find)
    for (const word of words) expect(problems, find).toContain(word)
  }
})

test("a script named in the styles is no script, and the markup after the styles is still read as markup: the script, the handler and the stray end tag are each refused with their own words", () => {
  const styled = (css: string) => `<style>${css}.a{animation:o 1s both}@keyframes o{to{opacity:0}}</style>`
  const trick = said(`${styled("/*<script>*/")}<div class="a" onclick=1>ก</div></script>`)
  expect(trick).toContain("has `<script` in the styles")
  expect(trick).toContain("has the event handler `onclick`: no inline event handlers")
  expect(trick).toContain("has a `</script` with no `<script>` before it")
  expect(lintFragment(`${styled("/* a note */")}<div class="a">ก</div>`)).toEqual([])
})

/** Every tag the design and the contract say a fragment may not have, written out by hand: the check that none of them is ever dropped from the list the linter is built from. */
const NOT_ALLOWED = [
  "html", "head", "body", "link", "meta", "base", "iframe", "object", "embed", "frame", "frameset", "applet", "portal", "img", "video", "audio", "canvas", "form", "template",
  "textarea", "title", "xmp", "plaintext", "noscript", "noembed", "noframes", "animate", "animateTransform", "animateMotion", "set",
]
const SMIL_SNIPPETS: [name: string, snippet: string][] = [
  ["<animate>", '<svg><animate attributeName="opacity" to="0" dur="1s"/></svg>'],
  ["<animateTransform>", '<svg><animateTransform attributeName="transform" type="rotate" to="90" dur="1s"/></svg>'],
  ["<animateMotion>", '<svg><animateMotion dur="1s" path="M0 0L9 9"/></svg>'],
  ["<set>", '<svg><set attributeName="opacity" to="0"/></svg>'],
]

test("each tag the fragment may not have is named when it is found, opened, closed, in capitals and with attributes; the list the linter is built from leaves out none the design names", () => {
  expect(REFUSED_TAGS).toEqual(expect.arrayContaining(NOT_ALLOWED))
  for (const name of REFUSED_TAGS) {
    for (const written of [`<${name}>`, `</${name}>`, `<${name.toUpperCase()}>`, `<${name} data-x="1">`]) expect(said(MOVING + written), written).toContain(`\`<${name}>\``)
  }
  // as they are written in real fragments: with attributes, inside an svg, and end tags on their own
  for (const [name, snippet] of [["<html>", '<html lang="th">'], ["<link>", '<link rel="stylesheet">'], ["<meta>", '<meta http-equiv="refresh" content="0">'], ["<base>", '<base href="#">'], ["<title>", "<svg><title>rocket</title></svg>"]]) {
    expect(said(MOVING + snippet), name).toContain(`\`${name}\``)
  }
  expect(said(`${MOVING}</body></html>`)).toContain("`<body>`")
  expect(said(`${MOVING}</body></html>`)).toContain("`<html>`")
  expect(said(`${MOVING}<CANVAS WIDTH=10></CANVAS>`)).toContain("`<canvas>`")
  expect(said(`${MOVING}<Meta HTTP-EQUIV=refresh>`)).toContain("`<meta>`")
})

test("the tags a browser reads as plain text are each told so, the SMIL tags are each told to animate with CSS, and no other tag is told either", () => {
  for (const name of RAW_TEXT_TAGS) expect(said(`${MOVING}<${name}>`), name).toContain("reads what is inside this element as plain text")
  for (const name of SMIL_TAGS) expect(said(`${MOVING}<svg><${name}/></svg>`), name).toContain("no SMIL elements: animate with CSS or el.animate()")
  for (const name of REFUSED_TAGS) {
    const problems = said(`${MOVING}<${name}>`)
    if (!(RAW_TEXT_TAGS as readonly string[]).includes(name)) expect(problems, name).not.toContain("as plain text")
    if (!(SMIL_TAGS as readonly string[]).includes(name)) expect(problems, name).not.toContain("SMIL")
  }
})

test("no SMIL elements: the renderer cannot seek them, so it is told to animate with CSS or el.animate()", () => {
  for (const [name, snippet] of SMIL_SNIPPETS) {
    const problems = said(MOVING + snippet)
    expect(problems, name).toContain(`\`${name}\``)
    expect(problems, name).toContain("no SMIL elements: animate with CSS or el.animate()")
  }
  expect(said(`${MOVING}<svg><ANIMATETRANSFORM/></svg>`)).toContain("`<animateTransform>`")
  // CSS animation and web animations are what to use, and the name of the element is not the name of the call
  expect(lintFragment(`<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style><div class="a">ก</div><script>document.querySelector('.a').animate([{opacity:1},{opacity:0}], {duration: 1000, fill: 'both'})</script>`)).toEqual([])
})

test("a tag that only starts like a forbidden one is not it: header, linearGradient, image, metadata, and the names of elements of your own", () => {
  const html = `${FRAGMENT}<header>ก</header><svg><defs><linearGradient id="g"/><image href="#a"/><metadata>x</metadata></defs><text>settings, format, based, a title</text></svg><object-fit-note>x</object-fit-note><bodyless>x</bodyless><set-note>x</set-note><animate-note>x</animate-note>`
  expect(lintFragment(html)).toEqual([])
})

test("code is not markup: what looks like a tag in a comparison is a comparison", () => {
  expect(lintFragment(withCode("const set = [1, 2], base = 3, meta = 4, form = 5; for (let i = 0; i<set.length; i++) { if (i<base && i<meta || i<form) {} }"))).toEqual([])
})

test("no inline event handlers: an on attribute is refused wherever it is and however it is spelled; attributes that only hold the letters are not", () => {
  const handlers = ['<svg onload="1"></svg>', "<div onclick=1></div>", "<div ONCLICK = '1'></div>", '<div class="a"onmouseover="1"></div>', '<svg\nonload\n=\n"1"></svg>', "<div onanimationend=1></div>"]
  for (const markup of handlers) {
    const problems = said(`${MOVING}${markup}`)
    expect(problems, markup).toContain("no inline event handlers")
    expect(problems, markup).toMatch(/`on[a-z]+`/)
  }
  expect(said(`${MOVING}<svg onload="location = 'x'"></svg>`)).toContain("put the code in the script block")
  for (const markup of ['<div style="animation:out 1s both" class="online one" data-online="1" title="on=1"></div>', "<p>one, only, once</p>", '<div id="on"></div>']) expect(lintFragment(`${MOVING}${markup}`), markup).toEqual([])
})

test("a URL in src, srcset or href is refused with the URL named; an href that points at a shape in the fragment is not", () => {
  const found: [attribute: string, value: string][] = [
    ["src", "https://example.com/a.png"],
    ["srcset", "https://example.com/a.png 2x"],
    ["href", "http://example.com/a.css"],
    ["href", "//example.com/a"],
    ["xlink:href", "https://example.com/a.svg"],
    ["href", "javascript:alert(1)"],
    ["src", "a.png"],
    ["href", "sprites.svg#a"],
  ]
  for (const [attribute, value] of found) {
    for (const written of [`${attribute}="${value}"`, `${attribute}='${value}'`, `${attribute}=${value.replace(/ .*/, "")}`, `${attribute} = "${value}"`]) {
      const problems = said(`${MOVING}<svg><use ${written}></use></svg>`)
      expect(problems, written).toContain(value.replace(/ .*/, ""))
      expect(problems, written).toContain(attribute)
    }
  }
  // in code a name is only a name: a variable called src or href holds a value, and loads nothing
  expect(lintFragment(withCode("const src = { x: 0, y: 0 }, href = 'a', dst = src; let s = src = dst; if (href == 'b') href = dst"))).toEqual([])
  // and the attribute is found in the markup around a script block, not only before it
  expect(said(`${MOVING}<svg><use href="https://example.com/a.svg#x"></use></svg><script>window.frame = (t) => {}</script>`)).toContain("https://example.com/a.svg#x")
  for (const value of ["#dxS", "#a b", "", " #x"]) expect(lintFragment(`${MOVING}<svg><use href="${value}"></use><use xlink:href="${value}"></use></svg>`), JSON.stringify(value)).toEqual([])
  // an attribute that only ends in src or href is not one
  expect(lintFragment(`${MOVING}<div data-src="https://example.com/a" data-href="a.png"></div>`)).toEqual([])
})

test("src and srcset take no value at all, not even a reference to a shape in the fragment: only href and xlink:href may point at one", () => {
  for (const attribute of ["src", "srcset"]) {
    const written: [markup: string, named: string][] = [
      [`${attribute}="#a"`, "#a"],
      [`${attribute}='#a'`, "#a"],
      [`${attribute} = "#a"`, "#a"],
      [`${attribute}=#a`, "#a"],
      [`${attribute}="#a 2x"`, "#a 2x"],
      [`${attribute}=" #a"`, "#a"],
      [`${attribute}="#"`, "#"],
    ]
    for (const [markup, named] of written) {
      const problems = said(`${MOVING}<svg><use ${markup}></use></svg>`)
      expect(problems, markup).toContain(`\`${attribute}="${named}"\``)
      expect(problems, markup).toContain("not even a reference to a shape in the fragment")
      expect(problems, markup).toContain('only href="#id" may point at a shape in the fragment')
    }
  }
  // href and xlink:href with the same values are the way to point at a shape, and an empty src loads nothing
  for (const attribute of ["href", "xlink:href"]) for (const value of ["#a", "#a 2x", " #a", "#"]) expect(lintFragment(`${MOVING}<svg><use ${attribute}="${value}"></use></svg>`), `${attribute}="${value}"`).toEqual([])
  for (const empty of ['src=""', "srcset=''", "src", 'src=" "']) expect(lintFragment(`${MOVING}<svg><use ${empty}></use></svg>`), empty).toEqual([])
  // in code they are names like any other, and an attribute that only ends in src is not one
  expect(lintFragment(withCode("const src = '#a', srcset = '#b'; el.data = src + srcset; window.frame = (t) => {}"))).toEqual([])
  expect(lintFragment(`${MOVING}<div data-src="#a" data-srcset="#b"></div>`)).toEqual([])
})

test("url( is refused unless it points at a shape in the fragment, and the call is named as it was written", () => {
  for (const call of ["url(https://example.com/a.png)", 'url("a.png")', "url('data:image/png;base64,AAAA')", "url(font.ttf)", "url( //example.com/a )", "url()", "URL(a.png)"]) {
    expect(said(css(`.b{background:${call}}`)), call).toContain(`\`${call}`)
  }
  // in an inline style and in code as well
  expect(said(`${MOVING}<div style="background:url(a.png)"></div>`)).toContain("`url(a.png)`")
  expect(said(withCode("el.style.background = 'url(a.png)'"))).toContain("`url(a.png)")
  for (const call of ["url(#clip)", 'url("#clip")', "url('#clip')", "url( #clip )", "url( '#clip' )", 'url(  "  #clip"  )', "URL(#clip)"]) {
    expect(lintFragment(css(`.b{clip-path:${call}}`)), call).toEqual([])
  }
  // one long call is named in part, and a call that spans lines is named on one line
  const long = said(css(`.b{background:url(data:image/png;base64,${"A".repeat(500)})}`))
  expect(long).toContain("url(data:image/png;base64,AAAA")
  expect(long.length).toBeLessThan(600)
  const spans = lintFragment(css(".b{background:url(\nhttps://example.com/a\n)}"))
  expect(spans).toHaveLength(1)
  expect(spans[0]).toContain("url( https://example.com/a )")
})

test("a run of url( is read at once, however long", () => {
  const started = performance.now()
  const problems = lintFragment(`<style>@keyframes a{to{opacity:0}}${"url(".repeat(9_000)}</style><div>ก</div>`)
  expect(performance.now() - started).toBeLessThan(2_000)
  expect(problems.join("\n")).toContain("`url(url(url(")
})

test("a run of comments after the name of an address is read at once, however long, and an assignment after them is still found", () => {
  const started = performance.now()
  for (const run of [`a.src${"/*a*/".repeat(30)}x`, `a.src${"/*a*//*b*/ ".repeat(2_000)}x`, "a.src/*".repeat(4_000), `a.src${"//c\n".repeat(5_000)}x`]) lintFragment(withCode(run))
  expect(performance.now() - started).toBeLessThan(2_000)
  expect(said(withCode(`a.src${"/*a*/".repeat(30)} = 'x'`))).toContain("`.src`")
})

test("@import is refused, in any case", () => {
  const style = (css: string) => `<style>${css}@keyframes a{to{opacity:0}}</style><div>ก</div>`
  expect(said(style('@import "a.css";'))).toContain("`@import`")
  expect(said(style("@IMPORT 'a.css';"))).toContain("`@import`")
  expect(said(style(".a{--x: important}"))).not.toContain("@import")
})

const REACHING_OUT: [name: string, code: string][] = [
  ["fetch", "fetch('https://example.com')"],
  ["XMLHttpRequest", "new XMLHttpRequest()"],
  ["WebSocket", "new WebSocket('wss://example.com')"],
  ["EventSource", "new EventSource('/events')"],
  ["sendBeacon", "sendBeacon('/log', 'x')"],
  ["Worker", "new Worker('a.js')"],
  ["SharedWorker", "new SharedWorker('a.js')"],
  ["ServiceWorker", "const s = ServiceWorker"],
  ["BroadcastChannel", "new BroadcastChannel('a')"],
  ["MessageChannel", "new MessageChannel()"],
  ["postMessage", "postMessage('x', '*')"],
  ["import", "import('./a.js')"],
  ["importScripts", "importScripts('a.js')"],
  ["eval", "eval('1 + 1')"],
  ["new Function", "new Function('return 1')()"],
  ["Function", "Function('return 1')()"],
  ["location", "location.href = '#a'"],
  ["document.cookie", "document.cookie = 'a=b'"],
  ["localStorage", "localStorage.setItem('a', 'b')"],
  ["sessionStorage", "sessionStorage.getItem('a')"],
  ["indexedDB", "indexedDB.open('a')"],
  ["navigator.", "navigator.userAgent"],
]

test("each way for code to reach the network, another thread or window, or the page's own address is named when it is found", () => {
  for (const [name, code] of REACHING_OUT) expect(said(withCode(code)), name).toContain(`\`${name}\``)
  // the ways it is spelled: a space before the bracket, another object in front, a line break, the name on its own
  expect(said(withCode("fetch ('#a')"))).toContain("`fetch`")
  expect(said(withCode("window.fetch('#a')"))).toContain("`fetch`")
  expect(said(withCode("const f = fetch; f('#a')"))).toContain("`fetch`")
  expect(said(withCode("const e = eval; e('1')"))).toContain("`eval`")
  expect(said(withCode("window.eval ('1')"))).toContain("`eval`")
  expect(said(withCode("import\n('./a.js')"))).toContain("`import`")
  expect(said(withCode("import x from './a.js'"))).toContain("`import`")
  expect(said(withCode("new  Function('1')"))).toContain("`new Function`")
  expect(said(withCode("const F = Function; F('1')"))).toContain("`Function`")
  expect(said(withCode("window.location = '#a'"))).toContain("`location`")
  expect(said(withCode("document . cookie"))).toContain("`document.cookie`")
  // and a name in a string is the name
  expect(said(withCode("const s = 'fetch'"))).toContain("`fetch`")
  // new Function is that alone, not Function as well
  expect(said(withCode("new Function('1')()"))).not.toContain("`Function`")
  // near misses are not the names
  expect(lintFragment(withCode("const prefetch = 1, importance = 2, evaluate = 3, Workers = 4, workerCount = 5, postMessages = 6, imported = 7, MyFunction = 8, functional = 9; evaluate.x = prefetch + importance"))).toEqual([])
})

test("every WebRTC name is refused, the prefixed ones too: a connection to another machine is not a graphic's", () => {
  for (const name of ["RTCPeerConnection", "RTCDataChannel", "RTCSessionDescription", "RTCIceCandidate", "RTCRtpSender", "RTCSctpTransport", "webkitRTCPeerConnection", "mozRTCPeerConnection"]) {
    const problems = said(withCode(`const c = new ${name}()`))
    expect(problems, name).toContain(`\`${name}\``)
    expect(problems, name).toContain("the graphic has no network")
  }
  expect(said(withCode("const P = window.RTCPeerConnection || window.webkitRTCPeerConnection"))).toContain("`webkitRTCPeerConnection`")
  // a name that only holds the letters, or has none of the shape of one, is not one
  expect(lintFragment(withCode("const RTC = 1, RTCs = 2, rtcPeer = 3, MyRTCPeer = 4, RTC_x = 5, RTC1 = 6, RTCก = 7, webkitRTC = 8, prefixRTCPeerConnection = 9; window.frame = (t) => {}"))).toEqual([])
})

test("open is refused wherever it is called, with or without something before the dot, and is told the name to use instead; window.open is refused even when it is not called", () => {
  const calls = ["open('https://example.com')", "window.open('#a')", "window . open ('#a')", "self.open(u, '_blank')", "w.open(u)", "doc.open()", "xhr.open('GET', u)", "const win = window.open('x')", "open\n('x')", "menu.open ()"]
  for (const code of calls) {
    const problems = said(withCode(code))
    expect(problems, code).toContain("`open(`")
    expect(problems, code).toContain("so call your own function launch")
  }
  // a call of window.open is that one problem, and a window.open kept without being called is the window's own
  expect(said(withCode("window.open('#a')"))).not.toContain("`window.open`")
  expect(said(withCode("const o = window.open; o('#a')"))).toContain("`window.open`")
  expect(said(withCode("const o = window . open"))).toContain("`window.open`")
  // names that hold the word, and the word without a call
  expect(lintFragment(withCode("const reopen = (x) => x, isOpen = 2, opened = 3, openers = 4; reopen(isOpen + opened); el.open = true; el.setAttribute('class', 'open'); const s = 'open', n = s.length"))).toEqual([])
})

test("code is what is checked for those: the script block, and only it; not the words on screen, a class name or the styles", () => {
  // the words on screen, and the names of classes and ids, are not code
  expect(lintFragment(`<style>.location-pin{top:0}#fetch{top:0}@keyframes out{to{opacity:0}}</style><div class="location" id="Date">ทำเล location, Date, fetch( และ setTimeout</div>`)).toEqual([])
  // the code is read wherever in the script it is, whatever comes after a comment
  expect(said(withCode("// fine\nwindow.frame = (t) => {}\nfetch('#a')"))).toContain("`fetch`")
  expect(said(`${MOVING}<script>window.frame = (t) => {}; location = "#a"</script>`)).toContain("`location`")
})

test("a Thai word does not join a forbidden name in another script, and a near miss is not the name", () => {
  // Thai letters are letters of a name in code: ราคาDate is one name, and so is Dateราคา
  expect(lintFragment(withCode("const ราคาDate = 1, Dateราคา = 2, ราคาfetch = (x) => x; ราคาfetch(1)"))).toEqual([])
  // words that hold a rule's word inside a longer one
  expect(lintFragment(withCode("const Candidate = 1, Update = 2, locations = 3, relocation = 4, prefetch = 5, mandate = 6, dataset = 7, evaluate = (x) => x; evaluate(1); prefetch(2)"))).toEqual([])
  expect(lintFragment(withCode("el.setAttribute('transform', 'translate(' + x + ',' + y + ')')"))).toEqual([])
  expect(lintFragment(css(".b{animation-duration:1s;transition-property:transform;translate:1px}"))).toEqual([])
  expect(lintFragment(withCode("el.style.animationDuration = '1s'"))).toEqual([])
  // but the name on its own, or after a dot, is caught
  expect(said(withCode("const d = Date"))).toContain("`Date`")
  expect(said(withCode("window.Date.now()"))).toContain("`Date`")
  expect(said(withCode("Date()"))).toContain("`Date`")
  // and it is case-sensitive: date is not Date
  expect(lintFragment(withCode("const date = 1, DATE = 2"))).toEqual([])
})

test("an escape can spell a name the rules refuse, so \\u and \\x are refused in code; the escapes that only make a character are not", () => {
  const spelled: [name: string, code: string][] = [
    ["\\u", 'window.frame = (t) => { const s = "\\u0066etch" }'],
    ["\\u", "const \\u0066 = 1"],
    ["\\u", "const s = '\\u{66}etch'"],
    ["\\x", "const s = '\\x66etch'"],
  ]
  for (const [name, code] of spelled) {
    const problems = said(withCode(code))
    expect(problems, code).toContain(`\`${name}\``)
    expect(problems, code).toContain("write the character itself")
  }
  expect(lintFragment(withCode("const a = 'u', b = 'x', n = '\\n\\t', q = '\\'', ก = 'ก', arrow = '→'; window.frame = (t) => {}"))).toEqual([])
})

const THE_WINDOW: [name: string, code: string][] = [
  ["window[", "window['fe' + 'tch']('#a')"],
  ["self[", "self['x']"],
  ["top[", "top['x']"],
  ["parent[", "parent[0]"],
  ["document[", "document['cookie']"],
  ["this[", "this['x']"],
  ["globalThis", "globalThis.x = 1"],
]

test("the window is not reached by a computed name: window[, self[, top[, parent[, document[, this[ and globalThis", () => {
  for (const [name, code] of THE_WINDOW) {
    const problems = said(withCode(code))
    expect(problems, code).toContain(`\`${name}\``)
    expect(problems, code).toContain("by a computed name")
  }
  expect(said(withCode("window ['x']"))).toContain("`window[`")
  expect(said(withCode("window.top['x']"))).toContain("`top[`")
  expect(said(withCode("this [0]"))).toContain("`this[`")
  expect(said(withCode("this\n['x']"))).toContain("`this[`")
  // names that only hold them, and the uses of the names that are not a computed reach for the window
  const fine = "window.frame = (t) => {}; const w = window.innerWidth, k = [[1]], v = k[0][0], kids = document.querySelectorAll('.a')[0], stopped = 1, topY = 2, parents = 3, thisWay = 4, r = el.getBoundingClientRect().top; el.parentNode.removeChild(el); d.style.top = '5px'; T[0]; const o = { f() { return this.x } }; const self2 = o, thisIs = [1]; thisIs[0]"
  expect(lintFragment(withCode(fine))).toEqual([])
})

test("frames, opener, top. and parent. are ordinary names: the render has no other window for them to reach, so a list of frames, an opener or a parent element passes", () => {
  const fine = [
    "const frames = [0, 1, 2]; frames[1] = 5; window.frame = (t) => { el.style.opacity = String(frames.length) }",
    "const opener = 1, framesPerBeat = 4; window.frame = (t) => {}",
    "const n = window.frames.length, first = frames[0], o = opener",
    "top.x = 1; parent.x = 1; window.top.x = 2; window.parent.x = 3",
    "(() => { const top = 5, parent = el.parentNode; el.style.top = top + 'px'; parent.removeChild(el) })()",
  ]
  for (const code of fine) expect(lintFragment(withCode(code)), code).toEqual([])
  // what is refused about the window is refused still
  expect(said(withCode("top['x']"))).toContain("`top[`")
  expect(said(withCode("globalThis.frames"))).toContain("`globalThis`")
})

const NAVIGATION: [name: string, code: string][] = [
  ["navigation", "navigation.navigate('#a')"],
  ["history.", "history.pushState(null, '', '#a')"],
  ["document.write", "document.write('x')"],
  ["document.write", "document.writeln('x')"],
  ["document.domain", "document.domain = 'example.com'"],
]

test("the page is not navigated or rewritten from code: navigation, history., document.write, document.domain", () => {
  for (const [name, code] of NAVIGATION) expect(said(withCode(code)), code).toContain(`\`${name}\``)
  // history is a name a list of earlier values might have, so the problem says what to call it instead
  expect(said(withCode("history.push(1)"))).toContain("call it past")
  expect(said(withCode("navigation.navigate('#a')"))).not.toContain("call it past")
  expect(lintFragment(withCode("const reopen = (x) => x, isOpen = 2, opened = 3, histogram = [], navigations = 4, writer = 5; reopen(1); histogram.push(isOpen + opened)"))).toEqual([])
})

const ADDRESSES: [problem: string, code: string][] = [
  ["`.href`", "a.href = 'https://example.com'"],
  ["`.href`", "a.href='x'"],
  ["`.action`", "f.action = 'https://example.com'"],
  ["`.srcdoc`", "i.srcdoc = '<p>x</p>'"],
  ["`.src`", "i.src = 'https://example.com/a.png'"],
  ["`.src`", "i.src += 'x'"],
  ["`.src`", "i.src ||= 'x'"],
  ["`.src`", "i.src ??= 'x'"],
  ["`.src`", "i.src &&= 'x'"],
  ["`.src`", "i.src\n  =\n  'x'"],
  ["`.src`", "i . src = 'x'"],
  ["`.src`", "i.src /* the address */ = 'x'"],
  ["`.src`", "i.src // the address\n = 'x'"],
  ["`.href`", "use.href.baseVal = '#a'"],
  ["`.href`", "const k = a.href = 'x'"],
  ['`["href"]`', 'a["href"] = "x"'],
  ['`["href"]`', 'const h = a["href"]'],
  ['`["src"]`', "a['src'] = 'x'"],
  ['`setAttribute("href")`', 'el.setAttribute("href", "#x")'],
  ['`setAttribute("src")`', "el.setAttribute('src', 'x')"],
  ['`setAttribute("action")`', 'el.setAttribute("action", "x")'],
  ['`setAttribute("srcdoc")`', 'el.setAttribute("srcdoc", "x")'],
  ['`setAttribute("formaction")`', 'el.setAttribute("formaction", "x")'],
  ['`setAttribute("xlink:href")`', "el.setAttribute('xlink:href', '#x')"],
  ['`setAttribute("xlink:href")`', 'el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#x")'],
]

test("an address is not set from code: .href, .action, .srcdoc and .src assigned, by any operator and however spaced; the bracket form; and setAttribute with those names", () => {
  for (const [problem, code] of ADDRESSES) {
    const problems = said(withCode(code))
    expect(problems, code).toContain(problem)
    expect(problems, code).toContain("an address cannot be set from code")
  }
  // the bracket form is told to read the address with a dot, by the name it was written with
  expect(said(withCode("const h = a['src']"))).toContain("read it as el.src")
  expect(said(withCode('const h = a["href"]'))).toContain("read it as el.href")
  // other names, a value called src, and names that only start with the letters
  const fine = "el.setAttribute('transform', 'translate(1,2)'); el.setAttribute('d', 'M0 0'); el.setAttribute('class', 'src'); el.setAttribute('id', 'href'); const srcs = [], hrefs = [], actions = 0, e = ev.srcElement, o = obj.source; el.setAttributeNS(null, 'r', 4); a.hrefLang = 'th'; a.srcs = 1; a.actions = 2; a.srcdocs = 3"
  expect(lintFragment(withCode(fine))).toEqual([])
})

test("an address may be read: .href, .action, .srcdoc and .src pass unless they are assigned, and a comparison is not an assignment", () => {
  const reads = [
    "const s = seg.src[0]",
    "const u = el.href, v = el.action, w = el.srcdoc, x = el.getAttribute('href')",
    "log(el.src); f(a.src, b.href); const o = { s: a.src, h: a.href }",
    "el.src.length; x = cond ? a.src : b.src; list.map((s) => s.src)",
    "if (a.href == 'x') {} if (a.href === b.href) {} if (a.href != 'x' || a.src !== 'y') {}",
    "const big = a.src >= 1, small = a.src <= 1, more = a.src > 1, less = a.src < 1",
    "const same = a.href === b.href ? a.src : b.src; for (const s of list) { if (s.src === target.src) count++ }",
    "const { src } = obj; const href = 'a'; let action = 1; action += 1",
  ]
  for (const code of reads) expect(lintFragment(withCode(code)), code).toEqual([])
  // an assignment on the same line as a read is still an assignment
  expect(said(withCode("const seen = a.src; a.src = seen + 1"))).toContain("`.src`")
})

test("setAttribute with an on… name sets a handler, not an address, and says so in words of its own", () => {
  for (const code of ['el.setAttribute("onanimationend", "1")', "el.setAttribute('onclick', 'x()')", 'el.setAttribute("ONLOAD", "x")', 'el.setAttributeNS(null, "onload", "x")', 'el.setAttributeNS("http://www.w3.org/1999/xlink", "onclick", "x")']) {
    const problems = said(withCode(code))
    expect(problems, code).toMatch(/uses `setAttribute\("on[a-z]+"\)`/i)
    expect(problems, code).toContain("an event handler, not an address")
    expect(problems, code).toContain("put the code in the script block")
    expect(problems, code).not.toContain("an address cannot be set")
  }
  // an address in the same call is the other sentence
  expect(said(withCode('el.setAttribute("href", "#x")'))).not.toContain("an event handler, not an address")
  // an attribute that only holds the letters on, or a value that does, is no handler
  expect(lintFragment(withCode("el.setAttribute('data-online', '1'); el.setAttribute('aria-live', 'on'); el.setAttribute('title', 'on=1'); el.setAttribute('class', 'online')"))).toEqual([])
})

test("nothing is clicked, submitted or sent as an event from code: .click(, .submit(, .requestSubmit(, dispatchEvent(", () => {
  for (const [name, code] of [[".click(", "a.click()"], [".submit(", "f.submit()"], [".requestSubmit(", "f.requestSubmit()"], ["dispatchEvent(", "el.dispatchEvent(new Event('x'))"]] as const) {
    expect(said(withCode(code)), code).toContain(`\`${name}\``)
  }
  expect(lintFragment(withCode("const clicks = 1, submitted = true, clickable = 2; el.clickable = clicks + clickable; if (submitted) window.frame = (t) => {}"))).toEqual([])
})

const HTML_SINKS = ["innerHTML", "outerHTML", "insertAdjacentHTML", "createContextualFragment", "DOMParser", "setHTMLUnsafe", "parseHTMLUnsafe"]

test("a string of HTML is not turned into elements: it could bring back the handlers, tags and addresses refused above", () => {
  for (const name of HTML_SINKS) expect(said(withCode(`el.${name} = 'x'`)), name).toContain(`\`${name}\``)
  expect(said(withCode(`el.innerHTML = '<img src=x onerror=1>'`))).toContain("createElementNS")
  expect(lintFragment(withCode("el.textContent = 'ก'; el.appendChild(document.createElementNS(NS, 'circle')); el.insertBefore(b, c)"))).toEqual([])
})

test("code does not make in an element what the markup may not hold: createElement and createElementNS with a forbidden tag are refused; the others are not", () => {
  // every tag the markup may not have, from the list the linter is built from, and a script
  for (const tag of [...REFUSED_TAGS, "script"]) {
    expect(said(withCode(`document.createElement("${tag}")`)), tag).toContain(`\`<${tag}>\` in code`)
    expect(said(withCode(`document.createElementNS(NS, '${tag}')`)), tag).toContain(`\`<${tag}>\` in code`)
  }
  expect(said(withCode('const f = document.createElement("FORM")'))).toContain("`<form>` in code")
  expect(lintFragment(withCode("const a = document.createElement('i'), b = document.createElementNS('http://www.w3.org/2000/svg', 'circle'), c = document.createElement('div'), d = document.createElementNS(NS, 'path'), e = document.createElement('span'), s = document.createElement('style')"))).toEqual([])
})

test("the page's own T is not declared again at the top of the script; declared inside a function, or used, it is fine", () => {
  for (const code of ["const T = 1", "let T = 1", "var T = 1", "function T() {}", "class T {}", "async function T() {}", "function* T() {}", "  const T = [1]\n  window.frame = (t) => {}", "(() => {})(); const T = 2", "if (1) {} var T = 3", "// a note\nconst T = 4"]) {
    const problems = said(withCode(code))
    expect(problems, code).toMatch(/declares `[^`]*\bT`/)
    expect(problems, code).toContain("the page already declares T")
  }
  const fine = [
    "(() => {\n  const T = (x, y) => 'translate(' + x + 'px,' + y + 'px)'\n  window.frame = (t) => { el.style.transform = T(t, 0) }\n})()",
    "const times = T; const dots = T[0] + T.length, TT = 1, t = 2; function f(T) { return T } for (const T of [1]) {} window.frame = (t) => {}",
    "const o = { T: 1 }; class A { constructor() { this.T = 1 } } // const T = 5\nconst s = 'const T = 6', r = `let T = ${o.T}`",
    "function draw() { var T = 1; return T }",
  ]
  for (const code of fine) expect(lintFragment(withCode(code)), code).toEqual([])
})

test("a // comment ends at any line terminator a script has, and so does a string never ended, so a declaration of T after one is at the top and is refused", () => {
  for (const [label, end] of [["a line feed", "\n"], ["a carriage return", "\r"], ["a carriage return and a line feed", "\r\n"], ["U+2028", "\u2028"], ["U+2029", "\u2029"]] as const) {
    const problems = said(withCode(`// a note${end}const T = 1`))
    expect(problems, label).toMatch(/declares `[^`]*\bT`/)
    expect(problems, label).toContain("the page already declares T")
  }
  // the same words inside the comment are a comment
  for (const end of ["\n", "\r", "\u2028", "\u2029"]) expect(lintFragment(withCode(`// const T = 1${end}window.frame = (t) => {}`)), JSON.stringify(end)).toEqual([])
  // a quote never ended stops at the end of its line, which a carriage return ends as a line feed does; a template runs on
  for (const end of ["\n", "\r"]) expect(said(withCode(`const s = 'never ended${end}const T = 1`)), JSON.stringify(end)).toMatch(/declares `[^`]*\bT`/)
  expect(lintFragment(withCode("const s = `a\rconst T = 1`"))).toEqual([])
})

const TIMERS: [name: string, code: string][] = [
  ["requestAnimationFrame", "requestAnimationFrame(tick)"],
  ["setTimeout", "setTimeout(tick, 100)"],
  ["setInterval", "setInterval(tick, 100)"],
  ["Date", "const start = Date.now()"],
  ["Date", "const now = new Date()"],
  ["performance.now", "const t = performance.now()"],
  ["Math.random", "const r = Math.random()"],
]

test("each way to read the clock or to leave time to the browser is named, with what to do instead", () => {
  for (const [name, code] of TIMERS) expect(said(withCode(code)), code).toContain(`\`${name}\``)
  expect(said(withCode("window.requestAnimationFrame(tick)"))).toContain("`requestAnimationFrame`")
  expect(said(withCode("performance . now()"))).toContain("`performance.now`")
  expect(said(withCode("Math . random()"))).toContain("`Math.random`")
  // the problems go to Claude in a repair, so they say what to use
  expect(said(withCode("setTimeout(tick, 100)"))).toContain("CSS animations or el.animate()")
  expect(said(withCode("requestAnimationFrame(tick)"))).toContain("window.frame")
  expect(said(withCode("Math.random()"))).toContain("same")
})

test("a name the renderer uses to find its own script, or to keep the fragment's, is refused in code; the words on screen may say anything", () => {
  for (const name of ["__timelines", "__hf", "hyperframe", "__player"]) {
    expect(said(withCode(`window.${name} = {}`)), name).toContain(`\`${name}\``)
    expect(said(withCode(`const s = '${name.toUpperCase()}'`)), name).toContain(`\`${name}\``)
    // on screen, or as the name of a class, it runs nothing and drops nothing
    expect(lintFragment(`${css(`.${name}{color:red}`)}<div class="${name}">${name} ${name.toUpperCase()}</div>`), name).toEqual([])
  }
  expect(said(withCode("const r = 'hyperframe.runtime.iife.js'"))).toContain("`hyperframe`")
  expect(said(withCode("window.__hf.buildReady.x = 1"))).toContain("`__hf`")
  expect(said(withCode("window.__HF_EXPORT_RENDER_SEEK_CONFIG = 1"))).toContain("`__hf`")
})

test("a fragment with nothing that moves is refused, and any one of a keyframes rule, el.animate and window.frame is enough", () => {
  const still = lintFragment(STATIC)
  expect(still).toHaveLength(1)
  for (const way of ["@keyframes", ".animate(", "window.frame"]) expect(still[0], way).toContain(way)
  expect(lintFragment(`${STATIC.replace("</style>", "@keyframes a{to{opacity:0}}</style>")}`)).toEqual([])
  expect(lintFragment(`${STATIC.replace("</style>", "@-webkit-keyframes a{to{opacity:0}}</style>")}`)).toEqual([])
  expect(lintFragment(`${STATIC}<script>document.querySelector('.a').animate([{opacity:0},{opacity:1}], {duration:400, fill:'both'})</script>`)).toEqual([])
  expect(lintFragment(`${STATIC}<script>window.frame = (t) => { document.querySelector('.a').style.opacity = String(t / 3) }</script>`)).toEqual([])
  // the CSS property alone moves nothing without keyframes to run
  expect(lintFragment(`${STATIC.replace("color:red", "animation: none")}`)).toHaveLength(1)
})

test("the reviewer's bypasses are all refused, each saying what it is", () => {
  const cases: [label: string, fragment: string, words: string[]][] = [
    ["a comment that opens the script's escape, hiding a second script and the code after it", `${FRAGMENT}<script><!--<script></script>\nlocation="x"\n--></script>`, ["HTML comment", "`<script`", "`location`"]],
    ["a script tag whose attribute holds a >", `${FRAGMENT}<script data-x="a>b" src="x.js">`, ["no attributes", "never closed"]],
    ["a script never closed", `${FRAGMENT}<script>location = "x"`, ["never closed", "`location`"]],
    ["a style never closed", `<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}<div class="a">ก</div>`, ["never closed"]],
    ["an inline handler", `${FRAGMENT}<svg onload="location='x'"></svg>`, ["no inline event handlers"]],
    ["a computed name", withCode('window["fe"+"tch"]("x")'), ["`window[`"]],
    ["an alias", withCode("const f = fetch; f('x')"), ["`fetch`"]],
    ["a link clicked", withCode('const a = document.createElement("a"); a.href = "https://x"; a.click()'), ["`.href`", "`.click(`"]],
    ["open", withCode('open("https://x")'), ["`open(`"]],
    ["navigation", withCode('navigation.navigate("https://x")'), ["`navigation`"]],
    ["a form", withCode('const f = document.createElement("form"); f.submit()'), ["`<form>` in code", "`.submit(`"]],
    ["a peer connection", withCode("new RTCPeerConnection()"), ["`RTCPeerConnection`"]],
    ["a name in a string", withCode('const s = "fetch"'), ["`fetch`"]],
  ]
  for (const [label, fragment, words] of cases) {
    const problems = lintFragment(fragment)
    expect(problems.length, label).toBeGreaterThan(0)
    for (const word of words) expect(problems.join("\n"), `${label}: ${word}`).toContain(word)
  }
})

test("every problem found is reported, each once, on a line of its own, whatever text it names", () => {
  const many = `${STATIC}<canvas></canvas><canvas></canvas><script>setTimeout(f, 1); setTimeout(g, 2); fetch('#a'); Math.random()</script>`
  const problems = lintFragment(many)
  expect(problems).toHaveLength(5)
  for (const heading of ["`<canvas>`", "`setTimeout`", "`fetch`", "`Math.random`", "has no animation"]) expect(problems.filter((problem) => problem.includes(heading)), heading).toHaveLength(1)
  // a tag with a URL in it is two problems: what it is, and where it points
  const both = lintFragment(`${MOVING}<img src="https://example.com/a.png">`)
  expect(both).toHaveLength(2)
  expect(both.join("\n")).toContain("`<img>`")
  expect(both.join("\n")).toContain("https://example.com/a.png")
  // text with line breaks in what it names is named on one line
  const broken = lintFragment(`${MOVING}<svg><use href="https://example.com/a\nb"></use></svg><div style="background:url(\nhttps://example.com/c\n)"></div>`)
  expect(broken.length).toBeGreaterThan(1)
  for (const problem of broken) expect(problem, problem).not.toMatch(/[\n\r]/)
  expect(broken.join("\n")).toContain("https://example.com/a b")
})

test("at most twelve problems are returned, then one line for the rest", () => {
  const names = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "RTCPeerConnection", "SharedWorker", "ServiceWorker", "BroadcastChannel", "MessageChannel", "postMessage", "setTimeout", "setInterval", "requestAnimationFrame", "importScripts", "localStorage"]
  const problems = lintFragment(withCode(names.map((name) => `${name}(0)`).join(";")))
  expect(problems).toHaveLength(13)
  expect(problems.slice(0, 12).every((problem) => /^uses `/.test(problem))).toBe(true)
  expect(problems[12]).toBe("and 4 more")
  // twelve exactly, and fewer, are all returned
  expect(lintFragment(withCode(names.slice(0, 12).map((name) => `${name}(0)`).join(";")))).toHaveLength(12)
  expect(lintFragment(withCode(names.slice(0, 3).map((name) => `${name}(0)`).join(";")))).toHaveLength(3)
})
