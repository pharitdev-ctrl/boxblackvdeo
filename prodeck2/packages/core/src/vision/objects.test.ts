import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import type { Scene } from "./describe.ts"
import { acceptObjects, locateObjects, OBJECTS_PROMPT, OBJECTS_VERSION, ObjectsReplySchema, type ObjectsReply } from "./objects.ts"

async function frames(timesUs: number[]) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-objects-"))
  return Promise.all(
    timesUs.map(async (atUs) => {
      const path = join(dir, `frame-${atUs}.jpg`)
      await writeFile(path, `jpeg-${atUs}`)
      return { atUs, path }
    }),
  )
}

const scene = (startUs: number, endUs: number, description: string): Scene => ({ startUs, endUs, description, kind: "talking-head", issues: [], keepClear: null })

const face = { what: "หน้าคนพูด", kind: "keep" as const, box: [0.3, 0.1, 0.7, 0.4], still: false, face: false }

/** The scene numbers listed in a request's first text. */
const askedIn = (request: LlmRequest<unknown>) => {
  const first = request.content[0]
  return first?.type === "text" ? [...first.text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])) : []
}

/** Replies through `reply`, or with one face for every scene asked about, and records every request. */
function fakeTransport(reply?: (request: LlmRequest<unknown>, call: number) => unknown) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const output = reply?.(request as LlmRequest<unknown>, requests.length) ?? { scenes: askedIn(request as LlmRequest<unknown>).map((n) => ({ scene: n, objects: [face] })) }
      return { output: output as T, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, requests }
}

// acceptObjects

test("keeps a scene's objects with their box as shares", () => {
  const kept = acceptObjects({ scenes: [{ scene: 2, objects: [{ ...face, still: true }] }] }, [2])
  expect(kept.get(2)).toEqual([{ what: "หน้าคนพูด", kind: "keep", box: { x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.4 }, still: true }])
})

test("ignores an entry for a scene not asked about", () => {
  const kept = acceptObjects({ scenes: [{ scene: 3, objects: [face] }] }, [1, 2])
  expect([...kept.keys()]).toEqual([1, 2])
  expect(kept.has(3)).toBe(false)
})

test("maps a scene asked about with no entry to no objects", () => {
  const kept = acceptObjects({ scenes: [{ scene: 1, objects: [face] }] }, [1, 2])
  expect(kept.get(2)).toEqual([])
})

test("drops an object whose box is not four numbers in order inside the frame", () => {
  const bad = [[0.1, 0.1, 0.5], [0.1, 0.1, 0.5, 0.5, 0.9], [0.5, 0.1, 0.5, 0.4], [0.6, 0.1, 0.5, 0.4], [0.1, 0.4, 0.5, 0.4], [-0.1, 0.1, 0.5, 0.4], [0.1, 0.1, 1.2, 0.4], [0.1, 0.1, 0.5, Number.NaN], [0.1, 0.1, Infinity, 0.4]]
  const kept = acceptObjects({ scenes: [{ scene: 1, objects: [...bad.map((box) => ({ ...face, box })), { ...face, box: [0, 0, 1, 1] }] }] }, [1])
  expect(kept.get(1)!.map((o) => o.box)).toEqual([{ x0: 0, y0: 0, x1: 1, y1: 1 }])
})

test("trims what, cuts it to 60 graphemes and drops an empty one", () => {
  const long = "ก่".repeat(70)
  const kept = acceptObjects({ scenes: [{ scene: 1, objects: [{ ...face, what: "  ป้ายร้าน  " }, { ...face, what: "   " }, { ...face, what: long }] }] }, [1])
  const whats = kept.get(1)!.map((o) => o.what)
  expect(whats).toEqual(["ป้ายร้าน", "ก่".repeat(60)])
})

