You are implementing Task 6 of the BOXBLACK 0.5.0 plan: "Renderer: rows, states, redo, progress; the sheet goes".

## The project in brief

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. Monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`: `packages/core` (pure TypeScript), `apps/desktop/src/{main,shared,renderer}`. Node 26 runs TypeScript natively; tests are vitest; there is no git.

Until now the app overlaid "graphics" drawn by a fixed kit of cards and stickers, rendered to transparent ProRes 4444 by HyperFrames 0.8.65 (a headless-Chrome renderer the app ships as a "pack"). Release 0.5.0 replaces the kit with free-form motion graphics: Claude writes each graphic as one HTML fragment (one `<style>` block, markup, an optional `<script>` block last), the app checks it, wraps it in a page, renders it with the same pack, inspects the result, and lays the file in the draft as it lays graphics today.

The flow of 0.5.0, so you know where your task sits:
1. A planning call picks the points, and for each a word to start on, seconds, a box, a reason and an idea (Task 2).
2. A writing call per piece returns the fragment (Task 2).
3. `lintFragment` checks it; the renderer wraps, renders and inspects it (Task 1, Task 3).
4. A failed check or render gets exactly one repair call, whose brief carries the problems in English (Task 2 writes the brief, Task 5 runs the loop).
5. Pieces whose words changed go stale and are not written into the draft (Task 4). The screen shows each piece's state (Task 6). The old kit and its emoji pictures leave in Task 7.

Task 1 is done and in the repo:

```ts
// packages/core/src/graphics/plan.ts   (import path "@boxblack/core/graphics/plan")
export const MOTION_VERSION = "motion-2026-09-30"
export const MOTION_HTML_MAX = 40_000
export interface MotionWord { text: string; atS: number }
export interface MotionSpec {
  kind: "motion"; version: string; box: GraphicBox; seconds: number; why: string
  idea: string            // what is drawn, one Thai line
  words: MotionWord[]     // the words said while it plays, with seconds from its start when it was written
  html: string | null     // the fragment; null until it is written
  failed?: string         // why the last writing failed
}
export const isMotion = (spec: GraphicSpec): spec is MotionSpec => spec.kind === "motion"
// GraphicSpec is still a union with the kit's CardSpec and StickerSpec until Task 7.

// packages/core/src/graphics/motion/lint.ts   ("@boxblack/core/graphics/motion/lint")
export function lintFragment(html: string): string[]   // problems in English, one line each, at most 13; empty when it passes

// packages/core/src/graphics/motion/html.ts   ("@boxblack/core/graphics/motion")
export interface MotionAssets { host: string }
export async function motionAssets(dir: string): Promise<MotionAssets>   // reads <dir>/host.js
export function motionColours(palette: Palette): { ink; paper; accent; alt; bar; text }   // hex strings
export function motionHtml(args: { html: string; stage: { width: number; height: number }; seconds: number; fps: number; times: number[]; palette: Palette; font: { family: string; file: string }; assets: MotionAssets }): string

