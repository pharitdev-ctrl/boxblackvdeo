import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { inspectTools } from "@boxblack/core/media"
import { PINNED_WHISPER_VERSION } from "../shared/whisper-tap.ts"

/**
 * The whisper-cli the app ships (Resources/bin), built by scripts/build-whisper.sh. Its output
 * was checked word for word against Homebrew's whisper-cpp 1.9.2 on real footage when it was
 * first built; what can be checked every run is that it is that build, whole and runnable.
 */
const BIN = join(import.meta.dirname, "../../resources/bin")
const whisper = join(BIN, "whisper-cli")

describe.skipIf(!existsSync(whisper))("the whisper-cli that ships with the app", () => {
  test("is the pinned release, and says where it came from", () => {
    const notice = readFileSync(join(BIN, "WHISPER-NOTICE.txt"), "utf8")
    expect(notice).toContain(`whisper.cpp ${PINNED_WHISPER_VERSION} `)
    expect(readFileSync(join(BIN, "WHISPER-LICENSE"), "utf8")).toMatch(/MIT License/)
  })

  test("computes the DTW word timings the transcripts rely on", async () => {
    const report = await inspectTools({ ffmpeg: null, ffprobe: null, whisper, claude: null })
    expect(report.whisper).toEqual({ path: whisper, usable: true })
  })

  test("needs nothing from Homebrew, and runs on the oldest macOS the app supports", () => {
    const linked = execFileSync("otool", ["-L", whisper], { encoding: "utf8" }).split("\n").slice(1).map((line) => line.trim()).filter(Boolean)
    for (const library of linked) expect(library).toMatch(/^\/(usr\/lib|System\/Library)\//)
    const load = execFileSync("otool", ["-l", whisper], { encoding: "utf8" })
    expect(/minos (\S+)/.exec(load)?.[1]).toBe("12.0")
  })
})
