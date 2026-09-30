import { useEffect, useState } from "react"
import type { RendererApi, StoredOutline, UnusedPart } from "../../../shared/api.ts"
import { mediaUrl } from "../../../shared/media-url.ts"
import { formatTimestamp } from "../format.ts"
import { t } from "../i18n.ts"
import { ScenePlayer } from "../components/ScenePlayer.tsx"

interface Props {
  api: RendererApi
  folder: string
  /** changes whenever the stored outline changed, so the list is asked for again */
  version: number
  onAdded: (stored: StoredOutline) => void
}

const FOLDED_AFTER = 5

function retakeLabel(retake: NonNullable<UnusedPart["retake"]>): string {
  const verdict = retake.better === "same" ? "unused.retakeSame" : retake.better === retake.take ? "unused.retakeThis" : "unused.retakeOther"
  return t("unused.retake", { verdict: t(verdict) })
}

/** What the planner left out of the outline, by clip, to look at and put back. */
export function UnusedParts({ api, folder, version, onAdded }: Props) {
  const [parts, setParts] = useState<UnusedPart[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [playing, setPlaying] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.unusedParts(folder).then(
      (next) => alive && setParts(next),
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [api, folder, version])

  if (parts.length === 0 && !error) return null

  const clips = [...new Set(parts.map((part) => part.videoId))].map((videoId) => parts.filter((part) => part.videoId === videoId))

  const add = async (part: UnusedPart) => {
    setAdding(true)
    setError(null)
    try {
      onAdded(await api.addOutlinePart(folder, part.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className="unused" aria-label={t("unused.title")}>
      <h2>{t("unused.title")}</h2>
      <p className="subtle">{t("unused.hint")}</p>
      {error && <p className="notice error">{t("error.generic", { message: error })}</p>}
      {clips.map((clipParts) => {
        const { videoId, videoName } = clipParts[0]!
        const shown = open.has(videoId) ? clipParts : clipParts.slice(0, FOLDED_AFTER)
        return (
          <div key={videoId} className="unused-clip">
            <h3>{t("unused.clip", { clip: videoName, count: clipParts.length })}</h3>
            <ul className="speech-rows">
              {shown.map((part) => (
                <li key={part.id} className="speech-row unused-part">
                  <div className="speech-line">
                    <span className="subtle mono">{formatTimestamp(part.startUs)}</span>
                    <span className={part.kind === "speech" ? "" : "subtle"}>{part.text}</span>
                    {part.retake && <span className="pill retake">{retakeLabel(part.retake)}</span>}
                    <span className="speech-actions">
                      <button
                        className="btn xs"
                        aria-label={t("unused.play")}
                        aria-pressed={playing === part.id}
                        onClick={() => setPlaying((current) => (current === part.id ? null : part.id))}
                      >
                        ▶
                      </button>
                      <button className="btn sm" disabled={adding} onClick={() => void add(part)}>
                        {t("unused.add")}
                      </button>
                    </span>
                  </div>
                  {playing === part.id && (
                    <div className="speech-player">
                      <ScenePlayer src={mediaUrl(folder, part.videoId)} startUs={part.startUs} endUs={part.endUs} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {shown.length < clipParts.length && (
              <button className="btn ghost sm" onClick={() => setOpen((current) => new Set([...current, videoId]))}>
                {t("unused.showAll", { count: clipParts.length })}
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}
