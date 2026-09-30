import type { FootageClip } from "./footage.ts"
import { buildBeat, partRange, type Beat, type Outline } from "./outline.ts"

/** A sentence or a picture of a clip that no beat of the outline uses. */
export interface UnusedPart {
  /** `<video id>:u<index>` or `<video id>:s<index>` */
  id: string
  videoId: string
  videoName: string
  kind: Beat["kind"]
  index: number
  startUs: number
  endUs: number
  text: string
  /** set when the sentence is one take of a line said twice that was compared */
  retake: { take: "A" | "B"; better: "A" | "B" | "same" } | null
}

const NAME_LENGTH = 24
const overlaps = (a: { startUs: number; endUs: number }, b: { startUs: number; endUs: number }) => a.startUs < b.endUs && b.startUs < a.endUs
const middle = (item: { startUs: number; endUs: number }) => (item.startUs + item.endUs) / 2

function shortName(text: string): string {
  const letters = [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(text)].map((part) => part.segment)
  return letters.length > NAME_LENGTH ? `${letters.slice(0, NAME_LENGTH).join("")}…` : text
}

/**
 * What the planner left out: every sentence no beat covers, and pictures no beat shows where
 * nobody speaks (a talking clip's own scenes come back through its sentences). Pure.
 */
export function unusedParts(clips: FootageClip[], outline: Outline): UnusedPart[] {
  return clips.flatMap((clip) => {
    const beats = outline.beats.filter((beat) => beat.videoId === clip.id)
    const utterances = clip.transcript?.utterances ?? []
    const scenes = clip.insight?.scenes ?? []
    const parts: UnusedPart[] = []

    utterances.forEach((utterance, index) => {
      const used = beats.some((beat) =>
        beat.kind === "speech" ? index >= beat.fromIndex && index <= beat.toIndex : middle(utterance) >= beat.startUs && middle(utterance) <= beat.endUs,
      )
      if (used) return
      const review = clip.insight?.retakes.find((retake) => retake.takes.some((take) => overlaps(take, utterance)))
      const take = review ? (overlaps(review.takes[0], utterance) ? "A" : "B") : null
      parts.push({
        id: `${clip.id}:u${index}`,
        videoId: clip.id,
        videoName: clip.name,
        kind: "speech",
        index,
        startUs: utterance.startUs,
        endUs: utterance.endUs,
        text: utterance.text,
        retake: review && take ? { take, better: review.better } : null,
      })
    })

    scenes.forEach((scene, index) => {
      const range = partRange(clip, "scenes", index, index)
      if (beats.some((beat) => overlaps(beat, range)) || utterances.some((utterance) => overlaps(utterance, range))) return
      parts.push({ id: `${clip.id}:s${index}`, videoId: clip.id, videoName: clip.name, kind: "scenes", index, ...range, text: scene.description, retake: null })
    })

    return parts.sort((a, b) => a.startUs - b.startUs)
  })
}

/**
 * Puts an unused part back. Next to a beat over the same clip and kind it extends that beat, so
 * the cut still sees retakes inside one beat; otherwise it becomes a beat of its own placed after
 * the latest earlier beat of its clip, else before the earliest later one, else at the end. Pure.
 */
export function addUnusedPart(outline: Outline, clips: FootageClip[], partId: string): Outline {
  const part = unusedParts(clips, outline).find((candidate) => candidate.id === partId)
  const clip = clips.find((candidate) => candidate.id === part?.videoId)
  if (!part || !clip) throw new Error(`${partId} is not an unused part of this outline`)

  const sameKind = (beat: Beat) => beat.videoId === part.videoId && beat.kind === part.kind
  const before = outline.beats.findIndex((beat) => sameKind(beat) && beat.toIndex === part.index - 1)
  const after = before === -1 ? outline.beats.findIndex((beat) => sameKind(beat) && beat.fromIndex === part.index + 1) : -1
  const extended = before !== -1 ? before : after
  if (extended !== -1) {
    const beat = outline.beats[extended]!
    const grown = buildBeat(clip, beat.kind, Math.min(beat.fromIndex, part.index), Math.max(beat.toIndex, part.index), {
      tag: beat.id.split(":").at(-1)!,
      name: beat.name,
      purpose: beat.purpose,
    })
    return { ...outline, beats: outline.beats.map((other, n) => (n === extended ? grown : other)) }
  }

  const added = buildBeat(clip, part.kind, part.index, part.index, { tag: "added", name: shortName(part.text), purpose: "ใส่กลับโดยผู้ใช้" })
  const ofClip = outline.beats.map((beat, position) => ({ beat, position })).filter(({ beat }) => beat.videoId === part.videoId)
  const earlier = ofClip.filter(({ beat }) => beat.startUs < part.startUs).sort((a, b) => b.beat.startUs - a.beat.startUs)[0]
  const later = ofClip.filter(({ beat }) => beat.startUs > part.startUs).sort((a, b) => a.beat.startUs - b.beat.startUs)[0]
  const at = earlier ? earlier.position + 1 : later ? later.position : outline.beats.length
  return { ...outline, beats: [...outline.beats.slice(0, at), added, ...outline.beats.slice(at)] }
}
