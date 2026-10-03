import { useEffect, useRef, useState, type ReactElement } from "react"
import type { AgentPreview } from "../../../shared/api.ts"
import { previewMediaUrl } from "../../../shared/media-url.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"

const frameName = (n: number) => `${String(n + 1).padStart(5, "0")}.jpg`

/**
 * Plays the agent tab's preview: its frames shown in turn over its sound, the sound's clock leading (a preview with no
 * sound keeps its own). Not a video file: the app's ffmpeg encodes none (main/preview-video.ts).
 */
export function PreviewPlayer({ preview }: { preview: AgentPreview }): ReactElement {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const duration = preview.durationUs / 1_000_000
  // the clock of a preview with no sound: when it started playing, from where
  const clock = useRef<{ startedMs: number; fromS: number } | null>(null)

  // every frame asked for once, so playing does not wait on them
  useEffect(() => {
    for (let n = 0; n < preview.frames; n++) new Image().src = previewMediaUrl(preview.id, frameName(n))
  }, [preview.id, preview.frames])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const now = audio.current && preview.audio ? audio.current.currentTime : clock.current ? clock.current.fromS + (performance.now() - clock.current.startedMs) / 1000 : 0
      if (now >= duration) {
        setAt(duration)
        setPlaying(false)
        return
      }
      setAt(now)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration, preview.audio])

  const play = () => {
    const from = at >= duration ? 0 : at
    setAt(from)
    if (audio.current && preview.audio) {
      audio.current.currentTime = from
      void audio.current.play()?.catch(() => setPlaying(false))
    } else clock.current = { startedMs: performance.now(), fromS: from }
    setPlaying(true)
  }
  const pause = () => {
    audio.current?.pause()
    setPlaying(false)
  }
  const seek = (s: number) => {
    setAt(s)
    if (audio.current) audio.current.currentTime = s
    if (clock.current) clock.current = { startedMs: performance.now(), fromS: s }
  }

  const index = Math.min(preview.frames - 1, Math.max(0, Math.floor(at * preview.fps)))
  return (
    <div className="preview-player">
      <img src={previewMediaUrl(preview.id, frameName(index))} alt={t("player.frame", { at: at.toFixed(1) })} />
      {preview.audio && <audio ref={audio} src={previewMediaUrl(preview.id, "audio.wav")} preload="auto" onEnded={() => setPlaying(false)} />}
      <div className="preview-controls">
        {playing ? <Button size="sm" onClick={pause}>{t("player.pause")}</Button> : <Button size="sm" variant="primary" onClick={play}>{t("player.play")}</Button>}
        <input type="range" min={0} max={duration} step={1 / preview.fps} value={at} aria-label={t("player.seek")} onChange={(event) => seek(Number(event.target.value))} />
        <span className="mono hint">
          {at.toFixed(1)} / {duration.toFixed(1)} วิ
        </span>
      </div>
    </div>
  )
}
