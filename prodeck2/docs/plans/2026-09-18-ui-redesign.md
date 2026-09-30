# UI Redesign (M11) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour with `scratchpad/mutate.py`). Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/specs/2026-09-18-ui-redesign-design.md`.

**Goal:** Replace the five-step sidebar app with a three-stage app (เตรียม → โครงเรื่อง → ตัดต่อ) whose editing room is two columns — beats on the left, the chosen beat's content in four tabs on the right — with clip-wide settings in a sheet, a user-chosen light/dark appearance, and a renderer built from small, reusable pieces.

**Architecture:** Renderer-only rework in `apps/desktop/src/renderer`, done in five milestones that each leave the app runnable. The main process changes in two places only: every flair view (`slots`, `cues`, `zooms`, `pieces`, `inserts`) carries the `beatId` it belongs to, and settings gain `appearance`. Everything the screens show already comes from the existing `RendererApi`; the new `edit/byBeat.ts` regroups the flat preview by beat.

**Tech Stack:** React 19, TypeScript, vitest 5 + @testing-library (jsdom), electron-vite. No new dependencies (drag-and-drop uses the HTML5 API).

**Visual reference:** the approved mockups are served by the session harness at `http://localhost:5179/demo.html` (`scratchpad/ui-harness/public/look-1.html`, `look-2c.html`); the harness runs the real renderer with `test/fake-api.ts` and must keep working after every milestone (update its imports when files move).

---

## M11.1 · Foundation: main-process changes, tokens, ui primitives, shell

### Task 1: `beatId` on every flair view

**Files:** `packages/core/src/flair/direct.ts` (`CueSlot`, `ZoomSlot`), `apps/desktop/src/main/sound-cues.ts` (`slotsFor`), `apps/desktop/src/main/zoom-cues.ts` (`zoomSlotsFor`), `apps/desktop/src/main/highlights.ts` (`soundView`, `zoomView`, `insertView`), `apps/desktop/src/shared/api.ts` (`CueView`, `ZoomView`, `InsertView`, `HighlightPreview.slots`, `.pieces`), `apps/desktop/src/renderer/test/fake-api.ts`.

```ts
// core/flair/direct.ts — both slot kinds say which beat they sit in
export interface CueSlot { anchor: CueAnchor; atUs: number; what: string; beatId: string }
export interface ZoomSlot { anchor: PieceAnchor; atUs: number; durationUs: number; what: string; beatId: string }
```

`slotsFor`: a highlight slot takes `group.beatId`; a cut slot takes `beatOf[index]`; a beat-edge slot takes `beat.beatId`. `zoomSlotsFor`: `beatOf[index]`. The three views copy `beatId` from the slot they were built from (`byAnchor.get(...)!.beatId`), and the flat `slots`/`pieces` lists pass it through. The prompt text is untouched (it prints `what` by number).

- [x] Tests (main): `sound-cues.test.ts` — each slot kind carries the right beat; `zoom-cues.test.ts` — a piece carries its beat; `highlights.test.ts` — `slots`, `cues`, `pieces`, `zooms`, `inserts` in the preview all carry `beatId`.
- [x] Implement; typecheck (the fake api and the desktop tests will need `beatId` added); green; mutation-check (`beatOf[index]` → `beatOf[0]`, `group.beatId` → `""`).

### Task 2: `appearance` setting

**Files:** `apps/desktop/src/shared/api.ts`, `apps/desktop/src/main/settings.ts`, `apps/desktop/src/main/settings-api.ts`, `apps/desktop/src/main/index.ts`.

```ts
// shared/api.ts
export const APPEARANCES = ["system", "light", "dark"] as const
export type Appearance = (typeof APPEARANCES)[number]
// SettingsPatch gains `appearance?: Appearance`; SettingsView gains `appearance: Appearance`

// main/settings.ts — AppSettings gains `appearance: Appearance` (default "system"); read() normalises with
// pick(raw.appearance, APPEARANCES, "system"); update() merges `appearance: patch.appearance ?? current.appearance`

// main/settings-api.ts — createSettingsApi gains `applied?: (settings: AppSettings) => void`, called after every update
// main/index.ts — applied: (s) => { nativeTheme.themeSource = s.appearance }, and the same once at startup
```

- [x] Tests (main): `settings.test.ts` — defaults to `system`; an unknown stored value falls back; a patch persists; a patch without it keeps it. `settings-api.test.ts` — `updateSettings` calls `applied` with the settings after the change.
- [x] Implement; green; mutation-check.

### Task 3: Tokens, theme, and the `ui/` primitives

