import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import { DEFAULT_REMOTE_CONFIG } from "@boxblack/core/license/protocol"
import { getConfig, saveConfig } from "./config-store.ts"
import type { Db } from "./db.ts"
import { testDb } from "./test-db.ts"

let db: Db
let reset: () => Promise<void>
let close: () => Promise<void>
beforeAll(async () => ({ db, reset, close } = await testDb()))
beforeEach(() => reset())
afterAll(() => close())

test("until the admin saves a config, the app's defaults are served", async () => {
  expect(await getConfig(db)).toEqual(DEFAULT_REMOTE_CONFIG)
})

test("a saved config is served", async () => {
  const config = { ...DEFAULT_REMOTE_CONFIG, capcutVersions: ["9.4.0", "9.5.0"], prompts: { vision: null, planner: "ตัดให้กระชับ" } }
  await saveConfig(db, config)
  expect(await getConfig(db)).toEqual(config)
})

test("an invalid config is refused, and a damaged stored one falls back to the defaults", async () => {
  await expect(saveConfig(db, { ...DEFAULT_REMOTE_CONFIG, capcutVersions: [""] })).rejects.toThrow()
  await db.query("insert into app_config (id, value) values (1, $1)", [{ capcutVersions: "nope" }])
  expect(await getConfig(db)).toEqual(DEFAULT_REMOTE_CONFIG)
})
