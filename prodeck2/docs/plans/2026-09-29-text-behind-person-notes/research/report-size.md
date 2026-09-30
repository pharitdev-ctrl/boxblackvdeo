I measured the options on both pieces (2b: 76 frames, 6b: 109 frames), using the source video and the final masks from the scratchpad. The best ProRes combination the bundled ffmpeg can already make is about 10 MB/s, down from 60, with edges I could not tell apart from the original. Writing the overlay only while highlight text is on screen brings draft 0917 from about 1.33 GB to about 120 MB.

## Inputs and setup
- **Source video:** `/Users/ford/Downloads/IMG_9646.MOV`, 1080x1920, 30 fps, H.264, BT.709. It is named in draft 0917's `draft_info.json` (single-line JSON) under `materials.videos[].path`, which I read without writing.
  - Piece 2 is main-track segment[1]: source 7.3 s, 2.5 s long.
  - Piece 6 is segment[5]: source 26.633333 s, 3.6 s long, with Line keyframes ScaleX 1→1.08 and PositionY 0→−0.0112.
- **No spike overlay .mov to compare against:** none in the work folders, and `~/Movies/CapCut/BOXBLACK/spike-cutout` no longer exists. So I made my own lossless masters (source frame plus final mask as alpha, 8-bit) and used them as the truth. Encode (a) is the spike's encoder settings run on the same master.
- **Bundled ffmpeg** (`apps/desktop/resources/bin/ffmpeg`, 8.1.2): its only video encoders are mjpeg, png, prores_ks and wrapped_avframe. It has no hevc_videotoolbox, because `apps/desktop/scripts/build-ffmpeg.sh:37` uses `--disable-autodetect` and `:39` lists only those encoders. `packages/core/src/media/tool-check.ts:6` requires the same list.
  - It does have the filters needed: alphamerge, crop, scale, format, maskedmerge, premultiply.
  - The ffmpeg inside `release/.../BOXBLACK.app` has a different hash but the same version and settings.
  - All ProRes files were made with the bundled binary. HEVC and the metrics used Homebrew ffmpeg.
- **prores_ks only accepts 10-bit input** (yuv422p10le, yuv444p10le, yuva444p10le). The spike's `-pix_fmt yuva444p12le` is quietly converted to 10-bit, and the decoder reports 12-bit regardless (`apps/desktop/src/main/bundled-ffmpeg.test.ts:116-117`).

## Quality measures
- **alpha diff:** average alpha difference from the baseline, in a 6 px band around the mask edge, in 0–255 levels.
- **alpha p99.9:** the worst 0.1% of that difference.
- **RGB PSNR:** picture quality inside the mask (alpha ≥ 128) compared with the lossless master.
- **edge over white:** the edge band put over a white plate, like white highlight text behind the person, compared with the master (average and worst 0.1%).
- For reference, the same frames encoded as plain H.264 with x264 CRF 18 score 38.5 dB inside the mask, and x264 at 12 Mbps scores 38.0 dB. That is roughly what an export costs anyway; that CapCut's own export behaves like this is UNVERIFIED.

## Results (piece 2b, with piece 6b MB/s where measured)

