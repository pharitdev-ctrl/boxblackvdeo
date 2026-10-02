You are implementing Task 7a of the BOXBLACK 0.6.0 plan, "Composed sound effects". It is Core: the draft writer for a local WAV, and its bin item.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It holds the project, where to read, the rules and the report format.

Your task is Steps 1 and 2 of "Task 7" in `docs/plans/2026-10-01-composed-sound.md`. The plan calls this part 7a. Steps 3 and 4 (7b) are not yours.

## What CapCut writes

The controller proved with CapCut 9.5 and the user how CapCut stores a local WAV. Read `docs/plans/2026-10-01-sound-spike/capcut-local-wav.md`. The synthetic fixtures are in `packages/core/src/capcut/fixtures/local-wav/`: `material.json`, `extras.json`, `segment.json`, `track.json` and `bin-item.json`. Your writer must produce exactly these shapes, field by field. New ids follow the case CapCut used:
- upper-case UUIDs for the material, extras, segment and track;
- lower-case UUIDs for the bin item, which is also the material's `local_material_id`, and for `music_id`;
- 32 random hex digits for `unique_id`.

## Already decided (do not re-decide)

**The writer**
- `addComposedSoundTrack(info: DraftInfo, sounds: { atUs: number; durationUs: number; path: string; binId: string }[], newId?: () => string): Written` goes in `packages/core/src/capcut/composed-sounds.ts`.
- It follows `addSoundTrack` in `capcut/sounds.ts` for the rest:
  - each start snapped to a frame;
  - first free lane;
  - one `{ type: "audio", flag: 0, attribute: 0 }` track per lane;
  - the extra materials merged into their lists;
  - `track_render_index` as `addSoundTrack` sets it;
  - the `Written` result.
- It differs from `addSoundTrack` here:
  - no 1.5 s cap;
  - volume 1.0;
  - no `audio_fades`;
  - material `type: "extract_music"` with `category_name: "local"`.
- If `addSoundTrack` has helpers worth sharing (frame snapping, lanes, merging lists), share them rather than copy them. Do not change what `addSoundTrack` writes; its tests stay unchanged and green.
- Inject the id makers, as the existing writers do, so tests are deterministic.

**The bin item and pruning**
- `soundBinItem({ id, path, durationUs, nowMs }): BinItem` goes in `bin.ts`, beside `graphicBinItem`. It gives the fixture's bin item, with `metetype: "music"`.
- Add `RENDERED_SOUNDS_FOLDER = "/Movies/CapCut/BOXBLACK/sounds/"` and `isRenderedSound(path)`.
- `pruneBinItems(meta, dir, keep)` prunes only under the folder it is given. Look at it first. If it is fixed to the graphics folder, generalise it so that a caller can prune the sounds folder too, and keep its current callers working unchanged.
- Test that `binVideos` and the spare-media reader (`flair/media.ts`) do not list a `"music"` bin item.

**Scope**
- Nothing in `apps/desktop/src`. The wiring is Task 7b.

## Working conditions

- Task 2 is being implemented at the same time, in `packages/core/src/sound/` and `packages/core/package.json`. Do not touch those.
- If a test outside your files fails while you work, it is probably theirs in progress. Wait and run it again; do not fix it.
- The gate stood at 155 files, 2591 passed and 3 skipped, with typecheck clean, when you started.
