#!/bin/sh
# Builds the graphics renderer pack BOXBLACK downloads the first time graphics are used: a Node
# binary, HyperFrames 0.8.65 (Apache-2.0) with its dependencies, and the pinned Chrome headless
# shell HyperFrames drives to render the transparent ProRes overlays. Customers have neither Node
# nor Chrome, so every piece here is self-contained; the app's own ffmpeg (see build-ffmpeg.sh)
# still does the encoding. The Chrome build is installed pinned, with the @puppeteer/browsers CLI
# that ships inside HyperFrames' own dependencies, not HyperFrames' "browser ensure" (which would
# fetch "latest"). The paths this script writes into the pack must match GRAPHICS_PACK in
# src/shared/graphics-pack.ts exactly, since that constant is what the downloader looks for inside
# the pack once it is unpacked on a customer's machine.
#
# HyperFrames and its own dependency tree are pinned by apps/desktop/scripts/graphics-pack/, a
# small private package (package.json + a committed package-lock.json) installed with `npm ci`, so
# every transitive version is exactly the one this pack was built and smoke-tested with -- npm
# cannot silently resolve a newer transitive dependency the way a bare `npm install` could. To
# update the pin on purpose: bump the version in graphics-pack/package.json, run this script once so
# a Node tarball is extracted under the work dir (say <work>), then relock with the exact same
# isolation this script's own `npm ci` uses -- from apps/desktop/scripts/graphics-pack/:
#
#   env -i HOME="$HOME" PATH="<work>/node-v24.21.0-darwin-arm64/bin:/usr/bin:/bin" \
#     <work>/node-v24.21.0-darwin-arm64/bin/node \
#     <work>/node-v24.21.0-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js \
#     install --package-lock-only --omit=dev --no-audit --no-fund --no-update-notifier \
#     --userconfig /dev/null --registry=https://registry.npmjs.org/
#
# not a plain `npm install` with the developer's own npm, which could resolve different transitive
# versions or run install scripts under the wrong Node. Review the lock diff; if it moved esbuild to
# a different version, re-run `npm install-scripts approve esbuild` (package.json's "allowScripts"
# approval below is pinned to esbuild@0.25.12 exactly, and JSON has no comments to note that next to
# it, hence this paragraph). Then bump PACK_VERSION below before rebuilding. graphics-pack/ also
# carries the license texts for pieces of the pack that
# ship no license file of their own: HYPERFRAMES-LICENSE (Apache-2.0: HyperFrames itself,
# puppeteer-core, @puppeteer/browsers), LGPL-3.0.txt + GPL-3.0.txt (the LGPLv3 that
# @img/sharp-libvips-darwin-arm64 ships under incorporates the GPLv3 text by reference rather than
# including it, so both are needed to have the full terms on hand), and
# MIT-LICENSE-brotli-dfa-fontkit.txt (brotli, dfa and fontkit ship no license file anywhere, not
# even upstream, despite declaring "license": "MIT"). It also holds third-party-notices.mts, with
# libvips-sources.txt and bundled-licenses/, which step 2.6 uses to write THIRD-PARTY-NOTICES.txt
# for code that sits inside another package's files.
#
# Needs the developer machine's own Homebrew ffmpeg and ffprobe on PATH, only to prove the trimmed
# pack actually renders; the pack itself carries no ffmpeg. Needs a native (non-Rosetta) Apple
# Silicon terminal, since the pack's Node, Chrome and native npm dependencies are all mac arm64
# builds, and everything here is resolved against whatever architecture is actually running this
# shell.
#
# usage: apps/desktop/scripts/build-graphics-pack.sh <work dir> <out dir>
set -eu

NODE_VERSION=24.21.0
# node-v24.21.0-darwin-arm64.tar.gz's checksum, from nodejs.org's SHASUMS256.txt for that release
NODE_SHA256=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057
HYPERFRAMES_VERSION=0.8.65
CHROME_BUILD=152.0.7977.30
PACK_VERSION=2026-09-24
# must match GRAPHICS_PACK.chrome in src/shared/graphics-pack.ts
CHROME_REL_PATH="chrome-headless-shell/mac_arm-$CHROME_BUILD/chrome-headless-shell-mac-arm64/chrome-headless-shell"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
GRAPHICS_PACK_DIR="$SCRIPT_DIR/graphics-pack"

