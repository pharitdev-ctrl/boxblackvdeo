# Text behind the person: the spike pipeline rebuilt for the product

Everything below comes from the scratchpad scripts, the memory notes and the session transcript. I checked the key steps again today on this Mac (Apple M5 Pro); the results are written to `.../scratchpad/cutout/explore/`. Nothing in the repo, `~/Movies` or `~/Library` was written.

Abbreviations: V = `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/cutout/vision/`, E = the same path with `explore/` in place of `vision/`, T = the session transcript `/Users/ford/.claude/projects/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87.jsonl`. "L" is a transcript line.

## 1. Pipeline, step by step, with exact parameters

**Source.** `/Users/ford/Downloads/IMG_9646.MOV`: H.264 1080×1920, yuv420p, tv range, bt709.
- `r_frame_rate` is 30/1, `avg_frame_rate` 69975/2333, timebase 1/600, 933 frames.
- Frame steps are 20 ticks, with four steps of 21 ticks (at 3.47, 10.44, 17.44 and 24.41 s). So frames sit 1.67–6.7 ms after the exact 1/30 grid: 7.268333, 7.301667 … 26.606667, 26.64.
- There is no rotation or display matrix (checked today with ffprobe).
- Streams: 0 h264, 1 aac, 2 apac (no ffmpeg decoder), 3–7 mebx data.

**The two pieces of 0917** (T L55606–55607):

| Piece | Source start | Duration | Target start | Zoom keyframes |
|---|---|---|---|---|
| 2 | 7,300,000 µs | 2.5 s | 5,433,333 µs | none |
| 6 | 26,633,333 µs | 3.6 s | 18,366,666 µs | 3 |

**Step 1: frame extraction** (V/render-person.sh:15,17)
- `ffmpeg -ss <S> -t <sec+1/30> -i SRC -an -fps_mode passthrough -q:v 2 -start_number 1 frames/%04d.jpg`
- This gives the source's own frames in order, 1080×1920 yuvj420p JPG, about 185 KB each.
- One extra frame at the end: 76 frames for 2.5 s, 109 for 3.6 s.
- **One-frame-early rule** (the fixed "b" run, T L56151): S = source start − 1/30, so 7.266667 and 26.6. Accurate seeking then makes frame 1 the first frame with pts ≥ S, which is the last source frame before the piece's source start: 7.268333 and 26.606667.
- General rule (memory prodeck2-design-decisions.md:149): overlay frame j (0-based) = the latest source frame with pts < source start + j/30.
- Re-extracted today: byte-identical to work-piece2b, 0.21 s for 76 frames.
- The first run used S = source start (7.3 and 26.633333), which put frame 1 at 7.301667 and 26.64. That caused the one-frame lead.

**Step 2: Vision** (V/segment.swift:17–19, 24, 33)
- `VNGeneratePersonSegmentationRequest`, `qualityLevel = .accurate`, `outputPixelFormat = kCVPixelFormatType_OneComponent8`.
- One `VNImageRequestHandler(url:)` per JPG, with no orientation argument (so `.up`).
- Output size is fixed whatever the input size (probed today): accurate 1512×2016, balanced 384×512, fast 192×256, all 3:4 portrait. A 540×960 input also gave 1512×2016. The mask is written at Vision's own size as an L8 PNG, then stretched non-uniformly to 1080×1920.
- Orientation: it was never exercised. The frames came through ffmpeg (which auto-rotates by default), JPGs carry no EXIF orientation, and this MOV has no rotation. How a rotated iPhone MOV behaves, and Vision's output orientation for landscape input, are **UNVERIFIED**.
- `VNSequenceRequestHandler` (V/segment-seq.swift:18,28) gave the same masks: 0.22 %/frame change and IoU 0.977 against CapCut Pro in both cases (T L55692). It adds no temporal stability, so it was not used.
- Vision is deterministic: re-run today, the masks were identical to the spike's.

