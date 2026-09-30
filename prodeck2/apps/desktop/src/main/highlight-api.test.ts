import { expect, test } from "vitest"
import { DEFAULT_CUT_RULES } from "@boxblack/core/cut/rules"
import { createHighlightApi } from "./highlight-api.ts"
import type { EmphasisService } from "./emphasis.ts"
import type { FlairService } from "./flair.ts"
import type { HighlightService } from "./highlights.ts"
import type { PostPlanService } from "./post-plan.ts"

function recorder() {
  const calls: unknown[][] = []
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
      return null
    }
  const highlights = {
    preview: record("preview"),
    pick: record("pick"),
    setStyle: record("setStyle"),
    editLine: record("editLine"),
    removeGroup: record("removeGroup"),
    addFromWords: record("addFromWords"),
  } as unknown as HighlightService
  const flair = {
    setLook: record("setLook"),
    setCue: record("setCue"),
    setZoom: record("setZoom"),
    setInsert: record("setInsert"),
    setPointPicture: record("setPointPicture"),
    setGraphic: record("setGraphic"),
    retryGraphic: record("retryGraphic"),
  } as unknown as FlairService
  const emphasis = { plan: record("emphasis.plan"), setPoint: record("emphasis.setPoint"), addPoint: record("emphasis.addPoint") } as unknown as EmphasisService
  const post = {
    plan: record("planPost"),
    rethink: record("rethink"),
    emphasisOnly: record("emphasisOnly"),
    state: record("state"),
  } as unknown as PostPlanService
  return { calls, api: createHighlightApi({ highlights, flair, emphasis, post }) }
}

test("highlight text requests go to the highlight service", async () => {
  const { calls, api } = recorder()
  await api.previewHighlights("/p", DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: true, highlightsOn: true, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } })
  await api.setHighlightStyle("/p", "cute-pink")
  await api.setHighlightStyle("/p", "custom")
  await api.editHighlightLine("/p", "g1", 2, "ราคา 299")
  await api.editHighlightLine("/p", "g1", 0, null)
  await api.removeHighlightGroup("/p", "g2")
  await api.addHighlightGroup("/p", "v1", [3, 4], 18)
  await api.addHighlightGroup("/p", "v1", [5], 12, "b2")
  await api.addHighlightGroup("/p", "v1", [6], 12, "b2", "p1")
  expect(calls).toEqual([
    ["preview", "/p", DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: true, highlightsOn: true, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } }],
    ["setStyle", "/p", "cute-pink"],
    ["setStyle", "/p", "custom"],
    ["editLine", "/p", "g1", 2, "ราคา 299"],
    ["editLine", "/p", "g1", 0, null],
    ["removeGroup", "/p", "g2"],
    ["addFromWords", "/p", "v1", [3, 4], 18, undefined, undefined],
    ["addFromWords", "/p", "v1", [5], 12, "b2", undefined],
    ["addFromWords", "/p", "v1", [6], 12, "b2", "p1"],
  ])
})

test("requests the app did not make are refused before they reach the service", async () => {
  const { calls, api } = recorder()
  const options = { position: "auto" as const, subtitlesOn: true, highlightsOn: true, flair: { enabled: false, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } }
  await expect(api.previewHighlights("/p", { ...DEFAULT_CUT_RULES, preset: "wild" as never }, options)).rejects.toThrow(/cut rules/)
  for (const bad of [null, { position: "left", subtitlesOn: true }, { position: "auto", subtitlesOn: "yes" }]) {
    await expect(api.previewHighlights("/p", DEFAULT_CUT_RULES, bad as never), JSON.stringify(bad)).rejects.toThrow(/highlight text request/)
  }
  await expect(api.setHighlightStyle("/p", "neon" as never)).rejects.toThrow(/highlight text request/)
  for (const [groupId, index, text] of [[1, 0, "x"], ["g", 0.5, "x"], ["g", 0, 3], ["g", 0, "x".repeat(101)]]) {
    await expect(api.editHighlightLine("/p", groupId as never, index as never, text as never)).rejects.toThrow(/highlight text request/)
  }
  await expect(api.removeHighlightGroup("/p", {} as never)).rejects.toThrow(/highlight text request/)
  for (const [videoId, indexes, maxChars] of [[1, [1], 12], ["v", "1", 12], ["v", [1.5], 12], ["v", [1], "12"], ["v", Array.from({ length: 10_001 }, () => 1), 12]]) {
    await expect(api.addHighlightGroup("/p", videoId as never, indexes as never, maxChars as never)).rejects.toThrow(/highlight text request/)
  }
  for (const beatId of [3, {}, "x".repeat(201)]) {
    await expect(api.addHighlightGroup("/p", "v", [1], 12, beatId as never)).rejects.toThrow(/highlight text request/)
  }
  // the point the text is made for
  for (const pointId of [3, "", "x".repeat(201)]) {
    await expect(api.addHighlightGroup("/p", "v", [1], 12, "b1", pointId as never)).rejects.toThrow(/highlight text request/)
  }
  expect(calls).toEqual([])
})