**Files:** create `apps/desktop/src/renderer/src/styles/tokens.css`, `base.css`; `src/theme.ts` (+ test); `src/ui/Button.tsx`, `Segmented.tsx`, `Switch.tsx`, `Select.tsx`, `Field.tsx`, `Tabs.tsx`, `Sheet.tsx`, `Popover.tsx`, `Toast.tsx`, `Progress.tsx`, `Empty.tsx` (+ tests); `src/main.tsx` imports `styles/tokens.css` and `styles/base.css` before `styles.css` (the old file shrinks task by task and is deleted in Task 18).

Tokens (light on `:root`; dark under `:root[data-theme="dark"]` and under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`), the palette from the mockups: `--bg --surface --surface-2 --line --line-strong --text --sub --muted --accent --accent-soft --ok --ok-soft --warn --warn-soft --danger --danger-soft --hl --hl-soft --zoom --zoom-soft --ins --ins-soft --beat-1..--beat-6 --shadow --radius (8px) --radius-lg (12px)`. Base: 14px body, `-apple-system … Thonburi`, `user-select: none`, `-webkit-app-region` rules.

```ts
// theme.ts
export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void
// "system" removes data-theme; "light"/"dark" set it
```

Primitives (props only, no API knowledge):

```ts
Button:    { variant?: "default" | "primary" | "ghost" | "ai"; size?: "md" | "sm" | "xs" } & ButtonHTMLAttributes
Segmented: <T extends string>{ label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void; disabled? }
           // role="radiogroup" of visually hidden native radios, so arrow keys work natively
Switch:    { label: string; checked: boolean; onChange(checked: boolean): void; disabled?; hint? }  // <input type="checkbox" role="switch">
Select:    { label?: string; value: string; onChange(v: string): void; disabled?; children }        // native <select>
Field:     { label: string; hint?: string; children }
Tabs:      { label: string; value: string; tabs: { id: string; label: string; count?: number; disabled?: boolean }[]; onChange(id): void }
           // role="tablist"; ← → move focus and select; a disabled tab is still focusable and announces "ปิดอยู่"
Sheet:     { open: boolean; title: string; onClose(): void; children; footer? }  // role="dialog" aria-modal; Esc and backdrop close
Popover:   { open: boolean; label: string; onClose(): void; children }          // absolutely positioned inside the caller's relative box; Esc and outside pointerdown close
Toast:     { message: string; action?: { label: string; onClick(): void }; onDone(): void; ms?: number (default 6000) }
Progress:  { value: number | null; label: string }   // null = indeterminate
Empty:     { title: string; hint?: string; action?: ReactNode }
```

- [x] Tests: `theme.test.ts` (attribute set/removed); `Segmented.test.tsx` (click and arrow keys change value); `Switch.test.tsx` (role switch, toggles, disabled does nothing); `Tabs.test.tsx` (click, arrow keys, disabled tab announces); `Sheet.test.tsx` (Esc closes, backdrop closes, content click does not); `Popover.test.tsx` (Esc closes, outside pointerdown closes, inside does not); `Toast.test.tsx` (onDone after `ms`, action click).
- [x] Implement; green; mutation-check the key handling and the close conditions.

### Task 4: The shell

**Files:** create `src/shell/AppShell.tsx`, `StageChips.tsx`, `AlertBar.tsx`, `BackupMenu.tsx` (+ tests); modify `src/App.tsx`; delete `src/components/BackupList.tsx` after `BackupMenu` absorbs it.

```ts
export type Stage = "prepare" | "outline" | "edit"
export interface Alert { id: string; tone: "info" | "warn" | "danger"; text: string; detail?: string; action?: { label: string; onClick(): void } }

AppShell: {
  title: string                                   // project name, or the app name on the projects screen
  stage: Stage | null                             // null on the projects screen and in settings
  reachable: Record<Stage, boolean>               // which chips may be clicked
  onStage(stage: Stage): void
  onBack?: { label: string; onClick(): void }
  alerts: Alert[]
  toolbar?: ReactNode                             // the stage's own buttons, right side
  backups?: { api: Pick<DesktopApi, "listBackups" | "restoreBackup">; folder: string; capcutRunning: boolean | null; refreshKey: number; onRestored(): void }
  onSettings(): void
  children
}
StageChips: { stage: Stage | null; reachable; onStage }   // done ✓ / current / ahead (disabled)
AlertBar:   { alerts: Alert[] }                            // first alert shown; the rest behind "ดูทั้งหมด (N)"
BackupMenu: AppShell["backups"]                            // button "สำรอง · N" + Popover holding the list and the restore confirm
```

`App.tsx` keeps the existing screens for now and gains a `journey` record `{ project?: ProjectDetail; videoIds?: string[]; stored?: StoredOutline }` so chips can go back: `prepare` → project screen, `outline` → outline screen, `edit` → timeline screen (only when `stored.confirmed`). Alerts are built here in priority order: license expiring / offline → CapCut running → update ready → project warnings. The sidebar and its CSS go. The window keeps `vibrancy: "sidebar"`, so the top bar's background is transparent and the vibrancy shows through it; the content area paints `--bg`.

- [x] Tests: `StageChips.test.tsx` (states, click on reachable only); `AlertBar.test.tsx` (order kept, fold/unfold); `BackupMenu.test.tsx` (count, open, restore confirm, blocked while CapCut runs, `onRestored`); `App.test.tsx` (chip state per screen, chip navigation, alert priority).
- [x] Implement; green; mutation-check; harness still runs.

## M11.2 · ระยะเตรียม

### Task 5: ProjectsScreen

**Files:** create `src/screens/ProjectsScreen.tsx` (+ test); delete `ProjectListScreen.tsx`.

Cards with a 9:16 cover (`aspect-ratio: 9/16; object-fit: cover`), the duration in the corner, name and modified date under it; the shell toolbar holds a search field that filters by name (case-insensitive substring) and a refresh button; root-missing and empty states through `Empty`.

- [x] Tests: renders cards with duration and date; search narrows the list; reloads on window focus; root missing / no projects.
- [x] Implement; green.

### Task 6: PrepareScreen (project + analysis on one screen)

**Files:** create `src/screens/PrepareScreen.tsx`, `src/prepare/VideoRow.tsx`, `AnalysisProgress.tsx`, `ResultPeek.tsx` (+ tests); delete `ProjectDetailScreen.tsx`, `AnalyzeScreen.tsx`; `App.tsx` collapses the `project` and `analyze` screens into `prepare`.

```ts
type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "not-ready"; problems: ReadinessProblem[] }
           | { kind: "running" } | { kind: "finished"; outcome: "done" | "cancelled" } | { kind: "failed"; message: string }
