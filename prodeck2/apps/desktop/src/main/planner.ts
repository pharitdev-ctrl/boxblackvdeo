import { addUnusedPart, planOutline, unusedParts, type Brief, type Outline, type UnusedPart } from "@boxblack/core/planner"
import type { CueAnchor, PieceAnchor } from "@boxblack/core/flair/plan"
import { isComposed, type ComposedSound } from "@boxblack/core/sound/spec"
import type { StoredOutline } from "../shared/api.ts"
import type { TransportFactories } from "./analysis.ts"
import { loadFootage, type FootageDeps } from "./footage.ts"
import { chosenLlm } from "./llm.ts"
import { regroupFlair } from "./highlight-state.ts"
import { withoutPoint } from "./emphasis.ts"
import { POST_VERSION } from "./post-cleanup.ts"
import { ProjectFiles } from "./project-files.ts"
import type { SecretStore } from "./settings.ts"

/**
 * An outline whose beats got new ids: the sounds, zooms, moves, cutaways, graphics, highlight text and emphasis points on them
 * follow, and a composed sound tied to a graphic names the graphic by its moment on the new beat too.
 */
function withBeatsRenamed(stored: StoredOutline, renamed: Map<string, string>): StoredOutline {
  if (renamed.size === 0) return stored
  const onBeat = <T extends { anchor: CueAnchor | PieceAnchor }>(item: T): T => {
    const beatId = "beatId" in item.anchor ? item.anchor.beatId : undefined
    return beatId !== undefined && renamed.has(beatId) ? { ...item, anchor: { ...item.anchor, beatId: renamed.get(beatId)! } } : item
  }
  const tiedOnBeat = (sound: ComposedSound): ComposedSound => (sound.graphic ? { ...sound, graphic: onBeat({ anchor: sound.graphic }).anchor } : sound)
  const was = stored.flair
  const flair = was && {
    ...was,
    ...(was.cues ? { cues: was.cues.map(onBeat) } : {}),
    ...(was.zooms ? { zooms: was.zooms.map(onBeat) } : {}),
    ...(was.moves ? { moves: was.moves.map(onBeat) } : {}),
    ...(was.inserts ? { inserts: was.inserts.map(onBeat) } : {}),
    ...(was.graphics ? { graphics: was.graphics.map(onBeat) } : {}),
    // a stored entry that is no composed sound is left as it is
    ...(was.composed ? { composed: was.composed.map((sound) => (isComposed(sound) ? tiedOnBeat(onBeat(sound)) : sound)) } : {}),
  }
  const highlights = stored.highlights && {
    ...stored.highlights,
    groups: stored.highlights.groups.map((group) => (group.beatId && renamed.has(group.beatId) ? { ...group, beatId: renamed.get(group.beatId)! } : group)),
  }
  const emphasis = stored.emphasis && {
    ...stored.emphasis,
    points: stored.emphasis.points.map((point) => (renamed.has(point.anchor.beatId) ? { ...point, anchor: { ...point.anchor, beatId: renamed.get(point.anchor.beatId)! } } : point)),
  }
  return { ...stored, ...(flair ? { flair } : {}), ...(highlights ? { highlights } : {}), ...(emphasis ? { emphasis } : {}) }
}

/** The latest outline of each project, so the user can leave and come back to it. */
export class OutlineStore extends ProjectFiles<StoredOutline> {}

export interface PlannerDeps extends FootageDeps {
  secrets: SecretStore
  store: OutlineStore
  tools: { claude: string | null }
  transports?: TransportFactories
}

