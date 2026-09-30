import { readFile } from "node:fs/promises"
import { writeFileAtomic } from "@boxblack/core/atomic-write"
import type { AsrEngineId, SpokenLanguage } from "@boxblack/core/asr"
import { APPEARANCES, type Appearance } from "../shared/api.ts"
import { CUT_PRESET_IDS, DEFAULT_CUT_RULES, type CutRules } from "@boxblack/core/cut/rules"
import { CLAUDE_MODELS, EFFORTS, type ClaudeModelId, type Effort, type LlmTransportId } from "@boxblack/core/llm"
import { DEFAULT_FLAIR_OPTIONS, FLAIR_LEVELS, type FlairOptions } from "@boxblack/core/flair/catalogue"
import { DEFAULT_HIGHLIGHT_OPTIONS, HIGHLIGHT_POSITIONS, type HighlightOptions, type Palette, type Rgb } from "@boxblack/core/highlights/styles"
import { DEFAULT_SUBTITLE_OPTIONS, SUBTITLE_LENGTHS, type SubtitleOptions } from "@boxblack/core/subtitles/captions"
import { DEFAULT_FRAME_EVERY_S, FRAME_EVERY_S, type FrameEveryS } from "@boxblack/core/vision/estimate"

export interface AppSettings {
  asr: { engine: AsrEngineId; language: SpokenLanguage }
  llm: { transport: LlmTransportId; model: ClaudeModelId; effort: Effort }
  cut: CutRules
  subtitles: SubtitleOptions
  highlights: HighlightOptions
  flair: FlairOptions
  /** how often Claude looks at the pictures while a video is analysed */
  vision: { frameEveryS: FrameEveryS }
  appearance: Appearance
  /** what the user's CapCut account has: without Pro the app puts nothing in a draft that needs it (spec 0.4.2) */
  capcut: { pro: boolean }
}

export type SettingsPatch = {
  asr?: Partial<AppSettings["asr"]>
  llm?: Partial<AppSettings["llm"]>
  cut?: Partial<CutRules>
  subtitles?: Partial<SubtitleOptions>
  highlights?: Partial<HighlightOptions>
  flair?: Partial<FlairOptions>
  vision?: Partial<AppSettings["vision"]>
  appearance?: Appearance
  capcut?: Partial<AppSettings["capcut"]>
}

export const DEFAULT_SETTINGS: AppSettings = {
  asr: { engine: "whisper-local", language: "th" },
  llm: { transport: "anthropic-api", model: "claude-opus-5", effort: "medium" },
  cut: DEFAULT_CUT_RULES,
  subtitles: DEFAULT_SUBTITLE_OPTIONS,
  highlights: DEFAULT_HIGHLIGHT_OPTIONS,
  flair: DEFAULT_FLAIR_OPTIONS,
  vision: { frameEveryS: DEFAULT_FRAME_EVERY_S },
  appearance: "system",
  capcut: { pro: false },
}

const ENGINES: AsrEngineId[] = ["whisper-local", "scribe"]
const LANGUAGES: SpokenLanguage[] = ["th", "en", "auto"]
const TRANSPORTS: LlmTransportId[] = ["anthropic-api", "claude-cli"]
const MODELS: ClaudeModelId[] = CLAUDE_MODELS.map((model) => model.id)

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback)

const channel = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
const rgb = (value: unknown): value is Rgb => Array.isArray(value) && value.length === 3 && value.every(channel)
/** The user's own four colours, whole or not at all: a channel out of 0–1 or a colour missing means the fallback. */
const palette = (value: unknown, fallback: Palette): Palette => {
  const raw = value as Partial<Record<keyof Palette, unknown>> | null | undefined
  if (!raw || typeof raw !== "object") return fallback
  return rgb(raw.text) && rgb(raw.accent) && rgb(raw.alt) && rgb(raw.bar) ? { text: raw.text, accent: raw.accent, alt: raw.alt, bar: raw.bar } : fallback
}

const writeJsonAtomic = (file: string, value: unknown) => writeFileAtomic(file, JSON.stringify(value, null, 2))

const changing = new Map<string, Promise<unknown>>()

/** Read-change-write steps on one file run one at a time, so changes made together do not undo each other. */
function oneAtATime<T>(file: string, change: () => Promise<T>): Promise<T> {
  const run = (changing.get(file) ?? Promise.resolve()).then(change)
  changing.set(file, run.catch(() => {}))
  return run
}

async function readJsonOr<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

