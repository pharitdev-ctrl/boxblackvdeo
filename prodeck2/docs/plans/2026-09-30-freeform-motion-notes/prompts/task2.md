You are implementing Task 2 of the BOXBLACK 0.5.0 plan: "Core: the planning call and the writing call".

## The project in brief

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. Monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`: `packages/core` (pure TypeScript), `apps/desktop/src/{main,shared,renderer}`. Node 26 runs TypeScript natively; tests are vitest; there is no git.

Until now the app overlaid "graphics" drawn by a fixed kit of cards and stickers, rendered to transparent ProRes 4444 by HyperFrames 0.8.65 (a headless-Chrome renderer the app ships as a "pack"). Release 0.5.0 replaces the kit with free-form motion graphics: Claude writes each graphic as one HTML fragment (one `<style>` block, markup, an optional `<script>` block last), the app checks it, wraps it in a page, renders it with the same pack, inspects the result, and lays the file in the draft as it lays graphics today.

The flow of 0.5.0, so you know where your task sits:
1. A planning call picks the points, and for each a word to start on, seconds, a box, a reason and an idea (Task 2).
2. A writing call per piece returns the fragment (Task 2).
3. `lintFragment` checks it; the renderer wraps, renders and inspects it (Task 1, Task 3).
4. A failed check or render gets exactly one repair call, whose brief carries the problems in English (Task 2 writes the brief, Task 5 runs the loop).
5. Pieces whose words changed go stale and are not written into the draft (Task 4). The screen shows each piece's state (Task 6). The old kit and its emoji pictures leave in Task 7.

Task 1 is done and in the repo:

```ts
// packages/core/src/graphics/plan.ts   (import path "@boxblack/core/graphics/plan")
export const MOTION_VERSION = "motion-2026-09-30"
export const MOTION_HTML_MAX = 40_000
export interface MotionWord { text: string; atS: number }
export interface MotionSpec {
  kind: "motion"; version: string; box: GraphicBox; seconds: number; why: string
  idea: string            // what is drawn, one Thai line
  words: MotionWord[]     // the words said while it plays, with seconds from its start when it was written
  html: string | null     // the fragment; null until it is written
  failed?: string         // why the last writing failed
}
export const isMotion = (spec: GraphicSpec): spec is MotionSpec => spec.kind === "motion"
// GraphicSpec is still a union with the kit's CardSpec and StickerSpec until Task 7.

// packages/core/src/graphics/motion/lint.ts   ("@boxblack/core/graphics/motion/lint")
export function lintFragment(html: string): string[]   // problems in English, one line each, at most 13; empty when it passes

// packages/core/src/graphics/motion/html.ts   ("@boxblack/core/graphics/motion")
export interface MotionAssets { host: string }
export async function motionAssets(dir: string): Promise<MotionAssets>   // reads <dir>/host.js
export function motionColours(palette: Palette): { ink; paper; accent; alt; bar; text }   // hex strings
export function motionHtml(args: { html: string; stage: { width: number; height: number }; seconds: number; fps: number; times: number[]; palette: Palette; font: { family: string; file: string }; assets: MotionAssets }): string

