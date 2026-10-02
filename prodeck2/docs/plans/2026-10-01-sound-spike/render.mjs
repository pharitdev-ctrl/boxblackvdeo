// Renders sound code written by Claude in the graphics pack's chrome-headless-shell, offline, to a WAV.
//   node render.mjs <code.js> <cue.json> <out.wav>
// The page is about:blank, every connection off this machine goes to a proxy that is not there, and the code runs
// once in an OfflineAudioContext with a seeded Math.random. Prints peak, rms and length.
import { readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
const [codeFile, cueFile, outFile] = process.argv.slice(2)
const S = new URL(".", import.meta.url).pathname
const CHROME = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r044/profile/hyperframes/2026-09-24/chrome-headless-shell/mac_arm-152.0.7977.30/chrome-headless-shell-mac-arm64/chrome-headless-shell"
const port = 9444 + Math.floor(Math.random() * 400)
const chrome = spawn(CHROME, ["--headless", `--remote-debugging-port=${port}`, `--user-data-dir=${S}chrome/${port}`, "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>", "--no-first-run", "about:blank"], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let list
  for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break } catch { await sleep(100) } }
  const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await new Promise((ok) => (ws.onopen = ok))
  let id = 0; const wait = new Map()
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (wait.has(msg.id)) { wait.get(msg.id)(msg); wait.delete(msg.id) } }
  const send = (method, params = {}) => new Promise((ok) => { const n = ++id; wait.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })) })
  const harness = readFileSync(`${S}harness.js`, "utf8")
  const code = readFileSync(codeFile, "utf8")
  const cue = JSON.parse(readFileSync(cueFile, "utf8"))
  const expr = `${harness}\nrenderSound(${JSON.stringify(code)}, ${JSON.stringify(cue)}, 1234)`
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) { console.log("ERROR", r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); process.exitCode = 1 }
  else {
    const v = r.result.result.value
    writeFileSync(outFile, Buffer.from(v.wav, "base64"))
    console.log(JSON.stringify({ peak: v.peak, rms: v.rms, seconds: v.seconds, silentEnd: v.silentEnd }))
  }
  ws.close()
} finally { chrome.kill("SIGKILL") }
