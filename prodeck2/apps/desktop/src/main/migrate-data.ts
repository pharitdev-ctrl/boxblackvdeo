import { rename, stat } from "node:fs/promises"
import { join } from "node:path"

/**
 * Everything the app keeps in its data folder. Chromium owns the rest of that folder (Cache,
 * Cookies, Local Storage …) and those belong to whichever name the app runs under, so they stay.
 */
export const OWN_ENTRIES = [
  "license.json",
  "settings.json",
  "secrets.json",
  "device-id",
  "transcripts",
  "insights",
  "models",
  "outlines",
  "media-looks",
  "loudness",
  "backups",
  "subtitle-polish",
] as const

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Moves the app's own files from the folder an earlier name used into the one in force, so a
 * rename of the product does not cost the customer their license, their keys, the transcription
 * model or a re-analysis of their footage. Anything the new folder already has is left as it is,
 * which also makes a second run do nothing.
 */
export async function migrateDataDir(deps: { from: string; to: string; entries?: readonly string[] }): Promise<string[]> {
  if (deps.from === deps.to || !(await exists(deps.from))) return []
  const moved: string[] = []
  for (const entry of deps.entries ?? OWN_ENTRIES) {
    const source = join(deps.from, entry)
    const target = join(deps.to, entry)
    if (!(await exists(source)) || (await exists(target))) continue
    try {
      await rename(source, target)
      moved.push(entry)
    } catch {
      // a folder that cannot be moved is left for the customer to copy by hand; the app still runs
    }
  }
  return moved.sort()
}
