# Agent Editor, Phase 2: the shared timeline

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one data structure that holds every piece of a finished edit, with the times it plays at, and one pure
function that writes that structure into a CapCut draft. Today `writeNow` in `apps/desktop/src/main/timeline.ts`
(lines 448–764) works out where every piece goes *and* writes it, interleaved. After this phase:

```
"ทำทั้งหมด" outline ──assemble()──▶ AgentTimeline ──writeTimeline()──▶ draft_info.json
                         (main)          (data)          (core, pure)
the agent (phase 3) ─────────────────────▲
```

The pipeline keeps working exactly as before; the agent of phase 3 will produce and edit the same structure.

**Why first:** spec `docs/specs/2026-10-03-agent-editor-design.md` §4 and §12. Phase 0 showed the draft can be read
back by segment id and a preview can be composed from the draft; both need the pieces as data.

**Tech Stack:** TypeScript, vitest. Done means `npm test` (no new failures against the 10 known ones) and
`npm run typecheck` (no new errors against the 8 known ones) from `prodeck2/`.

---

## Decisions

| # | Topic | Choice |
|---|---|---|
| 1 | Shape of a piece | The **writers' own inputs**, not a new format: `Cut`, `Timed` caption, laid-out highlight group, `TimelineMove`, `TimelineZoom`, `TimelineInsert`, `TimelineGraphic`, `TimelineComposedSound`, `TimelineSoundCue`. Each is wrapped with `id`, `by`, `locked` and `note` (spec §4). So nothing is translated twice and the writers stay as they are |
| 2 | Times | Final timeline µs, after frame rounding, exactly what the writers are given today |
| 3 | Order of writing | Fixed in `writeTimeline`, the order `writeNow` uses today (rough cut, subtitles, highlight text, moves, zooms, cutaways, graphics, composed sounds, library sounds, bin) |
| 4 | Behaviour | **Byte-identical drafts.** Every existing timeline test passes unchanged; a new test writes the same request through the old and the new path and compares the drafts |
| 5 | Where checks stay | Everything that can refuse a write (CapCut open, segment count changed, subtitles or text changed since shown, renders not made) stays in `assemble`, before any draft is read for writing |
| 6 | Stored | After each successful write, the timeline is saved beside the outline (`timeline.json` per project, with a version) for phase 3 and the read-back of phase 5 |
| 7 | Not in this phase | Segment ids per piece (each writer would have to return the ids it made; phase 5), the agent loop (phase 3), the preview (phase 4), any change to what is written |

## Files

| File | Change | Task |
|---|---|---|
| `packages/core/src/timeline/types.ts` (new) | `AgentTimeline`, `Piece<K, T>`, piece kinds | 1 |
| `packages/core/src/timeline/write.ts` (new) | `writeTimeline(info, meta, timeline)`: the writers in order, the bin, the counts | 2 |
| `packages/core/src/timeline/describe.ts` (new) | `describeTimeline`: one line per piece, for Claude (spec §5.2) | 4 |
| `packages/core/src/timeline/*.test.ts` (new) | cases below | 1, 2, 4 |
| `apps/desktop/src/main/timeline.ts` | `writeNow` split into `assemble` + `writeTimeline`; saving `timeline.json` | 3 |
| `apps/desktop/src/main/timeline-store.ts` (new) | read and write `timeline.json` atomically | 3 |
| `apps/desktop/src/main/timeline.test.ts` | old-vs-new draft comparison; stored timeline | 3 |

## Task 1: types (core)

- [x] `AgentTimeline { version: 1; projectId; direction; canvas; durationUs; cuts: Piece<"cut", Cut>[]; captions; highlights: { style, groups }; moves; zooms; inserts; graphics; composed; sounds; binItems }`.
- [x] `Piece<K, T> = { id: string; kind: K; by: "pipeline" | "claude" | "user"; locked: boolean; note: string; item: T }`. The pipeline's ids are derived from what the piece sits on (its anchor or its index) so the same edit gives the same ids.
- [x] Tests: a timeline survives `JSON.stringify` / `JSON.parse` unchanged.

## Task 2: `writeTimeline` (core, pure)

- [x] Move the writing half of `writeNow` here: `buildRoughCut`, `addSubtitleTrack`, `addHighlightTracks`, `addMoves`, `addZooms` (beside the moves), `addInsertTrack`, `addGraphicTrack`, `addComposedSoundTrack`, `addSoundTrack`, and the bin update (`addBinItems`, `pruneBinItems`). Returns the new `info`, the new `meta` function, and `laid` counts as `tally` reads them.
- [x] No file reads, no clock: the time and the bin prune folders come in as arguments.
- [x] Tests: an empty timeline gives the rough cut only; each kind lands on its own track in the order above; counts match `tally`.

## Task 3: main

- [x] `assemble(folder, rules, expectedSegments, subtitles, highlights)`: the first half of `writeNow` (compile, wait for graphics and sounds, every check, every placement) ending in an `AgentTimeline` plus the counts `writeNow` returns today that are not about writing (skipped graphics, composed left out, emphasis count, Pro left out, zooms lost).
- [x] `writeNow` = `assemble` → backup → `writeTimeline` → `writeDraft` → result, same `WriteResult` as today.
- [x] `timeline-store.ts`: `put(folder, timeline)` / `get(folder)` under the outlines folder, atomic writes.
- [x] Tests: every existing test in `timeline.test.ts`, `timeline-api.test.ts`, `post-flow.test.ts` passes untouched; a written draft equals one written by the code before this change (kept as a fixture produced once from the old path); `timeline.json` is saved after a write and not after a refused one.

## Task 4: `describeTimeline` (core)

- [x] One line per piece, in time order: time, kind, what it is (words, idea, sound role, move "about"), `by`, `locked`. The direction first. Example: `0:20.7–0:22.0 graphic "ป้ายราคา 5 บาท" (pipeline)`.
- [x] Tests on a small timeline; the text stays under a set size for 100 pieces.

## Check

- [x] `npm test`, `npm run typecheck`.
- [ ] On the Mac: write "1003 (1)" once with the new build and run `scripts/id-spike.ts` against a snapshot taken from the old build's write of the same outline: expect no segment changes except ids.
- [x] Commit and push on `claude/quirky-wozniak-3fhi7t`.

## Result (2026-10-04)

- **Same drafts:** before the split, every draft the tests of `timeline`, `timeline-api`, `post-flow` and
  `highlight-api` write (113 writes) was captured with its bin; after the split the same 113 were captured again and
  compared with random ids, temporary paths and clock fields normalised: **0 differences**. The capture hook was
  temporary and is not in the code; the comparison is recorded here instead of a committed fixture of 113 drafts.
- The timeline holds the cuts as the writer is given them; the writer puts their edges on frames, so a stored cut is
  within a frame of the segment it became.
- An empty subtitle list makes no track (the subtitle writer leaves it out), as before.
- `npm test`: 3,131 passed; the same 10 known failures. `npm run typecheck`: the same 8 known errors.
- Fixed on the way: `scripts/preview-spike.ts` (phase 0) failed the typecheck; it now types its page callback.

## Risks

- **`writeNow` is long and careful.** The split is mechanical but easy to get subtly wrong (an order of `lay` calls, a count). Mitigation: the byte-identical draft test, and moving code without rewriting it.
- **Random ids.** The writers make new segment and material ids with `randomUUID`; the old-vs-new comparison must run with a seeded id source or compare drafts with ids normalised.
- **Bigger stored data.** `timeline.json` holds laid-out text and every keyframe: tens of KB per project, fine.