export function createPlannerService(deps: PlannerDeps) {
  let running: AbortController | null = null

  async function run(folder: string, videoIds: string[], brief: Brief, previous?: Outline, instruction?: string): Promise<StoredOutline> {
    if (running) throw new Error("an outline is already being planned")
    const controller = new AbortController()
    running = controller
    try {
      const [claude, clips, prompts] = await Promise.all([chosenLlm(deps, "planning"), loadFootage(deps, folder, videoIds), deps.prompts?.()])
      const { outline, promptVersion } = await planOutline({
        transport: claude.transport,
        model: claude.model,
        clips,
        brief,
        previous,
        instruction,
        prompt: prompts?.planner,
        signal: controller.signal,
      })
      const stored: StoredOutline = {
        folder,
        videoIds,
        brief,
        outline,
        confirmed: false,
        model: claude.model,
        promptVersion,
        updatedAt: Date.now(),
        // made by this version: there is nothing of an earlier one to clean
        postVersion: POST_VERSION,
      }
      await deps.store.put(stored)
      return stored
    } finally {
      running = null
    }
  }

  async function existing(folder: string): Promise<StoredOutline> {
    const stored = await deps.store.get(folder)
    if (!stored) throw new Error("this project has no outline yet")
    return stored
  }

  return {
    get: (folder: string) => deps.store.get(folder),

    plan: (folder: string, videoIds: string[], brief: Brief) => run(folder, videoIds, brief),

    /** A fresh take, on the brief as the user has it now; the stored one when none is given. */
    async regenerate(folder: string, brief?: Brief): Promise<StoredOutline> {
      const stored = await existing(folder)
      return run(folder, stored.videoIds, brief ?? stored.brief, stored.outline)
    },

    async revise(folder: string, instruction: string, brief?: Brief): Promise<StoredOutline> {
      if (!instruction.trim()) throw new Error("the instruction is empty")
      const stored = await existing(folder)
      return run(folder, stored.videoIds, brief ?? stored.brief, stored.outline, instruction)
    },

    /** The user may reorder and remove beats; the planner is the only source of new ones. */
    async saveEdits(folder: string, beatIds: string[], confirmed: boolean): Promise<StoredOutline> {
      await existing(folder)
      return deps.store.update(folder, (stored) => {
        if (!stored) throw new Error("this project has no outline yet")
        const byId = new Map(stored.outline.beats.map((beat) => [beat.id, beat]))
        const beats = beatIds.map((id) => {
          const beat = byId.get(id)
          if (!beat) throw new Error(`unknown beat ${id}`)
          return beat
        })
        // the closing sound belongs to the end of the video, whichever beat ends it now
        const lastWas = stored.outline.beats.at(-1)?.id
        const lastNow = beats.at(-1)?.id
        const closing = <T extends { anchor: CueAnchor | PieceAnchor }>(item: T): T =>
          "kind" in item.anchor && item.anchor.kind === "beat" && item.anchor.edge === "end" && item.anchor.beatId === lastWas && lastNow !== undefined
            ? { ...item, anchor: { ...item.anchor, beatId: lastNow } }
            : item
        // a beat taken out never comes back, and neither can what sat on its edges, joins, pieces or sentences
        const onBeatKept = (anchor: CueAnchor | PieceAnchor) => !("beatId" in anchor) || beatIds.includes(anchor.beatId!)
        const kept = <T extends { anchor: CueAnchor | PieceAnchor }>(items: T[]) => items.map(closing).filter((item) => onBeatKept(item.anchor))
        const was = stored.flair
        const flair = was && {
          ...was,
          ...(was.cues ? { cues: kept(was.cues) } : {}),
          ...(was.zooms ? { zooms: kept(was.zooms) } : {}),
          ...(was.moves ? { moves: kept(was.moves) } : {}),
          ...(was.inserts ? { inserts: kept(was.inserts) } : {}),
          ...(was.graphics ? { graphics: kept(was.graphics) } : {}),
          // a composed sound tied to a graphic on a sentence of a beat taken out goes with that graphic
          // (a stored entry that is no composed sound is left as it is)
          ...(was.composed ? { composed: was.composed.filter((sound) => !isComposed(sound) || (onBeatKept(sound.anchor) && (sound.graphic === undefined || onBeatKept(sound.graphic)))) } : {}),
        }
        const next: StoredOutline = { ...stored, outline: { ...stored.outline, beats }, confirmed, updatedAt: Date.now(), ...(flair ? { flair } : {}) }
        // highlight text picked in a beat taken out goes too, with its look and sounds
        const groups = stored.highlights?.groups ?? []
        const left = groups.filter((group) => group.beatId === undefined || beatIds.includes(group.beatId))
        const regrouped = left.length === groups.length ? next : regroupFlair({ ...next, highlights: { ...stored.highlights!, groups: left } }, groups, () => false)
        // and so does an emphasis point, with what Claude put on it; what the user edited on it stays, bound to no point
        const gone = (stored.emphasis?.points ?? []).filter((point) => !beatIds.includes(point.anchor.beatId))
        return gone.reduce((outline, point) => withoutPoint(outline, point.id), regrouped)
      })
    },

    async unused(folder: string): Promise<UnusedPart[]> {
      const stored = await existing(folder)
      return unusedParts(await loadFootage(deps, folder, stored.videoIds), stored.outline)
    },

    /** Puts a part the planner left out back in; the outline has to be confirmed again. */
    async addPart(folder: string, partId: string): Promise<StoredOutline> {
      const stored = await existing(folder)
      const clips = await loadFootage(deps, folder, stored.videoIds)
      // added to the outline as it is by then, so a change saved meanwhile is not written over
      return deps.store.update(folder, (latest) => {
        if (!latest) throw new Error("this project has no outline yet")
        const outline = addUnusedPart(latest.outline, clips, partId)
        // a part that grows a beat gives it a new id: what sat on the beat follows it
        const renamed = new Map(
          outline.beats.length === latest.outline.beats.length ? latest.outline.beats.flatMap((beat, i) => (beat.id !== outline.beats[i]!.id ? [[beat.id, outline.beats[i]!.id]] : [])) : [],
        )
        return { ...withBeatsRenamed(latest, renamed), outline, confirmed: false, updatedAt: Date.now() }
      })
    },

    cancel(): void {
      running?.abort()
    },
  }
}

export type PlannerService = ReturnType<typeof createPlannerService>
