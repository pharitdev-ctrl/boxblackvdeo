# Task 5, fix round 1

Two reviewers, one for the requirement and one for quality, read your work. Everything the task decided is in. These are the changes to make. For each, write the test first and watch it fail.

## 1. The stop must reach a writing at every point (`motion-write.ts`, `flair.ts`)

Today `writePiece` looks at the signal only when a call fails. A stop that comes while a render check is under way is not seen: the render is awaited to its end (3 to 5 s as a rule, about 20 s for a page that never becomes ready, 120 s at the limit, and the renderer works one at a time), the graphic is then stored after the stop, and when that render fails the repair call is started with a signal that has already aborted. The run stays running, and refuses other runs, all that time. When the writings in flight were the last ones, or on a redo, the work even ends `done` and not cancelled.

Decided: a stop ends a writing at once and stores nothing of it.

- In `writePiece`, before each call: `deps.signal?.throwIfAborted()`.
- The render check is awaited until it settles or the signal aborts, whichever comes first. On the abort `writePiece` rejects with the signal's reason. The render itself is left to end in the background: its file is kept under its hash and harms nothing. A render that ends after the stop, whether it passes, fails or throws, must do nothing more and leave no unhandled rejection.
- After a render that settled, the signal is looked at again before anything else is done with the answer.
- No listener may be left on the signal once a writing has ended: a run's signal lives for the whole plan run, and dozens of writings hang on it.
- So a stopped `writePiece` always rejects and never answers, and `writeGraphic` stores nothing for it.

Tests:

- `motion-write.test.ts`: a render held open, the signal aborted: `writePiece` rejects with the reason, no repair call is made, and when the held render answers afterwards (once passing, once with problems) no call follows. A signal aborted before the first call rejects with no call made.
- `flair-plan.test.ts`: a renderer whose `wait` is held: a stop during it ends the work as a stop does, and the graphic is not stored (its spec still has `html: null`). The same for a redo: the old fragment stays.

Make the comments say what is now true.

## 2. A throw inside the render check is no fault of the fragment (`flair.ts`, `renderProblems`)

When `candidateJob`, `hashOf`, `wait` or `failureOf` throws (the draft cannot be read just then), the check answers `null`, as "cannot be rendered now" does: the writing ends with the fragment the linter passed, and the preview's render judges it later. Today the throw rejects that writing, the work fails at its end with that error, and the graphic is left with neither a fragment nor a reason. Test.

## 3. One graphic to a place

A graphic is known by its anchor everywhere: the store of a writing, `setGraphic`, `retryGraphic`, `redoGraphic`, the rows. Two graphics on one place cannot both be reached. Today `acceptMotionPlan`, given two points of one sentence whose answers name the same start word, answers two graphics with the same anchor; both are written, both stores land on the first, which ends with a fragment written for the other's idea, and the second stays unwritten for good.

- **Core** (`packages/core/src/graphics/motion/direct.ts`, `acceptMotionPlan`; you may change this one function and its test file, for this rule only): an answer that starts on a word an earlier answer of the same reply already starts on (the same video, the same `sourceUs`) is dropped and counted, as an answer for a point already filled is. Test: two points of one sentence, two answers naming the same word: one graphic, `dropped: 1`.
- **The merge in `flair.ts`**: one of Claude's graphics that waits on a point not asked about now goes when it is on the same place (`samePlace`) as one of the user's own or as one of the new answers: the answer plays now, and wins. Its sound goes with it, as for any of Claude's that goes. Test.

## 4. `writeAll`: a reporter that throws must not end the pool early

`onProgress` is outside the `try`, so one throw rejects `Promise.all` at once while the other writers go on unawaited, calling Claude and storing after the run has ended. A throw from `onProgress` is treated as a write's failure is: collected, the pool goes on to its end, and the first failure is thrown once all have settled. Test.

## 5. The test of "the machine cannot render" never hands `writePiece` a null

In `motion-write.test.ts` the helper is `verdicts[n++] ?? []`, so `renderOf(null)` answers `[]`, and both halves of that test run the passing path: they would still pass if a null went to the repair. Make the helper tell "no verdict left" from null (for example `n < verdicts.length ? verdicts[n++]! : []`), and see the test fail when null is treated as a problem.

## 6. Things that hold but that no test pins

Each must fail when the behaviour is broken:

- The length written for is the millisecond below: a placed length that is not a whole number of milliseconds (3_456_789 µs gives 3.456).
- `graphicJobs` rejecting after the plan is stored fails the work with that error, and the plan stays stored.

## 7. The licence gate

`redoGraphic` does the paid-for work, as `rethinkPost` does. Add it to `LICENSED_METHODS` in `apps/desktop/src/main/license-api.ts` and to the pinned list in `license-api.test.ts` (you may change these two files for this).

## 8. Words

- The comment on `redoGraphic` says a graphic with no room on the frame fails the work. That is so for one that plays. One switched off is listed at its stored box whether or not there is room (`graphicsInForce` cannot tell), and is written for that box. Decided: that stays, since the fragment fits the box the graphic will have when there is room again. Make the comment say so.
- `ToWrite` beside `PieceToWrite`, and `piece` for a placed graphic in a file where a piece is a piece of the rough cut: rename so that one word means one thing.

## Decided, not to change

- `count` is 0 when there is nothing to write.
- A redo that fails leaves the graphic with no fragment.
- Work 4 still offers a sound on a graphic that is not written.
- The list of graphics to write is read once, when the writing begins.
- A patch with no `off` on a motion graphic: Task 7 rewrites the patch.

## Another implementer is working now

Task 6 is being written in `apps/desktop/src/renderer/**`. Do not touch the renderer or `apps/desktop/src/shared/api.ts`. Run your own test files as you go. At the end run `npm test` and `npm run typecheck` from the repo root; if something fails in a renderer file, it is not yours: wait a minute, run again, and report it as theirs if it stays.

## Report

What changed for each item, what you saw fail first for each new test, the final counts of `npm test` and `npm run typecheck`, and the files changed.
