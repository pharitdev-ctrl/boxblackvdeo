import { expect, test } from "vitest"
import type { TimedText } from "../asr/types.ts"
import { textLength } from "../subtitles/captions.ts"
import { groupsFromWords } from "./manual.ts"

const said = ["วันนี้", "จะ", "มา", "รีวิว", "ร้าน", "ทำเล็บ", "ที่", "จตุจักร", "ราคา", "ไม่", "แพง", "เลย", "ค่ะ", "ทุกคน", "ลอง", "ไป", "ดู", "กัน", "นะ", "คะ"]
const words: TimedText[] = said.map((text, i) => ({ text, startUs: i * 400_000, endUs: i * 400_000 + 350_000 }))

function ids() {
  let n = 0
  return () => `u${++n}`
}

test("a sentence the user picks is split into readable lines of one group", () => {
  const groups = groupsFromWords({ videoId: "v1", words, indexes: [0, 1, 2, 3, 4, 5], maxChars: 12, newId: ids() })
  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ id: "u1", source: "user", edited: false })
  const lines = groups[0]!.lines
  expect(lines.map((line) => line.text).join("")).toBe("วันนี้จะมารีวิวร้านทำเล็บ")
  expect(lines.every((line) => line.videoId === "v1" && textLength(line.text) <= 12)).toBe(true)
  // the lines cover the words in order, without gaps
  expect(lines[0]!.from).toBe(0)
  expect(lines.at(-1)!.to).toBe(6)
  lines.slice(1).forEach((line, i) => expect(line.from).toBe(lines[i]!.to))
})

test("a long sentence becomes several groups of up to three lines", () => {
  const groups = groupsFromWords({ videoId: "v1", words, indexes: said.map((_, i) => i), maxChars: 8, newId: ids() })
  expect(groups.length).toBeGreaterThan(1)
  expect(groups.map((group) => group.id)).toEqual(groups.map((_, i) => `u${i + 1}`))
  expect(groups.every((group) => group.lines.length >= 1 && group.lines.length <= 3)).toBe(true)
  expect(groups.slice(0, -1).every((group) => group.lines.length === 3)).toBe(true)
  expect(groups.flatMap((group) => group.lines).map((line) => line.text).join("")).toBe(said.join(""))
})

test("indexes outside the transcript or repeated are ignored, and nothing left means no group", () => {
  const groups = groupsFromWords({ videoId: "v1", words, indexes: [9, 8, 8, 99, -1], maxChars: 12, newId: ids() })
  expect(groups.flatMap((group) => group.lines)).toEqual([{ videoId: "v1", from: 8, to: 10, text: "ราคาไม่" }])
  expect(groupsFromWords({ videoId: "v1", words, indexes: [50], maxChars: 12, newId: ids() })).toEqual([])
})