| Option | MB/s (2b / 6b) | % of (a) | alpha diff | alpha p99.9 | RGB PSNR | edge over white avg / p99.9 |
|---|---|---|---|---|---|---|
| (a) baseline, spike settings | 59.8 / 60.5 | 100 | 0 | 0 | 55.8 | 0.29 / 1.4 |
| (b) alpha 8-bit, default quality | 55.6 / 54.5 | 93 | 0.19 | 0.5 | 55.8 | 0.31 / 1.8 |
| (b) qscale 4, alpha 8-bit | 21.6 | 36 | 0.19 | 0.5 | 50.5 | 0.44 / 3.4 |
| (b) qscale 8, alpha 8-bit | 13.5 / 14.1 | 22.5 | 0.19 | 0.5 | 47.1 | 0.65 / 5.2 |
| (b) qscale 8, alpha 16-bit | 17.7 | 29.6 | 0 | 0 | 47.1 | 0.64 / 5.1 |
| (b) qscale 12, alpha 8-bit | 10.5 / 11.3 | 17.6 | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (b) qscale 16 / 24, alpha 8-bit | 9.0 / 7.3 | 15 / 12 | 0.19 | 0.5 | 43.7 / 41.6 | 1.03 / 8.5 and 1.37 / 11.6 |
| (c) cropped only | 54.4 / 55.0 | 91 | 0 | 0 | 55.8 | same as (a) |
| (d) black outside | 45.6 | 76 | 0 | 0 | 55.8 | same as (a) |
| (d) black outside, qscale 8, alpha 8-bit | 11.9 / 12.3 | 19.9 | 0.19 | 0.5 | 47.1 | 0.65 / 5.2 |
| (d) black outside, qscale 12, alpha 8-bit | 9.75 / 10.35 | 16.3 | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (c+d) cropped, black, qscale 12, alpha 8-bit | 9.59 / 10.20 | 16.0 | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (d) flat mean colour outside, qscale 12 | 9.47 / 10.08 | 15.8 | 0.19 | 0.5 | 45.1 | 0.85 / 6.9 |
| (f) 720x1280, black, qscale 8 | 6.4 / 6.7 | 10.8 | 3.9 | 37 | 41.1 | 3.8 / 46 |
| (f) 540x960, black, qscale 8 | 4.1 | 6.9 | 6.0 | 50 | 38.7 | 5.7 / 61 |
| (e) HEVC, black, quality 65 | 2.4 / 3.1 | 4.0 | 1.09 | 2.0 | 38.5 | 2.06 / 17.5 |
| (e) HEVC, black, quality 80 | 3.8 / 4.6 | 6.4 | 1.09 | 2.0 | 42.0 | 1.13 / 9.6 |
| (e) HEVC, black, quality 90 | 6.9 / 7.4 | 11.5 | 1.09 | 2.0 | 45.5 | 0.72 / 6.4 |
| (e) HEVC, quality 65, alpha quality 0.75 | 1.0 | 1.7 | 2.4 | 10.5 | 38.5 | 2.45 / 19.4 |
| PNG-in-MOV, lossless | 42.4 | 71 | ≈0 | 0.25 | 57.4 | 0.24 / 0.8 |

## What each option does
- **(a) Baseline:** 59.8 and 60.5 MB/s, which matches the ~55–60 MB/s you saw in the spike.
- **(b) Alpha bits and qscale:** 8-bit alpha keeps the 8-bit mask as it is (worst error 0.5 level).
  - The alpha plane alone costs 3.1 MB/s at 8-bit versus about 7.3 MB/s at 16-bit (measured against a no-alpha encode).
  - Raising qscale is the biggest lever; gains flatten out past 12–16.
- **(c) Crop:** the union bounding box of alpha > 0 is x 0–1080, y 332–1920 for 2b and y 333–1920 for 6b. The shoulders span the full width and reach the bottom.
  - The cropped file is 1080x1600 starting at y = 320.
  - `placeOnCanvas` (`packages/core/src/graphics/framing.ts:94-100`) would give scale 1, x 0, y −0.16667.
  - On its own the crop saves 9%. After black fill it saves only about 1.3%, because the cut-away part is already flat.
  - With a zoom, the overlay's position must be main position + main scale × (0, −0.16667) at every keyframe. For piece 6, y would run from −0.1667 to −0.1912. This is UNVERIFIED in CapCut.
- **(d) Black outside:** RGB is set to 0 only where alpha is 0, so nothing visible changes and the edge numbers are identical. It saves 24% at the default quality and 9–12% at qscale 8–12. A flat mean colour instead of black saves about 1% more.
- **(e) HEVC with alpha** (hevc_videotoolbox, quality setting, alpha quality 1, hvc1 tag):
  - The alpha survives. ffmpeg 8.1.2 decodes the file as yuva420p, and the alpha error is about 1 level at every quality.
  - Alpha quality 0.75 is visibly worse (worst 0.1% is 10.5 levels). The encoder's default alpha quality is 0.
  - At the same edge quality as ProRes qscale 12, quality 90 is about 29% smaller. Quality 80 is about 60% smaller with a somewhat worse edge.
  - Black fill and cropping do nothing for HEVC, because it only encodes changes between frames.
  - The bundled ffmpeg cannot make these files, and whether CapCut plays HEVC with alpha is UNVERIFIED (not tested).
