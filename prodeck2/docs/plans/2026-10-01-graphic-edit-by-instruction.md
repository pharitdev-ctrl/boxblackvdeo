# Edit a Graphic by Instruction Implementation Plan (0.5.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user types what to change in a written motion graphic ("make the numbers bigger"), Claude rewrites the fragment with that change, and one step back is always possible. Release 0.5.1.

**Architecture:** The edit is the 0.5.0 writing with a different first brief: the brief for the room the graphic has now, the old fragment and the instruction (`editBrief`, core). It runs as one run of the graphics work, like `redoGraphic`, through the same `writePiece` loop (lint, render check, one repair). Every writing that replaces a fragment (an edit or a redo) keeps the one before it in `spec.previous`; `undoGraphic` swaps the two. A failed edit leaves the graphic as it was, with `spec.editFailed`.

**Tech Stack:** TypeScript on Node 26, Electron, React, vitest. No git: "commit" means `npm test` green and `npm run typecheck` clean from the repo root.

**Spec:** `docs/specs/2026-10-01-graphic-edit-by-instruction-design.md` (Thai). Decisions there are the user's (2026-10-01): edit only, no playing preview; undo one step; an edit does not make the graphic the user's own, so a re-plan replaces it.

---

## How to run this plan

- Tasks run in order: 2 needs 1's types, 3 needs 2's api.
- Implementers get their brief as a file in `docs/plans/2026-09-30-freeform-motion-notes/prompts/` (the common rules of 0.5.0 apply: tests first, no app, no build, no real Claude, no `~/Movies`, no `~/Library`, no CapCut draft, comments in plain English prose, user-facing text in Thai in `i18n.ts` only, nothing deleted outright).
- Reviews read frozen snapshots (`snap.sh`), so the next task may start while a review runs.
- Only the controller runs mutation checks, builds the DMG, calls the real Claude and writes draft `0917`.

## Names shared across tasks

```ts
// packages/core/src/graphics/plan.ts (Task 1)
/** A fragment a writing replaced, kept for one step back. */
export interface PreviousFragment { html: string; seconds: number; words: MotionWord[]; version: string; instruction?: string }
export interface MotionSpec {
  // ...as in 0.5.0, plus:
  /** the user's instruction that made the fragment there now; absent when a plan or a redo wrote it */
  instruction?: string
  /** why the last edit failed; the fragment there is the one from before it */
  editFailed?: string
  /** the fragment before the last edit or redo, for one step back */
  previous?: PreviousFragment
}
export const INSTRUCTION_MAX = 300   // graphemes

// packages/core/src/graphics/motion/write.ts (Task 1)
export function editBrief(args: { brief: string; html: string; instruction: string }): string

// apps/desktop/src/main/motion-write.ts (Task 2)
export async function writePiece(piece: PieceToWrite, deps: WriteDeps, firstBrief?: string): Promise<Written>   // firstBrief defaults to motionBrief(piece)

// apps/desktop/src/shared/api.ts (Task 2)
GraphicView: + instruction: string | null; editFailed: string | null; canUndo: boolean
DesktopApi: + editGraphic(folder: string, anchor: CueAnchor, instruction: string, request: PostRequest): Promise<PostRunView>
            + undoGraphic(folder: string, anchor: CueAnchor): Promise<void>
```

---

### Task 1: Core — the edit brief and the fields

**Files:**
- Modify: `packages/core/src/graphics/plan.ts`, `plan.test.ts`
- Modify: `packages/core/src/graphics/motion/write.ts`, `write.test.ts`

- [ ] **Step 1: Tests for `editBrief`** in `write.test.ts`: the first brief as it was, a blank line, `You wrote the fragment below for this brief. The user asks for this change:`, the instruction in double quotes on its own line, a blank line, `Make that change and keep everything else as it is, unless the brief above has changed (the length, the words and their times, the stage): then fit the fragment to the brief as it is now. Return the whole fragment, with no code fence and no explanation.`, a blank line, the fragment. The instruction is trimmed and its runs of white space made one space; a double quote inside it stays.
- [ ] **Step 2: Implement** beside `repairBrief`:

```ts
/** The brief of an edit: the brief for the room the graphic has now, the user's instruction, and the fragment to change. */
export function editBrief(args: { brief: string; html: string; instruction: string }): string {
  return [
    args.brief,
    "",
    "You wrote the fragment below for this brief. The user asks for this change:",
    `"${args.instruction.replace(/\s+/g, " ").trim()}"`,
    "",
    "Make that change and keep everything else as it is, unless the brief above has changed (the length, the words and their times, the stage): then fit the fragment to the brief as it is now. Return the whole fragment, with no code fence and no explanation.",
    "",
    args.html,
  ].join("\n")
}
```

