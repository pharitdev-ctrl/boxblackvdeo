import { expect, test, vi } from "vitest"
import { z } from "zod"
import type { ToolReport } from "@boxblack/core/media"
import { PLANNER_PROMPT } from "@boxblack/core/planner"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TranscriptCache, type AsrEngine, type MediaTools, type Transcript, type WhisperModel } from "@boxblack/core/asr"
import { MediaCache } from "@boxblack/core/cache"
import type { Effort, LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { OBJECTS_PROMPT, RETAKE_PROMPT, type SceneObjects, type VideoInsight, type VisionKey, type VisionTools } from "@boxblack/core/vision"
import type { AppEvent, ProjectDetail } from "../shared/api.ts"
import { createAnalysisService, defaultTransports, SCRIBE_MODEL, scribeEngine, whisperEngine, type AnalysisDeps } from "./analysis.ts"
import type { ObjectsKey } from "./objects.ts"
import { ProgressStore } from "./progress.ts"
import { SecretStore, SettingsStore, type SecretBox } from "./settings.ts"

const box: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain),
  decryptString: (cipher) => cipher.toString(),
}

const transcriptOf = (text: string): Transcript => ({
  engine: "scribe",
  model: "scribe_v2",
  language: "tha",
  utterances: [{ text, startUs: 0, endUs: 1_000_000 }],
  words: [{ text, startUs: 0, endUs: 1_000_000 }],
  audioEvents: [],
})

