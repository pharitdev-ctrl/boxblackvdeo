import { FLAIR_LEVELS } from "@boxblack/core/flair/catalogue"
import { EMPHASIS_REASON_MAX, EMPHASIS_TYPES, IMPORTANCE, type EmphasisType, type Importance } from "@boxblack/core/emphasis/types"
import { MEDIA_FITS } from "@boxblack/core/flair/look-at"
import { TONES, ZOOM_KINDS } from "@boxblack/core/flair/plan"
import { INSTRUCTION_MAX, instructionLength } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_POSITIONS, HIGHLIGHT_STYLE_IDS } from "@boxblack/core/highlights/styles"
import type { CueAnchor, DesktopApi, EmphasisAnchor, EmphasisPatch, GraphicPatch, HighlightViewOptions, MoveAnchor } from "../shared/api.ts"
import type { FlairService } from "./flair.ts"
import type { EmphasisService } from "./emphasis.ts"
import type { HighlightService } from "./highlights.ts"
import { checked } from "./timeline-api.ts"
import { SUBTITLE_LENGTHS } from "@boxblack/core/subtitles/captions"
import { RETHINK_WORKS, type PostRequest } from "../shared/api.ts"
import type { PostPlanService } from "./post-plan.ts"

type HighlightApi = Pick<
  DesktopApi,
  | "previewHighlights"
  | "setHighlightStyle"
  | "editHighlightLine"
  | "removeHighlightGroup"
  | "addHighlightGroup"
  | "setFlairLook"
  | "setSoundCue"
  | "setZoom"
  | "setInsert"
  | "setPointPicture"
  | "setGraphic"
  | "retryGraphic"
  | "redoGraphic"
  | "editGraphic"
  | "undoGraphic"
  | "redoMove"
  | "editMove"
  | "undoMove"
  | "setMove"
  | "redoSound"
  | "editSound"
  | "undoSound"
  | "setSound"
  | "planEmphasis"
  | "setEmphasisPoint"
  | "addEmphasisPoint"
  | "planPost"
  | "rethinkPost"
  | "postPlanState"
>

/** Longer than any line a person reads; a limit keeps a bad request out of the outline store. */
const MAX_TEXT = 100
const MAX_WORDS = 10_000
/** More words than a transcript holds, and a day of footage in µs: a limit keeps a bad request out of the outline store. */
const MAX_WORD = 100_000
const MAX_SOURCE_US = 86_400_000_000
/** The only fields a change to a point may carry. */
const POINT_FIELDS = ["importance", "type", "reason", "anchor"]

const isText = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_TEXT
/** More code units than a change of INSTRUCTION_MAX graphemes could need, sixteen to each: a text past it is refused unread. */
const MAX_INSTRUCTION_UNITS = INSTRUCTION_MAX * 16
/**
 * A change the user may ask of a graphic or a composed sound, as it is kept: trimmed, with something in it, and of
 * INSTRUCTION_MAX graphemes at the most, counted as the screen counts them (`instructionLength`: a Thai letter with its
 * marks, or an emoji, is one); null for anything else. A text of more code units than MAX_INSTRUCTION_UNITS, white
 * space around it included, is refused before it is trimmed or its graphemes are counted, so a request of any size is
 * never walked through; one within the cap is counted whole.
 */
