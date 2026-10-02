import { useRef, useState } from "react"
import type { CueAnchor, EmphasisPointView, GraphicPatch, GraphicView } from "../../../shared/api.ts"
import { playedSeconds } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import type { Rewriting } from "../room/ClipRoom.tsx"
import { Button } from "../ui/Button.tsx"
import { cueKey, EditField, failure, FromPoint, ItemRow, type ItemState, type ListProps } from "./FlairTab.tsx"

export interface GraphicListProps extends ListProps {
  /** a plan run is going, of which a project has one at a time: no graphic can be written again until it is over */
  planning: boolean
  /** the graphic being written again, by its place, and how (from its idea, or changed as asked), until the read that shows how it came out has landed; null when none is */
  rewriting: Rewriting | null
  /** a run that is not a redo or an edit is writing the graphics: one not written yet is being written, or waits its turn */
  writingGraphics: boolean
  /** switches a graphic off or on, or removes it with null */
  onGraphic: (anchor: CueAnchor, patch: GraphicPatch | null) => void
  onRetryGraphic: (anchor: CueAnchor) => void
  /** has Claude write a graphic again, from its idea */
  onRedoGraphic: (anchor: CueAnchor) => void
  /** has Claude change a written graphic as the user asks, with what they typed, trimmed */
  onEditGraphic: (anchor: CueAnchor, instruction: string) => void
  /** takes a graphic one step back, to the fragment before its last edit or redo */
  onUndoGraphic: (anchor: CueAnchor) => void
}

/**
 * The one line that says how a graphic stands, the first of these that holds: it is the one being written again
 * (`rewritten`: from its idea, or changed as the user asked), whatever else is true of it; it is switched off; its
 * last writing failed; the cut changed under it, so it is to be written again; it is not written yet, which a run
 * that is not a redo or an edit (`writing`) is doing, or else it waits for the user to ask; and only then how its
 * render stands.
 */
function graphicState(graphic: GraphicView, rewritten: Rewriting["how"] | null, writing: boolean): ItemState {
  const plain = (key: MessageKey): ItemState => ({ text: t(key), className: "graphic-state" })
  // whatever it read before was about the fragment being replaced, or about having none; and a redo or an edit writes a switched-off one too
  if (rewritten) return plain(rewritten === "edit" ? "graphics.state.editing" : "graphics.state.writing")
  // a graphic switched off is not rendered or put in the draft, so how it stands otherwise does not matter
  if (graphic.off) return plain("graphics.offState")
  if (graphic.writeFailed !== null) return failure("graphics.state.writeFailed", graphic.writeFailed, "graphic-state warn-text")
  // a fragment a change of the user's made would lose that change to a redo, where แก้ fits it to the cut and keeps it
  if (graphic.stale) return plain(graphic.instruction ? "graphics.state.staleEdited" : "graphics.state.stale")
  if (!graphic.written) return plain(writing ? "graphics.state.writing" : "graphics.state.unwritten")
  if (graphic.render === "failed") return failure("graphics.render.failed", graphic.error, "graphic-state failed")
  return { text: t(`graphics.render.${graphic.render}` as MessageKey), className: `graphic-state ${graphic.render}` }
}

/**
 * The point a graphic is tied to, as its row says it. A free graphic tells the story of its point; one planned before
 * 0.7.0 was made for its point, and says so as the other items of the page do. A free one tied to none, or to a point
 * not on the cut now, says nothing.
 */
function OfPoint({ graphic, points }: { graphic: GraphicView; points: EmphasisPointView[] }) {
  if (graphic.from === null) return <FromPoint points={points} pointId={graphic.pointId} />
  const point = graphic.pointId === undefined ? undefined : points.find((one) => one.id === graphic.pointId)
  if (!point) return null
  const label = t("graphics.ofPoint", { text: point.text })
  // a point's words can run long: one line of them shows, the whole in the title
  return (
    <span className="hint graphic-point" title={label}>
      {label}
    </span>
  )
}

/**
 * The graphics of one beat, or of the whole clip, in the order they play: each with its idea, what the user last asked
 * of it, why it is there, the point it tells the story of, the lowest level it plays at, whether it shows in place of
 * its point's highlight text and whether its play was cut short for covering a face or a shown thing, how it stands,
 * and the ways to have it written again, changed, taken back, tried again, switched off or removed.
 */
