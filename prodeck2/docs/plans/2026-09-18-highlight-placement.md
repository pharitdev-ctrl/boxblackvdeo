# Highlight Text Placement (M9.1) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight text lands where it does not cover the face, the product or on-screen writing: the vision step reports the band of the frame to keep clear, and the layout puts each group above or below it.

**Design (approved with 7 review changes, 2026-09-18):**
1. The usual places stay: a group above the subject keeps its top edge at 0.72 and only slides up (to 0.92) when it would cover the band; a group below keeps its bottom edge at −0.52 and only slides down (to −0.92, or to the subtitle line when subtitles are on). Groups do not jump around.
2. A 5 % margin of the frame height is left above and below the band, because Claude's estimate is only about that accurate.
3. A group that spans several scenes dodges all of their bands together.
4. When neither gap fits, the group goes where it covers the least of the band; a scene with nothing to keep clear is placed as "top".
5. The vision prompt asks only for what must not be covered — faces, a product being shown, writing in the picture — not the body or the background, and the band covers every frame of the scene.
6. The vision prompt changes, so cached insights are redone once (including the retake reviews of M8.1). Projects analysed before still work; their text goes to "top" and the timeline screen says to analyse the pictures again.
7. Each group says what it did ("หลบไว้เหนือหน้า", "หลบไว้ใต้หน้า", "วางทับน้อยที่สุด", "วางบน (ยังไม่มีข้อมูลภาพ)") instead of repeating the setting's words.

**Kept from M9:** AI placement is the default, the user can still force บน/กลาง/ล่าง for the whole clip, placement is worked out at preview time and never stored, and there is no per-group placement by hand.

---

### Task 1: The vision step reports the band to keep clear

**Files:** `packages/core/src/vision/describe.ts` (+ test).

```ts
// each scene of FrameBatchReplySchema gains:
keepClear: z.array(z.number()) // [fromY, toY] as a share of the frame height from the top, or [] for nothing
// Scene gains:
keepClear: { fromY: number; toY: number } | null
export const PROMPT_VERSION = "vision-2026-09-18-keepclear"
```

The prompt asks for the band covering faces, a product being shown or held, and writing in the picture — not the body, the background or furniture — wide enough for every frame of the scene, and `[]` when nothing must stay clear. A reply that is not two numbers, is outside 0–1, or does not go top to bottom becomes `null`.

- [x] Tests: a scene keeps its band; out-of-order, out-of-range and wrong-length answers become null; `[]` becomes null; the prompt says what counts and the version changed.
- [x] Implement; green; mutation-check.

### Task 2: Placing a group around the band (core, pure)

**Files:** `packages/core/src/highlights/layout.ts` (+ test).

```ts
export type HighlightPlacement =
  | { kind: "fixed"; position: HighlightPosition }
  | { kind: "auto"; keepClear: { fromY: number; toY: number } | null; keepSubtitleRoom: boolean }
/** Where the block sits and what it did, for the screen to explain. */
export type Dodge = "fixed" | "above" | "below" | "over" | "no-picture"
export function layoutGroup(texts: string[], font: HighlightFontId, canvas: Canvas, placement: HighlightPlacement): { lines: { y: number; scale: number }[]; dodge: Dodge }
```

Auto: the band in y units is `[1 − 2·toY − MARGIN, 1 − 2·fromY + MARGIN]` with `MARGIN = 0.1` (5 % of the height). The top gap runs from 0.92 down to the band's top, the bottom gap from the band's bottom to −0.52 with subtitles (−0.92 without). The block goes in the top gap when it fits, with its top edge at 0.72 unless it has to slide up; else in the bottom gap, bottom edge at −0.52 unless it has to slide down; else where it covers least of the band (without the margin), preferring the top. No band: "top" and `dodge: "no-picture"`.

- [x] Tests: a short group stays at 0.72 when the band is low; a tall one slides up; a high band sends it below at −0.52 and lower when needed; subtitles keep the bottom limit above them; a full-frame band gives the least-covering place; no band behaves as "top"; fixed positions are unchanged.
- [x] Implement; green; mutation-check.

### Task 3: Main picks the placement per group

