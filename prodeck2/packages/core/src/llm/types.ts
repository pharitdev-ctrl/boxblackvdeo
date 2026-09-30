import type { z } from "zod"

export type LlmContent =
  /** `cache` marks the end of a stable prefix worth caching across requests (Anthropic API only) */
  | { type: "text"; text: string; cache?: boolean }
  /** `data` is base64 without a data: prefix */
  | { type: "image"; mediaType: "image/jpeg" | "image/png"; data: string }

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface LlmRequest<T> {
  model: string
  system: string
  content: LlmContent[]
  /** the reply must be JSON matching this schema; it is validated before it is returned. TEXT_REPLY (text-reply.ts) asks for plain text instead */
  schema: z.ZodType<T>
  maxTokens: number
  signal?: AbortSignal
}

export interface LlmResponse<T> {
  output: T
  usage: LlmUsage
}

export type LlmTransportId = "anthropic-api" | "claude-cli"

/** One way of reaching Claude. The app offers the Anthropic API and a locally installed Claude Code. */
export interface LlmTransport {
  readonly id: LlmTransportId
  generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>>
}

export class LlmRefusalError extends Error {
  constructor(detail: string) {
    super(`Claude declined this request${detail ? `: ${detail}` : ""}`)
    this.name = "LlmRefusalError"
  }
}

/** The models the app lets the user choose between, newest first. */
export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
] as const

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]["id"]

/** How hard Claude thinks before it answers: more is slower and costs more. */
export const EFFORTS = ["low", "medium", "high"] as const
export type Effort = (typeof EFFORTS)[number]

/**
 * The models that think as hard as the user sets. Opus 5.5's API default (medium) is one level
 * below Opus 5's, and Claude Code may use another, so it is always sent; the other models keep
 * their own default.
 */
export const EFFORT_MODELS: readonly ClaudeModelId[] = ["claude-opus-5-5"]

/** How hard a model is told to think: the level set, for the models that take one; otherwise nothing, and it keeps its own default. */
export const effortFor = (model: string, effort: Effort): Effort | undefined => ((EFFORT_MODELS as readonly string[]).includes(model) ? effort : undefined)

/** A system prompt and the version that goes into cache keys, so changing the prompt invalidates old results. */
export interface SystemPrompt {
  system: string
  version: string
}
