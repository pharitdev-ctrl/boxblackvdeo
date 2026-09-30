# Text behind the person: design-facts brief

Conventions:
- Repo root is `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`.
- `main/`, `shared/` and `renderer/` mean `apps/desktop/src/…`. `core/` means `packages/core/src/`.
- `SP` is `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/cutout/`. `V` = `SP/vision/`, `E` = `SP/explore/`, `T` = the session transcript `/Users/ford/.claude/projects/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87.jsonl` (L = line).
- UNVERIFIED marks come from the reports. "(derived)" marks arithmetic I did on their numbers. "(synth check)" marks the one file I read myself: `V/render-person.sh`, read only.

## Headline facts
- **Proven on draft 0917 with no CapCut Pro.** The pipeline was:
  - Apple Vision `.accurate` person masks;
  - a guided filter (r=12, eps=1e-3) plus 1-2-3-2-1 temporal smoothing;
  - a ProRes 4444 overlay of the person, starting one source frame early;
  - a `flag 2` video track above the highlight text and below the subtitles;
  - the main piece's `clip` and zoom keyframes copied onto it.
- **Size can drop from about 60 MB/s to about 10 MB/s with the bundled ffmpeg.** Settings: ProRes 4444, `-qscale:v 12`, `-alpha_bits 8`, black RGB where alpha is 0. Writing the overlay only while the highlight text shows takes 0917 from about 1.33 GB to about 122 MB.
- **The Swift Vision helper is 80–97 KB.** It must be built with `-target arm64-apple-macos12.0`; a default build is `minos 27.0`.
- **Compute is about 1.7–2.1 s per second of overlay (derived, not measured end to end).** Only the Python mask step needs porting, and Swift + Accelerate does it in about 7 ms per frame.
- **Blocking unknowns** (see H): which rule sets layer order in CapCut, a contradiction on mask/frame pairing, and colour tags.

---

## A. How the write path would host a cutout overlay

### A1. Write order today (`main/timeline.ts` `writeNow`)
1. CapCut closed? (403)
2. Wait for graphics renders, before the draft is read (407-435).
3. CapCut closed again (437).
4. Load the draft and check `expectedSegments` (439-443).
5. `buildRoughCut` (446). `at(cut, src) = seg.target.start - seg.source.start + sourceUs` from the written main segments, after frame rounding (448-450).
6. Subtitles (460-469).
7. Highlight text (475-520).
8. `addZooms` (531-532).
9. `addInsertTrack` (536-537).
10. `addGraphicTrack` (540-569).
11. `addSoundTrack` (572-573).
12. Bin prune and add (579-580), `backupDraft` (581), `writeDraft` with the `bin` callback (582-585).

Every writer only appends to `tracks[]`. The only assignments are `rough-cut.ts:67`, `subtitles.ts:45`, `highlights.ts:229`, `overlays.ts:75` and `sounds.ts:181`. Nothing reorders the list.

A natural slot for the cutout is after step 8, because it needs the written main segments and their zoom keys, and before step 9, because cutaways must stay above it. The subtitle track has to end up after the cutout (see A3).

### A2. `tracks[]` a full write produces today

| # | Track | render_index | track_render_index |
|---|---|---|---|
| 0 | main video, flag 0 (`rough-cut.ts:67`) | 0 (`templates.ts:246`) | 0 |
| 1 | subtitles, text flag 1 | 14000, hard-coded (`subtitle-templates.ts:188`) | 1, hard-coded (`:197`) |
| next | highlight bars (sticker tracks) (`highlights.ts:199-209`) | 13000+base+i | base+i |
| next | highlight text, flag 0, one track per line index (`highlights.ts:210-221`) | 14000+trackIndex | trackIndex |
| next | cutaways, video flag 2 (`overlays.ts:74`) | 8+trackIndex (`inserts.ts:31`) | trackIndex |
| next | graphics, video flag 2 | 1000+trackIndex (`graphics.ts:22`) | trackIndex |
| last | sounds (`sounds.ts:180`) | 0 (`sounds.ts:135`) | tracks.length+lane (`:144`) |

0917 as it is now (read only): main, subs(1), sticker ×3 (13002-4), text ×3 (14005-7), graphics (1008), audio ×3. It has no cutout track.

### A3. Layer order and the subtitle front
- **Memory rule** (`capcut-draft-format-facts.md:41-43`): CapCut layers by `tracks[]` order, not `render_index`. A copy at the end of the list covered the subtitles although its render_index (13600) was below theirs (14000).
- **The code assumes render_index decides:** `graphics.ts:21`, `inserts.ts:30`, `overlays.ts:62`, `graphics.test.ts:219-220`, `timeline.test.ts:722-723`.
- **If the memory rule holds,** today's subtitles (index 1) draw under the highlight text, cutaways and graphics. UNVERIFIED visually.
- **Required constraints:**
  - cutout above the highlight text and bars that go behind (bars already sit below all text tracks);
  - cutout below the subtitles;
  - cutaways above the cutout, or the person would show on top of a full-frame cutaway;
  - graphics above the cutout, as in the spike.
- **Appending cannot do this.** Either splice the cutout track in or move the subtitle track later, then renumber every `track_render_index`.
  - `addOverlayTracks` only appends and computes `trackIndex = out.tracks.length + lane` (`overlays.ts:39, 63-64, 75`).
