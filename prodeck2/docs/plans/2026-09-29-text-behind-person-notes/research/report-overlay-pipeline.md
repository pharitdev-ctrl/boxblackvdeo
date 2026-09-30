1. When renders start, the queue, concurrency, cancel, retry and progress events

All paths below are under apps/desktop/src/ unless they start with packages/.

**When renders start.** No command starts a render directly. Code calls `renderer.ensure(jobs, folder)` (runs in the background) or `renderer.wait(jobs, folder)` (the caller blocks). Both go through `schedule` and `sortAndRender` in main/graphics-render.ts:386-424. There are three triggers:
- **Every preview.** The renderer calls `api.previewHighlights` (renderer/src/room/ClipRoom.tsx:410). Main then calls `highlights.preview` (main/highlight-api.ts:179, main/highlights.ts:489), then `graphicView`. That calls `renderer.ensure(jobs, folder)` when `graphicsReady()` is true (main/highlights.ts:305, 315). It runs on every look at the post page.
- **After the plan.** `planGraphics`, which is work 2c, calls `deps.graphics.ensure(...)` once its answer is stored (main/flair.ts:436-443). Work 2a picks its text with graphics switched off so it does not start renders that 2c will replace (main/post-plan.ts:162-164).
- **At write.** `timeline.writeNow` calls `renderer.wait(jobs, folder)` before it reads the draft (main/timeline.ts:407-435).
- `graphicsReady` requires all of these: no pack change under way, `machineReady()`, pack paths present, and ffmpeg and ffprobe found (main/index.ts:260-261).
- The jobs come from `highlights.graphicJobs`, then `graphicsOn`, `graphicsInForce` and `graphicJob` (main/highlights.ts:254-334, main/graphics-cues.ts:386-484). The fps is `draft.info.fps` and the canvas is `canvasOf` (main/timeline.ts:607-611).

**Queue and concurrency.**
- There is one global promise chain (`chain`), so renders are strictly serial across every project and every ask (main/graphics-render.ts:173, 332-377).
- Asks are sorted in arrival order through a second chain, `sorting` (main/graphics-render.ts:175, 393-405).
- The same hash inside one generation joins the task already queued, using the key `${generation} ${hash}` in `inFlight` (main/graphics-render.ts:168, 334-336, 374-375).
- Inside one render, HyperFrames runs with `--workers 2` (main/graphics-render.ts:244).
- Each render times out after `RENDER_TIMEOUT_MS = 120_000` (main/graphics-render.ts:62, 318). A timeout counts as a failure, because only the stop signal's abort is excused (main/graphics-render.ts:352).
- A job is skipped at run time, and stays "waiting", if any of these hold: it already failed, the machine is blocked, the pack is missing, or the generation changed (main/graphics-render.ts:340-343).
- Blocked jobs are not queued at all (main/graphics-render.ts:408).

**Cancellation.** `cancel()` bumps `generation` and aborts only the current render (main/graphics-render.ts:475-478). HyperFrames gets SIGTERM and 5 s of grace (main/graphics-render.ts:64, 246-247; packages/core/src/media/process.ts:75-80). It is called only in two places:
- `before-quit` (main/index.ts:436-446)
- `changingPack`, when the pack is installed or removed (main/index.ts:280-290)

There is no per-job or per-folder cancel, and leaving the page does not cancel. An aborted job is not recorded as a failure (main/graphics-render.ts:351-352).

**Retry.** The Retry button calls `api.retryGraphic(folder, anchor)` (renderer/src/edit/FlairTab.tsx:243-246, renderer/src/edit/GraphicsTab.tsx:84). From there:
- `flair.retryGraphic` rebuilds the job under the *saved settings* with `highlights.jobFor` (main/flair.ts:687-694, main/highlights.ts:505-510).
- It then calls `renderer.retry(hash)`, which only runs `failures.delete(hash)` (main/graphics-render.ts:447-449).
- The UI then bumps the preview through `changeHighlightText` (renderer/src/room/ClipRoom.tsx:680-697). The re-read calls `ensure` again, and that re-queues the job.

