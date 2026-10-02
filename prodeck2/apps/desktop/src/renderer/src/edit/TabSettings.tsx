import { CUT_PRESET_IDS } from "@boxblack/core/cut/rules"
import { FLAIR_LEVELS } from "@boxblack/core/flair/catalogue"
import { hexOf, rgbOf } from "@boxblack/core/highlights/colour"
import { HIGHLIGHT_POSITIONS, HIGHLIGHT_STYLE_IDS, styleFor, type Palette } from "@boxblack/core/highlights/styles"
import { SUBTITLE_LENGTHS } from "@boxblack/core/subtitles/captions"
import type { CutPreset, CutPresetId, CutRules, FlairLevel, HighlightOptions, HighlightStyleId, SubtitleOptions } from "../../../shared/api.ts"
import { t, type MessageKey } from "../i18n.ts"
import { Field } from "../ui/Field.tsx"
import { Group } from "../ui/Group.tsx"
import { Segmented } from "../ui/Segmented.tsx"
import { Select } from "../ui/Select.tsx"
import { Switch } from "../ui/Switch.tsx"

const RULE_TOGGLES = ["cutFillers", "cutRetakes", "cutBadPicture"] as const
const PALETTE_ROLES = ["text", "accent", "alt", "bar"] as const satisfies readonly (keyof Palette)[]

/** The four colours of a palette, as dots the eye can compare, since the app has no preview. */
function Swatches({ palette }: { palette: Palette }) {
  return (
    <div className="swatches">
      {PALETTE_ROLES.map((role) => {
        const hex = hexOf(palette[role])
        return <span key={role} className="swatch" role="img" aria-label={`${t(`highlights.swatch.${role}` as MessageKey)} ${hex}`} title={hex} style={{ background: hex }} />
      })}
    </div>
  )
}

/** The cut rules, at the head of the cut tab. Like every setting on this page they are the app's, for every project. */
export function RulesSettings({ rules, presets, onRules, disabled }: { rules: CutRules; presets: Record<CutPresetId, CutPreset>; onRules: (rules: CutRules) => void; disabled: boolean }) {
  return (
    <div className="tab-settings">
      <Group label={t("timeline.rulesTitle")} hint={t(`timeline.preset.${rules.preset}Hint` as MessageKey, { pause: String(presets[rules.preset].maxPauseUs / 1_000_000) })}>
        <Segmented
          label={t("timeline.rulesTitle")}
          value={rules.preset}
          options={CUT_PRESET_IDS.map((preset) => ({ value: preset, label: t(`timeline.preset.${preset}` as MessageKey) }))}
          disabled={disabled}
          onChange={(preset) => onRules({ ...rules, preset: preset as CutPresetId })}
        />
      </Group>
      {RULE_TOGGLES.map((rule) => (
        <Switch key={rule} label={t(`timeline.${rule}` as MessageKey)} checked={rules[rule]} disabled={disabled} onChange={(checked) => onRules({ ...rules, [rule]: checked })} />
      ))}
    </div>
  )
}

