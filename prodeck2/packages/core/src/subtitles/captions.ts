import type { TimedText } from "../asr/types.ts"
import type { Cut } from "../capcut/types.ts"
import { playsIn } from "../cut/plays.ts"

export const SUBTITLE_LENGTHS = ["short", "line"] as const
export type SubtitleLength = (typeof SUBTITLE_LENGTHS)[number]

export interface SubtitleOptions {
  enabled: boolean
  /** "short": a few words at a time; "line": one line across the frame */
  length: SubtitleLength
  /** offer to have Claude correct mis-heard words before writing */
  polish: boolean
}

export const DEFAULT_SUBTITLE_OPTIONS: SubtitleOptions = { enabled: false, length: "line", polish: false }

/** How long a caption stays up after its last word when nothing follows straight away. */
const HOLD_US = 500_000

/** Characters on screen, as the eye counts them: Thai vowel and tone marks share their consonant's place. */
export function textLength(text: string): number {
  return [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(text)].length
}

/**
 * How much one caption may hold, and how long a pause between words starts a new one.
 * Short captions change at every breath; a line rides over the short pauses of a speaker
 * who talks in bursts (0.3–0.5 s in real Thai footage), which would otherwise leave single words on screen.
 */
export function captionLimits(length: SubtitleLength, canvas: { width: number; height: number }): { maxChars: number; pauseUs: number } {
  if (length === "short") return { maxChars: 10, pauseUs: 300_000 }
  return { maxChars: canvas.width > canvas.height ? 35 : 20, pauseUs: 600_000 }
}

const THAI = /[฀-๿]/

/** Thai is written without spaces between words; anything else keeps them. */
export function joinWords(words: string[]): string {
  let text = ""
  for (const word of words) {
    if (!text) text = word
    else text += THAI.test(text.at(-1)!) && THAI.test(word[0]!) ? word : ` ${word}`
  }
  return text
}

/**
 * Splits words said in one breath into the fewest captions that fit, with lengths as even as
 * possible and breaks drawn to where the speaker pauses. A word longer than the limit stands alone.
 */
export function shareOut(words: TimedText[], maxChars: number, pauseUs: number): TimedText[][] {
  const n = words.length
  const sizes = new Map<number, number>()
  const size = (from: number, to: number) => {
    const key = from * (n + 1) + to
    if (!sizes.has(key)) sizes.set(key, textLength(joinWords(words.slice(from, to).map((word) => word.text))))
    return sizes.get(key)!
  }
  const fits = (from: number, to: number) => to - from === 1 || size(from, to) <= maxChars
  if (fits(0, n)) return [words]

  // filling each caption before starting the next gives the fewest captions
  let lines = 0
  for (let from = 0; from < n; lines++) {
    let to = from + 1
    while (to < n && fits(from, to + 1)) to++
    from = to
  }

  // cost[l][i]: best way to put the first i words on l captions; an uneven caption costs its unused room squared,
  // and breaking at a pause earns up to a whole caption's worth
  // a lone word pays for its unused room too, so a short last word is not left on its own
  const unused = (from: number, to: number) => (maxChars - size(from, to)) ** 2
  // pauses inside a breath are shorter than pauseUs, so this stays below a whole caption's worth
  const pause = (at: number) => (maxChars ** 2 * (words[at]!.startUs - words[at - 1]!.endUs)) / pauseUs
  const cost = Array.from({ length: lines + 1 }, () => new Array<number>(n + 1).fill(Infinity))
  const cutAt = Array.from({ length: lines + 1 }, () => new Array<number>(n + 1).fill(0))
  cost[0]![0] = 0
  for (let l = 1; l <= lines; l++) {
    for (let to = l; to <= n; to++) {
      // captions only grow as they start earlier, so stop at the first that does not fit
      for (let from = to - 1; from >= l - 1 && fits(from, to); from--) {
        if (cost[l - 1]![from] === Infinity) continue
        const total = cost[l - 1]![from]! + unused(from, to) - (from > 0 ? pause(from) : 0)
        if (total < cost[l]![to]!) {
          cost[l]![to] = total
          cutAt[l]![to] = from
        }
      }
    }
  }

  const groups: TimedText[][] = []
  for (let l = lines, to = n; l > 0; l--) {
    const from = cutAt[l]![to]!
    groups.unshift(words.slice(from, to))
    to = from
  }
  return groups
}

/** A caption in source coordinates, inside the kept piece `cuts[cut]`. */
export interface Caption {
  cut: number
  startUs: number
  endUs: number
  text: string
}

/**
 * Captions for the words the rough cut keeps. Pure. A caption never spans two cuts, so
 * the writer can place it relative to the segment its cut became.
 */
export function buildCaptions(args: {
  cuts: Cut[]
  /** the words of a video that may be shown in piece `cut` of the rough cut */
  wordsOf: (binId: string, cut: number) => TimedText[]
  maxChars: number
  pauseUs: number
  /** a caption on screen for less than this (a frame) could not be written: its words go with the next */
  minUs?: number
}): Caption[] {
  const captions: Caption[] = []
  const span = (cut: Cut) => ({ startUs: cut.sourceStartUs, endUs: cut.sourceStartUs + cut.sourceDurationUs })
  args.cuts.forEach((cut, index) => {
    const cutStart = cut.sourceStartUs
    const cutEnd = cut.sourceStartUs + cut.sourceDurationUs
    const sameVideo = args.cuts.filter((other) => other.binId === cut.binId).map(span)
    const words = args.wordsOf(cut.binId, index).filter((word) => playsIn(word, span(cut), sameVideo))

    // a breath is what is said between pauses; each breath is shared between as few captions as fit
    const breaths: TimedText[][] = []
    for (const word of words) {
      const breath = breaths.at(-1)
      const last = breath?.at(-1)
      if (breath && last && word.startUs - last.endUs < args.pauseUs) breath.push(word)
      else breaths.push([word])
    }
    const groups = breaths.flatMap((breath) => shareOut(breath, args.maxChars, args.pauseUs))

    // a caption the next one would start on top of has no time on screen: its words go with the next
    let carried: TimedText[] = []
    groups.forEach((own, i) => {
      const group = [...carried, ...own]
      const startUs = Math.max(group[0]!.startUs, cutStart)
      const next = groups[i + 1]
      const endUs = Math.min(cutEnd, group.at(-1)!.endUs + HOLD_US, next ? Math.max(next[0]!.startUs, cutStart) : Infinity)
      const tooShort = endUs - startUs < Math.max(args.minUs ?? 0, 1)
      if (tooShort && next) {
        carried = group
        return
      }
      carried = []
      // the last words of a cut with no time left on screen (a word timed with no length at its very end) join the caption before
      const before = captions.at(-1)
      if (tooShort && before?.cut === index) {
        captions[captions.length - 1] = { ...before, endUs: Math.max(before.endUs, endUs), text: joinWords([before.text, ...group.map((w) => w.text)]) }
        return
      }
      captions.push({ cut: index, startUs, endUs, text: joinWords(group.map((w) => w.text)) })
    })
  })
  return captions
}
