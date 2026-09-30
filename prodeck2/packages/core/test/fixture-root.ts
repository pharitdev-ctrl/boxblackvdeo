import { cp, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const FIXTURE = fileURLToPath(new URL("./fixtures/capcut-9.4/", import.meta.url))

/**
 * Copies the sanitized CapCut 9.4 fixture (one empty draft "0917" with one video
 * in its media bin) into a fresh temp dir and rewrites the `__ROOT__` placeholder
 * to that dir, so tests can read and write it like the real drafts folder.
 */
export async function makeDraftRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boxblack-capcut-"))
  await cp(FIXTURE, root, { recursive: true })
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const text = await readFile(path, "utf8")
    if (text.includes("__ROOT__")) await writeFile(path, text.replaceAll("__ROOT__", root))
  }
  return root
}
