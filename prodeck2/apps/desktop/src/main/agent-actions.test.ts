import { expect, test } from "vitest"
import { AgentReplySchema, parseAction, type Action, type RawAction } from "@boxblack/core/agent"
import type { HighlightLook } from "@boxblack/core/capcut"
import { pipelinePieces, TIMELINE_VERSION, type AgentTimeline } from "@boxblack/core/timeline"
import { runAction, type AgentClip, type AgentMakers } from "./agent-actions.ts"

const s = (seconds: number) => Math.round(seconds * 1_000_000)
const seen: { cut: number; startUs: number; others: number }[] = []

const clip: AgentClip = {
  canvas: { width: 1080, height: 1920 },
  durationUs: s(10),
  words: ["สวัสดี", "ครับ", "วันนี้", "ราคา", "ห้า", "บาท"].map((text, i) => ({ text, atUs: s(i * 1.5), endUs: s(i * 1.5 + 1) })),
  cuts: [
    { startUs: 0, durationUs: s(5) },
    { startUs: s(5), durationUs: s(5) },
  ],
  // a face in the middle of the frame for the first 5 s; a move is refused past 130% (the cap), and is told the moves beside it
  room: {
    moveWhy: (cut, startUs, poses, others) => {
      seen.push({ cut, startUs, others: others.length })
      return Math.max(...poses.map((pose) => pose.scale)) > 1.3 ? "past the zoom cap" : null
    },
    keepIn: (span) => (span.startUs < s(5) ? [{ x0: 0.3, y0: 0.4, x1: 0.7, y1: 0.6 }] : []),
  },
  highlight: { font: "mali", look: { fontPath: "/fonts/Mali-Bold.ttf", strokeWidth: 0.08, barRoundness: 50, palette: {}, animation: null } as unknown as HighlightLook, subtitlesOn: true },
}

function timeline(extra: Partial<AgentTimeline> = {}): AgentTimeline {
  return {
    version: TIMELINE_VERSION,
    direction: "",
    canvas: clip.canvas,
    durationUs: clip.durationUs,
    cuts: pipelinePieces("cut", [
      { binId: "v", sourceStartUs: 0, sourceDurationUs: s(5) },
      { binId: "v", sourceStartUs: s(8), sourceDurationUs: s(5) },
    ]),
    subtitles: true,
    captions: [],
    highlights: null,
    moves: [],
    zooms: [],
    inserts: [],
    graphics: [],
    composed: [],
    sounds: [],
    binItems: [],
    ...extra,
  }
}

const calls: string[] = []
const makers: AgentMakers = {
  async graphic({ atUs, durationUs, box, idea, words }) {
    calls.push(`graphic ${idea} ${words.map((w) => w.text).join(" ")}`)
    if (idea.includes("พัง")) return { ok: false, why: "render failed" }
    return {
      ok: true,
      // rendered at the box's own pixels, drawn where the box is
      graphic: { atUs, durationUs, binId: `bin-${idea}`, path: `/g/${idea}.mov`, name: `${idea}.mov`, width: (box[2] - box[0]) * 1080, height: (box[3] - box[1]) * 1920, durationOfFileUs: durationUs, place: { scale: 1, x: (box[0] + box[2] - 1), y: 1 - (box[1] + box[3]) } },
      binItem: { id: `bin-${idea}` } as never,
    }
  },
  async composeSound({ atUs, seconds, role }) {
    calls.push(`compose ${role}`)
    return { ok: true, sound: { atUs, durationUs: s(seconds), path: "/s/a.wav", binId: "bin-s" }, binItem: { id: "bin-s" } as never }
  },
  librarySound(name, atUs) {
    return name === "ติ๊ง" ? { ok: true, cue: { atUs, effectId: "e1", name, path: null, durationUs: s(0.4) } } : { ok: false, why: `ไม่มีเสียง "${name}" ในคลัง` }
  },
}

const action = (fields: Partial<RawAction> & Pick<RawAction, "type">): Action => {
  const parsed = parseAction(AgentReplySchema.parse({ actions: [fields], done: false }).actions[0]!)
  if (!parsed.ok) throw new Error(parsed.problem)
  return parsed.action
}

const pose = (t: number, scale: number) => ({ s: t, scale, x: 0, y: 0, rot: 0, ease: "line" as const })

