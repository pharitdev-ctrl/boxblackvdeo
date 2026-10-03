import type { AgentTurn } from "@boxblack/core/agent"
import type { AsrEngineId, ModelState, SpokenLanguage, VideoStatus } from "@boxblack/core/asr"
import type { ProjectDetail, ProjectSummary } from "@boxblack/core/capcut"
import type { CutPlan } from "@boxblack/core/cut"
import type { CutDecisionChange, CutDecisions, CutPreset, CutPresetId, CutRules } from "@boxblack/core/cut/rules"
import type { FlairLevel, FlairOptions, TextPattern } from "@boxblack/core/flair/catalogue"
import type { FrameEveryS } from "@boxblack/core/vision/estimate"
import type { MediaFit } from "@boxblack/core/flair/look-at"
import type { CueAnchor, GroupLook, InsertCue, PieceAnchor, SoundCue, Tone, ZoomCue, ZoomKind } from "@boxblack/core/flair/plan"
import type { MoveCue } from "@boxblack/core/flair/moves"
import type { GraphicCue, GraphicSpec } from "@boxblack/core/graphics/plan"
import type { ComposedSound, SoundLoudness } from "@boxblack/core/sound/spec"
import type { Dodge } from "@boxblack/core/highlights/layout"
import type { HighlightGroup } from "@boxblack/core/highlights/placement"
import type { EmphasisAnchor, EmphasisPatch, EmphasisType, Importance, StoredEmphasis } from "@boxblack/core/emphasis/types"
import type { HighlightOptions, HighlightPosition, HighlightStyleId } from "@boxblack/core/highlights/styles"
import type { LicenseErrorCode, LicenseInfo } from "@boxblack/core/license/protocol"
import type { ClaudeModelId, Effort, LlmTransportId } from "@boxblack/core/llm/types"
import type { ToolReport } from "@boxblack/core/media"
import type { Brief, Outline, UnusedPart } from "@boxblack/core/planner"
import type { SubtitleLength, SubtitleOptions } from "@boxblack/core/subtitles/captions"
import type { RetakeLoad, VisionStatus } from "@boxblack/core/vision"

// Type-only imports above on purpose: the sandboxed preload script bundles this file, and a
// value import from core would drag Node-only modules (child_process, the Anthropic SDK) into it.

/** Everything the renderer may ask the main process for. Each name becomes IPC channel `api:<name>`. */
export const API_METHODS = [
  "listProjects",
  "inspectProject",
  "readCover",
  "capcutStatus",
  "getSettings",
  "updateSettings",
  "saveApiKey",
  "deleteApiKey",
  "downloadModel",
  "cancelModelDownload",
  "installGraphicsPack",
  "cancelGraphicsPack",
  "removeGraphicsPack",
  "cleanGraphicFiles",
  "startAnalysis",
  "cancelAnalysis",
  "analysisState",
  "analysedVideos",
  "knownRetakes",
  "videosWithoutObjects",
  "locateObjects",
  "retryUnfetchableSounds",
  "claudeCodeStatus",
  "installClaudeCode",
  "loginClaudeCode",
  "openClaudeCodeLogin",
  "submitClaudeCodeLoginCode",
  "cancelClaudeCode",
  "getOutline",
  "planOutline",
  "regenerateOutline",
  "reviseOutline",
  "saveOutlineEdits",
  "saveOutlineDirection",
  "agentOpen",
  "agentSend",
  "agentStop",
  "agentReset",
  "agentLock",
  "agentRemove",
  "agentWrite",
  "agentLook",
  "cancelPlanning",
  "beatThumbnail",
  "previewCut",
  "writeTimeline",
  "writingTimeline",
  "previewSubtitles",
  "setSubtitleText",
  "setCutDecision",
  "unusedParts",
  "addOutlinePart",
  "previewHighlights",
  "setHighlightStyle",
  "editHighlightLine",
  "removeHighlightGroup",
  "addHighlightGroup",
  "setFlairLook",
  "setSoundCue",
  "setZoom",
  "setInsert",
  "setPointPicture",
  "setGraphic",
  "retryGraphic",
  "redoGraphic",
  "editGraphic",
  "undoGraphic",
  "redoMove",
  "editMove",
  "undoMove",
  "setMove",
  "redoSound",
  "editSound",
  "undoSound",
  "setSound",
  "planEmphasis",
  "setEmphasisPoint",
  "addEmphasisPoint",
  "planPost",
  "rethinkPost",
  "postPlanState",
  "cancelAi",
  "listBackups",
  "restoreBackup",
  "licenseState",
  "activateLicense",
  "refreshLicense",
  "deactivateLicense",
  "rescanTools",
  "updateState",
  "installUpdate",
] as const

export interface ProjectList {
  /** null when CapCut's drafts folder was not found on this machine */
  root: string | null
  projects: ProjectSummary[]
  /** how far the app has got with each project, by folder; a project not worked on is left out */
  stages: Record<string, ProjectStage>
}

/** The furthest stage a project reached, and when it reached it. */
export interface ProjectStage {
  stage: "analysed" | "outline" | "confirmed"
  at: number
}

export type ApiKeyName = "elevenlabs" | "anthropic"

/** How the app paints itself: with the system, or pinned light or dark. */
export const APPEARANCES = ["system", "light", "dark"] as const
export type Appearance = (typeof APPEARANCES)[number]

export interface SettingsPatch {
  asr?: { engine?: AsrEngineId; language?: SpokenLanguage }
  llm?: { transport?: LlmTransportId; model?: ClaudeModelId; effort?: Effort }
  cut?: Partial<CutRules>
  subtitles?: Partial<SubtitleOptions>
  highlights?: Partial<HighlightOptions>
  flair?: Partial<FlairOptions>
  vision?: { frameEveryS?: FrameEveryS }
  appearance?: Appearance
  capcut?: { pro?: boolean }
}

export interface DesktopApi {
  listProjects(): Promise<ProjectList>
  inspectProject(folder: string): Promise<ProjectDetail>
  /** The project's cover as a data URL, or null when CapCut has not made one yet. */
  readCover(folder: string): Promise<string | null>
  capcutStatus(): Promise<{ running: boolean }>

  getSettings(): Promise<SettingsView>
  updateSettings(patch: SettingsPatch): Promise<void>
  saveApiKey(name: ApiKeyName, key: string): Promise<void>
  deleteApiKey(name: ApiKeyName): Promise<void>
  downloadModel(): Promise<void>
  cancelModelDownload(): Promise<void>
  /** Returns once the download (Node, HyperFrames, Chrome) has started; `graphics-pack` events report progress and how it ended. */
  installGraphicsPack(): Promise<void>
  cancelGraphicsPack(): Promise<void>
  removeGraphicsPack(): Promise<void>
  /** Trashes rendered graphics no CapCut draft refers to any more; `blockedBy` says why nothing was trashed, `kept` why unused ones were left. */
  cleanGraphicFiles(): Promise<GraphicCleanResult>
  /** Looks for ffmpeg, whisper-cli and Claude Code again, after the customer installed one. */
  rescanTools(): Promise<void>
  updateState(): Promise<UpdateState>
  /** Quits and restarts into a downloaded update. */
  installUpdate(): Promise<void>

