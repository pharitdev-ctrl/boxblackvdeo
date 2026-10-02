# Composed Sound Effects Implementation Plan (0.6.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude decides where the clip gets a sound effect and composes each one as Web Audio code. The app checks the code, renders it offline in a sealed hidden window and sets its loudness, then lays the WAV into the CapCut draft. This replaces Claude's picks of CapCut library sounds. Release 0.6.0.

**Architecture:**
- **Planning.** Work 4 ("sounds") becomes one planning call. It returns a palette for the clip and a list of sounds, each starting at a spoken word or with a graphic.
- **Writing.** One composing call per sound, three at a time. It reuses the 0.5.0 loop: write, lint, render check, one repair.
- **Rendering.** Sounds render in a hidden Electron window that has its own session, no network, no permissions and no preload. ffmpeg (bundled) sets the loudness. Each file is stored as `~/Movies/CapCut/BOXBLACK/sounds/<hash>.wav`.
- **Storage.** Composed sounds live in the outline as `flair.composed`. The old `flair.cues` (CapCut sounds) stay only for what is already there.
- **Behaviour.** Sounds follow the 0.5.1 graphic model: redo, edit by instruction, one-step undo, off, remove. A sound tied to a graphic follows that graphic.

**Tech Stack:** TypeScript on Node 26, Electron 44, React, zod 4, vitest. There is no git: "commit" means `npm test` green and `npm run typecheck` clean from the repo root.

**Spec:** `docs/specs/2026-10-01-composed-sound-design.md` (Thai). The decisions in it are the user's, made on 2026-10-01. **Spike:** `docs/plans/2026-10-01-sound-spike/` (contract, harness, results).

---

## How to run this plan

**Order** (in waves, so that tasks overlap; asked by the user on 2026-10-01). Within a wave, no two implementers own the same file.
- **Task 1** (controller) is done. Its findings are in `docs/plans/2026-10-01-sound-spike/capcut-local-wav.md`.
- **Wave 1:** Task 2, and Task 7a (the core writer and the bin item, which need only Task 1).
- **Wave 2** (after Task 2): Tasks 3, 4 and 6.
  - Task 6 owns `hashOfHtml` (in `composed-cues.ts`) and the new `StoredOutline.flair` fields, so Task 5 imports them from there.
- **Wave 3:** Task 5 (after 3, 4 and 6), and Task 7b (after 4, 6 and 7a: the write wiring and file cleaning).
- **Wave 4:** Task 8 (after 5 and 6).
- **Wave 5:** Task 9 (after 7b and 8).
- **Task 10** is the controller's.
- Each task starts once what it needs is approved.
- An implementer whose tests break because of another task's work in progress waits and runs them again, rather than fixing them.

**Briefs and rules:**
- Implementers get their brief as a file in `docs/plans/2026-09-30-freeform-motion-notes/prompts/` (prefix `r060-`).
- The common rules of 0.5.0 apply:
  - tests first;
  - no app, no build, no real Claude;
  - no `~/Movies`, no `~/Library`, no CapCut draft;
  - comments in plain English prose with no em-dashes;
  - user-facing text in Thai, in `i18n.ts` only;
  - nothing deleted outright (`mv <path> ~/.Trash/<name>-1001`).

**Reviews** read frozen snapshots (`snap.sh`), so the next task may start while a review runs.

**Prompts.** The prompts Claude is given are written in this plan by the controller. Implementers copy them verbatim and do not reword them.

## Files

| File | Responsibility | Task |
|---|---|---|
| `packages/core/src/sound/spec.ts` | `ComposedSound` and its stored-data guards, constants, loudness targets | 2 |
| `packages/core/src/sound/lint.ts` | `lintCompose(code)`: shape and refused names | 2 |
| `packages/core/src/sound/write.ts` | `SOUND_CONTRACT`, `soundBrief`, `soundRepairBrief`, `soundEditBrief`, `composeSound`, `codeOf` | 2 |
| `packages/core/src/sound/harness.ts` | `SOUND_HARNESS` (the page-side render code as a string), `soundProblems(stats)` | 2 |
| `packages/core/src/sound/plan.ts` | `SOUND_PLAN_PROMPT`, `describeSoundClip`, `SoundPlanSchema`, `acceptSoundPlan`, `planComposedSounds` | 3 |
| `apps/desktop/src/main/sound-window.ts` | the sealed hidden window and `runInSealedPage` | 4 |
| `apps/desktop/src/main/sound-render.ts` | render queue, hashing, files, checks, loudness (`createSoundRenderer`) | 4 |
| `apps/desktop/src/main/sound-loudness.ts` | `measureLoudness` / `setLoudness` with the bundled ffmpeg | 4 |
| `apps/desktop/src/main/piece-write.ts` | the write/lint/check/repair loop made generic (`writeChecked`) | 5 |
| `apps/desktop/src/main/sound-work.ts` | work 4: plan, store, compose all, store each | 5 |
| `apps/desktop/src/main/composed-cues.ts` | placement, staleness, level, ties, views | 6 |
| `packages/core/src/capcut/composed-sounds.ts` | the draft writer for local WAVs (shape from Task 1) | 7 |
| `apps/desktop/src/main/sound-actions.ts` | redo, edit, undo and set for sounds; graphic hooks | 8 |
| `apps/desktop/src/renderer/src/edit/SoundTab.tsx`, `edit/ComposedList.tsx` | the sound tab | 9 |

## Names shared across tasks

