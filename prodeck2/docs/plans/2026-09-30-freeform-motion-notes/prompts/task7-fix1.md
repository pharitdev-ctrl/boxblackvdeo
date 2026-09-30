# Task 7, fix round 1

Both reviewers approved the task: the requirement is met, the removal is clean, the clean-up cannot lose the only copy of old data, placement of a motion graphic is unchanged over 6,000 random cases, and a motion render's hash is the same as before. These are the small things to mend. For each that changes behaviour, write the test first and watch it fail.

## 1. Stored data that is not what the type says

- **A malformed entry stops the clean-up for ever.** An entry of `flair.graphics` with no `spec`, with `spec: null`, a `null` entry, an entry with no `anchor`, or `graphics` that is not an array makes `withKitGraphics`'s step throw (`isMotion` reads `spec.kind`). The store swallows it: the file stays at version 1 with its kit graphics, nothing is written, no copy is made, and every read tries again. The project opens, but with graphics on the post page and the write fail with `Cannot read properties of undefined (reading 'kind')`. No version wrote such an entry, but a customer's file is outside our hands.
  - `isMotion` (`packages/core/src/graphics/plan.ts`) answers false for anything that is not an object with `kind: "motion"` (a missing or null spec included), and its parameter says it takes stored data of any shape.
  - The clean-up removes every entry that is not a motion graphic, whatever its shape (null, no spec, no anchor), takes the sounds of those that have a start moment, and treats `graphics` that is not an array as none. The copy is kept as for any other change.
  - One test with all five shapes: the file ends at version 2 without them, and the copy holds them.
- **An edited graphic of another kind in a version-2 file** (left by an older app run on data 0.5.0 had already cleaned, or by a hand edit) is invisible, cannot be removed, and silently holds its point: the plan's merge keeps every edited graphic as the user's own whatever its kind, while `existingGraphics` no longer tells Claude the point is taken, so Claude's answer there is thrown away uncounted. Decided: only a motion graphic is ever the user's own in the merge (`graphic.edited && isMotion(graphic.spec)`), so one of another kind goes at the next graphics plan, as Claude's own would. One test.
- **A file that is JSON but no outline** (`42`, `"x"`, `[]`, `{}`) is "cleaned" into `{ postVersion: 2 }` with a copy of the junk in `outlines-before-m25`, and `get` hands out an object with no outline. `read` in `project-files.ts` takes only what `readOne` takes (an object with a string `folder`); anything else is as a file that cannot be read: null, untouched, no copy. One test. (If another store relies on `read` accepting any JSON, stop and say so.)

## 2. Tests

- `timeline.test.ts`, "a graphic whose render failed is left out and counted": it asserts only `graphicsSkipped: 1`, which an unwritten or stale graphic gives too, so a fixture that drifted stale would leave it green. Assert also that the renderer was waited on for that one job.
- `post-cleanup.test.ts`: no test has a kit graphic that shares its start moment with a kept motion graphic (the kept graphics are what holds a moment, and the tests would pass with none). One case: the sound on that moment stays.
- `flair-plan.test.ts`: two test helpers still branch on `isMotion(job.spec)`, a render job's spec, not stored data. Drop the guard.

## 3. Leftovers

- `post-cleanup.ts`, the comment on `withoutOldEffects`: it still says `postVersion` becomes `POST_VERSION`; it becomes 1.
- `packages/core/src/graphics/motion/points.ts`: `Scope.startTimelineUs` is written and never read. Take it out, with the three assertions in `points.test.ts` and the line in `motion/direct.ts` that sets it. The comment that says "what it is made of" belongs to the kit: reword.
- `packages/core/src/graphics/framing.ts`: `KEEP_CLEAR_GAP` is exported and nothing imports it.
- `packages/core/src/flair/sound-plan.test.ts`: the fixture text `สติกเกอร์ 🚀 ขึ้น` is something the app no longer says; use what a motion graphic's slot says (`กราฟิกขึ้น: …`).
- `graphics-host.test.ts`: a stand-in promise named `kit`.
- `apps/desktop/scripts/release-check.ts`: `resources/graphics` is shipped whole, so anything put back beside `host.js` (the old `emoji` folder is 55 MB) would ship silently. The check refuses a build when the folder holds anything but `host.js` (`.DS_Store` aside), naming what it found. Tests beside the `host.js` ones.

## Not to change

- Sounds on a removed kit graphic that the user had edited go with it, as you decided.
- `GraphicView.spec` stays as it is.
- The timing idiom of the negative assertions in `flair-plan.test.ts`.
- The duplicate pairs of placement tests.

## Working conditions

Nobody else is changing the repo while you work. Since your hand-in, one small round touched `room/ClipRoom.tsx` and two renderer test files only. The gate stands at 155 files, 2478 passed, 3 skipped, typecheck clean. End with `npm test` and `npm run typecheck` from the repo root.

## Report

What changed for each item, what you saw fail first for each new test, the final counts, and the files changed.