test("the flair requests go to the flair service, and a bad one is refused", async () => {
  const { calls, api } = recorder()
  await api.setFlairLook("/p", "g1", { pattern: "bar", accent: { line: 1, word: "299" }, exit: null })
  await api.setFlairLook("/p", "g1", { tone: "alt" })
  await api.setFlairLook("/p", "g1", { accent: { line: 0, lineIndex: 1, word: "299" } })
  expect(calls).toEqual([
    ["setLook", "/p", "g1", { pattern: "bar", accent: { line: 1, word: "299" }, exit: null }],
    ["setLook", "/p", "g1", { tone: "alt" }],
    ["setLook", "/p", "g1", { accent: { line: 0, lineIndex: 1, word: "299" } }],
  ])

  const bad = [
    () => api.setFlairLook("/p", "g1", { accent: { line: 1.5, word: "299" } }),
    () => api.setFlairLook("/p", "g1", { accent: { line: 0, lineIndex: "1" as never, word: "299" } }),
    () => api.setFlairLook("/p", "g1", { accent: { line: 0, word: "x".repeat(200) } }),
    () => api.setFlairLook("/p", 7 as never, { pattern: "bar" }),
    () => api.setFlairLook("/p", "g1", { exit: "x".repeat(200) }),
    () => api.setFlairLook("/p", "g1", { tone: "neon" as never }),
  ]
  for (const call of bad) await expect(call()).rejects.toThrow(/unknown highlight text request/)
  // only the three good calls got through
  expect(calls).toHaveLength(3)
})

test("a patch says nothing about what it leaves out", async () => {
  const { calls, api } = recorder()
  await api.setFlairLook("/p", "g1", { pattern: "stair" })
  await api.setFlairLook("/p", "g1", { exit: null })
  expect(calls.map((call) => Object.keys(call[3] as object))).toEqual([["pattern"], ["exit"]])
  expect(calls[0]).toEqual(["setLook", "/p", "g1", { pattern: "stair" }])
})

test("a zoom request goes to the flair service, with only the anchor's own fields", async () => {
  const { calls, api } = recorder()
  await api.setZoom("/p", { videoId: "v1", sourceUs: 4_000_000, extra: "nope" } as never, "punch")
  await api.setZoom("/p", { videoId: "v1", sourceUs: 0 }, null)
  await api.setZoom("/p", { videoId: "v1", sourceUs: 0, beatId: "b2" }, "drift")
  expect(calls).toEqual([
    ["setZoom", "/p", { videoId: "v1", sourceUs: 4_000_000 }, "punch"],
    ["setZoom", "/p", { videoId: "v1", sourceUs: 0 }, null],
    ["setZoom", "/p", { videoId: "v1", sourceUs: 0, beatId: "b2" }, "drift"],
  ])

  const bad = [
    () => api.setZoom("/p", { videoId: "v1", sourceUs: 1.5 }, "punch"),
    () => api.setZoom("/p", { videoId: 7, sourceUs: 0 } as never, "punch"),
    () => api.setZoom("/p", null as never, "punch"),
    () => api.setZoom("/p", { videoId: "v1", sourceUs: 0 }, "swoop" as never),
    () => api.setZoom("/p", { videoId: "v1", sourceUs: 0, beatId: 7 } as never, "punch"),
    () => api.setZoom("/p", { videoId: "v1", sourceUs: 0, beatId: "" }, "punch"),
  ]
  for (const call of bad) await expect(call()).rejects.toThrow(/unknown highlight text request/)
  expect(calls).toHaveLength(3)
})

