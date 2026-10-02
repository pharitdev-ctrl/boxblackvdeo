## The project in brief (0.9.0)

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts (monorepo: `packages/core` pure TypeScript; `apps/desktop/src/{main,shared,renderer}`; Node 26, vitest, no git).

**Release 0.9.0 ("sound library")**: to speed up the sounds work, Claude picks a sound from a library before composing one. The library: sounds Claude composed before (one-shots only), CapCut's 28 free built-ins, audio files the user imported into CapCut, and (only with the "มี CapCut Pro" setting) CapCut library sounds other projects use. A picked sound tied to a graphic is laid on each of the graphic's beats, which the graphic's writer reports as `<!-- beats: … -->`.

## Where to read
- **The plan:** `docs/plans/2026-10-02-sound-library.md`: "How to run this plan", "Files", "Names shared across tasks" (exact names), then your task. Prompt text in the plan is copied verbatim.
- **The spec (Thai):** `docs/specs/2026-10-02-sound-library-design.md`.

## Rules
The rules of `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` ("Rules of this repo", "Working conditions", "Report format") apply unchanged; ignore its 0.7.0 summary.
