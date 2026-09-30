import { createHash } from "node:crypto"
import { mkdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { writeFileAtomic } from "./atomic-write.ts"

/** JSON with object keys sorted, so equal keys always hash the same however they were built. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

/**
 * Results computed from a media file, one JSON file per (file, key). The file's size and
 * modified time are part of the cache key, so a re-exported or replaced clip is analysed
 * again instead of reusing results that no longer match it.
 */
export class MediaCache<T, K> {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  private async pathFor(media: string, key: K): Promise<string> {
    const { size, mtimeMs } = await stat(media)
    const hash = createHash("sha256").update(stableJson([media, size, mtimeMs, key])).digest("hex")
    return join(this.dir, `${hash}.json`)
  }

  /**
   * The place for one result, fixed by the file as it is now: work that takes a while reads and
   * stores through it, so a file replaced in the meantime never gets the old file's result.
   */
  async entry(media: string, key: K): Promise<{ get(): Promise<T | null>; put(value: T): Promise<void> }> {
    const path = await this.pathFor(media, key)
    return {
      get: async () => {
        try {
          return JSON.parse(await readFile(path, "utf8")) as T
        } catch {
          return null
        }
      },
      put: async (value) => {
        await mkdir(this.dir, { recursive: true })
        await writeFileAtomic(path, JSON.stringify(value))
      },
    }
  }

  async get(media: string, key: K): Promise<T | null> {
    try {
      return await (await this.entry(media, key)).get()
    } catch {
      // the file is gone
      return null
    }
  }

  async put(media: string, key: K, value: T): Promise<void> {
    await (await this.entry(media, key)).put(value)
  }
}
