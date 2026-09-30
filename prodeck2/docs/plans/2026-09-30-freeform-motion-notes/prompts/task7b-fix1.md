# Task 7b, fix round 1

Both reviewers approved the task, and the controller ran the built app with the real Claude on the clip that had got no graphic: three graphics above the head, three of five text groups marked `มีกราฟิกแทน ไม่ขึ้นในคลิป`, the write sheet saying two groups and three graphics. These are the things to mend. For each that changes behaviour, write the test first and watch it fail.

## 1. Subtitle lines left stale by a setting not yet saved (`room/ClipRoom.tsx`)

With "hide words under text" on, the lines are read under the saved settings, and their re-read is triggered by the preview, which is asked with the settings on screen. `changeFlair` and `changeHighlights` send the save, then the preview is asked; when it lands with another set of replaced groups, the lines are asked. If the save has not landed by then, the lines come back for the old settings, and nothing reads them again. The write, which uses the settings on screen, then either refuses ("the subtitles changed since they were shown") or, when the count of lines happens to match (it can: hiding a word may leave the count as it was), lays the old texts by index: a word shown twice, or in neither text nor subtitle. Before this task those settings could not leave the lines stale.

The level already has a guard (`levelUnread`, `levelSaved`, `levelVersion`): the lines are not read while a changed level is unsaved, and are read once it has landed or been put back. Widen that same guard:

- in `changeFlair`, a change of the graphics switch or of the text switch counts as the level does;
- in `changeHighlights`, a change of the position does, with a `saved` callback as the level has;
- the ref becomes a set of what is unsaved (the flair, the highlights), so that one save landing cannot release the other.

Test (PostScreen or the room): with the hide setting on, `updateSettings` held open, the graphics switch flipped: no lines are read until the save lands, and then they are read once. The same for the position.

## 2. Tests that depend on the clock

One test of the suite failed once in eight full runs, on the first run after the machine had stood idle. The likeliest, in order:

- `main/flair-plan.test.ts`, `soonAfter` (three uses): it races the stopped work against a real 300 ms timer, and the work ends through real file writes in a temp folder. Drop the timer: await the work's outcome before the held step is let go (the held step cannot have ended, so "at once" is still proved, and a hang meets the test's own timeout).
- The renderer's tests wait with Testing Library's default of one second. Give the renderer's tests one setting of `asyncUtilTimeout: 5000` (a setup file of the renderer project, or the top of the shared test room), so a cold start does not fail a `findBy` or `waitFor`.
- Three new main tests build many whole fixtures under the default five seconds: the nine-fixture test in `highlights.test.ts`, the seven-write test in `timeline.test.ts`, and the long one in `post-flow.test.ts`. Split them with `test.each`, or give each a timeout of 20 seconds.

## 3. Carried over from Task 7 (`prompts/pending-for-task7b-fix.md`)

- `flair.ts`, the plan's merge: `gone` is every stored graphic that is not in the new list (today it still filters on `!graphic.edited`, so Claude's sounds on an edited graphic of another kind stay when that graphic goes). One cue added to that merge's test.
- The same merge throws on a `null` entry of the stored list (`graphic.edited` of null). An entry that is no graphic at all (what `graphics-cues.ts` skips) is left out of the merge, and so goes. Same test.
- `apps/desktop/scripts/release-check.ts`: the stray message says "beside host.js" even when `host.js` is absent. Say "in resources/graphics".

## 4. Dead code and names

- `GraphicSentence.textBand` is filled and nothing reads it. It goes, with `textBandOn`, the `bands` parameter of what fills it, and the half of the comment that speaks of it (`packages/core/src/graphics/motion/points.ts`, `apps/desktop/src/main/graphics-cues.ts`).
- `isDrawn(cue)` in `graphics-cues.ts` (a stored entry the app can draw) sits beside `drawn` and `drawnGroups`, which mean groups not replaced. Rename the first so the two meanings do not share a word.

## 5. Tests that do not pin what they say

- `highlights.test.ts`, the test that says the graphics are worked out once: it asserts things that held before the task. Make it fail when `graphicsOn` runs twice in one preview (count the calls of something only it makes, such as the place or the bands being asked).
- Not pinned at all: the polish after a graphics work that was stopped (failed and skipped are); a cutaway or a punch zoom on a replaced group's line in the write (only the sound is). One test each.

## Not to change

- The dim of a replaced row.
- `subtitles()` asking the graphics through `graphicJobs` (the second compile when hide and graphics are both on).
- The double read of the lines on open.
- Text bound to no point not being told to the planner.

## Working conditions

Nobody else is changing the repo. The gate stands at 155 files, 2512 passed, 3 skipped, typecheck clean. End with `npm test` and `npm run typecheck` from the repo root, and run `npm test` three times over at the end to see it steady.

## Report

What changed for each item, what you saw fail first for each new test, the final counts, and the files changed.
