import { expect, test } from "vitest"
import { SUMMARY_REQUEST, type AgentFootage } from "@boxblack/core/agent"
import type { HighlightLook } from "@boxblack/core/capcut"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm/types"
import { pipelinePieces, TIMELINE_VERSION, type AgentTimeline } from "@boxblack/core/timeline"
import type { AgentClip, AgentMakers } from "./agent-actions.ts"
import { costOf, createAgentService, ROUNDS_PER_MESSAGE, type AgentSession, type AgentView } from "./agent.ts"

const s = (seconds: number) => Math.round(seconds * 1_000_000)
const FOLDER = "/drafts/1003"
const USAGE = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 500, cacheWriteTokens: 0 }

const clip: AgentClip = {
  canvas: { width: 1080, height: 1920 },
  durationUs: s(10),
  words: ["สวัสดี", "ครับ", "วันนี้", "ราคา", "ห้า", "บาท"].map((text, i) => ({ text, atUs: s(i * 1.5), endUs: s(i * 1.5 + 1) })),
  cuts: [{ startUs: 0, durationUs: s(10), cap: 1.3, faces: null, shown: [] }],
  highlight: { font: "mali", look: { fontPath: "/f.ttf", strokeWidth: 0.08, barRoundness: 50, palette: {}, animation: null } as unknown as HighlightLook, subtitlesOn: false },
}
const footage: AgentFootage = { title: "t", summary: "", beats: [], words: clip.words, sounds: [], brief: { videoType: null, instructions: "" } }
const makers: AgentMakers = {
  graphic: async () => ({ ok: false, why: "no renderer" }),
  composeSound: async () => ({ ok: false, why: "no renderer" }),
  librarySound: () => ({ ok: false, why: "none" }),
}
const start = async (): Promise<AgentTimeline> => ({
  version: TIMELINE_VERSION,
  direction: "",
  canvas: clip.canvas,
  durationUs: clip.durationUs,
  cuts: pipelinePieces("cut", [{ binId: "v", sourceStartUs: 0, sourceDurationUs: s(10) }]),
  subtitles: false,
  captions: [],
  highlights: null,
  moves: [],
  zooms: [],
  inserts: [],
  graphics: [],
  composed: [],
  sounds: [],
  binItems: [],
})

/** Claude, answering the replies it is given in order (the last one again when they run out), or `respond`. */
function fakeClaude(replies: unknown[], respond?: (request: LlmRequest<unknown>) => Promise<unknown>) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const raw = respond ? await respond(request as LlmRequest<unknown>) : replies[Math.min(requests.length - 1, replies.length - 1)]
      return { output: request.schema.parse(raw) as T, usage: USAGE }
    },
  }
  return { transport, requests }
}

function setup(claude: ReturnType<typeof fakeClaude>) {
  const files = new Map<string, AgentSession>()
  const views: AgentView[] = []
  const service = createAgentService({
    store: { get: async (folder) => files.get(folder) ?? null, put: async (session) => void files.set(session.folder, structuredClone(session)) },
    llm: async () => ({ transport: claude.transport, model: "claude-opus-5-5" }),
    footage: async () => footage,
    clip: async () => clip,
    makers: () => makers,
    send: (view) => views.push(view),
    now: () => 0,
  })
  return { service, views, files }
}

