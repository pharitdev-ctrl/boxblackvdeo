import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { DEFAULT_REMOTE_CONFIG } from "@boxblack/core/license/protocol"
import { verifyLicenseToken } from "@boxblack/core/license"
import { handleActivate, handleDeactivate, handleRefresh, type ApiDeps } from "./api.ts"
import { saveConfig } from "./config-store.ts"
import type { Db } from "./db.ts"
import { createLicense, getLicense, releaseActivation, setRevoked } from "./licenses.ts"
import { testDb } from "./test-db.ts"

const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const PRIVATE = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const PUBLIC = publicKey.export({ type: "spki", format: "pem" }).toString()

const NOW = Date.parse("2026-09-17T10:00:00Z")
const DAY = 86_400_000

let db: Db
let reset: () => Promise<void>
let close: () => Promise<void>
let clock = NOW
beforeAll(async () => ({ db, reset, close } = await testDb()))
beforeEach(async () => {
  await reset()
  clock = NOW
})
afterAll(() => close())

const deps = (): ApiDeps => ({ db, signingKey: PRIVATE, now: () => clock })
const device = (id: string) => ({ id: id.repeat(32), name: `Mac ${id}`, platform: "darwin", appVersion: "0.1.0" })
const IP = "203.0.113.7"

async function license(extra: Partial<Parameters<typeof createLicense>[1]> = {}) {
  return createLicense(db, { customer: "ร้านเล็บสวย", email: "", plan: "monthly", expiresAt: NOW + 30 * DAY, maxDevices: 2, note: "", ...extra }, NOW)
}