- **Spike order** (write-vision.mts:85-89, `V/vision-ids.json`): main 0; words 13500/1, 13501/2; person 1/3; subs 14000/4; stickers 13002/13003 (5,6); highlight text 14004/14005 (7,8); graphics 1006/9; audio 10,11. Every segment's `track_render_index` = its track's position. CapCut's re-save kept all of it (`vision-reopened.json`).

### A4. Timing and placement of a cutout segment
- **Proven shape** (write-vision.mts:60-81):
  - Material is `videoMaterial` + `has_audio:false` + a `graphicBinItem`.
  - Segment `source {start 0, duration = piece duration}`; `target` = the main piece's `target_timerange`, copied exactly.
  - `volume 0`; `clip` copied from the main piece; track `{type "video", flag 2}`.
  - The material is one frame longer than the segment (2,533,333 vs 2,500,000 µs).
  - The spike hard-coded 1080×1920, 30 fps and speed 1, and took no backup.
- **Alpha:** there is no alpha field. The template and the graphic materials have the same 68 keys, so CapCut detects alpha from the file. CapCut's re-save added only `is_video_copilot_aigc_content`.
- **One frame early.** The draft does not carry this; the file does.
  - Rule (memory `prodeck2-design-decisions.md:149`): overlay frame j (0-based) = the latest source frame with pts < source start + j/30.
  - Source frames sit 1.67–6.7 ms after the 1/30 grid (7.268333, 7.301667 … 26.606667, 26.64), because steps of 20 ticks at 1/600 are broken by four steps of 21.
  - The spike typed the early starts by hand (`render-person.sh piece2b 7.266667 2.5`, `piece6b 26.6 3.6`, `E/slice-bash.txt:143`).
  - Variable frame rate: UNVERIFIED.
- **The graphics framing path is not suitable.** `graphics.ts:42-56` rounds `played(atUs)` and trims by file frames. A cutout needs target = main target exactly, and a file one frame longer.
- **Partial ranges** (only while the text shows) were never tried. The frame rule for a start in mid-piece is UNVERIFIED.
- **Groups are not bounded by pieces.**
  - Group end = min(max(lastWord+200 ms, start+1.2 s, lastLineStart+1.0 s), next group start, timeline end) (`core/highlights/placement.ts:132-137, 153-170`).
  - A group's lines stay in one beat but can span cuts (placement.ts:114), and the end can run into later pieces.
  - So find the pieces a group covers by overlapping target time, not by `PlacedGroup` cuts. Each piece is a different source range and needs its own overlay segment and file (derived).
  - `TimedGroup` keeps only `groupId/startUs/endUs/lines` (placement.ts:139-145). The cut must be recovered through `placed` by groupId (timeline.ts:485).
- **Clocks.** The write uses `at` after frame rounding; the preview uses `timelineOf` before rounding (`main/highlight-state.ts:192-196`).
- **Groups never overlap in time** (end ≤ next group start). A cutout that covers only one group's window therefore hides only that group's text, even though text tracks are shared lanes.
- **Shared lanes.** Line n of every group goes on track n (`capcut/highlights.ts:148-231`). A cutout that spans a whole piece puts every highlight line and bar on screen in that window behind the person. There is no per-group lane.

### A5. Zoom copy (`core/capcut/zoom.ts:83-120`)
- **What is zoomed.** Only the first video track, one zoom per piece.
  - `time_offset = source_timerange.start + round(at × speed)`, in source time since 0.4.2 (68-71, 94).
  - Three lists: `KFTypeScaleX`, `KFTypePositionX`, `KFTypePositionY`. There is no ScaleY; `uniform_scale` is on.
  - Punch is 1→1.15 over 350 ms; drift is 1→1.08 over the piece.
- **Copy rule:**
  - give every list and every point a new id;
  - copy `clip`;
  - rebase each key: `t_overlay = (t_main − main.source.start) / main.speed × overlay.speed + overlay.source.start`. With speed 1 and an overlay starting at 0 this is `t_main − main.source.start`.
- **A verbatim copy is now wrong.** The spike copied the keys while they were still segment-relative (0/545000/895000), which happened to be correct then. `export/fix-keyframes.mts` later moved only the main pieces to source time.
- **Drift can overshoot.** `zoomsFor` (timeline.ts:307-325) uses the plan length before rounding. On 0917 piece 0 the last drift key is at 7,240,000 vs a source end of 7,233,333, so a rebased key can land past the overlay's end.
- **Speed.** Main speed is always 1 (templates.ts:228). Speed ≠ 1 is UNVERIFIED.

### A6. Result, counts and bin
- **WriteResult** (`shared/api.ts:809-841`): counts plus `dropped{sounds,zooms,inserts,graphics}`, `zoomsLost`, `graphicsSkipped`, `emphasisCount`, `proLeftOut`.
  - A cutout kind is needed in `dropped` and `LaidKind`, and in `DROPPED_NAMES`. That name list is typed over every key of `dropped` (`renderer/src/screens/WriteScreen.tsx:35`).
  - Flow: `lay()` (timeline.ts:523-528) → `tally()` (110-126).
- **Bin:**
  - `graphicBinItem` (bin.ts:12-34) with a lower-case UUID, added in the `bin` callback (write.ts:98, timeline.ts:584).
  - Prune only recognises `/Movies/CapCut/BOXBLACK/graphics/` (bin.ts:40-45, 84-93).
- **Files must live under `~/Movies`,** because CapCut is sandboxed (render-person.sh:5 comment, synth check).

---

## B. Render pipeline to mirror (graphics)

