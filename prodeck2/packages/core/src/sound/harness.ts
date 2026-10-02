/*
 * The page side of a sound's render (spec §7), and the checks of what it rendered (spec §6.2). The harness is the
 * spike's (docs/plans/2026-10-01-sound-spike/harness.js), kept as text: the app runs it in the sealed hidden page with
 * one call of renderSound after it, and gets the WAV and its measures back as data. It differs from the spike's in
 * what it returns: it scales a sound only when it is over full scale, and only in the WAV; it cuts the silence at the
 * end; and it measures the first and the last 5 ms.
 */

/** What a render measured: the peak and RMS of what was kept, its length in seconds, and the peak of its first and last 5 ms. */
export interface RenderStats {
  peak: number
  rms: number
  seconds: number
  headPeak: number
  tailPeak: number
}

/** What a render gives back: the sound as a WAV, and what was measured of it. */
export interface RenderedPcm {
  /** base64 16-bit stereo 48 kHz WAV, trailing silence over 0.1 s cut */
  wav: string
  stats: RenderStats
}

/**
 * The code that renders a sound in the page, as text: it declares `renderSound(code, cue, seed)` and nothing else,
 * which resolves to a RenderedPcm. It seeds a generator with `seed` (the caller's, so a sound renders the same every
 * time) and makes it Math.random too; builds the context (2 channels, 48 kHz, cue.length seconds) and the kit the
 * contract offers; makes the function from the code and calls it once; and renders.
 *
 * Of what is rendered, the sound ends 0.1 s after the last sample above 0.001, and is never shorter than 0.05 s.
 * The measures are of the sound as rendered, its peak too, since the loudness is set afterwards. A sound whose peak
 * is over full scale is scaled down to full scale as the WAV is written, so that its shape is kept rather than
 * clipped; each sample is clamped as well. It is written with no backtick and no ${ so that it can be held as it is here.
 */
export const SOUND_HARNESS = String.raw`async function renderSound(code, cue, seed) {
  let s = seed >>> 0
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  Math.random = rand
  const rate = 48000
  const ctx = new OfflineAudioContext(2, Math.ceil(cue.length * rate), rate)
  const NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const kit = {
    rand,
    noise(seconds) { const b = ctx.createBuffer(1, Math.max(1, Math.ceil(seconds * rate)), rate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1; return b },
    reverb(seconds, decay) {
      const n = Math.max(1, Math.ceil(seconds * rate)); const b = ctx.createBuffer(2, n, rate)
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / n, decay) }
      const conv = ctx.createConvolver(); conv.buffer = b; return conv
    },
    note(name) { const m = /^([A-G])([#b]?)(-?\d)$/.exec(name); if (!m) throw new Error("bad note " + name); const semi = NOTES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12; return 440 * Math.pow(2, (semi - 69) / 12) },
  }
  const compose = new Function('"use strict"; return (' + code.trim().replace(/;\s*$/, "") + ")")()
  compose(ctx, cue, kit)
  const buf = await ctx.startRendering()
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  // the loudest sample, and the last one heard
  let peak = 0, lastHeard = -1
  for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; if (a > 0.001) lastHeard = i }
  // the sound ends 0.1 s after the last sample heard, and lasts at least 0.05 s
  const n = Math.min(L.length, Math.max(Math.round(0.05 * rate), lastHeard < 0 ? 0 : lastHeard + 1 + Math.round(0.1 * rate)))
  // the first and the last 5 ms of what is kept, where a click would be heard
  const edge = Math.min(n, Math.round(0.005 * rate))
  let sum = 0, headPeak = 0, tailPeak = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]))
    sum += (L[i] * L[i] + R[i] * R[i]) / 2
    if (i < edge && a > headPeak) headPeak = a
    if (i >= n - edge && a > tailPeak) tailPeak = a
  }
  const bytes = new ArrayBuffer(44 + n * 4), v = new DataView(bytes)
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
  str(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 4, true)
  // a sound over full scale is scaled down to it as it is written, so that its shape is kept and not clipped
  const k = peak > 1 ? 1 / peak : 1
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * k)) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * k)) * 32767, true) }
  let bin = ""; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
  return { wav: btoa(bin), stats: { peak, rms: Math.sqrt(sum / n), seconds: n / rate, headPeak, tailPeak } }
}`

/** A measure as a problem gives it: to three decimals at most, with no zeros after the last digit that counts. */
const measured = (value: number) => String(Number(value.toFixed(3)))

/**
 * What is wrong with a rendered sound, in plain English for the repair, in the order of the checks: silent; a gain
 * run away (a peak over 4 before the loudness is set, which may lift or lower it); a click in the first or the last
 * 5 ms; longer than the `length` it was composed for, which is kept as a guard. None when it is fine.
 */
export function soundProblems(stats: RenderStats, length: number): string[] {
  const problems: string[] = []
  if (stats.peak < 0.01) problems.push("the sound is silent: nothing above 1% of full scale")
  if (stats.peak > 4) problems.push(`the sound is far too loud before levelling (peak ${measured(stats.peak)}): a gain has run away`)
  if (stats.headPeak > 0.05) problems.push(`the sound starts with a click: the first 5 ms reach ${measured(stats.headPeak)}`)
  if (stats.tailPeak > 0.05) problems.push(`the sound ends with a click: the last 5 ms reach ${measured(stats.tailPeak)}`)
  // a guard: it cannot fire with this harness, whose context is as long as the length and never longer
  if (stats.seconds > length + 0.01) problems.push("the sound runs past its length")
  return problems
}
