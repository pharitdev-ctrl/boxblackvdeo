import { afterEach, beforeEach, expect, test } from "vitest"
import { type RenderStats, SOUND_HARNESS, soundProblems } from "./harness.ts"

/** What a clean render of a 2.8 s sound reports: loud enough, no click at either end, and within its length. */
const CLEAN: RenderStats = { peak: 0.62, rms: 0.08, seconds: 2.5, headPeak: 0.004, tailPeak: 0.0002 }

// the harness, which runs in the sealed page and so is only read here

test("the harness parses as JavaScript, and running it defines renderSound(code, cue, seed) and nothing runs", () => {
  expect(() => new Function(SOUND_HARNESS)).not.toThrow()
  // only a declaration: no audio is made by reading it, so it runs here, where there is no Web Audio
  const renderSound: unknown = new Function(`${SOUND_HARNESS}\nreturn renderSound`)()
  expect(typeof renderSound).toBe("function")
  expect((renderSound as (...args: unknown[]) => unknown).length).toBe(3)
})

// the harness run here on a fake context, which gives back the samples a test sets, so that what the harness does with them can be seen

/** What the fake context renders: a function that fills the two channels, which are as long as the context. */
let rendered: (left: Float32Array, right: Float32Array) => void = () => {}
/** The buffers the code made through the kit, in order. */
let made: Float32Array[][] = []

class FakeContext {
  readonly length: number
  constructor(_channels: number, length: number, _sampleRate: number) {
    this.length = length
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length))
    made.push(data)
    return { getChannelData: (channel: number) => data[channel]! }
  }
  createConvolver() {
    return { buffer: null as unknown }
  }
  async startRendering() {
    const left = new Float32Array(this.length)
    const right = new Float32Array(this.length)
    rendered(left, right)
    return { getChannelData: (channel: number) => (channel === 0 ? left : right) }
  }
}

interface Rendered {
  wav: string
  stats: RenderStats
}
type RenderSound = (code: string, cue: { length: number; words: unknown[] }, seed: number) => Promise<Rendered>

const realRandom = Math.random
const hadContext = "OfflineAudioContext" in globalThis
const realContext = (globalThis as Record<string, unknown>).OfflineAudioContext

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).OfflineAudioContext = FakeContext
  rendered = () => {}
  made = []
})
afterEach(() => {
  Math.random = realRandom
  if (hadContext) (globalThis as Record<string, unknown>).OfflineAudioContext = realContext
  else delete (globalThis as Record<string, unknown>).OfflineAudioContext
  delete (globalThis as Record<string, unknown>).composed
})

const renderSound = () => new Function(`${SOUND_HARNESS}\nreturn renderSound`)() as RenderSound
const SILENT_CODE = "function compose(ctx, cue, kit) { }"

/** The WAV a render gave, read back: its header fields and its samples, left and right in turn. */
function wavOf(base64: string) {
  const bytes = Buffer.from(base64, "base64")
  const samples: number[] = []
  for (let at = 44; at < bytes.length; at += 2) samples.push(bytes.readInt16LE(at))
  return {
    bytes,
    riff: bytes.toString("ascii", 0, 4),
    riffSize: bytes.readUInt32LE(4),
    wave: bytes.toString("ascii", 8, 16),
    format: bytes.readUInt16LE(20),
    channels: bytes.readUInt16LE(22),
    rate: bytes.readUInt32LE(24),
    byteRate: bytes.readUInt32LE(28),
    blockAlign: bytes.readUInt16LE(32),
    bits: bytes.readUInt16LE(34),
    data: bytes.toString("ascii", 36, 40),
    dataSize: bytes.readUInt32LE(40),
    frames: bytes.readUInt32LE(40) / 4,
    samples,
  }
}

test("a silent render is kept at its shortest, 0.05 s: 2400 frames, and measures nothing", async () => {
  const { wav, stats } = await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)
  expect(wavOf(wav).frames).toBe(2400)
  expect(stats).toEqual({ peak: 0, rms: 0, seconds: 0.05, headPeak: 0, tailPeak: 0 })
})

test("a render loud to its end keeps its whole length, and its last 5 ms are measured as they are", async () => {
  rendered = (left, right) => left.fill(0.5, 1000) && right.fill(0.25, 1000)
  const { wav, stats } = await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)
  expect(wavOf(wav).frames).toBe(48_000)
  expect(stats.seconds).toBe(1)
  expect(stats.tailPeak).toBe(0.5)
  expect(stats.headPeak).toBe(0)
})

