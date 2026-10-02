import type { EmphasisPointView } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { useClipRoom } from "../room/ClipRoom.tsx"
import { Switch } from "../ui/Switch.tsx"
import type { BeatFlair } from "./byBeat.ts"
import { ComposedList } from "./ComposedList.tsx"
import { EmphasisBanner } from "./EmphasisBanner.tsx"
import { cueKey } from "./FlairTab.tsx"

export interface SoundTabProps {
  /** what the open beat, or the whole clip, carries */
  flair: BeatFlair
  /** the open beat, or null for the whole clip: an edit field opened in one is not open in another */
  beatId: string | null
  /** every point on the cut, to say which one each sound was made for */
  points: EmphasisPointView[]
  /** a change of the user's is being saved or placed, or a write runs: the controls wait */
  busy: boolean
}

/** Work 4: the sound switch, the sounds Claude composed, each saying what it follows, and the user's own CapCut sounds. */
export function SoundTab({ flair: beat, beatId, points, busy }: SoundTabProps) {
  const room = useClipRoom()
  const { preview, flair, writing } = room
  if (!preview || !flair) return null
  // the user's own sounds are listed by the beat their CapCut sound plays in, which the preview's cues say
  const here = new Set(beat.cues.map((cue) => cueKey(cue.anchor)))

  return (
    <div className="sound-tab">
      <div className="tab-settings">
        <Switch label={t("flair.sound")} checked={flair.sound} disabled={writing} onChange={(sound) => room.changeFlair({ ...flair, sound })} />
      </div>
      {/* while a run goes it is doing what the banner would ask for */}
      {preview.emphasis.changed.sounds && !room.run.running && <EmphasisBanner busy={writing} onRethink={() => void room.rethink("sounds")} />}
      {flair.sound && (
        <ComposedList
          // a field opened in one beat belongs to it, as in the graphics tab: another beat starts clean
          key={beatId ?? "whole"}
          flair={beat}
          points={points}
          own={preview.ownSounds.filter((sound) => here.has(cueKey(sound.anchor)))}
          unused={preview.unusedSounds}
          problem={preview.soundsProblem}
          planning={room.run.running}
          // a sound tied to a graphic has the graphic's place: only a sound's mark is this list's to show
          rewriting={room.rewriting?.of === "sound" ? room.rewriting : null}
          busy={busy}
          onRedo={(anchor) => void room.redoSound(anchor)}
          onEdit={(anchor, instruction) => void room.editSound(anchor, instruction)}
          // these three, and the own sound taken off, are not changeHighlightText: that places everything again, holding
          // the page up, where these change the sounds alone
          onUndo={(anchor) => void room.undoSound(anchor)}
          onSet={(anchor, patch) => void room.setSound(anchor, patch)}
          onRemoveOwn={(anchor) => void room.removeOwnSound(anchor)}
        />
      )}
    </div>
  )
}
