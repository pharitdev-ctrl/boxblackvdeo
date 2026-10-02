You are implementing Task 6a of the BOXBLACK 0.8.0 plan "Free zoom": Main wiring, part one (planning, order, sounds, API).

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first, then `r080-notes-for-task5.md` beside it (its lines "For Task 6" bind you).

Your work is "Task 6" in `docs/plans/2026-10-02-free-zoom.md`, **Steps 1, 2, 6 and 7 only**, plus moving `MoveView` and storage. Steps 3, 4 and 5 (text and graphics avoiding the zoomed face, the timeline write) are Task 6b, done after you by someone else: do not do them.

## Done before you (read, do not change their behaviour)

- `packages/core/src/flair/moves.ts`: `MoveCue`, `isMove`, `zoomCap`, `checkMove`.
- `packages/core/src/flair/direct.ts`: `TechniqueClip`, `TechniqueScene`, `PlannedMove`, `planTechniques`, `describeTechniques`, `acceptTechniques`. Main's `planTechniques` in `apps/desktop/src/main/flair.ts` is a stub marked for Task 6 (`words: []`, `pieces: []`, `scenes: []`, legacy zooms answered as `[]`).
- `apps/desktop/src/main/move-cues.ts` (Task 5): `movesInForce`, `PlacedMove`, `OffMove`, `MoveView` (to move into `shared/api.ts` now, exact fields), `moveViews`, `legacyZoomsBeside`, `faceBoxesIn`, `faceBandIn`. Read its doc comments.
- `FootageClip.width?`/`height?` are loaded (Task 5).

## What you do

1. **Step 1, planning**, as the plan says, with:
   - the face rule from the notes: a clip whose objects carry `face` on no object gets `face: true` on its keep objects before `describeTechniques` sees them;
   - `count` and `dropped` as the plan says, `dropped` including `movesInForce`'s drops on the new moves;
   - rewrite the main tests the notes name (titles about Claude's zooms) around moves, and fix their stale comments.
2. **Storage.** `StoredOutline.flair.moves?: MoveCue[]` in `shared/api.ts`. Do for `flair.moves` what is done for `flair.zooms` in `emphasis.ts`, `planner.ts`, `legacy-beats.ts`, `post-cleanup.ts` (and any other place `grep -n "flair.zooms\|zooms:"` shows in main, except `timeline.ts`, `highlights.ts` and `highlight-state.ts`, which are 6b's). Say what each place does with them.
3. **The preview list.** `HighlightPreview.moves: MoveView[]` in `shared/api.ts`, filled in `highlights.ts` from `movesInForce` + `moveViews`. Only add the list and its computation there; the face band and `keepIn` changes in `highlights.ts` are 6b's. Legacy zooms on a piece with a kept move leave the preview's zooms in force (`legacyZoomsBeside`). `fake-api.ts` gets `moves: []` where previews are built.
4. **Step 2, order**, as the plan says.
5. **Step 6, sounds**, as the plan says. The sound plan's `moves` come from the moves in force (the same `movesInForce` call) plus legacy punches as "zoom punch".
6. **Step 7, the API**, as the plan says, mirroring `redoGraphic`/`editGraphic`/`undoGraphic`/`setGraphic` and their tests. `setMove(folder, anchor, null)` removes a move (as the graphic one does). Insert moves are found by their anchor with `insert: true`.

## Working conditions

Nobody else is working on the repo. You own all of main, `shared/api.ts`, `renderer/test/fake-api.ts`, and `packages/core/src/sound/plan.ts` (+tests), except `timeline.ts`, `highlight-state.ts`, `graphics-cues.ts` (6b's) and the renderer's own UI (Task 7). If a renderer type error appears because `HighlightPreview` gained `moves`, fix only the fixtures, not the UI.
