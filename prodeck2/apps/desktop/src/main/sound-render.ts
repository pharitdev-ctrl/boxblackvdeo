import { createHash } from "node:crypto"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { clipText, type MotionWord } from "@boxblack/core/graphics/plan"
import { SOUND_HARNESS, soundProblems, type RenderStats } from "@boxblack/core/sound/harness"
import { lintCompose } from "@boxblack/core/sound/lint"
import { LOUDNESS_LUFS, SOUND_VERSION, type SoundLoudness } from "@boxblack/core/sound/spec"
import { EnvironmentError } from "./environment-error.ts"
import { setLoudness, type RunTool } from "./sound-loudness.ts"
import { ProcessError } from "@boxblack/core/media"
import type { SealedPage } from "./sound-window.ts"

/*
 * The render of composed sounds (spec §6.2, §7): each sound's code is run in the sealed page with the harness, what
 * it rendered is checked, and one that passes is set to its loudness with the app's ffmpeg and kept as
 * `<dir>/<hash>.wav`, named by what it is made from, so that a sound is never rendered twice and any change to it is
 * a new file. The writing asks for the check of what Claude wrote; the preview and the write ask for the files of
 * what is stored. Renders run one at a time, in the order asked, whoever asks.
 */

/** Everything a sound's file is made from. A stored sound is one: what else it holds is not heard, so makes no other file. */
export interface SoundJob {
  code: string
  /** its length with its tail, in seconds */
  seconds: number
  /** the words said in it, in seconds from its start */
  words: MotionWord[]
  loudness: SoundLoudness
}

export interface SoundRenderDeps {
  /** where the levelled WAVs land: ~/Movies/CapCut/BOXBLACK/sounds */
  dir: string
  /** the app's ffmpeg, which sets each sound's loudness */
  ffmpeg: () => string | null
  /** the sealed page the code runs in */
  page: SealedPage
  /** the file system, for the tests to fake; Node's own by default. A folder is made with what it needs, and a file removed is no error when it is not there */
  writeFile?: (path: string, data: Uint8Array) => Promise<void>
  rename?: (from: string, to: string) => Promise<void>
  exists?: (path: string) => Promise<boolean>
  mkdir?: (path: string) => Promise<void>
  remove?: (path: string) => Promise<void>
  /** runs ffmpeg; runProcess by default */
  run?: RunTool
  /** told, by its hash, of each render that ended: made, failed, or finding the machine unfit; not of one cancelled or never begun */
  onSettled?: (hash: string) => void
}

/** What a sound is, as the preview and the write ask: its file is there, its render failed, or it is still to be made. */
export type SoundStatus = "ready" | "failed" | "pending"

/** How long the page may take over one sound before it counts as failed (spec §6.2). */
const RENDER_TIMEOUT_MS = 20_000
/** The rate and the bytes of a stereo 16-bit frame the harness writes, and the length of its WAV header. */
const RATE = 48_000
const FRAME_BYTES = 4
const HEADER_BYTES = 44
/** Frames in the first and the last 5 ms of a sound, where a click would be heard: what the harness measures. */
const EDGE_FRAMES = Math.round(0.005 * RATE)
/** Over this, a peak before levelling is a gain run away (soundProblems); only the page can see it, before its samples are clamped. */
const RUNAWAY_PEAK = 4
/** Full scale as the harness writes a sample (sample × 32767). */
const FULL_SCALE = 32_767
/** The most characters kept of what the code threw. */
const MESSAGE_MAX = 300
/** What a page that gave back anything but a sound or an error is answered with. */
const NO_SOUND = "the render gave back no sound the app can read"

/**
 * What follows the call of renderSound in the page. Electron gives back nothing of what a script threw, only that it
 * threw ("Script failed to execute"), so the error is turned into a value the page answers with, which the repair
 * can then name.
 */
const ERROR_AS_VALUE = ".catch((error) => ({ error: String(error) }))"

