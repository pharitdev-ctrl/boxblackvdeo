import { cardFraming, coverFraming, type Framing } from "@boxblack/core/capcut/framing"
import type { CutClip, CutPlan } from "@boxblack/core/cut"
import { FLAIR_LEVELS, type FlairLevel, type FlairOptions } from "@boxblack/core/flair/catalogue"
import { checkMove, faceAfter, isMove, poseAt, zoomCap, type Look, type MoveCue, type Pose, type ShareBox } from "@boxblack/core/flair/moves"
import type { CueAnchor, PlacedInsert, PlacedZoom } from "@boxblack/core/flair/plan"
import type { TimelineMove } from "@boxblack/core/capcut/moves"
import type { GraphicBox } from "@boxblack/core/graphics/plan"
import { pointFilter, type PlacedPoint, type PointFilter } from "@boxblack/core/emphasis"
import type { TimedGroup } from "@boxblack/core/highlights"
import type { BinMedia } from "@boxblack/core/flair/media"
import { OBJECTS_VERSION } from "@boxblack/core/vision"
import type { MoveAnchor, MoveView, StoredOutline } from "../shared/api.ts"
import type { Band, Span } from "./graphics-cues.ts"
import { insertsInForce, itemPlaceOf, keepClearAt, placeOf, type ItemPlace } from "./insert-media.ts"
import { samePlace, slotsFor } from "./sound-cues.ts"
import { spokenSentences, wordsIn } from "./spoken.ts"
import { pieceKey, type PieceSlot } from "./zoom-cues.ts"

/*
 * Where Claude's moves of the picture play on the rough cut, whether each may, and where the faces are once the
 * picture has moved (spec §5, §6). A move on a word plays on the piece that word is said in; a move on a cutaway
 * plays on that cutaway from its first frame.
 */

/** A move with where it plays on the rough cut, how long, and the poses the writer is handed for it. */
export type PlacedMove = {
  /** as stored, which an edit finds it by */
  cue: MoveCue
  /** where it starts on the rough cut */
  atUs: number
  /** how long its poses run before it holds the last: to its last pose, or less where its piece or cutaway ends first */
  durationUs: number
  /** the beat it plays in */
  beatId: string
  /** where it starts, from the start of its piece or cutaway: a `TimelineMove`'s `startUs` */
  startUs: number
  /** its poses cut at `durationUs`: those before it, and one sampled there when any was cut */
  poses: Pose[]
} & ({ /** the piece it moves, by its place among the rough cut's pieces */ cut: number; insertIndex?: undefined } | { /** the cutaway it moves, by its place in the cutaways in force */ insertIndex: number; cut?: undefined })

/** A switched-off move, judged as if it played: where it would, or null where it has no place (it would be lost), and why it could not play there. */
export interface OffMove {
  cue: MoveCue
  placed: PlacedMove | null
  why: string | null
}

type Canvas = { width: number; height: number }

/** How the picture sits before any move: as the piece already is. */
const IDENTITY: Look = { scale: 1, x: 0, y: 0, rot: 0 }

/** Moments a span is looked at, a thirtieth of a second apart, like the frames it plays on. */
const SAMPLE_US = 1_000_000 / 30

const overlaps = (a: Span, b: Span) => a.startUs < b.endUs && b.startUs < a.endUs

/** A piece of the rough cut: where it plays, and the stretch of its video it plays. */
interface Piece {
  cut: number
  clip: CutClip | undefined
  atUs: number
  endUs: number
  sourceStartUs: number
}

/**
 * How a main piece is laid before any move. A piece is written at scale 1, where CapCut draws a video "fit": one of
 * its sides spans the canvas. A video of the canvas's own shape so fills it and needs no base; one of another shape
 * leaves a band of background either side, which a move has to push in far enough to cover. A video whose size is
 * not known is taken to fill the canvas.
 */
function pieceBase(clip: CutClip | undefined, canvas: Canvas): Framing | undefined {
  if (!clip?.width || !clip.height) return undefined
  const fit = Math.min(canvas.width / clip.width, canvas.height / clip.height)
  const drawn = { width: clip.width * fit, height: clip.height * fit }
  if (Math.abs(drawn.width - canvas.width) < 0.5 && Math.abs(drawn.height - canvas.height) < 0.5) return undefined
  return { scale: 1, x: 0, y: 0, drawn }
}

