You are implementing Task 9 of the BOXBLACK 0.6.0 plan "Composed sound effects": Renderer: the sound tab.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It covers the project, where to read, the rules and the report format.

Your task is "Task 9" in `docs/plans/2026-10-01-composed-sound.md`. Steps 1 to 7 are your work. The texts in its Step 1 table are copied exactly.

## What exists now (approved)

- **Preview data:** `HighlightPreview.composed: ComposedSoundView[]` and `ownSounds: OwnSoundView[]` (`apps/desktop/src/shared/api.ts`).
- **Write result:** `WriteResult.composedCount` and `composedLeftOut: { unwritten, stale, failed }`.
- **API:** `redoSound`, `editSound`, `undoSound` and `setSound` (Task 8). `setSoundCue(folder, anchor, null)` removes one of the user's own CapCut sounds.
- **Error strings from main,** for `MAIN_WORDS`, exactly:
  - `this sound has no place on the clip now`
  - `this sound has not been written yet`
  - `this sound has nothing to go back to`
  - `composing sounds is not ready: no Claude connection`, which the existing `is not ready: no Claude connection$` line already maps.
- **Plan run progress:** for the `"sounds"` work it comes as `(done, total)`.
- **0.5.1's graphics rows to mirror,** in `apps/desktop/src/renderer/src/edit/FlairTab.tsx`:
  - `TechniqueList`'s graphics rows;
  - `EditField`, which is exported or exportable;
  - the `asking` and `fieldOpen` rules, including dropping a key that is no longer listed;
  - `failure()`, `lastLines`.
- **The room's rewrite marks,** in `room/ClipRoom.tsx`: `rewrite`, `Rewriting`, `beginEdit`/`endEdit`, the quiet read (`graphicsVersion`).

## Already decided (do not re-decide)

**The room**
- The rewrite mark gains `of: "graphic" | "sound"`. Existing graphic behaviour is unchanged.
- `redoSound` and `editSound` go through `rewrite`.
- `undoSound` and `setSound` go through `beginEdit`/`endEdit` with the quiet read.
- A sound that is being written again reads `sounds.state.writing`, or `sounds.state.editing` for an edit. The last-edit line and the edit-failed line give way while it is written again, as they do for graphics.

**`ComposedList`**
- One row per `ComposedSoundView`, in time order (`atUs`), using `ItemRow`.
- **State line, in this order:**
  1. writing / editing;
  2. `off` → `sounds.state.off`;
  3. `writeFailed` → failed `· <lastLines>`;
  4. `stale === "picture"` → stalePicture;
  5. `stale === "cut"` → staleCut;
  6. not written → unwritten;
  7. render `"failed"` → renderFailed `· <error>`;
  8. `"pending"` → pending;
  9. `"ready"` → ready.
- **Buttons, in this order:**
  1. ทำใหม่;
  2. แก้ (written only);
  3. ย้อน (`canUndo`);
  4. ปิด/เปิด;
  5. ลบ.

  They are held while `busy` or a plan run goes, as graphics rows are.
- **The edit field** reuses `EditField`, with the sound texts. Only one field is open on the page, shared with the graphics rows' rule.
- **`sounds.ofGraphic`** shows the graphic's summary when `graphic` is set. Otherwise `FromPoint` shows the point.

**"Own" list**
- It shows only when `ownSounds` is not empty.
- Each row: time, name, and a remove button (`sounds.ownRemoveLabel`) calling `setSoundCue(anchor, null)` through the quick-change path.

**`SoundTab`**
- It keeps the switch and the emphasis banner.
- The old slot rows and their `<Select>` go. The old `SoundList` goes, together with tests that only tested it. Tests of generic behaviour move to the new list.
- When `composed` is empty and the sound switch is on, it shows `sounds.none`.

**Machine problem (a small main change, yours)**
- Add `soundsProblem: string | null` to `HighlightPreview`, read from the sound renderer's `environmentProblem()` in `highlights.ts`. Today the highlights service has `soundRenderer` with only `ensure`; widen that `Pick`.
- When it is set, the tab shows a warning notice above the list. Reuse the graphics problem text pattern, with a new key `sounds.problem` = `ทำเสียงบนเครื่องนี้ไม่ได้ · {problem}`.

**Plan strip and write sheet**
- The plan strip shows `plan.composing` for the sounds work while it runs with a total.
- The write sheet shows `write.composed` with the count, and `write.composedLeftOut` with the left-out total. `why` lists the non-zero kinds in Thai: `ยังไม่ได้แต่ง N`, `เก่า N`, `ไม่สำเร็จ N`, joined with ` · `.
- Look at how the sheet shows graphics today, and follow it.

**Settings texts that became untrue.** Change these in `i18n.ts`:
- `settings.graphicFiles` → `ไฟล์กราฟิกและเสียงที่เรนเดอร์ไว้`, keeping its parameters.
- `settings.graphicFilesHint` → names both folders: `~/Movies/CapCut/BOXBLACK/graphics` and `~/Movies/CapCut/BOXBLACK/sounds`.
- `settings.graphicFilesBlockedBusy` → `กำลังเรนเดอร์กราฟิกหรือเสียงอยู่`, keeping its parameters.

Read the current texts first and keep their style.

**Tests**
- Rows and their buttons in each state.
- Edit, undo and refusals in Thai.
- The marks (writing/editing on that row only, held until the read lands).
- The own list and its removal.
- `sounds.none`, the machine-problem notice, the strip line, the sheet line.
- The settings texts.

## Working conditions

Task 8 is approved before you start, so nobody else is changing the repo while you work.

**Addition.** A graphic redo or edit now always runs a "sounds" work as well, which ends `done(0,0)` when no sound is tied to that graphic. The plan strip shows no sounds entry for a sounds work that ended `done` with a total of 0.

**Working conditions (overrides the line above).** Task 8 is in review while you work. Its fix round may touch `flair.ts`, `post-plan.ts`, `sound-actions.ts`, `highlight-api.ts` and `shared/api.ts`. Keep your `shared/api.ts` change to the `soundsProblem` field. A failing test outside your files is probably theirs: run it again, and do not fix it.
