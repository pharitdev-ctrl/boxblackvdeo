import { useState } from "react"
import type { HighlightPreview } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Popover } from "../ui/Popover.tsx"

/**
 * The "รูป" button and the project's pictures to cut away to. `label` names what the picture goes on; `chosen`
 * is the one there now, which alone can be taken off: with none there, "none" would have nothing to do.
 */
export function PicturePicker({ label, chosen, media, busy, onPick }: {
  label: string
  chosen: string | undefined
  media: HighlightPreview["media"]
  busy: boolean
  onPick: (binId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const choose = (binId: string | null) => {
    onPick(binId)
    setOpen(false)
  }
  return (
    // the popover hangs from this box, and shares it with the button that opens it
    <span className="look-anchor">
      <Button size="xs" aria-label={label} aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>
        {t("inserts.pick")}
      </Button>
      <Popover open={open} label={label} onClose={() => setOpen(false)}>
        <ul className="ai-items">
          {chosen !== undefined && (
            <li>
              <Button size="sm" onClick={() => choose(null)}>
                {t("flair.insert.none")}
              </Button>
            </li>
          )}
          {media.map((picture) => (
            <li key={picture.binId}>
              <Button size="sm" aria-pressed={chosen === picture.binId} onClick={() => choose(picture.binId)}>
                {picture.what}
                {picture.kind === "video" ? t("flair.insert.clip") : ""}
              </Button>
            </li>
          ))}
        </ul>
      </Popover>
    </span>
  )
}
