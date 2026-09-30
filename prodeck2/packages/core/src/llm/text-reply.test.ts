import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { TEXT_REPLY } from "./text-reply.ts"

test("the schema of a plain-text reply takes any text as it is, and is exported with the transports that know it", async () => {
  const written = '<style>.a{color:red}</style>\n<div class="a">ยอดขาย</div>\n'
  expect(TEXT_REPLY.parse(written)).toBe(written)
  expect(TEXT_REPLY.parse("")).toBe("")
  expect(TEXT_REPLY.safeParse(undefined).success).toBe(false)
  const llm = await import("./index.ts")
  // one constant, whichever way it is reached: a transport tells a plain-text request by this very schema
  expect(llm.TEXT_REPLY).toBe(TEXT_REPLY)
  expect((await import("@boxblack/core/llm")).TEXT_REPLY).toBe(TEXT_REPLY)
})

test("the module the settings screen takes the model list from loads nothing when it runs: zod is a type to it, and the plain-text schema lives elsewhere", async () => {
  const source = readFileSync(join(import.meta.dirname, "types.ts"), "utf8")
  // no statement of it loads a module when it runs: every import is of types, and it hands nothing on from elsewhere
  expect(source).toContain('import type { z } from "zod"')
  expect(source).not.toMatch(/^import\s+(?!type\b)/m)
  expect(source).not.toMatch(/^export\s+(?!type\b)[^\n]*\bfrom\s+["']/m)
  expect(Object.keys(await import("./types.ts"))).not.toContain("TEXT_REPLY")
  // what the renderer does take from it is still there
  expect(Object.keys(await import("@boxblack/core/llm/types"))).toEqual(expect.arrayContaining(["CLAUDE_MODELS", "EFFORTS", "EFFORT_MODELS"]))
})
