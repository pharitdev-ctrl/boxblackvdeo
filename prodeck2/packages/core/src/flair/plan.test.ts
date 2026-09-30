import { describe, expect, it } from "vitest"
import type { BinMedia } from "./media.ts"
import {
  DEFAULT_LOOK,
  enforce,
  enforceCues,
  enforceInserts,
  enforceZooms,
  insertLength,
  type CueAnchor,
  type GroupLook,
  type PlacedCue,
  type PlacedInsert,
  type PlacedZoom,
} from "./plan.ts"

const look = (look: Partial<GroupLook>): GroupLook => ({ ...DEFAULT_LOOK, ...look })
const group = (...lines: string[]) => ({ lines })

describe("enforce", () => {
  it("keeps every pattern the group and the output can carry: no level gates one", () => {
    expect(enforce([look({ pattern: "punch" })], [group("ลดครึ่งราคา")])[0]!.pattern).toBe("punch")
    expect(enforce([look({ pattern: "bar" })], [group("ลดครึ่งราคา")])[0]!.pattern).toBe("bar")
    expect(enforce([look({ pattern: "stair" })], [group("ลดครึ่งราคา", "วันนี้เท่านั้น")])[0]!.pattern).toBe("stair")
  })

  it("drops a pattern the group has too many lines for", () => {
    const looks = enforce([look({ pattern: "punch" })], [group("ลดครึ่งราคา", "วันนี้เท่านั้น")])
    expect(looks[0]!.pattern).toBe("stack")
  })

  it("drops a pattern the group has too few lines for", () => {
    const looks = enforce([look({ pattern: "stair" })], [group("ลดครึ่งราคา")])
    expect(looks[0]!.pattern).toBe("stack")
  })

  it("drops a pattern only portrait output draws, on a wide output", () => {
    expect(enforce([look({ pattern: "bar" })], [group("ลดครึ่งราคา")], true)[0]!.pattern).toBe("stack")
  })

  it("keeps an accent inside its line", () => {
    const looks = enforce([look({ accent: { line: 0, from: 3, to: 6 } })], [group("ลด 990 บาท")])
    expect(looks[0]!.accent).toEqual({ line: 0, from: 3, to: 6 })
  })

  it("drops an accent past the end of its line", () => {
    const looks = enforce([look({ accent: { line: 0, from: 3, to: 99 } })], [group("ลด 990 บาท")])
    expect(looks[0]!.accent).toBeNull()
  })

  it("drops an accent on a line the group does not have", () => {
    const looks = enforce([look({ accent: { line: 1, from: 0, to: 2 } })], [group("ลด 990 บาท")])
    expect(looks[0]!.accent).toBeNull()
  })

  it("drops an empty or backwards accent", () => {
    const groups = [group("ลด 990 บาท"), group("ลด 990 บาท")]
    const looks = enforce([look({ accent: { line: 0, from: 3, to: 3 } }), look({ accent: { line: 0, from: 6, to: 3 } })], groups)
    expect(looks.map((entry) => entry.accent)).toEqual([null, null])
  })

  it("counts accent offsets in code points, so Thai marks take an index", () => {
    // ก ิ ๊ ก ␠ 5 0 — the accent on "50" is [5, 7) and the line is 7 long
    const looks = enforce([look({ accent: { line: 0, from: 5, to: 7 } })], [group("กิ๊ก 50")])
    expect(looks[0]!.accent).toEqual({ line: 0, from: 5, to: 7 })
  })

  it("keeps every exit the catalogue has with CapCut Pro, the loudest included: no level gates one", () => {
    const looks = enforce([look({ exit: "fade-out" }), look({ exit: "burst-out" })], [group("ลดครึ่งราคา"), group("วันนี้เท่านั้น")], false, true)
    expect(looks.map((entry) => entry.exit)).toEqual(["fade-out", "burst-out"])
  })

  it("without CapCut Pro drops every exit, since each needs it, even one set by hand; with Pro the same looks keep theirs", () => {
    const asked = [look({ exit: "spin-out" }), look({ exit: "spin-out", edited: true }), look({ exit: "fade-alt" })]
    const groups = [group("ก"), group("ข"), group("ค")]
    // อัลเทอร์เนตเฟด too: CapCut 9.5's export dialog asked for Pro for it
    expect(enforce(asked, groups).map((entry) => entry.exit)).toEqual([null, null, null])
    // Pro is off when not given, and off when said so
    expect(enforce([look({ exit: "spin-out" })], [group("ก")], false, false)[0]!.exit).toBeNull()
    expect(enforce(asked, groups, false, true).map((entry) => entry.exit)).toEqual(["spin-out", "spin-out", "fade-alt"])
  })

  it("drops an exit that is not in the catalogue", () => {
    // with CapCut Pro, so it is the catalogue that turns it down: without Pro every exit is dropped anyway
    const looks = enforce([look({ exit: "made-up" })], [group("ลดครึ่งราคา")], false, true)
    expect(looks[0]!.exit).toBeNull()
  })

  it("breaks a run of the same pattern after three groups", () => {
    const groups = Array.from({ length: 5 }, () => group("ลดครึ่งราคา"))
    const looks = enforce(
      groups.map(() => look({ pattern: "bar" })),
      groups,
    )
    // the fourth shows the stack, which ends the run: the fifth may be a bar again
    expect(looks.map((entry) => entry.pattern)).toEqual(["bar", "bar", "bar", "stack", "bar"])
  })

  it("starts the run again after another pattern", () => {
    const groups = Array.from({ length: 5 }, () => group("ลดครึ่งราคา"))
    const patterns = ["bar", "bar", "bar", "punch", "bar"] as const
    const looks = enforce(
      patterns.map((pattern) => look({ pattern })),
      groups,
    )
    expect(looks.map((entry) => entry.pattern)).toEqual(["bar", "bar", "bar", "punch", "bar"])
  })

  it("does not count stacks as a run", () => {
    const groups = Array.from({ length: 5 }, () => group("ลดครึ่งราคา"))
    const looks = enforce(
      groups.map(() => look({ pattern: "stack" })),
      groups,
    )
    expect(looks.every((entry) => entry.pattern === "stack")).toBe(true)
  })

  it("counts a look the user edited in the run", () => {
    const groups = Array.from({ length: 5 }, () => group("ลดครึ่งราคา"))
    const looks = enforce([look({ pattern: "bar", edited: true }), look({ pattern: "bar" }), look({ pattern: "bar" }), look({ pattern: "bar" }), look({ pattern: "bar" })], groups)
    expect(looks.map((entry) => entry.pattern)).toEqual(["bar", "bar", "bar", "stack", "bar"])
  })

  it("keeps a look set by hand whatever run it is in", () => {
    const groups = Array.from({ length: 4 }, () => group("ลดครึ่งราคา"))
    const looks = enforce([look({ pattern: "bar", tone: "alt" }), look({ pattern: "bar", tone: "alt" }), look({ pattern: "bar", tone: "alt" }), look({ pattern: "bar", tone: "alt", edited: true })], groups)
    expect(looks.map((entry) => [entry.pattern, entry.tone])).toEqual([
      ["bar", "alt"],
      ["bar", "alt"],
      ["bar", "alt"],
      ["bar", "alt"],
    ])
  })

  it("counts the runs by what shows, so a look set by hand as it showed leaves its neighbours as they were", () => {
    const groups = Array.from({ length: 5 }, () => group("ลดครึ่งราคา"))
    const asked = groups.map(() => look({ pattern: "bar" }))
    const before = enforce(asked, groups).map((entry) => entry.pattern)
    // the fourth group, shown as the stack, gets a new tone by hand: it is saved as the stack it showed
    const after = enforce([...asked.slice(0, 3), look({ pattern: "stack", tone: "alt", edited: true }), asked[4]!], groups).map((entry) => entry.pattern)
    expect(after).toEqual(before)
  })

  it("counts an edited look towards a run, as the pattern it really shows", () => {
    // the edited stair starts the run, so the fourth stair is one too many
    const groups = Array.from({ length: 4 }, () => group("ลดครึ่งราคา", "วันนี้เท่านั้น"))
    const looks = enforce([look({ pattern: "stair", edited: true }), look({ pattern: "stair" }), look({ pattern: "stair" }), look({ pattern: "stair" })], groups)
    expect(looks.map((entry) => entry.pattern)).toEqual(["stair", "stair", "stair", "stack"])
    // an edited punch the group cannot carry is shown as the stack, and counts as one
    const punches = enforce([look({ pattern: "punch", edited: true }), look({ pattern: "stack" })], groups.slice(0, 2))
    expect(punches.map((entry) => entry.pattern)).toEqual(["stack", "stack"])
  })

  it("drops an accent whose end is past the line in code points but not in UTF-16 units", () => {
    // "990 บาท 🎉" is 9 code points and 10 UTF-16 units: the emoji is one character, not two
    const looks = enforce([look({ accent: { line: 0, from: 8, to: 10 } })], [group("990 บาท 🎉")])
    expect(looks[0]!.accent).toBeNull()
  })

  it("leaves a look the user edited alone, but for what the group cannot carry", () => {
    const edited = look({ pattern: "stair", accent: { line: 1, from: 0, to: 3 }, exit: null, edited: true })
    const groups = [group("ลดครึ่งราคา", "วันนี้เท่านั้น")]
    expect(enforce([edited], groups)[0]).toEqual(edited)
    // a pattern the group has the wrong number of lines for, or that only works on portrait, cannot be drawn
    expect(enforce([{ ...edited, pattern: "punch" }], groups)[0]!.pattern).toBe("stack")
    expect(enforce([{ ...edited, pattern: "bar" }], groups, true)[0]!.pattern).toBe("stack")
    // nor can an exit that does not exist, even with CapCut Pro, or a tone that is not one
    expect(enforce([{ ...edited, exit: "made-up" }], groups, false, true)[0]!.exit).toBeNull()
    expect(enforce([{ ...edited, tone: "loud" as never }], groups)[0]!.tone).toBe("base")
    // an accent on a line or past a line the group does not have cannot be drawn: it would colour nothing, or text that is not there
    for (const accent of [{ line: 9, from: 0, to: 1 }, { line: 1, from: 12, to: 20 }]) {
      expect(enforce([{ ...edited, accent }], groups)[0]).toEqual({ ...edited, accent: null })
    }
  })

  it("gives a group with no look of its own the plain one", () => {
    const looks = enforce([], [group("ลดครึ่งราคา")])
    expect(looks).toEqual([DEFAULT_LOOK])
  })
})

