import type { EmphasisPointView } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { useClipRoom } from "../room/ClipRoom.tsx"
import { Switch } from "../ui/Switch.tsx"
import type { BeatFlair } from "./byBeat.ts"
import { EmphasisBanner } from "./EmphasisBanner.tsx"
import { TechniqueList } from "./FlairTab.tsx"
import { HighlightTab } from "./HighlightTab.tsx"
import { MoveList } from "./MoveList.tsx"
import { HighlightSettings } from "./TabSettings.tsx"

export interface TechniquesTabProps {
  /** what the open beat, or the whole clip, carries */
  flair: BeatFlair
  /** the open beat, or null for the whole clip: a list drawn for one starts clean in another */
  beatId: string | null
  /** every point on the cut, to say which one each item was made for */
  points: EmphasisPointView[]
  /** a change of the user's is being saved or placed, or a write runs: the controls wait */
  busy: boolean
}

/**
 * Work 2's text and techniques: the switches of highlight text, its looks, zooms and cutaways; the highlight
 * text's settings; and everything these placed, each saying which point it was made for: the highlight text, then
 * the moves of the picture with the legacy zooms, then the cutaways. The graphics have a tab of their own (GraphicTab).
 */
export function TechniquesTab({ flair: beat, beatId, points, busy }: TechniquesTabProps) {
  const room = useClipRoom()
  const { api, folder, preview, highlights, flair, writing } = room
  if (!preview || !highlights || !flair) return null
  const edit = (action: () => Promise<unknown>) => void room.changeHighlightText(action)

  return (
    <div className="techniques-tab">
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
      </div>
      {/* while a run goes it is doing what the banner would ask for */}
      {preview.emphasis.changed.techniques && !room.run.running && <EmphasisBanner busy={writing} onRethink={() => void room.rethink("techniques")} />}
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
      {flair.zoom && (
        <MoveList
          // a field opened in one beat belongs to it, as for the graphics: another beat starts clean. Its key is its own,
          // the cutaways' list beside it being keyed by the beat too
          key={`moves:${beatId ?? "whole"}`}
          flair={beat}
          points={points}
          planning={room.run.running}
          // a graphic or a sound may have a move's place: only a move's mark is the moves' to show
          rewriting={room.rewriting?.of === "move" ? room.rewriting : null}
          busy={busy}
          onRedo={(anchor) => void room.redoMove(anchor)}
          onEdit={(anchor, instruction) => void room.editMove(anchor, instruction)}
          // not edit(...): that holds the page up while it is placed again, where these ask no Claude and are read again quietly
          onUndo={(anchor) => void room.undoMove(anchor)}
          onSet={(anchor, patch) => void room.setMove(anchor, patch)}
          // a legacy zoom is taken off as the old zoom section took it off: no zoom on its piece
          onRemoveZoom={(anchor) => edit(() => api.setZoom(folder, anchor, null))}
        />
      )}
      <TechniqueList
        // a beat's list belongs to it, as words picked in the emphasis tab do: another beat starts clean
        key={beatId ?? "whole"}
        flair={beat}
        points={points}
        options={flair}
        media={preview.media}
        busy={busy}
        onInsert={(anchor, binId, fit, replacing) => edit(() => api.setInsert(folder, anchor, binId, fit, replacing))}
      />
    </div>
  )
}
