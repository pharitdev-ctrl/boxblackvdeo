import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { expect, test } from "vitest"
import { runProcess } from "@boxblack/core/media"
import type { AppEvent } from "../shared/api.ts"
import { GRAPHICS_PACK } from "../shared/graphics-pack.ts"
import { createGraphicsPack } from "./graphics-pack.ts"

const bytes = Buffer.from("not really a tarball, but bytes all the same")
const spec = (over: Partial<Parameters<typeof createGraphicsPack>[0]["pack"]> = {}) => ({
  version: "v1", url: "https://example.test/pack.tgz", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
  node: "node/bin/node", hyperframes: "node_modules/hyperframes/bin/hyperframes.mjs", chrome: "chrome/chrome-headless-shell", ...over,
})
// wrapped in a fresh Uint8Array: a Buffer's own .buffer type does not satisfy BlobPart (see scribe.ts)
const streaming = (body: Buffer, status = 200) => async () => new Response(new Blob([new Uint8Array(body)]).stream(), { status })

/** Writes empty files at a spec's node/hyperframes/chrome paths, as a real pack's extract would leave them. */
async function writePackFiles(root: string, packSpec: ReturnType<typeof spec>) {
  for (const rel of [packSpec.node, packSpec.hyperframes, packSpec.chrome]) {
    const dest = join(root, rel)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, "")
  }
}

async function setup(over = {}) {
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  const events: AppEvent[] = []
  const extracted: string[][] = []
  const packSpec = spec(over)
  const pack = createGraphicsPack({
    dir, pack: packSpec, fetch: streaming(bytes) as unknown as typeof fetch, send: (event) => events.push(event),
    extract: async (archive, into) => {
      extracted.push([archive, into])
      await writePackFiles(into, packSpec)
    },
  })
  return { dir, events, extracted, pack }
}

test("nothing installed: missing", async () => {
  const { pack } = await setup()
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(await pack.paths()).toBeNull()
})

test("installs: downloads, checks the checksum, extracts into a versioned folder, remembers it", async () => {
  const { dir, events, extracted, pack } = await setup()
  await pack.install()
  expect(extracted).toEqual([[join(dir, "v1.tar.gz"), join(dir, "v1")]])
  expect(await pack.state()).toEqual({ state: "installed", version: "v1" })
  expect(await pack.paths()).toEqual({ root: join(dir, "v1"), node: join(dir, "v1", "node/bin/node"), hyperframes: join(dir, "v1", "node_modules/hyperframes/bin/hyperframes.mjs"), chrome: join(dir, "v1", "chrome/chrome-headless-shell") })
  expect(events.at(-1)).toEqual({ type: "graphics-pack", state: "done" })
  expect(events.some((event) => event.type === "graphics-pack" && event.state === "progress" && event.received === bytes.length)).toBe(true)
  expect(JSON.parse(await readFile(join(dir, "installed.json"), "utf8"))).toEqual({ version: "v1" })
  // the archive is only a means to the unpacked folder; once verified and extracted it must not linger
  await expect(readFile(join(dir, "v1.tar.gz"))).rejects.toThrow()
  await expect(readFile(join(dir, "v1.tar.gz.part"))).rejects.toThrow()
})

test("a progress event with received: 0 fires as soon as install() starts", async () => {
  const { events, pack } = await setup()
  await pack.install()
  expect(events[0]).toEqual({ type: "graphics-pack", state: "progress", received: 0, total: bytes.length })
})

test("the final progress event reports the true total, even when chunks arrive faster than the progress throttle", async () => {
  const events: AppEvent[] = []
  // three chunks delivered back to back, all well under the 200ms progress throttle: the in-loop
  // send only ever fires once, for the first chunk, so only the unconditional send after the loop
  // can report the whole download
  const chunks = [bytes.subarray(0, 10), bytes.subarray(10, 20), bytes.subarray(20)]
  let next = 0
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  const packSpec = spec()
  const pack = createGraphicsPack({
    dir, pack: packSpec, send: (event) => events.push(event), extract: async (_archive, into) => writePackFiles(into, packSpec),
    fetch: (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (next < chunks.length) controller.enqueue(chunks[next++]!)
            else controller.close()
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch,
  })
  await pack.install()
  const progress = events.filter(
    (event): event is Extract<AppEvent, { type: "graphics-pack"; state: "progress" }> => event.type === "graphics-pack" && event.state === "progress",
  )
  expect(progress.length).toBeGreaterThan(0)
  expect(progress.at(-1)).toMatchObject({ received: bytes.length, total: bytes.length })
})

test("a non-OK response releases its body before failing", async () => {
  let cancelled = false
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  const pack = createGraphicsPack({
    dir, pack: spec(), send: () => {},
    fetch: (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
        cancel() {
          cancelled = true
        },
      })
      return new Response(stream, { status: 404 })
    }) as unknown as typeof fetch,
  })
  await expect(pack.install()).rejects.toThrow(/404/)
  expect(cancelled).toBe(true)
})

