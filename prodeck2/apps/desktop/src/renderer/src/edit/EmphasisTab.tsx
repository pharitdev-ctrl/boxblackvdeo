import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { EMPHASIS_REASON_MAX, EMPHASIS_TYPES, IMPORTANCE } from "@boxblack/core/emphasis/types"
import type {
  EmphasisAnchor,
  EmphasisPatch,
  EmphasisPointView,
  EmphasisSceneView,
  EmphasisSentenceView,
  EmphasisType,
  FlairLevel,
  HighlightPreview,
  Importance,
} from "../../../shared/api.ts"
import { formatTimestamp } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Empty } from "../ui/Empty.tsx"
import { Select } from "../ui/Select.tsx"
import { PicturePicker } from "./PicturePicker.tsx"
import { LevelControl } from "./TabSettings.tsx"

export interface EmphasisTabProps {
  /** the points of the open beat, or of the whole clip, in playing order */
  points: EmphasisPointView[]
  /** its spoken sentences, read only, to pick words from */
  sentences: EmphasisSentenceView[]
  /** its kept scenes of picture beats */
  scenes: EmphasisSceneView[]
  level: FlairLevel
  onLevel: (level: FlairLevel) => void
  /** stored points not on the cut now */
  hidden: number
  /**
   * what the last run of the points (the plan, or a rethink of the points) could not use of them: the
   * emphasis state main keeps, and the room with it, while other works are thought again; the strip's
   * own line says the same
   */
  dropped: number
  busy: boolean
  writing: boolean
  /** importance, type, reason or phrase changed; null deletes. Answers why main refused it, or null once saved */
  onChange: (id: string, patch: EmphasisPatch | null) => Promise<string | null>
  /** a point of the user's; answers why main refused it, or null once saved */
  onAdd: (anchor: EmphasisAnchor) => Promise<string | null>
  /**
   * highlight text is on: the words of a point with no text yet become a group made for it (the "Aa เน้น"
   * button moved from the speech rows). Made for the point, it follows the point's level, as a graphic does
   */
  onText?: (point: EmphasisPointView) => void
  /**
   * cutaways are on: the project's pictures, and the point's own cutaway put, changed or taken off by hand (the
   * "รูป" button moved from the speech rows). Main finds the point's cutaway; it follows the point's level
   */
  media?: HighlightPreview["media"]
  onPicture?: (point: EmphasisPointView, binId: string | null) => void
  /** the picture of the point's own cutaway, if it has one: the page finds it among the cutaways the preview lists */
  chosenPicture?: (point: EmphasisPointView) => string | undefined
}

/** Words picked in one sentence of the list, counted inside that sentence: [from, to). */
interface Picked {
  sentence: number
  from: number
  to: number
}

/** A word of the list: its sentence, and its place inside it. */
interface WordAt {
  sentence: number
  at: number
}

/** The words of a sentence another point already stresses, counted inside the sentence; the point being moved gives its own back. */
function takenWords(sentence: EmphasisSentenceView, points: EmphasisPointView[], moving: string | null): Set<number> {
  const taken = new Set<number>()
  for (const point of points) {
    const anchor = point.anchor
    if (point.id === moving || anchor.kind !== "speech" || anchor.videoId !== sentence.videoId || anchor.beatId !== sentence.beatId) continue
    for (let word = Math.max(anchor.from, sentence.from); word < Math.min(anchor.to, sentence.to); word++) taken.add(word - sentence.from)
  }
  return taken
}

/** Picked words as a point's anchor: their numbers in the transcript. */
const speechAnchor = (sentence: EmphasisSentenceView, picked: Picked): EmphasisAnchor => ({
  kind: "speech",
  videoId: sentence.videoId,
  from: sentence.from + picked.from,
  to: sentence.from + picked.to,
  beatId: sentence.beatId,
})

const sceneAnchor = (scene: EmphasisSceneView): EmphasisAnchor => ({ kind: "scene", videoId: scene.videoId, startUs: scene.startUs, endUs: scene.endUs, beatId: scene.beatId })

