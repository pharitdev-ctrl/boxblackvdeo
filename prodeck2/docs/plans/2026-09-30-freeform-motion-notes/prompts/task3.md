You are implementing Task 3 of the BOXBLACK 0.5.0 plan: "Main: render a motion job and inspect it".

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


## Your task, as the plan has it

### Task 3: Main — render a motion job and inspect it

**Files:**
- Modify: `apps/desktop/src/main/graphics-render.ts`, `graphics-render.test.ts`, `apps/desktop/src/main/index.ts` (pass `motionAssets`)

**Found after Task 1's review, proven in the spike (see the notes' README and spec §6):**
- HyperFrames exits 0 even when the page's script is broken, and takes 20 s to give up on a page that never registers its timeline. So the render's output is scanned for what it prints.
- `host.js` moves to the third version in the notes (`spike/host-v3.js`): `window.frame` runs inside a try/catch that reports each distinct message once with `console.error("BOXBLACK motion error: …")`, and the timeline still registers, so a throwing frame function fails fast and with its message.
- The third version also checks, once, before the first draw, for the one silent fault the trial of 2026-09-30 found (1 fragment in 8): an SVG element that has a `transform` attribute and an animation of its `transform`, which replaces the attribute, so the element jumps to the corner of the drawing. It reports it through the same `console.error`, naming the element, and the same scan fails the render with it. One real repair call given that message returned a corrected fragment (`spike/trial-r1/5.html` and `5-repaired.html`). It raised no alarm on the other 13 fragments.
- Every render runs Chrome through a wrapper script (`spike/chrome-offline.sh`) that adds `--proxy-server=http://127.0.0.1:9 --force-webrtc-ip-handling-policy=disable_non_proxied_udp --block-new-web-contents`.
- Renders of the same page are not byte-identical from run to run; never compare rendered files by hash in a test.
- Captured for the tests: `spike/renderer-output-samples.txt` (the lines HyperFrames printed for a syntax error, a throwing `window.frame`, a page that navigates away and a policy violation; a normal render prints no line starting `[Browser:`) and `spike/inspect-A.txt` (the whole output of the inspection command for one render). The notes' README has the inspection's numbers.
- The repo's own page and host were rendered by the controller through the real pack and the wrapper on 2026-09-30 (`spike/e2e.mts`): fragments A and F, under three real palettes, all visible and all gone at the end.

