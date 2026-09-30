# M23 · Graphics overlay (HyperFrames) — implementation plan

> Spec: `docs/specs/2026-09-24-graphics-overlay-design.md`. TDD throughout: failing test → run → implement → run → mutation check (`scratchpad/mutate.py`, never concurrently with another vitest run). No git in this repo; "commit" = the suite green (`npm test`) and `npm run typecheck` clean. Reply to the user in Thai. Draft `0917` only, backed up and restored; `0815`/`0923` read-only.

**Goal:** small transparent motion graphics (a counter, a bar chart, a tick list, an arrow…) that Claude composes from a kit, timed to the spoken words, rendered by HyperFrames from a pinned pack the app downloads once, and laid over the rough cut in CapCut.

**Architecture:** a new `packages/core/src/graphics/` holds the pure parts — the cue types and rules (`plan.ts`), Claude's prompt/schema/acceptance (`direct.ts`), the box maths (`framing.ts`) and the HTML kit (`kit/`). Main gets a pack installer (`graphics-pack.ts`), a render queue (`graphics-render.ts`) and the in-force/view logic (`graphics-cues.ts`), wired into the existing flair → preview → write pipeline exactly like cutaways (`speech` anchors, `edited` flag, `regroupFlair`/`answerOnBeats`/`withBeats`). The writer adds one overlay track (`capcut/graphics.ts`) and bin items (`capcut/bin.ts`).

**Tech:** TypeScript (Node 26 native TS), zod, vitest (core / desktop-main / desktop-renderer jsdom), React 19, HyperFrames 0.8.65 CLI run with a Node 24 binary from the pack, GSAP 3 (bundled, no CDN), ffmpeg 8.1.2 rebuilt with `prores_ks`+`png`+`mov`.

**Order:** Task 0 (spike) must pass before anything else is built. Tasks 1–4 (tooling, pack) and 5–9 (core) are independent of each other; 10–14 (main) need core; 15–17 (renderer) need the API from 12; 18 real test, 19 docs/release.

---

## File map

| Area | File | Responsibility |
|---|---|---|
| core | `graphics/plan.ts` | `GraphicSpec`/`GraphicPiece`/`GraphicCue`/`PlacedGraphic`, constants, `enforceGraphics` |
| core | `graphics/direct.ts` | prompt, `GraphicsReplySchema`, `acceptGraphics`, `planGraphics` |
| core | `graphics/framing.ts` | `renderBox`, `placeOnCanvas`, `dodgeKeepClear` |
| core | `graphics/kit/kit.js`, `kit/kit.css`, `kit/html.ts` | browser runtime, styles, `graphicHtml()` |
| core | `graphics/index.ts` | exports |
| core | `capcut/graphics.ts`, `capcut/bin.ts` | `addGraphicTrack`, `graphicBinItem`, `addBinItems` |
| core | `capcut/write.ts` | `WriteOptions.bin` (a change to the media bin, applied in the same write) |
| core | `media/process.ts`, `media/tool-check.ts` | `env` option; required encoders/muxers |
| shared | `graphics-pack.ts` | `GRAPHICS_PACK` constant |
| shared | `api.ts` | `GraphicView`, `GraphicsPackState`, methods, events |
| main | `graphics-pack.ts` | download, sha256, extract, remove, state |
| main | `graphics-render.ts` | hash, queue, HyperFrames run, poster, events |
| main | `graphics-cues.ts` | sentences with scenes, `graphicsInForce`, `graphicView`, `graphicJobs` |
| main | `graphics-files.ts` | size of the graphics folder, trash unreferenced files |
| main | `flair.ts`, `highlights.ts`, `timeline.ts`, `planner.ts`, `legacy-beats.ts`, `highlight-state.ts`, `highlight-api.ts`, `settings-api.ts`, `settings.ts`, `index.ts` | wiring |
| renderer | `edit/FlairTab.tsx`, `edit/GraphicSheet.tsx`, `edit/SpeechTab.tsx`, `edit/ClipSettingsSheet.tsx`, `edit/byBeat.ts`, `screens/EditScreen.tsx`, `screens/SettingsScreen.tsx`, `i18n.ts`, `styles/edit.css`, `test/fake-api.ts` | UI |
| scripts | `build-ffmpeg.sh`, `build-graphics-pack.sh`, `release-check.ts` | shipped things |
| resources | `resources/graphics/gsap.min.js`, `resources/graphics/GSAP-LICENSE.txt` | bundled GSAP (extraResources `graphics`) |

---

## Task 0: Spike — the pack's parts work together on this Mac

**Files:** none in the repo (scratchpad only). Uses the HyperFrames install already at `<scratchpad>/hf`.

