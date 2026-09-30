/**
 * Read-only: compiles the saved outline of a CapCut project with the cached analysis and
 * prints what each rule set would keep and cut. Never writes to the draft.
 *
 *   node scripts/cut-dry-run.ts <draft folder>
 */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { TranscriptCache, WHISPER_MODELS } from "../packages/core/src/asr/index.ts"
import { MediaCache } from "../packages/core/src/cache.ts"
import { inspectProject } from "../packages/core/src/capcut/projects.ts"
import { findExecutable, measureLoudness } from "../packages/core/src/media/index.ts"
import { compileCuts } from "../packages/core/src/cut/compile.ts"
import { CUT_PRESET_IDS, DEFAULT_CUT_RULES } from "../packages/core/src/cut/rules.ts"
import { PROMPT_VERSION, VISION_SAMPLING } from "../packages/core/src/vision/index.ts"

const folder = process.argv[2]
if (!folder) throw new Error("usage: node scripts/cut-dry-run.ts <draft folder>")
const userData = join(homedir(), "Library/Application Support/BOXBLACK")
const settings = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"))
const stored = JSON.parse(await readFile(join(userData, "outlines", `${createHash("sha256").update(folder).digest("hex")}.json`), "utf8"))

const project = await inspectProject(folder, { testedVersions: ["9.4.0"] })
const transcripts = new TranscriptCache(join(userData, "transcripts"))
const insights = new MediaCache(join(userData, "insights"))
const ffmpeg = findExecutable("ffmpeg")
const clips = await Promise.all(
  stored.videoIds.map(async (id: string) => {
    const video = project.videos.find((v) => v.id === id)!
    return {
      id,
      name: video.name,
      durationUs: video.durationUs,
      transcript: await transcripts.get(video.path, { engine: settings.asr?.engine ?? "whisper-local", model: WHISPER_MODELS[0]!.id, language: settings.asr?.language ?? "th" }),
      loudness: ffmpeg ? await measureLoudness({ ffmpeg, input: video.path }).catch(() => null) : null,
      insight: (await insights.get(video.path, { model: settings.llm?.model ?? "claude-opus-5", promptVersion: PROMPT_VERSION, intervalUs: VISION_SAMPLING.intervalUs, maxFrames: VISION_SAMPLING.maxFrames })) as never,
    }
  }),
)

const sec = (us: number) => (us / 1e6).toFixed(2)
for (const preset of CUT_PRESET_IDS) {
  const plan = compileCuts({ beats: stored.outline.beats, clips, rules: { ...DEFAULT_CUT_RULES, preset } })
  console.log(`\n== ${preset}: ${sec(plan.durationUs)} s in ${plan.cuts.length} pieces (outline ${sec(stored.outline.beats.reduce((s: number, b: { startUs: number; endUs: number }) => s + b.endUs - b.startUs, 0))} s)`)
  for (const cut of plan.beats) {
    const beat = stored.outline.beats.find((b: { id: string }) => b.id === cut.beatId)
    console.log(`  ${beat.name} [${beat.kind}] ${beat.videoName} ${sec(cut.originalUs)} -> ${sec(cut.keptUs)} ${cut.notes.join(",")}`)
    const loudness = clips.find((clip) => clip.id === cut.videoId)?.loudness
    // level of the 30 ms just inside each edge: speech is roughly louder than -40 dB
    const level = (fromUs: number) => (loudness ? Math.max(...loudness.db.slice(Math.floor(fromUs / 10_000), Math.floor(fromUs / 10_000) + 3)) : NaN)
    console.log(`    keep ${cut.pieces.map((p) => `${sec(p.startUs)}(${level(p.startUs)}dB)-${sec(p.endUs)}(${level(p.endUs - 30_000)}dB)`).join("  ")}`)
    for (const r of cut.removals) console.log(`    cut  ${r.reason} ${sec(r.startUs)}-${sec(r.endUs)} ${r.text}`)
  }
}