WORK=$(cd "$1" && pwd)
mkdir -p "$2"
OUT=$(cd "$2" && pwd)

# 0. Prerequisites, checked before any download: the pack is mac arm64 only, and the smoke render
# below needs the developer machine's own ffmpeg/ffprobe (the pack itself carries neither).
if [ "$(uname -m)" != "arm64" ]; then
  echo "build-graphics-pack.sh: this shell reports '$(uname -m)', not arm64 -- run this from a native Apple Silicon terminal, not an x64/Rosetta one, since the pack's Node, Chrome and npm dependencies are all arm64 builds" >&2
  exit 1
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "build-graphics-pack.sh: ffmpeg is not on PATH (brew install ffmpeg) -- needed to smoke-test the pack's render" >&2; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { echo "build-graphics-pack.sh: ffprobe is not on PATH (brew install ffmpeg) -- needed to check the smoke render's output" >&2; exit 1; }

PACK="$WORK/pack"
rm -rf "$PACK"
mkdir -p "$PACK"

# an empty --userconfig so this script's npm install ignores the developer's own ~/.npmrc
# (a custom registry or proxy there must not change what ends up in a pinned, published pack)
NPM_USERCONFIG="$WORK/empty-npmrc"
: > "$NPM_USERCONFIG"

# 1. Node: only the binary the pack runs and its license go in, not the whole distribution. The
# extracted distribution itself is kept in $WORK (not deleted) because step 2 runs its bundled npm.
cd "$WORK"
NODE_TAR="node-v$NODE_VERSION-darwin-arm64.tar.gz"
[ -f "$NODE_TAR" ] || curl -sSfLO "https://nodejs.org/dist/v$NODE_VERSION/$NODE_TAR"
if ! echo "$NODE_SHA256  $NODE_TAR" | shasum -a 256 -c -; then
  rm -f "$NODE_TAR"
  echo "build-graphics-pack.sh: $NODE_TAR failed its checksum check and was deleted -- run this script again to redownload it" >&2
  exit 1
fi
NODE_DIST="$WORK/node-v$NODE_VERSION-darwin-arm64"
rm -rf "$NODE_DIST"
tar xzf "$NODE_TAR"
mkdir -p "$PACK/node/bin"
cp "$NODE_DIST/bin/node" "$PACK/node/bin/node"
cp "$NODE_DIST/LICENSE" "$PACK/node/LICENSE"
PACK_NODE="$PACK/node/bin/node"
NPM_CLI="$NODE_DIST/lib/node_modules/npm/bin/npm-cli.js"

# 2. HyperFrames and its dependencies, locked by graphics-pack/package.json + package-lock.json
# (see the header). `npm ci` itself runs under `env -i` with a PATH holding only the pack's own
# Node -- not for npm's os/cpu match (that resolves to darwin-arm64 the same way under any Node on
# this machine), but because npm builds each install script's PATH from ITS OWN inherited PATH
# (@npmcli/run-script/lib/set-path.js), prepending node_modules/.bin but otherwise leaving it alone.
# Without this, esbuild's `postinstall: node install.js` would run under whatever `node` the
# developer's shell PATH resolves first (their Homebrew Node, a different major version), not the
# Node this pack ships -- silently defeating the whole point of pinning one Node. `env -i` also
# drops any `npm_config_*` the shell inherited, and `--cache` keeps the install fully off the
# developer's own npm cache.
NPM_DIR="$WORK/npm-install"
rm -rf "$NPM_DIR"
mkdir -p "$NPM_DIR"
cp "$GRAPHICS_PACK_DIR/package.json" "$GRAPHICS_PACK_DIR/package-lock.json" "$NPM_DIR/"
NPM_CACHE="$WORK/npm-cache"
rm -rf "$NPM_CACHE"
mkdir -p "$NPM_CACHE"
(
  cd "$NPM_DIR"
  env -i HOME="$HOME" PATH="$PACK/node/bin:/usr/bin:/bin" \
    "$PACK_NODE" "$NPM_CLI" ci --omit=dev --no-audit --no-fund --no-update-notifier \
    --userconfig "$NPM_USERCONFIG" --registry=https://registry.npmjs.org/ --cache "$NPM_CACHE"
)
# esbuild's postinstall is approved in graphics-pack/package.json's "allowScripts" (recorded with
# `npm install-scripts approve esbuild`, the mechanism npm 11.19 -- the version bundled in the Node
# tarball above -- provides for this); without that, npm would skip it and print a warning, same as
# it does for any dependency with an install script npm has not been told to trust.
rm -rf "$NPM_DIR/node_modules/hyperframes/dist/studio" "$NPM_DIR/node_modules/hyperframes/dist/skills"
cp -R "$NPM_DIR/node_modules" "$PACK/node_modules"
cp "$GRAPHICS_PACK_DIR/HYPERFRAMES-LICENSE" "$PACK/HYPERFRAMES-LICENSE"
cp "$GRAPHICS_PACK_DIR/LGPL-3.0.txt" "$PACK/LGPL-3.0.txt"
cp "$GRAPHICS_PACK_DIR/GPL-3.0.txt" "$PACK/GPL-3.0.txt"
cp "$GRAPHICS_PACK_DIR/MIT-LICENSE-brotli-dfa-fontkit.txt" "$PACK/MIT-LICENSE-brotli-dfa-fontkit.txt"

