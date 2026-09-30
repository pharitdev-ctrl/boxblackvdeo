import { describe, expect, it } from "vitest"
import { DEFAULT_FLAIR_OPTIONS, EXIT_ANIMATIONS, exitsFor, patternsFor, TEXT_PATTERNS, TEXT_PATTERNS_BY_ID, usableExit } from "./catalogue.ts"

describe("catalogue", () => {
  it("keeps the motion graphics off until the user turns them on, since they need the renderer pack", () => {
    expect(DEFAULT_FLAIR_OPTIONS.graphic).toBe(false)
  })

  it("turns every work on at the middle level but the graphics, which wait for the renderer pack; the old switch stays on and is read by nothing", () => {
    expect(DEFAULT_FLAIR_OPTIONS).toEqual({ enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false })
  })

  it("has an entry for every pattern, filed under its own id", () => {
    for (const id of TEXT_PATTERNS) expect(TEXT_PATTERNS_BY_ID[id]!.id).toBe(id)
  })

  it("gives every entry a line range that can be met", () => {
    for (const entry of Object.values(TEXT_PATTERNS_BY_ID)) {
      expect(entry.lines.min).toBeGreaterThanOrEqual(1)
      expect(entry.lines.max).toBeGreaterThanOrEqual(entry.lines.min)
      expect(entry.lines.max).toBeLessThanOrEqual(3)
    }
  })

  it("offers every pattern at every level: only a wide output leaves out the ones drawn on portrait alone", () => {
    expect(patternsFor().map((entry) => entry.id)).toEqual([...TEXT_PATTERNS])
    expect(patternsFor(true).map((entry) => entry.id)).toEqual(["stack", "punch", "stair"])
  })

  it("names no level on a pattern or an exit: the level only chooses which emphasis points get effects", () => {
    for (const entry of [...Object.values(TEXT_PATTERNS_BY_ID), ...EXIT_ANIMATIONS]) expect(Object.keys(entry)).not.toContain("from")
  })

  it("names every exit animation by a resource id CapCut wrote itself", () => {
    expect(EXIT_ANIMATIONS.length).toBeGreaterThan(0)
    for (const animation of EXIT_ANIMATIONS) expect(animation.resourceId).toMatch(/^\d{19}$/)
    expect(new Set(EXIT_ANIMATIONS.map((animation) => animation.id)).size).toBe(EXIT_ANIMATIONS.length)
  })

  it("fades out with an id no other CapCut animation also answers to", () => {
    // 6724919382104871427 (เลือนหาย) is also the old id of another animation in CapCut's catalogue:
    // CapCut sometimes resolved it to that one, dropped its file and showed the animation as lost
    expect(EXIT_ANIMATIONS.map((animation) => animation.resourceId)).not.toContain("6724919382104871427")
    expect(EXIT_ANIMATIONS.find((animation) => animation.id === "fade-out")).toMatchObject({ name: "จางหายหลอน ๆ", resourceId: "7644574121141062913" })
  })

  it("lists every fade CapCut was seen to download by id, so each group can have the one that suits it", () => {
    const fades = EXIT_ANIMATIONS.map((animation) => [animation.name, animation.resourceId])
    expect(fades).toEqual(
      expect.arrayContaining([
        ["จางหายหลอน ๆ", "7644574121141062913"],
        ["จางหายหม่นหมอง", "7648937969314843924"],
        ["อัลเทอร์เนตเฟด", "7646374090143567112"],
      ]),
    )
    expect(new Set(EXIT_ANIMATIONS.map((animation) => animation.resourceId)).size).toBe(EXIT_ANIMATIONS.length)
  })
})

describe("which exit animations need CapCut Pro", () => {
  it("marks all five Pro: หมุนหายไป by CapCut's own data, อัลเทอร์เนตเฟด by CapCut's export dialog though its cache said free, the three never seen free", () => {
    expect(Object.fromEntries(EXIT_ANIMATIONS.map((exit) => [exit.id, exit.pro]))).toEqual({
      "fade-out": true,
      "fade-dim": true,
      "fade-alt": true,
      "spin-out": true,
      "burst-out": true,
    })
  })

  it("offers none without Pro, since every one needs it, and every one with it", () => {
    expect(exitsFor(false)).toEqual([])
    expect(exitsFor(true).map((exit) => exit.id)).toEqual(EXIT_ANIMATIONS.map((exit) => exit.id))
  })

  it("lets an exit through only when it exists and the user may have it", () => {
    expect(usableExit("spin-out", false)).toBeNull()
    expect(usableExit("spin-out", true)).toBe("spin-out")
    // CapCut 9.5's export dialog asked for Pro for อัลเทอร์เนตเฟด (2026-09-29)
    expect(usableExit("fade-alt", false)).toBeNull()
    expect(usableExit("fade-alt", true)).toBe("fade-alt")
    expect(usableExit("made-up", true)).toBeNull()
    expect(usableExit(null, true)).toBeNull()
  })
})
