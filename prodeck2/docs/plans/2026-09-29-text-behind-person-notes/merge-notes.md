# Merge notes for docs/plans/2026-09-29-text-behind-person.md (state when the usage limit hit)

Done: part-A.md (Tasks 1–6), part-B.md (7–8), part-C.md (9–11), part-E.md (16–19), all in this folder.
Still running when the limit hit: Part D (Tasks 12–15) → part-D.md. Check whether the file exists before relaunching.

## Reconcile when merging
1. **Dep key names.**
   - Part C uses `TimelineDeps`/`HighlightDeps` keys `cutouts?`, `probes?`, `cutoutsReady?` and `cutoutsDir?`.
   - Part D was told `sourceProbes`. Pick C's names and fix D.
   - `cutoutsReady()` must be awaited before `hashOf`.
2. **SampleMask.**
   - Task 10 Step 0 creates `cutout/occlusion.ts` with only `SampleMask` and adds the export.
   - Task 14 must extend that file, not overwrite it.
   - Part A's Task 6 cutout/index.ts has no occlusion export: C adds it.
3. **Colour tags.** Put `-color_primaries/-color_trc/-colorspace/-color_range` BEFORE `-i -` in Part C's encode args. Found by Part B: as output options, the bundled ffmpeg leaves primaries and transfer unset. Always tag `tv`.
4. **Person material duration.** Use `RenderedPerson.durationUs` (C: floor(frames × 1e6 / 30)); do not recompute.
5. **`dropped.cutouts`.** Part D must count it itself, per group: pieces overlapping the window minus that group's ranges. `cutFrames([])` throws, so guard empty plans in the preview.
6. **Imports.** The renderer must not import `@boxblack/core/cutout` (it pulls in node:crypto). Keep `COVERED_LIMIT` in main or shared.
7. **Two helper lookups.**
   - Part B: `main/segment-helper.ts` `segmentHelperIn`, `BUNDLED_SEGMENT`, `ToolPaths.segment`, core `segmentVersion`.
   - Part C: `shippedProgram`/`segmentVersionOf` in cutout-probe.ts.
   - Prefer B's resolver plus core `segmentVersion`, and drop C's duplicates, or keep them consistently.
8. **Part E additions:**
   - `DesktopApi.moviesFreeBytes()`, `freeBytesAt(path)`, `HighlightPicture`
   - HighlightTab props `behindPerson` and `onRetryCutout`; LookPopover props `looks` and `behindPerson`
   - i18n `write.cutoutGoing`, `write.cutoutFailed`, `write.cutoutSpaceLow`, `tools.segmentMissing` (B)
9. **Typecheck order.**
   - Tasks 12–15 add required fields: renderer fixtures (fake-api, `PostScreen.test.tsx` `FLAIR_ON`, `WriteScreen.test.tsx`) and `DROPPED_NAMES` need minimal values in those tasks.
   - Suggestion: Task 15 adds `DROPPED_NAMES.cutouts` with a temporary key.
10. **Mutation lists.** Part E's entries marked ADAPT need their final code anchors after Part D lands.
11. **Missing helper.** It means normal placement and drawn in front (spec §12), not top.
12. **Spec text.** Spec §7.1's CLI (`masks --frames`) is superseded by the contracts' CLI. The docs task updates the spec.
13. **cutout event noise.** Task 10 must send no event when `ensure` starts nothing, or the ClipRoom 500 ms re-read loops.
14. **Edit-listed sources.** The helper applies edit lists (B). What CapCut does with them is unmeasured: add this to the spec's risks.

After merging: self-review (spec coverage, placeholders, type consistency), then send a consistency-review agent over the merged plan, fix, and hand it to the user.