- **Entry points.** `renderer.ensure(jobs, folder)` runs in the background; `renderer.wait(jobs, folder)` blocks. Both go through `schedule`/`sortAndRender` (`main/graphics-render.ts:386-424`).
- **Triggers:**
  - every preview (`ClipRoom.tsx:410` → `highlights.preview` → `graphicView` → `ensure`, main/highlights.ts:305, 315);
  - after plan 2c (main/flair.ts:436-443);
  - at write (`timeline.ts:407-435`).
  - `graphicsReady` requires no pack change under way, `machineReady()`, the pack paths, and ffmpeg/ffprobe (index.ts:260-261).
- **Queue:**
  - one global serial promise `chain` across all projects (graphics-render.ts:173, 332-377), with asks ordered by `sorting` (175, 393-405);
  - `inFlight` key `${generation} ${hash}` (168, 334-336);
  - HyperFrames runs `--workers 2` (244);
  - `RENDER_TIMEOUT_MS = 120_000`, and a timeout counts as a failure (62, 318, 352);
  - jobs are skipped at run time on a prior failure, a blocked machine, a missing pack or a changed generation (340-343).
- **Cancel.** `cancel()` bumps `generation` and aborts only the current render: SIGTERM plus 5 s grace (475-478, 64, 246-247; core/media/process.ts:75-80). It is called only on `before-quit` and pack changes (index.ts:436-446, 280-290). There is no per-job or per-folder cancel.
- **Retry.** `api.retryGraphic` → `flair.retryGraphic` rebuilds the job under saved settings (flair.ts:687-694) → `renderer.retry(hash)` deletes the failure (447-449) → the UI bumps the preview, which calls `ensure` again (ClipRoom.tsx:680-697).
  - Failures live in memory only (160) and are cleared by `forgetFailures()` on a tools rescan or a pack change.
- **Events.** AppEvent `"graphics"`: started / failed / progress (done/total per ask) / done (shared/api.ts:461-465).
  - The renderer ignores the payload and re-reads the preview at most every 500 ms (ClipRoom.tsx:151, 431-455).
  - `statusOf` returns ready / failed / rendering / waiting (440-445).
  - HyperFrames runs `--quiet`, so there is no progress inside a render.
- **Storage:**
  - `graphicsDir = ~/Movies/CapCut/BOXBLACK/graphics` (index.ts:229-230) holds `<hash>.mov/.png/.json` (graphics-render.ts:180).
  - Scratch is `tmpdir()/boxblack-graphics`; the compose folder is removed before and after each render.
  - The finished file is renamed into place, or copied across volumes (321).
- **Hash:** sha256 over the spec (minus why/version), canvas, fps, font, palette, KIT_VERSION and the emoji commit; the first 16 hex characters. `HASH=/^[0-9a-f]{16}$/` (202-212, 67).
- **Reuse:** `made(hash)` = the `.json` parses and the `.mov` stats. The `.json` is written last and atomically, as the commit marker (191-200, 323-325). Made jobs are answered as ready without queueing (398-402).
- **Cleanup.** Manual only: Settings button → `cleanGraphicFiles` (graphics-files.ts:163-213).
  - "In use" = any `[0-9a-f]{16}\.mov` in the draft JSONs, across all drafts including `.recycle_bin` and `<userData>/backups`.
  - One unreadable draft blocks the whole clean.
  - It refuses while busy (renderer not idle, a write under way, `writesStarted` changed) and keeps files younger than 10 min.
  - Files go to Trash in the order .json, .mov, .png. Only `^[0-9a-f]{16}\.mov$` names are touched (graphics-files.ts:10).
- **Bin prune on write.** Only when the draft has at most one live timeline (timeline.ts:575-585), and only for `isRenderedGraphic`. The same predicate keeps rendered files out of the footage list (projects.ts:74-77) and out of spare cutaway media (core/flair/media.ts:51-52).
  - A cutout folder elsewhere would show as footage, never be pruned and never be cleaned (derived from the code).
- **Write readiness:**
  - `canWrite` ignores renders (WriteScreen.tsx:85-86), and the check row says the write will wait.
  - Main waits and throws when the renderer is missing, not ready, or a job is unsettled ("draft was not changed", timeline.ts:424-432).
  - Failed renders are skipped and counted in `graphicsSkipped` (543-550).
  - CapCut is checked before and after the wait. There is one write per draft (`alone`, 383-393), and a `timeline-write` event is sent.
- **Persistence.** No render state is saved. `GraphicCue` (graphics/plan.ts:117-127) holds no hash or path. On disk, graphics are 69 files, 190 MB; one sample is 512×958, 3 s, 12.75 MB (~4.25 MB/s), rendered at box size.
- **Facts that differ for a cutout job:**
  - Its input is a source video plus a range, not a spec.
  - Its cost scales with seconds, about 1.7–2.1 s of compute per second of overlay (derived). The flat 120 s timeout covers only about 55–70 s of overlay (derived).
  - Its files run about 10 MB/s.
  - Existing frame tools don't fit. `extractFrames` does one seek per frame and writes JPEG at most 384 px (core/vision/frames.ts:13-69). `runProcess` stdin is string only (process.ts:27-97).
  - The bundled ffmpeg has rawvideo and image2pipe demuxers but no rawvideo or image2pipe muxer, so raw frames cannot be piped out. Intermediate image files are needed, or the helper decodes the video itself.

---

## C. Bundling the Swift Vision helper

