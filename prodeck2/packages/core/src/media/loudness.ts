import { runProcess } from "./process.ts"

/** How loud a file's audio is over time: one RMS level in dBFS per step, from the start of the file. */
export interface Loudness {
  stepUs: number
  db: number[]
}

export const LOUDNESS_STEP_US = 10_000

const SAMPLE_RATE = 16_000
const SAMPLES_PER_STEP = (SAMPLE_RATE * LOUDNESS_STEP_US) / 1_000_000
/** Digital silence has no level; this stands in for it and for anything quieter. */
const FLOOR_DB = -100

/** Turns 16 kHz mono s16le audio, pushed in chunks of any size, into levels per 10 ms. */
export class LoudnessMeter {
  private readonly db: number[] = []
  private leftover: Buffer = Buffer.alloc(0)
  private sum = 0
  private count = 0

  push(chunk: Buffer): void {
    const data = this.leftover.length ? Buffer.concat([this.leftover, chunk]) : chunk
    const whole = data.length - (data.length % 2)
    for (let i = 0; i < whole; i += 2) {
      const sample = data.readInt16LE(i) / 32768
      this.sum += sample * sample
      if (++this.count === SAMPLES_PER_STEP) this.close()
    }
    this.leftover = Buffer.from(data.subarray(whole))
  }

  private close(): void {
    const db = 10 * Math.log10(this.sum / this.count)
    // `|| 0` turns -0 into 0
    this.db.push(Number.isFinite(db) ? Math.max(FLOOR_DB, Math.round(db) || 0) : FLOOR_DB)
    this.sum = 0
    this.count = 0
  }

  finish(): Loudness {
    if (this.count > 0) this.close()
    return { stepUs: LOUDNESS_STEP_US, db: this.db }
  }
}

/** Decodes the first audio stream and measures it. An hour of audio is ~360,000 levels. */
export async function measureLoudness(args: { ffmpeg: string; input: string; signal?: AbortSignal }): Promise<Loudness> {
  const meter = new LoudnessMeter()
  await runProcess(
    args.ffmpeg,
    ["-nostdin", "-v", "error", "-i", args.input, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"],
    { signal: args.signal, onStdout: (chunk) => meter.push(chunk) },
  )
  return meter.finish()
}