test("a cutaway request goes to the flair service, with only the anchor's own fields", async () => {
  const { calls, api } = recorder()
  await api.setInsert("/p", { kind: "highlight", groupId: "g1", line: 0, extra: "nope" } as never, "m1")
  await api.setInsert("/p", { kind: "beat", beatId: "b1", edge: "end" }, null)
  await api.setInsert("/p", { kind: "speech", videoId: "v1", sourceUs: 18_080_000, extra: "nope" } as never, "m2")
  await api.setInsert("/p", { kind: "speech", videoId: "v1", sourceUs: 18_080_000 }, "m2", "card")
  await api.setInsert("/p", { kind: "speech", videoId: "v1", sourceUs: 18_080_000, beatId: "b2" }, "m2")
  await api.setInsert("/p", { kind: "beat", beatId: "b1", edge: "start" }, null, undefined, "m1")
  await api.setSoundCue("/p", { kind: "cut", videoId: "v1", sourceUs: 9_000_000, beatId: "b1", extra: 1 } as never, "s1")
  expect(calls).toEqual([
    ["setInsert", "/p", { kind: "highlight", groupId: "g1", line: 0 }, "m1", undefined, undefined],
    ["setInsert", "/p", { kind: "beat", beatId: "b1", edge: "end" }, null, undefined, undefined],
    ["setInsert", "/p", { kind: "speech", videoId: "v1", sourceUs: 18_080_000 }, "m2", undefined, undefined],
    ["setInsert", "/p", { kind: "speech", videoId: "v1", sourceUs: 18_080_000 }, "m2", "card", undefined],
    ["setInsert", "/p", { kind: "speech", videoId: "v1", sourceUs: 18_080_000, beatId: "b2" }, "m2", undefined, undefined],
    ["setInsert", "/p", { kind: "beat", beatId: "b1", edge: "start" }, null, undefined, "m1"],
    ["setCue", "/p", { kind: "cut", videoId: "v1", sourceUs: 9_000_000, beatId: "b1" }, "s1"],
  ])

  const bad = [
    () => api.setInsert("/p", { kind: "beat", beatId: "b1", edge: "middle" } as never, "m1"),
    () => api.setInsert("/p", { kind: "highlight", groupId: "g1", line: 1.5 } as never, "m1"),
    () => api.setInsert("/p", { kind: "speech", videoId: "v1", sourceUs: -1 } as never, "m1"),
    () => api.setInsert("/p", { kind: "speech", videoId: "v1", sourceUs: 1.5 } as never, "m1"),
    () => api.setInsert("/p", { kind: "speech", videoId: 7, sourceUs: 1 } as never, "m1"),
    () => api.setInsert("/p", { kind: "speech", videoId: "v1", sourceUs: 1, beatId: 7 } as never, "m1"),
    () => api.setInsert("/p", { kind: "cut", videoId: "v1", sourceUs: 1, beatId: "x".repeat(300) } as never, "m1"),
    () => api.setInsert("/p", null as never, "m1"),
    () => api.setInsert("/p", { kind: "beat", beatId: "b1", edge: "end" }, "x".repeat(200)),
    () => api.setInsert("/p", { kind: "beat", beatId: "b1", edge: "end" }, "m1", "huge" as never),
    // the picture of the one cutaway changed, when several sit at the place
    () => api.setInsert("/p", { kind: "beat", beatId: "b1", edge: "start" }, null, undefined, 7 as never),
    () => api.setInsert("/p", { kind: "beat", beatId: "b1", edge: "start" }, null, undefined, "x".repeat(200)),
  ]
  for (const call of bad) await expect(call()).rejects.toThrow(/unknown highlight text request/)
  expect(calls).toHaveLength(7)
})

test("the graphics being on or off is part of every request, and anything but a yes or no is refused", async () => {
  const { calls, api } = recorder()
  const flair = { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: true }
  await api.previewHighlights("/p", DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair })
  expect(calls).toEqual([["preview", "/p", DEFAULT_CUT_RULES, { position: "auto", subtitlesOn: false, highlightsOn: true, flair }]])
  for (const graphic of [undefined, "yes", 1, null]) {
    const options = { position: "auto" as const, subtitlesOn: false, highlightsOn: true, flair: { ...flair, graphic } }
    await expect(api.previewHighlights("/p", DEFAULT_CUT_RULES, options as never), String(graphic)).rejects.toThrow(/unknown highlight text request/)
  }
  expect(calls).toHaveLength(1)
})

