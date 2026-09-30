import { dirname } from "node:path"
import type { ToolReport } from "@boxblack/core/media"

export interface ToolPaths {
  ffmpeg: string | null
  ffprobe: string | null
  whisper: string | null
  claude: string | null
}

/**
 * The command-line tools the customer installed. `paths` is one object shared by every service,
 * so installing a tool and asking for a rescan takes effect without restarting the app.
 */
export function createToolbox(deps: {
  find: (name: string) => string | null
  inspect: (paths: ToolPaths) => Promise<ToolReport>
  /** where the app keeps the tools it ships with, so the screen can say which ones came with it */
  bundledDirs?: string[]
  /** where BOXBLACK's own Homebrew tap puts the whisper-cli it was tested with */
  pinnedDirs?: string[]
  /** told after each rescan, once the tools are found again: what failed for want of one may work now */
  rescanned?: () => void
}) {
  const paths: ToolPaths = { ffmpeg: null, ffprobe: null, whisper: null, claude: null }
  let report: Promise<ToolReport>

  function scan(): Promise<ToolReport> {
    Object.assign(paths, { ffmpeg: deps.find("ffmpeg"), ffprobe: deps.find("ffprobe"), whisper: deps.find("whisper-cli"), claude: deps.find("claude") })
    const within = (dirs: string[] | undefined, path: string) => (dirs ?? []).includes(dirname(path))
    report = deps.inspect({ ...paths }).then((found) => ({
      ...found,
      ffmpeg: found.ffmpeg ? { ...found.ffmpeg, bundled: within(deps.bundledDirs, found.ffmpeg.path) } : null,
      whisper: found.whisper
        ? {
            ...found.whisper,
            bundled: within(deps.bundledDirs, found.whisper.path),
            // the one inside the app is the tested build too
            pinned: within(deps.bundledDirs, found.whisper.path) || within(deps.pinnedDirs, found.whisper.path),
          }
        : null,
    }))
    return report
  }
  void scan()

  return {
    paths,
    report: () => report,
    async rescan(): Promise<void> {
      await scan()
      deps.rescanned?.()
    },
  }
}

export type Toolbox = ReturnType<typeof createToolbox>
