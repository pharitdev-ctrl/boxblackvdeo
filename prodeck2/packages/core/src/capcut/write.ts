import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { assertCapCutClosed, type IsCapCutRunning } from "./capcut-process.ts"
import { readJson } from "./read.ts"
import type { Draft, DraftInfo, DraftMeta, RootMeta, RootMetaEntry } from "./types.ts"

interface WriteOptions {
  isCapCutRunning?: IsCapCutRunning
  /** CapCut timestamps are microseconds since the epoch. */
  nowUs?: number
  /**
   * Runs on the meta as it is on disk at write time — not the copy `loadDraft` returned earlier —
   * so the bin change it makes lands in the same write as the new timeline, against the bin as it
   * actually is then.
   */
  bin?: (meta: DraftMeta) => DraftMeta
}

interface BackupManifest {
  version: 1
  root: string
  folder: string
  name: string
  createdAt: string
  rootEntry: RootMetaEntry | null
}

/**
 * CapCut 9.4 keeps the main timeline in six byte-identical files. Timelines/<id>/template.tmp
 * is an older snapshot, not a copy, and is left alone.
 */
export function timelineCopies(draft: Draft): string[] {
  const timeline = join(draft.folder, "Timelines", draft.mainTimelineId)
  return [draft.folder, timeline].flatMap((dir) =>
    ["draft_info.json", "draft_info.json.bak", "template-2.tmp"].map((file) => join(dir, file)),
  )
}

/**
 * How many timelines the project holds, not counting the ones marked deleted, from the same
 * Timelines/project.json that names the main one. They all share the project's media bin. A draft
 * from before CapCut had more than one timeline, or a file that cannot be read, has the one.
 */
export async function liveTimelines(draft: Draft): Promise<number> {
  try {
    const project = await readJson<{ timelines?: unknown }>(join(draft.folder, "Timelines", "project.json"))
    if (!Array.isArray(project.timelines)) return 1
    return project.timelines.filter((timeline: { is_marked_delete?: boolean } | null) => timeline?.is_marked_delete !== true).length
  } catch {
    return 1
  }
}

/**
 * The name a new file is written under before it is swapped in: one of its own per write, so two
 * writes at once (two drafts sharing root_meta_info.json, say) never rename each other's files.
 * Anything looking for leftovers finds them all by ".boxblack-tmp".
 */
const stagingSuffix = () => `.boxblack-tmp-${randomUUID()}`

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}${stagingSuffix()}`
  await writeFile(tmp, text)
  await rename(tmp, path)
}

function stamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(".", "-")
}

function entryIndex(rootMeta: RootMeta, folder: string): number {
  return rootMeta.all_draft_store.findIndex((entry) => entry.draft_fold_path === folder)
}

/**
 * Writes the new timeline into every copy, the duration into CapCut's lists, and — when given a
 * `bin` callback — that callback's bin change, into the same draft_meta_info.json write. Every new
 * file is written next to its old one first, and only when all of them are down are they swapped
 * in: a full disk or a folder that cannot be written fails before anything is replaced, so CapCut
 * never finds copies that disagree. (Swapping a written file in within its own folder does not fail.)
 * Two writes of one draft at once would still swap their copies in turn by turn, so the caller lets
 * only one write run on a draft at a time.
 */
export async function writeDraft(draft: Draft, info: DraftInfo, options: WriteOptions = {}): Promise<void> {
  await assertCapCutClosed(options.isCapCutRunning)
  const nowUs = options.nowUs ?? Date.now() * 1000

  const text = JSON.stringify(info)
  const [primary, ...others] = timelineCopies(draft)
  // older drafts may not have the Timelines copies; draft_info.json itself must exist
  const paths = [primary!, ...others.filter((p) => existsSync(p))]
  const metaPath = join(draft.folder, "draft_meta_info.json")
  const rootPath = join(draft.root, "root_meta_info.json")

  const meta = await readJson<DraftMeta>(metaPath)
  const nextMeta = { ...(options.bin?.(meta) ?? meta), tm_duration: info.duration, tm_draft_modified: nowUs }
  const rootMeta = await readJson<RootMeta>(rootPath)
  const entry = rootMeta.all_draft_store[entryIndex(rootMeta, draft.folder)]
  if (entry) {
    entry.tm_duration = info.duration
    entry.tm_draft_modified = nowUs
  }
  const next = new Map<string, string>([...paths.map((path): [string, string] => [path, text]), [metaPath, JSON.stringify(nextMeta)]])
  if (entry) next.set(rootPath, JSON.stringify(rootMeta))

  const suffix = stagingSuffix()
  const staged: string[] = []
  try {
    for (const [path, content] of next) {
      staged.push(path)
      await writeFile(`${path}${suffix}`, content)
    }
  } catch (error) {
    for (const path of staged) await rm(`${path}${suffix}`, { force: true })
    throw error
  }
  for (const path of staged) await rename(`${path}${suffix}`, path)
}

/** A draft's name as one folder name: CapCut allows a "/" or a leading "." in a name, a folder does not. */
function folderName(name: string): string {
  return name.replace(/[/\\:]/g, "_").replace(/^\.+/, "") || "draft"
}

/** Copies the whole draft folder plus its root_meta_info.json entry into a new dir under backupRoot. */
export async function backupDraft(draft: Draft, backupRoot: string, now = new Date()): Promise<string> {
  const dir = join(backupRoot, `${folderName(draft.name)}-${stamp(now)}`)
  await mkdir(dir, { recursive: true })
  await cp(draft.folder, join(dir, "draft"), { recursive: true, preserveTimestamps: true })
  const rootMeta = await readJson<RootMeta>(join(draft.root, "root_meta_info.json"))
  const manifest: BackupManifest = {
    version: 1,
    root: draft.root,
    folder: draft.folder,
    name: draft.name,
    createdAt: now.toISOString(),
    rootEntry: rootMeta.all_draft_store[entryIndex(rootMeta, draft.folder)] ?? null,
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2))
  return dir
}

async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
    await cp(from, to, { recursive: true, preserveTimestamps: true })
    await rm(from, { recursive: true })
  }
}

/**
 * Puts the backed-up draft back. The folder being replaced is moved into the
 * backup dir as replaced-<time>, never deleted.
 */
export async function restoreDraft(backupDir: string, options: WriteOptions = {}): Promise<void> {
  await assertCapCutClosed(options.isCapCutRunning)
  const manifest = await readJson<BackupManifest>(join(backupDir, "manifest.json"))

  if (existsSync(manifest.folder)) await move(manifest.folder, join(backupDir, `replaced-${stamp(new Date())}`))
  await cp(join(backupDir, "draft"), manifest.folder, { recursive: true, preserveTimestamps: true })

  if (manifest.rootEntry) {
    const rootPath = join(manifest.root, "root_meta_info.json")
    const rootMeta = await readJson<RootMeta>(rootPath)
    const index = entryIndex(rootMeta, manifest.folder)
    if (index === -1) rootMeta.all_draft_store.push(manifest.rootEntry)
    else rootMeta.all_draft_store[index] = manifest.rootEntry
    await writeAtomic(rootPath, JSON.stringify(rootMeta))
  }
}
