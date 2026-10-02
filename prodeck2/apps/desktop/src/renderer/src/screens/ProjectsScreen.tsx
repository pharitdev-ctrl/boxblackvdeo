import { useCallback, useEffect, useState } from "react"
import type { DesktopApi, ProjectList, ProjectStage, ProjectSummary } from "../../../shared/api.ts"
import { formatDate, formatDay, formatDuration } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Empty } from "../ui/Empty.tsx"
import mascotWave from "../assets/mascot-wave.png"

function Cover({ api, project }: { api: DesktopApi; project: ProjectSummary }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (project.coverPath) {
      api.readCover(project.folder).then(
        (url) => alive && setSrc(url),
        () => alive && setSrc(null),
      )
    }
    return () => {
      alive = false
    }
  }, [api, project.folder, project.coverPath])
  return (
    <div className="cover">
      {src ? <img src={src} alt="" /> : <span className="cover-empty">{t("projects.noCover")}</span>}
      <span className="cover-duration mono">{formatDuration(project.durationUs)}</span>
    </div>
  )
}

/** How far the app itself got with a project, so work already done is not started over. */
function Stage({ stage }: { stage: ProjectStage | undefined }) {
  if (!stage) return null
  return (
    <span className={`project-stage ${stage.stage}`}>
      <span className="tag ok">{t(`projects.stage.${stage.stage}` as MessageKey)}</span>
      <span className="hint">{formatDay(stage.at * 1000)}</span>
    </span>
  )
}

/** Every CapCut project on this machine, newest first, to pick one to work on. */
export function ProjectsScreen({ api, onOpen }: { api: DesktopApi; onOpen: (folder: string) => void }) {
  const [list, setList] = useState<ProjectList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const load = useCallback(async () => {
    try {
      setError(null)
      setList(await api.listProjects())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api])

  useEffect(() => {
    void load()
    // pick up projects made in CapCut while this window was in the background
    window.addEventListener("focus", load)
    return () => window.removeEventListener("focus", load)
  }, [load])

  const text = search.trim().toLowerCase()
  const shown = (list?.projects ?? []).filter((project) => project.name.toLowerCase().includes(text))

  return (
    <section className="screen projects">
      <div className="screen-head">
        {/* the mascot waves hello where every session starts; it says nothing a screen reader needs */}
        <img className="mascot" src={mascotWave} alt="" width={56} height={72} />
        <div className="projects-title">
          <h1>{t("projects.title")}</h1>
          <p className="hint">{list ? `${t("projects.subtitle")} · ${t("projects.count", { count: list.projects.length })}` : t("projects.subtitle")}</p>
        </div>
        <input
          className="search"
          type="search"
          aria-label={t("projects.search")}
          placeholder={t("projects.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="content">
        {error && <p className="notice error">{t("error.generic", { message: error })}</p>}
        {!error && !list && <p className="hint">{t("projects.loading")}</p>}
        {list?.root === null && <Empty title={t("projects.rootMissing")} />}
        {list?.root && list.projects.length === 0 && <Empty title={t("projects.empty")} />}
        {list && list.projects.length > 0 && shown.length === 0 && <Empty title={t("projects.noMatch", { text: search.trim() })} />}
        {shown.length > 0 && (
          <div className="project-grid">
            {shown.map((project) => (
              <button key={project.folder} className="project-card" onClick={() => onOpen(project.folder)}>
                <Cover api={api} project={project} />
                <span className="project-meta">
                  <h3>{project.name}</h3>
                  <span className="hint">{formatDate(project.modifiedUs)}</span>
                  <Stage stage={list?.stages[project.folder]} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
