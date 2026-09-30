import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import { once } from "node:events"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { join } from "node:path"

export interface WhisperModel {
  id: string
  label: string
  file: string
  url: string
  sizeBytes: number
  sha256: string
  /** whisper.cpp --dtw preset matching the model's alignment heads */
  dtwPreset: string
}

/**
 * Size and checksum from Hugging Face's LFS metadata (checked 2026-09-17). The link names a commit
 * of the repo, not `main`, so every customer gets the same bytes whatever is pushed there later;
 * the file at that commit was checked against the checksum on 2026-09-23.
 * large-v3 rather than turbo: turbo is noticeably worse on Thai.
 */
export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "large-v3-q5_0",
    label: "Whisper large-v3 (q5_0)",
    file: "ggml-large-v3-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-q5_0.bin",
    sizeBytes: 1_081_140_203,
    sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
    dtwPreset: "large.v3",
  },
]

export type ModelState = { status: "missing" } | { status: "partial"; bytes: number } | { status: "ready" }

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

const partPath = (dir: string, model: WhisperModel) => join(dir, `${model.file}.part`)

/** Cheap check by size only; the checksum was verified when the file was downloaded. */
export async function modelState(dir: string, model: WhisperModel): Promise<ModelState> {
  if ((await sizeOf(join(dir, model.file))) === model.sizeBytes) return { status: "ready" }
  const partial = await sizeOf(partPath(dir, model))
  return partial ? { status: "partial", bytes: partial } : { status: "missing" }
}

/**
 * Downloads into `<file>.part`, resuming an earlier partial download when the server
 * honours Range, and only moves the file into place once size and SHA-256 match.
 * Cancelling or losing the connection keeps the partial file for next time.
 */
export async function downloadModel(
  dir: string,
  model: WhisperModel,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal; onProgress?: (received: number, total: number) => void } = {},
): Promise<string> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, model.file)
  const part = partPath(dir, model)

  let offset = (await sizeOf(part)) ?? 0
  if (offset >= model.sizeBytes) {
    await rm(part, { force: true })
    offset = 0
  }

  const response = await (options.fetch ?? fetch)(model.url, {
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
    signal: options.signal,
  })
  if (!response.ok || !response.body) throw new Error(`downloading ${model.file} failed: HTTP ${response.status}`)
  // anything but 206 is the whole file from byte zero
  if (response.status !== 206) offset = 0

  const hash = createHash("sha256")
  if (offset > 0) for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)

  const out = createWriteStream(part, { flags: offset > 0 ? "a" : "w" })
  // a full disk fails a write between two chunks of the download: stop the download with it, and
  // never let it reach the app as an error nobody is listening for
  let failed: Error | null = null
  const body = Readable.fromWeb(response.body as NodeReadableStream)
  out.on("error", (error) => {
    failed = error
    body.destroy(error)
  })
  let received = offset
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      hash.update(chunk)
      if (!out.write(chunk)) await once(out, "drain")
      received += chunk.length
      options.onProgress?.(received, model.sizeBytes)
      options.signal?.throwIfAborted()
    }
  } finally {
    if (!out.destroyed) await new Promise<void>((resolve) => out.end(resolve))
  }
  if (failed) throw failed

  if (received !== model.sizeBytes || hash.digest("hex") !== model.sha256) {
    await rm(part, { force: true })
    throw new Error(`${model.file} did not match its expected checksum — the download was discarded, try again`)
  }
  await rename(part, target)
  return target
}
