import { existsSync } from "node:fs"
import { join } from "node:path"
import { isRenderedGraphic } from "./bin.ts"
import { binVideos, loadDraft, readJson } from "./read.ts"
import type { BinVideo, RootMeta } from "./types.ts"

export interface ProjectSummary {
  name: string
  folder: string
  durationUs: number
  modifiedUs: number
  coverPath: string | null
}

export interface ProjectVideo extends BinVideo {
  exists: boolean
}

export interface ProjectDetail {
  name: string
  folder: string
  capcutVersion: string
  /** false when the draft writer has not been verified against this CapCut release */
  versionTested: boolean
  fps: number
  canvas: { width: number; height: number }
  /** segments on any track — all of them are replaced when the rough cut is written */
  timelineSegmentCount: number
  videos: ProjectVideo[]
}

type FileExists = (path: string) => boolean

const DRAFTS = "Movies/CapCut/User Data/Projects/com.lveditor.draft"

/** macOS: CapCut normally writes under ~/Movies; its sandbox container is the fallback. */
export function findDraftsRoot(home: string, fileExists: FileExists = existsSync): string | null {
  const candidates = [join(home, DRAFTS), join(home, "Library/Containers/com.lemon.lvoverseas/Data", DRAFTS)]
  return candidates.find((root) => fileExists(join(root, "root_meta_info.json"))) ?? null
}

export async function listProjects(root: string): Promise<ProjectSummary[]> {
  const rootMeta = await readJson<RootMeta>(join(root, "root_meta_info.json"))
  return rootMeta.all_draft_store
    .filter((entry) => entry.draft_is_invisible !== true && existsSync(entry.draft_fold_path))
    .map((entry) => {
      const cover = join(entry.draft_fold_path, "draft_cover.jpg")
      return {
        name: entry.draft_name,
        folder: entry.draft_fold_path,
        durationUs: entry.tm_duration,
        modifiedUs: entry.tm_draft_modified,
        coverPath: existsSync(cover) ? cover : null,
      }
    })
    .sort((a, b) => b.modifiedUs - a.modifiedUs)
}

export async function inspectProject(
  folder: string,
  options: { testedVersions: string[]; fileExists?: FileExists },
): Promise<ProjectDetail> {
  const fileExists = options.fileExists ?? existsSync
  const draft = await loadDraft(folder)
  return {
    name: draft.name,
    folder: draft.folder,
    capcutVersion: draft.capcutVersion,
    versionTested: options.testedVersions.includes(draft.capcutVersion),
    fps: draft.info.fps,
    canvas: { width: draft.info.canvas_config.width, height: draft.info.canvas_config.height },
    timelineSegmentCount: draft.info.tracks.reduce((sum, track) => sum + track.segments.length, 0),
    // BOXBLACK's own rendered graphics are imported bin entries too, but they are not footage:
    // the prepare screen would otherwise offer to transcribe and describe them like the user's own clips
    videos: binVideos(draft.meta)
      .filter((video) => !isRenderedGraphic(video.path))
      .map((video) => ({ ...video, exists: fileExists(video.path) })),
  }
}
