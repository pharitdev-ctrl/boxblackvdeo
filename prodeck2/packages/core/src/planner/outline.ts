import { z } from "zod"
import type { FootageClip, FootageIndex } from "./footage.ts"

export const OutlineReplySchema = z.object({
  title: z.string(),
  summary: z.string(),
  beats: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
      /** clip reference, e.g. "v1" */
      clip: z.string(),
      /** first and last utterance ("u3") or scene ("s2") of the clip to use */
      from: z.string(),
      to: z.string(),
    }),
  ),
  /** what the planner left out and why */
  omitted: z.string(),
})

export type OutlineReply = z.infer<typeof OutlineReplySchema>

export interface Beat {
  id: string
  name: string
  purpose: string
  videoId: string
  videoName: string
  kind: "speech" | "scenes"
  /** zero-based, inclusive range of utterances or scenes in the clip */
  fromIndex: number
  toIndex: number
  /** position in the source file */
  startUs: number
  endUs: number
  /** what is said during the beat */
  speech: string
  /** what is seen during the beat */
  visual: string
}

export type OutlineWarning = { beat: number; problem: "unknown-clip" | "unknown-part" | "mixed-parts" }

export interface Outline {
  title: string
  summary: string
  omitted: string
  beats: Beat[]
  /** beats the planner referenced that could not be used, numbered as the planner gave them */
  warnings: OutlineWarning[]
}

/** A scene seen in a single sampled frame still stands for the stretch until the next sample. */
const SINGLE_FRAME_SCENE_US = 3_000_000

const PART = /^([us])(\d+)$/

const overlaps = (item: { startUs: number; endUs: number }, startUs: number, endUs: number) =>
  item.startUs < endUs && item.endUs > startUs

/** Where a stretch of utterances or scenes of a clip sits in the source. */
export function partRange(clip: FootageClip, kind: Beat["kind"], fromIndex: number, toIndex: number): { startUs: number; endUs: number } {
  const parts = kind === "speech" ? (clip.transcript?.utterances ?? []) : (clip.insight?.scenes ?? [])
  const startUs = parts[fromIndex]!.startUs
  let endUs = parts[toIndex]!.endUs
  if (endUs <= startUs) endUs = Math.min(clip.durationUs, startUs + SINGLE_FRAME_SCENE_US)
  return { startUs, endUs }
}

/** A beat over utterances or scenes `fromIndex`..`toIndex` of a clip; `tag` keeps ids of beats over the same parts apart. */
export function buildBeat(clip: FootageClip, kind: Beat["kind"], fromIndex: number, toIndex: number, about: { tag: string; name: string; purpose: string }): Beat {
  const { startUs, endUs } = partRange(clip, kind, fromIndex, toIndex)
  return {
    id: `${clip.id}:${kind}:${fromIndex}-${toIndex}:${about.tag}`,
    name: about.name,
    purpose: about.purpose,
    videoId: clip.id,
    videoName: clip.name,
    kind,
    fromIndex,
    toIndex,
    startUs,
    endUs,
    speech: (clip.transcript?.utterances ?? []).filter((u) => overlaps(u, startUs, endUs)).map((u) => u.text).join(" "),
    visual: (clip.insight?.scenes ?? []).filter((s) => overlaps(s, startUs, endUs)).map((s) => s.description).join(" / "),
  }
}

export function resolveOutline(reply: OutlineReply, index: FootageIndex): Outline {
  const beats: Beat[] = []
  const warnings: OutlineWarning[] = []

  reply.beats.forEach((planned, n) => {
    const number = n + 1
    const clip = index.clip(planned.clip)
    if (!clip) return warnings.push({ beat: number, problem: "unknown-clip" })

    const from = PART.exec(planned.from)
    const to = PART.exec(planned.to)
    if (from && to && from[1] !== to[1]) return warnings.push({ beat: number, problem: "mixed-parts" })

    const kind = from?.[1] === "u" ? "speech" : "scenes"
    const utterances = clip.transcript?.utterances ?? []
    const scenes = clip.insight?.scenes ?? []
    const parts = kind === "speech" ? utterances : scenes
    const a = from ? Number(from[2]) - 1 : -1
    const b = to ? Number(to[2]) - 1 : -1
    const fromIndex = Math.min(a, b)
    const toIndex = Math.max(a, b)
    if (fromIndex < 0 || toIndex >= parts.length) return warnings.push({ beat: number, problem: "unknown-part" })

    beats.push(buildBeat(clip, kind, fromIndex, toIndex, { tag: String(n), name: planned.name, purpose: planned.purpose }))
  })

  return { title: reply.title, summary: reply.summary, omitted: reply.omitted, beats, warnings }
}

export function outlineDurationUs(outline: Outline): number {
  return outline.beats.reduce((sum, beat) => sum + (beat.endUs - beat.startUs), 0)
}

/** The outline in the planner's own reference notation, for asking it to revise. */
export function outlineAsText(outline: Outline, index: FootageIndex): string {
  return outline.beats
    .map((beat, n) => {
      const letter = beat.kind === "speech" ? "u" : "s"
      const clip = index.refOf(beat.videoId) ?? beat.videoId
      return `${n + 1}. ${clip} ${letter}${beat.fromIndex + 1}–${letter}${beat.toIndex + 1} · ${beat.name} — ${beat.purpose}`
    })
    .join("\n")
}
