import { expect, test } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import { createTimelineApi } from "./timeline-api.ts"
import type { TimelineService } from "./timeline.ts"

test("timeline requests go to the timeline service", async () => {
  const calls: unknown[][] = []
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
      return null
    }
  const timeline = {
    preview: record("preview"),
    write: record("write"),
    backups: record("backups"),
    restore: record("restore"),
    subtitles: record("subtitles"),
    decide: record("decide"),
  } as unknown as TimelineService
  const api = createTimelineApi({ timeline })

  await api.previewCut("/p", DEFAULT_CUT_RULES)
  await api.writeTimeline("/p", DEFAULT_CUT_RULES, 3, null, null)
  await api.writeTimeline("/p", DEFAULT_CUT_RULES, 3, { length: "short", texts: ["สวัสดี", ""] }, { position: "bottom", hideSubtitles: true, highlightsOn: false, groupCount: 2, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: true } })
  await api.listBackups("/p")
  await api.restoreBackup("/p", "0917-2026")
  await api.previewSubtitles("/p", DEFAULT_CUT_RULES, "line", true)
  await api.previewSubtitles("/p", DEFAULT_CUT_RULES, "short", "yes" as never)
  await api.setCutDecision("/p", "v", { type: "pause", after: 3, keep: null })

  expect(calls).toEqual([
    ["preview", "/p", DEFAULT_CUT_RULES],
    ["write", "/p", DEFAULT_CUT_RULES, 3, null, null],
    ["write", "/p", DEFAULT_CUT_RULES, 3, { length: "short", texts: ["สวัสดี", ""] }, { position: "bottom", hideSubtitles: true, highlightsOn: false, groupCount: 2, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: true } }],
    ["backups", "/p"],
    ["restore", "/p", "0917-2026"],
    ["subtitles", "/p", DEFAULT_CUT_RULES, "line", true],
    ["subtitles", "/p", DEFAULT_CUT_RULES, "short", false],
    ["decide", "/p", "v", { type: "pause", after: 3, keep: null }],
  ])
})

test("whether a write is running is asked of the timeline service, for a folder named by text alone", async () => {
  const asked: unknown[] = []
  const timeline = {
    writing: (folder: string) => {
      asked.push(folder)
      return folder === "/p"
    },
  } as unknown as TimelineService
  const api = createTimelineApi({ timeline })
  expect(await api.writingTimeline("/p")).toBe(true)
  expect(await api.writingTimeline("/q")).toBe(false)
  expect(await api.writingTimeline({ toString: () => "/p" } as never)).toBe(false)
  expect(asked).toEqual(["/p", "/q"])
})

test("expected segment counts that are not whole numbers are refused", async () => {
  const timeline = { write: async () => null } as unknown as TimelineService
  const api = createTimelineApi({ timeline })
  await expect(api.writeTimeline("/p", DEFAULT_CUT_RULES, -1, null, null)).rejects.toThrow(/segment count/)
  await expect(api.writeTimeline("/p", DEFAULT_CUT_RULES, "2" as never, null, null)).rejects.toThrow(/segment count/)
})

test("cut rules the app does not know are refused", async () => {
  const timeline = { preview: async () => null, write: async () => null } as unknown as TimelineService
  const api = createTimelineApi({ timeline })
  await expect(api.previewCut("/p", { ...DEFAULT_CUT_RULES, preset: "extreme" as never })).rejects.toThrow(/cut rules/)
  await expect(api.writeTimeline("/p", { ...DEFAULT_CUT_RULES, cutFillers: "yes" as never }, 0, null, null)).rejects.toThrow(/cut rules/)
})

test("subtitle requests the app did not make are refused", async () => {
  const timeline = { subtitles: async () => null, write: async () => null } as unknown as TimelineService
  const api = createTimelineApi({ timeline })
  await expect(api.previewSubtitles("/p", DEFAULT_CUT_RULES, "paragraph" as never, false)).rejects.toThrow(/subtitle length/)
  for (const subtitles of [{ length: "huge", texts: [] }, { length: "line", texts: "สวัสดี" }, { length: "line", texts: [1] }, "yes"]) {
    await expect(api.writeTimeline("/p", DEFAULT_CUT_RULES, 0, subtitles as never, null), JSON.stringify(subtitles)).rejects.toThrow(/subtitles/)
  }
  await expect(api.writeTimeline("/p", DEFAULT_CUT_RULES, 0, { length: "line", texts: ["x".repeat(501)] }, null)).rejects.toThrow(/subtitles/)
})

test("cut decisions the app did not make are refused", async () => {
  const api = createTimelineApi({ timeline: { decide: async () => null } as unknown as TimelineService })
  const bad = [
    null,
    { type: "words", indexes: [1.5], keep: true },
    { type: "words", indexes: "1", keep: true },
    { type: "words", indexes: [1], keep: "yes" },
    { type: "pause", after: "3", keep: true },
    { type: "problems", ranges: [{ startUs: "1", endUs: 2 }], keep: true },
    { type: "pieces", ranges: {}, keep: false },
    { type: "everything", keep: true },
  ]
  for (const change of bad) await expect(api.setCutDecision("/p", "v", change as never), JSON.stringify(change)).rejects.toThrow(/cut decision/)
})

test("highlight text requests the app did not make are refused", async () => {
  const api = createTimelineApi({ timeline: { write: async () => null } as unknown as TimelineService })
  const bad = [
    "yes",
    { position: "left", hideSubtitles: true, groupCount: 1 },
    { position: "top", hideSubtitles: "yes", groupCount: 1 },
    { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: 1.5, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } },
    { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: -1, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } },
    // the graphics switch is part of what the preview was shown with
    { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: 1, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true } },
    { position: "top", hideSubtitles: true, highlightsOn: true, groupCount: 1, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: "yes" } },
    // whether highlight text is on is part of what the preview was shown with
    { position: "top", hideSubtitles: true, groupCount: 1, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } },
    { position: "top", hideSubtitles: true, highlightsOn: "yes", groupCount: 1, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } },
  ]
  for (const highlights of bad) {
    await expect(api.writeTimeline("/p", DEFAULT_CUT_RULES, 0, null, highlights as never), JSON.stringify(highlights)).rejects.toThrow(/highlight text/)
  }
})

test("a subtitle line's text goes to the timeline service by its key; bad requests are refused", async () => {
  const calls: unknown[][] = []
  const timeline = { setSubtitleText: async (...args: unknown[]) => void calls.push(args) } as unknown as TimelineService
  const api = createTimelineApi({ timeline })
  await api.setSubtitleText("/p", "a:1:2:สวัสดี", "สวัสดีครับ")
  await api.setSubtitleText("/p", "a:1:2:สวัสดี", "")
  const longest = `a:${"k".repeat(998)}`
  await api.setSubtitleText("/p", longest, null)
  const bad = [
    [3, "a:1", "x"],
    ["/p", "", "x"],
    ["/p", `${longest}k`, "x"],
    ["/p", 3, "x"],
    // every key a line gets holds ":" between its video, times and text
    ["/p", "k", "x"],
    ["/p", "a:1", 3],
    ["/p", "a:1", "x".repeat(501)],
    ["/p", "a:1", undefined],
  ]
  for (const [folder, key, text] of bad) {
    await expect(api.setSubtitleText(folder as never, key as never, text as never), JSON.stringify([folder, key, text])).rejects.toThrow(/subtitle text request/)
  }
  expect(calls).toEqual([
    ["/p", "a:1:2:สวัสดี", "สวัสดีครับ"],
    ["/p", "a:1:2:สวัสดี", ""],
    ["/p", longest, null],
  ])
})
