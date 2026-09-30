import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"
import { CUT_PRESETS } from "@boxblack/core/cut/rules"
import { DEFAULT_FLAIR_OPTIONS } from "@boxblack/core/flair/catalogue"
import type {
  CueAnchor,
  CutDecisionChange,
  CutPlan,
  CutPreset,
  CutPresetId,
  CutRules,
  FlairOptions,
  HighlightOptions,
  HighlightPreview,
  PostRequest,
  PostRunView,
  PostWork,
  ProjectDetail,
  RendererApi,
  RethinkWork,
  SettingsPatch,
  SettingsView,
  StoredOutline,
  SubtitleLine,
  SubtitleOptions,
  WriteResult,
} from "../../../shared/api.ts"
import { failureText, mainText } from "../edit/postTabs.ts"
import { ACTION_TOAST_MS, toldIsLong, toldMessage } from "../edit/writeEnd.tsx"
import { t } from "../i18n.ts"
import { Toast } from "../ui/Toast.tsx"

/**
 * How the write to this draft stands, as the room last heard. A written one is only that: what it wrote
 * was told by a toast. A failed one is idle again, and the room tells why by a toast too.
 */
export type WriteState = { kind: "idle" } | { kind: "writing" } | { kind: "written" }

/** What the room reads from main for its page: the settings, the rough cut, the placed preview and the subtitle lines. */
export type RoomRead = "settings" | "cut" | "preview" | "lines"

export interface ClipRoomProps {
  api: RendererApi
  project: ProjectDetail
  stored: StoredOutline
  capcutRunning: boolean | null
  /** bumped when a backup was restored: the draft is no longer what it was */
  draftVersion?: number
  /** tells the app which draft's write ends this room tells itself, and with null that it tells none */
  claim?: (folder: string | null) => void
  /** a write took a new backup */
  onWritten?: () => void
  children: ReactNode
}

export interface ClipRoomValue {
  api: RendererApi
  folder: string
  project: ProjectDetail
  stored: StoredOutline
  capcutRunning: boolean | null
  rules: CutRules | null
  presets: Record<CutPresetId, CutPreset>
  subtitles: SubtitleOptions | null
  highlights: HighlightOptions | null
  flair: FlairOptions | null
  /** the switches as the settings on screen have them */
  highlightsOn: boolean
  subtitlesOn: boolean
  graphicsOn: boolean
  plan: CutPlan | null
  /** the rough cut is worked out and nothing of it is left to write */
  empty: boolean
  /** read whatever is switched on or off; null until the first answer */
  preview: HighlightPreview | null
  lines: SubtitleLine[] | null
  /** one per line: what the user typed and main has not been read back with yet, else `savedText`, else the generated text */
  texts: string[]
  error: string | null
  setError: (message: string | null) => void
  /** the reads whose last answer was a failure: what they would give is not known, so nothing is written */
  failed: Readonly<Record<RoomRead, boolean>>
  /** reads again one that failed */
  retry(read: RoomRead): void
  /** the groups are being placed again: nothing is written meanwhile */
  placing: boolean
  deciding: boolean
  /** a change of the user's is being saved */
  editing: boolean
  /** the main process has said whether a write to this draft is running */
  writeKnown: boolean
  write: WriteState
  /** a write is running: the post page shows but changes nothing */
  writing: boolean
  run: PostRunView
  /** the works of the run going, or of the last one, as heard since it began; null when the room opened on a run already going */
  runWorks: readonly PostWork[] | null
  /** the graphic being written again, by its place: from the press of ทำใหม่ until the preview read that follows the run's end has landed or failed; null when none is */
  redoing: CueAnchor | null
  /** a run that is not a redo is writing the graphics not written yet: from its graphics work running until the preview read that follows that work's end has landed or failed */
  writingGraphics: boolean
  decide(videoId: string, change: CutDecisionChange): Promise<void>
  changeRules(next: CutRules): void
  changeSubtitles(next: SubtitleOptions): void
  changeHighlights(next: HighlightOptions): void
  changeFlair(next: FlairOptions): void
  /** saves a change to what is stored, then places everything again; answers the failure's message, or null */
  changeHighlightText(action: () => Promise<unknown>): Promise<string | null>
  /** a subtitle line typed by the user: shown at once, saved with setSubtitleText once the typing rests (null when back to the generated text) */
  editSubtitle(index: number, text: string): void
  /** the PostRequest for the settings on screen, or null before they are read */
  request(): PostRequest | null
  planPost(): Promise<void>
  rethink(work: RethinkWork | "emphasis"): Promise<void>
  /** has Claude write the motion graphic at this place again: a run of the graphics work alone, asked with the settings on screen and followed like a work thought again */
  redoGraphic(anchor: CueAnchor): Promise<void>
  /** runs a write the write button built: marks it as this room's own, follows it to its end, refreshes the project; asked again while it runs, it does nothing */
  runWrite(call: () => Promise<WriteResult>): Promise<void>
}

