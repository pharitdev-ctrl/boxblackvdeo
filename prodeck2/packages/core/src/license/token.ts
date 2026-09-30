import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import { z } from "zod"

/**
 * License tokens: the server's signed statement that a license is valid on one device until
 * a time. The app checks the signature with the public key it ships with, so it keeps
 * working offline until the token expires, and a token cannot be edited or moved to another
 * machine without breaking the signature or the device check.
 */

export const TOKEN_TIMES = {
  /** the app asks for a new token once this old */
  refreshAfterMs: 12 * 3_600_000,
  /** and can go on without reaching the server until this old */
  offlineGraceMs: 3 * 24 * 3_600_000,
}

/** A clock this far behind the token's issue time has been set back. */
const CLOCK_SKEW_MS = 10 * 60_000

const PREFIX = "pd2"

export const LicenseClaimsSchema = z.object({
  v: z.literal(1),
  licenseId: z.string(),
  deviceId: z.string(),
  plan: z.enum(["monthly", "yearly"]),
  /** all times are milliseconds since the epoch */
  licenseExpiresAt: z.number(),
  issuedAt: z.number(),
  refreshAfter: z.number(),
  expiresAt: z.number(),
})

export type LicenseClaims = z.infer<typeof LicenseClaimsSchema>

export function issueClaims(args: {
  licenseId: string
  deviceId: string
  plan: LicenseClaims["plan"]
  licenseExpiresAt: number
  now: number
}): LicenseClaims {
  const expiresAt = Math.min(args.now + TOKEN_TIMES.offlineGraceMs, args.licenseExpiresAt)
  return {
    v: 1,
    licenseId: args.licenseId,
    deviceId: args.deviceId,
    plan: args.plan,
    licenseExpiresAt: args.licenseExpiresAt,
    issuedAt: args.now,
    refreshAfter: Math.min(args.now + TOKEN_TIMES.refreshAfterMs, expiresAt),
    expiresAt,
  }
}

const signedPart = (payload: string) => Buffer.from(`${PREFIX}.${payload}`)

/** `privateKeyPem` is an Ed25519 key in PKCS#8 PEM. */
export function signLicenseToken(claims: LicenseClaims, privateKeyPem: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const signature = sign(null, signedPart(payload), createPrivateKey(privateKeyPem)).toString("base64url")
  return `${PREFIX}.${payload}.${signature}`
}

/** The claims of a genuine token, or null. Says nothing about whether it is still valid — see checkClaims. */
export function verifyLicenseToken(token: string, publicKeyPem: string): LicenseClaims | null {
  const [prefix, payload, signature, ...rest] = token.split(".")
  if (prefix !== PREFIX || !payload || !signature || rest.length > 0) return null
  try {
    if (!verify(null, signedPart(payload), createPublicKey(publicKeyPem), Buffer.from(signature, "base64url"))) return null
    const parsed = LicenseClaimsSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type ClaimsCheck =
  | { ok: true; needsRefresh: boolean }
  | { ok: false; reason: "token-expired" | "license-expired" | "wrong-device" | "clock" }

export function checkClaims(claims: LicenseClaims, context: { now: number; deviceId: string }): ClaimsCheck {
  const { now } = context
  if (claims.deviceId !== context.deviceId) return { ok: false, reason: "wrong-device" }
  if (now < claims.issuedAt - CLOCK_SKEW_MS) return { ok: false, reason: "clock" }
  if (now >= claims.licenseExpiresAt) return { ok: false, reason: "license-expired" }
  if (now >= claims.expiresAt) return { ok: false, reason: "token-expired" }
  return { ok: true, needsRefresh: now >= claims.refreshAfter }
}
