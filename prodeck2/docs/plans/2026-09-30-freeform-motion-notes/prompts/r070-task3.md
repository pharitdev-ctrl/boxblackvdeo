You are implementing Task 3 of the BOXBLACK 0.7.0 plan "Free graphics": Main: running and storing the objects pass, and the prepare API.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first.

Your task is "Task 3" in `docs/plans/2026-10-01-free-graphics.md`. Steps 1 to 6 there are your work.

## What exists now (approved)

- `packages/core/src/vision/objects.ts` (Task 2): `OBJECTS_VERSION`, `SceneObject`, `SceneObjects`, `locateObjects`.
- `locateObjects` takes `{ transport, model, frames, scenes, batchSize, signal?, onProgress? }` and returns `{ version, scenes }`, one entry per scene.
- The first batch's window starts at 0 and the last one runs to the end. A batch with no scene in its window makes no call.
- `FootageClip.objects?: SceneObjects | null` (`packages/core/src/planner/footage.ts`).

## Facts from the code

**Caching**
- The insight cache is `new MediaCache<VideoInsight, VisionKey>(join(userData, "insights"))` (`apps/desktop/src/main/index.ts:173`).
- A cache file name is the sha256 of `[media path, size, mtime, key]` (`packages/core/src/cache.ts:27-31`). `stableJson` drops undefined values.
- `MediaCache` has `get`, `entry(path, key)` and `put`.

**Keys and loading**
- `footageKeys(deps)` (`apps/desktop/src/main/footage.ts:29-41`) builds the insight key.
- `fittingInsight` (L44-46) reads an insight through `cachedInsight`, which has a speech fallback.
- `analysedVideos` (L53-64) counts a video only when its transcript and a fitting insight are both cached.
- `loadFootage` (L83-99) builds the clips.

**The analysis service** (`apps/desktop/src/main/analysis.ts`)
- One job at a time: `let job`, and `start` throws `an analysis is already running`.
- `start` runs transcription, then `describeVideos` with `...visionSampling(vision.frameEveryS)` and `prompt: (await deps.prompts?.())?.vision`.
- On finish it calls `progress.put` and sends `analysis-finished`.
- `cancel` aborts the job. Events go through `deps.send`.

**Frames**
- `extractFrames` and `sampleTimes` are in `packages/core/src/vision/frames.ts` and `sampling.ts`.
- Read how `describeVideos` in `packages/core/src/vision/run.ts` (L115-178) measures, samples and extracts frames, and deletes them in `finally`. Mirror that, but do not measure signals again: use the scene cuts the insight implies, or the same `sampleTimes` inputs `describeVideos` used. Say in your report which you chose and why.

**The API**
- Add to `shared/api.ts` `API_METHODS` and `DesktopApi`.
- Implement in `settings-api.ts` (its `Pick` type at L9-28, implementations at L120-132).
- `index.ts` merges the services and registers `ipcMain.handle`.
- `renderer/test/fake-api.ts` base is a full typed `RendererApi`, so the new methods go there.
- `license-api.ts` `LICENSED_METHODS` has a pinned sorted list in `license-api.test.ts`.

**The renderer**
- `PrepareScreen` rebuilds its running list from `analysisState().transcription` keys (L140). A run of only the objects pass must not confuse it.
- Keep `AnalysisState` as it is. The objects events are separate, and the renderer handles them in Task 6a.

## Working conditions

Task 4 runs at the same time. It owns `graphics-cues.ts`, `highlights.ts`, `timeline.ts` and the `GraphicView` part of `shared/api.ts`.

In `shared/api.ts`, touch only:
- the two new `DesktopApi` methods and their `API_METHODS` entries;
- the new `AppEvent` member.

Do not reformat the file.

## Note from the Task 2 review

`locateObjects` with scenes but no frames makes no call and returns `[]` for every scene. Do not store such a result as a real "nothing found":
- a video whose frames could not be extracted is `failed`;
- the result is not cached.
