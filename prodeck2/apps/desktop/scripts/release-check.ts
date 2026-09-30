/**
 * Refuses to build an app for customers that would talk to the wrong license server, trust the
 * development signing key, try updates it cannot install, ship without the ffmpeg it was tested
 * with, or ship without a built and published graphics pack, or without the host script its
 * graphics' pages end with, or with anything else in the folder that script ships in.
 *
 *   node apps/desktop/scripts/release-check.ts          customer build
 *   node apps/desktop/scripts/release-check.ts --local  test build against the local server
 */
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { inspectTools, runProcess } from "@boxblack/core/media"
import { LICENSING } from "../src/main/edition.ts"
import { PINNED_WHISPER_VERSION, WHISPER_TAP_FORMULA } from "../src/shared/whisper-tap.ts"
import { GRAPHICS_PACK, type GraphicsPackSpec } from "../src/shared/graphics-pack.ts"
import { LICENSE_KEY_KIND } from "../src/main/license-public-key.ts"

/** The ffmpeg shipped in Resources/bin; the build script's VERSION must say the same (a test checks). */
export const BUNDLED_FFMPEG = "8.1.2"

/** What the shipped ffmpeg is and what it lacks; null when it is not there or does not run. */
export type ShippedFfmpeg = { version: string | null; missing: string[] } | null

export function releaseProblems(input: {
  local: boolean
  licenseServer: string
  keyKind: string
  updateUrl: string
  signing: boolean
  /** what inspectShippedFfmpeg found in resources/bin/ffmpeg */
  ffmpeg: ShippedFfmpeg
  /** false for a build that asks for no license, which then needs no license server or key */
  licensing: boolean
  /** the formula the settings screen tells customers to install whisper-cli from */
  whisperFormula: string
  /** the first line of `resources/bin/WHISPER-NOTICE.txt`, or null when the shipped whisper-cli is not there */
  whisper: string | null
  /** GRAPHICS_PACK.sha256 from src/shared/graphics-pack.ts */
  graphicsPackSha: string
  /** GRAPHICS_PACK.bytes from src/shared/graphics-pack.ts */
  graphicsPackBytes: number
  /** GRAPHICS_PACK.url from src/shared/graphics-pack.ts */
  graphicsPackUrl: string
}): string[] {
  const problems: string[] = []
  const shippedWhisper = input.whisper && /whisper\.cpp (\S+) /.exec(input.whisper)?.[1]
  if (!shippedWhisper) problems.push("resources/bin/whisper-cli is missing; run apps/desktop/scripts/build-whisper.sh <work dir> apps/desktop/resources/bin")
  else if (shippedWhisper !== PINNED_WHISPER_VERSION) {
    problems.push(`resources/bin/whisper-cli is ${shippedWhisper}, not ${PINNED_WHISPER_VERSION}; rebuild it with apps/desktop/scripts/build-whisper.sh`)
  }
  if (input.whisperFormula.startsWith("OWNER/")) {
    problems.push("WHISPER_TAP_FORMULA in src/shared/whisper-tap.ts still has no owner; set it to the GitHub account the tap is published under")
  }
  // every build, test builds too: the app on a customer's machine has no other ffmpeg to fall back on
  const ffmpeg = input.ffmpeg
  if (!ffmpeg?.version) problems.push("resources/bin/ffmpeg is missing; run apps/desktop/scripts/build-ffmpeg.sh <work dir> apps/desktop/resources/bin")
  else if (ffmpeg.version !== BUNDLED_FFMPEG) problems.push(`resources/bin/ffmpeg is ${ffmpeg.version}, not ${BUNDLED_FFMPEG}; rebuild it with apps/desktop/scripts/build-ffmpeg.sh`)
  else if (ffmpeg.missing.length > 0) {
    problems.push(
      `resources/bin/ffmpeg lacks ${ffmpeg.missing.join(", ")}, which the app needs; rebuild it with apps/desktop/scripts/build-ffmpeg.sh <work dir> apps/desktop/resources/bin`,
    )
  }
  if (!input.local && input.licensing) {
    if (!input.licenseServer) problems.push("BOXBLACK_LICENSE_SERVER is not set")
    else if (!input.licenseServer.startsWith("https://")) problems.push("BOXBLACK_LICENSE_SERVER must use https")
    if (input.keyKind !== "production") problems.push("the app still has the development license key; run node scripts/license-keys.ts --production")
  }
  if (input.updateUrl) {
    if (!input.updateUrl.startsWith("https://")) problems.push("BOXBLACK_UPDATE_URL must use https")
    else if (!input.signing) {
      problems.push("BOXBLACK_UPDATE_URL needs a Developer ID signature (CSC_NAME or CSC_LINK): macOS will not install updates into an unsigned app")
    }
  }
  if (!input.local) {
    if (!/^[0-9a-f]{64}$/.test(input.graphicsPackSha)) {
      problems.push(
        input.graphicsPackSha
          ? "GRAPHICS_PACK.sha256 in src/shared/graphics-pack.ts is not a 64-character hex sha256; rebuild the pack with apps/desktop/scripts/build-graphics-pack.sh <work dir> <out dir> and paste its sha256 and bytes"
          : "GRAPHICS_PACK.sha256 in src/shared/graphics-pack.ts is empty; run apps/desktop/scripts/build-graphics-pack.sh <work dir> <out dir> and paste its sha256 and bytes",
      )
    }
    if (input.graphicsPackBytes <= 0) {
      problems.push("GRAPHICS_PACK.bytes in src/shared/graphics-pack.ts must be the pack's size in bytes; paste the bytes apps/desktop/scripts/build-graphics-pack.sh printed alongside the sha256")
    }
    if (input.graphicsPackUrl.includes("/OWNER/")) {
      problems.push("GRAPHICS_PACK.url in src/shared/graphics-pack.ts still has no owner; set it to where the pack is published")
    }
  }
  return problems
}

