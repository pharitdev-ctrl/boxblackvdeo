Base for all paths: `/Users/ford/Desktop/Thalent Ai/excp/prodeck2/apps/desktop/` (= `D/`). Core = `/Users/ford/Desktop/Thalent Ai/excp/prodeck2/packages/core/src/`. Nothing was edited.

Two corrections to your brief:
- The preview's graphics code is in `D/src/main/highlights.ts`, not `highlight-state.ts` (which only carries graphics through `regroupFlair`, :260, :332-350).
- The M25 backup mechanism lives in `D/src/main/project-files.ts`, not `post-cleanup.ts`.

## 1. `src/main/flair.ts`

**Planning call** — `planGraphics(folder, request, signal)` :378-445 (work 2c).
- Early exits: `!view.flair.graphic` → `{count:0,dropped:0}` (:380); no canvas → `skipped:"no-canvas"` (:384); no placed points (:386).
- Inputs built :387-399: `spokenSentences`, `placeStored`+`timeHighlights`, `looksInForce`, `textBands`, then `graphicPoints(...)`, `existingGraphics(...)`, `knownEmoji()` (:233-242), and a frames session.
- Core call :402-414: `planGraphics({transport, model, brief, points, canvas, captionsFromY, frames, existing, known, signal})`. Core signature at `Core/graphics/direct.ts:628-676` returns `{graphics: GraphicCue[]; dropped}`; one `transport.generate` with `schema: GraphicsReplySchema`, `maxTokens: 16_000`.
- Frames: `graphicFrames` :215-230, at most a dozen JPEGs via `framesWanted`; session disposed in `finally` (:416).

**Storage** — `amend` :422-435 (`outlines.update` on the latest outline):
- `mine` = `edited` graphics, always kept; a point one of them sits on is excluded from Claude's answer (:426-428).
- `waitingFor(asked, now)` keeps Claude's items on points not shown this time (:266-269); `answerOnBeats` + `onPointNow` drop answers for deleted points.
- Stored shape: `StoredOutline.flair.graphics?: GraphicCue[]` (`D/src/shared/api.ts:495`). `GraphicCue` = `{anchor: CueAnchor; spec: GraphicSpec; edited; off; pointId?}` (`Core/graphics/plan.ts:117-127`).
- After storing, renders start early: `deps.graphics.ensure((await deps.graphicJobs(...)).jobs, folder)` :437-443.

**`setGraphic`** :657-685.
- Emoji typed in the patch are checked against `deps.emoji()` (:660-673).
- Finds the cue by `samePlace(anchor)`; a patch goes through `changedGraphic` :108-119 (sets `edited: true`, `off = patch.off ?? graphic.off`, clamps seconds, sticker emoji/motion, or per-piece `changedPiece` :82-102).
- `null` removes it; if it was Claude's, its sounds go too.

**`retryGraphic`** :688-694: `deps.jobFor(folder, graphic)` → `deps.graphics.retry(deps.graphics.hashOf(job))`.

**Sounds** — `startMoment` :134, `heldMoments` :149-153, `withoutSoundsOn` :142-146: Claude's unedited sounds on a removed graphic's speech anchor and `pointId` go, unless another item still holds that moment. `planSounds` reads graphics at level `heavy` via `deps.graphicJobs(...).kept` (:489-495) into `soundSlotsFor`. `D/src/main/sound-cues.ts:168-171` is kit-specific: the slot label is `isSticker ? "สติกเกอร์ …" : "การ์ดกราฟิกขึ้น"`.

