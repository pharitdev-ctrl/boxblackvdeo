import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"

/** Says the points changed after this tab's work was planned on them, with the way to plan it again (spec §4.4). */
export function EmphasisBanner({ onRethink, busy }: { onRethink: () => void; busy: boolean }) {
  return (
    <div className="emphasis-banner">
      <span>{t("emphasis.changed")}</span>
      <Button size="sm" variant="ai" disabled={busy} onClick={onRethink}>
        {t("emphasis.changedAction")}
      </Button>
    </div>
  )
}
