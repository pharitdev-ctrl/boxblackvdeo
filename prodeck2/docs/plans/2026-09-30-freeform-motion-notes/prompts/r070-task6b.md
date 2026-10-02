You are implementing Task 6b of the BOXBLACK 0.7.0 plan "Free graphics": Renderer: the tabs, the graphic list, the AI menu.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first.

Your task is all of Task 6 in `docs/plans/2026-10-01-free-graphics.md` except Step 7 (the prepare line, done as Task 6a). That is Steps 1 to 6 and 8. The Step 1 table texts are copied exactly; the four `prepare.objects*` keys are already in.

## What exists now (approved)

**Main**
- `GraphicView.from: FlairLevel | null`, `replaces: boolean` and `coversKeep: boolean`.
- Free graphics are in `preview.graphics`, already filtered by the level.
- The texts of a point a free graphic replaces are marked `replaced` on the groups, as before.

**Task 5**
- `RETHINK_WORKS` is `["techniques", "graphics", "sounds", "subtitles"]`.
- `RETHOUGHT.techniques` runs text and techniques; `RETHOUGHT.graphics` runs graphics.
- `EmphasisView.changed.techniques` exists.
- Task 5 may have made a minimal stop-gap in `ClipRoom.tsx`, `PostScreen.tsx` and `postTabs.ts` so that "techniques" typechecks. Read its report lines in the code (search for "techniques"), and replace the stop-gap with the real design.

**Task 6a**
- `PrepareScreen` has a private copy of `lastLines`. Export one `lastLines` from `edit/FlairTab.tsx` (or `format.ts`) and use it in both places.

## Facts from the code

**Tabs and badges**
- `edit/postTabs.ts`: `POST_TABS`, `TAB_OF_WORK`, `tabRuns`, `MAIN_WORDS`.
- `edit/BeatPanel.tsx:49-59` renders the tabs.
- `ui/Tabs.tsx` uses `data-tab`.
- `screens/PostScreen.tsx` holds the badge counts (L63-67, L137-142), the tab bodies (L208-210) and the AI items (L93-101).
- `edit/BeatSidebar.tsx`: `MARKS` (L45-51), `SYMBOLS`.
- `edit/byBeat.ts`: `settled()` counts.

**The current graphics tab**
- `edit/GraphicsTab.tsx` holds the highlight settings, `HighlightTab`, and `TechniqueList` (zooms, cutaways, graphics) from `edit/FlairTab.tsx`.
- The graphics rows are at `FlairTab.tsx` L294-399, with `graphicState` (L83-95), `EditField`, `failure`, `FromPoint` and `ItemRow`.

**The sound tab pattern**
- `edit/ComposedList.tsx` and `edit/SoundTab.tsx` give the time-ordered list.
- The level line is ``t(`sounds.from.${sound.from}`)``.

**The room**
- `room/ClipRoom.tsx`: `rethink` (L853-872), `Rewriting.of`, `writingGraphics`.
- `GraphicsTab` passes `room.rewriting?.of === "graphic"`.

**Texts that name the old tab**
- `inserts.pickHint`, `graphics.none`, `write.doneGraphicsSkipped`, `write.doneGraphicsAllSkipped`, `flair.lost` and `post.planHint` in `i18n.ts`.
- The toasts in `edit/writeEnd.ts`.

**Tests to update**
- `PostScreen.test.tsx`:
  - L69-75 (five tabs);
  - L79 (sidebar marks);
  - L557 (tab spinners);
  - L738-769 (AI menu);
  - L1642 (banner);
  - L1703 (from point);
  - L2083-3178 (the graphics rows, to move to the new tab);
  - L2271 (`graphics.none` string);
  - L2282-2290 (badges).
- `postTabs.test.ts`.
- `byBeat.test.ts`.
- `writeEnd.test.ts`: L85-90.
- `ClipRoom.test.tsx`: L762, L836.

## Working conditions

Task 5's review and fix round may still touch main (`flair.ts`, `post-plan.ts`, `emphasis.ts`, `highlights.ts`, `shared/api.ts`). Do not touch main. A failing main test is theirs: run it again later.

You own the renderer except `PrepareScreen` (only the shared `lastLines` import may change there).

At a window of 900 px, six tabs must still fit. Check the tab styles in `styles/edit.css` and `ui/Tabs`, and say in your report whether a label wraps or shrinks. The controller checks it live.
