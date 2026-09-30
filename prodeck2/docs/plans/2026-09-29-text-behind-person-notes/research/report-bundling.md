Report: what shipping a Swift Vision person-segmentation helper in BOXBLACK would take (read-only in the repo; everything built or run stayed in scratchpad/cutout/explore/)

**Headline:** a helper is cheap and fits the existing pattern. `segment-seq.swift` compiles as-is. A macOS 12 build is about 80–97 KB, thin arm64, links only macOS system libraries, and ran at about 36 ms per frame on this machine. Two things must be right, or it fails quietly:
- **Compile target.** A default `swiftc` build gets `minos 27.0` and would not run on macOS 12–26. You must pass `-target arm64-apple-macos12.0`.
- **Resolver in dev.** The app's "bundled" folder is not found in dev, so a helper with no Homebrew copy is never found there (details in section 2).

## 1. How native tools are packaged now
- **Config file:** electron-builder is configured in `apps/desktop/electron-builder.cjs`, not in package.json. `apps/desktop/package.json` only has the scripts: `dist` = `node scripts/release-check.ts && electron-vite build && electron-builder --mac` (package.json:14), and `dist:local` does the same with `--local` (:15).
- **extraResources:** `resources/bin` → `Resources/bin` (electron-builder.cjs:28), alongside fonts (:27) and graphics (:29).
- **asar:** `asar: true` (:31). There is no `asarUnpack`, and none is needed because `bin` sits outside the asar. `files` covers only `out/**/*` and `package.json` (:22).
- **mac target:** dmg and zip, **arm64 only** (:43-47). `minimumSystemVersion: "12.0"` (:50), so the app already meets Vision's macOS 12 requirement and needs no runtime OS gate.
- **Signing:**
  - Without CSC_NAME/CSC_LINK the identity is `"-"` (ad-hoc) (:11, :52).
  - `hardenedRuntime` is on only when signing with a Developer ID (:53).
  - Entitlements and entitlementsInherit both point to `build/entitlements.mac.plist` (:54-55). That file holds only allow-jit and allow-unsigned-executable-memory (entitlements.mac.plist:6-9), and there is no app sandbox.
  - Notarization runs only when signing and APPLE_TEAM_ID is set (:56).
- **What the last build shows:** in `release/mac-arm64/BOXBLACK.app/Contents/Resources/bin`, electron-builder re-signed ffmpeg and whisper-cli ad-hoc (`Signature=adhoc`, identifier `ffmpeg-5555…`, no TeamIdentifier). A helper dropped into `resources/bin` would be signed the same way automatically.
- **Current contents of `resources/bin`:** ffmpeg (19.6 MB), ffprobe (19.4 MB), whisper-cli (3.3 MB), plus FFMPEG-COPYING.LGPLv2.1, FFMPEG-NOTICE.txt, WHISPER-LICENSE and WHISPER-NOTICE.txt.

## 2. How the app finds a bundled binary (dev vs packaged)
- **Tool lookup:**
  - `apps/desktop/src/main/index.ts:119` sets `bundledDirs = [join(process.resourcesPath, "bin")]` unconditionally.
  - :121-126 then calls `findExecutable(name, { bundledDirs, searchDirs: [~/.local/bin, ~/.claude/local] })`. For whisper-cli only, the tap folders are added.
- **Search order** in `packages/core/src/media/tools.ts:26`: bundledDirs → PATH → searchDirs → `/opt/homebrew/bin` and `/usr/local/bin` (:5). The first executable file wins (:27).
- **Dev behaviour:**
  - In dev, `process.resourcesPath` is `node_modules/electron/dist/Electron.app/Contents/Resources`, and I confirmed it has no `bin` folder.
  - So in dev, ffmpeg and whisper-cli come from Homebrew (`/opt/homebrew/bin/{ffmpeg,ffprobe,whisper-cli}` on this machine), not from `apps/desktop/resources/bin`.
  - The only dev-aware path is `resourcesDir` (index.ts:233): `app.isPackaged ? process.resourcesPath : join(import.meta.dirname, "../../resources")`. Fonts, graphics and emoji use it (:239, :249-250). The tool lookup does not.
  - **Consequence:** a helper that has no Homebrew copy must be resolved through `join(resourcesDir, "bin")` (or have that folder added to the lookup), or dev will never find it.
