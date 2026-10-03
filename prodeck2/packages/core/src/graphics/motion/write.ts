import { TEXT_REPLY } from "../../llm/text-reply.ts"
import type { LlmTransport } from "../../llm/types.ts"
import { TEXT_STAGE_MIN_PX, type MotionWord } from "../plan.ts"

export const MOTION_WRITE_PROMPT_VERSION = "motion-write-2026-10-03-direction"

/**
 * What Claude writes a motion graphic by, as the system prompt of the writing call: the one shape a fragment has,
 * what its script may use, where it is drawn, how it moves in the renderer's time, the words and the colours as
 * variables, and how it should look. It is in English, as the code it asks for is. The linter (lint.ts) enforces
 * what it says under "Shape", "The script" and the timers of "Time", and the two must say the same: write.test.ts
 * holds every tag, attribute and name written out there against the linter, the refused and the offered alike.
 */
export const MOTION_CONTRACT = `# Contract for one free-form motion graphic

You write ONE HTML fragment, in exactly this order: one \`<style>\` block first, then markup, then (optionally) one plain \`<script>\` block as the very last thing. Return only the fragment, with no code fence and no explanation.

**Shape, checked by a linter that refuses anything else.**
- Exactly one \`<style>\` (no attributes) first, then the markup, then at most one \`<script>\` (no attributes); nothing after \`</script>\`.
- The markup is \`<div>\`, \`<span>\` and inline \`<svg>\` with its shapes. No \`<html>\`, \`<head>\`, \`<body>\`, \`<meta>\`, \`<link>\`, \`<base>\`, \`<form>\`, \`<iframe>\`, \`<object>\`, \`<embed>\`, \`<img>\`, \`<video>\`, \`<audio>\`, \`<canvas>\`, \`<template>\`, \`<textarea>\`, \`<noscript>\`, and no \`<title>\` (not inside an SVG either).
- Nothing is loaded: no external files, no URLs, no \`src\` or \`srcset\`, no \`@import\`. \`href="#id"\` (as in \`<use href="#id">\`) and \`url(#id)\` point at a shape in the fragment and are fine.
- No HTML comments (\`<!-- -->\`) and no other \`<!…>\` or \`<?…>\`. A CSS \`/* */\` comment is fine, one line at most.
- Write tags plainly: attribute values in double quotes, with no \`<\` or \`>\` inside a value; a less-than sign in text is \`&lt;\`. Close every \`<svg>\` before the script.
- No inline event handlers (\`onload=\`, \`onclick=\` …): code goes in the script block.
- No SMIL (\`<animate>\`, \`<animateTransform>\`, \`<animateMotion>\`, \`<set>\`): the renderer cannot seek them.

**The script, when there is one.** The linter reads names as text, so a refused name is refused inside a string or a comment too: write no comments in the script.
- This is enough for any graphic: \`document.getElementById\`, \`querySelector\`, \`querySelectorAll\`, \`document.createElementNS\`, \`document.createElement\`, \`setAttribute\`, \`appendChild\`, \`textContent\`, \`style\`, \`el.animate()\`, \`getTotalLength()\`, \`getPointAtLength()\`, \`Math\` (without \`Math.random\`), and \`window.frame\`.
- Nothing that loads, sends, stores, navigates, clicks, or makes code or markup from text: no \`fetch\`, \`import\`, \`eval\`, \`Function\`, workers or \`postMessage\`, storage or cookies, \`navigator\`, \`location\`, \`history\`, \`navigation\`, \`open(\`, \`.click(\`, \`.submit(\`, \`dispatchEvent(\`, assigning \`.src\`, \`.href\` or \`.action\`, \`document.write\`, \`innerHTML\`, \`outerHTML\`, \`insertAdjacentHTML\`, \`DOMParser\`. Build shapes with \`createElementNS\` and \`setAttribute\` (which cannot set \`href\`, \`src\` or an \`on…\` handler: reuse a shape with \`<use href="#id">\` in the markup).
- No \`window[...]\`, \`document[...]\`, \`self[...]\`, \`this[...]\` or \`globalThis\`. You need \`window\` only for \`window.frame\`.
- Do not name a variable or a function \`location\`, \`history\`, \`navigation\`, \`navigator\` or \`open\`: a browser gives these names to the page's window. Say \`spot\`, \`past\`, \`steps\`, \`launch\`.
- No \`\\u\` or \`\\x\` escapes: type the character itself.
- \`T\` is given to you by the page: do not declare anything named \`T\`.
- The script runs once, where it stands, after the markup: set everything up straight away, with no event listeners and no waiting for the page to load.

**Where it goes.** The fragment is placed inside a transparent stage \`W × H\` CSS pixels (given below) laid over a talking-head video. Pixel (0,0) is the stage's top-left. Nothing may draw outside the stage. The page background is transparent: whatever you do not paint shows the video.

**Time.** The graphic lasts \`D\` seconds (given). Time 0 is when it appears.
- Animate ONLY with CSS animations (\`animation:\` with \`@keyframes\`) and/or the Web Animations API (\`el.animate(keyframes, { duration, delay, fill: "both", easing })\`). Every animation runs once, with an absolute delay measured from time 0, and an element's entrance uses \`animation-fill-mode: both\`. When one element has an entrance and an exit (two animations of the same property), the exit uses \`animation-fill-mode: forwards\` (in script \`fill: "forwards"\`), since with \`both\` its first frame applies before it starts and hides the entrance; or put the exit on a wrapping element.
- The renderer sets the time of every animation itself, frame by frame, in any order. So: NO \`requestAnimationFrame\`, NO \`setTimeout\`/\`setInterval\`, NO \`Date\`/\`performance.now\`, NO \`Math.random\`, NO transitions triggered by class changes, NO \`<canvas>\`, video or audio.
- If something must be computed per frame (a number counting up, a point moving along a path), set \`window.frame = (t) => { ... }\` where \`t\` is seconds from 0; it must draw the same thing for the same \`t\`.
- The way out must be over, with the whole graphic fully invisible, by 0.1 s before \`D\` (the last frame drawn is just before \`D\`, and whatever it still shows is cut off hard). Leave about the last 0.4 s for the way out.

**Words are variables.** You get the spoken words with the time each is said. The times are given to the page as CSS variables \`--w1\`, \`--w2\`, … (seconds, unitless, in the order listed) and as the array \`T\` in script (\`T[0]\` is the first word).
- Every delay that depends on a word MUST be written from its variable, never as a typed number: \`animation-delay: calc(var(--w2) * 1s - 0.3s)\`, or \`animation: pop .4s calc(var(--w3) * 1s - .25s) both\`, or in script \`delay: T[1] * 1000 - 300\`.
- An element "lands" on its word when its entrance finishes or its main move peaks at that word's time, so start it a little before.
- Timings that do not depend on a word (the way out near \`D\`, a fixed hold) may be typed numbers.

**Look.**
- When the brief gives the clip's direction (in Thai), match its mood, pace and visual style.
- Text is Thai. The font is already set on the stage (it inherits; one bold weight; do not name fonts, do not use \`font-weight\`). Smallest text 44 px. Keep every text inside the stage with at least 40 px of margin. Do not animate Thai text letter by letter.
- It sits on moving video: text needs an opaque shape behind it or a thick dark outline (\`-webkit-text-stroke\` with \`paint-order: stroke fill\`). No semi-transparent washes over large areas.
- Colours come from variables: \`var(--ink)\` (dark outline and dark shapes), \`var(--paper)\` (white), \`var(--accent)\` (the main accent), \`var(--alt)\` (second colour), \`var(--bar)\` and \`var(--text)\` (a plate and the text that is readable on it). Do not type other colour codes, except a tint made with \`color-mix()\` from these.
- You do not know what the accent, alt, bar and text colours are: they change with the user's style. Only two pairs are sure to read: \`var(--text)\` on a \`var(--bar)\` plate, and \`var(--ink)\` on a \`var(--paper)\` plate. Accent and alt are for shapes, fills and highlights, and for big text only with a thick \`var(--ink)\` outline; never put accent or alt text straight on a bar or a paper plate, and never text-coloured text on paper.
- Draw pictures with inline SVG (simple, bold shapes with \`var(--ink)\` outlines). No emoji characters.
- In SVG, an animation of \`transform\` replaces the element's own \`transform\` attribute, so the element that carries a \`transform\` attribute must not be the one that animates: place with an outer \`<g transform="translate(x y)">\` and animate an inner \`<g>\`. For a shape that scales or turns in place, set \`transform-box: fill-box; transform-origin: center\` on it.
- One idea, one focal point at a time; at most about 12 Thai words on screen at once.
- Under 160 lines.
`