- **Packaging exists.** electron-builder config is at `apps/desktop/electron-builder.cjs`.
  - `resources/bin` → `Resources/bin` (:28), outside the asar (:31).
  - arm64 only (:43-47), `minimumSystemVersion "12.0"` (:50). That meets Vision's macOS 12 requirement, so no runtime OS gate is needed.
  - electron-builder re-signs files in `bin` ad-hoc, as seen with ffmpeg and whisper-cli. No builder change is needed.
- **Signing:**
  - ad-hoc `"-"` without CSC (:11, :52);
  - hardenedRuntime only with a Developer ID (:53);
  - entitlements = allow-jit and allow-unsigned-executable-memory, no sandbox;
  - notarization only with a team ID (:56).
- **Quarantine** (spec `docs/specs/2026-09-17-capcut-timeline-manager-design.md:355-358`):
  - one Open Anyway flips every file in the bundle from `0081` to `00c1`; the bundled ffmpeg then runs.
  - For a Swift helper this is UNVERIFIED.
  - It does not cover files copied to userData.
- **Toolchain:**
  - Swift 6.4, SDK 27.0, full Xcode 27.
  - A default `swiftc` gives `minos 27.0` and would not run on macOS 12–26.
  - `swiftc -O -target arm64-apple-macos12.0` → 97,104 bytes, `minos 12.0`, system libraries only. `strip -x` → 80,464 bytes, still validly signed.
  - Command Line Tools alone: UNVERIFIED.
- **Measured:**
  - `.accurate` takes 35.9 ms per frame on small inputs and 43.4 ms at 1080×1920; the first frame is 88–125 ms (904 ms cold).
  - The mask is fixed at 1512×2016 (3:4 portrait) whatever the input: balanced 384×512, fast 192×256. It must be scaled back to the source size.
  - With no arguments the helper exits 2 and prints usage to stdout.
- **Dev resolver gap.** `index.ts:119` uses `process.resourcesPath/bin`, which has no `bin` folder in dev. Dev ffmpeg and whisper come from Homebrew. A helper with no Homebrew copy must resolve through `resourcesDir` (index.ts:233), or dev never finds it.
- **Steps** (proposal, from the bundling report):
  1. Source, for example `apps/desktop/native/segment/main.swift`: `--version` prints `boxblack-segment <VERSION>`; usage and errors go to stderr.
  2. `scripts/build-segment.sh <out>`, modelled on build-whisper.sh: `VERSION=`, `MACOS_MIN=12.0`, `xcrun swiftc -O -target arm64-apple-macos$MACOS_MIN`, `strip -x`, a `--version` smoke test. No licence file is needed.
  3. release-check:
     - `releaseProblems()` (release-check.ts:26-92) requires the helper and its pinned version;
     - add it to `runReleaseCheck` and the success message (:270);
     - update the exact-string test (release-check.test.ts:334);
     - add a VERSION-equality test (like :145/:177);
     - add `bundled-segment.test.ts` (otool system-only, `minos 12.0`, arm64, like bundled-whisper.test.ts:28-33).
  4. Resolver. Either add the helper to `ToolPaths`/`scan()` (main/tools.ts:4-9, 29) and to `ToolReport`/`inspectTools` (core/media/tool-check.ts:35-42, 58-91), or resolve it only from `join(resourcesDir,"bin")`. A new required ToolReport field breaks the fixtures at SettingsScreen.test.tsx:648, 656.
  5. A Settings `ToolRow` in ToolsCard.tsx (after :79), kept out of `anyMissing` and the Homebrew hint (:29, :87). i18n near :572-586; update `tools.hint` (:573).
  6. Optional readiness problem, like analysis.ts:122-124.
- **Also UNVERIFIED:**
  - whether masks are the same on macOS 12–26, where the 1512×2016 size may differ;
  - hardened runtime and notarization;
  - TCC prompts if the helper reads source videos directly.

---

## D. The proven pipeline, exactly, and what must leave Python

- **Source:** `/Users/ford/Downloads/IMG_9646.MOV`.
  - H.264 1080×1920 yuv420p, tv range, bt709; timebase 1/600; 933 frames; no rotation.
  - Streams: 0 h264, 1 aac, 2 apac (no decoder), 3–7 mebx.
- **The two pieces:**
  - piece 2 = segments[1]: source 7,300,000 µs, 2.5 s, target 5,433,333;
  - piece 6 = segments[5]: source 26,633,333, 3.6 s, target 18,366,666, 3 zoom keys.

1. **Frames** (`V/render-person.sh:15,17`):
   - `ffmpeg -ss S -t <sec+1/30> -i SRC -an -fps_mode passthrough -q:v 2 -start_number 1 frames/%04d.jpg`, with S = source start − 1/30.
   - This gives 76 and 109 frames (one extra at the end), about 185 KB each, in 0.21 s per 76 frames.
2. **Vision** (`V/segment.swift:17-33`):
   - `VNGeneratePersonSegmentationRequest`, `.accurate`, `OneComponent8`;
   - one `VNImageRequestHandler(url:)` per JPG, orientation `.up`;
   - L8 PNG at 1512×2016.
   - The sequence handler gave the same masks and no temporal gain.
   - The output is deterministic.
   - Rotated or landscape input: UNVERIFIED.
   - Known flaw: part of the chair is included.
3. **Mask filter** (`V/final-masks.py:13-36`), the only Python step:
   - guide = frame luma scaled bicubic to 1080×1920 /255;
   - mask scaled bicubic to 1080×1920 /255;
   - He guided filter, r=12 (25×25 `uniform_filter`, reflect), eps=1e-3 not squared, clip 0–1;
   - temporal weights 1-2-3-2-1 /9, index clamped at the piece ends, no outside context;
   - uint8 grey PNG.
   - It reproduces byte for byte. It takes about 12.6 s per 76 frames, mostly ffmpeg subprocesses.
