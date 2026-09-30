You are implementing Task 7 of the BOXBLACK 0.5.0 plan: "The old kit leaves; old graphics are cleared once".

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


Tasks 2 to 6 are done too: Claude plans and writes motion graphics, the renderer renders and inspects them, the main process places them and judges which are stale, the graphics work writes them three at a time with one repair, and the screen shows each piece's state with a redo. The kit of cards and stickers, its emoji pictures and its planning prompt are still in the repo beside all that, unused by the graphics work. This task takes them out, and clears the graphics that old projects still hold.

## Your task, as the plan has it

### Task 7: The old kit leaves; old graphics are cleared once

**Files:**
- Core: `graphics/plan.ts` (only `MotionSpec` and the generic parts stay; `GraphicSpec = MotionSpec`), `graphics/direct.ts` (the card prompt, schema and validators go; the generic helpers stay, or move into `motion/direct.ts`), `graphics/framing.ts` (`renderBox` and its margins go), `graphics/index.ts`, `package.json` exports; move to the Trash: `graphics/emoji.ts`, `emoji.test.ts`, `graphics/kit/` (whole folder), and the tests that only tested the kit
- Main: `flair.ts` (`knownEmoji`, the patch of pieces), `graphics-cues.ts` (kit-only steps, `summaryOf`, `KIND_NAMES`, `MOTION_NAMES`, sticker bands), `graphics-render.ts` (the card path, emoji pictures, `EmojiPicturesError`), `highlight-api.ts` (`checkedPatch` takes `{ off }` only), `highlights.ts`, `index.ts` (no `kitAssets`, no `readEmojiSet`), `post-cleanup.ts`, `project-files.ts`, `shared/api.ts` (`GraphicPatch = { off?: boolean }`, `GraphicsProblem` without `"emoji"`, `GraphicView` without `storedMotion`)
- Renderer: the emoji problem banners in `FlairTab.tsx` and `SettingsScreen.tsx`, their i18n keys
- App resources and scripts, to the Trash: `apps/desktop/resources/graphics/kit.js`, `timeline.js`, `kit.css`, `apps/desktop/resources/graphics/emoji/`, `apps/desktop/scripts/fetch-fluent-emoji.mts` and its test, `apps/desktop/scripts/graphics-kit-check.mjs` and its test, `apps/desktop/src/main/graphics-kit.test.ts`
- `apps/desktop/scripts/release-check.ts` and its test: the emoji checks go; add a check that `resources/graphics/host.js` exists

- [ ] **Step 1: Tests for the one-time clean-up**
  - an outline at post version 1 (after M25) loses every stored graphic, edited ones too, and is stamped version 2; Claude's unedited sounds that only a removed graphic held go with it (use the existing `withoutSoundsOn`/`heldMoments` logic); highlight groups, zooms, cutaways and other sounds stay
  - an outline with no post version gets the M25 clean-up and this one, and ends at version 2
  - an outline already at version 2 comes back the same object
  - the store copies the original to `outlines-before-050` before the first write of this step, never overwrites a copy that is there, and writes nothing if the copy fails; the M25 copy folder is used only for outlines with no post version
  - a new outline from the planner is stamped version 2