/**
 * The name of a sound's file: the sha256 of what is heard (its code, its length, the times of its words, its loudness)
 * with the contract in force now, the first 16 hex digits. What it is for, the level it plays from and the text of its
 * words are not heard, so they make no other file.
 */
export function hashOf(job: SoundJob): string {
  const parts = [job.code, job.seconds, job.words.map((word) => word.atS), job.loudness, SOUND_VERSION]
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)
}

/** Why a file could not be written or moved, short enough to show: its error code, since its message carries the path. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.message) : String(error)
}

/** A render asked for before a cancel: neither a file nor a failure comes of it. */
class Cancelled extends Error {}

/** What a levelling that failed on a sound's own file is answered with. */
const NOT_LEVELLED = "the app's ffmpeg could not set the sound's loudness"

/** A plain error's message alone; anything else as it reads. */
const failureText = (error: unknown): string => (error instanceof Error && error.name === "Error" && error.message !== "" ? error.message : String(error))

/**
 * What the harness measures of a render, measured here from its samples, so that what the page says of them can
 * never pass a sound (see measuresOf): the loudest sample, the RMS of both channels, the length, and the loudest sample of the first and of the
 * last 5 ms. As the harness writes them, a sample is 16 bits of full scale 32767.
 */
export function statsOf(pcm: Buffer): RenderStats {
  const frames = pcm.length / FRAME_BYTES
  const edge = Math.min(frames, EDGE_FRAMES)
  let peak = 0
  let sum = 0
  let headPeak = 0
  let tailPeak = 0
  for (let frame = 0; frame < frames; frame++) {
    const left = pcm.readInt16LE(frame * FRAME_BYTES) / FULL_SCALE
    const right = pcm.readInt16LE(frame * FRAME_BYTES + 2) / FULL_SCALE
    const loudest = Math.max(Math.abs(left), Math.abs(right))
    if (loudest > peak) peak = loudest
    sum += (left * left + right * right) / 2
    if (frame < edge && loudest > headPeak) headPeak = loudest
    if (frame >= frames - edge && loudest > tailPeak) tailPeak = loudest
  }
  return { peak, rms: Math.sqrt(sum / frames), seconds: frames / RATE, headPeak, tailPeak }
}

/** A WAV header of the app's own for `bytes` of 16-bit stereo 48 kHz PCM: the one the harness writes. */
function headerFor(bytes: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  header.write("RIFF", 0, "latin1")
  header.writeUInt32LE(36 + bytes, 4)
  header.write("WAVEfmt ", 8, "latin1")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * FRAME_BYTES, 28)
  header.writeUInt16LE(FRAME_BYTES, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36, "latin1")
  header.writeUInt32LE(bytes, 40)
  return header
}

/**
 * What the page answered, as the sound's samples or the problem with it. The code runs in the page and can change
 * what the page's own functions do, so nothing of the answer is believed but what can be checked: what the code
 * threw, said as it said it; or a WAV of the harness's length, its 44 bytes of header and whole frames, at least one
 * and no more than the sound's length allows. A text too long to be that is refused before it is decoded. Only the
 * samples are kept: the header is the page's, and is never handed on, and the measures are taken here.
 */
function samplesOf(answer: unknown, seconds: number): { pcm: Buffer; said: unknown } | { problem: string } {
  if (typeof answer !== "object" || answer === null) return { problem: NO_SOUND }
  const { error, wav, stats: said } = answer as Record<string, unknown>
  if (typeof error === "string") return { problem: `the code failed: ${clipText(error, MESSAGE_MAX)}` }
  if (typeof wav !== "string") return { problem: NO_SOUND }
  const longest = HEADER_BYTES + Math.ceil(seconds * RATE) * FRAME_BYTES
  // base64 is four characters for every three bytes
  if (wav.length > Math.ceil(longest / 3) * 4) return { problem: NO_SOUND }
  const bytes = Buffer.from(wav, "base64")
  const whole = bytes.length > HEADER_BYTES && (bytes.length - HEADER_BYTES) % FRAME_BYTES === 0 && bytes.length <= longest
  const isWave = bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WAVE"
  return whole && isWave ? { pcm: bytes.subarray(HEADER_BYTES), said } : { problem: NO_SOUND }
}

