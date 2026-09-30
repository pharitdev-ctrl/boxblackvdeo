// node smoke-write.mts <id> : one real writing call through the app's own code (the Claude Code transport asked for plain
// text, motionBrief, writeMotion), for brief <id> of trial/briefs.json, on a stage of the height given by H (env) when set.
import { readFileSync, writeFileSync } from "node:fs"
const REPO = "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
const S = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050"
const { claudeCliTransport } = await import(`${REPO}/packages/core/src/llm/cli.ts`)
const { motionBrief, writeMotion, repairBrief } = await import(`${REPO}/packages/core/src/graphics/motion/write.ts`)
const { lintFragment } = await import(`${REPO}/packages/core/src/graphics/motion/lint.ts`)
const id = process.argv[2]!
const b = JSON.parse(readFileSync(`${S}/trial/briefs.json`, "utf8")).find((x: { id: string }) => x.id === id)
const height = process.env.H ? Number(process.env.H) : b.h
const brief: string = motionBrief({ stage: { width: b.w, height }, seconds: b.d, words: b.words.map(([text, atS]: [string, number]) => ({ text, atS })), idea: b.idea, about: b.about })
writeFileSync(`${S}/smoke/brief-${id}.txt`, brief)
const transport = claudeCliTransport({ binary: "/opt/homebrew/bin/claude" })
const started = Date.now()
const html: string = await writeMotion({ transport, model: "claude-opus-5-5", brief })
writeFileSync(`${S}/smoke/w-${id}.html`, html)
const problems: string[] = lintFragment(html)
console.log(JSON.stringify({ id, seconds: Math.round((Date.now() - started) / 100) / 10, chars: html.length, startsWithStyle: html.startsWith("<style>"), problems, height, times: b.words.map((w: [string, number]) => w[1]), d: b.d, w: b.w }))
void repairBrief