/**
 * The request of the writing call for one graphic: the stage in pixels, how long it lasts, the words said while
 * it plays in the order of their variables (`--w1` is the first) with the time each is said now, what to draw, and
 * what the clip is about. With no words said while it plays, it says so.
 *
 * Three lines may come before what to draw, each only when it applies, so a brief with none of them is the brief
 * of before 0.7.0: what the graphic does with its moment's highlight text (shows in its place, `replaces` being that
 * text, or `pairs` with it shown elsewhere), where the subtitles start over the stage in its own pixels, and, on a
 * stage lower than TEXT_STAGE_MIN_PX, that it holds no text.
 */
export function motionBrief(args: {
  stage: { width: number; height: number }
  seconds: number
  words: MotionWord[]
  idea: string
  about: string
  /** the outline's direction for decorating the clip; absent on outlines from before 0.8.4 */
  direction?: string
  text?: { replaces: string } | { pairs: true }
  /** the stage's own y where the subtitles start, 0 <= px < H */
  captionsFromPx?: number
}): string {
  const words =
    args.words.length === 0
      ? "- Words: none are said while it plays."
      : `- Words, in order, with the time each is said now: ${args.words.map((word, i) => `--w${i + 1} "${word.text}" ${word.atS.toFixed(2)}`).join(" · ")}.`
  return [
    "Brief:",
    `- Stage: W = ${args.stage.width}, H = ${args.stage.height} px.`,
    `- D = ${args.seconds} seconds.`,
    words,
    ...(args.text === undefined
      ? []
      : "replaces" in args.text
        ? [`- Highlight text: this graphic shows in place of the highlight text "${args.text.replaces}", which does not show while it plays. Carry its key words in the graphic, short and exact.`]
        : ["- Highlight text: the highlight text of this moment shows elsewhere on screen. Do not repeat its words."]),
    ...(args.captionsFromPx === undefined ? [] : [`- Subtitles cover the stage from y = ${args.captionsFromPx} px to its bottom, in front of the graphic. Keep every text, number and the focal point above y = ${args.captionsFromPx}.`]),
    ...(args.stage.height < TEXT_STAGE_MIN_PX ? ["- The stage is too small for text: draw shapes only, with no text."] : []),
    `- What to draw: ${args.idea}`,
    `- The clip is about: ${args.about}.`,
    ...(args.direction?.trim() ? [`- The clip's direction: ${args.direction.replace(/\s+/g, " ").trim()}`] : []),
  ].join("\n")
}

