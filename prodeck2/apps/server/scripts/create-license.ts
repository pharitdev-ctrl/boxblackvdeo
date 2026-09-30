/**
 * Issues a license from the command line, against DATABASE_URL or the local PGlite database
 * (stop `next dev` first — PGlite allows one process at a time). Prints the key once.
 *
 *   node --env-file=apps/server/.env.local apps/server/scripts/create-license.ts "ร้านเล็บสวย" monthly [devices] [YYYY-MM-DD]
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { parseLicenseForm } from "../src/lib/admin-forms.ts"
import { migrate, pgDb, pgliteDb, type Db } from "../src/lib/db.ts"
import { createLicense } from "../src/lib/licenses.ts"

const [customer, plan = "monthly", devices = "2", expiresOn = ""] = process.argv.slice(2)
if (!customer) throw new Error('usage: create-license.ts "customer" monthly|yearly [devices] [YYYY-MM-DD]')

async function open(): Promise<{ db: Db; close: () => Promise<void> }> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg")
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    return { db: pgDb(pool), close: () => pool.end() }
  }
  const { PGlite } = await import("@electric-sql/pglite")
  mkdirSync(join(import.meta.dirname, "..", ".data"), { recursive: true })
  const pg = new PGlite(join(import.meta.dirname, "..", ".data", "pglite"))
  return { db: pgliteDb(pg), close: () => pg.close() }
}

const { db, close } = await open()
try {
  await migrate(db)
  const form = new FormData()
  for (const [name, value] of Object.entries({ customer, email: "", plan, maxDevices: devices, expiresOn, note: "" })) form.append(name, value)
  const { license, key } = await createLicense(db, parseLicenseForm(form, Date.now()), Date.now())
  console.log(JSON.stringify({ id: license.id, customer: license.customer, plan: license.plan, expiresAt: new Date(license.expiresAt).toISOString(), key }))
} finally {
  await close()
}
