import { useRef, useState } from "react"
import type { ComposedSoundView, CueAnchor, HighlightPreview, OwnSoundView } from "../../../shared/api.ts"
import { playedSeconds } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import type { Rewriting } from "../room/ClipRoom.tsx"
import { Button } from "../ui/Button.tsx"
import { cueKey, EditField, failure, FromPoint, ItemRow, type ItemState, type ListProps } from "./FlairTab.tsx"

export interface ComposedListProps extends ListProps {
  /** the user's own CapCut sounds that still play in this beat, or the whole clip */
  own: OwnSoundView[]
  /** stored sounds of the whole clip that are not playing, and why */
  unused: HighlightPreview["unusedSounds"]
  /** why composed sounds do not render on this machine, in one line; null when nothing is known to be wrong */
  problem: string | null
  /** a plan run is going, of which a project has one at a time: no sound can be composed again until it is over */
  planning: boolean
  /** the sound being written again, by its place, and how, until the read that shows how it came out has landed; null when none is */
  rewriting: Rewriting | null
  /** has Claude compose a sound again, from its role */
  onRedo: (anchor: CueAnchor) => void
  /** has Claude change a written sound as the user asks, with what they typed, trimmed */
  onEdit: (anchor: CueAnchor, instruction: string) => void
  /** takes a sound one step back, to the code before its last edit or composing again */
  onUndo: (anchor: CueAnchor) => void
  /** switches a sound off or on, or removes it with null */
  onSet: (anchor: CueAnchor, patch: { off: boolean } | null) => void
  /** takes one of the user's own CapCut sounds off its place */
  onRemoveOwn: (anchor: CueAnchor) => void
}

/**
 * The one line that says how a composed sound stands, the first of these that holds: it is the one being written again
 * (`rewritten`: from its role, or changed as the user asked), whatever else is true of it; it is switched off; its last
 * composing failed; the graphic it scores changed, or the cut under it did, so it is to be composed again; it is not
 * composed yet; and only then how its file's render stands.
 */
function soundState(sound: ComposedSoundView, rewritten: Rewriting["how"] | null): ItemState {
  const plain = (key: MessageKey): ItemState => ({ text: t(key), className: "graphic-state sound-state" })
  if (rewritten) return plain(rewritten === "edit" ? "sounds.state.editing" : "sounds.state.writing")
  // a sound switched off is not rendered or put in the draft, so how it stands otherwise does not matter
  if (sound.off) return plain("sounds.state.off")
  if (sound.writeFailed !== null) return failure("sounds.state.failed", sound.writeFailed, "graphic-state sound-state warn-text")
  if (sound.stale === "picture") return plain("sounds.state.stalePicture")
  if (sound.stale === "cut") return plain("sounds.state.staleCut")
  if (!sound.written) return plain("sounds.state.unwritten")
  if (sound.render === "failed") return failure("sounds.state.renderFailed", sound.error, "graphic-state sound-state failed")
  return { text: t(`sounds.state.${sound.render}` as MessageKey), className: `graphic-state sound-state ${sound.render}` }
}

/**
 * Work 4 in one beat, or the whole clip: the sounds Claude composed, each with what it does and what it follows, how it
 * stands, and the same ways to have it written again, changed, taken back, switched off or removed as a graphic has;
 * then the user's own CapCut sounds from before 0.6.0, which can only be taken off.
 */