- [ ] **Step 0: Tests for the three additions**
  - `graphics-host.test.ts`: a `window.frame` that throws is reported once per distinct message through `console.error` with the prefix `BOXBLACK motion error: window.frame threw: `, the animations are still set on that draw and later draws, and the timeline is registered all the same. An animation whose target is an SVG element with a `transform` attribute and whose keyframes hold a `transform` is reported once, as `BOXBLACK motion error: <g class="…"> has a transform attribute and an animation of its transform: …` (the words are in `spike/host-v3.js`), before the first draw; the same animation on an element without the attribute, on an HTML element, or with `composite: "add"` is not, and an effect that throws when read is passed over. Then replace `host.js`'s code with `spike/host-v3.js` (header kept, with a sentence for each of the two reports).
  - `graphics-render.test.ts`: before a render, a file `chrome-offline.sh` is written in the work folder, executable, whose one command execs the pack's Chrome with the three flags and `"$@"` (the path in single quotes, each `'` in it written `'\''`, since it runs through `Application Support`); the render's `HYPERFRAMES_BROWSER_PATH` is that file; the pack's own Chrome must still exist or the render is refused as today.
  - `graphics-render.test.ts`, the output scan (give the injected `run` an output to return; the real `runHyperframes` returns the process's combined output): a line `[Browser:PAGEERROR] Unexpected token ';'` fails the job with `the script failed: Unexpected token ';'`; lines `[Browser:ERROR] BOXBLACK motion error: <message>` fail it with their distinct messages, in the order they came, the first three joined by `; ` (each line comes once per Chrome worker; one `window.frame threw: boom` gives `window.frame threw: boom`); `sub_timeline_readiness_timeout` fails it with `the page never became ready (its script did not finish)`; the first of these found wins, in that order; none of them is the machine's fault; a card job ignores the scan.
  - `graphics-render.test.ts`, the lint at render time: a motion job whose fragment fails `lintFragment` is failed with `the fragment was refused: <first three problems joined by "; ">` and nothing is rendered.

- [ ] **Step 1: Tests** (with the injected `run`, `poster` and a new injected `inspect`):
  - a motion job's page is `motionHtml(...)` with the stage from `stageBox`, the job's `times`, palette and font; the font file is copied beside it; no emoji picture is asked for
  - its hash changes with the fragment, any time, the box, seconds, canvas, fps, font, palette; it does not change with `why`, `idea`, `words` or `failed`
  - the meta written last is `{ width, height, durationUs, place: placeOnCanvas(stage box, canvas) }`
  - `inspect` says nothing visible → the job fails with `nothing was drawn: every frame is empty`; still visible at the end → `it is still on screen at the end: everything must be invisible at D`; both are the graphic's failures (kept for `failureOf`, cleared by `retry`), not the machine's
  - the file is inspected where HyperFrames wrote it, before it is moved into the graphics folder: a refused render leaves no file, poster or meta there
  - a motion job whose `html` is null fails with `the graphic has not been written`, and nothing is rendered (Task 4 stops such a job being made)
  - a render that HyperFrames fails keeps its last lines as the failure, as today
  - a card job still renders as before (until Task 7)
- [ ] **Step 2: The real `inspect(path)`** runs the bundled ffmpeg: `-i <mov> -vf "alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-" -f null -`, reads one `YMAX` per frame from stdout, and answers `visible = some frame's max > 16` and `goneAtEnd = the last frame's max <= 16` (on the 8-bit scale ffmpeg reports after `format=gray`; add `format=gray` before `signalstats`). Test the parser on a captured sample of that output (`spike/inspect-A.txt`, inlined as three frames), that the app's ffmpeg missing is an `EnvironmentError`, and that ffmpeg failing on the file fails the graphic, as a failed poster does today (one unreadable file must not mark the machine unfit, which would stop every graphic and send the writing work into its no-render path).
- [ ] **Step 3: Implement.** `RenderJob` for a motion spec carries `times: number[]`. Keep one queue, one render at a time.
- [ ] **Step 4:** `npm test` and `npm run typecheck`.

## What is already decided (do not re-decide these)

- **Where your work is read.** Task 5 will run write, lint, render, inspect and at most one repair. It reads `failureOf(hash)` and hands the text to Claude as the reason to repair. So every failure message you write for a motion job is read by Claude: plain English, saying what was wrong, as the task's strings do. Keep the strings the task gives exactly.
- **`RenderJob.times?: number[]`**: the times now, in seconds from the graphic's start, of the words a motion graphic was written for; absent for a card or a sticker, and read as `[]` when a motion job has none. Task 4 makes sure a motion job's times match its words, so do not check that here.
- **The hash of a motion job** is made of the fragment, the box, the seconds, the times, the canvas, the fps, the font, the palette and `MOTION_VERSION` (the constant; no injected version). It does not take `why`, `idea`, `words`, `failed` or the spec's stored `version`. A card's and a sticker's hash stay exactly as they are.
- **`GraphicsRenderDeps` gains** `motionAssets: () => Promise<MotionAssets>` (the app's `host.js`, read from `Resources/graphics`) and an optional `inspect?: (mov: string) => Promise<Inspection>` (the real one by default, as `poster` has). `index.ts` passes `motionAssets(join(resourcesDir, "graphics"))`, read once and kept, and a read that fails is not kept, so the next ask reads again (as the emoji set is handled a few lines above). A host that cannot be read is the app's fault, not the graphic's: an `EnvironmentError` saying `the app's motion host is missing: reinstall BOXBLACK`.
- **`run`'s type** becomes `(project, output, fps, signal) => Promise<string | void>`: what the renderer printed, standard output and standard error together. The real `runHyperframes` returns it; a fake that returns nothing means nothing was printed. Only a motion job's output is scanned.
- **The order for a motion job in `render()`**: already made → return; the font's file name is a name alone (as today); `html` null → `the graphic has not been written`; `lintFragment` → `the fragment was refused: …`; write the page and copy the font; run; scan the output; inspect the file where HyperFrames wrote it; only then move it into the graphics folder, make the poster (at `seconds / 2`, as today) and write the meta last. All of these failures are plain `Error`s (the graphic's), except a font that cannot be copied, a missing ffmpeg and a missing host, which are `EnvironmentError`s (the machine's).
- **The output scan**, first match wins, in this order (see `spike/renderer-output-samples.txt` for the real lines; a line appears once per Chrome worker, so take the first):
  1. a line `[Browser:PAGEERROR] <message>` → `the script failed: <message>`
  2. lines `[Browser:ERROR] BOXBLACK motion error: <message>` → their distinct messages in the order they came, the first three, joined by `; ` (one message gives just that message)
  3. the text `sub_timeline_readiness_timeout` anywhere → `the page never became ready (its script did not finish)`
  Any other `[Browser:ERROR]` or warning line is left alone.
- **The Chrome wrapper** is written by a small exported function beside `renderBinDir` (your name for it), into the work folder, before every render, and its path is what `HYPERFRAMES_BROWSER_PATH` gets, for every render (cards and stickers too, until they leave in Task 7). Its content is a `#!/bin/sh` line, one comment line saying what it is, and one command: `exec '<the pack's Chrome>' --proxy-server=http://127.0.0.1:9 --force-webrtc-ip-handling-policy=disable_non_proxied_udp --block-new-web-contents "$@"`, the path in single quotes with each `'` inside it written `'\''` (the real path runs through `Application Support`, and a path is never trusted to be plain). Mode 0o755. The check that the pack's own Chrome is a file stays where it is, before this.
- **`host.js`**: keep its header comment, replace its code with the code of `spike/host-v3.js` (everything from `;(function () {` on, unchanged: that exact code was rendered by the real renderer on 14 fragments), and add to the header two sentences: that an error thrown by `window.frame` is caught and reported once per distinct message through `console.error` with the prefix `BOXBLACK motion error: `, so that the renderer's output carries it and the timeline still registers; and that before the first draw the host reports, the same way, every SVG element that has a `transform` attribute and an animation of its `transform`, since the animation replaces the attribute and the element jumps to the corner of the drawing. The header's rule that the file never names the renderer's own runtime file stays true. The fake document of `graphics-host.test.ts` will need an `SVGElement` in the context, fake elements that are instances of it (with `tagName`, `getAttribute`, `hasAttribute`), and animations whose `effect` has `target`, `composite` and `getKeyframes()`.
- **The inspection** reads the alpha of every frame with the app's ffmpeg (the command is in the task and in the notes' README; with `-nostdin -v error` in front, standard output holds only the `frame:` and `lavfi.signalstats.YMAX=` lines). A render with no frame at all counts as nothing visible.
- The interim skip Task 1 left at the top of `render()` (`if (isMotion(job.spec)) return`) and the test that pins it are yours to invert.

