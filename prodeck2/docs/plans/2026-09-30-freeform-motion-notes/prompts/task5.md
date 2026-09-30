You are implementing Task 5 of the BOXBLACK 0.5.0 plan: "Main: plan, write three at a time, check, repair once, redo".

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


Tasks 2, 3 and 4 are done too. What they give you:

```ts
// packages/core/src/graphics/motion/direct.ts   ("@boxblack/core/graphics/motion/direct")
export const MOTION_PLAN_PROMPT_VERSION: string
export async function planMotion(args): Promise<{ graphics: GraphicCue[]; dropped: number }>   // like today's planGraphics, less the known emoji; every spec has html: null
export function motionWords(sentence: GraphicSentence, fromSourceUs: number, seconds: number): MotionWord[]

// packages/core/src/graphics/motion/write.ts   ("@boxblack/core/graphics/motion/write")
export function motionBrief(args: { stage: { width: number; height: number }; seconds: number; words: MotionWord[]; idea: string; about: string }): string
export function repairBrief(args: { brief: string; html: string; problems: string[] }): string
export function writeMotion(args: { transport; model; brief: string; signal?: AbortSignal }): Promise<string>   // one Claude call; the fragment, not linted

// apps/desktop/src/main/graphics-render.ts
// renders and inspects a motion job. failureOf(hash) is the graphic's failure in plain words, one problem per line
// (no "Error: " prefix), written to be read by Claude; machineReady() is false when a render found the machine unfit
// (the pack, ffmpeg, a folder that cannot be written, a browser that never started); forgetMachine() looks again.

// apps/desktop/src/main/graphics-cues.ts and highlights.ts
// graphicsInForce places a motion piece; a PlacedGraphic of one carries wordsNow (the words it has now, with their
// times now) and stale; graphicJob answers a job only for a piece that is written and not stale; graphicJobs answers
// { kept, jobs } with jobs[i] the job of kept[i] or null.
```

Read those files as they are in the repo before you start: their names and shapes there are what counts, not this summary.

## Your task, as the plan has it

### Task 5: Main — plan, write three at a time, check, repair once, redo

