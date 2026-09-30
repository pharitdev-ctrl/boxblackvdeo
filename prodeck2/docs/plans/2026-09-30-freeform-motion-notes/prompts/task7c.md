You are implementing Task 7c of the BOXBLACK 0.5.0 plan: "The host catches an exit that hides an entrance".

## The project in brief

BOXBLACK is an Electron app that writes AI rough cuts into CapCut drafts. Monorepo at `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`: `packages/core` (pure TypeScript), `apps/desktop/src/{main,shared,renderer}`, `apps/desktop/resources`. Node 26 runs TypeScript natively; tests are vitest; there is no git.

In 0.5.0 Claude writes each motion graphic as an HTML fragment (one `<style>`, markup, an optional `<script>`), under a contract (`MOTION_CONTRACT` in `packages/core/src/graphics/motion/write.ts`, the text of `docs/plans/2026-09-30-freeform-motion-notes/spike/contract-final.md`). The app lints it, wraps it in a page that ends with the host script `apps/desktop/resources/graphics/host.js`, renders it with HyperFrames, and inspects the result. Problems found at render time go to Claude in one repair call. The host already reports one silent fault before the first draw: an SVG element with a `transform` attribute and an animation of its transform (read its header comment and `checkTransforms`).

## What went wrong

The user opened the draft written by the last live test in CapCut: in the countdown graphic, all three digits show on top of each other from the start. The fragment is `docs/plans/2026-09-30-freeform-motion-notes/live-look/countdown-overlap.html`. Each digit has `.num { opacity: 0 }` and two animations on opacity:

```css
.n2 { animation: slam .32s calc(var(--w2) * 1s - .18s) both, shrinkOut .16s calc(var(--w3) * 1s - .16s) both }
```

With fill `both`, the later-listed animation (`shrinkOut`, the exit) applies its first keyframe (`opacity: 1`) before it starts. It is later in the composite order, so it wins over the entrance for the whole time before the exit begins: the digit is visible from time 0, and the entrance never shows. The contract itself tells Claude to use `animation-fill-mode: both` on every animation, which is what invites this. The inspection cannot see it (something is drawn, and nothing is left at the end).

## What to build

1. **A host check, beside `checkTransforms`, run before the first draw, reported the same way** (`report`, once per distinct message, elements with the same tag and class sharing one report):
   - For each element, take its animations in composite order (`document.getAnimations()` returns them so: CSS animations in the order of `animation-name`, then those of `el.animate()` in creation order).
   - A later animation B hides an earlier animation A of the same element when: B's fill is `backwards` or `both`; B starts later than A (`effect.getTiming().delay`, which is the computed delay, `calc()` resolved); and B's keyframes and A's keyframes animate at least one property in common (leave out `offset`, `computedOffset`, `easing`, `composite`). A `composite` other than `replace` on B does not hide A: skip it.
   - The report names the element (tag and class, as `naming` does), the property, and both animations (a CSS animation by its `animationName`; one made by `el.animate()` by its `id` when it has one, else as "an el.animate() animation"), and says what to do, in the voice of the existing report. For example: `<span class="num n2"> has two animations of opacity, and the later one (shrinkOut) fills backwards: before it starts, its first frame shows and hides the earlier one (slam). Give the later one animation-fill-mode forwards, or put it on a wrapping element`.
   - An effect that cannot be read is not checked, as today.
   - Update the header comment of `host.js`.
2. **The contract** (`spike/contract-final.md`, and `MOTION_CONTRACT` copied from it): where it says every animation uses `animation-fill-mode: both`, it says instead that an element's entrance uses `both`; that when one element has an entrance and an exit (two animations of the same property), the exit uses `forwards`, because with `both` its first frame applies before it starts and hides the entrance; or that the exit goes on a wrapping element. Keep it to two sentences, in the contract's voice. `MOTION_WRITE_PROMPT_VERSION` becomes `motion-write-2026-10-01`. The drift test of the contract (in `write.test.ts`) must still pass; if it pins the line you change, update the pin.
3. **Tests**, first, watching them fail: in `apps/desktop/src/main/graphics-host.test.ts`, in its style (read how it runs the host today): the countdown's pattern is reported once per element class with the message's parts; an entrance and an exit where the exit fills `forwards` is not reported; two animations of different properties are not reported; the exit on a wrapping element is not reported; an `el.animate()` pair is reported; the SVG transform check still works. If the file has a test that runs the host in the real renderer pack when an environment variable is set, add the countdown fragment there too.

## Rules

- Never run the app, `npm run build`, `npm run dist`, a real Claude call; never touch `~/Movies`, `~/Library` or a CapCut draft. (The controller renders with the real pack and calls Claude afterwards.)
- Comments in plain English prose about behaviour, in the voice of the file; no em-dashes in prose you add.
- Nothing else changes. Do not bump `MOTION_VERSION` (no customer has a written graphic yet).
- The gate is `npm test` and `npm run typecheck` from the repo root; it stands at 155 files, 2520 passed, 3 skipped, typecheck clean. Nobody else is changing the repo.

## Report

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented; what you saw fail first; the final counts; the files changed; anything you decided that this brief did not spell out.
