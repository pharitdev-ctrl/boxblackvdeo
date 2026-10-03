import { EXIT_ANIMATIONS } from "@boxblack/core/flair/catalogue"
import { DEFAULT_HIGHLIGHT_OPTIONS } from "@boxblack/core/highlights/styles"
import type {
  AppEvent,
  BackupInfo,
  Beat,
  BeatCut,
  CutPlan,
  EmphasisView,
  HighlightGroupView,
  HighlightPreview,
  LicenseState,
  ProjectDetail,
  ProjectSummary,
  RendererApi,
  SettingsView,
  StoredOutline,
  SubtitleLine,
  Transcript,
  VideoInsight,
  ClaudeCodeStatus,
} from "../../shared/api.ts"

export const summary = (name: string, extra: Partial<ProjectSummary> = {}): ProjectSummary => ({
  name,
  folder: `/drafts/${name}`,
  durationUs: 14_000_000,
  modifiedUs: 1_789_623_936_439_997,
  coverPath: null,
  ...extra,
})

/** Claude Code installed and signed in, the way a working machine has it. */
export const claudeCodeStatus = (extra: Partial<ClaudeCodeStatus> = {}): ClaudeCodeStatus => ({
  supported: true,
  path: "/Users/me/.local/bin/claude",
  version: "2.1.280",
  account: { loggedIn: true, subscription: "max" },
  busy: null,
  ...extra,
})

export const detail = (extra: Partial<ProjectDetail> = {}): ProjectDetail => ({
  name: "0917",
  folder: "/drafts/0917",
  capcutVersion: "9.4.0",
  versionTested: true,
  fps: 30,
  canvas: { width: 1080, height: 1920 },
  timelineSegmentCount: 0,
  videos: [
    { id: "a", path: "/media/intro.mov", name: "intro.mov", durationUs: 31_106_000, width: 1080, height: 1920, exists: true },
    { id: "b", path: "/media/broll.mp4", name: "broll.mp4", durationUs: 10_000_000, width: 1920, height: 1080, exists: true },
  ],
  ...extra,
})

export const settingsView = (extra: Partial<SettingsView> = {}): SettingsView => ({
  asr: { engine: "whisper-local", language: "th" },
  llm: { transport: "anthropic-api", model: "claude-opus-5", effort: "medium" },
  cut: { preset: "normal", cutFillers: true, cutRetakes: true, cutBadPicture: true },
  subtitles: { enabled: false, length: "line", polish: false },
  highlights: { enabled: false, position: "auto", hideSubtitles: true, custom: DEFAULT_HIGHLIGHT_OPTIONS.custom },
  flair: { enabled: false, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false },
  vision: { frameEveryS: 3 },
  appearance: "system",
  capcut: { pro: false },
  unfetchableSounds: 0,
  cutPresets: {
    tight: { maxPauseUs: 300_000, paddingUs: 80_000 },
    normal: { maxPauseUs: 600_000, paddingUs: 150_000 },
    loose: { maxPauseUs: 1_000_000, paddingUs: 250_000 },
  },
  keyHints: { elevenlabs: null, anthropic: "9876" },
  model: { label: "Whisper large-v3 (q5_0)", sizeBytes: 1_081_140_203, state: { status: "ready" }, downloading: false },
  graphicsPack: { state: "missing" },
  graphicsProblem: null,
  graphicFiles: { count: 0, bytes: 0 },
  claudeCliFound: true,
  readiness: { problems: [] },
  tools: {
    ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: "8.1.2", missing: [] },
    ffprobe: { path: "/opt/homebrew/bin/ffprobe" },
    whisper: { path: "/opt/homebrew/opt/boxblack-whisper/bin/whisper-cli", usable: true, pinned: true },
    claude: { path: "/Users/me/.local/bin/claude", version: "2.1.233" },
  },
  appVersion: "0.1.0",
  ...extra,
})

