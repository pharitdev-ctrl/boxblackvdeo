import type { TimedText } from "../asr/types.ts"
import type { CutPlan } from "../cut/compile.ts"
import { playsIn } from "../cut/plays.ts"
import { composeThai } from "../thai.ts"

/** One line of highlight text: shown while words [from, to) of a video are said, reading `text`. */
export interface HighlightLine {
  videoId: string
  from: number
  to: number
  text: string
}

/** Lines that stack up as they are said and leave together. */
export interface HighlightGroup {
  id: string
  /** "ai": Claude picked it; picking again replaces it unless the user edited it */
  source: "ai" | "user"
  edited: boolean
  lines: HighlightLine[]
  /** the beat it was picked in, for footage the rough cut plays more than once; the first play without it */
  beatId?: string
  /** the emphasis point it was made for; absent on the user's own and on edited items whose point was deleted */
  pointId?: string
  /**
   * a label on a picture beat instead of words said: shows from the stretch's first kept moment for the
   * stretch, at most SCENE_LABEL_MAX_US; its lines' from and to are 0 and mean nothing
   */
  scene?: { videoId: string; startUs: number; endUs: number }
}

export interface PlacedLine {
  /** the line's place in its stored group */
  lineIndex: number
  text: string
  /** the kept piece (index into plan.cuts) the line starts in, and where in the source */
  cut: number
  sourceUs: number
  /** some of its words were cut; it starts at the first one left */
  partial: boolean
  /** its kept words, first to last, for leaving them out of the subtitles */
  words: { from: number; to: number }
}

export interface PlacedGroup {
  groupId: string
  beatId: string
  videoId: string
  /** the emphasis point its stored group was made for; absent when it was made for none */
  pointId?: string
  lines: PlacedLine[]
  /** where the last kept word ends; for a label, where its stretch stops playing in its beat */
  end: { cut: number; sourceUs: number }
  /** a label on a picture beat: its lines all start with the stretch, and it hides no words */
  scene?: true
}

/** The point a stored group was made for, as its placed and timed forms carry it: nothing for a group made for none. */
const pointOf = (group: { pointId?: string }): { pointId?: string } => (group.pointId !== undefined ? { pointId: group.pointId } : {})

/** Is `a` played before `b`? */
const before = (a: { cut: number; sourceUs: number }, b: { cut: number; sourceUs: number }) => a.cut < b.cut || (a.cut === b.cut && a.sourceUs < b.sourceUs)

/**
 * Finds where stored groups play in a rough cut. Pure. A word is kept when its middle falls in a
 * kept piece of its video. Lines with no kept word, lines in another beat than the group's first
 * line, and lines said before the line above them are left out; so are groups left with no line.
 * A label on a picture beat (a group with `scene`) is placed by its stretch instead: all its lines
 * start at the stretch's first moment a piece keeps, and it lasts to the stretch's last kept moment
 * in that piece's beat — the beat it was made in first, for footage the rough cut plays twice.
 */