  /** Transcribes the chosen videos of a project, then has Claude describe their pictures. */
  startAnalysis(folder: string, videoIds: string[]): Promise<void>
  cancelAnalysis(): Promise<void>
  analysisState(): Promise<AnalysisState | null>
  /** The project's videos that are analysed already under the settings in force, so they need no run. */
  analysedVideos(folder: string): Promise<string[]>
  /** For each video whose speech is read already, what comparing its lines said twice will take: the estimate counts them. */
  knownRetakes(folder: string): Promise<Record<string, RetakeLoad>>
  /** The project's analysed videos whose objects were never found: analysed before the objects pass existed, or whose pass failed. */
  videosWithoutObjects(folder: string): Promise<string[]>
  /** Finds where things are in the pictures of videos analysed already; ends with analysis-finished, and holds the one-run lock meanwhile. */
  locateObjects(folder: string, videoIds: string[]): Promise<void>
  /** Offers the sounds CapCut could not fetch again: it may only have been offline. */
  retryUnfetchableSounds(): Promise<void>

  claudeCodeStatus(): Promise<ClaudeCodeStatus>
  /** Runs Anthropic's installer; settles when it finishes, with `claude-code` events on the way. */
  installClaudeCode(): Promise<void>
  /** Runs `claude auth login`, which opens the browser; settles once Claude Code is signed in. */
  loginClaudeCode(): Promise<void>
  /** Opens the sign-in page again while a login is waiting. */
  openClaudeCodeLogin(): Promise<void>
  /** The code a sign-in page shows when it cannot come back to Claude Code by itself. */
  submitClaudeCodeLoginCode(code: string): Promise<void>
  cancelClaudeCode(): Promise<void>

  getOutline(folder: string): Promise<StoredOutline | null>
  /** Plans a new outline from the analysed videos; replaces any earlier outline of the project. */
  planOutline(folder: string, videoIds: string[], brief: Brief): Promise<StoredOutline>
  /** A clearly different take, on the brief as the user has it now. */
  regenerateOutline(folder: string, brief: Brief): Promise<StoredOutline>
  reviseOutline(folder: string, instruction: string, brief: Brief): Promise<StoredOutline>
  /** Saves the user's reordering and removals; `confirmed` marks the outline ready for the timeline. */
  saveOutlineEdits(folder: string, beatIds: string[], confirmed: boolean): Promise<StoredOutline>
  /** Saves the user's own words for the clip's direction; the outline stays as confirmed as it was. */
  saveOutlineDirection(folder: string, direction: string): Promise<StoredOutline>
  /** The project's conversation with Claude, started from the pipeline's timeline under this request when it has none. */
  agentOpen(folder: string, request: AgentRequest): Promise<AgentView>
  /** A message to Claude; answers once its rounds are over (the tab follows them through "agent" events). */
  agentSend(folder: string, text: string): Promise<AgentView>
  agentStop(folder: string): Promise<void>
  /** Starts the conversation again from the pipeline's timeline; Claude's pieces and the conversation go. */
  agentReset(folder: string, request: AgentRequest): Promise<AgentView>
  agentLock(folder: string, id: string, locked: boolean): Promise<AgentView>
  agentRemove(folder: string, id: string): Promise<AgentView>
  /** Writes the conversation's timeline to the draft, with the same checks and backup as a write. */
  agentWrite(folder: string, expectedSegments: number): Promise<{ backup: BackupInfo; durationUs: number; segmentCount: number }>
  /** The last look Claude had at the project: what it shows and its sheets as data URLs; null before any. */
  agentLook(folder: string): Promise<{ what: string; sheets: string[] } | null>
  cancelPlanning(): Promise<void>
  /** A JPEG data URL of the frame at `atUs`, or null when it cannot be made. */
  beatThumbnail(folder: string, videoId: string, atUs: number): Promise<string | null>