- [ ] **Step 1: rebuild ffmpeg with the new encoders** (this is also Task 1's build, done early so the spike uses it)

Edit `apps/desktop/scripts/build-ffmpeg.sh` lines 36–37:

```sh
  --disable-encoders --enable-encoder=mjpeg,flac,pcm_s16le,wrapped_avframe,prores_ks,png \
  --disable-muxers --enable-muxer=image2,wav,flac,pcm_s16le,null,mov \
```

and the comment block at the top: add "prores_ks + mov for the transparent graphics HyperFrames renders, png for their posters". Run:

```bash
apps/desktop/scripts/build-ffmpeg.sh /tmp/ffmpeg-build apps/desktop/resources/bin
```

Expected: last line `ffmpeg version 8.1.2 …`; `apps/desktop/resources/bin/ffmpeg -hide_banner -encoders | grep -E 'prores_ks|png'` lists both; `-muxers | grep ' mov '` lists mov.

- [ ] **Step 2: get Node 24 LTS**

```bash
cd <scratchpad>/hf && curl -sSfLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz && curl -sSfLO https://nodejs.org/dist/v24.21.0/SHASUMS256.txt && grep node-v24.21.0-darwin-arm64.tar.gz SHASUMS256.txt | shasum -a 256 -c - && tar xzf node-v24.21.0-darwin-arm64.tar.gz
```

(Use the current 24.x LTS at the time; write the exact version into `GRAPHICS_PACK` in Task 3.) Expected: `OK`, and `node-v24.21.0-darwin-arm64/bin/node --version` prints `v24.21.0`.

- [ ] **Step 3: render the synced spike with only the pack's parts**

```bash
S=<scratchpad>/hf; mkdir -p $S/bin && ln -sf "$PWD/apps/desktop/resources/bin/ffmpeg" $S/bin/ffmpeg && ln -sf "$PWD/apps/desktop/resources/bin/ffprobe" $S/bin/ffprobe
env -i HOME=$S/home TMPDIR=$S/home/tmp PATH=$S/bin XDG_STATE_HOME=$S/home/.state HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_FONT_CACHE_DIR=$S/home/fonts \
  HYPERFRAMES_BROWSER_PATH=$S/home/.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-152.0.7977.30/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  $S/node-v24.21.0-darwin-arm64/bin/node $S/node_modules/hyperframes/bin/hyperframes.mjs render $S/synced --format mov --fps 30 --workers 2 --quiet --frames-cache-dir off -o $S/out/spike0.mov --variables-file $S/synced/vars.json --strict-variables
```

Expected: exit 0, `$S/out/spike0.mov` exists, `ffprobe -show_streams` says `codec_name=prores`, `pix_fmt=yuva444p12le`. If HyperFrames complains about a missing ffmpeg feature, add that encoder/muxer to `build-ffmpeg.sh` and rebuild; record it in the spec §9.

- [ ] **Step 4: poster with the shipped ffmpeg**

```bash
apps/desktop/resources/bin/ffmpeg -v error -y -ss 3 -i $S/out/spike0.mov -frames:v 1 -vf scale=270:-2 -update 1 $S/out/spike0.png && file $S/out/spike0.png
```

Expected: `PNG image data, 270 x 480, 8-bit/color RGBA`.

- [ ] **Step 5: quarantine after a tar round trip**

```bash
cd $S && tar czf pack-test.tar.gz node-v24.21.0-darwin-arm64/bin/node home/.cache/hyperframes/chrome && mkdir -p unpack && tar xzf pack-test.tar.gz -C unpack && xattr -lr unpack | grep -c quarantine; echo "quarantine count above (want 0)"
```

Expected: `0`. Then `unpack/node-v24.21.0-darwin-arm64/bin/node --version` runs.

- [ ] **Step 6: record** the outcome (versions, any extra ffmpeg part needed, render time) in the spec §16 "ผลที่ได้" placeholder-free line, and move `$S/out/spike0.*`, `pack-test.tar.gz`, `unpack` to `~/.Trash`.

---

## Task 1: shipped ffmpeg knows about the new parts

**Files:** `packages/core/src/media/tool-check.ts`, `packages/core/src/media/tool-check.test.ts`, `apps/desktop/src/main/bundled-ffmpeg.test.ts`

- [ ] **Step 1: failing test** — in `tool-check.test.ts` add:

```ts
test("the graphics render needs prores_ks, png and the mov muxer", () => {
  const filters = "Filters:\n  ---\n ... scdet ... blackdetect ... freezedetect ... blurdetect ... silencedetect ... fps ... scale ... metadata"
  const encoders = "Encoders:\n ------\n V..... mjpeg\n A..... flac\n A..... pcm_s16le\n V..... wrapped_avframe"
  const muxers = "File formats:\n --\n  E image2\n  E wav\n  E flac\n  E s16le\n  E null"
  expect(missingFfmpegParts(filters, encoders, muxers)).toEqual(["prores_ks", "png", "mov"])
})
```

(Match the exact listing format the existing tests in that file use for `filters`; copy their fixture builder if there is one.)

- [ ] **Step 2: run** `npx vitest run packages/core/src/media/tool-check.test.ts` — expected FAIL: received `[]`.
- [ ] **Step 3: implement** in `tool-check.ts`:

```ts
/** wrapped_avframe is what `-f null` encodes the video into while the signal filters run; prores_ks and png make the graphics and their posters */
const REQUIRED_ENCODERS = ["mjpeg", "flac", "pcm_s16le", "wrapped_avframe", "prores_ks", "png"]
/** frames, extracted speech, the loudness pipe, the null sink the signal filters write to, and the .mov the graphics land in */
const REQUIRED_MUXERS = ["image2", "wav", "flac", "s16le", "null", "mov"]
```

- [ ] **Step 4: run** the test — PASS. Run `npx vitest run apps/desktop/src/main/bundled-ffmpeg.test.ts` — PASS against the rebuilt binary (`missing: []`).
- [ ] **Step 5: add** to `bundled-ffmpeg.test.ts`, inside the shipped-ffmpeg describe:

```ts
  test("writes a transparent ProRes 4444 .mov and a PNG poster, which the graphics need", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxblack-prores-"))
    const mov = join(dir, "g.mov")
    execFileSync(shipped.ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=64x64:r=30:d=0.2,format=rgba", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", mov])
    expect(probe(mov, "stream=codec_name,pix_fmt")).toBe("prores,yuva444p10le")
    const png = join(dir, "g.png")
    execFileSync(shipped.ffmpeg, ["-v", "error", "-y", "-i", mov, "-frames:v", "1", "-update", "1", png])
    expect(probe(png, "stream=codec_name")).toBe("png")
  })
```

- [ ] **Step 6: commit** (suite green).

---

## Task 2: `runProcess` takes an environment

**Files:** `packages/core/src/media/process.ts`, `packages/core/src/media/process.test.ts`

- [ ] **Step 1: failing test**

```ts
test("runs the tool with the environment it is given, and nothing else", async () => {
  const { stdout } = await runProcess("/bin/sh", ["-c", "echo $BOXBLACK_TEST; echo ${HOME:-nohome}"], { env: { BOXBLACK_TEST: "yes" } })
  expect(stdout.trim().split("\n")).toEqual(["yes", "nohome"])
})
```

- [ ] **Step 2: run** — FAIL (second line is the real HOME).
- [ ] **Step 3: implement** — add to the options type `/** the whole environment of the child; the app's own when absent */ env?: NodeJS.ProcessEnv` and pass `env: options.env` to `spawn(...)` (spawn uses `process.env` when `env` is undefined).
- [ ] **Step 4: run** — PASS. Commit.

---

## Task 3: the pack constant and the script that builds the pack

**Files:** `apps/desktop/src/shared/graphics-pack.ts` (new), `apps/desktop/scripts/build-graphics-pack.sh` (new), `apps/desktop/scripts/release-check.ts`, `apps/desktop/scripts/release-check.test.ts`

- [ ] **Step 1: the constant**

```ts
/**
 * The renderer pack BOXBLACK downloads the first time graphics are used: HyperFrames with its
 * dependencies, the Chrome headless shell it drives, and the Node that runs it — every version the
 * one the app was tested with. Built by scripts/build-graphics-pack.sh, which prints the sha256 and
 * size to paste here; the pack is published next to the DMG.
 */
export interface GraphicsPackSpec {
  version: string
  url: string
  /** hex sha256 of the .tar.gz; "" until a pack is built, which the release check refuses */
  sha256: string
  bytes: number
  /** paths inside the extracted pack */
  node: string
  hyperframes: string
  chrome: string
}

export const GRAPHICS_PACK: GraphicsPackSpec = {
  version: "2026-09-24",
  url: "https://github.com/OWNER/boxblack/releases/download/graphics-2026-09-24/boxblack-graphics-2026-09-24-mac-arm64.tar.gz",
  sha256: "",
  bytes: 0,
  node: "node/bin/node",
  hyperframes: "node_modules/hyperframes/bin/hyperframes.mjs",
  chrome: "chrome-headless-shell/mac_arm-152.0.7977.30/chrome-headless-shell-mac-arm64/chrome-headless-shell",
}

export const HYPERFRAMES_VERSION = "0.8.65"
export const PACK_NODE_VERSION = "24.21.0"
export const PACK_CHROME_BUILD = "152.0.7977.30"
```

- [ ] **Step 2: release check** — failing test in `release-check.test.ts`:

```ts
test("a customer build needs a built graphics pack", () => {
  const problems = releaseProblems({ ...GOOD, graphicsPackSha: "" })
  expect(problems).toContain("GRAPHICS_PACK.sha256 in src/shared/graphics-pack.ts is empty; run apps/desktop/scripts/build-graphics-pack.sh and paste its sha256 and size")
  expect(releaseProblems({ ...GOOD, local: true, graphicsPackSha: "" })).not.toContain(expect.stringContaining("GRAPHICS_PACK"))
})
```

(`GOOD` = the passing input fixture that file already has; add `graphicsPackSha: "abc"` to it.) Run — FAIL. Implement: add `graphicsPackSha: string` to the input, and

```ts
  if (!input.local && !input.graphicsPackSha) problems.push("GRAPHICS_PACK.sha256 in src/shared/graphics-pack.ts is empty; run apps/desktop/scripts/build-graphics-pack.sh and paste its sha256 and size")
```

and in the script's `main` pass `graphicsPackSha: GRAPHICS_PACK.sha256`. Run — PASS.

- [ ] **Step 3: the build script** `apps/desktop/scripts/build-graphics-pack.sh`:

```sh
#!/bin/sh
# Builds the renderer pack BOXBLACK downloads on first use (see src/shared/graphics-pack.ts):
# Node (nodejs.org, checksum-verified), HyperFrames with its dependencies, and the Chrome headless
# shell HyperFrames drives — pinned to the versions the app was tested with, so every customer
# renders with the same set. Prints the sha256 and size to paste into GRAPHICS_PACK.
#
# usage: apps/desktop/scripts/build-graphics-pack.sh <work dir> <out dir>
set -eu
NODE_VERSION=24.21.0
HYPERFRAMES_VERSION=0.8.65
PACK_VERSION=2026-09-24

WORK=$(mkdir -p "$1" && cd "$1" && pwd)
mkdir -p "$2"
OUT=$(cd "$2" && pwd)
PACK="$WORK/pack"
rm -rf "$PACK"
mkdir -p "$PACK"

# Node: only the binary and its license
cd "$WORK"
NODE_TAR="node-v$NODE_VERSION-darwin-arm64.tar.gz"
[ -f "$NODE_TAR" ] || curl -sSfLO "https://nodejs.org/dist/v$NODE_VERSION/$NODE_TAR"
curl -sSfL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " $NODE_TAR\$" | shasum -a 256 -c -
tar xzf "$NODE_TAR"
mkdir -p "$PACK/node/bin"
cp "node-v$NODE_VERSION-darwin-arm64/bin/node" "$PACK/node/bin/node"
cp "node-v$NODE_VERSION-darwin-arm64/LICENSE" "$PACK/node/LICENSE"

# HyperFrames and what it needs, installed with the Node above so native pieces match it
mkdir -p "$WORK/hf"
cd "$WORK/hf"
printf '{"name":"boxblack-graphics-pack","private":true}\n' > package.json
PATH="$PACK/node/bin:$PATH" npm install --omit=dev --no-audit --no-fund "hyperframes@$HYPERFRAMES_VERSION"
rm -rf node_modules/hyperframes/dist/studio node_modules/hyperframes/dist/skills
cp -R node_modules "$PACK/node_modules"
cp node_modules/hyperframes/LICENSE "$PACK/HYPERFRAMES-LICENSE" 2>/dev/null || cp node_modules/hyperframes/README.md "$PACK/HYPERFRAMES-README.md"

# Chrome headless shell, downloaded by HyperFrames' own tool into a HOME of ours
HF_HOME="$WORK/home"
mkdir -p "$HF_HOME"
env -i HOME="$HF_HOME" PATH="$PACK/node/bin:/usr/bin:/bin" HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1 \
  "$PACK/node/bin/node" "$PACK/node_modules/hyperframes/bin/hyperframes.mjs" browser ensure
cp -R "$HF_HOME/.cache/hyperframes/chrome/chrome-headless-shell" "$PACK/chrome-headless-shell"
CHROME=$(find "$PACK/chrome-headless-shell" -type f -name chrome-headless-shell | head -1)
echo "chrome: ${CHROME#$PACK/}"

# prove the trimmed set still renders before packing it
SAMPLE="$WORK/sample"
mkdir -p "$SAMPLE"
cat > "$SAMPLE/index.html" <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:200px;height:200px;background:transparent}#b{width:100px;height:100px;background:#f00}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="0.5" data-width="200" data-height="200" data-fps="30"><div id="b" class="clip" data-start="0" data-duration="0.5" data-track-index="0"></div></div>
<script>window.__timelines={main:{seek(){},duration(){return 0.5},paused(){return true}}}</script></body></html>
HTML
env -i HOME="$HF_HOME" TMPDIR="$HF_HOME/tmp" PATH="$(dirname "$(command -v ffmpeg)")" HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_BROWSER_PATH="$CHROME" \
  "$PACK/node/bin/node" "$PACK/node_modules/hyperframes/bin/hyperframes.mjs" render "$SAMPLE" --format mov --quiet --workers 1 -o "$WORK/sample.mov"
ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$WORK/sample.mov" | grep -q prores

# no quarantine attribute may ride along
xattr -rc "$PACK"
cd "$PACK"
TAR="$OUT/boxblack-graphics-$PACK_VERSION-mac-arm64.tar.gz"
tar czf "$TAR" .
echo "sha256: $(shasum -a 256 "$TAR" | cut -d' ' -f1)"
echo "bytes: $(stat -f%z "$TAR")"
echo "paste both into GRAPHICS_PACK in apps/desktop/src/shared/graphics-pack.ts"
```

`chmod +x` it. Run it once (`apps/desktop/scripts/build-graphics-pack.sh /tmp/gpack apps/desktop/release`), paste sha256/bytes into `GRAPHICS_PACK`, and check the `chrome:` line matches `GRAPHICS_PACK.chrome`. The sample render in the script uses the machine's ffmpeg (Homebrew) on purpose — the pack is built on the developer's Mac; the shipped ffmpeg is exercised by Task 0 and Task 11's real test.

- [ ] **Step 4: commit.**

---

## Task 4: the pack installer (main) with its API, settings view and settings row

**Files:** `apps/desktop/src/main/graphics-pack.ts` (new), `apps/desktop/src/main/graphics-pack.test.ts` (new), `apps/desktop/src/shared/api.ts`, `apps/desktop/src/main/settings-api.ts`, `apps/desktop/src/main/settings-api.test.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/src/screens/SettingsScreen.tsx`, `apps/desktop/src/renderer/src/screens/SettingsScreen.test.tsx`, `apps/desktop/src/renderer/src/i18n.ts`, `apps/desktop/src/renderer/test/fake-api.ts`

- [ ] **Step 1: shared types** in `api.ts`:

```ts
/** The renderer pack on this machine (see shared/graphics-pack.ts). */
export type GraphicsPackState =
  | { state: "missing" }
  | { state: "downloading"; received: number; total: number }
  | { state: "installed"; version: string }
```

`SettingsView` gains `graphicsPack: GraphicsPackState` and `graphicFiles: { count: number; bytes: number }` (Task 13 fills the second; give it `{ count: 0, bytes: 0 }` until then). `API_METHODS` gains `"installGraphicsPack", "cancelGraphicsPack", "removeGraphicsPack"`; `DesktopApi`:

```ts
  /** Downloads the renderer pack (Node, HyperFrames, Chrome) and unpacks it; `graphics-pack` events say how far. */
  installGraphicsPack(): Promise<void>
  cancelGraphicsPack(): Promise<void>
  removeGraphicsPack(): Promise<void>
```

`AppEvent` gains:

```ts
  | { type: "graphics-pack"; state: "progress"; received: number; total: number }
  | { type: "graphics-pack"; state: "done" | "cancelled" }
  | { type: "graphics-pack"; state: "failed"; error: string }
```

- [ ] **Step 2: failing tests** `graphics-pack.test.ts` (fake `fetch` streams bytes; fake `extract` records calls):

```ts
import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { AppEvent } from "../shared/api.ts"
import { createGraphicsPack } from "./graphics-pack.ts"

const bytes = Buffer.from("not really a tarball, but bytes all the same")
const spec = (over: Partial<Parameters<typeof createGraphicsPack>[0]["pack"]> = {}) => ({
  version: "v1", url: "https://example.test/pack.tgz", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
  node: "node/bin/node", hyperframes: "node_modules/hyperframes/bin/hyperframes.mjs", chrome: "chrome/chrome-headless-shell", ...over,
})
const streaming = (body: Buffer, status = 200) => async () => new Response(new Blob([body]).stream(), { status })

async function setup(over = {}) {
  const dir = await mkdtemp(join(tmpdir(), "gpack-"))
  const events: AppEvent[] = []
  const extracted: string[][] = []
  const pack = createGraphicsPack({
    dir, pack: spec(over), fetch: streaming(bytes) as unknown as typeof fetch, send: (event) => events.push(event),
    extract: async (archive, into) => {
      extracted.push([archive, into])
      await writeFile(join(into, "installed-marker"), "")
    },
  })
  return { dir, events, extracted, pack }
}

test("nothing installed: missing", async () => {
  const { pack } = await setup()
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(await pack.paths()).toBeNull()
})

test("installs: downloads, checks the checksum, extracts into a versioned folder, remembers it", async () => {
  const { dir, events, extracted, pack } = await setup()
  await pack.install()
  expect(extracted).toEqual([[join(dir, "v1.tar.gz"), join(dir, "v1")]])
  expect(await pack.state()).toEqual({ state: "installed", version: "v1" })
  expect(await pack.paths()).toEqual({ root: join(dir, "v1"), node: join(dir, "v1", "node/bin/node"), hyperframes: join(dir, "v1", "node_modules/hyperframes/bin/hyperframes.mjs"), chrome: join(dir, "v1", "chrome/chrome-headless-shell") })
  expect(events.at(-1)).toEqual({ type: "graphics-pack", state: "done" })
  expect(events.some((event) => event.type === "graphics-pack" && event.state === "progress" && event.received === bytes.length)).toBe(true)
  expect(JSON.parse(await readFile(join(dir, "installed.json"), "utf8"))).toEqual({ version: "v1" })
})

test("a checksum that does not match is thrown away and reported", async () => {
  const { dir, events, extracted, pack } = await setup({ sha256: "0".repeat(64) })
  await expect(pack.install()).rejects.toThrow(/checksum/)
  expect(extracted).toEqual([])
  expect(await pack.state()).toEqual({ state: "missing" })
  expect(events.at(-1)).toMatchObject({ type: "graphics-pack", state: "failed" })
  await expect(readFile(join(dir, "v1.tar.gz"))).rejects.toThrow()
})

test("an older pack is removed when the new one is in place; remove() takes everything away", async () => {
  const { dir, pack } = await setup()
  await writeFile(join(dir, "installed.json"), JSON.stringify({ version: "v0" }))
  await pack.install()
  expect(await pack.state()).toEqual({ state: "installed", version: "v1" })
  await pack.remove()
  expect(await pack.state()).toEqual({ state: "missing" })
  await expect(readFile(join(dir, "installed.json"))).rejects.toThrow()
})

test("cancelling a download leaves nothing behind", async () => {
  const { dir, events, pack } = await setup()
  const slow = createGraphicsPack({
    dir, pack: spec(), send: (event) => events.push(event), extract: async () => {},
    fetch: (async (_url: string, init: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          return new Promise((resolve) => setTimeout(() => { if (init.signal?.aborted) controller.error(new DOMException("aborted", "AbortError")); else controller.enqueue(bytes.subarray(0, 4)); resolve() }, 5))
        },
      })
      return new Response(stream, { status: 200 })
    }) as unknown as typeof fetch,
  })
  const installing = slow.install()
  await new Promise((resolve) => setTimeout(resolve, 20))
  slow.cancel()
  await expect(installing).rejects.toThrow()
  expect(events.at(-1)).toEqual({ type: "graphics-pack", state: "cancelled" })
  expect(await slow.state()).toEqual({ state: "missing" })
})

test("only one install at a time", async () => {
  const { pack } = await setup()
  const first = pack.install()
  await expect(pack.install()).rejects.toThrow(/already/)
  await first
})
```

- [ ] **Step 3: run** — FAIL (module missing).
- [ ] **Step 4: implement** `graphics-pack.ts`:

```ts
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { once } from "node:events"
import { runProcess } from "@boxblack/core/media"
import type { AppEvent, GraphicsPackState } from "../shared/api.ts"
import type { GraphicsPackSpec } from "../shared/graphics-pack.ts"

export interface GraphicsPackPaths {
  root: string
  node: string
  hyperframes: string
  chrome: string
}

export interface GraphicsPackDeps {
  /** where packs live: <userData>/hyperframes */
  dir: string
  pack: GraphicsPackSpec
  fetch?: typeof fetch
  /** unpacks the archive into a folder; macOS tar by default */
  extract?: (archive: string, into: string) => Promise<void>
  send: (event: AppEvent) => void
}

const PROGRESS_EVERY_MS = 200

/** macOS's own tar, then any quarantine flag the files could carry is cleared: they are ours, checked by hash. */
async function untar(archive: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true })
  await runProcess("/usr/bin/tar", ["-xzf", archive, "-C", into])
  await runProcess("/usr/bin/xattr", ["-rc", into])
}

/**
 * The renderer pack on this machine: downloaded once, checked against the hash the app was built
 * with, unpacked next to the earlier version, which then goes. `installed.json` says which version
 * is in place; a folder without it is not a pack.
 */
export function createGraphicsPack(deps: GraphicsPackDeps) {
  const extract = deps.extract ?? untar
  const installedFile = join(deps.dir, "installed.json")
  let running: { controller: AbortController; received: number; total: number } | null = null

  async function installed(): Promise<string | null> {
    try {
      const { version } = JSON.parse(await readFile(installedFile, "utf8")) as { version: string }
      return typeof version === "string" && (await stat(join(deps.dir, version))).isDirectory() ? version : null
    } catch {
      return null
    }
  }

  async function download(controller: AbortController): Promise<string> {
    const part = join(deps.dir, `${deps.pack.version}.tar.gz.part`)
    const archive = join(deps.dir, `${deps.pack.version}.tar.gz`)
    await mkdir(deps.dir, { recursive: true })
    const response = await (deps.fetch ?? fetch)(deps.pack.url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`downloading the graphics renderer failed: HTTP ${response.status}`)
    const hash = createHash("sha256")
    const out = createWriteStream(part)
    let failed: Error | null = null
    const body = Readable.fromWeb(response.body as NodeReadableStream)
    out.on("error", (error) => {
      failed = error
      body.destroy(error)
    })
    let received = 0
    let lastSent = 0
    try {
      for await (const chunk of body as AsyncIterable<Buffer>) {
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, "drain")
        received += chunk.length
        running!.received = received
        const now = Date.now()
        if (now - lastSent >= PROGRESS_EVERY_MS) {
          lastSent = now
          deps.send({ type: "graphics-pack", state: "progress", received, total: deps.pack.bytes })
        }
        controller.signal.throwIfAborted()
      }
    } finally {
      if (!out.destroyed) await new Promise<void>((resolve) => out.end(resolve))
    }
    if (failed) throw failed
    deps.send({ type: "graphics-pack", state: "progress", received, total: deps.pack.bytes })
    if (hash.digest("hex") !== deps.pack.sha256) {
      await rm(part, { force: true })
      throw new Error("the graphics renderer did not match its expected checksum — the download was discarded, try again")
    }
    await rename(part, archive)
    return archive
  }

  return {
    async state(): Promise<GraphicsPackState> {
      if (running) return { state: "downloading", received: running.received, total: running.total }
      const version = await installed()
      return version ? { state: "installed", version } : { state: "missing" }
    },

    /** Where the pack's programs are, or null until it is installed. */
    async paths(): Promise<GraphicsPackPaths | null> {
      const version = await installed()
      if (!version) return null
      const root = join(deps.dir, version)
      return { root, node: join(root, deps.pack.node), hyperframes: join(root, deps.pack.hyperframes), chrome: join(root, deps.pack.chrome) }
    },

    async install(): Promise<void> {
      if (running) throw new Error("the graphics renderer is already downloading")
      const controller = new AbortController()
      running = { controller, received: 0, total: deps.pack.bytes }
      const version = deps.pack.version
      const target = join(deps.dir, version)
      try {
        const archive = await download(controller)
        const was = await installed()
        await rm(target, { recursive: true, force: true })
        await extract(archive, target)
        await rm(archive, { force: true })
        await writeFile(installedFile, JSON.stringify({ version }))
        if (was && was !== version) await rm(join(deps.dir, was), { recursive: true, force: true })
        deps.send({ type: "graphics-pack", state: "done" })
      } catch (error) {
        await rm(join(deps.dir, `${version}.tar.gz.part`), { force: true })
        await rm(target, { recursive: true, force: true })
        if (controller.signal.aborted) deps.send({ type: "graphics-pack", state: "cancelled" })
        else deps.send({ type: "graphics-pack", state: "failed", error: String(error) })
        throw error
      } finally {
        running = null
      }
    },

    cancel(): void {
      running?.controller.abort()
    },

    async remove(): Promise<void> {
      const version = await installed()
      await rm(installedFile, { force: true })
      if (version) await rm(join(deps.dir, version), { recursive: true, force: true })
    },
  }
}

export type GraphicsPack = ReturnType<typeof createGraphicsPack>
```

- [ ] **Step 5: run** — PASS.
- [ ] **Step 6: settings API** — `createSettingsApi` deps gain `graphicsPack?: Pick<GraphicsPack, "state" | "install" | "cancel" | "remove">` and `graphicFiles?: () => Promise<{ count: number; bytes: number }>`; `getSettings` adds `graphicsPack: deps.graphicsPack ? await deps.graphicsPack.state() : { state: "missing" }` and `graphicFiles: deps.graphicFiles ? await deps.graphicFiles() : { count: 0, bytes: 0 }`; methods:

```ts
    async installGraphicsPack() {
      if (!deps.graphicsPack) throw new Error("the graphics renderer is not available in this build")
      // settles when the install does; the events carry the progress
      await deps.graphicsPack.install()
    },
    async cancelGraphicsPack() {
      deps.graphicsPack?.cancel()
    },
    async removeGraphicsPack() {
      await deps.graphicsPack?.remove()
    },
```

Test in `settings-api.test.ts`: `getSettings` carries the pack state from a fake; `installGraphicsPack` calls the fake's install. Run — FAIL then PASS.

- [ ] **Step 7: wire** in `index.ts`: `const graphicsPack = createGraphicsPack({ dir: join(userData, "hyperframes"), pack: GRAPHICS_PACK, send })`, pass `graphicsPack` to `createSettingsApi`, and in `before-quit` call `graphicsPack.cancel()`.
- [ ] **Step 8: settings row** — i18n keys:

```ts
  "settings.graphicsPack": "ตัวเรนเดอร์กราฟิก",
  "settings.graphicsPackHint": "ใช้ทำกราฟิกซ้อนภาพ (HyperFrames + Chrome + Node) โหลดครั้งเดียว {size}",
  "settings.graphicsPackMissing": "ยังไม่ได้ติดตั้ง",
  "settings.graphicsPackInstall": "ติดตั้ง",
  "settings.graphicsPackDownloading": "กำลังโหลด {percent}% ({done} / {size})",
  "settings.graphicsPackCancel": "ยกเลิก",
  "settings.graphicsPackInstalled": "ติดตั้งแล้ว ({version})",
  "settings.graphicsPackRemove": "ลบ",
  "settings.graphicsPackFailed": "ติดตั้งไม่สำเร็จ: {message}",
```

`SettingsScreen.tsx`: state `packDownload`/`packError` fed by `graphics-pack` events the same way `model-download` is; a `GraphicsPackRow` component after the sounds row in the general tab:

```tsx
function GraphicsPackRow({ api, view, download, error, run }: { api: RendererApi; view: SettingsView; download: { received: number; total: number } | null; error: string | null; run: Run }) {
  const pack = view.graphicsPack
  const size = formatBytes(GRAPHICS_PACK.bytes)
  if (download || pack.state === "downloading") {
    const received = download?.received ?? (pack.state === "downloading" ? pack.received : 0)
    const percent = GRAPHICS_PACK.bytes ? Math.round((received / GRAPHICS_PACK.bytes) * 100) : 0
    const text = t("settings.graphicsPackDownloading", { percent, done: formatBytes(received), size })
    return (
      <RowCard>
        <span className="row-label">{t("settings.graphicsPack")}<span className="hint">{text}</span></span>
        <div className="model-status"><Progress value={GRAPHICS_PACK.bytes ? received / GRAPHICS_PACK.bytes : null} label={text} /></div>
        <Button size="sm" onClick={() => void api.cancelGraphicsPack()}>{t("settings.graphicsPackCancel")}</Button>
      </RowCard>
    )
  }
  return (
    <RowCard>
      <span className="row-label">
        {t("settings.graphicsPack")}
        <span className="hint">{pack.state === "installed" ? t("settings.graphicsPackInstalled", { version: pack.version }) : t("settings.graphicsPackHint", { size })}</span>
        {error && <span className="error-text">{t("settings.graphicsPackFailed", { message: error })}</span>}
      </span>
      {pack.state === "installed" ? (
        <Button size="sm" onClick={() => void run(() => api.removeGraphicsPack())}>{t("settings.graphicsPackRemove")}</Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => void run(() => api.installGraphicsPack())}>{t("settings.graphicsPackInstall")}</Button>
      )}
    </RowCard>
  )
}
```

Tests in `SettingsScreen.test.tsx` (mirror the model-download ones at lines ~86–117): the install button calls `installGraphicsPack`; a `graphics-pack` progress event shows the percent; `done` refreshes to "ติดตั้งแล้ว"; `failed` shows the message. `fake-api.ts` default view: `graphicsPack: { state: "missing" }`, `graphicFiles: { count: 0, bytes: 0 }`.

- [ ] **Step 9: run** renderer tests — PASS. Typecheck. Commit.

---

## Task 5: the cue types and the rules (core `graphics/plan.ts`)

**Files:** `packages/core/src/graphics/plan.ts` (new), `packages/core/src/graphics/plan.test.ts` (new), `packages/core/src/graphics/index.ts` (new), `packages/core/package.json` (exports)

- [ ] **Step 1: package exports** — add to `packages/core/package.json` `exports`:

```json
    "./graphics": "./src/graphics/index.ts",
    "./graphics/plan": "./src/graphics/plan.ts",
    "./graphics/direct": "./src/graphics/direct.ts",
    "./graphics/framing": "./src/graphics/framing.ts",
    "./graphics/kit": "./src/graphics/kit/html.ts",
    "./capcut/graphics": "./src/capcut/graphics.ts",
    "./capcut/bin": "./src/capcut/bin.ts",
```

- [ ] **Step 2: failing tests** `plan.test.ts`:

```ts
import { expect, test } from "vitest"
import { enforceGraphics, type GraphicCue, type PlacedGraphic } from "./plan.ts"

const spec = (seconds = 3): GraphicCue["spec"] => ({ version: "kit-1", box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 }, seconds, tone: "base", in: "pop", out: "fade", pieces: [{ kind: "label", text: "x", atS: 0 }], why: "" })
const placed = (atUs: number, seconds = 3, over: Partial<GraphicCue> = {}): PlacedGraphic => ({
  cue: { anchor: { kind: "speech", videoId: "v", sourceUs: atUs, beatId: "b1" }, spec: spec(seconds), edited: false, off: false, ...over },
  atUs,
  durationUs: seconds * 1_000_000,
})

test("the quiet level has no graphics", () => {
  expect(enforceGraphics([placed(0)], "light", 60_000_000)).toEqual({ kept: [], dropped: 1 })
})

test("two graphics keep four seconds apart, the user's own first", () => {
  const mine = placed(2_000_000, 3, { edited: true })
  const { kept, dropped } = enforceGraphics([placed(0), mine, placed(9_000_000)], "medium", 60_000_000)
  expect(kept.map((g) => g.atUs)).toEqual([2_000_000, 9_000_000])
  expect(dropped).toBe(1)
})

test("one turned off does not play and does not count as dropped", () => {
  expect(enforceGraphics([placed(0, 3, { off: true })], "medium", 60_000_000)).toEqual({ kept: [], dropped: 0 })
})

test("the end of the timeline cuts a graphic short, and one left shorter than 1.5 s goes", () => {
  const { kept } = enforceGraphics([placed(58_000_000, 3)], "medium", 60_000_000)
  expect(kept.map((g) => g.durationUs)).toEqual([2_000_000])
  expect(enforceGraphics([placed(59_000_000, 3)], "medium", 60_000_000)).toEqual({ kept: [], dropped: 1 })
})

test("about one per twenty seconds at the medium level, one per ten at the loud one", () => {
  const many = [0, 5, 10, 15, 20, 25].map((s) => placed(s * 1_000_000, 2))
  expect(enforceGraphics(many, "medium", 30_000_000).kept.map((g) => g.atUs / 1e6)).toEqual([0, 5])
  expect(enforceGraphics(many, "heavy", 30_000_000).kept.map((g) => g.atUs / 1e6)).toEqual([0, 5, 10])
})

test("a graphic over a cutaway gives way to it", () => {
  const busy = [{ startUs: 4_000_000, endUs: 6_000_000 }]
  expect(enforceGraphics([placed(3_000_000, 3), placed(10_000_000, 3)], "heavy", 60_000_000, busy).kept.map((g) => g.atUs)).toEqual([10_000_000])
})
```

- [ ] **Step 3: run** `npx vitest run packages/core/src/graphics` — FAIL (no module).
- [ ] **Step 4: implement** `plan.ts`:

```ts
import type { FlairLevel } from "../flair/catalogue.ts"
import type { CueAnchor, Tone } from "../flair/plan.ts"

export const PIECE_KINDS = ["number", "label", "bars", "checks", "arrow", "ring", "icon"] as const
export type PieceKind = (typeof PIECE_KINDS)[number]
export const GRAPHIC_INS = ["pop", "rise", "fade"] as const
export type GraphicIn = (typeof GRAPHIC_INS)[number]
export const GRAPHIC_OUTS = ["fade", "drop", "shrink"] as const
export type GraphicOut = (typeof GRAPHIC_OUTS)[number]
export const ICONS = ["star", "heart", "check", "cross", "warning", "money", "clock", "fire", "up", "down", "gift", "cart"] as const
export type IconName = (typeof ICONS)[number]

/** A box on the frame, as shares of its width and height from the top left. */
export interface GraphicBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** One piece of a graphic; which fields matter depends on `kind`. Times are seconds from the graphic's start. */
export interface GraphicPiece {
  kind: PieceKind
  text?: string
  from?: number
  to?: number
  unit?: string
  atS: number
  untilS?: number
  items?: { text: string; value?: number; atS: number }[]
  /** where an arrow points or a ring sits, as shares of the frame */
  target?: { x: number; y: number }
  /** a ring's diameter as a share of the frame's width */
  size?: number
  icon?: IconName
}

export interface GraphicSpec {
  /** the kit version it was made for; part of the render hash */
  version: string
  box: GraphicBox
  seconds: number
  tone: Tone
  in: GraphicIn
  out: GraphicOut
  pieces: GraphicPiece[]
  /** Claude's one line on why it is there, shown in the app */
  why: string
}

export interface GraphicCue {
  /** a moment of speech, with the beat it plays in */
  anchor: CueAnchor
  spec: GraphicSpec
  /** set by hand on the timeline screen: planning again leaves it alone */
  edited: boolean
  /** switched off by the user; kept so it can be switched back on */
  off: boolean
}

/** A graphic with the time it plays at on the rough cut and how long it stays. */
export interface PlacedGraphic {
  cue: GraphicCue
  atUs: number
  durationUs: number
}

/** Shorter than this is a flash. */
export const GRAPHIC_MIN_US = 1_500_000
/** Longer than this and the picture underneath is forgotten. */
export const GRAPHIC_MAX_S = 6
/** Two graphics closer than this fight for the eye. */
export const GRAPHIC_APART_US = 4_000_000
/** About one graphic per this much video, by level. */
export const GRAPHIC_EVERY_US: Record<FlairLevel, number> = { light: 0, medium: 20_000_000, heavy: 10_000_000 }

const overlaps = (a: { startUs: number; endUs: number }, b: { startUs: number; endUs: number }) => a.startUs < b.endUs && b.startUs < a.endUs

/**
 * The graphics that survive the rules: the quiet level has none, one the user switched off is not
 * counted as lost, the user's own win every clash, a cutaway's time is the cutaway's (`busy`), two
 * graphics start at least four seconds apart, the end of the timeline cuts one short (and drops it
 * when less than 1.5 s is left), and the clip gets about one per twenty seconds (ten at the loudest level).
 */
export function enforceGraphics(graphics: PlacedGraphic[], level: FlairLevel, durationUs: number, busy: { startUs: number; endUs: number }[] = []): { kept: PlacedGraphic[]; dropped: number } {
  const on = graphics.filter((graphic) => !graphic.cue.off)
  if (level === "light") return { kept: [], dropped: on.length }
  const byTime = [...on].sort((a, b) => a.atUs - b.atUs)
  const order = [...byTime.filter((graphic) => graphic.cue.edited), ...byTime.filter((graphic) => !graphic.cue.edited)]

  const kept: PlacedGraphic[] = []
  for (const candidate of order) {
    const durationUs = Math.min(candidate.durationUs, durationUs - candidate.atUs)
    if (durationUs < GRAPHIC_MIN_US) continue
    const span = { startUs: candidate.atUs, endUs: candidate.atUs + durationUs }
    if (busy.some((taken) => overlaps(span, taken))) continue
    if (kept.some((other) => Math.abs(other.atUs - candidate.atUs) < GRAPHIC_APART_US)) continue
    kept.push({ ...candidate, durationUs })
  }

  const room = Math.ceil(durationUs / GRAPHIC_EVERY_US[level])
  const capped = kept.slice(0, room).sort((a, b) => a.atUs - b.atUs)
  return { kept: capped, dropped: on.length - capped.length }
}
```

`index.ts`: `export * from "./plan.ts"` plus, as the later tasks add them, `export { acceptGraphics, planGraphics, GRAPHICS_PROMPT, GRAPHICS_PROMPT_VERSION, GraphicsReplySchema, type GraphicSentence, type GraphicsReply } from "./direct.ts"`, `export { renderBox, placeOnCanvas, dodgeKeepClear, type PixelBox } from "./framing.ts"`, `export { graphicHtml, KIT_VERSION, type GraphicAssets } from "./kit/html.ts"`.

- [ ] **Step 5: run** — PASS. Mutation check: `scratchpad/mutate.py packages/core/src/graphics/plan.ts <json> packages/core/src/graphics/plan.test.ts` with mutants: `off` ignored, `busy` ignored, apart `<=`, cap off by one, min `<=`. Fix any survivor with a test. Commit.

---

## Task 6: the box maths (core `graphics/framing.ts`)

**Files:** `packages/core/src/graphics/framing.ts` (new), `packages/core/src/graphics/framing.test.ts` (new)

- [ ] **Step 1: failing tests**

```ts
import { expect, test } from "vitest"
import { dodgeKeepClear, placeOnCanvas, renderBox } from "./framing.ts"

const canvas = { width: 1080, height: 1920 }
const box = { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.7 }

test("the render box is the graphic's box plus an 8 % margin, in even pixels, inside the frame", () => {
  expect(renderBox(box, [], canvas)).toEqual({ x: 38, y: 930, width: 1004, height: 522 })
  expect(renderBox({ x0: 0, y0: 0, x1: 1, y1: 1 }, [], canvas)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
})

test("a pointer's target outside the box widens the render box to hold it", () => {
  const wide = renderBox(box, [{ x: 0.5, y: 0.2 }], canvas)
  expect(wide.y).toBeLessThanOrEqual(0.2 * 1920 - 0.08 * 1920 * 0.2)
  expect(wide.y + wide.height).toBeGreaterThanOrEqual(0.7 * 1920)
  expect(wide.width % 2).toBe(0)
})

test("placing a pixel box on the canvas: scale undoes CapCut's fit, transform moves the centre", () => {
  // a 1080-wide box already spans the canvas: scale 1, centred horizontally
  expect(placeOnCanvas({ x: 0, y: 960, width: 1080, height: 480 }, canvas)).toEqual({ scale: 1, x: 0, y: -0.25 })
  // a 540×480 box is fitted by its width at scale 1 (540 × 480 → 1080 × 960), so half that to draw it 540 wide
  const small = placeOnCanvas({ x: 0, y: 0, width: 540, height: 480 }, canvas)
  expect(small.scale).toBeCloseTo(0.5)
  expect(small.x).toBeCloseTo(-0.5)
  expect(small.y).toBeCloseTo(0.75)
})

test("a box over the band that must stay clear moves to the freer band, keeping its size", () => {
  const moved = dodgeKeepClear({ x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 }, { fromY: 0.2, toY: 0.55 })
  expect(moved.y1 - moved.y0).toBeCloseTo(0.2)
  expect(moved.y0).toBeGreaterThanOrEqual(0.55)
  // above is freer here
  expect(dodgeKeepClear({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.7 }, { fromY: 0.6, toY: 0.95 }).y1).toBeLessThanOrEqual(0.6)
  // no band, or no overlap: unchanged
  expect(dodgeKeepClear(box, null)).toEqual(box)
  expect(dodgeKeepClear(box, { fromY: 0.1, toY: 0.3 })).toEqual(box)
  // a band that leaves no room on either side: the box stays inside the frame, overlapping
  expect(dodgeKeepClear({ x0: 0, y0: 0.4, x1: 1, y1: 0.6 }, { fromY: 0.05, toY: 0.95 }).y0).toBeGreaterThanOrEqual(0)
})
```

- [ ] **Step 2: run** — FAIL. **Step 3: implement**:

```ts
import type { GraphicBox } from "./plan.ts"

export interface PixelBox {
  x: number
  y: number
  width: number
  height: number
}

/** Room around the graphic for its way in and out, as a share of its own size. */
export const RENDER_MARGIN = 0.08

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * The part of the frame that is rendered: the graphic's box with a margin for its animation, grown
 * to hold every pointer's target, on even pixel edges inside the canvas.
 */
export function renderBox(box: GraphicBox, targets: { x: number; y: number }[], canvas: { width: number; height: number }): PixelBox {
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  let x0 = box.x0 - w * RENDER_MARGIN
  let y0 = box.y0 - h * RENDER_MARGIN
  let x1 = box.x1 + w * RENDER_MARGIN
  let y1 = box.y1 + h * RENDER_MARGIN
  for (const target of targets) {
    x0 = Math.min(x0, target.x - 0.06)
    y0 = Math.min(y0, target.y - 0.06)
    x1 = Math.max(x1, target.x + 0.06)
    y1 = Math.max(y1, target.y + 0.06)
  }
  const left = clamp(Math.floor(x0 * canvas.width), 0, canvas.width)
  const top = clamp(Math.floor(y0 * canvas.height), 0, canvas.height)
  const right = clamp(Math.ceil(x1 * canvas.width), 0, canvas.width)
  const bottom = clamp(Math.ceil(y1 * canvas.height), 0, canvas.height)
  const width = Math.min(even(right - left), canvas.width - (left % 2 === 0 ? left : left - 1))
  const height = Math.min(even(bottom - top), canvas.height - (top % 2 === 0 ? top : top - 1))
  return { x: left - (left % 2), y: top - (top % 2), width, height }
}

/**
 * How CapCut must draw a rendered file so it lands on its own pixels: CapCut draws a picture "fit"
 * at scale 1 (one side spans the canvas), so the scale undoes that, and the transform moves its
 * centre in half-canvases (+1 = right / top).
 */
export function placeOnCanvas(box: PixelBox, canvas: { width: number; height: number }): { scale: number; x: number; y: number } {
  const fit = Math.min(canvas.width / box.width, canvas.height / box.height)
  const scale = 1 / fit
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return { scale, x: (cx / canvas.width - 0.5) * 2, y: (0.5 - cy / canvas.height) * 2 }
}

/**
 * A box that would cover the band the picture must keep clear (a face, the product) moves whole
 * into the taller free band above or below it — the same choice a cutaway card makes — and stays
 * inside the frame even when that band is too short.
 */
export function dodgeKeepClear(box: GraphicBox, keepClear: { fromY: number; toY: number } | null): GraphicBox {
  if (!keepClear || box.y1 <= keepClear.fromY || box.y0 >= keepClear.toY) return box
  const h = box.y1 - box.y0
  const above = keepClear.fromY
  const below = 1 - keepClear.toY
  const y0 = above > below ? clamp(above - h - 0.02, 0, 1 - h) : clamp(keepClear.toY + 0.02, 0, 1 - h)
  return { ...box, y0, y1: y0 + h }
}
```

- [ ] **Step 4: run** — PASS (adjust the exact numbers in the first test to what the arithmetic gives once — they are pinned so the write stays byte-stable). Mutation check (margin 0, `even` off, `fit` max instead of min, dodge sign). Commit.

---

## Task 7: the writer — an overlay track and bin items (core `capcut/graphics.ts`, `capcut/bin.ts`, `capcut/write.ts`)

**Files:** `packages/core/src/capcut/graphics.ts` (new), `packages/core/src/capcut/graphics.test.ts` (new), `packages/core/src/capcut/bin.ts` (new), `packages/core/src/capcut/bin.test.ts` (new), `packages/core/src/capcut/write.ts`, `packages/core/src/capcut/write.test.ts`, `packages/core/src/capcut/index.ts`

- [ ] **Step 1: failing tests** `graphics.test.ts` (copy the `info` fixture builder `inserts.test.ts` uses — a draft with a 30 fps main track):

```ts
import { expect, test } from "vitest"
import { addGraphicTrack, type TimelineGraphic } from "./graphics.ts"
import { baseInfo } from "./test-fixtures.ts" // or the same helper inserts.test.ts uses

const graphic = (over: Partial<TimelineGraphic> = {}): TimelineGraphic => ({
  atUs: 1_000_000, durationUs: 3_000_000, binId: "BIN-1", path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", name: "ab12.mov",
  width: 1004, height: 522, durationOfFileUs: 3_000_000, place: { scale: 0.93, x: 0, y: -0.25 }, ...over,
})

test("one overlay video track above the picture, silent, drawn where the render box says", () => {
  const info = baseInfo()
  const out = addGraphicTrack(info, [graphic()])
  const track = out.tracks.at(-1)!
  expect(track).toMatchObject({ type: "video", flag: 2 })
  const segment = track.segments[0]!
  expect(segment.target_timerange).toEqual({ start: 1_000_000, duration: 3_000_000 })
  expect(segment.source_timerange).toEqual({ start: 0, duration: 3_000_000 })
  expect(segment).toMatchObject({ volume: 0, render_index: 1000 + (out.tracks.length - 1), track_render_index: out.tracks.length - 1 })
  expect(segment.clip).toMatchObject({ scale: { x: 0.93, y: 0.93 }, transform: { x: 0, y: -0.25 } })
  const material = (out.materials.videos as { id: string; local_material_id: string; has_audio: boolean; path: string }[]).find((m) => m.id === segment.material_id)!
  expect(material).toMatchObject({ local_material_id: "BIN-1", has_audio: false, path: graphic().path, type: "video" })
  expect(info.tracks.length).toBe(out.tracks.length - 1) // pure
})

test("edges land on frames; one with no whole frame left is left out; none means no track", () => {
  const out = addGraphicTrack(baseInfo(), [graphic({ atUs: 1_000_010, durationUs: 3_000_000 }), graphic({ atUs: 999_999_000 })])
  expect(out.tracks.at(-1)!.segments).toHaveLength(1)
  expect(out.tracks.at(-1)!.segments[0]!.target_timerange.start % Math.round(1_000_000 / 30)).toBe(0)
  expect(addGraphicTrack(baseInfo(), []).tracks.length).toBe(baseInfo().tracks.length)
})
```

`bin.test.ts`:

```ts
import { expect, test } from "vitest"
import { addBinItems, graphicBinItem } from "./bin.ts"

const meta = () => ({ draft_id: "d", draft_name: "0917", tm_duration: 0, tm_draft_modified: 0, draft_materials: [{ type: 0, value: [{ id: "OLD", file_Path: "/a.mov", metetype: "video", duration: 1, width: 1, height: 1 }] }, { type: 1, value: [] }] })

test("a graphic's bin item looks like a file the user imported", () => {
  const item = graphicBinItem({ id: "NEW", path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", width: 1004, height: 522, durationUs: 3_000_000, nowMs: 1_700_000_000_000 })
  expect(item).toMatchObject({ id: "NEW", file_Path: "/Users/x/Movies/CapCut/BOXBLACK/graphics/ab12.mov", extra_info: "ab12.mov", metetype: "video", width: 1004, height: 522, duration: 3_000_000, create_time: 1_700_000_000, import_time: 1_700_000_000, import_time_ms: 1_700_000_000_000_000, roughcut_time_range: { start: 0, duration: 3_000_000 }, type: 0 })
})

test("items go into the imported group, once each, without touching the rest", () => {
  const item = graphicBinItem({ id: "NEW", path: "/g.mov", width: 2, height: 2, durationUs: 1, nowMs: 0 })
  const out = addBinItems(meta(), [item, item])
  expect(out.draft_materials[0]!.value.map((entry) => entry.id)).toEqual(["OLD", "NEW"])
  expect(addBinItems(out, [item]).draft_materials[0]!.value).toHaveLength(2)
  expect(out.draft_materials[1]).toEqual({ type: 1, value: [] })
  expect(meta().draft_materials[0]!.value).toHaveLength(1)
})

test("a meta with no imported group gets one", () => {
  const item = graphicBinItem({ id: "NEW", path: "/g.mov", width: 2, height: 2, durationUs: 1, nowMs: 0 })
  expect(addBinItems({ ...meta(), draft_materials: [] }, [item]).draft_materials).toEqual([{ type: 0, value: [item] }])
})
```

`write.test.ts`: add a test that `writeDraft(draft, info, { binItems: [item] })` writes `draft_meta_info.json` with the item in `draft_materials[type 0]`, next to the existing test that checks `tm_duration` (reuse its temp draft fixture).

- [ ] **Step 2: run** — FAIL. **Step 3: implement** `bin.ts`:

```ts
import { basename } from "node:path"
import type { BinItem, DraftMeta } from "./types.ts"

/**
 * A rendered graphic as a bin item, shaped like the entries CapCut 9.4 writes for an imported
 * file (0917's, read on 2026-09-24): CapCut needs one for every material a segment plays.
 */
export function graphicBinItem(args: { id: string; path: string; width: number; height: number; durationUs: number; nowMs: number }): BinItem {
  const nowS = Math.floor(args.nowMs / 1000)
  return {
    id: args.id,
    create_time: nowS,
    duration: args.durationUs,
    extra_info: basename(args.path),
    file_Path: args.path,
    height: args.height,
    width: args.width,
    import_time: nowS,
    import_time_ms: args.nowMs * 1000,
    item_source: 1,
    md5: "",
    metetype: "video",
    roughcut_time_range: { duration: args.durationUs, start: 0 },
    sub_time_range: { duration: -1, start: -1 },
    type: 0,
  }
}

/** The imported-files group (`type` 0) with these items added, ids already there left alone. Pure. */
export function addBinItems(meta: DraftMeta, items: BinItem[]): DraftMeta {
  const groups = meta.draft_materials.map((group) => ({ ...group, value: [...group.value] }))
  let imported = groups.find((group) => group.type === 0)
  if (!imported) {
    imported = { type: 0, value: [] }
    groups.push(imported)
  }
  const have = new Set(imported.value.map((entry) => entry.id))
  for (const item of items) {
    if (have.has(item.id)) continue
    have.add(item.id)
    imported.value.push(item)
  }
  return { ...meta, draft_materials: groups }
}
```

(Before pinning `item_source`, `md5`, `sub_time_range`: read one imported entry from 0917's `draft_meta_info.json` and copy the fields the spike's `...imported.value[0]` spread carried; keep the ones that are per-file, drop ids of the copied entry.)

`graphics.ts`:

```ts
import { newId, segmentExtras, videoMaterial, videoSegment } from "./templates.ts"
import { frameToUs, usToFrame } from "./time.ts"
import type { DraftInfo, Segment, Track } from "./types.ts"

/** A rendered graphic laid over the rough cut. */
export interface TimelineGraphic {
  atUs: number
  durationUs: number
  binId: string
  path: string
  name: string
  width: number
  height: number
  durationOfFileUs: number
  /** how CapCut draws it so it lands on its own pixels (framing.placeOnCanvas) */
  place: { scale: number; x: number; y: number }
}

/** Above the cutaways (8 + track) and below the text (14000 + track). */
const RENDER_INDEX_BASE = 1000

/**
 * Adds the graphics on one overlay video track above the rough cut and its cutaways. Pure. Each is
 * silent, plays from the start of its file, and is drawn at the size and place it was rendered
 * for. Edges land on frames, and one with no whole frame left is left out.
 */
export function addGraphicTrack(info: DraftInfo, graphics: TimelineGraphic[]): DraftInfo {
  const fps = info.fps
  const lastFrame = usToFrame(info.duration, fps)
  const out = structuredClone(info)
  const materials: unknown[] = []
  const extrasByKey = new Map<string, unknown[]>()
  const segments: Segment[] = []
  const trackIndex = out.tracks.length

  for (const graphic of [...graphics].sort((a, b) => a.atUs - b.atUs)) {
    const startFrame = usToFrame(graphic.atUs, fps)
    const fileFrames = Math.floor((graphic.durationOfFileUs * fps) / 1_000_000)
    const endFrame = Math.min(usToFrame(graphic.atUs + graphic.durationUs, fps), lastFrame, startFrame + fileFrames)
    if (startFrame < 0 || endFrame - startFrame < 1) continue
    const start = frameToUs(startFrame, fps)
    const duration = frameToUs(endFrame, fps) - start
    const materialId = newId()
    materials.push({
      ...videoMaterial(materialId, { id: graphic.binId, path: graphic.path, name: graphic.name, durationUs: graphic.durationOfFileUs, width: graphic.width, height: graphic.height }),
      has_audio: false,
    })
    const extras = segmentExtras()
    for (const [key, entry] of extras) extrasByKey.set(key, [...(extrasByKey.get(key) ?? []), entry])
    const segment = videoSegment({ id: newId(), materialId, extraRefs: extras.map(([, entry]) => entry.id), source: { start: 0, duration }, target: { start, duration } })
    segments.push({
      ...segment,
      volume: 0,
      last_nonzero_volume: 1,
      clip: { ...(segment.clip as object), scale: { x: graphic.place.scale, y: graphic.place.scale }, transform: { x: graphic.place.x, y: graphic.place.y } },
      render_index: RENDER_INDEX_BASE + trackIndex,
      track_render_index: trackIndex,
    })
  }
  if (segments.length === 0) return out

  const existing = (key: string) => (Array.isArray(out.materials[key]) ? (out.materials[key] as unknown[]) : [])
  const merged: Record<string, unknown> = { ...out.materials, videos: [...existing("videos"), ...materials] }
  for (const [key, entries] of extrasByKey) merged[key] = [...existing(key), ...entries]
  out.materials = merged
  const track: Track = { id: newId(), type: "video", flag: 2, attribute: 0, name: "", is_default_name: true, segments }
  out.tracks = [...out.tracks, track]
  return out
}
```

`write.ts`: `WriteOptions` gains `/** bin items to add to draft_meta_info.json in the same write: the graphics' files */ binItems?: BinItem[]`; after `const meta = await readJson<DraftMeta>(metaPath)` do `const withItems = options.binItems?.length ? addBinItems(meta, options.binItems) : meta` and use `withItems` for the `tm_*` updates and the JSON written. `index.ts`: export `addGraphicTrack`, `type TimelineGraphic`, `addBinItems`, `graphicBinItem`.

- [ ] **Step 4: run** — PASS. Mutation check `graphics.ts` (render index base, `has_audio`, volume, frame rounding) and `bin.ts` (dedupe, missing group). Commit.

---

## Task 8: Claude picks the moments (core `graphics/direct.ts`)

**Files:** `packages/core/src/graphics/direct.ts` (new), `packages/core/src/graphics/direct.test.ts` (new)

- [ ] **Step 1: failing tests** (fake transport as in `flair/direct.test.ts`):

```ts
import { expect, test } from "vitest"
import type { LlmTransport } from "../llm/types.ts"
import { acceptGraphics, GRAPHICS_PROMPT, planGraphics, type GraphicSentence, type GraphicsReply } from "./direct.ts"

const canvas = { width: 1080, height: 1920 }
const words = (texts: string[], startUs: number) => texts.map((text, i) => ({ text, startUs: startUs + i * 400_000 }))
const SENTENCES: GraphicSentence[] = [
  { videoId: "v", beatId: "b1", atUs: 2_000_000, text: "ยอดขายเดือนนี้ หนึ่งล้านสองแสนบาท", words: words(["ยอดขาย", "เดือนนี้", "หนึ่งล้าน", "สองแสน", "บาท"], 10_000_000), endUs: 12_500_000, scene: { description: "คนพูดกลางเฟรม", kind: "talking-head", keepClear: { fromY: 0.1, toY: 0.45 } }, hasText: false, hasInsert: false },
  { videoId: "v", beatId: "b1", atUs: 6_000_000, text: "ดูตรงนี้", words: words(["ดู", "ตรงนี้"], 14_000_000), endUs: 15_000_000, scene: null, hasText: true, hasInsert: false },
]
const reply = (over: Partial<GraphicsReply["graphics"][number]> = {}): GraphicsReply => ({
  graphics: [{ at: 1, word: "หนึ่งล้าน", seconds: 3, why: "ตัวเลขยอดขาย", box: [0.1, 0.55, 0.9, 0.75], tone: "accent", in: "pop", out: "fade",
    pieces: [{ kind: "number", text: "ยอดขาย", from: 0, to: 1200000, unit: "บาท", at: "หนึ่งล้าน", until: "บาท", items: [], target: [], size: 0, icon: "" }], ...over }],
})

test("an answer becomes a cue on the word, its piece times in seconds from there", () => {
  const { graphics, dropped } = acceptGraphics(reply(), SENTENCES, canvas)
  expect(dropped).toBe(0)
  expect(graphics[0]!.anchor).toEqual({ kind: "speech", videoId: "v", sourceUs: 10_800_000, beatId: "b1" })
  expect(graphics[0]!.spec).toMatchObject({ seconds: 3, tone: "accent", in: "pop", out: "fade", box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 }, why: "ตัวเลขยอดขาย" })
  expect(graphics[0]!.spec.pieces[0]).toEqual({ kind: "number", text: "ยอดขาย", from: 0, to: 1200000, unit: "บาท", atS: 0, untilS: 0.8 })
  expect(graphics[0]).toMatchObject({ edited: false, off: false })
})

test("a word the sentence does not say starts the graphic at the sentence", () => {
  const { graphics } = acceptGraphics(reply({ word: "ไม่มี" }), SENTENCES, canvas)
  expect(graphics[0]!.anchor).toMatchObject({ sourceUs: 10_000_000 })
})

test("what does not fit is dropped and counted", () => {
  const cases: Partial<GraphicsReply["graphics"][number]>[] = [
    { at: 9 },
    { box: [0.1, 0.5, 0.9] },
    { box: [0.9, 0.5, 0.1, 0.7] },
    { box: [0.1, 0.5, 0.2, 0.55] }, // too small
    { pieces: [] },
    { pieces: [{ kind: "number", text: "", from: 5, to: 5, unit: "", at: "", until: "", items: [], target: [], size: 0, icon: "" }] },
    { pieces: [{ kind: "bars", text: "", from: 0, to: 0, unit: "", at: "", until: "", items: [{ text: "ก", value: 1, at: "" }], target: [], size: 0, icon: "" }] },
    { pieces: [{ kind: "arrow", text: "", from: 0, to: 0, unit: "", at: "", until: "", items: [], target: [1.2, 0.5], size: 0, icon: "" }] },
    { pieces: [{ kind: "icon", text: "", from: 0, to: 0, unit: "", at: "", until: "", items: [], target: [], size: 0, icon: "dragon" }] },
  ]
  for (const over of cases) expect(acceptGraphics(reply(over), SENTENCES, canvas), JSON.stringify(over)).toEqual({ graphics: [], dropped: 1 })
})

test("seconds are clamped, at most three pieces stay, a sentence gets one graphic", () => {
  const piece = reply().graphics[0]!.pieces[0]!
  const { graphics, dropped } = acceptGraphics({ graphics: [{ ...reply().graphics[0]!, seconds: 9, pieces: [piece, piece, piece, piece] }, reply().graphics[0]!] }, SENTENCES, canvas)
  expect(graphics).toHaveLength(1)
  expect(graphics[0]!.spec.seconds).toBe(6)
  expect(graphics[0]!.spec.pieces).toHaveLength(3)
  expect(dropped).toBe(1)
})

test("a piece time outside the graphic's window is the graphic's start", () => {
  const { graphics } = acceptGraphics(reply({ word: "บาท", seconds: 2, pieces: [{ ...reply().graphics[0]!.pieces[0]!, at: "ยอดขาย" }] }), SENTENCES, canvas)
  expect(graphics[0]!.spec.pieces[0]!.atS).toBe(0)
})

test("the request lists the sentences with their scenes and attaches the frames; none to place means no call", async () => {
  const calls: { content: unknown[]; system: string }[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate(request) {
      calls.push({ content: request.content, system: request.system })
      return { output: reply() as never, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  const out = await planGraphics({ transport, model: "m", brief: { videoType: null, instructions: "" } as never, level: "medium", sentences: SENTENCES, canvas, frames: { "v:1": "/dev/null" } })
  expect(out.graphics).toHaveLength(1)
  const text = (calls[0]!.content[0] as { text: string }).text
  expect(text).toContain("[1] 0:02.0")
  expect(text).toContain("keepClear")
  expect(text).toContain("มีข้อความเด่นอยู่แล้ว")
  expect(calls[0]!.system).toBe(GRAPHICS_PROMPT.system)
  expect(await planGraphics({ transport, model: "m", brief: { videoType: null, instructions: "" } as never, level: "medium", sentences: [], canvas, frames: {} })).toEqual({ graphics: [], dropped: 0 })
  expect(calls).toHaveLength(1)
})
```

(For the frame attachment use a real temp JPEG path instead of `/dev/null` and assert an `image` content part follows a `text` part naming the scene.)

- [ ] **Step 2: run** — FAIL. **Step 3: implement**:

```ts
import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { FlairLevel } from "../flair/catalogue.ts"
import type { SpeechSlot } from "../flair/direct.ts"
import { TONES, type CueAnchor } from "../flair/plan.ts"
import type { LlmContent, LlmTransport, SystemPrompt } from "../llm/types.ts"
import type { Brief } from "../planner/brief.ts"
import { composeThai as composed } from "../thai.ts"
import type { Scene } from "../vision/describe.ts"
import { GRAPHIC_INS, GRAPHIC_MAX_S, GRAPHIC_MIN_US, GRAPHIC_OUTS, ICONS, PIECE_KINDS, type GraphicBox, type GraphicCue, type GraphicPiece, type IconName } from "./plan.ts"
import { KIT_VERSION } from "./kit/version.ts"

export const GRAPHICS_PROMPT_VERSION = "graphics-2026-09-24-kit"

const SYSTEM = `คุณวาง "กราฟิกซ้อนภาพ" ชิ้นเล็กๆ บนวิดีโอสั้น กราฟิกประกอบจากชิ้นส่วนที่กำหนดให้ และขึ้นตามจังหวะคำพูด

ข้อมูลที่ได้: brief ระดับความจัด ประโยคที่พูดทุกประโยคพร้อมเวลา ฉากที่เล่นตรงนั้น (คำบรรยาย ชนิด และ keepClear = แถบของภาพที่ห้ามบัง เป็นสัดส่วนความสูงจากขอบบน) และเฟรมของฉากแนบท้าย

ใส่กราฟิกเฉพาะตอนที่คำพูดมี ตัวเลข การเทียบ รายการ หรือของในภาพที่ควรชี้ ประโยคธรรมดาไม่ต้องใส่ ตอบเป็นรายการว่างได้
- ระดับกลาง: เฉพาะจุดที่กราฟิกช่วยให้เข้าใจจริงๆ ราวหนึ่งอันต่อยี่สิบวินาที · ระดับจัดเต็ม: ใส่ได้ถี่ขึ้น ราวหนึ่งอันต่อสิบวินาที
- ประโยคที่มีข้อความเด่นอยู่แล้ว กราฟิกต้องไม่พูดซ้ำคำเดิม (ราคาที่เป็นข้อความเด่นแล้วไม่ต้องทำตัวเลขวิ่งอีก) · ประโยคที่มีสื่อแทรกอยู่แล้วไม่ต้องใส่
- เล็ก ไม่กินทั้งจอ กรอบกว้าง 0.3–0.9 ของจอ สูง 0.08–0.35 · ห้ามทับ keepClear ของฉากนั้น · บนจอแนวตั้งวางไว้ครึ่งล่างเป็นหลัก

ตอบต่อกราฟิก
- at: เลขประโยค · word: คำในประโยคที่กราฟิกขึ้น คัดลอกตรงตัว ("" = ต้นประโยค) · seconds: อยู่นานกี่วินาที 1.5–6
- why: หนึ่งบรรทัดว่าทำไมตรงนี้ · box: [ซ้าย, บน, ขวา, ล่าง] สัดส่วนของจอ · tone: base/accent/alt สีจากพาเลตของข้อความเด่น
- in: pop/rise/fade · out: fade/drop/shrink
- pieces: 1–3 ชิ้น แต่ละชิ้นตอบทุกฟิลด์ ฟิลด์ที่ชนิดนั้นไม่ใช้ให้ใส่ค่าว่าง/0/[]
  · number ตัวเลขวิ่ง: from, to, unit, text (ป้ายกำกับ), at (คำที่เริ่มวิ่ง), until (คำที่ถึงค่าสุดท้าย)
  · label ป้ายสั้น: text, at
  · bars แถบเทียบ 2–4 แถบ: items [{text, value, at}], unit
  · checks รายการติ๊ก 2–5 ข้อ: items [{text, at}] ติ๊กทีละข้อตามคำ
  · arrow ลูกศรชี้ของในภาพ: target [x, y] สัดส่วนของจอ ดูจากเฟรมที่แนบ, at
  · ring วงกลมล้อมของในภาพ: target [x, y], size (เส้นผ่านศูนย์กลาง สัดส่วนความกว้างจอ), at
  · icon: icon จาก star heart check cross warning money clock fire up down gift cart, at
- at/until ทุกค่าเป็นคำในประโยคนั้น คัดลอกตรงตัว ("" = ต้นกราฟิก)
เขียนข้อความในกราฟิกเป็นภาษาไทยสั้นๆ ตัวเลขใช้เลขอารบิก`

export const GRAPHICS_PROMPT: SystemPrompt = { system: SYSTEM, version: GRAPHICS_PROMPT_VERSION }

const PieceSchema = z.object({
  kind: z.enum(PIECE_KINDS),
  text: z.string().default(""),
  from: z.number().default(0),
  to: z.number().default(0),
  unit: z.string().default(""),
  at: z.string().default(""),
  until: z.string().default(""),
  items: z.array(z.object({ text: z.string(), value: z.number().default(0), at: z.string().default("") })).default([]),
  target: z.array(z.number()).default([]),
  size: z.number().default(0),
  icon: z.string().default(""),
})

export const GraphicsReplySchema = z.object({
  graphics: z.array(
    z.object({
      at: z.number().int(),
      word: z.string().default(""),
      seconds: z.number(),
      why: z.string().default(""),
      box: z.array(z.number()),
      tone: z.enum(TONES).default("base"),
      in: z.enum(GRAPHIC_INS).default("pop"),
      out: z.enum(GRAPHIC_OUTS).default("fade"),
      pieces: z.array(PieceSchema),
    }),
  ),
})
export type GraphicsReply = z.infer<typeof GraphicsReplySchema>

/** A spoken sentence as Claude is shown it for graphics: with the scene playing under it and what already sits on it. */
export interface GraphicSentence extends SpeechSlot {
  /** where it ends in the source */
  endUs: number
  scene: Pick<Scene, "description" | "kind" | "keepClear"> | null
  hasText: boolean
  hasInsert: boolean
}

const MIN_BOX = { width: 0.18, height: 0.08 }
const MAX_PIECES = 3

function boxOf(answer: number[]): GraphicBox | null {
  if (answer.length !== 4) return null
  const [x0, y0, x1, y1] = answer as [number, number, number, number]
  const inside = x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1
  return inside && x1 - x0 >= MIN_BOX.width && y1 - y0 >= MIN_BOX.height ? { x0, y0, x1, y1 } : null
}

const targetOf = (answer: number[]): { x: number; y: number } | null =>
  answer.length === 2 && answer[0]! >= 0 && answer[0]! <= 1 && answer[1]! >= 0 && answer[1]! <= 1 ? { x: answer[0]!, y: answer[1]! } : null

/** The start of the sentence's word that says `word`, or null. */
function wordTime(sentence: SpeechSlot, word: string): number | null {
  const wanted = composed(word.trim())
  if (!wanted) return null
  return sentence.words.find((entry) => composed(entry.text) === wanted)?.startUs ?? null
}

/** A piece's moment in seconds from the graphic's start; the start itself when the word is not there or falls outside the graphic. */
function secondsAt(sentence: SpeechSlot, word: string, startUs: number, seconds: number): number | null {
  const at = wordTime(sentence, word)
  if (at === null) return null
  const s = (at - startUs) / 1_000_000
  return s >= 0 && s <= seconds ? Number(s.toFixed(3)) : null
}

function pieceOf(answer: z.infer<typeof PieceSchema>, sentence: SpeechSlot, startUs: number, seconds: number): GraphicPiece | null {
  const atS = secondsAt(sentence, answer.at, startUs, seconds) ?? 0
  const text = answer.text.trim()
  switch (answer.kind) {
    case "number": {
      if (!Number.isFinite(answer.from) || !Number.isFinite(answer.to) || answer.from === answer.to) return null
      const untilS = secondsAt(sentence, answer.until, startUs, seconds) ?? Math.min(seconds - 0.3, atS + 1.5)
      return { kind: "number", text, from: answer.from, to: answer.to, unit: answer.unit.trim(), atS, untilS: Math.max(atS + 0.3, Number(untilS.toFixed(3))) }
    }
    case "label":
      return text ? { kind: "label", text, atS } : null
    case "bars": {
      const items = answer.items.filter((item) => item.text.trim() && Number.isFinite(item.value)).slice(0, 4).map((item) => ({ text: item.text.trim(), value: item.value, atS: secondsAt(sentence, item.at, startUs, seconds) ?? atS }))
      return items.length >= 2 ? { kind: "bars", unit: answer.unit.trim(), atS, items } : null
    }
    case "checks": {
      const items = answer.items.filter((item) => item.text.trim()).slice(0, 5).map((item) => ({ text: item.text.trim(), atS: secondsAt(sentence, item.at, startUs, seconds) ?? atS }))
      return items.length >= 2 ? { kind: "checks", atS, items } : null
    }
    case "arrow":
    case "ring": {
      const target = targetOf(answer.target)
      if (!target) return null
      return answer.kind === "arrow" ? { kind: "arrow", target, atS } : { kind: "ring", target, size: answer.size > 0 && answer.size <= 0.6 ? answer.size : 0.25, atS }
    }
    case "icon":
      return (ICONS as readonly string[]).includes(answer.icon) ? { kind: "icon", icon: answer.icon as IconName, atS } : null
  }
}

/**
 * Turns Claude's reply into cues on the sentences it was shown. Anything that does not fit — an
 * unknown sentence, a box that is not a box or too small, a piece missing what its kind needs — is
 * dropped and counted; a word the sentence does not say only moves the graphic to the sentence's start.
 */
export function acceptGraphics(reply: GraphicsReply, sentences: GraphicSentence[], canvas: { width: number; height: number }): { graphics: GraphicCue[]; dropped: number } {
  void canvas
  const graphics: GraphicCue[] = []
  const filled = new Set<number>()
  let dropped = 0
  for (const answer of reply.graphics ?? []) {
    const sentence = sentences[answer.at - 1]
    const box = boxOf(answer.box)
    if (!sentence || !box || filled.has(answer.at) || answer.pieces.length === 0) {
      dropped++
      continue
    }
    const startUs = wordTime(sentence, answer.word) ?? sentence.words[0]?.startUs
    if (startUs === undefined) {
      dropped++
      continue
    }
    const seconds = Math.min(GRAPHIC_MAX_S, Math.max(GRAPHIC_MIN_US / 1_000_000, Number.isFinite(answer.seconds) ? answer.seconds : 3))
    const pieces = answer.pieces.slice(0, MAX_PIECES).flatMap((piece) => pieceOf(piece, sentence, startUs, seconds) ?? [])
    if (pieces.length === 0) {
      dropped++
      continue
    }
    filled.add(answer.at)
    graphics.push({
      anchor: { kind: "speech", videoId: sentence.videoId, sourceUs: startUs, beatId: sentence.beatId },
      spec: { version: KIT_VERSION, box, seconds, tone: answer.tone ?? "base", in: answer.in ?? "pop", out: answer.out ?? "fade", pieces, why: answer.why.trim() },
      edited: false,
      off: false,
    })
  }
  return { graphics, dropped }
}

const clock = (us: number) => {
  const tenths = Math.round(us / 100_000)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`
}

