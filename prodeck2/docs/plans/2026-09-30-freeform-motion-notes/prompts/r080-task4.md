You are implementing Task 4 of the BOXBLACK 0.8.0 plan "Free zoom": Core: writing moves as keyframes.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first.

Your task is "Task 4" in `docs/plans/2026-10-02-free-zoom.md`, Steps 1 to 3.

## Facts from the code

- `packages/core/src/capcut/zoom.ts` (`addZooms`, `sourceTime`, `point`, `track`) is the pattern: copy its keyframe JSON shape and its source-time rule. You may export `sourceTime`, `point` and `track` from `zoom.ts` and reuse them instead of copying; change nothing else there.
- The spike `docs/plans/2026-10-02-zoom-spike/keyframes-into-1001.mts` is proven in CapCut 9.5: four tracks `KFTypeScaleX`, `KFTypePositionX`, `KFTypePositionY`, `KFTypeRotation`; values are base × scale, base x + x, base y + y, base rotation + rot (`clip.rotation`); `|| 0` so no negative zero; every point `curveType: "Line"`.
- `steps(poses)` and `Pose` come from `packages/core/src/flair/moves.ts` (Task 1, done). `steps` gives `{ s, scale, x, y, rot }` in seconds from the move's start; the first point is the first pose.
- `Written` is `{ info, kept, dropped }` (`capcut/types.ts`).

## Decisions the plan left open (follow these)

**1. The seam.** Within one piece, moves are written in start order. For each move after time 0, before its own points, add a point at `startUs` holding the pose in force just then (the last point of the previous move, or the identity before any), unless the move's first pose has `ease: "cut"`, in which case the jump happens 1 ms after `startUs` (as `steps` does for a cut). A move that starts before the previous move's last point is a placement error main should never send: drop it and count it.

**2. The identity at 0.** A piece whose first move starts after 0 gets an identity point at 0 (scale 1, x 0, y 0, rot 0, on top of the base).

**3. Legacy zooms on a moved piece.** `addMoves` cannot see zooms. Export a helper from `capcut/moves.ts`:
```ts
/** The legacy zooms on pieces that carry no move, and how many were left out because the moves win. */
export function zoomsBesideMoves<Z extends { cut: number }>(zooms: Z[], moves: { cut: number }[]): { zooms: Z[]; dropped: number }
```
Task 6 calls it before `addZooms`. Test it.

**4. Cutaways.** `TimelineInsert.poses?: Pose[]`. `OverlayPiece` gains `poses?: Pose[]`; `addOverlayTracks` writes `common_keyframes` on that piece's segment, with `place` (`scale`, `x`, `y`) as the base and rotation base 0, timed by the segment's `source_timerange.start` and speed 1. The moves on a cutaway start at the cutaway's first frame (time 0 of the segment). `addInsertTrack` passes the poses through. Graphics overlays (`graphics/…` writers calling `addOverlayTracks`) pass none, and their output must not change: check their tests still pass untouched.

**5. Return of `addMoves`.** `kept` = the number of moves written, `dropped` = moves on a piece not there, with no poses, or dropped by the seam rule.

## Working conditions

Task 3 (`packages/core/src/flair/direct.ts`, `graphics/motion/free.ts` exports, and a stub in `apps/desktop/src/main/flair.ts`) runs at the same time. Do not touch those.

You own `packages/core/src/capcut/moves.ts` and `moves.test.ts` (new), `capcut/inserts.ts`, `capcut/overlays.ts`, the small exports in `capcut/zoom.ts`, their tests, and a `./capcut/moves` export line in `packages/core/package.json` if other capcut files have their own lines (check first; otherwise export from `capcut/index.ts` as the others do).
