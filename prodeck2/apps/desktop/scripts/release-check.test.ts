import { afterEach, expect, test } from "vitest"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PINNED_WHISPER_VERSION } from "../src/shared/whisper-tap.ts"
import { GRAPHICS_PACK, PACK_CHROME_BUILD, PACK_HYPERFRAMES_VERSION, PACK_NODE_VERSION } from "../src/shared/graphics-pack.ts"
import { BUNDLED_FFMPEG, hostProblems, inspectShippedFfmpeg, publishedPackProblems, releaseProblems, runReleaseCheck, strayGraphicsProblems } from "./release-check.ts"

const ready = {
  local: false,
  licenseServer: "https://license.example.com",
  keyKind: "production",
  updateUrl: "",
  signing: false,
  ffmpeg: { version: BUNDLED_FFMPEG, missing: [] as string[] },
  licensing: true,
  whisperFormula: "thalent-ai/boxblack/boxblack-whisper",
  whisper: `BOXBLACK ships whisper-cli from whisper.cpp ${PINNED_WHISPER_VERSION} (https://github.com/ggml-org/whisper.cpp),`,
  graphicsPackSha: "a3f5c9e1b7d2468890abcdef1234567890abcdef1234567890abcdef1234567a",
  graphicsPackBytes: 166685398,
  graphicsPackUrl: "https://github.com/thalent-ai/boxblack/releases/download/graphics-2026-09-24/boxblack-graphics-2026-09-24-mac-arm64.tar.gz",
}

test("a customer build needs the real license server over https and the production key", () => {
  expect(releaseProblems(ready)).toEqual([])
  expect(releaseProblems({ ...ready, licenseServer: "" })).toEqual(["BOXBLACK_LICENSE_SERVER is not set"])
  expect(releaseProblems({ ...ready, licenseServer: "http://license.example.com" })).toEqual(["BOXBLACK_LICENSE_SERVER must use https"])
  expect(releaseProblems({ ...ready, keyKind: "development" })).toEqual([
    "the app still has the development license key; run node scripts/license-keys.ts --production",
  ])
})

test("updates can only be switched on for signed builds", () => {
  expect(releaseProblems({ ...ready, updateUrl: "https://updates.example.com/BOXBLACK" })).toEqual([
    "BOXBLACK_UPDATE_URL needs a Developer ID signature (CSC_NAME or CSC_LINK): macOS will not install updates into an unsigned app",
  ])
  expect(releaseProblems({ ...ready, updateUrl: "https://updates.example.com/BOXBLACK", signing: true })).toEqual([])
  expect(releaseProblems({ ...ready, updateUrl: "http://updates.example.com", signing: true })).toEqual(["BOXBLACK_UPDATE_URL must use https"])
})

test("a local test build may use the development key and a local server", () => {
  expect(releaseProblems({ ...ready, local: true, licenseServer: "", keyKind: "development" })).toEqual([])
})

test("no build leaves without the ffmpeg the app was tested with, local test builds included", () => {
  const missing = `resources/bin/ffmpeg is missing; run apps/desktop/scripts/build-ffmpeg.sh <work dir> apps/desktop/resources/bin`
  expect(releaseProblems({ ...ready, ffmpeg: null })).toEqual([missing])
  expect(releaseProblems({ ...ready, local: true, licenseServer: "", keyKind: "development", ffmpeg: null })).toEqual([missing])
  expect(releaseProblems({ ...ready, ffmpeg: { version: "9.0.2", missing: [] } })).toEqual([
    `resources/bin/ffmpeg is 9.0.2, not ${BUNDLED_FFMPEG}; rebuild it with apps/desktop/scripts/build-ffmpeg.sh`,
  ])
})