test("a picture for a point goes to the flair service with the cut rules checked, and a bad one is refused", async () => {
  const { calls, api } = recorder()
  await api.setPointPicture("/p", { ...DEFAULT_CUT_RULES, extra: 1 } as never, "p1", "m1")
  await api.setPointPicture("/p", DEFAULT_CUT_RULES, "p1", "m2", "card")
  await api.setPointPicture("/p", DEFAULT_CUT_RULES, "p1", null)
  expect(calls).toEqual([
    ["setPointPicture", "/p", DEFAULT_CUT_RULES, "p1", "m1", undefined],
    ["setPointPicture", "/p", DEFAULT_CUT_RULES, "p1", "m2", "card"],
    ["setPointPicture", "/p", DEFAULT_CUT_RULES, "p1", null, undefined],
  ])
  const bad = [
    () => api.setPointPicture("/p", { ...DEFAULT_CUT_RULES, preset: "wild" } as never, "p1", "m1"),
    () => api.setPointPicture("/p", DEFAULT_CUT_RULES, "", "m1"),
    () => api.setPointPicture("/p", DEFAULT_CUT_RULES, 7 as never, "m1"),
    () => api.setPointPicture("/p", DEFAULT_CUT_RULES, "x".repeat(201), "m1"),
    () => api.setPointPicture("/p", DEFAULT_CUT_RULES, "p1", 3 as never),
    () => api.setPointPicture("/p", DEFAULT_CUT_RULES, "p1", "x".repeat(200)),
    () => api.setPointPicture("/p", DEFAULT_CUT_RULES, "p1", "m1", "huge" as never),
  ]
  for (const call of bad) await expect(call()).rejects.toThrow(/unknown highlight text request|unknown cut rules/)
  expect(calls).toHaveLength(3)
})

const VIEW = { position: "auto" as const, subtitlesOn: true, highlightsOn: true, flair: { enabled: true, level: "medium" as const, text: true, sound: true, zoom: true, insert: true, graphic: false } }
const POST_REQUEST = { rules: DEFAULT_CUT_RULES, view: VIEW, subtitles: { length: "short" as const, polish: true, hideUnderHighlights: false } }

test("the plan run's requests go to the run with only the fields the screen may send, and a bad one is refused", async () => {
  const calls: unknown[][] = []
  const post = {
    plan: async (...args: unknown[]) => (calls.push(["plan", ...args]), { running: false, states: {} }),
    rethink: async (...args: unknown[]) => (calls.push(["rethink", ...args]), { running: false, states: {} }),
    emphasisOnly: async (...args: unknown[]) => (calls.push(["emphasisOnly", ...args]), { count: 2, dropped: 0 }),
    state: (...args: unknown[]) => (calls.push(["state", ...args]), null),
  } as unknown as PostPlanService
  const api = createHighlightApi({ highlights: {} as HighlightService, flair: {} as FlairService, emphasis: {} as EmphasisService, post })
  await api.planPost("/p", { ...POST_REQUEST, extra: 1, subtitles: { ...POST_REQUEST.subtitles, extra: 1 } } as never)
  await api.rethinkPost("/p", "sounds", { ...POST_REQUEST, subtitles: null })
  expect(await api.postPlanState("/p")).toBeNull()
  expect(await api.planEmphasis("/p", DEFAULT_CUT_RULES)).toEqual({ count: 2, dropped: 0 })
  expect(calls).toEqual([
    ["plan", "/p", POST_REQUEST],
    ["rethink", "/p", "sounds", { ...POST_REQUEST, subtitles: null }],
    ["state", "/p"],
    ["emphasisOnly", "/p", DEFAULT_CUT_RULES],
  ])

  const bad = [
    () => api.planPost("/p", { ...POST_REQUEST, subtitles: { ...POST_REQUEST.subtitles, length: "long" } } as never),
    () => api.planPost("/p", { ...POST_REQUEST, subtitles: { ...POST_REQUEST.subtitles, polish: "yes" } } as never),
    () => api.planPost("/p", { ...POST_REQUEST, subtitles: undefined } as never),
    () => api.planPost("/p", { ...POST_REQUEST, view: { ...VIEW, highlightsOn: "yes" } } as never),
    () => api.planPost("/p", { ...POST_REQUEST, rules: null } as never),
    () => api.planPost("/p", null as never),
    () => api.rethinkPost("/p", "emphasis" as never, POST_REQUEST),
    () => api.postPlanState(3 as never),
  ]
  for (const call of bad) await expect(call()).rejects.toThrow(/unknown highlight text request|unknown cut rules/)
  expect(calls).toHaveLength(4)
})