/** How far a main piece may be pushed in: from its video's size, or, where that is not known, as for a video of the canvas's own size (1.3 below 4K). */
export const pieceCap = (clip: CutClip | undefined, canvas: Canvas) => (clip?.width && clip.height ? zoomCap({ width: clip.width, height: clip.height }, canvas) : zoomCap(canvas, canvas))

/**
 * The faces and the shown things of one scene of a clip, in the picture's shares. The faces are the keep objects the
 * objects pass marked as faces. A pass made before faces, of another version than OBJECTS_VERSION, could mark none,
 * and then every keep object counts as a face (spec §8), whatever it holds; a current pass that marked none found no
 * face, and has none. The shown things are
 * the other keep objects. A clip the pass has not run on, or a scene its objects miss, keeps the scene's keepClear
 * band as a face, and shows nothing. For the text and the graphics (`across`) the band spans the whole width; for a
 * move's check it is a line down the middle of the frame, so the band is checked only up and down: a band across the
 * whole width would leave the frame at the sides with any push at all.
 */
function boxesOf(clip: CutClip, index: number, across = false): { faces: ShareBox[]; shown: ShareBox[] } {
  const objects = clip.objects?.scenes[index]
  if (!objects) {
    const band = clip.insight?.scenes[index]?.keepClear
    const [x0, x1] = across ? [0, 1] : [0.5, 0.5]
    return { faces: band ? [{ x0, y0: band.fromY, x1, y1: band.toY }] : [], shown: [] }
  }
  const keeps = objects.filter((object) => object.kind === "keep")
  const knowsFaces = clip.objects!.version === OBJECTS_VERSION
  if (!knowsFaces) return { faces: keeps.map((object) => object.box), shown: [] }
  return { faces: keeps.filter((object) => object.face === true).map((object) => object.box), shown: keeps.filter((object) => object.face !== true).map((object) => object.box) }
}

/** The faces and shown things of every scene a piece plays over a stretch of it, from `fromUs` to `toUs` after its start; a stretch of no length is the scene at that moment. */
function boxesOver(piece: Piece, fromUs: number, toUs: number): { faces: ShareBox[]; shown: ShareBox[] } {
  const source = { startUs: piece.sourceStartUs + fromUs, endUs: piece.sourceStartUs + Math.max(toUs, fromUs + 1) }
  const faces: ShareBox[] = []
  const shown: ShareBox[] = []
  piece.clip?.insight?.scenes.forEach((scene, index) => {
    if (!overlaps(scene, source)) return
    const boxes = boxesOf(piece.clip!, index)
    faces.push(...boxes.faces)
    shown.push(...boxes.shown)
  })
  return { faces, shown }
}

/** Whether poses can be cut at all: they start at or after the move's start and run forward. Others go to the check as they are, which turns them down. */
const runForward = (poses: Pose[]) => poses[0] !== undefined && poses[0].s >= 0 && poses.every((pose, i) => i === 0 || pose.s > poses[i - 1]!.s)

/**
 * A move's poses cut at `lengthS`: those before it, and, when any was cut, one there sampled with `poseAt`, reached
 * with the ease of the first pose cut.
 */
function cutAt(poses: Pose[], lengthS: number): Pose[] {
  if (!runForward(poses)) return poses
  const before = poses.filter((pose) => pose.s < lengthS)
  if (before.length === poses.length) return poses
  const sample = poseAt(poses, lengthS)
  return [...before, { s: lengthS, scale: sample.scale, x: sample.x, y: sample.y, rot: sample.rot, ease: poses[before.length]!.ease }]
}

/**
 * The poses a move plays as the writer lays it on its piece (`addMoves`): after another move, or later than the
 * piece's start, it starts from the pose held then (`held`), its first pose taking that look, unless that pose is a
 * cut. The first move at the piece's very start (`held` null) plays as it is.
 */
function seamed(poses: Pose[], held: Look | null): Pose[] {
  const first = poses[0]
  if (!first || held === null || first.ease === "cut") return poses
  return [{ ...first, scale: held.scale, x: held.x, y: held.y, rot: held.rot }, ...poses.slice(1)]
}

