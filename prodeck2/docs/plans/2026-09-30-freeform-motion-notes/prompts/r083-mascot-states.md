You are adding the mascot's poses to the BOXBLACK renderer (0.8.3), at the user's choice: a small picture beside the status messages that already exist. No new screens.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` for the repo rules and report format (ignore its 0.7.0 summary).

## Assets
- Sources (cut out, transparent, about 600 to 900 px): `apps/desktop/build/mascot-think.png`, `mascot-work.png`, `mascot-done.png`, `mascot-oops.png`. `mascot-wave.png` is already used: `apps/desktop/src/renderer/src/assets/mascot-wave.png` (downscaled with `sips -Z 256`), shown in `screens/ProjectsScreen.tsx` as `<img className="mascot" src=… alt="" />`, styled in `styles/screens.css`, tested in `App.test.tsx` ("the project list's head has the waving mascot…").
- Make the four the same way: `sips -Z 256 <src> --out apps/desktop/src/renderer/src/assets/mascot-<pose>.png` (run from the repo root). Keep each under ~120 KB; if larger, use `-Z 192`.

## Where each pose shows
1. **think** beside the running AI state: the "✦ AI กำลังวางแผน…" state of the AI menu button on the post page (`edit/AiMenu.tsx`, `running`), and the running state of `edit/PlanStrip.tsx` if it shows a running line. Pick the one place that reads as "the AI is thinking" without widening the bar: if inside the 900 px bar there is no room, put it in PlanStrip only, and say so.
2. **work** beside the write in progress ("กำลังเขียน…", `write.writing`, in `edit/WriteButton.tsx` or wherever it shows), and beside rendering/progress lines if one exists in the same place.
3. **done** in the message after a successful write (`write.done*`, `edit/writeEnd.tsx` and the toast it feeds; read `ui/Toast.tsx`).
4. **oops** in error messages of the same flows: `write.failed`, a failed plan run, and the app-wide alert bar (`shell/AlertBar.tsx`) if it shows errors.

## Rules
- One small shared component, e.g. `ui/Mascot.tsx`: `<Mascot pose="think" size={…} />`, rendering `<img className="mascot mascot-<pose>" alt="" …>` (decorative; the text beside it says everything).
- Sizes: about 28 to 40 px tall in bars and toasts, never changing a bar's height or width at 900 px. Use existing layout; add CSS in the stylesheet that owns each place.
- `prefers-reduced-motion`: no animation needed; if you add a gentle one (e.g. a small bob while thinking/working), turn it off under reduced motion.
- Dark and light themes: the cutouts work on both; do not add backgrounds.
- Do not change any text or behaviour.

## Tests (first)
For each place: the right pose shows in that state and not in the others (e.g. think while running, not when idle; done after a write; oops on `write.failed`), and `alt` is empty. Keep existing tests passing.

## Working conditions
Nobody else works on the repo. You own `apps/desktop/src/renderer/**` and may add files under `apps/desktop/src/renderer/src/assets/`. Do not touch main, shared, core or `apps/desktop/package.json`. Run `npm test` and `npm run typecheck` from the repo root. Report where each pose ended up, and any place you chose not to use and why.