export const insight = (description: string): VideoInsight => ({
  model: "claude-opus-5",
  promptVersion: "vision-2026-09-17",
  frameCount: 11,
  retakes: [],
  signals: { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] },
  summary: "ชายหนุ่มเล่าเรื่องนักบินอวกาศ",
  scenes: [{ startUs: 500_000, endUs: 30_500_000, description, kind: "talking-head", issues: [], keepClear: null }],
  usage: { inputTokens: 2_900, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
})

export const transcript = (text: string): Transcript => ({
  engine: "whisper-local",
  model: "large-v3-q5_0",
  language: "th",
  utterances: [{ text, startUs: 1_900_000, endUs: 7_040_000 }],
  words: [{ text, startUs: 1_900_000, endUs: 7_040_000 }],
  audioEvents: [],
})

const beat = (id: string, name: string, videoId: string, startUs: number, endUs: number, extra: Partial<Beat> = {}): Beat => ({
  id,
  name,
  purpose: `หน้าที่ของ${name}`,
  videoId,
  videoName: videoId === "a" ? "intro.mov" : "broll.mp4",
  kind: videoId === "a" ? "speech" : "scenes",
  fromIndex: 0,
  toIndex: 0,
  startUs,
  endUs,
  speech: videoId === "a" ? `คำพูดใน${name}` : "",
  visual: `ภาพใน${name}`,
  ...extra,
})

export const storedOutline = (extra: Partial<StoredOutline> = {}): StoredOutline => ({
  folder: "/drafts/0917",
  videoIds: ["a", "b"],
  brief: { targetSeconds: 30, videoType: "review", instructions: "" },
  outline: {
    title: "นักบินอวกาศ",
    summary: "เล่าว่านักบินขึ้นอวกาศได้อย่างไร",
    omitted: "ตัดช่วงนับถอยหลังที่พูดผิด",
    beats: [
      beat("b1", "เปิดเรื่อง", "a", 1_900_000, 7_000_000),
      beat("b2", "ภาพประกอบ", "b", 500_000, 3_500_000),
      beat("b3", "ปิดท้าย", "a", 26_800_000, 30_100_000),
    ],
    warnings: [],
  },
  confirmed: false,
  model: "claude-opus-5",
  promptVersion: "planner-2026-09-17",
  updatedAt: 0,
  ...extra,
})

const beatCut = (beatId: string, videoId: string, startUs: number, endUs: number, extra: Partial<BeatCut> = {}): BeatCut => ({
  beatId,
  videoId,
  pieces: [{ startUs, endUs }],
  removals: [],
  originalUs: endUs - startUs,
  keptUs: endUs - startUs,
  notes: [],
  rows: [],
  ...extra,
})

