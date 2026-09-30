import { formatDuration } from "../format.ts"
import { t } from "../i18n.ts"

/** The length of the whole cut, its target and its pieces, as the sidebar and the whole clip's head say it. */
export interface ClipSummary {
  durationUs: number
  targetUs: number | null
  pieces: number
}

const seconds = (us: number) => (us / 1_000_000).toFixed(1)

/** How long a beat was and is once cut, in seconds to the tenth. */
export const beatLength = (originalUs: number, keptUs: number): string => t("edit.beatLength", { before: seconds(originalUs), after: seconds(keptUs) })

/** The whole cut's length, against its target when the brief has one, and its pieces. */
export const summaryText = ({ durationUs, targetUs, pieces }: ClipSummary): string =>
  targetUs === null
    ? t("edit.summary", { total: formatDuration(durationUs), pieces })
    : t("edit.summaryTarget", { total: formatDuration(durationUs), target: formatDuration(targetUs), pieces })
