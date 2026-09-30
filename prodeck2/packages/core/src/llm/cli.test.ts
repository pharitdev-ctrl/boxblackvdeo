import { describe, expect, test } from "vitest"
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { findExecutable } from "../media/tools.ts"
import { claudeCliTransport } from "./cli.ts"
import { TEXT_REPLY } from "./text-reply.ts"

const Schema = z.object({ frames: z.array(z.object({ at: z.number(), description: z.string() })) })

const request = {
  model: "claude-opus-5",
  system: "Describe frames.",
  content: [
    { type: "text" as const, text: "frame at 3.0 s" },
    { type: "image" as const, mediaType: "image/jpeg" as const, data: "/9j/AAAA" },
  ],
  schema: Schema,
  maxTokens: 4000,
}

/**
 * A stand-in `claude` binary: records its arguments, working directory, standard input
 * and system prompt file, then prints the stream-json events given in RESULT.
 */
async function fakeClaude(result: Record<string, unknown>, exitCode = 0) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-fake-claude-"))
  const bin = join(dir, "claude")
  const record = join(dir, "record.json")
  await writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
const stdin = fs.readFileSync(0, "utf8")
const systemFile = args[args.indexOf("--system-prompt-file") + 1]
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), stdin, system: fs.readFileSync(systemFile, "utf8") }))
console.log(JSON.stringify({ type: "system", subtype: "init" }))
console.log(JSON.stringify(${JSON.stringify({ type: "result", ...result })}))
process.exit(${exitCode})
`,
  )
  await chmod(bin, 0o755)
  const recorded = async () =>
    JSON.parse(await readFile(record, "utf8")) as { args: string[]; cwd: string; stdin: string; system: string }
  return { bin, recorded }
}

const success = {
  subtype: "success",
  is_error: false,
  result: "",
  structured_output: { frames: [{ at: 3, description: "ชายหนุ่มพูดกับกล้อง" }] },
  usage: { input_tokens: 1011, output_tokens: 147, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 },
}

test("sends the frames as a stream-json user message on standard input", async () => {
  const { bin, recorded } = await fakeClaude(success)
  await claudeCliTransport({ binary: bin }).generate(request)
  const { stdin } = await recorded()
  expect(JSON.parse(stdin.trim())).toEqual({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: "frame at 3.0 s" },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/AAAA" } },
      ],
    },
  })
})

test("runs Claude Code with no tools, settings, MCP servers or saved session, and our own system prompt", async () => {
  const { bin, recorded } = await fakeClaude(success)
  await claudeCliTransport({ binary: bin }).generate(request)
  const { args, system, cwd } = await recorded()
  expect(args.slice(0, 1)).toEqual(["-p"])
  for (const [flag, value] of [
    ["--input-format", "stream-json"],
    ["--output-format", "stream-json"],
    ["--model", "claude-opus-5"],
    ["--tools", ""],
    ["--setting-sources", ""],
  ] as const) {
    expect(args[args.indexOf(flag) + 1]).toBe(value)
  }
  expect(args).toEqual(expect.arrayContaining(["--verbose", "--strict-mcp-config", "--no-session-persistence", "--exclude-dynamic-system-prompt-sections"]))
  expect(system).toBe("Describe frames.")
  // an empty scratch folder, so no project CLAUDE.md is picked up
  expect(cwd).toMatch(/boxblack-claude-/)
})

test("thinks at the effort it is given, and at Claude Code's own when given none", async () => {
  const { bin, recorded } = await fakeClaude(success)
  await claudeCliTransport({ binary: bin, effort: "high" }).generate(request)
  const { args } = await recorded()
  expect(args[args.indexOf("--effort") + 1]).toBe("high")
  await claudeCliTransport({ binary: bin }).generate(request)
  expect((await recorded()).args).not.toContain("--effort")
})

test("a Claude Code too old to know --effort still answers, at its own level, and is not asked again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-old-claude-"))
  const bin = join(dir, "claude")
  const runs = join(dir, "runs.txt")
  await writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(runs)}, (args.includes("--effort") ? "effort" : "plain") + "\\n")
if (args.includes("--effort")) { console.error("error: unknown option '--effort'"); process.exit(1) }
fs.readFileSync(0, "utf8")
console.log(JSON.stringify(${JSON.stringify({ type: "result", ...success })}))
`,
  )
  await chmod(bin, 0o755)
  const transport = claudeCliTransport({ binary: bin, effort: "high" })
  expect((await transport.generate(request)).output).toEqual(success.structured_output)
  await transport.generate(request)
  // the next job makes a connection of its own to the same Claude Code: it is not asked again either
  await claudeCliTransport({ binary: bin, effort: "high" }).generate(request)
  expect((await readFile(runs, "utf8")).trim().split("\n")).toEqual(["effort", "plain", "plain", "plain"])
})

test("any other failure is not taken for an old Claude Code", async () => {
  const { bin, recorded } = await fakeClaude({ subtype: "success", is_error: true, result: "Not logged in · Please run /login" }, 1)
  await expect(claudeCliTransport({ binary: bin, effort: "high" }).generate(request)).rejects.toThrow(/Not logged in/)
  // asked once, as it was: not again without the effort
  expect((await recorded()).args).toContain("--effort")
})