4. **Encode** (render-person.sh:21-23; the final "c" command is at T L56255):
   ```
   ffmpeg -ss S -t sec+1/30 -i SRC -framerate 30 -start_number 1 -i final/%04d.png -filter_complex "[0:v]setpts=N/30/TB,format=rgba[src];[1:v]format=gray[m];[src][m]alphamerge,format=yuva444p12le[out]" -map "[out]" -frames:v N -r 30 -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p12le -vendor apl0
   ```
   - Colour comes from the source decoded directly; frames are paired with masks by number.
   - The output is 30 fps, `ap4h`, video only, with RGB kept under alpha 0.
   - The spike used Homebrew ffmpeg (render-person.sh:9).
5. **Draft:** as in A4. The words were CapCut highlight text (bold-white, Kanit ExtraBold) spanning the whole piece.

- **Measured quality:**
  - Vision's edge reverses about 3× as often as CapCut Pro's: 0.43 vs 0.15 ‰ per frame.
  - After the filter, export reversals fell from 2.83 to 1.42 ‰ (piece 2) and from 3.29 to 1.15 ‰ (piece 6).
  - User verdict: "a little left, but OK".
- **The whole spike pipeline** costs about 7–8 s per second of video.
- **Port, recommended: Swift + Accelerate in the helper** (prototype `E/guided.swift`):
  - `vImageSepConvolve_PlanarF` with `kvImageEdgeExtend`, plus vDSP;
  - guided filter 6.0 ms per frame, temporal 1.1 ms per frame;
  - at most 7 levels off from Python, mean 0.024 (inside a 40 px border);
  - decode (19.8 ms) and PNG write (12.3 ms) disappear if the helper keeps Vision's buffers in memory.
- **Alternatives:**
  - The ffmpeg-only graph (bundled 8.1.2) matches Python within 2 levels:
    ```
    [0:v]format=gray16le[g];[1:v]scale=1080:1920:flags=bicubic,format=gray16le,lut=y='16384+val/2'[m];[g][m]guided=radius=12:eps=0.001:guidance=on,lut=y='clip((val-16384)*2,0,65535)',tpad=start=2:start_mode=clone:stop=2:stop_mode=clone,tmix=frames=5:weights='1 2 3 2 1',trim=start_frame=4,setpts=PTS-STARTPTS,format=gray[o]
    ```
    - ffmpeg's `guided` does not clip (values wrap around) and uses eps as given. That is why the mask is squeezed into 16384–49151.
    - It is slow: 26.4 s wall per 76 frames. `mode=fast:sub=2` takes 2.6 s (visual quality UNVERIFIED).
  - Core Image `CIGuidedFilter`: parity with He's r and eps is UNVERIFIED.
- **Pitfalls to carry over:**
  - `-map 0:a?` picks the apac stream. The overlay avoids audio altogether (`-an`, `has_audio:false`, volume 0).
  - No `drawtext` in either ffmpeg. This does not matter for the product, because the words are CapCut text.
  - `setpts=N/30/TB` pairing on a 29.97 fps source would drift about one frame per 33 s: UNVERIFIED.

---

## E. Size measurements and recommended encoding

Spike re-encode of piece 2c with the bundled ffmpeg (spike report):

| Option | Size | Rate |
|---|---|---|
| spike settings | 157.5 MB | 62.2 MB/s |
| `-alpha_bits 8` | 146.6 MB | 57.9 MB/s |
| black RGB where alpha is 0 | 118.7 MB | 46.8 MB/s |
| same, 10-bit | 115.9 MB | 45.7 MB/s |

Size report. Masters: source frame plus final mask, 8-bit lossless. ProRes was made with the bundled ffmpeg; HEVC and the metrics with Homebrew.

| Option | MB/s (2b / 6b) | % of (a) | alpha diff | alpha p99.9 | RGB PSNR | edge over white avg / p99.9 |
|---|---|---|---|---|---|---|
| (a) spike settings | 59.8 / 60.5 | 100 | 0 | 0 | 55.8 | 0.29 / 1.4 |
| (b) alpha 8-bit | 55.6 / 54.5 | 93 | 0.19 | 0.5 | 55.8 | 0.31 / 1.8 |
| (b) q4, a8 | 21.6 | 36 | 0.19 | 0.5 | 50.5 | 0.44 / 3.4 |
| (b) q8, a8 | 13.5 / 14.1 | 22.5 | 0.19 | 0.5 | 47.1 | 0.65 / 5.2 |
| (b) q8, alpha 16-bit | 17.7 | 29.6 | 0 | 0 | 47.1 | 0.64 / 5.1 |
| (b) q12, a8 | 10.5 / 11.3 | 17.6 | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (b) q16 / q24, a8 | 9.0 / 7.3 | 15 / 12 | 0.19 | 0.5 | 43.7 / 41.6 | 1.03 / 8.5, 1.37 / 11.6 |
| (c) crop only | 54.4 / 55.0 | 91 | 0 | 0 | 55.8 | = (a) |
| (d) black outside | 45.6 | 76 | 0 | 0 | 55.8 | = (a) |
| (d) black, q8, a8 | 11.9 / 12.3 | 19.9 | 0.19 | 0.5 | 47.1 | 0.65 / 5.2 |
| **(d) black, q12, a8** | **9.75 / 10.35** | **16.3** | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (c+d) crop, black, q12, a8 | 9.59 / 10.20 | 16.0 | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (d) flat mean colour, q12 | 9.47 / 10.08 | 15.8 | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (f) 720×1280, black, q8 | 6.4 / 6.7 | 10.8 | 3.9 | 37 | 41.1 | 3.8 / 46 |
| (f) 540×960, black, q8 | 4.1 | 6.9 | 6.0 | 50 | 38.7 | 5.7 / 61 |
| (e) HEVC, black, q65 | 2.4 / 3.1 | 4.0 | 1.09 | 2.0 | 38.5 | 2.06 / 17.5 |
| (e) HEVC, black, q80 | 3.8 / 4.6 | 6.4 | 1.09 | 2.0 | 42.0 | 1.13 / 9.6 |
| (e) HEVC, black, q90 | 6.9 / 7.4 | 11.5 | 1.09 | 2.0 | 45.5 | 0.72 / 6.4 |
| (e) HEVC q65, alpha quality 0.75 | 1.0 | 1.7 | 2.4 | 10.5 | 38.5 | 2.45 / 19.4 |
| PNG-in-MOV, lossless | 42.4 | 71 | ≈0 | 0.25 | 57.4 | 0.24 / 0.8 |

