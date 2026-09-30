import type { DesktopApi } from "../shared/api.ts"
import type { PlannerService } from "./planner.ts"

type OutlineApi = Pick<
  DesktopApi,
  "getOutline" | "planOutline" | "regenerateOutline" | "reviseOutline" | "saveOutlineEdits" | "cancelPlanning" | "beatThumbnail" | "unusedParts" | "addOutlinePart"
>

export function createOutlineApi(deps: {
  planner: PlannerService
  thumbnail: (folder: string, videoId: string, atUs: number) => Promise<string | null>
}): OutlineApi {
  const { planner } = deps
  return {
    getOutline: (folder) => planner.get(folder),
    planOutline: (folder, videoIds, brief) => planner.plan(folder, videoIds, brief),
    regenerateOutline: (folder, brief) => planner.regenerate(folder, brief),
    reviseOutline: (folder, instruction, brief) => planner.revise(folder, instruction, brief),
    saveOutlineEdits: (folder, beatIds, confirmed) => planner.saveEdits(folder, beatIds, confirmed),
    async cancelPlanning() {
      planner.cancel()
    },
    async beatThumbnail(folder, videoId, atUs) {
      // the time becomes part of a file name: only a whole count of microseconds gets that far
      if (!Number.isInteger(atUs) || atUs < 0) throw new Error("bad thumbnail time")
      return deps.thumbnail(folder, videoId, atUs)
    },
    unusedParts: (folder) => planner.unused(folder),
    async addOutlinePart(folder, partId) {
      if (typeof partId !== "string" || partId.length > 500) throw new Error("unknown outline part")
      return planner.addPart(folder, partId)
    },
  }
}
