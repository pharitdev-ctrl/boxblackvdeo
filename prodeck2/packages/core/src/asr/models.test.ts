import { afterEach, expect, test } from "vitest"
import { createHash, randomBytes } from "node:crypto"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { downloadModel, modelState, WHISPER_MODELS, type WhisperModel } from "./models.ts"

const payload = randomBytes(200_000)
const sha256 = createHash("sha256").update(payload).digest("hex")

interface ServerOptions {
  /** close the connection after sending this many body bytes */
  cutAfter?: number
  ignoreRange?: boolean
}

let server: Server | undefined
const ranges: (string | undefined)[] = []

afterEach(() => {
  server?.close()
  server = undefined
  ranges.length = 0
})

async function serve(options: ServerOptions = {}): Promise<string> {
  server = createServer((req, res) => {
    ranges.push(req.headers.range)
    const match = /bytes=(\d+)-/.exec(req.headers.range ?? "")
    const start = match && !options.ignoreRange ? Number(match[1]) : 0
    const body = payload.subarray(start)
    res.writeHead(start > 0 ? 206 : 200, { "content-length": body.length })
    if (options.cutAfter !== undefined) {
      res.write(body.subarray(0, options.cutAfter), () => res.destroy())
    } else {
      res.end(body)
    }
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/ggml-test.bin`
}

async function testModel(url: string, overrides: Partial<WhisperModel> = {}): Promise<{ dir: string; model: WhisperModel }> {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-models-"))
  return {
    dir,
    model: { id: "test", label: "test", file: "ggml-test.bin", url, sizeBytes: payload.length, sha256, dtwPreset: "base", ...overrides },
  }
}

test("the catalog pins the large-v3 q5_0 model by size and checksum", () => {
  expect(WHISPER_MODELS[0]).toMatchObject({
    file: "ggml-large-v3-q5_0.bin",
    sizeBytes: 1_081_140_203,
    sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
  })
})

test("the model is fetched from one fixed revision, so the file behind the link can never change", () => {
  for (const model of WHISPER_MODELS) {
    // a branch name follows whatever is pushed next; a commit is the same bytes forever
    expect(model.url).toMatch(/\/resolve\/[0-9a-f]{40}\//)
    expect(model.url).not.toContain("/resolve/main/")
  }
})

test("downloadModel saves a verified model and reports progress up to the full size", async () => {
  const { dir, model } = await testModel(await serve())
  const progress: number[] = []
  const path = await downloadModel(dir, model, { onProgress: (received) => progress.push(received) })

  expect(path).toBe(join(dir, "ggml-test.bin"))
  expect(Buffer.compare(await readFile(path), payload)).toBe(0)
  expect(progress.at(-1)).toBe(payload.length)
  expect(await modelState(dir, model)).toEqual({ status: "ready" })
})

test("modelState reports a model that was never downloaded", async () => {
  const { dir, model } = await testModel("http://unused")
  expect(await modelState(dir, model)).toEqual({ status: "missing" })
})

test("an interrupted download leaves a partial file that modelState reports", async () => {
  const { dir, model } = await testModel(await serve({ cutAfter: 50_000 }))
  await expect(downloadModel(dir, model)).rejects.toThrow()
  expect(await modelState(dir, model)).toEqual({ status: "partial", bytes: 50_000 })
})

test("downloadModel resumes a partial download with a Range request", async () => {
  const { dir, model } = await testModel(await serve())
  await writeFile(join(dir, "ggml-test.bin.part"), payload.subarray(0, 50_000))

  const path = await downloadModel(dir, model)
  expect(ranges).toEqual(["bytes=50000-"])
  expect(Buffer.compare(await readFile(path), payload)).toBe(0)
})

test("downloadModel starts over when the server ignores the Range request", async () => {
  const { dir, model } = await testModel(await serve({ ignoreRange: true }))
  await writeFile(join(dir, "ggml-test.bin.part"), payload.subarray(0, 50_000))

  const path = await downloadModel(dir, model)
  expect(Buffer.compare(await readFile(path), payload)).toBe(0)
})

test("downloadModel throws away a file whose checksum does not match", async () => {
  const { dir, model } = await testModel(await serve(), { sha256: "0".repeat(64) })
  await expect(downloadModel(dir, model)).rejects.toThrow(/checksum/)
  expect(await modelState(dir, model)).toEqual({ status: "missing" })
})

test("cancelling keeps what was downloaded so far", async () => {
  const { dir, model } = await testModel(await serve())
  const controller = new AbortController()
  await expect(
    downloadModel(dir, model, {
      signal: controller.signal,
      onProgress: (received) => {
        if (received > 0) controller.abort()
      },
    }),
  ).rejects.toThrow(/abort/i)
  const partial = await stat(join(dir, "ggml-test.bin.part"))
  expect(partial.size).toBeGreaterThan(0)
})

test("a download the disk will not take fails with the disk's reason, instead of stopping the app or waiting forever", { timeout: 3000 }, async () => {
  const { dir, model } = await testModel(await serve())
  // the partial file cannot be written: here because the folder is read-only, for a customer because the disk is full
  const { chmod } = await import("node:fs/promises")
  await chmod(dir, 0o555)
  const crashes: unknown[] = []
  const record = (error: unknown) => crashes.push(error)
  process.on("uncaughtException", record)
  try {
    // small pieces arriving one by one, as a slow connection gives them: the disk fails between two of them
    const slow: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            controller.enqueue(payload.subarray(0, 100))
          },
        }),
      )
    await expect(downloadModel(dir, model, { fetch: slow })).rejects.toThrow(/EACCES/)
  } finally {
    process.off("uncaughtException", record)
    await chmod(dir, 0o755)
  }
  expect(crashes).toEqual([])
})
