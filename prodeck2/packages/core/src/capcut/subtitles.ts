import { captionAnimation, captionMaterial, captionSegment, captionTrack } from "./subtitle-templates.ts"
import { newId } from "./templates.ts"
import { frameToUs, usToFrame } from "./time.ts"
import type { DraftInfo, Segment } from "./types.ts"

/** A caption on the output timeline, in µs. */
export interface TimelineCaption {
  startUs: number
  endUs: number
  text: string
}

/**
 * Adds the captions as one caption group on a new text track. Pure. Edges land on frames,
 * captions never overlap or run past the end of the timeline, and blank or sub-frame
 * captions are left out.
 */
export function addSubtitleTrack(info: DraftInfo, captions: TimelineCaption[], groupId: string): DraftInfo {
  const fps = info.fps
  const lastFrame = usToFrame(info.duration, fps)
  const out = structuredClone(info)
  const texts: unknown[] = []
  const animations: unknown[] = []
  const segments: Segment[] = []

  let previousEnd = 0
  for (const caption of [...captions].sort((a, b) => a.startUs - b.startUs)) {
    const text = caption.text.trim()
    const startFrame = Math.max(usToFrame(caption.startUs, fps), previousEnd)
    const endFrame = Math.min(usToFrame(caption.endUs, fps), lastFrame)
    if (!text || endFrame - startFrame < 1) continue
    previousEnd = endFrame

    const materialId = newId()
    const animationId = newId()
    texts.push(captionMaterial({ id: materialId, text, groupId }))
    animations.push(captionAnimation(animationId))
    const start = frameToUs(startFrame, fps)
    segments.push(captionSegment({ id: newId(), materialId, animationId, target: { start, duration: frameToUs(endFrame, fps) - start } }))
  }
  if (segments.length === 0) return out

  const existing = (key: string) => (Array.isArray(out.materials[key]) ? (out.materials[key] as unknown[]) : [])
  out.materials = { ...out.materials, texts: [...existing("texts"), ...texts], material_animations: [...existing("material_animations"), ...animations] }
  out.tracks = [...out.tracks, captionTrack(newId(), segments)]
  return out
}
