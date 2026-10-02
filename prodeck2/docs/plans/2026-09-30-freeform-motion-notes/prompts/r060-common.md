## The project in brief (0.6.0)

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. It is a monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`:
- `packages/core` is pure TypeScript.
- `apps/desktop/src/{main,shared,renderer}` is the Electron app.

Node 26 runs TypeScript natively, the tests are vitest, and there is no git.

Up to 0.5.1, the sound work ("work 4") worked like this: Claude picked CapCut library sound effects for fixed slots, and the app wrote them into the draft by their CapCut `effect_id`.

Release 0.6.0 replaces this. Claude decides where the clip gets a sound and composes each sound as Web Audio code (`function compose(ctx, cue, kit)`). The app then:
1. lints the code;
2. renders it offline in a sealed hidden window;
3. checks it and asks Claude for one repair if it fails;
4. sets its loudness with the bundled ffmpeg;
5. lays the WAV into the draft.

This works the way the 0.5.0 motion graphics do (write, lint, render check, one repair), and the 0.5.1 rules for redo, edit by instruction and one-step undo apply to sounds too. A spike proved the composing and the rendering on 2026-10-01: see `docs/plans/2026-10-01-sound-spike/` (`README.md`, `contract.txt`, `harness.js`, `out/v1-*.js`).

## Where to read

- **The plan:** `docs/plans/2026-10-01-composed-sound.md`. Read "How to run this plan", "Files" and "Names shared across tasks", then your task. The prompts in the plan (`SOUND_CONTRACT`, `SOUND_PLAN_PROMPT`) are copied verbatim, never reworded.
- **The spec (Thai):** `docs/specs/2026-10-01-composed-sound-design.md`.
- **The 0.5.0/0.5.1 code your task mirrors:**
  - `packages/core/src/graphics/plan.ts` (`MotionSpec`, `isPrevious`, `instructionLength`)
  - `packages/core/src/graphics/motion/write.ts` (`MOTION_CONTRACT`, `repairBrief`, `editBrief`, `writeMotion`, `fragmentOf`)
  - `packages/core/src/graphics/motion/lint.ts` (`RULES`)
  - `apps/desktop/src/main/motion-write.ts`
  - `apps/desktop/src/main/graphics-render.ts`
  - `apps/desktop/src/main/graphics-cues.ts`
  - `apps/desktop/src/main/flair.ts` (`afterWriting`, `afterEdit`, `steppedBack`, `writeGraphic`, `editGraphic`, `undoGraphic`)
  - `apps/desktop/src/main/post-plan.ts`

## Rules of this repo

- **Commit.** There is no git. "Commit" means `npm test` is green and `npm run typecheck` is clean, both run from the repo root.
- **Tests first.** Every behaviour gets a test that fails before the code and passes after. Say in your report what you saw fail.
- **Never delete outright.** A file that goes is moved with `mv <path> ~/.Trash/<name>-1001`.
- **Never run or touch:**
  - the app, `npm run build`, `npm run dist`, HyperFrames, Chrome, Electron, or a real Claude call;
  - `~/Movies`, `~/Library`, or a CapCut draft.

  Tests use fakes and temp folders.
- **Do not change** `apps/desktop/package.json`.
- **Comments** are plain English prose about behaviour, in the voice of the surrounding code (read a few existing ones first). Put no em-dashes in prose you add.
- **User-facing strings** are Thai and live in `i18n.ts` only.
- **Match the surrounding code:** its naming, its density of comments, and its way of injecting dependencies for tests.
- **Scratch files** go under `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/`, never in the repo.

## Working conditions

- If the plan asks for something the code makes impossible or unwise, stop and report `BLOCKED` or `NEEDS_CONTEXT`. Do the same if you find yourself restructuring code the plan did not mention.
- If anything is unclear, ask before you write code.

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Then report:
  - what you implemented, step by step;
  - what you saw fail first;
  - the final counts of `npm test` and `npm run typecheck`;
  - the files changed;
  - anything you decided that the plan did not spell out;
  - your self-review findings and concerns.