/** The frame of the scene under a sentence is named by its video and the number of the sentence. */
export const frameKey = (sentence: { videoId: string }, index: number) => `${sentence.videoId}:${index + 1}`

function describe(args: { brief: Brief; level: FlairLevel; sentences: GraphicSentence[]; canvas: { width: number; height: number } }): string {
  const scene = (sentence: GraphicSentence) => {
    if (!sentence.scene) return "ฉาก: ไม่มีข้อมูลภาพ"
    const clear = sentence.scene.keepClear ? `keepClear [${sentence.scene.keepClear.fromY}, ${sentence.scene.keepClear.toY}]` : "keepClear ไม่มี"
    return `ฉาก: ${sentence.scene.kind} · ${sentence.scene.description} · ${clear}`
  }
  const on = (sentence: GraphicSentence) => [sentence.hasText ? "มีข้อความเด่นอยู่แล้ว" : "", sentence.hasInsert ? "มีสื่อแทรกอยู่แล้ว" : ""].filter(Boolean).join(" · ")
  return [
    "brief",
    `- ประเภทวิดีโอ: ${args.brief.videoType ?? "ไม่ระบุ"}`,
    `- คำสั่งเพิ่มเติม: ${args.brief.instructions.trim() || "ไม่ระบุ"}`,
    "",
    `ระดับความจัด: ${args.level === "medium" ? "กลาง" : "จัดเต็ม"} · จอ ${args.canvas.width > args.canvas.height ? "แนวนอน" : "แนวตั้ง"}`,
    "",
    "ประโยคที่พูด (เวลาบนคลิป · ข้อความ · ฉาก)",
    ...args.sentences.map((sentence, i) => `[${i + 1}] ${clock(sentence.atUs)} “${sentence.text}”${on(sentence) ? ` (${on(sentence)})` : ""}\n    ${scene(sentence)}`),
    "",
    "เฟรมของฉากแนบท้ายตามเลขประโยค ดูภาพเองก่อนชี้ตำแหน่ง",
  ].join("\n")
}

