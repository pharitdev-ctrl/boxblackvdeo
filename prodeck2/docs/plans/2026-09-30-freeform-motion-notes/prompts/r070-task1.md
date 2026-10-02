You are implementing Task 1 of the BOXBLACK 0.7.0 plan "Free graphics": Core: graphic types, the free plan, the brief lines.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first.

Your task is "Task 1" in `docs/plans/2026-10-01-free-graphics.md`. Steps 1 to 7 there are your work. `FREE_PLAN_PROMPT` and the brief lines are copied exactly.

## Facts from the code

- **`planMotion` and `acceptMotionPlan`** in `packages/core/src/graphics/motion/direct.ts`. Read them for:
  - how frames are read and attached: a frame that cannot be read is left out;
  - `clipText` and `IDEA_MAX = 400`;
  - `toMillisecond`.
- **Helpers to reuse:** `clock` and `pointLabel` from `packages/core/src/flair/direct.ts`, and `Brief` from the planner.
- **`acceptSoundPlan`** in `packages/core/src/sound/plan.ts` is the numbered-word pattern to mirror.
- **`MOTION_VERSION`** (`graphics/plan.ts`) is stamped on specs and is part of the render hash. Do NOT change it: legacy graphics would all go stale.
- **`motionBrief`** is in `graphics/motion/write.ts`. Its tests pin the exact brief text. Keep the old exact text when no new argument is given.
- **`GRAPHIC_MIN_US`** stays 1.5 s. It is also the sounds' room floor in `composed-cues.ts`. Add `FREE_GRAPHIC_MIN_US` beside it, and change no use of the old one.

## Working conditions

Task 2 (core vision `objects.ts`, `planner/footage.ts`, `vision/index.ts`) runs at the same time. You may import its `SceneObject` type for `FreeClip`. If it is not there yet when you need it, declare a local structural type with the same fields, and say so in your report.

You own:
- `packages/core/src/graphics/plan.ts`
- `packages/core/src/graphics/motion/free.ts`
- `packages/core/src/graphics/motion/write.ts`
- their tests
- `packages/core/package.json` exports

Do not touch `direct.ts`: Task 5 retires its planning call later.
