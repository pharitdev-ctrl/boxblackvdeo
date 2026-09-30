# Free-form motion graphics: spike notes (2026-09-30)

The user chose to replace the fixed kit of cards and stickers with motion graphics Claude designs and writes itself,
one bespoke animation per moment. These files are the proof run that came before the spec. They were copied out of a
session scratchpad, which macOS clears; the scripts still name their old scratchpad paths.

## What was proven

1. **The app's offline renderer plays hand-written animation frame for frame.** `spike/host.js` gives HyperFrames
   0.8.65 a timeline that sets `currentTime` on every entry of `document.getAnimations()` (CSS animations and Web
   Animations alike) and calls an optional `window.frame(t)`. A probe moving 1000 px in 6 s was within 1 px of where it
   should be on every frame checked; the output is ProRes 4444 with alpha, as the kit's renders are.
2. **A content security policy holds.** `default-src 'none'` with inline style and script allowed blocks the network
   and changes no pixel. HyperFrames embeds a local font as a `data:` URI, so the policy needs `font-src data:`.
3. **Claude's fragments render first time.** Five fragments for five moments of draft 0917 (`spike/fragments/A–E`),
   written from `spike/contract.md` by separate Claude runs that never saw each other or a sample, all rendered on the
   first try with Thai text intact and no forbidden API in them. Four came from subagents; E came from one real
   `claude -p` call made the way the app calls it.

## Numbers

| What | Measured |
|---|---|
| One `claude -p` call (Opus 5.5, no tools, contract as the system prompt) | 51 s, about 4,900 output tokens |
| Render, 3–4 s graphic at 1080×900, 30 fps, 2 workers | 3–5 s |
| File size | 21–33 MB each, about 8 MB per second |
| Fragment size | 75–113 lines, 5–8 KB |

## Not proven yet

- The files were not laid into a CapCut draft. They have the format of the kit's renders, which CapCut plays.
- How they read over the real video, beside subtitles and highlight text.
- The failure rate over many clips, and what a repair round costs.
- That one clip's graphics keep one look when the moments differ more than these five did.

## Added after the first review (2026-09-30)

- **The renderer hides a broken script.** HyperFrames exits 0 when the page's script has a syntax error or throws, and waits
  20 s for a timeline that never registers. It does print `[Browser:PAGEERROR] <message>` (even with `--quiet`) for a syntax
  error or an uncaught error, and `[Browser:ERROR] <text>` for the page's `console.error`. An error thrown inside a promise
  (as `window.frame` was, in the first host) printed nothing. `spike/host-v2.js` catches it and reports it with
  `console.error("BOXBLACK motion error: …")`, once per distinct message, and still registers the timeline: the broken page
  renders in 2 s instead of 22 s, with its message in the output.
- **What the page can reach.** `spike/adversarial.html` (linter skipped) against `spike/listen.py`:

  | Attempt | Plain Chrome with the CSP | Offline wrapper with the CSP |
  |---|---|---|
  | `fetch`, `new Image().src`, `sendBeacon`, a `<link>` stylesheet, an `<iframe>` | blocked | blocked |
  | a form built in script and submitted | reached the listener until `form-action 'none'` was added; blocked since | blocked |
  | `window.open` | reached the listener | blocked by `--block-new-web-contents` |
  | `location = …` to another machine on the LAN | (not run) | blocked by the dead proxy; the render fails after 21 s |
  | `location = …` to another port on this machine | (not run) | **reaches it**: one GET; the render fails after 21 s |

- **The wrapper works.** HyperFrames takes a shell script as `HYPERFRAMES_BROWSER_PATH` and keeps the flags it adds; a normal
  fragment renders as before under it (`spike/chrome-offline.sh`).
- **Renders are not byte-identical.** Two renders of the same page differ at about 58–68 dB PSNR (one frame as low as 42 dB).
  Compare pictures, not hashes.

## The inspection, run on the spike's renders (2026-09-30)

The bundled ffmpeg reads a render's alpha frame by frame:

```sh
ffmpeg -nostdin -v error -i <mov> -vf "alphaextract,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-" -f null -
```

