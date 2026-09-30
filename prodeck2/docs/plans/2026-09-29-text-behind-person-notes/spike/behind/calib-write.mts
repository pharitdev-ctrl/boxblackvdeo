/**
 * Adds the calibration rows to 0917 above everything (spec §13 item 2 follow-up): ten overlay tracks, each a
 * barcode file moved down by its row, with a different source.start or target start, over 1.0–2.5 s.
 *   node calib-write.mts
 */
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { loadDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
import { writeDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/write.ts"
import { newId, segmentExtras, videoMaterial, videoSegment } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/templates.ts"
import { addBinItems, graphicBinItem } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/bin.ts"

const FOLDER = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917")
const FILES = join(homedir(), "Movies/CapCut/BOXBLACK/spike-behind")
const HERE = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/behind"
export const ROWS = [
  { file: "calib-cfr", sourceStart: 0, targetStart: 1_000_000 },
  { file: "calib-cfr", sourceStart: 5_000, targetStart: 1_000_000 },
  { file: "calib-cfr", sourceStart: 10_000, targetStart: 1_000_000 },
  { file: "calib-cfr", sourceStart: 16_667, targetStart: 1_000_000 },
  { file: "calib-cfr", sourceStart: 25_000, targetStart: 1_000_000 },
  { file: "calib-cfr", sourceStart: 30_000, targetStart: 1_000_000 },
  { file: "calib-vfr", sourceStart: 0, targetStart: 1_000_000 },
  { file: "calib-vfr", sourceStart: 16_667, targetStart: 1_000_000 },
  { file: "calib-cfr", sourceStart: 0, targetStart: 1_033_333 },
  { file: "calib-cfr", sourceStart: 16_667, targetStart: 1_033_333 },
]
const END = 2_500_000

const draft = await loadDraft(FOLDER)
const info: any = structuredClone(draft.info)
if (info.tracks.some((track: any) => track.name === "calib")) throw new Error("calibration rows are already there")
const nowMs = Date.now()
const binItems: any[] = []
const bins = new Map<string, string>()
const calibTracks = ROWS.map((row, k) => {
  const file = join(FILES, `${row.file}.mov`)
  if (!bins.has(file)) {
    const id = randomUUID()
    bins.set(file, id)
    binItems.push(graphicBinItem({ id, path: file, width: 1080, height: 1920, durationUs: 3_000_000, nowMs }))
  }
  const materialId = newId()
  info.materials.videos.push({ ...videoMaterial(materialId, { id: bins.get(file)!, path: file, name: basename(file), durationUs: 3_000_000, width: 1080, height: 1920 }), has_audio: false })
  const extras = segmentExtras()
  for (const [key, entry] of extras) info.materials[key] = [...(info.materials[key] ?? []), entry]
  const duration = END - row.targetStart
  const segment: any = videoSegment({ id: newId(), materialId, extraRefs: extras.map(([, entry]) => entry.id), source: { start: row.sourceStart, duration }, target: { start: row.targetStart, duration } })
  segment.volume = 0
  segment.render_index = 20000 + k
  segment.clip = { ...segment.clip, transform: { x: 0, y: -k * (150 / 960) } }
  return { id: newId(), type: "video", flag: 2, attribute: 0, name: "calib", is_default_name: false, segments: [segment] }
})
const firstAudio = info.tracks.findIndex((track: any) => track.type === "audio")
info.tracks = [...info.tracks.slice(0, firstAudio), ...calibTracks, ...info.tracks.slice(firstAudio)]
info.tracks.forEach((track: any, i: number) => {
  for (const segment of track.segments) segment.track_render_index = i
})
await writeDraft(draft, info, { bin: (meta) => addBinItems(meta, binItems) })
writeFileSync(join(HERE, "calib-rows.json"), JSON.stringify(ROWS))
console.log(`added ${calibTracks.length} calibration rows; tracks ${info.tracks.length}`)
