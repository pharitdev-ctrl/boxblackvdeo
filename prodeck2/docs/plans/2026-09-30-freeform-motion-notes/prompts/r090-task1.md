You are implementing Task 1 of the BOXBLACK 0.9.0 plan "Sound library": Core: picked sounds and library lines.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r090-common.md` first. Your work is "Task 1" in `docs/plans/2026-10-02-sound-library.md` (Steps 1 to 6), with the names exactly as in "Names shared across tasks" (including `soundReady`).

Facts: `ComposedSound`, `SoundPrevious`, `isComposed`, `isSoundPrevious`, `SOUND_LOUDNESS`, `LOUDNESS_LUFS` are in `packages/core/src/sound/spec.ts`. Old stored sounds have no `picked` and must still pass `isComposed` exactly as now.

Working conditions: Tasks 2 (`graphics/motion/write.ts`, new `graphics/motion/beats.ts`) and 3 (`capcut/sounds.ts`, `capcut/composed-sounds.ts`) run at the same time; do not touch those. You own `packages/core/src/sound/library.ts`(+test), `sound/spec.ts`(+test) and the `./sound/library` export line in `packages/core/package.json` (Task 2 adds its own line there too: edit with care, add only your line).
