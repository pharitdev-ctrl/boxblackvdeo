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
