# Flair: Text Looks (M10.1) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude also decides how each highlight group *looks* — the shape of the block, which word inside it is coloured, and how it leaves the screen — instead of every group being the same stack of lines.

**Design (approved 2026-09-18):** M10 is the "flair" step: one extra Claude call per project, after the highlight text exists, that plans the looks from a catalogue the app has verified in CapCut. M10.1 is the text half of it; sound effects, punch-in zooms and inserted media follow in M10.2–M10.4 and reuse the same call, storage and screen section.

- The user sets a level — น้อย / กลาง / จัดเต็ม — and a per-kind switch, and can override any single decision; overridden items are never rewritten by Claude.
- Claude answers with ids from the catalogue only. Anything it invents is dropped and the group falls back to the plain stack.
- The plan is stored with the outline, keyed by group id and stamped with the transcript fingerprint, like M8.2's keep/cut decisions.

## What the spike settled (0917, CapCut 9.4, 2026-09-18)

Written from `scratchpad/hl/flair-spike.ts`, looked at in CapCut, draft restored afterwards:

1. **Several colours in one line work.** `content.styles[]` may hold more than one style over the same text; each has its own `range: [from, to)`.
2. **`range` counts code points, and Thai marks count as their own index.** "กิ๊ก 50 บาท" with `[5, 7]` coloured exactly "50" — ก ิ ๊ ก ␠ are indexes 0–4. `[0, 999]` is clamped to the line and draws fine.
3. **Every character must be covered by a style.** A line whose styles cover only its first three characters drew the rest at CapCut's own default size — far larger than the styled part, overflowing the frame. Ranges must tile `[0, length)` with no gap.
4. **`background_color` / `background_style` / `background_*` on the text material draw nothing.** CapCut 9.4 keeps the values on re-save but ignores them; its own text background lives under the "บับเบิ้ล" tab as a downloadable resource. The bar behind a line is therefore drawn as a `shapes` rect on a sticker track, the way the user's own 0815 project does it (`shape_type: 4`, `roundness`, `shape_size` in canvas pixels, `custom_points` = the four corners in pixels).
5. **Exit animations are still unknown.** Only "in" resource ids are verified (M9). Task 7 collects "out" ids from the CapCut UI before the exit part ships; until then the only exit is "none".

---

### Task 1: The catalogue and the stored plan

**Files:** create `packages/core/src/flair/catalogue.ts`, `packages/core/src/flair/plan.ts` (+ tests), `packages/core/src/flair/index.ts`.

```ts
// catalogue.ts
export const FLAIR_LEVELS = ["light", "medium", "heavy"] as const
export type FlairLevel = (typeof FLAIR_LEVELS)[number]

export const TEXT_PATTERNS = ["stack", "punch", "bar", "stair"] as const
export type TextPattern = (typeof TEXT_PATTERNS)[number]

export interface PatternEntry {
  id: TextPattern
  /** shown to the user */
  name: string
  /** what it suits, for Claude to choose by */
  mood: string
  /** the lowest level that may use it */
  from: FlairLevel
  /** only groups with this many lines can use it */
  lines: { min: number; max: number }
}
export const TEXT_PATTERNS_BY_ID: Record<TextPattern, PatternEntry>
// stack  from "light",  lines 1–3 — ซ้อนกลาง ใช้ได้ทุกแบบ
// punch  from "medium", lines 1–1 — คำเดียวเต็มจอ
// bar    from "medium", lines 1–3 — แถบสีหลังข้อความ
// stair  from "medium", lines 2–3 — บันไดสลับซ้ายขวา

/** A CapCut "out" text animation. Filled by Task 7; empty until its ids are verified. */
export interface ExitAnimation { id: string; name: string; resourceId: string; from: FlairLevel }
export const EXIT_ANIMATIONS: ExitAnimation[]
```

