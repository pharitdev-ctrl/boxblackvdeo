import { createHash } from "node:crypto"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import { exitById, type FlairOptions } from "@boxblack/core/flair/catalogue"
import { placePoints, pointFilter, type PlacedPoint, type PointFilter } from "@boxblack/core/emphasis"
import type { EmphasisPoint } from "@boxblack/core/emphasis/types"
import { findWord, wordAt } from "@boxblack/core/flair/direct"
import { DEFAULT_LOOK, enforce, type CueAnchor, type GroupLook, type PieceAnchor } from "@boxblack/core/flair/plan"
import { placeHighlights, type HighlightGroup, type HighlightPlacement, type PlacedGroup, type TimedGroup } from "@boxblack/core/highlights"
import type { HighlightPosition, HighlightStyleId } from "@boxblack/core/highlights/styles"
import type { Beat } from "@boxblack/core/planner"
import { joinWords } from "@boxblack/core/subtitles/captions"
import type { Scene } from "@boxblack/core/vision"
import type { StoredHighlights, StoredOutline } from "../shared/api.ts"
import { transcriptFingerprint } from "./footage.ts"
import { wordsIn } from "./spoken.ts"

export const DEFAULT_HIGHLIGHT_STYLE: HighlightStyleId = "bold-white"

/** The user's style, else Claude's, else the default. */
export function styleInForce(highlights: StoredHighlights | undefined): HighlightStyleId {
  return highlights?.style ?? highlights?.styleByAi ?? DEFAULT_HIGHLIGHT_STYLE
}

/** Names the beats of an outline, so a later outline can be told apart. */
export function beatsKey(beats: Beat[]): string {
  const parts = beats.map((beat) => [beat.id, beat.videoId, beat.startUs, beat.endUs])
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)
}

/** Whether word numbers stored against `transcripts` still belong to the transcript a video has now. */
function isCurrent(transcripts: Record<string, string>, clips: CutClip[]): (videoId: string) => boolean {
  const fingerprints = new Map(clips.map((clip) => [clip.id, transcriptFingerprint(clip.transcript)]))
  return (videoId) => fingerprints.has(videoId) && transcripts[videoId] === fingerprints.get(videoId)
}

/**
 * Stored groups whose word numbers belong to the transcripts the videos have now. A label on a
 * picture beat has no word numbers: it counts while its video is in the outline, whatever its transcript.
 */
export function currentGroups(stored: StoredOutline, clips: CutClip[]): HighlightGroup[] {
  const highlights = stored.highlights
  if (!highlights) return []
  const current = isCurrent(highlights.transcripts, clips)
  const videos = new Set(clips.map((clip) => clip.id))
  return highlights.groups.filter((group) => (group.scene ? videos.has(group.scene.videoId) : group.lines.every((line) => current(line.videoId))))
}

/**
 * What the rough cut shows under the options in force: whether highlight text is on, and which items
 * pass. An item bound to no point always passes; one bound to a point passes only while that point is
 * placed on this rough cut and the level lets its importance through, so an item on a point that is cut
 * away, deleted, or on an earlier transcript is hidden too.
 */
export interface ShowRules {
  text: boolean
  passes: PointFilter
}

/** Everything stored, whatever the options: for finding where old items play, and for planning on every point. */
export const SHOW_ALL: ShowRules = { text: true, passes: () => true }

/** Stored points whose words belong to the transcripts the videos have now; scene points are always current. */
export function currentPoints(stored: StoredOutline, clips: CutClip[]): EmphasisPoint[] {
  const emphasis = stored.emphasis
  if (!emphasis) return []
  const current = isCurrent(emphasis.transcripts, clips)
  return emphasis.points.filter((point) => point.anchor.kind === "scene" || current(point.anchor.videoId))
}

/** Where the current points play on this rough cut (core placePoints). */
export function placedPoints(stored: StoredOutline, plan: CutPlan, clips: CutClip[]): PlacedPoint[] {
  return placePoints({ points: currentPoints(stored, clips), plan, wordsOf: wordsIn(clips) })
}

