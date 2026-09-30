import { expect, test } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deviceId, hashDeviceId, parsePlatformUuid } from "./device.ts"

const IOREG = `+-o J416sAP  <class IOPlatformExpertDevice, id 0x100000210, registered, matched, active, busy 0 (0 ms), retain 44>
    {
      "IOPlatformSerialNumber" = "C02XXXXXXX"
      "IOPlatformUUID" = "1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D"
    }`

test("reads the hardware UUID macOS reports", () => {
  expect(parsePlatformUuid(IOREG)).toBe("1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D")
  expect(parsePlatformUuid("nothing here")).toBeNull()
})

test("the id sent to the server is a hash, never the hardware UUID itself", () => {
  // the salt is the product's earlier name on purpose: a change would re-bind every license sold
  expect(hashDeviceId("1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D")).toBe("733d33b5405c3b39e5e46038943341fc")
  const id = hashDeviceId("1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D")
  expect(id).toMatch(/^[0-9a-f]{32}$/)
  expect(id).toBe(hashDeviceId("1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"))
  expect(id).not.toContain("1a2b3c4d")
})

test("on a Mac the id comes from the hardware UUID and stays the same", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-device-"))
  const read = () => deviceId({ platform: "darwin", dataDir: dir, run: async () => IOREG })
  expect(await read()).toBe(hashDeviceId("1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D"))
  expect(await read()).toBe(await read())
})

test("where the hardware id cannot be read, a random id is made once and kept", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-device-"))
  const failing = async () => {
    throw new Error("ioreg not found")
  }
  const first = await deviceId({ platform: "darwin", dataDir: dir, run: failing })
  expect(first).toMatch(/^[0-9a-f]{32}$/)
  expect(await deviceId({ platform: "linux", dataDir: dir, run: failing })).toBe(first)
  expect((await readFile(join(dir, "device-id"), "utf8")).trim()).toBe(first)
})