/** The cut of storedOutline(): a filler and two pauses out of the opening, a retake out of the ending. */
export const cutPlan = (extra: Partial<CutPlan> = {}): CutPlan => {
  const beats = [
    beatCut("b1", "a", 1_750_000, 7_150_000, {
      pieces: [
        { startUs: 1_750_000, endUs: 3_300_000 },
        { startUs: 3_700_000, endUs: 5_000_000 },
        { startUs: 5_500_000, endUs: 7_150_000 },
      ],
      removals: [
        { reason: "filler", startUs: 3_300_000, endUs: 3_700_000, text: "เอ่อ" },
        { reason: "pause", startUs: 5_000_000, endUs: 5_500_000, text: "" },
      ],
      rows: [
        { state: "used", reason: null, startUs: 1_900_000, endUs: 3_300_000, text: "เอาล่ะครับวันนี้", toggle: { type: "words", indexes: [0, 1, 2], keep: false } },
        { state: "cut", reason: "filler", startUs: 3_300_000, endUs: 3_700_000, text: "เอ่อ", toggle: { type: "words", indexes: [3], keep: true } },
        { state: "used", reason: null, startUs: 3_700_000, endUs: 4_900_000, text: "เราจะมาดู", toggle: { type: "words", indexes: [4, 5], keep: false } },
        { state: "cut", reason: "pause", startUs: 5_000_000, endUs: 5_500_000, text: "", toggle: { type: "pause", after: 5, keep: true } },
        { state: "used", reason: null, startUs: 5_600_000, endUs: 7_000_000, text: "นักบินอวกาศ", toggle: { type: "words", indexes: [6, 7], keep: false } },
      ],
      originalUs: 5_100_000,
      keptUs: 4_500_000,
    }),
    beatCut("b2", "b", 0, 4_000_000, {
      originalUs: 3_000_000,
      rows: [{ state: "used", reason: null, startUs: 0, endUs: 4_000_000, text: "", toggle: { type: "pieces", ranges: [{ startUs: 0, endUs: 4_000_000 }], keep: false } }],
    }),
    beatCut("b3", "a", 26_650_000, 30_250_000, {
      removals: [{ reason: "retake", startUs: 27_000_000, endUs: 28_000_000, text: "ตอนนี้เรา" }],
      rows: [
        { state: "cut", reason: "retake", startUs: 27_000_000, endUs: 28_000_000, text: "ตอนนี้เรา", toggle: { type: "words", indexes: [20, 21], keep: true } },
        { state: "used", reason: null, startUs: 28_100_000, endUs: 30_100_000, text: "ตอนนี้เราอยู่ในอวกาศ", toggle: { type: "words", indexes: [22, 23, 24], keep: false } },
      ],
      originalUs: 3_300_000,
      keptUs: 3_600_000,
    }),
  ]
  const cuts = beats.flatMap((beat) =>
    beat.pieces.map((piece) => ({ binId: beat.videoId, sourceStartUs: piece.startUs, sourceDurationUs: piece.endUs - piece.startUs })),
  )
  return { beats, cuts, durationUs: 12_100_000, ...extra }
}

/** Subtitles of cutPlan(): two lines in the opening, one in the ending. */
export const subtitleLines = (): SubtitleLine[] => [
  { key: "a:1850000:3150000:สวัสดีครับวันนี้", beatId: "b1", startUs: 100_000, endUs: 1_400_000, text: "สวัสดีครับวันนี้" },
  { key: "a:3150000:4750000:จะมารีวิวแอป", beatId: "b1", startUs: 1_400_000, endUs: 3_000_000, text: "จะมารีวิวแอป" },
  { key: "a:27050000:30250000:ขอบคุณที่ดูครับ", beatId: "b3", startUs: 8_600_000, endUs: 12_100_000, text: "ขอบคุณที่ดูครับ" },
]

/** Highlight text of cutPlan(): a group Claude picked in the opening, one the user made in the ending. */
export const highlightGroups = (): HighlightGroupView[] => [
  {
    id: "g1",
    beatId: "b1",
    source: "ai",
    replaced: false,
    placement: "above",
    look: { pattern: "stack", tone: "base", accent: null, exit: null, edited: false },
    startUs: 100_000,
    endUs: 2_100_000,
    lines: [
      { index: 0, text: "เอาล่ะ", startUs: 100_000, partial: false },
      { index: 1, text: "วันนี้", startUs: 900_000, partial: true },
    ],
  },
  {
    id: "g2",
    beatId: "b3",
    source: "user",
    replaced: false,
    placement: "no-picture",
    look: { pattern: "stack", tone: "base", accent: null, exit: null, edited: false },
    startUs: 8_600_000,
    endUs: 10_000_000,
    lines: [{ index: 0, text: "อยู่ในอวกาศ", startUs: 8_600_000, partial: false }],
  },
]

/** The emphasis tab with no point: no sentence or scene to pick from either, unless a test gives them. */
export const emphasisView = (extra: Partial<EmphasisView> = {}): EmphasisView => ({
  points: [],
  sentences: [],
  scenes: [],
  hidden: 0,
  version: 0,
  changed: { techniques: false, graphics: false, sounds: false },
  ...extra,
})

