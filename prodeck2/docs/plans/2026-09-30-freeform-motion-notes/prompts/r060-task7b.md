You are implementing Task 7b of the BOXBLACK 0.6.0 plan "Composed sound effects": Main: laying composed sounds into the CapCut draft, and cleaning their files.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It covers the project, where to read, the rules and the report format.

Your task is Steps 3 and 4 of "Task 7" in `docs/plans/2026-10-01-composed-sound.md`, the part the plan calls 7b.

## What exists now (approved)

- `packages/core/src/capcut/composed-sounds.ts`: `addComposedSoundTrack(info, sounds: TimelineComposedSound[], newId?)`, with `{ atUs, durationUs, path, binId }` per sound.
- `packages/core/src/capcut/bin.ts`: `soundBinItem`, `RENDERED_SOUNDS_FOLDER`, `isRenderedSound`, and a generalised `pruneBinItems(meta, dir, keep)`. It drops BOXBLACK's own rendered graphics or sounds, under the folder it is given.
- `apps/desktop/src/main/sound-render.ts`: `createSoundRenderer`, with `ensure(jobs)` (a promise that never rejects), `statusOf`, `fileOf`, `idle()` and `SoundJob`. Temp names never match `^[0-9a-f]{16}\.wav$`.
- `apps/desktop/src/main/composed-cues.ts`: `composedInForce` and the highlights service's `composedSounds(folder, rules, options)`, which places stored sounds the way the preview does.
- Findings on the draft shape: `docs/plans/2026-10-01-sound-spike/capcut-local-wav.md`.

## Already decided (do not re-decide)

**Which sounds are laid.** A sound is laid when every one of these holds:
- it is placed, written and fresh;
- it is not off, and it is shown at the level;
- its file is ready after `ensure`;
- if it is tied to a graphic, that graphic is laid in this same write.

A tied sound whose graphic is left out (stale, unwritten, failed or off) is left out too, and counted as stale.

**The write waits.** It waits for `ensure` of the composed jobs, the way it waits for graphics. Read `timeline.ts` around where graphics are ensured and waited for, and treat sounds the same way, including the "unsettled" handling.

**Lengths.** `durationUs` passed to the writer is the WAV file's own length, in whole microseconds, read from the file. Use the renderer's knowledge or read the WAV header's data size: bytes / 4 / 48000. Do not use the room. The writer shortens a sound only at the end of the timeline.

**Bin items.**
- One `soundBinItem` per laid file, reusing an existing bin id for the same path (`binIdOf`), as graphics do.
- Pruning drops `BOXBLACK/sounds/` items not laid now, in the same `bin` callback as graphics. Either call `pruneBinItems` once per folder with each folder's keep set, or once on the parent folder with both sets; say which.

**Order of tracks.** Composed sound tracks are laid before the CapCut `sounds` tracks, both after the graphics.

**`WriteResult`.** It gains `composedCount` and `composedLeftOut: { unwritten: number; stale: number; failed: number }`. `failed` counts both a failed writing and a failed render. Look at how `dropped` and `proLeftOut` are reported and tested.

**Files.**
- `cleanGraphicFiles` also cleans `<hash>.wav` in the sounds folder that no draft or backup names.
- `GRAPHIC_NAMED` (or its equivalent) also finds `<16 hex>.wav` names in a draft's JSON.
- `graphicFilesInfo` counts both folders.
- Busy also covers the sound renderer (`!soundRenderer.idle()`) where `index.ts` wires the clean. That one `index.ts` line is yours; Task 5 also edits `index.ts`, so keep your change to that line and say so.

**Temp files.** The renderer's temp files are `<hash>.raw.wav` and `<hash>.wav.tmp`. One that a crash left behind stays forever unless the cleaner takes it. The cleaner therefore also trashes those two patterns when they are older than the settling time and the sound renderer is idle. Note that `.raw.wav` ends in `.wav`: the pattern for kept sounds must be exactly `^[0-9a-f]{16}\.wav$`.

**Settings texts.** If the settings screen's file info shows a count or size, it now covers both kinds. Change no Thai text; if a text becomes untrue, say so in your report.

## Working conditions

Task 5 runs at the same time, in:
- `apps/desktop/src/main/piece-write.ts`, `motion-write.ts`, `sound-work.ts`, `flair.ts`, `post-plan.ts`;
- `index.ts` (renderer wiring);
- `packages/core/src/flair/` (removals).

Do not touch those, except the one `index.ts` line above. A failing test outside your files is probably theirs in progress: wait and run it again, and do not fix it.