```ts
// packages/core/src/sound/spec.ts (Task 2)
import type { CueAnchor } from "../flair/plan.ts"
import type { FlairLevel } from "../flair/catalogue.ts"
import type { MotionWord } from "../graphics/plan.ts"

/** The contract and harness a sound's code was composed for; a new one makes every sound stale. */
export const SOUND_VERSION = "sound-2026-10-01"
export const SOUND_CODE_MAX = 20_000            // characters
export const SOUND_SECONDS_MIN = 0.2
export const SOUND_SECONDS_MAX = 6
export const SOUND_ROLE_MAX = 200               // characters
export const SOUND_LOUDNESS = ["soft", "normal", "strong"] as const
export type SoundLoudness = (typeof SOUND_LOUDNESS)[number]
/** integrated loudness each class is set to, LUFS; starting values, tuned in the live test */
export const LOUDNESS_LUFS: Record<SoundLoudness, number> = { soft: -30, normal: -26, strong: -22 }

/** The code a writing replaced, kept for one step back. */
export interface SoundPrevious { code: string; seconds: number; words: MotionWord[]; version: string; graphicHtml?: string; instruction?: string }

export interface ComposedSound {
  /** where it starts: a speech anchor; a sound tied to a graphic has the graphic's anchor */
  anchor: CueAnchor
  /** the graphic it scores; it is switched off, removed, undone and written again with it */
  graphic?: CueAnchor
  /** hashOfHtml of that graphic's fragment when this code was composed */
  graphicHtml?: string
  pointId?: string
  /** the lowest level it plays at */
  from: FlairLevel
  /** what it does, in Thai: the composing brief and the row's text */
  role: string
  loudness: SoundLoudness
  /** its length with its tail, SOUND_SECONDS_MIN..MAX, as composed */
  seconds: number
  /** the words spoken in it, seconds from its start, when composed */
  words: MotionWord[]
  code: string | null
  version: string
  failed?: string
  instruction?: string
  editFailed?: string
  previous?: SoundPrevious
  off: boolean
}
export function isComposed(value: unknown): value is ComposedSound
export function isSoundPrevious(value: unknown): value is SoundPrevious

// packages/core/src/sound/harness.ts (Task 2)
export const SOUND_HARNESS: string                     // defines renderSound(code, cue, seed) in the page
export interface RenderStats { peak: number; rms: number; seconds: number; headPeak: number; tailPeak: number }
export interface RenderedPcm { wav: string /* base64 16-bit stereo 48 kHz WAV, trailing silence over 0.1 s cut */; stats: RenderStats }
export function soundProblems(stats: RenderStats, length: number): string[]   // plain English, for Claude

// packages/core/src/sound/write.ts (Task 2)
export interface SoundToWrite { palette: string; about: string; role: string; seconds: number; words: MotionWord[]; loudness: SoundLoudness; graphic?: { idea: string; html: string } }
export function soundBrief(piece: SoundToWrite): string
export function soundRepairBrief(args: { brief: string; code: string; problems: string[] }): string
export function soundEditBrief(args: { brief: string; code: string; instruction: string }): string
export function composeSound(args: { transport: LlmTransport; model: string; brief: string; signal?: AbortSignal }): Promise<string>
export function codeOf(reply: string): string

// packages/core/src/sound/lint.ts (Task 2)
export function lintCompose(code: string): string[]   // [] = passes

// packages/core/src/sound/plan.ts (Task 3)
export interface SoundClip { about: string; level: FlairLevel; words: { text: string; atUs: number }[]; beats: { name: string; startUs: number }[]; points: { importance: Importance; type: EmphasisType; what: string; atUs: number }[]; lines: { text: string; atUs: number }[]; graphics: { idea: string; html: string; atUs: number; seconds: number }[]; punches: { atUs: number }[]; inserts: { what: string; atUs: number }[] }
export interface PlannedSound { word: number; graphic: number | null; seconds: number; role: string; point: number | null; from: FlairLevel; loudness: SoundLoudness }   // indexes are 0-based into SoundClip's lists
export function planComposedSounds(args: { transport; model; clip: SoundClip; signal? }): Promise<{ palette: string; sounds: PlannedSound[]; dropped: number }>

// apps/desktop/src/main (Tasks 5 to 8)
export function hashOfHtml(html: string): string        // composed-cues.ts (Task 6): sha256 hex, first 16
// StoredOutline.flair gains (Task 6): composed?: ComposedSound[]; palette?: string

// apps/desktop/src/shared/api.ts (Tasks 6 and 8)
export interface ComposedSoundView {
  anchor: CueAnchor; atUs: number; durationUs: number; beatId: string
  role: string; from: FlairLevel; loudness: SoundLoudness
  pointId?: string; graphic: { summary: string } | null
  written: boolean; stale: "cut" | "picture" | null; writeFailed: string | null
  instruction: string | null; editFailed: string | null; canUndo: boolean; off: boolean
  render: "pending" | "ready" | "failed"; error: string | null
}
export interface OwnSoundView { anchor: CueAnchor; atUs: number; name: string }
// HighlightPreview gains: composed: ComposedSoundView[]; ownSounds: OwnSoundView[]
// DesktopApi gains:
//   redoSound(folder, anchor, request): Promise<PostRunView>
//   editSound(folder, anchor, instruction, request): Promise<PostRunView>
//   undoSound(folder, anchor): Promise<void>
//   setSound(folder, anchor, patch: { off: boolean } | null): Promise<void>
// setSoundCue(folder, anchor, effectId) keeps its signature but accepts only effectId null (remove)
```

**Identity.** A composed sound is found by its `anchor` through `samePlace` (`sound-cues.ts`), as a graphic is. Two sounds never share an anchor; the second one is dropped on accept.

---

### Task 1 (controller): How CapCut stores a local WAV

**Files:**
- Create: `docs/plans/2026-10-01-sound-spike/capcut-local-wav.md` (findings)
- Create: `packages/core/src/capcut/fixtures/local-wav/` (synthetic material, segment and bin JSON, with no user data)

- [ ] **Step 1.** Copy `docs/plans/2026-10-01-sound-spike/out/v1-countdown.wav` to `~/Movies/CapCut/BOXBLACK/sounds/spike-countdown.wav` (CapCut can only read under `~/Movies`).
- [ ] **Step 2.** Ask the user to do this by hand, in Thai, one step per line:
  1. In CapCut, make a new project from any short clip.
  2. Import `spike-countdown.wav` from that folder.
  3. Drag it onto the timeline at about 1 s.
  4. Close CapCut with Cmd+Q.
- [ ] **Step 3.** Read that project's `draft_info.json` and `draft_meta_info.json`. This is read-only; it is the user's project. Record the following, quoting the JSON in the findings file:
  - the `materials.audios` entry: `type`, `path`, `music_id`, `local_material_id`, `name`, `duration`, every non-empty field;
  - the extra materials the segment references and their order;
  - the segment;
  - the track;
  - the bin entry (`metetype`, `type`, `file_Path`, `id`, `extra_info`).
- [ ] **Step 4.** Back up 0917 (`r050/draft-backup.mts backup before-060-wav`). Write by code the same material, segment, track and bin entry, pointing at `spike-countdown.wav` at 0:12.6 of 0917. Use new ids, as the CapCut example has them (case and format).
- [ ] **Step 5.** Ask the user to:
  - open 0917;
  - play from 0:12;
  - check that the sound is on its own audio track and plays;
  - export, and say whether a Pro prompt comes up;
  - close with Cmd+Q.
- [ ] **Step 6.** Restore 0917 and check that it is identical. Write the findings and the synthetic fixtures. If CapCut needs something unexpected (for example a copy into its own folder, or a waveform file), stop and bring it to the user before Task 7.

