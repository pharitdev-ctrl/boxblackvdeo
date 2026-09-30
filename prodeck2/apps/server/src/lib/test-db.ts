import { PGlite } from "@electric-sql/pglite"
import { migrate, pgliteDb, type Db } from "./db.ts"

/** An in-memory Postgres with the schema applied. Tables are emptied between tests with `reset`. */
export async function testDb(): Promise<{ db: Db; reset: () => Promise<void>; close: () => Promise<void> }> {
  const pg = new PGlite()
  const db = pgliteDb(pg)
  await migrate(db)
  return {
    db,
    reset: () => db.exec("truncate licenses, activations, rate_events, app_config cascade"),
    close: () => pg.close(),
  }
}
