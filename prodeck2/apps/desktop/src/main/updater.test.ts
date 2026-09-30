import { expect, test } from "vitest"
import { createUpdater, type UpdaterLike } from "./updater.ts"

function fakeUpdater() {
  const listeners = new Map<string, (arg: unknown) => void>()
  const calls: unknown[][] = []
  const updater: UpdaterLike & { emit(event: string, arg: unknown): void } = {
    autoDownload: false,
    setFeedURL: (options) => void calls.push(["setFeedURL", options]),
    checkForUpdates: async () => {
      calls.push(["checkForUpdates"])
      return null
    },
    quitAndInstall: () => void calls.push(["quitAndInstall"]),
    on: (event, listener) => {
      listeners.set(event, listener as (arg: unknown) => void)
      return updater
    },
    emit: (event, arg) => listeners.get(event)?.(arg),
  }
  return { updater, calls }
}

test("an unsigned build never loads the updater", async () => {
  let loaded = false
  const sent: unknown[] = []
  const updates = createUpdater({
    feedUrl: null,
    load: async () => {
      loaded = true
      return fakeUpdater().updater
    },
    send: (event) => sent.push(event),
  })
  await updates.start()
  expect(loaded).toBe(false)
  expect(updates.state()).toEqual({ state: "disabled" })
  expect(() => updates.install()).toThrow(/no update/)
})

test("with a feed, it checks, downloads in the background and reports when an update is ready", async () => {
  const { updater, calls } = fakeUpdater()
  const sent: unknown[] = []
  const updates = createUpdater({ feedUrl: "https://updates.example/BOXBLACK", load: async () => updater, send: (event) => sent.push(event) })
  await updates.start()
  expect(updater.autoDownload).toBe(true)
  expect(calls.slice(0, 2)).toEqual([["setFeedURL", { provider: "generic", url: "https://updates.example/BOXBLACK" }], ["checkForUpdates"]])
  expect(updates.state()).toEqual({ state: "idle" })

  updater.emit("update-available", { version: "0.2.0" })
  expect(updates.state()).toEqual({ state: "downloading", version: "0.2.0" })
  updater.emit("update-downloaded", { version: "0.2.0" })
  expect(updates.state()).toEqual({ state: "ready", version: "0.2.0" })
  expect(sent.at(-1)).toEqual({ type: "update", state: { state: "ready", version: "0.2.0" } })

  updates.install()
  expect(calls.at(-1)).toEqual(["quitAndInstall"])
})

test("a failed check is reported, not thrown, and the next check can still succeed", async () => {
  const { updater } = fakeUpdater()
  updater.checkForUpdates = async () => {
    throw new Error("net::ERR_INTERNET_DISCONNECTED")
  }
  const updates = createUpdater({ feedUrl: "https://updates.example/BOXBLACK", load: async () => updater, send: () => {} })
  await updates.start()
  expect(updates.state()).toEqual({ state: "error", message: "net::ERR_INTERNET_DISCONNECTED" })
  updater.emit("error", new Error("signature mismatch"))
  expect(updates.state()).toEqual({ state: "error", message: "signature mismatch" })
})

test("an update that is ready stays ready when a later check fails, and a check that finds nothing clears an old error", async () => {
  const { updater } = fakeUpdater()
  const updates = createUpdater({ feedUrl: "https://updates.example/BOXBLACK", load: async () => updater, send: () => {} })
  await updates.start()
  updater.emit("update-downloaded", { version: "0.2.0" })
  // six hours later, offline
  updater.checkForUpdates = async () => {
    throw new Error("net::ERR_INTERNET_DISCONNECTED")
  }
  await updates.check()
  updater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
  expect(updates.state()).toEqual({ state: "ready", version: "0.2.0" })
  expect(() => updates.install()).not.toThrow()

  const other = fakeUpdater()
  const fresh = createUpdater({ feedUrl: "https://updates.example/BOXBLACK", load: async () => other.updater, send: () => {} })
  await fresh.start()
  other.updater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
  other.updater.emit("update-not-available", { version: "0.1.1" })
  expect(fresh.state()).toEqual({ state: "idle" })
})

test("a downloaded update stays ready when a later check announces it again", async () => {
  // electron-updater says "update available" again on every check until the app restarts
  const { updater } = fakeUpdater()
  const updates = createUpdater({ feedUrl: "https://updates.example/BOXBLACK", load: async () => updater, send: () => {} })
  await updates.start()
  updater.emit("update-downloaded", { version: "0.2.0" })
  updater.emit("update-available", { version: "0.2.0" })
  updater.emit("error", new Error("net::ERR_CONNECTION_RESET"))
  expect(updates.state()).toEqual({ state: "ready", version: "0.2.0" })
  // a newer one than the one waiting is news, and is downloaded
  updater.emit("update-available", { version: "0.3.0" })
  expect(updates.state()).toEqual({ state: "downloading", version: "0.3.0" })
})
