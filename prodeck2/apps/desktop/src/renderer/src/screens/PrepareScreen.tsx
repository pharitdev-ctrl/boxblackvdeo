import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { estimateVision, VISION_SAMPLING, visionSampling, type RetakeLoad } from "@boxblack/core/vision/estimate"
import type { AppEvent, ProjectDetail, ReadinessProblem, RendererApi, VideoStatus, VisionStatus } from "../../../shared/api.ts"
import { mainText } from "../edit/postTabs.ts"
import { VideoRow } from "../prepare/VideoRow.tsx"
import { formatDuration, formatResolution, lastLines } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Empty } from "../ui/Empty.tsx"

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "not-ready"; problems: ReadinessProblem[] }
  | { kind: "running" }
  | { kind: "finished"; outcome: "done" | "cancelled" }
  | { kind: "failed"; message: string }

type ObjectsStatus = Extract<AppEvent, { type: "objects" }>["status"]

/** Why finding objects failed, in the user's words: the one-run lock as this page says it, main's known words, else the last lines. */
const objectsText = (error: string) =>
  /(?:^|: )an analysis is already running$/.test(error) ? t("prepare.busyElsewhere") : lastLines(mainText(error))

interface Props {
  api: RendererApi
  folder: string
  capcutRunning: boolean | null
  onOpenSettings: () => void
  /** analysis finished cleanly for these videos */
  onNext: (project: ProjectDetail, videoIds: string[]) => void
  /** a write to this draft is running: the outline it took must not change under it */
  writing?: boolean
  /** Claude is planning this project's post-production: the outline it reads must not change under it either */
  planning?: boolean
}

/**
 * The project's videos, which of them to use, and reading them. Starting does not leave the screen:
 * the rows fill in where they are, so the user can watch one clip finish while another is queued.
 */
