import { t } from "../i18n.ts"

/** The three stages of the work, in order; the write button is on the last one's bar. */
export type Stage = "prepare" | "outline" | "post"

export const STAGES: Stage[] = ["prepare", "outline", "post"]

const LABELS: Record<Stage, "stage.prepare" | "stage.outline" | "stage.post"> = {
  prepare: "stage.prepare",
  outline: "stage.outline",
  post: "stage.post",
}

export interface StageChipsProps {
  /** null while no project is open: the chips have nothing to point at */
  stage: Stage | null
  /** a stage the user has the inputs for, and may go back to */
  reachable: Record<Stage, boolean>
  /** why a stage the user has been through cannot be gone back to just now */
  shut?: Partial<Record<Stage, string>>
  onStage: (stage: Stage) => void
}

/** Where the user is in the work, and the way back to a stage already passed. */
export function StageChips({ stage, reachable, shut = {}, onStage }: StageChipsProps) {
  if (stage === null) return null
  const at = STAGES.indexOf(stage)
  return (
    <nav className="stages" aria-label={t("stages.label")}>
      {STAGES.map((entry, index) => (
        <button
          key={entry}
          type="button"
          className={entry === stage ? "stage now" : index < at ? "stage done" : "stage"}
          aria-current={entry === stage ? "step" : undefined}
          disabled={!reachable[entry] || shut[entry] !== undefined}
          title={shut[entry]}
          onClick={() => onStage(entry)}
        >
          <span className="stage-number" aria-hidden>
            {index < at ? "✓" : index + 1}
          </span>
          <span className="stage-name">{t(LABELS[entry])}</span>
        </button>
      ))}
    </nav>
  )
}
