# Free-form Motion Graphics Implementation Plan (0.5.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude designs and writes each graphic as its own HTML/CSS/JS animation. The app checks it, renders it with the HyperFrames pack it already ships, and lays it in the draft as it lays graphics today. The fixed kit of cards and stickers, and the bundled emoji pictures, leave the app. Release 0.5.0.

**Architecture:**
- **Core:** a `MotionSpec` (box, seconds, idea, the words said, the fragment Claude wrote), a linter for fragments, a page wrapper with a host script that seeks every CSS animation and Web Animation by time, a planning call that picks points and ideas, and a writing call per graphic.
- **Main:** the renderer renders a motion job and inspects the result with the bundled ffmpeg. The graphics work of the plan run plans, then writes three pieces at a time, each through write, lint, render, inspect and at most one repair. A piece whose words changed goes stale and is left out of a write.
- **Renderer:** rows show the idea and the piece's state, with redo, retry, off/on and remove. The card editor goes.

**Tech Stack:** TypeScript on Node 26 (native TS), vitest, Electron, React. HyperFrames 0.8.65 from the app's renderer pack. The bundled ffmpeg (`alphaextract`, `signalstats`, `metadata`, the null muxer).

**Spec:** `docs/specs/2026-09-30-freeform-motion-design.md` (Thai; the user approved the design on 2026-09-30).

**Read before any task:** `docs/plans/2026-09-30-freeform-motion-notes/` — `README.md` (what the spike proved), `spike/contract-final.md` (the contract, tested), `spike/host.js` and `spike/mk.mjs` (the host and wrapper that rendered), `spike/fragments/` (six fragments Claude wrote), and `research/{core,main,renderer}-map.md` (where everything about graphics lives today, with line numbers as of 0.4.4).

---

## How to run this plan

- **No git.** "Commit" means `npm test` is green and `npm run typecheck` is clean, both from the repo root. The controller snapshots the code before each task.
- **Nothing is deleted outright.** A file or folder that goes is moved with `mv <path> ~/.Trash/<name>-0930`.
- **Tests first.** Every behaviour gets a test that fails before the code and passes after.
- **Each task ends green.** Tasks 1–6 add the new system beside the old one; Task 7 removes the old one. Until Task 7, `GraphicSpec` is a union that still includes cards and stickers.
- **What may run at the same time** (decided 2026-09-30, when the user asked whether tasks could overlap). Tasks 2 and 3 share no file and need only Task 1, so they run together: one snapshot before both, each implementer runs only its own test files while it works and is told which files the other one owns, and the controller runs the full `npm test` and `npm run typecheck` once both have reported. Task 4 needs Task 3's `RenderJob`, Task 5 needs 2, 3 and 4, Task 6 needs 5's bridge, Task 7 needs everything, so from Task 4 on the tasks run one after another; each starts as soon as the tasks it needs are approved, even if another task's review is still open. With no git there are no separate worktrees, so two implementers never own the same file. The controller does Task 8 itself while Task 7 is in review. As it went on 2026-09-30: Task 1's re-review approved it with a list of small fixes, so Task 3 started at once beside that last fix round (the round is in core and one desktop test file, Task 3 in five other desktop files), and Task 2 starts when the round ends, since its contract test needs the linter's final rules.
- **Only the controller** runs mutation checks, builds the DMG, calls the real Claude and writes draft `0917`. Implementers use fake transports and fake renderers.
- **Never** touch `~/Movies`, `~/Library` or a CapCut draft from a task. Never run the app, `npm run build` or `npm run dist` from a task.
- **Comments** are plain English prose about behaviour, as in the surrounding code. User-facing strings are Thai, through `i18n.ts` only.

## Names shared across tasks

```ts
// packages/core/src/graphics/plan.ts (Task 1)
export const MOTION_VERSION = "motion-2026-09-30"
export const MOTION_HTML_MAX = 40_000
/** A word said while the graphic plays: its text, and seconds from the graphic's start when it was written. */
export interface MotionWord { text: string; atS: number }
export interface MotionSpec {
  kind: "motion"
  version: string
  box: GraphicBox
  seconds: number
  why: string
  /** what is drawn, one Thai line: the brief of the writing call, and the row's summary */
  idea: string
  words: MotionWord[]
  /** the fragment Claude wrote; null until it is written, and after a redo is asked */
  html: string | null
  /** why the last writing failed; absent once it is written */
  failed?: string
}
export const isMotion = (spec: GraphicSpec): spec is MotionSpec => spec.kind === "motion"

// packages/core/src/graphics/motion/lint.ts (Task 1)
export function lintFragment(html: string): string[]          // problems, in English, empty when it passes

// packages/core/src/graphics/motion/html.ts (Task 1)
export interface MotionAssets { host: string }
export async function motionAssets(dir: string): Promise<MotionAssets>   // reads <dir>/host.js
export function motionColours(palette: Palette): { ink: string; paper: string; accent: string; alt: string; bar: string; text: string }  // hex strings
export function motionHtml(args: { html: string; stage: { width: number; height: number }; seconds: number; fps: number; times: number[]; palette: Palette; font: { family: string; file: string }; assets: MotionAssets }): string

// packages/core/src/graphics/framing.ts (Task 1)
export function stageBox(box: GraphicBox, canvas: { width: number; height: number }): PixelBox   // the box in even pixels, clamped to the canvas, no margins

// packages/core/src/graphics/motion/direct.ts (Task 2)
export const MOTION_PLAN_PROMPT_VERSION: string
export function planMotion(args): Promise<{ graphics: GraphicCue[]; dropped: number }>   // specs with html: null
export function acceptMotionPlan(reply, points, taken): { graphics: GraphicCue[]; dropped: number }   // no `framed`: a motion graphic points at nothing in the picture
/** The words a graphic is written for: those of the sentence from the word at `fromSourceUs` on, within `seconds` on the rough cut, the first forty, times rounded to the millisecond. Used by the plan's acceptance and by the desktop's `wordsNow`, so the two cannot disagree. */
export function motionWords(sentence: GraphicSentence, fromSourceUs: number, seconds: number): MotionWord[]

// packages/core/src/graphics/motion/write.ts (Task 2)
export const MOTION_CONTRACT: string
export const MOTION_WRITE_PROMPT_VERSION: string
export function motionBrief(args: { stage: { width: number; height: number }; seconds: number; words: MotionWord[]; idea: string; about: string }): string
export function repairBrief(args: { brief: string; html: string; problems: string[] }): string   // the first brief, then the problems, then the fragment
export function fragmentOf(answer: string): string                                // the answer without a code fence
export function writeMotion(args: { transport; model; brief: string; signal?: AbortSignal }): Promise<string>

// apps/desktop/src/main/graphics-render.ts (Task 3)
export interface Inspection { visible: boolean; goneAtEnd: boolean }
// RenderJob for a motion spec carries `times: number[]` (the words' times now); its hash takes the fragment, the times,
// the stage, seconds, canvas, fps, font, palette and MOTION_VERSION.

// apps/desktop/src/shared/api.ts (Tasks 4 and 5)
// GraphicView gains: written: boolean, stale: boolean, writeFailed: string | null
// PostWorkState running gains optional done and total
// DesktopApi gains: redoGraphic(folder: string, anchor: CueAnchor, request: PostRequest): Promise<PostRunView>   // shaped like rethinkPost
// GraphicPatch becomes { off?: boolean } in Task 7
```