- **(f) Lower resolution:** hair strands visibly soften. Edge sharpness drops to 0.949 of the original at 720p, and the alpha's worst 0.1% error is 32–37 levels. Rejected.
- **(g) Only while highlight text is on screen:** in draft 0917 the highlight text sits on the flag-0 text tracks (render_index 14005–14007, written by `packages/core/src/capcut/highlights.ts:204-219`). There are 5 groups, lasting 2.7, 2.73, 2.13, 2.83 and 1.47 s.
  - The limits come from `packages/core/src/highlights/placement.ts:132-137`: at least 1.2 s per group, a 0.2 s hold after the last word, at most 3 s for scene labels.
  - Coverage per piece is 43%, 17%, 67%, 67%, 93% and 41%. Overall that is 12.1 s out of 22.17 s (54.6%, with a one-frame lead per range), so writing only those ranges saves about 45%.

**Encode speed:** ProRes at qscale 8–12 takes about 0.15–0.35 s for 76–109 frames; HEVC takes about 1 s. Neither is a bottleneck.

**Visual check:** I looked at frame 41 zoomed 4x at the hair edge, over white and over yellow. The master, ProRes qscale 12 and 16, and HEVC quality 80 look the same. The 720p version is visibly softer.

## Recommendation
Ship ProRes 4444 with the bundled prores_ks as follows:
- Set RGB to black (or a flat colour) wherever alpha is 0.
- Use `-alpha_bits 8`.
- Use `-qscale:v 12`, or 8 for extra safety margin.
- Convert with `scale=out_color_matrix=bt709:out_range=tv` and tag the file BT.709.
- Write the overlay only for the highlight-text ranges, each starting one source frame early.

That gives 9.75–10.35 MB/s, about 16–17% of the baseline, with alpha error of 0.19 level (worst 0.5) and RGB at 45 dB, well above the 38 dB of a typical export. Over draft 0917 that is about 12.1 s × 10 MB/s ≈ 122 MB instead of about 1.33 GB (roughly 9%).

Skip the crop for talking-head shots: after black fill it saves only about 1.3%, and it would require rewriting the zoom keyframes. Reconsider it for wide shots.

HEVC with alpha is a possible later step for another 30–60%. It needs either a rebuilt ffmpeg with VideoToolbox or an AVAssetWriter path in the Swift helper, plus a CapCut playback test. Neither is done (UNVERIFIED).

## Side findings
- **The spike's masks are one frame behind the picture.** `render-person.sh:17` extracts the JPEGs with `-fps_mode passthrough`, while `:21-23` builds the overlay with `setpts=N/30/TB` and pairs frame n with mask n.
  - JPEG #1 is exactly the source frame just before the overlay's first frame. JPEG #k matches overlay frame k−1 at 38.6–39.0 dB, against 31–34 dB for overlay frame k.
  - So in the spike's overlay, each mask sits on the picture one source frame after the one it was computed from, and the mask lags by one frame.
  - My masters use the correct pairing, starting one frame before the piece. Whether this is linked to the "start one source frame early" placement in the spike is UNVERIFIED.
- **Colour tags:** from RGBA input, the spike's settings write a ProRes file with no colour tags, converted with BT.601. Decoded as BT.601 it measures 60.8 dB; decoded as BT.709, 43.9 dB. How CapCut reads an untagged file is UNVERIFIED.

Nothing was written under ~/Movies, ~/Library or the repo, and nothing was imported into CapCut. The encoded files are in `enc/` (3.0 GB); `work/` holds the uncompressed masters (5.7 GB) and can be deleted.

Everything is in `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/cutout/explore/size/`:
- table-piece2b.csv
- table-piece6b.csv
- results-piece2b.jsonl
- results-piece6b.jsonl
- bbox.json
- coverage.json
- look/piece2b-f41-edge.png
- look/piece2b-f41-zoom.png
- enc.py (encodes and measures)
- enc/piece2b/, enc/piece6b/, enc/ref/ (encoded files)
- work/ (masters)