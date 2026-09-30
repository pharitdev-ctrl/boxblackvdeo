import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto"

const SCRYPT = { N: 32_768, r: 8, p: 1, keylen: 32 }
const SESSION_MS = 12 * 3_600_000

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) => (error ? reject(error) : resolve(key))),
  )
}

/** scrypt:N:r:p:salt:hash — what goes in ADMIN_PASSWORD_HASH. No "$", which .env loaders expand. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen)
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join(":")
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split(":")
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false
  const expected = Buffer.from(hash, "base64url")
  const actual = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p), expected.length)
  return timingSafeEqual(actual, expected)
}

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest()

/** A cookie value that proves the admin logged in, valid for 12 hours. */
export function createSession(secret: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_MS })).toString("base64url")
  return `${payload}.${mac(payload, secret).toString("base64url")}`
}

export function verifySession(value: string | undefined, secret: string, now: number): boolean {
  const [payload, signature, ...rest] = value?.split(".") ?? []
  if (!payload || !signature || rest.length > 0) return false
  const given = Buffer.from(signature, "base64url")
  const expected = mac(payload, secret)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: unknown }
    return typeof exp === "number" && now < exp
  } catch {
    return false
  }
}
