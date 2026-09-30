import { randomUUID } from "node:crypto"
import type { Db } from "./db.ts"
import { generateLicenseKey, hashLicenseKey, keyHint } from "./keys.ts"

export type Plan = "monthly" | "yearly"
export type LicenseStatus = "active" | "expired" | "revoked"

export interface License {
  id: string
  keyHint: string
  customer: string
  email: string
  plan: Plan
  maxDevices: number
  /** milliseconds since the epoch */
  expiresAt: number
  revokedAt: number | null
  note: string
  createdAt: number
}

export interface LicenseSummary extends License {
  status: LicenseStatus
  devicesUsed: number
}

export interface Activation {
  id: string
  deviceId: string
  deviceName: string
  platform: string
  appVersion: string
  createdAt: number
  lastSeenAt: number
  releasedAt: number | null
}

export interface LicenseDetail extends LicenseSummary {
  activations: Activation[]
}

export interface LicenseInput {
  customer: string
  email: string
  plan: Plan
  expiresAt: number
  maxDevices: number
  note: string
}

interface LicenseRow {
  id: string
  key_hint: string
  customer: string
  email: string
  plan: Plan
  max_devices: number
  expires_at: Date
  revoked_at: Date | null
  note: string
  created_at: Date
  devices_used?: number
}

const ms = (date: Date | null) => (date === null ? null : new Date(date).getTime())

export function licenseFromRow(row: LicenseRow): License {
  return {
    id: row.id,
    keyHint: row.key_hint,
    customer: row.customer,
    email: row.email,
    plan: row.plan,
    maxDevices: row.max_devices,
    expiresAt: ms(row.expires_at)!,
    revokedAt: ms(row.revoked_at),
    note: row.note,
    createdAt: ms(row.created_at)!,
  }
}

export function statusOf(license: License, now: number): LicenseStatus {
  if (license.revokedAt !== null) return "revoked"
  return license.expiresAt <= now ? "expired" : "active"
}

function checkInput(input: Omit<LicenseInput, "expiresAt"> & { expiresAt?: number }): void {
  if (!input.customer.trim()) throw new Error("the customer name is empty")
  if (!["monthly", "yearly"].includes(input.plan)) throw new Error(`unknown plan "${input.plan}"`)
  if (!Number.isInteger(input.maxDevices) || input.maxDevices < 1 || input.maxDevices > 20) throw new Error("devices must be a whole number from 1 to 20")
  if (input.expiresAt !== undefined && !Number.isFinite(input.expiresAt)) throw new Error("the expiry date is not a date")
}

const LIVE_DEVICES = "(select count(*)::int from activations a where a.license_id = l.id and a.released_at is null)"

/** The key exists only in the return value; the database keeps its hash. */
export async function createLicense(db: Db, input: LicenseInput, now: number): Promise<{ license: License; key: string }> {
  checkInput(input)
  const key = generateLicenseKey()
  const [row] = await db.query<LicenseRow>(
    `insert into licenses (id, key_hash, key_hint, customer, email, plan, max_devices, expires_at, note, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [randomUUID(), hashLicenseKey(key), keyHint(key), input.customer.trim(), input.email.trim(), input.plan, input.maxDevices, new Date(input.expiresAt), input.note, new Date(now)],
  )
  return { license: licenseFromRow(row!), key }
}

export async function listLicenses(db: Db, options: { now: number; search?: string }): Promise<LicenseSummary[]> {
  const search = options.search?.trim() ?? ""
  const rows = await db.query<LicenseRow>(
    `select l.*, ${LIVE_DEVICES} as devices_used from licenses l
     where $1 = '' or l.customer ilike '%' || $1 || '%' or l.email ilike '%' || $1 || '%' or l.key_hint ilike '%' || $1 || '%'
     order by l.created_at desc`,
    [search],
  )
  return rows.map((row) => {
    const license = licenseFromRow(row)
    return { ...license, status: statusOf(license, options.now), devicesUsed: row.devices_used ?? 0 }
  })
}

interface ActivationRow {
  id: string
  device_id: string
  device_name: string
  platform: string
  app_version: string
  created_at: Date
  last_seen_at: Date
  released_at: Date | null
}

export async function getLicense(db: Db, id: string, now: number): Promise<LicenseDetail | null> {
  const [row] = await db.query<LicenseRow>(`select l.*, ${LIVE_DEVICES} as devices_used from licenses l where l.id = $1`, [id])
  if (!row) return null
  const activations = await db.query<ActivationRow>(
    "select * from activations where license_id = $1 order by released_at is not null, last_seen_at desc",
    [id],
  )
  const license = licenseFromRow(row)
  return {
    ...license,
    status: statusOf(license, now),
    devicesUsed: row.devices_used ?? 0,
    activations: activations.map((a) => ({
      id: a.id,
      deviceId: a.device_id,
      deviceName: a.device_name,
      platform: a.platform,
      appVersion: a.app_version,
      createdAt: ms(a.created_at)!,
      lastSeenAt: ms(a.last_seen_at)!,
      releasedAt: ms(a.released_at),
    })),
  }
}

export async function renewLicense(db: Db, id: string, expiresAt: number): Promise<void> {
  if (!Number.isFinite(expiresAt)) throw new Error("the expiry date is not a date")
  await db.query("update licenses set expires_at = $2 where id = $1", [id, new Date(expiresAt)])
}

export async function setRevoked(db: Db, id: string, revoked: boolean, now: number): Promise<void> {
  await db.query("update licenses set revoked_at = $2 where id = $1", [id, revoked ? new Date(now) : null])
}

export async function updateLicense(db: Db, id: string, input: Omit<LicenseInput, "expiresAt">): Promise<void> {
  checkInput(input)
  await db.query("update licenses set customer = $2, email = $3, plan = $4, max_devices = $5, note = $6 where id = $1", [
    id,
    input.customer.trim(),
    input.email.trim(),
    input.plan,
    input.maxDevices,
    input.note,
  ])
}

export async function releaseActivation(db: Db, licenseId: string, activationId: string, now: number): Promise<void> {
  await db.query("update activations set released_at = $3 where id = $2 and license_id = $1 and released_at is null", [licenseId, activationId, new Date(now)])
}