```ts
// plan.ts
export interface GroupLook {
  pattern: TextPattern
  /** the word to colour, as [from, to) code points inside that line; one accent per group at most */
  accent: { line: number; from: number; to: number } | null
  /** id from EXIT_ANIMATIONS, or null */
  exit: string | null
  /** the user set this by hand: Claude must not overwrite it */
  edited: boolean
}
export interface FlairPlan {
  version: string
  level: FlairLevel
  /** by highlight group id */
  looks: Record<string, GroupLook>
}
export const DEFAULT_LOOK: GroupLook = { pattern: "stack", accent: null, exit: null, edited: false }

/** Everything Claude may not decide: the rules the app enforces after the answer comes back. */
export function enforce(looks: GroupLook[], groups: { lines: string[] }[], level: FlairLevel): GroupLook[]
```

`enforce` — applied to Claude's answer and to anything read back from storage:
- a pattern whose `from` is above the level, or whose `lines` range does not hold the group, becomes `stack`
- an accent whose line does not exist, or whose range is empty, out of order or past the end of the line, becomes `null`
- an exit id that is not in `EXIT_ANIMATIONS`, or whose `from` is above the level, becomes `null`
- the same non-stack pattern on more than three groups in a row: the fourth and any after it become `stack`
- a group marked `edited` is returned untouched

- [x] Tests: each rule above, including that `edited` survives all of them and that an empty catalogue entry list leaves `exit` null.
- [x] Implement; green; mutation-check.

### Task 2: Laying out the patterns

**Files:** `packages/core/src/highlights/layout.ts` (+ test).

`layoutGroup` gains a pattern and returns what the writer needs per line:

```ts
export interface LaidLine { y: number; scale: number; x: number; bar: { width: number; height: number } | null }
export function layoutGroup(
  texts: string[],
  font: HighlightFontId,
  canvas: { width: number; height: number },
  placement: HighlightPlacement,
  pattern: TextPattern = "stack",
): { lines: LaidLine[]; dodge: Dodge }
```

- `stack`: today's behaviour, `x: 0`, `bar: null`.
- `punch`: the height cap per line rises from `MAX_LINE_HEIGHT` 0.13 to `PUNCH_LINE_HEIGHT` 0.2; everything else is the stack.
- `stair`: the width cap per line falls from `MAX_WIDTH` 0.84 to `STAIR_WIDTH` 0.6 and line *i* sits at `x = i % 2 === 0 ? -STAIR_X : STAIR_X` with `STAIR_X = 0.2`; x is in CapCut's transform units (±1 = half the canvas width — **Task 7 confirms this before the numbers are trusted**).
- `bar`: the stack, plus per line `bar = { width: textUnits × LINE_WIDTH_RATIO × scale + 2 × BAR_PAD, height: LINE_WIDTH_RATIO × scale × BAR_TALL }` as shares of the canvas **width** (the same unit `LINE_WIDTH_RATIO` is in), with `BAR_PAD = 0.02` and `BAR_TALL = 1.5`. A bar line's width cap drops to `MAX_WIDTH − 2 × BAR_PAD` so the bar itself stays inside the frame, and its box height counts `BAR_TALL` so stacked bars do not touch.

