import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { once } from "node:events"
import { runProcess } from "@boxblack/core/media"
import { writeFileAtomic } from "@boxblack/core/atomic-write"
import type { AppEvent, GraphicsPackState } from "../shared/api.ts"
import type { GraphicsPackSpec } from "../shared/graphics-pack.ts"

export interface GraphicsPackPaths {
  root: string
  node: string
  hyperframes: string
  chrome: string
}

export interface GraphicsPackDeps {
  /** where packs live: <userData>/hyperframes */
  dir: string
  pack: GraphicsPackSpec
  fetch?: typeof fetch
  /** unpacks the archive into a folder; macOS tar by default. Killed on the signal when cancelled. */
  extract?: (archive: string, into: string, signal: AbortSignal) => Promise<void>
  send: (event: AppEvent) => void
}

const PROGRESS_EVERY_MS = 200
/** a version is one path segment on its own: no "/", and never "." or ".." by themselves */
const VALID_VERSION = /^[\w.-]+$/

function validVersion(version: unknown): version is string {
  return typeof version === "string" && version !== "." && version !== ".." && VALID_VERSION.test(version)
}

/** macOS's own tar, then any quarantine flag the files could carry is cleared: they are ours, checked by hash. */
async function untar(archive: string, into: string, signal: AbortSignal): Promise<void> {
  await mkdir(into, { recursive: true })
  await runProcess("/usr/bin/tar", ["-xzf", archive, "-C", into], { signal })
  // -s: don't follow symlinks — a dangling one in the pack would otherwise fail the whole clear
  await runProcess("/usr/bin/xattr", ["-rcs", into], { signal })
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** every leftover *.tar.gz and *.tar.gz.part directly in dir; never a folder — a later task puts HyperFrames' own HOME/TMPDIR under here too */
async function sweepArchives(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".tar.gz") || entry.name.endsWith(".tar.gz.part")))
      .map((entry) => rm(join(dir, entry.name), { force: true })),
  )
}

/**
 * The renderer pack on this machine: downloaded once, checked against the hash the app was built
 * with, unpacked next to the earlier version, which then goes. `installed.json` says which version
 * is in place; a folder without it is not a pack.
 */
