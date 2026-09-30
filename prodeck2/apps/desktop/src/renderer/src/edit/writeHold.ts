import type { MessageKey } from "../i18n.ts"
import type { ClipRoomValue, RoomRead } from "../room/ClipRoom.tsx"

/** What the hold reads of the room. */
export type HoldInput = Pick<
  ClipRoomValue,
  "capcutRunning" | "writeKnown" | "failed" | "rules" | "highlights" | "flair" | "plan" | "empty" | "run" | "placing" | "deciding" | "editing" | "preview" | "subtitlesOn" | "lines"
>

/** The words of each read the room can fail at: the reason the write is held for it, and the notice that offers to read it again. */
export const FAILED_READ_WORDS: Record<RoomRead, MessageKey> = {
  settings: "write.check.settingsFailed",
  cut: "write.check.cutFailed",
  preview: "write.check.previewFailed",
  lines: "write.check.linesFailed",
}

/**
 * Why the write cannot start now: the first hold in the order spec §14 "0.4.4" lists, as the key of its
 * words, or null when it can. A write already running is not a hold here: the button says it is writing.
 */
export function writeHold(room: HoldInput): MessageKey | null {
  if (room.capcutRunning === true) return "write.check.capcutOpen"
  if (room.capcutRunning === null) return "write.check.capcutUnknown"
  if (!room.writeKnown) return "write.check.writeKnown"
  if (room.failed.settings) return FAILED_READ_WORDS.settings
  if (room.failed.cut) return FAILED_READ_WORDS.cut
  if (room.plan === null) return "write.check.cutting"
  if (room.empty) return "write.check.cutEmpty"
  if (room.run.running) return "write.check.planning"
  if (room.failed.preview) return FAILED_READ_WORDS.preview
  if (room.failed.lines) return FAILED_READ_WORDS.lines
  const subtitlesReady = !room.subtitlesOn || room.lines !== null
  // a change being saved (a cut decision, a change to the text or the points) places everything again once it lands
  const changing = room.deciding || room.editing
  if (room.placing || changing || room.preview === null || !subtitlesReady || room.rules === null || room.highlights === null || room.flair === null) return "write.check.placing"
  return null
}
