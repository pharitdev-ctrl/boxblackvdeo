import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { writeFileAtomic } from "@boxblack/core/atomic-write"
import { BUILT_IN_SOUNDS } from "@boxblack/core/flair/sound-catalogue"
import { mergeSounds, soundsInDraft, type SoundEffect } from "@boxblack/core/flair/sounds"

export interface SoundLibraryDeps {
  /** every CapCut project on this machine */
  projects: () => Promise<{ folder: string }[]>
  /** how old the draft is, without reading it; injected so tests need no files */
  stampOf?: (folder: string) => Promise<string>
  /** when the draft was last written, in ms */
  modifiedAt?: (folder: string) => Promise<number>
  now?: () => number
  readDraft?: (folder: string) => Promise<unknown>
  exists?: (path: string) => boolean
  /** sounds every machine has, fetched by CapCut from their id; CapCut's free ones unless a test says otherwise */
  builtIn?: readonly SoundEffect[]
  /**
   * the ids CapCut once could not fetch on this machine, kept so a sound stays out after the draft
   * that showed it is written again without it, and when the user last had them tried again
   */
  unfetchable?: { load(): Promise<Unfetchable>; save(state: Unfetchable): Promise<void> }
}

/** The sounds CapCut could not fetch, and when (ms) the user last had them tried again: drafts written before that do not count. */
export interface Unfetchable {
  ids: string[]
  clearedAt: number
}

const NONE: Unfetchable = { ids: [], clearedAt: 0 }

const draftFile = (folder: string) => join(folder, "draft_info.json")

/**
 * The sound effects the rough cut can use: CapCut's free built-in ones, which CapCut fetches by id,
 * plus every sound this machine's drafts use. Every draft is read for the sounds it uses, because
 * CapCut keeps a sound's name and id only on the material that uses it. A draft is read again only
 * when its `draft_info.json` changed, and nothing is read until the library is asked for — the
 * user's own drafts can be megabytes each.
 */
export function createSoundLibrary(deps: SoundLibraryDeps) {
  const cache = new Map<string, { stamp: string; sounds: SoundEffect[] }>()
  const stampOf =
    deps.stampOf ??
    (async (folder: string) => {
      const { mtimeMs, size } = await stat(draftFile(folder))
      return `${mtimeMs}:${size}`
    })
  const readDraft = deps.readDraft ?? (async (folder: string) => JSON.parse(await readFile(draftFile(folder), "utf8")) as unknown)
  const exists = deps.exists ?? existsSync
  const modifiedAt = deps.modifiedAt ?? (async (folder: string) => (await stat(draftFile(folder))).mtimeMs)
  const now = deps.now ?? Date.now
  const load = async () => (deps.unfetchable ? await deps.unfetchable.load().catch(() => NONE) : NONE)

  return {
    async list(): Promise<SoundEffect[]> {
      const projects = await deps.projects()
      const before = await load()
      const lists: SoundEffect[][] = []
      const seen: string[] = []
      for (const project of projects) {
        try {
          const stamp = await stampOf(project.folder)
          const known = cache.get(project.folder)
          const sounds = known?.stamp === stamp ? known.sounds : soundsInDraft(await readDraft(project.folder), exists)
          cache.set(project.folder, { stamp, sounds })
          lists.push(sounds)
          // a draft written before the user had the sounds tried again says nothing about them now
          if (sounds.some((sound) => sound.unfetchable) && (before.clearedAt === 0 || (await modifiedAt(project.folder)) > before.clearedAt)) {
            seen.push(...sounds.filter((sound) => sound.unfetchable).map((sound) => sound.effectId))
          }
        } catch {
          // a draft that cannot be read has nothing to give; the others still count
        }
      }
      // what CapCut could not fetch before, or now; a draft that has the file after all clears it
      const hadFile = new Set(lists.flat().filter((sound) => sound.path !== null).map((sound) => sound.effectId))
      const failed = [...new Set([...before.ids, ...seen])].filter((id) => !hadFile.has(id)).sort()
      // the user may have had the sounds tried again while the drafts were read: that stands
      if (deps.unfetchable && failed.join() !== [...before.ids].sort().join() && (await load()).clearedAt === before.clearedAt) {
        await deps.unfetchable.save({ ids: failed, clearedAt: before.clearedAt }).catch(() => {})
      }
      const remembered: SoundEffect[] = failed.map((effectId) => ({ effectId, name: effectId, durationUs: 1, path: null, unfetchable: true }))
      // drafts first: a sound CapCut already fetched has its real length and file there;
      // a draft's placeholder for a sound tried again is its own concern, not a verdict on the sound
      const fresh = lists.map((sounds) => sounds.map(({ unfetchable, ...sound }) => (unfetchable && failed.includes(sound.effectId) ? { ...sound, unfetchable } : sound)))
      return mergeSounds([...fresh, [...(deps.builtIn ?? BUILT_IN_SOUNDS)], remembered])
    },

    /** How many sounds are kept out because CapCut could not fetch them. */
    async failedCount(): Promise<number> {
      return (await load()).ids.length
    },

    /** Offers the sounds CapCut could not fetch again — it may have been offline — and holds no draft written before now against them. */
    async retry(): Promise<void> {
      await deps.unfetchable?.save({ ids: [], clearedAt: now() })
    },
  }
}

export type SoundLibrary = ReturnType<typeof createSoundLibrary>

/** The sound ids CapCut could not fetch, kept in a small file of their own. */
export function unfetchableFile(file: string): NonNullable<SoundLibraryDeps["unfetchable"]> {
  const idsIn = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [])
  return {
    async load() {
      try {
        const raw = JSON.parse(await readFile(file, "utf8")) as unknown
        // 0.1.9–0.1.13 kept a plain list of ids
        if (Array.isArray(raw)) return { ids: idsIn(raw), clearedAt: 0 }
        const state = raw as Partial<Record<keyof Unfetchable, unknown>> | null
        return { ids: idsIn(state?.ids), clearedAt: typeof state?.clearedAt === "number" ? state.clearedAt : 0 }
      } catch {
        return NONE
      }
    },
    save: (state) => writeFileAtomic(file, JSON.stringify(state)),
  }
}