- **Toolbox:** `apps/desktop/src/main/tools.ts`.
  - `ToolPaths` is a fixed set: ffmpeg, ffprobe, whisper, claude (:4-9).
  - `scan()` looks up those fixed names (:29) and tags `bundled` and `pinned` by `dirname(path) ∈ bundledDirs` (:30-41).
  - `rescan()` (:50-53) is wired to the "ตรวจหาอีกครั้ง" button.
  - Main passes `bundledDirs` into the toolbox (index.ts:128-135), and its rescan clears graphics render failures (:134).
- **Availability check:** `packages/core/src/media/tool-check.ts`.
  - `ToolReport` (:35-42) is a fixed shape: ffmpeg `{path, version, missing, bundled?}`, ffprobe `{path}`, whisper `{path, usable, pinned?, bundled?}`, claude `{path, version}`.
  - `inspectTools` (:58-91) runs each binary: ffmpeg with `-version/-filters/-encoders/-muxers`, whisper with `--help` checked for `-dtw`, claude with `--version`. It never throws.
- **Settings row "เครื่องมือบนเครื่องนี้":**
  - `apps/desktop/src/renderer/src/components/ToolsCard.tsx`: `ToolRow` (:13-23), rows for ffmpeg (:38-55), whisper-cli (:56-79) and Claude Code (:80-84).
  - `anyMissing` covers only ffmpeg and whisper and drives the Homebrew hint (:29, :87). The rescan button is at :88-101.
  - Strings are in `renderer/src/i18n.ts:572-586`. `tools.bundled` = "มากับแอป · {version}" (:575), and `tools.hint` (:573) says ffmpeg and whisper-cli come with the app.
  - The data flows through `SettingsView.tools: ToolReport` (shared/api.ts:328), filled by `settings-api.ts:65` (`deps.toolbox.report()`), with `rescanTools` at :119.
  - `analysis.ts:122-124` turns a missing or incomplete ffmpeg into readiness problems (`problem.*` strings at i18n.ts:594-597).
  - `SettingsScreen.test.tsx:648` and :656 build full ToolReport objects, so a new required field would force fixture edits.

## 3. Build scripts and the release check
- **`scripts/build-ffmpeg.sh`:**
  - Usage: `<work dir> <out dir>` (:14).
  - Pins VERSION and SHA256 (:17-19) and sets `MACOS_MIN=12.0` (:20), passed as `-mmacosx-version-min` (:36).
  - Builds arm64 (:35), copies the binaries into OUT (:46) and writes a licence and notice beside them (:47-56).
- **`scripts/build-whisper.sh`:** same shape. Pins VERSION and SHA256 (:12-15), sets `CMAKE_OSX_DEPLOYMENT_TARGET=12.0` and `ARCHITECTURES=arm64` (:30-31), writes WHISPER-NOTICE.txt whose first line carries the version (:41-46), and smoke-tests the result (:47).
- **`scripts/release-check.ts`:**
  - `releaseProblems()` (:26-92): whisper-cli must be present with its notice version equal to `PINNED_WHISPER_VERSION` (:48-52). ffmpeg must be present, be version `BUNDLED_FFMPEG` (:21) and have nothing missing (:57-64). Both rules apply to **every build, `--local` included**.
  - `shippedWhisper()` reads the first line of WHISPER-NOTICE.txt (:213-221). `inspectShippedFfmpeg()` actually runs the binary (:155-161).
  - `runReleaseCheck()` assembles the inputs (:231-271), and the success message (:270) lists ffmpeg, whisper and graphics pack versions.
