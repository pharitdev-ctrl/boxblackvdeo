import { actionLabel, AGENT_PROMPT, agentRequest, AgentReplySchema, parseAction, SUMMARY_REQUEST, type AgentFootage, type AgentReply, type AgentTurn } from "@boxblack/core/agent"
import type { LlmTransport, LlmUsage, SystemPrompt } from "@boxblack/core/llm/types"
import { describeTimeline, type AgentTimeline } from "@boxblack/core/timeline"
import { runAction, type AgentClip, type AgentMakers } from "./agent-actions.ts"
import { ProjectFiles } from "./project-files.ts"

/** The most rounds Claude works for one message of the user's before it sums up and asks whether to go on (spec §5.1). */
export const ROUNDS_PER_MESSAGE = 25

/** One project's conversation with Claude and the timeline it works on. */
export interface AgentSession {
  folder: string
  timeline: AgentTimeline
  turns: AgentTurn[]
  usage: LlmUsage
  /** the model whose prices the cost is counted at */
  model: string
  updatedAt: number
}

export class AgentStore extends ProjectFiles<AgentSession> {}

/** One piece as the tab lists it. */
export interface AgentPieceView {
  id: string
  kind: string
  startUs: number
  endUs: number
  label: string
  by: "pipeline" | "claude" | "user"
  locked: boolean
}

export interface AgentView {
  folder: string
  turns: AgentTurn[]
  running: boolean
  /** the round under way or last run for the latest message, and how many it may have */
  round: number
  rounds: number
  usage: LlmUsage
  costUsd: number
  direction: string
  pieces: AgentPieceView[]
  /** set when the last message used all its rounds: the tab offers "ทำต่อ" */
  summed: boolean
}

/** $ per million tokens: input, output, cache read, cache write (1.25 × input). */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-opus-5": [5, 25, 0.5, 6.25],
  "claude-sonnet-5": [2, 10, 0.2, 2.5],
}

export function costOf(usage: LlmUsage, model: string): number {
  const [input, output, read, write] = PRICES[model] ?? PRICES["claude-opus-5-5"]!
  return (usage.inputTokens * input + usage.outputTokens * output + usage.cacheReadTokens * read + usage.cacheWriteTokens * write) / 1_000_000
}

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const plus = (a: LlmUsage, b: LlmUsage): LlmUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
})

/** The timeline's pieces as the tab lists them, in time order (the rough cut's pieces are not listed). */
export function piecesOf(timeline: AgentTimeline): AgentPieceView[] {
  const starts: number[] = []
  let at = 0
  for (const cut of timeline.cuts) {
    starts.push(at)
    at += cut.item.sourceDurationUs
  }
  const view = (p: { id: string; kind: string; by: AgentPieceView["by"]; locked: boolean; note: string }, startUs: number, endUs: number, label: string): AgentPieceView => ({ id: p.id, kind: p.kind, startUs, endUs, label: p.note || label, by: p.by, locked: p.locked })
  return [
    ...timeline.captions.map((p) => view(p, p.item.startUs, p.item.endUs, p.item.text)),
    ...(timeline.highlights?.groups ?? []).map((p) => view(p, p.item.lines[0]?.startUs ?? 0, p.item.endUs, p.item.lines.map((l) => l.text).join(" / "))),
    ...timeline.moves.map((p) => {
      const startUs = (starts[p.item.cut] ?? 0) + p.item.startUs
      return view(p, startUs, startUs + (p.item.poses.at(-1)?.s ?? 0) * 1_000_000, "การเคลื่อนภาพ")
    }),
    ...timeline.zooms.map((p) => view(p, (starts[p.item.cut] ?? 0) + p.item.atUs, (starts[p.item.cut] ?? 0) + p.item.atUs + p.item.durationUs, `ซูม ${p.item.kind}`)),
    ...timeline.inserts.map((p) => view(p, p.item.atUs, p.item.atUs + p.item.durationUs, p.item.name)),
    ...timeline.graphics.map((p) => view(p, p.item.atUs, p.item.atUs + p.item.durationUs, p.item.name)),
    ...timeline.composed.map((p) => view(p, p.item.atUs, p.item.atUs + p.item.durationUs, "เสียงที่แต่ง")),
    ...timeline.sounds.map((p) => view(p, p.item.atUs, p.item.atUs + p.item.durationUs, p.item.name)),
  ].sort((a, b) => a.startUs - b.startUs)
}

