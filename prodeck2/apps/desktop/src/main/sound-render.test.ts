import { createHash } from "node:crypto"
import { expect, test } from "vitest"
import { SOUND_HARNESS, soundProblems, type RenderStats } from "@boxblack/core/sound/harness"
import { lintCompose } from "@boxblack/core/sound/lint"
import { SOUND_VERSION } from "@boxblack/core/sound/spec"
import { ProcessError } from "@boxblack/core/media"
import { EnvironmentError } from "./environment-error.ts"
import { createSoundRenderer, hashOf, type SoundJob } from "./sound-render.ts"
import type { SealedPage } from "./sound-window.ts"

/*
 * The sound renderer against a fake page, a fake ffmpeg and a fake folder: nothing here renders audio, runs ffmpeg or
 * writes a file.
 */

/** A small sound the linter passes: one plucked note on the first word. */
const PLUCK = `function compose(ctx, cue, kit) {
  const t = cue.words.length > 0 ? cue.words[0].atS : 0
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.frequency.value = kit.note("C5")
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  o.connect(g); g.connect(ctx.destination)
  o.start(t); o.stop(t + 0.35)
}`
const job = (over: Partial<SoundJob> = {}): SoundJob => ({ code: PLUCK, seconds: 1.5, words: [{ text: "สาม", atS: 0.1 }, { text: "สอง", atS: 0.9 }], loudness: "normal", ...over })
/** What a page says it measured of a clean render; the app measures for itself, so what a page says is never used. */
const CLEAN: RenderStats = { peak: 0.6, rms: 0.08, seconds: 0.6, headPeak: 0.004, tailPeak: 0.0002 }
/** Frames in 5 ms at 48 kHz, where a click is listened for. */
const EDGE = 240

/** A clean sound's sample: silent in its first and last 5 ms, at about 0.6 of full scale between. */
const cleanSample = (frame: number, frames: number) => (frame < EDGE || frame >= frames - EDGE ? 0 : 20_000)

/** A WAV as the harness writes it, of `frames` stereo 16-bit frames at 48 kHz, each sample what `sample` gives for its frame. */
function wav(frames: number, sample: (frame: number, frames: number) => number = cleanSample): Buffer {
  const bytes = Buffer.alloc(44 + frames * 4)
  bytes.write("RIFF", 0, "latin1")
  bytes.writeUInt32LE(36 + frames * 4, 4)
  bytes.write("WAVEfmt ", 8, "latin1")
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(2, 22)
  bytes.writeUInt32LE(48_000, 24)
  bytes.writeUInt32LE(192_000, 28)
  bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36, "latin1")
  bytes.writeUInt32LE(frames * 4, 40)
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(sample(frame, frames), 44 + frame * 4)
    bytes.writeInt16LE(sample(frame, frames), 46 + frame * 4)
  }
  return bytes
}
const RAW = wav(28_800)
/** What the page answers for a clean render. */
const RENDERED = { wav: RAW.toString("base64"), stats: CLEAN }

/** What the app's ffmpeg prints of a file's loudness, as the real one does (see sound-loudness.test.ts). */
const measured = (lufs: string, peak: string) => `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         ${lufs} LUFS
    Threshold: -37.0 LUFS

  True peak:
    Peak:       ${peak} dBFS
`

const DIR = "/Movies/sounds"

/**
 * A renderer over fakes. The folder is a map of paths to bytes. The page answers each run from `answers` in turn, or
 * the clean render when none is left, and notes the script and the time it was given; `hold` makes the runs wait until
 * the test lets each go, to see how many run at once. ffmpeg measures as `loudness` says and "levels" a file by copying
 * it, noting each call; `ffmpegFails` makes the levelling fail. `log` is everything done, in order.
 */
