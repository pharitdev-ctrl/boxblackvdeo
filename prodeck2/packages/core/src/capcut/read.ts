import { readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { BinVideo, Draft, DraftInfo, DraftMeta } from "./types.ts"

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

export async function loadDraft(folder: string): Promise<Draft> {
  const [info, meta, project] = await Promise.all([
    readJson<DraftInfo>(join(folder, "draft_info.json")),
    readJson<DraftMeta>(join(folder, "draft_meta_info.json")),
    readJson<{ main_timeline_id: string }>(join(folder, "Timelines", "project.json")),
  ])
  return {
    root: dirname(folder),
    folder,
    name: meta.draft_name,
    mainTimelineId: project.main_timeline_id,
    capcutVersion: info.last_modified_platform?.app_version ?? info.platform?.app_version ?? "unknown",
    info,
    meta,
  }
}

/** Bin group type 0 holds imported files; photos and pathless placeholders are skipped. */
export function binVideos(meta: DraftMeta): BinVideo[] {
  return meta.draft_materials
    .filter((group) => group.type === 0)
    .flatMap((group) => group.value)
    .filter((item) => item.metetype === "video" && item.file_Path !== "")
    .map((item) => ({
      id: item.id,
      path: item.file_Path,
      name: basename(item.file_Path),
      durationUs: item.duration,
      width: item.width,
      height: item.height,
    }))
}
