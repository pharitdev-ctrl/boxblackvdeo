import { useState } from "react"
import type { EmphasisPointView, FlairLookPatch, HighlightGroupView, HighlightLineView, HighlightPreview } from "../../../shared/api.ts"
import { formatTimestamp } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Empty } from "../ui/Empty.tsx"
import { FromPoint } from "./FlairTab.tsx"
import { LookPopover } from "./LookPopover.tsx"

/** One line, saved when the user leaves it or presses Enter; a cleared line is removed. */
function LineInput({ group, line, number, busy, onEdit }: { group: HighlightGroupView; line: HighlightLineView; number: number; busy: boolean; onEdit: HighlightTabProps["onEdit"] }) {
  const [text, setText] = useState(line.text)
  const time = formatTimestamp(line.startUs)
  return (
    <input
      type="text"
      aria-label={t("highlights.lineLabel", { number, time })}
      value={text}
      // lines are saved by their place in the group, which is stale until the group is placed again
      disabled={busy}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const trimmed = text.trim()
        if (trimmed !== line.text) onEdit(group.id, line.index, trimmed || null)
      }}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
    />
  )
}

export interface HighlightTabProps {
  groups: HighlightGroupView[]
  /** every point on the cut, to say which one a group was made for */
  points: EmphasisPointView[]
  busy: boolean
  /** `text` null removes the line */
  onEdit: (groupId: string, index: number, text: string | null) => void
  onRemove: (groupId: string) => void
  /** the text looks are on: each group offers its own */
  looks: boolean
  landscape: boolean
  /** the exit animations the user may have (the preview's list) */
  exits: HighlightPreview["exits"]
  onLook: (groupId: string, patch: FlairLookPatch) => void
}

/**
 * The highlight text of one beat, or of the whole clip: each group with its lines, editable and removable. A group
 * a graphic takes the place of is listed like the rest, dimmed the way a switched-off graphic's row is, and says
 * so where a group says how it was placed: it is not drawn in the clip, and can still be changed or removed.
 */
export function HighlightTab({ groups, points, busy, onEdit, onRemove, looks, landscape, exits, onLook }: HighlightTabProps) {
  const [looking, setLooking] = useState<string | null>(null)
  if (groups.length === 0) return <Empty title={t("edit.textEmpty")} hint={t("edit.textEmptyHint")} />

  return (
    <ol className="highlight-groups">
      {groups.map((group) => {
        return (
          <li key={group.id} className={group.replaced ? "highlight-group off" : "highlight-group"}>
            <div className="highlight-head">
              <b className="mono">{t("highlights.group", { start: formatTimestamp(group.startUs), end: formatTimestamp(group.endUs) })}</b>
              <span className="tag">{t(group.source === "ai" ? "highlights.source.ai" : "highlights.source.user")}</span>
              <FromPoint points={points} pointId={group.pointId} />
              {/* where its text would sit is beside the point while a graphic plays in its place */}
              {group.replaced ? <span className="hint">{t("highlights.replaced")}</span> : group.placement !== "fixed" && <span className="hint">{t(`highlights.dodge.${group.placement}` as MessageKey)}</span>}
              <span className="grow" />
              {looks && (
                <span className="look-anchor">
                  <Button size="sm" aria-expanded={looking === group.id} onClick={() => setLooking(looking === group.id ? null : group.id)}>
                    {`⚙︎ ${t("edit.look")}`}
                  </Button>
                  <LookPopover open={looking === group.id} onClose={() => setLooking(null)} group={group} landscape={landscape} busy={busy} exits={exits} onLook={onLook} />
                </span>
              )}
              <Button size="sm" disabled={busy} onClick={() => onRemove(group.id)}>
                {t("highlights.removeGroup")}
              </Button>
            </div>
            <ol className="highlight-lines">
              {group.lines.map((line, index) => (
                <li key={`${line.index}:${line.text}`}>
                  <span className="hint mono">{formatTimestamp(line.startUs)}</span>
                  <LineInput group={group} line={line} number={index + 1} busy={busy} onEdit={onEdit} />
                  <Button variant="ghost" size="xs" disabled={busy} onClick={() => onEdit(group.id, line.index, null)}>
                    {t("highlights.removeLine")}
                  </Button>
                  {line.partial && <span className="hint warn-text">{t("highlights.partial")}</span>}
                </li>
              ))}
            </ol>
          </li>
        )
      })}
    </ol>
  )
}
