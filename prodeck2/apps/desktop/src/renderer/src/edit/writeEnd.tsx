import type { WriteResult } from "../../../shared/api.ts"
import { formatDuration } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Toast } from "../ui/Toast.tsx"

// a toast that asks the user to do something takes longer to read: graphics left out send them to the
// graphics tab to see why, and a write that failed asks them to write again. One with notes after the
// count (what was dropped, zooms lost, Pro items left out) has more to read, so it stays as long
export const ACTION_TOAST_MS = 12_000

/** What the writers left out, by kind, named as the switches name them; the moves are under the zoom switch. */
export const DROPPED_NAMES: Record<keyof WriteResult["dropped"], MessageKey> = { sounds: "flair.sound", zooms: "flair.zoom", inserts: "flair.insert", graphics: "flair.graphic", moves: "flair.zoom" }

/**
 * The kinds told by a line of their own rather than by their name and "less than a frame left": the moves are
 * dropped by the checks (an edge would show, or the face would leave the frame), so that reason would be wrong.
 */
const OWN_LINES: Partial<Record<keyof WriteResult["dropped"], MessageKey>> = { moves: "write.movesDropped" }

/** What was written; graphics are counted when there were any, and so are the ones left out: not written yet, to be written again, or kept out by a failed render. */
export function doneMessage(written: WriteResult): string {
  const said = { pieces: written.segmentCount, duration: formatDuration(written.durationUs), graphics: written.graphicCount, skipped: written.graphicsSkipped }
  if (written.graphicsSkipped > 0) return t(written.graphicCount > 0 ? "write.doneGraphicsSkipped" : "write.doneGraphicsAllSkipped", said)
  return t(written.graphicCount > 0 ? "write.doneGraphics" : "write.done", said)
}

/** What the result says beyond the count, one phrase each: what was dropped by kind, zooms lost, Pro items left out. */
export function doneNotes(written: WriteResult): string[] {
  const notes: string[] = []
  for (const kind of Object.keys(DROPPED_NAMES) as (keyof typeof DROPPED_NAMES)[]) {
    const count = written.dropped[kind]
    if (count === 0) continue
    const own = OWN_LINES[kind]
    notes.push(own ? t(own, { count }) : t("write.resultDropped", { what: t(DROPPED_NAMES[kind]), count }))
  }
  if (written.zoomsLost > 0) notes.push(t("write.zoomsLost", { count: written.zoomsLost }))
  if (written.proLeftOut.exits + written.proLeftOut.sounds > 0) notes.push(t("write.proLeftOut", { exits: written.proLeftOut.exits, sounds: written.proLeftOut.sounds }))
  return notes
}

/** The toast after a write in the room: what was written, then what it left out. */
export function toldMessage(written: WriteResult): string {
  return [doneMessage(written), ...doneNotes(written)].join(" · ")
}

/** A toast that says more than the count, or that graphics were left out, stays longer. */
export function toldIsLong(written: WriteResult): boolean {
  return written.graphicsSkipped > 0 || doneNotes(written).length > 0
}

/** How a write ended. */
export type WriteEnd = { state: "done"; result: WriteResult } | { state: "failed"; error: string }

/**
 * How a write ended, told when no room of its draft is open to show it: the user may be anywhere
 * in the app, so it says which project the write was for.
 */
export function WriteEndToast({ projectName, end, onDone }: { projectName: string; end: WriteEnd; onDone: () => void }) {
  // the same words as the room's own toast, and as long: what the write left out is told wherever the user is
  const message = end.state === "done" ? toldMessage(end.result) : t("write.failed", { message: end.error })
  const long = end.state === "failed" || toldIsLong(end.result)
  return <Toast message={t("write.away", { project: projectName, message })} ms={long ? ACTION_TOAST_MS : undefined} pose={end.state === "done" ? "done" : "oops"} onDone={onDone} />
}