/**
 * What is wrong with the script every graphic's page ends with (resources/graphics/host.js, which
 * electron-builder ships with the rest of resources/graphics): it is not there, cannot be read, or
 * holds nothing. Without it no graphic renders on the customer's machine.
 */
export function hostProblems(file: string): string[] {
  let script = ""
  try {
    script = readFileSync(file, "utf8")
  } catch {
    // not there, or not a file that can be read: as good as empty
  }
  return script.trim() === "" ? ["resources/graphics/host.js is missing or empty; every graphic's page ends with it, and none renders without it"] : []
}

/** The most stray entries of the graphics folder a refusal names; the rest are counted. */
const STRAYS_NAMED = 5

/**
 * What is wrong with resources/graphics beyond its host script: electron-builder ships the folder whole, so
 * anything else in it (the old kit's emoji pictures put back are 55 MB) would go into every customer's app
 * without a word. Whatever else sits in the folder is named, a folder with a slash after it, the first few of many;
 * the .DS_Store the Finder leaves behind is let be. A folder that is not there holds nothing: the missing host
 * script is `hostProblems`' to say.
 */
export function strayGraphicsProblems(dir: string): string[] {
  let entries: { name: string; isDirectory(): boolean }[] = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // no folder to look in
  }
  const strays = entries
    .filter((entry) => entry.name !== "host.js" && entry.name !== ".DS_Store")
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
  if (strays.length === 0) return []
  const named = strays.slice(0, STRAYS_NAMED).join(", ")
  const found = strays.length > STRAYS_NAMED ? `${named} and ${strays.length - STRAYS_NAMED} more` : named
  return [`${found} in resources/graphics; the whole folder ships with the app, so take out everything but host.js`]
}

type Run = (command: string, args: string[]) => Promise<string>

const runTool: Run = async (command, args) => {
  const { stdout, stderr } = await runProcess(command, args)
  return `${stdout}\n${stderr}`
}

/** HyperFrames reads its frames through fd and pipe, and ffmpeg writes files and pipes too. */
const REQUIRED_PROTOCOLS = ["file", "pipe", "fd"]

/** The protocols a `-protocols` listing names under both Input: and Output:. */
function readWriteProtocols(listing: string): Set<string> {
  const sections: Record<string, Set<string>> = { "Input:": new Set(), "Output:": new Set() }
  let current: Set<string> | undefined
  for (const line of listing.split("\n")) {
    const word = line.trim()
    if (word in sections) current = sections[word]
    else if (word && current) current.add(word)
  }
  return new Set([...sections["Input:"]!].filter((name) => sections["Output:"]!.has(name)))
}

/**
 * Asks the shipped ffmpeg what it can do. Its version alone cannot tell builds apart: the one
 * from before graphics was 8.1.2 as well, yet the app refuses to analyse with it. So this runs the
 * same check the app runs at startup (inspectTools), plus the protocols graphics stream through.
 */
export async function inspectShippedFfmpeg(path: string, run: Run = runTool): Promise<ShippedFfmpeg> {
  const report = (await inspectTools({ ffmpeg: path, ffprobe: null, whisper: null, claude: null }, run)).ffmpeg
  if (!report?.version) return null
  const protocols = readWriteProtocols(await run(path, ["-hide_banner", "-protocols"]).catch(() => ""))
  const missingProtocols = REQUIRED_PROTOCOLS.filter((name) => !protocols.has(name)).map((name) => `${name} protocol`)
  return { version: report.version, missing: [...report.missing, ...missingProtocols] }
}

type FetchPack = (url: string) => Promise<Response>

/**
 * Downloads the published pack and refuses unless it is the archive GRAPHICS_PACK describes. Its
 * sha256 and bytes are pasted by hand, and the pack build is not reproducible (file times change
 * the tarball on every run), so values from one build and an upload from another look equally
 * valid until a customer's download fails its checksum.
 */