**Files:** `apps/desktop/src/main/highlight-state.ts`, `highlights.ts`, `timeline.ts`, `settings.ts`, `shared/api.ts` (+ tests).

- `HIGHLIGHT_POSITIONS` gains `"auto"`; `DEFAULT_HIGHLIGHT_OPTIONS.position` is `"auto"`.
- `placementOf(group: PlacedGroup, clips: CutClip[], position: HighlightPosition, subtitlesOn: boolean): HighlightPlacement` — for "auto", the union of the `keepClear` bands of every scene the group plays over, in the group's video; no scenes at all (no insight) gives `keepClear: null`.
- `HighlightGroupView.placement: Dodge`; the preview fills it, and `HighlightPreview.needsPictures` is true when placement is automatic and a video of the outline has no insight.
- The write uses the same placement per group, with `keepSubtitleRoom` from the request.

- [x] Tests: a group under a high band is placed below; a group spanning two scenes dodges both; a clip without insight reports `no-picture` and `needsPictures`; a forced position ignores the band; the write lays the groups out where the preview said.
- [x] Implement; green; mutation-check.

### Task 4: Timeline screen

**Files:** `renderer/src/components/HighlightSection.tsx`, `HighlightGroups.tsx`, `screens/TimelineScreen.tsx`, `i18n.ts`, `test/fake-api.ts` (+ tests).

- The position control offers "ให้ AI เลือก" first.
- Each group shows its placement: `highlights.dodge.above` "หลบไว้เหนือหน้า", `.below` "หลบไว้ใต้หน้า", `.over` "วางทับน้อยที่สุด", `.no-picture` "วางบน (ยังไม่มีข้อมูลภาพ)"; nothing for a forced position.
- When `needsPictures`, the section says "วิเคราะห์ภาพใหม่เพื่อให้ AI เลือกตำแหน่ง".

- [x] Tests; implement; green; mutation-check.

### Task 5: Verify

- [x] typecheck, full tests.
- [x] Re-run the vision step on 0917 through Claude Code and read the bands (checks that the reply schema works through the Claude CLI).
- [x] Dev app on 0917: highlight text with AI placement, write (backup), check in CapCut 9.4 that the lines clear the face. Done once the user's draft was free (2026-09-18): 8 lines in 4 groups, first lines 8–11 % from the top, second lines 16–24 %, the text sits above the face and the subtitles stay at the bottom. The draft is left written for the user to look at; the app's own backup and a copy of their earlier state are kept.
- [x] `dist:local`; spec + memory.

## Outcome (2026-09-18)

Done; 714 tests pass, typecheck clean, `dist:local` rebuilt. Differences from the plan:
- **Text shrinks to fit before covering the picture.** On the user's own clip every group was two lines tall (27 % of the frame) while the gaps above and below the face were 18 %, so every group would have been placed "over". A group that does not fit its gap whole is now scaled down to fit, as far as 60 % of its size; below that, covering the picture is still the answer. Three of the four groups on 0917 dodge the face this way.
- The 5 % margin is a preference, not a rule: a group that only fits without it sits right against the picture rather than over it.
- Ties between the gap above and below go above.

Checked for real:
- The vision step ran again on 0917 through Claude Code (58 s, 11 frames, 2.5k output tokens): the reply schema works through the Claude CLI and the bands are sensible — the face 18–62 % of the frame in the talking-head scenes, and the retake review still picked take B.
- Placement on the stored groups of 0917 (read-only, no draft written): "หลบไว้เหนือหน้า" for three groups, "วางทับน้อยที่สุด" for the one whose face band is widest.
- Drawn over the real frames (`scratchpad/hl/placement-shots`): the text block sits in the clear strip above the face; in the "over" case it covers hair, not the eyes.
- The draft 0917 was left alone: the user was testing the M9 build in their own app at the time, and their write is untouched.

Checked in CapCut afterwards, once the user's draft was free: the write from the dev app put 8 lines in 4 groups on 0917, and CapCut 9.4 at 4.5 s, 10 s, 16.5 s and 21 s shows the text clear of the face with the subtitles at the bottom; the "over" group touches hair only.
