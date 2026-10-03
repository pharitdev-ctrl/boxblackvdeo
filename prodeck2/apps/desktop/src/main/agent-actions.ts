import type { Action, RawAction } from "@boxblack/core/agent"
import { secondsToUs } from "@boxblack/core/agent"
import type { BinItem } from "@boxblack/core/capcut"
import type { TimelineComposedSound } from "@boxblack/core/capcut/composed-sounds"
import type { TimelineGraphic } from "@boxblack/core/capcut/graphics"
import type { HighlightLook, TimelineHighlightGroup } from "@boxblack/core/capcut"
import type { TimelineSoundCue } from "@boxblack/core/capcut/sounds"
import type { TimelineMove } from "@boxblack/core/capcut/moves"
import type { Pose } from "@boxblack/core/flair/moves"
import { boxText, COVER_MAX_US, type GraphicBox, type MotionWord } from "@boxblack/core/graphics/plan"
import { layoutGroup } from "@boxblack/core/highlights"
import type { HighlightFontId } from "@boxblack/core/highlights/styles"
import type { AgentTimeline, Piece, PieceAuthor } from "@boxblack/core/timeline"

/** The clip as the actions need it, on the rough cut's clock after rounding to frames. */
export interface AgentClip {
  canvas: { width: number; height: number }
  durationUs: number
  /** every word the rough cut plays, in order: Claude's w1 is the first */
  words: { text: string; atUs: number; endUs: number }[]
  /** the main track's pieces, in order */
  cuts: { startUs: number; durationUs: number }[]
  /** what the picture shows where, from the prepare step, as "ทำทั้งหมด" checks against it */
  room: AgentRoom
  /** how highlight text looks in this project; null when it cannot be drawn (no fonts) */
  highlight: { font: HighlightFontId; look: HighlightLook; subtitlesOn: boolean } | null
}

/** The checks against what the picture shows: the faces and the things being shown, and where the moves take them. */
export interface AgentRoom {
  /** why a move may not play on piece `cut` from `startUs` after its start beside the other moves (`others`), or null when it may: the zoom cap, the frame's edges, the faces in frame while it plays and while its last pose is held */
  moveWhy(cut: number, startUs: number, poses: Pose[], others: TimelineMove[]): string | null
  /** the faces and shown things on screen over a span of the rough cut with `moves` played, in shares of the frame */
  keepIn(span: { startUs: number; endUs: number }, moves: TimelineMove[]): GraphicBox[]
}

/** What makes the pieces that need rendering or a library: a graphic, a composed sound, a library sound. */
export interface AgentMakers {
  graphic(args: { atUs: number; durationUs: number; box: [number, number, number, number]; idea: string; words: MotionWord[]; signal?: AbortSignal }): Promise<{ ok: true; graphic: TimelineGraphic; binItem: BinItem } | { ok: false; why: string }>
  composeSound(args: { atUs: number; seconds: number; role: string; loudness: "soft" | "normal" | "strong"; signal?: AbortSignal }): Promise<{ ok: true; sound: TimelineComposedSound; binItem: BinItem } | { ok: false; why: string }>
  librarySound(name: string, atUs: number, loudness: "soft" | "normal" | "strong"): { ok: true; cue: TimelineSoundCue } | { ok: false; why: string }
}

export interface ActionResult {
  ok: boolean
  /** a line in Thai for Claude's next request and the chat */
  message: string
  pieceId?: string
}

type Kinds = "highlight" | "move" | "graphic" | "composed" | "sound" | "caption" | "cut" | "zoom" | "insert"

/** A line of text lives this long at least, and stays this long after its last word. */
const TEXT_MIN_US = 1_000_000
const TEXT_TAIL_US = 300_000
const clock = (us: number) => `${(us / 1_000_000).toFixed(2)}s`

/** Every piece of a timeline, whatever its kind, for finding one by id. */
function allPieces(timeline: AgentTimeline): Piece<string, unknown>[] {
  return [
    ...timeline.cuts,
    ...timeline.captions,
    ...(timeline.highlights?.groups ?? []),
    ...timeline.moves,
    ...timeline.zooms,
    ...timeline.inserts,
    ...timeline.graphics,
    ...timeline.composed,
    ...timeline.sounds,
  ]
}

