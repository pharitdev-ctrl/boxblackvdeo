import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { migrate, pgDb, pgliteDb, type Db } from "./db.ts"
import { serverEnv } from "./env.ts"

const globalCache = globalThis as unknown as { boxblackDb?: Promise<Db> }

async function open(): Promise<Db> {
  const env = serverEnv()
  let db: Db
  if (env.databaseUrl) {
    const { Pool } = await import("pg")
    db = pgDb(new Pool({ connectionString: env.databaseUrl, max: 5 }))
  } else if (env.production) {
    throw new Error("DATABASE_URL is not set")
  } else {
    // local development: an embedded Postgres kept under apps/server/.data
    const { PGlite } = await import("@electric-sql/pglite")
    // PGlite creates only the last folder of the path
    mkdirSync(join(process.cwd(), ".data"), { recursive: true })
    db = pgliteDb(new PGlite(join(process.cwd(), ".data", "pglite")))
  }
  await migrate(db)
  return db
}

/** One connection pool per server process; kept on globalThis so dev reloads do not open another. */
export function database(): Promise<Db> {
  globalCache.boxblackDb ??= open().catch((error: unknown) => {
    globalCache.boxblackDb = undefined
    throw error
  })
  return globalCache.boxblackDb
}
