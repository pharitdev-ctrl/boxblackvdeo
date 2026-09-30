Findings below. I changed no repo files and ran no tests or builds. I did not open any draft other than 0917, and I opened 0917 read-only. My only file is a read-only comparison script: `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/cutout/explore/keys.mts`.

Repo root is `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`. Paths are relative to it. "Spike dir" is `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/cutout/vision/`.

## 0. Write pipeline order (`apps/desktop/src/main/timeline.ts` `writeNow`)
1. Checks that CapCut is closed (403).
2. Waits for the graphics renders, all before the draft is read (407-435).
3. Checks CapCut is closed again (437).
4. Loads the draft and checks `expectedSegments` (439-443).
5. `buildRoughCut` (446). `at(cut, src)` is computed from the written main segments (448-450).
6. Subtitles (460-469).
7. Highlight text (475-520).
8. `addZooms` (531-532).
9. `addInsertTrack` (536-537).
10. `addGraphicTrack` (540-569).
11. `addSoundTrack` (572-573).
12. Bin prune and add (579-580), `backupDraft` (581), then `writeDraft` with the `bin` callback (582-585).

Every writer only appends to `tracks[]`. Nothing ever reorders, splices or sorts it. The only assignments are at `rough-cut.ts:67`, `subtitles.ts:45`, `highlights.ts:229`, `overlays.ts:75` and `sounds.ts:181`.

## 1. Track order and render_index
The `tracks[]` a full write produces, in order:

| # | Track | Source | render_index | track_render_index |
|---|---|---|---|---|
| 0 | main video, `flag 0` | `rough-cut.ts:67`, `templates.ts:15-17` | 0 (`templates.ts:246`) | 0 |
| 1 | subtitles, text `flag 1`, one track | `subtitle-templates.ts:14` | 14000, hard-coded (`subtitle-templates.ts:188`) | 1, hard-coded (`:197`) |
| next | highlight bars, sticker tracks | `highlights.ts:199-209` | `13000 + base + i` | `base + i` |
| next | highlight text, text `flag 0`, one per line index | `highlights.ts:210-221` | `14000 + trackIndex` | `trackIndex` |
| next | cutaways, video `flag 2`, one per lane | `overlays.ts:74` | `8 + trackIndex` (`inserts.ts:31`) | `trackIndex` |
| next | graphics, video `flag 2`, one per lane | `overlays.ts:74` | `1000 + trackIndex` (`graphics.ts:22`) | `trackIndex` |
| last | sounds, audio tracks | `sounds.ts:180` | 0 (`sounds.ts:135`) | `tracks.length + lane` (`:144`) |

- For highlights, `base` is `tracks.length` at call time (`highlights.ts:198`).
- For overlays, `trackIndex = out.tracks.length + lane` (`overlays.ts:39, 63-64`).

**Conflict:** a verified memory fact says CapCut layers by `tracks[]` order, not render_index. A copy at the end of the list covered the subtitles although its render_index (13600) was below theirs (14000). Source: memory `capcut-draft-format-facts.md`, "Layer order follows the order of `tracks[]`".
- The code comments and tests assume render_index decides the order: `graphics.ts:21`, `inserts.ts:30`, `overlays.ts:62`, `graphics.test.ts:219-220`, `timeline.test.ts:722-723`.
- If the memory fact holds, then today subtitles (index 1) draw under the highlight text, and cutaways and graphics draw over both. I did not check the visual result myself (UNVERIFIED this pass).

Draft 0917 as it is now matches this shape (read-only): main, subs (1), sticker ×3 (13002-13004), text ×3 (14005-14007), graphics `flag 2` (1008), audio ×3.

## 2. Highlight text: timing, lanes, and the map back to main pieces
**Placement** (`packages/core/src/highlights/placement.ts`):
- `PlacedLine` holds `cut` (index into `plan.cuts`) and `sourceUs` (32-43).
- `PlacedGroup` holds `lines` plus `end: {cut, sourceUs}` (45-54).
- A group's lines must stay in one beat, but they can span several cuts of it (114).

