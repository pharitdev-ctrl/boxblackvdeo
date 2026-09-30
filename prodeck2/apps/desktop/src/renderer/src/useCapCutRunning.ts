import { useEffect, useState } from "react"
import type { DesktopApi } from "../../shared/api.ts"

/** Polls the main process. null until the first answer, or when the check itself fails. */
export function useCapCutRunning(api: DesktopApi, pollMs: number): boolean | null {
  const [running, setRunning] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const status = await api.capcutStatus()
        if (alive) setRunning(status.running)
      } catch {
        if (alive) setRunning(null)
      }
    }
    void check()
    const timer = setInterval(check, pollMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [api, pollMs])
  return running
}
