import { expect, test } from "vitest"
import { z } from "zod"
import { anthropicTransport } from "./anthropic.ts"
import { TEXT_REPLY } from "./text-reply.ts"
import { LlmRefusalError } from "./types.ts"

const Schema = z.object({ frames: z.array(z.object({ at: z.number(), description: z.string() })) })

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: JSON.stringify({ frames: [{ at: 3, description: "ชายหนุ่มพูดกับกล้อง" }] }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...overrides,
  }
}

function recordingFetch(reply: () => Response) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
    return reply()
  }
  return { requests, fetch: fetch as typeof globalThis.fetch }
}

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

test("sends the frames as base64 images with the user's key and a JSON schema for the reply", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message()))
  await anthropicTransport({ apiKey: "sk-ant-user", fetch }).generate(request)

  const [sent] = requests
  expect(sent!.url).toMatch(/\/v1\/messages/)
  expect(sent!.headers.get("x-api-key")).toBe("sk-ant-user")
  expect(sent!.body).toMatchObject({
    model: "claude-opus-5",
    max_tokens: 4000,
    system: "Describe frames.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "frame at 3.0 s" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/AAAA" } },
        ],
      },
    ],
  })
  const format = (sent!.body.output_config as { format: { type: string; schema: Record<string, unknown> } }).format
  expect(format.type).toBe("json_schema")
  expect(format.schema).toMatchObject({ type: "object", required: ["frames"], additionalProperties: false })
  expect(format.schema).not.toHaveProperty("$schema")
})

test("lets the API retry a refused request on its recommended fallback model", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message()))
  await anthropicTransport({ apiKey: "k", fetch }).generate(request)
  expect(requests[0]!.body.fallbacks).toBe("default")
  expect(requests[0]!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01")
})

test("Opus 5.5 is retried on the recommended model too; Sonnet 5 has no refusal classifiers to fall back from", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message()))
  const transport = anthropicTransport({ apiKey: "k", fetch })
  await transport.generate({ ...request, model: "claude-opus-5-5" })
  await transport.generate({ ...request, model: "claude-sonnet-5" })
  expect(requests[0]!.body.fallbacks).toBe("default")
  expect(requests[1]!.body.fallbacks).toBeUndefined()
})

test("thinks at the effort it is given, and at the model's own when given none", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message()))
  await anthropicTransport({ apiKey: "k", fetch, effort: "low" }).generate({ ...request, model: "claude-opus-5-5" })
  await anthropicTransport({ apiKey: "k", fetch }).generate(request)
  expect(requests[0]!.body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } })
  expect(requests[1]!.body.output_config).not.toHaveProperty("effort")
})

test("returns the validated reply and token usage", async () => {
  const { fetch } = recordingFetch(() => Response.json(message()))
  const reply = await anthropicTransport({ apiKey: "k", fetch }).generate(request)
  expect(reply.output).toEqual({ frames: [{ at: 3, description: "ชายหนุ่มพูดกับกล้อง" }] })
  expect(reply.usage).toEqual({ inputTokens: 900, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 })
})

test("a refusal becomes a clear error instead of an empty result", async () => {
  const { fetch } = recordingFetch(() =>
    Response.json(message({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "no" } })),
  )
  await expect(anthropicTransport({ apiKey: "k", fetch }).generate(request)).rejects.toBeInstanceOf(LlmRefusalError)
})

test("a reply cut off by the token limit is an error, not half a result", async () => {
  const { fetch } = recordingFetch(() =>
    Response.json(message({ content: [{ type: "text", text: '{"frames":[' }], stop_reason: "max_tokens" })),
  )
  await expect(anthropicTransport({ apiKey: "k", fetch }).generate(request)).rejects.toThrow(/token limit/)
})

test("a rejected API key is explained", async () => {
  const { fetch } = recordingFetch(
    () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 }),
  )
  await expect(anthropicTransport({ apiKey: "bad", fetch }).generate(request)).rejects.toThrow(/Anthropic API key/)
})