**Claude transport**
- `D/src/main/llm.ts:13` `chosenLlm(deps, task)` → `{transport, model}` (anthropic-api or CLI).
- `D/src/main/ai-calls.ts:15` `createAiCalls()`: `wrap()` (:22) adds a 10-minute timeout and `AbortSignal.any([stopped, timeout, request.signal])`. Errors: `"cancelled"` (`CANCELLED`, :7), `"timed out"`, or the caller signal's reason. `cancel()` :46, `signal()` :52.
- Wiring `D/src/main/index.ts:218-219` (`editingLlm`), :365 (flair's `llm`), :411 (`cancelAi`).
- There is no concurrency limiter anywhere: every call is sequential. N per-graphic calls will need their own pool.

## 2. `src/main/post-plan.ts`

- `POST_WORKS = ["emphasis","text","techniques","graphics","sounds","subtitles"]`, `RETHINK_WORKS` (`shared/api.ts:416-420`).
- `RETHOUGHT` :26: `{graphics: ["text","techniques","graphics"], sounds: ["sounds"], subtitles: ["subtitles"]}`.
- `begin()` :44-103: refuses a second run; own `AbortController` forwarded from `stopSignal`; `mark()` sends `{type:"post-plan", folder, work, state}`; `end()` sends `post-plan-finished`.
- `run.run` :69-87 maps a body's `Counted {count, dropped, skipped?}` to `done` / `skipped(off)` / `failed`; message `CANCELLED` sets `stopped`.
- `PostWorkState` (`api.ts:422-433`): waiting | running | done{count,dropped} | skipped{off|no-emphasis|stopped} | failed{error}. There is no per-item progress inside a work.
- `workTwo` :151-172: text (picked with `graphic:false` so no renders start, :164) → techniques → graphics (:169). `plannedOn(folder,"graphics",version)` only if every step that ran succeeded (:170).
- `rethink("graphics")` :231-244 runs `workTwo`; if any call ended done it sets `plannedOn.sounds = null` (sounds banner).
- `plan` :205-224.

## 3. `src/main/graphics-cues.ts`

`graphicsInForce(input)` :386-465 returns `{kept: PlacedGraphic[]; dropped: number; off: PlacedGraphic[]}`. `PlacedGraphic` = `{cue, atUs, durationUs, storedMotion?}`. Per stored cue:
1. `!flair.graphic` → empty (:404).
2. Level filter `input.passes(stored.pointId)` (:410); hidden ones are neither kept, off, nor dropped.
3. KIT: `upgradeSpec` for legacy icon names (:412).
4. KIT: an unedited label-only card is dropped (`cardAnchored`, :416-419).
5. `input.place(anchor, pointId)` (itemPlaceOf); null → dropped (:420-424).
6. Duration = `min(seconds, max(pieceEnd − at, GRAPHIC_MIN_US))` (:425-428). Generic.
7. Dodge: `never` = keep-clear bands + text bands, `dodgeBands(box, never, subtitles)` :289-295 (subtitles give way first; null = nowhere). Generic, box-based. KIT: crossing stickers skip the face bands (:432).
8. KIT sticker rules: tallest free band (:439-442), fly-up stretch (:446-449), `settledMotion` and `storedMotion` (:457-459).
9. No box and not off → dropped; off ones go to `off`.
10. `enforceGraphics(placed, durationUs)` (core) (:463).

Other exports:
- Generic: `textBands` :88, `textBandOn`, `textBandsIn`, `keepClearsIn` :151, `sentenceOf` :68, `graphicPoints` :193, `framesWanted` :227, `intoBand`.
- `existingGraphics` :250 uses `summaryOf`.
- `graphicJob` :474-484 builds the `RenderJob`; it shortens `spec.seconds` to the played length and adds font/palette.
- `graphicViews` :519-537 returns `GraphicView` minus `render`/`poster`/`error`.
- KIT-only: `summaryOf`, `KIND_NAMES`, `MOTION_NAMES` :486-512; `freeBands`, `stretchOf`, `tallestOf`, `MIN_STICKER_BAND`.

## 4. `src/main/graphics-render.ts`

**Shapes**
- `RenderJob` :16-23 `{spec, canvas, fps, font:{family,file}, palette}`.
- `RenderedGraphic` :26-33 `{hash, path, width, height, durationUs, place:{scale,x,y}}`.
- `hashOf` :202-212: sha256 of `[spec minus why/version, canvas, fps, font|null, palette|null, KIT_VERSION, EMOJI_SET.commit|null]`, first 16 hex.

**Public API** :426-493: `deps`, `hashOf`, `ensure(jobs, folder)` (fire and forget), `wait(jobs, folder)` → `{ready, failed}`, `idle()`, `statusOf(hash)`, `failureOf`, `retry(hash)`, `environmentProblem(jobs?)`, `machineReady()`, `forgetFailures()`, `cancel()` (generation++ and abort current), `posterOf(hash)` (data URL), `rendered(job)`.

**`render()`** :285-329
- `compose` = `workDir/compose/<hash>/` (`workDir` = `tmpdir()/boxblack-graphics`), wiped first.
- Writes `index.html` from `graphicHtml({spec, render: boxOf(job), canvas, fps, palette, font, assets, images})` (:306).
- Copies the font from `Resources/fonts` (:308) and each emoji PNG (:312-316).
- Runs HyperFrames (`runHyperframes` :220-266: `node hyperframes render <project> --format mov --fps N --workers 2 --quiet --frames-cache-dir off --player-ready-timeout 20000 -o …`; env HOME/TMPDIR under workDir, PATH = `renderBinDir`, `HYPERFRAMES_*`).
- Output to `graphicsDir/<hash>.mov` (rename, or copy across volumes), poster `<hash>.png` (ffmpeg, 270 px wide, mid-frame), then `<hash>.json` = `{width, height, durationUs, place: placeOnCanvas(box, canvas)}` written last and atomically. `made()` needs both json and mov.
- `boxOf` :214-218 uses `renderBox(spec.box, pointer targets, canvas)` (kit-specific targets).

**Queue** — one at a time through `chain` (:337); `inFlight` dedupes by generation+hash; events `graphics` started / progress / done / failed (:347, :365, :417, :421).

**Failures**
- Aborted by `cancel` → not a failure.
- `EmojiPicturesError` → `emojiProblem` (blocks only emoji-drawing jobs).
- `EnvironmentError` (:76; pack, ffmpeg, ffprobe, font) → `environment`, blocks everything.
- Anything else → `failures.set(hash, String(error))`, kept until `retry` or `forgetFailures`.
- `problemFor` :92.

**Timeouts** — `RENDER_TIMEOUT_MS = 120_000` (:62), `RENDER_STOP_GRACE_MS = 5_000`.

**Write wait** — `D/src/main/timeline.ts:409-435`:
- `deps.graphicJobs(...)` → `{kept, jobs}`.
- If `!graphicsReady()`, every job must already be `rendered`, else it throws (not installed, or unfit).
- `renderer.wait(jobs, folder)`; any job neither ready nor failed throws "the graphics were stopped before they were made; the draft was not changed".
- `waitedFor.push({graphic, job})`.

## 5. Files, pack, fonts, emoji

- `graphics-files.ts`: `graphicFilesInfo(dir)` :27; `cleanGraphicFiles` :163-213 trashes `<16hex>.mov` plus json/png that no draft JSON names (CapCut root and `<userData>/backups`). `SETTLING_MS` is 10 minutes; `busy()` blocks; result is `GraphicCleanResult`. Wired `index.ts:262-276` (`shell.trashItem`).
- `graphicsDir` = `~/Movies/CapCut/BOXBLACK/graphics` (`index.ts:230`). Pack dir = `<userData>/hyperframes` (:228).
- `graphics-pack.ts`: `createGraphicsPack` :69 — `state`, `paths` → `{root, node, hyperframes, chrome}`, `install`, `cancel`, `remove`. Spec in `D/src/shared/graphics-pack.ts:34-42` (version 2026-09-24, HyperFrames 0.8.65, 162,762,816 bytes).
- `highlight-assets.ts`: `fontPath` copies `Resources/fonts/*` to `~/Movies/CapCut/BOXBLACK/fonts` for CapCut; the renderer copies fonts straight from `Resources/fonts`. Files: `Kanit-ExtraBold.ttf`, `Mali-Bold.ttf`, `Chonburi-Regular.ttf`, `OFL.txt`.
- Emoji: `D/resources/graphics/emoji/` holds 1595 PNGs, `index.json` and `FLUENT-EMOJI-LICENSE` (55 MB).
  - Resolved at `index.ts:238-242`: `readEmojiSet(join(resourcesDir,"graphics","emoji"))`.
  - `EMOJI_SET` at `Core/graphics/emoji.ts:11`.
  - Kit files `resources/graphics/{kit.js,timeline.js,kit.css}` are read by `kitAssets` (`Core/graphics/kit/html.ts:24`; `index.ts:250`).
  - The only emoji notice is that licence file. `scripts/graphics-pack/third-party-notices.mts` covers the pack only.

## 6. Preview and API types

- `D/src/main/highlights.ts`: `graphicsOn` :254-279, `jobsOf` :282-287, `graphicView` :290-325, `graphicJobs` :328-334, `jobFor` :505-510. `graphicView` returns `{graphics, graphicsWaitForPack: !ready, graphicsProblem}`, calls `renderer.ensure(jobs, folder)` when ready, and fills `render`/`poster`/`error` per hash. `emphasisView` items at :238.
- `D/src/main/highlight-api.ts`: `checkedPiece` :104, `speechAnchor` :121, `checkedPatch` :127-146 (kit-shaped), handlers :230-235.
- `D/src/shared/api.ts`:
  - `GraphicView` :610-637 — anchor, atUs, durationUs, what, beatId, why, summary, `spec: GraphicSpec`, storedMotion?, render, poster, error, edited, pointId?, off.
  - `GraphicPatch` :640-649.
  - `GraphicRenderState` :381; `GraphicsProblem` :389 (`kind: "machine" | "emoji"`).
  - `HighlightPreview.graphics` / `graphicsWaitForPack` / `graphicsProblem` :710-719.
  - `graphics` events :462-465.
  - `setGraphic` / `retryGraphic` :243-245.
  - `WriteResult.graphicCount` :827, `dropped.graphics` :834, `graphicsSkipped` :838.
  - `EmphasisView.changed.graphics` :787.

## 7. `timeline.ts` write

:540-569. For each `waitedFor` entry, `deps.graphics.rendered(job)`; null → `graphicsSkipped++`. Otherwise it needs `file.path`, `width`, `height`, `durationUs`, `place`:
- `graphicBinItem(...)`; the bin id is reused via `binIdOf`.
- `TimelineGraphic` `{atUs: played(graphic.atUs), durationUs: graphic.durationUs, binId, path, name, width, height, durationOfFileUs, place}` → `addGraphicTrack` (`Core/capcut/graphics.ts:6-35`).
- Bin prune :579-585 (`pruneBinItems` within `graphicsDir`, only when there is at most one live timeline).

Nothing here is kit-specific.

## 8. One-time cleanup pattern

- `post-cleanup.ts:6` `POST_VERSION = 1`. `withoutOldEffects(stored)` :18-38 returns the same object when `postVersion !== undefined`; otherwise it keeps only `edited` cues/zooms/inserts/graphics (unbound, `offGoneLines`), keeps user groups, runs `regroupFlair`, and stamps `postVersion`.
- Wired `index.ts:161`: `new OutlineStore(join(userData,"outlines"), {upgrade: withoutOldEffects, backupDir: join(userData,"outlines-before-m25")})`.
- Mechanism in `project-files.ts`: `upgrade` / `backupDir` options :11-19; `keepOriginal` :64-72 (copy via `.part`, never overwrites an existing copy); `get` :92-98 writes back once; `update` :110-121 backs up before the first write and writes nothing if the copy fails.
- `planner.ts:78` stamps `postVersion` on new outlines.
- Only one `upgrade` and one `backupDir` are supported, and the backup is skipped if a copy already exists. A second migration therefore needs a composed upgrade with a new version value (the check is `!== undefined` today) and its own backup folder decision.
- `legacy-beats.ts`: `hasBeatless` / `withBeats` :15-44 lazily add `beatId` to anchors, graphics included (:41).

## 9. Tests (total / graphics-named, by grep of `test(`/`it(`)

| File (`src/main/` unless noted) | Total | Graphics-named |
|---|---|---|
| `graphics-cues.test.ts` | 40 | 21 |
| `graphics-render.test.ts` | 45 | 23 |
| `graphics-kit.test.ts` (jsdom, real kit files) | 46 | 10 |
| `graphics-files.test.ts` | 13 | 0 |
| `graphics-pack.test.ts` | 22 | 0 |
| `flair.test.ts` (`withGraphics` :885, `graphicAt` :869) | 58 | 10 |
| `flair-plan.test.ts` | 57 | 15 |
| `post-plan.test.ts` | 24 | 4 |
| `post-flow.test.ts` | 4 | 1 |
| `post-cleanup.test.ts` | 6 | 1 |
| `legacy-beats.test.ts` | 3 | 1 |
| `highlights.test.ts` | 73 | 20 |
| `highlight-api.test.ts` | 20 | 7 |
| `highlight-state.test.ts` | 34 | 2 |
| `timeline.test.ts` | 70 | 23 |
| `sound-cues.test.ts` | 27 | 2 |
| `planner.test.ts` | 25 | 2 |
| `settings-api.test.ts` | 20 | 8 |
| `bundled-ffmpeg.test.ts` | 9 | 1 |
| `scripts/release-check.test.ts` | 30 | 8 |
| `scripts/graphics-kit-check.test.ts` | 3 | 3 |
| `scripts/fetch-fluent-emoji.test.ts` | 8 | 2 |
| `scripts/third-party-notices.test.ts` | 25 | 0 |

Core also has `graphics/{direct,plan,emoji,framing}.test.ts` and `kit/html.test.ts`.

Fixtures:
- `src/main/timeline-fixture.ts` — `setup`, `CLIP_ID`, `s`, `transcript`, `fixturePoints` :179, `storePoints` :185. It holds no graphics itself.
- Three separate `fakeRenderer`s: `timeline.test.ts:636` (wait/rendered/made/gone), `highlights.test.ts:588` (statusOf/posterOf/failureOf/ensure), `post-flow.test.ts:60`. All share `problemFor`.
- The real renderer is tested with injected `run` / `poster` (`graphics-render.test.ts:77-114`).

## 10. Build and packaging

- `D/electron-builder.cjs:26-30`: `extraResources` fonts, bin, and `{from:"resources/graphics", to:"graphics"}` (the whole folder, emoji included).
- `D/scripts/graphics-kit-check.mjs` (326 lines): a dev tool, not in `npm test`. It builds the `CASES` through `graphicHtml`, serves them, loads them in the pack's Chrome, and reports font, emoji, timeline duration and fitted lines. Exports `serve` :228.
- `D/scripts/release-check.ts`: `releaseProblems` :77-89 (pack sha/bytes/url), `emojiProblems(dir)` :111-126 (index version vs `EMOJI_SET.commit`, count, missing PNGs, licence, leftover `emoji.partial`), called at :261; `publishedPackProblems` :166+.
- `D/scripts/fetch-fluent-emoji.mts` (184 lines): a dev tool that fetches into `resources/graphics/emoji` via `<dir>.partial`. Exports `pictures`, `fileNames`, `outFolders`, `mayReplace`, `retryDelay`, `mapAtMost`.
- `D/scripts/build-graphics-pack.sh` and `scripts/graphics-pack/` build the HyperFrames pack, which you are keeping.
- `apps/desktop/package.json` has no scripts; the root has `"test": "vitest run"`.

A notes folder already exists at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2/docs/plans/2026-09-30-freeform-motion-notes`.