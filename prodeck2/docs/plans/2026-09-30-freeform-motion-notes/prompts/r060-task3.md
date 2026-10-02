You are implementing Task 3 of the BOXBLACK 0.6.0 plan "Composed sound effects": Core: the sound plan.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first (the project, where to read, the rules, the report format). Your task is "Task 3" in `docs/plans/2026-10-01-composed-sound.md`. Its steps are your work: `packages/core/src/sound/plan.ts` and `plan.test.ts`.

## Already decided (do not re-decide)

- **`SOUND_PLAN_PROMPT`** is the block in the plan, copied verbatim (keep its line breaks).
- **Task 2 is done and in review.** It is in `packages/core/src/sound/`. Take `FLAIR_LEVELS`/`FlairLevel` from `flair/catalogue.ts`, and `SOUND_LOUDNESS`, `SOUND_SECONDS_MIN/MAX` and `SOUND_ROLE_MAX` from `sound/spec.ts`. The `./sound/plan` export entry is already in `packages/core/package.json`.
- **Planning-call shape.** Mirror `packages/core/src/flair/sound-plan.ts` (the old sound planner, which Task 5 retires) and `packages/core/src/graphics/motion/plan.ts` (or wherever `planMotion` lives) for:
  - how a planning call is made (`transport.generate` with `system`, `content`, `schema`, `maxTokens`, `signal`);
  - how a reply is accepted and counted (`dropped`).
- **Times in `describeSoundClip`.** They use `clock` from `flair/direct.ts`. Look at how the graphics planner prints times and match it.
- **Types.** `Importance` and `EmphasisType` come from the emphasis types in core (`packages/core/src/emphasis/types.ts`).
- **Word index of a graphic's sound.** When `graphic` is given, `word` becomes the index of the first word whose `atUs` is at or after the graphic's `atUs`. If there is none, the sound is dropped.
- **Duplicates.** Two sounds are the same when they have the same `word` and the same `graphic` (both null, or the same index). The first is kept.
- **Out of scope:** no main, renderer or i18n changes.

## Working conditions

- Other implementers work at the same time:
  - Task 7a in `packages/core/src/capcut/`;
  - Task 4 in `apps/desktop/src/main/sound-*` and `index.ts`, plus `packages/core/src/media/tool-check.ts`;
  - Task 6 in `apps/desktop/src/main/composed-cues.ts`, `highlights.ts`, `emphasis.ts`, `planner.ts`, `legacy-beats.ts`, `apps/desktop/src/shared/api.ts` and renderer test fixtures.
- Do not touch their files.
- A failing test outside your files is probably theirs in progress. Wait and run it again; do not fix it.
