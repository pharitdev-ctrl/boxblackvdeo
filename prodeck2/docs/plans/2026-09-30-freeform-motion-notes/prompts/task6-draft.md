You are implementing Task 6 of the BOXBLACK 0.5.0 plan: "Renderer: rows, states, redo, progress; the sheet goes".

{{COMMON}}

Tasks 2 to 5 are done too. What the screen gets from them (read `apps/desktop/src/shared/api.ts` as it is in the repo; it is what counts, not this summary):

- `GraphicView` has, besides what it had: `written: boolean` (a motion piece has its fragment), `stale: boolean` (its words changed, or it now has less time than it was written for, so it must be written again), `writeFailed: string | null` (why its last writing failed, one problem per line). For a motion piece `summary` is its idea and `spec.kind` is `"motion"`. A piece that is unwritten or stale comes with `render: "waiting"`, no poster and no error, and will not be written into the draft.
- `PostWorkState`'s running variant may carry `done` and `total` (the graphics work reports the pieces written so far).
- `DesktopApi.redoGraphic(folder, anchor, request): Promise<PostRunView>`, shaped like `rethinkPost`: one run of the graphics work that writes that one piece again.
- `setGraphic(folder, anchor, { off })` and `setGraphic(folder, anchor, null)` work on a motion piece; nothing else is patched any more. `retryGraphic` is unchanged.

## Your task, as the plan has it

{{TASK}}

## What is already decided (do not re-decide these)

- **One state line per row**, the first of these that holds:
  1. switched off → `graphics.offState`, as today;
  2. `writeFailed` is not null → `graphics.state.writeFailed` and ` · ` and the last lines of it (the `lastLines` the render failure already uses), the whole text in `title`, in the warning style;
  3. `stale` → `graphics.state.stale`;
  4. not `written` → `graphics.state.writing` while a plan run is going whose graphics work is running, else `graphics.state.unwritten`;
  5. otherwise the render's state as today (`graphics.render.*`, with the last lines when it failed).
  A card or a sticker (until Task 7 removes them) has `written: true`, `stale: false`, `writeFailed: null`, so it shows what it shows today.