# 2.5. Refuse to ship a pack where some node_modules package carries no license text and nothing
# above accounts for it: a lock change that adds a new dependency, or drops a license file an
# existing one used to have, must fail the build instead of silently shipping unlicensed code. This
# recurses into nested node_modules/*/node_modules/* too (yargs' own dependency tree already nests
# a couple of packages, e.g. wrap-ansi/node_modules/string-width) -- a package hoisted differently by
# a future relock must not quietly escape the check just because it moved a level deeper.
CHECK_LICENSES="$WORK/check-licenses.cjs"
cat > "$CHECK_LICENSES" <<'JSEOF'
const fs = require("fs")
const path = require("path")

function collectPackages(dir, prefix, packages) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === ".bin") continue
    const full = path.join(dir, name)
    if (!fs.statSync(full).isDirectory()) continue
    if (name.startsWith("@")) {
      for (const sub of fs.readdirSync(full).sort()) {
        const subFull = path.join(full, sub)
        if (!fs.statSync(subFull).isDirectory()) continue
        const label = `${prefix}${name}/${sub}`
        packages.push([label, subFull])
        const nested = path.join(subFull, "node_modules")
        if (fs.existsSync(nested)) collectPackages(nested, `${label}/node_modules/`, packages)
      }
    } else {
      const label = `${prefix}${name}`
      packages.push([label, full])
      const nested = path.join(full, "node_modules")
      if (fs.existsSync(nested)) collectPackages(nested, `${label}/node_modules/`, packages)
    }
  }
}

const packages = []
collectPackages(process.argv[2], "", packages)
const missing = []
for (const [pkgName, dir] of packages) {
  const hasLicense = fs.readdirSync(dir).some((entry) => /^(license|licence|copying)/i.test(entry))
  if (!hasLicense) missing.push(pkgName)
}
console.log(missing.sort().join("\n"))
JSEOF
ACTUAL_NO_LICENSE=$("$PACK_NODE" "$CHECK_LICENSES" "$PACK/node_modules")
EXPECTED_NO_LICENSE="@esbuild/darwin-arm64
@img/sharp-libvips-darwin-arm64
@puppeteer/browsers
brotli
dfa
fontkit
hyperframes
puppeteer-core"
if [ "$ACTUAL_NO_LICENSE" != "$EXPECTED_NO_LICENSE" ]; then
  echo "build-graphics-pack.sh: the set of node_modules packages without their own license file changed." >&2
  echo "expected:" >&2
  echo "$EXPECTED_NO_LICENSE" | sed 's/^/  /' >&2
  echo "found:" >&2
  echo "$ACTUAL_NO_LICENSE" | sed 's/^/  /' >&2
  echo "a lock change added or dropped an uncovered package -- update GRAPHICS-NOTICE.txt below (and this list) to account for it" >&2
  exit 1
fi

