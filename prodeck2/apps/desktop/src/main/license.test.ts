import { expect, test } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { issueClaims, signLicenseToken } from "@boxblack/core/license"
import { DEFAULT_REMOTE_CONFIG, type GrantResponse, type RemoteConfig } from "@boxblack/core/license/protocol"
import { createLicenseService, type LicenseDeps } from "./license.ts"
import type { SecretBox } from "./settings.ts"

const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const PRIVATE = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const PUBLIC = publicKey.export({ type: "spki", format: "pem" }).toString()

const HOUR = 3_600_000
const DAY = 24 * HOUR
const START = Date.parse("2026-09-17T10:00:00Z")
const DEVICE = "d".repeat(32)
const SECRET = "device-secret-from-server"

const box: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain).reverse(),
  decryptString: (cipher) => Buffer.from(cipher).reverse().toString(),
}

/** A license server in memory: real signed tokens, programmable refusals. */
function fakeServer() {
  const server = {
    clock: START,
    licenseExpiresAt: START + 30 * DAY,
    config: DEFAULT_REMOTE_CONFIG as RemoteConfig,
    tokenDevice: null as string | null,
    refusal: null as { status: number; error: string } | null,
    down: false,
    requests: [] as { path: string; body: Record<string, unknown> }[],
  }
  const grant = (deviceId: string, withSecret: boolean): GrantResponse => ({
    token: signLicenseToken(
      issueClaims({ licenseId: "lic-1", deviceId: server.tokenDevice ?? deviceId, plan: "monthly", licenseExpiresAt: server.licenseExpiresAt, now: server.clock }),
      PRIVATE,
    ),
    license: { customer: "ร้านเล็บสวย", plan: "monthly", expiresAt: server.licenseExpiresAt, maxDevices: 2, devicesUsed: 1 },
    config: server.config,
    ...(withSecret ? { deviceSecret: SECRET } : {}),
  })
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (server.down) throw new TypeError("fetch failed")
    const path = new URL(String(url)).pathname
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    server.requests.push({ path, body })
    if (server.refusal) return Response.json({ error: server.refusal.error }, { status: server.refusal.status })
    if (path === "/api/v1/activate") return Response.json(grant((body.device as { id: string }).id, true))
    if (path === "/api/v1/refresh") {
      if (body.deviceSecret !== SECRET) return Response.json({ error: "not-activated" }, { status: 401 })
      return Response.json(grant(body.deviceId as string, false))
    }
    if (path === "/api/v1/deactivate") return Response.json({ ok: true })
    return new Response("not found", { status: 404 })
  }
  return { server, fetch: fetch as typeof globalThis.fetch }
}

async function setup(overrides: Partial<LicenseDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-license-"))
  const { server, fetch } = fakeServer()
  const clock = { now: START }
  const changes: unknown[] = []
  const deps: LicenseDeps = {
    serverUrl: "https://license.example",
    publicKey: PUBLIC,
    file: join(dir, "license.json"),
    box,
    deviceId: async () => DEVICE,
    device: { name: "MacBook ของฟอร์ด", platform: "darwin", appVersion: "0.1.0" },
    fetch,
    now: () => clock.now,
    onChange: (state) => changes.push(state),
    ...overrides,
  }
  return { service: createLicenseService(deps), deps, server, clock, changes, file: deps.file }
}

const at = (clock: { now: number }, server: { clock: number }, time: number) => {
  clock.now = time
  server.clock = time
}

test("with no license on the machine the app is unlicensed and work is refused", async () => {
  const { service } = await setup()
  expect(await service.state()).toEqual({ state: "unlicensed" })
  await expect(service.assertLicensed()).rejects.toThrow("license-required")
  expect(await service.config()).toEqual(DEFAULT_REMOTE_CONFIG)
})

test("activating sends the key and this device, and makes the app licensed", async () => {
  const { service, server, changes } = await setup()
  const result = await service.activate(" PD2-AAAAA-BBBBB-CCCCC-DDDDD ")
  expect(result).toEqual({
    ok: true,
    state: {
      state: "active",
      license: { customer: "ร้านเล็บสวย", plan: "monthly", expiresAt: START + 30 * DAY, maxDevices: 2, devicesUsed: 1 },
      tokenExpiresAt: START + 3 * DAY,
      offline: false,
    },
  })
  expect(server.requests[0]).toEqual({
    path: "/api/v1/activate",
    body: { key: "PD2-AAAAA-BBBBB-CCCCC-DDDDD", device: { id: DEVICE, name: "MacBook ของฟอร์ด", platform: "darwin", appVersion: "0.1.0" } },
  })
  await expect(service.assertLicensed()).resolves.toBeUndefined()
  expect(changes.at(-1)).toMatchObject({ state: "active" })
})

test("the license survives a restart, and the device secret is never stored in plain text", async () => {
  const { service, deps, file } = await setup()
  await service.activate("PD2-KEY")
  expect(await readFile(file, "utf8")).not.toContain(SECRET)
  expect((await createLicenseService(deps).state()).state).toBe("active")
})

test("refusals and failures to activate say why and store nothing", async () => {
  const { service, server, file } = await setup()
  for (const [status, error] of [
    [404, "invalid-key"],
    [403, "device-limit"],
    [403, "revoked"],
    [403, "expired"],
    [429, "rate-limited"],
  ] as const) {
    server.refusal = { status, error }
    expect(await service.activate("PD2-KEY")).toEqual({ ok: false, error })
  }
  server.refusal = { status: 502, error: "bad gateway" }
  expect(await service.activate("PD2-KEY")).toEqual({ ok: false, error: "server-error" })
  server.refusal = null
  server.down = true
  expect(await service.activate("PD2-KEY")).toEqual({ ok: false, error: "offline" })
  await expect(readFile(file)).rejects.toThrow()
})

