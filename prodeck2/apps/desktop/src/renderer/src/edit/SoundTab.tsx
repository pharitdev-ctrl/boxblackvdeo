import type { EmphasisPointView } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { useClipRoom } from "../room/ClipRoom.tsx"
import { Switch } from "../ui/Switch.tsx"
import type { BeatFlair } from "./byBeat.ts"
import { EmphasisBanner } from "./EmphasisBanner.tsx"
import { SoundList } from "./FlairTab.tsx"

export interface SoundTabProps {
  /** what the open beat, or the whole clip, carries */
  flair: BeatFlair
  /** every point on the cut, to say which one each sound was made for */
  points: EmphasisPointView[]
  /** a change of the user's is being saved or placed, or a write runs: the controls wait */
  busy: boolean
}

/** Work 4: the sound switch, and a sound effect on each place, each saying which point it was made for. */
export function SoundTab({ flair: beat, points, busy }: SoundTabProps) {
  const room = useClipRoom()
  const { api, folder, preview, flair, writing } = room
  if (!preview || !flair) return null

  return (
    <div className="sound-tab">
      <div className="tab-settings">
        <Switch label={t("flair.sound")} checked={flair.sound} disabled={writing} onChange={(sound) => room.changeFlair({ ...flair, sound })} />
      </div>
      {/* while a run goes it is doing what the banner would ask for */}
      {preview.emphasis.changed.sounds && !room.run.running && <EmphasisBanner busy={writing} onRethink={() => void room.rethink("sounds")} />}
      {flair.sound && (
        <SoundList
          flair={beat}
          points={points}
          sounds={preview.sounds}
          unused={preview.unusedSounds}
          busy={busy}
          onCue={(anchor, effectId) => void room.changeHighlightText(() => api.setSoundCue(folder, anchor, effectId))}
        />
      )}
    </div>
  )
}