test("keeps at most six objects per scene, in the order given", () => {
  const objects = Array.from({ length: 8 }, (_, i) => ({ ...face, what: `ของ ${i + 1}` }))
  const kept = acceptObjects({ scenes: [{ scene: 1, objects }] }, [1])
  expect(kept.get(1)!.map((o) => o.what)).toEqual(["ของ 1", "ของ 2", "ของ 3", "ของ 4", "ของ 5", "ของ 6"])
})

test("tolerates a raw reply with no objects and no still", () => {
  const raw = { scenes: [{ scene: 1 }, { scene: 2, objects: [{ what: "แก้ว", kind: "point", box: [0.1, 0.6, 0.3, 0.9] }] }] } as unknown as ObjectsReply
  const kept = acceptObjects(raw, [1, 2])
  expect(kept.get(1)).toEqual([])
  expect(kept.get(2)).toEqual([{ what: "แก้ว", kind: "point", box: { x0: 0.1, y0: 0.6, x1: 0.3, y1: 0.9 }, still: false }])
})

test("the schema fills in missing objects and still", () => {
  const parsed = ObjectsReplySchema.parse({ scenes: [{ scene: 1 }, { scene: 2, objects: [{ what: "แก้ว", kind: "point", box: [0, 0, 1, 1] }] }] })
  expect(parsed.scenes[0]!.objects).toEqual([])
  expect(parsed.scenes[1]!.objects[0]!.still).toBe(false)
})

// locateObjects

const base = { model: "claude-opus-5", batchSize: 10 }

test("lists the scenes asked about, then labels every frame with its time and sends it as a JPEG", async () => {
  const { transport, requests } = fakeTransport()
  const scenes = [scene(0, 2_000_000, "ชายหนุ่มพูดกับกล้อง"), scene(2_000_000, 6_000_000, "ถือแก้วกาแฟ")]
  await locateObjects({ ...base, transport, scenes, frames: await frames([500_000, 3_500_000]) })
  expect(requests[0]!.content).toEqual([
    { type: "text", text: "ฉาก\n1. 0.0–2.0 วินาที · ชายหนุ่มพูดกับกล้อง\n2. 2.0–6.0 วินาที · ถือแก้วกาแฟ" },
    { type: "text", text: "ภาพที่ 1 · เวลา 0.5 วินาที" },
    { type: "image", mediaType: "image/jpeg", data: Buffer.from("jpeg-500000").toString("base64") },
    { type: "text", text: "ภาพที่ 2 · เวลา 3.5 วินาที" },
    { type: "image", mediaType: "image/jpeg", data: Buffer.from("jpeg-3500000").toString("base64") },
  ])
})

test("uses the chosen model, the objects prompt, the reply schema and 8000 tokens", async () => {
  const { transport, requests } = fakeTransport()
  await locateObjects({ ...base, transport, scenes: [scene(0, 2_000_000, "x")], frames: await frames([500_000]) })
  expect(requests[0]!.model).toBe("claude-opus-5")
  expect(requests[0]!.system).toBe(OBJECTS_PROMPT.system)
  expect(OBJECTS_PROMPT.version).toBe(OBJECTS_VERSION)
  expect(requests[0]!.schema).toBe(ObjectsReplySchema)
  expect(requests[0]!.maxTokens).toBe(8000)
})

test("asks each batch about the scenes overlapping its window, numbering frames on across batches", async () => {
  const { transport, requests } = fakeTransport()
  const scenes = [scene(0, 3_000_000, "หนึ่ง"), scene(3_000_000, 7_000_000, "สอง"), scene(7_000_000, 12_000_000, "สาม")]
  const progress: number[] = []
  await locateObjects({ ...base, transport, batchSize: 2, scenes, frames: await frames([500_000, 2_000_000, 5_000_000, 8_000_000]), onProgress: (f) => progress.push(f) })
  expect(requests).toHaveLength(2)
  // the first window runs to 5.0 s, the second from 5.0 s to the end
  expect(askedIn(requests[0]!)).toEqual([1, 2])
  expect(askedIn(requests[1]!)).toEqual([2, 3])
  expect(requests[1]!.content[1]).toEqual({ type: "text", text: "ภาพที่ 3 · เวลา 5.0 วินาที" })
  expect(progress).toEqual([0.5, 1])
})