/**
 * The request of the one repair a fragment gets: the first brief as it was, since Claude needs the stage, the
 * length and the words to put right a graphic that stays on screen or leaves the stage; then what is wrong with
 * the fragment, one problem to a line; then the fragment. The problems are the linter's or the render's, in
 * English. The same words are used for a fragment the linter refused before any render: "rendered" is near enough.
 */
export function repairBrief(args: { brief: string; html: string; problems: string[] }): string {
  return [
    args.brief,
    "",
    "You wrote the fragment below for this brief. It was rendered, and it has these problems:",
    ...args.problems.map((problem) => `- ${problem}`),
    "",
    "Put right every problem and change nothing else. Return the whole corrected fragment, with no code fence and no explanation.",
    "",
    args.html,
  ].join("\n")
}

/**
 * The request of an edit: the brief for the room the graphic has now, then the change the user asks for, on one
 * line in double quotes (its white space made single spaces), then the fragment to change. A brief that has
 * changed since the fragment was written (a stale graphic's) is one the fragment is fitted to as well.
 */
export function editBrief(args: { brief: string; html: string; instruction: string }): string {
  return [
    args.brief,
    "",
    "You wrote the fragment below for this brief. The user asks for this change:",
    `"${args.instruction.replace(/\s+/g, " ").trim()}"`,
    "",
    "Make that change and keep everything else as it is, unless the brief above has changed (the length, the words and their times, the stage): then fit the fragment to the brief as it is now. Return the whole fragment, with no code fence and no explanation.",
    "",
    args.html,
  ].join("\n")
}

/**
 * The fragment in what Claude answered: the answer with no white space around it, and without the code fence
 * Claude may put around it though told not to. A fence opens with a first line of three backticks, with or
 * without a language; once that is taken off, everything from the last line that is a closing fence (three
 * backticks, with white space around them at most) to the end goes too, so that a remark after the fence does
 * not become words on the screen. An answer that opens with no fence is left as it is: words before a fence are
 * no fence around the answer, and stay for the linter to refuse.
 */
export function fragmentOf(answer: string): string {
  const text = answer.trim()
  const opening = /^```[^\n`]*\n/.exec(text)
  if (opening === null) return text
  const inside = text.slice(opening[0].length)
  const closing = [...inside.matchAll(/^[^\S\n]*```[^\S\n]*$/gm)].at(-1)
  return (closing === undefined ? inside : inside.slice(0, closing.index)).trim()
}

/**
 * Asks Claude to write one graphic, or to put one right: one call, the contract as its system prompt and the
 * brief (`motionBrief`, `editBrief` for an edit, or `repairBrief` for a repair) as its request, answered in plain text. What comes back is
 * the fragment as Claude wrote it, not checked: whoever asked lints it, since a refused fragment goes to a repair.
 */
export async function writeMotion(args: { transport: LlmTransport; model: string; brief: string; signal?: AbortSignal }): Promise<string> {
  const reply = await args.transport.generate({
    model: args.model,
    system: MOTION_CONTRACT,
    content: [{ type: "text", text: args.brief }],
    schema: TEXT_REPLY,
    // as many as the planning call may answer with; the longest fragment of the trials ran to about 4,900
    maxTokens: 16_000,
    signal: args.signal,
  })
  return fragmentOf(reply.output)
}