- [ ] **Step 2: Implement the clean-up.** `POST_VERSION = 2`. `OutlineStore` takes steps `[{ below: 1, upgrade, backupDir }, { below: 2, upgrade, backupDir }]` (or an equivalent shape) and runs each whose version the outline is below, backing up once per step's folder.
- [ ] **Step 3: Remove the kit and the emoji.** Let the compiler lead: delete the types, then fix every place it flags by removing the card and sticker path (not by adapting it). Move the files listed above to the Trash with `mv`. `electron-builder.cjs` keeps copying `resources/graphics` (now `host.js` only).
- [ ] **Step 4: Search** `packages/core/src` and `apps/desktop/src` for `sticker` (outside CapCut's own sticker tracks in `capcut/`), `CardSpec`, `PieceKind`, `kitAssets`, `KIT_VERSION`, `EMOJI_SET`, `readEmojiSet`, `GraphicSheet`, `emojiProblem`. Expected: nothing.
- [ ] **Step 5:** `npm test` and `npm run typecheck`.

## What is already decided (do not re-decide these)

- **Two jobs, in this order, each ending green:** first the one-time clean-up (Steps 1 and 2), which adds code and tests; then the removal (Steps 3 and 4), which the compiler leads.
- **The clean-up of 0.5.0** is a second upgrade beside M25's (`withoutOldEffects` in `apps/desktop/src/main/post-cleanup.ts`):
  - It applies to an outline whose `postVersion` is 1 (and, after M25's own upgrade has run in the same read, to one that had none). It takes out every stored graphic that is not a motion piece, the ones the user edited too (the user chose this on 2026-09-30: the kit is gone, and a backup is kept), keeps any motion piece, and stamps `postVersion: 2`. An outline already at 2 comes back as the same object.
  - Claude's unedited sounds that only a removed graphic held go with it, by the logic `flair.ts` already has for a removed graphic (`startMoment`, `withoutSoundsOn`, `heldMoments`); if those are private to `flair.ts`, move them to where both can use them rather than copy them. Highlight groups, looks, zooms, cutaways, edited sounds and every other sound stay.
  - `POST_VERSION` becomes 2, and a new outline from the planner is stamped with it.
- **The store runs upgrades as steps.** `ProjectFiles` (`project-files.ts`) takes an ordered list of steps, each an upgrade with its own backup folder, in place of the one `upgrade` and `backupDir` (keep the single-upgrade form working if other stores use it; look before you change the type). For a file on disk, the steps run in order on what the step before gave. The file as it is on disk is copied, before the first write, into the backup folder of the first step that changed it, and into no other: an outline from before M25 goes to `outlines-before-m25` only (that copy is its way back past both steps), an outline at version 1 goes to `outlines-before-050`. A copy that is already there is never written over, and nothing is written when the copy cannot be made, as today. `index.ts` wires the two steps; the new folder is `join(userData, "outlines-before-050")`.
- **After this task `GraphicSpec` is `MotionSpec`.** Code that read the union loses its branches; `isMotion` stays only where stored data is read, because an outline file is outside the type system: a stored graphic whose `kind` is not `"motion"` (a file edited by hand, a future kind) is left out where graphics are read for placing, neither placed, listed, nor counted as dropped. One test.
- **The removal follows the plan's list.** Delete a type, then remove every branch the compiler flags; do not adapt the kit's code to the new types. What goes to the Trash goes with `mv <path> ~/.Trash/<name>-0930` (the emoji folder is about 54 MB of pictures: move the folder whole, in one `mv`). Tests that only tested the kit go with it; tests of generic behaviour that used a card as their fixture (placement, the write, the preview, sounds on a graphic) are kept and given a motion fixture, not deleted: say in your report which tests you moved to a motion fixture and which you removed, by count per file.
- **What stays, because it is not the kit's:** `packages/core/src/graphics/plan.ts`'s generic parts (`GraphicCue`, `GraphicBox`, `enforceGraphics`, the length limits, `PlacedGraphic`), `framing.ts`'s `stageBox`, `placeOnCanvas`, the dodge helpers and `mergeBands`, the word matching and the frame helpers of `graphics/direct.ts` that `motion/direct.ts` imports (move them into `motion/direct.ts` or a small module beside it if nothing else of `graphics/direct.ts` is left, and delete the file), `capcut/graphics.ts`, the renderer pack and everything about it, `graphics-files.ts`, the fonts.
- **`GraphicPatch`** becomes `{ off?: boolean }`; `GraphicsProblem` loses `"emoji"` (its `kind` may then go altogether if only one value is left: keep the field if removing it would ripple through the renderer's texts, and say which you did); `GraphicView` loses `storedMotion`. The emoji problem banners and their i18n keys go from the renderer; the renderer's emoji problem in the graphics renderer (`emojiProblem`, `EmojiPicturesError`) goes.
- **`release-check.ts`**: the emoji checks go; a new check fails the release when `apps/desktop/resources/graphics/host.js` is missing or empty. `electron-builder.cjs` keeps copying `resources/graphics`, which now holds `host.js` alone.
- **Docs are not yours**: the controller does Task 8 (version, specs, the install guide). Do not change the version number.

## Carried over from the reviews of Tasks 5 and 6

Small things left for this task, because it works in the same files. Each gets its test where it changes behaviour.

- **Already gone, so not yours to remove:** `knownEmoji` in `flair.ts` (Task 5 took it out with the kit's planning call), `GraphicSheet.tsx`, its state, its i18n keys and its CSS (Task 6). Where the plan's list names something the search no longer finds, it is done.
- **`flair.ts`, `renderProblems`:** a stop that lands while `graphicsReady()` or `candidateJob()` is awaited ends the writing at once (that is `writePiece`'s doing), but the check goes on and still asks the renderer for a render after the stop. Hand `renderProblems` the work's signal and answer null before `renderer.wait` once it has aborted. One test: a stop during a held `candidateJob` leaves `wait` uncalled.
- **`flair.ts`, the comment on `writeGraphic`:** one clause more. A writing that `writePiece` had already answered is stored even when the stop lands during the store: it passed every check before the stop, so it counts among "the graphics already written".
- **`flair.ts`, the pool's callback:** its parameter is `motion`, in a file where `motion` has meant a sticker's motion. Call it `placed`.
- **Do not reshape how a motion graphic is placed.** `graphicsInForce` keeps, for a motion graphic, exactly the steps it has now (the level, the place on the cut, the length, the dodge of keep-clear, highlight text and subtitles, `enforceGraphics`, the words now, stale). A task after this one changes what a graphic may cover, and it needs those steps as they are. Remove the kit's steps around them and nothing else.
- **The room's new state** (`redoing`, `writingGraphics` in `room/ClipRoom.tsx`, from Task 6's fix round) is not the kit's: leave it.

## Other implementers

Nobody else is working while you do. This task touches `packages/core`, `apps/desktop/src/{main,shared,renderer}`, `apps/desktop/resources/graphics` and `apps/desktop/scripts`.

## Before you begin

If anything about the requirements, the approach or the code is unclear, ask now, before you write code. It is always fine to stop and ask.

## Your job

1. Write the tests of the clean-up first and watch them fail; then the code.
2. Then the removal, led by the compiler; run the tests as you go.
3. The searches of Step 4, with their results in your report.
4. `npm test` and `npm run typecheck` from the repo root.
5. Review your own work with fresh eyes, and report.

If the removal pulls at something the plan did not list, or a generic behaviour turns out to depend on the kit, stop and report `BLOCKED` or `NEEDS_CONTEXT` with what you found rather than improvise.

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented, step by step
- What you saw fail before the code (red) for the clean-up, and the final results of `npm test` and `npm run typecheck` (the counts, and how many tests went with the kit)
- Files changed, files moved to the Trash (each with its new name there)
- The results of the Step 4 searches
- Anything you decided that the task did not spell out, and why
- Self-review findings and any concerns
