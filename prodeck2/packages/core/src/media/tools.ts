import { accessSync, constants, statSync } from "node:fs"
import { delimiter, join } from "node:path"

/** Where Homebrew puts tools on Apple Silicon and Intel Macs. */
const WELL_KNOWN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"]

function executableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Finds a command-line tool. An app started from Finder inherits a bare PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), so PATH alone would miss Homebrew installs.
 */
export function findExecutable(
  name: string,
  options: { bundledDirs?: string[]; pathEnv?: string; searchDirs?: string[]; isExecutable?: (path: string) => boolean } = {},
): string | null {
  const isExecutable = options.isExecutable ?? executableFile
  const pathDirs = (options.pathEnv ?? process.env.PATH ?? "").split(delimiter).filter(Boolean)
  const dirs = [...(options.bundledDirs ?? []), ...pathDirs, ...(options.searchDirs ?? []), ...WELL_KNOWN_DIRS]
  return dirs.map((dir) => join(dir, name)).find(isExecutable) ?? null
}