/**
 * The measures the checks are given: the app's own, from the samples, with what the page said it measured only where
 * that can fail a sound. The page measures before its samples are clamped to full scale and rounded to 16 bits, so a
 * gain run away (a peak over 4) shows only in what it says, and a click it heard is counted at the larger of the two.
 * What it says can never pass a sound the samples fail; a measure that is not a finite number is left out.
 */
function measuresOf(pcm: Buffer, said: unknown): RenderStats {
  const own = statsOf(pcm)
  const given = typeof said === "object" && said !== null ? (said as Record<string, unknown>) : {}
  const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)
  const peak = finite(given.peak)
  return {
    ...own,
    peak: peak !== null && peak > RUNAWAY_PEAK ? peak : own.peak,
    headPeak: Math.max(own.headPeak, finite(given.headPeak) ?? 0),
    tailPeak: Math.max(own.tailPeak, finite(given.tailPeak) ?? 0),
  }
}

/**
 * Renders composed sounds one at a time and keeps each that passes its checks by the hash of its job. A sound that
 * fails a check keeps its failure until `forgetFailures()`. A fault of the machine (no ffmpeg or one that cannot
 * start, lacks a filter or hangs, a page that cannot start, a folder or a disk that cannot be written, the app quitting) is no sound's failure: it holds
 * every sound, as it does graphics, until `forgetMachine()` or `forgetFailures()`. Nothing is deleted here but the
 * render's own temporary files (a CapCut draft may point at a sound's file).
 */
