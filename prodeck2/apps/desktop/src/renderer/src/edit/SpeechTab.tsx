import { useState } from "react"
import type { BeatCut, CutDecisionChange, CutRow } from "../../../shared/api.ts"
import { mediaUrl } from "../../../shared/media-url.ts"
import { ScenePlayer } from "../components/ScenePlayer.tsx"
import { formatTimestamp } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"

/** How much before and after a part plays, so the cut can be judged in context. */
const CONTEXT_US = 1_000_000

const reasonText = (row: CutRow) => (row.reason ? t(`timeline.removed.${row.reason}` as MessageKey) : "")

function label(row: CutRow): string {
  if (row.state === "used") return t("timeline.row.used")
  return t(row.state === "cut" ? "timeline.row.cut" : "timeline.row.kept", { reason: reasonText(row) })
}

export interface SpeechTabProps {
  folder: string
  cut: BeatCut
  /** a decision is being saved; the buttons wait for it */
  busy: boolean
  onToggle: (videoId: string, change: CutDecisionChange) => void
}

function Row({ folder, cut, row, busy, playing, onPlay, onToggle }: SpeechTabProps & { row: CutRow; playing: boolean; onPlay: () => void }) {
  return (
    <li className={`speech-row ${row.state}`}>
      <div className="speech-line">
        <span className="pill">{label(row)}</span>
        <span className="hint mono">{`${formatTimestamp(row.startUs)}–${formatTimestamp(row.endUs)}`}</span>
        {row.text && <q>{row.text}</q>}
        <span className="speech-actions">
          <Button size="xs" aria-label={t("timeline.play")} aria-pressed={playing} onClick={onPlay}>
            ▶
          </Button>
          <Button size="xs" disabled={busy || !row.toggle} onClick={() => row.toggle && onToggle(cut.videoId, row.toggle)}>
            {t(row.state === "cut" ? "timeline.action.keep" : "timeline.action.cut")}
          </Button>
        </span>
      </div>
      {playing && (
        <div className="speech-player">
          <ScenePlayer src={mediaUrl(folder, cut.videoId)} startUs={Math.max(0, row.startUs - CONTEXT_US)} endUs={row.endUs + CONTEXT_US} />
        </div>
      )}
    </li>
  )
}

/** What the beat says, and what was left out of it: kept or cut, and played. Pauses fold away. */
export function SpeechTab(props: SpeechTabProps) {
  const { cut } = props
  const [playing, setPlaying] = useState<string | null>(null)
  const [pausesOpen, setPausesOpen] = useState(false)
  const keyOf = (row: CutRow) => `${row.state}-${row.reason}-${row.startUs}`
  const item = (row: CutRow) => (
    <Row key={keyOf(row)} {...props} row={row} playing={playing === keyOf(row)} onPlay={() => setPlaying((current) => (current === keyOf(row) ? null : keyOf(row)))} />
  )

  const pauses = cut.rows.filter((row) => row.reason === "pause")
  const cutPauses = pauses.filter((row) => row.state === "cut")
  const keptPauses = pauses.filter((row) => row.state === "kept")
  const summary = t("timeline.pauses", {
    count: cutPauses.length,
    seconds: (cutPauses.reduce((sum, row) => sum + row.endUs - row.startUs, 0) / 1_000_000).toFixed(1),
  })

  return (
    <div className="speech">
      {cut.notes.map((note) => (
        <p key={note} className="notice warn-text">
          {t(`timeline.note.${note}` as MessageKey)}
        </p>
      ))}
      <ul className="speech-rows">{cut.rows.filter((row) => row.reason !== "pause").map(item)}</ul>
      {pauses.length > 0 && (
        <div className="pause-fold">
          <Button variant="ghost" size="sm" aria-expanded={pausesOpen} aria-label={summary} onClick={() => setPausesOpen(!pausesOpen)}>
            <span>{summary}</span>
            {keptPauses.length > 0 && <span className="hint">· {t("timeline.pausesKept", { count: keptPauses.length })}</span>}
            <span aria-hidden>{pausesOpen ? "▾" : "▸"}</span>
          </Button>
          {pausesOpen && <ul className="speech-rows">{pauses.map(item)}</ul>}
        </div>
      )}
    </div>
  )
}
