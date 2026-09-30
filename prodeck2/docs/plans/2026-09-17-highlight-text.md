# Highlight Text (M9) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Key phrases of what is said appear as big stacked text on the rough cut (the look of the user's own 0815 hook: each line pops in as it is spoken, the group leaves together). Claude picks the phrases and a style; the user edits, removes or adds them on the timeline screen before writing.

**Design (approved with 11 review changes, 2026-09-17):**
1. Fonts are OFL Thai fonts shipped with the app and copied under `~/Movies/CapCut/boxblack/fonts/` (CapCut is sandboxed; `~/Movies` is inside its entitlement). Animations are named by CapCut resource id; the path is filled from CapCut's effect cache when it is there, else left empty for CapCut to download.
2. Claude gets numbered used sentences and answers sentence number + exact quote + display text; the app finds the words itself and drops lines it cannot find.
3. Text size comes from real font advances (generated table) and CapCut's measured size rule; lines are at most 12 graphemes on portrait/square output, 18 on landscape.
4. "Hide subtitles under highlight text" switch, on by default: words inside a shown group are left out of the subtitles.
5. Position top / middle / bottom (above subtitles), chosen in the app, default top.
6. A line's timing comes from its words; its display text is free (Claude may shorten or fix words).
7. A group is on screen at least 1.2 s and its last line at least 1 s; it may run past its beat's end, never into the next group or past the timeline.
8. No automatic Claude call: a button "ให้ AI เลือกข้อความเด่น". Preview only places what is stored.
9. No cache: picking again calls Claude and replaces only AI groups the user has not edited.
10. After outline or cut changes: groups whose words are no longer used are hidden (kept in storage); a line that lost some words starts at its first remaining word and is marked partial; the screen says when the outline changed since Claude picked.
11. Claude picks one style from the catalogue by its mood; the user can change it. Every style has a stroke so text reads on any picture.

**Spike (done before this plan, draft 0917 backed up and restored byte-identical; CapCut effect cache restored):**
- A `type: "text"` material with `content.styles[0].font.path` pointing at a .ttf under `~/Movies` renders in that font; a missing path is rewritten by CapCut to its system font.
- Fill and stroke colours from `content.styles` apply; black fill + white stroke works.
- Animations written as `{ resource_id, name, path: "" }` play; when the effect folder was moved out of CapCut's cache CapCut downloaded it again by id (same hash folder) and it played. An unknown id leaves the text visible without animation. Animations 7664531520492686613 "รวมแบบป๊อปอัป", 7664533258335440148 "ร่วงเร็ว", 7643711191419833618 "ดึงม่านขึ้น" resolve; older ids (7179946712943825410 "สปริง", 7179946605666112001 "เลื่อนขึ้น") did not play.
- Size rule, measured on portrait 1080×1920 and landscape 1920×1080: at `size` 15 and scale 1, one line of height (OS/2 sTypoAscender − sTypoDescender) is 0.087 of the canvas **width**; width = Σ advance / typoLineHeight × 0.087 × size/15 × scale. Predictions matched within 1–2 % for Kanit, Itim, Prompt, Mali, Pridi, Sriracha. Text does not wrap. `transform.y` is the text centre, +1 top … −1 bottom.
- Thai shaping: Kanit, Mali, Chonburi render "ดำน้ำ ที่นี่ ญี่ปุ่น กิ๊ก ฐิติ" correctly; Prompt, Pridi and Sriracha split "ำ" from its consonant. Itim was not clear enough to ship.

**Style catalogue (styles.ts):**

| id | name | font | fill | stroke | animation |
|---|---|---|---|---|---|
| bold-white | ตัวหนาขาว | Kanit ExtraBold | white | black 0.08 | รวมแบบป๊อปอัป |
| bold-black | ตัวหนาดำ | Kanit ExtraBold | black | white 0.06 | รวมแบบป๊อปอัป |
| sale-yellow | เหลืองขายของ | Kanit ExtraBold | #FFE000 | black 0.08 | ร่วงเร็ว |
| cute-pink | น่ารักชมพู | Mali Bold | white | #FF4F99 0.08 | รวมแบบป๊อปอัป |
| headline | พาดหัวคลาสสิก | Chonburi | white | black 0.05 | ดึงม่านขึ้น |

