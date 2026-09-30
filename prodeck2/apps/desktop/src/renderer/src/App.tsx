import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { LicenseState, ProjectDetail, RendererApi, StoredOutline, UpdateState } from "../../shared/api.ts"
import { formatDate } from "./format.ts"
import { t } from "./i18n.ts"
import { WriteEndToast, type WriteEnd } from "./edit/writeEnd.tsx"
import { AppShell } from "./shell/AppShell.tsx"
import type { Alert } from "./shell/AlertBar.tsx"
import type { Stage } from "./shell/StageChips.tsx"
import { ActivationScreen } from "./screens/ActivationScreen.tsx"
import { OutlineScreen } from "./screens/OutlineScreen.tsx"
import { PrepareScreen } from "./screens/PrepareScreen.tsx"
import { ProjectsScreen } from "./screens/ProjectsScreen.tsx"
import { SettingsScreen } from "./screens/SettingsScreen.tsx"
import { PostScreen } from "./screens/PostScreen.tsx"
import { ClipRoom } from "./room/ClipRoom.tsx"
import { applyAppearance } from "./theme.ts"
import { useCapCutRunning } from "./useCapCutRunning.ts"

type WorkScreen =
  | { name: "projects" }
  | { name: "prepare"; folder: string }
  | { name: "outline"; project: ProjectDetail; videoIds: string[] }
  | { name: "post"; project: ProjectDetail; stored: StoredOutline }

type Screen = WorkScreen | { name: "settings"; returnTo: WorkScreen }

/** What the user has got through, so a stage behind them can be gone back to. */
interface Journey {
  /** the open project's draft folder — known as soon as it is opened, before it has been read */
  folder?: string
  project?: ProjectDetail
  videoIds?: string[]
  stored?: StoredOutline
}

/** A draft folder is named after its project, which is the name to show before it has been read. */
const nameOf = (folder: string) => folder.split("/").pop() ?? folder

/** A license ending sooner than this gets a reminder. */
const EXPIRY_WARNING_MS = 7 * 86_400_000

const stageOf = (screen: WorkScreen): Stage | null => {
  switch (screen.name) {
    case "projects":
      return null
    case "prepare":
      return "prepare"
    case "outline":
      return "outline"
    case "post":
      return "post"
  }
}

