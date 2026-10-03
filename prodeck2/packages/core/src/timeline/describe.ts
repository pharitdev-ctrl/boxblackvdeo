import type { AgentTimeline, Piece } from "./types.ts"

/** m:ss.s */
const clock = (us: number) => {
  const tenths = Math.round(us / 100_000)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`
}
const span = (startUs: number, durationUs: number) => `${clock(startUs)}–${clock(startUs + durationUs)}`
const quote = (text: string, most = 60) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return `“${flat.length > most ? `${flat.slice(0, most - 1)}…` : flat}”`
}
const tags = (piece: Piece<string, unknown>) => [piece.by, ...(piece.locked ? ["locked"] : [])].join(", ")

/**
 * The timeline as Claude reads it in the agent editor (spec §5.2): the direction, then one line per piece in time
 * order with its id, so an answer can name the piece it changes. The main track's pieces are listed with where they
 * come from in their file; a move or zoom is timed from the start of the piece it is on.
 */
export function describeTimeline(timeline: AgentTimeline): string {
  const starts: number[] = []
  let at = 0
  for (const cut of timeline.cuts) {
    starts.push(at)
    at += cut.item.sourceDurationUs
  }
  const lines: { atUs: number; text: string }[] = []
  const add = (atUs: number, text: string) => lines.push({ atUs, text })

  timeline.cuts.forEach((piece, i) => add(starts[i]!, `${piece.id} ${span(starts[i]!, piece.item.sourceDurationUs)} cut of ${piece.item.binId.slice(0, 8)} from ${clock(piece.item.sourceStartUs)} (${tags(piece)})`))
  for (const piece of timeline.captions) add(piece.item.startUs, `${piece.id} ${span(piece.item.startUs, piece.item.endUs - piece.item.startUs)} subtitle ${quote(piece.item.text)} (${tags(piece)})`)
  for (const piece of timeline.highlights?.groups ?? []) {
    const first = piece.item.lines[0]?.startUs ?? 0
    add(first, `${piece.id} ${span(first, piece.item.endUs - first)} text ${quote(piece.item.lines.map((line) => line.text).join(" / "))} (${tags(piece)})`)
  }
  for (const piece of timeline.moves) {
    const startUs = (starts[piece.item.cut] ?? 0) + piece.item.startUs
    const lastS = piece.item.poses.at(-1)?.s ?? 0
    add(startUs, `${piece.id} ${span(startUs, lastS * 1_000_000)} move on cut-${piece.item.cut + 1}, ${piece.item.poses.length} poses${piece.note ? ` ${quote(piece.note)}` : ""} (${tags(piece)})`)
  }
  for (const piece of timeline.zooms) {
    const startUs = (starts[piece.item.cut] ?? 0) + piece.item.atUs
    add(startUs, `${piece.id} ${span(startUs, piece.item.durationUs)} zoom ${piece.item.kind} on cut-${piece.item.cut + 1} (${tags(piece)})`)
  }
  for (const piece of timeline.inserts) add(piece.item.atUs, `${piece.id} ${span(piece.item.atUs, piece.item.durationUs)} cutaway ${piece.item.kind} ${piece.item.name} (${tags(piece)})`)
  for (const piece of timeline.graphics) add(piece.item.atUs, `${piece.id} ${span(piece.item.atUs, piece.item.durationUs)} graphic${piece.note ? ` ${quote(piece.note)}` : ""} (${tags(piece)})`)
  for (const piece of timeline.composed) add(piece.item.atUs, `${piece.id} ${span(piece.item.atUs, piece.item.durationUs)} composed sound${piece.note ? ` ${quote(piece.note)}` : ""} (${tags(piece)})`)
  for (const piece of timeline.sounds) add(piece.item.atUs, `${piece.id} ${span(piece.item.atUs, piece.item.durationUs)} sound ${quote(piece.item.name, 30)} (${tags(piece)})`)

  // in time order; pieces at the same time keep the order of the kinds above
  const ordered = lines.map((line, i) => ({ ...line, i })).sort((a, b) => a.atUs - b.atUs || a.i - b.i)
  return [
    `Direction: ${timeline.direction.trim() || "none"}`,
    `Length: ${clock(timeline.durationUs)}${timeline.canvas ? ` · frame ${timeline.canvas.width}x${timeline.canvas.height}` : ""} · subtitles ${timeline.subtitles ? "on" : "off"}`,
    "Pieces:",
    ...ordered.map((line) => `- ${line.text}`),
  ].join("\n")
}
