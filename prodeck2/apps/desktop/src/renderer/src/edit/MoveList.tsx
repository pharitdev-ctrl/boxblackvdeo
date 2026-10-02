import { useRef, useState } from "react"
import type { MoveAnchor, MoveView, PieceAnchor, ZoomView } from "../../../shared/api.ts"
import { playedSeconds } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import type { Rewriting } from "../room/ClipRoom.tsx"
import { Button } from "../ui/Button.tsx"
import { cueKey, EditField, failure, FromPoint, ItemRow, type ItemState, type ListProps } from "./FlairTab.tsx"

export interface MoveListProps extends ListProps {
  /** a plan run is going, of which a project has one at a time: no move can be designed again until it is over */
  planning: boolean
  /** the move being designed again, by its place, and how, until the read that shows how it came out has landed; null when none is */
  rewriting: Rewriting | null
  /** has Claude design a move again */
  onRedo: (anchor: MoveAnchor) => void
  /** has Claude change a move as the user asks, with what they typed, trimmed */
  onEdit: (anchor: MoveAnchor, instruction: string) => void
  /** takes a move one step back, to the poses before its last edit or redesign */
  onUndo: (anchor: MoveAnchor) => void
  /** switches a move off or on, or removes it with null */
  onSet: (anchor: MoveAnchor, patch: { off: boolean } | null) => void
  /** takes a legacy zoom off its piece */
  onRemoveZoom: (anchor: PieceAnchor) => void
}

/**
 * A key for a move's place: its word, or its cutaway's, and whether it moves the cutaway, since a move on a word and
 * one on the cutaway that comes up on that same word share an anchor.
 */
export function moveKey(anchor: MoveAnchor): string {
  const { insert, ...place } = anchor
  return `${cueKey(place)}#${insert === true ? "insert" : "footage"}`
}

/** The place a move is asked for by, as the app finds it: its stored anchor, and whether it is on a cutaway. */
const placeOf = (move: MoveView): MoveAnchor => ({ ...move.anchor, insert: move.insert })

/**
 * How a move stands, when there is anything to say: it is the one being designed again (`rewritten`: anew, or changed
 * as the user asked), whatever else is true of it; or it is switched off. One that plays says nothing more.
 */
function moveState(move: MoveView, rewritten: Rewriting["how"] | null): ItemState | null {
  const plain = (key: MessageKey): ItemState => ({ text: t(key), className: "graphic-state move-state" })
  if (rewritten) return plain(rewritten === "edit" ? "moves.state.editing" : "moves.state.writing")
  return move.off ? plain("moves.state.off") : null
}

type Row = { kind: "move"; move: MoveView } | { kind: "zoom"; zoom: ZoomView }

/**
 * The moves of the picture in one beat, or in the whole clip, in the order they play, with the legacy punches and
 * drifts of before 0.8.0 among them. A move says what it does, what the user last asked of it, the point it was made
 * for, the level it plays from, whether it moves a cutaway, how it stands and why its last change failed, and can be
 * designed again, changed, taken back, switched off or removed. A legacy zoom can only be removed from its piece: it has
 * no switch, and thought again, it gives way to moves.
 */
