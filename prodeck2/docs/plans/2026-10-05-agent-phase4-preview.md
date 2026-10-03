# Agent Editor, Phase 4: Claude sees its own work

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** in the "คุยกับ AI" tab Claude looks at frames of the clip as it would come out of CapCut — the cut, the
moves, the graphics, the text and the subtitles drawn together — and fixes what looks wrong before it says it is done.
The user can play the same preview, with sound, in the tab. This is what makes the chat in claude.ai good (spec §1):
the editor sees the result, not only numbers.

**Not in this phase:** reading the draft back after the user edits it in CapCut (phase 5); CapCut's own text
animations, effects, templates and stickers from its cache (not drawn; the tab says so).

**Spec:** `docs/specs/2026-10-03-agent-editor-design.md` §8, §12 phase 4. Spike B (`docs/plans/2026-10-03-agent-spike/findings.md`,
`scripts/preview-spike.ts`) showed it works: the main video and its keyframes match CapCut's export frame for frame,
highlight text matches (the app's own font), subtitles match in place and size (another font), graphics with alpha
land where they should, sounds are in time; 22 s of clip composed in about 15 s.

**Tech Stack:** TypeScript, the app's bundled ffmpeg, a hidden Electron window with a canvas (no Playwright, no
graphics pack needed), vitest. Done means `npm test` (no new failures against the 10 known ones), `npm run typecheck`
(no new errors against the 8 known ones), the preview checked against a CapCut export of the same draft, and a run with
real Claude on "1003 (1)".

---

## Decisions

| # | Topic | Choice |
|---|---|---|
| 1 | What the preview is made from | The draft the tab's write would produce: the pure `writeTimeline` (phase 2) run in memory on the agent's working timeline over the project's current draft. Nothing is written to disk. So Claude sees what CapCut would get, through the same writer |
| 2 | How it is drawn | Spike B's way, moved into the app. Core (`packages/core/src/preview/`): pure functions that read a draft and answer, for a moment of the timeline, the layers to draw — the main video's source time and transform from its keyframes, each graphic's file, frame and place, each text's lines, font, size, colour, outline, place. Desktop: ffmpeg pulls the video frames (and the graphics' frames, with alpha) at the moments needed; a hidden, sealed Electron window draws each moment on a canvas from those layers and hands back the picture |
| 3 | What Claude gets | Still frames, not video: a contact sheet of a span, one frame every 0.5 s (fewer for a long span, at most 40 frames), each 288 px wide (sheets of 4 × 2 = 1152 × 1024, under the size the API shrinks; about 200 tokens a frame) with its time on the rough cut written on it. Sounds are already in the timeline text Claude reads (what, where, how loud); not drawn |
| 4 | When Claude looks | A new action `look` (`fromS`, `toS`; the whole clip when both are null). Its frames go into Claude's next request only, as images; older looks are dropped from the history (a line says one was seen), so a long chat does not carry every picture |
| 5 | The review before done | When Claude says `done` after a message that changed something on screen (text, move, graphic) and has not looked since, the app looks at the spans that changed and gives Claude one more round with the frames: "ตรวจภาพก่อนจบ". At most one review per message, so it cannot loop. It counts in the 25 rounds |
| 6 | Cost | About 300 image tokens a frame; a whole 22 s clip is 40 frames, about 12k tokens, about $0.05 on Opus 5.5. Shown in the tab's cost as today |
| 7 | The user's preview | A "ดูตัวอย่าง" button in the tab composes the whole clip at 540×960, 15 fps, with the main audio and the sounds mixed (ffmpeg), and plays it in the tab (as JPEG frames over a WAV, not an MP4: the shipped ffmpeg is LGPL and encodes no H.264/AAC) with a note that CapCut's own text effects are not shown. Made on request, kept until the timeline changes |
| 8 | Graphics repaired after render | The phase 3 gap: `add_graphic` renders and inspects each fragment the way "ทำทั้งหมด" does (`renderProblems` in `flair.ts`, handed to `writePiece` as `render`), so a broken fragment goes back to its writer once before Claude hears of it |
| 9 | Speed | A look of the whole clip should take under 10 s on a Mac (spike: 15 s in the container for 220 frames at 10 fps; a look is 40 frames). Frames from ffmpeg are cached per source file and time for the session |

## Tasks

- [x] **1. Core: the layers of a moment.** `packages/core/src/preview/` — from a draft (`DraftInfo` content) and
  a time: the main video's source file, source time, scale, position, rotation (from its keyframes, by
  `time_offset`, as spike B found); each overlay video (graphic) with its file, its own time and place; each text
  segment with lines, font file, size in px (`size × 4.8` text, `× 3.9` subtitle on 1080 wide, times scale), colour,
  outline, bar, place; in track order. Pure, tested against the "1003 (1)" golden draft and the spike's numbers.
