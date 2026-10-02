You are implementing Task 7 of the BOXBLACK 0.8.0 plan "Free zoom": Renderer: move rows.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first, then the lines "For Task 7" in `r080-notes-for-task5.md` beside it.

Your task is "Task 7" in `docs/plans/2026-10-02-free-zoom.md`, Steps 1 to 5. The Thai texts in its table are copied verbatim.

## Done before you (read, do not change main)

- `apps/desktop/src/shared/api.ts`: `MoveView`, `HighlightPreview.moves`, `MoveAnchor` (`CueAnchor & { insert?: boolean }`), `DesktopApi.redoMove/editMove/undoMove/setMove`, `WriteResult.dropped.moves`.
- Main's refusal messages for moves: find them in `apps/desktop/src/main/flair.ts` (redo/edit/undo/set move) and `highlight-api.ts`, and map each in `MAIN_WORDS`. `editFailed` texts are English from main, as for graphics; show them as graphics do.
- The pattern to mirror: `GraphicList.tsx`, `GraphicTab.tsx`, their tests, `ClipRoom` `redoGraphic`/`editGraphic`/`undoGraphic`/`setGraphic`, the `rewrite` marks with `of: "graphic"`.
- The API anchor: always send `{ ...view.anchor, insert: view.insert }`.

## Decisions the plan left open

- The list shows kept and off moves only, as `HighlightPreview.moves` gives them. Claude's moves that fail their checks are stored but not listed: accepted.
- Legacy zoom rows: one row per `ZoomView` the preview still lists, with ปิด and ลบ only, through `setZoom` as today. Find what the old zoom section called to switch and remove a zoom, and keep exactly those calls.
- Where the write sheet's zoom line counts, use moves that play plus legacy zooms in force. Check `WriteButton` tests for the line's text and keep its wording.
- Check the techniques tab at 900 px wide in the existing layout tests if any exist; do not run the app.

## Working conditions

Nobody else is working on the repo. You own `apps/desktop/src/renderer/**` and its tests. Do not touch main, shared, or core; if something there is missing, stop and report NEEDS_CONTEXT.

## Also (from Task 6b)

- `WriteResult.dropped.moves` exists, but `DROPPED_NAMES` in `edit/writeEnd.tsx` is typed to leave `moves` out, since the existing toast reason ("less than a frame left") is wrong for moves the checks turned down. Add a Thai line for it and include moves in `DROPPED_NAMES`: `ท่าเคลื่อนภาพ {count} ท่าไม่ได้ใส่ เพราะภาพจะเห็นขอบหรือหน้าหลุดจอ` (verbatim). Restore the test "DROPPED_NAMES names every kind" to cover moves.
- `zoomsLost` now also counts moves whose word or cutaway is gone; keep its existing copy.