export function createSoundRenderer(deps: SoundRenderDeps) {
  const write = deps.writeFile ?? ((path, data) => writeFile(path, data))
  const move = deps.rename ?? rename
  const exists = deps.exists ?? ((path) => stat(path).then((found) => found.isFile(), () => false))
  const makeDir = deps.mkdir ?? (async (path) => void (await mkdir(path, { recursive: true })))
  const remove = deps.remove ?? ((path) => rm(path, { force: true }))

  /** each sound's failure, by its hash, one problem a line */
  const failures = new Map<string, string>()
  /** why nothing can render on this machine, as the last render found; no sound's failure */
  let environment: string | null = null
  /** the renders asked for and not yet over, waiting or under way */
  let asked = 0
  /** the renders waiting their turn: a check, which a writing waits on, before what ensure asked for */
  const checks: (() => Promise<void>)[] = []
  const files: (() => Promise<void>)[] = []
  /** a render is under way */
  let busy = false
  /** moved on by `cancel()`: a render asked for before then does not start, and one under way is not kept */
  let generation = 0

  const fileOf = (hash: string) => join(deps.dir, `${hash}.wav`)

  /** Starts the next render waiting, if none is under way. */
  function next(): void {
    if (busy) return
    const work = checks.shift() ?? files.shift()
    if (!work) return
    busy = true
    void work().finally(() => {
      busy = false
      next()
    })
  }

  /** Runs `work` in its turn, one render at a time: a check ahead of every file ensure asked for, each in the order asked. */
  function inTurn<T>(work: (asked: number) => Promise<T>, check: boolean): Promise<T> {
    asked++
    const asking = generation
    return new Promise<T>((resolve, reject) => {
      ;(check ? checks : files).push(() => work(asking).then(resolve, reject))
      next()
    }).finally(() => asked--)
  }

  /**
   * Sets the raw render to its loudness and puts it in place: written to `<hash>.raw.wav` (over one a render before
   * left), levelled into `<hash>.wav.tmp`, and renamed to `<hash>.wav`, which only the rename makes. The temporary
   * files go afterwards, whatever happened. The raw file is the page's samples under the app's own header, so ffmpeg
   * is never handed what the page wrote of it. An ffmpeg that runs and fails on it fails this sound; one that cannot
   * start, runs out of time, lacks a filter or finds the disk full, or a folder that cannot be written, is the
   * machine's fault.
   */
  async function keep(pcm: Buffer, hash: string, loudness: SoundLoudness, ffmpeg: string): Promise<string[]> {
    const raw = join(deps.dir, `${hash}.raw.wav`)
    const levelled = join(deps.dir, `${hash}.wav.tmp`)
    try {
      try {
        await makeDir(deps.dir)
        await write(raw, Buffer.concat([headerFor(pcm.length), pcm]))
      } catch (error) {
        throw new EnvironmentError(`the rendered sound could not be kept (${reasonOf(error)})`)
      }
      try {
        await setLoudness(ffmpeg, raw, levelled, LOUDNESS_LUFS[loudness], deps.run)
      } catch (error) {
        // an ffmpeg that could not start, ran out of time, lacks a filter or found the disk full is the machine's; one that
        // ran and failed on this file in any other way is this sound's
        if (error instanceof ProcessError) {
          if (/No such filter/.test(error.stderr)) throw new EnvironmentError("the app's ffmpeg lacks a filter it needs to set a sound's loudness")
          if (/No space left|ENOSPC/.test(error.stderr)) throw new EnvironmentError("the rendered sound could not be kept (ENOSPC)")
          return [NOT_LEVELLED]
        }
        if (error instanceof Error && error.name === "TimeoutError") throw new EnvironmentError("the app's ffmpeg took too long to set a sound's loudness")
        if (typeof (error as NodeJS.ErrnoException).code === "string") throw new EnvironmentError("the app's ffmpeg could not start")
        return [NOT_LEVELLED]
      }
      try {
        await move(levelled, fileOf(hash))
      } catch (error) {
        throw new EnvironmentError(`the rendered sound could not be kept (${reasonOf(error)})`)
      }
      return []
    } finally {
      // as well as it can: a file that cannot be removed must not replace what was thrown, nor fail a sound that was made
      await remove(raw).catch(() => {})
      await remove(levelled).catch(() => {})
    }
  }

  /**
   * Makes a sound's file, unless it is made already, and says what is wrong with it: none when it is made; the
   * linter's problems, what the page said went wrong, what the checks found of the samples, or a levelling that
   * failed, in plain English for the repair. A fault of the machine throws an EnvironmentError, and a render asked
   * for before a cancel throws Cancelled once the page has answered, before anything is kept.
   */
  async function make(job: SoundJob, hash: string, asking: number): Promise<string[]> {
    if (await exists(fileOf(hash))) return []
    // nothing the linter refuses reaches the page, whatever checked it when it was written
    const refused = lintCompose(job.code)
    if (refused.length > 0) return refused
    const ffmpeg = deps.ffmpeg()
    if (!ffmpeg) throw new EnvironmentError("the app's ffmpeg is missing")
    // the seed is the hash's, so the same sound renders the same every time
    const seed = parseInt(hash.slice(0, 8), 16)
    const script = `${SOUND_HARNESS}\nrenderSound(${JSON.stringify(job.code)}, ${JSON.stringify({ length: job.seconds, words: job.words })}, ${seed})${ERROR_AS_VALUE}`
    let answer: unknown
    try {
      answer = await deps.page.run(script, RENDER_TIMEOUT_MS)
    } catch (error) {
      if (asking !== generation) throw new Cancelled()
      if (error instanceof EnvironmentError) throw error
      // the page ran out of time, or lost the script: its words say which
      return [failureText(error)]
    }
    if (asking !== generation) throw new Cancelled()
    const rendered = samplesOf(answer, job.seconds)
    if ("problem" in rendered) return [rendered.problem]
    const problems = soundProblems(measuresOf(rendered.pcm, rendered.said), job.seconds)
    if (problems.length > 0) return problems
    return keep(rendered.pcm, hash, job.loudness, ffmpeg)
  }

  /**
   * A sound's render in its turn: its problems, kept as its failure when there are any; or null when the machine
   * cannot render, which is then kept as the machine's, and when the render was cancelled, which is kept as nothing.
   * Anything else that goes wrong is the sound's failure.
   */
  async function attempt(job: SoundJob, hash: string, asking: number): Promise<string[] | null> {
    if (asking !== generation || environment !== null) return null
    let problems: string[]
    try {
      problems = await make(job, hash, asking)
    } catch (error) {
      if (error instanceof Cancelled) return null
      if (error instanceof EnvironmentError) {
        environment = error.message
        deps.onSettled?.(hash)
        return null
      }
      problems = [failureText(error)]
    }
    if (problems.length > 0) failures.set(hash, problems.join("\n"))
    deps.onSettled?.(hash)
    return problems
  }

  function forgetMachine(): void {
    environment = null
  }

  return {
    hashOf,
    /**
     * Renders a sound's code as it will be kept and says what is wrong with it, for the writing's one repair: none
     * when it is made, the file then kept; its problems when it fails; null when this machine cannot render now, and
     * the code the linter passed is then taken as it is, as a graphic's is.
     */
    check(job: SoundJob): Promise<string[] | null> {
      const hash = hashOf(job)
      return inTurn((asking) => attempt(job, hash, asking), true)
    },
    /**
     * Renders, one at a time and in the background, the files of the sounds not made yet; a sound that failed is left
     * alone until its failure is forgotten, and so is every sound on a machine found unfit. What it answers settles,
     * and never rejects, once each of them is made, has failed or waits for the machine.
     */
    async ensure(jobs: SoundJob[]): Promise<void> {
      // the same sound asked for twice is one job
      const unique = new Map(jobs.map((job) => [hashOf(job), job]))
      await Promise.all(
        [...unique].map(([hash, job]) =>
          inTurn(async (asking) => {
            if (!failures.has(hash)) await attempt(job, hash, asking)
          }, false).catch(() => {}),
        ),
      )
    },
    /** Its file is there; its render failed, with the reason `failureOf` gives; or it is still to be made. */
    async statusOf(job: SoundJob): Promise<SoundStatus> {
      const hash = hashOf(job)
      if (await exists(fileOf(hash))) return "ready"
      return failures.has(hash) ? "failed" : "pending"
    },
    /** Why a sound's render failed, one problem a line; null when it has not. */
    failureOf: (job: SoundJob): string | null => failures.get(hashOf(job)) ?? null,
    /** Where a sound's file is, or will be once it is made. */
    fileOf: (job: SoundJob): string => fileOf(hashOf(job)),
    /** Nothing is being rendered, nor waiting to be: no sound's file is in the making. */
    idle: (): boolean => asked === 0,
    /** No render found the machine unfit since it was last forgotten. */
    machineReady: (): boolean => environment === null,
    /** Why the last render found the machine unfit, in plain English, as a write says it; null while none has. */
    environmentProblem: (): string | null => environment,
    /** Forgets what a render found wrong with the machine, so the sounds held by it render when next asked; each sound's own failure stays. */
    forgetMachine,
    /** Forgets every failure, each sound's and the machine's, once something that may have put them right has happened (the tools looked for again). */
    forgetFailures(): void {
      failures.clear()
      forgetMachine()
    },
    /**
     * Stops the renders (the app is quitting): what is waiting does not start, and what the render under way comes to
     * is kept as nothing, neither a file nor that sound's failure. The app closes the page after this, which ends that
     * render. What is asked for afterwards is rendered as usual.
     */
    cancel(): void {
      generation++
    },
  }
}

export type SoundRenderer = ReturnType<typeof createSoundRenderer>
