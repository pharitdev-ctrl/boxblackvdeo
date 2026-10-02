import { join } from "node:path"
import {
  downloadModel,
  modelState,
  transcribeVideos,
  transcribeWithScribe,
  transcribeWithWhisper,
  type AsrEngine,
  type MediaTools,
  type ModelState,
  type SpokenLanguage,
  type TranscriptCache,
  type WhisperModel,
} from "@boxblack/core/asr"
import type { MediaCache } from "@boxblack/core/cache"
import { anthropicTransport, claudeCliTransport, effortFor, type Effort, type LlmTransport } from "@boxblack/core/llm"
import { extractAudio, hasAudioStream, type ToolReport } from "@boxblack/core/media"
import {
  describeVideos,
  extractFrames,
  measureSignals,
  VISION_PROMPT,
  visionSampling,
  type RetakeLoad,
  type VideoInsight,
  type VisionKey,
  type VisionTools,
} from "@boxblack/core/vision"
import type { AnalysisState, AppEvent, ProjectDetail, Readiness, ReadinessProblem } from "../shared/api.ts"
import { analysedVideos, knownRetakes } from "./footage.ts"
import { locateVideos, videosWithoutObjects, type ObjectsCache } from "./objects.ts"
import type { ProgressStore } from "./progress.ts"
import type { Prompts } from "./prompts.ts"
import type { AppSettings, SecretStore, SettingsStore } from "./settings.ts"

export interface EngineFactories {
  scribe(apiKey: string, language: SpokenLanguage): AsrEngine
  whisper(binary: string, modelPath: string, model: WhisperModel, language: SpokenLanguage): AsrEngine
}

export interface TransportFactories {
  /** with no effort, the model thinks at its own default */
  anthropic(apiKey: string, effort?: Effort): LlmTransport
  cli(binary: string, effort?: Effort): LlmTransport
}

export interface AnalysisDeps {
  settings: SettingsStore
  secrets: SecretStore
  transcripts: TranscriptCache
  insights: MediaCache<VideoInsight, VisionKey>
  /** where things are in each scene of an insight, found by the objects pass after the pictures are described */
  objects: ObjectsCache
  /** what each project has had analysed, so the project list can say how far it got */
  progress: ProgressStore
  /** extracted audio and frames live here while a video is being analysed */
  workDir: string
  modelsDir: string
  model: WhisperModel
  tools: { ffmpeg: string | null; ffprobe: string | null; whisper: string | null; claude: string | null }
  /** Resolves a registered CapCut project; rejects anything else. */
  inspect(folder: string): Promise<ProjectDetail>
  send(event: AppEvent): void
  /** prompts from the license server; the built-in ones when absent */
  prompts?: () => Promise<Prompts>
  /** what the installed tools can do; without it, finding them is taken as enough */
  toolReport?: () => Promise<ToolReport>
  /** whether Claude Code is signed in; null when it cannot be told, and then nothing is claimed */
  claudeSignedIn?: () => Promise<boolean | null>
  media?: MediaTools
  visionTools?: VisionTools
  engines?: EngineFactories
  transports?: TransportFactories
  /** for the whisper model's own big download; absent, the global fetch is used */
  fetch?: typeof fetch
}

export const SCRIBE_MODEL = "scribe_v2"
/** What finding objects needs of the machine: ffmpeg for the frames and a way to reach Claude, not the transcriber. */
const OBJECTS_NEEDS: ReadinessProblem[] = ["ffmpeg-missing", "ffmpeg-incomplete", "anthropic-key-missing", "claude-cli-missing", "claude-cli-login"]
/** A 1 GB download produces thousands of chunks; the UI needs a few updates a second. */
const PROGRESS_EVERY_MS = 200

export const defaultTransports: TransportFactories = {
  anthropic: (apiKey, effort) => anthropicTransport({ apiKey, effort }),
  cli: (binary, effort) => claudeCliTransport({ binary, effort }),
}

export function scribeEngine(apiKey: string, language: SpokenLanguage): AsrEngine {
  return {
    settings: { engine: "scribe", model: SCRIBE_MODEL, language },
    audioFormat: "flac",
    transcribe: (audioPath, { signal }) => transcribeWithScribe({ apiKey, audioPath, language, model: SCRIBE_MODEL, signal }),
  }
}

