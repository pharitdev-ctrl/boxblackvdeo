# Text behind the person: parked notes

The user parked this feature on 2026-09-30, before any code was written. Resume it only when the user asks.

The spec is `docs/specs/2026-09-29-text-behind-person-design.md` and the plan is `docs/plans/2026-09-29-text-behind-person.md`.
Everything in this folder was copied out of a session scratchpad under `/private/tmp`, which macOS clears. Scripts still
name their old scratchpad paths (`$S`, `$SP`); point them at this folder or a new scratchpad before running them.

## What is here

- `merge-notes.md`: the 14 conflicts between the five plan parts. **Fix these in the plan before running any task.**
- `contracts.md`: the shared names, types and task map that every plan part was written against.
- `facts.md`: measurements the plan relies on, including 0917's frame times, what CapCut showed frame by frame, and the ffmpeg encode that worked.
- `spike/behind/`: the 2026-09-29 proof scripts on draft 0917.
  - `render2.py`: one person frame per timeline frame, as constant-rate ProRes 4444.
  - `write-behind2.mts`: writes the layer order and the person track.
  - `write-matting.mts`: the CapCut Pro route, using background removal on copies of the main piece.
  - `frames2.py`: checks an export frame by frame against the main layer. Task 19 builds its `frames3.py` from it.
  - `pts.json`: 0917's frame times (numbers only).
  - The calibration scripts and the Pro-content check.
- `spike/mask-pipeline/`: the user's chosen mask filter ("ช่อง 4").
  - `segment.swift` and `segment-seq.swift`: Vision person masks.
  - `final-masks.py`: the guided filter and the temporal smoothing in numpy.
  - `guided.swift`: the Accelerate port of that filter.
- `research/`: the exploration reports behind the spec, with file and line references as of 2026-09-29, and the spec review's confirmed findings.

## What is deliberately not here

No frames, masks, pictures or videos were copied. They show the user's face, and fixtures must be synthetic.

## Time estimate when parked

About 15 to 18 hours of agent time for the full plan. Most of it goes to the app's own person cutter: the Swift helper, the render queue and frame matching (Tasks 3 and 7 to 11).
The CapCut Pro route alone is much smaller, because a copy of the main piece matches its frames by construction. Shipping that route first was offered to the user as one way to cut the time. The user parked the feature instead of choosing.