# 2.6. The licenses of code that sits inside another package's files, which step 2.5 cannot see:
# HyperFrames' dist/*.js are single bundles that inline about forty npm packages (BSD, MIT, ISC)
# and keep none of their notices, and libvips-cpp.dylib holds about thirty C libraries whose
# license texts sharp-libvips only names in a README table. graphics-pack/third-party-notices.mts
# reads the package@version every bundle's path comments name (node_modules/.bun/<pkg>@<ver>/...)
# and the version of each library libvips' versions.json lists, takes each license from that exact
# version's registry tarball or source archive (graphics-pack/libvips-sources.txt says where each
# library's is), and writes them all into THIRD-PARTY-NOTICES.txt. It fails the build when a bundle
# names a package, or libvips a library, that would be left without its license text -- here,
# before Chrome is downloaded or anything renders. It needs the network, like steps 1 to 3; the
# archives it downloads stay in $WORK/notice-sources between runs. `--plan` in place of a real run
# makes only the checks that need no network and lists the downloads.
env -i PATH="/usr/bin:/bin" \
  "$PACK_NODE" --disable-warning=ExperimentalWarning "$GRAPHICS_PACK_DIR/third-party-notices.mts" "$PACK" "$GRAPHICS_PACK_DIR" "$WORK/notice-sources"

# 3. The pinned Chrome headless shell, installed by the @puppeteer/browsers CLI that ships inside
# HyperFrames' own node_modules, run by the pack's Node, so nothing here fetches "latest". The
# platform is passed explicitly, rather than left to auto-detection off process.arch, so it always
# resolves to arm64 even if this script is ever run from an x64/Rosetta shell on this Mac.
CHROME_DIR="$WORK/chrome-install"
rm -rf "$CHROME_DIR"
mkdir -p "$CHROME_DIR"
"$PACK_NODE" "$PACK/node_modules/@puppeteer/browsers/lib/main-cli.js" install "chrome-headless-shell@$CHROME_BUILD" --platform mac_arm --path "$CHROME_DIR"
cp -R "$CHROME_DIR/chrome-headless-shell" "$PACK/chrome-headless-shell"
if [ ! -x "$PACK/$CHROME_REL_PATH" ]; then
  echo "build-graphics-pack.sh: expected the chrome binary at $PACK/$CHROME_REL_PATH but it is not there (or not executable);" >&2
  echo "@puppeteer/browsers' install layout must have changed -- update CHROME_REL_PATH here and GRAPHICS_PACK.chrome in src/shared/graphics-pack.ts to match" >&2
  exit 1
fi

