import { readdirSync, readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { lintCompose } from "./lint.ts"
import { SOUND_CODE_MAX } from "./spec.ts"

/** The functions the spike's real calls wrote for four moments of draft 0917; none needed a repair, and each rendered. */
const SPIKE = new URL("../../../../docs/plans/2026-10-01-sound-spike/out/", import.meta.url)
const spikeOutputs = () =>
  readdirSync(SPIKE)
    .filter((name) => /^v1-.*\.js$/.test(name))
    .sort()
    .map((name) => ({ name, code: readFileSync(new URL(name, SPIKE), "utf8") }))

/** What the linter says about a function, as one text. */
const said = (code: string) => lintCompose(code).join("\n")
/** A function with these lines for its body. */
const body = (code: string) => `function compose(ctx, cue, kit) {\n${code}\n}`
/** A small sound that passes: one plucked note on the first word. */
const PLUCK = body(`  const t = cue.words.length > 0 ? cue.words[0].atS : 0
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.frequency.value = kit.note("C5")
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  o.connect(g); g.connect(ctx.destination)
  o.start(t); o.stop(t + 0.35)`)

// what passes

test("the four functions the spike's real calls wrote all pass", () => {
  const all = spikeOutputs()
  expect(all.map(({ name }) => name)).toEqual(["v1-arrival.js", "v1-countdown.js", "v1-hook.js", "v1-rocket.js"])
  for (const { name, code } of all) expect(lintCompose(code), name).toEqual([])
})

test("the idioms of a well-made function pass: helpers, arrows, comments, strings, templates that build a note's name, divisions, and names that only hold a refused one", () => {
  const code = body(`  // a bus with a little room on it; open the filter as the window of silence comes
  /* the top note rings on: no setTimeout, the parent gain holds it */
  const out = ctx.createGain(), room = kit.reverb(1.2, 5)
  out.gain.value = 0.7; out.connect(ctx.destination); room.connect(out)
  const names = ["C", "E", "G"], octave = 5
  const notes = names.map((n, i) => kit.note(\`\${n}\${octave + (i > 1 ? 1 : 0)}\`))
  const label = "fetch the window, open the document at the top" + 'self' + \`location \${"history"}\`
  const half = cue.length / 2, step = (notes.length - 1) / 4, third = notes[0] / 3, ratio = (half) / step
  let gain = 1; gain /= 2
  function pluck(f, t, amp) {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = "square"; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(amp, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    o.connect(g); g.connect(out); g.connect(room)
    o.start(t); o.stop(t + 0.3)
    return { o, g }
  }
  const prefetch = 1, topNote = 2, reopen = 3, windowed = 4, selfish = 5, documented = 6, Dates = 7, performances = 8, frameCount = 9, parents = 10
  const importance = 11, evaluate = 12, myFunction = 13, asyncish = 14, awaiting = 15, Promises = 16, thenable = 17, opened = 18, AudioContexts = 19
  const ราคาDate = 20, fetchราคา = 21, histories = 22, locations = 23, caching = 24, navigators = 25
  const frames = Math.ceil(0.05 * ctx.sampleRate), levels = { top: 0.8, parent: 0.5, self: 0.2, open: 0.1 }, history = [], wide = levels.top / frames
  const filter = { open: 1 }, gate = filter.open, top2 = levels.top
  class Voice { constructor(f) { this.f = f } }
  const voice = new Voice(220)
  const buffer = ctx.createBuffer(1, Math.ceil(0.05 * ctx.sampleRate), ctx.sampleRate), data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (kit.rand() * 2 - 1) * Math.pow(1 - i / data.length, 3)
  cue.words.forEach((w, i) => pluck(notes[i % notes.length], w.atS, 0.2 / (i + 1)))
  if (cue.words.length === 0) pluck(notes[0], 0, label.length > 0 ? half / cue.length : ratio)
  const left = { a: 1 }.a / 2, count = [1, 2][0] / 2, scaled = Math.random() * 2 / 3`)
  expect(lintCompose(code)).toEqual([])
  expect(lintCompose(PLUCK)).toEqual([])
})

test("the function's head may be spaced as Claude likes, and white space around the whole is not counted", () => {
  for (const head of ["function compose(ctx, cue, kit) {", "function compose(ctx,cue,kit){", "function  compose ( ctx , cue , kit ) {", "function compose(\n  ctx,\n  cue,\n  kit\n)\n{"]) {
    expect(lintCompose(`${head}\n  const o = ctx.createOscillator()\n}`), head).toEqual([])
  }
  expect(lintCompose(`\n\n  ${PLUCK}\n\n`)).toEqual([])
  // one semicolon after the closing brace is fine: the harness leaves it out
  expect(lintCompose(`${PLUCK};`)).toEqual([])
  expect(lintCompose(`${PLUCK} ;\n`)).toEqual([])
})

// the shape

test("empty code, or code of white space alone, is refused with that one problem", () => {
  for (const code of ["", "   ", "\n\t \n"]) {
    const problems = lintCompose(code)
    expect(problems, JSON.stringify(code)).toHaveLength(1)
    expect(problems[0], JSON.stringify(code)).toContain("empty")
  }
})

test("code over the most it may have is refused with its size alone and is not read further; code of exactly that many is not refused", () => {
  const padded = (length: number) => PLUCK.replace("{\n", `{\n/*${"x".repeat(length - PLUCK.length - "/**/".length)}*/`)
  expect(padded(SOUND_CODE_MAX)).toHaveLength(SOUND_CODE_MAX)
  expect(lintCompose(padded(SOUND_CODE_MAX))).toEqual([])
  const long = lintCompose(padded(SOUND_CODE_MAX + 1))
  expect(long).toHaveLength(1)
  expect(long[0]).toContain(String(SOUND_CODE_MAX + 1))
  expect(long[0]).toContain(String(SOUND_CODE_MAX))
  // whatever else is wrong with it is left for when it is short enough
  const wrong = lintCompose(`fetch(1)\n${padded(SOUND_CODE_MAX + 1)}`)
  expect(wrong).toHaveLength(1)
  expect(wrong[0]).toContain("more than")
})

test("anything before the function is refused, and the problem names what it starts with", () => {
  const before = [
    ["Here is the sound:\n", "starts with `Here is the sound:"],
    // the problem's own backtick, then the fence's three
    ["```js\n", "starts with ````js function compose"],
    ["// a pluck on the first word\n", "starts with `// a pluck on the first word"],
    ['"use strict";\n', 'starts with `"use strict";'],
  ]
  for (const [lead, problem] of before) {
    const problems = said(`${lead}${PLUCK}`)
    expect(problems, lead).toContain(problem)
    expect(problems, lead).toContain("instead of `function compose(ctx, cue, kit) {`")
  }
  // another way to write the function, other parameters, or another name
  for (const code of [
    PLUCK.replace("function compose(ctx, cue, kit) {", "const compose = function (ctx, cue, kit) {"),
    PLUCK.replace("function compose(ctx, cue, kit) {", "const compose = (ctx, cue, kit) => {"),
    PLUCK.replace("function compose(ctx, cue, kit) {", "function compose(ctx, cue) {"),
    PLUCK.replace("function compose(ctx, cue, kit) {", "function compose(ctx, cue, kit, extra) {"),
    PLUCK.replace("function compose(ctx, cue, kit) {", "function sound(ctx, cue, kit) {"),
    PLUCK.replace("function compose(ctx, cue, kit) {", "function compose(ctx, cue, kit) /* body */ {"),
    PLUCK.replace("function compose(ctx, cue, kit) {", "function* compose(ctx, cue, kit) {"),
  ]) {
    expect(said(code), code.split("\n")[0]).toContain("instead of `function compose(ctx, cue, kit) {`")
  }
})

test("a second top-level statement after the function is refused, and so is anything else after its closing brace", () => {
  const after = [
    ["\nfunction helper() {}", "has `function helper() {}` after the function's closing brace"],
    ["\ncompose(ctx, cue, kit)", "has `compose(ctx, cue, kit)` after the function's closing brace"],
    [", 1", "has `, 1` after the function's closing brace"],
    [";;", "has `;;` after the function's closing brace"],
    ["; fetch(1)", "has `; fetch(1)` after the function's closing brace"],
    [" // done", "has `// done` after the function's closing brace"],
    // the problem's own backticks around the fence's three
    ["\n```", "has ````` after the function's closing brace"],
  ]
  for (const [tail, problem] of after) expect(said(`${PLUCK}${tail}`), tail).toContain(problem)
  // the function closed early by a brace too many, and the code after it, put on one line
  expect(said(body("  const o = ctx.createOscillator() }\n  o.start(0)"))).toContain("has `o.start(0) }` after the function's closing brace")
})

test("a function whose braces never close is refused; braces in strings, comments and the text of templates are not counted", () => {
  expect(said("function compose(ctx, cue, kit) {\n  if (cue.length > 1) {\n    const o = ctx.createOscillator()\n}")).toContain("never closes")
  expect(said("function compose(ctx, cue, kit) {")).toContain("never closes")
  const counted = body(`  const a = "}", b = '{', c = \`}{\${"}"}\`
  // }
  /* { */
  const d = { e: { f: 1 } }`)
  expect(lintCompose(counted)).toEqual([])
  // a brace in a string does not close the function either
  expect(said('function compose(ctx, cue, kit) {\n  const a = "}"')).toContain("never closes")
})

// the names

/** One case for each name refused: the name the problem names, and a line of code that uses it. */
const REFUSED: [name: string, code: string][] = [
  // the network
  ["fetch", "fetch('https://example.com')"],
  ["XMLHttpRequest", "new XMLHttpRequest()"],
  ["WebSocket", "new WebSocket('wss://example.com')"],
  ["EventSource", "new EventSource('/events')"],
  ["sendBeacon", "sendBeacon('/log', 'x')"],
  ["RTCPeerConnection", "new RTCPeerConnection()"],
  ["RTCDataChannel", "const c = RTCDataChannel"],
  ["webkitRTCPeerConnection", "new webkitRTCPeerConnection()"],
  // other threads and channels
  ["Worker", "new Worker('a.js')"],
  ["SharedWorker", "new SharedWorker('a.js')"],
  ["ServiceWorker", "const s = ServiceWorker"],
  ["postMessage", "postMessage('x', '*')"],
  ["BroadcastChannel", "new BroadcastChannel('a')"],
  ["MessageChannel", "new MessageChannel()"],
  // loading or making code
  ["import", "import('./a.js')"],
  ["importScripts", "importScripts('a.js')"],
  ["eval", "eval('1 + 1')"],
  ["Function", "new Function('return 1')()"],
  ["constructor", "kit.note.constructor('return 1')()"],
  // the page and the browser
  ["document", "document.title"],
  ["window", "window.x = 1"],
  ["self", "self.x = 1"],
  ["globalThis", "globalThis.x = 1"],
  ["top", "top.x = 1"],
  ["parent", "parent.x = 1"],
  ["frames", "const n = frames.length"],
  ["location", "location.href = '#a'"],
  ["location", "location['href'] = '#a'"],
  ["location", "location = 'https://example.com'"],
  ["navigator", "navigator.userAgent"],
  ["history", "history.back()"],
  ["localStorage", "localStorage.setItem('a', 'b')"],
  ["sessionStorage", "sessionStorage.getItem('a')"],
  ["indexedDB", "indexedDB.open('a')"],
  ["caches", "caches.keys()"],
  ["open", "open('https://example.com')"],
  ["open", "open .call(null, 'x')"],
  // time
  ["setTimeout", "setTimeout(() => {}, 100)"],
  ["setInterval", "setInterval(() => {}, 100)"],
  ["requestAnimationFrame", "requestAnimationFrame(() => {})"],
  ["queueMicrotask", "queueMicrotask(() => {})"],
  ["Date", "const now = Date.now()"],
  ["performance", "const now = performance.now()"],
  // audio outside the given context
  ["AudioContext", "const live = new AudioContext()"],
  ["webkitAudioContext", "const live = new webkitAudioContext()"],
  ["OfflineAudioContext", "const other = new OfflineAudioContext(2, 48000, 48000)"],
  ["decodeAudioData", "ctx.decodeAudioData(bytes)"],
  ["createMediaElementSource", "ctx.createMediaElementSource(el)"],
  ["createMediaStreamSource", "ctx.createMediaStreamSource(stream)"],
  ["createMediaStreamDestination", "ctx.createMediaStreamDestination()"],
  ["audioWorklet", "ctx.audioWorklet.addModule('a.js')"],
  ["AudioWorkletNode", "new AudioWorkletNode(ctx, 'a')"],
  // promises
  ["async", "const later = async () => 1"],
  ["await", "await 1"],
  ["Promise", "Promise.resolve(1)"],
  [".then(", "p.then((b) => b)"],
  // the context, which the app renders
  [".startRendering(", "ctx.startRendering()"],
  [".suspend(", "ctx.suspend(1)"],
  [".resume(", "ctx . resume ()"],
]

test("each name refused is named when it is found, one case for each, with what to do instead", () => {
  for (const [name, code] of REFUSED) {
    const problems = lintCompose(body(`  ${code}`))
    expect(problems.join("\n"), name).toContain(`uses \`${name}\`: `)
    // the problem says what to do: its advice follows the name
    for (const problem of problems) expect(problem.length, problem).toBeGreaterThan(`uses \`${name}\`: `.length + 20)
  }
  // and the same functions without the refused line pass
  expect(lintCompose(body("  const n = 1"))).toEqual([])
})

test("each group of names gives the advice of its own", () => {
  expect(said(body("  fetch(1)"))).toContain("the sound has no network")
  expect(said(body("  new Worker(1)"))).toContain("no other thread or channel")
  expect(said(body("  import('x')"))).toContain("no other code can be loaded")
  expect(said(body("  eval('1')"))).toContain("code cannot be made from text")
  expect(said(body("  window.x = 1"))).toContain("no page and no browser")
  expect(said(body("  setTimeout(f, 1)"))).toContain("rendered offline")
  expect(said(body("  Date.now()"))).toContain("kit.rand()")
  expect(said(body("  new AudioContext()"))).toContain("the ctx you are given")
  expect(said(body("  Promise.resolve(1)"))).toContain("nothing waits")
})

test("the ways a refused name is spelled are all found: after a dot, called with a space, on its own, at the start of a line, the WebRTC family by its prefix", () => {
  expect(said(body("  window.fetch('#a')"))).toContain("`fetch`")
  expect(said(body("  fetch ('#a')"))).toContain("`fetch`")
  expect(said(body("  const f = fetch"))).toContain("`fetch`")
  expect(said(body("fetch(1)"))).toContain("`fetch`")
  expect(said(body("  import\n('./a.js')"))).toContain("`import`")
  expect(said(body("  const m = import.meta"))).toContain("`import`")
  expect(said(body("  p . then (f)"))).toContain("`.then(`")
  expect(said(body("  p./* then */then(f)"))).toContain("`.then(`")
  for (const name of ["RTCIceCandidate", "RTCRtpSender", "mozRTCPeerConnection", "RTC_x", "RTC1"]) expect(said(body(`  const c = ${name}`)), name).toContain(`\`${name}\``)
  // a name is case-sensitive, and one that only holds the letters is another name
  expect(lintCompose(body("  const date = 1, DATE = 2, Open = 3, Window = 4, RTC = 5, rtcPeer = 6, MyRTCPeer = 7, then = 8, x = then(1)"))).toEqual([])
})

test("a refused name inside a string or a comment passes: only the code is read", () => {
  const strings = ["'fetch'", '"window.open"', "`setTimeout`", '"new AudioContext()"', "'Promise.then('", '"import x from y"', "'eval'", '"async await"']
  for (const text of strings) expect(lintCompose(body(`  const s = ${text}`)), text).toEqual([])
  const comments = ["// fetch the window", "/* setTimeout(open) */", "/*\n  async: no, document: no\n*/", "// .then(", "// new Function"]
  for (const text of comments) expect(lintCompose(body(`  ${text}\n  const n = 1`)), text).toEqual([])
  // a string that holds a quote of the other kind, an escaped quote, or a comment's opening is still a string
  expect(lintCompose(body(`  const a = "it's // fine", b = 'say \\"fetch\\" /* here', c = "a \\" fetch"`))).toEqual([])
  // and the code after it is read again
  expect(said(body(`  const a = "it's"; fetch(1)`))).toContain("`fetch`")
  expect(said(body(`  // fine\n  fetch(1)`))).toContain("`fetch`")
  expect(said(body(`  /* fine */ fetch(1)`))).toContain("`fetch`")
})

test("the code inside a template's ${ } is code, however deep, and is read for names; the template's own text is not", () => {
  expect(said(body("  const n = `C${fetch(1)}`"))).toContain("`fetch`")
  expect(said(body("  const n = `a${ `b${ `c${ window.x }` }` }`"))).toContain("`window`")
  expect(said(body("  const n = `a${ { k: 1 }.k }b${ eval('1') }`"))).toContain("`eval`")
  // the text around it is not, and the code after the template is read again
  expect(lintCompose(body("  const n = `fetch ${1 + 1} window`"))).toEqual([])
  expect(said(body("  const n = `fetch ${1} window`; open(1)"))).toContain("`open`")
})

test("a \\u or \\x escape is refused anywhere, in a string or a comment too, since it can spell a name the rules refuse", () => {
  const spelled: [name: string, code: string][] = [
    ["\\u", 'const s = "\\u0066etch"'],
    ["\\u", "const \\u0066 = 1"],
    ["\\u", "const s = '\\u{66}etch'"],
    ["\\x", "const s = '\\x66etch'"],
    ["\\u", "// \\u0066"],
    ["\\x", "const s = `\\x66`"],
  ]
  for (const [name, code] of spelled) {
    const problems = said(body(`  ${code}`))
    expect(problems, code).toContain(`\`${name}\``)
    expect(problems, code).toContain("write the character itself")
  }
  // the escapes that only make a character are fine
  expect(lintCompose(body("  const a = 'u', b = 'x', n = '\\n\\t', q = '\\'', ก = 'ก', arrow = '→'"))).toEqual([])
})

// what the check cannot read for certain

test("a regular expression is refused wherever a value starts, since what is in it could hide code from the check; a division is not", () => {
  const regexes = [
    'const r = /"/; fetch("x") // "',
    "const r = /[/*]/; const n = 1 /[*/]/",
    "if (cue.length) /a/.test('a')",
    "while (false) /a/",
    "const ok = (s) => /a/.test(s)",
    "const list = [/a/, 1]",
    "f(/a/)",
    "return /a/",
    "const t = typeof /a/",
    "{ const n = 1 } /a/.test('a')",
    "const n = `${/a/}`",
    "const n = !/a/.test('b')",
  ]
  for (const code of regexes) expect(said(body(`  ${code}`)), code).toContain("regular expression")
  // the one that hid a name is caught by both rules: the name is read as code, as it runs
  expect(said(body('  const r = /"/; fetch("x") // "'))).toContain("`fetch`")
  const divisions = ["const a = 1 / 2", "const a = cue.length / 2", "const a = (1 + 2) / 3", "const a = [4][0] / 2", "let a = 4; a /= 2", "const a = 'ab'.length / 2", "const a = `ab`.length / 2", "const a = 3 / 2 / 1"]
  for (const code of divisions) expect(lintCompose(body(`  ${code}`)), code).toEqual([])
})

test("an HTML comment's opening or closing in code is refused, since a browser may read the rest of the line as a comment; in a string it is text", () => {
  expect(said(body("  const n = 1 <!-- 2"))).toContain("`<!--`")
  expect(said(body("  let i = 3; while (i-->0) {}"))).toContain("`-->`")
  expect(said(body("-->\n  const n = 1"))).toContain("`-->`")
  expect(lintCompose(body("  const s = '<!-- -->'"))).toEqual([])
  expect(lintCompose(body("  let i = 3; while (i-- > 0) {}"))).toEqual([])
})

test("a string, template or comment that never ends is refused, each with its kind", () => {
  expect(said(body('  const s = "never ended\n  const n = 1'))).toContain("a string that never ends")
  expect(said(body("  const s = 'never ended"))).toContain("a string that never ends")
  expect(said("function compose(ctx, cue, kit) {\n  const s = `never ended\n}")).toContain("a template that never ends")
  expect(said("function compose(ctx, cue, kit) {\n  /* never ended\n}")).toContain("a comment that never ends")
})

// the list

test("every problem found is reported, each once, on a line of its own", () => {
  const problems = lintCompose(body("  fetch(1); fetch(2)\n  setTimeout(f)\n  window.x = 1; window.y = 2"))
  expect(problems.filter((problem) => problem.includes("`fetch`"))).toHaveLength(1)
  expect(problems.filter((problem) => problem.includes("`window`"))).toHaveLength(1)
  expect(problems.filter((problem) => problem.includes("`setTimeout`"))).toHaveLength(1)
  expect(problems).toHaveLength(3)
  for (const problem of problems) expect(problem).not.toMatch(/\n/)
  // what a problem names across lines is put on one
  for (const problem of lintCompose(`${PLUCK}\nconst a = 1\nconst b = 2`)) expect(problem).not.toMatch(/\n/)
})

test("at most twelve problems are returned, then one line for the rest", () => {
  const names = ["fetch", "WebSocket", "Worker", "eval", "document", "window", "navigator", "setTimeout", "Date", "AudioContext", "Promise", "caches", "history", "location"]
  const problems = lintCompose(body(names.map((name) => `  ${name}.x = 1`).join("\n")))
  expect(problems).toHaveLength(13)
  expect(problems[12]).toBe("and 2 more")
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/sound/lint")
  expect(exported.lintCompose).toBe(lintCompose)
})

test("a function's constructor is refused when it is read, which is Function by another name; a class's own constructor, or a key of that name, passes", () => {
  for (const code of ["kit.note.constructor('return 1')()", "const F = (() => {}) . constructor", "const F = o?.constructor"]) expect(said(body(`  ${code}`)), code).toContain("`constructor`")
  expect(lintCompose(body("  class Voice { constructor(f) { this.f = f } }\n  const v = new Voice(1), o = { constructor: 1 }"))).toEqual([])
})

test("the page's own names that are also plain words are refused only as the page's: not after a dot, and followed by a dot, a bracket or a call", () => {
  const refused: [name: string, code: string][] = [
    ["self", "self.x = 1"],
    ["self", "self['x']"],
    ["top", "top.x = 1"],
    ["top", "top [0]"],
    ["parent", "parent.postMessage"],
    ["frames", "frames[0]"],
    ["frames", "frames\n  .length"],
    ["open", "open('x')"],
    ["open", "open /* now */ ('x')"],
    ["history", "history.back()"],
    ["location", "location['href']"],
    ["location", "location.reload()"],
    ["location", "location = 'x'"],
    ["location", "location += '#a'"],
    // optional chaining, and a tagged template, which is a call
    ["top", "top?.x"],
    ["top", "top ?. [0]"],
    ["open", "open?.('x')"],
    ["open", "open`x`"],
    ["self", "self ?.\n  x"],
  ]
  for (const [name, code] of refused) expect(said(body(`  ${code}`)), code).toContain(`\`${name}\``)
  const passing = [
    "const frames = 4800, n = frames * 2",
    "const levels = { top: 0.8, parent: 0.5, self: 0.2, open: 0.1, history: 0, frames: 2, location: 3 }",
    "const filter = { open: 1 }; const g = filter.open + filter . top + filter?.self + filter?.open?.(1)",
    "const top = 0.8, bright = top ? 1 : 0, label = `top`, tag = top + `x`",
    "const gate = { open: () => 1 }; gate.open()",
    "let history = []; history = [1]",
    "const top = 0.8, parent = 1, self = 2, open = 3; const sum = top + parent + self + open",
    "const location = 2, same = location === 2, near = location <= 3, far = location >= 1, other = location != 4",
  ]
  for (const code of passing) expect(lintCompose(body(`  ${code}`)), code).toEqual([])
  // the page's names that are never a value of one's own are refused as bare words still
  for (const name of ["document", "window", "globalThis", "navigator"]) {
    expect(said(body(`  const ${name} = 1`)), name).toContain(`\`${name}\``)
    expect(said(body(`  const o = { ${name}: 1 }`)), name).toContain(`\`${name}\``)
  }
})

test("starting, suspending or resuming the context is refused, called on anything, and told that the app renders it", () => {
  for (const name of ["startRendering", "suspend", "resume"]) {
    const problems = said(body(`  ctx.${name}()`))
    expect(problems, name).toContain(`uses \`.${name}(\``)
    expect(problems, name).toContain("the app renders the context once the function returns; do not start, suspend or resume it")
  }
  expect(said(body("  other . startRendering (1)"))).toContain("`.startRendering(`")
  // the words alone, or not called, are not it
  expect(lintCompose(body("  const resume = 1, suspend = 2, startRendering = 3, f = ctx.resume"))).toEqual([])
})

test("a / after ++ or -- that follow a value, or after a number's point, divides", () => {
  for (const code of ["let i = 4; const a = i++ / 2", "let i = 4; const a = i-- / 2", "const a = 1. / 2", "const a = 10.5 / 2", "let i = 4; const a = i ++ / 2"]) {
    expect(lintCompose(body(`  ${code}`)), code).toEqual([])
  }
  // ++ or -- before a value leaves one expected, and a / there starts a regular expression
  expect(said(body("  let x = ++/a/.lastIndex"))).toContain("regular expression")
  expect(said(body("  let x = -/a/.lastIndex"))).toContain("regular expression")
})