The placement of the block (M9.1's dodging and shrinking) is unchanged and runs on the heights the pattern produced.

- [x] Tests: punch lets one line grow past the stack cap and stops at 0.2 of the height; stair alternates x and never exceeds 0.6 of the width; bar widths include the padding and bar lines stack without overlapping; a bar group still dodges a keep-clear band; unknown pattern behaves as stack.
- [x] Implement; green; mutation-check.

### Task 3: Writing the looks into CapCut

**Files:** `packages/core/src/capcut/shapes.ts` (create), `packages/core/src/capcut/highlights.ts` (+ tests).

```ts
// shapes.ts — a filled rounded rect on a sticker track, fields copied from the user's 0815 project
export function barMaterial(input: { id: string; color: string; alpha: number; roundness: number; width: number; height: number }): Material
export function barSegment(input: { id: string; materialId: string; target: TimeRange; x: number; y: number; renderIndex: number; trackIndex: number }): Segment
```

`addHighlightTracks` gains the per-group look:
- **Accent:** the line's `content.styles` becomes up to three styles that tile `[0, length)` in code points — base, accent, base — sharing the font and size, differing only in `fill`. One style when there is no accent. (Spike facts 2 and 3.)
- **Bar:** each line with a bar writes a `shapes` material plus a sticker track segment at the line's time range, sized in canvas pixels from the layout's shares, `render_index` below the text's so it sits behind. Bar colours come from the style (Task 4).
- **Exit:** when the look has one, the group's `sticker_animation` gains a second entry `{ type: "out", resource_id, path: "" }` whose duration is `min(0.3 s, half the visible time)` and whose `start` is the visible length minus that duration; the "in" entry is unchanged.

- [x] Tests: an accent writes three tiling styles in code points (Thai marks counted) and the fill differs only inside the range; no accent writes one style covering the whole line; a bar writes a shape material and a sticker segment behind the text with the right size and time; an exit writes a second animation with the clamped duration; a group without either writes exactly what M9 wrote.
- [x] Implement; green; mutation-check.

### Task 4: Bar and accent colours in the style catalogue

**Files:** `packages/core/src/highlights/styles.ts` (+ test).

Every `HighlightStyle` gains `accent: Rgb` and `bar: { fill: Rgb; text: Rgb; roundness: number }`: ตัวหนาขาว → accent เหลือง, bar เหลือง/ตัวดำ · ตัวหนาดำ → accent แดง, bar ขาว/ตัวดำ · ป้ายลดราคา → accent แดง, bar เหลือง/ตัวดำ · น่ารักพาสเทล → accent ชมพูเข้ม, bar ชมพูอ่อน/ตัวขาว · พาดหัวข่าว → accent เหลือง, bar ดำ/ตัวขาว. A bar line uses `bar.text` as its fill and drops the stroke, because the bar already separates it from the picture.

- [x] Tests: every style id has an accent and a bar, and the bar's text contrasts with its fill (luminance apart by at least 0.4).
- [x] Implement; green; mutation-check.

### Task 5: Claude plans the looks

**Files:** create `packages/core/src/flair/direct.ts` (+ test).

```ts
export const FLAIR_PROMPT_VERSION = "flair-2026-09-18"
export const FLAIR_PROMPT: SystemPrompt
export const FlairReplySchema = z.object({
  groups: z.array(z.object({
    group: z.number().int(),          // the group's number in the list given to Claude, from 1
    pattern: z.enum(TEXT_PATTERNS),
    accentLine: z.number().int(),     // 0 = no accent, else the line's number from 1
    accentWord: z.string(),           // copied from that line, "" for none
    exit: z.string(),                 // an id from the catalogue, "" for none
  })),
})
export function acceptFlair(reply: FlairReply, groups: FlairGroup[], level: FlairLevel): { looks: Record<string, GroupLook>; dropped: number }
export function planFlair(input: { transport; model; prompt; brief; groups; level }): Promise<{ looks; dropped }>
```

The prompt gives the brief, the level, the catalogue entries allowed at that level with their moods, and every group with its lines. It asks for a pattern per group, one word inside one line to colour (a number, a price, a name — or none), and an exit animation. `acceptFlair` finds the accent word in the line by the same NFC + "ํา"→"ำ" matching M9's quotes use, turns it into code-point offsets, runs `enforce`, and counts everything it had to drop.

- [x] Tests: a good answer becomes looks keyed by group id; an accent word that is not in the line drops to null and counts as dropped; a pattern above the level falls back to stack; a group Claude skipped keeps the default look; the prompt lists only the entries the level allows and the version is the one exported.
- [x] Implement; green; mutation-check.

### Task 6: Main process and screen

**Files:** `apps/desktop/src/main/flair.ts` (create), `flair-api.ts` (create), `highlight-state.ts`, `highlights.ts`, `timeline.ts`, `settings.ts`, `license-api.ts`, `shared/api.ts`, renderer `components/FlairSection.tsx` (create), `HighlightGroups.tsx`, `screens/TimelineScreen.tsx`, `i18n.ts`, `styles.css`, `test/fake-api.ts` (+ tests).

- `StoredOutline.flair: { version, level, looks, fingerprint }`; a fingerprint that no longer matches drops the looks the same way M9's highlights do.
- Settings gain `flair: { enabled: boolean; level: FlairLevel; text: boolean }`, default `{ enabled: false, level: "medium", text: true }`.
- `createFlairService({ outlines, highlights, footage, llm })` with `view(folder)`, `plan(folder, rules)` (the Claude call, licensed like `pickHighlights`), `setLevel`, `setLook(groupId, look)` — every hand change sets `edited`.
- The highlight preview carries each group's look so the screen and the writer agree; the write asks the service for the looks of the groups it is about to write.
- Screen: a "ลูกเล่น" section above the highlight groups with the switch, the level segmented control, and a "ให้ AI จัดลูกเล่น" button with the same dropped/outline-changed notices M9 has. Each group card gains a pattern select, an exit select and, per line, an accent-word select built from the words of that line.

- [x] Tests: the level gates what the screen offers; a hand change survives a re-plan; the write uses the stored looks; a changed transcript drops the plan; the service refuses without a licence.
- [x] Implement; green; mutation-check.

### Task 7: Verify for real

- [x] typecheck, full tests.
- [x] In CapCut on 0917: add "out" animations to a text segment through the UI, save, read their `resource_id`s out of the draft. Four ids collected; three shipped.
- [x] In CapCut on 0917: confirm the transform x unit (stair), that a bar rect lands behind its line at the computed size, and that punch text keeps inside the frame.
- [x] Live: plan the looks on 0917 through Claude Code, write, and look at the groups in CapCut 9.4.
- [x] `dist:local`; spec entry + memory.

## Outcome (2026-09-18)

Done; 787 tests pass, typecheck clean, `dist:local` rebuilt. Differences from the plan:

- **The bar is a shape, drawn at two thirds of the size asked for.** CapCut 9.4 draws a `shapes` rect **1.5 ×** the `shape_size` and `custom_points` it is given on a portrait 1080-wide canvas (measured: 200 px drew 304, 400 drew 603, 100 drew 148, centres exact), so the writer divides by 1.5. A wide canvas scales by something else again (a 600 × 200 shape drew about 1600 × 385 on 1920 × 1080), so **the bar pattern is portrait and square only** until that is measured; on wide output it is not offered and falls back to the stack.
- **The bar's size limit is the bar's, not the text's.** The first version let the text fill the usual 13 % of the height and made the bar 1.5 × that, which drew a banner over a third of the frame. The line inside a bar is now capped at 13 % ÷ 1.25 and bars stand 1.25 line heights tall, 1.2 of their own height apart, so two stacked bars read as two bars.
- **Exit animations write `start: 0`**, the way CapCut writes them itself; it plays them at the end of the segment. Three ship: เลือนหาย, หมุนหายไป (level กลาง) and แตกกระจาย (จัดเต็ม).
- **No per-kind switch yet.** With only text in M10.1 the switch would have repeated the section's own on/off, so the settings carry `flair: { enabled, level }`. M10.2 adds the per-kind switches with the second kind.
- **No version or fingerprint on the stored looks.** They are keyed by highlight group id, and a group dies with the transcript it was picked from, so a stale look is simply never asked for. Tested.

Checked for real on 0917 (backed up each time; the draft is left holding the M10 write):
- The flair step through Claude Code: 11.7 s, nothing dropped, and it chose a different pattern per group — stack, stair, bar for the countdown, stack — with an accent word on three of them and a fade or spin on the way out.
- In CapCut 9.4: the staggered lines alternate sides above the face, the bar group draws two yellow bars hugging their lines with the countdown in red on the second, and the text on a bar carries no stroke. The exit entries survive CapCut's own re-save and it resolved one to its cached effect file — the animations were not watched frame by frame.
- `range` counting, the missing-style bug and the ignored `background_*` fields are written up in the spec and in [[capcut-text-rendering-facts]].