export function ComposedList({ flair, points, own, unused, problem, planning, rewriting, busy, onRedo, onEdit, onUndo, onSet, onRemoveOwn }: ComposedListProps) {
  const sounds = flair.composed
  // the sound whose edit field is open, by its place: one on the page at a time, as for the graphics
  const [asking, setAsking] = useState<string | null>(null)
  // the แก้ that opened it, which the keyboard goes back to when the field is closed without sending
  const opener = useRef<HTMLButtonElement | null>(null)
  // the field belongs to a written sound as it is listed now. Once none listed here has its place (its row removed, or
  // its code gone with a composing again that failed), it is let go for good, here as the list is drawn: a sound
  // composed at that place later, or this one composed back, opens no field by itself and pulls no keyboard into it
  if (asking !== null && !sounds.some((sound) => sound.written && cueKey(sound.anchor) === asking)) setAsking(null)
  // known by its place, not as the object it was listed as: every read of the preview brings new objects
  const rewritingKey = rewriting === null ? null : cueKey(rewriting.anchor)
  // no sound can be composed again, changed or taken back while a change of the user's is out or a plan run goes
  const held = busy || planning

  return (
    <div className="flair">
      {unused.unplaced > 0 && <p className="notice warn-text">{t("flair.unplaced", { count: unused.unplaced })}</p>}
      {unused.missing > 0 && <p className="notice warn-text">{t("flair.missing", { count: unused.missing })}</p>}
      {unused.pro > 0 && <p className="notice warn-text">{t("flair.needsPro", { count: unused.pro })}</p>}
      {unused.lost > 0 && <p className="notice warn-text">{t("flair.lost", { count: unused.lost })}</p>}
      <p className="tab-section">{t("sounds.composed")}</p>
      {problem !== null && <p className="notice warn-text">{t("sounds.problem", { problem })}</p>}
      {sounds.length === 0 && <p className="hint">{t("sounds.none")}</p>}
      {sounds.length > 0 && (
        <ol className="flair-rows">
          {sounds.map((sound) => {
            const named = { role: sound.role }
            const key = cueKey(sound.anchor)
            const rewritten = key === rewritingKey ? rewriting!.how : null
            const state = soundState(sound, rewritten)
            // only code can be changed: one not composed yet, or whose composing failed, is composed from its role first
            const fieldOpen = sound.written && asking === key
            // the change that made the code there now, which gives way while that code is being replaced
            const lastEdit = sound.instruction && !rewritten ? t("graphics.lastEdit", { instruction: sound.instruction }) : null
            // why the last edit failed, which leaves the code before it playing; while it is written again, the row speaks of that alone
            const editFailed = sound.editFailed === null || rewritten ? null : failure("graphics.editFailed", sound.editFailed, "graphic-edit-failed warn-text")
            // closed without sending, the field hands the keyboard back to the แก้ that opened it
            const close = () => {
              setAsking(null)
              opener.current?.focus()
            }
            return (
              <ItemRow key={key} atUs={sound.atUs} className={["flair-row sound", sound.off && "off", fieldOpen && "field-open"].filter(Boolean).join(" ")}>
                <span className="graphic-body">
                  {/* the role can run to a sentence or two: two lines of it show, and the whole is there for a pointer held over it */}
                  <span className="flair-what" title={sound.role}>
                    {sound.role}
                  </span>
                  {lastEdit && (
                    <span className="hint graphic-last-edit" title={lastEdit}>
                      {lastEdit}
                    </span>
                  )}
                  {/* a sound that scores a graphic follows it, which says more than the point both were made for */}
                  {sound.graphic ? (
                    <span className="hint sound-of-graphic" title={t("sounds.ofGraphic", { summary: sound.graphic.summary })}>
                      {t("sounds.ofGraphic", { summary: sound.graphic.summary })}
                    </span>
                  ) : (
                    <FromPoint points={points} pointId={sound.pointId} />
                  )}
                  <span className="hint sound-from">{t(`sounds.from.${sound.from}` as MessageKey)}</span>
                  <span className={state.className} title={state.title}>
                    {state.text}
                  </span>
                  {editFailed && (
                    <span className={editFailed.className} title={editFailed.title}>
                      {editFailed.text}
                    </span>
                  )}
                </span>
                {/* how long it plays, which the end of its room can make shorter than its length */}
                <span className="flair-length">{t("edit.pieceLength", { seconds: playedSeconds(sound.durationUs) })}</span>
                <span className="graphic-actions">
                  <Button size="xs" aria-label={t("sounds.redoLabel", named)} disabled={held} onClick={() => onRedo(sound.anchor)}>
                    {t("sounds.redo")}
                  </Button>
                  {sound.written && (
                    <Button
                      size="xs"
                      aria-label={t("sounds.editLabel", named)}
                      aria-expanded={fieldOpen}
                      disabled={held}
                      onClick={(event) => {
                        opener.current = event.currentTarget
                        // pressed on the row whose field is open it closes it, and on another row it opens there instead
                        setAsking(fieldOpen ? null : key)
                      }}
                    >
                      {t("sounds.edit")}
                    </Button>
                  )}
                  {sound.canUndo && (
                    <Button size="xs" aria-label={t("sounds.undoLabel", named)} disabled={held} onClick={() => onUndo(sound.anchor)}>
                      {t("sounds.undo")}
                    </Button>
                  )}
                  <Button size="xs" aria-label={t(sound.off ? "sounds.onLabel" : "sounds.offLabel", named)} disabled={busy} onClick={() => onSet(sound.anchor, { off: !sound.off })}>
                    {sound.off ? t("sounds.on") : t("sounds.off")}
                  </Button>
                  <Button size="xs" aria-label={t("sounds.removeLabel", named)} disabled={busy} onClick={() => onSet(sound.anchor, null)}>
                    {t("sounds.remove")}
                  </Button>
                </span>
                {fieldOpen && (
                  <EditField
                    held={held}
                    label={t("sounds.editField")}
                    hint={t("sounds.editHint")}
                    onSend={(instruction) => {
                      setAsking(null)
                      onEdit(sound.anchor, instruction)
                    }}
                    onCancel={close}
                  />
                )}
              </ItemRow>
            )
          })}
        </ol>
      )}

      {own.length > 0 && (
        <>
          <p className="tab-section">{t("sounds.own")}</p>
          <ol className="flair-rows">
            {own.map((sound) => (
              <ItemRow key={cueKey(sound.anchor)} atUs={sound.atUs}>
                <span className="flair-what">{sound.name}</span>
                <Button size="xs" aria-label={t("sounds.ownRemoveLabel", { name: sound.name })} disabled={busy} onClick={() => onRemoveOwn(sound.anchor)}>
                  {t("sounds.remove")}
                </Button>
              </ItemRow>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
