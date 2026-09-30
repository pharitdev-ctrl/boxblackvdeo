import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { beatLength, summaryText, type ClipSummary } from "./beatText.ts"
import type { PostTab } from "./postTabs.ts"

/** What a beat, or the whole clip, carries, by kind. */
export interface BeatCounts {
  text: number
  sound: number
  zoom: number
  insert: number
  graphic: number
  /** the points that pass the level */
  emphasis: number
  /** subtitle lines */
  subtitles: number
}

export interface SidebarBeat {
  beatId: string
  name: string
  videoName: string
  originalUs: number
  keptUs: number
  counts: BeatCounts
}

export interface BeatSidebarProps {
  beats: SidebarBeat[]
  /** null: the whole clip is open */
  selected: string | null
  onSelect: (beatId: string | null) => void
  /** the open tab: each beat shows only the marks of that tab */
  tab: PostTab
  wholeClip: { counts: BeatCounts }
  summary: ClipSummary
  onEditOutline: () => void
  /** a write is running: the outline it took must not change under it */
  writing: boolean
  /** Claude is planning the project: the outline it reads work by work must not change under it either */
  planning?: boolean
}

/** The marks each tab shows, in the order they sit. */
const MARKS: Record<PostTab, (keyof BeatCounts)[]> = {
  cut: [],
  emphasis: ["emphasis"],
  graphics: ["text", "zoom", "insert", "graphic"],
  sound: ["sound"],
  subtitles: ["subtitles"],
}
const SYMBOLS: Record<keyof BeatCounts, string> = { text: "Aa", sound: "🔊", zoom: "⤢", insert: "🖼", graphic: "📊", emphasis: "★", subtitles: "CC" }

/** What a beat carries of the open tab's kinds, each kind it has at least one of: a symbol to see, words to hear. */
function Marks({ counts, tab }: { counts: BeatCounts; tab: PostTab }) {
  return (
    <span className="beat-marks">
      {MARKS[tab].map(
        (kind) =>
          counts[kind] > 0 && (
            <span key={kind} className={`mark ${kind}`}>
              <span aria-hidden>{`${SYMBOLS[kind]} ${counts[kind]}`}</span>
              <span className="sr-only">{t(`post.mark.${kind}` as MessageKey, { count: counts[kind] })}</span>
            </span>
          ),
      )}
    </span>
  )
}

/** The whole clip, then the beats of the rough cut, with what each one carries for the open tab. */
export function BeatSidebar({ beats, selected, onSelect, tab, wholeClip, summary, onEditOutline, writing, planning = false }: BeatSidebarProps) {
  return (
    <nav className="beat-sidebar" aria-label={t("edit.beats")}>
      <p className="sidebar-label">{t("edit.beats")}</p>
      <ul className="beat-picks">
        <li>
          <button type="button" className={selected === null ? "beat-pick on" : "beat-pick"} aria-current={selected === null ? "true" : undefined} onClick={() => onSelect(null)}>
            <span className="beat-colour whole" aria-hidden />
            <span className="beat-pick-body">
              <span className="beat-pick-name">{t("post.wholeClip")}</span>
              <Marks counts={wholeClip.counts} tab={tab} />
            </span>
          </button>
        </li>
        {beats.map((beat, index) => (
          <li key={beat.beatId}>
            <button
              type="button"
              className={beat.beatId === selected ? "beat-pick on" : "beat-pick"}
              aria-current={beat.beatId === selected ? "true" : undefined}
              onClick={() => onSelect(beat.beatId)}
            >
              <span className="beat-colour" style={{ background: `var(--beat-${(index % 6) + 1})` }} aria-hidden />
              <span className="beat-pick-body">
                <span className="beat-pick-name">
                  {index + 1} · {beat.name}
                </span>
                <span className="hint mono">{beatLength(beat.originalUs, beat.keptUs)}</span>
                <Marks counts={beat.counts} tab={tab} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-summary">
        <span className="hint">{summaryText(summary)}</span>
        <Button variant="ghost" size="sm" disabled={writing || planning} title={writing ? t("edit.ai.writing") : planning ? t("edit.ai.planning") : undefined} onClick={onEditOutline}>
          {`‹ ${t("edit.editOutline")}`}
        </Button>
      </div>
    </nav>
  )
}
