# Flair: Punch-in Zoom (M10.3) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (TDD per task, mutation-check each behaviour). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The flair step also moves the picture: a piece of the rough cut can punch in on the speaker as a line lands, or drift in slowly across the whole piece.

**Design (approved 2026-09-18):**
- A zoom belongs to **a piece of the rough cut**, because CapCut keeps keyframes on the segment. Its anchor is `{ videoId, sourceUs }`, the same way a cut cue is anchored, so it survives a change of cut rules.
- Claude picks one of two kinds per piece: `punch` (1.0 → 1.15 over 0.35 s, then held) or `drift` (1.0 → 1.08 across the whole piece).
- A punch lands at the start of its piece, or on the first highlight group inside it when there is one. That is a rule, not Claude's choice.
- The zoom is around the face, not the middle of the frame: the centre of M9.1's `keepClear` band gives `yFace`, and every keyframe sets `transform.y = yFace × (1 − scale)` so the face stays where it was while the picture grows. No band means a plain zoom about the centre. The frame edge can never show, because `|transform.y| ≤ scale − 1` by construction.
- Rules: `light` has no zooms; about one per 10 s at `medium` and one per 6 s at `heavy`; a punch needs a piece of at least 1.5 s and a drift 2.5 s; two zooms start at least 4 s apart; a drift on a piece too short becomes a punch when that fits, else it is dropped and counted.
- The same Claude call answers `zooms` beside `groups` and `cues`.

---

### Task 1: Zoom cues and their rules

**Files:** `packages/core/src/flair/plan.ts` (+ test).

```ts
export const ZOOM_KINDS = ["punch", "drift"] as const
export type ZoomKind = (typeof ZOOM_KINDS)[number]
/** A piece of the rough cut, by the source it plays. */
export interface PieceAnchor { videoId: string; sourceUs: number }
export interface ZoomCue { anchor: PieceAnchor; kind: ZoomKind; edited: boolean }
/** A zoom with the piece it sits on. */
export interface PlacedZoom { cue: ZoomCue; atUs: number; durationUs: number }
export function enforceZooms(zooms: PlacedZoom[], level: FlairLevel, durationUs: number): { kept: PlacedZoom[]; dropped: number }
```

`enforceZooms`: `light` keeps none; the user's own zooms are laid down first; a drift on a piece shorter than `MIN_DRIFT_US` 2.5 s becomes a punch, and anything shorter than `MIN_PUNCH_US` 1.5 s is dropped; two zooms must start `MIN_APART_US` 4 s apart; the count is capped at `ceil(durationUs / 10 s)` at `medium` and `ceil(durationUs / 6 s)` at `heavy`; the result is in time order.

- [x] Tests: the quiet level keeps nothing; a short piece loses its drift but keeps a punch; a piece under 1.5 s is dropped; zooms closer than 4 s lose the later one; the cap follows the level and the length; a zoom the user set wins a clash and a cap; the result is in time order and the dropped count adds up.
- [x] Implement; green; mutation-check.

### Task 2: Turning a zoom into keyframes

**Files:** create `packages/core/src/capcut/zoom.ts` (+ test).

```ts
export interface TimelineZoom {
  /** the piece's place in the rough cut, which is also its segment's place on the video track */
  cut: number
  kind: ZoomKind
  /** where the punch lands inside the piece, in µs from its start; ignored by a drift */
  atUs: number
  /** the piece's length */
  durationUs: number
  /** the face's height in CapCut's transform units (+1 top, −1 bottom); 0 without a picture */
  faceY: number
}
export function addZooms(info: DraftInfo, zooms: TimelineZoom[]): DraftInfo
```

Each zoom writes `common_keyframes` on its video segment: `KFTypeScaleX`, `KFTypePositionX` and `KFTypePositionY`, each a list of `{ id, curveType: "Line", time_offset, values: [n], left_control, right_control, string_value: "", graphID: "" }` exactly as CapCut 9.4 writes them (0815). A punch is three points — start of the piece at scale 1, the moment before the punch, and 0.35 s later at `PUNCH_SCALE` 1.15 — and a drift is two, from 1 at the start to `DRIFT_SCALE` 1.08 at the end. `KFTypePositionY` follows `yFace × (1 − scale)` at every point, `KFTypePositionX` stays 0, and `clip.scale` and `clip.transform` are set to the first keyframe's values, the way CapCut does.

> **Corrected in 0.4.2:** CapCut 9.5 reads `time_offset` as µs into the segment's source file (`source_timerange.start + offset × speed`), not from the piece's start; the offsets written here from 0.1.x to 0.4.1 were wrong for any piece not starting at source 0.