test("no build leaves with an ffmpeg that cannot do what the app asks of it, even at the right version", () => {
  // the build before graphics was 8.1.2 too: only what it can do tells the two apart
  expect(releaseProblems({ ...ready, ffmpeg: { version: BUNDLED_FFMPEG, missing: ["prores_ks", "png", "mov", "fd protocol"] } })).toEqual([
    "resources/bin/ffmpeg lacks prores_ks, png, mov, fd protocol, which the app needs; rebuild it with apps/desktop/scripts/build-ffmpeg.sh <work dir> apps/desktop/resources/bin",
  ])
  expect(
    releaseProblems({ ...ready, local: true, licenseServer: "", keyKind: "development", ffmpeg: { version: BUNDLED_FFMPEG, missing: ["scdet"] } }),
  ).toHaveLength(1)
})

// Listings in the shape the shipped ffmpeg prints them, holding exactly what the app needs.
const FILTERS = ` Filters:
  T.. = Timeline support
  ------
 .. scdet             V->V       Detect video scene change.
 .S blackdetect       V->V       Detect video intervals that are (almost) black.
 .S freezedetect      V->V       Detect frozen video.
 .. blurdetect        V->V       Blur detection filter.
 .. silencedetect     A->A       Detect silence.
 .. ebur128           A->N       EBU R128 scanner.
 .. fps               V->V       Force constant framerate.
 .. scale             V->V       Scale the input video size and/or convert the image format.
 T. metadata          V->V       Manipulate video frame metadata.
`
const ENCODERS = ` Encoders:
 ------
 V....D mjpeg                MJPEG (Motion JPEG)
 V....D wrapped_avframe      AVFrame to AVPacket passthrough
 V....D prores_ks            Apple ProRes (iCodec Kostya)
 V....D png                  PNG (Portable Network Graphics) image
 A....D flac                 FLAC (Free Lossless Audio Codec)
 A....D pcm_s16le            PCM signed 16-bit little-endian
`
const MUXERS = ` Formats:
 D.. = Demuxing supported
 .E. = Muxing supported
 ---
  E  flac            raw FLAC
  E  image2          image2 sequence
 DE  mov             QuickTime / MOV
  E  null            raw null video
  E  s16le           PCM signed 16-bit little-endian
 DE  wav             WAV / WAVE (Waveform Audio)
`
const PROTOCOLS = "Supported file protocols:\nInput:\n  fd\n  file\n  pipe\nOutput:\n  fd\n  file\n  pipe\n"

function fakeFfmpeg(listings: { version?: string; filters?: string; encoders?: string; muxers?: string; protocols?: string }) {
  const calls: string[][] = []
  const run = async (command: string, args: string[]) => {
    calls.push([command, ...args])
    const flag = args.find((arg) => arg !== "-hide_banner")
    if (flag === "-version") return listings.version ?? `ffmpeg version ${BUNDLED_FFMPEG} Copyright (c) 2000-2026 the FFmpeg developers\n`
    if (flag === "-filters") return listings.filters ?? FILTERS
    if (flag === "-encoders") return listings.encoders ?? ENCODERS
    if (flag === "-muxers") return listings.muxers ?? MUXERS
    if (flag === "-protocols") return listings.protocols ?? PROTOCOLS
    throw new Error(`unexpected ${args.join(" ")}`)
  }
  return { run, calls }
}

