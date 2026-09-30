import type { TimedText } from "./types.ts"

const stripSpace = (s: string) => s.replace(/\s+/g, "")

/**
 * Turns engine fragments into dictionary words (ported from prodeck1 asr-local.ts).
 *
 * Engines time sub-word pieces: whisper tokens, and Scribe's per-character Thai
 * output — Thai has no spaces, so most pieces are a single letter. ICU's word
 * segmenter decides where words begin and end; the fragments decide *when*, because
 * their times come from the audio. A fragment spanning several characters has its
 * time spread evenly over them, which is far below a frame for real fragments.
 *
 * If an utterance's fragments do not spell its text (should not happen), those
 * fragments are passed through unchanged rather than guessed at.
 */
export function wordsFromFragments(utterances: TimedText[], fragments: TimedText[]): TimedText[] {
  const segmenter = new Intl.Segmenter("th", { granularity: "word" })
  const words: TimedText[] = []

  for (const utterance of utterances) {
    // zero-length fragments belong where they sit; others where most of them overlaps
    const mine = fragments.filter((f) => {
      const length = f.endUs - f.startUs
      if (length <= 0) return f.startUs >= utterance.startUs && f.startUs <= utterance.endUs
      return Math.min(f.endUs, utterance.endUs) - Math.max(f.startUs, utterance.startUs) > length / 2
    })

    const chars: { startUs: number; endUs: number }[] = []
    let spelled = ""
    for (const f of mine) {
      const text = stripSpace(f.text)
      if (!text) continue
      const step = (f.endUs - f.startUs) / text.length
      for (let i = 0; i < text.length; i++) {
        chars.push({ startUs: Math.round(f.startUs + i * step), endUs: Math.round(f.startUs + (i + 1) * step) })
      }
      spelled += text
    }

    if (chars.length === 0 || spelled !== stripSpace(utterance.text)) {
      words.push(...mine)
      continue
    }

    let at = 0
    for (const { segment } of segmenter.segment(utterance.text)) {
      const length = stripSpace(segment).length
      if (length === 0) continue
      const first = chars[at]
      const last = chars[Math.min(at + length - 1, chars.length - 1)]
      if (first && last) words.push({ text: segment.trim(), startUs: first.startUs, endUs: last.endUs })
      at += length
    }
  }
  return words
}
