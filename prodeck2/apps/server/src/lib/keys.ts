import { createHash, randomBytes } from "node:crypto"
import { normalizeLicenseKey } from "@boxblack/core/license/protocol"

/** Crockford base32: no I, L, O or U, so a key read aloud or copied by hand survives. 32 symbols divide 256, so bytes map evenly. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** PD2-XXXXX-XXXXX-XXXXX-XXXXX: 100 random bits, beyond guessing. */
export function generateLicenseKey(): string {
  const chars = [...randomBytes(20)].map((byte) => ALPHABET[byte % 32]).join("")
  return `PD2-${chars.match(/.{5}/g)!.join("-")}`
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/** Keys are stored hashed; the hash ignores how the customer typed it. */
export const hashLicenseKey = (key: string) => sha256(normalizeLicenseKey(key))

export const hashSecret = (secret: string) => sha256(secret)

/** The last group, so the admin can tell keys apart without the database holding them. */
export const keyHint = (key: string) => normalizeLicenseKey(key).slice(-5)

export const generateDeviceSecret = () => randomBytes(32).toString("base64url")