**Step 3: mask post-processing** (the user's "panel 4"; V/final-masks.py:13,20,24–36)
1. Guide = the frame's luma: ffmpeg `scale=1080:1920:flags=bicubic`, `-pix_fmt gray`, /255.
2. Input = the Vision mask, scaled bicubic from 1512×2016 to 1080×1920, /255.
3. He guided filter with r=12 (box 25×25, `scipy.ndimage.uniform_filter` in reflect mode) and eps=1e-3 (not squared), then clip to 0–1.
4. Temporal weights 1-2-3-2-1 /9 over ±2 frames. The frame index is clamped at the piece ends; no context frames outside the piece are used.
5. Round to uint8 and write a 1080×1920 grey PNG.

The comparison video was made at 540×960 with r=6 and mean-RGB as the guide (V/flicker2.py:34,47,62). The final masks scaled that to r=12 at full size. Re-running final-masks.py on a copy today reproduced the spike's masks byte for byte.

**Step 4: overlay encode** (V/render-person.sh:21–23 for rounds a/b; the final "c" command is at T L56255)
```
ffmpeg -ss S -t sec+1/30 -i SRC -framerate 30 -start_number 1 -i final/%04d.png -filter_complex "[0:v]setpts=N/30/TB,format=rgba[src];[1:v]format=gray[m];[src][m]alphamerge,format=yuva444p12le[out]" -map "[out]" -frames:v N -r 30 -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p12le -vendor apl0
```
- The colour comes from the source decoded directly, not from the JPGs. Frames are paired with masks by number (`setpts=N/30/TB`).
- Output: 1080×1920 at exactly 30 fps, `ap4h`, tagged bt709/tv, video only.
- The RGB of the background is kept where alpha is 0.
- Checked today with the bundled ffmpeg: overlay frame 0 matches source frame 7.268333 exactly, then 7.301667 and 7.335.

**Step 5: draft** (V/write-vision.mts:31–89; vision-written.json)
- The words go in as CapCut highlight text (bold-white, Kanit ExtraBold), one text track per line, render_index 13500+i. They span the **whole piece** (write-vision.mts:44–47).
- The person goes on a new track `{type:"video", flag:2}` with one segment per piece:
  - source {start 0, duration = piece duration}, target = the piece's `target_timerange` exactly;
  - volume 0, render_index 1, `clip` copied from the piece;
  - `common_keyframes` copied with new ids at both levels;
  - material duration = frames×1e6/30 (2,533,333 and 3,633,333 µs, one frame longer than the segment), 1080×1920, `has_audio: false`, plus a `graphicBinItem`.
- Track order: main, text tracks, person, then everything else. `track_render_index` = position in the list.
- CapCut re-saved it with every field unchanged; `has_audio` stayed false for our file.
- **Range covered:** the whole piece, with no padding. The only extras are one source frame early at the start and one frame spare at the end. An overlay covering only part of a piece, only while the text shows, was never tried: **UNVERIFIED**, including the frame-alignment rule for a start in mid-piece.

## 2. Measured timings and sizes

**Vision `.accurate`, 1080×1920 JPG input**
- Spike runs: 44.0, 42.7, 41.2 and 43.2 ms/frame; today 43.4 ms/frame (T L55607, L56152).
- The first frame, including model load, takes 88–125 ms. The very first cold run took 904 ms.
- Other settings:
  - 540×960 input: 32.5 ms/frame;
  - 10 PNG inputs at the start: 71.7 ms/frame (T L55495);
  - balanced: 27.0 ms, or 10.7 ms with the sequence handler;
  - fast: 21.9 ms.
- About 1.3 s of Vision work per second of video. The whole `segment` binary including PNG writes took 5.08 s for 76 frames today, about 2.0 s per second.

**Other steps (today)**

| Step | Time | Per second of video |
|---|---|---|
| Frame extraction | 0.21 s for 76 frames | ≈0.08 s |
| final-masks.py | 12.6 s wall for 76 frames, mostly per-frame ffmpeg subprocesses | ≈5 s |
| ProRes encode | ≈1.0 s wall (11.8 s CPU) for 76 frames | ≈0.4 s |

The whole spike pipeline costs about 7–8 s per second of video.

**Sizes**
- Overlay files:

  | File | Size |
  |---|---|
  | piece2.mov | 139 MiB |
  | piece6.mov | 208 MiB |
  | piece2b.mov | 139 MiB |
  | piece6b.mov | 204 MiB |
  | piece2c.mov | 150 MiB (re-encoded today: 157.5 MB, bitrate 497 Mb/s, 62.2 MB/s) |
  | piece6c.mov | 221 MiB |

  The "c" files are bigger because the alpha is softer. The spike folder was about 1 GB before it went to the Trash.
- Work folders, identical for 2b and 6b as for 2 and 6:

  | Content | Piece 2 (76 frames) | Piece 6 (109 frames) |
  |---|---|---|
  | JPG frames, ≈185 KB each | 13 MB | 19 MB |
  | Vision masks, 1512×2016 PNG | 5.6 MB (≈77 KB each) | 12 MB (≈117 KB each) |
  | Final masks, 1080×1920 PNG | 6.2 MB | 11 MB |

  work-piece2 also holds seq-accurate (5.6 MB) and seq-balanced (384×512, 940 KB).
- Size options measured today inside ProRes 4444 (bundled ffmpeg, piece 2c):

  | Option | Size | Rate |
  |---|---|---|
  | As in the spike | 157.5 MB | 62.2 MB/s |
  | `-alpha_bits 8` | 146.6 MB | 57.9 MB/s |
  | Black RGB where alpha is 0 | 118.7 MB | 46.8 MB/s |
  | Same, 10-bit | 115.9 MB | 45.7 MB/s |

  Within ProRes the best option saves about 26 %, so the size problem needs a different format or cropping to the person.

## 3. Pitfalls and fixes

1. **The overlay ran one frame ahead of the picture under it.** Measured in exports 2 and 3: the cutout best matched +1 while the picture underneath matched 0 (T L56131, L56185).
   - The note's explanation: CapCut picks a piece's frame at µs times that land just past frame boundaries (target starts are floored to µs), and the source frames sit 1.67–6.7 ms after the 1/30 grid, so a file on an exact 1/30 grid jumps to its next frame.
   - Fix: start one source frame early (render-person.sh called with 7.266667 and 26.6). Exports 3 and 4 then matched frame for frame on both pieces (T L56185, L56288).
2. **Double image at the zoom.** `common_keyframes[].time_offset` is source time (capcut-draft-format-facts.md:47–55).
   - Before 0.4.2 the main piece's offsets were piece-relative. The copied overlay (source starts at 0) zoomed on time and the main piece did not.
   - The spike fixed the main piece only (E/../export/fix-keyframes.mts:22–24); the overlay's 0-based offsets were already right.
   - **Product after 0.4.2:** the main piece now writes `source.start + at×speed` (packages/core/src/capcut/zoom.ts:68–70). Copying verbatim as write-vision.mts:79 did would now be wrong. The overlay needs `offset − main.source_timerange.start`.
   - Main-piece speed ≠ 1 was never tested: **UNVERIFIED**.
3. **Audio mapping.**
   - In zsh, `-map 0:a?` is a glob error; it has to be quoted (T L55518).
   - `-map '0:a?'` also picks stream 2 (apac), and ffmpeg fails with "no decoder found for: none" (T L55535). `-map 0:a:0` fixed the preview (T L55540).
   - The overlay avoids audio entirely: `-an`, only `[out]` mapped, `has_audio: false`, volume 0.
4. **No `drawtext`.** Homebrew ffmpeg: "No such filter: 'drawtext'" (T L55521). The bundled build has no drawtext, subtitles or ass either (no freetype because of `--disable-autodetect`).
   - Workaround for the preview: V/words.swift (CoreText to a transparent PNG).
   - In the draft, the words are CapCut text, so this does not affect the product.
5. **Edge jitter.** Vision's mask reverses about 3× as often as CapCut Pro's in the words' area: 0.43 vs 0.15 per mille per frame (flicker2.py:71–76, T L56216). The plain per-frame change metric hid this (0.22 % vs 0.25 %).
   - Fix: guided filter plus 1-2-3-2-1 smoothing.
   - Reversals in the export fell for piece 2 from 2.83 to 1.42 ‰, and for piece 6 from 3.29 to 1.15 ‰ (T L56284).
   - The user's verdict: a little left, but OK.
6. **Track order and render_index.** CapCut layers by track-list order, not render_index. The person must sit above the text tracks and below the subtitles, and needs the piece's `clip` too (capcut-draft-format-facts.md:41–43).
7. **Frames paired by number.** `setpts=N/30/TB` assumes the source is about 30 fps. On a 29.97 fps source the pairing would drift about one frame every 33 s, which matters only for long overlays: **UNVERIFIED** (this spike had no such source).
8. **Vision includes part of the chair** behind the shoulders (memory :122).
9. **Found today: ffmpeg's `guided` filter.**
   - It does not clip. Results outside 0–1 wrap around (2.5 % of pixels > 1, 0.8 % < 0 on frame 20), which leaves holes of up to 255 levels.
   - `grayf32` does not help.
   - Fix: squeeze the mask into 16384–49151 in gray16, filter, then expand with a clipping `lut`.
   - `eps` is used as given, not squared, despite the "(with square)" help text.
   - The first input is the guide and the second is the mask.
10. **The bundled ffmpeg has no rawvideo or image2pipe muxer.** Only image2, mov, wav, flac, s16le and null (apps/desktop/scripts/build-ffmpeg.sh:39–41), so raw frames cannot be piped out. It has no VideoToolbox encoders either.

## 4. Porting the numpy/scipy steps

Only five steps need Python: the luma and mask resize (done through ffmpeg subprocesses), six 25×25 box filters, a few elementwise operations, the clip, and the clamped weighted sum over five frames. All of them port easily.

- **Swift with Accelerate (recommended).**
  - Prototype E/guided.swift: `vImageSepConvolve_PlanarF` (macOS 11+) with `kvImageEdgeExtend` and vDSP, grey conversion and scaling through CoreGraphics.
  - Timings: guided filter 6.0 ms/frame and temporal 1.1 ms/frame at 1080×1920. Decoding took 19.8 ms/frame and PNG writes 12.3 ms, which a helper holding Vision's buffers in memory would not need.
  - Output against final-masks.py over 7 sampled frames: at most 7 levels off, mean 0.024 (inside a 40 px border). That is identical for practical purposes, and far cheaper than Vision's 43 ms.
  - Core Image also has `CIGuidedFilter` (macOS 10.14; inputs `inputImage`, `inputGuideImage`, `inputRadius`, `inputEpsilon`) and `CIPersonSegmentation` (macOS 12). Whether CIGuidedFilter's parameters match He's r and eps is **UNVERIFIED**.
- **ffmpeg only.** The bundled LGPL 8.1.2 has `guided`, `tmix`, `tpad`, `trim`, `lut` and `alphamerge`. This graph matches Python over all 76 frames (at most 2 levels inside; up to 39 at the 40 px border, where the edge modes differ):
  ```
  [0:v]format=gray16le[g];[1:v]scale=1080:1920:flags=bicubic,format=gray16le,lut=y='16384+val/2'[m];[g][m]guided=radius=12:eps=0.001:guidance=on,lut=y='clip((val-16384)*2,0,65535)',tpad=start=2:start_mode=clone:stop=2:stop_mode=clone,tmix=frames=5:weights='1 2 3 2 1',trim=start_frame=4,setpts=PTS-STARTPTS,format=gray[o]
  ```
  - Basic mode is slow: 26.4 s wall and 300 s CPU for 76 frames.
  - `mode=fast:sub=2` takes 2.6 s (at most 23 levels off; 0.46 % of pixels more than 4 off).
  - `sub=4` takes 0.45 s (at most 63 off; 1.8 %).
  - Whether fast mode looks acceptable is **UNVERIFIED**.
  - It still needs PNG files between steps, because raw piping is impossible with this build.

The Vision helper has to exist anyway, so doing the guided filter and smoothing in Swift is the lightest option.

Files are in `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/cutout/explore/`:
- `guided.swift` (Swift prototype and built binary `guided`)
- `guided-check.py`, `guided-where.py`, `guided-fix.py` (ffmpeg `guided` tests)
- `cmp.py` (mask comparison)
- `cifilters.swift` (Core Image filter check)
- `p2b/` (copied frames and masks; outputs `final/`, `ffmask/`, `fast2/`, `fast4/`, `half6/`, `swift/`)
- `vis-rerun/` (Vision re-run)
- `piece2c-bundled.mov` (157.5 MB re-encode)