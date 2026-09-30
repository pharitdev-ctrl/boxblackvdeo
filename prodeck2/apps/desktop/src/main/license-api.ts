import type { DesktopApi } from "../shared/api.ts"
import type { LicenseService } from "./license.ts"

/** Methods that do the paid-for work. Browsing projects, settings and restoring backups stay open without a license. */
export const LICENSED_METHODS = [
  "startAnalysis",
  "planOutline",
  "regenerateOutline",
  "reviseOutline",
  "previewCut",
  "previewSubtitles",
  "previewHighlights",
  "planPost",
  "rethinkPost",
  "redoGraphic",
  "editGraphic",
  "planEmphasis",
  "writeTimeline",
] as const satisfies readonly (keyof DesktopApi)[]

/** Checked in the main process, so a renderer that skips the activation screen still cannot do the work. */
export function gateApi(api: DesktopApi, assertLicensed: () => Promise<void>): DesktopApi {
  const gated = { ...api }
  for (const method of LICENSED_METHODS) {
    const run = api[method] as (...args: unknown[]) => Promise<unknown>
    ;(gated as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      await assertLicensed()
      return run(...args)
    }
  }
  return gated
}

type LicenseApi = Pick<DesktopApi, "licenseState" | "activateLicense" | "refreshLicense" | "deactivateLicense">

export function createLicenseApi({ license }: { license: LicenseService }): LicenseApi {
  return {
    licenseState: () => license.state(),
    async activateLicense(key) {
      if (typeof key !== "string" || !key.trim() || key.length > 100) return { ok: false, error: "bad-request" }
      return license.activate(key)
    },
    refreshLicense: () => license.refresh(),
    deactivateLicense: () => license.deactivate(),
  }
}

/** The license methods of a build that asks for no license: the state says so, and no key is taken. */
export function noLicenseApi(): LicenseApi {
  const notRequired = async () => ({ state: "not-required" as const })
  return {
    licenseState: notRequired,
    async activateLicense() {
      return { ok: false, error: "bad-request" }
    },
    refreshLicense: notRequired,
    // no seat was taken, so there is none to free
    async deactivateLicense() {
      return { ok: true }
    },
  }
}
