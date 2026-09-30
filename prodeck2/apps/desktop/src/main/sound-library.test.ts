import { expect, test } from "vitest"
import type { SoundEffect } from "@boxblack/core/flair/sounds"
import { BUILT_IN_SOUNDS } from "@boxblack/core/flair/sound-catalogue"
import { createSoundLibrary, unfetchableFile } from "./sound-library.ts"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sound = (effectId: string, name: string, path = `/cache/${effectId}.mp3`) => ({
  id: `m-${effectId}`,
  type: "sound",
  name,
  duration: 400_000,
  path,
  effect_id: effectId,
})

function setup(drafts: Record<string, unknown>, builtIn: SoundEffect[] = []) {
  const reads: string[] = []
  const stamps = new Map(Object.keys(drafts).map((folder) => [folder, "1"]))
  const library = createSoundLibrary({
    projects: async () => Object.keys(drafts).map((folder) => ({ folder })),
    stampOf: async (folder) => stamps.get(folder)!,
    readDraft: async (folder) => {
      reads.push(folder)
      const draft = drafts[folder]
      if (draft === undefined) throw new Error(`no draft in ${folder}`)
      return draft
    },
    exists: (path) => !path.includes("gone"),
    builtIn,
  })
  return { library, reads, stamps }
}

test("the library is every sound the machine's drafts use, by name", async () => {
  const { library } = setup({
    "/drafts/0815": { materials: { audios: [sound("1", "ปัง"), sound("2", "ก๊อก")] } },
    "/drafts/0917": { materials: { audios: [sound("2", "ก๊อก"), sound("3", "ฟิ้ว")] } },
  })
  expect((await library.list()).map((entry) => [entry.name, entry.effectId])).toEqual([
    ["ก๊อก", "2"],
    ["ปัง", "1"],
    ["ฟิ้ว", "3"],
  ])
})

test("a sound whose cached file is gone in one draft but kept in another keeps the file", async () => {
  const { library } = setup({
    "/drafts/a": { materials: { audios: [sound("1", "ปัง", "/cache/gone.mp3")] } },
    "/drafts/b": { materials: { audios: [sound("1", "ปัง", "/cache/here.mp3")] } },
  })
  expect((await library.list())[0]!.path).toBe("/cache/here.mp3")
})

test("a draft is read once and only read again when it changed", async () => {
  const { library, reads, stamps } = setup({ "/drafts/a": { materials: { audios: [sound("1", "ปัง")] } } })
  await library.list()
  await library.list()
  expect(reads).toEqual(["/drafts/a"])

  stamps.set("/drafts/a", "2")
  await library.list()
  expect(reads).toEqual(["/drafts/a", "/drafts/a"])
})

test("a draft that cannot be read is skipped, and the others still count", async () => {
  const { library } = setup({ "/drafts/broken": undefined, "/drafts/ok": { materials: { audios: [sound("1", "ปัง")] } } })
  expect((await library.list()).map((entry) => entry.effectId)).toEqual(["1"])
})

test("no projects, no sounds", async () => {
  const { library } = setup({})
  expect(await library.list()).toEqual([])
})

const chime: SoundEffect = { effectId: "9", name: "TV On Chime", durationUs: 3_000_000, path: null, use: "เปิดทีวี อินโทร" }
const fad: SoundEffect = { effectId: "1", name: "ปัง", durationUs: 1_000_000, path: null, use: "ฟาด เน้นคำแรงๆ" }

test("a machine with no drafts still has the built-in sounds, for CapCut to fetch by id", async () => {
  const { library } = setup({}, [chime])
  expect(await library.list()).toEqual([chime])
})

test("a built-in sound a draft already uses keeps the draft's file and real length, and the built-in label", async () => {
  const { library } = setup({ "/drafts/0815": { materials: { audios: [sound("1", "ปัง")] } } }, [fad])
  expect(await library.list()).toEqual([{ effectId: "1", name: "ปัง", durationUs: 400_000, path: "/cache/1.mp3", use: "ฟาด เน้นคำแรงๆ" }])
})

test("left to itself the library offers CapCut's free sounds", async () => {
  const library = createSoundLibrary({ projects: async () => [] })
  expect((await library.list()).map((entry) => entry.effectId).sort()).toEqual(BUILT_IN_SOUNDS.map((entry) => entry.effectId).sort())
})

