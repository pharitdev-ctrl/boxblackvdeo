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
  expect(clip.cuts.every((cut) => cut.cap >= 1)).toBe(true)
  // no fonts handed over: highlight text cannot be drawn, and the actions say so
  expect(clip.highlight).toBeNull()

  const timeline = await start()
  expect(timeline.cuts).toHaveLength(plan.cuts.length)
})
