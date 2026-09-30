# Task 2: what was added to the instructions after the implementer started

`task2.md` is what the implementer was first given. These came afterwards, as messages from the controller, and are as
binding as the file. Where one of them contradicts `task2.md`, the later one holds.

1. **`motionWords`** (exported from `packages/core/src/graphics/motion/direct.ts`), so that the plan's acceptance and the
   desktop app compute a graphic's words with one function:
   `motionWords(sentence: GraphicSentence, fromSourceUs: number, seconds: number): MotionWord[]`.
   - The start is the word whose `startUs` is `fromSourceUs`, or, when none starts exactly there, the last one that
     starts at or before it (the first word when none does); with no words the answer is `[]`.
   - `atS` is `(word.timelineUs - start.timelineUs) / 1_000_000`, rounded to the millisecond.
   - A word is in when `0 <= atS < seconds`; at most the first forty (first twelve, then raised: a graphic lasts at
     most 6 s and speech runs at two to three words a second); in the sentence's order.
   - `acceptMotionPlan` builds `spec.words` by calling it with the start it chose and the clamped `seconds`; a scene
     point has no words.
2. **The contract changed in one line** under "Time" (the way out must be over, with everything invisible, by 0.1 s
   before `D`); `MOTION_CONTRACT` must equal `spike/contract-final.md` as it stands, and the test asserts that line.
3. **`until`**: Claude plans without the words' times, so each graphic of the reply has `until: string` (default `""`),
   the last word the idea lands on. When it is found in the point's sentence at or after the start word (by the same
   word matching that finds `word`), `seconds` is the larger of the answer's seconds (3 when there is none) and that
   word's time from the start on the rough cut plus 1 s, then held to 1.5–6. Empty, not found, found only before the
   start word, or on a scene point: nothing changes. The planning prompt (`spike/plan-prompt.md`) has the two bullets.
4. **`TEXT_REPLY` has a module of its own**, `packages/core/src/llm/text-reply.ts`; `llm/types.ts` imports zod as a type
   only (the renderer imports the model list from that file); the transports and `motion/write.ts` import the constant
   from the new module; `llm/index.ts` exports it.
5. **One sentence of the linter** (`motion/lint.ts`, the HTML-comment problem) now ends `a CSS /* */ comment is fine`,
   since the contract says to write no comments in the script. Nothing else in `lint.ts` was the implementer's to change.
6. **The smallest box height is 0.15**, not 0.2 (so 0.10 is kept with the slack of 0.05): real frames leave about 0.18
   between a talking head's keep-clear band and the subtitles' room.
7. **The planning prompt** was copied again after each change of `spike/plan-prompt.md`. Its last two changes (keep the
   top 0.07 of the frame clear; name no colours in an idea) were made by the controller directly, in the constant and in
   the test that pins the prompt's lines, after a real planning call showed the need (`spike/plan-smoke/`).
