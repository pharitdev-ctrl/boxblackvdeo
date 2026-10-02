You are implementing Task 3 of the BOXBLACK 0.8.0 plan "Free zoom": Core: the techniques call asks for moves.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first.

Your task is "Task 3" in `docs/plans/2026-10-02-free-zoom.md`, Steps 1 to 5. The prompt block at the end of Task 3 is copied verbatim.

## Decisions the plan left open (follow these)

**1. The rest of `SYSTEM`.**
- The "ซูมภาพ:" section (its heading line and its four bullet lines) is replaced by the plan's block.
- The "สื่อแทรก:" section and the closing paragraph stay verbatim.
- The "ข้อมูลที่ได้:" line no longer matches what is sent. Replace it, verbatim, with:
  `ข้อมูลที่ได้: brief ของวิดีโอ ระดับที่ผู้ใช้เลือก คำพูดทุกคำพร้อมเลขและเวลา จุดเน้นทุกจุดตามลำดับที่เล่น (เลขจุด เวลาบนคลิปที่ตัดแล้ว ความสำคัญ ชนิด วลีที่เน้นหรือคำบรรยายฉาก เหตุผล) ชิ้นวิดีโอพร้อมเพดานซูม ฉากพร้อมของที่อยู่ในภาพและหน้าคน และรูปที่แทรกได้ รูปจริงแนบท้ายคำขอตามเลขเดียวกัน`
- In the second sentence of the first line, "มีสองอย่าง คือซูมภาพ และตัดไปสื่อแทรก" becomes "มีสองอย่าง คือการเคลื่อนภาพ (ซูม) และตัดไปสื่อแทรก".

**2. The result type.** Export:
```ts
/** A move as Claude answered it, before main places it on a piece. */
export interface PlannedMove {
  /** the word it starts on: an index from 0 into the clip's words */
  word: number
  /** for a move on a cutaway, the index from 0 into the `inserts` this same call returns; null on the main footage */
  insert: number | null
  from: FlairLevel
  pointId?: string
  about: string
  poses: Pose[]
}
```
- `insert` in the reply counts from 1 over `reply.inserts`. Map it to the kept cutaway's index in the returned `inserts`. A move naming a cutaway that was dropped, or no cutaway, is dropped.
- "A second move on the same word" means: two main-footage moves on one word, or two moves on one cutaway. The first is kept.
- `Pose` comes from `packages/core/src/flair/moves.ts` (Task 1, done). So do `EASES` and `MOVE_POSES_MAX`.
- Pose numbers are kept as answered, but defaults apply (`x`, `y`, `rot` 0, `ease` "line"). Order is checked strictly: two poses at the same `s` are not in order.

**3. `TechniquePoint.piece`.** The plan drops it from what Claude is shown. Keep the field in the type for now, so main still compiles; `describeTechniques` no longer prints it. Task 6 stops filling it.

**4. Scenes in the request.** Write the scene lines in `direct.ts` yourself, in the format of `describeFreeClip`'s two lines a scene (`packages/core/src/graphics/motion/free.ts`, read only). In the `ของ:` list, a face object reads `keep หน้า “…” …` (the word `หน้า` after the kind). Reuse `boxText` and `band` if they are exported; if not, export them from `free.ts` without changing anything else there. Type the scenes with `SceneObject` from `vision/objects.ts` (it has `face?: boolean` now).

**5. Main's call site.** Changing `planTechniques`' input and result breaks `apps/desktop/src/main/flair.ts` (`planTechniques`, around line 641). Make only the change that keeps main compiling and its tests green:
- pass the new input with what main already has (brief, level from the request, the points, the media) and `words: []`, `pieces: []`, `scenes: []`;
- store the cutaways as now and the legacy zooms as `[]` (thinking again retires legacy zooms; Task 6 stores the moves);
- update the replies in `main/flair-plan.test.ts` and `main/post-flow.test.ts` to the new schema (`moves: []` in place of `zooms`), and adjust only the assertions that counted a zoom.
- Mark the stub with a short comment that Task 6 fills it. Change nothing else in main.

**6. `maxTokens: 16_000`.** The no-call rule: no words and no media means no call (points no longer matter).

## Working conditions

Task 4 (`packages/core/src/capcut/moves.ts`, `inserts.ts`, `overlays.ts` and their tests) runs at the same time. Do not touch those.

You own `packages/core/src/flair/direct.ts`, `direct.test.ts`, the minimal exports in `graphics/motion/free.ts`, and the stub in `apps/desktop/src/main/flair.ts` with the two main tests above.
