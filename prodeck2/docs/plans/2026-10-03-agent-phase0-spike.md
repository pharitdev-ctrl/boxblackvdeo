# Agent Editor, Phase 0: two spikes

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** answer the two unknowns that the agent editor spec (`docs/specs/2026-10-03-agent-editor-design.md` §8 and §9) rests on, before building phase 2:

- **A. Reading the draft back:** after CapCut opens, saves, and the user edits a draft BOXBLACK wrote, can the app still tell which segment is which of its pieces, which the user moved, changed or deleted, and which the user added?
- **B. Preview:** can the app compose a low-resolution preview of the whole timeline (cut, moves, graphics, text, subtitles) with ffmpeg and a browser, close enough to what CapCut shows for Claude to judge its own work?

Nothing here ships. Both are scripts under `scripts/` plus a findings note; the spec is updated from the findings.

---

## Spike A: segment identity (needs the user's Mac)

**Script:** `scripts/id-spike.ts` (read-only, never writes a draft)

```
node scripts/id-spike.ts snapshot "<draft name>"            # writes .spikes/<draft>-<time>.json
node scripts/id-spike.ts compare  "<draft name>" <snapshot>  # prints what changed since
```

A snapshot keeps, per track: the track id and type, and per segment: segment id, material id and type, target start and duration, source start, speed, the text of a text material, the file path of a video, audio or sticker material, and the keyframe ids. `compare` prints, per track: segments with the same id (and what changed on them), segments gone, segments new; whether track ids and material ids survived; and fields CapCut added or dropped.

**Steps for the user** (on "1003 (1)", already written by BOXBLACK; CapCut closed):

1. `snapshot` right after BOXBLACK writes.
2. Open the project in CapCut, change nothing, close CapCut. `compare`. (CapCut saves on open: does that alone change ids?)
3. Open again and make five edits: move one highlight text later, change the words of another, delete one sound, add a sticker of your own, trim the end of the main video. Close CapCut. `compare`.
4. Send the two `compare` outputs.

**Decision:**

| Result | Spec §9 does |
|---|---|
| Segment ids survive the save and the edits | match pieces by `segmentIds` (as written now) |
| Ids change on save, materials keep theirs | match by material id |
| Both change | match by material path or text plus nearest time; note the risk |

## Spike B: preview from a draft (done here)

**Script:** `scripts/preview-spike.ts <draft folder> <out folder>`

- [ ] Read `draft_info.json`. Main track: trim each segment from its source and concatenate, at 540 px wide.
- [ ] Moves and zooms: apply the segment's scale / position keyframes with ffmpeg `zoompan` or `scale`+`crop`, first linear only.
- [ ] Graphics and stickers BOXBLACK rendered: overlay the rendered files at their target times and positions (find out what format they are while doing this).
- [ ] Highlight text and subtitles: draw each text material's words with its font, size, colour and position in a Playwright page to transparent PNGs, overlay for its time. Effects and animations are not copied.
- [ ] Sounds: mix composed and library sounds under the original audio at their times.
- [ ] Out: `preview.mp4` and a contact sheet with times, the shape Claude is sent in vision.

**Needs from the user:** the draft folder of "1003 (1)" zipped (`~/Movies/CapCut/User Data/Projects/com.lveditor.draft/1003 (1)`), `IMG_9861.MOV`, and the folder `~/Movies/CapCut/BOXBLACK` (rendered graphics and sounds). With the export already sent (`1003_1.mov`, written before the end hold), frames of the preview are compared side by side with CapCut's own render at the same times.

**Measure:** per element, whether its place, size and timing match CapCut's export within a few pixels and a frame or two; what does not (text effects, fonts, animations); how long a preview of a 20 s clip takes.

## Out

- [ ] `docs/plans/2026-10-03-agent-spike/findings.md`: both results, with the compare outputs and side-by-side frames.
- [ ] Spec §8 and §9 updated from the findings.
- [ ] Commit and push on `claude/quirky-wozniak-3fhi7t`.

## Risks

- CapCut stores text styles in a JSON string inside the text material; some styles (outline, shadow, CapCut text effects) will not be copied in the preview. Claude would see plain text where the video shows a styled one. The findings say how much this matters.
- Spike A depends on the user's time on the Mac; spike B can start as soon as the files arrive.