test("the silence after the last sample heard is cut 0.1 s after it: a blip at frame 1000 gives 5801 frames", async () => {
  rendered = (left) => void (left[1000] = 0.3)
  const { wav, stats } = await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)
  expect(wavOf(wav).frames).toBe(5801)
  expect(stats.seconds).toBe(5801 / 48_000)
  expect(stats.peak).toBeCloseTo(0.3, 6)
  // a sample under 0.001 is not heard, and keeps nothing after it
  rendered = (left) => {
    left[1000] = 0.3
    left[20_000] = 0.0009
  }
  expect(wavOf((await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)).wav).frames).toBe(5801)
  // a click in the first 5 ms is measured
  rendered = (left) => void (left[100] = 0.2)
  expect((await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)).stats.headPeak).toBeCloseTo(0.2, 6)
})

test("the WAV is 16-bit stereo PCM at 48 kHz: its RIFF size is the data's and 36, its byte rate and block align are right, and its samples are little-endian", async () => {
  rendered = (left, right) => {
    left[0] = 0.5
    right[0] = -0.5
    left[1] = 1
  }
  const wav = wavOf((await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)).wav)
  expect(wav.riff).toBe("RIFF")
  expect(wav.wave).toBe("WAVEfmt ")
  expect(wav.data).toBe("data")
  expect(wav.riffSize).toBe(wav.dataSize + 36)
  expect(wav.bytes.length).toBe(wav.dataSize + 44)
  expect([wav.format, wav.channels, wav.rate, wav.bits]).toEqual([1, 2, 48_000, 16])
  expect(wav.byteRate).toBe(48_000 * 4)
  expect(wav.blockAlign).toBe(4)
  // 0.5 of full scale is 16383, written low byte first; the right channel follows the left
  expect([...wav.bytes.subarray(44, 48)]).toEqual([0xff, 0x3f, 0x01, 0xc0])
  expect(wav.samples.slice(0, 4)).toEqual([16383, -16383, 32767, 0])
})

test("a peak over full scale is scaled down to it when encoded, the shape kept, and measured as it was", async () => {
  rendered = (left) => {
    left[10] = 2
    left[11] = 1
    left[12] = -0.5
  }
  const { wav, stats } = await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)
  const samples = wavOf(wav).samples
  expect(Math.max(...samples)).toBe(32767)
  // scaled by a half, not flattened at full scale
  expect([samples[20], samples[22], samples[24]]).toEqual([32767, 16383, -8191])
  expect(stats.peak).toBe(2)
  // under full scale nothing is scaled
  rendered = (left) => void (left[10] = 0.5)
  expect(wavOf((await renderSound()(SILENT_CODE, { length: 1, words: [] }, 1)).wav).samples[20]).toBe(16383)
})

test("the kit: kit.note gives the frequency of a note, and the same seed gives the same noise, which Math.random draws from too", async () => {
  const code = "function compose(ctx, cue, kit) { globalThis.composed = { a4: kit.note('A4'), c4: kit.note('C4'), bb3: kit.note('Bb3'), length: cue.length, noise: kit.noise(0.001), random: Math.random() === kit.rand() } }"
  type Composed = { a4: number; c4: number; bb3: number; length: number; noise: unknown; random: boolean }
  const composed = () => (globalThis as Record<string, unknown>).composed as Composed
  await renderSound()(code, { length: 0.5, words: [] }, 1234)
  expect(composed().a4).toBe(440)
  expect(composed().c4).toBeCloseTo(261.6256, 4)
  expect(composed().bb3).toBeCloseTo(233.0819, 4)
  expect(composed().length).toBe(0.5)
  const first = [...made[0]![0]!]
  expect(first).toHaveLength(48)
  await renderSound()(code, { length: 0.5, words: [] }, 1234)
  expect([...made[1]![0]!]).toEqual(first)
  await renderSound()(code, { length: 0.5, words: [] }, 99)
  expect([...made[2]![0]!]).not.toEqual(first)
  for (const sample of first) expect(Math.abs(sample)).toBeLessThanOrEqual(1)
})

