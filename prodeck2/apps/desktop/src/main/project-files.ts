import { createHash } from "node:crypto"
import { access, copyFile, mkdir, readdir, readFile, rename } from "node:fs/promises"
import { join } from "node:path"
import { writeFileAtomic } from "@boxblack/core/atomic-write"

const exists = (path: string): Promise<boolean> => access(path).then(
  () => true,
  () => false,
)

/** One upgrade of an old file, and where the file is kept as it was before it. */
export interface UpgradeStep<T> {
  /** brings an old file up to date; handing back the same object means nothing changed */
  upgrade: (value: T) => T
  /**
   * where an old file is copied, as it is on disk, before it is first written back up to date: the upgrade
   * is one way, so the copy is the way back. Outside the store's own folder, which `all` reads whole
   */
  backupDir?: string
}

export interface ProjectFileOptions<T> {
  /**
   * the upgrades an old file goes through, in this order, each on what the one before gave. The file is copied
   * into the backup folder of the first of them that changed it, and into no other: that copy is the way back
   * past every step that ran
   */
  steps?: UpgradeStep<T>[]
}

/**
 * One JSON file per project in a folder of our own, named after the project's draft folder. What
 * the file holds names that folder again, so the whole folder can be read without hashing anything.
 */
export class ProjectFiles<T extends { folder: string }> {
  private readonly dir: string
  private readonly steps: UpgradeStep<T>[]
  private readonly changing = new Map<string, Promise<unknown>>()

  constructor(dir: string, options: ProjectFileOptions<T> = {}) {
    this.dir = dir
    this.steps = options.steps ?? []
  }

  private nameFor(folder: string): string {
    return `${createHash("sha256").update(folder).digest("hex")}.json`
  }

  private pathFor(folder: string): string {
    return join(this.dir, this.nameFor(folder))
  }

  /**
   * A file brought up to date, through every step in order, with the backup folder of the first step that
   * changed it; or the file as it is when a step throws on it, the steps before that one undone too: one file
   * of an odd shape must not stop it, or the others, being read. Nothing marks it up to date, so it is tried
   * again next time.
   */
  private upToDate(value: T): { value: T; backupDir?: string } {
    try {
      let upgraded = value
      let backupDir: string | undefined
      for (const step of this.steps) {
        const next = step.upgrade(upgraded)
        if (upgraded === value && next !== value) backupDir = step.backupDir
        upgraded = next
      }
      return { value: upgraded, backupDir }
    } catch {
      return { value }
    }
  }

  /**
   * Copies the file as it is on disk into a step's backup folder, unless a copy is there already: that one
   * holds the file from before its first write-back, and is never written over. The copy is made under a name
   * of its own and then moved into place, so a crash mid-copy leaves a part-file, which the next copy writes
   * over, and never a short file taken for the original. One change at a time per folder, so nothing else
   * writes this name between the look and the move. Throws when no copy can be kept. A step with no backup
   * folder keeps none.
   */
  private async keepOriginal(folder: string, backupDir: string | undefined): Promise<void> {
    if (backupDir === undefined) return
    const copy = join(backupDir, this.nameFor(folder))
    if (await exists(copy)) return
    await mkdir(backupDir, { recursive: true })
    const part = `${copy}.part`
    await copyFile(this.pathFor(folder), part)
    await rename(part, copy)
  }

  /**
   * The file as it is on disk, or null when there is none, it cannot be read, or what it holds is no file of
   * ours (`readOne`): that one is never brought up to date, written back or copied.
   */
  private read(folder: string): Promise<T | null> {
    return this.readOne(this.pathFor(folder))
  }

  /**
   * The project's file, brought up to date. An old one is written back up to date once, in turn with
   * the other changes: the write reads the file again, so a change that landed meanwhile is kept. A
   * write-back that fails (a full disk, a read-only folder, no copy of the old file could be kept) still
   * hands out the upgraded file, so an old project stays readable; the next read tries the write again.
   *
   * Never await `get` inside an `update` change on the same folder: while that folder's file is old,
   * the write-back queues behind the change that waits for it, and neither ever finishes.
   */
  async get(folder: string): Promise<T | null> {
    const value = await this.read(folder)
    if (value === null) return null
    const upgraded = this.upToDate(value).value
    if (upgraded === value) return value
    return this.update(folder, (current) => current ?? upgraded).catch(() => upgraded)
  }

  async put(value: T): Promise<void> {
    await writeFileAtomic(this.pathFor(value.folder), JSON.stringify(value))
  }

  /**
   * Reads, changes and writes one project's file, one change at a time, so a job that took a
   * while starts from what quicker changes wrote in the meantime instead of writing over them.
   * The change is handed the file brought up to date; an old file is copied to the backup folder of the first
   * step that changed it before anything is written over it, and nothing is written when that copy cannot be kept.
   */
  update(folder: string, change: (current: T | null) => T | Promise<T>): Promise<T> {
    const before = this.changing.get(folder) ?? Promise.resolve()
    const done = before
      .catch(() => {})
      .then(async () => {
        const current = await this.read(folder)
        const upgraded = current === null ? null : this.upToDate(current)
        if (upgraded !== null && upgraded.value !== current) await this.keepOriginal(folder, upgraded.backupDir)
        const next = await change(upgraded?.value ?? null)
        await this.put(next)
        return next
      })
    this.changing.set(folder, done)
    void done.catch(() => {}).then(() => {
      if (this.changing.get(folder) === done) this.changing.delete(folder)
    })
    return done
  }

  /** Every project the folder holds, brought up to date in memory only. A file that cannot be read is left out, not thrown over. */
  async all(): Promise<T[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const found: T[] = []
    for (const name of names) {
      const value = await this.readOne(join(this.dir, name))
      if (value) found.push(this.upToDate(value).value)
    }
    return found
  }

  /**
   * What the file at a path holds, when it is one of ours: an object that names its project's folder. JSON of
   * any other shape (a number, a list, an object with no folder) is as a file that cannot be read: null.
   */
  private async readOne(path: string): Promise<T | null> {
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as unknown
      return typeof value === "object" && value !== null && typeof (value as { folder?: unknown }).folder === "string" ? (value as T) : null
    } catch {
      return null
    }
  }
}