/** Where the highlight text sits and in which style and colours, at the head of its part of the techniques tab. */
export function HighlightSettings({ highlights, onHighlights, style, onStyle, notices, disabled }: {
  highlights: HighlightOptions
  onHighlights: (options: HighlightOptions) => void
  /** the style in force and the one Claude chose */
  style: { value: HighlightStyleId; byAi: HighlightStyleId | null }
  onStyle: (style: HighlightStyleId) => void
  /**
   * `hidden`: groups the cut hides though they would show; `pointsHidden`: points the cut hides, whose
   * Claude's text is hidden with them and counted there, not among the groups
   */
  notices: { outlineChanged: boolean; needsPictures: boolean; hidden: number; pointsHidden: number }
  disabled: boolean
}) {
  return (
    <div className="tab-settings">
      <Group label={t("highlights.position")}>
        <Segmented
          label={t("highlights.position")}
          value={highlights.position}
          options={HIGHLIGHT_POSITIONS.map((position) => ({ value: position, label: t(`highlights.position.${position}` as MessageKey) }))}
          disabled={disabled}
          onChange={(position) => onHighlights({ ...highlights, position: position as HighlightOptions["position"] })}
        />
      </Group>
      <Field label={t("highlights.style")}>
        <Select label={t("highlights.style")} value={style.value} disabled={disabled} onChange={(value) => onStyle(value as HighlightStyleId)}>
          {HIGHLIGHT_STYLE_IDS.map((id) => {
            const name = styleFor(id, highlights.custom).name
            return (
              <option key={id} value={id}>
                {id === style.byAi ? t("highlights.styleByAi", { name }) : name}
              </option>
            )
          })}
        </Select>
      </Field>
      {style.value === "custom" ? (
        <div className="field">
          <div className="colour-inputs">
            {PALETTE_ROLES.map((role) => (
              <label key={role} className="colour-input">
                <span>{t(`highlights.swatch.${role}` as MessageKey)}</span>
                <input
                  type="color"
                  value={hexOf(highlights.custom[role])}
                  disabled={disabled}
                  onChange={(event) => {
                    const colour = rgbOf(event.target.value)
                    if (colour) onHighlights({ ...highlights, custom: { ...highlights.custom, [role]: colour } })
                  }}
                />
              </label>
            ))}
          </div>
          <span className="hint">{t("highlights.customHint")}</span>
        </div>
      ) : (
        <Swatches palette={styleFor(style.value, highlights.custom).palette} />
      )}
      {notices.outlineChanged && <p className="notice warn-text">{t("highlights.outlineChanged")}</p>}
      {notices.needsPictures && <p className="notice warn-text">{t("highlights.needsPictures")}</p>}
      {notices.hidden > 0 && <p className="hint">{t("highlights.hidden", { count: notices.hidden })}</p>}
      {notices.pointsHidden > 0 && <p className="hint">{t("emphasis.hidden", { count: notices.pointsHidden })}</p>}
    </div>
  )
}

/** Subtitles on or off, their length, the polish, and whether they keep out from under the highlight text. */
export function SubtitleSettings({ subtitles, onSubtitles, highlightsOn, hideSubtitles, onHideSubtitles, disabled }: {
  subtitles: SubtitleOptions
  onSubtitles: (options: SubtitleOptions) => void
  highlightsOn: boolean
  hideSubtitles: boolean
  onHideSubtitles: (hide: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="tab-settings">
      <Switch label={t("subtitles.enabled")} checked={subtitles.enabled} disabled={disabled} onChange={(enabled) => onSubtitles({ ...subtitles, enabled })} />
      {subtitles.enabled && (
        <>
          <Group label={t("subtitles.title")} hint={t(`subtitles.length.${subtitles.length}Hint` as MessageKey)}>
            <Segmented
              label={t("subtitles.title")}
              value={subtitles.length}
              options={SUBTITLE_LENGTHS.map((length) => ({ value: length, label: t(`subtitles.length.${length}` as MessageKey) }))}
              disabled={disabled}
              onChange={(length) => onSubtitles({ ...subtitles, length: length as SubtitleOptions["length"] })}
            />
          </Group>
          <Switch label={t("subtitles.polish")} checked={subtitles.polish} disabled={disabled} onChange={(polish) => onSubtitles({ ...subtitles, polish })} />
          {highlightsOn && <Switch label={t("highlights.hideSubtitles")} checked={hideSubtitles} disabled={disabled} onChange={onHideSubtitles} />}
        </>
      )}
    </div>
  )
}

/** How loud the clip is: which importances get effects (spec §4.3). */
export function LevelControl({ level, onLevel, disabled }: { level: FlairLevel; onLevel: (level: FlairLevel) => void; disabled: boolean }) {
  return (
    <Group label={t("flair.level")} hint={t(`flair.level.${level}Hint` as MessageKey)}>
      <Segmented
        label={t("flair.level")}
        value={level}
        options={FLAIR_LEVELS.map((value) => ({ value, label: t(`flair.level.${value}` as MessageKey) }))}
        disabled={disabled}
        onChange={(next) => onLevel(next as FlairLevel)}
      />
    </Group>
  )
}