/** A new id for a piece of `kind` Claude makes: the kind and the next free number among that kind's ids. */
function nextId(timeline: AgentTimeline, kind: string): string {
  const used = allPieces(timeline)
    .filter((piece) => piece.kind === kind)
    .map((piece) => Number(/-(\d+)$/.exec(piece.id)?.[1] ?? 0))
  return `${kind}-${Math.max(0, ...used) + 1}`
}

const piece = <K extends string, T>(id: string, kind: K, item: T, note: string, by: PieceAuthor = "claude"): Piece<K, T> => ({ id, kind, by, locked: false, note, item })

/** The media bin entries the timeline's graphics and composed sounds still use. */
function binKept(timeline: AgentTimeline): AgentTimeline {
  const used = new Set([...timeline.graphics.map((p) => p.item.binId), ...timeline.composed.map((p) => p.item.binId)])
  return { ...timeline, binItems: timeline.binItems.filter((item) => used.has(item.id)) }
}

function withoutPiece(timeline: AgentTimeline, id: string): AgentTimeline {
  const drop = <T extends { id: string }>(list: T[]) => list.filter((one) => one.id !== id)
  return binKept({
    ...timeline,
    captions: drop(timeline.captions),
    highlights: timeline.highlights && { ...timeline.highlights, groups: drop(timeline.highlights.groups) },
    moves: drop(timeline.moves),
    zooms: drop(timeline.zooms),
    inserts: drop(timeline.inserts),
    graphics: drop(timeline.graphics),
    composed: drop(timeline.composed),
    sounds: drop(timeline.sounds),
  })
}

const byStart = <T extends { item: { atUs: number } }>(list: T[]) => [...list].sort((a, b) => a.item.atUs - b.item.atUs)

/** Where a word or a time lands on the rough cut, or why it does not. */
function timeOf(clip: AgentClip, at: { word: number } | { s: number }): { ok: true; atUs: number } | { ok: false; why: string } {
  if ("word" in at) {
    const word = clip.words[at.word - 1]
    return word ? { ok: true, atUs: word.atUs } : { ok: false, why: `ไม่มีคำที่ w${at.word} (มี ${clip.words.length} คำ)` }
  }
  const atUs = secondsToUs(at.s)
  return atUs >= 0 && atUs < clip.durationUs ? { ok: true, atUs } : { ok: false, why: `เวลา ${at.s}s อยู่นอกคลิป (ยาว ${clock(clip.durationUs)})` }
}

function textGroup(clip: AgentClip, timeline: AgentTimeline, fromWord: number, toWord: number, lines: string[], tone: "base" | "accent" | "alt" | null): { ok: true; group: TimelineHighlightGroup } | { ok: false; why: string } {
  if (!clip.highlight) return { ok: false, why: "โปรเจคนี้วาดข้อความเด่นไม่ได้ (ไม่มีฟอนต์)" }
  const first = clip.words[fromWord - 1]
  const last = clip.words[toWord - 1]
  if (!first || !last) return { ok: false, why: `ไม่มีคำที่ w${first ? toWord : fromWord} (มี ${clip.words.length} คำ)` }
  const span = toWord - fromWord + 1
  const endUs = Math.min(clip.durationUs, Math.max(last.endUs + TEXT_TAIL_US, first.atUs + TEXT_MIN_US))
  // laid off the faces and shown things on screen while it plays, as "ทำทั้งหมด" lays its text
  const laid = layoutGroup(lines, clip.highlight.font, clip.canvas, { kind: "auto", keepClear: bandOf(clip.room.keepIn({ startUs: first.atUs, endUs }, movesOf(timeline))), keepSubtitleRoom: clip.highlight.subtitlesOn }, "stack").lines
  return {
    ok: true,
    group: {
      endUs,
      exit: null,
      // each line comes up on its share of the words, the first on the first word
      lines: lines.map((text, i) => ({ startUs: clip.words[fromWord - 1 + Math.floor((i * span) / lines.length)]!.atUs, text, ...laid[i]!, tone: tone ?? "base", accent: null })),
    },
  }
}