Failures live only in memory, in `failures: Map` (main/graphics-render.ts:160), so a restart forgets them. Machine and emoji problems are kept apart from per-graphic failures (main/graphics-render.ts:161-164, 353-363). They are cleared by `forgetFailures()` on a tools rescan or a pack change (main/index.ts:134, 286).

**Progress events** use the `AppEvent` type `"graphics"` (shared/api.ts:461-465):
- `started` (main/graphics-render.ts:347)
- `failed` (main/graphics-render.ts:365)
- `progress` with done/total after each job of an ask settles (main/graphics-render.ts:417)
- `done` per ask (main/graphics-render.ts:421)

An ask that queues nothing sends nothing. HyperFrames runs with `--quiet`, so there is no progress inside a render.

The renderer ignores the payload. `ClipRoom` only throttles a re-read of the preview, at most every `GRAPHICS_REFRESH_MS = 500` (renderer/src/room/ClipRoom.tsx:151, 431-455). It also re-reads when the pack install finishes. Per-graphic state comes from the preview: `statusOf` returns ready, failed, rendering (only the current hash) or waiting (main/graphics-render.ts:440-445), and the preview adds a poster and an error (main/highlights.ts:316-323). `FlairTab` shows each row's state and Retry (renderer/src/edit/FlairTab.tsx:200-247). `WriteScreen` counts ready and failed rows into a progress bar (renderer/src/screens/WriteScreen.tsx:91-96, 188-195).

2. Output files, naming and hash, reuse, and cleanup

**Where files go.**
- `graphicsDir = ~/Movies/CapCut/BOXBLACK/graphics` (main/index.ts:229-230).
- Each graphic writes `<hash>.mov`, `<hash>.png` and `<hash>.json` (main/graphics-render.ts:180).
- Scratch: `tmpdir()/boxblack-graphics` (main/index.ts:248). The compose folder `compose/<hash>` is removed before and after each render (main/graphics-render.ts:300-304, 326-327). HyperFrames gets its own HOME, TMPDIR and PATH (bin) there (main/graphics-render.ts:237-243, 248-264).
- The finished file is renamed into place, or copied if that fails across volumes (main/graphics-render.ts:321).

**Hash.** `sha256(JSON[spec minus why/version, canvas, fps, font, palette, KIT_VERSION, emoji-set commit])`, first 16 hex characters (main/graphics-render.ts:202-212). A sticker hashes null for font and palette. The emoji-set commit is included only when the graphic draws an emoji. `HASH = /^[0-9a-f]{16}$/` guards paths (main/graphics-render.ts:67).

**Reuse.** `made(hash)` means the `.json` parses and the `.mov` can be stat'ed (main/graphics-render.ts:191-200). `render()` returns early when the graphic is made (main/graphics-render.ts:286), and `sortAndRender` answers made graphics as ready without queueing them (main/graphics-render.ts:398-402). The `.json` meta is written last and atomically, so it is the commit marker (main/graphics-render.ts:323-325). The poster is one ffmpeg frame at mid-time, 270 px wide, in rgba (main/graphics-render.ts:278-283).

**Cleanup.** The Settings button "ย้ายไฟล์ที่ไม่ได้ใช้ไปถังขยะ" (renderer/src/i18n.ts:547; renderer/src/screens/SettingsScreen.tsx:200-235) calls `cleanGraphicFiles` (main/settings-api.ts:116-117, main/index.ts:262-276, main/graphics-files.ts:163-213).
- **What counts as "in use":** any `[0-9a-f]{16}\.mov` string, in any case, found anywhere in the text of these draft JSON files (main/graphics-files.ts:12, 50-60, 92-110):
  - `draft_info.json`
  - `draft_meta_info.json` (the media bin)
  - everything under `subdraft/`
  - `Timelines/<id>/*.json`