export function GraphicList({ flair, points, planning, rewriting, writingGraphics, busy, onGraphic, onRetryGraphic, onRedoGraphic, onEditGraphic, onUndoGraphic }: GraphicListProps) {
  // byBeat lists them in playing order already; sorted here too, the list holds that order whatever it is given
  const graphics = [...flair.graphics].sort((a, b) => a.atUs - b.atUs)
  // the graphic whose edit field is open, by its place: one on the page at a time, since the list is drawn once a page
  const [asking, setAsking] = useState<string | null>(null)
  // the แก้ that opened it, which the keyboard goes back to when the field is closed without sending
  const opener = useRef<HTMLButtonElement | null>(null)
  // the field belongs to a written graphic as it is listed now. Once none listed here has its place (its row removed,
  // or its fragment gone with a redo that failed), it is let go for good, here as the list is drawn: a graphic written
  // at that place later, or this one written back, opens no field by itself and pulls no keyboard into it
  if (asking !== null && !graphics.some((graphic) => graphic.written && cueKey(graphic.anchor) === asking)) setAsking(null)
  // the graphic being written again is known by its place, not as the object it was listed as: every read of the
  // preview brings new objects, and its own writing causes one
  const rewritingKey = rewriting === null ? null : cueKey(rewriting.anchor)
  // no graphic can be written again, changed or taken back while a change of the user's is out or a plan run goes
  const held = busy || planning

  return (
    <div className="flair">
      <p className="tab-section">{t("edit.flairGraphics")}</p>
      {graphics.length === 0 && <p className="hint">{t("graphics.none")}</p>}
      {graphics.length > 0 && (
        <ol className="flair-rows">
          {graphics.map((graphic) => {
            const named = { summary: graphic.summary }
            const failed = !graphic.off && graphic.render === "failed"
            const key = cueKey(graphic.anchor)
            const rewritten = key === rewritingKey ? rewriting!.how : null
            const state = graphicState(graphic, rewritten, writingGraphics)
            // only a fragment can be changed: one not written yet, or whose writing failed, is written from its idea first
            const fieldOpen = graphic.written && asking === key
            // the change that made the fragment there now, which gives way while that fragment is being replaced
            const lastEdit = graphic.instruction && !rewritten ? t("graphics.lastEdit", { instruction: graphic.instruction }) : null
            // why the last edit failed, which leaves the fragment before it standing; while it is written again, the row speaks of that alone
            const editFailed = graphic.editFailed === null || rewritten ? null : failure("graphics.editFailed", graphic.editFailed, "graphic-edit-failed warn-text")
            // closed without sending, the field hands the keyboard back to the แก้ that opened it
            const close = () => {
              setAsking(null)
              opener.current?.focus()
            }
            return (
              <ItemRow key={key} atUs={graphic.atUs} className={["flair-row graphic", graphic.off && "off", fieldOpen && "field-open"].filter(Boolean).join(" ")}>
                {/* the summary is written beside the poster, so the poster itself says nothing more */}
                {graphic.poster ? <img className="graphic-poster" src={graphic.poster} alt="" /> : <span className="graphic-poster-none" aria-hidden />}
                <span className="graphic-body">
                  {/* the summary is the graphic's idea, which the row holds to two lines: the whole of it is there for a pointer held over it */}
                  <span className="flair-what" title={graphic.summary}>
                    {graphic.summary}
                  </span>
                  {/* the change that made the fragment there now, held to two lines as the idea is */}
                  {lastEdit && (
                    <span className="hint graphic-last-edit" title={lastEdit}>
                      {lastEdit}
                    </span>
                  )}
                  <span className="hint graphic-why">{graphic.why || graphic.what}</span>
                  <OfPoint graphic={graphic} points={points} />
                  {/* a legacy graphic plays by its point's importance, so it has no level of its own to say */}
                  {graphic.from !== null && <span className="hint graphic-from">{t(`graphics.from.${graphic.from}` as MessageKey)}</span>}
                  {graphic.replaces && <span className="hint graphic-replaces">{t("graphics.replaces")}</span>}
                  {graphic.coversKeep && <span className="hint graphic-covers">{t("graphics.coversKeep")}</span>}
                  <span className={state.className} title={state.title}>
                    {state.text}
                  </span>
                  {editFailed && (
                    <span className={editFailed.className} title={editFailed.title}>
                      {editFailed.text}
                    </span>
                  )}
                  {graphic.edited && <span className="hint">{t("flair.edited")}</span>}
                </span>
                {/* how long it plays, which the end of its sentence's piece, or a face it covers, can make shorter than its length */}
                <span className="flair-length">{t("edit.pieceLength", { seconds: playedSeconds(graphic.durationUs) })}</span>
                <span className="graphic-actions">
                  <Button size="xs" aria-label={t("graphics.redoLabel", named)} disabled={held} onClick={() => onRedoGraphic(graphic.anchor)}>
                    {t("graphics.redo")}
                  </Button>
                  {graphic.written && (
                    <Button
                      size="xs"
                      aria-label={t("graphics.editLabel", named)}
                      aria-expanded={fieldOpen}
                      disabled={held}
                      onClick={(event) => {
                        opener.current = event.currentTarget
                        // pressed on the row whose field is open it closes it, and on another row it opens there instead
                        setAsking(fieldOpen ? null : key)
                      }}
                    >
                      {t("graphics.edit")}
                    </Button>
                  )}
                  {failed && (
                    <Button size="xs" aria-label={t("graphics.retryLabel", named)} disabled={busy} onClick={() => onRetryGraphic(graphic.anchor)}>
                      {t("graphics.retry")}
                    </Button>
                  )}
                  {graphic.canUndo && (
                    <Button size="xs" aria-label={t("graphics.undoLabel", named)} disabled={held} onClick={() => onUndoGraphic(graphic.anchor)}>
                      {t("graphics.undo")}
                    </Button>
                  )}
                  <Button size="xs" aria-label={t(graphic.off ? "graphics.onLabel" : "graphics.offLabel", named)} disabled={busy} onClick={() => onGraphic(graphic.anchor, { off: !graphic.off })}>
                    {graphic.off ? t("graphics.on") : t("graphics.off")}
                  </Button>
                  <Button size="xs" aria-label={t("graphics.removeLabel", named)} disabled={busy} onClick={() => onGraphic(graphic.anchor, null)}>
                    {t("graphics.remove")}
                  </Button>
                </span>
                {fieldOpen && (
                  <EditField
                    held={held}
                    onSend={(instruction) => {
                      setAsking(null)
                      onEditGraphic(graphic.anchor, instruction)
                    }}
                    onCancel={close}
                  />
                )}
              </ItemRow>
            )
          })}
        </ol>
      )}
    </div>
  )
}
