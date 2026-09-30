import { useEffect, useState } from "react"
import type { Beat, Brief, ProjectDetail, RendererApi, StoredOutline } from "../../../shared/api.ts"
import { BeatList } from "../outline/BeatList.tsx"
import { BriefPanel } from "../outline/BriefPanel.tsx"
import { UnusedParts } from "../outline/UnusedParts.tsx"
import { formatDuration } from "../format.ts"
import { t } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Empty } from "../ui/Empty.tsx"

type Phase = { kind: "loading" } | { kind: "planning" } | { kind: "ready" }

interface Props {
  api: RendererApi
  project: ProjectDetail
  videoIds: string[]
  onConfirmed: (stored: StoredOutline) => void
  /** the outline as it stands after every change, so the stages know whether it is still confirmed */
  onStored?: (stored: StoredOutline) => void
}

const EMPTY_BRIEF: Brief = { targetSeconds: null, videoType: null, instructions: "" }
const sameVideos = (a: string[], b: string[]) => [...a].sort().join("\n") === [...b].sort().join("\n")

/**
 * What the clip is meant to be, and the beats Claude made of it. Asking and answering sit side by
 * side: the brief stays on screen while the beats are read, edited and reordered.
 */
export function OutlineScreen({ api, project, videoIds, onConfirmed, onStored }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const [stored, setStoredHere] = useState<StoredOutline | null>(null)
  // the app hears of every outline, even one that lands after the user has left this screen
  const setStored = (next: StoredOutline) => {
    setStoredHere(next)
    onStored?.(next)
  }
  const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedVersion, setSavedVersion] = useState(0)
  const folder = project.folder

  useEffect(() => {
    let alive = true
    api.getOutline(folder).then(
      (found) => {
        if (!alive) return
        if (found && sameVideos(found.videoIds, videoIds)) {
          setBrief(found.brief)
          setStored(found)
        }
        setPhase({ kind: "ready" })
      },
      (e: Error) => {
        if (!alive) return
        setError(e.message)
        setPhase({ kind: "ready" })
      },
    )
    return () => {
      alive = false
    }
  }, [api, folder, videoIds])

  /** Runs a planner call; on failure the outline on screen stays as it was, with the reason. */
  const plan = async (request: () => Promise<StoredOutline>) => {
    setError(null)
    setPhase({ kind: "planning" })
    try {
      const next = await request()
      setBrief(next.brief)
      setStored(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPhase({ kind: "ready" })
    }
  }

  /** Saves an edit to the order or the beats, and remembers it is no longer confirmed. */
  const edit = (beats: Beat[]) => {
    if (!stored) return
    setStored({ ...stored, outline: { ...stored.outline, beats }, confirmed: false })
    setSaving(true)
    api
      .saveOutlineEdits(
        folder,
        beats.map((beat) => beat.id),
        false,
      )
      .then(
        () => setSavedVersion((version) => version + 1),
        (e: Error) => setError(e.message),
      )
      .finally(() => setSaving(false))
  }

  /** Marks the outline ready for the timeline; a refusal (a beat the outline no longer has) says why. */
  const confirm = async () => {
    setError(null)
    setSaving(true)
    try {
      const saved = await api.saveOutlineEdits(
        folder,
        beats.map((beat) => beat.id),
        true,
      )
      onConfirmed(saved)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const beats = stored?.outline.beats ?? []
  const totalUs = beats.reduce((sum, beat) => sum + beat.endUs - beat.startUs, 0)
  const planning = phase.kind === "planning"

  return (
    <section className="screen outline">
      <div className="content outline-body">
        <BriefPanel
          brief={brief}
          onChange={setBrief}
          hasOutline={stored !== null}
          planning={planning}
          onPlan={() => void plan(() => (stored ? api.regenerateOutline(folder, brief) : api.planOutline(folder, videoIds, brief)))}
          onRevise={(instruction) => void plan(() => api.reviseOutline(folder, instruction, brief))}
          onCancel={() => void api.cancelPlanning()}
          plannedAt={stored ? { at: stored.updatedAt, model: stored.model } : undefined}
        />

        <div className={planning ? "outline-main busy" : "outline-main"} aria-busy={planning}>
          {error && <p className="notice error">{t("error.generic", { message: error })}</p>}
          {phase.kind === "loading" && <p className="hint">{t("detail.loading")}</p>}

          {stored && (
            <>
              <div className="screen-head">
                <div>
                  <h1>{stored.outline.title}</h1>
                  <p className="hint">{stored.outline.summary}</p>
                  {stored.outline.omitted && <p className="hint">{t("outline.omitted", { text: stored.outline.omitted })}</p>}
                </div>
                <span className="chip mono">
                  {stored.brief.targetSeconds
                    ? t("outline.length", { total: formatDuration(totalUs), target: formatDuration(stored.brief.targetSeconds * 1_000_000) })
                    : t("outline.lengthNoTarget", { total: formatDuration(totalUs) })}
                </span>
              </div>

              {stored.outline.warnings.length > 0 && <p className="notice warn-text">{t("outline.warnings", { count: stored.outline.warnings.length })}</p>}

              {beats.length === 0 ? (
                <Empty title={t("outline.empty")} />
              ) : (
                <BeatList beats={beats} folder={folder} api={api} disabled={saving || planning} onReorder={(ids) => edit(ids.map((id) => beats.find((beat) => beat.id === id)!))} onRemove={(id) => edit(beats.filter((beat) => beat.id !== id))} />
              )}

              {/* remounted for every outline from the store; edits made here are counted by savedVersion */}
              <UnusedParts
                key={stored.updatedAt}
                api={api}
                folder={folder}
                version={savedVersion}
                onAdded={(next) => {
                  setStored(next)
                  setSavedVersion((version) => version + 1)
                }}
              />
            </>
          )}
        </div>
      </div>

      <footer className="action-bar">
        <span className="hint">{t("outline.drag")}</span>
        <div className="action">
          <Button
            variant="primary"
            disabled={!stored || beats.length === 0 || planning || saving}
            onClick={() => void confirm()}
          >
            {t("outline.confirm")}
          </Button>
        </div>
      </footer>
    </section>
  )
}
