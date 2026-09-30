import { expect, test } from "vitest"
import type { TimedText } from "../asr/types.ts"
import { changesMeaning, falseStarts, isFiller, repeatedUtterancePairs, repeatedUtterances } from "./words.ts"

/** "word@start-end" in seconds, the way the real transcripts were dumped. */
const words = (dump: string): TimedText[] =>
  dump
    .trim()
    .split(/\s+/)
    .map((item) => {
      const [text, times] = item.split("@") as [string, string]
      const [start, end] = times.split("-").map((s) => Math.round(Number(s) * 1_000_000)) as [number, number]
      return { text, startUs: start, endUs: end }
    })

const utterance = (text: string, startSec: number, endSec: number): TimedText => ({
  text,
  startUs: startSec * 1_000_000,
  endUs: endSec * 1_000_000,
})

test("isFiller knows hesitation sounds but not words that carry meaning", () => {
  for (const filler of ["เอ่อ", "อืม", "เอิ่ม", "อ่า", "um", "Uh,"]) expect(isFiller(filler), filler).toBe(true)
  for (const word of ["คือ", "แบบ", "ครับ", "อาหาร", "อ้าว", "เออ", "umbrella"]) expect(isFiller(word), word).toBe(false)
})

// whisper.cpp on IMG_9646.MOV: the countdown fails once and starts over
const COUNTDOWN = words("ขึ้น@17.16-17.44 ไป@17.44-17.68 ใน@17.68-18.08 อวกาศ@18.08-18.75 ใน@19.00-19.78 สาม@19.78-20.51 สอง@20.66-21.14 หนึ่ง@21.56-22.06 สาม@22.62-23.58 สอง@23.88-24.84 หนึ่ง@24.84-25.25")

test("falseStarts finds a phrase started over after a pause, keeping the last take", () => {
  expect(falseStarts(COUNTDOWN)).toEqual([{ from: 5, to: 8 }])
})

test("falseStarts takes a spoken 'oops' as the break before a restart, even without a pause", () => {
  // Scribe segments "เอ้ย" as two pieces
  const said = words("สาม@19.80-20.40 สอง@20.40-21.00 หนึ่ง@21.56-22.00 เอ้@22.00-22.10 ย@22.10-22.18 สาม@22.20-23.00 สอง@23.00-23.60 หนึ่ง@23.60-24.20")
  expect(falseStarts(said)).toEqual([{ from: 0, to: 5 }])
})

test("falseStarts keeps only the last of three takes", () => {
  const said = words("ลอง@1.0-1.2 ดู@1.2-1.4 ลอง@2.0-2.2 ดู@2.2-2.4 ผล@2.4-2.6 ลอง@3.2-3.4 ดู@3.4-3.6 ผล@3.6-3.8 งาน@3.8-4.0")
  expect(falseStarts(said)).toEqual([
    { from: 0, to: 2 },
    { from: 2, to: 5 },
  ])
})

test("falseStarts leaves alone a phrase that comes back much later", () => {
  const said = words("ตอน@14.06-14.26 นี้@14.26-14.72 และ@16.06-16.48 ตอน@26.76-26.94 นี้@26.94-27.08")
  expect(falseStarts(said)).toEqual([])
})

test("falseStarts leaves alone a repeat spoken straight through, with no break before it", () => {
  const said = words("ดี@1.00-1.20 ครับ@1.20-1.40 ผม@1.40-1.60 สวย@1.60-1.80 ครับ@1.80-2.00 ผม@2.00-2.20")
  expect(falseStarts(said)).toEqual([])
})

test("falseStarts needs more than one repeated word", () => {
  const said = words("หลาย@5.94-6.16 หลาย@6.50-6.70 สไตล์@6.70-7.04 สาย@7.56-7.74 หวาน@7.74-8.27 สาย@8.42-8.68 หรู@8.68-9.14")
  expect(falseStarts(said)).toEqual([])
})

test("falseStarts does not cut a long stretch between two similar openings", () => {
  const said = words("เรา@1.0-1.2 จะ@1.2-1.4 ไป@1.4-1.6 ทะเล@1.6-1.8 กับ@1.8-2.0 เพื่อน@2.0-2.2 ที่@2.2-2.4 สนิท@2.4-2.6 เรา@3.0-3.2 จะ@3.2-3.4 กิน@3.4-3.6")
  expect(falseStarts(said)).toEqual([])
})

