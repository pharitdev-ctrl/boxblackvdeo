import type { TimedText } from "../asr/types.ts"

/**
 * Spotting fillers and retakes from transcript text alone (ported from prodeck1
 * fillers.ts / retakes.ts, reworked for word-level times). Everything here decides what
 * spoken material gets cut, so it errs towards leaving things in: a missed filler costs a
 * second of footage, a wrong guess deletes something the speaker meant to say.
 */

/** Only compares the letters: engines add spacing and punctuation inconsistently. */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s​]+/g, "")
    .replace(/[.,!?;:"'()[\]{}…\-–—]/g, "")
}

/**
 * Pure hesitation sounds. Words that are often filler but also real words ("คือ", "แบบ",
 * "ก็", "นะ", "เออ" as "yes") are deliberately left out — text alone cannot tell them apart.
 */
const FILLERS = new Set([
  "เอ่อ", "เอิ่ม", "เอ้อ", "อ่า", "อ้า", "อา", "อืม", "อึม", "อื้ม", "เอ๋อ", "อ๊ะ",
  "um", "umm", "uh", "uhh", "uhm", "erm", "hmm", "mm",
])

export function isFiller(text: string): boolean {
  return FILLERS.has(normalizeWord(text))
}

/** "Oops" words a speaker says before starting a line again. ICU splits "เอ้ย" as "เอ้|ย", so they are matched on joined text. */
const RETAKE_MARKERS = ["เอ้ย", "เอ๊ย", "โทษที"]

const THAI_DIGITS: Record<string, number> = {
  ศูนย์: 0, หนึ่ง: 1, เอ็ด: 1, ยี่: 2, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9,
}
const THAI_UNITS: Record<string, number> = { สิบ: 10, ร้อย: 100, พัน: 1_000, หมื่น: 10_000, แสน: 100_000, ล้าน: 1_000_000 }
// longest first, so a word is read whole
const THAI_NUMBER_WORDS = [...Object.keys(THAI_DIGITS), ...Object.keys(THAI_UNITS)].sort((a, b) => b.length - a.length)

/** Thai digits as Arabic ones, and thousands separators dropped: how a number compares whichever way it was written. */
const plainDigits = (text: string) => text.replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50)).replace(/(?<=\d),(?=\d{3})/g, "")

/**
 * The numbers said, in order, however they were written: "590", "๕๙๐" and "ห้าร้อยเก้าสิบ" are
 * all 590. Number words run together only while they make one number, so a countdown
 * "สามสองหนึ่ง" is three.
 */
function numbersIn(text: string): string[] {
  const plain = plainDigits(text)
  const found: string[] = []
  let value = 0
  let digit: number | null = null
  let open = false
  const close = () => {
    if (open) found.push(String(value + (digit ?? 0)))
    value = 0
    digit = null
    open = false
  }
  for (let at = 0; at < plain.length; ) {
    const arabic = /^\d+(?:\.\d+)?/.exec(plain.slice(at))?.[0]
    if (arabic) {
      close()
      found.push(arabic)
      at += arabic.length
      continue
    }
    const word = THAI_NUMBER_WORDS.find((candidate) => plain.startsWith(candidate, at))
    if (!word) {
      close()
      at += 1
      continue
    }
    if (word in THAI_DIGITS) {
      // two digits in a row are two numbers, as a countdown says them
      if (digit !== null) close()
      digit = THAI_DIGITS[word]!
    } else if (THAI_UNITS[word] === 1_000_000) {
      value = (value + (digit ?? 1)) * 1_000_000
      digit = null
    } else {
      value += (digit ?? 1) * THAI_UNITS[word]!
      digit = null
    }
    open = true
    at += word.length
  }
  close()
  return found
}

/**
 * Whether a line said again may say something else: another number (a second price is not a
 * corrected first one, as far as text can tell), or "ไม่" said a different number of times. A
 * number the earlier take broke off on — its last word — is the same number said in full later.
 */
export function changesMeaning(earlier: string, later: string): boolean {
  const before = numbersIn(earlier)
  const after = numbersIn(later)
  const endsOn = (number: string) => plainDigits(earlier).trimEnd().endsWith(number)
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const brokenOff = i === before.length - 1 && endsOn(before[i]!) && after[i]!.startsWith(before[i]!)
    if (before[i] !== after[i] && !brokenOff) return true
  }
  const nots = (text: string) => (text.match(/ไม่/g) ?? []).length
  return nots(earlier) !== nots(later)
}