const lookOf = (pose: Pose): Look => ({ scale: pose.scale, x: pose.x, y: pose.y, rot: pose.rot })

/** A move on one piece as it plays there, after the seam. */
interface Played {
  placed: PlacedMove
  poses: Pose[]
}

/** The pose a piece holds `startUs` after its start, given the moves kept on it before then: the last one's last pose, at rest when there is none, and none at the piece's start with nothing before. */
function heldAt(kept: Played[], startUs: number): Look | null {
  const before = kept.filter((entry) => entry.placed.startUs <= startUs)
  const last = before.at(-1)
  if (last) return lookOf(last.poses.at(-1)!)
  return startUs > 0 ? IDENTITY : null
}

/**
 * Whether a move may play on a main piece beside the other moves kept there (`kept`, in start order, none
 * overlapping it): its poses as the writer lays them, cut at its end, checked (`checkMove`) against the faces and
 * shown things of the scenes it plays over; then, with `hold`, the pose it ends on, held until the next kept move or
 * the piece's end, checked scene by scene against the faces and things of each, since the writer holds it there.
 * `why` is null when it may.
 */
function judgeOnPiece(placed: PlacedMove, piece: Piece, kept: Played[], canvas: Canvas, hold: boolean): { poses: Pose[]; why: string | null } {
  const poses = seamed(placed.poses, heldAt(kept, placed.startUs))
  const base = pieceBase(piece.clip, canvas)
  const cap = pieceCap(piece.clip, canvas)
  const endUs = placed.startUs + placed.durationUs
  const own = boxesOver(piece, placed.startUs, endUs)
  const check = checkMove({ poses }, { canvas, cap, lengthS: placed.durationUs / 1_000_000, faces: own.faces.length > 0 ? own.faces : null, shown: own.shown, card: null, ...(base ? { base } : {}) })
  if (!check.ok || !hold) return { poses, why: check.ok ? null : check.why }
  const nextUs = kept.find((entry) => entry.placed.startUs > placed.startUs)?.placed.startUs ?? piece.endUs - piece.atUs
  if (nextUs <= endUs) return { poses, why: null }
  const last = poses.at(-1)!
  const source = { startUs: piece.sourceStartUs + endUs, endUs: piece.sourceStartUs + nextUs }
  for (const [index, scene] of (piece.clip?.insight?.scenes ?? []).entries()) {
    if (!overlaps(scene, source)) continue
    const boxes = boxesOf(piece.clip!, index)
    const still = checkMove({ poses: [{ ...last, s: 0 }] }, { canvas, cap, lengthS: 0, faces: boxes.faces.length > 0 ? boxes.faces : null, shown: boxes.shown, card: null, ...(base ? { base } : {}) })
    if (!still.ok) return { poses, why: `the pose it holds afterwards fails: ${still.why}` }
  }
  return { poses, why: null }
}

/**
 * Whether a move may play on a cutaway: its poses from the cutaway's first frame, cut at its end, on top of the
 * framing the writer gives the cutaway (`addInsertTrack`, with the same inputs). A card has to stay inside the
 * frame; a cover may not show its edge, and keeps the middle of its subject on screen when Claude said where that is.
 * The cap is from the picture's own size.
 */
function judgeOnInsert(placed: PlacedMove, insert: PlacedInsert, plan: CutPlan, clips: CutClip[], canvas: Canvas): string | null {
  const card = insert.cue.fit === "card"
  const subject = insert.cue.subject ?? null
  const base = card ? cardFraming(insert.media, canvas, keepClearAt(plan, clips, insert.atUs)) : coverFraming(insert.media, canvas, subject)
  const check = checkMove(
    { poses: placed.poses },
    {
      canvas,
      cap: zoomCap(insert.media, canvas),
      lengthS: placed.durationUs / 1_000_000,
      faces: null,
      shown: !card && subject ? [subject] : [],
      card: card ? { x0: 0, y0: 0, x1: 1, y1: 1 } : null,
      base,
    },
  )
  return check.ok ? null : check.why
}

/** The pieces of the rough cut, each where it plays (`at`). */
function piecesOf(plan: CutPlan, clips: CutClip[], at: (cut: number, sourceUs: number) => number): Piece[] {
  return plan.cuts.map((cut, index) => {
    const atUs = at(index, cut.sourceStartUs)
    return { cut: index, clip: clips.find((clip) => clip.id === cut.binId), atUs, endUs: atUs + cut.sourceDurationUs, sourceStartUs: cut.sourceStartUs }
  })
}