/** The scene of a clip playing at a source time; null when none is known there. */
export function sceneAt(clips: CutClip[], videoId: string, sourceUs: number): Scene | null {
  const scenes = clips.find((clip) => clip.id === videoId)?.insight?.scenes ?? []
  return scenes.find((scene) => scene.startUs <= sourceUs && sourceUs < scene.endUs) ?? null
}

/**
 * What a placed point is, in words, the one way the emphasis tab and every Claude call name it: a speech
 * point's words as its transcript says them, or the description of the scene playing at a scene point's
 * first kept moment, which is what shows when anything put on the point starts. A first kept moment in a
 * gap between scenes takes the first scene the point's stretch overlaps; a stretch no scene overlaps says
 * nothing. The text call shows a speech point's words as the rough cut plays them instead (highlights.ts),
 * since its lines are quoted from there; a scene point it names by this. It sits here, next to
 * placedPoints, so every consumer (emphasis.ts, highlights.ts, graphics-cues.ts, flair.ts) shares it.
 */
export function pointText(placed: PlacedPoint, clips: CutClip[]): string {
  const anchor = placed.point.anchor
  if (anchor.kind === "scene") {
    const overlapping = () => clips.find((clip) => clip.id === anchor.videoId)?.insight?.scenes.find((scene) => scene.startUs < anchor.endUs && anchor.startUs < scene.endUs)
    return (sceneAt(clips, anchor.videoId, placed.sourceUs) ?? overlapping())?.description ?? ""
  }
  const words = clips.find((clip) => clip.id === anchor.videoId)?.transcript?.words ?? []
  return joinWords(words.slice(anchor.from, anchor.to).map((word) => word.text))
}

/** Where an item put on a point starts: the point's first kept moment, as a moment of speech in its beat. */
export const pointAnchor = (placed: PlacedPoint): CueAnchor => ({ kind: "speech", videoId: placed.videoId, sourceUs: placed.sourceUs, beatId: placed.beatId })

/**
 * What works 2 and 4 plan on, whatever the level: the text while it is on, and every placed point at every
 * importance. The loudest level's filter, not SHOW_ALL: an item on a point that is not placed now (its words
 * cut) or no longer exists plays at no level, so nothing is planned on it or around it.
 */
export const everyPointShown = (placed: PlacedPoint[], highlightsOn: boolean): ShowRules => ({ text: highlightsOn, passes: pointFilter(placed, "heavy") })

/** The show rules for these options: the text as switched, and the level's filter over the points placed on this rough cut. */
export function showRulesOf(stored: StoredOutline, plan: CutPlan, clips: CutClip[], options: { highlightsOn: boolean; flair: FlairOptions }): ShowRules {
  return showRulesOver(placedPoints(stored, plan, clips), options)
}

/** The show rules for these options over points already placed on the rough cut, for a caller that needs those points too. */
export function showRulesOver(placed: PlacedPoint[], options: { highlightsOn: boolean; flair: FlairOptions }): ShowRules {
  return { text: options.highlightsOn, passes: pointFilter(placed, options.flair.level) }
}

/**
 * Where the stored groups play in a rough cut under the show rules: none while the text is off, and
 * none the filter hides (on a point the level holds back, or on a point cut away, deleted, or on an
 * earlier transcript).
 */
export function placeStored(stored: StoredOutline, plan: CutPlan, clips: CutClip[], show: ShowRules): PlacedGroup[] {
  if (!show.text) return []
  return placeHighlights({ plan, wordsOf: wordsIn(clips), groups: currentGroups(stored, clips).filter((group) => show.passes(group.pointId)) })
}

/**
 * Groups that show none of the words `kept` groups show, and how many lines were left out. Two labels
 * on picture beats overlap when their stretches of one video do; a label and words said never do.
 */
export function withoutOverlaps(groups: HighlightGroup[], kept: HighlightGroup[]): { groups: HighlightGroup[]; droppedLines: number } {
  const overlap = (a: HighlightGroup, b: HighlightGroup) =>
    a.scene || b.scene
      ? a.scene !== undefined && b.scene !== undefined && a.scene.videoId === b.scene.videoId && a.scene.startUs < b.scene.endUs && b.scene.startUs < a.scene.endUs
      : a.lines.some((x) => b.lines.some((y) => x.videoId === y.videoId && x.from < y.to && y.from < x.to))
  const free = groups.filter((group) => !kept.some((other) => overlap(group, other)))
  return { groups: free, droppedLines: groups.filter((group) => !free.includes(group)).reduce((sum, group) => sum + group.lines.length, 0) }
}

