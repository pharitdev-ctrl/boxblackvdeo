import { expect, test } from "vitest"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import { acceptPolished, polishSubtitles, PolishReplySchema, SUBTITLE_POLISH_PROMPT } from "./polish.ts"

function fakeTransport(reply: { lines: string[] }) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      return { output: reply as T, usage: { inputTokens: 300, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, requests }
}

const texts = (content: LlmContent[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : []))
const lines = ["ถ้าคุณกำลังโมงหาร้านทำเล็ก", "ลองดูผลงานเราก่อน"]

test("sends the numbered lines with the chosen model, the polish prompt and the reply schema", async () => {
  const { transport, requests } = fakeTransport({ lines: ["ถ้าคุณกำลังมองหาร้านทำเล็บ", "ลองดูผลงานเราก่อน"] })
  await polishSubtitles({ transport, model: "claude-sonnet-5", lines })
  const request = requests[0]!
  expect(request.model).toBe("claude-sonnet-5")
  expect(request.system).toBe(SUBTITLE_POLISH_PROMPT.system)
  expect(request.schema).toBe(PolishReplySchema)
  expect(texts(request.content).join("\n")).toContain("1. ถ้าคุณกำลังโมงหาร้านทำเล็ก\n2. ลองดูผลงานเราก่อน")
})

test("a reply with one corrected line for each line is used", async () => {
  const { transport } = fakeTransport({ lines: [" ถ้าคุณกำลังมองหาร้านทำเล็บ ", "ลองดูผลงานเราก่อน"] })
  expect(await polishSubtitles({ transport, model: "claude-opus-5", lines })).toEqual({
    lines: ["ถ้าคุณกำลังมองหาร้านทำเล็บ", "ลองดูผลงานเราก่อน"],
    accepted: true,
  })
})

test("a reply that does not line up with the captions is ignored and the lines stay as they were", async () => {
  for (const reply of [["ถ้าคุณกำลังมองหาร้านทำเล็บ ลองดูผลงานเราก่อน"], ["ถ้าคุณกำลังมองหาร้านทำเล็บ", "  "]]) {
    const { transport } = fakeTransport({ lines: reply })
    expect(await polishSubtitles({ transport, model: "claude-opus-5", lines })).toEqual({ lines, accepted: false })
  }
})

test("no captions, no request", async () => {
  const { transport, requests } = fakeTransport({ lines: [] })
  expect(await polishSubtitles({ transport, model: "claude-opus-5", lines: [] })).toEqual({ lines: [], accepted: true })
  expect(requests).toHaveLength(0)
})

test("a polished line may grow a little, not turn into something else", () => {
  expect(acceptPolished(["สวัสดีครับ"], ["สวัสดีครับทุกคน"])).toBe(true)
  // short lines may gain up to 10 characters, longer ones may double
  expect(acceptPolished(["ค่ะ"], ["ค่ะ ขอบคุณนะ"])).toBe(true)
  expect(acceptPolished(["ค่ะ"], ["ค่ะ ขอบคุณมากนะคะทุกคนที่ติดตาม"])).toBe(false)
  expect(acceptPolished(["วันนี้จะมารีวิวแอปตัดต่อ"], ["วันนี้จะมารีวิวแอปตัดต่อวิดีโอที่ใช้ง่ายที่สุด"])).toBe(true)
  expect(acceptPolished(["วันนี้จะมารีวิวแอปตัดต่อ"], ["วันนี้จะมารีวิวแอปตัดต่อวิดีโอที่ใช้ง่ายที่สุดในโลกตอนนี้เลย"])).toBe(false)
  expect(acceptPolished(["a", "b"], ["a"])).toBe(false)
  expect(acceptPolished(["a"], [""])).toBe(false)
  expect(acceptPolished(["a"], ["   "])).toBe(false)
})
