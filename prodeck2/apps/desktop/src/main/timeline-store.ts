import type { AgentTimeline } from "@boxblack/core/timeline"
import { ProjectFiles } from "./project-files.ts"

/** The timeline last written to a project, with when: what the agent editor starts from and reads the draft back against. */
export interface StoredTimeline {
  folder: string
  writtenAt: number
  timeline: AgentTimeline
}

/** One file per project, beside the outlines (`<userData>/timelines`). */
export class TimelineStore extends ProjectFiles<StoredTimeline> {}
