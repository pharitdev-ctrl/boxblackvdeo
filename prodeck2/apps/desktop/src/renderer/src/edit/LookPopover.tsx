import { patternsFor } from "@boxblack/core/flair/catalogue"
import { TONES, type Tone } from "@boxblack/core/flair/plan"
import type { FlairLookPatch, HighlightGroupView, HighlightPreview, TextPattern } from "../../../shared/api.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Field } from "../ui/Field.tsx"
import { Group } from "../ui/Group.tsx"
import { Popover } from "../ui/Popover.tsx"
import { Segmented } from "../ui/Segmented.tsx"
import { Select } from "../ui/Select.tsx"

/** The words of a line the accent can fall on; CapCut colours whole words, not letters. */
const wordsOf = (text: string): string[] => [...new Set(text.split(/\s+/).filter((word) => word.length > 0))]

export interface LookPopoverProps {
  open: boolean
  onClose: () => void
  group: HighlightGroupView
  /** wide output: the patterns that only work on portrait are not offered */
  landscape: boolean
  busy: boolean
  /** the exit animations the user may have (the preview's list) */
  exits: HighlightPreview["exits"]
  onLook: (groupId: string, patch: FlairLookPatch) => void
}

/** How one group of highlight text looks: its layout, its colour, its coloured word, and how it leaves. */
export function LookPopover({ open, onClose, group, landscape, busy, exits, onLook }: LookPopoverProps) {
  const accent = group.look.accent
  // an exit held for want of CapCut Pro is kept when the rest of the look changes, so turning Pro on brings it back
  const exit = group.heldExit?.id ?? group.look.exit
  // a change keeps the rest of the look as it shows now, so what is saved is what the user saw
  const change = (patch: FlairLookPatch) => onLook(group.id, { pattern: group.look.pattern, tone: group.look.tone, exit, ...patch })
  const accentValue = accent ? `${accent.line}:${[...(group.lines[accent.line]?.text ?? "")].slice(accent.from, accent.to).join("")}` : ""

  return (
    <Popover open={open} label={t("edit.look")} onClose={onClose}>
      <h3 className="popover-title">{t("edit.look")}</h3>
      <Group label={t("flair.pattern")}>
        <Segmented
          label={t("flair.pattern")}
          value={group.look.pattern}
          options={patternsFor(landscape).map((entry) => ({ value: entry.id, label: entry.name }))}
          disabled={busy}
          onChange={(pattern) => change({ pattern: pattern as TextPattern })}
        />
      </Group>
      <Group label={t("flair.tone")}>
        <Segmented
          label={t("flair.tone")}
          value={group.look.tone}
          options={TONES.map((tone) => ({ value: tone, label: t(`flair.tone.${tone}` as MessageKey) }))}
          disabled={busy}
          onChange={(tone) => change({ tone: tone as Tone })}
        />
      </Group>
      <Field label={t("flair.accent")}>
        <Select
          label={t("flair.accent")}
          value={accentValue}
          disabled={busy}
          onChange={(value) => {
            const [line, ...rest] = value.split(":")
            // the line's place on screen, and in the stored group, which differ once a line above it is cut
            change({ accent: value ? { line: Number(line), lineIndex: group.lines[Number(line)]!.index, word: rest.join(":") } : null })
          }}
        >
          <option value="">{t("flair.accent.none")}</option>
          {group.lines.flatMap((line, index) =>
            wordsOf(line.text).map((word) => (
              <option key={`${index}:${word}`} value={`${index}:${word}`}>
                {word}
              </option>
            )),
          )}
        </Select>
      </Field>
      {/* without CapCut Pro no exit is offered, since every one needs it: the line says why. A held exit keeps
          the select on, so the user can still drop it */}
      <Field label={t("flair.exit")} hint={exits.length === 0 ? t("flair.exit.allPro") : undefined}>
        <Select label={t("flair.exit")} value={exit ?? ""} disabled={busy || (exits.length === 0 && !group.heldExit)} onChange={(value) => change({ exit: value || null })}>
          <option value="">{t("flair.exit.none")}</option>
          {group.heldExit && <option value={group.heldExit.id}>{t("flair.exit.heldPro", { name: group.heldExit.name })}</option>}
          {exits.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
      {group.look.edited && <span className="hint">{t("flair.edited")}</span>}
    </Popover>
  )
}
