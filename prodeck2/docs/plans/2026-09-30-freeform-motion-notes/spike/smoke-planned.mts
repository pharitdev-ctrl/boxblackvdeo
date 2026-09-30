// node smoke-planned.mts : writes every graphic of smoke/plan-answer.json with the app's own code (motionBrief, writeMotion),
// all at once, lints each, and prints the lines to render them with e2e.mts.
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
const REPO = "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
const S = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad"
const { claudeCliTransport } = await import(`${REPO}/packages/core/src/llm/cli.ts`)
const { motionBrief, writeMotion } = await import(`${REPO}/packages/core/src/graphics/motion/write.ts`)
const { lintFragment } = await import(`${REPO}/packages/core/src/graphics/motion/lint.ts`)
const { stageBox } = await import(`${REPO}/packages/core/src/graphics/framing.ts`)
const tag = process.argv[2] ?? "pl"
const answer = JSON.parse(readFileSync(`${S}/r050/smoke/plan-answer.json`, "utf8"))
const dir = `${S}/r044/profile/outlines`
const outline = JSON.parse(readFileSync(`${dir}/${readdirSync(dir).find((f) => f.startsWith("e74f0302"))}`, "utf8")).outline
const about = [...`${outline.title}: ${outline.summary}`].slice(0, 300).join("")
const transport = claudeCliTransport({ binary: "/opt/homebrew/bin/claude" })
const lines: string[] = []
await Promise.all(answer.graphics.map(async (g: { pointId: string; spec: { box: { x0: number; y0: number; x1: number; y1: number }; seconds: number; words: { text: string; atS: number }[]; idea: string } }) => {
  const stage = stageBox(g.spec.box, { width: 1080, height: 1920 })
  const brief: string = motionBrief({ stage: { width: stage.width, height: stage.height }, seconds: g.spec.seconds, words: g.spec.words, idea: g.spec.idea, about })
  writeFileSync(`${S}/r050/smoke/${tag}-brief-${g.pointId}.txt`, brief)
  const started = Date.now()
  const html: string = await writeMotion({ transport, model: "claude-opus-5-5", brief })
  writeFileSync(`${S}/r050/smoke/${tag}-${g.pointId}.html`, html)
  const problems: string[] = lintFragment(html)
  console.log(JSON.stringify({ point: g.pointId, stage: `${stage.width}x${stage.height}`, d: g.spec.seconds, seconds: Math.round((Date.now() - started) / 100) / 10, chars: html.length, problems }))
  lines.push(`node ${S}/r050/e2e.mts ${tag}-${g.pointId} ${S}/r050/smoke/${tag}-${g.pointId}.html ${stage.width} ${stage.height} ${g.spec.seconds} '${JSON.stringify(g.spec.words.map((w) => w.atS))}'\nsh ${S}/r050/e2e/sheet.sh ${tag}-${g.pointId} ${g.spec.seconds}`)
}))
writeFileSync(`${S}/r050/smoke/${tag}-render.sh`, lines.join("\n") + "\n")