- **`scripts/release-check.test.ts`:** tests that each script's `VERSION=` equals the constant (:145-148, :177-180), missing/wrong-version messages (:47-60, :168-175), and the **exact** success message (:334).
- **Binary tests:**
  - `src/main/bundled-whisper.test.ts:28-33`: `otool -L` may show only `/usr/lib` or `/System/Library`, and `otool -l` must show `minos 12.0`.
  - `bundled-ffmpeg.test.ts:30-33`: the same `otool -L` rule.
  - Both skip themselves when the binary is absent (:16 and :24).
- **No separate notarize or sign scripts.** Signing and notarization are driven only by environment variables in electron-builder.cjs:2-5 and :52-56. `scripts/` holds no sign or notarize step.
- **Precedent for Swift:** `build/make-icon.swift`, run by hand with `swift` (:1-2).

## 4. Quarantine and "Open Anyway" (from the design spec M18)
- **Where it's recorded:** `docs/specs/2026-09-17-capcut-timeline-manager-design.md:355-358`. The memory note is prodeck2-design-decisions.md:27.
- **What was tested:** a copy of the app with `com.apple.quarantine` on every file, as a Safari download would have. Before approval, calling the bundled ffmpeg directly was **SIGKILLed** and `spctl` rejected it.
- **After Open Anyway:** the customer clicks it once in Privacy & Security, the app runs from AppTranslocation, and macOS changes the quarantine flag from `0081` to `00c1` **on the app and every file inside it**. The bundled ffmpeg then ran, called 4 times at startup, with no Developer ID needed.
- **Signature check:** the ad-hoc packaged app passed `codesign --verify --deep --strict` (:354). The customer steps are in `docs/customer-install.md:25`.
- **What this means for the helper:** a helper inside `Resources/bin` is covered by the same single Open Anyway, by the same mechanism. I did not re-test this for a Swift helper, so that is UNVERIFIED.
- **Two limits:**
  - This covers only files inside the bundle. A helper copied or downloaded to userData would not inherit the approval.
  - The graphics pack clears quarantine itself with `xattr -rc` (docs/plans/2026-09-24-graphics-overlay.md:463-467).

## 5. Swift toolchain and the compile test
- **Toolchain:**
  - `xcrun --find swiftc` → `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc`.
  - `swiftc --version` → Apple Swift 6.4 (swift-driver 1.168.6), target arm64-apple-macosx27.0.0.
  - SDK 27.0; this Mac runs macOS 27.0 (26A428) on arm64.
- **As-is build:** `swiftc segment-seq.swift -o explore/segment-seq` succeeded with no warnings in about 3.4 s.
  - 89,976 bytes, thin arm64 Mach-O, **`minos 27.0`**, linker-signed ad-hoc.
  - Links only `/usr/lib` and `/System/Library` (libSystem, Vision, CoreImage, CoreVideo, CoreGraphics, Foundation, `/usr/lib/swift/*`).
  - Not shippable as-is because of `minos 27.0`. The spike's own `vision/segment-seq` (68,520 bytes) is also minos 27.0.
- **macOS 12 build:** `swiftc -O -target arm64-apple-macos12.0` → `explore/segment-seq-macos12` compiled clean.
  - 97,104 bytes, arm64, **`minos 12.0`**, sdk 27.0, `LC_RPATH /usr/lib/swift`.
  - Links only system libraries and needs no bundled Swift runtime.
  - Because it compiled against a 12.0 target, Swift's compile-time availability checks passed for `VNGeneratePersonSegmentationRequest` and the other APIs it uses.
- **Stripped:** `strip -x` → `explore/segment-seq-macos12-stripped` is **80,464 bytes**. It kept a valid ad-hoc signature (`codesign --verify --strict` OK) and still runs.
- **Run test** (only on scratchpad JPEGs, output in `explore/run` and `explore/run2`):
  - `accurate` quality: first frame 114–124 ms including model load, then **35.9 ms per frame**.
  - Masks came out at **1512×2016 for both 360×640 and 540×960 inputs**, so Vision's accurate mask has a fixed size and aspect and must be scaled back to the source size.
  - With no arguments it exits 2, and prints its usage line to stdout rather than stderr.
