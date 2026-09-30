// node stop-on-render.mjs <row>   : presses "ทำใหม่" on the row, waits for its Claude call to end (the render check
// then begins), presses "หยุด" at once, and says how the work ended. Drives the test app over CDP (port 9333).
import { execSync } from "node:child_process"
const row = Number(process.argv[2] ?? 0)
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json()
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad })
let id = 0
const waiting = new Map()
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id) } }
const evaluate = (expression) => new Promise((ok) => { const n = ++id; waiting.set(n, (msg) => ok(msg.result?.result?.value)); ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })) })
const calls = () => Number(execSync("pgrep -f 'claude -p' | wc -l").toString().trim())
const now = () => new Date().toISOString().slice(11, 23)
const state = () => evaluate(`(document.querySelector('.plan-strip')?.innerText ?? '').split('\\n').pop() + ' ## ' + [...document.querySelectorAll('.graphic-state')].map(e=>e.innerText).join(' / ')`)
console.log(now(), "redo pressed:", await evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.innerText.trim() === 'ทำใหม่')[${row}]; b?.click(); return Boolean(b) })()`))
while (calls() === 0) await new Promise((r) => setTimeout(r, 100))
console.log(now(), "the call is running")
while (calls() > 0) await new Promise((r) => setTimeout(r, 50))
console.log(now(), "the call ended: the render check begins")
console.log(now(), "stop pressed:", await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'หยุด'); b?.click(); return Boolean(b) })()`))
for (const wait of [200, 500, 1000, 2000, 4000]) { await new Promise((r) => setTimeout(r, wait)); console.log(now(), await state()) }
ws.close()