export class SettingsStore {
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  /** Anything missing or unrecognised in the file is replaced by its default. */
  async read(): Promise<AppSettings> {
    const raw = await readJsonOr<SettingsPatch>(this.file, {})
    return {
      asr: {
        engine: pick(raw.asr?.engine, ENGINES, DEFAULT_SETTINGS.asr.engine),
        language: pick(raw.asr?.language, LANGUAGES, DEFAULT_SETTINGS.asr.language),
      },
      llm: {
        transport: pick(raw.llm?.transport, TRANSPORTS, DEFAULT_SETTINGS.llm.transport),
        model: pick(raw.llm?.model, MODELS, DEFAULT_SETTINGS.llm.model),
        effort: pick(raw.llm?.effort, EFFORTS, DEFAULT_SETTINGS.llm.effort),
      },
      cut: {
        preset: pick(raw.cut?.preset, CUT_PRESET_IDS, DEFAULT_SETTINGS.cut.preset),
        cutFillers: flag(raw.cut?.cutFillers, DEFAULT_SETTINGS.cut.cutFillers),
        cutRetakes: flag(raw.cut?.cutRetakes, DEFAULT_SETTINGS.cut.cutRetakes),
        cutBadPicture: flag(raw.cut?.cutBadPicture, DEFAULT_SETTINGS.cut.cutBadPicture),
      },
      subtitles: {
        enabled: flag(raw.subtitles?.enabled, DEFAULT_SETTINGS.subtitles.enabled),
        length: pick(raw.subtitles?.length, SUBTITLE_LENGTHS, DEFAULT_SETTINGS.subtitles.length),
        polish: flag(raw.subtitles?.polish, DEFAULT_SETTINGS.subtitles.polish),
      },
      highlights: {
        enabled: flag(raw.highlights?.enabled, DEFAULT_SETTINGS.highlights.enabled),
        position: pick(raw.highlights?.position, HIGHLIGHT_POSITIONS, DEFAULT_SETTINGS.highlights.position),
        hideSubtitles: flag(raw.highlights?.hideSubtitles, DEFAULT_SETTINGS.highlights.hideSubtitles),
        custom: palette(raw.highlights?.custom, DEFAULT_SETTINGS.highlights.custom),
      },
      flair: {
        enabled: flag(raw.flair?.enabled, DEFAULT_SETTINGS.flair.enabled),
        level: pick(raw.flair?.level, FLAIR_LEVELS, DEFAULT_SETTINGS.flair.level),
        text: flag(raw.flair?.text, DEFAULT_SETTINGS.flair.text),
        sound: flag(raw.flair?.sound, DEFAULT_SETTINGS.flair.sound),
        zoom: flag(raw.flair?.zoom, DEFAULT_SETTINGS.flair.zoom),
        insert: flag(raw.flair?.insert, DEFAULT_SETTINGS.flair.insert),
        graphic: flag(raw.flair?.graphic, DEFAULT_SETTINGS.flair.graphic),
      },
      vision: { frameEveryS: pick(raw.vision?.frameEveryS, FRAME_EVERY_S, DEFAULT_SETTINGS.vision.frameEveryS) },
      appearance: pick(raw.appearance, APPEARANCES, DEFAULT_SETTINGS.appearance),
      capcut: { pro: flag(raw.capcut?.pro, DEFAULT_SETTINGS.capcut.pro) },
    }
  }

  update(patch: SettingsPatch): Promise<AppSettings> {
    return oneAtATime(this.file, async () => {
      const current = await this.read()
      const next = {
        asr: { ...current.asr, ...patch.asr },
        llm: { ...current.llm, ...patch.llm },
        cut: { ...current.cut, ...patch.cut },
        subtitles: { ...current.subtitles, ...patch.subtitles },
        highlights: { ...current.highlights, ...patch.highlights },
        flair: { ...current.flair, ...patch.flair },
        vision: { ...current.vision, ...patch.vision },
        appearance: patch.appearance ?? current.appearance,
        capcut: { ...current.capcut, ...patch.capcut },
      }
      await writeJsonAtomic(this.file, next)
      return this.read()
    })
  }
}

/** The subset of Electron's safeStorage this app uses — injected so tests need no Electron. */
export interface SecretBox {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

export type SecretName = "elevenlabs" | "anthropic"

/** API keys, encrypted with the OS keychain; the file only ever holds ciphertext. */
export class SecretStore {
  private readonly file: string
  private readonly box: SecretBox

  constructor(file: string, box: SecretBox) {
    this.file = file
    this.box = box
  }

  private all(): Promise<Partial<Record<SecretName, string>>> {
    return readJsonOr(this.file, {})
  }

  /**
   * The key, or null when there is none — or none this app can read: the keychain refused, or it
   * was saved under another app's keychain entry. Asking for it again is the way out of both.
   */
  async get(name: SecretName): Promise<string | null> {
    const cipher = (await this.all())[name]
    if (!cipher) return null
    try {
      return this.box.decryptString(Buffer.from(cipher, "base64"))
    } catch {
      return null
    }
  }

  async set(name: SecretName, value: string): Promise<void> {
    if (!this.box.isEncryptionAvailable()) throw new Error("this system cannot encrypt secrets, so the key was not saved")
    return oneAtATime(this.file, async () => {
      const all = await this.all()
      all[name] = this.box.encryptString(value).toString("base64")
      await writeJsonAtomic(this.file, all)
    })
  }

  delete(name: SecretName): Promise<void> {
    return oneAtATime(this.file, async () => {
      const all = await this.all()
      delete all[name]
      await writeJsonAtomic(this.file, all)
    })
  }

  /** Last four characters, so the UI can show which key is saved without holding it. */
  async hint(name: SecretName): Promise<string | null> {
    return (await this.get(name))?.slice(-4) ?? null
  }
}