const RoomContext = createContext<ClipRoomValue | null>(null)

/** The room the page sits in; only a page inside a ClipRoom may ask. */
export function useClipRoom(): ClipRoomValue {
  const room = useContext(RoomContext)
  if (room === null) throw new Error("useClipRoom is used outside a ClipRoom")
  return room
}

/**
 * A function that keeps one identity for the room's whole life and always runs the latest render's
 * version, so a page can name it in an effect's dependencies without the effect running again on
 * every change of the room. It is brought up to date before any layout effect runs, a page's included.
 */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  useInsertionEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: A) => latest.current(...args), [])
}

// graphics made in the background are shown as they come, but a burst of them reads the preview once
const GRAPHICS_REFRESH_MS = 500
// how long the user's own colours must stay put before the graphics are read again in them: a colour
// picker changes many times a second while dragged, and each read renders every graphic again
const RECOLOUR_READ_MS = 600
// how long a typed subtitle line rests before it is saved: one save a pause, not one a letter
const SUBTITLE_SAVE_MS = 400

const NO_RUN: PostRunView = { running: false, states: {} }
const NONE_FAILED: Record<RoomRead, boolean> = { settings: false, cut: false, preview: false, lines: false }

/** The settings the room changes, each saved whole. */
type SavedSetting = "cut" | "subtitles" | "highlights" | "flair"

/** What to tell the user when a Claude call ends badly: nothing when they stopped it, plain words when it ran out of time, and main's known words (another run of the project going, no Claude connection) in theirs. */
export const aiFailure = (error: unknown): string | null => failureText((error as Error).message)

/**
 * Everything the post-production page and the write button on its bar share about one project: the
 * settings, the rough cut, the placed preview, the subtitle lines, the plan run, and the write. It is
 * the one that claims the draft's write ends from the app, and tells them by a toast.
 */
