You are implementing Task 2 of the BOXBLACK 0.9.0 plan "Sound library": Core: the graphic's beats.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r090-common.md` first. Your work is "Task 2" in `docs/plans/2026-10-02-sound-library.md` (Steps 1 to 4). The contract line is copied verbatim.

Facts: `MOTION_CONTRACT` is in `packages/core/src/graphics/motion/write.ts`; tests pin parts of it, so update only what this line forces. `MOTION_VERSION` (`graphics/plan.ts`) must not change. The lint is `graphics/motion/lint.ts`.

Working conditions: Tasks 1 (`sound/library.ts`, `sound/spec.ts`) and 3 (`capcut/sounds.ts`, `capcut/composed-sounds.ts`) run at the same time; do not touch those. You own `graphics/motion/write.ts`(+test), new `graphics/motion/beats.ts`(+test), the lint only if it refuses comments, and the `./graphics/motion/beats` export line in `packages/core/package.json` (Task 1 adds a line too: add only yours).