test("the shipped ffmpeg is judged by the app's own startup check plus the protocols graphics stream through", async () => {
  const complete = fakeFfmpeg({})
  expect(await inspectShippedFfmpeg("/app/resources/bin/ffmpeg", complete.run)).toEqual({ version: BUNDLED_FFMPEG, missing: [] })
  expect(complete.calls.every(([command]) => command === "/app/resources/bin/ffmpeg")).toBe(true)
  expect(complete.calls.map((call) => call.at(-1)).sort()).toEqual(["-encoders", "-filters", "-muxers", "-protocols", "-version"])

  // what the 8.1.2 build from before graphics prints: same version line, no ProRes, PNG, mov or fd
  const beforeGraphics = fakeFfmpeg({
    encoders: ENCODERS.replace(/.*prores_ks.*\n/, "").replace(/.*png.*\n/, ""),
    muxers: MUXERS.replace(/.*mov.*\n/, ""),
    protocols: "Supported file protocols:\nInput:\n  file\n  pipe\nOutput:\n  file\n  pipe\n",
  })
  expect(await inspectShippedFfmpeg("/app/resources/bin/ffmpeg", beforeGraphics.run)).toEqual({
    version: BUNDLED_FFMPEG,
    missing: ["prores_ks", "png", "mov", "fd protocol"],
  })

  // a protocol counts only when ffmpeg can both read and write through it
  const readOnlyPipe = fakeFfmpeg({ protocols: "Supported file protocols:\nInput:\n  fd\n  file\n  pipe\nOutput:\n  fd\n  file\n" })
  expect(await inspectShippedFfmpeg("/app/resources/bin/ffmpeg", readOnlyPipe.run)).toEqual({ version: BUNDLED_FFMPEG, missing: ["pipe protocol"] })
})

test("an ffmpeg that is not there, or does not run, counts as missing", async () => {
  const absent = async () => {
    throw Object.assign(new Error("spawn /app/resources/bin/ffmpeg ENOENT"), { code: "ENOENT" })
  }
  expect(await inspectShippedFfmpeg("/app/resources/bin/ffmpeg", absent)).toBeNull()
})

test("the version the check wants is the one the build script builds", () => {
  const script = readFileSync(join(import.meta.dirname, "build-ffmpeg.sh"), "utf8")
  expect(/^VERSION=(\S+)$/m.exec(script)?.[1]).toBe(BUNDLED_FFMPEG)
})

test("a customer build without licensing needs no license server and no production key", () => {
  expect(releaseProblems({ ...ready, licensing: false, licenseServer: "", keyKind: "development" })).toEqual([])
  // the rest still holds: the ffmpeg it was tested with, and no updates without a signature
  expect(releaseProblems({ ...ready, licensing: false, ffmpeg: null })).toHaveLength(1)
  expect(releaseProblems({ ...ready, licensing: false, updateUrl: "https://updates.example.com/BOXBLACK" })).toHaveLength(1)
})

test("no build tells customers to install from a tap that has no owner yet", () => {
  expect(releaseProblems({ ...ready, whisperFormula: "OWNER/boxblack/boxblack-whisper" })).toEqual([
    "WHISPER_TAP_FORMULA in src/shared/whisper-tap.ts still has no owner; set it to the GitHub account the tap is published under",
  ])
})

test("the pinned whisper version is the one the tap's formula builds", () => {
  const formula = readFileSync(join(import.meta.dirname, "../../../homebrew-tap/Formula/boxblack-whisper.rb"), "utf8")
  expect(/refs\/tags\/v(\S+)\.tar\.gz/.exec(formula)?.[1]).toBe(PINNED_WHISPER_VERSION)
})

test("no build leaves without the whisper-cli the app was tested with", () => {
  expect(releaseProblems({ ...ready, whisper: null })).toEqual([
    "resources/bin/whisper-cli is missing; run apps/desktop/scripts/build-whisper.sh <work dir> apps/desktop/resources/bin",
  ])
  expect(releaseProblems({ ...ready, whisper: "BOXBLACK ships whisper-cli from whisper.cpp 1.9.4 (https://github.com/ggml-org/whisper.cpp)," })).toEqual([
    `resources/bin/whisper-cli is 1.9.4, not ${PINNED_WHISPER_VERSION}; rebuild it with apps/desktop/scripts/build-whisper.sh`,
  ])
})

test("the whisper build script builds the pinned version", () => {
  const script = readFileSync(join(import.meta.dirname, "build-whisper.sh"), "utf8")
  expect(/^VERSION=(\S+)$/m.exec(script)?.[1]).toBe(PINNED_WHISPER_VERSION)
})