export function placeHighlights(args: { plan: CutPlan; wordsOf: (videoId: string) => TimedText[]; groups: HighlightGroup[] }): PlacedGroup[] {
  const { cuts } = args.plan
  const beatOfCut = args.plan.beats.flatMap((beat) => beat.pieces.map(() => beat.beatId))
  const span = (cut: (typeof cuts)[number]) => ({ startUs: cut.sourceStartUs, endUs: cut.sourceStartUs + cut.sourceDurationUs })
  const cutOf = (videoId: string, word: TimedText, beatId: string | undefined) => {
    const sameVideo = cuts.filter((cut) => cut.binId === videoId).map(span)
    const plays = (cut: (typeof cuts)[number]) => cut.binId === videoId && playsIn(word, span(cut), sameVideo)
    // the same words can play in two beats: the one the group was picked in, else the first
    const inBeat = beatId === undefined ? -1 : cuts.findIndex((cut, index) => beatOfCut[index] === beatId && plays(cut))
    return inBeat >= 0 ? inBeat : cuts.findIndex(plays)
  }

  /** A label on a picture beat, where its stretch plays; null when no kept piece shows any of it. */
  const placeLabel = (group: HighlightGroup, scene: NonNullable<HighlightGroup["scene"]>): PlacedGroup | null => {
    const overlapping = cuts.flatMap((cut, index) => (cut.binId === scene.videoId && cut.sourceStartUs < scene.endUs && scene.startUs < span(cut).endUs ? [index] : []))
    const own = overlapping.filter((index) => beatOfCut[index] === group.beatId)
    const first = own[0] ?? overlapping[0]
    if (first === undefined || group.lines.length === 0) return null
    // it stays in the beat it starts in: past that beat the picture is another part of the clip
    const last = overlapping.filter((index) => beatOfCut[index] === beatOfCut[first]).at(-1)!
    const sourceUs = Math.max(scene.startUs, cuts[first]!.sourceStartUs)
    // drawn, measured and coloured as one string: sara am as one character
    const lines = group.lines.map((line, lineIndex) => ({ lineIndex, text: composeThai(line.text), cut: first, sourceUs, partial: false, words: { from: 0, to: 0 } }))
    const end = { cut: last, sourceUs: Math.min(scene.endUs, span(cuts[last]!).endUs) }
    return { groupId: group.id, beatId: beatOfCut[first]!, videoId: scene.videoId, ...pointOf(group), lines, end, scene: true }
  }

  const placed: PlacedGroup[] = []
  for (const group of args.groups) {
    if (group.scene) {
      const shown = placeLabel(group, group.scene)
      if (shown) placed.push(shown)
      continue
    }
    let current: PlacedGroup | null = null
    group.lines.forEach((line, lineIndex) => {
      const words = args.wordsOf(line.videoId)
      const kept: { index: number; cut: number }[] = []
      for (let index = line.from; index < line.to && index < words.length; index++) {
        const cut = cutOf(line.videoId, words[index]!, group.beatId)
        if (cut >= 0) kept.push({ index, cut })
      }
      if (kept.length === 0) return

      const first = kept[0]!
      const last = kept.at(-1)!
      const start = { cut: first.cut, sourceUs: Math.max(words[first.index]!.startUs, cuts[first.cut]!.sourceStartUs) }
      if (current && (beatOfCut[first.cut] !== current.beatId || !before(current.lines.at(-1)!, start))) return

      const end = { cut: last.cut, sourceUs: Math.min(words[last.index]!.endUs, cuts[last.cut]!.sourceStartUs + cuts[last.cut]!.sourceDurationUs) }
      // drawn, measured and coloured as one string: sara am as one character
      const shown: PlacedLine = { lineIndex, text: composeThai(line.text), ...start, partial: kept.length < line.to - line.from, words: { from: first.index, to: last.index + 1 } }
      if (!current) {
        current = { groupId: group.id, beatId: beatOfCut[first.cut]!, videoId: line.videoId, ...pointOf(group), lines: [shown], end }
      } else {
        current.lines.push(shown)
        current.end = end
      }
    })
    if (current) placed.push(current)
  }
  return placed.sort((a, b) => (before(a.lines[0]!, b.lines[0]!) ? -1 : before(b.lines[0]!, a.lines[0]!) ? 1 : 0))
}

/** How long a group stays up after its last word. */
const HOLD_US = 200_000
/** Short enough to read, long enough to take in. */
const MIN_GROUP_US = 1_200_000
const MIN_LAST_LINE_US = 1_000_000
/** The longest a label on a picture beat stays up: it has no words to follow, only its stretch. */
export const SCENE_LABEL_MAX_US = 3_000_000

export interface TimedGroup {
  groupId: string
  beatId: string
  /** the emphasis point its stored group was made for; absent when it was made for none */
  pointId?: string
  startUs: number
  endUs: number
  lines: { lineIndex: number; text: string; startUs: number; partial: boolean }[]
}

/**
 * Times placed groups on the timeline. A group stays up a little after its last word and long
 * enough to read, but never into the next group or past the end; lines left with no time go.
 * A label on a picture beat stays for its stretch and no longer, at most SCENE_LABEL_MAX_US (spec §5.2):
 * past its stretch the picture is something else.
 */
export function timeHighlights(placed: PlacedGroup[], at: (cut: number, sourceUs: number) => number, timelineEndUs: number): TimedGroup[] {
  const timed = placed
    .map((group) => ({
      group,
      lines: group.lines.map((line) => ({ lineIndex: line.lineIndex, text: line.text, startUs: at(line.cut, line.sourceUs), partial: line.partial })),
      lastWordUs: at(group.end.cut, group.end.sourceUs),
    }))
    .sort((a, b) => a.lines[0]!.startUs - b.lines[0]!.startUs)

  return timed.flatMap(({ group, lines, lastWordUs }, i) => {
    const startUs = lines[0]!.startUs
    const wanted = group.scene
      ? Math.min(lastWordUs, startUs + SCENE_LABEL_MAX_US)
      : Math.max(lastWordUs + HOLD_US, startUs + MIN_GROUP_US, lines.at(-1)!.startUs + MIN_LAST_LINE_US)
    const endUs = Math.min(wanted, timed[i + 1]?.lines[0]!.startUs ?? Infinity, timelineEndUs)
    const shown = lines.filter((line) => line.startUs < endUs)
    return shown.length === 0 ? [] : [{ groupId: group.groupId, beatId: group.beatId, ...pointOf(group), startUs: shown[0]!.startUs, endUs, lines: shown }]
  })
}
