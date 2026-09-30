import Anthropic from "@anthropic-ai/sdk"
import { replySchema } from "./schema.ts"
import { TEXT_REPLY } from "./text-reply.ts"
import { LlmRefusalError, type Effort, type LlmContent, type LlmTransport } from "./types.ts"

/** Models that accept `fallbacks: "default"`, which re-runs a refused request on Anthropic's recommended model. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"])

function toBlock(content: LlmContent): Anthropic.Beta.BetaContentBlockParam {
  if (content.type === "text") {
    return content.cache
      ? { type: "text", text: content.text, cache_control: { type: "ephemeral" } }
      : { type: "text", text: content.text }
  }
  return { type: "image", source: { type: "base64", media_type: content.mediaType, data: content.data } }
}

/** Claude through the Anthropic API, billed to the user's own API key; with no effort, the model thinks at its own default. */
export function anthropicTransport(options: { apiKey: string; fetch?: typeof globalThis.fetch; effort?: Effort }): LlmTransport {
  const client = new Anthropic({ apiKey: options.apiKey, fetch: options.fetch })

  return {
    id: "anthropic-api",
    async generate({ model, system, content, schema, maxTokens, signal }) {
      const fallback = FALLBACK_MODELS.has(model)
      // a reply asked for as plain text is asked for with no format, and is returned below as Claude wrote it
      const plain = schema === TEXT_REPLY
      const format = plain ? {} : { format: { type: "json_schema" as const, schema: replySchema(schema) } }
      const effort = options.effort ? { effort: options.effort } : {}
      let response
      try {
        // create rather than parse: a reply cut off at max_tokens must be reported as that, not as bad JSON
        response = await client.beta.messages.create(
          {
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: content.map(toBlock) }],
            // with neither a format nor an effort there is nothing to say about the output
            ...(plain && !options.effort ? {} : { output_config: { ...format, ...effort } }),
            ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal },
        )
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error("the Anthropic API key was rejected — check it in Settings", { cause: error })
        }
        throw error
      }

      if (response.stop_reason === "refusal") {
        throw new LlmRefusalError(response.stop_details?.explanation ?? "")
      }
      if (response.stop_reason === "max_tokens") {
        throw new Error(`Claude's reply hit the token limit (${maxTokens}) before it was complete`)
      }
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
      // what is checked against the schema: the text itself when plain text was asked for, which its schema takes as it is; otherwise the JSON it holds
      let written: unknown = text
      if (!plain) {
        try {
          written = JSON.parse(text)
        } catch {
          throw new Error("Claude's reply did not match the expected format: not JSON")
        }
      }
      const parsed = schema.safeParse(written)
      if (!parsed.success) throw new Error(`Claude's reply did not match the expected format: ${parsed.error.message}`)

      const usage = response.usage
      return {
        output: parsed.data,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      }
    },
  }
}