```

Rows: checkbox · name · duration · resolution · (once started) `AnalysisProgress` — two `Progress` bars labelled เสียง/ภาพ with the status text of the existing `audioText`/`pictureText` — · `ดู` button opening `ResultPeek` (utterances and scenes) in a `Popover`. A missing file is dimmed, struck through, unticked and unselectable. Footer: "เลือก N จาก M · รวม T" + token estimate on the left; on the right `เริ่มวิเคราะห์` (blocked while CapCut runs, with the reason) → `ยกเลิก` while running → `ลองใหม่` on failure/cancel → `ไปโครงเรื่อง ›` when every chosen video finished clean. A run already going for this project is picked up from `analysisState()` as before; `not-ready` shows the problems with a settings button instead of the list.

- [x] Tests: port every case of `ProjectDetailScreen`/`AnalyzeScreen` tests to the merged screen (selection and estimate, start blocked by CapCut, start call, events fill the rows, resume from `analysisState`, not-ready → settings, cancel, retry, next only when clean, missing file unselectable, `ดู` shows transcript).
- [x] Implement; green; mutation-check the phase transitions.

## M11.3 · ระยะโครงเรื่อง

### Task 7: OutlineScreen with a brief panel and draggable beats

**Files:** rewrite `src/screens/OutlineScreen.tsx`; create `src/outline/BriefPanel.tsx`, `BeatCard.tsx`, `BeatList.tsx` (+ tests); keep `src/components/UnusedParts.tsx` (moved to `src/outline/`, restyled as the fold).

```ts
BriefPanel: { brief: Brief; onChange(b: Brief): void; hasOutline: boolean; planning: boolean; onPlan(): void; onRevise(instruction: string): void; onCancel(): void; plannedAt?: { at: number; model: string } }
BeatList:   { beats: Beat[]; folder: string; api: Pick<RendererApi, "beatThumbnail">; disabled: boolean; onReorder(beatIds: string[]): void; onRemove(id): void; onPreview(beat: Beat): void }
```

Reordering: each card is `draggable`; `dragstart` remembers the id, `dragover` on another card computes the drop index (before/after by pointer y), `drop` calls `onReorder` with the full new order; the ↑ ↓ buttons stay for the keyboard (shown on focus/hover) and call the same `onReorder`. Preview opens `ScenePlayer` in a `Popover` on the card. While planning the list is dimmed (`aria-busy`) with a status line and cancel in the panel. Footer: `ยืนยันโครงเรื่อง ›`.

- [x] Tests: `BeatList.test.tsx` — drag card 3 onto card 1 gives order [3,1,2]; ↑ on card 2 gives [2,1,3]; disabled while busy. `OutlineScreen.test.tsx` — port every existing case (brief → plan, stored outline shown, revise, regenerate, remove, confirm saves with `confirmed: true`, unused part added, error returns to previous phase) to the new layout.
- [x] Implement; green; mutation-check the drop-index arithmetic.

## M11.4 · ห้องตัดต่อ

### Task 8: `edit/byBeat.ts`

**Files:** create `src/edit/byBeat.ts` (+ test).

```ts
export interface BeatFlair {
  groups: HighlightGroupView[]
  slots: HighlightPreview["slots"]; cues: CueView[]; inserts: InsertView[]
  pieces: HighlightPreview["pieces"]; zooms: ZoomView[]
  counts: { text: number; sound: number; zoom: number; insert: number }
}
/** Everything the preview holds, sorted into the beats of the plan (time order inside each); an item whose beat is not in the plan lands in the last beat. */
export function byBeat(preview: HighlightPreview, plan: CutPlan): { beats: Map<string, BeatFlair>; orphaned: number }
```

- [x] Tests: items reach their beat; sorted by `atUs`; counts add up (text = groups, sound = cues, zoom = zooms, insert = inserts); an unknown `beatId` goes to the last beat and is counted; an empty plan gives an empty map.
- [x] Implement; green; mutation-check.

### Task 9: EditScreen skeleton — sidebar, panel, tabs, state

**Files:** create `src/screens/EditScreen.tsx`, `src/edit/BeatSidebar.tsx`, `BeatPanel.tsx` (+ tests).

`EditScreen` takes over **all** state and effects of `TimelineScreen.tsx` (rules/presets/plan/phase/subtitles/lines/texts/highlights/flair/preview/versions/refs, the `previewCut`, `previewHighlights`, `previewSubtitles` effects, and the handlers `decide`, `changeSubtitles`, `changeFlair`, `planFlair`, `changeHighlights`, `changeHighlightText`, `pickHighlights`, `polish`, `changeRules`, `write`) unchanged; only the JSX is new. New state: `selectedBeatId` (first beat by default, follows the plan when a beat disappears), `tab: "speech" | "text" | "subtitles" | "flair"`, `settingsOpen`, `toast`.

```ts
BeatSidebar: { beats: { beatId: string; name: string; videoName: string; originalUs: number; keptUs: number; counts: BeatFlair["counts"] }[]; selected: string; onSelect(id): void;
               summary: { durationUs: number; targetUs: number | null; pieces: number }; onEditOutline(): void }