- **Reference:** x264 CRF 18 gives 38.5 dB inside the mask; 12 Mbps gives 38.0 dB. Whether CapCut's export behaves like this is UNVERIFIED.
- **Visual check:** frame 41 at 4× over white and yellow. The master, q12, q16 and HEVC q80 look the same; 720p is visibly softer (rejected).
- **Crop:** the person's box spans x 0–1080, y 332/333–1920. After black fill a crop saves only about 1.3%, and it would need position keys rewritten (main position + main scale × (0, −0.16667); UNVERIFIED in CapCut). Skip it for talking-head shots.
- **HEVC:** black fill and crop do nothing for it. The bundled ffmpeg cannot make it (`--disable-autodetect`, no VideoToolbox, build-ffmpeg.sh:37-40). CapCut playback is UNVERIFIED.
- **Coverage on 0917:** 5 groups (2.7, 2.73, 2.13, 2.83, 1.47 s). Per-piece coverage is 43/17/67/67/93/41%, so writing only those ranges covers 12.1 s of 22.17 s (54.6%, with a one-frame lead per range).
- **Encode speed:** ProRes q8–12 takes 0.15–0.35 s for 76–109 frames; HEVC about 1 s.
- **Recommended:** ProRes 4444 via the bundled `prores_ks`:
  - RGB set to black (or a flat colour) where alpha is 0;
  - `-alpha_bits 8`;
  - `-qscale:v 12`, or 8 for margin;
  - `scale=out_color_matrix=bt709:out_range=tv` with BT.709 tags;
  - only the highlight-text ranges, each one source frame early.
  - Result: 9.75–10.35 MB/s; 0917 ≈ 12.1 s × 10 MB/s ≈ 122 MB instead of about 1.33 GB.
- **Input format:** `prores_ks` accepts only yuv422p10le, yuv444p10le and yuva444p10le, so request `yuva444p10le` explicitly.

---

## F. Where the UI option lives, and text position

- **Flag location, recommended: optional `behind?: boolean` on `GroupLook`** (core/flair/plan.ts:18-29).
  - Looks are stored per group id in `StoredOutline.flair.looks` (shared/api.ts:495).
  - It survives `regroupFlair`, `withoutLine` and `withLineText`, which spread the look (highlight-state.ts:346, 230, 246), and the plain `JSON.parse` of the outline (project-files.ts:77).
  - Not on the group: re-picking replaces Claude's groups (highlights.ts:556-571).
  - Not on the point: a point serves text, zoom, cutaway, graphic and sound.
- **Sites that drop a new look field today:**
  - `enforce` non-edited branch (plan.ts:75);
  - `setLook`, rebuilt field by field (flair.ts:717-723), which needs `patch.behind ?? look.behind`;
  - `acceptHighlights` (pick.ts:271-277);
  - IPC validation (highlight-api.ts:253-265) and `FlairLookPatch` (api.ts:652-664).
  - LookPopover's `change()` (LookPopover.tsx:32) is fine if `setLook` falls back to the stored value.
- **Side effects:**
  - `looksInForce` returns `DEFAULT_LOOK` when `flair.text` is off (highlight-state.ts:390), so "behind" would be off in force unless the write reads the stored flag.
  - The ⚙︎ look button shows only while `flair.text` is on (HighlightTab.tsx:63-70).
  - A hand-set look is `edited`: the group becomes the user's (emphasis.ts:47-49) and is exempt from the pattern and tone run rules (plan.ts:67, 70).
- **Patterns to reuse:**
  - global switch keeps stored values (highlight-state.ts:390; highlights.ts:302; timeline.ts:410);
  - per-item `off` (GraphicCue.off, graphics/plan.ts:123-124);
  - "held" for a missing capability (`heldExits` highlight-state.ts:401-417 → `heldExit` api.ts:548-549 → `proLeftOut` WriteScreen.tsx:157-159). A held "behind" fits this last one.