/** How long a move's poses run where it starts, cut where its room ends. */
const lengthIn = (cue: MoveCue, roomUs: number) => Math.max(0, Math.min(Math.round(cue.poses.at(-1)!.s * 1_000_000), roomUs))

/**
 * The moves that will really play, and the switched-off ones, placed on the rough cut. With the zoom switch off there
 * are none. A move shows from its own level up (`from`), and only while the point it is tied to, if any, is on the cut
 * (`pointPlaced`); one held back is neither listed nor counted. What is read is an outline file, outside the type
 * system: a stored entry that is no move (`isMove`) is left out the same way, as is a move on a cutaway while
 * cutaways are off.
 *
 * A move on a word plays where that word plays (`place`, itemPlaceOf: where its point starts now when the cut took
 * the word out), on the piece playing then; a move on a cutaway (`insert`) plays from the first frame of the cutaway
 * in force at its anchor (`inserts`, `insertsInForce`'s kept list, in the order the writer is handed them). One with
 * no place is counted `lost`. It plays until its last pose or its piece's (or cutaway's) end, whichever comes first,
 * and its poses are cut there (`cutAt`).
 *
 * On each piece the moves are taken in start order: one that starts before the move kept before it has finished, or
 * at the same moment, is dropped. Each is then checked as the writer lays it (`judgeOnPiece`, `judgeOnInsert`) and
 * dropped when it fails. A kept move whose held pose fails where a later move was dropped (the hold now runs on into
 * the scenes that move would have covered) is dropped in turn, and the piece judged again without it. `dropped`
 * counts them all.
 *
 * A switched-off move is judged as if it were switched on, against the moves kept: it is listed with why it could
 * not play, or with no place, and never counted. Both lists are in playing order.
 */
