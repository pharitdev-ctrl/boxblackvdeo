import { describe, expect, test } from "vitest"
import type { TimedText } from "../asr/types.ts"
import type { Cut } from "../capcut/types.ts"
import { buildCaptions, captionLimits, joinWords, textLength } from "./captions.ts"

const word = (text: string, startS: number, endS: number): TimedText => ({ text, startUs: Math.round(startS * 1e6), endUs: Math.round(endS * 1e6) })
const cut = (binId: string, fromS: number, toS: number): Cut => ({ binId, sourceStartUs: Math.round(fromS * 1e6), sourceDurationUs: Math.round((toS - fromS) * 1e6) })

describe("textLength", () => {
  test("counts what takes room on screen: Thai vowel and tone marks ride on their consonant", () => {
    expect(textLength("ที่นี่")).toBe(2)
    expect(textLength("น้ำ")).toBe(1)
    expect(textLength("Hello")).toBe(5)
  })
})

describe("joinWords", () => {
  test("Thai words run together and other words keep a space", () => {
    expect(joinWords(["วัน", "นี้", "จะ", "มา"])).toBe("วันนี้จะมา")
    expect(joinWords(["hello", "world"])).toBe("hello world")
    expect(joinWords(["รีวิว", "iPhone", "17", "ครับ"])).toBe("รีวิว iPhone 17 ครับ")
  })
})

describe("captionLimits", () => {
  test("short captions are a few words that change at every breath; a line fits the frame and rides over short pauses", () => {
    expect(captionLimits("short", { width: 1080, height: 1920 })).toEqual({ maxChars: 10, pauseUs: 300_000 })
    expect(captionLimits("short", { width: 1920, height: 1080 })).toEqual({ maxChars: 10, pauseUs: 300_000 })
    expect(captionLimits("line", { width: 1080, height: 1920 })).toEqual({ maxChars: 20, pauseUs: 600_000 })
    expect(captionLimits("line", { width: 1080, height: 1080 })).toEqual({ maxChars: 20, pauseUs: 600_000 })
    expect(captionLimits("line", { width: 1920, height: 1080 })).toEqual({ maxChars: 35, pauseUs: 600_000 })
  })
})

