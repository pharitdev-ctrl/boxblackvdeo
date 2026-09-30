import { readFile, rm } from "node:fs/promises"
import { writeFileAtomic } from "@boxblack/core/atomic-write"
import { checkClaims, verifyLicenseToken } from "@boxblack/core/license"
import {
  DEFAULT_REMOTE_CONFIG,
  ErrorResponseSchema,
  GrantResponseSchema,
  RemoteConfigSchema,
  LicenseInfoSchema,
  type GrantResponse,
  type LicenseInfo,
  type RemoteConfig,
} from "@boxblack/core/license/protocol"
import { z } from "zod"
import type { ActivationError, LicenseBlockReason, LicenseState } from "../shared/api.ts"
import type { SecretBox } from "./settings.ts"

export interface LicenseDeps {
  serverUrl: string
  /** Ed25519 public key (SPKI PEM) matching the server's signing key */
  publicKey: string
  file: string
  box: SecretBox
  deviceId: () => Promise<string>
  device: { name: string; platform: string; appVersion: string }
  fetch?: typeof fetch
  now?: () => number
  onChange?: (state: LicenseState) => void
}

export class LicenseRequiredError extends Error {
  constructor() {
    super("license-required")
    this.name = "LicenseRequiredError"
  }
}

const StoredSchema = z.object({
  token: z.string(),
  /** the device secret, encrypted with the OS keychain */
  secret: z.string(),
  license: LicenseInfoSchema,
  config: RemoteConfigSchema,
  /** latest time this machine has been seen at; a clock earlier than this was set back */
  lastSeenAt: z.number(),
  offline: z.boolean(),
  blocked: z.enum(["revoked", "expired", "not-activated"]).nullable(),
})

type Stored = z.infer<typeof StoredSchema>

/** How far the clock may go backwards (time zone changes, NTP corrections) before it counts as set back. */
const CLOCK_TOLERANCE_MS = 10 * 60_000
const REQUEST_TIMEOUT_MS = 15_000

type Reply = { kind: "grant"; grant: GrantResponse } | { kind: "ok" } | { kind: "refused"; error: ActivationError }

