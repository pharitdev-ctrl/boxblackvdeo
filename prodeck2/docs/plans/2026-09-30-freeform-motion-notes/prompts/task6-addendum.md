# Task 6, one requirement added while it was being written

Found by Task 5's quality review, and sent to the implementer as a message.

Main sends no `graphics` event after a graphic's writing is stored. The only event after each store is the graphics work's running report: a `post-plan` event, work `graphics`, state `running` with `done` and `total`. Before this task `room/ClipRoom.tsx` read the graphics again only on a work's `done`, on `post-plan-finished` and on `graphics` events, so every row would stay on `กำลังเขียน…` until the whole work ended.

Decided: on each `post-plan` event of the `graphics` work whose state is running and carries `done` (the first one, `done: 0`, included: it comes right after the plan is stored, so the new rows appear at once), the room reads the graphics again quietly, the way it does for a `graphics` event, so each row leaves `กำลังเขียน…` for its real state as its writing ends. One test: a running report with `done` makes the rows be read again; a running state without `done` does not.