- **Texts** (`i18n.ts`, Thai, the only place user-facing words live):
  - `graphics.redo`: `ทำใหม่` · `graphics.redoLabel`: `ให้ AI เขียนกราฟิกนี้ใหม่ {summary}`
  - `graphics.state.writing`: `กำลังเขียน…` · `graphics.state.unwritten`: `ยังไม่ได้เขียน กดทำใหม่` · `graphics.state.writeFailed`: `เขียนไม่สำเร็จ` · `graphics.state.stale`: `การตัดช่วงนี้เปลี่ยนไป กดทำใหม่`
  - `post.run.writingGraphics`: `กำลังเขียนกราฟิก {done} จาก {total}`
  - `flair.graphicHint`: `AI ออกแบบและเขียนแอนิเมชันเองให้เข้ากับเรื่องที่พูด ต้องติดตั้งตัวเรนเดอร์ในหน้าตั้งค่า และเรียก Claude เพิ่มหนึ่งครั้งต่อชิ้นตอนวางแผน`
  - `write.check.graphicsUnwritten`: `กราฟิก {count} ชิ้นยังไม่ได้เขียนหรือต้องทำใหม่ จะไม่ถูกใส่`
  - `graphics.none` names no kit: keep its sense (no graphics on this beat yet; think again from the AI menu).
  - `write.doneGraphicsSkipped`: `เขียนแล้ว · {pieces} ชิ้น {duration} · กราฟิก {graphics} ชิ้น · กราฟิกอีก {skipped} ชิ้นไม่ได้ใส่ (ยังไม่ได้เขียน ต้องทำใหม่ หรือเรนเดอร์ไม่สำเร็จ) ดูได้ในแท็บกราฟิกและเทคนิค`
  - `write.doneGraphicsAllSkipped`: `เขียนแล้ว · {pieces} ชิ้น {duration} · กราฟิก {skipped} ชิ้นไม่ได้ใส่ (ยังไม่ได้เขียน ต้องทำใหม่ หรือเรนเดอร์ไม่สำเร็จ) ดูได้ในแท็บกราฟิกและเทคนิค`
    (today both say the skipped graphics failed to render and to press retry, which is no longer the only reason a graphic is left out; keep each message's placeholders as they are)
- **Buttons of a row**, in this order: `ทำใหม่` on every motion row (not on a card or a sticker), disabled while `busy` or while any plan run is going; `ลองเรนเดอร์ใหม่` only when the render failed, as today; off/on; remove. There is no edit button and no sheet.
- **The redo** is an action of the room, beside `rethink` (`room/ClipRoom.tsx`): it builds the request the way `rethink` does and calls `api.redoGraphic(folder, anchor, request)`, takes the run view it returns the way `rethink` takes `rethinkPost`'s, and shows a failure the way `rethink` does. The row calls the room's action; it does not call the api itself.
- **The idea** is the row's summary, held to two lines by CSS (`-webkit-line-clamp`), the whole of it in `title`.
- **The plan strip**: a running graphics work whose state carries `done` and `total` reads `post.run.writingGraphics`; without them, and for every other work, the running line as today.
- **The write sheet** (`edit/WriteButton.tsx`): of the graphics that are on, those that are unwritten or stale will not be written. They are left out of the count of graphics to write (`write.graphics`) and out of the renders counted and awaited (`write.check.graphics`), and when there is at least one, a warning line says `write.check.graphicsUnwritten` with their number. A piece whose writing failed is unwritten. Nothing else about the sheet changes.
- **`GraphicSheet.tsx` goes** to the Trash (`mv … ~/.Trash/GraphicSheet.tsx-0930`), with its tests in `PostScreen.test.tsx` (about 31; the map in `research/renderer-map.md` §9 says where they are) and everything that only it used: `editingGraphic`, `onEditGraphic`, the sheet's i18n keys, the `showsFailure` argument of `changeHighlightText` if no other caller passes it. `playedSeconds` moves to `format.ts` first. The i18n keys of the sticker motions and the card pieces go when nothing uses them; `graphics.refused.*` are about cutaways and stay. The emoji problem banner stays (Task 7 removes it).
- The rows' tests get a motion fixture of their own, `MOTION` (a `GraphicView` whose spec is a `MotionSpec` with an idea, `written: true`, `stale: false`, `writeFailed: null`), and keep one card fixture to show a card has no redo button.
- Match the look of what is there: the components of `renderer/src/ui`, the classes of `styles/edit.css`. No new colours, no new component for this.

## Other implementers

Nobody else is working while you do. You own the renderer (`apps/desktop/src/renderer/src/**` and `apps/desktop/src/renderer/test/**`). Do not change `apps/desktop/src/main`, `apps/desktop/src/shared` or `packages/core`; if the screen needs something the api does not give, stop and say what.

## Before you begin

If anything about the requirements, the approach or the code is unclear, ask now, before you write code. It is always fine to stop and ask.

## Your job

1. Write the tests of each step first and watch them fail.
2. Implement exactly what the task says, no more.
3. Run your test files as you go, then `npm test` and `npm run typecheck` from the repo root.
4. Review your own work with fresh eyes (completeness against the task, names, no overbuilding, tests that would fail if the behaviour broke) and fix what you find.
5. Report.

If the task asks for something the code makes impossible or unwise, or you find yourself restructuring code the task did not mention, stop and report `BLOCKED` or `NEEDS_CONTEXT` with what you found. Bad work is worse than no work.

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented, step by step
- What you saw fail before the code (red), and the final results of `npm test` and `npm run typecheck` (the counts)
- Files changed
- Anything you decided that the task did not spell out, and why
- Self-review findings and any concerns
