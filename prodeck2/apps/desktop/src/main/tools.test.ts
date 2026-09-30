import { expect, test } from "vitest"
import type { ToolReport } from "@boxblack/core/media"
import { createToolbox } from "./tools.ts"

test("finds the tools once at start, and again on request, updating the paths every service holds", async () => {
  let installed = new Set(["ffmpeg", "ffprobe"])
  const inspected: unknown[] = []
  const toolbox = createToolbox({
    find: (name) => (installed.has(name) ? `/opt/homebrew/bin/${name}` : null),
    inspect: async (paths) => {
      inspected.push(paths)
      return { ffmpeg: paths.ffmpeg ? { path: paths.ffmpeg, version: "8.1.2", missing: [] } : null, ffprobe: null, whisper: null, claude: null } satisfies ToolReport
    },
  })
  const held = toolbox.paths
  expect(held).toEqual({ ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe", whisper: null, claude: null })
  expect((await toolbox.report()).ffmpeg?.version).toBe("8.1.2")

  installed = new Set(["ffmpeg", "ffprobe", "whisper-cli", "claude"])
  await toolbox.rescan()
  expect(held).toEqual({
    ffmpeg: "/opt/homebrew/bin/ffmpeg",
    ffprobe: "/opt/homebrew/bin/ffprobe",
    whisper: "/opt/homebrew/bin/whisper-cli",
    claude: "/opt/homebrew/bin/claude",
  })
  expect(inspected).toHaveLength(2)
})

test("an ffmpeg found inside the app is reported as the one that came with it", async () => {
  const inspect = async (paths: { ffmpeg: string | null }) =>
    ({ ffmpeg: paths.ffmpeg ? { path: paths.ffmpeg, version: "8.1.2", missing: [] } : null, ffprobe: null, whisper: null, claude: null }) satisfies ToolReport
  const inside = createToolbox({
    find: (name) => `/Applications/BOXBLACK.app/Contents/Resources/bin/${name}`,
    inspect,
    bundledDirs: ["/Applications/BOXBLACK.app/Contents/Resources/bin"],
  })
  expect((await inside.report()).ffmpeg?.bundled).toBe(true)

  // a Homebrew one, in a development run with nothing bundled, is the customer's own
  const outside = createToolbox({ find: (name) => `/opt/homebrew/bin/${name}`, inspect, bundledDirs: ["/Applications/BOXBLACK.app/Contents/Resources/bin"] })
  expect((await outside.report()).ffmpeg?.bundled).toBe(false)
})

test("a whisper-cli from BOXBLACK's own tap is reported as the tested one, Homebrew's own is not", async () => {
  const inspect = async (paths: { whisper: string | null }) =>
    ({ ffmpeg: null, ffprobe: null, whisper: paths.whisper ? { path: paths.whisper, usable: true } : null, claude: null }) satisfies ToolReport
  const pinnedDirs = ["/opt/homebrew/opt/boxblack-whisper/bin"]
  const ours = createToolbox({ find: (name) => `/opt/homebrew/opt/boxblack-whisper/bin/${name}`, inspect, pinnedDirs })
  expect((await ours.report()).whisper?.pinned).toBe(true)
  const theirs = createToolbox({ find: (name) => `/opt/homebrew/bin/${name}`, inspect, pinnedDirs })
  expect((await theirs.report()).whisper?.pinned).toBe(false)
})

test("a whisper-cli inside the app is the one that came with it, and so the tested one", async () => {
  const inspect = async (paths: { whisper: string | null }) =>
    ({ ffmpeg: null, ffprobe: null, whisper: paths.whisper ? { path: paths.whisper, usable: true } : null, claude: null }) satisfies ToolReport
  const inside = createToolbox({
    find: (name) => `/Applications/BOXBLACK.app/Contents/Resources/bin/${name}`,
    inspect,
    bundledDirs: ["/Applications/BOXBLACK.app/Contents/Resources/bin"],
    pinnedDirs: ["/opt/homebrew/opt/boxblack-whisper/bin"],
  })
  expect((await inside.report()).whisper).toMatchObject({ bundled: true, pinned: true })
})

test("each rescan is told once the tools are found again, the first look at start is not: what was missing may be there now", async () => {
  let installed = new Set<string>()
  const told: (string | null)[] = []
  const toolbox = createToolbox({
    find: (name) => (installed.has(name) ? `/opt/homebrew/bin/${name}` : null),
    inspect: async () => ({ ffmpeg: null, ffprobe: null, whisper: null, claude: null }) satisfies ToolReport,
    rescanned: () => void told.push(toolbox.paths.ffmpeg),
  })
  await toolbox.report()
  expect(told).toEqual([])
  installed = new Set(["ffmpeg"])
  await toolbox.rescan()
  expect(told).toEqual(["/opt/homebrew/bin/ffmpeg"])
})