export function whisperEngine(binary: string, modelPath: string, model: WhisperModel, language: SpokenLanguage): AsrEngine {
  return {
    settings: { engine: "whisper-local", model: model.id, language },
    audioFormat: "wav",
    transcribe: (audioPath, { signal, onProgress }) =>
      transcribeWithWhisper({ binary, modelPath, model, audioPath, language, signal, onProgress }),
  }
}

export function createAnalysisService(deps: AnalysisDeps) {
  const { tools, model } = deps
  const engines = deps.engines ?? { scribe: scribeEngine, whisper: whisperEngine }
  const transports = deps.transports ?? defaultTransports
  const media: MediaTools = deps.media ?? {
    hasAudio: (path, signal) => hasAudioStream(tools.ffprobe!, path, signal),
    extractAudio: (input, output, format, signal) => extractAudio({ ffmpeg: tools.ffmpeg!, input, output, format, signal }),
  }
  const visionTools: VisionTools = deps.visionTools ?? {
    hasAudio: (path, signal) => hasAudioStream(tools.ffprobe!, path, signal),
    measure: (input, durationUs, hasAudio, signal, onProgress) =>
      measureSignals({ ffmpeg: tools.ffmpeg!, input, durationUs, hasAudio, signal, onProgress }),
    extractFrames: (input, timesUs, outDir, signal) => extractFrames({ ffmpeg: tools.ffmpeg!, input, timesUs, outDir, signal }),
  }

  let starting = false
  let job: (AnalysisState & { controller: AbortController }) | null = null
  // a run that only finds objects holds the same one-run lock, but is kept apart from `job`: the prepare
  // screen rebuilds its rows from the last analysis, and a run with no transcription would empty them
  let objectsRun: AbortController | null = null
  const busy = () => starting || job?.running === true || objectsRun !== null
  let download: AbortController | null = null

  async function readiness(): Promise<Readiness> {
    const { asr, llm } = await deps.settings.read()
    const problems: ReadinessProblem[] = []
    const report = await deps.toolReport?.()
    if (!tools.ffmpeg || !tools.ffprobe) problems.push("ffmpeg-missing")
    else if (report?.ffmpeg?.missing.length) problems.push("ffmpeg-incomplete")
    if (asr.engine === "whisper-local") {
      if (!tools.whisper) problems.push("whisper-missing")
      else if (report?.whisper?.usable === false) problems.push("whisper-unusable")
      if ((await modelState(deps.modelsDir, model)).status !== "ready") problems.push("model-missing")
    } else if (!(await deps.secrets.get("elevenlabs"))) {
      problems.push("scribe-key-missing")
    }
    if (llm.transport === "anthropic-api") {
      if (!(await deps.secrets.get("anthropic"))) problems.push("anthropic-key-missing")
    } else if (!tools.claude) {
      problems.push("claude-cli-missing")
    } else if ((await deps.claudeSignedIn?.()) === false) {
      // an expired or missing login fails the first Claude call of a run, after the transcribing is done
      problems.push("claude-cli-login")
    }
    return { problems }
  }

  async function transportFor(llm: AppSettings["llm"]): Promise<LlmTransport> {
    const effort = effortFor(llm.model, llm.effort)
    return llm.transport === "anthropic-api" ? transports.anthropic((await deps.secrets.get("anthropic"))!, effort) : transports.cli(tools.claude!, effort)
  }

  /** The chosen videos of a registered project; any that is not there refuses the whole request. */
  async function chosenVideos(folder: string, videoIds: string[]) {
    const project = await deps.inspect(folder)
    const byId = new Map(project.videos.map((video) => [video.id, video]))
    return videoIds.map((id) => {
      const video = byId.get(id)
      if (!video?.exists) throw new Error(`video ${id} is not in this project`)
      return video
    })
  }

  /** Finds the objects of the videos one at a time, telling the screens how each stands. */
  const findObjects = (
    folder: string,
    videos: { id: string; path: string; durationUs: number }[],
    transport: LlmTransport,
    llmModel: string,
    signal: AbortSignal,
    described?: Parameters<typeof locateVideos>[0]["described"],
  ) =>
    locateVideos({
      footage: { ...deps, whisperModelId: model.id },
      videos,
      described,
      transport,
      model: llmModel,
      extractFrames: visionTools.extractFrames,
      workDir: deps.workDir,
      signal,
      onEvent: (videoId, status) => deps.send({ type: "objects", folder, videoId, status }),
    })

  async function start(folder: string, videoIds: string[]): Promise<void> {
    if (busy()) throw new Error("an analysis is already running")
    starting = true
    // on record from the first moment, so a cancel while the machine is still being checked
    // lands on this run and not on nothing
    const controller = new AbortController()
    const current: NonNullable<typeof job> = { folder, running: true, outcome: null, error: null, transcription: {}, vision: {}, controller }
    job = current
    const cancelledMeanwhile = () => {
      if (!controller.signal.aborted) return false
      current.running = false
      current.outcome = "cancelled"
      deps.send({ type: "analysis-finished", folder, outcome: "cancelled" })
      return true
    }
    try {
      // checking the machine can take seconds (Claude Code is asked whether it is signed in)
      const ready = await readiness()
      if (ready.problems.length > 0) throw new Error(`analysis is not ready: ${ready.problems.join(", ")}`)
      if (cancelledMeanwhile()) return

      const videos = await chosenVideos(folder, videoIds)

      const { asr, llm, vision } = await deps.settings.read()
      const engine =
        asr.engine === "scribe"
          ? engines.scribe((await deps.secrets.get("elevenlabs"))!, asr.language)
          : engines.whisper(tools.whisper!, join(deps.modelsDir, model.file), model, asr.language)
      const transport = await transportFor(llm)

      if (cancelledMeanwhile()) return

      const run = async () => {
        const transcripts = await transcribeVideos({
          videos: videos.map((video) => ({ id: video.id, path: video.path })),
          engine,
          media,
          cache: deps.transcripts,
          workDir: deps.workDir,
          signal: controller.signal,
          onEvent: ({ videoId, status }) => {
            current.transcription[videoId] = status
            deps.send({ type: "transcription", folder, videoId, status })
          },
        })
        // a video whose speech could not be read is not looked at: pictures described without
        // their words would be kept in the cache, and its retakes never found
        for (const video of videos) {
          if (transcripts.has(video.id)) continue
          const status = { state: "failed" as const, error: "the speech could not be read, so the pictures were not looked at" }
          current.vision[video.id] = status
          deps.send({ type: "vision", folder, videoId: video.id, status })
        }
        // what the pictures are described with, handed on to the objects pass, which a settings change meanwhile must not mislead
        const sampling = visionSampling(vision.frameEveryS)
        const prompt = (await deps.prompts?.())?.vision ?? VISION_PROMPT
        const insights = await describeVideos({
          videos: videos.flatMap((video) => {
            const transcript = transcripts.get(video.id)
            return transcript
              ? [{ id: video.id, path: video.path, durationUs: video.durationUs, utterances: transcript.utterances, words: transcript.words }]
              : []
          }),
          transport,
          model: llm.model,
          tools: visionTools,
          cache: deps.insights,
          workDir: deps.workDir,
          ...sampling,
          prompt,
          signal: controller.signal,
          onEvent: ({ videoId, status }) => {
            current.vision[videoId] = status
            deps.send({ type: "vision", folder, videoId, status })
          },
        })
        // what was read in full, both its speech and its pictures
        const read = videoIds.filter((id) => transcripts.has(id) && insights.has(id))
        // only the project list reads this, so a disk that will not take it must not lose the run;
        // a video that failed is not analysed, and a run that read nothing leaves the project as it was.
        // It is noted before the objects pass, which a cancel may stop with every video read already
        if (read.length > 0) await deps.progress.put({ folder, analysedAt: Date.now(), videoIds: read }).catch(() => {})

        // the pictures are described, and so analysed, by now: where things are in them is found after,
        // and a pass that fails is told on its video and leaves the run done
        const insightKey = { model: llm.model, promptVersion: prompt.version, intervalUs: sampling.intervalUs, maxFrames: sampling.maxFrames }
        const described = { insightKey, sampling, insights }
        await findObjects(folder, videos.filter((video) => read.includes(video.id)), transport, llm.model, controller.signal, described).catch((error: unknown) => {
          if (controller.signal.aborted) throw error
        })
      }

      void run().then(
        () => {
          current.running = false
          current.outcome = "done"
          deps.send({ type: "analysis-finished", folder, outcome: "done" })
        },
        (error: unknown) => {
          current.running = false
          if (controller.signal.aborted) {
            current.outcome = "cancelled"
            deps.send({ type: "analysis-finished", folder, outcome: "cancelled" })
          } else {
            current.outcome = "failed"
            current.error = String(error)
            deps.send({ type: "analysis-finished", folder, outcome: "failed", error: current.error })
          }
        },
      )
    } catch (error) {
      // nothing ran, but a screen may already have seen this start as going: it is told it failed
      current.running = false
      current.outcome = "failed"
      current.error = String(error)
      deps.send({ type: "analysis-finished", folder, outcome: "failed", error: current.error })
      throw error
    } finally {
      starting = false
    }
  }

  /**
   * Finds the objects of videos analysed already, for those analysed before the objects pass existed
   * or whose pass failed. It holds the one-run lock, so an analysis cannot start meanwhile, and it ends
   * like an analysis does, with analysis-finished.
   */
  async function locateObjects(folder: string, videoIds: string[]): Promise<void> {
    if (busy()) throw new Error("an analysis is already running")
    const controller = new AbortController()
    objectsRun = controller
    let transport: LlmTransport
    let llmModel: string
    let videos: Awaited<ReturnType<typeof chosenVideos>>
    try {
      if (videoIds.length === 0) throw new Error("no video is chosen")
      videos = await chosenVideos(folder, videoIds)
      const problems = (await readiness()).problems.filter((problem) => OBJECTS_NEEDS.includes(problem))
      if (problems.length > 0) throw new Error(`analysis is not ready: ${problems.join(", ")}`)
      const { llm } = await deps.settings.read()
      transport = await transportFor(llm)
      llmModel = llm.model
    } catch (error) {
      objectsRun = null
      throw error
    }
    // the lock is let go before the end is told, so a screen told may start the next run at once
    void findObjects(folder, videos, transport, llmModel, controller.signal).then(
      () => {
        objectsRun = null
        deps.send({ type: "analysis-finished", folder, outcome: "done" })
      },
      (error: unknown) => {
        objectsRun = null
        if (controller.signal.aborted) deps.send({ type: "analysis-finished", folder, outcome: "cancelled" })
        else deps.send({ type: "analysis-finished", folder, outcome: "failed", error: String(error) })
      },
    )
  }

  return {
    readiness,
    start,
    locateObjects,

    cancel(): void {
      job?.controller.abort()
      objectsRun?.abort()
    },

    /** The project's videos whose analysis is cached already, so the user can go straight on. */
    async analysed(folder: string): Promise<string[]> {
      return analysedVideos({ ...deps, whisperModelId: model.id }, folder)
    },

    /** The project's analysed videos whose objects were never found, which the screen offers to find. */
    async withoutObjects(folder: string): Promise<string[]> {
      return videosWithoutObjects({ ...deps, whisperModelId: model.id }, folder)
    },

    /** What comparing the lines said twice will take, for the project's videos whose speech is read already. */
    async retakes(folder: string): Promise<Record<string, RetakeLoad>> {
      return knownRetakes({ ...deps, whisperModelId: model.id }, folder)
    },

    state(): AnalysisState | null {
      if (!job) return null
      return { folder: job.folder, running: job.running, outcome: job.outcome, error: job.error, transcription: job.transcription, vision: job.vision }
    },

    async modelInfo(): Promise<{ model: WhisperModel; state: ModelState; downloading: boolean }> {
      return { model, state: await modelState(deps.modelsDir, model), downloading: download !== null }
    },

    claudeCliFound(): boolean {
      return tools.claude !== null
    },

    async downloadModel(): Promise<void> {
      if (download) throw new Error("the model is already downloading")
      const controller = new AbortController()
      download = controller
      let lastSent = 0
      void downloadModel(deps.modelsDir, model, {
        signal: controller.signal,
        fetch: deps.fetch,
        onProgress: (received, total) => {
          const now = Date.now()
          if (received === total || now - lastSent >= PROGRESS_EVERY_MS) {
            lastSent = now
            deps.send({ type: "model-download", state: "progress", received, total })
          }
        },
      }).then(
        () => {
          download = null
          deps.send({ type: "model-download", state: "done" })
        },
        (error: unknown) => {
          download = null
          if (controller.signal.aborted) deps.send({ type: "model-download", state: "cancelled" })
          else deps.send({ type: "model-download", state: "failed", error: String(error) })
        },
      )
    },

    cancelModelDownload(): void {
      download?.abort()
    },
  }
}

export type AnalysisService = ReturnType<typeof createAnalysisService>
