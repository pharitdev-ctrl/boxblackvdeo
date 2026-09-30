"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { verifyPassword } from "../../lib/admin-auth.ts"
import { extendExpiry, endOfDay, parseConfigForm, parseLicenseForm } from "../../lib/admin-forms.ts"
import { endSession, requireAdmin, startSession } from "../../lib/admin-session.ts"
import { saveConfig } from "../../lib/config-store.ts"
import { database } from "../../lib/database.ts"
import { serverEnv } from "../../lib/env.ts"
import { clientIp } from "../../lib/http.ts"
import { createLicense, getLicense, releaseActivation, renewLicense, setRevoked, updateLicense } from "../../lib/licenses.ts"
import { allow } from "../../lib/rate-limit.ts"

export type FormState = { error: string | null }
const text = (form: FormData, name: string) => String(form.get(name) ?? "")

export async function login(_state: FormState, form: FormData): Promise<FormState> {
  const db = await database()
  const ip = clientIp(await headers())
  if (!(await allow(db, `login:${ip}`, { limit: 5, windowMs: 15 * 60_000, now: Date.now() }))) {
    return { error: "ลองรหัสผ่านผิดหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่" }
  }
  if (!(await verifyPassword(text(form, "password"), serverEnv().adminPasswordHash))) return { error: "รหัสผ่านไม่ถูกต้อง" }
  await startSession()
  redirect("/admin")
}

export async function logout(): Promise<void> {
  await endSession()
  redirect("/admin/login")
}

export type CreateState = { error: string | null; created: { id: string; key: string; customer: string } | null }

/** The key is returned to the page once and never stored. */
export async function createLicenseAction(_state: CreateState, form: FormData): Promise<CreateState> {
  await requireAdmin()
  try {
    const { license, key } = await createLicense(await database(), parseLicenseForm(form, Date.now()), Date.now())
    revalidatePath("/admin")
    return { error: null, created: { id: license.id, key, customer: license.customer } }
  } catch (error) {
    return { error: (error as Error).message, created: null }
  }
}

async function licenseFromForm(form: FormData) {
  const license = await getLicense(await database(), text(form, "id"), Date.now())
  if (!license) throw new Error("license not found")
  return license
}

export async function updateLicenseAction(form: FormData): Promise<void> {
  await requireAdmin()
  const license = await licenseFromForm(form)
  const input = parseLicenseForm(form, Date.now())
  await updateLicense(await database(), license.id, input)
  revalidatePath(`/admin/licenses/${license.id}`)
}

export async function renewLicenseAction(form: FormData): Promise<void> {
  await requireAdmin()
  const license = await licenseFromForm(form)
  const by = text(form, "by")
  const expiresAt = by === "month" || by === "year" ? extendExpiry(license.expiresAt, Date.now(), by) : endOfDay(text(form, "expiresOn"))
  await renewLicense(await database(), license.id, expiresAt)
  revalidatePath(`/admin/licenses/${license.id}`)
}

export async function revokeLicenseAction(form: FormData): Promise<void> {
  await requireAdmin()
  const license = await licenseFromForm(form)
  await setRevoked(await database(), license.id, text(form, "revoke") === "true", Date.now())
  revalidatePath(`/admin/licenses/${license.id}`)
}

export async function releaseDeviceAction(form: FormData): Promise<void> {
  await requireAdmin()
  const license = await licenseFromForm(form)
  await releaseActivation(await database(), license.id, text(form, "activationId"), Date.now())
  revalidatePath(`/admin/licenses/${license.id}`)
}

export type ConfigState = { error: string | null; saved: boolean }

export async function saveConfigAction(_state: ConfigState, form: FormData): Promise<ConfigState> {
  await requireAdmin()
  try {
    await saveConfig(await database(), parseConfigForm(form))
    revalidatePath("/admin/config")
    return { error: null, saved: true }
  } catch (error) {
    return { error: (error as Error).message, saved: false }
  }
}
