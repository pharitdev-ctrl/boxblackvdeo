import type { DesktopApi } from "../shared/api.ts"
import type { AgentService } from "./agent.ts"
import type { AgentWiring } from "./agent-wiring.ts"
import type { PreviewVideoMaker } from "./preview-video.ts"
import type { TimelineService } from "./timeline.ts"

type AgentApi = Pick<DesktopApi, "agentOpen" | "agentSend" | "agentStop" | "agentReset" | "agentLock" | "agentRemove" | "agentWrite" | "agentLook" | "agentPreview">

export function createAgentApi(deps: { agent: AgentService; wiring: AgentWiring; timeline: Pick<TimelineService, "writeTimeline">; previews?: Pick<PreviewVideoMaker, "make"> }): AgentApi {
  const { agent, wiring } = deps
  return {
    async agentOpen(folder, request) {
      const start = wiring.remember(folder, request)
      await wiring.loadSounds(folder)
      return agent.open(folder, start)
    },
    agentSend: (folder, text) => agent.send(folder, text),
    async agentStop(folder) {
      agent.stop(folder)
    },
    async agentReset(folder, request) {
      const start = wiring.remember(folder, request)
      await wiring.loadSounds(folder)
      return agent.reset(folder, start)
    },
    agentLock: (folder, id, locked) => agent.lock(folder, id, locked === true),
    agentRemove: (folder, id) => agent.remove(folder, id),
    agentLook: async (folder) => agent.lastLook(folder),
    async agentPreview(folder) {
      if (!deps.previews) throw new Error("ffmpeg-missing")
      return deps.previews.make(folder, await agent.timeline(folder))
    },
    async agentWrite(folder, expectedSegments) {
      if (!Number.isInteger(expectedSegments) || expectedSegments < 0) throw new Error("bad segment count")
      return deps.timeline.writeTimeline(folder, await agent.timeline(folder), expectedSegments)
    },
  }
}
