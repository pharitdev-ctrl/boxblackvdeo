import { expect, test } from "vitest"
import type { LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import { acceptSounds, describeSounds, planSounds, SOUNDS_PROMPT, SOUNDS_PROMPT_VERSION, type SoundSlot, type SoundsReply } from "./sound-plan.ts"

const BRIEF = { videoType: "review", targetSeconds: 30, instructions: "" } as const
const SOUNDS = [
  { effectId: "coin", name: "Coin", durationUs: 500_000, path: null, use: "เสียงเงิน" },
  { effectId: "whoosh", name: "Whoosh", durationUs: 1_000_000, path: null },
]
/** A line of text on a key point, and the user's own graphic, which names no point. */
const SLOTS: SoundSlot[] = [
  { anchor: { kind: "highlight", groupId: "g1", line: 0 }, atUs: 1_000_000, what: 'ข้อความเด่น "299" บรรทัด 1', beatId: "b1", pointId: "p1", importance: "key", type: "number" },
  { anchor: { kind: "speech", videoId: "v", sourceUs: 9_000_000, beatId: "b1" }, atUs: 3_500_000, what: "กราฟิกขึ้น: จรวดพุ่งขึ้นจากขอบล่าง", beatId: "b1", pointId: null, importance: null, type: null },
]

function fakeTransport(output: SoundsReply) {
  const calls: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      calls.push(request as LlmRequest<unknown>)
      return { output: output as T, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, calls }
}

test("one sound a slot, each carrying its slot's point; what names no slot or sound, or a slot already given one, is dropped and counted", () => {
  const reply: SoundsReply = {
    cues: [
      { at: 1, sound: 1 },
      { at: 1, sound: 2 },
      { at: 2, sound: 2 },
      { at: 3, sound: 1 },
      { at: 2, sound: 9 },
    ],
  }
  expect(acceptSounds(reply, SLOTS, SOUNDS)).toEqual({
    cues: [
      { anchor: SLOTS[0]!.anchor, effectId: "coin", edited: false, pointId: "p1" },
      // a slot no point is on gives its sound no point either
      { anchor: SLOTS[1]!.anchor, effectId: "whoosh", edited: false },
    ],
    dropped: 3,
  })
})

test("the request lists the sounds by what they are for, then every slot with its point's importance and type", () => {
  const lines = describeSounds({ brief: BRIEF, slots: SLOTS, sounds: SOUNDS }).split("\n")
  expect(lines).toContain("1. เสียงเงิน · Coin (0.5 วิ)")
  expect(lines).toContain("2. Whoosh (1.0 วิ)")
  expect(lines).toContain('[1] 0:01.0 ข้อความเด่น "299" บรรทัด 1 (สำคัญ · ตัวเลข/ราคา)')
  expect(lines).toContain("[2] 0:03.5 กราฟิกขึ้น: จรวดพุ่งขึ้นจากขอบล่าง (ไม่มีจุดเน้น)")
})

test("no slot or no sound means no call", async () => {
  const { transport, calls } = fakeTransport({ cues: [{ at: 1, sound: 1 }] })
  expect(await planSounds({ transport, model: "m", brief: BRIEF, slots: [], sounds: SOUNDS })).toEqual({ cues: [], dropped: 0 })
  expect(await planSounds({ transport, model: "m", brief: BRIEF, slots: SLOTS, sounds: [] })).toEqual({ cues: [], dropped: 0 })
  expect(calls).toHaveLength(0)
})

test("the call carries the prompt and its answer comes back as cues", async () => {
  const { transport, calls } = fakeTransport({ cues: [{ at: 2, sound: 1 }] })
  expect(await planSounds({ transport, model: "m", brief: BRIEF, slots: SLOTS, sounds: SOUNDS })).toEqual({ cues: [{ anchor: SLOTS[1]!.anchor, effectId: "coin", edited: false }], dropped: 0 })
  expect(calls[0]!.system).toBe(SOUNDS_PROMPT.system)
})

test("the prompt gives a key point a stronger sound, and offers no beat's edge any more", () => {
  expect(SOUNDS_PROMPT.version).toBe(SOUNDS_PROMPT_VERSION)
  expect(SOUNDS_PROMPT_VERSION).toBe("sounds-2026-09-27-points")
  expect(SOUNDS_PROMPT.system).toContain("จุดสำคัญได้เสียงที่หนักและชัดกว่า")
  expect(SOUNDS_PROMPT.system).not.toContain("ต้นช่วง")
})