// packages/core/src/graphics/framing.ts   ("@boxblack/core/graphics/framing")
export function stageBox(box: GraphicBox, canvas: { width: number; height: number }): PixelBox   // even pixels, inside the canvas, no margin
```

`apps/desktop/resources/graphics/host.js` is the script the page ends with: it gives HyperFrames a timeline that sets `currentTime` on every entry of `document.getAnimations()` and calls the fragment's optional `window.frame(t)`.

## Where to read

- The plan: `docs/plans/2026-09-30-freeform-motion.md`. Read "How to run this plan" and "Names shared across tasks". Your task's text is pasted below; the plan has the other tasks if you need to see what comes next.
- The spec (Thai): `docs/specs/2026-09-30-freeform-motion-design.md`.
- The proof run: `docs/plans/2026-09-30-freeform-motion-notes/README.md`, and its `spike/` and `research/` folders (`research/core-map.md`, `main-map.md`, `renderer-map.md` say where everything about graphics lives, with line numbers as of 0.4.4, which may have moved a little).

## Rules of this repo

- No git. "Commit" means `npm test` is green and `npm run typecheck` is clean, both run from the repo root.
- Tests first: every behaviour gets a test that fails before the code and passes after. Say in your report what you saw fail.
- Nothing is deleted outright: a file that goes is moved with `mv <path> ~/.Trash/<name>-0930`.
- Never run the app, `npm run build`, `npm run dist`, HyperFrames, Chrome or a real Claude call. Never touch `~/Movies`, `~/Library` or a CapCut draft. Tests use fakes and temp folders.
- Comments are plain English prose about behaviour, in the voice of the surrounding code (read a few of the existing ones first). No em-dashes in prose you add. User-facing strings are Thai and live in `i18n.ts` only; your task adds none.
- Match the surrounding code: its naming, its density of comments, its way of injecting dependencies for tests.
- Scratch files go under `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/`, never in the repo.


Tasks 2 to 5 are done too. What the screen gets from them (read `apps/desktop/src/shared/api.ts` as it is in the repo; it is what counts, not this summary):

- `GraphicView` has, besides what it had: `written: boolean` (a motion piece has its fragment), `stale: boolean` (its words changed, or it now has less time than it was written for, so it must be written again), `writeFailed: string | null` (why its last writing failed, one problem per line). For a motion piece `summary` is its idea and `spec.kind` is `"motion"`. A piece that is unwritten or stale comes with `render: "waiting"`, no poster and no error, and will not be written into the draft.
- `PostWorkState`'s running variant may carry `done` and `total` (the graphics work reports the pieces written so far).
- `DesktopApi.redoGraphic(folder, anchor, request): Promise<PostRunView>`, shaped like `rethinkPost`: one run of the graphics work that writes that one piece again.
- `setGraphic(folder, anchor, { off })` and `setGraphic(folder, anchor, null)` work on a motion piece; nothing else is patched any more. `retryGraphic` is unchanged.

## Your task, as the plan has it

### Task 6: Renderer — rows, states, redo, progress; the sheet goes

**Files:**
- Modify: `renderer/src/edit/FlairTab.tsx`, `GraphicsTab.tsx`, `PlanStrip.tsx`, `WriteButton.tsx`, `renderer/src/screens/PostScreen.tsx`, `renderer/src/room/ClipRoom.tsx` (a `redoGraphic` action), `renderer/src/format.ts` (`playedSeconds` moves here), `renderer/src/i18n.ts`, `renderer/src/styles/edit.css`, their tests
- Move to the Trash: `renderer/src/edit/GraphicSheet.tsx`

- [ ] **Step 1: Tests**
  - a row shows the poster when there is one, the idea, the reason, the point, the length
  - the state line, one of: `กำลังเขียน…` (unwritten, no failure, a run going), `ยังไม่ได้เขียน` (unwritten, no run), `เขียนไม่สำเร็จ · <last lines>` (`writeFailed`), `การตัดช่วงนี้เปลี่ยนไป กดทำใหม่` (stale: its words changed, or it now has less time than it was written for), then the render states as today, and `ปิดอยู่` when off
  - buttons: `ทำใหม่` always (disabled while busy or a run goes), calling `api.redoGraphic` with the request the room sends for a plan, as `rethinkPost` is called; `ลองเรนเดอร์ใหม่` only when the render failed; off/on; remove. There is no edit button and no sheet.
  - the plan strip's running line for graphics reads `กำลังเขียนกราฟิก {done} จาก {total}` when the state carries them, and the plain running line otherwise
  - the switch's hint is the text of spec §8
  - the write sheet (`WriteButton.tsx`): a piece that is on but not written, or stale, will not be written into the draft, so it is left out of the count of graphics to write and of the renders counted as done and awaited, and a warning line says how many such pieces there are (`write.check.graphicsUnwritten`: `กราฟิก {count} ชิ้นยังไม่ได้เขียนหรือต้องทำใหม่ จะไม่ถูกใส่`)
- [ ] **Step 2: Implement.** Remove `editingGraphic`, `onEditGraphic` and the sheet's mount from `PostScreen` and `GraphicsTab`; remove the `showsFailure` argument of `changeHighlightText` if nothing else passes it. Remove the ~31 sheet tests in `PostScreen.test.tsx` and give the row tests a motion fixture (`MOTION` with `idea`, `written: true`).
- [ ] **Step 3: i18n.** Add `graphics.redo`, `graphics.redoLabel`, `graphics.state.writing`, `graphics.state.unwritten`, `graphics.state.writeFailed`, `graphics.state.stale`, `post.run.writingGraphics`. Rewrite `flair.graphicHint`. Remove the sheet's keys, the sticker motions and the piece kinds once nothing uses them (`graphics.refused.*` are about cutaways and stay).
- [ ] **Step 4:** `npm test` and `npm run typecheck`.

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

Task 5 (the main process: `apps/desktop/src/main/flair.ts`, `post-plan.ts`, `highlight-api.ts`, `motion-write.ts`, `highlights.ts`) is being reviewed and may get a short fix round while you work. The api it added is in the repo and is not expected to change. While you work, run only your own test files; at the end run `npm test` and `npm run typecheck` once, and if a failure is in a file under `apps/desktop/src/main`, run again after a minute and then report it as theirs. You own the renderer (`apps/desktop/src/renderer/src/**` and `apps/desktop/src/renderer/test/**`). Do not change `apps/desktop/src/main`, `apps/desktop/src/shared` or `packages/core`; if the screen needs something the api does not give, stop and say what.

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
