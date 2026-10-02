import type { AppEvent } from "../shared/api.ts"

/** What sending an event asks of a window: Electron's BrowserWindow has all of it. */
interface EventWindow {
  isDestroyed(): boolean
  webContents: { isDestroyed(): boolean; send(channel: string, ...args: unknown[]): void }
}

/**
 * Sends an event of the app's to its main window, and to no other: the hidden page sounds are rendered in is a window
 * too, and gets none. With no main window, or one closed or closing, the event goes nowhere.
 */
export function sendTo(window: EventWindow | null, event: AppEvent): void {
  if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send("app:event", event)
}
