import { expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spareMedia } from "../flair/media.ts"
import {
  addBinItems,
  binIdOf,
  graphicBinItem,
  isRenderedGraphic,
  isRenderedSound,
  pruneBinItems,
  RENDERED_GRAPHICS_FOLDER,
  RENDERED_SOUNDS_FOLDER,
  soundBinItem,
} from "./bin.ts"
import { binVideos } from "./read.ts"
import type { BinItem, DraftMeta } from "./types.ts"

const meta = () => ({
  draft_id: "d",
  draft_name: "0917",
  tm_duration: 0,
  tm_draft_modified: 0,
  draft_materials: [
    { type: 0, value: [{ id: "OLD", file_Path: "/a.mov", metetype: "video", duration: 1, width: 1, height: 1 }] },
    { type: 1, value: [] },
  ],
})

const FIXTURE_META = fileURLToPath(new URL("../../test/fixtures/capcut-9.4/0917/draft_meta_info.json", import.meta.url))

/** The key order of a real imported video, straight from the sanitized fixture — not retyped by hand. */
function importedVideoKeys(): string[] {
  const fixture = JSON.parse(readFileSync(FIXTURE_META, "utf8")) as DraftMeta
  const imported = fixture.draft_materials.find((group) => group.type === 0)!
  const real = imported.value.find((entry) => entry.metetype === "video")!
  return Object.keys(real)
}

// the real entry 0917's draft_meta_info.json holds for an imported video (read 2026-09-24): this
// pins every key, its value, and the order CapCut writes them in, since graphicBinItem must look
// exactly like a file the user imported. The key list itself comes from the fixture, not a
// hand-copied literal, so a field CapCut writes that we forget to add shows up here too.
test("a graphic's bin item has the keys, values and order of a real imported entry", () => {
  const item = graphicBinItem({
    id: "NEW",
    path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov",
    width: 1004,
    height: 522,
    durationUs: 3_000_000,
    nowMs: 1_700_000_000_000,
  })
  expect(item).toEqual({
    ai_group_type: "",
    create_time: 1_700_000_000,
    duration: 3_000_000,
    enter_from: 0,
    extra_info: "ab12.mov",
    file_Path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov",
    height: 522,
    id: "NEW",
    import_time: 1_700_000_000,
    import_time_ms: 1_700_000_000_000_000,
    item_source: 1,
    material_color_tag: "",
    md5: "",
    metetype: "video",
    roughcut_time_range: { duration: 3_000_000, start: 0 },
    sub_time_range: { duration: -1, start: -1 },
    type: 0,
    width: 1004,
  })
  expect(Object.keys(item)).toEqual(importedVideoKeys())
})

test("items go into the imported group, once each, without touching the rest", () => {
  const item = graphicBinItem({ id: "NEW", path: "/g.mov", width: 2, height: 2, durationUs: 1, nowMs: 0 })
  const original = meta()
  const out = addBinItems(original, [item, item])
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["OLD", "NEW"])
  expect(addBinItems(out, [item]).draft_materials[0]!.value).toHaveLength(2)
  expect(out.draft_materials[1]).toEqual({ type: 1, value: [] })
  // pure: the object passed in is untouched
  expect(original.draft_materials[0]!.value).toHaveLength(1)
})

test("a meta with no imported group gets one", () => {
  const item = graphicBinItem({ id: "NEW", path: "/g.mov", width: 2, height: 2, durationUs: 1, nowMs: 0 })
  expect(addBinItems({ ...meta(), draft_materials: [] }, [item]).draft_materials).toEqual([{ type: 0, value: [item] }])
})

test("addBinItems does not mutate its input", () => {
  const original = meta()
  const item = graphicBinItem({ id: "NEW", path: "/g.mov", width: 2, height: 2, durationUs: 1, nowMs: 0 })
  addBinItems(original, [item])
  expect(original.draft_materials[0]!.value).toHaveLength(1)
})

test("binIdOf finds an item by path, and null for a path not in the bin", () => {
  expect(binIdOf(meta(), "/a.mov")).toBe("OLD")
  expect(binIdOf(meta(), "/missing.mov")).toBeNull()
})

test("binIdOf only looks in the type-0 group, even when an earlier group shares the path", () => {
  const sharedPath = {
    ...meta(),
    draft_materials: [
      // an earlier, non-0 group with an item at the same path but a different id
      { type: 1, value: [{ id: "WRONG", file_Path: "/shared.mov", metetype: "video", duration: 1, width: 1, height: 1 }] },
      { type: 0, value: [{ id: "RIGHT", file_Path: "/shared.mov", metetype: "video", duration: 1, width: 1, height: 1 }] },
    ],
  }
  expect(binIdOf(sharedPath, "/shared.mov")).toBe("RIGHT")

  const onlyInNonZero = {
    ...meta(),
    draft_materials: [
      { type: 1, value: [{ id: "ONLY", file_Path: "/only-in-type1.mov", metetype: "video", duration: 1, width: 1, height: 1 }] },
      { type: 0, value: [] },
    ],
  }
  expect(binIdOf(onlyInNonZero, "/only-in-type1.mov")).toBeNull()
})

