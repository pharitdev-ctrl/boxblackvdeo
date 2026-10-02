import { useContext, useMemo, useState, type ReactElement } from "react"
import { createPortal } from "react-dom"
import { AiMenu, type AiItem } from "../edit/AiMenu.tsx"
import { BeatPanel } from "../edit/BeatPanel.tsx"
import { BeatSidebar, type BeatCounts, type SidebarBeat } from "../edit/BeatSidebar.tsx"
import { byBeat, emptyFlair, wholeClip, type BeatFlair } from "../edit/byBeat.ts"
import { EmphasisTab } from "../edit/EmphasisTab.tsx"
import { GraphicTab } from "../edit/GraphicTab.tsx"
import { PlanStrip } from "../edit/PlanStrip.tsx"
import { tabRuns, type PostTab } from "../edit/postTabs.ts"
import { SoundTab } from "../edit/SoundTab.tsx"
import { SpeechTab } from "../edit/SpeechTab.tsx"
import { SubtitleTab } from "../edit/SubtitleTab.tsx"
import { TechniquesTab } from "../edit/TechniquesTab.tsx"
import { RulesSettings, SubtitleSettings } from "../edit/TabSettings.tsx"
import { FailedReads, WriteButton, WriteReason } from "../edit/WriteButton.tsx"
import { t } from "../i18n.ts"
import { useClipRoom } from "../room/ClipRoom.tsx"
import { ToolbarSlot } from "../shell/AppShell.tsx"
import { Button } from "../ui/Button.tsx"

export interface PostScreenProps {
  /** back to the outline stage, to change the beats themselves */
  onEditOutline: () => void
}

/** Nothing carried: for a beat the preview has nothing for yet. Never filled, so one does for every beat. */
const NOTHING = emptyFlair()

/** Every word of [from, to), by its number in the transcript. */
const wordRange = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, index) => from + index)

/**
 * The post-production page: the whole clip and the beats on the left, six tabs on the right, and on
 * the app's bar the AI menu (whose first item runs the whole plan) and the write button. It
 * holds only what it shows, the beat and the tab; everything else is the room's.
 */