const movesOf = (timeline: AgentTimeline): TimelineMove[] => timeline.moves.map((p) => p.item)

/** The band of the frame boxes take, top to bottom; null for none. */
const bandOf = (boxes: GraphicBox[]) => (boxes.length === 0 ? null : boxes.reduce((band, box) => ({ fromY: Math.min(band.fromY, box.y0), toY: Math.max(band.toY, box.y1) }), { fromY: 1, toY: 0 }))

/**
 * Why a graphic may not go in `box` from `atUs` for `durationUs`, or null when it may: over a face or a thing being
 * shown it may play COVER_MAX_US at most, as "ทำทั้งหมด" allows. Checked before it is made, so a refusal costs nothing.
 */
function graphicCovers(clip: AgentClip, timeline: AgentTimeline, atUs: number, durationUs: number, box: [number, number, number, number]): string | null {
  if (durationUs <= COVER_MAX_US) return null
  const own = { x0: box[0], y0: box[1], x1: box[2], y1: box[3] }
  const covered = clip.room.keepIn({ startUs: atUs, endUs: atUs + durationUs }, movesOf(timeline)).filter((keep) => own.x0 < keep.x1 && keep.x0 < own.x1 && own.y0 < keep.y1 && keep.y0 < own.y1)
  if (covered.length === 0) return null
  return `กล่อง ${boxText(own)} ทับหน้าคนหรือของที่โชว์ที่ ${covered.map(boxText).join(", ")} ช่วง ${clock(atUs)}–${clock(atUs + durationUs)} · ทับได้ไม่เกิน ${COVER_MAX_US / 1_000_000}s ย้าย box หรือสั้นลง`
}

/** Where a written graphic sits, as a box in shares of the frame: its file is drawn at its own pixel size, its centre at `place`. */
function boxOfGraphic(graphic: TimelineGraphic, canvas: { width: number; height: number }): [number, number, number, number] {
  const cx = (graphic.place.x / 2 + 0.5) * canvas.width
  const cy = (0.5 - graphic.place.y / 2) * canvas.height
  return [(cx - graphic.width / 2) / canvas.width, (cy - graphic.height / 2) / canvas.height, (cx + graphic.width / 2) / canvas.width, (cy + graphic.height / 2) / canvas.height]
}

/** Highlight groups share one place on screen: a new one may not play while another does. */
function textClash(timeline: AgentTimeline, group: TimelineHighlightGroup, except?: string): string | null {
  const start = group.lines[0]!.startUs
  const other = (timeline.highlights?.groups ?? []).find((p) => p.id !== except && p.item.lines[0]!.startUs < group.endUs && start < p.item.endUs)
  return other ? `ซ้อนเวลากับข้อความ ${other.id} (${clock(other.item.lines[0]!.startUs)}–${clock(other.item.endUs)}) ซึ่งขึ้นที่เดียวกัน` : null
}

function placeMove(clip: AgentClip, timeline: AgentTimeline, atUs: number, poses: Pose[], except?: string): { ok: true; cut: number; startUs: number } | { ok: false; why: string } {
  const cut = clip.cuts.findIndex((c) => atUs >= c.startUs && atUs < c.startUs + c.durationUs)
  if (cut < 0) return { ok: false, why: `ไม่มีชิ้นวิดีโอที่ ${clock(atUs)}` }
  const piece = clip.cuts[cut]!
  const startUs = atUs - piece.startUs
  const endUs = startUs + (poses.at(-1)?.s ?? 0) * 1_000_000
  const others = timeline.moves.filter((m) => m.id !== except)
  const clash = others.find((m) => m.item.cut === cut && m.item.startUs < endUs && startUs < m.item.startUs + (m.item.poses.at(-1)?.s ?? 0) * 1_000_000)
  if (clash) return { ok: false, why: `ซ้อนเวลากับการเคลื่อนภาพ ${clash.id} บนชิ้นวิดีโอเดียวกัน` }
  const why = clip.room.moveWhy(cut, startUs, poses, others.map((m) => m.item))
  if (why) return { ok: false, why: `การเคลื่อนภาพไม่ผ่าน: ${why}` }
  return { ok: true, cut, startUs }
}

