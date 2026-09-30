# Small things for the last fix round (with whatever the mutation check leaves)

From the re-review of Task 7b's fix round, which approved it:

- `room/ClipRoom.tsx`: when the latest save of a setting fails and the re-read of the settings (`getSettings`) fails too, `kept` never runs, so the setting stays unsaved and, with "hide words under text" on, the lines are never read and the write is held for ever (carried over from the level, now for four controls). Release the setting in the `getSettings` rejection too. One test.
- The put-back of a failed position save is untested (only the level's is): one rejected-save case for the position.
- `PostScreen.test.tsx`, the "no read before the save" checks wait for the preview to be asked, not to land; in the looks-switch case the set of replaced groups never changes, so the check passes whatever the code does. Wait for the landed preview before asserting.
- "The lines are read only when the set of replaced groups changes" is no longer pinned with hide on: one test where a preview lands with the same replaced groups and the count of line reads is unchanged.

From the mutation check (69 mutants over twelve areas, `mutation/`; 68 caught):

- `packages/core/src/graphics/motion/direct.ts`, `acceptMotionPlan`: removing the rule "a point already filled is dropped" survives, because every test that answers one point twice names the same start word, which the newer rule "the same start place twice" drops anyway. One test: two answers for one point, starting on two different words of its sentence: one graphic, `dropped: 1`.