### Task 2: Core: the sound spec, the lint, the contract, the harness

**Files:**
- Create: `packages/core/src/sound/spec.ts`, `spec.test.ts`
- Create: `packages/core/src/sound/lint.ts`, `lint.test.ts`
- Create: `packages/core/src/sound/write.ts`, `write.test.ts`
- Create: `packages/core/src/sound/harness.ts`, `harness.test.ts`
- Modify: `packages/core/package.json` `exports`, so that `@boxblack/core/sound/*` resolves the way `graphics/*` does

- [ ] **Step 1: spec.ts.** Write the constants and types in "Names shared across tasks".
  - `isComposed` checks a stored value field by field:
    - `anchor` is an object with a string `kind`;
    - `role` is a string;
    - `code` is a string or null;
    - `seconds` is a finite number;
    - `words` is an array;
    - `from` is one of `FLAIR_LEVELS`;
    - `loudness` is one of `SOUND_LOUDNESS`;
    - `off` is boolean.
  - `isSoundPrevious` is built like `isPrevious` in `graphics/plan.ts` (string `code`, number `seconds`, array `words`, string `version`; `graphicHtml` and `instruction` are each absent or a string).
  - Tests:
    - each field wrong, one at a time, gives false;
    - a whole sound gives true;
    - a JSON round trip still gives true.
- [ ] **Step 2: lint.ts.** `lintCompose(code)` returns one plain-English problem per rule broken, in the voice of `lintFragment`'s problems.
  - **Shape.** After trimming, the text must:
    - start with `function compose(ctx, cue, kit)` (spaces free);
    - end with the closing brace of that function, with balanced braces outside strings and comments;
    - have nothing before or after;
    - not be empty, and be at most `SOUND_CODE_MAX`.
  - **Refused names**, matched as whole words outside strings and comments. Lift the regex style of `motion/lint.ts` `RULES`:
    - network: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `RTCPeerConnection` and any `RTC\w+`;
    - other threads and channels: `Worker`, `SharedWorker`, `ServiceWorker`, `postMessage`, `BroadcastChannel`, `MessageChannel`;
    - loading or making code: `import`, `importScripts`, `eval`, `Function`;
    - the page and the browser: `document`, `window`, `self`, `globalThis`, `top`, `parent`, `frames`, `location`, `navigator`, `history`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `open`;
    - time: `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`, `Date`, `performance`;
    - audio outside the given context: `AudioContext`, `webkitAudioContext`, `OfflineAudioContext`, `decodeAudioData`, `createMediaElementSource`, `createMediaStreamSource`, `createMediaStreamDestination`, `audioWorklet`, `AudioWorkletNode`;
    - promises: `async`, `await`, `Promise`, `.then(`;
    - `\u` and `\x` escapes anywhere.
  - Tests:
    - every spike output in `docs/plans/2026-10-01-sound-spike/out/v1-*.js` passes (read them as fixtures);
    - one failing case per rule;
    - a refused name inside a string or a comment passes;
    - a second top-level statement fails.
- [ ] **Step 3: write.ts.** Copy `SOUND_CONTRACT` verbatim from the block below, and keep `SOUND_WRITE_PROMPT_VERSION = "sound-write-2026-10-01"`.
  - **`soundBrief(piece)`** joins these with `\n`, as the spike's `write.mjs` did:
    - `The clip: ${about}`, blank line;
    - `The palette of the clip:`, the palette, blank line;
    - `This sound: ${role}`;
    - `It lasts ${seconds} s, its tail included.`;
    - `Loudness: ${loudness}.`;
    - `Words: ${words.map(w => `${w.text} at ${w.atS} s`).join(", ")}.` (or `Words: none.`);
    - when `graphic` is given: blank line, `It scores this graphic, shown at the same time: ${idea}. Its HTML fragment follows; its CSS animations and Web Animations give the times things happen in the picture; land your hits on what is seen:`, blank line, the html.
  - **`soundRepairBrief`** has the shape of `repairBrief`, with "function" in place of "fragment":
    - the brief, blank line;
    - `You wrote the function below for this brief. It was rendered, and it has these problems:`;
    - `- problem` lines, blank line;
    - `Put right every problem and change nothing else. Return the whole corrected function, with no code fence and no explanation.`, blank line;
    - the code.
  - **`soundEditBrief`** has the shape of `editBrief`:
    - `You wrote the function below for this brief. The user asks for this change:`;
    - the quoted instruction (white space made single, trimmed);
    - `Make that change and keep everything else as it is, unless the brief above has changed (the length, the words and their times, the graphic): then fit the sound to the brief as it is now. Return the whole function, with no code fence and no explanation.`
  - **`composeSound`** is `writeMotion` with `system: SOUND_CONTRACT`, `maxTokens: 12_000`, and `codeOf` (fences stripped, as `fragmentOf` does).
  - Tests: each brief's exact text, `codeOf` with and without a fence, and that `composeSound` sends the contract and returns the code (fake transport).

```text
SOUND_CONTRACT:
You are the sound designer of a short vertical video (TikTok, Reels). For one moment of it you compose a short musical sound effect, the way a composer scores a stinger for a cartoon or a game show, and you write it as JavaScript that builds the sound with the Web Audio API. The app renders your code offline and lays the sound under the video at that moment.

Write exactly one function and nothing else: no code fence, no comments outside it, no explanation.

function compose(ctx, cue, kit) { ... }

What you are given:
- ctx is an OfflineAudioContext: 2 channels, 48000 Hz, cue.length seconds long. Build every node on it and connect what should be heard to ctx.destination. Schedule everything at absolute times in seconds from 0. Do not call startRendering; the app does.
- cue.length: the seconds the sound lasts, its tail included.
- cue.words: [{ text, atS }]: when each spoken word starts, in seconds from 0.
- kit.rand(): a seeded random number in [0, 1) (Math.random is the same generator).
- kit.noise(seconds): a mono AudioBuffer of white noise.
- kit.reverb(seconds, decay): a ConvolverNode with a generated room tail; decay 1 to 8, larger dies faster.
- kit.note(name): the frequency in Hz of a note such as "C4", "F#5", "Bb3".

Rules:
- Any Web Audio node and any AudioParam automation, on ctx. AudioBufferSourceNode only on buffers you make (kit.noise, or ctx.createBuffer filled by your code). No network, no files, no page or browser objects, no timers, no promises, no other audio context: the function returns when everything is scheduled.
- Start and end every voice cleanly: ramp gains up from near 0 and back down (exponential ramps go to 0.0001, never 0), stop sources after their envelope ends. The first and the last 5 ms must be near silent. No clicks.
- Keep the peak under about 0.8; the app sets the loudness afterwards from the loudness you are given (soft, normal, strong), so shape the sound's character for it rather than its level.
- A person is speaking. Keep the sound out of the voice's way: while a word is spoken, keep 300 to 3000 Hz light or make the sound short and percussive; let it bloom in the gaps.
- It is a sound effect, not a song: hits, stingers, short motifs, risers, sweeps, whooshes, chimes, plucks, mallets, drum and percussion hits, made musical by pitch, rhythm and harmony. Make each voice rich: layer detuned oscillators, shape with filters and envelopes, add a little reverb or a short delay, use noise for air and attack. It should sound designed and polished, not like a bare test tone.
- Follow the palette of the clip (key, instruments, character, motif) so every sound of the clip sounds like one score.
- Land each hit exactly on the time it belongs to: a hit on a word at that word's atS; a hit on something in the picture at the time that thing happens.
```

