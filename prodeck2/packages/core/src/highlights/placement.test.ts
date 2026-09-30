import { expect, test } from "vitest"
import type { TimedText } from "../asr/types.ts"
import type { CutPlan } from "../cut/compile.ts"
import type { BeatCut } from "../cut/rules.ts"
import { placeHighlights, SCENE_LABEL_MAX_US, timeHighlights, type HighlightGroup, type PlacedGroup } from "./placement.ts"

const S = 1_000_000

/** Word i of video v1 is said from 1.0 s + 0.5 s × i, for 0.4 s. */
const words: TimedText[] = Array.from({ length: 18 }, (_, i) => ({ text: `w${i}`, startUs: S + (S / 2) * i, endUs: S + (S / 2) * i + 400_000 }))

const beat = (beatId: string, pieces: [number, number][]): BeatCut => ({
  beatId,
  videoId: "v1",
  pieces: pieces.map(([start, end]) => ({ startUs: start * S, endUs: end * S })),
  removals: [],
  originalUs: 0,
  keptUs: 0,
  notes: [],
  rows: [],
})

// beat b1 keeps 1–3 s and 4–6 s, beat b2 keeps 8–10 s; the timeline plays them back to back
const beats = [beat("b1", [[1, 3], [4, 6]]), beat("b2", [[8, 10]])]
const plan: CutPlan = {
  beats,
  cuts: beats.flatMap((b) => b.pieces.map((p) => ({ binId: "v1", sourceStartUs: p.startUs, sourceDurationUs: p.endUs - p.startUs }))),
  durationUs: 6 * S,
}
const wordsOf = (videoId: string) => (videoId === "v1" ? words : [])

const group = (id: string, lines: [number, number, string][]): HighlightGroup => ({
  id,
  source: "ai",
  edited: false,
  lines: lines.map(([from, to, text]) => ({ videoId: "v1", from, to, text })),
})

const place = (...groups: HighlightGroup[]) => placeHighlights({ plan, wordsOf, groups })

test("each line starts at its first word, and the group ends with its last word, even across a cut", () => {
  expect(place(group("g", [[0, 2, "ถ้าคุณ"], [2, 4, "กำลังมองหา"], [6, 8, "ร้านทำเล็บ"]]))).toEqual([
    {
      groupId: "g",
      beatId: "b1",
      videoId: "v1",
      lines: [
        { lineIndex: 0, text: "ถ้าคุณ", cut: 0, sourceUs: 1_000_000, partial: false, words: { from: 0, to: 2 } },
        { lineIndex: 1, text: "กำลังมองหา", cut: 0, sourceUs: 2_000_000, partial: false, words: { from: 2, to: 4 } },
        { lineIndex: 2, text: "ร้านทำเล็บ", cut: 1, sourceUs: 4_000_000, partial: false, words: { from: 6, to: 8 } },
      ],
      end: { cut: 1, sourceUs: 4_900_000 },
    },
  ])
})

test("a word timed with no length at the very end of a piece still shows its line", () => {
  // w18 is said at 3 s exactly, with no length: the end of b1's first piece
  const zero = [...words, { text: "w18", startUs: 3 * S, endUs: 3 * S }]
  const [placed] = placeHighlights({ plan, wordsOf: () => zero, groups: [group("g", [[18, 19, "ท้าย"]])] })
  expect(placed?.lines.map((line) => [line.text, line.cut, line.sourceUs])).toEqual([["ท้าย", 0, 3 * S]])
})

test("Thai text is shown the way it is drawn: sara am written as one character", () => {
  const [placed] = place(group("g", [[0, 2, "ทํา 50"]]))
  expect(placed!.lines[0]!.text).toBe("ทำ 50")
})

test("a line that lost some words starts at the first one left and is marked", () => {
  // words 4 and 5 fall in the gap between the pieces
  const [placed] = place(group("g", [[3, 6, "บางส่วน"]]))
  expect(placed!.lines).toEqual([{ lineIndex: 0, text: "บางส่วน", cut: 0, sourceUs: 2_500_000, partial: true, words: { from: 3, to: 4 } }])
  expect(placed!.end).toEqual({ cut: 0, sourceUs: 2_900_000 })

  const [late] = place(group("g", [[5, 7, "เริ่มทีหลัง"]]))
  expect(late!.lines[0]).toEqual({ lineIndex: 0, text: "เริ่มทีหลัง", cut: 1, sourceUs: 4_000_000, partial: true, words: { from: 6, to: 7 } })
})