BeatPanel:   { beat: BeatCut & { name: string; videoName: string }; tab; onTab; tabs: { subtitles: boolean; text: boolean; flair: boolean }; children }
             // an off kind renders its tab disabled; choosing it shows "ปิดอยู่" with a button that opens the settings sheet
```

The stage's toolbar (given to `AppShell`): `⚙︎ ตั้งค่าคลิป`, `✦ ให้ AI แต่ง ▾`, `เขียนลง CapCut` (Tasks 14–15 fill them in).

- [x] Tests: sidebar lists beats with before→after and counts; selecting changes the panel heading; the first beat is selected by default; a disabled tab explains itself and opens the sheet; the sidebar summary shows total, target and pieces.
- [x] Implement (JSX only around the ported state); green.

### Task 10: SpeechTab

**Files:** create `src/edit/SpeechTab.tsx` from `src/components/CutRows.tsx` (+ test); delete `CutRows.tsx`.

Rows as in the mockup: state pill · time · quote · actions revealed on hover/focus (`▶`, `Aa เน้น` when highlights are on, `ตัด`/`เก็บ`); the inline `ScenePlayer` under the playing row; pauses folded into one line. Props are `CutRows`' props plus `beatName`.

- [x] Tests: port the CutRows cases from `TimelineScreen.test.tsx` (labels per state, toggle calls `setCutDecision` with the row's change, play opens the player with context, pauses fold, `Aa เน้น` calls `addHighlightGroup`), plus: actions are hidden until hover/focus (class or `aria-hidden` check).
- [x] Implement; green.

### Task 11: HighlightTab + LookPopover

**Files:** create `src/edit/HighlightTab.tsx`, `LookPopover.tsx` from `src/components/HighlightGroups.tsx` (+ tests); delete `HighlightGroups.tsx`.

Each group: time range · AI/คุณ badge · placement text · `⚙︎ รูปลักษณ์` (opens `LookPopover`: pattern `Segmented`, accent `Select`, exit `Select`, the "edited" hint) · `ลบชุด`; lines editable in place (save on blur/Enter, cleared = removed) with the accent word marked. An empty tab shows `Empty` pointing at `Aa เน้น` in the speech tab.

- [x] Tests: port the HighlightGroups cases (edit line, remove line, remove group, pattern/accent/exit call `setFlairLook`, portrait-only patterns hidden on landscape, no look controls when flair is off); popover opens and closes; empty state.
- [x] Implement; green.

### Task 12: SubtitleTab

**Files:** create `src/edit/SubtitleTab.tsx` (+ test) from the `SubtitleLines` function in `TimelineScreen.tsx`.

Lines of the beat with a time and an editable text; a `✦ เกลาด้วย AI` button (when polish is on) with the polishing state and the rejected notice; `Empty` when the beat has no lines.

- [x] Tests: edit calls back with the line index; polish calls `polishSubtitles` with every text and applies the answer; rejected shows the notice.
- [x] Implement; green.

### Task 13: FlairTab

**Files:** create `src/edit/FlairTab.tsx` (+ test) from `SoundCues.tsx`, `ZoomCues.tsx`, `InsertCues.tsx`; delete those three.

```ts
FlairTab: { flair: BeatFlair; options: FlairOptions; sounds: HighlightPreview["sounds"]; media: HighlightPreview["media"]; busy: boolean;
            onCue(anchor, effectId | null); onInsert(anchor, binId | null); onZoom(anchor, kind | null) }
