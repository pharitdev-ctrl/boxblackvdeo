import type { TimedText } from "../asr/types.ts"
import { joinWords, shareOut } from "../subtitles/captions.ts"
import type { HighlightGroup } from "./placement.ts"

const MAX_LINES = 3

/**
 * Highlight text for words the user picked, without asking Claude: the words are split into
 * lines that fit, as subtitles are, and every three lines make a group.
 */
export function groupsFromWords(args: {
  videoId: string
  words: TimedText[]
  indexes: number[]
  maxChars: number
  newId: () => string
  /** the beat the words were picked in */
  beatId?: string
}): HighlightGroup[] {
  const indexes = [...new Set(args.indexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < args.words.length).sort((a, b) => a - b)
  const picked = indexes.map((index) => args.words[index]!)
  // pauses do not matter here, so no break is drawn to one
  const lines = picked.length === 0 ? [] : shareOut(picked, args.maxChars, Infinity)

  const groups: HighlightGroup[] = []
  let at = 0
  for (let i = 0; i < lines.length; i += MAX_LINES) {
    groups.push({
      id: args.newId(),
      source: "user",
      edited: false,
      lines: lines.slice(i, i + MAX_LINES).map((line) => {
        const from = indexes[at]!
        at += line.length
        return { videoId: args.videoId, from, to: indexes[at - 1]! + 1, text: joinWords(line.map((word) => word.text)) }
      }),
      ...(args.beatId === undefined ? {} : { beatId: args.beatId }),
    })
  }
  return groups
}
