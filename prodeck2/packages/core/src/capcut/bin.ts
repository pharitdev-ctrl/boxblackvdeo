import { basename } from "node:path"
import type { BinItem, DraftMeta } from "./types.ts"

/**
 * A rendered graphic as a bin item, shaped like the entries CapCut 9.4 writes for an imported
 * file (0917's, read on 2026-09-24): CapCut needs one for every material a segment plays. The id
 * is the caller's, not minted here — a real imported file's bin id is a lower-case UUID, unlike
 * the upper-case ones `newId()` mints for segments and materials elsewhere. `create_time` is the
 * moment of this write; CapCut itself uses the file's creation time, but for a graphic rendered
 * just before writing, the two are close enough not to matter.
 */
export function graphicBinItem(args: { id: string; path: string; width: number; height: number; durationUs: number; nowMs: number }): BinItem {
  const nowS = Math.floor(args.nowMs / 1000)
  return {
    ai_group_type: "",
    create_time: nowS,
    duration: args.durationUs,
    enter_from: 0,
    extra_info: basename(args.path),
    file_Path: args.path,
    height: args.height,
    id: args.id,
    import_time: nowS,
    import_time_ms: args.nowMs * 1000,
    item_source: 1,
    material_color_tag: "",
    md5: "",
    metetype: "video",
    roughcut_time_range: { duration: args.durationUs, start: 0 },
    sub_time_range: { duration: -1, start: -1 },
    type: 0,
    width: args.width,
  }
}

/**
 * A composed sound's WAV as a bin item, shaped like the entry CapCut 9.5 writes for a WAV the user
 * imports (Task 1 of 0.6.0, read on 2026-10-01): `metetype` "music", with no size and no md5. The id
 * is the caller's, a lower-case UUID like a real imported file's, and the material points at it with
 * `local_material_id`. `create_time` is the moment of this write, as for a graphic.
 */
export function soundBinItem(args: { id: string; path: string; durationUs: number; nowMs: number }): BinItem {
  const nowS = Math.floor(args.nowMs / 1000)
  return {
    ai_group_type: "",
    create_time: nowS,
    duration: args.durationUs,
    enter_from: 0,
    extra_info: basename(args.path),
    file_Path: args.path,
    height: 0,
    id: args.id,
    import_time: nowS,
    import_time_ms: args.nowMs * 1000,
    item_source: 1,
    material_color_tag: "",
    md5: "",
    metetype: "music",
    roughcut_time_range: { duration: args.durationUs, start: 0 },
    sub_time_range: { duration: -1, start: -1 },
    type: 0,
    width: 0,
  }
}

/**
 * The app always writes rendered graphics under `~/Movies/CapCut/BOXBLACK/graphics`, and nothing
 * else lives there. A path tail, so it matches whatever the user's home directory is.
 */
export const RENDERED_GRAPHICS_FOLDER = "/Movies/CapCut/BOXBLACK/graphics/"

/** True when `path` is one of BOXBLACK's own rendered graphics, not the user's footage. */
export function isRenderedGraphic(path: string): boolean {
  return path.includes(RENDERED_GRAPHICS_FOLDER)
}

/** The same for composed sounds: the app writes their WAVs under `~/Movies/CapCut/BOXBLACK/sounds`, and nothing else lives there. */
export const RENDERED_SOUNDS_FOLDER = "/Movies/CapCut/BOXBLACK/sounds/"

/** True when `path` is one of BOXBLACK's own composed sounds, not the user's music. */
export function isRenderedSound(path: string): boolean {
  return path.includes(RENDERED_SOUNDS_FOLDER)
}

/** The imported-files group (`type` 0) with these items added, ids already there left alone. Pure. */
export function addBinItems(meta: DraftMeta, items: BinItem[]): DraftMeta {
  const groups = meta.draft_materials.map((group) => ({ ...group, value: [...group.value] }))
  let imported = groups.find((group) => group.type === 0)
  if (!imported) {
    imported = { type: 0, value: [] }
    groups.push(imported)
  }
  const have = new Set(imported.value.map((entry) => entry.id))
  for (const item of items) {
    if (have.has(item.id)) continue
    have.add(item.id)
    imported.value.push(item)
  }
  return { ...meta, draft_materials: groups }
}

/** The bin id of the file at `path`, if the project already imported it once, or null. */
export function binIdOf(meta: DraftMeta, path: string): string | null {
  const imported = meta.draft_materials.find((group) => group.type === 0)
  return imported?.value.find((entry) => entry.file_Path === path)?.id ?? null
}

/** True when `path` is a file BOXBLACK rendered itself, a graphic or a composed sound. */
function isRendered(path: string): boolean {
  return isRenderedGraphic(path) || isRenderedSound(path)
}

/**
 * Drops the imported-files entries for BOXBLACK's own rendered files that the new timeline no
 * longer plays: only BOXBLACK's rendered graphics or composed sounds live under `dir` (its graphics
 * folder, its sounds folder, or the BOXBLACK folder that holds both), and a write replaces the whole
 * timeline, so a file that timeline doesn't use is no longer used by this draft. The user's own
 * media, anything outside `dir`, and every other group, are left alone. Pure.
 *
 * `keep`: the ids of the entries the new timeline plays. Ids rather than paths, because that also
 * drops a stale duplicate entry for the same file — left behind by a write that was interrupted,
 * or by someone editing the draft by hand.
 *
 * `dir` is normalised (trailing slashes stripped) before matching. If what is left is not an
 * absolute path of at least two segments (`""` or `"/"`, say), `meta` comes back unchanged: an
 * empty or root-level `dir` would otherwise match — and prune — every imported file.
 */
export function pruneBinItems(meta: DraftMeta, dir: string, keep: Set<string>): DraftMeta {
  const trimmed = dir.replace(/\/+$/, "")
  if (!trimmed.startsWith("/") || trimmed.split("/").filter(Boolean).length < 2) return meta
  const prefix = `${trimmed}/`
  const groups = meta.draft_materials.map((group) => {
    if (group.type !== 0) return group
    // only BOXBLACK's own rendered files are ever dropped, whatever folder the caller names
    return { ...group, value: group.value.filter((item) => !(item.file_Path.startsWith(prefix) && isRendered(item.file_Path)) || keep.has(item.id)) }
  })
  return { ...meta, draft_materials: groups }
}
