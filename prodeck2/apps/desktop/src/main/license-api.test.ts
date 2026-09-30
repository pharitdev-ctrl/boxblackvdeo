import { expect, test } from "vitest"
import type { DesktopApi } from "../shared/api.ts"
import { createLicenseApi, gateApi, LICENSED_METHODS, noLicenseApi } from "./license-api.ts"
import { LicenseRequiredError, type LicenseService } from "./license.ts"

test("the work that needs a license: analysing, planning, cutting, subtitling, highlight text, writing and editing graphics, and writing the draft", () => {
  expect([...LICENSED_METHODS].sort()).toEqual([
    "editGraphic",
    "planEmphasis",
    "planOutline",
    "planPost",
    "previewCut",
    "previewHighlights",
    "previewSubtitles",
    "redoGraphic",
    "regenerateOutline",
    "rethinkPost",
    "reviseOutline",
    "startAnalysis",
    "writeTimeline",
  ])
})

test("without a license those methods are refused before they run; everything else still works", async () => {
  const ran: string[] = []
  const api = Object.fromEntries(
    ["startAnalysis", "writeTimeline", "listProjects", "restoreBackup", "getSettings"].map((name) => [
      name,
      async () => {
        ran.push(name)
        return name
      },
    ]),
  ) as unknown as DesktopApi
  let licensed = false
  const gated = gateApi(api, async () => {
    if (!licensed) throw new LicenseRequiredError()
  })

  await expect(gated.startAnalysis("/p", ["a"])).rejects.toThrow("license-required")
  await expect(gated.writeTimeline("/p", { preset: "normal", cutFillers: true, cutRetakes: true, cutBadPicture: true }, 0, null, null)).rejects.toThrow("license-required")
  expect(await gated.listProjects()).toBe("listProjects")
  expect(await gated.restoreBackup("/p", "b")).toBe("restoreBackup")
  expect(ran).toEqual(["listProjects", "restoreBackup"])

  licensed = true
  expect(await gated.startAnalysis("/p", ["a"])).toBe("startAnalysis")
})

test("license requests go to the license service; a key that cannot be one is refused without a request", async () => {
  const calls: unknown[][] = []
  const license = {
    state: async () => ({ state: "unlicensed" }),
    activate: async (key: string) => {
      calls.push(["activate", key])
      return { ok: false, error: "invalid-key" }
    },
    refresh: async () => {
      calls.push(["refresh"])
      return { state: "unlicensed" }
    },
    deactivate: async () => {
      calls.push(["deactivate"])
      return { ok: true }
    },
  } as unknown as LicenseService
  const api = createLicenseApi({ license })
  expect(await api.licenseState()).toEqual({ state: "unlicensed" })
  expect(await api.activateLicense("PD2-AAAAA")).toEqual({ ok: false, error: "invalid-key" })
  expect(await api.activateLicense("")).toEqual({ ok: false, error: "bad-request" })
  expect(await api.activateLicense("x".repeat(101))).toEqual({ ok: false, error: "bad-request" })
  expect(await api.activateLicense(42 as never)).toEqual({ ok: false, error: "bad-request" })
  await api.refreshLicense()
  expect(await api.deactivateLicense()).toEqual({ ok: true })
  expect(calls).toEqual([["activate", "PD2-AAAAA"], ["refresh"], ["deactivate"]])
})

test("a build without licensing says so, and takes no key, since there is nowhere to send one", async () => {
  const api = noLicenseApi()
  expect(await api.licenseState()).toEqual({ state: "not-required" })
  expect(await api.refreshLicense()).toEqual({ state: "not-required" })
  expect(await api.deactivateLicense()).toEqual({ ok: true })
  expect(await api.activateLicense("BBX-AAAAA")).toEqual({ ok: false, error: "bad-request" })
})
