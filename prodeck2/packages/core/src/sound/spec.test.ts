import { expect, test } from "vitest"
import {
  type ComposedSound,
  isComposed,
  isSoundPrevious,
  LOUDNESS_LUFS,
  SOUND_CODE_MAX,
  SOUND_LOUDNESS,
  SOUND_ROLE_MAX,
  SOUND_SECONDS_MAX,
  SOUND_SECONDS_MIN,
  SOUND_VERSION,
  type SoundPrevious,
} from "./spec.ts"

const ANCHOR = { kind: "speech", videoId: "v", sourceUs: 12_600_000, beatId: "b1" } as const
const CODE = "function compose(ctx, cue, kit) {\n  const o = ctx.createOscillator()\n}"

/** A sound written, tied to a graphic, edited once, with the one it replaced kept for a step back: every field there is. */
const WHOLE: ComposedSound = {
  anchor: ANCHOR,
  graphic: ANCHOR,
  graphicHtml: "0123456789abcdef",
  pointId: "p1",
  from: "medium",
  role: "นับถอยหลัง สาม สอง หนึ่ง ด้วยเสียงไม้เคาะ แล้วพุ่งขึ้นตอนหนึ่ง",
  loudness: "normal",
  seconds: 2.8,
  words: [
    { text: "สาม", atS: 0 },
    { text: "สอง", atS: 1.26 },
    { text: "หนึ่ง", atS: 2.22 },
  ],
  code: CODE,
  version: SOUND_VERSION,
  failed: "the sound is silent: nothing above 1% of full scale",
  instruction: "เบาลง",
  editFailed: "the sound starts with a click: the first 5 ms reach 0.2",
  previous: { code: CODE, seconds: 2.8, words: [{ text: "สาม", atS: 0 }], version: SOUND_VERSION, graphicHtml: "fedcba9876543210", instruction: "ให้ตึงกว่านี้" },
  off: false,
}

/** A sound as a plan stores it before it is composed: none of the fields a writing or an edit adds. */
const PLANNED: ComposedSound = { anchor: ANCHOR, from: "light", role: "เสียงกริ๊งตอนคำว่าอวกาศ", loudness: "soft", seconds: 1.5, words: [], code: null, version: SOUND_VERSION, off: false }

test("the constants of a composed sound: its version, the most code, its shortest and longest, the most role, and the three loudness classes with the level each is set to", () => {
  expect(SOUND_VERSION).toBe("sound-2026-10-01")
  expect(SOUND_CODE_MAX).toBe(20_000)
  expect(SOUND_SECONDS_MIN).toBe(0.2)
  expect(SOUND_SECONDS_MAX).toBe(6)
  expect(SOUND_ROLE_MAX).toBe(200)
  expect(SOUND_LOUDNESS).toEqual(["soft", "normal", "strong"])
  expect(LOUDNESS_LUFS).toEqual({ soft: -30, normal: -26, strong: -22 })
})

test("a whole sound is one, and so is one a plan stored before it was composed; read back from an outline file, each still is", () => {
  expect(isComposed(WHOLE)).toBe(true)
  expect(isComposed(PLANNED)).toBe(true)
  expect(isComposed(JSON.parse(JSON.stringify(WHOLE)))).toBe(true)
  expect(isComposed(JSON.parse(JSON.stringify(PLANNED)))).toBe(true)
  // switched off, at every level and every loudness
  expect(isComposed({ ...PLANNED, off: true })).toBe(true)
  for (const from of ["light", "medium", "heavy"]) expect(isComposed({ ...PLANNED, from }), from).toBe(true)
  for (const loudness of SOUND_LOUDNESS) expect(isComposed({ ...PLANNED, loudness }), loudness).toBe(true)
  // any kind of anchor: the guard asks for a kind, and what reads the sound places it
  expect(isComposed({ ...PLANNED, anchor: { kind: "highlight", groupId: "g", line: 0 } })).toBe(true)
})

test("a stored sound with any one field wrong is none, field by field; and what is not an object is none", () => {
  const { anchor: _anchor, ...noAnchor } = PLANNED
  const { role: _role, ...noRole } = PLANNED
  const { code: _code, ...noCode } = PLANNED
  const { seconds: _seconds, ...noSeconds } = PLANNED
  const { words: _words, ...noWords } = PLANNED
  const { from: _from, ...noFrom } = PLANNED
  const { loudness: _loudness, ...noLoudness } = PLANNED
  const { off: _off, ...noOff } = PLANNED
  const not: [why: string, value: unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["a string", "x"],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
    // the anchor: an object with a string kind
    ["no anchor", noAnchor],
    ["anchor null", { ...PLANNED, anchor: null }],
    ["anchor a string", { ...PLANNED, anchor: "speech" }],
    ["anchor with no kind", { ...PLANNED, anchor: { videoId: "v", sourceUs: 1 } }],
    ["anchor kind a number", { ...PLANNED, anchor: { ...ANCHOR, kind: 3 } }],
    // the role: a string
    ["no role", noRole],
    ["role a number", { ...PLANNED, role: 7 }],
    ["role null", { ...PLANNED, role: null }],
    // the code: a string or null
    ["no code", noCode],
    ["code a number", { ...PLANNED, code: 1 }],
    ["code an object", { ...PLANNED, code: {} }],
    // the length: a finite number
    ["no seconds", noSeconds],
    ["seconds a string", { ...PLANNED, seconds: "1.5" }],
    ["seconds not a number", { ...PLANNED, seconds: Number.NaN }],
    ["seconds endless", { ...PLANNED, seconds: Number.POSITIVE_INFINITY }],
    ["seconds null", { ...PLANNED, seconds: null }],
    // the words: an array
    ["no words", noWords],
    ["words a string", { ...PLANNED, words: "สาม" }],
    ["words null", { ...PLANNED, words: null }],
    // the lowest level: one of the three
    ["no from", noFrom],
    ["from another word", { ...PLANNED, from: "loud" }],
    ["from in capitals", { ...PLANNED, from: "Light" }],
    // the loudness: one of the three classes
    ["no loudness", noLoudness],
    ["loudness another word", { ...PLANNED, loudness: "quiet" }],
    ["loudness a level in LUFS", { ...PLANNED, loudness: -26 }],
    // switched off: a boolean
    ["no off", noOff],
    ["off a string", { ...PLANNED, off: "false" }],
    ["off a number", { ...PLANNED, off: 0 }],
  ]
  for (const [why, value] of not) expect(isComposed(value), why).toBe(false)
})