- **Adding a global switch:**
  1. `FlairOptions` and its default (core/flair/catalogue.ts:8-24).
  2. The sanitiser (settings.ts:123-131). `read()` rebuilds every field, so a missing field is dropped.
  3. Both IPC checks: highlight-api.ts:77-85 and timeline-api.ts:41-58.
  4. A `Switch` in GraphicsTab (GraphicsTab.tsx:33-46) via `room.changeFlair` (ClipRoom.tsx:635-657). Any flair change re-runs the preview (`flairKey`, ClipRoom.tsx:388-390).
  5. i18n `flair.x` / `flair.xHint` (i18n.ts:447-461).
- **Claude choosing behind groups:**
  - One call already returns the look per group (`HighlightReplySchema`, pick.ts:66-86).
  - It sees no picture facts for speech points: no scene kind, no `keepClear`, no frames (pick.ts:298-329, 354). The precedent for adding them is graphics/direct.ts:55-56, 155, 559.
  - The prompt version (pick.ts:15) is informational; bumping it invalidates nothing, but it is pinned in pick.test.ts:282-283.
  - Follow `tone`'s `.default()` + `??` pattern (pick.ts:77, 273-274).
- **Text position today works against the effect:**
  - Auto placement merges the scenes' `keepClear` bands (faces, shown products, on-screen text; the body is explicitly excluded; Claude's estimate from sampled frames; vision/describe.ts:67) into one full-width vertical band (highlight-state.ts:147-155).
  - `anchorFor` (layout.ts:81-119) tries above, then below, then shrinks to 0.6, then covers as little as possible. With no picture it falls back to the top. The floor is −0.52 while subtitles are on.
  - Fixed positions: top edge at y=0.72, middle centred at 0.1, bottom edge at −0.52.
  - So auto dodges the head and puts "below" text on the torso, where the person would hide most of it.
  - `keepClear` is too coarse to measure hidden text; the per-frame mask would be needed.
  - Graphics keep off the text bands (highlights.ts:264-273), so a behind group still reserves its band.
  - 0917's text sits at y 0.14–0.83. Which groups showed the behind effect in the spike's layout is UNVERIFIED.
- **Write page:**
  - The summary row pattern is at WriteScreen.tsx:136-161.
  - The `Check` component has states ok, wait, fail, warn and going (:22-53).
  - The graphics render row (:189-195) is the model: a progress bar, "going" without blocking, and a warn row for failures.
  - Result rows are at :219-246.
  - Disk space (about 10 MB/s even after the fix) fits a "warn" check. Cleanup would parallel `GraphicFilesRow` (SettingsScreen.tsx:202-237).

---

## G. Questions for the user (recommended option marked ★)

1. **Who picks which groups go behind?**
   - (a) The user, per group in the look popover. ★ for v1: Claude has no picture facts for speech points today.
   - (b) Claude proposes in the highlight pick and the user overrides. Phase 2; needs scene kind and `keepClear` passed as in graphics/direct.ts.
   - (c) Automatic for every group over a talking-head scene.
   - (d) All or nothing, by a global switch only.
2. **Where does the flag live?** (a) ★ `GroupLook.behind`. (b) `HighlightGroup`, which re-picks lose. (c) `EmphasisPoint`, which is not text-specific.
3. **How does it relate to `flair.text`?**
   - (a) ★ Its own `FlairOptions` switch. The write reads the stored flag even when `flair.text` is off, and the UI entry must not depend on the ⚙︎ button.
   - (b) It rides under `flair.text`, so it is off in force whenever text looks are off.
4. **How much does the overlay cover?**
   - (a) The whole main piece(s) under a behind group. Proven, but every other group in those pieces also goes behind.
   - (b) ★ Only the behind group's own window, split per main piece. Saves about 45% on 0917, but a mid-piece start is UNVERIFIED and needs a CapCut test; fall back to (a) if it fails.
   - (c) Every highlight-text window.
5. **Which encoding?**
   - (a) ★ ProRes 4444, q12, alpha 8-bit, black outside, BT.709: about 10 MB/s.
   - (b) The same at q8: about 12 MB/s, more margin.
   - (c) Spike settings: about 60 MB/s.
   - (d) HEVC with alpha via AVAssetWriter in the helper: about 4–7 MB/s, CapCut playback UNVERIFIED.
6. **Where does the mask pipeline run?**
   - (a) ★ Everything in the Swift helper: Vision, guided filter and temporal smoothing via Accelerate. ffmpeg extracts the frames and encodes, as in the spike.
   - (b) Vision in Swift, filtering by the ffmpeg `guided`/`tmix` graph. Slow, or fast mode with unverified quality.
   - (c) The helper decodes the source itself with AVFoundation. TCC and rotation are UNVERIFIED.
7. **Where do subtitles sit in `tracks[]`?** First verify the layer rule (H1).
   - (a) ★ Last among the visual tracks, above cutaways and graphics. This matches the render_index 14000 intent and fixes the latent "subtitles under everything".
   - (b) Just above the cutout, below cutaways and graphics.
   - (c) Reorder only when a cutout exists.
8. **Where are files stored?**
   - (a) Reuse `graphicsDir` with 16-hex names. Prune, cleanup and the footage filter work unchanged, but graphics and cutout sizes mix.
   - (b) ★ A sibling folder under `~/Movies/CapCut/BOXBLACK/` (name to choose), with one shared "rendered by BOXBLACK" predicate. That means widening bin.ts:40-45, projects.ts:74-77, media.ts:51-52 and graphics-files.ts:10, and adding a separate size row in Settings.
9. **Which queue?**
   - (a) Share the graphics `chain`. A cutout would block graphics previews, and the flat 120 s timeout applies.
   - (b) ★ Its own serial queue, with a timeout that scales with seconds.
