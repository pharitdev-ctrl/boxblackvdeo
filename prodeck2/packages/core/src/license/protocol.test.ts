import { expect, test } from "vitest"
import { CUT_PRESETS } from "../cut/rules.ts"
import { ActivateRequestSchema, DEFAULT_REMOTE_CONFIG, normalizeLicenseKey, RemoteConfigSchema } from "./protocol.ts"

test("license keys compare without dashes, spaces or letter case", () => {
  expect(normalizeLicenseKey(" pd2-abcd-EFGH ")).toBe("PD2ABCDEFGH")
})

test("the default config is what the app shipped with: built-in prompts, its cut presets and the CapCut release it was tested on", () => {
  expect(DEFAULT_REMOTE_CONFIG).toEqual({ capcutVersions: ["9.4.0"], cutPresets: CUT_PRESETS, prompts: { vision: null, planner: null } })
  expect(RemoteConfigSchema.parse(DEFAULT_REMOTE_CONFIG)).toEqual(DEFAULT_REMOTE_CONFIG)
})

test("a config with a preset that keeps no silence at all, or with a missing preset, is rejected", () => {
  const broken = { ...DEFAULT_REMOTE_CONFIG, cutPresets: { ...CUT_PRESETS, tight: { maxPauseUs: 0, paddingUs: 0 } } }
  expect(RemoteConfigSchema.safeParse(broken).success).toBe(false)
  const { loose: _loose, ...missing } = CUT_PRESETS
  expect(RemoteConfigSchema.safeParse({ ...DEFAULT_REMOTE_CONFIG, cutPresets: missing }).success).toBe(false)
})

test("activation requests need a key and a well-formed device", () => {
  const device = { id: "f".repeat(32), name: "MacBook", platform: "darwin", appVersion: "0.1.0" }
  expect(ActivateRequestSchema.safeParse({ key: "PD2-AAAA", device }).success).toBe(true)
  expect(ActivateRequestSchema.safeParse({ key: "", device }).success).toBe(false)
  expect(ActivateRequestSchema.safeParse({ key: "PD2-AAAA", device: { ...device, id: "not hex" } }).success).toBe(false)
})
