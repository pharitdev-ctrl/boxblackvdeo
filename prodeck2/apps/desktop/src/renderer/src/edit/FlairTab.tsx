import { useId, useState, type ReactNode } from "react"
import type { MediaFit } from "@boxblack/core/flair/look-at"
import { INSTRUCTION_MAX, instructionLength } from "@boxblack/core/graphics/plan"
import type { CueAnchor, EmphasisPointView, FlairOptions, HighlightPreview } from "../../../shared/api.ts"
import type { BeatFlair } from "./byBeat.ts"
import { pointLabel } from "./postTabs.ts"
import { formatTimestamp, lastLines } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Empty } from "../ui/Empty.tsx"
import { Field } from "../ui/Field.tsx"

/** A key for an item placed at an anchor: a graphic, a composed sound, or a CapCut sound, each found by its place. */
export const cueKey = (anchor: CueAnchor) => JSON.stringify(anchor)

/** What the lists show: one beat's, or the whole clip's, items, and every point on the cut to say which one each was made for. */
export interface ListProps {
  flair: BeatFlair
  points: EmphasisPointView[]
  busy: boolean
}

export interface TechniqueListProps extends ListProps {
  options: FlairOptions
  media: HighlightPreview["media"]
  /** `replacing`: the picture of the one cutaway changed, since several may sit at one place */
  onInsert: (anchor: CueAnchor, binId: string | null, fit?: MediaFit, replacing?: string) => void
}

/** How a graphic or a sound stands, as its row says it: the words, the class they are drawn in, and the whole of a failure for a pointer held over its last lines. */
export interface ItemState {
  text: string
  className: string
  title?: string
}

/** A failure as its row says it: what failed, then the last lines of why when it said any, the whole of why in the title. */
export const failure = (key: MessageKey, why: string | null, className: string): ItemState =>
  why ? { text: `${t(key)} · ${lastLines(why)}`, className, title: why } : { text: t(key), className }

/** Which point an item was made for, beside it, cut short when the row is narrow and whole when pointed at; nothing for one of the user's own. */
export function FromPoint({ points, pointId }: { points: EmphasisPointView[]; pointId: string | undefined }) {
  const label = pointLabel(points, pointId)
  return label ? (
    <span className="hint from-point" title={label}>
      {label}
    </span>
  ) : null
}

/**
 * A key for each cutaway row: its place and picture, and which of those it is, since one picture may be stacked
 * twice at one place. The row's own buttons name the cutaway by its picture, which reaches the first of such twins.
 */
function cutawayKeys(inserts: BeatFlair["inserts"]): string[] {
  const seen = new Map<string, number>()
  return inserts.map((insert) => {
    const base = `${cueKey(insert.anchor)}#${insert.binId}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return `${base}#${count}`
  })
}

/** One row of a list: when it plays, then what it is and what can be done with it. */
export function ItemRow({ atUs, className = "flair-row", children }: { atUs: number; className?: string; children: ReactNode }) {
  return (
    <li className={className}>
      <span className="hint mono">{formatTimestamp(atUs)}</span>
      {children}
    </li>
  )
}

/**
 * What the user asks to change in a written graphic or sound, typed under its row, asked in the words given (`label`,
 * `hint`). It is sent trimmed, once it says something and is no longer than INSTRUCTION_MAX letters counted as the
 * user sees them (as main counts them), and only while nothing holds the row's buttons (`held`). Longer, it says so
 * and keeps what was typed, to be cut down. Escape, like ยกเลิก, closes it; what was typed goes with it, since it is
 * the field's own.
 */
export function EditField({
  held,
  label = t("graphics.editField"),
  hint = t("graphics.editHint"),
  onSend,
  onCancel,
}: {
  held: boolean
  label?: string
  hint?: string
  onSend: (instruction: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState("")
  const tooLongId = useId()
  const length = instructionLength(text)
  const tooLong = length > INSTRUCTION_MAX
  const ready = length > 0 && !tooLong && !held
  return (
    <form
      className="graphic-edit"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSend(text.trim())
      }}
    >
      <Field label={label}>
        {/* opened by แก้ to be typed in at once */}
        <textarea
          rows={2}
          autoFocus
          placeholder={hint}
          value={text}
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong ? tooLongId : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // an Escape while a word is being composed belongs to the input method, not to the field
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return
            event.preventDefault()
            onCancel()
          }}
        />
      </Field>
      {tooLong && (
        <p id={tooLongId} className="hint warn-text">
          {t("graphics.editTooLong", { max: INSTRUCTION_MAX })}
        </p>
      )}
      <span className="graphic-edit-actions">
        <Button size="xs" type="submit" disabled={!ready}>
          {t("graphics.editSend")}
        </Button>
        <Button size="xs" onClick={onCancel}>
          {t("graphics.editCancel")}
        </Button>
      </span>
    </form>
  )
}

/**
 * Work 2's cutaways in one beat, or the whole clip. The moves of the picture are listed before them (MoveList), and the
 * graphics in a tab of their own (GraphicList). With moves and cutaways both off, the beat has nothing to set here.
 */
export function TechniqueList({ flair, points, options, media, busy, onInsert }: TechniqueListProps) {
  const insertKeys = cutawayKeys(flair.inserts)
  if (!options.zoom && !options.insert) return <Empty title={t("edit.flairEmpty")} />

  return (
    <div className="flair">
      {options.insert && (
        <>
          <p className="tab-section">{t("edit.flairInserts")}</p>
          {media.length === 0 && <p className="notice warn-text">{t("flair.noMedia")}</p>}
          {media.length > 0 && flair.inserts.length === 0 && <p className="hint">{t("inserts.pickHint")}</p>}
          {flair.inserts.length > 0 && (
            <ol className="flair-rows">
              {flair.inserts.map((insert, index) => (
                // several may sit at one place, so the place alone does not tell them apart
                <ItemRow key={insertKeys[index]} atUs={insert.atUs}>
                  <span className="mark insert">🖼 {insert.picture}</span>
                  <span className="flair-what">{insert.what}</span>
                  <span className="flair-length">{t("edit.pieceLength", { seconds: (insert.durationUs / 1_000_000).toFixed(1) })}</span>
                  <FromPoint points={points} pointId={insert.pointId} />
                  {insert.edited && <span className="hint">{t("flair.edited")}</span>}
                  <Button size="xs" aria-label={t("inserts.fitLabel", { picture: insert.picture })} disabled={busy} onClick={() => onInsert(insert.anchor, insert.binId, insert.fit === "cover" ? "card" : "cover", insert.binId)}>
                    {t(`inserts.fit.${insert.fit}` as MessageKey)}
                  </Button>
                  <Button size="xs" aria-label={t("inserts.removeLabel", { picture: insert.picture })} disabled={busy} onClick={() => onInsert(insert.anchor, null, undefined, insert.binId)}>
                    {t("inserts.remove")}
                  </Button>
                </ItemRow>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