test("a checksum that does not match is thrown away and reported", async () => {
  const { dir, events, extracted, pack } = await setup({ sha256: "0".repeat(64) })
  await expect(pack.install()).rejects.toThrow(/checksum/)
  expect(extracted).toEqual([])
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(events.at(-1)).toMatchObject({ type: "graphics-pack", state: "failed" })
  await expect(readFile(join(dir, "v1.tar.gz"))).rejects.toThrow()
})

test("a write error during download fails with the disk's reason, instead of stopping the app or waiting forever", { timeout: 3000 }, async () => {
  const { dir, events, pack } = await setup()
  // the part file cannot be created: here because the folder is read-only, for a customer because the disk is full
  await chmod(dir, 0o555)
  const crashes: unknown[] = []
  const record = (error: unknown) => crashes.push(error)
  process.on("uncaughtException", record)
  try {
    await expect(pack.install()).rejects.toThrow(/EACCES/)
  } finally {
    process.off("uncaughtException", record)
    await chmod(dir, 0o755)
  }
  expect(crashes).toEqual([])
  expect(events.at(-1)).toMatchObject({ type: "graphics-pack", state: "failed" })
})

test.skipIf(!existsSync("/usr/bin/tar"))("a real tar failure cleans up the downloaded archive and the partial folder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  const garbage = Buffer.from("this is not a gzip file at all")
  const events: AppEvent[] = []
  const packSpec = spec({ sha256: createHash("sha256").update(garbage).digest("hex"), bytes: garbage.length })
  // no `extract` override: /usr/bin/tar really runs against a bad archive and really fails
  const pack = createGraphicsPack({ dir, pack: packSpec, send: (event) => events.push(event), fetch: streaming(garbage) as unknown as typeof fetch })
  await expect(pack.install()).rejects.toThrow()
  expect(events.at(-1)).toMatchObject({ type: "graphics-pack", state: "failed" })
  await expect(readFile(join(dir, "v1.tar.gz"))).rejects.toThrow()
  await expect(stat(join(dir, "v1"))).rejects.toThrow()
})

test("a recorded pack from a different build version is not treated as installed, and is cleared out once this version installs", async () => {
  const { dir, pack } = await setup()
  await writeFile(join(dir, "installed.json"), JSON.stringify({ version: "v0" }))
  await mkdir(join(dir, "v0"), { recursive: true })
  await writeFile(join(dir, "v0", "old-file"), "old")
  // v0 has a real folder, but this build ships v1: an older pack must not count as installed
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(await pack.paths()).toBeNull()
  await pack.install()
  expect(await pack.state()).toEqual({ state: "installed", version: "v1" })
  await expect(stat(join(dir, "v0"))).rejects.toThrow()
})

test("installed.json naming this build's own version is not treated as installed until its folder exists", async () => {
  const { dir, pack } = await setup()
  await writeFile(join(dir, "installed.json"), JSON.stringify({ version: "v1" }))
  // no v1 folder on disk yet
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(await pack.paths()).toBeNull()
})

test("remove() takes both installed.json and the version folder away", async () => {
  const { dir, pack } = await setup()
  await pack.install()
  await pack.remove()
  await expect(readFile(join(dir, "installed.json"))).rejects.toThrow()
  await expect(stat(join(dir, "v1"))).rejects.toThrow()
  expect(await pack.state()).toEqual({ state: "missing" })
})

test("remove() refuses while an install is running", async () => {
  const { pack } = await setup()
  const installing = pack.install()
  await expect(pack.remove()).rejects.toThrow(/already/)
  await installing
})

test("a version string outside the allowed pattern is not recorded as anything, and remove() cannot escape its own folder", async () => {
  const { dir, pack } = await setup()
  await writeFile(join(dir, "installed.json"), JSON.stringify({ version: ".." }))
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(await pack.paths()).toBeNull()
  await pack.remove()
  await expect(readFile(join(dir, "installed.json"))).rejects.toThrow()
  // remove() must never have tried rm(join(dir, "..")): this whole temp tree must still be here
  expect((await stat(dir)).isDirectory()).toBe(true)
})

