import type { SubtitleLine } from "../../../shared/api.ts"
import { formatTimestamp } from "../format.ts"
import { t } from "../i18n.ts"
import { Empty } from "../ui/Empty.tsx"

export interface SubtitleTabProps {
  /** every line of the rough cut, with the index each one has among them all */
  lines: SubtitleLine[]
  texts: string[]
  /** the beat open, or null for the whole clip */
  beatId: string | null
  onEdit: (index: number, text: string) => void
  /** a write is running: the lines it took must not change under it */
  writing: boolean
}

/** The subtitles of one beat, or of the whole clip, edited in place. */
export function SubtitleTab({ lines, texts, beatId, onEdit, writing }: SubtitleTabProps) {
  const own = lines.flatMap((line, index) => (beatId === null || line.beatId === beatId ? [{ line, index }] : []))
  if (own.length === 0) return <Empty title={t("edit.subtitlesEmpty")} />

  return (
    <div className="subtitles">
      <ol className="subtitle-lines">
        {own.map(({ line, index }) => {
          const time = formatTimestamp(line.startUs)
          return (
            <li key={index}>
              <span className="hint mono">{time}</span>
              <input
                type="text"
                aria-label={t("subtitles.lineLabel", { time })}
                value={texts[index] ?? ""}
                disabled={writing}
                onChange={(event) => onEdit(index, event.target.value)}
              />
            </li>
          )
        })}
      </ol>
      <p className="hint">{t("subtitles.editHint")}</p>
    </div>
  )
}
