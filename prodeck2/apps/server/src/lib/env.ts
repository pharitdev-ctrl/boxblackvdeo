/** Server settings from the environment, checked when first needed so a missing one fails loudly. */

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — see apps/server/.env.example`)
  return value
}

/** PEM in an env var: accepts real newlines, "\n" escapes, or the whole PEM base64-encoded. */
export function readPem(value: string): string {
  if (value.includes("-----BEGIN")) return value.replaceAll("\\n", "\n")
  return Buffer.from(value, "base64").toString("utf8")
}

export function serverEnv() {
  const sessionSecret = required("ADMIN_SESSION_SECRET")
  if (sessionSecret.length < 32) throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters")
  return {
    signingKey: readPem(required("LICENSE_SIGNING_KEY")),
    adminPasswordHash: required("ADMIN_PASSWORD_HASH"),
    sessionSecret,
    databaseUrl: process.env.DATABASE_URL ?? null,
    production: process.env.NODE_ENV === "production",
  }
}