test("a customer build needs a built and published graphics pack", () => {
  expect(releaseProblems({ ...ready, graphicsPackSha: "" })).toEqual([
    "GRAPHICS_PACK.sha256 in src/shared/graphics-pack.ts is empty; run apps/desktop/scripts/build-graphics-pack.sh <work dir> <out dir> and paste its sha256 and bytes",
  ])
  expect(releaseProblems({ ...ready, graphicsPackUrl: "https://github.com/OWNER/boxblack/releases/download/graphics-2026-09-24/boxblack-graphics-2026-09-24-mac-arm64.tar.gz" })).toEqual([
    "GRAPHICS_PACK.url in src/shared/graphics-pack.ts still has no owner; set it to where the pack is published",
  ])
})

test("a customer build refuses a malformed sha256 or a non-positive byte count too", () => {
  expect(releaseProblems({ ...ready, graphicsPackSha: "not-a-sha256" })).toEqual([
    "GRAPHICS_PACK.sha256 in src/shared/graphics-pack.ts is not a 64-character hex sha256; rebuild the pack with apps/desktop/scripts/build-graphics-pack.sh <work dir> <out dir> and paste its sha256 and bytes",
  ])
  expect(releaseProblems({ ...ready, graphicsPackBytes: 0 })).toEqual([
    "GRAPHICS_PACK.bytes in src/shared/graphics-pack.ts must be the pack's size in bytes; paste the bytes apps/desktop/scripts/build-graphics-pack.sh printed alongside the sha256",
  ])
  expect(releaseProblems({ ...ready, graphicsPackBytes: -1 })).toEqual([
    "GRAPHICS_PACK.bytes in src/shared/graphics-pack.ts must be the pack's size in bytes; paste the bytes apps/desktop/scripts/build-graphics-pack.sh printed alongside the sha256",
  ])
})

test("a local test build does not need the graphics pack built or published", () => {
  expect(
    releaseProblems({
      ...ready,
      local: true,
      licenseServer: "",
      keyKind: "development",
      graphicsPackSha: "",
      graphicsPackBytes: 0,
      graphicsPackUrl: "https://github.com/OWNER/boxblack/releases/download/graphics-2026-09-24/boxblack-graphics-2026-09-24-mac-arm64.tar.gz",
    }),
  ).toEqual([])
})

test("the graphics pack build script builds the versions and paths GRAPHICS_PACK wants", () => {
  const script = readFileSync(join(import.meta.dirname, "build-graphics-pack.sh"), "utf8")
  const nodeVersion = /^NODE_VERSION=(\S+)$/m.exec(script)?.[1]
  const hyperframesVersion = /^HYPERFRAMES_VERSION=(\S+)$/m.exec(script)?.[1]
  const chromeBuild = /^CHROME_BUILD=(\S+)$/m.exec(script)?.[1]
  const packVersion = /^PACK_VERSION=(\S+)$/m.exec(script)?.[1]
  expect(nodeVersion).toBe(PACK_NODE_VERSION)
  expect(hyperframesVersion).toBe(PACK_HYPERFRAMES_VERSION)
  expect(chromeBuild).toBe(PACK_CHROME_BUILD)
  expect(packVersion).toBe(GRAPHICS_PACK.version)

  // the script builds this path with the shell variable unexpanded; substitute it before comparing
  const chromeRelPath = /^CHROME_REL_PATH="([^"]+)"$/m.exec(script)?.[1]
  expect(chromeRelPath?.replace("$CHROME_BUILD", chromeBuild ?? "")).toBe(GRAPHICS_PACK.chrome)

  expect(GRAPHICS_PACK.url.endsWith(`graphics-${packVersion}/boxblack-graphics-${packVersion}-mac-arm64.tar.gz`)).toBe(true)
})

test("the committed graphics-pack package.json pins hyperframes to the version the pack was tested with", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "graphics-pack/package.json"), "utf8"))
  expect(pkg.dependencies.hyperframes).toBe(PACK_HYPERFRAMES_VERSION)
})

