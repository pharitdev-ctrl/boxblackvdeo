# Facts the plan parts may rely on (measured 2026-09-29)

SP = /private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad
Memory (read-only): /Users/ford/.claude/projects/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/memory/capcut-draft-format-facts.md
("Which frame CapCut shows", "Background removal", "Layer order follows the order of tracks[]").

## The 0917 source (IMG_9646.MOV) timing — usable as a test fixture without any picture
- timescale 600, 933 frames, pts[i] = 20·i + (i≥104) + (i≥313) + (i≥523) + (i≥732)  (four 21-tick steps; "uneven").
- H.264 1080×1920, SDR (bt709 primaries/transfer/matrix, tv range), no rotation. Draft fps 30.

## What CapCut showed (exports 0917-5 and 0917-behind2): main layer, measured frame by frame
The main pieces as the 0.4.2 test write laid them (target µs / source µs):
- piece 0: target 0,        source 1_800_000
- piece 1: target 5_433_333, source 7_300_000
- piece 3: target 11_500_000, source 15_900_000
- piece 5: target 18_366_666, source 26_633_333
Measured main source frame per timeline frame n (all consecutive, +1 per frame):
| range | piece | timeline frames n | main shows source frames |
|---|---|---|---|
| r0  | 0 | 6 … 46   (41) | 60 … 100 |
| g1a | 0 | 94 … 162 (69) | 147 … 215 |
| g1b | 1 | 163 … 174 (12) | 218 … 229 |
| g3a | 3 | 373 … 436 (64) | 504 … 567 |
| g5a | 5 | 555 … 598 (44) | 802 … 845 |
The rule "uneven: latest frame with ptsUs ≤ askedUs + 1, asked = source.start + (frameToUs(n) − target.start)" reproduces
all 230 of these; so does the round-2 person layer built from it (person == main in every measured frame).

## What CapCut showed for a constant-rate (even) ProRes file (calibration export 0917-calib)
Barcode file, pts 20·n ticks in timescale 600, segment target.start 1_000_000:
| source.start (µs) | shown file frame at timeline frame 30 + k |
|---|---|
| 0      | k      |
| 5_000  | k + 1  |
| 10_000 | k + 1  |
| 16_667 | k + 1  |
| 25_000 | k + 1  |
| 30_000 | k + 1  |
and with target.start 1_033_333: source.start 0 → k (from frame 31), 16_667 → k + 1.
So even files: the first frame with ptsUs ≥ askedUs (within ~1 µs). A file whose first 30 frames are even and which then
has one 21-tick step rounded up before the step and down after it — so person files must be exactly even (pts 20·n).

## Layer order (export 0917-5): main, behind text, person, cutaway, graphics, normal bars+text, subtitles, audio
worked: normal text over a full-frame cutaway and over a graphic, subtitles on top, CapCut kept the order on re-save.

## CapCut background removal on mid-piece copies (0917, Pro route)
matting.path = <draft>/matting/<md5 hex of the material's path string>; CapCut rewrote it to its own placeholder and
computed 841 masks in ~12 s for six copies (each source range ±3 s). Text behind the person seen in the editor.

## Encode that worked (bundled ffmpeg 8.1.2, /Applications/BOXBLACK.app/Contents/Resources/bin/ffmpeg)
`-f rawvideo -pix_fmt yuva444p10le -s WxH -framerate 30 -i - -vf settb=1/600,setpts=20*N -fps_mode passthrough
 -enc_time_base:v 1/600 -video_track_timescale 600 -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 8
 -qscale:v 12 -vendor apl0 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv out.mov`
→ 10–12 MB per second; pts exactly 20·n. Without `-enc_time_base:v 1/600` ffmpeg rounds to 1/30.
Black outside the person: Y 64, U 512, V 512 (10-bit) wherever alpha is 0; never premultiply.
The bundled ffmpeg has no rawvideo muxer and no rawvideo/ffv1 encoder: it cannot hand frames to another process,
so the helper decodes the source itself (AVFoundation) and pipes raw frames into ffmpeg.

## Mask pipeline (the user's "ช่อง 4") — reference implementation
- $SP/cutout/vision/segment.swift — Vision VNGeneratePersonSegmentationRequest, qualityLevel .accurate,
  outputPixelFormat OneComponent8, one VNImageRequestHandler per frame; mask is 1512×2016 whatever the input.
- $SP/cutout/vision/final-masks.py — guide = frame luma (bicubic to W×H, /255), mask bicubic to W×H /255, He guided filter
  r = 12 (box 25×25, reflect), eps = 1e-3, clip 0..1; then temporal weights 1-2-3-2-1 /9 over ±2 frames, index clamped
  at the ends; 8-bit PNG.
- $SP/cutout/explore/guided.swift — Accelerate prototype (vImageSepConvolve_PlanarF, kvImageEdgeExtend + vDSP):
  6 ms/frame guided filter, 1.1 ms temporal; ≤ 7 levels off Python inside a 40 px border (edge modes differ).
- $SP/cutout/explore/segment-seq-macos12 — a build with `-target arm64-apple-macos12.0` (97 KB, strip -x → 80 KB).
- Vision .accurate: 35–43 ms per frame on this Mac (macOS 27, Swift 6.4, Xcode 27).

## Bundling (existing patterns)
- apps/desktop/electron-builder.cjs: `resources/bin` → `Resources/bin` outside asar; arm64; minimumSystemVersion 12.0;
  ad-hoc signing without CSC.
- apps/desktop/scripts/build-whisper.sh and build-ffmpeg.sh; apps/desktop/scripts/release-check.ts (+ .test.ts).
- main/bundled-ffmpeg.test.ts, main/bundled-whisper.test.ts (otool/minos/arch checks).
- main/tools.ts + packages/core/src/media/tool-check.ts (ToolReport), renderer ToolsCard.tsx (Settings "เครื่องมือบนเครื่องนี้").
- main/index.ts: `resourcesDir` (dev and packaged) vs `process.resourcesPath` (packaged only).

## Exploration reports with file:line references (read what you need)
$SP/cutout/explore/report-write-path.md, report-overlay-pipeline.md, report-bundling.md, report-spike.md,
report-size.md, report-ui.md, synthesis.md, spec-review-confirmed.md (the spec review's 46 confirmed findings, all
already folded into the spec).

## Privacy
Never commit a picture of the user (IMG_9646 frames are the user's face). Fixtures must be synthetic pictures or
numbers only (the pts list above is fine).
