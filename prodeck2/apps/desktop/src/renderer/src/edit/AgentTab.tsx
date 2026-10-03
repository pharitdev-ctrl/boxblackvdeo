import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import type { AgentPreview, AgentRequest, AgentTurn, AgentView } from "../../../shared/api.ts"
import { formatDuration } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { useClipRoom } from "../room/ClipRoom.tsx"
import { Button } from "../ui/Button.tsx"
import { Sheet } from "../ui/Sheet.tsx"
import { mainText } from "./postTabs.ts"
import { PreviewPlayer } from "./PreviewPlayer.tsx"

const KIND_NAMES: Record<string, MessageKey> = {
  caption: "agent.kind.caption",
  highlight: "agent.kind.highlight",
  move: "agent.kind.move",
  zoom: "agent.kind.zoom",
  insert: "agent.kind.insert",
  graphic: "agent.kind.graphic",
  composed: "agent.kind.composed",
  sound: "agent.kind.sound",
}
/** A time on the rough cut to a tenth of a second, as Claude names times: pieces a second apart or less still read apart. */
const seconds = (us: number) => (us / 1_000_000).toFixed(1)

const BY_NAMES: Record<AgentView["pieces"][number]["by"], MessageKey> = { pipeline: "agent.by.pipeline", claude: "agent.by.claude", user: "agent.by.user" }

function Turn({ turn }: { turn: AgentTurn }): ReactElement {
  if (turn.role === "user") return <li className="agent-turn user">{turn.text}</li>
  if (turn.role === "claude")
    return (
      <li className="agent-turn claude">
        {turn.say && <p>{turn.say}</p>}
        {turn.actions.length > 0 && <p className="hint mono">{t("agent.actions", { count: turn.actions.length })}</p>}
      </li>
    )
  return (
    <li className="agent-turn results">
      {turn.lines.map((line, i) => (
        <p key={i} className={line.startsWith("✗") ? "warn-text" : "hint"}>
          {line}
        </p>
      ))}
    </li>
  )
}

/**
 * The agent editor (spec docs/specs/2026-10-03-agent-editor-design.md §10): a conversation with Claude on its own
 * working timeline, started from what the rest of the page would write, with the pieces listed to lock or remove
 * and a write of that timeline. The request it opens with is the write button's.
 */
