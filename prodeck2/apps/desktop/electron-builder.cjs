/**
 * macOS packaging. Without a Developer ID (the current plan) the app is ad-hoc signed — Apple
 * Silicon refuses to run unsigned code at all — and customers confirm the first launch in
 * System Settings. Setting CSC_NAME or CSC_LINK signs with a Developer ID instead; APPLE_TEAM_ID
 * (with APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD) also notarizes. See docs/customer-install.md.
 */
const { dirname, join } = require("node:path")

// npm workspaces hoist electron to the repo root; pack the copy already installed instead of downloading one
const electronPackage = require.resolve("electron/package.json")
const signing = Boolean(process.env.CSC_NAME || process.env.CSC_LINK)
const updateUrl = process.env.BOXBLACK_UPDATE_URL

module.exports = {
  appId: "com.thalent-ai.boxblack",
  electronVersion: require(electronPackage).version,
  electronDist: join(dirname(electronPackage), "dist"),
  productName: "BOXBLACK",
  copyright: "© 2026 Thalent AI",
  directories: { output: "release", buildResources: "build" },
  // everything, dependencies included, is bundled into out/ by electron-vite
  files: ["out/**/*", "package.json"],
  // fonts for highlight text, copied under ~/Movies at write time (CapCut cannot read inside the app);
  // ffmpeg and ffprobe, built by scripts/build-ffmpeg.sh, with their LGPL notice;
  // the graphics host (host.js), read by core's motionAssets and inlined into the page of every graphic HyperFrames renders
  extraResources: [
    { from: "resources/fonts", to: "fonts" },
    { from: "resources/bin", to: "bin" },
    { from: "resources/graphics", to: "graphics" },
  ],
  asar: true,
  npmRebuild: false,
  // switch off the ways to run other code inside the app; the renderer still loads from file://
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    enableCookieEncryption: true,
  },
  mac: {
    target: [
      { target: "dmg", arch: ["arm64"] },
      // Squirrel.Mac updates from the zip
      { target: "zip", arch: ["arm64"] },
    ],
    category: "public.app-category.video",
    artifactName: "boxblack-${version}-arm64-mac.${ext}",
    minimumSystemVersion: "12.0",
    // "-" is ad-hoc signing; left unset, electron-builder would pick any certificate in the keychain
    identity: signing ? undefined : "-",
    hardenedRuntime: signing,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize: signing && Boolean(process.env.APPLE_TEAM_ID),
    extendInfo: {
      NSDownloadsFolderUsageDescription: "BOXBLACK อ่านไฟล์วิดีโอที่อยู่ใน media bin ของโปรเจค CapCut",
      NSDesktopFolderUsageDescription: "BOXBLACK อ่านไฟล์วิดีโอที่อยู่ใน media bin ของโปรเจค CapCut",
      NSDocumentsFolderUsageDescription: "BOXBLACK อ่านไฟล์วิดีโอที่อยู่ใน media bin ของโปรเจค CapCut",
      NSRemovableVolumesUsageDescription: "BOXBLACK อ่านไฟล์วิดีโอบนไดรฟ์ภายนอกที่ใช้ในโปรเจค CapCut",
      NSNetworkVolumesUsageDescription: "BOXBLACK อ่านไฟล์วิดีโอบนไดรฟ์เครือข่ายที่ใช้ในโปรเจค CapCut",
    },
  },
  dmg: {
    artifactName: "boxblack-${version}-arm64.${ext}",
    title: "BOXBLACK ${version}",
  },
  publish: updateUrl ? [{ provider: "generic", url: updateUrl }] : null,
}
