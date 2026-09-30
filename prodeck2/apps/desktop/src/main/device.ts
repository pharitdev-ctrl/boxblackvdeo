import { createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export function parsePlatformUuid(ioregOutput: string): string | null {
  return /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/.exec(ioregOutput)?.[1] ?? null
}

/**
 * Salted so the id means nothing outside BOXBLACK and the hardware UUID never leaves the machine.
 * The salt still says "prodeck2", the product's earlier name: changing it would give every machine
 * a new id, so every license already sold would re-bind and burn another of its device slots.
 */
export function hashDeviceId(raw: string): string {
  return createHash("sha256").update(`prodeck2-device:${raw.toLowerCase()}`).digest("hex").slice(0, 32)
}

/**
 * A stable id for this computer, for binding licenses. macOS: the hardware UUID, which survives
 * reinstalls. Elsewhere (Windows comes later) or if it cannot be read: a random id kept in the
 * app's data folder.
 */
export async function deviceId(deps: {
  platform: NodeJS.Platform
  dataDir: string
  run: (command: string, args: string[]) => Promise<string>
}): Promise<string> {
  if (deps.platform === "darwin") {
    try {
      const uuid = parsePlatformUuid(await deps.run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]))
      if (uuid) return hashDeviceId(uuid)
    } catch {
      // fall through to the stored id
    }
  }
  const file = join(deps.dataDir, "device-id")
  try {
    const stored = (await readFile(file, "utf8")).trim()
    if (/^[0-9a-f]{32}$/.test(stored)) return stored
  } catch {
    // not made yet
  }
  const made = randomBytes(16).toString("hex")
  await mkdir(deps.dataDir, { recursive: true })
  await writeFile(file, made)
  return made
}
