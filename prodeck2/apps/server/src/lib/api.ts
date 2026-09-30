import { randomUUID } from "node:crypto"
import { issueClaims, signLicenseToken } from "@boxblack/core/license"
import {
  ActivateRequestSchema,
  DeactivateRequestSchema,
  RefreshRequestSchema,
  type GrantResponse,
  type LicenseErrorCode,
} from "@boxblack/core/license/protocol"
import { getConfig } from "./config-store.ts"
import type { Db } from "./db.ts"
import { generateDeviceSecret, hashLicenseKey, hashSecret } from "./keys.ts"
import { licenseFromRow, type License } from "./licenses.ts"
import { allow } from "./rate-limit.ts"

export interface ApiDeps {
  db: Db
  /** Ed25519 private key, PKCS#8 PEM */
  signingKey: string
  now: () => number
}

export interface ApiResult {
  status: number
  body: GrantResponse | { ok: true } | { error: LicenseErrorCode }
}

const fail = (status: number, error: LicenseErrorCode): ApiResult => ({ status, body: { error } })

const TEN_MINUTES = 10 * 60_000
/** Keys cannot be guessed at 100 bits, but a stolen list of hashes or a buggy client should not hammer the database. */
const ACTIVATE_LIMIT = { limit: 10, windowMs: TEN_MINUTES }
const REFRESH_LIMIT = { limit: 60, windowMs: TEN_MINUTES }

async function liveDevices(db: Db, licenseId: string): Promise<number> {
  const [row] = await db.query<{ count: number }>("select count(*)::int as count from activations where license_id = $1 and released_at is null", [licenseId])
  return row?.count ?? 0
}

async function grant(db: Db, deps: ApiDeps, license: License, deviceId: string, deviceSecret?: string): Promise<ApiResult> {
  const now = deps.now()
  const claims = issueClaims({ licenseId: license.id, deviceId, plan: license.plan, licenseExpiresAt: license.expiresAt, now })
  const body: GrantResponse = {
    token: signLicenseToken(claims, deps.signingKey),
    license: {
      customer: license.customer,
      plan: license.plan,
      expiresAt: license.expiresAt,
      maxDevices: license.maxDevices,
      devicesUsed: await liveDevices(db, license.id),
    },
    config: await getConfig(db),
    ...(deviceSecret ? { deviceSecret } : {}),
  }
  return { status: 200, body }
}

function refusal(license: License, now: number): ApiResult | null {
  if (license.revokedAt !== null) return fail(403, "revoked")
  if (license.expiresAt <= now) return fail(403, "expired")
  return null
}

export async function handleActivate(deps: ApiDeps, input: unknown, ip: string): Promise<ApiResult> {
  const parsed = ActivateRequestSchema.safeParse(input)
  if (!parsed.success) return fail(400, "bad-request")
  const now = deps.now()
  if (!(await allow(deps.db, `activate:${ip}`, { ...ACTIVATE_LIMIT, now }))) return fail(429, "rate-limited")
  const { key, device } = parsed.data

  // the row lock makes two devices activating at once count seats one after the other
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.query<Parameters<typeof licenseFromRow>[0]>("select * from licenses where key_hash = $1 for update", [hashLicenseKey(key)])
    if (!row) return fail(404, "invalid-key")
    const license = licenseFromRow(row)
    const refused = refusal(license, now)
    if (refused) return refused

    const secret = generateDeviceSecret()
    const [existing] = await tx.query<{ id: string }>(
      "select id from activations where license_id = $1 and device_id = $2 and released_at is null",
      [license.id, device.id],
    )
    if (existing) {
      // same machine activating again (reinstall, lost secret): same seat, new secret
      await tx.query(
        "update activations set secret_hash = $2, device_name = $3, platform = $4, app_version = $5, last_seen_at = $6 where id = $1",
        [existing.id, hashSecret(secret), device.name, device.platform, device.appVersion, new Date(now)],
      )
    } else {
      if ((await liveDevices(tx, license.id)) >= license.maxDevices) return fail(403, "device-limit")
      await tx.query(
        `insert into activations (id, license_id, device_id, device_name, platform, app_version, secret_hash, created_at, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [randomUUID(), license.id, device.id, device.name, device.platform, device.appVersion, hashSecret(secret), new Date(now)],
      )
    }
    return grant(tx, deps, license, device.id, secret)
  })
}

async function liveActivation(db: Db, deviceId: string, deviceSecret: string) {
  const [row] = await db.query<Parameters<typeof licenseFromRow>[0] & { activation_id: string }>(
    `select l.*, a.id as activation_id from activations a join licenses l on l.id = a.license_id
     where a.secret_hash = $1 and a.device_id = $2 and a.released_at is null`,
    [hashSecret(deviceSecret), deviceId],
  )
  return row ? { activationId: row.activation_id, license: licenseFromRow(row) } : null
}

export async function handleRefresh(deps: ApiDeps, input: unknown, ip: string): Promise<ApiResult> {
  const parsed = RefreshRequestSchema.safeParse(input)
  if (!parsed.success) return fail(400, "bad-request")
  const now = deps.now()
  if (!(await allow(deps.db, `refresh:${ip}`, { ...REFRESH_LIMIT, now }))) return fail(429, "rate-limited")

  const found = await liveActivation(deps.db, parsed.data.deviceId, parsed.data.deviceSecret)
  if (!found) return fail(401, "not-activated")
  const refused = refusal(found.license, now)
  if (refused) return refused
  await deps.db.query("update activations set last_seen_at = $2, app_version = $3 where id = $1", [found.activationId, new Date(now), parsed.data.appVersion])
  return grant(deps.db, deps, found.license, parsed.data.deviceId)
}

export async function handleDeactivate(deps: ApiDeps, input: unknown, ip: string): Promise<ApiResult> {
  const parsed = DeactivateRequestSchema.safeParse(input)
  if (!parsed.success) return fail(400, "bad-request")
  const now = deps.now()
  if (!(await allow(deps.db, `refresh:${ip}`, { ...REFRESH_LIMIT, now }))) return fail(429, "rate-limited")

  const found = await liveActivation(deps.db, parsed.data.deviceId, parsed.data.deviceSecret)
  if (!found) return fail(401, "not-activated")
  await deps.db.query("update activations set released_at = $2 where id = $1", [found.activationId, new Date(now)])
  return { status: 200, body: { ok: true } }
}