- [x] Tests: a punch writes three points with the scale rising 1 → 1.15 and the position following the face; a punch at the very start writes the rise from the first frame; a drift writes two points across the piece; the clip matches the first keyframe; a zoom on a segment that is not there is left out; no zooms, no change.
- [x] Implement; green; mutation-check.

### Task 3: Claude picks the zooms

**Files:** `packages/core/src/flair/direct.ts` (+ test).

```ts
/** A piece a zoom could go on, as Claude is shown it. */
export interface ZoomSlot {
  anchor: PieceAnchor
  atUs: number
  durationUs: number
  /** what plays there: the beat's name, and the highlight line the punch would land on */
  what: string
}
// the reply gains:
zooms: z.array(z.object({ at: z.number().int(), kind: z.enum(ZOOM_KINDS) }))
```

The prompt lists the pieces by number with their time, their length and what is in them, and says what the two kinds do. `acceptFlair` turns the answer into `ZoomCue`s, dropping and counting an unknown number or a second zoom on one piece. The prompt version becomes `flair-2026-09-18-zoom`.

- [x] Tests: a reply becomes zooms on the right pieces; an unknown piece number is dropped and counted; two zooms on one piece keep the first; no pieces offered means none accepted; the prompt lists the pieces with their lengths.
- [x] Implement; green; mutation-check.

### Task 4: Main process

**Files:** create `apps/desktop/src/main/zoom-cues.ts` (+ test); `flair.ts`, `highlights.ts`, `timeline.ts`, `shared/api.ts`, `highlight-api.ts`, `settings.ts` (+ tests).

- `zoomSlotsFor(plan, timed groups, beatNames, at)` — every piece at least `MIN_PUNCH_US` long, with the highlight line a punch would land on when one falls inside it.
- `zoomsInForce(stored, slots, flair, durationUs)` — stored zooms whose piece is still there, through `enforceZooms`.
- `faceYOf(clip, piece)` — the middle of the `keepClear` bands of the scenes the piece plays over, in transform units; 0 without a picture.
- The preview gains `zooms: ZoomView[]` and `zoomSlots`; `flair.setZoom(folder, anchor, kind | null)`; settings gain `flair.zoom`.
- The write turns the kept zooms into `TimelineZoom`s and calls `addZooms`; `WriteResult` gains `zoomCount`.

- [x] Tests: slots skip pieces that are too short; a punch inside a piece lands on the highlight line; the face's height comes from the picture and is 0 without one; a stored zoom whose piece is gone is dropped; the write keyframes what the preview showed; zoom off writes none.
- [x] Implement; green; mutation-check.

### Task 5: Timeline screen

**Files:** `renderer/src/components/FlairSection.tsx`, `ZoomCues.tsx` (create), `screens/TimelineScreen.tsx`, `i18n.ts`, `styles.css`, `test/fake-api.ts` (+ tests).

- A third switch, "ซูมภาพ", beside the text and the sounds.
- A list of the pieces that can take a zoom: the time, what is there, and a select of ไม่ซูม / กระชากเข้า / ค่อยๆ ซูม. A zoom the user set says so.

- [x] Tests; implement; green; mutation-check.

### Task 6: Verify

- [x] typecheck, full tests.
- [x] Live: plan on 0917 through Claude Code and write. **Not looked at in CapCut** — its window sat on another Space all session and the computer-use tools went away, so the draft is left holding the write for the user to open.
- [x] `dist:local`; spec entry + memory.

## Outcome (2026-09-18)

Done; 891 tests pass, typecheck clean, `dist:local` rebuilt. Differences from the plan:

- **The zoom is on top of the piece's own size and place, not instead of them.** The keyframes start from whatever `clip.scale` and `clip.transform` the piece already has and multiply from there, so a piece that was already scaled zooms from where it is. That also made writing the clip values again dead code, so it is gone: the first keyframe already says what the clip says.
- `Segment` in `capcut/types.ts` gained a typed `common_keyframes`, since keyframes are now something the app writes rather than only reads.

Checked for real on 0917 (the draft is left holding the write):
- One Claude Code call planned the text, the sounds and the zooms together (24.3 s, nothing dropped): a drift on the opening piece, a punch on "ไม่ได้ครับ", and a drift on the countdown — 3 zooms of the 6 pieces offered, which is the one-per-10-s cap on a 22 s clip.
- The draft holds what was expected: piece 0 `KFTypeScaleX` 1 → 1.08 over 5.44 s with `KFTypePositionY` 0 → −0.016 (the face band's middle is 40 % down the frame, so `faceY` 0.2 and the shift 0.2 × (1 − 1.08)); piece 2 holds at 1 for 0.115 s — where the highlight line lands — then rises to 1.15 by 0.465 s; piece 4 drifts again. The other three pieces are untouched.

Not done: watching it in CapCut, and whether CapCut keeps the keyframes when it saves over the draft.
