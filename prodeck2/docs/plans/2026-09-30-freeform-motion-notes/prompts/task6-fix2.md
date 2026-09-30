# Task 6, fix round 2 (small)

The re-review approved round 1. One thing is left in `room/ClipRoom.tsx`, and two small ones.

## 1. A read asked before the end can take the mark off

`writingOver` is a boolean, and `writingShown()` runs on whichever read is the latest when it lands. The end event's handler sets `writingOver` and bumps a version, but the read that follows is only asked in the effect after React's next commit. Until then the latest read is still the earlier one. If that read's answer arrives in the gap, it passes the guard, sets its older preview and clears `redoing` and `writingGraphics`: the redone row shows its old line, or a row just written shows `ยังไม่ได้เขียน กดทำใหม่`, until the real read lands. That is the very thing round 1 was for. An earlier read is usually out: a writing's render check sends `graphics` events, and a sibling writing's count asks a read, just before the end.

Make `writingOver` hold a read's number, not a boolean:

- at the three places a writing's end is noted: the number of the latest read asked so far;
- at the two resets: `null`;
- the marks fall only when a read lands (or fails) whose number is greater than that: a read asked after the end.

Every end already asks a later read, so nothing sticks.

Test: a preview fake that answers with a thenable, landed inside the same `act` as the `done` event (a native promise cannot show it, because `act` flushes the effect before microtasks): the earlier read lands after the end and the mark stays; the later read lands and it falls. See it fail against the code as it is.

## 2. A refused redo puts back the plan flag its press dropped

Reachable only in a room just opened on a plan run, pressed before `postPlanState` answers. Keep the flag's value at the press and restore it where the refusal is caught. One test.

## 3. A redo's failed or stopped end held until the read

The hold is tested for a redo's `done` and for a plan run's `failed` and stopped ends, not for a redo that ends failed or stopped: the two redo tests only wait for the final state. Add the assertion before the read lands.

## Working conditions

Task 7 has just ended its work in the renderer; nobody else is editing now. Touch only `room/ClipRoom.tsx` and the renderer's tests. End with `npm test` and `npm run typecheck` from the repo root. Report per item, with what failed first.