/**
 * Where a group goes: the position the user pinned, or the band every scene it plays over wants
 * kept clear. A video with no pictures analysed has no band, so the text falls back to the top.
 * `faceBand`, where given, says where the faces and shown things are while the group plays once the
 * picture has moved (spec §6), and that band is kept clear instead; where it knows of none (null), the
 * scenes' bands are, as before.
 */
export function placementOf(
  group: PlacedGroup,
  clips: CutClip[],
  position: HighlightPosition,
  keepSubtitleRoom: boolean,
  faceBand?: (group: PlacedGroup) => { fromY: number; toY: number } | null,
): HighlightPlacement {
  if (position !== "auto") return { kind: "fixed", position }
  const zoomed = faceBand?.(group) ?? null
  if (zoomed) return { kind: "auto", keepClear: zoomed, keepSubtitleRoom }
  const scenes = clips.find((clip) => clip.id === group.videoId)?.insight?.scenes ?? []
  const from = group.lines[0]!.sourceUs
  const to = group.end.sourceUs
  const bands = scenes.flatMap((scene) => (scene.keepClear && scene.startUs <= to && scene.endUs >= from ? [scene.keepClear] : []))
  const keepClear = bands.length === 0 ? null : { fromY: Math.min(...bands.map((band) => band.fromY)), toY: Math.max(...bands.map((band) => band.toY)) }
  return { kind: "auto", keepClear, keepSubtitleRoom }
}

/** True when a video of the outline has no pictures analysed, so its text cannot dodge anything. */
export function missingPictures(clips: CutClip[]): boolean {
  return clips.some((clip) => !clip.insight)
}

/**
 * Per piece of the rough cut, the word numbers shown there as highlight text: each group from the
 * first word of its first line on screen to the last word of its last, in the pieces it plays
 * across — footage played twice keeps its subtitles where it shows no highlight text. A line on
 * screen for less than `minUs` (a frame: the writer leaves it out) or cut off by the next group
 * is not shown, so its words stay in the subtitles.
 */
export function hiddenWords(placed: PlacedGroup[], timed: TimedGroup[], minUs = 0): Map<number, Set<number>> {
  const onScreen = new Map(
    timed.map((group) => [group.groupId, new Set(group.lines.filter((line) => group.endUs - line.startUs >= minUs).map((line) => line.lineIndex))]),
  )
  const hidden = new Map<number, Set<number>>()
  for (const group of placed) {
    // a label on a picture beat shows no words said, so it hides none
    if (group.scene) continue
    const lines = group.lines.filter((line) => onScreen.get(group.groupId)?.has(line.lineIndex))
    if (lines.length === 0) continue
    for (let cut = lines[0]!.cut; cut <= lines.at(-1)!.cut; cut++) {
      const words = hidden.get(cut) ?? new Set<number>()
      for (let index = lines[0]!.words.from; index < lines.at(-1)!.words.to; index++) words.add(index)
      hidden.set(cut, words)
    }
  }
  return hidden
}

/** Wide output, where the bar pattern is not drawn; an unknown canvas counts as portrait. */
export const isLandscape = (canvas: { width: number; height: number } | null): boolean => canvas !== null && canvas.width > canvas.height

/** Where each kept piece starts on the rough cut, before rounding to frames. */
export function timelineOf(plan: CutPlan) {
  const offsets: number[] = []
  plan.cuts.reduce((start, cut) => (offsets.push(start), start + cut.sourceDurationUs), 0)
  return (cut: number, sourceUs: number) => offsets[cut]! + sourceUs - plan.cuts[cut]!.sourceStartUs
}

/** A line of a group as it shows: which stored line it is, and what it says. */
type ShownLine = { lineIndex: number; text: string }

/**
 * A stored look as the shown lines read it. A stored accent names the stored line it is on; the
 * look in force names that line's place among the lines shown, and has no accent when that line
 * is not shown.
 */