test("returns one entry per scene, in order, with no objects where nothing was found", async () => {
  const { transport } = fakeTransport((request) => ({ scenes: askedIn(request).filter((n) => n !== 2).map((n) => ({ scene: n, objects: [{ ...face, what: `ของฉาก ${n}` }] })) }))
  const scenes = [scene(0, 1_000_000, "ก"), scene(1_000_000, 2_000_000, "ข"), scene(2_000_000, 3_000_000, "ค")]
  const found = await locateObjects({ ...base, transport, scenes, frames: await frames([500_000]) })
  expect(found.version).toBe(OBJECTS_VERSION)
  expect(found.scenes.map((objects) => objects.map((o) => o.what))).toEqual([["ของฉาก 1"], [], ["ของฉาก 3"]])
})

test("a scene asked about twice keeps the first batch's objects and adds only new ones", async () => {
  const { transport } = fakeTransport((request, call) => ({
    scenes: askedIn(request).map((n) => ({
      scene: n,
      objects: call === 1 ? [{ ...face, box: [0.3, 0.1, 0.7, 0.4] }] : [{ ...face, box: [0.2, 0.2, 0.8, 0.5] }, { ...face, what: "แก้ว", kind: "point" }],
    })),
  }))
  const found = await locateObjects({ ...base, transport, batchSize: 1, scenes: [scene(0, 10_000_000, "ยาว")], frames: await frames([500_000, 5_000_000]) })
  expect(found.scenes[0]!.map((o) => [o.what, o.box.x0])).toEqual([["หน้าคนพูด", 0.3], ["แก้ว", 0.3]])
})

test("a batch that throws fails the whole call", async () => {
  const { transport } = fakeTransport((_request, call) => {
    if (call === 2) throw new Error("boom")
    return undefined
  })
  const run = locateObjects({ ...base, transport, batchSize: 1, scenes: [scene(0, 10_000_000, "ยาว")], frames: await frames([500_000, 5_000_000]) })
  await expect(run).rejects.toThrow("boom")
})

test("with no scenes it makes no call", async () => {
  const { transport, requests } = fakeTransport()
  const found = await locateObjects({ ...base, transport, scenes: [], frames: await frames([500_000]) })
  expect(requests).toHaveLength(0)
  expect(found).toEqual({ version: OBJECTS_VERSION, scenes: [] })
})

test("a scene asked about twice still keeps at most six objects", async () => {
  const { transport } = fakeTransport((request, call) => ({
    scenes: askedIn(request).map((n) => ({ scene: n, objects: Array.from({ length: 4 }, (_, i) => ({ ...face, what: `ชุด ${call} ของ ${i + 1}` })) })),
  }))
  const found = await locateObjects({ ...base, transport, batchSize: 1, scenes: [scene(0, 10_000_000, "ยาว")], frames: await frames([500_000, 5_000_000]) })
  expect(found.scenes[0]!.map((o) => o.what)).toEqual(["ชุด 1 ของ 1", "ชุด 1 ของ 2", "ชุด 1 ของ 3", "ชุด 1 ของ 4", "ชุด 2 ของ 1", "ชุด 2 ของ 2"])
})

test("makes no call for a batch whose stretch has no scene, and numbers its frames all the same", async () => {
  const { transport, requests } = fakeTransport()
  const progress: number[] = []
  await locateObjects({ ...base, transport, batchSize: 1, scenes: [scene(6_000_000, 8_000_000, "ท้าย")], frames: await frames([500_000, 5_000_000]), onProgress: (f) => progress.push(f) })
  expect(requests).toHaveLength(1)
  expect(requests[0]!.content[1]).toEqual({ type: "text", text: "ภาพที่ 2 · เวลา 5.0 วินาที" })
  expect(progress).toEqual([0.5, 1])
})