  /** What the rough cut of the confirmed outline would keep and remove under these rules. */
  previewCut(folder: string, rules: CutRules): Promise<CutPlan>
  /**
   * Backs the draft up, then replaces its whole timeline with the rough cut. `expectedSegments`
   * is the segment count the user was warned about; if the draft now holds a different number,
   * it changed in the meantime and nothing is written.
   */
  writeTimeline(folder: string, rules: CutRules, expectedSegments: number, subtitles: SubtitleRequest | null, highlights: HighlightRequest | null): Promise<WriteResult>
  /**
   * Whether a write to this draft is running now: one waits for its graphics, which can take minutes,
   * and only one runs at a time. `timeline-write` events say when one starts and how it ends.
   */
  writingTimeline(folder: string): Promise<boolean>
  /** The subtitle lines a write with `length` would add to the rough cut under these rules; `hideUnderHighlights` leaves out the words shown as highlight text at the level in the saved settings. */
  previewSubtitles(folder: string, rules: CutRules, length: SubtitleLength, hideUnderHighlights: boolean): Promise<SubtitleLine[]>
  /** Keeps the user's text for one subtitle line, or forgets it with null, so it survives leaving the page. */
  setSubtitleText(folder: string, key: string, text: string | null): Promise<void>
  /** Stores a keep or cut decision for a video of the confirmed outline; previews and writes follow it. */
  setCutDecision(folder: string, videoId: string, change: CutDecisionChange): Promise<void>
  /** Sentences and pictures of the outline's videos that no beat uses. */
  unusedParts(folder: string): Promise<UnusedPart[]>
  /** Puts an unused part back into the outline, which then needs confirming again. */
  addOutlinePart(folder: string, partId: string): Promise<StoredOutline>
  /** The stored highlight text as the rough cut under these rules would show it, placed for these options. */
  previewHighlights(folder: string, rules: CutRules, options: HighlightViewOptions): Promise<HighlightPreview>
  setHighlightStyle(folder: string, style: HighlightStyleId): Promise<void>
  /** Changes a line's text, or removes the line when `text` is null; a group left with no line goes. */
  editHighlightLine(folder: string, groupId: string, lineIndex: number, text: string | null): Promise<void>
  removeHighlightGroup(folder: string, groupId: string): Promise<void>
  /**
   * Makes highlight text of words the user picked in a beat, split into lines of at most `maxChars`. `pointId`
   * makes it for that point (the emphasis tab's "Aa"), which must be stored: it then follows the point's level.
   */
  addHighlightGroup(folder: string, videoId: string, wordIndexes: number[], maxChars: number, beatId?: string, pointId?: string): Promise<void>
  /** Sets one group's look by hand, which stops Claude rewriting it. */
  setFlairLook(folder: string, groupId: string, patch: FlairLookPatch): Promise<void>
  /**
   * Takes a CapCut sound the user chose by hand off its place with a null sound. Choosing one is no longer possible
   * since sounds are composed (0.6.0): any sound named is refused.
   */
  setSoundCue(folder: string, anchor: CueAnchor, effectId: string | null): Promise<void>
  /** Zooms a piece by hand, or leaves it still with a null kind. */
  setZoom(folder: string, anchor: PieceAnchor, kind: ZoomKind | null): Promise<void>
  /**
   * Cuts away to one of the project's pictures by hand, or stops with a null picture. `replacing` names the
   * picture of the one cutaway changed when several sit at the place (the user's, moved to a beat's start
   * when their text went): only that one changes, in its place among the others. Without it every cutaway
   * at the place gives way, as a fresh pick does.
   */
  setInsert(folder: string, anchor: CueAnchor, binId: string | null, fit?: MediaFit, replacing?: string): Promise<void>
  /**
   * The picture a point cuts away to, from the emphasis tab, or none with null: the point's own cutaway is
   * replaced where it is, or one is put where the point starts under these rules, bound to the point and the
   * user's; null takes only the point's own off. Refused for a point that is not stored, or a picture the
   * project does not have.
   */
  setPointPicture(folder: string, rules: CutRules, pointId: string, binId: string | null, fit?: MediaFit): Promise<void>
  /**
   * Switches a graphic off or on by hand (Claude leaves it alone after), or removes it with null. Claude draws it,
   * so nothing else of it is changed by hand.
   */
  setGraphic(folder: string, anchor: CueAnchor, patch: GraphicPatch | null): Promise<void>
  /** Forgets a graphic's failed render, so the next preview renders it again. */
  retryGraphic(folder: string, anchor: CueAnchor): Promise<void>
  /**
   * Has Claude write one motion graphic again, from its idea, for the room it has on the rough cut under this request:
   * one run of the graphics work alone, refused while another run goes on the project, with `post-plan` events on the
   * way. Its fragment stays until the new writing has ended, then gives way to the new one, or to why there is none,
   * and is kept for one step back (`undoGraphic`).
   * The graphic does not become the user's own, and no other graphic is touched. A graphic with no place on the rough
   * cut now fails the work. Once it is written, the composed sounds tied to it are composed again in the same run, with
   * the sounds work among its works; tied sounds the level hides, or all of them with the sounds switched off, are not
   * composed again and read as stale by the picture.
   */
  redoGraphic(folder: string, anchor: CueAnchor, request: PostRequest): Promise<PostRunView>
  /**
   * Has Claude change one written motion graphic as the user asks (`instruction`, at most INSTRUCTION_MAX graphemes once
   * trimmed), for the room it has on the rough cut under this request: one run of the graphics work alone, as
   * `redoGraphic` is, with `post-plan` events on the way. Written, the new fragment is kept with the change and the one
   * before it is kept for one step back; failed, the graphic keeps its fragment and says why the edit failed. The
   * graphic does not become the user's own, and no other graphic is touched. One with no place on the rough cut now,
   * or not written yet, fails the work. Written, it has its tied sounds composed again as `redoGraphic` does; those the
   * level hides, or all of them with the sounds switched off, are not, and read as stale by the picture.
   */
  editGraphic(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest): Promise<PostRunView>
  /**
   * Takes a graphic one step back: the fragment kept by its last edit or writing again changes places with the one it
   * has, so a second step back comes back. Claude is not asked and it is no run, but it is refused while a run goes on
   * the project, and for a graphic with nothing to go back to.
   */
  undoGraphic(folder: string, anchor: CueAnchor): Promise<void>
  /**
   * Has Claude design one move of the picture again, at the word it starts on (or on its cutaway), as the techniques
   * plan would, the other words not asked: one run of the techniques work alone, refused while another run goes on the
   * project, with `post-plan` events on the way. The text and the graphics are not thought again; the preview places
   * them anew. The new move is checked where it plays: one that passes takes the move's place and the move before it is
   * kept for one step back (`undoMove`); one that fails, or no answer for that word, leaves the move as it was with why
   * (`MoveView.editFailed`). The move does not become the user's own. One with no place on the rough cut now fails the work.
   */
  redoMove(folder: string, anchor: MoveAnchor, request: PostRequest): Promise<PostRunView>
  /**
   * Has Claude change one move of the picture as the user asks (`instruction`, at most INSTRUCTION_MAX graphemes once
   * trimmed), from the poses it has, as `redoMove` designs one: kept with the change when it passes the checks, the one
   * before kept for one step back; otherwise the move is left as it was with why the edit failed.
   */
  editMove(folder: string, anchor: MoveAnchor, instruction: string, request: PostRequest): Promise<PostRunView>
  /**
   * Takes a move one step back: the poses kept by its last edit or redesign change places with the ones it has, so a
   * second step back comes back. Claude is not asked and it is no run, but it is refused while a run goes on the
   * project, and for a move with nothing to go back to.
   */
  undoMove(folder: string, anchor: MoveAnchor): Promise<void>
  /** Switches a move off or on by hand (Claude leaves it alone after), or removes it with null. */
  setMove(folder: string, anchor: MoveAnchor, patch: { off: boolean } | null): Promise<void>
  /**
   * Has Claude compose one composed sound again, from its role and the clip's palette, for the room it has on the rough
   * cut under this request, to its graphic's fragment as it is now when it is tied to one: one run of the sounds work
   * alone, refused while another run goes on the project, with `post-plan` events on the way. Its code stays until the
   * composing has ended, then gives way to the new one, or to why there is none, and is kept for one step back
   * (`undoSound`). A sound with no place on the rough cut now fails the work.
   */
  redoSound(folder: string, anchor: CueAnchor, request: PostRequest): Promise<PostRunView>
  /**
   * Has Claude change one written composed sound as the user asks (`instruction`, at most INSTRUCTION_MAX graphemes once
   * trimmed), as `redoSound` composes one. Written, the new code is kept with the change and the one before it for one
   * step back; failed, the sound keeps its code and says why the edit failed. One with no place on the rough cut now,
   * or not written yet, fails the work.
   */
  editSound(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest): Promise<PostRunView>
  /**
   * Takes a composed sound one step back: the code kept by its last edit or composing again changes places with the
   * one it has. Claude is not asked and it is no run, but it is refused while a run goes on the project, and for a
   * sound with nothing to go back to.
   */
  undoSound(folder: string, anchor: CueAnchor): Promise<void>
  /** Switches a composed sound off or on by hand, or removes it with null. */
  setSound(folder: string, anchor: CueAnchor, patch: { off: boolean } | null): Promise<void>
  /** Claude plans the emphasis points again; the user's and edited stay; Claude's old ones go with what sat on them. */
  planEmphasis(folder: string, rules: CutRules): Promise<{ count: number; dropped: number }>
  /** Changes a point by hand (it becomes the user's to keep), or deletes it with what sat on it. */
  setEmphasisPoint(folder: string, id: string, patch: EmphasisPatch | null): Promise<void>
  /** A point of the user's on words or a scene they chose; answers its id. */
  addEmphasisPoint(folder: string, anchor: EmphasisAnchor): Promise<string>
  /** Runs the whole plan behind the one button; each answer is stored as it comes and `post-plan` events say how each work stands; resolves when all are over, stopped or not. */
  planPost(folder: string, request: PostRequest): Promise<PostRunView>
  /** Thinks one work again on the points as they are; the user's own stays. */
  rethinkPost(folder: string, work: RethinkWork, request: PostRequest): Promise<PostRunView>
  /** How the plan run of this project stands, or how the last one ended; null when none ran since the app started. */
  postPlanState(folder: string): Promise<PostRunView | null>
  /** Stops the Claude calls that are going: the works of a plan run (planPost, rethinkPost, redoGraphic, editGraphic, redoMove, editMove, redoSound, editSound) and planEmphasis. They fail with "cancelled"; a plan run skips the works it had not started. */
  cancelAi(): Promise<void>
  /** Backups of this project, newest first. */
  listBackups(folder: string): Promise<BackupInfo[]>
  /** Puts a backup back in place of the draft; the draft it replaces is kept inside the backup. */
  restoreBackup(folder: string, backupId: string): Promise<void>