---

### Task 1: Fonts, metrics, styles, layout (core, pure)

**Files:** `apps/desktop/resources/fonts/` (Kanit-ExtraBold.ttf, Mali-Bold.ttf, Chonburi-Regular.ttf, OFL.txt), `packages/core/scripts/font-metrics.ts` (generator), `packages/core/src/highlights/font-metrics.ts` (generated), `styles.ts`, `layout.ts` (+ tests).

```ts
// styles.ts (Node-free; the renderer imports it)
export const HIGHLIGHT_POSITIONS = ["top", "middle", "bottom"] as const
export interface HighlightOptions { enabled: boolean; position: HighlightPosition; hideSubtitles: boolean }
export const DEFAULT_HIGHLIGHT_OPTIONS: HighlightOptions = { enabled: false, position: "top", hideSubtitles: true }
export const HIGHLIGHT_FONTS = { kanit: "Kanit-ExtraBold.ttf", mali: "Mali-Bold.ttf", chonburi: "Chonburi-Regular.ttf" } as const
export const HIGHLIGHT_STYLE_IDS = ["bold-white", "bold-black", "sale-yellow", "cute-pink", "headline"] as const
export interface HighlightStyle { id; name; mood; font: HighlightFontId; fill: Rgb; stroke: Rgb; strokeWidth: number; animation: { resourceId: string; name: string } }
export const HIGHLIGHT_STYLES: Record<HighlightStyleId, HighlightStyle>
export function maxHighlightChars(canvas: { width: number; height: number }): number // 18 landscape, else 12
// layout.ts
export const LINE_WIDTH_RATIO = 0.087
export function textUnits(text: string, font: HighlightFontId): number // Σ advance / typo line height; unknown characters use the font's average Thai consonant
export function layoutGroup(texts: string[], font, canvas, position): { y: number; scale: number }[]
```

Layout: each line fills up to 84 % of the width (`scale = 0.84 / (units × 0.087)`), capped so a line is at most 13 % of the canvas height; line boxes are `2 × 0.087 × scale × W/H × 1.05` tall in y units; the block's top sits at 0.72 (top), is centred on 0.1 (middle) or its bottom sits at −0.52 (bottom), clamped inside ±0.92.

- [x] Generator reads cmap (format 4), hmtx, hhea, OS/2 and writes advances for U+0020–007E and U+0E01–0E5B. Test: Kanit "กขคงจฉชซฌญ" = 6.872 / 1.495 units (fontTools value), Mali 1.3 line height.
- [x] Tests: styles use only verified fonts/animations; max chars by canvas; short line hits the height cap, long line fits 84 %; three positions and clamping; stacked y values do not overlap.
- [x] Implement; green; mutation-check.

### Task 2: Placing and timing groups (core, pure)

**Files:** `packages/core/src/highlights/placement.ts` (+ test).

```ts
export interface HighlightLine { videoId: string; from: number; to: number; text: string } // words [from, to)
export interface HighlightGroup { id: string; source: "ai" | "user"; edited: boolean; lines: HighlightLine[] }
export interface PlacedLine { lineIndex: number; text: string; cut: number; sourceUs: number; partial: boolean }
export interface PlacedGroup { groupId: string; beatId: string; videoId: string; lines: PlacedLine[]; end: { cut: number; sourceUs: number }; words: { from: number; to: number } }
export function placeHighlights(args: { plan: CutPlan; wordsOf: (videoId: string) => TimedText[]; groups: HighlightGroup[] }): PlacedGroup[]
export interface TimedGroup { groupId: string; beatId: string; startUs: number; endUs: number; lines: { lineIndex: number; text: string; startUs: number; partial: boolean }[] }
export function timeHighlights(placed: PlacedGroup[], at: (cut: number, sourceUs: number) => number, timelineEndUs: number): TimedGroup[]
```

A word is kept when its middle falls in a cut of its video. A line shows from its first kept word; lines in another beat than the group's first line, or starting before the previous line, are dropped. `words` covers first kept word … last kept word (for hiding subtitles). Timing: end = max(last word end + 0.2 s, first line + 1.2 s, last line + 1 s), then min(next group start, timeline end); lines starting at or after the end are dropped.