export function PrepareScreen({ api, folder, capcutRunning, onOpenSettings, onNext, writing = false, planning = false }: Props) {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const [audio, setAudio] = useState<Record<string, VideoStatus>>({})
  const [pictures, setPictures] = useState<Record<string, VisionStatus>>({})
  // the videos the run in progress is about, which is not what is ticked once the user changes it
  const [running, setRunning] = useState<string[]>([])
  // what earlier runs already left in hand, so opening a project again needs no run at all
  const [analysed, setAnalysed] = useState<Set<string>>(new Set())
  // the lines said twice in the videos whose speech is read already, which Claude will compare
  const [retakes, setRetakes] = useState<Record<string, RetakeLoad>>({})
  // how often Claude looks, from the settings, which the estimate is priced at
  const [sampling, setSampling] = useState(VISION_SAMPLING)
  // a start already asked for: a second click while the settings are being read starts nothing more
  const [starting, setStarting] = useState(false)
  // another project's run is going; one runs at a time, so this one waits
  const [elsewhere, setElsewhere] = useState(false)
  // the analysed videos whose objects were never found, which can be found on their own
  const [withoutObjects, setWithoutObjects] = useState<string[]>([])
  // how finding the objects of each video stands, from a run of objects alone or from the end of an analysis
  const [objects, setObjects] = useState<Record<string, ObjectsStatus>>({})
  // the videos this page asked to find the objects of, from the click until that run ends
  const [locating, setLocating] = useState<string[] | null>(null)
  // why a run of objects was refused or failed as a whole, which no video's event tells
  const [objectsError, setObjectsError] = useState<string | null>(null)
  // whether the run going in this project only finds objects: its end is then no analysis of this page's.
  // Such a run is in no job the main side keeps, so a page that comes back to it knows it only from its events
  const objectsOnly = useRef(false)
  const phaseNow = useRef(phase)
  useLayoutEffect(() => {
    phaseNow.current = phase
  }, [phase])

  useEffect(() => {
    let alive = true
    api.inspectProject(folder).then(
      (detail) => {
        if (!alive) return
        setProject(detail)
        setSelected(new Set(detail.videos.filter((video) => video.exists).map((video) => video.id)))
        setPhase((current) => (current.kind === "loading" ? { kind: "ready" } : current))
      },
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [api, folder])

  useEffect(() => {
    let alive = true
    api.analysedVideos(folder).then(
      (ids) => alive && setAnalysed(new Set(ids)),
      () => {},
    )
    api.knownRetakes(folder).then(
      (known) => alive && setRetakes(known),
      () => {},
    )
    api.getSettings().then(
      (view) => alive && setSampling(visionSampling(view.vision.frameEveryS)),
      () => {},
    )
    api.videosWithoutObjects(folder).then(
      (ids) => alive && setWithoutObjects(ids),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [api, folder])

  const start = useCallback(
    async (videoIds: string[]) => {
      setStarting(true)
      try {
        const { readiness, vision } = await api.getSettings()
        // the rate may have been changed in the settings since this screen priced the estimate
        setSampling(visionSampling(vision.frameEveryS))
        if (readiness.problems.length > 0) {
          setPhase({ kind: "not-ready", problems: readiness.problems })
          return
        }
        setAudio({})
        setPictures({})
        setObjects({})
        setObjectsError(null)
        objectsOnly.current = false
        setRunning(videoIds)
        setPhase({ kind: "running" })
        await api.startAnalysis(folder, videoIds)
      } catch (e) {
        setPhase({ kind: "failed", message: (e as Error).message })
      } finally {
        setStarting(false)
      }
    },
    [api, folder],
  )

  const locate = useCallback(
    async (videoIds: string[]) => {
      setObjects({})
      setObjectsError(null)
      setLocating(videoIds)
      objectsOnly.current = true
      try {
        await api.locateObjects(folder, videoIds)
      } catch (e) {
        // refused before anything ran (another run, the machine, the folder): no event will follow
        objectsOnly.current = false
        setLocating(null)
        setObjectsError((e as Error).message)
      }
    },
    [api, folder],
  )

  useEffect(() => {
    let alive = true
    const stop = api.onEvent((event) => {
      if (event.type === "transcription" && event.folder === folder) {
        setAudio((current) => ({ ...current, [event.videoId]: event.status }))
      } else if (event.type === "vision" && event.folder === folder) {
        setPictures((current) => ({ ...current, [event.videoId]: event.status }))
      } else if (event.type === "objects" && event.folder === folder) {
        // objects found while no analysis of this page's is going belong to a run of objects alone
        if (phaseNow.current.kind !== "running") objectsOnly.current = true
        setObjects((current) => ({ ...current, [event.videoId]: event.status }))
      } else if (event.type === "analysis-finished" && event.folder === folder) {
        if (objectsOnly.current) {
          // the end of finding objects, which leaves the analysis where it stood
          objectsOnly.current = false
          setLocating(null)
          if (event.outcome === "failed") setObjectsError(event.error)
        } else {
          setPhase(event.outcome === "failed" ? { kind: "failed", message: event.error } : { kind: "finished", outcome: event.outcome })
        }
        // a cancel leaves the video it stopped on at running with nothing after it; only a failure is still worth saying
        setObjects((current) => Object.fromEntries(Object.entries(current).filter(([, status]) => status.state === "failed")))
        // whatever ended, some videos may have their objects now, or still be without them after a cancel
        api.videosWithoutObjects(folder).then(
          (ids) => alive && setWithoutObjects(ids),
          () => {},
        )
      } else if (event.type === "analysis-finished") {
        setElsewhere(false)
      } else if (event.type === "transcription" || event.type === "vision" || event.type === "objects") {
        setElsewhere(true)
      }
    })
    // the user left the screen and came back: a run for this project may be going, or be finished
    // since they last saw it — either way it is theirs, not a fresh start
    void api.analysisState().then((state) => {
      if (!alive || !state) return
      if (state.folder !== folder) {
        setElsewhere(state.running)
        return
      }
      setAudio(state.transcription)
      setPictures(state.vision)
      setRunning(Object.keys(state.transcription))
      if (state.running) objectsOnly.current = false
      if (state.running) setPhase({ kind: "running" })
      else if (state.outcome === "failed") setPhase({ kind: "failed", message: state.error ?? "" })
      else if (state.outcome) setPhase({ kind: "finished", outcome: state.outcome })
    })
    return () => {
      alive = false
      stop()
    }
  }, [api, folder])

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const chosen = project?.videos.filter((video) => selected.has(video.id)) ?? []
  const missing = project?.videos.filter((video) => !video.exists).length ?? 0
  // what a run would really send: the videos read before come from the cache
  const estimate = estimateVision(chosen.filter((video) => !analysed.has(video.id)).map((video) => ({ durationUs: video.durationUs, retakes: retakes[video.id] ?? null })), sampling)
  const started = phase.kind === "running" || phase.kind === "finished" || phase.kind === "failed"
  const failedCount = running.filter((id) => audio[id]?.state === "failed" || pictures[id]?.state === "failed").length
  const doneCount = running.filter((id) => audio[id]?.state === "done" && pictures[id]?.state === "done").length
  const clean = phase.kind === "finished" && phase.outcome === "done" && failedCount === 0
  // a run of objects alone holds the one-run lock as an analysis does
  const objectsGoing = locating !== null || Object.values(objects).some((status) => status.state === "running")
  const canStart = capcutRunning === false && chosen.length > 0 && !elsewhere && !starting && !objectsGoing
  // read by an earlier run or by this one: either way there is nothing left to read for it
  const read = new Set([...analysed, ...running.filter((id) => audio[id]?.state === "done" && pictures[id]?.state === "done")])
  // the ticked videos read already whose objects were never found
  const objectsToFind = chosen.filter((video) => read.has(video.id) && withoutObjects.includes(video.id)).map((video) => video.id)
  const objectsIdle = phase.kind !== "running" && phase.kind !== "loading" && !starting && !objectsGoing
  // the videos the pass in hand is about: those asked for here, or those an analysis has read in full (the only ones
  // it finds the objects of), and any an event names besides
  const objectsScope = [...new Set([...(locating ?? (phase.kind === "running" ? running.filter((id) => audio[id]?.state === "done" && pictures[id]?.state === "done") : [])), ...Object.keys(objects)])]
  const objectsSettled = objectsScope.filter((id) => objects[id]?.state === "done" || objects[id]?.state === "failed").length
  const objectsFailure = objectsError ?? Object.values(objects).flatMap((status) => (status.state === "failed" ? [status.error] : []))[0] ?? null
  // everything ticked has been read, so there is nothing to do but go on
  const ready = chosen.length > 0 && chosen.every((video) => read.has(video.id))

  return (
    <section className="screen prepare">
      <div className="content">
        {error && <p className="notice error">{t("error.generic", { message: error })}</p>}
        {!error && !project && <p className="hint">{t("detail.loading")}</p>}

        {project && (
          <>
            <div className="screen-head">
              <div>
                <h1>{project.name}</h1>
                <p className="hint">
                  {t("detail.meta", {
                    version: project.capcutVersion,
                    fps: project.fps,
                    resolution: formatResolution(project.canvas.width, project.canvas.height),
                  })}
                </p>
              </div>
            </div>

            {(!project.versionTested || missing > 0 || project.timelineSegmentCount > 0) && (
              <ul className="warnings">
                {!project.versionTested && <li>{t("warn.untestedVersion", { version: project.capcutVersion })}</li>}
                {missing > 0 && <li>{t("warn.missingFiles", { count: missing })}</li>}
                {project.timelineSegmentCount > 0 && <li>{t("warn.timelineReplaced", { count: project.timelineSegmentCount })}</li>}
              </ul>
            )}

            {phase.kind === "not-ready" ? (
              <Empty
                title={t("analyze.notReady")}
                hint={phase.problems.map((problem) => t(`problem.${problem}` as MessageKey)).join(" · ")}
                action={
                  <Button variant="primary" onClick={onOpenSettings}>
                    {t("analyze.openSettings")}
                  </Button>
                }
              />
            ) : project.videos.length === 0 ? (
              <Empty title={t("detail.noVideos")} />
            ) : (
              <>
                {Object.values(objects).some((status) => status.state === "running") && (
                  <p className="notice objects-line">{t("prepare.objectsGoing", { done: objectsSettled, total: objectsScope.length })}</p>
                )}
                {objectsFailure !== null && (
                  <p className="notice error objects-line" title={objectsFailure}>
                    {t("prepare.objectsFailed", { error: objectsText(objectsFailure) })}
                  </p>
                )}
                {objectsIdle && objectsToFind.length > 0 && (
                  <div className="notice objects-line objects-offer">
                    <span>{t("prepare.objects", { count: objectsToFind.length })}</span>
                    <Button disabled={capcutRunning !== false || writing || planning || elsewhere} onClick={() => void locate(objectsToFind)}>
                      {t("prepare.objectsRun")}
                    </Button>
                  </div>
                )}
                <div className="section-head">
                  <h2>{t("prepare.videosTitle")}</h2>
                  <span className="hint">{t("detail.videosHint")}</span>
                </div>
                <ul className="video-list">
                  {project.videos.map((video) => (
                    <VideoRow
                      key={video.id}
                      video={video}
                      checked={selected.has(video.id)}
                      onToggle={() => toggle(video.id)}
                      audio={audio[video.id]}
                      picture={pictures[video.id]}
                      started={started && running.includes(video.id)}
                      analysed={analysed.has(video.id)}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {project && (
        <footer className="action-bar">
          <div className="action-summary">
            {phase.kind === "running" && <span>{t("prepare.running", { done: doneCount, total: running.length })}</span>}
            {clean && <span className="ok-text">{t("analyze.allDone", { count: running.length })}</span>}
            {phase.kind === "finished" && phase.outcome === "cancelled" && <span>{t("analyze.cancelled")}</span>}
            {phase.kind === "failed" && <span className="danger-text">{t("analyze.runFailed", { message: phase.message })}</span>}
            {!started && (
              <>
                <span className="hint">
                  {t("detail.selectedSummary", {
                    selected: chosen.length,
                    total: project.videos.length,
                    duration: formatDuration(chosen.reduce((sum, video) => sum + video.durationUs, 0)),
                  })}
                </span>
                {chosen.length > 0 && !ready && (
                  <span className="hint">
                    {estimate.reviews > 0
                      ? t("detail.estimateRetakes", { frames: estimate.frames, reviews: estimate.reviews, tokens: new Intl.NumberFormat("en-US").format(estimate.tokens) })
                      : t("detail.estimate", { frames: estimate.frames, tokens: new Intl.NumberFormat("en-US").format(estimate.tokens) })}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="action">
            {!started && !ready && capcutRunning === true && <span className="warn-text">{t("gate.startBlocked")}</span>}
            {phase.kind !== "running" && !ready && elsewhere && <span className="warn-text">{t("prepare.busyElsewhere")}</span>}
            {phase.kind !== "running" && phase.kind !== "loading" && ready && (writing || planning) && <span className="warn-text">{t(writing ? "edit.ai.writing" : "edit.ai.planning")}</span>}
            {/* a run of objects alone stops as an analysis does, and its end is told the same way */}
            {(phase.kind === "running" || objectsGoing) && <Button onClick={() => void api.cancelAnalysis()}>{t("prepare.cancel")}</Button>}
            {phase.kind !== "running" &&
              phase.kind !== "loading" &&
              (ready ? (
                // everything ticked has been read — by an earlier run or this one: go straight on
                <Button variant="primary" disabled={writing || planning} onClick={() => onNext(project, chosen.map((video) => video.id))}>
                  {t("prepare.next")}
                </Button>
              ) : (
                // whatever the last run did, what is read next is what is ticked now
                <Button variant="primary" disabled={!canStart} onClick={() => void start(chosen.map((video) => video.id))}>
                  {t(
                    phase.kind === "finished" && phase.outcome === "cancelled"
                      ? "prepare.restart"
                      : phase.kind === "failed" || (phase.kind === "finished" && failedCount > 0)
                        ? "prepare.retry"
                        : "prepare.start",
                  )}
                </Button>
              ))}
          </div>
        </footer>
      )}
    </section>
  )
}
