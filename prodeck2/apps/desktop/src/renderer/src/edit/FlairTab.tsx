import type { ReactNode } from "react"
import { ZOOM_KINDS } from "@boxblack/core/flair/plan"
import type { MediaFit } from "@boxblack/core/flair/look-at"
import type { CueAnchor, EmphasisPointView, FlairOptions, GraphicPatch, GraphicView, HighlightPreview, PieceAnchor, ZoomKind } from "../../../shared/api.ts"
import type { BeatFlair } from "./byBeat.ts"
import { pointLabel } from "./postTabs.ts"
import { formatTimestamp, playedSeconds } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Empty } from "../ui/Empty.tsx"
import { Select } from "../ui/Select.tsx"

const cueKey = (anchor: CueAnchor) => JSON.stringify(anchor)
const pieceKey = (anchor: PieceAnchor) => `${anchor.videoId}:${anchor.sourceUs}`

/** What both lists show: one beat's, or the whole clip's, items, and every point on the cut to say which one each was made for. */
interface ListProps {
  flair: BeatFlair
  points: EmphasisPointView[]
  busy: boolean
}

export interface SoundListProps extends ListProps {
  sounds: HighlightPreview["sounds"]
  /** stored sounds of the whole clip that are not playing, and why */
  unused: HighlightPreview["unusedSounds"]
  onCue: (anchor: CueAnchor, effectId: string | null) => void
}

export interface TechniqueListProps extends ListProps {
  options: FlairOptions
  media: HighlightPreview["media"]
  /** graphics are on but nothing renders until the renderer pack is installed */
  graphicsWaitForPack: boolean
  /**
   * why graphics do not render though the pack may be installed, in one short line: the machine is at
   * fault (the pack damaged, the app's ffmpeg or a font missing), and none of them renders
   */
  graphicsProblem: HighlightPreview["graphicsProblem"]
  /** a plan run is going, of which a project has one at a time: no graphic can be written again until it is over */
  planning: boolean
  /** the graphic being written again, by its place, until the read that shows how it came out has landed; null when none is */
  redoing: CueAnchor | null
  /** a run that is not a redo is writing the graphics: one not written yet is being written, or waits its turn */
  writingGraphics: boolean
  /** `replacing`: the picture of the one cutaway changed, since several may sit at one place */
  onInsert: (anchor: CueAnchor, binId: string | null, fit?: MediaFit, replacing?: string) => void
  onZoom: (anchor: PieceAnchor, kind: ZoomKind | null) => void
  /** switches a graphic off or on, or removes it with null */
  onGraphic: (anchor: CueAnchor, patch: GraphicPatch | null) => void
  onRetryGraphic: (anchor: CueAnchor) => void
  /** has Claude write a graphic again, from its idea */
  onRedoGraphic: (anchor: CueAnchor) => void
}

/** The end of a failed render's error, or of why a writing failed, is where it says what went wrong; the rest would not fit a row. */
const lastLines = (error: string) =>
  error
    .split("\n")
    .filter((line) => line.trim())
    .slice(-3)
    .join(" ")

/** How a graphic stands, as its row says it: the words, the class they are drawn in, and the whole of a failure for a pointer held over its last lines. */
interface GraphicState {
  text: string
  className: string
  title?: string
}

/**
 * The one line that says how a graphic stands, the first of these that holds: it is the one being written again
 * (`redone`), whatever else is true of it; it is switched off; its last writing failed; the cut changed under it,
 * so it is to be written again; it is not written yet, which a run that is not a redo (`writing`) is doing, or
 * else it waits for the user to ask; and only then how its render stands.
 */
function graphicState(graphic: GraphicView, redone: boolean, writing: boolean): GraphicState {
  const plain = (key: MessageKey): GraphicState => ({ text: t(key), className: "graphic-state" })
  // what failed, then the last lines of why when it said any
  const failure = (key: MessageKey, why: string | null, className: string): GraphicState =>
    why ? { text: `${t(key)} · ${lastLines(why)}`, className, title: why } : { text: t(key), className }
  // whatever it read before was about the fragment being replaced, or about having none; and a redo writes a switched-off one too
  if (redone) return plain("graphics.state.writing")
  // a graphic switched off is not rendered or put in the draft, so how it stands otherwise does not matter
  if (graphic.off) return plain("graphics.offState")
  if (graphic.writeFailed !== null) return failure("graphics.state.writeFailed", graphic.writeFailed, "graphic-state warn-text")
  if (graphic.stale) return plain("graphics.state.stale")
  if (!graphic.written) return plain(writing ? "graphics.state.writing" : "graphics.state.unwritten")
  if (graphic.render === "failed") return failure("graphics.render.failed", graphic.error, "graphic-state failed")
  return { text: t(`graphics.render.${graphic.render}` as MessageKey), className: `graphic-state ${graphic.render}` }
}

