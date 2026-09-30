import type { ProjectStage, StoredOutline } from "../shared/api.ts"
import { ProjectFiles } from "./project-files.ts"

/** What a project has had analysed, so the list can say so without reading every draft again. */
export interface ProjectProgress {
  folder: string
  /** when an analysis run of this project last finished cleanly */
  analysedAt: number
  videoIds: string[]
}

/** One file per project, named after its folder — the same naming as the outlines beside it. */
export class ProgressStore extends ProjectFiles<ProjectProgress> {}

/** How far each project got: the outline it has beats having been analysed, and confirming beats both. */
export function stagesOf(progress: ProjectProgress[], outlines: StoredOutline[]): Record<string, ProjectStage> {
  const stages: Record<string, ProjectStage> = {}
  for (const one of progress) stages[one.folder] = { stage: "analysed", at: one.analysedAt }
  for (const outline of outlines) stages[outline.folder] = { stage: outline.confirmed ? "confirmed" : "outline", at: outline.updatedAt }
  return stages
}
