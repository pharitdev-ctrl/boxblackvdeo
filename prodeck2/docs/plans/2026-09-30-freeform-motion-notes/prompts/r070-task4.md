You are implementing Task 4 of the BOXBLACK 0.7.0 plan "Free graphics": Main: placement of free graphics.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first.

Your task is "Task 4" in `docs/plans/2026-10-01-free-graphics.md`. Steps 1 to 8 there are your work.

## What exists now (approved)

- **`packages/core/src/graphics/plan.ts`** (Task 1):
  - `GraphicCue.from?`, `MotionSpec.replacesText?` and `isFree(cue)`;
  - `FREE_GRAPHIC_MIN_US = 800_000`, `COVER_MAX_US = 1_500_000`, `TOP_KEPT`;
  - `GRAPHIC_MIN_US` stays 1.5 s;
  - `MOTION_VERSION` is unchanged.
- **`packages/core/src/vision/objects.ts`** (Task 2): `SceneObject`, `SceneObjects`.
- **`FootageClip.objects?: SceneObjects | null`.** `CutClip` has it.
  - `clip.objects.scenes[i]` lines up with `clip.insight.scenes[i]`.
  - `objects` is absent or null for a clip with no objects pass yet.

## Facts from the code (`apps/desktop/src/main/graphics-cues.ts`)

**Helpers**
- `overlaps(a, b)` is the time overlap. `covers(box, band)` (`box.y1 > band.fromY && box.y0 < band.toY`) is the y overlap.
- `textBands` (L74-121) returns `GroupBand` with `pointId?`.
- `textBandsIn(bands, span, exceptPointId?)` (L128-129).
- `keepClearsIn(plan, clips, span)` (L136-149) walks the cuts, mapping the span to each cut's source range.

**`graphicsInForce` (L377-441)**
- In order, it:
  1. filters by `passes(cue.pointId)`;
  2. places with `place(anchor, pointId)`;
  3. finds `roomUs` with the `GRAPHIC_MIN_US` floor and the `MOTION_RUN_ON_US` rule;
  4. dodges the box with `dodgeBands`;
  5. runs `enforceGraphics(placed, durationUs)` (core `plan.ts:145-155`, which uses `GRAPHIC_MIN_US`);
  6. computes the words and the stale state with `withWordsNow` (L341-345).
- `hasJob` (L444) is `html !== null && stale === false`.
- `replacesText` (L476), `replacedPoints` (L479) and `isReplaced` (L486).
- `graphicViews` (L499-525).

**Callers**
- `graphicsOn` in `highlights.ts` (L294-334) wires the inputs. It builds `bands` with `textBands`, then reads `replacedPoints`.
- `timeline.ts` (L464-473, L564-601) and `ClipRoom` / `WriteButton` / `byBeat` read `group.replaced`. None of them needs to change, as long as `replacedPoints` answers right.

**The level filter.** `pointFilter(placed, level)` is in `packages/core/src/emphasis/filter.ts:115-121`. `FLAIR_LEVELS` is in `packages/core/src/flair/catalogue.ts`. The composed sounds' filter in `composed-cues.ts:168` is the pattern for `from`.

**Tests that pin the legacy behaviour.** These must stay green unchanged:
- `graphics-cues.test.ts`: L308, L698, L783, L871, L906;
- `highlights.test.ts`: L1779-1868;
- `timeline.test.ts`: L1357-1476.

## Working conditions

Task 3 runs at the same time. It owns `analysis.ts`, `footage.ts`, `settings-api.ts`, `objects.ts`, `index.ts`, `license-api.ts`, and the analysis API part of `shared/api.ts`.

In `shared/api.ts`, touch only `GraphicView`. Do not reformat the file.

If adding `from`, `replaces` and `coversKeep` to `GraphicView` breaks renderer test fixtures or the fake api, add the fields to those literals, and change nothing else in the renderer.