- [ ] **Step 4: harness.ts.** `SOUND_HARNESS` is the spike's `harness.js` as a string, with these changes:
  - It returns `{ wav, stats }`, where `stats` = `{ peak, rms, seconds, headPeak, tailPeak }`:
    - `headPeak` is the peak of the first 5 ms;
    - `tailPeak` is the peak of the last 5 ms of the trimmed sound.
  - It cuts trailing silence. The WAV ends 0.1 s after the last sample above 0.001, and is never shorter than 0.05 s.
  - It scales nothing. The peak is reported, and samples are clamped to ±1 when encoded.
  - `seed` comes from the caller.

  `soundProblems(stats, length)` returns these problems, in plain English:
  - `peak < 0.01` → "the sound is silent: nothing above 1% of full scale";
  - `peak > 4` → "the sound is far too loud before levelling (peak N): a gain has run away";
  - `headPeak > 0.05` → "the sound starts with a click: the first 5 ms reach N";
  - `tailPeak > 0.05` → "the sound ends with a click: the last 5 ms reach N";
  - `stats.seconds > length + 0.01` → "the sound runs past its length".

  Tests: `soundProblems` on each case. The harness string must parse as JavaScript (`new Function` on it in the test only).
- [ ] **Step 5.** Run `npm test` and `npm run typecheck`.

### Task 3: Core: the sound plan

**Files:**
- Create: `packages/core/src/sound/plan.ts`, `plan.test.ts`

- [ ] **Step 1: the prompt.** Copy `SOUND_PLAN_PROMPT` verbatim from the block below, with `SOUND_PLAN_PROMPT_VERSION = "sound-plan-2026-10-01"`.
- [ ] **Step 2: `describeSoundClip(clip)`.** Build the user content. It has these lines, in this order:
  - `The clip: ${about}`
  - `Level: ${level}`
  - `Words:`, then one line per word, `${i+1}. ${clock(atUs)} ${text}`, using `clock` from `flair/direct.ts`.
  - `Beats:`, then `- ${clock} ${name}`.
  - `Emphasis points:`, then `${i+1}. ${clock} [${importance} ${type}] ${what}`.
  - `Highlight text lines:`, then `- ${clock} ${text}`.
  - `Graphics:`, then for each: `${i+1}. ${clock}, ${seconds} s: ${idea}`, followed by its HTML in a block opened by the line `<fragment>` and closed by `</fragment>`.
  - `Zoom punches:`, then `- ${clock}`.
  - `Cutaways:`, then `- ${clock} ${what}`.

  An empty list says `none`. Test: the exact text of a small clip.
- [ ] **Step 3: the schema and `acceptSoundPlan`.**
  - `SoundPlanSchema = z.object({ palette: z.string(), sounds: z.array(z.object({ word: z.number().int(), graphic: z.number().int().nullable(), seconds: z.number(), role: z.string(), point: z.number().int().nullable(), from: z.enum(FLAIR_LEVELS), loudness: z.enum(SOUND_LOUDNESS) })) })`. Numbers in the reply are 1-based, as in `planSounds`.
  - `acceptSoundPlan(reply, clip)` maps them to 0-based and handles each case:
    - a `word` out of range drops the sound;
    - a `graphic` out of range drops the sound;
    - a `graphic` given makes `word` the graphic's first word, found by `atUs`;
    - `seconds` is clamped to `[SOUND_SECONDS_MIN, SOUND_SECONDS_MAX]`;
    - `role` is trimmed and cut to `SOUND_ROLE_MAX` (an empty `role` drops the sound);
    - a `point` out of range becomes null;
    - a second sound on the same word and the same graphic (or both none) is dropped;
    - the palette is trimmed and cut to 2,000 characters, at the last whole line that fits (changed in review, 2026-10-01). An empty palette fails the reply with `the sound plan has no palette`;
    - two sounds that resolve to the same word are duplicates, whether or not they score a graphic, because they would share an anchor. The answered word is checked only for a sound with no graphic. A graphic's first word is found with a 1 ms tolerance. The fragments in the request share a budget of 80,000 characters (all changed in review);
    - every drop is counted in `dropped`.

  Tests cover each case.
- [ ] **Step 4: `planComposedSounds`.**
  - It makes one `transport.generate` call with `system: SOUND_PLAN_PROMPT`, the described clip, `schema: SoundPlanSchema`, `maxTokens: 16_000` and `signal`.
  - It makes no call when `clip.words` is empty, and returns `{ palette: "", sounds: [], dropped: 0 }`.
  - Tests use a fake transport.
- [ ] **Step 5.** Run `npm test` and `npm run typecheck`.

