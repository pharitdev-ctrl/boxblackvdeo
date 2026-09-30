import { useId, useState, type ReactElement } from "react"
import type { FlairLevel } from "../../../shared/api.ts"
import { formatDuration } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { useClipRoom, type ClipRoomValue, type RoomRead } from "../room/ClipRoom.tsx"
import { Button } from "../ui/Button.tsx"
import { Sheet } from "../ui/Sheet.tsx"
import { FAILED_READ_WORDS, writeHold } from "./writeHold.ts"

const LEVEL_NAMES: Record<FlairLevel, MessageKey> = { light: "flair.level.light", medium: "flair.level.medium", heavy: "flair.level.heavy" }

/** The id of the reason beside the write button, which the button is described by. One post page is open at a time, so one id does. */
export const WRITE_REASON_ID = "write-reason"

/** The words of why the write cannot start now, or none when it can. A write that runs is not a hold: the button says it is writing. */
const whyHeld = (room: ClipRoomValue): MessageKey | null => (room.writing ? null : writeHold(room))

/**
 * Why the write button is off, in a line beside it. It is drawn before the AI menu, at the left of what the
 * page puts on the bar, so that it comes and goes without moving the buttons after it.
 */
export function WriteReason(): ReactElement | null {
  const room = useClipRoom()
  const why = whyHeld(room)
  if (!why) return null
  return (
    <span id={WRITE_REASON_ID} className="write-reason warn-text" title={t(why)}>
      {t(why)}
    </span>
  )
}

