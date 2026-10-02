import { useId, type ReactNode } from "react"
import { t, type MessageKey } from "../i18n.ts"
import { TabPanel, Tabs } from "../ui/Tabs.tsx"
import { beatLength, summaryText, type ClipSummary } from "./beatText.ts"
import { POST_TABS, type PostTab, type TabRun } from "./postTabs.ts"

export interface BeatPanelProps {
  /** the beat open, or null for the whole clip */
  beat: { name: string; number: number; videoName: string; originalUs: number; keptUs: number; pieces: number } | null
  wholeClip: ClipSummary
  tab: PostTab
  onTab: (tab: PostTab) => void
  /** each tab's count, or undefined for none */
  counts: Partial<Record<PostTab, number>>
  runs: Record<PostTab, TabRun>
  busy: boolean
  /** what sits between the tabs and their body: the line that says how the AI's plan stands */
  strip?: ReactNode
  children: ReactNode
}

/** What is open, a beat or the whole clip, and its six tabs shown one at a time. */
export function BeatPanel({ beat, wholeClip, tab, onTab, counts, runs, busy, strip, children }: BeatPanelProps) {
  const panelId = useId()
  return (
    <div className="beat-panel">
      <div className="beat-panel-head">
        {beat ? (
          <>
            <h1>
              {beat.number} · {beat.name}
            </h1>
            <span className="hint mono">
              {beat.videoName} · {beatLength(beat.originalUs, beat.keptUs)} · {t("edit.pieces", { count: beat.pieces })}
            </span>
          </>
        ) : (
          <>
            <h1>{t("post.wholeClip")}</h1>
            <span className="hint mono">{summaryText(wholeClip)}</span>
          </>
        )}
      </div>
      <Tabs
        label={t("stage.post")}
        value={tab}
        onChange={(next) => onTab(next as PostTab)}
        panelId={panelId}
        tabs={POST_TABS.map((id) => {
          const run = runs[id]
          return {
            id,
            label: t(`post.tab.${id}` as MessageKey),
            // while a work of the tab runs its count is about to change, and a failed one says so instead
            count: run.state === "idle" ? counts[id] : undefined,
            busy: run.state === "running" ? t("post.tabBusy") : undefined,
            flag: run.state === "failed" ? t("post.tabFailed") : undefined,
          }
        })}
      />
      {strip}
      <TabPanel id={panelId} value={tab} className={busy ? "beat-panel-body busy" : "beat-panel-body"} busy={busy}>
        {children}
      </TabPanel>
    </div>
  )
}
