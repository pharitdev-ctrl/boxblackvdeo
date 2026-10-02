You are implementing a speed change for BOXBLACK 0.7.3: graphics and sounds take too long on a long clip.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` first for the repo rules and the report format.

## The problem, measured

The user's last long clip had 15 beats, 56 graphics and 59 composed sounds, and a whole plan took about 15 to 20 minutes.

**Calls.** Each graphic and each sound is one Claude call, plus a render check and at most one repair. They run three at a time (`AT_ONCE = 3` in `apps/desktop/src/main/motion-write.ts`, `writeAll`; sounds use the same `writeAll` in `sound-work.ts`).

**Order.** The sounds work starts only after every graphic is written:
- `post-plan.ts` `workTwo` runs the graphics step, then `workFour` runs `planSounds`;
- the sound plan's request carries each graphic's HTML (`packages/core/src/sound/plan.ts`, `describeSoundClip`, the `<fragment>` blocks).

**Renders** run one at a time already, for graphics (`graphics-render.ts`) and for sounds (`sound-render.ts`). Leave that as it is.

## What the user chose (2026-10-01)

1. **Six Claude calls at once instead of three.** The renders stay one at a time.
2. **Sounds not tied to a graphic start while the graphics are still being written.**
   - **Tied sounds** still wait for their own graphic's fragment and compose from it, as now, so their timing still follows the graphic's motion.
   - **Untied sounds** are timed to words, so composing them early changes nothing.
   - **The sound plan** must therefore run once the graphics are planned and stored, but before they are written. It then sees each graphic's idea, time and length, and no HTML for a graphic not written yet. The user accepted this.

## Design (follow it; ask if the code makes it unwise)

**A. One shared limit of six calls.**
- Replace the per-call-site `AT_ONCE = 3` with a limit of 6 that the graphics writes and the sound compositions share while both run, so that the total of Claude writing calls at once is never above 6.
- A small semaphore (for example `createCallLimit(6)` in a new `apps/desktop/src/main/call-limit.ts`) passed to both is fine. The order of starting stays the order given.
- Redo, edit and single-graphic runs use the same limit.
- **Test:** never more than 6 calls in flight across two concurrent `writeAll` runs, and the order is kept.

**B. The whole plan and the graphics rethink overlap the sounds.**

1. **Split `planGraphics`** (`flair.ts`) into its plan-and-store part and its writing part, keeping its public result the same. For example, it may take a hook called once the graphics are stored, before the writing starts (`onStored`).
2. **In `post-plan.ts`,** for a whole plan, once the graphics are stored:
   - start the sounds work (`workFour`, through `deps.flair.planSounds`) at the same time as the graphics writing;
   - the run states then show both works running together. Check that the run model, `PlanStrip` and `tabRuns` accept two running works, and fix them if not; the renderer is yours too for this, minimally;
   - the subtitles polish keeps its place.
   - If graphics are off, or the graphics step is skipped or fails before storing, the sounds work runs as now, after.
   - A graphics rethink alone keeps today's behaviour: the sounds are put behind and not run.
3. **The sound plan without fragments.** With graphics planned but not written, `describeSoundClip` lists each graphic's line as now, and in place of its fragment writes the line `(not drawn yet)`.
   - Change `SOUND_PLAN_PROMPT`'s sentence "the graphics with their idea and the HTML that draws them" to "the graphics with their idea, and the HTML that draws them when it is drawn already".
   - Bump `SOUND_PLAN_PROMPT_VERSION`. Keep everything else in the prompt verbatim.
4. **Composing order in `sound-work.ts`.** Untied sounds compose at once, through the shared limit.
   - A tied sound waits until its graphic's writing has ended:
     - if it is written, compose it from the fragment, as now;
     - if it failed, or is gone, leave the sound unwritten and count it as today.
   - The simplest correct way: the graphics writing exposes a per-graphic promise, or an event "graphic X ended", that the sounds work awaits per tied sound. Or the tied sounds compose after the whole graphics writing ends, while the untied ones already ran.
   - Choose the simpler one that keeps the tests readable, and say which.
5. **Progress.** Each work keeps reporting its own `(done, total)`.
6. **Stop.** A stop ends both works, as a stop ends one now.

**C. Nothing else changes:**
- placement, staleness and levels;
- the single-graphic redo and edit, and their tied-sound re-composing, which already run "graphics" then "sounds";
- the render queues.

## Tests (tests first)

- the shared limit (A);
- in a whole plan:
  - the sound plan is asked after the graphics are stored and before the first graphic writing ends;
  - its request says `(not drawn yet)` for unwritten graphics;
  - untied sounds compose while graphics are still writing;
  - a tied sound composes only after its graphic is written, from that fragment;
  - a tied sound whose graphic fails stays unwritten;
- graphics off, and a graphics step that fails before storing: the sounds run after, as now;
- a graphics rethink: unchanged;
- a stop mid-way ends both;
- the run states with two works running.

Fakes only: no real Claude, no app, no Electron.

## Working conditions

Nobody else is working on the repo. Run `npm test` and `npm run typecheck` from the root. Report counts, what failed first, the files changed, and the decisions you made.