It prints two lines per frame on standard output, `frame:<n>    pts:<n>    pts_time:<s>` and then
`lavfi.signalstats.YMAX=<0–255>`, and nothing else with `-v error`. `spike/inspect-A.txt` is the whole output for fragment
A's render (96 frames): the first frame is 0 (nothing drawn yet), the middle is 255, the last two are 52 and 0. Fragment F's
render starts at 255 and ends on two frames of 0. A 3.4 s render at 1080×900 takes about 0.35 s to read. A file that is
missing or is no video makes ffmpeg exit non-zero (254 and 183 were seen) with the reason on standard error.

## The repo's own page, rendered (2026-09-30, after Task 1)

`spike/e2e.mts` builds the page with core's `motionHtml` and the app's `host.js`, renders it with the pack through the
offline wrapper, scans the output and inspects the alpha, as the app will. Fragments A and F rendered in 3.4–3.8 s,
visible, and gone at the end. Fragment F under three real palettes (bold-white, bold-black, cute-pink) changed its colours
with no other change: the colour variables work. `spike/sheet.sh` makes a contact sheet of eight frames over grey.

One gap found: a custom palette whose text does not read on its bar (white on white) gives invisible text on a plate,
since `--text` was the palette's text as it is. `motionColours` must give the text that reads on the bar, by the rule the
kit's `graphicColours` used.

## The trial of the final contract: eight real calls (2026-09-30)

`spike/trial-r1/`: eight briefs of different kinds (a number counting up with a gauge, bars compared, a tick list, a
capsule along a drawn path, a timeline of three steps, a price struck out, a warning over a pan, a ring filling to 90 %),
three subjects, each written by one real `claude -p` call (Opus 5.5, no tools, the contract as the system prompt, the brief
in the form `motionBrief` will write).

| What | Measured |
|---|---|
| Passed the strict linter first time | 8 of 8 |
| Rendered, visible, and gone at the end | 8 of 8 |
| One call | 27–39 s, 2,100–4,000 output tokens |
| Fragment | 33–79 lines, 2.5–4.9 KB |
| Render | 3.0–4.4 s, 12–24 MB |
| A code fence around the answer | 0 of 8 |

One of the eight was wrong to the eye and passed every check: in the timeline, three icons sat in the corner of the stage
instead of inside their circles. Each was an SVG `<g>` with a `transform` attribute and a CSS animation of `transform`,
and the animation replaces the attribute. `spike/host-v3.js` looks for exactly that before the first draw and reports it
through `console.error`, so the scan of the renderer's output fails the render with it. It reported the three elements of
that fragment and nothing on the other 13 fragments. One real repair call (20 s, 2,600 output tokens), given the first
brief, those three problems and the fragment (`trial-r1/b-rep5.txt`), returned a corrected fragment that passes everything
and looks right (`trial-r1/5-repaired.html`). The contract now says how to place and animate SVG groups.

So the whole loop has run once for real: write, lint, render, scan, inspect, repair, render again.

## Where the renderer prints what (2026-09-30)

