import { useEffect, useState } from "react"
import type { BackupInfo, DesktopApi } from "../../../shared/api.ts"
import { formatDate, formatDuration } from "../format.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"

type BackupsApi = Pick<DesktopApi, "listBackups" | "restoreBackup">

const dateOf = (backup: BackupInfo) => formatDate(Date.parse(backup.createdAt) * 1000)

/** The draft's backups, read again whenever the key changes; null until the first answer. */
export function useBackups(api: BackupsApi, folder: string, refreshKey: number): { backups: BackupInfo[] | null; error: string | null } {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api.listBackups(folder).then(
      (list) => {
        if (!alive) return
        setBackups(list)
        setError(null)
      },
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [api, folder, refreshKey])
  return { backups, error }
}

export interface BackupListProps {
  api: BackupsApi
  folder: string
  /** the draft's backups as `useBackups` read them, and why they could not be read */
  backups: BackupInfo[] | null
  readError: string | null
  capcutRunning: boolean | null
  /** a write to this draft is running: the main process would refuse to put a backup back */
  writing: boolean
  onRestored: () => void
}

/**
 * The draft's backups, newest first, each put back after a second look: the bar's menu and the write
 * page both show this list. A backup is put back only while CapCut is known to be closed and no write
 * runs, the second look's button included, since either can change while it is open.
 */
export function BackupList({ api, folder, backups, readError, capcutRunning, writing, onRestored }: BackupListProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restored, setRestored] = useState<BackupInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shut = capcutRunning !== false || writing

  const restore = async (backup: BackupInfo) => {
    setRestoring(true)
    setError(null)
    try {
      await api.restoreBackup(folder, backup.id)
      setConfirming(null)
      setRestored(backup)
      onRestored()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRestoring(false)
    }
  }

  const failure = error ?? readError
  return (
    <>
      {failure && <p className="danger-text">{t("error.generic", { message: failure })}</p>}
      {restored && <p className="ok-text">{t("backups.restored", { date: dateOf(restored) })}</p>}
      {writing && <p className="hint">{t("backups.writing")}</p>}
      {backups?.length === 0 && <p className="hint">{t("backups.empty")}</p>}
      {backups && backups.length > 0 && (
        <ul className="backup-list">
          {backups.map((backup) => (
            <li key={backup.id} className="backup-row">
              <span>
                {backup.segmentCount === 0
                  ? t("backups.itemEmpty", { date: dateOf(backup) })
                  : t("backups.item", { date: dateOf(backup), duration: formatDuration(backup.durationUs), count: backup.segmentCount })}
              </span>
              {confirming === backup.id ? (
                <div className="backup-confirm">
                  <p>{t("backups.confirmRestore")}</p>
                  <div className="backup-confirm-actions">
                    <Button size="sm" disabled={restoring} onClick={() => setConfirming(null)}>
                      {t("backups.cancel")}
                    </Button>
                    <Button size="sm" variant="primary" disabled={restoring || shut} onClick={() => void restore(backup)}>
                      {t("backups.confirm")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" disabled={shut} onClick={() => setConfirming(backup.id)}>
                  {t("backups.restore")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
