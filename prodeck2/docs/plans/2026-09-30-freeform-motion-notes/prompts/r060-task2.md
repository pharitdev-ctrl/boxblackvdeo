You are implementing Task 2 of the BOXBLACK 0.6.0 plan, "Composed sound effects": Core: the sound spec, the lint, the contract, the harness.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It covers the project, where to read, the rules and the report format.

Your task is "Task 2" in `docs/plans/2026-10-01-composed-sound.md`. Steps 1 to 5 there are your work. The four new files go in `packages/core/src/sound/`, each with its test.

## Already decided (do not re-decide)

**Sources.**
- `SOUND_CONTRACT` is the block in the plan, copied verbatim.
- The harness starts from `docs/plans/2026-10-01-sound-spike/harness.js`, with the changes the plan lists.
- The spike's outputs, `docs/plans/2026-10-01-sound-spike/out/v1-*.js`, are real Claude answers. All four must pass `lintCompose`; read them as test fixtures from that folder.

**The linter.**
- It works on the code text. It does not parse JavaScript with a library; there is none in core, and none is added.
- Strings, template literals and comments are skipped before names are matched. Look at how `motion/lint.ts` and `motion/shape.ts` treat text, and keep the approach simple and strict.
- When the linter cannot tell, it refuses (a strict reader, as 0.5.0's is).

**Package exports.**
- `packages/core/package.json` gains an `exports` entry so that `@boxblack/core/sound/spec`, `/lint`, `/write`, `/harness` and later `/plan` resolve the way `@boxblack/core/graphics/...` entries do. Look at how the graphics entries are declared and follow them.

**What `harness.test.ts` may do.**
- `SOUND_HARNESS` is a string run in a browser page later (Task 4). It cannot be run in vitest; there is no Web Audio there.
- The test checks that it parses (`new Function(SOUND_HARNESS)` does not throw) and that it defines `renderSound`.
- `soundProblems` is tested on its own.

**Out of scope.** No main, renderer or i18n changes in this task.

## Working conditions

Nobody else is changing the repo now. The gate stands at 155 files, 2591 passed and 3 skipped, with typecheck clean.