10. **When does rendering start?**
    - (a) ★ In the background when a group is marked behind (like `ensure`), with the write waiting.
    - (b) Only at write.
    - (c) An explicit "prepare" button.
11. **What happens with no person, a failed render or a missing helper?**
    - (a) ★ Hold the flag and write the text in front as usual; count it in the result and preview (like `heldExit` and `graphicsSkipped`).
    - (b) Fail the write.
12. **How are behind groups placed?**
    - (a) Keep current auto placement: text ends up on the torso and mostly hidden.
    - (b) New mask-driven placement: the mask must exist before the layout is final.
    - (c) ★ For v1, a user-chosen band (top or middle) plus a warning after render when the mask hides too much of a line. (b) later.
13. **Crop the overlay to the person?** (a) ★ No; saves about 1.3% after black fill. (b) Yes, with position-key rewriting (UNVERIFIED).
14. **Which sources are supported?**
    - (a) ★ Map frames by the actual source pts (the frame rule is pts-based). Hold rotated or landscape sources until tested.
    - (b) Restrict to about 30 fps unrotated portrait sources.
15. **Warn about disk space before a write?** (a) ★ Yes, a warn check with an estimated MB figure. (b) No.

**Must verify, not user decisions:**
- the layer-order rule;
- mask/picture pairing (H2);
- a mid-piece overlay start;
- how CapCut reads colour tags and 10-bit alpha;
- rotated and VFR/29.97 sources;
- the helper on macOS 12–26, under Open Anyway, and under hardened runtime;
- main speed ≠ 1;
- HEVC alpha in CapCut;
- `CIGuidedFilter` parity.

---

## H. Where the reports conflict or are stale

1. **Layer order.** The memory rule (`tracks[]` order wins) contradicts code comments and tests that assume render_index (graphics.ts:21, inserts.ts:30, overlays.ts:62, graphics.test.ts:219-220, timeline.test.ts:722-723). If the memory rule is right, today's subtitles draw under highlight text, cutaways and graphics (UNVERIFIED).
2. **Mask/picture pairing.**
   - Spike report: re-checked today with the bundled ffmpeg, overlay frame 0 = source 7.268333 = JPEG #1, so pairing is correct.
   - Size report: the spike's masks lag the picture by one frame (JPEG #k best matches overlay frame k−1). It marks any link to the "start one frame early" fix as UNVERIFIED.
   - (synth check) `render-person.sh:17` and `:21-23` feed the same `-ss $start -t $span` into both passes and pair frames by number, which on its face supports correct pairing.
   - Unresolved. If the size report is right, the one-frame-early fix may be compensating for mask lag rather than for CapCut's frame picking. Resolve this before porting the frame rule.
3. **Colour tags.** The spike report says the output was tagged bt709/tv. The size report says the spike's settings write untagged ProRes converted with BT.601 (decoded as 601: 60.8 dB; as 709: 43.9 dB). How CapCut reads an untagged file is UNVERIFIED. It is moot if the product converts and tags BT.709 explicitly.
4. **12-bit alpha.**
   - The spike asked for `yuva444p12le`. The size report states that `prores_ks` accepts only 10-bit and converts the request; overlay-pipeline marks that silent conversion UNVERIFIED.
   - The decoder reports 12-bit regardless (bundled-ffmpeg.test.ts:116-117).
   - (derived) The spike's table shows 118.7 MB vs 115.9 MB for "same, 10-bit". That gap is small but not explained if the 12-bit request was already being converted to 10-bit.
5. **ProRes savings ceiling.** The spike concluded ProRes can save only about 26%, so the size problem "needs a different format or cropping". The size report supersedes this: qscale reaches about 16% of the baseline, and cropping saves only about 1.3% after black fill. The spike never tried qscale.
6. **Spike track order.** The UI report marks the spike's track order UNVERIFIED. The write-path and spike reports answer it from `vision-ids.json` and `vision-reopened.json` (A3). All agree the current 0917 has no cutout track, and the spike overlays are gone (`~/Movies/CapCut/BOXBLACK/spike-cutout` no longer exists).
7. **Vision speed.** 35.9 ms per frame (bundling) vs 43.4 ms (spike): the inputs differ (360×640/540×960 vs 1080×1920). Not a real conflict.
8. **Minor ref drift, same facts.** `build-ffmpeg.sh` lines are cited as 37-40, 33-41 and 39-41; `canWrite` as WriteScreen.tsx:84-85 and 85-86; WriteResult as api.ts:809-841 and 809-831. The encoder lists agree on video (mjpeg, png, prores_ks, wrapped_avframe).
9. **Stale memory note.** `prodeck2-design-decisions.md:27` says whisper-cli is not bundled; line 29 of the same file and the repo say it is (`resources/bin`, required by release-check).

Files the reports produced (all under `SP`):
- `explore/keys.mts`
- `explore/segment-seq`, `explore/segment-seq-macos12`, `explore/segment-seq-macos12-stripped`, `explore/run/`, `explore/run2/`
- `explore/guided.swift` and the `guided` binary, `explore/cifilters.swift`, `explore/cmp.py`, `explore/guided-check.py`, `explore/guided-where.py`, `explore/guided-fix.py`
- `explore/p2b/`, `explore/vis-rerun/`, `explore/piece2c-bundled.mov`
- `explore/size/`: table-piece2b.csv, table-piece6b.csv, results-*.jsonl, bbox.json, coverage.json, look/, enc.py, enc/ (3.0 GB), work/ (5.7 GB, deletable)