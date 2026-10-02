You are implementing Task 5 of the BOXBLACK 0.6.0 plan "Composed sound effects": Main: the write loop made generic, and work 4.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It covers the project, where to read, the rules and the report format.

Your task is "Task 5" in `docs/plans/2026-10-01-composed-sound.md`. Steps 1 to 6 there are your work.

## What exists now (approved)

- `packages/core/src/sound/`:
  - `spec.ts`;
  - `lint.ts`;
  - `write.ts` (`soundBrief`, `soundRepairBrief`, `composeSound`);
  - `harness.ts`;
  - `plan.ts` (`planComposedSounds`, `describeSoundClip`; duplicates by word; fragments budget).
- `apps/desktop/src/main/sound-render.ts`:
  - `createSoundRenderer({ dir, ffmpeg, page })`, with `check(job)`, `ensure`, `statusOf`, `fileOf`, `forgetMachine`;
  - `SoundJob` = `{ code, seconds, words, loudness }`.
- `apps/desktop/src/main/sound-window.ts`: `createSealedPage(electron)`. `index.ts` already makes the sealed page in `whenReady`.
- `apps/desktop/src/main/composed-cues.ts`:
  - `hashOfHtml`;
  - `composedInForce`;
  - `wordsOnCut(sentences)` and `wordsWithin(words, atUs, seconds)`;
  - the highlights service's new `composedSounds(folder, rules, options)`, which places stored sounds the way the preview and the write do.

## Already decided (do not re-decide)

**Compose for the room each sound really has.** Task 6 marks a sound stale ("cut") when it plays more than 0.1 s shorter than its `seconds`, or when its words differ.

- When work 4 stores the planned list, it must not put the planned `seconds` straight in. It does this instead:
  1. It stores the sounds (code null).
  2. It places them with `composedSounds` (or the same functions).
  3. It writes each one for `renderSeconds(durationUs)` and its `wordsNow`, as `writeGraphic` writes a graphic for the room it has now.
- A planned sound that has no place on the cut is stored and counted, but not written. It shows as unplaced.
- Words in a brief are rounded to the millisecond. `wordsWithin` already does this.

**`SoundClip.words` comes from `wordsOnCut`, so planning and placing cannot disagree.** For a graphic sound, `acceptSoundPlan` resolves its word to the graphic's first word. The stored anchor is the graphic's anchor, and `graphic` is that same anchor.

**Untied sounds.** An untied sound's anchor is a `speech` anchor at the word's source time, in the shape `flair.ts` builds for graphics from a planned word. Follow `acceptMotionPlan` and its caller.

**`writeChecked` and `motion-write.ts`.**
- `writeChecked` must behave exactly as `writePiece`. Keep `motion-write.test.ts` unchanged and green. If some of its tests reach into internals that move, say so instead of editing them.
- Build the renderer's `check` into the loop as `check: (code) => renderer.check({ code, seconds, words, loudness })`.
  - `null` means "cannot render here". Accept on the lint alone, as graphics do. The sound then has its code but no file. Its render state stays "pending" until `ensure` makes it, which is Task 7b's wiring.

**Wiring.** Work 4 needs the renderer and the sealed page, so wire them in `index.ts`:
- create the sound renderer with `dir = join(homedir(), "Movies", "CapCut", "BOXBLACK", "sounds")`, the bundled `ffmpeg` getter, and the sealed page;
- pass it to the flair or post services the way the graphics renderer is passed.

Keep `index.ts` changes to that.

**Placing.** `composedSounds` does not return the full stored list. When graphics are switched off or there is no canvas, it leaves tied sounds out of every list. Never treat "not returned" as "gone": work 4 stores the whole planned list, and writes only the sounds that have a place.

**Old CapCut sound picks.**
- Each run of work 4 drops `flair.cues` entries with `edited: false`, and keeps those with `edited: true`.
- The old planner `flair/sound-plan.ts` goes to the Trash, with its test and the `./flair/sound-plan` export entry in `packages/core/package.json`.
- `soundSlotsFor` goes too, with its tests. `slotsFor` and `cuesInForce` stay.

**No Claude connection.** It fails with `composing sounds is not ready: no Claude connection`.

## Working conditions

Task 7b runs at the same time, in:
- `apps/desktop/src/main/timeline.ts`;
- `apps/desktop/src/main/graphics-files.ts`;
- `packages/core/src/capcut/*`;
- `WriteResult` in `apps/desktop/src/shared/api.ts`.

Do not touch those. If you must add a field to `shared/api.ts`, keep it to `StoredOutline` and say so. A failing test outside your files is probably theirs in progress: wait and run it again, and do not fix it.

**Quitting.** Task 4 left this for you. In `index.ts`'s `before-quit`, call `soundRenderer.cancel()` just before `soundPage.close()`; there is a comment there marking the place.
