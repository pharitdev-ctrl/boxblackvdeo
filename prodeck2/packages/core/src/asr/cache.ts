import { MediaCache } from "../cache.ts"
import type { AsrEngineId, SpokenLanguage, Transcript } from "./types.ts"

export interface TranscriptSettings {
  engine: AsrEngineId
  model: string
  language: SpokenLanguage
}

/** Transcripts keyed by the media file and the engine settings that produced them. */
export class TranscriptCache extends MediaCache<Transcript, TranscriptSettings> {}