# 4. Prove the trimmed set renders: a tiny transparent composition, rendered end to end with only
# the env vars (and PATH entries) the app itself will set (env -i, so nothing from this machine
# leaks in by accident). GSAP is still loaded from the CDN here -- this is only the build-time
# smoke test on the developer's Mac; the app bundles its own GSAP in a later task.
SAMPLE="$WORK/sample"
rm -rf "$SAMPLE"
mkdir -p "$SAMPLE"
cat > "$SAMPLE/index.html" <<'EOF'
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; }
      html, body { width: 200px; height: 200px; overflow: hidden; background: transparent; }
      #dot { position: absolute; left: 70px; top: 70px; width: 60px; height: 60px; border-radius: 50%; background: #ff3d6e; opacity: 0; }
    </style>
  </head>
  <body>
    <div data-composition-id="main" data-start="0" data-duration="0.5" data-width="200" data-height="200" data-fps="30">
      <div id="dot" class="clip" data-start="0" data-duration="0.5" data-track-index="0"></div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true })
      tl.fromTo("#dot", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out" }, 0)
      window.__timelines["main"] = tl
      tl.seek(0)
    </script>
  </body>
</html>
EOF

# render-bin holds exactly the programs the render path calls by bare name (grepped from cli.js):
# `id`, `pgrep` and `ps` for HyperFrames' own orphan-process cleanup (src/utils/orphanCleanup.ts,
# src/utils/processTree.ts, wired into every render via src/utils/renderCancellation.ts's ancestor-
# liveness watchdog) and for Chrome memory sampling during capture (`ps -o pid=,rss=` in
# ../engine/src/utils/processRss.ts's sampleProcessRss, polled by createChromeMemorySampler).
# ffmpeg/ffprobe are NOT here: HYPERFRAMES_FFMPEG_PATH/HYPERFRAMES_FFPROBE_PATH below give
# findFfBinary (cli.js ~70473) an absolute path directly, so it returns that unconditionally without
# ever calling `which` or scanning PATH/COMMON_BIN_DIRS (~70468: /opt/homebrew/bin, /usr/local/bin,
# /usr/bin, /bin, /snap/bin) -- and if the configured path were ever wrong,
# assertConfiguredFfmpegBinariesExist() (~70504, called at the very start of every render, ~145164)
# throws a clear "[FFmpeg] FFmpeg binary not found at HYPERFRAMES_FFMPEG_PATH=..." error instead of
# silently picking up a different ffmpeg from one of those directories. Nothing else from this
# machine's PATH is exposed: in particular NOT /usr/bin wholesale, whose /usr/bin/git is a
# Command-Line-Tools install stub on a customer Mac that has never run Xcode -- see the config seed
# and git probe below for the check that would otherwise reach it.
FFMPEG_BIN=$(command -v ffmpeg)
FFPROBE_BIN=$(command -v ffprobe)
rm -rf "$WORK/render-bin"
mkdir -p "$WORK/render-bin"
ln -sf /usr/bin/id "$WORK/render-bin/id"
ln -sf /usr/bin/pgrep "$WORK/render-bin/pgrep"
ln -sf /bin/ps "$WORK/render-bin/ps"

# TEST-ONLY tripwire, not part of what the app ships: the skills-manifest check's
# fetchRemoteManifest (cli.js ~111828-111833) always calls `git ls-remote` before ever reaching
# raw.githubusercontent.com. HyperFrames only persists lastSkillsCheck when a local skills install
# already exists to diff against (refreshSkillsCache, cli.js ~112198), which this isolated HOME
# never has -- so an unchanged lastSkillsCheck below cannot, by itself, prove the fetch was skipped.
# This stub records whether git was ever invoked and fails so the render's own exit code would show
# it too, giving a real answer independent of that.
GIT_CALLED_MARKER="$WORK/git-called"
rm -f "$GIT_CALLED_MARKER"
cat > "$WORK/render-bin/git" <<GITEOF
#!/bin/sh
touch "$GIT_CALLED_MARKER"
exit 1
GITEOF
chmod +x "$WORK/render-bin/git"

rm -rf "$WORK/render-home" "$WORK/render-tmp" "$WORK/render-state" "$WORK/render-fonts"
mkdir -p "$WORK/render-home/.hyperframes" "$WORK/render-tmp" "$WORK/render-state" "$WORK/render-fonts"
rm -f "$WORK/sample.mov"

# Seed HyperFrames' own config cache so it does not go to the network at all: cli.js runs both an
# update check and a skills-manifest check on every command except upgrade/events/telemetry/skills
# (~191781), and each only skips its network call when its own cache timestamp is under 24h old
# (checkForUpdate ~111432, checkSkillsForUpdate ~112225) -- HYPERFRAMES_NO_UPDATE_CHECK and
# HYPERFRAMES_NO_AUTO_INSTALL do not gate that fetch itself, only the printed notice and the
# self-install that might follow it. Both caches last only 24h, so the app must write these same
# three keys before EVERY invocation, not just the first -- not "once", since a customer could
# render again a day later with a stale cache otherwise.
RENDER_CONFIG="$WORK/render-home/.hyperframes/config.json"
SEED_NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$RENDER_CONFIG" <<EOF
{
  "lastUpdateCheck": "$SEED_NOW",
  "latestVersion": "$HYPERFRAMES_VERSION",
  "lastSkillsCheck": "$SEED_NOW"
}
EOF

env -i \
  HOME="$WORK/render-home" \
  TMPDIR="$WORK/render-tmp" \
  PATH="$WORK/render-bin" \
  XDG_STATE_HOME="$WORK/render-state" \
  HYPERFRAMES_NO_TELEMETRY=1 \
  DO_NOT_TRACK=1 \
  HYPERFRAMES_SKIP_SKILLS=1 \
  HYPERFRAMES_NO_UPDATE_CHECK=1 \
  HYPERFRAMES_NO_AUTO_INSTALL=1 \
  HYPERFRAMES_FONT_CACHE_DIR="$WORK/render-fonts" \
  LANG=en_US.UTF-8 \
  HYPERFRAMES_BROWSER_PATH="$PACK/$CHROME_REL_PATH" \
  HYPERFRAMES_FFMPEG_PATH="$FFMPEG_BIN" \
  HYPERFRAMES_FFPROBE_PATH="$FFPROBE_BIN" \
  "$PACK_NODE" "$PACK/node_modules/hyperframes/bin/hyperframes.mjs" render "$SAMPLE" --format mov --quiet --workers 1 -o "$WORK/sample.mov"

# Prove the update-check seed actually worked: if HyperFrames went to the network anyway, it would
# have overwritten lastUpdateCheck with a fresh timestamp (and whatever version it fetched) --
# checkForUpdate's successful-fetch path always rewrites it unconditionally, unlike lastSkillsCheck.
READ_CONFIG_FIELD="$WORK/read-config-field.cjs"
cat > "$READ_CONFIG_FIELD" <<'JSEOF'
const fs = require("fs")
let data = {}
try { data = JSON.parse(fs.readFileSync(process.argv[3], "utf8")) } catch {}
process.stdout.write(String(data[process.argv[2]] ?? ""))
JSEOF
AFTER_UPDATE=$("$PACK_NODE" "$READ_CONFIG_FIELD" lastUpdateCheck "$RENDER_CONFIG")
AFTER_SKILLS=$("$PACK_NODE" "$READ_CONFIG_FIELD" lastSkillsCheck "$RENDER_CONFIG")
if [ "$AFTER_UPDATE" != "$SEED_NOW" ]; then
  echo "build-graphics-pack.sh: HyperFrames rewrote lastUpdateCheck ($SEED_NOW -> $AFTER_UPDATE) during the smoke render -- it went to the network despite the seed" >&2
  exit 1
fi
if [ "$AFTER_SKILLS" != "$SEED_NOW" ]; then
  echo "build-graphics-pack.sh: HyperFrames rewrote lastSkillsCheck ($SEED_NOW -> $AFTER_SKILLS), which should be impossible in this fresh, install-free HOME -- investigate before trusting the git probe below" >&2
  exit 1
fi
echo "config seed OK: lastUpdateCheck unchanged at $SEED_NOW -- the update check's own cache looked fresh, so it never refetched"
if [ -e "$GIT_CALLED_MARKER" ]; then
  echo "build-graphics-pack.sh: the skills check's git ls-remote ran during the smoke render ($GIT_CALLED_MARKER exists) -- it went to the network despite the seed" >&2
  exit 1
fi
echo "git probe OK: the skills check's git ls-remote was never invoked during the smoke render"

CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$WORK/sample.mov")
PIXFMT=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$WORK/sample.mov")
if [ "$CODEC" != "prores" ]; then
  echo "build-graphics-pack.sh: smoke render is $CODEC, not prores -- the trimmed pack cannot be shipped" >&2
  exit 1
fi
case "$PIXFMT" in
  yuva*) ;;
  *)
    echo "build-graphics-pack.sh: smoke render's pix_fmt is $PIXFMT, not transparent (yuva*) -- the trimmed pack cannot be shipped" >&2
    exit 1
    ;;
