// Kept free of runtime dependencies so the renderer can import it.

export const VIDEO_TYPES = ["review", "sales", "tutorial", "vlog", "travel", "other"] as const
export type VideoType = (typeof VIDEO_TYPES)[number]

/** The optional brief the user fills in before planning; every field may be left empty. */
export interface Brief {
  targetSeconds: number | null
  videoType: VideoType | null
  instructions: string
}