test("text marked as cacheable becomes a prompt cache breakpoint", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message()))
  await anthropicTransport({ apiKey: "k", fetch }).generate({
    ...request,
    content: [
      { type: "text", text: "long footage description", cache: true },
      { type: "text", text: "the brief" },
    ],
  })
  const sent = (requests[0]!.body.messages as { content: Record<string, unknown>[] }[])[0]!.content
  expect(sent[0]).toEqual({ type: "text", text: "long footage description", cache_control: { type: "ephemeral" } })
  expect(sent[1]).toEqual({ type: "text", text: "the brief" })
})

/** A fragment of HTML, which is what the one plain-text call of the app asks for: nothing in it is JSON. */
const WRITTEN = '<style>.a{animation:out 1s both}@keyframes out{to{opacity:0}}</style>\n<div class="a">ยอดขาย</div>'

test("a reply asked for as plain text is asked for with no format, and comes back as Claude wrote it", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message({ content: [{ type: "text", text: WRITTEN }] })))
  const reply = await anthropicTransport({ apiKey: "k", fetch }).generate({ ...request, schema: TEXT_REPLY })
  // with no format and no effort there is nothing to say about the output
  expect(requests[0]!.body).not.toHaveProperty("output_config")
  // the rest of the request is what it is for a reply that is data
  expect(requests[0]!.body).toMatchObject({ model: "claude-opus-5", max_tokens: 4000, system: "Describe frames.", fallbacks: "default" })
  expect(reply.output).toBe(WRITTEN)
  expect(reply.usage).toEqual({ inputTokens: 900, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 })
})

test("a plain-text reply keeps the effort it is asked at: only the format goes", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message({ content: [{ type: "text", text: WRITTEN }] })))
  await anthropicTransport({ apiKey: "k", fetch, effort: "low" }).generate({ ...request, model: "claude-opus-5-5", schema: TEXT_REPLY })
  expect(requests[0]!.body.output_config).toEqual({ effort: "low" })
})

test("a plain-text reply is its text blocks joined, and is not read as JSON even when it is JSON", async () => {
  const blocks = [{ type: "text", text: '{"frames":' }, { type: "text", text: " []}\n" }]
  const { fetch } = recordingFetch(() => Response.json(message({ content: blocks })))
  const reply = await anthropicTransport({ apiKey: "k", fetch }).generate({ ...request, schema: TEXT_REPLY })
  expect(reply.output).toBe('{"frames": []}\n')
})

test("a plain-text reply with no text in it is the empty string", async () => {
  const none = recordingFetch(() => Response.json(message({ content: [] })))
  expect((await anthropicTransport({ apiKey: "k", fetch: none.fetch }).generate({ ...request, schema: TEXT_REPLY })).output).toBe("")
  // a block that is not text is not part of the reply
  const thought = recordingFetch(() => Response.json(message({ content: [{ type: "thinking", thinking: "a gauge, then the number", signature: "s" }] })))
  const reply = await anthropicTransport({ apiKey: "k", fetch: thought.fetch }).generate({ ...request, schema: TEXT_REPLY })
  expect(reply.output).toBe("")
  expect(reply.usage).toEqual({ inputTokens: 900, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 })
})

test("a refusal and a reply cut off by the token limit fail for plain text as they do for data", async () => {
  const refused = recordingFetch(() => Response.json(message({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "no" } })))
  await expect(anthropicTransport({ apiKey: "k", fetch: refused.fetch }).generate({ ...request, schema: TEXT_REPLY })).rejects.toBeInstanceOf(LlmRefusalError)
  const cut = recordingFetch(() => Response.json(message({ content: [{ type: "text", text: "<style>.a{" }], stop_reason: "max_tokens" })))
  await expect(anthropicTransport({ apiKey: "k", fetch: cut.fetch }).generate({ ...request, schema: TEXT_REPLY })).rejects.toThrow(/token limit \(4000\)/)
})

test("only TEXT_REPLY itself asks for plain text: another schema of a string is still asked for, and read, as JSON", async () => {
  const { requests, fetch } = recordingFetch(() => Response.json(message({ content: [{ type: "text", text: '"ชายหนุ่ม"' }] })))
  const reply = await anthropicTransport({ apiKey: "k", fetch }).generate({ ...request, schema: z.string() })
  expect(requests[0]!.body.output_config).toMatchObject({ format: { type: "json_schema", schema: { type: "string" } } })
  expect(reply.output).toBe("ชายหนุ่ม")
})
