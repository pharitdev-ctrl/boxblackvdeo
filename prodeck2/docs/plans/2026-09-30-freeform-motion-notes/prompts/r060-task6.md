You are implementing Task 6 of the BOXBLACK 0.6.0 plan "Composed sound effects": Main: placement, staleness, level, views.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It covers the project, where to read, the rules and the report format.

Your task is "Task 6" in `docs/plans/2026-10-01-composed-sound.md`. Steps 0 to 4 there are your work.

## Already decided (do not re-decide)

**What Task 2 gives you.** Task 2 is done and in review: `ComposedSound`, `isComposed`, `isSoundPrevious`, `SOUND_VERSION` and the constants are in `@boxblack/core/sound/spec`.

**You own the shared types of this release.**
- In `apps/desktop/src/shared/api.ts`:
  - `StoredOutline.flair.composed?: ComposedSound[]` and `palette?: string`;
  - `ComposedSoundView` and `OwnSoundView`, exactly as "Names shared across tasks" gives them;
  - `HighlightPreview.composed` and `ownSounds`.
- Adding required fields to `HighlightPreview` makes the compiler flag preview literals in renderer tests and `apps/desktop/src/renderer/test/fake-api.ts`. Give those `composed: []` and `ownSounds: []` and change nothing else in the renderer.

**`hashOfHtml(html)`** goes in `composed-cues.ts`: sha256 hex, first 16 characters (`node:crypto`).

**Placement mirrors graphics.** Read `graphicsInForce`, `withWordsNow`, `MOTION_CUT_SHORT_US`, `MOTION_RUN_ON_US`, `renderSeconds` and `hasJob` in `graphics-cues.ts`, and `itemPlaceOf` and `placeOf` in `insert-media.ts`. The rules, from the spec's §8 and the plan's Step 1:

*Words and length*
- A sound's words now are the kept words inside `[atUs, atUs + seconds)` on the cut, in seconds from its start.
- `"cut"` stale means:
  - a word's text or the word count differs from the stored `words`;
  - or it plays more than 0.1 s shorter than `seconds`;
  - or `version !== SOUND_VERSION`.
- How long a sound can play: to the end of its piece's sentence, as graphics do. A sound tied to a graphic plays as long as its graphic plays, plus the graphic's run-on.

*Tied sounds*
- A tied sound (`graphic` set) is placed at its graphic's placed `atUs`.
- If its graphic is not placed, removed, or not a motion graphic, the sound is unplaced.
- It is `"picture"` stale when the graphic's `hashOfHtml(spec.html)` differs from `graphicHtml`, or when the graphic has no fragment.
- It is off when the graphic is off.

*Level*
- Shown when `FLAIR_LEVELS.indexOf(from) <= FLAIR_LEVELS.indexOf(level)` and the point filter passes (`pointId` absent, or the point passes the level).
- Planning views use every level (`"heavy"`), as the graphics planning does.

**Views**
- `render` in a view comes from an injected `soundStatus?: (sound: ComposedSound) => { state: "pending" | "ready" | "failed"; error: string | null }` on the highlights service's deps. Look at how the graphics renderer's status reaches `graphicViews`. Until Task 7b wires the real renderer, an absent `soundStatus` gives `"pending"` for written fresh sounds.
- Unwritten, stale or failed sounds give `"pending"` with no error (the state line speaks for them).

**`ownSounds`.** These are the user's `flair.cues` with `edited: true`, placed as `cuesInForce` places them, named from the sound library (`name`, or `use` when it has one). Claude's old cues (`edited: false`) are not listed. They still play until the next sound plan, which Task 5 does.

**Beats and points.** Find every place that rewrites speech anchors or drops items of `flair.graphics` when beats are renamed or removed, or a point is deleted (`withoutPoint`, `offGoneLines` if it touches graphics, `planner.ts`, `legacy-beats.ts`, `post-cleanup.ts` if relevant), and do the same for `flair.composed`. Composed sounds have no `edited` flag and are never the user's own, so a deleted point removes its sounds. List in your report every place you changed and every place you looked at and left alone, with why.

## Working conditions

Other implementers work at the same time:
- Task 7a, in `packages/core/src/capcut/`;
- Task 3, in `packages/core/src/sound/plan.ts`;
- Task 4, in `apps/desktop/src/main/sound-window.ts`, `sound-render.ts`, `sound-loudness.ts` and `index.ts`, and in `packages/core/src/media/tool-check.ts`.

Do not touch their files. A failing test outside your files is probably theirs in progress: wait and run it again, and do not fix it.
