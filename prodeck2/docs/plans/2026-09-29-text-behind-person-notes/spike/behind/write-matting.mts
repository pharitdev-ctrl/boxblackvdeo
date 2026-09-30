/**
 * Pro route (CapCut's background removal on copies of the main pieces, spec §8, §13 item 5). Proof for spec 2026-09-29-text-behind-person §13 items 1–3, on draft 0917 as the test app wrote it.
 * - Layer order of §9.1: main, behind text lanes, the person, cutaways, graphics, normal bars and text, subtitles, audio.
 * - The person files keep the source's own frame times (render.py); each person segment's source.start is S − p0,
 *   so both layers ask CapCut for the same source moment and nothing is shifted.
 * - Zoom keys on the person are the main piece's, rebased to the file's time with keys at the range's edges (§9.3).
 * - Piece 0's drift is taken off so ranges r0 and g1a can be measured frame by frame without a zoom.
 * - A full-frame test cutaway at 10.0–11.4 s sits under the normal group G2 and its graphic.
 *   node write-behind.mts
 */
import { createHash, randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { loadDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
import { writeDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/write.ts"
import { newId, segmentExtras, videoMaterial, videoSegment } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/templates.ts"
import { addBinItems, graphicBinItem } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/bin.ts"

const FOLDER = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917")
const FILES = join(homedir(), "Movies/CapCut/BOXBLACK/spike-behind")
const HERE = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/behind"
const { groups, ranges } = JSON.parse(readFileSync(join(HERE, "jobs2.json"), "utf8"))

const draft = await loadDraft(FOLDER)
const info: any = structuredClone(draft.info)
const tracks: any[] = info.tracks
const main = tracks[0]
if (main.type !== "video" || main.segments.length !== 6) throw new Error("0917 is not the test app's write")
// piece 0 without its drift, so r0 and g1a have no zoom to undo when measuring
main.segments[0].common_keyframes = []
// CapCut's export marks อัลเทอร์เนตเฟด as Pro: no exit animation in the proof
for (const material of info.materials.material_animations ?? []) material.animations = (material.animations ?? []).filter((animation: any) => animation.type !== "out")

// the behind groups' lines leave the normal lanes for lanes of their own under the person
const behindIds = new Set(groups.flatMap((group: any) => group.lines.map((line: any) => line.id)))
const laneTracks = [5, 6, 7].map((i) => tracks[i])
const behindLanes = laneTracks
  .map((lane) => ({ ...lane, id: newId(), segments: lane.segments.filter((segment: any) => behindIds.has(segment.id)) }))
  .filter((lane) => lane.segments.length > 0)
for (const lane of laneTracks) lane.segments = lane.segments.filter((segment: any) => !behindIds.has(segment.id))

/** the key list's value at t: held before the first key and after the last, straight between */
function valueAt(keys: any[], t: number): number {
  if (t <= keys[0].time_offset) return keys[0].values[0]
  const last = keys[keys.length - 1]
  if (t >= last.time_offset) return last.values[0]
  const i = keys.findIndex((key: any) => key.time_offset > t)
  const [a, b] = [keys[i - 1], keys[i]]
  return a.values[0] + ((b.values[0] - a.values[0]) * (t - a.time_offset)) / (b.time_offset - a.time_offset)
}
/** the main piece's zoom on the person: keys at the range's edges and every key inside, in the file's time */
function rebased(piece: any, from: number, to: number, p0us: number): any[] {
  return (piece.common_keyframes ?? []).map((list: any) => {
    const keys = [...list.keyframe_list].sort((a: any, b: any) => a.time_offset - b.time_offset)
    const at = (t: number) => ({ ...structuredClone(keys[0]), id: newId(), time_offset: t - p0us, values: [valueAt(keys, t)] })
    const inside = keys.filter((key: any) => key.time_offset > from && key.time_offset < to).map((key: any) => ({ ...structuredClone(key), id: newId(), time_offset: key.time_offset - p0us }))
    return { ...list, id: newId(), keyframe_list: [at(from), ...inside, at(to)] }
  })
}

const nowMs = Date.now()
const binItems: any[] = []
function overlayMaterial(file: string, durationUs: number) {
  const binId = randomUUID()
  binItems.push(graphicBinItem({ id: binId, path: file, width: 1080, height: 1920, durationUs, nowMs }))
  const materialId = newId()
  info.materials.videos.push({ ...videoMaterial(materialId, { id: binId, path: file, name: basename(file), durationUs, width: 1080, height: 1920 }), has_audio: false })
  const extras = segmentExtras()
  for (const [key, entry] of extras) info.materials[key] = [...(info.materials[key] ?? []), entry]
  return { materialId, extraRefs: extras.map(([, entry]) => entry.id) }
}

const people = []
const mainFile = info.materials.videos.find((material: any) => material.id === main.segments[0].material_id).path
const mattingPath = join(FOLDER, "matting", createHash("md5").update(mainFile, "utf8").digest("hex"))
for (const range of ranges) {
  const piece = main.segments[range.piece]
  const material = structuredClone(info.materials.videos.find((m: any) => m.id === piece.material_id))
  material.id = newId()
  material.unique_id = randomUUID().replaceAll("-", "")
  material.has_audio = false
  material.matting = { ...material.matting, flag: 3, path: mattingPath, custom_matting_id: randomUUID().toUpperCase() }
  info.materials.videos.push(material)
  const extras = segmentExtras()
  for (const [key, entry] of extras) info.materials[key] = [...(info.materials[key] ?? []), entry]
  const segment: any = videoSegment({ id: newId(), materialId: material.id, extraRefs: extras.map(([, entry]) => entry.id), source: { start: range.S, duration: range.D }, target: { start: range.start, duration: range.D } })
  people.push({
    ...segment,
    volume: 0,
    clip: structuredClone(piece.clip),
    // the same file and source time as the main piece: its zoom keys carry over as they are, with new ids
    common_keyframes: structuredClone(piece.common_keyframes ?? []).map((list: any) => ({ ...list, id: newId(), keyframe_list: list.keyframe_list.map((key: any) => ({ ...key, id: newId() })) })),
    render_index: 1,
  })
}
const personTrack = { id: newId(), type: "video", flag: 2, attribute: 0, name: "", is_default_name: true, segments: people }

// a full-frame test cutaway under G2's text and its graphic
const cutFile = join(FILES, "cutaway.mp4")
const cut = overlayMaterial(cutFile, 1_400_000)
const cutSegment: any = { ...videoSegment({ id: newId(), materialId: cut.materialId, extraRefs: cut.extraRefs, source: { start: 0, duration: 1_400_000 }, target: { start: 10_000_000, duration: 1_400_000 } }), volume: 0, render_index: 8 }
const cutawayTrack = { id: newId(), type: "video", flag: 2, attribute: 0, name: "", is_default_name: true, segments: [cutSegment] }

const subtitles = tracks[1]
const bars = [2, 3, 4].map((i) => tracks[i])
const graphics = tracks[8]
const audio = tracks.slice(9)
if (subtitles.type !== "text" || subtitles.flag !== 1 || graphics.flag !== 2 || bars.some((track) => track.type !== "sticker")) throw new Error("unexpected track layout")
info.tracks = [main, ...behindLanes, personTrack, cutawayTrack, graphics, ...bars, ...laneTracks.filter((lane) => lane.segments.length > 0), subtitles, ...audio]
info.tracks.forEach((track: any, i: number) => {
  for (const segment of track.segments) segment.track_render_index = i
})

await writeDraft(draft, info, { bin: (meta) => addBinItems(meta, binItems) })
const record = {
  order: info.tracks.map((track: any) => `${track.type}/${track.flag}/${track.segments.length}`),
  people: people.map((segment: any, i: number) => ({ name: ranges[i].name, target: segment.target_timerange, source: segment.source_timerange, keys: segment.common_keyframes.map((list: any) => [list.property_type, list.keyframe_list.map((key: any) => [key.time_offset, +key.values[0].toFixed(4)])]) })),
}
writeFileSync(join(HERE, "written-matting.json"), JSON.stringify(info))
writeFileSync(join(HERE, "written-matting-ids.json"), JSON.stringify(record, null, 2))
console.log(JSON.stringify(record, null, 1))