test("a plan run's project must be named: an empty or missing folder is refused before the run", async () => {
  const calls: unknown[][] = []
  const post = {
    plan: async (...args: unknown[]) => (calls.push(["plan", ...args]), { running: false, states: {} }),
    rethink: async (...args: unknown[]) => (calls.push(["rethink", ...args]), { running: false, states: {} }),
    state: (...args: unknown[]) => (calls.push(["state", ...args]), null),
  } as unknown as PostPlanService
  const api = createHighlightApi({ highlights: {} as HighlightService, flair: {} as FlairService, emphasis: {} as EmphasisService, post })
  for (const folder of ["", 3, null]) {
    await expect(api.planPost(folder as never, POST_REQUEST), String(folder)).rejects.toThrow(/unknown highlight text request/)
    await expect(api.rethinkPost(folder as never, "sounds", POST_REQUEST), String(folder)).rejects.toThrow(/unknown highlight text request/)
    await expect(api.postPlanState(folder as never), String(folder)).rejects.toThrow(/unknown highlight text request/)
  }
  expect(calls).toEqual([])
})

const SPEECH = { kind: "speech" as const, videoId: "v1", sourceUs: 18_080_000, beatId: "b1" }

test("a graphic request goes to the flair service with only the field the screen may send: switched off or on", async () => {
  const { calls, api } = recorder()
  await api.setGraphic("/p", { ...SPEECH, extra: 1 } as never, { off: true, extra: 1 } as never)
  await api.setGraphic("/p", SPEECH, null)
  await api.setGraphic("/p", SPEECH, {})
  // Claude draws a graphic, so nothing else of it is changed by hand: a length, pieces, an emoji or a motion are no fields of a change
  await api.setGraphic("/p", SPEECH, { off: false, seconds: 3.5, emoji: "🚀", motion: "float", pieces: { 0: { text: "ราคา", from: 0, to: 99.5, unit: "บาท" } } } as never)
  await api.setGraphic("/p", SPEECH, { seconds: "3", pieces: "a" } as never)
  await api.retryGraphic("/p", { ...SPEECH, extra: 1 } as never)
  expect(calls).toEqual([
    ["setGraphic", "/p", SPEECH, { off: true }],
    ["setGraphic", "/p", SPEECH, null],
    ["setGraphic", "/p", SPEECH, {}],
    ["setGraphic", "/p", SPEECH, { off: false }],
    ["setGraphic", "/p", SPEECH, {}],
    ["retryGraphic", "/p", SPEECH],
  ])
})

test("a graphic change the screen could not have made is refused before it reaches the flair service", async () => {
  const { calls, api } = recorder()
  const patches = ["off", 3, [], undefined, { off: "yes" }, { off: null }, { off: 1 }]
  for (const patch of patches) await expect(api.setGraphic("/p", SPEECH, patch as never), JSON.stringify(patch)).rejects.toThrow(/unknown highlight text request/)
  for (const anchor of [null, "a", { ...SPEECH, sourceUs: 1.5 }, { ...SPEECH, videoId: 7 }]) {
    await expect(api.setGraphic("/p", anchor as never, { off: true })).rejects.toThrow(/unknown highlight text request/)
    await expect(api.retryGraphic("/p", anchor as never)).rejects.toThrow(/unknown highlight text request/)
  }
  expect(calls).toEqual([])
})

