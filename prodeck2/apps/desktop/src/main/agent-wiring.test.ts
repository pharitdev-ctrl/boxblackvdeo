import { expect, test } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
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
