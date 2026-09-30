import { expect, test } from "vitest"
import type { TimedText } from "./types.ts"
import { wordsFromFragments } from "./words.ts"

const frag = (text: string, startUs: number, endUs: number): TimedText => ({ text, startUs, endUs })

test("joins sub-word Thai fragments into dictionary words, timed by the fragments", () => {
  const utterance = frag("วันนี้อากาศดี", 0, 1_300_000)
  const fragments = [
    frag("ว", 0, 100_000),
    frag("ันน", 100_000, 400_000),
    frag("ี้", 400_000, 600_000),
    frag("อากาศ", 600_000, 1_000_000),
    frag("ดี", 1_000_000, 1_300_000),
  ]
  // ICU segments "วันนี้" as two words
  expect(wordsFromFragments([utterance], fragments)).toEqual([
    frag("วัน", 0, 300_000),
    frag("นี้", 300_000, 600_000),
    frag("อากาศ", 600_000, 1_000_000),
    frag("ดี", 1_000_000, 1_300_000),
  ])
})

test("splits a fragment that covers two words by spreading its time across characters", () => {
  const utterance = frag("ดีมาก", 0, 1_000_000)
  // one fragment of 5 code units (ด ี ม า ก) — "ดี" gets the first 2/5 of its time
  expect(wordsFromFragments([utterance], [frag("ดีมาก", 0, 1_000_000)])).toEqual([
    frag("ดี", 0, 400_000),
    frag("มาก", 400_000, 1_000_000),
  ])
})

test("keeps English words that the engine already delivers whole", () => {
  const utterance = frag("เปิด teleport เลย", 0, 1_500_000)
  const fragments = [frag("เปิด", 0, 400_000), frag(" teleport", 400_000, 1_100_000), frag(" เลย", 1_100_000, 1_500_000)]
  expect(wordsFromFragments([utterance], fragments).map((w) => w.text)).toEqual(["เปิด", "teleport", "เลย"])
})

test("assigns fragments to the utterance they mostly overlap", () => {
  const first = frag("หนึ่ง", 0, 500_000)
  const second = frag("สอง", 600_000, 1_000_000)
  const fragments = [frag("หนึ่ง", 0, 520_000), frag("สอง", 580_000, 1_000_000)]
  expect(wordsFromFragments([first, second], fragments)).toEqual([frag("หนึ่ง", 0, 520_000), frag("สอง", 580_000, 1_000_000)])
})

test("falls back to the raw fragments when they do not spell the utterance", () => {
  const utterance = frag("สวัสดี", 0, 500_000)
  const fragments = [frag("สวัส", 0, 300_000), frag("ดีครับ", 300_000, 500_000)]
  expect(wordsFromFragments([utterance], fragments)).toEqual(fragments)
})