test("a graphic only ever sits on a moment of speech: any other place is refused", async () => {
  const { calls, api } = recorder()
  const others = [
    { kind: "highlight", groupId: "g1", line: 0 },
    { kind: "cut", videoId: "v1", sourceUs: 9_000_000, beatId: "b1" },
    { kind: "beat", beatId: "b1", edge: "start" },
  ]
  for (const anchor of others) {
    await expect(api.setGraphic("/p", anchor as never, { off: true }), anchor.kind).rejects.toThrow(/unknown highlight text request/)
    await expect(api.retryGraphic("/p", anchor as never), anchor.kind).rejects.toThrow(/unknown highlight text request/)
  }
  expect(calls).toEqual([])
})

test("writing a graphic again goes to the run with its place and the request, each with only the fields the screen may send; a bad one is refused before the run", async () => {
  const calls: unknown[][] = []
  const post = { redoGraphic: async (...args: unknown[]) => (calls.push(["redoGraphic", ...args]), { running: false, states: {} }) } as unknown as PostPlanService
  const api = createHighlightApi({ highlights: {} as HighlightService, flair: {} as FlairService, emphasis: {} as EmphasisService, post })
  expect(await api.redoGraphic("/p", { ...SPEECH, extra: 1 } as never, { ...POST_REQUEST, extra: 1, subtitles: { ...POST_REQUEST.subtitles, extra: 1 } } as never)).toEqual({ running: false, states: {} })
  await api.redoGraphic("/p", SPEECH, { ...POST_REQUEST, subtitles: null })
  expect(calls).toEqual([
    ["redoGraphic", "/p", SPEECH, POST_REQUEST],
    ["redoGraphic", "/p", SPEECH, { ...POST_REQUEST, subtitles: null }],
  ])

  const bad = [
    // the project must be named, as for any run
    () => api.redoGraphic("", SPEECH, POST_REQUEST),
    () => api.redoGraphic(3 as never, SPEECH, POST_REQUEST),
    // a graphic only ever sits on a moment of speech
    () => api.redoGraphic("/p", null as never, POST_REQUEST),
    () => api.redoGraphic("/p", { kind: "beat", beatId: "b1", edge: "start" }, POST_REQUEST),
    () => api.redoGraphic("/p", { ...SPEECH, sourceUs: 1.5 }, POST_REQUEST),
    () => api.redoGraphic("/p", { ...SPEECH, videoId: 7 } as never, POST_REQUEST),
    // the request is checked as a plan run's is
    () => api.redoGraphic("/p", SPEECH, null as never),
    () => api.redoGraphic("/p", SPEECH, { ...POST_REQUEST, rules: null } as never),
    () => api.redoGraphic("/p", SPEECH, { ...POST_REQUEST, view: { ...VIEW, highlightsOn: "yes" } } as never),
    () => api.redoGraphic("/p", SPEECH, { ...POST_REQUEST, subtitles: undefined } as never),
    () => api.redoGraphic("/p", SPEECH, { ...POST_REQUEST, subtitles: { ...POST_REQUEST.subtitles, length: "long" } } as never),
  ]
  for (const call of bad) await expect(call()).rejects.toThrow(/unknown highlight text request|unknown cut rules/)
  expect(calls).toHaveLength(2)
})