export function MoveList({ flair, points, planning, rewriting, busy, onRedo, onEdit, onUndo, onSet, onRemoveZoom }: MoveListProps) {
  const rows: Row[] = [...flair.moves.map((move): Row => ({ kind: "move", move })), ...flair.zooms.map((zoom): Row => ({ kind: "zoom", zoom }))].sort(
    (a, b) => (a.kind === "move" ? a.move.atUs : a.zoom.atUs) - (b.kind === "move" ? b.move.atUs : b.zoom.atUs),
  )
  // the move whose edit field is open, by its place: one on the page at a time, as for the graphics
  const [asking, setAsking] = useState<string | null>(null)
  // the แก้ that opened it, which the keyboard goes back to when the field is closed without sending
  const opener = useRef<HTMLButtonElement | null>(null)
  // once no move listed here has its place (removed, or gone from the cut), the field is let go for good, so a move
  // made at that place later opens none by itself
  if (asking !== null && !flair.moves.some((move) => moveKey(placeOf(move)) === asking)) setAsking(null)
  // known by its place, not as the object it was listed as: every read of the preview brings new objects
  const rewritingKey = rewriting === null ? null : moveKey(rewriting.anchor)
  // no move can be designed again, changed or taken back while a change of the user's is out or a plan run goes
  const held = busy || planning

  return (
    <div className="flair">
      <p className="tab-section">{t("edit.flairMoves")}</p>
      {rows.length === 0 && <p className="hint">{t("moves.none")}</p>}
      {rows.length > 0 && (
        <ol className="flair-rows">
          {rows.map((row) => {
            if (row.kind === "zoom") {
              const { zoom } = row
              const kind = t(`flair.zoom.${zoom.kind}` as MessageKey)
              const named = { about: `${kind} ${zoom.what}` }
              return (
                <ItemRow key={`zoom:${zoom.anchor.videoId}:${zoom.anchor.sourceUs}`} atUs={zoom.atUs} className="flair-row move">
                  <span className="graphic-body">
                    <span className="flair-what">{kind}</span>
                    <span className="hint">{zoom.what}</span>
                    <FromPoint points={points} pointId={zoom.pointId} />
                    {zoom.edited && <span className="hint">{t("flair.edited")}</span>}
                  </span>
                  <span className="flair-length">{t("edit.pieceLength", { seconds: playedSeconds(zoom.durationUs) })}</span>
                  <span className="graphic-actions">
                    {/* a legacy zoom has no switch of its own, so it can only be taken off its piece, which then plays still */}
                    <Button size="xs" aria-label={t("moves.removeLabel", named)} disabled={busy} onClick={() => onRemoveZoom(zoom.anchor)}>
                      {t("moves.remove")}
                    </Button>
                  </span>
                </ItemRow>
              )
            }
            const { move } = row
            const place = placeOf(move)
            const key = moveKey(place)
            const named = { about: move.about }
            const rewritten = key === rewritingKey ? rewriting!.how : null
            const state = moveState(move, rewritten)
            const fieldOpen = asking === key
            // the change that made the poses there now, which gives way while they are being replaced
            const lastEdit = move.instruction && !rewritten ? t("moves.lastEdit", { instruction: move.instruction }) : null
            // why the last change failed, which leaves the poses before it playing; while it is designed again, the row speaks of that alone
            const editFailed = move.editFailed === null || rewritten ? null : failure("moves.editFailed", move.editFailed, "graphic-edit-failed warn-text")
            // closed without sending, the field hands the keyboard back to the แก้ that opened it
            const close = () => {
              setAsking(null)
              opener.current?.focus()
            }
            return (
              <ItemRow key={key} atUs={move.atUs} className={["flair-row move", move.off && "off", fieldOpen && "field-open"].filter(Boolean).join(" ")}>
                <span className="graphic-body">
                  {/* Claude's line on what it does, held to two lines, the whole of it for a pointer held over it */}
                  <span className="flair-what" title={move.about}>
                    {move.about}
                  </span>
                  {lastEdit && (
                    <span className="hint graphic-last-edit" title={lastEdit}>
                      {lastEdit}
                    </span>
                  )}
                  <FromPoint points={points} pointId={move.pointId} />
                  <span className="hint move-from">{t(`moves.from.${move.from}` as MessageKey)}</span>
                  {move.insert && <span className="hint move-insert">{t("moves.onInsert")}</span>}
                  {state && <span className={state.className}>{state.text}</span>}
                  {editFailed && (
                    <span className={editFailed.className} title={editFailed.title}>
                      {editFailed.text}
                    </span>
                  )}
                  {move.edited && <span className="hint">{t("flair.edited")}</span>}
                </span>
                {/* how long its poses run before it holds the last */}
                <span className="flair-length">{t("edit.pieceLength", { seconds: playedSeconds(move.durationUs) })}</span>
                <span className="graphic-actions">
                  <Button size="xs" aria-label={t("moves.redoLabel", named)} disabled={held} onClick={() => onRedo(place)}>
                    {t("moves.redo")}
                  </Button>
                  <Button
                    size="xs"
                    aria-label={t("moves.editLabel", named)}
                    aria-expanded={fieldOpen}
                    disabled={held}
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      // pressed on the row whose field is open it closes it, and on another row it opens there instead
                      setAsking(fieldOpen ? null : key)
                    }}
                  >
                    {t("moves.edit")}
                  </Button>
                  {move.canUndo && (
                    <Button size="xs" aria-label={t("moves.undoLabel", named)} disabled={held} onClick={() => onUndo(place)}>
                      {t("moves.undo")}
                    </Button>
                  )}
                  <Button size="xs" aria-label={t(move.off ? "moves.onLabel" : "moves.offLabel", named)} disabled={busy} onClick={() => onSet(place, { off: !move.off })}>
                    {move.off ? t("moves.on") : t("moves.off")}
                  </Button>
                  <Button size="xs" aria-label={t("moves.removeLabel", named)} disabled={busy} onClick={() => onSet(place, null)}>
                    {t("moves.remove")}
                  </Button>
                </span>
                {fieldOpen && (
                  <EditField
                    held={held}
                    label={t("moves.editField")}
                    hint={t("moves.editHint")}
                    onSend={(instruction) => {
                      setAsking(null)
                      onEdit(place, instruction)
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
