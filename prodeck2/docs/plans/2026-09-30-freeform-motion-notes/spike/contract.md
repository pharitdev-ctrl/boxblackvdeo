# Contract for one free-form motion graphic (spike draft)

You write ONE HTML fragment: a `<style>` block, then markup, then (optionally) one `<script>` block. No `<html>`, `<head>`, `<body>`, no external files, no URLs, no comments longer than a line.

**Where it goes.** The fragment is placed inside a transparent stage `W × H` CSS pixels (given below) that is laid over a talking-head video. Pixel (0,0) is the stage's top-left. Nothing may draw outside the stage. The page background is transparent: whatever you do not paint shows the video.

**Time.** The graphic lasts `D` seconds (given). Time 0 is when it appears.
- Animate ONLY with CSS animations (`animation:` with `@keyframes`) and/or the Web Animations API (`el.animate(keyframes, { duration, delay, fill: "both", easing })`). Every animation runs once, with an absolute delay measured from time 0. Use `animation-fill-mode: both`.
- The renderer sets the time of every animation itself, frame by frame, in any order. So: NO `requestAnimationFrame`, NO `setTimeout`/`setInterval`, NO `Date`/`performance.now`, NO `Math.random`, NO transitions triggered by class changes, NO video/audio/canvas games.
- If something must be computed per frame (a number counting up, a point moving along a path), set `window.frame = (t) => { ... }` where `t` is seconds from 0; it must draw the same thing for the same `t`.
- Everything must have entered by the time given for it and the whole graphic must be fully gone (opacity 0) at `D`. Leave at least the last 0.3 s for the way out.

**Words.** You get the spoken words with the time each is said (seconds from 0). Make the key elements land exactly on their words (an element "lands" when its entrance finishes or its main move peaks).

**Look.**
- Text is Thai. The font is already set on the stage (`font-family` inherits, one bold weight; do not name fonts, do not use `font-weight`). Smallest text 44 px. Keep every text inside the stage with at least 40 px of margin. Do not animate Thai text letter by letter.
- It sits on moving video: text needs an opaque shape behind it or a thick dark outline (`-webkit-text-stroke` with `paint-order: stroke fill`). No semi-transparent washes over large areas.
- Colours: use the palette given. Flat shapes, rounded corners, thick strokes; one soft shadow at most.
- Draw pictures with inline SVG (simple, bold shapes). No emoji characters, no images.
- One idea, one focal point at a time; at most about 12 Thai words on screen at once.
- Under 160 lines.

Return only the fragment.
