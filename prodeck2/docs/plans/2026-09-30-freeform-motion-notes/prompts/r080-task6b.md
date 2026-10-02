You are implementing Task 6b of the BOXBLACK 0.8.0 plan "Free zoom": Main wiring, part two (text and graphics avoid the zoomed face; writing moves).

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first, then `r080-notes-for-task5.md` beside it.

Your work is "Task 6" in `docs/plans/2026-10-02-free-zoom.md`, **Steps 3, 4 and 5 only**, then Step 8. Steps 1, 2, 6 and 7 are done (Task 6a): the moves are planned and stored in `flair.moves`, `HighlightPreview.moves` is filled, the API exists.

## Done before you (read)

- `apps/desktop/src/main/move-cues.ts`: `movesInForce`, `PlacedMove` (`poses` already trimmed, `startUs` from the piece's start, `cut` or `insertIndex`), `legacyZoomsBeside`, `faceBoxesIn`, `faceBandIn`. Read every doc comment.
- `packages/core/src/capcut/moves.ts`: `addMoves`, `TimelineMove`, `zoomsBesideMoves`. `TimelineInsert.poses?` in `capcut/inserts.ts`.
- `movesOnCut` in `move-cues.ts` (added by 6a) is the shared entry point that builds `movesInForce`'s input and returns the moves and the inserts in force; `highlights.ts` computes `moved` early in `view()` for you to reuse. Use `movesOnCut` in the write and the graphics room too, never a second way of building the input.
- `faceBoxesIn` and `faceBandIn` take `at` as their last argument.

## Decisions the plan left open (follow these)

- `placementOf`'s `faceBand` replaces the scene `keepClear` union only when it returns a band; null means "no face known", the old behaviour for that group.
- The preview, the graphics room and the write must use the same moves in force, built from the same inputs, so the text sits where the preview showed it.
- In the write, pass only the moves `addMoves` would keep to `zoomsBesideMoves`, or rely on it ignoring moves with no poses; legacy zooms on other pieces still go through `addZooms`. `WriteResult.dropped.moves` counts `movesInForce`'s drops plus `addMoves`'s.
- The order in the write: `addMoves` before the overlays, as `addZooms` runs now.

## Working conditions

Nobody else is working on the repo. You own `highlight-state.ts`, `highlights.ts` (face band and `keepIn` only), `graphics-cues.ts`, `timeline.ts`, `flair.ts` (`keepIn` only) and their tests, plus `shared/api.ts` for `WriteResult.dropped.moves` (and the renderer fixture that builds a `WriteResult`, if typecheck needs it).
