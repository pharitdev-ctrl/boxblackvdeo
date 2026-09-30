import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import type { Db } from "./db.ts"
import { hashLicenseKey, hashSecret } from "./keys.ts"
import { createLicense, getLicense, listLicenses, releaseActivation, renewLicense, setRevoked, updateLicense } from "./licenses.ts"
import { testDb } from "./test-db.ts"

let db: Db
let reset: () => Promise<void>
let close: () => Promise<void>
beforeAll(async () => ({ db, reset, close } = await testDb()))
beforeEach(() => reset())
afterAll(() => close())

const NOW = Date.parse("2026-09-17T10:00:00Z")
const DAY = 86_400_000
const input = { customer: "ร้านเล็บสวย", email: "nail@example.com", plan: "monthly" as const, expiresAt: NOW + 30 * DAY, maxDevices: 2, note: "" }

async function addActivation(licenseId: string, deviceId: string, releasedAt: number | null = null) {
  await db.query(
    "insert into activations (id, license_id, device_id, device_name, platform, app_version, secret_hash, created_at, last_seen_at, released_at) values ($1, $2, $3, 'Mac', 'darwin', '0.1.0', $4, $5, $5, $6)",
    [`act-${deviceId}`, licenseId, deviceId, hashSecret(`secret-${deviceId}`), new Date(NOW), releasedAt === null ? null : new Date(releasedAt)],
  )
}

test("a new license's key is handed back once; the database keeps only its hash and last group", async () => {
  const { license, key } = await createLicense(db, input, NOW)
  expect(key).toMatch(/^PD2-/)
  expect(license).toMatchObject({ customer: "ร้านเล็บสวย", plan: "monthly", expiresAt: NOW + 30 * DAY, maxDevices: 2, revokedAt: null, keyHint: key.slice(-5) })
  const [row] = await db.query<Record<string, unknown>>("select * from licenses")
  expect(JSON.stringify(row)).not.toContain(key.slice(4))
  expect(row!.key_hash).toBe(hashLicenseKey(key))
})

test("the list shows each license's state and how many devices are in use, newest first", async () => {
  const active = (await createLicense(db, input, NOW)).license
  const expired = (await createLicense(db, { ...input, customer: "หมดอายุ", expiresAt: NOW - DAY }, NOW + 1)).license
  const revoked = (await createLicense(db, { ...input, customer: "ถูกระงับ" }, NOW + 2)).license
  await setRevoked(db, revoked.id, true, NOW + 3)
  await addActivation(active.id, "a".repeat(32))
  await addActivation(active.id, "b".repeat(32), NOW)

  const list = await listLicenses(db, { now: NOW })
  expect(list.map((l) => [l.customer, l.status, l.devicesUsed])).toEqual([
    ["ถูกระงับ", "revoked", 0],
    ["หมดอายุ", "expired", 0],
    ["ร้านเล็บสวย", "active", 1],
  ])
  expect((await listLicenses(db, { now: NOW, search: "nail@" })).map((l) => l.id)).toEqual([revoked.id, expired.id, active.id])
  expect((await listLicenses(db, { now: NOW, search: "หมด" })).map((l) => l.id)).toEqual([expired.id])
  expect((await listLicenses(db, { now: NOW, search: active.keyHint.toLowerCase() })).map((l) => l.id)).toContain(active.id)
})

test("a license shows its devices in use first, then released ones", async () => {
  const { license } = await createLicense(db, input, NOW)
  await addActivation(license.id, "a".repeat(32), NOW + 5)
  await addActivation(license.id, "b".repeat(32))
  const detail = await getLicense(db, license.id, NOW)
  expect(detail?.activations.map((a) => [a.deviceId, a.releasedAt])).toEqual([
    ["b".repeat(32), null],
    ["a".repeat(32), NOW + 5],
  ])
  expect(detail?.devicesUsed).toBe(1)
  expect(await getLicense(db, "missing", NOW)).toBeNull()
})

test("renewing, revoking, restoring and editing a license", async () => {
  const { license } = await createLicense(db, input, NOW)
  await renewLicense(db, license.id, NOW + 365 * DAY)
  await updateLicense(db, license.id, { customer: "ร้านใหม่", email: "", plan: "yearly", maxDevices: 3, note: "จ่ายแล้ว" })
  await setRevoked(db, license.id, true, NOW)
  let detail = await getLicense(db, license.id, NOW)
  expect(detail).toMatchObject({ customer: "ร้านใหม่", plan: "yearly", maxDevices: 3, note: "จ่ายแล้ว", expiresAt: NOW + 365 * DAY, revokedAt: NOW, status: "revoked" })
  await setRevoked(db, license.id, false, NOW)
  detail = await getLicense(db, license.id, NOW)
  expect(detail).toMatchObject({ revokedAt: null, status: "active" })
})

test("releasing a device frees its seat and records when", async () => {
  const { license } = await createLicense(db, input, NOW)
  await addActivation(license.id, "a".repeat(32))
  await releaseActivation(db, license.id, `act-${"a".repeat(32)}`, NOW + 9)
  const detail = await getLicense(db, license.id, NOW)
  expect(detail?.devicesUsed).toBe(0)
  expect(detail?.activations[0]?.releasedAt).toBe(NOW + 9)
})

test("license input is checked", async () => {
  await expect(createLicense(db, { ...input, customer: " " }, NOW)).rejects.toThrow(/customer/)
  await expect(createLicense(db, { ...input, maxDevices: 0 }, NOW)).rejects.toThrow(/devices/)
})
