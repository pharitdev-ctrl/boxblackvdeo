# Task 6, fix round 1

Two reviewers read your work: the requirement is met, and the quality review approves it on one condition, which is item 1 below. The controller also ran the built app on a test profile with the real Claude: a plan, three writings with one repair, a redo, a stop and the write sheet all behaved, and the rows and the strip look right. These are the changes to make. For each, write the test first and watch it fail.

## 1. What a row reads while something is being written

Today one flag (`writingGraphics`) serves every row, and it falls as soon as the graphics work ends. Two things are wrong with that.

- **During a redo** only one graphic is being written, the one redone, and it is usually one that is written, stale or failed. Today it keeps its old line for the whole writing, while every other unwritten row reads `กำลังเขียน…` though nothing is writing it. (Seen in the app: the redone row read `พร้อม` throughout.)
- **Between the end of the graphics work and the landing of the read that follows it**, a row just written reads `ยังไม่ได้เขียน กดทำใหม่`, or, after a redo, its old state (`การตัดช่วงนี้เปลี่ยนไป กดทำใหม่`, the old failure). Main sends the last count and the work's `done` in one turn, the count's quiet read is overtaken by the `done` read, and the rows keep the old preview while the flag has already fallen. It lasts one preview read, and it is a wrong line, not a wrong action (the buttons are off meanwhile).

Decided:

- The room knows which graphic is being redone: its anchor, kept from the press of `ทำใหม่` until the read that follows the run's end has landed or failed. Rows are compared with it by `cueKey`, never by reference: every read brings new objects over IPC, and the redo's own `(0, 1)` count causes a read in the middle of it.
- The order of a row's state line becomes:
  1. the row being redone → `graphics.state.writing`, whatever else is true of it (off, failed, stale, written);
  2. off;
  3. `writeFailed`;
  4. `stale`;
  5. not written → `graphics.state.writing` while a run that is not a redo goes whose graphics work is running, else `graphics.state.unwritten`;
  6. the render's state.
- So during a redo no other row reads `กำลังเขียน…`: an unwritten one reads `ยังไม่ได้เขียน กดทำใหม่`.
- A room opened on a run already going cannot know whether it is a redo, nor of which graphic (`PostRunView` does not say). It behaves as for a plan run, which is today's behaviour. Say so in a comment.
- "Being written" holds until the read lands: neither the redone row's mark nor the plan run's flag falls when the graphics work or the run ends; they fall where the latest preview read lands or fails (the place that sets the preview), in the same batch. A stopped or failed work is held the same way, so a row goes from `กำลังเขียน…` straight to its true line.
- New room state goes into the hand-written list of the `value` memo (`ClipRoom.tsx`, under the eslint-disable).

Tests (the fakes must hand back new objects on every read: clone the fixtures per read, or a compare by reference would pass the tests and fail in the app):

- A redo played as main plays it (the work waiting, running, `(0, 1)`, `(1, 1)`, `done`, `post-plan-finished`, then the resolved view), with the preview read held: before it lands, the redone row (a stale one) reads `กำลังเขียน…` and an unwritten row beside it reads `ยังไม่ได้เขียน กดทำใหม่`; after it lands each reads its true line.
- A plan run's end with the read held: an unwritten row still reads `กำลังเขียน…` until the read lands.
- A redone row that is switched off, and one whose last writing failed, read `กำลังเขียน…` during the redo.

## 2. Main's refusal of a redo, in Thai

`this graphic has no place on the clip now` reaches the user in English. It is thrown inside the graphics work, so `api.redoGraphic` resolves with the work failed, and the message shows as the work's failed line in the strip, not as the room's error. Add one entry to `MAIN_WORDS` (`edit/postTabs.ts`) with a new key `graphics.refused.noPlace`: `กราฟิกนี้ไม่มีที่บนคลิปตอนนี้ (จุดของมันถูกซ่อนไว้ หรือไม่มีที่ว่างบนเฟรม)`. Test it with a failed work state in the strip, not with a rejected call.

## 3. A test models a stop main never produces

`room/ClipRoom.test.tsx`, the redo test whose title ends "one the user stopped is no error": the fixture rejects `redoGraphic` with `cancelled`. Main resolves with `graphics: { state: "failed", error: "cancelled" }`. Make the fixture do what main does, and assert the room's `error` is null.

## 4. Small things

- `i18n.ts`, `graphics.redoLabel`: the button's accessible name must contain its visible text, as the row's other buttons' names do. It becomes `ทำใหม่ {summary}`.
- `edit/PlanStrip.tsx`: the `total !== undefined` half of the count line has no test. One test: a running graphics work with `done` and no `total` reads the plain running line.
- `edit/byBeat.ts`: the tab's count and the sidebar's mark count every graphic that is on, written or not. Decided: that stays (it is the number of rows listed; the write sheet says how many are left out). Make the comment say so instead of speaking of what "plays".
- `edit/FlairTab.tsx`, the comment that says a switched-off graphic "is not written": a redo does write one. Say "not rendered or put in the draft".
- `edit/WriteButton.tsx`: `unwritten` also counts stale graphics, beside `writing`/`canWrite`, which mean the write into the draft. Rename it so that it says what it holds (for example `leftOut`).

## Not to change

- The direct, unthrottled read on each count.
- The strip's words during and after a redo.
- The clamp, the `warn-text` rule, `title` on every summary.

## Another implementer may be working

Nobody else is in the renderer. `apps/desktop/src/main` and `packages/core` are finished for now: do not touch them. End with `npm test` and `npm run typecheck` from the repo root.

## Report

What changed for each item, what you saw fail first for each new test, the final counts, and the files changed.
