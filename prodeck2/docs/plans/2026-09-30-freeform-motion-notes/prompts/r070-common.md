## The project in brief (0.7.0)

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. It is a monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`:
- `packages/core` is pure TypeScript.
- `apps/desktop/src/{main,shared,renderer}` is the Electron app.

Node 26 runs TypeScript natively, the tests are vitest, and there is no git.

**Up to 0.6.0,** Claude planned motion graphics only on emphasis points. A graphic always took its point's highlight text's place, and boxes had to be at least half the frame wide.

**Release 0.7.0 ("free graphics")** changes this:
- A graphic can go anywhere in the clip, and has its own lowest level (`from`).
- Highlight text stays beside it. Only a graphic tied to a point whose box covers that point's own text replaces that text.
- The app checks each graphic's room: other text, faces and shown things (a cover of 1.5 s at most), and other graphics.
- A separate per-video "objects pass" records boxes of things per scene, so graphics can sit beside a face and point at still objects.

Graphics made before 0.7.0 (no `from`) are "legacy" and keep every old rule until written again.

## Where to read

- **The plan:** `docs/plans/2026-10-01-free-graphics.md`. Read "How to run this plan", "Files" and "Names shared across tasks", then your task. The prompts in the plan (`FREE_PLAN_PROMPT`, `OBJECTS_PROMPT`) and the brief lines are copied verbatim, never reworded.
- **The spec (Thai):** `docs/specs/2026-10-01-free-graphics-design.md`.
- **The code it changes or mirrors:**
  - `packages/core/src/graphics/plan.ts`
  - `packages/core/src/graphics/motion/direct.ts`, `points.ts`, `write.ts`
  - `packages/core/src/sound/plan.ts`: the numbered-word plan that `free.ts` mirrors
  - `packages/core/src/vision/describe.ts`, `run.ts`, `frames.ts`
  - `apps/desktop/src/main/graphics-cues.ts`, `highlights.ts`, `flair.ts`, `composed-cues.ts`, `analysis.ts`, `footage.ts`, `post-plan.ts`

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
- **Other work.** Other implementers may be working at the same time on other files. A failing test outside your files is probably theirs in progress: run it again later, and do not fix it.

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
