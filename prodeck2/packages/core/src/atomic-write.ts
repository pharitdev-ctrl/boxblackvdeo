import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

const queues = new Map<string, Promise<void>>()
let written = 0

/**
 * Replaces a whole file so no reader sees half of it. Writes to one file run in the order they
 * were asked for, each through its own temporary file: two writes started together never rename
 * a temporary file the other has already moved.
 */
export function writeFileAtomic(file: string, content: string, options: { mode?: number } = {}): Promise<void> {
  const temporary = `${file}.${process.pid}-${++written}.tmp`
  const write = (queues.get(file) ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(file), { recursive: true })
    try {
      await writeFile(temporary, content, options)
      await rename(temporary, file)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  })
  const settled = write.catch(() => {})
  queues.set(file, settled)
  void settled.then(() => queues.get(file) === settled && queues.delete(file))
  return write
}
