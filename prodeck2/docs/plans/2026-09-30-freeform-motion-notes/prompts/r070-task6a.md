You are implementing Task 6a of the BOXBLACK 0.7.0 plan "Free graphics": Renderer: the prepare line.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first.

Your task is Task 6 **Step 7** of `docs/plans/2026-10-01-free-graphics.md`, together with the four `prepare.objects*` texts of its Step 1 table, copied exactly. The rest of Task 6 is Task 6b, later.

## What exists now (approved, Task 3)

- `api.videosWithoutObjects(folder): Promise<string[]>`.
- `api.locateObjects(folder, videoIds): Promise<void>`. It throws `an analysis is already running` while a job runs.
- An `AppEvent` `{ type: "objects"; folder; videoId; status: { state: "running" } | { state: "done" } | { state: "failed"; error } }`.
- After a run, `analysis-finished`.
- The objects pass also runs at the end of a normal analysis, after vision, with the same events.

Read Task 3's code for the exact names before you start.

## Facts from the code

**`screens/PrepareScreen.tsx`**
- State is at L36-53.
- On mount it reads `analysedVideos`, `knownRetakes` and `getSettings` (L71-88).
- `start` is at L90-113.
- The event handlers are at L115-149.
- Return-to-page rebuilds `running` from `analysisState().transcription` (L140).
- The derived values are at L159-171: `read`, `ready` and `canStart`. `canStart` does not check writing or planning; Next does (L275).
- The footer is at L241-291.
- Notices use `.notice`, and warnings `ul.warnings` (L194-200).

**Styles and errors**
- `failure`-style error text: `lastLines` in `edit/FlairTab.tsx` keeps the last 3 non-blank lines.
- CSS is in `styles/screens.css` (L84 `.notice`).

**Tests**
- `screens/PrepareScreen.test.tsx`: `renderScreen`, `push` and `done` helpers. The analysed-badge tests are at L341-428.
- The fake api: `renderer/test/fake-api.ts` (records calls; `emit`).

## Working conditions

Task 5 runs at the same time in main.

You own:
- `PrepareScreen.tsx` and its test;
- the `prepare.objects*` keys in `i18n.ts`;
- the CSS needed for the notice.

Do not touch the post page.

## Notes from Task 3

- **Stray `analysis-finished`.** An objects-only run (`locateObjects`) on this folder also ends with `analysis-finished` (`done`, `cancelled` or `failed`). Today `PrepareScreen` would treat that as its own analysis finishing, even from idle with no rows.
  - Track whether the page started an objects run itself (or whether `objects` events are flowing), and handle `analysis-finished` accordingly.
  - In every case, read `videosWithoutObjects` again afterwards.
- **No job entry.** The objects-only run is not in `analysisState()`: `state()` still returns the last analysis. A page that comes back mid-run knows the run only from incoming `objects` events.
- **Refusals.** A refused `locateObjects` (lock, readiness, folder) just throws, with no event. Show the error with `prepare.objectsFailed`.
- **Cancel.** A cancel mid-video leaves that video's last `objects` event at `running`, with no final event. On `analysis-finished`, clear every running objects state.
- **Cancel during a full analysis.** A cancel during the objects pass of a full analysis makes the outcome `cancelled`, even though every vision status is done and progress is saved. The rows stay analysed. Only the objects line says the pass did not finish: show the objects notice again, from `videosWithoutObjects`.
- **Small fixes still landing.** Task 3's small fix round runs at the same time in main. `locateObjects(folder, [])` will be refused. Never call it with an empty list.