// A stand-in for the published archive: the test never touches the network.
const PACK_BODY = new TextEncoder().encode("a pack tarball, abbreviated")
const PACK_SHA = createHash("sha256").update(PACK_BODY).digest("hex")
const published = { ...GRAPHICS_PACK, url: "https://github.com/thalent-ai/boxblack/releases/download/graphics-2026-09-24/pack.tar.gz", sha256: PACK_SHA, bytes: PACK_BODY.byteLength }

function servePack(body: BodyInit | null, status = 200) {
  const urls: string[] = []
  const fetchPack = async (url: string) => {
    urls.push(url)
    return new Response(body, { status })
  }
  return { fetchPack, urls }
}

test("a customer build passes when the published pack is byte for byte the one GRAPHICS_PACK describes", async () => {
  const server = servePack(PACK_BODY)
  expect(await publishedPackProblems(published, server.fetchPack)).toEqual([])
  expect(server.urls).toEqual([published.url])
})

test("a customer build is refused when the published pack is a different build than the sha256 and bytes pasted", async () => {
  // same size, different bytes: a pack rebuilt from the same inputs differs only in its file times
  const other = new TextEncoder().encode("a pack tarball, abbreviatee")
  const otherSha = createHash("sha256").update(other).digest("hex")
  expect(await publishedPackProblems(published, servePack(other).fetchPack)).toEqual([
    `GRAPHICS_PACK.sha256 is ${PACK_SHA}, but the pack published at ${published.url} hashes to ${otherSha}: publish the archive build-graphics-pack.sh printed that sha256 for, or paste the sha256 and bytes of the archive that is published`,
  ])

  // the right archive, with a mistyped size: the app would show the wrong size and progress
  expect(await publishedPackProblems({ ...published, bytes: PACK_BODY.byteLength + 1 }, servePack(PACK_BODY).fetchPack)).toEqual([
    `GRAPHICS_PACK.bytes is ${PACK_BODY.byteLength + 1}, but the pack published at ${published.url} is ${PACK_BODY.byteLength} bytes; paste the bytes build-graphics-pack.sh printed alongside the sha256`,
  ])

  const longer = new TextEncoder().encode("a pack tarball, not abbreviated at all")
  expect(await publishedPackProblems(published, servePack(longer).fetchPack)).toHaveLength(2)
})

test("a customer build is refused when the pack is not published, or cannot be downloaded in full", async () => {
  expect(await publishedPackProblems(published, servePack("Not Found", 404).fetchPack)).toEqual([
    `${published.url} answered 404, not 200: upload the archive build-graphics-pack.sh built to that release`,
  ])
  const offline = async () => {
    throw new TypeError("fetch failed")
  }
  expect(await publishedPackProblems(published, offline)).toEqual([`could not download ${published.url}: fetch failed`])

  let sent = false
  const brokenOff = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(PACK_BODY.slice(0, 4))
      } else controller.error(new Error("socket hang up"))
    },
  })
  expect(await publishedPackProblems(published, servePack(brokenOff).fetchPack)).toEqual([`the download of ${published.url} broke off: socket hang up`])
})

test("a customer build is refused on any answer but 200, even one carrying the right bytes", async () => {
  // a 206 is part of a file: that it happens to hash right says nothing of what a customer's download gets
  expect(await publishedPackProblems(published, servePack(PACK_BODY, 206).fetchPack)).toEqual([
    `${published.url} answered 206, not 200: upload the archive build-graphics-pack.sh built to that release`,
  ])
})

test("a 200 response with no body gets its own message, not a confusing 'answered 200, not 200'", async () => {
  expect(await publishedPackProblems(published, servePack(null).fetchPack)).toEqual([
    `${published.url} answered 200 with no body to read: upload the archive build-graphics-pack.sh built to that release`,
  ])
})

