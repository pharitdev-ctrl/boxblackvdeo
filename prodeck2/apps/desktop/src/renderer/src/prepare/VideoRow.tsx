import { useState } from "react"
import type { ProjectVideo, VideoStatus, VisionStatus } from "../../../shared/api.ts"
import { formatDuration, formatResolution, formatTimestamp } from "../format.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Popover } from "../ui/Popover.tsx"
import { Progress } from "../ui/Progress.tsx"

const percent = (progress: number) => Math.round(progress * 100)

export function audioText(status: VideoStatus | undefined): string {
  switch (status?.state) {
    case undefined:
    case "queued":
      return t("analyze.queued")
    case "extracting":
      return t("analyze.extracting")
    case "transcribing":
      return status.progress === null ? t("analyze.transcribingStarted") : t("analyze.transcribing", { percent: percent(status.progress) })
    case "done":
      if (status.transcript.engine === "none") return t("analyze.noSpeech")
      return t(status.fromCache ? "analyze.doneCached" : "analyze.done", { words: status.transcript.words.length })
    case "failed":
      return t("analyze.failed", { message: status.error })
  }
}

export function pictureText(status: VisionStatus | undefined): string {
  switch (status?.state) {
    case undefined:
    case "queued":
      return t("analyze.queued")
    case "measuring":
      return status.progress === null ? t("analyze.measuringStarted") : t("analyze.measuring", { percent: percent(status.progress) })
    case "describing":
      return status.progress === null ? t("analyze.describingStarted") : t("analyze.describing", { percent: percent(status.progress) })
    case "done":
      return t(status.fromCache ? "analyze.visionDoneCached" : "analyze.visionDone", { scenes: status.insight.scenes.length })
    case "failed":
      return t("analyze.failed", { message: status.error })
  }
}

/** How far a step has got: nothing yet, part way, or all the way. */
const share = (status: VideoStatus | VisionStatus | undefined): number | null => {
  if (!status) return 0
  switch (status.state) {
    case "queued":
    case "failed":
      return 0
    case "done":
      return 1
    case "extracting":
      return null
    default:
      return status.progress
  }
}

const state = (status: VideoStatus | VisionStatus | undefined) => status?.state ?? "queued"

export interface VideoRowProps {
  video: ProjectVideo
  checked: boolean
  onToggle: () => void
  /** null before anything has been asked for: the row shows no progress at all */
  audio: VideoStatus | undefined
  picture: VisionStatus | undefined
  started: boolean
  /** its analysis is in hand from a run before this one, so no run is needed for it */
  analysed?: boolean
}

/** One video of the project: whether it is in, and how far reading it has got. */
export function VideoRow({ video, checked, onToggle, audio, picture, started, analysed }: VideoRowProps) {
  const [peeking, setPeeking] = useState(false)
  const utterances = audio?.state === "done" ? audio.transcript.utterances : []
  const scenes = picture?.state === "done" ? picture.insight.scenes : []
  const readable = utterances.length > 0 || scenes.length > 0

  // read already and no run in hand: the row is settled, and says so by stepping back
  const settled = video.exists && !started && analysed === true

  return (
    <li className={`video-row${video.exists ? "" : " missing"}${settled ? " analysed" : ""}`}>
      <label className="video-pick">
        <input type="checkbox" checked={checked} disabled={!video.exists} onChange={onToggle} />
        <span className="video-name">{video.name}</span>
        {!video.exists && <span className="tag warn">{t("detail.missing")}</span>}
        {settled && <span className="tag ok">{t("prepare.analysed")}</span>}
      </label>
      <span className="hint mono">{formatDuration(video.durationUs)}</span>
      <span className="hint mono">{formatResolution(video.width, video.height)}</span>

      {started && video.exists ? (
        <div className="video-progress">
          <div className={`step ${state(audio)}`}>
            <span className="hint">{t("analyze.audioLabel")}</span>
            <Progress value={share(audio)} label={t("analyze.audioLabel")} />
            <span className="step-text">{audioText(audio)}</span>
          </div>
          <div className={`step ${state(picture)}`}>
            <span className="hint">{t("analyze.pictureLabel")}</span>
            <Progress value={share(picture)} label={t("analyze.pictureLabel")} />
            <span className="step-text">{pictureText(picture)}</span>
          </div>
        </div>
      ) : null}

      <div className="video-peek">
        {readable && (
          <>
            <Button size="sm" aria-expanded={peeking} onClick={() => setPeeking(!peeking)}>
              {t("prepare.peek")}
            </Button>
            <Popover open={peeking} label={t("prepare.peekLabel", { name: video.name })} onClose={() => setPeeking(false)}>
              {utterances.length > 0 && (
                <>
                  <h3 className="popover-title">{t("analyze.showTranscript", { count: utterances.length })}</h3>
                  <ol className="peek-list">
                    {utterances.map((utterance) => (
                      <li key={utterance.startUs}>
                        <span className="hint mono">{formatTimestamp(utterance.startUs)}</span>
                        <span>{utterance.text}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {scenes.length > 0 && (
                <>
                  <h3 className="popover-title">{t("analyze.showScenes", { count: scenes.length })}</h3>
                  <ol className="peek-list">
                    {scenes.map((scene) => (
                      <li key={scene.startUs}>
                        <span className="hint mono">{formatTimestamp(scene.startUs)}</span>
                        <span>
                          {scene.description}
                          {scene.issues.length > 0 && <span className="warn-text"> · {scene.issues.join(", ")}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </Popover>
          </>
        )}
      </div>
    </li>
  )
}