async function setup(overrides: Partial<AnalysisDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-analysis-"))
  const videos = ["a", "b"].map((id) => ({
    id,
    path: join(dir, `${id}.mov`),
    name: `${id}.mov`,
    durationUs: 4_000_000,
    width: 1080,
    height: 1920,
    exists: true,
  }))
  for (const video of videos) await writeFile(video.path, video.id)
  const project: ProjectDetail = {
    name: "p",
    folder: "/drafts/p",
    capcutVersion: "9.4.0",
    versionTested: true,
    fps: 30,
    canvas: { width: 1080, height: 1920 },
    timelineSegmentCount: 0,
    videos,
  }

  const events: AppEvent[] = []
  const engineCalls: { kind: string; key?: string; language: string }[] = []
  const transportCalls: { kind: string; credential: string; model: string; context: string; system: string; effort?: Effort }[] = []

  const fakeEngine = (kind: string, key?: string) => (language: string): AsrEngine => {
    engineCalls.push({ kind, key, language })
    return {
      settings: { engine: kind === "scribe" ? "scribe" : "whisper-local", model: "m", language: language as "th" },
      audioFormat: "flac",
      transcribe: async (audioPath) => transcriptOf(`said in ${audioPath.includes("a.mov") ? "a" : "b"}`),
    }
  }
  const fakeTransport = (kind: string, credential: string, effort?: Effort): LlmTransport => ({
    id: kind === "api" ? "anthropic-api" : "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      const context = request.content.at(-1)
      transportCalls.push({ kind, credential, model: request.model, context: context?.type === "text" ? context.text : "", system: request.system, effort })
      const output = { summary: "สรุป", scenes: [{ startSec: 0.5, endSec: 3.5, description: "คนพูด", kind: "talking-head", issues: [], keepClear: [0.1, 0.5] }] }
      return { output: output as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  })
  const media: MediaTools = {
    hasAudio: async () => true,
    extractAudio: async (_input, output) => writeFile(output, "audio"),
  }
  const visionTools: VisionTools = {
    hasAudio: async () => true,
    measure: async () => ({ sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] }),
    extractFrames: async (_input, timesUs, outDir) =>
      Promise.all(
        timesUs.map(async (atUs) => {
          const path = join(outDir, `f-${atUs}.jpg`)
          await writeFile(path, "jpeg")
          return { atUs, path }
        }),
      ),
  }

  const deps: AnalysisDeps = {
    settings: new SettingsStore(join(dir, "settings.json")),
    secrets: new SecretStore(join(dir, "secrets.json"), box),
    transcripts: new TranscriptCache(join(dir, "transcripts")),
    insights: new MediaCache<VideoInsight, VisionKey>(join(dir, "insights")),
    objects: new MediaCache<SceneObjects, ObjectsKey>(join(dir, "objects")),
    progress: new ProgressStore(join(dir, "progress")),
    workDir: join(dir, "work"),
    modelsDir: join(dir, "models"),
    model: { id: "m", label: "m", file: "ggml-m.bin", url: "http://unused", sizeBytes: 5, sha256: "x", dtwPreset: "base" },
    tools: { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe", whisper: "/bin/whisper-cli", claude: "/bin/claude" },
    inspect: async (folder) => {
      if (folder !== project.folder) throw new Error(`${folder} is not a CapCut project`)
      return project
    },
    send: (event) => events.push(event),
    media,
    visionTools,
    engines: {
      scribe: (apiKey, language) => fakeEngine("scribe", apiKey)(language),
      whisper: (_binary, _modelPath, _model, language) => fakeEngine("whisper")(language),
    },
    transports: {
      anthropic: (apiKey, effort) => fakeTransport("api", apiKey, effort),
      cli: (binary, effort) => fakeTransport("cli", binary, effort),
    },
    ...overrides,
  }
  return { deps, service: createAnalysisService(deps), events, engineCalls, transportCalls, project }
}

/** A call that describes pictures, not one of the objects pass that follows it. */
const describing = (call: { system: string }) => call.system !== OBJECTS_PROMPT.system

async function finished(events: AppEvent[]) {
  for (let i = 0; i < 400; i++) {
    const done = events.find((e) => e.type === "analysis-finished")
    if (done) return done
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("run never finished")
}

/** Scribe with a key, and the Anthropic API with a key: everything ready. */
async function ready(overrides: Partial<AnalysisDeps> = {}) {
  const context = await setup(overrides)
  await context.deps.settings.update({ asr: { engine: "scribe", language: "auto" } })
  await context.deps.secrets.set("elevenlabs", "sk-eleven")
  await context.deps.secrets.set("anthropic", "sk-ant-user")
  return context
}

test("analysis is not ready until the model is downloaded and Claude can be reached", async () => {
  const { service } = await setup()
  expect(await service.readiness()).toEqual({ problems: ["model-missing", "anthropic-key-missing"] })
})

test("readiness names every missing tool", async () => {
  const { service, deps } = await setup({ tools: { ffmpeg: null, ffprobe: null, whisper: null, claude: null } })
  await deps.settings.update({ llm: { transport: "claude-cli" } })
  expect((await service.readiness()).problems).toEqual(["ffmpeg-missing", "whisper-missing", "model-missing", "claude-cli-missing"])
})

test("tools that are installed but cannot do the job are named too", async () => {
  const report: ToolReport = {
    ffmpeg: { path: "/usr/local/bin/ffmpeg", version: "4.0", missing: ["blurdetect", "scdet"] },
    ffprobe: { path: "/usr/local/bin/ffprobe" },
    whisper: { path: "/usr/local/bin/whisper-cli", usable: false },
    claude: null,
  }
  const { service, deps } = await setup({ toolReport: async () => report })
  expect((await service.readiness()).problems).toEqual(["ffmpeg-incomplete", "whisper-unusable", "model-missing", "anthropic-key-missing"])
  // an unusable whisper-cli does not matter when Scribe transcribes
  await deps.settings.update({ asr: { engine: "scribe" } })
  expect((await service.readiness()).problems).toEqual(["ffmpeg-incomplete", "scribe-key-missing", "anthropic-key-missing"])
})

test("Scribe needs its key and the Anthropic API needs its own", async () => {
  const { service, deps } = await setup()
  await deps.settings.update({ asr: { engine: "scribe" } })
  expect((await service.readiness()).problems).toEqual(["scribe-key-missing", "anthropic-key-missing"])
  await deps.secrets.set("elevenlabs", "sk-1")
  await deps.secrets.set("anthropic", "sk-2")
  expect(await service.readiness()).toEqual({ problems: [] })
})

test("start transcribes the chosen videos, then describes their pictures, then finishes", async () => {
  const { service, events, project } = await ready()
  await service.start(project.folder, ["b"])
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "done" })

  const stages = events.filter((e) => e.type === "transcription" || e.type === "vision").map((e) => e.type)
  expect(stages.indexOf("vision")).toBeGreaterThan(stages.lastIndexOf("transcription"))
  const doneVision = events.filter((e) => e.type === "vision" && e.status.state === "done")
  expect(doneVision.map((e) => e.type === "vision" && e.videoId)).toEqual(["b"])
})

test("Claude sees what was said in the video it is describing", async () => {
  const { service, events, project, transportCalls } = await ready()
  await service.start(project.folder, ["a"])
  await finished(events)
  expect(transportCalls[0]!.context).toContain("said in a")
})

test("the Anthropic API is called with the stored key and the chosen model", async () => {
  const { service, events, project, transportCalls, deps } = await ready()
  await deps.settings.update({ llm: { model: "claude-sonnet-5" } })
  await service.start(project.folder, ["a"])
  await finished(events)
  // the objects pass after the pictures goes the same way; only the describing is counted here
  expect(transportCalls.filter(describing).map(({ kind, credential, model }) => ({ kind, credential, model }))).toEqual([
    { kind: "api", credential: "sk-ant-user", model: "claude-sonnet-5" },
  ])
})