describe("buildCaptions", () => {
  test("a short word at the end of a breath is not left alone when an even split fits", () => {
    const said = [word("ขึ้น", 1.0, 1.2), word("ไป", 1.2, 1.4), word("ใน", 1.4, 1.6), word("อวกาศ", 1.6, 2.0), word("ใน", 2.0, 2.2)]
    const captions = buildCaptions({ cuts: [cut("v", 0, 3)], wordsOf: () => said, maxChars: 12, pauseUs: 600_000 })
    expect(captions.map((caption) => caption.text)).toEqual(["ขึ้นไปใน", "อวกาศใน"])
  })


  const speech = [
    word("วัน", 1.0, 1.2),
    word("นี้", 1.2, 1.4),
    word("จะ", 1.4, 1.5),
    word("มา", 1.5, 1.6),
    word("รีวิว", 1.6, 2.0),
    // a pause of 0.4 s
    word("แอป", 2.4, 2.7),
    word("ตัด", 2.7, 2.9),
    word("ต่อ", 2.9, 3.1),
  ]
  const wordsOf = (binId: string) => (binId === "a" ? speech : [])

  test("words of one cut become one caption while they fit, with the caption held after the last word", () => {
    expect(buildCaptions({ cuts: [cut("a", 0.9, 2.2)], wordsOf, maxChars: 20, pauseUs: 300_000 })).toEqual([
      { cut: 0, startUs: 1_000_000, endUs: 2_200_000, text: "วันนี้จะมารีวิว" },
    ])
  })

  test("a pause as long as the limit starts a new caption, and the one before ends where the next begins at the latest", () => {
    const captions = buildCaptions({ cuts: [cut("a", 0.9, 4)], wordsOf, maxChars: 20, pauseUs: 400_000 })
    expect(captions).toEqual([
      { cut: 0, startUs: 1_000_000, endUs: 2_400_000, text: "วันนี้จะมารีวิว" },
      { cut: 0, startUs: 2_400_000, endUs: 3_600_000, text: "แอปตัดต่อ" },
    ])
  })

  test("a pause shorter than the limit keeps the words together", () => {
    expect(buildCaptions({ cuts: [cut("a", 0.9, 4)], wordsOf, maxChars: 20, pauseUs: 401_000 }).map((c) => c.text)).toEqual(["วันนี้จะมารีวิวแอปตัดต่อ"])
  })

  test("words said in one breath that need more than one caption are shared evenly between as few captions as possible", () => {
    // 4+4+4+4+4+4+2 characters: filling the first caption would leave 20 and 6
    const said = ["แมวดำ", "ปลาทู", "หมูปิ้ง", "นมสด", "กาแฟ", "เงาะ", "นะ"]
    expect(said.map(textLength)).toEqual([4, 4, 4, 4, 4, 4, 2])
    const words = said.map((text, i) => word(text, i * 0.3, (i + 1) * 0.3))
    expect(buildCaptions({ cuts: [cut("a", 0, 3)], wordsOf: () => words, maxChars: 20, pauseUs: 600_000 }).map((c) => c.text)).toEqual([
      "แมวดำปลาทูหมูปิ้ง",
      "นมสดกาแฟเงาะนะ",
    ])
  })

  test("a short pause inside a breath is where a caption would rather break", () => {
    // 4 × 6 characters would split evenly after the third word, but the speaker pauses 0.4 s after the second
    const said = ["แมวดำ", "ปลาทู", "หมูปิ้ง", "นมสด", "กาแฟ", "มังคุด"]
    const words = said.map((text, i) => word(text, i * 0.3 + (i >= 2 ? 0.4 : 0), (i + 1) * 0.3 + (i >= 2 ? 0.4 : 0)))
    expect(buildCaptions({ cuts: [cut("a", 0, 3)], wordsOf: () => words, maxChars: 20, pauseUs: 600_000 }).map((c) => c.text)).toEqual([
      "แมวดำปลาทู",
      "หมูปิ้งนมสดกาแฟมังคุด",
    ])
  })

  test("a caption stays on screen at most half a second after its last word", () => {
    const spaced = [word("หนึ่ง", 1, 1.5), word("สอง", 3, 3.5)]
    expect(buildCaptions({ cuts: [cut("a", 0, 5)], wordsOf: () => spaced, maxChars: 20, pauseUs: 300_000 }).map((c) => [c.startUs, c.endUs])).toEqual([
      [1_000_000, 2_000_000],
      [3_000_000, 4_000_000],
    ])
  })

  test("a caption breaks before the word that would make it too long; a word longer than the limit stands alone", () => {
    expect(buildCaptions({ cuts: [cut("a", 0.9, 2.2)], wordsOf, maxChars: 6, pauseUs: 300_000 }).map((c) => c.text)).toEqual(["วันนี้จะ", "มารีวิว"])
    const long = [word("สวัสดี", 0, 0.5), word("ประชาสัมพันธ์", 0.5, 1.2), word("ครับ", 1.2, 1.4)]
    expect(buildCaptions({ cuts: [cut("a", 0, 2)], wordsOf: () => long, maxChars: 5, pauseUs: 300_000 }).map((c) => c.text)).toEqual(["สวัสดี", "ประชาสัมพันธ์", "ครับ"])
  })

  test("captions never cross a cut, and each belongs to the cut it plays in", () => {
    const captions = buildCaptions({ cuts: [cut("a", 2.3, 3.2), cut("a", 0.9, 1.5)], wordsOf, maxChars: 20, pauseUs: 300_000 })
    expect(captions).toEqual([
      { cut: 0, startUs: 2_400_000, endUs: 3_200_000, text: "แอปตัดต่อ" },
      { cut: 1, startUs: 1_000_000, endUs: 1_500_000, text: "วันนี้จะ" },
    ])
  })

  test("only words whose middle lies inside a kept cut are shown, and a caption starts no earlier than its cut", () => {
    // "มา" (1.5–1.6) was cut out as a filler between the two pieces; "จะ" straddles the first edge
    const captions = buildCaptions({ cuts: [cut("a", 1.44, 1.5), cut("a", 1.6, 2.1)], wordsOf, maxChars: 20, pauseUs: 300_000 })
    expect(captions).toEqual([
      { cut: 0, startUs: 1_440_000, endUs: 1_500_000, text: "จะ" },
      { cut: 1, startUs: 1_600_000, endUs: 2_100_000, text: "รีวิว" },
    ])
  })

  test("a word the engine timed with no length is not lost: it goes with the words said with it", () => {
    // whisper's word times come in 20 ms steps and never go backwards, so two words can share a start
    const said = [word("ก", 1.0, 1.0), word("ขข", 1.0, 1.3), word("คค", 1.3, 1.6)]
    const captions = buildCaptions({ cuts: [cut("a", 0.9, 2.2)], wordsOf: () => said, maxChars: 2, pauseUs: 300_000 })
    expect(captions.every((caption) => caption.endUs > caption.startUs)).toBe(true)
    expect(captions.map((caption) => caption.text).join("")).toBe("กขขคค")
  })

  test("a word timed with no length at the very end of a cut is not lost", () => {
    // whisper's 20 ms steps: the last word kept shares its time with the cut's end
    const said = [word("ขข", 1.0, 1.3), word("ก", 1.5, 1.5)]
    const captions = buildCaptions({ cuts: [cut("a", 0.9, 1.5)], wordsOf: () => said, maxChars: 20, pauseUs: 300_000 })
    expect(captions.map((caption) => caption.text).join("")).toBe("ขขก")
  })

  test("a word with no length alone at the end of a cut joins the caption before it, rather than get one with no time on screen", () => {
    const said = [word("ดี", 1.0, 1.5), word("ครับ", 2.0, 2.0)]
    const captions = buildCaptions({ cuts: [cut("a", 1.0, 2.0)], wordsOf: () => said, maxChars: 20, pauseUs: 300_000 })
    expect(captions).toEqual([{ cut: 0, startUs: 1_000_000, endUs: 2_000_000, text: "ดีครับ" }])
  })

  test("a word with no length at the end of a cut is never put on another cut's caption", () => {
    const said = [word("ขข", 1.0, 1.3), word("ก", 3.5, 3.5)]
    const captions = buildCaptions({ cuts: [cut("a", 0.9, 1.5), cut("a", 3.0, 3.5)], wordsOf: () => said, maxChars: 20, pauseUs: 300_000 })
    expect(captions.find((caption) => caption.cut === 0)!.text).toBe("ขข")
  })

  test("clips without words, or cuts between words, give no captions", () => {
    expect(buildCaptions({ cuts: [cut("b", 0, 5), cut("a", 3.2, 4)], wordsOf, maxChars: 20, pauseUs: 300_000 })).toEqual([])
  })
})