test("runReleaseCheck downloads the published pack only once nothing else is wrong, and never for a local build", async () => {
  const working = fakeFfmpeg({})
  const wrongVersion = fakeFfmpeg({ version: "ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers\n" })
  const body = new TextEncoder().encode("a small stand-in pack")
  const graphicsPack = { ...GRAPHICS_PACK, url: "https://example.test/pack.tar.gz", sha256: createHash("sha256").update(body).digest("hex"), bytes: body.byteLength }

  // a local build never checks the published pack, whatever else is true
  const local = servePack(body)
  const localResult = await runReleaseCheck({ local: true, env: {}, run: working.run, fetchPack: local.fetchPack, graphicsPack })
  expect(localResult.problems).toEqual([])
  expect(local.urls).toEqual([])

  // a non-local build with a problem of its own never reaches the download either
  const skipped = servePack(body)
  const brokenResult = await runReleaseCheck({ local: false, env: {}, run: wrongVersion.run, fetchPack: skipped.fetchPack, graphicsPack })
  expect(brokenResult.problems).toEqual([`resources/bin/ffmpeg is 9.0.2, not ${BUNDLED_FFMPEG}; rebuild it with apps/desktop/scripts/build-ffmpeg.sh`])
  expect(skipped.urls).toEqual([])

  // only once everything else holds does it download, and then exactly once
  const clean = servePack(body)
  const cleanResult = await runReleaseCheck({ local: false, env: {}, run: working.run, fetchPack: clean.fetchPack, graphicsPack })
  expect(cleanResult.problems).toEqual([])
  expect(clean.urls).toEqual([graphicsPack.url])
  expect(cleanResult.message).toBe(`release check passed (no licensing, ffmpeg: ${BUNDLED_FFMPEG}, whisper: ${PINNED_WHISPER_VERSION}, graphics pack: ${graphicsPack.version})`)
})

/** The folders a test made, removed after each test. */
const made: string[] = []
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** An empty folder to stand for resources/graphics. */
function graphicsFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "host-check-"))
  made.push(dir)
  return dir
}

const NO_HOST = "resources/graphics/host.js is missing or empty; every graphic's page ends with it, and none renders without it"

test("the script every graphic's page ends with must be shipped, and must not be empty", () => {
  const dir = graphicsFolder()
  const host = join(dir, "host.js")
  expect(hostProblems(host)).toEqual([NO_HOST])
  writeFileSync(host, "")
  expect(hostProblems(host)).toEqual([NO_HOST])
  // white space alone is no script either
  writeFileSync(host, " \n\t\n")
  expect(hostProblems(host)).toEqual([NO_HOST])
  writeFileSync(host, "window.__timelines = {}\n")
  expect(hostProblems(host)).toEqual([])
  // a folder of that name is no script
  const folder = join(dir, "other", "host.js")
  mkdirSync(folder, { recursive: true })
  expect(hostProblems(folder)).toEqual([NO_HOST])
})

test("the host script in the repo passes, and nothing sits beside it", () => {
  expect(hostProblems(join(import.meta.dirname, "../resources/graphics/host.js"))).toEqual([])
  expect(strayGraphicsProblems(join(import.meta.dirname, "../resources/graphics"))).toEqual([])
})

/** What the check says of a graphics folder that holds more than the host script. */
const strays = (found: string) => `${found} in resources/graphics; the whole folder ships with the app, so take out everything but host.js`

