# Cut Review Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user sees, per beat, what is used and what is cut and why, can play each part with context, and flips any of them between cut and kept; on the outline screen they see what the planner left out and put it back.

**Design (approved with 9 review changes, 2026-09-17):**
1. Both directions: used sentences can be cut; cut parts can be kept.
2. "Put back" extends the adjacent beat of the same clip when the part sits right before/after it (so the retake rule still sees both takes); otherwise a new beat before the next beat of that clip in time, else at the end.
3. Decisions are stored by transcript position, not by removal ranges: word indexes to keep/cut, pauses by the word before them, bad-picture problems by their measured range, cut scene pieces by range. They survive preset changes.
4. Pauses are folded per beat ("ช่วงเงียบ 12 จุด รวม 4.1 วิ ▸") and expand to per-pause rows.
5. ▶ plays the part with 1 s before and after.
6. Subtitle lines keep their edited text when their source did not change (line key).
7. Unused parts are listed per sentence, grouped by clip, folded when long.
8. Unused sentences in a reviewed retake carry the review ("เทคซ้ำ · AI แนะนำเทคหลัง").
9. Main validates: part ids and decision targets are resolved in main; writes use stored decisions.

---

### Task 1: Decisions in the cut compiler (core, pure)

**Files:** `packages/core/src/cut/rules.ts`, `compile.ts`, new `decisions.ts` (+ tests).

```ts
// rules.ts
export type RemovalReason = "filler" | "retake" | "pause" | "bad-picture" | "user"
export interface VideoCutDecisions {
  /** identifies the transcript the word indexes belong to; decisions for another transcript are ignored */
  transcript: string
  keepWords: number[]; cutWords: number[]; keepPauses: number[]
  keepProblems: SourceRange[]; cutPieces: SourceRange[]
}
export type CutDecisions = Record<string, VideoCutDecisions>
export type CutDecisionChange =
  | { type: "words"; indexes: number[]; keep: boolean | null }
  | { type: "pause"; after: number; keep: boolean | null }
  | { type: "problems"; ranges: SourceRange[]; keep: boolean | null }
  | { type: "pieces"; ranges: SourceRange[]; keep: boolean | null }
export interface CutRow { state: "used" | "cut" | "kept"; reason: RemovalReason | null; startUs: number; endUs: number; text: string; toggle: CutDecisionChange | null }
// BeatCut gains rows: CutRow[] (source order)
// decisions.ts
export function applyCutDecision(current: VideoCutDecisions, change: CutDecisionChange): VideoCutDecisions
```

Speech: rule reasons first; keepWords override them ("kept"), cutWords drop kept words ("cut", reason "user"); a kept pause (by the word before it) is not cut. Rows: runs of words with the same state/reason within one utterance, plus a row per long pause (cut or kept). Toggles: used → {keep:false}; cut by rule → {keep:true}; cut by user / kept by user → {keep:null}.
Scenes: kept problems are not cut ("kept" rows); pieces inside a cut range are removed (reason "user"); used pieces toggle {pieces, keep:false}; bad-picture rows toggle the problems that overlap them.

- [x] Tests: filler kept/cut, retake take kept, used sentence cut, pause kept, rows and toggles per state, decisions survive a preset change, scene problem kept, scene piece cut, reducer.
- [x] Implement; green; mutation-check.

### Task 2: Unused parts and putting them back (core, pure)

**Files:** `packages/core/src/planner/unused.ts` (+ test), `outline.ts` (share beat building).

```ts
export interface UnusedPart { id: string; videoId: string; videoName: string; kind: "speech" | "scenes"; index: number; startUs: number; endUs: number; text: string; retake: { take: "A" | "B"; better: "A" | "B" | "same" } | null }
export function unusedParts(clips: FootageClip[], outline: Outline): UnusedPart[]
export function addUnusedPart(outline: Outline, clips: FootageClip[], partId: string): Outline
```

- [x] Tests: unused sentences per clip; scenes only where nobody speaks; retake label; adjacent extension before/after; new beat placement (after an earlier beat of the clip / before a later one / at the end); unknown part rejected.
- [x] Implement; green; mutation-check.

### Task 3: Main process

**Files:** `apps/desktop/src/main/timeline.ts`, `timeline-api.ts`, `planner.ts`, `outline-api.ts`, `shared/api.ts` (+ tests).

- `StoredOutline.cutDecisions?: CutDecisions` kept through edits, dropped by planning.
- `setCutDecision(folder, videoId, change)`: video must be in the outline; word/pause indexes within the transcript; stores with the transcript fingerprint.
- Compile passes decisions whose fingerprint matches the cached transcript.
- `unusedParts(folder)`, `addOutlinePart(folder, partId)` (outline unconfirmed).
- `SubtitleLine.key` from video, source start/end and text.

- [x] Tests; implement; green; mutation-check.

### Task 4: Timeline screen rows

- Rows per beat replace the removal list; pauses folded; ▶ with 1 s context; toggle buttons; re-preview after a change; subtitle edits kept by key.

- [x] Tests; implement; green; mutation-check.

### Task 5: Outline screen unused parts

- Section grouped by clip, folded past 5, ▶, retake label, "ใส่กลับ".

- [x] Tests; implement; green; mutation-check.

### Task 6: Verify

- [x] typecheck, tests; dev app on 0917 (no draft write); `dist:local`; spec + memory.

## Outcome (2026-09-17)

Done; 599 tests pass, typecheck clean, `dist:local` rebuilt. Checked in the dev app on 0917 without writing the draft. Found while checking: two licensed calls at once (cut preview and subtitle preview) wrote `license.json` through the same temporary file and one failed; fixed with `@boxblack/core/atomic-write` (queued per file, unique temporary names) used by every store, and settings/secret updates now run one at a time.