test("Claude Code on this computer is used when chosen", async () => {
  const { service, events, project, transportCalls, deps } = await ready()
  await deps.settings.update({ llm: { transport: "claude-cli" } })
  await service.start(project.folder, ["a"])
  await finished(events)
  expect(transportCalls[0]).toMatchObject({ kind: "cli", credential: "/bin/claude" })
})

test("the pictures are looked at as hard as the settings say with Opus 5.5, on either connection; other models keep their own level", async () => {
  const { service, events, project, transportCalls, deps } = await ready()
  const run = async (videoId: string) => {
    events.length = 0
    await service.start(project.folder, [videoId])
    await finished(events)
  }
  await deps.settings.update({ llm: { model: "claude-opus-5-5", effort: "high" } })
  await run("a")
  await deps.settings.update({ llm: { transport: "claude-cli", effort: "low" } })
  await run("b")
  // another model is a fresh look
  await deps.settings.update({ llm: { model: "claude-opus-5" } })
  await run("a")
  expect(transportCalls.filter(describing).map(({ kind, model, effort }) => [kind, model, effort])).toEqual([
    ["api", "claude-opus-5-5", "high"],
    ["cli", "claude-opus-5-5", "low"],
    ["cli", "claude-opus-5", undefined],
  ])
})

test("the real connections are made at the effort asked for", async () => {
  // a stand-in claude that records its arguments and answers
  const dir = await mkdtemp(join(tmpdir(), "boxblack-effort-"))
  const bin = join(dir, "claude")
  const record = join(dir, "args.json")
  const answer = { type: "result", subtype: "success", is_error: false, structured_output: "ok", usage: {} }
  await writeFile(bin, `#!/usr/bin/env node
require("node:fs").readFileSync(0)
require("node:fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)))
console.log(${JSON.stringify(JSON.stringify(answer))})
`)
  await chmod(bin, 0o755)
  const ask = { model: "claude-opus-5-5", system: "s", content: [], schema: z.string(), maxTokens: 10 }
  await defaultTransports.cli(bin, "high").generate(ask)
  const args = JSON.parse(await readFile(record, "utf8")) as string[]
  expect(args[args.indexOf("--effort") + 1]).toBe("high")

  const sent: unknown[] = []
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: '"ok"' }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } })
  })
  try {
    await defaultTransports.anthropic("sk-ant", "low").generate(ask)
  } finally {
    vi.unstubAllGlobals()
  }
  expect(sent[0]).toMatchObject({ output_config: { effort: "low" } })
})

test("start hands the stored Scribe key and chosen language to the transcriber", async () => {
  const { service, events, project, engineCalls } = await ready()
  await service.start(project.folder, ["a"])
  await finished(events)
  expect(engineCalls).toEqual([{ kind: "scribe", key: "sk-eleven", language: "auto" }])
})

test("start refuses while something is not set up", async () => {
  const { service, project } = await setup()
  await expect(service.start(project.folder, ["a"])).rejects.toThrow(/model-missing/)
})

test("start refuses videos that are not in the project", async () => {
  const { service, project } = await ready()
  await expect(service.start(project.folder, ["a", "z"])).rejects.toThrow(/not in this project/)
})

test("start refuses a second run while one is going", async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const { service, project, events } = await ready({
    engines: {
      scribe: () => ({
        settings: { engine: "scribe", model: "m", language: "th" },
        audioFormat: "flac",
        transcribe: async () => {
          await blocked
          return transcriptOf("x")
        },
      }),
      whisper: () => {
        throw new Error("unused")
      },
    },
  })
  await service.start(project.folder, ["a"])
  await expect(service.start(project.folder, ["b"])).rejects.toThrow(/already running/)
  release()
  await finished(events)
})

test("cancel stops the run and says so", async () => {
  const { service, events, project } = await ready({
    engines: {
      scribe: () => ({
        settings: { engine: "scribe", model: "m", language: "th" },
        audioFormat: "flac",
        transcribe: (_path, { signal }) =>
          new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
      }),
      whisper: () => {
        throw new Error("unused")
      },
    },
  })
  await service.start(project.folder, ["a"])
  await new Promise((resolve) => setTimeout(resolve, 20))
  service.cancel()
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "cancelled" })
  expect(service.state()).toMatchObject({ running: false, outcome: "cancelled", error: null })
})

