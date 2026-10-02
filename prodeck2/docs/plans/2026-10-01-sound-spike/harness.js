async function renderSound(code, cue, seed) {
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
  const compose = new Function(`"use strict"; return (${code.trim().replace(/;\s*$/, "")})`)()
  compose(ctx, cue, kit)
  const buf = await ctx.startRendering()
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  let peak = 0, sum = 0, lastLoud = 0
  for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; sum += (L[i] * L[i] + R[i] * R[i]) / 2; if (a > 0.001) lastLoud = i }
  const n = L.length, bytes = new ArrayBuffer(44 + n * 4), v = new DataView(bytes)
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
  str(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 4, true)
  const scale = peak > 0.98 ? 0.98 / peak : 1
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * scale)) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * scale)) * 32767, true) }
  let bin = ""; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
  return { wav: btoa(bin), peak, rms: Math.sqrt(sum / n), seconds: n / rate, silentEnd: (n - lastLoud) / rate }
}
