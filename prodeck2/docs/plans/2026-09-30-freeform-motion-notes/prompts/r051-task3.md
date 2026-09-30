You are implementing Task 3 of the BOXBLACK 0.5.1 plan: "Edit a graphic by instruction", the screen.

## The project in brief

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. Monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`: `packages/core` (pure TypeScript), `apps/desktop/src/{main,shared,renderer}`. Node 26 runs TypeScript natively; tests are vitest (renderer tests with Testing Library in jsdom); there is no git.

Release 0.5.0 lets Claude plan and write motion graphics; the post page's graphics tab lists each graphic as a row with a poster, its idea, its state and buttons (ทำใหม่, ลองเรนเดอร์ใหม่, off/on, remove). Release 0.5.1 adds one thing: the user types what to change in a written graphic, Claude rewrites it, and one step back is always possible. Tasks 1 and 2 (core and main) are done: the api has `editGraphic(folder, anchor, instruction, request): Promise<PostRunView>` and `undoGraphic(folder, anchor): Promise<void>`, and `GraphicView` has `instruction: string | null`, `editFailed: string | null`, `canUndo: boolean`. `renderer/test/fake-api.ts` already has both methods. Your task is the screen.

## Read first

- The plan: `docs/plans/2026-10-01-graphic-edit-by-instruction.md`, in full. Your task is Task 3; "Names shared across tasks" is the contract you build on.
- The spec (Thai): `docs/specs/2026-10-01-graphic-edit-by-instruction-design.md`, §2 (the screen) and §3 (what an edit and an undo do).
- The code you build on:
  - `apps/desktop/src/renderer/src/edit/FlairTab.tsx`: `TechniqueList` (the graphics rows, from about line 250), `graphicState` (the state line, including the failure form `<text> · <last lines>` with the whole in `title`), `lastLines`.
  - `apps/desktop/src/renderer/src/edit/GraphicsTab.tsx`: wires the room into `TechniqueList` (`edit(() => api.setGraphic(...))` is how a quick change and its refusal are handled today; `room.redoGraphic`).
  - `apps/desktop/src/renderer/src/room/ClipRoom.tsx`: `redoing` / `setRedoing`, `redoGraphic` (about line 834), `running()`, `writingGraphics`, `redoRun`, and where `redoing` is released after the read that follows the end of the run (search `setRedoing(null)` and `cueKey`).
  - `apps/desktop/src/renderer/src/edit/postTabs.ts`: `MAIN_WORDS`, `mainText`.
  - `apps/desktop/src/renderer/src/outline/BriefPanel.tsx`: the outline's revise field (`brief-revise`), whose look the edit field follows.
  - `apps/desktop/src/renderer/src/i18n.ts`, `styles/edit.css`.
  - Tests: `screens/PostScreen.test.tsx` (the graphics rows are tested there today), `room/ClipRoom.test.tsx`.

## What is already decided (do not re-decide these)

- **Texts**, exactly as the plan's Step 1, all in `i18n.ts`. The two refusals go through `MAIN_WORDS` in the same form as the lines there (`(?:^|: )...$`): main's `this graphic has not been written yet` to `graphics.refused.notWritten`, and `this graphic has nothing to go back to` to `graphics.refused.nothingBack`. A missing Claude connection during an edit already reads through the `is not ready: no Claude connection$` line; do not add one.
- **The room's mark** of the graphic being written again (today `redoing: CueAnchor | null`) becomes one that also says which it is, a redo or an edit (name it as you judge; for example `rewriting: { anchor: CueAnchor; how: "redo" | "edit" } | null`). It is set, kept and released exactly as `redoing` is today: set at the press, released on refusal before the run begins, otherwise released by the read that follows the end of the run. `editGraphic(anchor, instruction)` goes through the same `running()` helper as `redoGraphic`, so its request is the one the plan button sends. Keep `redoGraphic`'s comments and behaviour; share rather than copy where the two are the same.
- **Undo** (`undoGraphic(anchor)` in the room, or through `GraphicsTab`'s `edit(...)` if that is exactly "call the api, then read the graphics again the quiet way, and say a refusal the way a `setGraphic` refusal is said": check, and use it if so). It is not a run and has no mark.
- **The row** (`TechniqueList`), buttons in this order: `ทำใหม่` · `แก้` · `ลองเรนเดอร์ใหม่` (when the render failed, as today) · `ย้อน` · off/on · remove.
  - `แก้` shows for a written graphic (`graphic.written`), which includes a stale one and a switched-off one; not for an unwritten one or one whose writing failed.
  - `ย้อน` shows when `graphic.canUndo`.
  - `แก้` and `ย้อน` are disabled while `busy` or while a plan run goes (`planning`), as `ทำใหม่` is. Their `aria-label`s are `graphics.editLabel` / `graphics.undoLabel` with the summary, as the other buttons do.
- **The edit field**: `แก้` opens it under the row; one at a time on the page (opening one closes the other; `TechniqueList` is rendered once per page, check it, and keep the state there). A textarea labelled `graphics.editField` with `graphics.editHint` as placeholder, then `ส่งให้ AI แก้` and `ยกเลิก`. Send is enabled when the trimmed text is not empty, is at most 300 graphemes (count with `Intl.Segmenter` with `granularity: "grapheme"`; import `INSTRUCTION_MAX` from core if the renderer can import core's graphics entry, else say why not), and no run goes and not `busy`. Past 300 the field says `graphics.editTooLong` (in the warning style, tied to the textarea with `aria-describedby`). Sending closes the field, drops its text, and starts the edit with the trimmed text. `ยกเลิก` and Escape in the textarea close it, keeping nothing. Pressing `แก้` of the open row again closes it. Follow the look of `brief-revise` and the row's existing lines; no new colours; the field spans the row's width under it.
- **The state line**: the graphic being edited reads `graphics.state.editing` where a redo reads `graphics.state.writing`.
- **Last edit**: under the idea (`flair-what`), when `instruction` is set, `graphics.lastEdit` held to two lines like the idea, the whole of it in `title`.
- **Edit failed**: when `editFailed` is set, a second line under the state line: `graphics.editFailed` then ` · ` then its last lines (`lastLines`), in the warning style (`warn-text`), the whole in `title`. The state line itself is as it would be without it (the fragment there still stands).

## Rules of this repo

- No git. "Commit" means `npm test` is green and `npm run typecheck` is clean, both run from the repo root.
- Tests first: every behaviour gets a test that fails before the code and passes after. Say in your report what you saw fail.
- Never run the app, `npm run build`, `npm run dist`, HyperFrames, Chrome or a real Claude call. Never touch `~/Movies`, `~/Library` or a CapCut draft. Do not change `apps/desktop/package.json`.
- Comments are plain English prose about behaviour, in the voice of the surrounding code; no em-dashes in prose you add. User-facing strings are Thai and live in `i18n.ts` only.
- Nothing is deleted outright: a file that goes is moved with `mv <path> ~/.Trash/<name>-1001`.
- Scratch files go under `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/`.

## Working conditions

Tasks 1 and 2 are under review, and a fix to them may land in `packages/core`, `apps/desktop/src/main` or `apps/desktop/src/shared` while you work. Do not change those folders; `renderer/test/fake-api.ts` is yours only if a test needs it. If a test outside the renderer fails while you work, it is probably that fix in progress: re-run once a few minutes later, and say so in your report rather than fixing it. The gate stood at 155 files, 2556 passed, 3 skipped, typecheck clean, when you started.

If the plan asks for something the code makes impossible or unwise, or you find yourself restructuring code the plan did not mention, stop and report `BLOCKED` or `NEEDS_CONTEXT`. If anything is unclear, ask before you write code.

## Tests to write (plan Step 4)

In `PostScreen.test.tsx` and `ClipRoom.test.tsx`: the buttons and their order for a written, an unwritten, a stale, a failed-render, a failed-writing and a switched-off graphic; the field's send rule (empty, spaces only, 300 graphemes of Thai with combining marks allowed, 301 refused with the text shown), cancel and Escape; the edit's request equals what the plan button sends, with the trimmed instruction; `กำลังแก้…` only on that row and held until the read lands; a refused edit releases the mark; `แก้ล่าสุด`; the edit-failed line; undo calls the api and reads again; the two refusals in Thai; `แก้` and `ย้อน` disabled during a run.

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented, step by step; what you saw fail first; the final counts of `npm test` and `npm run typecheck`; the files changed; anything you decided that the plan did not spell out; self-review findings and concerns.
