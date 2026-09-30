import { expect, test } from "vitest"
import { clipText, enforceGraphics, GRAPHIC_MIN_US, INSTRUCTION_MAX, isMotion, MOTION_VERSION, type GraphicCue, type GraphicSpec, type MotionSpec, type PlacedGraphic, type PreviousFragment } from "./plan.ts"

const spec = (seconds = 3): GraphicCue["spec"] => ({ kind: "motion", version: MOTION_VERSION, box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 }, seconds, why: "", idea: "ตัวเลขวิ่ง", words: [], html: "<style></style>" })
const placed = (atUs: number, seconds = 3, over: Partial<GraphicCue> = {}): PlacedGraphic => ({
  cue: { anchor: { kind: "speech", videoId: "v", sourceUs: atUs, beatId: "b1" }, spec: spec(seconds), edited: false, off: false, ...over },
  atUs,
  durationUs: seconds * 1_000_000,
})

test("words are cut without parting a letter from its vowel or tone mark: the whole cluster stays or goes", () => {
  // สวัสดีครับ is ส · วั · ส · ดี · ค · รั · บ, ten code units
  expect(clipText("สวัสดีครับ", 2)).toBe("ส")
  expect(clipText("สวัสดีครับ", 5)).toBe("สวัส")
  expect(clipText("สวัสดีครับ", 6)).toBe("สวัสดี")
  // ที่ is three code units; cutting after two would read ที, another word
  expect(clipText("ดีที่สุด", 4)).toBe("ดี")
  expect(clipText("ดีที่สุด", 5)).toBe("ดีที่")
})

test("an emoji at the limit is dropped whole, never left half a pair", () => {
  // 🔥 is two code units, 👍🏽 four
  expect(clipText("ลดราคา🔥", 7)).toBe("ลดราคา")
  expect(clipText("ลดราคา🔥", 8)).toBe("ลดราคา🔥")
  expect(clipText("ลดราคา👍🏽", 9)).toBe("ลดราคา")
})

test("words that fit are left as they are", () => {
  expect(clipText("สวัสดี", 60)).toBe("สวัสดี")
  expect(clipText("สวัสดีครับ", 10)).toBe("สวัสดีครับ")
  expect(clipText("", 12)).toBe("")
})

test("graphics on screen together all play, however many and however close, the user's or Claude's: the writer lays them on tracks of their own", () => {
  const mine = placed(2_000_000, 3, { edited: true })
  const { kept, dropped } = enforceGraphics([placed(1_000_000, 2), mine, placed(0, 6), placed(4_000_000, 3)], 60_000_000)
  expect(kept.map((g) => g.atUs)).toEqual([0, 1_000_000, 2_000_000, 4_000_000])
  expect(dropped).toBe(0)
})

test("no level and no quota: a clip keeps every graphic it was given, in time order", () => {
  const many = [20, 0, 5, 10, 15].map((s) => placed(s * 1_000_000, 2))
  const { kept, dropped } = enforceGraphics(many, 30_000_000)
  expect(kept.map((g) => g.atUs / 1e6)).toEqual([0, 5, 10, 15, 20])
  expect(dropped).toBe(0)
})

test("one turned off does not play and does not count as dropped", () => {
  expect(enforceGraphics([placed(0, 3, { off: true })], 60_000_000)).toEqual({ kept: [], dropped: 0 })
  expect(enforceGraphics([placed(0), placed(10_000_000, 3, { off: true })], 60_000_000)).toEqual({ kept: [placed(0)], dropped: 0 })
  expect(enforceGraphics([placed(0, 3, { off: true, edited: true }), placed(2_000_000)], 60_000_000).kept.map((g) => g.atUs)).toEqual([2_000_000])
})

test("the end of the timeline cuts a graphic short, and one left shorter than 1.5 s goes", () => {
  const { kept } = enforceGraphics([placed(58_000_000, 3)], 60_000_000)
  expect(kept.map((g) => g.durationUs)).toEqual([2_000_000])
  expect(enforceGraphics([placed(59_000_000, 3)], 60_000_000)).toEqual({ kept: [], dropped: 1 })
})