- It scans every draft up to depth 4 under the CapCut drafts root, which includes `.recycle_bin`, and under `<userData>/backups` (main/graphics-files.ts:24, 117-132, 177-182). Folders named `.cloud_cache_*` are skipped.
- One unreadable draft blocks the whole clean (`blockedBy: unreadable`).
- **Busy:** it refuses while any of these hold (main/index.ts:273):
  - `!renderer.idle()`
  - `timeline.anyWriting()`
  - `writesStarted` changed since the clean began

  It checks again before each file (main/graphics-files.ts:175, 204).
- Files younger than `SETTLING_MS = 10 min` are kept, and the result reports `kept: "recent"` (main/graphics-files.ts:18, 146-152, 196-201).
- Order per file: `.json` first, then `.mov`, then `.png`, each through `shell.trashItem` (main/graphics-files.ts:205-210, main/index.ts:272). Only names matching `^[0-9a-f]{16}\.mov$` are touched. The count and size shown in Settings use the same regex (main/graphics-files.ts:10, 27-40).
- The app never deletes automatically. The renderer's header comment says so (main/graphics-render.ts:157), and so does the hint at renderer/src/i18n.ts:546.

**Media bin pruning on write.**
- On each write, bin entries under `graphicsDir` that the new timeline no longer plays are dropped, but only when the draft has at most one live timeline (main/timeline.ts:575-585).
- `pruneBinItems` also requires `isRenderedGraphic(path)`, and that is hard-coded to the substring `/Movies/CapCut/BOXBLACK/graphics/` (packages/core/src/capcut/bin.ts:40-45, 84-94).
- The same check keeps rendered files out of "footage" in the project video list (packages/core/src/capcut/projects.ts:74-76) and out of spare cutaway media (packages/core/src/flair/media.ts:51-52).
- A cutout folder anywhere else would show up as footage and would never be pruned unless those checks are widened. This is a consequence of the code above, not a behaviour I observed.

**What is on disk now.** `graphics/` holds 69 files, 190 MB. One sample is `<hash>.mov` at ProRes 4444, 512x958, 3 s, 12.75 MB (about 4.25 MB/s), decoding as yuva444p12le. Its `.json` is `{width,height,durationUs,place{scale,x,y}}`. Graphics are rendered at the size of their box, not the full canvas (main/graphics-render.ts:214-218, 323).

3. How the write handles unfinished renders

- **The button does not block.** `canWrite` ignores render state (renderer/src/screens/WriteScreen.tsx:84-85). The comment at renderer/src/screens/WriteScreen.tsx:188 says so, and the check row reads "เขียนได้เลย ตอนเขียนจะรอ…" (renderer/src/i18n.ts:346). Failed renders show as a warning row (renderer/src/screens/WriteScreen.tsx:195).
- **Main waits.** In `writeNow` (main/timeline.ts:407-435), when graphics are on and at least one is kept:
  1. With no renderer, it throws "not installed".
  2. If `!graphicsReady()`, any job that is not made throws (either the unfit reason or "not installed") (main/timeline.ts:424-426).
  3. `await renderer.wait(jobs)`.
  4. Any job that is neither ready nor failed (cancelled, or the machine found unfit) throws "…the draft was not changed" (main/timeline.ts:428-432).