export function createGraphicsPack(deps: GraphicsPackDeps) {
  const extract = deps.extract ?? untar
  const installedFile = join(deps.dir, "installed.json")
  let running: { controller: AbortController; received: number; total: number; installing: boolean } | null = null

  /** the raw version installed.json names, once validated — not yet known to have a folder */
  async function recorded(): Promise<string | null> {
    try {
      const { version } = JSON.parse(await readFile(installedFile, "utf8")) as { version: unknown }
      return validVersion(version) ? version : null
    } catch {
      return null
    }
  }

  /** the recorded version, but only the one this build actually ships, and only once its folder is there */
  async function installed(): Promise<string | null> {
    const version = await recorded()
    if (version !== deps.pack.version) return null
    try {
      return (await stat(join(deps.dir, version))).isDirectory() ? version : null
    } catch {
      return null
    }
  }

  async function download(controller: AbortController, onProgress: (received: number) => void): Promise<string> {
    const part = join(deps.dir, `${deps.pack.version}.tar.gz.part`)
    const archive = join(deps.dir, `${deps.pack.version}.tar.gz`)
    await mkdir(deps.dir, { recursive: true })
    const response = await (deps.fetch ?? fetch)(deps.pack.url, { signal: controller.signal })
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`downloading the graphics renderer failed: HTTP ${response.status}`)
    }
    const hash = createHash("sha256")
    const out = createWriteStream(part)
    let failed: Error | null = null
    const body = Readable.fromWeb(response.body as NodeReadableStream)
    out.on("error", (error) => {
      failed = error
      body.destroy(error)
    })
    let received = 0
    let lastSent = 0
    try {
      for await (const chunk of body as AsyncIterable<Buffer>) {
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, "drain")
        received += chunk.length
        onProgress(received)
        const now = Date.now()
        if (now - lastSent >= PROGRESS_EVERY_MS) {
          lastSent = now
          deps.send({ type: "graphics-pack", state: "progress", received, total: deps.pack.bytes })
        }
        controller.signal.throwIfAborted()
      }
    } finally {
      if (!out.destroyed) await new Promise<void>((resolve) => out.end(resolve))
    }
    if (failed) throw failed
    deps.send({ type: "graphics-pack", state: "progress", received, total: deps.pack.bytes })
    if (hash.digest("hex") !== deps.pack.sha256) {
      await rm(part, { force: true })
      throw new Error("the graphics renderer did not match its expected checksum — the download was discarded, try again")
    }
    await rename(part, archive)
    return archive
  }

  return {
    async state(): Promise<GraphicsPackState> {
      if (running) return running.installing ? { state: "installing" } : { state: "downloading", received: running.received, total: running.total }
      const version = await installed()
      return version ? { state: "installed", version } : { state: "missing" }
    },

    /** Where the pack's programs are, or null until it is installed. */
    async paths(): Promise<GraphicsPackPaths | null> {
      const version = await installed()
      if (!version) return null
      const root = join(deps.dir, version)
      return { root, node: join(root, deps.pack.node), hyperframes: join(root, deps.pack.hyperframes), chrome: join(root, deps.pack.chrome) }
    },

    async install(): Promise<void> {
      if (running) throw new Error("the graphics renderer is already downloading")
      const controller = new AbortController()
      // set before anything async runs: a second install() call must see this synchronously
      running = { controller, received: 0, total: deps.pack.bytes, installing: false }
      deps.send({ type: "graphics-pack", state: "progress", received: 0, total: deps.pack.bytes })
      const version = deps.pack.version
      const target = join(deps.dir, version)
      try {
        await sweepArchives(deps.dir)
        const archive = await download(controller, (received) => {
          running!.received = received
        })
        const was = await recorded()
        running.installing = true
        deps.send({ type: "graphics-pack", state: "installing" })
        await rm(target, { recursive: true, force: true })
        await extract(archive, target, controller.signal)
        // a pack that unpacked but is short a program is no use to anyone: refuse it now, not at render time
        for (const rel of [deps.pack.node, deps.pack.hyperframes, deps.pack.chrome]) {
          if (!(await isFile(join(target, rel)))) throw new Error(`the graphics renderer pack is incomplete: ${rel} is missing`)
        }
        // a cancel that lands right as extract finishes must still not be treated as a good install
        controller.signal.throwIfAborted()
        await rm(archive, { force: true })
        await writeFileAtomic(installedFile, JSON.stringify({ version }))
        // the old folder is already superseded by a committed install; losing it must not read as a failed one
        if (was && was !== version) await rm(join(deps.dir, was), { recursive: true, force: true }).catch(() => {})
        deps.send({ type: "graphics-pack", state: "done" })
      } catch (error) {
        // whatever stage failed at, nothing of a 155 MB pack may linger: the part file, the
        // downloaded archive (extract or the completeness check can fail after it is renamed
        // into place), and anything already unpacked
        await rm(join(deps.dir, `${version}.tar.gz.part`), { force: true })
        await rm(join(deps.dir, `${version}.tar.gz`), { force: true })
        await rm(target, { recursive: true, force: true })
        if (controller.signal.aborted) deps.send({ type: "graphics-pack", state: "cancelled" })
        else deps.send({ type: "graphics-pack", state: "failed", error: String(error) })
        throw error
      } finally {
        running = null
      }
    },

    cancel(): void {
      running?.controller.abort()
    },

    async remove(): Promise<void> {
      if (running) throw new Error("the graphics renderer is already downloading")
      await sweepArchives(deps.dir)
      const version = await recorded()
      await rm(installedFile, { force: true })
      if (version) await rm(join(deps.dir, version), { recursive: true, force: true })
    },
  }
}

export type GraphicsPack = ReturnType<typeof createGraphicsPack>
