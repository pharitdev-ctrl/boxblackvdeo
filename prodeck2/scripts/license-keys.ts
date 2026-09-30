/**
 * Makes the Ed25519 key pair that signs license tokens.
 *
 *   node scripts/license-keys.ts --production
 *                                          writes the public key into the desktop app (marked as the
 *                                          production key) and prints the private key once, for the
 *                                          server's LICENSE_SIGNING_KEY. Keep it out of the repository.
 *   node scripts/license-keys.ts --dev    writes a local development setup: apps/server/.env.local
 *                                          (signing key, session secret, admin password hash), the
 *                                          admin password in apps/server/.admin-password.local, and
 *                                          the public key into the desktop app. Refuses to overwrite.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { hashPassword } from "../apps/server/src/lib/admin-auth.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString()

const publicKeyModule = (pem: string, kind: "development" | "production") => `/**
 * Verifies license tokens offline. Must pair with the license server's LICENSE_SIGNING_KEY;
 * replace it with the production key (node scripts/license-keys.ts --production) before shipping.
 */
/** Release builds refuse a development key (apps/desktop/scripts/release-check.ts). */
export const LICENSE_KEY_KIND: "development" | "production" = ${JSON.stringify(kind)}

export const LICENSE_PUBLIC_KEY = ${JSON.stringify(pem)}
`

if (process.argv.includes("--production")) {
  await writeFile(`${root}apps/desktop/src/main/license-public-key.ts`, publicKeyModule(publicPem, "production"))
  console.log("wrote the production public key into apps/desktop/src/main/license-public-key.ts")
  console.log("set this on the license server (shown once, not saved anywhere):\n")
  console.log(`LICENSE_SIGNING_KEY=${Buffer.from(privatePem).toString("base64")}`)
} else if (!process.argv.includes("--dev")) {
  throw new Error("pass --dev for a local setup or --production for the real key pair")
} else {
  const envFile = `${root}apps/server/.env.local`
  const passwordFile = `${root}apps/server/.admin-password.local`
  if (existsSync(envFile)) throw new Error(`${envFile} already exists; delete it first to make a new development setup`)
  const password = randomBytes(12).toString("base64url")
  await writeFile(
    envFile,
    [
      `LICENSE_SIGNING_KEY=${Buffer.from(privatePem).toString("base64")}`,
      `ADMIN_SESSION_SECRET=${randomBytes(32).toString("base64url")}`,
      `ADMIN_PASSWORD_HASH=${await hashPassword(password)}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  await writeFile(passwordFile, `${password}\n`, { mode: 0o600 })
  await writeFile(`${root}apps/desktop/src/main/license-public-key.ts`, publicKeyModule(publicPem, "development"))
  console.log(`wrote ${envFile}, ${passwordFile} and apps/desktop/src/main/license-public-key.ts`)
}