export function createLicenseService(deps: LicenseDeps) {
  const now = deps.now ?? Date.now
  const fetcher = deps.fetch ?? fetch

  async function load(): Promise<Stored | null> {
    try {
      const parsed = StoredSchema.safeParse(JSON.parse(await readFile(deps.file, "utf8")))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  // checks run side by side (a preview and its subtitles) and each may record the time
  const save = (stored: Stored) => writeFileAtomic(deps.file, JSON.stringify(stored), { mode: 0o600 })

  async function post(path: string, body: unknown): Promise<Reply> {
    let response: Response
    try {
      response = await fetcher(new URL(path, deps.serverUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      return { kind: "refused", error: "offline" }
    }
    const json: unknown = await response.json().catch(() => null)
    if (response.ok) {
      const grant = GrantResponseSchema.safeParse(json)
      if (grant.success) return { kind: "grant", grant: grant.data }
      return (json as { ok?: unknown } | null)?.ok === true ? { kind: "ok" } : { kind: "refused", error: "server-error" }
    }
    const refusal = ErrorResponseSchema.safeParse(json)
    return { kind: "refused", error: refusal.success ? refusal.data.error : "server-error" }
  }

  async function evaluate(stored: Stored | null): Promise<LicenseState> {
    if (!stored) return { state: "unlicensed" }
    const claims = verifyLicenseToken(stored.token, deps.publicKey)
    // a token that no longer verifies was edited: treat the file as not there
    if (!claims) return { state: "unlicensed" }
    const blocked = (reason: LicenseBlockReason): LicenseState => ({ state: "blocked", reason, license: stored.license })
    if (stored.blocked) return blocked(stored.blocked)

    const time = now()
    if (time < stored.lastSeenAt - CLOCK_TOLERANCE_MS) return blocked("clock")
    if (time > stored.lastSeenAt + 60_000) await save({ ...stored, lastSeenAt: time })

    const check = checkClaims(claims, { now: time, deviceId: await deps.deviceId() })
    if (!check.ok) return blocked(check.reason === "license-expired" ? "expired" : check.reason)
    return { state: "active", license: stored.license, tokenExpiresAt: claims.expiresAt, offline: stored.offline }
  }

  const state = async () => evaluate(await load())

  async function changed(): Promise<LicenseState> {
    const next = await state()
    deps.onChange?.(next)
    return next
  }

  /** Checks a grant really is for this machine and signed by the server before anything is stored. */
  async function accept(grant: GrantResponse, secret: string, previous: Stored | null): Promise<boolean> {
    const claims = verifyLicenseToken(grant.token, deps.publicKey)
    if (!claims) return false
    const time = now()
    if (!checkClaims(claims, { now: time, deviceId: await deps.deviceId() }).ok) return false
    await save({
      token: grant.token,
      secret: deps.box.encryptString(secret).toString("base64"),
      license: grant.license,
      config: grant.config,
      lastSeenAt: Math.max(previous?.lastSeenAt ?? 0, time),
      offline: false,
      blocked: null,
    })
    return true
  }

  const secretOf = (stored: Stored) => deps.box.decryptString(Buffer.from(stored.secret, "base64"))

  async function refresh(): Promise<LicenseState> {
    const stored = await load()
    if (!stored) return state()
    const reply = await post("/api/v1/refresh", { deviceId: await deps.deviceId(), deviceSecret: secretOf(stored), appVersion: deps.device.appVersion })

    if (reply.kind === "grant") {
      if (!(await accept(reply.grant, secretOf(stored), stored))) await save({ ...stored, offline: true })
    } else if (reply.kind === "refused" && (reply.error === "revoked" || reply.error === "expired" || reply.error === "not-activated")) {
      // the server's word beats whatever time is left on the token
      await save({ ...stored, blocked: reply.error, offline: false })
    } else {
      // unreachable, rate limited or failing: carry on with the token for as long as it lasts
      await save({ ...stored, offline: true })
    }
    return changed()
  }

  return {
    state,

    async activate(key: string): Promise<{ ok: true; state: LicenseState } | { ok: false; error: ActivationError }> {
      if (deps.box.isEncryptionAvailable() === false) return { ok: false, error: "server-error" }
      const reply = await post("/api/v1/activate", {
        key: key.trim(),
        device: { id: await deps.deviceId(), ...deps.device },
      })
      if (reply.kind === "refused") return { ok: false, error: reply.error }
      if (reply.kind !== "grant" || !reply.grant.deviceSecret) return { ok: false, error: "server-error" }
      if (!(await accept(reply.grant, reply.grant.deviceSecret, await load()))) return { ok: false, error: "server-error" }
      return { ok: true, state: await changed() }
    },

    refresh,

    /** Refreshes when the token asks for it, or when only a refresh can unblock work. */
    async refreshIfDue(): Promise<void> {
      const stored = await load()
      if (!stored) return
      const current = await evaluate(stored)
      const claims = verifyLicenseToken(stored.token, deps.publicKey)
      const due = claims !== null && now() >= claims.refreshAfter
      if (current.state === "blocked" || due) await refresh()
    },

    async deactivate(): Promise<{ ok: true } | { ok: false; error: ActivationError }> {
      const stored = await load()
      if (stored) {
        const reply = await post("/api/v1/deactivate", { deviceId: await deps.deviceId(), deviceSecret: secretOf(stored) })
        // not-activated means the seat is already free
        if (reply.kind === "refused" && reply.error !== "not-activated") return { ok: false, error: reply.error }
      }
      await rm(deps.file, { force: true })
      await changed()
      return { ok: true }
    },

    async assertLicensed(): Promise<void> {
      if ((await state()).state !== "active") throw new LicenseRequiredError()
    },

    /** Settings from the server; the app's own defaults until a license has been activated. */
    async config(): Promise<RemoteConfig> {
      return (await load())?.config ?? DEFAULT_REMOTE_CONFIG
    },

    license: async (): Promise<LicenseInfo | null> => (await load())?.license ?? null,
  }
}

export type LicenseService = ReturnType<typeof createLicenseService>
