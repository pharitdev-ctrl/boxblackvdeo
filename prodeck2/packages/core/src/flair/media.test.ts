import { describe, expect, it } from "vitest"
import { spareMedia } from "./media.ts"

const item = (id: string, path: string, kind = "photo", extra: Record<string, unknown> = {}) => ({
  id,
  metetype: kind,
  file_Path: path,
  extra_info: path.split("/").pop(),
  width: 3024,
  height: 4032,
  duration: 5_000_000,
  ...extra,
})
const meta = (value: unknown[], type = 0) => ({ draft_materials: [{ type: 8, value: [item("m", "/music.mp3", "music")] }, { type, value }] })
const exists = (path: string) => !path.includes("gone")

describe("spareMedia", () => {
  it("reads the photos and clips of the bin", () => {
    const found = spareMedia(meta([item("a", "/pics/nail.jpg"), item("b", "/clips/broll.mp4", "video", { duration: 8_000_000 })]), [], exists)
    expect(found).toEqual([
      { binId: "a", path: "/pics/nail.jpg", name: "nail.jpg", kind: "photo", width: 3024, height: 4032, durationUs: 5_000_000 },
      { binId: "b", path: "/clips/broll.mp4", name: "broll.mp4", kind: "video", width: 3024, height: 4032, durationUs: 8_000_000 },
    ])
  })

  it("leaves out the footage the outline already plays, by its bin id", () => {
    const found = spareMedia(meta([item("a", "/clips/talk.mov", "video"), item("b", "/pics/nail.jpg")]), ["a"], exists)
    expect(found.map((media) => media.binId)).toEqual(["b"])
  })

  it("leaves out a file that is gone, music, and anything without an id or a path", () => {
    const found = spareMedia(
      meta([
        item("a", "/pics/gone.jpg"),
        item("b", "/music.mp3", "music"),
        item("", "/pics/nameless.jpg"),
        item("d", ""),
        item("e", "/pics/keep.jpg"),
      ]),
      [],
      exists,
    )
    expect(found.map((media) => media.binId)).toEqual(["e"])
  })

  it("reads only the imported-files group of the bin", () => {
    // CapCut keeps other kinds of material in groups of their own; a photo listed there is not the bin
    const other = { draft_materials: [{ type: 1, value: [item("a", "/pics/elsewhere.jpg")] }, { type: 0, value: [item("b", "/pics/nail.jpg")] }] }
    expect(spareMedia(other, [], exists).map((media) => media.binId)).toEqual(["b"])
  })

  it("gives one entry for a file listed twice", () => {
    const found = spareMedia(meta([item("a", "/pics/nail.jpg"), item("b", "/pics/nail.jpg")]), [], exists)
    expect(found.map((media) => media.binId)).toEqual(["a"])
  })

  it("falls back to the file's own name when the bin has no label", () => {
    const found = spareMedia(meta([item("a", "/pics/nail.jpg", "photo", { extra_info: "" })]), [], exists)
    expect(found[0]!.name).toBe("nail.jpg")
  })

  it("leaves out BOXBLACK's own rendered graphics, but not the user's other files under Movies/CapCut", () => {
    const found = spareMedia(
      meta([
        item("a", "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", "video"),
        item("b", "/Users/x/Movies/CapCut/broll.mov", "video"),
      ]),
      [],
      exists,
    )
    expect(found.map((media) => media.binId)).toEqual(["b"])
  })

  it("has nothing to give without a bin", () => {
    expect(spareMedia(null, [], exists)).toEqual([])
    expect(spareMedia({}, [], exists)).toEqual([])
    expect(spareMedia({ draft_materials: "no" }, [], exists)).toEqual([])
    expect(spareMedia(meta([], 1), [], exists)).toEqual([])
  })
})