export function movesInForce(input: {
  /** the stored `flair.moves` */
  moves: MoveCue[]
  place: (anchor: CueAnchor, pointId?: string) => ItemPlace | null
  /** the cutaways in force (`insertsInForce`'s kept list), in the order the writer is handed them */
  inserts: PlacedInsert[]
  plan: CutPlan
  clips: CutClip[]
  /** where a source time of a kept piece plays on the rough cut */
  at: (cut: number, sourceUs: number) => number
  /** the frame the rough cut plays at; null when nothing is kept */
  canvas: Canvas | null
  flair: FlairOptions
  /** whether a point is placed on this rough cut, whatever its importance */
  pointPlaced: (pointId: string) => boolean
}): { kept: PlacedMove[]; off: OffMove[]; dropped: number; lost: number } {
  const canvas = input.canvas
  if (!input.flair.zoom || canvas === null) return { kept: [], off: [], dropped: 0, lost: 0 }
  const level = FLAIR_LEVELS.indexOf(input.flair.level)
  const pieces = piecesOf(input.plan, input.clips, input.at)
  let lost = 0
  let dropped = 0

  // each move that shows, where it would play
  const onPieces = new Map<number, PlacedMove[]>()
  const onInserts = new Map<number, PlacedMove[]>()
  const off: OffMove[] = []
  for (const cue of input.moves) {
    if (!isMove(cue)) continue
    if (FLAIR_LEVELS.indexOf(cue.from) > level || (cue.pointId !== undefined && !input.pointPlaced(cue.pointId))) continue
    if (cue.insert === true && !input.flair.insert) continue
    const placed = placeMove(cue, input, pieces)
    if (!placed) {
      if (cue.off) off.push({ cue, placed: null, why: null })
      else lost++
      continue
    }
    const list = placed.cut !== undefined ? onPieces : onInserts
    const key = placed.cut ?? placed.insertIndex!
    list.set(key, [...(list.get(key) ?? []), placed])
  }

  const kept: PlacedMove[] = []
  const judgedOff: OffMove[] = []
  const byStart = (a: PlacedMove, b: PlacedMove) => a.startUs - b.startUs
  for (const [cut, all] of onPieces) {
    const piece = pieces[cut]!
    const on = all.filter((placed) => !placed.cue.off).sort(byStart)
    const others = (played: Played[], placed: PlacedMove) => played.filter((entry) => entry.placed !== placed)
    // moves whose held pose failed: the piece is judged again without each, until none does
    const out = new Set<PlacedMove>()
    let played: Played[] = []
    for (;;) {
      played = []
      for (const placed of on) {
        if (out.has(placed)) continue
        const last = played.at(-1)?.placed
        if (last && (placed.startUs < last.startUs + last.durationUs || placed.startUs === last.startUs)) continue
        const judged = judgeOnPiece(placed, piece, played, canvas, false)
        if (judged.why === null) played.push({ placed, poses: judged.poses })
      }
      const failing = played.find((entry) => judgeOnPiece(entry.placed, piece, others(played, entry.placed), canvas, true).why !== null)
      if (!failing) break
      out.add(failing.placed)
    }
    kept.push(...played.map((entry) => entry.placed))
    dropped += on.length - played.length
    for (const placed of all.filter((entry) => entry.cue.off)) {
      const clash = played.some(({ placed: other }) => placed.startUs === other.startUs || (placed.startUs < other.startUs + other.durationUs && other.startUs < placed.startUs + placed.durationUs))
      const why = clash ? "it plays while another move on this piece does" : judgeOnPiece(placed, piece, played, canvas, true).why
      judgedOff.push({ cue: placed.cue, placed, why })
    }
  }
  for (const [index, all] of onInserts) {
    const insert = input.inserts[index]!
    // every move on a cutaway starts at its first frame, so only the first that passes plays there
    let taken = false
    for (const placed of all.filter((entry) => !entry.cue.off)) {
      if (!taken && judgeOnInsert(placed, insert, input.plan, input.clips, canvas) === null) {
        taken = true
        kept.push(placed)
      } else dropped++
    }
    for (const placed of all.filter((entry) => entry.cue.off)) {
      judgedOff.push({ cue: placed.cue, placed, why: taken ? "another move plays on this cutaway" : judgeOnInsert(placed, insert, input.plan, input.clips, canvas) })
    }
  }
  const byTime = (a: PlacedMove, b: PlacedMove) => a.atUs - b.atUs
  const offByTime = [...judgedOff.sort((a, b) => byTime(a.placed!, b.placed!)), ...off]
  return { kept: kept.sort(byTime), off: offByTime, dropped, lost }
}

/**
 * The moves of a stored outline as they play on its rough cut (`movesInForce`), placed as the preview places them: a
 * move on a word where that word plays, or where its point starts now (itemPlaceOf over `points`, the points placed on
 * this rough cut), and a move on a cutaway on the cutaways in force under `passes` (`insertsInForce`), which are
 * answered with them. `groups` are the highlight groups as they play, which the places of speech are found among.
 */
export function movesOnCut(input: {
  stored: StoredOutline
  plan: CutPlan
  clips: CutClip[]
  canvas: Canvas | null
  flair: FlairOptions
  points: PlacedPoint[]
  groups: TimedGroup[]
  /** the project's spare pictures, which the cutaways show */
  pictures: BinMedia[]
  /** which cutaways show (`insertsInForce`) */
  passes: PointFilter
  /** where a source time of a kept piece plays on the rough cut */
  at: (cut: number, sourceUs: number) => number
}): ReturnType<typeof movesInForce> & { inserts: PlacedInsert[] } {
  const { stored, plan, clips, at } = input
  const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
  const sentences = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at })
  const place = itemPlaceOf(placeOf({ slots: slotsFor({ plan, groups: input.groups, beatNames, at }), sentences, plan, at }), input.points)
  const inserts = insertsInForce({ inserts: stored.flair?.inserts ?? [], place, media: input.pictures, flair: input.flair, durationUs: plan.durationUs, passes: input.passes }).kept
  const moves = movesInForce({
    moves: stored.flair?.moves ?? [],
    place,
    inserts,
    plan,
    clips,
    at,
    canvas: input.canvas,
    flair: input.flair,
    pointPlaced: pointFilter(input.points, "heavy"),
  })
  return { ...moves, inserts }
}