function setup(over: { ffmpeg?: string | null; hold?: boolean; onSettled?: (hash: string) => void } = {}) {
  const files = new Map<string, Buffer>()
  const log: string[] = []
  const runs: { js: string; timeoutMs: number }[] = []
  const answers: (() => Promise<unknown>)[] = []
  const held: (() => void)[] = []
  let running = 0
  let mostAtOnce = 0
  const control = { loudness: measured("-23.7", "-7.5"), ffmpegFails: false, ffmpegMissing: false, ffmpegSaid: null as string | null, ffmpegTimesOut: false, writeFails: false, renameFails: false, hold: over.hold ?? false }
  const short = (path: string) => path.replace(`${DIR}/`, "")
  const page: SealedPage = {
    run: async (js, timeoutMs) => {
      runs.push({ js, timeoutMs })
      log.push("render")
      running++
      mostAtOnce = Math.max(mostAtOnce, running)
      try {
        if (control.hold) await new Promise<void>((resolve) => held.push(resolve))
        const next = answers.shift()
        return next ? await next() : RENDERED
      } finally {
        running--
      }
    },
    close: () => {},
  }
  const renderer = createSoundRenderer({
    dir: DIR,
    ffmpeg: () => (over.ffmpeg === undefined ? "/app/ffmpeg" : over.ffmpeg),
    page,
    ...(over.onSettled ? { onSettled: over.onSettled } : {}),
    writeFile: async (path, data) => {
      log.push(`write ${short(path)}`)
      if (control.writeFails) throw Object.assign(new Error(`ENOSPC: no space left on device, write '${path}'`), { code: "ENOSPC" })
      files.set(path, Buffer.from(data))
    },
    rename: async (from, to) => {
      log.push(`rename ${short(from)} ${short(to)}`)
      if (control.renameFails) throw Object.assign(new Error(`EACCES: permission denied, rename '${from}'`), { code: "EACCES" })
      const data = files.get(from)
      if (!data) throw Object.assign(new Error(`ENOENT: no such file, rename '${from}'`), { code: "ENOENT" })
      files.delete(from)
      files.set(to, data)
    },
    exists: async (path) => files.has(path),
    mkdir: async (path) => {
      log.push(`mkdir ${path}`)
    },
    remove: async (path) => {
      if (files.has(path)) log.push(`remove ${short(path)}`)
      files.delete(path)
    },
    run: async (command, args) => {
      if (command !== "/app/ffmpeg") throw new Error(`unexpected ${command}`)
      // as spawn fails when the program is not there
      if (control.ffmpegMissing) throw Object.assign(new Error("spawn /app/ffmpeg ENOENT"), { code: "ENOENT" })
      if (args.includes("null")) {
        log.push(`measure ${short(args[args.indexOf("-i") + 1]!)}`)
        return { stdout: "", stderr: control.loudness }
      }
      const input = args[args.indexOf("-i") + 1]!
      const output = args.at(-1)!
      log.push(`level ${short(input)} ${short(output)} ${args[args.indexOf("-af") + 1]}`)
      if (control.ffmpegFails) throw new Error("ffmpeg exited with code 1")
      // as runProcess rejects for a non-zero exit, with what ffmpeg printed
      if (control.ffmpegSaid !== null) throw new ProcessError(command, 1, "", control.ffmpegSaid)
      // as runProcess rejects when its signal's time runs out
      if (control.ffmpegTimesOut) throw new DOMException("The operation was aborted due to timeout", "TimeoutError")
      files.set(output, Buffer.from(files.get(input)!))
      return { stdout: "", stderr: "" }
    },
  })
  /** Lets the held runs go, one after another as each starts, until `until` has settled. */
  async function drain(until: Promise<unknown>): Promise<void> {
    let over = false
    void until.finally(() => (over = true)).catch(() => {})
    while (!over) {
      held.shift()?.()
      await settle()
    }
  }
  return { renderer, files, log, runs, answers, control, mostAtOnce: () => mostAtOnce, drain }
}