esac
echo "smoke render OK: $WORK/sample.mov ($CODEC, $PIXFMT)"

# 5. The notice the pack ships, in the style of build-ffmpeg.sh's FFMPEG-NOTICE.txt: what is in
# here, each piece's version and source, and where its license lives inside the pack.
LIBVIPS_DIR_REL="node_modules/@img/sharp-libvips-darwin-arm64"
LIBVIPS_VERSION=$("$PACK_NODE" -e "console.log(require(process.argv[1]).vips)" "$PACK/$LIBVIPS_DIR_REL/versions.json")
LIBVIPS_PACKAGE_VERSION=$("$PACK_NODE" -e "console.log(require(process.argv[1]).version)" "$PACK/$LIBVIPS_DIR_REL/package.json")
HYPERFRAMES_SOURCE=$("$PACK_NODE" -e "const r = require(process.argv[1]).repository; console.log(r.directory ? r.url + ' (' + r.directory + ')' : r.url)" "$PACK/node_modules/hyperframes/package.json")
{
  echo "BOXBLACK downloads this graphics renderer pack the first time graphics are used. It holds:"
  echo
  echo "- Node $NODE_VERSION, taken from node-v$NODE_VERSION-darwin-arm64.tar.gz (SHA-256"
  echo "  $NODE_SHA256) at https://nodejs.org/dist/v$NODE_VERSION/. MIT licensed: node/LICENSE."
  echo "- HyperFrames $HYPERFRAMES_VERSION and its own dependencies, from the npm registry"
  echo "  (https://registry.npmjs.org/), installed exactly per the lock in"
  echo "  apps/desktop/scripts/graphics-pack/package-lock.json in the BOXBLACK repo. HyperFrames"
  echo "  itself is https://registry.npmjs.org/hyperframes/-/hyperframes-$HYPERFRAMES_VERSION.tgz,"
  echo "  whose source is $HYPERFRAMES_SOURCE. Its files under"
  echo "  node_modules/hyperframes/dist/ are bundles that inline other npm packages:"
  echo "  THIRD-PARTY-NOTICES.txt carries each one's license text, with the registry tarball of the"
  echo "  exact version inlined."
  echo "- libvips $LIBVIPS_VERSION, prebuilt for this platform by sharp's own"
  echo "  @img/sharp-libvips-darwin-arm64 $LIBVIPS_PACKAGE_VERSION, built by the scripts at"
  echo "  https://github.com/lovell/sharp-libvips/tree/v$LIBVIPS_PACKAGE_VERSION and used by"
  echo "  HyperFrames' image handling (the sharp package). LGPL-3.0-or-later licensed: LGPL-3.0.txt"
  echo "  (which incorporates GPL-3.0.txt by reference -- both are here). The C libraries built"
  echo "  into it are listed with their versions at $LIBVIPS_DIR_REL/versions.json;"
  echo "  THIRD-PARTY-NOTICES.txt carries each one's license text, with the exact source archive"
  echo "  it was built from. librsvg among them is partly written in Rust: THIRD-PARTY-NOTICES.txt"
  echo "  also carries the license of every crate its Cargo.lock takes from crates.io, from that"
  echo "  crate's own archive there at the locked version."
  echo
  echo "  Not every package under node_modules/ carries its own license file. These do not, and"
  echo "  this is what covers each instead:"
  echo "    hyperframes, puppeteer-core, @puppeteer/browsers (Apache-2.0)  -> HYPERFRAMES-LICENSE"
  echo "    @img/sharp-libvips-darwin-arm64 (LGPL-3.0-or-later)            -> LGPL-3.0.txt, GPL-3.0.txt"
  echo "    @esbuild/darwin-arm64 (MIT)                                    -> node_modules/esbuild/LICENSE.md"
  echo "    brotli, dfa, fontkit (MIT, no license file even upstream)      -> MIT-LICENSE-brotli-dfa-fontkit.txt"
  echo "  Every other package under node_modules/* carries its own LICENSE/LICENCE/COPYING file"
  echo "  (a nested node_modules/*/node_modules/* included, where a package hoists differently)."
  echo "  build-graphics-pack.sh fails the build if that set ever changes without this notice"
  echo "  being updated to match. Code inlined into another package's files is covered by"
  echo "  THIRD-PARTY-NOTICES.txt instead, and the build fails if a bundle names a package, or"
  echo "  libvips a library or Rust crate, whose license text is not there."
  echo
  echo "- The Chrome for Testing headless shell, build $CHROME_BUILD, installed with the"
  echo "  @puppeteer/browsers CLI (https://www.npmjs.com/package/@puppeteer/browsers) from Google's"
  echo "  Chrome for Testing distribution. Its license is next to the binary at"
  echo "  $CHROME_REL_PATH, named LICENSE.headless_shell."
} > "$PACK/GRAPHICS-NOTICE.txt"

# 6. Package: the archive's root is the pack root (node/, node_modules/, chrome-headless-shell/...).
# Uid/gid/xattrs/ACLs are stripped so the archive carries no builder identity and no ambient
# Finder/quarantine metadata -- it does NOT make the sha256 independent of the build otherwise:
# file modification times still go into the tarball and still change the bytes (and the sha256) on
# every run, even from identical inputs. Bump PACK_VERSION for every pack that gets published, and
# never replace a published asset in place: shipped apps hold its sha256 already.
xattr -rc "$PACK"
TARBALL="$OUT/boxblack-graphics-$PACK_VERSION-mac-arm64.tar.gz"
rm -f "$TARBALL"
COPYFILE_DISABLE=1 tar --no-xattrs --no-acls --uid 0 --gid 0 --uname root --gname wheel -czf "$TARBALL" -C "$PACK" .
SHA=$(shasum -a 256 "$TARBALL" | awk '{print $1}')
BYTES=$(stat -f%z "$TARBALL")
echo "sha256: $SHA"
echo "bytes: $BYTES"
echo "paste both into GRAPHICS_PACK in apps/desktop/src/shared/graphics-pack.ts (sha256 and bytes)"
