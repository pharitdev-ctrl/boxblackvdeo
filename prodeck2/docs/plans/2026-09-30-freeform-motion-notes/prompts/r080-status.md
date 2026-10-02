# 0.8.0 execution status (paused 2026-10-02 at the user's request after 6a)

- Done and reviewed: Task 1 (core moves.ts), Task 2 (objects face), Task 3 (techniques call), Task 4 (capcut/moves.ts writer), Task 5 (main move-cues.ts), Task 6a (planning, storage, preview list, order, sounds, API) with all review fixes.
- Gate after 6a: npm test 176 files green, typecheck clean.
- Snapshots: scratchpad r050/before-080, after-w1-080, t3-080, t4-080, t5-080, before-6a-080, t6a-080.
- Next on the user's word: take snapshot before-6b-080, dispatch r080-task6b.md, review; then Task 7 (renderer; brief not yet written; read r080-notes-for-task5.md "For Task 7"), then Task 8 (mutation, version 0.8.0, dist, live test on a draft the user names, docs, memory).
- Accepted deviations: failed Claude moves are stored but not listed; legacy zooms are not in faceBoxesIn; keepClear fallback checked vertically only (thin box at x 0.5).

## Update (2026-10-02, later)
- 6b and Task 7 done and reviewed with fixes. Mutation 45/45 (one test added to moves.test.ts for covers with an off-centre turned base). Gate: 176 files, 3139 passed. Version 0.8.0, DMG release/boxblack-0.8.0-arm64.dmg built.
- Next: live test (waiting for the user to name the draft), docs, memory.
- Done 2026-10-02: live test passed, draft restored, docs and memory updated. 0.8.0 shipped.
