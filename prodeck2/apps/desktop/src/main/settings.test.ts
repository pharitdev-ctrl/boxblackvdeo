import { expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HIGHLIGHT_STYLES, type Palette } from "@boxblack/core/highlights/styles"
import { DEFAULT_SETTINGS, SecretStore, SettingsStore, type SecretBox } from "./settings.ts"

async function dir() {
  return mkdtemp(join(tmpdir(), "boxblack-settings-"))
}

/** Reversible stand-in for Electron's safeStorage. */
const fakeBox: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`).reverse(),
  decryptString: (cipher) => Buffer.from(cipher).reverse().toString().replace(/^enc:/, ""),
}

test("settings start from the defaults", async () => {
  const store = new SettingsStore(join(await dir(), "settings.json"))
  expect(await store.read()).toEqual(DEFAULT_SETTINGS)
})

test("the defaults transcribe locally, reach Claude Opus 5 through the Anthropic API, cut with the normal preset, and put on highlight text and every effect but graphics at the middle level, with no subtitles", () => {
  expect(DEFAULT_SETTINGS).toEqual({
    asr: { engine: "whisper-local", language: "th" },
    llm: { transport: "anthropic-api", model: "claude-opus-5", effort: "medium" },
    cut: { preset: "normal", cutFillers: true, cutRetakes: true, cutBadPicture: true },
    subtitles: { enabled: false, length: "line", polish: false },
    highlights: { enabled: true, position: "auto", hideSubtitles: true, custom: HIGHLIGHT_STYLES["bold-white"].palette },
    flair: { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false },
    vision: { frameEveryS: 3 },
    appearance: "system",
    capcut: { pro: false },
  })
})

test("how often Claude looks at the pictures is a setting: every 3 s unless changed, and only the offered rates are kept", async () => {
  const file = join(await dir(), "settings.json")
  expect((await new SettingsStore(file).read()).vision).toEqual({ frameEveryS: 3 })
  await new SettingsStore(file).update({ vision: { frameEveryS: 1 } })
  expect((await new SettingsStore(file).read()).vision.frameEveryS).toBe(1)
  await new SettingsStore(file).update({ vision: { frameEveryS: 10 } })
  expect((await new SettingsStore(file).read()).vision.frameEveryS).toBe(10)
  // a rate not offered (an older or edited file) falls back to the default, and so does a missing group
  await writeFile(file, JSON.stringify({ vision: { frameEveryS: 4 } }))
  expect((await new SettingsStore(file).read()).vision.frameEveryS).toBe(3)
  await writeFile(file, JSON.stringify({ vision: { frameEveryS: "1" } }))
  expect((await new SettingsStore(file).read()).vision.frameEveryS).toBe(3)
  await writeFile(file, JSON.stringify({ asr: { engine: "scribe" } }))
  expect((await new SettingsStore(file).read()).vision.frameEveryS).toBe(3)
})

test("settings changes are saved and read back", async () => {
  const file = join(await dir(), "settings.json")
  await new SettingsStore(file).update({ asr: { engine: "scribe", language: "auto" } })
  await new SettingsStore(file).update({ llm: { transport: "claude-cli" } })
  await new SettingsStore(file).update({ cut: { preset: "tight", cutFillers: false } })
  await new SettingsStore(file).update({ subtitles: { enabled: true, length: "short" } })
  await new SettingsStore(file).update({ highlights: { enabled: true, position: "bottom" } })
  expect(await new SettingsStore(file).read()).toEqual({
    asr: { engine: "scribe", language: "auto" },
    llm: { transport: "claude-cli", model: "claude-opus-5", effort: "medium" },
    cut: { preset: "tight", cutFillers: false, cutRetakes: true, cutBadPicture: true },
    subtitles: { enabled: true, length: "short", polish: false },
    highlights: { enabled: true, position: "bottom", hideSubtitles: true, custom: HIGHLIGHT_STYLES["bold-white"].palette },
    flair: { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false },
    vision: { frameEveryS: 3 },
    appearance: "system",
    capcut: { pro: false },
  })
})

test("Claude Opus 5.5 can be chosen and is kept; a model the app does not offer reads as the default", async () => {
  const file = join(await dir(), "settings.json")
  await new SettingsStore(file).update({ llm: { model: "claude-opus-5-5" } })
  expect((await new SettingsStore(file).read()).llm).toEqual({ transport: "anthropic-api", model: "claude-opus-5-5", effort: "medium" })
  await new SettingsStore(file).update({ llm: { model: "claude-made-up" as never } })
  expect((await new SettingsStore(file).read()).llm.model).toBe("claude-opus-5")
})

test("how hard Claude thinks is kept as chosen; a level the app does not offer reads as medium", async () => {
  const file = join(await dir(), "settings.json")
  await new SettingsStore(file).update({ llm: { effort: "high" } })
  expect((await new SettingsStore(file).read()).llm.effort).toBe("high")
  await new SettingsStore(file).update({ llm: { effort: "low" } })
  expect((await new SettingsStore(file).read()).llm.effort).toBe("low")
  await new SettingsStore(file).update({ llm: { effort: "max" as never } })
  expect((await new SettingsStore(file).read()).llm.effort).toBe("medium")
})

test("the user's own palette is kept whole, and one with a channel out of range or a colour missing is not taken", async () => {
  const file = join(await dir(), "settings.json")
  const mine: Palette = { text: [0, 1, 0], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0.1, 0.1, 0.1] }
  await new SettingsStore(file).update({ highlights: { custom: mine } })
  expect((await new SettingsStore(file).read()).highlights.custom).toEqual(mine)
  // a later change to something else leaves the palette alone
  await new SettingsStore(file).update({ highlights: { position: "top" } })
  expect((await new SettingsStore(file).read()).highlights.custom).toEqual(mine)

  await writeFile(file, JSON.stringify({ highlights: { custom: { text: [0, 1, 2], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0, 0, 0] } } }))
  expect((await new SettingsStore(file).read()).highlights.custom).toEqual(HIGHLIGHT_STYLES["bold-white"].palette)
  await writeFile(file, JSON.stringify({ highlights: { custom: { text: [0, 1, 0], accent: [1, 0, 0], alt: [0, 0, 1] } } }))
  expect((await new SettingsStore(file).read()).highlights.custom).toEqual(HIGHLIGHT_STYLES["bold-white"].palette)
  await writeFile(file, JSON.stringify({ highlights: { custom: { text: [0, 1, 0, 1], accent: [1, 0, 0], alt: [0, 0, 1], bar: [0, 0, 0] } } }))
  expect((await new SettingsStore(file).read()).highlights.custom).toEqual(HIGHLIGHT_STYLES["bold-white"].palette)
})

test("changing one subtitle choice keeps the others", async () => {
  const file = join(await dir(), "settings.json")
  await new SettingsStore(file).update({ subtitles: { length: "short", polish: true } })
  await new SettingsStore(file).update({ subtitles: { enabled: true } })
  expect((await new SettingsStore(file).read()).subtitles).toEqual({ enabled: true, length: "short", polish: true })
  await new SettingsStore(file).update({ highlights: { hideSubtitles: false } })
  await new SettingsStore(file).update({ highlights: { position: "middle" } })
  expect((await new SettingsStore(file).read()).highlights).toEqual({ enabled: true, position: "middle", hideSubtitles: false, custom: HIGHLIGHT_STYLES["bold-white"].palette })
})

test("changes made at the same moment are all kept", async () => {
  const store = new SettingsStore(join(await dir(), "settings.json"))
  await Promise.all([store.update({ cut: { preset: "tight" } }), store.update({ subtitles: { enabled: true } }), store.update({ llm: { transport: "claude-cli" } })])
  const read = await store.read()
  expect([read.cut.preset, read.subtitles.enabled, read.llm.transport]).toEqual(["tight", true, "claude-cli"])
})

test("a damaged settings file falls back to the defaults", async () => {
  const file = join(await dir(), "settings.json")
  await writeFile(file, "{not json")
  expect(await new SettingsStore(file).read()).toEqual(DEFAULT_SETTINGS)
})

test("unknown values in the settings file are replaced by defaults", async () => {
  const file = join(await dir(), "settings.json")
  await writeFile(
    file,
    JSON.stringify({
      asr: { engine: "gemini", language: "fr" },
      llm: { transport: "openai", model: "gpt-9", effort: "extreme" },
      cut: { preset: "extreme", cutFillers: "yes", cutRetakes: 1, cutBadPicture: null },
      subtitles: { enabled: "on", length: "paragraph", polish: 1 },
      highlights: { enabled: 1, position: "left", hideSubtitles: "no", custom: "rainbow" },
      flair: { enabled: "yes", level: "loud" },
      appearance: "neon",
    }),
  )
  expect(await new SettingsStore(file).read()).toEqual(DEFAULT_SETTINGS)
})

test("a settings file from before the graphics switch reads it as off, and one that turned it on keeps it on", async () => {
  const file = join(await dir(), "settings.json")
  await writeFile(file, JSON.stringify({ flair: { enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true } }))
  expect((await new SettingsStore(file).read()).flair).toEqual({ enabled: true, level: "heavy", text: true, sound: true, zoom: true, insert: true, graphic: false })
  await new SettingsStore(file).update({ flair: { graphic: true } })
  expect((await new SettingsStore(file).read()).flair.graphic).toBe(true)
})

test("a saved secret can be read back", async () => {
  const store = new SecretStore(join(await dir(), "secrets.json"), fakeBox)
  await store.set("elevenlabs", "sk_live_1234abcd")
  await store.set("anthropic", "sk-ant-5678")
  expect(await store.get("elevenlabs")).toBe("sk_live_1234abcd")
  expect(await store.get("anthropic")).toBe("sk-ant-5678")
})

test("secrets never touch the disk in plain text", async () => {
  const file = join(await dir(), "secrets.json")
  await new SecretStore(file, fakeBox).set("elevenlabs", "sk_live_1234abcd")
  expect(await readFile(file, "utf8")).not.toContain("sk_live_1234abcd")
})

test("hint shows only the last four characters of a secret", async () => {
  const store = new SecretStore(join(await dir(), "secrets.json"), fakeBox)
  expect(await store.hint("elevenlabs")).toBeNull()
  await store.set("elevenlabs", "sk_live_1234abcd")
  expect(await store.hint("elevenlabs")).toBe("abcd")
})

test("a deleted secret is gone", async () => {
  const store = new SecretStore(join(await dir(), "secrets.json"), fakeBox)
  await store.set("elevenlabs", "sk_live_1234abcd")
  await store.delete("elevenlabs")
  expect(await store.get("elevenlabs")).toBeNull()
})

test("a key the keychain will not decrypt counts as no key, so it can be entered again, and the others still work", async () => {
  // what a keychain refusal, or a key saved under another app's keychain entry, looks like
  const file = join(await dir(), "secrets.json")
  const store = new SecretStore(file, fakeBox)
  await store.set("anthropic", "sk-ant-5678")
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), elevenlabs: Buffer.from("not ours").toString("base64") }))
  const refusing = new SecretStore(file, {
    ...fakeBox,
    decryptString: (cipher) => {
      if (cipher.toString() === "not ours") throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.")
      return fakeBox.decryptString(cipher)
    },
  })
  expect(await refusing.get("elevenlabs")).toBeNull()
  expect(await refusing.hint("elevenlabs")).toBeNull()
  expect(await refusing.get("anthropic")).toBe("sk-ant-5678")
  await refusing.set("elevenlabs", "sk_new_9999")
  expect(await refusing.get("elevenlabs")).toBe("sk_new_9999")
})

test("refuses to store a secret when the OS cannot encrypt it", async () => {
  const store = new SecretStore(join(await dir(), "secrets.json"), { ...fakeBox, isEncryptionAvailable: () => false })
  await expect(store.set("elevenlabs", "sk")).rejects.toThrow(/encrypt/)
})

test("the appearance is remembered, and leaving it out of a change keeps it", async () => {
  const file = join(await dir(), "settings.json")
  await new SettingsStore(file).update({ appearance: "dark" })
  expect((await new SettingsStore(file).read()).appearance).toBe("dark")
  await new SettingsStore(file).update({ subtitles: { enabled: true } })
  expect((await new SettingsStore(file).read()).appearance).toBe("dark")
})

test("remembers whether the user has CapCut Pro, off unless they said so", async () => {
  const store = new SettingsStore(join(await dir(), "settings.json"))
  expect((await store.read()).capcut).toEqual({ pro: false })
  await store.update({ capcut: { pro: true } })
  expect((await store.read()).capcut).toEqual({ pro: true })
  // another section's change keeps it
  await store.update({ appearance: "dark" })
  expect((await store.read()).capcut).toEqual({ pro: true })
})

test("reads anything but true or false as no CapCut Pro", async () => {
  const file = join(await dir(), "settings.json")
  await writeFile(file, JSON.stringify({ capcut: { pro: "yes" } }))
  expect((await new SettingsStore(file).read()).capcut).toEqual({ pro: false })
})

test("a settings file the user saved before M25 keeps what they chose, highlight text off included", async () => {
  const file = join(await dir(), "settings.json")
  await writeFile(file, JSON.stringify({ highlights: { enabled: false }, flair: { enabled: false, level: "light", sound: false } }))
  const read = await new SettingsStore(file).read()
  expect([read.highlights.enabled, read.flair]).toEqual([false, { enabled: false, level: "light", text: true, sound: false, zoom: true, insert: true, graphic: false }])
})
