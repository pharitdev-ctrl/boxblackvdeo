# Agent editor phase 0: findings

## Spike A: segment identity (2026-10-03, CapCut 9.5.0, project "1003 (1)")

Snapshot right after BOXBLACK wrote the draft (6 tracks, 51 segments, 238 materials), then the user opened it in
CapCut, closed it, opened it again, made the edits below and closed it. `compare` against the first snapshot:

```
draft "1003 (1)" · CapCut 9.5.0 → 9.5.0 · draft id kept
tracks: 6 → 7, ids kept 6/6
materials: 238 → 233, ids kept 232/238
segments: 51 → 51 · same id 50 · gone 1 · new 1

== same id, changed ==
- video/videos IMG_9861.MOV @18.93s+3.10s
    duration 3.10s → 2.53s
    keyframes 120 → 120 (ids kept 116)
- text/texts “อร่อยหรือเปล่า?” @9.53s+1.20s
    content “อร่อยหรือเปล่า?” → “อร่อยหรือไหม?”
    start 9.53s → 9.10s
    duration 1.20s → 1.60s
(48 with the same id and nothing changed)

== gone ==
- audio/audios e59bb1679d792ddc.wav @9.53s+0.80s

== new ==
- sticker/stickers 38ab879f27d1b8beb62a462a72261ade @9.50s+3.00s

draft fields added: none · dropped: none
```

**What it shows**

- **CapCut's own save keeps every id.** The 48 segments the user did not touch kept their ids and every field; the
  draft id, all track ids and the materials' ids survived. The compare covers both CapCut sessions, so opening and
  saving alone changed nothing that matters.
- **Each user edit is readable.** Trimming the main video changed its duration; moving and rewording a text changed
  its start, duration and words (read from its material); deleting a sound removed its segment (and its materials:
  238 → 233); a sticker the user added came as a new segment on a new track.
- **Keyframe ids are not stable.** Trimming the clip kept 116 of its 120 keyframe ids: CapCut regenerates the
  keyframes it touches. The app must read keyframes back by time and value, never by id.

**Decision for spec §9:** match pieces by `segmentIds`, as the spec says. Segments the app does not know are the
user's. A known segment that is gone was deleted by the user. Keyframes are compared by content.

Not tested yet: splitting a segment in two (one keeps the id, one is new?), copy and paste, undo after save, and a
draft moved to another Mac. Worth a second round before phase 5.

## Spike B: preview (first round, 2026-10-03)

`scripts/preview-spike.ts` on the draft of "1003 (1)" (after the user's five edits), with the source video sent at
720x1280 (`avconvert --preset Preset1280x720`). The rendered graphics and sounds have not arrived yet, so they and
the user's sticker (a file in CapCut's own cache) are left out; the main track's own audio is mixed.

**Speed:** 22 s of timeline at 540x960, 10 fps: extract 2 s, compose 8 s, encode 3 s (13 s in all, in this container).

**Against CapCut's export** (`1003_1.mov`, exported before the end hold and the edits, so compared at times the two
drafts share):

- **Main video:** the same frame at the same time at every time compared (0.5, 3, 6, 10, 12, 15.5, 18 s); framing
  and the zoom keyframes match by eye. Keyframes are timed in the source file (`time_offset`), positions in halves of
  the canvas from its centre (x right, y up), scale 1 fits the material inside the canvas.
- **Highlight text** (Mali-Bold, which the app ships): same font, size, place and outline once the text size is read
  as `size × 4.8 px` on a 1080-wide canvas, times the segment's scale.
- **Subtitles** (CapCut's system font, which is not ours): same place and size at `size × 3.9 px`; drawn in Loma
  Bold, so the letter shapes differ a little.
- **Not drawn:** CapCut text animations and effects, text templates, stickers from CapCut's cache.

**Sounds** (second run, 13 WAVs from the user): all placed at their times with their volumes and mixed over the main
track's audio; 22 s in 17 s. The audio lines up with the export at zero lag (50 ms steps) and is as loud (−24.5 dB
against −26.1 dB). The envelopes cannot be compared closely yet: the old export was made before "ทำทั้งหมด" was run
again, which composed new sounds.

Next: the graphics (`.mov` with alpha), then a fresh export of this exact draft to compare frame by frame.
