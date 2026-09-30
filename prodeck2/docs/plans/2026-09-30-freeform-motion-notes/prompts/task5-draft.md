You are implementing Task 5 of the BOXBLACK 0.5.0 plan: "Main: plan, write three at a time, check, repair once, redo".

{{COMMON}}

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

{{TASK}}

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
- **A piece is written for the room it has now** (the plan's Step 2 says why): `seconds` is the played length of the placed piece, to the millisecond below (the helper `graphics-cues.ts` exports for it); `words` are its `wordsNow`; the stage is `stageBox` of its box as placed (after the dodge) on the canvas; `about` is the outline's title, then `: `, then its summary, cut to 300 characters on a grapheme, with ` (<video type>)` after it when the brief has a video type.
- **The render check the caller builds** makes the job the piece will really have once stored: the placed piece with its spec's `html`, `seconds` and `words` set to the candidate's and `stale: false`, through the same `graphicJob` and the same canvas, fps, font and palette the preview uses (add one small function to `highlights.ts` for it, beside `jobFor`), then `renderer.wait([job], folder)`. Ready → `[]`. Failed → `failureOf(hash)` split into lines, empty lines dropped. Neither (the pack is missing, a machine fault, renders stopped) → `null`. With no renderer in the deps, or `graphicsReady()` false before the render → `null`. Because the job is the one the stored piece gets, the render made by the check is the render the preview and the write use: nothing is rendered twice.
- **The machine is looked at afresh.** When the graphics work begins writing, and when a redo begins, call the renderer's `forgetMachine()` (it clears what an earlier render found wrong with the machine, and nothing else: each graphic's own failure stays), so that a fault the user has since mended, a full disk freed, does not leave the writing in its no-render path until the app is restarted.
- **What is stored**, in one update of the latest outline per piece, the cue found by its anchor (`samePlace`): for a written piece, its spec with `html`, that `seconds` and those `words`, and `failed` removed; for a failed one, `html: null` and `failed`. A piece removed meanwhile is left alone. Nothing about a piece is stored before its writing has ended: a candidate that has not passed is never in the outline.
- **Which pieces the graphics work writes**, after it has stored the plan: the pieces in force now at the level set (the `kept` of `graphicJobs`), that are motion pieces, not written (`html` null) and not off. A piece the level hides, one with no room on the frame, and one switched off are not written by the run. Three at a time, each stored as it settles, progress `(done, total)` after each.
- **The work's end**: `count` is the pieces written in this run; `dropped` is what the plan dropped plus the pieces whose writing failed. With nothing to write it ends as it does today.
- **Stop.** The run's signal goes to every call. When it aborts, the calls in flight reject, no further piece starts, the pieces already stored stay, and the work ends the way a stopped Claude call ends a work today (the run marks it; look at `post-plan.ts`).
- **Progress.** `PostWorkState`'s running variant gains optional `done` and `total`. The run hands the work a way to report them (`post-plan.ts`), and `planGraphics` reports after each piece settles, and once before the first with `(0, total)`.
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
