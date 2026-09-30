// Drives the built BOXBLACK app over the Chrome DevTools Protocol (port 9333).
//   node ui.mjs text [css]              visible text of the page (or of the first element matching css)
//   node ui.mjs list [substring]        buttons, links, inputs, dialogs with their names
//   node ui.mjs click "<name>" [nth]    real mouse click on the nth element whose aria-label or text matches (css:<sel> too)
//   node ui.mjs key <Key>               a real key press (Escape, Enter, Tab ...)
//   node ui.mjs eval "<js>"             evaluates in the page (awaits promises)
//   node ui.mjs shot <file.png>         screenshot
//   node ui.mjs wait "<text>" [ms]      waits for text on the page; "!<text>" waits for it to go
//   node ui.mjs size <w> <h>            sets the window's content size
const PORT = 9333
const [cmd, ...args] = process.argv.slice(2)

const norm = (s) => (s ?? "").normalize("NFKC").replace(/ํา/g, "ำ").replace(/\s+/g, " ").trim().toLowerCase()

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === "page")
  if (!page) throw new Error("no page")
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad })
  let id = 0
  const waiting = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id) }
  }
  const send = (method, params = {}) => new Promise((ok, bad) => {
    const n = ++id
    waiting.set(n, (msg) => (msg.error ? bad(new Error(JSON.stringify(msg.error))) : ok(msg.result)))
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  return { send, close: () => ws.close() }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, replMode: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

const FIND = `(query, nth, norm) => {
  const n = (s) => (s ?? "").normalize("NFKC").replace(/\\u0e4d\\u0e32/g, "\\u0e33").replace(/\\s+/g, " ").trim().toLowerCase()
  let els
  if (query.startsWith("css:")) els = [...document.querySelectorAll(query.slice(4))]
  else {
    const q = n(query)
    const all = [...document.querySelectorAll("button, a, [role=button], [role=tab], [role=menuitem], [role=option], input, select, textarea, label, summary, li, span, p, h1, h2, h3")]
    const visible = all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    els = visible.filter((el) => n(el.getAttribute("aria-label")) === q || n(el.textContent) === q)
    if (els.length === 0) els = visible.filter((el) => n(el.getAttribute("aria-label")).includes(q) || n(el.textContent).includes(q))
    const clickable = els.filter((el) => el.matches("button, a, [role=button], [role=tab], [role=menuitem], [role=option], input, select, summary"))
    if (clickable.length) els = clickable
  }
  const el = els[nth]
  if (!el) return null
  el.scrollIntoView({ block: "center" })
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!el.disabled, text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 80) }
}`

const cdp = await connect()
try {
  if (cmd === "text") {
    const css = args[0]
    console.log(await evaluate(cdp, css ? `document.querySelector(${JSON.stringify(css)})?.innerText ?? "(none)"` : "document.body.innerText"))
  } else if (cmd === "list") {
    const sub = norm(args[0] ?? "")
    const items = await evaluate(cdp, `[...document.querySelectorAll("button, a, [role=button], [role=tab], [role=dialog], input, select, textarea")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
      .map((el) => ({ tag: el.getAttribute("role") || el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || el.textContent || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 90), disabled: !!el.disabled, title: el.title || "" }))`)
    for (const i of items) if (!sub || norm(i.name).includes(sub)) console.log(`${i.tag}${i.disabled ? " (disabled)" : ""}: ${i.name}${i.title ? `  [title: ${i.title}]` : ""}`)
  } else if (cmd === "click") {
    const [name, nth = "0"] = args
    const at = await evaluate(cdp, `(${FIND})(${JSON.stringify(name)}, ${Number(nth)})`)
    if (!at) throw new Error(`nothing named ${name}`)
    if (at.disabled) throw new Error(`"${at.text}" is disabled`)
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await cdp.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 })
    }
    console.log(`clicked "${at.text}"`)
  } else if (cmd === "key") {
    const key = args[0]
    const codes = { Escape: 27, Enter: 13, Tab: 9 }
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: codes[key] ?? 0 })
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: codes[key] ?? 0 })
    console.log(`pressed ${key}`)
  } else if (cmd === "eval") {
    console.log(JSON.stringify(await evaluate(cdp, args[0]), null, 1))
  } else if (cmd === "shot") {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" })
    const { writeFileSync } = await import("node:fs")
    writeFileSync(args[0], Buffer.from(data, "base64"))
    console.log(`saved ${args[0]}`)
  } else if (cmd === "wait") {
    const [raw, ms = "20000"] = args
    const gone = raw.startsWith("!")
    const want = norm(gone ? raw.slice(1) : raw)
    const end = Date.now() + Number(ms)
    for (;;) {
      const text = norm(await evaluate(cdp, "document.body.innerText"))
      if (text.includes(want) !== gone) { console.log(gone ? "gone" : "found"); break }
      if (Date.now() > end) throw new Error(`timed out waiting for ${raw}`)
      await new Promise((r) => setTimeout(r, 300))
    }
  } else if (cmd === "size") {
    const [w, h] = args.map(Number)
    const { windowId } = await cdp.send("Browser.getWindowForTarget")
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: w, height: h + 28 } })
    console.log(`window ${w}x${h}`)
  } else {
    throw new Error("usage: text|list|click|key|eval|shot|wait|size")
  }
} finally {
  cdp.close()
}
