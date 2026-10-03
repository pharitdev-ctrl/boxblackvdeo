# Story Direction Implementation Plan (phase 1 of the agent editor)

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The outline planner knows what post-production can add (moves, cutaways, highlight text, graphics, sounds, subtitles) and writes a short **direction** for the clip: tone, pacing, which beats carry the most weight, visual style. The direction is stored with the outline, shown and editable on the outline screen, and handed to every "ทำทั้งหมด" work that decides something creative. Today each work sees only the brief, and only the graphic writing sees the title and summary.

**Why now:** phase 1 of `docs/specs/2026-10-03-agent-editor-design.md` §12. The user chose that the agent always starts from the confirmed outline (spec §3.1), so the outline must already be planned with decoration in mind. It also improves "ทำทั้งหมด" on its own.

**Tech Stack:** TypeScript on Node 24+, Electron, React, zod, vitest. Done means `npm test` green and `npm run typecheck` clean from `prodeck2/`.

---

## Decisions

| # | Topic | Choice |
|---|---|---|
| 1 | Shape | One free-text `direction` per outline, written in Thai by the planner. No per-beat field in this phase: beats are reordered and deleted by the user, and only the emphasis work sees beats today |
| 2 | Old outlines | `direction` is optional (`direction?: string`). Absent or empty reads as "none" in every request. No migration |
| 3 | Who wins | The user's brief instructions win over the direction. Every prompt that gets the direction says so |
| 4 | Editing | The user can edit the direction on the outline screen. Editing it does not clear `confirmed` (the cut does not change) and does not mark any work stale. The new text is used from the next run |
| 5 | Revisions | "สั่งแก้" and "วางใหม่" send the current direction with the outline. Claude returns a direction every time and keeps it unless the instruction calls for a change |
| 6 | Prompt versions | Bumped for every prompt whose text changes (list in Task 1 and 2). In main, no post-work version is used for staleness (checked 2026-10-03: no `*_PROMPT_VERSION` of a post work is read in `apps/desktop/src/main`). The planner's version is stored on `StoredOutline.promptVersion` but nothing compares it. So the bump changes no existing project; re-check before release |
| 7 | Not in scope | Subtitle polish (fixes words only), sound writing (follows its plan), media look-at, vision, the agent mode itself |

## Files

| File | Change | Task |
|---|---|---|
| `packages/core/src/planner/plan.ts` | capability paragraph, direction rule, revision text carries direction, version bump | 1 |
| `packages/core/src/planner/outline.ts` | `direction` in `OutlineReplySchema` and `Outline`, `resolveOutline` | 1 |
| `packages/core/src/planner/*.test.ts` | cases below | 1 |
| `packages/core/src/emphasis/plan.ts` | direction in request + system line, bump | 2 |
| `packages/core/src/flair/direct.ts` | same (techniques) | 2 |
| `packages/core/src/highlights/pick.ts` | same | 2 |
| `packages/core/src/graphics/motion/free.ts` | same (graphics plan) | 2 |
| `packages/core/src/graphics/motion/write.ts` | same (graphic writing) | 2 |
| `packages/core/src/sound/plan.ts` | same (sound plan) | 2 |
| `apps/desktop/src/main/emphasis.ts`, `flair.ts`, `highlights.ts`, `sound-work.ts` | pass `stored.outline.direction` | 3 |
| `apps/desktop/src/main/planner.ts`, `shared/api.ts`, `preload` | `saveOutlineDirection(folder, text)` | 3 |
| `apps/desktop/src/renderer/src/screens/OutlineScreen.tsx`, `i18n.ts` | show and edit the direction | 4 |
| `prodeck2/.ui-harness/harness.tsx` | fake outline carries a direction (for the screenshot check) | 5 |

`packages/core/src/flair/sound-plan.ts` is not imported by the app (the sounds work uses `sound/plan.ts`) and is left alone.

---

## Task 1: Planner (core)

- [x] `outline.ts`: add `direction: z.string()` to `OutlineReplySchema`; add `direction?: string` to `Outline`; `resolveOutline` copies `reply.direction.trim()`.
- [x] `plan.ts`: add to `SYSTEM`, after the pacing paragraph:

```
หลังตัดแล้ว โปรแกรมจะตกแต่งคลิปต่อให้: ซูมและขยับภาพ แทรกรูปหรือคลิปจากโปรเจค ข้อความเด่นบนจอ กราฟิกเคลื่อนไหว เสียงประกอบ และซับ
เลือกช่วงโดยคิดถึงสิ่งเหล่านี้ด้วย เช่น ช่วงที่พูดถึงตัวเลขหรือขั้นตอนทำเป็นกราฟิกได้ ช่วงภาพนิ่งที่เนื้อหาดีใช้ซูมหรือภาพแทรกช่วยได้ ไม่ต้องตัดทิ้งเพียงเพราะภาพเรียบ

direction คือแนวทางตกแต่งของทั้งคลิป สองถึงห้าประโยค: อารมณ์และจังหวะ ช่วงไหนเป็นไฮไลต์ที่ควรตกแต่งหนัก ช่วงไหนควรเรียบ และสไตล์ภาพที่เข้ากับเนื้อหา อ้างช่วงด้วยชื่อช่วง ไม่ใช้เลขลำดับ
```

  and add `direction` to the field list line ("name คือ… omitted คือ…").
