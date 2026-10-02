You are implementing Task 2 of the BOXBLACK 0.8.0 plan "Free zoom": Core: the objects pass marks faces.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first.

Your task is "Task 2" in `docs/plans/2026-10-02-free-zoom.md`, Steps 1 to 4. The prompt line is copied exactly, with its two leading spaces.

## Facts from the code

- `packages/core/src/vision/objects.ts`: `OBJECTS_VERSION`, `SceneObject`, `ObjectsReplySchema`, the system prompt, `acceptObjects`, `locateObjects`.
- The cache key of the objects pass in main (`apps/desktop/src/main/objects.ts`) follows `OBJECTS_VERSION`. Check that it does (read only), and say in your report how stale entries are told apart. Do not change main.
- Search the repo for tests that pin `OBJECTS_VERSION` or the prompt text (core and `apps/desktop`), and update only those that pin the old value.

## Working conditions

Task 1 (`packages/core/src/flair/moves.ts`, its test, and the `package.json` exports) runs at the same time. Do not touch them.

You own `packages/core/src/vision/objects.ts` and `objects.test.ts`, plus any test that pins the version string.