test("repeatedUtterances drops the earlier take of a sentence said twice, even when misheard", () => {
  const said = [
    utterance("เขาต้องไปด้วยกระสวยอวกาศเท่านั้น", 10, 13),
    utterance("เขาต้องไปด้วยกับสวยอวกาศเท่านั้น", 14, 17),
    utterance("ตอนนี้เราอยู่ในอวกาศกันแล้ว", 18, 21),
  ]
  expect(repeatedUtterances(said)).toEqual([0])
})

test("repeatedUtterances drops a sentence abandoned halfway and then said in full", () => {
  const said = [utterance("ลองดูผลงานเรา", 3, 4), utterance("ลองดูผลงานเราก่อนนะครับ", 5, 7)]
  expect(repeatedUtterances(said)).toEqual([0])
})

test("repeatedUtterancePairs says which later line repeats each earlier one", () => {
  const said = [utterance("ลองดูผลงานเรา", 3, 4), utterance("สวัสดีครับทุกคน", 4.2, 4.8), utterance("ลองดูผลงานเราก่อนนะครับ", 5, 7)]
  expect(repeatedUtterancePairs(said)).toEqual([[0, 2]])
  expect(repeatedUtterances(said)).toEqual([0])
})

test("repeatedUtterances ignores short acknowledgements and repeats far apart", () => {
  expect(repeatedUtterances([utterance("ครับ", 1, 2), utterance("ครับ", 3, 4)])).toEqual([])
  expect(repeatedUtterances([utterance("ลองดูผลงานเราก่อน", 1, 3), utterance("ลองดูผลงานเราก่อน", 20, 22)])).toEqual([])
})

test("a line said again with another number, or with ไม่ added or dropped, may say something else", () => {
  expect(changesMeaning("ตัวนี้ราคา 590 บาท", "ตัวนี้ราคา 790 บาท")).toBe(true)
  expect(changesMeaning("ลด ๕๐ เปอร์เซ็นต์", "ลด 30 เปอร์เซ็นต์")).toBe(true)
  expect(changesMeaning("ถ้าคุณชอบกาแฟ", "ถ้าคุณไม่ชอบกาแฟก็ไม่เป็นไร")).toBe(true)
  // the same number written two ways, or a number broken off and then said in full, is the same line
  expect(changesMeaning("ราคา 1,290 บาท", "ราคา 1290 บาท")).toBe(false)
  expect(changesMeaning("ราคา ๕๙๐ บาท", "ราคา 590 บาท")).toBe(false)
  expect(changesMeaning("ราคา 5", "ราคา 590 บาท")).toBe(false)
  // a line broken off before its number says nothing against the number that follows
  expect(changesMeaning("ตัวนี้ราคา", "ตัวนี้ราคา 590 บาท")).toBe(false)
  expect(changesMeaning("เขาต้องไปด้วยกระสวย", "เค้าต้องไปด้วยกระสวยอวกาศ")).toBe(false)
  // ใหม่ and ไม้ are not ไม่
  expect(changesMeaning("ของใหม่", "ของไม้")).toBe(false)
})

test("a number said in full before a restart is a different number, even when the later one starts the same", () => {
  expect(changesMeaning("ลดเหลือ 59 บาท", "ลดเหลือ 590 บาท")).toBe(true)
  // broken off at the end of the take: the same number, said again in full
  expect(changesMeaning("ลดเหลือ 59", "ลดเหลือ 590 บาท")).toBe(false)
})

test("numbers said as Thai words count as numbers, and a countdown said again is still the same line", () => {
  expect(changesMeaning("ราคาห้าร้อยเก้าสิบบาท", "ราคาเจ็ดร้อยเก้าสิบบาท")).toBe(true)
  expect(changesMeaning("ลดยี่สิบเอ็ดเปอร์เซ็นต์", "ลด 21 เปอร์เซ็นต์")).toBe(false)
  expect(changesMeaning("หนึ่งพันสองร้อย", "1,200")).toBe(false)
  expect(changesMeaning("ลดสิบบาท", "ลด 10 บาท")).toBe(false)
  expect(changesMeaning("ลดสิบบาท", "ลดร้อยบาท")).toBe(true)
  expect(changesMeaning("ในสาม สอง", "สาม สอง หนึ่ง")).toBe(false)
  expect(changesMeaning("สามสองหนึ่ง", "สาม สอง หนึ่ง")).toBe(false)
})