test("lines whose words are all cut disappear, and so does a group with nothing left", () => {
  const [placed] = place(group("g", [[0, 2, "อยู่"], [4, 6, "หาย"], [6, 7, "อยู่ด้วย"]]))
  expect(placed!.lines.map((line) => line.lineIndex)).toEqual([0, 2])
  expect(place(group("g", [[4, 6, "หาย"], [10, 14, "หายหมด"]]))).toEqual([])
})

test("a word is kept by where its middle falls", () => {
  // word 3 is said 2.5–2.9 s, so its middle is 2.7 s
  const endingAt = (end: number): CutPlan => ({ ...plan, beats: [beat("b1", [[1, end]])], cuts: [{ binId: "v1", sourceStartUs: S, sourceDurationUs: (end - 1) * S }] })
  const texts = (end: number) => placeHighlights({ plan: endingAt(end), wordsOf, groups: [group("g", [[2, 3, "ก่อน"], [3, 4, "กลาง"]])] })[0]!.lines.map((line) => line.text)
  expect(texts(2.75)).toEqual(["ก่อน", "กลาง"])
  expect(texts(2.7)).toEqual(["ก่อน"])
  // the group ends with the piece, not with the word that runs past it
  expect(placeHighlights({ plan: endingAt(2.75), wordsOf, groups: [group("g", [[3, 4, "กลาง"]])] })[0]!.end).toEqual({ cut: 0, sourceUs: 2_750_000 })

  // a piece starting right at a word's middle keeps the word
  const fromMiddle: CutPlan = { ...plan, beats: [beat("b1", [[2.2, 3]])], cuts: [{ binId: "v1", sourceStartUs: 2.2 * S, sourceDurationUs: 0.8 * S }] }
  expect(placeHighlights({ plan: fromMiddle, wordsOf, groups: [group("g", [[2, 3, "ก่อน"]])] })).toHaveLength(1)

  // another video's piece at the same times does not keep the word
  const otherClip: CutPlan = { ...plan, cuts: plan.cuts.map((cut) => ({ ...cut, binId: "v2" })) }
  expect(placeHighlights({ plan: otherClip, wordsOf, groups: [group("g", [[0, 1, "ก"]])] })).toEqual([])
})

test("a line never starts before the piece it plays in", () => {
  const early: CutPlan = { ...plan, beats: [beat("b1", [[1.1, 3]])], cuts: [{ binId: "v1", sourceStartUs: 1.1 * S, sourceDurationUs: 1.9 * S }] }
  const [placed] = placeHighlights({ plan: early, wordsOf, groups: [group("g", [[0, 1, "ตัดหัว"]])] })
  expect(placed!.lines[0]!.sourceUs).toBe(1_100_000)
})

test("lines in another beat, or said before the line above them, are left out", () => {
  const [otherBeat] = place(group("g", [[8, 10, "ช่วงแรก"], [14, 16, "ช่วงสอง"]]))
  expect(otherBeat!.lines.map((line) => line.text)).toEqual(["ช่วงแรก"])
  expect(otherBeat!.end).toEqual({ cut: 1, sourceUs: 5_900_000 })

  const [backwards] = place(group("g", [[6, 8, "หลัง"], [0, 2, "ก่อน"]]))
  expect(backwards!.lines.map((line) => line.text)).toEqual(["หลัง"])

  const [otherVideo] = placeHighlights({
    plan,
    wordsOf,
    groups: [{ id: "g", source: "user", edited: false, lines: [{ videoId: "v1", from: 0, to: 1, text: "ก" }, { videoId: "v2", from: 0, to: 1, text: "ข" }] }],
  })
  expect(otherVideo!.lines.map((line) => line.text)).toEqual(["ก"])
})

test("a group whose first lines are gone takes its beat from the first line left", () => {
  const [placed] = place(group("g", [[4, 6, "หาย"], [14, 15, "ช่วงสอง"]]))
  expect(placed!.beatId).toBe("b2")
  expect(placed!.lines[0]!.cut).toBe(2)
})

test("groups come out in playing order", () => {
  expect(place(group("late", [[14, 15, "ข"]]), group("early", [[0, 1, "ก"]])).map((g) => g.groupId)).toEqual(["early", "late"])
  expect(place(group("same-cut-later", [[2, 3, "ข"]]), group("same-cut", [[0, 1, "ก"]])).map((g) => g.groupId)).toEqual(["same-cut", "same-cut-later"])
})

