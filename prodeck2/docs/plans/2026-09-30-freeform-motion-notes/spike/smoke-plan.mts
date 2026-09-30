// node smoke-plan.mts : one real planning call through the app's own code (planMotion with the Claude Code transport),
// on points made by hand from a real project's transcript (the words and their times are real; the cut is simplified to
// the three beats laid end to end, and the scene and the text bands are typical values, not the project's own).
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
const REPO = "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
const S = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad"
const { planMotion, MOTION_PLAN_PROMPT } = await import(`${REPO}/packages/core/src/graphics/motion/direct.ts`)
const { describePoints } = await import(`${REPO}/packages/core/src/graphics/direct.ts`)
const { claudeCliTransport } = await import(`${REPO}/packages/core/src/llm/cli.ts`)
const { SUBTITLE_ROOM_FROM_Y } = await import(`${REPO}/packages/core/src/highlights/layout.ts`)
const dir = `${S}/r044/profile/transcripts`
const transcript = JSON.parse(readFileSync(`${dir}/${readdirSync(dir)[0]}`, "utf8")) as { utterances: { text: string; startUs: number; endUs: number }[]; words: { text: string; startUs: number; endUs: number }[] }
const beats = [ { id: "b1", startUs: 1_880_000, endUs: 13_510_000 }, { id: "b2", startUs: 16_060_000, endUs: 25_250_000 }, { id: "b3", startUs: 26_760_000, endUs: 30_070_000 } ]
const onCut = (sourceUs: number) => { let at = 0; for (const b of beats) { if (sourceUs >= b.startUs && sourceUs <= b.endUs) return at + sourceUs - b.startUs; at += b.endUs - b.startUs } return at }
const beatOf = (sourceUs: number) => beats.find((b) => sourceUs >= b.startUs && sourceUs <= b.endUs)!.id
const scene = { description: "ชายหนุ่มยืนพูดกับกล้อง ครึ่งตัว พื้นหลังเป็นห้อง", kind: "talking-head", keepClear: { fromY: 0.22, toY: 0.58 } }
const VIDEO = "458a4477-a419-42a7-a770-9db67a652047"
function point(n: number, fromUs: number, toUs: number, phrase: string, importance: string, type: string, reason: string, textBand: { fromY: number; toY: number } | null) {
  const words = transcript.words.filter((w) => w.startUs >= fromUs && w.startUs < toUs).map((w) => ({ text: w.text, startUs: w.startUs, timelineUs: onCut(w.startUs) }))
  const text = words.map((w) => w.text).join("")
  const sentence = { videoId: VIDEO, beatId: beatOf(fromUs), atUs: onCut(fromUs), text, words, timelineEndUs: onCut(toUs), scene, textBand }
  const first = words.find((w) => phrase.startsWith(w.text)) ?? words[0]!
  return { pointId: `p${n}`, kind: "speech", importance, type, reason, videoId: VIDEO, beatId: sentence.beatId, atUs: first.timelineUs, timelineEndUs: onCut(toUs), anchor: { kind: "speech", videoId: VIDEO, sourceUs: first.startUs, beatId: sentence.beatId }, text: phrase, sentence, scene, textBand }
}
const points = [
  point(1, 4_940_000, 6_980_000, "นักบินอวกาศบินขึ้นไปในอวกาศได้ยังไง", "key", "hook", "คำถามเปิดเรื่องที่ชวนสงสัย", { fromY: 0.62, toY: 0.72 }),
  point(2, 7_440_000, 9_610_000, "ไปได้ไหม", "extra", "hook", "ถามย้ำก่อนเฉลย", null),
  point(3, 10_260_000, 13_510_000, "ต้องไปด้วยกับยานอวกาศเท่านั้น", "key", "action", "คำตอบหลักของคลิป", { fromY: 0.62, toY: 0.72 }),
  point(4, 16_060_000, 22_060_000, "ในสาม สอง หนึ่ง", "secondary", "number", "นับถอยหลังก่อนขึ้นอวกาศ", null),
  point(5, 26_760_000, 30_070_000, "อยู่ในอวกาศกันแล้ว", "key", "place", "จุดพีคของคลิป ถึงอวกาศแล้ว", { fromY: 0.62, toY: 0.72 }),
]
const brief = { targetSeconds: null, videoType: null, instructions: "" }
const canvas = { width: 1080, height: 1920 }
const request = describePoints({ brief, points, canvas, captionsFromY: SUBTITLE_ROOM_FROM_Y, framed: new Set(), existing: [] }).join("\n")
writeFileSync(`${S}/r050/smoke/plan-request.txt`, request)
const transport = claudeCliTransport({ binary: "/opt/homebrew/bin/claude" })
const started = Date.now()
const answer = await planMotion({ transport, model: "claude-opus-5-5", brief, points, canvas, captionsFromY: SUBTITLE_ROOM_FROM_Y, frames: {} })
writeFileSync(`${S}/r050/smoke/plan-answer.json`, JSON.stringify(answer, null, 1))
console.log(`planned in ${Math.round((Date.now() - started) / 100) / 10} s: ${answer.graphics.length} graphics, ${answer.dropped} dropped; prompt ${MOTION_PLAN_PROMPT.version}`)
for (const g of answer.graphics) {
  const s = g.spec
  console.log(`- ${g.pointId} box [${[s.box.x0, s.box.y0, s.box.x1, s.box.y1].join(", ")}] ${s.seconds}s words ${s.words.map((w: { text: string; atS: number }) => `${w.text}@${w.atS}`).join(" ")}\n  idea: ${s.idea}\n  why: ${s.why}`)
}