describe("enforceCues", () => {
  const sound = (effectId: string) => ({ effectId, name: `เสียง ${effectId}`, durationUs: 400_000, path: `/cache/${effectId}.mp3` })
  const at = (atUs: number, effectId = "1", anchor: CueAnchor = { kind: "beat", beatId: `b${atUs}`, edge: "start" }, edited = false): PlacedCue => ({
    cue: { anchor, effectId, edited },
    atUs,
    sound: sound(effectId),
  })
  const line = (atUs: number, groupId: string, index: number, effectId = "1", edited = false) =>
    at(atUs, effectId, { kind: "highlight", groupId, line: index }, edited)
  const MINUTE = 60_000_000

  it("keeps every cue however close together, from any group and with any sound: overlaps go on another track", () => {
    const cues = [line(0, "g1", 0), line(500_000, "g2", 0, "2"), at(600_000, "1"), at(1_000_000, "1"), line(1_200_000, "g1", 1)]
    const { kept, dropped } = enforceCues(cues, MINUTE)
    expect(kept.map((cue) => cue.atUs)).toEqual([0, 500_000, 600_000, 1_000_000, 1_200_000])
    expect(dropped).toBe(0)
  })

  it("does not cap how many cues a clip gets: how many is Claude's call and the user's", () => {
    const dense = Array.from({ length: 20 }, (_, i) => at(i * 1_000_000, String(i % 3)))
    expect(enforceCues(dense, 20_000_000).kept).toHaveLength(20)
  })

  it("drops a cue that would start outside the timeline", () => {
    const { kept, dropped } = enforceCues([at(-1), at(0, "2"), at(9_999_999, "3"), at(10_000_000, "4")], 10_000_000)
    expect(kept.map((cue) => cue.atUs)).toEqual([0, 9_999_999])
    expect(dropped).toBe(2)
  })

  it("comes back in time order however the cues came in", () => {
    const { kept } = enforceCues([at(8_000_000, "3"), at(0, "1"), at(4_000_000, "2")], MINUTE)
    expect(kept.map((cue) => cue.atUs)).toEqual([0, 4_000_000, 8_000_000])
  })

  it("comes back in time order even when the user's own cue is the last one", () => {
    const mine = at(9_000_000, "9", { kind: "beat", beatId: "mine", edge: "end" }, true)
    const { kept } = enforceCues([mine, at(0, "1"), at(4_000_000, "2")], MINUTE)
    expect(kept.map((cue) => cue.atUs)).toEqual([0, 4_000_000, 9_000_000])
  })

  it("has nothing to keep on an empty timeline", () => {
    expect(enforceCues([at(0)], 0)).toEqual({ kept: [], dropped: 1 })
    expect(enforceCues([], MINUTE)).toEqual({ kept: [], dropped: 0 })
  })
})

