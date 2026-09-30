import { createHash } from "node:crypto"
import type { RemoteConfig } from "@boxblack/core/license/protocol"
import type { SystemPrompt } from "@boxblack/core/llm/types"
import { PLANNER_PROMPT } from "@boxblack/core/planner"
import { VISION_PROMPT } from "@boxblack/core/vision"

export interface Prompts {
  vision: SystemPrompt
  planner: SystemPrompt
}

/** The version follows the text, so an edited prompt never reuses results cached under the old one. */
function override(builtIn: SystemPrompt, text: string | null): SystemPrompt {
  if (text === null) return builtIn
  return { system: text, version: `${builtIn.version}+server-${createHash("sha256").update(text).digest("hex").slice(0, 12)}` }
}

export function resolvePrompts(prompts: RemoteConfig["prompts"]): Prompts {
  return { vision: override(VISION_PROMPT, prompts.vision), planner: override(PLANNER_PROMPT, prompts.planner) }
}
