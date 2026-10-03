# Agent Editor: a conversation whose cut has changed under it

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Problem (seen on the Mac, 2026-10-05):** the user re-planned the outline of "1003 (1)" and ran "ทำทั้งหมด" again,
then went on in the "คุยกับ AI" tab without pressing "เริ่มใหม่จาก ทำทั้งหมด". The session kept the timeline it was
started from — the old rough cut — while every request builds Claude's words, scenes and the clip the actions check
against from the outline as it is now. So a move Claude put "at 6.2 s on the word w14" was written onto a piece of the
old cut at another place in the video: every zoom landed somewhere else, Claude saw it in its looks, tried again and
removed them all ($1.82 spent). Text and graphics are placed by time, so they drifted the same way, less visibly.

**Goal:** a conversation never works on a cut other than the one its words come from. When the outline's cut no longer
matches the session's, the tab says so before Claude is asked anything, and starting again from "ทำทั้งหมด" is one
click.

## Decisions

| # | Topic | Choice |
|---|---|---|
| 1 | How a change is found | The session's cut pieces (`timeline.cuts`: video, start in the file, length) against the cut the outline compiles to now (`compiled(...).plan.cuts`), each within a frame. Same count and every piece the same = the same cut. Text, graphics or sounds that "ทำทั้งหมด" changed do not count: the session has its own copies of those |
| 2 | Where it is checked | On `open` (the tab shows it at once) and at the start of every `send` (nothing is asked of Claude on a stale session) |
| 3 | What the user sees | `AgentView.stale: true` → a banner over the chat: "โครงเรื่องหรือการตัดเปลี่ยนไปหลังเริ่มแชทนี้ ชิ้นงานจะวางผิดที่" with the button "เริ่มใหม่จาก ทำทั้งหมด" (the reset there is, after its question). Sending is turned off while it shows |
| 4 | A send that comes anyway | Refused with the same reason, no round run, nothing spent |
| 5 | Not done | Carrying Claude's pieces over to the new cut: their words may be gone or moved; starting again is honest and cheap |

## Tasks

- [x] **1. The check.** `agent-wiring.ts`: `cutOf(folder)` (the plan's cuts). `agent.ts`: `sameCut(timeline, cuts)`;
  `open` and `send` mark the view `stale`; `send` refuses a stale session before any call. Tests: a session whose cut
  differs by a piece or by a length beyond a frame is stale and its send asks nothing; one within a frame is not.
- [x] **2. The tab.** Banner and button, input off while stale; i18n; test.
- [x] **3. Check and push.** Full tests, typecheck, commit, push.

## Results

Done. `sameCut` (40 ms slack per piece) in `agent.ts`; the wiring's `cut(folder)` compiles the outline as the tab's
request does; `open` marks the view, `send` refuses a stale session before any call (and sends the view, so the tab
shows the banner even when the outline changed while it was open). The banner uses the warning block with the reset
button, which asks first as it does elsewhere. Tests: 3 new; full run the same 10 known failures.
