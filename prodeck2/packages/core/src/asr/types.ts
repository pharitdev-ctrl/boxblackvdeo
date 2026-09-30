/**
 * Engine-neutral transcript of one media file. All times are microseconds from the
 * start of that file — the same units and coordinates CapCut's source_timerange uses,
 * so cut decisions can be written back without conversion.
 */

export interface TimedText {
  text: string
  startUs: number
  endUs: number
}

export interface AudioEvent {
  /** e.g. "(laughter)" as the engine labelled it */
  text: string
  atUs: number
}

export type AsrEngineId = "whisper-local" | "scribe"

export interface Transcript {
  /** "none" when the file has no audio track — an empty transcript is then the right answer */
  engine: AsrEngineId | "none"
  model: string
  language: string
  /** phrases split at pauses, in spoken order */
  utterances: TimedText[]
  /** dictionary words (Thai is segmented with ICU), in spoken order */
  words: TimedText[]
  audioEvents: AudioEvent[]
}

export type SpokenLanguage = "th" | "en" | "auto"