```

Two groups: "เสียงประกอบ / สื่อแทรก · ตามจุดในบีต" — one row per slot (time · what · sound `Select` · insert `Select`, each column only when that kind is on) — and "ซูมภาพ · ตามชิ้นวิดีโอ" — one row per piece (time · what · duration · zoom `Select`). A kind with nothing to offer (no sounds on this machine / no spare media) says so once at the top of its column. A hand-set item shows the "คุณตั้งเอง" tag.

- [x] Tests: port the SoundCues/ZoomCues/InsertCues cases (rows per slot/piece, chosen value shown, change calls the right api with the anchor, "none" clears, edited tag, empty notices); columns follow the options.
- [x] Implement; green.

### Task 14: ClipSettingsSheet + the AI menu

**Files:** create `src/edit/ClipSettingsSheet.tsx`, `AiMenu.tsx` (+ tests) from `FlairSection.tsx`, `HighlightSection.tsx`, `SubtitleSection.tsx` and the rules block of `TimelineScreen.tsx`; delete the three sections.

```ts
ClipSettingsSheet: { open; onClose; tab: "rules" | "subtitles" | "highlights" | "flair"; onTab;
  rules: CutRules; presets: Record<CutPresetId, CutPreset>; onRules(r): void;
  subtitles: SubtitleOptions; onSubtitles; highlights: HighlightOptions; onHighlights; style: { value: HighlightStyleId; byAi: HighlightStyleId | null } | null; onStyle;
  flair: FlairOptions; onFlair; mediaCount: number; notices: { dropped: number; outlineChanged: boolean; needsPictures: boolean; hidden: number; flairDropped: number } }
AiMenu: { items: { id: "pick" | "flair" | "polish"; label: string; disabled?: string; busy: boolean; onRun(): void }[] }   // a Button "✦ ให้ AI แต่ง ▾" + Popover list
```

Four tabs: กติกาการตัด (preset `Segmented` + three `Switch`es), ซับ (on/off, length, polish), ข้อความเด่น (on/off, position, style with "AI เลือก" suffix, hide-subtitles), ลูกเล่น (on/off, level, four kinds, "N ไฟล์ในกรุ"); notices sit in the tab they belong to. The AI menu holds เลือกข้อความเด่น / จัดลูกเล่น / เกลาซับ, each disabled with a reason when its kind is off or its input is missing, each showing progress while running.

- [x] Tests: every control writes the right patch through `updateSettings`; tab switching; notices in the right tab; menu items call `pickHighlights` / `planFlair` / `polishSubtitles`, disabled reasons, busy state.
- [x] Implement; green.

### Task 15: WriteBar

**Files:** create `src/edit/WriteBar.tsx` (+ test).

```ts
WriteBar: { phase: WritePhase; canWrite: boolean; blockedReason: string | null;
            summary: { pieces: number; durationUs: number; replacing: number; captions: number; groups: number; lines: number; sounds: number; zooms: number; inserts: number };
            projectName: string; onConfirm(): void; onWrite(): void; onCancel(): void; onToastDone(): void }