```text
SOUND_PLAN_PROMPT:
You are the sound designer of a short vertical video. You decide where it gets a sound effect and what each one does, and you set the clip's sound palette so all of them sound like one score. Another call then composes each sound as code from what you write here.

You are given the clip as it plays after the rough cut: every spoken word with its number and its time, the beats, the emphasis points with their importance, the highlight text lines, the graphics with their idea and the HTML that draws them, the zoom punches, the cutaways, and the level of decoration the user chose.

Answer with:
- palette: at most eight short lines in English: the key; the tempo feel; the instruments, as synthesised sounds a Web Audio programmer can build (for example bright square-wave plucks, soft sine bells, marimba-like mallets, filtered noise whooshes, a punchy synth kick, brass-like sawtooth stabs); the character; one short recurring motif as note names; what to avoid.
- sounds, in time order. For each:
  - word: the number of the spoken word it starts on;
  - graphic: the number of the graphic it scores, or null; a sound that scores a graphic starts with it;
  - seconds: how long it lasts with its tail, 0.2 to 6;
  - role: one sentence in Thai saying what it does, concrete enough to compose from: what it sounds like, and which words or moments in the picture it hits;
  - point: the number of the emphasis point it serves, or null;
  - from: the lowest level it plays at: "light", "medium" or "heavy";
  - loudness: "soft", "normal" or "strong".

How to choose:
- Score the clip, not every word. A sound earns its place when it makes a moment land: a reveal, a punchline, a turn, a count, a list, a question, something appearing or moving on screen, a change of beat that needs a lift. Silence is part of the score.
- light is only the moments that matter most; medium adds the clear supporting ones; heavy scores the clip richly. Give every sound the lowest level it should play at, so one answer serves all three levels. Plan for the level the user chose at least as fully as the level asks.
- A graphic whose motion has hits (things appearing, counting, landing) gets a sound that follows its motion.
- Two sounds overlap only when they are meant to be heard together.
- Use the palette everywhere, and bring the motif back at the moments that tie the clip together, such as the question and its answer, or the start and the end.
```

### Task 4: Main: the sealed window, the renderer, the loudness