/** Lets every promise that can settle settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// the name of a sound's file

test("a sound's file is named by the sha256 of its code, its length, its word times, its loudness and the contract, the first 16 hex digits", () => {
  const sound = job()
  const expected = createHash("sha256").update(JSON.stringify([PLUCK, 1.5, [0.1, 0.9], "normal", SOUND_VERSION])).digest("hex").slice(0, 16)
  expect(hashOf(sound)).toBe(expected)
  expect(hashOf(sound)).toMatch(/^[0-9a-f]{16}$/)
  expect(setup().renderer.fileOf(sound)).toBe(`${DIR}/${expected}.wav`)
})

test("what a sound is for, the level it plays from and the words' text make no other file; its code, length, word times and loudness do", () => {
  const base = hashOf(job())
  const stored = { ...job(), role: "เสียงนับถอยหลัง", from: "heavy", pointId: "p1", off: true } as SoundJob
  expect(hashOf(stored)).toBe(base)
  expect(hashOf({ ...job(), role: "อีกอย่าง", from: "light" } as SoundJob)).toBe(base)
  expect(hashOf(job({ words: [{ text: "หนึ่ง", atS: 0.1 }, { text: "ศูนย์", atS: 0.9 }] }))).toBe(base)
  expect(hashOf(job({ code: PLUCK.replace("C5", "D5") }))).not.toBe(base)
  expect(hashOf(job({ seconds: 1.6 }))).not.toBe(base)
  expect(hashOf(job({ words: [{ text: "สาม", atS: 0.1 }, { text: "สอง", atS: 0.95 }] }))).not.toBe(base)
  expect(hashOf(job({ loudness: "strong" }))).not.toBe(base)
})

// the check the writing asks for

test("a clean sound is rendered in the page with the harness, its cue and its seed, within 20 s", async () => {
  const { renderer, runs } = setup()
  const sound = job()
  const hash = hashOf(sound)
  expect(await renderer.check(sound)).toEqual([])
  expect(runs).toHaveLength(1)
  expect(runs[0]!.timeoutMs).toBe(20_000)
  const seed = parseInt(hash.slice(0, 8), 16)
  const call = `${SOUND_HARNESS}\nrenderSound(${JSON.stringify(PLUCK)}, ${JSON.stringify({ length: 1.5, words: sound.words })}, ${seed})`
  expect(runs[0]!.js.startsWith(call)).toBe(true)
})

test("what the code throws in the page comes back as what it said, since Electron would give back only that a script failed", async () => {
  const { renderer, runs } = setup()
  await renderer.check(job())
  // the script after the harness, run here against a renderSound that fails as a broken sound's does
  const call = runs[0]!.js.slice(SOUND_HARNESS.length + 1)
  const run = (renderSound: () => Promise<unknown>) => new Function("renderSound", `return ${call}`)(renderSound) as Promise<unknown>
  expect(await run(async () => Promise.reject(new TypeError("kit.notee is not a function")))).toEqual({ error: "TypeError: kit.notee is not a function" })
  expect(await run(async () => Promise.reject("a bare string"))).toEqual({ error: "a bare string" })
  expect(await run(async () => RENDERED)).toEqual(RENDERED)
})

test("a clean sound is written as the raw render, set to its loudness into <hash>.wav.tmp and renamed into place; the raw file goes", async () => {
  const { renderer, files, log } = setup()
  const sound = job()
  const hash = hashOf(sound)
  expect(await renderer.check(sound)).toEqual([])
  expect(log).toEqual([
    "render",
    `mkdir ${DIR}`,
    `write ${hash}.raw.wav`,
    `measure ${hash}.raw.wav`,
    `level ${hash}.raw.wav ${hash}.wav.tmp volume=-2.30dB`,
    `rename ${hash}.wav.tmp ${hash}.wav`,
    `remove ${hash}.raw.wav`,
  ])
  expect([...files.keys()]).toEqual([`${DIR}/${hash}.wav`])
  expect(files.get(`${DIR}/${hash}.wav`)).toEqual(RAW)
  expect(await renderer.statusOf(sound)).toBe("ready")
  expect(renderer.failureOf(sound)).toBeNull()
})

test("each loudness is set to its own target", async () => {
  const { renderer, log } = setup()
  await renderer.check(job({ loudness: "soft" }))
  await renderer.check(job({ loudness: "strong" }))
  expect(log.filter((line) => line.startsWith("level")).map((line) => line.split(" ").at(-1))).toEqual(["volume=-6.30dB", "volume=1.70dB"])
})

test("a raw file a render before left behind is written over", async () => {
  const { renderer, files } = setup()
  const sound = job()
  const hash = hashOf(sound)
  files.set(`${DIR}/${hash}.raw.wav`, Buffer.from("left behind"))
  files.set(`${DIR}/${hash}.wav.tmp`, Buffer.from("left behind too"))
  expect(await renderer.check(sound)).toEqual([])
  expect([...files.keys()]).toEqual([`${DIR}/${hash}.wav`])
  expect(files.get(`${DIR}/${hash}.wav`)).toEqual(RAW)
})

test("a sound already made is not rendered again", async () => {
  const { renderer, files, log } = setup()
  files.set(renderer.fileOf(job()), RAW)
  expect(await renderer.check(job())).toEqual([])
  expect(log).toEqual([])
})

test("code the linter refuses is never run, and its problems are the answer", async () => {
  const { renderer, runs, files } = setup()
  const code = PLUCK.replace("const t =", "fetch('https://x'); const t =")
  expect(await renderer.check(job({ code }))).toEqual(lintCompose(code))
  expect(lintCompose(code).length).toBeGreaterThan(0)
  expect(runs).toEqual([])
  expect(files.size).toBe(0)
  expect(await renderer.statusOf(job({ code }))).toBe("failed")
})

test("each problem of a render fails the sound, measured by the app from the samples, and nothing is kept of it", async () => {
  const loud = (frame: number, frames: number) => cleanSample(frame, frames) || 0
  const cases: [string, Buffer][] = [
    ["silent", wav(28_800, () => 100)],
    ["a click at the start", wav(28_800, (frame, frames) => (frame === 3 ? 9_000 : loud(frame, frames)))],
    ["a click at the end", wav(28_800, (frame, frames) => (frame === frames - 2 ? -9_000 : loud(frame, frames)))],
    ["silent with clicks at both ends", wav(28_800, (frame, frames) => (frame === 0 || frame === frames - 1 ? 9_000 : 0))],
  ]
  for (const [what, sound] of cases) {
    const { renderer, answers, files, log } = setup()
    // what the page says of it is not believed
    answers.push(async () => ({ wav: sound.toString("base64"), stats: CLEAN }))
    const problems = (await renderer.check(job()))!
    expect(problems.length, what).toBeGreaterThan(0)
    expect(files.size, what).toBe(0)
    expect(log, what).toEqual(["render"])
    expect(await renderer.statusOf(job()), what).toBe("failed")
    expect(renderer.failureOf(job()), what).toBe(problems.join("\n"))
  }
})

test("the measures the checks are given are the app's own, taken from the samples as the harness takes them", async () => {
  const { renderer, answers } = setup()
  const frames = 28_800
  // a click of 0.2 in the first 5 ms, one of 0.1 in the last, silence after 0.3 at full scale's 0.5
  const sound = wav(frames, (frame) => (frame === 10 ? 6_553 : frame === frames - 5 ? -3_277 : frame >= 1_000 && frame < 2_000 ? 16_384 : 0))
  answers.push(async () => ({ wav: sound.toString("base64"), stats: { peak: 1, rms: 1, seconds: 1, headPeak: 0, tailPeak: 0 } }))
  const problems = await renderer.check(job())
  const peakOf = (value: number) => value / 32_767
  const rms = Math.sqrt(((6_553 / 32_767) ** 2 + (3_277 / 32_767) ** 2 + 1_000 * (16_384 / 32_767) ** 2) / frames)
  expect(problems).toEqual(soundProblems({ peak: peakOf(16_384), rms, seconds: frames / 48_000, headPeak: peakOf(6_553), tailPeak: peakOf(3_277) }, 1.5))
  expect(problems).toEqual(["the sound starts with a click: the first 5 ms reach 0.2", "the sound ends with a click: the last 5 ms reach 0.1"])
})

test("what the page says it measured can fail a sound but never pass one: a lower peak or a silence it reports is not believed", async () => {
  const { renderer, answers } = setup()
  answers.push(async () => ({ wav: RAW.toString("base64"), stats: { peak: 0, rms: 0, seconds: 99, headPeak: 0, tailPeak: 0 } }))
  expect(await renderer.check(job())).toEqual([])
  expect(renderer.machineReady()).toBe(true)
  // clicks in the samples fail it whatever the page says of its edges
  const clicky = setup()
  clicky.answers.push(async () => ({ wav: wav(28_800, (frame) => (frame === 3 ? 9_000 : 0)).toString("base64"), stats: { ...CLEAN, peak: 0.6 } }))
  expect(await clicky.renderer.check(job())).toContain("the sound starts with a click: the first 5 ms reach 0.275")
})

test("a page that reports a gain run away fails the sound, though its samples, clamped to full scale, look clean", async () => {
  const { renderer, answers, files } = setup()
  answers.push(async () => ({ wav: RAW.toString("base64"), stats: { ...CLEAN, peak: 9 } }))
  expect(await renderer.check(job())).toEqual(["the sound is far too loud before levelling (peak 9): a gain has run away"])
  expect(files.size).toBe(0)
  expect(renderer.machineReady()).toBe(true)
})

test("a click the page measured, before its samples were clamped or rounded, fails the sound at the larger of the two", async () => {
  const { renderer, answers } = setup()
  answers.push(async () => ({ wav: RAW.toString("base64"), stats: { ...CLEAN, headPeak: 0.3, tailPeak: 0.4 } }))
  expect(await renderer.check(job())).toEqual(["the sound starts with a click: the first 5 ms reach 0.3", "the sound ends with a click: the last 5 ms reach 0.4"])
})

test("measures the page gives that are not finite numbers are left out", async () => {
  for (const stats of [{ peak: Number.NaN, headPeak: "9", tailPeak: Number.POSITIVE_INFINITY }, { peak: "9" }, null, "x"]) {
    const { renderer, answers } = setup()
    answers.push(async () => ({ wav: RAW.toString("base64"), stats }))
    expect(await renderer.check(job()), JSON.stringify(stats)).toEqual([])
  }
})

test("ffmpeg is never given the page's header: the raw file is the page's samples under a header the app writes", async () => {
  const { renderer, answers, files, log } = setup()
  const sound = Buffer.from(RAW)
  // a header a page could have changed: another chunk's name, another format, another rate
  sound.write("LIST", 12, "latin1")
  sound.writeUInt16LE(3, 20)
  sound.writeUInt32LE(8_000, 24)
  answers.push(async () => ({ wav: sound.toString("base64") }))
  const hash = hashOf(job())
  expect(await renderer.check(job())).toEqual([])
  expect(log).toContain(`write ${hash}.raw.wav`)
  // the fake ffmpeg keeps what it was given, so the file is what reached it: the harness's own header, not the page's
  expect(files.get(`${DIR}/${hash}.wav`)).toEqual(RAW)
})

test("code that throws in the page fails the sound with what it threw", async () => {
  const { renderer, answers, files } = setup()
  answers.push(async () => ({ error: "TypeError: kit.notee is not a function" }))
  expect(await renderer.check(job())).toEqual(["the code failed: TypeError: kit.notee is not a function"])
  expect(files.size).toBe(0)
  expect(renderer.failureOf(job())).toBe("the code failed: TypeError: kit.notee is not a function")
})

test("what the code threw is cut to a length that can be read", async () => {
  const { renderer, answers } = setup()
  answers.push(async () => ({ error: `Error: ${"x".repeat(1_000)}` }))
  const [problem] = (await renderer.check(job()))!
  expect(problem!.length).toBeLessThan(330)
  expect(problem!.startsWith("the code failed: Error: xxx")).toBe(true)
})

test("a render that runs out of time fails the sound with the page's words", async () => {
  const { renderer, answers, files } = setup()
  answers.push(async () => Promise.reject(new Error("the sound took longer than 20 s to render")))
  expect(await renderer.check(job())).toEqual(["the sound took longer than 20 s to render"])
  expect(renderer.machineReady()).toBe(true)
  expect(files.size).toBe(0)
  expect(await renderer.statusOf(job())).toBe("failed")
  expect(renderer.failureOf(job())).toBe("the sound took longer than 20 s to render")
})

test("an answer that is not a sound the app can read fails the sound", async () => {
  const notSounds: unknown[] = [
    null,
    "a string",
    { wav: 5 },
    {},
    { wav: Buffer.from("not a wave at all, but long enough to have a header's room in it").toString("base64") },
    // a header and no frame
    { wav: wav(0).toString("base64") },
    // a frame cut short: not 44 bytes and whole frames
    { wav: Buffer.concat([RAW, Buffer.from([1, 2])]).toString("base64") },
    // longer than 1.5 s of 48 kHz stereo can be
    { wav: wav(72_001).toString("base64") },
    // far longer, refused before it is decoded
    { wav: "A".repeat(10_000_000) },
    { error: 42 },
  ]
  for (const answer of notSounds) {
    const { renderer, answers, files } = setup()
    answers.push(async () => answer)
    expect(await renderer.check(job()), JSON.stringify(answer)?.slice(0, 80)).toEqual(["the render gave back no sound the app can read"])
    expect(files.size).toBe(0)
  }
  // the longest it can be is accepted
  const { renderer, answers } = setup()
  answers.push(async () => ({ wav: wav(72_000).toString("base64") }))
  expect(await renderer.check(job())).toEqual([])
})

test("with no ffmpeg nothing is rendered: the check cannot be made here, and the machine waits until it is forgotten", async () => {
  const { renderer, runs } = setup({ ffmpeg: null })
  expect(await renderer.check(job())).toBeNull()
  expect(runs).toEqual([])
  expect(renderer.machineReady()).toBe(false)
  expect(await renderer.statusOf(job())).toBe("pending")
  expect(renderer.failureOf(job())).toBeNull()
})

test("a page that cannot start is the machine's fault; after forgetMachine a sound renders again", async () => {
  const { renderer, answers, runs } = setup()
  answers.push(async () => Promise.reject(new EnvironmentError("the sound page could not start")))
  expect(await renderer.check(job())).toBeNull()
  expect(renderer.machineReady()).toBe(false)
  // the machine is no better for the next sound: it is not tried
  expect(await renderer.check(job({ loudness: "soft" }))).toBeNull()
  expect(runs).toHaveLength(1)
  // why, as the write says it
  expect(renderer.environmentProblem()).toBe("the sound page could not start")
  renderer.forgetMachine()
  expect(renderer.machineReady()).toBe(true)
  expect(renderer.environmentProblem()).toBeNull()
  expect(await renderer.check(job())).toEqual([])
  expect(runs).toHaveLength(2)
})

test("a folder that cannot be written is the machine's fault, and nothing is left in it", async () => {
  const { renderer, control, files } = setup()
  control.writeFails = true
  expect(await renderer.check(job())).toBeNull()
  expect(renderer.machineReady()).toBe(false)
  expect(files.size).toBe(0)
  expect(await renderer.statusOf(job())).toBe("pending")
})

test("an ffmpeg that fails on a sound's file fails that sound, not the machine; the raw and the half-written file go", async () => {
  const { renderer, control, files, log } = setup()
  control.ffmpegFails = true
  const hash = hashOf(job())
  // a levelling that fails after it has begun its file
  files.set(`${DIR}/${hash}.wav.tmp`, Buffer.from("half"))
  expect(await renderer.check(job())).toEqual(["the app's ffmpeg could not set the sound's loudness"])
  expect(renderer.machineReady()).toBe(true)
  expect(await renderer.statusOf(job())).toBe("failed")
  expect(files.size).toBe(0)
  expect(log).toContain(`remove ${hash}.raw.wav`)
  expect(log).toContain(`remove ${hash}.wav.tmp`)
})

test("an ffmpeg that does not report the loudness fails that sound too", async () => {
  const { renderer, control, files } = setup()
  control.loudness = "nothing"
  expect(await renderer.check(job())).toEqual(["the app's ffmpeg could not set the sound's loudness"])
  expect(renderer.machineReady()).toBe(true)
  expect(files.size).toBe(0)
})

test("an ffmpeg that lacks a filter, or finds the disk full, is the machine's fault; any other failed exit is the sound's", async () => {
  for (const said of ["[AVFilterGraph @ 0x1] No such filter: 'ebur128'\nError opening output files: Filter not found", "[out#0/wav @ 0x1] Error writing trailer: No space left on device", "av_interleaved_write_frame(): ENOSPC"]) {
    const { renderer, control, files } = setup()
    control.ffmpegSaid = said
    expect(await renderer.check(job()), said).toBeNull()
    expect(renderer.machineReady(), said).toBe(false)
    expect(await renderer.statusOf(job()), said).toBe("pending")
    expect(files.size, said).toBe(0)
  }
  const { renderer, control } = setup()
  control.ffmpegSaid = "[in#0 @ 0x1] Invalid data found when processing input"
  expect(await renderer.check(job())).toEqual(["the app's ffmpeg could not set the sound's loudness"])
  expect(renderer.machineReady()).toBe(true)
})

test("an ffmpeg that runs out of time is the machine's fault", async () => {
  const { renderer, control, files } = setup()
  control.ffmpegTimesOut = true
  expect(await renderer.check(job())).toBeNull()
  expect(renderer.machineReady()).toBe(false)
  expect(files.size).toBe(0)
})

test("an ffmpeg that cannot start is the machine's fault", async () => {
  const { renderer, control, files } = setup()
  control.ffmpegMissing = true
  expect(await renderer.check(job())).toBeNull()
  expect(renderer.machineReady()).toBe(false)
  expect(await renderer.statusOf(job())).toBe("pending")
  expect(files.size).toBe(0)
})

test("a rename that fails leaves no file of that name, and is the machine's fault", async () => {
  const { renderer, control, files } = setup()
  control.renameFails = true
  expect(await renderer.check(job())).toBeNull()
  expect(files.size).toBe(0)
  expect(await renderer.statusOf(job())).toBe("pending")
})

test("forgetFailures forgets each sound's failure and the machine's", async () => {
  const { renderer, answers } = setup()
  answers.push(async () => ({ error: "Error: no" }))
  await renderer.check(job())
  expect(await renderer.statusOf(job())).toBe("failed")
  renderer.forgetFailures()
  expect(await renderer.statusOf(job())).toBe("pending")
  expect(renderer.failureOf(job())).toBeNull()
  const fault = setup({ ffmpeg: null })
  await fault.renderer.check(job())
  fault.renderer.forgetFailures()
  expect(fault.renderer.machineReady()).toBe(true)
})

// the files the preview and the write ask for

test("ensure renders the sounds whose file is missing, one at a time, and skips the ones made", async () => {
  const { renderer, files, runs, mostAtOnce, drain } = setup({ hold: true })
  const made = job({ loudness: "strong" })
  files.set(renderer.fileOf(made), RAW)
  const missing = [job(), job({ loudness: "soft" })]
  expect(renderer.idle()).toBe(true)
  const done = renderer.ensure([made, ...missing])
  await settle()
  expect(renderer.idle()).toBe(false)
  expect(runs).toHaveLength(1)
  expect(await renderer.statusOf(missing[0]!)).toBe("pending")
  await drain(done)
  expect(runs).toHaveLength(2)
  expect(mostAtOnce()).toBe(1)
  for (const sound of [made, ...missing]) expect(await renderer.statusOf(sound)).toBe("ready")
  expect(renderer.idle()).toBe(true)
})

test("each render that ends is told by its hash, made, failed or finding the machine unfit, so the page can read how it stands; one cancelled or skipped is not", async () => {
  const settled: string[] = []
  const { renderer, answers } = setup({ onSettled: (hash) => settled.push(hash) })
  const failing = job({ loudness: "soft" })
  const unfit = job({ loudness: "strong" })
  answers.push(async () => RENDERED, async () => ({ error: "Error: no" }), async () => Promise.reject(new EnvironmentError("the sound page could not start")))
  await renderer.ensure([job(), failing, unfit])
  expect(settled).toEqual([hashOf(job()), hashOf(failing), hashOf(unfit)])
  // a sound whose failure is kept is left alone, and tells nothing; nor does any sound while the machine is unfit
  settled.length = 0
  await renderer.ensure([failing, job({ seconds: 2 })])
  expect(settled).toEqual([])
  // a check that makes a sound tells it too
  renderer.forgetMachine()
  await renderer.check(job({ seconds: 2 }))
  expect(settled).toEqual([hashOf(job({ seconds: 2 }))])
})

test("a render cancelled under way tells nothing", async () => {
  const settled: string[] = []
  const { renderer, drain } = setup({ hold: true, onSettled: (hash) => settled.push(hash) })
  const done = renderer.ensure([job()])
  await settle()
  renderer.cancel()
  await drain(done)
  expect(settled).toEqual([])
})

test("a second ensure while one runs queues behind it", async () => {
  const { renderer, runs, mostAtOnce, drain } = setup({ hold: true })
  const first = renderer.ensure([job(), job({ loudness: "soft" })])
  const second = renderer.ensure([job({ loudness: "strong" })])
  await settle()
  expect(runs).toHaveLength(1)
  await drain(Promise.all([first, second]))
  // each render is known by its seed, which is its own sound's
  const seedOf = (sound: SoundJob) => parseInt(hashOf(sound).slice(0, 8), 16)
  expect(runs.map((run) => Number(/, (\d+)\)\.catch/.exec(run.js)?.[1]))).toEqual([seedOf(job()), seedOf(job({ loudness: "soft" })), seedOf(job({ loudness: "strong" }))])
  expect(mostAtOnce()).toBe(1)
})

test("a check asked for while an ensure runs waits its turn", async () => {
  const { renderer, runs, mostAtOnce, drain } = setup({ hold: true })
  const ensured = renderer.ensure([job()])
  const checked = renderer.check(job({ loudness: "soft" }))
  await settle()
  expect(runs).toHaveLength(1)
  await drain(Promise.all([ensured, checked]))
  expect(await checked).toEqual([])
  expect(runs).toHaveLength(2)
  expect(mostAtOnce()).toBe(1)
})

test("the same sound asked for twice in one ensure is rendered once", async () => {
  const { renderer, runs } = setup()
  await renderer.ensure([job(), { ...job() }])
  expect(runs).toHaveLength(1)
})

test("ensure leaves a failed sound alone until its failure is forgotten", async () => {
  const { renderer, answers, runs } = setup()
  answers.push(async () => ({ error: "Error: no" }))
  await renderer.ensure([job()])
  expect(await renderer.statusOf(job())).toBe("failed")
  await renderer.ensure([job()])
  expect(runs).toHaveLength(1)
  renderer.forgetFailures()
  await renderer.ensure([job()])
  expect(runs).toHaveLength(2)
  expect(await renderer.statusOf(job())).toBe("ready")
})

test("ensure renders nothing on a machine found unfit, and the sounds wait as pending", async () => {
  const { renderer, answers, runs } = setup()
  answers.push(async () => Promise.reject(new EnvironmentError("the sound page could not start")))
  await renderer.ensure([job(), job({ loudness: "soft" })])
  expect(runs).toHaveLength(1)
  expect(await renderer.statusOf(job())).toBe("pending")
  expect(await renderer.statusOf(job({ loudness: "soft" }))).toBe("pending")
  renderer.forgetMachine()
  await renderer.ensure([job(), job({ loudness: "soft" })])
  expect(runs).toHaveLength(3)
})

test("ensure never rejects, whatever its sounds came to", async () => {
  const { renderer, answers } = setup()
  answers.push(async () => ({ error: "Error: no" }), async () => Promise.reject(new EnvironmentError("the sound page could not start")))
  await expect(renderer.ensure([job(), job({ loudness: "soft" })])).resolves.toBeUndefined()
})

test("a check, which a writing waits on, goes ahead of the renders ensure queued; still one at a time", async () => {
  const { renderer, runs, mostAtOnce, drain } = setup({ hold: true })
  const sounds = [job(), job({ loudness: "soft" }), job({ loudness: "strong" })]
  const ensured = renderer.ensure(sounds)
  await settle()
  const checked = renderer.check(job({ seconds: 1.4 }))
  await drain(Promise.all([ensured, checked]))
  const seeds = runs.map((run) => Number(/, (\d+)\)\.catch/.exec(run.js)?.[1]))
  const seedOf = (sound: SoundJob) => parseInt(hashOf(sound).slice(0, 8), 16)
  expect(seeds).toEqual([seedOf(sounds[0]!), seedOf(job({ seconds: 1.4 })), seedOf(sounds[1]!), seedOf(sounds[2]!)])
  expect(mostAtOnce()).toBe(1)
})

test("cancel drops what is queued, and the render under way is kept as nothing: neither that sound's failure nor the machine's", async () => {
  const { renderer, runs, drain } = setup({ hold: true })
  const ensured = renderer.ensure([job(), job({ loudness: "soft" })])
  const checked = renderer.check(job({ loudness: "strong" }))
  await settle()
  expect(runs).toHaveLength(1)
  renderer.cancel()
  await drain(Promise.all([ensured, checked]))
  expect(await checked).toBeNull()
  expect(runs).toHaveLength(1)
  for (const sound of [job(), job({ loudness: "soft" }), job({ loudness: "strong" })]) {
    expect(renderer.failureOf(sound)).toBeNull()
    expect(await renderer.statusOf(sound)).toBe("pending")
  }
  expect(renderer.machineReady()).toBe(true)
  expect(renderer.idle()).toBe(true)
})

test("what is asked for after a cancel renders as usual", async () => {
  const { renderer, runs } = setup()
  renderer.cancel()
  expect(await renderer.check(job())).toEqual([])
  expect(runs).toHaveLength(1)
})
