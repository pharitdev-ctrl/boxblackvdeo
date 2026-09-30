import type { LicenseStatus, Plan } from "./licenses.ts"

export const STATUS_LABEL: Record<LicenseStatus, string> = { active: "ใช้งานได้", expired: "หมดอายุ", revoked: "ระงับแล้ว" }
export const PLAN_LABEL: Record<Plan, string> = { monthly: "รายเดือน", yearly: "รายปี" }