---

### Task 1: Core — the spec, the linter, the page and the host

**Files:**
- Modify: `packages/core/src/graphics/plan.ts`, `packages/core/src/graphics/framing.ts`, `packages/core/src/graphics/index.ts`, `packages/core/package.json` (exports `./graphics/motion`, `./graphics/motion/lint`)
- Create: `packages/core/src/graphics/motion/lint.ts`, `lint.test.ts`, `packages/core/src/graphics/motion/html.ts`, `html.test.ts`
- Create: `apps/desktop/resources/graphics/host.js`, `apps/desktop/src/main/graphics-host.test.ts`

- [ ] **Step 1: Tests for the types and `stageBox`**
  - `isMotion` tells a motion spec from a card and a sticker.
  - `stageBox({x0:0.1,y0:0.5,x1:0.9,y1:0.9}, 1080×1920)` is `{x:108, y:960, width:864, height:768}`; odd results are rounded to even width and height; a box past the canvas is clamped inside it; it adds no margin.
- [ ] **Step 2: Add `MOTION_VERSION`, `MOTION_HTML_MAX`, `MotionWord`, `MotionSpec`, `isMotion` to `plan.ts`; add `MotionSpec` to the `GraphicSpec` union; make `isSticker`, `piecesOf` and `upgradeSpec` leave a motion spec alone (a motion spec has no pieces and is never a sticker). Add `stageBox` to `framing.ts`.** Fix what the compiler flags in `apps/desktop` with the smallest change that keeps today's behaviour for cards and stickers (a motion spec reaching kit-only code is skipped, not drawn).
- [ ] **Step 3: Tests for `lintFragment`** — one passing fragment (use `spike/fragments/F.html` as the fixture text, inlined in the test), and one failing case per rule of spec §6.1, each asserting the problem names what was found:
  - empty; longer than `MOTION_HTML_MAX`
  - each forbidden tag: `<html`, `<head`, `<body`, `<script src`, `<link`, `<iframe`, `<object`, `<embed`, `<img`, `<video`, `<audio`, `<canvas`
  - a URL in `src=`, `href=` or `url(`; `url(` that is not `url(#…)` (and `url(#clip)` passes); `@import`
  - each of `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `import(`, `importScripts`, `eval(`, `new Function`, `location`, `window.open`, `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator.`
  - each of `requestAnimationFrame`, `setTimeout`, `setInterval`, `Date`, `performance.now`, `Math.random`
  - each of `__timelines`, `__hf`, `hyperframe`
  - no animation at all (none of `@keyframes`, `.animate(`, `window.frame`)
  - several problems are all reported, not only the first
  - words inside Thai text that merely contain a forbidden word in another script do not trip it; `translate(` does not trip `Date`; `animation-duration` does not trip `Date` (match `Date` as a whole identifier, case-sensitive)
- [ ] **Step 4: Write `lint.ts`.** Each rule is a pattern and the words of its problem, for example ``uses `setTimeout`: the renderer sets time itself, animate with CSS animations or el.animate()``. The problems go to Claude in a repair, so they say what to do instead.
- [ ] **Step 5: Tests for `motionHtml` and `motionColours`**
  - The page has the CSP meta of spec §6.1, exactly.
  - `#root` carries `data-composition-id="main"`, `data-start="0"`, `data-duration`, `data-width`, `data-height`, `data-fps`; `#stage` has `class="clip"`, the same duration, and the stage's size.
  - `#stage`'s style sets `--w1…--wN` from `times` (unitless numbers), and `--ink --paper --accent --alt --bar --text`; `color: var(--text)`.
  - A `<script>` before the fragment declares `const T = [...]` with the same numbers.
  - The fragment is inserted inside `#stage` unchanged; the host script comes after it, last in the body.
  - The font face names the file beside the page; `font-synthesis: none`.
  - `html, body` are transparent and the size of the stage, `overflow: hidden`.
  - `motionColours`: `accent`, `alt`, `bar`, `text` are the palette's colours as hex; `paper` is `#FFFFFF`; `ink` is the darker of the palette's text and `#1F2227` measured by contrast against white (so a style whose text is white still gets a dark ink).
- [ ] **Step 6: Write `motion/html.ts`** after `spike/mk.mjs`, with the CSP from spec §6.1.
- [ ] **Step 7: Write `apps/desktop/resources/graphics/host.js`** from `spike/host.js`, unchanged in behaviour: it waits for the fonts and pictures, draws time 0, then registers the timeline under `"main"` and its ready promise under `buildReady.host`. Its header comment says what HyperFrames asks of it (copy the facts from `kit.js`'s header).
- [ ] **Step 8: `graphics-host.test.ts`** runs `host.js` in a `node:vm` context with a fake `document` (`getElementById("root")` with `data-duration="3"`, `getAnimations()` returning fake animations that record `pause()` and `currentTime`, `fonts` as an empty set with `ready`, `images` empty) and a fake `window`:
  - after the ready promise settles, `window.__timelines.main` exists and `duration()` is 3
  - `totalTime(1.5)` pauses every animation and sets `currentTime` to 1500; `seek(9)` clamps to 3000; `totalTime()` with no argument answers the time
  - `window.frame` is called with the time on every draw, and not called when absent
  - an animation whose `currentTime` setter throws does not stop the others
- [ ] **Step 9:** `npm test` and `npm run typecheck`.

---

### Task 2: Core — the planning call and the writing call

**Files:**
- Create: `packages/core/src/graphics/motion/direct.ts`, `direct.test.ts`, `packages/core/src/graphics/motion/write.ts`, `write.test.ts`
- Modify: `packages/core/src/graphics/direct.ts` (export the generic helpers the new module needs: the point description lines of `describe`, `startOf`, `secondsOfChar`, `frameKey`, `framesToAttach`; no behaviour change), `packages/core/package.json` (exports `./graphics/motion/direct`, `./graphics/motion/write`)

- [ ] **Step 1: Tests for `acceptMotionPlan`** (port the still-true cases of the old `acceptGraphics` tests):
  - an answer for an unknown point, a point already filled, or one in `taken` is dropped and counted
  - a box outside the limits is dropped: width 0.5–1.0, height 0.15–0.5 (real frames leave about 0.18 between a talking head's keep-clear band and the subtitles' room at 0.76, so 0.2 would have shut most points out), inside the frame, with the slack of 0.05 today's `boxOf` allows a model that rounds, and kept as it was given
  - `seconds` is clamped to 1.5–6, default 3; when the answer's `until` word is found in the point's sentence at or after the start word, `seconds` is at least that word's time from the start plus 1 s (half a second to read it, and the way out), before the clamp. Claude plans without the words' times, which only the app knows, so it names the last word its idea lands on and the app sees that the graphic lasts that long (found by Task 2's implementer: without this a `seconds` guessed too short left the key word out of the brief)
  - the start is the answer's word when the point's sentence has it, else the point's start (as `startOf` does today); a sentence with no words drops the answer
  - `idea` is made one line (white space collapsed), trimmed and cut to 400 characters on a grapheme (the real plan's ideas ran to 198; the end of an idea holds its landing word, so the cut must not reach it; the row clamps it by CSS); an empty idea drops the answer
  - the spec is `{ kind: "motion", version: MOTION_VERSION, box, seconds, why, idea, words, html: null }`, the anchor is the speech anchor with its beat, and `pointId` is set
  - `words` are the point's words from the start word up to `seconds`, each `{ text, atS }` with `atS` from its timeline time, in order; at most 40 (inside a phrase speech runs at four to five words a second, and a graphic lasts at most 6 s)
- [ ] **Step 2: Tests for `planMotion`**: with every point taken it calls nothing and answers empty; otherwise one `transport.generate` with the schema, the frames attached as today, and the system prompt; the request text lists each point as today's `describe` does, and says the canvas orientation and where the subtitles start.
- [ ] **Step 3: Write `motion/direct.ts`.**
  - The system prompt is the text of `spike/plan-prompt.md` (the controller wrote it; change it only where what it says about the request differs from what the request really holds). In short it tells Claude: it is choosing where a bespoke animated graphic would help the viewer understand or feel the point; one graphic per point at most, only where a picture adds something the words and the highlight text do not; for each, the word it starts on, how long, a box (full width allowed, up to half the frame tall, in the free band the point's line names, never over the face, the highlight text or the subtitles), a one-line reason, and **the idea**: what to draw and how it moves, concretely enough for a designer to build it, in Thai. No quotas.
  - Schema: `{ graphics: [{ point: number, word: string, until: string, seconds: number, why: string, box: [x0,y0,x1,y1], idea: string }] }`.
- [ ] **Step 4: Tests for `write.ts`**
  - `MOTION_CONTRACT` is the text of `spike/contract-final.md` as it stands now, with its "Shape" section (assert on its load-bearing lines: one `<style>` first and one plain `<script>` last; no HTML comments; no inline event handlers; no SMIL; CSS animations and Web Animations only; the forbidden timers; `window.frame`; the word variables `--w1` and `T`, and not declaring `T`; the colour variables; "Return only the fragment").
  - The contract and the linter must not drift apart, in either direction. (a) Every fragment of `packages/core/src/graphics/motion/fixtures/` (the six of the spike and the nine of the trial, written by real calls; Task 1's last fix round copied them there behind one helper) passes `lintFragment`. (b) What the contract names as allowed passes: one fragment that uses `document.getElementById`, `querySelector`, `querySelectorAll`, `document.createElementNS`, `document.createElement`, `setAttribute`, `appendChild`, `textContent`, `style`, `el.animate()`, `getTotalLength()`, `getPointAtLength()`, `Math.round`, `window.frame`, `<use href="#id">`, `url(#id)`, `color-mix()`, `-webkit-text-stroke`, `paint-order`, a CSS `/* */` comment, `calc(var(--w2) * 1s - 0.3s)` and `T[1] * 1000`. (c) What the contract forbids and the linter enforces is refused: a table with one small fragment for each tag, attribute and name the contract lists under "Shape" and "The script", and for each forbidden timer under "Time". Sentences of the contract that are advice the linter does not check (comments of one line, `window` only for `window.frame`, no event listeners, no transitions by class changes, the SVG transform rule, which the host checks at render time, and the whole of "Look") are not in that table.
  - `motionBrief` lists the stage `W = … , H = …`, `D`, the words in order as `--w1 "คำ" 0.15 · --w2 …` with two decimals, the idea after "What to draw:", and the clip's subject after "The clip is about:".
  - `repairBrief` starts with the first brief as it was (Claude needs the stage, `D` and the words to put right a graphic that stays on screen or leaves the stage), then says the fragment below was written for it and has these problems, one `- ` line each, asks to put right every problem and change nothing else and to return the whole corrected fragment with no code fence and no explanation, and ends with the fragment. `spike/trial-r1/b-rep5.txt` is one that a real call answered with a corrected fragment.
  - `fragmentOf` strips a leading and trailing code fence (```` ```html ```` or ```` ``` ````) and outer white space, and leaves an unfenced answer alone.
  - `writeMotion` makes one `transport.generate` call with `MOTION_CONTRACT` as the system prompt, no schema (plain text), `maxTokens` 12,000, passes the signal, and answers `fragmentOf` of the text.
- [ ] **Step 5: Write `motion/write.ts`.** Look at how `packages/core/src/llm/types.ts` shapes a request with no schema; if the transport requires a schema today, add plain-text support there with tests, in both transports, without changing existing calls.
- [ ] **Step 6:** `npm test` and `npm run typecheck`.

---

### Task 3: Main — render a motion job and inspect it

**Files:**
- Modify: `apps/desktop/src/main/graphics-render.ts`, `graphics-render.test.ts`, `apps/desktop/src/main/index.ts` (pass `motionAssets`)

**Found after Task 1's review, proven in the spike (see the notes' README and spec §6):**
- HyperFrames exits 0 even when the page's script is broken, and takes 20 s to give up on a page that never registers its timeline. So the render's output is scanned for what it prints.
- `host.js` moves to the third version in the notes (`spike/host-v3.js`): `window.frame` runs inside a try/catch that reports each distinct message once with `console.error("BOXBLACK motion error: …")`, and the timeline still registers, so a throwing frame function fails fast and with its message.
- The third version also checks, once, before the first draw, for the one silent fault the trial of 2026-09-30 found (1 fragment in 8): an SVG element that has a `transform` attribute and an animation of its `transform`, which replaces the attribute, so the element jumps to the corner of the drawing. It reports it through the same `console.error`, naming the element, and the same scan fails the render with it. One real repair call given that message returned a corrected fragment (`spike/trial-r1/5.html` and `5-repaired.html`). It raised no alarm on the other 13 fragments.
- Every render runs Chrome through a wrapper script (`spike/chrome-offline.sh`) that adds `--proxy-server=http://127.0.0.1:9 '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]' --force-webrtc-ip-handling-policy=disable_non_proxied_udp --block-new-web-contents`, after the renderer's own arguments (see the README's last section: without the bypass list Chrome sends link-local addresses direct).
- Renders of the same page are not byte-identical from run to run; never compare rendered files by hash in a test.
- Decided in the two fix rounds after Task 3's reviews (2026-09-30), and in the code: a graphic's failure is stored in plain words, one problem per line, with no `Error: ` prefix; the host's distinct reports are given `window.frame threw:` first, five at most, then `and N more`; a HyperFrames that exits non-zero on a motion job is scanned too, and with nothing found the reason is the app's own sentence, never HyperFrames' last lines (they name its globals, which the linter refuses); out of time has a sentence of its own; the machine's faults (the work folder or the graphics folder cannot be written, the wrapper cannot be written, the browser never started: no `[BrowserManager] Browser launched` line) are `EnvironmentError`s, so no repair call is spent on a fragment that was fine.
- Captured for the tests: `spike/renderer-output-samples.txt` (the lines HyperFrames printed for a syntax error, a throwing `window.frame`, a page that navigates away and a policy violation; a normal render prints no line starting `[Browser:`) and `spike/inspect-A.txt` (the whole output of the inspection command for one render). The notes' README has the inspection's numbers.
- The repo's own page and host were rendered by the controller through the real pack and the wrapper on 2026-09-30 (`spike/e2e.mts`): fragments A and F, under three real palettes, all visible and all gone at the end.

- [ ] **Step 0: Tests for the three additions**
  - `graphics-host.test.ts`: a `window.frame` that throws is reported once per distinct message through `console.error` with the prefix `BOXBLACK motion error: window.frame threw: `, the animations are still set on that draw and later draws, and the timeline is registered all the same. An animation whose target is an SVG element with a `transform` attribute and whose keyframes hold a `transform` is reported once, as `BOXBLACK motion error: <g class="…"> has a transform attribute and an animation of its transform: …` (the words are in `spike/host-v3.js`), before the first draw; the same animation on an element without the attribute, on an HTML element, or with `composite: "add"` is not, and an effect that throws when read is passed over. Then replace `host.js`'s code with `spike/host-v3.js` (header kept, with a sentence for each of the two reports).
  - `graphics-render.test.ts`: before a render, a file `chrome-offline.sh` is written in the work folder, executable, whose one command execs the pack's Chrome with `"$@"` and then the four flags (the path in single quotes, each `'` in it written `'\''`, since it runs through `Application Support`); the render's `HYPERFRAMES_BROWSER_PATH` is that file; the pack's own Chrome must still exist or the render is refused as today.
  - `graphics-render.test.ts`, the output scan (give the injected `run` an output to return; the real `runHyperframes` returns the process's combined output): a line `[Browser:PAGEERROR] Unexpected token ';'` fails the job with `the script failed: Unexpected token ';'`; lines `[Browser:ERROR] BOXBLACK motion error: <message>` fail it with their distinct messages, in the order they came, the first three joined by `; ` (each line comes once per Chrome worker; one `window.frame threw: boom` gives `window.frame threw: boom`); `sub_timeline_readiness_timeout` fails it with `the page never became ready (its script did not finish)`; the first of these found wins, in that order; none of them is the machine's fault; a card job ignores the scan.
  - `graphics-render.test.ts`, the lint at render time: a motion job whose fragment fails `lintFragment` is failed with `the fragment was refused: <first three problems joined by "; ">` and nothing is rendered.

- [ ] **Step 1: Tests** (with the injected `run`, `poster` and a new injected `inspect`):
  - a motion job's page is `motionHtml(...)` with the stage from `stageBox`, the job's `times`, palette and font; the font file is copied beside it; no emoji picture is asked for
  - its hash changes with the fragment, any time, the box, seconds, canvas, fps, font, palette; it does not change with `why`, `idea`, `words` or `failed`
  - the meta written last is `{ width, height, durationUs, place: placeOnCanvas(stage box, canvas) }`
  - `inspect` says nothing visible → the job fails with `nothing was drawn: every frame is empty`; still visible at the end → `it is still on screen at the end: the way out must be over, with everything invisible, 0.1 s before D`; both are the graphic's failures (kept for `failureOf`, cleared by `retry`), not the machine's
  - the file is inspected where HyperFrames wrote it, before it is moved into the graphics folder: a refused render leaves no file, poster or meta there
  - a motion job whose `html` is null fails with `the graphic has not been written`, and nothing is rendered (Task 4 stops such a job being made)
  - a render that HyperFrames fails keeps its last lines as the failure, as today
  - a card job still renders as before (until Task 7)
- [ ] **Step 2: The real `inspect(path)`** runs the bundled ffmpeg: `-i <mov> -vf "alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-" -f null -`, reads one `YMAX` per frame from stdout, and answers `visible = some frame's max > 16` and `goneAtEnd = the last frame's max <= 16` (on the 8-bit scale ffmpeg reports after `format=gray`; add `format=gray` before `signalstats`). Test the parser on a captured sample of that output (`spike/inspect-A.txt`, inlined as three frames), that the app's ffmpeg missing is an `EnvironmentError`, and that ffmpeg failing on the file fails the graphic, as a failed poster does today (one unreadable file must not mark the machine unfit, which would stop every graphic and send the writing work into its no-render path).
- [ ] **Step 3: Implement.** `RenderJob` for a motion spec carries `times: number[]`. Keep one queue, one render at a time.
- [ ] **Step 4:** `npm test` and `npm run typecheck`.

---

### Task 4: Main — pieces in force, the words now, stale pieces, views

**Files:**
- Modify: `apps/desktop/src/main/graphics-cues.ts`, `highlights.ts`, `timeline.ts`, `sound-cues.ts`, `apps/desktop/src/shared/api.ts`, their tests, `apps/desktop/src/renderer/test/fake-api.ts` (defaults for the new view fields), `packages/core/src/graphics/plan.ts` (`PlacedGraphic` gains `wordsNow?` and `stale?` for a motion piece)

- [ ] **Step 1: Tests for `graphicsInForce` with motion specs**
  - the level filter, the placement on the cut, the duration rule and the vertical dodge work for a motion spec as for a card; the kit-only steps (label-only cards, sticker bands, settled motions) do not touch it
  - `wordsNow`: core's `motionWords` of the sentence the piece's point has now, from the piece's anchor, for `spec.seconds`; a scene point has none. When their texts equal `spec.words`' texts in order, the piece carries those times; when they differ (a word cut, another word, fewer words), the piece is **stale**
  - a written piece whose room now is short of `spec.seconds` by at most 0.3 s plays its written length all the same, running on into the next piece (a change of cut preset moves a piece's end by up to about 0.3 s, and the graphic is on its way out by then); after every rule, a written piece is stale when it plays for less than `spec.seconds` by more than 0.1 s (a fragment's way out is over 0.1 s before its end, so that much can be cut with nothing lost; more would cut what is drawn, and the times typed into a fragment cannot be moved without Claude), or when its `version` is not `MOTION_VERSION`. A redo writes it for the room there is now (Task 5).
  - a piece with `html: null` is **unwritten**; stale and unwritten pieces are placed (they show in the list) but have no render job
- [ ] **Step 2: Tests for the view and the write**
  - `GraphicView` for a motion piece: `summary` is the idea, `what` stays the said words, `written`, `stale`, `writeFailed` (the spec's `failed` or null); `render` is `waiting` with no poster for an unwritten or stale piece
  - `graphicJob` answers `RenderJob | null`: for a written, fresh piece the job has `times` from `wordsNow`, the style's font and palette, and its `seconds` as written (never shortened); for a stale or unwritten piece, null. `graphicJobs` answers `jobs[i]` for `kept[i]`, or null, and callers leave the nulls out of what they hand the renderer
  - the write skips stale and unwritten pieces and counts them in `graphicsSkipped`; it does not wait for them
  - the sound slot of a motion piece reads `กราฟิกขึ้น: <idea>`
- [ ] **Step 3: Implement.** Add `written`, `stale`, `writeFailed` to `GraphicView` in `shared/api.ts`, with defaults in `fake-api.ts` and every test literal the compiler flags.
- [ ] **Step 4:** `npm test` and `npm run typecheck`.

---

### Task 5: Main — plan, write three at a time, check, repair once, redo

**Files:**
- Modify: `apps/desktop/src/main/flair.ts`, `post-plan.ts`, `highlight-api.ts`, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/preload/*` (the bridge for `redoGraphic`), their tests, `renderer/test/fake-api.ts`
- Create: `apps/desktop/src/main/motion-write.ts`, `motion-write.test.ts`

- [ ] **Step 1: Tests for `motion-write.ts`** — `writePiece(piece, deps)`, where the piece is what a brief needs (stage, seconds, words, idea, about) and the deps are a fake transport and a fake `render(html)` that answers the fragment's problems, none, or null when the machine cannot render; the module knows nothing of outlines or the renderer:
  - writes, lints, renders, and answers the fragment when all pass; one transport call
  - a lint problem → one repair call whose brief (`repairBrief`) carries the first brief, the problems and the fragment; the repaired fragment is linted and rendered again; stored when it passes; two transport calls
  - a render failure (`render` answers `nothing was drawn…`) → the same single repair, its brief carrying each problem on a line of its own
  - still failing after the repair → `{ failed }`, the last attempt's problems (the first three, one per line); never a third call, whether the repair was spent on the lint or on the render
  - the machine cannot render (`render` answers null) → the fragment that passed the lint is the answer, unrendered, with no repair
  - an abort rejects with the cancel error and answers nothing
  - a call that fails for any other reason (the token limit, a refusal, Claude Code failing, a timeout) is that piece's failure, `{ failed: <the message> }`, with no repair; the other pieces go on
  - `writeAll(pieces, write, onProgress)` runs at most three at a time (assert the high-water mark with held promises), reports `(done, total)` after each piece settles, and carries on after one fails
- [ ] **Step 2: Implement `motion-write.ts`.** A piece is written for the room it has now, not for what the plan wished: `seconds` is how long it plays on the cut now (what `graphicsInForce` gives it, which is the plan's seconds or up to the end of the piece of the cut, never under 1.5 s), and `words` are `wordsNow` for that length. The brief comes from `motionBrief` with the stage from `stageBox(box, canvas)` of the box as it is placed now, that `seconds`, those `words`, the idea, and `about` from the outline's title and summary (and the brief's video type when there is one). What is stored with the fragment is `html`, that `seconds` and those `words`, so the spec says truthfully what the fragment was written for, and the piece is fresh until the cut changes again. A redo does the same, which is how a stale piece is put right.
- [ ] **Step 3: Tests for the graphics work** (`flair.ts` `planGraphics`, `post-plan.ts`):
  - with graphics on, the work calls `planMotion`, stores the cues as it stores Claude's answer today (edited ones kept, points of theirs excluded, items for points not shown kept), then writes every piece in force at the level set that is unwritten and not off, each for the room it has now, storing each as it settles (the fragment, the seconds and the words it was written for; or `html: null` and `failed`); a candidate that has not passed is never stored
  - the work's running state carries `{ done, total }` as pieces settle; it ends `done` with `count` = pieces written and `dropped` = what the plan dropped plus pieces that failed
  - "หยุด" during the writing stops the remaining calls; pieces already written stay; the work ends as stopped does today
  - a rethink of graphics plans again: unedited pieces are replaced, as today
  - `redoGraphic(folder, anchor, request)`: one run of the graphics work alone, refused while another run goes on the project; it writes that piece again through `writePiece` for the room it has now, keeps its old fragment until the new writing has ended, then stores the new one or `html: null` with `failed`; a piece with no place now fails the work with `this graphic has no place on the clip now`; it does not mark the piece edited and leaves every other piece alone
  - `setGraphic(anchor, { off })` and `setGraphic(anchor, null)` work on a motion piece as today
- [ ] **Step 4: Implement.** When the graphics work begins writing, and when a redo begins, the renderer's `forgetMachine()` is called, so a machine fault the user has mended does not leave the writing in its no-render path. `PostWorkState`'s running variant gains optional `done` and `total`. Add `redoGraphic` to `DesktopApi`, the preload bridge, `highlight-api.ts` and `fake-api.ts`. The render check is built in `flair.ts` from one small function added to `highlights.ts` that gives the job a placed piece would have with a candidate fragment, so the render the check makes is the one the preview and the write use.
- [ ] **Step 5:** `npm test` and `npm run typecheck`.
- [ ] **Fix round 1 (from the two reviews, `prompts/task5-fix1.md`):**
  - **The stop reaches a writing at every point.** `writePiece` looks at the signal before each call and after the render check, and the check is awaited until it settles or the signal aborts, whichever comes first; a stopped writing rejects and stores nothing, and the render under way is left to end in the background (its file is kept under its hash). Before this, a stop during a render check waited for the render (up to 120 s, one at a time), stored the graphic after the stop, and could end the work `done`.
  - **A throw inside the render check** (the draft cannot be read just then) answers null, as a machine that cannot render does: the linted fragment is kept and the preview's render judges it.
  - **One graphic to a place.** A graphic is known by its anchor everywhere (the store of a writing, `setGraphic`, `retryGraphic`, `redoGraphic`, the rows). `acceptMotionPlan` drops, and counts, an answer that starts on a word an earlier answer of the same reply starts on; the merge drops one of Claude's waiting graphics that shares a place with one of the user's or with a new answer.
  - `writeAll` treats a reporter that throws as a write's failure; `redoGraphic` is in `LICENSED_METHODS`.
  - **Known limits, accepted:** a redo of a switched-off graphic with no room on the frame is written for its stored box (`graphicsInForce` lists a switched-off graphic whether or not there is room, and the fragment fits the box it gets when there is room again); a redo that fails leaves the graphic with no fragment though the old one was fine; on a machine that cannot render, a redo swaps an inspected fragment for one that is only linted; the list of graphics to write is read once, so one switched off or removed before its turn still costs a call; `count` is 0 when the run had nothing to write.
  - **For Task 6:** main sends no `graphics` event after a writing is stored, only the running report, so the room reads the graphics again on each running report that carries `done`.

---

### Task 6: Renderer — rows, states, redo, progress; the sheet goes

**Files:**
- Modify: `renderer/src/edit/FlairTab.tsx`, `GraphicsTab.tsx`, `PlanStrip.tsx`, `WriteButton.tsx`, `renderer/src/screens/PostScreen.tsx`, `renderer/src/room/ClipRoom.tsx` (a `redoGraphic` action), `renderer/src/format.ts` (`playedSeconds` moves here), `renderer/src/i18n.ts`, `renderer/src/styles/edit.css`, their tests
- Move to the Trash: `renderer/src/edit/GraphicSheet.tsx`

- [ ] **Step 1: Tests**
  - a row shows the poster when there is one, the idea, the reason, the point, the length
  - the state line, one of: `กำลังเขียน…` (unwritten, no failure, a run going), `ยังไม่ได้เขียน` (unwritten, no run), `เขียนไม่สำเร็จ · <last lines>` (`writeFailed`), `การตัดช่วงนี้เปลี่ยนไป กดทำใหม่` (stale: its words changed, or it now has less time than it was written for), then the render states as today, and `ปิดอยู่` when off
  - buttons: `ทำใหม่` always (disabled while busy or a run goes), calling `api.redoGraphic` with the request the room sends for a plan, as `rethinkPost` is called; `ลองเรนเดอร์ใหม่` only when the render failed; off/on; remove. There is no edit button and no sheet.
  - the plan strip's running line for graphics reads `กำลังเขียนกราฟิก {done} จาก {total}` when the state carries them, and the plain running line otherwise
  - the switch's hint is the text of spec §8
  - the write sheet (`WriteButton.tsx`): a piece that is on but not written, or stale, will not be written into the draft, so it is left out of the count of graphics to write and of the renders counted as done and awaited, and a warning line says how many such pieces there are (`write.check.graphicsUnwritten`: `กราฟิก {count} ชิ้นยังไม่ได้เขียนหรือต้องทำใหม่ จะไม่ถูกใส่`)
- [ ] **Step 2: Implement.** Remove `editingGraphic`, `onEditGraphic` and the sheet's mount from `PostScreen` and `GraphicsTab`; remove the `showsFailure` argument of `changeHighlightText` if nothing else passes it. Remove the ~31 sheet tests in `PostScreen.test.tsx` and give the row tests a motion fixture (`MOTION` with `idea`, `written: true`).
- [ ] **Step 3: i18n.** Add `graphics.redo`, `graphics.redoLabel`, `graphics.state.writing`, `graphics.state.unwritten`, `graphics.state.writeFailed`, `graphics.state.stale`, `post.run.writingGraphics`. Rewrite `flair.graphicHint`. Remove the sheet's keys, the sticker motions and the piece kinds once nothing uses them (`graphics.refused.*` are about cutaways and stay).
- [ ] **Step 4:** `npm test` and `npm run typecheck`.

---

### Task 7: The old kit leaves; old graphics are cleared once

**Files:**
- Core: `graphics/plan.ts` (only `MotionSpec` and the generic parts stay; `GraphicSpec = MotionSpec`), `graphics/direct.ts` (the card prompt, schema and validators go; the generic helpers stay, or move into `motion/direct.ts`), `graphics/framing.ts` (`renderBox` and its margins go), `graphics/index.ts`, `package.json` exports; move to the Trash: `graphics/emoji.ts`, `emoji.test.ts`, `graphics/kit/` (whole folder), and the tests that only tested the kit
- Main: `flair.ts` (`knownEmoji`, the patch of pieces), `graphics-cues.ts` (kit-only steps, `summaryOf`, `KIND_NAMES`, `MOTION_NAMES`, sticker bands), `graphics-render.ts` (the card path, emoji pictures, `EmojiPicturesError`), `highlight-api.ts` (`checkedPatch` takes `{ off }` only), `highlights.ts`, `index.ts` (no `kitAssets`, no `readEmojiSet`), `post-cleanup.ts`, `project-files.ts`, `shared/api.ts` (`GraphicPatch = { off?: boolean }`, `GraphicsProblem` without `"emoji"`, `GraphicView` without `storedMotion`)
- Renderer: the emoji problem banners in `FlairTab.tsx` and `SettingsScreen.tsx`, their i18n keys
- App resources and scripts, to the Trash: `apps/desktop/resources/graphics/kit.js`, `timeline.js`, `kit.css`, `apps/desktop/resources/graphics/emoji/`, `apps/desktop/scripts/fetch-fluent-emoji.mts` and its test, `apps/desktop/scripts/graphics-kit-check.mjs` and its test, `apps/desktop/src/main/graphics-kit.test.ts`
- `apps/desktop/scripts/release-check.ts` and its test: the emoji checks go; add a check that `resources/graphics/host.js` exists

- [ ] **Step 1: Tests for the one-time clean-up**
  - an outline at post version 1 (after M25) loses every stored graphic, edited ones too, and is stamped version 2; Claude's unedited sounds that only a removed graphic held go with it (use the existing `withoutSoundsOn`/`heldMoments` logic); highlight groups, zooms, cutaways and other sounds stay
  - an outline with no post version gets the M25 clean-up and this one, and ends at version 2
  - an outline already at version 2 comes back the same object
  - the store copies the original to `outlines-before-050` before the first write of this step, never overwrites a copy that is there, and writes nothing if the copy fails; the M25 copy folder is used only for outlines with no post version
  - a new outline from the planner is stamped version 2
- [ ] **Step 2: Implement the clean-up.** `POST_VERSION = 2`. `OutlineStore` takes steps `[{ below: 1, upgrade, backupDir }, { below: 2, upgrade, backupDir }]` (or an equivalent shape) and runs each whose version the outline is below, backing up once per step's folder.
- [ ] **Step 3: Remove the kit and the emoji.** Let the compiler lead: delete the types, then fix every place it flags by removing the card and sticker path (not by adapting it). Move the files listed above to the Trash with `mv`. `electron-builder.cjs` keeps copying `resources/graphics` (now `host.js` only).
- [ ] **Step 4: Search** `packages/core/src` and `apps/desktop/src` for `sticker` (outside CapCut's own sticker tracks in `capcut/`), `CardSpec`, `PieceKind`, `kitAssets`, `KIT_VERSION`, `EMOJI_SET`, `readEmojiSet`, `GraphicSheet`, `emojiProblem`. Expected: nothing.
- [ ] **Step 5:** `npm test` and `npm run typecheck`.

---

### Room for graphics (found in the early live look, 2026-09-30; the user chose way 2 the same evening: only the point's highlight text gives way, the subtitles stay)

With highlight text and subtitles both on, a talking-head frame has no free stretch of 0.15 of its height: on 0917 at the level "จัดเต็ม" the planner rightly answered no graphic at all (the text holds the band above the head, the keep-clear band is 0.22 to 0.64, subtitles start at 0.76, and 0.12 is left). With highlight text switched off it planned three, all in the band above the head (972×290 px). Over the 60 talking-head scenes of the user's own clips: 34 have a stretch of 0.15 when the point's highlight text gives way and the subtitles stay, 47 when a graphic may also take the subtitle room (20 and 36 have 0.25). Scenes where the person fills the frame have none either way.

Asked of the user, three ways: (1) both give way while a graphic plays: the highlight text of its point is not shown, and the subtitle words said under a graphic that covers the subtitle room are left out (recommended; about two tasks, the subtitle half being the risky one, to be moved to 0.5.1 if it does not settle); (2) only the point's highlight text gives way (one task); (3) nothing changes. Whatever is chosen becomes a task between Task 7 and Task 8. Notes for it: a graphic must never dodge its own point's text; the text is hidden only while its graphic is on, written and not stale, so a graphic that cannot be written leaves the text in place; `hiddenWords` (`highlight-state.ts`) is the existing way subtitle words are left out under highlight text; the planner's prompt says today that the subtitle room and the text's band may not be covered; an empty plan should say why (no room) in the graphics tab instead of a bare `กราฟิก เสร็จ 0 ชิ้น`.

### Task 7b: A graphic takes the place of its point's highlight text

The whole task is `docs/plans/2026-09-30-freeform-motion-notes/prompts/task7b.md`, written from the code map in `research/text-gives-way-map.md`. In short:

- [ ] **Rule A:** `graphicsInForce` keeps a graphic off keep-clear, the subtitle room and the highlight text on screen while it plays, less the text of its own point's groups (a text band knows its point).
- [ ] **Rule B:** a point is replaced when it has a kept graphic with a job (on, passing the level, placed with room, written, not stale); its groups are then not drawn: no text tracks in the draft, no words hidden from the subtitles, not counted as text to be written. Everything else keeps them: sound, cutaway and punch slots on their lines, the run of looks, each group ending the one before it, the write's count check, the preview's list (where they are marked `replaced`).
- [ ] **One pass:** groups placed and timed as today, graphics placed against their bands, then the replaced groups marked. Never repeated.
- [ ] **The planner** is told each point's own text band, and that the text of a point it puts a graphic on gives way (`MOTION_PLAN_PROMPT` becomes `spike/room/plan-prompt-text-gives-way.md`, version `motion-plan-2026-09-30b`). Proven with one real call on the logged request of the run that had got no graphic: three graphics, in the band above the head, carrying the key words themselves (`spike/room/reply-text-on.json`).
- [ ] **The screen:** a replaced group's row says `มีกราฟิกแทน ไม่ขึ้นในคลิป`; the write sheet and the counts leave it out; the "Aa" button does not come back for its point; the subtitle lines are read again when the set of replaced groups changes; `graphics.none` says why there may be none.
- [ ] **The plan run:** with the lines under the text hidden and graphics on, the polish waits for the graphics work.
- **Known limits, accepted:** a sound or a punch on a replaced group's line still plays at that moment; a graphic also keeps off another point's text that ends up replaced; a render that fails at write time leaves its point with neither text nor graphic in that write (reported as a skipped graphic).

### Task 8: Version and docs

- [ ] `apps/desktop/package.json` version `0.5.0`.
- [ ] Main spec `docs/specs/2026-09-17-capcut-timeline-manager-design.md`: a Thai `0.5.0` entry after 0.4.4, pointing at the new spec.
- [ ] `docs/specs/2026-09-24-graphics-overlay-design.md` and `docs/specs/2026-09-25-sticker-graphics-design.md`: a status line at the top saying the kit was replaced in 0.5.0 and naming the new spec.
- [ ] `docs/customer-install.md`, if it names the emoji or the card kit: update.
- [ ] `npm test` and `npm run typecheck`.

### Task 9 (controller): Mutation checks, the DMG, the live test

- Mutation checks on `motion/lint.ts` (each rule removed), `motion/html.ts` (CSP, variables, `T`), `motion/direct.ts` (each drop rule), `motion/write.ts` (`fragmentOf`), `graphics-render.ts` (the inspection thresholds and messages, the hash inputs), `motion-write.ts` (the single repair, the pool of three, the machine-not-ready path), `graphics-cues.ts` (`wordsNow`, stale), `post-cleanup.ts` (the version gates), `FlairTab.tsx` (the states and buttons), `PlanStrip.tsx`.
- `npm run dist` → `apps/desktop/release/boxblack-0.5.0-arm64.dmg`. Check the DMG is smaller (no emoji) and that `host.js` is in `Resources/graphics`.
- The adversarial render, under the app's own wrapper and with the linter skipped (the second review's list: names built from strings pass any linter): a fragment that clicks a detached anchor built with `"hr" + "ef"`, and one that sets `this["loc" + "ation"]`, each aimed at `spike/listen.py` on loopback and at an address on the LAN. Expected: nothing reaches the LAN; loopback gets at most one GET; both renders fail.
- Live test on a test profile cloned from the app data, with the real Claude: back up 0917; graphics on; run the plan; watch the progress line; check every piece's state; redo one; edit the cut so a piece goes stale; write to 0917; ask the user to open it in CapCut and export; restore 0917 from the backup and compare.
- Record the results in the spec and in memory.