test("activating binds the device and grants a signed token, the license, the config and a device secret", async () => {
  const { key, license: created } = await license()
  const { status, body } = await handleActivate(deps(), { key, device: device("a") }, IP)
  expect(status).toBe(200)
  const grant = body as { token: string; deviceSecret: string; license: object; config: object }
  expect(verifyLicenseToken(grant.token, PUBLIC)).toMatchObject({ licenseId: created.id, deviceId: "a".repeat(32), plan: "monthly", licenseExpiresAt: NOW + 30 * DAY })
  expect(grant.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(grant.license).toEqual({ customer: "ร้านเล็บสวย", plan: "monthly", expiresAt: NOW + 30 * DAY, maxDevices: 2, devicesUsed: 1 })
  expect(grant.config).toEqual(DEFAULT_REMOTE_CONFIG)
  const detail = await getLicense(db, created.id, NOW)
  expect(detail?.activations.map((a) => [a.deviceId, a.deviceName, a.appVersion])).toEqual([["a".repeat(32), "Mac a", "0.1.0"]])
})

test("the key can be typed in any case, with or without dashes", async () => {
  const { key } = await license()
  const { status } = await handleActivate(deps(), { key: key.toLowerCase().replaceAll("-", " "), device: device("a") }, IP)
  expect(status).toBe(200)
})

test("activating the same device again keeps one seat and replaces its secret", async () => {
  const { key, license: created } = await license()
  const first = (await handleActivate(deps(), { key, device: device("a") }, IP)).body as { deviceSecret: string }
  const second = await handleActivate(deps(), { key, device: device("a") }, IP)
  expect((second.body as { license: { devicesUsed: number } }).license.devicesUsed).toBe(1)
  expect((await getLicense(db, created.id, NOW))?.activations).toHaveLength(1)
  const stale = await handleRefresh(deps(), { deviceId: "a".repeat(32), deviceSecret: first.deviceSecret, appVersion: "0.1.0" }, IP)
  expect(stale).toEqual({ status: 401, body: { error: "not-activated" } })
})

test("a third device is refused while two are in use", async () => {
  const { key, license: created } = await license()
  await handleActivate(deps(), { key, device: device("a") }, IP)
  await handleActivate(deps(), { key, device: device("b") }, IP)
  expect(await handleActivate(deps(), { key, device: device("c") }, IP)).toEqual({ status: 403, body: { error: "device-limit" } })
  expect((await getLicense(db, created.id, NOW))?.activations).toHaveLength(2)
})

test("unknown, revoked and expired keys are refused", async () => {
  expect(await handleActivate(deps(), { key: "PD2-AAAAA-AAAAA-AAAAA-AAAAA", device: device("a") }, IP)).toEqual({ status: 404, body: { error: "invalid-key" } })
  const revoked = await license()
  await setRevoked(db, revoked.license.id, true, NOW)
  expect(await handleActivate(deps(), { key: revoked.key, device: device("a") }, IP)).toEqual({ status: 403, body: { error: "revoked" } })
  const expired = await license({ expiresAt: NOW - 1 })
  expect(await handleActivate(deps(), { key: expired.key, device: device("a") }, IP)).toEqual({ status: 403, body: { error: "expired" } })
})

test("malformed requests are refused", async () => {
  expect(await handleActivate(deps(), { key: "x" }, IP)).toEqual({ status: 400, body: { error: "bad-request" } })
  expect(await handleRefresh(deps(), null, IP)).toEqual({ status: 400, body: { error: "bad-request" } })
  expect(await handleDeactivate(deps(), { deviceId: "zz" }, IP)).toEqual({ status: 400, body: { error: "bad-request" } })
})

test("refreshing with the device secret grants a new token and the current config", async () => {
  const { key } = await license()
  const { deviceSecret } = (await handleActivate(deps(), { key, device: device("a") }, IP)).body as { deviceSecret: string }
  await saveConfig(db, { ...DEFAULT_REMOTE_CONFIG, capcutVersions: ["9.4.0", "9.5.0"] })
  clock = NOW + DAY
  const { status, body } = await handleRefresh(deps(), { deviceId: "a".repeat(32), deviceSecret, appVersion: "0.2.0" }, IP)
  expect(status).toBe(200)
  const grant = body as { token: string; deviceSecret?: string; config: { capcutVersions: string[] } }
  expect(verifyLicenseToken(grant.token, PUBLIC)?.issuedAt).toBe(NOW + DAY)
  expect(grant.deviceSecret).toBeUndefined()
  expect(grant.config.capcutVersions).toEqual(["9.4.0", "9.5.0"])
})

test("refreshing fails once the device is released, the license revoked or expired, or with a wrong secret", async () => {
  const { key, license: created } = await license()
  const { deviceSecret } = (await handleActivate(deps(), { key, device: device("a") }, IP)).body as { deviceSecret: string }
  const refresh = (secret = deviceSecret, id = "a".repeat(32)) => handleRefresh(deps(), { deviceId: id, deviceSecret: secret, appVersion: "0.1.0" }, IP)

  expect(await refresh("wrong")).toEqual({ status: 401, body: { error: "not-activated" } })
  expect(await refresh(deviceSecret, "b".repeat(32))).toEqual({ status: 401, body: { error: "not-activated" } })

  await setRevoked(db, created.id, true, NOW)
  expect(await refresh()).toEqual({ status: 403, body: { error: "revoked" } })
  await setRevoked(db, created.id, false, NOW)

  clock = NOW + 31 * DAY
  expect(await refresh()).toEqual({ status: 403, body: { error: "expired" } })
  clock = NOW

  const [activation] = (await getLicense(db, created.id, NOW))!.activations
  await releaseActivation(db, created.id, activation!.id, NOW)
  expect(await refresh()).toEqual({ status: 401, body: { error: "not-activated" } })
})

test("deactivating frees the seat for another device", async () => {
  const { key } = await license({ maxDevices: 1 })
  const { deviceSecret } = (await handleActivate(deps(), { key, device: device("a") }, IP)).body as { deviceSecret: string }
  expect((await handleActivate(deps(), { key, device: device("b") }, IP)).status).toBe(403)
  expect(await handleDeactivate(deps(), { deviceId: "a".repeat(32), deviceSecret }, IP)).toEqual({ status: 200, body: { ok: true } })
  expect((await handleActivate(deps(), { key, device: device("b") }, IP)).status).toBe(200)
})

test("too many activation attempts from one address are slowed down", async () => {
  for (let i = 0; i < 10; i++) await handleActivate(deps(), { key: `PD2-WRONG-${i}`, device: device("a") }, IP)
  expect(await handleActivate(deps(), { key: "PD2-WRONG-X", device: device("a") }, IP)).toEqual({ status: 429, body: { error: "rate-limited" } })
  expect((await handleActivate(deps(), { key: "PD2-WRONG-X", device: device("a") }, "198.51.100.1")).status).toBe(404)
  clock = NOW + 11 * 60_000
  expect((await handleActivate(deps(), { key: "PD2-WRONG-X", device: device("a") }, IP)).status).toBe(404)
})