  licenseState(): Promise<LicenseState>
  activateLicense(key: string): Promise<{ ok: true; state: LicenseState } | { ok: false; error: ActivationError }>
  /** Asks the license server now instead of waiting for the next scheduled check. */
  refreshLicense(): Promise<LicenseState>
  /** Frees this machine's seat so the key can be used on another one. */
  deactivateLicense(): Promise<{ ok: true } | { ok: false; error: ActivationError }>
}

export type UpdateState =
  /** unsigned builds cannot install updates, so they never look for one */
  | { state: "disabled" }
  | { state: "idle" }
  | { state: "downloading"; version: string }
  | { state: "ready"; version: string }
  | { state: "error"; message: string }

/** Why work is refused while a license exists on this machine. */
export type LicenseBlockReason = "revoked" | "expired" | "not-activated" | "wrong-device" | "clock" | "token-expired"

export type LicenseState =
  /** this build asks for no license at all (see main/edition.ts) */
  | { state: "not-required" }
  | { state: "unlicensed" }
  /** `offline`: the last check could not reach the server; work continues until `tokenExpiresAt` */
  | { state: "active"; license: LicenseInfo; tokenExpiresAt: number; offline: boolean }
  | { state: "blocked"; reason: LicenseBlockReason; license: LicenseInfo | null }

export type ActivationError = LicenseErrorCode | "offline"

export type ReadinessProblem =
  | "ffmpeg-missing"
  | "ffmpeg-incomplete"
  | "whisper-unusable"
  | "whisper-missing"
  | "model-missing"
  | "scribe-key-missing"
  | "anthropic-key-missing"
  | "claude-cli-missing"
  | "claude-cli-login"

export interface Readiness {
  /** empty when analysis can start */
  problems: ReadinessProblem[]
}

/** The renderer's view of the settings — never includes a stored key itself. */
export interface SettingsView {
  asr: { engine: AsrEngineId; language: SpokenLanguage }
  llm: { transport: LlmTransportId; model: ClaudeModelId; effort: Effort }
  cut: CutRules
  subtitles: SubtitleOptions
  highlights: HighlightOptions
  flair: FlairOptions
  /** how often Claude looks at the pictures while a video is analysed, in seconds between frames */
  vision: { frameEveryS: FrameEveryS }
  appearance: Appearance
  /** the user has CapCut Pro: without it nothing that needs Pro goes into a draft */
  capcut: { pro: boolean }
  /** how many sounds are kept out because CapCut could not fetch them */
  unfetchableSounds: number
  /** the preset values in force, as the license server last sent them */
  cutPresets: Record<CutPresetId, CutPreset>
  /** the tools found on this machine and whether they can do the job */
  tools: ToolReport
  appVersion: string
  /** last four characters of each saved key, or null when none is saved */
  keyHints: Record<ApiKeyName, string | null>
  model: { label: string; sizeBytes: number; state: ModelState; downloading: boolean }
  /** the renderer pack graphics overlays need on this machine (see shared/graphics-pack.ts) */
  graphicsPack: GraphicsPackState
  /**
   * why graphics cannot render on this machine, as a render last found it (the pack damaged, the
   * app's ffmpeg, ffprobe or a font missing), even with the pack installed; null until one does, and
   * again once the pack is installed or removed or the tools are looked for again
   */
  graphicsProblem: GraphicsProblem | null
  /** the rendered .mov files kept under ~/Movies/CapCut/BOXBLACK/graphics, once that cache is counted */
  graphicFiles: { count: number; bytes: number }
  claudeCliFound: boolean
  readiness: Readiness
}

export interface AnalysisState {
  folder: string
  running: boolean
  /** how the run ended; null while it is still going */
  outcome: "done" | "cancelled" | "failed" | null
  /** why, when the outcome is "failed" */
  error: string | null
  transcription: Record<string, VideoStatus>
  vision: Record<string, VisionStatus>
}

/** Claude Code on this Mac, as the app installs it and signs it in. */
export interface ClaudeCodeStatus {
  /** macOS 13 or later: Claude Code runs on nothing older */
  supported: boolean
  /** where it is, or null when it is not installed */
  path: string | null
  version: string | null
  /** what `claude auth status` says; null when there is nothing to ask */
  account: { loggedIn: boolean; subscription: string | null } | null
  /** what the app is doing with it right now */
  busy: "installing" | "logging-in" | null
}

/** The renderer pack on this machine (see shared/graphics-pack.ts). */
export type GraphicsPackState =
  | { state: "missing" }
  | { state: "downloading"; received: number; total: number }
  /** downloaded and being unpacked; how far it has got is not worth showing */
  | { state: "installing" }
  | { state: "installed"; version: string }

/** Where one graphic's render stands: queued (or waiting for the renderer pack), being rendered, made, or failed until retried. */
export type GraphicRenderState = "waiting" | "rendering" | "ready" | "failed"

/**
 * Why graphics cannot render on this machine, in one short line: the renderer pack damaged, the app's
 * ffmpeg, ffprobe or a font missing. It stops every graphic, and none of them is to blame for it.
 */
export interface GraphicsProblem {
  text: string
}

/**
 * Why cleaning the graphics folder trashed nothing: CapCut's projects folder could not be found, or
 * a draft (or a folder that may hold one) under it, or under BOXBLACK's own backups, could not be
 * read, or graphics were rendering or a draft was being written (`busy`), whose files are in no draft
 * yet. `name` is short and never an absolute path (it can carry the user's home folder name): under
 * `capcut` it is the path relative to the drafts root (`"0917"`, `".recycle_bin/0917"`, or `""` for
 * the root itself); under `backup` it is the backup's own folder name, not the `draft` copy inside it.
 */
export type GraphicCleanBlock = { kind: "no-drafts-root" } | { kind: "busy" } | { kind: "unreadable"; where: "capcut" | "backup"; name: string }

/**
 * What a clean of the graphics folder did: how many rendered files it trashed, why it trashed none
 * (`blockedBy`), and why unused files were left when it did run (`kept`): some were made in the last
 * few minutes (`recent`), or a render or a write started partway, and it stopped there (`stopped`).
 */
export interface GraphicCleanResult {
  trashed: number
  blockedBy: GraphicCleanBlock | null
  kept: "recent" | "stopped" | null
}

