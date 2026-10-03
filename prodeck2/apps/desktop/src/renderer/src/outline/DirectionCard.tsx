import { useState } from "react"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"

interface Props {
  /** the outline's direction; empty or absent on an outline from before 0.8.4, or one the user cleared */
  direction: string | undefined
  disabled: boolean
  /** saves the user's words; a refusal leaves the editor open with what they typed */
  onSave: (direction: string) => Promise<void>
}

/** The most characters the editor takes, as the main process keeps them. */
const MAX = 1000

/**
 * How the clip should be decorated after the cut, in the planner's words: every work of "ทำทั้งหมด" is told it. The
 * user may rewrite it; the cut does not change, so the outline stays as confirmed as it was.
 */
export function DirectionCard({ direction, disabled, onSave }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const text = direction?.trim() ?? ""

  const save = async () => {
    if (draft === null) return
    setSaving(true)
    try {
      await onSave(draft.trim())
      setDraft(null)
    } catch {
      // the screen shows why; what was typed stays in the editor
    } finally {
      setSaving(false)
    }
  }

  if (draft !== null) {
    return (
      <div className="direction-card editing">
        <h2>{t("outline.direction")}</h2>
        <textarea rows={4} maxLength={MAX} aria-label={t("outline.direction")} placeholder={t("outline.directionPlaceholder")} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
        <div className="direction-actions">
          <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
            {t("outline.directionSave")}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
            {t("outline.cancel")}
          </Button>
        </div>
      </div>
    )
  }

  if (text === "") {
    return (
      <div className="direction-card empty">
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setDraft("")}>
          {t("outline.directionAdd")}
        </Button>
      </div>
    )
  }

  return (
    <div className="direction-card">
      <div className="direction-head">
        <h2>{t("outline.direction")}</h2>
        <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setDraft(text)}>
          {t("outline.directionEdit")}
        </Button>
      </div>
      <p>{text}</p>
      <p className="hint">{t("outline.directionHint")}</p>
    </div>
  )
}