test("editing a graphic goes to the run with its place, the change and the request, each with only what the screen may send and the change trimmed; going back a step goes to the run with its place; a bad one is refused before the run", async () => {
  const calls: unknown[][] = []
  const post = {
    editGraphic: async (...args: unknown[]) => (calls.push(["editGraphic", ...args]), { running: false, states: {} }),
    undoGraphic: async (...args: unknown[]) => void calls.push(["undoGraphic", ...args]),
  } as unknown as PostPlanService
  const api = createHighlightApi({ highlights: {} as HighlightService, flair: {} as FlairService, emphasis: {} as EmphasisService, post })
  // the longest change there may be: 300 graphemes, a Thai letter with its vowel and tone mark one of them and an emoji with
  // its skin tone another, though it runs to 901 code units
  const longest = `${"ที่".repeat(299)}👍🏽`
  expect(await api.editGraphic("/p", { ...SPEECH, extra: 1 } as never, "  ตัวเลข\nใหญ่ขึ้น \n", { ...POST_REQUEST, extra: 1 } as never)).toEqual({ running: false, states: {} })
  await api.editGraphic("/p", SPEECH, longest, { ...POST_REQUEST, subtitles: null })
  // the white space around a change does not count against its length
  await api.editGraphic("/p", SPEECH, `  ${longest}\n`, POST_REQUEST)
  expect(await api.undoGraphic("/p", { ...SPEECH, extra: 1 } as never)).toBeUndefined()
  expect(calls).toEqual([
    ["editGraphic", "/p", SPEECH, "ตัวเลข\nใหญ่ขึ้น", POST_REQUEST],
    ["editGraphic", "/p", SPEECH, longest, { ...POST_REQUEST, subtitles: null }],
    ["editGraphic", "/p", SPEECH, longest, POST_REQUEST],
    ["undoGraphic", "/p", SPEECH],
  ])

  const bad = [
    // the project must be named, as for any run
    () => api.editGraphic("", SPEECH, "ใหญ่ขึ้น", POST_REQUEST),
    () => api.editGraphic(3 as never, SPEECH, "ใหญ่ขึ้น", POST_REQUEST),
    // a graphic only ever sits on a moment of speech
    () => api.editGraphic("/p", null as never, "ใหญ่ขึ้น", POST_REQUEST),
    () => api.editGraphic("/p", { kind: "beat", beatId: "b1", edge: "start" }, "ใหญ่ขึ้น", POST_REQUEST),
    () => api.editGraphic("/p", { ...SPEECH, sourceUs: 1.5 }, "ใหญ่ขึ้น", POST_REQUEST),
    () => api.editGraphic("/p", { ...SPEECH, videoId: 7 } as never, "ใหญ่ขึ้น", POST_REQUEST),
    // the change is a text with something in it, of 300 graphemes at the most
    () => api.editGraphic("/p", SPEECH, 3 as never, POST_REQUEST),
    () => api.editGraphic("/p", SPEECH, null as never, POST_REQUEST),
    () => api.editGraphic("/p", SPEECH, ["ใหญ่ขึ้น"] as never, POST_REQUEST),
    () => api.editGraphic("/p", SPEECH, "", POST_REQUEST),
    () => api.editGraphic("/p", SPEECH, " \n\t ", POST_REQUEST),
    () => api.editGraphic("/p", SPEECH, `${longest}ก`, POST_REQUEST),
    // the request is checked as a plan run's is
    () => api.editGraphic("/p", SPEECH, "ใหญ่ขึ้น", null as never),
    () => api.editGraphic("/p", SPEECH, "ใหญ่ขึ้น", { ...POST_REQUEST, rules: null } as never),
    () => api.editGraphic("/p", SPEECH, "ใหญ่ขึ้น", { ...POST_REQUEST, view: { ...VIEW, highlightsOn: "yes" } } as never),
    // going back a step names its project and a moment of speech
    () => api.undoGraphic("", SPEECH),
    () => api.undoGraphic(3 as never, SPEECH),
    () => api.undoGraphic("/p", null as never),
    () => api.undoGraphic("/p", { kind: "highlight", groupId: "g1", line: 0 }),
    () => api.undoGraphic("/p", { ...SPEECH, sourceUs: 1.5 }),
  ]
  for (const call of bad) await expect(call()).rejects.toThrow(/unknown highlight text request|unknown cut rules/)
  expect(calls).toHaveLength(4)
})

test("whether highlight text is on is part of every request, and anything but a yes or no is refused", async () => {
  const { calls, api } = recorder()
  const options = { position: "auto" as const, subtitlesOn: false, highlightsOn: false, flair: { enabled: true, level: "light" as const, text: true, sound: true, zoom: true, insert: true, graphic: true } }
  await api.previewHighlights("/p", DEFAULT_CUT_RULES, options)
  expect(calls).toEqual([["preview", "/p", DEFAULT_CUT_RULES, options]])
  for (const highlightsOn of [undefined, "yes", 1, null]) {
    await expect(api.previewHighlights("/p", DEFAULT_CUT_RULES, { ...options, highlightsOn } as never), String(highlightsOn)).rejects.toThrow(/unknown highlight text request/)
  }
  expect(calls).toHaveLength(1)
})