test("a cancel while the machine is still being checked stops the run before anything is paid for", async () => {
  let release!: () => void
  const checking = new Promise<void>((resolve) => (release = resolve))
  const { service, events, engineCalls, transportCalls, project } = await ready({
    toolReport: async () => {
      await checking
      return { ffmpeg: null, ffprobe: null, whisper: null, claude: null }
    },
  })
  const started = service.start(project.folder, ["a"])
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(service.state()).toMatchObject({ folder: project.folder, running: true })
  service.cancel()
  release()
  await started
  expect(events).toEqual([{ type: "analysis-finished", folder: project.folder, outcome: "cancelled" }])
  expect(engineCalls).toEqual([])
  expect(transportCalls).toEqual([])
  expect(service.state()).toMatchObject({ running: false, outcome: "cancelled" })
})

test("a cancel while the project is being read is not lost either", async () => {
  let release!: () => void
  const reading = new Promise<void>((resolve) => (release = resolve))
  const context = await ready()
  const { service, events, transportCalls, project } = await ready({
    inspect: async (folder) => {
      await reading
      return context.deps.inspect(folder)
    },
  })
  const started = service.start(project.folder, ["a"])
  await new Promise((resolve) => setTimeout(resolve, 5))
  service.cancel()
  release()
  await started
  expect(events).toEqual([{ type: "analysis-finished", folder: project.folder, outcome: "cancelled" }])
  expect(transportCalls).toEqual([])
  expect(service.state()).toMatchObject({ running: false, outcome: "cancelled" })
})

test("a start that cannot go ahead is on record as failed, and every screen is told, so none waits on it", async () => {
  const { service, project, events } = await setup()
  await expect(service.start(project.folder, ["a"])).rejects.toThrow("not ready")
  expect(service.state()).toMatchObject({ folder: project.folder, running: false, outcome: "failed" })
  expect(events).toEqual([{ type: "analysis-finished", folder: project.folder, outcome: "failed", error: expect.stringContaining("not ready") }])
  // and the next start is not refused as a run already going
  const ready2 = await ready()
  await ready2.service.start(ready2.project.folder, ["a"])
  expect(await finished(ready2.events)).toMatchObject({ outcome: "done" })
})

test("a run that fails remembers why, for a screen that comes back later", async () => {
  // a video's own failure is reported on that video; the run itself fails when something around it does
  const { service, events, project } = await ready({
    prompts: async () => {
      throw new Error("prompt หาย")
    },
  })
  await service.start(project.folder, ["a"])
  expect(await finished(events)).toMatchObject({ type: "analysis-finished", outcome: "failed", error: expect.stringContaining("prompt หาย") })
  expect(service.state()).toMatchObject({ running: false, outcome: "failed", error: expect.stringContaining("prompt หาย") })
})

test("state remembers where each video got to in both stages", async () => {
  const { service, events, project } = await ready()
  expect(service.state()).toBeNull()
  await service.start(project.folder, ["a", "b"])
  await finished(events)
  const state = service.state()!
  expect(state.folder).toBe(project.folder)
  expect(state.running).toBe(false)
  expect(state.outcome).toBe("done")
  expect(state.error).toBeNull()
  expect(Object.keys(state.transcription)).toEqual(["a", "b"])
  expect(state.vision.a!.state).toBe("done")
})