export async function publishedPackProblems(pack: { url: string; sha256: string; bytes: number }, fetchPack: FetchPack = fetch): Promise<string[]> {
  let response: Response
  try {
    // no explicit timeout: undici's default 300s header and body timeouts already bound a stall,
    // without cutting off a slow 160 MB download
    response = await fetchPack(pack.url)
  } catch (error) {
    return [`could not download ${pack.url}: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    return [`${pack.url} answered ${response.status}, not 200: upload the archive build-graphics-pack.sh built to that release`]
  }
  if (!response.body) {
    return [`${pack.url} answered 200 with no body to read: upload the archive build-graphics-pack.sh built to that release`]
  }
  // hashed as it arrives: the pack is about 160 MB
  const hash = createHash("sha256")
  let bytes = 0
  const reader = response.body.getReader()
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      hash.update(chunk.value)
      bytes += chunk.value.byteLength
    }
  } catch (error) {
    return [`the download of ${pack.url} broke off: ${error instanceof Error ? error.message : String(error)}`]
  }
  const sha256 = hash.digest("hex")
  const problems: string[] = []
  if (sha256 !== pack.sha256) {
    problems.push(
      `GRAPHICS_PACK.sha256 is ${pack.sha256}, but the pack published at ${pack.url} hashes to ${sha256}: publish the archive build-graphics-pack.sh printed that sha256 for, or paste the sha256 and bytes of the archive that is published`,
    )
  }
  if (bytes !== pack.bytes) {
    problems.push(`GRAPHICS_PACK.bytes is ${pack.bytes}, but the pack published at ${pack.url} is ${bytes} bytes; paste the bytes build-graphics-pack.sh printed alongside the sha256`)
  }
  return problems
}

/** The notice the whisper build script writes, which is the only place the shipped build names its version. */
function shippedWhisper(): string | null {
  const bin = join(import.meta.dirname, "../resources/bin")
  if (!existsSync(join(bin, "whisper-cli"))) return null
  try {
    return readFileSync(join(bin, "WHISPER-NOTICE.txt"), "utf8").split("\n")[0] ?? null
  } catch {
    return null
  }
}

/**
 * The whole check, pulled out of the CLI block below so a test can drive it without a real ffmpeg
 * binary or a real 160 MB download: build the problem list, then -- only once nothing else is
 * wrong and this is not a local test build -- check the published pack too. `graphicsPack` defaults
 * to the real GRAPHICS_PACK; a test overrides it to reach the download check without needing the
 * committed constant to already have its OWNER placeholder filled in. `graphicsDir` defaults to the
 * shipped graphics folder, which holds the host script; a test points it at a folder of its own.
 */
export async function runReleaseCheck({
  local,
  env,
  fetchPack = fetch,
  run = runTool,
  graphicsPack = GRAPHICS_PACK,
  graphicsDir = join(import.meta.dirname, "../resources/graphics"),
}: {
  local: boolean
  env: NodeJS.ProcessEnv
  fetchPack?: FetchPack
  run?: Run
  graphicsPack?: GraphicsPackSpec
  graphicsDir?: string
}): Promise<{ problems: string[]; message: string }> {
  const problems = releaseProblems({
    local,
    licenseServer: env.BOXBLACK_LICENSE_SERVER ?? "",
    keyKind: LICENSE_KEY_KIND,
    updateUrl: env.BOXBLACK_UPDATE_URL ?? "",
    signing: Boolean(env.CSC_NAME || env.CSC_LINK),
    ffmpeg: await inspectShippedFfmpeg(join(import.meta.dirname, "../resources/bin/ffmpeg"), run),
    licensing: LICENSING,
    whisperFormula: WHISPER_TAP_FORMULA,
    whisper: shippedWhisper(),
    graphicsPackSha: graphicsPack.sha256,
    graphicsPackBytes: graphicsPack.bytes,
    graphicsPackUrl: graphicsPack.url,
  })
  // every build, test builds too: no graphic renders without the host script, and whatever else the folder holds ships with it
  problems.push(...hostProblems(join(graphicsDir, "host.js")), ...strayGraphicsProblems(graphicsDir))
  // last, and only once everything else holds: until then the url may have no owner, and 160 MB
  // is a lot to fetch for a build that is refused anyway
  if (!local && problems.length === 0) {
    console.log(`checking the graphics pack published at ${graphicsPack.url} (${graphicsPack.bytes} bytes)...`)
    problems.push(...(await publishedPackProblems(graphicsPack, fetchPack)))
  }
  if (problems.length > 0) return { problems, message: `release build refused:\n- ${problems.join("\n- ")}` }
  const licensing = LICENSING ? `license server: ${env.BOXBLACK_LICENSE_SERVER || "http://localhost:3100"}, key: ${LICENSE_KEY_KIND}` : "no licensing"
  return { problems, message: `release check passed (${licensing}, ffmpeg: ${BUNDLED_FFMPEG}, whisper: ${PINNED_WHISPER_VERSION}, graphics pack: ${graphicsPack.version})` }
}

if (import.meta.main) {
  const { problems, message } = await runReleaseCheck({ local: process.argv.includes("--local"), env: process.env })
  if (problems.length > 0) {
    console.error(message)
    process.exit(1)
  }
  console.log(message)
}
