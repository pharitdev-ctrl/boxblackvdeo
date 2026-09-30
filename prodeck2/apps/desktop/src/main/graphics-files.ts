import type { Dirent } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import type { GraphicCleanResult } from "../shared/api.ts"

const exists = (path: string) => stat(path).then(() => true, () => false)
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code

/** The name the renderer gives every file it makes: its hash. Nothing else in the folder is ours to trash. */
const GRAPHIC_FILE = /^[0-9a-f]{16}\.mov$/
/** The same name anywhere in a draft's JSON: a path, a material's name, a nested draft's own materials. */
const GRAPHIC_NAMED = /[0-9a-f]{16}\.mov/gi

/**
 * How long a rendered file is left alone after it was made: a preview may have just shown it, or a
 * write may be about to lay it down, and no draft names it until that write is done.
 */
const SETTLING_MS = 10 * 60_000

/**
 * How many folders below a root a draft is looked for: CapCut's recycle bin puts one at
 * <drafts>/.recycle_bin/<draft>, and BOXBLACK's backups at <backups>/<id>/draft, with room to spare.
 */
const DRAFT_DEPTH = 4

/** How much the graphics folder holds: the rendered graphics only, the files a clean could take away. */
export async function graphicFilesInfo(dir: string): Promise<{ count: number; bytes: number }> {
  let count = 0
  let bytes = 0
  try {
    for (const name of await readdir(dir)) {
      if (!GRAPHIC_FILE.test(name)) continue
      count++
      bytes += (await stat(join(dir, name))).size
    }
  } catch {
    // no folder yet
  }
  return { count, bytes }
}

/**
 * Adds the rendered graphics a draft's JSON file names to `names`, in lower case. It is read as text,
 * so a graphic counts wherever the draft keeps it (a timeline's materials, a compound clip's nested
 * draft, the media bin), however the folder before it is spelled (another Unicode form, another case,
 * a moved folder): only the hash is never spelled differently. False when it cannot be read, or is
 * not JSON (half written, so what it names is not known); a missing one is fine only where
 * `missingOk` says so, and an empty one only where `emptyOk` does.
 */
async function readJson(file: string, names: Set<string>, { missingOk = false, emptyOk = false } = {}): Promise<boolean> {
  try {
    const text = await readFile(file, "utf8")
    if (emptyOk && text.trim() === "") return true
    JSON.parse(text)
    for (const [name] of text.matchAll(GRAPHIC_NAMED)) names.add(name.toLowerCase())
    return true
  } catch (error) {
    return missingOk && codeOf(error) === "ENOENT"
  }
}

/**
 * Every JSON file under `dir`, however deep, but `besides` at its top (read already): where CapCut
 * keeps nested drafts and a timeline's own patches. CapCut leaves some of them empty, which name
 * nothing. False when one of them, or a folder, cannot be read.
 */
async function readNested(dir: string, names: Set<string>, besides?: string): Promise<boolean> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    return codeOf(error) === "ENOENT"
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!(await readNested(path, names))) return false
    } else if (entry.name.endsWith(".json") && entry.name !== besides) {
      if (!(await readJson(path, names, { missingOk: true, emptyOk: true }))) return false
    }
  }
  return true
}

/**
 * A draft's own timeline, each of its timelines' folders under Timelines/<id>/ (the copy of the
 * timeline, which must read, and any other JSON there), its media bin (draft_meta_info.json, where a
 * graphic taken off every timeline can still wait to be put back on) and the nested drafts under
 * subdraft/, and nothing else in it: its other folders can be large, or caches that cannot be read.
 * False when one of them cannot be read, or the draft has no timeline at all.
 */
async function readDraft(draft: string, entries: Dirent[], names: Set<string>): Promise<boolean> {
  if (!entries.some((entry) => entry.name === "draft_info.json")) return false
  if (!(await readJson(join(draft, "draft_info.json"), names))) return false
  if (!(await readJson(join(draft, "draft_meta_info.json"), names, { missingOk: true }))) return false
  if (!(await readNested(join(draft, "subdraft"), names))) return false
  let timelines: Dirent[]
  try {
    timelines = await readdir(join(draft, "Timelines"), { withFileTypes: true })
  } catch (error) {
    return codeOf(error) === "ENOENT"
  }
  for (const timeline of timelines) {
    if (!timeline.isDirectory()) continue
    const folder = join(draft, "Timelines", timeline.name)
    if (!(await readJson(join(folder, "draft_info.json"), names, { missingOk: true }))) return false
    if (!(await readNested(folder, names, "draft_info.json"))) return false
  }
  return true
}