/** Where a move plays and for how long, or null where it has no place: its word's piece, or its cutaway. */
function placeMove(cue: MoveCue, input: Parameters<typeof movesInForce>[0], pieces: Piece[]): PlacedMove | null {
  if (cue.insert === true) {
    const index = input.inserts.findIndex((insert) => samePlace(insert.cue.anchor, cue.anchor))
    const insert = input.inserts[index]
    if (!insert) return null
    const beatId = input.place(insert.cue.anchor, insert.cue.pointId)?.beatId ?? ""
    const roomUs = Math.min(insert.durationUs, input.plan.durationUs - insert.atUs)
    const durationUs = lengthIn(cue, roomUs)
    return { cue, atUs: insert.atUs, durationUs, beatId, startUs: 0, poses: cutAt(cue.poses, durationUs / 1_000_000), insertIndex: index }
  }
  const where = input.place(cue.anchor, cue.pointId)
  const piece = where && pieces.find((entry) => entry.atUs <= where.atUs && where.atUs < entry.endUs)
  if (!where || !piece) return null
  const durationUs = lengthIn(cue, piece.endUs - where.atUs)
  return { cue, atUs: where.atUs, durationUs, beatId: where.beatId, startUs: where.atUs - piece.atUs, poses: cutAt(cue.poses, durationUs / 1_000_000), cut: piece.cut }
}

/**
 * The moves as the post-production page shows them, the switched-off ones last, each carrying its stored anchor,
 * which an edit finds it by. A switched-off one with no place on the cut is not listed: there is nowhere to show it.
 */
export function moveViews(moves: { kept: PlacedMove[]; off: OffMove[] }): MoveView[] {
  const viewOf = (placed: PlacedMove, off: boolean): MoveView => {
    const { cue } = placed
    return {
      anchor: cue.anchor,
      insert: cue.insert === true,
      atUs: placed.atUs,
      durationUs: placed.durationUs,
      beatId: placed.beatId,
      about: cue.about,
      from: cue.from,
      ...(cue.pointId !== undefined ? { pointId: cue.pointId } : {}),
      edited: cue.edited,
      off,
      instruction: cue.instruction ?? null,
      editFailed: cue.editFailed ?? null,
      // isMove lets a previous through only as a move that can play
      canUndo: cue.previous !== undefined,
    }
  }
  return [...moves.kept.map((placed) => viewOf(placed, false)), ...moves.off.flatMap((entry) => (entry.placed ? [viewOf(entry.placed, true)] : []))]
}

/**
 * The legacy zooms in force (`zoomsInForce`) split by the moves kept: those on a piece no move plays on still play,
 * and those on a piece a move plays on are `replaced`, since a piece has one set of keyframes and the move wins
 * (`zoomsBesideMoves` in the writer). The page lists a replaced zoom as off, saying it was replaced by a move, while
 * its view keeps `off: false`: it is not switched off, and plays again when the move goes. The preview leaves it out
 * of the zooms in force.
 */
export function legacyZoomsBeside(zooms: PlacedZoom[], moves: PlacedMove[], slots: PieceSlot[]): { inForce: PlacedZoom[]; replaced: PlacedZoom[] } {
  const cutOf = new Map(slots.map((slot) => [pieceKey(slot.anchor), slot.cut]))
  const moved = new Set(moves.flatMap((move) => (move.cut !== undefined ? [move.cut] : [])))
  const inForce: PlacedZoom[] = []
  const replaced: PlacedZoom[] = []
  for (const zoom of zooms) {
    const cut = cutOf.get(pieceKey(zoom.cue.anchor))
    if (cut !== undefined && moved.has(cut)) replaced.push(zoom)
    else inForce.push(zoom)
  }
  return { inForce, replaced }
}

/** The look of a piece `us` after its start, under the moves kept on it: the move playing then or the last pose held, at rest before any. */
function lookOn(played: Played[], us: number): Look {
  const playing = played.filter((entry) => entry.placed.startUs <= us).at(-1)
  return playing ? poseAt(playing.poses, (us - playing.placed.startUs) / 1_000_000) : IDENTITY
}

/** The moves kept on each main piece, in start order, with the poses each plays after the seam. */
function playedByPiece(placed: PlacedMove[]): Map<number, Played[]> {
  const byPiece = new Map<number, Played[]>()
  const onPieces = placed.filter((move) => move.cut !== undefined).sort((a, b) => a.startUs - b.startUs)
  for (const move of onPieces) {
    const list = byPiece.get(move.cut!) ?? []
    list.push({ placed: move, poses: seamed(move.poses, heldAt(list, move.startUs)) })
    byPiece.set(move.cut!, list)
  }
  return byPiece
}