test("text goes on the words it names, laid out in the project's style, by Claude, and may not play over other text", async () => {
  const first = await runAction(timeline(), action({ type: "add_text", fromWord: 4, toWord: 6, lines: ["ราคา", "5 บาท"], tone: "accent" }), clip, makers)
  expect(first.result).toEqual({ ok: true, message: "ใส่ข้อความ highlight-1 ที่ 4.50s", pieceId: "highlight-1" })
  const group = first.timeline.highlights!.groups[0]!
  expect(group).toMatchObject({ by: "claude", locked: false, note: "ราคา / 5 บาท" })
  expect(group.item.lines.map((line) => [line.startUs, line.text, line.tone])).toEqual([
    [s(4.5), "ราคา", "accent"],
    [s(6), "5 บาท", "accent"],
  ])
  expect(group.item.endUs).toBe(s(8.8))
  expect(first.timeline.highlights!.look).toBe(clip.highlight!.look)

  const clash = await runAction(first.timeline, action({ type: "add_text", fromWord: 5, toWord: 5, lines: ["ห้า"] }), clip, makers)
  expect(clash.result.ok).toBe(false)
  expect(clash.result.message).toContain("ซ้อนเวลากับข้อความ highlight-1")
  expect(clash.timeline).toBe(first.timeline)
  expect((await runAction(timeline(), action({ type: "add_text", fromWord: 9, toWord: 9, lines: ["x"] }), clip, makers)).result.message).toBe("ไม่มีคำที่ w9 (มี 6 คำ)")
})

test("a move lands on the piece it starts in, passes the move checks, and keeps off another move on that piece", async () => {
  const moved = await runAction(timeline(), action({ type: "add_move", atS: 6, poses: [pose(0, 1), pose(0.5, 1.15)], about: "ดันเข้า" }), clip, makers)
  expect(moved.result.ok).toBe(true)
  expect(moved.timeline.moves[0]!.item).toEqual({ cut: 1, startUs: s(1), poses: [pose(0, 1), pose(0.5, 1.15)] })
  // past the zoom cap for the piece
  const tooFar = await runAction(timeline(), action({ type: "add_move", atS: 6, poses: [pose(0, 1), pose(0.5, 1.6)] }), clip, makers)
  expect(tooFar.result).toMatchObject({ ok: false })
  expect(tooFar.result.message).toMatch(/^การเคลื่อนภาพไม่ผ่าน/)
  const clash = await runAction(moved.timeline, action({ type: "add_move", atWord: 5, poses: [pose(0, 1.1), pose(1, 1.2)] }), clip, makers)
  expect(clash.result.message).toContain("ซ้อนเวลากับการเคลื่อนภาพ move-1")
})

test("a graphic is made from its idea and the words said while it plays, and put in the bin; a failed one adds nothing", async () => {
  calls.length = 0
  const made = await runAction(timeline(), action({ type: "add_graphic", atS: 4.5, seconds: 3, box: [0.2, 0.05, 0.8, 0.3], idea: "ป้ายราคา" }), clip, makers)
  expect(calls).toEqual(["graphic ป้ายราคา ราคา ห้า"])
  expect(made.timeline.graphics.map((p) => [p.id, p.note, p.item.atUs])).toEqual([["graphic-1", "ป้ายราคา", s(4.5)]])
  expect(made.timeline.binItems.map((item) => item.id)).toEqual(["bin-ป้ายราคา"])
  const failed = await runAction(made.timeline, action({ type: "add_graphic", atS: 1, seconds: 1, box: [0, 0, 1, 0.2], idea: "พัง" }), clip, makers)
  expect(failed).toEqual({ timeline: made.timeline, result: { ok: false, message: "ทำกราฟิกไม่สำเร็จ: render failed" } })
  expect((await runAction(timeline(), action({ type: "add_graphic", atS: 9, seconds: 3, box: [0, 0, 1, 0.2], idea: "x" }), clip, makers)).result.ok).toBe(false)
})

test("a sound is picked from the library or composed", async () => {
  const picked = await runAction(timeline(), action({ type: "add_sound", atS: 4.5, pick: "ติ๊ง" }), clip, makers)
  expect(picked.timeline.sounds[0]).toMatchObject({ id: "sound-1", note: "ติ๊ง", item: { atUs: s(4.5), effectId: "e1" } })
  expect((await runAction(timeline(), action({ type: "add_sound", atS: 1, pick: "กลอง" }), clip, makers)).result.message).toBe('ไม่มีเสียง "กลอง" ในคลัง')
  const composed = await runAction(timeline(), action({ type: "add_sound", atS: 2, role: "เสียงเด้งตอนราคา", seconds: 0.8 }), clip, makers)
  expect(composed.timeline.composed[0]).toMatchObject({ id: "composed-1", note: "เสียงเด้งตอนราคา", item: { atUs: s(2), durationUs: s(0.8) } })
})

test("a locked piece is never changed or removed, the rough cut is not removed, and removing a graphic takes its bin entry", async () => {
  const graphic = await runAction(timeline(), action({ type: "add_graphic", atS: 1, seconds: 2, box: [0.2, 0.05, 0.8, 0.3], idea: "ดาว" }), clip, makers)
  const locked: AgentTimeline = { ...graphic.timeline, graphics: graphic.timeline.graphics.map((p) => ({ ...p, locked: true })) }
  expect((await runAction(locked, action({ type: "remove_piece", id: "graphic-1" }), clip, makers)).result.message).toBe("graphic-1 ล็อกไว้ ต้องขอผู้ใช้")
  expect((await runAction(locked, action({ type: "edit_piece", id: "graphic-1", atS: 2 }), clip, makers)).result.message).toBe("graphic-1 ล็อกไว้ ต้องขอผู้ใช้")
  expect((await runAction(locked, action({ type: "remove_piece", id: "cut-1" }), clip, makers)).result.ok).toBe(false)
  const removed = await runAction(graphic.timeline, action({ type: "remove_piece", id: "graphic-1" }), clip, makers)
  expect(removed.timeline.graphics).toEqual([])
  expect(removed.timeline.binItems).toEqual([])
})

