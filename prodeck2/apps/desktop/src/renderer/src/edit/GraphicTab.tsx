import type { EmphasisPointView } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { useClipRoom } from "../room/ClipRoom.tsx"
import { Switch } from "../ui/Switch.tsx"
import type { BeatFlair } from "./byBeat.ts"
import { EmphasisBanner } from "./EmphasisBanner.tsx"
import { GraphicList } from "./GraphicList.tsx"

export interface GraphicTabProps {
  /** what the open beat, or the whole clip, carries */
  flair: BeatFlair
  /** the open beat, or null for the whole clip: an edit field opened in one is not open in another */
  beatId: string | null
  /** every point on the cut, to say which one each graphic tells the story of */
  points: EmphasisPointView[]
  /** a change of the user's is being saved or placed, or a write runs: the controls wait */
  busy: boolean
}

/** Work 2's graphics: the graphics switch, what keeps them from rendering, and the graphics Claude planned, in the order they play. */
export function GraphicTab({ flair: beat, beatId, points, busy }: GraphicTabProps) {
  const room = useClipRoom()
  const { api, folder, preview, flair, writing } = room
  if (!preview || !flair) return null
  const edit = (action: () => Promise<unknown>) => void room.changeHighlightText(action)

  return (
    <div className="graphic-tab">
      <div className="tab-settings">
        <Switch label={t("flair.graphic")} hint={t("flair.graphicHint")} checked={flair.graphic} disabled={writing} onChange={(graphic) => room.changeFlair({ ...flair, graphic })} />
      </div>
      {/* while a run goes it is doing what the banner would ask for */}
      {preview.emphasis.changed.graphics && !room.run.running && <EmphasisBanner busy={writing} onRethink={() => void room.rethink("graphics")} />}
      {flair.graphic && (
        <>
          {/* an installed pack can still be unusable: then saying it is not installed would send the user the wrong way */}
          {preview.graphicsProblem ? (
            <p className="notice warn-text">{t("graphics.problem", { problem: preview.graphicsProblem.text })}</p>
          ) : (
            preview.graphicsWaitForPack && <p className="notice warn-text">{t("graphics.waitForPack")}</p>
          )}
          <GraphicList
            // a field opened in one beat belongs to it, as words picked in the emphasis tab do: another beat starts clean
            key={beatId ?? "whole"}
            flair={beat}
            points={points}
            planning={room.run.running}
            // a sound tied to a graphic has the graphic's place: only a graphic's mark is the graphics' to show
            rewriting={room.rewriting?.of === "graphic" ? room.rewriting : null}
            writingGraphics={room.writingGraphics}
            busy={busy}
            onGraphic={(anchor, patch) => edit(() => api.setGraphic(folder, anchor, patch))}
            onRetryGraphic={(anchor) => edit(() => api.retryGraphic(folder, anchor))}
            onRedoGraphic={(anchor) => void room.redoGraphic(anchor)}
            onEditGraphic={(anchor, instruction) => void room.editGraphic(anchor, instruction)}
            // not edit(...): that places everything again, holding the page up, where a step back changes the graphics alone
            onUndoGraphic={(anchor) => void room.undoGraphic(anchor)}
          />
        </>
      )}
    </div>
  )
}
