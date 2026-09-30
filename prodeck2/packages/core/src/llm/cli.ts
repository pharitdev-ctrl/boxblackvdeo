import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProcessError, runProcess } from "../media/process.ts"
import { replySchema } from "./schema.ts"
import { TEXT_REPLY } from "./text-reply.ts"
import type { Effort, LlmContent, LlmTransport } from "./types.ts"

interface CliResult {
  type: "result"
  is_error: boolean
  result?: string
  structured_output?: unknown
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

function toBlock(content: LlmContent) {
  return content.type === "text"
    ? { type: "text", text: content.text }
    : { type: "image", source: { type: "base64", media_type: content.mediaType, data: content.data } }
}

/**
 * Claude through a locally installed, logged-in Claude Code (`claude -p`).
 *
 * Images travel as a stream-json user message on standard input (verified 2026-09-17,
 * Claude Code 2.1.233). Everything Claude Code would normally load is switched off —
 * tools, settings, MCP servers, the session log and its own system prompt — which cut a
 * two-frame request from about 51,000 input tokens to about 1,000. It runs in an empty
 * folder so no project CLAUDE.md is read. With no effort it thinks at Claude Code's own level
 * (`--effort`, Claude Code 2.1.280).
 */
/** Claude Code installs that turned out too old to know --effort: every job makes its own connection, and none asks them again. */
const withoutEffort = new Set<string>()

export function claudeCliTransport(options: { binary: string; effort?: Effort }): LlmTransport {
  const tooOld = (error: unknown) => error instanceof ProcessError && error.stderr.includes("unknown option '--effort'")
  return {
    id: "claude-cli",
    async generate({ model, system, content, schema, signal }) {
      const dir = await mkdtemp(join(tmpdir(), "boxblack-claude-"))
      try {
        const systemFile = join(dir, "system.txt")
        await writeFile(systemFile, system)

        const message = { type: "user", message: { role: "user", content: content.map(toBlock) } }
        // a reply asked for as plain text is asked for with no schema, and is the result's own text
        const plain = schema === TEXT_REPLY
        let stdout = ""
        let failure: unknown = null
        const ask = (effort: Effort | undefined) =>
          runProcess(
            options.binary,
            [
              "-p",
              "--input-format", "stream-json",
              "--output-format", "stream-json",
              "--verbose",
              "--model", model,
              ...(effort ? ["--effort", effort] : []),
              "--tools", "",
              "--strict-mcp-config",
              "--setting-sources", "",
              "--no-session-persistence",
              "--exclude-dynamic-system-prompt-sections",
              "--system-prompt-file", systemFile,
              ...(plain ? [] : ["--json-schema", JSON.stringify(replySchema(schema))]),
            ],
            { stdin: `${JSON.stringify(message)}\n`, cwd: dir, signal },
          )
        try {
          const effort = withoutEffort.has(options.binary) ? undefined : options.effort
          ;({ stdout } = await ask(effort).catch((error: unknown) => {
            if (effort === undefined || !tooOld(error)) throw error
            withoutEffort.add(options.binary)
            return ask(undefined)
          }))
        } catch (error) {
          if (signal?.aborted) throw error
          // Claude Code exits non-zero on failure but still prints a result event explaining why
          if (!(error instanceof ProcessError)) throw error
          failure = error
          stdout = error.stdout
        }

        const result = stdout
          .split("\n")
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line) as { type: string })
          .find((event): event is CliResult => event.type === "result")

        if (!result || result.is_error) {
          const reason = result?.result?.trim() || (failure instanceof Error ? failure.message : "no result from Claude Code")
          throw new Error(`Claude Code failed: ${reason}`)
        }

        // what is checked against the schema: the result's text when plain text was asked for, which its schema takes as it is; otherwise the structured output
        const parsed = schema.safeParse(plain ? (result.result ?? "") : result.structured_output)
        if (!parsed.success) throw new Error(`Claude's reply did not match the expected format: ${parsed.error.message}`)

        return {
          output: parsed.data,
          usage: {
            inputTokens: result.usage?.input_tokens ?? 0,
            outputTokens: result.usage?.output_tokens ?? 0,
            cacheReadTokens: result.usage?.cache_read_input_tokens ?? 0,
            cacheWriteTokens: result.usage?.cache_creation_input_tokens ?? 0,
          },
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
