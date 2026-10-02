import type { EmphasisType, Importance } from "../../emphasis/types.ts"
import type { SpeechSlot } from "../../flair/direct.ts"
import type { CueAnchor } from "../../flair/plan.ts"
import type { Scene } from "../../vision/describe.ts"

/** The spoken sentence a point's phrase is in, whose words anchor a graphic and are the words it is written for. */
export interface GraphicSentence extends SpeechSlot {
  /**
   * its words with their source times, which anchor a graphic, and where each plays on the rough cut,
   * which is the time a graphic is handed for it: the cut may take a pause out of the middle of a sentence,
   * so the two clocks drift apart after it
   */
  words: { text: string; startUs: number; timelineUs: number }[]
  /** where it stops playing on the rough cut, like `atUs` */
  timelineEndUs: number
  scene: Pick<Scene, "description" | "kind" | "keepClear"> | null
}

/** A point as Claude is shown it for graphics: what a graphic is asked on. */
export interface GraphicPoint {
  pointId: string
  kind: "speech" | "scene"
  importance: Importance
  type: EmphasisType
  reason: string
  videoId: string
  beatId: string
  /** where it starts and stops on the rough cut */
  atUs: number
  timelineEndUs: number
  /** where a graphic on it starts when Claude names no word it can find: the phrase's first kept word, or the scene's first kept moment (a "speech" anchor) */
  anchor: CueAnchor
  /** the phrase, or the scene's description */
  text: string
  /** a speech point's sentence, whose words anchor the graphic and are those it is written for; null for a scene point */
  sentence: GraphicSentence | null
  /** the scene playing there (a scene point's own) */
  scene: Pick<Scene, "description" | "kind" | "keepClear"> | null
  /**
   * where the point's own highlight text sits, as shares of the frame height: the text of the groups made for
   * it, which a graphic put on it takes the place of, and no other point's; null when it has none
   */
  textBand: { fromY: number; toY: number } | null
}

/** Frames attached per request, capped here: each JPEG costs roughly 130–1,500 tokens, and past a dozen the bill outgrows the help. */
const MAX_FRAMES = 12

/** The frame of the scene at a point is named by its video and the number of the point. */
export const frameKey = (point: { videoId: string }, index: number) => `${point.videoId}:${index + 1}`

/**
 * The frames worth attaching: grouped by path (several points may share a scene), each carrying every
 * point number (from 1) it belongs to. When there are more distinct paths than `MAX_FRAMES`, they are
 * spread evenly across the clip (index `Math.floor(i * n / MAX_FRAMES)` for `i` from 0 to
 * `MAX_FRAMES - 1`) rather than only the first `MAX_FRAMES` in clip order, so Claude sees where the free
 * room is late in a long clip too, not just near its start. Only points Claude may put a graphic on
 * are counted, not one in `taken` (point numbers from 1) that already carries the user's own, so no
 * frame is spent where no graphic can go. The caller uses this to know exactly which frames it is about
 * to send.
 */
export function framesToAttach(points: GraphicPoint[], frames: Record<string, string>, taken: Set<number> = new Set()): { path: string; pointNumbers: number[] }[] {
  const byPath = new Map<string, number[]>()
  points.forEach((point, index) => {
    const path = frames[frameKey(point, index)]
    if (!path || taken.has(index + 1)) return
    const list = byPath.get(path)
    if (list) list.push(index + 1)
    else byPath.set(path, [index + 1])
  })
  const all = [...byPath.entries()].map(([path, pointNumbers]) => ({ path, pointNumbers }))
  if (all.length <= MAX_FRAMES) return all
  return Array.from({ length: MAX_FRAMES }, (_, i) => all[Math.floor((i * all.length) / MAX_FRAMES)]!)
}