/**
 * The works of the plan run, in the order the screen lists them; text, techniques and graphics are work 2's three calls
 * (2a, 2b, 2c). Since 0.8.0 the techniques run before the text, which keeps off the faces where the moves take them.
 */
export const POST_WORKS = ["emphasis", "text", "techniques", "graphics", "sounds", "subtitles"] as const
export type PostWork = (typeof POST_WORKS)[number]
/** What the AI menu can think again on its own; the points go through planEmphasis. */
export const RETHINK_WORKS = ["techniques", "graphics", "sounds", "subtitles"] as const
export type RethinkWork = (typeof RETHINK_WORKS)[number]

export type PostWorkState =
  | { state: "waiting" }
  /** `done` of `total`: how far a work that goes through its things one by one has got (the graphics work: the graphics whose writing has ended, of those it writes); absent until it says, and for the other works */
  | { state: "running"; done?: number; total?: number }
  | { state: "done"; count: number; dropped: number }
  /**
   * off: its switch is off (for graphics, also: the rough cut has no canvas to draw on) · no-emphasis: the
   * points failed, or none plays on the cut · stopped: the user pressed stop before it ran — once stop is
   * pressed every work of the run not yet run reads stopped, a switched-off one included
   */
  | { state: "skipped"; reason: "off" | "no-emphasis" | "stopped" }
  /** why it failed, or why it could not start (the points on the cut could not be read); error "cancelled" is the user's stop during it, not a failure to show */
  | { state: "failed"; error: string }

export interface PostRunView {
  running: boolean
  states: Partial<Record<PostWork, PostWorkState>>
}

/** Everything a plan run needs from the screen: the cut rules, the view options, and the subtitles as they are shown. */
export interface PostRequest {
  rules: CutRules
  view: HighlightViewOptions
  /** null when subtitles are off; `polish` says whether work 5 asks Claude */
  subtitles: { length: SubtitleLength; polish: boolean; hideUnderHighlights: boolean } | null
}

/** Pushed from the main process on channel `app:event`. */
export type AppEvent =
  | { type: "transcription"; folder: string; videoId: string; status: VideoStatus }
  | { type: "vision"; folder: string; videoId: string; status: VisionStatus }
  /** how finding the objects of one video stands, after its pictures are described or on request */
  | { type: "objects"; folder: string; videoId: string; status: { state: "running" } | { state: "done" } | { state: "failed"; error: string } }
  | { type: "analysis-finished"; folder: string; outcome: "done" | "cancelled" }
  | { type: "analysis-finished"; folder: string; outcome: "failed"; error: string }
  | { type: "model-download"; state: "progress"; received: number; total: number }
  | { type: "model-download"; state: "done" | "cancelled" }
  | { type: "model-download"; state: "failed"; error: string }
  | { type: "graphics-pack"; state: "progress"; received: number; total: number }
  | { type: "graphics-pack"; state: "installing" }
  | { type: "graphics-pack"; state: "done" | "cancelled" }
  | { type: "graphics-pack"; state: "failed"; error: string }
  /** pushed while graphics render in the background, for the project in `folder`: as each render starts and ends, and when all have */
  | { type: "graphics"; folder: string; state: "started"; hash: string }
  | { type: "graphics"; folder: string; state: "progress"; hash: string; done: number; total: number }
  | { type: "graphics"; folder: string; state: "done" }
  | { type: "graphics"; folder: string; state: "failed"; hash: string; error: string }
  /** a composed sound's render in the background ended (made, failed, or found the machine unfit), for whichever project asked: the page reads how its sounds stand */
  | { type: "sounds-rendered" }
  /** a write to the draft in `folder` started, or ended; the post-production page that asked may have been left and opened again meanwhile */
  | { type: "timeline-write"; folder: string; state: "started" }
  | { type: "timeline-write"; folder: string; state: "done"; result: WriteResult }
  | { type: "timeline-write"; folder: string; state: "failed"; error: string }
  /** how one work of a plan run stands; a run starts by sending "waiting" for every work it will touch */
  | { type: "post-plan"; folder: string; work: PostWork; state: PostWorkState }
  /** a plan run (planPost, rethinkPost, redoGraphic, editGraphic, redoMove, editMove, redoSound, editSound or planEmphasis) is over, stopped or not */
  | { type: "post-plan-finished"; folder: string }
  | { type: "license"; state: LicenseState }
  | { type: "update"; state: UpdateState }
  /** how a conversation with Claude stands, after every change while it works */
  | { type: "agent"; view: AgentView }
  /** `progress` is a line the installer printed; `error` is why an install or login stopped */
  | { type: "claude-code"; status: ClaudeCodeStatus; progress?: string; error?: string }

/** The latest outline of a project, with the brief and videos it was planned from. */
export interface StoredOutline {
  folder: string
  videoIds: string[]
  brief: Brief
  outline: Outline
  /** set when the user confirms; any later change clears it */
  confirmed: boolean
  model: string
  promptVersion: string
  updatedAt: number
  /** the user's keep and cut decisions on the rough cut; planning again starts without them */
  cutDecisions?: CutDecisions
  /** highlight text picked by Claude or the user; planning again starts without it */
  highlights?: StoredHighlights
  /**
   * how each highlight group looks, by group id, and the sound effects, zooms, moves, cutaways and graphics on the rough
   * cut. `cues` are CapCut library sounds, kept only for what is already there; `composed` are the sounds Claude composed
   * since 0.6.0, and `palette` the clip's sound palette they were composed to. `zooms` are the punches and drifts of
   * before 0.8.0, which play until the techniques are thought again; `moves` are the moves of the picture Claude
   * designs since 0.8.0
   */
  flair?: { looks: Record<string, GroupLook>; cues?: SoundCue[]; zooms?: ZoomCue[]; moves?: MoveCue[]; inserts?: InsertCue[]; graphics?: GraphicCue[]; composed?: ComposedSound[]; palette?: string }
  /** the emphasis points and their bookkeeping; absent until points are planned or added. The level shows only the items on points of the importances it lets through. */
  emphasis?: StoredEmphasis
  /** the user's or the polish's text per subtitle line, by `SubtitleLine.key` */
  subtitleTexts?: Record<string, string>
  /**
   * how far the one-time cleanups have brought the outline: absent on one from before M25, 1 once the pre-M25
   * cleanup ran (or the outline was made by 0.4), POST_VERSION once the graphics of the old kit went too (or the
   * outline was made by this version)
   */
  postVersion?: number
}

export interface StoredHighlights {
  /** the style the user chose, if they did */
  style: HighlightStyleId | null
  /** the style Claude chose when it last picked */
  styleByAi: HighlightStyleId | null
  groups: HighlightGroup[]
  /** the outline's beats when Claude last picked, to tell the user the outline changed since */
  beatsKey: string | null
  /** per video, the transcript the groups' word numbers belong to */
  transcripts: Record<string, string>
}