export const highlightPreview = (extra: Partial<HighlightPreview> = {}): HighlightPreview => ({
  style: "bold-white",
  styleByAi: null,
  groups: [],
  hidden: 0,
  outlineChanged: false,
  needsPictures: false,
  maxChars: 12,
  landscape: false,
  cues: [],
  slots: [],
  sounds: [],
  unusedSounds: { unplaced: 0, missing: 0, lost: 0, pro: 0 },
  composed: [],
  ownSounds: [],
  zooms: [],
  moves: [],
  pieces: [],
  zoomsLost: 0,
  inserts: [],
  media: [],
  graphics: [],
  graphicsWaitForPack: false,
  graphicsProblem: null,
  soundsProblem: null,
  emphasis: emphasisView(),
  // every exit, as with CapCut Pro
  exits: EXIT_ANIMATIONS.map(({ id, name }) => ({ id, name })),
  proLeftOut: { exits: 0, sounds: 0 },
  ...extra,
})

export const backupInfo = (id: string, createdAt: string, extra: Partial<BackupInfo> = {}): BackupInfo => ({
  id,
  createdAt,
  durationUs: 0,
  segmentCount: 0,
  ...extra,
})

/** 17 Oct 2026, end of day in Thailand */
export const LICENSE_EXPIRES_AT = Date.parse("2026-10-17T16:59:59Z")

export const activeLicense = (extra: Partial<Extract<LicenseState, { state: "active" }>> = {}): LicenseState => ({
  state: "active",
  license: { customer: "ร้านเล็บสวย", plan: "monthly", expiresAt: LICENSE_EXPIRES_AT, maxDevices: 2, devicesUsed: 1 },
  tokenExpiresAt: Date.parse("2026-09-20T10:00:00Z"),
  offline: false,
  ...extra,
})

export type FakeApi = RendererApi & {
  /** every call as [method, ...args], in order */
  calls: unknown[][]
  /** pushes an event to whoever subscribed through onEvent */
  emit(event: AppEvent): void
}

/**
 * An in-memory RendererApi. Every method is recorded; `overrides` replace behaviour.
 * `capcut.running` is read on every poll, so tests can flip it.
 */