function shownLook(look: GroupLook, lines: ShownLine[]): GroupLook {
  if (look.accent === null) return look
  const at = lines.findIndex((line) => line.lineIndex === look.accent!.line)
  return { ...look, accent: at < 0 ? null : { ...look.accent, line: at } }
}

/**
 * The flair of an outline once a line of a group is taken out: what was on that line — its sound,
 * its cutaway, its coloured word — goes with it, and what was on the lines below moves up with them.
 */
export function withoutLine(stored: StoredOutline, groupId: string, lineIndex: number): StoredOutline {
  const flair = stored.flair
  if (!flair) return stored
  const moved = <T extends { anchor: CueAnchor }>(items: T[] | undefined): T[] | undefined =>
    items?.flatMap((item) => {
      const { anchor } = item
      if (anchor.kind !== "highlight" || anchor.groupId !== groupId || anchor.line < lineIndex) return [item]
      return anchor.line === lineIndex ? [] : [{ ...item, anchor: { ...anchor, line: anchor.line - 1 } }]
    })
  const look = flair.looks[groupId]
  const accent = look?.accent
  const looks =
    !look || !accent || accent.line < lineIndex
      ? flair.looks
      : { ...flair.looks, [groupId]: { ...look, accent: accent.line === lineIndex ? null : { ...accent, line: accent.line - 1 } } }
  const cues = moved(flair.cues)
  const inserts = moved(flair.inserts)
  return { ...stored, flair: { ...flair, looks, ...(cues ? { cues } : {}), ...(inserts ? { inserts } : {}) } }
}

/**
 * The flair of an outline once a line's text changed from `before`: its coloured word is looked
 * for in the new text, and the colour goes when the word is not there any more.
 */
export function withLineText(stored: StoredOutline, groupId: string, lineIndex: number, before: string): StoredOutline {
  const look = stored.flair?.looks[groupId]
  const accent = look?.accent
  const text = stored.highlights?.groups.find((group) => group.id === groupId)?.lines[lineIndex]?.text
  if (!look || !accent || accent.line !== lineIndex || text === undefined) return stored
  const found = findWord(text, wordAt(before, accent.from, accent.to))
  return { ...stored, flair: { ...stored.flair!, looks: { ...stored.flair!.looks, [groupId]: { ...look, accent: found && { line: lineIndex, ...found } } } } }
}

/**
 * The flair of an outline whose highlight groups were replaced or taken out. A sound or cutaway on
 * a line of a group that is gone moves to the line now showing most of the same words, when
 * `sameWords` says that video's word numbers can still be compared (its transcript did not
 * change) — preferring the same beat, as footage can play twice — otherwise it goes with its group,
 * unless `orElse` puts it somewhere else (highlights.pick: one the user edited, to its beat's start).
 * A line already holding something keeps it, and the item goes to the next line with its words;
 * one the user set by hand moves before one Claude chose. A group's look goes the same way, to the
 * group now showing most of its words, its coloured word found again in the line it moved to.
 * A label on a picture beat says no words: what was on it goes to the label now on most of the same
 * stretch of its video, to that label's first free line, whether or not the transcript changed.
 * Graphics sit on moments of speech only, never on a line, so they are carried as they are.
 */
