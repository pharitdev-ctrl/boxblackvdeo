/**
 * M0 spike: prove CapCut Mac accepts a main track written by BOXBLACK.
 *
 *   node scripts/m0-spike.ts [draftName]            dry run — prints the fake cut list
 *   node scripts/m0-spike.ts [draftName] --write    backs up, then overwrites the draft
 *
 * The cut list is fake on purpose: three pieces per bin video, played out of
 * source order, so a correct result is easy to recognise in CapCut.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertCapCutClosed,
  backupDraft,
  binVideos,
  buildRoughCut,
  loadDraft,
  writeDraft,
  type BinVideo,
  type Cut,
} from "../packages/core/src/capcut/index.ts"

const ROOT = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft")
const BACKUPS = fileURLToPath(new URL("../.backups/", import.meta.url))
const TESTED_VERSIONS = ["9.4.0"]

function fakeCuts(clips: BinVideo[]): Cut[] {
  const piece = (clip: BinVideo, from: number, to: number): Cut => ({
    binId: clip.id,
    sourceStartUs: Math.round(clip.durationUs * from),
    sourceDurationUs: Math.round(clip.durationUs * (to - from)),
  })
  // middle, start, end of each clip — then the clips themselves in reverse
  return [...clips].reverse().flatMap((clip) => [piece(clip, 0.4, 0.55), piece(clip, 0.05, 0.2), piece(clip, 0.7, 0.85)])
}

const seconds = (us: number) => (us / 1_000_000).toFixed(2).padStart(6)

const args = process.argv.slice(2)
const write = args.includes("--write")
const name = args.find((a) => !a.startsWith("--")) ?? "0917"

const draft = await loadDraft(join(ROOT, name))
console.log(`draft ${draft.name} · CapCut ${draft.capcutVersion} · ${draft.info.tracks.length} tracks · fps ${draft.info.fps}`)
if (!TESTED_VERSIONS.includes(draft.capcutVersion)) console.warn(`! CapCut ${draft.capcutVersion} is not a tested version`)

const clips = binVideos(draft.meta)
const missing = clips.filter((c) => !existsSync(c.path))
if (clips.length === 0) throw new Error("media bin has no video files — import some in CapCut first")
if (missing.length > 0) throw new Error(`missing media: ${missing.map((c) => c.path).join(", ")}`)
for (const clip of clips) console.log(`bin  ${clip.name}  ${seconds(clip.durationUs)} s  ${clip.width}x${clip.height}`)

const cuts = fakeCuts(clips)
const names = new Map(clips.map((c) => [c.id, c.name]))
let at = 0
for (const cut of cuts) {
  console.log(
    `cut  @${seconds(at)} s  ${names.get(cut.binId)}  ${seconds(cut.sourceStartUs)} → ${seconds(cut.sourceStartUs + cut.sourceDurationUs)} s`,
  )
  at += cut.sourceDurationUs
}

const next = buildRoughCut(draft.info, cuts, clips)
console.log(`result: 1 track · ${next.tracks[0]!.segments.length} segments · ${seconds(next.duration)} s`)

if (!write) {
  console.log("dry run — pass --write to back up and overwrite the draft")
} else {
  await assertCapCutClosed()
  const backupDir = await backupDraft(draft, BACKUPS)
  console.log(`backup: ${backupDir}`)
  await writeDraft(draft, next)
  console.log("written. restore with:")
  console.log(`  node scripts/m0-restore.ts "${backupDir}"`)
}
