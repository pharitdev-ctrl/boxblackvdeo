import { expect, test } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { createAgentWiring } from "./agent-wiring.ts"
import { setup } from "./timeline-fixture.ts"

test("the agent reads the clip from the confirmed outline: the words on the rough cut's clock, the beats, and the pieces a move may go on", async () => {
  const { service, folder, deps } = await setup()
  const wiring = createAgentWiring({ timeline: service, outlines: deps.outlines, settings: deps.settings, llm: async () => Promise.reject(new Error("no Claude here")) })
  await expect(wiring.footage(folder)).rejects.toThrow(/open the conversation/)

  const start = wiring.remember(folder, { rules: DEFAULT_CUT_RULES, subtitles: null, highlights: null })
  const footage = await wiring.footage(folder)
  const plan = await service.preview(folder, DEFAULT_CUT_RULES)
  // the countdown said twice is cut back to its last take: the words the cut plays, in order, from the start of the clip
  expect(footage.words.map((word) => word.text)).toEqual(["ขึ้น", "ไป", "ใน", "อวกาศ", "ใน", "สาม", "สอง", "หนึ่ง"])
  expect(footage.words[0]!.atUs).toBeGreaterThanOrEqual(0)
  expect(footage.words.every((word, i) => i === 0 || word.atUs >= footage.words[i - 1]!.atUs)).toBe(true)
  expect(footage.beats).toEqual([{ name: "นับถอยหลัง", purpose: "ลุ้น", startUs: 0 }])
  expect(footage.title).toBe("นักบินอวกาศ")

  const clip = await wiring.clip(folder)
  expect(clip.cuts.map((cut) => cut.durationUs)).toEqual(plan.cuts.map((cut) => cut.sourceDurationUs))
  // no fonts handed over: highlight text cannot be drawn, and the actions say so
  expect(clip.highlight).toBeNull()

  const timeline = await start()
  expect(timeline.cuts).toHaveLength(plan.cuts.length)
  // nothing analysed: no scenes, nothing to keep clear, a gentle push passes
  expect(footage.scenes).toEqual([])
  expect(clip.room.keepIn({ startUs: 0, endUs: clip.durationUs }, [])).toEqual([])
})

test("the agent is told the scenes the prepare step saw, and its checks keep off the face there as \"ทำทั้งหมด\" does", async () => {
  const scene = { startUs: 0, endUs: 31_106_000, description: "นักบินพูดกับกล้อง", kind: "talking-head" as const, issues: [], keepClear: { fromY: 0.1, toY: 0.35 } }
  const { service, folder, deps } = await setup({ scenes: [scene] })
  const wiring = createAgentWiring({ timeline: service, outlines: deps.outlines, settings: deps.settings, llm: async () => Promise.reject(new Error("no Claude here")) })
  wiring.remember(folder, { rules: DEFAULT_CUT_RULES, subtitles: null, highlights: null })
  const footage = await wiring.footage(folder)
  expect(footage.scenes.map((s) => [s.startUs, s.description, s.keepClear])).toEqual([[0, "นักบินพูดกับกล้อง", { fromY: 0.1, toY: 0.35 }]])

  const clip = await wiring.clip(folder)
  // with no objects pass, the scene's keepClear band is what to keep clear, across the whole width
  const [band] = clip.room.keepIn({ startUs: 0, endUs: 1_000_000 }, [])
  expect([band!.x0, band!.y0, band!.x1, band!.y1].map((n) => Math.round(n * 1000) / 1000)).toEqual([0, 0.1, 1, 0.35])
  const pose = (s: number, scale: number, y = 0) => ({ s, scale, x: 0, y, rot: 0, ease: "line" as const })
  expect(clip.room.moveWhy(0, 0, [pose(0, 1), pose(0.5, 1.1)], [])).toBeNull()
  // pushed in and moved up, the face at the top goes out of frame
  expect(clip.room.moveWhy(0, 0, [pose(0, 1), pose(0.5, 1.3, 0.3)], [])).toMatch(/face/)
  // a push held to the piece's end moves the band where the text and graphics must keep off
  const pushed = clip.room.keepIn({ startUs: 0, endUs: 1_000_000 }, [{ cut: 0, startUs: 0, poses: [pose(0, 1), pose(0.5, 1.2)] }])
  expect(pushed[0]!.y0).toBeLessThan(0.1)
})

test("a graphic Claude asks for is rendered and inspected as \"ทำทั้งหมด\" does: one that fails goes back to its writer once, and the mended one is placed", async () => {
  const GOOD = '<style>.n{animation:up 1s both}@keyframes up{from{opacity:0}}</style><div class="n">5 บาท</div>'
  const MENDED = '<style>.m{animation:in 1s both}@keyframes in{from{opacity:0}}</style><div class="m">5 บาท</div>'
  const { service, folder, deps } = await setup()
  const asked: string[] = []
  const answers = [GOOD, MENDED]
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      asked.push(request.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n"))
      return { output: answers[asked.length - 1] as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  const rendered: string[] = []
  const wiring = createAgentWiring({
    timeline: service,
    outlines: deps.outlines,
    settings: deps.settings,
    llm: async () => ({ transport, model: "claude-opus-5-5" }),
    graphics: {
      hashOf: (job) => (job.spec as { html: string }).html,
      wait: async (jobs) => {
        const html = (jobs[0]!.spec as { html: string }).html
        rendered.push(html)
        return html === GOOD ? { ready: [], failed: [html] } : { ready: [html], failed: [] }
      },
      failureOf: () => "nothing was drawn: every frame is empty",
      rendered: async () => ({ hash: "h", path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/h.mov", width: 600, height: 300, durationUs: 1_500_000, place: { scale: 0.6, x: 0, y: 0.5 } }),
    },
  })
  wiring.remember(folder, { rules: DEFAULT_CUT_RULES, subtitles: null, highlights: null })
  const made = await wiring.makers(folder).graphic({ atUs: 1_000_000, durationUs: 1_500_000, box: [0.2, 0.1, 0.8, 0.3], idea: "ป้ายราคา 5 บาท", words: [] })
  expect(made).toMatchObject({ ok: true, graphic: { atUs: 1_000_000, path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/h.mov" } })
  // written, rendered and refused, written again with the render's problem, rendered and passed, then placed
  expect(asked).toHaveLength(2)
  expect(asked[1]).toContain("nothing was drawn: every frame is empty")
  expect(rendered).toEqual([GOOD, MENDED, MENDED])
})