- [x] **2. Desktop: frames and the drawing window.** `preview-frames.ts`: ffmpeg pulls frames at given source times
  (PNG, alpha kept for ProRes 4444), cached per session. `preview-window.ts`: a hidden window sealed like the sound
  window (own in-memory session, no preload, no network, files handed in as data), loads the app's fonts, draws a list
  of moments, answers PNGs. Tests with fakes; one real-Electron check on the Mac.
- [x] **3. Desktop: a look.** `preview.ts`: from the agent's timeline → in-memory draft (decision 1) → moments in the
  span (decision 3) → frames → drawn → contact sheet PNGs with times written on. Test: a look of a span gives the right
  moments and times; a timeline change gives new pictures.
- [x] **4. The agent: `look` and the review.** Core: the `look` action in the schema and the prompt (when to look:
  after changing what is on screen, before saying done; what the frames are and are not: no CapCut text effects).
  Images in the next request only (decision 4). Desktop: the loop runs a look, and the review round (decision 5).
  Tests: a look's frames reach the next request and leave the one after; the review runs once, only after on-screen
  changes, and not when Claude looked already.
- [x] **5. Graphics repaired after render.** Decision 8, with a test that a fragment whose render fails is rewritten
  once.
- [x] **6. The user's preview.** Decision 7: compose at 15 fps with audio mixed, play in the tab over the app's media
  protocol, note under it. Harness screenshot.
- [ ] **7. Check against CapCut and with real Claude.** On the Mac: write the agent's timeline, export from CapCut,
  compare with the preview frame by frame (`scripts/preview-spike.ts` comparison); then a chat on "1003 (1)" asking
  for a change and a look at what Claude fixes after seeing it. Plan doc results, commit, push.

## Risks

- **Not quite CapCut:** subtitles in another font, no text animations. Claude might fix what is only a preview
  difference. The prompt says what the preview does not show; the user's preview carries the same note.
- **Speed on long clips:** a 2-minute clip is 240 frames at 0.5 s; a look is capped at 40 frames, so Claude looks at
  spans, not the whole clip at once.
- **Claude Code CLI:** images go through the CLI as they do for the vision step today; no prompt cache there, so
  looks cost more on it than on the API key.

## Results (tasks 1–6, 2026-10-05)

| Task | Commit | What |
|---|---|---|
| 1 | `packages/core/src/preview/` | `readPreviewDraft`, `layersAt`, `momentsOf`, `drawTiles` (self-contained, handed to the page as source; checked in a test by running it from its text alone, and in the built `out/main/index.js`) |
| 2 | `preview-frames.ts`, `preview-window.ts` | single frames per moment with ffmpeg, cached for the session; one hidden sealed window (own in-memory session, data: and about:blank only, no preload) that loads fonts as bytes and answers JPEG |
| 3 | `preview.ts` | a look: the agent's timeline written in memory with `writeTimeline`, read, frames pulled, sheets of 8 drawn |
| 4 | `agent.ts`, core `look` action | sheets in the next request only (`PICTURES_NOTE` says what the preview lacks); the review before done, once per message; the tab shows the last look (`agentLook`) |
| 5 | `agent-wiring.ts` | graphics rendered and inspected while written, as `renderProblems` does |
| 6 | `preview-video.ts`, `PreviewPlayer.tsx` | the user's preview: frames per segment in one ffmpeg run, drawn, WAV mixed, played in a sheet over the media scheme (`boxblack-media://preview/<id>/<file>`) |

**Tried in the container on the user's "1003 (1)" draft** (720p source, two graphics, the sounds): a look of the whole
22 s (40 moments) pulled its frames in 3.6 s and drew five sheets in 0.4 s; the user's preview (330 frames + WAV)
took 10 s. Frames line up in time with CapCut's export; text, subtitles and graphics land where the export has them
(`docs/plans/2026-10-05-agent-phase4/`). Tests: 3,175 passed, the same 10 known failures; typecheck the 8 known errors.

**Not done here:** task 7 needs the Mac (a CapCut export of a draft the agent wrote, and a chat with real Claude). The
player was not screenshotted in the harness, which cannot serve preview frames; a renderer test covers it.