**Files:**
- Modify: `apps/desktop/src/main/flair.ts`, `post-plan.ts`, `highlight-api.ts`, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/preload/*` (the bridge for `redoGraphic`), their tests, `renderer/test/fake-api.ts`
- Create: `apps/desktop/src/main/motion-write.ts`, `motion-write.test.ts`

- [ ] **Step 1: Tests for `motion-write.ts`** — `writePiece(piece, deps)`, where the piece is what a brief needs (stage, seconds, words, idea, about) and the deps are a fake transport and a fake `render(html)` that answers the fragment's problems, none, or null when the machine cannot render; the module knows nothing of outlines or the renderer:
  - writes, lints, renders, and answers the fragment when all pass; one transport call
  - a lint problem → one repair call whose brief (`repairBrief`) carries the first brief, the problems and the fragment; the repaired fragment is linted and rendered again; stored when it passes; two transport calls
  - a render failure (`render` answers `nothing was drawn…`) → the same single repair, its brief carrying each problem on a line of its own
  - still failing after the repair → `{ failed }`, the last attempt's problems (the first three, one per line); never a third call, whether the repair was spent on the lint or on the render
  - the machine cannot render (`render` answers null) → the fragment that passed the lint is the answer, unrendered, with no repair
  - an abort rejects with the cancel error and answers nothing
  - a call that fails for any other reason (the token limit, a refusal, Claude Code failing, a timeout) is that piece's failure, `{ failed: <the message> }`, with no repair; the other pieces go on
  - `writeAll(pieces, write, onProgress)` runs at most three at a time (assert the high-water mark with held promises), reports `(done, total)` after each piece settles, and carries on after one fails
- [ ] **Step 2: Implement `motion-write.ts`.** A piece is written for the room it has now, not for what the plan wished: `seconds` is how long it plays on the cut now (what `graphicsInForce` gives it, which is the plan's seconds or up to the end of the piece of the cut, never under 1.5 s), and `words` are `wordsNow` for that length. The brief comes from `motionBrief` with the stage from `stageBox(box, canvas)` of the box as it is placed now, that `seconds`, those `words`, the idea, and `about` from the outline's title and summary (and the brief's video type when there is one). What is stored with the fragment is `html`, that `seconds` and those `words`, so the spec says truthfully what the fragment was written for, and the piece is fresh until the cut changes again. A redo does the same, which is how a stale piece is put right.
- [ ] **Step 3: Tests for the graphics work** (`flair.ts` `planGraphics`, `post-plan.ts`):
  - with graphics on, the work calls `planMotion`, stores the cues as it stores Claude's answer today (edited ones kept, points of theirs excluded, items for points not shown kept), then writes every piece in force at the level set that is unwritten and not off, each for the room it has now, storing each as it settles (the fragment, the seconds and the words it was written for; or `html: null` and `failed`); a candidate that has not passed is never stored
  - the work's running state carries `{ done, total }` as pieces settle; it ends `done` with `count` = pieces written and `dropped` = what the plan dropped plus pieces that failed
  - "หยุด" during the writing stops the remaining calls; pieces already written stay; the work ends as stopped does today
  - a rethink of graphics plans again: unedited pieces are replaced, as today
  - `redoGraphic(folder, anchor, request)`: one run of the graphics work alone, refused while another run goes on the project; it writes that piece again through `writePiece` for the room it has now, keeps its old fragment until the new writing has ended, then stores the new one or `html: null` with `failed`; a piece with no place now fails the work with `this graphic has no place on the clip now`; it does not mark the piece edited and leaves every other piece alone
  - `setGraphic(anchor, { off })` and `setGraphic(anchor, null)` work on a motion piece as today
- [ ] **Step 4: Implement.** When the graphics work begins writing, and when a redo begins, the renderer's `forgetMachine()` is called, so a machine fault the user has mended does not leave the writing in its no-render path. `PostWorkState`'s running variant gains optional `done` and `total`. Add `redoGraphic` to `DesktopApi`, the preload bridge, `highlight-api.ts` and `fake-api.ts`. The render check is built in `flair.ts` from one small function added to `highlights.ts` that gives the job a placed piece would have with a candidate fragment, so the render the check makes is the one the preview and the write use.
- [ ] **Step 5:** `npm test` and `npm run typecheck`.

## What is already decided (do not re-decide these)

- **`motion-write.ts` knows nothing of outlines, placements or the renderer.** It is the loop and the pool, with everything else handed in:
  ```ts
  export interface PieceToWrite { stage: { width: number; height: number }; seconds: number; words: MotionWord[]; idea: string; about: string }
  export interface WriteDeps {
    transport: LlmTransport
    model: string
    /** Renders the fragment as the piece would be rendered and says what is wrong with it: its problems, one each; none when it renders and passes inspection; null when this machine cannot render now (no pack, a machine fault, renders stopped). */
    render: (html: string) => Promise<string[] | null>
    signal?: AbortSignal
  }
  export type Written = { html: string } | { failed: string }
  export async function writePiece(piece: PieceToWrite, deps: WriteDeps): Promise<Written>
  export async function writeAll<P>(pieces: P[], write: (piece: P) => Promise<void>, onProgress: (done: number, total: number) => void): Promise<void>   // at most three at a time
  ```
  (Adjust a name if the code reads better, but keep this division: the caller in `flair.ts` builds `render` and stores the result.)
- **The loop of `writePiece`**: `motionBrief` → `writeMotion` → `lintFragment`. Problems at any point go to the one repair: `repairBrief({ brief, html, problems })` → `writeMotion` again → lint again. A fragment that passes the lint is rendered (`deps.render`): `[]` means done; problems go to the repair if it has not been used, and what comes back is linted and rendered again; `null` means the machine cannot render, and the fragment that passed the lint is the result, unrendered. There is one repair per writing, whatever it is spent on: after it, a lint or render failure is the end, `{ failed }`, never a third call. `failed` is the last attempt's problems joined by line breaks, the first three. An empty answer from Claude is a lint problem like any other (the linter says so). An abort (the signal) rejects with the error the transport rejected with, and nothing is returned.
- **A call that fails is that piece's failure, not the run's.** When `writeMotion` rejects for any reason but the stop (the reply hit the token limit, Claude declined, Claude Code failed, the call timed out), `writePiece` answers `{ failed: <the error's message> }` with no repair, and the other pieces go on. Only the stop (the signal aborted) rejects.
- **Jobs that are null never reach the renderer.** Task 4 made `graphicJobs` answer `jobs[i]` or null; the early start of renders in `planGraphics` filters them, and nothing tests that yet: pin it (a plan whose pieces are all unwritten hands the renderer no job).
- **A piece is written for the room it has now** (the plan's Step 2 says why): `seconds` is the played length of the placed piece, to the millisecond below (`renderSeconds(durationUs)`, which `graphics-cues.ts` exports for this); `words` are its `wordsNow`; the stage is `stageBox` of its box as placed (after the dodge) on the canvas; `about` is the outline's title, then `: `, then its summary, cut to 300 characters on a grapheme, with ` (<video type>)` after it when the brief has a video type.
- **The render check the caller builds** makes the job the piece will really have once stored: the placed piece with its spec's `html`, `seconds` and `words` set to the candidate's and `stale: false`, through the same `graphicJob` and the same canvas, fps, font and palette the preview uses (add one small function to `highlights.ts` for it, beside `jobFor`), then `renderer.wait([job], folder)`. Ready → `[]`. Failed → `failureOf(hash)` split into lines, empty lines dropped. Neither (the pack is missing, a machine fault, renders stopped) → `null`. With no renderer in the deps, or `graphicsReady()` false before the render → `null`. Because the job is the one the stored piece gets, the render made by the check is the render the preview and the write use: nothing is rendered twice.
- **The machine is looked at afresh.** When the graphics work begins writing, and when a redo begins, call the renderer's `forgetMachine()` (it clears what an earlier render found wrong with the machine, and nothing else: each graphic's own failure stays), so that a fault the user has since mended, a full disk freed, does not leave the writing in its no-render path until the app is restarted.
- **What is stored**, in one update of the latest outline per piece, the cue found by its anchor (`samePlace`): for a written piece, its spec with `html`, that `seconds` and those `words`, and `failed` removed; for a failed one, `html: null` and `failed`. A piece removed meanwhile is left alone. Nothing about a piece is stored before its writing has ended: a candidate that has not passed is never in the outline.
- **Which pieces the graphics work writes**, after it has stored the plan: the pieces in force now at the level set (the `kept` of `graphicJobs`), that are motion pieces, not written (`html` null) and not off. A piece the level hides, one with no room on the frame, and one switched off are not written by the run. Three at a time, each stored as it settles, progress `(done, total)` after each.
- **The work's end**: `count` is the pieces written in this run; `dropped` is what the plan dropped plus the pieces whose writing failed. With nothing to write it ends as it does today.
- **Stop.** The run's signal goes to every call. When it aborts, the calls in flight reject, no further piece starts, the pieces already stored stay, and the work ends the way a stopped Claude call ends a work today (the run marks it; look at `post-plan.ts`).
- **Progress.** `PostWorkState`'s running variant gains optional `done` and `total`. The run hands the work a way to report them (`post-plan.ts`), and `planGraphics` reports after each piece settles, and once before the first with `(0, total)`.
- **A switched-off piece** is listed with a length the end of the rough cut has not trimmed (Task 4 judges it by the trimmed one). When one is written again by a redo, its room is that listed length cut at the end of the rough cut, so that it is not stale the moment it is switched on.
- **`redoGraphic(folder, anchor, request)`** in `DesktopApi` is `redoGraphic(folder: string, anchor: CueAnchor, request: PostRequest): Promise<PostRunView>`, shaped like `rethinkPost`: the screen sends the same request it sends for a plan. It is one run of the `graphics` work alone (refused while another run goes on the project, as any run is), which writes that one piece again for the room it has now and stores the result, with progress `(0, 1)` then `(1, 1)`. The piece is looked for among the placed ones, kept or off; when it has no place now (its point is hidden by the level, or there is no room for it), the work fails with `this graphic has no place on the clip now`. Its old `html` stays in the outline until the new writing has ended, and is then replaced by the new fragment or by `html: null` with `failed`. A redo does not mark the piece edited, and touches no other piece. Add it to the list of method names the preload bridge is built from, to `highlight-api.ts` (checked as `rethinkPost`'s arguments are) and to `fake-api.ts`.
- **`setGraphic`** on a motion piece: `{ off }` and `null` (remove) work as today; any other key of the patch is refused for a motion piece as an unknown key is refused today. Task 1 left `changedGraphic` skipping a motion spec, with a test that pins the skip: replace both with this.
- The kit's planning (`planGraphics` of `@boxblack/core/graphics/direct`, the known emoji) is no longer called by the graphics work; leave its code and its other callers alone, since Task 7 removes them.

## Other implementers

Nobody else is working while you do. You own: `apps/desktop/src/main/flair.ts`, `post-plan.ts`, `highlight-api.ts`, `motion-write.ts` (new), their tests, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/preload/*`, `apps/desktop/src/renderer/test/fake-api.ts`, and one small function in `apps/desktop/src/main/highlights.ts` with its test. Do not change renderer code (the screen is Task 6), `graphics-render.ts`, `graphics-cues.ts` or anything in `packages/core`; if one of them needs a change for your task, stop and say which and why.

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
