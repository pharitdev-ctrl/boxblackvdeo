import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { StoredOutline } from "../shared/api.ts"
import { transcriptFingerprint } from "./footage.ts"

/** Footage the rough cut keeps after the clip's last word when an emphasis point is on it, so what sits on that point has time to show. */
export const END_HOLD_US = 1_500_000

/**
 * Whether the rough cut should hold its end: the outline ends on a speech beat, and a speech point on that beat ends
 * on one of the words said in its last END_HOLD_US, among the words the cut plays. A point whose video's transcript
 * has changed since it was made is left out, as everywhere else. Pure.
 */
export function endsOnPoint(stored: StoredOutline, plan: CutPlan, clips: CutClip[]): boolean {
  const beat = stored.outline.beats.at(-1)
  const piece = plan.beats.at(-1)?.pieces.at(-1)
  if (!beat || beat.kind !== "speech" || !piece || plan.beats.at(-1)!.beatId !== beat.id) return false
  const clip = clips.find((one) => one.id === beat.videoId)
  const words = clip?.transcript?.words ?? []
  const emphasis = stored.emphasis
  if (!clip || !emphasis || emphasis.transcripts[beat.videoId] !== transcriptFingerprint(clip.transcript)) return false

  const plays = (index: number) => {
    const word = words[index]
    return word !== undefined && (word.startUs + word.endUs) / 2 >= piece.startUs && (word.startUs + word.endUs) / 2 <= piece.endUs
  }
  const lastWord = words.findLastIndex((_, index) => plays(index))
  if (lastWord < 0) return false
  const from = words[lastWord]!.endUs - END_HOLD_US
  return emphasis.points.some(({ anchor }) => anchor.kind === "speech" && anchor.beatId === beat.id && anchor.videoId === beat.videoId && plays(anchor.to) && words[anchor.to]!.endUs >= from)
}
