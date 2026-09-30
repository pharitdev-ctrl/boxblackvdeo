# Retake Review Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a speaker says the same thing twice, the planner picks the take whose picture matches the speech (a finger countdown that matches the numbers) instead of avoiding gestures as "picture problems".

**Why:** On 0917 the planner kept the first "สาม สอง หนึ่ง" and dropped the second, whose fingers match the words. Vision sampled one frame every 3 s (the first take got one frame), flagged the finger countdown as "มือบังเลนส์", and the planner prompt said "use the most complete take, avoid picture problems". Nothing compared the takes.

**Architecture:** Retakes are found from the transcript with the cut compiler's own detectors. After describing scenes, the vision step extracts frames every 0.5 s over both takes of each retake and asks Claude which take's picture fits its words; the review is stored in the video insight. The planner sees the reviews in the footage text and a prompt rule for choosing takes. Vision and planner prompts change version, so cached insights are redone once.

**Tech Stack:** TypeScript, vitest, zod, ffmpeg frame extraction, Claude via the existing transports.

Spec: `docs/specs/2026-09-17-capcut-timeline-manager-design.md` → "Retake review" under M8.

---

### Task 1: Finding retakes (pure)

**Files:** modify `packages/core/src/cut/words.ts` (+ test); create `packages/core/src/vision/retakes.ts` (+ test).

```ts
// cut/words.ts
export function repeatedUtterancePairs(utterances: TimedText[]): [earlier: number, later: number][] // repeatedUtterances = pairs.map(([i]) => i)
export function restarts(words: TimedText[]): { from: number; to: number }[] // what falseStarts returns today; falseStarts stays an alias
// vision/retakes.ts
export interface Take { startUs: number; endUs: number; text: string }
export interface Retake { takes: [Take, Take] }
export function findRetakes(transcript: { utterances: TimedText[]; words: TimedText[] }): Retake[]
export function takeFrameTimes(take: Take): number[] // every 0.5 s from start to end, at most 8, evenly spread when longer
```

Take A of a restart is words [from, to); take B is as many words starting at `to`. Utterance pairs come first; a restart whose takes overlap an already found retake is skipped.

- [x] Tests: countdown on 0917 words gives A 19.78–22.06 / B 22.62–25.25 with texts; whole repeated sentence gives the two utterances; overlapping detections kept once; no repeats → []; frame times step 0.5 s, capped at 8 evenly, a very short take gets its middle.
- [x] Implement; green; mutation-check.

### Task 2: Reviewing a retake (Claude)

**Files:** `packages/core/src/vision/retakes.ts` (+ test).

```ts
export const RETAKE_PROMPT: string // Thai: compare two takes of the same words; does the picture fit the speech (fingers match numbers, pointing/showing on the word, expression, looking at camera, stumbles); gestures are not faults
export const RetakeReplySchema // { takeA: string, takeB: string, better: "A" | "B" | "same", reason: string }
export interface RetakeReview { takes: [Take, Take]; notes: [string, string]; better: "A" | "B" | "same"; reason: string }
export async function reviewRetake(args: { transport; model; retake: Retake; frames: [FrameImage[], FrameImage[]]; words: TimedText[]; signal? }): Promise<{ review: RetakeReview; usage: LlmUsage }>
```

Content: for each take a header with its time and each word with its time, then its frames labelled with take and time.

- [x] Tests with a fake transport: request carries model, prompt, schema, both takes' word timings and frames in order with labels; reply becomes the review.
- [x] Implement; green; mutation-check.

### Task 3: Vision pipeline

**Files:** `packages/core/src/vision/describe.ts`, `run.ts` (+ tests), `index.ts`; `apps/desktop/src/main/analysis.ts` (+ test).

- `VideoInsight.retakes: RetakeReview[]`; `PROMPT_VERSION` bumped; vision prompt: gestures that are part of speaking are not issues.
- `describeVideos` videos carry `words`; after `describeVideo`, each retake's frames are extracted into the frames dir and reviewed; usage is added; frames removed with the rest.
- `analysis.ts` passes the transcript words.

- [x] Tests: run with a retake extracts frames at the take times and stores the review; no retake → no extra extraction or request; cached insight skips everything; analysis passes words.
- [x] Implement; green; mutation-check.

### Task 4: Planner

**Files:** `packages/core/src/planner/footage.ts`, `plan.ts` (+ tests).

- Footage text lists retakes: take times and words, Claude's pick and reason.
- Prompt: for a repeated line use the take the review prefers; without a review or when equal, the later take; to use the later take a beat may span both (the cutter drops the earlier one); to use the earlier take the beat must end before the later one. Gestures that go with the words are not picture problems. `PLANNER_PROMPT_VERSION` bumped.

- [x] Tests: footage text shows the retake lines; prompt carries the rule.
- [x] Implement; green.

### Task 5: Verify for real

- [x] typecheck + full tests.
- [x] Re-run vision on 0917's clip through Claude Code (script, userData cache), read the countdown review.
- [x] Plan 0917 again with the same brief as "0917 (1)" (script; nothing written to drafts) and check which countdown take the outline uses.
- [x] Rebuild `dist:local`; spec + memory.

## Outcome (2026-09-17)

Done; 552 tests pass, typecheck clean, `dist:local` rebuilt. Differences from the plan: `falseStarts` needed no alias; a restart is skipped when both of its takes fall inside takes already found (a stumble inside a repeated sentence), not only when it matches the same pair. Live on IMG_9646 the review picked take B for the finger countdown and the planner's beat spans both takes, so the cutter keeps the second.
