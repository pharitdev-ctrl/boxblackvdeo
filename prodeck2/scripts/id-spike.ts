/**
 * Agent editor phase 0, spike A: does a draft BOXBLACK wrote keep its segment ids once CapCut has opened, saved
 * and the user has edited it? Read-only: it never writes a draft.
 *
 *   node scripts/id-spike.ts snapshot "<draft name>"              writes .spikes/<draft>-<time>.json
 *   node scripts/id-spike.ts compare  "<draft name>" <snapshot>    prints what changed since that snapshot
 *
 * Plan: docs/plans/2026-10-03-agent-phase0-spike.md
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft")
const SPIKES = fileURLToPath(new URL("../.spikes/", import.meta.url))

type Json = Record<string, unknown>

interface SegmentShot {
  id: string
  track: string
  trackType: string
  materialId: string
  /** the materials list the material is in, e.g. texts, videos, audios, stickers */
  materialKind: string | null
  /** what the material shows: a text's words, a file's name */
  what: string
  startUs: number
  durationUs: number
  sourceStartUs: number | null
  speed: number | null
  keyframeIds: string[]
  extraRefs: number
  keys: string[]
}

interface Snapshot {
  draft: string
  takenAt: string
  capcutVersion: string
  draftId: string
  tracks: { id: string; type: string; segments: number }[]
  segments: SegmentShot[]
  materialIds: string[]
  topKeys: string[]
}

const us = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0))
const sec = (value: number) => `${(value / 1_000_000).toFixed(2)}s`

/** A text material's words: CapCut keeps them as JSON in `content`, older drafts as plain text. */
function textOf(material: Json): string {
  const content = material.content
  if (typeof content !== "string") return ""
  try {
    const parsed = JSON.parse(content) as { text?: unknown }
    if (typeof parsed.text === "string") return parsed.text
  } catch {
    // plain text
  }
  return content
}

function describe(kind: string, material: Json): string {
  if (kind === "texts") return `“${textOf(material).replace(/\s+/g, " ").slice(0, 40)}”`
  for (const key of ["path", "file_path", "name", "resource_id", "effect_id"]) {
    const value = material[key]
    if (typeof value === "string" && value !== "") return key === "path" || key === "file_path" ? basename(value) : `${key}=${value}`
  }
  return ""
}

async function snapshotOf(draftName: string): Promise<Snapshot> {
  const folder = join(ROOT, draftName)
  if (!existsSync(join(folder, "draft_info.json"))) throw new Error(`no draft named "${draftName}" in ${ROOT}`)
  const info = JSON.parse(await readFile(join(folder, "draft_info.json"), "utf8")) as Json
  const materials = (info.materials ?? {}) as Record<string, unknown>
  const byId = new Map<string, { kind: string; material: Json }>()
  for (const [kind, list] of Object.entries(materials)) {
    if (!Array.isArray(list)) continue
    for (const material of list as Json[]) if (typeof material?.id === "string") byId.set(material.id, { kind, material })
  }
  const tracks = (info.tracks ?? []) as Json[]
  const segments: SegmentShot[] = tracks.flatMap((track) =>
    ((track.segments ?? []) as Json[]).map((segment) => {
      const found = byId.get(String(segment.material_id ?? ""))
      const target = (segment.target_timerange ?? {}) as Json
      const source = segment.source_timerange as Json | null | undefined
      const keyframes = (segment.common_keyframes ?? []) as Json[]
      return {
        id: String(segment.id),
        track: String(track.id),
        trackType: String(track.type),
        materialId: String(segment.material_id ?? ""),
        materialKind: found?.kind ?? null,
        what: found ? describe(found.kind, found.material) : "",
        startUs: us(target.start),
        durationUs: us(target.duration),
        sourceStartUs: source ? us(source.start) : null,
        speed: typeof segment.speed === "number" ? segment.speed : null,
        keyframeIds: keyframes.flatMap((group) => ((group.keyframe_list ?? []) as Json[]).map((frame) => String(frame.id))),
        extraRefs: Array.isArray(segment.extra_material_refs) ? segment.extra_material_refs.length : 0,
        keys: Object.keys(segment).sort(),
      }
    }),
  )
  const platform = (info.last_modified_platform ?? info.platform ?? {}) as Json
  return {
    draft: draftName,
    takenAt: new Date().toISOString(),
    capcutVersion: String(platform.app_version ?? "unknown"),
    draftId: String(info.id ?? ""),
    tracks: tracks.map((track) => ({ id: String(track.id), type: String(track.type), segments: ((track.segments ?? []) as unknown[]).length })),
    segments,
    materialIds: [...byId.keys()].sort(),
    topKeys: Object.keys(info).sort(),
  }
}

const label = (segment: SegmentShot) => `${segment.trackType}/${segment.materialKind ?? "?"} ${segment.what} @${sec(segment.startUs)}+${sec(segment.durationUs)}`

