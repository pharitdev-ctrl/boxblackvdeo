import { expect, test } from "vitest"
import type { ClaudeCode } from "./claude-code.ts"
import { createClaudeCodeApi } from "./claude-code-api.ts"

test("each request goes to the Claude Code service, and a code that is not text never reaches it", async () => {
  const calls: unknown[][] = []
  const record = (name: string) => async (...args: unknown[]) => void calls.push([name, ...args])
  const claudeCode = {
    status: async () => ({ supported: true, path: null, version: null, account: null, busy: null }),
    install: record("install"),
    login: record("login"),
    openLoginPage: record("openLoginPage"),
    submitLoginCode: record("submitLoginCode"),
    cancel: record("cancel"),
  } as unknown as ClaudeCode
  const api = createClaudeCodeApi({ claudeCode })
  expect((await api.claudeCodeStatus()).path).toBeNull()
  await api.installClaudeCode()
  await api.loginClaudeCode()
  await api.openClaudeCodeLogin()
  await api.submitClaudeCodeLoginCode("abc#state")
  await api.cancelClaudeCode()
  await expect(api.submitClaudeCodeLoginCode(42 as unknown as string)).rejects.toThrow("text")
  expect(calls).toEqual([["install"], ["login"], ["openLoginPage"], ["submitLoginCode", "abc#state"], ["cancel"]])
})
