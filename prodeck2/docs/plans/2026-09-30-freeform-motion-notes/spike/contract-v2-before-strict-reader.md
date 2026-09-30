# Contract for one free-form motion graphic

You write ONE HTML fragment, in exactly this order: one `<style>` block first, then markup, then (optionally) one plain `<script>` block as the very last thing. Return only the fragment, with no code fence and no explanation.

**Shape, checked by a linter that refuses anything else.**
- Exactly one `<style>` (no attributes) and at most one `<script>` (no attributes), nothing after `</script>`.
- No `<html>`, `<head>`, `<body>`, `<meta>`, `<link>`, `<base>`, `<form>`, `<iframe>`, `<img>`, `<video>`, `<audio>`, `<canvas>`, `<template>`; no external files, no URLs (`url(#id)` inside SVG is fine), no `@import`.
- No HTML comments (`<!-- -->`); CSS and JS comments are fine, one line at most.
- No inline event handlers (`onload=`, `onclick=` …): code goes in the script block.
- No SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`): the renderer cannot seek them.
- In the script: no network, no navigation, no storage, no workers, no `eval`; do not declare a variable named `T` (the page gives it to you); building elements with `document.createElement` / `createElementNS` and `el.animate()` is fine.

**Where it goes.** The fragment is placed inside a transparent stage `W × H` CSS pixels (given below) laid over a talking-head video. Pixel (0,0) is the stage's top-left. Nothing may draw outside the stage. The page background is transparent: whatever you do not paint shows the video.

**Time.** The graphic lasts `D` seconds (given). Time 0 is when it appears.
- Animate ONLY with CSS animations (`animation:` with `@keyframes`) and/or the Web Animations API (`el.animate(keyframes, { duration, delay, fill: "both", easing })`). Every animation runs once, with an absolute delay measured from time 0, and `animation-fill-mode: both`.
- The renderer sets the time of every animation itself, frame by frame, in any order. So: NO `requestAnimationFrame`, NO `setTimeout`/`setInterval`, NO `Date`/`performance.now`, NO `Math.random`, NO transitions triggered by class changes, NO `<canvas>`, video or audio.
- If something must be computed per frame (a number counting up, a point moving along a path), set `window.frame = (t) => { ... }` where `t` is seconds from 0; it must draw the same thing for the same `t`.
- The whole graphic must be fully invisible at `D`. Leave at least the last 0.3 s for the way out.

**Words are variables.** You get the spoken words with the time each is said. The times are given to the page as CSS variables `--w1`, `--w2`, … (seconds, unitless, in the order listed) and as the array `T` in script (`T[0]` is the first word).
- Every delay that depends on a word MUST be written from its variable, never as a typed number: `animation-delay: calc(var(--w2) * 1s - 0.3s)`, or `animation: pop .4s calc(var(--w3) * 1s - .25s) both`, or in script `delay: T[1] * 1000 - 300`.
- An element "lands" on its word when its entrance finishes or its main move peaks at that word's time, so start it a little before.
- Timings that do not depend on a word (the way out near `D`, a fixed hold) may be typed numbers.

**Look.**
- Text is Thai. The font is already set on the stage (it inherits; one bold weight; do not name fonts, do not use `font-weight`). Smallest text 44 px. Keep every text inside the stage with at least 40 px of margin. Do not animate Thai text letter by letter.
- It sits on moving video: text needs an opaque shape behind it or a thick dark outline (`-webkit-text-stroke` with `paint-order: stroke fill`). No semi-transparent washes over large areas.
- Colours come from variables: `var(--ink)` (dark outline and dark shapes), `var(--paper)` (white), `var(--accent)` (the main accent), `var(--alt)` (second colour), `var(--bar)` and `var(--text)` (a plate and the text that is readable on it). Do not type other colour codes, except a tint made with `color-mix()` from these.
- Draw pictures with inline SVG (simple, bold shapes with `var(--ink)` outlines). No emoji characters.
- One idea, one focal point at a time; at most about 12 Thai words on screen at once.
- Under 160 lines.
