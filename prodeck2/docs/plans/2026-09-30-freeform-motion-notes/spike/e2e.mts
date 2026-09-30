// node e2e.mts <id> <fragment.html> <W> <H> <seconds> '<times json>'
// Builds the page with the repo's own motionHtml and host.js, renders it with the app's renderer pack through the
// offline Chrome wrapper, scans the renderer's output and inspects the alpha of the result, as the app will.
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const REPO = "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
const S = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad"
const { lintFragment } = await import(`${REPO}/packages/core/src/graphics/motion/lint.ts`)
const { motionHtml, motionAssets } = await import(`${REPO}/packages/core/src/graphics/motion/html.ts`)
const [id, file, w, h, seconds, times = "[]"] = process.argv.slice(2)
const html = readFileSync(file!, "utf8")
const out: Record<string, unknown> = { id, chars: html.length, lines: html.split("\n").length }
const problems: string[] = lintFragment(html)
out.lint = problems
if (problems.length === 0 && !process.env.LINT_ONLY) {
  const dir = join(S, "r050", "e2e", `c-${id}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // a real highlight style's palette: STYLE=bold-white (the app's default) | bold-black | sale-yellow | cute-pink | headline
  const { HIGHLIGHT_STYLES } = await import(`${REPO}/packages/core/src/highlights/styles.ts`)
  const palette = HIGHLIGHT_STYLES[process.env.STYLE ?? "bold-white"].palette
  const page = motionHtml({ html, stage: { width: Number(w), height: Number(h) }, seconds: Number(seconds), fps: 30, times: JSON.parse(times), palette, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, assets: await motionAssets(`${REPO}/apps/desktop/resources/graphics`) })
  writeFileSync(join(dir, "index.html"), page)
  copyFileSync(`${REPO}/apps/desktop/resources/fonts/Kanit-ExtraBold.ttf`, join(dir, "Kanit-ExtraBold.ttf"))
  const mov = join(S, "r050", "e2e", `o-${process.env.OUT ?? id}.mov`)
  rmSync(mov, { force: true })
  const started = Date.now()
  const run = spawnSync("sh", [join(S, "mg", "render-offline.sh"), dir, mov], { encoding: "utf8" })
  out.renderSeconds = Math.round((Date.now() - started) / 100) / 10
  out.renderExit = run.status
  const log = `${run.stdout}\n${run.stderr}`
  writeFileSync(join(S, "r050", "e2e", `log-${id}.txt`), log)
  out.scan = log.split("\n").filter((line) => /\[Browser:(PAGEERROR|ERROR)\]|sub_timeline_readiness_timeout/.test(line)).map((line) => line.trim().slice(0, 200))
  try {
    out.mb = Math.round(statSync(mov).size / 104857.6) / 10
    const text = execFileSync(`${REPO}/apps/desktop/resources/bin/ffmpeg`, ["-nostdin", "-v", "error", "-i", mov, "-vf", "alphaextract,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-", "-f", "null", "-"], { encoding: "utf8" })
    const max = [...text.matchAll(/YMAX=(\d+)/g)].map((m) => Number(m[1]))
    out.frames = max.length
    out.visible = max.some((v) => v > 16)
    out.goneAtEnd = (max.at(-1) ?? 0) <= 16
    out.lastMax = max.slice(-3)
  } catch (error) {
    out.inspectError = String(error).slice(0, 200)
  }
}
console.log(JSON.stringify(out))