function compare(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = []
  out.push(`draft "${after.draft}" · CapCut ${before.capcutVersion} → ${after.capcutVersion} · draft id ${before.draftId === after.draftId ? "kept" : "CHANGED"}`)
  out.push(`snapshot ${before.takenAt} → now ${after.takenAt}`)

  const trackIds = new Set(after.tracks.map((track) => track.id))
  const keptTracks = before.tracks.filter((track) => trackIds.has(track.id)).length
  out.push(`tracks: ${before.tracks.length} → ${after.tracks.length}, ids kept ${keptTracks}/${before.tracks.length}`)
  const materialIds = new Set(after.materialIds)
  out.push(`materials: ${before.materialIds.length} → ${after.materialIds.length}, ids kept ${before.materialIds.filter((id) => materialIds.has(id)).length}/${before.materialIds.length}`)

  const now = new Map(after.segments.map((segment) => [segment.id, segment]))
  const was = new Map(before.segments.map((segment) => [segment.id, segment]))
  const same = before.segments.filter((segment) => now.has(segment.id))
  const gone = before.segments.filter((segment) => !now.has(segment.id))
  const added = after.segments.filter((segment) => !was.has(segment.id))
  out.push(`segments: ${before.segments.length} → ${after.segments.length} · same id ${same.length} · gone ${gone.length} · new ${added.length}`)

  out.push("", "== same id, changed ==")
  let unchanged = 0
  for (const old of same) {
    const cur = now.get(old.id)!
    const changes: string[] = []
    if (cur.track !== old.track) changes.push("moved to another track")
    if (cur.materialId !== old.materialId) changes.push("material id changed")
    if (cur.what !== old.what) changes.push(`content ${old.what} → ${cur.what}`)
    if (cur.startUs !== old.startUs) changes.push(`start ${sec(old.startUs)} → ${sec(cur.startUs)}`)
    if (cur.durationUs !== old.durationUs) changes.push(`duration ${sec(old.durationUs)} → ${sec(cur.durationUs)}`)
    if (cur.sourceStartUs !== old.sourceStartUs) changes.push(`source start ${old.sourceStartUs} → ${cur.sourceStartUs}`)
    if (cur.speed !== old.speed) changes.push(`speed ${old.speed} → ${cur.speed}`)
    const keptFrames = old.keyframeIds.filter((id) => cur.keyframeIds.includes(id)).length
    if (keptFrames !== old.keyframeIds.length || cur.keyframeIds.length !== old.keyframeIds.length) changes.push(`keyframes ${old.keyframeIds.length} → ${cur.keyframeIds.length} (ids kept ${keptFrames})`)
    const addedKeys = cur.keys.filter((key) => !old.keys.includes(key))
    const droppedKeys = old.keys.filter((key) => !cur.keys.includes(key))
    if (addedKeys.length) changes.push(`fields added: ${addedKeys.join(", ")}`)
    if (droppedKeys.length) changes.push(`fields dropped: ${droppedKeys.join(", ")}`)
    if (changes.length === 0) unchanged++
    else out.push(`- ${label(old)}\n    ${changes.join("\n    ")}`)
  }
  out.push(`(${unchanged} with the same id and nothing changed)`)

  out.push("", "== gone ==", ...gone.map((segment) => `- ${label(segment)}`))
  out.push("", "== new ==", ...added.map((segment) => `- ${label(segment)}`))

  // a gone and a new segment on the same kind of track, with the same material, the same content, or the same place
  // in time, is likely one piece given a new id; the reason says which
  const twins = gone.flatMap((old) => {
    const kin = added.filter((cur) => cur.trackType === old.trackType && cur.materialKind === old.materialKind)
    const by: [string, (cur: SegmentShot) => boolean][] = [
      ["same material id", (cur) => cur.materialId === old.materialId],
      ["same content", (cur) => cur.what !== "" && cur.what === old.what],
      ["same time", (cur) => cur.startUs === old.startUs && cur.durationUs === old.durationUs],
    ]
    for (const [why, test] of by) {
      const twin = kin.find(test)
      if (twin) return [`- ${label(old)}  ⇒  ${label(twin)}  (${why})`]
    }
    return []
  })
  out.push("", "== likely the same piece with a new id ==", ...(twins.length ? twins : ["(none)"]))

  const topAdded = after.topKeys.filter((key) => !before.topKeys.includes(key))
  const topDropped = before.topKeys.filter((key) => !after.topKeys.includes(key))
  out.push("", `draft fields added: ${topAdded.join(", ") || "none"} · dropped: ${topDropped.join(", ") || "none"}`)
  return out
}

const [command, draftName, snapshotPath] = process.argv.slice(2)
if (command === "snapshot" && draftName) {
  const shot = await snapshotOf(draftName)
  await mkdir(SPIKES, { recursive: true })
  const file = join(SPIKES, `${draftName.replace(/[^\p{L}\p{N}_-]+/gu, "_")}-${shot.takenAt.replace(/[:.]/g, "-")}.json`)
  await writeFile(file, JSON.stringify(shot, null, 2))
  console.log(`CapCut ${shot.capcutVersion} · ${shot.tracks.length} tracks · ${shot.segments.length} segments · ${shot.materialIds.length} materials`)
  for (const track of shot.tracks) console.log(`  ${track.type.padEnd(8)} ${track.segments} segments`)
  console.log(`saved ${file}`)
} else if (command === "compare" && draftName && snapshotPath) {
  const before = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot
  console.log(compare(before, await snapshotOf(draftName)).join("\n"))
} else {
  console.log('usage:\n  node scripts/id-spike.ts snapshot "<draft name>"\n  node scripts/id-spike.ts compare "<draft name>" <snapshot.json>')
  process.exitCode = 1
}
