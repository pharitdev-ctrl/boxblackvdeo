You are fixing the look of the "✦ ให้ AI คิด ▾" menu in BOXBLACK 0.8.1 (renderer only).

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r070-common.md` for the repo rules and report format (ignore its 0.7.0 summary).

## The problem (user's screenshot)
Before a whole plan has run, three items (คิดใหม่: ข้อความและเทคนิค, กราฟิก, เสียง) are disabled, and each shows the same reason line "กดให้ AI คิด › ทำทั้งหมดก่อน" under it. The lines are as large as the items, not indented like them, repeated three times, and break the list's rhythm. "กดให้ AI คิด ›" also makes no sense inside the AI menu itself.

## Code
- `apps/desktop/src/renderer/src/edit/AiMenu.tsx`: a reason shared by every item is shown once as `.ai-note` at the head; otherwise each disabled item shows its own `<span class="hint">` under it.
- `screens/PostScreen.tsx:95` gives those items `t("post.ai.planFirst")`. Check where else that key shows (it may be used outside the menu; keep it there if so).
- CSS in `styles/edit.css` (`.ai-menu`, `.ai-note`, `.ai-items …`).

## Change
1. A reason shared by two or more (but not all) items is shown **once**, as a small muted note at the foot of the menu, after the list, aligned with the items' text. Each of those items points to it with `aria-describedby`. A reason only one item has stays under that item, but small, muted and indented to the item's text.
2. In the menu, the plan-first reason reads `ต้องกด ✦ ทำทั้งหมด ก่อน` (new key `post.ai.planFirstHere`, verbatim). Keep `post.ai.planFirst` wherever else it is used; if nothing else uses it, remove it.
3. Disabled items stay greyed as now.
4. No change to the level control, the lead item or the separators.

## Tests (first)
Update the PostScreen tests around line 869: the note appears once, at the foot, and the three items' `aria-describedby` point to it; a lone reason still sits under its own item. Keep the 0.7.2 "all items share one reason" note at the head working.

## Working conditions
Nobody else works on the repo. You own `apps/desktop/src/renderer/**` only. Run `npm test` and `npm run typecheck` from the repo root.
