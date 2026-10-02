// Spike: Claude sets a sound palette for 0917, then writes one musical sound effect per moment as Web Audio code;
// each is rendered offline (render.mjs) and repaired once if it fails. node write.mjs [tag] [only-moment]
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { spawn } from "node:child_process"
const S = new URL(".", import.meta.url).pathname
const tag = process.argv[2] ?? "v1"
const only = process.argv[3]
const ABOUT = "ขึ้นอวกาศใน 3 2 1: a young man asks straight out how astronauts get into space, answers that you can only go with a spaceship, then counts down on his fingers to launch himself \"up\", and ends with a smile: now we are in space. Playful, light, comic, Thai, about 30 seconds."
const moments = JSON.parse(readFileSync(`${S}moments.json`, "utf8")).filter((m) => !only || m.name === only)

function claude(systemFile, prompt, label) {
  return new Promise((ok, bad) => {
    const t0 = Date.now()
    const p = spawn("/opt/homebrew/bin/claude", ["-p", "--output-format", "json", "--model", "claude-opus-5-5", "--effort", "medium", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--exclude-dynamic-system-prompt-sections", "--system-prompt-file", systemFile], { cwd: `${S}cwd`, stdio: ["pipe", "pipe", "pipe"] })
    let out = "", err = ""
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d))
    p.on("close", (code) => {
      writeFileSync(`${S}calls/${tag}-${label}.json`, out)
      try { const j = JSON.parse(out); if (j.is_error) return bad(new Error(j.result)); ok({ text: j.result, seconds: (Date.now() - t0) / 1000, usage: j.usage }) } catch { bad(new Error(`exit ${code}: ${err.slice(0, 300)}`)) }
    })
    p.stdin.end(prompt)
  })
}
const strip = (t) => t.trim().replace(/^```[a-z]*\n/i, "").replace(/\n```\s*$/, "").trim()
function render(js, cue, wav) {
  return new Promise((ok) => {
    const p = spawn("node", [`${S}render.mjs`, js, cue, wav], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d))
    p.on("close", () => ok(out.trim()))
  })
}

let palette
if (existsSync(`${S}out/palette.txt`)) palette = readFileSync(`${S}out/palette.txt`, "utf8")
else {
  const all = JSON.parse(readFileSync(`${S}moments.json`, "utf8"))
  const r = await claude(`${S}palette-system.txt`, `The clip: ${ABOUT}\n\nIts moments that get a sound:\n${all.map((m) => `- ${m.name} (${m.moment} s): ${m.scene}`).join("\n")}`, "palette")
  palette = r.text.trim(); writeFileSync(`${S}out/palette.txt`, palette); console.log(`palette ${r.seconds}s\n${palette}\n`)
}

await Promise.all(moments.map(async (m) => {
  const cue = { length: m.length, moment: m.moment, words: m.words }
  writeFileSync(`${S}out/${m.name}.cue.json`, JSON.stringify(cue))
  const brief = [
    `The clip: ${ABOUT}`, "", "The palette of the clip:", palette, "",
    `This moment: ${m.scene}`, `It lasts ${m.moment} s; the sound may ring on until ${m.length} s.`,
    `Words: ${m.words.map((w) => `${w.text} at ${w.atS} s`).join(", ")}.`,
    ...(m.html ? ["", "The graphic on screen during this moment, as the HTML fragment that draws it. Its CSS animations and Web Animations give the times things happen in the picture; read them and land your hits on what is seen:", "", m.html] : []),
  ].join("\n")
  writeFileSync(`${S}out/${tag}-${m.name}.brief.txt`, brief)
  let r = await claude(`${S}contract.txt`, brief, m.name)
  let js = `${S}out/${tag}-${m.name}.js`; writeFileSync(js, strip(r.text))
  let res = await render(js, `${S}out/${m.name}.cue.json`, `${S}out/${tag}-${m.name}.wav`)
  let note = `${m.name}: written ${r.seconds}s, render ${res}`
  const bad = res.startsWith("ERROR") || (() => { try { return JSON.parse(res).peak < 0.01 } catch { return true } })()
  if (bad) {
    const fix = `${brief}\n\nYou wrote the function below for this brief. Rendered, it failed: ${res}\nPut it right and change nothing else. Return the whole function, with no code fence and no explanation.\n\n${readFileSync(js, "utf8")}`
    r = await claude(`${S}contract.txt`, fix, `${m.name}-repair`)
    js = `${S}out/${tag}-${m.name}-r.js`; writeFileSync(js, strip(r.text))
    res = await render(js, `${S}out/${m.name}.cue.json`, `${S}out/${tag}-${m.name}.wav`)
    note += ` | repaired ${r.seconds}s, render ${res}`
  }
  console.log(note)
}))
