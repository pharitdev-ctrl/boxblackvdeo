import { expect, test } from "vitest"
import { findExecutable } from "./tools.ts"

const only = (...paths: string[]) => (path: string) => paths.includes(path)

test("findExecutable prefers the directories the app ships its own tools in", () => {
  expect(
    findExecutable("ffmpeg", {
      bundledDirs: ["/App/Resources/bin"],
      pathEnv: "/usr/bin:/opt/homebrew/bin",
      isExecutable: only("/App/Resources/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"),
    }),
  ).toBe("/App/Resources/bin/ffmpeg")
})

test("findExecutable then searches PATH in order", () => {
  expect(
    findExecutable("ffmpeg", { pathEnv: "/usr/bin:/custom/bin", isExecutable: only("/custom/bin/ffmpeg") }),
  ).toBe("/custom/bin/ffmpeg")
})

test("findExecutable looks in Homebrew's folders even when launched from Finder with a bare PATH", () => {
  expect(
    findExecutable("whisper-cli", { pathEnv: "/usr/bin:/bin", isExecutable: only("/opt/homebrew/bin/whisper-cli") }),
  ).toBe("/opt/homebrew/bin/whisper-cli")
  expect(findExecutable("ffprobe", { pathEnv: "", isExecutable: only("/usr/local/bin/ffprobe") })).toBe(
    "/usr/local/bin/ffprobe",
  )
})

test("findExecutable returns null when the tool is nowhere", () => {
  expect(findExecutable("ffmpeg", { pathEnv: "/usr/bin", isExecutable: () => false })).toBeNull()
})

test("findExecutable also looks in extra folders after PATH, such as per-user install locations", () => {
  expect(
    findExecutable("claude", {
      pathEnv: "/usr/bin",
      searchDirs: ["/Users/me/.local/bin"],
      isExecutable: only("/Users/me/.local/bin/claude"),
    }),
  ).toBe("/Users/me/.local/bin/claude")
})
