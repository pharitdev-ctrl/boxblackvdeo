import { useEffect, useRef, useState } from "react"
import { formatTimestamp } from "../format.ts"
import { t } from "../i18n.ts"

interface Props {
  src: string
  startUs: number
  endUs: number
}

// frame times are exact decoder timestamps; this only absorbs rounding
const EPSILON = 0.001
// longer gaps between frame callbacks are seeks or dropped frames, not the frame rate
const MAX_FRAME_STEP = 0.2

/**
 * Plays one scene of a clip with controls that cover that scene only. The native controls would
 * show, and let the user play, the whole clip.
 */
export function ScenePlayer({ src, startUs, endUs }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const start = startUs / 1_000_000
  const end = endUs / 1_000_000
  // the frame at `end` already belongs to what follows the scene; a stopped player shows the one before
  const lastInScene = end - EPSILON
  const length = (endUs - startUs) / 1_000_000
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const playingNow = useRef(false)
  const startWhenPositioned = useRef(false)
  const frameWatch = useRef<number | null>(null)

  const show = (seconds: number) =>
    setTime(seconds >= lastInScene ? length : Math.min(Math.max(Math.round((seconds - start) * 1000) / 1000, 0), length))

  const stopWatching = () => {
    if (frameWatch.current !== null) video.current?.cancelVideoFrameCallback?.(frameWatch.current)
    frameWatch.current = null
  }
  useEffect(() => stopWatching, [])

  const stopAtEnd = (element: HTMLVideoElement) => {
    playingNow.current = false
    stopWatching()
    element.pause()
    element.currentTime = lastInScene
    setTime(length)
  }

  // timeupdate comes only every few hundred ms; frame callbacks stop on the scene's last frame
  const watchFrames = (element: HTMLVideoElement) => {
    if (typeof element.requestVideoFrameCallback !== "function") return
    let previous: number | null = null
    const onFrame = (_now: number, frame: { mediaTime: number }) => {
      if (!playingNow.current) return
      const step = previous === null ? 0 : frame.mediaTime - previous
      previous = frame.mediaTime
      // stop while this frame is on screen when the next one would be past the end
      const next = frame.mediaTime + (step > 0 && step < MAX_FRAME_STEP ? step : 0)
      if (next >= lastInScene) return stopAtEnd(element)
      show(frame.mediaTime)
      frameWatch.current = element.requestVideoFrameCallback(onFrame)
    }
    frameWatch.current = element.requestVideoFrameCallback(onFrame)
  }

  const toggle = () => {
    const element = video.current
    if (!element) return
    if (playing) return element.pause()
    if (element.currentTime >= lastInScene || element.currentTime < start - EPSILON) element.currentTime = start
    void element.play().catch(() => {})
  }

  return (
    <div className="scene-player">
      <video
        ref={video}
        src={src}
        onLoadedMetadata={(event) => {
          startWhenPositioned.current = true
          event.currentTarget.currentTime = start
        }}
        onSeeked={(event) => {
          show(event.currentTarget.currentTime)
          if (!startWhenPositioned.current) return
          startWhenPositioned.current = false
          void event.currentTarget.play().catch(() => {})
        }}
        onPlay={(event) => {
          playingNow.current = true
          setPlaying(true)
          stopWatching()
          watchFrames(event.currentTarget)
        }}
        onPause={() => {
          playingNow.current = false
          setPlaying(false)
          stopWatching()
        }}
        onTimeUpdate={(event) => {
          const element = event.currentTarget
          if (playingNow.current && element.currentTime >= lastInScene) return stopAtEnd(element)
          show(element.currentTime)
        }}
        onError={() => setFailed(true)}
      />
      {failed ? (
        <p className="warning-text">{t("preview.error")}</p>
      ) : (
        <div className="scene-controls">
          <button className="icon-button" aria-label={t(playing ? "preview.pause" : "preview.play")} onClick={toggle}>
            <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
          </button>
          <input
            type="range"
            min={0}
            max={length}
            step={0.01}
            value={time}
            aria-label={t("preview.position")}
            onChange={(event) => {
              const offset = Math.min(Math.max(Number(event.target.value), 0), length)
              if (video.current) video.current.currentTime = start + offset
              setTime(offset)
            }}
          />
          <span className="scene-clock mono">
            {formatTimestamp(Math.round(time * 1_000_000))} / {formatTimestamp(endUs - startUs)}
          </span>
        </div>
      )}
    </div>
  )
}
