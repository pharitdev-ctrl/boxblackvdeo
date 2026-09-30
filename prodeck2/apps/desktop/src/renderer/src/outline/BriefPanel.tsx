import { useState } from "react"
import { VIDEO_TYPES } from "@boxblack/core/planner/brief"
import type { Brief, VideoType } from "../../../shared/api.ts"
import { formatDate } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Button } from "../ui/Button.tsx"
import { Field } from "../ui/Field.tsx"
import { Group } from "../ui/Group.tsx"
import { Segmented } from "../ui/Segmented.tsx"
import { Select } from "../ui/Select.tsx"
import { formatTarget, parseTarget, TARGET_PRESETS } from "./target.ts"

/** The segment that opens the field for a length of the user's own. */
const CUSTOM = "custom"

const targetLabel = (seconds: number) => (seconds < 60 ? t("brief.seconds", { seconds }) : t("brief.minutes", { minutes: seconds / 60 }))
const isPreset = (seconds: number | null): seconds is number => seconds !== null && TARGET_PRESETS.includes(seconds)

export interface BriefPanelProps {
  brief: Brief
  onChange: (brief: Brief) => void
  /** there is an outline on screen: the panel offers to redo it and to correct it */
  hasOutline: boolean
  planning: boolean
  onPlan: () => void
  onRevise: (instruction: string) => void
  onCancel: () => void
  plannedAt?: { at: number; model: string }
}

/**
 * The target length: three buttons, "custom" with a field for any other length, and "none". A stored
 * length that is no button opens on custom with the field filled in. The field's text is the panel's
 * own: what is typed is used as soon as it reads as a length; text that reads as nothing (or an empty
 * field) leaves no target and shows the hint, rather than keeping a length the user has typed over;
 * and what was typed is tidied to m:ss when the field is left. Custom stays chosen while the field is
 * empty or wrong, so the choice does not jump to "none" under the user's hands — it is on while the
 * brief still holds the length it was opened with or last typed (`forSeconds`), so a length set from
 * outside (an outline read back on a button's length) closes it again.
 */
function TargetPicker({ brief, onChange, disabled }: { brief: Brief; onChange: (brief: Brief) => void; disabled: boolean }) {
  const shown = (seconds: number | null) => (seconds === null ? "" : formatTarget(seconds))
  const [custom, setCustom] = useState<{ on: boolean; text: string; forSeconds: number | null }>(() => ({
    on: brief.targetSeconds !== null && !isPreset(brief.targetSeconds),
    text: shown(brief.targetSeconds),
    forSeconds: brief.targetSeconds,
  }))
  const on = (brief.targetSeconds !== null && !isPreset(brief.targetSeconds)) || (custom.on && brief.targetSeconds === custom.forSeconds)
  // a length set from outside since the field was last typed in is shown as it is
  const text = brief.targetSeconds !== custom.forSeconds && brief.targetSeconds !== null ? shown(brief.targetSeconds) : custom.text
  const value = on ? CUSTOM : brief.targetSeconds === null ? "" : String(brief.targetSeconds)
  const invalid = on && text.trim() !== "" && parseTarget(text) === null

  const choose = (chosen: string) => {
    if (chosen === CUSTOM) {
      // the length in force stays until a new one is typed, so the field starts from it
      setCustom({ on: true, text: shown(brief.targetSeconds), forSeconds: brief.targetSeconds })
      return
    }
    setCustom({ ...custom, on: false })
    onChange({ ...brief, targetSeconds: chosen ? Number(chosen) : null })
  }

  const typed = (typedText: string) => {
    const seconds = parseTarget(typedText)
    setCustom({ on: true, text: typedText, forSeconds: seconds })
    if (seconds !== brief.targetSeconds) onChange({ ...brief, targetSeconds: seconds })
  }

  const left = () => {
    const seconds = parseTarget(text)
    if (seconds !== null) setCustom({ on: true, text: formatTarget(seconds), forSeconds: seconds })
  }

  return (
    <Group label={t("brief.target")}>
      <Segmented
        label={t("brief.target")}
        value={value}
        options={[
          ...TARGET_PRESETS.map((seconds) => ({ value: String(seconds), label: targetLabel(seconds) })),
          { value: CUSTOM, label: t("brief.targetCustom") },
          { value: "", label: t("brief.targetNone") },
        ]}
        onChange={choose}
        disabled={disabled}
      />
      {on && (
        <div className="brief-custom">
          <input
            type="text"
            inputMode="numeric"
            aria-label={t("brief.targetCustom")}
            aria-invalid={invalid || undefined}
            placeholder={t("brief.targetPlaceholder")}
            value={text}
            disabled={disabled}
            onChange={(event) => typed(event.target.value)}
            onBlur={left}
          />
          {invalid && <p className="hint invalid">{t("brief.targetInvalid")}</p>}
        </div>
      )}
    </Group>
  )
}

/** What the user asks for, and the two ways of asking again. */
export function BriefPanel({ brief, onChange, hasOutline, planning, onPlan, onRevise, onCancel, plannedAt }: BriefPanelProps) {
  const [instruction, setInstruction] = useState("")

  return (
    <aside className="brief-panel">
      <h2>{t("brief.title")}</h2>
      <p className="hint">{t("brief.hint")}</p>

      <TargetPicker brief={brief} onChange={onChange} disabled={planning} />

      <Field label={t("brief.type")}>
        <Select
          label={t("brief.type")}
          value={brief.videoType ?? ""}
          disabled={planning}
          onChange={(value) => onChange({ ...brief, videoType: (value || null) as VideoType | null })}
        >
          <option value="">{t("brief.typeNone")}</option>
          {VIDEO_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`brief.type.${type}` as MessageKey)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("brief.instructions")}>
        <textarea
          rows={3}
          placeholder={t("brief.instructionsPlaceholder")}
          value={brief.instructions}
          disabled={planning}
          onChange={(event) => onChange({ ...brief, instructions: event.target.value })}
        />
      </Field>

      {planning ? (
        <div className="brief-planning">
          <span className="hint">{t("outline.planning")}</span>
          <Button onClick={onCancel}>{t("outline.cancel")}</Button>
        </div>
      ) : (
        <Button variant={hasOutline ? "default" : "primary"} onClick={onPlan}>
          {hasOutline ? t("outline.replan") : t("brief.submit")}
        </Button>
      )}

      {hasOutline && !planning && (
        <>
          <div className="rule" />
          <form
            className="brief-revise"
            onSubmit={(event) => {
              event.preventDefault()
              const asked = instruction.trim()
              if (!asked) return
              setInstruction("")
              onRevise(asked)
            }}
          >
            <Field label={t("outline.reviseLabel")}>
              <input
                type="text"
                placeholder={t("outline.instructionPlaceholder")}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={!instruction.trim()}>
              {t("outline.revise")}
            </Button>
          </form>
        </>
      )}

      {plannedAt && <p className="hint">{t("outline.plannedAt", { time: formatDate(plannedAt.at * 1000), model: plannedAt.model })}</p>}
    </aside>
  )
}