export function fakeApi(overrides: Partial<RendererApi> = {}, capcut = { running: false }): FakeApi {
  const calls: unknown[][] = []
  const listeners = new Set<(event: AppEvent) => void>()
  const base: RendererApi = {
    listProjects: async () => ({ root: "/drafts", projects: [summary("0917"), summary("0815")], stages: {} }),
    inspectProject: async () => detail(),
    readCover: async () => null,
    capcutStatus: async () => ({ running: capcut.running }),
    getSettings: async () => settingsView(),
    updateSettings: async () => {},
    saveApiKey: async () => {},
    deleteApiKey: async () => {},
    downloadModel: async () => {},
    cancelModelDownload: async () => {},
    installGraphicsPack: async () => {},
    cancelGraphicsPack: async () => {},
    removeGraphicsPack: async () => {},
    cleanGraphicFiles: async () => ({ trashed: 0, blockedBy: null, kept: null }),
    startAnalysis: async () => {},
    cancelAnalysis: async () => {},
    analysisState: async () => null,
    analysedVideos: async () => [],
    knownRetakes: async () => ({}),
    videosWithoutObjects: async () => [],
    locateObjects: async () => {},
    retryUnfetchableSounds: async () => {},
    claudeCodeStatus: async () => claudeCodeStatus(),
    installClaudeCode: async () => {},
    loginClaudeCode: async () => {},
    openClaudeCodeLogin: async () => {},
    submitClaudeCodeLoginCode: async () => {},
    cancelClaudeCode: async () => {},
    getOutline: async () => null,
    planOutline: async (_folder, videoIds, brief) => storedOutline({ videoIds, brief }),
    regenerateOutline: async (_folder, brief) => storedOutline({ brief }),
    reviseOutline: async (_folder, _instruction, brief) => storedOutline({ brief }),
    saveOutlineEdits: async (_folder, beatIds, confirmed) => {
      const base = storedOutline()
      const beats = beatIds.map((id) => base.outline.beats.find((b) => b.id === id)!)
      return { ...base, outline: { ...base.outline, beats }, confirmed }
    },
    saveOutlineDirection: async (_folder, direction) => {
      const base = storedOutline()
      return { ...base, outline: { ...base.outline, direction: direction.trim() } }
    },
    cancelPlanning: async () => {},
    beatThumbnail: async () => null,
    previewCut: async () => cutPlan(),
    writeTimeline: async () => ({
      backup: backupInfo("0917-2026-09-17T09-00-00-000Z", "2026-09-17T09:00:00.000Z"),
      durationUs: 12_100_000,
      segmentCount: 5,
      captionCount: 0,
      highlightCount: 0,
      soundCount: 0,
      zoomCount: 0,
      insertCount: 0,
      graphicCount: 0,
      composedCount: 0,
      dropped: { sounds: 0, zooms: 0, inserts: 0, graphics: 0, moves: 0 },
      zoomsLost: 0,
      graphicsSkipped: 0,
      composedLeftOut: { unwritten: 0, stale: 0, failed: 0 },
      emphasisCount: 0,
      proLeftOut: { exits: 0, sounds: 0 },
    }),
    writingTimeline: async () => false,
    previewSubtitles: async () => subtitleLines(),
    setSubtitleText: async () => {},
    setCutDecision: async () => {},
    unusedParts: async () => [],
    addOutlinePart: async () => storedOutline(),
    previewHighlights: async () => highlightPreview(),
    setHighlightStyle: async () => {},
    editHighlightLine: async () => {},
    removeHighlightGroup: async () => {},
    addHighlightGroup: async () => {},
    setFlairLook: async () => {},
    setSoundCue: async () => {},
    setZoom: async () => {},
    setInsert: async () => {},
    setPointPicture: async () => {},
    setGraphic: async () => {},
    retryGraphic: async () => {},
    redoGraphic: async () => ({ running: false, states: {} }),
    editGraphic: async () => ({ running: false, states: {} }),
    undoGraphic: async () => {},
    redoMove: async () => ({ running: false, states: {} }),
    editMove: async () => ({ running: false, states: {} }),
    undoMove: async () => {},
    setMove: async () => {},
    redoSound: async () => ({ running: false, states: {} }),
    editSound: async () => ({ running: false, states: {} }),
    undoSound: async () => {},
    setSound: async () => {},
    planPost: async () => ({ running: false, states: {} }),
    rethinkPost: async () => ({ running: false, states: {} }),
    postPlanState: async () => null,
    planEmphasis: async () => ({ count: 0, dropped: 0 }),
    setEmphasisPoint: async () => {},
    addEmphasisPoint: async () => "p1",
    cancelAi: async () => {},
    listBackups: async () => [],
    restoreBackup: async () => {},
    licenseState: async () => activeLicense(),
    activateLicense: async () => ({ ok: true, state: activeLicense() }),
    refreshLicense: async () => activeLicense(),
    deactivateLicense: async () => ({ ok: true }),
    rescanTools: async () => {},
    updateState: async () => ({ state: "disabled" }),
    installUpdate: async () => {},
    onEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const merged = { ...base, ...overrides }
  const recorded = Object.fromEntries(
    Object.entries(merged).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        if (name !== "capcutStatus" && name !== "onEvent") calls.push([name, ...args])
        return (fn as (...a: unknown[]) => unknown)(...args)
      },
    ]),
  ) as unknown as RendererApi
  return { ...recorded, calls, emit: (event) => listeners.forEach((listener) => listener(event)) }
}
