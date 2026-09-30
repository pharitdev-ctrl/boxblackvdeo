import { isRenderedGraphic } from "../capcut/bin.ts"

/**
 * A photo or clip in a CapCut project's media bin. CapCut keeps the bin in `draft_meta_info.json`
 * (`draft_materials[]` of type 0), and a timeline material points at its entry by `local_material_id`.
 */
export interface BinMedia {
  /** the bin item's id */
  binId: string
  path: string
  /** the file's own name, for the screen and for a picture Claude said nothing about */
  name: string
  kind: "photo" | "video"
  width: number
  height: number
  /** a photo has no length of its own; CapCut writes a nominal one */
  durationUs: number
}

interface BinEntry {
  id?: unknown
  metetype?: unknown
  file_Path?: unknown
  extra_info?: unknown
  width?: unknown
  height?: unknown
  duration?: unknown
}

const text = (value: unknown): string => (typeof value === "string" ? value : "")
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/**
 * The photos and clips this project could cut away to: everything in the bin but the footage the
 * outline already plays — a bin id is what the outline names its videos by — and nothing whose
 * file has gone.
 */
export function spareMedia(meta: unknown, usedBinIds: string[], exists: (path: string) => boolean): BinMedia[] {
  const groups = (meta as { draft_materials?: unknown } | null)?.draft_materials
  if (!Array.isArray(groups)) return []
  const used = new Set(usedBinIds)
  const found = new Map<string, BinMedia>()

  for (const group of groups as { type?: unknown; value?: unknown }[]) {
    if (group?.type !== 0 || !Array.isArray(group.value)) continue
    for (const entry of group.value as BinEntry[]) {
      const kind = text(entry?.metetype)
      const path = text(entry?.file_Path)
      const binId = text(entry?.id)
      if ((kind !== "photo" && kind !== "video") || !path || !binId) continue
      // BOXBLACK's own rendered graphics are imported bin entries too, but they are not footage to cut away to
      if (isRenderedGraphic(path)) continue
      if (used.has(binId) || found.has(path) || !exists(path)) continue
      found.set(path, {
        binId,
        path,
        name: text(entry.extra_info) || path.split("/").pop() || path,
        kind,
        width: count(entry.width),
        height: count(entry.height),
        durationUs: count(entry.duration),
      })
    }
  }
  return [...found.values()]
}