test("an edit keeps the id: a graphic moved in time is not made again, a new idea is; a pipeline piece Claude edits becomes Claude's", async () => {
  calls.length = 0
  const base = timeline({ captions: pipelinePieces("caption", [{ startUs: 0, endUs: s(1), text: "สวัสดีครบ" }]) })
  const fixed = await runAction(base, action({ type: "edit_piece", id: "caption-1", text: "สวัสดีครับ" }), clip, makers)
  expect(fixed.timeline.captions[0]).toMatchObject({ id: "caption-1", by: "claude", item: { text: "สวัสดีครับ" } })

  const graphic = await runAction(base, action({ type: "add_graphic", atS: 1, seconds: 2, box: [0.2, 0.05, 0.8, 0.3], idea: "ดาว" }), clip, makers)
  const shifted = await runAction(graphic.timeline, action({ type: "edit_piece", id: "graphic-1", atS: 3 }), clip, makers)
  expect(shifted.timeline.graphics[0]).toMatchObject({ id: "graphic-1", item: { atUs: s(3), binId: "bin-ดาว" } })
  expect(calls).toEqual(["graphic ดาว ครับ"])
  const redone = await runAction(shifted.timeline, action({ type: "edit_piece", id: "graphic-1", idea: "ดาวใหญ่", box: [0.1, 0.05, 0.9, 0.35] }), clip, makers)
  expect(redone.timeline.graphics[0]).toMatchObject({ id: "graphic-1", note: "ดาวใหญ่", item: { binId: "bin-ดาวใหญ่" } })
  expect(redone.timeline.binItems.map((b) => b.id)).toEqual(["bin-ดาวใหญ่"])
})

test("the direction is set, and a question changes nothing", async () => {
  const directed = await runAction(timeline(), action({ type: "set_direction", text: "สดใส" }), clip, makers)
  expect(directed.timeline.direction).toBe("สดใส")
  const asked = await runAction(directed.timeline, action({ type: "ask_user", text: "เอาเสียงไหม" }), clip, makers)
  expect(asked).toEqual({ timeline: directed.timeline, result: { ok: true, message: "ถามผู้ใช้: เอาเสียงไหม" } })
})

test("what the picture shows is kept clear: text is laid off the face, a graphic over it longer than allowed is refused before it is made, a move is checked beside the others", async () => {
  // text while the face is on screen sits outside its band (y is in half-frames, up from the middle)
  const text = await runAction(timeline(), action({ type: "add_text", fromWord: 1, toWord: 2, lines: ["สวัสดี"] }), clip, makers)
  const share = 0.5 - text.timeline.highlights!.groups[0]!.item.lines[0]!.y / 2
  expect(share < 0.4 || share > 0.6).toBe(true)

  calls.length = 0
  const over = await runAction(timeline(), action({ type: "add_graphic", atS: 1, seconds: 3, box: [0.2, 0.35, 0.8, 0.55], idea: "ดาว" }), clip, makers)
  expect(over.result.ok).toBe(false)
  expect(over.result.message).toContain("ทับหน้าคนหรือของที่โชว์ที่ [0.3, 0.4, 0.7, 0.6]")
  expect(calls).toEqual([])
  // briefly over it is allowed, as "ทำทั้งหมด" allows; after 5 s nothing is there
  expect((await runAction(timeline(), action({ type: "add_graphic", atS: 1, seconds: 1.5, box: [0.2, 0.35, 0.8, 0.55], idea: "ดาว" }), clip, makers)).result.ok).toBe(true)
  const later = await runAction(timeline(), action({ type: "add_graphic", atS: 6, seconds: 3, box: [0.2, 0.35, 0.8, 0.55], idea: "ดาว" }), clip, makers)
  expect(later.result.ok).toBe(true)
  // moved in time onto the face, the same graphic is refused
  expect((await runAction(later.timeline, action({ type: "edit_piece", id: "graphic-1", atS: 1 }), clip, makers)).result.message).toContain("ทับหน้าคน")

  seen.length = 0
  const first = await runAction(timeline(), action({ type: "add_move", atS: 0.5, poses: [pose(0, 1), pose(0.5, 1.1)] }), clip, makers)
  await runAction(first.timeline, action({ type: "add_move", atS: 3, poses: [pose(0, 1.1), pose(0.5, 1.2)] }), clip, makers)
  expect(seen).toEqual([
    { cut: 0, startUs: s(0.5), others: 0 },
    { cut: 0, startUs: s(3), others: 1 },
  ])
})
