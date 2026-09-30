// Read-only: works out the behind-the-person ranges on 0917 as written by the test app, and for each the
// source frames its cutout file holds (timestamps kept, spec §7.2 step 1). Writes jobs.json.
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
const HERE = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/behind"
const draft = await loadDraft(join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"))
const info: any = draft.info
const pts: number[] = JSON.parse(readFileSync(join(HERE, "pts.json"), "utf8"))
const TB = 600
const us = (ticks: number) => (ticks * 1_000_000) / TB
const main = info.tracks[0].segments
// highlight lines on the three text lanes (tracks 5–7), grouped by the first lane's starts
const lanes = [5, 6, 7].map((i) => info.tracks[i].segments)
const groupStarts = [3133333, 12433333, 15500000, 18500000] // G1, G3, G4, G5 (G2 at 9133333 stays in front)
const groups = groupStarts.map((start) => {
  const next = [...lanes[0].map((s: any) => s.target_timerange.start), Infinity].filter((t) => t > start).sort((a, b) => a - b)[0]
  const lines = lanes.flatMap((lane: any[], lane_i: number) => lane.filter((s) => s.target_timerange.start >= start && s.target_timerange.start < next).map((s) => ({ id: s.id, lane: lane_i })))
  const all = lanes.flat().filter((s: any) => lines.some((l) => l.id === s.id))
  const end = Math.max(...all.map((s: any) => s.target_timerange.start + s.target_timerange.duration))
  return { start, end, lines }
})
// R0: no text, on the part of piece 0 whose source frames sit exactly on the 1/30 grid
const ranges: any[] = [{ name: "r0", group: null, start: 200000, end: 1566666 }]
groups.forEach((g, i) => {
  for (const [k, piece] of main.entries()) {
    const a = Math.max(g.start, piece.target_timerange.start)
    const b = Math.min(g.end, piece.target_timerange.start + piece.target_timerange.duration)
    if (b - a >= 33333) ranges.push({ name: `g${["1", "3", "4", "5"][i]}${String.fromCharCode(97 + ranges.filter((r) => r.group === i).length)}`, group: i, piece: k, start: a, end: b })
  }
})
for (const r of ranges) {
  const k = r.piece ?? main.findIndex((p: any) => r.start >= p.target_timerange.start && r.start < p.target_timerange.start + p.target_timerange.duration)
  r.piece = k
  const piece = main[k]
  r.S = piece.source_timerange.start + (r.start - piece.target_timerange.start)
  r.D = r.end - r.start
  // p0: the latest source frame before S whose time is a whole µs; last: the first frame at or after S + D
  let i0 = pts.findLastIndex((p) => us(p) < r.S && (p * 1_000_000) % TB === 0)
  const iEnd = pts.findIndex((p) => us(p) >= r.S + r.D)
  r.i0 = i0
  r.iEnd = iEnd
  r.p0 = pts[i0]
  r.p0us = us(pts[i0]!)
  r.ticks = pts.slice(i0, iEnd + 1).map((p) => p - pts[i0]!)
  r.fileUs = us(pts[iEnd]! - pts[i0]! + 20) // through the last frame's own duration
  r.sourceStart = r.S - r.p0us
}
writeFileSync(join(HERE, "jobs.json"), JSON.stringify({ groups, ranges }, null, 1))
for (const r of ranges) console.log(r.name, "piece", r.piece, "timeline", r.start, r.end, "S", r.S, "D", r.D, "frames", r.i0, "..", r.iEnd, `(${r.ticks.length})`, "p0us", r.p0us, "source.start", r.sourceStart, "steps≠20", r.ticks.map((t: number, i: number) => i && t - r.ticks[i - 1]).filter((d: number) => d && d !== 20))
console.log(groups.map((g) => `${g.start}-${g.end} lines ${g.lines.length}`))