/** Asks Claude where a graphic would help and what it is made of; none to show means no call. */
export async function planGraphics(args: {
  transport: LlmTransport
  model: string
  brief: Brief
  level: FlairLevel
  sentences: GraphicSentence[]
  canvas: { width: number; height: number }
  /** one JPEG per scene, by `frameKey` */
  frames: Record<string, string>
  prompt?: SystemPrompt
  signal?: AbortSignal
}): Promise<{ graphics: GraphicCue[]; dropped: number }> {
  if (args.sentences.length === 0 || args.level === "light") return { graphics: [], dropped: 0 }
  const content: LlmContent[] = [{ type: "text", text: describe(args) }]
  const shown = new Set<string>()
  for (const [index, sentence] of args.sentences.entries()) {
    const path = args.frames[frameKey(sentence, index)]
    if (!path || shown.has(path)) continue
    shown.add(path)
    content.push({ type: "text", text: `เฟรมของประโยค ${index + 1}` })
    content.push({ type: "image", mediaType: "image/jpeg", data: (await readFile(path)).toString("base64") })
  }
  const reply = await args.transport.generate({
    model: args.model,
    system: (args.prompt ?? GRAPHICS_PROMPT).system,
    content,
    schema: GraphicsReplySchema,
    maxTokens: 16_000,
    signal: args.signal,
  })
  return acceptGraphics(reply.output, args.sentences, args.canvas)
}
```

- [ ] **Step 4: run** — PASS (fix the `untilS` expectation to what `secondsAt` gives for "บาท": word 5 starts 1.6 s after word 1 → `untilS: 1.6`; the test above says 0.8 — correct the test, not the code, after checking the arithmetic: หนึ่งล้าน is word index 2 at +0.8 s, บาท index 4 at +1.6 s, so from the graphic's start at หนึ่งล้าน, บาท is at 0.8 s. Keep 0.8). Mutation check (word matching, clamps, dedupe, piece rules). Commit.

---

## Task 9: the kit — HTML generator, browser runtime, styles, bundled GSAP

**Files:** `packages/core/src/graphics/kit/html.ts` (new), `packages/core/src/graphics/kit/kit.js` (new), `packages/core/src/graphics/kit/kit.css` (new), `packages/core/src/graphics/kit/html.test.ts` (new), `apps/desktop/resources/graphics/gsap.min.js` (new), `apps/desktop/resources/graphics/GSAP-LICENSE.txt` (new), `apps/desktop/electron-builder.cjs`

- [ ] **Step 1: GSAP** — `npm pack gsap@3.13.0 --pack-destination /tmp` in a scratch dir, copy `package/dist/gsap.min.js` to `apps/desktop/resources/graphics/gsap.min.js` and `package/LICENSE` (the "Standard 'No Charge' GreenSock License" / 3.13 free license text) to `GSAP-LICENSE.txt`; confirm the license text allows commercial use in a distributed app (3.13+ is free for all use). Add `{ from: "resources/graphics", to: "graphics" }` to `extraResources` in `electron-builder.cjs` with a comment. Do not bundle the kit files from `packages/core` here — `html.ts` inlines them from its own folder at build time via `?raw`-free reads (see Step 3).

- [ ] **Step 2: failing tests** `html.test.ts`:

```ts
import { expect, test } from "vitest"
import type { GraphicSpec } from "../plan.ts"
import { graphicHtml, KIT_VERSION } from "./html.ts"

const spec: GraphicSpec = { version: KIT_VERSION, box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 }, seconds: 3, tone: "accent", in: "pop", out: "fade", why: "",
  pieces: [{ kind: "number", text: "ยอดขาย", from: 0, to: 1200000, unit: "บาท", atS: 0.2, untilS: 1.4 }, { kind: "arrow", target: { x: 0.5, y: 0.3 }, atS: 0.5 }] }
const args = { spec, render: { x: 38, y: 400, width: 1004, height: 1000 }, canvas: { width: 1080, height: 1920 }, fps: 30,
  palette: { text: "#ffffff", accent: "#ffd600", alt: "#4fc3ff", bar: "#1a1030" }, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, assets: { gsap: "/*gsap*/", kit: "/*kit*/", css: "/*css*/" } }

