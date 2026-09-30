import type { AudioEvent, TimedText } from "./types.ts"
import { wordsFromFragments } from "./words.ts"

/**
 * Both engines are reduced to one stream: timed text fragments, the places the engine
 * marks as a break between words, and non-speech sounds.
 */
export type SpeechItem =
  | { kind: "fragment"; text: string; startUs: number; endUs: number }
  | { kind: "boundary" }
  | { kind: "event"; text: string; atUs: number }

/**
 * An utterance ends at a marked boundary when the silence between the words on either
 * side is at least this long.
 *
 * Both conditions matter, as seen in a real Thai Scribe response: a 1.5 s clap sits
 * between two short spacings (so spacing length alone misses the pause), while Thai
 * characters of one word can be 0.36 s apart with no boundary between them (so time
 * gaps alone split words). Deliberately wide: engines put breaks around English words
 * inside Thai speech (0.019–0.74 s measured in prodeck1).
 */
const PAUSE_US = 350_000

const NIKHAHIT = "\u0e4d"
const SARA_AA = "\u0e32"
const SARA_AM = "\u0e33"

/** whisper writes SARA AM as NIKHAHIT + SARA AA ("กําลัง"); ICU only segments U+0E33 correctly. */
const normalizeThai = (text: string) => text.replaceAll(NIKHAHIT + SARA_AA, SARA_AM)

/**
 * What cannot begin a Thai syllable: the vowels and tone marks written above or below a letter,
 * and the vowels that only follow one (ะ า ำ ๅ). ๆ is left out: it is written after a space.
 */
const CANNOT_BEGIN = /^[\u0e30-\u0e3a\u0e45\u0e47-\u0e4e]+/u
const THAI_AT_END = /[\u0e01-\u0e4e]$/u

export function buildSpeech(items: SpeechItem[]): { utterances: TimedText[]; words: TimedText[]; audioEvents: AudioEvent[] } {
  const fragments: TimedText[] = []
  const utterances: TimedText[] = []
  const audioEvents: AudioEvent[] = []

  let current: TimedText[] = []
  // keeps one space per boundary; fragments never contain spaces
  let text = ""
  const flush = () => {
    const trimmed = text.trim()
    const first = current[0]
    const last = current.at(-1)
    if (first && last && trimmed) utterances.push({ text: trimmed, startUs: first.startUs, endUs: last.endUs })
    current = []
    text = ""
  }

  let lastEndUs = -Infinity
  let atBoundary = true
  for (const item of items) {
    if (item.kind === "event") {
      audioEvents.push({ text: item.text, atUs: item.atUs })
      atBoundary = true
    } else if (item.kind === "boundary") {
      if (text && !text.endsWith(" ")) text += " "
      atBoundary = true
    } else {
      let trimmed = normalizeThai(item.text.trim())
      const previous = current.at(-1)
      // a fragment that starts inside a character — a mark cut off from its letter, or the second
      // half of SARA AM — finishes the fragment before it, and a break the engine put there is no break
      const cutOff = previous && THAI_AT_END.test(previous.text) ? CANNOT_BEGIN.exec(trimmed)?.[0] : undefined
      if (previous && cutOff) {
        previous.text = normalizeThai(previous.text + cutOff)
        text = normalizeThai(text.trimEnd() + cutOff)
        atBoundary = false
        trimmed = trimmed.slice(cutOff.length)
        if (!trimmed) {
          previous.endUs = Math.max(previous.endUs, item.endUs)
          lastEndUs = previous.endUs
          continue
        }
      }
      if (!trimmed) continue
      if (atBoundary && item.startUs - lastEndUs >= PAUSE_US) flush()
      atBoundary = false
      const fragment = { text: trimmed, startUs: item.startUs, endUs: Math.max(item.endUs, item.startUs) }
      fragments.push(fragment)
      current.push(fragment)
      text += trimmed
      lastEndUs = fragment.endUs
    }
  }
  flush()

  return { utterances, words: wordsFromFragments(utterances, fragments), audioEvents }
}