test("asks for output matching the schema", async () => {
  const { bin, recorded } = await fakeClaude(success)
  await claudeCliTransport({ binary: bin }).generate(request)
  const { args } = await recorded()
  const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!)
  expect(schema).toMatchObject({ type: "object", properties: { frames: { type: "array" } }, required: ["frames"] })
  expect(schema).not.toHaveProperty("$schema")
})

test("returns the validated structured output and token usage", async () => {
  const { bin } = await fakeClaude(success)
  const reply = await claudeCliTransport({ binary: bin }).generate(request)
  expect(reply.output).toEqual(success.structured_output)
  expect(reply.usage).toEqual({ inputTokens: 1011, outputTokens: 147, cacheReadTokens: 5, cacheWriteTokens: 7 })
})

test("reports Claude Code's own error text when the run fails", async () => {
  const { bin } = await fakeClaude({ subtype: "success", is_error: true, result: "Not logged in · Please run /login" }, 1)
  await expect(claudeCliTransport({ binary: bin }).generate(request)).rejects.toThrow(/Not logged in/)
})

test("rejects output that does not match the schema", async () => {
  const { bin } = await fakeClaude({ ...success, structured_output: { frames: "nope" } })
  await expect(claudeCliTransport({ binary: bin }).generate(request)).rejects.toThrow(/did not match/)
})

/** What Claude Code prints for a run asked for no schema: the reply is the result's own text, a fragment of HTML here. */
const written = {
  subtype: "success",
  is_error: false,
  result: '<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style>\n<div class="a">ยอดขาย</div>',
  usage: { input_tokens: 2100, output_tokens: 3900, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 },
}

test("a reply asked for as plain text is asked for with no schema, and is the result's text as Claude wrote it", async () => {
  const { bin, recorded } = await fakeClaude(written)
  const reply = await claudeCliTransport({ binary: bin }).generate({ ...request, schema: TEXT_REPLY })
  const { args, system, stdin } = await recorded()
  expect(args).not.toContain("--json-schema")
  // everything else it is run with is what it is for a reply that is data
  expect(args.slice(0, 1)).toEqual(["-p"])
  expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json")
  expect(args[args.indexOf("--tools") + 1]).toBe("")
  expect(args).toEqual(expect.arrayContaining(["--verbose", "--strict-mcp-config", "--no-session-persistence", "--exclude-dynamic-system-prompt-sections", "--system-prompt-file"]))
  expect(system).toBe("Describe frames.")
  expect(JSON.parse(stdin.trim()).message.content[0]).toEqual({ type: "text", text: "frame at 3.0 s" })
  expect(reply.output).toBe(written.result)
  expect(reply.usage).toEqual({ inputTokens: 2100, outputTokens: 3900, cacheReadTokens: 5, cacheWriteTokens: 7 })
})

test("a plain-text reply keeps the effort it is asked at", async () => {
  const { bin, recorded } = await fakeClaude(written)
  await claudeCliTransport({ binary: bin, effort: "high" }).generate({ ...request, schema: TEXT_REPLY })
  const { args } = await recorded()
  expect(args[args.indexOf("--effort") + 1]).toBe("high")
  expect(args).not.toContain("--json-schema")
})

test("a plain-text result with no text is the empty string, and one that is JSON is not read as data", async () => {
  const { result: _none, ...silent } = written
  const none = await fakeClaude(silent)
  expect((await claudeCliTransport({ binary: none.bin }).generate({ ...request, schema: TEXT_REPLY })).output).toBe("")
  // structured output is what a schema is answered with: it is not the reply when none was asked for
  const json = await fakeClaude({ ...written, result: '{"frames": []}', structured_output: { frames: [] } })
  expect((await claudeCliTransport({ binary: json.bin }).generate({ ...request, schema: TEXT_REPLY })).output).toBe('{"frames": []}')
})

test("a plain-text run that fails reports Claude Code's own error text, as one for data does", async () => {
  const { bin } = await fakeClaude({ subtype: "success", is_error: true, result: "Not logged in · Please run /login" }, 1)
  await expect(claudeCliTransport({ binary: bin }).generate({ ...request, schema: TEXT_REPLY })).rejects.toThrow(/Claude Code failed: Not logged in/)
})

test("only TEXT_REPLY itself asks for plain text: another schema of a string is still asked for, and read, as data", async () => {
  const { bin, recorded } = await fakeClaude({ ...success, result: "not the reply", structured_output: "ชายหนุ่ม" })
  const reply = await claudeCliTransport({ binary: bin }).generate({ ...request, schema: z.string() })
  const { args } = await recorded()
  expect(JSON.parse(args[args.indexOf("--json-schema") + 1]!)).toMatchObject({ type: "string" })
  expect(reply.output).toBe("ชายหนุ่ม")
})

const claude = findExecutable("claude")

describe.skipIf(!process.env.BOXBLACK_LIVE_LLM || !claude)("live Claude Code (BOXBLACK_LIVE_LLM=1)", () => {
  test("describes a real image", { timeout: 120_000 }, async () => {
    // 1×1 white JPEG
    const white =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
    const reply = await claudeCliTransport({ binary: claude! }).generate({
      ...request,
      model: "claude-sonnet-5",
      content: [
        { type: "text", text: "frame at 0.0 s" },
        { type: "image", mediaType: "image/jpeg", data: white },
      ],
    })
    expect(reply.output.frames.length).toBeGreaterThan(0)
  })
})