test("downloadModel fetches the model with progress and clears the model problem", async () => {
  const payload = Buffer.from("model")
  const server = createServer((_req, res) => res.end(payload))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/m.bin`
  const model: WhisperModel = {
    id: "m",
    label: "m",
    file: "ggml-m.bin",
    url,
    sizeBytes: payload.length,
    sha256: createHash("sha256").update(payload).digest("hex"),
    dtwPreset: "base",
  }
  const { service, events } = await setup({ model })

  await service.downloadModel()
  for (let i = 0; i < 200 && !events.some((e) => e.type === "model-download" && e.state === "done"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  server.close()

  expect(events.filter((e) => e.type === "model-download").at(-1)).toEqual({ type: "model-download", state: "done" })
  expect(events).toContainEqual({ type: "model-download", state: "progress", received: 5, total: 5 })
  expect((await service.readiness()).problems).not.toContain("model-missing")
})

test("downloadModel uses the fetch it is given, not the global one", async () => {
  const payload = Buffer.from("model")
  const model: WhisperModel = {
    id: "m",
    label: "m",
    file: "ggml-m.bin",
    url: "http://unused-because-fetch-is-replaced",
    sizeBytes: payload.length,
    sha256: createHash("sha256").update(payload).digest("hex"),
    dtwPreset: "base",
  }
  const calls: string[] = []
  const suppliedFetch = (async (url: string) => {
    calls.push(url)
    return new Response(new Blob([new Uint8Array(payload)]).stream(), { status: 200 })
  }) as unknown as typeof fetch
  const { service, events } = await setup({ model, fetch: suppliedFetch })

  vi.stubGlobal("fetch", async () => {
    throw new Error("the global fetch must not be used when one is supplied")
  })
  try {
    await service.downloadModel()
    for (let i = 0; i < 200 && !events.some((e) => e.type === "model-download" && e.state === "done"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  } finally {
    vi.unstubAllGlobals()
  }

  expect(calls).toEqual([model.url])
  expect(events.filter((e) => e.type === "model-download").at(-1)).toEqual({ type: "model-download", state: "done" })
})

test("the built-in engines extract the audio format each one needs", () => {
  const scribe = scribeEngine("sk", "th")
  const whisper = whisperEngine("/bin/whisper-cli", "/models/m.bin", { id: "large-v3-q5_0", dtwPreset: "large.v3" } as WhisperModel, "auto")
  expect([scribe.settings, scribe.audioFormat]).toEqual([{ engine: "scribe", model: "scribe_v2", language: "th" }, "flac"])
  expect([whisper.settings, whisper.audioFormat]).toEqual([{ engine: "whisper-local", model: "large-v3-q5_0", language: "auto" }, "wav"])
})

test("the words of each transcript reach the picture step, so a line said twice gets its takes compared", async () => {
  const w = (text: string, start: number, end: number) => ({ text, startUs: start * 1_000_000, endUs: end * 1_000_000 })
  const words = [w("สาม", 0.2, 0.5), w("สอง", 0.6, 0.9), w("หนึ่ง", 1, 1.2), w("สาม", 2, 2.4), w("สอง", 2.5, 2.9), w("หนึ่ง", 2.9, 3.3)]
  const countdown: Transcript = { ...transcriptOf("สาม สอง หนึ่ง สาม สอง หนึ่ง"), utterances: [w("สาม สอง หนึ่ง", 0.2, 1.2), w("สาม สอง หนึ่ง", 2, 3.3)], words }
  const { service, events, project, transportCalls } = await ready({
    engines: {
      scribe: () => ({ settings: { engine: "scribe", model: "m", language: "th" }, audioFormat: "flac", transcribe: async () => countdown }),
      whisper: () => ({ settings: { engine: "whisper-local", model: "m", language: "th" }, audioFormat: "flac", transcribe: async () => countdown }),
    },
  })
  await service.start(project.folder, ["a"])
  await finished(events)
  expect(transportCalls.map((call) => call.system)).toContain(RETAKE_PROMPT)
})

test("pictures are described with the prompt the license server handed out", async () => {
  const { service, events, project, transportCalls } = await ready({
    prompts: async () => ({ vision: { system: "บรรยายภาพตามแบบของ server", version: "vision+server-1" }, planner: PLANNER_PROMPT }),
  })
  await service.start(project.folder, ["a"])
  await finished(events)
  expect(transportCalls[0]!.system).toBe("บรรยายภาพตามแบบของ server")
})

test("a run that finishes cleanly records that the project is analysed, so the list can say so", async () => {
  const { service, events, project, deps } = await ready()
  const before = Date.now()
  await service.start(project.folder, ["a", "b"])
  await finished(events)
  const progress = (await deps.progress.get(project.folder))!
  expect(progress.videoIds).toEqual(["a", "b"])
  expect(progress.analysedAt).toBeGreaterThanOrEqual(before)
  expect(progress.analysedAt).toBeLessThanOrEqual(Date.now())
})

test("a run that is cancelled or fails records nothing: the project is not analysed", async () => {
  const cancelled = await ready({
    engines: {
      scribe: () => ({
        settings: { engine: "scribe", model: "m", language: "th" },
        audioFormat: "flac",
        transcribe: (_path, { signal }) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
      }),
      whisper: () => {
        throw new Error("unused")
      },
    },
  })
  await cancelled.service.start(cancelled.project.folder, ["a"])
  await new Promise((resolve) => setTimeout(resolve, 20))
  cancelled.service.cancel()
  await finished(cancelled.events)
  expect(await cancelled.deps.progress.get(cancelled.project.folder)).toBeNull()

  const failed = await ready({
    prompts: async () => {
      throw new Error("prompt หาย")
    },
  })
  await failed.service.start(failed.project.folder, ["a"])
  await finished(failed.events)
  expect(await failed.deps.progress.get(failed.project.folder)).toBeNull()
})

test("a video whose speech could not be read is not looked at, so no picture is described or kept without its words", async () => {
  // Scribe fails on a, as a dropped connection would; b goes through
  const { service, events, project, transportCalls, deps } = await ready({
    engines: {
      scribe: () => ({
        settings: { engine: "scribe", model: "m", language: "th" },
        audioFormat: "flac",
        transcribe: async (audioPath) => {
          if (audioPath.includes("a.mov")) throw new Error("network down")
          return transcriptOf("said in b")
        },
      }),
      whisper: () => {
        throw new Error("unused")
      },
    },
  })
  await service.start(project.folder, ["a", "b"])
  await finished(events)
  const visionOf = (id: string) => events.filter((e) => e.type === "vision" && e.videoId === id).at(-1)
  expect(visionOf("a")).toMatchObject({ status: { state: "failed" } })
  expect(visionOf("b")).toMatchObject({ status: { state: "done" } })
  expect(transportCalls.every((call) => !call.context.includes("said in a"))).toBe(true)
  // the project list counts only what was read in full
  expect((await deps.progress.get(project.folder))!.videoIds).toEqual(["b"])
})

test("a run in which no video could be read leaves the project not analysed", async () => {
  const { service, events, project, deps } = await ready({
    engines: {
      scribe: () => ({
        settings: { engine: "scribe", model: "m", language: "th" },
        audioFormat: "flac",
        transcribe: async () => {
          throw new Error("network down")
        },
      }),
      whisper: () => {
        throw new Error("unused")
      },
    },
  })
  await service.start(project.folder, ["a", "b"])
  await finished(events)
  expect(await deps.progress.get(project.folder)).toBeNull()
})

test("a run still finishes when the note of it cannot be written", async () => {
  const { service, events, project } = await ready({
    progress: {
      put: async () => {
        throw new Error("disk full")
      },
    } as unknown as ProgressStore,
  })
  await service.start(project.folder, ["a"])
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "done" })
})

test("Claude Code that is there but not signed in is named before any work starts, not halfway through it", async () => {
  const signedOut = await setup({ claudeSignedIn: async () => false })
  await signedOut.deps.settings.update({ llm: { transport: "claude-cli" } })
  expect((await signedOut.service.readiness()).problems).toContain("claude-cli-login")

  const signedIn = await setup({ claudeSignedIn: async () => true })
  await signedIn.deps.settings.update({ llm: { transport: "claude-cli" } })
  expect((await signedIn.service.readiness()).problems).not.toContain("claude-cli-login")

  // when it cannot be asked, nothing is claimed either way
  const unknown = await setup({ claudeSignedIn: async () => null })
  await unknown.deps.settings.update({ llm: { transport: "claude-cli" } })
  expect((await unknown.service.readiness()).problems).not.toContain("claude-cli-login")
})

test("the pictures are looked at as often as the settings say, and what was seen counts as analysed only at that rate", async () => {
  const looked: number[][] = []
  // the harness's transcriber names its model "m", which is not the model the cache keys expect of Scribe, so
  // nothing it reads ever counts as analysed; this one names the real model, as the app's does
  const scribe = (language: string): AsrEngine => ({
    settings: { engine: "scribe", model: SCRIBE_MODEL, language: language as "th" },
    audioFormat: "flac",
    transcribe: async () => transcriptOf("said in a"),
  })
  const { deps, service, events, project } = await ready({
    engines: { scribe: (_apiKey, language) => scribe(language), whisper: (_binary, _modelPath, _model, language) => scribe(language) },
    visionTools: {
      hasAudio: async () => true,
      measure: async () => ({ sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] }),
      extractFrames: async (_input, timesUs, outDir) => {
        looked.push(timesUs)
        return Promise.all(
          timesUs.map(async (atUs) => {
            const path = join(outDir, `f-${atUs}.jpg`)
            await writeFile(path, "jpeg")
            return { atUs, path }
          }),
        )
      },
    },
  })
  await deps.settings.update({ vision: { frameEveryS: 1 } })
  await service.start(project.folder, ["a"])
  expect(await finished(events)).toMatchObject({ outcome: "done" })
  // a 4 s clip: half a second in, then every second — four frames, where every 3 s gives two
  // and the objects pass is shown the very same frames, not a new sampling
  expect(looked).toEqual([[500_000, 1_500_000, 2_500_000, 3_500_000], [500_000, 1_500_000, 2_500_000, 3_500_000]])
  expect(await service.analysed(project.folder)).toEqual(["a"])
  // at another rate it has to be looked at again; back at this one, what was seen is still there
  await deps.settings.update({ vision: { frameEveryS: 3 } })
  expect(await service.analysed(project.folder)).toEqual([])
  await deps.settings.update({ vision: { frameEveryS: 1 } })
  expect(await service.analysed(project.folder)).toEqual(["a"])
})

/**
 * The harness's transcriber names its model "m", which the cache keys of the settings never expect,
 * so the objects pass finds no insight for what it read; this one names Scribe's real model.
 */
const realScribe = (transcribe: AsrEngine["transcribe"] = async () => transcriptOf("said in a")) => {
  const engine = (language: string): AsrEngine => ({ settings: { engine: "scribe", model: SCRIBE_MODEL, language: language as "th" }, audioFormat: "flac", transcribe })
  return { scribe: (_apiKey: string, language: string) => engine(language), whisper: (_binary: string, _modelPath: string, _model: WhisperModel, language: string) => engine(language) }
}

test("once the pictures are described, the same run finds the objects in them, and finishes after that", async () => {
  const { service, events, project, transportCalls } = await ready({ engines: realScribe() })
  await service.start(project.folder, ["a"])
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "done" })
  const order = events.map((e) => (e.type === "vision" || e.type === "objects" ? `${e.type}:${e.status.state}` : e.type)).filter((step) => !step.startsWith("transcription"))
  // the pictures are done, and so "analysed", before the objects pass starts
  expect(order.slice(order.indexOf("vision:done"))).toEqual(["vision:done", "objects:running", "objects:done", "analysis-finished"])
  expect(events).toContainEqual({ type: "objects", folder: project.folder, videoId: "a", status: { state: "done" } })
  expect(transportCalls.at(-1)!.system).toBe(OBJECTS_PROMPT.system)
  expect(await service.withoutObjects(project.folder)).toEqual([])
})

test("an objects pass that fails is told on its video and leaves the analysis done", async () => {
  const context = await ready({ engines: realScribe() })
  const describing = context.deps.transports!
  const { events, project, deps } = context
  deps.transports = {
    ...describing,
    anthropic: (apiKey, effort) => {
      const transport = describing.anthropic(apiKey, effort)
      return {
        ...transport,
        generate: async (request) => {
          if (request.system === OBJECTS_PROMPT.system) throw new Error("Claude ล่ม")
          return transport.generate(request)
        },
      }
    },
  }
  const failing = createAnalysisService(deps)
  await failing.start(project.folder, ["a"])
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "done" })
  expect(events).toContainEqual({ type: "objects", folder: project.folder, videoId: "a", status: { state: "failed", error: "Claude ล่ม" } })
  expect(failing.state()).toMatchObject({ outcome: "done", vision: { a: { state: "done" } } })
  expect((await deps.progress.get(project.folder))!.videoIds).toEqual(["a"])
  // and the button may offer it again
  expect(await failing.withoutObjects(project.folder)).toEqual(["a"])
})

/** Runs an analysis of both videos with no objects pass able to find anything, so both are analysed without objects. */
async function analysedWithoutObjects(overrides: Partial<AnalysisDeps> = {}) {
  const context = await ready({ engines: realScribe(), ...overrides })
  const { service, events, project } = context
  const objects = context.deps.objects
  // a cache that cannot be written keeps the first run's objects from being stored
  context.deps.objects = { entry: async () => ({ get: async () => null, put: async () => {} }), get: async () => null, put: async () => {} } as unknown as typeof objects
  await service.start(project.folder, ["a", "b"])
  await finished(events)
  context.deps.objects = objects
  events.length = 0
  return context
}

test("the objects of videos analysed before the pass existed are found on request, and the run says when it is done", async () => {
  const { service, events, project, transportCalls } = await analysedWithoutObjects()
  expect(await service.withoutObjects(project.folder)).toEqual(["a", "b"])
  const asked = transportCalls.length
  await service.locateObjects(project.folder, ["b"])
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "done" })
  expect(events.filter((e) => e.type === "objects").map((e) => e.type === "objects" && [e.videoId, e.status.state])).toEqual([
    ["b", "running"],
    ["b", "done"],
  ])
  expect(transportCalls.slice(asked).map((call) => call.system)).toEqual([OBJECTS_PROMPT.system])
  expect(await service.withoutObjects(project.folder)).toEqual(["a"])
  // nothing about the analysis itself changed: the screen that rebuilds from it still sees the last run
  expect(Object.keys(service.state()!.transcription)).toEqual(["a", "b"])
})

test("finding objects takes the one-run lock: neither it nor an analysis starts while the other runs", async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const context = await analysedWithoutObjects()
  const { events, project, deps } = context
  const extract = deps.visionTools!.extractFrames
  deps.visionTools = {
    ...deps.visionTools!,
    extractFrames: async (...args) => {
      await blocked
      return extract(...args)
    },
  }
  const locking = createAnalysisService(deps)
  await locking.locateObjects(project.folder, ["a"])
  await expect(locking.start(project.folder, ["b"])).rejects.toThrow("an analysis is already running")
  await expect(locking.locateObjects(project.folder, ["b"])).rejects.toThrow("an analysis is already running")
  release()
  expect(await finished(events)).toMatchObject({ outcome: "done" })

  // and while an analysis runs, objects are refused
  let releaseRun!: () => void
  const running = new Promise<void>((resolve) => (releaseRun = resolve))
  const transcribing = createAnalysisService({
    ...deps,
    engines: realScribe(async () => {
      await running
      return transcriptOf("said in a")
    }),
  })
  events.length = 0
  await transcribing.start(project.folder, ["a"])
  await expect(transcribing.locateObjects(project.folder, ["b"])).rejects.toThrow("an analysis is already running")
  releaseRun()
  await finished(events)
})

test("finding objects refuses a folder that is not a project, and videos that are not in it", async () => {
  const { service, project, events } = await analysedWithoutObjects()
  await expect(service.locateObjects("/tmp/elsewhere", ["a"])).rejects.toThrow("not a CapCut project")
  await expect(service.locateObjects(project.folder, ["a", "z"])).rejects.toThrow("video z is not in this project")
  expect(events).toEqual([])
  // a refusal does not hold the lock
  await service.locateObjects(project.folder, ["a"])
  expect(await finished(events)).toMatchObject({ outcome: "done" })
})

test("finding objects refuses when Claude or ffmpeg cannot be reached", async () => {
  const { service, project, deps } = await analysedWithoutObjects()
  await deps.secrets.delete("anthropic")
  await expect(service.locateObjects(project.folder, ["a"])).rejects.toThrow(/not ready: anthropic-key-missing/)
})

test("a cancel stops finding objects and says so", async () => {
  const context = await analysedWithoutObjects()
  const { project, events, deps } = context
  const cancelling = createAnalysisService({
    ...deps,
    visionTools: {
      ...deps.visionTools!,
      extractFrames: (_input, _timesUs, _outDir, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
    },
  })
  await cancelling.locateObjects(project.folder, ["a", "b"])
  await new Promise((resolve) => setTimeout(resolve, 20))
  cancelling.cancel()
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "cancelled" })
  expect(events.filter((e) => e.type === "objects").map((e) => e.type === "objects" && e.videoId)).toEqual(["a"])
  // and the lock is free again
  await expect(cancelling.locateObjects(project.folder, ["a"])).resolves.toBeUndefined()
  cancelling.cancel()
})

test("a settings change while the speech is read does not make the pass after the pictures miss them", async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const { service, events, project, deps } = await ready({
    engines: realScribe(async () => {
      await blocked
      return transcriptOf("said in a")
    }),
  })
  await service.start(project.folder, ["a"])
  await new Promise((resolve) => setTimeout(resolve, 20))
  // the run has read its settings by now; the user changes the rate meanwhile
  await deps.settings.update({ vision: { frameEveryS: 1 } })
  release()
  expect(await finished(events)).toMatchObject({ outcome: "done" })
  expect(events).toContainEqual({ type: "objects", folder: project.folder, videoId: "a", status: { state: "done" } })
})

test("a cancel during the objects pass of an analysis ends it cancelled, with the videos read already noted and their pictures done", async () => {
  let extractions = 0
  const context = await ready({ engines: realScribe() })
  const { project, events, deps } = context
  const extract = deps.visionTools!.extractFrames
  const cancelling = createAnalysisService({
    ...deps,
    visionTools: {
      ...deps.visionTools!,
      // the first extraction is the describing; the second, the objects pass, waits for the cancel
      extractFrames: (input, timesUs, outDir, signal) =>
        ++extractions === 1 ? extract(input, timesUs, outDir, signal) : new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
    },
  })
  await cancelling.start(project.folder, ["a"])
  for (let i = 0; i < 400 && !events.some((e) => e.type === "objects"); i++) await new Promise((resolve) => setTimeout(resolve, 5))
  cancelling.cancel()
  expect(await finished(events)).toEqual({ type: "analysis-finished", folder: project.folder, outcome: "cancelled" })
  expect((await deps.progress.get(project.folder))!.videoIds).toEqual(["a"])
  expect(cancelling.state()).toMatchObject({ outcome: "cancelled", vision: { a: { state: "done" } } })
})

test("finding objects for no video is refused, and holds no lock", async () => {
  const { service, project, events } = await analysedWithoutObjects()
  await expect(service.locateObjects(project.folder, [])).rejects.toThrow("no video is chosen")
  expect(events).toEqual([])
  await service.locateObjects(project.folder, ["a"])
  expect(await finished(events)).toMatchObject({ outcome: "done" })
})
