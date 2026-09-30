You are implementing Task 7 of the BOXBLACK 0.5.0 plan: "The old kit leaves; old graphics are cleared once".

{{COMMON}}

Tasks 2 to 6 are done too: Claude plans and writes motion graphics, the renderer renders and inspects them, the main process places them and judges which are stale, the graphics work writes them three at a time with one repair, and the screen shows each piece's state with a redo. The kit of cards and stickers, its emoji pictures and its planning prompt are still in the repo beside all that, unused by the graphics work. This task takes them out, and clears the graphics that old projects still hold.

## Your task, as the plan has it

{{TASK}}

## What is already decided (do not re-decide these)

- **Two jobs, in this order, each ending green:** first the one-time clean-up (Steps 1 and 2), which adds code and tests; then the removal (Steps 3 and 4), which the compiler leads.
- **The clean-up of 0.5.0** is a second upgrade beside M25's (`withoutOldEffects` in `apps/desktop/src/main/post-cleanup.ts`):
  - It applies to an outline whose `postVersion` is 1 (and, after M25's own upgrade has run in the same read, to one that had none). It takes out every stored graphic that is not a motion piece, the ones the user edited too (the user chose this on 2026-09-30: the kit is gone, and a backup is kept), keeps any motion piece, and stamps `postVersion: 2`. An outline already at 2 comes back as the same object.
  - Claude's unedited sounds that only a removed graphic held go with it, by the logic `flair.ts` already has for a removed graphic (`startMoment`, `withoutSoundsOn`, `heldMoments`); if those are private to `flair.ts`, move them to where both can use them rather than copy them. Highlight groups, looks, zooms, cutaways, edited sounds and every other sound stay.
  - `POST_VERSION` becomes 2, and a new outline from the planner is stamped with it.
- **The store runs upgrades as steps.** `ProjectFiles` (`project-files.ts`) takes an ordered list of steps, each an upgrade with its own backup folder, in place of the one `upgrade` and `backupDir` (keep the single-upgrade form working if other stores use it; look before you change the type). For a file on disk, the steps run in order on what the step before gave. The file as it is on disk is copied, before the first write, into the backup folder of the first step that changed it, and into no other: an outline from before M25 goes to `outlines-before-m25` only (that copy is its way back past both steps), an outline at version 1 goes to `outlines-before-050`. A copy that is already there is never written over, and nothing is written when the copy cannot be made, as today. `index.ts` wires the two steps; the new folder is `join(userData, "outlines-before-050")`.
- **After this task `GraphicSpec` is `MotionSpec`.** Code that read the union loses its branches; `isMotion` stays only where stored data is read, because an outline file is outside the type system: a stored graphic whose `kind` is not `"motion"` (a file edited by hand, a future kind) is left out where graphics are read for placing, neither placed, listed, nor counted as dropped. One test.
- **The removal follows the plan's list.** Delete a type, then remove every branch the compiler flags; do not adapt the kit's code to the new types. What goes to the Trash goes with `mv <path> ~/.Trash/<name>-0930` (the emoji folder is about 54 MB of pictures: move the folder whole, in one `mv`). Tests that only tested the kit go with it; tests of generic behaviour that used a card as their fixture (placement, the write, the preview, sounds on a graphic) are kept and given a motion fixture, not deleted: say in your report which tests you moved to a motion fixture and which you removed, by count per file.
- **What stays, because it is not the kit's:** `packages/core/src/graphics/plan.ts`'s generic parts (`GraphicCue`, `GraphicBox`, `enforceGraphics`, the length limits, `PlacedGraphic`), `framing.ts`'s `stageBox`, `placeOnCanvas`, the dodge helpers and `mergeBands`, the word matching and the frame helpers of `graphics/direct.ts` that `motion/direct.ts` imports (move them into `motion/direct.ts` or a small module beside it if nothing else of `graphics/direct.ts` is left, and delete the file), `capcut/graphics.ts`, the renderer pack and everything about it, `graphics-files.ts`, the fonts.
- **`GraphicPatch`** becomes `{ off?: boolean }`; `GraphicsProblem` loses `"emoji"` (its `kind` may then go altogether if only one value is left: keep the field if removing it would ripple through the renderer's texts, and say which you did); `GraphicView` loses `storedMotion`. The emoji problem banners and their i18n keys go from the renderer; the renderer's emoji problem in the graphics renderer (`emojiProblem`, `EmojiPicturesError`) goes.
- **`release-check.ts`**: the emoji checks go; a new check fails the release when `apps/desktop/resources/graphics/host.js` is missing or empty. `electron-builder.cjs` keeps copying `resources/graphics`, which now holds `host.js` alone.
- **Docs are not yours**: the controller does Task 8 (version, specs, the install guide). Do not change the version number.

## Other implementers

Nobody else is working while you do. This task touches `packages/core`, `apps/desktop/src/{main,shared,renderer}`, `apps/desktop/resources/graphics` and `apps/desktop/scripts`.

## Before you begin

If anything about the requirements, the approach or the code is unclear, ask now, before you write code. It is always fine to stop and ask.

## Your job

1. Write the tests of the clean-up first and watch them fail; then the code.
2. Then the removal, led by the compiler; run the tests as you go.
3. The searches of Step 4, with their results in your report.
4. `npm test` and `npm run typecheck` from the repo root.
5. Review your own work with fresh eyes, and report.

If the removal pulls at something the plan did not list, or a generic behaviour turns out to depend on the kit, stop and report `BLOCKED` or `NEEDS_CONTEXT` with what you found rather than improvise.

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented, step by step
- What you saw fail before the code (red) for the clean-up, and the final results of `npm test` and `npm run typecheck` (the counts, and how many tests went with the kit)
- Files changed, files moved to the Trash (each with its new name there)
- The results of the Step 4 searches
- Anything you decided that the task did not spell out, and why
- Self-review findings and any concerns