/**
 * Adds the file names every draft in `dir`, or in the folders below it `depth` levels down, uses.
 * CapCut's cloud caches hold no drafts. Returns the draft, or the folder that may hold one, that
 * could not be read, or null.
 */
async function collect(dir: string, depth: number, names: Set<string>): Promise<string | null> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return dir
  }
  if (entries.some((entry) => entry.name === "draft_info.json" || entry.name === "draft_meta_info.json")) return (await readDraft(dir, entries, names)) ? null : dir
  if (depth === 0) return null
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".cloud_cache_")) continue
    const unreadable = await collect(join(dir, entry.name), depth - 1, names)
    if (unreadable) return unreadable
  }
  return null
}

/**
 * The name an unreadable folder is shown by, relative to the root it turned up under: never the
 * full path, which can carry the user's home folder name. Under CapCut's root this is the draft's
 * own relative path (`"0917"`, `".recycle_bin/0917"`, or `""` for the root itself); under BOXBLACK's
 * backups it is the backup's own folder, not the `draft` copy inside it that was actually unreadable.
 */
function nameOf(where: "capcut" | "backup", root: string, unreadable: string): string {
  const rel = relative(root, unreadable)
  return where === "capcut" ? rel : (rel.split("/")[0] ?? "")
}

/** Whether a file was last changed long enough ago that nothing is still making it or about to use it; false when it is gone. */
async function settled(path: string, now: number): Promise<boolean> {
  try {
    return now - (await stat(path)).mtimeMs >= SETTLING_MS
  } catch {
    return false
  }
}

/**
 * Moves to the Trash the rendered files no draft refers to any more, with their poster and meta:
 * the drafts under CapCut's root (those in its recycle bin too, which it can restore) and the ones
 * BOXBLACK backed up before writing to them (which it can put back). A draft that cannot be read
 * counts as referring to everything: nothing is trashed then, since a file it points at would
 * otherwise be lost, and `blockedBy` says which. Nothing goes while a render or a write is under
 * way, since what they are making or about to write is in no draft yet, and a file made in the last
 * few minutes is left for the same reason; `kept` says when unused files were left.
 */
export async function cleanGraphicFiles(deps: {
  dir: string
  draftsRoot: string | null
  /** BOXBLACK's draft backups (<userData>/backups); not there until it first writes a draft */
  backupRoot: string
  trash: (path: string) => Promise<void>
  /** true while graphics render or a draft is written, or once a write started after the clean did; asked before anything goes */
  busy: () => boolean
  /** the clock a file's age is told by; Date.now by default */
  now?: () => number
}): Promise<GraphicCleanResult> {
  if (!deps.draftsRoot) return { trashed: 0, blockedBy: { kind: "no-drafts-root" }, kept: null }
  if (deps.busy()) return { trashed: 0, blockedBy: { kind: "busy" }, kept: null }
  const referenced = new Set<string>()
  const roots: { where: "capcut" | "backup"; root: string }[] = [{ where: "capcut", root: deps.draftsRoot }]
  if (await exists(deps.backupRoot)) roots.push({ where: "backup", root: deps.backupRoot })
  for (const { where, root } of roots) {
    const unreadable = await collect(root, DRAFT_DEPTH, referenced)
    if (unreadable) return { trashed: 0, blockedBy: { kind: "unreadable", where, name: nameOf(where, root, unreadable) }, kept: null }
  }
  let names: string[]
  try {
    names = await readdir(deps.dir)
  } catch {
    return { trashed: 0, blockedBy: null, kept: null }
  }
  /** trashed, or not there any more */
  const gone = (path: string) => deps.trash(path).then(() => true, async () => !(await exists(path)))
  const now = (deps.now ?? Date.now)()
  let trashed = 0
  let recent = false
  for (const name of names) {
    if (!GRAPHIC_FILE.test(name) || referenced.has(name)) continue
    const hash = name.slice(0, -4)
    // with no meta yet a render may still be making it; one that is not settled either way stays
    if (!(await settled(join(deps.dir, name), now))) {
      recent = true
      continue
    }
    // asked again before each file: a write that started meanwhile may be about to use this one, and the
    // drafts were read before it wrote. A file that went before it started is one it finds not made, and renders again
    if (deps.busy()) return trashed === 0 ? { trashed, blockedBy: { kind: "busy" }, kept: null } : { trashed, blockedBy: null, kept: "stopped" }
    // the meta first: while it is there the file reads as ready, so the file stays as long as it does. A file
    // whose render failed before its meta was written has none to go
    if (!(await gone(join(deps.dir, `${hash}.json`)))) continue
    if (!(await gone(join(deps.dir, name)))) continue
    await gone(join(deps.dir, `${hash}.png`))
    trashed++
  }
  return { trashed, blockedBy: null, kept: recent ? "recent" : null }
}