## Other implementers are working at the same time

All of them work in `packages/core`, and you work in `apps/desktop`.
- A short fix round on Task 1 is running now. It owns `packages/core/src/graphics/motion/lint.ts`, `shape.ts`, `html.ts`, their tests, a new `packages/core/src/graphics/motion/fixtures/` folder, and `apps/desktop/src/main/graphics-page.test.ts`. It loosens a few of the linter's name rules and tightens a few others; `lintFragment`'s signature and the meaning of its answer do not change. In your own tests use small fragments that plainly pass (a `<style>` with `@keyframes` and an animation, then a `<div>`) or plainly fail (a `<script src="x"></script>`), so that they do not depend on a rule that is moving.
- Task 2 starts when that round ends. It owns `packages/core/src/graphics/motion/direct.ts`, `write.ts`, their tests, `packages/core/src/graphics/direct.ts`, `packages/core/src/llm/*` and `packages/core/package.json`.

Do not edit anything in `packages/core`, and do not edit `apps/desktop/src/main/graphics-page.test.ts` (if the new host code breaks it, report the failure and its message; the controller will have it fixed).

You own: `apps/desktop/src/main/graphics-render.ts`, `graphics-render.test.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/resources/graphics/host.js`, `apps/desktop/src/main/graphics-host.test.ts`.

While you work, run only your own test files, for example `npx vitest run apps/desktop/src/main/graphics-render.test.ts apps/desktop/src/main/graphics-host.test.ts`. At the end run `npm test` and `npm run typecheck` once from the repo root. If something fails in a file another implementer owns, do not fix it: wait a minute and run again, and if it still fails, report it as theirs with the exact message. The controller runs the full gate again once everyone has reported.

## Before you begin

If anything about the requirements, the approach or the code is unclear, ask now, before you write code. It is always fine to stop and ask.

## Your job

1. Write the tests of each step first and watch them fail.
2. Implement exactly what the task says, no more.
3. Run your test files, then the full suite and the typecheck.
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