export interface AgentDeps {
  store: Pick<AgentStore, "get" | "put">
  /** the editing Claude chosen in settings */
  llm: () => Promise<{ transport: LlmTransport; model: string }>
  /** what stays the same through a session: the outline, the words, the sound names */
  footage: (folder: string) => Promise<AgentFootage>
  /** the clip as the actions need it */
  clip: (folder: string) => Promise<AgentClip>
  makers: (folder: string) => AgentMakers
  prompt?: () => Promise<SystemPrompt | undefined>
  send?: (view: AgentView) => void
  now?: () => number
}

/**
 * The agent editor's sessions, one per project. A message from the user starts rounds: Claude is asked with the
 * footage, the conversation and the timeline as it is, answers what to say and which actions to take, the app
 * carries them out and adds the results to the conversation, until Claude is done, asks the user something, is
 * stopped, or has used ROUNDS_PER_MESSAGE rounds, when it is asked once more, with no actions, to sum up.
 */
export function createAgentService(deps: AgentDeps) {
  const running = new Map<string, AbortController>()
  const progress = new Map<string, { round: number; summed: boolean }>()
  const now = deps.now ?? Date.now

  const viewOf = (session: AgentSession): AgentView => ({
    folder: session.folder,
    turns: session.turns,
    running: running.has(session.folder),
    round: progress.get(session.folder)?.round ?? 0,
    rounds: ROUNDS_PER_MESSAGE,
    usage: session.usage,
    costUsd: costOf(session.usage, session.model),
    direction: session.timeline.direction,
    pieces: piecesOf(session.timeline),
    summed: progress.get(session.folder)?.summed ?? false,
  })

  async function save(session: AgentSession): Promise<AgentSession> {
    const saved = { ...session, updatedAt: now() }
    await deps.store.put(saved)
    deps.send?.(viewOf(saved))
    return saved
  }

  /** The timeline with one piece locked or unlocked. */
  function withLock(t: AgentTimeline, id: string, locked: boolean): AgentTimeline {
    const mark = <T extends { id: string; locked: boolean }>(list: T[]) => list.map((p) => (p.id === id ? { ...p, locked } : p))
    return { ...t, captions: mark(t.captions), highlights: t.highlights && { ...t.highlights, groups: mark(t.highlights.groups) }, moves: mark(t.moves), zooms: mark(t.zooms), inserts: mark(t.inserts), graphics: mark(t.graphics), composed: mark(t.composed), sounds: mark(t.sounds) }
  }

  async function existing(folder: string): Promise<AgentSession> {
    const session = await deps.store.get(folder)
    if (!session) throw new Error("no conversation with Claude has been started on this project")
    return session
  }

  async function ask(transport: LlmTransport, model: string, system: string, session: AgentSession, footage: AgentFootage, askText: string, signal: AbortSignal): Promise<{ reply: AgentReply; usage: LlmUsage }> {
    const answer = await transport.generate({
      model,
      system,
      content: agentRequest({ footage, turns: session.turns, timeline: describeTimeline(session.timeline), ask: askText }),
      schema: AgentReplySchema,
      maxTokens: 16_000,
      signal,
    })
    return { reply: answer.output, usage: answer.usage }
  }

  return {
    /** The project's session, started from `start` (the pipeline's timeline) when it has none. */
    async open(folder: string, start: () => Promise<AgentTimeline>): Promise<AgentView> {
      const found = await deps.store.get(folder)
      if (found) return viewOf(found)
      const { model } = await deps.llm()
      return viewOf(await save({ folder, timeline: await start(), turns: [], usage: NO_USAGE, model, updatedAt: now() }))
    },

    /** Starts the project's session again from the pipeline's timeline: the conversation and Claude's pieces go. */
    async reset(folder: string, start: () => Promise<AgentTimeline>): Promise<AgentView> {
      if (running.has(folder)) throw new Error("Claude is working on this project; stop it first")
      const { model } = await deps.llm()
      progress.delete(folder)
      return viewOf(await save({ folder, timeline: await start(), turns: [], usage: NO_USAGE, model, updatedAt: now() }))
    },

    async view(folder: string): Promise<AgentView | null> {
      const found = await deps.store.get(folder)
      return found && viewOf(found)
    },

    /** The session's timeline, for writing it. */
    async timeline(folder: string): Promise<AgentTimeline> {
      return (await existing(folder)).timeline
    },

    /** The user locks or unlocks a piece: a locked one Claude leaves alone. */
    async lock(folder: string, id: string, locked: boolean): Promise<AgentView> {
      if (running.has(folder)) throw new Error("Claude is working on this project; stop it first")
      const session = await existing(folder)
      return viewOf(await save({ ...session, timeline: withLock(session.timeline, id, locked) }))
    },

    /** The user removes a piece, locked or not; Claude hears of it in the next request's timeline. */
    async remove(folder: string, id: string): Promise<AgentView> {
      if (running.has(folder)) throw new Error("Claude is working on this project; stop it first")
      const session = await existing(folder)
      // the user may remove what they locked themselves
      const { timeline, result } = await runAction(withLock(session.timeline, id, false), { type: "remove_piece", id }, await deps.clip(folder), deps.makers(folder))
      if (!result.ok) throw new Error(result.message)
      return viewOf(await save({ ...session, timeline, turns: [...session.turns, { role: "results", lines: [`ผู้ใช้ลบ ${id}`] }] }))
    },

    stop(folder: string): void {
      running.get(folder)?.abort(new Error("stopped"))
    },

    /** A message from the user, and the rounds it starts. Answers the session's view once the rounds are over. */
    async send(folder: string, text: string): Promise<AgentView> {
      if (running.has(folder)) throw new Error("Claude is already working on this project")
      const message = text.trim()
      if (!message) throw new Error("the message is empty")
      const controller = new AbortController()
      running.set(folder, controller)
      progress.set(folder, { round: 0, summed: false })
      let session = await existing(folder)
      try {
        const [{ transport, model }, footage, clip, prompt] = await Promise.all([deps.llm(), deps.footage(folder), deps.clip(folder), deps.prompt?.()])
        const system = (prompt ?? AGENT_PROMPT).system
        const makers = deps.makers(folder)
        session = await save({ ...session, model, turns: [...session.turns, { role: "user", text: message }] })
        let finished = false
        let badReplies = 0
        for (let round = 1; round <= ROUNDS_PER_MESSAGE && !controller.signal.aborted; round++) {
          progress.set(folder, { round, summed: false })
          let answer: { reply: AgentReply; usage: LlmUsage }
          try {
            answer = await ask(transport, model, system, session, footage, round === 1 ? "ทำตามข้อความล่าสุดของผู้ใช้" : "ทำงานต่อจากผลของคำสั่งรอบที่แล้ว", controller.signal)
          } catch (error) {
            if (controller.signal.aborted) break
            // a reply that does not fit the format is told once what was wrong; the second time the round ends
            if (++badReplies > 1 || !/schema|JSON|format|valid/i.test((error as Error).message)) throw error
            session = await save({ ...session, turns: [...session.turns, { role: "results", lines: [`คำตอบรอบที่แล้วผิดรูปแบบ: ${(error as Error).message.slice(0, 300)}`] }] })
            continue
          }
          const { reply } = answer
          session = await save({ ...session, usage: plus(session.usage, answer.usage), turns: [...session.turns, { role: "claude", say: reply.say, actions: reply.actions.map(actionLabel) }] })

          const lines: string[] = []
          let asked = false
          let timeline = session.timeline
          for (const raw of reply.actions) {
            if (controller.signal.aborted) break
            const parsed = parseAction(raw)
            if (!parsed.ok) {
              lines.push(`✗ ${raw.type}: ${parsed.problem}`)
              continue
            }
            const ran = await runAction(timeline, parsed.action, clip, makers, controller.signal).catch((error: Error) => ({ timeline, result: { ok: false, message: error.message } }))
            timeline = ran.timeline
            lines.push(`${ran.result.ok ? "✓" : "✗"} ${raw.type}: ${ran.result.message}`)
            if (parsed.action.type === "ask_user") asked = true
            session = await save({ ...session, timeline })
          }
          if (lines.length > 0) session = await save({ ...session, turns: [...session.turns, { role: "results", lines }] })
          if (reply.done || asked) {
            finished = true
            break
          }
        }
        // all the rounds used: one more ask, with no actions, to sum up and ask whether to go on
        if (!finished && !controller.signal.aborted) {
          const { reply, usage } = await ask(transport, model, system, session, footage, SUMMARY_REQUEST, controller.signal)
          progress.set(folder, { round: ROUNDS_PER_MESSAGE, summed: true })
          session = await save({ ...session, usage: plus(session.usage, usage), turns: [...session.turns, { role: "claude", say: reply.say, actions: [] }] })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          session = await save({ ...session, turns: [...session.turns, { role: "results", lines: [`✗ หยุดเพราะเกิดข้อผิดพลาด: ${(error as Error).message}`] }] })
        }
      } finally {
        running.delete(folder)
        if (controller.signal.aborted) session = { ...session, turns: [...session.turns, { role: "results", lines: ["ผู้ใช้หยุดการทำงาน"] }] }
        session = await save(session)
      }
      return viewOf(session)
    },
  }
}

export type AgentService = ReturnType<typeof createAgentService>