describe("enforceZooms", () => {
  const piece = (atUs: number, durationUs: number, kind: "punch" | "drift" = "punch", edited = false, beatId = "b1", videoId = "v1"): PlacedZoom => ({
    cue: { anchor: { videoId, sourceUs: atUs, beatId }, kind, edited },
    atUs,
    durationUs,
  })
  const MINUTE = 60_000_000

  it("keeps a zoom on a piece long enough for it", () => {
    const { kept, dropped } = enforceZooms([piece(0, 3_000_000, "drift")], MINUTE)
    expect(kept.map((zoom) => zoom.cue.kind)).toEqual(["drift"])
    expect(dropped).toBe(0)
  })

  it("turns a drift on a short piece into a punch", () => {
    const { kept, dropped } = enforceZooms([piece(0, 2_000_000, "drift")], MINUTE)
    expect(kept.map((zoom) => zoom.cue.kind)).toEqual(["punch"])
    expect(dropped).toBe(0)
  })

  it("drops a zoom on a piece too short even to punch", () => {
    expect(enforceZooms([piece(0, 1_000_000)], MINUTE)).toEqual({ kept: [], dropped: 1 })
  })

  it("keeps every zoom however many and however close their pieces sit: no level, no quota", () => {
    const spread = Array.from({ length: 6 }, (_, i) => piece(i * 5_000_000, 3_000_000))
    expect(enforceZooms(spread, 30_000_000).kept).toHaveLength(6)
    const close = enforceZooms([piece(0, 3_000_000), piece(2_000_000, 3_000_000), piece(5_000_000, 3_000_000)], MINUTE)
    expect(close.kept.map((zoom) => zoom.atUs)).toEqual([0, 2_000_000, 5_000_000])
  })

  it("puts one zoom on a piece: a second would write over the first's keyframes, so it is dropped, and the user's comes first", () => {
    const mine = piece(0, 3_000_000, "drift", true)
    const { kept, dropped } = enforceZooms([piece(0, 3_000_000, "punch"), mine], MINUTE)
    expect(kept.map((zoom) => [zoom.cue.kind, zoom.cue.edited])).toEqual([["drift", true]])
    expect(dropped).toBe(1)
    // the same footage in another beat is another piece, and so is another video at the same source time
    expect(enforceZooms([piece(0, 3_000_000), piece(0, 3_000_000, "punch", false, "b2")], MINUTE).kept).toHaveLength(2)
    expect(enforceZooms([piece(0, 3_000_000), piece(0, 3_000_000, "punch", false, "b1", "v2")], MINUTE).kept).toHaveLength(2)
  })

  it("comes back in time order, whatever order the zooms came in", () => {
    const { kept } = enforceZooms([piece(10_000_000, 3_000_000), piece(0, 3_000_000), piece(5_000_000, 3_000_000)], MINUTE)
    expect(kept.map((zoom) => zoom.atUs)).toEqual([0, 5_000_000, 10_000_000])
  })

  it("comes back in time order even when the zoom the user set is the last one", () => {
    const mine = piece(10_000_000, 3_000_000, "punch", true)
    const { kept } = enforceZooms([piece(0, 3_000_000), piece(5_000_000, 3_000_000), mine], MINUTE)
    expect(kept.map((zoom) => zoom.atUs)).toEqual([0, 5_000_000, 10_000_000])
  })

  it("drops a zoom whose piece does not start inside the timeline", () => {
    expect(enforceZooms([piece(0, 3_000_000)], 0)).toEqual({ kept: [], dropped: 1 })
    expect(enforceZooms([piece(10_000_000, 3_000_000)], 10_000_000)).toEqual({ kept: [], dropped: 1 })
    expect(enforceZooms([], MINUTE)).toEqual({ kept: [], dropped: 0 })
  })
})