test("words past the end of the transcript count as lost", () => {
  const [placed] = place(group("g", [[17, 20, "ท้าย"]]))
  expect(placed!.lines[0]!.partial).toBe(true)
})

// timing on the timeline: cut 0 starts at 0 s, cut 1 at 2 s, cut 2 at 4 s
const offsets = [0, 2 * S, 4 * S]
const at = (cut: number, sourceUs: number) => offsets[cut]! + sourceUs - plan.cuts[cut]!.sourceStartUs

const placed = (groupId: string, lineStarts: number[], lastWordEnd: number): PlacedGroup => ({
  groupId,
  beatId: "b1",
  videoId: "v1",
  lines: lineStarts.map((start, lineIndex) => ({ lineIndex, text: `line ${lineIndex}`, cut: 0, sourceUs: S + start * S, partial: false, words: { from: 0, to: 1 } })),
  end: { cut: 0, sourceUs: S + lastWordEnd * S },
})

test("a group stays up a little after its last word", () => {
  expect(timeHighlights([placed("g", [0, 0.5], 1.8)], at, 6 * S)).toEqual([
    {
      groupId: "g",
      beatId: "b1",
      startUs: 0,
      endUs: 2_000_000,
      lines: [
        { lineIndex: 0, text: "line 0", startUs: 0, partial: false },
        { lineIndex: 1, text: "line 1", startUs: 500_000, partial: false },
      ],
    },
  ])
})

test("a group is up at least 1.2 s, and its last line at least 1 s", () => {
  expect(timeHighlights([placed("g", [0], 0.4)], at, 6 * S)[0]!.endUs).toBe(1_200_000)
  expect(timeHighlights([placed("g", [0, 0.9], 1.3)], at, 6 * S)[0]!.endUs).toBe(1_900_000)
})

test("a group ends where the next one starts and where the timeline ends; lines left with no time are dropped", () => {
  const [first, second] = timeHighlights([placed("b", [1.5], 1.9), placed("a", [0, 1, 1.5], 1.9)], at, 6 * S)
  expect(first!.groupId).toBe("a")
  expect(first!.endUs).toBe(1_500_000)
  expect(first!.lines.map((line) => line.lineIndex)).toEqual([0, 1])
  expect(second!.endUs).toBe(2_700_000)

  expect(timeHighlights([placed("g", [0.5], 1)], at, 1_000_000)[0]!.endUs).toBe(1_000_000)
  expect(timeHighlights([placed("g", [1.5], 1.9)], at, 1_500_000)).toEqual([])
})

test("footage played in two beats shows a group in the beat it was picked from", () => {
  // the hook replays the words the price beat says later
  const twice = [beat("hook", [[1, 3]]), beat("price", [[1, 3]])]
  const replay: CutPlan = {
    beats: twice,
    cuts: twice.flatMap((b) => b.pieces.map((p) => ({ binId: "v1", sourceStartUs: p.startUs, sourceDurationUs: p.endUs - p.startUs }))),
    durationUs: 4 * S,
  }
  const lines = group("g", [[0, 2, "ราคา"], [2, 3, "ถูก"]])
  const [fromPrice] = placeHighlights({ plan: replay, wordsOf, groups: [{ ...lines, beatId: "price" }] })
  expect(fromPrice).toMatchObject({ beatId: "price", lines: [{ cut: 1 }, { cut: 1 }], end: { cut: 1 } })
  // a group that does not say, or names a beat no longer there, takes the first
  expect(placeHighlights({ plan: replay, wordsOf, groups: [lines] })[0]).toMatchObject({ beatId: "hook", lines: [{ cut: 0 }, { cut: 0 }] })
  expect(placeHighlights({ plan: replay, wordsOf, groups: [{ ...lines, beatId: "gone" }] })[0]).toMatchObject({ beatId: "hook" })
})

/** A label on a stretch of v1's picture, from `startUs` to `endUs` of the file, one line per text. */
const label = (id: string, startUs: number, endUs: number, texts: string[], beatId?: string): HighlightGroup => ({
  id,
  source: "ai",
  edited: false,
  lines: texts.map((text) => ({ videoId: "v1", from: 0, to: 0, text })),
  scene: { videoId: "v1", startUs, endUs },
  ...(beatId ? { beatId } : {}),
})