test("a token that is not for this machine, or not signed by the license server, is not accepted", async () => {
  const { service, server } = await setup()
  server.tokenDevice = "e".repeat(32)
  expect(await service.activate("PD2-KEY")).toEqual({ ok: false, error: "server-error" })

  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()
  const forged = await setup({ publicKey: other })
  expect(await forged.service.activate("PD2-KEY")).toEqual({ ok: false, error: "server-error" })
  expect(await forged.service.state()).toEqual({ state: "unlicensed" })
})

test("after 12 hours the token is refreshed with the device secret, bringing the latest config", async () => {
  const { service, server, clock } = await setup()
  await service.activate("PD2-KEY")
  server.config = { ...DEFAULT_REMOTE_CONFIG, capcutVersions: ["9.4.0", "9.5.0"] }

  at(clock, server, START + 11 * HOUR)
  await service.refreshIfDue()
  expect(server.requests).toHaveLength(1)

  at(clock, server, START + 13 * HOUR)
  await service.refreshIfDue()
  expect(server.requests[1]).toEqual({ path: "/api/v1/refresh", body: { deviceId: DEVICE, deviceSecret: SECRET, appVersion: "0.1.0" } })
  expect(await service.state()).toMatchObject({ state: "active", tokenExpiresAt: START + 13 * HOUR + 3 * DAY })
  expect((await service.config()).capcutVersions).toEqual(["9.4.0", "9.5.0"])
})

test("offline, the app keeps working until the token runs out, then needs the internet again", async () => {
  const { service, server, clock } = await setup()
  await service.activate("PD2-KEY")
  server.down = true
  at(clock, server, START + 2 * DAY)
  expect(await service.refresh()).toMatchObject({ state: "active", offline: true })
  await expect(service.assertLicensed()).resolves.toBeUndefined()

  at(clock, server, START + 3 * DAY)
  expect(await service.state()).toMatchObject({ state: "blocked", reason: "token-expired" })
  await expect(service.assertLicensed()).rejects.toThrow("license-required")

  server.down = false
  await service.refreshIfDue()
  expect(await service.state()).toMatchObject({ state: "active", offline: false })
})

test("a revoked license stops the app at the next refresh, even with time left on the token", async () => {
  const { service, server, clock } = await setup()
  await service.activate("PD2-KEY")
  server.refusal = { status: 403, error: "revoked" }
  at(clock, server, START + HOUR)
  expect(await service.refresh()).toMatchObject({ state: "blocked", reason: "revoked", license: { customer: "ร้านเล็บสวย" } })

  server.refusal = null
  expect(await service.refresh()).toMatchObject({ state: "active" })
})

test("a device released by the admin must be activated with the key again", async () => {
  const { service, server, clock } = await setup()
  await service.activate("PD2-KEY")
  server.refusal = { status: 401, error: "not-activated" }
  at(clock, server, START + HOUR)
  expect(await service.refresh()).toMatchObject({ state: "blocked", reason: "not-activated" })
  server.refusal = null
  expect((await service.activate("PD2-KEY")).ok).toBe(true)
})

test("an expired license, a clock set back, or a license copied from another machine all block work", async () => {
  const { service, server, clock, deps } = await setup()
  server.licenseExpiresAt = START + 2 * HOUR
  await service.activate("PD2-KEY")
  at(clock, server, START + 2 * HOUR)
  expect(await service.state()).toMatchObject({ state: "blocked", reason: "expired" })

  const back = await setup()
  await back.service.activate("PD2-KEY")
  back.clock.now = START + 5 * HOUR
  await back.service.state()
  back.clock.now = START + HOUR
  expect(await back.service.state()).toMatchObject({ state: "blocked", reason: "clock" })

  const copied = createLicenseService({ ...deps, deviceId: async () => "f".repeat(32) })
  expect(await copied.state()).toMatchObject({ state: "blocked", reason: "wrong-device" })
})

test("an edited license file is ignored", async () => {
  const { service, file } = await setup()
  await service.activate("PD2-KEY")
  const stored = JSON.parse(await readFile(file, "utf8"))
  stored.token = stored.token.replace(/\.[^.]+\./, (part: string) => `${part.slice(0, -3)}x.`)
  await writeFile(file, JSON.stringify(stored))
  expect(await service.state()).toEqual({ state: "unlicensed" })
})

test("deactivating frees this machine's seat and forgets the license; offline it is refused", async () => {
  const { service, server } = await setup()
  await service.activate("PD2-KEY")
  server.down = true
  expect(await service.deactivate()).toEqual({ ok: false, error: "offline" })
  expect((await service.state()).state).toBe("active")

  server.down = false
  expect(await service.deactivate()).toEqual({ ok: true })
  expect(server.requests.at(-1)).toEqual({ path: "/api/v1/deactivate", body: { deviceId: DEVICE, deviceSecret: SECRET } })
  expect(await service.state()).toEqual({ state: "unlicensed" })
})

test("work asked for at the same moment is all let through, even when the license file is updated each time", async () => {
  const { service, clock, server } = await setup()
  await service.activate("PD2-AAAAA-BBBBB-CCCCC-DDDDD")
  // more than a minute later, every check records when this machine was last seen
  at(clock, server, START + 5 * 60_000)
  await expect(Promise.all(Array.from({ length: 8 }, () => service.assertLicensed()))).resolves.toHaveLength(8)
  expect((await service.state()).state).toBe("active")
})
