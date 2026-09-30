import { useState } from "react"
import type { DesktopApi } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Popover } from "../ui/Popover.tsx"
import { BackupList, useBackups } from "./BackupList.tsx"

export interface BackupMenuProps {
  api: Pick<DesktopApi, "listBackups" | "restoreBackup">
  folder: string
  capcutRunning: boolean | null
  /** change it to read the list again, e.g. after a write made a new backup */
  refreshKey: number
  onRestored: () => void
  /** a write to this draft is running: the main process would refuse to put a backup back */
  writing?: boolean
}

/** The copies the app took before each write, and the way back to one of them. */
export function BackupMenu({ api, folder, capcutRunning, refreshKey, onRestored, writing = false }: BackupMenuProps) {
  const { backups, error } = useBackups(api, folder, refreshKey)
  const [open, setOpen] = useState(false)
  const count = backups?.length ?? 0
  return (
    <div className="backup-menu">
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {count > 0 ? t("shell.backupsCount", { count }) : t("shell.backups")}
      </Button>
      <Popover open={open} label={t("backups.title")} onClose={() => setOpen(false)}>
        <h3 className="popover-title">{t("backups.title")}</h3>
        <BackupList api={api} folder={folder} backups={backups} readError={error} capcutRunning={capcutRunning} writing={writing} onRestored={onRestored} />
      </Popover>
    </div>
  )
}