export function regroupFlair(
  stored: StoredOutline,
  before: HighlightGroup[],
  sameWords: (videoId: string) => boolean,
  /** which of the groups now there may take what moves; all of them unless said otherwise */
  canTake: (group: HighlightGroup) => boolean = () => true,
  /**
   * Where the items on gone lines that no free line takes go instead. It is handed every item, in order,
   * once those a free line takes have moved to it, and answers the items as they should be stored;
   * whatever it leaves on a gone line goes. Unless said otherwise (every item as it is), all of those go.
   */
  orElse: <T extends { anchor: CueAnchor; edited: boolean }>(items: T[]) => T[] = (items) => items,
): StoredOutline {
  const flair = stored.flair
  if (!flair) return stored
  const now = stored.highlights?.groups ?? []
  const present = new Set(now.map((group) => group.id))
  const old = new Map(before.map((group) => [group.id, group]))
  const key = (anchor: CueAnchor) => JSON.stringify(anchor)
  type LineAnchor = Extract<CueAnchor, { kind: "highlight" }>

  /** How many words two lines show in common, on a transcript that can be compared. */
  const common = (a: HighlightGroup["lines"][number], b: HighlightGroup["lines"][number]) =>
    a.videoId === b.videoId && sameWords(a.videoId) ? Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from)) : 0
  /** How much time two labels' stretches share: only on one video. */
  const stretchShared = (a: NonNullable<HighlightGroup["scene"]>, b: NonNullable<HighlightGroup["scene"]>) => (a.videoId === b.videoId ? Math.max(0, Math.min(a.endUs, b.endUs) - Math.max(a.startUs, b.startUs)) : 0)
  /**
   * How much a line of one group shares with a line of another: the words they show in common, or, for
   * two labels, the time their stretches share. A label's lines are words 0–0, so it shares no words.
   */
  const shares = (a: HighlightGroup, x: HighlightGroup["lines"][number], b: HighlightGroup, y: HighlightGroup["lines"][number]) =>
    a.scene && b.scene ? stretchShared(a.scene, b.scene) : common(x, y)
  /** Best first: a group in the same beat (footage can play twice), then the most words in common, then the first found. */
  const rank = <T>(options: { item: T; beat: boolean; shared: number }[]): T[] =>
    options
      .filter((option) => option.shared > 0)
      .sort((a, b) => Number(b.beat) - Number(a.beat) || b.shared - a.shared)
      .map((option) => option.item)

  /** The lines now there that show the words a gone line showed, best first. */
  const follow = (anchor: LineAnchor): LineAnchor[] => {
    const group = old.get(anchor.groupId)
    const was = group?.lines[anchor.line]
    if (!group || !was) return []
    return rank(
      now.filter(canTake).flatMap((other) =>
        other.lines.map((line, index) => ({ item: { kind: "highlight" as const, groupId: other.id, line: index }, beat: other.beatId === group.beatId, shared: shares(other, line, group, was) })),
      ),
    )
  }

  const moved = <T extends { anchor: CueAnchor; edited: boolean }>(items: T[] | undefined): T[] | undefined => {
    if (!items) return items
    const gone = (item: T) => item.anchor.kind === "highlight" && !present.has(item.anchor.groupId)
    const taken = new Set(items.filter((item) => !gone(item)).map((item) => key(item.anchor)))
    const to = new Map<T, CueAnchor>()
    for (const item of [...items.filter(gone)].sort((a, b) => Number(b.edited) - Number(a.edited))) {
      // the best line that is free: one already holding something keeps it
      const anchor = follow(item.anchor as LineAnchor).find((candidate) => !taken.has(key(candidate)))
      if (!anchor) continue
      taken.add(key(anchor))
      to.set(item, anchor)
    }
    // what no free line takes may go elsewhere (orElse, handed the whole list after following); what is still on a gone line after that goes
    const followed = items.map((item) => (gone(item) && to.has(item) ? { ...item, anchor: to.get(item)! } : item))
    return orElse(followed).filter((item) => !gone(item))
  }

  const cues = moved(flair.cues)
  const inserts = moved(flair.inserts)
  const graphics = moved(flair.graphics)

  const looks = { ...flair.looks }
  const goneLooks = before.filter((group) => !present.has(group.id) && flair.looks[group.id]).sort((a, b) => Number(flair.looks[b.id]!.edited) - Number(flair.looks[a.id]!.edited))
  for (const was of goneLooks) {
    const shared = (group: HighlightGroup) => was.lines.reduce((sum, x) => sum + group.lines.reduce((inner, y) => inner + shares(was, x, group, y), 0), 0)
    const [target] = rank(now.filter((group) => canTake(group) && !looks[group.id]).map((group) => ({ item: group, beat: group.beatId === was.beatId, shared: shared(group) })))
    if (!target) continue
    const look = flair.looks[was.id]!
    const accent = look.accent
    // the coloured word is found again in the first line of the new group, best first, that shows its line's words and says it
    const word = accent ? wordAt(was.lines[accent.line]!.text, accent.from, accent.to) : ""
    const lines = accent ? follow({ kind: "highlight", groupId: was.id, line: accent.line }).filter((candidate) => candidate.groupId === target.id) : []
    const hit = lines.map((candidate) => ({ line: candidate.line, found: findWord(target.lines[candidate.line]!.text, word) })).find((entry) => entry.found)
    looks[target.id] = { ...look, accent: hit ? { line: hit.line, ...hit.found! } : null }
  }
  // a look of a group no longer stored has gone where it could; a stored group's look stays, shown or not
  for (const id of Object.keys(looks)) if (!present.has(id)) delete looks[id]
  return { ...stored, flair: { ...flair, looks, ...(cues ? { cues } : {}), ...(inserts ? { inserts } : {}), ...(graphics ? { graphics } : {}) } }
}