/** Which point an item was made for, beside it, cut short when the row is narrow and whole when pointed at; nothing for one of the user's own. */
export function FromPoint({ points, pointId }: { points: EmphasisPointView[]; pointId: string | undefined }) {
  const label = pointLabel(points, pointId)
  return label ? (
    <span className="hint from-point" title={label}>
      {label}
    </span>
  ) : null
}

/**
 * A key for each cutaway row: its place and picture, and which of those it is, since one picture may be stacked
 * twice at one place. The row's own buttons name the cutaway by its picture, which reaches the first of such twins.
 */
function cutawayKeys(inserts: BeatFlair["inserts"]): string[] {
  const seen = new Map<string, number>()
  return inserts.map((insert) => {
    const base = `${cueKey(insert.anchor)}#${insert.binId}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return `${base}#${count}`
  })
}

/** One row of a list: when it plays, then what it is and what can be done with it. */
function ItemRow({ atUs, className = "flair-row", children }: { atUs: number; className?: string; children: ReactNode }) {
  return (
    <li className={className}>
      <span className="hint mono">{formatTimestamp(atUs)}</span>
      {children}
    </li>
  )
}

/** Work 4: a sound on each place of one beat, or of the whole clip, and why stored ones do not play. */
export function SoundList({ flair, points, sounds, unused, busy, onCue }: SoundListProps) {
  const cues = new Map(flair.cues.map((cue) => [cueKey(cue.anchor), cue]))
  return (
    <div className="flair">
      {unused.unplaced > 0 && <p className="notice warn-text">{t("flair.unplaced", { count: unused.unplaced })}</p>}
      {unused.missing > 0 && <p className="notice warn-text">{t("flair.missing", { count: unused.missing })}</p>}
      {unused.pro > 0 && <p className="notice warn-text">{t("flair.needsPro", { count: unused.pro })}</p>}
      {unused.lost > 0 && <p className="notice warn-text">{t("flair.lost", { count: unused.lost })}</p>}
      {flair.slots.length === 0 ? (
        <Empty title={t("edit.flairEmpty")} />
      ) : (
        <>
          <p className="tab-section">{t("edit.flairPoints")}</p>
          {sounds.length === 0 && <p className="notice warn-text">{t("flair.noSounds")}</p>}
          <ol className="flair-rows">
            {flair.slots.map((slot) => {
              const cue = cues.get(cueKey(slot.anchor))
              return (
                <ItemRow key={cueKey(slot.anchor)} atUs={slot.atUs}>
                  <span className="flair-what">{slot.what}</span>
                  {sounds.length > 0 && (
                    <Select label={t("flair.sound.label", { what: slot.what })} value={cue?.effectId ?? ""} disabled={busy} onChange={(effectId) => onCue(slot.anchor, effectId || null)}>
                      <option value="">{t("flair.sound.none")}</option>
                      {sounds.map((sound) => (
                        <option key={sound.effectId} value={sound.effectId}>
                          {sound.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  <FromPoint points={points} pointId={cue?.pointId} />
                  {cue?.edited && <span className="hint">{t("flair.edited")}</span>}
                </ItemRow>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}

/** Work 2's techniques in one beat, or the whole clip: a zoom on a piece, a cutaway or a graphic on a point. */
export function TechniqueList({
  flair,
  points,
  options,
  media,
  graphicsWaitForPack,
  graphicsProblem,
  planning,
  redoing,
  writingGraphics,
  busy,
  onInsert,
  onZoom,
  onGraphic,
  onRetryGraphic,
  onRedoGraphic,
}: TechniqueListProps) {
  const zooms = new Map(flair.zooms.map((zoom) => [pieceKey(zoom.anchor), zoom]))
  const insertKeys = cutawayKeys(flair.inserts)
  // the graphic being written again is known by its place, not as the object it was listed as: every read of the
  // preview brings new objects, and its own writing causes one
  const redoingKey = redoing === null ? null : cueKey(redoing)
  const pieces = options.zoom && flair.pieces.length > 0
  if (!pieces && !options.insert && !options.graphic) return <Empty title={t("edit.flairEmpty")} />

  return (
    <div className="flair">
      {pieces && (
        <>
          <p className="tab-section">{t("edit.flairZooms")}</p>
          <ol className="flair-rows">
            {flair.pieces.map((piece) => {
              const zoom = zooms.get(pieceKey(piece.anchor))
              return (
                <ItemRow key={pieceKey(piece.anchor)} atUs={piece.atUs}>
                  <span className="flair-what">{piece.what}</span>
                  <span className="flair-length">{t("edit.pieceLength", { seconds: (piece.durationUs / 1_000_000).toFixed(1) })}</span>
                  <Select label={t("flair.zoom.label", { what: piece.what })} value={zoom?.kind ?? ""} disabled={busy} onChange={(kind) => onZoom(piece.anchor, (kind || null) as ZoomKind | null)}>
                    <option value="">{t("flair.zoom.none")}</option>
                    {ZOOM_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`flair.zoom.${kind}` as MessageKey)}
                      </option>
                    ))}
                  </Select>
                  <FromPoint points={points} pointId={zoom?.pointId} />
                  {zoom?.edited && <span className="hint">{t("flair.edited")}</span>}
                </ItemRow>
              )
            })}
          </ol>
        </>
      )}

      {options.insert && (
        <>
          <p className="tab-section">{t("edit.flairInserts")}</p>
          {media.length === 0 && <p className="notice warn-text">{t("flair.noMedia")}</p>}
          {media.length > 0 && flair.inserts.length === 0 && <p className="hint">{t("inserts.pickHint")}</p>}
          {flair.inserts.length > 0 && (
            <ol className="flair-rows">
              {flair.inserts.map((insert, index) => (
                // several may sit at one place, so the place alone does not tell them apart
                <ItemRow key={insertKeys[index]} atUs={insert.atUs}>
                  <span className="mark insert">🖼 {insert.picture}</span>
                  <span className="flair-what">{insert.what}</span>
                  <span className="flair-length">{t("edit.pieceLength", { seconds: (insert.durationUs / 1_000_000).toFixed(1) })}</span>
                  <FromPoint points={points} pointId={insert.pointId} />
                  {insert.edited && <span className="hint">{t("flair.edited")}</span>}
                  <Button size="xs" aria-label={t("inserts.fitLabel", { picture: insert.picture })} disabled={busy} onClick={() => onInsert(insert.anchor, insert.binId, insert.fit === "cover" ? "card" : "cover", insert.binId)}>
                    {t(`inserts.fit.${insert.fit}` as MessageKey)}
                  </Button>
                  <Button size="xs" aria-label={t("inserts.removeLabel", { picture: insert.picture })} disabled={busy} onClick={() => onInsert(insert.anchor, null, undefined, insert.binId)}>
                    {t("inserts.remove")}
                  </Button>
                </ItemRow>
              ))}
            </ol>
          )}
        </>
      )}

      {options.graphic && (
        <>
          <p className="tab-section">{t("edit.flairGraphics")}</p>
          {/* an installed pack can still be unusable: then saying it is not installed would send the user the wrong way */}
          {graphicsProblem ? (
            <p className="notice warn-text">{t("graphics.problem", { problem: graphicsProblem.text })}</p>
          ) : (
            graphicsWaitForPack && <p className="notice warn-text">{t("graphics.waitForPack")}</p>
          )}
          {flair.graphics.length === 0 && <p className="hint">{t("graphics.none")}</p>}
          {flair.graphics.length > 0 && (
            <ol className="flair-rows">
              {flair.graphics.map((graphic) => {
                const named = { summary: graphic.summary }
                const failed = !graphic.off && graphic.render === "failed"
                const key = cueKey(graphic.anchor)
                const state = graphicState(graphic, key === redoingKey, writingGraphics)
                return (
                  <ItemRow key={key} atUs={graphic.atUs} className={graphic.off ? "flair-row graphic off" : "flair-row graphic"}>
                    {/* the summary is written beside the poster, so the poster itself says nothing more */}
                    {graphic.poster ? <img className="graphic-poster" src={graphic.poster} alt="" /> : <span className="graphic-poster-none" aria-hidden />}
                    <span className="graphic-body">
                      {/* the summary is the graphic's idea, which the row holds to two lines: the whole of it is there for a pointer held over it */}
                      <span className="flair-what" title={graphic.summary}>
                        {graphic.summary}
                      </span>
                      <span className="hint graphic-why">{graphic.why || graphic.what}</span>
                      <FromPoint points={points} pointId={graphic.pointId} />
                      <span className={state.className} title={state.title}>
                        {state.text}
                      </span>
                      {graphic.edited && <span className="hint">{t("flair.edited")}</span>}
                    </span>
                    {/* how long it plays, which the end of its sentence's piece can make shorter than its length */}
                    <span className="flair-length">{t("edit.pieceLength", { seconds: playedSeconds(graphic.durationUs) })}</span>
                    <span className="graphic-actions">
                      <Button size="xs" aria-label={t("graphics.redoLabel", named)} disabled={busy || planning} onClick={() => onRedoGraphic(graphic.anchor)}>
                        {t("graphics.redo")}
                      </Button>
                      {failed && (
                        <Button size="xs" aria-label={t("graphics.retryLabel", named)} disabled={busy} onClick={() => onRetryGraphic(graphic.anchor)}>
                          {t("graphics.retry")}
                        </Button>
                      )}
                      <Button size="xs" aria-label={t(graphic.off ? "graphics.onLabel" : "graphics.offLabel", named)} disabled={busy} onClick={() => onGraphic(graphic.anchor, { off: !graphic.off })}>
                        {graphic.off ? t("graphics.on") : t("graphics.off")}
                      </Button>
                      <Button size="xs" aria-label={t("graphics.removeLabel", named)} disabled={busy} onClick={() => onGraphic(graphic.anchor, null)}>
                        {t("graphics.remove")}
                      </Button>
                    </span>
                  </ItemRow>
                )
              })}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