test("graphics back to back both keep", () => {
  const { kept } = enforceGraphics([placed(0, 2), placed(2_000_000, 2)], 60_000_000)
  expect(kept.map((g) => g.atUs)).toEqual([0, 2_000_000])
})

test("a graphic cut to exactly the minimum stays", () => {
  const { kept } = enforceGraphics([placed(60_000_000 - GRAPHIC_MIN_US, 3)], 60_000_000)
  expect(kept.map((g) => g.durationUs)).toEqual([GRAPHIC_MIN_US])
})

const MOTION: MotionSpec = {
  kind: "motion",
  version: MOTION_VERSION,
  box: { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 },
  seconds: 3,
  why: "",
  idea: "จรวดพุ่งขึ้นจากพื้น",
  words: [{ text: "จรวด", atS: 0.15 }],
  html: "<style></style>",
}

test("a spec of kind motion is a motion graphic, written or not; a stored spec of any other kind, or of none, is not", () => {
  expect(isMotion(MOTION)).toBe(true)
  // one still waiting to be written, or one that failed to be, is a motion graphic all the same
  expect(isMotion({ ...MOTION, html: null })).toBe(true)
  expect(isMotion({ ...MOTION, html: null, failed: "nothing was drawn" })).toBe(true)
  // what an outline file may still hold is outside the type: a card of the old kit, which stored no kind or "card", a sticker, a kind of a later version
  const stored = (spec: object) => spec as GraphicSpec
  expect(isMotion(stored({ version: "kit-1", box: MOTION.box, seconds: 3, tone: "base", in: "pop", out: "fade", pieces: [], why: "" }))).toBe(false)
  expect(isMotion(stored({ kind: "card", version: "kit-1", box: MOTION.box, seconds: 3, pieces: [], why: "" }))).toBe(false)
  expect(isMotion(stored({ kind: "sticker", version: "kit-1", box: MOTION.box, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "" }))).toBe(false)
  expect(isMotion(stored({ ...MOTION, kind: "hologram" }))).toBe(false)
  // nor is what is no spec at all, as a stored entry with none hands over: nothing, null, a number, a word, a list
  for (const none of [undefined, null, 42, "motion", [], ["motion"], {}, { kind: null }]) expect(isMotion(none), JSON.stringify(none)).toBe(false)
  // and the cue that carries it takes it as its spec
  const cue: GraphicCue = { anchor: { kind: "speech", videoId: "v", sourceUs: 0, beatId: "b1" }, spec: MOTION, edited: false, off: false }
  expect(isMotion(cue.spec)).toBe(true)
})

test("a graphic stored by 0.5.0, before a fragment could be edited, is a motion graphic as it is; one edited carries the change asked, why the last edit failed and the fragment before", () => {
  // read back from an outline file of 0.5.0: none of the fields an edit adds, and nothing to clean
  const stored: unknown = JSON.parse(JSON.stringify(MOTION))
  expect(Object.keys(stored as object).sort()).toEqual(["box", "html", "idea", "kind", "seconds", "version", "why", "words"])
  expect(isMotion(stored)).toBe(true)
  // an edit keeps the fragment it replaced with what that one was written for, and the change that made it, when one did
  const before: PreviousFragment = { html: "<style></style>", seconds: 2.5, words: [{ text: "จรวด", atS: 0.2 }], version: MOTION_VERSION, instruction: "ช้าลงหน่อย" }
  const edited: MotionSpec = { ...MOTION, instruction: "ตัวเลขใหญ่ขึ้น", editFailed: "nothing was drawn: every frame is empty", previous: before }
  expect(isMotion(edited)).toBe(true)
  // one a plan or a redo wrote keeps a fragment before it with no change asked
  const redone: MotionSpec = { ...MOTION, previous: { html: "<style></style>", seconds: 3, words: [], version: MOTION_VERSION } }
  expect(isMotion(redone)).toBe(true)
  // the longest change the user may ask for, in graphemes
  expect(INSTRUCTION_MAX).toBe(300)
})
