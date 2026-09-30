You are implementing Task 7b of the BOXBLACK 0.5.0 plan: "A graphic takes the place of its point's highlight text".

## The project in brief

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. Monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`: `packages/core` (pure TypeScript), `apps/desktop/src/{main,shared,renderer}`. Node 26 runs TypeScript natively; tests are vitest; there is no git.

Release 0.5.0 replaces the old kit of cards and stickers with free-form motion graphics: a planning call picks the emphasis points that get a graphic (a start word, seconds, a box on the frame, an idea), a writing call per graphic returns an HTML fragment, the app lints, renders and inspects it, and lays the rendered file in the draft. Tasks 1 to 7 are done: the kit is gone, `GraphicSpec` is `MotionSpec`, and the whole pipeline runs in the built app with the real Claude.

On the post-production page each emphasis point may carry highlight text (big kinetic text, stored as highlight groups with lines, each group tied to its point by `pointId`), a motion graphic (a `GraphicCue` in `flair.graphics`, with `pointId`), zooms, cutaways and sounds, with subtitles running underneath. A level setting decides which points are shown.

## Why this task

The first run in the real app found that with highlight text and subtitles both on, a talking-head frame has no room for a graphic: on the test clip every point had highlight text above the head, the scene's keep-clear band ran from 0.22 to 0.64 of the height, subtitles start at 0.76, and the 0.12 left is under the smallest box (0.15). The planner rightly answered no graphic at all. With highlight text switched off it planned three, in the band above the head, and they looked good.

The user decided (2026-09-30): **at a point that has a graphic, the graphic takes the place of that point's highlight text. The subtitles stay in full, and a graphic never takes the subtitle room.**

## Where to read

- The map of the code this touches, written for this task: `docs/plans/2026-09-30-freeform-motion-notes/research/text-gives-way-map.md`. Read it in full first. Its line numbers are from before Task 7 removed the kit, so they have moved a little and the card and sticker cases are gone; the structure stands.
- The plan: `docs/plans/2026-09-30-freeform-motion.md` ("Room for graphics"). The spec (Thai): `docs/specs/2026-09-30-freeform-motion-design.md`.
- The notes of the live run: `docs/plans/2026-09-30-freeform-motion-notes/README.md`, "The early live look".

## Rules of this repo

- No git. "Commit" means `npm test` is green and `npm run typecheck` is clean, both run from the repo root.
- Tests first: every behaviour gets a test that fails before the code and passes after. Say in your report what you saw fail.
- Nothing is deleted outright: a file that goes is moved with `mv <path> ~/.Trash/<name>-0930`.
- Never run the app, `npm run build`, `npm run dist`, HyperFrames, Chrome or a real Claude call. Never touch `~/Movies`, `~/Library` or a CapCut draft. Tests use fakes and temp folders. Do not change `apps/desktop/package.json`.
- Comments are plain English prose about behaviour, in the voice of the surrounding code. No em-dashes in prose you add. User-facing strings are Thai and live in `i18n.ts` only.
- Match the surrounding code: its naming, its density of comments, its way of injecting dependencies for tests.
- Scratch files go under `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/`, never in the repo.

## The rules to build

**Rule A: a graphic is not pushed away by its own point's highlight text.** When a graphic is placed on the frame (`graphicsInForce`), the bands it must keep off are the scene's keep-clear band, the subtitle room, and the highlight text on screen while it plays, less the text of the groups of its own point. A graphic with no `pointId` keeps off all text. A group with no `pointId` (the user's own, unbound) is kept off by every graphic.

**Rule B: a point's highlight text is not drawn while its graphic plays in the clip.** A point is *replaced* when it has a graphic that is kept by `graphicsInForce` (so it is switched on, its point passes the level, it has a place and room), is written (`spec.html !== null`) and is not stale: that is, a kept graphic with a `pointId` for which `graphicJob` answers a job. Every highlight group of a replaced point is *replaced*: it is not drawn. A graphic that is unwritten, stale, switched off, hidden by the level, or dropped for lack of room leaves the text drawn, so a point never stands empty because its graphic could not be made.

**One pass, in this order** (the groups' bands decide where graphics go, and the graphics decide which groups are replaced, so the order is fixed and never repeated):
1. The groups are placed and timed under the show rules, and their looks worked out, exactly as today, over every group the rules show. A replaced group still ends the group before it (a group ends where the next begins) and still counts in the run of looks.
2. The graphics are placed against the bands of step 1, each less its own point's bands (Rule A). A graphic therefore also keeps off another point's text that step 3 then finds replaced: accepted.
3. The replaced points are read from the kept graphics, and their groups are marked.

**What leaves a replaced group out** (what is drawn as text):
- the text tracks written into the draft, with everything said about them (the Pro exits left out are counted over the groups that are written);
- the words hidden from the subtitles when the setting `hideSubtitles` is on (`hiddenWords`): a replaced group hides none, since its words are not on screen as text, so the subtitles say them;
- what the write sheet and the counts say will be written as highlight text.

**What keeps a replaced group** (its lines as moments of the clip, unchanged by this task):
- the slots of sounds, cutaways and punch zooms that sit on its lines, and the names of zoom pieces: they play as before;
- the slots the sounds work offers Claude;
- the number of groups the write checks against the preview's (`groupCount`): it stays the number of groups shown by the rules, replaced ones included, so the check is as it was;
- the list of groups in the preview: a replaced group is listed, marked, and can still be edited or removed.

**A render that fails at write time** leaves its point with neither text nor graphic in that write: the write already reports the graphic as skipped. Accepted, and said in a comment: the write uses the same condition as the preview (a job, not a finished render), or the two would disagree.

## The work

### Step 1: Rule A (main)

- `apps/desktop/src/main/graphics-cues.ts`: a text band knows its point (`GroupBand.pointId?`, filled by `textBands` from the stored groups' `pointId`; carry it on core's `PlacedGroup` if that is the smaller change, which also lets the maps rebuilt in `highlights.ts` and `flair.ts` go). `textBandsIn(bands, span, exceptPointId?)`. `graphicsInForce`'s `textIn` takes the graphic's `pointId` and is called with `cue.pointId`.
- `highlights.ts` (`graphicsOn`) passes it through.
- Tests: a graphic on its own point's text band stays where it is planned; it still moves off another point's text; one with no `pointId` moves off all text; a group with no `pointId` is kept off.
- Note in your report: the box is part of a render's hash, so a written graphic that its own text had been pushing renders again at its planned box. It does not go stale (the dodge keeps a box's size).

### Step 2: Rule B in main

- One predicate beside `graphicJob` for "this kept graphic replaces its point's text", and one function that gives the replaced points of a `{ kept }` (or of `graphicJobs`'s answer). Use them everywhere; do not restate the condition.
- The preview (`highlights.ts`, `view`): the graphics are worked out before the list of groups is built, once, and handed on to the graphics' own view (today they are worked out a second time inside it). Each `HighlightGroupView` gets `replaced: boolean` (`shared/api.ts`). With graphics switched off, no canvas, or the text work's own call (which asks with `graphic: false`), nothing is replaced. `hidden`, `items.text` and the slots are as today.
- The write (`timeline.ts`, `writeNow`): the replaced points are taken from the graphics in force it already has; the text tracks are written without the replaced groups, after the timing, the looks and the layout were worked out over all of them; the count check stays on all of them; sounds, cutaways and zooms get the groups as today.
- The subtitles (`timeline.ts`, `hiddenFor`, for both callers: the write and the preview of lines): a replaced group hides no words. The preview of lines needs the graphics in force under the saved settings; when `hideSubtitles` is off, nothing about subtitles may cost more than today (no extra compile, no graphics worked out).
- The plan run (`post-plan.ts`): the polish already waits for the text work when the lines under the text are hidden; when graphics are on too, it waits for the graphics work instead, since the lines change as graphics are written.
- Tests: each bullet, and one through `post-flow.test.ts` or its like: a plan whose graphic is written shows the group replaced in the preview, writes no text for it, and writes the text again once the graphic is switched off, goes stale, or is removed.

### Step 3: The planner (core and main)

- What Claude is told about a point's text is that point's own text, not every group on its sentence: `graphicPoints` (`graphics-cues.ts`) fills `textBand` from the bands of the point's own groups. The point's line in the request (`describePoints`, now in `packages/core/src/graphics/motion/points.ts`) reads `ข้อความเด่นของจุดนี้ [a, b]` where it read `มีข้อความเด่น [a, b]`.
- `MOTION_PLAN_PROMPT` (`packages/core/src/graphics/motion/direct.ts`) becomes the text of `docs/plans/2026-09-30-freeform-motion-notes/spike/room/plan-prompt-text-gives-way.md`, the whole file, and the version becomes `motion-plan-2026-09-30b`. A real call with this prompt on the clip that had got no graphic answered three, in the band above the head (`spike/room/reply-text-on.json`). Four sentences changed; update the tests that pin them.
- No change to the writing contract.

### Step 4: The screen (renderer)

- `edit/HighlightTab.tsx`: a replaced group's row carries a note, in the place the placement note has, `highlights.replaced`: `มีกราฟิกแทน ไม่ขึ้นในคลิป`, and the row is dimmed the way a switched-off graphic's row is (reuse a class; no new colour). Its lines stay editable, its buttons work.
- `edit/WriteButton.tsx`: the sheet's count of highlight text (groups and lines) leaves replaced groups out. `groupCount` sent to the write stays the number of all groups listed.
- `edit/byBeat.ts`: the count of text (the sidebar's mark, the tab's count) leaves replaced groups out.
- `edit/EmphasisTab.tsx`: a point whose text is replaced must not get its "Aa" button back (it shows when the point has no text: a replaced group still counts as the point's text). Pin it.
- `room/ClipRoom.tsx`: the subtitle lines are read again when the set of replaced groups in the preview changes (make the effect that reads the lines depend on a key of the replaced groups' ids), so that with `hideSubtitles` on the lines follow a graphic being written, switched off or removed without any event plumbing.
- `i18n.ts`, `graphics.none`: it gains one sentence saying why there may be none: `AI ใส่กราฟิกเฉพาะจุดที่เหมาะและมีที่ว่างบนเฟรมพอ` (keep what it says today before it).
- `renderer/test/fake-api.ts` and every test literal of a group the compiler flags get `replaced: false`.

### Step 5: `npm test` and `npm run typecheck` from the repo root.

### Carried over from Task 7's fix round (small)

`graphicsInForce` and `existingGraphics` skip a stored graphic whose spec is not a motion spec, but an entry that is `null`, or has no `anchor`, in a version-2 file still throws there (`cue.spec` of null). Such an entry is skipped the same way: not placed, not listed, not counted. One test.

## Decided, do not re-decide

- Sounds, cutaways and punches on a replaced group's lines play as before; the sounds work offers those lines as before. Known limit, accepted.
- One pass; no repeat until stable.
- A replaced group is listed and marked, not left out.
- The subtitle room is never a graphic's: nothing about where a graphic may sit changes except Rule A.
- The smallest box (0.15 of the height) and every other limit stay.

## Working conditions

Nobody else is changing the repo while you work. Before you start the gate stands at 155 files, 2483 passed, 3 skipped, typecheck clean. If the code makes something here impossible or unwise, or you find yourself restructuring code this task did not mention, stop and report `BLOCKED` or `NEEDS_CONTEXT` with what you found. If anything is unclear, ask before you write code.

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented, step by step
- What you saw fail before the code (red), and the final results of `npm test` and `npm run typecheck` (the counts)
- Files changed
- Anything you decided that the task did not spell out, and why
- Self-review findings and any concerns