test("a self-contained composition: no external URL, the spec and the palette inlined, the font by file name", () => {
  const html = graphicHtml(args)
  expect(html).not.toMatch(/https?:\/\//)
  expect(html).toContain('data-composition-id="main"')
  expect(html).toContain('data-duration="3"')
  expect(html).toContain('data-width="1004" data-height="1000" data-fps="30"')
  expect(html).toContain('url("Kanit-ExtraBold.ttf")')
  expect(html).toContain("/*gsap*/")
  expect(html).toContain("/*kit*/")
  expect(html).toContain("--accent: #ffd600")
  expect(html).toContain(`window.__SPEC = ${JSON.stringify({ ...spec, offset: { x: 38, y: 400 }, canvas: { width: 1080, height: 1920 }, colour: "#ffd600" })}`)
})

test("a spec is escaped so no text can close the script", () => {
  const html = graphicHtml({ ...args, spec: { ...spec, pieces: [{ kind: "label", text: "</script><b>", atS: 0 }] } })
  expect(html).not.toContain("</script><b>")
  expect(html).toContain("<\\/script><b>")
})
```

- [ ] **Step 3: implement** `html.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { GraphicSpec } from "../plan.ts"
import type { PixelBox } from "../framing.ts"

// KIT_VERSION lives in ./version.ts (made in Task 8, which stamps it on every spec); re-exported here
export { KIT_VERSION } from "./version.ts"

export interface GraphicAssets {
  /** the text of gsap.min.js */
  gsap: string
  kit: string
  css: string
}

/** The kit's own runtime and styles, read once from beside this file. */
export function kitAssets(gsapPath: string): GraphicAssets {
  return {
    gsap: readFileSync(gsapPath, "utf8"),
    kit: readFileSync(join(import.meta.dirname, "kit.js"), "utf8"),
    css: readFileSync(join(import.meta.dirname, "kit.css"), "utf8"),
  }
}

/** JSON that is safe inside a <script>: a "</script>" in a text cannot end the element. */
const inScript = (value: unknown) => JSON.stringify(value).replaceAll("</", "<\\/")

/**
 * One HyperFrames composition for one graphic, everything inline but the font file, which sits
 * next to it. The runtime reads `window.__SPEC` (the spec plus where the render box sits on the
 * canvas, so pointer targets given in frame shares land on the right pixels) and builds the DOM
 * and the GSAP timeline HyperFrames drives.
 */
export function graphicHtml(args: {
  spec: GraphicSpec
  render: PixelBox
  canvas: { width: number; height: number }
  fps: number
  palette: { text: string; accent: string; alt: string; bar: string }
  font: { family: string; file: string }
  assets: GraphicAssets
}): string {
  const { spec, render, canvas, fps, palette, font, assets } = args
  const colour = palette[spec.tone === "base" ? "text" : spec.tone]
  const payload = { ...spec, offset: { x: render.x, y: render.y }, canvas, colour }
  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <style>
      @font-face { font-family: "${font.family}"; src: url("${font.file}") format("truetype"); }
      :root { --text: ${palette.text}; --accent: ${palette.accent}; --alt: ${palette.alt}; --bar: ${palette.bar}; --colour: ${colour}; --font: "${font.family}", sans-serif; --w: ${render.width}px; --h: ${render.height}px; }
      ${assets.css}
    </style>
    <script>${assets.gsap}</script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${spec.seconds}" data-width="${render.width}" data-height="${render.height}" data-fps="${fps}">
      <div id="stage" class="clip" data-start="0" data-duration="${spec.seconds}" data-track-index="0"></div>
    </div>
    <script>window.__SPEC = ${inScript(payload)}</script>
    <script>${assets.kit}</script>
  </body>
</html>
`
}
```

`kit.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--w); height: var(--h); overflow: hidden; background: transparent; }
#root, #stage { position: relative; width: var(--w); height: var(--h); font-family: var(--font); color: var(--colour); }
.card { position: absolute; border-radius: 28px; background: color-mix(in srgb, var(--bar) 82%, transparent); box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35); padding: 4% 5%; display: flex; flex-direction: column; justify-content: center; gap: 0.35em; overflow: hidden; }
.label { font-size: var(--fs-small); line-height: 1.3; color: var(--text); opacity: 0.85; }
.number { font-size: var(--fs-big); line-height: 1.1; font-weight: 800; white-space: nowrap; }
.number .unit { font-size: 0.5em; margin-left: 0.25em; color: var(--text); }
.bars { display: flex; flex-direction: column; gap: 0.3em; font-size: var(--fs-small); }
.bar-row { display: grid; grid-template-columns: 30% 1fr auto; align-items: center; gap: 0.6em; color: var(--text); }
.bar-track { height: 0.9em; border-radius: 999px; background: rgba(255, 255, 255, 0.15); overflow: hidden; }
.bar-fill { height: 100%; width: 0; border-radius: 999px; background: var(--colour); }
.checks { display: flex; flex-direction: column; gap: 0.25em; font-size: var(--fs-small); color: var(--text); }
.check { display: flex; align-items: center; gap: 0.5em; opacity: 0.35; }
.check .tick { width: 1em; height: 1em; border-radius: 50%; border: 0.12em solid var(--colour); display: grid; place-items: center; }
.check .tick svg { width: 70%; height: 70%; opacity: 0; }
.icon { position: absolute; right: 4%; top: 8%; width: 14%; aspect-ratio: 1; color: var(--colour); }
.pointer { position: absolute; left: 0; top: 0; width: var(--w); height: var(--h); pointer-events: none; overflow: visible; }
.pointer path, .pointer circle { fill: none; stroke: var(--colour); stroke-width: 10; stroke-linecap: round; stroke-linejoin: round; }
```

`kit.js` (plain script, no modules, runs after gsap):

```js
/* BOXBLACK graphics kit: builds one graphic from window.__SPEC and registers its GSAP timeline for HyperFrames. */
;(function () {
  const S = window.__SPEC
  const stage = document.getElementById("stage")
  const W = S.canvas.width
  const H = S.canvas.height
  // frame shares → pixels inside the render box
  const px = (x) => x * W - S.offset.x
  const py = (y) => y * H - S.offset.y
  const box = { x: px(S.box.x0), y: py(S.box.y0), w: (S.box.x1 - S.box.x0) * W, h: (S.box.y1 - S.box.y0) * H }
  const big = Math.min(box.h * 0.42, box.w * 0.14)
  document.documentElement.style.setProperty("--fs-big", big + "px")
  document.documentElement.style.setProperty("--fs-small", big * 0.42 + "px")

  const el = (tag, cls, parent, text) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    ;(parent || stage).appendChild(node)
    return node
  }
  const svg = (markup, cls, parent) => {
    const wrap = document.createElement("div")
    wrap.innerHTML = markup
    const node = wrap.firstElementChild
    if (cls) node.setAttribute("class", cls)
    ;(parent || stage).appendChild(node)
    return node
  }
  const ICONS = {
    star: "M32 6l8 17 19 2-14 13 4 19-17-10-17 10 4-19L5 25l19-2z",
    heart: "M32 56S6 40 6 22a13 13 0 0 1 26-3 13 13 0 0 1 26 3c0 18-26 34-26 34z",
    check: "M10 34l14 14 30-30", cross: "M14 14l36 36M50 14L14 50",
    warning: "M32 6l28 50H4zM32 24v16M32 46v4", money: "M32 8v48M22 20h20a6 6 0 0 1 0 12H22a6 6 0 0 0 0 12h20",
    clock: "M32 8a24 24 0 1 0 0 48 24 24 0 0 0 0-48zM32 18v14l10 6", fire: "M32 6c6 10 16 14 16 28a16 16 0 0 1-32 0c0-8 4-12 6-16 2 6 4 8 6 8-2-8 0-14 4-20z",
    up: "M32 54V12M14 30l18-18 18 18", down: "M32 10v42M14 34l18 18 18-18",
    gift: "M8 26h48v30H8zM8 26h48v-8H8zM32 18v38M22 18c-8 0-8-10 0-10s10 10 10 10-10 0-10 0zm20 0c8 0 8-10 0-10s-10 10-10 10 10 0 10 0z",
    cart: "M6 10h8l8 30h28l6-20H18M24 52a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm24 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  }
  const fmt = (n, decimals) => n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

  const tl = gsap.timeline({ paused: true })
  const card = el("div", "card")
  Object.assign(card.style, { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" })

  // the way in
  const IN = { pop: { from: { opacity: 0, scale: 0.7 }, to: { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.8)" } }, rise: { from: { opacity: 0, y: 60 }, to: { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" } }, fade: { from: { opacity: 0 }, to: { opacity: 1, duration: 0.4 } } }
  const OUT = { fade: { opacity: 0, duration: 0.3 }, drop: { opacity: 0, y: 60, duration: 0.3, ease: "power2.in" }, shrink: { opacity: 0, scale: 0.7, duration: 0.3, ease: "power2.in" } }
  tl.fromTo(card, IN[S.in].from, IN[S.in].to, 0)

  for (const piece of S.pieces) {
    const at = Math.min(piece.atS, S.seconds - 0.4)
    if (piece.kind === "label") {
      const node = el("div", "label", card, piece.text)
      tl.fromTo(node, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.3, ease: "power3.out" }, at)
    } else if (piece.kind === "number") {
      if (piece.text) el("div", "label", card, piece.text)
      const node = el("div", "number", card)
      const value = el("span", "value", node, fmt(piece.from, 0))
      if (piece.unit) el("span", "unit", node, piece.unit)
      const decimals = Number.isInteger(piece.from) && Number.isInteger(piece.to) ? 0 : 1
      const counter = { n: piece.from }
      tl.fromTo(node, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.25 }, at)
      tl.to(counter, { n: piece.to, duration: Math.max(0.3, piece.untilS - at), ease: "power2.out", onUpdate: () => (value.textContent = fmt(counter.n, decimals)) }, at)
    } else if (piece.kind === "bars") {
      const list = el("div", "bars", card)
      const max = Math.max(...piece.items.map((item) => Math.abs(item.value))) || 1
      for (const item of piece.items) {
        const row = el("div", "bar-row", list)
        el("span", "", row, item.text)
        const track = el("div", "bar-track", row)
        const fill = el("div", "bar-fill", track)
        el("span", "", row, fmt(item.value, Number.isInteger(item.value) ? 0 : 1) + (piece.unit ? " " + piece.unit : ""))
        tl.to(fill, { width: (Math.abs(item.value) / max) * 100 + "%", duration: 0.6, ease: "power3.out" }, Math.min(item.atS, S.seconds - 0.4))
      }
      tl.fromTo(list, { opacity: 0 }, { opacity: 1, duration: 0.2 }, at)
    } else if (piece.kind === "checks") {
      const list = el("div", "checks", card)
      for (const item of piece.items) {
        const row = el("div", "check", list)
        const tick = el("span", "tick", row)
        const mark = svg('<svg viewBox="0 0 64 64"><path d="M12 34l14 14 26-28" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>', "", tick)
        el("span", "", row, item.text)
        const when = Math.min(item.atS, S.seconds - 0.4)
        tl.to(row, { opacity: 1, duration: 0.2 }, when)
        tl.fromTo(mark, { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.25, ease: "back.out(2)" }, when)
      }
    } else if (piece.kind === "icon") {
      const node = svg('<svg viewBox="0 0 64 64"><path d="' + ICONS[piece.icon] + '" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>', "icon", card)
      tl.fromTo(node, { opacity: 0, scale: 0.4, rotation: -20 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.35, ease: "back.out(2)" }, at)
    } else if (piece.kind === "arrow" || piece.kind === "ring") {
      // drawn on the frame, outside the card: from the card's nearest edge to the target
      const tx = px(piece.target.x)
      const ty = py(piece.target.y)
      const layer = svg('<svg viewBox="0 0 ' + (W) + ' ' + (H) + '" preserveAspectRatio="none"></svg>', "pointer")
      layer.setAttribute("viewBox", "0 0 " + parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--w")) + " " + parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--h")))
      if (piece.kind === "ring") {
        const r = (piece.size * W) / 2
        const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        ring.setAttribute("cx", tx); ring.setAttribute("cy", ty); ring.setAttribute("r", r)
        layer.appendChild(ring)
        const length = 2 * Math.PI * r
        ring.style.strokeDasharray = length
        tl.fromTo(ring, { strokeDashoffset: length, opacity: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, at)
      } else {
        const sx = tx < box.x ? box.x : tx > box.x + box.w ? box.x + box.w : Math.min(Math.max(tx, box.x), box.x + box.w)
        const sy = ty < box.y ? box.y : ty > box.y + box.h ? box.y + box.h : box.y
        // the curve stays inside the triangle of its ends and control point: keep that point inside the render box, or the bend is cut off
        const bw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--w"))
        const bh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--h"))
        const mx = Math.min(Math.max((sx + tx) / 2 + (ty - sy) * 0.25, 5), bw - 5)
        const my = Math.min(Math.max((sy + ty) / 2 - (tx - sx) * 0.25, 5), bh - 5)
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
        path.setAttribute("d", "M " + sx + " " + sy + " Q " + mx + " " + my + " " + tx + " " + ty)
        layer.appendChild(path)
        const angle = Math.atan2(ty - my, tx - mx)
        const head = document.createElementNS("http://www.w3.org/2000/svg", "path")
        const a1 = angle + Math.PI * 0.8, a2 = angle - Math.PI * 0.8, len = 28
        head.setAttribute("d", "M " + (tx + Math.cos(a1) * len) + " " + (ty + Math.sin(a1) * len) + " L " + tx + " " + ty + " L " + (tx + Math.cos(a2) * len) + " " + (ty + Math.sin(a2) * len))
        layer.appendChild(head)
        const length = path.getTotalLength()
        path.style.strokeDasharray = length
        tl.fromTo(path, { strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.45, ease: "power2.inOut" }, at)
        tl.fromTo(head, { opacity: 0, scale: 0.3, transformOrigin: tx + "px " + ty + "px" }, { opacity: 1, scale: 1, duration: 0.2, ease: "back.out(2)" }, at + 0.4)
      }
      tl.to(layer, OUT.fade, S.seconds - 0.3)
    }
  }

  tl.to(card, OUT[S.out], S.seconds - 0.3)
  window.__timelines = window.__timelines || {}
  window.__timelines["main"] = tl
  tl.seek(0)
})()
```

- [ ] **Step 4: run** the html tests — PASS. Then a **real render smoke test** (not in vitest): write the test HTML from `graphicHtml` with the real assets into a scratch folder with `Kanit-ExtraBold.ttf` beside it, render with the spike command from Task 0 Step 3 (project dir = that folder) at 30 fps, and look at 3 frames with the shipped ffmpeg (`-ss 0.5/1.5/2.8 -frames:v 1 … .png`): the card, the counter mid-count, the arrow drawn. Fix the kit until it looks right; every fix bumps nothing yet (KIT_VERSION is new). Move the outputs to `~/.Trash`.
- [ ] **Step 5: commit.**

---

## Task 10: the render queue (main `graphics-render.ts`) and the files helper (`graphics-files.ts`)

**Files:** `apps/desktop/src/main/graphics-render.ts` (new), `apps/desktop/src/main/graphics-render.test.ts` (new), `apps/desktop/src/main/graphics-files.ts` (new), `apps/desktop/src/main/graphics-files.test.ts` (new), `apps/desktop/src/shared/api.ts`

- [ ] **Step 1: shared types** in `api.ts`:

```ts
export type GraphicRenderState = "waiting" | "rendering" | "ready" | "failed"

/** Pushed while graphics render in the background. */
  | { type: "graphics"; folder: string; state: "progress"; done: number; total: number }
  | { type: "graphics"; folder: string; state: "done" }
  | { type: "graphics"; folder: string; state: "failed"; hash: string; error: string }
```

(the last three lines go into `AppEvent`).

- [ ] **Step 2: failing tests** `graphics-render.test.ts` — the runner is a fake that writes the "rendered" file:

```ts
import { mkdir, mkdtemp, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { GraphicSpec } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_STYLES } from "@boxblack/core/highlights/styles"
import type { AppEvent } from "../shared/api.ts"
import { createGraphicsRenderer, quietHyperframesHome, renderPath, type RenderJob } from "./graphics-render.ts"

const spec: GraphicSpec = { version: "kit-1", box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 }, seconds: 3, tone: "base", in: "pop", out: "fade", why: "", pieces: [{ kind: "label", text: "x", atS: 0 }] }
const job = (over: Partial<RenderJob> = {}): RenderJob => ({ spec, canvas: { width: 1080, height: 1920 }, fps: 30, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, palette: HIGHLIGHT_STYLES["bold-white"].palette, ...over })

async function setup(over: { fail?: boolean; slow?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "grender-"))
  const events: AppEvent[] = []
  const runs: { project: string; output: string }[] = []
  const renderer = createGraphicsRenderer({
    graphicsDir: join(dir, "graphics"), workDir: join(dir, "work"), fontDir: join(dir, "fonts"),
    assets: async () => ({ gsap: "/*g*/", kit: "/*k*/", css: "/*c*/" }),
    pack: async () => ({ root: "/p", node: "/p/node", hyperframes: "/p/hf.mjs", chrome: "/p/chrome" }),
    ffmpeg: () => "/usr/bin/true",
    run: async (project, output) => {
      runs.push({ project, output })
      if (over.slow) await new Promise((resolve) => setTimeout(resolve, over.slow))
      if (over.fail) throw new Error("chrome crashed")
      expect((await readFile(join(project, "index.html"), "utf8"))).toContain("data-composition-id")
      await writeFile(output, "mov")
    },
    poster: async (mov, png) => writeFile(png, "png"),
    send: (event) => events.push(event),
  })
  return { dir, events, runs, renderer }
}

test("the hash names the file; the same job is not rendered twice; another palette is another file", async () => {
  const { dir, renderer, runs } = await setup()
  const a = renderer.hashOf(job())
  expect(a).toMatch(/^[0-9a-f]{16}$/)
  expect(renderer.hashOf(job({ palette: HIGHLIGHT_STYLES["sale-yellow"].palette }))).not.toBe(a)
  await renderer.wait([job()], "/drafts/0917")
  await renderer.wait([job()], "/drafts/0917")
  expect(runs).toHaveLength(1)
  expect(await renderer.statusOf(a)).toBe("ready")
  expect((await stat(join(dir, "graphics", `${a}.mov`))).size).toBeGreaterThan(0)
  const meta = JSON.parse(await readFile(join(dir, "graphics", `${a}.json`), "utf8"))
  expect(meta).toMatchObject({ width: 1004, height: expect.any(Number), durationUs: 3_000_000, place: expect.any(Object) })
})

test("ensure() queues in the background and reports progress; wait() settles when they are all done", async () => {
  const { events, renderer } = await setup({ slow: 10 })
  renderer.ensure([job(), job({ spec: { ...spec, seconds: 4 } })], "/drafts/0917")
  expect(await renderer.statusOf(renderer.hashOf(job()))).toBe("waiting")
  await renderer.wait([job(), job({ spec: { ...spec, seconds: 4 } })], "/drafts/0917")
  expect(events.filter((event) => event.type === "graphics" && event.state === "progress").map((event) => (event as { done: number }).done)).toEqual([1, 2])
  expect(events.at(-1)).toEqual({ type: "graphics", folder: "/drafts/0917", state: "done" })
})

test("a failed render is remembered until retried, and reported", async () => {
  const { events, renderer, runs } = await setup({ fail: true })
  const hash = renderer.hashOf(job())
  await expect(renderer.wait([job()], "/drafts/0917")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(await renderer.statusOf(hash)).toBe("failed")
  expect(renderer.failureOf(hash)).toContain("chrome crashed")
  expect(events.some((event) => event.type === "graphics" && event.state === "failed" && event.hash === hash)).toBe(true)
  await renderer.wait([job()], "/drafts/0917")
  expect(runs).toHaveLength(1)
  renderer.retry(hash)
  await renderer.wait([job()], "/drafts/0917")
  expect(runs).toHaveLength(2)
})

test("no pack: nothing renders, status says waiting, wait() reports them as not ready without throwing", async () => {
  const { renderer } = await setup()
  const none = createGraphicsRenderer({ ...renderer.deps, pack: async () => null })
  expect(await none.wait([job()], "/drafts/0917")).toEqual({ ready: [], failed: [] })
  expect(await none.statusOf(none.hashOf(job()))).toBe("waiting")
})

test("a HyperFrames home says it just checked for updates, so a render never asks the npm registry", async () => {
  const home = await mkdtemp(join(tmpdir(), "hfhome-"))
  await mkdir(join(home, ".hyperframes"), { recursive: true })
  await writeFile(join(home, ".hyperframes", "config.json"), JSON.stringify({ anonymousId: "keep-me", latestVersion: "0.9.0", lastUpdateCheck: "2020-01-01T00:00:00.000Z" }))
  const now = new Date("2026-09-24T10:00:00.000Z")
  await quietHyperframesHome(home, "0.8.65", now)
  expect(JSON.parse(await readFile(join(home, ".hyperframes", "config.json"), "utf8"))).toEqual({ anonymousId: "keep-me", latestVersion: "0.8.65", lastUpdateCheck: "2026-09-24T10:00:00.000Z", lastSkillsCheck: "2026-09-24T10:00:00.000Z" })
  const fresh = await mkdtemp(join(tmpdir(), "hfhome-"))
  await quietHyperframesHome(fresh, "0.8.65", now)
  expect(JSON.parse(await readFile(join(fresh, ".hyperframes", "config.json"), "utf8"))).toEqual({ latestVersion: "0.8.65", lastUpdateCheck: "2026-09-24T10:00:00.000Z", lastSkillsCheck: "2026-09-24T10:00:00.000Z" })
})

test("a render's PATH holds the three system tools and nothing left from before", async () => {
  const dir = join(await mkdtemp(join(tmpdir(), "rpath-")), "bin")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "git"), "stale")
  expect(await renderPath(dir)).toBe(dir)
  expect((await readdir(dir)).sort()).toEqual(["id", "pgrep", "ps"])
  expect(await readlink(join(dir, "pgrep"))).toBe("/usr/bin/pgrep")
  expect(await readlink(join(dir, "ps"))).toBe("/bin/ps")
})

test("the poster is a small PNG next to the file, given to the app as a data URL", async () => {
  const { renderer } = await setup()
  await renderer.wait([job()], "/drafts/0917")
  expect(await renderer.posterOf(renderer.hashOf(job()))).toBe(`data:image/png;base64,${Buffer.from("png").toString("base64")}`)
  expect(await renderer.posterOf("0000000000000000")).toBeNull()
})
```

- [ ] **Note:** `--player-ready-timeout 20000`: a kit page whose build throws never registers its timeline, and HyperFrames would wait its default 45 s before failing; the kit registers within ~100 ms normally. `assets` is now `{ kit, timeline, css }` from `kitAssets(dir)` (Task 9 split the timeline into `timeline.js`).

- [ ] **Step 2b: a render stops cleanly.** `runProcess` (core `media/process.ts`) kills its child with SIGKILL on abort, which gives HyperFrames no chance to close its Chrome workers (they would linger until the next render's orphan sweep). HyperFrames treats SIGTERM as "cancel the render" and closes Chrome itself (cli.js `installSignalHandlers` / `createRenderCancellationScope`), and it also stops by itself when its parent process goes away (`render_cancelled_parent_exited`). So `runProcess` gains an option `/** on abort, ask with SIGTERM and only SIGKILL after this many ms */ stopGraceMs?: number`: with it, abort sends SIGTERM, then SIGKILL if the child has not closed after the grace. Test in `packages/core/src/media/process.test.ts`: a `/bin/sh -c 'trap "echo bye; exit 0" TERM; while :; do sleep 0.05; done'` child aborted with `stopGraceMs: 2000` prints `bye` (it got SIGTERM) and the promise rejects with the abort reason; the same child that ignores TERM (`trap "" TERM`) is SIGKILLed after a 200 ms grace. The render uses `stopGraceMs: 5000`. The renderer gets `cancel(): void` that aborts the render in flight (an `AbortController` combined with the timeout via `AbortSignal.any`), and `index.ts` calls it in `before-quit`. Test with a fake `run` that waits on the signal it is given — `run` gains a `signal` parameter.

- [ ] **Step 3: run** — FAIL. **Step 4: implement**:

```ts
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { runProcess } from "@boxblack/core/media"
import { PACK_HYPERFRAMES_VERSION } from "../shared/graphics-pack.ts"
import { placeOnCanvas, renderBox, type PixelBox } from "@boxblack/core/graphics/framing"
import { graphicHtml, type GraphicAssets } from "@boxblack/core/graphics/kit"
import type { GraphicSpec } from "@boxblack/core/graphics/plan"
import type { Palette } from "@boxblack/core/highlights/styles"
import type { AppEvent, GraphicRenderState } from "../shared/api.ts"
import type { GraphicsPackPaths } from "./graphics-pack.ts"

/** Everything a render depends on; the hash of it names the file. */
export interface RenderJob {
  spec: GraphicSpec
  canvas: { width: number; height: number }
  fps: number
  font: { family: string; file: string }
  /** the highlight style's palette as it is (Rgb); the kit picks readable colours from it (`graphicColours`) */
  palette: Palette
}

/** What the writer needs about a rendered file. */
export interface RenderedGraphic {
  hash: string
  path: string
  width: number
  height: number
  durationUs: number
  place: { scale: number; x: number; y: number }
}

export interface GraphicsRenderDeps {
  /** where the .mov, .png and .json land: ~/Movies/CapCut/BOXBLACK/graphics */
  graphicsDir: string
  /** scratch for the composition folders */
  workDir: string
  /** where the highlight fonts are (Resources/fonts) */
  fontDir: string
  assets: () => Promise<GraphicAssets>
  pack: () => Promise<GraphicsPackPaths | null>
  ffmpeg: () => string | null
  /** renders `project`/index.html into `output`; HyperFrames under the pack's Node by default */
  run?: (project: string, output: string, fps: number) => Promise<void>
  /** one small PNG from the middle of the file; the shipped ffmpeg by default */
  poster?: (mov: string, png: string, midS: number) => Promise<void>
  send: (event: AppEvent) => void
}

const RENDER_TIMEOUT_MS = 120_000
const POSTER_WIDTH = 270

/**
 * Before every command HyperFrames asks the npm registry for a newer version of itself and GitHub
 * (through git) for newer agent skills, unless its config (`<HOME>/.hyperframes/config.json`) says
 * it asked less than a day ago; the environment variables only stop the notices and the
 * self-install, not the requests, and with no skills installed it never records the skills check.
 * Writing that both were just checked, the pinned version being the latest, keeps a render off the
 * network. Other keys are kept.
 */
export async function quietHyperframesHome(home: string, version: string, now = new Date()): Promise<void> {
  const file = join(home, ".hyperframes", "config.json")
  let config: Record<string, unknown> = {}
  try {
    const read = JSON.parse(await readFile(file, "utf8")) as unknown
    if (read && typeof read === "object" && !Array.isArray(read)) config = read as Record<string, unknown>
  } catch {
    // none yet, or not JSON: start over
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ ...config, lastUpdateCheck: now.toISOString(), latestVersion: version, lastSkillsCheck: now.toISOString() }))
}

/**
 * What a render runs by name: `id`, `pgrep` and `ps` watch and clean up the Chrome processes, and
 * `ps` samples their memory while frames are captured (read in HyperFrames 0.8.65's cli.js; the
 * pack build script links the same set, so a pack that needs another one fails there first).
 * ffmpeg and ffprobe are given by path (HYPERFRAMES_FFMPEG_PATH / HYPERFRAMES_FFPROBE_PATH), which
 * also stops HyperFrames falling back to a Homebrew ffmpeg when ours is missing.
 */
const RENDER_TOOLS = { id: "/usr/bin/id", pgrep: "/usr/bin/pgrep", ps: "/bin/ps" } as const

/**
 * The only folder on a render's PATH, made fresh each time, holding links to the system tools a
 * render needs and nothing else: with /usr/bin on the PATH, HyperFrames' skills check would run
 * git, which on a Mac without the developer tools pops up an installer on every render.
 */
export async function renderPath(dir: string): Promise<string> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const [name, target] of Object.entries(RENDER_TOOLS)) await symlink(target, join(dir, name))
  return dir
}

/**
 * Renders graphics one at a time in the background and keeps what it made by the hash of the job,
 * so the same graphic is never rendered twice and any change to it is a new file. A failure is
 * kept until the user retries; nothing is deleted here (a CapCut draft may point at the file).
 */
export function createGraphicsRenderer(deps: GraphicsRenderDeps) {
  const failures = new Map<string, string>()
  const inFlight = new Map<string, Promise<void>>()
  let chain: Promise<void> = Promise.resolve()

  const files = (hash: string) => ({ mov: join(deps.graphicsDir, `${hash}.mov`), png: join(deps.graphicsDir, `${hash}.png`), json: join(deps.graphicsDir, `${hash}.json`) })
  const exists = (path: string) => stat(path).then(() => true, () => false)

  function hashOf(job: RenderJob): string {
    return createHash("sha256").update(JSON.stringify([job.spec, job.canvas, job.fps, job.font, job.palette])).digest("hex").slice(0, 16)
  }

  function boxOf(job: RenderJob): PixelBox {
    // a ring reaches its radius around the target; an arrow ends on it
    const targets = job.spec.pieces.flatMap((piece) => (piece.target ? [{ ...piece.target, radius: piece.kind === "ring" ? (piece.size ?? 0.25) / 2 : 0 }] : []))
    return renderBox(job.spec.box, targets, job.canvas)
  }

  async function runHyperframes(project: string, output: string, fps: number): Promise<void> {
    const pack = await deps.pack()
    const ffmpeg = deps.ffmpeg()
    if (!pack || !ffmpeg) throw new Error("the graphics renderer is not installed")
    const home = join(deps.workDir, "home")
    // before every render: both checks' notes last a day, and the skills one is never renewed without skills
    await quietHyperframesHome(home, PACK_HYPERFRAMES_VERSION)
    await mkdir(join(home, "tmp"), { recursive: true })
    const bin = await renderPath(join(deps.workDir, "bin"))
    await runProcess(pack.node, [pack.hyperframes, "render", project, "--format", "mov", "--fps", String(fps), "--workers", "2", "--quiet", "--frames-cache-dir", "off", "--player-ready-timeout", "20000", "-o", output], {
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      env: {
        HOME: home,
        TMPDIR: join(home, "tmp"),
        XDG_STATE_HOME: join(home, ".state"),
        // only what a render calls: see renderPath
        PATH: bin,
        HYPERFRAMES_FFMPEG_PATH: ffmpeg,
        HYPERFRAMES_FFPROBE_PATH: join(dirname(ffmpeg), "ffprobe"),
        HYPERFRAMES_NO_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        HYPERFRAMES_SKIP_SKILLS: "1",
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
        HYPERFRAMES_NO_AUTO_INSTALL: "1",
        HYPERFRAMES_BROWSER_PATH: pack.chrome,
        HYPERFRAMES_FONT_CACHE_DIR: join(home, "fonts"),
        LANG: "en_US.UTF-8",
      },
    })
  }

  async function makePoster(mov: string, png: string, midS: number): Promise<void> {
    const ffmpeg = deps.ffmpeg()
    if (!ffmpeg) throw new Error("ffmpeg-missing")
    await runProcess(ffmpeg, ["-nostdin", "-v", "error", "-y", "-ss", String(midS), "-i", mov, "-frames:v", "1", "-vf", `scale=${POSTER_WIDTH}:-2`, "-pix_fmt", "rgba", "-update", "1", png])
  }

  async function render(job: RenderJob, hash: string): Promise<void> {
    const out = files(hash)
    if (await exists(out.json)) return
    const box = boxOf(job)
    const project = join(deps.workDir, "compose", hash)
    await rm(project, { recursive: true, force: true })
    await mkdir(join(project, "renders"), { recursive: true })
    const html = graphicHtml({ spec: job.spec, render: box, canvas: job.canvas, fps: job.fps, palette: job.palette, font: job.font, assets: await deps.assets() })
    await writeFile(join(project, "index.html"), html)
    await copyFile(join(deps.fontDir, job.font.file), join(project, job.font.file))
    const made = join(project, "renders", `${hash}.mov`)
    try {
      await (deps.run ?? runHyperframes)(project, made, job.fps)
      await mkdir(deps.graphicsDir, { recursive: true })
      // across volumes (tmp → ~/Movies) rename fails: copy then remove
      await rename(made, out.mov).catch(async () => {
        await copyFile(made, out.mov)
        await rm(made, { force: true })
      })
      await (deps.poster ?? makePoster)(out.mov, out.png, job.spec.seconds / 2)
      const meta: Omit<RenderedGraphic, "hash" | "path"> = { width: box.width, height: box.height, durationUs: Math.round(job.spec.seconds * 1_000_000), place: placeOnCanvas(box, job.canvas) }
      await writeFile(out.json, JSON.stringify(meta))
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  }

  /** Runs the jobs not yet made, one after another, reporting to `folder`. */
  function schedule(jobs: RenderJob[], folder: string): Promise<{ ready: string[]; failed: string[] }> {
    const ready: string[] = []
    const failed: string[] = []
    const work = jobs.map((job) => ({ job, hash: hashOf(job) }))
    const total = work.length
    let done = 0
    const tasks = work.map(({ job, hash }) => {
      let task = inFlight.get(hash)
      if (!task) {
        task = chain.then(async () => {
          if (failures.has(hash)) return
          if (!(await deps.pack())) return
          try {
            await render(job, hash)
          } catch (error) {
            failures.set(hash, String(error))
            deps.send({ type: "graphics", folder, state: "failed", hash, error: String(error) })
          }
        })
        chain = task.catch(() => {})
        inFlight.set(hash, task)
        void task.finally(() => inFlight.delete(hash))
      }
      return task.then(async () => {
        done++
        if (await exists(files(hash).json)) ready.push(hash)
        else if (failures.has(hash)) failed.push(hash)
        deps.send({ type: "graphics", folder, state: "progress", done, total })
      })
    })
    return Promise.all(tasks).then(() => {
      deps.send({ type: "graphics", folder, state: "done" })
      return { ready, failed }
    })
  }

  return {
    deps,
    hashOf,
    /** Starts rendering what is not made yet and returns at once. */
    ensure(jobs: RenderJob[], folder: string): void {
      void schedule(jobs, folder)
    },
    /** Renders what is not made yet and settles when every job is made or has failed. */
    wait(jobs: RenderJob[], folder: string): Promise<{ ready: string[]; failed: string[] }> {
      return schedule(jobs, folder)
    },
    async statusOf(hash: string): Promise<GraphicRenderState> {
      if (await exists(files(hash).json)) return "ready"
      if (failures.has(hash)) return "failed"
      return inFlight.has(hash) ? "rendering" : "waiting"
    },
    failureOf: (hash: string): string | null => failures.get(hash) ?? null,
    retry(hash: string): void {
      failures.delete(hash)
    },
    async posterOf(hash: string): Promise<string | null> {
      try {
        return `data:image/png;base64,${(await readFile(files(hash).png)).toString("base64")}`
      } catch {
        return null
      }
    },
    /** The rendered file for a job, or null when it is not made. */
    async rendered(job: RenderJob): Promise<RenderedGraphic | null> {
      const hash = hashOf(job)
      try {
        const meta = JSON.parse(await readFile(files(hash).json, "utf8")) as Omit<RenderedGraphic, "hash" | "path">
        return { hash, path: files(hash).mov, ...meta }
      } catch {
        return null
      }
    },
  }
}

export type GraphicsRenderer = ReturnType<typeof createGraphicsRenderer>
```

`statusOf` in the "no pack" test returns "waiting" because nothing is in flight and nothing failed — the test asserts that.

- [ ] **Step 5: run** — PASS. Mutation check (hash inputs, dedupe of in-flight, failure memory, cross-volume fallback).
- [ ] **Step 6: files helper** `graphics-files.ts` with tests:

```ts
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

/** How much the graphics folder holds. */
export async function graphicFilesInfo(dir: string): Promise<{ count: number; bytes: number }> {
  let count = 0
  let bytes = 0
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".mov")) continue
      count++
      bytes += (await stat(join(dir, name))).size
    }
  } catch {
    // no folder yet
  }
  return { count, bytes }
}

/**
 * Moves to the Trash the rendered files no draft under CapCut's root refers to any more, with their
 * poster and meta. A draft that cannot be read counts as referring to everything: nothing is
 * trashed then, since a file it points at would otherwise be lost.
 */
export async function cleanGraphicFiles(deps: { dir: string; draftsRoot: string | null; trash: (path: string) => Promise<void> }): Promise<{ trashed: number }> {
  if (!deps.draftsRoot) return { trashed: 0 }
  const referenced = new Set<string>()
  let drafts: string[]
  try {
    drafts = (await readdir(deps.draftsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(deps.draftsRoot!, entry.name))
  } catch {
    return { trashed: 0 }
  }
  for (const draft of drafts) {
    let info: { materials?: { videos?: { path?: string }[] } }
    try {
      info = JSON.parse(await readFile(join(draft, "draft_info.json"), "utf8")) as typeof info
    } catch {
      try {
        await stat(join(draft, "draft_meta_info.json"))
        return { trashed: 0 } // a draft, but unreadable: keep everything
      } catch {
        continue // not a draft folder
      }
    }
    for (const video of info.materials?.videos ?? []) if (video.path) referenced.add(video.path)
  }
  let trashed = 0
  let names: string[]
  try {
    names = await readdir(deps.dir)
  } catch {
    return { trashed: 0 }
  }
  for (const name of names) {
    if (!name.endsWith(".mov")) continue
    const path = join(deps.dir, name)
    if (referenced.has(path)) continue
    const hash = name.slice(0, -4)
    for (const file of [path, join(deps.dir, `${hash}.png`), join(deps.dir, `${hash}.json`)]) await deps.trash(file).catch(() => {})
    trashed++
  }
  return { trashed }
}
```

Tests: a referenced file stays, an unreferenced one goes with its png/json (fake `trash` records), an unreadable draft_info keeps everything, no root → 0. Run — PASS. Commit.

---

## Task 11: graphics on the rough cut — sentences, in force, view, jobs (main `graphics-cues.ts`) and the plan wiring in `flair.ts`

**Files:** `apps/desktop/src/main/graphics-cues.ts` (new), `apps/desktop/src/main/graphics-cues.test.ts` (new), `apps/desktop/src/main/flair.ts`, `apps/desktop/src/main/flair.test.ts`, `apps/desktop/src/main/highlight-state.ts`, `apps/desktop/src/main/highlight-state.test.ts`, `apps/desktop/src/main/legacy-beats.ts`, `apps/desktop/src/main/legacy-beats.test.ts`, `apps/desktop/src/main/planner.ts`, `apps/desktop/src/main/planner.test.ts`, `packages/core/src/flair/catalogue.ts`, `packages/core/src/flair/catalogue.test.ts`, `apps/desktop/src/main/settings.ts`, `apps/desktop/src/main/settings.test.ts`, `apps/desktop/src/shared/api.ts`

- [ ] **Step 1: the switch** — `FlairOptions` gains `/** motion graphics rendered over the picture; off until the user turns it on, since it needs the renderer pack */ graphic: boolean`; `DEFAULT_FLAIR_OPTIONS.graphic = false`. Test in `catalogue.test.ts`: the default is off. `settings.ts`: `graphic: flag(raw.flair?.graphic, DEFAULT_SETTINGS.flair.graphic)`; test: a stored settings file without it reads `false`. `StoredOutline.flair` gains `graphics?: GraphicCue[]` (import the type from `@boxblack/core/graphics/plan`, type-only).

- [ ] **Step 2: failing tests** `graphics-cues.test.ts` (fixtures as `insert-media.test.ts` builds them — a plan with two beats, a sentence list, a `place` resolver):

```ts
test("graphic sentences carry the scene playing under them, whether text or a cutaway sits on them, and where their frame comes from", () => {
  const sentences = graphicSentences({ sentences: SENTENCES, clips: CLIPS, plan: PLAN, textOn: new Set([SENTENCES[1]!]), insertOn: new Set() })
  expect(sentences[0]).toMatchObject({ scene: { kind: "talking-head", keepClear: { fromY: 0.1, toY: 0.45 } }, hasText: false, hasInsert: false, endUs: SENTENCES[0]!.endUs })
  expect(sentences[1]!.hasText).toBe(true)
  expect(sceneFrameTimes(sentences)).toEqual([{ videoId: "v", sourceUs: 11_000_000 }]) // one per distinct scene, at the scene's middle
})

test("graphics in force: placed on the rough cut, off ones skipped, those over a cutaway dropped, boxes moved off the face", () => {
  const { kept, dropped } = graphicsInForce({ graphics: [CUE, { ...CUE, off: true }, LATE_CUE], place, flair: FLAIR_ON, durationUs: 60_000_000, inserts: [{ atUs: 20_000_000, durationUs: 2_000_000 }], keepClearAt: () => ({ fromY: 0.5, toY: 0.8 }) })
  expect(kept.map((g) => g.atUs)).toEqual([2_000_000])
  expect(kept[0]!.cue.spec.box.y0).toBeGreaterThanOrEqual(0.8) // moved below the band
  expect(dropped).toBe(1)
})

test("a graphic whose sentence is cut away is not in force and counts", () => {
  expect(graphicsInForce({ graphics: [CUE], place: () => null, flair: FLAIR_ON, durationUs: 60_000_000, inserts: [], keepClearAt: () => null })).toEqual({ kept: [], dropped: 1 })
})

test("with the switch off, or the quiet level, nothing is in force", () => {
  expect(graphicsInForce({ graphics: [CUE], place, flair: { ...FLAIR_ON, graphic: false }, durationUs: 60_000_000, inserts: [], keepClearAt: () => null }).kept).toEqual([])
})

test("a job for the renderer carries the style in force", () => {
  const job = graphicJob(kept[0]!, { canvas: { width: 1080, height: 1920 }, fps: 30, style: HIGHLIGHT_STYLES["bold-white"] })
  expect(job).toMatchObject({ fps: 30, font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" }, palette: HIGHLIGHT_STYLES["bold-white"].palette })
})

test("the view summarises what the graphic is", () => {
  expect(summaryOf(CUE.spec)).toBe("ตัวเลขวิ่ง 0 → 1,200,000 บาท · ป้าย ยอดขาย")
})
```

- [ ] **Step 3: run** — FAIL. **Step 4: implement** `graphics-cues.ts`:

```ts
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import type { FlairOptions } from "@boxblack/core/flair/catalogue"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import type { GraphicSentence } from "@boxblack/core/graphics/direct"
import { dodgeKeepClear } from "@boxblack/core/graphics/framing"
import { enforceGraphics, type GraphicCue, type GraphicPiece, type GraphicSpec, type PlacedGraphic } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_FONTS, type HighlightStyle } from "@boxblack/core/highlights/styles"
import type { Scene } from "@boxblack/core/vision"
import type { GraphicView } from "../shared/api.ts"
import type { RenderJob } from "./graphics-render.ts"
import type { Place } from "./insert-media.ts"
import type { SpokenSentence } from "./spoken.ts"

const FONT_FAMILY: Record<keyof typeof HIGHLIGHT_FONTS, string> = { kanit: "Kanit", mali: "Mali", chonburi: "Chonburi" }

/** The scene of a clip playing at a source time. */
function sceneAt(clips: CutClip[], videoId: string, sourceUs: number): Scene | null {
  const scenes = clips.find((clip) => clip.id === videoId)?.insight?.scenes ?? []
  return scenes.find((scene) => scene.startUs <= sourceUs && sourceUs < scene.endUs) ?? null
}

/** The spoken sentences as Claude is shown them for graphics. */
export function graphicSentences(input: { sentences: SpokenSentence[]; clips: CutClip[]; plan: CutPlan; textOn: Set<SpokenSentence>; insertOn: Set<SpokenSentence> }): GraphicSentence[] {
  return input.sentences.map((sentence) => {
    const scene = sceneAt(input.clips, sentence.videoId, sentence.words[0]!.startUs)
    return {
      videoId: sentence.videoId,
      beatId: sentence.beatId,
      atUs: sentence.timelineUs,
      text: sentence.text,
      words: sentence.words,
      endUs: sentence.endUs,
      scene: scene ? { description: scene.description, kind: scene.kind, keepClear: scene.keepClear } : null,
      hasText: input.textOn.has(sentence),
      hasInsert: input.insertOn.has(sentence),
    }
  })
}

/** One frame per distinct scene the sentences play in, at the scene's middle; the key is the sentence's frameKey. */
export function sceneFrameTimes(sentences: GraphicSentence[], clips: CutClip[]): { key: string; videoId: string; sourceUs: number }[] {
  const seen = new Map<string, { key: string; videoId: string; sourceUs: number }>()
  const out: { key: string; videoId: string; sourceUs: number }[] = []
  sentences.forEach((sentence, index) => {
    const scene = sceneAt(clips, sentence.videoId, sentence.words[0]!.startUs)
    const middle = scene ? Math.round((scene.startUs + scene.endUs) / 2) : sentence.words[0]!.startUs
    const id = `${sentence.videoId}:${middle}`
    const key = `${sentence.videoId}:${index + 1}`
    const known = seen.get(id)
    if (known) out.push({ ...known, key })
    else {
      const entry = { key, videoId: sentence.videoId, sourceUs: middle }
      seen.set(id, entry)
      out.push(entry)
    }
  })
  return out
}

/**
 * The graphics that will really play: the stored ones whose place is still on the rough cut,
 * their boxes moved off the band the scene must keep clear, put through the rules with the
 * cutaways' times taken.
 */
export function graphicsInForce(input: {
  graphics: GraphicCue[]
  place: (anchor: CueAnchor) => Place | null
  flair: FlairOptions
  durationUs: number
  inserts: { atUs: number; durationUs: number }[]
  keepClearAt: (atUs: number) => { fromY: number; toY: number } | null
}): { kept: PlacedGraphic[]; dropped: number } {
  if (!input.flair.enabled || !input.flair.graphic) return { kept: [], dropped: 0 }
  const placed: PlacedGraphic[] = []
  let gone = 0
  for (const cue of input.graphics) {
    const where = input.place(cue.anchor)
    if (!where) {
      gone++
      continue
    }
    const box = dodgeKeepClear(cue.spec.box, input.keepClearAt(where.atUs))
    placed.push({ cue: box === cue.spec.box ? cue : { ...cue, spec: { ...cue.spec, box } }, atUs: where.atUs, durationUs: Math.round(cue.spec.seconds * 1_000_000) })
  }
  const busy = input.inserts.map((insert) => ({ startUs: insert.atUs, endUs: insert.atUs + insert.durationUs }))
  const { kept, dropped } = enforceGraphics(placed, input.flair.level, input.durationUs, busy)
  return { kept, dropped: dropped + gone }
}

/** What the renderer is asked for: the spec in the style the highlight text uses. */
export function graphicJob(graphic: PlacedGraphic, args: { canvas: { width: number; height: number }; fps: number; style: HighlightStyle }): RenderJob {
  return {
    spec: graphic.cue.spec,
    canvas: args.canvas,
    fps: args.fps,
    font: { family: FONT_FAMILY[args.style.font], file: HIGHLIGHT_FONTS[args.style.font] },
    palette: args.style.palette,
  }
}

const KIND_NAMES: Record<GraphicPiece["kind"], string> = { number: "ตัวเลขวิ่ง", label: "ป้าย", bars: "แถบเทียบ", checks: "รายการติ๊ก", arrow: "ลูกศร", ring: "วงกลมชี้", icon: "ไอคอน" }
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 })

/** One line saying what a graphic is made of, for the screen. */
export function summaryOf(spec: GraphicSpec): string {
  return spec.pieces
    .map((piece) => {
      switch (piece.kind) {
        case "number":
          return `${KIND_NAMES.number} ${num(piece.from!)} → ${num(piece.to!)}${piece.unit ? ` ${piece.unit}` : ""}`
        case "label":
          return `${KIND_NAMES.label} ${piece.text}`
        case "bars":
        case "checks":
          return `${KIND_NAMES[piece.kind]} ${piece.items!.map((item) => item.text).join(", ")}`
        case "icon":
          return `${KIND_NAMES.icon} ${piece.icon}`
        default:
          return KIND_NAMES[piece.kind]
      }
    })
    .join(" · ")
}

/** The graphics as the timeline screen shows them; render state and poster are filled in by the caller. */
export function graphicViews(kept: PlacedGraphic[], place: (anchor: CueAnchor) => Place | null): Omit<GraphicView, "render" | "poster" | "error">[] {
  return kept.map((graphic) => {
    const where = place(graphic.cue.anchor)!
    return { anchor: graphic.cue.anchor, atUs: graphic.atUs, durationUs: graphic.durationUs, what: where.what, beatId: where.beatId, why: graphic.cue.spec.why, summary: summaryOf(graphic.cue.spec), spec: graphic.cue.spec, edited: graphic.cue.edited, off: graphic.cue.off }
  })
}
```

`GraphicView` in `api.ts`:

```ts
/** One graphic on the rough cut, as the timeline screen shows it. */
export interface GraphicView {
  anchor: CueAnchor
  atUs: number
  durationUs: number
  /** what it sits on, in the user's language */
  what: string
  beatId: string
  /** Claude's one line on why it is there */
  why: string
  /** what it is made of, in the user's language */
  summary: string
  spec: GraphicSpec
  render: GraphicRenderState
  /** a small PNG data URL once rendered */
  poster: string | null
  /** why the render failed, when it did */
  error: string | null
  edited: boolean
  off: boolean
}
```

Also `HighlightPreview` gains `graphics: GraphicView[]` and `/** the renderer pack is not installed, so graphics wait */ graphicsWaitForPack: boolean`.

- [ ] **Step 5: the plan call** in `flair.ts` — `FlairDeps` gains `videoPath?: (folder: string, videoId: string) => Promise<string | null>`, `graphics?: Pick<GraphicsRenderer, "ensure">`, and `styleOf?: (stored: StoredOutline) => Promise<HighlightStyle>` (the highlight style in force with the custom palette, as `timeline.ts` computes it). After `planned = await planFlair(...)` and before `amend`:

```ts
      // the graphics are a second, separate call: they need the scene under each sentence and a frame of it
      const wantsGraphics = !quiet && options.flair.graphic && canvas !== null
      let plannedGraphics: { graphics: GraphicCue[]; dropped: number } = { graphics: [], dropped: 0 }
      if (wantsGraphics) {
        const seeing = deps.frames?.()
        try {
          const spoken = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at: timelineOf(plan) })
          const textOn = new Set(spoken.filter((sentence) => timed.some((group) => group.videoId === sentence.videoId && group.lines.some((line) => line.from < sentence.to && sentence.from < line.to))))
          const insertOn = new Set(spoken.filter((sentence) => (latestInserts(stored)).some((insert) => insert.anchor.kind === "speech" && insert.anchor.videoId === sentence.videoId && insert.anchor.sourceUs >= sentence.words[0]!.startUs && insert.anchor.sourceUs <= sentence.endUs)))
          const sentences = graphicSentences({ sentences: spoken, clips, plan, textOn, insertOn })
          const frames: Record<string, string> = {}
          if (seeing && deps.videoPath) {
            for (const want of sceneFrameTimes(sentences, clips)) {
              const path = await deps.videoPath(folder, want.videoId)
              if (!path) continue
              const [frame] = await seeing.of(path, [want.sourceUs])
              if (frame) frames[want.key] = frame
            }
          }
          plannedGraphics = await planGraphics({ transport, model, brief: stored.brief, level: options.flair.level, sentences, canvas, frames })
        } finally {
          await seeing?.dispose()
        }
      }
```

(`timed` groups carry `videoId`/`from`/`to` per line via `PlacedGroup` lines — check `TimedGroup["lines"]` fields; if they do not carry word ranges, compare by `group.lines.some(line => line.startUs within sentence)` on source times instead. `latestInserts(stored)` = `stored.flair?.inserts ?? []`.)

In the `amend`: `const answerGraphics = answerOnBeats(plannedGraphics.graphics, stored.outline.beats, latest.outline.beats)`; `const myGraphics = (latest.flair?.graphics ?? []).filter((g) => g.edited)`; `const graphics = !wantsGraphics ? (latest.flair?.graphics ?? []) : [...myGraphics, ...answerGraphics.filter((g) => !myGraphics.some((own) => samePlace(own.anchor, g.anchor)))]`; put `graphics` into the returned `flair`; add `plannedGraphics.dropped` to the returned `dropped`. After the amend, if `wantsGraphics`, kick the renderer: `deps.graphics?.ensure(await jobsFor(folder, rules, options), folder)` — where `jobsFor` is the highlight service's `graphicJobs(folder, rules, options)` (Task 12) passed in as a dep: add `jobs?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<RenderJob[]>` to `FlairDeps`. Also add `graphics: moved(flair.graphics)` in `regroupFlair` (returned like `inserts`), `graphics` in `withBeatsRenamed`/`saveEdits`'s `kept`, and `insert`-style settling in `legacy-beats.ts` (`hasBeatless` and `withBeats` cover `flair.graphics` with `find.insert`). `flair.test.ts`: a test that with `graphic: true` a second transport call is made with the graphics prompt and its answer lands in `flair.graphics`, edited ones kept; with `graphic: false` there is one call. `highlight-state.test.ts`: a graphic on a gone highlight… no — graphics use speech anchors only, so `moved` leaves them; test that `regroupFlair` keeps `graphics` untouched. `legacy-beats.test.ts`: a beatless graphic gets its beat. `planner.test.ts`: `saveEdits` drops a graphic on a removed beat.

- [ ] **Step 6: run** all main tests — PASS. Mutation check `graphics-cues.ts` (dodge applied, busy from inserts, gone counted, switch). Commit.

**Changes since this task was written (from Task 8's review — they override the code above):**
- `GraphicSentence` has `textBand: { fromY, toY } | null` instead of `hasText`: where that sentence's highlight text is drawn, as shares of the frame height. Compute it from the same layout the preview and the write use (`placementOf` + `layoutGroup` in `highlight-state.ts`/core `highlights/layout.ts`): the union of the laid-out lines of every group whose words overlap the sentence, converting each line's transform y and height to shares from the top. Null when no group overlaps.
- `planGraphics` takes `durationUs` (`plan.durationUs`) and `captionsFromY` (the top of the subtitle area when subtitles are on — the same constant `highlights/layout.ts` keeps highlight text above — else null). It caps frames at 12 itself and only allows arrows and rings on sentences whose frame was attached.
- Take each sentence's frame at the sentence's own first word (source time), not the scene's middle, so a pointer aims where the thing is while it is being talked about. Keep one extraction per distinct (video, time) pair.
- A failed or refused graphics call must not fail "จัดลูกเล่น": the looks, sounds, zooms and cutaways Claude already answered are saved; the graphics are left as they were and the failure is reported in the result (add `graphicsError?: string` to what `plan` returns, shown as a notice in the flair tab).
- `graphicsInForce`'s dodge: a box is moved off `keepClear` and, when there is one, the sentence's `textBand` and the caption area too — merge the bands that the box overlaps into one before choosing the freer side, so a move off the face does not land on the text.
- Extract frames only for what `planGraphics` will attach: core exports `framesToAttach(sentences, frames)`, which groups by path and spreads at most 12 evenly over the clip. Build the candidate (sentence → frame path) map from distinct (video, first-word time) pairs, pass it through that selection, and extract only the chosen ones.
- The user's own graphics count against the budget. Show Claude every stored graphic the user edited (sentence number, summary, "(ผู้ใช้แก้เอง)") as the flair prompt does for looks, subtract them from N, and tell Claude not to put another on those sentences. This needs a small addition to `planGraphics`/`describe()` in core: an `existing` list — add it with tests when doing this task.
- Known limit, write it in the code: `target` and `keepClear` are shares of the source frame, while boxes are shares of the canvas. They agree when the footage fills the canvas (the usual case: portrait footage on a portrait canvas); on a letterboxed or zoomed piece a pointer can be off. Not handled in v1.

---

## Task 12: the preview shows graphics; the API sets, removes and retries them (main `highlights.ts`, `flair.ts`, `highlight-api.ts`, `settings-api.ts`)

**Files:** `apps/desktop/src/main/highlights.ts`, `apps/desktop/src/main/highlights.test.ts`, `apps/desktop/src/main/flair.ts`, `apps/desktop/src/main/flair.test.ts`, `apps/desktop/src/main/highlight-api.ts`, `apps/desktop/src/main/highlight-api.test.ts`, `apps/desktop/src/main/settings-api.ts`, `apps/desktop/src/main/settings-api.test.ts`, `apps/desktop/src/main/timeline.ts` (`compiled` returns `fps`), `apps/desktop/src/shared/api.ts`

- [ ] **Step 1: API surface** in `api.ts` — `API_METHODS` gains `"setGraphic", "retryGraphic", "cleanGraphicFiles"`; `DesktopApi`:

```ts
  /** Switches a graphic off or on, changes its words, numbers, units or length by hand (Claude leaves it alone after), or removes it with null. */
  setGraphic(folder: string, anchor: CueAnchor, patch: GraphicPatch | null): Promise<void>
  /** Renders a graphic again after it failed. */
  retryGraphic(folder: string, anchor: CueAnchor): Promise<void>
  /** Trashes rendered graphics no CapCut draft refers to any more. */
  cleanGraphicFiles(): Promise<{ trashed: number }>
```

```ts
/** What the user may change on a graphic from the timeline screen; leaving a field out keeps it. */
export interface GraphicPatch {
  off?: boolean
  seconds?: number
  /** by piece index: the texts and numbers of that piece */
  pieces?: Record<number, { text?: string; from?: number; to?: number; unit?: string; items?: { text: string; value?: number }[] }>
}
```

`HighlightViewOptions.flair` already carries the whole `FlairOptions`, so `graphic` travels with it; `checkedOptions` in `highlight-api.ts` adds `looks?.graphic` to `flags` and `graphic: looks.graphic` to the returned object (with tests for a request missing it → refused).

- [ ] **Changes from Task 11 (override the code below):** `graphicsInForce` returns `{ kept, off, dropped }` and `graphicViews({ kept, off }, place)` lists the switched-off graphics after the kept ones with `off: true` — the preview must pass both, or a graphic switched off can never be switched back on. Jobs (renders) are only for `kept`. `GraphicView` is already in `api.ts`; add `HighlightPreview.graphics: GraphicView[]` and `graphicsWaitForPack: boolean` here, and fill them. The preview must dodge exactly as the plan did: call `graphicsInForce` with `textBandOf` built from `sentenceOf` + `textBandOn` + `textBands` (all in `graphics-cues.ts`) and `captionsFromY: options.subtitlesOn ? SUBTITLE_ROOM_FROM_Y : null` (core `highlights/layout.ts`). The highlight service's `graphicJobs(folder, rules, options)` returns `{ kept, jobs }` and is what `FlairDeps.graphicJobs` expects (flair only reads `jobs`). `highlight-api.ts` already passes `graphic: looks.graphic === true` through `checkedOptions`; add `looks?.graphic` to the refused-if-not-boolean flags with a test. The `planFlair` API result gains `graphicsError?: string` (already in `api.ts`); `highlight-api` passes it through.

- [ ] **Step 2: `compiled` returns fps** — in `timeline.ts` `compiled()` return `{ stored, plan, clips, canvas, fps: draft.info.fps }`; the highlight service's `HighlightDeps.timeline` type follows.

- [ ] **Step 3: the preview** — `HighlightDeps` gains:

```ts
  /** the graphics renderer: what is made, what is not, and the pictures of it */
  graphics?: Pick<GraphicsRenderer, "hashOf" | "statusOf" | "posterOf" | "failureOf" | "ensure">
  /** whether the renderer pack is installed */
  graphicsReady?: () => Promise<boolean>
  /** the highlight style in force, custom palette included, for the graphics' colours */
  styleOf?: (stored: StoredOutline) => Promise<HighlightStyle>
```

A `graphicView(stored, plan, clips, canvas, fps, flair, folder)` in the service:

```ts
  /** The graphics that will play, with what the renderer has made of them so far. */
  async function graphicView(stored: StoredOutline, plan: CutPlan, timed: TimedGroup[], clips: CutClip[], canvas: { width: number; height: number } | null, fps: number, flair: FlairOptions, folder: string, inserts: { atUs: number; durationUs: number }[]) {
    if (!flair.enabled || !flair.graphic || !canvas) return { graphics: [], graphicsWaitForPack: false }
    const at = timelineOf(plan)
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const slots = slotsFor({ plan, groups: timed, beatNames, at })
    const sentences = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at })
    const place = placeOf({ slots, sentences, plan, at })
    const { kept } = graphicsInForce({ graphics: stored.flair?.graphics ?? [], place, flair, durationUs: plan.durationUs, inserts, keepClearAt: (atUs) => keepClearAt(plan, clips, atUs) })
    const views = graphicViews(kept, place)
    const ready = (await deps.graphicsReady?.()) ?? false
    if (!deps.graphics || !deps.styleOf) return { graphics: views.map((view) => ({ ...view, render: "waiting" as const, poster: null, error: null })), graphicsWaitForPack: !ready }
    const style = await deps.styleOf(stored)
    const jobs = kept.map((graphic) => graphicJob(graphic, { canvas, fps, style }))
    // what is not made yet starts now, in the background
    if (ready) deps.graphics.ensure(jobs, folder)
    const graphics = await Promise.all(
      views.map(async (view, i) => {
        const hash = deps.graphics!.hashOf(jobs[i]!)
        return { ...view, render: await deps.graphics!.statusOf(hash), poster: await deps.graphics!.posterOf(hash), error: deps.graphics!.failureOf(hash) }
      }),
    )
    return { graphics, graphicsWaitForPack: !ready }
  }
```

`view()` becomes async where it composes the parts; `insertView`'s `kept` (the placed inserts) is passed to `graphicView` as `inserts` so a graphic never sits on a cutaway. `preview()` passes `compiled.fps`. Expose on the service:

```ts
    /** The render jobs of the graphics in force, for whoever must render them (the write) or start them (the plan). */
    async graphicJobs(folder: string, rules: CutRules, options: HighlightViewOptions): Promise<{ kept: PlacedGraphic[]; jobs: RenderJob[] }>
```

built from the same in-force computation (factor the in-force part out of `graphicView` into `inForceGraphics(...)` used by both). Tests in `highlights.test.ts`: the preview lists a stored graphic with `render: "ready"` and a poster from a fake renderer; with no pack, `graphicsWaitForPack: true` and `render: "waiting"`; a graphic over a cutaway is not listed; `ensure` is called with one job per graphic.

- [ ] **Step 4: `setGraphic` / `retryGraphic`** in `flair.ts`:

```ts
    /** A graphic switched off or on, or changed by hand — its words, numbers, length — or taken away; Claude leaves it alone after that. */
    async setGraphic(folder: string, anchor: CueAnchor, patch: GraphicPatch | null): Promise<void> {
      await outline(folder)
      await amend(folder, (stored) => {
        const graphics = stored.flair?.graphics ?? []
        const index = graphics.findIndex((graphic) => samePlace(graphic.anchor, anchor))
        if (index < 0) throw new Error("there is no graphic at that place")
        if (patch === null) return { ...stored, flair: { ...(stored.flair ?? { looks: {} }), graphics: graphics.filter((_, i) => i !== index) } }
        const was = graphics[index]!
        const pieces = was.spec.pieces.map((piece, i) => {
          const change = patch.pieces?.[i]
          if (!change) return piece
          return {
            ...piece,
            ...(change.text !== undefined ? { text: change.text.trim().slice(0, 60) } : {}),
            ...(change.from !== undefined && Number.isFinite(change.from) ? { from: change.from } : {}),
            ...(change.to !== undefined && Number.isFinite(change.to) ? { to: change.to } : {}),
            ...(change.unit !== undefined ? { unit: change.unit.trim().slice(0, 12) } : {}),
            ...(change.items !== undefined && piece.items ? { items: piece.items.map((item, n) => ({ ...item, ...(change.items![n] ? { text: change.items![n]!.text.trim().slice(0, 40), ...(change.items![n]!.value !== undefined ? { value: change.items![n]!.value } : {}) } : {}) })) } : {}),
          }
        })
        const seconds = patch.seconds !== undefined ? Math.min(GRAPHIC_MAX_S, Math.max(GRAPHIC_MIN_US / 1_000_000, patch.seconds)) : was.spec.seconds
        const next: GraphicCue = { ...was, off: patch.off ?? was.off, spec: { ...was.spec, seconds, pieces }, edited: true }
        return { ...stored, flair: { ...stored.flair!, graphics: graphics.map((graphic, i) => (i === index ? next : graphic)) } }
      })
    },

    /** Forgets a failed render so the next look renders it again. */
    async retryGraphic(folder: string, anchor: CueAnchor): Promise<void> {
      const stored = await outline(folder)
      const graphic = (stored.flair?.graphics ?? []).find((candidate) => samePlace(candidate.anchor, anchor))
      if (!graphic || !deps.graphics || !deps.jobsOf) return
      for (const job of await deps.jobsOf(folder, graphic)) deps.graphics.retry(deps.graphics.hashOf(job))
    },
```

(`deps.jobsOf(folder, cue)` → the highlight service's job for that one cue under the current style, canvas and fps — add `jobFor(folder, cue)` to the highlight service next to `graphicJobs`; `retry` needs `Pick<GraphicsRenderer, "ensure" | "retry" | "hashOf">`.) `highlight-api.ts` validates: `patch === null` or an object whose `off` is boolean if present, `seconds` a finite number if present, `pieces` an object of small objects with `isText` strings and finite numbers; refuses anything else. Tests: off toggles, a text change marks `edited` and keeps the rest, a bad patch is refused, null removes, unknown anchor throws.

- [ ] **Step 5: settings API** — `createSettingsApi` deps gain `graphicFiles?: { info(): Promise<{ count: number; bytes: number }>; clean(): Promise<{ trashed: number }> }`; `getSettings` uses `info()`; `cleanGraphicFiles: () => deps.graphicFiles?.clean() ?? { trashed: 0 }`. Test: `cleanGraphicFiles` returns the fake's count.

- [ ] **Step 6: run** all main tests — PASS. Mutation check the new branches of `flair.ts` (`setGraphic` clamps, `edited` set, null removes). Commit.

---

## Task 13: the write lays the graphics down (main `timeline.ts`)

**Files:** `apps/desktop/src/main/timeline.ts`, `apps/desktop/src/main/timeline.test.ts`, `apps/desktop/src/shared/api.ts`

- [ ] **Step 1: shared** — `WriteResult` gains `/** graphics written; 0 without them */ graphicCount: number` and `/** graphics that could not be rendered in time and were left out */ graphicsSkipped: number`.

- [ ] **Step 2: failing tests** in `timeline.test.ts` (use its draft fixture; a fake `graphics` dep):

```ts
test("the write renders the graphics in force, waits for them, adds their bin items and one overlay track above the cutaways", async () => {
  // stored outline with one graphic on the first sentence; fake renderer whose wait() writes the meta and returns ready
  ...
  const result = await timeline.write(folder, rules, segments, null, { position: "auto", hideSubtitles: true, flair: { ...FLAIR_ON, graphic: true }, groupCount: 0 })
  expect(result.graphicCount).toBe(1)
  expect(result.graphicsSkipped).toBe(0)
  const info = JSON.parse(await readFile(join(folder, "draft_info.json"), "utf8"))
  const track = info.tracks.at(-1)
  expect(track).toMatchObject({ type: "video", flag: 2 })
  expect(track.segments[0].render_index).toBeGreaterThan(8 + info.tracks.length) // above the cutaway track's index
  expect(track.segments[0].render_index).toBeLessThan(14000)
  const meta = JSON.parse(await readFile(join(folder, "draft_meta_info.json"), "utf8"))
  expect(meta.draft_materials[0].value.some((item) => item.file_Path.endsWith(".mov"))).toBe(true)
  expect(fakeRenderer.waited).toEqual([[expect.objectContaining({ fps: 30 })], folder])
})

test("a graphic whose render failed is left out and counted; the pack missing fails the write with a clear message", async () => {
  ... expect(result.graphicsSkipped).toBe(1) ...
  ... await expect(timeline.write(...)).rejects.toThrow("the graphics renderer is not installed: install it in settings, or turn graphics off")
})

test("with graphics off nothing is rendered and no track is added", ...)
```

- [ ] **Step 3: implement** — `TimelineDeps` gains `graphics?: Pick<GraphicsRenderer, "wait" | "rendered">`, `graphicsReady?: () => Promise<boolean>`, `graphicJobs?: (folder: string, rules: CutRules, options: HighlightViewOptions) => Promise<{ kept: PlacedGraphic[]; jobs: RenderJob[] }>` (the highlight service's, wired in `index.ts` — the timeline service already depends on `outlines`; to avoid a cycle pass the function in). In `write`, after the cutaways and before the sound cues:

```ts
      // the graphics sit over the cutaways but under the text; rendered files are waited for here
      let graphics: TimelineGraphic[] = []
      let graphicsSkipped = 0
      const binItems: BinItem[] = []
      const idOfPath = new Map<string, string>()
      if (highlights?.flair.enabled && highlights.flair.graphic && highlights.flair.level !== "light" && deps.graphicJobs) {
        const { kept, jobs } = await deps.graphicJobs(folder, rules, { position: highlights.position, subtitlesOn: subtitles !== null, flair: highlights.flair })
        if (kept.length > 0) {
          if (!deps.graphics || !(await deps.graphicsReady?.())) throw new Error("the graphics renderer is not installed: install it in settings, or turn graphics off")
          await deps.graphics.wait(jobs, folder)
          const frames = onFrames(cutPlan, at)
          for (const [i, graphic] of kept.entries()) {
            const made = await deps.graphics.rendered(jobs[i]!)
            if (!made) {
              graphicsSkipped++
              continue
            }
            // a file already in the bin (written before) keeps its entry, and two graphics made of the same file share one;
            // the item is always handed over — addBinItems skips an id that is there — in case the entry went
            // while the graphics rendered (CapCut opened and edited the project meanwhile)
            const binId = idOfPath.get(made.path) ?? binIdOf(draft.meta, made.path) ?? newBinId()
            idOfPath.set(made.path, binId)
            binItems.push(graphicBinItem({ id: binId, path: made.path, width: made.width, height: made.height, durationUs: made.durationUs, nowMs: time.getTime() }))
            graphics.push({ atUs: frames(graphic.atUs), durationUs: graphic.durationUs, binId, path: made.path, name: basename(made.path), width: made.width, height: made.height, durationOfFileUs: made.durationUs, place: made.place })
          }
          if (graphics.length > 0) info = addGraphicTrack(info, graphics)
        }
      }
```

with `const newBinId = () => randomUUID()` (CapCut's bin ids are lower-case UUIDs, unlike its upper-case segment and material ids — read from 0917 on 2026-09-24). Then write with the bin brought in line — on EVERY write, graphics on or off, so entries for graphics this timeline no longer plays leave the user's media panel:

```ts
      const playing = new Set(graphics.map((graphic) => graphic.binId))
      await writeDraft(draft, info, {
        isCapCutRunning: deps.isCapCutRunning,
        // only files in BOXBLACK's own graphics folder are ever taken out, and the write replaces the whole timeline —
        // unless the project holds other timelines, which share this bin and may still play older graphics
        bin: (meta) => (deps.graphicsDir && liveTimelines(draft) <= 1 ? addBinItems(pruneBinItems(meta, deps.graphicsDir, playing), binItems) : addBinItems(meta, binItems)),
      })
```

`TimelineDeps` gains `graphicsDir?: string` (wired in `index.ts` to the same `~/Movies/CapCut/BOXBLACK/graphics`). `liveTimelines(draft)` counts the entries of the draft's `Timelines/project.json` `timelines` array that are not `is_marked_delete` (1 when the file is missing or unreadable, as in drafts older than multi-timeline support) — add it next to `timelineCopies` in core `capcut/write.ts` or `read.ts`, reading the file the same way `timelineCopies` finds it, with a test on the repo fixture `packages/core/test/fixtures/capcut-9.4/0917` (one live timeline) and on a copy with a second live timeline and a third marked deleted. Tests: a second write of the same graphic reuses its bin entry (one entry, same id); a write with graphics off removes the earlier graphic's entry and leaves the user's own media. Result: `graphicCount: graphics.length, graphicsSkipped`. (The write's `highlights.flair` is the `FlairOptions` the preview was shown with — `HighlightRequest.flair` — so `graphic` travels with it.)

- [ ] **Step 4: run** — PASS. Commit.

---

## Task 14: wiring in `index.ts`

**Files:** `apps/desktop/src/main/index.ts`

- [ ] **Step 1:** after `graphicsPack` (Task 4) create the renderer and the files helper:

```ts
  const graphicsDir = join(homedir(), "Movies", "CapCut", "BOXBLACK", "graphics")
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(import.meta.dirname, "../../resources")
  const graphicsRenderer = createGraphicsRenderer({
    graphicsDir,
    workDir: join(tmpdir(), "boxblack-graphics"),
    fontDir: join(resourcesDir, "fonts"),
    assets: async () => kitAssets(join(resourcesDir, "graphics")),
    pack: () => graphicsPack.paths(),
    ffmpeg: () => tools.ffmpeg,
    send,
  })
  const graphicsReady = async () => (await graphicsPack.paths()) !== null && tools.ffmpeg !== null
  const graphicFiles = {
    info: () => graphicFilesInfo(graphicsDir),
    clean: () => cleanGraphicFiles({ dir: graphicsDir, draftsRoot: findDraftsRoot(homedir()), trash: (path) => shell.trashItem(path) }),
  }
  const styleOf = async (stored: StoredOutline) => styleFor(styleInForce(stored.highlights), (await settings.read()).highlights.custom)
```

Pass `graphics: graphicsRenderer, graphicsReady, styleOf` to `createHighlightService`; `graphics: graphicsRenderer, graphicsReady, graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options)` to `createTimelineService` (declare `highlights` before `timeline` needs it at call time — the closure is only called at write time, so the order of `const` declarations is fine as long as `highlights` is assigned before any write happens; if TypeScript complains about use-before-assign, wrap in a `let highlights` or pass a getter); `videoPath: async (folder, videoId) => (await projects.inspectProject(folder)).videos.find((video) => video.id === videoId && video.exists)?.path ?? null`, `graphics: graphicsRenderer`, `graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options)`, `jobFor: (folder, cue) => highlights.jobFor(folder, cue)` to `createFlairService` (Task 12 named these deps `graphicJobs` and `jobFor`; `jobFor` returns one job or null); `graphicsPack` and `graphicFiles: { info: () => graphicFilesInfo(graphicsDir), clean: () => cleanGraphicFiles({ dir: graphicsDir, draftsRoot, backupRoot, trash }) }` to `createSettingsApi` (Task 12 made `graphicFiles` an object with `info` and `clean`). `cancelAi` stays as is. In `before-quit` call `graphicsRenderer.cancel()`: the render in flight gets SIGTERM and closes its Chrome workers (a child process does not die with the app on macOS; HyperFrames would notice its parent is gone, but only on its next watchdog tick). The half-made file is inside the temp compose folder, not in `graphics/`.

- [ ] **Changes from Task 11 (override the wiring above):** `createFlairService` takes `graphicJobs: (folder, rules, options) => highlights.graphicJobs(folder, rules, options)` (not `jobs`), `graphics: graphicsRenderer`, `videoPath`, and the frames session gains `at: (path, timesUs) => (tools.ffmpeg ? looking.of(path, timesUs) : Promise.resolve([]))` — without `at`, graphics are planned without frames. There is no `styleOf` dep on flair (the style reaches it through `graphicJobs`).

- [ ] **Changes from Task 10's review (override the wiring above):** `createGraphicsRenderer` takes `ffprobe: () => tools.ffprobe` as its own dep. `cleanGraphicFiles` takes `draftsRoot: findDraftsRoot(homedir())` and `backupRoot: join(userData, "backups")` (draft backups can be restored, so their graphics must stay) and returns `{ trashed, blockedBy: GraphicCleanBlock | null }`. The pack's `install()` and `remove()` call `graphicsRenderer.cancel()` first (wrap them in `index.ts`), so a render never runs against a pack being replaced — a cancel is not a failure, so the graphics simply render again afterwards.

- [ ] **Step 2:** `npm run typecheck` clean; `npm test` green. Commit.

---

## Task 15: the switch, the beat sorting and the flair tab section (renderer)

**Files:** `apps/desktop/src/renderer/src/edit/ClipSettingsSheet.tsx`, `apps/desktop/src/renderer/src/edit/byBeat.ts`, `apps/desktop/src/renderer/src/edit/byBeat.test.ts`, `apps/desktop/src/renderer/src/edit/FlairTab.tsx`, `apps/desktop/src/renderer/src/screens/EditScreen.tsx`, `apps/desktop/src/renderer/src/screens/EditScreen.test.tsx`, `apps/desktop/src/renderer/src/i18n.ts`, `apps/desktop/src/renderer/src/styles/edit.css`, `apps/desktop/src/renderer/test/fake-api.ts`

**Change from Task 12:** at flair level `light` the preview returns `graphics: []` and `graphicsWaitForPack: false` (no graphic can play there, switched-off ones included), so hide the FlairTab graphics section at `light` as Task 16 hides the row marks — otherwise it would show the "no graphics" hint for nothing.

- [ ] **Step 1: i18n keys**

```ts
  "flair.graphic": "กราฟิกซ้อนภาพ",
  "flair.graphicHint": "AI ทำกราฟิกเล็กๆ (ตัวเลขวิ่ง แถบเทียบ ลูกศร) ตามคำพูด ต้องติดตั้งตัวเรนเดอร์ในหน้าตั้งค่า และเรียก Claude เพิ่มหนึ่งครั้งตอนจัดลูกเล่น",
  "edit.flairGraphics": "กราฟิกในบีต · ตามประโยคที่พูด",
  "graphics.none": "AI ไม่ได้ใส่กราฟิกในบีตนี้",
  "graphics.waitForPack": "ยังไม่ได้ติดตั้งตัวเรนเดอร์กราฟิก กราฟิกจะเรนเดอร์หลังติดตั้งในหน้าตั้งค่า",
  "graphics.render.waiting": "รอเรนเดอร์",
  "graphics.render.rendering": "กำลังเรนเดอร์…",
  "graphics.render.ready": "พร้อม",
  "graphics.render.failed": "เรนเดอร์ไม่สำเร็จ",
  "graphics.retry": "ลองเรนเดอร์ใหม่",
  "graphics.off": "ปิดอันนี้",
  "graphics.on": "เปิดอันนี้",
  "graphics.edit": "แก้",
  "graphics.remove": "ลบ",
  "graphics.editTitle": "แก้กราฟิก",
  "graphics.seconds": "แสดงนานกี่วินาที",
  "graphics.pieceText": "ข้อความ",
  "graphics.pieceFrom": "จาก",
  "graphics.pieceTo": "ถึง",
  "graphics.pieceUnit": "หน่วย",
  "graphics.pieceItem": "ข้อ {n}",
  "graphics.save": "บันทึกและเรนเดอร์ใหม่",
  "graphics.mark": "กราฟิก",
  "graphics.posterAlt": "ภาพตัวอย่างกราฟิก {summary}",
  "graphics.editedHint": "แก้เองแล้ว AI จะไม่เปลี่ยน",
  "settings.graphicFiles": "ไฟล์กราฟิกที่เรนเดอร์ไว้ {count} ไฟล์ ({size})",
  "settings.graphicFilesHint": "ไฟล์อยู่ใต้ ~/Movies/CapCut/BOXBLACK/graphics แอปไม่ลบเอง เพราะโปรเจกต์ CapCut อาจยังใช้อยู่",
  "settings.graphicFilesClean": "ลบที่ไม่มีโปรเจกต์ไหนใช้",
  "settings.graphicFilesCleaned": "ย้ายไปถังขยะ {count} ไฟล์",
```

- [ ] **Step 2: the switch** in `ClipSettingsSheet.tsx` flair tab, after the insert switch:

```tsx
              <Switch label={t("flair.graphic")} checked={flair.graphic} onChange={(graphic) => props.onFlair({ ...flair, graphic })} hint={t("flair.graphicHint")} />
```

- [ ] **Step 3: byBeat** — `BeatFlair` gains `graphics: GraphicView[]` and `counts.graphic`; `empty()`, the sorting loop and the counts follow `inserts`. Test in `byBeat.test.ts`: graphics land in their beat in time order, an orphan in the last.

- [ ] **Step 4: FlairTab section** — props gain `graphicsWaitForPack: boolean`, `onGraphic: (anchor: CueAnchor, patch: GraphicPatch | null) => void`, `onRetryGraphic: (anchor: CueAnchor) => void`, `onEditGraphic: (graphic: GraphicView) => void`; the `if (!points && !pieces && !options.insert)` guard adds `&& !options.graphic`; after the inserts section:

```tsx
      {options.graphic && (
        <>
          <p className="tab-section">{t("edit.flairGraphics")}</p>
          {graphicsWaitForPack && <p className="notice warn-text">{t("graphics.waitForPack")}</p>}
          {flair.graphics.length === 0 && <p className="hint">{t("graphics.none")}</p>}
          {flair.graphics.length > 0 && (
            <ol className="flair-rows">
              {flair.graphics.map((graphic) => (
                <li key={cueKey(graphic.anchor)} className={graphic.off ? "flair-row graphic off" : "flair-row graphic"}>
                  <span className="hint mono">{formatTimestamp(graphic.atUs)}</span>
                  {graphic.poster ? <img className="graphic-poster" src={graphic.poster} alt={t("graphics.posterAlt", { summary: graphic.summary })} /> : <span className="graphic-poster empty" aria-hidden />}
                  <span className="graphic-body">
                    <span className="flair-what">{graphic.summary}</span>
                    <span className="hint">{graphic.why || graphic.what}</span>
                    <span className={`graphic-state ${graphic.render}`}>{t(`graphics.render.${graphic.render}` as MessageKey)}{graphic.render === "failed" && graphic.error ? ` · ${graphic.error.split("\n").slice(-3).join(" ")}` : ""}</span>
                  </span>
                  <span className="graphic-actions">
                    {graphic.render === "failed" && <Button size="sm" disabled={busy} onClick={() => onRetryGraphic(graphic.anchor)}>{t("graphics.retry")}</Button>}
                    <Button size="sm" disabled={busy} onClick={() => onEditGraphic(graphic)}>{t("graphics.edit")}</Button>
                    <Button size="sm" disabled={busy} onClick={() => onGraphic(graphic.anchor, { off: !graphic.off })}>{graphic.off ? t("graphics.on") : t("graphics.off")}</Button>
                    <Button size="sm" disabled={busy} onClick={() => onGraphic(graphic.anchor, null)}>{t("graphics.remove")}</Button>
                  </span>
                  {graphic.edited && <span className="hint">{t("flair.edited")}</span>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
```

A graphic switched off is not in `preview.graphics` (it is not in force) — so the "เปิดอันนี้" case needs the off ones listed too: `graphicView` in Task 12 must list off graphics as well (add them after the in-force ones with `render: "waiting"`, `off: true`, placed by `place()`; skip only the ones whose place is gone). Adjust Task 12's `graphicView` accordingly: compute `offOnes = (stored.flair?.graphics ?? []).filter((g) => g.off)` and map through `place`. Test it there.

CSS in `edit.css`:

```css
.flair-row.graphic { align-items: flex-start; }
.flair-row.graphic.off { opacity: 0.55; }
.graphic-poster { width: 68px; height: 68px; object-fit: contain; border-radius: 8px; background: var(--surface-2); flex: none; }
.graphic-poster.empty { display: inline-block; }
.graphic-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.graphic-state { font-size: var(--text-xs); color: var(--muted); }
.graphic-state.failed { color: var(--danger); }
.graphic-state.ready { color: var(--ok); }
.graphic-actions { display: flex; gap: 6px; flex-wrap: wrap; }
```

(use the token names `styles/tokens.css` defines; check them before writing.)

- [ ] **Step 5: EditScreen** — pass the new props: `graphicsWaitForPack={preview.graphicsWaitForPack}`, `onGraphic={(anchor, patch) => void changeHighlightText(() => api.setGraphic(folder, anchor, patch))}`, `onRetryGraphic={(anchor) => void changeHighlightText(() => api.retryGraphic(folder, anchor))}`, `onEditGraphic={setEditingGraphic}` (state `editingGraphic: GraphicView | null`, the sheet in Task 16). Refresh the preview when a `graphics` event for this folder says `progress` (each carries the finished graphic's `hash`), `done` or `failed` (`api.onEvent` → bump `highlightsVersion`, throttled to at most once per 500 ms WITH a trailing call — the last event of a burst must always cause a refresh, or a burst of `failed` events leaves rows stuck on "rendering"; test a burst of three events within 50 ms giving one refresh at once and one after), so each poster appears as soon as it is made. The renderer sends nothing when nothing was queued, so this cannot loop.

- [ ] **Step 6: tests** in `EditScreen.test.tsx` next to the flair tests: with `FLAIR_ON.graphic = true` and a preview holding one graphic, the tab shows its summary and state; "ปิดอันนี้" calls `setGraphic(folder, anchor, { off: true })`; "ลบ" calls with null; a failed one shows "ลองเรนเดอร์ใหม่" which calls `retryGraphic`; `graphicsWaitForPack` shows the notice; a `graphics` `done` event re-fetches the preview. `fake-api.ts`: `flair.graphic: false` in the default settings, `graphics: []`, `graphicsWaitForPack: false` in the preview fixture, and `setGraphic`/`retryGraphic`/`cleanGraphicFiles` fakes.

- [ ] **Step 7: run** renderer tests — PASS. Commit.

---

## Task 16: the edit sheet and the speech-row mark (renderer)

**Files:** `apps/desktop/src/renderer/src/edit/GraphicSheet.tsx` (new), `apps/desktop/src/renderer/src/edit/SpeechTab.tsx`, `apps/desktop/src/renderer/src/screens/EditScreen.tsx`, `apps/desktop/src/renderer/src/screens/EditScreen.test.tsx`

**Changes from Task 15's review (add to this task):** the write must mention graphics. (a) The write confirm sheet's summary (`EditScreen.tsx`, the list built for the confirm sheet) gains a graphics count — the kept, not-off graphics of the preview, only while graphics are on and the level is not light. (b) The done toast (`WriteBar.tsx`) reports `graphicCount`, and when `graphicsSkipped > 0` says how many were left out because their render failed (new i18n keys, Thai, in the voice of the neighbouring toast strings). (c) `BeatSidebar.tsx` shows a graphics mark per beat like its other flair marks, counting graphics that play. Tests for each.

- [ ] **Step 1: the sheet**

```tsx
import { useState } from "react"
import type { CueAnchor, GraphicPatch, GraphicView } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Field } from "../ui/Field.tsx"
import { Sheet } from "../ui/Sheet.tsx"

/** The words, numbers and length of one graphic, changed by hand; the rest stays as Claude made it. */
export function GraphicSheet({ graphic, onClose, onSave }: { graphic: GraphicView | null; onClose: () => void; onSave: (anchor: CueAnchor, patch: GraphicPatch) => void }) {
  const [seconds, setSeconds] = useState(graphic?.spec.seconds ?? 3)
  const [pieces, setPieces] = useState<GraphicPatch["pieces"]>({})
  if (!graphic) return null
  const change = (index: number, field: string, value: string | number) => setPieces((was) => ({ ...was, [index]: { ...(was?.[index] ?? {}), [field]: value } }))
  const changeItem = (index: number, n: number, field: "text" | "value", value: string | number) =>
    setPieces((was) => {
      const piece = graphic.spec.pieces[index]!
      const items = was?.[index]?.items ?? piece.items!.map((item) => ({ text: item.text, value: item.value }))
      const next = items.map((item, i) => (i === n ? { ...item, [field]: value } : item))
      return { ...was, [index]: { ...(was?.[index] ?? {}), items: next } }
    })
  return (
    <Sheet
      open
      title={t("graphics.editTitle")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("backups.cancel")}</Button>
          <Button variant="primary" onClick={() => onSave(graphic.anchor, { seconds, pieces })}>{t("graphics.save")}</Button>
        </>
      }
    >
      <p className="hint">{graphic.summary}</p>
      <Field label={t("graphics.seconds")}>
        <input type="number" min={1.5} max={6} step={0.5} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} />
      </Field>
      {graphic.spec.pieces.map((piece, index) => (
        <fieldset key={index} className="graphic-piece">
          <legend>{piece.kind}</legend>
          {(piece.kind === "label" || piece.kind === "number") && (
            <Field label={t("graphics.pieceText")}>
              <input value={pieces?.[index]?.text ?? piece.text ?? ""} onChange={(event) => change(index, "text", event.target.value)} />
            </Field>
          )}
          {piece.kind === "number" && (
            <>
              <Field label={t("graphics.pieceFrom")}><input type="number" value={pieces?.[index]?.from ?? piece.from} onChange={(event) => change(index, "from", Number(event.target.value))} /></Field>
              <Field label={t("graphics.pieceTo")}><input type="number" value={pieces?.[index]?.to ?? piece.to} onChange={(event) => change(index, "to", Number(event.target.value))} /></Field>
              <Field label={t("graphics.pieceUnit")}><input value={pieces?.[index]?.unit ?? piece.unit ?? ""} onChange={(event) => change(index, "unit", event.target.value)} /></Field>
            </>
          )}
          {(piece.kind === "bars" || piece.kind === "checks") &&
            piece.items!.map((item, n) => (
              <Field key={n} label={t("graphics.pieceItem", { n: n + 1 })}>
                <input value={pieces?.[index]?.items?.[n]?.text ?? item.text} onChange={(event) => changeItem(index, n, "text", event.target.value)} />
                {piece.kind === "bars" && <input type="number" value={pieces?.[index]?.items?.[n]?.value ?? item.value} onChange={(event) => changeItem(index, n, "value", Number(event.target.value))} />}
              </Field>
            ))}
        </fieldset>
      ))}
      {graphic.edited && <p className="hint">{t("graphics.editedHint")}</p>}
    </Sheet>
  )
}
```

(A `Field` wraps one native control in a `<label>`; the bars row has two inputs — use `Group` for that row instead, per the renderer-layout rule.) Mount in `EditScreen`: `<GraphicSheet graphic={editingGraphic} onClose={() => setEditingGraphic(null)} onSave={(anchor, patch) => { setEditingGraphic(null); void changeHighlightText(() => api.setGraphic(folder, anchor, patch)) }} />` — keyed by `cueKey(editingGraphic.anchor)` so its state resets per graphic.

- [ ] **Step 2: the mark on speech rows** — `SpeechTabProps` gains `graphics?: GraphicView[]`; a `graphicOn(graphics, cut, row)` like `insertOn`; in `Row`: `{graphic && <span className="mark graphic">✦ {t("graphics.mark")}</span>}`. `EditScreen` passes `graphics={graphicsOn ? beatFlair.graphics : undefined}` with `const graphicsOn = flairOn && flair?.graphic === true && flair.level !== "light"`.

- [ ] **Step 3: tests** — the sheet opens from "แก้", changing the seconds and saving calls `setGraphic` with `{ seconds: 4, pieces: {} }`; a speech row with a graphic shows the mark.
- [ ] **Step 4: run** — PASS. Commit.

---

## Task 17: the files row in settings (renderer)

**Files:** `apps/desktop/src/renderer/src/screens/SettingsScreen.tsx`, `apps/desktop/src/renderer/src/screens/SettingsScreen.test.tsx`

- [ ] **Step 1:** in the general tab after the pack row:

```tsx
                  {view.graphicFiles.count > 0 && (
                    <RowCard>
                      <span className="row-label">
                        {t("settings.graphicFiles", { count: view.graphicFiles.count, size: formatBytes(view.graphicFiles.bytes) })}
                        <span className="hint">{t("settings.graphicFilesHint")}</span>
                        {cleaned !== null && <span className="hint">{t("settings.graphicFilesCleaned", { count: cleaned })}</span>}
                      </span>
                      <Button onClick={() => void run(async () => setCleaned(await api.cleanGraphicFiles()))}>{t("settings.graphicFilesClean")}</Button>
                    </RowCard>
                  )}
```

with `const [cleaned, setCleaned] = useState<{ trashed: number; blockedBy: … } | null>(null)`: show "ย้ายไปถังขยะ {count} ไฟล์" when not blocked; when `blockedBy.kind === "unreadable"` show "ไม่ได้ลบไฟล์: อ่าน draft “{name}” ไม่ได้ (อาจอยู่ในถังขยะของ CapCut) — เปิดใน CapCut หรือลบ draft นั้นแล้วลองใหม่" with the draft's folder name; for `no-drafts-root`, "ไม่ได้ลบไฟล์: หาโฟลเดอร์โปรเจกต์ของ CapCut ไม่เจอ". The API returns `{ trashed, blockedBy }` (update `DesktopApi.cleanGraphicFiles`).

- [ ] **Step 2: test** — with `graphicFiles: { count: 3, bytes: 40_000_000 }` the row shows and the button calls `cleanGraphicFiles`, then shows "ย้ายไปถังขยะ 2 ไฟล์" from the fake's `{ trashed: 2 }`.
- [ ] **Step 3: run** — PASS. Commit.

---

## Task 18: the real test on 0917

**Files:** none (scratchpad scripts only). CapCut must be closed; ask the user, never quit it from here.

- [ ] **Step 1: back up** `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/0917` to `<scratchpad>/0917-before-graphics` (`cp -Rp`) and `root_meta_info.json` to `<scratchpad>/root_meta_info-before-graphics.json`.
- [ ] **Step 2: install the pack** through the running dev app (`npm run dev`, settings → ทั่วไป → ตัวเรนเดอร์กราฟิก → ติดตั้ง) from the pack Task 3 built — serve it locally for the test by pointing `GRAPHICS_PACK.url` at a `python3 -m http.server` in the release folder, or at the GitHub release if it is already up. Watch the progress bar and the sha check.
- [ ] **Step 3: plan** on 0917 with flair on, medium, graphics on: "ให้ AI จัดลูกเล่น". Note in the spec's results what Claude proposed (sentences, kinds, why) and the dropped count. Expect 1–3 graphics for the 22 s clip.
- [ ] **Step 4: watch the render** in the flair tab: states move waiting → rendering → ready with posters; time it. Toggle one off and on; edit one number and see it re-render with a new hash.
- [ ] **Step 5: write** the timeline with graphics. Read `draft_info.json` back: the overlay track, `render_index` between the cutaway track and the text tracks, bin items in `draft_meta_info.json`. Ask the user to open 0917 in CapCut, look, and close it. Then confirm CapCut re-saved with the graphic materials intact (paths unchanged, no "สูญเสีย" marks).
- [ ] **Step 6: restore** 0917 from the backup with `cp -p` of differing files and the root entry, `diff -rq` identical; move the rendered files under `~/Movies/CapCut/BOXBLACK/graphics` to `~/.Trash/graphics-test-<time>`; remove the pack through the settings row (or leave it if the user wants to keep testing — ask).
- [ ] **Step 7: record** in the spec §18 "ผลที่ได้": what worked, what was changed on the way, render times, file sizes.

---

## Task 19: docs, version, DMG

**Files:** `docs/specs/2026-09-17-capcut-timeline-manager-design.md`, `docs/specs/2026-09-24-graphics-overlay-design.md`, `apps/desktop/package.json`, memory files

- [ ] **Step 1:** add to the main spec §6 an `M23 กราฟิกซ้อนภาพ (HyperFrames): <date> (0.2.0)` entry in the style of the M22 rounds (what the user chose, what was built, test counts, mutation results), and to §7 Open items: "ชุดเรนเดอร์กราฟิกอยู่บน GitHub Releases: อัปโหลดใหม่เมื่อเปลี่ยน HyperFrames/Chrome/Node" and "ชิ้นส่วนเพิ่ม (กราฟ เส้นเวลา) เมื่อผู้ใช้อยากได้".
- [ ] **Step 2:** bump `apps/desktop/package.json` to `0.2.0` (a feature, not a fix), `npm test`, `npm run typecheck`, `npm run dist`; verify the app.asar sha256 against the release build; ask the user to install the DMG and eject it after.
- [ ] **Step 3:** memory: `prodeck2-design-decisions.md` gets the graphics decisions (kit, pack, off by default, no auto-delete); `hyperframes-spike-facts.md` gets the `runAsNode` fuse finding and the pack layout; `MEMORY.md` index line updated.

---

## Self-review (done while writing)

- Spec coverage: §3 flow → Tasks 11–13; §4 kit → Task 9; §5 planning → Task 8 + 11; §6 data → Task 5 + 11; §7 render → Task 10; §8 pack → Tasks 3–4; §9 ffmpeg → Task 1 (+0); §10 write → Tasks 7 + 13; §11 UI → Tasks 15–17; §12 cost → hint text in Task 15; §13 errors → Tasks 4, 10, 13, 15; §14 tests → each task; §17 order → Task 0 first.
- Names used across tasks: `GraphicCue`/`GraphicSpec`/`PlacedGraphic`/`enforceGraphics` (5, 11, 12, 13); `renderBox`/`placeOnCanvas`/`dodgeKeepClear` (6, 10, 11); `graphicHtml`/`kitAssets`/`KIT_VERSION` (9, 10, 14); `createGraphicsPack` → `state/paths/install/cancel/remove` (4, 14); `createGraphicsRenderer` → `hashOf/ensure/wait/statusOf/failureOf/retry/posterOf/rendered` (10, 12, 13, 14); `graphicsInForce/graphicSentences/sceneFrameTimes/graphicJob/graphicViews/summaryOf` (11, 12); `GraphicView`/`GraphicPatch`/`GraphicRenderState`/`GraphicsPackState` (12, 15, 16, 4); `setGraphic/retryGraphic/cleanGraphicFiles/installGraphicsPack/cancelGraphicsPack/removeGraphicsPack` (4, 12, 15, 16, 17); `addGraphicTrack/graphicBinItem/addBinItems` (7, 13).
- Known judgement calls left to the implementer, each named where it occurs: the exact pixel numbers pinned in Task 6's first test; the bin item's per-file fields copied from a real 0917 entry (Task 7); how `textOn` is computed from `TimedGroup` lines (Task 11 Step 5); the off-graphics listing added to `graphicView` (Task 15 Step 4 → Task 12).
