You are implementing Task 8 of the BOXBLACK 0.6.0 plan "Composed sound effects": Main: redo, edit, undo, off and remove; sounds follow graphics; the api.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It covers the project, where to read, the rules and the report format.

Your task is "Task 8" in `docs/plans/2026-10-01-composed-sound.md`. Steps 1 to 6 there are your work.

## What exists now (approved)

- **`apps/desktop/src/main/sound-work.ts`.** Work 4 plans, stores and composes. Read how it composes one placed sound:
  - `renderSeconds(durationUs)`, `wordsNow`, `soundBrief` with the palette and, for a tied sound, the graphic's idea and html;
  - `writeChecked` with `renderer.check`;
  - storing by `samePlace` without resurrecting.
- **The 0.5.1 graphic actions you mirror.** All in `apps/desktop/src/main/flair.ts`:
  - `afterWriting`, `afterEdit`, `keptBefore`, `fragmentHeld`, `steppedBack`;
  - `writeGraphic`, `placedToWrite`, `redoGraphic`, `editGraphic`, `undoGraphic`, `setGraphic`;
  - `post-plan.ts`: `redoGraphic`, `editGraphic`, `undoGraphic`, `refuseWhileRunning`, `undoing`.
- **`apps/desktop/src/main/composed-cues.ts`.** `composedInForce`, `hashOfHtml`, and the highlights service's `composedSounds(folder, rules, options)`, which places the stored sounds.
- **`packages/core/src/sound/write.ts`.** `soundBrief`, `soundRepairBrief`, `soundEditBrief`, `composeSound`. **`packages/core/src/sound/spec.ts`:** `isSoundPrevious`.

## Already decided (do not re-decide)

**One composing path.**
- Factor the "compose one placed sound and store it" code out of `sound-work.ts` into a function that work 4, `redoSound`, `editSound` and the graphic hooks all use. It takes an optional `edit: { instruction, code }`. An edit's first brief is `soundEditBrief({ brief: soundBrief(...), code, instruction })`. It is stored with `afterEdit`'s rules for sounds:
  - written: new code, `instruction`, and `previous` kept;
  - failed: the sound unchanged except for `editFailed`.
- A redo is stored with `afterWriting`'s rules: `previous` kept, `instruction` and `editFailed` removed.
- Move this shared code; do not copy it.
- `sound-work.ts` is yours to edit for this. Task 5's fix round is now finished.

**`previous` for sounds.** It is `SoundPrevious`, `{ code, seconds, words, version, graphicHtml?, instruction? }`, kept the way `keptBefore` keeps a fragment. Undo swaps `graphicHtml` too.

**Error messages.** Exactly:
- `this sound has no place on the clip now`
- `this sound has not been written yet`
- `this sound has nothing to go back to`
- `composing sounds is not ready: no Claude connection`

**Runs.**
- `redoSound` and `editSound` are one run of the `"sounds"` work alone, refused while another run goes, with progress `(0,1)` then `(1,1)`.
- `undoSound` and `setSound` are not runs. `undoSound` is refused while a run goes, sharing the `undoing` mark.
- `setSound` follows `setGraphic`, as a quick change.

**Graphic hooks** (spec §11):
- **After `editGraphic` or `redoGraphic` stores a written graphic**, the same run composes again every sound tied to it (by `samePlace` on `graphic`), through the one composing path. The run's works become `["graphics", "sounds"]`, and progress reports the sounds work.
- **A failed graphic writing** touches no sound.
- **`undoGraphic`**, in the same outline update: a tied sound whose `previous.graphicHtml` equals `hashOfHtml` of the fragment that comes back is swapped too. Other tied sounds are left alone; they read "picture" stale.
- **`setGraphic(null)`** removes the tied sounds.
- **`planGraphics`** (rethinking graphics) removes the sounds tied to graphics that are gone.

**API.**
- Add to `DesktopApi`, `API_METHODS` and `highlight-api.ts`:
  - `redoSound(folder, anchor, request)`
  - `editSound(folder, anchor, instruction, request)`
  - `undoSound(folder, anchor)`
  - `setSound(folder, anchor, patch: { off: boolean } | null)`
- Anchors are checked as for graphics. The instruction goes through `instructionOf`. The patch is `{ off: boolean }` or null.
- `redoSound` and `editSound` go in `LICENSED_METHODS` and its pinned list.
- `setSoundCue` refuses a non-null `effectId` with `choosing a CapCut sound is no longer possible`; null still removes.
- `renderer/test/fake-api.ts` gains the four methods.

**`forgetMachine`.** Every redo or edit calls `forgetMachine()` on the sound renderer first, as graphics do.

## Working conditions

Task 7b's fix round may still be running, in:
- `apps/desktop/src/main/timeline.ts`
- `composed-cues.ts`
- `highlights.ts`
- `index.ts`

Do not touch those. A failing test outside your files is probably theirs in progress: wait and run it again, and do not fix it.
