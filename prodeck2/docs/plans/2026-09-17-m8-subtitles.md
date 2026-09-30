# M8 Subtitles Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "subtitles" option on the timeline screen that writes a CapCut caption track, built from the transcript words kept by the rough cut, with optional AI polishing and per-line editing before the write.

**Architecture:** Pure caption building and a pure draft transform live in `packages/core` (`subtitles/` and `capcut/subtitles.ts`); the polish call follows the planner's LLM pattern. The desktop timeline service previews lines, polishes them (cached), and adds the caption track after `buildRoughCut` using the frame-exact target times of the written video segments. The renderer adds a subtitle section and editable lines to `TimelineScreen`.

**Tech Stack:** TypeScript (Node 26 type stripping), vitest, zod, Electron 44 main/renderer, React 19.

Spec: `docs/specs/2026-09-17-capcut-timeline-manager-design.md` → M8.

---

## Facts from the CapCut 9.4 spike (2026-09-17, draft 0917, restored afterwards)

Importing an .srt in CapCut 9.4 (Text → Local captions) and then ticking "stroke" with "apply to all main captions" produced:

- One track `{ type: "text", flag: 1, attribute: 0, name: "", is_default_name: true }`.
- One `materials.texts` entry per caption: `type: "subtitle"`, all sharing one `group_id` (`import_<ms>`), `add_type: 2`, `check_flag: 15` with stroke (7 without), `border_color: "#000000"`, `border_width: 0.08`, `text_color: "#FFFFFF"`, `font_size: 11`, `text_size: 30`, `alignment: 1`, `line_max_width: 0.82`, `font_path: "/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf"`.
- `content` is a JSON string: `{"styles":[{"fill":{"content":{"solid":{"color":[1,1,1]},"render_type":"solid"}},"range":[0,<utf16 length>],"strokes":[{"width":0.08,"mode":0,"content":{"solid":{"color":[0,0,0]},"render_type":"solid"}}],"size":11,"font":{"path":"…/en.ttf","id":""}}],"text":"…"}`. `range` counts UTF-16 code units.
- One extra material per caption segment: `materials.material_animations` entry `{ id, type: "sticker_animation", animations: [], multi_language_current: "none" }`.
- Segment: `source_timerange: null`, `target_timerange` in µs, `clip.transform: { x: 0, y: -0.8 }`, `render_index: 14000`, `track_render_index: 1`, `enable_lut/enable_adjust: false`, `hdr_settings: null`, `extra_material_refs: [animation id]`.
- CapCut also touched `common_attachment/attachment_id_mapping.json` and `mini_draft.json`; M0 showed CapCut rebuilds those, so the writer leaves them alone.
- Full samples: scratchpad `subtitle-spike/sample.txt`, `capcut-srt-import/`, `capcut-stroke/` (session-local; the templates in Task 3 copy what is needed).

## File structure

- Create `packages/core/src/subtitles/captions.ts` — options, character limits, word joining, `buildCaptions` (pure).
- Create `packages/core/src/subtitles/polish.ts` — prompt, reply schema, `acceptPolished`, `polishSubtitles`.
- Create `packages/core/src/subtitles/index.ts`; add `./subtitles` to `packages/core/package.json` exports.
- Create `packages/core/src/capcut/subtitles.ts` — `addSubtitleTrack` (pure DraftInfo transform) + text templates.
- Modify `packages/core/src/capcut/types.ts` — `Segment.source_timerange: TimeRange | null`.
- Create `apps/desktop/src/main/llm.ts` — shared "which transport and model" resolver (moved out of `planner.ts`).
- Modify `apps/desktop/src/main/settings.ts` — `subtitles` settings.
- Modify `apps/desktop/src/main/timeline.ts`, `timeline-api.ts`, `license-api.ts`, `index.ts`, `shared/api.ts`.
- Create `apps/desktop/src/renderer/src/components/SubtitleSection.tsx`; modify `screens/TimelineScreen.tsx`, `i18n.ts`, `styles.css`, `test/fake-api.ts`.

---

### Task 1: Caption building (core, pure)

**Files:** create `packages/core/src/subtitles/captions.ts`, test `captions.test.ts`.

Interface:

```ts
export const SUBTITLE_LENGTHS = ["short", "line"] as const
export type SubtitleLength = (typeof SUBTITLE_LENGTHS)[number]
export interface SubtitleOptions { enabled: boolean; length: SubtitleLength; polish: boolean }
export const DEFAULT_SUBTITLE_OPTIONS: SubtitleOptions = { enabled: false, length: "line", polish: false }
export function maxCharsFor(length: SubtitleLength, canvas: { width: number; height: number }): number // short 10; line 20 portrait/square, 35 landscape
export function textLength(text: string): number // grapheme clusters (Intl.Segmenter)
export function joinWords(words: string[]): string // Thai+Thai glued; a space where either side is not Thai
export interface Caption { cut: number; startUs: number; endUs: number; text: string } // source µs inside cuts[cut]
export function buildCaptions(args: { cuts: Cut[]; wordsOf: (binId: string) => TimedText[]; maxChars: number }): Caption[]
```

Rules: a word belongs to the cut whose source range holds its midpoint; a new caption starts at a new cut, after a gap ≥ 300 ms between words, or when adding the word would exceed `maxChars` (a lone longer word stays whole); start = first word start clamped to the cut; end = min(cut end, next caption start in the same cut, last word end + 500 ms).

- [x] Tests: grapheme length of Thai with marks; joining Thai/Latin; limits per length/orientation; words outside every cut dropped; breaks at pause, at limit, at cut; hold and no overlap; clamp to cut edges; empty when no words.
- [x] Run, see failures; implement; run green; mutation-check.

### Task 2: Polish (core)

**Files:** create `packages/core/src/subtitles/polish.ts`, test `polish.test.ts`, `index.ts`, package export.

```ts
export const SUBTITLE_POLISH_PROMPT: SystemPrompt // Thai: fix mis-heard/misspelt words from context, keep spoken style, no new content, same number of lines, one line per input line
export const PolishReplySchema: z.ZodType<{ lines: string[] }>
export function acceptPolished(original: string[], polished: string[]): boolean // same count, no empty line, each ≤ max(2×, +10) graphemes of its original
export async function polishSubtitles(args: { transport: LlmTransport; model: string; lines: string[]; prompt?: SystemPrompt; signal?: AbortSignal }): Promise<{ lines: string[]; accepted: boolean }>
```

Content sent: numbered lines (`1. …`). Rejected reply → original lines, `accepted: false`. Empty input → no call.

- [x] Tests with a fake transport: request shape (model, system, numbered content, schema), accepted reply, wrong count / empty line / runaway line rejected, empty input makes no call.
- [x] Implement; green; mutation-check.

### Task 3: Caption track in the draft (core, pure)

**Files:** create `packages/core/src/capcut/subtitles.ts` + test; modify `types.ts`, `index.ts`.

```ts
export interface TimelineCaption { startUs: number; endUs: number; text: string } // output timeline µs
export function addSubtitleTrack(info: DraftInfo, captions: TimelineCaption[], groupId: string): DraftInfo
```

Frame-snaps both edges with the draft fps (`usToFrame`/`frameToUs`), drops captions shorter than one frame or with empty text, ends no later than `info.duration`, appends one `text` track (flag 1) after the existing tracks, one `subtitle` text material + one `material_animations` entry per caption, all with `group_id`. Returns `info` unchanged (a clone) when nothing is left.

- [x] Tests: track/material/segment shapes match the spike facts; UTF-16 `range`; frame snapping and gap-free rounding; clamping to duration; empty text dropped; nothing to add leaves tracks as they were; other tracks and materials untouched.
- [x] Implement; green; mutation-check.

### Task 4: Settings

**Files:** `apps/desktop/src/main/settings.ts` (+ test), `settings-api.ts` (+ test), `shared/api.ts`.

`AppSettings.subtitles: SubtitleOptions`, validated on read (`pick`/`flag`), patchable; `SettingsView.subtitles`.

- [x] Tests: defaults, bad values replaced, patch merges; getSettings exposes it. Implement; green.

### Task 5: Timeline service — preview, polish, write

**Files:** create `apps/desktop/src/main/llm.ts` (+ test, moved from planner), modify `planner.ts`, `timeline.ts` (+ tests), `timeline-api.ts` (+ tests), `license-api.ts` (+ test), `shared/api.ts`, `index.ts`.

