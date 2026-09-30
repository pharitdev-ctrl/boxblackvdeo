import type { PGlite, Transaction } from "@electric-sql/pglite"
import type { Pool, PoolClient } from "pg"

/** The little of Postgres the server needs, over either node-postgres (Neon in production) or PGlite (local and tests). */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

export function pgliteDb(pg: PGlite | Transaction): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows
    },
    async exec(sql) {
      await pg.exec(sql)
    },
    transaction(fn) {
      if (!("transaction" in pg)) return fn(this)
      return pg.transaction((tx) => fn(pgliteDb(tx)))
    },
  }
}

function clientDb(client: PoolClient): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await client.query(text, params)).rows as T[]
    },
    async exec(sql) {
      await client.query(sql)
    },
    transaction: (fn) => fn(clientDb(client)),
  }
}

export function pgDb(pool: Pool): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[]
    },
    async exec(sql) {
      await pool.query(sql)
    },
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query("begin")
        const result = await fn(clientDb(client))
        await client.query("commit")
        return result
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },
  }
}

const SCHEMA = `
create table if not exists licenses (
  id text primary key,
  key_hash text not null unique,
  key_hint text not null,
  customer text not null,
  email text not null default '',
  plan text not null check (plan in ('monthly', 'yearly')),
  max_devices integer not null check (max_devices >= 1),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  note text not null default '',
  created_at timestamptz not null
);

create table if not exists activations (
  id text primary key,
  license_id text not null references licenses (id) on delete cascade,
  device_id text not null,
  device_name text not null default '',
  platform text not null default '',
  app_version text not null default '',
  secret_hash text not null unique,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  released_at timestamptz
);
create unique index if not exists activations_live_device on activations (license_id, device_id) where released_at is null;
create index if not exists activations_license on activations (license_id);

create table if not exists rate_events (
  bucket text not null,
  at timestamptz not null
);
create index if not exists rate_events_bucket_at on rate_events (bucket, at);

create table if not exists app_config (
  id integer primary key check (id = 1),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
`

/** Creates whatever is missing; safe to run on every start. */
export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA)
}