/** A point's reason, saved when the user leaves it or presses Enter; one left as it was is not sent. */
function ReasonInput({ point, disabled, onChange }: { point: EmphasisPointView; disabled: boolean; onChange: EmphasisTabProps["onChange"] }) {
  const [text, setText] = useState(point.reason)
  return (
    <input
      type="text"
      className="emphasis-reason"
      aria-label={t("emphasis.reasonLabel", { text: point.text })}
      maxLength={EMPHASIS_REASON_MAX}
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const trimmed = text.trim()
        if (trimmed !== point.reason) void onChange(point.id, { reason: trimmed })
      }}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
    />
  )
}

/**
 * Work 1: the points the clip stresses, each with its importance, type and reason, and the words and
 * scenes to make new ones from or to move one to. The level set here decides which points get effects.
 */
export function EmphasisTab(props: EmphasisTabProps) {
  const { points, sentences, scenes, level, onLevel, hidden, dropped, busy, writing, onChange, onAdd, onText, media, onPicture, chosenPicture } = props
  const [picked, setPicked] = useState<Picked | null>(null)
  // the point whose phrase is being moved: the words or the scene picked next become its new place
  const [moving, setMoving] = useState<string | null>(null)
  // the word of the list the keyboard stops on, once the user has moved to one
  const [stop, setStop] = useState<WordAt | null>(null)
  // a point being deleted, and its place in the list: once it is gone the focus goes to the row now there
  const [removing, setRemoving] = useState<{ id: string; index: number } | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const grid = useRef<HTMLOListElement>(null)
  // the focus is on a word: a word that becomes another point's hands it on rather than drop it
  const onGrid = useRef(false)
  const locked = busy || writing
  // each sentence's words other points stress
  const takenOf = sentences.map((sentence) => takenWords(sentence, points, moving))

  const one = (sentence: number, word: number): Picked => ({ sentence, from: word, to: word + 1 })
  const pick = (index: number, word: number) => {
    const taken = takenOf[index]!
    setPicked((current) => {
      if (!current || current.sentence !== index) return one(index, word)
      // a lone word picked again is let go
      if (current.from === word && current.to === word + 1) return null
      // a word inside the stretch starts the pick again from it, so a stretch can be made shorter
      if (word >= current.from && word < current.to) return one(index, word)
      const from = Math.min(current.from, word)
      const to = Math.max(current.to, word + 1)
      // a stretch may not reach over another point's words: it starts again from the word just picked
      for (let inside = from; inside < to; inside++) if (taken.has(inside)) return one(index, word)
      return { sentence: index, from, to }
    })
  }
  const settle = () => {
    setPicked(null)
    setMoving(null)
  }
  const place = async (anchor: EmphasisAnchor) => {
    const refused = moving ? await onChange(moving, { anchor }) : await onAdd(anchor)
    // a refusal (the words overlap another point, say) keeps the pick and the move, to be changed and tried again
    if (refused === null) settle()
  }
  const remove = (point: EmphasisPointView, index: number) => {
    // the move of a point that goes has nothing left to move
    if (moving === point.id) settle()
    setRemoving({ id: point.id, index })
    void onChange(point.id, null).then((refused) => refused !== null && setRemoving(null))
  }
  // the row deleted is gone: the focus goes to the row that took its place, or the one before, or the list's heading
  useEffect(() => {
    if (!removing || points.some((point) => point.id === removing.id)) return
    const rows = Array.from(list.current?.children ?? []) as HTMLElement[]
    ;(rows[removing.index] ?? rows[removing.index - 1] ?? heading.current)?.focus()
    setRemoving(null)
  }, [points, removing])

  const free = (word: WordAt): boolean => word.sentence < sentences.length && word.at >= 0 && word.at < sentences[word.sentence]!.words.length && !takenOf[word.sentence]!.has(word.at)
  /** Every free word, in reading order. */
  const freeWords = (): WordAt[] => sentences.flatMap((sentence, index) => sentence.words.flatMap((_, at) => (free({ sentence: index, at }) ? [{ sentence: index, at }] : [])))
  /** The one word of the whole list the keyboard stops on: the one moved to, else the first picked, else the first free. */
  const tabStop: WordAt | null = stop && free(stop) ? stop : picked && free({ sentence: picked.sentence, at: picked.from }) ? { sentence: picked.sentence, at: picked.from } : (freeWords()[0] ?? null)
  const focusWord = (word: WordAt) => {
    setStop(word)
    grid.current?.children[word.sentence]?.querySelectorAll<HTMLButtonElement>(".emphasis-words button")[word.at]?.focus()
  }
  /** The free word of a sentence nearest a place in it, or none. */
  const nearestIn = (index: number, at: number): WordAt | null => {
    const found = freeWords()
      .filter((word) => word.sentence === index)
      .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0]
    return found ?? null
  }
  /**
   * The words as one control: left and right along a sentence's free words, up and down to the sentence above or
   * below onto its free word nearest the same place, home and end to the sentence's first and last free word.
   */
  const moveAlong = (event: KeyboardEvent<HTMLButtonElement>, index: number, at: number) => {
    const inSentence = freeWords().filter((word) => word.sentence === index)
    let target: WordAt | null | undefined
    if (event.key === "ArrowRight") target = inSentence.find((word) => word.at > at)
    else if (event.key === "ArrowLeft") target = inSentence.filter((word) => word.at < at).at(-1)
    else if (event.key === "Home") target = inSentence[0]
    else if (event.key === "End") target = inSentence.at(-1)
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1
      for (let other = index + step; other >= 0 && other < sentences.length && !target; other += step) target = nearestIn(other, at)
    } else return
    event.preventDefault()
    if (target) focusWord(target)
  }
  // a word the focus is on that another point now stresses hands it on: to the next free word, else the one before
  useEffect(() => {
    if (!onGrid.current || !stop || free(stop)) return
    const order = freeWords()
    const after = order.find((word) => word.sentence > stop.sentence || (word.sentence === stop.sentence && word.at > stop.at))
    const next = after ?? order.at(-1)
    if (next) focusWord(next)
    // what makes a word another point's: the points, the sentences, and the point being moved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, sentences, moving])

  const pickedSentence = picked ? sentences[picked.sentence] : undefined
  const pickedAnchor = picked && pickedSentence ? speechAnchor(pickedSentence, picked) : null

  return (
    <div className="emphasis">
      <div className="tab-settings">
        <LevelControl level={level} onLevel={onLevel} disabled={writing} />
      </div>
      {hidden > 0 && <p className="hint">{t("emphasis.hidden", { count: hidden })}</p>}
      {dropped > 0 && <p className="notice warn-text">{t("emphasis.dropped", { count: dropped })}</p>}
      <h2 className="tab-section" tabIndex={-1} ref={heading}>
        {t("emphasis.pointsTitle")}
      </h2>
      {points.length === 0 ? (
        <Empty title={t("emphasis.empty")} />
      ) : (
        <ol className="emphasis-points" ref={list}>
          {points.map((point, index) => (
            <li key={point.id} className={point.shown ? "emphasis-point" : "emphasis-point off"} tabIndex={-1}>
              <div className="emphasis-head">
                <span className="hint mono">{formatTimestamp(point.atUs)}</span>
                <q className="emphasis-text">{point.text}</q>
                <span className="tag">{t(point.source === "ai" ? "emphasis.source.ai" : "emphasis.source.user")}</span>
                {!point.shown && <span className="hint">{t("emphasis.notShown")}</span>}
                <span className="grow" />
                {/* a point with text already has what this would make, text a graphic takes the place of included: main counts it on the point all the same; one the level holds back counts none it has */}
                {onText && point.anchor.kind === "speech" && point.shown && point.items.text === 0 && (
                  <Button size="xs" aria-label={t("highlights.addLabel", { text: point.text })} disabled={locked} onClick={() => onText(point)}>
                    {`Aa ${t("highlights.add")}`}
                  </Button>
                )}
                {onPicture && media && media.length > 0 && (
                  <PicturePicker label={t("inserts.pickLabel", { text: point.text })} chosen={chosenPicture?.(point)} media={media} busy={locked} onPick={(binId) => onPicture(point, binId)} />
                )}
                <Button
                  size="xs"
                  aria-label={t("emphasis.moveLabel", { text: point.text })}
                  aria-pressed={moving === point.id}
                  disabled={locked}
                  onClick={() => {
                    setPicked(null)
                    setMoving(moving === point.id ? null : point.id)
                  }}
                >
                  {t("emphasis.move")}
                </Button>
                <Button size="xs" aria-label={t("emphasis.deleteLabel", { text: point.text })} disabled={locked} onClick={() => remove(point, index)}>
                  {t("emphasis.delete")}
                </Button>
              </div>
              <div className="emphasis-fields">
                <Select
                  label={t("emphasis.importanceLabel", { text: point.text })}
                  value={point.importance}
                  disabled={locked}
                  onChange={(importance) => void onChange(point.id, { importance: importance as Importance })}
                >
                  {IMPORTANCE.map((value) => (
                    <option key={value} value={value}>
                      {t(`emphasis.importance.${value}` as MessageKey)}
                    </option>
                  ))}
                </Select>
                <Select label={t("emphasis.typeLabel", { text: point.text })} value={point.type} disabled={locked} onChange={(type) => void onChange(point.id, { type: type as EmphasisType })}>
                  {EMPHASIS_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(`emphasis.type.${value}` as MessageKey)}
                    </option>
                  ))}
                </Select>
                {/* keyed by the stored reason, so a reason saved elsewhere replaces what the box holds */}
                <ReasonInput key={`${point.id}:${point.reason}`} point={point} disabled={locked} onChange={onChange} />
              </div>
              <p className="hint">
                {t("emphasis.items", { ...point.items })}
                {point.edited ? ` · ${t("emphasis.edited")}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}

      {sentences.length > 0 && (
        <>
          <p className="tab-section">{t("emphasis.speechTitle")}</p>
          {moving && <p className="hint">{t("emphasis.moveHint")}</p>}
          <ol
            className="emphasis-sentences"
            ref={grid}
            onFocus={() => (onGrid.current = true)}
            onBlur={(event) => {
              // a word disabled under the focus blurs it too: that one hands it on (above) rather than leave the words
              if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !(event.target instanceof HTMLButtonElement && event.target.disabled)) onGrid.current = false
            }}
          >
            {sentences.map((sentence, index) => {
              const taken = takenOf[index]!
              return (
                <li key={`${sentence.videoId}:${sentence.beatId}:${sentence.from}`} className="emphasis-sentence">
                  <span className="hint mono">{formatTimestamp(sentence.atUs)}</span>
                  <span className="emphasis-words">
                    {sentence.words.map((word, at) => (
                      <button
                        key={at}
                        type="button"
                        className={taken.has(at) ? "word taken" : "word"}
                        aria-pressed={picked?.sentence === index && at >= picked.from && at < picked.to}
                        // another point's words cannot be picked; while a change is saved every word waits, but keeps the focus
                        disabled={taken.has(at)}
                        aria-disabled={locked || undefined}
                        // one stop for all the words: the arrow keys move among them
                        tabIndex={tabStop?.sentence === index && tabStop.at === at ? 0 : -1}
                        onFocus={() => setStop({ sentence: index, at })}
                        onKeyDown={(event) => moveAlong(event, index, at)}
                        onClick={() => !locked && pick(index, at)}
                      >
                        {word}
                      </button>
                    ))}
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="tab-actions">
            {moving && (
              <Button size="sm" onClick={settle}>
                {t("emphasis.cancelMove")}
              </Button>
            )}
            {picked && (
              <Button size="sm" onClick={() => setPicked(null)}>
                {t("emphasis.clearPick")}
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={locked || pickedAnchor === null} onClick={() => pickedAnchor && void place(pickedAnchor)}>
              {t(moving ? "emphasis.moveHere" : "emphasis.add")}
            </Button>
          </div>
        </>
      )}

      {scenes.length > 0 && (
        <>
          <p className="tab-section">{t("emphasis.scenesTitle")}</p>
          <ol className="emphasis-scenes">
            {scenes.map((scene) => {
              // a scene another point stands on is not offered again; in a move, the moving point's own scene is
              const free = scene.pointId === null || scene.pointId === moving
              return (
                <li key={`${scene.videoId}:${scene.beatId}:${scene.startUs}`} className="emphasis-scene">
                  <span className="hint mono">{formatTimestamp(scene.atUs)}</span>
                  <span className="flair-what">{scene.description}</span>
                  <span className="flair-length">{t("edit.pieceLength", { seconds: (scene.durationUs / 1_000_000).toFixed(1) })}</span>
                  {free && (
                    <Button size="xs" disabled={locked} onClick={() => void place(sceneAnchor(scene))}>
                      {t(moving ? "emphasis.moveHere" : "emphasis.addScene")}
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}