const textOf = (content: LlmContent[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n")

test("a message runs rounds until Claude is done: actions are carried out, results go back, usage adds up", async () => {
  const claude = fakeClaude([
    { say: "ใส่ราคา", done: false, actions: [{ type: "add_text", fromWord: 4, toWord: 6, lines: ["ราคา 5 บาท"] }, { type: "add_text", fromWord: 9, toWord: 9, lines: ["x"] }] },
    { say: "เสร็จแล้ว", done: true, actions: [] },
  ])
  const { service, views } = setup(claude)
  await service.open(FOLDER, start)
  const view = await service.send(FOLDER, "ใส่ป้ายราคา")

  expect(claude.requests).toHaveLength(2)
  expect(view.running).toBe(false)
  expect(view.pieces.map((p) => [p.id, p.by, p.label])).toEqual([["highlight-1", "claude", "ราคา 5 บาท"]])
  expect(view.turns.map((turn) => turn.role)).toEqual(["user", "claude", "results", "claude"])
  expect(view.turns[2]).toEqual({ role: "results", lines: ["✓ add_text: ใส่ข้อความ highlight-1 ที่ 4.50s", "✗ add_text: ไม่มีคำที่ w9 (มี 6 คำ)"] })
  // the refusal and the new piece reach Claude's next request
  const second = textOf(claude.requests[1]!.content)
  expect(second).toContain("✗ add_text: ไม่มีคำที่ w9")
  expect(second).toContain("highlight-1")
  expect(view.usage).toEqual({ inputTokens: 2000, outputTokens: 400, cacheReadTokens: 1000, cacheWriteTokens: 0 })
  expect(view.costUsd).toBeCloseTo(costOf(view.usage, "claude-opus-5-5"))
  expect(views.some((v) => v.running)).toBe(true)
})

test("after the rounds of one message run out, Claude sums up with no actions, and the tab offers to go on", async () => {
  const claude = fakeClaude([], async (request) =>
    textOf(request.content).includes(SUMMARY_REQUEST)
      ? { say: "ทำไปแล้วครึ่งคลิป ทำต่อไหม", done: true, actions: [{ type: "set_direction", text: "ห้ามทำ" }] }
      : { say: "", done: false, actions: [] },
  )
  const { service } = setup(claude)
  await service.open(FOLDER, start)
  const view = await service.send(FOLDER, "ทำทั้งคลิป")
  expect(claude.requests).toHaveLength(ROUNDS_PER_MESSAGE + 1)
  expect(view.summed).toBe(true)
  expect(view.turns.at(-1)).toEqual({ role: "claude", say: "ทำไปแล้วครึ่งคลิป ทำต่อไหม", actions: [] })
  // the summary's actions are not carried out
  expect(view.direction).toBe("")
})

test("a question to the user ends the rounds; stopping ends them at once", async () => {
  const asking = fakeClaude([{ say: "", done: false, actions: [{ type: "ask_user", text: "สีชมพูไหม" }] }])
  const a = setup(asking)
  await a.service.open(FOLDER, start)
  await a.service.send(FOLDER, "ใส่กราฟิก")
  expect(asking.requests).toHaveLength(1)

  let release: () => void = () => {}
  const waiting = fakeClaude([], (request) => new Promise((_, reject) => {
    request.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    release()
  }))
  const b = setup(waiting)
  await b.service.open(FOLDER, start)
  const started = new Promise<void>((resolve) => (release = resolve))
  const sent = b.service.send(FOLDER, "ทำเลย")
  await started
  await expect(b.service.send(FOLDER, "อีก")).rejects.toThrow(/already working/)
  b.service.stop(FOLDER)
  const view = await sent
  expect(view.running).toBe(false)
  expect(view.turns.at(-1)).toEqual({ role: "results", lines: ["ผู้ใช้หยุดการทำงาน"] })
})

test("a reply that breaks the format is told once; an error ends the rounds with the reason", async () => {
  let n = 0
  const claude = fakeClaude([], async () => (++n === 1 ? { say: 1 } : { say: "ok", done: true, actions: [] }))
  const { service } = setup(claude)
  await service.open(FOLDER, start)
  const view = await service.send(FOLDER, "x")
  expect(claude.requests).toHaveLength(2)
  expect(view.turns.map((t) => t.role)).toEqual(["user", "results", "claude"])

  const failing = fakeClaude([], async () => {
    throw new Error("Claude Code failed: overloaded")
  })
  const f = setup(failing)
  await f.service.open(FOLDER, start)
  const failed = await f.service.send(FOLDER, "x")
  expect(failed.turns.at(-1)).toEqual({ role: "results", lines: ["✗ หยุดเพราะเกิดข้อผิดพลาด: Claude Code failed: overloaded"] })
})

test("the user locks a piece Claude then cannot change, and may remove it; a reset starts from the pipeline again", async () => {
  const claude = fakeClaude([
    { say: "", done: true, actions: [{ type: "add_text", fromWord: 1, toWord: 2, lines: ["สวัสดี"] }] },
    { say: "", done: true, actions: [{ type: "remove_piece", id: "highlight-1" }] },
  ])
  const { service } = setup(claude)
  await service.open(FOLDER, start)
  await service.send(FOLDER, "ทักทาย")
  expect((await service.lock(FOLDER, "highlight-1", true)).pieces[0]!.locked).toBe(true)
  const refused = await service.send(FOLDER, "ลบข้อความ")
  expect(refused.turns.at(-1)).toEqual({ role: "results", lines: ["✗ remove_piece: highlight-1 ล็อกไว้ ต้องขอผู้ใช้"] })
  expect((await service.remove(FOLDER, "highlight-1")).pieces).toEqual([])
  const fresh = await service.reset(FOLDER, start)
  expect(fresh.turns).toEqual([])
})
