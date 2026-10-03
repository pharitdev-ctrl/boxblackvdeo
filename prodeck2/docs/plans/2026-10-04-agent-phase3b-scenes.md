# Agent Editor, Phase 3b: what the prepare step saw, given to the agent

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the "คุยกับ AI" tab uses what Claude already saw when the project was prepared, as "ทำทั้งหมด" does:
Claude reads each scene (what it shows, the band to keep clear, the faces and shown things), and the app's checks keep
moves, text and graphics off faces. No new look at the video, no new cost.

**Why:** phase 3 gave the agent the outline and the words only, and its move check had `faces: null`, text was laid
with `keepClear: null`, and a graphic's box was not checked against anything. The data is there: the prepare step
(`packages/core/src/vision/`) stores per clip `insight.scenes` (description, kind, issues, `keepClear` band) and
`objects.scenes` (keep/other boxes, faces marked).

**Not in this phase:** the preview of the edited result (phase 4).

**Tech Stack:** TypeScript, vitest. Done means `npm test` (no new failures against the 10 known ones), `npm run
typecheck` (no new errors against the 8 known ones).

---

## Decisions

| # | Topic | Choice |
|---|---|---|
| 1 | Scenes for Claude | `AgentFootage.scenes`, built with the pipeline's `scenesOnCut(plan, withFacesKnown(clips))` (times on the rough cut). `describeFootage` adds a "ฉาก" list in the same format the techniques call uses (`describeTechniques`): time, kind, description, keepClear, and the things with faces marked `หน้า` and their boxes. The line format is moved to one exported helper so both use it |
| 2 | Moves | `AgentClip.cuts[i]` carries, instead of `faces`/`shown`, the piece's framing `base` and its `scenes` (start/end on the piece, faces, shown) from the pipeline's `boxesOf`. `placeMove` checks like `judgeOnPiece`: the faces and things of the scenes the move plays over, then the pose it ends on, held to the next move or the piece's end, scene by scene |
| 3 | Text | `add_text` lays the lines with the keepClear band of the scene playing when the text comes up (as `keepClearAt` gives), so `layoutGroup` puts it above or below a face, as the pipeline does |
| 4 | Graphics | before writing, `add_graphic` checks the box against the faces and shown things of the scenes it plays over; covering one longer than `COVER_MAX_US` is refused with the face's box in the reason, so Claude can move it — the same rule `admitFree` uses. Checked before rendering, so a refused one costs nothing |
| 5 | Prompt | one paragraph: use the scenes to choose what to stress and where to put things; the boxes are shares of the frame from the top left. `AGENT_PROMPT_VERSION` bumped |

## Tasks

- [x] **1. Core: scenes in the footage.** `TechniqueScene` lines out of `describeTechniques` into an exported
  `sceneLines(scene, clock)` in `flair/direct.ts` (its text unchanged; its test still passes). `AgentFootage.scenes:
  TechniqueScene[]`; `describeFootage` adds "ฉาก" after the words ("ฉาก ไม่มี" when empty). Prompt paragraph,
  version bump. Tests: describeFootage shows a scene and its face; exact prompt test updated.
- [x] **2. Desktop: scenes and boxes from the wiring.** `withFacesKnown` moves from `flair.ts` to `move-cues.ts`
  (exported, flair imports it); `boxesOf` and `pieceBase` exported. `agent-wiring.ts`: `footage` adds `scenes`;
  `clip` gives each cut its `base`, `scenes` (faces/shown per scene, on the piece's clock), and `keepClear` per scene.
  Test: the wiring's clip carries a face of a prepared clip.
- [x] **3. Desktop: the checks.** `agent-actions.ts`: `placeMove` as decision 2; `textGroup` with the band of
  decision 3; `add_graphic` and an `edit_piece` that moves or re-boxes a graphic checked as decision 4. Tests: a move
  that pushes a face out of frame is refused (and its hold after); text over a top face goes below it; a graphic over
  a face for 3 s is refused with the reason, over one for less than `COVER_MAX_US` is made.
- [x] **4. Check and push.** Full tests, typecheck, plan doc results, commit, push.

## Results

Done. One change from the plan: rather than copying face boxes into `AgentClip`, the wiring hands the actions an
`AgentRoom` built on the pipeline's own functions — `agentMoveWhy` (wraps `judgeOnPiece`, with the hold) and
`agentKeepIn` (wraps `faceBoxesIn`), both new exports of `move-cues.ts` that take the agent's `TimelineMove`s. So the
faces are where the agent's moves have pushed them, the gap the plan had written down is closed, and a clip the objects
pass has not run on falls back to the scene's keepClear band exactly as "ทำทั้งหมด" does.

- Footage: `AgentFootage.scenes` from `scenesOnCut(plan, withFacesKnown(clips))`; "ฉาก" list via the shared
  `sceneLines` (`flair/direct.ts`), text unchanged for the techniques call. Prompt `agent-2026-10-04-scenes`.
- Text: laid with the band of `keepIn` over its span (`layoutGroup` keepClear).
- Graphics: `graphicCovers` before making; an `edit_piece` that only moves one in time is checked from its written
  box (`boxOfGraphic`, the inverse of `placeOnCanvas`).
- Moves: the overlap with another move is checked first, then `room.moveWhy` with the other moves.
- Tests: 3,155 passed; the same 10 known failures (one run showed an 11th, a timing flake, not repeated); typecheck
  the 8 known errors only.

**Still open:** a move added after text or a graphic can push a face under them; the text and graphic checks run when
those are placed, not again after later moves. The preview of phase 4 is where Claude would see that.
