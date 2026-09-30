import { expect, test } from "vitest"
import { buildSpeech } from "./speech.ts"

test("writes SARA AM the way Thai keyboards do, whatever the engine produced", () => {
  const speech = buildSpeech([{ kind: "fragment", text: "กําลัง", startUs: 0, endUs: 600_000 }])
  expect(speech.utterances[0]!.text).toBe("กำลัง")
  expect(speech.words.map((w) => w.text)).toEqual(["กำลัง"])
})

test("joins NIKHAHIT and SARA AA into SARA AM even when they arrive in separate fragments", () => {
  const speech = buildSpeech([
    { kind: "fragment", text: "กํ", startUs: 0, endUs: 200_000 },
    { kind: "fragment", text: "าลัง", startUs: 200_000, endUs: 600_000 },
  ])
  expect(speech.utterances[0]!.text).toBe("กำลัง")
  expect(speech.words).toEqual([{ text: "กำลัง", startUs: 0, endUs: 600_000 }])
})

test("a word break the engine put between NIKHAHIT and SARA AA is not a break: the character is one", () => {
  const speech = buildSpeech([
    { kind: "fragment", text: "กํ", startUs: 0, endUs: 200_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "าลัง", startUs: 200_000, endUs: 600_000 },
  ])
  expect(speech.utterances[0]!.text).toBe("กำลัง")
  expect(speech.words.map((w) => w.text)).toEqual(["กำลัง"])
})

test("a break the engine put before a vowel or tone mark that cannot begin a syllable is not a break: the mark stays on its letter", () => {
  // a break, and a long gap, between ด and its vowel; between ก and its tone mark
  const speech = buildSpeech([
    { kind: "fragment", text: "ด", startUs: 0, endUs: 100_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "ีมาก", startUs: 600_000, endUs: 900_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "ก", startUs: 1_000_000, endUs: 1_100_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "่อน", startUs: 1_200_000, endUs: 1_400_000 },
  ])
  expect(speech.utterances.map((u) => u.text)).toEqual(["ดีมาก ก่อน"])
  expect(speech.words.map((w) => w.text)).toEqual(["ดี", "มาก", "ก่อน"])
  expect(speech.words.every((word) => !/^[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/u.test(word.text))).toBe(true)
})

test("a mark on its own after a break joins the letter before it, and only a Thai letter", () => {
  const speech = buildSpeech([
    { kind: "fragment", text: "ไป", startUs: 0, endUs: 200_000 },
    { kind: "fragment", text: "่", startUs: 200_000, endUs: 300_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "ok", startUs: 900_000, endUs: 1_000_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "ๆ", startUs: 1_000_000, endUs: 1_100_000 },
  ])
  expect(speech.words.find((word) => word.text.startsWith("ไป"))).toEqual({ text: "ไป่", startUs: 0, endUs: 300_000 })
  // ๆ repeats the word before it and is written after a space: it is not glued on
  expect(speech.utterances.at(-1)!.text).toMatch(/ok ๆ$/)
  const repeat = buildSpeech([
    { kind: "fragment", text: "ดี", startUs: 0, endUs: 200_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "ๆ", startUs: 200_000, endUs: 300_000 },
  ])
  expect(repeat.utterances.map((u) => u.text)).toEqual(["ดี ๆ"])
  // a Thai mark after a Latin letter has no letter of its own to go on: it is left where it is
  const stray = buildSpeech([
    { kind: "fragment", text: "ok", startUs: 0, endUs: 200_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "่", startUs: 200_000, endUs: 300_000 },
  ])
  expect(stray.utterances.map((u) => u.text)).toEqual(["ok ่"])
})

test("a word break inside SARA AM does not end the sentence there, however long the gap after it", () => {
  const speech = buildSpeech([
    { kind: "fragment", text: "กํ", startUs: 0, endUs: 100_000 },
    { kind: "boundary" },
    { kind: "fragment", text: "าลัง", startUs: 600_000, endUs: 900_000 },
  ])
  expect(speech.utterances.map((u) => u.text)).toEqual(["กำลัง"])
  expect(speech.words.map((w) => w.text)).toEqual(["กำลัง"])
})
