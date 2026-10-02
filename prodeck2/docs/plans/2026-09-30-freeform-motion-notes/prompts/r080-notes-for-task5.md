Notes gathered for Task 5 (controller, from wave 2 reviews):
- The writer (capcut/moves.ts) starts each later move on a piece from the pose held at its start: the move's first pose (unless a cut) is replaced by the held look, and its first segment eases from there. Main must check each move with that substitution (checkMove on [{ ...poses[0], ...held }, ...rest]), or a seam could show an edge the check never saw.
- The writer does not clip points past a piece's end: main cuts every move at its piece's end (and a cutaway's end) before writing.
- Task 6 passes only the moves addMoves kept to zoomsBesideMoves, or relies on it ignoring moves without poses.
- For Task 6 (from Task 3): main/flair.ts planTechniques is a stub (words/pieces/scenes empty, legacy zooms answered as []). Main tests whose titles speak of Claude's zooms (flair-plan.test.ts, e.g. "Claude may zoom the same footage in both beats") now only check no legacy zoom returns; rewrite them around moves, and fix two stale comments there.
- For Task 6 (from the Task 3 review): describeTechniques marks `หน้า` only on face === true. Before calling, for a clip whose objects carry no `face` on any object (a pass made before faces), set face: true on its keep objects (spec §8: an unknown face is treated as a face).
- faceBoxesIn and faceBandIn take `at` as a last argument (Task 5 fix), like movesInForce.
- For Task 7 (from 6a): the API's anchor is MoveAnchor = CueAnchor & { insert?: boolean }; send { ...view.anchor, insert: view.insert }.