test("a label on a picture stretch shows all its lines at once from the stretch's first kept moment, until its last kept moment", () => {
  // 2.5–5 s of the file: kept from 2.5 s in b1's first piece, across the gap, to 5 s in its second
  expect(place(label("l", 2_500_000, 5_000_000, ["ทํา 1", "สอง"]))).toEqual([
    {
      groupId: "l",
      beatId: "b1",
      videoId: "v1",
      scene: true,
      lines: [
        { lineIndex: 0, text: "ทำ 1", cut: 0, sourceUs: 2_500_000, partial: false, words: { from: 0, to: 0 } },
        { lineIndex: 1, text: "สอง", cut: 0, sourceUs: 2_500_000, partial: false, words: { from: 0, to: 0 } },
      ],
      end: { cut: 1, sourceUs: 5_000_000 },
    },
  ])
  // a stretch that starts in a gap the cut took out shows from where the picture comes back
  expect(place(label("l", 3_200_000, 4_500_000, ["x"]))[0]).toMatchObject({ lines: [{ cut: 1, sourceUs: 4_000_000 }], end: { cut: 1, sourceUs: 4_500_000 } })
})

test("a label stays in one beat: the one it was made in, else the first that plays its stretch; nothing kept, nothing shown", () => {
  expect(place(label("l", 5_000_000, 9_000_000, ["x"]))[0]).toMatchObject({ beatId: "b1", lines: [{ cut: 1, sourceUs: 5_000_000 }], end: { cut: 1, sourceUs: 6_000_000 } })
  expect(place(label("l", 5_000_000, 9_000_000, ["x"], "b2"))[0]).toMatchObject({ beatId: "b2", lines: [{ cut: 2, sourceUs: 8_000_000 }], end: { cut: 2, sourceUs: 9_000_000 } })
  // 3.1–3.9 s is all in the gap between b1's pieces
  expect(place(label("l", 3_100_000, 3_900_000, ["x"]))).toEqual([])
  expect(place({ ...label("l", 1_000_000, 3_000_000, ["x"]), scene: { videoId: "v2", startUs: 1_000_000, endUs: 3_000_000 } })).toEqual([])
})

test("a label is up for its stretch and no longer, at most 3 s, and never into the next group", () => {
  const timeOf = (...groups: HighlightGroup[]) => timeHighlights(place(...groups), at, 6 * S).map((timed) => [timed.groupId, timed.startUs, timed.endUs])
  // 2.5–5 s of the file plays from 1.5 s to 3 s on the timeline
  expect(timeOf(label("l", 2_500_000, 5_000_000, ["x"]))).toEqual([["l", 1_500_000, 3_000_000]])
  // 1–6 s plays for 4 s: cut to 3
  expect(timeOf(label("l", 1_000_000, 6_000_000, ["x"]))).toEqual([["l", 0, SCENE_LABEL_MAX_US]])
  // 2.8–3 s plays for 0.2 s: the label leaves with its stretch, not stretched to 1.2 s over what plays next
  expect(timeOf(label("l", 2_800_000, 3_000_000, ["x"]))).toEqual([["l", 1_800_000, 2_000_000]])
  // w2 is said 1 s into the rough cut: the label ends there
  expect(timeOf(label("l", 1_000_000, 6_000_000, ["x"]), group("g", [[2, 3, "คำ"]]))).toEqual([
    ["l", 0, 1_000_000],
    ["g", 1_000_000, 2_200_000],
  ])
})

test("a group placed and timed says which emphasis point it was made for; one made for none says nothing", () => {
  // words said in b1's first piece, words said in its second, and a label on b2's picture
  const groups = place({ ...group("g", [[0, 2, "ถ้าคุณ"]]), pointId: "p1" }, group("free", [[6, 8, "ร้านทำเล็บ"]]), { ...label("l", 8_000_000, 9_000_000, ["x"]), pointId: "p2" })
  expect(groups.map((entry) => [entry.groupId, entry.pointId])).toEqual([
    ["g", "p1"],
    ["free", undefined],
    ["l", "p2"],
  ])
  expect(groups[1]).not.toHaveProperty("pointId")
  const timed = timeHighlights(groups, at, 6 * S)
  expect(timed.map((entry) => [entry.groupId, entry.pointId])).toEqual([
    ["g", "p1"],
    ["free", undefined],
    ["l", "p2"],
  ])
  expect(timed[1]).not.toHaveProperty("pointId")
})
