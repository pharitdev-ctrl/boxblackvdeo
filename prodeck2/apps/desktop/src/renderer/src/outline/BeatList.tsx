import { useEffect, useRef, useState } from "react"
import type { Beat, RendererApi } from "../../../shared/api.ts"
import { mediaUrl } from "../../../shared/media-url.ts"
import { ScenePlayer } from "../components/ScenePlayer.tsx"
import { formatTimestamp } from "../format.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Popover } from "../ui/Popover.tsx"

function Thumbnail({ api, folder, beat }: { api: Pick<RendererApi, "beatThumbnail">; folder: string; beat: Beat }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api.beatThumbnail(folder, beat.videoId, beat.startUs).then(
      (url) => alive && setSrc(url),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [api, folder, beat.videoId, beat.startUs])
  return <div className="beat-thumb">{src && <img src={src} alt="" />}</div>
}

export interface BeatListProps {
  beats: Beat[]
  folder: string
  api: Pick<RendererApi, "beatThumbnail">
  /** a change is on its way to the main process; the controls wait for it */
  disabled: boolean
  onReorder: (beatIds: string[]) => void
  onRemove: (beatId: string) => void
}

/** Moves the beat at `from` so that it sits where `to` is now. */
export function reorder(beats: Beat[], from: number, to: number): string[] {
  const ids = beats.map((beat) => beat.id)
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved!)
  return ids
}

/**
 * The beats in the order they will play. They can be dragged into another order, and the arrows do
 * the same thing for anyone not using a mouse.
 */
export function BeatList({ beats, folder, api, disabled, onReorder, onRemove }: BeatListProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const held = useRef<number | null>(null)

  const drop = (to: number) => {
    const from = held.current
    held.current = null
    setDragging(null)
    setOver(null)
    if (from !== null && from !== to) onReorder(reorder(beats, from, to))
  }

  return (
    <ol className="beats" aria-label={t("outline.beats", { count: beats.length })}>
      {beats.map((beat, index) => (
        <li
          key={beat.id}
          className={`beat${dragging === index ? " dragging" : ""}${over === index && dragging !== index ? " over" : ""}`}
          draggable={!disabled}
          aria-label={t("outline.beatLabel", { number: index + 1, name: beat.name })}
          onDragStart={(event) => {
            held.current = index
            setDragging(index)
            event.dataTransfer.effectAllowed = "move"
            // Firefox refuses to start a drag without something on the transfer
            event.dataTransfer.setData("text/plain", beat.id)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(index)
          }}
          onDrop={(event) => {
            event.preventDefault()
            drop(index)
          }}
          onDragEnd={() => drop(dragging ?? -1)}
        >
          <span className="beat-grip" aria-hidden title={t("outline.drag")}>
            ⋮⋮
          </span>
          <span className="beat-number mono">{index + 1}</span>
          <Thumbnail api={api} folder={folder} beat={beat} />
          <div className="beat-body">
            <h3>{beat.name}</h3>
            <p>{beat.purpose}</p>
            <p className="hint mono">
              {t("outline.source", {
                clip: beat.videoName,
                from: formatTimestamp(beat.startUs),
                to: formatTimestamp(beat.endUs),
                seconds: ((beat.endUs - beat.startUs) / 1_000_000).toFixed(1),
              })}
            </p>
            {beat.speech && <blockquote>{beat.speech}</blockquote>}
            {beat.visual && <p className="hint">{beat.visual}</p>}
          </div>
          <div className="beat-actions">
            <Button size="sm" aria-label={t("outline.preview")} aria-expanded={playing === beat.id} onClick={() => setPlaying(playing === beat.id ? null : beat.id)}>
              ▶
            </Button>
            <Button size="sm" aria-label={t("outline.moveUp")} disabled={disabled || index === 0} onClick={() => onReorder(reorder(beats, index, index - 1))}>
              ↑
            </Button>
            <Button
              size="sm"
              aria-label={t("outline.moveDown")}
              disabled={disabled || index === beats.length - 1}
              onClick={() => onReorder(reorder(beats, index, index + 1))}
            >
              ↓
            </Button>
            <Button size="sm" aria-label={t("outline.remove")} disabled={disabled} onClick={() => onRemove(beat.id)}>
              ✕
            </Button>
            <Popover open={playing === beat.id} label={t("outline.preview")} onClose={() => setPlaying(null)}>
              <ScenePlayer src={mediaUrl(folder, beat.videoId)} startUs={beat.startUs} endUs={beat.endUs} />
            </Popover>
          </div>
        </li>
      ))}
    </ol>
  )
}