export function PostScreen({ onEditOutline }: PostScreenProps): ReactElement {
  const room = useClipRoom()
  const { api, folder, stored, plan, preview, lines, texts, rules, presets, subtitles, highlights, flair, run, writing } = room
  const { highlightsOn, subtitlesOn, graphicsOn, empty } = room
  // the box on the app's bar for this page's buttons; the bar is outside the room, so the page draws them there
  const slot = useContext(ToolbarSlot)
  // undefined: nothing chosen yet, which opens the first beat; null: the whole clip
  const [selectedBeat, setSelectedBeat] = useState<string | null | undefined>(undefined)
  const [tab, setTab] = useState<PostTab>("cut")

  const cutawaysOn = flair?.insert === true
  // the write took the rules, texts and flair as they were when it started: nothing changes meanwhile
  const busy = room.deciding || room.editing || writing
  const emphasis = preview?.emphasis ?? null

  const beatsById = new Map(stored.outline.beats.map((beat) => [beat.id, beat]))
  // sorted once for each preview and cut, not on every render (a keystroke in a reason, a tab opened)
  const flairByBeat = useMemo(() => (preview && plan ? byBeat(preview, plan) : new Map<string, BeatFlair>()), [preview, plan])
  const clipFlair = useMemo(() => (preview ? wholeClip(preview) : NOTHING), [preview])
  const linesByBeat = useMemo(() => {
    const counted = new Map<string, number>()
    for (const line of lines ?? []) counted.set(line.beatId, (counted.get(line.beatId) ?? 0) + 1)
    return counted
  }, [lines])
  const linesIn = (beatId: string | null) => (beatId === null ? (lines?.length ?? 0) : (linesByBeat.get(beatId) ?? 0))
  // a graphic plays only while graphics are on, and a subtitle only while subtitles are; the preview may still hold the last graphics
  const countsOf = (carried: BeatFlair, beatId: string | null): BeatCounts => ({
    ...carried.counts,
    graphic: graphicsOn ? carried.counts.graphic : 0,
    subtitles: subtitlesOn ? linesIn(beatId) : 0,
  })
  const beats: SidebarBeat[] = (plan?.beats ?? []).map((cut) => ({
    beatId: cut.beatId,
    name: beatsById.get(cut.beatId)?.name ?? cut.beatId,
    videoName: beatsById.get(cut.beatId)?.videoName ?? cut.videoId,
    originalUs: cut.originalUs,
    keptUs: cut.keptUs,
    counts: countsOf(flairByBeat.get(cut.beatId) ?? NOTHING, cut.beatId),
  }))
  const chosen = selectedBeat === null ? null : (beats.find((beat) => beat.beatId === selectedBeat) ?? beats[0] ?? null)
  const chosenCut = plan?.beats.find((cut) => cut.beatId === chosen?.beatId) ?? null
  const shown = chosen ? (flairByBeat.get(chosen.beatId) ?? NOTHING) : clipFlair
  const shownCounts = chosen ? chosen.counts : countsOf(clipFlair, null)
  const inView = <T extends { beatId: string }>(items: T[]): T[] => (chosen ? items.filter((item) => item.beatId === chosen.beatId) : items)
  const summary = {
    durationUs: plan?.durationUs ?? 0,
    targetUs: stored.brief.targetSeconds === null ? null : stored.brief.targetSeconds * 1_000_000,
    pieces: plan?.cuts.length ?? 0,
  }
  const runs = tabRuns(run)
  // what the last run of the points could not use of them; a rethink of another work keeps that state
  const pointsRun = run.states.emphasis
  const droppedPoints = pointsRun?.state === "done" ? pointsRun.dropped : 0

  // what stops an AI item: a write that took everything already, a run going, or settings not read yet
  const aiBlocked = writing ? t("edit.ai.writing") : run.running ? t("post.planRunning") : preview === null || room.request() === null ? t("edit.busy") : undefined
  // works 2 and 4 stand on the points: with none placed there is nothing to plan them on
  const needsPoints = (emphasis?.points.length ?? 0) === 0 ? t("post.ai.planFirstHere") : undefined
  const items: AiItem[] = [
    // the whole plan places the points itself, so it never waits for them; a cut that keeps nothing leaves it nothing to plan
    {
      id: "all",
      label: `✦ ${t("post.planAll")}`,
      hint: t("post.planHint"),
      lead: true,
      disabled: aiBlocked ?? (empty ? t("timeline.empty") : undefined),
      onRun: () => void room.planPost(),
    },
    { id: "emphasis", label: t("post.ai.rethink.emphasis"), disabled: aiBlocked, onRun: () => void room.rethink("emphasis") },
    { id: "techniques", label: t("post.ai.rethink.techniques"), disabled: aiBlocked ?? needsPoints, onRun: () => void room.rethink("techniques") },
    { id: "graphics", label: t("post.ai.rethink.graphics"), disabled: aiBlocked ?? needsPoints, onRun: () => void room.rethink("graphics") },
    { id: "sounds", label: t("post.ai.rethink.sounds"), disabled: aiBlocked ?? needsPoints, onRun: () => void room.rethink("sounds") },
    { id: "subtitles", label: t("post.ai.rethink.subtitles"), disabled: aiBlocked, onRun: () => void room.rethink("subtitles") },
  ]

  return (
    // busy while the text is being placed again after a change, and while a write runs
    <section className="screen edit" aria-busy={room.placing || writing}>
      <div className="edit-room">
        <BeatSidebar
          beats={beats}
          selected={chosen?.beatId ?? null}
          onSelect={setSelectedBeat}
          tab={tab}
          wholeClip={{ counts: countsOf(clipFlair, null) }}
          summary={summary}
          onEditOutline={onEditOutline}
          writing={writing}
          planning={run.running}
        />

        <div className="edit-main">
          {/* first, so a read that failed is the first thing said (and announced); what the write waits for, the button on the bar says */}
          <FailedReads />
          {room.error && <p className="notice error">{t("error.generic", { message: room.error })}</p>}
          {!plan && !room.error && <p className="hint">{t("timeline.previewing")}</p>}
          {empty && <p className="notice warn-text">{t("timeline.empty")}</p>}

          {/* the panel stays while the cut is worked out again (new rules empty the plan until it lands) or fails
              to be, so the rules at the head of the cut tab can always be changed */}
          <BeatPanel
            beat={
              chosen && chosenCut
                ? { name: chosen.name, number: beats.indexOf(chosen) + 1, videoName: chosen.videoName, originalUs: chosen.originalUs, keptUs: chosen.keptUs, pieces: chosenCut.pieces.length }
                : null
            }
            wholeClip={summary}
            tab={tab}
            onTab={setTab}
            counts={{
              emphasis: shownCounts.emphasis,
              techniques: shownCounts.text + shownCounts.zoom + shownCounts.insert,
              graphics: shownCounts.graphic,
              sound: shownCounts.sound,
              ...(subtitlesOn ? { subtitles: shownCounts.subtitles } : {}),
            }}
            runs={runs}
            busy={busy}
            strip={<PlanStrip run={run} current={room.runWorks} />}
          >
            {tab === "cut" && (
              <>
                {/* first, and outside the plan's gate, so the same controls stay mounted while the plan is worked out again */}
                {rules && <RulesSettings rules={rules} presets={presets} onRules={room.changeRules} disabled={writing} />}
                {plan && (
                  <>
                    {(chosenCut ? [chosenCut] : plan.beats).map((cut) => (
                      <div key={cut.beatId} className="cut-beat">
                        {!chosenCut && <p className="tab-section">{`${beats.findIndex((beat) => beat.beatId === cut.beatId) + 1} · ${beatsById.get(cut.beatId)?.name ?? cut.beatId}`}</p>}
                        <SpeechTab folder={folder} cut={cut} busy={busy} onToggle={(videoId, change) => void room.decide(videoId, change)} />
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
            {tab === "emphasis" &&
              (preview && emphasis && flair ? (
                <EmphasisTab
                  // words picked, or a move begun, belong to the beat they were picked in: another beat starts clean
                  key={chosen?.beatId ?? "whole"}
                  // the beat a point belongs to is the one byBeat puts it in, as for everything else
                  points={shown.points}
                  sentences={inView(emphasis.sentences)}
                  scenes={inView(emphasis.scenes)}
                  hidden={emphasis.hidden}
                  dropped={droppedPoints}
                  busy={busy || room.placing}
                  writing={writing}
                  onChange={(id, patch) => room.changeHighlightText(() => api.setEmphasisPoint(folder, id, patch))}
                  onAdd={(anchor) => room.changeHighlightText(() => api.addEmphasisPoint(folder, anchor))}
                  // made for the point, the text follows the point's level
                  onText={
                    highlightsOn
                      ? (point) => {
                          const anchor = point.anchor
                          if (anchor.kind === "speech")
                            void room.changeHighlightText(() => api.addHighlightGroup(folder, anchor.videoId, wordRange(anchor.from, anchor.to), preview.maxChars, anchor.beatId, point.id))
                        }
                      : undefined
                  }
                  media={cutawaysOn ? preview.media : undefined}
                  // the point's own cutaway is the one bound to it: main puts it there, and keeps it bound when it is changed
                  chosenPicture={(point) => preview.inserts.find((insert) => insert.pointId === point.id)?.binId}
                  onPicture={
                    cutawaysOn && rules
                      ? (point, binId) => void room.changeHighlightText(() => api.setPointPicture(folder, rules, point.id, binId))
                      : undefined
                  }
                />
              ) : (
                <p className="hint">{t("edit.busy")}</p>
              ))}
            {tab === "techniques" &&
              (preview ? <TechniquesTab flair={shown} beatId={chosen?.beatId ?? null} points={emphasis?.points ?? []} busy={busy || room.placing} /> : <p className="hint">{t("edit.busy")}</p>)}
            {tab === "graphics" &&
              (preview ? <GraphicTab flair={shown} beatId={chosen?.beatId ?? null} points={emphasis?.points ?? []} busy={busy || room.placing} /> : <p className="hint">{t("edit.busy")}</p>)}
            {tab === "sound" && (preview ? <SoundTab flair={shown} beatId={chosen?.beatId ?? null} points={emphasis?.points ?? []} busy={busy || room.placing} /> : <p className="hint">{t("edit.busy")}</p>)}
            {tab === "subtitles" && subtitles && highlights && (
              <>
                <SubtitleSettings
                  subtitles={subtitles}
                  onSubtitles={room.changeSubtitles}
                  highlightsOn={highlightsOn}
                  hideSubtitles={highlights.hideSubtitles}
                  onHideSubtitles={(hideSubtitles) => room.changeHighlights({ ...highlights, hideSubtitles })}
                  disabled={writing}
                />
                {subtitlesOn &&
                  (lines ? <SubtitleTab lines={lines} texts={texts} beatId={chosen?.beatId ?? null} onEdit={room.editSubtitle} writing={writing} /> : <p className="hint">{t("subtitles.loading")}</p>)}
              </>
            )}
          </BeatPanel>
        </div>
      </div>

      {/* the AI menu and the write button belong on the app's bar, which sits outside the room: drawn there from in here, they read the same room.
          The reason the write is held goes first, so that it comes and goes without moving the buttons after it */}
      {slot &&
        createPortal(
          <>
            <WriteReason />
            <AiMenu
              items={items}
              running={run.running ? t("post.planRunning") : null}
              onStop={() => void api.cancelAi()}
              // the level heads the menu once the settings are read; like every setting it is shut only while a write runs
              level={flair ? { value: flair.level, onChange: (level) => room.changeFlair({ ...flair, level }), disabled: writing } : undefined}
            />
            <WriteButton />
          </>,
          slot,
        )}
    </section>
  )
}