const wordsIn = (clip: AgentClip, atUs: number, durationUs: number): MotionWord[] =>
  clip.words.filter((w) => w.atUs >= atUs && w.atUs < atUs + durationUs).map((w) => ({ text: w.text, atS: (w.atUs - atUs) / 1_000_000 }))

/**
 * Carries out one action on the timeline: the new timeline, and what to tell Claude. A refusal leaves the timeline as
 * it was. Pieces Claude makes are `by: "claude"`; a locked piece is never changed or removed.
 */
export async function runAction(timeline: AgentTimeline, action: Action, clip: AgentClip, makers: AgentMakers, signal?: AbortSignal): Promise<{ timeline: AgentTimeline; result: ActionResult }> {
  const refuse = (message: string) => ({ timeline, result: { ok: false, message } })
  const done = (next: AgentTimeline, message: string, pieceId?: string) => ({ timeline: next, result: { ok: true, message, ...(pieceId ? { pieceId } : {}) } })

  switch (action.type) {
    case "set_direction":
      return done({ ...timeline, direction: action.text }, "ตั้งแนวทางตกแต่งแล้ว")

    case "ask_user":
      return done(timeline, `ถามผู้ใช้: ${action.question}`)

    case "add_text": {
      const made = textGroup(clip, timeline, action.fromWord, action.toWord, action.lines, action.tone)
      if (!made.ok) return refuse(made.why)
      const clash = textClash(timeline, made.group)
      if (clash) return refuse(clash)
      const id = nextId(timeline, "highlight")
      const groups = [...(timeline.highlights?.groups ?? []), piece(id, "highlight", made.group, action.lines.join(" / "))].sort((a, b) => a.item.lines[0]!.startUs - b.item.lines[0]!.startUs)
      return done({ ...timeline, highlights: { look: timeline.highlights?.look ?? clip.highlight!.look, groups } }, `ใส่ข้อความ ${id} ที่ ${clock(made.group.lines[0]!.startUs)}`, id)
    }

    case "add_move": {
      const at = timeOf(clip, action.at)
      if (!at.ok) return refuse(at.why)
      const placed = placeMove(clip, timeline, at.atUs, action.poses)
      if (!placed.ok) return refuse(placed.why)
      const id = nextId(timeline, "move")
      const moves = [...timeline.moves, piece(id, "move", { cut: placed.cut, startUs: placed.startUs, poses: action.poses }, action.about)].sort((a, b) => a.item.cut - b.item.cut || a.item.startUs - b.item.startUs)
      return done({ ...timeline, moves }, `ใส่การเคลื่อนภาพ ${id} ที่ ${clock(at.atUs)}`, id)
    }

    case "add_graphic": {
      const atUs = secondsToUs(action.atS)
      const durationUs = secondsToUs(action.seconds)
      if (atUs < 0 || atUs + durationUs > clip.durationUs) return refuse(`กราฟิก ${clock(atUs)}–${clock(atUs + durationUs)} ต้องอยู่ในคลิป (ยาว ${clock(clip.durationUs)})`)
      const covers = graphicCovers(clip, timeline, atUs, durationUs, action.box)
      if (covers) return refuse(covers)
      const made = await makers.graphic({ atUs, durationUs, box: action.box, idea: action.idea, words: wordsIn(clip, atUs, durationUs), signal })
      if (!made.ok) return refuse(`ทำกราฟิกไม่สำเร็จ: ${made.why}`)
      const id = nextId(timeline, "graphic")
      return done(
        { ...timeline, graphics: byStart([...timeline.graphics, piece(id, "graphic", made.graphic, action.idea)]), binItems: [...timeline.binItems.filter((b) => b.id !== made.binItem.id), made.binItem] },
        `ใส่กราฟิก ${id} ที่ ${clock(atUs)}`,
        id,
      )
    }

    case "add_sound": {
      const atUs = secondsToUs(action.atS)
      if (atUs < 0 || atUs >= clip.durationUs) return refuse(`เวลา ${action.atS}s อยู่นอกคลิป`)
      if (action.pick) {
        const cue = makers.librarySound(action.pick, atUs, action.loudness)
        if (!cue.ok) return refuse(cue.why)
        const id = nextId(timeline, "sound")
        return done({ ...timeline, sounds: byStart([...timeline.sounds, piece(id, "sound", cue.cue, action.pick)]) }, `ใส่เสียง ${id} "${action.pick}" ที่ ${clock(atUs)}`, id)
      }
      const made = await makers.composeSound({ atUs, seconds: action.seconds, role: action.role!, loudness: action.loudness, signal })
      if (!made.ok) return refuse(`แต่งเสียงไม่สำเร็จ: ${made.why}`)
      const id = nextId(timeline, "composed")
      return done(
        { ...timeline, composed: byStart([...timeline.composed, piece(id, "composed", made.sound, action.role!)]), binItems: [...timeline.binItems.filter((b) => b.id !== made.binItem.id), made.binItem] },
        `แต่งเสียง ${id} ที่ ${clock(atUs)}`,
        id,
      )
    }

    case "remove_piece": {
      const found = allPieces(timeline).find((p) => p.id === action.id)
      if (!found) return refuse(`ไม่มีชิ้น ${action.id}`)
      if (found.locked) return refuse(`${action.id} ล็อกไว้ ต้องขอผู้ใช้`)
      if (found.kind === "cut") return refuse("ชิ้นของตัดหยาบลบในโหมดนี้ไม่ได้")
      return done(withoutPiece(timeline, action.id), `ลบ ${action.id} แล้ว`)
    }

    case "edit_piece":
      return editPiece(timeline, action.id, action.changes, clip, makers, signal)

    case "look":
      // a look changes nothing: the agent's loop draws it (agent.ts)
      return done(timeline, "ดูภาพ")
  }
}