test("a recorded version with a slash is not recorded as anything, and cannot make remove() escape its own folder", async () => {
  const { dir, pack } = await setup()
  // a real sibling next to dir, at the exact path join(dir, "../<name>") would resolve to
  const sibling = await mkdtemp(join(dirname(dir), "outside-"))
  await writeFile(join(sibling, "marker"), "must survive")
  try {
    await writeFile(join(dir, "installed.json"), JSON.stringify({ version: `../${basename(sibling)}` }))
    expect(await pack.state()).toEqual({ state: "missing" })
    expect(await pack.paths()).toBeNull()
    await pack.remove()
    await expect(readFile(join(dir, "installed.json"))).rejects.toThrow()
    expect(await readFile(join(sibling, "marker"), "utf8")).toBe("must survive")
  } finally {
    await rm(sibling, { recursive: true, force: true })
  }
})

test("a recorded version containing a slash is not recorded, even when it would otherwise resolve to a real folder", async () => {
  // deps.pack.version matches the recorded string exactly, and a real folder sits at that nested
  // path: only the pattern itself, not the separate version-match check, can reject this one
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  const packSpec = spec({ version: "a/b" })
  const pack = createGraphicsPack({ dir, pack: packSpec, send: () => {}, extract: async () => {} })
  await mkdir(join(dir, "a", "b"), { recursive: true })
  await writeFile(join(dir, "installed.json"), JSON.stringify({ version: "a/b" }))
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(await pack.paths()).toBeNull()
  await pack.remove()
  await expect(readFile(join(dir, "installed.json"))).rejects.toThrow()
})

test("install() and remove() sweep leftover archives, but leave other folders alone", async () => {
  const { dir, pack } = await setup()
  // a later task puts HyperFrames' own HOME/TMPDIR under this same directory: the sweep must not touch it
  await mkdir(join(dir, "hyperframes-home"), { recursive: true })
  await writeFile(join(dir, "hyperframes-home", "keep-me"), "keep")
  await writeFile(join(dir, "stale.tar.gz"), "stale")
  await writeFile(join(dir, "stale2.tar.gz.part"), "stale part")

  await pack.install()
  await expect(readFile(join(dir, "stale.tar.gz"))).rejects.toThrow()
  await expect(readFile(join(dir, "stale2.tar.gz.part"))).rejects.toThrow()
  expect(await readFile(join(dir, "hyperframes-home", "keep-me"), "utf8")).toBe("keep")

  await writeFile(join(dir, "another-stray.tar.gz"), "stray")
  await pack.remove()
  await expect(readFile(join(dir, "another-stray.tar.gz"))).rejects.toThrow()
  expect(await readFile(join(dir, "hyperframes-home", "keep-me"), "utf8")).toBe("keep")
})

test("the sweep never tries to remove a folder, even one named like an archive", async () => {
  const { dir, pack } = await setup()
  const trickyFolder = join(dir, "old.tar.gz")
  await mkdir(trickyFolder, { recursive: true })
  await writeFile(join(trickyFolder, "inside"), "keep")
  // without filtering to files only, rm(trickyFolder, { force: true }) has no `recursive` and throws
  // EISDIR on this non-empty directory, which would otherwise fail the sweep outright

  await pack.install()
  expect(await readFile(join(trickyFolder, "inside"), "utf8")).toBe("keep")

  await pack.remove()
  expect(await readFile(join(trickyFolder, "inside"), "utf8")).toBe("keep")
})

test.skipIf(!existsSync("/usr/bin/chflags"))("a failure removing the old pack's folder does not undo an otherwise successful install", async () => {
  const { dir, pack } = await setup()
  await writeFile(join(dir, "installed.json"), JSON.stringify({ version: "v0" }))
  const stuckFile = join(dir, "v0", "stuck")
  await mkdir(join(dir, "v0"), { recursive: true })
  await writeFile(stuckFile, "old")
  // an immutable file makes `rm -rf` on its folder fail for real, even though the folder itself is writable
  await runProcess("/usr/bin/chflags", ["uchg", stuckFile])
  try {
    await pack.install()
    expect(await pack.state()).toEqual({ state: "installed", version: "v1" })
    expect(await pack.paths()).not.toBeNull()
  } finally {
    await runProcess("/usr/bin/chflags", ["nouchg", stuckFile]).catch(() => {})
  }
})