- **Size impact:** negligible, compared with 19.6 MB for ffmpeg.

## 6. What a new bundled helper needs (proposal; nothing edited)
1. **Source:** for example `apps/desktop/native/segment/main.swift`, taken from the spike. Add a `--version` that prints `boxblack-segment <VERSION>`, and send usage and errors to stderr.
2. **Build script `scripts/build-segment.sh <out dir>`**, modelled on build-whisper.sh:
   - `MACOS_MIN=12.0` and `VERSION=`.
   - `xcrun swiftc -O -target arm64-apple-macos$MACOS_MIN … -o "$OUT/boxblack-segment"`, then `strip -x`.
   - A smoke test such as `--version`.
   - It needs no licence or notice file (our own code, system frameworks only). The build machine needs Xcode or the Command Line Tools; the customer's Mac needs nothing.
3. **Release-check rule** in `releaseProblems()`:
   - Refuse when `resources/bin/boxblack-segment` is missing or its `--version` is not the pinned constant, with a message telling the user to run the build script.
   - Add it to `runReleaseCheck` and to the success message at :270. That breaks the exact-string test at release-check.test.ts:334, which must be updated.
   - Add a test that the script's `VERSION=` equals the constant, as at :145 and :177.
   - Add `bundled-segment.test.ts`, like bundled-whisper.test.ts:28-33: `otool -L` system-only, `minos 12.0`, arm64.
4. **Resolver:**
   - Add the helper to `ToolPaths` and `scan()` in tools.ts (:4-9, :29), and to `ToolReport` and `inspectTools` in tool-check.ts (:35-42, :58-91). "Usable" would mean `--version` matches.
   - Or, simpler: resolve it only from `join(resourcesDir, "bin")`, because nothing outside the app should ever supply it.
   - Either way, fix the dev gap: index.ts:119 uses `process.resourcesPath` even in dev, whereas `resourcesDir` (:233) handles dev correctly.
5. **Settings row:** add a `ToolRow` to ToolsCard.tsx (after :79), shown as "มากับแอป · {version}" when bundled, with a reinstall message rather than a brew command when missing. Keep it out of `anyMissing` and the Homebrew hint (:29, :87). Add i18n keys near i18n.ts:572-586, update `tools.hint` (:573), and update the ToolReport fixtures in SettingsScreen.test.tsx:648 and :656.
6. **Gating:** optionally add a readiness or problem entry, as analysis.ts:122-124 does for ffmpeg, so the text-behind-person feature is refused when the helper is missing.
7. **Packaging:** no electron-builder change is needed. `resources/bin` already ships (electron-builder.cjs:28) and is ad-hoc re-signed.

## 7. UNVERIFIED
- Whether the helper runs and gives the same masks on real macOS 12–26 machines. Tested only on macOS 27; the fixed 1512×2016 mask size may differ by OS version.
- Whether Open Anyway approval covers the Swift helper. Proven for ffmpeg only.
- How the helper behaves under hardened runtime with a Developer ID signature and notarization. No Developer ID exists; I expect Vision needs no extra entitlement, but did not test it.
- Whether the Command Line Tools alone (without full Xcode) build it. This machine has full Xcode 27.
- Whether TCC permission prompts appear if the helper reads source videos directly instead of frames extracted to a temp folder by ffmpeg.

One stale note: the memory file says whisper-cli is not bundled (prodeck2-design-decisions.md:27), but the same file later says it is (line 29), and the repo agrees: whisper-cli is in `resources/bin` and release-check requires it.

Files are in `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/cutout/explore/`:
- segment-seq
- segment-seq-macos12
- segment-seq-macos12-stripped
- run/
- run2/