// packages/core/src/graphics/framing.ts   ("@boxblack/core/graphics/framing")
export function stageBox(box: GraphicBox, canvas: { width: number; height: number }): PixelBox   // even pixels, inside the canvas, no margin
```

`apps/desktop/resources/graphics/host.js` is the script the page ends with: it gives HyperFrames a timeline that sets `currentTime` on every entry of `document.getAnimations()` and calls the fragment's optional `window.frame(t)`.

## Where to read

- The plan: `docs/plans/2026-09-30-freeform-motion.md`. Read "How to run this plan" and "Names shared across tasks". Your task's text is pasted below; the plan has the other tasks if you need to see what comes next.
- The spec (Thai): `docs/specs/2026-09-30-freeform-motion-design.md`.
- The proof run: `docs/plans/2026-09-30-freeform-motion-notes/README.md`, and its `spike/` and `research/` folders (`research/core-map.md`, `main-map.md`, `renderer-map.md` say where everything about graphics lives, with line numbers as of 0.4.4, which may have moved a little).

## Rules of this repo

- No git. "Commit" means `npm test` is green and `npm run typecheck` is clean, both run from the repo root.
- Tests first: every behaviour gets a test that fails before the code and passes after. Say in your report what you saw fail.
- Nothing is deleted outright: a file that goes is moved with `mv <path> ~/.Trash/<name>-0930`.
- Never run the app, `npm run build`, `npm run dist`, HyperFrames, Chrome or a real Claude call. Never touch `~/Movies`, `~/Library` or a CapCut draft. Tests use fakes and temp folders.
- Comments are plain English prose about behaviour, in the voice of the surrounding code (read a few of the existing ones first). No em-dashes in prose you add. User-facing strings are Thai and live in `i18n.ts` only; your task adds none.
- Match the surrounding code: its naming, its density of comments, its way of injecting dependencies for tests.
- Scratch files go under `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/`, never in the repo.


## Your task, as the plan has it

### Task 2: Core — the planning call and the writing call

**Files:**
- Create: `packages/core/src/graphics/motion/direct.ts`, `direct.test.ts`, `packages/core/src/graphics/motion/write.ts`, `write.test.ts`
- Modify: `packages/core/src/graphics/direct.ts` (export the generic helpers the new module needs: the point description lines of `describe`, `startOf`, `secondsOfChar`, `frameKey`, `framesToAttach`; no behaviour change), `packages/core/package.json` (exports `./graphics/motion/direct`, `./graphics/motion/write`)

- [ ] **Step 1: Tests for `acceptMotionPlan`** (port the still-true cases of the old `acceptGraphics` tests):
  - an answer for an unknown point, a point already filled, or one in `taken` is dropped and counted
  - a box outside the limits is dropped: width 0.5–1.0, height 0.2–0.5, inside the frame, with the slack of 0.05 today's `boxOf` allows a model that rounds, and kept as it was given
  - `seconds` is clamped to 1.5–6, default 3
  - the start is the answer's word when the point's sentence has it, else the point's start (as `startOf` does today); a sentence with no words drops the answer
  - `idea` is trimmed and cut to 200 characters on a grapheme (the trial's ideas ran to about 150; a shorter cap starves the writing call, and the row shows it on two lines at most); an empty idea drops the answer
  - the spec is `{ kind: "motion", version: MOTION_VERSION, box, seconds, why, idea, words, html: null }`, the anchor is the speech anchor with its beat, and `pointId` is set
  - `words` are the point's words from the start word up to `seconds`, each `{ text, atS }` with `atS` from its timeline time, in order; at most 12 (the first 12)
- [ ] **Step 2: Tests for `planMotion`**: with every point taken it calls nothing and answers empty; otherwise one `transport.generate` with the schema, the frames attached as today, and the system prompt; the request text lists each point as today's `describe` does, and says the canvas orientation and where the subtitles start.
- [ ] **Step 3: Write `motion/direct.ts`.**
  - The system prompt is the text of `spike/plan-prompt.md` (the controller wrote it; change it only where what it says about the request differs from what the request really holds). In short it tells Claude: it is choosing where a bespoke animated graphic would help the viewer understand or feel the point; one graphic per point at most, only where a picture adds something the words and the highlight text do not; for each, the word it starts on, how long, a box (full width allowed, up to half the frame tall, in the free band the point's line names, never over the face, the highlight text or the subtitles), a one-line reason, and **the idea**: what to draw and how it moves, concretely enough for a designer to build it, in Thai. No quotas.
  - Schema: `{ graphics: [{ point: number, word: string, seconds: number, why: string, box: [x0,y0,x1,y1], idea: string }] }`.
- [ ] **Step 4: Tests for `write.ts`**
  - `MOTION_CONTRACT` is the text of `spike/contract-final.md` as it stands now, with its "Shape" section (assert on its load-bearing lines: one `<style>` first and one plain `<script>` last; no HTML comments; no inline event handlers; no SMIL; CSS animations and Web Animations only; the forbidden timers; `window.frame`; the word variables `--w1` and `T`, and not declaring `T`; the colour variables; "Return only the fragment").
  - The contract and the linter must not drift apart, in either direction. (a) Every fragment of `packages/core/src/graphics/motion/fixtures/` (the six of the spike and the nine of the trial, written by real calls; Task 1's last fix round copied them there behind one helper) passes `lintFragment`. (b) What the contract names as allowed passes: one fragment that uses `document.getElementById`, `querySelector`, `querySelectorAll`, `document.createElementNS`, `document.createElement`, `setAttribute`, `appendChild`, `textContent`, `style`, `el.animate()`, `getTotalLength()`, `getPointAtLength()`, `Math.round`, `window.frame`, `<use href="#id">`, `url(#id)`, `color-mix()`, `-webkit-text-stroke`, `paint-order`, a CSS `/* */` comment, `calc(var(--w2) * 1s - 0.3s)` and `T[1] * 1000`. (c) What the contract forbids and the linter enforces is refused: a table with one small fragment for each tag, attribute and name the contract lists under "Shape" and "The script", and for each forbidden timer under "Time". Sentences of the contract that are advice the linter does not check (comments of one line, `window` only for `window.frame`, no event listeners, no transitions by class changes, the SVG transform rule, which the host checks at render time, and the whole of "Look") are not in that table.
  - `motionBrief` lists the stage `W = … , H = …`, `D`, the words in order as `--w1 "คำ" 0.15 · --w2 …` with two decimals, the idea after "What to draw:", and the clip's subject after "The clip is about:".
  - `repairBrief` starts with the first brief as it was (Claude needs the stage, `D` and the words to put right a graphic that stays on screen or leaves the stage), then says the fragment below was written for it and has these problems, one `- ` line each, asks to put right every problem and change nothing else and to return the whole corrected fragment with no code fence and no explanation, and ends with the fragment. `spike/trial-r1/b-rep5.txt` is one that a real call answered with a corrected fragment.
  - `fragmentOf` strips a leading and trailing code fence (```` ```html ```` or ```` ``` ````) and outer white space, and leaves an unfenced answer alone.
  - `writeMotion` makes one `transport.generate` call with `MOTION_CONTRACT` as the system prompt, no schema (plain text), `maxTokens` 12,000, passes the signal, and answers `fragmentOf` of the text.
- [ ] **Step 5: Write `motion/write.ts`.** Look at how `packages/core/src/llm/types.ts` shapes a request with no schema; if the transport requires a schema today, add plain-text support there with tests, in both transports, without changing existing calls.
- [ ] **Step 6:** `npm test` and `npm run typecheck`.

## What is already decided (do not re-decide these)

- **The two prompts are written; do not rewrite them.**
  - `MOTION_CONTRACT` is the text of `docs/plans/2026-09-30-freeform-motion-notes/spike/contract-final.md`, the whole file as it stands when you start (its first line, the `#` title, included), copied into `write.ts` as a string. Eight real Claude calls written under it all passed the linter, rendered and passed inspection (`spike/trial-r1/`). The controller may hand you a small revision later; your tests assert on its load-bearing lines, not on the whole text.
  - The planning call's system prompt is the text of `spike/plan-prompt.md` (Thai, in the voice of today's `SYSTEM` in `packages/core/src/graphics/direct.ts`). Copy it into `motion/direct.ts`. Change a sentence only where what it says about the request differs from what the request text really holds, and say so in your report.
  - Versions: `MOTION_PLAN_PROMPT_VERSION = "motion-plan-2026-09-30"`, `MOTION_WRITE_PROMPT_VERSION = "motion-write-2026-09-30"`.