**Files:**
- Create: `apps/desktop/src/main/sound-window.ts`, `sound-window.test.ts`
- Create: `apps/desktop/src/main/sound-render.ts`, `sound-render.test.ts`
- Create: `apps/desktop/src/main/sound-loudness.ts`, `sound-loudness.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (window lifecycle, wiring), `packages/core/src/media/tool-check.ts` (`ebur128` in `REQUIRED_FILTERS`)

- [ ] **Step 1: `sound-window.ts`.** `createSealedPage(electron)` returns `{ run(js: string, timeoutMs: number): Promise<unknown>; close(): void }`. `electron` is injected as `{ BrowserWindow, session }`, so tests pass fakes.
  - Session: `session.fromPartition("boxblack-sound")` (no `persist:`).
    - `webRequest.onBeforeRequest((details, cb) => cb({ cancel: details.url !== "about:blank" }))`.
    - `setPermissionRequestHandler((_wc, _p, cb) => cb(false))` and `setPermissionCheckHandler(() => false)`.
  - Window: `new BrowserWindow({ show: false, webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } })`, with no `preload`.
    - `setWindowOpenHandler(() => ({ action: "deny" }))`.
    - `on("will-navigate", e => e.preventDefault())`.
    - `on("will-redirect", e => e.preventDefault())`.
    - `loadURL("about:blank")` once.
  - `run`:
    - calls `webContents.executeJavaScript(js, true)`;
    - races a timer of `timeoutMs`;
    - on timeout it destroys the window (ending a runaway loop) and rejects with `the sound took longer than ${s} s to render`.
  - The window is made on the first `run` and closed after 30 s idle.
  - Tests with fakes:
    - the options;
    - each handler's answer;
    - the timeout destroys the window and rejects;
    - a second `run` after a destroy makes a new window.
- [ ] **Step 2: `index.ts`.** Keep the main window in a `mainWindow` variable.
  - `send()` sends to that window only.
  - `activate` makes a new main window when `mainWindow` is null or destroyed, not when the window count is 0.
  - `window-all-closed` is unchanged.
  - The sealed page is closed in `before-quit`.
  - Test: wherever the existing tests cover the event sending; if none do, add a small test of `send` through an extracted `sendTo(windowRef, event)`.
- [ ] **Step 3: `sound-loudness.ts`.**
  - `measureLoudness(ffmpeg, wavPath)` runs `ffmpeg -nostdin -hide_banner -i <wav> -af ebur128=framelog=quiet -f null -` and parses the last `I: <n> LUFS`. It returns `{ lufs: number | null; peak: number }`; `lufs` is null when it reports −70 or below (too short to gate).
  - `setLoudness(ffmpeg, inPath, outPath, target)` writes `pcm_s16le` 48 kHz stereo with `-af volume=<gain>dB`.
    - `gain` = `target − lufs` when `lufs` is known.
    - Otherwise `gain` brings the peak to −6 dBFS.
    - `gain` never brings the peak above −1 dBFS.
  - Tests use a fake process runner (the existing `runProcess` injection pattern) with captured ffmpeg output.
- [ ] **Step 4: `sound-render.ts`.** `createSoundRenderer(deps)`, where `deps` = `{ dir, ffmpeg, page: SealedPage, writeFile, rename, exists, mkdir }`.
  - **`hashOf(job)`** = sha256 of `[code, seconds, words.map(w => w.atS), loudness, SOUND_VERSION]`, first 16 hex.
  - **`check(job)`**, used by the write loop:
    1. Lint the code.
    2. Run `SOUND_HARNESS + "\nrenderSound(" + JSON.stringify(code) + ", " + JSON.stringify({ length: seconds, words }) + ", " + seed + ")"` in the page, with a 20 s timeout. The seed is the first 8 hex digits of the hash, parsed.
    3. Return `soundProblems(stats, seconds)`, or the render error as one problem.
    4. When there are no problems, write the raw WAV to a temp file in `dir`, set its loudness to `LOUDNESS_LUFS[loudness]` into `<hash>.wav.tmp`, and rename it to `<hash>.wav`.
    5. Return `[]`.
    6. A fault of the machine (no ffmpeg, page cannot start) is an `EnvironmentError`, as in `graphics-render.ts`, and the check returns `null` ("cannot render here"). The writing is then accepted on the lint alone, as graphics are.
  - **`ensure(jobs)`** renders, one at a time, the files of jobs whose `<hash>.wav` is missing, in the background.
  - **`statusOf(job)`** returns `"ready"` (file there), `"failed"` (with the reason kept until `forgetFailures`), or `"pending"`.
  - **`fileOf(job)`** returns the path.
  - **`idle()`.**
  - **`hashOfHtml`** is not this task's: Task 6 owns it in `composed-cues.ts`.
  - Tests use fake page, fake ffmpeg and fake fs:
    - a clean job writes `<hash>.wav` through `.tmp`;
    - each problem fails the job;
    - the timeout fails it;
    - `ensure` skips existing files;
    - the hash ignores `role` and `from`.
- [ ] **Step 5: `tool-check.ts`.** Add `ebur128` to `REQUIRED_FILTERS`, with its test.
- [ ] **Step 6.** Run `npm test` and `npm run typecheck`.

### Task 5: Main: the write loop made generic, and work 4

**Files:**
- Create: `apps/desktop/src/main/piece-write.ts`, `piece-write.test.ts`
- Modify: `apps/desktop/src/main/motion-write.ts` (becomes a wrapper; its tests stay unchanged and green)
- Create: `apps/desktop/src/main/sound-work.ts`, `sound-work.test.ts`
- Modify: `apps/desktop/src/main/flair.ts` (`planSounds` delegates to `sound-work.ts`), `post-plan.ts` (work 4 progress). `StoredOutline.flair.composed` and `palette` come from Task 6; import `hashOfHtml` from `composed-cues.ts`.

- [ ] **Step 1: `piece-write.ts`.**
  - **Signature:** `writeChecked(deps: { first: string; call(request: string): Promise<string>; lint(text: string): string[]; check(text: string): Promise<string[] | null>; repair(args: { brief: string; text: string; problems: string[] }): string; signal?: AbortSignal }): Promise<{ text: string } | { failed: string }>`.
  - **Behaviour:** exactly `writePiece`'s, with the same stop handling (`unlessStopped`), `PROBLEMS_KEPT`, and the same repair carrying `first`.
  - **`motion-write.ts`:** `writePiece` becomes a call of `writeChecked`, with `motionBrief`, `writeMotion`, `lintFragment`, `deps.render` and `repairBrief` adapted, and `{ text } → { html }`. `writeAll` stays where it is.
  - **Tests:** the existing `motion-write.test.ts` passes unchanged. New tests of `writeChecked` cover the paths of `writePiece` with a toy lint.
- [ ] **Step 2: building the clip (`sound-work.ts`).** `soundClipOf(...)` turns what work 4 already gathers in `flair.ts` `planSounds` (lines about 672 to 714) into a `SoundClip`:
  - **Words:** every kept word on the cut, with its rough-cut time.
  - **Points:** the placed points with their `atUs`, at every importance.
  - **Lines:** from the timed groups.
  - **Graphics:** from `graphicsInForce` at `"heavy"`, with the written and fresh ones only.
  - **Also:** the punches, the inserts and the beats.
  - **`about`:** from `aboutOf(stored)`.
  - **`level`:** the request's level.
  - **Test:** a small outline gives the expected clip.
- [ ] **Step 3: work 4 (`runSoundWork(folder, request, signal, progress)`).**
  1. It builds the clip and calls `planComposedSounds`.
  2. In **one update of the latest outline**, it sets the following and keeps `flair.cues` with `edited: true`:
     - `flair.palette` is the new palette.
     - `flair.composed` is the new sounds, each with `code: null`.
     - `version` is `SOUND_VERSION`.
     - `seconds` is the planned length.
     - `words` holds the words inside `[start, start + seconds)`, seconds from its start.
     - `graphic` and `graphicHtml` are set for a tied sound (`hashOfHtml(spec.html)`).
     - `pointId` is set from the point index.
     - `off` is false.
     - The previous `flair.composed` and every `flair.cues` entry with `edited: false` are dropped.
  3. It reports progress `(0, n)`.
  4. It composes each sound with `writeAll` (3 at a time) through `writeChecked`:
     - the first brief is `soundBrief` (with the graphic's idea and html for a tied sound);
     - `call` is `composeSound`;
     - `lint` is `lintCompose`;
     - `check` is `renderer.check`;
     - `repair` is `soundRepairBrief`.
  5. It stores each sound in its own update by `samePlace`, following the rules of graphics (`afterWriting`):
     - written sets `code`, `version`, `seconds` and `words`, and removes `failed`, `instruction` and `editFailed`;
     - failed sets `code: null` and `failed`;
     - a sound gone meanwhile is not resurrected.
  6. A stop rejects, as graphics do. With no Claude connection it fails with `composing sounds is not ready: no Claude connection`.
  7. Tests use a fake transport, a fake renderer and the real `OutlineStore` in a temp dir. They cover:
     - a plan of three sounds written;
     - one failed after its repair;
     - a stop mid-way keeps what was written;
     - old AI CapCut cues go and the user's stay;
     - a tied sound carries the graphic's hash;
     - an empty clip makes no call.
- [ ] **Step 4: `post-plan.ts`.** Work 4 calls `runSoundWork`. Its progress feeds the strip as graphics' does (`กำลังแต่งเสียง n จาก m` in Task 9). Test the progress events through the run.
- [ ] **Step 5.** Move the old core `flair/sound-plan.ts` and its test to the Trash, and `soundSlotsFor` with its tests. Then remove every import the compiler flags. Keep:
  - `slotsFor`, `cuesInForce`, `samePlace` and the writer for `flair.cues`;
  - the sound library, needed to write the user's own CapCut sounds.
- [ ] **Step 6.** Run `npm test` and `npm run typecheck`.

### Task 6: Main: placement, staleness, level, views

**Files:**
- Create: `apps/desktop/src/main/composed-cues.ts`, `composed-cues.test.ts`
- Modify: `apps/desktop/src/main/highlights.ts` (preview gains `composed`, `ownSounds`; the old `sounds`, `slots` and `unusedSounds` stay only for what the screen still needs), `apps/desktop/src/shared/api.ts` (the view types, `HighlightPreview` fields, and `StoredOutline.flair.composed?: ComposedSound[]` with `palette?: string`), `apps/desktop/src/main/emphasis.ts` (`placedOnPoints`, `withoutPoint`), `planner.ts` and `legacy-beats.ts` (beats renamed or removed: do for `flair.composed` what is done for `flair.graphics`)

- [ ] **Step 0: `hashOfHtml(html)`** goes in `composed-cues.ts`: sha256 hex of the fragment, first 16 characters. Test it.
- [ ] **Step 1: `composedInForce(...)`.** Mirror `graphicsInForce`. Each stored sound (`isComposed`; anything else is left out) is:
  - placed by `itemPlaceOf(placeOf)`. A tied sound is placed where its graphic is, so with no graphic placed it is unplaced.
  - **Stale** (`"cut"`) when:
    - its words now differ in text or count;
    - it plays more than 0.1 s shorter than `seconds`. Its room is the time to the end of its piece's sentence, plus the graphic's run-on rule for a tied sound;
    - or `version !== SOUND_VERSION`.
  - **Stale** (`"picture"`) when its graphic's `hashOfHtml` differs from `graphicHtml`.
  - **Off** when it is off, or when its graphic is off.
  - **Shown** at the level when `passesLevel`-style `from <= level` holds and the `pointId` filter passes.

  It returns `PlacedComposed { sound; atUs; durationUs; stale; wordsNow }`. Tests cover every rule.
- [ ] **Step 2: views.**
  - `composedViews(...)` → `ComposedSoundView[]`, with:
    - `written` = code not null;
    - `writeFailed` = `failed` or null;
    - `render` = the renderer's status for fresh written ones;
    - the text fields only when they are strings, as `textOrNull` does.
  - `ownSounds` = the user's `flair.cues` with `edited: true`, placed with their names.
  - `HighlightPreview` gains `composed` and `ownSounds`. The emphasis banner counts AI composed sounds with `pointId` (`placedOnPoints`).
  - Tests go in `highlights.test.ts`.
- [ ] **Step 3: points and beats.**
  - `withoutPoint` drops composed sounds with that `pointId`.
  - The places that rename or drop beats on speech anchors of `flair.graphics` do the same on `flair.composed`.

  Each gets a test.
- [ ] **Step 4.** Run `npm test` and `npm run typecheck`.

### Task 7: Core and main: writing into CapCut, and cleaning the files

Task 7 is split in two:
- **Task 7a** is Steps 1 and 2, in core only. It runs in wave 1.
- **Task 7b** is Steps 3 and 4, in main. It runs in wave 3.

**Files:**
- 7a, create: `packages/core/src/capcut/composed-sounds.ts` and `composed-sounds.test.ts`, with the shape from `docs/plans/2026-10-01-sound-spike/capcut-local-wav.md` and the fixtures in `packages/core/src/capcut/fixtures/local-wav/`.
- 7a, modify: `packages/core/src/capcut/bin.ts`. It gains an audio bin item, and prunes `sounds/` as it prunes `graphics/`.
- 7b, modify:
  - `apps/desktop/src/main/timeline.ts`: lay composed sounds, add their bin items and counts;
  - `apps/desktop/src/main/graphics-files.ts`: clean `<hash>.wav` in the sounds folder too;
  - `apps/desktop/src/shared/api.ts`: the `WriteResult` counts.

- [ ] **Step 1: `addComposedSoundTrack(info, sounds: { atUs; durationUs; path; binId }[])`.** It writes exactly the material, extra materials, segment and track that Task 1 recorded, with these choices:
  - lanes: first free lane, as `addSoundTrack` does;
  - volume 1.0;
  - no 1.5 s cap.

  The material type is the one CapCut used, which must not be `sound`. Tests compare against Task 1's fixtures field by field.
- [ ] **Step 2: bin.** Add a bin item builder for a WAV from Task 1's fixture. `pruneBinItems` also prunes `BOXBLACK/sounds/` entries not laid now. Spare media and `binVideos` must not list WAVs (test).
- [ ] **Step 3: `timeline.ts`.**
  - Lay every placed, written, fresh, ready, not-off sound shown at the level, before `sounds` (the CapCut cues).
  - The write waits for pending renders, as it does for graphics (`ensure`, then wait).
  - `WriteResult` gains `composedCount` and `composedLeftOut: { unwritten, stale, failed }`.

  Tests cover the laying, the waiting and the counts.
- [ ] **Step 4: files.** `cleanGraphicFiles` also cleans `<hash>.wav` in the sounds folder that no draft or backup names (`GRAPHIC_NAMED` gains the WAV pattern). `graphicFilesInfo` counts both. Test.
- [ ] **Step 5.** Run `npm test` and `npm run typecheck`.

### Task 8: Main: redo, edit, undo, off and remove; sounds follow graphics; the api

**Files:**
- Create: `apps/desktop/src/main/sound-actions.ts`, `sound-actions.test.ts`
- Modify: `apps/desktop/src/main/flair.ts` (graphic hooks), `post-plan.ts` (runs; refuse while running; the `undoing` mark covers sounds), `highlight-api.ts`, `license-api.ts`, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/renderer/test/fake-api.ts`