test("code that ends in }; renders, as code with no semicolon does", async () => {
  rendered = (left) => void (left[1000] = 0.3)
  const code = "function compose(ctx, cue, kit) { globalThis.composed = cue.words.length };"
  const { wav } = await renderSound()(code, { length: 1, words: [{ text: "ก", atS: 0 }] }, 1)
  expect((globalThis as Record<string, unknown>).composed).toBe(1)
  expect(wavOf(wav).frames).toBe(5801)
})

// the checks of a render

test("a clean render has no problems", () => {
  expect(soundProblems(CLEAN, 2.8)).toEqual([])
})

test("a silent render is a problem: nothing above 1% of full scale; at 1% it is not", () => {
  expect(soundProblems({ ...CLEAN, peak: 0.004 }, 2.8)).toEqual(["the sound is silent: nothing above 1% of full scale"])
  expect(soundProblems({ ...CLEAN, peak: 0 }, 2.8)).toEqual(["the sound is silent: nothing above 1% of full scale"])
  expect(soundProblems({ ...CLEAN, peak: 0.01 }, 2.8)).toEqual([])
})

test("a peak over 4 before levelling is a gain run away, and the problem gives the peak; up to 4 it is not, since the loudness is set afterwards", () => {
  expect(soundProblems({ ...CLEAN, peak: 12.5 }, 2.8)).toEqual(["the sound is far too loud before levelling (peak 12.5): a gain has run away"])
  expect(soundProblems({ ...CLEAN, peak: 4.12345 }, 2.8)).toEqual(["the sound is far too loud before levelling (peak 4.123): a gain has run away"])
  expect(soundProblems({ ...CLEAN, peak: Number.POSITIVE_INFINITY }, 2.8)).toEqual(["the sound is far too loud before levelling (peak Infinity): a gain has run away"])
  expect(soundProblems({ ...CLEAN, peak: 4 }, 2.8)).toEqual([])
  expect(soundProblems({ ...CLEAN, peak: 1.6 }, 2.8)).toEqual([])
})

test("a first 5 ms over 0.05 is a click at the start, and the problem gives how loud; at 0.05 it is not", () => {
  expect(soundProblems({ ...CLEAN, headPeak: 0.31 }, 2.8)).toEqual(["the sound starts with a click: the first 5 ms reach 0.31"])
  expect(soundProblems({ ...CLEAN, headPeak: 0.0512 }, 2.8)).toEqual(["the sound starts with a click: the first 5 ms reach 0.051"])
  expect(soundProblems({ ...CLEAN, headPeak: 0.05 }, 2.8)).toEqual([])
})

test("a last 5 ms over 0.05 is a click at the end, a sound cut off at its length, and the problem gives how loud; at 0.05 it is not", () => {
  expect(soundProblems({ ...CLEAN, tailPeak: 0.2 }, 2.8)).toEqual(["the sound ends with a click: the last 5 ms reach 0.2"])
  expect(soundProblems({ ...CLEAN, tailPeak: 0.05 }, 2.8)).toEqual([])
})

test("a render longer than its length by more than 10 ms runs past it; up to 10 ms over it does not", () => {
  expect(soundProblems({ ...CLEAN, seconds: 2.82 }, 2.8)).toEqual(["the sound runs past its length"])
  expect(soundProblems({ ...CLEAN, seconds: 2.811 }, 2.8)).toEqual(["the sound runs past its length"])
  expect(soundProblems({ ...CLEAN, seconds: 2.809 }, 2.8)).toEqual([])
  // a render is never longer than its context by more than one sample, which is well inside
  expect(soundProblems({ ...CLEAN, seconds: 2.8 + 1 / 48_000 }, 2.8)).toEqual([])
  expect(soundProblems({ ...CLEAN, seconds: 2.8 }, 2.8)).toEqual([])
})

test("every problem found is given, in the order of the checks", () => {
  expect(soundProblems({ peak: 9, rms: 2, seconds: 3.5, headPeak: 0.9, tailPeak: 1.25 }, 2.8)).toEqual([
    "the sound is far too loud before levelling (peak 9): a gain has run away",
    "the sound starts with a click: the first 5 ms reach 0.9",
    "the sound ends with a click: the last 5 ms reach 1.25",
    "the sound runs past its length",
  ])
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/sound/harness")
  expect(exported.SOUND_HARNESS).toBe(SOUND_HARNESS)
  expect(exported.soundProblems).toBe(soundProblems)
})
