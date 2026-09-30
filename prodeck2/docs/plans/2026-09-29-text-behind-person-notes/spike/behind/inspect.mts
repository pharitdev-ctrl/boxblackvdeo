// Read-only: 0917's tracks, main pieces, text segments with content, and keyframes.
import { homedir } from "node:os"
import { join } from "node:path"
import { loadDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
const draft = await loadDraft(join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"))
const info: any = draft.info
console.log("fps", info.fps, "canvas", JSON.stringify(info.canvas_config), "duration", info.duration)
const texts = new Map(info.materials.texts.map((t: any) => [t.id, t]))
const stickers = new Map((info.materials.stickers ?? []).map((t: any) => [t.id, t]))
const videos = new Map(info.materials.videos.map((t: any) => [t.id, t]))
info.tracks.forEach((track: any, i: number) => {
  const segs = track.segments
  console.log(`#${i} ${track.type} flag ${track.flag} segs ${segs.length} ri ${segs.map((s: any) => s.render_index).slice(0, 3)} tri ${segs.map((s: any) => s.track_render_index).slice(0, 3)}`)
  if (track.type === "video") for (const s of segs) {
    const m: any = videos.get(s.material_id)
    console.log(`   video ${(s.target_timerange.start / 1e6).toFixed(3)}+${(s.target_timerange.duration / 1e6).toFixed(3)} src ${s.source_timerange ? (s.source_timerange.start / 1e6).toFixed(6) : "-"} ${m?.path?.split("/").pop()} kf ${JSON.stringify((s.common_keyframes ?? []).filter((k: any) => k.property_type === "KFTypeScaleX").map((k: any) => k.keyframe_list.map((f: any) => [f.time_offset, f.values[0]])))} clip ${JSON.stringify(s.clip?.scale)} ${JSON.stringify(s.clip?.transform)}`)
  }
  if (track.type === "text") for (const s of segs) {
    const m: any = texts.get(s.material_id)
    let content = ""
    try { content = JSON.parse(m.content).text } catch { content = m?.content?.slice?.(0, 30) }
    console.log(`   text ${(s.target_timerange.start / 1e6).toFixed(3)}+${(s.target_timerange.duration / 1e6).toFixed(3)} y ${s.clip?.transform?.y?.toFixed?.(3)} "${content}"`)
  }
  if (track.type === "sticker") for (const s of segs) console.log(`   sticker ${(s.target_timerange.start / 1e6).toFixed(3)}+${(s.target_timerange.duration / 1e6).toFixed(3)}`)
})