export function AgentTab(): ReactElement {
  const room = useClipRoom()
  const { api, folder, project, rules, subtitles, highlights, flair, preview, texts, highlightsOn, subtitlesOn } = room
  const [view, setView] = useState<AgentView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [asking, setAsking] = useState<"write" | "reset" | null>(null)
  const [written, setWritten] = useState<string | null>(null)
  const [segments, setSegments] = useState(project.timelineSegmentCount)
  const [look, setLook] = useState<{ what: string; sheets: string[] } | null>(null)
  const [playable, setPlayable] = useState<AgentPreview | "making" | null>(null)
  const end = useRef<HTMLLIElement>(null)

  const request: AgentRequest | null = useMemo(
    () =>
      rules && highlights && flair && preview
        ? {
            rules,
            subtitles: subtitlesOn && subtitles ? { length: subtitles.length, texts } : null,
            highlights: { position: highlights.position, hideSubtitles: highlights.hideSubtitles, highlightsOn, groupCount: preview.groups.length, flair },
          }
        : null,
    [rules, highlights, flair, preview, subtitlesOn, subtitles, texts, highlightsOn],
  )
  const ready = request !== null

  useEffect(() => {
    if (!request || view) return
    let alive = true
    api.agentOpen(folder, request).then(
      (opened) => alive && setView(opened),
      (e: Error) => alive && setError(mainText(e.message)),
    )
    return () => {
      alive = false
    }
    // opened once per page, from the request as it stands when the tab is first shown with one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, folder, ready])

  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.type === "agent" && event.view.folder === folder) setView(event.view)
      }),
    [api, folder],
  )
  // what Claude last looked at, read again whenever it looks
  const looks = view?.looks ?? 0
  useEffect(() => {
    if (looks === 0) return
    let alive = true
    api.agentLook(folder).then(
      (found) => alive && setLook(found),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [api, folder, looks])

  useEffect(() => {
    // in braces: a newer Chromium's scrollIntoView answers a promise, which React would take for the effect's cleanup
    void end.current?.scrollIntoView?.({ block: "end" })
  }, [view?.turns.length])

  const call = (work: () => Promise<AgentView | void>) => {
    setError(null)
    work().then(
      (next) => next && setView(next),
      (e: Error) => setError(mainText(e.message)),
    )
  }
  const send = (text: string) => {
    if (!text.trim()) return
    setDraft("")
    setWritten(null)
    call(() => api.agentSend(folder, text))
  }
  const write = () => {
    setAsking(null)
    setError(null)
    api.agentWrite(folder, segments).then(
      (result) => {
        setSegments(result.segmentCount)
        setWritten(t("agent.written", { duration: formatDuration(result.durationUs), segments: result.segmentCount }))
      },
      (e: Error) => setError(mainText(e.message)),
    )
  }

  const showPreview = () => {
    setError(null)
    setPlayable("making")
    api.agentPreview(folder).then(setPlayable, (e: Error) => {
      setPlayable(null)
      setError(mainText(e.message))
    })
  }

  if (!ready) return <p className="hint">{t("edit.busy")}</p>
  if (!view) return error ? <p className="notice error">{t("error.generic", { message: error })}</p> : <p className="hint">{t("agent.opening")}</p>
  const running = view.running

  return (
    <div className="agent-tab">
      <div className="agent-chat">
        <ol className="agent-turns" aria-live="polite">
          {view.turns.length === 0 && <li className="hint">{t("agent.empty")}</li>}
          {view.turns.map((turn, i) => (
            <Turn key={i} turn={turn} />
          ))}
          <li ref={end} aria-hidden="true" />
        </ol>
        {error && <p className="notice error">{t("error.generic", { message: error })}</p>}
        {written && <p className="notice">{written}</p>}
        <div className="agent-status hint mono">
          {running ? t("agent.round", { round: view.round, rounds: view.rounds }) : t("agent.idle")}
          {" · "}
          {t("agent.cost", { cost: view.costUsd.toFixed(2) })}
        </div>
        {view.summed && !running && (
          <Button size="sm" variant="ai" onClick={() => send(t("agent.goOnMessage"))}>
            {t("agent.goOn")}
          </Button>
        )}
        <form
          className="agent-input"
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
        >
          <textarea
            rows={3}
            aria-label={t("agent.input")}
            placeholder={t("agent.placeholder")}
            value={draft}
            disabled={running}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send(draft)
            }}
          />
          {running ? (
            <Button onClick={() => void api.agentStop(folder)}>{t("agent.stop")}</Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!draft.trim()}>
              {t("agent.send")}
            </Button>
          )}
        </form>
      </div>

      <div className="agent-pieces">
        <div className="agent-pieces-head">
          <h3>{t("agent.pieces", { count: view.pieces.length })}</h3>
          <Button size="sm" disabled={running || playable === "making"} onClick={showPreview}>
            {playable === "making" ? t("agent.previewMaking") : t("agent.preview")}
          </Button>
          <Button size="sm" variant="primary" disabled={running} onClick={() => setAsking("write")}>
            {t("agent.write")}
          </Button>
        </div>
        {view.direction && <p className="hint">{t("agent.direction", { text: view.direction })}</p>}
        {look && (
          <details className="agent-look" open>
            <summary className="hint">{t("agent.look", { what: look.what })}</summary>
            <div className="agent-look-sheets">
              {look.sheets.map((sheet, i) => (
                <img key={i} src={sheet} alt={t("agent.lookSheet", { n: i + 1 })} />
              ))}
            </div>
            <p className="hint">{t("agent.lookNote")}</p>
          </details>
        )}
        <ul className="agent-piece-list">
          {view.pieces.map((piece) => (
            <li key={piece.id} className={piece.locked ? "agent-piece locked" : "agent-piece"}>
              <span className="mono hint">{t("agent.span", { from: seconds(piece.startUs), to: seconds(piece.endUs) })}</span>
              <span className="agent-piece-text" title={piece.label}>
                <strong>{t(KIND_NAMES[piece.kind] ?? "agent.kind.other")}</strong> {piece.label}
              </span>
              <span className="agent-by hint">{t(BY_NAMES[piece.by])}</span>
              <Button size="xs" variant="ghost" disabled={running} aria-pressed={piece.locked} onClick={() => call(() => api.agentLock(folder, piece.id, !piece.locked))}>
                {piece.locked ? t("agent.unlock") : t("agent.lock")}
              </Button>
              <Button size="xs" variant="ghost" disabled={running} aria-label={t("agent.removeOne", { id: piece.id })} onClick={() => call(() => api.agentRemove(folder, piece.id))}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" disabled={running} onClick={() => setAsking("reset")}>
          {t("agent.reset")}
        </Button>
      </div>

      <Sheet open={playable !== null && playable !== "making"} title={t("agent.previewTitle")} onClose={() => setPlayable(null)} footer={<Button onClick={() => setPlayable(null)}>{t("agent.previewClose")}</Button>}>
        {playable && playable !== "making" && (
          <>
            <PreviewPlayer preview={playable} />
            <p className="hint">{t("agent.lookNote")}</p>
            {playable.skipped.length > 0 && <p className="hint">{t("agent.previewSkipped", { count: playable.skipped.length })}</p>}
          </>
        )}
      </Sheet>

      <Sheet
        open={asking !== null}
        title={asking === "reset" ? t("agent.resetTitle") : t("agent.writeTitle", { project: project.name })}
        onClose={() => setAsking(null)}
        footer={
          <>
            <Button onClick={() => setAsking(null)}>{t("write.cancel")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (asking === "reset") {
                  setAsking(null)
                  if (request) call(() => api.agentReset(folder, request))
                } else write()
              }}
            >
              {asking === "reset" ? t("agent.resetConfirm") : t("write.confirm")}
            </Button>
          </>
        }
      >
        <p>{asking === "reset" ? t("agent.resetBody") : t("agent.writeBody", { count: view.pieces.length })}</p>
      </Sheet>
    </div>
  )
}