const instructionOf = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > MAX_INSTRUCTION_UNITS) return null
  const length = instructionLength(value)
  return length === 0 || length > INSTRUCTION_MAX ? null : value.trim()
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const isWhole = (value: unknown, max: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max

export function createHighlightApi({ highlights, flair, emphasis, post }: { highlights: HighlightService; flair: FlairService; emphasis: EmphasisService; post: PostPlanService }): HighlightApi {
  const refuse = () => new Error("unknown highlight text request")
  /** A beat an anchor may name: absent, or an id of sane length. */
  const beatOk = (beatId: unknown) => beatId === undefined || (typeof beatId === "string" && beatId.length > 0 && beatId.length <= 200)
  /** A place on the rough cut, with only the fields its kind carries. */
  const checkedAnchor = (anchor: CueAnchor): CueAnchor => {
    if (anchor?.kind === "highlight" && typeof anchor.groupId === "string" && Number.isInteger(anchor.line)) {
      return { kind: "highlight", groupId: anchor.groupId, line: anchor.line }
    }
    if (anchor?.kind === "cut" && typeof anchor.videoId === "string" && Number.isInteger(anchor.sourceUs) && beatOk(anchor.beatId)) {
      return { kind: "cut", videoId: anchor.videoId, sourceUs: anchor.sourceUs, ...(anchor.beatId !== undefined ? { beatId: anchor.beatId } : {}) }
    }
    if (anchor?.kind === "beat" && typeof anchor.beatId === "string" && (anchor.edge === "start" || anchor.edge === "end")) {
      return { kind: "beat", beatId: anchor.beatId, edge: anchor.edge }
    }
    if (anchor?.kind === "speech" && typeof anchor.videoId === "string" && Number.isInteger(anchor.sourceUs) && anchor.sourceUs >= 0 && beatOk(anchor.beatId)) {
      return { kind: "speech", videoId: anchor.videoId, sourceUs: anchor.sourceUs, ...(anchor.beatId !== undefined ? { beatId: anchor.beatId } : {}) }
    }
    throw refuse()
  }
  const checkedOptions = (options: HighlightViewOptions): HighlightViewOptions => {
    if (typeof options !== "object" || options === null || !HIGHLIGHT_POSITIONS.includes(options.position) || typeof options.subtitlesOn !== "boolean" || typeof options.highlightsOn !== "boolean") throw refuse()
    const looks = options.flair
    const flags = [looks?.enabled, looks?.text, looks?.sound, looks?.zoom, looks?.insert, looks?.graphic]
    if (typeof looks !== "object" || looks === null || flags.some((flag) => typeof flag !== "boolean") || !FLAIR_LEVELS.includes(looks.level)) throw refuse()
    return {
      position: options.position,
      subtitlesOn: options.subtitlesOn,
      highlightsOn: options.highlightsOn,
      flair: { enabled: looks.enabled, level: looks.level, text: looks.text, sound: looks.sound, zoom: looks.zoom, insert: looks.insert, graphic: looks.graphic },
    }
  }
  /** A plan run's project: a folder named, not an empty one, which no run could be told apart by. */
  const folderOk = (folder: unknown): folder is string => typeof folder === "string" && folder.length > 0
  /** A plan run's request: the cut rules, the view options, and the subtitles as shown, with only those fields. */
  const checkedPostRequest = (request: PostRequest): PostRequest => {
    if (typeof request !== "object" || request === null) throw refuse()
    const subtitles = request.subtitles
    const subtitlesOk =
      subtitles === null ||
      (typeof subtitles === "object" && SUBTITLE_LENGTHS.includes(subtitles.length) && typeof subtitles.polish === "boolean" && typeof subtitles.hideUnderHighlights === "boolean")
    if (!subtitlesOk) throw refuse()
    return {
      rules: checked(request.rules),
      view: checkedOptions(request.view),
      subtitles: subtitles === null ? null : { length: subtitles.length, polish: subtitles.polish, hideUnderHighlights: subtitles.hideUnderHighlights },
    }
  }
  /** A graphic's place, which is only ever a moment of speech; a composed sound's too, on a word or on its graphic's place. */
  const speechAnchor = (anchor: CueAnchor): CueAnchor => {
    const place = checkedAnchor(anchor)
    if (place.kind !== "speech") throw refuse()
    return place
  }
  /**
   * A move's place: a moment of speech, as a graphic's is, and whether it is on a cutaway, which only `insert: true`
   * says; anything else there is refused.
   */
  const moveAnchor = (anchor: MoveAnchor): MoveAnchor => {
    if (typeof anchor !== "object" || anchor === null) throw refuse()
    const { insert, ...place } = anchor
    if (insert !== undefined && typeof insert !== "boolean") throw refuse()
    return { ...speechAnchor(place as CueAnchor), ...(insert === true ? { insert: true } : {}) }
  }
  /** A change the post-production page could make to a graphic: switched off or on, and no other field. */
  const checkedPatch = (patch: unknown): GraphicPatch | null => {
    if (patch === null) return null
    if (!isObject(patch) || Array.isArray(patch)) throw refuse()
    const { off } = patch
    if (off !== undefined && typeof off !== "boolean") throw refuse()
    return off !== undefined ? { off } : {}
  }
  /** A change the post-production page could make to a composed sound or a move: switched off or on, and no other field. */
  const checkedSoundPatch = (patch: unknown): { off: boolean } | null => {
    if (patch === null) return null
    if (!isObject(patch) || Array.isArray(patch) || typeof patch.off !== "boolean") throw refuse()
    return { off: patch.off }
  }
  const refuseEmphasis = () => new Error("unknown emphasis request")
  /** A video or beat id of sane length. */
  const idOk = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200
  /** Where a point may be, rebuilt with only the fields its kind carries. */
  const checkedEmphasisAnchor = (anchor: unknown): EmphasisAnchor => {
    if (!isObject(anchor)) throw refuseEmphasis()
    const { kind, videoId, beatId, from, to, startUs, endUs } = anchor
    if (!idOk(videoId) || !idOk(beatId)) throw refuseEmphasis()
    if (kind === "speech" && isWhole(from, MAX_WORD) && isWhole(to, MAX_WORD) && from < to) return { kind, videoId, from, to, beatId }
    if (kind === "scene" && isWhole(startUs, MAX_SOURCE_US) && isWhole(endUs, MAX_SOURCE_US) && startUs < endUs) return { kind, videoId, startUs, endUs, beatId }
    throw refuseEmphasis()
  }
  /** A change the emphasis tab could make to a point: its importance, type, reason and phrase; any other field, or none, is refused. */
  const checkedEmphasisPatch = (patch: unknown): EmphasisPatch | null => {
    if (patch === null) return null
    if (!isObject(patch) || Array.isArray(patch) || Object.keys(patch).some((key) => !POINT_FIELDS.includes(key))) throw refuseEmphasis()
    const { importance, type, reason, anchor } = patch
    if (importance !== undefined && !(IMPORTANCE as readonly unknown[]).includes(importance)) throw refuseEmphasis()
    if (type !== undefined && !(EMPHASIS_TYPES as readonly unknown[]).includes(type)) throw refuseEmphasis()
    // measured as it is kept: the spaces around a reason are never stored, so they do not count against its length
    if (reason !== undefined && (typeof reason !== "string" || reason.trim().length > EMPHASIS_REASON_MAX)) throw refuseEmphasis()
    const rebuilt: EmphasisPatch = {
      ...(importance !== undefined ? { importance: importance as Importance } : {}),
      ...(type !== undefined ? { type: type as EmphasisType } : {}),
      ...(typeof reason === "string" ? { reason: reason.trim() } : {}),
      ...(anchor !== undefined ? { anchor: checkedEmphasisAnchor(anchor) } : {}),
    }
    // a change that names no field, or names fields with nothing in them, is not one the tab makes
    if (Object.keys(rebuilt).length === 0) throw refuseEmphasis()
    return rebuilt
  }
  return {
    previewHighlights: async (folder, rules, options) => highlights.preview(folder, checked(rules), checkedOptions(options)),
    async setHighlightStyle(folder, style) {
      if (!HIGHLIGHT_STYLE_IDS.includes(style)) throw refuse()
      return highlights.setStyle(folder, style)
    },
    async editHighlightLine(folder, groupId, lineIndex, text) {
      if (typeof groupId !== "string" || !Number.isInteger(lineIndex) || (text !== null && !isText(text))) throw refuse()
      return highlights.editLine(folder, groupId, lineIndex, text)
    },
    async removeHighlightGroup(folder, groupId) {
      if (typeof groupId !== "string") throw refuse()
      return highlights.removeGroup(folder, groupId)
    },
    async addHighlightGroup(folder, videoId, wordIndexes, maxChars, beatId, pointId) {
      const valid =
        typeof videoId === "string" &&
        Array.isArray(wordIndexes) &&
        wordIndexes.length <= MAX_WORDS &&
        wordIndexes.every(Number.isInteger) &&
        Number.isInteger(maxChars) &&
        (beatId === undefined || (typeof beatId === "string" && beatId.length <= 200)) &&
        (pointId === undefined || idOk(pointId))
      if (!valid) throw refuse()
      return highlights.addFromWords(folder, videoId, [...wordIndexes], maxChars, beatId, pointId)
    },
    async planPost(folder, request) {
      if (!folderOk(folder)) throw refuse()
      return post.plan(folder, checkedPostRequest(request))
    },
    async rethinkPost(folder, work, request) {
      if (!folderOk(folder) || !RETHINK_WORKS.includes(work)) throw refuse()
      return post.rethink(folder, work, checkedPostRequest(request))
    },
    async postPlanState(folder) {
      if (!folderOk(folder)) throw refuse()
      return post.state(folder)
    },
    async setSoundCue(folder, anchor, effectId) {
      // sounds are composed now: a CapCut sound the user chose can only be taken off
      if (effectId !== null) throw new Error("choosing a CapCut sound is no longer possible")
      if (typeof anchor !== "object" || anchor === null) throw refuse()
      return flair.setCue(folder, checkedAnchor(anchor), effectId)
    },
    async setInsert(folder, anchor, binId, fit, replacing) {
      if ((binId !== null && !isText(binId)) || typeof anchor !== "object" || anchor === null) throw refuse()
      if (fit !== undefined && !MEDIA_FITS.includes(fit)) throw refuse()
      if (replacing !== undefined && !isText(replacing)) throw refuse()
      return flair.setInsert(folder, checkedAnchor(anchor), binId, fit, replacing)
    },
    async setPointPicture(folder, rules, pointId, binId, fit) {
      if (!idOk(pointId) || (binId !== null && !isText(binId)) || (fit !== undefined && !MEDIA_FITS.includes(fit))) throw refuse()
      return flair.setPointPicture(folder, checked(rules), pointId, binId, fit)
    },
    async setGraphic(folder, anchor, patch) {
      return flair.setGraphic(folder, speechAnchor(anchor), checkedPatch(patch))
    },
    async retryGraphic(folder, anchor) {
      return flair.retryGraphic(folder, speechAnchor(anchor))
    },
    async redoGraphic(folder, anchor, request) {
      if (!folderOk(folder)) throw refuse()
      return post.redoGraphic(folder, speechAnchor(anchor), checkedPostRequest(request))
    },
    async editGraphic(folder, anchor, instruction, request) {
      const change = instructionOf(instruction)
      if (!folderOk(folder) || change === null) throw refuse()
      return post.editGraphic(folder, speechAnchor(anchor), change, checkedPostRequest(request))
    },
    async undoGraphic(folder, anchor) {
      if (!folderOk(folder)) throw refuse()
      return post.undoGraphic(folder, speechAnchor(anchor))
    },
    async redoMove(folder, anchor, request) {
      if (!folderOk(folder)) throw refuse()
      return post.redoMove(folder, moveAnchor(anchor), checkedPostRequest(request))
    },
    async editMove(folder, anchor, instruction, request) {
      const change = instructionOf(instruction)
      if (!folderOk(folder) || change === null) throw refuse()
      return post.editMove(folder, moveAnchor(anchor), change, checkedPostRequest(request))
    },
    async undoMove(folder, anchor) {
      if (!folderOk(folder)) throw refuse()
      return post.undoMove(folder, moveAnchor(anchor))
    },
    async setMove(folder, anchor, patch) {
      return flair.setMove(folder, moveAnchor(anchor), checkedSoundPatch(patch))
    },
    async redoSound(folder, anchor, request) {
      if (!folderOk(folder)) throw refuse()
      return post.redoSound(folder, speechAnchor(anchor), checkedPostRequest(request))
    },
    async editSound(folder, anchor, instruction, request) {
      const change = instructionOf(instruction)
      if (!folderOk(folder) || change === null) throw refuse()
      return post.editSound(folder, speechAnchor(anchor), change, checkedPostRequest(request))
    },
    async undoSound(folder, anchor) {
      if (!folderOk(folder)) throw refuse()
      return post.undoSound(folder, speechAnchor(anchor))
    },
    async setSound(folder, anchor, patch) {
      return flair.setSound(folder, speechAnchor(anchor), checkedSoundPatch(patch))
    },
    async planEmphasis(folder, rules) {
      if (typeof folder !== "string") throw refuseEmphasis()
      return post.emphasisOnly(folder, checked(rules))
    },
    async setEmphasisPoint(folder, id, patch) {
      if (typeof folder !== "string" || !idOk(id)) throw refuseEmphasis()
      return emphasis.setPoint(folder, id, checkedEmphasisPatch(patch))
    },
    async addEmphasisPoint(folder, anchor) {
      if (typeof folder !== "string") throw refuseEmphasis()
      return emphasis.addPoint(folder, checkedEmphasisAnchor(anchor))
    },
    async setZoom(folder, anchor, kind) {
      const known = typeof anchor === "object" && anchor !== null && typeof anchor.videoId === "string" && Number.isInteger(anchor.sourceUs) && beatOk(anchor.beatId)
      if (!known || (kind !== null && !ZOOM_KINDS.includes(kind))) throw refuse()
      return flair.setZoom(folder, { videoId: anchor.videoId, sourceUs: anchor.sourceUs, ...(anchor.beatId !== undefined ? { beatId: anchor.beatId } : {}) }, kind)
    },
    async setFlairLook(folder, groupId, patch) {
      if (typeof groupId !== "string" || typeof patch !== "object" || patch === null) throw refuse()
      const accent = patch.accent
      if (accent !== undefined && accent !== null && (!Number.isInteger(accent.line) || !isText(accent.word) || (accent.lineIndex !== undefined && !Number.isInteger(accent.lineIndex)))) throw refuse()
      if (patch.exit !== undefined && patch.exit !== null && !isText(patch.exit)) throw refuse()
      if (patch.tone !== undefined && !TONES.includes(patch.tone)) throw refuse()
      return flair.setLook(folder, groupId, {
        ...(patch.pattern !== undefined ? { pattern: patch.pattern } : {}),
        ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
        ...(accent !== undefined ? { accent: accent === null ? null : { line: accent.line, word: accent.word, ...(accent.lineIndex !== undefined ? { lineIndex: accent.lineIndex } : {}) } } : {}),
        ...(patch.exit !== undefined ? { exit: patch.exit } : {}),
      })
    },
  }
}