const clampShare = (value: number) => Math.min(Math.max(value, 0), 1)

/**
 * The boxes the picture must keep clear at any moment of a span of the rough cut, after the moves: each face and each
 * shown thing of every scene any piece plays inside the span (the same boxes the moves are checked against), as the
 * picture carries it, through the move playing on its piece at each moment (or the pose held, or none), looked at
 * every thirtieth of a second, and the union of where it went, in frame shares and cut to the frame. Each piece is where `at` puts it. A video the
 * objects pass has not run on keeps its scenes' keepClear bands, across the whole width. The cutaways' moves are not
 * counted: a cutaway is laid over the picture, which keeps its faces where they are. With no move these are the plain
 * boxes, but for a video of another shape than the canvas, which is mapped to where it is drawn.
 */
export function faceBoxesIn(span: Span, placed: PlacedMove[], plan: CutPlan, clips: CutClip[], canvas: Canvas, at: (cut: number, sourceUs: number) => number): GraphicBox[] {
  const played = playedByPiece(placed)
  const boxes: GraphicBox[] = []
  for (const piece of piecesOf(plan, clips, at)) {
    const index = piece.cut
    if (!overlaps(span, { startUs: piece.atUs, endUs: piece.endUs }) || !piece.clip) continue
    const base = pieceBase(piece.clip, canvas)
    const moves = played.get(index) ?? []
    piece.clip.insight?.scenes.forEach((scene, sceneIndex) => {
      // the part of the span this scene plays in on this piece, from the piece's start
      const fromUs = Math.max(span.startUs - piece.atUs, scene.startUs - piece.sourceStartUs, 0)
      const toUs = Math.min(span.endUs - piece.atUs, scene.endUs - piece.sourceStartUs, piece.endUs - piece.atUs)
      if (fromUs >= toUs) return
      const moments: number[] = []
      for (let us = fromUs; us < toUs; us += SAMPLE_US) moments.push(us)
      moments.push(toUs)
      const looks = moments.map((us) => lookOn(moves, us))
      const { faces, shown } = boxesOf(piece.clip!, sceneIndex, true)
      for (const box of [...faces, ...shown]) {
        const all = looks.map((look) => faceAfter(box, look, canvas, base))
        const union = all.reduce((sum, one) => ({ x0: Math.min(sum.x0, one.x0), y0: Math.min(sum.y0, one.y0), x1: Math.max(sum.x1, one.x1), y1: Math.max(sum.y1, one.y1) }))
        const cut = { x0: clampShare(union.x0), y0: clampShare(union.y0), x1: clampShare(union.x1), y1: clampShare(union.y1) }
        if (cut.x1 > cut.x0 && cut.y1 > cut.y0) boxes.push(cut)
      }
    })
  }
  return boxes
}

/** The band of the frame the faces and shown things take at any moment of a span, after the moves (`faceBoxesIn`), for the highlight text to keep off; null when there is nothing to keep clear. */
export function faceBandIn(span: Span, placed: PlacedMove[], plan: CutPlan, clips: CutClip[], canvas: Canvas, at: (cut: number, sourceUs: number) => number): Band | null {
  const boxes = faceBoxesIn(span, placed, plan, clips, canvas, at)
  if (boxes.length === 0) return null
  return boxes.reduce((band, box) => ({ fromY: Math.min(band.fromY, box.y0), toY: Math.max(band.toY, box.y1) }), { fromY: 1, toY: 0 })
}

/** Whether two moves are at one place: the same anchor, and both on a cutaway or both on the footage. */
export const sameMove = (a: { anchor: CueAnchor; insert?: boolean }, b: { anchor: CueAnchor; insert?: boolean }): boolean =>
  samePlace(a.anchor, b.anchor) && (a.insert === true) === (b.insert === true)

/** The place a move is named by on the page (`MoveAnchor`), as a stored move has it: its anchor, and whether it is on a cutaway. */
export function moveAt(named: MoveAnchor): { anchor: CueAnchor; insert: boolean } {
  const { insert, ...anchor } = named
  return { anchor: anchor as CueAnchor, insert: insert === true }
}