test("cancelling a download leaves nothing behind", async () => {
  const { dir, events, pack } = await setup()
  const slow = createGraphicsPack({
    dir, pack: spec(), send: (event) => events.push(event), extract: async () => {},
    fetch: (async (_url: string, init: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          return new Promise((resolve) => setTimeout(() => { if (init.signal?.aborted) controller.error(new DOMException("aborted", "AbortError")); else controller.enqueue(bytes.subarray(0, 4)); resolve() }, 5))
        },
      })
      return new Response(stream, { status: 200 })
    }) as unknown as typeof fetch,
  })
  const installing = slow.install()
  await new Promise((resolve) => setTimeout(resolve, 20))
  // received is timing-sensitive (a few 4-byte chunks will have landed by now); only the shape matters here
  expect(await slow.state()).toMatchObject({ state: "downloading", total: bytes.length })
  slow.cancel()
  await expect(installing).rejects.toThrow()
  expect(events.at(-1)).toEqual({ type: "graphics-pack", state: "cancelled" })
  expect(await slow.state()).toEqual({ state: "missing" })
  await expect(readFile(join(dir, "v1.tar.gz.part"))).rejects.toThrow()
  await expect(readFile(join(dir, "v1.tar.gz"))).rejects.toThrow()
  await expect(stat(join(dir, "v1"))).rejects.toThrow()
})

test("cancelling mid-unpack stops the extract and leaves nothing behind, keeping any earlier install untouched", async () => {
  const { dir, events } = await setup()
  await writeFile(join(dir, "installed.json"), JSON.stringify({ version: "v0" }))
  await mkdir(join(dir, "v0"), { recursive: true })
  await writeFile(join(dir, "v0", "old-file"), "old")
  let started!: () => void
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve
  })
  const slow = createGraphicsPack({
    dir, pack: spec(), send: (event) => events.push(event), fetch: streaming(bytes) as unknown as typeof fetch,
    // waits on the signal instead of ever finishing on its own, like a real tar process would be killed by it
    extract: (_archive, _into, signal) =>
      new Promise((_resolve, reject) => {
        started()
        signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")), { once: true })
      }),
  })
  const installing = slow.install()
  await startedPromise
  slow.cancel()
  await expect(installing).rejects.toThrow()
  expect(events.at(-1)).toEqual({ type: "graphics-pack", state: "cancelled" })
  await expect(readFile(join(dir, "v1.tar.gz.part"))).rejects.toThrow()
  await expect(readFile(join(dir, "v1.tar.gz"))).rejects.toThrow()
  await expect(stat(join(dir, "v1"))).rejects.toThrow()
  expect(JSON.parse(await readFile(join(dir, "installed.json"), "utf8"))).toEqual({ version: "v0" })
  expect((await stat(join(dir, "v0"))).isDirectory()).toBe(true)
})

test("a cancel that arrives just as extract finishes still refuses to commit the install", async () => {
  const { dir, events } = await setup()
  const packSpec = spec()
  const holder: { pack?: ReturnType<typeof createGraphicsPack> } = {}
  const pack = createGraphicsPack({
    dir, pack: packSpec, send: (event) => events.push(event), fetch: streaming(bytes) as unknown as typeof fetch,
    extract: async (_archive, into) => {
      await writePackFiles(into, packSpec)
      // the user's cancel lands right as the unpack finishes, before installed.json is written
      holder.pack!.cancel()
    },
  })
  holder.pack = pack
  await expect(pack.install()).rejects.toThrow()
  expect(events.at(-1)).toEqual({ type: "graphics-pack", state: "cancelled" })
  await expect(readFile(join(dir, "installed.json"))).rejects.toThrow()
  await expect(stat(join(dir, "v1"))).rejects.toThrow()
})

test("state() reports installing once the download ends and unpacking begins", async () => {
  const events: AppEvent[] = []
  const packSpec = spec()
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  let resolveExtract!: () => void
  let started!: () => void
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve
  })
  const pack = createGraphicsPack({
    dir, pack: packSpec, send: (event) => events.push(event), fetch: streaming(bytes) as unknown as typeof fetch,
    extract: (_archive, into) =>
      new Promise<void>((resolve) => {
        resolveExtract = () => void writePackFiles(into, packSpec).then(resolve)
        started()
      }),
  })
  const installing = pack.install()
  await startedPromise
  expect(await pack.state()).toEqual({ state: "installing" })
  resolveExtract()
  await installing
  expect(events.some((event) => event.type === "graphics-pack" && event.state === "installing")).toBe(true)
})

test("only one install at a time", async () => {
  const { pack } = await setup()
  const first = pack.install()
  await expect(pack.install()).rejects.toThrow(/already/)
  await first
})

