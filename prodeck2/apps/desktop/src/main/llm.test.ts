import { expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Effort, LlmTransport } from "@boxblack/core/llm"
import { chosenLlm } from "./llm.ts"
import { SecretStore, SettingsStore, type SecretBox } from "./settings.ts"

const box: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain),
  decryptString: (cipher) => cipher.toString(),
}

async function setup(tools: { claude: string | null } = { claude: "/bin/claude" }) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-llm-"))
  const settings = new SettingsStore(join(dir, "settings.json"))
  const secrets = new SecretStore(join(dir, "secrets.json"), box)
  const made: string[] = []
  const efforts: (string | undefined)[] = []
  const transport = (id: LlmTransport["id"]): LlmTransport => ({ id, generate: async () => ({ output: null as never, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }) })
  const transports = {
    anthropic: (key: string, effort?: Effort) => (made.push(`anthropic:${key}`), efforts.push(effort), transport("anthropic-api")),
    cli: (binary: string, effort?: Effort) => (made.push(`cli:${binary}`), efforts.push(effort), transport("claude-cli")),
  }
  return { deps: { settings, secrets, tools, transports }, settings, secrets, made, efforts }
}

test("the Anthropic API is reached with the saved key and the chosen model", async () => {
  const { deps, settings, secrets, made } = await setup()
  await secrets.set("anthropic", "sk-ant-1")
  await settings.update({ llm: { model: "claude-sonnet-5" } })
  const llm = await chosenLlm(deps, "polishing subtitles")
  expect(llm.transport.id).toBe("anthropic-api")
  expect(llm.model).toBe("claude-sonnet-5")
  expect(made).toEqual(["anthropic:sk-ant-1"])
})

test("Claude Code is used when chosen", async () => {
  const { deps, settings, made } = await setup()
  await settings.update({ llm: { transport: "claude-cli" } })
  expect((await chosenLlm(deps, "planning")).transport.id).toBe("claude-cli")
  expect(made).toEqual(["cli:/bin/claude"])
})

test("a missing key or a missing Claude Code says which work cannot start and why", async () => {
  const { deps, settings } = await setup({ claude: null })
  await expect(chosenLlm(deps, "polishing subtitles")).rejects.toThrow("polishing subtitles is not ready: anthropic-key-missing")
  await settings.update({ llm: { transport: "claude-cli" } })
  await expect(chosenLlm(deps, "planning")).rejects.toThrow("planning is not ready: claude-cli-missing")
})

test("Opus 5.5 thinks as hard as the settings say, on either connection; the other models keep their own level", async () => {
  const { deps, settings, secrets, efforts } = await setup()
  await secrets.set("anthropic", "sk-ant-1")
  await settings.update({ llm: { model: "claude-opus-5-5" } })
  await chosenLlm(deps, "planning")
  await settings.update({ llm: { effort: "high", transport: "claude-cli" } })
  await chosenLlm(deps, "planning")
  await settings.update({ llm: { model: "claude-opus-5" } })
  await chosenLlm(deps, "planning")
  await settings.update({ llm: { model: "claude-sonnet-5", transport: "anthropic-api" } })
  await chosenLlm(deps, "planning")
  expect(efforts).toEqual(["medium", "high", undefined, undefined])
})