test("isRenderedGraphic is true only for a path under BOXBLACK's own graphics folder", () => {
  expect(isRenderedGraphic(`/Users/x${RENDERED_GRAPHICS_FOLDER}ab12.mov`)).toBe(true)
  expect(isRenderedGraphic("/Users/x/Movies/CapCut/broll.mov")).toBe(false)
  expect(isRenderedGraphic("/Users/x/clips/broll.mov")).toBe(false)
})

const GRAPHICS_DIR = "/Users/x/Movies/CapCut/BOXBLACK/graphics"

const withGraphics = () => ({
  ...meta(),
  draft_materials: [
    {
      type: 0,
      value: [
        { id: "GONE", file_Path: `${GRAPHICS_DIR}/gone.mov`, metetype: "video", duration: 1, width: 1, height: 1 },
        { id: "KEEP", file_Path: `${GRAPHICS_DIR}/keep.mov`, metetype: "video", duration: 1, width: 1, height: 1 },
        { id: "USER", file_Path: "/Users/x/own-media/clip.mov", metetype: "video", duration: 1, width: 1, height: 1 },
        // a sibling folder with the same prefix is a different folder, not this one
        { id: "SIBLING", file_Path: `${GRAPHICS_DIR}-old/x.mov`, metetype: "video", duration: 1, width: 1, height: 1 },
      ],
    },
    // a non-0 group with an item that would be dropped if the type check were ever skipped:
    // inside the graphics folder, and its id isn't in `keep`
    { type: 1, value: [{ id: "type1-item", file_Path: `${GRAPHICS_DIR}/type1-item.mov`, metetype: "none", duration: 0, width: 0, height: 0 }] },
  ],
})

test("pruneBinItems drops an unkept graphic, keeps everything else", () => {
  const original = withGraphics()
  const out = pruneBinItems(original, GRAPHICS_DIR, new Set(["KEEP"]))
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
  expect(out.draft_materials[1]).toEqual(original.draft_materials[1])
  // pure: the object passed in is untouched
  expect(original.draft_materials[0]!.value).toHaveLength(4)
})

test("pruneBinItems treats an empty, root, single-folder or trailing-slash dir safely", () => {
  const original = withGraphics()
  // an empty or root dir would otherwise match — and prune — every imported file
  expect(pruneBinItems(original, "", new Set())).toEqual(original)
  expect(pruneBinItems(original, "/", new Set())).toEqual(original)
  // a single-folder dir such as /Users holds the user's own footage too: never a graphics folder
  const top = `/${GRAPHICS_DIR.split("/")[1]}`
  expect(pruneBinItems(original, top, new Set())).toEqual(original)
  // a wider folder that passes the guard still only loses rendered graphics, never the user's own media
  const home = GRAPHICS_DIR.split("/").slice(0, 3).join("/")
  const wide = pruneBinItems(original, home, new Set(["KEEP"]))
  expect(wide.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
  // a trailing slash on an otherwise normal dir makes no difference
  const withSlash = pruneBinItems(original, `${GRAPHICS_DIR}/`, new Set(["KEEP"]))
  const withoutSlash = pruneBinItems(original, GRAPHICS_DIR, new Set(["KEEP"]))
  expect(withSlash).toEqual(withoutSlash)
})

test("addBinItems after pruneBinItems with a reused id does not duplicate", () => {
  const pruned = pruneBinItems(withGraphics(), GRAPHICS_DIR, new Set(["KEEP"]))
  const reused = graphicBinItem({ id: "KEEP", path: `${GRAPHICS_DIR}/keep.mov`, width: 2, height: 2, durationUs: 1, nowMs: 0 })
  const out = addBinItems(pruned, [reused])
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["KEEP", "USER", "SIBLING"])
})

// the entry CapCut 9.5 wrote for a WAV the user imported from BOXBLACK's sounds folder (Task 1 of
// 0.6.0), with the id and the path replaced
const WAV_ITEM = JSON.parse(readFileSync(new URL("./fixtures/local-wav/bin-item.json", import.meta.url), "utf8")) as BinItem

test("a composed sound's bin item is the one CapCut wrote for an imported WAV, field by field", () => {
  const item = soundBinItem({ id: WAV_ITEM.id, path: WAV_ITEM.file_Path, durationUs: WAV_ITEM.duration, nowMs: 1_790_000_000_000 })
  expect(item).toEqual(WAV_ITEM)
  expect(Object.keys(item)).toEqual(Object.keys(WAV_ITEM))
})

