You are implementing Task 5 of the BOXBLACK 0.8.0 plan "Free zoom": Main: placement, views and the zoomed face.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first, then `r080-notes-for-task5.md` beside it (findings from earlier reviews that bind you).

Your task is "Task 5" in `docs/plans/2026-10-02-free-zoom.md`, Steps 1 to 5. `MoveView` in "Names shared across tasks" is defined in `shared/api.ts` by Task 6 later; define the view type in `move-cues.ts` with exactly those fields for now, and say so (Task 6 moves it).

## Done before you (read, do not change)

- `packages/core/src/flair/moves.ts` (Task 1): `MoveCue`, `Pose`, `isMove`, `poseAt`, `zoomCap`, `checkMove` with `MoveContext` (`{ canvas, cap, lengthS, faces, shown, card, base? }`, boxes in the picture's own shares, mapped through `base`), `faceAfter`, `centreAfter`, `covers`.
- `packages/core/src/capcut/moves.ts` (Task 4): `TimelineMove = { cut, startUs, poses }`, `addMoves`, `zoomsBesideMoves`. Read its doc comment: how a later move on a piece starts from the held pose. Your check must judge exactly what the writer will write.
- `packages/core/src/capcut/framing.ts`: `coverFraming`, `cardFraming` (cutaway bases), CapCut's units.
- `packages/core/src/flair/direct.ts` (Task 3): `PlannedMove` (not stored; Task 6 turns it into `MoveCue`).
- `packages/core/src/vision/objects.ts` (Task 2): `SceneObject.face?`.

## Facts from the code to mirror

- `composedInForce` (`composed-cues.ts`), `graphicsInForce` (`graphics-cues.ts`), `insertsInForce` and `itemPlaceOf` (`insert-media.ts`), `zoomsInForce`, `zoomSlotsFor`, `faceYOf`, `pieceKey`, `samePiece` (`zoom-cues.ts`), `keepClearAt` (`insert-media.ts`).
- **Main pieces' base framing.** Find how `timeline.ts` (and core `capcut` writers) set a main piece's `clip.scale` and `transform` when the video's aspect differs from the canvas, and use the same base in `checkMove` (no base when it simply fills the canvas). Say what you found. The canvas size comes from the same place the graphics writers take it.
- **Cutaways' base.** Use the same `coverFraming`/`cardFraming` call `addInsertTrack` makes, with the same inputs (fit, subject, keepClear), so the check sees what is written. A card's `card` box is `{ x0: 0, y0: 0, x1: 1, y1: 1 }`; for a cover cutaway, faces/shown are the picture's subject only if the code has one, else none.
- **The cap** comes from the clip's own width and height (Step 1). When they are unknown, use `zoomCap` as for a video the canvas's own size (1.3). Say so in a comment.

## Decisions the plan left open (follow these)

- **Seam in the check.** For each kept move on a piece after the first, run `checkMove` on its poses with the first pose replaced by the pose held at its start (unless its first pose is a `cut`), as the writer does.
- **Length.** `lengthS` is the played length after cutting at the piece's (or cutaway's) end. Return `startUs` from the piece's start, so Task 6 builds `TimelineMove` directly. Poses past the cut are trimmed for writing: keep poses with `s` below the length, plus one pose at the length sampled with `poseAt` when a pose was trimmed.
- **Faces fallback order** is the plan's: objects with `face`; else, if no object of that clip has `face` at all (an objects pass before faces), every keep box; else none for that scene; with no objects at all, the scene's `keepClear` band as a full-width box. Faces null when none of these gives a box.
- **Counting.** `dropped` and `lost` count moves that would play; an off move never counts, and keeps its `why` (or `lost`) for the view.

## Working conditions

Nobody else is working on the repo now. You own:
- `apps/desktop/src/main/move-cues.ts` and `move-cues.test.ts` (new);
- `apps/desktop/src/main/footage.ts` and its test;
- `packages/core/src/planner/footage.ts` (`FootageClip.width?`, `height?` only).
Do not wire anything into the plan, the preview or the write: that is Task 6.
