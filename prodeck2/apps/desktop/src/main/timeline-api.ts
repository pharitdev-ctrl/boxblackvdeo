import { CUT_PRESET_IDS, type CutDecisionChange, type CutRules, type SourceRange } from "@boxblack/core/cut/rules"
import { FLAIR_LEVELS } from "@boxblack/core/flair/catalogue"
import { HIGHLIGHT_POSITIONS } from "@boxblack/core/highlights/styles"
import { SUBTITLE_LENGTHS, type SubtitleLength } from "@boxblack/core/subtitles/captions"
import type { DesktopApi, HighlightRequest, SubtitleRequest } from "../shared/api.ts"
import type { TimelineService } from "./timeline.ts"

type TimelineApi = Pick<DesktopApi, "previewCut" | "writeTimeline" | "writingTimeline" | "listBackups" | "restoreBackup" | "previewSubtitles" | "setCutDecision" | "setSubtitleText">

/** Longer than any caption a person reads; a limit keeps a bad request from reaching Claude or the draft. */
const MAX_LINE_LENGTH = 500
const MAX_LINES = 2000
/** Longer than any key a subtitle line gets (its video id, times and generated text). */
const MAX_KEY_LENGTH = 1000

export function checked(rules: CutRules): CutRules {
  const flags = [rules?.cutFillers, rules?.cutRetakes, rules?.cutBadPicture]
  if (!CUT_PRESET_IDS.includes(rules?.preset) || flags.some((flag) => typeof flag !== "boolean")) throw new Error("unknown cut rules")
  return { preset: rules.preset, cutFillers: rules.cutFillers, cutRetakes: rules.cutRetakes, cutBadPicture: rules.cutBadPicture }
}

const isLength = (value: unknown): value is SubtitleLength => SUBTITLE_LENGTHS.includes(value as SubtitleLength)
const isLines = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_LINES && value.every((line) => typeof line === "string" && line.length <= MAX_LINE_LENGTH)

function checkedSubtitles(subtitles: SubtitleRequest | null): SubtitleRequest | null {
  if (subtitles === null) return null
  if (typeof subtitles !== "object" || !isLength(subtitles.length) || !isLines(subtitles.texts)) throw new Error("unknown subtitles request")
  return { length: subtitles.length, texts: [...subtitles.texts] }
}

function checkedHighlights(highlights: HighlightRequest | null): HighlightRequest | null {
  if (highlights === null) return null
  const valid =
    typeof highlights === "object" &&
    HIGHLIGHT_POSITIONS.includes(highlights.position) &&
    typeof highlights.hideSubtitles === "boolean" &&
    typeof highlights.highlightsOn === "boolean" &&
    Number.isInteger(highlights.groupCount) &&
    highlights.groupCount >= 0 &&
    typeof highlights.flair === "object" &&
    highlights.flair !== null &&
    [highlights.flair.enabled, highlights.flair.text, highlights.flair.sound, highlights.flair.zoom, highlights.flair.insert, highlights.flair.graphic].every((flag) => typeof flag === "boolean") &&
    FLAIR_LEVELS.includes(highlights.flair.level)
  if (!valid) throw new Error("unknown highlight text request")
  return {
    position: highlights.position,
    hideSubtitles: highlights.hideSubtitles,
    highlightsOn: highlights.highlightsOn,
    groupCount: highlights.groupCount,
    flair: {
      enabled: highlights.flair.enabled,
      level: highlights.flair.level,
      text: highlights.flair.text,
      sound: highlights.flair.sound,
      zoom: highlights.flair.zoom,
      insert: highlights.flair.insert,
      graphic: highlights.flair.graphic,
    },
  }
}

const MAX_DECISION_ITEMS = 100_000

function checkedChange(change: CutDecisionChange): CutDecisionChange {
  const refuse = () => new Error("unknown cut decision")
  if (typeof change !== "object" || change === null) throw refuse()
  const keep = change.keep
  if (keep !== true && keep !== false && keep !== null) throw refuse()
  const isRanges = (ranges: unknown): ranges is SourceRange[] =>
    Array.isArray(ranges) &&
    ranges.length <= MAX_DECISION_ITEMS &&
    ranges.every((range) => Number.isFinite(range?.startUs) && Number.isFinite(range?.endUs) && typeof range.startUs === "number" && typeof range.endUs === "number")
  switch (change.type) {
    case "words":
      if (!Array.isArray(change.indexes) || change.indexes.length > MAX_DECISION_ITEMS || !change.indexes.every(Number.isInteger)) throw refuse()
      return { type: "words", indexes: [...change.indexes], keep }
    case "pause":
      if (!Number.isInteger(change.after)) throw refuse()
      return { type: "pause", after: change.after, keep }
    case "problems":
    case "pieces":
      if (!isRanges(change.ranges)) throw refuse()
      return { type: change.type, ranges: change.ranges.map(({ startUs, endUs }) => ({ startUs, endUs })), keep }
    default:
      throw refuse()
  }
}

export function createTimelineApi({ timeline }: { timeline: TimelineService }): TimelineApi {
  return {
    async previewCut(folder, rules) {
      return timeline.preview(folder, checked(rules))
    },
    async writeTimeline(folder, rules, expectedSegments, subtitles, highlights) {
      if (!Number.isInteger(expectedSegments) || expectedSegments < 0) throw new Error("the expected segment count must be a whole number")
      return timeline.write(folder, checked(rules), expectedSegments, checkedSubtitles(subtitles), checkedHighlights(highlights ?? null))
    },
    writingTimeline: async (folder) => typeof folder === "string" && timeline.writing(folder),
    listBackups: (folder) => timeline.backups(folder),
    restoreBackup: (folder, backupId) => timeline.restore(folder, backupId),
    async previewSubtitles(folder, rules, length, hideUnderHighlights) {
      if (!isLength(length)) throw new Error("unknown subtitle length")
      return timeline.subtitles(folder, checked(rules), length, hideUnderHighlights === true)
    },
    async setCutDecision(folder, videoId, change) {
      if (typeof videoId !== "string") throw new Error("unknown cut decision")
      return timeline.decide(folder, videoId, checkedChange(change))
    },
    async setSubtitleText(folder, key, text) {
      const valid =
        typeof folder === "string" &&
        typeof key === "string" &&
        key.length <= MAX_KEY_LENGTH &&
        // a line's key holds ":" between its video, times and text (so an empty key is no key), which also keeps it
        // out of the number-like keys JSON reorders
        key.includes(":") &&
        (text === null || (typeof text === "string" && text.length <= MAX_LINE_LENGTH))
      if (!valid) throw new Error("unknown subtitle text request")
      return timeline.setSubtitleText(folder, key, text)
    },
  }
}
