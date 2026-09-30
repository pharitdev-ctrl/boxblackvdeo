import { execFile } from "node:child_process"

export type IsCapCutRunning = () => Promise<boolean>

export class CapCutRunningError extends Error {
  constructor() {
    super("CapCut is running — close CapCut before BOXBLACK changes a draft")
    this.name = "CapCutRunningError"
  }
}

/** macOS only for now: pgrep exits 0 when a process named exactly "CapCut" exists, 1 when none. */
export const isCapCutRunning: IsCapCutRunning = () =>
  new Promise((resolve, reject) => {
    execFile("pgrep", ["-x", "CapCut"], (error) => {
      if (!error) return resolve(true)
      if (error.code === 1) return resolve(false)
      reject(error)
    })
  })

export async function assertCapCutClosed(check: IsCapCutRunning = isCapCutRunning): Promise<void> {
  if (await check()) throw new CapCutRunningError()
}
