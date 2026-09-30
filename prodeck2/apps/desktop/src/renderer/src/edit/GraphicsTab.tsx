import type { EmphasisPointView } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { useClipRoom } from "../room/ClipRoom.tsx"
import { Switch } from "../ui/Switch.tsx"
import type { BeatFlair } from "./byBeat.ts"
import { EmphasisBanner } from "./EmphasisBanner.tsx"
import { TechniqueList } from "./FlairTab.tsx"
import { HighlightTab } from "./HighlightTab.tsx"
import { HighlightSettings } from "./TabSettings.tsx"

export interface GraphicsTabProps {
  /** what the open beat, or the whole clip, carries */
  flair: BeatFlair
  /** every point on the cut, to say which one each item was made for */
  points: EmphasisPointView[]
  /** a change of the user's is being saved or placed, or a write runs: the controls wait */
  busy: boolean
}

/**
 * Work 2: the switches of highlight text, its looks, zooms, cutaways and graphics; the highlight
 * text's settings; and everything these placed, each saying which point it was made for.
 */
export function GraphicsTab({ flair: beat, points, busy }: GraphicsTabProps) {
  const room = useClipRoom()
  const { api, folder, preview, highlights, flair, writing } = room
  if (!preview || !highlights || !flair) return null
  const edit = (action: () => Promise<unknown>) => void room.changeHighlightText(action)

  return (
    <div className="graphics-tab">
      <div className="tab-settings">
        <Switch label={t("highlights.enabled")} hint={t("highlights.hint")} checked={highlights.enabled} disabled={writing} onChange={(enabled) => room.changeHighlights({ ...highlights, enabled })} />
        <Switch label={t("flair.text")} checked={flair.text} disabled={writing} onChange={(text) => room.changeFlair({ ...flair, text })} />
        <Switch label={t("flair.zoom")} checked={flair.zoom} disabled={writing} onChange={(zoom) => room.changeFlair({ ...flair, zoom })} />
        {/* with no picture the cutaway section says so itself; the hint would say it twice */}
        <Switch
          label={t("flair.insert")}
          checked={flair.insert}
          disabled={writing}
          onChange={(insert) => room.changeFlair({ ...flair, insert })}
          hint={preview.media.length > 0 ? t("flair.mediaCount", { count: preview.media.length }) : undefined}
        />
        <Switch label={t("flair.graphic")} hint={t("flair.graphicHint")} checked={flair.graphic} disabled={writing} onChange={(graphic) => room.changeFlair({ ...flair, graphic })} />
      </div>
      {/* while a run goes it is doing what the banner would ask for */}
      {preview.emphasis.changed.graphics && !room.run.running && <EmphasisBanner busy={writing} onRethink={() => void room.rethink("graphics")} />}
      {highlights.enabled && (
        <>
          <p className="tab-section">{t("highlights.title")}</p>
          <HighlightSettings
            highlights={highlights}
            onHighlights={room.changeHighlights}
            style={{ value: preview.style, byAi: preview.styleByAi }}
            onStyle={(style) => edit(() => api.setHighlightStyle(folder, style))}
            notices={{ outlineChanged: preview.outlineChanged, needsPictures: preview.needsPictures, hidden: preview.hidden, pointsHidden: preview.emphasis.hidden }}
            disabled={writing}
          />
          <HighlightTab
            groups={beat.groups}
            points={points}
            busy={busy}
            onEdit={(groupId, index, text) => edit(() => api.editHighlightLine(folder, groupId, index, text))}
            onRemove={(groupId) => edit(() => api.removeHighlightGroup(folder, groupId))}
            looks={flair.text}
            landscape={preview.landscape}
            exits={preview.exits}
            onLook={(groupId, patch) => edit(() => api.setFlairLook(folder, groupId, patch))}
          />
        </>
      )}
      <TechniqueList
        flair={beat}
        points={points}
        options={flair}
        media={preview.media}
        graphicsWaitForPack={preview.graphicsWaitForPack}
        graphicsProblem={preview.graphicsProblem}
        planning={room.run.running}
        redoing={room.redoing}
        writingGraphics={room.writingGraphics}
        busy={busy}
        onInsert={(anchor, binId, fit, replacing) => edit(() => api.setInsert(folder, anchor, binId, fit, replacing))}
        onZoom={(anchor, kind) => edit(() => api.setZoom(folder, anchor, kind))}
        onGraphic={(anchor, patch) => edit(() => api.setGraphic(folder, anchor, patch))}
        onRetryGraphic={(anchor) => edit(() => api.retryGraphic(folder, anchor))}
        onRedoGraphic={(anchor) => void room.redoGraphic(anchor)}
      />
    </div>
  )
}