- [x] Tests: whole group placed with cut and source times; partial line; line whose words are cut disappears; group with nothing left disappears; line in another beat dropped; order kept across a cut inside the beat; minimum times; capped by next group and timeline end; groups sorted by time.
- [x] Implement; green; mutation-check.

### Task 3: Claude picks (core)

**Files:** `packages/core/src/highlights/pick.ts`, `manual.ts` (+ tests); `subtitles/captions.ts` exports `shareOut` as `splitWords`.

```ts
export const HIGHLIGHT_PROMPT: SystemPrompt // version "highlights-2026-09-17"
export interface HighlightSentence { videoId: string; beatId: string; beatName: string; from: number; to: number; text: string; timelineUs: number }
export const HighlightReplySchema // { style: enum, groups: [{ lines: [{ sentence: int, quote: string, text: string }] }] }
export function acceptHighlights(args: { sentences; wordsOf; reply; maxChars; newId }): { style; groups: HighlightGroup[]; dropped: number }
export async function pickHighlights(args: { transport; model; brief: Brief; durationUs: number; sentences; wordsOf; maxChars; newId; signal? }): Promise<{ style; groups; dropped; usage }>
// manual.ts
export function groupsFromWords(args: { videoId: string; words: TimedText[]; indexes: number[]; maxChars: number; newId }): HighlightGroup[] // lines of ≤ maxChars, ≤ 3 lines per group
```

Quote matching: NFC, "ํา" → "ำ", whitespace removed, on the sentence's words joined; the line takes every word overlapping the match. A line is dropped when the sentence is unknown, the quote is not found, its text (trimmed, or the words when blank) is longer than `maxChars`, or it is not after the previous line in the same beat. A group keeps at most 3 lines; a group starting before the previous group ends is dropped. `dropped` counts lines.

- [x] Tests: request carries model, prompt, schema, brief, style moods and numbered sentences with times; quote found with spaces/decomposed ำ; each drop rule; overlapping group dropped; style from reply; manual groups split and chunked.
- [x] Implement; green; mutation-check.

### Task 4: Draft writer (core)

**Files:** `packages/core/src/capcut/highlights.ts` (+ test), `capcut/index.ts`.

```ts
export interface TimelineHighlightGroup { endUs: number; lines: { startUs: number; text: string; y: number; scale: number }[] }
export interface HighlightLook { fontPath: string; fill: Rgb; stroke: Rgb; strokeWidth: number; animation: { resourceId: string; name: string; path: string } | null }
export function addHighlightTracks(info: DraftInfo, groups: TimelineHighlightGroup[], look: HighlightLook): DraftInfo
```

