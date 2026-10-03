import type { DesktopApi } from "../shared/api.ts"
import type { AgentService } from "./agent.ts"
import type { AgentWiring } from "./agent-wiring.ts"
import type { TimelineService } from "./timeline.ts"

type AgentApi = Pick<DesktopApi, "agentOpen" | "agentSend" | "agentStop" | "agentReset" | "agentLock" | "agentRemove" | "agentWrite">

export function createAgentApi(deps: { agent: AgentService; wiring: AgentWiring; timeline: Pick<TimelineService, "writeTimeline"> }): AgentApi {
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
    async agentWrite(folder, expectedSegments) {
      if (!Number.isInteger(expectedSegments) || expectedSegments < 0) throw new Error("bad segment count")
      return deps.timeline.writeTimeline(folder, await agent.timeline(folder), expectedSegments)
    },
  }
}
