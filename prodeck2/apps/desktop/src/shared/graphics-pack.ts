/**
 * The renderer pack BOXBLACK downloads the first time graphics are used: HyperFrames with its
 * dependencies, the Chrome headless shell it drives, and the Node that runs it, each at the version
 * the app was tested with. Built by scripts/build-graphics-pack.sh, which prints the sha256 and bytes
 * to paste here; the pack is published next to the DMG. Plain data: the preload bundle imports it.
 */

/** The Node build the pack ships; the build script's NODE_VERSION must say the same (a test checks). */
export const PACK_NODE_VERSION = "24.21.0"

/** The HyperFrames release the pack ships; the build script's HYPERFRAMES_VERSION must say the same (a test checks). */
export const PACK_HYPERFRAMES_VERSION = "0.8.65"

/** The Chrome for Testing build the pack ships; the build script's CHROME_BUILD must say the same (a test checks). */
export const PACK_CHROME_BUILD = "152.0.7977.30"

export interface GraphicsPackSpec {
  /** embedded in the release tag (graphics-<version>) and the name of the folder the app installs the unpacked pack into */
  version: string
  /** where the app downloads the pack from: a GitHub release asset, tagged graphics-<version> */
  url: string
  /** hex sha256 of the .tar.gz; the release check refuses a customer build while it is "" */
  sha256: string
  /** shown before the download and drives the progress bar */
  bytes: number
  /** the Node binary, relative to the unpacked pack's root */
  node: string
  /** HyperFrames' CLI, run by that Node */
  hyperframes: string
  /** the Chrome headless shell HyperFrames drives (HYPERFRAMES_BROWSER_PATH) */
  chrome: string
}

export const GRAPHICS_PACK: GraphicsPackSpec = {
  version: "2026-09-24",
  url: "https://github.com/pharitdev-ctrl/boxblack/releases/download/graphics-2026-09-24/boxblack-graphics-2026-09-24-mac-arm64.tar.gz",
  sha256: "ff67038858ae897ef303d22b61e2ac860e10e998eeef1b4c62c05f942388e0fd",
  bytes: 162762816,
  node: "node/bin/node",
  hyperframes: "node_modules/hyperframes/bin/hyperframes.mjs",
  chrome: `chrome-headless-shell/mac_arm-${PACK_CHROME_BUILD}/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
}
