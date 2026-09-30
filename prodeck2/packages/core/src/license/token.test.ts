import { expect, test } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { checkClaims, issueClaims, signLicenseToken, TOKEN_TIMES, verifyLicenseToken, type LicenseClaims } from "./token.ts"

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

const NOW = Date.parse("2026-09-17T10:00:00Z")
const HOUR = 3_600_000
const DAY = 24 * HOUR
const DEVICE = "a".repeat(32)

const claims = (extra: Partial<Parameters<typeof issueClaims>[0]> = {}): LicenseClaims =>
  issueClaims({ licenseId: "lic-1", deviceId: DEVICE, plan: "monthly", licenseExpiresAt: NOW + 30 * DAY, now: NOW, ...extra })

test("a token carries its claims and verifies with the matching public key", () => {
  const { privateKey, publicKey } = keys()
  const token = signLicenseToken(claims(), privateKey)
  expect(token.startsWith("pd2.")).toBe(true)
  expect(verifyLicenseToken(token, publicKey)).toEqual(claims())
})

test("a token signed by another key, or edited after signing, does not verify", () => {
  const mine = keys()
  const other = keys()
  expect(verifyLicenseToken(signLicenseToken(claims(), other.privateKey), mine.publicKey)).toBeNull()
  expect(verifyLicenseToken("pd2.garbage", mine.publicKey)).toBeNull()

  const signed = signLicenseToken(claims(), mine.privateKey)
  const [prefix, payload, signature] = signed.split(".") as [string, string, string]
  const edited = JSON.parse(Buffer.from(payload, "base64url").toString())
  edited.licenseExpiresAt += 365 * DAY
  const forged = [prefix, Buffer.from(JSON.stringify(edited)).toString("base64url"), signature].join(".")
  expect(verifyLicenseToken(forged, mine.publicKey)).toBeNull()
})

test("a fresh token asks for a refresh after 12 hours and works offline for 3 days", () => {
  const issued = claims()
  expect(issued.refreshAfter).toBe(NOW + TOKEN_TIMES.refreshAfterMs)
  expect(issued.expiresAt).toBe(NOW + TOKEN_TIMES.offlineGraceMs)
  expect(TOKEN_TIMES).toEqual({ refreshAfterMs: 12 * HOUR, offlineGraceMs: 3 * DAY })
})

test("a token never outlives the license it was issued for", () => {
  const issued = claims({ licenseExpiresAt: NOW + 6 * HOUR })
  expect(issued.expiresAt).toBe(NOW + 6 * HOUR)
  expect(issued.refreshAfter).toBe(NOW + 6 * HOUR)
})

test("checking claims: valid, due for refresh, expired, wrong machine, clock set back", () => {
  const issued = claims()
  expect(checkClaims(issued, { now: NOW + HOUR, deviceId: DEVICE })).toEqual({ ok: true, needsRefresh: false })
  expect(checkClaims(issued, { now: NOW + 13 * HOUR, deviceId: DEVICE })).toEqual({ ok: true, needsRefresh: true })
  expect(checkClaims(issued, { now: NOW + 3 * DAY, deviceId: DEVICE })).toEqual({ ok: false, reason: "token-expired" })
  expect(checkClaims(issued, { now: NOW + HOUR, deviceId: "b".repeat(32) })).toEqual({ ok: false, reason: "wrong-device" })
  expect(checkClaims(issued, { now: NOW - DAY, deviceId: DEVICE })).toEqual({ ok: false, reason: "clock" })

  const ending = claims({ licenseExpiresAt: NOW + 2 * HOUR })
  expect(checkClaims(ending, { now: NOW + 2 * HOUR, deviceId: DEVICE })).toEqual({ ok: false, reason: "license-expired" })
})
