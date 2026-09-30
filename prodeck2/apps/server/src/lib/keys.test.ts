import { expect, test } from "vitest"
import { generateDeviceSecret, generateLicenseKey, hashLicenseKey, hashSecret, keyHint } from "./keys.ts"

test("license keys are PD2 plus four groups of five unambiguous characters", () => {
  const key = generateLicenseKey()
  expect(key).toMatch(/^PD2-[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
  expect(generateLicenseKey()).not.toBe(key)
})

test("a key hashes the same however it is typed, and only its end is kept as a hint", () => {
  const key = "PD2-ABCDE-FGHJK-MNPQR-STVWX"
  expect(hashLicenseKey(key)).toBe(hashLicenseKey(" pd2abcde-fghjk mnpqr-stvwx"))
  expect(hashLicenseKey(key)).toMatch(/^[0-9a-f]{64}$/)
  expect(keyHint(key)).toBe("STVWX")
})

test("device secrets are long random strings, hashed exactly as given", () => {
  const secret = generateDeviceSecret()
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(generateDeviceSecret()).not.toBe(secret)
  expect(hashSecret("abc")).not.toBe(hashSecret("ABC"))
})