- **A reply that is plain text.** Today `LlmRequest<T>` always carries a schema and both transports ask for JSON. Keep that shape and add, in `packages/core/src/llm/types.ts`, one exported constant:
  ```ts
  /** The schema of a reply that is plain text and not data: a transport given this very schema asks for no JSON and returns what Claude wrote, as it is. */
  export const TEXT_REPLY: z.ZodType<string> = z.string()
  ```
  Each transport checks `schema === TEXT_REPLY` (by identity) and then: the Anthropic transport sends no `format` in `output_config` (the `effort` stays when there is one; with neither, no `output_config` at all) and returns the text blocks joined, not parsed; a refusal and a reply cut at the token limit fail as they do today. The Claude Code transport leaves out `--json-schema` and returns the result event's `result` text (an absent one is the empty string); `is_error` fails as it does today. Nothing else about either transport changes, no existing call changes, and no fake transport in any test needs to change (that is why the request's shape stays as it is: 21 test files build fake transports). Export `TEXT_REPLY` wherever the other names of `types.ts` are exported. Tests go in `anthropic.test.ts` and `cli.test.ts`, beside the existing ones and in their style.
- **`writeMotion`** makes one `transport.generate` call: `system: MOTION_CONTRACT`, `content: [{ type: "text", text: brief }]`, `schema: TEXT_REPLY`, `maxTokens: 12_000`, the `signal` passed on; it answers `fragmentOf(output)`. It does not lint: the caller does (Task 5), because a refused fragment goes to a repair.
- **`motionBrief`** writes exactly this shape (the trial's real calls were given it), the times with two decimals:
  ```
  Brief:
  - Stage: W = 1080, H = 700 px.
  - D = 3.6 seconds.
  - Words, in order, with the time each is said now: --w1 "ยานอวกาศ" 0.20 · --w2 "ต้องเร็วถึง" 0.80.
  - What to draw: <the idea>
  - The clip is about: <about>.
  ```
  With no words the words line reads `- Words: none are said while it plays.` `D` is written as the number is (`3.6`, `4`).
- **`repairBrief({ brief, html, problems })`**: the first brief as it was, a blank line, `You wrote the fragment below for this brief. It was rendered, and it has these problems:`, one `- ` line per problem, a blank line, `Put right every problem and change nothing else. Return the whole corrected fragment, with no code fence and no explanation.`, a blank line, the fragment. `spike/trial-r1/b-rep5.txt` is one such brief, which a real call answered with a corrected fragment. (For a fragment the linter refused before any render the same words are used; "rendered" is near enough, and one wording is one thing to test.)
- **`acceptMotionPlan(reply, points, taken)`** has no `framed` argument: a motion graphic points at nothing in the picture. `planMotion` still attaches the frames as today (they tell Claude where the free room is) and takes the same arguments `planGraphics` takes today, less what only the kit needed (the known emoji). Look at how `planGraphics` builds its request and do the same.
- **The box**: width 0.5 to 1.0 of the frame, height 0.2 to 0.5, inside the frame, each limit with the slack of 0.05 that today's `boxOf` gives a model that rounds (so 0.45 wide or 0.55 tall is kept, as given, not clamped).
- **The idea** is cut to 200 characters on a grapheme (`Intl.Segmenter`), not 120.
- **The generic helpers** of `graphics/direct.ts` (`describe`'s point lines, `startOf`, `secondsOfChar`, `frameKey`, `framesToAttach`, and whatever else of the word matching the new module needs) are exported from where they are, with no change of behaviour; do not move or rewrite them (Task 7 removes the kit's half of that file). `describe` today ends with a table of sticker room that only the kit needs: the motion request leaves it out, so split `describe` only as far as that takes.
- **The drift test of contract and linter** is three parts, all in `write.test.ts`: (a) every fragment of `packages/core/src/graphics/motion/fixtures/` passes `lintFragment`, read through that folder's helper (`allFixtures()` and `fixture(name)` in its `index.ts`), as `lint.test.ts` reads them; (b) one fragment using everything the contract names as allowed passes; (c) a table of small fragments, one for each tag, attribute and name the contract forbids under "Shape", "The script" and the forbidden timers under "Time", each refused. The contract's advice that the linter does not check is not in the table: comments of one line, `window` only for `window.frame`, no event listeners, no transitions by class changes, the SVG transform rule (the host checks that at render time), and everything under "Look".

## Another implementer is working at the same time

Task 3 is being reviewed and will get a short fix round while you work, in `apps/desktop` only. It owns: `apps/desktop/src/main/graphics-render.ts`, `graphics-render.test.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/resources/graphics/host.js`, `apps/desktop/src/main/graphics-host.test.ts`. Do not edit those, and do not edit anything else in `apps/desktop` either (if you think the desktop app needs a change for your task, stop and say so in your report).

You own: `packages/core/src/graphics/motion/direct.ts`, `direct.test.ts`, `write.ts`, `write.test.ts`, `packages/core/src/graphics/direct.ts` (exports only), `packages/core/src/graphics/index.ts` and `packages/core/package.json` (the new exports `./graphics/motion/direct` and `./graphics/motion/write`), `packages/core/src/llm/types.ts`, `anthropic.ts`, `cli.ts`, their tests, and `llm/index.ts` if names are exported there. Do not change `packages/core/src/graphics/motion/lint.ts`, `shape.ts`, `tags.ts`, `html.ts` or the `fixtures/` folder (Task 1 is finished and reviewed; the controller checked on 2026-09-30 that the contract's allowed list passes the linter and that 74 things it forbids are refused): if the drift test shows the contract and the linter disagree, stop and report which line and which rule, and the controller decides which of the two moves.

While you work, run only your own test files, for example `npx vitest run packages/core/src/graphics/motion packages/core/src/llm packages/core/src/graphics/direct.test.ts`. At the end run `npm test` and `npm run typecheck` once from the repo root. If something fails in a file the other implementer owns, do not fix it: wait a minute and run again, and if it still fails, report it as theirs with the exact message. The controller runs the full gate again once both of you have reported.

## Before you begin

If anything about the requirements, the approach or the code is unclear, ask now, before you write code. It is always fine to stop and ask.

## Your job

1. Write the tests of each step first and watch them fail.
2. Implement exactly what the task says, no more.
3. Run your test files, then the full suite and the typecheck.
4. Review your own work with fresh eyes (completeness against the task, names, no overbuilding, tests that would fail if the behaviour broke) and fix what you find.
5. Report.

If the task asks for something the code makes impossible or unwise, or you find yourself restructuring code the task did not mention, stop and report `BLOCKED` or `NEEDS_CONTEXT` with what you found. Bad work is worse than no work.

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented, step by step
- What you saw fail before the code (red), and the final results of `npm test` and `npm run typecheck` (the counts)
- Files changed
- Anything you decided that the task did not spell out, and why
- Self-review findings and any concerns