One text track per line slot (line 1, 2, 3 of a group), added after existing tracks; `type: "text"` materials with the font path, colours and stroke in `content.styles` and the matching material fields; one `sticker_animation` per segment holding the "in" animation (0.5 s, or half the line's time when shorter); segment scale and `transform.y` from the layout; edges on frames, clamped to the timeline; sub-frame lines left out; input not modified.

- [x] Tests: tracks and segments per slot; material/content/animation shapes as the spike wrote them; frame snapping and clamping; empty input leaves the draft as it was; existing texts kept.
- [x] Implement; green; mutation-check.

### Task 5: Main process

**Files:** `apps/desktop/src/main/highlights.ts`, `highlight-assets.ts`, `timeline.ts`, `timeline-api.ts`, `settings.ts`, `license-api.ts`, `index.ts`, `shared/api.ts`, `electron-builder.cjs` (+ tests).

- Settings `highlights: HighlightOptions`.
- `StoredOutline.highlights?: { style; styleByAi: HighlightStyleId | null; groups: HighlightGroup[]; beatsKey: string | null; transcripts: Record<string, string> }` — kept by outline edits, dropped by planning.
- Timeline service exposes `compiled(folder, rules)` → `{ stored, plan, clips, draft, canvas }`; subtitles and write take `hideUnderHighlights`.
- Highlight service: `preview(folder, rules)`, `pick(folder, rules)`, `setStyle`, `editLine(folder, groupId, lineIndex, text | null)`, `removeGroup`, `addFromWords(folder, videoId, indexes, maxChars)`; groups of a video whose transcript changed are ignored; `outlineChanged` compares the beats key.
- Write: `HighlightRequest { position; hideSubtitles; groupCount }`; the count must match the preview; fonts copied first; animation path from the effect cache; `WriteResult.highlightCount`.
- API: `previewHighlights`, `pickHighlights` (licensed), `setHighlightStyle`, `editHighlightLine`, `removeHighlightGroup`, `addHighlightGroup`; `previewSubtitles(folder, rules, length, hideUnderHighlights)`; `writeTimeline(..., subtitles, highlights)`.
- Packaging: `extraResources` fonts → `fonts/`.

- [x] Tests: settings defaults/validation; preview places stored groups and reports hidden/outline changed; pick stores AI groups, keeps user/edited ones, remembers style; edit/remove/add with bounds checks; hidden subtitles; write adds highlight tracks with installed font path and cached/empty animation path, refuses a changed group count; fonts copied once; API validation; planning drops highlights, edits keep them.
- [x] Implement; green; mutation-check.

### Task 6: Timeline screen

**Files:** `renderer/src/components/HighlightSection.tsx`, `HighlightGroups.tsx`, `CutRows.tsx`, `screens/TimelineScreen.tsx`, `i18n.ts`, `styles.css`, `test/fake-api.ts` (+ tests).

- Section "ข้อความเด่น": switch, position (บน/กลาง/ล่าง), "ซ่อนซับช่วงที่มีข้อความเด่น" (when subtitles are on), style select with "(AI เลือก)", button "ให้ AI เลือกข้อความเด่น" / "ให้ AI เลือกใหม่", busy text, notices (outline changed, dropped lines, hidden groups).
- Under each beat: groups with time, one input per line (saved on blur/Enter), remove line, remove group, "คำบางส่วนถูกตัด".
- Used rows get "เน้น" when highlight text is on.
- Confirm and written messages count highlight groups.

- [x] Tests; implement; green; mutation-check.

### Task 7: Verify

- [x] typecheck, full tests.
- [x] Claude pick on 0917 through Claude Code (script, no draft write) and read the groups.
- [x] Dev app on 0917: pick, edit, write (backup), open in CapCut 9.4: fonts, colours, stacked timing, animation, subtitles hidden under groups; restore 0917 and remove the installed fonts folder if it did not exist before.
- [x] `dist:local`; spec + memory.

## Outcome (2026-09-18)

Done; 688 tests pass, typecheck clean, `dist:local` rebuilt with the fonts in `Contents/Resources/fonts`. Differences from the plan:
- The TTF reader is TypeScript (`packages/core/src/highlights/ttf.ts`, generator `scripts/font-metrics.ts`); a test checks the generated table against the shipped fonts.
- The highlight service lives in `main/highlights.ts` with pure helpers in `main/highlight-state.ts`; `transcriptFingerprint` moved to `main/footage.ts`; timeline tests share `main/timeline-fixture.ts`.
- Claude also sees sentences the user kept against the rules, not only "used" rows.
- The caption splitter no longer lets a lone short word cost nothing, so "ขึ้นไปในอวกาศ / ใน" splits as "ขึ้นไปใน / อวกาศใน" (subtitles and manual highlight lines both).

Checked for real:
- Claude Code picked 4 groups for 0917 in 23.5 s with no dropped lines (hook "นักบินอวกาศ / ขึ้นอวกาศได้ไง", "ไม่ได้ครับ / ไปกับยานอวกาศ", "จะขึ้นไปอวกาศ / สามสองหนึ่ง", "อยู่ในอวกาศแล้ว / สุดยอดไปเลย"); subtitles under them were left out.
- Dev app on 0917: turned highlight text on, edited a line, chose "เหลืองขายของ", wrote with short subtitles. CapCut 9.4 showed yellow Kanit lines with a black stroke stacked at the top as they are said, no subtitle under them, subtitles elsewhere; CapCut re-saved the draft keeping the font path and filling the "ร่วงเร็ว" animation path.
- 0917, its stored outline and settings restored byte-identical; the test backup and `~/Movies/CapCut/boxblack` removed.
