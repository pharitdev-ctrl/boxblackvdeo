You are implementing Task 5 of the BOXBLACK 0.7.0 plan "Free graphics": Main: planning, writing, works and rethink.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first.

Your task is "Task 5" in `docs/plans/2026-10-01-free-graphics.md`. Steps 1 to 5 there are your work.

## What exists now (approved)

- **Core `graphics/motion/free.ts` (Task 1):**
  - `FreeClip`, `describeFreeClip`, `FreePlanSchema`, `acceptFreePlan` (returns 0-based `word` and `point`) and `planFreeGraphics({ transport, model, clip, frames: { label, path }[], prompt?, signal? })`.
  - `motionBrief` takes the optional `text` and `captionsFromPx`. Pass `captionsFromPx` as a whole number of pixels.
- **Core `graphics/plan.ts`:** `GraphicCue.from?`, `MotionSpec.replacesText?`, `PreviousFragment.replacesText?`, `isFree`, `FREE_GRAPHIC_MIN_US`, `COVER_MAX_US`, `TOP_KEPT`, `TEXT_STAGE_MIN_PX`. `MOTION_VERSION` is unchanged.
- **Main `objects.ts` (Task 3):** objects are loaded with the footage: `clip.objects`, or null.
- **Main `graphics-cues.ts` (Task 4):**
  - `keepBoxesIn`, `scenesOnCut`, `FreeRoom`, `roomOf`, `admitFree`;
  - the free path in `graphicsInForce`, with `PlacedGraphic.covering`, `replaces` and `coversKeep`;
  - `GraphicView.from`, `replaces` and `coversKeep`.

Read Task 4's report in the snapshot's code before you start. Where its names differ from the plan, use its names.

## Facts from the code

**`flair.ts` `planGraphics` (L534-641)**
- It builds `spoken`, `groups`, `timed`, `looks`, `font`, `bands` and `points`.
- It calls `planMotion`, then merges in one `amend` (`mine`, `waits`, `displaced`, `answers`, `gone`, `withoutTiedTo`, `withoutSoundsOn`).
- It then reads `deps.graphicJobs` and writes the unwritten graphics with `writeAll`.

**Other helpers**
- `graphicFrames` (L253-268) and `framesWanted` give the per-point frame paths.
- `wordsOnCutAt(spoken)` is in `composed-cues.ts:71-81`. The sound plan numbers its words with it.
- `wordsSaidFrom` is in `graphics-cues.ts:176-182`.

**Writing**
- `writeGraphic` (L362-381) builds `PieceToWrite` and the first brief.
- `placedToWrite` (L389-402) finds the placed graphic through `deps.graphicJobs`.
- `afterWriting`, `afterEdit`, `fragmentHeld`, `keptBefore` and `steppedBack` are at L114-174.

**Runs (`post-plan.ts`)**
- `RETHOUGHT` is at L29.
- `workTwo` (L176-197) runs text, techniques, then graphics.
- `rethink` is at L321-334, and `plannedOn` at L144-152.
- `emphasis.ts:258-261` derives `changed`.
- `StoredEmphasis.plannedOn` is in `packages/core/src/emphasis/types.ts:36`.
- `highlight-api.ts:201-204` checks `RETHINK_WORKS`.

**Tests that pin today's planning** need updating where the plan changes behaviour:
- `flair-plan.test.ts`: L324, L557, L615, L1170, L1510-1580;
- `post-plan.test.ts`: L246, L409, L130;
- `highlight-api.test.ts`: L235, L252;
- `direct.test.ts`: when its planning code moves to the Trash.

## Working conditions

Task 6a (renderer `PrepareScreen` only) runs at the same time.

Renderer files you may have to touch, because `RETHINK_WORKS` gains "techniques" and that breaks the renderer's typecheck:
- `ClipRoom.tsx`'s rethink type;
- `PostScreen.tsx`'s AI items;
- `postTabs.ts` `TAB_OF_WORK`.

Make only the smallest change that keeps typecheck and tests green: for example, map "techniques" to the existing graphics tab. The real tab split is Task 6b. Say exactly what you touched in the renderer.

## Notes from Task 4

- **Field names.** The new `PlacedGraphic` fields (`covering?`, `replaces?`, `coversKeep?`) live in core `graphics/plan.ts`. `enforceGraphics` takes its floor per cue.
- **Inputs.** `graphicsInForce` takes `room: FreeRoom` and `pointPlaced`. `textGroupsIn(bands, span)` builds `room.textIn`.
- **Stale.** It is `spec.replacesText !== covering` taken literally, so a written free graphic with no `replacesText` is always stale. Every write of a free graphic must set `replacesText` (a boolean), including failed writes that keep an earlier fragment.
- **Legacy wins overlaps.** A free graphic gives way to every kept legacy graphic in time and box, whether the legacy one plays earlier or later. The controller confirmed this.
- **`admitFree`** sorts by place time. It checks a tied cue's start with a 1 µs span against its own point's text.
- **Fix round 1 of Task 4.**
  - **`ownTextIn`.** `FreeRoom` gains `ownTextIn(span, pointId)`, fed from the bands with every point shown, built with `everyPointShown`. Build that room in `planGraphics` too.
  - **Covering at play.** Covering is judged on the span that really plays, in the `worded` step. `admitFree` does not return covering.
  - **`replacesText`.** Set it at write time from the placed graphic's `covering`, as the plan says.

## Two small items from the Task 4 review: yours, since you own `highlights.ts` now

1. **Wiring test.** No highlights-level test reaches `room.keepIn: keepBoxesIn(...)`. Add a preview test whose fixture clip has a `keep` object, or a `keepClear` band, under a free graphic. Expect `coversKeep: true` and a 1.5 s play.
2. **Laziness.** `graphicsOn` builds `everyBands` (every point shown) on every call. Build it lazily, only when a stored graphic `isFree`. Reuse `bands` when `options.flair.level === "heavy"`. Test that the result is the same.

## Approved state

Task 4 is approved in snapshot `after-070-t4-fix1`. Task 6a (`PrepareScreen`) is in its last review: do not touch it.
