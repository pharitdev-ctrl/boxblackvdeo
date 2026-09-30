You are implementing Task 4 of the BOXBLACK 0.5.0 plan: "Main: pieces in force, the words now, stale pieces, views".

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


Task 3 is done too: the renderer (`apps/desktop/src/main/graphics-render.ts`) renders a motion job. `RenderJob` has an optional `times?: number[]` (the times now, in seconds from the graphic's start, of the words a motion graphic was written for); a motion job's hash takes the fragment, the box, the seconds, the times, the canvas, the fps, the font, the palette and `MOTION_VERSION`; a job whose `html` is null fails with `the graphic has not been written`, so such a job must never be made, which is this task's to see to.

Task 2 is being finished now, in `packages/core` (`graphics/motion/direct.ts` and `write.ts`). The one thing of it you use is this function, which is already in the repo and whose contract is fixed:

```ts
// packages/core/src/graphics/motion/direct.ts   ("@boxblack/core/graphics/motion/direct")
/** The words a motion graphic is written for: those of the sentence said from the word that starts at `fromSourceUs` on, within `seconds` of it on the rough cut, the first forty, each with its seconds from that start (rounded to the millisecond). */
export function motionWords(sentence: GraphicSentence, fromSourceUs: number, seconds: number): MotionWord[]
```

Do not write your own, and do not change it.

## Your task, as the plan has it

### Task 4: Main — pieces in force, the words now, stale pieces, views

**Files:**
- Modify: `apps/desktop/src/main/graphics-cues.ts`, `highlights.ts`, `timeline.ts`, `sound-cues.ts`, `apps/desktop/src/shared/api.ts`, their tests, `apps/desktop/src/renderer/test/fake-api.ts` (defaults for the new view fields), `packages/core/src/graphics/plan.ts` (`PlacedGraphic` gains `wordsNow?` and `stale?` for a motion piece)

- [ ] **Step 1: Tests for `graphicsInForce` with motion specs**
  - the level filter, the placement on the cut, the duration rule and the vertical dodge work for a motion spec as for a card; the kit-only steps (label-only cards, sticker bands, settled motions) do not touch it
  - `wordsNow`: core's `motionWords` of the sentence the piece's point has now, from the piece's anchor, for `spec.seconds`; a scene point has none. When their texts equal `spec.words`' texts in order, the piece carries those times; when they differ (a word cut, another word, fewer words), the piece is **stale**
  - a written piece is stale too when it now plays for less than `spec.seconds` by more than 0.05 s (the piece of the cut it sits on ends sooner than when it was written): its file would be cut before its way out, and the times typed into a fragment cannot be moved without Claude. A redo writes it for the room there is now (Task 5).
  - a piece with `html: null` is **unwritten**; stale and unwritten pieces are placed (they show in the list) but have no render job
- [ ] **Step 2: Tests for the view and the write**
  - `GraphicView` for a motion piece: `summary` is the idea, `what` stays the said words, `written`, `stale`, `writeFailed` (the spec's `failed` or null); `render` is `waiting` with no poster for an unwritten or stale piece
  - `graphicJob` answers `RenderJob | null`: for a written, fresh piece the job has `times` from `wordsNow`, the style's font and palette, and its `seconds` as written (never shortened); for a stale or unwritten piece, null. `graphicJobs` answers `jobs[i]` for `kept[i]`, or null, and callers leave the nulls out of what they hand the renderer
  - the write skips stale and unwritten pieces and counts them in `graphicsSkipped`; it does not wait for them
  - the sound slot of a motion piece reads `กราฟิกขึ้น: <idea>`
- [ ] **Step 3: Implement.** Add `written`, `stale`, `writeFailed` to `GraphicView` in `shared/api.ts`, with defaults in `fake-api.ts` and every test literal the compiler flags.
- [ ] **Step 4:** `npm test` and `npm run typecheck`.

## What is already decided (do not re-decide these)

- **Today a motion piece is left out everywhere.** Task 1 put the smallest skips in so the kit's code never met a motion spec: in `graphicsInForce` (`if (isMotion(stored.spec)) continue`), in `summaryOf`, and wherever else the compiler made it, each pinned by a test that says a motion graphic is left out. Those skips and tests are yours to replace with the real behaviour. Cards and stickers must behave exactly as before, their tests untouched except where a type forces a literal to grow a field.
- **A motion piece in `graphicsInForce`** goes through the generic steps only: the level filter, the place on the cut, the duration rule (its `seconds`, or up to the end of the piece of the cut it sits on, never under the shortest a graphic may be), the dodge of the picture's keep-clear bands, the highlight text and then the subtitles (the box keeps its size; nowhere to go means dropped, as for a card), `enforceGraphics`. None of the kit's steps touch it (the icon upgrade, the label-only rule, the sticker bands, the fly-up stretch, the settled motion).
- **The words now.** `graphicsInForce` takes one more input, a function that gives the words said from an anchor on for a length, on the rough cut as it is now (the caller builds it from the point's sentence with core's `motionWords`; a scene point, which has no sentence, has none). For a motion piece it is asked with the anchor the piece plays by (the `by` of its place, which is its point's start when its own moment was cut) and the length the piece really gets, after every rule. `PlacedGraphic` (core, `packages/core/src/graphics/plan.ts`, which you may change for this and nothing else) carries them for a motion piece as `wordsNow?: MotionWord[]`, with `stale?: boolean`.
- **Stale** is judged only for a written piece (`html` not null): it is stale when the texts of its words now are not the texts of `spec.words`, in order and in number, or when it now plays for less than `spec.seconds` by more than 0.05 s. An unwritten piece is never stale. A stale or unwritten piece is still placed and listed (kept or off as it is), since the screen shows it and offers to write it again.
- **Jobs.** `graphicJob` answers `RenderJob | null`: for a motion piece that is written and not stale, the job is its spec as placed (the box moved by the dodge, the `seconds` it was written for, never shortened), the canvas, the fps, the style's font and palette, and `times`, the `atS` of its words now; for a stale or unwritten motion piece, null. A card or a sticker gets the job it gets today. `graphicJobs` answers `{ kept, jobs }` with `jobs[i]` the job of `kept[i]` or null, and every caller that hands jobs to the renderer leaves the nulls out. `jobFor` answers null for a piece with no job, as its type already allows.
- **The view.** `GraphicView` (shared/api.ts) gains `written: boolean`, `stale: boolean`, `writeFailed: string | null`. For a motion piece: `summary` is its `idea`; `written` is whether it has a fragment; `stale` as above; `writeFailed` is the spec's `failed` or null. For a card or a sticker: `written: true`, `stale: false`, `writeFailed: null`. A piece with no job shows `render: "waiting"`, no poster and no error, and nothing is asked of the renderer for it.
- **The write into the draft** (`timeline.ts`) skips a kept piece that has no job: it is counted in `graphicsSkipped`, it is not waited for, and it does not stop the write. The rule that every job must already be rendered when the machine cannot render stays, for the pieces that have jobs.
- **The sound slot** of a motion piece reads `กราฟิกขึ้น: <idea>` (sound-cues.ts). The line Claude is given for one of the user's existing graphics (`existingGraphics`, through `summaryOf`) is the idea too.
- `renderer/test/fake-api.ts` and every test literal of a `GraphicView` the compiler flags get the three new fields with the kit's defaults. Do not change renderer code: the screen is Task 6.
- `apps/desktop/src/main/flair.ts` is Task 5's file. Change it only where the compiler demands it because of a type you changed (a job that may now be null), with the smallest change that keeps today's behaviour, and list each such change in your report.

## Other implementers

Task 2 owns `packages/core/src/graphics/motion/*`, `packages/core/src/graphics/direct.ts`, `packages/core/src/llm/*`, `packages/core/package.json`. Task 3 is in a short fix round after its reviews (failure texts and the Chrome wrapper; nothing you use changes) and owns `graphics-render.ts`, its test, `graphics-host.test.ts` and `host.js`; do not change them (if you think the renderer needs a change, stop and say so).

You own: `apps/desktop/src/main/graphics-cues.ts`, `highlights.ts`, `timeline.ts`, `sound-cues.ts`, their tests, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/renderer/test/fake-api.ts`, and `packages/core/src/graphics/plan.ts` for the two optional fields of `PlacedGraphic` only.

While you work, run only your own test files. At the end run `npm test` and `npm run typecheck` once from the repo root. If something fails in a file Task 2 owns, do not fix it: wait a minute and run again, and if it still fails, report it as theirs with the exact message.

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
