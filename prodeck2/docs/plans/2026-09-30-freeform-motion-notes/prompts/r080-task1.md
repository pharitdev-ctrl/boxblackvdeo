You are implementing Task 1 of the BOXBLACK 0.8.0 plan "Free zoom": Core: move geometry.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r080-common.md` first.

Your task is "Task 1" in `docs/plans/2026-10-02-free-zoom.md`, Steps 1 to 7. The names in "Names shared across tasks" (Task 1 block) are exact: later tasks import them.

## Facts from the code

- `CueAnchor` is in `packages/core/src/flair/plan.ts`; `FlairLevel` and `FLAIR_LEVELS` in `packages/core/src/flair/catalogue.ts`.
- A box in shares of a frame from its top-left is `{ x0, y0, x1, y1 }` (`SubjectBox` in `flair/look-at.ts`, `SceneObject.box` in `vision/objects.ts`). Use that shape wherever the plan says `Box` for a face, a shown thing or a card. Pixel sizes are `{ width, height }` (`Box` in `capcut/framing.ts`); do not confuse the two, and name them clearly.
- **CapCut's units** (`capcut/framing.ts`, read its top comment):
  - at scale 1 a picture is drawn "fit": one side spans the canvas;
  - `transform` x/y are in half-canvases, **+1 is right and UP** (y is up, unlike the top-left shares);
  - `Framing` = `{ scale, x, y, drawn }`, where `drawn` is the on-screen pixel size at that framing.
- **How the writer (Task 4) composes a pose with a base framing** (spike, `keyframes-into-1001.mts`): scale keyframe = base scale × pose.scale; position = base x/y + pose x/y; rotation = base rotation + pose.rot. CapCut scales and rotates the picture about its own centre, then places that centre. So the geometry must be: the picture's on-screen rectangle is `drawn × pose.scale`, rotated by `rot` about its own centre, with its centre at `(base.x + pose.x, base.y + pose.y)` half-canvases.
- **The base framing.** Let the geometry functions take the base as an optional argument (a `Framing` from `capcut/framing.ts`). With none, the picture exactly covers the canvas at pose scale 1 with no shift (a main piece whose source has the canvas's aspect). Main pieces are given their own base by Task 5 later; cutaways give `coverFraming` or `cardFraming`. A card's box for `checkMove` is then the picture itself: "the card after the pose stays inside the frame".
- **Rotation sense.** Take positive degrees as clockwise on screen. It is unverified; the checks are symmetric enough that it does not matter. Say so in a comment.

## Working conditions

Task 2 (`packages/core/src/vision/objects.ts` and its test) runs at the same time. Do not touch it.

You own:
- `packages/core/src/flair/moves.ts` and `moves.test.ts` (new);
- the `./flair/moves` line in `packages/core/package.json` exports.

Do not export from `flair/index.ts` unless the plan says so (it does not).
