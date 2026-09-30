import type { AppEvent, UpdateState } from "../shared/api.ts"

/** The part of electron-updater's autoUpdater this app uses; injected so tests need no Electron. */
export interface UpdaterLike {
  autoDownload: boolean
  setFeedURL(options: { provider: "generic"; url: string }): void
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: "update-available" | "update-downloaded" | "update-not-available", listener: (info: { version: string }) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
}

/**
 * Background updates from a static feed (latest-mac.yml plus the zip, e.g. on R2 or S3).
 * Squirrel.Mac only installs updates into a signed app, so builds without a Developer ID
 * signature are made without a feed URL and never load the updater.
 */
export function createUpdater(deps: { feedUrl: string | null; load: () => Promise<UpdaterLike>; send: (event: AppEvent) => void }) {
  let current: UpdateState = deps.feedUrl ? { state: "idle" } : { state: "disabled" }
  let updater: UpdaterLike | null = null

  const set = (next: UpdateState) => {
    current = next
    deps.send({ type: "update", state: next })
  }
  // a downloaded update stays installable whatever a later check runs into
  const failed = (message: string) => {
    if (current.state !== "ready") set({ state: "error", message })
  }

  async function check(): Promise<void> {
    try {
      await updater?.checkForUpdates()
    } catch (error) {
      failed((error as Error).message)
    }
  }

  return {
    state: () => current,

    async start(): Promise<void> {
      if (!deps.feedUrl) return
      updater = await deps.load()
      updater.autoDownload = true
      updater.setFeedURL({ provider: "generic", url: deps.feedUrl })
      updater.on("update-available", (info) => {
        // announced again on every check while it waits: the one already downloaded stays ready
        if (current.state === "ready" && current.version === info.version) return
        set({ state: "downloading", version: info.version })
      })
      updater.on("update-downloaded", (info) => set({ state: "ready", version: info.version }))
      updater.on("error", (error) => failed(error.message))
      // a check that went through and found nothing new: an earlier failure is over
      updater.on("update-not-available", () => {
        if (current.state === "error") set({ state: "idle" })
      })
      await check()
    },

    check,

    install(): void {
      if (!updater || current.state !== "ready") throw new Error("no update is ready to install")
      updater.quitAndInstall()
    },
  }
}

export type Updater = ReturnType<typeof createUpdater>
