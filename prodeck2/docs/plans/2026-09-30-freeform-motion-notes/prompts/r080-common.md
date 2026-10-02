## The project in brief (0.8.0)

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. It is a monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`:
- `packages/core` is pure TypeScript.
- `apps/desktop/src/{main,shared,renderer}` is the Electron app.

Node 26 runs TypeScript natively, the tests are vitest, and there is no git.

**Release 0.8.0 ("free zoom")**: Claude designs the picture's moves itself. A move is a list of poses (scale, shift, rotation, ease) anchored on a spoken word or on a cutaway. The app checks every move (scale cap by resolution, rotation, no black edge, the face stays in frame, a shown thing's centre stays on screen) and writes it as CapCut keyframes. Highlight text and graphics then avoid the face where it is after the zoom. Legacy punch/drift zooms keep playing until thought again.

## Where to read

- **The plan:** `docs/plans/2026-10-02-free-zoom.md`. Read "How to run this plan", "Files" and "Names shared across tasks", then your task. Prompts and prompt lines in the plan are copied verbatim, never reworded.
- **The spec (Thai):** `docs/specs/2026-10-02-free-zoom-design.md`.
- **The spike:** `docs/plans/2026-10-02-zoom-spike/` (what CapCut plays; the keyframe JSON shape).

## Rules of this repo

The rules of `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` ("Rules of this repo", "Working conditions", "Report format") apply unchanged. Read that file's sections; ignore its 0.7.0 project summary.
