You are implementing Task 3 of the BOXBLACK 0.9.0 plan "Sound library": Core: writers take a volume.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r090-common.md` first. Your work is "Task 3" in `docs/plans/2026-10-02-sound-library.md` (Steps 1 to 3).

Facts: `packages/core/src/capcut/sounds.ts` (`TimelineSoundCue`, `addSoundTrack`, `VOLUME`, `MAX_CUE_US`, `FADE_US`) and `capcut/composed-sounds.ts` (`TimelineComposedSound`, `addComposedSoundTrack`, `VOLUME`). Read how `addSoundTrack` cuts a long cue short with a fade, and do the same for `playUs` in the composed writer. Without the new fields the written JSON must be byte-for-byte what it is now.

Working conditions: Tasks 1 (`sound/library.ts`, `sound/spec.ts`, `package.json` exports) and 2 (`graphics/motion/*`) run at the same time; do not touch those. You own `capcut/sounds.ts`, `capcut/composed-sounds.ts` and their tests.