- **Order of checks.** CapCut is checked as closed before the wait and again after it, before the backup and the draft read (main/timeline.ts:403, 437). Only one write or restore per draft runs at a time, through `alone()` (main/timeline.ts:383-393). The write sends `timeline-write` events with started, done or failed (main/timeline.ts:743-753, shared/api.ts:466-469), because the page may be left while it waits.
- **Failed renders are skipped, not fatal.** `rendered(job)` returns null for them, which increments `graphicsSkipped` (main/timeline.ts:543-549). The count comes back in `WriteResult` (main/timeline.ts:597) and is shown at renderer/src/screens/WriteScreen.tsx:242 and in a longer toast at renderer/src/room/ClipRoom.tsx:827.
- **Placement.** Graphics go on overlay video tracks through `addGraphicTrack`, then `addOverlayTracks` with `RENDER_INDEX_BASE = 1000`, `flag: 2`, silent, source start 0 (packages/core/src/capcut/graphics.ts:21-64, packages/core/src/capcut/overlays.ts:27-77).
- **Current track order**, built by appending in this sequence:
  1. Main video (packages/core/src/capcut/rough-cut.ts:67)
  2. Subtitles (main/timeline.ts:468, packages/core/src/capcut/subtitles.ts:45)
  3. Highlight bars and text (main/timeline.ts:512, packages/core/src/capcut/highlights.ts:229)
  4. Zooms, as keyframes only (main/timeline.ts:532)
  5. Inserts (main/timeline.ts:537)
  6. Graphics (main/timeline.ts:569)
  7. Sounds (main/timeline.ts:573)

  I confirmed this order in 0917's current draft_info.json. Track 0 is video. Track 1 is subtitle text (flag 1, render_index 14000). Tracks 2-4 are bar stickers (13002-4). Tracks 5-7 are highlight text (14005-7). Track 8 is the graphics overlay (1008). Tracks 9-11 are audio.
- **Layering implication.** Per the spike memory notes (not re-verified here), CapCut layers by `tracks[]` order, not by `render_index`. Placing a cutout above the highlight text and below the subtitles would therefore mean moving the subtitle track after the cutout track. The current writer puts subtitles second.
- **Zooms.** `addZooms` keyframes the segments of the first video track, with `time_offset = source_timerange.start + atUs * speed` (packages/core/src/capcut/zoom.ts:62-71, 83-119). Overlay segments are written with `source.start = 0` (packages/core/src/capcut/overlays.ts:53). Copied zoom keyframes therefore have to be re-based to the overlay file's own source time.

4. ffmpeg, and whether frame extraction can be reused

**No bundled-ffmpeg.ts source exists.** There is only main/bundled-ffmpeg.test.ts, which exercises the shipped binary.
- Resolution: `findExecutable` checks bundled dirs (`process.resourcesPath/bin`) first, then PATH, then search dirs, then Homebrew (main/index.ts:119-126; packages/core/src/media/tools.ts:20-28). The results go into the shared `toolbox.paths` object (main/tools.ts:25-45).
- The renderer gets `ffmpeg: () => tools.ffmpeg` and `ffprobe` (main/index.ts:252-253).
- In development the resources come from apps/desktop/resources (main/index.ts:233).
- The pinned version is 8.1.2 (apps/desktop/scripts/release-check.ts:21, apps/desktop/scripts/build-ffmpeg.sh:17).

**Build configuration** (apps/desktop/scripts/build-ffmpeg.sh:33-41):
- LGPL, `--disable-autodetect`
- Encoders: mjpeg, flac, pcm_s16le, wrapped_avframe, prores_ks, png
- Muxers: image2, wav, flac, pcm_s16le, null, mov
- Protocols: file, pipe, fd
- Every decoder, demuxer and filter is kept

**Checked by running the shipped binary read-only:**
- No hwaccels, and no hevc_videotoolbox or prores_videotoolbox. HEVC-with-alpha is not possible with it.
- prores_ks accepts only `yuv422p10le`, `yuv444p10le` and `yuva444p10le` as input. The spike's `-pix_fmt yuva444p12le` (scratchpad cutout/vision/render-person.sh, run with Homebrew ffmpeg) is not in that list. The Homebrew ffmpeg's prores_ks lists the same three formats.
- These filters are present: alphamerge, alphaextract, guided, tmix, maskedmerge, premultiply, mergeplanes, overlay, format, scale.
- These demuxers are present: rawvideo, image2, image2pipe, png_pipe, mov.
- The required-tools check lists are in packages/core/src/media/tool-check.ts:4-8.