```ts
// shared/api.ts
export interface SubtitleLine { beatId: string; startUs: number; endUs: number; text: string } // output µs, before frame snapping
previewSubtitles(folder: string, rules: CutRules, length: SubtitleLength): Promise<SubtitleLine[]>
polishSubtitles(folder: string, lines: string[]): Promise<{ lines: string[]; accepted: boolean }>
writeTimeline(folder: string, rules: CutRules, expectedSegments: number, subtitles: { length: SubtitleLength; texts: string[] } | null): Promise<WriteResult>
// WriteResult gains captionCount
```

- `previewSubtitles`: plan → `buildCaptions` with `maxCharsFor(length, canvas)` (canvas from the draft) → output times from cumulative cut durations → `beatId` from the beat that owns the cut.
- `polishSubtitles`: LLM from settings via `llm.ts`; results cached in `userData/subtitle-polish/<sha256(model, prompt version, lines)>.json`.
- `write`: after `buildRoughCut`, rebuild captions; `texts.length` must equal the caption count (else "the subtitles changed; preview them again"); map each caption to its cut's written video segment (`target.start + (captionStart − cut.sourceStart)`), then `addSubtitleTrack` with group id `boxblack_<ms>`; backup and write as before.
- `LICENSED_METHODS` gains `previewSubtitles`, `polishSubtitles`.

- [x] Tests (fake footage/draft as in existing timeline tests): preview lines and beat ids; polish uses cache on second call and passes model/prompt; write with texts puts a caption track at the written segments' times with edited texts, empty text skipped, count mismatch refused before any backup, `null` subtitles writes video only; API validation of length/texts; gate list.
- [x] Implement; green; mutation-check.

### Task 6: Timeline screen

**Files:** create `components/SubtitleSection.tsx` (+ test), modify `screens/TimelineScreen.tsx` (+ test), `i18n.ts`, `styles.css`, `test/fake-api.ts`.

- Section "ซับ": switch (enabled), length radios (short/line), switch "ให้ AI เกลาคำ", button "ให้ AI เกลาคำ" (shown when polish is on and lines exist; busy state; notice when the reply was rejected). Changes saved with `updateSettings({ subtitles })`.
- When enabled: `previewSubtitles` after the cut preview (same stale-request guard); lines listed under their beat with the output time and an editable text field; changing rules/length reloads lines and drops edits.
- Confirm text mentions the caption count; `writeTimeline(..., enabled ? { length, texts } : null)`; written notice includes captions.

- [x] Tests: toggling saves settings and loads lines; editing a line and writing sends the edited texts; polish replaces texts; rejected polish shows notice; disabled sends `null`; stale lines ignored.
- [x] Implement; green; mutation-check.

### Task 7: Verify for real

- [x] `npm run typecheck`, `npm test`.
- [x] Dry run on 0815 (read-only script): caption lines and timings printed for its stored outline.
- [x] Write on 0917 with subtitles (backup made by the app), open in CapCut 9.4: captions at the right times, one caption group ("apply to all" works), stroke visible; restore 0917 afterwards.
- [x] Polish once through Claude Code on 0917's lines.
- [x] Rebuild `dist:local`; update spec M8 and memory.

## Outcome (2026-09-17)

All tasks done; 536 tests pass, typecheck clean, `dist:local` rebuilt. Changes from the plan, each driven by real footage or a mutation test:

- `maxCharsFor` became `captionLimits(length, canvas) → { maxChars, pauseUs }`: a line waits for a 0.6 s pause (short captions keep 0.3 s), because the 0917 speaker pauses 0.34–0.5 s between phrases.
- Captions are no longer filled word by word: each breath is split into the fewest captions that fit, as even as possible, preferring short pauses (`shareOut`).
- The canvas used for the limit is `outputCanvas` (extracted from `buildRoughCut`), so an "original" ratio draft follows the first clip, the same for preview and write.
- The clamps of caption times to their video segment were dropped: mutation tests showed they never change a frame.
- `polishSubtitles(lines)` takes no folder; `llm.ts` (`chosenLlm`) replaced the planner's private transport choice.