export function ClipRoom({ api, project: initialProject, stored, capcutRunning, draftVersion, claim, onWritten, children }: ClipRoomProps): ReactElement {
  const folder = initialProject.folder
  const [project, setProject] = useState(initialProject)
  const [rules, setRules] = useState<CutRules | null>(null)
  const [presets, setPresets] = useState<Record<CutPresetId, CutPreset>>(CUT_PRESETS)
  const [plan, setPlan] = useState<CutPlan | null>(null)
  const [write, setWrite] = useState<WriteState>({ kind: "idle" })
  // whether the main process has said if a write to this draft is running: nothing is written until it has
  const [writeKnown, setWriteKnown] = useState(false)
  // this room's own write: its answer says how it ended, so the events about it are left alone
  const ownWrite = useRef(false)
  // a write this room did not start, running when it opened (the room was left and opened again while
  // the write waited for its graphics): only the events say how that one ends
  const following = useRef(false)
  // a write that ended is told by a toast, and so is one that failed (the button is ready again, and the page carries
  // no notice of it). A toast's time starts over whenever the function that removes it changes, so these keep theirs for good
  const [told, setTold] = useState<WriteResult | null>(null)
  const toldDone = useCallback(() => setTold(null), [])
  const [writeFailed, setWriteFailed] = useState<string | null>(null)
  const writeFailedDone = useCallback(() => setWriteFailed(null), [])
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailedReads] = useState<Record<RoomRead, boolean>>(NONE_FAILED)
  const setFailed = (read: RoomRead, value: boolean) => setFailedReads((current) => (current[read] === value ? current : { ...current, [read]: value }))
  const [subtitles, setSubtitles] = useState<SubtitleOptions | null>(null)
  const [lines, setLines] = useState<SubtitleLine[] | null>(null)
  const [texts, setTexts] = useState<string[]>([])
  // the subtitle lines are read again: a plan run polished them
  const [linesVersion, setLinesVersion] = useState(0)
  const [decisionsVersion, setDecisionsVersion] = useState(0)
  // the rough cut is worked out again, as it was: its last read failed
  const [cutVersion, setCutVersion] = useState(0)
  const [deciding, setDeciding] = useState(false)
  const [highlights, setHighlights] = useState<HighlightOptions | null>(null)
  const [flair, setFlair] = useState<FlairOptions | null>(null)
  const [preview, setPreview] = useState<HighlightPreview | null>(null)
  // a change to the stored groups: the groups are placed again
  const [highlightsVersion, setHighlightsVersion] = useState(0)
  // graphics were made in the background, can be made now, or are drawn in new colours, or a run going stored its
  // plan of them or a writing of one: the preview is read again for how they stand and their posters, holding nothing up
  const [graphicsVersion, setGraphicsVersion] = useState(0)
  // any change to the groups or the points, including Claude's answer, which arrives already placed: the
  // words the subtitle lines leave out under the text may be others now
  const [highlightTextVersion, setHighlightTextVersion] = useState(0)
  // a setting the hidden words depend on was saved: the subtitle lines hide the words of the text that is drawn, which
  // the main process works out from the saved settings (the level, the graphics and looks switches, the text's position)
  const [savedVersion, setSavedVersion] = useState(0)
  // the settings changed on screen in a way the subtitle lines have not been read again for, since the change is not
  // saved yet: each by name, so that one's save landing does not release the lines while the other's is still out
  const unsaved = useRef(new Set<"flair" | "highlights">())
  // each setting's saves, counted: a setting is stored whole, so only its latest save says what main keeps
  const settingSaves = useRef<Record<SavedSetting, number>>({ cut: 0, subtitles: 0, highlights: 0, flair: 0 })
  // the groups are being placed again: until they come, lines are named by places that may be stale
  const [placing, setPlacingState] = useState(false)
  // the same, for the placement effect, which must not run again each time placing changes
  const placingNow = useRef(false)
  const setPlacing = (next: boolean) => {
    placingNow.current = next
    setPlacingState(next)
  }
  const [editing, setEditing] = useState(false)
  const [run, setRun] = useState<PostRunView>(NO_RUN)
  const [runWorks, setRunWorks] = useState<readonly PostWork[] | null>([])
  // whether a run goes, for the events that arrive between renders: the first event of a run begins its works
  const runningNow = useRef(false)
  // what the graphics' rows say is being written. A graphic written again is known by its place from the press of
  // ทำใหม่, and is the only one being written then; any other run writes every graphic not written yet while its
  // graphics work runs. A room opened on a run already going cannot know whether it is a redo, nor of which
  // graphic, since main does not say: it takes it for a plan run
  const [redoing, setRedoing] = useState<CueAnchor | null>(null)
  const [writingGraphics, setWritingState] = useState(false)
  // the same, for the press of ทำใหม่, which takes it off and must know what it took
  const writingNow = useRef(false)
  const setWritingGraphics = (next: boolean) => {
    writingNow.current = next
    setWritingState(next)
  }
  // this room's own redo is the run going, for the events that arrive between renders: its graphics work is not a plan run's
  const redoRun = useRef(false)
  // the graphics work or the run has ended: the number of the latest preview read asked by then, else null. What
  // says a graphic is being written holds until a read asked after the end lands or fails. The read that follows
  // an end is only asked once the room has drawn again, and one asked before it, whose answer comes in between,
  // still shows what was read before the end
  const writingOver = useRef<number | null>(null)
  const previewedRules = useRef<CutRules | null>(null)
  // answers to earlier previews must not overwrite the one for the latest rules
  const latestPreview = useRef(0)
  const latestSubtitles = useRef(0)
  const latestHighlights = useRef(0)
  // what the last placement was asked for, to tell a read for graphics from a change of the user's
  const placedFor = useRef<unknown[] | null>(null)
  // subtitle lines typed, by key, with the generated text they are forgotten at; once saved, the count of
  // line reads asked by then: only a read asked after that carries the typed text itself, so until one
  // lands the typed text stands over what a read says
  const typed = useRef(new Map<string, { text: string; generated: string; savedAt?: number }>())
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const refreshProject = () =>
    api.inspectProject(folder).then(
      (detail) => setProject(detail),
      (e: Error) => setError(e.message),
    )

  const readSettings = () =>
    api.getSettings().then(
      (settings) => {
        setRules(settings.cut)
        setPresets(settings.cutPresets)
        setSubtitles(settings.subtitles)
        setHighlights(settings.highlights)
        setFlair(settings.flair)
      },
      (e: Error) => {
        setError(e.message)
        setFailed("settings", true)
      },
    )

  useEffect(() => {
    void refreshProject()
    void readSettings()
    // load once for this project
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, folder])

  /** A write this room shows the end of: the button reads that it was written, and a toast tells what it wrote. */
  const ended = (result: WriteResult) => {
    setWrite({ kind: "written" })
    setTold(result)
  }

  // a write outlives the room: one started here goes on while the user is in the settings or the outline,
  // and the room opened again follows it to its end. Its end is shown once, by whichever room is open
  // when it comes; an end heard while the question is still out is newer than the answer. The app tells
  // the ends no room is open for, so the room claims its draft only once it listens, and gives it up as
  // it leaves the screen: in the commit itself, as a layout effect, not some moment after
  useLayoutEffect(() => {
    // an answer that comes after this effect is cleaned up is about a room no longer here
    let live = true
    let asking = true
    let endedWhileAsking = false
    const stop = api.onEvent((event) => {
      if (event.type !== "timeline-write" || event.folder !== folder || ownWrite.current) return
      if (event.state === "started") {
        following.current = true
        setWrite({ kind: "writing" })
        // how the write before ended is over once another begins
        setTold(null)
        setWriteFailed(null)
        return
      }
      if (!following.current && !asking) return
      following.current = false
      if (asking) endedWhileAsking = true
      if (event.state === "done") {
        ended(event.result)
        // the draft holds what was written: the next write is checked against that
        void refreshProject()
      } else {
        // told like the failure of a write the room started itself
        setWriteFailed(event.error)
        setWrite({ kind: "idle" })
      }
    })
    api
      .writingTimeline(folder)
      .then(
        (writing) => {
          if (!live || !writing || endedWhileAsking || ownWrite.current) return
          following.current = true
          setWrite({ kind: "writing" })
        },
        // a question that cannot be answered holds nothing up: the main process refuses a second write itself.
        // A write may be running all the same, and no one else is left to tell its end
        () => {
          if (live) following.current = true
        },
      )
      .finally(() => {
        if (!live) return
        asking = false
        setWriteKnown(true)
      })
    claim?.(folder)
    return () => {
      live = false
      stop()
      claim?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, folder])

  // a restore put another timeline in the draft: the count the write is checked against has changed, and
  // what the last write put there is gone, so its result no longer says what the draft holds
  const seenDraft = useRef(draftVersion)
  useEffect(() => {
    if (seenDraft.current === draftVersion) return
    seenDraft.current = draftVersion
    setWrite((current) => (current.kind === "written" ? { kind: "idle" } : current))
    setTold(null)
    void refreshProject()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftVersion])

  // CapCut may have changed the timeline while it was open; the write refuses a stale count
  const wasRunning = useRef(capcutRunning)
  useEffect(() => {
    if (wasRunning.current === true && capcutRunning === false) void refreshProject()
    wasRunning.current = capcutRunning
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capcutRunning])

  useEffect(() => {
    if (!rules) return
    const request = ++latestPreview.current
    // a decision redraws the review in place; new rules start from the waiting message
    if (previewedRules.current !== rules) setPlan(null)
    previewedRules.current = rules
    setFailed("cut", false)
    api.previewCut(folder, rules).then(
      (next) => {
        if (request !== latestPreview.current) return
        setPlan(next)
      },
      (e: Error) => {
        if (request !== latestPreview.current) return
        setError(e.message)
        setFailed("cut", true)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, folder, rules, decisionsVersion, cutVersion])

  const highlightsOn = highlights?.enabled === true
  const subtitlesOn = subtitles?.enabled === true
  const highlightPosition = highlights?.position
  const graphicsOn = flair?.graphic === true
  const empty = plan !== null && plan.cuts.length === 0
  // the whole flair setting drives the placement, so any change to it places the groups again
  const flairKey = JSON.stringify(flair)
  // everything a placement is for; graphics made in the background change none of it
  const placementInputs = [api, folder, rules, highlightsOn, highlightPosition, subtitlesOn, decisionsVersion, highlightsVersion, flairKey]
  // the preview is read whatever is switched on: sounds, zooms, cutaways and graphics play without the text
  useEffect(() => {
    const request = ++latestHighlights.current
    // a read for graphics alone changes nothing the user can act on, so it holds nothing up and a
    // failure keeps the preview on screen. Anything else that changed with it is the user's, and while
    // the user's change is still being placed, this placement stands in for that one: neither is quiet
    const graphicsAlone = placedFor.current !== null && placementInputs.every((input, i) => Object.is(input, placedFor.current![i]))
    placedFor.current = placementInputs
    const quiet = graphicsAlone && !placingNow.current
    if (!rules || !highlightPosition) {
      setPreview(null)
      setPlacing(false)
      return
    }
    if (!quiet) {
      setPlacing(true)
      setFailed("preview", false)
    }
    const settled = () => request === latestHighlights.current && setPlacing(false)
    // a writing that is over stops being said here, once this read is one asked after its end, in the same batch as
    // the preview the rows then show (or keep, when the read failed): a row goes from being written straight to how it stands
    const writingShown = () => {
      if (writingOver.current === null || request <= writingOver.current) return
      writingOver.current = null
      setRedoing(null)
      setWritingGraphics(false)
    }
    api.previewHighlights(folder, rules, { position: highlightPosition, subtitlesOn, highlightsOn, flair: flair ?? DEFAULT_FLAIR_OPTIONS }).then(
      (next) => {
        if (request !== latestHighlights.current) return
        setPreview(next)
        setFailed("preview", false)
        writingShown()
        settled()
      },
      (e: Error) => {
        if (request !== latestHighlights.current) return
        // the next graphic made, or the user's next change, reads it again; until then a placement of the
        // user's that failed leaves an old preview on screen, which nothing is written from
        if (!quiet) {
          setError(e.message)
          setFailed("preview", true)
        }
        writingShown()
        settled()
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...placementInputs, graphicsVersion])

  // each graphic rendered in the background shows as soon as it is made. A burst of them is read at
  // once and then at most every GRAPHICS_REFRESH_MS, always once more after the last, or a row would
  // stay on "rendering"; the graphics renderer sends nothing when a preview queues nothing, so this cannot loop
  useEffect(() => {
    let last = -Infinity
    let due: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      due = undefined
      // a clock that never goes back, so a change of the system time cannot hold the next read up
      last = performance.now()
      setGraphicsVersion((version) => version + 1)
    }
    const stop = api.onEvent((event) => {
      // the renderer pack is in: graphics that waited for it are read again, which starts their renders
      const packInstalled = event.type === "graphics-pack" && event.state === "done"
      if ((!packInstalled && (event.type !== "graphics" || event.folder !== folder)) || due !== undefined) return
      const wait = last + GRAPHICS_REFRESH_MS - performance.now()
      if (wait > 0) due = setTimeout(refresh, wait)
      else refresh()
    })
    return () => {
      stop()
      clearTimeout(due)
    }
  }, [api, folder])

  // a plan run outlives the room like a write does: the room opened again asks how it stands, and every
  // work that ends reads again what it changed. New points or new text change which words the subtitle
  // lines leave out under the text, and so may what a run left when it ended part way: those lines are
  // read again after the points' work, the text's, and at the run's end. An event heard while the
  // question is out is newer than the answer
  useEffect(() => {
    let live = true
    let heard = false
    const stop = api.onEvent((event) => {
      if ((event.type !== "post-plan" && event.type !== "post-plan-finished") || event.folder !== folder) return
      heard = true
      if (event.type === "post-plan-finished") {
        runningNow.current = false
        // the run is over, and so is whatever it was writing: the rows say so once the read asked for below has landed or failed
        writingOver.current = latestHighlights.current
        setRun((current) => ({ ...current, running: false }))
        setHighlightTextVersion((version) => version + 1)
        // main notes the version of the points a work planned on only after its "done", and a work switched off
        // sends none: the banners are read again once the run is over, quietly, as for a graphic made
        setGraphicsVersion((version) => version + 1)
        return
      }
      // a run's first event begins its works; one of a run the room opened on adds to works it does not know
      const begins = !runningNow.current
      runningNow.current = true
      const work = event.work
      setRunWorks((works) => (begins ? [work] : works === null || works.includes(work) ? works : [...works, work]))
      // a work's state lands on top of how the others last stood: main keeps the states a run does not touch
      setRun((current) => ({ running: true, states: { ...current.states, [event.work]: event.state } }))
      if (event.work === "graphics" && event.state.state === "running") {
        // a redo is a run of the graphics work too, and writes the one graphic asked for: only a run that is not
        // this room's redo writes every graphic not written yet
        if (!redoRun.current) {
          writingOver.current = null
          setWritingGraphics(true)
        }
        // the graphics work counts once its plan is stored, and again as each graphic's writing is stored, and main
        // tells neither by anything else: the graphics are read again for each count, quietly, as for one made, so a
        // row shows as being written at once and says how it stands as soon as its writing has ended
        if (event.state.done !== undefined) setGraphicsVersion((version) => version + 1)
      } else if (event.work === "graphics" && event.state.state !== "waiting") {
        // the graphics work is over, however it ended: what is being written is said until the read that follows
        // has landed or failed. A work that ended done asks for that read below; one that failed asks for it here,
        // or in a run that goes on with its other works the rows would say so until one of those ended
        writingOver.current = latestHighlights.current
        if (event.state.state === "failed") setGraphicsVersion((version) => version + 1)
      }
      if (event.state.state !== "done") return
      if (event.work === "subtitles") setLinesVersion((version) => version + 1)
      else setHighlightsVersion((version) => version + 1)
      if (event.work === "emphasis" || event.work === "text") setHighlightTextVersion((version) => version + 1)
    })
    api.postPlanState(folder).then(
      (state) => {
        if (!live || heard || state === null) return
        runningNow.current = state.running
        // which works a run going touches, main does not say
        if (state.running) setRunWorks(null)
        setRun(state)
        // nor whether it is one graphic written again, or which: its graphics work is taken for a plan run's,
        // which writes every graphic not written yet
        if (state.running && state.states.graphics?.state === "running") setWritingGraphics(true)
      },
      // nothing known is nothing running: the run's own events still come
      () => {},
    )
    return () => {
      live = false
      stop()
    }
  }, [api, folder])

  const subtitleLength = subtitles?.length
  const hideUnderHighlights = highlightsOn && highlights?.hideSubtitles === true
  const hiddenWordsVersion = hideUnderHighlights ? `${highlightTextVersion}:${savedVersion}` : ""
  // a group a graphic takes the place of hides no words, so the lines that leave out the words under the text change
  // with the set of those groups: as a graphic is written, goes stale, is switched off or removed, or the graphics
  // are switched off. The preview says which they are, so the lines are read again whenever it says otherwise
  const replacedGroups = hideUnderHighlights ? (preview?.groups.filter((group) => group.replaced).map((group) => group.id).join("\n") ?? "") : ""
  useEffect(() => {
    const request = ++latestSubtitles.current
    setLines(null)
    setFailed("lines", false)
    // lines that hide the text are read under the saved settings: not while a change on screen that they depend on is still being saved
    if (!rules || !subtitlesOn || !subtitleLength || (hideUnderHighlights && unsaved.current.size > 0)) return
    api.previewSubtitles(folder, rules, subtitleLength, hideUnderHighlights).then(
      (next) => {
        if (request !== latestSubtitles.current) return
        // a line saved before this read was asked comes back in it, as main keeps it now (a polish may have
        // changed it since): the typed copy goes first, so main's text is the one shown
        for (const [key, entry] of typed.current) if (entry.savedAt !== undefined && request > entry.savedAt) typed.current.delete(key)
        setLines(next)
        setTexts(next.map((line) => typed.current.get(line.key)?.text ?? line.savedText ?? line.text))
      },
      (e: Error) => {
        if (request !== latestSubtitles.current) return
        setError(e.message)
        setFailed("lines", true)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, folder, rules, subtitlesOn, subtitleLength, decisionsVersion, hideUnderHighlights, hiddenWordsVersion, replacedGroups, linesVersion])

  /** Saves the line typed under this key, if it still waits; a line typed back to the generated text is forgotten. */
  const saveTyped = (key: string) => {
    clearTimeout(saveTimers.current.get(key))
    saveTimers.current.delete(key)
    const entry = typed.current.get(key)
    if (!entry || entry.savedAt !== undefined) return
    api.setSubtitleText(folder, key, entry.text === entry.generated ? null : entry.text).then(
      // a read already asked may still answer with the text from before, so the typed one is kept until a
      // read asked from here on lands; a newer text typed meanwhile waits for its own save
      () => {
        if (typed.current.get(key) === entry) entry.savedAt = latestSubtitles.current
      },
      (e: Error) => setError(e.message),
    )
  }

  // a line typed just before the room goes is saved as it goes, not lost with the timer
  useEffect(
    () => () => {
      for (const key of [...saveTimers.current.keys()]) saveTyped(key)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const editSubtitle = useStable((index: number, text: string) => {
    const line = lines?.[index]
    setTexts((previous) => previous.map((value, i) => (i === index ? text : value)))
    if (!line) return
    // the key holds the generated text, so a line typed back to it needs no special case
    typed.current.set(line.key, { text, generated: line.text })
    clearTimeout(saveTimers.current.get(line.key))
    saveTimers.current.set(
      line.key,
      setTimeout(() => saveTyped(line.key), SUBTITLE_SAVE_MS),
    )
  })

  const decide = useStable(async (videoId: string, change: CutDecisionChange) => {
    setDeciding(true)
    setError(null)
    try {
      await api.setCutDecision(folder, videoId, change)
      setDecisionsVersion((version) => version + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeciding(false)
    }
  })

  /** Reads again what failed to be read, as the notice of it asks: what it holds up waits for it again. */
  const retry = useStable((read: RoomRead) => {
    setError(null)
    if (read === "settings") {
      setFailed("settings", false)
      void readSettings()
    } else if (read === "cut") {
      // the cut on screen is the one before the read that failed, not what would be written: it goes until the new one lands
      previewedRules.current = null
      setCutVersion((version) => version + 1)
    } else if (read === "preview") setHighlightsVersion((version) => version + 1)
    else setLinesVersion((version) => version + 1)
  })

  /**
   * Saves a setting as the user changed it on screen, and answers the save. Only its latest save speaks
   * for it: an earlier one that fails while a later one is on its way says nothing, since the later one
   * stores the whole setting again. The latest one failing says why, and the screen goes back to what
   * main keeps (`kept`), since main reads some of it from the saved settings. `settled` is told once the
   * latest save is over: landed, or failed with what main keeps not to be read either, so that nothing
   * waits for a save that will never land.
   */
  const saveSetting = (setting: SavedSetting, patch: SettingsPatch, kept: (settings: SettingsView) => void, settled: () => void = () => {}): Promise<void> => {
    const save = ++settingSaves.current[setting]
    const latest = () => save === settingSaves.current[setting]
    const answer = api.updateSettings(patch)
    answer.then(
      () => latest() && settled(),
      (e: Error) => {
        if (!latest()) return
        setError(e.message)
        api.getSettings().then(
          (settings) => latest() && kept(settings),
          // what main keeps cannot be read: the screen stays as it is, and the lines are read under whatever main does keep
          () => latest() && settled(),
        )
      },
    )
    return answer
  }

  const changeSubtitles = useStable((next: SubtitleOptions) => {
    setSubtitles(next)
    setError(null)
    void saveSetting("subtitles", { subtitles: next }, (settings) => setSubtitles(settings.subtitles))
  })

  /**
   * A setting changed on screen in a way that may change which words the subtitle lines leave out under the text:
   * the lines are not read until it is saved, since main reads them under the saved settings.
   */
  const awaitSave = (setting: "flair" | "highlights") => {
    unsaved.current.add(setting)
    // the lines on screen hide the text as it was drawn before: nothing is written until they are read again, once the change is saved
    if (hideUnderHighlights) {
      latestSubtitles.current++
      setLines(null)
    }
  }

  /** The setting on screen is saved (or put back to the saved one): the subtitle lines are read under it, once no other change is still out. */
  const settingSaved = (setting: "flair" | "highlights") => {
    if (!unsaved.current.delete(setting)) return
    setSavedVersion((version) => version + 1)
  }

  const changeFlair = useStable((next: FlairOptions) => {
    // the level chooses which points' text shows; the graphics and the looks decide which text a graphic takes the place of
    if (next.level !== flair?.level || next.graphic !== flair?.graphic || next.text !== flair?.text) awaitSave("flair")
    setFlair(next)
    setError(null)
    // an earlier save that lands while a later one is still being written says nothing of what main will keep
    void saveSetting(
      "flair",
      { flair: next },
      (settings) => {
        setFlair(settings.flair)
        settingSaved("flair")
      },
      () => settingSaved("flair"),
    )
  })

  // the graphics are drawn in the custom style's colours, which the main process reads from the saved
  // settings: new ones are read again once saved, and once the user has stopped picking
  const recolour = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(recolour.current), [])

  const changeHighlights = useStable((next: HighlightOptions) => {
    const recoloured = JSON.stringify(next.custom) !== JSON.stringify(highlights?.custom)
    setHighlights(next)
    setError(null)
    // where the text sits decides which graphics have room, and so which text a graphic takes the place of
    if (next.position !== highlights?.position) awaitSave("highlights")
    const saved = saveSetting(
      "highlights",
      { highlights: next },
      (settings) => {
        setHighlights(settings.highlights)
        settingSaved("highlights")
      },
      () => settingSaved("highlights"),
    )
    if (!recoloured || !graphicsOn) return
    clearTimeout(recolour.current)
    recolour.current = setTimeout(() => void saved.then(() => setGraphicsVersion((version) => version + 1), () => {}), RECOLOUR_READ_MS)
  })

  const changeRules = useStable((next: CutRules) => {
    setRules(next)
    setError(null)
    void saveSetting("cut", { cut: next }, (settings) => setRules(settings.cut))
  })

  const changeHighlightText = useStable(async (action: () => Promise<unknown>): Promise<string | null> => {
    setEditing(true)
    setError(null)
    try {
      await action()
      // the groups on screen are old from here on: nothing is written until they are placed again
      setPlacing(true)
      setHighlightsVersion((version) => version + 1)
      setHighlightTextVersion((version) => version + 1)
      return null
    } catch (e) {
      // a refusal main has words for (a point that overlaps another, a picture gone) is said in the user's
      const message = mainText(e instanceof Error ? e.message : String(e))
      setError(message)
      return message
    } finally {
      setEditing(false)
    }
  })

  // a new identity only when what it asks with changes, so it is right when called while a page renders
  const request = useCallback((): PostRequest | null => {
    if (!rules || !highlights || !flair || !subtitles) return null
    return {
      rules,
      view: { position: highlights.position, subtitlesOn, highlightsOn, flair },
      subtitles: subtitlesOn ? { length: subtitles.length, polish: subtitles.polish, hideUnderHighlights } : null,
    }
  }, [rules, highlights, flair, subtitles, subtitlesOn, highlightsOn, hideUnderHighlights])

  /** Starts a run of the works this room asks for; the events fill it in, and its answer says how it ended. */
  const running = async (call: (asked: PostRequest) => Promise<PostRunView | null>) => {
    const asked = request()
    if (!asked) return
    setError(null)
    // the works this run does not touch keep their marks, as main keeps their states; its own come with its events
    runningNow.current = true
    setRunWorks([])
    setRun((current) => ({ running: true, states: current.states }))
    try {
      const outcome = await call(asked)
      runningNow.current = outcome?.running ?? false
      setRun((current) => outcome ?? { ...current, running: false })
    } catch (e) {
      setError(aiFailure(e))
      // refused (another of this project's runs is going) or cut short: how the run stands is main's to say
      const stands = await api.postPlanState(folder).catch(() => null)
      runningNow.current = stands?.running ?? false
      setRun((current) => stands ?? { ...current, running: false })
    }
  }

  const planPost = useStable(() => running((asked) => api.planPost(folder, asked)))

  const rethink = useStable((work: RethinkWork | "emphasis") =>
    running(async (asked) => {
      if (work !== "emphasis") return api.rethinkPost(folder, work, asked)
      // the points answer with their counts; how the run ended, the other works' states with it, is main's
      // to say. The points stand if main cannot say it: the marks stay as the events left them
      try {
        await api.planEmphasis(folder, asked.rules)
      } catch (e) {
        // the points' own failure is told by the strip and the tab's flag, from main's state: said above them
        // too it would be said twice. Anything else, a run refused, is the room's to say
        const stands = await api.postPlanState(folder).catch(() => null)
        const own = stands?.states.emphasis
        if (own?.state === "failed" && (e as Error).message.endsWith(own.error)) return stands
        throw e
      }
      return api.postPlanState(folder).catch(() => null)
    }),
  )

  const redoGraphic = useStable((anchor: CueAnchor) =>
    running(async (asked) => {
      // what the press takes off of a plan run's writing, to put back if main refuses the redo because that run
      // goes. One already over, held only for its read, is not put back: nothing would take it off again
      const stillWriting = writingNow.current && writingOver.current === null
      // from the press the graphic is the one being written, and the only one: a writing before it whose read is
      // still out gives way to this one
      writingOver.current = null
      setWritingGraphics(false)
      setRedoing(anchor)
      redoRun.current = true
      try {
        return await api.redoGraphic(folder, anchor, asked)
      } catch (e) {
        // refused before it began, as when another run goes: no graphic is being written again, and no read follows to say so
        setRedoing(null)
        if (stillWriting) setWritingGraphics(true)
        throw e
      } finally {
        redoRun.current = false
      }
    }),
  )

  const runWrite = useStable(async (call: () => Promise<WriteResult>) => {
    // a second activation in the same moment as the first, before the page has rendered the write as running,
    // starts nothing: main would refuse it, and that refusal would turn the write that runs idle
    if (ownWrite.current) return
    ownWrite.current = true
    setWrite({ kind: "writing" })
    setError(null)
    // how the write before ended is over once the user tries again
    setWriteFailed(null)
    setTold(null)
    try {
      const result = await call()
      // the main process let this write run, so no other was running to follow
      following.current = false
      onWritten?.()
      // the draft holds what was written: the next write is checked against its count, so the button goes on saying
      // it is writing until that is read, or a confirm pressed meanwhile would be ignored above (or refused by main)
      await refreshProject()
      ended(result)
    } catch (e) {
      setWriteFailed((e as Error).message)
      setWrite({ kind: "idle" })
    } finally {
      ownWrite.current = false
    }
  })

  // a new value only when something in it changes, so a page's effects that name it run when they must
  const value = useMemo<ClipRoomValue>(
    () => ({
      api,
      folder,
      project,
      stored,
      capcutRunning,
      rules,
      presets,
      subtitles,
      highlights,
      flair,
      highlightsOn,
      subtitlesOn,
      graphicsOn,
      plan,
      empty,
      preview,
      lines,
      texts,
      error,
      setError,
      failed,
      retry,
      placing,
      deciding,
      editing,
      writeKnown,
      write,
      writing: write.kind === "writing",
      run,
      runWorks,
      redoing,
      writingGraphics,
      decide,
      changeRules,
      changeSubtitles,
      changeHighlights,
      changeFlair,
      changeHighlightText,
      editSubtitle,
      request,
      planPost,
      rethink,
      redoGraphic,
      runWrite,
    }),
    // the actions keep their identities for good; request's changes with what it asks with
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, folder, project, stored, capcutRunning, rules, presets, subtitles, highlights, flair, plan, preview, lines, texts, error, failed, placing, deciding, editing, writeKnown, write, run, runWorks, redoing, writingGraphics, request],
  )

  return (
    <RoomContext.Provider value={value}>
      {children}
      {told && <Toast message={toldMessage(told)} ms={toldIsLong(told) ? ACTION_TOAST_MS : undefined} onDone={toldDone} />}
      {writeFailed !== null && <Toast message={t("write.failed", { message: writeFailed })} ms={ACTION_TOAST_MS} onDone={writeFailedDone} />}
    </RoomContext.Provider>
  )
}