- [ ] **Step 1: `redoSound` and `editSound`.** They are shaped like `redoGraphic` and `editGraphic`.
  - Each finds the sound among the stored ones by `samePlace`, playing or off, and writes it for the room it has now (length, words, and the graphic's current html for a tied sound).
  - The stored result follows `afterWriting` / `afterEdit`, with `previous` kept (`SoundPrevious`, `graphicHtml` included).
  - Error messages:
    - no place now → `this sound has no place on the clip now`;
    - edit of an unwritten sound → `this sound has not been written yet`.
  - `forgetMachine` on the sound renderer comes first.

  Tests cover every branch, as `flair-plan.test.ts` does for graphics.
- [ ] **Step 2: `undoSound`.** It swaps with `previous` in one update, as `steppedBack` does (`graphicHtml` swaps too). It fails with `this sound has nothing to go back to` when `isSoundPrevious` fails. It is refused while a run goes, sharing `refuseWhileRunning` and `undoing`. Tests.
- [ ] **Step 3: `setSound(anchor, { off } | null)`.** It switches a sound off or on, or removes it. It is not a run. Tests.
- [ ] **Step 4: graphic hooks (`flair.ts`).**
  - **After `editGraphic` or `redoGraphic` stores a written graphic,** the same run rewrites every composed sound tied to it (`graphic` samePlace), one at a time, as `redoSound` would. Progress runs on the `"sounds"` work: the run's works become `["graphics", "sounds"]`. A failed graphic writing touches no sound.
  - **`undoGraphic`:** each tied sound whose `previous.graphicHtml` equals the hash of the graphic's fragment after the undo is swapped too, in the same outline update.
  - **`setGraphic(null)`** (remove) removes the tied sounds. Off needs nothing, since the view derives it.
  - **Rethinking graphics** (planGraphics) removes the sounds tied to graphics that are gone.

  Each hook has a test.
- [ ] **Step 5: api.**
  - `redoSound`, `editSound`, `undoSound` and `setSound` go in `DesktopApi`, `API_METHODS` and `highlight-api.ts`:
    - the anchor is checked as for graphics;
    - the instruction goes through `instructionOf`;
    - the patch is `{ off: boolean }` or null.
  - `redoSound` and `editSound` go in `LICENSED_METHODS` with its pinned list.
  - `setSoundCue` refuses a non-null `effectId`.
  - `fake-api.ts` gains the four methods.

  Tests.
- [ ] **Step 6.** Run `npm test` and `npm run typecheck`.

### Task 9: Renderer: the sound tab

**Files:**
- Create: `apps/desktop/src/renderer/src/edit/ComposedList.tsx`
- Modify: `edit/SoundTab.tsx`, `edit/FlairTab.tsx` (`SoundList` goes; `EditField` is exported for reuse), `room/ClipRoom.tsx` (`redoSound`, `editSound`, `undoSound` through `rewrite` and `beginEdit`/`endEdit`), `edit/postTabs.ts` (`MAIN_WORDS`), `edit/PlanStrip.tsx` (sounds progress line), `edit/WriteButton.tsx` (sheet counts), `i18n.ts`, `styles/edit.css`
- Test: `screens/PostScreen.test.tsx`, `room/ClipRoom.test.tsx`, `edit/postTabs.test.ts`

- [ ] **Step 1: texts.** Add these keys to `i18n.ts`:

  | Key | Text |
  |---|---|
  | `sounds.composed` | `เสียงที่ AI แต่ง` |
  | `sounds.own` | `เสียงที่คุณเลือกเอง` |
  | `sounds.none` | `ยังไม่มีเสียง กด AI คิดใหม่: เสียง` |
  | `sounds.state.writing` | `กำลังแต่ง…` |
  | `sounds.state.editing` | `กำลังแก้…` |
  | `sounds.state.unwritten` | `ยังไม่ได้แต่ง` |
  | `sounds.state.ready` | `พร้อม` |
  | `sounds.state.pending` | `กำลังเรนเดอร์…` |
  | `sounds.state.failed` | `แต่งไม่สำเร็จ` |
  | `sounds.state.renderFailed` | `เรนเดอร์ไม่สำเร็จ` |
  | `sounds.state.staleCut` | `การตัดช่วงนี้เปลี่ยนไป กดแก้หรือทำใหม่` |
  | `sounds.state.stalePicture` | `ภาพเปลี่ยน กดทำใหม่` |
  | `sounds.state.off` | `ปิดอยู่` |
  | `sounds.from.light` | `เล่นตั้งแต่ระดับเบา` |
  | `sounds.from.medium` | `เล่นตั้งแต่ระดับกลาง` |
  | `sounds.from.heavy` | `เล่นเฉพาะจัดเต็ม` |
  | `sounds.ofGraphic` | `ตามกราฟิก: {summary}` |
  | `sounds.redo` / `redoLabel` | `ทำใหม่` / `ทำเสียงนี้ใหม่: {role}` |
  | `sounds.edit` / `editLabel` | `แก้` / `แก้เสียง: {role}` |
  | `sounds.undo` / `undoLabel` | `ย้อน` / `ย้อนเสียง: {role}` |
  | `sounds.off` / `on` / `offLabel` / `onLabel` | `ปิด` / `เปิด` / `ปิดเสียง: {role}` / `เปิดเสียง: {role}` |
  | `sounds.remove` / `removeLabel` | `ลบ` / `ลบเสียง: {role}` |
  | `sounds.ownRemoveLabel` | `ลบเสียง {name}` |
  | `sounds.editField` | `จะให้ AI แก้เสียงนี้อย่างไร` |
  | `sounds.editHint` | `เช่น เบาลง สั้นลง หรือให้ตึงกว่านี้` |
  | `sounds.refused.noPlace` | `เสียงนี้ไม่มีที่บนคลิปแล้ว` |
  | `sounds.refused.notWritten` | `เสียงนี้ยังไม่ได้แต่ง กดทำใหม่ก่อน` |
  | `sounds.refused.nothingBack` | `ไม่มีเสียงก่อนหน้าให้ย้อน` |
  | `plan.composing` | `กำลังแต่งเสียง {done} จาก {total}` |
  | `write.composed` | `เสียงที่แต่ง {count} เสียง` |
  | `write.composedLeftOut` | `เว้นไว้ {count} เสียง ({why})` |

  Map the three refusals in `MAIN_WORDS`.
- [ ] **Step 2: the room.** `redoSound` and `editSound` go through `rewrite` with a mark `{ anchor, how, of: "sound" }`. Graphic and sound marks are kept and released alike. `undoSound` and `setSound` go through `beginEdit`/`endEdit` with the quiet read.
- [ ] **Step 3: `ComposedList`.** Rows are sorted by time and use `ItemRow`. Each row shows, in order:
  - the role (two lines, the whole in `title`);
  - the last edit line;
  - `sounds.ofGraphic` or `FromPoint`;
  - the `from` line (`hint`);
  - the state;
  - the edit-failed line;
  - the length.

  The buttons are ทำใหม่ · แก้ (written) · ย้อน (`canUndo`) · ปิด/เปิด · ลบ, held as the graphics rows are. The edit field is `EditField` with the sound texts. Below the list comes the "own" list: time · name · remove (`setSoundCue(anchor, null)`).
- [ ] **Step 4: `SoundTab`.** The switch, the banner, `ComposedList`. The old slot rows and select go.
- [ ] **Step 5: strip and sheet.** The plan strip shows `plan.composing` for the sounds work. The write sheet shows `write.composed`, and `write.composedLeftOut` when anything is left out.
- [ ] **Step 6: tests.**
  - the rows and their buttons for written, unwritten, failed, stale (both kinds), tied, off and own sounds;
  - edit, undo and refusals in Thai;
  - the marks;
  - the strip line;
  - the sheet line.
- [ ] **Step 7.** Run `npm test` and `npm run typecheck`.

### Task 10 (controller): Version, checks, the live test, docs

- [ ] Set `apps/desktop/package.json` version to `0.6.0` with the Edit tool.
- [ ] Run mutation checks on:
  - the lint rules;
  - `soundProblems`;
  - `acceptSoundPlan`;
  - the stores (written, failed, edit, undo);
  - staleness and level;
  - the tie hooks;
  - the writer's fields;
  - the api checks;
  - the rows.
- [ ] **Escape check.** Run code that skips the lint in the sealed page from the built app, on the test profile, with a listener on this machine. It tries:
  - `fetch` and an `img` to the LAN and to loopback;
  - a `WebSocket`;
  - `window.open`;
  - `location`;
  - a navigation;
  - `navigator.permissions`;
  - a `boxblack-media://` fetch.

  Nothing may arrive, and nothing may open.
- [ ] Run `npm run dist -w @boxblack/desktop`, then check:
  - the version;
  - that `Resources/graphics` holds `host.js` alone;
  - that ffmpeg has `ebur128`.
- [ ] **Live test** on the test profile with the real Claude, on 0917:
  - plan the whole clip at each level;
  - an edit ("เบาลง");
  - an undo;
  - a graphic redo with its tied sound following;
  - a stop during composing.

  Then back up 0917 and write it. Ask the user to open it in CapCut, listen and export, then close with Cmd+Q. Restore 0917 and check it is identical.
- [ ] Update the docs and memory:
  - add the main spec's `0.6.0` entry;
  - update this spec's status line;
  - record the spike README's answers to its open questions;
  - write memory.