- [ ] **Step 3: The fields** of `MotionSpec` and `PreviousFragment`, `INSTRUCTION_MAX = 300`, as in "Names shared across tasks". Export them from the package where `MotionSpec` is exported. A test in `plan.test.ts` that an outline of 0.5.0 (no new fields) is still a valid motion spec to `isMotion`.
- [ ] **Step 4:** `npm test` and `npm run typecheck`.

### Task 2: Main — the edit run, the step back, the views, the api

**Files:**
- Modify: `apps/desktop/src/main/motion-write.ts`, `motion-write.test.ts`
- Modify: `apps/desktop/src/main/flair.ts`, `flair-plan.test.ts`, `flair.test.ts`
- Modify: `apps/desktop/src/main/post-plan.ts`, `post-plan.test.ts`, `post-flow.test.ts`
- Modify: `apps/desktop/src/main/highlight-api.ts`, `highlight-api.test.ts`, `license-api.ts`, `license-api.test.ts`, `index.ts`
- Modify: `apps/desktop/src/main/graphics-cues.ts` (`graphicViews`), `highlights.test.ts`
- Modify: `apps/desktop/src/shared/api.ts`, `apps/desktop/src/renderer/test/fake-api.ts`, and every `GraphicView` literal the compiler flags (the three new fields with `null`, `null`, `false`)