/** The post page's write button, and the sheet that asks before writing. */
export function WriteButton(): ReactElement {
  const room = useClipRoom()
  const { api, folder, project, stored, plan, preview, texts, rules, subtitles, highlights, flair, writing, write: state } = room
  const { highlightsOn, subtitlesOn, graphicsOn } = room
  const [asking, setAsking] = useState(false)
  const why = whyHeld(room)
  const canWrite = why === null && !writing
  const sheetReasonId = useId()

  // a graphic switched off is not written, and one whose render failed is left out of the write
  const switchedOn = graphicsOn ? (preview?.graphics.filter((graphic) => !graphic.off) ?? []) : []
  // so is a motion graphic Claude has not written yet, and one the cut changed under, which waits for Claude to write it again: neither has a render to count or wait for
  const playing = switchedOn.filter((graphic) => graphic.written && !graphic.stale)
  const leftOut = switchedOn.length - playing.length
  const rendered = playing.filter((graphic) => graphic.render === "ready").length
  const failedRenders = playing.filter((graphic) => graphic.render === "failed").length
  // a failed render is finished too: the write leaves it out rather than wait for it
  const finished = rendered + failedRenders
  // the highlight text a write draws: a group a graphic takes the place of is listed, and not written
  const drawnGroups = preview?.groups.filter((group) => !group.replaced) ?? []
  const shownPoints = preview?.emphasis.points.filter((point) => point.shown).length ?? 0
  const levelName = flair ? t(LEVEL_NAMES[flair.level]) : ""
  const off = (what: MessageKey) => t("write.off", { what: t(what) })
  const targetUs = stored.brief.targetSeconds === null ? null : stored.brief.targetSeconds * 1_000_000

  const write = () => {
    if (!canWrite || !rules || !highlights || !flair || !preview) return
    setAsking(false)
    void room.runWrite(() =>
      api.writeTimeline(folder, rules, project.timelineSegmentCount, subtitlesOn && subtitles ? { length: subtitles.length, texts } : null, {
        position: highlights.position,
        hideSubtitles: highlights.hideSubtitles,
        highlightsOn,
        // every group listed, the replaced ones among them: main checks this against the groups it places
        groupCount: preview.groups.length,
        flair,
      }),
    )
  }

  return (
    <>
      {/* the title says the reason whole where the bar is too narrow to; the reason itself is WriteReason, before the AI menu */}
      <Button variant="primary" disabled={!canWrite} title={why ? t(why) : undefined} aria-describedby={why ? WRITE_REASON_ID : undefined} onClick={() => setAsking(true)}>
        {writing ? t("write.writing") : state.kind === "written" ? t("write.again") : t("timeline.write")}
      </Button>
      <Sheet
        open={asking}
        title={t("write.title", { project: project.name })}
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>{t("write.cancel")}</Button>
            <Button variant="primary" disabled={!canWrite} aria-describedby={why ? sheetReasonId : undefined} onClick={write}>
              {t("write.confirm")}
            </Button>
          </>
        }
      >
        <ul className="write-list">
          <li>
            {t("write.video", { pieces: plan?.cuts.length ?? 0, duration: formatDuration(plan?.durationUs ?? 0) })}
            {targetUs !== null && ` · ${t("write.target", { target: formatDuration(targetUs) })}`}
          </li>
          <li>{t("write.emphasis", { count: shownPoints, level: levelName })}</li>
          <li>
            {highlightsOn ? t("write.text", { groups: drawnGroups.length, lines: drawnGroups.reduce((sum, group) => sum + group.lines.length, 0) }) : off("highlights.title")}
          </li>
          <li>{graphicsOn ? t("write.graphics", { count: playing.length - failedRenders }) : off("flair.graphic")}</li>
          <li>{flair?.zoom ? t("write.zooms", { count: preview?.zooms.length ?? 0 }) : off("flair.zoom")}</li>
          <li>{flair?.insert ? t("write.inserts", { count: preview?.inserts.length ?? 0 }) : off("flair.insert")}</li>
          <li>{flair?.sound ? t("write.sounds", { count: preview?.cues.length ?? 0 }) : off("flair.sound")}</li>
          <li>{subtitlesOn ? t("write.subtitles", { count: texts.filter((text) => text.trim()).length }) : off("subtitles.title")}</li>
          {(preview?.zoomsLost ?? 0) > 0 && <li className="warn-text">{t("write.zoomsLost", { count: preview!.zoomsLost })}</li>}
          {preview && preview.proLeftOut.exits + preview.proLeftOut.sounds > 0 && (
            <li className="warn-text">{t("write.proLeftOut", { exits: preview.proLeftOut.exits, sounds: preview.proLeftOut.sounds })}</li>
          )}
        </ul>
        <ul className="write-list">
          <li className={project.timelineSegmentCount > 0 ? "warn-text" : undefined}>
            {project.timelineSegmentCount > 0 ? t("warn.timelineReplaced", { count: project.timelineSegmentCount }) : t("write.fresh")}
          </li>
          {!project.versionTested && <li className="warn-text">{t("warn.untestedVersion", { version: project.capcutVersion })}</li>}
          {/* renders still going hold nothing here: main waits for them before it touches the draft */}
          {playing.length > 0 && (
            <li>
              {t("write.check.graphics", { done: finished, total: playing.length })}
              {finished < playing.length && ` · ${t("write.check.graphicsGoing")}`}
            </li>
          )}
          {failedRenders > 0 && <li className="warn-text">{t("write.check.graphicsFailed", { count: failedRenders })}</li>}
          {leftOut > 0 && <li className="warn-text">{t("write.check.graphicsUnwritten", { count: leftOut })}</li>}
        </ul>
        <p className="hint">{t("write.backup")}</p>
        {/* the sheet is modal, so a hold that comes while it is open is said inside it, right above its buttons */}
        {why && (
          <p id={sheetReasonId} className="warn-text" role="status">
            {t(why)}
          </p>
        )}
      </Sheet>
    </>
  )
}

/** One notice per read that failed, each with the way to read it again. Nothing when none failed. */
export function FailedReads(): ReactElement | null {
  const { failed, retry } = useClipRoom()
  const reads = (Object.keys(FAILED_READ_WORDS) as RoomRead[]).filter((read) => failed[read])
  if (reads.length === 0) return null
  return (
    <>
      {reads.map((read) => (
        <FailedRead key={read} text={t(FAILED_READ_WORDS[read])} onRetry={() => retry(read)} />
      ))}
    </>
  )
}

function FailedRead({ text, onRetry }: { text: string; onRetry: () => void }) {
  // every retry button reads the same, so it is described by its notice's words: what it tries again
  const textId = useId()
  return (
    <p className="notice error read-failed" role="alert">
      <span id={textId}>{text}</span>
      <Button size="sm" aria-describedby={textId} onClick={onRetry}>
        {t("write.check.retry")}
      </Button>
    </p>
  )
}