The `[Browser:…]` lines (page errors and the page's console) come on standard output, which `runProcess` keeps whole; the
`[INFO]` and `[WARN]` lines come on standard error, of which `runProcess` keeps the last 64,000 characters. A render whose
`window.frame` threw a different message on every frame printed 124 browser lines (12.5 KB).

## The last frame is drawn one frame before D

A render of `D` seconds at 30 fps has frames at 0, 1/30 … `D − 1/30`. A fade that ends exactly at `D` still shows about a
tenth of itself on the last frame, which the inspection (nothing above 16 of 255 on the last frame) refuses. So the
contract asks for everything to be invisible by 0.1 s before `D`, and the failure says that. The trial's eight fragments
already did (their last frames were 0 to 3).

## Link-local addresses, and where the wrapper's flags go (2026-09-30, after Task 3's review)

Chrome sends loopback and link-local addresses (169.254/16, fe80::/10) direct whatever proxy is set: its implicit bypass
rules. The reviewer of Task 3 read this in Chromium's `net/docs/proxy.md`; `spike/link-local/` proves it and the cure. A
stand-in proxy that writes down what reaches it (`plog.py`) was put in place of the dead one, and a fragment that sets
`location` to `http://169.254.10.10:18934/ll-nav` was rendered (linter skipped):

| Wrapper | What reached the proxy |
|---|---|
| `--proxy-server` alone | nothing: Chrome went for the address itself |
| with `--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]` | `GET http://169.254.10.10:18934/ll-nav` from both workers |

`<-loopback>` takes the implicit rules away, and the three names give back only this machine, where HyperFrames serves
the page (`http://localhost:<port>`). A normal fragment renders under it as before (4 s, no browser lines).

The flags now come after the renderer's own (`exec '<chrome>' "$@" --proxy-server=…`): Chrome takes the last of a
repeated switch, so a later HyperFrames that adds a proxy switch of its own would not win. HyperFrames 0.8.65 passes 67
arguments and none is about a proxy. Both orders were rendered.

What is still open is what it was: a navigation to another port of this machine sends one GET, and the render fails.

## The app's own writing call, for real (2026-09-30, after Task 2)

`spike/smoke-write.mts` makes one real call through the code the app will use: `claudeCliTransport` asked for plain text
(`TEXT_REPLY`), `motionBrief`, `writeMotion`. Three calls, 28–30 s each; all three fragments passed the linter, rendered,
were visible and were gone at the end (last frames 0, 0, 0 under the contract's new "over by 0.1 s before D"). Two were
given small stages, 1080×420 and 1080×400, which is about the room a real frame leaves under a talking head: the layouts
came out compact and the Thai text stayed legible.

## The planning call and the whole chain, for real (2026-09-30, after Task 2's follow-ups)

`spike/smoke-plan.mts` makes one real planning call through `planMotion` and the Claude Code transport, on five points
made by hand from a real project's transcript (real words and times; the cut simplified to its three beats end to end; a
typical talking-head keep-clear band of 0.22–0.58, highlight text at 0.62–0.72 on three points, subtitles from 0.76).
`spike/plan-smoke/` holds the request, the answer, the four briefs and the four fragments.

- The call took 21.7 s and answered four graphics for five points (it left out the one marked extra), none dropped.
- Boxes: where highlight text held the lower band, it took the band above the head (`[0.04, 0.02, 0.96, 0.21]`); where
  there was none, the band between the head and the subtitles (`[0.05, 0.585, 0.95, 0.755]`). It kept off the keep-clear
  band, the text and the subtitles every time. The stages come out at about 996×366 and 972×328.
- `until` worked: each length is the last word's time plus 1 s (2.84, 2.5, 3.56, 3.16 s).
- The ideas are concrete (what is drawn, what moves, which word is the beat of what), 150 to 190 characters.
- `spike/smoke-planned.mts` then wrote all four with `motionBrief` and `writeMotion` (42 to 100 s each with four calls
  at once), and all four passed the linter, rendered, and passed inspection first time. They look right.

Two things the answer showed, now in the planning prompt: a box at the very top sits under the social apps' own menu
(keep the top 0.07 clear), and an idea that names colours (sky blue to navy) fights the style's palette (name none).

## The early live look (2026-09-30, about 20:40 to 21:05)

The built app (Tasks 1 to 6, Task 5's fix round in) on the test profile, project 0917, the real Claude through Claude Code, no draft write. How it was run: `npm run build -w @boxblack/desktop`, then the entry of `live-test-cdp` with `--remote-debugging-port=9333`, driven with `tools/ui.mjs`. To see each call, `tools/claude-logging-passthrough.sh` was put first on `PATH` as `claude`: it saves the arguments, the system prompt and the request, then `exec`s the real Claude Code, so a stop still reaches it (a first version that ran Claude Code as a child made every stop look slow, because the app kills its child with SIGKILL and waits for the pipe to close, and the grandchild kept the pipe open: an artefact of the script, not of the app).

What was seen:

- **With highlight text on, no graphic at all.** At the level "จัดเต็ม" every one of the five points has highlight text. The request told Claude, for each point, the text's band (`[0.04, 0.36]`, `[0.05, 0.5]`, `[0.04, 0.22]` three times), the scene's keep-clear band `[0.22, 0.64]`, and subtitles from 0.76. The only free stretch is 0.64 to 0.76, 0.12 of the height, under the smallest box (0.15). Claude answered `{"graphics": []}` in 11 s, rightly, and the strip read `กราฟิก เสร็จ 0 ชิ้น` with no reason given. This is the finding that needs the user's decision: see the plan's "Room for graphics".
- **With highlight text switched off, three graphics**, all in the one free band above the head (`y` 0.07 to 0.22, a stage of 972×290 px). The plan took 26 s; the three writings ran together, 38 to 44 s each; one fragment had an SVG element with both a `transform` attribute and an animation of it, the host said so, and one repair call (22 s) put it right; all three rendered and passed inspection. The whole graphics work took about 100 s. Contact sheets: `live-look/sheet-*.png` (eight frames each, over grey). They look designed: a countdown in a ring with a small rocket, a helmet travelling along a dashed arc into a rocket with a label, a rocket leaving a smoke trail past a ringed planet.
- **The strip** read `กำลังทำกราฟิก…`, then `กำลังเขียนกราฟิก 0 จาก 3`, `2 จาก 3`, then `กราฟิก เสร็จ 3 ชิ้น`. **The rows** went from `กำลังเขียน…` to `พร้อม` one by one.
- **Redo**: 36 s, the strip `0 จาก 1` then `เสร็จ 1 ชิ้น`, every redo button off meanwhile. The redone row read `พร้อม` throughout (fixed in Task 6's fix round).
- **Stop during a call** (with the `exec` pass-through): the strip read `กราฟิก หยุดแล้ว` at the next look, the Claude Code process was gone, nothing was stored, the rows read `ยังไม่ได้เขียน กดทำใหม่`.
- **Stop as the render check begins** (`tools/stop-on-render.mjs` presses stop the moment the call's process ends): `กราฟิก หยุดแล้ว` within 200 ms, the graphic not stored, the render left to end in the background (its file is kept under its hash).
- **The write sheet** with one written graphic and two not: `กราฟิก 1 ชิ้น`, `กราฟิกเรนเดอร์จบแล้ว 1 จาก 1`, `กราฟิก 2 ชิ้นยังไม่ได้เขียนหรือต้องทำใหม่ จะไม่ถูกใส่`. Closed without writing.
- **Stale**: a change of the cut preset did not make the written graphic stale (the run-on tolerance of 0.3 s). Made stale by changing one word of `spec.words` in the test profile's outline file (the store has no cache: the next read sees it), the row read `การตัดช่วงนี้เปลี่ยนไป กดทำใหม่`, and a redo put it right, with the words now stored again.

Keep-clear bands of the user's own clips (from the test profile's insights, 92 scenes): talking heads run from `[0.22, 0.58]` to `[0.03, 0.9]`. With the subtitle room from 0.76 and the top margin of 0.07, many scenes have no free stretch of 0.15 even with highlight text off, and none has one with highlight text on top.

## The adversarial renders (2026-10-01, Task 9)

`tools/adv.mts` (copied from the scratchpad) renders six fragments whose forbidden names are built from strings, so no linter can see them: a detached anchor clicked with `"hr" + "ef"`, `this["loc" + "ation"]` set, and `this["fe" + "tch"]` with an image, each aimed once at `127.0.0.1` and once at the machine's LAN address, with a listener on `0.0.0.0`. Each is rendered twice: through the app's own renderer (all three gates), and with the linter skipped (the app's page and CSP, the app's own `offlineChrome` wrapper, HyperFrames run as the app runs it).

- **Nothing reached the LAN address**, by any route.
- **Loopback** got the anchor's GET (four: two workers, two renders) and the location's GET (two, only in the render with the linter skipped): the accepted residual, one GET per Chrome worker to another port on this machine.
- **Every such render failed**: the anchor passes the linter and then fails with `the renderer could not draw the page: its script must finish at once, and must not leave, reload or replace the page`; `location` and `fetch` are refused by the linter (`this[` too); with the linter skipped, `fetch` and the image are refused by the CSP (`connect-src 'none'`), the page draws, and nothing gets out.
- No Chrome process was left running.