export function App({ api, pollMs = 2000 }: { api: RendererApi; pollMs?: number }) {
  const [screen, setScreen] = useState<Screen>({ name: "projects" })
  const [journey, setJourney] = useState<Journey>({})
  const capcutRunning = useCapCutRunning(api, pollMs)
  const [license, setLicense] = useState<LicenseState | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ state: "disabled" })
  // bumped after a write or a restore, so the bar's menu reads the list of backups again
  const [backupsVersion, setBackupsVersion] = useState(0)
  // bumped after a restore, so the room of post-production reads the draft again
  const [restoredVersion, setRestoredVersion] = useState(0)
  const work = screen.name === "settings" ? screen.returnTo : screen
  // the draft whose room (post-production) is open and listening: that room says itself how a write to it ended
  const roomOpen = useRef<string | null>(null)
  const claimRoom = useCallback((folder: string | null) => {
    roomOpen.current = folder
  }, [])
  // writes that ended while no room of their draft was open to say so, told one after another: two
  // drafts' writes can end together, and the second must not take the first off the screen unread
  const [awayWrites, setAwayWrites] = useState<{ id: number; folder: string; end: WriteEnd }[]>([])
  const awayWriteIds = useRef(0)
  const nextAwayWrite = useCallback(() => setAwayWrites((waiting) => waiting.slice(1)), [])
  // the drafts being written to now: none of their backups can be put back until the write is over
  const [writingTo, setWritingTo] = useState<ReadonlySet<string>>(() => new Set())
  // the projects Claude is planning now: the run reads the outline as it goes, so the outline stays shut until it ends
  const [planningIn, setPlanningIn] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let alive = true
    void api.licenseState().then((state) => alive && setLicense(state))
    void api.updateState().then((state) => alive && setUpdate(state))
    void api.getSettings().then((view) => alive && applyAppearance(view.appearance))
    const stop = api.onEvent((event) => {
      if (event.type === "license") setLicense(event.state)
      if (event.type === "update") setUpdate(event.state)
      if (event.type === "timeline-write") {
        setWritingTo((current) => {
          const next = new Set(current)
          if (event.state === "started") next.add(event.folder)
          else next.delete(event.folder)
          return next
        })
        // the write took a backup, whichever room asked for it and whether or not one is still open
        if (event.state === "done") setBackupsVersion((n) => n + 1)
        // a write outlives the room that started it: it can end while the user is anywhere in the app
        if (event.state !== "started" && roomOpen.current !== event.folder) {
          const id = awayWriteIds.current++
          setAwayWrites((waiting) => [...waiting, { id, folder: event.folder, end: event }])
        }
      }
      // a work of a run said how it stands: the run goes on until main says it is over
      if (event.type === "post-plan" || event.type === "post-plan-finished") {
        const going = event.type === "post-plan"
        setPlanningIn((current) => {
          if (current.has(event.folder) === going) return current
          const next = new Set(current)
          if (going) next.add(event.folder)
          else next.delete(event.folder)
          return next
        })
      }
    })
    return () => {
      alive = false
      stop()
    }
  }, [api])

  // a write or a plan run started before the window was reloaded is only known by asking; an event of
  // either heard while the question is out is newer than the answer
  useEffect(() => {
    const folder = journey.folder
    if (!folder) return
    const heard = { write: false, plan: false }
    const stop = api.onEvent((event) => {
      if (event.type === "timeline-write" && event.folder === folder) heard.write = true
      if ((event.type === "post-plan" || event.type === "post-plan-finished") && event.folder === folder) heard.plan = true
    })
    const writing = api.writingTimeline(folder).then(
      (writing) => {
        if (writing && !heard.write) setWritingTo((current) => new Set(current).add(folder))
      },
      () => {},
    )
    const planning = api.postPlanState(folder).then(
      (run) => {
        if (run?.running && !heard.plan) setPlanningIn((current) => new Set(current).add(folder))
      },
      () => {},
    )
    void Promise.all([writing, planning]).finally(stop)
    // an answer to a question asked for another folder, or by an effect run before, counts for nothing
    return () => {
      heard.write = true
      heard.plan = true
      stop()
    }
  }, [api, journey.folder])

  // a build without licensing is as open as a licensed one
  const licensed = license?.state === "active" || license?.state === "not-required"
  const openSettings = () => setScreen({ name: "settings", returnTo: work })
  // the journey is kept, so coming back to this project starts where it left off
  const goProjects = () => setScreen({ name: "projects" })

  const goPrepare = (folder: string) => {
    setJourney((current) => (current.folder === folder ? current : { folder }))
    setScreen({ name: "prepare", folder })
  }
  const goOutline = (project: ProjectDetail, videoIds: string[]) => {
    setJourney((current) => ({ ...current, folder: project.folder, project, videoIds }))
    setScreen({ name: "outline", project, videoIds })
  }
  const goPost = (project: ProjectDetail, stored: StoredOutline) => {
    setJourney((current) => ({ ...current, folder: project.folder, project, stored }))
    setScreen({ name: "post", project, stored })
  }
  // a backup was put back, from the bar's menu: its list and the room read again
  const backupRestored = () => {
    setBackupsVersion((n) => n + 1)
    setRestoredVersion((n) => n + 1)
  }

  /**
   * The outline as it stands after every change. One that is no longer confirmed — a new plan that
   * landed after the user went on — takes them back from post-production to confirm it.
   */
  const storedChanged = (stored: StoredOutline) => {
    setJourney((current) => (current.folder === stored.folder ? { ...current, stored } : current))
    if (!stored.confirmed) {
      setScreen((current) =>
        current.name === "post" && current.project.folder === stored.folder ? { name: "outline", project: current.project, videoIds: stored.videoIds } : current,
      )
    }
  }

  // post-production opens on the confirmed outline
  const reachable: Record<Stage, boolean> = {
    prepare: journey.folder !== undefined,
    outline: journey.project !== undefined && journey.videoIds !== undefined,
    post: journey.stored?.confirmed === true,
  }

  // the write took the outline as it was: one changed while it runs would be saved, and left out of it; a plan run
  // reads it work by work, so a beat changed or the outline made again meanwhile would land in the middle of it
  const openWriting = journey.folder !== undefined && writingTo.has(journey.folder)
  const openPlanning = journey.folder !== undefined && planningIn.has(journey.folder)
  const shut: Partial<Record<Stage, string>> = openWriting ? { outline: t("edit.ai.writing") } : openPlanning ? { outline: t("edit.ai.planning") } : {}

  const onStage = (stage: Stage) => {
    if (stage === "prepare" && journey.folder) goPrepare(journey.folder)
    if (stage === "outline" && journey.project && journey.videoIds) goOutline(journey.project, journey.videoIds)
    if (stage === "post" && journey.project && journey.stored) goPost(journey.project, journey.stored)
  }

  /** What the app has to say, most pressing first. */
  const alerts = useMemo(() => {
    const found: Alert[] = []
    if (license?.state === "active" && license.license.expiresAt - Date.now() < EXPIRY_WARNING_MS) {
      found.push({ id: "expiring", tone: "warn", text: t("license.expiresSoon", { date: formatDate(license.license.expiresAt * 1000) }) })
    }
    if (license?.state === "active" && license.offline) {
      found.push({ id: "offline", tone: "warn", text: t("license.offline", { date: formatDate(license.tokenExpiresAt * 1000) }) })
    }
    if (licensed && capcutRunning === true) {
      found.push({ id: "capcut", tone: "warn", text: t("gate.running"), detail: t("gate.runningDetail") })
    }
    if (update.state === "ready") {
      found.push({
        id: "update",
        tone: "info",
        text: t("update.ready", { version: update.version }),
        action: { label: t("update.restart"), onClick: () => void api.installUpdate() },
      })
    }
    return found
  }, [api, capcutRunning, license, licensed, update])

  const title = screen.name === "settings" ? t("settings.title") : work.name === "projects" ? t("app.name") : (journey.project?.name ?? nameOf(journey.folder ?? ""))

  return (
    <AppShell
      title={title}
      stage={screen.name === "settings" ? null : stageOf(work)}
      reachable={reachable}
      shut={shut}
      onStage={onStage}
      onBack={screen.name === "settings" ? () => setScreen(screen.returnTo) : screen.name === "projects" ? undefined : goProjects}
      backLabel={screen.name === "settings" ? undefined : t("nav.projects")}
      alerts={alerts}
      backups={
        licensed && journey.folder && screen.name !== "settings" && screen.name !== "projects"
          ? {
              api,
              folder: journey.folder,
              capcutRunning,
              refreshKey: backupsVersion,
              writing: writingTo.has(journey.folder),
              onRestored: backupRestored,
            }
          : undefined
      }
      onSettings={screen.name === "settings" ? undefined : openSettings}
    >
      {license && !licensed && screen.name !== "settings" && <ActivationScreen api={api} state={license} onActivated={setLicense} />}
      {licensed && screen.name === "projects" && <ProjectsScreen api={api} onOpen={goPrepare} />}
      {licensed && screen.name === "prepare" && (
        <PrepareScreen
          api={api}
          folder={screen.folder}
          capcutRunning={capcutRunning}
          onOpenSettings={openSettings}
          onNext={goOutline}
          writing={writingTo.has(screen.folder)}
          planning={planningIn.has(screen.folder)}
        />
      )}
      {licensed && screen.name === "outline" && (
        <OutlineScreen
          api={api}
          project={screen.project}
          videoIds={screen.videoIds}
          onConfirmed={(stored) => goPost(screen.project, stored)}
          onStored={storedChanged}
        />
      )}
      {/* the room of post-production, keyed by the draft; its page draws the AI menu and the write button on the bar above */}
      {licensed && screen.name === "post" && (
        <ClipRoom
          key={screen.project.folder}
          api={api}
          project={screen.project}
          stored={screen.stored}
          capcutRunning={capcutRunning}
          draftVersion={restoredVersion}
          claim={claimRoom}
          onWritten={() => setBackupsVersion((n) => n + 1)}
        >
          <PostScreen onEditOutline={() => goOutline(screen.project, screen.stored.videoIds)} />
        </ClipRoom>
      )}
      {screen.name === "settings" && <SettingsScreen api={api} onAppearance={applyAppearance} licensing={license?.state !== "not-required"} />}
      {/* keyed, so each one is on screen for its own full time */}
      {awayWrites[0] && <WriteEndToast key={awayWrites[0].id} projectName={nameOf(awayWrites[0].folder)} end={awayWrites[0].end} onDone={nextAwayWrite} />}
    </AppShell>
  )
}