**Argument helpers.** There is no generic builder; each call site writes its own argument array. They all run through `runProcess` (packages/core/src/media/process.ts:27-97):
- Options: `signal`, `stopGraceMs`, `env`, `cwd`, `onStdout` (streams binary output out), `onStderr`.
- **`stdin` is a string only**, so raw frames cannot be piped into ffmpeg through it.
- No shell is used.
- Existing call sites:
  - `makePoster` (main/graphics-render.ts:278-283)
  - `extractFrames` (packages/core/src/vision/frames.ts:23-69)
  - `measureLoudness`, which streams stdout (packages/core/src/media/loudness.ts:49-57)
  - `extractAudio` and `hasAudioStream` (packages/core/src/media/audio.ts)

**Frame extraction.**
- `extractFrames` does one accurate `-ss` seek per frame, writes JPEG scaled to at most 384 px on the long side, runs 4 at a time, and names files `frame-<µs>.jpg` (packages/core/src/vision/frames.ts:13-14, 22-69). A full-size path exists (`size === null`), but it is private to `frameArgs` and used only for tiled HEIC.
- main/frame-files.ts:21-54 wraps it:
  - `one()` gives a thumbnail
  - `session()` gives per-request `mkdtemp` folders under `tmpdir()/boxblack-work`, with `dispose()`

  It is wired at main/index.ts:216-220 and used for Claude's looks, graphics frames and thumbnails (main/index.ts:357-364, 377-380; main/flair.ts:211-230).
- Vision analysis samples sparse frames for Claude (packages/core/src/vision/run.ts:124-125, main/analysis.ts:112).
- None of these give full-resolution, every-frame, in-order decoding.
- **There is no Apple Vision or Swift segmentation code in the app.** The only .swift file is apps/desktop/build/make-icon.swift. The segmentation binaries exist only in the scratchpad.

5. Settings and storage for render state

- **No render state is saved in settings or the outline.** It lives in two places:
  - **Disk:** the hash files, with made meaning the `.json` plus the `.mov` exist.
  - **Memory:** the renderer's `failures`, `environment`, `emojiProblem`, `current`, `generation` and `asking` (main/graphics-render.ts:160-175).
- **Outline:** `StoredOutline.flair.graphics: GraphicCue[]` (shared/api.ts:495). `GraphicCue` holds `anchor`, `spec`, `edited`, `off` and optional `pointId` (packages/core/src/graphics/plan.ts:117-127). It has no hash or file path. Outlines live in `<userData>/outlines` (main/index.ts:161).
- **Settings:** the switch `flair.graphic`, default false (packages/core/src/flair/catalogue.ts:20-24, main/settings.ts:130).
- **Pack:** `<userData>/hyperframes/installed.json` plus the version folder (main/graphics-pack.ts:71-93, main/index.ts:228). Pack events are `graphics-pack` (shared/api.ts:457-460).
- **SettingsView fields** (shared/api.ts:333-343), filled by main/settings-api.ts:57-81:
  - `graphicsPack`
  - `graphicsProblem`, which is `{text, kind: machine|emoji}`
  - `graphicFiles`, which is `{count, bytes}`
- **Preview fields:** `graphics: GraphicView[]` with `render`, `poster` and `error`, plus `graphicsWaitForPack` and `graphicsProblem` (shared/api.ts:609-637, 709-719). `GraphicRenderState` is waiting, rendering, ready or failed (shared/api.ts:381). The clean result type is at shared/api.ts:402-413.
- **Two files are not what their names suggest:**
  - main/progress.ts is analysis progress per project (`ProgressStore`, `stagesOf`), not render progress.
  - main/post-cleanup.ts is the one-time M25 outline migration (`withoutOldEffects`), not file cleanup.

UNVERIFIED:
- What CapCut does with a ProRes file encoded from 10-bit input compared with the spike's file.
- Whether the spike's yuva444p12le request was silently converted by ffmpeg.
- Layer order following `tracks[]` comes from the spike memory notes, not from code.

I wrote no scratch files.