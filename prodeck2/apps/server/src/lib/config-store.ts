import { DEFAULT_REMOTE_CONFIG, RemoteConfigSchema, type RemoteConfig } from "@boxblack/core/license/protocol"
import type { Db } from "./db.ts"

export async function getConfig(db: Db): Promise<RemoteConfig> {
  const [row] = await db.query<{ value: unknown }>("select value from app_config where id = 1")
  const parsed = RemoteConfigSchema.safeParse(row?.value)
  return parsed.success ? parsed.data : DEFAULT_REMOTE_CONFIG
}

/** Throws when the config is invalid, so a broken one never reaches the apps. */
export async function saveConfig(db: Db, config: RemoteConfig): Promise<void> {
  const valid = RemoteConfigSchema.parse(config)
  await db.query(
    "insert into app_config (id, value, updated_at) values (1, $1, now()) on conflict (id) do update set value = excluded.value, updated_at = excluded.updated_at",
    [valid],
  )
}