**Timing** (`timeHighlights`, placement.ts:153-170):
- Line start = `at(line.cut, line.sourceUs)`.
- Group end = min( max(lastWord + 200 ms, start + 1.2 s, lastLineStart + 1.0 s), next group's start, timeline end). Constants are at 132-137.
- A scene label ends at min(end of its stretch, start + 3 s).
- The end is not bounded by the piece or the beat, so text can run into the next main piece(s).

**Clock used at write:** `at` = `seg.target.start - seg.source.start + sourceUs` from `info.tracks[0].segments[cut]` (`timeline.ts:448-449`), after frame rounding.
- The preview uses `timelineOf` instead, which is before rounding (`apps/desktop/src/main/highlight-state.ts:192-196`).
- Groups are rebuilt at write (`timeline.ts:476`) and must match `highlights.groupCount` (477-479).

**Writer** (`capcut/highlights.ts:148-231`):
- Line *n* of every group goes on slot/track *n*. These are shared lanes by line index, not `laneOf`.
- `startFrame = max(round(line.startUs), slot.endFrame)` and `endFrame = min(round(group.endUs), lastFrame)` (160-166). Every line of a group ends at the group's end.
- Segment: `captionSegment` with the clip scale and transform taken from the layout (174-176).
- Bars go on separate sticker tracks, all below every text track (197-209).

**Mapping a group to main pieces:**
- Main piece *i* = `info.tracks[0].segments[i]`, where *i* = `PlacedLine.cut` (rough-cut.ts:33-63 writes one segment per cut, in order).
- Source range: `{frameToUs(startFrame), …}` on frames (rough-cut.ts:40-44, 58). Target ranges are gap-free (59).
- `TimedGroup` keeps only `groupId`, `startUs`, `endUs` and `lines` (placement.ts:139-145). The cut index must be recovered through `placed` by `groupId` (`timeline.ts:485`).
- Because the end is extended past the last word, the pieces a group covers should be found by overlapping target time, not by `PlacedGroup` cuts.

## 3. Overlay video segment (`capcut/overlays.ts:27-77`, used by inserts and graphics)
**Material:** `videoMaterial(newId(), file)` (templates.ts:19-154), then `type` = photo or video and `has_audio: false` (overlays.ts:43-45).
- `path` = absolute file path (templates.ts:25).
- `duration` = the file's µs.
- `width` / `height` = the file's size.
- `material_name` = basename.
- `local_material_id` = bin id (116).
- **There is no alpha field.** The template and 0917's graphic material have the same 68 keys, and none is about alpha except `matting.flag 0`, so CapCut must detect the alpha from the file. CapCut's re-save of the spike added only `is_video_copilot_aigc_content`.

**Segment:** `videoSegment` (templates.ts:214-282) with:
- `source {start: 0, duration}` and `target {start, duration}` on frames (overlays.ts:40-41, 49-55).
- `speed` 1.0 (228).
- `volume` 0, `last_nonzero_volume` 1.
- `clip.scale` = `{place.scale, place.scale}`, `clip.transform` = `{place.x, place.y}` (57-65).
- `uniform_scale` on, `common_keyframes: []`.
- Six extras in `extra_material_refs` (templates.ts:161-212): speeds, placeholder_infos, canvases, sound_channel_mappings, material_colors, vocal_separations.

**Track:** `{type "video", flag 2, attribute 0, name "", is_default_name true}` (overlays.ts:74). Lanes come from `laneOf`, newest on top (lanes.ts:15-28).

**Graphics framing** (graphics.ts:42-56):
- start = `round(atUs)` in frames.
- end = min(round(atUs + dur), lastFrame, start + whole file frames).
- A graphic that overlaps a later one by a single frame gives up that frame.
- `atUs` = `played(graphic.atUs)` (timeline.ts:558).

**Bin:**
- `graphicBinItem` (bin.ts:12-34) with a lower-case UUID id (timeline.ts:129, 554-556). Added through `addBinItems` inside `writeDraft`'s `bin` callback (write.ts:98, timeline.ts:584).
- `pruneBinItems` (bin.ts:84-93) and the prepare-screen filter (projects.ts:73-77) both only recognise `/Movies/CapCut/BOXBLACK/graphics/` (bin.ts:40-45).
- The rendered file comes from `renderer.rendered(job)` → `{hash, path: <graphicsDir>/<hash>.mov, width, height, durationUs, place}` (graphics-render.ts:26-33, 180, 488-492). `graphicsDir` is `~/Movies/CapCut/BOXBLACK/graphics` (index.ts:230).

## 4. Zooms (`capcut/zoom.ts:83-120`)
- Takes the first `type==="video"` track (85), which is always main at index 0. One zoom per piece: a second zoom, a missing piece or a zero length is dropped (91-92).
- Keyframes: punch is 1 → 1.15 over 350 ms, drift is 1 → 1.08 over the piece (19-60).
- `time_offset = source_timerange.start + round(at × speed)` in **source time** (68-71, 94).
- `common_keyframes` = three lists: `KFTypeScaleX` (base × scale), `KFTypePositionX` (baseX), `KFTypePositionY` (baseY + faceY × (1 − scale)) (102-115).
  - Each list is `{id, material_id: "", property_type, keyframe_list}`.
  - Each point is `{id, curveType "Line", time_offset, left_control, right_control, values [v], string_value "", graphID ""}` (26-42).
  - There is no ScaleY; `uniform_scale` is on.
- The base values come from the piece's own `clip` (95-98).
- Inputs: `zoomsFor` (timeline.ts:307-325). `durationUs` is the plan's length before rounding, so a drift's last key can land slightly past the segment's source end. On 0917 piece 0: key at 7,240,000 vs source end 7,233,333.

**To copy onto a cutout piece:** give every list and every point a new id, copy `clip`, and rebase the time:
`t_overlay = (t_main − main.source.start) / main.speed × overlay.speed + overlay.source.start`.
Main speed is always 1 because the write rebuilds the whole timeline (templates.ts:228).

## 5. Subtitles
- `addSubtitleTrack` appends one text track, `flag 1`, right after the rough cut (timeline.ts:468 runs before highlights at 512), so it lands at `tracks[1]`.
- render_index 14000 and track_render_index 1 are fixed values (subtitle-templates.ts:188, 197). The clip sits at y −0.8 (184).
- Frames never overlap, blank captions are dropped, and one caption group id is used for all (subtitles.ts:18-47).
- Nothing puts subtitles last. They are "in front" only by the highest render_index, which the memory fact says CapCut ignores.
- The feature asks for the cutout above the highlight text but below the subtitles. That can't be done by appending: the subtitle track (or the cutout) must be spliced, and every later `track_render_index` renumbered.
- Cutaways must stay above the cutout, otherwise the person would show on top of a full-frame cutaway. Graphics above the cutout match the spike.

## 6. WriteResult, counts and readiness
**WriteResult** (`apps/desktop/src/shared/api.ts:809-841`):
- Counts: `captionCount`, `highlightCount`, `soundCount`, `zoomCount`, `insertCount`, `graphicCount`.
- `dropped{sounds, zooms, inserts, graphics}`.
- `zoomsLost`, `graphicsSkipped`, `emphasisCount`, `proLeftOut`.

**How the counts are filled:**
- Each writer returns `Written {info, kept, dropped}` (types.ts:134-138). `lay()` collects them (timeline.ts:523-528) and `tally()` turns them into the result (110-126).
- Caption and highlight counts come from text segments by flag (timeline.ts:588-594).
- `graphicsSkipped` counts files missing at write time (544-550).
- `DROPPED_NAMES` is typed over every key of `dropped` (WriteScreen.tsx:35), so a new kind must also be added there.

**Readiness in the UI:**
- `HighlightPreview.graphics[].render: GraphicRenderState` ("waiting" | "rendering" | "ready" | "failed", api.ts:381), plus `graphicsWaitForPack` and `graphicsProblem` (api.ts:710-719). These are filled by `graphicView` → `renderer.ensure` / `statusOf` (main/highlights.ts:290-325).
- WriteScreen computes `playing` / `rendered` / `failedRenders` / `finished` (92-96). It shows the row "กราฟิกเรนเดอร์จบแล้ว {done} จาก {total}" (189-195, i18n.ts:345-347). The row does not block the button; `canWrite` ignores renders (85-86).
- Main waits instead: `graphicJobs` → `renderer.wait` (timeline.ts:410-434). It throws if the pack is missing, the machine can't render, or a job was left unsettled.
- Events: `graphics` progress/done (api.ts:462-465, graphics-render.ts:417-421) and `timeline-write` (api.ts:467-469).
- One write per draft runs at a time (`alone`, timeline.ts:383-393). Cleanup of graphics files is held while a write runs, using `anyWriting`/`writesStarted` (index.ts:264-274). That cleanup only touches files named as 16 hex characters + `.mov` in `graphicsDir` (graphics-files.ts:10).

## 7. What the spike wrote (`write-vision.mts`, `swap-files.mts`, `swap-files-c.mts`)
**Words:**
- `addHighlightTracks` was run on two groups whose times equal the two main pieces' targets: piece 2 (segments[1]) and piece 6 (segments[5]). No animation.
- render_index was then overridden to `13500 + i` (write-vision.mts:43-55).

**Person material** (write-vision.mts:60-66):
- `videoMaterial` + `has_audio false`, path `~/Movies/CapCut/BOXBLACK/spike-cutout/pieceN.mov`.
- 1080×1920 hard-coded; duration = frames/30. The file is one frame longer than the segment: 2,533,333 vs 2,500,000.
- Bin entry made with `graphicBinItem`.

**Person segment** (write-vision.mts:68-81):
- `source {0, piece target duration}` and `target` = the main piece's `target_timerange`, copied exactly.
- `volume 0`, `clip` = the main piece's clip.
- `common_keyframes` = the main piece's, with new ids on every list and point.
- `render_index 1`.
- The track is `flag 2`.

**Track order and index** (write-vision.mts:85-89):
- Order: `[main, words text ×2, person, …everything else as before]`.
- Every segment's `track_render_index` was set to its track's position.
- Result (`vision-ids.json` order): main 0; words 13500/1 and 13501/2; person 1/3; subs 14000/4; stickers 13002/13003 (5, 6); highlight text 14004/14005 (7, 8); graphics 1006/9; audio 10, 11.
- CapCut's re-save kept all of it (`vision-reopened.json`).

**One frame early:**
- This is not in the write. The write always uses source start 0.
- It is in the render arguments, typed by hand: `render-person.sh piece2b 7.266667 2.5` for a piece with source start 7.3, and `piece6b 26.6 3.6` for source start 26.6333 (`cutout/explore/slice-bash.txt:143`).
- `render-person.sh` renders seconds + 1/30, i.e. piece frames + 1 (76 / 109 frames).
- `swap-files.mts` only repointed `materials.videos[].path` / `material_name` and the bin `file_Path` / `extra_info` to the b files. `swap-files-c.mts` did the same for the c files (guided filter + 1-2-3-2-1 masks from `final-masks.py`).

**Zoom copy:**
- The copy was taken when the main keyframes were still segment-relative (0 / 545000 / 895000). Because the overlay's source starts at 0, that happened to be correct.
- `export/fix-keyframes.mts` later moved only the main pieces to source time and left the overlay alone.

## 8. What the product path lacks for a cutout
1. **No way to insert a track mid-list or renumber.** `addOverlayTracks` only appends and computes `trackIndex` from the length (overlays.ts:39, 75). Subtitles are fixed at `tracks[1]` with track_render_index 1.
2. **No keyframe rebase.** A verbatim copy of today's source-time zoom keys onto an overlay whose source starts at 0 would be wrong.
3. **No frame-exact placement on a main piece.** The graphics path rounds `played(atUs)` and trims by file frames (graphics.ts:42-56). A cutout needs `target = main target` exactly and a file one frame longer. Choosing the file start from the actual source timestamps is manual today: the source frames sit at 7.301667 and 26.606667, not on a clean 1/30 grid (UNVERIFIED for variable-frame-rate sources).
4. **The cutout would show as user footage and never be pruned.** A file outside `/BOXBLACK/graphics/` appears as footage on the prepare screen (projects.ts:75-77) and is never pruned from the bin (bin.ts:91). Cleanup ignores it too (graphics-files.ts:10).
5. **No per-group lanes.** Text tracks are shared by line index, so while a cutout plays, every highlight line and bar in that window goes behind the person. There is no per-group choice.
6. **No kind for it in the result or preview.** `WriteResult.dropped` and `LaidKind` have no cutout kind, and there is no render state in the preview.
7. **No segmentation or mask filtering in the app.** Vision and the filtering exist only as spike tools: `segment` (Swift), `final-masks.py` (numpy/scipy), Homebrew ffmpeg.
8. **The bundled ffmpeg can only make ProRes.** It has `alphamerge` and all decoders. Its only video encoders are `prores_ks`, `png` and `mjpeg`, and `--disable-autodetect` leaves out VideoToolbox (`apps/desktop/scripts/build-ffmpeg.sh:37-40`). HEVC with alpha is not possible through it; that is the way around the ~55-60 MB/s file size.
9. **The spike itself** took no backup, hard-coded 1080×1920 and 30 fps, and assumed speed 1.