describe("enforceInserts", () => {
  const photo = (binId: string): BinMedia => ({ binId, path: `/pics/${binId}.jpg`, name: `${binId}.jpg`, kind: "photo", width: 3024, height: 4032, durationUs: 5_000_000 })
  const clip = (binId: string, durationUs: number): BinMedia => ({ ...photo(binId), kind: "video", path: `/clips/${binId}.mp4`, durationUs })
  const insert = (atUs: number, binId = "a", media = photo(binId), edited = false): PlacedInsert => ({
    cue: { anchor: { kind: "beat", beatId: `b${atUs}`, edge: "start" }, binId, edited },
    atUs,
    media,
    durationUs: insertLength(media),
  })
  const MINUTE = 60_000_000

  it("takes the length the caller worked out from the file", () => {
    expect(insertLength(photo("a"))).toBe(2_000_000)
    expect(insertLength(clip("b", 1_200_000))).toBe(1_200_000)
    expect(insertLength(clip("c", 9_000_000))).toBe(3_000_000)
  })

  it("plays a photo for two seconds and a clip for as long as it has, up to three", () => {
    const { kept } = enforceInserts([insert(0, "a"), insert(10_000_000, "b", clip("b", 1_200_000)), insert(20_000_000, "c", clip("c", 9_000_000))], MINUTE)
    expect(kept.map((entry) => entry.durationUs)).toEqual([2_000_000, 1_200_000, 3_000_000])
  })

  it("keeps cutaways that overlap: the writer lays them on tracks of their own", () => {
    const { kept, dropped } = enforceInserts([insert(0, "a"), insert(1_000_000, "b"), insert(2_000_000, "c")], MINUTE)
    expect(kept.map((entry) => entry.atUs)).toEqual([0, 1_000_000, 2_000_000])
    expect(dropped).toBe(0)
  })

  it("shows one file as often as it is asked for", () => {
    const { kept } = enforceInserts([insert(0, "a"), insert(10_000_000, "a")], MINUTE)
    expect(kept.map((entry) => entry.atUs)).toEqual([0, 10_000_000])
  })

  it("cuts a cutaway short at the end of the timeline, and drops one with no room", () => {
    const { kept } = enforceInserts([insert(9_000_000, "a")], 10_000_000)
    expect(kept.map((entry) => entry.durationUs)).toEqual([1_000_000])
    expect(enforceInserts([insert(9_800_000, "a")], 10_000_000)).toEqual({ kept: [], dropped: 1 })
  })

  it("keeps a cutaway of exactly the shortest a shot may be, and drops one a hair shorter", () => {
    expect(enforceInserts([insert(0, "s", clip("s", 700_000))], MINUTE).kept.map((entry) => entry.durationUs)).toEqual([700_000])
    expect(enforceInserts([insert(0, "t", clip("t", 699_999))], MINUTE)).toEqual({ kept: [], dropped: 1 })
  })

  it("does not cap how many cutaways a clip gets: no level, no quota", () => {
    const spread = Array.from({ length: 6 }, (_, i) => insert(i * 5_000_000, `m${i}`))
    expect(enforceInserts(spread, 30_000_000).kept).toHaveLength(6)
  })

  it("comes back in time order, and counts what it left out", () => {
    const mine = insert(20_000_000, "z", photo("z"), true)
    // the last starts too close to the end for even a flash
    const { kept, dropped } = enforceInserts([insert(10_000_000, "a"), insert(MINUTE - 200_000, "c"), mine, insert(0, "b")], MINUTE)
    expect(kept.map((entry) => entry.atUs)).toEqual([0, 10_000_000, 20_000_000])
    expect(dropped).toBe(1)
  })
})

describe("tone", () => {
  it("keeps a tone, and a run of one tone longer than three groups falls back to base", () => {
    const groups = [group("a"), group("b"), group("c"), group("d"), group("e")]
    const looks = enforce(
      groups.map(() => look({ tone: "accent" })),
      groups,
    )
    expect(looks.map((entry) => entry.tone)).toEqual(["accent", "accent", "accent", "base", "accent"])
  })

  it("an unknown tone is base, and an edited look keeps its tone whatever the run", () => {
    const groups = [group("a"), group("b"), group("c"), group("d")]
    const looks = enforce([look({ tone: "loud" as never }), look({ tone: "alt" }), look({ tone: "alt" }), look({ tone: "alt", edited: true })], groups)
    expect(looks.map((entry) => entry.tone)).toEqual(["base", "alt", "alt", "alt"])
    expect(DEFAULT_LOOK.tone).toBe("base")
  })
})