/** An edit: the piece taken out and put back changed, through the same checks and making as a new one, under the same id. */
async function editPiece(timeline: AgentTimeline, id: string, changes: Partial<Omit<RawAction, "type" | "id">>, clip: AgentClip, makers: AgentMakers, signal?: AbortSignal): Promise<{ timeline: AgentTimeline; result: ActionResult }> {
  const refuse = (message: string) => ({ timeline, result: { ok: false, message } })
  const found = allPieces(timeline).find((p) => p.id === id)
  if (!found) return refuse(`ไม่มีชิ้น ${id}`)
  if (found.locked) return refuse(`${id} ล็อกไว้ ต้องขอผู้ใช้`)
  const kind = found.kind as Kinds
  const rest = withoutPiece(timeline, id)
  const keep = <K extends string, T>(p: Piece<K, T>, item: T, note: string): Piece<K, T> => ({ ...p, item, note, by: p.by === "pipeline" ? "claude" : p.by })
  const ok = (next: AgentTimeline) => ({ timeline: next, result: { ok: true, message: `แก้ ${id} แล้ว`, pieceId: id } })

  if (kind === "caption" && changes.text) {
    const p = found as AgentTimeline["captions"][number]
    return ok({ ...timeline, captions: timeline.captions.map((c) => (c.id === id ? keep(p, { ...p.item, text: changes.text! }, changes.text!) : c)) })
  }
  if (kind === "highlight") {
    const p = found as NonNullable<AgentTimeline["highlights"]>["groups"][number]
    const wordAt = (us: number) => Math.max(1, clip.words.findIndex((w) => w.atUs >= us) + 1)
    const fromWord = changes.fromWord ?? wordAt(p.item.lines[0]!.startUs)
    const toWord = changes.toWord ?? Math.max(fromWord, clip.words.findLastIndex((w) => w.endUs <= p.item.endUs) + 1)
    const lines = changes.lines ?? p.item.lines.map((line) => line.text)
    const made = textGroup(clip, rest, fromWord, toWord, lines, changes.tone ?? (p.item.lines[0]?.tone as "base" | "accent" | "alt" | undefined) ?? null)
    if (!made.ok) return refuse(made.why)
    const clash = textClash(rest, made.group)
    if (clash) return refuse(clash)
    const groups = [...(rest.highlights?.groups ?? []), keep(p, made.group, lines.join(" / "))].sort((a, b) => a.item.lines[0]!.startUs - b.item.lines[0]!.startUs)
    return ok({ ...rest, highlights: { look: timeline.highlights!.look, groups } })
  }
  if (kind === "move") {
    const p = found as AgentTimeline["moves"][number]
    const atUs = changes.atWord != null ? clip.words[changes.atWord - 1]?.atUs : changes.atS != null ? secondsToUs(changes.atS) : clip.cuts[p.item.cut]!.startUs + p.item.startUs
    if (atUs === undefined) return refuse(`ไม่มีคำที่ w${changes.atWord}`)
    const poses = (changes.poses as Pose[] | null | undefined) ?? p.item.poses
    const placed = placeMove(clip, rest, atUs, poses)
    if (!placed.ok) return refuse(placed.why)
    return ok({ ...rest, moves: [...rest.moves, keep(p, { cut: placed.cut, startUs: placed.startUs, poses }, changes.about ?? p.note)].sort((a, b) => a.item.cut - b.item.cut || a.item.startUs - b.item.startUs) })
  }
  if (kind === "graphic") {
    const p = found as AgentTimeline["graphics"][number]
    const atUs = changes.atS != null ? secondsToUs(changes.atS) : p.item.atUs
    const durationUs = changes.seconds != null ? secondsToUs(changes.seconds) : p.item.durationUs
    if (atUs < 0 || atUs + durationUs > clip.durationUs) return refuse(`กราฟิกต้องอยู่ในคลิป (ยาว ${clock(clip.durationUs)})`)
    const box = (changes.box as [number, number, number, number] | null | undefined) ?? boxOfGraphic(p.item, clip.canvas)
    const covers = graphicCovers(clip, rest, atUs, durationUs, box)
    if (covers) return refuse(covers)
    // a new idea, box or length is a new graphic, written and rendered again; a new time only moves it
    if (changes.idea || changes.box || changes.seconds != null) {
      if (!changes.box) return refuse("แก้ idea หรือความยาวของกราฟิกต้องส่ง box มาด้วย")
      const idea = changes.idea ?? p.note
      const made = await makers.graphic({ atUs, durationUs, box: changes.box as [number, number, number, number], idea, words: wordsIn(clip, atUs, durationUs), signal })
      if (!made.ok) return refuse(`ทำกราฟิกไม่สำเร็จ: ${made.why}`)
      return ok({ ...rest, graphics: byStart([...rest.graphics, keep(p, made.graphic, idea)]), binItems: [...rest.binItems.filter((b) => b.id !== made.binItem.id), made.binItem] })
    }
    return ok({ ...rest, graphics: byStart([...rest.graphics, keep(p, { ...p.item, atUs }, p.note)]), binItems: timeline.binItems })
  }
  if (kind === "sound" || kind === "composed") {
    const atUs = changes.atS != null ? secondsToUs(changes.atS) : (found.item as { atUs: number }).atUs
    if (atUs < 0 || atUs >= clip.durationUs) return refuse("เวลาอยู่นอกคลิป")
    if (kind === "composed" && changes.role) {
      const made = await makers.composeSound({ atUs, seconds: changes.seconds ?? 1, role: changes.role, loudness: changes.loudness ?? "normal", signal })
      if (!made.ok) return refuse(`แต่งเสียงไม่สำเร็จ: ${made.why}`)
      const p = found as AgentTimeline["composed"][number]
      return ok({ ...rest, composed: byStart([...rest.composed, keep(p, made.sound, changes.role)]), binItems: [...rest.binItems.filter((b) => b.id !== made.binItem.id), made.binItem] })
    }
    if (kind === "composed") {
      const p = found as AgentTimeline["composed"][number]
      return ok({ ...rest, composed: byStart([...rest.composed, keep(p, { ...p.item, atUs }, p.note)]), binItems: timeline.binItems })
    }
    const p = found as AgentTimeline["sounds"][number]
    return ok({ ...rest, sounds: byStart([...rest.sounds, keep(p, { ...p.item, atUs }, p.note)]) })
  }
  return refuse(`แก้ชิ้นชนิด ${kind} ในโหมดนี้ยังไม่ได้ หรือไม่ได้บอก field ที่แก้ได้`)
}
