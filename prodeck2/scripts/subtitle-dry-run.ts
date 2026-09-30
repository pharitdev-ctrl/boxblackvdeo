/**
 * Read-only: builds the subtitle lines the app would write for a project's saved outline,
 * using the cached transcripts and the cut rules in settings. Never writes to the draft.
 *
 *   node scripts/subtitle-dry-run.ts <draft folder>
 */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { TranscriptCache, WHISPER_MODELS } from "../packages/core/src/asr/index.ts"
import { binVideos, loadDraft, outputCanvas } from "../packages/core/src/capcut/index.ts"
import { compileCuts } from "../packages/core/src/cut/compile.ts"
import { DEFAULT_CUT_RULES } from "../packages/core/src/cut/rules.ts"
import { buildCaptions, captionLimits, SUBTITLE_LENGTHS } from "../packages/core/src/subtitles/index.ts"

const folder = process.argv[2]
if (!folder) throw new Error("usage: node scripts/subtitle-dry-run.ts <draft folder>")
const userData = join(homedir(), "Library/Application Support/BOXBLACK")
const settings = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"))
const stored = JSON.parse(await readFile(join(userData, "outlines", `${createHash("sha256").update(folder).digest("hex")}.json`), "utf8"))

const draft = await loadDraft(folder)
const bin = binVideos(draft.meta)
const transcripts = new TranscriptCache(join(userData, "transcripts"))
const clips = await Promise.all(
  stored.videoIds.map(async (id: string) => {
    const video = bin.find((v) => v.id === id)!
    const key = { engine: settings.asr?.engine ?? "whisper-local", model: WHISPER_MODELS[0]!.id, language: settings.asr?.language ?? "th" }
    return { id, name: video.name, durationUs: video.durationUs, transcript: await transcripts.get(video.path, key), insight: null }
  }),
)

const rules = { ...DEFAULT_CUT_RULES, ...settings.cut }
const plan = compileCuts({ beats: stored.outline.beats, clips, rules })
const first = bin.find((v) => v.id === plan.cuts[0]?.binId)
if (!first) throw new Error("the cut is empty")
const canvas = outputCanvas(draft.info, first)
const words = new Map(clips.map((clip) => [clip.id, clip.transcript?.words ?? []]))
const offsets: number[] = []
plan.cuts.reduce((at, cut) => (offsets.push(at), at + cut.sourceDurationUs), 0)
const sec = (us: number) => (us / 1e6).toFixed(2)

console.log(`${stored.outline.title} · rules ${rules.preset} · ${plan.cuts.length} pieces · ${sec(plan.durationUs)} s · canvas ${canvas.width}x${canvas.height}`)
for (const length of SUBTITLE_LENGTHS) {
  const limits = captionLimits(length, canvas)
  const captions = buildCaptions({ cuts: plan.cuts, wordsOf: (id) => words.get(id) ?? [], ...limits })
  console.log(`\n== ${length} (≤${limits.maxChars} characters, new line after ${limits.pauseUs / 1e6} s pause): ${captions.length} lines`)
  for (const caption of captions) {
    const at = offsets[caption.cut]! - plan.cuts[caption.cut]!.sourceStartUs
    console.log(`  ${sec(at + caption.startUs).padStart(6)}–${sec(at + caption.endUs).padEnd(6)} ${caption.text}`)
  }
}