/** What the preview needs to place the groups: where the user pinned them, and whether subtitles take the bottom. */
export interface HighlightViewOptions {
  position: HighlightPosition
  subtitlesOn: boolean
  /** highlight text is on: without it no group is placed, shown or written, and no subtitle is hidden under one */
  highlightsOn: boolean
  /** the flair settings in force: each work's switch, and the level that chooses which emphasis points' items show */
  flair: FlairOptions
}

export interface HighlightLineView {
  /** the line's place in its stored group */
  index: number
  text: string
  /** on the rough cut, before rounding to frames */
  startUs: number
  /** some of its words were cut */
  partial: boolean
}

export interface HighlightGroupView {
  id: string
  beatId: string
  source: "ai" | "user"
  /** the point it was made for; absent when it is bound to none */
  pointId?: string
  /**
   * a graphic takes its place: its point has a graphic that plays (switched on, shown at the level, with room on
   * the frame, written and not stale), so the group is not drawn in the clip and hides no subtitle words. It is
   * listed all the same, with the times and the look it would have, and its lines stay moments of the clip that
   * sounds, cutaways and zooms sit on
   */
  replaced: boolean
  startUs: number
  endUs: number
  /** what the placement did: dodged the picture above or below it, covered it, or had no picture to go by */
  placement: Dodge
  /** how the group looks: its pattern, its accented word and its exit animation */
  look: GroupLook
  /** an exit the group keeps but that needs CapCut Pro, which the user does not have: not written, and shown so an edit of the rest of the look keeps it */
  heldExit?: { id: string; name: string }
  lines: HighlightLineView[]
  /** a label on a picture beat, not words said */
  scene?: true
}

/** One sound effect on the rough cut, as the post-production page shows it. */
export interface CueView {
  anchor: CueAnchor
  /** where it plays on the rough cut */
  atUs: number
  /** what it sits on, in the user's language */
  what: string
  /** the beat it plays in */
  beatId: string
  effectId: string
  soundName: string
  /** the user chose this one by hand */
  edited: boolean
  /** the point it was made for; absent when it is bound to none */
  pointId?: string
}

/** One zoom on the rough cut, as the post-production page shows it. */
export interface ZoomView {
  anchor: PieceAnchor
  /** where the piece starts on the rough cut */
  atUs: number
  durationUs: number
  /** what plays there, in the user's language */
  what: string
  /** the beat it plays in */
  beatId: string
  kind: ZoomKind
  /** the user chose this one by hand */
  edited: boolean
  /** the point it was made for; absent when it is bound to none */
  pointId?: string
}

/**
 * Where a move of the picture is, as the page names it to the app: its stored anchor, the word it starts on or its
 * cutaway's, with `insert: true` for a move on a cutaway. A move on a word and one on the cutaway that comes up on that
 * same word share an anchor, and are told apart by it.
 */
export type MoveAnchor = CueAnchor & { insert?: boolean }

/** One move of the picture on the rough cut, as the post-production page shows it. */
export interface MoveView {
  /** as stored, which a change finds it by (`MoveAnchor`, with `insert`) */
  anchor: CueAnchor
  /** it moves a cutaway, from its first frame, rather than the footage */
  insert: boolean
  /** where it starts on the rough cut */
  atUs: number
  /** how long its poses run before it holds the last */
  durationUs: number
  /** the beat it plays in */
  beatId: string
  /** what it does, in Claude's words, one line in Thai */
  about: string
  /** the lowest level it plays at */
  from: FlairLevel
  /** the point it was made for; absent when it is bound to none */
  pointId?: string
  /** the user switched it off or on by hand */
  edited: boolean
  off: boolean
  /** the change the user asked for that made the poses it has; null when none did */
  instruction: string | null
  /** why the last redesign or edit could not be used; null when it was */
  editFailed: string | null
  /** it keeps the poses it had before, for one step back */
  canUndo: boolean
}

/** One cutaway on the rough cut, as the post-production page shows it. */
export interface InsertView {
  anchor: CueAnchor
  atUs: number
  durationUs: number
  /** what it cuts away from, in the user's language */
  what: string
  /** the beat it plays in */
  beatId: string
  binId: string
  /** what the picture shows, else its file name */
  picture: string
  /** over the whole frame, or as a card the speaker stays visible beside */
  fit: MediaFit
  /** the user chose this one by hand */
  edited: boolean
  /** the point it was made for; absent when it is bound to none */
  pointId?: string
}

/** One graphic on the rough cut, as the post-production page shows it. */
export interface GraphicView {
  anchor: CueAnchor
  atUs: number
  durationUs: number
  /** what it sits on, in the user's language */
  what: string
  /** the beat it plays in */
  beatId: string
  /** Claude's one line on why it is there */
  why: string
  /** what it draws, in the user's language: its idea */
  summary: string
  /** as it plays: in the box it was moved to on this rough cut */
  spec: GraphicSpec
  /** it has the fragment Claude wrote for it */
  written: boolean
  /** written, and no longer played by the rough cut as it was written for (its words changed, or it is cut short), or written under an earlier contract: it waits to be written again */
  stale: boolean
  /** why its last writing failed; null when none has */
  writeFailed: string | null
  /** the change the user asked for that made the fragment it has; null when a plan or a writing again made it */
  instruction: string | null
  /** why the user's last edit of it failed, the fragment from before that edit still playing; null when none has */
  editFailed: string | null
  /** a fragment an edit or a writing again replaced is kept: the graphic can go one step back to it */
  canUndo: boolean
  /** one with nothing to render, not written yet or stale, waits */
  render: GraphicRenderState
  /** a small PNG data URL once rendered */
  poster: string | null
  /** why the render failed, when it did */
  error: string | null
  /** the user changed it by hand */
  edited: boolean
  /** the point it was made for; absent when it is bound to none */
  pointId?: string
  /** switched off by the user */
  off: boolean
  /** the lowest level it plays at; null on a graphic planned before 0.7.0, which plays by its point's importance */
  from: FlairLevel | null
  /** it plays in place of its point's highlight text, which is not drawn meanwhile */
  replaces: boolean
  /** its box covers a face or a shown thing, so it plays 1.5 s at most */
  coversKeep: boolean
}

/** What the user may change on a graphic from the post-production page: switched off or on. Claude draws it, so nothing else of it is changed by hand; leaving the field out keeps it. */
export interface GraphicPatch {
  off?: boolean
}

/** One sound effect Claude composed, as the post-production page shows it. */
export interface ComposedSoundView {
  /** its stored anchor, which an edit finds it by */
  anchor: CueAnchor
  /** where it starts on the rough cut: its moment's place, or its graphic's */
  atUs: number
  /** how long it plays there: its length, or less where its room ends first */
  durationUs: number
  /** the beat it plays in */
  beatId: string
  /** what it does, in the user's language */
  role: string
  /** the lowest level it plays at */
  from: FlairLevel
  loudness: SoundLoudness
  /** the point it was made for; absent when it is bound to none */
  pointId?: string
  /** the graphic it scores, summed up by its idea; null for a sound on a moment of speech alone */
  graphic: { summary: string } | null
  /** it has the code Claude composed for it */
  written: boolean
  /**
   * written, and no longer played as it was composed for: "cut" when its words or its room changed, or it was composed
   * under an earlier contract; "picture" when the graphic it scores was written again or waits to be. It waits to be
   * composed again
   */
  stale: "cut" | "picture" | null
  /** why its last composing failed; null when none has */
  writeFailed: string | null
  /** the change the user asked for that made the code it has; null when a plan or a composing again made it */
  instruction: string | null
  /** why the user's last edit of it failed, the code from before that edit still playing; null when none has */
  editFailed: string | null
  /** a code an edit or a composing again replaced is kept: the sound can go one step back to it */
  canUndo: boolean
  /** switched off by the user, or its graphic is */
  off: boolean
  /** its file: one with nothing to render (not written, stale, failed or switched off) waits */
  render: "pending" | "ready" | "failed"
  /** why the render failed, when it did */
  error: string | null
}