/** A restart comes quickly; a phrase that returns later was meant to. */
const MAX_RESTART_US = 8_000_000
/** Speakers break off before starting again; a repeat spoken straight through is emphasis or chance. */
const MIN_RESTART_GAP_US = 250_000
const MIN_MATCH_WORDS = 2
const MIN_MATCH_CHARS = 4
/** Words allowed between the repeated opening and the restart (the abandoned rest of the line, an "oops"). */
export const MAX_EXTRA_WORDS = 4

/**
 * Word ranges to drop because the speaker started the same phrase again: [from, to) runs
 * from the first take's opening word up to the word where the restart begins. The last
 * take always stays.
 */
export function falseStarts(words: TimedText[]): { from: number; to: number }[] {
  const norm = words.map((word) => normalizeWord(word.text))
  const ranges: { from: number; to: number }[] = []

  let i = 0
  while (i < words.length) {
    let restart = -1
    for (let j = i + 1; j < words.length && words[j]!.startUs - words[i]!.startUs <= MAX_RESTART_US; j++) {
      const paused = words[j]!.startUs - words[j - 1]!.endUs >= MIN_RESTART_GAP_US
      const spokenBreak = (norm[j - 2] ?? "") + norm[j - 1]!
      if (!paused && !RETAKE_MARKERS.some((marker) => spokenBreak.endsWith(marker))) continue

      let k = 0
      while (i + k < j && j + k < words.length && norm[i + k] !== "" && norm[i + k] === norm[j + k]) k++
      const chars = norm.slice(i, i + k).join("").length
      if (k < MIN_MATCH_WORDS || chars < MIN_MATCH_CHARS || j - i - k > MAX_EXTRA_WORDS) continue

      restart = j
      break
    }
    if (restart === -1) i++
    else {
      ranges.push({ from: i, to: restart })
      i = restart
    }
  }
  return ranges
}

/** Farther apart than this, saying something again was intended. */
const MAX_REPEAT_GAP_US = 12_000_000
const MAX_LOOKAHEAD = 3
/** Shorter lines are acknowledgements that repeat naturally ("ครับ", "ใช่"). */
const MIN_CHARS = 5
/** ...unless they are several words, like a countdown "3 2 1". */
const MIN_CHARS_MULTI_WORD = 3
/** The shorter line must make up at least half the longer one to be the same line. */
const MIN_OVERLAP_RATIO = 0.5
/** Misheard once: ~0.85; same opening, different ending: ~0.5 (measured in prodeck1). */
const MIN_SIMILARITY = 0.8

/** Dice similarity over letter pairs — Thai has no spaces, so letter pairs are the unit that always compares. */
function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const pairs = (s: string) => {
    const counts = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) counts.set(s.slice(i, i + 2), (counts.get(s.slice(i, i + 2)) ?? 0) + 1)
    return counts
  }
  const pa = pairs(a)
  const pb = pairs(b)
  let shared = 0
  for (const [pair, count] of pa) shared += Math.min(count, pb.get(pair) ?? 0)
  return (2 * shared) / (a.length - 1 + b.length - 1)
}

function meaty(text: string): boolean {
  const letters = normalizeWord(text).length
  if (letters >= MIN_CHARS) return true
  return text.trim().split(/\s+/).length >= 2 && letters >= MIN_CHARS_MULTI_WORD
}

function sameLine(a: TimedText, b: TimedText): boolean {
  const na = normalizeWord(a.text)
  const nb = normalizeWord(b.text)
  const [shorter, short, long] = na.length <= nb.length ? [a, na, nb] : [b, nb, na]
  if (!meaty(shorter.text)) return false
  if (long.includes(short)) return short.length / long.length >= MIN_OVERLAP_RATIO
  return similarity(short, long) >= MIN_SIMILARITY
}

/** Each utterance that a later utterance says again, with the first later one that does. */
export function repeatedUtterancePairs(utterances: TimedText[]): [earlier: number, later: number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < utterances.length; i++) {
    if (!meaty(utterances[i]!.text)) continue
    for (let j = i + 1; j <= Math.min(i + MAX_LOOKAHEAD, utterances.length - 1); j++) {
      if (utterances[j]!.startUs - utterances[i]!.endUs > MAX_REPEAT_GAP_US) break
      if (sameLine(utterances[i]!, utterances[j]!)) {
        pairs.push([i, j])
        break
      }
    }
  }
  return pairs
}

/** Indexes of utterances that a later utterance says again; the last take is never in the result. */
export function repeatedUtterances(utterances: TimedText[]): number[] {
  return repeatedUtterancePairs(utterances).map(([earlier]) => earlier)
}
