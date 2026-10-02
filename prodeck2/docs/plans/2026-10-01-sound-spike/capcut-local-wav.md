# How CapCut stores a local WAV (Task 1 of 0.6.0, 2026-10-01, CapCut 9.5)

## How it was found

- **Step 1: CapCut's own write.** The user made a new project, "ทดสอบเสียง", and imported `~/Movies/CapCut/BOXBLACK/sounds/spike-countdown.wav`. They dragged it onto the timeline and closed CapCut. That project was then read, read-only (it is the user's).
- **Step 2: the same write by code.** It went into draft 0917, which was backed up first (`before-060-wav`). The script is `scratchpad/r060/wav-into-0917.mts`, kept below in outline. The WAV was placed at 12.633 s, on the spoken "สาม".
- **Step 3: the user's check in CapCut 9.5.** They opened 0917 and found:
  - a new audio track, in time with the countdown;
  - an export with no Pro prompt.

  They closed CapCut. On re-saving, CapCut kept the material (path, duration, `local_material_id`, `category_name`) and the segment (12 633 333 µs, 4 000 000 µs).
- **Step 4: cleanup.** 0917 was restored from the backup and is identical to it.

Synthetic copies of every JSON part are in `packages/core/src/capcut/fixtures/local-wav/`: `material.json`, `extras.json`, `segment.json`, `track.json` and `bin-item.json`. The ids and the path in them are replaced, and no user data is kept.

## The shape

**The material (`materials.audios`)**
- `type: "extract_music"` and `category_name: "local"`. It is not `"sound"`, so the sound library (`soundsInDraft`, which reads only `type:"sound"`) never counts it, and `soundNeedsPro` never sees it.
- `name` is the file's base name, and `path` is the absolute path.
- `duration` is the file's length in µs.
- `music_id` is a new lower-case UUID.
- `local_material_id` is the bin item's id, a lower-case UUID.
- `unique_id` is 32 hex digits. It is not the file's md5; it is written as a new random value.
- `check_flag: 1`, `source_platform: 0`, `app_id: 0`, `copyright_limit_type: "none"`, `wave_points: []`.
- Every other field is empty or default, as in the fixture.
- The material's `id` is an upper-case UUID.

**The extra materials** the segment references, in this order (each an upper-case UUID id):
1. `speeds` (`speed`)
2. `placeholder_infos` (`placeholder_info`)
3. `beats`
4. `sound_channel_mappings`
5. `vocal_separations`

These are the same five that `addSoundTrack` writes for library sounds. There is no `audio_fades` entry unless a fade is set.

**The segment.** It is the same as a library sound's, with these values:
- `volume: 1.0` and `last_nonzero_volume: 1.0`;
- `source_timerange {0, duration}` and `target_timerange {at, duration}`;
- `track_render_index` is the track's index.

**The track.** `{ type: "audio", flag: 0, attribute: 0 }`, as for library sounds.

**The bin entry** (`draft_meta_info.json`, `draft_materials` group `type: 0`):
- `metetype: "music"`, `type: 0`, `item_source: 1`;
- `file_Path` is the absolute path, and `extra_info` is the base name;
- `duration` and `roughcut_time_range {0, duration}`;
- `sub_time_range {-1, -1}`;
- `width: 0`, `height: 0`, `md5: ""`;
- the id is a lower-case UUID, the same one as the material's `local_material_id`.

## What the writer must take care of (Task 7)

- `binVideos` and the spare-media list filter by `metetype`, so a `"music"` bin item stays out of footage and cutaways. Pin this with a test.
- `pruneBinItems` must prune `BOXBLACK/sounds/` items that are no longer laid, as it does for `graphics/`.
- There is no 1.5 s cap, as there is for library sounds.