/** A CapCut sound the user chose by hand before 0.6.0, still playing: it can only be taken off now. */
export interface OwnSoundView {
  /** the place it plays on, which taking it off names */
  anchor: CueAnchor
  atUs: number
  /** what the sound is, from this machine's sound library */
  name: string
}

/** A change to one group's look from the post-production page; leaving a field out keeps it. */
export interface FlairLookPatch {
  pattern?: TextPattern
  /** which of the palette's colours the whole group reads in */
  tone?: Tone
  /**
   * the word to colour: the line's place among the lines shown, its place in the stored group
   * (they differ when a line above it was cut; the shown place when absent) and the word itself;
   * it is kept by the stored line, so it stays on that line whatever is cut above it. null clears it
   */
  accent?: { line: number; lineIndex?: number; word: string } | null
  /** an exit animation id, or null for none */
  exit?: string | null
}

export interface HighlightPreview {
  /** the style in force: the user's, else Claude's, else the default */
  style: HighlightStyleId
  styleByAi: HighlightStyleId | null
  groups: HighlightGroupView[]
  /**
   * stored groups that would pass the level but that the rough cut does not show, because their words are
   * cut or the transcript changed: groups bound to no point, or to a point placed at a level that shows it.
   * Claude's groups whose point is not placed (cut away, or on an earlier transcript) are counted with the
   * points instead, in `emphasis.hidden`
   */
  hidden: number
  /** the outline changed since Claude picked */
  outlineChanged: boolean
  /** placement is automatic but a video has no pictures analysed, so its text cannot dodge anything */
  needsPictures: boolean
  /** the longest line that stays readable at the rough cut's frame size */
  maxChars: number
  /** wide output: the patterns that only work on portrait are not offered */
  landscape: boolean
  /** the sound effects that will play, in time order */
  cues: CueView[]
  /** every place a sound could go, for the screen to offer */
  slots: { anchor: CueAnchor; atUs: number; what: string; beatId: string }[]
  /** the sounds the user may put on a place: every one this machine's CapCut has with CapCut Pro, the free ones without */
  sounds: { effectId: string; name: string }[]
  /**
   * stored sounds that are not playing: `unplaced` when their place is not on the rough cut now
   * (its words are cut, its join is gone), `missing` when this machine does not have the sound,
   * `lost` when they sit on highlight text made from an earlier transcript, which never shows again,
   * `pro` when the sound needs CapCut Pro, which the user does not have
   */
  unusedSounds: { unplaced: number; missing: number; lost: number; pro: number }
  /** the sounds Claude composed that play, at the level in force, in time order, one not composed yet or stale among them (a write leaves it out), then the switched-off ones */
  composed: ComposedSoundView[]
  /** the CapCut sounds the user chose by hand that still play, in time order */
  ownSounds: OwnSoundView[]
  /**
   * the punches and drifts of before 0.8.0 that will play, in time order. One on a piece a move plays on is left out:
   * the move replaces it there, and it plays again once that move goes
   */
  zooms: ZoomView[]
  /** Claude's moves of the picture that will play, in time order, then the switched-off ones */
  moves: MoveView[]
  /** every piece a zoom could go on */
  pieces: { anchor: PieceAnchor; atUs: number; durationUs: number; what: string; beatId: string }[]
  /** zooms stored whose piece is not on the rough cut now (the cut moved its start), and moves stored with no place on it (their word or cutaway gone) */
  zoomsLost: number
  /** the cutaways that will play, in time order */
  inserts: InsertView[]
  /** the project's spare photos and clips */
  media: { binId: string; name: string; kind: "photo" | "video"; what: string }[]
  /** the graphics that will play, in time order, a motion graphic not written yet or stale among them (it is listed where it would play, and a write leaves it out), then the ones switched off */
  graphics: GraphicView[]
  /** graphics are on but the renderer pack is not installed: nothing is rendered until it is */
  graphicsWaitForPack: boolean
  /**
   * why graphics cannot render on this machine though the pack may be installed, as a render found
   * it (the pack damaged, the app's ffmpeg, ffprobe or a font missing), in one short line; null when
   * nothing is known to be wrong. While it is set nothing renders, and graphicsWaitForPack is true too
   */
  graphicsProblem: GraphicsProblem | null
  /**
   * why composed sounds cannot render on this machine, as a render found it (the sealed page or the app's ffmpeg), in
   * plain English; null when nothing is known to be wrong, and while the sounds are off
   */
  soundsProblem: string | null
  /** what the emphasis tab shows: the points on this rough cut, the sentences and scenes to make more from, and whether works 2 and 4 are behind */
  emphasis: EmphasisView
  /**
   * the exit animations the look popover may offer: the free ones without CapCut Pro, every one with it. Since 0.4.3
   * none is free, so without Pro this is empty and the look menu says why under its exit select (`flair.exit.allPro`)
   */
  exits: { id: string; name: string }[]
  /** what is not written because it needs CapCut Pro, which the user does not have: the exits of the groups that are written (a replaced group is not) and sound effects */
  proLeftOut: { exits: number; sounds: number }
}

/** One point as the emphasis tab shows it. */
export interface EmphasisPointView {
  id: string
  anchor: EmphasisAnchor
  importance: Importance
  type: EmphasisType
  reason: string
  source: "ai" | "user"
  edited: boolean
  /** the beat it plays in */
  beatId: string
  /** where it plays on the rough cut, before rounding to frames */
  atUs: number
  endUs: number
  /** the words it stresses, or the scene's description */
  text: string
  /** it passes the level in force: its items play */
  shown: boolean
  /** what plays on it now, by kind */
  items: { text: number; zoom: number; insert: number; graphic: number; sound: number }
}

/** A sentence the rough cut plays, with its words, for picking a phrase in the emphasis tab. */
export interface EmphasisSentenceView {
  videoId: string
  beatId: string
  /** its words [from, to) in the transcript */
  from: number
  to: number
  atUs: number
  words: string[]
}

/** A kept scene of a picture beat, for making a point of it. */
export interface EmphasisSceneView {
  videoId: string
  beatId: string
  /** its stretch in the file, clipped to what is kept */
  startUs: number
  endUs: number
  atUs: number
  durationUs: number
  description: string
  /** the point already on it, if any */
  pointId: string | null
}