test("the graphics folder ships whole, so it may hold the host script and nothing else: whatever sits beside it is named", () => {
  const dir = graphicsFolder()
  writeFileSync(join(dir, "host.js"), "window.__timelines = {}\n")
  expect(strayGraphicsProblems(dir)).toEqual([])
  // what the Finder leaves in a folder it has shown is no part of the app, and is not shipped by mistake either
  writeFileSync(join(dir, ".DS_Store"), "")
  expect(strayGraphicsProblems(dir)).toEqual([])
  // the old kit's pictures put back, a folder of 55 MB, and one of its scripts: named in order, a folder as a folder
  mkdirSync(join(dir, "emoji"))
  writeFileSync(join(dir, "emoji", "1f680.png"), "png")
  writeFileSync(join(dir, "kit.js"), "")
  expect(strayGraphicsProblems(dir)).toEqual([strays("emoji/, kit.js")])
  // a copy of the host under another name is one more file that would ship
  writeFileSync(join(dir, "host.js.bak"), "")
  expect(strayGraphicsProblems(dir)).toEqual([strays("emoji/, host.js.bak, kit.js")])
  // many are named in part, and counted
  for (const name of ["a.css", "b.css", "c.css", "d.css"]) writeFileSync(join(dir, name), "")
  expect(strayGraphicsProblems(dir)).toEqual([strays("a.css, b.css, c.css, d.css, emoji/ and 2 more")])
  // a folder that is not there holds nothing: the missing host script is the other check's to say
  expect(strayGraphicsProblems(join(dir, "gone"))).toEqual([])
  // nor does a folder with no host script in it hide what else it holds
  const hostless = graphicsFolder()
  writeFileSync(join(hostless, "timeline.js"), "")
  expect(strayGraphicsProblems(hostless)).toEqual([strays("timeline.js")])
})

test("runReleaseCheck refuses every build without the host script, or with anything beside it, before any download", async () => {
  const graphicsDir = graphicsFolder()
  const hostFile = join(graphicsDir, "host.js")
  const body = new TextEncoder().encode("a small stand-in pack")
  const graphicsPack = { ...GRAPHICS_PACK, url: "https://example.test/pack.tar.gz", sha256: createHash("sha256").update(body).digest("hex"), bytes: body.byteLength }

  const local = await runReleaseCheck({ local: true, env: {}, run: fakeFfmpeg({}).run, fetchPack: servePack(body).fetchPack, graphicsPack, graphicsDir })
  expect(local.problems).toEqual([NO_HOST])
  expect(local.message).toBe(`release build refused:\n- ${NO_HOST}`)

  const customer = servePack(body)
  const refused = await runReleaseCheck({ local: false, env: {}, run: fakeFfmpeg({}).run, fetchPack: customer.fetchPack, graphicsPack, graphicsDir })
  expect(refused.problems).toEqual([NO_HOST])
  expect(customer.urls).toEqual([])

  // with the script there, both builds pass, and the customer build goes on to the download
  writeFileSync(hostFile, "window.__timelines = {}\n")
  expect((await runReleaseCheck({ local: true, env: {}, run: fakeFfmpeg({}).run, fetchPack: servePack(body).fetchPack, graphicsPack, graphicsDir })).problems).toEqual([])
  expect((await runReleaseCheck({ local: false, env: {}, run: fakeFfmpeg({}).run, fetchPack: customer.fetchPack, graphicsPack, graphicsDir })).problems).toEqual([])
  expect(customer.urls).toEqual([graphicsPack.url])

  // something put back beside the script refuses both builds again, and nothing more is downloaded
  mkdirSync(join(graphicsDir, "emoji"))
  expect((await runReleaseCheck({ local: true, env: {}, run: fakeFfmpeg({}).run, fetchPack: servePack(body).fetchPack, graphicsPack, graphicsDir })).problems).toEqual([strays("emoji/")])
  expect((await runReleaseCheck({ local: false, env: {}, run: fakeFfmpeg({}).run, fetchPack: customer.fetchPack, graphicsPack, graphicsDir })).problems).toEqual([strays("emoji/")])
  expect(customer.urls).toEqual([graphicsPack.url])
  // and with no script as well, both are said, the script first
  rmSync(hostFile)
  expect((await runReleaseCheck({ local: true, env: {}, run: fakeFfmpeg({}).run, fetchPack: servePack(body).fetchPack, graphicsPack, graphicsDir })).problems).toEqual([NO_HOST, strays("emoji/")])
})
