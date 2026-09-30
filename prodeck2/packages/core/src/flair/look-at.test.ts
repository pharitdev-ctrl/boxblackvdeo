import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import { acceptMedia, describeMedia, MEDIA_PROMPT, MEDIA_PROMPT_VERSION, type MediaFrame, type MediaReply } from "./look-at.ts"

const frames: MediaFrame[] = [
  { binId: "a", paths: ["/frames/a.jpg"] },
  { binId: "b", paths: ["/frames/b.jpg"] },
]

const answer = (picture: number, what: string, subject: number[] = [], fit = "card") => ({ picture, what, subject, fit }) as MediaReply["pictures"][number]

test("the answer becomes what each bin item shows, how to frame it, and where its subject sits", () => {
  const reply = { pictures: [answer(1, "เล็บสีชมพูลายดอกไม้", [0.2, 0.3, 0.8, 0.9], "cover"), answer(2, " หน้าร้านตอนกลางคืน ")] } as MediaReply
  expect(acceptMedia(reply, frames)).toEqual({
    a: { what: "เล็บสีชมพูลายดอกไม้", subject: { x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.9 }, fit: "cover" },
    b: { what: "หน้าร้านตอนกลางคืน", subject: null, fit: "card" },
  })
})

test("a subject box that is not four shares in order, or outside the picture, is dropped", () => {
  // too few, too many, back to front, upside down, and outside the picture
  const boxes = [[0.2, 0.3, 0.8], [0, 0, 1, 1, 0.5], [0.8, 0.3, 0.2, 0.9], [0.2, 0.9, 0.8, 0.3], [-0.1, 0, 0.5, 0.5], [0, 0, 1.5, 1], [Number.NaN, 0, 1, 1]]
  for (const subject of boxes) {
    expect(acceptMedia({ pictures: [answer(1, "รูป", subject)] } as MediaReply, frames).a!.subject, JSON.stringify(subject)).toBeNull()
  }
  // the whole picture is a valid box
  expect(acceptMedia({ pictures: [answer(1, "รูป", [0, 0, 1, 1])] } as MediaReply, frames).a!.subject).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
})

test("a fit the app does not know is the card, and so is a missing one", () => {
  expect(acceptMedia({ pictures: [answer(1, "รูป", [], "fullscreen")] } as MediaReply, frames).a!.fit).toBe("card")
  expect(acceptMedia({ pictures: [{ picture: 1, what: "รูป" }] } as MediaReply, frames).a!.fit).toBe("card")
})

test("a picture number that is not on the list, an empty line, or a second answer is dropped", () => {
  const reply = {
    pictures: [answer(9, "ไม่มีจริง"), answer(0, "ศูนย์"), answer(1, "   "), answer(2, "จอมือถือ"), answer(2, "อย่างอื่น")],
  } as MediaReply
  expect(Object.keys(acceptMedia(reply, frames))).toEqual(["b"])
  expect(acceptMedia(reply, frames).b!.what).toBe("จอมือถือ")
})

function fakeTransport(reply: MediaReply) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      return { output: reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, requests }
}

test("the pictures go to Claude in order, numbered, with every frame of each one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-media-"))
  const write = async (name: string, byte: number) => {
    const path = join(dir, name)
    await writeFile(path, Buffer.from([byte]))
    return path
  }
  const real: MediaFrame[] = [
    { binId: "a", paths: [await write("a.jpg", 1)] },
    // a clip is looked at three times, so something that shows up late is not missed
    { binId: "b", paths: [await write("b1.jpg", 2), await write("b2.jpg", 3), await write("b3.jpg", 4)] },
  ]

  const { transport, requests } = fakeTransport({ pictures: [answer(2, "หน้าร้าน")] })
  expect(Object.keys(await describeMedia({ transport, model: "m", frames: real }))).toEqual(["b"])

  const content = requests[0]!.content
  expect(content.map((entry) => entry.type)).toEqual(["text", "image", "text", "image", "image", "image"])
  expect(content[0]).toMatchObject({ type: "text", text: "รูปที่ 1" })
  expect(content[2]).toMatchObject({ type: "text", text: "รูปที่ 2 (คลิป 3 เฟรม)" })
  expect(content[1]).toMatchObject({ type: "image", mediaType: "image/jpeg", data: Buffer.from([1]).toString("base64") })
  expect(content[5]).toMatchObject({ type: "image", data: Buffer.from([4]).toString("base64") })
  expect(requests[0]!.system).toBe(MEDIA_PROMPT.system)
  expect(MEDIA_PROMPT.version).toBe(MEDIA_PROMPT_VERSION)
  // room for the thinking as well as the reply, at any effort
  expect(requests[0]!.maxTokens).toBe(16_000)
})

test("no pictures, no call", async () => {
  const { transport, requests } = fakeTransport({ pictures: [] })
  expect(await describeMedia({ transport, model: "m", frames: [] })).toEqual({})
  expect(requests).toEqual([])
})