- [x] Revision (`previous && instruction`) and fresh take (`previous` only): append `แนวทางตกแต่งฉบับปัจจุบัน: ${previous.direction || "ไม่มี"}` to the text. For revisions add "คง direction ไว้ถ้าคำสั่งไม่ได้เกี่ยวกับเรื่องนี้ ปรับให้ตรงกับโครงเรื่องใหม่ถ้าช่วงเปลี่ยน".
- [x] `PLANNER_PROMPT_VERSION = "planner-2026-10-03-direction"`.
- [x] Tests (`outline.test.ts`, `plan.test.ts`): reply with direction resolves to a trimmed `direction`; the system text mentions the decorations and `direction`; a revision request carries the previous direction; a previous outline without `direction` sends "ไม่มี".

## Task 2: Post works read the direction (core)

Each of the six functions takes an optional `direction?: string` beside `brief` and writes one line in its brief block, right after `คำสั่งเพิ่มเติม`:

```
- แนวทางของคลิป: ${direction?.trim() || "ไม่มี"}
```

Each `SYSTEM` gets "แนวทางของคลิป" in its "ข้อมูลที่ได้" list and one rule:

```
ทำให้เข้ากับแนวทางของคลิป ถ้าแนวทางขัดกับคำสั่งเพิ่มเติมของผู้ใช้ ให้ทำตามคำสั่งของผู้ใช้
```

| Function (file) | New version |
|---|---|
| `describeEmphasis` / plan call (`emphasis/plan.ts`) | `emphasis-2026-10-03-direction` |
| technique request (`flair/direct.ts`) | `techniques-2026-10-03-direction` |
| `describe` / `pickHighlights` (`highlights/pick.ts`) | `highlights-2026-10-03-direction` |
| plan request (`graphics/motion/free.ts`) | `free-plan-2026-10-03-direction` |
| writing request (`graphics/motion/write.ts`) | `motion-write-2026-10-03-direction` |
| `describeSounds` / plan call (`sound/plan.ts`) | `sound-plan-2026-10-03-direction` |

- [x] Implement the six; keep every other line of each request byte-identical so cached prefixes stay valid where they are cached.
- [x] Tests: per file, the request shows the direction line with a direction and with "ไม่มี" without one; the system text contains the rule.

## Task 3: Main passes it on

- [x] `emphasis.ts` (plan call near line 380), `flair.ts` (techniques clip near line 603, graphics plan, graphic writing beside the "about" line at line 122), `highlights.ts` (`pickHighlights` near line 756), `sound-work.ts` (`planComposedSounds`): pass `stored.outline.direction`.
- [x] Redo / edit-by-instruction of moves, graphics and sounds go through the same request builders; check each passes the direction too.
- [x] `planner.ts`: `saveOutlineDirection(folder, text)` sets `outline.direction` (trimmed, max 1,000 characters) and `updatedAt`; leaves `confirmed`, highlights, flair and emphasis as they are. Add to `DesktopApi` in `shared/api.ts`, `API_METHODS`, preload.
- [x] Tests (`planner.test.ts`, `emphasis.test.ts`, `flair.test.ts`, `highlights.test.ts`): the stored direction reaches each fake transport's request; saving a direction keeps `confirmed`.

## Task 4: Outline screen

- [x] Under the summary on `OutlineScreen.tsx`: a section "แนวทางตกแต่ง" showing the direction, with an edit button that turns it into a textarea (save / cancel). Hidden when the outline has no direction and the user has not added one; an "เพิ่มแนวทาง" link instead.
- [x] Saving calls `saveOutlineDirection`; the screen shows the stored result.
- [x] Strings in `i18n.ts`. Test in `OutlineScreen.test.tsx`: shows the direction, edits and saves it, no section on an old outline.

## Task 5: Check

- [x] `npm test` and `npm run typecheck` from `prodeck2/`.
- [x] UI harness (`?outlined`): fake outline with a direction; capture the outline screen and look at it.
- [ ] Bump the app version (patch). Left to the owner: versions are bumped by hand at release (0.8.1 → 0.8.3 in one commit), and the repo keeps no release notes file. Code comments call the change 0.8.4.
- [x] Commit and push on `claude/quirky-wozniak-3fhi7t`.

## Result (2026-10-03)

- `npm test`: 3,121 passed. 10 failed in 8 files (`asr/models`, `capcut/write`, `sound/lint`, `sound/write`, `bundled-ffmpeg`, `bundled-whisper`, `graphics-files`, `graphics-pack`): the same 10 fail on the code before this change (macOS binaries, disk-error simulation as root), so none is from it.
- `npm run typecheck`: the only errors are the 8 in `renderer/src/edit/GraphicsTab.tsx`, there before this change.
- Outline screen checked in the UI harness (`?outlined`), light and dark: direction shown, edited, saved.
- Found while testing: `DirectionCard` and `UnusedParts` both keyed by `stored.updatedAt` as siblings made React keep a stale editor; the card's key is now `direction-${updatedAt}`.

## Risks

- **Planner output grows** by a few sentences: small next to the beats.
- **Direction can be wrong or generic:** the user can edit it, and the user's instructions win in every prompt.
- **No real-footage check here:** prompt quality can only be judged on real projects on the user's Mac. Ask the user to run one project before and after and compare.