test("an extracted pack missing one of its programs is refused and cleaned up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  const events: AppEvent[] = []
  const packSpec = spec()
  const pack = createGraphicsPack({
    dir, pack: packSpec, fetch: streaming(bytes) as unknown as typeof fetch, send: (event) => events.push(event),
    // hyperframes itself never lands — a partial extract, or a pack built without it
    extract: async (_archive, into) => {
      await mkdir(join(into, "node/bin"), { recursive: true })
      await writeFile(join(into, packSpec.node), "")
      await mkdir(join(into, "chrome"), { recursive: true })
      await writeFile(join(into, packSpec.chrome), "")
    },
  })
  await expect(pack.install()).rejects.toThrow(/incomplete.*hyperframes/)
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(events.at(-1)).toMatchObject({ type: "graphics-pack", state: "failed" })
  await expect(readFile(join(dir, "v1", packSpec.node))).rejects.toThrow()
  // the pack is 155 MB: a failed install, even one that fails after the download, leaves nothing behind
  await expect(readFile(join(dir, "v1.tar.gz"))).rejects.toThrow()
})

test.skipIf(!existsSync("/usr/bin/xattr") || !existsSync("/usr/bin/tar"))(
  "the real tar unpacks a pack's files where paths() says they are, with the quarantine flag cleared",
  async () => {
    const srcDir = await mkdtemp(join(tmpdir(), "gpack-src-"))
    const rels = [GRAPHICS_PACK.node, GRAPHICS_PACK.hyperframes, GRAPHICS_PACK.chrome]
    for (const rel of rels) {
      const full = join(srcDir, rel)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, `content of ${rel}`)
    }
    await runProcess("/usr/bin/xattr", ["-w", "com.apple.quarantine", "0081;00000000;BOXBLACK;", join(srcDir, GRAPHICS_PACK.node)])

    const archivePath = join(srcDir, "pack.tar.gz")
    const tops = [...new Set(rels.map((rel) => rel.split("/")[0]!))]
    // COPYFILE_DISABLE, if the developer's shell happens to set it, can change what tar stores — build without it
    const buildEnv = { ...process.env }
    delete buildEnv.COPYFILE_DISABLE
    await runProcess("/usr/bin/tar", ["-czf", archivePath, "-C", srcDir, ...tops], { env: buildEnv })
    const tarBytes = await readFile(archivePath)

    // tar -czf stores node's quarantine flag in the archive (an AppleDouble `._node` entry inside
    // the gzip stream, so searching the .tar.gz itself finds nothing) and tar -xzf restores it with
    // a fresh value; an archive of an untagged file extracts with none. The probe checks this
    // before the test relies on it.
    const probeDir = await mkdtemp(join(tmpdir(), "gpack-probe-"))
    await runProcess("/usr/bin/tar", ["-xzf", archivePath, "-C", probeDir])
    const probe = await runProcess("/usr/bin/xattr", ["-p", "com.apple.quarantine", join(probeDir, GRAPHICS_PACK.node)])
    expect(probe.stdout.trim().length).toBeGreaterThan(0)

    const dir = await mkdtemp(join(tmpdir(), "gpack-"))
    const events: AppEvent[] = []
    const packSpec = {
      version: "real", url: "https://example.test/real.tgz",
      sha256: createHash("sha256").update(tarBytes).digest("hex"), bytes: tarBytes.length,
      node: GRAPHICS_PACK.node, hyperframes: GRAPHICS_PACK.hyperframes, chrome: GRAPHICS_PACK.chrome,
    }
    // no `extract` override: this is the default untar, run for real against a tiny archive
    const pack = createGraphicsPack({ dir, pack: packSpec, send: (event) => events.push(event), fetch: streaming(tarBytes) as unknown as typeof fetch })

    await pack.install()

    const paths = await pack.paths()
    expect(paths).toEqual({
      root: join(dir, "real"),
      node: join(dir, "real", GRAPHICS_PACK.node),
      hyperframes: join(dir, "real", GRAPHICS_PACK.hyperframes),
      chrome: join(dir, "real", GRAPHICS_PACK.chrome),
    })
    for (const rel of rels) expect(await readFile(join(dir, "real", rel), "utf8")).toBe(`content of ${rel}`)
    // `xattr -p` exits non-zero (rejects) when the attribute is absent, as untar's own `xattr -rcs` leaves it
    await expect(runProcess("/usr/bin/xattr", ["-p", "com.apple.quarantine", paths!.node])).rejects.toThrow(/No such xattr/)
  },
)