/**
 * Items Claude placed on the beats it was shown, moved onto the beats as they are now: a beat that
 * got a new id in the same place (a part added to it) passes its items on, the closing sound goes
 * to the beat that ends the video now, and what names a beat taken out goes with it. Items that name
 * no beat are left as they are.
 */
export function answerOnBeats<T extends { anchor: CueAnchor | PieceAnchor }>(items: T[], asked: { id: string }[], now: { id: string }[]): T[] {
  const askedIds = new Set(asked.map((beat) => beat.id))
  const nowIds = new Set(now.map((beat) => beat.id))
  const renamed = new Map(
    asked.length === now.length ? asked.flatMap((beat, i) => (!nowIds.has(beat.id) && !askedIds.has(now[i]!.id) ? [[beat.id, now[i]!.id]] : [])) : [],
  )
  const lastWas = asked.at(-1)?.id
  const lastNow = now.at(-1)?.id
  return items.flatMap((item) => {
    const anchor = item.anchor
    if (!("beatId" in anchor) || anchor.beatId === undefined) return [item]
    const closing = "kind" in anchor && anchor.kind === "beat" && anchor.edge === "end" && anchor.beatId === lastWas
    const beatId = closing && lastNow !== undefined ? lastNow : (renamed.get(anchor.beatId) ?? anchor.beatId)
    if (!nowIds.has(beatId)) return []
    return [beatId === anchor.beatId ? item : { ...item, anchor: { ...anchor, beatId } }]
  })
}

/**
 * How each group on the rough cut looks: the stored look put through the rules, its coloured word
 * placed on the line that shows it. With the looks off every group is the plain stack, which is what
 * M9 wrote. Every level draws every look: the level only chooses which groups show.
 */
export function looksInForce(
  stored: StoredOutline,
  groups: { id: string; lines: ShownLine[] }[],
  flair: FlairOptions,
  canvas: { width: number; height: number } | null,
  /** the user has CapCut Pro: without it an exit that needs Pro shows and writes as none (it stays stored) */
  pro = false,
): Record<string, GroupLook> {
  if (!flair.text) return Object.fromEntries(groups.map((group) => [group.id, DEFAULT_LOOK]))
  const looks = stored.flair?.looks ?? {}
  const enforced = enforce(
    groups.map((group) => shownLook(looks[group.id] ?? DEFAULT_LOOK, group.lines)),
    groups.map((group) => ({ lines: group.lines.map((line) => line.text) })),
    isLandscape(canvas),
    pro,
  )
  return Object.fromEntries(groups.map((group, i) => [group.id, enforced[i]!]))
}

/**
 * The exits groups keep stored but that are not written because they need CapCut Pro the user does not have,
 * by group id, each with its name in the catalogue: the look popover shows them as held, so an edit of the
 * rest of the look keeps them, and the write sheet counts them. None with Pro, or with the looks off
 * (nothing's exit is written then anyway).
 */
export function heldExits(stored: StoredOutline, groupIds: string[], flair: FlairOptions, pro: boolean): Record<string, { id: string; name: string }> {
  if (pro || !flair.text) return {}
  const looks = stored.flair?.looks ?? {}
  return Object.fromEntries(
    groupIds.flatMap((id) => {
      const exit = looks[id]?.exit ?? null
      const animation = exit === null ? undefined : exitById(exit)
      return animation?.pro ? [[id, { id: animation.id, name: animation.name }]] : []
    }),
  )
}