test("isRenderedSound is true only for a path under BOXBLACK's own sounds folder", () => {
  expect(isRenderedSound(`/Users/x${RENDERED_SOUNDS_FOLDER}ab12.wav`)).toBe(true)
  expect(isRenderedSound(`/Users/x${RENDERED_GRAPHICS_FOLDER}ab12.mov`)).toBe(false)
  expect(isRenderedSound("/Users/x/Movies/CapCut/song.wav")).toBe(false)
  expect(isRenderedGraphic(`/Users/x${RENDERED_SOUNDS_FOLDER}ab12.wav`)).toBe(false)
})

const BOXBLACK_DIR = "/Users/x/Movies/CapCut/BOXBLACK"
const SOUNDS_DIR = `${BOXBLACK_DIR}/sounds`

const withSounds = (): DraftMeta => ({
  ...meta(),
  draft_materials: [
    {
      type: 0,
      value: [
        graphicBinItem({ id: "GRAPHIC_GONE", path: `${GRAPHICS_DIR}/gone.mov`, width: 2, height: 2, durationUs: 1, nowMs: 0 }),
        graphicBinItem({ id: "GRAPHIC_KEEP", path: `${GRAPHICS_DIR}/keep.mov`, width: 2, height: 2, durationUs: 1, nowMs: 0 }),
        soundBinItem({ id: "SOUND_GONE", path: `${SOUNDS_DIR}/gone.wav`, durationUs: 1, nowMs: 0 }),
        soundBinItem({ id: "SOUND_KEEP", path: `${SOUNDS_DIR}/keep.wav`, durationUs: 1, nowMs: 0 }),
        // the user's own music, imported by hand, here and under Movies/CapCut
        { id: "USER_SONG", file_Path: "/Users/x/Music/song.wav", metetype: "music", duration: 1, width: 0, height: 0 },
        { id: "USER_CAPCUT", file_Path: "/Users/x/Movies/CapCut/song.wav", metetype: "music", duration: 1, width: 0, height: 0 },
        // a sibling folder with the same prefix is a different folder, not this one
        { id: "SIBLING", file_Path: `${SOUNDS_DIR}-old/x.wav`, metetype: "music", duration: 1, width: 0, height: 0 },
      ],
    },
    { type: 1, value: [{ id: "type1-item", file_Path: `${SOUNDS_DIR}/type1-item.wav`, metetype: "none", duration: 0, width: 0, height: 0 }] },
  ],
})

test("pruneBinItems on the sounds folder drops an unkept sound and leaves the graphics and the user's music alone", () => {
  const original = withSounds()
  const out = pruneBinItems(original, SOUNDS_DIR, new Set(["SOUND_KEEP"]))
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["GRAPHIC_GONE", "GRAPHIC_KEEP", "SOUND_KEEP", "USER_SONG", "USER_CAPCUT", "SIBLING"])
  expect(out.draft_materials[1]).toEqual(original.draft_materials[1])
  // pure: the object passed in is untouched
  expect(original.draft_materials[0]!.value).toHaveLength(7)
})

test("pruneBinItems on the graphics folder still leaves the sounds alone", () => {
  const out = pruneBinItems(withSounds(), GRAPHICS_DIR, new Set(["GRAPHIC_KEEP"]))
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["GRAPHIC_KEEP", "SOUND_GONE", "SOUND_KEEP", "USER_SONG", "USER_CAPCUT", "SIBLING"])
})

test("pruneBinItems on a folder holding both drops unkept graphics and sounds, never the user's own files", () => {
  const out = pruneBinItems(withSounds(), BOXBLACK_DIR, new Set(["GRAPHIC_KEEP", "SOUND_KEEP"]))
  // the sibling folder is under BOXBLACK's, but it is not where BOXBLACK writes its sounds
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["GRAPHIC_KEEP", "SOUND_KEEP", "USER_SONG", "USER_CAPCUT", "SIBLING"])
  const home = BOXBLACK_DIR.split("/").slice(0, 3).join("/")
  expect(pruneBinItems(withSounds(), home, new Set()).draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["USER_SONG", "USER_CAPCUT", "SIBLING"])
})

test("a composed sound's bin item is neither footage nor a picture to cut away to", () => {
  const sound = soundBinItem({ id: "SOUND", path: `${SOUNDS_DIR}/ab12.wav`, durationUs: 4_000_000, nowMs: 0 })
  const video = { id: "VIDEO", file_Path: "/Users/x/clips/talk.mov", metetype: "video", duration: 8_000_000, width: 1080, height: 1920 }
  const bin: DraftMeta = { ...meta(), draft_materials: [{ type: 0, value: [sound, video] }] }
  expect(binVideos(bin).map((entry) => entry.id)).toEqual(["VIDEO"])
  expect(spareMedia(bin, [], () => true).map((media) => media.binId)).toEqual(["VIDEO"])
})