export interface EmphasisView {
  /** the stored points placed on this rough cut, in playing order */
  points: EmphasisPointView[]
  sentences: EmphasisSentenceView[]
  scenes: EmphasisSceneView[]
  /** stored points not shown: every word of them cut, or their transcript changed */
  hidden: number
  version: number
  /**
   * the points changed since work 2's text and techniques, its graphics, or work 4 (sounds) last planned on them, or that
   * work left items on them with no version stored (a failed first run)
   */
  changed: { techniques: boolean; graphics: boolean; sounds: boolean }
}

/** Highlight text to write with the rough cut, as the user last saw it. */
export interface HighlightRequest {
  position: HighlightPosition
  hideSubtitles: boolean
  /** highlight text is on: without it no group is placed, shown or written, and no subtitle is hidden under one */
  highlightsOn: boolean
  /** the flair settings the preview was shown with */
  flair: FlairOptions
  /** the number of groups the preview listed, the replaced ones among them; a different number now means it changed */
  groupCount: number
}

/** A copy of a draft taken before BOXBLACK wrote to it. */
export interface BackupInfo {
  id: string
  /** ISO time the backup was taken */
  createdAt: string
  /** length and segment count of the timeline in the backup */
  durationUs: number
  segmentCount: number
}

export interface WriteResult {
  backup: BackupInfo
  durationUs: number
  segmentCount: number
  /** subtitle segments written */
  captionCount: number
  /** highlight text lines written */
  highlightCount: number
  /** sound effects the writer placed */
  soundCount: number
  /** pieces of the rough cut the writer gave a zoom */
  zoomCount: number
  /** cutaways the writer placed */
  insertCount: number
  /** graphics the writer placed */
  graphicCount: number
  /** sounds Claude composed that the writer placed */
  composedCount: number
  /**
   * what the writers left out: an item with less than a frame left to play, or one that starts before
   * the rough cut does. The zooms' is only a safety net (a piece not on the timeline, no length, or a
   * second zoom on a piece already zoomed): the write hands the writer zooms mapped from the cut's own
   * pieces (zoomsFor), one a piece (enforceZooms). Zooms whose piece is gone are counted in `zoomsLost`. The moves'
   * are those the checks turned down (movesInForce: a move that fails them, or plays while another does on its piece
   * or cutaway) and those the writer left out; a legacy zoom on a piece a move plays on is replaced, not left out
   */
  dropped: { sounds: number; zooms: number; inserts: number; graphics: number; moves: number }
  /**
   * composed sounds in force that the write left out: not composed yet (`unwritten`); no longer played as they were
   * composed for, or tied to a graphic this write leaves out (`stale`); their composing or their render failed (`failed`).
   * Those the writer itself left out are in `dropped.sounds`
   */
  composedLeftOut: { unwritten: number; stale: number; failed: number }
  /** zooms stored whose piece is not on the rough cut any more, and moves stored with no place on it (their word or cutaway gone) */
  zoomsLost: number
  /** graphics left out because their render failed or their file was gone by the write, and motion graphics left out because they are not written yet or are stale */
  graphicsSkipped: number
  /** emphasis points placed on the rough cut that pass the level in force; 0 without a highlight request */
  emphasisCount: number
  /** what was left out of the draft because it needs CapCut Pro, which the user does not have: groups' exits and sound effects (zeros without a highlight request) */
  proLeftOut: { exits: number; sounds: number }
}

/** One subtitle as it will appear on the rough cut; times are µs on the new timeline, before rounding to frames. */
export interface SubtitleLine {
  /** the line's source video, times and generated text: the same key means the same line */
  key: string
  beatId: string
  startUs: number
  endUs: number
  text: string
  /** the text stored for this line (the user's, or the polish's), when there is one; `text` stays the generated line */
  savedText?: string
}

/** Subtitles to write with the rough cut: one text per line of the preview for `length`, edited or not; a blank text leaves that line out. */
export interface SubtitleRequest {
  length: SubtitleLength
  texts: string[]
}

/** Push channel from main to renderer, exposed next to the API by the preload script. */
export interface DesktopEvents {
  onEvent(listener: (event: AppEvent) => void): () => void
}

/** What the renderer sees on window.boxblack. */
export type RendererApi = DesktopApi & DesktopEvents

export type { AsrEngineId, ModelState, SpokenLanguage, TimedText, Transcript, VideoStatus } from "@boxblack/core/asr"
export type { ProjectDetail, ProjectSummary, ProjectVideo } from "@boxblack/core/capcut"
export type { CutPlan } from "@boxblack/core/cut"
export type { BeatCut, BeatCutNote, CutDecisionChange, CutPreset, CutPresetId, CutRow, CutRules, Removal, RemovalReason } from "@boxblack/core/cut/rules"
export type { LicenseInfo } from "@boxblack/core/license/protocol"
export type { SubtitleLength, SubtitleOptions } from "@boxblack/core/subtitles/captions"
export type { HighlightGroup, HighlightLine } from "@boxblack/core/highlights/placement"
export type { Dodge } from "@boxblack/core/highlights/layout"
export type { HighlightOptions, HighlightPosition, HighlightStyleId } from "@boxblack/core/highlights/styles"
export type { FlairLevel, FlairOptions, TextPattern } from "@boxblack/core/flair/catalogue"
export type { CueAnchor, GroupLook, InsertCue, PieceAnchor, SoundCue, ZoomCue, ZoomKind } from "@boxblack/core/flair/plan"
export type { BinMedia } from "@boxblack/core/flair/media"
export type { SoundEffect } from "@boxblack/core/flair/sounds"
export type { ToolReport } from "@boxblack/core/media"
export type { ClaudeModelId, LlmTransportId } from "@boxblack/core/llm/types"
export type { Beat, Brief, Outline, OutlineWarning, UnusedPart, VideoType } from "@boxblack/core/planner"
export type { Scene, VideoInsight, VisionStatus } from "@boxblack/core/vision"
export type { EmphasisAnchor, EmphasisPatch, EmphasisPoint, EmphasisType, Importance, StoredEmphasis } from "@boxblack/core/emphasis/types"

/** What the agent tab opens a conversation with: the rules and the request its write button would send. */
export interface AgentRequest {
  rules: CutRules
  subtitles: SubtitleRequest | null
  highlights: HighlightRequest | null
}

/** One piece as the agent tab lists it. */
export interface AgentPieceView {
  id: string
  kind: string
  startUs: number
  endUs: number
  label: string
  by: "pipeline" | "claude" | "user"
  locked: boolean
}

/** How a project's conversation with Claude stands. */
export interface AgentView {
  folder: string
  turns: AgentTurn[]
  running: boolean
  /** the round under way or last run for the latest message, and how many it may have */
  round: number
  rounds: number
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  costUsd: number
  direction: string
  pieces: AgentPieceView[]
  /** the last message used all its rounds: the tab offers "ทำต่อ" */
  summed: boolean
  /** how many looks Claude has had at the project since the app started: the tab reads the last one when this changes */
  looks: number
}

export type { AgentTurn } from "@boxblack/core/agent"