test("a sound CapCut could not fetch stays out after the draft that showed it no longer does", async () => {
  const placeholder = "##_material_placeholder_1_##"
  const built = [{ effectId: "9", name: "ว้าว", durationUs: 1_000_000, path: null }, { effectId: "8", name: "ป๊อป", durationUs: 1_000_000, path: null }]
  let saved = { ids: [] as string[], clearedAt: 0 }
  const drafts: Record<string, unknown> = { "/p/a": { materials: { audios: [sound("9", "ว้าว", placeholder)] } } }
  const stamps = new Map([["/p/a", "1"]])
  const library = createSoundLibrary({
    projects: async () => Object.keys(drafts).map((folder) => ({ folder })),
    stampOf: async (folder) => stamps.get(folder)!,
    readDraft: async (folder) => drafts[folder],
    exists: () => true,
    builtIn: built,
    unfetchable: { load: async () => saved, save: async (state) => void (saved = state) },
  })
  expect((await library.list()).map((entry) => entry.effectId)).toEqual(["8"])
  expect(saved.ids).toEqual(["9"])
  // the draft is written again without the sound: CapCut still could not fetch it, so it stays out
  drafts["/p/a"] = { materials: { audios: [] } }
  stamps.set("/p/a", "2")
  expect((await library.list()).map((entry) => entry.effectId)).toEqual(["8"])
  // a draft that has its file after all brings it back, and it is forgotten
  drafts["/p/a"] = { materials: { audios: [sound("9", "ว้าว")] } }
  stamps.set("/p/a", "3")
  expect((await library.list()).map((entry) => entry.effectId).sort()).toEqual(["8", "9"])
  expect(saved.ids).toEqual([])
})

test("sounds CapCut could not fetch — maybe only because the machine was offline — can be tried again", async () => {
  const placeholder = "##_material_placeholder_1_##"
  const built = [{ effectId: "9", name: "ว้าว", durationUs: 1_000_000, path: null }, { effectId: "8", name: "ป๊อป", durationUs: 1_000_000, path: null }]
  let saved = { ids: ["7"], clearedAt: 0 }
  // the draft CapCut opened offline, written at 100
  const drafts: Record<string, unknown> = { "/p/a": { materials: { audios: [sound("9", "ว้าว", placeholder)] } } }
  const written = new Map([["/p/a", 100]])
  let now = 500
  const library = createSoundLibrary({
    projects: async () => Object.keys(drafts).map((folder) => ({ folder })),
    stampOf: async (folder) => String(written.get(folder)),
    modifiedAt: async (folder) => written.get(folder)!,
    readDraft: async (folder) => drafts[folder],
    exists: () => true,
    builtIn: built,
    unfetchable: { load: async () => saved, save: async (state) => void (saved = state) },
    now: () => now,
  })
  expect((await library.list()).map((entry) => entry.effectId)).toEqual(["8"])
  expect(await library.failedCount()).toBe(2)

  // tried again: the draft from before still shows the placeholder, but it is not held against the sound
  await library.retry()
  expect(saved).toEqual({ ids: [], clearedAt: 500 })
  expect(await library.failedCount()).toBe(0)
  expect((await library.list()).map((entry) => entry.effectId).sort()).toEqual(["8", "9"])

  // a draft CapCut opens after that and still cannot fetch it: it is out again
  now = 900
  written.set("/p/a", 800)
  expect((await library.list()).map((entry) => entry.effectId)).toEqual(["8"])
  expect(saved).toEqual({ ids: ["9"], clearedAt: 500 })
})

test("the ids CapCut could not fetch are kept in a file with when they were last tried again; a file from before, or a broken one, reads as it can", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "boxblack-sounds-")), "unfetchable-sounds.json")
  const store = unfetchableFile(file)
  expect(await store.load()).toEqual({ ids: [], clearedAt: 0 })
  await store.save({ ids: ["9", "7"], clearedAt: 42 })
  expect(await unfetchableFile(file).load()).toEqual({ ids: ["9", "7"], clearedAt: 42 })
  const { writeFile } = await import("node:fs/promises")
  // the file 0.1.9–0.1.13 wrote: a list of ids
  await writeFile(file, JSON.stringify(["1", 2, null]))
  expect(await store.load()).toEqual({ ids: ["1"], clearedAt: 0 })
  await writeFile(file, JSON.stringify({ not: "a list" }))
  expect(await store.load()).toEqual({ ids: [], clearedAt: 0 })
  await writeFile(file, JSON.stringify({ ids: ["3", 4], clearedAt: "soon" }))
  expect(await store.load()).toEqual({ ids: ["3"], clearedAt: 0 })
})

test("trying the sounds again while the library is still reading the drafts is not undone when it finishes", async () => {
  const placeholder = "##_material_placeholder_1_##"
  // 7 was remembered; the draft being read shows 9 as well
  let saved = { ids: ["7"], clearedAt: 0 }
  let release!: () => void
  let started!: () => void
  const reading = new Promise<void>((resolve) => (release = resolve))
  const readingStarted = new Promise<void>((resolve) => (started = resolve))
  const library = createSoundLibrary({
    projects: async () => [{ folder: "/p/a" }],
    stampOf: async () => "1",
    modifiedAt: async () => 100,
    readDraft: async () => (started(), await reading, { materials: { audios: [sound("9", "ว้าว", placeholder)] } }),
    exists: () => true,
    builtIn: [],
    unfetchable: { load: async () => saved, save: async (state) => void (saved = state) },
    now: () => 500,
  })
  const listing = library.list()
  await readingStarted
  await library.retry()
  release()
  await listing
  expect(saved).toEqual({ ids: [], clearedAt: 500 })
})