test("the fields a stored sound may leave out are each, when present, of their kind: the graphic an anchor with a kind, the texts strings; its version is always a string", () => {
  const { version: _version, ...noVersion } = PLANNED
  const not: [why: string, value: unknown][] = [
    ["no version", noVersion],
    ["version a number", { ...PLANNED, version: 1 }],
    ["version null", { ...PLANNED, version: null }],
    ["graphic null", { ...PLANNED, graphic: null }],
    ["graphic a string", { ...PLANNED, graphic: "speech" }],
    ["graphic with no kind", { ...PLANNED, graphic: { videoId: "v", sourceUs: 1 } }],
    ["graphic kind a number", { ...PLANNED, graphic: { ...ANCHOR, kind: 3 } }],
    ["graphicHtml a number", { ...PLANNED, graphicHtml: 16 }],
    ["graphicHtml null", { ...PLANNED, graphicHtml: null }],
    ["pointId a number", { ...PLANNED, pointId: 1 }],
    ["pointId null", { ...PLANNED, pointId: null }],
    ["failed null", { ...PLANNED, failed: null }],
    ["failed an object", { ...PLANNED, failed: {} }],
    ["instruction a number", { ...PLANNED, instruction: 7 }],
    ["instruction null", { ...PLANNED, instruction: null }],
    ["editFailed a number", { ...PLANNED, editFailed: 7 }],
    ["editFailed null", { ...PLANNED, editFailed: null }],
  ]
  for (const [why, value] of not) expect(isComposed(value), why).toBe(false)
  // each present and of its kind, one at a time and all together
  for (const field of [{ graphic: ANCHOR }, { graphicHtml: "0123456789abcdef" }, { pointId: "p1" }, { failed: "x" }, { instruction: "เบาลง" }, { editFailed: "x" }]) {
    expect(isComposed({ ...PLANNED, ...field }), JSON.stringify(field)).toBe(true)
  }
  expect(isComposed(WHOLE)).toBe(true)
})

test("the code kept for a step back is one with its code, length, words and contract, and the graphic's hash and the change that made it only as texts; what a file may hold in its place is none", () => {
  const kept: SoundPrevious = { code: CODE, seconds: 2.8, words: [{ text: "สาม", atS: 0 }], version: SOUND_VERSION }
  expect(isSoundPrevious(kept)).toBe(true)
  expect(isSoundPrevious({ ...kept, graphicHtml: "0123456789abcdef" })).toBe(true)
  expect(isSoundPrevious({ ...kept, instruction: "เบาลง" })).toBe(true)
  expect(isSoundPrevious({ ...kept, words: [] })).toBe(true)
  expect(isSoundPrevious(WHOLE.previous)).toBe(true)
  // read back from a file, it is what the file says
  expect(isSoundPrevious(JSON.parse(JSON.stringify(WHOLE.previous)))).toBe(true)
  const not: unknown[] = [
    undefined,
    null,
    "x",
    42,
    [],
    {},
    { ...kept, code: null },
    { ...kept, code: 3 },
    { ...kept, seconds: "2.8" },
    { ...kept, words: "สาม" },
    { ...kept, words: null },
    { ...kept, version: 1 },
    { ...kept, graphicHtml: null },
    { ...kept, graphicHtml: 16 },
    { ...kept, instruction: null },
    { ...kept, instruction: 7 },
    { seconds: 2.8, words: [], version: SOUND_VERSION },
    { code: CODE, words: [], version: SOUND_VERSION },
    { code: CODE, seconds: 2.8, version: SOUND_VERSION },
    { code: CODE, seconds: 2.8, words: [] },
  ]
  for (const value of not) expect(isSoundPrevious(value), JSON.stringify(value) ?? String(value)).toBe(false)
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/sound/spec")
  expect(exported.isComposed).toBe(isComposed)
  expect(exported.isSoundPrevious).toBe(isSoundPrevious)
  expect(exported.SOUND_VERSION).toBe(SOUND_VERSION)
})
