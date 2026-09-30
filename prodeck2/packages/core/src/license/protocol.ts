import { z } from "zod"
import { CUT_PRESET_IDS, CUT_PRESETS } from "../cut/rules.ts"

/** Requests and responses between the app and the license server. Node-free: both sides import it. */

export function normalizeLicenseKey(key: string): string {
  return key.replace(/[\s-]/g, "").toUpperCase()
}

const CutPresetSchema = z.object({
  maxPauseUs: z.number().int().min(100_000).max(5_000_000),
  paddingUs: z.number().int().min(0).max(1_000_000),
})

/** Settings the server hands out with every token, so they can change without a new app release. */
export const RemoteConfigSchema = z.object({
  /** CapCut releases the draft writer has been verified against */
  capcutVersions: z.array(z.string().min(1)).max(50),
  cutPresets: z.object(Object.fromEntries(CUT_PRESET_IDS.map((id) => [id, CutPresetSchema])) as Record<(typeof CUT_PRESET_IDS)[number], typeof CutPresetSchema>),
  /** system prompts; null keeps the one built into the app */
  prompts: z.object({
    vision: z.string().min(1).max(20_000).nullable(),
    planner: z.string().min(1).max(20_000).nullable(),
  }),
})

export type RemoteConfig = z.infer<typeof RemoteConfigSchema>

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  capcutVersions: ["9.4.0"],
  cutPresets: CUT_PRESETS,
  prompts: { vision: null, planner: null },
}

const DeviceIdSchema = z.string().regex(/^[0-9a-f]{32,64}$/)

export const ActivateRequestSchema = z.object({
  key: z.string().trim().min(1).max(100),
  device: z.object({
    id: DeviceIdSchema,
    name: z.string().max(100),
    platform: z.string().max(40),
    appVersion: z.string().max(40),
  }),
})

export const RefreshRequestSchema = z.object({
  deviceId: DeviceIdSchema,
  deviceSecret: z.string().min(1).max(200),
  appVersion: z.string().max(40),
})

export const DeactivateRequestSchema = RefreshRequestSchema.pick({ deviceId: true, deviceSecret: true })

export type ActivateRequest = z.infer<typeof ActivateRequestSchema>
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>
export type DeactivateRequest = z.infer<typeof DeactivateRequestSchema>

export const LicenseInfoSchema = z.object({
  customer: z.string(),
  plan: z.enum(["monthly", "yearly"]),
  expiresAt: z.number(),
  maxDevices: z.number().int(),
  devicesUsed: z.number().int(),
})

export type LicenseInfo = z.infer<typeof LicenseInfoSchema>

export const GrantResponseSchema = z.object({
  token: z.string(),
  license: LicenseInfoSchema,
  config: RemoteConfigSchema,
  /** only on activation: the device's credential for refreshing, shown once */
  deviceSecret: z.string().optional(),
})

export type GrantResponse = z.infer<typeof GrantResponseSchema>

export const LICENSE_ERRORS = ["invalid-key", "revoked", "expired", "device-limit", "not-activated", "rate-limited", "bad-request", "server-error"] as const
export type LicenseErrorCode = (typeof LICENSE_ERRORS)[number]

export const ErrorResponseSchema = z.object({ error: z.enum(LICENSE_ERRORS) })
