import { expect, test } from "vitest"
import { createSession, hashPassword, verifyPassword, verifySession } from "./admin-auth.ts"

test("a password checks against its own hash only", async () => {
  const stored = await hashPassword("correct horse battery")
  expect(stored).toMatch(/^scrypt:32768:8:1:/)
  expect(await verifyPassword("correct horse battery", stored)).toBe(true)
  expect(await verifyPassword("correct horse batter", stored)).toBe(false)
  expect(await verifyPassword("anything", "not-a-hash")).toBe(false)
  expect(await hashPassword("correct horse battery")).not.toBe(stored)
})

const SECRET = "s".repeat(64)
const NOW = Date.parse("2026-09-17T10:00:00Z")

test("an admin session is valid until it expires, and only with the secret that made it", () => {
  const session = createSession(SECRET, NOW)
  expect(verifySession(session, SECRET, NOW + 3_600_000)).toBe(true)
  expect(verifySession(session, SECRET, NOW + 13 * 3_600_000)).toBe(false)
  expect(verifySession(session, "t".repeat(64), NOW)).toBe(false)
  const [payload, signature] = session.split(".") as [string, string]
  const longer = Buffer.from(JSON.stringify({ exp: NOW + 1000 * 86_400_000 })).toString("base64url")
  expect(verifySession(`${longer}.${signature}`, SECRET, NOW)).toBe(false)
  expect(verifySession(`${payload}`, SECRET, NOW)).toBe(false)
  expect(verifySession(undefined, SECRET, NOW)).toBe(false)
})
