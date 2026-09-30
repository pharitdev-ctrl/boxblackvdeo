import { readFile } from "node:fs/promises"
import { inspectProject, listProjects, type IsCapCutRunning, type ProjectSummary } from "@boxblack/core/capcut"
import type { DesktopApi, ProjectStage } from "../shared/api.ts"

interface ApiDeps {
  /** CapCut's drafts folder, looked for each time: CapCut may be opened for the first time while the app runs */
  root: () => string | null
  isCapCutRunning: IsCapCutRunning
  /** CapCut releases the draft writer is verified against, as the license server last sent them */
  testedVersions: () => Promise<string[]>
  /** how far the app got with each project it has worked on, by folder */
  stages: () => Promise<Record<string, ProjectStage>>
}

type ProjectApi = Pick<DesktopApi, "listProjects" | "inspectProject" | "readCover" | "capcutStatus">

export function createApi({ root, isCapCutRunning, testedVersions, stages }: ApiDeps): ProjectApi {
  const projects = async () => {
    const found = root()
    return found ? listProjects(found) : []
  }

  /** The renderer only ever gets to name a folder CapCut itself registered — never an arbitrary path. */
  async function registered(folder: string): Promise<ProjectSummary> {
    const project = (await projects()).find((p) => p.folder === folder)
    if (!project) throw new Error(`${folder} is not a CapCut project`)
    return project
  }

  return {
    async listProjects() {
      const [found, reached] = await Promise.all([projects(), stages()])
      return { root: root(), projects: found, stages: reached }
    },
    async inspectProject(folder) {
      await registered(folder)
      return inspectProject(folder, { testedVersions: await testedVersions() })
    },
    async readCover(folder) {
      const { coverPath } = await registered(folder)
      if (!coverPath) return null
      return `data:image/jpeg;base64,${(await readFile(coverPath)).toString("base64")}`
    },
    async capcutStatus() {
      return { running: await isCapCutRunning() }
    },
  }
}
