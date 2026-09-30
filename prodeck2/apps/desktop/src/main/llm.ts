import { effortFor, type LlmTransport } from "@boxblack/core/llm"
import { defaultTransports, type TransportFactories } from "./analysis.ts"
import type { SecretStore, SettingsStore } from "./settings.ts"

export interface LlmChoiceDeps {
  settings: SettingsStore
  secrets: SecretStore
  tools: { claude: string | null }
  transports?: TransportFactories
}

/** The Claude connection and model the user chose in settings. `task` names the work in the error when it cannot start. */
export async function chosenLlm(deps: LlmChoiceDeps, task: string): Promise<{ transport: LlmTransport; model: string }> {
  const transports = deps.transports ?? defaultTransports
  const { llm } = await deps.settings.read()
  if (llm.transport === "anthropic-api") {
    const key = await deps.secrets.get("anthropic")
    if (!key) throw new Error(`${task} is not ready: anthropic-key-missing`)
    return { transport: transports.anthropic(key, effortFor(llm.model, llm.effort)), model: llm.model }
  }
  if (!deps.tools.claude) throw new Error(`${task} is not ready: claude-cli-missing`)
  return { transport: transports.cli(deps.tools.claude, effortFor(llm.model, llm.effort)), model: llm.model }
}
