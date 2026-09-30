/**
 * The sound effects a CapCut draft uses. CapCut keeps a sound's name, its `effect_id` and the mp3
 * it downloaded into its own cache on the audio material, so the drafts on a machine are the only
 * record of which sounds that machine has (0815, CapCut 9.4).
 */
export interface SoundEffect {
  effectId: string
  /** as CapCut names it */
  name: string
  durationUs: number
  /** the file in CapCut's music cache, or null to let CapCut fetch it by `effectId` */
  path: string | null
  /** what the sound is for, in Thai, for Claude and the picker; CapCut's own names are often Japanese or Chinese */
  use?: string
  /** CapCut tried to fetch it on this machine and left a placeholder instead of the file */
  unfetchable?: true
}

/** What CapCut writes where a material's file would be when it could not get the file. */
const PLACEHOLDER = /^##_material_placeholder_.*_##$/

interface AudioMaterial {
  type?: unknown
  name?: unknown
  duration?: unknown
  path?: unknown
  effect_id?: unknown
}

const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** The sound effects a draft's materials use, in the order they appear, one entry per effect id. */
export function soundsInDraft(info: unknown, exists: (path: string) => boolean): SoundEffect[] {
  const audios = (info as { materials?: { audios?: unknown } } | null)?.materials?.audios
  if (!Array.isArray(audios)) return []
  const sounds = new Map<string, SoundEffect>()
  for (const entry of audios as AudioMaterial[]) {
    if (entry?.type !== "sound") continue
    const effectId = text(entry.effect_id)
    const name = text(entry.name).trim()
    const durationUs = typeof entry.duration === "number" ? entry.duration : 0
    // the first use of a sound says what it is, unless CapCut could not fetch it there and a later use has its file
    const known = sounds.get(effectId)
    if (!effectId || !name || durationUs <= 0 || (known && !known.unfetchable)) continue
    const path = text(entry.path)
    if (PLACEHOLDER.test(path)) sounds.set(effectId, { effectId, name, durationUs, path: null, unfetchable: true })
    else sounds.set(effectId, { effectId, name, durationUs, path: path && exists(path) ? path : null })
  }
  return [...sounds.values()]
}

/**
 * Merges libraries: the first name, length, file and label win, but a file that is there beats one
 * that is gone and a label beats none, whichever list has it. A sound CapCut could not fetch on this
 * machine is left out, whichever list offers it, unless some draft has its file after all.
 */
export function mergeSounds(lists: SoundEffect[][]): SoundEffect[] {
  const merged = new Map<string, SoundEffect>()
  for (const list of lists) {
    for (const sound of list) {
      const known = merged.get(sound.effectId)
      if (!known) {
        merged.set(sound.effectId, sound)
        continue
      }
      const path = known.path ?? sound.path
      const use = known.use ?? sound.use
      const unfetchable = known.unfetchable ?? sound.unfetchable
      const { unfetchable: _, ...rest } = known
      merged.set(sound.effectId, { ...rest, path, ...(use === undefined ? {} : { use }), ...(unfetchable ? { unfetchable } : {}) })
    }
  }
  for (const [effectId, sound] of merged) {
    if (!sound.unfetchable) continue
    if (sound.path === null) merged.delete(effectId)
    else {
      const { unfetchable: _, ...found } = sound
      merged.set(effectId, found)
    }
  }
  // by what the picker shows, which is also a stable order for Claude
  const shown = (sound: SoundEffect) => sound.use ?? sound.name
  return [...merged.values()].sort((a, b) => shown(a).localeCompare(shown(b)))
}
