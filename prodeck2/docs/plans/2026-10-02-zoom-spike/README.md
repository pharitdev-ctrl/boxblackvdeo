# Spike: free keyframes for zoom (2026-10-02)

Before 0.8.0 (Claude designs the picture's moves), we checked what CapCut 9.5 plays when the app writes keyframes beyond today's straight scale-and-shift ones.

## What was written

`keyframes-into-1001.mts` wrote these into the user's draft "1001 (1)". The draft was backed up first and restored afterwards (identical).

- **A. Rotation.** On the first main piece, a `KFTypeRotation` track: into 115% while turning to +4°, then −4°, then back to straight. The format is copied from a rotation keyframe the user made by hand in 0815.
- **B. Many keyframes in one piece.** A punch to 120% that bounces back, then a punch to 130% that holds and returns.
- **C. Pan.** At 125%, the picture moves from x −0.2 to +0.2 (half-frame units).
- **D. Eased moves without curves.** A push from 100% to 125% and back, each made of 8 straight steps along an ease-in-out curve. Every point keeps `curveType: "Line"`.
- **E. Keyframes on an overlay video.** A graphic on the overlay track grows to 120% and back.

All keyframes are timed in the piece's source file, as `capcut/zoom.ts` does.

## Result

The user looked at all five in CapCut on 2026-10-02 and said they play as described ("ตรง").

What this settles:
- rotation works;
- several moves in one piece work;
- a pan at 125% shows no edge;
- straight steps make an eased move;
- keyframes on overlay videos work.

**Pro.** Export did not ask for Pro (user, 2026-10-02).

## Still open

- CapCut's own curve types (other than "Line") were not tried. Eased moves are made of straight steps instead.
