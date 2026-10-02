You are implementing Task 2 of the BOXBLACK 0.7.0 plan "Free graphics": Core: the objects pass.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first.

Your task is "Task 2" in `docs/plans/2026-10-01-free-graphics.md`. Steps 1 to 4 there are your work. `OBJECTS_PROMPT` is copied exactly.

## Facts from the code

- **`describeVideo`** in `packages/core/src/vision/describe.ts` is the pattern to mirror:
  - how frames are batched (`batchSize`, L113-123);
  - how each batch's window runs from its first frame to the next batch's first frame;
  - how frames are labelled (`ภาพที่ N · เวลา X วินาที`) and attached;
  - `generate({ schema, maxTokens: 8000 })`.
- **`FrameImage`** is in `vision/frames.ts`. **`Scene`** is in `describe.ts`.
- **zod 4 strips unknown keys** and applies defaults only when the transport parses. The test fakes return raw output without parsing, so `acceptObjects` must tolerate missing `objects` and `still` (use `?? []` and `?? false`), as `graphics/motion/direct.ts` and `flair/look-at.ts` do.
- **`FootageClip`** (`packages/core/src/planner/footage.ts`) gains `objects?: SceneObjects | null`. It is optional, so no literal elsewhere has to change. `CutClip` (`cut/compile.ts`) gets it through `FootageClip`.
- **Do NOT change** the vision prompt, `PROMPT_VERSION` or `FrameBatchReplySchema`. Changing them would invalidate every cached insight. The objects pass exists to avoid that.

## Working conditions

Task 1 (core `graphics/plan.ts`, `graphics/motion/free.ts`, `write.ts`) runs at the same time.

You own:
- `packages/core/src/vision/objects.ts` and its test
- `packages/core/src/vision/index.ts`
- `packages/core/src/planner/footage.ts`