/**
 * The stored moves less Claude's moves on a cutaway left with no cutaway at their place, once cutaways were taken away
 * or moved (`inserts`, as they are stored now): there is nothing for them to move. The user's own stay, and so does
 * what the list holds that is no move on a cutaway.
 */
export function withoutStrandedMoves<T extends { anchor: CueAnchor; insert?: boolean; edited?: boolean }>(moves: T[], inserts: { anchor: CueAnchor }[]): T[] {
  return moves.filter((move) => move.insert !== true || move.edited === true || inserts.some((insert) => samePlace(insert.anchor, move.anchor)))
}

/**
 * The agent's moves (`TimelineMove`s on main pieces) placed as the checks here take them: each from its start on its
 * piece, running to its last pose or the piece's end, its poses cut there. Pieces are where `at` puts them.
 */
function placedFromTimeline(moves: TimelineMove[], pieces: Piece[]): PlacedMove[] {
  return moves.flatMap((move) => {
    const piece = pieces[move.cut]
    if (!piece || move.poses.length === 0) return []
    const roomUs = Math.max(0, piece.endUs - piece.atUs - move.startUs)
    const durationUs = Math.max(0, Math.min(Math.round(move.poses.at(-1)!.s * 1_000_000), roomUs))
    // a placed move needs a cue and a beat only to be found by an edit, which the agent's moves are not
    return [{ cue: { poses: move.poses } as unknown as MoveCue, beatId: "", atUs: piece.atUs + move.startUs, durationUs, startUs: move.startUs, poses: cutAt(move.poses, durationUs / 1_000_000), cut: move.cut }]
  })
}

/**
 * Why the agent's move may not play on main piece `cut` from `startUs` (after the piece's start) beside the agent's
 * other moves (`others`, none on the same stretch of that piece), or null when it may: judged as "ทำทั้งหมด" judges a
 * move (`judgeOnPiece`), against the faces and shown things of the scenes it plays over and, held afterwards, of those
 * up to the next move or the piece's end.
 */
export function agentMoveWhy(input: { plan: CutPlan; clips: CutClip[]; canvas: Canvas; at: (cut: number, sourceUs: number) => number; cut: number; startUs: number; poses: Pose[]; others: TimelineMove[] }): string | null {
  const pieces = piecesOf(input.plan, input.clips, input.at)
  const piece = pieces[input.cut]
  if (!piece) return "it has no piece to play on"
  const [placed] = placedFromTimeline([{ cut: input.cut, startUs: input.startUs, poses: input.poses }], pieces)
  if (!placed) return "it has no poses"
  const kept = playedByPiece(placedFromTimeline(input.others.filter((move) => move.cut === input.cut), pieces)).get(input.cut) ?? []
  return judgeOnPiece(placed, piece, kept, input.canvas, true).why
}

/** The faces and shown things on screen over a span of the rough cut with the agent's moves played (`faceBoxesIn`), in frame shares. */
export function agentKeepIn(input: { plan: CutPlan; clips: CutClip[]; canvas: Canvas; at: (cut: number, sourceUs: number) => number; span: Span; moves: TimelineMove[] }): GraphicBox[] {
  const placed = placedFromTimeline(input.moves, piecesOf(input.plan, input.clips, input.at))
  return faceBoxesIn(input.span, placed, input.plan, input.clips, input.canvas, input.at)
}

/**
 * The clips with their faces as the techniques call is told them: a clip whose objects pass is of another version than
 * OBJECTS_VERSION, made before faces, has every keep object marked a face, since a face not known is taken to be one
 * (spec §8), as the moves are checked (`move-cues.ts`). A clip of a current pass is as it is, one that marked no face
 * having none, and so is a clip the pass has not run on.
 */
export function withFacesKnown(clips: CutClip[]): CutClip[] {
  return clips.map((clip) => {
    const objects = clip.objects
    if (!objects || objects.version === OBJECTS_VERSION) return clip
    return { ...clip, objects: { ...objects, scenes: objects.scenes.map((scene) => scene.map((object) => (object.kind === "keep" ? { ...object, face: true } : object))) } }
  })
}
