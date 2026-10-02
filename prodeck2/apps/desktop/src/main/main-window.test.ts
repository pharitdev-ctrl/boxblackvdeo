import { expect, test } from "vitest"
import type { AppEvent } from "../shared/api.ts"
import { sendTo } from "./main-window.ts"

/** A fake of a window: whether it and its page are gone, and what was sent to its page. */
function fakeWindow(gone: { window?: boolean; page?: boolean } = {}) {
  const sent: [string, unknown][] = []
  return {
    sent,
    isDestroyed: () => gone.window ?? false,
    webContents: {
      isDestroyed: () => gone.page ?? false,
      send: (channel: string, event: unknown) => {
        if (gone.page) throw new Error("Object has been destroyed")
        sent.push([channel, event])
      },
    },
  }
}

const EVENT: AppEvent = { type: "graphics", folder: "/p", state: "done" }

test("an event goes to the main window's page as app:event", () => {
  const main = fakeWindow()
  sendTo(main, EVENT)
  expect(main.sent).toEqual([["app:event", EVENT]])
})

test("with no main window, or one closed, an event goes nowhere and nothing throws", () => {
  expect(() => sendTo(null, EVENT)).not.toThrow()
  const closed = fakeWindow({ window: true })
  sendTo(closed, EVENT)
  expect(closed.sent).toEqual([])
  const closing = fakeWindow({ page: true })
  expect(() => sendTo(closing, EVENT)).not.toThrow()
  expect(closing.sent).toEqual([])
})