```

The toolbar button opens a `Sheet` with the summary list and the backup note; `ยืนยันเขียน` runs the write; while writing the button shows progress; on success the sheet closes and a `Toast` says what was written with `เขียนอีกครั้ง`; the button reads `เขียนอีกครั้ง` afterwards; blocked while CapCut runs.

- [x] Tests: port the write cases (confirm shows counts, replace warning, cancel, write call with the current rules/subtitles/highlights, success toast and message, write-again, blocked).
- [x] Implement; green.

### Task 16: Wire the room; retire the old screen

**Files:** `src/screens/EditScreen.tsx`, `src/App.tsx`; delete `src/screens/TimelineScreen.tsx` and its test once every case is covered by the new tests.

Recomputing states (rules or settings changed) dim the panel with `aria-busy` and a skeleton row instead of the "กำลังคำนวณ" text; errors show in an `AlertBar` entry at the top of the panel.

- [x] Tests: `EditScreen.test.tsx` — a full pass: open, pick a beat, cut a row, add highlight text, set a sound, change a setting in the sheet, write; plus the busy state and an error.
- [x] Implement; full renderer suite green; harness walk-through of all three stages with screenshots.

## M11.5 · Settings, activation, cleanup

### Task 17: Settings and activation

**Files:** `src/screens/SettingsScreen.tsx` (+ test), `src/screens/ActivationScreen.tsx`, `src/App.tsx` (apply the appearance on load and on change through `theme.ts`).

A new first section "หน้าตา" with a `Segmented` ตามระบบ / สว่าง / มืด → `updateSettings({ appearance })` → `applyAppearance`; the existing sections rebuilt from `ui/` pieces (radio choices become `Segmented` where two options, cards where they carry hints). Activation becomes one centred card.

- [x] Tests: appearance change calls the api and sets `data-theme`; the app applies the stored appearance on load; existing settings cases still pass.
- [x] Implement; green.

### Task 18: CSS split, dead code, verify

**Files:** split what remains of `src/styles.css` into `styles/shell.css`, `screens.css`, `edit.css`; delete `styles.css`; delete unused i18n keys (grep each key for a use); `src/main.tsx` imports the four stylesheets.

- [x] `npx tsc --noEmit`; full `npm test`; grep for `sidebar`, `toolbar`, `cut-rules`, `sound-cues` classes to be sure nothing references deleted CSS.
- [x] Harness: screenshot every stage light and dark at 1180×760 and at the 900×600 minimum; fix anything that overflows.
- [x] Real app: `npm run dev -w @boxblack/desktop`, open 0917 (read-only walk, no write), check the window chrome (traffic lights, vibrancy on the top bar) and the theme switch against `nativeTheme`.
- [x] `npm run dist:local -w @boxblack/desktop`; spec entry under "## 6. ลำดับงาน" of the timeline-manager spec pointing at the redesign spec; memory update (`boxblack-design-decisions.md`: M11 line with the choices the user made — no preview, no timeline strip, tabs per beat).

## i18n keys added (Thai text in `i18n.ts`)

`stage.prepare` เตรียม · `stage.outline` โครงเรื่อง · `stage.edit` ตัดต่อ · `shell.projects` โปรเจกต์ · `shell.settings` ตั้งค่า · `shell.backups` สำรอง · `alerts.showAll` ดูทั้งหมด ({count}) · `projects.search` ค้นหาโปรเจกต์ · `prepare.start` เริ่มวิเคราะห์ · `prepare.cancel` ยกเลิก · `prepare.retry` ลองใหม่ · `prepare.next` ไปโครงเรื่อง · `prepare.peek` ดู · `prepare.progress` กำลังวิเคราะห์ {done} จาก {total} · `brief.replan` วางโครงเรื่องใหม่ · `brief.reviseLabel` สั่งแก้โครงเรื่องที่มีอยู่ · `brief.plannedAt` วางเมื่อ {time} · {model} · `outline.drag` ลากเพื่อจัดลำดับ · `edit.beats` บีต · `edit.summary` รวม {total} · เป้า {target} · {pieces} ชิ้น · `edit.editOutline` แก้โครงเรื่อง · `edit.tab.speech` คำพูด · `edit.tab.text` ข้อความเด่น · `edit.tab.subtitles` ซับ · `edit.tab.flair` ลูกเล่น · `edit.tabOff` ปิดอยู่ · `edit.tabTurnOn` เปิดในตั้งค่าคลิป · `edit.settings` ตั้งค่าคลิป · `edit.settingsHint` ใช้กับทุกบีต · เปลี่ยนแล้วคำนวณใหม่ให้เอง · `edit.ai` ให้ AI แต่ง · `edit.ai.pick` เลือกข้อความเด่น · `edit.ai.flair` จัดลูกเล่น · `edit.ai.polish` เกลาซับ · `edit.look` รูปลักษณ์ · `edit.textEmpty` ยังไม่มีข้อความเด่นในบีตนี้ — ไปแท็บคำพูด กด “Aa เน้น” ที่ประโยคไหนก็ได้ · `edit.flair.points` เสียงประกอบ / สื่อแทรก · ตามจุดในบีต · `edit.flair.zooms` ซูมภาพ · ตามชิ้นวิดีโอ · `edit.busy` กำลังคำนวณใหม่ · `write.confirmList.*` (video/subtitles/text/flair lines) · `write.toast` เขียนแล้ว · {pieces} ชิ้น {duration} · เปิด CapCut ดูได้เลย · `settings.appearance` หน้าตา · `settings.appearance.system` ตามระบบ · `.light` สว่าง · `.dark` มืด

Existing keys keep their text where the wording still fits; keys whose screen disappears are removed in Task 18.

## Outcome (2026-09-18)

Done, all five milestones. 962 tests pass (up from 945), `npx tsc --noEmit` clean, `dist:local` built. What the app is now: a bar with three stages instead of a five-step sidebar, the project and its reading on one screen, the brief beside the beats it made, and an editing room of two columns where a beat shows one of its four sides at a time.

Differences from the plan:

- **The alert bar is for what the app has to say, not for the project's warnings.** Missing files, an untested CapCut version and a timeline about to be replaced stay in the screen that is about them — they belong next to the thing they describe, and the bar would have taken them away from it. The bar carries the license, CapCut being open, and a ready update, first one in the way and the rest behind a count.
- **`Field` wraps its control in a label, which renames anything composite inside it**, so a second piece, `Group`, writes the caption without owning it. Segmented controls and lists of switches use `Group`; a select or a text box uses `Field`.
- **The alert row is always in the grid**, empty or not: with three rows declared and only two children rendered, the screen took the middle row and left the last one empty, so the action bar floated in the middle of the window.
- **The editing room's toolbar is handed up to the app**, since the buttons belong on the bar but only the room knows what they can do: `EditScreen` takes an `onToolbar` and the app renders what it gets.
- **`UnusedParts` moved to `outline/` and onto the editing room's row classes** rather than keeping a set of its own; it is the same kind of row.
- The old `styles.css` is gone: 1,436 lines became five files of about 1,900, with nothing left that no screen uses. Six dead i18n keys went with it.

Checked in the harness (`scratchpad/ui-harness`, the real renderer on the fake API) at 1180×760 and at the 900×600 minimum, light and dark: the project list, the reading filling in row by row, the brief beside the beats, the room with its beat marks, the flair tab, the settings sheet, and the write confirmation.

## Fixed after checking the real app (2026-09-18)

The user opened the built app and found the screen broken. Watching the real app through its own remote-debugging port (`npx electron out/main/index.js --remote-debugging-port=9333`, then CDP `Page.captureScreenshot`) showed three faults the harness had hidden:

1. **The project list's heading was flush against the window edge**, title clipped and search box touching the right side. Its `.screen-head` sits outside `.content`, which is what carries the side padding; every other screen keeps the head inside. Fixed with a rule for a head that is a direct child of `.screen`.
2. **The flair rows reserved a column for a kind that was not shown** (this project has no spare media, so the insert column is left out) which pushed the sound select into the middle and left a hole on the right; the piece's length was also being eaten by the description's ellipsis. Both rows are now flex, with the length its own column.
3. `.veil` and `.toast` are `position: fixed`, so a sheet dims the window wherever it is rendered from — the write sheet is rendered inside the top bar's toolbar, and relied on the initial containing block by luck.

A second pass, after the user said it was still off, walked every screen of the real app in both themes with a CDP driver (`/tmp/drive.mjs`: exact selectors only, popovers closed with Escape — an earlier loose text match hit the AI menu's "เลือกข้อความเด่น" by mistake and a Claude call was cut short by killing the app; nothing was written) and found five more:

4. **Settings** capped `.content` itself at 720px, so its scrollbar sat in the middle of the window; the cap moved to an inner column. The page also said "ตั้งค่า" twice (bar and h1) and "หน้าตา" twice (h2 and caption), and the bar still offered a settings button while on settings.
5. **The prepare row** reserved a 300px column for progress before there was any, leaving the numbers stranded mid-row; the row is flex now and the column appears when reading starts.
6. **The peek popover** was clipped by the list's `overflow: hidden` (kept for the rounded corners); the corners are now on the first and last rows instead. Its text also inherited `text-align: right` from the anchor — `.popover` sets its own.
7. **The look popover** was 300px wide and its four Thai pattern names spilled past the window edge, giving the room a horizontal scrollbar; the popover is 340px, capped to the viewport, and segmented controls wrap.
8. **The inline player** was a 420px-wide black box around a portrait clip; the video is now sized by height.

The real app was then walked end to end on the user's own 0917 (read-only: cached transcription and vision, the stored outline, no write): project list → prepare → outline → editing room → each tab → the settings sheet → the write confirmation.

A third pass, after the user said the settings page was off and that things broke after leaving it:

9. **The settings page was still on the old class names.** `.button`, `.subtle` and `.warning-text` had gone with the old stylesheet, so its buttons were the browser's own, its hints were full-weight text and the Claude Code warning had no colour; the language and model fields sat flush against the box above. The page, `LicenseSection` and `ToolsSection` now use `Button`, `Progress`, `.hint`, `.warn-text` and `.select`, and each section is a grid with one gap. The unused `components/BackupList.tsx` (the source of the remaining undefined classes) is deleted.
10. **Leaving settings from the prepare stage threw away a finished analysis.** Settings replaces the work screen, so `PrepareScreen` mounts afresh on the way back and only picked up a run that was still going; a finished one came back as "เริ่มวิเคราะห์" with the rows blank. The same happened stepping back to เตรียม from the stage chips. `AnalysisState` now carries `outcome` and `error` (set where the run settles in `main/analysis.ts`), and the screen restores a finished, cancelled or failed run for its folder as well as a running one. The outline and editing rooms were checked the same way and keep their place.

Checked in the real app after the fix, dark and light: settings top to bottom, projects → settings → back, prepare (finished) → settings → back keeps "ไปโครงเรื่อง", outline → chip back to เตรียม keeps it too.

## The settings page, redone (2026-09-18)

The user asked for the page itself to be reworked: it was long enough to need scrolling, looked bare, and its grouping did not help. It is now **four tabs** in a 640px column, the same `Tabs` piece the clip settings sheet uses:

| tab | what is in it |
|---|---|
| ทั่วไป | appearance (one row), the three tools as rows of a card, the app's version |
| ถอดเสียง | whisper/Scribe choice with its detail, spoken language |
| Claude | API/CLI choice with its detail, the model |
| License | the four facts as a `<dl>`, check and release |

- **The page opens on the first tab with something to fix**, and every tab with one carries a warn dot (`TabSpec.flag`, new). `TAB_OF` maps each `ReadinessProblem` to its tab, so "ไปที่ตั้งค่า" from the prepare stage lands where the problem is. The tab is the user's after that: `refresh()` only sets it when nothing is chosen yet, or every save would throw them back.
- **A card** (`.card`) is a rounded surface whose pieces are separated by a line: head, rows, foot. A settings row is a label on the left and its control on the right, which is what made the page short — no more label-above-control stacks.
- The tools list became rows with the version or the fixing command on the right, so `tools.found`/`tools.foundNoVersion` gave way to `tools.installed`, and the license sentence became four labelled facts (`license.customer`/`planLabel`/`expires`/`devices`), dropping `license.summary`.
- `ToolsSection`/`LicenseSection` became `ToolsCard`/`LicenseCard`; the tick moved to its own `components/Check.tsx`.

Checked in the real app, dark and light, at 1180×760 and 900×600: all four tabs fit without scrolling, nothing overflows, the release confirmation sits inside its card. The warn dots were checked in the harness with `?ready=0`.

## The way back to the project list (2026-09-18)

The user found there was no way back to the CapCut project list once a project was open — the stage chips only move within a project, and the bar's back button existed but was only wired to settings.

- **`AppShell`'s back button now serves both**: on settings it says "‹ กลับ" and returns to the work screen; on any stage of a project it says "‹ โปรเจค" and goes to the list (`backLabel`, new). The list itself has no back button.
- **The journey is kept**, so reopening the same project returns to the stage it reached — including a finished analysis, which the prepare stage restores from `analysisState()`.
- The **backup menu is hidden on the list**: it belongs to an open project, and the list is not one.
- The bar could not hold all of this at the window's 900px minimum — in the editing room it grew to 988px and pushed backups and settings off the right. Two rules under `@media (max-width: 1060px)` fix it: the stages the user is not on give up their name (keeping the number, and the name still readable to a screen reader through a clipped span), and the bar's gap and right padding tighten. The title also ellipsizes now rather than pushing, for a long project name.

Checked in the real app: back from each of the three stages, reopening 0917 with its analysis still done, and the bar at exactly 900px in the editing room with nothing overflowing.

Not done: opening the packaged app itself — the DMG builds, but the window's own chrome and `nativeTheme` following the appearance choice have not been watched on screen.
