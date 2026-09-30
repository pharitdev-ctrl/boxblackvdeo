import { expect, test } from "vitest"
import type { MessageKey } from "../i18n.ts"
import type { RoomRead } from "../room/ClipRoom.tsx"
import { FAILED_READ_WORDS, writeHold, type HoldInput } from "./writeHold.ts"

const ready = (): HoldInput => ({
  capcutRunning: false, writeKnown: true,
  failed: { settings: false, cut: false, preview: false, lines: false },
  rules: {} as HoldInput["rules"], highlights: {} as HoldInput["highlights"], flair: {} as HoldInput["flair"],
  plan: {} as HoldInput["plan"], empty: false, run: { running: false, states: {} },
  placing: false, deciding: false, editing: false, preview: {} as HoldInput["preview"], subtitlesOn: false, lines: null,
})

/** The failed flags with these reads, and only these, failed. */
const failedOnly = (...reads: RoomRead[]): HoldInput["failed"] => ({
  settings: reads.includes("settings"),
  cut: reads.includes("cut"),
  preview: reads.includes("preview"),
  lines: reads.includes("lines"),
})

/**
 * What each read that failed really leaves in the room: what it could not read is not there. A hold that
 * would say something else about that gap (a cut still worked out, groups still placed) sits further
 * down the order, so each of these proves the failure is said before it.
 */
const failedStates: Record<RoomRead, () => HoldInput> = {
  settings: () => ({ ...ready(), failed: failedOnly("settings"), rules: null, highlights: null, flair: null, plan: null, preview: null }),
  cut: () => ({ ...ready(), failed: failedOnly("cut"), plan: null }),
  preview: () => ({ ...ready(), failed: failedOnly("preview"), preview: null }),
  lines: () => ({ ...ready(), failed: failedOnly("lines"), subtitlesOn: true, lines: null }),
}

test("a room with everything in holds nothing", () => expect(writeHold(ready())).toBe(null))
test("CapCut open holds first, before anything else", () =>
  expect(writeHold({ ...ready(), capcutRunning: true, writeKnown: false, plan: null })).toBe("write.check.capcutOpen"))
test("CapCut not known yet", () => expect(writeHold({ ...ready(), capcutRunning: null })).toBe("write.check.capcutUnknown"))
test("a write in the draft not known yet", () => expect(writeHold({ ...ready(), writeKnown: false })).toBe("write.check.writeKnown"))
test("settings that failed to read, with nothing they feed in the room", () => expect(writeHold(failedStates.settings())).toBe("write.check.settingsFailed"))
test("settings not read yet wait as placing", () => expect(writeHold({ ...ready(), flair: null })).toBe("write.check.placing"))
test("the cut rules not read yet wait as placing, on their own", () => expect(writeHold({ ...ready(), rules: null })).toBe("write.check.placing"))
test("the highlight settings not read yet wait as placing, on their own", () => expect(writeHold({ ...ready(), highlights: null })).toBe("write.check.placing"))
test("a cut that failed, with none on screen", () => expect(writeHold(failedStates.cut())).toBe("write.check.cutFailed"))
test("a cut worked out again that failed, with the cut before it still on screen", () => expect(writeHold({ ...ready(), failed: failedOnly("cut") })).toBe("write.check.cutFailed"))
test("a cut still worked out", () => expect(writeHold({ ...ready(), plan: null })).toBe("write.check.cutting"))
test("a cut with nothing left", () => expect(writeHold({ ...ready(), empty: true })).toBe("write.check.cutEmpty"))
test("a plan run going", () => expect(writeHold({ ...ready(), run: { running: true, states: {} } })).toBe("write.check.planning"))
test("a placement that failed, even with no preview on screen", () => expect(writeHold(failedStates.preview())).toBe("write.check.previewFailed"))
test("a placement read again that failed, with the preview before it still on screen", () => expect(writeHold({ ...ready(), failed: failedOnly("preview") })).toBe("write.check.previewFailed"))
test("subtitle lines that failed, with subtitles on and no lines", () => expect(writeHold(failedStates.lines())).toBe("write.check.linesFailed"))
test("each failed read is held with the words FAILED_READ_WORDS gives it", () => {
  for (const read of Object.keys(FAILED_READ_WORDS) as RoomRead[]) expect(writeHold(failedStates[read]()), read).toBe(FAILED_READ_WORDS[read])
  expect(Object.keys(FAILED_READ_WORDS).sort()).toEqual(Object.keys(failedStates).sort())
})
test("placing again", () => expect(writeHold({ ...ready(), placing: true })).toBe("write.check.placing"))
test("no preview yet", () => expect(writeHold({ ...ready(), preview: null })).toBe("write.check.placing"))
test("subtitles on and their lines not read yet", () => expect(writeHold({ ...ready(), subtitlesOn: true })).toBe("write.check.placing"))
test("subtitles off need no lines", () => expect(writeHold({ ...ready(), subtitlesOn: false, lines: null })).toBe(null))
test("a cut decision being saved", () => expect(writeHold({ ...ready(), deciding: true })).toBe("write.check.placing"))
test("a change to the text or the points being saved", () => expect(writeHold({ ...ready(), editing: true })).toBe("write.check.placing"))
test("a decision and a change that are not being saved hold nothing", () => expect(writeHold({ ...ready(), deciding: false, editing: false })).toBe(null))

test("with every hold at once, each is said in turn as the one before it clears, and nothing is held when the last is gone", () => {
  const there = ready()
  let room: HoldInput = {
    capcutRunning: true, writeKnown: false,
    failed: failedOnly("settings", "cut", "preview", "lines"),
    rules: null, highlights: null, flair: null,
    plan: null, empty: true, run: { running: true, states: {} },
    placing: true, deciding: true, editing: true, preview: null, subtitlesOn: true, lines: null,
  }
  // what clears at each step, and what is said next: spec §14 "0.4.4" order, then the holds that share the words of placing
  const steps: [cleared: string, patch: Partial<HoldInput>, next: MessageKey | null][] = [
    ["CapCut open, now not known", { capcutRunning: null }, "write.check.capcutUnknown"],
    ["CapCut known to be closed", { capcutRunning: false }, "write.check.writeKnown"],
    ["a write in the draft known", { writeKnown: true }, "write.check.settingsFailed"],
    ["settings failed", { failed: failedOnly("cut", "preview", "lines") }, "write.check.cutFailed"],
    ["cut failed", { failed: failedOnly("preview", "lines") }, "write.check.cutting"],
    ["cut worked out", { plan: there.plan }, "write.check.cutEmpty"],
    ["cut empty", { empty: false }, "write.check.planning"],
    ["plan run over", { run: there.run }, "write.check.previewFailed"],
    ["placement failed", { failed: failedOnly("lines") }, "write.check.linesFailed"],
    ["lines failed", { failed: failedOnly() }, "write.check.placing"],
    ["placing over", { placing: false }, "write.check.placing"],
    ["preview there", { preview: there.preview }, "write.check.placing"],
    ["lines there", { lines: [] }, "write.check.placing"],
    ["rules there", { rules: there.rules }, "write.check.placing"],
    ["highlights there", { highlights: there.highlights }, "write.check.placing"],
    ["flair there", { flair: there.flair }, "write.check.placing"],
    ["decision saved", { deciding: false }, "write.check.placing"],
    ["change saved", { editing: false }, null],
  ]
  expect(writeHold(room)).toBe("write.check.capcutOpen")
  for (const [cleared, patch, next] of steps) {
    room = { ...room, ...patch }
    expect(writeHold(room), `after ${cleared}`).toBe(next)
  }
})