test("drops an object whose what repeats one already kept for the scene", () => {
  const kept = acceptObjects({ scenes: [{ scene: 1, objects: [face, { ...face, what: " หน้าคนพูด ", box: [0, 0, 1, 1] }, { ...face, what: "แก้ว" }] }] }, [1])
  expect(kept.get(1)!.map((o) => [o.what, o.box.x0])).toEqual([["หน้าคนพูด", 0.3], ["แก้ว", 0.3]])
})

test("a later batch naming the same new thing twice adds it once", async () => {
  const { transport } = fakeTransport((request, call) => ({
    scenes: askedIn(request).map((n) => ({ scene: n, objects: call === 1 ? [face] : [{ ...face, what: "แก้ว" }, { ...face, what: "แก้ว", box: [0, 0, 1, 1] }] })),
  }))
  const found = await locateObjects({ ...base, transport, batchSize: 1, scenes: [scene(0, 10_000_000, "ยาว")], frames: await frames([500_000, 5_000_000]) })
  expect(found.scenes[0]!.map((o) => o.what)).toEqual(["หน้าคนพูด", "แก้ว"])
})

const windowCase = async (s: Scene) => {
  const { transport, requests } = fakeTransport()
  await locateObjects({ ...base, transport, batchSize: 1, scenes: [s], frames: await frames([500_000, 5_000_000]) })
  return requests.map((request) => askedIn(request).length > 0)
}

test("a scene ending exactly at the second batch's first frame is asked by both batches", async () => {
  expect(await windowCase(scene(1_000_000, 5_000_000, "จบที่ขอบ"))).toEqual([true, true])
})

test("a scene starting exactly at the second batch's first frame is asked only by the second", async () => {
  const { transport, requests } = fakeTransport()
  await locateObjects({ ...base, transport, batchSize: 1, scenes: [scene(5_000_000, 8_000_000, "เริ่มที่ขอบ")], frames: await frames([500_000, 5_000_000]) })
  expect(requests).toHaveLength(1)
  expect(requests[0]!.content[1]).toEqual({ type: "text", text: "ภาพที่ 2 · เวลา 5.0 วินาที" })
})

test("a scene before the first frame is asked by the first batch", async () => {
  const { transport, requests } = fakeTransport()
  await locateObjects({ ...base, transport, batchSize: 1, scenes: [scene(0, 300_000, "ต้นคลิป")], frames: await frames([500_000, 5_000_000]) })
  expect(requests).toHaveLength(1)
  expect(requests[0]!.content[1]).toEqual({ type: "text", text: "ภาพที่ 1 · เวลา 0.5 วินาที" })
})

// faces

test("keeps face: true on a keep object", () => {
  const kept = acceptObjects({ scenes: [{ scene: 1, objects: [{ ...face, face: true }] }] }, [1])
  expect(kept.get(1)![0]!.face).toBe(true)
})

test("drops face on a point object and leaves a keep object without it unmarked", () => {
  const kept = acceptObjects(
    { scenes: [{ scene: 1, objects: [{ ...face, what: "ป้าย", kind: "point" as const, face: true }, { ...face, what: "สินค้า", face: false }, { ...face, what: "ตัวหนังสือ" }] }] },
    [1],
  )
  for (const object of kept.get(1)!) expect(object.face).toBeUndefined()
})

test("defaults face to false in the schema and tolerates a reply without it", () => {
  const parsed = ObjectsReplySchema.parse({ scenes: [{ scene: 1, objects: [{ what: "หน้า", kind: "keep", box: [0, 0, 1, 1] }] }] })
  expect(parsed.scenes[0]!.objects[0]!.face).toBe(false)
  expect(acceptObjects(parsed, [1]).get(1)![0]!.face).toBeUndefined()
})

test("asks for faces in the prompt and carries the faces version", () => {
  expect(OBJECTS_VERSION).toBe("objects-2026-10-02-faces")
  expect(OBJECTS_PROMPT.system).toContain("  - face: true เมื่อของนั้นคือใบหน้าคน (ใช้กับ kind keep เท่านั้น)")
})