test("emphasis requests reach the emphasis service with only the fields the screen may send", async () => {
  const { calls, api } = recorder()
  await api.planEmphasis("/p", DEFAULT_CUT_RULES)
  await api.setEmphasisPoint("/p", "p1", { importance: "key", type: "number", reason: "ราคา", anchor: { kind: "speech", videoId: "v1", from: 3, to: 5, beatId: "b1", extra: 1 } as never })
  await api.setEmphasisPoint("/p", "p1", { reason: "x".repeat(200) })
  await api.setEmphasisPoint("/p", "p2", null)
  await api.addEmphasisPoint("/p", { kind: "scene", videoId: "v2", startUs: 0, endUs: 2_000_000, beatId: "b2", from: 1 } as never)
  expect(calls).toEqual([
    ["emphasisOnly", "/p", DEFAULT_CUT_RULES],
    ["emphasis.setPoint", "/p", "p1", { importance: "key", type: "number", reason: "ราคา", anchor: { kind: "speech", videoId: "v1", from: 3, to: 5, beatId: "b1" } }],
    ["emphasis.setPoint", "/p", "p1", { reason: "x".repeat(200) }],
    ["emphasis.setPoint", "/p", "p2", null],
    ["emphasis.addPoint", "/p", { kind: "scene", videoId: "v2", startUs: 0, endUs: 2_000_000, beatId: "b2" }],
  ])
})

test("emphasis requests the app did not make are refused before they reach the service", async () => {
  const { calls, api } = recorder()
  await expect(api.planEmphasis("/p", { ...DEFAULT_CUT_RULES, preset: "wild" } as never)).rejects.toThrow(/cut rules/)
  await expect(api.planEmphasis(3 as never, DEFAULT_CUT_RULES)).rejects.toThrow(/emphasis request/)
  const speech = { kind: "speech", videoId: "v1", from: 3, to: 5, beatId: "b1" }
  const scene = { kind: "scene", videoId: "v2", startUs: 0, endUs: 2_000_000, beatId: "b2" }
  const anchors = [
    null,
    "speech",
    { ...speech, kind: "word" },
    { ...speech, videoId: "" },
    { ...speech, videoId: "v".repeat(201) },
    { ...speech, beatId: 3 },
    { ...speech, beatId: undefined },
    { ...speech, from: 5, to: 5 },
    { ...speech, from: -1 },
    { ...speech, from: 1.5 },
    { ...speech, to: 100_001 },
    { ...scene, startUs: 2, endUs: 1 },
    { ...scene, endUs: 86_400_000_001 },
    { ...scene, startUs: "0" },
  ]
  for (const anchor of anchors) {
    await expect(api.addEmphasisPoint("/p", anchor as never), JSON.stringify(anchor)).rejects.toThrow(/emphasis request/)
    await expect(api.setEmphasisPoint("/p", "p1", { anchor } as never), JSON.stringify(anchor)).rejects.toThrow(/emphasis request/)
  }
  // {} names no field: a change that changes nothing is not one the tab makes
  const patches = [undefined, "key", [], {}, { importance: "top" }, { type: "joke" }, { reason: 3 }, { reason: "x".repeat(201) }, { importance: "key", colour: "red" }]
  for (const patch of patches) {
    await expect(api.setEmphasisPoint("/p", "p1", patch as never), JSON.stringify(patch)).rejects.toThrow(/emphasis request/)
  }
  // fields named with nothing in them name no field either
  for (const patch of [{ reason: undefined }, { importance: undefined, anchor: undefined }]) {
    await expect(api.setEmphasisPoint("/p", "p1", patch), Object.keys(patch).join()).rejects.toThrow(/emphasis request/)
  }
  for (const id of [3, "", "x".repeat(201)]) {
    await expect(api.setEmphasisPoint("/p", id as never, null), String(id)).rejects.toThrow(/emphasis request/)
  }
  await expect(api.addEmphasisPoint({} as never, speech as never)).rejects.toThrow(/emphasis request/)
  expect(calls).toEqual([])
})

test("a reason is measured as it is kept: the spaces around it do not count, and it reaches the service trimmed", async () => {
  const { calls, api } = recorder()
  await api.setEmphasisPoint("/p", "p1", { reason: `  ${"x".repeat(200)}\n` })
  await expect(api.setEmphasisPoint("/p", "p1", { reason: ` ${"x".repeat(201)} ` })).rejects.toThrow(/emphasis request/)
  expect(calls).toEqual([["emphasis.setPoint", "/p", "p1", { reason: "x".repeat(200) }]])
})
