You are making a small renderer change for BOXBLACK 0.8.1: move the level control ("ระดับความจัด": เบา / กลาง / จัดเต็ม) from the emphasis tab into the "✦ ให้ AI คิด ▾" menu.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` for the repo rules and report format (ignore its 0.7.0 summary).

## Now
- `apps/desktop/src/renderer/src/edit/TabSettings.tsx` `LevelControl` (a `Group` + `Segmented`, hint `flair.level.{level}Hint`).
- It is shown only at the top of `edit/EmphasisTab.tsx` (`<div className="tab-settings"><LevelControl … disabled={writing} /></div>`), fed `level`/`onLevel` from `screens/PostScreen.tsx` (`onLevel={(level) => room.changeFlair({ ...flair, level })}`).
- `edit/AiMenu.tsx` renders the menu (`Popover` with `ul.ai-items`); PostScreen renders `<AiMenu items=… running=… onStop=…/>`.

## Change
1. `AiMenu` takes an optional `level?: { value: FlairLevel; onChange: (level: FlairLevel) => void; disabled: boolean }`. When given, the popover shows `LevelControl` at its top, above the shared note and the items, followed by a separator line like the one after the lead item.
2. Changing the level does not close the menu and starts no run; it only changes the level, as the old control did (the preview updates as before).
3. The control's `disabled` is what the emphasis tab used (`writing`). Do not disable it while a plan runs unless the old control was.
4. Remove the control from `EmphasisTab` (and its `level`/`onLevel` props if nothing else uses them; keep `hidden` notes etc.). If the `tab-settings` div becomes empty, remove it.
5. The menu button's own text does not change (the bar is tight at 900 px).
6. CSS in `styles/edit.css`: the control fits the popover's width at 900 px window width without horizontal overflow; reuse existing classes where possible.

## Tests (first)
- `PostScreen.test.tsx`/AiMenu tests: the level control is in the open AI menu with the current level selected; choosing another level calls `changeFlair` with it, keeps the menu open, and runs nothing; it is disabled while writing.
- The emphasis tab no longer shows it.
- Update tests that found the control in the emphasis tab.

## Working conditions
Nobody else works on the repo. You own `apps/desktop/src/renderer/**` only. Do not change `apps/desktop/package.json`. Run `npm test` and `npm run typecheck` from the repo root.
