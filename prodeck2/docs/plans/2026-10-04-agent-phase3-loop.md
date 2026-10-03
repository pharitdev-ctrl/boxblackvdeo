# Agent Editor, Phase 3: the agent loop and the chat tab

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the user opens a "คุยกับ AI" tab on a project whose outline is confirmed, types what they want, and Claude
works on the shared timeline (phase 2) in rounds: it reads the clip, adds and changes pieces through a set of actions,
the app checks and carries out each action, and Claude sees the results and goes on, until it is done or has used 25
rounds. The user can stop it, talk again, and press "เขียนลง CapCut", which writes the agent's timeline with the
same checks and backup as today.

**Not in this phase:** the preview Claude looks at (phase 4: Claude works from words and numbers only here), reading
the draft back after the user edits it in CapCut (phase 5), changing the cut itself (`trim_cut`, later), cutaways
(later; the pipeline's stay as they are).

**Spec:** `docs/specs/2026-10-03-agent-editor-design.md` §3.1, §5, §6, §7, §10, §14. User's choices: start from the
confirmed outline; 25 rounds per message then ask "ทำต่อไหม"; Opus 5.5 by default; "ทำทั้งหมด" stays.

**Tech Stack:** TypeScript, zod, vitest, React. Done means `npm test` (no new failures against the 10 known ones),
`npm run typecheck` (no new errors against the 8 known ones), and the tab tried in the UI harness.

---

## Decisions

| # | Topic | Choice |
|---|---|---|
| 1 | Starting timeline | A **dry assemble**: `assemble` from phase 2 run without writing, on the project as it stands (rough cut, subtitles, and whatever "ทำทั้งหมด" has put there, or nothing more). Pieces from it are `by: "pipeline"`. Saved as the session's working timeline |
| 2 | Where the agent's work lives | Its own working timeline per project (`TimelineStore`, key `agent`), apart from the pipeline's stored outline. "ทำทั้งหมด" and the agent do not mix: starting the agent copies the pipeline's state once; "เริ่มใหม่จาก ทำทั้งหมด" copies it again, dropping the agent's pieces after asking |
| 3 | How Claude acts | JSON reply per round: `{ say?: string, actions: Action[], done: boolean }` through the existing `LlmTransport.generate` (works on the API key and on Claude Code). No tool-use API in this phase |
| 4 | Times | Claude names times on the **rough cut's clock in seconds** and words by their number in the word list it is given; the app turns them into µs and places pieces itself |
| 5 | Action set (v1) | `set_direction`, `add_text`, `add_move`, `add_graphic`, `add_sound`, `edit_piece`, `remove_piece`, `ask_user`. Each is checked (§7 of the spec); a refusal comes back to Claude with the reason in Thai |
| 6 | Heavy actions | `add_graphic` runs the existing graphic writing (`writePiece` with the motion contract) and the renderer; `add_sound` either picks from the sound library or composes through the existing sound writing and renderer. A round waits for them, so a result says whether the piece was made |
| 7 | Locked pieces | Claude may not edit or remove a `locked` piece; `edit_piece` of one is refused with "ล็อกไว้ ต้องขอผู้ใช้" |
| 8 | Limit | 25 rounds per user message. At 25, one more call with no actions allowed asks Claude to sum up what it did and what is left; the tab shows "ทำต่อ" which sends "ทำต่อ" as the next message |
| 9 | Context order (caching) | system prompt → footage and outline (cached prefix) → chat history and past results → the timeline now (`describeTimeline`) last |
| 10 | Writing | "เขียนลง CapCut" in the tab writes the working timeline through `writeTimeline`, with CapCut closed, the segment count check and a backup, as `writeNow` does; the written timeline is stored as the project's last write (phase 2) |

## Actions (v1)

| Action | Fields | The app does |
|---|---|---|
| `set_direction` | `text` | stores it on the working timeline |
| `add_text` | `fromWord`, `toWord`, `lines[]`, `tone?` | times the lines on the words, lays them out with `layoutGroup` in the outline's highlight style, keeps them off faces as the pipeline does; a `highlight` piece |
| `add_move` | `atWord` or `atS`, `poses[]` (`s`, `scale`, `x`, `y`, `rot`, `ease`), `about` | finds the cut it starts in, checks it with `checkMove` (zoom cap, ±5°, no edge, faces in frame); a `move` piece |
| `add_graphic` | `atS`, `seconds`, `box [l,t,r,b]`, `idea` | words said in that span (`wordsWithin`), writes the HTML (`writePiece`), renders it (`graphicJob` + renderer), places it; a `graphic` piece with `note = idea` |
| `add_sound` | `atS`, `pick?` (library name) or `role` (to compose), `loudness` | a library `sound` piece, or composes (`sound/write`) and renders a `composed` piece |
| `edit_piece` | `id`, the fields of its kind to change | re-runs that kind's checks and making (a graphic with a new idea is written again) |
| `remove_piece` | `id` | removes it unless locked |
| `ask_user` | `question` | ends the round; the question is shown |

## Files

| File | Change | Task |
|---|---|---|
| `packages/core/src/agent/actions.ts` (new) | zod schema of the reply and the actions; `secondsToUs`, word lookup helpers | 1 |
| `packages/core/src/agent/prompt.ts` (new) | `AGENT_PROMPT` (Thai), its version; rules from §7 of the spec and the existing per-kind rules (move limits, graphic contract summary) | 1 |
| `packages/core/src/agent/context.ts` (new) | `agentRequest()`: the content blocks in the order of decision 9; the footage as words numbered on the rough cut's clock with beats and scenes; history trimmed to fit | 1 |
| `packages/core/src/agent/*.test.ts` | cases below | 1 |
| `apps/desktop/src/main/timeline.ts` | `assemble` exported as `dryAssemble(folder, rules, view)` (no CapCut check, no write); `writeAgentTimeline(folder, timeline, expectedSegments)` | 2 |
| `apps/desktop/src/main/agent-actions.ts` (new) | one executor per action, each returning `{ ok, message, pieceId? }` | 3 |
| `apps/desktop/src/main/agent.ts` (new) | sessions per project (working timeline, chat history, usage), the loop, stop, the 25-round limit, events | 4 |
| `apps/desktop/src/main/agent-store.ts` (new) | chat history per project | 4 |
| `apps/desktop/src/shared/api.ts`, `main/index.ts` | `agentOpen`, `agentSend`, `agentStop`, `agentReset`, `agentWrite`; event `agent` | 5 |
| `apps/desktop/src/renderer/src/screens/AgentScreen.tsx` (new), `agent/*.tsx`, `i18n.ts`, nav | the tab: chat, round counter and cost, piece list (lock, remove), write button | 6 |
| `prodeck2/.ui-harness/harness.tsx` | a scripted fake agent for screenshots | 6 |

## Task 1: core (pure)

- [x] Reply schema and action schemas; unknown fields refused; numbers bounded (at most 12 poses, `seconds` 0.3–8, box inside 0–1).
- [x] `AGENT_PROMPT`: who Claude is, the clip it gets, the actions and their rules, "follow the direction, the user's words win", "don't touch locked pieces", "say what you did in Thai, short", "set `done` when the clip is finished or you need the user".
- [x] `agentRequest({ footage, outline, history, timeline, userMessage })` → `LlmContent[]`.
- [x] Tests: schema accepts a good reply and refuses bad ones with a readable message; the request puts the cached part first and the timeline last; history over its budget keeps the newest turns and a one-line summary of the rest.

## Task 2: dry assemble and agent write (main)

- [x] Split `assemble` out of `writeNow` further so it runs without a CapCut check and without waiting for renders that are not made (unmade graphics are left out of the dry timeline and listed).
- [x] `writeAgentTimeline`: CapCut closed, segment count, `writeTimeline`, backup, `writeDraft`, store as last write.
- [x] Tests: a dry assemble of a project equals the timeline a write of it stores; `writeAgentTimeline` refuses with CapCut open and writes the same draft as `writeNow` for an unedited dry timeline.

## Task 3: action executors (main)

- [x] One function per action over `{ timeline, plan, clips, canvas, style, deps }`; pure where it can be (text, move, edit, remove), with the renderer and Claude passed in for graphic and sound.
- [x] Tests per action: a good one adds a piece with the right times; each check refuses with its reason; a locked piece is refused; a graphic whose render fails comes back as failed, with no piece.

## Task 4: the loop (main)

- [x] `send(folder, text)`: appends the message, then rounds: request → reply → execute actions in order → results appended → events → until `done`, an `ask_user`, the stop, or 25 rounds (then the summary call).
- [x] Usage summed per message and per session; cost shown from the model's price.
- [x] A reply that fails the schema is answered once with the error; a second failure ends the round with a message to the user.
- [x] Tests with a scripted fake transport: a two-round session adds pieces and ends on `done`; the 25-round limit ends with a summary and no actions; stop ends at once; a refused action reaches Claude's next request.

## Task 5: API

- [x] Methods and event in `shared/api.ts`; wiring in `index.ts` with the editing Claude (`editingLlm`), the renderers and the stores.

## Task 6: the tab

- [x] A tab "คุยกับ AI" in the post-production page, enabled when the outline is confirmed.
- [x] Left: chat (user, Claude's `say`, each action as a short line with ✓ or ✗ and its reason), input, stop, round counter "รอบ 7/25", cost so far. "ทำต่อ" after a summary.
- [x] Right: the pieces in time order (from the working timeline), each with lock and remove; "เขียนลง CapCut" with the same confirm sheet as today; "เริ่มใหม่จาก ทำทั้งหมด".
- [x] Tests (React Testing Library) with the fake API; harness screenshots, light and dark.

## Check

- [x] `npm test`, `npm run typecheck`.
- [ ] On the Mac, with the user: open "1003 (1)" in the tab, ask for one change ("ใส่ป้ายราคาตอนท้ายให้ใหญ่ขึ้น"), write to CapCut, look.
- [x] Commit and push on `claude/quirky-wozniak-3fhi7t`.

## Result (2026-10-04)

- Built: `packages/core/src/agent/` (reply schema, action checks, prompt, request), `apps/desktop/src/main/agent-actions.ts`,
  `agent.ts` (sessions and the loop), `agent-wiring.ts` (the app's services for the agent), `agent-api.ts`, the
  `assemble` split in `timeline.ts` (dry assemble, `writeTimeline`), and the 7th tab `edit/AgentTab.tsx`.
- Tests: 6 core, 7 executors, 5 loop (scripted Claude), 1 wiring on the fixture project, 2 timeline (dry assemble and
  the agent's write), 2 tab. `npm test`: 3,153 passed, the same 10 known failures; `npm run typecheck`: the same 8
  known errors. The tab was looked at in the UI harness, light and dark (`2026-10-03-agent-spike/agent-tab.png`).
- **Known gaps, for phase 4 or later:**
  - Faces are not handed to the move checks yet (`faces: null`): a move keeps the zoom cap and the edges, not faces. **Closed in phase 3b** (`2026-10-04-agent-phase3b-scenes.md`).
  - A graphic is written without the render-and-repair loop the pipeline has: it is written once, rendered once,
    and a failed render goes back to Claude as a failed action.
  - After the agent writes, the page's own write button still holds the segment count from before; it then refuses
    with "the timeline changed" and asks to check again, which is safe but clumsy.
  - The tab sits under the beat heading of the page although it works on the whole clip.
  - Nothing has run against the real Claude yet: the prompt is untested on real projects.

## Risks

- **Claude works blind until phase 4.** It places pieces from words, times and boxes without seeing them; expect mistakes that the preview will catch later. The checks (faces, edges, overlaps) carry more weight until then.
- **Cost and time:** a graphic is one more Claude call and a render (10–40 s); a round with three graphics can take a minute or two. The tab shows what is running.
- **Claude Code transport has no prompt cache** across calls: long sessions cost more of the user's quota there (spec §13).
- **Two editors of one project:** the agent's working timeline and "ทำทั้งหมด" are kept apart on purpose (decision 2); the UI says which one a write uses.
- **Size of the phase:** six tasks; tasks 1–4 can be built and tested without the UI, then 5–6.