- [ ] **Step 1: `writePiece(piece, deps, firstBrief?)`.** The first call is made with `firstBrief ?? motionBrief(piece)`, and the one repair's brief carries that same first brief (`repairBrief({ brief: firstBrief, ... })`). Tests: the first request is the brief handed in; the repair's request starts with it; without it, as today.
- [ ] **Step 2: What every writing keeps.** In `writeGraphic` (`flair.ts`), the store of a writing that ends (written or failed) sets `previous` to the fragment the graphic had until then when it had one (`html`, `seconds`, `words`, `version`, `instruction`), and otherwise keeps the `previous` it had; so a plan's first writing keeps none, a redo keeps the fragment it replaced whether it succeeds or fails, and a second failed redo still keeps the good one. A plan's writing and a redo remove `instruction` and `editFailed`. Tests for each.
- [ ] **Step 3: `editGraphic(folder, anchor, instruction, request, signal?, progress?)`** in `flair.ts`, shaped like `redoGraphic`: the graphic found among the placed ones, playing or switched off, by `samePlace`; no place now fails with `this graphic has no place on the clip now` (as redo); no fragment fails with `this graphic has not been written yet`; progress `(0, 1)` then `(1, 1)`; the renderer's `forgetMachine()` first; written for the room it has now, as redo; the first brief `editBrief({ brief: motionBrief(writtenFor), html: <its fragment>, instruction })`. How it is stored, in one update of the latest outline:
  - written: `html`, `seconds`, `words`, `version` new; `instruction` = the instruction (as it was typed, trimmed); `previous` = the fragment before; `failed` and `editFailed` removed;
  - failed (lint or render after the one repair, or a call that failed): the graphic unchanged but for `editFailed` = the failure (the first three problems, one a line, or the call's message);
  - stopped: nothing stored, the work rejects as a stop does;
  - `edited` never changes, and no other graphic is touched.
  Tests: each of those, and that a stale graphic edited is no longer stale (its words and seconds are the ones now).
- [ ] **Step 4: `undoGraphic(folder, anchor)`** in `flair.ts`: one update of the latest outline. The graphic found by `samePlace`; no graphic, or no `previous`, fails with `this graphic has nothing to go back to`. The current and the previous change places: the spec takes `previous`'s `html`, `seconds`, `words`, `version`, `instruction` (removed when it has none), and `previous` becomes the current fragment when it had one, else goes; `failed` and `editFailed` go; nothing else changes. Pressed twice, it comes back. Tests for each, and one through `post-flow.test.ts`: edit, undo, the preview shows the graphic as before the edit and the write lays it (its render is the one already made: the renderer is not asked again).
- [ ] **Step 5: The runs** (`post-plan.ts`): `editGraphic(folder, anchor, instruction, request)` is one run of the `graphics` work alone, like `redoGraphic` (refused while another run goes). `undoGraphic` is not a run, but it is refused while a run goes on the project, with the same message (`a plan for this project is already running`). Tests.
- [ ] **Step 6: The api.** `DesktopApi.editGraphic` and `undoGraphic` in `shared/api.ts`, in `API_METHODS`, in `highlight-api.ts` (the anchor checked as for `redoGraphic`; the instruction a string, not empty once trimmed, at most `INSTRUCTION_MAX` graphemes, else refused), `editGraphic` in `LICENSED_METHODS` with its pinned list, `fake-api.ts`, and the wiring in `index.ts`. Tests beside the existing ones.
- [ ] **Step 7: The view** (`graphicViews`): `instruction` (the spec's, or null), `editFailed` (or null), `canUndo` (a `previous` is there). Tests in `highlights.test.ts`.
- [ ] **Step 8:** `npm test` and `npm run typecheck`.

### Task 3: Renderer — edit, undo, the lines of a row

**Files:**
- Modify: `apps/desktop/src/renderer/src/edit/FlairTab.tsx`, `edit/GraphicsTab.tsx`, `room/ClipRoom.tsx`, `i18n.ts`, `styles/edit.css`
- Test: `screens/PostScreen.test.tsx`, `room/ClipRoom.test.tsx`

- [ ] **Step 1: Texts** (`i18n.ts`): `graphics.edit` `แก้` · `graphics.editLabel` `แก้ {summary}` · `graphics.editField` `จะให้ AI แก้อะไร` · `graphics.editHint` `เช่น ตัวเลขใหญ่ขึ้น หรือ จรวดพุ่งจากขวาแทน` · `graphics.editSend` `ส่งให้ AI แก้` · `graphics.editCancel` `ยกเลิก` · `graphics.editTooLong` `ยาวเกิน 300 ตัวอักษร` · `graphics.state.editing` `กำลังแก้…` · `graphics.lastEdit` `แก้ล่าสุด: {instruction}` · `graphics.editFailed` `แก้ไม่สำเร็จ` · `graphics.undo` `ย้อน` · `graphics.undoLabel` `ย้อน {summary}` · `graphics.refused.notWritten` `กราฟิกนี้ยังไม่ได้เขียน กดทำใหม่ก่อน` · `graphics.refused.nothingBack` `ไม่มีชิ้นก่อนหน้าให้ย้อน`; the two refusals through `MAIN_WORDS` (`edit/postTabs.ts`), matched on main's messages.
- [ ] **Step 2: The room** (`room/ClipRoom.tsx`): the mark of a graphic being written again (today `redoing`) says which it is, a redo or an edit, and is kept and released exactly as today's is (the read after the end, `cueKey`). `editGraphic(anchor, instruction)` goes through the same `running()` helper as `redoGraphic`. `undoGraphic(anchor)` calls the api and then reads the graphics again the quiet way; a refusal is said the way a `setGraphic` refusal is.
- [ ] **Step 3: The row** (`edit/FlairTab.tsx`):
  - buttons, in order: `ทำใหม่` · `แก้` (a written graphic: `graphic.written`) · `ลองเรนเดอร์ใหม่` (when the render failed) · `ย้อน` (`graphic.canUndo`) · off/on · remove. `แก้` and `ย้อน` are disabled while `busy` or while any plan run goes, as `ทำใหม่` is;
  - `แก้` opens a field under the row (one at a time on the page: opening one closes another), a textarea labelled `graphics.editField` with `graphics.editHint` as its placeholder, and `ส่งให้ AI แก้` / `ยกเลิก`. Send is enabled when the trimmed text is not empty and at most 300 graphemes (`Intl.Segmenter`); past that the field says `graphics.editTooLong`. Sending closes the field and starts the edit; `ยกเลิก` and Escape close it, keeping nothing;
  - the state line: the graphic being edited reads `graphics.state.editing` in the place `graphics.state.writing` takes for a redo;
  - under the idea, when `instruction` is set: `graphics.lastEdit`, held to two lines, the whole of it in `title`;
  - when `editFailed` is set: a second line under the state, `graphics.editFailed` and ` · ` and its last lines, in the warning style, the whole in `title`.
  Match the look of the outline's revise field and of the row's existing lines; no new colours.
- [ ] **Step 4: Tests** (`PostScreen.test.tsx`, `ClipRoom.test.tsx`): the buttons and their order for a written, an unwritten, a stale, a failed and a switched-off graphic; the field's send rule, its limit and cancel; the edit's request equals what the plan button sends, with the instruction; `กำลังแก้…` only on that row, held until the read lands; `แก้ล่าสุด`; the edit-failed line; undo calls the api and reads again; refusals in Thai.
- [ ] **Step 5:** `npm test` and `npm run typecheck`.

### Task 4 (controller): Version, docs, checks, the live test

- [ ] `apps/desktop/package.json` version `0.5.1` (with the Edit tool).
- [ ] Mutation checks on `editBrief`, `writePiece`'s first brief, the store of an edit and of a redo (`previous`, `instruction`, `editFailed`), `undoGraphic`'s swap, the api's checks, the row's buttons and field.
- [ ] `npm run dist -w @boxblack/desktop`; check `Contents/Resources/graphics` holds `host.js` alone and the version.
- [ ] Live test on the test profile with the real Claude: three edits on 0917's graphics (size, direction, speed), an undo and a second undo, an edit of a graphic made stale, a stop during an edit; back up 0917, write it, ask the user to open it in CapCut and look, restore it and check it is identical.
- [ ] The main spec's `0.5.1` entry after 0.5.0; the spec's status line; memory.
