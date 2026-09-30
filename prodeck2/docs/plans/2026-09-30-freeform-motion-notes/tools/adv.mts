// node adv.mts <lanIp> <port>
// Adversarial fragments, whose forbidden names are built from strings so that no linter can see them, rendered
// (a) through the app's own renderer, all three gates, and (b) with the linter skipped: the app's page (its CSP)
// and the app's own Chrome wrapper (offlineChrome). A listener on 0.0.0.0:<port> records what gets out.
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
const REPO = "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
const S = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad"
const [lan, port] = process.argv.slice(2)
const PACK = `${S}/r044/profile/hyperframes/2026-09-24`
const { createGraphicsRenderer, offlineChrome } = await import(`${REPO}/apps/desktop/src/main/graphics-render.ts`)
const { GRAPHICS_PACK } = await import(`${REPO}/apps/desktop/src/shared/graphics-pack.ts`)
const { lintFragment } = await import(`${REPO}/packages/core/src/graphics/motion/lint.ts`)
const { motionHtml, motionAssets } = await import(`${REPO}/packages/core/src/graphics/motion/html.ts`)
const { HIGHLIGHT_STYLES } = await import(`${REPO}/packages/core/src/highlights/styles.ts`)
const { MOTION_VERSION } = await import(`${REPO}/packages/core/src/graphics/plan.ts`)
const base = `<style>#b{position:absolute;left:40px;top:40px;width:200px;height:120px;background:var(--accent);animation:o .3s 1.6s both}@keyframes o{to{opacity:0}}</style><div id="b"></div>`
const anchor = (url: string) => `${base}<script>var d=document;var a=d["create"+"Element"]("a");a["hr"+"ef"]=${JSON.stringify(url)};a["cl"+"ick"]();</script>`
const locate = (url: string) => `${base}<script>this["loc"+"ation"]=${JSON.stringify(url)};</script>`
const fetchIt = (url: string) => `${base}<script>this["fe"+"tch"](${JSON.stringify(url)},{mode:"no-cors"})["catch"](function(){});new this["Im"+"age"]()["sr"+"c"]=${JSON.stringify(url + "-img")};</script>`
const cases: [string, string][] = []
for (const [where, host] of [["loop", "127.0.0.1"], ["lan", lan!]] as const) {
  cases.push([`anchor-${where}`, anchor(`http://${host}:${port}/anchor-${where}`)])
  cases.push([`location-${where}`, locate(`http://${host}:${port}/location-${where}`)])
  cases.push([`fetch-${where}`, fetchIt(`http://${host}:${port}/fetch-${where}`)])
}
const pack = { root: PACK, node: join(PACK, GRAPHICS_PACK.node), hyperframes: join(PACK, GRAPHICS_PACK.hyperframes), chrome: join(PACK, GRAPHICS_PACK.chrome) }
const graphicsDir = join(S, "r050", "adv", "out")
const workDir = join(S, "r050", "adv", "work")
rmSync(graphicsDir, { recursive: true, force: true }); rmSync(workDir, { recursive: true, force: true })
const renderer = createGraphicsRenderer({
  graphicsDir, workDir, fontDir: `${REPO}/apps/desktop/resources/fonts`,
  motionAssets: () => motionAssets(`${REPO}/apps/desktop/resources/graphics`),
  pack: async () => pack, ffmpeg: () => `${REPO}/apps/desktop/resources/bin/ffmpeg`, ffprobe: () => `${REPO}/apps/desktop/resources/bin/ffprobe`,
  send: () => {},
})
const palette = HIGHLIGHT_STYLES["bold-white"].palette
const out: Record<string, unknown>[] = []
for (const [name, html] of cases) {
  const lint: string[] = lintFragment(html)
  const job = { spec: { kind: "motion", version: MOTION_VERSION, box: { x0: 0.05, y0: 0.07, x1: 0.95, y1: 0.22 }, seconds: 2, why: "", idea: name, words: [], html }, canvas: { width: 1080, height: 1920 }, fps: 30, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, palette, times: [] }
  const hash = renderer.hashOf(job)
  const started = Date.now()
  const { ready, failed } = await renderer.wait([job], "adv")
  out.push({ name, lintProblems: lint.length, lintFirst: lint[0]?.slice(0, 90), app: ready.includes(hash) ? "RENDERED" : failed.includes(hash) ? "failed" : "neither", why: (renderer.failureOf(hash) ?? "").split("\n")[0]?.slice(0, 140), seconds: Math.round((Date.now() - started) / 100) / 10 })
  // (b) the linter skipped: the app's page and the app's wrapper, HyperFrames run as the app runs it
  const dir = join(S, "r050", "adv", `c-${name}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "index.html"), motionHtml({ html, stage: { width: 972, height: 290 }, seconds: 2, fps: 30, times: [], palette, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, assets: await motionAssets(`${REPO}/apps/desktop/resources/graphics`) }))
  copyFileSync(`${REPO}/apps/desktop/resources/fonts/Kanit-ExtraBold.ttf`, join(dir, "Kanit-ExtraBold.ttf"))
  const wrapDir = join(S, "r050", "adv", "wrap"); mkdirSync(wrapDir, { recursive: true })
  const wrapper = await offlineChrome(wrapDir, pack.chrome)
  const mov = join(S, "r050", "adv", `o-${name}.mov`); rmSync(mov, { force: true })
  const run = spawnSync("sh", [join(S, "r050", "ll", "render-with.sh"), dir, mov], { encoding: "utf8", env: { ...process.env, CHROME_WRAPPER: wrapper } })
  const log = `${run.stdout}\n${run.stderr}`
  writeFileSync(join(S, "r050", "adv", `log-${name}.txt`), log)
  Object.assign(out.at(-1)!, { skipLint: existsSync(mov) ? "file made" : "no file", exit: run.status, errors: log.split("\n").filter((l) => /PAGEERROR|\[Browser:ERROR\]|Refused|blocked|ERR_/.test(l)).slice(0, 2).map((l) => l.trim().slice(0, 150)) })
}
console.log(JSON.stringify(out, null, 1))
console.log("wrapper:\n" + readFileSync(join(S, "r050", "adv", "wrap", "chrome-offline.sh"), "utf8").slice(0, 600))
